#!/bin/sh
# =============================================================================
# quality_thresholds.sh — CGI Endpoint: Connection Quality thresholds (GET + POST)
# =============================================================================
# GET:  Returns the latency/loss presets with their resolved values, plus the
#       single alert wait (alert_after_min), and an is_default flag.
# POST: Saves any of latency.preset, loss.preset (standard/tolerant/very-tolerant/custom),
#       latency.custom_ms (1-10000), loss.custom_pct (1-100), alert_after_min (1-1440 min)
#       by MERGING into /etc/qmanager/quality_thresholds.json (unknown keys
#       survive) and pokes the poller reload flag at /tmp/qmanager_events_reload.
#
# The preset table and the wait resolver live in conn_state.sh (single source
# of truth) — this CGI writes only preset names and the wait.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh
# Install location: /www/cgi-bin/quecmanager/settings/quality_thresholds.sh
# =============================================================================

LIB_DIR="${QM_LIB_DIR:-/usr/lib/qmanager}"
. "$LIB_DIR/cgi_base.sh"
. "$LIB_DIR/conn_state.sh"

qlog_init "cgi_quality_thresholds"
cgi_headers
cgi_handle_options

CONFIG="$QUALITY_CONFIG"
RELOAD_FLAG="$QUALITY_RELOAD_FLAG"

VALID_PRESETS='standard tolerant very-tolerant custom'

is_valid_preset() {
    case "$1" in
        standard|tolerant|very-tolerant|custom) return 0 ;;
        *) return 1 ;;
    esac
}

# _num_key_int section key: the stored value when it is a JSON integer, else nothing.
_num_key_int() {
    jq -r --arg s "$1" --arg k "$2" \
        '(try .[$s][$k] catch null) | if type == "number" and . == floor then tostring else "" end' \
        "$CONFIG" 2>/dev/null </dev/null
}

# =============================================================================
# GET — Fetch current presets
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching quality thresholds"

    lat="tolerant"
    loss="tolerant"
    lat_ok=false
    loss_ok=false
    lat_custom=""
    loss_custom=""

    if [ -f "$CONFIG" ]; then
        v_lat=$(jq -r '(try .latency.preset catch null) | if type == "string" then . else "" end' "$CONFIG" 2>/dev/null </dev/null) || v_lat=""
        v_loss=$(jq -r '(try .loss.preset catch null) | if type == "string" then . else "" end' "$CONFIG" 2>/dev/null </dev/null) || v_loss=""
        lat_custom=$(_num_key_int latency custom_ms)
        loss_custom=$(_num_key_int loss custom_pct)
        case "$v_lat" in
            standard|tolerant|very-tolerant) lat="$v_lat"; lat_ok=true ;;
            custom) cq_preset_latency custom "$lat_custom" && { lat="custom"; lat_ok=true; } ;;
        esac
        case "$v_loss" in
            standard|tolerant|very-tolerant) loss="$v_loss"; loss_ok=true ;;
            custom) cq_preset_loss custom "$loss_custom" && { loss="custom"; loss_ok=true; } ;;
        esac
        [ "$lat_ok" = "true" ] || qlog_warn "quality_thresholds.json had unusable latency preset '$v_lat', returning default"
        [ "$loss_ok" = "true" ] || qlog_warn "quality_thresholds.json had unusable loss preset '$v_loss', returning default"
    fi

    if [ "$lat_ok" = "true" ] && [ "$loss_ok" = "true" ]; then
        is_default=false
    else
        is_default=true
    fi

    cq_preset_latency "$lat" "$lat_custom"
    cq_preset_loss "$loss" "$loss_custom"
    cq_alert_after_min

    jq -n --arg lat "$lat" --arg loss "$loss" --argjson is_default "$is_default" \
        --argjson lat_ms "$CQ_LAT_MS" --argjson lat_deb "$CQ_LAT_DEBOUNCE" \
        --argjson loss_pct "$CQ_LOSS_PCT" --argjson loss_deb "$CQ_LOSS_DEBOUNCE" \
        --argjson wait "$CQ_ALERT_AFTER_MIN" \
        --argjson lat_custom "${lat_custom:-null}" --argjson loss_custom "${loss_custom:-null}" \
        '{success: true,
          settings: {
            latency: {preset: $lat, value_ms: $lat_ms, debounce: $lat_deb, custom_ms: $lat_custom},
            loss: {preset: $loss, value_pct: $loss_pct, debounce: $loss_deb, custom_pct: $loss_custom},
            alert_after_min: $wait
          },
          is_default: $is_default}'
    exit 0
fi

# =============================================================================
# POST — Save presets and/or the alert wait
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    if [ "$ACTION" != "save_settings" ]; then
        cgi_error "unknown_action" "Unknown action: $ACTION"
        exit 0
    fi

    # alert_after_min: absent = leave as is; present must be an integer 1-1440.
    new_wait=$(printf '%s' "$POST_DATA" | jq -r 'if has("alert_after_min") then (.alert_after_min | tojson) else "" end' 2>/dev/null)
    if [ -n "$new_wait" ]; then
        case "$new_wait" in
            *[!0-9]*) cgi_error "invalid_alert_after_min" "alert_after_min must be a whole number of minutes between 1 and 1440"; exit 0 ;;
        esac
        if [ "$new_wait" -lt 1 ] || [ "$new_wait" -gt 1440 ]; then
            cgi_error "invalid_alert_after_min" "alert_after_min must be between 1 and 1440"
            exit 0
        fi
    fi

    # Presets are required unless this POST carries only alert_after_min.
    new_lat=$(printf '%s' "$POST_DATA" | jq -r '(.latency.preset // empty) | if type == "string" then . else "" end' 2>/dev/null)
    if [ -n "$new_lat" ] || [ -z "$new_wait" ]; then
        if ! is_valid_preset "$new_lat"; then
            cgi_error "invalid_latency_preset" "latency.preset must be one of: $VALID_PRESETS"
            exit 0
        fi
    fi

    new_loss=$(printf '%s' "$POST_DATA" | jq -r '(.loss.preset // empty) | if type == "string" then . else "" end' 2>/dev/null)
    if [ -n "$new_loss" ] || [ -z "$new_wait" ]; then
        if ! is_valid_preset "$new_loss"; then
            cgi_error "invalid_loss_preset" "loss.preset must be one of: $VALID_PRESETS"
            exit 0
        fi
    fi

    # A custom preset needs its integer: latency 1-10000 ms, loss 1-100 %.
    new_lat_custom=""
    new_loss_custom=""
    if [ "$new_lat" = "custom" ]; then
        new_lat_custom=$(printf '%s' "$POST_DATA" | jq -r '.latency.custom_ms | if type == "number" and . == floor then tostring else "" end' 2>/dev/null)
        case "$new_lat_custom" in ''|*[!0-9]*) new_lat_custom="" ;; esac
        if [ -z "$new_lat_custom" ] || [ "${#new_lat_custom}" -gt 5 ] || [ "$new_lat_custom" -lt 1 ] || [ "$new_lat_custom" -gt 10000 ]; then
            cgi_error "invalid_custom_latency" "latency.custom_ms must be a whole number between 1 and 10000"
            exit 0
        fi
    fi
    if [ "$new_loss" = "custom" ]; then
        new_loss_custom=$(printf '%s' "$POST_DATA" | jq -r '.loss.custom_pct | if type == "number" and . == floor then tostring else "" end' 2>/dev/null)
        case "$new_loss_custom" in ''|*[!0-9]*) new_loss_custom="" ;; esac
        if [ -z "$new_loss_custom" ] || [ "${#new_loss_custom}" -gt 3 ] || [ "$new_loss_custom" -lt 1 ] || [ "$new_loss_custom" -gt 100 ]; then
            cgi_error "invalid_custom_loss" "loss.custom_pct must be a whole number between 1 and 100"
            exit 0
        fi
    fi

    # Merge: only the keys this POST carries are touched. A named preset keeps any stored custom number.
    filter='.'
    if [ "$new_lat" = "custom" ]; then
        filter="$filter | .latency = ((if (.latency | type) == \"object\" then .latency else {} end) + {preset: \$lat, custom_ms: \$lat_custom})"
    elif [ -n "$new_lat" ]; then
        filter="$filter | .latency = ((if (.latency | type) == \"object\" then .latency else {} end) + {preset: \$lat})"
    fi
    if [ "$new_loss" = "custom" ]; then
        filter="$filter | .loss = ((if (.loss | type) == \"object\" then .loss else {} end) + {preset: \$loss, custom_pct: \$loss_custom})"
    elif [ -n "$new_loss" ]; then
        filter="$filter | .loss = ((if (.loss | type) == \"object\" then .loss else {} end) + {preset: \$loss})"
    fi
    [ -n "$new_wait" ] && filter="$filter | .alert_after_min = \$wait"

    if ! cq_quality_merge "$filter" --arg lat "$new_lat" --arg loss "$new_loss" --argjson wait "${new_wait:-null}" \
        --argjson lat_custom "${new_lat_custom:-null}" --argjson loss_custom "${new_loss_custom:-null}"; then
        cgi_error "write_failed" "Failed to write config file"
        exit 0
    fi

    qlog_info "Quality thresholds saved: latency=${new_lat:--} loss=${new_loss:--} alert_after_min=${new_wait:--}"

    # Poke the poller reload (failure non-fatal; old config remains active).
    if ! touch "$RELOAD_FLAG" 2>/dev/null; then
        qlog_warn "Failed to touch reload flag at $RELOAD_FLAG (poller may not reload until restart)"
    fi

    cgi_success
    exit 0
fi

# =============================================================================
# Unsupported method
# =============================================================================
cgi_error "method_not_allowed" "Only GET and POST are supported"
