#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
[ -f /usr/lib/qmanager/platform.sh ] && . /usr/lib/qmanager/platform.sh
# =============================================================================
# reboot.sh — CGI Endpoint: System Reboot & Network Reconnect (POST only)
# =============================================================================
# POST {"action":"reboot"}     — Triggers a device reboot
# POST {"action":"reconnect"}  — Network deregister/reregister (AT+COPS=2/0)
# POST (no body/legacy)        — Triggers a device reboot (backward compat)
# =============================================================================

qlog_init "cgi_reboot"
cgi_headers

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_method_not_allowed
    exit 0
fi

cgi_handle_options
cgi_read_post

action=$(printf '%s' "$POST_DATA" | jq -r '.action // "reboot"' 2>/dev/null)

case "$action" in
    reconnect)
        qlog_info "Network reconnect requested (AT+COPS=2 then AT+COPS=0)"
        qcmd 'AT+COPS=2' >/dev/null 2>&1
        sleep 2
        qcmd 'AT+COPS=0' >/dev/null 2>&1
        jq -n '{"success":true,"detail":"Network reconnect initiated"}'
        ;;
    reboot|*)
        qlog_info "Device reboot requested via system menu"
        echo '{"success":true}'
        _reboot_cmd="reboot"
        command -v run_reboot >/dev/null 2>&1 && _reboot_cmd="run_reboot"
        # Classify this reboot as user-initiated in crash.log BEFORE it
        # happens, via the sudoers-gated root helper (www-data cannot write
        # crash.log directly — see qmanager_crash_log_append). alert_engine.sh
        # reads this on the next boot to skip the default "unplanned" cause.
        # A failed append still lets the reboot proceed (";" not "&&") — the
        # user asked to reboot, not to be blocked by alert bookkeeping.
        ( ( sleep 1; $_SUDO /usr/bin/qmanager_crash_log_append user 2>/dev/null; $_reboot_cmd ) </dev/null >/dev/null 2>&1 & )
        exit 0
        ;;
esac
