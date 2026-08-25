# SMS Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an SMS Alerts feature under Monitoring that sends SMS notifications when the modem's internet connection is down (and again on recovery), using the already-bundled `sms_tool` binary over the cellular control channel.

**Architecture:** Mirror the existing Email Alerts architecture (`components/monitoring/email-alerts/`, `hooks/use-email-alerts.ts`, `scripts/www/cgi-bin/quecmanager/monitoring/email_alerts.sh`, `scripts/usr/lib/qmanager/email_alerts.sh`, poller integration in `qmanager_poller`). The SMS path drops the install/uninstall flow (sms_tool is always bundled), drops HTML templates (plain text), and adds a registration guard (`modem_reachable=true AND (lte_state=connected OR nr_state=connected)`) before every send. State machine supports downtime-start + recovery with dedup when downtime-start never succeeded.

**Tech Stack:** Next.js 16 + React 19 + shadcn/ui + TypeScript 5 (frontend); Bash + BusyBox + jq + sms_tool on `/dev/smd11` + flock (backend); systemd-managed poller (runtime).

**Reference spec:** `docs/superpowers/specs/2026-04-10-sms-alerts-design.md`

**Critical conventions (from CLAUDE.md and memory):**
- Use `bun` not `npx` — builds via `bun run build`, type-check via `bunx tsc --noEmit`
- Never UPX-compress ARM binaries (not relevant here but worth remembering)
- BusyBox `flock` lacks `-w` — use the `flock_wait` polling loop
- Strip `+` from phone number before calling `sms_tool send` (see `scripts/www/cgi-bin/quecmanager/cellular/sms.sh:265`)
- Never use `set -e` with `[ ] && ...` as last expression in a function — use `if/then`
- Status badges: `bg-success/15 text-success border-success/30` + `CheckCircle2Icon`, outline variant only

---

## Task 1: SMS Alerts Library (`/usr/lib/qmanager/sms_alerts.sh`)

**Files:**
- Create: `scripts/usr/lib/qmanager/sms_alerts.sh`

This is the runtime library sourced by both the poller (for outage tracking) and the CGI (for test sends). It is self-contained — it only reads poller globals (`conn_internet_available`, `modem_reachable`, `lte_state`, `nr_state`) and does not define any shell variables that collide with the poller or email library.

- [ ] **Step 1: Create the library file**

Write the full file exactly as shown. Use LF line endings.

```sh
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
    _fd="$1"; _wait="$2"; _elapsed=0
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
    # No alerts during scheduled low power mode
    [ -f "/tmp/qmanager_low_power_active" ] && return 0

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
        local now duration dur_text body trigger
        now=$(date +%s)
        duration=$((now - _sa_downtime_start))
        dur_text=$(_sa_format_duration "$duration")

        qlog_info "SMS alerts: recovery detected — duration=${duration}s status=$_sa_downtime_sms_status"

        if [ "$_sa_downtime_sms_status" = "sent" ]; then
            # Separate recovery SMS
            body="[QManager] Connection recovered (down ${dur_text})"
            trigger="Connection recovered (down ${dur_text})"
            if _sa_do_send "$body"; then
                _sa_log_event "$trigger" "sent" "$_sa_recipient"
            else
                _sa_log_event "$trigger" "failed" "$_sa_recipient"
            fi
        else
            # Dedup path: "none" | "pending" | "failed"
            body="[QManager] Connection was down for ${dur_text}, now restored"
            trigger="Connection was down for ${dur_text}, now restored"
            if _sa_do_send "$body"; then
                _sa_log_event "$trigger" "sent" "$_sa_recipient"
            else
                _sa_log_event "$trigger" "failed" "$_sa_recipient"
            fi
        fi

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

            qlog_info "SMS alerts: attempting downtime-start send (registered)"
            if _sa_do_send "$body"; then
                _sa_downtime_sms_status="sent"
                _sa_log_event "$trigger" "sent" "$_sa_recipient"
            else
                _sa_downtime_sms_status="failed"
                _sa_log_event "$trigger" "failed" "$_sa_recipient"
            fi
        else
            qlog_debug "SMS alerts: pending downtime send, modem not registered — waiting"
        fi
    fi
}

# =============================================================================
# _sa_do_send — Send SMS with up to 3 attempts, re-checking registration
# =============================================================================
_sa_do_send() {
    local body="$1"
    local phone="${_sa_recipient#+}"   # sms_tool send needs no + prefix
    local attempt=0
    local max_attempts=3
    local retry_delay=5
    local rc

    if [ ! -x "$_SA_SMS_TOOL" ]; then
        qlog_error "SMS alerts: sms_tool not found at $_SA_SMS_TOOL"
        return 1
    fi

    while [ "$attempt" -lt "$max_attempts" ]; do
        attempt=$((attempt + 1))
        if [ "$attempt" -gt 1 ]; then
            sleep "$retry_delay"
        fi

        # Re-check registration inside the loop — radio state can drop between
        # attempts during a real outage.
        if ! _sa_is_registered; then
            qlog_warn "SMS alerts: attempt $attempt/$max_attempts skipped — not registered"
            continue
        fi

        _sa_sms_locked send "$phone" "$body" >/dev/null 2>&1
        rc=$?
        if [ "$rc" -eq 0 ]; then
            qlog_info "SMS alerts: sms_tool send succeeded on attempt $attempt"
            return 0
        fi
        qlog_warn "SMS alerts: sms_tool send failed on attempt $attempt/$max_attempts (rc=$rc)"
    done

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
```

- [ ] **Step 2: Lint the shell file with `sh -n`**

Run from project root:

```bash
sh -n "scripts/usr/lib/qmanager/sms_alerts.sh" && echo "syntax OK"
```

Expected output: `syntax OK`. If you get parse errors, fix the reported line and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/lib/qmanager/sms_alerts.sh
git commit -m "feat(monitoring): add SMS alerts library"
```

---

## Task 2: SMS Alerts CGI Endpoint

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh`

Handles GET (read settings) and POST (`save_settings`, `send_test`). No install/uninstall actions — `sms_tool` is always bundled.

- [ ] **Step 1: Create the CGI file**

Write the full file. Use LF line endings.

```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# sms_alerts.sh — CGI Endpoint: SMS Alert Settings (GET + POST)
# =============================================================================
# GET:  Returns current SMS alert configuration.
# POST: Saves settings, or sends a test SMS.
#
# Config file: /etc/qmanager/sms_alerts.json
# Reload flag: /tmp/qmanager_sms_reload
#
# Endpoint: GET/POST /cgi-bin/quecmanager/monitoring/sms_alerts.sh
# Install location: /www/cgi-bin/quecmanager/monitoring/sms_alerts.sh
# =============================================================================

qlog_init "cgi_sms_alerts"
cgi_headers
cgi_handle_options

CONFIG="/etc/qmanager/sms_alerts.json"
RELOAD_FLAG="/tmp/qmanager_sms_reload"

# =============================================================================
# GET — Fetch current settings
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching SMS alert settings"

    if [ -f "$CONFIG" ]; then
        enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$CONFIG" 2>/dev/null)
        recipient_phone=$(jq -r '.recipient_phone // ""' "$CONFIG" 2>/dev/null)
        threshold_minutes=$(jq -r '.threshold_minutes // 5' "$CONFIG" 2>/dev/null)

        jq -n \
            --argjson enabled "$enabled" \
            --arg recipient_phone "$recipient_phone" \
            --argjson threshold_minutes "$threshold_minutes" \
            '{
                success: true,
                settings: {
                    enabled: $enabled,
                    recipient_phone: $recipient_phone,
                    threshold_minutes: $threshold_minutes
                }
            }'
    else
        printf '{"success":true,"settings":{"enabled":false,"recipient_phone":"","threshold_minutes":5}}'
    fi
    exit 0
fi

# =============================================================================
# POST — Save settings or send test SMS
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
        qlog_info "Saving SMS alert settings"

        new_enabled=$(printf '%s' "$POST_DATA" | jq -r 'if has("enabled") then (.enabled | tostring) else "false" end')
        new_recipient=$(printf '%s' "$POST_DATA" | jq -r '.recipient_phone // ""')
        new_threshold=$(printf '%s' "$POST_DATA" | jq -r '.threshold_minutes // 5')

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

        # Validate phone number (E.164-ish): optional +, 7–15 digits, first non-zero
        if [ "$new_enabled" = "true" ]; then
            case "$new_recipient" in
                '')
                    cgi_error "invalid_phone" "Recipient phone is required when alerts are enabled"
                    exit 0
                    ;;
            esac
            # Strip a leading + for the regex check
            _phone_check="${new_recipient#+}"
            case "$_phone_check" in
                ''|*[!0-9]*)
                    cgi_error "invalid_phone" "Phone must contain only digits (with optional leading +)"
                    exit 0
                    ;;
            esac
            _len=${#_phone_check}
            if [ "$_len" -lt 7 ] || [ "$_len" -gt 15 ]; then
                cgi_error "invalid_phone" "Phone must be 7–15 digits"
                exit 0
            fi
            # First digit must not be 0
            case "$_phone_check" in
                0*)
                    cgi_error "invalid_phone" "Phone must start with a country code (not 0)"
                    exit 0
                    ;;
            esac
        fi

        mkdir -p /etc/qmanager

        jq -n \
            --argjson enabled "$new_enabled" \
            --arg recipient_phone "$new_recipient" \
            --argjson threshold_minutes "$new_threshold" \
            '{
                enabled: $enabled,
                recipient_phone: $recipient_phone,
                threshold_minutes: $threshold_minutes
            }' > "$CONFIG"

        qlog_info "SMS alerts config written: enabled=$new_enabled recipient=$new_recipient threshold=${new_threshold}m"

        # Signal poller to reload config
        touch "$RELOAD_FLAG"

        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: send_test
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "send_test" ]; then
        qlog_info "Sending test SMS"

        . /usr/lib/qmanager/sms_alerts.sh 2>/dev/null || {
            cgi_error "library_missing" "SMS alerts library not found"
            exit 0
        }

        _sa_read_config
        if [ "$_sa_enabled" != "true" ]; then
            cgi_error "not_configured" "SMS alerts must be enabled and fully configured before sending a test"
            exit 0
        fi

        # CGI doesn't have poller globals (modem_reachable, lte_state, nr_state).
        # For test sends, skip the registration guard — the user explicitly asked.
        # Override _sa_is_registered with a permissive version for this invocation.
        _sa_is_registered() { return 0; }

        if _sa_send_test_sms; then
            cgi_success
        else
            cgi_error "send_failed" "Failed to send test SMS. Check signal, SIM credits, and recipient number."
        fi
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Unsupported method
cgi_error "method_not_allowed" "Only GET and POST are supported"
```

**Key detail:** the `send_test` path overrides `_sa_is_registered` with a permissive stub. In the CGI context, we don't have the poller's global variables, and the user explicitly clicked "Send Test SMS" — we attempt the send regardless and let `sms_tool` surface any failure.

- [ ] **Step 2: Lint with `sh -n`**

```bash
sh -n "scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh" && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh
git commit -m "feat(monitoring): add SMS alerts CGI endpoint"
```

---

## Task 3: SMS Alert Log Reader CGI

**Files:**
- Create: `scripts/www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh`

GET-only endpoint that returns the NDJSON log as a JSON array (newest first). Byte-for-byte equivalent to `email_alert_log.sh` except for the log file path and the `qlog_init` tag.

- [ ] **Step 1: Create the file**

```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# sms_alert_log.sh — CGI Endpoint: SMS Alert Log (GET only)
# =============================================================================
# Returns the NDJSON SMS alert log as a JSON array (newest first).
#
# Log file: /tmp/qmanager_sms_log.json (NDJSON, max 100 entries)
#
# Endpoint: GET /cgi-bin/quecmanager/monitoring/sms_alert_log.sh
# Install location: /www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh
# =============================================================================

qlog_init "cgi_sms_log"
cgi_headers
cgi_handle_options

LOG_FILE="/tmp/qmanager_sms_log.json"

if [ "$REQUEST_METHOD" = "GET" ]; then
    if [ -f "$LOG_FILE" ] && [ -s "$LOG_FILE" ]; then
        total=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
        entries=$(jq -s 'reverse' "$LOG_FILE" 2>/dev/null) || entries="[]"

        jq -n \
            --argjson entries "$entries" \
            --argjson total "$total" \
            '{ success: true, entries: $entries, total: $total }'
    else
        echo '{"success":true,"entries":[],"total":0}'
    fi
    exit 0
fi

cgi_error "method_not_allowed" "Only GET is supported"
```

- [ ] **Step 2: Lint**

```bash
sh -n "scripts/www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh" && echo "syntax OK"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh
git commit -m "feat(monitoring): add SMS alert log reader CGI"
```

---

## Task 4: Poller Integration

**Files:**
- Modify: `scripts/usr/bin/qmanager_poller` (3 insertion points)

Source the SMS library near the email library, add `sms_alerts_init` in the init block, and add `check_sms_alert` in the per-cycle block.

- [ ] **Step 1: Add library source with fallback stubs**

Open `scripts/usr/bin/qmanager_poller`. Find the block around line 251 (the existing email_alerts.sh source):

```sh
. /usr/lib/qmanager/email_alerts.sh 2>/dev/null || {
    qlog_warn "email_alerts.sh not found, email alerts disabled"
    check_email_alert() { :; }
    email_alerts_init() { :; }
}
```

Immediately after its closing `}`, insert the SMS equivalent:

```sh
. /usr/lib/qmanager/sms_alerts.sh 2>/dev/null || {
    qlog_warn "sms_alerts.sh not found, SMS alerts disabled"
    check_sms_alert() { :; }
    sms_alerts_init() { :; }
}
```

- [ ] **Step 2: Add per-cycle check**

Find the line around 1289:

```sh
    check_email_alert
```

Add directly below it:

```sh
    check_sms_alert
```

- [ ] **Step 3: Add init call**

Find the line around 1376:

```sh
    email_alerts_init
```

Add directly below it:

```sh
    sms_alerts_init
```

- [ ] **Step 4: Lint**

```bash
sh -n "scripts/usr/bin/qmanager_poller" && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_poller
git commit -m "feat(poller): wire SMS alerts library into poll cycle"
```

---

## Task 5: Installer Deployment

**Files:**
- Modify: `scripts/install_rm520n.sh`

Add the three new shell files to the installer's deployment list so they land on the device during install.

- [ ] **Step 1: Find the email alerts deployment lines**

Search the installer for `email_alerts.sh` references:

```bash
grep -n "email_alerts" scripts/install_rm520n.sh
```

You will find entries in at least two places:
1. The library deployment (copies to `/usr/lib/qmanager/`)
2. The CGI deployment (copies to `/www/cgi-bin/quecmanager/monitoring/`)

Also find `email_alert_log.sh` with a similar grep.

- [ ] **Step 2: Add SMS library deployment**

At each `email_alerts.sh` line that deploys to `/usr/lib/qmanager/`, add a matching line for `sms_alerts.sh`. Preserve whatever copy/chmod/sed pattern the surrounding code uses (the installer typically strips `\r` from every deployed shell script — make sure the new line follows the same pattern).

Example pattern (adapt to what you actually find — the real installer may use different helpers):

```sh
cp "$STAGE/scripts/usr/lib/qmanager/email_alerts.sh" /usr/lib/qmanager/
sed -i 's/\r$//' /usr/lib/qmanager/email_alerts.sh
chmod 644 /usr/lib/qmanager/email_alerts.sh
```

Becomes:

```sh
cp "$STAGE/scripts/usr/lib/qmanager/email_alerts.sh" /usr/lib/qmanager/
sed -i 's/\r$//' /usr/lib/qmanager/email_alerts.sh
chmod 644 /usr/lib/qmanager/email_alerts.sh
cp "$STAGE/scripts/usr/lib/qmanager/sms_alerts.sh" /usr/lib/qmanager/
sed -i 's/\r$//' /usr/lib/qmanager/sms_alerts.sh
chmod 644 /usr/lib/qmanager/sms_alerts.sh
```

- [ ] **Step 3: Add SMS CGI deployment**

At each `email_alerts.sh` and `email_alert_log.sh` line under the `/www/cgi-bin/quecmanager/monitoring/` path, add matching lines for `sms_alerts.sh` and `sms_alert_log.sh` (these need executable permission):

```sh
cp "$STAGE/scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh" /www/cgi-bin/quecmanager/monitoring/
sed -i 's/\r$//' /www/cgi-bin/quecmanager/monitoring/sms_alerts.sh
chmod 755 /www/cgi-bin/quecmanager/monitoring/sms_alerts.sh
cp "$STAGE/scripts/www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh" /www/cgi-bin/quecmanager/monitoring/
sed -i 's/\r$//' /www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh
chmod 755 /www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh
```

- [ ] **Step 4: Verify sudoers (if applicable)**

Check `scripts/etc/sudoers.d/` for any file that grants `www-data` access to `email_alerts.sh` helpers:

```bash
grep -rn "email_alerts" scripts/etc/sudoers.d/
```

If nothing matches, SMS alerts also needs nothing — the CGI runs as `www-data` directly, and `sms_tool` accesses `/dev/smd11` via the `dialout` group (already in place). Skip this step in that case.

If you find sudoers entries for email, add symmetric SMS entries.

- [ ] **Step 5: Lint installer**

```bash
sh -n "scripts/install_rm520n.sh" && echo "syntax OK"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "feat(installer): deploy SMS alerts library and CGI endpoints"
```

---

## Task 6: Frontend Hook (`useSmsAlerts`)

**Files:**
- Create: `hooks/use-sms-alerts.ts`

- [ ] **Step 1: Create the hook file**

```ts
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// useSmsAlerts — Fetch & Save Hook for SMS Alert Settings
// =============================================================================
// Fetches current SMS alert configuration on mount.
// Provides saveSettings for persisting changes and sendTestSms for testing.
//
// Backend: GET/POST /cgi-bin/quecmanager/monitoring/sms_alerts.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/sms_alerts.sh";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SmsAlertsSettings {
  enabled: boolean;
  recipient_phone: string;
  threshold_minutes: number;
}

export interface SmsAlertsSavePayload {
  action: "save_settings";
  enabled: boolean;
  recipient_phone: string;
  threshold_minutes: number;
}

export interface UseSmsAlertsReturn {
  settings: SmsAlertsSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  isSendingTest: boolean;
  error: string | null;
  saveSettings: (payload: SmsAlertsSavePayload) => Promise<boolean>;
  sendTestSms: () => Promise<boolean>;
  refresh: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useSmsAlerts(): UseSmsAlertsReturn {
  const [settings, setSettings] = useState<SmsAlertsSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current settings
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(json.error || "Failed to fetch SMS alert settings");
        return;
      }

      setSettings(json.settings);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch SMS alert settings",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Save settings
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (payload: SmsAlertsSavePayload): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to save settings");
          return false;
        }

        await fetchSettings(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to save settings",
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings],
  );

  // ---------------------------------------------------------------------------
  // Send test SMS
  // ---------------------------------------------------------------------------
  const sendTestSms = useCallback(async (): Promise<boolean> => {
    setIsSendingTest(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_test" }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json = await resp.json();
      if (!mountedRef.current) return false;
      return json.success;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) {
        setIsSendingTest(false);
      }
    }
  }, []);

  return {
    settings,
    isLoading,
    isSaving,
    isSendingTest,
    error,
    saveSettings,
    sendTestSms,
    refresh: fetchSettings,
  };
}
```

- [ ] **Step 2: Type-check the new file**

```bash
cd "D:/Projects/QM PROJECT/QManager-RM520N" && bunx tsc --noEmit
```

Expected: no errors. If `authFetch` import or anything else errors, confirm the path resolves (`lib/auth-fetch.ts` exists).

- [ ] **Step 3: Commit**

```bash
git add hooks/use-sms-alerts.ts
git commit -m "feat(monitoring): add useSmsAlerts hook"
```

---

## Task 7: SMS Alerts Settings Card

**Files:**
- Create: `components/monitoring/sms-alerts/sms-alerts-settings-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import React, { useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, SendIcon, AlertCircle, RefreshCcwIcon } from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  useSmsAlerts,
  type SmsAlertsSavePayload,
  type SmsAlertsSettings,
} from "@/hooks/use-sms-alerts";

// =============================================================================
// SmsAlertsSettingsCard — Toggle + Configuration Form
// =============================================================================

// E.164-ish: optional leading +, first digit 1–9, total 7–15 digits
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

interface SmsAlertsSettingsCardProps {
  onTestSmsSent?: () => void;
}

const SmsAlertsSettingsCard = ({ onTestSmsSent }: SmsAlertsSettingsCardProps) => {
  const {
    settings,
    isLoading,
    isSaving,
    isSendingTest,
    error,
    saveSettings,
    sendTestSms,
    refresh,
  } = useSmsAlerts();

  // --- Local form state (synced from server data during render) -------------
  const { saved, markSaved } = useSaveFlash();
  const [prevSettings, setPrevSettings] = useState<SmsAlertsSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [thresholdMinutes, setThresholdMinutes] = useState("5");

  if (settings && settings !== prevSettings) {
    setPrevSettings(settings);
    setIsEnabled(settings.enabled);
    setRecipientPhone(settings.recipient_phone);
    setThresholdMinutes(String(settings.threshold_minutes));
  }

  // --- Validation ------------------------------------------------------------
  const phoneError =
    recipientPhone && !PHONE_REGEX.test(recipientPhone)
      ? "Include country code, e.g. +14155551234"
      : null;

  const thresholdError =
    thresholdMinutes &&
    (isNaN(Number(thresholdMinutes)) ||
      Number(thresholdMinutes) < 1 ||
      Number(thresholdMinutes) > 60)
      ? "Duration must be 1\u201360 minutes"
      : null;

  const hasValidationErrors = !!(phoneError || thresholdError);

  // --- Dirty check -----------------------------------------------------------
  const isDirty = settings
    ? isEnabled !== settings.enabled ||
      recipientPhone !== settings.recipient_phone ||
      thresholdMinutes !== String(settings.threshold_minutes)
    : false;

  const canSave = !hasValidationErrors && isDirty && !isSaving && !isSendingTest;

  // --- Handlers --------------------------------------------------------------
  const handleToggle = (checked: boolean) => {
    setIsEnabled(checked);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const payload: SmsAlertsSavePayload = {
      action: "save_settings",
      enabled: isEnabled,
      recipient_phone: recipientPhone,
      threshold_minutes: parseInt(thresholdMinutes, 10),
    };

    const success = await saveSettings(payload);
    if (success) {
      markSaved();
      toast.success("SMS alert settings saved");
    } else {
      toast.error(error || "Failed to save SMS alert settings");
    }
  };

  const handleSendTest = async () => {
    const success = await sendTestSms();
    if (success) {
      toast.success("Test SMS sent successfully");
    } else {
      toast.error("Failed to send test SMS — check your configuration");
    }
    onTestSmsSent?.();
  };

  // Test button enabled only when fully configured and saved
  const canSendTest =
    settings?.enabled &&
    !!settings?.recipient_phone &&
    PHONE_REGEX.test(recipientPhone) &&
    !isSaving &&
    !isSendingTest;

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>SMS Alert Settings</CardTitle>
          <CardDescription>
            Sends SMS via your modem's cellular network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (initial fetch failed) ------------------------------------
  if (!isLoading && error && !settings) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>SMS Alert Settings</CardTitle>
          <CardDescription>
            Sends SMS via your modem's cellular network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load settings</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => refresh()}>
                <RefreshCcwIcon className="size-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>SMS Alert Settings</CardTitle>
        <CardDescription>
          Sends SMS via your modem's cellular network.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <FieldGroup>
              {/* Enable toggle */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="sms-alerts-enabled">
                  Enable SMS Alerts
                </FieldLabel>
                <Switch
                  id="sms-alerts-enabled"
                  checked={isEnabled}
                  onCheckedChange={handleToggle}
                />
              </Field>

              {/* Recipient phone */}
              <Field>
                <FieldLabel htmlFor="recipient-phone">
                  Recipient Phone
                </FieldLabel>
                <Input
                  id="recipient-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+14155551234"
                  className="max-w-sm font-mono"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!phoneError}
                  aria-describedby={
                    phoneError ? "recipient-phone-error" : "recipient-phone-desc"
                  }
                  autoComplete="tel"
                />
                {phoneError ? (
                  <FieldError id="recipient-phone-error">
                    {phoneError}
                  </FieldError>
                ) : (
                  <FieldDescription id="recipient-phone-desc">
                    Include the country code with a leading +, e.g. +14155551234.
                  </FieldDescription>
                )}
              </Field>

              {/* Threshold duration */}
              <Field>
                <FieldLabel htmlFor="sms-threshold-minutes">
                  Alert After (minutes)
                </FieldLabel>
                <Input
                  id="sms-threshold-minutes"
                  type="number"
                  min="1"
                  max="60"
                  placeholder="5"
                  className="max-w-sm"
                  value={thresholdMinutes}
                  onChange={(e) => setThresholdMinutes(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!thresholdError}
                  aria-describedby={
                    thresholdError ? "sms-threshold-error" : "sms-threshold-desc"
                  }
                />
                {thresholdError ? (
                  <FieldError id="sms-threshold-error">
                    {thresholdError}
                  </FieldError>
                ) : (
                  <FieldDescription id="sms-threshold-desc">
                    How long the connection must be down before an alert is
                    sent. Prevents alerts for brief, transient outages.
                  </FieldDescription>
                )}
              </Field>

              {/* Action buttons */}
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <SaveButton
                    type="submit"
                    isSaving={isSaving}
                    saved={saved}
                    disabled={!canSave}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    disabled={!canSendTest}
                    onClick={handleSendTest}
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <SendIcon className="size-4" />
                        Send Test SMS
                      </>
                    )}
                  </Button>
                </div>
                {isDirty && !canSendTest && isEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Save your changes before sending a test SMS.
                  </p>
                )}
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
};

export default SmsAlertsSettingsCard;
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors. If `@/components/ui/save-button` or anything else errors, confirm the import matches what `email-alerts-settings-card.tsx` uses.

- [ ] **Step 3: Commit**

```bash
git add components/monitoring/sms-alerts/sms-alerts-settings-card.tsx
git commit -m "feat(monitoring): add SMS alerts settings card"
```

---

## Task 8: SMS Alerts Log Card

**Files:**
- Create: `components/monitoring/sms-alerts/sms-alerts-log-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { motion } from "motion/react";

const MotionTableRow = motion.create(TableRow);

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCcwIcon,
  Clock,
  MessageSquareIcon,
  AlertCircle,
  CheckCircle2Icon,
  XCircleIcon,
} from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// =============================================================================
// SmsAlertsLogCard — Self-contained log of sent/failed SMS alerts
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/sms_alert_log.sh";

interface SmsLogEntry {
  timestamp: string;
  trigger: string;
  status: "sent" | "failed";
  recipient: string;
}

interface SmsLogResponse {
  success: boolean;
  entries: SmsLogEntry[];
  total: number;
  error?: string;
}

interface SmsAlertsLogCardProps {
  refreshKey?: number;
}

const SmsAlertsLogCard = ({ refreshKey }: SmsAlertsLogCardProps) => {
  const [entries, setEntries] = useState<SmsLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch log entries
  // ---------------------------------------------------------------------------
  const fetchLog = useCallback(
    async (mode: "initial" | "refresh" | "silent" = "initial") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (mode === "initial") setIsLoading(true);
      if (mode === "refresh") setIsRefreshing(true);
      setFetchError(null);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data: SmsLogResponse = await resp.json();
        if (controller.signal.aborted) return;

        if (data.success) {
          setEntries(data.entries);
          setTotal(data.total);
          setLastFetched(new Date());
        } else {
          const msg = data.error || "Failed to load SMS log";
          setFetchError(msg);
          if (mode !== "silent") toast.error(msg);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load SMS alert log";
        setFetchError(msg);
        if (mode !== "silent") toast.error(msg);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    fetchLog("initial");
  }, [fetchLog]);

  useEffect(() => {
    if (refreshKey) {
      fetchLog("silent");
    }
  }, [refreshKey, fetchLog]);

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Alert Log</CardTitle>
          <CardDescription>
            History of sent and failed SMS alerts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="border-b px-4 py-3">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-14" />
              </div>
            </div>
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (initial fetch failed) ------------------------------------
  if (!isLoading && fetchError && entries.length === 0) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Alert Log</CardTitle>
          <CardDescription>
            History of sent and failed SMS alerts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load alert log</AlertTitle>
            <AlertDescription>
              <p>{fetchError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => fetchLog("initial")}
              >
                <RefreshCcwIcon className="size-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Alert Log</CardTitle>
            <CardDescription>
              History of sent and failed SMS alerts.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh alert log"
            disabled={isRefreshing}
            onClick={() => fetchLog("refresh")}
          >
            <RefreshCcwIcon
              className={cn("size-4", isRefreshing && "animate-spin")}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="whitespace-nowrap">
                  Timestamp
                </TableHead>
                <TableHead scope="col">Trigger</TableHead>
                <TableHead scope="col" className="w-20">
                  Status
                </TableHead>
                <TableHead scope="col" className="hidden @md/card:table-cell">
                  Recipient
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-live="polite" aria-relevant="additions">
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2">
                      <MessageSquareIcon className="size-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        No alerts sent yet
                      </p>
                      <div className="grid gap-1">
                        <p className="text-xs text-muted-foreground/70">
                          Alerts appear here when your connection drops past
                          the configured threshold.
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          Use Send Test SMS to verify your setup.
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry, index) => (
                  <MotionTableRow
                    key={`${entry.timestamp}-${index}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.2,
                      delay: Math.min(index * 0.04, 0.4),
                      ease: "easeOut",
                    }}
                  >
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {entry.timestamp}
                    </TableCell>
                    <TableCell className="text-sm min-w-0">
                      <span className="block truncate">{entry.trigger}</span>
                      <span className="block text-xs text-muted-foreground truncate @md/card:hidden">
                        {entry.recipient}
                      </span>
                    </TableCell>
                    <TableCell>
                      {entry.status === "sent" ? (
                        <Badge
                          variant="outline"
                          className="bg-success/15 text-success hover:bg-success/20 border-success/30"
                        >
                          <CheckCircle2Icon className="h-3 w-3" />
                          Sent
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30"
                        >
                          <XCircleIcon className="h-3 w-3" />
                          Failed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden @md/card:table-cell text-sm text-muted-foreground">
                      <span className="block truncate font-mono text-xs">
                        {entry.recipient}
                      </span>
                    </TableCell>
                  </MotionTableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      {entries.length > 0 && (
        <CardFooter className="flex flex-col gap-1 @xs/card:flex-row @xs/card:justify-between @xs/card:items-center">
          <div className="text-xs text-muted-foreground">
            Showing <strong>{entries.length}</strong> of{" "}
            <strong>{total}</strong> entries
          </div>
          {lastFetched && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3 shrink-0" />
              Last updated: {lastFetched.toLocaleTimeString()}
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  );
};

export default SmsAlertsLogCard;
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/monitoring/sms-alerts/sms-alerts-log-card.tsx
git commit -m "feat(monitoring): add SMS alerts log card"
```

---

## Task 9: Coordinator + Route

**Files:**
- Create: `components/monitoring/sms-alerts/sms-alerts.tsx`
- Create: `app/monitoring/sms-alerts/page.tsx`

- [ ] **Step 1: Create the coordinator component**

`components/monitoring/sms-alerts/sms-alerts.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import SmsAlertsSettingsCard from "./sms-alerts-settings-card";
import SmsAlertsLogCard from "./sms-alerts-log-card";

const SmsAlertsComponent = () => {
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  const handleTestSmsSent = useCallback(() => {
    setLogRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">SMS Alerts</h1>
        <p className="text-muted-foreground">
          Get notified by SMS when your connection goes down for longer than a
          set duration. Delivered over the cellular control channel, so alerts
          can reach you even while your data connection is offline.
        </p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <SmsAlertsSettingsCard onTestSmsSent={handleTestSmsSent} />
        <SmsAlertsLogCard refreshKey={logRefreshKey} />
      </div>
    </div>
  );
};

export default SmsAlertsComponent;
```

- [ ] **Step 2: Create the route page**

`app/monitoring/sms-alerts/page.tsx`:

```tsx
import SmsAlertsComponent from "@/components/monitoring/sms-alerts/sms-alerts";
import React from "react";

const SmsAlertsPage = () => {
  return <SmsAlertsComponent />;
};

export default SmsAlertsPage;
```

- [ ] **Step 3: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/monitoring/sms-alerts/sms-alerts.tsx app/monitoring/sms-alerts/page.tsx
git commit -m "feat(monitoring): add SMS alerts coordinator and route"
```

---

## Task 10: Sidebar Entry

**Files:**
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Find the Monitoring items array**

Open `components/app-sidebar.tsx`. Find the block containing `"Email Alerts"` around line 214:

```tsx
        {
          title: "Email Alerts",
          url: "/monitoring/email-alerts",
        },
```

- [ ] **Step 2: Add SMS Alerts entry directly after it**

```tsx
        {
          title: "Email Alerts",
          url: "/monitoring/email-alerts",
        },
        {
          title: "SMS Alerts",
          url: "/monitoring/sms-alerts",
        },
```

- [ ] **Step 3: Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/app-sidebar.tsx
git commit -m "feat(monitoring): add SMS alerts to sidebar navigation"
```

---

## Task 11: Full Build Verification

**Files:** (no new files, verification only)

- [ ] **Step 1: Run the full type check**

```bash
cd "D:/Projects/QM PROJECT/QManager-RM520N" && bunx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Run the production build**

```bash
bun run build
```

Expected: builds successfully, `out/monitoring/sms-alerts/index.html` appears in the output directory.

- [ ] **Step 3: Verify the static export**

```bash
ls out/monitoring/sms-alerts/
```

Expected: `index.html` exists alongside the usual Next.js metadata files.

- [ ] **Step 4: No commit needed**

Build verification does not produce committed changes. If the build fails, fix the errors and re-run Task 7/8/9 type-checks to isolate.

---

## Task 12: Device Smoke Tests (manual, post-deploy)

**Files:** (no files — run on the physical RM520N-GL after installing the new tarball)

These are the acceptance checks. Do **not** skip them — shell code is not type-checked, and the state machine has enough branches that manual verification is essential.

- [ ] **Step 1: Rebuild the tarball**

```bash
bun run package
```

This produces `qmanager-v<version>.tar.gz` plus a `.sha256` file in the project root.

- [ ] **Step 2: Deploy to the device**

```bash
scp -O qmanager-v*.tar.gz root@192.168.225.1:/tmp/
```

Then on the device (via SSH or the Web Console):

```sh
cd /tmp && tar -xzf qmanager-v*.tar.gz
cd qmanager_install && bash install_rm520n.sh
```

Reboot the modem after install.

- [ ] **Step 3: Happy path — outage + recovery**

On the device, after reboot:

1. Open the QManager web UI, go to **Monitoring → SMS Alerts**
2. Enable the feature, enter a recipient phone as `+<countrycode><number>`, set threshold to `1` minute, Save
3. Click **Send Test SMS** — verify you receive the test and the log card shows one `Sent` entry with trigger `Test SMS`
4. Induce a data outage: `iptables -I OUTPUT -o rmnet_data0 -p icmp -j DROP` (or your rmnet interface name). Confirm the dashboard shows internet as down
5. Wait >1 minute
6. Remove the rule: `iptables -D OUTPUT -o rmnet_data0 -p icmp -j DROP`
7. Verify:
   - Within ~30s of threshold, you received an SMS starting with `Connection down`
   - After recovery, you received a second SMS starting with `Connection recovered`
   - The log card shows two new `Sent` rows with the expected triggers

- [ ] **Step 4: Dedup path — outage during deregistration**

1. With SMS Alerts still enabled, induce a data outage AND toggle airplane mode simultaneously (via `AT+CFUN=4` in the AT Terminal, then `AT+CFUN=1` to restore). This simulates the modem losing both data and registration.
2. Wait >1 minute past threshold (modem remains deregistered — no SMS should leave)
3. Restore `CFUN=1` and remove the iptables DROP rule at roughly the same time
4. Verify:
   - You received **one** SMS, not two
   - Its body starts with `Connection was down for` and ends with `now restored`
   - The log card shows exactly one `Sent` row with that trigger

- [ ] **Step 5: Credit-exhaustion simulation**

The cleanest reproduction is to temporarily rename `sms_tool` so every send returns non-zero. On the device:

```sh
mv /usr/bin/sms_tool /usr/bin/sms_tool.bak
printf '#!/bin/sh\nexit 1\n' > /usr/bin/sms_tool
chmod 755 /usr/bin/sms_tool
```

Now induce an outage past the threshold, recover, then **restore**:

```sh
mv /usr/bin/sms_tool.bak /usr/bin/sms_tool
```

Verify:
- The log card shows **one** `Failed` row (the combined dedup attempt, since all 3 send attempts hit a fake non-zero exit)
- Trigger reads `Connection was down for Xm Ys, now restored`
- Poller continues running without crashing: `systemctl status qmanager-poller` returns active
- `journalctl -u qmanager-poller` contains `sms_tool send failed on attempt 3/3` lines

- [ ] **Step 6: Reload hot-reload test**

1. With an outage actively tracked (poller in `_sa_was_down=true` state), change the recipient number via the UI and Save
2. Confirm in the poller journal: `SMS alerts config reloaded: enabled=true`
3. The next send attempt uses the new recipient — verify via the log card's Recipient column

- [ ] **Step 7: Low-power mode skip**

1. Enable SMS alerts, threshold=1m
2. Touch the low-power flag: `touch /tmp/qmanager_low_power_active`
3. Induce an outage, wait past threshold, recover
4. Verify **no** SMS is sent and **no** new log rows appear
5. Clean up: `rm /tmp/qmanager_low_power_active`

- [ ] **Step 8: Confirm Email Alerts still works**

Regression check — go to **Monitoring → Email Alerts**, click **Send Test Email**, verify delivery. This confirms the poller's shared library integration didn't break the email path.

---

## Self-Review Notes (for the plan author, not the engineer)

- **Spec coverage check (complete):**
  - Architecture / file layout → Task 1–9
  - Data model → Task 1 (library), Task 2 (CGI save_settings), Task 6 (hook types)
  - State machine → Task 1
  - Registration check → Task 1 (`_sa_is_registered`)
  - `_sa_do_send` retry loop → Task 1
  - Message content table → Task 1 (inside `check_sms_alert` + `_sa_send_test_sms`)
  - Frontend cards + coordinator + route → Tasks 7, 8, 9
  - Sidebar entry → Task 10
  - CGI endpoints (settings + log) → Tasks 2, 3
  - Poller integration → Task 4
  - Installer deployment → Task 5
  - Error-handling table → distributed across Tasks 1 and 2 (validator + retry)
  - Testing plan → Task 12 (on-device smoke) + Task 11 (build verification)

- **Placeholder scan (complete):** No `TBD`, no `// TODO`, no "similar to above". Every task inlines full working code.

- **Type-consistency check (complete):**
  - `SmsAlertsSettings` shape matches across hook (Task 6), settings card (Task 7), and CGI GET response (Task 2): `{ enabled, recipient_phone, threshold_minutes }`
  - `SmsLogEntry` shape matches log card (Task 8) and library log writer (Task 1): `{ timestamp, trigger, status, recipient }`
  - `SmsAlertsSavePayload.action` is `"save_settings"` in the hook and matches the CGI dispatch
  - Route path `/monitoring/sms-alerts` is consistent across sidebar (Task 10), coordinator file path (Task 9), and page file path (Task 9)
  - `_sa_do_send` name is consistent across library definition and all call sites (`check_sms_alert`, `_sa_send_test_sms`)
  - `PHONE_REGEX` on frontend and backend share the same tolerance (optional `+`, first non-zero digit, 7–15 digits total)
