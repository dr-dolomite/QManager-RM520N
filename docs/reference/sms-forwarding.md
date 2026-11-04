# SMS Forwarding (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · UI ported 2026-11, not visually verified · `qsms` daemon verified 2026-10-28 on serial 61368cd2
> **RG501Q-EU (SDX55):** `qsms` is on the WMS backend there since `qmanager_atd` 0.7.1 (T8.1), so `qsms watch` is available and the daemon wakes on events as on the RM520N-GL. WMS event registration was seen (`watch` printed `ready`, scan 2026-10-28), but an incoming message's indication and a forwarded send are **not proven** on that device — see [`platform-matrix.md`](./platform-matrix.md#at-transport)

> A systemd daemon that auto-relays every new incoming SMS to a configured phone number as `From <sender>: <body>`. It wakes on a modem new-message event, holds multi-part messages until they are complete, seeds silently on first run so it never sprays the existing inbox, guards against relaying its own messages, retries failed sends, and stays enabled through delivery failures.

SMS Forwarding lives at `/cellular/sms/forwarding` (a sub-route under SMS Center). A background daemon (`qmanager_sms_forward`) runs `qsms watch` to learn about new messages, lists the storage that changed, forwards each unseen message to the target number, and records send failures for the UI to surface. It is the **only** server-side inbox reader in the project — every other SMS read-state is client-side (see [`sms.md`](sms.md)).

---

## Quick Reference

| Item | Value |
|---|---|
| Route | `/cellular/sms/forwarding` |
| CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms_forwarding.sh` |
| Daemon | `/usr/bin/qmanager_sms_forward` (runs as root) |
| systemd unit | `qmanager-sms-forward.service` (`Type=simple`, `Restart=on-failure`) |
| SMS client | `/usr/bin/qsms` (`list`, `send`, `watch`; no AT lock) — see [`sms.md` > Transport](sms.md#transport-qsms) |
| Config | `/etc/qmanager/sms_forwarding.json` (persistent UBIFS; lazy-created) |
| PID file | `/tmp/qmanager_sms_forward.pid` |
| Seen-set | `/tmp/qmanager_sms_forward_seen` (tmpfs) |
| Pending groups | `/tmp/qmanager_sms_forward_pending` (tmpfs, `<storage> <fp> <uptime>` per line) |
| Event FIFO | `/tmp/qmanager_sms_forward_events` (fd 3; `qsms watch` output) |
| Failures file | `/tmp/qmanager_sms_forward_failures.json` (array, capped at 20) |
| Reload flag | `/tmp/qmanager_sms_forward_reload` (touched by the CGI) |
| Timers | `SF_INTERVAL=15` s (poll / wait), `SAFETY_INTERVAL=300` s, `GROUP_TIMEOUT=600` s; UI failure poll 20 s |
| Log | `/tmp/qmanager.log`, component `sms_forward` |
| Reboot | Never |

---

## How It Works

Each loop pass re-reads the config if the reload flag is set, makes sure the seen-set exists, starts the watch supervisor, lists whatever the last wake-up asked for, forwards what is new, then waits for the next wake-up. Every read and send goes through `qsms`, which takes no AT lock; the only AT traffic is the registration check before each send (`qcmd 'AT+CREG?'` / `'AT+CGREG?'`).

Settings live in `/etc/qmanager/sms_forwarding.json` — **not** UCI. The file is lazy-created: a missing file reads as `{enabled:false, target_phone:""}`, exactly like `discord_bot.json` / `sms_alerts.json`. There is no installer seed step; the CGI's own `tmp`+`mv` on first `save_settings` is the first write. The daemon never writes the config.

### Wake-up: `qsms watch` through a FIFO

`sf_watch_supervisor` runs `qsms watch` in the background with its stdout on the event FIFO. The main loop waits with `read -r -t 15` on that FIFO, then drains any burst with `read -t 1`, so the three indications of a 3-part message (~0.6 s apart) cost one list.

| Line on the FIFO | Written by | Effect |
|---|---|---|
| `ready` | `qsms watch`, after every (re)registration | List ME and SM |
| `ME <idx>` / `SM <idx>` | `qsms watch`, one per stored message | List that storage only |
| `down` | the supervisor, when `qsms watch` exits with any code but 2 | Fall back to polling until it is back |
| `unavailable` | the supervisor, when `qsms watch` exits 2 | Poll only, for the rest of this daemon's life |
| (timeout, nothing read) | — | See the table below |

What gets listed:

| State | Listed |
|---|---|
| Watch up, no event | Nothing, except the **safety list every 300 s** (ME, plus SM while SM is unseeded or its last list failed) and any storage whose pending group has reached its timeout |
| Watch up, event | The storage the event names, plus due pending storages |
| Watch down, or no FIFO | **ME and SM every 15 s** (`SF_INTERVAL`) |

Once SM has listed cleanly, the safety list reads ME only, on purpose. CPMS mem3 routes new messages to ME (see [`sms.md` > Storage Routing](sms.md#sms-storage-routing-atcpms)), and an SM list costs ~1.6 s of SIM I/O; a message that does land on SM still raises an `SM <idx>` indication.

A list is skipped when the storage's merged JSON has the same md5 as last time and it has no pending group.

> ℹ️ NOTE: `qsms watch` reconnects to WMS on its own (250 ms → 2 s backoff, `ready` again after each reconnect) and exits only when its stdout closes (0) or it can never work on this modem (2: QRTR unavailable, or the AT backend's `unsupported`). On exit 2 the supervisor writes `unavailable` and stops, and the daemon logs `SMS forward: qsms watch unavailable on this modem; polling only` once and never starts it again. On any other exit the supervisor restarts it after 1 s, adding 1 s for each consecutive run shorter than 60 s, capped at 60 s. Neither path ends the daemon, so a modem subsystem restart never counts against the unit's `StartLimitBurst=5` (journald is masked on this device, so a start-limit-hit would be silent). The forced-reconnect path has not been run on hardware.

---

## systemd + Gated-Service Lifecycle

The unit `qmanager-sms-forward.service` is `Type=simple`, crash-guarded with `Restart=on-failure` / `RestartSec=5` and a `StartLimitBurst=5` per `StartLimitIntervalSec=3600` window, with `TimeoutStopSec=10`. The daemon itself never respawns — systemd owns the supervision.

The daemon is a **UCI-gated service**: it is listed in `UCI_GATED_SERVICES` in `install_rm520n.sh`, so the installer does **not** auto-enable it, and OTA updates preserve the user's on/off choice rather than force-enabling it.

> ℹ️ NOTE: On this platform "UCI-gated" is a naming convention carried over from the OpenWRT sibling — there is no UCI. The gate is the enabled flag in `/etc/qmanager/sms_forwarding.json` plus the boot symlink. RM520N-GL's minimal systemd ignores `systemctl enable` for boot, so `svc_enable` creates an explicit symlink into `/lib/systemd/system/multi-user.target.wants/`; `svc_disable` removes it. The CGI drives state via `svc_enable`/`svc_restart` on enable and `svc_stop`/`svc_disable` on disable — **never** raw `systemctl` (see `scripts/usr/lib/qmanager/platform.sh`).

`svc_restart` (not `svc_start`) is used on enable so a freshly-changed `target_phone` is picked up even if the unit was already running, while still starting a stopped unit in one call.

While forwarding is disabled or the target is invalid, the daemon stops the watch supervisor and sleeps 15 s per pass. Every idle sleep is `sf_sleep` (`sleep & wait`, the sleep killed in `sf_cleanup`): BusyBox ash runs a trap only after a foreground child ends, so a foreground `sleep 15` delayed SIGTERM by up to 15 s.

> ℹ️ NOTE: An OTA from v0.1.14–v0.1.18 used to leave `qmanager-sms-forward` in `failed (Result: timeout)`: the old daemon did not exit on SIGTERM, so the stop ran into the 90 s default timeout (seen on the RG501Q-EU, 2026-10-29). Fixed in the installer, which now owns the stop: `stop_services()` runs `systemctl --no-block stop qmanager-sms-forward` (queued first so `Restart=on-failure` cannot respawn it), then `systemctl kill -s KILL qmanager-sms-forward` (the whole cgroup), and after the batched stop `systemctl reset-failed` on the named qmanager units only. `uninstall_rm520n.sh` does the same. Measured on the RM520N-GL (`61368cd2`, 2026-10-31, UI OTA): the unit was `inactive (dead)`, `Result=success`, about 1 s after the stop step began.

---

## Invariants

### Seed-on-first-run, per storage

The first successful list of each storage after the seen-set is created is a **seeding pass**: every message present, complete or not, is recorded as seen and nothing is forwarded. The pass appends a marker line, `#seeded2 ME` or `#seeded2 SM`. On restart the daemon rebuilds its seeded flags from those markers, so it does not seed twice. A storage whose list fails stays unseeded and is seeded on its next good list; for SM that is the next safety pass (`SM_RETRY`) or SM indication, whichever comes first. A message whose indication triggers that seeding pass is recorded, not forwarded.

**Why:** without this, enabling forwarding on a modem that already holds 150 messages would immediately send all of them to the target.

**A seen-set without `#seeded2` markers is re-seeded, never forwarded.** The marker changed when group ids gained their 24 h window; a seen-set written by an older daemon has no `#seeded2` lines, so both storages seed again rather than treat every group as new.

> ⚠️ WARNING: a multi-part message caught mid-arrival by a seeding pass is never forwarded. Its group is marked seen with the parts present, and the later parts match the same group id.

> ℹ️ NOTE: The seen-set lives in `/tmp` (tmpfs), so it survives a service restart but is wiped on reboot or OTA, causing a fresh seed. On exit the daemon removes its PID file, the event FIFO and scratch files; the seen-set, the pending file and the failures file stay.

### Multi-part groups

Concatenated parts are merged per storage by `SF_MERGE_JQ`. A group's key is `storage|sender|reference|total`; its seen-set entry is `g <fp> <epoch>`, where `fp` is the djb2 of the key and `epoch` is the earliest part's timestamp (`MM/DD/YY HH:MM:SS` parsed with `strptime`, `0` if unparseable). A `g` entry matches when the fingerprint is equal and the epochs are within 24 h of each other.

- **No timestamp in the key, on purpose.** A part that arrives after the group was forwarded — part 1 after a partial of part 2, say — changes the group's earliest timestamp. The 24 h window still matches it, so it is never forwarded again.
- **Reference reuse.** Concat references repeat (an 8-bit reference has only 256 values). Parts of one key more than 24 h apart are split into separate groups before the seen check, so a reference reused days later reads as a new message.
- `reference` is the 16-bit value `qsms` reports; nothing truncates it.

An incomplete group (`parts < total`) is held in the pending file with the uptime at which it was first seen. It is forwarded when all parts are present, or after **600 s** (`GROUP_TIMEOUT`) as a partial with the parts that arrived, logged as `timed out with N/M parts`. Once forwarded the group is seen, so a late part neither forwards again nor restarts the timer. The timer uses `/proc/uptime`, not the wall clock, because the clock steps from 1970 shortly after boot.

Single messages keep the plain fingerprint `djb2(storage|sender|timestamp|content)`.

### Loop Guard

Before forwarding, `sf_is_relay()` checks whether the content matches our own relay format `From <number>: <body>` (optional `+`, then digits only, then `: `). A match is marked seen but **not** forwarded.

**Why:** if the target number can itself receive SMS into this modem (a second SIM, a forwarding chain, or forwarding to the modem's own number), the relay would reappear as a new inbox entry and trigger an endless forward loop. The guard cuts it immediately.

### 3-Attempt Abandon, Feature Stays Enabled

A failing send re-checks modem registration before **each** of three attempts (`AT+CREG?` / `AT+CGREG?` via `qcmd`, considered registered on stat `1` home or `5` roaming), waits 5 s between tries, and stops early once a failure reports `sent_parts > 0` (a retry would resend part 1 onward), or `sent_parts` 0 with `ambiguous: true` (part 1 may have been delivered). The one exception: when that failure has `ambiguous: false` and a numeric `concat_ref`, it resumes **once** with `qsms send --ref <concat_ref> --from <sent_parts + 1>` and then stops either way (log `SMS forward: resuming at part N (ref R)`; contract in [`sms.md` > Resuming a multi-part send](sms.md#resuming-a-multi-part-send---ref----from)). On exhaustion it:

1. Appends a record to `/tmp/qmanager_sms_forward_failures.json` (capped at 20; oldest dropped on overflow).
2. Keeps running — a bad send **never** disables forwarding.

**The message is marked seen before the send, not after** (`sf_handle`). Forwarding is therefore at-most-once: a daemon killed mid-send (an OTA's SIGKILL, a crash) never resends the message, in full or in part, when it starts again. After a reboot the seen-set is gone and the reseeding pass records the message without forwarding it, so it is not resent then either. Marking after the send gave at-least-once, and a kill between the send and the mark resent every part.

`last_error` is the last attempt's `qsms` `.detail` (for example `The network rejected the message (cause 21).`), never the raw JSON envelope; `The message could not be sent.` when `qsms` printed nothing usable; `modem not registered` when every attempt was skipped for registration; `The SMS service is not installed.` when `/usr/bin/qsms` is missing. The UI shows it raw, so it must stay plain language.

There is no "paused" state; the daemon is either enabled or disabled.

### djb2 Fingerprint Is Internal-Only

The daemon computes djb2 over raw byte values via BusyBox `awk` (kept inside 32 bits with `% 4294967296` each step so it never overflows awk's double mantissa). The frontend read-state hook uses the same djb2 algorithm but over UTF-16 code units — for ASCII the two agree, for non-ASCII they diverge.

**Why that's safe:** the daemon's seen-set never crosses the wire and is never compared against the frontend's `localStorage` set. All that matters for dedup is a *stable hash for the same message across cycles*, which BusyBox awk delivers. The frontend fingerprints independently for its own read/unread display.

### Phone Number Handling

The daemon strips a single leading `+` from the target before passing it to `qsms send` (same convention as `sms.sh`). The E.164-ish validation (optional `+`, first digit 1–9, 7–15 total digits) is applied in the CGI at save time (only when `enabled=1`) **and** in the daemon each pass before forwarding. A temporarily invalid/empty target makes the daemon idle rather than exit.

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
      "last_error": "The network rejected the message (cause 21)."
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
| `send_test` | — | Reads the target from **config, not the request body**, so the test verifies the actual saved path. Single `qsms send` attempt. Body: `From QManager: SMS forwarding test`. A failure returns `send_failed` with `qsms`'s `.detail` (else `.error`, else `No reply from the SMS service.`). |

Error codes: `invalid_phone`, `missing_action`, `invalid_action`, `send_failed`.

### Reload flag

`save_settings` `touch`es `/tmp/qmanager_sms_forward_reload`. The daemon checks it at the top of each pass, re-reads the config, and removes the flag. A pass waits at most 15 s for an event, so a config change is normally picked up within 15 s even without the restart (longer while a send is retrying).

---

## Frontend Architecture

| Artifact | Path |
|---|---|
| Types | `types/sms-forwarding.ts` |
| Hook | `hooks/use-sms-forwarding.ts` |
| Page | `app/cellular/sms/forwarding/page.tsx` |
| Page shell (lifted hook) | `components/cellular/sms/forwarding/forwarding-center.tsx` |
| Control card | `components/cellular/sms/forwarding/sms-forwarding-card.tsx` |
| Health card | `components/cellular/sms/forwarding/delivery-health-card.tsx` |
| Shape module | `components/cellular/sms/forwarding/shapes.ts` (forwarding only; the SMS Center has no shape module) |

The layout was ported from QManager on the RM551E in commit `e9e6d264` (2026-11): a `CellularPageHeader` over a two-up grid (`CARD_GRID`, `@3xl/main:grid-cols-2`), control card left, health card right, stacking below the step.

### One hook, one poll

`forwarding-center.tsx` owns the single `useSmsForwarding()` call and passes it to both cards as the `fwd` prop, so the two cards share one fetch and one poll and never show a saved change a cycle apart. The hook fetches on mount, then polls **every 20 s silently** (`FAILURE_POLL_MS`), so a delivery failure written by the daemon after its third attempt shows within 20 s without a refresh. Exports: `data`, `isLoading`, `isSaving`, `isSendingTest`, `isClearing`, `error`, `saveSettings`, `sendTest`, `clearFailures`, `refresh`.

`error` describes only a failed foreground read. `saveSettings`, `sendTest` and `clearFailures` return `{ ok: true } | { ok: false, error }` with the reason already translated through `resolveErrorMessage`, and each card toasts that result, never the hook's `error` state.

A failed first read (`!isLoading && !data`) replaces **both** cards with one destructive `ConditionScreen` (`ariaRole="alert"`) carrying a Retry. Each card returns `null` in that state, so the failure is never drawn twice and an unread config is never shown as an unchecked toggle.

**No `aria-live` on the page root.** The poll rebuilds the data object every 20 s, so a root live region would announce in a loop. The health block carries its own `role="status"`, the failure banner `role="alert"`, and the skeletons `sr-only` loading text.

Both cards use `CARD_SHELL`: `rounded-card` (two equal peers, so neither anchors) with `@container/card` declared on the shell.

### Control card (`sms-forwarding-card.tsx`)

On/Off `SegmentedField`, the destination `Input` (mono, `type="tel"`), and a `CardFoot` with Discard and `SaveButton`. Nothing else: status, preview, test and failures belong to the health card. Phone validation runs only while the toggle is On, so turning forwarding off is never blocked by a stale number in the field.

### Health card (`delivery-health-card.tsx`)

Reports **saved** state only; it never reads the control card's unsaved form. One derived state drives the focal block, its detail line and the test gate:

| Health | Condition | Tone (`HEALTH_TONE`) | Glyph (`HEALTH_GLYPH`) |
|---|---|---|---|
| `active` | enabled, target set, no failures | `success` | `check_circle` |
| `issue` | enabled, target set, ≥1 failure | `warning` | `warning` |
| `unconfigured` | enabled, target empty | `primary` | `edit` |
| `off` | disabled | `neutral` | `do_not_disturb_on` |

Tone resolves as `CONDITION_TONE[HEALTH_TONE[health]]`, and `HEALTH_TONE` is declared `satisfies Record<string, ConditionTone>`, so a tone with no matching role fails the build. **All four glyphs must differ:** `success-container` and `warning-container` measure 1.03:1 apart, so the glyph is what separates a healthy relay from a degraded one. The empty-failures row uses `done_all`, not `check_circle`, for the same reason.

Below the state: a preview bubble `From +15550142: <sample body>` (the sender is a sample; the saved number is the recipient), then up to 5 failures in a destructive `TonalBanner` with **Clear alerts** (`clear_failures`), or a quiet "No delivery problems." row. Both branches of that slot pin `HEALTH_HEIGHT.NOTICE` so the paired cards keep their baselines when a failure lands. **Send test** sits in the `CardFoot`, enabled only when forwarding is on and a target is saved; the CGI reads the target from config, so the test checks the saved path, not the form.

> ⚠️ WARNING: the state label key is built by template literal, `` `sms.forwarding.health.state_${health}` ``, so a grep for one literal key does not find all four. Only `unconfigured` has its own description key (`state_unconfigured_description`); `active` and `issue` show the destination line instead, and `off` shows `destination_none`. Do not add the missing description keys.

### i18n

All copy is under `sms.forwarding.*` (`page`, `sms`, `health`, `errors`) in `public/locales/*/cellular.json`, in all five packs. The failure title is a plural pair, `failures_title_one` / `failures_title_other`, interpolating `{{count}}`.

### Open

**`PHONE_REGEX` rejects a valid leading `0`.** `sms-forwarding-card.tsx` validates with `/^\+?[1-9]\d{6,14}$/`, so a local number such as `0917…` fails in the browser, while `sms.sh`'s `normalize_phone()` maps a leading `0` to the SIM's country code ([`sms.md` > Phone Number Normalization](sms.md#phone-number-normalization)). Only the client field is stricter than the pipeline behind it.

> ℹ️ NOTE: the forwarding route has never been visually checked on a device; it needs a live backend to reach its loaded state, and the 2026-11 port commit records no check either.

---

## On-Device Smoke Test

```sh
systemctl status qmanager-sms-forward           # unit state
grep '\[sms_forward:' /tmp/qmanager.log | tail  # daemon log (journald is masked)
cat /etc/qmanager/sms_forwarding.json           # persisted config
cat /tmp/qmanager_sms_forward_seen              # seen-set: <fp>, g <fp> <epoch>, #seeded2 ME|SM
cat /tmp/qmanager_sms_forward_pending           # incomplete groups: <storage> <fp> <uptime>
pgrep -fa 'qsms watch'                          # the wake-up source while forwarding is on
cat /tmp/qmanager_sms_forward_failures.json     # failure records
curl -sS http://127.0.0.1/cgi-bin/quecmanager/cellular/sms_forwarding.sh   # via lighttpd
```

> ⚠️ Validate the CGI through lighttpd or `sudo -u www-data`, never as root. No reboot is ever issued by this feature.

---

## Related

- [`sms.md`](sms.md) — the SMS Center inbox, the `qsms` contract and error mapping, CPMS ME+SM model, client-side read/unread. The daemon here is the only server-side inbox consumer; everything else is client-side.
- [`at-command-transport.md`](at-command-transport.md) — `qcmd` and the shared `/run/qmanager_at/at.lock` flock, used here only by the registration check.
- [`scheduled-timers.md`](scheduled-timers.md) — the 1970 boot window, the reason the group timer runs on uptime.
