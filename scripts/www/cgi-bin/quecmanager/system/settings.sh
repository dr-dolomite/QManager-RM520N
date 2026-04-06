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

# --- Helpers -----------------------------------------------------------------

# Strip leading zero from a time component (handle "00" -> "0", not empty)
strip_leading_zero() {
    local v
    v=$(printf '%s' "$1" | sed 's/^0//')
    [ -z "$v" ] && v="0"
    printf '%s' "$v"
}

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
        if [ -n "$val" ]; then
            sys_set_timezone "$val" "$zn"
        fi

        # AT device is hardcoded to /dev/smd11 via atcli_smd11 — no override needed

        qlog_info "System settings saved"
        echo '{"success":true}'
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

        # --- Manage crontab (write directly to root's crontab file) ---
        # CGI runs as www-data but scheduled scripts need root.
        # BusyBox crond reads /var/spool/cron/crontabs/<user> directly.
        CRON_MARKER="qmanager_scheduled_reboot"
        SCHEDULE_SCRIPT="/usr/bin/qmanager_scheduled_reboot"
        CRON_FILE="/var/spool/cron/crontabs/root"

        current_cron=$(cat "$CRON_FILE" 2>/dev/null || true)
        cleaned_cron=$(printf '%s\n' "$current_cron" | grep -v "$CRON_MARKER")

        if [ "$ENABLED" = "true" ]; then
            sched_hour=$(printf '%s' "$SCHED_TIME" | cut -d: -f1)
            sched_min=$(printf '%s' "$SCHED_TIME" | cut -d: -f2)
            sched_hour=$(strip_leading_zero "$sched_hour")
            sched_min=$(strip_leading_zero "$sched_min")

            new_cron="${cleaned_cron}
# QManager Scheduled Reboot — DO NOT EDIT MANUALLY
${sched_min} ${sched_hour} * * ${DAYS_RAW} ${SCHEDULE_SCRIPT}  # ${CRON_MARKER}"

            printf '%s\n' "$new_cron" > "$CRON_FILE"
            qlog_info "Scheduled reboot cron installed: ${SCHED_TIME} days=${DAYS_RAW}"
        else
            if [ -n "$cleaned_cron" ]; then
                printf '%s\n' "$cleaned_cron" > "$CRON_FILE"
            else
                rm -f "$CRON_FILE"
            fi
            qlog_info "Scheduled reboot cron entries removed"
        fi

        # Build response
        DAYS_RESP=$(printf '%s' "$DAYS_RAW" | jq -Rc 'split(",") | map(tonumber)' 2>/dev/null)
        [ -z "$DAYS_RESP" ] && DAYS_RESP="[0,1,2,3,4,5,6]"

        jq -n \
            --argjson enabled "$([ "$ENABLED" = "true" ] && echo true || echo false)" \
            --arg time "$SCHED_TIME" \
            --argjson days "$DAYS_RESP" \
            '{success: true, scheduled_reboot: {enabled: $enabled, time: $time, days: $days}}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: save_low_power
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save_low_power" ]; then
        qlog_info "Saving low power settings"
        qm_config_init

        # Parse fields
        ENABLED=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then (.enabled | tostring) else "" end')
        START_TIME=$(printf '%s' "$POST_DATA" | jq -r '.start_time // empty')
        END_TIME=$(printf '%s' "$POST_DATA" | jq -r '.end_time // empty')
        DAYS_RAW=$(printf '%s' "$POST_DATA" | jq -r '.days // [] | map(tostring) | join(",")' 2>/dev/null)

        if [ -z "$ENABLED" ]; then
            cgi_error "missing_enabled" "enabled field is required"
            exit 0
        fi

        # Validate when enabling
        if [ "$ENABLED" = "true" ]; then
            case "$START_TIME" in
                [0-2][0-9]:[0-5][0-9]) ;;
                *)
                    cgi_error "invalid_start_time" "start_time must be HH:MM format"
                    exit 0
                    ;;
            esac
            case "$END_TIME" in
                [0-2][0-9]:[0-5][0-9]) ;;
                *)
                    cgi_error "invalid_end_time" "end_time must be HH:MM format"
                    exit 0
                    ;;
            esac

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
        [ -z "$START_TIME" ] && START_TIME="23:00"
        [ -z "$END_TIME" ] && END_TIME="06:00"
        [ -z "$DAYS_RAW" ] && DAYS_RAW="0,1,2,3,4,5,6"

        # Write to config
        case "$ENABLED" in
            true)  qm_config_set settings low_power_enabled 1 ;;
            false) qm_config_set settings low_power_enabled 0 ;;
        esac
        qm_config_set settings low_power_start "$START_TIME"
        qm_config_set settings low_power_end "$END_TIME"
        qm_config_set settings low_power_days "$DAYS_RAW"

        # --- Manage crontab (write directly to root's crontab file) ---
        CRON_MARKER="qmanager_low_power"
        LP_SCRIPT="/usr/bin/qmanager_low_power"
        CRON_FILE="/var/spool/cron/crontabs/root"

        current_cron=$(cat "$CRON_FILE" 2>/dev/null || true)
        cleaned_cron=$(printf '%s\n' "$current_cron" | grep -v "$CRON_MARKER")

        if [ "$ENABLED" = "true" ]; then
            start_hour=$(printf '%s' "$START_TIME" | cut -d: -f1)
            start_min=$(printf '%s' "$START_TIME" | cut -d: -f2)
            start_hour=$(strip_leading_zero "$start_hour")
            start_min=$(strip_leading_zero "$start_min")

            end_hour=$(printf '%s' "$END_TIME" | cut -d: -f1)
            end_min=$(printf '%s' "$END_TIME" | cut -d: -f2)
            end_hour=$(strip_leading_zero "$end_hour")
            end_min=$(strip_leading_zero "$end_min")

            new_cron="${cleaned_cron}
# QManager Low Power Mode — DO NOT EDIT MANUALLY
${start_min} ${start_hour} * * ${DAYS_RAW} ${LP_SCRIPT} enter  # ${CRON_MARKER}
${end_min} ${end_hour} * * 0,1,2,3,4,5,6 ${LP_SCRIPT} exit  # ${CRON_MARKER}"

            printf '%s\n' "$new_cron" > "$CRON_FILE"
            qlog_info "Low power cron installed: enter=${START_TIME} exit=${END_TIME} days=${DAYS_RAW}"

            # Enable boot-time checker
            svc_enable qmanager_low_power_check
        else
            if [ -n "$cleaned_cron" ]; then
                printf '%s\n' "$cleaned_cron" > "$CRON_FILE"
            else
                rm -f "$CRON_FILE"
            fi
            qlog_info "Low power cron entries removed"

            # Disable boot-time checker
            svc_disable qmanager_low_power_check

            # If currently in low-power mode, restore CFUN=1 immediately
            if [ -f /tmp/qmanager_low_power_active ]; then
                qlog_info "Low power active flag found, triggering exit"
                ( /usr/bin/qmanager_low_power exit </dev/null >/dev/null 2>&1 & )
            fi
        fi

        # Build response
        DAYS_RESP=$(printf '%s' "$DAYS_RAW" | jq -Rc 'split(",") | map(tonumber)' 2>/dev/null)
        [ -z "$DAYS_RESP" ] && DAYS_RESP="[0,1,2,3,4,5,6]"

        jq -n \
            --argjson enabled "$([ "$ENABLED" = "true" ] && echo true || echo false)" \
            --arg start "$START_TIME" \
            --arg end "$END_TIME" \
            --argjson days "$DAYS_RESP" \
            '{success: true, low_power: {enabled: $enabled, start_time: $start, end_time: $end, days: $days}}'
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_error "method_not_allowed" "Only GET and POST are supported"
