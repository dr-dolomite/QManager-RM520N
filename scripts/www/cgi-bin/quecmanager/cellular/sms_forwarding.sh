#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/connection_validate.sh
. /usr/lib/qmanager/connection_store.sh
# =============================================================================
# sms_forwarding.sh — CGI Endpoint: SMS Forwarding Settings (GET + POST)
# =============================================================================
# GET:  Returns current forwarding settings + recent send-failure records.
# POST: action=save_settings -> persist enabled/target_phone, toggle service
#       action=clear_failures -> drop the failures file
#       action=send_test      -> one-off test SMS to the CONFIGURED target
#
# Settings live in /etc/qmanager/sms_forwarding.json (persistent UBIFS), NOT
# UCI. Lazy-created: a missing file reads as {enabled:false,target_phone:""},
# exactly like discord_bot.json / sms_alerts.json — there is no installer
# seed step. The first write is this CGI's own tmp+mv.
#
# The daemon (qmanager_sms_forward) reads the JSON and forwards inbound SMS.
# A reload flag plus svc_enable/svc_disable (systemd) keeps the running
# daemon in sync — mirrors monitoring/discord_bot/configure.sh exactly.
#
# Config:  /etc/qmanager/sms_forwarding.json  ({enabled:bool, target_phone:string})
# Reload:  /tmp/qmanager_sms_forward_reload
# Output:  /tmp/qmanager_sms_forward_failures.json (written by the daemon)
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh
# Install location: /usrdata/qmanager/www/cgi-bin/quecmanager/cellular/sms_forwarding.sh
# =============================================================================

qlog_init "cgi_sms_forwarding"
cgi_headers
cgi_handle_options

CONFIG="$SMS_FWD_CONFIG"
FAILURES_FILE="/tmp/qmanager_sms_forward_failures.json"

# =============================================================================
# GET — Fetch settings + failures
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching SMS forwarding settings"

    enabled="false"
    target_phone=""
    if [ -f "$CONFIG" ]; then
        enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$CONFIG" 2>/dev/null)
        [ "$enabled" = "true" ] || enabled="false"
        target_phone=$(jq -r '.target_phone // ""' "$CONFIG" 2>/dev/null)
    fi

    failures="[]"
    if [ -f "$FAILURES_FILE" ] && [ -s "$FAILURES_FILE" ]; then
        failures=$(jq -c 'if type == "array" then . else [] end' "$FAILURES_FILE" 2>/dev/null)
    fi
    [ -z "$failures" ] && failures="[]"
    printf '%s' "$failures" | jq empty 2>/dev/null || failures="[]"

    jq -n \
        --argjson enabled "$enabled" \
        --arg target_phone "$target_phone" \
        --argjson failures "$failures" \
        '{
            success: true,
            settings: {
                enabled: $enabled,
                target_phone: $target_phone
            },
            failures: $failures,
            failure_count: ($failures | length)
        }'
    exit 0
fi

# =============================================================================
# POST — save_settings / clear_failures / send_test
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # --- action: save_settings ----------------------------------------------
    if [ "$ACTION" = "save_settings" ]; then
        # enabled may arrive as bool true/false or "0"/"1"; normalize to
        # true/false so it slots straight into --argjson.
        ENABLED_RAW=$(printf '%s' "$POST_DATA" | jq -r 'if .enabled == null then empty else (.enabled | tostring) end')
        case "$ENABLED_RAW" in
            true|1) ENABLED="true" ;;
            false|0) ENABLED="false" ;;
            *) ENABLED="false" ;;
        esac

        TARGET=$(printf '%s' "$POST_DATA" | jq -r 'if .target_phone == null then "" else .target_phone end')

        # When enabling, the target must be valid. When disabling, an empty
        # or bad number is tolerated (the daemon idles regardless).
        if [ "$ENABLED" = "true" ]; then
            if ! conn_validate_phone "$TARGET"; then
                cgi_error "invalid_phone" "target_phone is not a valid phone number"
                exit 0
            fi
        fi

        # Service control, config and reload flag: shared with config restore.
        if ! conn_sms_fwd_save "$ENABLED" "$TARGET"; then
            cgi_error "$SMS_ERR_CODE" "$SMS_ERR_DETAIL"
            exit 0
        fi

        jq -n \
            --argjson enabled "$ENABLED" \
            --arg target_phone "$TARGET" \
            '{
                success: true,
                settings: {
                    enabled: $enabled,
                    target_phone: $target_phone
                }
            }'
        exit 0
    fi

    # --- action: clear_failures ---------------------------------------------
    if [ "$ACTION" = "clear_failures" ]; then
        rm -f "$FAILURES_FILE"
        qlog_info "SMS forwarding failures cleared"
        cgi_success
        exit 0
    fi

    # --- action: send_test --------------------------------------------------
    # Tests the REAL configured target (never a number from the request
    # body), so the UI can verify the forwarding send path end-to-end.
    # Single attempt.
    if [ "$ACTION" = "send_test" ]; then
        TARGET=""
        [ -f "$CONFIG" ] && TARGET=$(jq -r '.target_phone // ""' "$CONFIG" 2>/dev/null)

        if ! conn_validate_phone "$TARGET"; then
            cgi_error "invalid_phone" "no valid target_phone configured"
            exit 0
        fi

        PHONE=$(printf '%s' "$TARGET" | sed 's/^+//')
        BODY="From QManager: SMS forwarding test"

        qlog_info "SMS forwarding test send to $PHONE"
        result=$(/usr/bin/qsms send "$PHONE" "$BODY" 2>/dev/null)
        rc=$?

        if [ "$rc" -ne 0 ]; then
            # Show qsms's plain-language .detail, never the raw JSON envelope.
            detail=$(printf '%s' "$result" | jq -r '.detail // .error // ""' 2>/dev/null)
            [ -n "$detail" ] || detail="No reply from the SMS service."
            qlog_error "SMS forwarding test send failed (rc=$rc): $detail"
            cgi_error "send_failed" "$detail"
            exit 0
        fi

        qlog_info "SMS forwarding test send succeeded to $PHONE"
        cgi_success
        exit 0
    fi

    # --- Unknown action ------------------------------------------------------
    cgi_error "invalid_action" "action must be save_settings, clear_failures, or send_test"
    exit 0
fi

# --- Method not allowed ------------------------------------------------------
cgi_method_not_allowed
