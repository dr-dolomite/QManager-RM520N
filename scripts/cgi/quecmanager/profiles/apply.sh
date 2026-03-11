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

# --- Clear previous state file -----------------------------------------------
rm -f "$STATE_FILE"

# --- Launch apply in a detached session --------------------------------------
qlog_info "Spawning profile apply for: $PROFILE_ID"

# Detach via subshell (pure POSIX, no setsid needed)
( "$APPLY_BIN" "$PROFILE_ID" ) >/dev/null 2>&1 &

# Give the script time to start and write its PID file
sleep 0.5

# --- Verify it started -------------------------------------------------------
if [ -f "$PROFILE_APPLY_PID_FILE" ]; then
    NEW_PID=$(cat "$PROFILE_APPLY_PID_FILE" 2>/dev/null)
    if [ -n "$NEW_PID" ] && kill -0 "$NEW_PID" 2>/dev/null; then
        qlog_info "Profile apply started (PID: $NEW_PID)"
        jq -n --argjson pid "$NEW_PID" '{"success":true,"status":"applying","pid":$pid}'
    else
        qlog_error "Apply process exited immediately"
        # Check if state file has error info
        if [ -f "$STATE_FILE" ]; then
            cat "$STATE_FILE"
        else
            cgi_error "start_failed" "Apply process exited immediately"
        fi
    fi
else
    qlog_error "Apply process failed to write PID file"
    cgi_error "start_failed" "Apply process failed to start"
fi
