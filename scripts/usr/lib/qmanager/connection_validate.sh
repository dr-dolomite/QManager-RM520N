#!/bin/sh
# connection_validate.sh — input validators shared by the connection CGIs and the
# Config Backup appliers. A failing validator returns 1 and sets CONN_ERR_CODE /
# CONN_ERR_DETAIL to the exact pair the CGI answers with.

[ -n "$_CONNECTION_VALIDATE_LOADED" ] && return 0
_CONNECTION_VALIDATE_LOADED=1

_conn_fail() {
    CONN_ERR_CODE="$1"
    CONN_ERR_DETAIL="$2"
    return 1
}

# --- APN (cellular/apn.sh) ----------------------------------------------------

# PDP type: frontend vocabulary <-> AT+CGDCONT vocabulary.
pdp_to_frontend() {
    case "$1" in
        IP|IPV4) echo "ipv4" ;;
        IPV6)    echo "ipv6" ;;
        IPV4V6)  echo "ipv4v6" ;;
        *)       echo "" ;;
    esac
}
pdp_to_at() {
    case "$1" in
        ipv4)   echo "IP" ;;
        ipv6)   echo "IPV6" ;;
        ipv4v6) echo "IPV4V6" ;;
        *)      echo "" ;;
    esac
}

# conn_validate_cid <value> <max> — integer 1..max (the APN CGI's index/cid).
conn_validate_cid() {
    case "$1" in
        *[!0-9]*|"") _conn_fail "invalid_index" "index/cid must be a number 1-${2}"; return 1 ;;
    esac
    if [ "$1" -lt 1 ] || [ "$1" -gt "$2" ]; then
        _conn_fail "invalid_index" "index/cid must be 1-${2}"
        return 1
    fi
    return 0
}

# conn_validate_apn_setting <apn> <pdp_type frontend> — the single-APN save.
conn_validate_apn_setting() {
    [ -z "$1" ] && { _conn_fail "missing_fields" "apn is required"; return 1; }
    case "$1" in
        *'"'*) _conn_fail "invalid_value" "APN may not contain a double-quote"; return 1 ;;
    esac
    [ -z "$(pdp_to_at "$2")" ] && { _conn_fail "invalid_pdp_type" "pdp_type must be ipv4, ipv6, or ipv4v6"; return 1; }
    return 0
}

# --- MTU (network/mtu.sh) -----------------------------------------------------

conn_validate_mtu() {
    case "$1" in
        ''|*[!0-9]*|0*) _conn_fail "invalid_mtu" "MTU must be a whole number without leading zeros"; return 1 ;;
    esac
    if [ "${#1}" -gt 4 ] || [ "$1" -lt 576 ] || [ "$1" -gt 9000 ]; then
        _conn_fail "invalid_mtu" "MTU must be between 576 and 9000"
        return 1
    fi
    return 0
}

# --- IMEI backup config (cellular/imei.sh save_backup) ------------------------
# validate_imei itself lives in cgi_at.sh; callers source it.

# conn_validate_imei_backup <enabled> <backup_imei>
conn_validate_imei_backup() {
    [ -z "$1" ] && { _conn_fail "missing_enabled" "enabled field is required"; return 1; }
    case "$1" in
        true|false) ;;
        *) _conn_fail "invalid_enabled" "enabled must be true or false"; return 1 ;;
    esac
    if [ "$1" = "true" ]; then
        validate_imei "$2" || { _conn_fail "invalid_backup_imei" "Backup IMEI must be exactly 15 digits"; return 1; }
    fi
    return 0
}

# --- IP passthrough (network/ip_passthrough.sh) -------------------------------

# MAC address XX:XX:XX:XX:XX:XX
conn_validate_mac() {
    case "$1" in
        [0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]) return 0 ;;
        *) return 1 ;;
    esac
}

conn_validate_ippt_mode() {
    case "$1" in
        disabled|eth|usb) return 0 ;;
    esac
    _conn_fail "invalid_passthrough_mode" "passthrough_mode must be disabled, eth, or usb"
}

# conn_validate_ippt_mac <mode> <mac> — the MAC is required for eth/usb only.
conn_validate_ippt_mac() {
    [ "$1" = "disabled" ] && return 0
    [ -z "$2" ] && { _conn_fail "missing_target_mac" "target_mac is required when passthrough_mode is eth or usb"; return 1; }
    conn_validate_mac "$2" || { _conn_fail "invalid_target_mac" "target_mac must be in XX:XX:XX:XX:XX:XX format"; return 1; }
    return 0
}

conn_validate_ippt_nat() {
    case "$1" in
        0|1) return 0 ;;
    esac
    _conn_fail "invalid_ippt_nat" "ippt_nat must be 0 (WithoutNAT) or 1 (WithNAT)"
}

conn_validate_ippt_usb() {
    case "$1" in
        0|1|2|3) return 0 ;;
    esac
    _conn_fail "invalid_usb_mode" "usb_mode must be 0, 1, 2, or 3"
}

conn_validate_ippt_dns() {
    case "$1" in
        enabled|disabled) return 0 ;;
    esac
    _conn_fail "invalid_dns_proxy" "dns_proxy must be enabled or disabled"
}

# conn_validate_ippt <mode> <mac> <nat> <usb> <dns> — the CGI's order.
conn_validate_ippt() {
    conn_validate_ippt_mode "$1" || return 1
    conn_validate_ippt_mac "$1" "$2" || return 1
    conn_validate_ippt_nat "$3" || return 1
    conn_validate_ippt_usb "$4" || return 1
    conn_validate_ippt_dns "$5" || return 1
    return 0
}

# --- SMS (cellular/sms_storage.sh, sms_forwarding.sh) -------------------------

# E.164-ish: optional +, first digit 1-9, 7-15 digits.
conn_validate_phone() {
    _vp=$(printf '%s' "$1" | sed 's/^+//')
    case "$_vp" in
        ''|*[!0-9]*) return 1 ;;
    esac
    _vp_len=${#_vp}
    if [ "$_vp_len" -lt 7 ] || [ "$_vp_len" -gt 15 ]; then
        return 1
    fi
    _vp_first=$(printf '%s' "$_vp" | cut -c1)
    [ "$_vp_first" = "0" ] && return 1
    return 0
}

conn_validate_sms_storage() {
    case "$1" in
        ME|SM) return 0 ;;
    esac
    _conn_fail "invalid_storage" "storage must be ME or SM"
}
