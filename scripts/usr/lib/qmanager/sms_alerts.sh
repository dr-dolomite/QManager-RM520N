#!/bin/sh
# =============================================================================
# sms_alerts.sh — SMS Alert Library for QManager
# =============================================================================
# Sourced by qmanager_poller and CGI scripts. Provides config parsing, the
# qsms (QMI WMS) send path, and NDJSON logging for the SMS channel. Downtime
# tracking and threshold evaluation live in alert_engine.sh; this library
# only knows how to SEND, not when to send.
#
# Poller globals read (by _sa_is_registered, used at send time):
#   modem_reachable  ("true"/"false")
#   lte_state        ("connected"/"searching"/"inactive"/"unknown")
#   nr_state         ("connected"/"searching"/"inactive"/"unknown")
#
# Dependencies: jq, qsms (/usr/bin/qsms), qlog_* functions (optional)
# Install location: /usr/lib/qmanager/sms_alerts.sh
#
# Config:  /etc/qmanager/sms_alerts.json
# Log:     /tmp/qmanager_sms_log.json (NDJSON, max 100 entries)
# Reload:  /tmp/qmanager_sms_reload   (flag file, touched by CGI, consumed
#          by alert_engine.sh's check_alerts)
# =============================================================================

[ -n "$_SMS_ALERTS_LOADED" ] && return 0
_SMS_ALERTS_LOADED=1

# Single alert wait resolver (cq_alert_after_min); optional, falls back to the channel key.
[ -f "${QM_LIB_DIR:-/usr/lib/qmanager}/conn_state.sh" ] && . "${QM_LIB_DIR:-/usr/lib/qmanager}/conn_state.sh"

# --- Constants ---------------------------------------------------------------
_SA_CONFIG="/etc/qmanager/sms_alerts.json"
_SA_LOG_FILE="/tmp/qmanager_sms_log.json"
_SA_RELOAD_FLAG="/tmp/qmanager_sms_reload"
_SA_QSMS="/usr/bin/qsms"
_SA_MAX_LOG=100
_SA_MAX_ATTEMPTS=3
_SA_RETRY_DELAY_SECS=5
_SA_MAX_SKIPS=3

# --- State (populated by sms_alerts_init / _sa_read_config) ------------------
_sa_enabled="false"
_sa_recipient=""
_sa_threshold_minutes=5

# =============================================================================
# _sa_send_error — Plain-language error text from a failed `qsms send` envelope
# =============================================================================
# Prefers .detail, falls back to .error; non-JSON output gets a fixed sentence.
_sa_send_error() {
    local msg
    msg=$(printf '%s' "$1" | jq -r '.detail // .error // ""' 2>/dev/null)
    [ -n "$msg" ] || msg="No reply from the SMS service."
    printf '%s' "$msg"
}

# =============================================================================
# _sa_read_config — Read settings from config JSON
# =============================================================================
_sa_read_config() {
    if [ ! -f "$_SA_CONFIG" ]; then
        _sa_enabled="false"
        return 1
    fi

    _sa_enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$_SA_CONFIG" 2>/dev/null)
    _sa_recipient=$(jq -r '.recipient_phone // ""' "$_SA_CONFIG" 2>/dev/null)
    _sa_threshold_minutes=$(jq -r '.threshold_minutes // 5' "$_SA_CONFIG" 2>/dev/null)
    # The wait is one value owned by Connection Quality; the per-channel key is a fallback.
    if command -v cq_alert_after_min >/dev/null 2>&1; then
        cq_alert_after_min
        _sa_threshold_minutes="$CQ_ALERT_AFTER_MIN"
    fi

    if [ "$_sa_enabled" != "true" ]; then
        _sa_enabled="false"
        return 0
    fi
    if [ -z "$_sa_recipient" ]; then
        _sa_enabled="false"
        return 1
    fi
    return 0
}

# =============================================================================
# _sa_is_registered — Is the modem currently able to send SMS?
# =============================================================================
# Requires modem reachable AND registered on LTE or NR. Returns 0 if yes.
_sa_is_registered() {
    [ "$modem_reachable" = "true" ] || return 1
    if [ "$lte_state" = "connected" ] || [ "$nr_state" = "connected" ]; then
        return 0
    fi
    return 1
}

# =============================================================================
# sms_alerts_init — Called once at poller startup
# =============================================================================
# No longer called by the poller (alert_engine_init replaces it) — kept as a
# standalone entry point for manual sourcing/testing of this lib in isolation.
sms_alerts_init() {
    _sa_read_config
    if [ "$_sa_enabled" = "true" ]; then
        qlog_info "SMS alerts enabled: recipient=$_sa_recipient threshold=${_sa_threshold_minutes}m"
    else
        qlog_info "SMS alerts disabled or not configured"
    fi
}

# =============================================================================
# sms_alert_send — Send a one-shot alert SMS (used by alert_engine.sh and by
# the CGI's send_test action)
# =============================================================================
# Thin wrapper over _sa_do_send. Bounded blocking time (registration-skip
# loop + up to _SA_MAX_ATTEMPTS retries, a few seconds to ~15s worst case) —
# alert_engine.sh calls this inline from check_alerts, which only happens at
# real state transitions (threshold crossings / recovery / reboot), not
# every poll cycle, so this is an accepted trade-off rather than a fork.
# Normalizes _sa_do_send's rc=2 ("never attempted — not registered") into a
# plain failure, since the two-state sent/failed NDJSON log has no "deferred"
# status.
sms_alert_send() {
    local body="$1"
    _sa_do_send "$body" && return 0
    return 1
}

# =============================================================================
# _sa_do_send — Send SMS with up to _SA_MAX_ATTEMPTS real attempts
# =============================================================================
# Return codes:
#   0 — success (qsms exited 0 on at least one attempt)
#   1 — failed: at least one real qsms call was made and all failed
#   2 — not attempted: every iteration was skipped because the modem was
#       not registered. Caller should leave state as "pending" and retry
#       on the next poll cycle.
_sa_do_send() {
    local body="$1"
    local phone="${_sa_recipient#+}"   # numbers are sent without the +
    local attempt=0
    local attempted_real=0
    local skips=0
    local rc out err sent_parts ambiguous cref

    if [ ! -x "$_SA_QSMS" ]; then
        qlog_error "SMS alerts: qsms not found at $_SA_QSMS"
        return 1
    fi

    while [ "$attempt" -lt "$_SA_MAX_ATTEMPTS" ]; do
        attempt=$((attempt + 1))
        if [ "$attempt" -gt 1 ]; then
            sleep "$_SA_RETRY_DELAY_SECS"
        fi

        # Re-check registration inside the loop — radio state can drop between
        # attempts during a real outage. Skips do NOT count against the retry
        # budget; bail out after _SA_MAX_SKIPS consecutive skips so the caller
        # can retry next poll cycle rather than blocking the poller indefinitely.
        if ! _sa_is_registered; then
            qlog_warn "SMS alerts: attempt $attempt skipped — not registered"
            skips=$((skips + 1))
            attempt=$((attempt - 1))
            if [ "$skips" -ge "$_SA_MAX_SKIPS" ]; then
                qlog_warn "SMS alerts: $_SA_MAX_SKIPS consecutive skips, deferring to next poll cycle"
                break
            fi
            continue
        fi
        skips=0

        attempted_real=$((attempted_real + 1))
        out=$("$_SA_QSMS" send "$phone" "$body" 2>/dev/null)
        rc=$?
        if [ "$rc" -eq 0 ]; then
            qlog_info "SMS alerts: qsms send succeeded on attempt $attempt"
            return 0
        fi
        err=$(_sa_send_error "$out")
        qlog_warn "SMS alerts: qsms send failed on attempt $attempt/$_SA_MAX_ATTEMPTS (rc=$rc): $err"
        # A retry resends every part. Once any part went out, stop; except one
        # resume of the missing parts when the broker says it was a definite reject.
        set -- $(printf '%s' "$out" | jq -r '[(.sent_parts // 0 | tostring), (.ambiguous | tostring),
            (if (.concat_ref | type) == "number" then (.concat_ref | tostring) else "" end)] | join(" ")' 2>/dev/null)
        sent_parts="${1:-0}"; ambiguous="${2:-null}"; cref="${3:-}"
        case "$sent_parts" in ''|*[!0-9]*) sent_parts=0 ;; esac
        if [ "$sent_parts" -eq 0 ]; then
            # Nothing confirmed sent: a full retry is safe unless part 1 may have gone out.
            [ "$ambiguous" = "true" ] || continue
            qlog_warn "SMS alerts: the message may have been delivered, not retrying"
            break
        fi
        case "$cref" in ''|*[!0-9]*) cref="" ;; esac
        if [ "$ambiguous" = "false" ] && [ -n "$cref" ]; then
            qlog_warn "SMS alerts: resuming at part $((sent_parts + 1)) (ref $cref)"
            out=$("$_SA_QSMS" send --ref "$cref" --from "$((sent_parts + 1))" "$phone" "$body" 2>/dev/null)
            if [ $? -eq 0 ]; then
                qlog_info "SMS alerts: resume succeeded"
                return 0
            fi
            qlog_warn "SMS alerts: resume failed: $(_sa_send_error "$out")"
        else
            qlog_warn "SMS alerts: some parts already sent, not retrying"
        fi
        break
    done

    if [ "$attempted_real" -eq 0 ]; then
        return 2
    fi
    return 1
}

# =============================================================================
# _sa_send_test_sms — Called by CGI to send a test SMS
# =============================================================================
_sa_send_test_sms() {
    local body="[QManager] Test SMS from your modem"
    if _sa_do_send "$body"; then
        _sa_log_event "test" "sent" "$_sa_recipient"
        return 0
    fi
    _sa_log_event "test" "failed" "$_sa_recipient"
    return 1
}

# =============================================================================
# _sa_log_event — Append entry to NDJSON log file
# =============================================================================
_sa_log_event() {
    local trigger="$1"
    local status="$2"
    local recipient="$3"
    local ts
    ts=$(date "+%Y-%m-%d %H:%M:%S")

    jq -n -c \
        --arg ts "$ts" \
        --arg trigger "$trigger" \
        --arg status "$status" \
        --arg recipient "$recipient" \
        '{timestamp: $ts, trigger: $trigger, status: $status, recipient: $recipient}' \
        >> "$_SA_LOG_FILE"

    # Trim to max entries
    local count
    count=$(wc -l < "$_SA_LOG_FILE" 2>/dev/null || echo 0)
    if [ "$count" -gt "$_SA_MAX_LOG" ]; then
        # Both root and www-data append here: copy through the seeded inode, never mv over it
        # (docs/reference/tmp-file-ownership.md).
        local tmp="${_SA_LOG_FILE}.tmp.$$"
        if tail -n "$_SA_MAX_LOG" "$_SA_LOG_FILE" > "$tmp" 2>/dev/null; then
            cat "$tmp" > "$_SA_LOG_FILE" 2>/dev/null
        fi
        rm -f "$tmp"
    fi
}

# =============================================================================
# _sa_format_duration — Convert seconds to human-readable string
# =============================================================================
_sa_format_duration() {
    local secs="$1"
    local hours mins remaining

    hours=$((secs / 3600))
    remaining=$((secs % 3600))
    mins=$((remaining / 60))
    remaining=$((remaining % 60))

    if [ "$hours" -gt 0 ]; then
        printf "%dh %dm %ds" "$hours" "$mins" "$remaining"
    elif [ "$mins" -gt 0 ]; then
        printf "%dm %ds" "$mins" "$remaining"
    else
        printf "%ds" "$remaining"
    fi
}
