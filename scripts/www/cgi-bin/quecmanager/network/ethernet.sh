#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/ethtool_helper.sh
# =============================================================================
# ethernet.sh — CGI Endpoint: Ethernet Link Status & Speed Limit (GET + POST)
# =============================================================================
# GET:  Returns eth0 link status, speed, duplex, auto-negotiation state,
#       persisted speed limit, and whether 2.5G is PHY-supported.
# POST: Applies a new speed limit via qmanager_ethernet_apply (root helper),
#       persists the setting to /etc/qmanager/ethernet_speed.
#
# Config: /etc/qmanager/ethernet_speed  (one line: auto|10|100|1000|2500)
# NIC:    Realtek RTL8125B 2.5GbE (eth0, r8125 driver)
#
# POST body: { "speed_limit": "auto"|"10"|"100"|"1000"|"2500" }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/ethernet.sh
# Install location: /www/cgi-bin/quecmanager/network/ethernet.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_ethernet"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
ETH_INTERFACE="eth0"
ETHERNET_SPEED_FILE="/etc/qmanager/ethernet_speed"
ETHTOOL="/usr/sbin/ethtool"

# =============================================================================
# GET — Read current ethernet status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Reading ethernet status for $ETH_INTERFACE"

    # --- Link status from sysfs (fastest, no privileges needed) ---
    operstate=""
    if [ -r "/sys/class/net/$ETH_INTERFACE/operstate" ]; then
        operstate=$(cat "/sys/class/net/$ETH_INTERFACE/operstate" 2>/dev/null)
    fi

    case "$operstate" in
        up)   link_status="up" ;;
        down) link_status="down" ;;
        *)    link_status="down" ;;
    esac

    # --- Speed from sysfs ---
    sysfs_speed=""
    if [ -r "/sys/class/net/$ETH_INTERFACE/speed" ]; then
        sysfs_speed=$(cat "/sys/class/net/$ETH_INTERFACE/speed" 2>/dev/null)
    fi

    # sysfs speed is -1 or unavailable when link is down; fall through to ethtool
    if [ -n "$sysfs_speed" ] && [ "$sysfs_speed" -gt 0 ] 2>/dev/null; then
        speed="${sysfs_speed}Mb/s"
    else
        speed=""
    fi

    # --- Duplex from sysfs ---
    sysfs_duplex=""
    if [ -r "/sys/class/net/$ETH_INTERFACE/duplex" ]; then
        sysfs_duplex=$(cat "/sys/class/net/$ETH_INTERFACE/duplex" 2>/dev/null)
    fi
    duplex="$sysfs_duplex"

    # --- Run ethtool once for fields not in sysfs / fallback ---
    ethtool_out=$("$ETHTOOL" "$ETH_INTERFACE" 2>/dev/null)

    if [ -z "$speed" ]; then
        speed=$(printf '%s\n' "$ethtool_out" | grep -i "Speed:" | head -1 | sed 's/.*Speed:[[:space:]]*//')
        [ -z "$speed" ] && speed="Unknown"
    fi

    if [ -z "$duplex" ]; then
        duplex=$(printf '%s\n' "$ethtool_out" | grep -i "Duplex:" | head -1 | sed 's/.*Duplex:[[:space:]]*//')
        [ -z "$duplex" ] && duplex="Unknown"
    fi

    # --- Auto-negotiation ---
    auto_neg_raw=$(printf '%s\n' "$ethtool_out" | grep -i "Auto-negotiation:" | head -1 | sed 's/.*Auto-negotiation:[[:space:]]*//')
    case "$auto_neg_raw" in
        on|On|ON)   auto_negotiation="on" ;;
        off|Off|OFF) auto_negotiation="off" ;;
        *)          auto_negotiation="Unknown" ;;
    esac

    # --- Is there a controller at all? ---
    # `link_status` cannot answer this. An unplugged cable and an absent eth0
    # both read "down", so the UI has no way to tell "the cable is out" from
    # "this device has no ethernet port" — and the second is a DESIGNED outcome,
    # not a fault. It is exactly why qmanager-ethernet.service puts its
    # ConditionPathExists in [Unit] (the unit reports `inactive`, not `failed`)
    # and why docs/reference/ethernet.md warns against "fixing" that.
    #
    # sysfs, not ethtool: the directory either exists or it does not, it costs
    # no fork, and it is readable by www-data. Measured present on both
    # reference devices (RM520N-GL 61368cd2, RG501Q-EU b7e3d6f1), so the false
    # branch is unreachable there — stated rather than implied.
    #
    # Emitted below with --argjson, NOT --arg: a quoted "false" is a non-empty
    # string, and every non-empty string is truthy in JavaScript, so a stringly
    # typed field would report every device as having a port.
    if [ -d "/sys/class/net/$ETH_INTERFACE" ]; then
        interface_present=true
    else
        interface_present=false
    fi

    # --- Persisted speed limit ---
    speed_limit="auto"
    if [ -f "$ETHERNET_SPEED_FILE" ]; then
        persisted=$(cat "$ETHERNET_SPEED_FILE" 2>/dev/null | tr -d '[:space:]')
        case "$persisted" in
            auto|10|100|1000|2500) speed_limit="$persisted" ;;
        esac
    fi

    # --- 2.5G support ---
    sup2500=$(supports_2500)

    qlog_info "link=$link_status speed=$speed duplex=$duplex autoneg=$auto_negotiation limit=$speed_limit 2500=$sup2500 present=$interface_present"

    jq -n \
        --arg link_status "$link_status" \
        --arg speed "$speed" \
        --arg duplex "$duplex" \
        --arg auto_negotiation "$auto_negotiation" \
        --arg speed_limit "$speed_limit" \
        --argjson supports_2500 "$sup2500" \
        --argjson interface_present "$interface_present" \
        '{
            success: true,
            link_status: $link_status,
            speed: $speed,
            duplex: $duplex,
            auto_negotiation: $auto_negotiation,
            speed_limit: $speed_limit,
            supports_2500: $supports_2500,
            interface_present: $interface_present
        }'
    exit 0
fi

# =============================================================================
# POST — Apply speed limit
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    speed_limit=$(printf '%s' "$POST_DATA" | jq -r '.speed_limit // empty')

    if [ -z "$speed_limit" ]; then
        cgi_error "missing_field" "speed_limit field is required"
        exit 0
    fi

    # --- Validate ---
    case "$speed_limit" in
        auto|10|100|1000|2500) ;;
        *)
            cgi_error "invalid_speed" "speed_limit must be one of: auto, 10, 100, 1000, 2500"
            exit 0
            ;;
    esac

    # --- Reject 2500 if PHY doesn't support it ---
    if [ "$speed_limit" = "2500" ]; then
        sup2500=$(supports_2500)
        if [ "$sup2500" != "true" ]; then
            cgi_error "unsupported_speed" "2.5G is not supported by this PHY"
            exit 0
        fi
    fi

    qlog_info "Applying speed_limit=$speed_limit"

    apply_out=$(sudo -n /usr/bin/qmanager_ethernet_apply "$speed_limit" 2>&1)
    apply_rc=$?

    if [ "$apply_rc" -ne 0 ]; then
        qlog_error "qmanager_ethernet_apply failed rc=$apply_rc: $apply_out"
        cgi_error "apply_failed" "Failed to apply ethernet speed limit"
        exit 0
    fi

    qlog_info "Speed limit applied: $speed_limit"

    jq -n \
        --arg speed_limit "$speed_limit" \
        --argjson disconnect_window_seconds 8 \
        '{
            success: true,
            speed_limit: $speed_limit,
            disconnect_window_seconds: $disconnect_window_seconds
        }'
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
