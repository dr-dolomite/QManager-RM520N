#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
# =============================================================================
# settings.sh — CGI Endpoint: Update Tower Lock Settings
# =============================================================================
# Updates persist and failover settings. Persist changes are sent to the
# modem immediately via AT+QNWLOCK="save_ctrl",<lte>,<nr>. Failover settings
# are written to the config file only. Every field is optional.
#
# POST body (any subset):
#   {"persist_lte": true, "persist_nr": false,
#    "failover_enabled": true, "failover_threshold": 20}
#   "persist": true|false sets both radios (older clients).
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
# Persist fields must be JSON booleans; "invalid" covers strings like "true".
PERSIST=$(printf '%s' "$POST_DATA" | jq -r 'if has("persist") then (if (.persist | type) == "boolean" then (.persist | tostring) else "invalid" end) else "unset" end' 2>/dev/null)
PERSIST_LTE=$(printf '%s' "$POST_DATA" | jq -r 'if has("persist_lte") then (if (.persist_lte | type) == "boolean" then (.persist_lte | tostring) else "invalid" end) else "unset" end' 2>/dev/null)
PERSIST_NR=$(printf '%s' "$POST_DATA" | jq -r 'if has("persist_nr") then (if (.persist_nr | type) == "boolean" then (.persist_nr | tostring) else "invalid" end) else "unset" end' 2>/dev/null)
FO_ENABLED=$(printf '%s' "$POST_DATA" | jq -r 'if has("failover_enabled") then (.failover_enabled | tostring) else "unset" end' 2>/dev/null)
FO_THRESHOLD=$(printf '%s' "$POST_DATA" | jq -r 'if has("failover_threshold") then (.failover_threshold | tostring) else "unset" end' 2>/dev/null)

# --- Validate ----------------------------------------------------------------
for _v in "$PERSIST" "$PERSIST_LTE" "$PERSIST_NR"; do
    case "$_v" in
        unset|true|false) ;;
        *) cgi_error "invalid_persist" "persist values must be true or false"; exit 0 ;;
    esac
done

if [ "$PERSIST" = "unset" ] && [ "$PERSIST_LTE" = "unset" ] && [ "$PERSIST_NR" = "unset" ] \
    && [ "$FO_ENABLED" = "unset" ] && [ "$FO_THRESHOLD" = "unset" ]; then
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

qlog_info "Updating tower settings: persist=$PERSIST persist_lte=$PERSIST_LTE persist_nr=$PERSIST_NR failover_enabled=$FO_ENABLED threshold=$FO_THRESHOLD"

# --- Send persist AT command if changed --------------------------------------
# save_ctrl writes both radios at once, so read the live pair first; an
# unreadable modem blocks the write rather than guessing the untouched radio.
persist_ok="true"
applied_lte="null"
applied_nr="null"
new_persist="$current_persist"
if [ "$PERSIST" != "unset" ] || [ "$PERSIST_LTE" != "unset" ] || [ "$PERSIST_NR" != "unset" ]; then
    if ! cur_state=$(tower_read_persist); then
        qlog_error "Persist read failed; not writing save_ctrl"
        persist_ok="false"
    else
        set -- $cur_state
        cur_lte="$1"
        cur_nr="$2"
        want_lte="$cur_lte"
        want_nr="$cur_nr"
        case "$PERSIST" in
            true) want_lte="1"; want_nr="1" ;;
            false) want_lte="0"; want_nr="0" ;;
        esac
        case "$PERSIST_LTE" in true) want_lte="1" ;; false) want_lte="0" ;; esac
        case "$PERSIST_NR" in true) want_nr="1" ;; false) want_nr="0" ;; esac

        if [ "$want_lte" != "$cur_lte" ] || [ "$want_nr" != "$cur_nr" ]; then
            # qcmd fails by exit status; ERROR never reaches stdout.
            sleep 0.1
            if tower_set_persist "$want_lte" "$want_nr" >/dev/null; then
                qlog_info "Persist set lte=$want_lte nr=$want_nr"
            else
                qlog_error "Persist AT command failed"
                persist_ok="false"
            fi
        fi

        # What the modem holds now: the request if it landed, else what it had.
        fin_lte="$cur_lte"
        fin_nr="$cur_nr"
        if [ "$persist_ok" = "true" ]; then
            fin_lte="$want_lte"
            fin_nr="$want_nr"
        fi
        applied_lte="false"
        applied_nr="false"
        [ "$fin_lte" = "1" ] && applied_lte="true"
        [ "$fin_nr" = "1" ] && applied_nr="true"
        # config.persist mirrors "both radios keep the lock".
        new_persist="false"
        [ "$applied_lte" = "true" ] && [ "$applied_nr" = "true" ] && new_persist="true"
    fi
fi

# --- Update config file using jq (atomic, safe) -----------------------------
tower_config_update_settings "$new_persist" "$FO_ENABLED" "$FO_THRESHOLD"

# --- Ensure failover daemon is running when enabled + lock active ------------
watcher_spawned="false"
svc_enable_failed="false"
if [ "$FO_ENABLED" = "true" ]; then
    lte_active=$(tower_config_get ".lte.enabled")
    nr_active=$(tower_config_get ".nr_sa.enabled")
    if [ "$lte_active" = "true" ] || [ "$nr_active" = "true" ]; then
        # Only spawn if daemon is not already running (avoids resetting settle timer)
        daemon_alive="false"
        if [ -f "$TOWER_FAILOVER_PID" ]; then
            wpid=$(cat "$TOWER_FAILOVER_PID" 2>/dev/null | tr -d ' \n\r')
            pid_alive "$wpid" && daemon_alive="true"
        fi
        if [ "$daemon_alive" != "true" ]; then
            spawn_result=$(tower_spawn_failover_watcher); _spawn_rc=$?
            [ "$spawn_result" = "true" ] && watcher_spawned="true"
            # rc 2 = daemon live but svc_enable failed, so failover won't
            # survive a reboot. The printed boolean describes only the running
            # daemon, so without this the lost persistence is invisible.
            [ "$_spawn_rc" = "2" ] && svc_enable_failed="true"
            qlog_info "Failover spawn attempt: result=$spawn_result rc=$_spawn_rc"
        fi
    fi
fi

# --- Kill failover daemon if failover was just disabled ----------------------
svc_disable_failed="false"
if [ "$FO_ENABLED" = "false" ] && [ "$current_fo_enabled" = "true" ]; then
    tower_kill_failover_watcher
    rm -f "$TOWER_FAILOVER_FLAG"
    if ! svc_disable qmanager_tower_failover; then
        svc_disable_failed="true"
        qlog_warn "svc_disable qmanager_tower_failover failed (rootfs may be read-only)"
    fi
    qlog_info "Failover disabled — killed daemon, disabled service"
fi

# --- Response ----------------------------------------------------------------
# persist_lte / persist_nr: each radio's value after this call, null when
# persistence was not asked or the modem could not be read.
jq -n \
    --argjson persist "$new_persist" \
    --argjson plte "$applied_lte" \
    --argjson pnr "$applied_nr" \
    --argjson pfail "$([ "$persist_ok" = "true" ] && echo false || echo true)" \
    --argjson fo_enabled "$FO_ENABLED" \
    --argjson fo_threshold "$FO_THRESHOLD" \
    --argjson ws "$watcher_spawned" \
    --argjson svc_disable_failed "$svc_disable_failed" \
    --argjson svc_enable_failed "$svc_enable_failed" \
    '{success: true, persist: $persist, persist_lte: $plte, persist_nr: $pnr, failover_enabled: $fo_enabled, failover_threshold: $fo_threshold, watcher_spawned: $ws, service_disable_failed: $svc_disable_failed, service_enable_failed: $svc_enable_failed}
     + (if $pfail then {persist_command_failed: true} else {} end)'
