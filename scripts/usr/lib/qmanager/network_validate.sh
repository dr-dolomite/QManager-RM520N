#!/bin/sh
# network_validate.sh — Custom DNS and Ethernet speed: validators, state read and apply.
# Shared by network/custom_dns.sh, network/ethernet.sh and Config Backup (config_backup_system.sh).
# Needs qlog (cgi_base.sh or the registry); ethernet also needs platform.sh/ethtool_helper.sh loaded by the caller.

[ -n "$_NETWORK_VALIDATE_LOADED" ] && return 0
_NETWORK_VALIDATE_LOADED=1

# --- Custom DNS --------------------------------------------------------------

QM_DNS_CONF="/etc/data/dnsmasq.conf"
QM_DNS_STAGING="/etc/data/qmanager/dnsmasq.conf.new"
QM_DNS_MOBILEAP_XML="/etc/data/mobileap_cfg.xml"
QM_DNS_SENTINEL_BEGIN="# QMANAGER-CUSTOM-DNS-BEGIN v1"
QM_DNS_SENTINEL_END="# QMANAGER-CUSTOM-DNS-END v1"
QM_DNS_MAX_SERVERS=4

# qm_dns_mode — read <DNSMode> from mobileap_cfg.xml as a tri-state: the value
# verbatim, ABSENT when the element is not present, UNKNOWN when it cannot be read.
qm_dns_mode() {
    if [ ! -f "$QM_DNS_MOBILEAP_XML" ] || [ ! -r "$QM_DNS_MOBILEAP_XML" ]; then
        printf "UNKNOWN"
        return
    fi
    # Presence must not depend on xmlstarlet — it is absent on both live devices.
    local rc
    grep -qE '<DNSMode([[:space:]]|>|/>)' "$QM_DNS_MOBILEAP_XML" 2>/dev/null
    rc=$?
    if [ "$rc" -ne 0 ]; then
        # ABSENT needs a clean no-match (1, not a grep error) AND the <DHCPCfg>
        # container in view — otherwise the file is truncated and we fail closed.
        if [ "$rc" -eq 1 ] && grep -q '<DHCPCfg' "$QM_DNS_MOBILEAP_XML" 2>/dev/null; then
            printf "ABSENT"
        else
            printf "UNKNOWN"
        fi
        return
    fi
    local val
    if command -v xmlstarlet >/dev/null 2>&1; then
        val=$(xmlstarlet sel -t -v "//DNSMode" "$QM_DNS_MOBILEAP_XML" 2>/dev/null)
    else
        val=$(grep -oE '<DNSMode>[^<]*</DNSMode>' "$QM_DNS_MOBILEAP_XML" 2>/dev/null \
              | sed 's/<[^>]*>//g')
    fi
    printf '%s' "${val:-UNKNOWN}"
}

# qm_dns_mode_available <mode> — writes are permitted when the mode reads PROXY, or when
# the firmware has no DNSMode selector at all (SDX55: absent means proxy-only).
qm_dns_mode_available() {
    case "$1" in
        PROXY|ABSENT) return 0 ;;
    esac
    return 1
}

# qm_dns_valid_ip — returns 0 if the argument looks like a valid IPv4 or IPv6
# address.  Uses a permissive regex — the real gate is dnsmasq --test.
qm_dns_valid_ip() {
    local addr="$1"
    # IPv4: four dotted decimal octets 0-255
    case "$addr" in
        *:*) : ;;   # contains colon — treat as IPv6 below
        [0-9]*.[0-9]*.[0-9]*.[0-9]*)
            # Each octet must be 0-255
            local IFS='.'
            set -- $addr
            [ $# -eq 4 ] || return 1
            for octet in "$@"; do
                case "$octet" in
                    ''|*[!0-9]*) return 1 ;;
                esac
                [ "$octet" -ge 0 ] && [ "$octet" -le 255 ] || return 1
            done
            return 0
            ;;
        *) return 1 ;;
    esac
    # IPv6: must contain at least one colon and only hex digits, colons, or
    # a single '%' scope suffix; empty segments from '::' are fine.
    case "$addr" in
        *[!0-9A-Fa-f:.]* ) return 1 ;;
        *:*) return 0 ;;
    esac
    return 1
}

# qm_dns_parse_block <file> — emit only the lines between our sentinels (exclusive).
# Returns nothing if the block is not present or is corrupted.
# Signals corruption via exit status 2.
qm_dns_parse_block() {
    local file="$1"
    local in_block=0
    local found_begin=0
    local found_end=0
    while IFS= read -r line; do
        case "$line" in
            "$QM_DNS_SENTINEL_BEGIN")
                found_begin=1
                in_block=1
                ;;
            "$QM_DNS_SENTINEL_END")
                found_end=1
                in_block=0
                ;;
            *)
                [ "$in_block" -eq 1 ] && printf '%s\n' "$line"
                ;;
        esac
    done < "$file"
    # Corrupted: one sentinel present without the other
    if [ "$found_begin" -eq 1 ] && [ "$found_end" -eq 0 ]; then return 2; fi
    if [ "$found_begin" -eq 0 ] && [ "$found_end" -eq 1 ]; then return 2; fi
    return 0
}

# qm_dns_strip_block <file> — write every line of the file to stdout EXCEPT the sentinel
# block and its delimiters.
qm_dns_strip_block() {
    local file="$1"
    local in_block=0
    while IFS= read -r line; do
        case "$line" in
            "$QM_DNS_SENTINEL_BEGIN") in_block=1 ;;
            "$QM_DNS_SENTINEL_END")   in_block=0 ;;
            *)
                [ "$in_block" -eq 0 ] && printf '%s\n' "$line"
                ;;
        esac
    done < "$file"
}

# qm_dns_read_state — sets QM_DNS_CONF_MISSING (0/1), QM_DNS_CORRUPT (0/1), QM_DNS_ENABLED and
# QM_DNS_IGNORE (true/false) and QM_DNS_SERVERS_JSON (array) from the sentinel block.
qm_dns_read_state() {
    local block_content block_status
    QM_DNS_CONF_MISSING=0
    QM_DNS_CORRUPT=0
    QM_DNS_ENABLED=false
    QM_DNS_IGNORE=false
    QM_DNS_SERVERS_JSON="[]"

    if [ ! -f "$QM_DNS_CONF" ]; then
        QM_DNS_CONF_MISSING=1
        return 0
    fi

    block_content=$(qm_dns_parse_block "$QM_DNS_CONF")
    block_status=$?

    if [ "$block_status" -eq 2 ]; then
        QM_DNS_CORRUPT=1
        # Reported as enabled=false — the UI offers "Clear stored config"
    elif [ "$block_status" -eq 0 ] && [ -n "$block_content" ]; then
        QM_DNS_ENABLED=true
        if printf '%s\n' "$block_content" | grep -q '^no-resolv$'; then
            QM_DNS_IGNORE=true
        fi
        QM_DNS_SERVERS_JSON=$(printf '%s\n' "$block_content" \
            | grep '^server=' \
            | sed 's/^server=//' \
            | jq -R . \
            | jq -s .)
    fi
    return 0
}

# qm_dns_apply_candidate <true|false enabled> <true|false ignoreCarrier> <server_lines>
# server_lines: one "server=<ip>" per line, each newline-terminated. Stages the candidate,
# pre-checks it with dnsmasq --test, then hands off to the root helper. On failure sets
# QM_DNS_ERR (the user-facing message), QM_DNS_APPLY_RC (helper rc, else 0) and returns 1.
qm_dns_apply_candidate() {
    local enabled="$1" ignore="$2" server_list="$3" write_status dnsmasq_err dnsmasq_exit apply_err apply_rc
    QM_DNS_ERR=""
    QM_DNS_APPLY_RC=0

    # --- Confirm config file exists ---
    if [ ! -f "$QM_DNS_CONF" ]; then
        QM_DNS_ERR="dnsmasq config file not found"
        return 1
    fi

    # --- Build candidate file: strip old block, optionally append new one ---
    {
        qm_dns_strip_block "$QM_DNS_CONF"
        if [ "$enabled" = "true" ]; then
            printf '%s\n' "$QM_DNS_SENTINEL_BEGIN"
            if [ "$ignore" = "true" ]; then
                printf 'no-resolv\n'
            fi
            # server_list already has each line terminated with \n
            printf '%s' "$server_list"
            printf '%s\n' "$QM_DNS_SENTINEL_END"
        fi
    } > "$QM_DNS_STAGING"

    write_status=$?
    if [ "$write_status" -ne 0 ]; then
        rm -f "$QM_DNS_STAGING"
        QM_DNS_ERR="failed to write staging config file"
        return 1
    fi

    # --- Server-side syntax validation ---
    dnsmasq_err=$(dnsmasq --test --conf-file="$QM_DNS_STAGING" 2>&1)
    dnsmasq_exit=$?
    if [ "$dnsmasq_exit" -ne 0 ]; then
        rm -f "$QM_DNS_STAGING"
        QM_DNS_ERR="dnsmasq rejected this configuration: $dnsmasq_err"
        return 1
    fi

    qlog_info "dnsmasq --test passed; applying"

    # --- Apply: root helper re-validates the block, installs, and HUPs ---
    apply_err=$(sudo -n /usr/bin/qmanager_dns_apply apply 2>&1)
    apply_rc=$?
    rm -f "$QM_DNS_STAGING"
    case "$apply_rc" in
        0) return 0 ;;
        8)
            qlog_warn "dnsmasq reload failed — settings saved but not yet live"
            QM_DNS_ERR="config saved but dnsmasq reload failed; try rebooting"
            ;;
        5)
            QM_DNS_ERR="dnsmasq rejected this configuration: $apply_err"
            ;;
        *)
            qlog_warn "qmanager_dns_apply failed rc=$apply_rc: $apply_err"
            QM_DNS_ERR="failed to install config: $apply_err"
            ;;
    esac
    QM_DNS_APPLY_RC=$apply_rc
    return 1
}

# --- Ethernet speed limit ----------------------------------------------------

: "${ETH_INTERFACE:=eth0}"
: "${ETHERNET_SPEED_FILE:=/etc/qmanager/ethernet_speed}"

# qm_eth_speed_valid <speed> — auto|10|100|1000|2500.
qm_eth_speed_valid() {
    case "$1" in
        auto|10|100|1000|2500) return 0 ;;
    esac
    return 1
}

# qm_eth_persisted — prints the stored speed limit, "auto" when missing or unrecognised.
qm_eth_persisted() {
    local persisted speed_limit="auto"
    if [ -f "$ETHERNET_SPEED_FILE" ]; then
        persisted=$(cat "$ETHERNET_SPEED_FILE" 2>/dev/null | tr -d '[:space:]')
        case "$persisted" in
            auto|10|100|1000|2500) speed_limit="$persisted" ;;
        esac
    fi
    printf '%s' "$speed_limit"
}

# qm_eth_save <speed> — validate, gate 2.5G on PHY support, run the root helper. On failure sets
# QM_ETH_ERR (code) + QM_ETH_ERR_DETAIL and returns 1. Needs ethtool_helper.sh (supports_2500).
qm_eth_save() {
    local speed_limit="$1" sup2500 apply_out apply_rc
    QM_ETH_ERR=""
    QM_ETH_ERR_DETAIL=""

    if ! qm_eth_speed_valid "$speed_limit"; then
        QM_ETH_ERR="invalid_speed"
        QM_ETH_ERR_DETAIL="speed_limit must be one of: auto, 10, 100, 1000, 2500"
        return 1
    fi

    # --- Reject 2500 if PHY doesn't support it ---
    if [ "$speed_limit" = "2500" ]; then
        sup2500=$(supports_2500)
        if [ "$sup2500" != "true" ]; then
            QM_ETH_ERR="unsupported_speed"
            QM_ETH_ERR_DETAIL="2.5G is not supported by this PHY"
            return 1
        fi
    fi

    qlog_info "Applying speed_limit=$speed_limit"

    apply_out=$(sudo -n /usr/bin/qmanager_ethernet_apply "$speed_limit" 2>&1)
    apply_rc=$?

    if [ "$apply_rc" -ne 0 ]; then
        qlog_error "qmanager_ethernet_apply failed rc=$apply_rc: $apply_out"
        QM_ETH_ERR="apply_failed"
        QM_ETH_ERR_DETAIL="Failed to apply ethernet speed limit"
        return 1
    fi

    qlog_info "Speed limit applied: $speed_limit"
    return 0
}
