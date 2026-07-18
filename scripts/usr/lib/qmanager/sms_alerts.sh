#!/bin/sh
# =============================================================================
# sms_alerts.sh — SMS Alert Library for QManager
# =============================================================================
# Sourced by qmanager_poller and CGI scripts. Detects prolonged internet
# downtime and sends SMS notifications via sms_tool on /dev/smd11 — both
# when threshold is first exceeded (if modem is still registered) and on
# recovery. Deduplicates into a single combined SMS when the downtime-start
# send never succeeded.
#
# Dependencies: jq, sms_tool (bundled at /usr/bin/sms_tool), flock,
#               qlog_* functions (optional)
# Install location: /usr/lib/qmanager/sms_alerts.sh
#
# Poller globals read:
#   conn_internet_available  ("true"/"false"/"null")
#   modem_reachable          ("true"/"false")
#   lte_state                ("connected"/"searching"/"inactive"/"unknown")
#   nr_state                 ("connected"/"searching"/"inactive"/"unknown")
#
# Config:  /etc/qmanager/sms_alerts.json
# Log:     /tmp/qmanager_sms_log.json (NDJSON, max 100 entries)
# Reload:  /tmp/qmanager_sms_reload   (flag file, touched by CGI)
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
_SA_DISPATCH_PIDFILE="/tmp/qmanager_sms_send.pid"

# --- State (populated by sms_alerts_init / _sa_read_config) ------------------
_sa_enabled="false"
_sa_recipient=""
_sa_threshold_minutes=5

# --- Downtime tracking (poller runtime only) ---------------------------------
_sa_was_down="false"
_sa_downtime_start=0
# Values: "none" | "pending" | "sent" | "failed"
_sa_downtime_sms_status="none"

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
sms_alerts_init() {
    _sa_read_config
    if [ "$_sa_enabled" = "true" ]; then
        qlog_info "SMS alerts enabled: recipient=$_sa_recipient threshold=${_sa_threshold_minutes}m"
    else
        qlog_info "SMS alerts disabled or not configured"
    fi
}

# =============================================================================
# check_sms_alert — Called every poll cycle after detect_events
# =============================================================================
check_sms_alert() {
    # Check for reload flag (CGI saved new settings)
    if [ -f "$_SA_RELOAD_FLAG" ]; then
        rm -f "$_SA_RELOAD_FLAG"
        _sa_read_config
        qlog_info "SMS alerts config reloaded: enabled=$_sa_enabled"
    fi

    # Skip if disabled or not fully configured
    [ "$_sa_enabled" != "true" ] && return 0

    # Null/stale ping state: skip ONLY if not already tracking downtime.
    if [ "$conn_internet_available" = "null" ] || [ -z "$conn_internet_available" ]; then
        [ "$_sa_was_down" != "true" ] && return 0
        # Already tracking — fall through to check pending send
    fi

    if [ "$conn_internet_available" = "false" ]; then
        # Internet is down — start tracking if not already
        if [ "$_sa_was_down" != "true" ]; then
            _sa_downtime_start=$(date +%s)
            _sa_was_down="true"
            _sa_downtime_sms_status="none"
            qlog_debug "SMS alerts: downtime tracking started at $_sa_downtime_start"
        fi

    elif [ "$conn_internet_available" = "true" ] && [ "$_sa_was_down" = "true" ]; then
        # RECOVERY PATH
        local now duration dur_text body trigger threshold_secs
        now=$(date +%s)
        duration=$((now - _sa_downtime_start))
        dur_text=$(_sa_format_duration "$duration")
        threshold_secs=$((_sa_threshold_minutes * 60))

        qlog_info "SMS alerts: recovery detected — duration=${duration}s status=$_sa_downtime_sms_status"

        # If the outage never crossed threshold and no downtime-start was
        # ever queued (status "none"), stay silent — matches email_alerts behavior.
        if [ "$_sa_downtime_sms_status" = "none" ] && [ "$duration" -lt "$threshold_secs" ]; then
            qlog_info "SMS alerts: recovery under threshold (${duration}s < ${threshold_secs}s) — silent"
            _sa_was_down="false"
            _sa_downtime_start=0
            _sa_downtime_sms_status="none"
            return 0
        fi

        if [ "$_sa_downtime_sms_status" = "sent" ]; then
            body="[QManager] Connection recovered (down ${dur_text})"
            trigger="Connection recovered (down ${dur_text})"
        else
            body="[QManager] Connection was down for ${dur_text}, now restored"
            trigger="Connection was down for ${dur_text}, now restored"
        fi
        _sa_do_send_async "$body" "$trigger"
        # Note: with async dispatch, _sa_downtime_sms_status reflects
        # dispatch INTENT, not delivery outcome — the background worker
        # has no channel to mutate this parent variable. So:
        #   "sent"  here means "downtime-start was dispatched" (which
        #           may have actually failed; check the NDJSON log).
        #   "failed" / "pending" / "none" all collapse into the dedup
        #           branch above. This is intentional: the user gets
        #           one combined "was down for X, now restored" SMS
        #           when no successful downtime-start was visible.
        # The poller's tracking state is reset below regardless; the
        # worker's _sa_log_event call records the actual outcome.

        # Reset tracking
        _sa_was_down="false"
        _sa_downtime_start=0
        _sa_downtime_sms_status="none"
        return 0
    fi

    # Step 4: promote "none" -> "pending" if threshold exceeded
    if [ "$_sa_was_down" = "true" ] && [ "$_sa_downtime_sms_status" = "none" ]; then
        local now elapsed threshold_secs
        now=$(date +%s)
        elapsed=$((now - _sa_downtime_start))
        threshold_secs=$((_sa_threshold_minutes * 60))
        if [ "$elapsed" -ge "$threshold_secs" ]; then
            _sa_downtime_sms_status="pending"
            qlog_info "SMS alerts: threshold exceeded (${elapsed}s >= ${threshold_secs}s), marking pending"
        fi
    fi

    # Step 5: if pending and registered, attempt send
    if [ "$_sa_was_down" = "true" ] && [ "$_sa_downtime_sms_status" = "pending" ]; then
        if _sa_is_registered; then
            local now duration dur_text body trigger
            now=$(date +%s)
            duration=$((now - _sa_downtime_start))
            dur_text=$(_sa_format_duration "$duration")
            body="[QManager] Connection down ${dur_text}"
            trigger="Connection down ${dur_text}"

            qlog_info "SMS alerts: dispatching downtime-start send (registered)"
            _sa_do_send_async "$body" "$trigger"
            # Optimistically advance to "sent" so the recovery path knows a
            # downtime-start SMS was attempted. The background worker logs
            # "sent" or "failed" via _sa_log_event according to its own rc.
            # If the worker returns rc=2 (unregistered for every retry inside
            # _sa_do_send), no NDJSON log is written and no in-band retry
            # happens — the user will still receive the recovery SMS when
            # internet returns. A qlog_warn is emitted by the worker for
            # operator visibility.
            _sa_downtime_sms_status="sent"
        else
            qlog_debug "SMS alerts: pending downtime send, modem not registered — waiting"
        fi
    fi
}

# =============================================================================
# _sa_do_send_async — Background variant for the poll loop
# =============================================================================
# Wraps _sa_do_send so check_sms_alert (called every poll cycle) does not
# block on registration-skip sleeps or the underlying sms_tool I/O.
# Single-flight via _SA_DISPATCH_PIDFILE.
#
# Args: $1 — message body
#       $2 — trigger description for the NDJSON log entry
# Returns immediately (always 0). The forked worker logs success/failure
# via _sa_log_event itself.
_sa_do_send_async() {
    local body="$1"
    local trigger="$2"

    if [ -f "$_SA_DISPATCH_PIDFILE" ]; then
        local _old_pid
        _old_pid=$(cat "$_SA_DISPATCH_PIDFILE" 2>/dev/null)
        if [ -n "$_old_pid" ] && [ -d "/proc/$_old_pid" ]; then
            qlog_warn "SMS alerts: previous dispatch still in flight (pid=$_old_pid), skipping"
            return 0
        fi
        rm -f "$_SA_DISPATCH_PIDFILE"
    fi

    # Fork the worker. Capture $! (child PID) — NOT $$ (which inside the
    # subshell resolves to the parent poller's PID and would create a
    # permanent lockout if the worker is hard-killed). The stale-file
    # cleanup above already handles orphan pidfiles.
    (
        _sa_do_send "$body"
        local _rc=$?
        if [ "$_rc" -eq 0 ]; then
            _sa_log_event "$trigger" "sent" "$_sa_recipient"
        elif [ "$_rc" -eq 1 ]; then
            _sa_log_event "$trigger" "failed" "$_sa_recipient"
        else
            # rc=2 (modem not registered for every attempt). Don't write
            # an NDJSON entry (it represents an unattempted send, not a
            # failure), but emit a syslog warning so operators can see
            # the dispatch was deferred. The poller does NOT auto-retry
            # because _sa_downtime_sms_status is set to "sent" optimistically;
            # the user will still receive the recovery SMS when internet returns.
            qlog_warn "SMS alerts: dispatch deferred — not registered after retries (trigger: $trigger)"
        fi
    ) </dev/null >/dev/null 2>&1 &
    local _sa_worker_pid=$!
    echo "$_sa_worker_pid" > "$_SA_DISPATCH_PIDFILE" 2>/dev/null
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
