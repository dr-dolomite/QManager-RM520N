#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# lan_config.sh — CGI Endpoint: LAN Gateway IP / Subnet (GET + POST)
# =============================================================================
# "Gateway" in the UI is the modem's own LAN IP (mobileap_cfg.xml APIPAddr);
# LAN clients use it as their default gateway. QCMAP reads the file at boot, so
# a change applies on a deferred reboot. Device jq has no regex, so all
# validation is shell (lib: lan_subnet.sh).
#
# GET  response: { success, device, ipaddr, netmask, prefix }
# POST body:     { "ipaddr": "192.168.225.1", "prefix": 24 }
# POST response (printed BEFORE the deferred reboot): { success,
#   apply_in_progress, disconnect_window_seconds, carrier_bounce, new_ipaddr,
#   netmask, prefix }. The page must then GET system/update.sh?action=reboot_ack
#   (the /reboot/ page does this on load; see cgi_reboot_response) to release it.
# An unchanged ip + prefix returns apply_in_progress:false and does nothing.
#
# Errors: lan_read_failed, no_body, invalid_ipaddr, invalid_prefix,
#   invalid_private_address, invalid_host_in_subnet, lan_busy, lan_save_failed,
#   update_in_progress (HTTP 409).
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/lan_config.sh
# Install location: /usrdata/qmanager/www/cgi-bin/quecmanager/network/lan_config.sh
# =============================================================================

qlog_init "cgi_lan_config"

# Full reboot (ack wait up to 20 s + the /reboot/ countdown) plus margin.
WINDOW_SECONDS=120

# Headers are deferred so a 409 can carry its Status line; every branch sets them once.
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    cgi_headers
    exit 0
fi

# lan_err <code> <detail> [http_status]
lan_err() {
    [ -n "${3:-}" ] && echo "Status: $3"
    cgi_headers
    cgi_error "$1" "$2"
    exit 0
}

if [ -r /usr/lib/qmanager/lan_subnet.sh ]; then
    . /usr/lib/qmanager/lan_subnet.sh
else
    lan_err "lan_read_failed" "LAN library is not installed"
fi

# current_lan — sets cur_ip, cur_mask, cur_prefix from the XML; non-zero when unreadable.
current_lan() {
    qm_lan_current
    _cl_rc=$?
    cur_ip="$QM_LAN_CUR_IP"
    cur_mask="$QM_LAN_CUR_MASK"
    cur_prefix="$QM_LAN_CUR_PREFIX"
    return "$_cl_rc"
}

# =============================================================================
# GET — Read current LAN address + subnet
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Reading LAN config"

    current_lan
    case $? in
        0) ;;
        2)
            qlog_error "Malformed netmask in LAN config: $cur_mask"
            lan_err "lan_read_failed" "Stored netmask is malformed"
            ;;
        *)
            qlog_error "Unable to read LAN address or netmask"
            lan_err "lan_read_failed" "Unable to read LAN address or netmask"
            ;;
    esac

    qlog_info "LAN: ipaddr=$cur_ip netmask=$cur_mask prefix=$cur_prefix"
    cgi_headers
    jq -n \
        --arg ipaddr "$cur_ip" \
        --arg netmask "$cur_mask" \
        --argjson prefix "$cur_prefix" \
        '{
            success: true,
            device: "bridge0",
            ipaddr: $ipaddr,
            netmask: $netmask,
            prefix: $prefix
        }'
    exit 0
fi

# =============================================================================
# POST — Write LAN address + subnet, then deferred reboot
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    # cgi_read_post would print its error before any header; check here first.
    if [ -z "$CONTENT_LENGTH" ] || ! [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        lan_err "no_body" "POST body is empty"
    fi
    cgi_read_post

    # Don't use `// default` — jq's `//` coalesces on false AND null. Validate
    # object/presence/type explicitly via has() + type.
    ipaddr=$(printf '%s' "$POST_DATA" | jq -r '
        if type != "object" then " not_object"
        elif has("ipaddr") | not then " missing"
        elif (.ipaddr | type) != "string" then " not_string"
        else .ipaddr
        end
    ' 2>/dev/null)
    case "$ipaddr" in
        ""|" not_object"|" missing"|" not_string")
            lan_err "invalid_ipaddr" "ipaddr must be a non-empty string"
            ;;
    esac

    prefix=$(printf '%s' "$POST_DATA" | jq -r '
        if type != "object" then "not_object"
        elif has("prefix") | not then "missing"
        elif (.prefix | type) != "number" then "not_number"
        elif (.prefix != (.prefix | floor)) then "not_integer"
        else (.prefix | tostring)
        end
    ' 2>/dev/null)
    # Prefix range, dotted quad, RFC1918 and host checks live in lan_subnet.sh.
    qm_lan_check_request "$ipaddr" "$prefix" || lan_err "$QM_LAN_ERR" "$QM_LAN_ERR_DETAIL"
    netmask="$QM_LAN_NETMASK"

    qlog_info "LAN change requested: ipaddr=$ipaddr netmask=$netmask prefix=$prefix"

    # Unchanged request: no helper, no reboot.
    if current_lan && [ "$cur_ip" = "$ipaddr" ] && [ "$cur_prefix" = "$prefix" ]; then
        qlog_info "LAN config unchanged, nothing to apply"
        cgi_headers
        jq -n \
            --arg new_ipaddr "$ipaddr" \
            --arg netmask "$netmask" \
            --argjson prefix "$prefix" \
            '{
                success: true,
                apply_in_progress: false,
                disconnect_window_seconds: 0,
                carrier_bounce: false,
                new_ipaddr: $new_ipaddr,
                netmask: $netmask,
                prefix: $prefix
            }'
        exit 0
    fi

    if qm_lan_update_running; then
        qlog_warn "LAN change refused: software update in progress"
        lan_err "update_in_progress" "A software update is running" "409 Conflict"
    fi

    qm_lan_apply_run "$ipaddr" "$prefix" || lan_err "$QM_LAN_ERR" "$QM_LAN_ERR_DETAIL" "$QM_LAN_ERR_HTTP"

    qlog_info "LAN config saved ($ipaddr/$prefix), rebooting after ack"

    # Classify the coming reboot as user-initiated (same helper as system/reboot.sh);
    # a failed append never blocks the reboot.
    $_SUDO -n /usr/bin/qmanager_crash_log_append user </dev/null >/dev/null 2>&1

    resp=$(jq -n \
        --arg new_ipaddr "$ipaddr" \
        --arg netmask "$netmask" \
        --argjson prefix "$prefix" \
        --argjson disconnect_window_seconds "$WINDOW_SECONDS" \
        '{
            success: true,
            apply_in_progress: true,
            disconnect_window_seconds: $disconnect_window_seconds,
            carrier_bounce: true,
            new_ipaddr: $new_ipaddr,
            netmask: $netmask,
            prefix: $prefix
        }')

    # Prints the body, then reboots in a detached subshell once the page acks.
    cgi_headers
    cgi_reboot_response "$resp"
fi

# --- Method not allowed -------------------------------------------------------
cgi_headers
cgi_method_not_allowed
