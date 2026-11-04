#!/bin/sh
# config_backup_connection.sh — Config Backup sections: apn, ttl_mtu, imei, profiles,
# ip_passthrough, sms. Sourced by config_backup_sections.sh; appliers call the same
# validators and writers as the matching CGIs (connection_validate.sh, connection_store.sh).

[ -n "$_CFG_BACKUP_CONNECTION_LOADED" ] && return 0
_CFG_BACKUP_CONNECTION_LOADED=1

for _cfgbk_lib in cgi_at platform ttl_state apn_apply connection_validate connection_store; do
    [ -f "/usr/lib/qmanager/${_cfgbk_lib}.sh" ] && . "/usr/lib/qmanager/${_cfgbk_lib}.sh"
done
unset _cfgbk_lib

# --- shared helpers ----------------------------------------------------------

# 1/0 for a backup value of 1|true / 0|false, else rc 1.
_cfgbk_c_bit() {
    case "$1" in
        1|true) echo 1 ;;
        0|false) echo 0 ;;
        *) return 1 ;;
    esac
}

# Keeps the first failure of a multi-part section: _cfgbk_c_note <rc> <message>.
_cfgbk_c_note() {
    if [ "${_cfgbk_c_rc:-0}" -eq 0 ]; then
        _cfgbk_c_rc="$1"
        _cfgbk_c_msg="$2"
    fi
}

# =============================================================================
# apn — apn_setting.json + apn_names.json
# =============================================================================

collect_apn() {
    local setting names
    setting=$(apn_setting_read) || return 1
    names=$(apn_names_read) || return 1
    jq -n --argjson s "$setting" --argjson n "$names" '{
        apn: (if $s.apn == null then "" else $s.apn end),
        pdp_type: (if $s.pdp_type == null then "ipv4v6" else $s.pdp_type end),
        cid: (if ($s.cid | type) == "number" then $s.cid else 1 end),
        active: (if $s.active == 1 then 1 else 0 end),
        names: (if ($n | type) == "object" then $n else {} end)
    }'
}

# True when the modem already holds <apn>/<pdp_at> on <cid> (AT+CGDCONT? query).
_cfgbk_apn_live_matches() {
    local raw line
    raw=$(run_at 'AT+CGDCONT?') || return 1
    line=$(printf '%s\n' "$raw" | grep "^+CGDCONT: $1,")
    [ -n "$line" ] || return 1
    [ "$(printf '%s' "$line" | awk -F'"' '{print $4}')" = "$2" ] &&
        [ "$(printf '%s' "$line" | awk -F'"' '{print $2}')" = "$3" ]
}

apply_apn() {
    local f="$1" cid val name cur c_active c_apn c_pdp c_cid b_apn b_pdp b_cid b_active
    local want_active a_apn a_pdp a_cid
    _cfgbk_c_rc=0
    _cfgbk_c_msg=""

    cfg_count_unknown "$f" '.' "apn pdp_type cid active names"

    # Profile names: written as-is, keys 1-6 only.
    if cfg_has "$f" '.names'; then
        if jq -e '.names | type == "object"' "$f" >/dev/null 2>&1; then
            cfg_count_unknown "$f" '.names' "1 2 3 4 5 6"
            for cid in 1 2 3 4 5 6; do
                cfg_has "$f" ".names[\"$cid\"]" || continue
                if ! jq -e ".names[\"$cid\"] | type == \"string\"" "$f" >/dev/null 2>&1; then
                    cfg_drop
                    continue
                fi
                name=$(jq -r ".names[\"$cid\"]" "$f")
                [ "$name" = "$(apn_names_read | jq -r ".[\"$cid\"] // empty")" ] && continue
                apn_name_write "$cid" "$name" || _cfgbk_c_note "$CFG_RC_RETRY" "Could not save APN profile names"
            done
        else
            cfg_drop
        fi
    fi

    cur=$(apn_setting_read)
    c_active=$(printf '%s' "$cur" | jq -r 'if .active == 1 then 1 else 0 end')
    c_apn=$(printf '%s' "$cur" | jq -r 'if .apn == null then "" else .apn end')
    c_pdp=$(printf '%s' "$cur" | jq -r 'if .pdp_type == null then "ipv4v6" else .pdp_type end')
    c_cid=$(printf '%s' "$cur" | jq -r 'if .cid == null then 1 else .cid end')
    case "$c_cid" in ''|*[!0-9]*) c_cid=1 ;; esac

    b_apn=""; b_pdp=""; b_cid=""; b_active=""
    if cfg_has "$f" '.apn'; then
        if jq -e '.apn | type == "string"' "$f" >/dev/null 2>&1; then b_apn=$(jq -r '.apn' "$f"); else cfg_drop; fi
    fi
    if cfg_has "$f" '.pdp_type'; then
        val=$(cfg_get "$f" '.pdp_type')
        if [ -n "$(pdp_to_at "$val")" ]; then b_pdp="$val"; else cfg_drop; fi
    fi
    if cfg_has "$f" '.cid'; then
        val=$(cfg_get "$f" '.cid')
        if conn_validate_cid "$val" 6; then b_cid="$val"; else cfg_drop; fi
    fi
    if cfg_has "$f" '.active'; then
        val=$(cfg_get "$f" '.active')
        b_active=$(_cfgbk_c_bit "$val") || { cfg_drop; b_active=""; }
    fi

    want_active="${b_active:-$c_active}"
    a_apn="${b_apn:-$c_apn}"
    a_pdp="${b_pdp:-$c_pdp}"
    a_cid="${b_cid:-$c_cid}"

    if [ "$want_active" = "1" ]; then
        if ! conn_validate_apn_setting "$a_apn" "$a_pdp"; then
            _cfgbk_c_note "$CFG_RC_INVALID" "$CONN_ERR_DETAIL"
        elif [ "$c_active" = "1" ] && [ "$a_apn" = "$c_apn" ] && [ "$a_pdp" = "$c_pdp" ] && [ "$a_cid" = "$c_cid" ] &&
            _cfgbk_apn_live_matches "$a_cid" "$a_apn" "$(pdp_to_at "$a_pdp")"; then
            :
        else
            # Attach cycle drops the WAN for a few seconds.
            if ! apn_setting_apply "$a_cid" "$a_pdp" "$a_apn"; then
                case "$APN_ERR_CODE" in
                    apn_mismatch) _cfgbk_c_note "$CFG_RC_INVALID" "$APN_ERR_DETAIL" ;;
                    apn_busy) _cfgbk_c_note "$CFG_RC_RETRY" "$APN_ERR_DETAIL" ;;
                    *) cfg_at_failed "$APN_ERR_DETAIL"; _cfgbk_c_note "$?" "$CFG_MESSAGE" ;;
                esac
            elif [ "$APN_SAVE_PERSISTED" != "1" ]; then
                _cfgbk_c_note "$CFG_RC_RETRY" "APN applied but the setting could not be saved"
            fi
        fi
    elif [ "$c_active" = "1" ]; then
        if ! apn_setting_deactivate; then
            case "$APN_ERR_CODE" in
                apn_busy) _cfgbk_c_note "$CFG_RC_RETRY" "$APN_ERR_DETAIL" ;;
                *) cfg_at_failed "$APN_ERR_DETAIL"; _cfgbk_c_note "$?" "$CFG_MESSAGE" ;;
            esac
        fi
    elif [ "$a_pdp" != "$c_pdp" ] || [ "$a_cid" != "$c_cid" ]; then
        apn_setting_write "" "$a_pdp" "$a_cid" 0 || _cfgbk_c_note "$CFG_RC_RETRY" "Could not save the APN setting"
    fi

    CFG_MESSAGE="$_cfgbk_c_msg"
    return "$_cfgbk_c_rc"
}

# =============================================================================
# ttl_mtu — /etc/qmanager/ttl_state + /etc/firewall.user.mtu
# =============================================================================

# Prints the configured MTU, or "disable" when no custom MTU is set.
_cfgbk_mtu_configured() {
    local v=""
    [ -f "$MTU_FIREWALL_FILE" ] && v=$(sed -n 's/.* mtu \([0-9][0-9]*\).*/\1/p' "$MTU_FIREWALL_FILE" 2>/dev/null | head -n 1)
    printf '%s' "${v:-disable}"
}

collect_ttl_mtu() {
    local ttl hl mtu
    set -- $(ttl_state_read_persisted)
    ttl="$1"
    hl="$2"
    mtu=$(_cfgbk_mtu_configured)
    jq -n --argjson ttl "${ttl:-0}" --argjson hl "${hl:-0}" --arg mtu "$mtu" \
        '{ttl: $ttl, hl: $hl, mtu: (if $mtu == "disable" then "disable" else ($mtu | tonumber) end)}'
}

apply_ttl_mtu() {
    local f="$1" val c_ttl c_hl n_ttl n_hl touched=0 cur_mtu
    _cfgbk_c_rc=0
    _cfgbk_c_msg=""

    cfg_count_unknown "$f" '.' "ttl hl mtu"

    set -- $(ttl_state_read_persisted)
    c_ttl="$1"
    c_hl="$2"
    n_ttl="$c_ttl"
    n_hl="$c_hl"

    if cfg_has "$f" '.ttl'; then
        val=$(cfg_get "$f" '.ttl')
        if ttl_state_validate_field TTL "$val"; then n_ttl="$val"; touched=1; else cfg_drop; fi
    fi
    if cfg_has "$f" '.hl'; then
        val=$(cfg_get "$f" '.hl')
        if ttl_state_validate_field HL "$val"; then n_hl="$val"; touched=1; else cfg_drop; fi
    fi

    if [ "$touched" = "1" ]; then
        if ! ttl_state_apply "$n_ttl" "$n_hl"; then
            _cfgbk_c_note "$CFG_RC_RETRY" "Failed to apply iptables rules"
        elif ! ttl_state_write_persisted "$n_ttl" "$n_hl"; then
            _cfgbk_c_note "$CFG_RC_RETRY" "Rules applied but failed to persist to disk"
        fi
    fi

    if cfg_has "$f" '.mtu'; then
        val=$(cfg_get "$f" '.mtu')
        cur_mtu=$(_cfgbk_mtu_configured)
        if [ "$val" = "disable" ]; then
            if [ "$cur_mtu" != "disable" ] && ! conn_mtu_disable; then
                _cfgbk_c_note "$CFG_RC_INVALID" "MTU could not be reset"
            fi
        elif conn_validate_mtu "$val"; then
            if [ "$val" != "$cur_mtu" ] && ! conn_mtu_set "$val"; then
                _cfgbk_c_note "$CFG_RC_INVALID" "MTU could not be applied"
            fi
        else
            cfg_drop
        fi
    fi

    CFG_MESSAGE="$_cfgbk_c_msg"
    return "$_cfgbk_c_rc"
}

# =============================================================================
# imei — modem IMEI + imei_backup.json
# =============================================================================

# Prints "<enabled> <imei>" from imei_backup.json (false and empty when absent).
_cfgbk_imei_backup_state() {
    local en="false" bi=""
    if [ -f "$IMEI_BACKUP_CONFIG" ]; then
        en=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$IMEI_BACKUP_CONFIG" 2>/dev/null)
        bi=$(jq -r '.imei // ""' "$IMEI_BACKUP_CONFIG" 2>/dev/null)
    fi
    case "$en" in true) ;; *) en="false" ;; esac
    printf '%s %s\n' "$en" "$bi"
}

collect_imei() {
    local cur en bi
    cur=$(conn_imei_current)
    set -- $(_cfgbk_imei_backup_state)
    en="$1"
    bi="$2"
    jq -n --arg imei "$cur" --argjson en "$en" --arg bi "$bi" \
        '{imei: $imei, backup: {enabled: $en, imei: $bi}}'
}

apply_imei() {
    local f="$1" b_imei="" cur_imei val c_en c_bi n_en n_bi write=0
    _cfgbk_c_rc=0
    _cfgbk_c_msg=""

    cfg_count_unknown "$f" '.' "imei backup"
    cfg_count_unknown "$f" '.backup' "enabled imei"

    if cfg_has "$f" '.imei'; then
        val=$(cfg_get "$f" '.imei')
        if [ -z "$val" ]; then
            :
        elif validate_imei "$val"; then
            b_imei="$val"
        else
            cfg_drop
        fi
    fi

    # An IMEI that differs from this modem's is written only when the user confirmed it.
    if [ -n "$b_imei" ]; then
        cur_imei=$(conn_imei_current)
        if [ -z "$cur_imei" ]; then
            CFG_MESSAGE="Could not read the modem IMEI"
            return "$CFG_RC_RETRY"
        fi
        if [ "$cur_imei" != "$b_imei" ]; then
            if [ "$(cfg_option imei_confirmed)" != "true" ]; then
                CFG_MESSAGE="IMEI change not confirmed"
                return "$CFG_RC_INVALID"
            fi
            write=1
        fi
    fi

    if cfg_has "$f" '.backup'; then
        set -- $(_cfgbk_imei_backup_state)
        c_en="$1"
        c_bi="$2"
        n_en="$c_en"
        n_bi="$c_bi"
        if cfg_has "$f" '.backup.enabled'; then
            val=$(cfg_get "$f" '.backup.enabled')
            case "$val" in true|false) n_en="$val" ;; *) cfg_drop ;; esac
        fi
        if cfg_has "$f" '.backup.imei'; then
            if jq -e '.backup.imei | type == "string"' "$f" >/dev/null 2>&1; then
                n_bi=$(jq -r '.backup.imei' "$f")
            else
                cfg_drop
            fi
        fi
        if [ "$n_en" != "$c_en" ] || [ "$n_bi" != "$c_bi" ]; then
            if conn_validate_imei_backup "$n_en" "$n_bi"; then
                conn_imei_save_backup "$n_en" "$n_bi" || _cfgbk_c_note "$CFG_RC_RETRY" "Failed to save backup configuration"
            else
                cfg_drop
            fi
        fi
    fi

    if [ "$write" = "1" ]; then
        if conn_imei_write "$b_imei"; then
            cfg_reboot_required
        else
            cfg_at_failed "Failed to write IMEI to modem"
            _cfgbk_c_note "$?" "$CFG_MESSAGE"
        fi
    fi

    CFG_MESSAGE="$_cfgbk_c_msg"
    return "$_cfgbk_c_rc"
}

# =============================================================================
# profiles — /etc/qmanager/profiles/*.json + active_profile
# =============================================================================

_cfgbk_need_profile_mgr() {
    command -v profile_get >/dev/null 2>&1 || . /usr/lib/qmanager/profile_mgr.sh
}

# Ids become file names: only p_<digits>_<hex>, nothing else.
_cfgbk_profile_id_ok() {
    case "$1" in
        p_[0-9]*_[0-9a-f]*) ;;
        *) return 1 ;;
    esac
    case "$1" in
        *[!A-Za-z0-9_]*) return 1 ;;
    esac
    [ "${#1}" -le 40 ]
}

# Canonical ICCID of the inserted SIM (poller cache, then AT+QCCID); empty if unknown.
_cfgbk_current_iccid() {
    local i
    i=$(jq -r '(.device.iccid) | if . == null then empty else . end' /tmp/qmanager_status.json 2>/dev/null)
    if [ -z "$i" ]; then
        i=$(qcmd 'AT+QCCID' 2>/dev/null | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
    fi
    iccid_canonicalize "$i"
}

collect_profiles() {
    local arr="[]" f id one new active
    _cfgbk_need_profile_mgr
    for f in "$PROFILE_DIR"/p_*.json; do
        [ -f "$f" ] || continue
        id=$(basename "$f" .json)
        one=$(profile_get "$id" 2>/dev/null) || continue
        new=$(printf '%s' "$arr" | jq -c --argjson p "$one" '. + [$p | {
            id, name, mno, sim_iccid, created_at,
            cid: .settings.apn.cid, apn_name: .settings.apn.name, pdp_type: .settings.apn.pdp_type,
            imei: .settings.imei, ttl: .settings.ttl, hl: .settings.hl, scenario
        }]' 2>/dev/null) || continue
        [ -n "$new" ] && arr="$new"
    done
    active=$(get_active_profile)
    jq -n --argjson p "$arr" --arg a "$active" '{profiles: $p, active_profile: $a}'
}

apply_profiles() {
    local f="$1" real_dir stage n i entry id pimei cur_imei="" confirmed seen="" count=0 cleared=0
    local pf bn old_active new_active want pf_iccid cur_iccid="" rc=0 msg="" fail=0 replace=0 activated=0
    _cfgbk_need_profile_mgr
    CFG_MESSAGE=""

    cfg_count_unknown "$f" '.' "profiles active_profile"
    confirmed=$(cfg_option imei_confirmed)
    real_dir="$PROFILE_DIR"

    if cfg_has "$f" '.profiles'; then
        if ! jq -e '.profiles | type == "array"' "$f" >/dev/null 2>&1; then
            CFG_MESSAGE="profiles is not a list"
            return "$CFG_RC_INVALID"
        fi
        replace=1
        n=$(jq -r '.profiles | length' "$f")

        # Validate and write each entry through profile_save into a staging dir.
        stage="/etc/qmanager/.profiles.cfgbk.$$"
        rm -rf "$stage"
        mkdir "$stage" 2>/dev/null || { CFG_MESSAGE="Could not create a staging directory"; return "$CFG_RC_RETRY"; }
        PROFILE_DIR="$stage"
        PROFILE_SAVE_KEEP_ID=1
        i=0
        while [ "$i" -lt "$n" ]; do
            entry=$(jq -c ".profiles[$i]" "$f")
            cfg_count_unknown "$f" ".profiles[$i]" "id name mno sim_iccid created_at updated_at cid apn_name pdp_type imei ttl hl scenario"
            id=$(printf '%s' "$entry" | jq -r '(.id) | if type == "string" then . else empty end' 2>/dev/null)
            i=$((i + 1))
            if ! printf '%s' "$entry" | jq -e 'type == "object"' >/dev/null 2>&1 ||
                ! _cfgbk_profile_id_ok "$id"; then
                cfg_drop
                continue
            fi
            case " $seen " in *" $id "*) cfg_drop; continue ;; esac

            # A profile IMEI that differs from this modem's is kept only when confirmed.
            pimei=$(printf '%s' "$entry" | jq -r '(.imei) | if type == "string" then . else "" end' 2>/dev/null)
            if [ -n "$pimei" ] && validate_imei "$pimei" && [ "$confirmed" != "true" ]; then
                [ -n "$cur_imei" ] || cur_imei=$(conn_imei_current)
                if [ "$pimei" != "$cur_imei" ]; then
                    entry=$(printf '%s' "$entry" | jq -c '.imei = ""')
                    cleared=$((cleared + 1))
                fi
            fi

            if printf '%s' "$entry" | profile_save 2>/dev/null | jq -e '.success == true' >/dev/null 2>&1; then
                seen="$seen $id"
                count=$((count + 1))
            else
                cfg_drop
            fi
        done
        PROFILE_DIR="$real_dir"
        unset PROFILE_SAVE_KEEP_ID

        # Never wipe the device's set because a backup held nothing usable.
        if [ "$n" -gt 0 ] && [ "$count" -eq 0 ]; then
            rm -rf "$stage"
            CFG_MESSAGE="No valid profiles in the backup"
            return "$CFG_RC_INVALID"
        fi

        old_active=$(get_active_profile)
        for pf in "$real_dir"/p_*.json; do
            [ -f "$pf" ] || continue
            bn=$(basename "$pf" .json)
            case " $seen " in *" $bn "*) ;; *) rm -f "$pf" ;; esac
        done
        for pf in "$stage"/p_*.json; do
            [ -f "$pf" ] || continue
            mv -f "$pf" "$real_dir/" 2>/dev/null || fail=1
        done
        rm -rf "$stage"
        if [ "$fail" = "1" ]; then
            CFG_MESSAGE="Could not write the profiles"
            return "$CFG_RC_RETRY"
        fi
        [ "$cleared" -gt 0 ] && { cfg_drop "$cleared"; msg="$cleared profile IMEI value(s) cleared (change not confirmed)"; }
    else
        old_active=$(get_active_profile)
    fi

    # Active pointer: absent keeps the device's, "" clears it, an id must be in the set.
    if cfg_has "$f" '.active_profile'; then
        want=$(cfg_get "$f" '.active_profile')
        if [ -n "$want" ] && { ! _cfgbk_profile_id_ok "$want" || [ ! -f "$real_dir/${want}.json" ]; }; then
            cfg_drop
            want=""
        fi
        if [ -z "$want" ]; then
            clear_active_profile
        else
            pf_iccid=$(jq -r '(.sim_iccid) | if type == "string" then . else "" end' "$real_dir/${want}.json" 2>/dev/null)
            cur_iccid=""
            [ -n "$pf_iccid" ] && cur_iccid=$(_cfgbk_current_iccid)
            if [ -n "$pf_iccid" ] && { [ -z "$cur_iccid" ] || [ "$cur_iccid" != "$(iccid_canonicalize "$pf_iccid")" ]; }; then
                # The set is written; the active profile belongs to another SIM.
                rc="$CFG_RC_SIM_MISMATCH"
                msg="${msg:+$msg; }Active profile belongs to a different SIM; not activated"
            else
                printf '%s' "$want" | cfg_write_file "$ACTIVE_PROFILE_FILE" 644 || {
                    CFG_MESSAGE="Could not write the active profile"
                    return "$CFG_RC_RETRY"
                }
                activated=1
            fi
        fi
    fi

    # A marker left pointing at a removed profile is cleared.
    [ -f "$ACTIVE_PROFILE_FILE" ] && [ -z "$(get_active_profile)" ] && clear_active_profile

    # Removed or replaced active profile: tear down its scenario schedule timer.
    new_active=$(get_active_profile)
    if [ -n "$old_active" ] && [ "$new_active" != "$old_active" ]; then
        _profile_teardown_scenario_schedule
    fi

    # Boot auto-apply matches profiles by ICCID, so a reboot applies what was restored.
    if [ "$activated" = "1" ]; then
        cfg_reboot_required
    elif [ "$replace" = "1" ]; then
        [ -n "$cur_iccid" ] || cur_iccid=$(_cfgbk_current_iccid)
        if [ -n "$cur_iccid" ] && find_profile_by_iccid "$cur_iccid" >/dev/null; then
            cfg_reboot_required
        fi
    fi

    CFG_MESSAGE="$msg"
    return "$rc"
}

# =============================================================================
# ip_passthrough — /etc/qmanager/ippt_config.json + AT+QMAP / AT+QCFG
# =============================================================================

# Same source order as the CGI GET: config file, then the poller cache.
collect_ip_passthrough() {
    local mode mac nat usb dns
    if [ -f "$IPPT_CONFIG" ]; then
        mode=$(jq -r '.mode // "disabled"' "$IPPT_CONFIG" 2>/dev/null)
        mac=$(jq -r '.mac // ""' "$IPPT_CONFIG" 2>/dev/null)
        nat=$(jq -r '.nat // "1"' "$IPPT_CONFIG" 2>/dev/null)
        usb=$(jq -r '.usb_mode // "1"' "$IPPT_CONFIG" 2>/dev/null)
        dns=$(jq -r '.dns_proxy // "disabled"' "$IPPT_CONFIG" 2>/dev/null)
    else
        mode=$(jq -r '.device.ippt_mode // "disabled"' /tmp/qmanager_status.json 2>/dev/null)
        mac=$(jq -r '.device.ippt_mac // ""' /tmp/qmanager_status.json 2>/dev/null)
        nat=$(jq -r '.device.ippt_nat // "1"' /tmp/qmanager_status.json 2>/dev/null)
        usb=$(jq -r '.device.ippt_usbnet // "1"' /tmp/qmanager_status.json 2>/dev/null)
        dns=$(jq -r '.device.ippt_dhcpv4dns // "disabled"' /tmp/qmanager_status.json 2>/dev/null)
    fi
    case "$mode" in disabled|eth|usb) ;; *) mode="disabled" ;; esac
    case "$nat" in 0|1) ;; *) nat="1" ;; esac
    case "$usb" in 0|1|2|3) ;; *) usb="1" ;; esac
    case "$dns" in enabled|disabled) ;; *) dns="disabled" ;; esac
    jq -n --arg mode "$mode" --arg mac "$mac" --arg nat "$nat" --arg usb "$usb" --arg dns "$dns" \
        '{passthrough_mode: $mode, target_mac: $mac, ippt_nat: $nat, usb_mode: $usb, dns_proxy: $dns}'
}

apply_ip_passthrough() {
    local f="$1" cur val c_mode c_mac c_nat c_usb c_dns n_mode n_mac n_nat n_usb n_dns
    CFG_MESSAGE=""

    cfg_count_unknown "$f" '.' "passthrough_mode target_mac ippt_nat usb_mode dns_proxy"

    cur=$(collect_ip_passthrough) || { CFG_MESSAGE="Could not read the current setting"; return "$CFG_RC_RETRY"; }
    c_mode=$(printf '%s' "$cur" | jq -r '.passthrough_mode')
    c_mac=$(printf '%s' "$cur" | jq -r '.target_mac')
    c_nat=$(printf '%s' "$cur" | jq -r '.ippt_nat')
    c_usb=$(printf '%s' "$cur" | jq -r '.usb_mode')
    c_dns=$(printf '%s' "$cur" | jq -r '.dns_proxy')
    n_mode="$c_mode"; n_mac="$c_mac"; n_nat="$c_nat"; n_usb="$c_usb"; n_dns="$c_dns"

    if cfg_has "$f" '.passthrough_mode'; then
        val=$(cfg_get "$f" '.passthrough_mode')
        if conn_validate_ippt_mode "$val"; then n_mode="$val"; else cfg_drop; fi
    fi
    if cfg_has "$f" '.target_mac'; then
        val=$(cfg_get "$f" '.target_mac')
        if [ -z "$val" ] || conn_validate_mac "$val"; then n_mac="$val"; else cfg_drop; fi
    fi
    if cfg_has "$f" '.ippt_nat'; then
        val=$(cfg_get "$f" '.ippt_nat')
        if conn_validate_ippt_nat "$val"; then n_nat="$val"; else cfg_drop; fi
    fi
    if cfg_has "$f" '.usb_mode'; then
        val=$(cfg_get "$f" '.usb_mode')
        if conn_validate_ippt_usb "$val"; then n_usb="$val"; else cfg_drop; fi
    fi
    if cfg_has "$f" '.dns_proxy'; then
        val=$(cfg_get "$f" '.dns_proxy')
        if conn_validate_ippt_dns "$val"; then n_dns="$val"; else cfg_drop; fi
    fi

    if ! conn_validate_ippt "$n_mode" "$n_mac" "$n_nat" "$n_usb" "$n_dns"; then
        CFG_MESSAGE="$CONN_ERR_DETAIL"
        return "$CFG_RC_INVALID"
    fi

    # Nothing changed: no AT writes and no reboot.
    if [ "$n_mode" = "$c_mode" ] && [ "$n_mac" = "$c_mac" ] && [ "$n_nat" = "$c_nat" ] &&
        [ "$n_usb" = "$c_usb" ] && [ "$n_dns" = "$c_dns" ]; then
        return 0
    fi

    if ! conn_ippt_apply "$n_mode" "$n_mac" "$n_nat" "$n_usb" "$n_dns"; then
        cfg_at_failed "$IPPT_ERR_DETAIL"
        return $?
    fi
    cfg_reboot_required
    return 0
}

# =============================================================================
# sms — sms_storage + sms_forwarding.json (sms_sent.json is never touched)
# =============================================================================

collect_sms() {
    local en="false" tp=""
    if [ -f "$SMS_FWD_CONFIG" ]; then
        en=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$SMS_FWD_CONFIG" 2>/dev/null)
        [ "$en" = "true" ] || en="false"
        tp=$(jq -r '.target_phone // ""' "$SMS_FWD_CONFIG" 2>/dev/null)
    fi
    jq -n --arg storage "$(conn_sms_pref)" --argjson en "$en" --arg tp "$tp" \
        '{storage: $storage, forwarding: {enabled: $en, target_phone: $tp}}'
}

apply_sms() {
    local f="$1" val c_en c_tp n_en n_tp
    _cfgbk_c_rc=0
    _cfgbk_c_msg=""

    cfg_count_unknown "$f" '.' "storage forwarding"
    cfg_count_unknown "$f" '.forwarding' "enabled target_phone"

    if cfg_has "$f" '.storage'; then
        val=$(cfg_get "$f" '.storage')
        if ! conn_validate_sms_storage "$val"; then
            cfg_drop
        elif [ "$val" = "$(conn_sms_pref)" ] && [ "$val" = "$(conn_sms_routing)" ]; then
            :
        elif ! conn_sms_storage_set "$val"; then
            case "$SMS_ERR_CODE" in
                sim_storage_unavailable) _cfgbk_c_note "$CFG_RC_INCOMPATIBLE" "$SMS_ERR_DETAIL" ;;
                apply_failed) cfg_at_failed "$SMS_ERR_DETAIL"; _cfgbk_c_note "$?" "$CFG_MESSAGE" ;;
                *) _cfgbk_c_note "$CFG_RC_RETRY" "$SMS_ERR_DETAIL" ;;
            esac
        fi
    fi

    if cfg_has "$f" '.forwarding'; then
        if ! jq -e '.forwarding | type == "object"' "$f" >/dev/null 2>&1; then
            cfg_drop
        else
            c_en="false"
            c_tp=""
            if [ -f "$SMS_FWD_CONFIG" ]; then
                c_en=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$SMS_FWD_CONFIG" 2>/dev/null)
                [ "$c_en" = "true" ] || c_en="false"
                c_tp=$(jq -r '.target_phone // ""' "$SMS_FWD_CONFIG" 2>/dev/null)
            fi
            n_en="$c_en"
            n_tp="$c_tp"
            if cfg_has "$f" '.forwarding.enabled'; then
                val=$(cfg_get "$f" '.forwarding.enabled')
                case "$val" in
                    true|1) n_en="true" ;;
                    false|0) n_en="false" ;;
                    *) cfg_drop ;;
                esac
            fi
            if cfg_has "$f" '.forwarding.target_phone'; then
                if jq -e '.forwarding.target_phone | type == "string"' "$f" >/dev/null 2>&1; then
                    n_tp=$(jq -r '.forwarding.target_phone' "$f")
                else
                    cfg_drop
                fi
            fi

            if [ "$n_en" = "true" ] && ! conn_validate_phone "$n_tp"; then
                _cfgbk_c_note "$CFG_RC_INVALID" "target_phone is not a valid phone number"
            elif [ "$n_en" != "$c_en" ] || [ "$n_tp" != "$c_tp" ]; then
                if ! conn_sms_fwd_save "$n_en" "$n_tp"; then
                    _cfgbk_c_note "$CFG_RC_RETRY" "$SMS_ERR_DETAIL"
                elif [ "$SMS_FWD_WRITE_OK" != "1" ]; then
                    _cfgbk_c_note "$CFG_RC_RETRY" "Could not save SMS forwarding settings"
                fi
            fi
        fi
    fi

    CFG_MESSAGE="$_cfgbk_c_msg"
    return "$_cfgbk_c_rc"
}
