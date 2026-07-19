#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config.sh
. /usr/lib/qmanager/platform.sh
# =============================================================================
# watchdog.sh — CGI Endpoint: Watchdog Settings & Status (GET + POST)
# =============================================================================
# GET:  Returns current watchdog configuration (qmanager.conf) + live status.
# POST: Saves settings, dismisses SIM swap, or requests SIM revert.
#
# Config: /etc/qmanager/qmanager.conf [watchcat] section
# State:  /tmp/qmanager_watchcat.json (read-only, written by daemon)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/monitoring/watchdog.sh
# Install location: /www/cgi-bin/quecmanager/monitoring/watchdog.sh
# =============================================================================

qlog_init "cgi_watchdog"
cgi_headers
cgi_handle_options

WATCHCAT_STATE="/tmp/qmanager_watchcat.json"
SIM_SWAP_FLAG="/tmp/qmanager_sim_swap_detected"
SIM_FAILOVER_FILE="/etc/qmanager/qmanager_sim_failover"
RELOAD_FLAG="/tmp/qmanager_watchcat_reload"
REVERT_FLAG="/tmp/qmanager_watchcat_revert_sim"
DISABLED_FLAG="/tmp/qmanager_watchcat_disabled"

# validate_int: unsigned-integer-only range check (rejects "", leading +/-,
# non-digits, and out-of-range values).
validate_int() {
    local val="$1" min="$2" max="$3"
    case "$val" in ''|*[!0-9]*) return 1 ;; esac
    [ "$val" -ge "$min" ] 2>/dev/null && [ "$val" -le "$max" ] 2>/dev/null
}

# reject_field: emit a structured validation error and exit. Used only
# during PASS 1 (validation) — never after any qm_config_set write.
reject_field() {
    local field="$1" reason="$2"
    jq -n --arg field "$field" --arg reason "$reason" \
        '{success:false, error:"invalid_field", field:$field, reason:$reason}'
    exit 0
}

# =============================================================================
# GET — Fetch settings + live status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching watchdog settings"
    qm_config_init

    enabled="" max_failures="" check_interval="" cooldown=""
    tier1="" tier2="" tier3="" tier4="" backup_sim="" max_reboots=""

    enabled=$(qm_config_get watchcat enabled 0)
    max_failures=$(qm_config_get watchcat max_failures 5)
    check_interval=$(qm_config_get watchcat check_interval 10)
    cooldown=$(qm_config_get watchcat cooldown 60)
    tier1=$(qm_config_get watchcat tier1_enabled 1)
    tier2=$(qm_config_get watchcat tier2_enabled 1)
    tier3=$(qm_config_get watchcat tier3_enabled 0)
    tier4=$(qm_config_get watchcat tier4_enabled 1)
    backup_sim=$(qm_config_get watchcat backup_sim_slot "")
    max_reboots=$(qm_config_get watchcat max_reboots_per_hour 3)

    # Read live status from watchcat daemon state file
    status_json='{}'
    if [ -f "$WATCHCAT_STATE" ]; then
        status_json=$(cat "$WATCHCAT_STATE" 2>/dev/null)
    fi

    # Read SIM failover state
    sim_failover_json='{"active":false}'
    if [ -f "$SIM_FAILOVER_FILE" ]; then
        sim_failover_json=$(cat "$SIM_FAILOVER_FILE" 2>/dev/null)
    fi

    # Read SIM swap detection
    sim_swap_json='{"detected":false}'
    if [ -f "$SIM_SWAP_FLAG" ]; then
        sim_swap_json=$(cat "$SIM_SWAP_FLAG" 2>/dev/null)
    fi

    # Check if watchcat was auto-disabled
    auto_disabled="false"
    [ -f "$DISABLED_FLAG" ] && auto_disabled="true"

    jq -n \
        --argjson enabled "$enabled" \
        --argjson max_failures "$max_failures" \
        --argjson check_interval "$check_interval" \
        --argjson cooldown "$cooldown" \
        --argjson tier1 "$tier1" \
        --argjson tier2 "$tier2" \
        --argjson tier3 "$tier3" \
        --argjson tier4 "$tier4" \
        --arg backup_sim "$backup_sim" \
        --argjson max_reboots "$max_reboots" \
        --argjson status "$status_json" \
        --argjson sim_failover "$sim_failover_json" \
        --argjson sim_swap "$sim_swap_json" \
        --argjson auto_disabled "$auto_disabled" \
        '{
            success: true,
            settings: {
                enabled: ($enabled == 1),
                max_failures: $max_failures,
                check_interval: $check_interval,
                cooldown: $cooldown,
                tier1_enabled: ($tier1 == 1),
                tier2_enabled: ($tier2 == 1),
                tier3_enabled: ($tier3 == 1),
                tier4_enabled: ($tier4 == 1),
                backup_sim_slot: (if $backup_sim == "" then null else ($backup_sim | tonumber) end),
                max_reboots_per_hour: $max_reboots
            },
            status: $status,
            sim_failover: $sim_failover,
            sim_swap: $sim_swap,
            auto_disabled: $auto_disabled
        }'
    exit 0
fi

# =============================================================================
# POST — Save settings / dismiss SIM swap / revert SIM
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
        qlog_info "Saving watchdog settings"

        # ---------------------------------------------------------------
        # PASS 1 — extract every field into f_* locals and validate. Any
        # invalid field calls reject_field (which exits) BEFORE qm_config_init
        # or a single qm_config_set write, so a bad request never partially
        # applies.
        # ---------------------------------------------------------------
        f_enabled=$(printf '%s' "$POST_DATA" | jq -r '.enabled | if . == null then empty else tostring end')

        f_max_failures=$(printf '%s' "$POST_DATA" | jq -r '.max_failures // empty')
        if [ -n "$f_max_failures" ]; then
            validate_int "$f_max_failures" 1 20 || reject_field "max_failures" "must be an integer between 1 and 20"
        fi

        f_check_interval=$(printf '%s' "$POST_DATA" | jq -r '.check_interval // empty')
        if [ -n "$f_check_interval" ]; then
            validate_int "$f_check_interval" 5 60 || reject_field "check_interval" "must be an integer between 5 and 60"
        fi

        f_cooldown=$(printf '%s' "$POST_DATA" | jq -r '.cooldown // empty')
        if [ -n "$f_cooldown" ]; then
            validate_int "$f_cooldown" 10 300 || reject_field "cooldown" "must be an integer between 10 and 300"
        fi

        # Tier enable/disable booleans: legacy parity — anything other than
        # literal true/false is silently ignored (no reject_field), matching
        # the existing case-statement behavior below.
        f_tier1=$(printf '%s' "$POST_DATA" | jq -r '.tier1_enabled | if . == null then empty else tostring end')
        f_tier2=$(printf '%s' "$POST_DATA" | jq -r '.tier2_enabled | if . == null then empty else tostring end')
        f_tier3=$(printf '%s' "$POST_DATA" | jq -r '.tier3_enabled | if . == null then empty else tostring end')
        f_tier4=$(printf '%s' "$POST_DATA" | jq -r '.tier4_enabled | if . == null then empty else tostring end')

        f_backup_sim_slot=$(printf '%s' "$POST_DATA" | jq -r '.backup_sim_slot // empty')
        if [ -n "$f_backup_sim_slot" ] && [ "$f_backup_sim_slot" != "null" ]; then
            case "$f_backup_sim_slot" in
                1|2) ;;
                *) reject_field "backup_sim_slot" "must be 1 or 2" ;;
            esac
        fi

        f_max_reboots=$(printf '%s' "$POST_DATA" | jq -r '.max_reboots_per_hour // empty')
        if [ -n "$f_max_reboots" ]; then
            validate_int "$f_max_reboots" 1 10 || reject_field "max_reboots_per_hour" "must be an integer between 1 and 10"
        fi

        # ---------------------------------------------------------------
        # PASS 2 — apply. Only reached if every field above validated cleanly.
        # ---------------------------------------------------------------
        qm_config_init

        if [ -n "$f_enabled" ]; then
            case "$f_enabled" in
                true)  qm_config_set watchcat enabled 1 ;;
                false) qm_config_set watchcat enabled 0 ;;
            esac
        fi

        [ -n "$f_max_failures" ] && qm_config_set watchcat max_failures "$f_max_failures"
        [ -n "$f_check_interval" ] && qm_config_set watchcat check_interval "$f_check_interval"
        [ -n "$f_cooldown" ] && qm_config_set watchcat cooldown "$f_cooldown"

        if [ -n "$f_tier1" ]; then
            case "$f_tier1" in true) qm_config_set watchcat tier1_enabled 1 ;; false) qm_config_set watchcat tier1_enabled 0 ;; esac
        fi

        if [ -n "$f_tier2" ]; then
            case "$f_tier2" in true) qm_config_set watchcat tier2_enabled 1 ;; false) qm_config_set watchcat tier2_enabled 0 ;; esac
        fi

        if [ -n "$f_tier3" ]; then
            case "$f_tier3" in true) qm_config_set watchcat tier3_enabled 1 ;; false) qm_config_set watchcat tier3_enabled 0 ;; esac
        fi

        if [ -n "$f_tier4" ]; then
            case "$f_tier4" in true) qm_config_set watchcat tier4_enabled 1 ;; false) qm_config_set watchcat tier4_enabled 0 ;; esac
        fi

        if [ -n "$f_backup_sim_slot" ] && [ "$f_backup_sim_slot" != "null" ]; then
            qm_config_set watchcat backup_sim_slot "$f_backup_sim_slot"
        else
            qm_config_set watchcat backup_sim_slot ""
        fi

        [ -n "$f_max_reboots" ] && qm_config_set watchcat max_reboots_per_hour "$f_max_reboots"

        # Signal running watchcat daemon to reload config (if it's already running)
        touch "$RELOAD_FLAG"

        # Clear auto-disabled flag if user is re-enabling
        new_enabled=""
        new_enabled=$(qm_config_get watchcat enabled 0)
        if [ "$new_enabled" = "1" ]; then
            rm -f "$DISABLED_FLAG"
            # Enable and start the watchcat service
            svc_enable qmanager_watchcat
            ( svc_restart qmanager_watchcat & )
            qlog_info "Watchdog settings saved, watchcat enabled and started"
        else
            # Stop and disable the watchcat service
            svc_stop qmanager_watchcat
            svc_disable qmanager_watchcat
            qlog_info "Watchdog settings saved, watchcat stopped and disabled"
        fi
        echo '{"success":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: dismiss_sim_swap
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "dismiss_sim_swap" ]; then
        qlog_info "Dismissing SIM swap notification"
        if [ -f "$SIM_SWAP_FLAG" ]; then
            tmp_json=$(jq -c '.dismissed = true' "$SIM_SWAP_FLAG" 2>/dev/null)
            if [ -n "$tmp_json" ]; then
                printf '%s\n' "$tmp_json" > "$SIM_SWAP_FLAG"
            fi
        fi
        echo '{"success":true}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: revert_sim
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "revert_sim" ]; then
        qlog_info "User requesting SIM revert"
        touch "$REVERT_FLAG"
        echo '{"success":true,"message":"SIM revert requested. The watchcat will process this shortly."}'
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_error "method_not_allowed" "Only GET and POST are supported"
