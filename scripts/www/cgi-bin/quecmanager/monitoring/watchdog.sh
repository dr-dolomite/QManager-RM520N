#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/conn_state.sh
[ -f /usr/lib/qmanager/crash_log.sh ] && . /usr/lib/qmanager/crash_log.sh
# Guarded: a partial install leaves the page working without the P5 keys.
if [ -f /usr/lib/qmanager/wd_common.sh ]; then
    . /usr/lib/qmanager/wd_common.sh
else
    WD_KEYS=""; wd_key_spec() { return 1; }; wd_key_valid() { return 1; }; wd_key_get() { return 1; }
fi
if [ -f /usr/lib/qmanager/wd_quality.sh ]; then
    . /usr/lib/qmanager/wd_quality.sh
else
    q_lat_limit=250; q_loss_limit=30; wd_quality_limits() { :; }
fi
. /usr/lib/qmanager/monitoring_validate.sh
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
PING_PROFILE_CONFIG="/etc/qmanager/ping_profile.json"
REVERT_FLAG="/tmp/qmanager_watchcat_revert_sim"
DISABLED_FLAG="/tmp/qmanager_watchcat_disabled"
CRASH_LOG="${QM_CRASH_LOG:-/usrdata/qmanager/crash.log}"

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
    wd_settings=$(mv_wd_keys_json)
    # The limits the quality trigger really uses: Connection Quality's presets raised to the floors.
    wd_quality_limits

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
        --argjson wd_settings "$wd_settings" \
        --argjson q_lat "$q_lat_limit" --argjson q_loss "$q_loss_limit" \
        '{
            success: true,
            settings: ({
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
            } + $wd_settings),
            status: $status,
            sim_failover: $sim_failover,
            sim_swap: $sim_swap,
            auto_disabled: $auto_disabled,
            recent_reboots: $recent_reboots,
            quality_limits: {latency_ms: $q_lat, loss_pct: $q_loss}
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
            _r=$(mv_wd_check fail_threshold "$f_fail_threshold") || reject_field "fail_threshold" "$_r"
        fi

        # probe_interval is Connection Quality's interval_sec; only a changed value is written.
        f_probe_interval=$(printf '%s' "$POST_DATA" | jq -r '.probe_interval // empty')
        if [ -n "$f_probe_interval" ]; then
            _r=$(mv_wd_check probe_interval "$f_probe_interval") || reject_field "probe_interval" "$_r"
            conn_state_cadence "$PING_PROFILE_CONFIG"
            [ "$f_probe_interval" = "$CQ_CFG_INTERVAL_SEC" ] && f_probe_interval=""
        fi

        f_check_interval=$(printf '%s' "$POST_DATA" | jq -r '.check_interval // empty')
        if [ -n "$f_check_interval" ]; then
            _r=$(mv_wd_check check_interval "$f_check_interval") || reject_field "check_interval" "$_r"
        fi

        f_cooldown=$(printf '%s' "$POST_DATA" | jq -r '.cooldown // empty')
        if [ -n "$f_cooldown" ]; then
            _r=$(mv_wd_check cooldown "$f_cooldown") || reject_field "cooldown" "$_r"
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
            _r=$(mv_wd_check backup_sim_slot "$f_backup_sim_slot") || reject_field "backup_sim_slot" "$_r"
        fi

        f_max_reboots=$(printf '%s' "$POST_DATA" | jq -r '.max_reboots_per_hour // empty')
        if [ -n "$f_max_reboots" ]; then
            _r=$(mv_wd_check max_reboots_per_hour "$f_max_reboots") || reject_field "max_reboots_per_hour" "$_r"
        fi

        # wd_common.sh keys: booleans take true/false, the rest their table range.
        wd_writes=""
        for _k in $WD_KEYS; do
            _v=$(printf '%s' "$POST_DATA" | jq -r --arg k "$_k" '.[$k] | if . == null then empty else tostring end')
            [ -n "$_v" ] || continue
            _v=$(mv_wd_key_normalize "$_k" "$_v") || reject_field "$_k" "$_v"
            wd_writes="$wd_writes $_k=$_v"
        done

        # ---------------------------------------------------------------
        # PASS 2 — apply. Only reached if every field above validated cleanly.
        # ---------------------------------------------------------------
        mv_wd_commit
        case $? in
            10)
                cgi_error "service_enable_failed" "Watchdog settings were saved, but the watchcat service could not be enabled on boot (rootfs may be read-only)"
                exit 0
                ;;
            11)
                cgi_error "service_disable_failed" "Watchdog settings were saved, but the watchcat service could not be disabled on boot (rootfs may be read-only)"
                exit 0
                ;;
        esac
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
