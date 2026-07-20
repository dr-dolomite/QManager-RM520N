# Centralized Alerts

The Alerts subsystem consolidates the three previously-independent notification channels — **SMS**, **Email**, and **Discord** — behind ONE page, ONE CGI endpoint, and ONE backend state machine. It exists to answer a single question every poll cycle: *"the internet just went down / came back / the device just rebooted — which enabled, routed, and physically-capable channel(s) should fire?"* Before this rework each channel carried its own downtime timer, its own threshold, and (for Discord) its own autonomous Go-side timer — three clocks that could drift apart and double-send. Now a single monotonic timer in `alert_engine.sh` drives all dispatch, and each channel library (`email_alerts.sh`, `sms_alerts.sh`, `discord_alerts.sh`) is reduced to a pure *transport* that only knows how to SEND, never *when*.

> ℹ️ NOTE: This engine decides alert **dispatch** only. The Recent Activities feed (`events.sh`, surfaced at `/monitoring`) has its own independent internet-lost/internet-restored detection and is **not** touched by the alert engine. A device can log a "connection lost" activity without sending any alert, and vice-versa.

---

## Quick Reference

| Item | Value |
|------|-------|
| Frontend page | `/monitoring/alerts` (`components/monitoring/alerts/`) |
| Hooks | `useAlerts` (`hooks/use-alerts.ts`), `useAlertsLog` (`hooks/use-alerts-log.ts`) |
| Types | `types/alerts.ts` |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/monitoring/alerts.sh` |
| Alert engine | `/usr/lib/qmanager/alert_engine.sh` (sourced by `qmanager_poller`) |
| Channel transports | `/usr/lib/qmanager/{email_alerts,sms_alerts,discord_alerts}.sh` |
| Discord daemon | `/usr/bin/qmanager_discord` (source: `discord-bot/`) |
| Reboot breadcrumb helper | `/usr/bin/qmanager_crash_log_append` (sudoers-gated root helper) |
| Routing config | `/etc/qmanager/alert_routing.json` (**persistent**, version 1) |
| Channel configs | `/etc/qmanager/{sms_alerts,email_alerts,discord_bot}.json` (**persistent**) |
| Reboot ledger | `/etc/qmanager/reboot_history.json` (**persistent**, NDJSON, cap 10) |
| Boot-id state | `/etc/qmanager/last_boot_id` (**persistent**) |
| Crash log (read-only here) | `/etc/qmanager/crash.log` (**persistent**, written by watchdog / root helper) |
| Legacy redirects | `/monitoring/{email-alerts,sms-alerts,discord-bot}` → `/monitoring/alerts` |

**The model, at a glance:** 3 events × 3 channels, gated by a user routing matrix AND a hardcoded backend capability table.

| Event | SMS capable? | Email capable? | Discord capable? |
|-------|:---:|:---:|:---:|
| `connection_lost` | ✅ | ❌ (needs internet) | ❌ (needs internet) |
| `connection_restored` | ✅ | ✅ | ✅ |
| `reboot` | ✅ | ✅ | ✅ |

**Effective send** = channel master-enabled **AND** routing cell = true **AND** capable. The engine's capability table (`_ae_capable`) is the single source of truth; the CGI mirrors it and hard-clamps the incapable `connection_lost` cells to `false` on every save.

---

## The routing × capability model

Two independent matrices decide whether a `(event, channel)` pair fires. Keeping them separate is deliberate: *routing* is user preference (a mutable file), *capability* is physical reality (hardcoded truth).

### Capability (physical possibility — hardcoded)

`connection_lost` alerts fire *while the internet is down*. Email (SMTP over the WAN) and Discord (Gateway API over the WAN) physically cannot be delivered in that state, so only SMS — which rides the cellular control channel via `sms_tool`, independent of the data bearer — is capable. Both `connection_restored` and `reboot` fire *after* connectivity is back, so all three channels are capable.

This lives in `alert_engine.sh`:

```sh
_ae_capable() {
    case "$1" in
        connection_lost)            [ "$2" = "sms" ] ;;              # SMS only
        connection_restored|reboot) case "$2" in sms|email|discord) return 0 ;; *) return 1 ;; esac ;;
        *) return 1 ;;
    esac
}
```

The CGI's `GET` response advertises the same table verbatim, with machine-readable reason keys the UI renders as tooltips:

```json
"capabilities": {
  "connection_lost":     { "sms": true, "email": false, "email_reason": "email_needs_internet",
                           "discord": false, "discord_reason": "discord_needs_internet" },
  "connection_restored": { "sms": true, "email": true, "discord": true },
  "reboot":              { "sms": true, "email": true, "discord": true }
}
```

> ⚠️ WARNING: The capability table is duplicated in exactly two places — `_ae_capable()` in `alert_engine.sh` and the `capabilities` block + the `ROUTING_DEFAULT` clamp in `alerts.sh`. **These must stay in lockstep.** Adding a new capable `(event, channel)` pair is a one-line change to `_ae_capable`, but you must mirror it in the CGI's `capabilities` JSON and relax the clamp, or the UI will show a cell the engine refuses to fire (or the server will strip a cell the engine would honor).

### Routing (user preference — `alert_routing.json`)

Per-event, per-channel booleans the user toggles in the routing grid. Missing file or unparseable JSON falls back to the built-in default (see schema below). The engine reads only the `.events` object; the `version` wrapper is metadata for future migrations.

### Effective-send resolution

```sh
_ae_effective_send() {           # <event> <channel>
    _ae_capable "$event" "$channel" || return 1        # 1. physically possible?
    # 2. channel master-enabled? (_sa_enabled / _ea_enabled / _ae_discord_enabled)
    # 3. routing cell true? (jq lookup into _ae_routing_json)
}
```

All three must hold. Because capability is checked *first*, a routing cell the user could never have set true (the clamped `connection_lost` email/discord cells) can never fire even if a hand-edited config file forces it.

---

## Config files & on-disk shapes

All config is **additive** — no existing channel config key was renamed or removed, so an OTA-upgraded device keeps its SMS/email/Discord settings untouched. The only *new* file is `alert_routing.json`, and it defaults-on-missing, so a device that upgrades without one behaves exactly as if every capable cell were routed true.

### `alert_routing.json` (new, version 1)

`/etc/qmanager/alert_routing.json` — **persistent**, written atomically by the CGI on save, read by the engine on init and on reload.

```json
{
  "version": 1,
  "events": {
    "connection_lost":     { "sms": true, "email": false, "discord": false },
    "connection_restored": { "sms": true, "email": true, "discord": true },
    "reboot":              { "sms": true, "email": true, "discord": true }
  }
}
```

- `version` — schema version. Currently `1`. Reserved for future migrations; the engine ignores it and reads only `.events`.
- `events.<event>.<channel>` — routing boolean. The `connection_lost.email` and `connection_lost.discord` cells are **server-authoritative false** — the CGI clamps them on every write regardless of what the client submits.
- **Defaults-on-missing:** both the engine (`_AE_ROUTING_DEFAULT`) and the CGI (`ROUTING_DEFAULT`) carry an identical literal used verbatim when the file is absent or fails to parse.

### Channel configs (unchanged shapes)

| File | Keys | Secret handling |
|------|------|-----------------|
| `sms_alerts.json` | `enabled`, `recipient_phone`, `threshold_minutes` | none |
| `email_alerts.json` | `enabled`, `sender_email`, `recipient_email`, `app_password`, `threshold_minutes` | `app_password` never returned by GET (only `app_password_set` bool) |
| `discord_bot.json` | `enabled`, `owner_discord_id`, `threshold_minutes`, `bot_token`, `autonomous_notify` | `bot_token` never returned by GET (only `token_set` bool) |

`msmtprc` (`/etc/qmanager/msmtprc`, mode `0600`) is regenerated from `email_alerts.json` on every email save — see [Email save & msmtp](#email-save--msmtp).

### Reboot ledger

`/etc/qmanager/reboot_history.json` — **persistent** NDJSON, one JSON object per line, capped to the newest 10. Written by the engine, read-only in the CGI.

```
{"epoch":1721390000,"cause":"user"}
{"epoch":1721400000,"cause":"watchdog"}
```

---

## Engine placement in the poller cycle

`qmanager_poller` sources `alert_engine.sh` at startup (non-fatal — a broken alert channel must never crash the poller; missing lib stubs out `check_alerts`/`alert_engine_init` to no-ops). It calls:

- **`alert_engine_init`** — once, at poller startup. Resets in-memory state, runs the boot-id reboot check (below), loads routing, and refreshes each channel's config.
- **`check_alerts`** — once per poll cycle, after the connectivity verdict for that cycle is known.

The engine reads two poller globals: `conn_internet_available` (`true`/`false`/`null`) and `conn_during_recovery`. It never probes or issues AT commands itself.

### Per-cycle flow

1. **Bail on low-power / recovery.** If `/tmp/qmanager_low_power_active` exists, or `conn_during_recovery = true`, return immediately — no timer reset, no dispatch, no config reload. (See guardrails.)
2. **Pick up reload flags.** If the CGI touched any of `qmanager_alert_routing_reload`, `qmanager_email_reload`, `qmanager_sms_reload`, `qmanager_discord_reload` in `/tmp/`, consume (delete) the flag and re-read that config.
3. **Read the monotonic clock.** `int($1)` from `/proc/uptime`. If unreadable, skip the cycle.
4. **Edge-detect connectivity:**
   - `null`/empty → do nothing (don't guess; if already tracking an outage, leave the timer running — the poller may just be stuck on AT I/O).
   - `false` and not already down → start tracking: record `_ae_down_start = now_up`, reset the SMS `connection_lost` latch.
   - `true` and currently down → recovery: run `_ae_handle_restore`, clear the timer.
5. **While down:** check whether the SMS `connection_lost` threshold has now elapsed (fires once per outage, latched by `_ae_lost_sent_sms`).
6. **Late reboot delivery:** if a reboot was detected at startup but the device came back already connected (never observed "down" by this engine — e.g. a clean user reboot with a fast reconnect), deliver the reboot alert once, here.

### Threshold semantics

- **`connection_lost`** — SMS only. Fires once when the *ongoing* outage crosses the SMS channel's own `threshold_minutes`.
- **`connection_restored`** — each channel is evaluated independently against *its own* `threshold_minutes` at recovery time: a channel fires iff the TOTAL outage duration crossed that channel's threshold. This preserves the exact semantics of the three timers the engine replaced (each channel used to track downtime and threshold independently).

Durations in message text are formatted from the monotonic elapsed seconds (`_ae_format_duration` → e.g. `"1h 4m 12s"`).

---

## Guardrails

- **Monotonic clock only.** Durations come from `/proc/uptime`, never `date +%s`. NTP/NITZ can step the wall clock backward or forward mid-outage; a monotonic source can't produce a negative or inflated downtime. (`date +%s` *is* used for the reboot ledger's wall-clock epoch and the coalescer window — those are timestamps, not durations, and a small clock step there is harmless.)
- **Freeze during watchdog recovery.** When `conn_during_recovery = true`, `check_alerts` returns at the very top — no timer reset, no dispatch, not even config reloads. This mirrors `events.sh`'s `detect_data_connection_events` guard, so a watchdog recovery action (radio toggle, SIM swap) is never misread as a real downtime edge.
- **Freeze during low-power windows.** `/tmp/qmanager_low_power_active` suppresses all dispatch, same as the legacy per-channel timers.
- **Connectivity signal only.** The downtime signal is `conn_internet_available` exclusively — never latency or packet loss. Those are *quality* signals owned by `events.sh` / the Quality Thresholds card, not connectivity signals.
- **Null-safe.** Stale/null ping data never starts or ends an outage; it only leaves an existing timer running.
- **Poller-lifetime state.** The outage timer and latches are in-memory only, not persisted across a poller restart — matching the pre-existing per-channel timers this engine replaced.

---

## Reboot ledger & classification

The engine detects that a reboot happened by comparing the kernel's current boot id against the last one it saw, then classifies *why* by reading a breadcrumb the watchdog (or a root helper) left in `crash.log`. The watchdog itself is **not** modified — the wiring is entirely ledger-mediated.

### Detection (boot-id compare)

On `alert_engine_init`, `_ae_init_boot_check`:

1. Reads `/proc/sys/kernel/random/boot_id` (a fresh random UUID every boot).
2. Compares against `/etc/qmanager/last_boot_id`.
3. **First boot (file absent):** record the id, but **never alert.** Installs and OTA upgrades reboot the device themselves; that must not look like a crash to the user.
4. **Id changed:** classify the cause, append to the ledger, arm `_ae_reboot_pending`, and persist the new id.

### Classification (crash.log tags)

`_ae_classify_reboot` inspects the newest `crash.log` line — pipe-delimited `<epoch>|reboot|<tag>` — but only trusts it if the entry is within a 600-second window of now (an old breadcrumb from a previous boot must not misclassify this one):

| crash.log tag | Classified cause |
|---------------|------------------|
| `tier4_escalation` | `watchdog` |
| `user` | `user` |
| *(anything else, or no recent line)* | `unplanned` |

- **`watchdog`** — the connection watchdog's Tier-4 reboot wrote `tier4_escalation` as root (see [connection-watchdog.md](connection-watchdog.md)).
- **`user`** — a user-initiated reboot (via `system/reboot.sh`) wrote the `user` breadcrumb through the sudoers-gated root helper (below).
- **`unplanned`** — the fallback when there's no positive breadcrumb: power loss, kernel panic, hardware watchdog. There is no hardware signal for this — it's inferred from the *absence* of an intentional-reboot tag.

> ℹ️ NOTE: The engine reads `crash.log` but never writes it. It is root-owned (`root:root 644`); a www-data CGI writing it directly is a symlink-escalation hole (see the root helper below). The engine only ever `tail`s it.

### The `user` breadcrumb root helper

`/usr/bin/qmanager_crash_log_append` — a narrowly-scoped root helper called by `system/reboot.sh` via sudoers:

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_crash_log_append
```

It exists solely so a user-initiated reboot leaves a `user` breadcrumb *before* the device goes down (the watchdog's own Tier-4 path writes `tier4_escalation` directly as root and needs no gate). Hardening the `installer-safety-auditor` required:

- **Reason whitelist:** the only accepted argument is the literal string `user`. Anything else is rejected with a JSON error — caller text is never interpolated.
- **Symlink guard:** a symlinked `crash.log` is removed rather than followed.
- **Self-heal on every call:** re-asserts `root:root 644` on `crash.log` each invocation, because the installer's `chown -R www-data:www-data /etc/qmanager` pass flips it back on every OTA re-run. Re-asserting on every call (not just at creation) is what keeps the root-owned invariant intact across upgrades.
- Trims to the last 20 lines, matching the watchdog's own convention.

### Delivery & coalescing

Reboot alerts are delivered **post-recovery** (once the device is back online), not at boot. `_ae_deliver_reboot`:

1. Reads the cause from the newest ledger entry.
2. **Coalesces:** counts `reboot` entries in `crash.log` from the trailing hour (same awk technique as the watchdog's own token bucket). If more than 3 (`_AE_REBOOT_COALESCE_THRESHOLD`), the message becomes *"Device rebooted N times in the last hour"* instead of one message per reboot — a flapping device doesn't spam N notifications.
3. Fires `reboot` to every effective-send channel (`sms`, `email`, `discord`).

> ℹ️ NOTE: There is **no** alerting on watchdog *tier transitions*. Only a completed reboot (boot-id change) produces a `reboot` alert. The tiers 1–3 recovery actions are invisible to the alert engine.

---

## Discord IPC contract

The Discord daemon (`/usr/bin/qmanager_discord`) is now a **pure DM transport**. Its old autonomous downtime timer is gated off by default; the shell alert engine owns all timing and drives the daemon over a filesystem command channel.

### Command file (`/tmp/qmanager_discord_cmd`)

`discord_dispatch_message` (in `discord_alerts.sh`) is fire-and-forget:

1. Verifies the daemon is running (see `da_is_running` below). If not, returns 1 — the caller logs its own `failed` entry, since nothing else will.
2. Atomically writes `{"message":"..."}` to `/tmp/qmanager_discord_cmd` (temp file + `mv`).
3. Returns 0 the instant the hand-off lands. It does **not** wait for delivery.

The daemon's `runCmdWatcher` goroutine polls that path on a 1s ticker: stat → read → remove → `ChannelMessageSend` to the owner DM channel → append its own NDJSON result line (`sent`/`failed`) to `/tmp/qmanager_discord_log.json`. Because the daemon logs success itself, the shell side logs *only* the "never reached the daemon" failure case (`_ae_log_discord_failed`) — otherwise a success would be double-logged.

### `autonomous_notify` flag

`discord_bot.json.autonomous_notify` (Go `Config.AutonomousNotify`) gates the daemon's own `RunNotifier` downtime timer. **Absent key → false** (Go zero value), so an OTA-upgraded device with an old config has NO double-send window: the shell engine is the sole alert driver. Flip it true only as a debug escape hatch.

### `da_is_running()` — the detail not to "fix" back

> ⚠️ WARNING: `da_is_running()` in `discord_alerts.sh` must work in **two** contexts with different capabilities. Do not simplify it back to a pidfile or a platform.sh-only check.

```sh
da_is_running() {
    if command -v svc_is_running >/dev/null 2>&1; then   # CGI context (platform.sh loaded)
        svc_is_running qmanager_discord
        return $?
    fi
    pgrep -f '/usr/bin/qmanager_discord' >/dev/null 2>&1  # poller context (no platform.sh)
}
```

- In the **CGI** context, `cgi_base.sh` sources `platform.sh`, so `svc_is_running` (which uses `sudo systemctl`) is available.
- In the **poller** context, `alert_engine.sh` sources `discord_alerts.sh` but the poller does **not** source `platform.sh` — so `svc_is_running` is undefined and the function falls back to a standalone `pgrep`.

The old `/run/qmanager-discord.pid` check was dead code: `qmanager-discord.service` is `Type=simple` with no `PIDFile=`, so nothing ever created that file — every poller-fired Discord alert silently failed. The `pgrep` fallback is what fixed it. Reverting to a pidfile or making the function depend on `platform.sh` re-breaks poller-driven Discord alerts.

---

## CGI contract — `/cgi-bin/quecmanager/monitoring/alerts.sh`

One endpoint replaces eight legacy ones (`email_alerts.sh`, `email_alert_log.sh`, `sms_alerts.sh`, `sms_alert_log.sh`, `discord_bot/{configure,status,test,alert_log}.sh`).

### `GET` — aggregated state

Returns all three channels' settings, the routing matrix, the capability table, and reboot history in one payload. **Never returns secrets** — `app_password` and `bot_token` are surfaced only as `*_set` / `token_set` booleans.

```json
{
  "success": true,
  "channels": {
    "sms":     { "enabled": false, "recipient_phone": "", "threshold_minutes": 5, "configured": false },
    "email":   { "enabled": false, "sender_email": "", "recipient_email": "", "app_password_set": false,
                 "threshold_minutes": 5, "msmtp_installed": false, "configured": false },
    "discord": { "enabled": false, "owner_discord_id": "", "token_set": false, "threshold_minutes": 5,
                 "connected": false, "configured": false }
  },
  "routing": { "events": { "connection_lost": {"sms":true,"email":false,"discord":false}, "...": {} } },
  "capabilities": { "connection_lost": {"sms":true,"email":false,"email_reason":"email_needs_internet",
                    "discord":false,"discord_reason":"discord_needs_internet"}, "...": {} },
  "reboots": [ {"epoch":1721400000,"cause":"watchdog"}, {"epoch":1721390000,"cause":"user"} ]
}
```

- `configured` — per channel, whether it has everything needed to send (SMS: phone set; email: sender + recipient + password stored; Discord: owner id + token stored).
- `msmtp_installed` — whether the `msmtp` mailer binary is present.
- `connected` — Discord daemon reachable / logged in (read from `/tmp/qmanager_discord_status.json`).
- `reboots` — newest-first, capped 10 (read-only mirror of the ledger).

### `POST` — dispatched on `action`

| Action | Purpose |
|--------|---------|
| `save_settings` | Persist all three channel configs + routing, atomically. |
| `send_test` | `{channel}` — send a real test alert through that channel's live transport. |
| `get_log` | Merged NDJSON log across all three channels, newest first, cap 100. |
| `install_msmtp` | Background `opkg` install of the `msmtp` mailer (optional email dependency). |
| `install_status` | Poll `install_msmtp` progress. |

**`save_settings`** validates everything up front, then writes each config atomically (temp + `mv`):

- Booleans (`sms.enabled` etc.) must be literal `true`/`false`.
- `threshold_minutes` per channel: integer 1–60.
- SMS phone (when enabled): 7–15 digits, optional leading `+`, must start with a country code (not `0`).
- Email (when enabled): valid sender + recipient addresses; **control-character gate first** (a newline in any field templated into `msmtprc` would inject arbitrary msmtp directives — config-injection defense); password required.
- Discord (when enabled): numeric snowflake owner id (15–25 digits); bot token required.
- **Secret preservation:** an omitted/empty `app_password` or `bot_token` reuses the value already on disk — the client sends a secret only when the user typed a new one.
- **Routing clamp:** the submitted routing is merged over the default (`$def * $usr`), then `connection_lost.email` and `connection_lost.discord` are hard-set to `false` — server-authoritative, mirroring `_ae_capable`.
- **Discord service state:** enabling restarts `qmanager_discord` (a *restart*, not start — the daemon caches token/owner/DM-channel in memory at startup); disabling stops it.
- **Reload signalling:** touches all four reload flags (`sms`, `email`, `discord`, `routing`) so the poller's `check_alerts` picks up the new config on its next cycle.

**Error shape** (all failures): `{ "success": false, "error": "<code>", "detail"?: "<human message>" }`.

### Email save & msmtp

On email save, if a sender + password are present, the CGI regenerates `/etc/qmanager/msmtprc` for `smtp.gmail.com:587` STARTTLS. The credential file is created `0600` from the start — `umask 077` inside a subshell closes the TOCTOU window where the plaintext Gmail app password would briefly be world-readable before `chmod`.

### `send_test` per channel

- **SMS** — bypasses the registration guard for this one call (the CGI context has no poller globals to satisfy it, and the user explicitly asked to test), then calls `sms_alert_send`.
- **Email** — requires `msmtprc` to exist ("save settings first"), then `email_alert_send`.
- **Discord** — requires the daemon running (`da_is_running`), then `discord_dispatch_message`. Success is NOT logged by the CGI — the daemon logs it once it completes the API call (fire-and-forget hand-off).

---

## Frontend anatomy

Page: `/monitoring/alerts` — `components/monitoring/alerts/alerts.tsx`. Two hooks, one type contract (`types/alerts.ts`):

- **`useAlerts`** (`hooks/use-alerts.ts`) — the whole settings surface: fetches the combined `{channels, routing, capabilities, reboots}`, saves it in one atomic POST, runs per-channel tests, and drives the msmtp install lifecycle. Exposes `saveSettings`, `sendTest`, `runInstall`, `refresh`.
- **`useAlertsLog`** (`hooks/use-alerts-log.ts`) — the merged activity log (`get_log`).

Components: `alerts-settings-card.tsx` (per-channel config), `alert-routing-grid.tsx` (the event × channel matrix — renders capability from the API, never hard-coding which cells are possible; incapable cells render disabled with the reason tooltip), `alerts-status-card.tsx`, `alerts-log-card.tsx`, plus `use-alerts-form.ts` (form state) and `constants.tsx`.

> ℹ️ NOTE: The UI **renders** capability from the API `capabilities` block; it never hard-codes which `(event, channel)` cells are possible. A future capability change is a backend-only edit.

### Legacy page redirects

The three old pages are kept as thin client-side redirects so old bookmarks still work:

| Legacy route | Redirects to |
|--------------|--------------|
| `/monitoring/email-alerts` | `/monitoring/alerts` |
| `/monitoring/sms-alerts` | `/monitoring/alerts` |
| `/monitoring/discord-bot` | `/monitoring/alerts` |

The sidebar (`components/app-sidebar.tsx`) now lists a single **Alerts** entry pointing at `/monitoring/alerts`.

---

## Split-ownership boundaries

The Alerts page owns *notification* config only. Several adjacent files are owned by other subsystems and share the same `/etc/qmanager/` directory — **the Alerts page must never write them:**

| File | Owner | Alerts relationship |
|------|-------|---------------------|
| `qmanager.conf` `[watchcat]` (`watchcat.*`) | Connection Watchdog (`watchdog.sh`) | Off-limits. Recovery tiers, thresholds, SIM-failover config. |
| `ping_profile.json` | Watchdog (`interval_sec`) + Connection Quality (`profile`/`targets`) | Off-limits. The connectivity *producer's* config. |
| `quality_thresholds.json` | Connection Quality (Latency & Loss Thresholds card, feeding `events.sh`) | Off-limits. Latency/loss presets are quality signals, not connectivity. |
| `crash.log` | Watchdog (Tier 4) + the `user` root helper | **Read-only** for the engine; written only by root paths. |

The alert engine *reads* the connectivity verdict indirectly (via the poller's `conn_internet_available` global, itself derived from `qmanager_ping`) but never touches any of these files. Conversely, the watchdog and quality subsystems never touch `alert_routing.json` or the channel configs. This clean separation is why an alert can fire without a watchdog recovery, and a recovery can happen without an alert.

---

## Related docs

- Connection Watchdog — the recovery ladder that writes `tier4_escalation` reboot breadcrumbs — [connection-watchdog.md](connection-watchdog.md)
- Connection Quality — the `qmanager_ping` producer and the latency/loss thresholds surface — [connection-quality.md](connection-quality.md)
- Discord bot internals (daemon lifecycle, DM channel resolution, OAuth) — [discord-bot.md](discord-bot.md)
- AT command transport (`sms_tool`, `flock` serialization for the SMS channel) — [at-command-transport.md](at-command-transport.md)
- QManager independence (email/SMS alert install, msmtp, poller PATH, sudoers) — [qmanager-independence.md](qmanager-independence.md)
- Platform architecture, poller, boot sequence — `../rm520n-gl-architecture.md`
