#!/bin/sh
# config_backup_monitoring.sh — Config Backup sections: watchdog, quality, sites, alerts.
# Appliers save through monitoring_validate.sh, the same validators and savers the CGIs use.
# Secrets are never collected or restored; token_set / app_password_set keep the device's values.

[ -n "${_CFGBK_MONITORING_LOADED:-}" ] && return 0
_CFGBK_MONITORING_LOADED=1

_MVB_LIB="${QM_LIB_DIR:-/usr/lib/qmanager}"
# Without the lib the sections stay undefined and are reported as not supported.
[ -f "$_MVB_LIB/monitoring_validate.sh" ] || return 0

if [ -f "$_MVB_LIB/wd_common.sh" ]; then
    . "$_MVB_LIB/wd_common.sh"
else
    WD_KEYS=""; wd_key_spec() { return 1; }; wd_key_valid() { return 1; }; wd_key_get() { return 1; }
fi
. "$_MVB_LIB/monitoring_validate.sh"

# Routing events reduced to the known events and channels with boolean values.
_MVB_ROUTING_SANITIZE='if type == "object" then with_entries(select(.key == "connection_lost" or .key == "connection_restored" or .key == "reboot") | .value |= (if type == "object" then with_entries(select((.key == "sms" or .key == "email" or .key == "discord") and (.value | type) == "boolean")) else {} end)) else {} end'

# _mvb_has_key <file> <jq-path> <key>: the object at the path carries the key (null counts as present).
_mvb_has_key() {
    jq -e "($2) | type == \"object\" and has(\"$3\")" "$1" >/dev/null 2>&1
}

# _mvb_file_get <file> <jq-filter> <default>: raw value from a config file, the default when absent or empty.
_mvb_file_get() {
    local v=""
    [ -f "$1" ] && v=$(jq -r "$2" "$1" 2>/dev/null </dev/null)
    [ -n "$v" ] || v="$3"
    printf '%s' "$v"
}

# =============================================================================
# watchdog
# =============================================================================

collect_watchdog() {
    local en ft ci cdn t1 t2 t3 t4 bs mr wd
    en=$(qm_config_get watchcat enabled 0)
    ft=$(qm_config_get watchcat fail_threshold "")
    [ -n "$ft" ] || ft=$(qm_config_get watchcat max_failures 5)
    ci=$(qm_config_get watchcat check_interval 10)
    cdn=$(qm_config_get watchcat cooldown 60)
    t1=$(qm_config_get watchcat tier1_enabled 1)
    t2=$(qm_config_get watchcat tier2_enabled 1)
    t3=$(qm_config_get watchcat tier3_enabled 0)
    t4=$(qm_config_get watchcat tier4_enabled 1)
    bs=$(qm_config_get watchcat backup_sim_slot "")
    mr=$(qm_config_get watchcat max_reboots_per_hour 3)
    mv_wd_check fail_threshold "$ft" >/dev/null || ft=5
    mv_wd_check check_interval "$ci" >/dev/null || ci=10
    mv_wd_check cooldown "$cdn" >/dev/null || cdn=60
    mv_wd_check max_reboots_per_hour "$mr" >/dev/null || mr=3
    case "$bs" in 1|2) ;; *) bs=null ;; esac
    wd=$(mv_wd_keys_json)
    [ -n "$wd" ] || wd='{}'
    jq -n --arg en "$en" --argjson ft "$ft" --argjson ci "$ci" --argjson cdn "$cdn" \
        --arg t1 "$t1" --arg t2 "$t2" --arg t3 "$t3" --arg t4 "$t4" \
        --argjson bs "$bs" --argjson mr "$mr" --argjson wd "$wd" \
        '{enabled: ($en == "1"), fail_threshold: $ft, check_interval: $ci, cooldown: $cdn,
          tier1_enabled: ($t1 == "1"), tier2_enabled: ($t2 == "1"),
          tier3_enabled: ($t3 == "1"), tier4_enabled: ($t4 == "1"),
          backup_sim_slot: $bs, max_reboots_per_hour: $mr} + $wd'
}

# probe_interval is Connection Quality's interval_sec, so it travels in `quality`, not here.
# A backup_sim_slot key that is present but null clears the slot; absent keeps the device's.
apply_watchdog() {
    local f="$1" k v r n=0 rc
    cfg_count_unknown "$f" '.' "enabled fail_threshold check_interval cooldown tier1_enabled tier2_enabled tier3_enabled tier4_enabled backup_sim_slot max_reboots_per_hour $WD_KEYS"

    f_enabled=""; f_fail_threshold=""; f_probe_interval=""; f_check_interval=""; f_cooldown=""
    f_tier1=""; f_tier2=""; f_tier3=""; f_tier4=""; f_backup_sim_slot=""; f_max_reboots=""; wd_writes=""

    v=$(cfg_get "$f" '.enabled')
    if [ -n "$v" ]; then
        case "$v" in true|false) f_enabled="$v"; n=$((n + 1)) ;; *) cfg_drop ;; esac
    fi
    for k in tier1_enabled tier2_enabled tier3_enabled tier4_enabled; do
        v=$(cfg_get "$f" ".$k")
        [ -n "$v" ] || continue
        case "$v" in
            true|false)
                n=$((n + 1))
                case "$k" in
                    tier1_enabled) f_tier1="$v" ;;
                    tier2_enabled) f_tier2="$v" ;;
                    tier3_enabled) f_tier3="$v" ;;
                    tier4_enabled) f_tier4="$v" ;;
                esac
                ;;
            *) cfg_drop ;;
        esac
    done
    for k in fail_threshold check_interval cooldown max_reboots_per_hour; do
        v=$(cfg_get "$f" ".$k")
        [ -n "$v" ] || continue
        if mv_wd_check "$k" "$v" >/dev/null; then
            n=$((n + 1))
            case "$k" in
                fail_threshold) f_fail_threshold="$v" ;;
                check_interval) f_check_interval="$v" ;;
                cooldown) f_cooldown="$v" ;;
                max_reboots_per_hour) f_max_reboots="$v" ;;
            esac
        else
            cfg_drop
        fi
    done

    # The commit rewrites the slot on every save, so an absent or invalid one carries the device's value.
    f_backup_sim_slot=$(qm_config_get watchcat backup_sim_slot "")
    if _mvb_has_key "$f" '.' backup_sim_slot; then
        v=$(cfg_get "$f" '.backup_sim_slot')
        if [ -z "$v" ]; then
            f_backup_sim_slot=""; n=$((n + 1))
        elif mv_wd_check backup_sim_slot "$v" >/dev/null; then
            f_backup_sim_slot="$v"; n=$((n + 1))
        else
            cfg_drop
        fi
    fi

    for k in $WD_KEYS; do
        v=$(cfg_get "$f" ".$k")
        [ -n "$v" ] || continue
        if r=$(mv_wd_key_normalize "$k" "$v"); then
            wd_writes="$wd_writes $k=$r"; n=$((n + 1))
        else
            cfg_drop
        fi
    done

    [ "$n" -gt 0 ] || return "$CFG_RC_OK"

    mv_wd_commit
    rc=$?
    case "$rc" in
        10) CFG_MESSAGE="watchdog boot enable failed (rootfs read-only?)"; return "$CFG_RC_RETRY" ;;
        11) CFG_MESSAGE="watchdog boot disable failed (rootfs read-only?)"; return "$CFG_RC_RETRY" ;;
    esac
    return "$CFG_RC_OK"
}

# =============================================================================
# quality: ping_profile.json + quality_thresholds.json
# =============================================================================

# _mvb_ping_read: effective ping profile into MVB_PP_* (defaults per slot, like the GET); interval override is
# a number 1-60 or "null".
_mvb_ping_read() {
    local v t
    MVB_PP_PROFILE="relaxed"; MVB_PP_H1="cloudflare.com"; MVB_PP_H2="google.com"
    MVB_PP_I1="1.1.1.1"; MVB_PP_I2="8.8.8.8"; MVB_PP_IV="null"
    [ -f "$MV_PING_CONFIG" ] || return 0
    v=$(jq -r '.profile // empty' "$MV_PING_CONFIG" 2>/dev/null </dev/null) || v=""
    mv_ping_profile_ok "$v" && MVB_PP_PROFILE="$v"
    v=$(jq -r '.target_host_1 // empty' "$MV_PING_CONFIG" 2>/dev/null </dev/null) || v=""
    [ -n "$v" ] && t=$(mv_validate_target target_host_1 "$v" host) && MVB_PP_H1="$t"
    v=$(jq -r '.target_host_2 // empty' "$MV_PING_CONFIG" 2>/dev/null </dev/null) || v=""
    [ -n "$v" ] && t=$(mv_validate_target target_host_2 "$v" host) && MVB_PP_H2="$t"
    v=$(jq -r '.target_ip_1 // empty' "$MV_PING_CONFIG" 2>/dev/null </dev/null) || v=""
    [ -n "$v" ] && t=$(mv_validate_target target_ip_1 "$v" ipv4_literal) && MVB_PP_I1="$t"
    v=$(jq -r '.target_ip_2 // empty' "$MV_PING_CONFIG" 2>/dev/null </dev/null) || v=""
    [ -n "$v" ] && t=$(mv_validate_target target_ip_2 "$v" ipv4_literal) && MVB_PP_I2="$t"
    v=$(jq -r '(try .interval_sec catch null) | if type == "number" or type == "string" then tostring else "" end' "$MV_PING_CONFIG" 2>/dev/null </dev/null) || v=""
    case "$v" in ''|*[!0-9]*|0*) v="" ;; esac
    [ -n "$v" ] && [ "${#v}" -le 2 ] && mv_ping_interval_ok "$v" && MVB_PP_IV="$v"
    return 0
}

# _mvb_num_key_int <section> <key>: the stored quality_thresholds.json value when a JSON integer.
_mvb_num_key_int() {
    jq -r --arg s "$1" --arg k "$2" \
        '(try .[$s][$k] catch null) | if type == "number" and . == floor then tostring else "" end' \
        "$QUALITY_CONFIG" 2>/dev/null </dev/null
}

collect_quality() {
    local lat="tolerant" loss="tolerant" lc="" sc="" v_lat v_loss lat_c loss_c wait
    _mvb_ping_read
    if [ -f "$QUALITY_CONFIG" ]; then
        v_lat=$(jq -r '(try .latency.preset catch null) | if type == "string" then . else "" end' "$QUALITY_CONFIG" 2>/dev/null </dev/null) || v_lat=""
        v_loss=$(jq -r '(try .loss.preset catch null) | if type == "string" then . else "" end' "$QUALITY_CONFIG" 2>/dev/null </dev/null) || v_loss=""
        lc=$(_mvb_num_key_int latency custom_ms)
        sc=$(_mvb_num_key_int loss custom_pct)
        case "$v_lat" in
            standard|tolerant|very-tolerant) lat="$v_lat" ;;
            custom) cq_preset_latency custom "$lc" && lat="custom" ;;
        esac
        case "$v_loss" in
            standard|tolerant|very-tolerant) loss="$v_loss" ;;
            custom) cq_preset_loss custom "$sc" && loss="custom" ;;
        esac
    fi
    lat_c=null; loss_c=null
    mv_quality_custom_ok latency "$lc" && lat_c="$lc"
    mv_quality_custom_ok loss "$sc" && loss_c="$sc"
    cq_alert_after_min
    wait="$CQ_ALERT_AFTER_MIN"
    jq -n --arg profile "$MVB_PP_PROFILE" --argjson iv "$MVB_PP_IV" \
        --arg h1 "$MVB_PP_H1" --arg h2 "$MVB_PP_H2" --arg i1 "$MVB_PP_I1" --arg i2 "$MVB_PP_I2" \
        --arg lat "$lat" --argjson lat_c "$lat_c" --arg loss "$loss" --argjson loss_c "$loss_c" \
        --argjson wait "$wait" \
        '{ping_profile: {profile: $profile, interval_sec: $iv, target_host_1: $h1, target_host_2: $h2,
                         target_ip_1: $i1, target_ip_2: $i2},
          thresholds: {latency: {preset: $lat, custom_ms: $lat_c}, loss: {preset: $loss, custom_pct: $loss_c},
                       alert_after_min: $wait}}'
}

# ping_profile.interval_sec: null in the backup clears the stored override, absent keeps it.
# thresholds: only keys the backup carries are merged; a named preset keeps a stored custom number.
apply_quality() {
    local f="$1" v t c rc
    local profile iv clear_iv h1 h2 i1 i2 wait lat lat_c loss loss_c
    cfg_count_unknown "$f" '.' "ping_profile thresholds"
    cfg_count_unknown "$f" '.ping_profile' "profile interval_sec target_host_1 target_host_2 target_ip_1 target_ip_2"
    cfg_count_unknown "$f" '.thresholds' "latency loss alert_after_min"
    cfg_count_unknown "$f" '.thresholds.latency' "preset custom_ms"
    cfg_count_unknown "$f" '.thresholds.loss' "preset custom_pct"

    if cfg_has "$f" '.ping_profile'; then
        _mvb_ping_read
        profile="$MVB_PP_PROFILE"; h1="$MVB_PP_H1"; h2="$MVB_PP_H2"; i1="$MVB_PP_I1"; i2="$MVB_PP_I2"
        iv=""; clear_iv=0

        v=$(cfg_get "$f" '.ping_profile.profile')
        if [ -n "$v" ]; then
            if mv_ping_profile_ok "$v"; then profile="$v"; else cfg_drop; fi
        fi
        v=$(cfg_get "$f" '.ping_profile.target_host_1')
        if [ -n "$v" ]; then
            if t=$(mv_validate_target target_host_1 "$v" host); then h1="$t"; else cfg_drop; fi
        fi
        v=$(cfg_get "$f" '.ping_profile.target_host_2')
        if [ -n "$v" ]; then
            if t=$(mv_validate_target target_host_2 "$v" host); then h2="$t"; else cfg_drop; fi
        fi
        v=$(cfg_get "$f" '.ping_profile.target_ip_1')
        if [ -n "$v" ]; then
            if t=$(mv_validate_target target_ip_1 "$v" ipv4_literal); then i1="$t"; else cfg_drop; fi
        fi
        v=$(cfg_get "$f" '.ping_profile.target_ip_2')
        if [ -n "$v" ]; then
            if t=$(mv_validate_target target_ip_2 "$v" ipv4_literal); then i2="$t"; else cfg_drop; fi
        fi
        if _mvb_has_key "$f" '.ping_profile' interval_sec; then
            v=$(cfg_get "$f" '.ping_profile.interval_sec')
            if [ -z "$v" ]; then
                clear_iv=1
            elif [ -n "$v" ] && mv_ping_interval_ok "$v"; then
                iv="$v"
            else
                cfg_drop
            fi
        fi

        mv_ping_save "$profile" "$iv" "$h1" "$h2" "$i1" "$i2" || {
            CFG_MESSAGE="could not write the ping profile"
            return "$CFG_RC_RETRY"
        }
        if [ "$clear_iv" = "1" ]; then
            mv_ping_clear_interval || {
                CFG_MESSAGE="could not clear the stored probe interval"
                return "$CFG_RC_RETRY"
            }
        fi
    fi

    if cfg_has "$f" '.thresholds'; then
        wait=""; lat=""; lat_c=""; loss=""; loss_c=""
        v=$(cfg_get "$f" '.thresholds.alert_after_min')
        if [ -n "$v" ]; then
            if mv_quality_check_wait "$v" >/dev/null; then wait="$v"; else cfg_drop; fi
        fi
        v=$(cfg_get "$f" '.thresholds.latency.preset')
        if [ -n "$v" ]; then
            if ! mv_check_preset latency.preset "$v" >/dev/null; then
                cfg_drop
            elif [ "$v" = "custom" ]; then
                c=$(cfg_get "$f" '.thresholds.latency.custom_ms')
                if mv_quality_custom_ok latency "$c"; then lat="custom"; lat_c="$c"; else cfg_drop; fi
            else
                lat="$v"
            fi
        fi
        v=$(cfg_get "$f" '.thresholds.loss.preset')
        if [ -n "$v" ]; then
            if ! mv_check_preset loss.preset "$v" >/dev/null; then
                cfg_drop
            elif [ "$v" = "custom" ]; then
                c=$(cfg_get "$f" '.thresholds.loss.custom_pct')
                if mv_quality_custom_ok loss "$c"; then loss="custom"; loss_c="$c"; else cfg_drop; fi
            else
                loss="$v"
            fi
        fi
        if [ -n "$wait$lat$loss" ]; then
            mv_quality_save "$wait" "$lat" "$lat_c" "$loss" "$loss_c" || {
                CFG_MESSAGE="could not write the quality thresholds"
                return "$CFG_RC_RETRY"
            }
        fi
    fi
    return "$CFG_RC_OK"
}

# =============================================================================
# sites
# =============================================================================

collect_sites() {
    mv_sites_read_config
}

# The backup's site list replaces the device's; an absent enabled/interval_sec/sites keeps the device's.
apply_sites() {
    local f="$1" cur en iv v json total i h keep kept filtered new
    cfg_count_unknown "$f" '.' "enabled interval_sec sites"
    cur=$(mv_sites_read_config)
    en=$(printf '%s' "$cur" | jq -r '.enabled | tostring')
    iv=$(printf '%s' "$cur" | jq -r '.interval_sec | tostring')
    json=$(cat "$f")

    if cfg_has "$f" '.enabled'; then
        v=$(mv_sites_norm_enabled "$json")
        case "$v" in true|false) en="$v" ;; *) cfg_drop ;; esac
    fi
    if cfg_has "$f" '.interval_sec'; then
        v=$(mv_sites_norm_interval "$json")
        case "$v" in ''|invalid|*[!0-9]*) cfg_drop ;; *) iv="$v" ;; esac
    fi

    filtered=""
    if cfg_has "$f" '.sites'; then
        if jq -e '.sites | type == "array"' "$f" >/dev/null 2>&1; then
            total=$(jq -r '.sites | length' "$f" 2>/dev/null)
            case "$total" in ''|*[!0-9]*) total=0 ;; esac
            keep=""; kept=0; i=0
            if [ "$total" -gt 0 ]; then
                # A host containing a newline or NUL reads as invalid so line N stays entry N.
                v=$(jq -r '.sites[] | if type == "object" and (.host | type) == "string" and ((.host | explode | any(. == 10 or . == 0)) | not) then (.host | ascii_downcase) else "" end' "$f" 2>/dev/null)
                while IFS= read -r h; do
                    if mv_valid_host "$h" && [ "$kept" -lt 32 ]; then
                        keep="${keep:+$keep,}$i"
                        kept=$((kept + 1))
                    else
                        cfg_drop
                    fi
                    i=$((i + 1))
                done <<EOF
$v
EOF
            fi
            filtered=$(jq -c --argjson k "[${keep}]" \
                '{sites: (.sites as $s | [range(0; ($s | length)) | select(. as $i | any($k[]; . == $i)) | $s[.]])}' "$f" 2>/dev/null)
        else
            cfg_drop
        fi
    fi
    [ -n "$filtered" ] || filtered=$(printf '%s' "$cur" | jq -c '{sites: .sites}')

    new=$(mv_sites_build "$en" "$iv" "$filtered") || {
        CFG_MESSAGE="could not build the sites configuration"
        return "$CFG_RC_INVALID"
    }
    mv_sites_write "$new" "$en" || {
        CFG_MESSAGE="could not write the sites configuration"
        return "$CFG_RC_RETRY"
    }
    return "$CFG_RC_OK"
}

# =============================================================================
# alerts: sms_alerts.json, email_alerts.json, discord_bot.json, alert_routing.json
# =============================================================================

collect_alerts() {
    local wait sms email discord events ev_raw=""
    cq_alert_after_min
    wait="$CQ_ALERT_AFTER_MIN"
    sms=$(_mvb_cfg_json "$CQ_SMS_CONFIG" '{enabled: ((.enabled | tostring) == "true"), recipient_phone: (.recipient_phone // "" | tostring)}')
    email=$(_mvb_cfg_json "$CQ_EMAIL_CONFIG" '{enabled: ((.enabled | tostring) == "true"), sender_email: (.sender_email // "" | tostring), recipient_email: (.recipient_email // "" | tostring)}')
    discord=$(_mvb_cfg_json "$CQ_DISCORD_CONFIG" '{enabled: ((.enabled | tostring) == "true"), owner_discord_id: (.owner_discord_id // "" | tostring)}')
    [ -f "$MV_ROUTING_CONFIG" ] && ev_raw=$(jq -c '.events // empty' "$MV_ROUTING_CONFIG" 2>/dev/null </dev/null)
    events=$(mv_alert_routing_final "$ev_raw" | jq -c . 2>/dev/null) || events=""
    [ -n "$events" ] || events="$MV_ROUTING_DEFAULT"
    jq -n --argjson wait "$wait" --argjson sms "$sms" --argjson email "$email" \
        --argjson discord "$discord" --argjson events "$events" \
        '{alert_after_min: $wait,
          sms: {enabled: ($sms.enabled // false), recipient_phone: ($sms.recipient_phone // "")},
          email: {enabled: ($email.enabled // false), sender_email: ($email.sender_email // ""),
                  recipient_email: ($email.recipient_email // "")},
          discord: {enabled: ($discord.enabled // false), owner_discord_id: ($discord.owner_discord_id // "")},
          routing: {events: $events}}'
}

# _mvb_cfg_json <file> <jq-filter>: compact JSON of one config file, {} when absent or unparseable.
_mvb_cfg_json() {
    local j=""
    [ -f "$1" ] && j=$(jq -c "$2" "$1" 2>/dev/null </dev/null)
    if [ -n "$j" ]; then printf '%s' "$j"; else printf '{}'; fi
}

# Never calls the secret helper. An enabled email/Discord channel needs the stored password/token (the
# device's markers), so without it the channel is written off; a changed sender is kept off a device that
# already holds a password, because the credentials file is only re-rendered by the UI save.
apply_alerts() {
    local f="$1" v new_wait cur_wait notes=""
    local s_en s_phone e_en e_sender e_recip pw_set d_en d_owner d_token
    local ev san cur_ev merged routing_final rc=0
    cfg_count_unknown "$f" '.' "alert_after_min sms email discord routing"
    cfg_count_unknown "$f" '.sms' "enabled recipient_phone"
    cfg_count_unknown "$f" '.email' "enabled sender_email recipient_email"
    cfg_count_unknown "$f" '.discord' "enabled owner_discord_id"
    cfg_count_unknown "$f" '.routing' "events"

    cq_alert_after_min
    cur_wait="$CQ_ALERT_AFTER_MIN"
    new_wait="$cur_wait"
    v=$(cfg_get "$f" '.alert_after_min')
    if [ -n "$v" ]; then
        if mv_check_wait_minutes alert_after_min "$v" >/dev/null; then new_wait="$v"; else cfg_drop; fi
    fi

    # --- SMS ---
    s_en=$(_mvb_file_get "$CQ_SMS_CONFIG" '((.enabled | tostring) == "true") | tostring' false)
    s_phone=$(_mvb_file_get "$CQ_SMS_CONFIG" '.recipient_phone // "" | tostring' "")
    v=$(cfg_get "$f" '.sms.enabled')
    if [ -n "$v" ]; then
        case "$v" in true|false) s_en="$v" ;; *) cfg_drop ;; esac
    fi
    if cfg_has "$f" '.sms.recipient_phone'; then
        v=$(cfg_get "$f" '.sms.recipient_phone')
        if [ -z "$v" ] || mv_check_phone "$v" >/dev/null; then s_phone="$v"; else cfg_drop; fi
    fi
    if [ "$s_en" = "true" ] && ! mv_check_phone "$s_phone" >/dev/null; then
        s_en="false"; cfg_drop; notes="SMS alerts left off: no valid recipient number"
    fi

    # --- Email ---
    e_en=$(_mvb_file_get "$CQ_EMAIL_CONFIG" '((.enabled | tostring) == "true") | tostring' false)
    e_sender=$(_mvb_file_get "$CQ_EMAIL_CONFIG" '.sender_email // "" | tostring' "")
    e_recip=$(_mvb_file_get "$CQ_EMAIL_CONFIG" '.recipient_email // "" | tostring' "")
    pw_set=$(mv_alert_email_pw_set)
    v=$(cfg_get "$f" '.email.enabled')
    if [ -n "$v" ]; then
        case "$v" in true|false) e_en="$v" ;; *) cfg_drop ;; esac
    fi
    if cfg_has "$f" '.email.sender_email'; then
        v=$(cfg_get "$f" '.email.sender_email')
        if [ -n "$v" ] && ! mv_email_addr_ok "$v"; then
            cfg_drop
        elif [ "$pw_set" = "true" ] && [ -n "$e_sender" ] && [ "$v" != "$e_sender" ]; then
            cfg_drop; notes="Email sender kept: change it on the Alerts page to refresh the mail credentials"
        else
            e_sender="$v"
        fi
    fi
    if cfg_has "$f" '.email.recipient_email'; then
        v=$(cfg_get "$f" '.email.recipient_email')
        if [ -z "$v" ] || mv_email_addr_ok "$v"; then e_recip="$v"; else cfg_drop; fi
    fi
    if [ "$e_en" = "true" ]; then
        if [ "$pw_set" != "true" ] || ! mv_check_email_fields "$e_sender" "$e_recip" "" >/dev/null; then
            e_en="false"; cfg_drop; notes="Email alerts left off: enter the app password on the Alerts page"
        fi
    fi

    # --- Discord ---
    mv_alert_discord_prev
    d_en="$MV_DP_EN"; d_owner="$MV_DP_OWNER"; d_token="$MV_DP_TOKEN"
    v=$(cfg_get "$f" '.discord.enabled')
    if [ -n "$v" ]; then
        case "$v" in true|false) d_en="$v" ;; *) cfg_drop ;; esac
    fi
    if cfg_has "$f" '.discord.owner_discord_id'; then
        v=$(cfg_get "$f" '.discord.owner_discord_id')
        if [ -z "$v" ] || mv_check_discord_owner "$v" >/dev/null; then d_owner="$v"; else cfg_drop; fi
    fi
    if [ "$d_en" = "true" ]; then
        if [ "$d_token" != "true" ] || ! mv_check_discord_owner "$d_owner" >/dev/null; then
            d_en="false"; cfg_drop; notes="Discord alerts left off: enter the bot token on the Alerts page"
        fi
    fi

    # --- Routing: backup events merged onto the device's current routing ---
    routing_final=""
    if cfg_has "$f" '.routing.events'; then
        ev=$(jq -c '.routing.events' "$f" 2>/dev/null)
        san=$(printf '%s' "$ev" | jq -c "$_MVB_ROUTING_SANITIZE" 2>/dev/null)
        [ -n "$san" ] || san='{}'
        jq -n --argjson a "$ev" --argjson b "$san" '$a == $b' 2>/dev/null | grep -q true || cfg_drop
        ev=""
        [ -f "$MV_ROUTING_CONFIG" ] && ev=$(jq -c '.events // empty' "$MV_ROUTING_CONFIG" 2>/dev/null </dev/null)
        cur_ev=$(mv_alert_routing_final "$ev")
        merged=$(jq -nc --argjson a "$cur_ev" --argjson b "$san" '$a * $b' 2>/dev/null)
        [ -n "$merged" ] || merged="$cur_ev"
        routing_final=$(mv_alert_routing_final "$merged")
    fi

    # --- Writes, in the CGI's order ---
    mv_alert_write_wait "$new_wait" || { CFG_MESSAGE="could not write the alert wait"; return "$CFG_RC_RETRY"; }
    mv_alert_write_sms "$s_en" "$s_phone" "$new_wait" || { CFG_MESSAGE="could not write the SMS alert settings"; return "$CFG_RC_RETRY"; }
    mv_alert_write_email "$e_en" "$e_sender" "$e_recip" "$pw_set" "$new_wait" || { CFG_MESSAGE="could not write the email alert settings"; return "$CFG_RC_RETRY"; }
    mv_alert_write_discord "$d_en" "$d_owner" "$new_wait" "$d_token" || { CFG_MESSAGE="could not write the Discord alert settings"; return "$CFG_RC_RETRY"; }
    mv_alert_discord_service "$d_en" "$MV_DP_EN" "$d_owner" "$MV_DP_OWNER" 0
    if [ -n "$routing_final" ]; then
        mv_alert_write_routing "$routing_final" || { CFG_MESSAGE="could not write the alert routing"; return "$CFG_RC_RETRY"; }
    fi
    mv_alert_touch_reload

    CFG_MESSAGE="$notes"
    if [ -n "$MV_DISCORD_RESTART_ERR" ]; then
        CFG_MESSAGE="Discord service could not be restarted"; rc="$CFG_RC_RETRY"
    elif [ -n "$MV_DISCORD_SVC_ERR" ]; then
        CFG_MESSAGE="Discord service could not be enabled on boot (rootfs read-only?)"; rc="$CFG_RC_RETRY"
    fi
    return "$rc"
}
