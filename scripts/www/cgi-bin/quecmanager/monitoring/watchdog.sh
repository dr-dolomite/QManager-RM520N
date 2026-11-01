#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/conn_state.sh
[ -f /usr/lib/qmanager/crash_log.sh ] && . /usr/lib/qmanager/crash_log.sh
# =============================================================================
# watchdog.sh — CGI Endpoint: Watchdog Settings & Status (GET + POST)
# =============================================================================
# GET:  Returns current watchdog configuration (qmanager.conf) + live status.
# POST: Saves settings, dismisses SIM swap, or requests SIM revert.
#
# Config: /etc/qmanager/qmanager.conf [watchcat] section
# State:  /tmp/qmanager_watchcat.json (read-only, written by daemon)
#
# --- Ownership -----------------------------------------------------------
# Connection Quality owns the cadence; down = fail_threshold x interval_sec of failure.
# probe_interval mirrors interval_sec; a changed POSTed value writes that one key.
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
PING_PROFILE_CONFIG="/etc/qmanager/ping_profile.json"
REVERT_FLAG="/tmp/qmanager_watchcat_revert_sim"
DISABLED_FLAG="/tmp/qmanager_watchcat_disabled"
CRASH_LOG="${QM_CRASH_LOG:-/usrdata/qmanager/crash.log}"

# validate_int: unsigned-integer-only range check (rejects "", leading +/-,
# non-digits, and out-of-range values).
validate_int() {
    local val="$1" min="$2" max="$3"
    case "$val" in ''|*[!0-9]*) return 1 ;; esac
    [ "$val" -ge "$min" ] 2>/dev/null && [ "$val" -le "$max" ] 2>/dev/null
}

# Defensive runtime migration: if a legacy watchcat.max_failures value exists
# and watchcat.fail_threshold is unset, copy it across once and delete the old
# key. Idempotent (returns immediately once fail_threshold is present). Covers
# a device that hits this CGI before the installer's own migration runs.
migrate_fail_threshold() {
    local current legacy
    current=$(qm_config_get watchcat fail_threshold "")
    [ -n "$current" ] && return
    legacy=$(qm_config_get watchcat max_failures "")
    if [ -n "$legacy" ]; then
        qm_config_set watchcat fail_threshold "$legacy"
        qm_config_delete watchcat max_failures
        qlog_info "Migrated watchcat.max_failures -> watchcat.fail_threshold ($legacy)"
    fi
}

# True when the daemon's own heartbeat (uptime delta, the poller's test) is past
# its limit: the unit can be active while the daemon is hung. Unknown reads as live.
watchcat_state_stale() {
    local up mono limit v
    read -r up _ < /proc/uptime 2>/dev/null
    up="${up%%.*}"
    set -- $(jq -r '[(.mono // 0), (.stale_after // 0)] | map(tostring) | join(" ")' "$WATCHCAT_STATE" 2>/dev/null)
    mono="$1" limit="$2"
    for v in "$up" "$mono" "$limit"; do
        case "$v" in ''|*[!0-9]*) return 1 ;; esac
    done
    [ "$mono" -gt 0 ] && [ "$limit" -gt 0 ] && [ $((up - mono)) -gt "$limit" ]
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
    migrate_fail_threshold

    enabled="" fail_threshold="" probe_interval="" check_interval="" cooldown=""
    tier1="" tier2="" tier3="" tier4="" backup_sim="" max_reboots=""

    enabled=$(qm_config_get watchcat enabled 0)
    fail_threshold=$(qm_config_get watchcat fail_threshold 5)
    # Read-only: the current ping_profile cadence (Connection Quality owns it).
    conn_state_cadence "$PING_PROFILE_CONFIG"
    probe_interval="$CQ_CFG_INTERVAL_SEC"
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

    # Recent Tier-4 reboots: epoch ints, newest first, at most 5. crash.log also
    # holds scheduled/user reboots and skips; only the watchdog's own count here.
    recent_reboots_json='[]'
    if [ -f "$CRASH_LOG" ]; then
        recent_reboots_json=$(awk -F'|' '$2 == "reboot" && $3 == "tier4_escalation" && $1 ~ /^[0-9]+$/ && $1 + 0 >= 1600000000 { print $1 }' \
            "$CRASH_LOG" 2>/dev/null | tail -n 5 | jq -Rsc '[split("\n")[] | select(length > 0) | tonumber] | reverse' 2>/dev/null)
    fi
    [ -n "$recent_reboots_json" ] || recent_reboots_json='[]'

    # Check if watchcat was auto-disabled
    auto_disabled="false"
    [ -f "$DISABLED_FLAG" ] && auto_disabled="true"

    jq -n \
        --argjson enabled "$enabled" \
        --argjson fail_threshold "$fail_threshold" \
        --argjson probe_interval "$probe_interval" \
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
        --argjson recent_reboots "$recent_reboots_json" \
        '{
            success: true,
            settings: {
                enabled: ($enabled == 1),
                fail_threshold: $fail_threshold,
                probe_interval: $probe_interval,
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
            auto_disabled: $auto_disabled,
            recent_reboots: $recent_reboots
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

        f_fail_threshold=$(printf '%s' "$POST_DATA" | jq -r '.fail_threshold // empty')
        if [ -n "$f_fail_threshold" ]; then
            validate_int "$f_fail_threshold" 1 20 || reject_field "fail_threshold" "must be an integer between 1 and 20"
        fi

        # probe_interval is Connection Quality's interval_sec; only a changed value is written.
        f_probe_interval=$(printf '%s' "$POST_DATA" | jq -r '.probe_interval // empty')
        if [ -n "$f_probe_interval" ]; then
            validate_int "$f_probe_interval" 1 60 || reject_field "probe_interval" "must be an integer between 1 and 60"
            conn_state_cadence "$PING_PROFILE_CONFIG"
            [ "$f_probe_interval" = "$CQ_CFG_INTERVAL_SEC" ] && f_probe_interval=""
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
        migrate_fail_threshold

        if [ -n "$f_enabled" ]; then
            case "$f_enabled" in
                true)  qm_config_set watchcat enabled 1 ;;
                false) : ;; # committed only after svc_disable succeeds, below
            esac
        fi

        [ -n "$f_fail_threshold" ] && qm_config_set watchcat fail_threshold "$f_fail_threshold"

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

        if [ -n "$f_probe_interval" ]; then
            _pp='{}'
            [ -f "$PING_PROFILE_CONFIG" ] && _pp=$(cat "$PING_PROFILE_CONFIG" 2>/dev/null)
            printf '%s' "$_pp" | jq -e 'type == "object"' >/dev/null 2>&1 || _pp='{}'
            if printf '%s' "$_pp" | jq --argjson v "$f_probe_interval" '.interval_sec = $v' > "${PING_PROFILE_CONFIG}.tmp" 2>/dev/null &&
                [ -s "${PING_PROFILE_CONFIG}.tmp" ]; then
                mv "${PING_PROFILE_CONFIG}.tmp" "$PING_PROFILE_CONFIG"
                touch /tmp/qmanager_ping_reload
            else
                rm -f "${PING_PROFILE_CONFIG}.tmp"
                qlog_error "Failed to write interval_sec to $PING_PROFILE_CONFIG"
            fi
        fi

        # Signal running watchcat daemon to reload config (if it's already running)
        touch "$RELOAD_FLAG"

        # Desired enabled state: this request's f_enabled if it set one,
        # otherwise whatever is already persisted (enabled=0 for "false" is
        # NOT yet written — see the deferred commit below).
        new_enabled=""
        if [ "$f_enabled" = "false" ]; then
            new_enabled=0
        else
            new_enabled=$(qm_config_get watchcat enabled 0)
        fi
        if [ "$new_enabled" = "1" ]; then
            rm -f "$DISABLED_FLAG"
            # Enable and start the watchcat service
            if ! svc_enable qmanager_watchcat; then
                cgi_error "service_enable_failed" "Watchdog settings were saved, but the watchcat service could not be enabled on boot (rootfs may be read-only)"
                exit 0
            fi
            # A live daemon reloads from the flag touched above (a restart would drop
            # its recovery state); start it when down, restart it when hung.
            if svc_is_running qmanager_watchcat && ! watchcat_state_stale; then
                qlog_info "Watchdog settings saved, running watchcat will reload"
            else
                ( svc_restart qmanager_watchcat & )
                qlog_info "Watchdog settings saved, watchcat enabled and (re)started"
            fi
        else
            # Stop and disable the watchcat service BEFORE persisting enabled=0,
            # so a failed disable never leaves stale "enabled=0" config behind.
            svc_stop qmanager_watchcat
            if ! svc_disable qmanager_watchcat; then
                cgi_error "service_disable_failed" "Watchdog settings were saved, but the watchcat service could not be disabled on boot (rootfs may be read-only)"
                exit 0
            fi
            qm_config_set watchcat enabled 0
            qlog_info "Watchdog settings saved, watchcat stopped and disabled"
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
