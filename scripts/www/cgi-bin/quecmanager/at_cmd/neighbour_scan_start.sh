#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# neighbour_scan_start.sh — CGI Endpoint: Start Neighbour Cell Scan
# =============================================================================
# Spawns the qmanager_neighbour_scanner background worker.
# Enforces singleton — only ONE scan may run at a time.
#
# Endpoint: POST /cgi-bin/quecmanager/at_cmd/neighbour_scan_start.sh
# Response: {"success": true}
#       or: {"success": false, "error": "already_running|start_failed"}
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/neighbour_scan_start.sh
# =============================================================================

qlog_init "cgi_neighbour_scan"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_neighbour_scan.pid"
RESULT_FILE="/tmp/qmanager_neighbour_scan_result.json"
ERROR_FILE="/tmp/qmanager_neighbour_scan_error"
SCANNER_BIN="/usr/bin/qmanager_neighbour_scanner"

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Check: scan already running? --------------------------------------------
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if pid_alive "$OLD_PID"; then
        qlog_warn "Neighbour scan already running (PID: $OLD_PID)"
        cgi_error "already_running" "A neighbour scan is already in progress"
        exit 0
    fi
    # Stale PID file — clean up
    qlog_info "Cleaning stale neighbour scan PID file (PID: $OLD_PID)"
    rm -f "$PID_FILE"
fi

# --- Clean up previous results -----------------------------------------------
rm -f "$RESULT_FILE" "$ERROR_FILE"

# --- Launch scanner in background --------------------------------------------
( "$SCANNER_BIN" </dev/null >/dev/null 2>&1 & )

# Brief pause to let PID file be written
sleep 0.8

if [ -f "$PID_FILE" ]; then
    NEW_PID=$(cat "$PID_FILE" 2>/dev/null)
    qlog_info "Neighbour scan started (PID: $NEW_PID)"
    jq -n --argjson pid "$NEW_PID" '{"success": true, "pid": $pid}'
else
    qlog_error "Neighbour scanner failed to start"
    cgi_error "start_failed" "Scanner process did not start"
fi
