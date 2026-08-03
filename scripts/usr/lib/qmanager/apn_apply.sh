#!/bin/sh
# =============================================================================
# apn_apply.sh — Shared APN write-first attach-cycle primitive for QManager
# =============================================================================
# A local AT+CGDCONT rewrite never reaches the network on its own: on LTE /
# 5G-NSA the default EPS bearer's APN is a contract field carried in the
# Attach Request to the carrier's MME/PGW, not something AT+CGACT can
# renegotiate (AT+CGACT only cycles the local user-plane bearer). Every
# caller that changes an APN must (1) write AT+CGDCONT, (2) detach
# (AT+COPS=2), (3) re-attach (AT+COPS=0), and (4) confirm what the network
# actually granted via AT+CGCONTRDP — AT+CGDCONT? only echoes back what was
# asked for, not what was negotiated, so it can never verify an apply.
#
# CANONICAL ORDER (write-first, then detach, then attach) — deliberately
# differs from the older detach-first bracket some callers used to inline.
# Write-first is safer: if AT+CGDCONT itself fails, we have never detached,
# so the failure path returns with the modem untouched and still registered,
# instead of recovering from an already-deregistered state.
#
#   AT+CGDCONT=<cid>,"<pdp_type>","<apn>"   sleep 3
#   AT+COPS=2                                sleep 1
#   AT+COPS=0                                sleep 3
#
# AT+QICSGP (auth) is NEVER written by this primitive — it has no concept of
# username/password/authtype, and the profile schema carries no auth fields
# either. Callers that need auth (apn.sh's legacy 6-slot save) write QICSGP
# themselves, sequenced around this primitive's call. AT+CGAUTH is not used
# anywhere — confirmed unsupported on this firmware (returns ERROR).
#
# UID-AGNOSTIC BY DESIGN — this primitive does NOT touch
# /tmp/qmanager_recovery_active. Whether that flag is raised at all is left
# entirely to the caller, through the optional bracket hooks further down.
#
# Why the flag is the caller's problem, stated correctly (the earlier version
# of this note was both incomplete and wrong about who owns the flag):
#
#   1. /tmp is root-owned, mode 1777 (sticky). Only a file's owner or root may
#      unlink or rename over an entry there, whatever the file's own mode. So
#      a cross-UID `rm -f` on the flag silently no-ops (`-f` exits 0 and the
#      file stays), orphaning the flag "on" and permanently muting alert and
#      event dispatch.
#   2. INDEPENDENTLY of the sticky bit, this kernel runs with
#      fs.protected_regular=1: in a world-writable sticky directory, opening
#      another UID's regular file for WRITE is denied unless
#      file_owner == dir_owner (i.e. the file is root-owned, matching /tmp) or
#      caller == file_owner. Root gets NO override — a root process cannot
#      write a www-data-owned file in /tmp either. This is why `chmod 0666` is
#      not a fix: mode is not the gate here, ownership is. Verified by live
#      probe on the device, both directions.
#      The only ownership under which BOTH UIDs can write a shared /tmp file
#      is root:root 0666 (which is how /tmp/qmanager.log is seeded at install).
#   3. Consequence for anything that writes such a file: tmp-file + `mv` is
#      forbidden. rename() swaps the inode, so the first writer to use it
#      destroys the shared ownership and replaces it with its own UID at its
#      own umask. Shared ownership and rename-atomicity are mutually exclusive
#      in /tmp. Writers must truncate-and-rewrite through the existing inode.
#
# NOT AN INVARIANT: the old note claimed the flag was "created, owned and
# cleared EXCLUSIVELY by qmanager_profile_apply (the root worker)". That was
# never enforced and is not true — qmanager_profile_apply runs as ROOT when the
# poller/watchcat spawn it, but as WWW-DATA when profiles/apply.sh spawns it
# (no sudo, not setuid, no sudoers grant), so the "single UID owns the flag"
# assumption breaks on the UI path. That worker therefore verifies flag
# ownership by reading the flag back rather than assuming it.
# The www-data CGI paths (apn.sh, profiles/deactivate.sh) call this
# primitive WITHOUT any recovery-flag suppression — same as apn.sh's status
# quo today (its inline COPS cycles never suppressed anything either), so
# this is not a regression for user-initiated saves.
#
# DEPENDENCY CONTRACT (mirrors ttl_state.sh's platform.sh note): the caller
# MUST have already sourced, in this order, before sourcing this file:
#   1. qlog.sh (or its no-op shims: qlog_warn/qlog_info at minimum)
#   2. cgi_at.sh (for run_at / parse_cgcontrdp_apn)
#   3. events.sh, with EVENTS_FILE and MAX_EVENTS set beforehand (or the
#      caller's own no-op `append_event() { :; }` shim)
# This lib does NOT source any of those itself, to avoid double-loading
# side effects — same convention ttl_state.sh documents for platform.sh.
#
# Install location: /usr/lib/qmanager/apn_apply.sh
# =============================================================================

[ -n "$_APN_APPLY_LOADED" ] && return 0
_APN_APPLY_LOADED=1

# Ensure qlog_warn/qlog_info are no-ops if sourced before logging is ready.
command -v qlog_warn >/dev/null 2>&1 || qlog_warn() { :; }
command -v qlog_info >/dev/null 2>&1 || qlog_info() { :; }
command -v append_event >/dev/null 2>&1 || append_event() { :; }

# --- Constants ---------------------------------------------------------------
# User-specified, hardware-verified bracket timings. Do NOT retune without
# re-verifying on device — these are the canonical sleeps, not a guess.
APN_APPLY_SLEEP_AFTER_WRITE=3     # after AT+CGDCONT, before AT+COPS=2
APN_APPLY_SLEEP_AFTER_DETACH=1    # after AT+COPS=2, before AT+COPS=0
APN_APPLY_SLEEP_AFTER_ATTACH=3    # after AT+COPS=0, before verification

APN_APPLY_ATTACH_RETRIES=3        # bounded retry count for AT+COPS=0
APN_APPLY_ATTACH_BACKOFF=3        # seconds between AT+COPS=0 retries
# Hardware-measured on a live RM520N-GL (GLOBE SIM): re-attach completed and
# the negotiated APN became readable via AT+CGCONTRDP at +1.25s after
# AT+COPS=0 returned OK, worst observed case ~4s across runs. 15s/1s gives
# ~10x headroom over the worst case without wasting half the typical wait
# on a coarse interval (the original 20s/2s design figures were guesswork,
# made before this was measured on device).
APN_APPLY_VERIFY_TIMEOUT=15       # seconds, hard ceiling on the CGCONTRDP poll
APN_APPLY_VERIFY_INTERVAL=1       # seconds between CGCONTRDP polls

# Bracket-level advisory lock — SEPARATE from /tmp/qmanager_at.lock (qcmd's
# own per-command lock). Reusing qcmd's lock here would deadlock: this
# primitive calls qcmd for every AT command WHILE it would be holding the
# bracket lock, and qcmd itself needs to acquire /tmp/qmanager_at.lock for
# each of those calls. qcmd's flock only serializes a single AT command, not
# a multi-command bracket, and AT+COPS=2/AT+COPS=0 is global attach state,
# not per-CID — two processes (apn.sh as www-data, qmanager_profile_apply as
# root) could otherwise each run a full bracket concurrently and corrupt
# each other's detach/verify window. This lock makes the whole
# write-detach-attach-verify sequence mutually exclusive across both.
APN_APPLY_BRACKET_LOCK="/tmp/qmanager_apn_apply.lock"
# ~8s of sleeps plus a bounded verify poll (worst case ~15s) is the measured
# shape of one full bracket; 30s gives headroom for a slow AT round-trip
# without a caller waiting indefinitely. This is the unattended root worker's
# (qmanager_profile_apply) default — nothing is blocked on it, so it should
# win the retry. The synchronous CGI paths (apn.sh, profiles/deactivate.sh)
# override this to a ~5s ceiling by setting APN_APPLY_LOCK_WAIT BEFORE
# sourcing this file (the default-assignment below only evaluates once, on
# first source — see _APN_APPLY_LOADED guard above), so a human waiting on
# the HTTP response never blocks for the full 30s. A caller that does not
# override gets this 30s default.
APN_APPLY_LOCK_WAIT="${APN_APPLY_LOCK_WAIT:-30}"

# 1 while a caller holds the bracket lock via apn_apply_lock() (see the
# "LOCK LEASE" section below). apn_apply_write() consults this to skip both
# acquiring and releasing the lock, so a leased bracket takes exactly one
# lock and the caller decides when it ends.
APN_APPLY_LOCK_EXTERNAL=0

# =============================================================================
# _apn_apply_lock_acquire — bounded poll for the bracket-level advisory lock
# =============================================================================
# BusyBox flock has NO -w (timeout) option — same constraint qcmd's own
# flock_wait() already works around (scripts/usr/bin/qcmd ~:116-131). Reuses
# that exact poll idiom: flock -x -n in a 1s loop up to APN_APPLY_LOCK_WAIT,
# then one final try. Opens the lock file read-only on fd 8 (not `exec 8>`,
# which would truncate — irrelevant to flock's inode-based lock, but needless
# churn on a file two different UIDs share). Mode 666 mirrors how
# /tmp/qmanager_at.lock is made usable by both root and www-data.
# Returns 0 once the lock is held, 1 if every attempt timed out (fd 8 is
# left open either way; the caller must still call _apn_apply_lock_release
# on the failure path since opening the fd itself always succeeds).
_apn_apply_lock_acquire() {
    [ -f "$APN_APPLY_BRACKET_LOCK" ] || touch "$APN_APPLY_BRACKET_LOCK" 2>/dev/null
    chmod 666 "$APN_APPLY_BRACKET_LOCK" 2>/dev/null
    exec 8<"$APN_APPLY_BRACKET_LOCK" 2>/dev/null || return 1

    local _elapsed=0
    while [ "$_elapsed" -lt "$APN_APPLY_LOCK_WAIT" ]; do
        if flock -x -n 8 2>/dev/null; then
            return 0
        fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done
    # One final try (mirrors qcmd's flock_wait behavior).
    flock -x -n 8 2>/dev/null
}

# _apn_apply_lock_release — release the bracket lock and close fd 8.
_apn_apply_lock_release() {
    flock -u 8 2>/dev/null
    exec 8<&- 2>/dev/null
}

# =============================================================================
# LOCK LEASE — apn_apply_lock / apn_apply_unlock (PUBLIC)
# =============================================================================
# For the one caller that must land its OWN modem write inside the same
# critical section as the bracket: apn.sh's legacy 6-slot save writes
# AT+QICSGP (auth) before apn_apply_write, because QICSGP must precede the
# detach for the single re-attach to carry the new credentials. AT+QICSGP
# ALSO (re)writes the context's APN — so if it runs outside the lock and
# apn_apply_write then returns rc=7 (apn_busy), the configured APN has moved
# with NO attach cycle behind it, while the caller was told "modem unchanged,
# no AT commands issued." That is precisely the configured != negotiated
# split this whole library exists to eliminate, reintroduced through the back
# door of a partial write. Verified on a live RM520N-GL.
#
# The lease closes it: the caller takes the lock FIRST, so a busy modem is
# reported before any write happens, and its QICSGP write is serialized
# against every other bracket exactly like the CGDCONT write is.
#
#   apn_apply_lock || die "apn_busy" "..."   # nothing written yet
#   run_at "AT+QICSGP=..."  || die ...       # inside the critical section
#   apn_apply_write "$cid" "$pdp" "$apn"     # reuses the held lock
#   apn_apply_unlock
#
# A caller that does NOT lease (qmanager_profile_apply, apn.sh's deactivate
# and WS6 branches, profiles/deactivate.sh) is completely unaffected —
# APN_APPLY_LOCK_EXTERNAL stays 0 and apn_apply_write acquires and releases
# the lock itself, exactly as before.
#
# Leaks are bounded by process lifetime, not by discipline: the lock lives on
# fd 8, and the kernel drops a flock when the last fd referencing that open
# file description closes. Every CGI failure path here is `die`, which exits,
# so an un-unlocked lease cannot outlive the request that took it.
#
# apn_apply_lock returns 0 with the lock held, or 1 on timeout (nothing held,
# fd closed). It does NOT set APN_APPLY_* — the caller decides how a busy
# modem surfaces, since at lease time there is no bracket result to report.
apn_apply_lock() {
    if ! _apn_apply_lock_acquire; then
        _apn_apply_lock_release
        APN_APPLY_LOCK_EXTERNAL=0
        return 1
    fi
    APN_APPLY_LOCK_EXTERNAL=1
    return 0
}

# apn_apply_unlock — end a lease. Safe to call when no lease is held.
apn_apply_unlock() {
    [ "$APN_APPLY_LOCK_EXTERNAL" = "1" ] || return 0
    APN_APPLY_LOCK_EXTERNAL=0
    _apn_apply_lock_release
}

# =============================================================================
# _apn_apply_finish — shared trap-restore + lock-release + end-hook call
# =============================================================================
# Every return path taken AFTER the bracket lock is successfully acquired
# must release the lock, restore the borrowed INT/TERM trap, AND (if the
# matching start hook ran) call the optional apn_apply_on_bracket_end hook —
# in that order does not matter for correctness, but consolidating the three
# into one call site means a future return path cannot forget one of them.
# See apn_apply_write()'s hook note below for what the hooks are for.
# Under a lease (APN_APPLY_LOCK_EXTERNAL=1) the lock is NOT released here —
# it belongs to the caller, who took it before its own pre-bracket write and
# ends it with apn_apply_unlock. Releasing it here would drop the mutex while
# that caller still believes it holds one. The trap restore and the end hook
# are unconditional: both are owned by this bracket, not by the lease.
_apn_apply_finish() {
    _apn_apply_trap_restore
    [ "$APN_APPLY_LOCK_EXTERNAL" = "1" ] || _apn_apply_lock_release
    command -v apn_apply_on_bracket_end >/dev/null 2>&1 && apn_apply_on_bracket_end
}

# --- Internal state for the signal trap --------------------------------------
# 1 once AT+COPS=2 has succeeded and we have not yet successfully re-attached.
# The INT/TERM trap reads this to decide whether it owes the modem a re-attach.
_apn_apply_detached=0

# =============================================================================
# _apn_apply_reattach — bounded retry/backoff around AT+COPS=0
# =============================================================================
# Returns 0 once AT+COPS=0 returns OK, 1 if every attempt failed. Always
# clears _apn_apply_detached on return (success OR exhaustion) so a later
# signal does not re-enter this loop a second time for the same bracket.
_apn_apply_reattach() {
    local _i=0
    local _rc=1
    while [ "$_i" -lt "$APN_APPLY_ATTACH_RETRIES" ]; do
        if run_at "AT+COPS=0" >/dev/null 2>&1; then
            _rc=0
            break
        fi
        _i=$((_i + 1))
        [ "$_i" -lt "$APN_APPLY_ATTACH_RETRIES" ] && sleep "$APN_APPLY_ATTACH_BACKOFF"
    done
    _apn_apply_detached=0
    return "$_rc"
}

# =============================================================================
# _apn_apply_trap_handler — INT/TERM safety net between detach and re-attach
# =============================================================================
# Traps only INT/TERM ("trap is limited — consolidate signals", the house
# convention already used by qmanager_profile_apply). Does NOT touch any
# recovery flag — that is the caller's responsibility (see UID-AGNOSTIC note
# above); this handler's ONLY job is to not leave the modem deregistered.
# SIGKILL and power loss CANNOT be trapped: if either happens between
# AT+COPS=2 succeeding and AT+COPS=0 succeeding, the modem is left
# deregistered with no automatic recovery from THIS script. The device is
# not bricked — qmanager_watchcat's own health check will eventually notice
# no service and run its own Tier 1 (AT+COPS=2/AT+COPS=0) recovery — but
# that is on watchcat's poll cadence, not immediate, and the device has no
# WAN for the gap in between.
_apn_apply_trap_handler() {
    if [ "$_apn_apply_detached" = "1" ]; then
        qlog_warn "apn_apply: caught signal mid-bracket, forcing re-attach"
        _apn_apply_reattach
    fi
}

# =============================================================================
# _apn_apply_trap_restore — release the INT/TERM trap this function borrowed
# =============================================================================
# `trap - INT TERM` resets the signal to the shell's DEFAULT disposition —
# it does NOT restore whatever handler the caller had installed before
# calling in (e.g. qmanager_profile_apply's `trap cleanup EXIT INT TERM`).
# This lib deliberately does NOT attempt to snapshot/replay the caller's
# prior trap (BusyBox ash's `trap` introspection is unreliable, and the
# project convention is to consolidate signal handling in one owner — see
# platform notes). Instead: this function guarantees the primitive itself
# is left in a clean, un-armed state on every return path, and any caller
# that owns a process-wide trap of its own (qmanager_profile_apply does;
# the CGI callers, apn.sh and profiles/deactivate.sh, do not) is responsible
# for re-asserting it immediately after calling apn_apply_write returns.
# qmanager_profile_apply's apply_apn() does exactly that
# (`trap cleanup EXIT INT TERM` right after the apn_apply_write call).
_apn_apply_trap_restore() {
    trap - INT TERM
}

# =============================================================================
# apn_apply_write <cid> <pdp_type_at> <apn> [allow_empty]
# =============================================================================
# <pdp_type_at> is AT vocabulary (IP/IPV6/IPV4V6), not the frontend's
# ipv4/ipv6/ipv4v6 — callers convert before calling in (see apn.sh's
# pdp_to_at()).
#
# Sets on every call: APN_APPLY_STATUS, APN_APPLY_DETAIL,
# APN_APPLY_NEGOTIATED_APN, APN_APPLY_RC. Returns the same value as
# APN_APPLY_RC (belt-and-suspenders for `$?` callers).
#
# Does NOT manage /tmp/qmanager_recovery_active — see the UID-AGNOSTIC note
# in the file header for the sticky-bit AND fs.protected_regular rules that
# make that flag a cross-UID hazard. A caller that wants recovery-flag
# suppression (only qmanager_profile_apply does) must set/clear it itself
# around this call — in practice by defining the optional hooks below, not by
# touching the flag inline before calling in (see the ordering note next) —
# and must verify it actually owns the flag rather than assuming it, since
# that caller runs as root on the poller/watchcat path and as www-data on the
# profiles/apply.sh path.
#
# OPTIONAL HOOKS — apn_apply_on_bracket_start / apn_apply_on_bracket_end:
# feature-detected via `command -v` (the same idiom qmanager_profile_apply
# already uses for scenario_install_schedule etc.), never required. If
# defined, apn_apply_on_bracket_start is called ONCE the bracket lock is
# actually held and BEFORE the first AT command; apn_apply_on_bracket_end is
# called on every return path taken after that point (rc 0/1/2/3/4/5), via
# the shared _apn_apply_finish helper. Neither hook runs for rc=6
# (skipped_empty_apn) or rc=7 (apn_busy) — both return before the lock is
# ever held, so no AT command was ever going to run and there is nothing to
# suppress. This is what lets qmanager_profile_apply raise
# /tmp/qmanager_recovery_active only once a bracket is actually about to
# touch the modem, instead of while merely waiting on the lock — this
# library still knows NOTHING about that flag (nor about which UID the hook
# will run as, which is not fixed); it only knows an optional callback might
# exist.
#
# Return-code contract:
#   0  done / done_carrier_default — verified: negotiated APN matches request
#      (or, for a deliberate blank-APN revert, the carrier assigned SOME
#      default). Modem left attached, correct.
#   1  failed_cgdcont     — AT+CGDCONT write itself returned ERROR. Modem
#                            NEVER detached — untouched, still registered.
#   2  failed_detach      — AT+COPS=2 itself failed. Modem UNCHANGED (write
#                            already landed locally, but never took effect).
#   3  failed_attach      — AT+COPS=0 failed on every retry. Modem left
#                            DEREGISTERED — critical, see trap note above.
#   4  mismatch           — re-attached and verified, but the negotiated APN
#                            differs from the requested one: this apply did
#                            NOT take. Modem attached, but not on the
#                            requested APN.
#   5  timeout_verify     — re-attached, but no +CGCONTRDP data appeared
#                            before the poll ceiling. Modem attached, state
#                            unconfirmed (ambiguous — may have worked).
#   6  skipped_empty_apn  — empty APN and allow_empty not set. NO AT commands
#                            issued at all. Modem unchanged.
#   7  apn_busy           — another apn_apply_write bracket (in this process
#                            or another) is already in progress; the bracket
#                            lock could not be acquired within
#                            APN_APPLY_LOCK_WAIT seconds. NO AT commands
#                            issued at all. Modem unchanged. Caller should
#                            surface this as "try again shortly", not a
#                            hard failure. UNREACHABLE under a lock lease
#                            (APN_APPLY_LOCK_EXTERNAL=1) — the lock was
#                            already taken by apn_apply_lock, which reports
#                            the busy case to the caller instead. A caller
#                            whose own modem write precedes this call MUST
#                            lease, or "modem unchanged" here is a lie about
#                            that earlier write; see the LOCK LEASE section.
#
# APN comparisons (skip-check callers, and the done-vs-mismatch decision
# below) MUST case-fold before comparing — APNs are DNS-style labels and are
# case-insensitive per 3GPP (a live device returned "INTERNET.GLOBE.COM.PH"
# uppercase for a profile that stored "internet"). Fold only for the
# comparison; APN_APPLY_NEGOTIATED_APN and every reported detail string keep
# the ORIGINAL casing the network returned.
# =============================================================================
apn_apply_write() {
    local _cid="$1"
    local _pdp="$2"
    local _apn="$3"
    local _allow_empty="${4:-0}"

    APN_APPLY_STATUS=""
    APN_APPLY_DETAIL=""
    APN_APPLY_NEGOTIATED_APN=""
    APN_APPLY_RC=0

    # --- Empty-APN guard: refuse to bracket-cycle a silently-blank APN ------
    # profile_mgr.sh validates only cid/pdp_type, not apn_name — a legitimate
    # IMEI-only or TTL-only profile can carry an empty APN. Force-attaching
    # on a blanked APN would drop the WAN for real, so this must be an
    # explicit opt-in (allow_empty=1) reserved for a deliberate "revert to
    # carrier default" caller (apn.sh's deactivate action, profiles/
    # deactivate.sh's revert), never the default path.
    if [ -z "$_apn" ] && [ "$_allow_empty" != "1" ]; then
        APN_APPLY_STATUS="skipped_empty_apn"
        APN_APPLY_DETAIL="No APN configured; skipped (no modem write, no detach)"
        APN_APPLY_RC=6
        return 6
    fi

    # --- Bracket-level advisory lock: serialize against any OTHER caller of
    # this primitive (apn.sh as www-data, qmanager_profile_apply as root) so
    # two full write-detach-attach-verify brackets never interleave.
    # Skipped entirely under a lease — the caller already holds this exact
    # lock (see the LOCK LEASE section above), so re-acquiring would be a
    # self-deadlock: flock is per open-file-description, and the second
    # `exec 8<` would open a NEW description that blocks on the caller's own.
    if [ "$APN_APPLY_LOCK_EXTERNAL" != "1" ] && ! _apn_apply_lock_acquire; then
        _apn_apply_lock_release
        APN_APPLY_STATUS="apn_busy"
        APN_APPLY_DETAIL="Another APN apply is already in progress; try again shortly"
        APN_APPLY_RC=7
        return 7
    fi

    _apn_apply_detached=0
    trap _apn_apply_trap_handler INT TERM

    # Lock is held as of here — the bracket is actually about to start, so
    # this is the correct moment for a caller-defined start hook (e.g.
    # qmanager_profile_apply raising its recovery flag). Must land BEFORE the
    # first AT command below.
    command -v apn_apply_on_bracket_start >/dev/null 2>&1 && apn_apply_on_bracket_start

    append_event "apn_apply_started" \
        "Applying APN change (CID ${_cid}) — brief WAN interruption expected" "info"

    # --- Step 1: write (write-first — nothing detached yet) -----------------
    if ! run_at "AT+CGDCONT=${_cid},\"${_pdp}\",\"${_apn}\"" >/dev/null; then
        _apn_apply_finish
        APN_APPLY_STATUS="failed_cgdcont"
        APN_APPLY_DETAIL="AT+CGDCONT failed for CID ${_cid} — modem untouched, still registered"
        APN_APPLY_RC=1
        return 1
    fi
    sleep "$APN_APPLY_SLEEP_AFTER_WRITE"

    # --- Step 2: detach -------------------------------------------------------
    if ! run_at "AT+COPS=2" >/dev/null; then
        _apn_apply_finish
        APN_APPLY_STATUS="failed_detach"
        APN_APPLY_DETAIL="AT+COPS=2 (deregister) failed for CID ${_cid} — modem unchanged"
        APN_APPLY_RC=2
        return 2
    fi
    _apn_apply_detached=1
    sleep "$APN_APPLY_SLEEP_AFTER_DETACH"

    # --- Step 3: re-attach (bounded retry/backoff) ------------------------------
    if ! _apn_apply_reattach; then
        _apn_apply_finish
        APN_APPLY_STATUS="failed_attach"
        APN_APPLY_DETAIL="AT+COPS=0 failed after ${APN_APPLY_ATTACH_RETRIES} attempts — modem may be DEREGISTERED"
        APN_APPLY_RC=3
        append_event "apn_apply_critical" \
            "APN apply on CID ${_cid} left the modem deregistered after ${APN_APPLY_ATTACH_RETRIES} re-attach attempts" \
            "error"
        return 3
    fi
    sleep "$APN_APPLY_SLEEP_AFTER_ATTACH"

    # --- Step 4: verify (bounded poll of the NEGOTIATED view) -------------------
    local _waited=0
    local _rdp=""
    local _negotiated=""
    while [ "$_waited" -lt "$APN_APPLY_VERIFY_TIMEOUT" ]; do
        _rdp=$(run_at "AT+CGCONTRDP=${_cid}")
        [ -n "$_rdp" ] && _negotiated=$(parse_cgcontrdp_apn "$_rdp")
        [ -n "$_negotiated" ] && break
        sleep "$APN_APPLY_VERIFY_INTERVAL"
        _waited=$((_waited + APN_APPLY_VERIFY_INTERVAL))
    done

    _apn_apply_finish
    APN_APPLY_NEGOTIATED_APN="$_negotiated"

    if [ -z "$_negotiated" ]; then
        APN_APPLY_STATUS="timeout_verify"
        APN_APPLY_DETAIL="Re-attached but AT+CGCONTRDP returned no data after ${_waited}s"
        APN_APPLY_RC=5
        return 5
    fi

    # Deliberate blank-APN revert (allow_empty=1, apn=""): don't string-
    # compare — an empty request can never equal a real negotiated value.
    if [ -z "$_apn" ]; then
        APN_APPLY_STATUS="done_carrier_default"
        APN_APPLY_DETAIL="Reverted to carrier default; network negotiated ${_negotiated} (CID ${_cid})"
        APN_APPLY_RC=0
        append_event "apn_apply_done" "CID ${_cid} reverted to carrier default (${_negotiated})" "info"
        return 0
    fi

    # Case-fold ONLY for the comparison — APNs are DNS-style labels, case-
    # insensitive per 3GPP (a live device negotiated "INTERNET.GLOBE.COM.PH"
    # uppercase for a profile stored as "internet"; a byte-for-byte compare
    # would report a permanent mismatch for a save that actually succeeded).
    # APN_APPLY_NEGOTIATED_APN and every detail string below keep the
    # ORIGINAL casing the network returned.
    local _negotiated_fold _apn_fold
    _negotiated_fold=$(printf '%s' "$_negotiated" | tr 'A-Z' 'a-z')
    _apn_fold=$(printf '%s' "$_apn" | tr 'A-Z' 'a-z')

    if [ "$_negotiated_fold" = "$_apn_fold" ]; then
        APN_APPLY_STATUS="done"
        APN_APPLY_DETAIL="APN negotiated: ${_negotiated} (CID ${_cid})"
        APN_APPLY_RC=0
        append_event "apn_apply_done" "APN ${_negotiated} confirmed on CID ${_cid}" "info"
        return 0
    fi

    APN_APPLY_STATUS="mismatch"
    APN_APPLY_DETAIL="Requested ${_apn}, network negotiated ${_negotiated} — apply did not take"
    APN_APPLY_RC=4
    append_event "apn_apply_mismatch" \
        "Requested APN ${_apn} on CID ${_cid} but network negotiated ${_negotiated}" "warning"
    return 4
}
