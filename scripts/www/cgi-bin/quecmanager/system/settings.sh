#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/system_config.sh
# =============================================================================
# settings.sh — CGI Endpoint: System Settings (GET + POST)
# =============================================================================
# GET:  Returns current system settings (units, timezone, WAN guard,
#        scheduled reboot, low-power mode).
# POST: Saves settings, scheduled reboot config, or low-power config.
#
# Config: /etc/qmanager/qmanager.conf (settings section)
# Cron:   qmanager_scheduled_reboot, qmanager_low_power markers
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/settings.sh
# Install location: /www/cgi-bin/quecmanager/system/settings.sh
# =============================================================================

qlog_init "cgi_system_settings"
cgi_headers
cgi_handle_options

# =============================================================================
# GET — Fetch all system settings
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching system settings"
    qm_config_init

    # --- WAN Guard status ---
    # Not ported to RM520N-GL; always report false
    wan_guard_enabled="false"

    # --- AT device (informational — atcli_smd11 hardcodes /dev/smd11) ---
    sms_tool_device="/dev/smd11"

    # --- Unit preferences ---
    temp_unit=$(qm_config_get settings temp_unit "celsius")
    distance_unit=$(qm_config_get settings distance_unit "km")

    # --- Hostname (display name) ---
    hostname=$(sys_get_hostname)

    # --- Timezone ---
    timezone=$(sys_get_timezone)
    zonename=$(sys_get_zonename)

    # --- Effective (live) timezone — ground truth, not just config ---
    eff_tz=$(sys_get_effective_tz)
    eff_offset=$(printf '%s' "$eff_tz" | cut -d' ' -f1)
    eff_applied=$(printf '%s' "$eff_tz" | cut -d' ' -f3)
    eff_abbr=$(printf '%s' "$eff_tz" | cut -d' ' -f4)

    # --- Scheduled reboot ---
    sched_enabled=$(qm_config_get settings sched_reboot_enabled "0")
    sched_time=$(qm_config_get settings sched_reboot_time "04:00")
    sched_days_raw=$(qm_config_get settings sched_reboot_days "0,1,2,3,4,5,6")
    sched_days_json=$(printf '%s' "$sched_days_raw" | jq -Rc 'split(",") | map(tonumber)' 2>/dev/null)
    [ -z "$sched_days_json" ] && sched_days_json="[0,1,2,3,4,5,6]"

    # --- Low power ---
    lp_enabled=$(qm_config_get settings low_power_enabled "0")
    lp_start=$(qm_config_get settings low_power_start "23:00")
    lp_end=$(qm_config_get settings low_power_end "06:00")
    lp_days_raw=$(qm_config_get settings low_power_days "0,1,2,3,4,5,6")
    lp_days_json=$(printf '%s' "$lp_days_raw" | jq -Rc 'split(",") | map(tonumber)' 2>/dev/null)
    [ -z "$lp_days_json" ] && lp_days_json="[0,1,2,3,4,5,6]"

    jq -n \
        --argjson wan_guard "$wan_guard_enabled" \
        --arg hostname "$hostname" \
        --arg temp_unit "$temp_unit" \
        --arg distance_unit "$distance_unit" \
        --arg timezone "$timezone" \
        --arg zonename "$zonename" \
        --arg effective_offset "$eff_offset" \
        --arg effective_zone_abbr "$eff_abbr" \
        --argjson timezone_applied "$([ "$eff_applied" = "1" ] && echo true || echo false)" \
        --arg sms_tool_device "$sms_tool_device" \
        --argjson sched_enabled "$sched_enabled" \
        --arg sched_time "$sched_time" \
        --argjson sched_days "$sched_days_json" \
        --argjson lp_enabled "$lp_enabled" \
        --arg lp_start "$lp_start" \
        --arg lp_end "$lp_end" \
        --argjson lp_days "$lp_days_json" \
        '{
            success: true,
            settings: {
                wan_guard_enabled: $wan_guard,
                hostname: $hostname,
                temp_unit: $temp_unit,
                distance_unit: $distance_unit,
                timezone: $timezone,
                zonename: $zonename,
                effective_offset: $effective_offset,
                effective_zone_abbr: $effective_zone_abbr,
                timezone_applied: $timezone_applied,
                sms_tool_device: $sms_tool_device
            },
            scheduled_reboot: {
                enabled: ($sched_enabled == 1),
                time: $sched_time,
                days: $sched_days
            },
            low_power: {
                enabled: ($lp_enabled == 1),
                start_time: $lp_start,
                end_time: $lp_end,
                days: $lp_days
            }
        }'
    exit 0
fi

# =============================================================================
# POST — Save settings
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: save_settings
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save_settings" ]; then
        qlog_info "Saving system settings"
        qm_config_init

        val=""

        # --- WAN Guard toggle ---
        # Not ported to RM520N-GL; silently ignore
        # val=$(printf '%s' "$POST_DATA" | jq -r 'if has("wan_guard_enabled") then (.wan_guard_enabled | tostring) else "" end')

        # --- Hostname (display name) ---
        val=$(printf '%s' "$POST_DATA" | jq -r '.hostname // empty')
        if [ -n "$val" ]; then
            sys_set_hostname "$val"
        fi

        # --- Temperature unit ---
        val=$(printf '%s' "$POST_DATA" | jq -r '.temp_unit // empty')
        if [ -n "$val" ]; then
            case "$val" in
                celsius|fahrenheit) qm_config_set settings temp_unit "$val" ;;
                *)
                    cgi_error "invalid_temp_unit" "temp_unit must be 'celsius' or 'fahrenheit'"
                    exit 0
                    ;;
            esac
        fi

        # --- Distance unit ---
        val=$(printf '%s' "$POST_DATA" | jq -r '.distance_unit // empty')
        if [ -n "$val" ]; then
            case "$val" in
                km|miles) qm_config_set settings distance_unit "$val" ;;
                *)
                    cgi_error "invalid_distance_unit" "distance_unit must be 'km' or 'miles'"
                    exit 0
                    ;;
            esac
        fi

        # --- Timezone ---
        val=$(printf '%s' "$POST_DATA" | jq -r '.timezone // empty')
        zn=$(printf '%s' "$POST_DATA" | jq -r '.zonename // empty')
        tz_status="not_attempted"
        if [ -n "$val" ]; then
            tz_status=$(sys_set_timezone "$val" "$zn")
        fi

        # AT device is hardcoded to /dev/smd11 via atcli_smd11 — no override needed

        qlog_info "System settings saved"
        jq -n --arg tz_status "$tz_status" '{success:true, timezone_apply_status:$tz_status}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: save_scheduled_reboot
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save_scheduled_reboot" ]; then
        qlog_info "Saving scheduled reboot settings"
        qm_config_init

        # Parse fields
        ENABLED=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then (.enabled | tostring) else "" end')
        SCHED_TIME=$(printf '%s' "$POST_DATA" | jq -r '.time // empty')
        DAYS_RAW=$(printf '%s' "$POST_DATA" | jq -r '.days // [] | map(tostring) | join(",")' 2>/dev/null)

        if [ -z "$ENABLED" ]; then
            cgi_error "missing_enabled" "enabled field is required"
            exit 0
        fi

        # Validate when enabling
        if [ "$ENABLED" = "true" ]; then
            # Validate time format HH:MM
            case "$SCHED_TIME" in
                [0-2][0-9]:[0-5][0-9]) ;;
                *)
                    cgi_error "invalid_time" "time must be HH:MM format"
                    exit 0
                    ;;
            esac

            # Validate days
            if [ -z "$DAYS_RAW" ]; then
                cgi_error "no_days" "At least one day must be selected"
                exit 0
            fi

            invalid_day=""
            for d in $(printf '%s' "$DAYS_RAW" | tr ',' ' '); do
                case "$d" in
                    0|1|2|3|4|5|6) ;;
                    *) invalid_day="$d" ;;
                esac
            done
            if [ -n "$invalid_day" ]; then
                cgi_error "invalid_day" "Days must be 0-6 (0=Sun, 6=Sat)"
                exit 0
            fi
        fi

        # Defaults for disabled state
        [ -z "$SCHED_TIME" ] && SCHED_TIME="04:00"
        [ -z "$DAYS_RAW" ] && DAYS_RAW="0,1,2,3,4,5,6"

        # Write to config
        case "$ENABLED" in
            true)  qm_config_set settings sched_reboot_enabled 1 ;;
            false) qm_config_set settings sched_reboot_enabled 0 ;;
        esac
        qm_config_set settings sched_reboot_time "$SCHED_TIME"
        qm_config_set settings sched_reboot_days "$DAYS_RAW"

        # --- Arm/disarm the runtime systemd timer (root helper) ---
        # RM520N has no crond (qmanager_scheduled_reboot_arm's header explains
        # why the old /var/spool/cron/crontabs/root write was a silent no-op).
        # The helper hardcodes the unit + re-validates time/days itself before
        # they touch a generated .timer file — this CGI-side validation above
        # is necessary but not sufficient on its own.
        if [ "$ENABLED" = "true" ]; then
            arm_json=$(sudo -n /usr/bin/qmanager_scheduled_reboot_arm install "$SCHED_TIME" "$DAYS_RAW" 2>/dev/null)
        else
            arm_json=$(sudo -n /usr/bin/qmanager_scheduled_reboot_arm teardown 2>/dev/null)
        fi

        arm_ok=$(printf '%s' "$arm_json" | jq -r '.success // false' 2>/dev/null)
        armed=$(printf '%s' "$arm_json" | jq -r 'if has("armed") then (.armed|tostring) else "false" end' 2>/dev/null)
        arm_reason=$(printf '%s' "$arm_json" | jq -r '.reason // ""' 2>/dev/null)
        if [ "$arm_ok" != "true" ]; then
            qlog_error "Scheduled reboot timer arm/disarm failed: ${arm_json:-<empty response>}"
        fi
        qlog_info "Scheduled reboot timer ${ENABLED}: ${SCHED_TIME} days=${DAYS_RAW} armed=${armed}"

        # Build response
        DAYS_RESP=$(printf '%s' "$DAYS_RAW" | jq -Rc 'split(",") | map(tonumber)' 2>/dev/null)
        [ -z "$DAYS_RESP" ] && DAYS_RESP="[0,1,2,3,4,5,6]"

        jq -n \
            --argjson enabled "$([ "$ENABLED" = "true" ] && echo true || echo false)" \
            --arg time "$SCHED_TIME" \
            --argjson days "$DAYS_RESP" \
            --argjson armed "$([ "$armed" = "true" ] && echo true || echo false)" \
            --arg reason "$arm_reason" \
            '{success: true, armed: $armed, reason: $reason, scheduled_reboot: {enabled: $enabled, time: $time, days: $days}}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: save_low_power — REMOVED.
    # -------------------------------------------------------------------------
    # Low Power Mode's daemons (qmanager_low_power, qmanager_low_power_check)
    # were already deleted from this branch (see CLAUDE.md's
    # Removed/Deferred Features table); this was the last orphaned writer —
    # a printf into /var/spool/cron/crontabs/root that BusyBox crond never
    # read (RM520N has no crond daemon running). Falls through to the
    # unknown_action handler below rather than silently no-op-succeeding, so
    # a caller still hitting this action gets an explicit error instead of a
    # false "success" for a save that does nothing.

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_error "method_not_allowed" "Only GET and POST are supported"
