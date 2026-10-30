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

    # --- AT device (informational — qcmd hardcodes /dev/smd11) ---
    sms_tool_device="/dev/smd11"

    # One jq read for every settings key; v() mirrors qm_config_get (null, false or "" -> default).
    SETTINGS_JQ='
        def v(k; d): (.settings[k] // "" | tostring) as $x | if $x == "" then d else $x end;
        def days(k): v(k; "0,1,2,3,4,5,6")
            | (try (split(",") | map(tonumber) | tojson) catch "[0,1,2,3,4,5,6]");
        @sh "temp_unit=\(v("temp_unit"; "celsius"))",
        @sh "distance_unit=\(v("distance_unit"; "km"))",
        @sh "cfg_hostname=\(v("hostname"; ""))",
        @sh "timezone=\(v("timezone"; "UTC0"))",
        @sh "zonename=\(v("zonename"; "UTC"))",
        @sh "sched_enabled=\(v("sched_reboot_enabled"; "0"))",
        @sh "sched_time=\(v("sched_reboot_time"; "04:00"))",
        @sh "sched_days_json=\(days("sched_reboot_days"))",
        @sh "lp_enabled=\(v("low_power_enabled"; "0"))",
        @sh "lp_start=\(v("low_power_start"; "23:00"))",
        @sh "lp_end=\(v("low_power_end"; "06:00"))",
        @sh "lp_days_json=\(days("low_power_days"))"'
    settings_vars=$(jq -r "$SETTINGS_JQ" "$QM_CONFIG" 2>/dev/null)
    # Empty output (missing, invalid or blank config) -> every default.
    [ -n "$settings_vars" ] || settings_vars=$(jq -nr "null | $SETTINGS_JQ")
    eval "$settings_vars"

    # --- Hostname (display name): config first, else sys_get_hostname's fallbacks ---
    hostname="$cfg_hostname"
    [ -z "$hostname" ] && hostname=$(sys_get_hostname)

    # --- Effective (live) timezone — ground truth, not just config ---
    # Always four non-empty fields: "<live_offset> <expected> <applied> <abbr>".
    eff_tz=$(sys_get_effective_tz)
    set -- $eff_tz
    eff_offset="${1:-}"
    eff_applied="${3:-}"
    eff_abbr="${4:-}"
    tz_applied=false
    [ "$eff_applied" = "1" ] && tz_applied=true

    jq -n \
        --argjson wan_guard "$wan_guard_enabled" \
        --arg hostname "$hostname" \
        --arg temp_unit "$temp_unit" \
        --arg distance_unit "$distance_unit" \
        --arg timezone "$timezone" \
        --arg zonename "$zonename" \
        --arg effective_offset "$eff_offset" \
        --arg effective_zone_abbr "$eff_abbr" \
        --argjson timezone_applied "$tz_applied" \
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

        # AT device is hardcoded to /dev/smd11 in qcmd — no override needed

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
                [01][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) ;;
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

        # The config write above always succeeds, so this stays success:true;
        # an arm failure is surfaced as a warning (matches scenarios/activate.sh's
        # partial_band_lock convention) rather than changing the success shape.
        if [ "$arm_ok" != "true" ]; then
            jq -n \
                --argjson enabled "$([ "$ENABLED" = "true" ] && echo true || echo false)" \
                --arg time "$SCHED_TIME" \
                --argjson days "$DAYS_RESP" \
                --argjson armed "$([ "$armed" = "true" ] && echo true || echo false)" \
                --arg reason "$arm_reason" \
                --arg detail "${arm_reason:-Scheduled reboot timer could not be armed}" \
                '{success: true, armed: $armed, reason: $reason, warning: "reboot_arm_failed", detail: $detail, scheduled_reboot: {enabled: $enabled, time: $time, days: $days}}'
        else
            jq -n \
                --argjson enabled "$([ "$ENABLED" = "true" ] && echo true || echo false)" \
                --arg time "$SCHED_TIME" \
                --argjson days "$DAYS_RESP" \
                --argjson armed "$([ "$armed" = "true" ] && echo true || echo false)" \
                --arg reason "$arm_reason" \
                '{success: true, armed: $armed, reason: $reason, scheduled_reboot: {enabled: $enabled, time: $time, days: $days}}'
        fi
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
