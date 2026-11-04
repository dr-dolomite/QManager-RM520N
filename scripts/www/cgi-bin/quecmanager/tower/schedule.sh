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
    if ! rv_hhmm "$START_TIME"; then
        cgi_error "invalid_start_time" "start_time must be HH:MM format"
        exit 0
    fi
    if ! rv_hhmm "$END_TIME"; then
        cgi_error "invalid_end_time" "end_time must be HH:MM format"
        exit 0
    fi

    # Validate days (at least one, each 0-6)
    if ! rv_tower_days "$DAYS_RAW"; then
        cgi_error "$RV_CODE" "$RV_DETAIL"
        exit 0
    fi
fi

# Ensure config exists
tower_config_init

# --- Scenario 1 guard: Reject enable if no lock targets configured -----------
if [ "$ENABLED" = "true" ]; then
    if ! tower_has_lock_targets; then
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

tower_apply_schedule_timer "$ENABLED" "$START_TIME" "$END_TIME" "$day_list"
arm_ok="$TW_ARM_OK"
armed="$TW_ARMED"
arm_reason="$TW_ARM_REASON"

# --- Response (using jq for guaranteed valid JSON) ---------------------------
# Reconstruct days as JSON array for response
DAYS_RESP=$(printf '%s' "$DAYS_RAW" | jq -Rc 'split(",") | map(tonumber)' 2>/dev/null)
[ -z "$DAYS_RESP" ] && DAYS_RESP="$DAYS_JSON"

# The config write above always succeeds, so this stays success:true; an arm
# failure is surfaced as a warning (matches scenarios/activate.sh's
# partial_band_lock convention) rather than changing the success shape.
if [ "$arm_ok" != "true" ]; then
    jq -n \
        --argjson enabled "$ENABLED" \
        --arg start "$START_TIME" \
        --arg end "$END_TIME" \
        --argjson days "$DAYS_RESP" \
        --argjson armed "$([ "$armed" = "true" ] && echo true || echo false)" \
        --arg reason "$arm_reason" \
        --arg detail "${arm_reason:-Tower schedule timer could not be armed}" \
        '{success: true, armed: $armed, reason: $reason, warning: "tower_schedule_arm_failed", detail: $detail, enabled: $enabled, start_time: $start, end_time: $end, days: $days}'
else
    jq -n \
        --argjson enabled "$ENABLED" \
        --arg start "$START_TIME" \
        --arg end "$END_TIME" \
        --argjson days "$DAYS_RESP" \
        --argjson armed "$([ "$armed" = "true" ] && echo true || echo false)" \
        --arg reason "$arm_reason" \
        '{success: true, armed: $armed, reason: $reason, enabled: $enabled, start_time: $start, end_time: $end, days: $days}'
fi
