#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/system_config.sh
. /usr/lib/qmanager/system_validate.sh
# =============================================================================
# settings.sh — CGI Endpoint: System Settings (GET + POST)
# =============================================================================
# GET:  Returns current system settings (units, timezone, WAN guard,
#        scheduled reboot, low-power mode).
# POST: Saves settings, scheduled reboot config, or low-power config.
#
# Config: /etc/qmanager/qmanager.conf (settings section)
# Cron:   qmanager_scheduled_reboot marker
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

    # One jq read for every settings key; null, false or "" -> default, as qm_config_get (values are not echo-mangled).
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
        @sh "sched_days_json=\(days("sched_reboot_days"))"'
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

    # One `date` call so epoch and wall time come from the same second.
    clock_now=$(date '+%s %Y-%m-%dT%H:%M:%S' 2>/dev/null)
    clock_epoch=${clock_now%% *}
    clock_local=${clock_now#* }
    case "$clock_epoch" in
        ''|*[!0-9]*) clock_epoch=0; clock_local="" ;;
    esac

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
        --argjson clock_epoch "$clock_epoch" \
        --arg clock_local "$clock_local" \
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
            device_clock: {
                epoch: $clock_epoch,
                local: $clock_local
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
        # A hostname failure is reported after every other field is saved.
        val=$(printf '%s' "$POST_DATA" | jq -r '.hostname // empty')
        hn_err=""
        if [ -n "$val" ]; then
            if ! qm_valid_hostname_label "$val"; then
                cgi_error "invalid_hostname" "The device name must be 1 to 64 characters"
                exit 0
            fi
            sys_set_hostname "$val"
            case $? in
                0) ;;
                2) hn_err="hostname_apply_failed"; hn_detail="The device name was saved but could not be applied to the system" ;;
                *) hn_err="hostname_save_failed"; hn_detail="Could not save the device name" ;;
            esac
        fi

        # --- Temperature unit ---
        val=$(printf '%s' "$POST_DATA" | jq -r '.temp_unit // empty')
        if [ -n "$val" ]; then
            if qm_valid_temp_unit "$val"; then
                qm_config_set settings temp_unit "$val"
            else
                cgi_error "invalid_temp_unit" "temp_unit must be 'celsius' or 'fahrenheit'"
                exit 0
            fi
        fi

        # --- Distance unit ---
        val=$(printf '%s' "$POST_DATA" | jq -r '.distance_unit // empty')
        if [ -n "$val" ]; then
            if qm_valid_distance_unit "$val"; then
                qm_config_set settings distance_unit "$val"
            else
                cgi_error "invalid_distance_unit" "distance_unit must be 'km' or 'miles'"
                exit 0
            fi
        fi

        # --- Timezone ---
        val=$(printf '%s' "$POST_DATA" | jq -r '.timezone // empty')
        zn=$(printf '%s' "$POST_DATA" | jq -r '.zonename // empty')
        tz_status="not_attempted"
        if [ -n "$val" ]; then
            tz_status=$(sys_set_timezone "$val" "$zn")
        fi

        # AT device is hardcoded to /dev/smd11 in qcmd — no override needed

        if [ -n "$hn_err" ]; then
            cgi_error "$hn_err" "$hn_detail"
            exit 0
        fi

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
            if ! qm_valid_hhmm "$SCHED_TIME"; then
                cgi_error "invalid_time" "time must be HH:MM format"
                exit 0
            fi

            # Validate days
            qm_sched_days_check "$DAYS_RAW"
            case $? in
                1)
                    cgi_error "no_days" "At least one day must be selected"
                    exit 0
                    ;;
                2)
                    cgi_error "invalid_day" "Days must be 0-6 (0=Sun, 6=Sat)"
                    exit 0
                    ;;
            esac
        fi

        # Defaults for disabled state
        [ -z "$SCHED_TIME" ] && SCHED_TIME="04:00"
        [ -z "$DAYS_RAW" ] && DAYS_RAW="0,1,2,3,4,5,6"

        # Config write, then arm/disarm the runtime systemd timer (root helper). RM520N has no
        # crond; the helper re-validates time/days itself. Lib: system_validate.sh.
        qm_sched_reboot_save "$ENABLED" "$SCHED_TIME" "$DAYS_RAW"
        arm_ok="$QM_ARM_OK"
        armed="$QM_ARM_ARMED"
        arm_reason="$QM_ARM_REASON"

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
