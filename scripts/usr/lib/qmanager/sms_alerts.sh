#!/bin/sh
# =============================================================================
# sms_alerts.sh — SMS Alert Library for QManager
# =============================================================================
# Sourced by qmanager_poller and CGI scripts. Provides config parsing, the
# sms_tool transport (under the shared AT flock), and NDJSON logging for the
# SMS channel. Downtime tracking and threshold evaluation now live in
# alert_engine.sh (the unified alert engine) — this library only knows how
# to SEND, not when to send.
#
# Poller globals read (by _sa_is_registered, used at send time):
#   modem_reachable  ("true"/"false")
#   lte_state        ("connected"/"searching"/"inactive"/"unknown")
#   nr_state         ("connected"/"searching"/"inactive"/"unknown")
#
# Dependencies: jq, sms_tool (bundled at /usr/bin/sms_tool), flock,
#               qlog_* functions (optional)
# Install location: /usr/lib/qmanager/sms_alerts.sh
#
# Config:  /etc/qmanager/sms_alerts.json
# Log:     /tmp/qmanager_sms_log.json (NDJSON, max 100 entries)
# Reload:  /tmp/qmanager_sms_reload   (flag file, touched by CGI, consumed
#          by alert_engine.sh's check_alerts)
# Lock:    /tmp/qmanager_at.lock      (shared with qcmd + sms.sh)
# =============================================================================

[ -n "$_SMS_ALERTS_LOADED" ] && return 0
_SMS_ALERTS_LOADED=1

# --- Constants ---------------------------------------------------------------
_SA_CONFIG="/etc/qmanager/sms_alerts.json"
_SA_LOG_FILE="/tmp/qmanager_sms_log.json"
_SA_RELOAD_FLAG="/tmp/qmanager_sms_reload"
_SA_LOCK_FILE="/tmp/qmanager_at.lock"
_SA_SMS_TOOL="/usr/bin/sms_tool"
_SA_AT_DEVICE="/dev/smd11"
_SA_MAX_LOG=100
_SA_MAX_ATTEMPTS=3
_SA_RETRY_DELAY_SECS=5
_SA_MAX_SKIPS=3

# --- State (populated by sms_alerts_init / _sa_read_config) ------------------
_sa_enabled="false"
_sa_recipient=""
_sa_threshold_minutes=5

# =============================================================================
# _sa_flock_wait — BusyBox-compatible flock with timeout (polling loop)
# =============================================================================
# Usage: _sa_flock_wait <fd> <timeout_seconds>
# Returns: 0 = lock acquired, non-zero = timed out
_sa_flock_wait() {
    local _fd="$1" _wait="$2" _elapsed=0
    while [ "$_elapsed" -lt "$_wait" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then return 0; fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done
    flock -x -n "$_fd" 2>/dev/null
}

# =============================================================================
# _sa_sms_locked — Run sms_tool under the shared AT lock
# =============================================================================
# Mirrors sms_locked() in scripts/www/cgi-bin/quecmanager/cellular/sms.sh.
# Prevents simultaneous /dev/smd11 access from poller AT commands, SMS Center,
# and SMS Alerts. Suppresses stderr (tcsetattr warnings on smd devices).
_sa_sms_locked() {
    (_sa_flock_wait 9 10 || exit 2; "$_SA_SMS_TOOL" -d "$_SA_AT_DEVICE" "$@" 2>/dev/null) 9<"$_SA_LOCK_FILE"
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
#   0 — success (sms_tool exited 0 on at least one attempt)
#   1 — failed: at least one real sms_tool call was made and all failed
#   2 — not attempted: every iteration was skipped because the modem was
#       not registered. Caller should leave state as "pending" and retry
#       on the next poll cycle.
_sa_do_send() {
    local body="$1"
    local phone="${_sa_recipient#+}"   # sms_tool send needs no + prefix
    local attempt=0
    local attempted_real=0
    local skips=0
    local rc

    if [ ! -x "$_SA_SMS_TOOL" ]; then
        qlog_error "SMS alerts: sms_tool not found at $_SA_SMS_TOOL"
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
        _sa_sms_locked send "$phone" "$body" >/dev/null 2>&1
        rc=$?
        if [ "$rc" -eq 0 ]; then
            qlog_info "SMS alerts: sms_tool send succeeded on attempt $attempt"
            return 0
        fi
        qlog_warn "SMS alerts: sms_tool send failed on attempt $attempt/$_SA_MAX_ATTEMPTS (rc=$rc)"
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
        _sa_log_event "Test SMS" "sent" "$_sa_recipient"
        return 0
    fi
    _sa_log_event "Test SMS" "failed" "$_sa_recipient"
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
        local tmp="${_SA_LOG_FILE}.tmp"
        if tail -n "$_SA_MAX_LOG" "$_SA_LOG_FILE" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$_SA_LOG_FILE" 2>/dev/null || rm -f "$tmp"
        else
            rm -f "$tmp"
        fi
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
