#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# neighbour_scan_status.sh — CGI Endpoint: Neighbour Cell Scan Status
# =============================================================================
# Polled by the frontend to check neighbour scan progress.
# Returns idle/running/complete/error with results when available.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/neighbour_scan_status.sh
# Response:
#   {"status": "idle"}
#   {"status": "running"}
#   {"status": "complete", "results": [...]}
#   {"status": "error", "message": "..."}
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/neighbour_scan_status.sh
# =============================================================================

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_neighbour_scan.pid"
RESULT_FILE="/tmp/qmanager_neighbour_scan_result.json"
ERROR_FILE="/tmp/qmanager_neighbour_scan_error"

qlog_init "cgi_neighbour_scan_status"
cgi_headers
cgi_handle_options

# --- Check: scanner process running? -----------------------------------------
# NOTE on PID_FILE removal ordering (see speedtest_status.sh:155-166 for the
# case where this DOES cause a running->idle->complete flicker, and
# cell_scan_status.sh for the full version of this note): not reachable here
# for the same reason — qmanager_neighbour_scanner writes RESULT_FILE/
# ERROR_FILE and removes its own PID_FILE (trap cleanup on EXIT) inside one
# worker process, and the trap is the process's last act, so pid_alive can
# only go false after that rm has already happened. This branch firing on a
# stale-but-present PID_FILE only happens after a SIGKILL, which skips the
# trap and never produces a result — falling through to "idle" there is
# correct. Left unordered deliberately.
if [ -f "$PID_FILE" ]; then
    SCAN_PID=$(cat "$PID_FILE" 2>/dev/null)
    if pid_alive "$SCAN_PID"; then
        jq -n '{"status":"running"}'
        exit 0
    fi
    # Process died — clean up stale PID
    rm -f "$PID_FILE"
fi

# --- Check: result file present? ----------------------------------------------
# RESULT must be checked BEFORE ERROR — see cell_scan_status.sh for the full
# rationale. Short version: this GET is now non-destructive (no more
# `rm -f "$ERROR_FILE"` below), so a stale error from an earlier failed
# worker in a double-start pair must never shadow a later worker's genuine
# result. Checking result first can't mask a real error either, since a real
# error means the start endpoint already deleted RESULT_FILE and no worker
# wrote one.
if [ -f "$RESULT_FILE" ]; then
    jq -n --slurpfile results "$RESULT_FILE" '{"status":"complete","results":$results[0]}'
    exit 0
fi

# --- Check: error file present? ----------------------------------------------
# Read-only on purpose — a GET must not mutate server state. The error is
# cleared on the next scan start instead (both the start endpoint and the
# worker already do this), so a lost poll can no longer erase it forever.
if [ -f "$ERROR_FILE" ]; then
    ERR_MSG=$(cat "$ERROR_FILE" 2>/dev/null | head -1)
    jq -n --arg msg "$ERR_MSG" '{"status":"error","message":$msg}'
    exit 0
fi

# --- Default: idle (no scan has been run yet) ---------------------------------
jq -n '{"status":"idle"}'
