#!/bin/sh
# config_backup_system.sh — Config Backup sections: lan, custom_dns, ethernet, traffic_engine, system.
# Appliers run as www-data and reuse the save paths of the matching CGIs (libs: lan_subnet.sh,
# network_validate.sh, dpi_state.sh, system_validate.sh, system_config.sh).

[ -n "$_CFG_BACKUP_SYSTEM_LOADED" ] && return 0
_CFG_BACKUP_SYSTEM_LOADED=1

for _cbs_f in platform config system_config lan_subnet dpi_state ethtool_helper network_validate system_validate; do
    [ -f "/usr/lib/qmanager/$_cbs_f.sh" ] && . "/usr/lib/qmanager/$_cbs_f.sh"
done
unset _cbs_f

# --- Helpers -----------------------------------------------------------------

# _cbs_bool <file> <jq path> — 1/0 for a boolean (or 0/1), "bad" for anything else, nothing when absent.
_cbs_bool() {
    jq -r "($2) | if . == null then empty elif type == \"boolean\" then (if . then \"1\" else \"0\" end) elif . == 0 or . == 1 then tostring else \"bad\" end" "$1" 2>/dev/null
}

# _cbs_tf <1|0> — JSON boolean.
_cbs_tf() { [ "$1" = "1" ] && echo true || echo false; }

# _cbs_merge <rc> <rc> — the rc that wins: retry outranks invalid outranks ok.
_cbs_merge() {
    if [ "$1" = "$CFG_RC_RETRY" ] || [ "$2" = "$CFG_RC_RETRY" ]; then
        echo "$CFG_RC_RETRY"
    elif [ "$1" != "0" ]; then
        echo "$1"
    else
        echo "$2"
    fi
}

# --- lan ---------------------------------------------------------------------

collect_lan() {
    local cur ip mask start end prefix
    cur=$(qm_lan_read) || { qlog_error "collect lan: cannot read LAN config"; return 1; }
    set -- $cur
    ip=$1; mask=$2; start=$3; end=$4
    prefix=$(qm_lan_mask_to_prefix "$mask") || { qlog_error "collect lan: malformed netmask $mask"; return 1; }
    jq -n --arg ipaddr "$ip" --arg netmask "$mask" --argjson prefix "$prefix" \
        --arg dhcp_start "$start" --arg dhcp_end "$end" \
        '{ipaddr: $ipaddr, netmask: $netmask, prefix: $prefix, dhcp_start: $dhcp_start, dhcp_end: $dhcp_end}'
}

# Only ipaddr + prefix are restored: the helper derives netmask and the DHCP pool from them.
apply_lan() {
    local f="$1" ip prefix cur_ip="" cur_prefix=""
    cfg_count_unknown "$f" '.' "ipaddr netmask prefix dhcp_start dhcp_end"
    ip=$(cfg_get "$f" '.ipaddr')
    prefix=$(cfg_get "$f" '.prefix')
    [ -n "$ip" ] || [ -n "$prefix" ] || return "$CFG_RC_OK"

    if qm_lan_current; then
        cur_ip="$QM_LAN_CUR_IP"
        cur_prefix="$QM_LAN_CUR_PREFIX"
    fi
    [ -n "$ip" ] || ip="$cur_ip"
    [ -n "$prefix" ] || prefix="$cur_prefix"

    if ! qm_lan_check_request "$ip" "$prefix"; then
        CFG_MESSAGE="LAN address: $QM_LAN_ERR_DETAIL"
        return "$CFG_RC_INVALID"
    fi
    [ "$ip" = "$cur_ip" ] && [ "$prefix" = "$cur_prefix" ] && return "$CFG_RC_OK"

    if qm_lan_update_running; then
        CFG_MESSAGE="a software update is running"
        return "$CFG_RC_RETRY"
    fi
    if ! qm_lan_apply_run "$ip" "$prefix"; then
        CFG_MESSAGE="$QM_LAN_ERR_DETAIL"
        [ "$QM_LAN_APPLY_RC" = "2" ] && return "$CFG_RC_INVALID"
        return "$CFG_RC_RETRY"
    fi
    cfg_reboot_required
    return "$CFG_RC_OK"
}

# --- custom_dns --------------------------------------------------------------

collect_custom_dns() {
    qm_dns_read_state
    jq -n --argjson enabled "$QM_DNS_ENABLED" --argjson ignoreCarrier "$QM_DNS_IGNORE" \
        --argjson servers "$QM_DNS_SERVERS_JSON" \
        '{enabled: $enabled, ignoreCarrier: $ignoreCarrier, servers: $servers}'
}

apply_custom_dns() {
    local f="$1" en_x ic_x en ic cur_list target_list="" kept=0 n_decl n_str=0 raw a mode t c
    cfg_count_unknown "$f" '.' "enabled ignoreCarrier servers"

    qm_dns_read_state
    if [ "$QM_DNS_CONF_MISSING" = "1" ]; then
        CFG_MESSAGE="dnsmasq config file not found"
        return "$CFG_RC_INCOMPATIBLE"
    fi
    if [ "$QM_DNS_CORRUPT" = "1" ]; then
        CFG_MESSAGE="the stored custom DNS block is damaged; clear it on the Custom DNS page first"
        return "$CFG_RC_INVALID"
    fi

    en=$QM_DNS_ENABLED
    ic=$QM_DNS_IGNORE
    en_x=$(_cbs_bool "$f" '.enabled')
    ic_x=$(_cbs_bool "$f" '.ignoreCarrier')
    [ "$en_x" = "bad" ] && { cfg_drop; en_x=""; }
    [ "$ic_x" = "bad" ] && { cfg_drop; ic_x=""; }
    [ -n "$en_x" ] && en=$(_cbs_tf "$en_x")
    [ -n "$ic_x" ] && ic=$(_cbs_tf "$ic_x")

    cur_list=$(printf '%s' "$QM_DNS_SERVERS_JSON" | jq -r '.[] | "server=" + .')
    if cfg_has "$f" '.servers'; then
        # The collected form is an array; the POST form (comma string) is accepted too.
        n_decl=$(jq -r 'if (.servers | type) == "array" then (.servers | length) else 0 end' "$f" 2>/dev/null)
        raw=$(jq -r 'if (.servers | type) == "array" then (.servers[] | select(type == "string")) elif (.servers | type) == "string" then (.servers | split(",")[]) else empty end' "$f" 2>/dev/null)
        if [ -n "$raw" ]; then
            while IFS= read -r a; do
                n_str=$((n_str + 1))
                a=$(printf '%s' "$a" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
                if [ -z "$a" ] || ! qm_dns_valid_ip "$a" || [ "$kept" -ge "$QM_DNS_MAX_SERVERS" ]; then
                    cfg_drop
                    continue
                fi
                target_list="${target_list}server=${a}
"
                kept=$((kept + 1))
            done <<EOF
$raw
EOF
        fi
        case "$n_decl" in ''|*[!0-9]*) n_decl=0 ;; esac
        # Non-string array entries never reached the loop.
        [ "$n_decl" -gt "$n_str" ] && cfg_drop $((n_decl - n_str))
    else
        target_list=$(printf '%s' "$cur_list" | sed '/^$/d')
        [ -n "$target_list" ] && target_list="${target_list}
"
    fi

    if [ "$en" = "true" ] && [ -z "$target_list" ]; then
        CFG_MESSAGE="at least one valid DNS server is required to enable Custom DNS"
        return "$CFG_RC_INVALID"
    fi

    # Nothing to do: both disabled, or the same enable/ignore/server set.
    [ "$en" = "false" ] && [ "$QM_DNS_ENABLED" = "false" ] && return "$CFG_RC_OK"
    t=$(printf '%s' "$target_list")
    c=$(printf '%s' "$cur_list")
    [ "$en" = "$QM_DNS_ENABLED" ] && [ "$ic" = "$QM_DNS_IGNORE" ] && [ "$t" = "$c" ] && return "$CFG_RC_OK"

    mode=$(qm_dns_mode)
    if ! qm_dns_mode_available "$mode"; then
        CFG_MESSAGE="Custom DNS is unavailable while DNS Mode is $mode"
        return "$CFG_RC_INCOMPATIBLE"
    fi

    if qm_dns_apply_candidate "$en" "$ic" "$target_list"; then
        return "$CFG_RC_OK"
    fi
    CFG_MESSAGE="$QM_DNS_ERR"
    if [ "$QM_DNS_APPLY_RC" = "8" ]; then
        # Saved, dnsmasq did not reload: a reboot makes it live.
        cfg_reboot_required
        return "$CFG_RC_OK"
    fi
    case "$QM_DNS_ERR" in
        "dnsmasq rejected"*) return "$CFG_RC_INVALID" ;;
    esac
    return "$CFG_RC_RETRY"
}

# --- ethernet ----------------------------------------------------------------

collect_ethernet() {
    jq -n --arg speed_limit "$(qm_eth_persisted)" '{speed_limit: $speed_limit}'
}

apply_ethernet() {
    local f="$1" sp
    cfg_count_unknown "$f" '.' "speed_limit"
    sp=$(cfg_get "$f" '.speed_limit')
    [ -n "$sp" ] || return "$CFG_RC_OK"
    if ! qm_eth_speed_valid "$sp"; then
        CFG_MESSAGE="speed_limit must be one of: auto, 10, 100, 1000, 2500"
        return "$CFG_RC_INVALID"
    fi
    # An apply bounces the link (~8 s); skip when nothing changes.
    [ "$sp" = "$(qm_eth_persisted)" ] && return "$CFG_RC_OK"
    if ! qm_eth_save "$sp"; then
        CFG_MESSAGE="$QM_ETH_ERR_DETAIL"
        [ "$QM_ETH_ERR" = "unsupported_speed" ] && return "$CFG_RC_INCOMPATIBLE"
        [ "$QM_ETH_ERR" = "invalid_speed" ] && return "$CFG_RC_INVALID"
        return "$CFG_RC_RETRY"
    fi
    return "$CFG_RC_OK"
}

# --- traffic_engine ----------------------------------------------------------

collect_traffic_engine() {
    local vo fb sni ft hl
    vo=$(qm_config_get video_optimizer enabled 0)
    fb=$(qm_config_get full_bypass enabled 0)
    sni=$(qm_config_get full_bypass sni_domain 'speedtest.net')
    ft=$(qm_config_get quic force_tcp 0)
    hl=$(dpi_hostlist_json)
    jq -n --argjson vo "$(_cbs_tf "$vo")" --argjson fb "$(_cbs_tf "$fb")" --arg sni "$sni" \
        --argjson ft "$(_cbs_tf "$ft")" --argjson hl "$hl" \
        '{video_optimizer: {enabled: $vo}, full_bypass: {enabled: $fb, sni_domain: $sni},
          quic: {force_tcp: $ft}, hostlist: $hl}'
}

# hostlist -> force_tcp -> engine mode last, so the engine restarts onto the new list.
apply_traffic_engine() {
    local f="$1" rc="$CFG_RC_OK" msg=""
    local vo_c fb_c sni_c ft_c vo_x fb_x sni_x ft_x vo_t fb_t sni_use
    local n_decl lines d kept=0 nloop=0 new cur sm_rc
    cfg_count_unknown "$f" '.' "video_optimizer full_bypass quic hostlist"
    cfg_count_unknown "$f" '.video_optimizer' "enabled"
    cfg_count_unknown "$f" '.full_bypass' "enabled sni_domain"
    cfg_count_unknown "$f" '.quic' "force_tcp"

    # --- hostlist: the backup's set replaces the device's ---
    if cfg_has "$f" '.hostlist'; then
        if [ "$(jq -r '(.hostlist | type) == "array"' "$f" 2>/dev/null)" = "true" ]; then
            n_decl=$(jq -r '.hostlist | length' "$f" 2>/dev/null)
            case "$n_decl" in ''|*[!0-9]*) n_decl=0 ;; esac
            lines=$(jq -r '.hostlist[] | select(type == "string" and (contains("\n") | not))' "$f" 2>/dev/null)
            new=""
            if [ -n "$lines" ]; then
                while IFS= read -r d; do
                    nloop=$((nloop + 1))
                    if dpi_hostname_check "$d" && [ "$kept" -lt 300 ]; then
                        new="${new}${d}
"
                        kept=$((kept + 1))
                    else
                        cfg_drop
                    fi
                done <<EOF
$lines
EOF
            fi
            # Entries that never reached the loop (non-string, multi-line).
            [ "$n_decl" -gt "$nloop" ] && cfg_drop $((n_decl - nloop))
            if [ "$n_decl" -gt 0 ] && [ "$kept" -eq 0 ]; then
                msg="no valid host names in the backup; the device list was kept"
            else
                new=$(printf '%s' "$new" | jq -R . | jq -s -c .)
                cur=$(dpi_hostlist_json | jq -c .)
                if [ "$new" != "$cur" ]; then
                    dpi_hostlist_write "$new" || rc=$(_cbs_merge "$rc" "$CFG_RC_RETRY")
                fi
            fi
        else
            cfg_drop
        fi
    fi

    # --- QUIC force-TCP ---
    ft_x=$(_cbs_bool "$f" '.quic.force_tcp')
    [ "$ft_x" = "bad" ] && { cfg_drop; ft_x=""; }
    ft_c=$(qm_config_get quic force_tcp 0)
    [ "$ft_c" = "1" ] || ft_c=0
    if [ -n "$ft_x" ] && [ "$ft_x" != "$ft_c" ]; then
        dpi_save_force_tcp "$ft_x"
    fi

    # --- engine mode (video optimizer / full bypass are mutually exclusive) ---
    vo_c=$(qm_config_get video_optimizer enabled 0); [ "$vo_c" = "1" ] || vo_c=0
    fb_c=$(qm_config_get full_bypass enabled 0); [ "$fb_c" = "1" ] || fb_c=0
    sni_c=$(qm_config_get full_bypass sni_domain 'speedtest.net')
    vo_x=$(_cbs_bool "$f" '.video_optimizer.enabled')
    fb_x=$(_cbs_bool "$f" '.full_bypass.enabled')
    sni_x=$(cfg_get "$f" '.full_bypass.sni_domain')
    [ "$vo_x" = "bad" ] && { cfg_drop; vo_x=""; }
    [ "$fb_x" = "bad" ] && { cfg_drop; fb_x=""; }
    if [ -n "$sni_x" ] && ! dpi_sni_valid "$sni_x"; then
        cfg_drop
        sni_x=""
    fi

    if [ "$vo_x" = "1" ]; then
        [ "$fb_x" = "1" ] && cfg_drop
        vo_t=1; fb_t=0
    elif [ "$fb_x" = "1" ]; then
        vo_t=0; fb_t=1
    else
        vo_t=${vo_x:-$vo_c}
        fb_t=${fb_x:-$fb_c}
        [ "$vo_t" = "1" ] && [ "$fb_t" = "1" ] && fb_t=0
    fi
    sni_use=${sni_x:-$sni_c}

    sm_rc=0
    if [ "$vo_t" = "1" ]; then
        if [ "$vo_c" != "1" ] || [ "$fb_c" = "1" ]; then
            dpi_save_mode video_optimizer 1
            sm_rc=$?
        fi
    elif [ "$fb_t" = "1" ]; then
        if [ "$fb_c" != "1" ] || [ "$vo_c" = "1" ]; then
            dpi_save_mode full_bypass 1 "$sni_use" restore
            sm_rc=$?
        fi
    elif [ "$vo_c" = "1" ]; then
        dpi_save_mode video_optimizer 0
        sm_rc=$?
    elif [ "$fb_c" = "1" ]; then
        dpi_save_mode full_bypass 0 "$sni_use" restore
        sm_rc=$?
    fi
    case "$sm_rc" in
        2)
            cfg_drop
            msg="tpws is not installed, so the Traffic Engine mode was not turned on"
            ;;
        3)
            msg="settings saved but the Traffic Engine did not start"
            rc=$(_cbs_merge "$rc" "$CFG_RC_INVALID")
            ;;
    esac
    # The inert SNI value follows the backup even when the mode is unchanged.
    if [ -n "$sni_x" ] && [ "$sni_x" != "$(qm_config_get full_bypass sni_domain 'speedtest.net')" ]; then
        qm_config_set full_bypass sni_domain "$sni_x"
    fi

    [ -n "$msg" ] && CFG_MESSAGE="$msg"
    return "$rc"
}

# --- system ------------------------------------------------------------------

collect_system() {
    local ssh out prog
    ssh=$(qm_ts_ssh_pref)
    # Defaults match system/settings.sh and system/update.sh GET; null, false or "" -> default.
    prog='
        def s(k; d): (.settings[k] // "" | tostring) as $x | if $x == "" then d else $x end;
        def u(k; d): (.update[k] // "" | tostring) as $x | if $x == "" then d else $x end;
        def days: s("sched_reboot_days"; "0,1,2,3,4,5,6")
            | (try (split(",") | map(tonumber)) catch [0,1,2,3,4,5,6]);
        {
            settings: {
                temp_unit: s("temp_unit"; "celsius"),
                distance_unit: s("distance_unit"; "km"),
                hostname: s("hostname"; ""),
                timezone: s("timezone"; "UTC0"),
                zonename: s("zonename"; "UTC")
            },
            scheduled_reboot: {
                enabled: (s("sched_reboot_enabled"; "0") == "1"),
                time: s("sched_reboot_time"; "04:00"),
                days: days
            },
            update: {
                include_prerelease: (u("include_prerelease"; "1") == "1"),
                auto_update_enabled: (u("auto_update_enabled"; "0") == "1"),
                auto_update_time: u("auto_update_time"; "03:00")
            },
            tailscale_ssh: ($ssh == "true")
        }'
    out=$(jq --arg ssh "$ssh" "$prog" "$QM_CONFIG" 2>/dev/null)
    [ -n "$out" ] || out=$(jq -n --arg ssh "$ssh" "null | ($prog)" 2>/dev/null)
    [ -n "$out" ] || return 1
    printf '%s\n' "$out"
}

_cbs_sys_settings() {
    local f="$1" rc="$CFG_RC_OK" v tz zn cur_tz cur_zn need st
    v=$(cfg_get "$f" '.settings.temp_unit')
    if [ -n "$v" ]; then
        if ! qm_valid_temp_unit "$v"; then
            cfg_drop
        elif [ "$(qm_config_get settings temp_unit celsius)" != "$v" ]; then
            qm_config_set settings temp_unit "$v" || rc="$CFG_RC_RETRY"
        fi
    fi
    v=$(cfg_get "$f" '.settings.distance_unit')
    if [ -n "$v" ]; then
        if ! qm_valid_distance_unit "$v"; then
            cfg_drop
        elif [ "$(qm_config_get settings distance_unit km)" != "$v" ]; then
            qm_config_set settings distance_unit "$v" || rc="$CFG_RC_RETRY"
        fi
    fi
    # Hostname goes through the same setter as the UI save (config + live name).
    v=$(cfg_get "$f" '.settings.hostname')
    if [ -n "$v" ]; then
        if ! qm_valid_hostname_label "$v"; then
            cfg_drop
        elif [ "$(qm_config_get settings hostname '')" != "$v" ]; then
            sys_set_hostname "$v"
            case $? in
                0) ;;
                2) CFG_MESSAGE="the device name was saved but could not be applied to the system"; rc=$(_cbs_merge "$rc" "$CFG_RC_INVALID") ;;
                *) rc="$CFG_RC_RETRY" ;;
            esac
        fi
    fi

    tz=$(cfg_get "$f" '.settings.timezone')
    zn=$(cfg_get "$f" '.settings.zonename')
    if [ -n "$tz" ] && ! qm_valid_tz_string "$tz"; then cfg_drop; tz=""; fi
    if [ -n "$zn" ] && ! qm_valid_zonename "$zn"; then cfg_drop; zn=""; fi
    cur_tz=$(qm_config_get settings timezone UTC0)
    cur_zn=$(qm_config_get settings zonename UTC)
    # A zonename alone keeps the stored POSIX string; a timezone alone is saved without a live apply.
    [ -z "$tz" ] && [ -n "$zn" ] && tz="$cur_tz"
    if [ -n "$tz" ]; then
        need=0
        [ "$tz" != "$cur_tz" ] && need=1
        [ -n "$zn" ] && [ "$zn" != "$cur_zn" ] && need=1
        if [ "$need" = "0" ] && [ -n "$zn" ]; then
            # Config already matches; re-apply only when the live clock does not.
            set -- $(sys_get_effective_tz)
            [ "$3" = "1" ] || need=1
        fi
        if [ "$need" = "1" ]; then
            st=$(sys_set_timezone "$tz" "$zn")
            if [ "$st" = "failed" ]; then
                CFG_MESSAGE="the time zone could not be applied"
                rc="$CFG_RC_RETRY"
            fi
        fi
    fi
    return "$rc"
}

_cbs_sys_sched() {
    local f="$1" en_x t_x days_x="" n_decl n_ok cur_en cur_t cur_days en t days
    cfg_has "$f" '.scheduled_reboot' || return "$CFG_RC_OK"
    en_x=$(_cbs_bool "$f" '.scheduled_reboot.enabled')
    [ "$en_x" = "bad" ] && { cfg_drop; en_x=""; }
    t_x=$(cfg_get "$f" '.scheduled_reboot.time')
    if [ -n "$t_x" ] && ! qm_valid_hhmm "$t_x"; then cfg_drop; t_x=""; fi
    if cfg_has "$f" '.scheduled_reboot.days'; then
        n_decl=$(jq -r 'if (.scheduled_reboot.days | type) == "array" then (.scheduled_reboot.days | length) else 0 end' "$f" 2>/dev/null)
        days_x=$(jq -r '[.scheduled_reboot.days | if type == "array" then .[] else empty end
            | select(type == "number" and . == floor and . >= 0 and . <= 6)] | unique | map(tostring) | join(",")' "$f" 2>/dev/null)
        if [ -z "$days_x" ]; then
            cfg_drop
        else
            n_ok=$(printf '%s' "$days_x" | tr ',' '\n' | grep -c .)
            case "$n_decl" in ''|*[!0-9]*) n_decl=0 ;; esac
            [ "$n_decl" -gt "$n_ok" ] && cfg_drop $((n_decl - n_ok))
        fi
    fi
    [ -n "$en_x" ] || [ -n "$t_x" ] || [ -n "$days_x" ] || return "$CFG_RC_OK"

    cur_en=$(qm_config_get settings sched_reboot_enabled 0); [ "$cur_en" = "1" ] || cur_en=0
    cur_t=$(qm_config_get settings sched_reboot_time 04:00)
    cur_days=$(qm_config_get settings sched_reboot_days 0,1,2,3,4,5,6)
    en=${en_x:-$cur_en}
    t=${t_x:-$cur_t}
    days=${days_x:-$cur_days}
    [ "$en" = "$cur_en" ] && [ "$t" = "$cur_t" ] && [ "$days" = "$cur_days" ] && return "$CFG_RC_OK"

    if ! qm_sched_reboot_save "$(_cbs_tf "$en")" "$t" "$days"; then
        # Put the stored values back so a retry sees the difference again.
        qm_config_set settings sched_reboot_enabled "$cur_en"
        qm_config_set settings sched_reboot_time "$cur_t"
        qm_config_set settings sched_reboot_days "$cur_days"
        CFG_MESSAGE="the scheduled reboot timer could not be armed"
        return "$CFG_RC_RETRY"
    fi
    return "$CFG_RC_OK"
}

_cbs_sys_update() {
    local f="$1" rc="$CFG_RC_OK" pr_x ae_x at_x cur_pr cur_ae cur_at ae at
    pr_x=$(_cbs_bool "$f" '.update.include_prerelease')
    ae_x=$(_cbs_bool "$f" '.update.auto_update_enabled')
    at_x=$(cfg_get "$f" '.update.auto_update_time')
    [ "$pr_x" = "bad" ] && { cfg_drop; pr_x=""; }
    [ "$ae_x" = "bad" ] && { cfg_drop; ae_x=""; }
    if [ -n "$at_x" ] && ! qm_valid_hhmm "$at_x"; then cfg_drop; at_x=""; fi

    cur_pr=$(qm_config_get update include_prerelease 1); [ "$cur_pr" = "1" ] || cur_pr=0
    if [ -n "$pr_x" ] && [ "$pr_x" != "$cur_pr" ]; then
        qm_update_save_prerelease "$(_cbs_tf "$pr_x")" || rc="$CFG_RC_RETRY"
    fi

    cur_ae=$(qm_config_get update auto_update_enabled 0); [ "$cur_ae" = "1" ] || cur_ae=0
    cur_at=$(qm_config_get update auto_update_time 03:00)
    ae=${ae_x:-$cur_ae}
    at=${at_x:-$cur_at}
    if [ -n "$ae_x$at_x" ] && { [ "$ae" != "$cur_ae" ] || [ "$at" != "$cur_at" ]; }; then
        if ! qm_update_save_auto "$(_cbs_tf "$ae")" "$at"; then
            qm_config_set update auto_update_enabled "$cur_ae"
            qm_config_set update auto_update_time "$cur_at"
            CFG_MESSAGE="the auto-update timer could not be armed"
            rc="$CFG_RC_RETRY"
        fi
    fi
    return "$rc"
}

_cbs_sys_ssh() {
    local f="$1" ss_x cur
    ss_x=$(_cbs_bool "$f" '.tailscale_ssh')
    [ "$ss_x" = "bad" ] && { cfg_drop; return "$CFG_RC_OK"; }
    [ -n "$ss_x" ] || return "$CFG_RC_OK"
    cur=0
    [ "$(qm_ts_ssh_pref)" = "true" ] && cur=1
    [ "$ss_x" = "$cur" ] && return "$CFG_RC_OK"
    if ! qm_ts_ssh_save "$(_cbs_tf "$ss_x")"; then
        CFG_MESSAGE="Tailscale SSH: ${QM_TS_DETAIL:-could not save the preference}"
        return "$CFG_RC_RETRY"
    fi
    return "$CFG_RC_OK"
}

apply_system() {
    local f="$1" rc="$CFG_RC_OK" r
    cfg_count_unknown "$f" '.' "settings scheduled_reboot update tailscale_ssh"
    cfg_count_unknown "$f" '.settings' "temp_unit distance_unit hostname timezone zonename"
    cfg_count_unknown "$f" '.scheduled_reboot' "enabled time days"
    cfg_count_unknown "$f" '.update' "include_prerelease auto_update_enabled auto_update_time"

    _cbs_sys_settings "$f"; r=$?; rc=$(_cbs_merge "$rc" "$r")
    _cbs_sys_sched "$f"; r=$?; rc=$(_cbs_merge "$rc" "$r")
    _cbs_sys_update "$f"; r=$?; rc=$(_cbs_merge "$rc" "$r")
    _cbs_sys_ssh "$f"; r=$?; rc=$(_cbs_merge "$rc" "$r")
    return "$rc"
}
