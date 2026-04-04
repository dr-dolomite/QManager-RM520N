#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# email_alerts.sh — CGI Endpoint: Email Alert Settings (GET + POST)
# =============================================================================
# GET:  Returns current email alert configuration.
# POST: Saves settings + generates msmtp config, or sends test email.
#
# Config files:
#   /etc/qmanager/email_alerts.json  -> Settings storage
#   /etc/qmanager/msmtprc           -> Generated msmtp config (chmod 600)
#   /tmp/qmanager_email_reload      -> Flag for poller config reload
#   /tmp/qmanager_email_log.json    -> NDJSON email log
#
# Endpoint: GET/POST /cgi-bin/quecmanager/monitoring/email_alerts.sh
# Install location: /www/cgi-bin/quecmanager/monitoring/email_alerts.sh
# =============================================================================

qlog_init "cgi_email_alerts"
cgi_headers
cgi_handle_options

CONFIG="/etc/qmanager/email_alerts.json"
MSMTP_CONFIG="/etc/qmanager/msmtprc"
RELOAD_FLAG="/tmp/qmanager_email_reload"

# Detect package manager (Entware on RM520N-GL, system opkg on OpenWRT)
if [ -x /opt/bin/opkg ]; then
    OPKG="/opt/bin/opkg"
else
    OPKG="opkg"
fi

# =============================================================================
# GET — Fetch current settings
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching email alert settings"

    # Check if msmtp is installed
    if command -v msmtp >/dev/null 2>&1; then
        msmtp_installed="true"
    else
        msmtp_installed="false"
    fi

    if [ -f "$CONFIG" ]; then
        enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$CONFIG" 2>/dev/null)
        sender_email=$(jq -r '.sender_email // ""' "$CONFIG" 2>/dev/null)
        recipient_email=$(jq -r '.recipient_email // ""' "$CONFIG" 2>/dev/null)
        app_password=$(jq -r '.app_password // ""' "$CONFIG" 2>/dev/null)
        threshold_minutes=$(jq -r '.threshold_minutes // 5' "$CONFIG" 2>/dev/null)

        jq -n \
            --argjson enabled "$enabled" \
            --arg sender_email "$sender_email" \
            --arg recipient_email "$recipient_email" \
            --arg app_password "$app_password" \
            --argjson threshold_minutes "$threshold_minutes" \
            --argjson msmtp_installed "$msmtp_installed" \
            '{
                success: true,
                msmtp_installed: $msmtp_installed,
                settings: {
                    enabled: $enabled,
                    sender_email: $sender_email,
                    recipient_email: $recipient_email,
                    app_password: $app_password,
                    threshold_minutes: $threshold_minutes
                }
            }'
    else
        # No config yet — return defaults
        printf '{"success":true,"msmtp_installed":%s,"settings":{"enabled":false,"sender_email":"","recipient_email":"","app_password":"","threshold_minutes":5}}' "$msmtp_installed"
    fi
    exit 0
fi

# =============================================================================
# POST — Save settings or send test email
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: install — install msmtp via opkg (background)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install" ]; then
        MSMTP_INSTALL_RESULT="/tmp/qmanager_msmtp_install.json"
        MSMTP_INSTALL_PID="/tmp/qmanager_msmtp_install.pid"

        # Check if already running
        if [ -f "$MSMTP_INSTALL_PID" ] && kill -0 "$(cat "$MSMTP_INSTALL_PID" 2>/dev/null)" 2>/dev/null; then
            cgi_error "already_running" "Installation already in progress"
            exit 0
        fi

        # Already installed?
        if command -v msmtp >/dev/null 2>&1; then
            cgi_error "already_installed" "msmtp is already installed"
            exit 0
        fi

        qlog_info "Starting msmtp installation via opkg"

        # Spawn background installer
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

            # Verify
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
    # action: install_status — poll install progress
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_status" ]; then
        MSMTP_INSTALL_RESULT="/tmp/qmanager_msmtp_install.json"
        if [ -f "$MSMTP_INSTALL_RESULT" ]; then
            cat "$MSMTP_INSTALL_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: save_settings
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "save_settings" ]; then
        qlog_info "Saving email alert settings"

        # Extract fields
        new_enabled=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then (.enabled | tostring) else "false" end')
        new_sender=$(printf '%s' "$POST_DATA" | jq -r '.sender_email // ""')
        new_recipient=$(printf '%s' "$POST_DATA" | jq -r '.recipient_email // ""')
        new_password=$(printf '%s' "$POST_DATA" | jq -r '.app_password // empty')
        new_threshold=$(printf '%s' "$POST_DATA" | jq -r '.threshold_minutes // 5')

        # If no new password provided, keep existing one
        if [ -z "$new_password" ] && [ -f "$CONFIG" ]; then
            new_password=$(jq -r '.app_password // ""' "$CONFIG" 2>/dev/null)
        fi

        # Validate threshold — guard against non-numeric input first
        case "$new_threshold" in
            ''|*[!0-9]*)
                cgi_error "invalid_threshold" "Threshold must be a number between 1 and 60"
                exit 0
                ;;
        esac
        if [ "$new_threshold" -lt 1 ] || [ "$new_threshold" -gt 60 ]; then
            cgi_error "invalid_threshold" "Threshold must be between 1 and 60 minutes"
            exit 0
        fi

        # Ensure config directory exists
        mkdir -p /etc/qmanager

        # Write config JSON
        jq -n \
            --argjson enabled "$new_enabled" \
            --arg sender_email "$new_sender" \
            --arg recipient_email "$new_recipient" \
            --arg app_password "$new_password" \
            --argjson threshold_minutes "$new_threshold" \
            '{
                enabled: $enabled,
                sender_email: $sender_email,
                recipient_email: $recipient_email,
                app_password: $app_password,
                threshold_minutes: $threshold_minutes
            }' > "$CONFIG"

        qlog_info "Config written: enabled=$new_enabled sender=$new_sender recipient=$new_recipient threshold=${new_threshold}m"

        # Generate msmtp config
        cat > "$MSMTP_CONFIG" <<MSMTPEOF
defaults
auth           on
tls            on
tls_starttls   on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /tmp/msmtp.log

account        default
host           smtp.gmail.com
port           587
from           ${new_sender}
user           ${new_sender}
password       ${new_password}
MSMTPEOF
        chmod 600 "$MSMTP_CONFIG"
        qlog_info "msmtp config generated at $MSMTP_CONFIG"

        # Signal poller to reload config
        touch "$RELOAD_FLAG"

        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: send_test
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "send_test" ]; then
        qlog_info "Sending test email"

        # Source email alerts library for send functions
        . /usr/lib/qmanager/email_alerts.sh 2>/dev/null || {
            cgi_error "library_missing" "Email alerts library not found"
            exit 0
        }

        # Read config to populate _ea_sender, _ea_recipient, etc.
        _ea_read_config
        if [ "$_ea_enabled" != "true" ]; then
            cgi_error "not_configured" "Email alerts must be enabled and fully configured before sending a test"
            exit 0
        fi

        if [ ! -f "$MSMTP_CONFIG" ]; then
            cgi_error "msmtp_missing" "Save settings first to generate msmtp configuration"
            exit 0
        fi

        if _ea_send_test_email; then
            cgi_success
        else
            cgi_error "send_failed" "Failed to send test email. Check msmtp configuration and network connectivity."
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: uninstall — remove msmtp package from the device
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "uninstall" ]; then
        # Safety: refuse if email alerts are still enabled
        if [ -f "$CONFIG" ]; then
            ea_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$CONFIG" 2>/dev/null)
            if [ "$ea_enabled" = "true" ]; then
                cgi_error "still_enabled" "Disable email alerts before uninstalling msmtp"
                exit 0
            fi
        fi

        qlog_info "Uninstalling msmtp package"

        # Remove package
        $OPKG remove msmtp 2>/dev/null

        # Clean up generated msmtp config
        rm -f "$MSMTP_CONFIG"

        # Verify removal
        if command -v msmtp >/dev/null 2>&1; then
            qlog_error "msmtp binary still present after package manager remove"
            cgi_error "uninstall_failed" "Failed to remove msmtp package"
            exit 0
        fi

        qlog_info "msmtp uninstalled successfully"
        cgi_success
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Unsupported method
cgi_error "method_not_allowed" "Only GET and POST are supported"
