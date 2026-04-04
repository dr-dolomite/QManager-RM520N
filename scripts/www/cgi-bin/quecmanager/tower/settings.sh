#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
# =============================================================================
# settings.sh — CGI Endpoint: Update Tower Lock Settings
# =============================================================================
# Updates persist and failover settings. Persist changes are sent to the
# modem immediately via AT+QNWLOCK="save_ctrl". Failover settings are
# written to the config file only.
#
# POST body:
#   {"persist": true, "failover_enabled": true, "failover_threshold": 20}
#
# Endpoint: POST /cgi-bin/quecmanager/tower/settings.sh
# Install location: /www/cgi-bin/quecmanager/tower/settings.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_tower_settings"
cgi_headers
cgi_handle_options

# --- Load library ------------------------------------------------------------
. /usr/lib/qmanager/tower_lock_mgr.sh 2>/dev/null

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

# --- Parse fields using jq ---------------------------------------------------
# IMPORTANT: Cannot use `// empty` for booleans — jq treats `false` as falsy,
# so `false // empty` produces nothing. Use `has()` + `tostring` instead.
# "unset" = field not present in POST body (keep current value).
PERSIST=$(printf '%s' "$POST_DATA" | jq -r 'if has("persist") then (.persist | tostring) else "unset" end' 2>/dev/null)
FO_ENABLED=$(printf '%s' "$POST_DATA" | jq -r 'if has("failover_enabled") then (.failover_enabled | tostring) else "unset" end' 2>/dev/null)
FO_THRESHOLD=$(printf '%s' "$POST_DATA" | jq -r 'if has("failover_threshold") then (.failover_threshold | tostring) else "unset" end' 2>/dev/null)

# --- Validate ----------------------------------------------------------------
if [ "$PERSIST" = "unset" ] && [ "$FO_ENABLED" = "unset" ] && [ "$FO_THRESHOLD" = "unset" ]; then
    cgi_error "no_fields" "No settings fields provided"
    exit 0
fi

# Ensure config exists
tower_config_init

# Read current values as defaults (using jq — safe)
current_persist=$(tower_config_get ".persist")
[ "$current_persist" != "true" ] && current_persist="false"

current_fo_enabled=$(tower_config_get ".failover.enabled")
[ "$current_fo_enabled" != "true" ] && [ "$current_fo_enabled" != "false" ] && current_fo_enabled="true"

current_fo_threshold=$(tower_config_get ".failover.threshold")
[ -z "$current_fo_threshold" ] && current_fo_threshold="20"

# Apply provided values (or keep current if "unset")
[ "$PERSIST" = "unset" ] && PERSIST="$current_persist"
[ "$FO_ENABLED" = "unset" ] && FO_ENABLED="$current_fo_enabled"
[ "$FO_THRESHOLD" = "unset" ] && FO_THRESHOLD="$current_fo_threshold"

# Validate threshold range
if [ -n "$FO_THRESHOLD" ]; then
    case "$FO_THRESHOLD" in
        *[!0-9]*)
            cgi_error "invalid_threshold" "Threshold must be a number 0-100"
            exit 0
            ;;
    esac
    if [ "$FO_THRESHOLD" -lt 0 ] 2>/dev/null || [ "$FO_THRESHOLD" -gt 100 ] 2>/dev/null; then
        cgi_error "invalid_threshold" "Threshold must be 0-100"
        exit 0
    fi
fi

qlog_info "Updating tower settings: persist=$PERSIST failover_enabled=$FO_ENABLED threshold=$FO_THRESHOLD"

# --- Send persist AT command if changed --------------------------------------
persist_ok="true"
if [ "$PERSIST" != "$current_persist" ]; then
    local_val="0"
    [ "$PERSIST" = "true" ] && local_val="1"

    result=$(tower_set_persist "$local_val")
    rc=$?

    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        qlog_error "Persist AT command failed (rc=$rc)"
        persist_ok="false"
    else
        case "$result" in
            *ERROR*)
                qlog_error "Persist AT ERROR: $result"
                persist_ok="false"
                ;;
            *)
                qlog_info "Persist set to $local_val"
                ;;
        esac
    fi
fi

# --- Update config file using jq (atomic, safe) -----------------------------
tower_config_update_settings "$PERSIST" "$FO_ENABLED" "$FO_THRESHOLD"

# --- Ensure failover daemon is running when enabled + lock active ------------
watcher_spawned="false"
if [ "$FO_ENABLED" = "true" ]; then
    lte_active=$(tower_config_get ".lte.enabled")
    nr_active=$(tower_config_get ".nr_sa.enabled")
    if [ "$lte_active" = "true" ] || [ "$nr_active" = "true" ]; then
        # Only spawn if daemon is not already running (avoids resetting settle timer)
        daemon_alive="false"
        if [ -f "$TOWER_FAILOVER_PID" ]; then
            wpid=$(cat "$TOWER_FAILOVER_PID" 2>/dev/null | tr -d ' \n\r')
            [ -n "$wpid" ] && kill -0 "$wpid" 2>/dev/null && daemon_alive="true"
        fi
        if [ "$daemon_alive" != "true" ]; then
            spawn_result=$(tower_spawn_failover_watcher)
            [ "$spawn_result" = "true" ] && watcher_spawned="true"
            qlog_info "Failover spawn attempt: result=$spawn_result"
        fi
    fi
fi

# --- Kill failover daemon if failover was just disabled ----------------------
if [ "$FO_ENABLED" = "false" ] && [ "$current_fo_enabled" = "true" ]; then
    tower_kill_failover_watcher
    rm -f "$TOWER_FAILOVER_FLAG"
    svc_disable qmanager_tower_failover
    qlog_info "Failover disabled — killed daemon, disabled service"
fi

# --- Response ----------------------------------------------------------------
if [ "$persist_ok" = "true" ]; then
    jq -n \
        --argjson persist "$PERSIST" \
        --argjson fo_enabled "$FO_ENABLED" \
        --argjson fo_threshold "$FO_THRESHOLD" \
        --argjson ws "$watcher_spawned" \
        '{success: true, persist: $persist, failover_enabled: $fo_enabled, failover_threshold: $fo_threshold, watcher_spawned: $ws}'
else
    jq -n \
        --argjson persist "$PERSIST" \
        --argjson fo_enabled "$FO_ENABLED" \
        --argjson fo_threshold "$FO_THRESHOLD" \
        --argjson ws "$watcher_spawned" \
        '{success: true, persist_command_failed: true, persist: $persist, failover_enabled: $fo_enabled, failover_threshold: $fo_threshold, watcher_spawned: $ws}'
fi
