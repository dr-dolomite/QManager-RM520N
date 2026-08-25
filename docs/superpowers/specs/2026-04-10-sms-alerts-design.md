# SMS Alerts — Design Spec

**Date:** 2026-04-10
**Target branch:** `main` (dev-rm520 line)
**Status:** Design approved, ready for implementation plan

---

## Summary

Add an **SMS Alerts** feature under **Monitoring**, mirroring Email Alerts but using the already-bundled `sms_tool` binary to send notifications over the cellular control channel instead of SMTP.

Unlike Email Alerts (which can only notify *after* internet recovers), SMS reaches the user *during* the outage — the primary reason this feature exists. SMS is sent both on prolonged downtime start and on recovery, guarded by network-registration checks.

---

## Goals

1. Notify the user via SMS when the modem's internet connection has been down for longer than a configured threshold.
2. Notify again when connectivity is restored, so the user knows when to stop worrying.
3. Never attempt to send while the modem is deregistered from the cellular network — sends during that window would simply fail and waste attempts.
4. Cap send attempts per event at 3 so a credit-exhausted SIM doesn't produce an endless failure loop.
5. Log every attempt (success or failure) to an in-app Alert Log card so the user can audit what happened.

## Non-goals

- No multi-recipient support (single phone number only — user can forward on the receiving device if needed).
- No international local-format normalization — E.164-ish (`+<digits>`) only.
- No install/uninstall flow — `sms_tool` is bundled in every QManager install.
- No SMS templating or HTML formatting — plain text, short enough to fit in one 160-character segment where possible.
- No separate "SMS sent during outage" vs "SMS queued" states — the state machine below handles both cleanly.

---

## Architecture

### File layout

**New files (8):**

| Path | Role |
|------|------|
| `app/monitoring/sms-alerts/page.tsx` | Next.js route entry |
| `components/monitoring/sms-alerts/sms-alerts.tsx` | Coordinator — 2-card grid |
| `components/monitoring/sms-alerts/sms-alerts-settings-card.tsx` | Config form + test button |
| `components/monitoring/sms-alerts/sms-alerts-log-card.tsx` | NDJSON log table |
| `hooks/use-sms-alerts.ts` | Fetch/save/send-test hook |
| `scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh` | GET/POST CGI endpoint |
| `scripts/www/cgi-bin/quecmanager/monitoring/sms_alert_log.sh` | Log reader CGI |
| `scripts/usr/lib/qmanager/sms_alerts.sh` | Poller-sourced library |

**Modified files (3):**

| Path | Change |
|------|--------|
| `components/app-sidebar.tsx` | Add "SMS Alerts" under Monitoring, after "Email Alerts" |
| `scripts/usr/bin/qmanager_poller` | Source `sms_alerts.sh`, call `sms_alerts_init` + `check_sms_alert` per cycle |
| `scripts/install_rm520n.sh` | Deploy the 3 new shell files |

**Device-side state files:**

```
/etc/qmanager/sms_alerts.json       Settings: enabled, recipient_phone, threshold_minutes
/tmp/qmanager_sms_reload            Flag file touched by CGI on save, consumed by poller
/tmp/qmanager_sms_log.json          NDJSON log, max 100 entries
```

No SMS equivalent to `msmtprc` — `sms_tool` takes all args on the command line.

### Component boundary

```
┌──────────────────────────────────────────────────────────────┐
│  app/monitoring/sms-alerts/page.tsx                          │
│    └─ <SmsAlertsComponent> (coordinator)                     │
│         ├─ <SmsAlertsSettingsCard>  uses useSmsAlerts()      │
│         └─ <SmsAlertsLogCard>       polls log CGI directly   │
└──────────────────────────────────────────────────────────────┘
                    │ authFetch
                    ▼
┌──────────────────────────────────────────────────────────────┐
│  sms_alerts.sh (CGI)           sms_alert_log.sh (CGI)        │
│  ├─ GET: read config                                         │
│  ├─ POST save_settings: write config + touch reload flag     │
│  └─ POST send_test: source library, call _sa_send_test_sms   │
└──────────────────────────────────────────────────────────────┘
                    │ sources
                    ▼
┌──────────────────────────────────────────────────────────────┐
│  /usr/lib/qmanager/sms_alerts.sh (library)                   │
│    ├─ sms_alerts_init        (called once from poller init)  │
│    ├─ check_sms_alert        (called every poll cycle)       │
│    ├─ _sa_read_config                                        │
│    ├─ _sa_is_registered      (modem_reachable + lte/nr)      │
│    ├─ _sa_sms_locked         (flock-wrapped sms_tool)        │
│    ├─ _sa_do_send            (3-try retry loop)              │
│    ├─ _sa_send_test_sms                                      │
│    └─ _sa_log_event          (NDJSON append + trim)          │
└──────────────────────────────────────────────────────────────┘
                    │
                    ▼
           /usr/bin/sms_tool -d /dev/smd11 send <phone> <msg>
```

The library is sourced by both `qmanager_poller` (runtime tracking) and `sms_alerts.sh` CGI (test-send). Same pattern as `email_alerts.sh`.

---

## Data Model

### Settings (`/etc/qmanager/sms_alerts.json`)

```json
{
  "enabled": false,
  "recipient_phone": "+14155551234",
  "threshold_minutes": 5
}
```

- `enabled`: `boolean`
- `recipient_phone`: `string` — E.164 with leading `+`. Backend strips the `+` before calling `sms_tool` (same convention as `scripts/www/cgi-bin/quecmanager/cellular/sms.sh:265`).
- `threshold_minutes`: `number`, 1–60

### Log entry (`/tmp/qmanager_sms_log.json`, one JSON object per line)

```json
{"timestamp":"2026-04-10 14:32:01","trigger":"Connection down 6m","status":"sent","recipient":"+14155551234"}
```

Same shape as the email log — keeps the frontend log card trivial to port.

---

## State Machine (library runtime)

### State variables

```
_sa_enabled              "true" | "false"
_sa_recipient            "+14155551234"
_sa_threshold_minutes    5
_sa_was_down             "true" | "false"     — are we tracking an outage?
_sa_downtime_start       epoch seconds        — when internet went down
_sa_downtime_sms_status  "none" | "pending" | "sent" | "failed"
```

### `check_sms_alert()` — called every poll cycle, after `check_email_alert`

```
1. Reload config if /tmp/qmanager_sms_reload exists → consume flag
2. Skip if low-power active, disabled, or not fully configured

3. Branch on conn_internet_available:

   "false":
     If not tracking → start tracking
       (set _sa_downtime_start = now,
        _sa_was_down = true,
        _sa_downtime_sms_status = "none")

   "true" AND _sa_was_down:
     RECOVERY PATH
     duration = now - _sa_downtime_start
     If _sa_downtime_sms_status == "sent":
         → send SEPARATE recovery SMS
           "Connection recovered (down 12m 30s)"
     Else ("none" | "pending" | "failed"):
         → send COMBINED dedup SMS
           "Connection was down for 12m 30s, now restored"
     Reset tracking state:
       _sa_was_down = "false"
       _sa_downtime_start = 0
       _sa_downtime_sms_status = "none"
     Note: recovery path does not need an explicit registration check —
     conn_internet_available == "true" implies the data PDP is up, which
     implies the modem is registered. Send attempts inside _sa_do_send
     still guard via _sa_is_registered for safety.

   "null" / empty:
     Keep existing state — don't reset (stale ping during outage)

4. If _sa_was_down AND _sa_downtime_sms_status == "none":
     elapsed = now - _sa_downtime_start
     If elapsed >= threshold_secs → promote to "pending"

5. If _sa_was_down AND _sa_downtime_sms_status == "pending":
     If _sa_is_registered:
         → attempt send via _sa_do_send (3 tries with 5s delay)
           success → "sent", log
           fail    → "failed", log, stop trying for this downtime-start
     Else:
         Stay "pending", re-check next poll cycle
```

### Registration check

The modem is "registered and able to send SMS" when **both** conditions hold:

1. `modem_reachable == "true"` (AT commands responding)
2. At least one of `lte_state == "connected"` OR `nr_state == "connected"`

Both variables are already populated by `poll_serving_cell` in `qmanager_poller` from `AT+QENG="servingcell"`, parsed by `parse_at.sh`. The SMS library reads them directly from the poller's global scope — no extra AT calls added.

### `_sa_do_send()` — 3-attempt retry primitive

```sh
_sa_do_send() {
    local body="$1"
    local phone="${_sa_recipient#+}"   # strip leading + for sms_tool
    local attempt=0 max=3 delay=5

    while [ "$attempt" -lt "$max" ]; do
        attempt=$((attempt + 1))
        [ "$attempt" -gt 1 ] && sleep "$delay"

        # Re-check registration inside the loop — radio state can drop between
        # attempts during a real outage.
        _sa_is_registered || continue

        if _sa_sms_locked send "$phone" "$body"; then
            return 0
        fi
    done
    return 1
}
```

`_sa_sms_locked` mirrors `sms_locked` in `scripts/www/cgi-bin/quecmanager/cellular/sms.sh:49`:

```sh
_sa_sms_locked() {
    (flock_wait 9 10 || exit 2; /usr/bin/sms_tool -d /dev/smd11 "$@" 2>/dev/null) 9<"$LOCK_FILE"
}
```

The same lockfile (`/tmp/qmanager_at.lock`) that `qcmd` uses — guarantees no conflict with the poller's AT commands running on the same cycle.

### Poller blocking budget

Worst case: one send event = 3 tries × (~2s sms_tool + 5s sleep between) ≈ 20 seconds of blocking. Acceptable; Email Alerts already blocks up to ~90s on the recovery path. Normal case (first attempt succeeds) blocks ~2s.

---

## Message Content

Four distinct trigger strings appear in both the SMS body and the log's `trigger` column:

| When                                           | Body text                                         |
|------------------------------------------------|---------------------------------------------------|
| Threshold exceeded, modem registered           | `[QManager] Connection down 6m`                   |
| Recovered, separate (downtime-start succeeded) | `[QManager] Connection recovered (down 12m 30s)`  |
| Recovered, dedup (downtime-start never sent)   | `[QManager] Connection was down for 12m 30s, now restored` |
| Test send                                      | `[QManager] Test SMS from your modem`             |

Short enough to fit in one 160-char segment. Prefix `[QManager]` so the recipient can identify the sender at a glance (sender shows as the modem's own number, which the user won't recognize).

---

## Frontend Specification

### Route & coordinator

Mirror `app/monitoring/email-alerts/page.tsx` exactly. The coordinator renders two cards in a `grid-cols-1 @3xl/main:grid-cols-2` grid and passes a `logRefreshKey` to the log card so it re-fetches after a test send.

### `SmsAlertsSettingsCard`

Form fields (in order):

1. **Enable SMS Alerts** — `<Switch>` in horizontal `<Field>`
2. **Recipient Phone** — `<Input>` with `type="tel"`, placeholder `+14155551234`
   - Validation: `/^\+[1-9]\d{6,14}$/`
   - Error: `"Include country code, e.g. +14155551234"`
3. **Alert After (minutes)** — `<Input type="number" min="1" max="60">`, default 5
   - Same validation/error text as Email Alerts

Action row:

- **Save** — `<SaveButton>` with loading flash, disabled when not dirty / invalid
- **Send Test SMS** — `<Button variant="outline">` with `SendIcon`; disabled until settings are saved AND `enabled && recipient_phone` is valid

Loading skeleton, error alert, and dirty-tracking all mirror `email-alerts-settings-card.tsx` patterns. No install/uninstall block — `sms_tool` is always present.

### `SmsAlertsLogCard`

Identical in structure to `EmailAlertsLogCard`:

- Table: Timestamp | Trigger | Status | Recipient
- Status badges using the standard outline pattern:
  - `sent` → `bg-success/15 text-success border-success/30` + `CheckCircle2Icon`
  - `failed` → `bg-destructive/15 text-destructive border-destructive/30` + `XCircleIcon`
- Refresh button, loading skeleton, empty state ("No alerts sent yet"), row-entry motion animation
- Empty-state icon: `MessageSquareIcon` instead of `MailIcon`
- Refreshes on parent's `refreshKey` prop bump

### `useSmsAlerts` hook

Fetches on mount, exposes `saveSettings`, `sendTestSms`, `refresh`. Drops the install/uninstall machinery from `useEmailAlerts` — no `msmtpInstalled`, no `installResult`, no `pollInstallStatus`, no `runInstall`, no `uninstall`. Otherwise identical structure.

### Sidebar entry

In `components/app-sidebar.tsx`, add a new entry to the Monitoring nav items array, directly after "Email Alerts":

```ts
{
  title: "SMS Alerts",
  url: "/monitoring/sms-alerts",
},
```

---

## Backend Specification

### `sms_alerts.sh` CGI — GET

Returns the current settings as JSON. No `installed` flag needed since `sms_tool` is always present.

```json
{
  "success": true,
  "settings": {
    "enabled": false,
    "recipient_phone": "",
    "threshold_minutes": 5
  }
}
```

Uses `jq -n` with `--argjson`/`--arg` flags, same pattern as `email_alerts.sh`.

### `sms_alerts.sh` CGI — POST

Dispatch on `.action`:

| Action          | Behavior |
|-----------------|----------|
| `save_settings` | Validate fields, write `/etc/qmanager/sms_alerts.json`, touch `/tmp/qmanager_sms_reload` |
| `send_test`     | Source the library, call `_sa_send_test_sms`, return success/fail |

Validation:

- `recipient_phone` must match `^\+?[1-9][0-9]{6,14}$` (matches frontend regex, tolerates missing `+`)
- `threshold_minutes` must be integer 1–60

Error responses use `cgi_error` helper (same as email_alerts.sh). Unknown actions return `unknown_action`.

### `sms_alert_log.sh` CGI

Byte-for-byte clone of `email_alert_log.sh` with `_EA_LOG_FILE` path changed to `/tmp/qmanager_sms_log.json`. Returns `{success, entries, total}` with entries in newest-first order via `jq -s 'reverse'`.

### Poller integration

Two added lines in `scripts/usr/bin/qmanager_poller`, at the existing locations next to their email counterparts:

Near line 251 (next to `. /usr/lib/qmanager/email_alerts.sh`):

```sh
. /usr/lib/qmanager/sms_alerts.sh 2>/dev/null || {
    qlog_warn "sms_alerts.sh not found, SMS alerts disabled"
    check_sms_alert() { :; }
    sms_alerts_init() { :; }
}
```

Near line 1289, after `check_email_alert`:

```sh
check_sms_alert
```

Near line 1376, after `email_alerts_init`:

```sh
sms_alerts_init
```

### Installer (`install_rm520n.sh`)

Add the three new shell files to the deployment list. No new systemd units, no new dependencies.

---

## Error Handling

| Failure mode                                     | Response                                                                 |
|--------------------------------------------------|--------------------------------------------------------------------------|
| Modem not registered when threshold exceeded     | Stay in `"pending"` state, retry next poll cycle (no attempts counted)   |
| `sms_tool` exit non-zero (no credits, SMSC busy) | Count as one attempt, retry up to 3 times with 5s delays, then `"failed"` |
| Registration drops mid-attempt                   | `_sa_is_registered` check inside the retry loop skips that attempt       |
| Downtime-start `"failed"`, recovery fires        | Dedup path runs; send one combined SMS (its own 3-try budget)            |
| Downtime-start `"sent"`, recovery fires          | Separate recovery SMS with its own 3-try budget                          |
| Config file missing / invalid JSON               | Library disables itself for the cycle, logs warning                      |
| Stale `conn_internet_available == "null"`        | Keep existing tracking state — don't reset mid-outage                    |
| sms_tool flock timeout (10s)                     | Counts as one failed attempt                                             |
| Low-power mode active                            | Skip entirely (same as email alerts)                                     |

---

## Testing Plan

### Unit-ish shell tests (manual, one-shot)

1. **Config round-trip:** Save settings via CGI, read back, verify JSON shape.
2. **Threshold validator:** POST with `threshold_minutes=0` → `invalid_threshold`. POST with `threshold_minutes=99` → `invalid_threshold`. POST with `threshold_minutes="abc"` → `invalid_threshold`.
3. **Phone validator:** POST with `recipient_phone="abc"` → error. POST with `recipient_phone="+14155551234"` → saves.
4. **Test send:** With valid config and good signal, POST `send_test` → receives SMS, log entry added.
5. **Test send (not configured):** POST `send_test` with `enabled=false` → `not_configured` error.

### Integration tests on device (manual)

1. **Happy path:** Enable alerts, threshold=1m, unplug the rmnet PDP or block ping targets for 90s → receive downtime SMS, restore → receive recovery SMS. Log shows 2 `sent` entries.
2. **Short outage:** Same setup, outage <1m → no SMS sent, no log entry.
3. **Dedup path:** Enable alerts, threshold=1m, outage 90s during which you toggle airplane mode (forces deregistration). Registration returns after outage ends → log should show one combined "was down for Xm, now restored" entry, not two.
4. **Credit exhaustion simulation:** Temporarily point `SMS_TOOL` at a wrapper script that returns non-zero → force a threshold-exceeded event → log shows one `failed` entry after ~15s of retries. Poller continues without crashing.
5. **Poller reload:** Change recipient via UI during an active tracked outage → reload flag picked up on next cycle → subsequent send uses new recipient.
6. **Low-power skip:** Touch `/tmp/qmanager_low_power_active`, force an outage → no SMS sent.

### Regression checks

- Email Alerts still works unmodified (both libraries share only the poller integration point).
- `sms.sh` CGI (SMS Center) continues to work — confirms the shared flock path is safe.
- Poller latency: tier 1 cycle time stays within existing budget when SMS library is loaded but idle.

---

## Open Questions

None at design time. All decisions locked during brainstorming:

1. Behavior: downtime-start + recovery, guarded by registration (Q1 → B)
2. Pending behavior: queue & retry while down, unbounded wait for registration (Q2 → B)
3. Recipient count: single (Q3 → A)
4. Phone format: E.164 with `+`, stripped before sms_tool (Q4 → A)
5. Dedup collapse: enabled
6. Failure cap: 3 attempts per send event
7. Downtime-failed + recovery: dedup path takes over (recommendation iii)

---

## Out of Scope / Future Ideas

- Multi-recipient (Q3 option B) — revisit if users ask
- SMS Center reuse — the Send Test SMS button could link to SMS Center for deeper diagnostics, but adds coupling. Skip.
- Alert types beyond "internet down" — band changes, temperature warnings, etc. Could reuse the library's `_sa_do_send` primitive, but out of scope for v1.
- Per-recipient delivery receipts — `sms_tool` doesn't expose SMSC delivery reports cleanly.
