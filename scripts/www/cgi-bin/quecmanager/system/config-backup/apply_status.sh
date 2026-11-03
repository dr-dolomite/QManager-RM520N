#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# apply_status.sh — Config Backup restore progress (GET).
# A "running" file with no live worker is reported as "crashed".

qlog_init "cgi_config_backup_status"
cgi_headers
cgi_handle_options

STATE_FILE="/tmp/qmanager_config_restore.json"
PID_FILE="/tmp/qmanager_config_restore.pid"

if [ ! -f "$STATE_FILE" ]; then
    echo '{"success":true,"status":"idle"}'
    exit 0
fi

pid=$(cat "$PID_FILE" 2>/dev/null)
alive=false
case "$pid" in ''|*[!0-9]*) ;; *) [ -d "/proc/$pid" ] && alive=true ;; esac

jq -c --argjson alive "$alive" \
    '. + {success:true} | if .status == "running" and ($alive | not) then .status = "crashed" else . end' \
    "$STATE_FILE" 2>/dev/null || cgi_error "state_unreadable" ""
