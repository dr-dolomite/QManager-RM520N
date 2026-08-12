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
# Shared with cell_scan_start.sh on purpose — see the comment there. A full
# sweep and a neighbour read must never run concurrently: both serialize
# through the same AT mutex (qmanager_at.lock), so one launched into the
# other would just block for up to 3 minutes with no explanation.
SCAN_LOCK="/tmp/qmanager_scan.lock"

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Stale PID file cleanup (cosmetic only) -----------------------------------
# No longer the exclusion mechanism — the flock below is. pid_alive() is
# just `[ -d /proc/$1 ]` (platform.sh): it proves A pid exists, never that
# it's OUR worker, so it must not gate anything. Kept only to avoid a stale
# pid file lingering and to power the "who's holding the lock" message.
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if ! pid_alive "$OLD_PID"; then
        qlog_info "Cleaning stale neighbour scan PID file (PID: $OLD_PID)"
        rm -f "$PID_FILE"
    fi
fi

# --- Acquire the shared scan lock (mutual exclusion across BOTH scan types) --
[ -e "$SCAN_LOCK" ] || : > "$SCAN_LOCK" 2>/dev/null
exec 9<"$SCAN_LOCK"
if ! flock -x -n 9; then
    if [ -f "$PID_FILE" ] && pid_alive "$(cat "$PID_FILE" 2>/dev/null)"; then
        qlog_warn "Neighbour scan already running"
        cgi_error "already_running" "A neighbour scan is already in progress"
    else
        qlog_warn "Neighbour scan blocked — cell scan holds the modem"
        cgi_error "other_scan_running" "A full band sweep is using the modem and can take up to three minutes. Wait for it to finish."
    fi
    exit 0
fi

# --- Clean up previous results -----------------------------------------------
rm -f "$RESULT_FILE" "$ERROR_FILE"

# --- Launch scanner in background --------------------------------------------
# fd 9 is inherited by default — nothing here closes it, so the flock we
# just took travels with the worker for its whole lifetime and is released
# by the kernel automatically on any exit, clean or killed. See
# cell_scan_start.sh for the full rationale; this is the same mechanism.
# The CGI writes the pid itself rather than waiting for the worker to write
# its own. Without this the endpoint returns before /tmp/qmanager_neighbour_scan.pid
# exists, and the client's first status poll (1s later) finds no pid, no result
# and no error — so it reports `idle` for a scan that is running perfectly well,
# which the frontend now surfaces as "the scan ended without a result".
# `$!` inside this subshell is the worker's pid, the same value the worker
# writes as `$$`, so this is idempotent rather than racing its own worker.
( "$SCANNER_BIN" </dev/null >/dev/null 2>&1 & echo $! > "$PID_FILE" )

# Confirm the worker is alive — see cell_scan_start.sh for the full rationale.
# In short: the `sleep 0.8` this replaced doubled as the only detector for a
# missing or non-executable binary, and without it that install-integrity
# failure would report success and strand the client on a scan that never runs.
sleep 0.2
if ! pid_alive "$(cat "$PID_FILE" 2>/dev/null)"; then
    rm -f "$PID_FILE"
    qlog_error "Neighbour scanner failed to start"
    cgi_error "start_failed" "Scanner process did not start"
    exit 0
fi

qlog_info "Neighbour scan started (lock acquired, worker spawned)"
jq -n '{"success": true}'
