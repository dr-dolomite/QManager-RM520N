#!/bin/sh
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
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
    qlog_debug() { :; }
}
qlog_init "cgi_ip_passthrough"

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2

# --- HTTP Headers ------------------------------------------------------------
echo "Content-Type: application/json"
echo "Cache-Control: no-cache, no-store, must-revalidate"
echo "Access-Control-Allow-Origin: *"
echo "Access-Control-Allow-Methods: GET, POST, OPTIONS"
echo "Access-Control-Allow-Headers: Content-Type"
echo ""

# --- Handle CORS preflight ---------------------------------------------------
if [ "$REQUEST_METHOD" = "OPTIONS" ]; then
    exit 0
fi

# --- Helper: Execute AT command via qcmd, return stripped response -----------
strip_at_response() {
    printf '%s' "$1" | tr -d '\r' | sed '1d' | sed '/^OK$/d' | sed '/^ERROR$/d'
}

run_at() {
    local raw
    raw=$(qcmd "$1" 2>/dev/null)
    local rc=$?
    if [ $rc -ne 0 ] || [ -z "$raw" ]; then
        return 1
    fi
    case "$raw" in
        *ERROR*) return 1 ;;
    esac
    strip_at_response "$raw"
}

# --- Helper: Validate MAC address (XX:XX:XX:XX:XX:XX) -----------------------
validate_mac() {
    case "$1" in
        [0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]) return 0 ;;
        *) return 1 ;;
    esac
}

# =============================================================================
# GET — Fetch current IP Passthrough settings
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching IP Passthrough settings"

    # --- 1. Passthrough mode + IPPT_info from MPDN_RULE ---
    # Field layout (awk -F','): $1="MPDN_rule" $2=rule_num $3=profileID
    #   $4=VLAN_ID $5=IPPT_mode $6=auto_connect [$7=IPPT_info]
    passthrough_mode="disabled"
    target_mac=""

    mpdn_resp=$(run_at 'AT+QMAP="MPDN_RULE"')
    sleep "$CMD_GAP"

    if [ -n "$mpdn_resp" ]; then
        # Grab line for rule 0
        rule0=$(printf '%s' "$mpdn_resp" | grep '"MPDN_rule",0,')

        if [ -n "$rule0" ]; then
            # Extract IPPT_mode (field 5) — use +0 to avoid gsub field-rebuild bug in BusyBox awk
            ippt_mode=$(printf '%s' "$rule0" | awk -F',' '{print $5+0}')

            case "$ippt_mode" in
                1)
                    passthrough_mode="eth"
                    # IPPT_info is field 7 (quoted MAC) — only present when NF >= 7
                    target_mac=$(printf '%s' "$rule0" | awk -F',' 'NF>=7 {gsub(/"/, "", $7); print $7}')
                    ;;
                3)
                    passthrough_mode="usb"
                    # IPPT_info is field 7 (quoted MAC/hostname) — only present when NF >= 7
                    target_mac=$(printf '%s' "$rule0" | awk -F',' 'NF>=7 {gsub(/"/, "", $7); print $7}')
                    ;;
                *)
                    passthrough_mode="disabled"
                    target_mac=""
                    ;;
            esac
        fi
    fi

    qlog_debug "MPDN_RULE: ippt_mode=$ippt_mode mode=$passthrough_mode mac=$target_mac"

    # --- 2. IPPT NAT mode ---
    ippt_nat="0"

    nat_resp=$(run_at 'AT+QMAP="IPPT_NAT"')
    sleep "$CMD_GAP"

    if [ -n "$nat_resp" ]; then
        # +QMAP: "IPPT_NAT",<0|1> — pattern-match to skip empty lines
        nat_val=$(printf '%s' "$nat_resp" | awk -F',' '/IPPT_NAT/{print $2+0; exit}')
        case "$nat_val" in
            0|1) ippt_nat="$nat_val" ;;
        esac
    fi

    qlog_debug "IPPT_NAT: $ippt_nat"

    # --- 3. USB modem protocol from QCFG usbnet ---
    usb_mode="1"

    usbnet_resp=$(run_at 'AT+QCFG="usbnet"')
    sleep "$CMD_GAP"

    if [ -n "$usbnet_resp" ]; then
        # +QCFG: "usbnet",<mode> — pattern-match to skip empty lines
        usb_mode=$(printf '%s' "$usbnet_resp" | awk -F',' '/usbnet/{print $2+0; exit}')
        [ -z "$usb_mode" ] && usb_mode="1"
    fi

    qlog_debug "usbnet mode=$usb_mode"

    # --- 4. DNS offloading from DHCPV4DNS ---
    dns_proxy="disabled"

    dhcp_resp=$(run_at 'AT+QMAP="DHCPV4DNS"')

    if [ -n "$dhcp_resp" ]; then
        # +QMAP: "DHCPV4DNS","enable" or "disable"
        dns_val=$(printf '%s' "$dhcp_resp" | awk -F'"' '{print $4}')
        case "$dns_val" in
            enable) dns_proxy="enabled" ;;
            *)      dns_proxy="disabled" ;;
        esac
    fi

    qlog_debug "DHCPV4DNS: dns_proxy=$dns_proxy"

    # --- 5. Client MAC from ARP (for "This Device" option) ---
    client_mac=""
    if [ -n "$REMOTE_ADDR" ]; then
        client_mac=$(awk -v ip="$REMOTE_ADDR" '$1==ip{print $4; exit}' /proc/net/arp 2>/dev/null)
        # Sanitize: must look like a MAC address
        case "$client_mac" in
            [0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:*) ;;
            *) client_mac="" ;;
        esac
    fi

    qlog_info "GET: mode=$passthrough_mode nat=$ippt_nat usb=$usb_mode dns=$dns_proxy client=$client_mac"

    jq -n \
        --arg mode "$passthrough_mode" \
        --arg mac "$target_mac" \
        --arg nat "$ippt_nat" \
        --arg usb "$usb_mode" \
        --arg dns "$dns_proxy" \
        --arg client "$client_mac" \
        '{
            success: true,
            passthrough_mode: $mode,
            target_mac: $mac,
            ippt_nat: $nat,
            usb_mode: $usb,
            dns_proxy: $dns,
            client_mac: $client
        }'
    exit 0
fi

# =============================================================================
# POST — Apply all settings and immediately reboot
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    # --- Read POST body ---
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    else
        echo '{"success":false,"error":"no_body","detail":"POST body is empty"}'
        exit 0
    fi

    # --- Extract action ---
    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        echo '{"success":false,"error":"missing_action","detail":"action field is required"}'
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

        # --- Validate passthrough_mode ---
        case "$PASSTHROUGH_MODE" in
            disabled|eth|usb) ;;
            *)
                echo '{"success":false,"error":"invalid_passthrough_mode","detail":"passthrough_mode must be disabled, eth, or usb"}'
                exit 0
                ;;
        esac

        # --- Validate MAC (required for eth/usb) ---
        if [ "$PASSTHROUGH_MODE" != "disabled" ]; then
            if [ -z "$TARGET_MAC" ]; then
                echo '{"success":false,"error":"missing_target_mac","detail":"target_mac is required when passthrough_mode is eth or usb"}'
                exit 0
            fi
            if ! validate_mac "$TARGET_MAC"; then
                echo '{"success":false,"error":"invalid_target_mac","detail":"target_mac must be in XX:XX:XX:XX:XX:XX format"}'
                exit 0
            fi
        fi

        # --- Validate ippt_nat ---
        case "$IPPT_NAT" in
            0|1) ;;
            *)
                echo '{"success":false,"error":"invalid_ippt_nat","detail":"ippt_nat must be 0 (WithoutNAT) or 1 (WithNAT)"}'
                exit 0
                ;;
        esac

        # --- Validate usb_mode ---
        case "$USB_MODE" in
            0|1|2|3) ;;
            *)
                echo '{"success":false,"error":"invalid_usb_mode","detail":"usb_mode must be 0, 1, 2, or 3"}'
                exit 0
                ;;
        esac

        # --- Validate dns_proxy ---
        case "$DNS_PROXY" in
            enabled|disabled) ;;
            *)
                echo '{"success":false,"error":"invalid_dns_proxy","detail":"dns_proxy must be enabled or disabled"}'
                exit 0
                ;;
        esac

        # --- Step 1: Apply MPDN_RULE passthrough setting ---
        case "$PASSTHROUGH_MODE" in
            disabled)
                result=$(qcmd 'AT+QMAP="MPDN_rule",0' 2>/dev/null)
                case "$result" in
                    *ERROR*)
                        qlog_error "MPDN_rule disable failed: $result"
                        echo '{"success":false,"error":"mpdn_rule_failed","detail":"Failed to reset MPDN_rule"}'
                        exit 0
                        ;;
                esac
                sleep "$CMD_GAP"
                # WAC reset — required when disabling passthrough
                result=$(qcmd 'AT+QMAPWAC=1' 2>/dev/null)
                case "$result" in
                    *ERROR*)
                        qlog_warn "QMAPWAC=1 returned error (non-fatal): $result"
                        ;;
                esac
                ;;
            eth)
                result=$(qcmd "AT+QMAP=\"MPDN_rule\",0,1,0,1,1,\"${TARGET_MAC}\"" 2>/dev/null)
                case "$result" in
                    *ERROR*)
                        qlog_error "MPDN_rule ETH failed: $result"
                        echo '{"success":false,"error":"mpdn_rule_failed","detail":"Failed to set ETH passthrough rule"}'
                        exit 0
                        ;;
                esac
                ;;
            usb)
                result=$(qcmd "AT+QMAP=\"MPDN_rule\",0,1,0,3,1,\"${TARGET_MAC}\"" 2>/dev/null)
                case "$result" in
                    *ERROR*)
                        qlog_error "MPDN_rule USB failed: $result"
                        echo '{"success":false,"error":"mpdn_rule_failed","detail":"Failed to set USB passthrough rule"}'
                        exit 0
                        ;;
                esac
                ;;
        esac

        sleep "$CMD_GAP"

        # --- Step 2: Apply IPPT_NAT mode ---
        result=$(qcmd "AT+QMAP=\"IPPT_NAT\",${IPPT_NAT}" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "IPPT_NAT failed: $result"
                echo '{"success":false,"error":"ippt_nat_failed","detail":"Failed to set IPPT NAT mode"}'
                exit 0
                ;;
        esac

        sleep "$CMD_GAP"

        # --- Step 3: Apply USB modem protocol ---
        result=$(qcmd "AT+QCFG=\"usbnet\",${USB_MODE}" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "QCFG usbnet failed: $result"
                echo '{"success":false,"error":"usbnet_failed","detail":"Failed to set USB modem protocol"}'
                exit 0
                ;;
        esac

        sleep "$CMD_GAP"

        # --- Step 4: Apply DNS offloading ---
        case "$DNS_PROXY" in
            enabled)  dns_cmd='AT+QMAP="DHCPV4DNS","enable"' ;;
            disabled) dns_cmd='AT+QMAP="DHCPV4DNS","disable"' ;;
        esac

        result=$(qcmd "$dns_cmd" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "DHCPV4DNS failed: $result"
                echo '{"success":false,"error":"dhcpv4dns_failed","detail":"Failed to set DNS offloading"}'
                exit 0
                ;;
        esac

        qlog_info "All settings applied — rebooting now"

        # Return response BEFORE rebooting so HTTP is flushed
        jq -n '{"success":true}'

        # Reboot with short delay to ensure response is sent
        ( sleep 2 && reboot ) &
        exit 0
    fi

    # --- Unknown action ---
    echo '{"success":false,"error":"invalid_action","detail":"action must be apply"}'
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
echo '{"success":false,"error":"method_not_allowed","detail":"Use GET or POST"}'
