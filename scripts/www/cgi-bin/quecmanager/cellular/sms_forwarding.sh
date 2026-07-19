#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
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

CONFIG="/etc/qmanager/sms_forwarding.json"
RELOAD_FLAG="/tmp/qmanager_sms_forward_reload"
FAILURES_FILE="/tmp/qmanager_sms_forward_failures.json"

# Shared AT lock — the SAME lock qcmd holds (/tmp/qmanager_at.lock), so
# sms_tool here is serialized against qcmd, the poller, the SMS Center CGI,
# and the forwarding daemon itself.
LOCK_FILE="/tmp/qmanager_at.lock"
SMS_TOOL="/usr/bin/sms_tool"

# --- Validation: E.164-ish — optional +, first digit 1-9, 7-15 digits. -------
# Reused verbatim from monitoring/sms_alerts.sh / cellular/sms.sh conventions.
_validate_phone() {
    _vp=$(printf '%s' "$1" | sed 's/^+//')
    case "$_vp" in
        ''|*[!0-9]*) return 1 ;;
    esac
    _vp_len=${#_vp}
    if [ "$_vp_len" -lt 7 ] || [ "$_vp_len" -gt 15 ]; then
        return 1
    fi
    _vp_first=$(printf '%s' "$_vp" | cut -c1)
    [ "$_vp_first" = "0" ] && return 1
    return 0
}

# --- BusyBox-compatible flock with timeout (polling loop) --------------------
# BusyBox flock lacks -w (timeout). Polls with -n (non-blocking) in a loop.
flock_wait() {
    _fd="$1"; _wait="$2"; _elapsed=0
    while [ "$_elapsed" -lt "$_wait" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then return 0; fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done
    flock -x -n "$_fd" 2>/dev/null
}

# --- Locked sms_tool wrapper (mirrors cellular/sms.sh:sms_locked) -----------
# Runs sms_tool under the same /tmp/qmanager_at.lock flock qcmd uses. We do NOT
# use 2>/dev/null (would hide real sms_tool errors, leaving send_test with an
# empty error detail) or 2>&1 (a merged stream can interleave stray bytes into
# a JSON payload). Instead: capture stderr to a per-call temp file, then on
# failure return the cleaned stderr (harmless tcgetattr/tcsetattr smd-device
# noise stripped — only emitted by the unpatched binary; the patched build is
# silent) so the caller gets a meaningful error string.
sms_locked() {
    _sms_err="/tmp/qmanager_sms_forward_err.$$"
    (
        flock_wait 9 10 || exit 2
        _sms_out=$("$SMS_TOOL" "$@" 2>"$_sms_err")
        _sms_rc=$?

        if [ "$_sms_rc" -eq 0 ]; then
            printf '%s' "$_sms_out"
        else
            _sms_err_clean=$(grep -v -e '^tcgetattr(' -e '^tcsetattr(' -e 'Inappropriate ioctl for device$' < "$_sms_err" 2>/dev/null)
            if [ -n "$_sms_err_clean" ]; then
                printf '%s' "$_sms_err_clean"
            else
                printf '%s' "$_sms_out"
            fi
        fi

        rm -f "$_sms_err"
        exit "$_sms_rc"
    ) 9<"$LOCK_FILE"
}

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
            if ! _validate_phone "$TARGET"; then
                cgi_error "invalid_phone" "target_phone is not a valid phone number"
                exit 0
            fi
        fi

        mkdir -p "$(dirname "$CONFIG")" 2>/dev/null

        TMP="${CONFIG}.tmp"
        jq -n \
            --argjson enabled "$ENABLED" \
            --arg target_phone "$TARGET" \
            '{enabled: $enabled, target_phone: $target_phone}' > "$TMP" \
            && mv "$TMP" "$CONFIG"

        # Signal the running daemon to re-read config within one cycle.
        touch "$RELOAD_FLAG" 2>/dev/null

        # Drive service state to match the saved `enabled` flag — mirrors
        # monitoring/discord_bot/configure.sh's save_settings exactly.
        # svc_restart (not svc_start) is used on enable because a config
        # change (freshly-set target_phone) needs the daemon to notice; the
        # reload flag already covers that mid-cycle, but restart also starts
        # a stopped unit, so it cleanly covers "was disabled" -> "now enabled"
        # in one call. NEVER call systemctl directly — always svc_*.
        if [ "$ENABLED" = "true" ]; then
            svc_enable qmanager_sms_forward
            svc_restart qmanager_sms_forward
            qlog_info "SMS forwarding enabled, daemon enabled and restarted"
        else
            svc_stop qmanager_sms_forward
            svc_disable qmanager_sms_forward
            qlog_info "SMS forwarding disabled, daemon stopped and disabled"
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

        if ! _validate_phone "$TARGET"; then
            cgi_error "invalid_phone" "no valid target_phone configured"
            exit 0
        fi

        PHONE=$(printf '%s' "$TARGET" | sed 's/^+//')
        BODY="From QManager: SMS forwarding test"

        qlog_info "SMS forwarding test send to $PHONE"
        result=$(sms_locked send "$PHONE" "$BODY")
        rc=$?

        if [ "$rc" -ne 0 ]; then
            qlog_error "SMS forwarding test send failed (rc=$rc): $result"
            cgi_error "send_failed" "$result"
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
