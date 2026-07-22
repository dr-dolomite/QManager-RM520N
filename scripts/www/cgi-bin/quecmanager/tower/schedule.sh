#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# schedule.sh — CGI Endpoint: Update Tower Lock Schedule
# =============================================================================
# Updates the schedule section of tower_lock.json and arms/disarms the
# runtime systemd timer pair (via qmanager_tower_schedule_arm) for automatic
# tower lock enable/disable — RM520N has no crond, see schedule_timer.sh.
#
# POST body:
#   {"enabled": true, "start_time": "08:00", "end_time": "22:00", "days": [1,2,3,4,5]}
#
# When enabled, arms qmanager-tower-schedule-apply.timer /
# qmanager-tower-schedule-clear.timer to apply/clear locks at scheduled times.
# When disabled, tears down both timers.
#
# Endpoint: POST /cgi-bin/quecmanager/tower/schedule.sh
# Install location: /www/cgi-bin/quecmanager/tower/schedule.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_tower_schedule"
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
ENABLED=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then (.enabled | tostring) else "" end' 2>/dev/null)
START_TIME=$(printf '%s' "$POST_DATA" | jq -r '.start_time // empty' 2>/dev/null)
END_TIME=$(printf '%s' "$POST_DATA" | jq -r '.end_time // empty' 2>/dev/null)
# Get days as comma-separated string (e.g., "1,2,3,4,5")
DAYS_RAW=$(printf '%s' "$POST_DATA" | jq -r '.days // [] | join(",")' 2>/dev/null)
# Get days as JSON array for config update (e.g., "[1,2,3,4,5]")
DAYS_JSON=$(printf '%s' "$POST_DATA" | jq -c '.days // [1,2,3,4,5]' 2>/dev/null)

# --- Validate ----------------------------------------------------------------
if [ -z "$ENABLED" ]; then
    cgi_error "no_enabled" "Missing enabled field"
    exit 0
fi

if [ "$ENABLED" = "true" ]; then
    # Validate time format HH:MM
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

    # Validate days
    if [ -z "$DAYS_RAW" ]; then
        cgi_error "no_days" "At least one day must be selected"
        exit 0
    fi

    # Validate each day is 0-6
    invalid_day=""
    for d in $(echo "$DAYS_RAW" | tr ',' ' '); do
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

# Ensure config exists
tower_config_init

# --- Scenario 1 guard: Reject enable if no lock targets configured -----------
if [ "$ENABLED" = "true" ]; then
    # Check LTE: at least one cell with earfcn+pci (using jq)
    has_lte=$(tower_config_get '.lte.cells | map(select(. != null)) | length')
    [ -z "$has_lte" ] && has_lte="0"

    # Check NR-SA: pci and arfcn are non-null (using jq)
    nr_pci=$(tower_config_get '.nr_sa.pci')
    nr_arfcn=$(tower_config_get '.nr_sa.arfcn')
    has_nr="false"
    if [ -n "$nr_pci" ] && [ "$nr_pci" != "null" ] && \
       [ -n "$nr_arfcn" ] && [ "$nr_arfcn" != "null" ]; then
        has_nr="true"
    fi

    if [ "$has_lte" = "0" ] && [ "$has_nr" = "false" ]; then
        cgi_error "no_lock_targets" "Configure LTE or NR-SA lock targets before enabling schedule"
        exit 0
    fi
fi

qlog_info "Schedule update: enabled=$ENABLED start=$START_TIME end=$END_TIME days=$DAYS_RAW"

# --- Update config file schedule section using jq (atomic, safe) -------------
# Use defaults for schedule params if not provided (when disabling)
[ -z "$START_TIME" ] && START_TIME="08:00"
[ -z "$END_TIME" ] && END_TIME="22:00"
[ -z "$DAYS_JSON" ] || [ "$DAYS_JSON" = "null" ] && DAYS_JSON="[1,2,3,4,5]"

tower_config_update_schedule "$ENABLED" "$START_TIME" "$END_TIME" "$DAYS_JSON"

# --- Arm/disarm the runtime systemd timer pair (root helper) -----------------
# RM520N has no crond — the old /var/spool/cron/crontabs/root write (two
# lines: apply, clear) was never read by anything. qmanager_tower_schedule_arm
# replaces both with a pair of runtime-generated .timer units armed in one
# call; the helper hardcodes the units + re-validates start/end/days itself
# before they touch a generated .timer file (this CGI-side validation above
# is necessary but not sufficient on its own).
day_list="$DAYS_RAW"

if [ "$ENABLED" = "true" ]; then
    arm_json=$(sudo -n /usr/bin/qmanager_tower_schedule_arm install "$START_TIME" "$END_TIME" "$day_list" 2>/dev/null)
else
    arm_json=$(sudo -n /usr/bin/qmanager_tower_schedule_arm teardown 2>/dev/null)
fi

arm_ok=$(printf '%s' "$arm_json" | jq -r '.success // false' 2>/dev/null)
armed=$(printf '%s' "$arm_json" | jq -r 'if has("armed") then (.armed|tostring) else "false" end' 2>/dev/null)
arm_reason=$(printf '%s' "$arm_json" | jq -r '.reason // ""' 2>/dev/null)
if [ "$arm_ok" != "true" ]; then
    qlog_error "Tower schedule timer arm/disarm failed: ${arm_json:-<empty response>}"
fi
qlog_info "Tower schedule timer ${ENABLED}: apply at ${START_TIME}, clear at ${END_TIME}, days=${day_list}, armed=${armed}"

# --- Response (using jq for guaranteed valid JSON) ---------------------------
# Reconstruct days as JSON array for response
DAYS_RESP=$(printf '%s' "$DAYS_RAW" | jq -Rc 'split(",") | map(tonumber)' 2>/dev/null)
[ -z "$DAYS_RESP" ] && DAYS_RESP="$DAYS_JSON"

jq -n \
    --argjson enabled "$ENABLED" \
    --arg start "$START_TIME" \
    --arg end "$END_TIME" \
    --argjson days "$DAYS_RESP" \
    --argjson armed "$([ "$armed" = "true" ] && echo true || echo false)" \
    --arg reason "$arm_reason" \
    '{success: true, armed: $armed, reason: $reason, enabled: $enabled, start_time: $start, end_time: $end, days: $days}'
