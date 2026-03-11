#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# failover_status.sh — CGI Endpoint: Get Tower Failover State (Lightweight)
# =============================================================================
# Reads only filesystem flags — zero modem contact. Designed for frequent
# polling (~2-3s) by the frontend after a tower lock to detect when the
# failover watcher has completed its check.
#
# Endpoint: GET /cgi-bin/quecmanager/tower/failover_status.sh
# Install location: /www/cgi-bin/quecmanager/tower/failover_status.sh
# =============================================================================

# --- Configuration -----------------------------------------------------------
TOWER_CONFIG_FILE="/etc/qmanager/tower_lock.json"
FAILOVER_ACTIVATED_FLAG="/tmp/qmanager_tower_failover"
WATCHER_PID_FILE="/tmp/qmanager_tower_failover.pid"

qlog_init "cgi_tower_failover_status"
cgi_headers
cgi_handle_options

# --- Read failover enabled from config (flash) ------------------------------
# NOTE: Do not use `// false` — jq's alternative operator treats `false` as
# falsy, so `false // false` always returns the alternative. Use direct access.
enabled="false"
if [ -f "$TOWER_CONFIG_FILE" ]; then
    val=$(jq -r '.failover.enabled' "$TOWER_CONFIG_FILE" 2>/dev/null)
    [ "$val" = "true" ] && enabled="true"
fi

# --- Read failover activated flag (RAM, written by watcher) ------------------
activated="false"
if [ -f "$FAILOVER_ACTIVATED_FLAG" ]; then
    activated="true"
fi

# --- Check if watcher process is still running -------------------------------
watcher_running="false"
if [ -f "$WATCHER_PID_FILE" ]; then
    watcher_pid=$(cat "$WATCHER_PID_FILE" 2>/dev/null | tr -d ' \n\r')
    if [ -n "$watcher_pid" ] && kill -0 "$watcher_pid" 2>/dev/null; then
        watcher_running="true"
    fi
fi

# --- Response ----------------------------------------------------------------
printf '{"enabled":%s,"activated":%s,"watcher_running":%s}\n' \
    "$enabled" "$activated" "$watcher_running"
