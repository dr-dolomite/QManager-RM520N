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
# Shared with neighbour_scan_start.sh on purpose — a full sweep and a
# neighbour read must never run concurrently, since both serialize through
# the same AT mutex (qmanager_at.lock) and a short read launched into a
# 180s sweep would just sit blocked with no way to tell the user why.
SCAN_LOCK="/tmp/qmanager_scan.lock"

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Stale PID file cleanup (cosmetic only) -----------------------------------
# This no longer guards exclusion — the flock acquired below is the actual
# singleton mechanism. pid_alive() is just `[ -d /proc/$1 ]` (platform.sh),
# which proves a PID exists, not that it belongs to our scanner; it must
# never be load-bearing for exclusion. It's kept only so a stale pid file
# doesn't linger and so the "who's holding the lock" message below has a
# clean pid file to inspect.
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if ! pid_alive "$OLD_PID"; then
        qlog_info "Cleaning stale cell scan PID file (PID: $OLD_PID)"
        rm -f "$PID_FILE"
    fi
fi

# --- Acquire the shared scan lock (mutual exclusion across BOTH scan types) --
# Lazily create the lock file — the fd redirect below fails if it's absent.
[ -e "$SCAN_LOCK" ] || : > "$SCAN_LOCK" 2>/dev/null
exec 9<"$SCAN_LOCK"
if ! flock -x -n 9; then
    # Busy. Use the (cosmetic) pid file only to decide WHICH message to
    # show: our own worker still running vs. the neighbour worker holding
    # the modem. Either way, do not spawn.
    if [ -f "$PID_FILE" ] && pid_alive "$(cat "$PID_FILE" 2>/dev/null)"; then
        qlog_warn "Cell scan already running"
        cgi_error "already_running" "A cell scan is already in progress"
    else
        qlog_warn "Cell scan blocked — neighbour scan holds the modem"
        cgi_error "other_scan_running" "A neighbour cell scan is using the modem. Wait for it to finish."
    fi
    exit 0
fi

# --- Clean up previous results -----------------------------------------------
rm -f "$RESULT_FILE" "$ERROR_FILE"

# --- Launch scanner in background --------------------------------------------
# fd 9 (the flock we just acquired) is inherited by this subshell and its
# child by default — nothing here closes it. The lock lives on the open
# file description, not on our pid, so it transfers to the worker and stays
# held for the worker's whole run; the kernel releases it automatically when
# the worker's last fd closes, on a clean exit or a SIGKILL alike. That
# makes this a self-healing singleton: no separate stale-lock cleanup is
# ever needed, and the acquire-then-spawn is atomic from the client's POV,
# closing the old TOCTOU window between spawn and the PID file appearing.
#
# The CGI writes the pid itself rather than waiting for the worker to write
# its own (the `sleep 0.8` this replaced). Without it the endpoint returns
# before /tmp/qmanager_cell_scan.pid exists, and the client's first status
# poll finds no pid, no result and no error — so it reports `idle` for a scan
# that is running perfectly well, which the frontend now surfaces as "the scan
# ended without a result". `$!` inside this subshell is the worker's pid, the
# same value the worker writes as `$$`, so this is idempotent rather than
# racing its own worker.
( "$SCANNER_BIN" </dev/null >/dev/null 2>&1 & echo $! > "$PID_FILE" )

# Confirm the worker is actually alive. The `sleep 0.8` this replaced doubled
# as the only detector for "the binary is missing or not executable" — an
# install-integrity failure that would otherwise now report success and then
# strand the client on a scan that never runs. A spawned-and-immediately-dead
# worker is the one case a 0.2s look can catch reliably: a healthy one holds
# the modem for 30-180s, so there is no ambiguity about what a dead pid means
# this early.
sleep 0.2
if ! pid_alive "$(cat "$PID_FILE" 2>/dev/null)"; then
    rm -f "$PID_FILE"
    qlog_error "Cell scanner failed to start"
    cgi_error "start_failed" "Scanner process did not start"
    exit 0
fi

qlog_info "Cell scan started (lock acquired, worker spawned)"
jq -n '{"success": true}'
