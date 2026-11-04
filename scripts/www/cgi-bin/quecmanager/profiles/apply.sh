#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# apply.sh — CGI Endpoint: Apply SIM Profile (Async)
# =============================================================================
# Spawns qmanager_profile_apply as a detached process and returns immediately.
# The frontend polls apply_status.sh for progress.
#
# Follows the same setsid detachment pattern as speedtest_start.sh.
#
# Endpoint: POST /cgi-bin/quecmanager/profiles/apply.sh
# Request body: {"id": "<profile_id>"}
# Response: {"success":true,"status":"applying"}
#       or: {"success":false,"error":"...","detail":"..."}
#
# Install location: /www/cgi-bin/quecmanager/profiles/apply.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_profile_apply"
cgi_headers
cgi_handle_options

# --- Source profile manager library (for profile_get validation) -------------
. /usr/lib/qmanager/profile_mgr.sh

# --- Configuration -----------------------------------------------------------
STATE_FILE="/tmp/qmanager_profile_state.json"
APPLY_BIN="/usr/bin/qmanager_profile_apply"

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

# --- Extract profile ID from JSON body ----------------------------------------
PROFILE_ID=$(printf '%s' "$POST_DATA" | jq -r '.id // empty')

if [ -z "$PROFILE_ID" ]; then
    cgi_error "no_id" "Missing id field in request body"
    exit 0
fi

# --- Sanitize ID (prevent path traversal) ------------------------------------
case "$PROFILE_ID" in
    p_[0-9]*_[0-9a-f]*)
        # Valid format
        ;;
    *)
        cgi_error "invalid_id" "Invalid profile ID format"
        exit 0
        ;;
esac

# --- Check: profile exists? --------------------------------------------------
if [ ! -f "$PROFILE_DIR/${PROFILE_ID}.json" ]; then
    cgi_error "not_found" "Profile not found"
    exit 0
fi

# --- Check: already applying? ------------------------------------------------
if ! profile_check_lock; then
    qlog_warn "Apply already running (PID: $_profile_lock_pid)"
    cgi_error "apply_in_progress" "A profile is already being applied"
    exit 0
fi

# --- Check: apply binary exists? ---------------------------------------------
if [ ! -x "$APPLY_BIN" ]; then
    qlog_error "Apply binary not found: $APPLY_BIN"
    cgi_error "not_installed" "Profile apply script not found"
    exit 0
fi

# --- Reset previous state file (INODE-PRESERVING — never rm, never mv) -------
# /tmp is root-owned mode 1777 (sticky) and this kernel runs with
# fs.protected_regular=1. Two consequences, both of which the old `rm -f` here
# fell foul of:
#
#   1. Sticky bit: as www-data we may NOT unlink a root-owned file in /tmp.
#      `rm -f` returns 0 regardless (that is what -f means), so the reset
#      silently no-opped and the frontend's very first poll rendered the
#      PREVIOUS run's state — in practice the boot-time apply's
#      "status":"complete" — making a brand-new apply look already finished.
#   2. fs.protected_regular: a cross-UID write to a file in a world-writable
#      sticky directory is denied unless file_owner == dir_owner (root) or
#      caller == file_owner. Root gets NO override either. So the ONLY
#      ownership under which both this CGI (www-data) and the root-spawned
#      worker can write this file is root:root 0666 — which is exactly what
#      qmanager_setup seeds at boot, and exactly what any rm/mv here would
#      destroy (rename() swaps the inode and the new one is owned by whoever
#      wrote it, at their umask).
#
# So: truncate-and-rewrite through the existing inode, and never reintroduce
# an `rm`/`mv` on this path.
#
# We write a full, schema-valid "applying" envelope rather than an empty file
# because apply_status.sh serves this file's bytes verbatim (`cat`); an empty
# file would make that endpoint emit an empty — i.e. invalid JSON — body.
# The shape matches write_state() in qmanager_profile_apply (4 steps, in the
# order apn -> ttl_hl -> scenario -> imei); the worker overwrites it with real
# values within a few hundred ms. If the worker never starts, this envelope is
# what apply_status.sh's watchdog then flips to "failed".
if [ ! -e "$STATE_FILE" ]; then
    # Created by www-data here means www-data-owned, which blocks the ROOT
    # writers (protected_regular, see above) even at mode 0666. The real fix
    # is the boot-time root seed in qmanager_setup; this is only a backstop so
    # a missing file does not break the UI path outright.
    : > "$STATE_FILE" 2>/dev/null && chmod 666 "$STATE_FILE" 2>/dev/null
fi

RESET_JSON=$(jq -n \
    --arg profile_id "$PROFILE_ID" \
    --argjson started "$(date +%s)" \
    '{
        status: "applying",
        profile_id: $profile_id,
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
    }' 2>/dev/null)

if [ -n "$RESET_JSON" ]; then
    if ! printf '%s\n' "$RESET_JSON" > "$STATE_FILE" 2>/dev/null; then
        # Not fatal — the worker may still be able to write it — but the UI
        # will show stale progress until it does, so this must be visible.
        qlog_warn "Could not reset $STATE_FILE (owner/permission denied; expected root:root 0666) — status may render stale"
    fi
else
    qlog_warn "Could not build reset envelope for $STATE_FILE (jq failed) — status may render stale"
fi

# --- Launch apply in a detached session --------------------------------------
qlog_info "Spawning profile apply for: $PROFILE_ID"

# Detach via subshell (pure POSIX, no setsid needed)
( "$APPLY_BIN" "$PROFILE_ID" </dev/null >/dev/null 2>&1 & )

# Give the script time to start and write its PID file
sleep 0.5

# --- Verify it started -------------------------------------------------------
if [ -f "$PROFILE_APPLY_PID_FILE" ]; then
    NEW_PID=$(cat "$PROFILE_APPLY_PID_FILE" 2>/dev/null)
    if pid_alive "$NEW_PID"; then
        qlog_info "Profile apply started (PID: $NEW_PID)"
        jq -n --argjson pid "$NEW_PID" '{"success":true,"status":"applying","pid":$pid}'
    else
        qlog_error "Apply process exited immediately"
        # Check if the worker managed to record a real failure before dying.
        # The state file now ALWAYS exists (we reset it in place above instead
        # of unlinking it), so `-f` alone no longer distinguishes "the worker
        # wrote an error" from "this is still our own pending envelope" —
        # test the recorded status instead.
        STATE_STATUS=$(jq -r '.status // ""' "$STATE_FILE" 2>/dev/null)
        case "$STATE_STATUS" in
            failed|partial)
                cat "$STATE_FILE"
                ;;
            *)
                cgi_error "start_failed" "Apply process exited immediately"
                ;;
        esac
    fi
else
    qlog_error "Apply process failed to write PID file"
    cgi_error "start_failed" "Apply process failed to start"
fi
