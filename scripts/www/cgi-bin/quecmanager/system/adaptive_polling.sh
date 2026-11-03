#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/config.sh
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

RELOAD_FLAG="/tmp/qmanager_poller_reload"
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

    POLLER_JQ='
        def ival(v; lo; hi; d):
            (v | tostring) as $s
            | if ($s | length) > 0 and ($s | length) < 6 and ($s | explode | all(. >= 48 and . <= 57))
              then ($s | tonumber) as $n | if $n >= lo and $n <= hi then $n else d end
              else d end;
        ((if type == "object" then .poller else null end) // null) as $raw
        | ($raw // {}) as $p
        | ival($p.active_grace; 20; 120; 20) as $ag
        | ival($p.idle_interval; 5; 300; 15) as $ii
        | ival($p.idle_threshold; 60; 3600; 300) as $it0
        | (if $it0 > $ag then $it0 else 300 end) as $it
        | ival($p.deep_idle_interval; $ii; 300; 60) as $di0
        | (if $di0 >= $ii then $di0 else $ii end) as $di
        | {success: true,
           settings: {enabled: (($p.enabled | tostring) as $e
                                | ($e != "0" and $e != "false" and $e != "no" and $e != "off")),
                      active_grace: $ag, idle_interval: $ii,
                      idle_threshold: $it, deep_idle_interval: $di},
           isDefault: ($raw == null),
           tier: $tier}'
    out=$(jq --arg tier "$tier" "$POLLER_JQ" "$QM_CONFIG" 2>/dev/null)
    # Missing or unreadable config -> every default.
    [ -n "$out" ] || out=$(jq -n --arg tier "$tier" "null | $POLLER_JQ" 2>/dev/null)
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

    case "$ENABLED" in
        true)  ENABLED_NUM=1 ;;
        false) ENABLED_NUM=0 ;;
        *) cgi_error "invalid_enabled" "enabled must be true or false"; exit 0 ;;
    esac

    # in_range <value> <min> <max> — integer of at most 5 digits, inside [min, max].
    in_range() {
        case "$1" in ''|*[!0-9]*|??????*) return 1 ;; esac
        [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]
    }
    in_range "$ACTIVE_GRACE" 20 120 || { cgi_error "invalid_active_grace" "active_grace must be 20-120"; exit 0; }
    in_range "$IDLE_INTERVAL" 5 300 || { cgi_error "invalid_idle_interval" "idle_interval must be 5-300"; exit 0; }
    in_range "$IDLE_THRESHOLD" 60 3600 && [ "$IDLE_THRESHOLD" -gt "$ACTIVE_GRACE" ] \
        || { cgi_error "invalid_idle_threshold" "idle_threshold must be 60-3600 and above active_grace"; exit 0; }
    in_range "$DEEP_IDLE_INTERVAL" "$IDLE_INTERVAL" 300 \
        || { cgi_error "invalid_deep_idle_interval" "deep_idle_interval must be idle_interval-300"; exit 0; }

    if ! { qm_config_set poller enabled "$ENABLED_NUM" &&
        qm_config_set poller active_grace "$ACTIVE_GRACE" &&
        qm_config_set poller idle_interval "$IDLE_INTERVAL" &&
        qm_config_set poller idle_threshold "$IDLE_THRESHOLD" &&
        qm_config_set poller deep_idle_interval "$DEEP_IDLE_INTERVAL"; }; then
        qlog_error "adaptive polling: config write failed"
        cgi_error "save_failed" "Could not save adaptive polling settings"
        exit 0
    fi

    touch "$RELOAD_FLAG"
    qlog_info "Adaptive polling saved: enabled=$ENABLED_NUM active_grace=$ACTIVE_GRACE idle_interval=$IDLE_INTERVAL idle_threshold=$IDLE_THRESHOLD deep_idle_interval=$DEEP_IDLE_INTERVAL"
    cgi_success
    exit 0
fi

cgi_error "method_not_allowed" "Only GET and POST are supported"
