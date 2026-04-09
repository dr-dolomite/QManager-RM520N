#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# cell_scan_start.sh — CGI Endpoint: Start Cell Scan
# =============================================================================
# Spawns the qmanager_cell_scanner background worker.
# Enforces singleton — only ONE scan may run at a time.
#
# Endpoint: POST /cgi-bin/quecmanager/at_cmd/cell_scan_start.sh
# Response: {"success": true}
#       or: {"success": false, "error": "already_running|start_failed"}
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/cell_scan_start.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_cell_scan"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_cell_scan.pid"
RESULT_FILE="/tmp/qmanager_cell_scan_result.json"
ERROR_FILE="/tmp/qmanager_cell_scan_error"
SCANNER_BIN="/usr/bin/qmanager_cell_scanner"

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Check: scan already running? --------------------------------------------
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if pid_alive "$OLD_PID"; then
        qlog_warn "Cell scan already running (PID: $OLD_PID)"
        cgi_error "already_running" "A cell scan is already in progress"
        exit 0
    fi
    # Stale PID file — clean up
    qlog_info "Cleaning stale cell scan PID file (PID: $OLD_PID)"
    rm -f "$PID_FILE"
fi

# --- Clean up previous results -----------------------------------------------
rm -f "$RESULT_FILE" "$ERROR_FILE"

# --- Launch scanner in background --------------------------------------------
( "$SCANNER_BIN" </dev/null >/dev/null 2>&1 & )

# Brief pause to let PID file be written (0.8s matches speedtest timing)
sleep 0.8

if [ -f "$PID_FILE" ]; then
    NEW_PID=$(cat "$PID_FILE" 2>/dev/null)
    qlog_info "Cell scan started (PID: $NEW_PID)"
    jq -n --argjson pid "$NEW_PID" '{"success": true, "pid": $pid}'
else
    qlog_error "Cell scanner failed to start"
    cgi_error "start_failed" "Scanner process did not start"
fi
