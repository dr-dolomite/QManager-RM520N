#!/bin/sh
# hw_profile.sh — QManager hardware identity: parser, tier table, profile generator.
#
# THIS IS NOT scripts/usr/lib/qmanager/platform.sh. That file, despite its name,
# is the INIT-SYSTEM abstraction (svc_start / svc_enable / run_iptables) left over
# from the OpenWRT-to-systemd port. SoC and model logic lands here so that
# "platform" does not come to mean two unrelated things in one tree.
#
# TWO IDENTITY AXES, NEVER COLLAPSED:
#   MODEL  (`Project Name:`)  governs form factor and peripherals.
#   SoC    (`Branch  Name:`)  governs counter orientation, IPA quirks, udev.
# Never merge them into a single "platform" string.
#
# THE PROFILE IS ADVISORY, NEVER A SECURITY BOUNDARY. /etc/qmanager cannot hold a
# root-pinned file: www-data owns the directory and qmanager_setup does an
# unconditional `chown -R www-data:www-data /etc/qmanager` every boot. No
# privilege, authentication or tier-enforcement decision may consult this profile.
#
# NO jq. This library is called from qmanager_setup, which has no jq today and no
# guarantee that /opt is mounted — and the RG501Q-EU has no jq at all. JSON is
# emitted with printf.
#
# Ships as dead code: nothing consumes it yet. Callers arrive in later tasks.

# ${VAR:-} form: a caller running under `set -u` must be able to source this
# library without it dying on an unset guard variable.
[ -n "${_HW_PROFILE_LOADED:-}" ] && return 0
_HW_PROFILE_LOADED=1

# Path to the Quectel vendor version file. Overridable for the test harness.
: "${QUECTEL_VERSION_FILE:=/etc/quectel-project-version}"

# platform.json schema version. Bumping this is the migration path: consumers
# regenerate the profile when the on-disk schema is absent or lower. config.sh
# has no key-migration primitive (qm_config_init returns early on any non-empty
# file), so a key added later would otherwise never reach an OTA-upgraded device.
QM_HW_SCHEMA=1

# The value every accessor returns when the field cannot be parsed. Never a bare
# empty string — a caller must not be able to mistake "unreadable" for a value.
QM_HW_UNKNOWN="unknown"

# --- Parser ------------------------------------------------------------------
#
# The vendor file's labels are COLUMN-ALIGNED, and three of the five are not what
# a naive parser expects. Measured with `od -c` on both devices, 2026-08-24:
#
#   Project Name: RM520NGL_VC                   <- one space, colon flush
#   Project Rev : RM520NGLAAR03A03M4G_A0.304    <- SPACE BEFORE THE COLON
#   Branch  Name: SDX6X                         <- TWO SPACES between the words
#   Custom  Name: STD                           <- TWO SPACES between the words
#   Package Time: 2026-03-23,12:27
#
# The defect this exposes: qmanager_poller's `grep -m1 "^Branch Name"` (one space)
# matches NOTHING on either device. The matcher below therefore tolerates
# whitespace BETWEEN THE WORDS, not merely before the colon — which also keeps the
# legacy `Branch Name      : SDX6X` test-fixture convention working.
#
# The value is everything after the FIRST colon; `Package Time` legitimately
# contains a second one, so a first-colon strip is required, not a convenience.

# _qm_hw_field <word1> <word2> — print the field value, or return 1.
_qm_hw_field() {
    local w1="$1" w2="$2" val
    [ -r "$QUECTEL_VERSION_FILE" ] || return 1
    val=$(grep -m1 "^${w1}[[:space:]]*${w2}[[:space:]]*:" "$QUECTEL_VERSION_FILE" 2>/dev/null \
          | tr -d '\r' \
          | sed -e 's/^[^:]*:[[:space:]]*//' -e 's/[[:space:]]*$//')
    [ -n "$val" ] || return 1
    printf '%s' "$val"
}

# NO MEMOIZATION, DELIBERATELY. An earlier draft cached each parsed value in a
# module-level variable. It was removed for two reasons:
#
#   1. It never worked. Accessors print to stdout, so every caller invokes them
#      as `$(qm_hw_model)` — a command-substitution SUBSHELL. The assignment
#      lands in the subshell and is gone when it exits, so the cache was
#      re-populated from scratch on literally every call.
#   2. Had it worked, it would be a hazard. The self-heal path compares the LIVE
#      firmware fingerprint against the one recorded in platform.json; a cache
#      holding a pre-reflash value is exactly the bug that path exists to catch.
#
# The file is five lines and the parse is one grep. Re-reading is cheaper than
# the correctness argument for caching it.

# qm_hw_model — verbatim `Project Name:` value, or "unknown".
#
# NOTE the value is SUFFIXED: RM520NGL_VC / RG501QEU_VD — not the marketing names
# RM520N-GL / RG501Q-EU. The design spec's 4.2 JSON example shows "RG501Q-EU" and
# is WRONG about this; the device bytes govern. Glob patterns (RM520N*, RG501Q*)
# survive the suffix; exact-match comparisons do not.
#
# A value that does not look like a Quectel model at all is reported as unknown,
# so that the tier table can tell "unrecognized model" from "unparseable file".
# The shape regex is the one from qmanager_health_check:354, with the
# backslash-free bracket class — the original's `[0-9A-Za-z\-]` contains a stray
# literal backslash (POSIX bracket expressions give backslash no special meaning).
qm_hw_model() {
    local model
    model=$(_qm_hw_field Project Name || printf '%s' "$QM_HW_UNKNOWN")
    printf '%s' "$model" | grep -qE '^(RM|RG|EG|EC)[0-9A-Za-z-]+' \
        || model="$QM_HW_UNKNOWN"
    printf '%s\n' "$model"
}

# qm_hw_soc — verbatim `Branch  Name:` value (SDX6X / SDX55), or "unknown".
qm_hw_soc() {
    local soc
    soc=$(_qm_hw_field Branch Name || printf '%s' "$QM_HW_UNKNOWN")
    printf '%s\n' "$soc"
}

# qm_hw_fw_fingerprint — verbatim `Project Rev :` value, or "unknown".
# This is the staleness key: modem firmware can be reflashed independently of
# QManager, and counter behavior is documented as differing by firmware BUILD, not
# only by SoC. A profile whose fingerprint no longer matches the live file is
# stale and must be regenerated.
qm_hw_fw_fingerprint() {
    local fw
    fw=$(_qm_hw_field Project Rev || printf '%s' "$QM_HW_UNKNOWN")
    printf '%s\n' "$fw"
}

# --- Tier table --------------------------------------------------------------
#
# | Match on Project Name     | Tier         | Installer behavior              |
# | RM551E*                   | incompatible | hard die — wrong arch (OpenWRT) |
# | RM520N*                   | official     | proceed, full profile           |
# | RG501Q*                   | community    | proceed, full profile           |
# | known SoC, unknown model  | community    | proceed, inferred from SoC      |
# | unknown SoC / unparseable | fallback     | proceed, conservative defaults  |
#
# RG501Q is `community` in Phase A and NOT `official`. Section 4.4 of the spec
# lists it as official "after Phase C"; that promotion is Phase C's deliverable.
#
# `tier` is ADVISORY. Nothing may gate a privilege or auth decision on it.
qm_hw_tier() {
    local model soc
    model=$(qm_hw_model)
    case "$model" in
        RM551E*) printf '%s\n' "incompatible" ; return 0 ;;
        RM520N*) printf '%s\n' "official"     ; return 0 ;;
        RG501Q*) printf '%s\n' "community"    ; return 0 ;;
    esac
    # Unrecognized model — fall back to the SoC axis. SDX6X and SDX55 are the two
    # SoCs measured on real hardware; anything else is unknown territory.
    soc=$(qm_hw_soc)
    case "$soc" in
        SDX6X|SDX55) printf '%s\n' "community" ; return 0 ;;
    esac
    printf '%s\n' "fallback"
}

# qm_hw_form_factor — the module's physical package.
#
# These are VENDOR DATASHEET values keyed off the model glob, not device probes:
# RM520N-GL is an M.2 module, RG501Q-EU is LGA. Anything unrecognized stays
# "unknown" rather than guessing.
qm_hw_form_factor() {
    case "$(qm_hw_model)" in
        RM520N*) printf '%s\n' "m2"  ;;
        RG501Q*) printf '%s\n' "lga" ;;
        *)       printf '%s\n' "$QM_HW_UNKNOWN" ;;
    esac
}

# qm_hw_variant — the build-variant slug, matching the variants/<slug>/ overlay
# directories. `default` means "no variant overlay applies — use the
# compatibility-floor asset qmanager.tar.gz", which is exactly how a pre-Phase-A
# client behaves. Never returns empty.
qm_hw_variant() {
    case "$(qm_hw_model)" in
        RM520N*) printf '%s\n' "rm520n" ;;
        RG501Q*) printf '%s\n' "rg501q" ;;
        *)       printf '%s\n' "default" ;;
    esac
}

# --- Generator ---------------------------------------------------------------
#
# THE SINGLE WRITER OF platform.json. Two code paths write the profile — the
# installer at preflight, and qmanager_setup at boot (which does run on the OTA
# path). Two implementations would drift on tier string, schema number or field
# order, and the profile would flip-flop between install-time and boot-time
# content. Both callers come here.

# _qm_hw_json_escape <string> — make a parsed vendor value safe inside a JSON
# string literal. Backslash first, then quote; control characters dropped.
_qm_hw_json_escape() {
    printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# qm_hw_write_profile <dest> — atomically write the platform profile.
# Returns 0 on success, 1 on bad argument or write failure.
#
# Atomic write uses a SAME-DIRECTORY temp file, per qm_config_set()'s idiom — not
# mktemp, which defaults to /tmp. /tmp is tmpfs while /etc is ubi2_0, so an mv
# across them would fail with EXDEV.
#
# The destination directory is NOT created here: callers own directory creation
# (with `install -d -m 0755`, never `mkdir -p`, which no-ops on an existing
# directory and so lets a bad mode persist across every OTA). A missing parent
# makes this return 1 with no side effect.
#
# SYMLINK ATTACK, reproduced live on both devices: /etc/qmanager is owned by
# www-data, mode 0755, NON-sticky — fs.protected_symlinks=1 only guards a
# world-writable STICKY directory, so it does not cover this one at all.
# www-data can therefore plant a symlink at exactly "${dest}.tmp" (or at
# $dest itself) pointing anywhere root can write — /etc/shadow, a file under
# /etc/sudoers.d, ... A plain `>` redirect FOLLOWS a symlink, so root's write
# lands at the symlink's TARGET, not at platform.json. Confirmed live: root's
# JSON landed in the attacker-chosen file, not in platform.json.tmp.
#
# `[ -f "$path" ]` is NOT a sufficient guard here — it also FOLLOWS the
# symlink and reports true for one. Only `[ -L "$path" ]` looks at the link
# itself rather than what it points to.
#
# Checking `[ -L "$tmp" ]` and THEN opening it is still not enough on its
# own: a symlink planted in the gap between that check and the open wins the
# race. The write below instead happens inside a subshell with `set -C`
# (noclobber), which gives O_CREAT|O_EXCL semantics — the open atomically
# refuses to proceed if anything, file or symlink (live or dangling), already
# occupies that path. Verified on both BusyBox 1.31.1 and 1.29.3: `set -C`
# refuses a redirect onto a live symlink AND a dangling one, and succeeds
# cleanly onto a path with nothing there — so this closes the race, not just
# the common case.
qm_hw_write_profile() {
    local dest="$1" tmp
    [ -n "$dest" ] || return 1
    tmp="${dest}.tmp"

    # Refuse outright if the destination itself is a symlink. Never write
    # through it, and never unlink it either — deleting an attacker's link is
    # a courtesy that also destroys the evidence of the attempt.
    [ -L "$dest" ] && return 1

    # Refuse if the destination is a directory too. `mv "$tmp" "$dest"` onto
    # a directory does not fail — it moves the temp file INSIDE it
    # (".../platform.json/platform.json.tmp") and exits 0, so without this
    # guard the function would report success having written nothing at the
    # expected path, with no way for the caller to tell. That silent-success
    # shape is exactly what this whole function exists to eliminate.
    [ -d "$dest" ] && return 1

    # Something may already sit at the temp path from a previous run.
    if [ -L "$tmp" ]; then
        # A symlink here IS the attack described above. Leave it exactly as
        # found and refuse — do not delete it, do not follow it.
        return 1
    elif [ -e "$tmp" ]; then
        # A stranded REGULAR file from an earlier run that crashed between
        # the write and the mv. It is not a symlink, so clearing it cannot
        # redirect anything; leaving it in place would wedge every future
        # write behind noclobber below, so it is safe and necessary to clear.
        rm -f "$tmp" 2>/dev/null
    fi

    # Race-free create: noclobber makes the redirect fail if ANYTHING now
    # occupies $tmp, including a symlink planted after the checks above.
    if ! ( set -C; {
        printf '{\n'
        printf '  "schema": %s,\n'            "$QM_HW_SCHEMA"
        printf '  "model": "%s",\n'           "$(_qm_hw_json_escape "$(qm_hw_model)")"
        printf '  "soc": "%s",\n'             "$(_qm_hw_json_escape "$(qm_hw_soc)")"
        printf '  "form_factor": "%s",\n'     "$(_qm_hw_json_escape "$(qm_hw_form_factor)")"
        printf '  "tier": "%s",\n'            "$(_qm_hw_json_escape "$(qm_hw_tier)")"
        printf '  "fw_fingerprint": "%s",\n'  "$(_qm_hw_json_escape "$(qm_hw_fw_fingerprint)")"
        printf '  "caps": {}\n'
        printf '}\n'
    } > "$tmp" ) 2>/dev/null; then
        # If $tmp turned into a symlink mid-race, preserve it as evidence
        # rather than deleting it; otherwise it is safe (and necessary) to
        # clean up whatever partial state noclobber left behind.
        [ -L "$tmp" ] || rm -f "$tmp" 2>/dev/null
        return 1
    fi

    # Deterministic mode regardless of the caller's umask. Without this the
    # mode comes from whatever umask happened to be ambient — the live
    # RG501Q's profile was found world-writable (0666) because the install
    # shell that wrote it ran at umask 0.
    chmod 0644 "$tmp" 2>/dev/null

    # `mv` onto an existing path REPLACES it without following a symlink
    # there (verified on both devices) — but $dest was already confirmed to
    # be a non-symlink above, so this is defence in depth, not the primary
    # guard.
    if ! mv "$tmp" "$dest" 2>/dev/null; then
        rm -f "$tmp" 2>/dev/null
        return 1
    fi
    return 0
}

