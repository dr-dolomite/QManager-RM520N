#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/adaptive_polling.sh
# =============================================================================
# adaptive_polling.sh — CGI Endpoint: poller activity tiers (GET + POST)
# =============================================================================
# GET:  { success, settings: {enabled, active_grace, idle_interval, idle_threshold,
#         deep_idle_interval}, isDefault, tier }. Values are the clamped ones the
#         poller runs with; isDefault is true while the .poller section is absent.
# POST: { action: "save", enabled, active_grace, idle_interval, idle_threshold,
#         deep_idle_interval } -> qmanager.conf .poller, then the reload flag.
#
# Ranges mirror qmanager_poller resolve_poller_config (docs/reference/adaptive-polling.md).
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/adaptive_polling.sh
# Install location: /www/cgi-bin/quecmanager/system/adaptive_polling.sh
# =============================================================================

qlog_init "cgi_adaptive_polling"
cgi_headers
cgi_handle_options

STATUS_FILE="/tmp/qmanager_status.json"

# =============================================================================
# GET — settings (clamped like the poller) + live tier
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    tier=$(jq -r '.device.poller_tier // empty' "$STATUS_FILE" 2>/dev/null)
    case "$tier" in
        active|idle|deep) ;;
        *) tier="active" ;;
    esac

    out=$(ap_read_json "$tier")
    if [ -z "$out" ]; then
        cgi_error "read_failed" "Could not read adaptive polling settings"
        exit 0
    fi
    printf '%s\n' "$out"
    exit 0
fi

# =============================================================================
# POST — save
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi
    if [ "$ACTION" != "save" ]; then
        cgi_error "unknown_action" "Unknown action: $ACTION"
        exit 0
    fi

    # One jq pass; anything but a JSON number or boolean reads "-" and fails validation below.
    fields=$(printf '%s' "$POST_DATA" | jq -r '
        [.enabled, .active_grace, .idle_interval, .idle_threshold, .deep_idle_interval]
        | map(if type == "number" or type == "boolean" then tostring else "-" end) | join(" ")' 2>/dev/null)
    set -- $fields
    ENABLED="$1"; ACTIVE_GRACE="$2"; IDLE_INTERVAL="$3"; IDLE_THRESHOLD="$4"; DEEP_IDLE_INTERVAL="$5"

    if ! ap_validate "$ENABLED" "$ACTIVE_GRACE" "$IDLE_INTERVAL" "$IDLE_THRESHOLD" "$DEEP_IDLE_INTERVAL"; then
        cgi_error "$AP_ERR_CODE" "$AP_ERR_DETAIL"
        exit 0
    fi
    [ "$ENABLED" = "true" ] && ENABLED_NUM=1 || ENABLED_NUM=0

    if ! ap_save "$ENABLED" "$ACTIVE_GRACE" "$IDLE_INTERVAL" "$IDLE_THRESHOLD" "$DEEP_IDLE_INTERVAL"; then
        qlog_error "adaptive polling: config write failed"
        cgi_error "save_failed" "Could not save adaptive polling settings"
        exit 0
    fi

    qlog_info "Adaptive polling saved: enabled=$ENABLED_NUM active_grace=$ACTIVE_GRACE idle_interval=$IDLE_INTERVAL idle_threshold=$IDLE_THRESHOLD deep_idle_interval=$DEEP_IDLE_INTERVAL"
    cgi_success
    exit 0
fi

cgi_error "method_not_allowed" "Only GET and POST are supported"
