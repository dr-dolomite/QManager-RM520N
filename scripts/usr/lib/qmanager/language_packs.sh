#!/bin/sh
# =============================================================================
# language_packs.sh — Shared helpers for the runtime language-pack downloader
# =============================================================================
# Sourced by:
#   * /usr/bin/qmanager_language_install (worker)
#   * scripts/www/cgi-bin/quecmanager/system/language-packs/*.sh (CGI)
#
# Storage model (RM520N-GL — survives OTA, unlike RM551E's in-web-root store):
#   Persistent store (root-owned):  /usrdata/qmanager/locales-packs/<code>/
#   Served copy      (root-owned):  /usrdata/qmanager/www/locales-packs/<code>/
#   Staging          (www-data):    /usrdata/qmanager/locales-staging/<code>.stage
# Only the root helper /usr/bin/qmanager_language_pack_apply may write into the
# persistent store or the served copy — this library never does so directly.
#
# Conventions:
#   * Callers own qlog_init. This library never calls it.
#   * Functions return 0 on success, non-zero on error. No side effects on
#     stdout unless documented.
#   * jq expressions avoid test()/regex; boolean access uses if/then/else/end.
# =============================================================================

[ -n "$_LP_LIB_LOADED" ] && return 0
_LP_LIB_LOADED=1

LP_PERSIST_DIR="/usrdata/qmanager/locales-packs"
LP_SERVED_DIR="/usrdata/qmanager/www/locales-packs"
LP_STAGING_ROOT="/usrdata/qmanager/locales-staging"
LP_DOWNLOAD_DIR="/tmp/qmanager_lp_download"
LP_PROGRESS_FILE="/tmp/qmanager_language_install.json"
LP_CANCEL_FILE="/tmp/qmanager_language_install.cancel"
LP_INPUT_FILE="/tmp/qmanager_language_install_input.json"
# Single-install gate: a kernel flock, not a PID file or a mkdir-based lock
# directory. install.sh opens this file on fd 9 (`exec 9>"$LP_LOCK_FILE"`)
# and takes a non-blocking exclusive flock before forking the worker; the
# double-forked worker inherits fd 9 (a shell `exec N>` fd is not
# close-on-exec, so it survives fork+exec), which keeps the lock HELD for
# the worker's entire run even after install.sh itself exits and closes its
# own copy of the fd. The kernel releases the lock automatically if the
# holder dies, so there is no PID file, no staleness heuristic, and no
# TOCTOU window to reason about — matches the flock_wait pattern already
# used by scripts/usr/bin/qcmd and scripts/usr/lib/qmanager/sms_alerts.sh
# (BusyBox flock has no -w, hence -x -n; here we want a single non-blocking
# attempt — 409 immediately if busy — rather than that pattern's poll loop).
LP_LOCK_FILE="/tmp/qmanager_language_install.lock"

# Must match ALL_NAMESPACES in lib/i18n/resources.ts exactly. Increment 1 ships
# 3 namespaces (NOT RM551E's 9) — keep this in lockstep with the frontend catalog.
LP_REQUIRED_NS="common sidebar dashboard"

# Codes that ship in the firmware bundle — never removable via remove.sh.
LP_BUNDLED_CODES="en zh-CN zh-TW it id"

# Highest _pack.json "pack_format" this downloader understands. Reject newer.
LP_PACK_FORMAT_SUPPORTED=1

# Trust root: the manifest_url a caller supplies (list.sh query param,
# install.sh body field) is only ever fetched if it is pinned to this
# project's own GitHub release feed. This is what makes the "downloaded,
# attacker-influenced tarball is safe because the trust root = our own
# maintainer-reviewed release" argument actually hold in code, not just in
# the design doc — without this pin, manifest_url would be a blind-SSRF
# vector letting an authenticated caller point the worker at any URL.
# Matches lib/i18n/language-pack-manifest.ts DEFAULT_MANIFEST_URL's host+path.
LP_MANIFEST_URL_PREFIX="https://github.com/dr-dolomite/QManager-RM520N/releases/download/"

# Hard ceiling on a single pack's declared size_bytes. /usrdata is a shared
# 123.7 MB partition (~97 MB free) contended by Entware/certs/other packs —
# keep any one language pack small regardless of what the manifest claims.
LP_MAX_PACK_BYTES=$((2 * 1024 * 1024))

# -----------------------------------------------------------------------------
# lp_pack_is_code_safe <code>
# Returns 0 if <code> is a safe filename/path segment: [A-Za-z0-9-], 2-35 chars,
# no leading/trailing hyphen, no double hyphen. Guards path traversal in every
# place a code becomes part of a filesystem path or sudo argument.
#
# NOTE: code_is_safe() in /usr/bin/qmanager_language_pack_apply duplicates
# this exact check on purpose (the root helper's security boundary must not
# depend on sourcing a library file). Keep both copies byte-identical — a
# change here that isn't mirrored there is a silent security-boundary drift.
# -----------------------------------------------------------------------------
lp_pack_is_code_safe() {
    _c="$1"
    [ -z "$_c" ] && return 1
    _len=$(printf '%s' "$_c" | wc -c | tr -d ' ')
    [ "$_len" -lt 2 ] && return 1
    [ "$_len" -gt 35 ] && return 1
    printf '%s' "$_c" | grep -qE '^[A-Za-z0-9-]+$' || return 1
    case "$_c" in
        -*|*-) return 1 ;;
        *--*) return 1 ;;
    esac
    return 0
}

# -----------------------------------------------------------------------------
# lp_list_installed
# Emits a JSON array of installed packs by reading each persistent-store
# <code>/_pack.json. Fields: code, version, native_name, english_name,
# completeness (overall 0..1), namespaces. Skips any dir whose code fails the
# safety check or whose _pack.json is missing/unparseable. Empty array if the
# persistent store doesn't exist. Stdout only.
# -----------------------------------------------------------------------------
lp_list_installed() {
    [ -d "$LP_PERSIST_DIR" ] || {
        echo '[]'
        return 0
    }
    _out="["
    _sep=""
    for _d in "$LP_PERSIST_DIR"/*; do
        [ -d "$_d" ] || continue
        _code=$(basename "$_d")
        lp_pack_is_code_safe "$_code" || continue
        _meta="$_d/_pack.json"
        [ -f "$_meta" ] || continue
        jq -e '.' "$_meta" >/dev/null 2>&1 || continue
        _entry=$(jq -c \
            '{
                code: (.code // ""),
                version: (.version // ""),
                native_name: (.native_name // ""),
                english_name: (.english_name // ""),
                completeness: (.completeness.overall // 0),
                namespaces: (.namespaces // [])
            }' "$_meta" 2>/dev/null)
        [ -z "$_entry" ] && continue
        _out="${_out}${_sep}${_entry}"
        _sep=","
    done
    _out="${_out}]"
    printf '%s\n' "$_out"
    return 0
}

# -----------------------------------------------------------------------------
# lp_manifest_url_is_safe <url>
# Returns 0 only if <url> is pinned to this project's own GitHub release feed
# (LP_MANIFEST_URL_PREFIX). Plain prefix match — no URL parsing needed, and
# no regex/oniguruma dependency. This is the SSRF gate: every caller of
# lp_fetch_manifest MUST check this first (both the pack tarball's own URL,
# read out of an already-manifest-validated body, and the manifest_url
# itself, which is client-supplied and must never be trusted un-pinned).
# -----------------------------------------------------------------------------
lp_manifest_url_is_safe() {
    _u="$1"
    [ -z "$_u" ] && return 1
    case "$_u" in
        "$LP_MANIFEST_URL_PREFIX"*) return 0 ;;
        *) return 1 ;;
    esac
}

# -----------------------------------------------------------------------------
# lp_fetch_manifest <url>
# Downloads the remote manifest JSON to stdout (no progress side effects).
# Returns 0 on reachable + manifest_version==1 + packs array, non-zero else.
# Callers MUST run lp_manifest_url_is_safe first — this function does not
# re-check the pin so it stays usable for the (already-pinned) call site.
# -----------------------------------------------------------------------------
lp_fetch_manifest() {
    _url="$1"
    [ -z "$_url" ] && return 1
    _body=$(curl -sSfL -m 15 -H "User-Agent: QManager" "$_url" 2>/dev/null) || return 1
    [ -z "$_body" ] && return 1
    printf '%s' "$_body" | jq -e '.manifest_version == 1 and (.packs | type == "array")' >/dev/null 2>&1 || return 1
    printf '%s' "$_body"
    return 0
}

# -----------------------------------------------------------------------------
# lp_manifest_find_pack <manifest_body> <code>
# Emits the single pack entry matching <code>, or empty if not found. Plain
# jq string equality — no regex (portable across jq builds without oniguruma).
# -----------------------------------------------------------------------------
lp_manifest_find_pack() {
    _body="$1"
    _code="$2"
    printf '%s' "$_body" | jq -c --arg code "$_code" \
        '[.packs[] | select(.code == $code)] | first // empty' 2>/dev/null
}

# -----------------------------------------------------------------------------
# lp_verify_sha256 <file> <expected_hex>
# Returns 0 if sha256 matches, 1 otherwise. Case-insensitive hex compare.
# -----------------------------------------------------------------------------
lp_verify_sha256() {
    _file="$1"
    _expected="$2"
    [ -f "$_file" ] || return 1
    [ -n "$_expected" ] || return 1
    _actual=$(sha256sum "$_file" 2>/dev/null | awk '{print $1}')
    [ -z "$_actual" ] && return 1
    _expected_lc=$(printf '%s' "$_expected" | tr 'A-Z' 'a-z')
    _actual_lc=$(printf '%s' "$_actual" | tr 'A-Z' 'a-z')
    [ "$_actual_lc" = "$_expected_lc" ]
}

# -----------------------------------------------------------------------------
# lp_disk_free_kb
# Emits free space on /usrdata in KB (1K blocks). Empty on error.
# -P forces POSIX one-line-per-filesystem output — BusyBox df otherwise wraps
# onto a second line for a long device-name field, which would shift NR==2
# off the stats line (the poller hit this exact issue; see
# scripts/usr/bin/qmanager_poller's own df -P usage).
# -----------------------------------------------------------------------------
lp_disk_free_kb() {
    df -P /usrdata 2>/dev/null | awk 'NR==2 {print $4}'
}

# -----------------------------------------------------------------------------
# lp_extract_tarball_safe <tarball> <dest_dir> <code>
# BusyBox 1.31.1 tar has weak path-traversal defense, so this is the mandatory
# hardening gate: list members first, reject anything not on the exact
# allow-list (_pack.json + each required namespace's <ns>.json — matches the
# flat-layout tar produced by `bun run lang build`), THEN extract. Any member
# containing ".." or starting with "/" or absent from the allow-list aborts
# the whole extraction before tar ever touches disk. The listing is also
# TYPE-checked (via `tar -tvzf`, not `tar -tzf`) and anything that isn't a
# plain regular file — SYMLINK or HARDLINK — is rejected. A symlink/hardlink
# member smuggled in under an allow-listed name (e.g. `common.json` that is
# actually a link to /etc/passwd) would otherwise pass the name check, get
# extracted as a live link by BusyBox tar, and then be preserved verbatim by
# the root helper's `cp -r` into the world-served www/locales-packs/<code>/ —
# confirmed exploitable on-device before this type check was added. Note:
# BusyBox `tar -tvzf` renders a HARDLINK member with a leading '-' — same as
# a genuine regular file — distinguished only by the trailing " -> target"
# also used for symlinks, so the " -> " check runs FIRST, before the column-1
# check, to catch both link types in one gate.
# Returns 0 on success, 1 on any violation or tar failure.
# -----------------------------------------------------------------------------
lp_extract_tarball_safe() {
    _tar="$1"
    _dest="$2"
    _code="$3"
    [ -f "$_tar" ] || return 1

    _allow="_pack.json"
    for _ns in $LP_REQUIRED_NS; do
        _allow="$_allow $_ns.json"
    done

    # Verbose listing exposes the member type in column 1 of each line
    # (mode owner/group size date time name): '-' regular, 'l' symlink,
    # 'd' directory, etc. Plain `tar -tzf` only gives names, which is not
    # enough to distinguish a regular file from a symlink smuggled in under
    # an allow-listed name.
    _members=$(tar -tvzf "$_tar" 2>/dev/null)
    [ -z "$_members" ] && return 1

    _old_ifs="$IFS"
    IFS='
'
    for _line in $_members; do
        IFS="$_old_ifs"
        # Reject symlinks AND hardlinks: BusyBox tar -tvzf renders a hardlink
        # with a leading '-' (same as a regular file), distinguished only by
        # the trailing " -> target" (shared by both link types). The column-1
        # check below alone is insufficient on this BusyBox build.
        case "$_line" in
            *' -> '*) return 1 ;;
        esac
        # Reject anything that isn't a plain regular file outright.
        case "$_line" in
            -*) ;;
            *) return 1 ;;
        esac
        # Name is the trailing field; strip a possible " -> target" symlink
        # suffix defensively (already rejected above, but keep parsing sane).
        # Field 6+ because `-tvzf` output is
        # "mode owner/group size date time name" and filenames may contain
        # spaces, so join everything from field 6 onward.
        _m=$(printf '%s\n' "$_line" | awk '{ for (i=6; i<NF; i++) printf "%s ", $i; print $NF }' | sed 's/ -> .*$//; s/ $//')
        # Reject traversal / absolute paths outright.
        case "$_m" in
            *..*|/*) return 1 ;;
        esac
        _ok=0
        for _a in $_allow; do
            [ "$_m" = "$_a" ] && { _ok=1; break; }
        done
        [ "$_ok" -eq 1 ] || return 1
        IFS='
'
    done
    IFS="$_old_ifs"

    rm -rf "$_dest"
    mkdir -p "$_dest" || return 1
    tar -xzf "$_tar" -C "$_dest" 2>/dev/null || return 1
    return 0
}

# -----------------------------------------------------------------------------
# lp_validate_pack_tree <dir>
# Returns 0 if <dir> contains a parseable _pack.json AND every required
# namespace .json file, each parseable. Returns 1 otherwise.
# -----------------------------------------------------------------------------
lp_validate_pack_tree() {
    _dir="$1"
    [ -d "$_dir" ] || return 1
    jq -e '.' "$_dir/_pack.json" >/dev/null 2>&1 || return 1
    for _ns in $LP_REQUIRED_NS; do
        _f="$_dir/$_ns.json"
        [ -f "$_f" ] || return 1
        jq -e '.' "$_f" >/dev/null 2>&1 || return 1
    done
    return 0
}

# -----------------------------------------------------------------------------
# lp_remove_pack <code>
# Removes an installed (non-bundled) pack from both the persistent store and
# the served copy via the root helper (--remove mode). Returns 0 on success,
# 1 on invalid code, 2 on helper failure.
# -----------------------------------------------------------------------------
lp_remove_pack() {
    _code="$1"
    lp_pack_is_code_safe "$_code" || return 1
    sudo -n /usr/bin/qmanager_language_pack_apply --remove "$_code" >/dev/null 2>&1 || return 2
    return 0
}

# -----------------------------------------------------------------------------
# lp_write_progress <state> <code> <progress_int> <step> [<message>]
# Emits a single JSON document to $LP_PROGRESS_FILE atomically (.tmp + mv).
# state: "pending" | "downloading" | "verifying" | "extracting" |
#        "validating" | "installing" | "done" | "cancelled" | "failed"
# step:  fine-grained enum ("start" | "fetch_catalog" | "download" | "verify" |
#        "extract" | "validate" | "install" | "done" | "cancelled" | "failed")
# progress: integer 0-100. message: optional human-readable fallback string.
# -----------------------------------------------------------------------------
lp_write_progress() {
    _state="$1"
    _code="$2"
    _progress="$3"
    _step="$4"
    _message="${5:-}"
    jq -n \
        --arg state "$_state" \
        --arg code "${_code:-}" \
        --argjson progress "${_progress:-0}" \
        --arg step "${_step:-}" \
        --arg message "$_message" \
        --argjson updated_at "$(date +%s)" \
        '{state:$state, code:$code, progress:$progress, step:$step, message:$message, updated_at:$updated_at}' \
        > "${LP_PROGRESS_FILE}.tmp" 2>/dev/null
    mv "${LP_PROGRESS_FILE}.tmp" "$LP_PROGRESS_FILE" 2>/dev/null
    return 0
}
