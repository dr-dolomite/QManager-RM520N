#!/bin/sh
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
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
}
qlog_init "cgi_profile_apply"

# --- Source profile manager library (for profile_get validation) -------------
. /usr/lib/qmanager/profile_mgr.sh

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_profile_apply.pid"
STATE_FILE="/tmp/qmanager_profile_state.json"
APPLY_BIN="/usr/bin/qmanager_profile_apply"

# --- HTTP Headers ------------------------------------------------------------
echo "Content-Type: application/json"
echo "Cache-Control: no-cache"
echo "Access-Control-Allow-Origin: *"
echo "Access-Control-Allow-Methods: POST, OPTIONS"
echo "Access-Control-Allow-Headers: Content-Type"
echo ""

# --- Handle CORS preflight ---------------------------------------------------
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    exit 0
fi

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    echo '{"success":false,"error":"method_not_allowed","detail":"Use POST"}'
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
    POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
else
    echo '{"success":false,"error":"no_body","detail":"POST body is empty"}'
    exit 0
fi

# --- Extract profile ID from JSON body ----------------------------------------
PROFILE_ID=$(echo "$POST_DATA" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -z "$PROFILE_ID" ]; then
    echo '{"success":false,"error":"no_id","detail":"Missing id field in request body"}'
    exit 0
fi

# --- Sanitize ID (prevent path traversal) ------------------------------------
case "$PROFILE_ID" in
    p_[0-9]*_[0-9a-f]*)
        # Valid format
        ;;
    *)
        echo '{"success":false,"error":"invalid_id","detail":"Invalid profile ID format"}'
        exit 0
        ;;
esac

# --- Check: profile exists? --------------------------------------------------
if [ ! -f "$PROFILE_DIR/${PROFILE_ID}.json" ]; then
    echo '{"success":false,"error":"not_found","detail":"Profile not found"}'
    exit 0
fi

# --- Check: already applying? ------------------------------------------------
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        qlog_warn "Apply already running (PID: $OLD_PID)"
        echo '{"success":false,"error":"apply_in_progress","detail":"A profile is already being applied"}'
        exit 0
    fi
    # Stale PID — clean up
    rm -f "$PID_FILE"
fi

# --- Check: apply binary exists? ---------------------------------------------
if [ ! -x "$APPLY_BIN" ]; then
    qlog_error "Apply binary not found: $APPLY_BIN"
    echo '{"success":false,"error":"not_installed","detail":"Profile apply script not found"}'
    exit 0
fi

# --- Clear previous state file -----------------------------------------------
rm -f "$STATE_FILE"

# --- Launch apply in a detached session --------------------------------------
qlog_info "Spawning profile apply for: $PROFILE_ID"

if command -v setsid >/dev/null 2>&1; then
    setsid "$APPLY_BIN" "$PROFILE_ID" >/dev/null 2>&1 &
else
    ( "$APPLY_BIN" "$PROFILE_ID" ) >/dev/null 2>&1 &
fi

# Give the script time to start and write its PID file
sleep 0.5

# --- Verify it started -------------------------------------------------------
if [ -f "$PID_FILE" ]; then
    NEW_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$NEW_PID" ] && kill -0 "$NEW_PID" 2>/dev/null; then
        qlog_info "Profile apply started (PID: $NEW_PID)"
        printf '{"success":true,"status":"applying","pid":%s}\n' "$NEW_PID"
    else
        qlog_error "Apply process exited immediately"
        # Check if state file has error info
        if [ -f "$STATE_FILE" ]; then
            cat "$STATE_FILE"
        else
            echo '{"success":false,"error":"start_failed","detail":"Apply process exited immediately"}'
        fi
    fi
else
    qlog_error "Apply process failed to write PID file"
    echo '{"success":false,"error":"start_failed","detail":"Apply process failed to start"}'
fi
