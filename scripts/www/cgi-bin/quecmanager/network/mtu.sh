#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/connection_validate.sh
. /usr/lib/qmanager/connection_store.sh
# =============================================================================
# mtu.sh — CGI Endpoint: MTU Configuration (GET + POST)
# =============================================================================
# GET:  Reads the current MTU from whichever rmnet_data* interface currently
#       carries the WAN (resolved at runtime — the index migrates across
#       attach cycles) and checks whether a custom MTU config file exists.
# POST: Applies a new MTU value to all rmnet_data interfaces and persists
#       the commands to /etc/firewall.user.mtu. The qmanager_mtu init script
#       re-applies these at boot via the qmanager_mtu_apply daemon.
#       Send { "mtu": "disable" } to remove custom MTU and revert to default.
#
# Files:
#   /etc/firewall.user.mtu          — Persistent MTU commands (ip link set)
#
# POST body: { "mtu": 1420 }   or   { "mtu": "disable" }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/mtu.sh
# Install location: /www/cgi-bin/quecmanager/network/mtu.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_mtu"
cgi_headers
cgi_handle_options

# --- Configuration -----------------------------------------------------------
# MTU_FIREWALL_FILE comes from connection_store.sh.

# --- Helper: resolve the interface that currently carries the WAN ------------
# The WAN does NOT live on a fixed rmnet_dataN. The channel index migrates
# across attach cycles — verified live: the modem was attached on rmnet_data1
# (the only interface UP, holding the address and the default route) while
# rmnet_data0 sat DOWN with no address but non-zero /proc/net/dev counters,
# i.e. it had been the WAN earlier in the same boot. Hardcoding index 0 for the
# GET therefore reported MTU for a downed interface; it only looked correct
# because both happened to read 1500.
#
# Note detect_active_cid() in cgi_at.sh cannot help here: it resolves a PDP
# context ID, and neither +CGPADDR nor +QMAP carries a Linux interface name —
# there is no CID -> interface mapping anywhere in the codebase, and the
# +QMAP mux id matching rmnet_dataN today is coincidence, not a contract.
#
# Fallback ladder, most authoritative first:
#   1. the default route's device (what traffic actually uses)
#   2. the first rmnet_data* holding a global-scope address
#   3. the first rmnet_data* with carrier=1 (the tower_lock_mgr.sh idiom)
#   4. rmnet_data0, preserving legacy behaviour rather than failing the request
#
# Kept local deliberately: the other hardcoded rmnet_data0 sites
# (qmanager_mtu_apply, qmanager_firewall, config.sh) each have different
# semantics, so this is a candidate for promotion to a shared lib only once
# they actually converge — not a speculative primitive with one caller.
resolve_wan_interface() {
    _wan=$(ip route show default 2>/dev/null \
        | sed -n 's/.*dev \([^ ]*\).*/\1/p' \
        | grep '^rmnet_data' | head -1)
    [ -n "$_wan" ] && { printf '%s' "$_wan"; return 0; }

    for _f in /sys/class/net/rmnet_data*; do
        [ -e "$_f" ] || continue
        _n=$(basename "$_f")
        if ip -o addr show "$_n" 2>/dev/null | grep -q 'scope global'; then
            printf '%s' "$_n"
            return 0
        fi
    done

    for _f in /sys/class/net/rmnet_data*; do
        [ -e "$_f" ] || continue
        _n=$(basename "$_f")
        if [ "$(cat "/sys/class/net/${_n}/carrier" 2>/dev/null)" = "1" ]; then
            printf '%s' "$_n"
            return 0
        fi
    done

    printf 'rmnet_data0'
}

NETWORK_INTERFACE=$(resolve_wan_interface)

# --- Helper: get current MTU from the live WAN interface ---------------------
get_current_mtu() {
    ip link show "$NETWORK_INTERFACE" 2>/dev/null \
        | grep -o "mtu [0-9]*" | cut -d' ' -f2
}

# =============================================================================
# GET — Read current MTU status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Reading MTU configuration"

    current_mtu=$(get_current_mtu)
    current_mtu=${current_mtu:-1500}

    is_enabled="false"
    if [ -f "$MTU_FIREWALL_FILE" ]; then
        is_enabled="true"
    fi

    qlog_info "Current MTU=$current_mtu enabled=$is_enabled"

    jq -n \
        --argjson is_enabled "$is_enabled" \
        --argjson current_value "$current_mtu" \
        '{
            success: true,
            is_enabled: $is_enabled,
            current_value: $current_value
        }'
    exit 0
fi

# =============================================================================
# POST — Apply or disable MTU configuration
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    mtu_value=$(printf '%s' "$POST_DATA" | jq -r '(.mtu) | if . == null then empty else tostring end')

    if [ -z "$mtu_value" ]; then
        cgi_error "missing_field" "mtu field is required"
        exit 0
    fi

    # --- Handle disable ---
    if [ "$mtu_value" = "disable" ]; then
        qlog_info "Disabling custom MTU"

        if ! conn_mtu_disable; then
            qlog_error "MTU disable failed"
            cgi_error "mtu_disable_failed" "Could not turn off the custom MTU"
            exit 0
        fi

        default_mtu=$(get_current_mtu)
        default_mtu=${default_mtu:-1500}

        qlog_info "MTU disabled, current=$default_mtu"

        jq -n \
            --argjson current_value "$default_mtu" \
            '{
                success: true,
                message: "MTU configuration disabled",
                current_value: $current_value
            }'
        exit 0
    fi

    # --- Validate MTU (numeric, reasonable range) ---
    if ! conn_validate_mtu "$mtu_value"; then
        cgi_error "$CONN_ERR_CODE" "$CONN_ERR_DETAIL"
        exit 0
    fi

    qlog_info "Setting MTU=$mtu_value"

    # --- Persist the rules file and apply live (shared with config restore) ---
    if ! conn_mtu_set "$mtu_value"; then
        qlog_error "MTU set to $mtu_value failed"
        cgi_error "mtu_apply_failed" "Could not apply the MTU"
        exit 0
    fi

    qlog_info "MTU set to $mtu_value"

    jq -n \
        --argjson current_value "$mtu_value" \
        '{
            success: true,
            message: "MTU configuration updated",
            current_value: $current_value
        }'
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
