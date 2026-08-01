# SMS Forwarding (RM520N-GL)

> A systemd daemon that auto-relays every new incoming SMS to a configured phone number as `From <sender>: <body>`. Seeds silently on first run so it never sprays the existing inbox, guards against relaying its own messages, retries failed sends, and stays enabled through delivery failures.

SMS Forwarding lives at `/cellular/sms/forwarding` (a sub-route under SMS Center) and is net-new on RM520N-GL. A background daemon (`qmanager_sms_forward`) polls the modem inbox every 15 seconds, forwards each unseen message to the target number, and records send failures for the UI to surface. It is the **only** server-side inbox reader in the project — every other SMS read-state is client-side (see [`sms.md`](sms.md)).

---

## Quick Reference

| Item | Value |
|---|---|
| Route | `/cellular/sms/forwarding` |
| CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh` |
| Daemon | `/usr/bin/qmanager_sms_forward` |
| systemd unit | `qmanager-sms-forward.service` (`Type=simple`, `Restart=on-failure`) |
| Config | `/etc/qmanager/sms_forwarding.json` (persistent UBIFS; lazy-created) |
| Shared AT lock | `/tmp/qmanager_at.lock` |
| PID file | `/tmp/qmanager_sms_forward.pid` |
| Seen-set | `/tmp/qmanager_sms_forward_seen` (tmpfs, one fingerprint per line) |
| Failures file | `/tmp/qmanager_sms_forward_failures.json` (array, capped at 20) |
| Reload flag | `/tmp/qmanager_sms_forward_reload` (touched by the CGI) |
| Poll interval | 15 s (daemon) / 20 s (UI failure poll) |
| Reboot | Never |

---

## How It Works

`qmanager_sms_forward` wakes every 15 s, reads the modem inbox (ME + SM, using the exact merge logic from `sms.sh`), and forwards each message it has not yet seen as `From <sender>: <body>`. Every `sms_tool` call runs under the shared `flock` on `/tmp/qmanager_at.lock` — the same lock `qcmd` holds — so it serializes against `qcmd`, the poller, and the SMS Center / SMS Alerts CGIs. The lock is acquired and released **per `sms_tool` call**, never held across the 15 s cycle or the multi-second retry loop.

Settings live in `/etc/qmanager/sms_forwarding.json` — **not** UCI. The file is lazy-created: a missing file reads as `{enabled:false, target_phone:""}`, exactly like `discord_bot.json` / `sms_alerts.json`. There is no installer seed step; the CGI's own `tmp`+`mv` on first `save_settings` is the first write. The daemon never writes the config.

---

## systemd + Gated-Service Lifecycle

The unit `qmanager-sms-forward.service` is `Type=simple`, crash-guarded with `Restart=on-failure` / `RestartSec=5` and a `StartLimitBurst=5` per `StartLimitIntervalSec=3600` window. The daemon itself never respawns — systemd owns the supervision.

The daemon is a **UCI-gated service**: it is listed in `UCI_GATED_SERVICES` in `install_rm520n.sh`, so the installer does **not** auto-enable it, and OTA updates preserve the user's on/off choice rather than force-enabling it.

> ℹ️ NOTE: On this platform "UCI-gated" is a naming convention carried over from the OpenWRT sibling — there is no UCI. The gate is the enabled flag in `/etc/qmanager/sms_forwarding.json` plus the boot symlink. RM520N-GL's minimal systemd ignores `systemctl enable` for boot, so `svc_enable` creates an explicit symlink into `/lib/systemd/system/multi-user.target.wants/`; `svc_disable` removes it. The CGI drives state via `svc_enable`/`svc_restart` on enable and `svc_stop`/`svc_disable` on disable — **never** raw `systemctl` (see `scripts/usr/lib/qmanager/platform.sh`).

`svc_restart` (not `svc_start`) is used on enable so a freshly-changed `target_phone` is picked up even if the unit was already running, while still starting a stopped unit in one call.

---

## Invariants

### Seed-on-First-Run

When `/tmp/qmanager_sms_forward_seen` is absent (first start, or first boot after a `/tmp` wipe), the daemon creates it empty and calls `process_cycle 1` — a special pass that records every currently-present inbox fingerprint **without forwarding anything**. Only messages that appear in *later* cycles are relayed.

**Why:** without this, enabling forwarding on a modem that already holds 50 messages would immediately blast all 50 to the target. The seen-file's *absence* is the trigger — its presence (even empty) means seeding is done.

> ℹ️ NOTE: The seen-set lives in `/tmp` (tmpfs), so it survives a service restart but is wiped on reboot, causing a fresh re-seed on next boot. A `svc_stop` leaves the seen-set and failures file in place (the daemon's `trap` on exit removes only the PID file and a scratch temp file).

### Loop Guard

Before forwarding, `sf_is_relay()` checks whether the content matches our own relay format `From <number>: <body>` (optional `+`, then digits only, then `: `). A match is marked seen but **not** forwarded.

**Why:** if the target number can itself receive SMS into this modem (a second SIM, a forwarding chain), the relay would reappear as a new inbox entry and trigger an endless forward loop. The guard cuts it immediately.

### 3-Attempt Abandon, Feature Stays Enabled

A failing send re-checks modem registration before **each** of three attempts (`AT+CREG?` / `AT+CGREG?` via `qcmd`, considered registered on stat `1` home or `5` roaming), waits 5 s between tries, and on exhaustion:

1. Marks the message seen (no infinite retry).
2. Appends a record to `/tmp/qmanager_sms_forward_failures.json` (capped at 20; oldest dropped on overflow).
3. Keeps running — a bad send **never** disables forwarding.

There is no "paused" state; the daemon is either enabled or disabled.

### djb2 Fingerprint Is Internal-Only

The daemon fingerprints each message as `djb2(storage|sender|timestamp|content)` over raw byte values via BusyBox `awk` (kept inside 32 bits with `% 4294967296` each step so it never overflows awk's double mantissa). The frontend read-state hook uses the same djb2 algorithm but over UTF-16 code units — for ASCII the two agree, for non-ASCII they diverge.

**Why that's safe:** the daemon's seen-set never crosses the wire and is never compared against the frontend's `localStorage` set. All that matters for dedup is a *stable hash for the same message across cycles*, which BusyBox awk delivers. The frontend fingerprints independently for its own read/unread display.

### Phone Number Handling

The daemon strips a single leading `+` from the target before passing it to `sms_tool` (same convention as `sms.sh`). The E.164-ish validation (optional `+`, first digit 1–9, 7–15 total digits) is applied in the CGI at save time (only when `enabled=1`) **and** in the daemon each cycle before forwarding. A temporarily invalid/empty target makes the daemon idle rather than exit.

---

## CGI Contract (`cellular/sms_forwarding.sh`)

### GET

```json
{
  "success": true,
  "settings": { "enabled": true, "target_phone": "14155551234" },
  "failures": [
    {
      "sender": "+14155550100",
      "timestamp": "07/19/26 14:33:11",
      "last_error": "sms_tool send failed (rc=1)"
    }
  ],
  "failure_count": 1
}
```

`failures` is the raw content of `/tmp/qmanager_sms_forward_failures.json` (array, capped at 20); `failure_count` is `failures | length`.

### POST actions

| Action | Required fields | Notes |
|---|---|---|
| `save_settings` | `enabled` (bool/`0`/`1`), `target_phone` (when enabling) | Validates the phone only when enabling. Writes `/etc/qmanager/sms_forwarding.json` (tmp+mv), touches the reload flag, then `svc_enable`+`svc_restart` (enable) or `svc_stop`+`svc_disable` (disable). |
| `clear_failures` | — | Deletes the failures file. |
| `send_test` | — | Reads the target from **config, not the request body**, so the test verifies the actual saved path. Single attempt. Body: `From QManager: SMS forwarding test`. |

Error codes: `invalid_phone`, `missing_action`, `invalid_action`, `send_failed`.

### Reload flag

`save_settings` `touch`es `/tmp/qmanager_sms_forward_reload`. The daemon checks it at the top of each cycle, re-reads the config, and removes the flag — so a config change is picked up within one 15 s cycle even without the restart.

---

## Frontend Architecture

| Artifact | Path |
|---|---|
| Types | `types/sms-forwarding.ts` |
| Hook | `hooks/use-sms-forwarding.ts` |
| Page | `app/cellular/sms/forwarding/page.tsx` |
| Center (lifted hook) | `components/cellular/sms/forwarding/forwarding-center.tsx` |
| Control card | `components/cellular/sms/forwarding/sms-forwarding-card.tsx` |
| Health card | `components/cellular/sms/forwarding/delivery-health-card.tsx` |

### Lifted-Hook Two-Card Layout

`forwarding-center.tsx` owns the single `useSmsForwarding()` call and passes the result down as an `fwd` prop to both cards — one fetch/poll loop, one source of truth, so the left (control) and right (health) cards never drift. `useSmsForwarding` fetches on mount, then polls **every 20 s silently** (no spinner, no error-clobber of a working view) so a background delivery failure surfaces without a manual refresh. The daemon polls at 15 s, so the UI lags by at most one cycle. Exports: `data`, `isLoading`, `isSaving`, `isSendingTest`, `isClearing`, `error`, `saveSettings`, `sendTest`, `clearFailures`, `refresh`.

The hook uses `authFetch` (authenticated) — unlike the public Overview endpoints — because forwarding config is privileged.

> ℹ️ NOTE: The three files above were rebuilt on the tonal design system (`DESIGN.md`) by analogy with the approved SMS Center comp. Every load-bearing contract survived the rebuild unchanged: the lifted single-hook shape with one `fwd` prop, the 20 s silent poll, phone validation gated on `isEnabled`, and Send test reading the target from **config** rather than the control input.

### Control card (`sms-forwarding-card.tsx`)

Enable toggle + destination number + save. No status display, no test button, no failure history — those belong to the health card. Phone validation is gated on `isEnabled`, so turning forwarding **off** is never blocked by a stale/invalid number in the field.

**The error branch widened from `error && !data` to `!data`.** Previously a first fetch that resolved with *no data and no error string* fell through to the form and rendered an unchecked toggle over a blank number field — which **asserts** that forwarding is off when the truth is that the config was never read. Any state without data now takes the error branch.

### Health card (`delivery-health-card.tsx`)

A single derived health state drives the whole card. The four states now differ on **both** tone and glyph:

| Health | Condition | Tone | Glyph |
|---|---|---|---|
| `active` | enabled, target set, no failures | `success-container` | `check_circle` |
| `issue` | enabled, target set, ≥1 failure | `warning-container` | `warning` |
| `unconfigured` | enabled, target empty | `primary-container` | `edit` |
| `off` | disabled | `surface-container` (neutral) | `do_not_disturb_on` |

Two things changed here and both are load-bearing.

**`unconfigured` moved off `warning` and onto the brand container.** An empty target is not a fault and not a failure — the daemon is enabled and idle, waiting on one field. That is the "reports rather than alarms" role, and DESIGN.md's Info-Is-Brand Rule renders it as `primary-container`. Previously `unconfigured` and `issue` both drew `warning`, *and* `unconfigured` and `off` both read as muted — so the state was ambiguous in two directions at once.

**All four glyphs must differ.** `success-container` and `warning-container` measure **1.03:1** apart — the same surface to the eye, and identical under deuteranopia — so tone alone carries no information here. The glyph is the channel that actually separates a healthy relay from a degraded one; two states in this slot may never share one.

The card also dropped the `bg-success/15`-style opacity washes it used for these fills in favour of real role containers, per the tonal system.

The state drives a focal icon + label + destination row (the single status surface — there is intentionally no duplicate header badge). A static preview bubble `From +15550142: <sample body>` teaches the relay format (the sample sender is a placeholder; the saved number is the *recipient*, not the sender). **Send test** is enabled only when forwarding is on and a target is set — the CGI reads the target from config, so it verifies the real saved path, not whatever is in the control input. Recent delivery failures (up to 5) show in a destructive alert with a Clear button (`clear_failures`); when there are none, a calm "No delivery problems." line shows instead.

> ℹ️ NOTE: The failures block **lost its `AnimatePresence` height animation** and is now rendered conditionally. It animated `height` on both enter and exit, breaking DESIGN.md's Transform-Only Rule and Enter-Only Rule at once. Do not reintroduce it.

### i18n

**This route was internationalized for the first time in this change** — it previously had zero `useTranslation` calls and shipped hardcoded English. 45 new keys under `sms.forwarding` were added to `public/locales/en/cellular.json` **only**; the other four locales fall back to English and surface as `i18n:check` warnings rather than as a fake "translated" figure. See [`sms.md` > i18n](sms.md#i18n) for the full accounting of the shared key drop.

> ⚠️ WARNING: this rebuild was verified **statically only** — `tsc`, `next build`, eslint, `i18n:check` and `icons:check` pass, but none of them render a page. Nothing on this route has been visually reviewed on a device.

### Known gaps

Both gaps recorded here are now **closed**, and one of them turned out to be twice the size it was written up as.

- ~~**`SaveButton` hardcodes its transient labels.**~~ **Fixed.** `components/ui/save-button.tsx` now reads `common.actions.saving` / `common.actions.saved` through `useTranslation`. The bigger half was never recorded: **16 of the 18 call sites hardcoded English *idle* labels too**, so an Italian user saw `"Lock Selected Bands"` → `"Salvataggio…"` → `"Salvato!"` → `"Lock Selected Bands"` — the transient states translated and the resting state not. All idle labels are now keyed (new `common.actions` keys `save_settings`, `save_and_apply`, `save_profile`, `update`; new `cellular.band_locking.actions.lock_selected`). This card's own save button is one of the fixed sites. See [`dashboard-state-motion.md`](dashboard-state-motion.md) > Part 3 for the rebuilt button.
- ~~**The shadcn `Checkbox` renders a lucide glyph on Material routes.**~~ **Fixed.** `Checkbox` gained an opt-in `glyph?: MaterialSymbolName` slot; the Material-route call sites pass `glyph="check"`, and `check` was already in the 97-glyph subset so it cost zero bytes. See [`icon-system.md`](icon-system.md).

### The 98 keys this rebuild shipped English-only

Worth recording on its own, because a passing gate is what let it through. The SMS tonal rebuild shipped **98 keys English-only** across `it`, `id`, `zh-CN` and `zh-TW`:

| Key group | Keys |
|---|---|
| `sms.forwarding.*` | 45 |
| `sms.inbox.*` | 39 |
| `sms.tiles.*` | 10 |
| `sms.compose.*` | 3 |
| `sms.page.forwarding` | 1 |

`bun run i18n:check` said nothing, because it grades a **missing key as a warning, not an error** — English fallback is a deliberate design choice for community packs, and the same leniency applies to the bundled five, where it is not one. All 98 are now backfilled with real translations; every locale is back at 100% and `i18n:check` reports **0 errors / 0 warnings**, down from 392 warnings.

> ⚠️ WARNING: **a green `i18n:check` does not prove your keys landed.** Read the warning count, not the exit code. This is how a whole feature shipped English-only through a passing gate. See [`i18n.md`](i18n.md) > Validation policy.

---

## On-Device Smoke Test

```sh
systemctl status qmanager-sms-forward           # unit state
journalctl -t sms_forward -n 50                 # daemon log (qlog tag)
cat /etc/qmanager/sms_forwarding.json           # persisted config
cat /tmp/qmanager_sms_forward_seen              # seen-set (one fingerprint/line)
cat /tmp/qmanager_sms_forward_failures.json     # failure records
curl -sS http://127.0.0.1/cgi-bin/quecmanager/cellular/sms_forwarding.sh   # via lighttpd
```

> ⚠️ Validate the CGI through lighttpd or `sudo -u www-data`, never as root. No reboot is ever issued by this feature.

---

## Related

- [`sms.md`](sms.md) — the SMS Center inbox, `sms_tool` binary/patch, CPMS ME+SM model, client-side read/unread. The daemon here is the only server-side inbox consumer; everything else is client-side.
- [`at-command-transport.md`](at-command-transport.md) — `qcmd`, `atcli_smd11`, the shared `/tmp/qmanager_at.lock` flock.
