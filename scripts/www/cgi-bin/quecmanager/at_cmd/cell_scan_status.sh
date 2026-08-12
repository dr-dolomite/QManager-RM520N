#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# cell_scan_status.sh — CGI Endpoint: Cell Scan Status
# =============================================================================
# Polled by the frontend to check cell scan progress.
# Returns idle/running/complete/error with results when available.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/cell_scan_status.sh
# Response:
#   {"status": "idle"}
#   {"status": "running"}
#   {"status": "complete", "results": [...]}
#   {"status": "error", "message": "..."}
#
# Install location: /www/cgi-bin/quecmanager/at_cmd/cell_scan_status.sh
# =============================================================================

# --- Configuration -----------------------------------------------------------
PID_FILE="/tmp/qmanager_cell_scan.pid"
RESULT_FILE="/tmp/qmanager_cell_scan_result.json"
ERROR_FILE="/tmp/qmanager_cell_scan_error"

qlog_init "cgi_cell_scan_status"
cgi_headers
cgi_handle_options

# --- Check: scanner process running? -----------------------------------------
# NOTE on PID_FILE removal ordering here (see speedtest_status.sh:155-166 for
# the case where this DOES cause a running->idle->complete flicker): that
# flicker needs the harvest itself to be split across racing pollers. Here it
# isn't — qmanager_cell_scanner writes RESULT_FILE/ERROR_FILE and removes its
# OWN pid file (trap cleanup on EXIT) entirely within one worker process, and
# the trap only runs as the process's last act, so pid_alive only goes false
# after that trap — including this rm — has already completed. This branch
# firing on a *stale* PID_FILE (pid_alive false but file still present) is
# therefore only reachable after a SIGKILL, which never runs the trap and
# never produces a result either — so falling through to "idle" for that case
# is correct, not a flicker. Left unordered deliberately; do not "fix" to
# match speedtest without re-deriving this.
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
# RESULT must be checked BEFORE ERROR. This endpoint is a GET and must be
# non-destructive (no more `rm -f "$ERROR_FILE"` below), so a genuine error
# from a past run can now sit around until the next scan clears it (both
# start endpoints and the workers themselves already clear it on a fresh
# run). That reintroduces a race the old code didn't have to worry about: a
# double-started worker pair (pre-flock-singleton, or any future regression
# of it) can have worker A fail early (ERROR_FILE) and worker B succeed late
# (RESULT_FILE) — both files then exist. Checking result first means a real
# completed sweep is never shadowed by a stale error; checking error first
# would mean the good result is NEVER delivered instead of merely delayed.
# This can't suppress a genuine failure: on a real error the start endpoint
# already removed RESULT_FILE and the worker that failed never wrote one.
if [ -f "$RESULT_FILE" ]; then
    # Stream the results directly — no need to copy into a wrapper
    jq -n --slurpfile results "$RESULT_FILE" '{"status":"complete","results":$results[0]}'
    exit 0
fi

# --- Check: error file present? ----------------------------------------------
# Read-only on purpose — a GET must not mutate server state. The error stays
# until the next scan start (which clears it), so a lost/raced poll can no
# longer destroy it permanently.
if [ -f "$ERROR_FILE" ]; then
    ERR_MSG=$(cat "$ERROR_FILE" 2>/dev/null | head -1)
    jq -n --arg msg "$ERR_MSG" '{"status":"error","message":$msg}'
    exit 0
fi

# --- Default: idle (no scan has been run yet) ---------------------------------
jq -n '{"status":"idle"}'
