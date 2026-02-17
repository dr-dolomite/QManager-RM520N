#!/bin/sh
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

# --- HTTP Headers ------------------------------------------------------------
echo "Content-Type: application/json"
echo "Cache-Control: no-cache"
echo "Access-Control-Allow-Origin: *"
echo "Access-Control-Allow-Methods: GET, OPTIONS"
echo "Access-Control-Allow-Headers: Content-Type"
echo ""

# --- Handle CORS preflight ---------------------------------------------------
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    exit 0
fi

# --- Case 1: No state file — nothing has been applied yet --------------------
if [ ! -f "$STATE_FILE" ]; then
    echo '{"status":"idle"}'
    exit 0
fi

# --- Case 2: State file exists — return it -----------------------------------
# But first, check for orphaned "applying" state (process died mid-apply).
STATE_STATUS=$(sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -1)

if [ "$STATE_STATUS" = "applying" ]; then
    # Verify the apply process is still alive
    if [ -f "$PID_FILE" ]; then
        APPLY_PID=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$APPLY_PID" ] && ! kill -0 "$APPLY_PID" 2>/dev/null; then
            # Process died but state says "applying" — correct to "failed"
            # We do a simple sed replacement rather than rewriting the whole file
            sed -i 's/"status":"applying"/"status":"failed"/' "$STATE_FILE" 2>/dev/null
            rm -f "$PID_FILE"
        fi
    else
        # No PID file but state says "applying" — process exited and cleaned up
        # but never wrote a final state. Mark as failed.
        sed -i 's/"status":"applying"/"status":"failed"/' "$STATE_FILE" 2>/dev/null
    fi
fi

cat "$STATE_FILE"
