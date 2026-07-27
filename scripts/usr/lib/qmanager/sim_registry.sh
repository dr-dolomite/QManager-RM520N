#!/bin/sh
# =============================================================================
# sim_registry.sh — Persistent per-ICCID SIM registry (shared library)
# =============================================================================
# Storage
# -------
#   SIM_REGISTRY_FILE — /etc/qmanager/sim_registry.json, root:root 0644,
#                        lazy-created (never shipped as an install asset).
#                        Persistent (UBIFS), survives reboot.
#
#   Shape: { "<iccid>": { "carrier": "...", "phone_number": "...",
#                          "first_seen": "<ISO-8601 UTC>"|null,
#                          "dismissed": false }, ... }
#
# Key = ICCID normalized via sim_db_normalize() (sim_db.sh) — byte-parity
# with the known-SIMs set at /etc/qmanager/known_iccids. Do NOT use
# iccid_canonicalize() (BCD-pad stripping) for the registry KEY — only for
# comparisons against it.
#
# Writers
# -------
# root is the SOLE direct writer. www-data never touches this file directly
# — the CGI shells out to the qmanager_sim_registry_apply root helper via
# sudo for dismiss/undismiss. GET/list is a plain read (world-readable file).
#
# Every write is a SCOPED field write on a single ICCID's object — never a
# whole-object rewrite — because the poller (carrier/phone refresh, every
# Tier 2 cycle) and the root helper (dismiss/undismiss, on demand) both write
# into the SAME per-ICCID object from different processes. A whole-object
# read-modify-write here would risk silently reverting a user's dismissal.
#
# Every write is: mktemp in the SAME directory as SIM_REGISTRY_FILE (so mv is
# an atomic rename(2), not a cross-filesystem copy) -> jq scoped-field
# transform -> chmod 644 -> mv over the target. NEVER a raw `>`/`>>` on the
# target path (those follow symlinks and are gated by the target's mode, not
# safe against a symlink swap).
#
# Concurrency is additionally serialized with a BusyBox-safe flock (no `-w`
# timeout support in BusyBox flock — poll in a loop instead), mirroring the
# flock_wait() pattern used by qcmd / qmanager_sms_storage / sms_alerts.sh.
#
# THREAT MODEL — read this before trusting the "root is the sole writer" line.
# The root-helper + validation + scoped-write design defends against:
#   - concurrent-writer races (poller refresh vs. an on-demand dismiss),
#   - malformed/hostile INPUT reaching jq (ICCID validation, --arg only),
#   - bugs in the CGI corrupting unrelated records.
# It does NOT defend against a hostile or compromised www-data process. The
# containing directory /etc/qmanager is owned by www-data (installer does a
# `chown -R www-data:www-data`, predating this feature and relied on by
# auth.json, profiles/ and others that legitimately need direct www-data
# writes). Directory ownership governs unlink/rename, so www-data can delete
# this file and write its own in place, bypassing the helper entirely. Making
# that boundary real would require relocating the registry outside
# /etc/qmanager — deliberately not attempted here. Do not add comments or
# docs claiming this file is tamper-proof against the web user; it is not.
#
# Sourcing
# --------
# Sourced by qmanager_poller, qmanager_sim_registry_apply (root helper), and
# read-only by the sim_registry CGI (list only — no write functions called
# from www-data context). Requires sim_db.sh to already be sourced by the
# caller (uses sim_db_normalize()); does not source it itself to avoid
# fighting the caller's own load-guard ordering.
# =============================================================================

[ -n "$_SIM_REGISTRY_LOADED" ] && return 0
_SIM_REGISTRY_LOADED=1

SIM_REGISTRY_FILE="/etc/qmanager/sim_registry.json"
SIM_REGISTRY_LOCK="/etc/qmanager/sim_registry.lock"

# sim_registry_flock_wait <fd> <timeout_seconds>
# BusyBox flock has no -w/--timeout — poll `flock -x -n` in a loop instead.
sim_registry_flock_wait() {
    local _fd _wait _elapsed
    _fd="$1"
    _wait="$2"
    _elapsed=0
    while [ "$_elapsed" -lt "$_wait" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then
            return 0
        fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done
    flock -x -n "$_fd" 2>/dev/null
}

# _sim_registry_ensure_files — lazy-create the registry + its lock file.
_sim_registry_ensure_files() {
    mkdir -p "$(dirname "$SIM_REGISTRY_FILE")" 2>/dev/null
    [ -e "$SIM_REGISTRY_LOCK" ] || : > "$SIM_REGISTRY_LOCK" 2>/dev/null
}

# _sim_registry_read — print the current registry JSON, defaulting to "{}"
# when the file is absent, empty, or unreadable. Never fails the caller.
_sim_registry_read() {
    local _cur
    _cur='{}'
    if [ -f "$SIM_REGISTRY_FILE" ]; then
        _cur=$(cat "$SIM_REGISTRY_FILE" 2>/dev/null)
        [ -z "$_cur" ] && _cur='{}'
    fi
    printf '%s' "$_cur"
}

# sim_registry_seed_new <iccid> <carrier> <phone_number>
# Create/refresh a record for a NEWLY DETECTED ICCID: sets carrier,
# phone_number, first_seen=now (ISO-8601 UTC), dismissed=false.
# Caller is responsible for the fresh-device suppression gate
# (_had_prior_sim_db from sim_db_seed_if_absent) — this function
# unconditionally (re)seeds first_seen/dismissed, so only call it once per
# genuine "new SIM" detection.
# Returns 0 on success, nonzero on lock/write failure (best-effort; caller
# should treat failure as non-fatal — the swap-detected /tmp flag is the
# fallback signal).
sim_registry_seed_new() {
    local _iccid _carrier _phone _ts
    _iccid=$(sim_db_normalize "$1")
    _carrier="$2"
    _phone="$3"
    [ -z "$_iccid" ] && return 1

    _sim_registry_ensure_files
    _ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)

    (
        sim_registry_flock_wait 9 5 || exit 2
        local _cur _tmp
        _cur=$(_sim_registry_read)
        _tmp=$(mktemp "${SIM_REGISTRY_FILE}.XXXXXX" 2>/dev/null) || exit 1
        if ! printf '%s' "$_cur" | jq \
            --arg iccid "$_iccid" \
            --arg carrier "$_carrier" \
            --arg phone "$_phone" \
            --arg ts "$_ts" \
            '.[$iccid].carrier = $carrier
             | .[$iccid].phone_number = $phone
             | .[$iccid].first_seen = $ts
             | .[$iccid].dismissed = false' \
            > "$_tmp" 2>/dev/null; then
            rm -f "$_tmp"
            exit 1
        fi
        chmod 644 "$_tmp" 2>/dev/null
        mv "$_tmp" "$SIM_REGISTRY_FILE"
    ) 9<"$SIM_REGISTRY_LOCK"
}

# sim_registry_refresh_active <iccid> <carrier> <phone_number>
# Scoped refresh of ONLY carrier + phone_number on the record for the
# currently-active ICCID. Never touches dismissed/first_seen. No-ops (skips
# the mktemp+mv entirely) when neither value actually changed, so a steady
# state does not cost a write every Tier 2 cycle. If no record exists yet for
# this ICCID (e.g. a SIM that was already in known_iccids before the registry
# existed), jq auto-vivifies one with first_seen left null and dismissed left
# absent (CGI/poller both treat a missing dismissed as false) — this is the
# backfill path for pre-existing known SIMs, without any installer migration.
sim_registry_refresh_active() {
    local _iccid _carrier _phone
    _iccid=$(sim_db_normalize "$1")
    _carrier="$2"
    _phone="$3"
    [ -z "$_iccid" ] && return 1

    _sim_registry_ensure_files

    (
        sim_registry_flock_wait 9 5 || exit 2
        local _cur _cur_carrier _cur_phone
        _cur=$(_sim_registry_read)
        _cur_carrier=$(printf '%s' "$_cur" | jq -r --arg k "$_iccid" '(.[$k].carrier // "")' 2>/dev/null)
        _cur_phone=$(printf '%s' "$_cur" | jq -r --arg k "$_iccid" '(.[$k].phone_number // "")' 2>/dev/null)

        if [ "$_cur_carrier" = "$_carrier" ] && [ "$_cur_phone" = "$_phone" ]; then
            exit 0
        fi

        local _tmp
        _tmp=$(mktemp "${SIM_REGISTRY_FILE}.XXXXXX" 2>/dev/null) || exit 1
        if ! printf '%s' "$_cur" | jq \
            --arg iccid "$_iccid" \
            --arg carrier "$_carrier" \
            --arg phone "$_phone" \
            '.[$iccid].carrier = $carrier | .[$iccid].phone_number = $phone' \
            > "$_tmp" 2>/dev/null; then
            rm -f "$_tmp"
            exit 1
        fi
        chmod 644 "$_tmp" 2>/dev/null
        mv "$_tmp" "$SIM_REGISTRY_FILE"
    ) 9<"$SIM_REGISTRY_LOCK"
}

# sim_registry_set_dismissed <iccid> <true|false>
# Scoped write of ONLY the dismissed field. Refuses to create a new record
# (an unknown ICCID must never be silently registered by a dismiss/undismiss
# call) — returns 3 if no record exists for the ICCID.
# Return codes: 0 success, 1 write failure, 2 lock-acquire timeout,
# 3 unknown ICCID (no existing record).
# Root-privileged callers only (qmanager_sim_registry_apply); www-data never
# calls this directly.
sim_registry_set_dismissed() {
    local _iccid _val
    _iccid=$(sim_db_normalize "$1")
    _val="$2"
    [ -z "$_iccid" ] && return 1

    _sim_registry_ensure_files

    (
        sim_registry_flock_wait 9 5 || exit 2
        local _cur _exists
        _cur=$(_sim_registry_read)
        _exists=$(printf '%s' "$_cur" | jq -r --arg k "$_iccid" 'has($k)' 2>/dev/null)
        [ "$_exists" = "true" ] || exit 3

        local _tmp
        _tmp=$(mktemp "${SIM_REGISTRY_FILE}.XXXXXX" 2>/dev/null) || exit 1
        if ! printf '%s' "$_cur" | jq \
            --arg iccid "$_iccid" \
            --argjson val "$_val" \
            '.[$iccid].dismissed = $val' \
            > "$_tmp" 2>/dev/null; then
            rm -f "$_tmp"
            exit 1
        fi
        chmod 644 "$_tmp" 2>/dev/null
        mv "$_tmp" "$SIM_REGISTRY_FILE"
    ) 9<"$SIM_REGISTRY_LOCK"
}

# sim_registry_clear_keep <iccid>
# Reset the registry to contain ONLY the given ICCID's record — the sidecar
# half of the "clear known SIMs" action. sim_db_clear_keep() is the set half;
# the two MUST move together or the Tracked SIMs card lists SIMs the count
# already reports as forgotten (this was a real shipped bug).
#
# The kept record is preserved VERBATIM (carrier, phone_number, first_seen,
# dismissed) rather than reseeded: a user who already silenced the inserted
# SIM's banner must not get it back as a side effect of forgetting the OTHER
# SIMs. An empty ICCID (no SIM inserted) empties the registry entirely,
# mirroring sim_db_clear_keep's truncate-on-empty. An ICCID with no existing
# record also yields an empty registry — nothing is ever auto-vivified here.
#
# Unlike the scoped-field writers above this is a WHOLE-object rewrite, which
# is safe only because it is the one operation whose entire purpose is to
# discard the other keys. It still runs under the same flock, so a concurrent
# poller refresh cannot interleave.
# Return codes: 0 success, 1 write failure, 2 lock-acquire timeout.
# Root-privileged callers only (qmanager_sim_registry_apply); www-data never
# calls this directly.
sim_registry_clear_keep() {
    local _iccid
    _iccid=$(sim_db_normalize "$1")

    _sim_registry_ensure_files

    (
        sim_registry_flock_wait 9 5 || exit 2
        local _cur _tmp
        _cur=$(_sim_registry_read)
        _tmp=$(mktemp "${SIM_REGISTRY_FILE}.XXXXXX" 2>/dev/null) || exit 1
        if ! printf '%s' "$_cur" | jq \
            --arg iccid "$_iccid" \
            'if ($iccid != "" and has($iccid)) then {($iccid): .[$iccid]} else {} end' \
            > "$_tmp" 2>/dev/null; then
            rm -f "$_tmp"
            exit 1
        fi
        chmod 644 "$_tmp" 2>/dev/null
        mv "$_tmp" "$SIM_REGISTRY_FILE"
    ) 9<"$SIM_REGISTRY_LOCK"
}

# sim_registry_get_record <iccid>
# Print the record for <iccid> as compact JSON, or "null" if absent/file
# missing. Read-only — safe for www-data (file is world-readable 0644), no
# lock needed (mv is atomic, so a concurrent writer never yields a torn read).
sim_registry_get_record() {
    local _iccid
    _iccid=$(sim_db_normalize "$1")
    [ -z "$_iccid" ] && { printf 'null'; return 0; }
    if [ -f "$SIM_REGISTRY_FILE" ]; then
        jq -c --arg k "$_iccid" '(.[$k] // null)' "$SIM_REGISTRY_FILE" 2>/dev/null || printf 'null'
    else
        printf 'null'
    fi
}
