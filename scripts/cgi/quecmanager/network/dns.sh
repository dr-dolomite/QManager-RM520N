#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# dns.sh — CGI Endpoint: Custom DNS Configuration (GET + POST)
# =============================================================================
# GET:  Reads current DNS mode and configured DNS servers from UCI.
# POST: Enables or disables custom DNS servers via UCI + dnsmasq restart.
#
# Data sources:
#   AT+QMAP="MPDN_RULE"          -> determine active NIC (lan vs lan_bind4)
#   dhcp.<nic>.dhcp_option       -> current custom DNS servers
#   /etc/qmanager/dns_mode       -> enabled/disabled state
#
# POST body: { "mode": "enabled"|"disabled", "nic": "lan"|"lan_bind4",
#              "dns1": "...", "dns2": "...", "dns3": "..." }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/dns.sh
# Install location: /www/cgi-bin/quecmanager/network/dns.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_dns"
cgi_headers
cgi_handle_options

# --- Helper: determine NIC from MPDN_RULE ------------------------------------
# Parses AT+QMAP="MPDN_RULE" response.
# Fields: "MPDN_rule", index, enabled, pdnIndex, interfaceType, ipType
# If any rule has enabled=1, NIC is "lan_bind4", otherwise "lan".
get_nic() {
    mpdn_out=$(qcmd "AT+QMAP=\"MPDN_RULE\"" 2>/dev/null)
    has_enabled=$(printf '%s' "$mpdn_out" | \
        grep '+QMAP: "MPDN_rule"' | \
        awk -F',' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); if ($3 == "1") print "yes"}' | \
        head -n 1)
    if [ "$has_enabled" = "yes" ]; then
        echo "lan_bind4"
    else
        echo "lan"
    fi
}

# =============================================================================
# GET — Read current DNS configuration
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Reading DNS configuration"

    nic=$(get_nic)
    qlog_debug "Determined NIC: $nic"

    # Read current DNS from UCI dhcp_option (format: "6,dns1,dns2,...")
    raw=$(uci get dhcp."$nic".dhcp_option 2>/dev/null)
    currentDNS=$(printf '%s' "$raw" | sed 's/^6,//')

    # Read mode file
    mode=$(cat /etc/qmanager/dns_mode 2>/dev/null || echo "disabled")

    qlog_info "DNS mode=$mode nic=$nic currentDNS=$currentDNS"

    jq -n \
        --arg mode "$mode" \
        --arg currentDNS "$currentDNS" \
        --arg nic "$nic" \
        '{
            success: true,
            mode: $mode,
            currentDNS: $currentDNS,
            nic: $nic
        }'
    exit 0
fi

# =============================================================================
# POST — Enable or disable custom DNS
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    mode=$(printf '%s' "$POST_DATA" | jq -r '.mode // empty')
    nic=$(printf '%s' "$POST_DATA" | jq -r '.nic // empty')
    dns1=$(printf '%s' "$POST_DATA" | jq -r '.dns1 // empty')
    dns2=$(printf '%s' "$POST_DATA" | jq -r '.dns2 // empty')
    dns3=$(printf '%s' "$POST_DATA" | jq -r '.dns3 // empty')

    # --- Validate mode ---
    case "$mode" in
        enabled|disabled) ;;
        *)
            cgi_error "invalid_value" "mode must be: enabled or disabled"
            exit 0
            ;;
    esac

    # --- Validate nic ---
    case "$nic" in
        lan|lan_bind4) ;;
        *)
            cgi_error "invalid_value" "nic must be: lan or lan_bind4"
            exit 0
            ;;
    esac

    # --- Validate DNS servers when enabling ---
    if [ "$mode" = "enabled" ]; then
        if [ -z "$dns1" ] && [ -z "$dns2" ] && [ -z "$dns3" ]; then
            cgi_error "missing_field" "At least one DNS server (dns1, dns2, or dns3) is required when enabling"
            exit 0
        fi
    fi

    # -------------------------------------------------------------------------
    # Path A — Enable custom DNS
    # -------------------------------------------------------------------------
    if [ "$mode" = "enabled" ]; then
        qlog_info "Enabling custom DNS on $nic: dns1=$dns1 dns2=$dns2 dns3=$dns3"

        # Build comma-separated list of non-empty DNS values
        dns_list=$(printf '%s' "$dns1,$dns2,$dns3" | tr ',' '\n' | grep -v '^$' | tr '\n' ',' | sed 's/,$//')

        # Ensure UCI section exists
        uci show dhcp."$nic" >/dev/null 2>&1 || uci set dhcp."$nic"=dhcp

        uci set dhcp."$nic".dhcp_option="6,$dns_list"
        uci commit dhcp
        /etc/init.d/dnsmasq restart >/dev/null 2>&1

        mkdir -p /etc/qmanager
        echo "enabled" > /etc/qmanager/dns_mode

        qlog_info "Custom DNS enabled: $dns_list on $nic"

        jq -n \
            --arg interface "$nic" \
            --arg dns "$dns_list" \
            '{success: true, interface: $interface, dns: $dns}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # Path B — Disable custom DNS (revert to carrier DNS)
    # -------------------------------------------------------------------------
    if [ "$mode" = "disabled" ]; then
        qlog_info "Disabling custom DNS, reverting to carrier DNS on lan"

        # Read carrier DNS from resolv.conf.auto
        carrier=$(awk '/^nameserver [0-9.]+/ {print $2}' /tmp/resolv.conf.d/resolv.conf.auto 2>/dev/null | \
            tr '\n' ',' | sed 's/,$//')

        # Ensure UCI section exists
        uci show dhcp.lan >/dev/null 2>&1 || uci set dhcp.lan=dhcp

        if [ -n "$carrier" ]; then
            uci set dhcp.lan.dhcp_option="6,$carrier"
        else
            uci delete dhcp.lan.dhcp_option 2>/dev/null || true
        fi
        uci commit dhcp
        /etc/init.d/dnsmasq restart >/dev/null 2>&1

        mkdir -p /etc/qmanager
        echo "disabled" > /etc/qmanager/dns_mode

        qlog_info "Carrier DNS restored: $carrier on lan"

        jq -n \
            --arg interface "lan" \
            --arg dns "$carrier" \
            '{success: true, interface: $interface, dns: $dns}'
        exit 0
    fi

fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
