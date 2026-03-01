#!/bin/sh
# =============================================================================
# ethernet.sh — CGI Endpoint: Ethernet Status & Link Speed Limit (GET + POST)
# =============================================================================
# GET:  Reads ethernet interface status via sysfs and ethtool.
# POST: Sets link speed limit via ethtool and persists via UCI.
#
# Data sources:
#   /sys/class/net/eth0/operstate       -> link status (up/down)
#   /sys/class/net/eth0/speed           -> negotiated speed (Mbps)
#   /sys/class/net/eth0/duplex          -> duplex mode (full/half)
#   ethtool eth0                        -> auto-negotiation status
#   UCI quecmanager.eth_link.speed_limit -> configured speed limit
#
# POST body: { "speed_limit": "auto"|"10"|"100"|"1000" }
#
# Ethtool advertise values (for restricted modes):
#   0x003 = 10baseT Half+Full           (10 Mbps only)
#   0x00f = 10baseT + 100baseT Half+Full (up to 100 Mbps)
#   0x02f = 10/100 + 1000baseT Full     (up to 1000 Mbps)
#   auto  = all supported link mode names parsed from ethtool
#           (covers 2.5G, 5G, etc. which don't fit in legacy hex masks)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/ethernet.sh
# Install location: /www/cgi-bin/quecmanager/network/ethernet.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }
    qlog_info() { :; }
    qlog_warn() { :; }
    qlog_error() { :; }
    qlog_debug() { :; }
}
qlog_init "cgi_ethernet"

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

ETH_INTERFACE="eth0"

# --- Helper: ensure UCI section exists ----------------------------------------
ensure_uci_section() {
    if ! uci get quecmanager.eth_link >/dev/null 2>&1; then
        uci set quecmanager.eth_link=eth_link
        uci commit quecmanager
    fi
}

# --- Helper: get speed limit from UCI -----------------------------------------
get_speed_limit() {
    ensure_uci_section
    limit=$(uci get quecmanager.eth_link.speed_limit 2>/dev/null)
    echo "${limit:-auto}"
}

# --- Helper: map speed_limit to ethtool advertise hex -----------------------
# ethtool -s advertise only accepts hex values (%x), NOT mode names.
# For restricted modes (10/100/1000), hardcoded hex masks work fine.
# For "auto", we must dynamically build the hex mask from ethtool's
# "Supported link modes" output, because higher speeds like 2500baseT/Full
# (bit 47) don't fit in the old 0x82f mask.
get_advertise_value() {
    case "$1" in
        "10")   echo "0x003" ;;
        "100")  echo "0x00f" ;;
        "1000") echo "0x02f" ;;
        *)      echo "" ;;
    esac
}

# --- Helper: build hex advertise mask from supported link modes --------------
# Parses "Supported link modes:" from ethtool, maps each mode name to its
# bit position (from linux/ethtool.h ETHTOOL_LINK_MODE_*_BIT), then builds
# the hex mask. Uses hi/lo 32-bit split so awk handles bit 47+ correctly.
get_supported_advertise_hex() {
    ethtool "$ETH_INTERFACE" 2>/dev/null | \
        sed -n '/Supported link modes:/,/Supported pause frame use:/p' | \
        sed '1s/.*Supported link modes:[[:space:]]*//' | \
        sed '/Supported pause frame use:/d' | \
        tr -s ' \t\n' '\n' | \
        awk '
        BEGIN {
            b["10baseT/Half"]=0;       b["10baseT/Full"]=1
            b["100baseT/Half"]=2;      b["100baseT/Full"]=3
            b["1000baseT/Half"]=4;     b["1000baseT/Full"]=5
            b["10000baseT/Full"]=12
            b["2500baseX/Full"]=15
            b["1000baseKX/Full"]=17
            b["10000baseKX4/Full"]=18; b["10000baseKR/Full"]=19
            b["40000baseKR4/Full"]=23; b["40000baseCR4/Full"]=24
            b["40000baseSR4/Full"]=25; b["40000baseLR4/Full"]=26
            b["25000baseCR/Full"]=31
            b["25000baseKR/Full"]=32;  b["25000baseSR/Full"]=33
            b["50000baseCR2/Full"]=34; b["50000baseKR2/Full"]=35
            b["100000baseKR4/Full"]=36; b["100000baseSR4/Full"]=37
            b["100000baseCR4/Full"]=38
            b["1000baseX/Full"]=41
            b["10000baseCR/Full"]=42;  b["10000baseSR/Full"]=43
            b["10000baseLR/Full"]=44;  b["10000baseLRM/Full"]=45
            b["10000baseER/Full"]=46
            b["2500baseT/Full"]=47;    b["5000baseT/Full"]=48
            lo = 0; hi = 0
        }
        {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "")
            if ($0 in b) {
                bit = b[$0]
                if (bit < 32) lo += 2^bit
                else hi += 2^(bit-32)
            }
        }
        END {
            if (hi > 0) printf "0x%x%08x\n", hi, lo
            else if (lo > 0) printf "0x%x\n", lo
        }'
}

# --- Helper: apply ethtool advertise settings --------------------------------
apply_speed_limit() {
    limit="$1"

    if [ "$limit" = "auto" ] || [ -z "$limit" ]; then
        # Auto: compute hex mask from all supported modes
        advertise=$(get_supported_advertise_hex)
        if [ -n "$advertise" ]; then
            ethtool -s "$ETH_INTERFACE" advertise "$advertise" autoneg on 2>/dev/null
        else
            # Fallback: just enable autoneg
            ethtool -s "$ETH_INTERFACE" autoneg on 2>/dev/null
        fi
    else
        advertise=$(get_advertise_value "$limit")
        ethtool -s "$ETH_INTERFACE" advertise "$advertise" autoneg on 2>/dev/null
    fi
}

# =============================================================================
# GET — Read ethernet status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Reading ethernet status for $ETH_INTERFACE"

    # Check if interface exists
    if [ ! -d "/sys/class/net/$ETH_INTERFACE" ]; then
        qlog_error "Interface $ETH_INTERFACE not found"
        jq -n '{success: false, error: "interface_not_found", detail: "Ethernet interface not found"}'
        exit 0
    fi

    # Read link status from sysfs
    link_status="down"
    if [ -f "/sys/class/net/$ETH_INTERFACE/operstate" ]; then
        link_status=$(cat "/sys/class/net/$ETH_INTERFACE/operstate" 2>/dev/null)
    fi

    # Read speed from sysfs (returns -1 or error if link is down)
    speed=""
    if [ -f "/sys/class/net/$ETH_INTERFACE/speed" ]; then
        raw_speed=$(cat "/sys/class/net/$ETH_INTERFACE/speed" 2>/dev/null)
        if [ -n "$raw_speed" ] && [ "$raw_speed" -gt 0 ] 2>/dev/null; then
            speed="${raw_speed}Mb/s"
        fi
    fi

    # Read duplex from sysfs
    duplex=""
    if [ -f "/sys/class/net/$ETH_INTERFACE/duplex" ]; then
        duplex=$(cat "/sys/class/net/$ETH_INTERFACE/duplex" 2>/dev/null)
    fi

    # Read auto-negotiation from ethtool
    auto_neg=""
    if command -v ethtool >/dev/null 2>&1; then
        eth_output=$(ethtool "$ETH_INTERFACE" 2>/dev/null)
        if [ -n "$eth_output" ]; then
            auto_neg=$(printf '%s' "$eth_output" | grep "Auto-negotiation:" | awk '{print $2}')
            # Fallback: get speed from ethtool if sysfs didn't work
            if [ -z "$speed" ]; then
                speed=$(printf '%s' "$eth_output" | grep "Speed:" | awk '{print $2}')
            fi
            # Fallback: get duplex from ethtool if sysfs didn't work
            if [ -z "$duplex" ]; then
                duplex=$(printf '%s' "$eth_output" | grep "Duplex:" | awk '{print $2}')
            fi
        fi
    fi

    # Get configured speed limit from UCI
    speed_limit=$(get_speed_limit)

    # Set defaults for missing values
    [ -z "$speed" ] && speed="Unknown"
    [ -z "$duplex" ] && duplex="Unknown"
    [ -z "$auto_neg" ] && auto_neg="Unknown"

    qlog_info "Status: link=$link_status speed=$speed duplex=$duplex autoneg=$auto_neg limit=$speed_limit"

    jq -n \
        --arg link_status "$link_status" \
        --arg speed "$speed" \
        --arg duplex "$duplex" \
        --arg auto_negotiation "$auto_neg" \
        --arg speed_limit "$speed_limit" \
        '{
            success: true,
            link_status: $link_status,
            speed: $speed,
            duplex: $duplex,
            auto_negotiation: $auto_negotiation,
            speed_limit: $speed_limit
        }'
    exit 0
fi

# =============================================================================
# POST — Set link speed limit
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    # --- Read POST body ---
    if [ -n "$CONTENT_LENGTH" ] && [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
        POST_DATA=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null)
    else
        echo '{"success":false,"error":"no_body","detail":"POST body is empty"}'
        exit 0
    fi

    speed_limit=$(printf '%s' "$POST_DATA" | jq -r '.speed_limit // empty')

    if [ -z "$speed_limit" ]; then
        echo '{"success":false,"error":"missing_field","detail":"speed_limit field is required"}'
        exit 0
    fi

    # Validate speed_limit value
    case "$speed_limit" in
        auto|10|100|1000) ;;
        *)
            echo '{"success":false,"error":"invalid_value","detail":"speed_limit must be: auto, 10, 100, or 1000"}'
            exit 0
            ;;
    esac

    qlog_info "Setting link speed limit to: $speed_limit"

    # Check if ethtool is available
    if ! command -v ethtool >/dev/null 2>&1; then
        qlog_error "ethtool not installed"
        echo '{"success":false,"error":"ethtool_missing","detail":"ethtool is not installed on this device"}'
        exit 0
    fi

    # Check if interface exists
    if ! ip link show "$ETH_INTERFACE" >/dev/null 2>&1; then
        qlog_error "Interface $ETH_INTERFACE not found"
        echo '{"success":false,"error":"interface_not_found","detail":"Ethernet interface not found"}'
        exit 0
    fi

    # Apply speed limit via ethtool
    apply_speed_limit "$speed_limit"
    if [ $? -ne 0 ]; then
        qlog_error "Failed to apply speed limit: $speed_limit"
        echo '{"success":false,"error":"ethtool_failed","detail":"Failed to set link speed limit"}'
        exit 0
    fi

    # Force renegotiation
    ethtool -r "$ETH_INTERFACE" 2>/dev/null

    # Save to UCI
    ensure_uci_section
    uci set quecmanager.eth_link.speed_limit="$speed_limit"
    uci commit quecmanager

    # Setup boot persistence
    init_script="/etc/init.d/qmanager_eth_link"
    if [ -x "$init_script" ]; then
        "$init_script" enable 2>/dev/null
    fi

    qlog_info "Link speed limit set to: $speed_limit"

    jq -n --arg speed_limit "$speed_limit" '{success: true, speed_limit: $speed_limit}'
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
echo '{"success":false,"error":"method_not_allowed","detail":"Use GET or POST"}'
