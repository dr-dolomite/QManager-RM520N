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
# Two consumers: install_rm520n.sh's preflight() calls qm_hw_write_profile
# once, at install/OTA time; qmanager_setup calls qm_hw_self_heal on every
# boot to keep the profile converged in between installs. Nothing else reads
# platform.json yet — see the ADVISORY note above for why nothing should.

# ${VAR:-} form: a caller running under `set -u` must be able to source this
# library without it dying on an unset guard variable.
[ -n "${_HW_PROFILE_LOADED:-}" ] && return 0
_HW_PROFILE_LOADED=1

# Path to the Quectel vendor version file. Overridable for the test harness.
: "${QUECTEL_VERSION_FILE:=/etc/quectel-project-version}"

# Path to the self-heal decision log. Overridable for the test harness, for
# the same reason QUECTEL_VERSION_FILE above is: without it, exercising the
# self-heal log lines would mean writing into a real developer's
# /tmp/qmanager.log. On-device this is exactly the file qmanager_setup:120
# seeds root:root 0666 before this library's caller ever runs.
: "${QM_HW_LOG_FILE:=/tmp/qmanager.log}"

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

# --- Self-heal -----------------------------------------------------------
#
# The installer writes platform.json once, at preflight. Everything below
# lets qmanager_setup re-check it on every boot so a device converges onto a
# current profile without a reinstall: a schema bump (config.sh has no
# key-migration primitive, so a field added to a later schema would
# otherwise never reach an already-installed device) or a firmware
# reflash (fw_fingerprint drift) are both caught here.
#
# platform.json is a LINE-ORIENTED format — the generator above emits
# exactly one key per line. The matchers below are LINE matchers anchored on
# `^[[:space:]]*"key"[[:space:]]*:`, NOT a JSON parser. Compact single-line
# JSON (`{"schema":1,...}`) will not match at all, which reads as
# "schema absent" and regenerates. That is expected to happen ONCE — the
# regenerated file is always written in this library's own line-oriented
# format, so a second read converges. The converge check in qm_hw_self_heal
# below is what turns any other future mismatch between "what this boot
# writes" and "what this boot reads back" (an escaper change, a format
# change, ...) into one logged line instead of silently rewriting the file,
# and churning flash, on every single boot forever.

# _qm_hw_read_schema <path> — the numeric schema value on disk, or empty if
# absent / not a bare integer. Caller must validate numeric-ness before any
# arithmetic comparison — see the case-glob note below.
_qm_hw_read_schema() {
    sed -n 's/^[[:space:]]*"schema"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" 2>/dev/null | head -n 1
}

# _qm_hw_read_fw_fingerprint <path> — the JSON-ESCAPED fw_fingerprint value
# on disk, or empty. This is compared against
# _qm_hw_json_escape "$(qm_hw_fw_fingerprint)" — escaped to escaped, never
# unescaped — which round-trips correctly even for hostile values containing
# `\"` and `\\` (verified against the `hostile` fixture on both BusyBox
# versions).
_qm_hw_read_fw_fingerprint() {
    sed -n 's/^[[:space:]]*"fw_fingerprint"[[:space:]]*:[[:space:]]*"\(.*\)"[[:space:]]*,\{0,1\}[[:space:]]*$/\1/p' "$1" 2>/dev/null | head -n 1
}

# _qm_hw_regen_reason <path> — shared decision logic behind both
# qm_hw_profile_needs_write (a plain predicate) and qm_hw_self_heal (which
# also wants the human-readable reason for its success log line). On a
# "regenerate" decision (exit 0) it prints one short reason string to
# stdout; on "leave alone" / "refuse" / "deferred" (exit 1) it prints
# nothing — refuse and deferred already log for themselves via _qm_hw_log.
_qm_hw_regen_reason() {
    local path="$1" schema fw live_fw trigger=""

    # A symlink or a directory at the profile path is refused UNCONDITIONALLY
    # and checked BEFORE the absent/present test below, because `[ -e ]`
    # follows a symlink and would misreport a dangling one as "absent" —
    # which would regenerate straight over it.
    #
    # The directory arm is load-bearing on its own: if platform.json were a
    # directory, `sed` on it silently reads as empty (schema absent), so a
    # naive "not a regular file -> regenerate" here would let
    # qm_hw_write_profile's `mv` land the temp file INSIDE that directory,
    # report success, and repeat identically on every subsequent boot —
    # churning flash while every log line claims success. Refuse instead.
    if [ -L "$path" ] || [ -d "$path" ]; then
        _qm_hw_log "qm_hw_self_heal: refusing to touch $path -- it is a symlink or a directory, not a plain file"
        return 1
    fi

    if [ ! -e "$path" ]; then
        printf '%s\n' "profile absent"
        return 0
    fi

    if [ ! -r "$path" ]; then
        printf '%s\n' "profile unreadable"
        return 0
    fi

    schema=$(_qm_hw_read_schema "$path")
    case "$schema" in
        ''|*[!0-9]*)
            # Absent, empty, or not a bare non-negative integer. Validated
            # with a case glob BEFORE any -eq/-lt test: qmanager_setup has no
            # `set -e`, so comparing a non-numeric string with a numeric test
            # operator would print a shell error and behave unpredictably
            # rather than failing loudly.
            trigger="schema absent or non-numeric"
            ;;
        *)
            # Differs EITHER direction — higher or lower — regenerates. A
            # higher number is a deliberate policy, not an oversight:
            # platform.json lives in a www-data-writable directory, so a
            # planted higher schema must not be able to freeze the profile
            # permanently by looking "already migrated".
            [ "$schema" -eq "$QM_HW_SCHEMA" ] || trigger="schema $schema (want $QM_HW_SCHEMA)"
            ;;
    esac

    if [ -z "$trigger" ]; then
        fw=$(_qm_hw_read_fw_fingerprint "$path")
        live_fw=$(_qm_hw_json_escape "$(qm_hw_fw_fingerprint)")
        [ "$fw" = "$live_fw" ] || trigger="fw_fingerprint drift"
    fi

    # Everything matches -- leave alone. This is the every-boot case on a
    # converged device and stays completely silent.
    [ -n "$trigger" ] || return 1

    # A regenerate trigger fired. Before acting on it, guard against
    # clobbering a GOOD existing profile with unknowns: qm_hw_write_profile
    # re-derives every field from the live vendor file from scratch and has
    # no merge mode, so regenerating while that vendor file is unreadable
    # would overwrite a fielded profile with all-"unknown" data. Detected by
    # asking all three identity accessors at once, the same way a caller
    # would.
    #
    # This must not silently swallow a schema-bump trigger either, so the
    # deferral is logged with the trigger that caused it: a device that can
    # never migrate its schema, and never says why, is exactly the failure
    # this whole mechanism exists to prevent.
    if [ "$(qm_hw_model)" = "$QM_HW_UNKNOWN" ] && \
       [ "$(qm_hw_soc)" = "$QM_HW_UNKNOWN" ] && \
       [ "$(qm_hw_fw_fingerprint)" = "$QM_HW_UNKNOWN" ]; then
        _qm_hw_log "qm_hw_self_heal: regeneration DEFERRED ($trigger) -- live vendor file unreadable, existing profile at $path left untouched"
        return 1
    fi

    printf '%s\n' "$trigger"
    return 0
}

# qm_hw_profile_needs_write <path> — 0 = regenerate, 1 = leave alone. Thin
# predicate wrapper: discards the reason text _qm_hw_regen_reason prints so
# this stays a clean 0/1 API for a plain `if qm_hw_profile_needs_write ...`.
qm_hw_profile_needs_write() {
    _qm_hw_regen_reason "$1" >/dev/null
}

# _qm_hw_log <message> — best-effort append to QM_HW_LOG_FILE. Logging must
# never abort a caller, so every failure mode here is swallowed.
#
# journald has NO storage on either device (`journalctl` reports "No journal
# files were found" on both) and qmanager-setup.service sets no
# StandardOutput=, so anything this script writes to stdout/stderr is simply
# unobservable after the fact. This file is the only record a self-heal
# decision leaves behind. qmanager_setup:120-128 seeds it root:root 0666
# well before this library's caller runs, so no ownership/mode work belongs
# here.
_qm_hw_log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" "$1" >> "$QM_HW_LOG_FILE" 2>/dev/null
    return 0
}

# qm_hw_self_heal <dest> — the complete decide + write + verify cycle, so
# that qmanager_setup carries exactly one call. Returns 0 if the profile was
# already current, was successfully regenerated, or was correctly left
# alone (refused / deferred, both already logged by _qm_hw_regen_reason
# above); returns 1 only on a write or convergence failure. The caller is
# expected to ignore the return value (`|| true`) — this function's log
# lines are the only record of what happened.
qm_hw_self_heal() {
    local dest="$1" reason

    # Every-boot no-op path. Silent by design: this is what every converged
    # device hits on every single boot, and a log line here would mean one
    # new line in QM_HW_LOG_FILE forever. Refuse/deferred outcomes also come
    # through here (both return 1 too) and were already logged internally.
    qm_hw_profile_needs_write "$dest" || return 0

    # Capture the human-readable trigger for the log lines below. Re-running
    # the same read-only decision logic a second time is cheap — it is a
    # handful of `sed` calls over a five-to-eight-line file — and keeping
    # qm_hw_profile_needs_write a plain 0/1 predicate is worth that.
    reason=$(_qm_hw_regen_reason "$dest")

    if ! qm_hw_write_profile "$dest"; then
        _qm_hw_log "qm_hw_self_heal: write to $dest FAILED (trigger: $reason)"
        return 1
    fi

    # Converge check: confirm the just-written profile now reads back as
    # current. If it still says "regenerate", this boot's writer and this
    # boot's reader disagree about the file's format — without this check
    # that disagreement would silently rewrite $dest, and churn flash, on
    # every single future boot instead of failing loudly exactly once.
    if qm_hw_profile_needs_write "$dest"; then
        _qm_hw_log "qm_hw_self_heal: wrote $dest but it did NOT converge (trigger: $reason) -- read-back still says regenerate, see hw_profile.sh"
        return 1
    fi

    _qm_hw_log "qm_hw_self_heal: regenerated $dest (trigger: $reason)"
    return 0
}
