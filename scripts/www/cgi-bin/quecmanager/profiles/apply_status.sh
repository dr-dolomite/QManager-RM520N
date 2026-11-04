#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# apply_status.sh — CGI Endpoint: Profile Apply Status
# =============================================================================
# Returns the current state of a profile application in progress.
# Reads directly from /tmp/qmanager_profile_state.json (written by the
# apply script). Zero modem interaction.
#
# Also detects if the apply process has died unexpectedly (PID gone but
# status still "applying") and corrects the state.
#
# Endpoint: GET /cgi-bin/quecmanager/profiles/apply_status.sh
# Response: Contents of /tmp/qmanager_profile_state.json
#       or: {"status":"idle"} if no apply has been run
#
# Install location: /www/cgi-bin/quecmanager/profiles/apply_status.sh
# =============================================================================

# --- Configuration -----------------------------------------------------------
STATE_FILE="/tmp/qmanager_profile_state.json"
PID_FILE="/tmp/qmanager_profile_apply.pid"

qlog_init "cgi_apply_status"
cgi_headers
cgi_handle_options

# --- Staleness ceiling for an "applying" state -------------------------------
# Belt-and-braces on top of the pid_alive check below. pid_max on this device
# is 32768 and the churn was MEASURED at ~100 PIDs/s (sampled from
# /proc/loadavg over 90s), so the PID space wraps in ~325s: a dead apply whose
# PID has since been handed to an unrelated process reads as "still alive"
# forever, and the watchdog never fires. The worker rewrites the state file on
# every step transition, so an "applying" state whose file has not been touched
# in this many seconds is dead no matter what the PID says.
#
# 300 is deliberately NOT the 120 used for APN_RECOVERY_FLAG_MAX_AGE, and the
# two must not be unified. That one bounds a single APN bracket (seconds), so
# it can sit far below the wrap. This one bounds an ENTIRE profile apply, which
# legitimately includes the ~60s IMEI reboot wait — so its floor is "longer
# than the slowest real apply", and lowering it to 120 would declare healthy
# applies dead. It is bounded above by the wrap (300 < 325), which is a thin
# margin but a safe direction: the worst case is that a false "applying"
# persists for at most 300s before the mtime ceiling clears it anyway.
# Re-measure the churn before changing either number.
# (Age is only trusted when positive — the device boots at 1970 and
# ql_time_daemon steps the clock ~24s in, which can make a file written before
# the step look arbitrarily old or the arithmetic go negative.)
STALE_APPLY_AGE=300

# --- In-place state write (INODE-PRESERVING — never mv) ----------------------
# The previous implementation wrote "${STATE_FILE}.tmp" and renamed it over
# the target. As www-data that rename ALWAYS failed against the root-owned
# state file (/tmp is root-owned mode 1777 — sticky — so only the owner or
# root may replace an entry), which made this whole watchdog dead code on the
# UI path. Worse, on the paths where it DID succeed it swapped the inode and
# so destroyed the shared root:root 0666 ownership that
# fs.protected_regular=1 requires for both UIDs to keep writing this file.
# So the write goes through the existing inode. No intermediate file is used:
# the JSON is already fully built in a shell variable, and a "${STATE_FILE}.tmp"
# in /tmp would just be a second cross-UID ownership hazard.
# Returns 1 (and logs) if the write was refused.
write_state_inplace() {
    if printf '%s\n' "$1" > "$STATE_FILE" 2>/dev/null; then
        return 0
    fi
    qlog_warn "Could not update $STATE_FILE (owner/permission denied; expected root:root 0666) — apply watchdog cannot correct the state"
    return 1
}

# --- File age in seconds, or -1 if it cannot be determined -------------------
state_file_age() {
    local _mtime _now
    _mtime=$(stat -c %Y "$STATE_FILE" 2>/dev/null)
    [ -z "$_mtime" ] && { echo -1; return 0; }
    _now=$(date +%s)
    echo $((_now - _mtime))
}

# --- Case 1: No state file — nothing has been applied yet --------------------
if [ ! -f "$STATE_FILE" ]; then
    jq -n '{"status":"idle"}'
    exit 0
fi

# --- Case 1b: State file exists but is EMPTY — the boot seed, never used ------
# qmanager_setup pre-creates this file (root:root 0666) on every boot so both
# root daemons and www-data CGI can write the SAME inode — see the
# write_state_inplace note above. That seed makes `-f` above permanently true,
# so existence alone no longer distinguishes "seeded, never applied" from "has
# real apply state". A zero-byte file is unambiguously the former: no writer
# ever produces an empty state, and a torn read of a real write still has bytes.
#
# This MUST stay ahead of the parse/staleness branch below. An empty file fails
# `jq -e .`, and its mtime is boot time — which on this device means Jan 1970
# until ql_time_daemon steps the clock ~24s in, so the computed age is ~1.79e9
# and clears STALE_APPLY_AGE unconditionally. Ordered the other way, every user
# who opens the profiles page after a reboot without ever applying anything
# sees a phantom "failed" apply.
#
# Precedent: cgi_base.sh:172 (serve_ndjson_as_array) guards with
# `[ -f ] && [ -s ]` for exactly this reason.
if [ ! -s "$STATE_FILE" ]; then
    jq -n '{"status":"idle"}'
    exit 0
fi

# --- Case 2: State file exists — validate before trusting it -----------------
# Giving up rename-atomicity (see write_state_inplace above) means a poll can
# land in the middle of a truncate-and-rewrite and read a partial file. This
# endpoint must never forward those bytes: the frontend parses the body as
# ProfileApplyState, so malformed JSON would surface as a hard failure of an
# apply that is actually progressing normally. Degrade to a valid envelope
# instead, and let the staleness ceiling bound how long we keep saying
# "applying" if the file turns out to be permanently corrupt rather than
# merely half-written.
if ! jq -e . "$STATE_FILE" >/dev/null 2>&1; then
    AGE=$(state_file_age)
    if [ "$AGE" -ge "$STALE_APPLY_AGE" ] 2>/dev/null; then
        qlog_warn "State file $STATE_FILE is unreadable and ${AGE}s stale — reporting failed"
        DEGRADED_STATUS="failed"
        DEGRADED_ERROR="Apply state file is unreadable"
    else
        qlog_warn "State file $STATE_FILE did not parse (likely a torn read mid-write) — reporting in-progress"
        DEGRADED_STATUS="applying"
        DEGRADED_ERROR=""
    fi
    jq -n \
        --arg status "$DEGRADED_STATUS" \
        --arg error "$DEGRADED_ERROR" \
        --argjson started "$(date +%s)" \
        '{
            status: $status,
            profile_id: "",
            profile_name: "",
            started_at: $started,
            current_step: 0,
            total_steps: 4,
            steps: [
                {name: "apn",      status: "pending", detail: ""},
                {name: "ttl_hl",   status: "pending", detail: ""},
                {name: "scenario", status: "pending", detail: ""},
                {name: "imei",     status: "pending", detail: ""}
            ],
            requires_reboot: false,
            error: (if $error == "" then null else $error end)
        }'
    exit 0
fi

# Check for an orphaned "applying" state (process died mid-apply).
STATE_STATUS=$(jq -r '.status // empty' "$STATE_FILE" 2>/dev/null)

if [ "$STATE_STATUS" = "applying" ]; then
    APPLY_DEAD=0
    if [ -f "$PID_FILE" ]; then
        APPLY_PID=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$APPLY_PID" ] && ! pid_alive "$APPLY_PID"; then
            # Process died but state says "applying"
            APPLY_DEAD=1
        else
            # PID looks alive — but it may be a recycled PID (see
            # STALE_APPLY_AGE above), so fall back to the mtime ceiling.
            AGE=$(state_file_age)
            if [ "$AGE" -ge "$STALE_APPLY_AGE" ] 2>/dev/null; then
                qlog_warn "Apply state untouched for ${AGE}s while PID $APPLY_PID still resolves — treating as dead (PID likely recycled)"
                APPLY_DEAD=1
            fi
        fi
    else
        # No PID file but state says "applying" — process exited and cleaned up
        # but never wrote a final state.
        APPLY_DEAD=1
    fi

    if [ "$APPLY_DEAD" = "1" ]; then
        FAILED_JSON=$(jq '.status = "failed"' "$STATE_FILE" 2>/dev/null)
        if [ -n "$FAILED_JSON" ]; then
            write_state_inplace "$FAILED_JSON"
        else
            qlog_warn "Could not build failed-state JSON from $STATE_FILE"
        fi
        # Best-effort: as www-data this cannot unlink a root-owned PID file in
        # sticky /tmp, and rm -f reports success anyway. Not load-bearing —
        # the state file is now "failed", so this branch is not re-entered.
        rm -f "$PID_FILE" 2>/dev/null
    fi
fi

# Serve the file — re-reading and RE-VALIDATING, not re-`cat`ing blindly.
#
# The parse at the top of Case 2 does not cover this point. Several subprocess
# calls run between there and here (jq for the status, the PID read, pid_alive,
# possibly a write_state_inplace), and write_state() in qmanager_profile_apply
# rewrites this file through the same inode on EVERY step transition — which is
# exactly the window this endpoint is being polled in. A `>` truncates the file
# to zero bytes before the new content lands, so a poll arriving in that
# instant would serve an empty 200 body. The frontend parses the body as
# ProfileApplyState, so that reads as a hard failure of an apply that is in
# fact progressing normally: the same class of bug as the double-JSON one this
# repo shipped in profiles/deactivate.sh, just manifesting as zero JSON
# instead of two.
#
# The torn window is sub-millisecond, so an immediate re-read almost always
# lands clean; three attempts is generous. If all three are torn, fall back to
# the same honest "still applying" envelope Case 2 uses — never a partial body.
SERVE_BODY=""
_try=0
while [ "$_try" -lt 3 ]; do
    SERVE_BODY=$(cat "$STATE_FILE" 2>/dev/null)
    if printf '%s' "$SERVE_BODY" | jq -e . >/dev/null 2>&1; then
        printf '%s\n' "$SERVE_BODY"
        exit 0
    fi
    _try=$(( _try + 1 ))
done

qlog_warn "State file $STATE_FILE was torn on 3 consecutive reads — reporting in-progress rather than serving a partial body"
jq -n \
    --argjson started "$(date +%s)" \
    '{
        status: "applying",
        profile_id: "",
        profile_name: "",
        started_at: $started,
        current_step: 0,
        total_steps: 4,
        steps: [
            {name: "apn",      status: "pending", detail: ""},
            {name: "ttl_hl",   status: "pending", detail: ""},
            {name: "scenario", status: "pending", detail: ""},
            {name: "imei",     status: "pending", detail: ""}
        ],
        requires_reboot: false,
        error: null
    }'
