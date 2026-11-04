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
. /usr/lib/qmanager/radio_validate.sh

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
if ! rv_tower_threshold "$FO_THRESHOLD"; then
    cgi_error "$RV_CODE" "$RV_DETAIL"
    exit 0
fi

qlog_info "Updating tower settings: persist=$PERSIST persist_lte=$PERSIST_LTE persist_nr=$PERSIST_NR failover_enabled=$FO_ENABLED threshold=$FO_THRESHOLD"

# --- Send persist AT command if changed --------------------------------------
# save_ctrl writes both radios at once, so read the live pair first; an
# unreadable modem blocks the write rather than guessing the untouched radio.
tower_apply_persist "$PERSIST" "$PERSIST_LTE" "$PERSIST_NR" "$current_persist"
persist_ok="$TW_PERSIST_OK"
applied_lte="$TW_APPLIED_LTE"
applied_nr="$TW_APPLIED_NR"
new_persist="$TW_NEW_PERSIST"

# --- Update config file using jq (atomic, safe) -----------------------------
tower_config_update_settings "$new_persist" "$FO_ENABLED" "$FO_THRESHOLD"

# --- Failover daemon: start when enabled with a lock active, stop when just disabled
tower_apply_failover_state "$FO_ENABLED" "$current_fo_enabled"
watcher_spawned="$TW_WATCHER_SPAWNED"
svc_enable_failed="$TW_SVC_ENABLE_FAILED"
svc_disable_failed="$TW_SVC_DISABLE_FAILED"

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
