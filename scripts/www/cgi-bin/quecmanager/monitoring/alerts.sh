#!/bin/sh
LIB_DIR="${QM_LIB_DIR:-/usr/lib/qmanager}"
. "$LIB_DIR/cgi_base.sh"
. "$LIB_DIR/conn_state.sh"
. "$LIB_DIR/monitoring_validate.sh"
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
#   *_set booleans. As of the secrets relocation this endpoint cannot
#   return them even by accident: the secrets no longer live in the config
#   directory at all (see /etc/qmanager-secrets below), and www-data cannot
#   read them. The config JSONs carry only the marker booleans.
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
#   /etc/qmanager/quality_thresholds.json (alert_after_min — the single wait; a
#                                      posted per-channel threshold_minutes writes it)
#   /etc/qmanager/reboot_history.json (read-only here — written by
#                                      alert_engine.sh)
#
# Secrets (NOT written or readable here — 0700 root:root, owned by the root
# helpers this endpoint calls over sudo):
#   /etc/qmanager-secrets/email_app_password
#   /etc/qmanager-secrets/discord_bot_token
#   /etc/qmanager-secrets/msmtprc     (rendered on email save)
#
# Root helpers (each a bare-path sudoers grant):
#   qmanager_secret_set  — stores/clears the two secrets, renders msmtprc,
#                          maintains the non-secret *_set markers
#   qmanager_email_send  — sends the canned test email, because msmtprc is
#                          unreadable from this process
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

SMS_CONFIG="$CQ_SMS_CONFIG"
EMAIL_CONFIG="$CQ_EMAIL_CONFIG"
DISCORD_CONFIG="$CQ_DISCORD_CONFIG"
ROUTING_CONFIG="/etc/qmanager/alert_routing.json"
REBOOT_HISTORY="/etc/qmanager/reboot_history.json"
# NOTE: there is deliberately no MSMTP_CONFIG constant. www-data cannot read or
# even stat /etc/qmanager-secrets/msmtprc, so a path constant here would only
# invite a `[ -f ]` check that is always false and means nothing. Both helpers
# below own that file.
SECRET_HELPER="/usr/bin/qmanager_secret_set"
EMAIL_SEND_HELPER="/usr/bin/qmanager_email_send"

SMS_LOG="/tmp/qmanager_sms_log.json"
EMAIL_LOG="/tmp/qmanager_email_log.json"
DISCORD_LOG="/tmp/qmanager_discord_log.json"
DISCORD_STATUS="/tmp/qmanager_discord_status.json"
DISCORD_STATUS_MAX_AGE=90   # the daemon rewrites its status every 30 s

MSMTP_INSTALL_RESULT="/tmp/qmanager_msmtp_install.json"
MSMTP_INSTALL_PID="/tmp/qmanager_msmtp_install.pid"

# CLAMP: connection_lost is INCAPABLE for email/discord (both need internet
# to actually deliver) — this must match alert_engine.sh's _ae_capable table
# exactly, since that's the backend truth the engine enforces regardless of
# what's written here. Enforcing it again here just keeps the persisted
# routing file honest for the GET response / future engine changes.
ROUTING_DEFAULT="$MV_ROUTING_DEFAULT"

# =============================================================================
# Root-helper invocation — shared by both privileged helpers this endpoint uses
# =============================================================================
# Both qmanager_secret_set and qmanager_email_send follow the same contract:
# one line of JSON on stdout, exit 0/1. These three functions are the whole
# calling convention. ($_SUDO comes from platform.sh, which cgi_base.sh already
# sourced; it is empty when we happen to run as root.)
#
# Each call leaves the helper's JSON in ROOT_HELPER_OUT for root_helper_fail.
ROOT_HELPER_OUT=""

# root_helper_call <helper_path> [arg...] — no stdin.
root_helper_call() {
    ROOT_HELPER_OUT=$($_SUDO "$@" </dev/null 2>/dev/null)
    return $?
}

# root_helper_call_stdin <value> <helper_path> [arg...]
#
# The value is PIPED, never passed as an argument: argv is world-readable via
# /proc/<pid>/cmdline, so an argument would leak the credential to every local
# process for the lifetime of the call.
root_helper_call_stdin() {
    _rh_val="$1"
    shift
    ROOT_HELPER_OUT=$(printf '%s' "$_rh_val" | $_SUDO "$@" 2>/dev/null)
    _rh_rc=$?
    _rh_val=""
    return "$_rh_rc"
}

# Surface a helper failure as a normal cgi_error, reusing the helper's own
# slug/detail so the frontend's error handling and i18n strings keep working.
# A save that LOOKS successful but silently did not store the credential — or a
# test send that reports OK without sending — is worse than a visible error.
root_helper_fail() {
    _rhf_default="$1"
    _rhf_err=$(printf '%s' "$ROOT_HELPER_OUT" | jq -r '.error // ""' 2>/dev/null)
    _rhf_detail=$(printf '%s' "$ROOT_HELPER_OUT" | jq -r '.detail // ""' 2>/dev/null)
    [ -z "$_rhf_err" ] && _rhf_err="helper_failed"
    [ -z "$_rhf_detail" ] && _rhf_detail="$_rhf_default"
    qlog_error "root helper failed: $_rhf_err"
    cgi_error "$_rhf_err" "$_rhf_detail"
}

# secret_helper <verb> <name> [value] — thin wrapper over the two above.
secret_helper() {
    if [ -n "$3" ]; then
        root_helper_call_stdin "$3" "$SECRET_HELPER" "$1" "$2"
    else
        root_helper_call "$SECRET_HELPER" "$1" "$2"
    fi
}

# cfg_json <file> <jq-filter> — compact JSON of one config file, {} when absent or unparseable.
cfg_json() {
    _cj=""
    [ -f "$1" ] && _cj=$(jq -c "$2" "$1" 2>/dev/null </dev/null)
    if [ -n "$_cj" ]; then printf '%s' "$_cj"; else printf '{}'; fi
}

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

    # One wait (owned by Connection Quality) is reported as every channel's threshold_minutes.
    cq_alert_after_min
    wait_min="$CQ_ALERT_AFTER_MIN"

    # One jq per config file; the final call below shapes the response.
    sms_j=$(cfg_json "$SMS_CONFIG" '{
        enabled: ((.enabled | tostring) == "true"),
        phone: (.recipient_phone // "" | tostring)
    }')
    # Marker boolean only for the password and token: neither is readable from here.
    email_j=$(cfg_json "$EMAIL_CONFIG" '{
        enabled: ((.enabled | tostring) == "true"),
        sender: (.sender_email // "" | tostring),
        recipient: (.recipient_email // "" | tostring),
        pw_set: (.app_password_set == true)
    }')
    discord_j=$(cfg_json "$DISCORD_CONFIG" '{
        enabled: ((.enabled | tostring) == "true"),
        owner: (.owner_discord_id // "" | tostring),
        token_set: (.token_set == true)
    }')

    msmtp_installed="false"
    command -v msmtp >/dev/null 2>&1 && msmtp_installed="true"

    # Connected only while the daemon's 30 s heartbeat is fresh: a crashed daemon leaves the
    # last "connected":true in the file.
    discord_connected="false"
    if [ -f "$DISCORD_STATUS" ]; then
        _st_mt=$(stat -c %Y "$DISCORD_STATUS" 2>/dev/null)
        case "$_st_mt" in
            ''|*[!0-9]*) ;;
            *)
                _st_age=$(( $(date +%s) - _st_mt ))
                if [ "$_st_age" -ge 0 ] && [ "$_st_age" -lt "$DISCORD_STATUS_MAX_AGE" ]; then
                    [ "$(jq -r '.connected == true' "$DISCORD_STATUS" 2>/dev/null)" = "true" ] && discord_connected="true"
                fi
                ;;
        esac
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
        --argjson wait "$wait_min" \
        --argjson sms "$sms_j" \
        --argjson email "$email_j" \
        --argjson discord "$discord_j" \
        --argjson msmtp_installed "$msmtp_installed" \
        --argjson discord_connected "$discord_connected" \
        --argjson routing "$routing_json" \
        --argjson reboots "$reboots_json" \
        '($sms.phone // "") as $sms_phone
        | ($email.sender // "") as $email_sender
        | ($email.recipient // "") as $email_recipient
        | ($email.pw_set // false) as $email_pw_set
        | ($discord.owner // "") as $discord_owner
        | ($discord.token_set // false) as $discord_token_set
        | {
            success: true,
            alert_after_min: $wait,
            channels: {
                sms: {
                    enabled: ($sms.enabled // false),
                    recipient_phone: $sms_phone,
                    threshold_minutes: $wait,
                    configured: ($sms_phone != "")
                },
                email: {
                    enabled: ($email.enabled // false),
                    sender_email: $email_sender,
                    recipient_email: $email_recipient,
                    app_password_set: $email_pw_set,
                    threshold_minutes: $wait,
                    msmtp_installed: $msmtp_installed,
                    configured: ($email_sender != "" and $email_recipient != "" and $email_pw_set)
                },
                discord: {
                    enabled: ($discord.enabled // false),
                    owner_discord_id: $discord_owner,
                    token_set: $discord_token_set,
                    threshold_minutes: $wait,
                    connected: $discord_connected,
                    configured: ($discord_owner != "" and $discord_token_set)
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

        # A channel that omits threshold_minutes keeps the current single wait.
        cq_alert_after_min
        cur_wait="$CQ_ALERT_AFTER_MIN"

        sms_enabled_in=$(printf '%s' "$POST_DATA" | jq -r '.sms.enabled // false' 2>/dev/null)
        sms_phone_in=$(printf '%s' "$POST_DATA" | jq -r '.sms.recipient_phone // ""' 2>/dev/null)
        sms_threshold_in=$(printf '%s' "$POST_DATA" | jq -r --arg d "$cur_wait" '.sms.threshold_minutes // $d' 2>/dev/null)

        email_enabled_in=$(printf '%s' "$POST_DATA" | jq -r '.email.enabled // false' 2>/dev/null)
        email_sender_in=$(printf '%s' "$POST_DATA" | jq -r '.email.sender_email // ""' 2>/dev/null)
        email_recipient_in=$(printf '%s' "$POST_DATA" | jq -r '.email.recipient_email // ""' 2>/dev/null)
        email_password_in=$(printf '%s' "$POST_DATA" | jq -r '.email.app_password // empty' 2>/dev/null)
        email_threshold_in=$(printf '%s' "$POST_DATA" | jq -r --arg d "$cur_wait" '.email.threshold_minutes // $d' 2>/dev/null)

        discord_enabled_in=$(printf '%s' "$POST_DATA" | jq -r '.discord.enabled // false' 2>/dev/null)
        discord_owner_in=$(printf '%s' "$POST_DATA" | jq -r '.discord.owner_discord_id // ""' 2>/dev/null)
        discord_threshold_in=$(printf '%s' "$POST_DATA" | jq -r --arg d "$cur_wait" '.discord.threshold_minutes // $d' 2>/dev/null)
        discord_token_in=$(printf '%s' "$POST_DATA" | jq -r '.discord.bot_token // empty' 2>/dev/null)

        routing_in=$(printf '%s' "$POST_DATA" | jq -c '.routing.events // empty' 2>/dev/null)

        # Optional top-level wait; absent (old clients) keeps the per-channel rule below.
        alert_after_in=$(printf '%s' "$POST_DATA" | jq -r 'if has("alert_after_min") and .alert_after_min != null then (.alert_after_min | tostring) else "" end' 2>/dev/null)

        # --- Validate booleans -----------------------------------------------
        case "$sms_enabled_in" in true|false) ;; *) cgi_error "invalid_enabled" "sms.enabled must be a boolean"; exit 0 ;; esac
        case "$email_enabled_in" in true|false) ;; *) cgi_error "invalid_enabled" "email.enabled must be a boolean"; exit 0 ;; esac
        case "$discord_enabled_in" in true|false) ;; *) cgi_error "invalid_enabled" "discord.enabled must be a boolean"; exit 0 ;; esac

        # --- Validate thresholds (1-1440) -------------------------------------
        for _pair in "sms:$sms_threshold_in" "email:$email_threshold_in" "discord:$discord_threshold_in"; do
            _name="${_pair%%:*}"
            _val="${_pair#*:}"
            if ! _r=$(mv_check_wait_minutes "${_name}.threshold_minutes" "$_val"); then
                cgi_error "invalid_threshold" "$_r"
                exit 0
            fi
        done

        # A posted alert_after_min wins. Without it (old clients) the per-channel fields set the
        # ONE wait: the last one that differs from the current value wins.
        new_wait="$cur_wait"
        if [ -n "$alert_after_in" ]; then
            if ! _r=$(mv_check_wait_minutes "alert_after_min" "$alert_after_in"); then
                cgi_error "invalid_threshold" "$_r"
                exit 0
            fi
            new_wait="$alert_after_in"
        else
            for _val in "$sms_threshold_in" "$email_threshold_in" "$discord_threshold_in"; do
                [ "$_val" != "$cur_wait" ] && new_wait="$_val"
            done
        fi

        # --- SMS: phone required + validated only when enabled ----------------
        if [ "$sms_enabled_in" = "true" ]; then
            if ! _r=$(mv_check_phone "$sms_phone_in"); then
                cgi_error "invalid_phone" "$_r"
                exit 0
            fi
        fi

        # --- Email: shape + marker carry-forward -------------------------------
        # The password itself is out of reach now (0700 root:root). All this
        # endpoint can know is the NON-SECRET marker written by the helper —
        # which is also what it must carry forward when the user saves without
        # re-typing a password.
        _existing_email_pw_set=$(mv_alert_email_pw_set)

        if [ "$email_enabled_in" = "true" ]; then
            if ! _r=$(mv_check_email_fields "$email_sender_in" "$email_recipient_in" "$email_password_in"); then
                cgi_error "invalid_email" "$_r"
                exit 0
            fi
            # Required unless already set: a saved password stays in place when
            # the user edits some other field, so only demand one when nothing
            # is stored yet. Slug unchanged so the frontend handling still fires.
            if [ -z "$email_password_in" ] && [ "$_existing_email_pw_set" != "true" ]; then
                cgi_error "missing_app_password" "email.app_password is required unless one is already saved"
                exit 0
            fi
        fi

        # --- Discord: owner id + marker carry-forward --------------------------
        # Previous state decides below whether the daemon needs a restart.
        mv_alert_discord_prev
        _existing_discord_token_set="$MV_DP_TOKEN"
        _existing_discord_enabled="$MV_DP_EN"
        _existing_discord_owner="$MV_DP_OWNER"

        if [ "$discord_enabled_in" = "true" ]; then
            if ! _r=$(mv_check_discord_owner "$discord_owner_in"); then
                cgi_error "invalid_discord_id" "$_r"
                exit 0
            fi
            if [ -z "$discord_token_in" ] && [ "$_existing_discord_token_set" != "true" ]; then
                cgi_error "missing_bot_token" "discord.bot_token is required unless one is already saved"
                exit 0
            fi
        fi

        # --- Routing: merge over defaults, then hard-clamp connection_lost -----
        # (connection_lost.email / connection_lost.discord are ALWAYS false —
        # server-authoritative regardless of what the client submits, mirroring
        # alert_engine.sh's hardcoded capability table.)
        routing_final=$(mv_alert_routing_final "$routing_in")

        # --- Write the single wait into the Connection Quality config (merge) ---
        if ! mv_alert_write_wait "$new_wait"; then
            cgi_error "write_failed" "Failed to write alert wait"
            exit 0
        fi

        # --- Write SMS config (atomic) ------------------------------------------
        mv_alert_write_sms "$sms_enabled_in" "$sms_phone_in" "$new_wait"
        if [ $? -eq 1 ]; then
            cgi_error "write_failed" "Failed to write SMS config"
            exit 0
        fi

        # --- Write email config (atomic, NO secret) ----------------------------
        # Ordering matters: the JSON goes down FIRST, carrying the existing
        # marker forward, and only then does the helper run. The helper reads
        # sender_email out of this file to render msmtprc, and it owns the
        # marker — so writing afterwards would clobber whatever it just set.
        mv_alert_write_email "$email_enabled_in" "$email_sender_in" "$email_recipient_in" "$_existing_email_pw_set" "$new_wait"
        if [ $? -eq 1 ]; then
            cgi_error "write_failed" "Failed to write email config"
            exit 0
        fi

        # Store a newly-typed password, or re-render msmtprc from the stored one
        # (a sender_email change alone still has to be templated into msmtprc).
        if [ -n "$email_password_in" ]; then
            if ! secret_helper set email_app_password "$email_password_in"; then
                email_password_in=""
                root_helper_fail "The privileged secret helper could not store the email app password"
                exit 0
            fi
        else
            if ! secret_helper refresh email_app_password; then
                root_helper_fail "The privileged secret helper could not regenerate the msmtp configuration"
                exit 0
            fi
        fi
        email_password_in=""

        # --- Write Discord config (atomic, NO secret) + drive service state -----
        mv_alert_write_discord "$discord_enabled_in" "$discord_owner_in" "$new_wait" "$_existing_discord_token_set"
        if [ $? -eq 1 ]; then
            cgi_error "write_failed" "Failed to write Discord config"
            exit 0
        fi

        # Store the token BEFORE the service restart below — the daemon reads
        # the secret file at startup, so restarting first would race it against
        # a token that is not on disk yet.
        _discord_token_new=0
        if [ -n "$discord_token_in" ]; then
            if ! secret_helper set discord_bot_token "$discord_token_in"; then
                discord_token_in=""
                root_helper_fail "The privileged secret helper could not store the Discord bot token"
                exit 0
            fi
            _discord_token_new=1
        fi
        discord_token_in=""

        # The daemon caches token/owner/dmChannel in memory at startup, so it is restarted when
        # one of those changed (or it was just enabled); an unrelated save leaves it connected.
        mv_alert_discord_service "$discord_enabled_in" "$_existing_discord_enabled" "$discord_owner_in" "$_existing_discord_owner" "$_discord_token_new"
        _discord_svc_err="$MV_DISCORD_SVC_ERR"
        _discord_restart_err="$MV_DISCORD_RESTART_ERR"

        # --- Write routing config (atomic, wrapped under version+events) -------
        mv_alert_write_routing "$routing_final"
        if [ $? -eq 1 ]; then
            cgi_error "write_failed" "Failed to write routing config"
            exit 0
        fi

        # --- Signal alert_engine.sh (and channel libs) to reload ---------------
        mv_alert_touch_reload

        qlog_info "Centralized alert settings saved: sms=$sms_enabled_in email=$email_enabled_in discord=$discord_enabled_in"
        if [ -n "$_discord_restart_err" ]; then
            cgi_error "service_restart_failed" "$_discord_restart_err"
            exit 0
        fi
        if [ -n "$_discord_svc_err" ]; then
            cgi_error "service_enable_failed" "$_discord_svc_err"
            exit 0
        fi
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
                    _sa_log_event "test" "sent" "$_sa_recipient"
                    cgi_success
                else
                    _sa_log_event "test" "failed" "$_sa_recipient"
                    cgi_error "send_failed" "Failed to send test SMS. Check signal, SIM credits, and recipient number."
                fi
                ;;
            email)
                # Unlike sms) and discord), this branch cannot do the work
                # itself any more. msmtprc holds the plaintext app password and
                # now lives 0600 root:root inside a 0700 dir, so www-data can
                # neither read it nor even stat it — a `[ -f ]` precondition
                # here could not tell "absent" from "forbidden". The whole send,
                # including its NDJSON log entry, happens root-side.
                #
                # No precondition is duplicated here on purpose: the helper's
                # _ea_read_config is the single authority on whether email is
                # configured, and two checks that can disagree are worse than
                # one that cannot. Slugs (library_missing / not_configured /
                # msmtp_missing / send_failed) come straight back from the
                # helper, so the frontend's handling and i18n are unchanged.
                if root_helper_call "$EMAIL_SEND_HELPER" test; then
                    cgi_success
                else
                    root_helper_fail "Failed to send test email. Check msmtp configuration and network connectivity."
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
                _d_owner=$(jq -r '.owner_discord_id // ""' "$DISCORD_CONFIG" 2>/dev/null)
                _d_recipient="discord:${_d_owner:-unknown}"
                if discord_dispatch_message "[QManager] Test alert - your Discord alert configuration is working." "test" "$_d_recipient"; then
                    # Success is NOT logged here — the daemon logs it once it
                    # actually completes the Discord API call (fire-and-forget
                    # hand-off, see discord_alerts.sh).
                    cgi_success
                else
                    _ts=$(date "+%Y-%m-%d %H:%M:%S")
                    jq -n -c --arg ts "$_ts" --arg rcpt "$_d_recipient" \
                        '{timestamp:$ts, trigger:"test", status:"failed", recipient:$rcpt}' \
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
        # One jq over the existing channel logs. -R + fromjson? drops a torn line instead of
        # aborting; 1970-stamped rows sort oldest, so they never displace real rows from the cap.
        set --
        [ -s "$SMS_LOG" ] && set -- "$@" "$SMS_LOG"
        [ -s "$EMAIL_LOG" ] && set -- "$@" "$EMAIL_LOG"
        [ -s "$DISCORD_LOG" ] && set -- "$@" "$DISCORD_LOG"
        _log_out=""
        if [ "$#" -gt 0 ]; then
            _log_out=$(jq -R -n -c --arg sms "$SMS_LOG" --arg email "$EMAIL_LOG" '
                [inputs
                 | input_filename as $f
                 | (fromjson? | select(type == "object")
                    | . + {channel: (if $f == $sms then "sms" elif $f == $email then "email" else "discord" end)})]
                | {success: true, entries: (sort_by(.timestamp) | reverse | .[0:100]), total: length}
            ' "$@" 2>/dev/null)
        fi
        [ -n "$_log_out" ] || _log_out='{"success":true,"entries":[],"total":0}'
        printf '%s\n' "$_log_out"
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
        # $! is the background job; $$ inside the subshell is this CGI's PID.
        echo $! > "$MSMTP_INSTALL_PID"

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
