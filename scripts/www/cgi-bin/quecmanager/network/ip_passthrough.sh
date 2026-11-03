#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/cgi_at.sh
. /usr/lib/qmanager/connection_validate.sh
. /usr/lib/qmanager/connection_store.sh
# =============================================================================
# ip_passthrough.sh — CGI Endpoint: IP Passthrough (IPPT) Settings (GET + POST)
# =============================================================================
# GET:  Reads current passthrough mode (MPDN_RULE), NAT mode (IPPT_NAT),
#       USB modem protocol (QCFG usbnet), and DNS offloading (DHCPV4DNS).
# POST: Validates, applies all AT commands, then immediately reboots.
#       No separate reboot action — apply and reboot happen in one shot.
#
# AT commands used (GET):
#   AT+QMAP="MPDN_RULE"   -> Passthrough mode + IPPT_info for rule 0
#   AT+QMAP="IPPT_NAT"    -> NAT mode (0=WithoutNAT, 1=WithNAT)
#   AT+QCFG="usbnet"      -> USB modem protocol (0=rmnet,1=ecm,2=mbim,3=rndis)
#   AT+QMAP="DHCPV4DNS"   -> DNS offloading status (enable/disable)
#
# AT commands used (POST, action=apply):
#   AT+QMAP="MPDN_rule",0             -> Disable passthrough (rule 0 reset)
#   AT+QMAPWAC=1                      -> WAC reset (only when disabling)
#   AT+QMAP="MPDN_rule",0,1,0,1,1,"<mac>" -> Enable ETH passthrough
#   AT+QMAP="MPDN_rule",0,1,0,3,1,"<mac>" -> Enable USB passthrough
#   AT+QMAP="IPPT_NAT",<0|1>         -> Set NAT mode
#   AT+QCFG="usbnet",<0-3>           -> Set USB modem protocol
#   AT+QMAP="DHCPV4DNS","enable|disable" -> Set DNS offloading
#
# MPDN_RULE field layout (comma-separated after +QMAP: prefix):
#   $1="MPDN_rule"  $2=rule_num  $3=profileID  $4=VLAN_ID
#   $5=IPPT_mode    $6=auto_connect  [$7=IPPT_info (MAC/hostname, quoted)]
#
# IPPT_mode values: 0=disabled, 1=ETH, 2=WiFi, 3=USB-ECM/RNDIS, 4=Any
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/ip_passthrough.sh
# Install location: /www/cgi-bin/quecmanager/network/ip_passthrough.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_ip_passthrough"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2
POLLER_CACHE="/tmp/qmanager_status.json"

# =============================================================================
# GET — Fetch current IP Passthrough settings
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching IP Passthrough settings"

    # --- 1-4. Read settings: config file (primary) → poller cache (fallback) ---
    # Config file is written by POST and is the authoritative source.
    # Poller cache is populated at boot from AT commands.
    if [ -f "$IPPT_CONFIG" ]; then
        passthrough_mode=$(jq -r '.mode // "disabled"' "$IPPT_CONFIG" 2>/dev/null)
        target_mac=$(jq -r '.mac // ""' "$IPPT_CONFIG" 2>/dev/null)
        ippt_nat=$(jq -r '.nat // "1"' "$IPPT_CONFIG" 2>/dev/null)
        usb_mode=$(jq -r '.usb_mode // "1"' "$IPPT_CONFIG" 2>/dev/null)
        dns_proxy=$(jq -r '.dns_proxy // "disabled"' "$IPPT_CONFIG" 2>/dev/null)
        qlog_debug "config: mode=$passthrough_mode nat=$ippt_nat usb=$usb_mode dns=$dns_proxy"
    else
        passthrough_mode=$(jq -r '.device.ippt_mode // "disabled"' "$POLLER_CACHE" 2>/dev/null)
        target_mac=$(jq -r '.device.ippt_mac // ""' "$POLLER_CACHE" 2>/dev/null)
        ippt_nat=$(jq -r '.device.ippt_nat // "1"' "$POLLER_CACHE" 2>/dev/null)
        usb_mode=$(jq -r '.device.ippt_usbnet // "1"' "$POLLER_CACHE" 2>/dev/null)
        dns_proxy=$(jq -r '.device.ippt_dhcpv4dns // "disabled"' "$POLLER_CACHE" 2>/dev/null)
        qlog_debug "cache fallback: mode=$passthrough_mode nat=$ippt_nat usb=$usb_mode dns=$dns_proxy"
    fi

    # Validate values (guard against corrupted source)
    case "$passthrough_mode" in disabled|eth|usb) ;; *) passthrough_mode="disabled" ;; esac
    case "$ippt_nat" in 0|1) ;; *) ippt_nat="1" ;; esac
    case "$usb_mode" in 0|1|2|3) ;; *) usb_mode="1" ;; esac
    case "$dns_proxy" in enabled|disabled) ;; *) dns_proxy="disabled" ;; esac

    qlog_info "GET: mode=$passthrough_mode nat=$ippt_nat usb=$usb_mode dns=$dns_proxy"

    jq -n \
        --arg mode "$passthrough_mode" \
        --arg mac "$target_mac" \
        --arg nat "$ippt_nat" \
        --arg usb "$usb_mode" \
        --arg dns "$dns_proxy" \
        '{
            success: true,
            passthrough_mode: $mode,
            target_mac: $mac,
            ippt_nat: $nat,
            usb_mode: $usb,
            dns_proxy: $dns
        }'
    exit 0
fi

# =============================================================================
# POST — Apply all settings and immediately reboot
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    # --- Extract action ---
    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: apply — Write all settings then reboot immediately
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "apply" ]; then
        PASSTHROUGH_MODE=$(printf '%s' "$POST_DATA" | jq -r '.passthrough_mode // empty')
        TARGET_MAC=$(printf '%s' "$POST_DATA" | jq -r '.target_mac // empty')
        IPPT_NAT=$(printf '%s' "$POST_DATA" | jq -r '.ippt_nat // empty')
        USB_MODE=$(printf '%s' "$POST_DATA" | jq -r '.usb_mode // empty')
        DNS_PROXY=$(printf '%s' "$POST_DATA" | jq -r '.dns_proxy // empty')

        qlog_info "Apply: mode=$PASSTHROUGH_MODE mac=$TARGET_MAC nat=$IPPT_NAT usb=$USB_MODE dns=$DNS_PROXY"

        if ! conn_validate_ippt "$PASSTHROUGH_MODE" "$TARGET_MAC" "$IPPT_NAT" "$USB_MODE" "$DNS_PROXY"; then
            cgi_error "$CONN_ERR_CODE" "$CONN_ERR_DETAIL"
            exit 0
        fi

        # AT writes + ippt_config.json (shared with config restore); the reboot is ours.
        if ! conn_ippt_apply "$PASSTHROUGH_MODE" "$TARGET_MAC" "$IPPT_NAT" "$USB_MODE" "$DNS_PROXY"; then
            cgi_error "$IPPT_ERR_CODE" "$IPPT_ERR_DETAIL"
            exit 0
        fi

        # Coordinated reboot — emits success JSON, waits for /reboot/ page ack
        # (via /tmp/qmanager_reboot_ack), then issues reboot via sudo-aware helper.
        # See cgi_reboot_response() in cgi_base.sh.
        cgi_reboot_response
    fi

    # --- Unknown action ---
    cgi_error "invalid_action" "action must be apply"
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
