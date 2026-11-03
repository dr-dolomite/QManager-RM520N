#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# apply_cancel.sh — ask the restore worker to stop before its next section (POST).

qlog_init "cgi_config_backup_cancel"

if [ "$REQUEST_METHOD" = "OPTIONS" ]; then cgi_headers; exit 0; fi
if [ "$REQUEST_METHOD" != "POST" ]; then
    echo "Status: 405 Method Not Allowed"
    cgi_headers
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

cgi_headers
pid=$(cat /tmp/qmanager_config_restore.pid 2>/dev/null)
case "$pid" in ''|*[!0-9]*) pid="" ;; esac
if [ -z "$pid" ] || [ ! -d "/proc/$pid" ]; then
    cgi_error "not_running" ""
    exit 0
fi
: > /tmp/qmanager_config_restore.cancel 2>/dev/null || { cgi_error "cancel_failed" ""; exit 0; }
echo '{"success":true,"status":"cancel_requested"}'
