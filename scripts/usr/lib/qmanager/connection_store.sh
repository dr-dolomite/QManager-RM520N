#!/bin/sh
# connection_store.sh — apply/persist primitives lifted from the connection CGIs so a
# UI save and a Config Backup restore run the same code. Needs qlog_*, cgi_at.sh
# (run_at), platform.sh (svc_*, run_iptables) and connection_validate.sh loaded by the caller.
# Failures return 1 with the CGI's error pair in *_ERR_CODE / *_ERR_DETAIL.

[ -n "$_CONNECTION_STORE_LOADED" ] && return 0
_CONNECTION_STORE_LOADED=1

command -v qlog_info >/dev/null 2>&1 || qlog_info() { :; }
command -v qlog_warn >/dev/null 2>&1 || qlog_warn() { :; }
command -v qlog_error >/dev/null 2>&1 || qlog_error() { :; }
. /usr/lib/qmanager/ttl_state.sh 2>/dev/null

# =============================================================================
# APN (cellular/apn.sh)
# =============================================================================
APN_NAMES_FILE="/etc/qmanager/apn_names.json"
APN_SETTING_FILE="/etc/qmanager/apn_setting.json"

# Profile-name sidecar as a compact JSON object; missing/corrupt -> {}.
apn_names_read() {
    if [ -f "$APN_NAMES_FILE" ]; then
        _nj=$(jq -c '.' "$APN_NAMES_FILE" 2>/dev/null)
        [ -n "$_nj" ] && { printf '%s' "$_nj"; return; }
    fi
    printf '%s' "{}"
}

# apn_name_write <cid> <name> — merge one {cid:name} entry, atomic, 644.
apn_name_write() {
    _wc="$1"
    _wn="$2"
    _wdir=$(dirname "$APN_NAMES_FILE")
    [ -d "$_wdir" ] || mkdir -p "$_wdir" 2>/dev/null
    _wcur=$(apn_names_read)
    _wnew=$(printf '%s' "$_wcur" | jq -c --arg k "$_wc" --arg v "$_wn" '.[$k]=$v' 2>/dev/null)
    [ -z "$_wnew" ] && return 1
    _wtmp="${APN_NAMES_FILE}.tmp.$$"
    printf '%s\n' "$_wnew" > "$_wtmp" 2>/dev/null || { rm -f "$_wtmp" 2>/dev/null; return 1; }
    chmod 644 "$_wtmp" 2>/dev/null
    mv "$_wtmp" "$APN_NAMES_FILE" 2>/dev/null || { rm -f "$_wtmp" 2>/dev/null; return 1; }
    chmod 644 "$APN_NAMES_FILE" 2>/dev/null
    return 0
}

# Single-APN setting as a compact JSON object; missing/corrupt -> {"active":0}.
apn_setting_read() {
    if [ -f "$APN_SETTING_FILE" ]; then
        _sj=$(jq -c '.' "$APN_SETTING_FILE" 2>/dev/null)
        [ -n "$_sj" ] && { printf '%s' "$_sj"; return; }
    fi
    printf '%s' '{"active":0}'
}

# apn_setting_write <apn> <pdp_type frontend> <cid> <active 0|1> — atomic, 644.
apn_setting_write() {
    _sa="$1"
    _sp="$2"
    _sc="$3"
    _sact="$4"
    _sdir=$(dirname "$APN_SETTING_FILE")
    [ -d "$_sdir" ] || mkdir -p "$_sdir" 2>/dev/null
    _snew=$(jq -n \
        --arg apn "$_sa" \
        --arg pdp_type "$_sp" \
        --argjson cid "$_sc" \
        --argjson active "$_sact" \
        '{apn: $apn, pdp_type: $pdp_type, cid: $cid, active: $active}' 2>/dev/null)
    [ -z "$_snew" ] && return 1
    _stmp="${APN_SETTING_FILE}.tmp.$$"
    printf '%s\n' "$_snew" > "$_stmp" 2>/dev/null || { rm -f "$_stmp" 2>/dev/null; return 1; }
    chmod 644 "$_stmp" 2>/dev/null
    mv "$_stmp" "$APN_SETTING_FILE" 2>/dev/null || { rm -f "$_stmp" 2>/dev/null; return 1; }
    chmod 644 "$APN_SETTING_FILE" 2>/dev/null
    return 0
}

# Map apn_apply_write's APN_APPLY_RC to the CGI error pair; 0 when it succeeded.
_apn_rc_to_err() {
    case "$APN_APPLY_RC" in
        0) return 0 ;;
        1) APN_ERR_CODE="cgdcont_failed" ;;
        2) APN_ERR_CODE="cops_detach_failed" ;;
        3) APN_ERR_CODE="cops_attach_failed" ;;
        4) APN_ERR_CODE="apn_mismatch" ;;
        5) APN_ERR_CODE="cops_attach_failed" ;;
        7) APN_ERR_CODE="apn_busy" ;;
        *) APN_ERR_CODE="apn_apply_failed" ;;
    esac
    APN_ERR_DETAIL="$APN_APPLY_DETAIL"
    return 1
}

# apn_setting_apply <cid> <pdp_type frontend> <apn> — the single-APN save: attach
# cycle, TTL/HL re-apply, sidecar. APN_SAVE_PERSISTED=0 when only the sidecar failed.
apn_setting_apply() {
    local _cid="$1" _pdp="$2" _apn="$3" _pdp_at _pttl _phl
    APN_SAVE_PERSISTED=1
    _pdp_at=$(pdp_to_at "$_pdp")

    apn_apply_write "$_cid" "$_pdp_at" "$_apn"
    _apn_rc_to_err || return 1

    read -r _pttl _phl <<EOF
$(ttl_state_read_persisted)
EOF
    _pttl="${_pttl:-0}"
    _phl="${_phl:-0}"
    if [ "$_pttl" -gt 0 ] 2>/dev/null || [ "$_phl" -gt 0 ] 2>/dev/null; then
        qlog_info "Re-applying persisted TTL=$_pttl HL=$_phl after APN save"
        if ! ttl_state_apply "$_pttl" "$_phl"; then
            qlog_warn "TTL/HL re-apply failed after APN save; rules may be partial"
        fi
    fi

    # Store the negotiated APN; on rc=0 it equals the requested one.
    if ! apn_setting_write "$APN_APPLY_NEGOTIATED_APN" "$_pdp" "$_cid" 1; then
        qlog_warn "Applied APN to modem but failed to persist $APN_SETTING_FILE"
        APN_SAVE_PERSISTED=0
    fi
    return 0
}

# apn_setting_deactivate — revert to carrier default and store active=0. A sidecar
# already at active=0 is a no-op (no modem write). APN_SAVE_PERSISTED=0 when the
# sidecar could neither be rewritten nor removed.
apn_setting_deactivate() {
    local _sjson _active _cid _pdp _pdp_at
    APN_SAVE_PERSISTED=1
    _sjson=$(apn_setting_read)
    _active=$(printf '%s' "$_sjson" | jq -r 'if .active == 1 then 1 else 0 end')

    if [ "$_active" != "1" ]; then
        qlog_info "Deactivate (WS6): already carrier default; no modem write"
        return 0
    fi

    _cid=$(printf '%s' "$_sjson" | jq -r 'if .cid == null then 1 else .cid end')
    _pdp=$(printf '%s' "$_sjson" | jq -r 'if .pdp_type == null then "ipv4v6" else .pdp_type end')
    case "$_cid" in
        ''|*[!0-9]*) _cid=1 ;;
    esac
    _pdp_at=$(pdp_to_at "$_pdp")
    [ -z "$_pdp_at" ] && _pdp_at="IPV4V6"

    qlog_info "Deactivate (WS6): reverting cid=$_cid to carrier default; active=0"

    # allow_empty=1: a deliberate revert to carrier default, not a missing APN.
    apn_apply_write "$_cid" "$_pdp_at" "" 1
    _apn_rc_to_err || return 1

    # Persist failure after a successful revert still succeeds; fall back to
    # dropping the sidecar (missing reads as active=0).
    if ! apn_setting_write "" "$_pdp" "$_cid" 0; then
        qlog_warn "Reverted cid $_cid on modem but failed to persist active=0 to $APN_SETTING_FILE"
        if rm -f "$APN_SETTING_FILE" 2>/dev/null && [ ! -e "$APN_SETTING_FILE" ]; then
            qlog_warn "Removed $APN_SETTING_FILE instead (missing sidecar reads as active=0)"
        else
            qlog_error "Could not remove $APN_SETTING_FILE; sidecar still says active=1"
            APN_SAVE_PERSISTED=0
        fi
    fi
    return 0
}

# =============================================================================
# MTU (network/mtu.sh)
# =============================================================================
MTU_FIREWALL_FILE="/etc/firewall.user.mtu"

# _conn_mtu_helper <verb> [value] — run the root helper (sudo -n unless already root).
_conn_mtu_helper() {
    if [ "$(id -u)" = "0" ]; then
        /usr/bin/qmanager_mtu_set "$@" >/dev/null 2>&1
    else
        sudo -n /usr/bin/qmanager_mtu_set "$@" >/dev/null 2>&1
    fi
}

# conn_mtu_set <value> — rewrite the persistent rules file and apply live via the root helper.
# rc 1 if the file could not be written or any interface refused the change.
conn_mtu_set() {
    _conn_mtu_helper set "$1"
}

# conn_mtu_disable — drop the rules file and reset rmnet_data to 1500 via the root helper. rc 1 on failure.
conn_mtu_disable() {
    _conn_mtu_helper disable
}

# =============================================================================
# IMEI (cellular/imei.sh)
# =============================================================================
IMEI_POLLER_CACHE="/tmp/qmanager_status.json"
IMEI_BACKUP_CONFIG="/etc/qmanager/imei_backup.json"
IMEI_CHECK_PENDING="/etc/qmanager/imei_check_pending"

# conn_imei_current — modem IMEI (AT+CGSN, poller cache as fallback); empty if unknown.
conn_imei_current() {
    local _raw _imei
    _raw=$(run_at "AT+CGSN" 2>/dev/null)
    _imei=$(printf '%s' "$_raw" | grep -o '[0-9]\{15\}' | head -1)
    if [ -z "$_imei" ] && [ -f "$IMEI_POLLER_CACHE" ]; then
        _imei=$(jq -r '.device.imei // ""' "$IMEI_POLLER_CACHE" 2>/dev/null)
    fi
    printf '%s' "$_imei"
}

# conn_imei_write <imei> — AT+EGMR=1,7 plus the boot-time check flag when the
# backup IMEI is enabled. rc 1 if the modem did not answer OK. Reboot is the caller's.
conn_imei_write() {
    local _result _rc _egmr_ok="false" _b_enabled
    _result=$(qcmd "AT+EGMR=1,7,\"${1}\"" 2>/dev/null)
    _rc=$?
    # Line-exact OK: the response echoes the command back.
    if [ $_rc -eq 0 ] && printf '%s' "$_result" | tr -d '\r' | grep -qx 'OK'; then
        _egmr_ok="true"
    fi
    if [ "$_egmr_ok" != "true" ]; then
        qlog_error "Failed to write IMEI (rc=$_rc): $_result"
        return 1
    fi

    if [ -f "$IMEI_BACKUP_CONFIG" ]; then
        _b_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$IMEI_BACKUP_CONFIG" 2>/dev/null)
        if [ "$_b_enabled" = "true" ]; then
            touch "$IMEI_CHECK_PENDING"
            qlog_info "Backup enabled — set IMEI check pending flag"
        fi
    fi

    qlog_info "IMEI written successfully (reboot required)"
    return 0
}

# conn_imei_save_backup <enabled true|false> <imei> — atomic write; disabling
# drops the pending check flag. rc 1 on write failure.
conn_imei_save_backup() {
    mkdir -p /etc/qmanager

    jq -n \
        --argjson enabled "$1" \
        --arg imei "$2" \
        '{ enabled: $enabled, imei: $imei }' \
        > "${IMEI_BACKUP_CONFIG}.tmp" && mv "${IMEI_BACKUP_CONFIG}.tmp" "$IMEI_BACKUP_CONFIG"

    if [ $? -ne 0 ]; then
        qlog_error "Failed to write backup config"
        return 1
    fi

    if [ "$1" = "false" ]; then
        rm -f "$IMEI_CHECK_PENDING"
    fi
    return 0
}

# =============================================================================
# IP passthrough (network/ip_passthrough.sh)
# =============================================================================
IPPT_CONFIG="/etc/qmanager/ippt_config.json"

# conn_at_write <cmd> — qcmd write with a positive OK assertion; leaves the
# output/rc in _aw_out/_aw_rc for the caller's log line.
conn_at_write() {
    _aw_out=$(qcmd "$1" 2>/dev/null)
    _aw_rc=$?
    if [ $_aw_rc -ne 0 ]; then
        return $_aw_rc
    fi
    # Line-exact, not a *OK* glob: the response echoes the issued command.
    if printf '%s' "$_aw_out" | tr -d '\r' | grep -qx 'OK'; then
        return 0
    fi
    return 1
}

# conn_ippt_apply <mode> <mac> <nat> <usb> <dns> — validated values: AT writes in
# the CGI's order, then ippt_config.json. The reboot is the caller's.
conn_ippt_apply() {
    local _mode="$1" _mac="$2" _nat="$3" _usb="$4" _dns="$5" _dns_cmd _tmp
    CMD_GAP="${CMD_GAP:-0.2}"

    case "$_mode" in
        disabled)
            if ! conn_at_write 'AT+QMAP="MPDN_rule",0'; then
                qlog_error "MPDN_rule disable failed (rc=$_aw_rc): $_aw_out"
                IPPT_ERR_CODE="mpdn_rule_failed"; IPPT_ERR_DETAIL="Failed to reset MPDN_rule"
                return 1
            fi
            sleep "$CMD_GAP"
            # WAC reset is required when disabling; non-fatal.
            if ! conn_at_write 'AT+QMAPWAC=1'; then
                qlog_warn "QMAPWAC=1 failed (non-fatal, rc=$_aw_rc): $_aw_out"
            fi
            ;;
        eth)
            if ! conn_at_write "AT+QMAP=\"MPDN_rule\",0,1,0,1,1,\"${_mac}\""; then
                qlog_error "MPDN_rule ETH failed (rc=$_aw_rc): $_aw_out"
                IPPT_ERR_CODE="mpdn_rule_failed"; IPPT_ERR_DETAIL="Failed to set ETH passthrough rule"
                return 1
            fi
            ;;
        usb)
            if ! conn_at_write "AT+QMAP=\"MPDN_rule\",0,1,0,3,1,\"${_mac}\""; then
                qlog_error "MPDN_rule USB failed (rc=$_aw_rc): $_aw_out"
                IPPT_ERR_CODE="mpdn_rule_failed"; IPPT_ERR_DETAIL="Failed to set USB passthrough rule"
                return 1
            fi
            ;;
    esac

    sleep "$CMD_GAP"

    if ! conn_at_write "AT+QMAP=\"IPPT_NAT\",${_nat}"; then
        qlog_error "IPPT_NAT failed (rc=$_aw_rc): $_aw_out"
        IPPT_ERR_CODE="ippt_nat_failed"; IPPT_ERR_DETAIL="Failed to set IPPT NAT mode"
        return 1
    fi

    sleep "$CMD_GAP"

    if ! conn_at_write "AT+QCFG=\"usbnet\",${_usb}"; then
        qlog_error "QCFG usbnet failed (rc=$_aw_rc): $_aw_out"
        IPPT_ERR_CODE="usbnet_failed"; IPPT_ERR_DETAIL="Failed to set USB modem protocol"
        return 1
    fi

    sleep "$CMD_GAP"

    case "$_dns" in
        enabled)  _dns_cmd='AT+QMAP="DHCPV4DNS","enable"' ;;
        disabled) _dns_cmd='AT+QMAP="DHCPV4DNS","disable"' ;;
    esac

    if ! conn_at_write "$_dns_cmd"; then
        qlog_error "DHCPV4DNS failed (rc=$_aw_rc): $_aw_out"
        IPPT_ERR_CODE="dhcpv4dns_failed"; IPPT_ERR_DETAIL="Failed to set DNS offloading"
        return 1
    fi

    qlog_info "All settings applied — saving config"

    # Authoritative source for the GET after reboot (atomic temp + mv).
    mkdir -p /etc/qmanager
    _tmp="${IPPT_CONFIG}.tmp"
    if jq -n \
        --arg mode "$_mode" \
        --arg mac  "$_mac" \
        --arg nat  "$_nat" \
        --arg usb  "$_usb" \
        --arg dns  "$_dns" \
        '{mode:$mode, mac:$mac, nat:$nat, usb_mode:$usb, dns_proxy:$dns}' \
        > "$_tmp" 2>/dev/null; then
        mv "$_tmp" "$IPPT_CONFIG" 2>/dev/null || { rm -f "$_tmp"; qlog_warn "Failed to save ippt_config.json"; }
    else
        rm -f "$_tmp"
        qlog_warn "Failed to write ippt_config.json (non-fatal)"
    fi
    return 0
}

# =============================================================================
# SMS (cellular/sms_storage.sh, cellular/sms_forwarding.sh)
# =============================================================================
SMS_PREF_FILE="/etc/qmanager/sms_storage"
SMS_QSMS="/usr/bin/qsms"
SMS_QCMD="/usr/bin/qcmd"
SMS_FWD_CONFIG="/etc/qmanager/sms_forwarding.json"
SMS_FWD_RELOAD_FLAG="/tmp/qmanager_sms_forward_reload"

# Saved storage choice: "SM" only when the file says so, else "ME".
conn_sms_pref() {
    _ss_p=$({ tr -d ' \r\n' < "$SMS_PREF_FILE" | tr 'a-z' 'A-Z'; } 2>/dev/null)
    [ "$_ss_p" = "SM" ] && printf 'SM' || printf 'ME'
}

# Live incoming-message storage (mem3) from AT+CPMS?, or "" on failure.
conn_sms_routing() {
    _ss_line=$("$SMS_QCMD" 'AT+CPMS?' 2>/dev/null | tr -d '\r' | grep '^+CPMS:' | head -n1)
    [ -n "$_ss_line" ] || return 0
    printf '%s' "$_ss_line" | sed 's/^+CPMS: *//' | cut -d, -f7 | tr -d '" '
}

# Point all three CPMS pointers at $1. rc 0 only on an OK final line.
conn_sms_cpms_apply() {
    _ss_out=$("$SMS_QCMD" "AT+CPMS=\"$1\",\"$1\",\"$1\"" 2>/dev/null)
    _ss_rc=$?
    [ "$_ss_rc" -eq 0 ] && printf '%s\n' "$_ss_out" | tr -d '\r' | grep -q '^OK'
}

# Atomic write: same-dir temp, then rename.
conn_sms_write_pref() {
    _ss_tmp="${SMS_PREF_FILE}.tmp.$$"
    if printf '%s\n' "$1" > "$_ss_tmp" && chmod 644 "$_ss_tmp" && mv -f "$_ss_tmp" "$SMS_PREF_FILE"; then
        return 0
    fi
    rm -f "$_ss_tmp" 2>/dev/null
    return 1
}

# conn_sms_storage_set <ME|SM> — save, apply, read back; the previous choice is
# put back on failure. rc 1 with SMS_ERR_CODE / SMS_ERR_DETAIL.
conn_sms_storage_set() {
    local _want="$1" _prev _chk _code _detail
    _prev=$(conn_sms_pref)

    # Refuse SIM storage the modem cannot use, before anything is saved.
    if [ "$_want" = "SM" ]; then
        _chk=$("$SMS_QSMS" status SM 2>/dev/null)
        if ! printf '%s' "$_chk" | jq -e '.success == true' >/dev/null 2>&1; then
            _code=$(printf '%s' "$_chk" | jq -r 'if .error == null then "" else .error end' 2>/dev/null)
            _detail=$(printf '%s' "$_chk" | jq -r 'if .detail == null then "" else .detail end' 2>/dev/null)
            if [ "$_code" = "sms_unavailable" ]; then
                SMS_ERR_CODE="sms_unavailable"
                SMS_ERR_DETAIL="${_detail:-SMS service is not ready yet. Try again in a minute.}"
            else
                qlog_warn "SIM storage unusable: $_detail"
                SMS_ERR_CODE="sim_storage_unavailable"
                SMS_ERR_DETAIL="The SIM has no usable message storage"
            fi
            return 1
        fi
    fi

    if ! conn_sms_write_pref "$_want"; then
        SMS_ERR_CODE="save_failed"; SMS_ERR_DETAIL="Could not save the storage choice"
        return 1
    fi

    if conn_sms_cpms_apply "$_want" && [ "$(conn_sms_routing)" = "$_want" ]; then
        qlog_info "SMS storage set to $_want (was $_prev)"
        return 0
    fi

    # Put the previous choice back so the file and the modem agree.
    conn_sms_write_pref "$_prev"
    conn_sms_cpms_apply "$_prev"
    qlog_error "Failed to apply SMS storage $_want; restored $_prev"
    SMS_ERR_CODE="apply_failed"; SMS_ERR_DETAIL="The modem did not accept the storage change"
    return 1
}

# conn_sms_fwd_save <true|false> <target> — validated values: service control,
# config, reload flag. rc 1 with SMS_ERR_CODE / SMS_ERR_DETAIL; SMS_FWD_WRITE_OK=0
# when the config file itself could not be written (the CGI does not fail on that).
conn_sms_fwd_save() {
    local _enabled="$1" _target="$2" _tmp
    SMS_FWD_WRITE_OK=1

    # Disable first: a failed disable must not leave stale saved state behind.
    if [ "$_enabled" = "false" ]; then
        svc_stop qmanager_sms_forward
        if ! svc_disable qmanager_sms_forward; then
            SMS_ERR_CODE="service_disable_failed"
            SMS_ERR_DETAIL="Settings were not saved: the daemon could not be disabled on boot (rootfs may be read-only)"
            return 1
        fi
    fi

    mkdir -p "$(dirname "$SMS_FWD_CONFIG")" 2>/dev/null

    _tmp="${SMS_FWD_CONFIG}.tmp"
    jq -n \
        --argjson enabled "$_enabled" \
        --arg target_phone "$_target" \
        '{enabled: $enabled, target_phone: $target_phone}' > "$_tmp" \
        && mv "$_tmp" "$SMS_FWD_CONFIG"
    [ $? -eq 0 ] || SMS_FWD_WRITE_OK=0

    # Signal the running daemon to re-read config within one cycle.
    touch "$SMS_FWD_RELOAD_FLAG" 2>/dev/null

    if [ "$_enabled" = "true" ]; then
        if ! svc_enable qmanager_sms_forward; then
            SMS_ERR_CODE="service_enable_failed"
            SMS_ERR_DETAIL="SMS forwarding settings were saved, but the daemon could not be enabled on boot (rootfs may be read-only)"
            return 1
        fi
        svc_restart qmanager_sms_forward
        qlog_info "SMS forwarding enabled, daemon enabled and restarted"
    else
        qlog_info "SMS forwarding disabled, daemon stopped and disabled"
    fi
    return 0
}
