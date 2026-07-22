#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# alerts.sh — CGI Endpoint: Centralized Alerts (GET + POST)
# =============================================================================
# Replaces the old per-channel endpoints (email_alerts.sh, email_alert_log.sh,
# sms_alerts.sh, sms_alert_log.sh, discord_bot/configure.sh, discord_bot/
# status.sh, discord_bot/test.sh, discord_bot/alert_log.sh) with one surface
# covering all three alert channels plus the routing x capability matrix
# consumed by alert_engine.sh (see /usr/lib/qmanager/alert_engine.sh).
#
# GET:
#   Aggregated channel settings + routing + capability table + reboot
#   history. Never returns secrets (app_password / bot_token) — only
#   *_set booleans.
#
# POST actions:
#   save_settings   — persist sms/email/discord config + routing, atomically
#   send_test       — {channel} send a real test alert via that channel
#   get_log         — merged NDJSON log across all 3 channels, newest first
#   install_msmtp   — background opkg install of msmtp (optional dependency)
#   install_status  — poll install_msmtp progress
#
# Config files:
#   /etc/qmanager/sms_alerts.json
#   /etc/qmanager/email_alerts.json
#   /etc/qmanager/discord_bot.json
#   /etc/qmanager/alert_routing.json
#   /etc/qmanager/msmtprc            (generated on email save)
#   /etc/qmanager/reboot_history.json (read-only here — written by
#                                      alert_engine.sh)
#
# Reload flags (touched on save_settings, consumed by alert_engine.sh):
#   /tmp/qmanager_sms_reload
#   /tmp/qmanager_email_reload
#   /tmp/qmanager_discord_reload
#   /tmp/qmanager_alert_routing_reload
#
# Endpoint: GET/POST /cgi-bin/quecmanager/monitoring/alerts.sh
# Install location: /www/cgi-bin/quecmanager/monitoring/alerts.sh
# =============================================================================

qlog_init "cgi_alerts"
cgi_headers
cgi_handle_options

SMS_CONFIG="/etc/qmanager/sms_alerts.json"
EMAIL_CONFIG="/etc/qmanager/email_alerts.json"
DISCORD_CONFIG="/etc/qmanager/discord_bot.json"
ROUTING_CONFIG="/etc/qmanager/alert_routing.json"
REBOOT_HISTORY="/etc/qmanager/reboot_history.json"
MSMTP_CONFIG="/etc/qmanager/msmtprc"

SMS_RELOAD="/tmp/qmanager_sms_reload"
EMAIL_RELOAD="/tmp/qmanager_email_reload"
DISCORD_RELOAD="/tmp/qmanager_discord_reload"
ROUTING_RELOAD="/tmp/qmanager_alert_routing_reload"

SMS_LOG="/tmp/qmanager_sms_log.json"
EMAIL_LOG="/tmp/qmanager_email_log.json"
DISCORD_LOG="/tmp/qmanager_discord_log.json"

MSMTP_INSTALL_RESULT="/tmp/qmanager_msmtp_install.json"
MSMTP_INSTALL_PID="/tmp/qmanager_msmtp_install.pid"

# CLAMP: connection_lost is INCAPABLE for email/discord (both need internet
# to actually deliver) — this must match alert_engine.sh's _ae_capable table
# exactly, since that's the backend truth the engine enforces regardless of
# what's written here. Enforcing it again here just keeps the persisted
# routing file honest for the GET response / future engine changes.
ROUTING_DEFAULT='{"connection_lost":{"sms":true,"email":false,"discord":false},"connection_restored":{"sms":true,"email":true,"discord":true},"reboot":{"sms":true,"email":true,"discord":true}}'

# Detect package manager (Entware on RM520N-GL, system opkg on OpenWRT)
if [ -x /opt/bin/opkg ]; then
    OPKG="/opt/bin/opkg"
else
    OPKG="opkg"
fi

# =============================================================================
# GET — Aggregated settings + routing + capabilities + reboot history
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching centralized alert settings"

    # --- SMS ---
    sms_enabled="false"; sms_phone=""; sms_threshold=5
    if [ -f "$SMS_CONFIG" ]; then
        sms_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$SMS_CONFIG" 2>/dev/null)
        sms_phone=$(jq -r '.recipient_phone // ""' "$SMS_CONFIG" 2>/dev/null)
        sms_threshold=$(jq -r '.threshold_minutes // 5' "$SMS_CONFIG" 2>/dev/null)
    fi
    case "$sms_enabled" in true|false) ;; *) sms_enabled="false" ;; esac
    case "$sms_threshold" in ''|*[!0-9]*) sms_threshold=5 ;; esac
    sms_configured="false"
    [ -n "$sms_phone" ] && sms_configured="true"

    # --- Email ---
    email_enabled="false"; email_sender=""; email_recipient=""; email_pw_set="false"; email_threshold=5
    if [ -f "$EMAIL_CONFIG" ]; then
        email_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$EMAIL_CONFIG" 2>/dev/null)
        email_sender=$(jq -r '.sender_email // ""' "$EMAIL_CONFIG" 2>/dev/null)
        email_recipient=$(jq -r '.recipient_email // ""' "$EMAIL_CONFIG" 2>/dev/null)
        _pw=$(jq -r '.app_password // ""' "$EMAIL_CONFIG" 2>/dev/null)
        [ -n "$_pw" ] && email_pw_set="true"
        email_threshold=$(jq -r '.threshold_minutes // 5' "$EMAIL_CONFIG" 2>/dev/null)
    fi
    case "$email_enabled" in true|false) ;; *) email_enabled="false" ;; esac
    case "$email_threshold" in ''|*[!0-9]*) email_threshold=5 ;; esac
    email_configured="false"
    [ -n "$email_sender" ] && [ -n "$email_recipient" ] && [ "$email_pw_set" = "true" ] && email_configured="true"
    msmtp_installed="false"
    command -v msmtp >/dev/null 2>&1 && msmtp_installed="true"

    # --- Discord ---
    discord_enabled="false"; discord_owner=""; discord_token_set="false"; discord_threshold=5
    if [ -f "$DISCORD_CONFIG" ]; then
        discord_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$DISCORD_CONFIG" 2>/dev/null)
        discord_owner=$(jq -r '.owner_discord_id // ""' "$DISCORD_CONFIG" 2>/dev/null)
        _tok=$(jq -r '.bot_token // ""' "$DISCORD_CONFIG" 2>/dev/null)
        [ -n "$_tok" ] && discord_token_set="true"
        discord_threshold=$(jq -r '.threshold_minutes // 5' "$DISCORD_CONFIG" 2>/dev/null)
    fi
    case "$discord_enabled" in true|false) ;; *) discord_enabled="false" ;; esac
    case "$discord_threshold" in ''|*[!0-9]*) discord_threshold=5 ;; esac
    discord_configured="false"
    [ -n "$discord_owner" ] && [ "$discord_token_set" = "true" ] && discord_configured="true"
    discord_connected="false"
    if [ -f /tmp/qmanager_discord_status.json ]; then
        _conn=$(jq -r '.connected // false' /tmp/qmanager_discord_status.json 2>/dev/null)
        [ "$_conn" = "true" ] && discord_connected="true"
    fi

    # --- Routing (defaults-on-missing) ---
    routing_json=""
    if [ -f "$ROUTING_CONFIG" ]; then
        routing_json=$(jq -c '.events // empty' "$ROUTING_CONFIG" 2>/dev/null)
    fi
    if [ -z "$routing_json" ] || [ "$routing_json" = "null" ]; then
        routing_json="$ROUTING_DEFAULT"
    fi

    # --- Reboot history (newest first, cap 10) ---
    reboots_json="[]"
    if [ -f "$REBOOT_HISTORY" ] && [ -s "$REBOOT_HISTORY" ]; then
        _rh=$(jq -s '.[-10:] | reverse' "$REBOOT_HISTORY" 2>/dev/null)
        [ -n "$_rh" ] && reboots_json="$_rh"
    fi

    jq -n \
        --argjson sms_enabled "$sms_enabled" \
        --arg sms_phone "$sms_phone" \
        --argjson sms_threshold "$sms_threshold" \
        --argjson sms_configured "$sms_configured" \
        --argjson email_enabled "$email_enabled" \
        --arg email_sender "$email_sender" \
        --arg email_recipient "$email_recipient" \
        --argjson email_pw_set "$email_pw_set" \
        --argjson email_threshold "$email_threshold" \
        --argjson msmtp_installed "$msmtp_installed" \
        --argjson email_configured "$email_configured" \
        --argjson discord_enabled "$discord_enabled" \
        --arg discord_owner "$discord_owner" \
        --argjson discord_token_set "$discord_token_set" \
        --argjson discord_threshold "$discord_threshold" \
        --argjson discord_connected "$discord_connected" \
        --argjson discord_configured "$discord_configured" \
        --argjson routing "$routing_json" \
        --argjson reboots "$reboots_json" \
        '{
            success: true,
            channels: {
                sms: {
                    enabled: $sms_enabled,
                    recipient_phone: $sms_phone,
                    threshold_minutes: $sms_threshold,
                    configured: $sms_configured
                },
                email: {
                    enabled: $email_enabled,
                    sender_email: $email_sender,
                    recipient_email: $email_recipient,
                    app_password_set: $email_pw_set,
                    threshold_minutes: $email_threshold,
                    msmtp_installed: $msmtp_installed,
                    configured: $email_configured
                },
                discord: {
                    enabled: $discord_enabled,
                    owner_discord_id: $discord_owner,
                    token_set: $discord_token_set,
                    threshold_minutes: $discord_threshold,
                    connected: $discord_connected,
                    configured: $discord_configured
                }
            },
            routing: { events: $routing },
            capabilities: {
                connection_lost: {
                    sms: true,
                    email: false, email_reason: "email_needs_internet",
                    discord: false, discord_reason: "discord_needs_internet"
                },
                connection_restored: { sms: true, email: true, discord: true },
                reboot: { sms: true, email: true, discord: true }
            },
            reboots: $reboots
        }'
    exit 0
fi

# =============================================================================
# POST — save_settings | send_test | get_log | install_msmtp | install_status
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
        qlog_info "Saving centralized alert settings"

        sms_enabled_in=$(printf '%s' "$POST_DATA" | jq -r '.sms.enabled // false' 2>/dev/null)
        sms_phone_in=$(printf '%s' "$POST_DATA" | jq -r '.sms.recipient_phone // ""' 2>/dev/null)
        sms_threshold_in=$(printf '%s' "$POST_DATA" | jq -r '.sms.threshold_minutes // 5' 2>/dev/null)

        email_enabled_in=$(printf '%s' "$POST_DATA" | jq -r '.email.enabled // false' 2>/dev/null)
        email_sender_in=$(printf '%s' "$POST_DATA" | jq -r '.email.sender_email // ""' 2>/dev/null)
        email_recipient_in=$(printf '%s' "$POST_DATA" | jq -r '.email.recipient_email // ""' 2>/dev/null)
        email_password_in=$(printf '%s' "$POST_DATA" | jq -r '.email.app_password // empty' 2>/dev/null)
        email_threshold_in=$(printf '%s' "$POST_DATA" | jq -r '.email.threshold_minutes // 5' 2>/dev/null)

        discord_enabled_in=$(printf '%s' "$POST_DATA" | jq -r '.discord.enabled // false' 2>/dev/null)
        discord_owner_in=$(printf '%s' "$POST_DATA" | jq -r '.discord.owner_discord_id // ""' 2>/dev/null)
        discord_threshold_in=$(printf '%s' "$POST_DATA" | jq -r '.discord.threshold_minutes // 5' 2>/dev/null)
        discord_token_in=$(printf '%s' "$POST_DATA" | jq -r '.discord.bot_token // empty' 2>/dev/null)

        routing_in=$(printf '%s' "$POST_DATA" | jq -c '.routing.events // empty' 2>/dev/null)

        # --- Validate booleans -----------------------------------------------
        case "$sms_enabled_in" in true|false) ;; *) cgi_error "invalid_enabled" "sms.enabled must be a boolean"; exit 0 ;; esac
        case "$email_enabled_in" in true|false) ;; *) cgi_error "invalid_enabled" "email.enabled must be a boolean"; exit 0 ;; esac
        case "$discord_enabled_in" in true|false) ;; *) cgi_error "invalid_enabled" "discord.enabled must be a boolean"; exit 0 ;; esac

        # --- Validate thresholds (1-60) ---------------------------------------
        for _pair in "sms:$sms_threshold_in" "email:$email_threshold_in" "discord:$discord_threshold_in"; do
            _name="${_pair%%:*}"
            _val="${_pair#*:}"
            case "$_val" in
                ''|*[!0-9]*)
                    cgi_error "invalid_threshold" "${_name}.threshold_minutes must be a number between 1 and 60"
                    exit 0
                    ;;
            esac
            if [ "$_val" -lt 1 ] || [ "$_val" -gt 60 ]; then
                cgi_error "invalid_threshold" "${_name}.threshold_minutes must be between 1 and 60"
                exit 0
            fi
        done

        # --- SMS: phone required + validated only when enabled ----------------
        if [ "$sms_enabled_in" = "true" ]; then
            case "$sms_phone_in" in
                '')
                    cgi_error "invalid_phone" "sms.recipient_phone is required when SMS alerts are enabled"
                    exit 0
                    ;;
            esac
            _phone_check="${sms_phone_in#+}"
            case "$_phone_check" in
                ''|*[!0-9]*)
                    cgi_error "invalid_phone" "Phone must contain only digits (with optional leading +)"
                    exit 0
                    ;;
            esac
            _plen=${#_phone_check}
            if [ "$_plen" -lt 7 ] || [ "$_plen" -gt 15 ]; then
                cgi_error "invalid_phone" "Phone must be 7-15 digits"
                exit 0
            fi
            case "$_phone_check" in
                0*)
                    cgi_error "invalid_phone" "Phone must start with a country code (not 0)"
                    exit 0
                    ;;
            esac
        fi

        # --- Email: shape + secret preservation --------------------------------
        _existing_email_pw=""
        [ -f "$EMAIL_CONFIG" ] && _existing_email_pw=$(jq -r '.app_password // ""' "$EMAIL_CONFIG" 2>/dev/null)
        _final_email_pw="$email_password_in"
        [ -z "$_final_email_pw" ] && _final_email_pw="$_existing_email_pw"

        if [ "$email_enabled_in" = "true" ]; then
            if [ -z "$email_sender_in" ] || [ -z "$email_recipient_in" ]; then
                cgi_error "invalid_email" "email.sender_email and email.recipient_email are required when email alerts are enabled"
                exit 0
            fi
            # Reject control characters / newlines in any field that gets
            # templated verbatim into msmtprc (sender, recipient, password).
            # A newline would otherwise inject arbitrary msmtp directives —
            # the glob email checks below match across embedded newlines, so
            # this control-char gate must run FIRST. (Security: config injection.)
            case "${email_sender_in}${email_recipient_in}${_final_email_pw}" in
                *[[:cntrl:]]*)
                    cgi_error "invalid_email" "email fields must not contain control characters"
                    exit 0
                    ;;
            esac
            if ! printf '%s' "$email_sender_in" | grep -qE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
                cgi_error "invalid_email" "email.sender_email is not a valid email address"; exit 0
            fi
            if ! printf '%s' "$email_recipient_in" | grep -qE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
                cgi_error "invalid_email" "email.recipient_email is not a valid email address"; exit 0
            fi
            if [ -z "$_final_email_pw" ]; then
                cgi_error "missing_app_password" "email.app_password is required to enable email alerts"
                exit 0
            fi
        fi

        # --- Discord: owner id + secret preservation ---------------------------
        _existing_discord_token=""
        [ -f "$DISCORD_CONFIG" ] && _existing_discord_token=$(jq -r '.bot_token // ""' "$DISCORD_CONFIG" 2>/dev/null)
        _final_discord_token="$discord_token_in"
        [ -z "$_final_discord_token" ] && _final_discord_token="$_existing_discord_token"

        if [ "$discord_enabled_in" = "true" ]; then
            case "$discord_owner_in" in
                ''|*[!0-9]*)
                    cgi_error "invalid_discord_id" "discord.owner_discord_id must be a numeric Discord user ID"
                    exit 0
                    ;;
            esac
            _dlen=${#discord_owner_in}
            if [ "$_dlen" -lt 15 ] || [ "$_dlen" -gt 25 ]; then
                cgi_error "invalid_discord_id" "discord.owner_discord_id does not look like a Discord snowflake ID"
                exit 0
            fi
            if [ -z "$_final_discord_token" ]; then
                cgi_error "missing_bot_token" "discord.bot_token is required to enable Discord alerts"
                exit 0
            fi
        fi

        # --- Routing: merge over defaults, then hard-clamp connection_lost -----
        # (connection_lost.email / connection_lost.discord are ALWAYS false —
        # server-authoritative regardless of what the client submits, mirroring
        # alert_engine.sh's hardcoded capability table.)
        _routing_usr="null"
        if [ -n "$routing_in" ] && [ "$routing_in" != "null" ]; then
            _routing_usr="$routing_in"
        fi
        routing_final=$(jq -n --argjson def "$ROUTING_DEFAULT" --argjson usr "$_routing_usr" '
            ($def * ($usr // {}))
            | .connection_lost.email = false
            | .connection_lost.discord = false
        ' 2>/dev/null)
        if [ -z "$routing_final" ]; then
            routing_final="$ROUTING_DEFAULT"
        fi

        mkdir -p /etc/qmanager

        # --- Write SMS config (atomic) ------------------------------------------
        if ! jq -n \
            --argjson enabled "$sms_enabled_in" \
            --arg recipient_phone "$sms_phone_in" \
            --argjson threshold_minutes "$sms_threshold_in" \
            '{enabled:$enabled, recipient_phone:$recipient_phone, threshold_minutes:$threshold_minutes}' \
            > "${SMS_CONFIG}.tmp"; then
            rm -f "${SMS_CONFIG}.tmp"
            cgi_error "write_failed" "Failed to write SMS config"
            exit 0
        fi
        mv "${SMS_CONFIG}.tmp" "$SMS_CONFIG"

        # --- Write email config (atomic) + regenerate msmtprc -------------------
        if ! jq -n \
            --argjson enabled "$email_enabled_in" \
            --arg sender_email "$email_sender_in" \
            --arg recipient_email "$email_recipient_in" \
            --arg app_password "$_final_email_pw" \
            --argjson threshold_minutes "$email_threshold_in" \
            '{enabled:$enabled, sender_email:$sender_email, recipient_email:$recipient_email, app_password:$app_password, threshold_minutes:$threshold_minutes}' \
            > "${EMAIL_CONFIG}.tmp"; then
            rm -f "${EMAIL_CONFIG}.tmp"
            cgi_error "write_failed" "Failed to write email config"
            exit 0
        fi
        mv "${EMAIL_CONFIG}.tmp" "$EMAIL_CONFIG"

        if [ -n "$email_sender_in" ] && [ -n "$_final_email_pw" ]; then
            # Create the credential file 0600 from the start — umask 077 in a
            # subshell closes the TOCTOU window where the plaintext Gmail app
            # password would briefly be world-readable before chmod. (Security.)
            ( umask 077; cat > "${MSMTP_CONFIG}.tmp" <<MSMTPEOF
defaults
auth           on
tls            on
tls_starttls   on
tls_trust_file /etc/ssl/certs/ca-certificates.crt

account        default
host           smtp.gmail.com
port           587
from           ${email_sender_in}
user           ${email_sender_in}
password       ${_final_email_pw}
MSMTPEOF
            )
            chmod 600 "${MSMTP_CONFIG}.tmp"
            mv "${MSMTP_CONFIG}.tmp" "$MSMTP_CONFIG"
            qlog_info "msmtp config regenerated at $MSMTP_CONFIG"
        fi

        # --- Write Discord config (atomic) + drive service state ----------------
        if ! jq -n \
            --argjson enabled "$discord_enabled_in" \
            --arg owner_discord_id "$discord_owner_in" \
            --argjson threshold_minutes "$discord_threshold_in" \
            --arg bot_token "$_final_discord_token" \
            '{enabled:$enabled, owner_discord_id:$owner_discord_id, threshold_minutes:$threshold_minutes, bot_token:$bot_token}' \
            > "${DISCORD_CONFIG}.tmp"; then
            rm -f "${DISCORD_CONFIG}.tmp"
            cgi_error "write_failed" "Failed to write Discord config"
            exit 0
        fi
        mv "${DISCORD_CONFIG}.tmp" "$DISCORD_CONFIG"

        # The daemon caches token/owner/dmChannel in memory at startup, so a
        # restart (not just "start") is needed to pick up new settings —
        # mirrors the legacy discord_bot/configure.sh behavior.
        if [ "$discord_enabled_in" = "true" ]; then
            svc_enable qmanager_discord
            svc_restart qmanager_discord
        else
            svc_stop qmanager_discord
        fi

        # --- Write routing config (atomic, wrapped under version+events) -------
        if ! jq -n --argjson events "$routing_final" '{version:1, events:$events}' \
            > "${ROUTING_CONFIG}.tmp" 2>/dev/null; then
            rm -f "${ROUTING_CONFIG}.tmp"
            cgi_error "write_failed" "Failed to write routing config"
            exit 0
        fi
        mv "${ROUTING_CONFIG}.tmp" "$ROUTING_CONFIG"

        # --- Signal alert_engine.sh (and channel libs) to reload ---------------
        touch "$SMS_RELOAD" "$EMAIL_RELOAD" "$DISCORD_RELOAD" "$ROUTING_RELOAD" 2>/dev/null

        qlog_info "Centralized alert settings saved: sms=$sms_enabled_in email=$email_enabled_in discord=$discord_enabled_in"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: send_test {channel}
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "send_test" ]; then
        channel=$(printf '%s' "$POST_DATA" | jq -r '.channel // ""' 2>/dev/null)
        qlog_info "Sending test alert: channel=$channel"

        case "$channel" in
            sms)
                . /usr/lib/qmanager/sms_alerts.sh 2>/dev/null || {
                    cgi_error "library_missing" "SMS alerts library not found"
                    exit 0
                }
                _sa_read_config
                if [ "$_sa_enabled" != "true" ]; then
                    cgi_error "not_configured" "SMS alerts must be enabled and fully configured before sending a test"
                    exit 0
                fi
                # CGI context has no poller globals (modem_reachable/lte_state/
                # nr_state) to satisfy the registration guard — the user
                # explicitly asked for a test, so bypass it for this call only.
                _sa_is_registered() { return 0; }
                if sms_alert_send "[QManager] Test SMS from your modem"; then
                    _sa_log_event "Test SMS" "sent" "$_sa_recipient"
                    cgi_success
                else
                    _sa_log_event "Test SMS" "failed" "$_sa_recipient"
                    cgi_error "send_failed" "Failed to send test SMS. Check signal, SIM credits, and recipient number."
                fi
                ;;
            email)
                . /usr/lib/qmanager/email_alerts.sh 2>/dev/null || {
                    cgi_error "library_missing" "Email alerts library not found"
                    exit 0
                }
                _ea_read_config
                if [ "$_ea_enabled" != "true" ]; then
                    cgi_error "not_configured" "Email alerts must be enabled and fully configured before sending a test"
                    exit 0
                fi
                if [ ! -f "$MSMTP_CONFIG" ]; then
                    cgi_error "msmtp_missing" "Save settings first to generate msmtp configuration"
                    exit 0
                fi
                if email_alert_send "Test Alert" "This is a test alert from your QManager device. Your email alert configuration is working."; then
                    _ea_log_event "Test email" "sent" "$_ea_recipient"
                    cgi_success
                else
                    _ea_log_event "Test email" "failed" "$_ea_recipient"
                    cgi_error "send_failed" "Failed to send test email. Check msmtp configuration and network connectivity."
                fi
                ;;
            discord)
                . /usr/lib/qmanager/discord_alerts.sh 2>/dev/null || {
                    cgi_error "library_missing" "Discord alerts library not found"
                    exit 0
                }
                if [ ! -f "$DISCORD_CONFIG" ]; then
                    cgi_error "not_configured" "Discord alerts must be configured before sending a test"
                    exit 0
                fi
                _d_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$DISCORD_CONFIG" 2>/dev/null)
                if [ "$_d_enabled" != "true" ]; then
                    cgi_error "not_configured" "Discord alerts must be enabled before sending a test"
                    exit 0
                fi
                if ! da_is_running; then
                    cgi_error "bot_not_running" "Discord bot service is not running"
                    exit 0
                fi
                if discord_dispatch_message "[QManager] Test alert - your Discord alert configuration is working."; then
                    # Success is NOT logged here — the daemon logs it once it
                    # actually completes the Discord API call (fire-and-forget
                    # hand-off, see discord_alerts.sh).
                    cgi_success
                else
                    _ts=$(date "+%Y-%m-%d %H:%M:%S")
                    jq -n -c --arg ts "$_ts" \
                        '{timestamp:$ts, trigger:"Test Discord alert", status:"failed", recipient:"discord"}' \
                        >> "$DISCORD_LOG" 2>/dev/null
                    cgi_error "send_failed" "Failed to hand off the test message to the Discord bot"
                fi
                ;;
            *)
                cgi_error "invalid_channel" "channel must be one of: sms, email, discord"
                ;;
        esac
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: get_log — merged NDJSON log across all 3 channels
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "get_log" ]; then
        _merge_tmp="/tmp/qmanager_alerts_merge.$$.json"
        : > "$_merge_tmp"

        for _ch_pair in "sms:$SMS_LOG" "email:$EMAIL_LOG" "discord:$DISCORD_LOG"; do
            _ch="${_ch_pair%%:*}"
            _f="${_ch_pair#*:}"
            if [ -f "$_f" ] && [ -s "$_f" ]; then
                jq -c --arg channel "$_ch" '. + {channel:$channel}' "$_f" >> "$_merge_tmp" 2>/dev/null
            fi
        done

        total=$(wc -l < "$_merge_tmp" 2>/dev/null || echo 0)
        entries=$(jq -s 'sort_by(.timestamp) | reverse | .[0:100]' "$_merge_tmp" 2>/dev/null)
        [ -z "$entries" ] && entries="[]"
        rm -f "$_merge_tmp"

        jq -n --argjson entries "$entries" --argjson total "${total:-0}" \
            '{success:true, entries:$entries, total:$total}'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: install_msmtp — install msmtp via opkg (background)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_msmtp" ]; then
        if [ -f "$MSMTP_INSTALL_PID" ] && pid_alive "$(cat "$MSMTP_INSTALL_PID" 2>/dev/null)"; then
            cgi_error "already_running" "Installation already in progress"
            exit 0
        fi

        if command -v msmtp >/dev/null 2>&1; then
            cgi_error "already_installed" "msmtp is already installed"
            exit 0
        fi

        qlog_info "Starting msmtp installation via opkg"

        (
            echo $$ > "$MSMTP_INSTALL_PID"
            trap 'rm -f "$MSMTP_INSTALL_PID"' EXIT

            printf '{"success":true,"status":"running","message":"Updating package lists..."}' > "$MSMTP_INSTALL_RESULT"
            if ! $OPKG update >/dev/null 2>&1; then
                printf '{"success":false,"status":"error","message":"Failed to update package lists","detail":"Check internet connection and package manager feeds"}' > "$MSMTP_INSTALL_RESULT"
                exit 1
            fi

            printf '{"success":true,"status":"running","message":"Installing msmtp..."}' > "$MSMTP_INSTALL_RESULT"
            if ! $OPKG install msmtp >/dev/null 2>&1; then
                printf '{"success":false,"status":"error","message":"Package manager install failed","detail":"Package may not be available for this architecture"}' > "$MSMTP_INSTALL_RESULT"
                exit 1
            fi

            if command -v msmtp >/dev/null 2>&1; then
                printf '{"success":true,"status":"complete","message":"msmtp installed successfully"}' > "$MSMTP_INSTALL_RESULT"
            else
                printf '{"success":false,"status":"error","message":"Package installed but binary not found"}' > "$MSMTP_INSTALL_RESULT"
            fi
        ) </dev/null >/dev/null 2>&1 &

        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: install_status — poll install_msmtp progress
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_status" ]; then
        if [ -f "$MSMTP_INSTALL_RESULT" ]; then
            cat "$MSMTP_INSTALL_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Unsupported method
cgi_error "method_not_allowed" "Only GET and POST are supported"
