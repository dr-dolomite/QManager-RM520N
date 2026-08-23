# SMS Forwarding (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

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
| Shape module | `components/cellular/sms/shapes.ts` (shared with the parent SMS family — see [`sms.md`](sms.md#the-shape-module-shapests)) |

### Lifted-Hook Two-Card Layout

`forwarding-center.tsx` owns the single `useSmsForwarding()` call and passes the result down as an `fwd` prop to both cards — one fetch/poll loop, one source of truth, so the left (control) and right (health) cards never drift. `useSmsForwarding` fetches on mount, then polls **every 20 s silently** (no spinner, no error-clobber of a working view) so a background delivery failure surfaces without a manual refresh. The daemon polls at 15 s, so the UI lags by at most one cycle. Exports: `data`, `isLoading`, `isSaving`, `isSendingTest`, `isClearing`, `error`, `saveSettings`, `sendTest`, `clearFailures`, `refresh`.

The hook uses `authFetch` (authenticated) — unlike the public Overview endpoints — because forwarding config is privileged.

> ℹ️ NOTE: The three files above were rebuilt on the tonal design system (`DESIGN.md`) by analogy with the approved SMS Center comp. Every load-bearing contract survived the rebuild unchanged: the lifted single-hook shape with one `fwd` prop, the 20 s silent poll, phone validation gated on `isEnabled`, and Send test reading the target from **config** rather than the control input.

**The page root no longer carries `aria-live="polite"`.** The hook re-fetches every 20 s and builds a fresh data object each time, so both card subtrees re-render on every cycle — a live region on the root handed a screen reader an announcement loop with no end. It also contradicted the product's stated channel for save results: `components/ui/save-button.tsx` records that the outcome is announced by the sonner toast every caller already fires, and "an `aria-live` here would double-announce". The states that genuinely need announcing declare it locally — `ConditionScreen` takes `ariaRole="alert"`, the failure banner is `role="alert"`, the loading branches carry `sr-only` strings, and the health block scopes its own `role="status"`.

**The two cards are `rounded-card` (36px), not `rounded-hero`.** DESIGN.md > Shapes: a grid of peer cards takes `card`; the one card that anchors a surface takes `hero`. Two co-equal, height-locked peers in a 2-up grid means **neither** anchors, and giving both the hero radius spends the distinction without buying anything. (The Inbox card on the parent route keeps `rounded-hero` and is correct — it is the single card on its surface.) The shells also declare `@container/card`, which nothing queries yet; without it on the shell the first `@md/card:` a contributor writes inside one of these cards matches nothing at any width and ships as a silently unresponsive layout.

### Control card (`sms-forwarding-card.tsx`)

Enable toggle + destination number + save. No status display, no test button, no failure history — those belong to the health card. Phone validation is gated on `isEnabled`, so turning forwarding **off** is never blocked by a stale/invalid number in the field.

**The error branch widened from `error && !data` to `!data`.** Previously a first fetch that resolved with *no data and no error string* fell through to the form and rendered an unchecked toggle over a blank number field — which **asserts** that forwarding is off when the truth is that the config was never read. Any state without data now takes the error branch.

#### The dark-mode field bug (`FIELD_SHELL`)

The destination field is a **raw `<input>` on `FIELD_SHELL`**, not `components/ui/input.tsx`. This is a real rendering bug that shipped, not a stylistic preference.

`components/ui/input.tsx` ships `dark:bg-input/30`. Tailwind's `dark:` variant compiles to the selector `&:is(.dark *)`, which has CSS **specificity** (0,2,0) — two class-level matches. (Specificity is the browser's tie-breaker when two rules set the same property: the more specific selector wins regardless of source order.) A plain `bg-surface-container` passed at the call site is (0,1,0), so it **loses**. And `tailwind-merge` — the utility `cn()` uses to drop a class that a later class overrides — cannot fold the two, because it only collapses classes in the *same* modifier scope, and `dark:bg-input/30` and `bg-surface-container` are in different ones. So the "override" was never an override: **every forwarding field rendered `input/30` in dark mode instead of the container step.** It looked approximately right, which is exactly why it survived review.

The primitive carries two smaller problems on the same line: `md:text-sm` leaks a **viewport** breakpoint into a container-query surface, and `transition-[color,box-shadow]` has no duration, so it silently inherits Tailwind's off-scale 150ms and can never retune with the system. Handing `FIELD_SHELL` to a raw `<input>` closes all three at once. `settings/shapes.ts` and `tower-locking/shapes.ts` independently document the identical trap.

#### Dirty-row promotion

Dirtiness is now derived **per control** (`enabledDirty`, `phoneDirty`), not once for the card. It was previously a single `isDirty` spent only on `canSave`, so the entire surface-level signal for "you have an uncommitted edit" was a button that stopped being disabled.

Each edited row now promotes to `primary-container` (`ROW_DIRTY`), matching the settings family. A pending edit is the brand **acting** — an action awaiting commit — and is explicitly **not** a status: a dirty row is neither "good" nor "warning", so no functional role may stand in for pendingness.

> ⚠️ WARNING: a promoted row needs an **on-fill spelling for everything inside it**. `shapes.ts` ships `FIELD_SHELL` / `FIELD_SHELL_ON_FILL` and `INLINE_ERROR` / `INLINE_ERROR_ON_FILL` as pairs for exactly this reason, and the card composes a third (`FIELD_HELP_ON_FILL`) from the same two facts. A free-text field is the one control where an edit is *guaranteed* to make its row dirty, so ink that stayed neutral would land on another role's container — one role's ink on another role's surface, the most common way this pattern goes wrong.

### Health card (`delivery-health-card.tsx`)

A single derived health state drives the whole card. The four states differ on **both** tone and glyph:

| Health | Condition | `ConditionTone` | Glyph |
|---|---|---|---|
| `active` | enabled, target set, no failures | `success` | `check_circle` |
| `issue` | enabled, target set, ≥1 failure | `warning` | `warning` |
| `unconfigured` | enabled, target empty | `primary` | `edit` |
| `off` | disabled | `neutral` | `do_not_disturb_on` |

**The tone column is a type, not a class string — and that is the point.** `HEALTH_SPEC` used to carry a `container` and a `disc` class string per state; those four pairs were byte-identical to `condition-screen.tsx`'s own `success` / `warning` / `primary` / `neutral` tones, and three more copies were written inline further down the same file. **Seven verbatim copies of one table in one component.** `condition-screen.tsx` now exports that table as `CONDITION_TONE` (and `ToneSpec`), all seven copies are gone, `HEALTH_SPEC` is a glyph-only map (`HEALTH_GLYPH`), and tone resolves as `CONDITION_TONE[HEALTH_TONE[health]]`.

`HEALTH_TONE` in `shapes.ts` is declared `satisfies Record<string, ConditionTone>`, so a state whose tone has no matching role is a **build failure** rather than a silent one. DESIGN.md is explicit that tone maps key onto the exported types and never onto a class string, because that is the exact shape that let four rival signal-quality maps drift until one of them painted an unread antenna green. The same treatment was applied to the delete-progress steps on the parent route (`DELETE_STEP_TONE`).

Two further things are load-bearing here.

**`unconfigured` moved off `warning` and onto the brand container.** An empty target is not a fault and not a failure — the daemon is enabled and idle, waiting on one field. That is the "reports rather than alarms" role, and DESIGN.md's Info-Is-Brand Rule renders it as `primary-container`. Previously `unconfigured` and `issue` both drew `warning`, *and* `unconfigured` and `off` both read as muted — so the state was ambiguous in two directions at once.

**All four glyphs must differ.** `success-container` and `warning-container` measure **1.03:1** apart — the same surface to the eye, and identical under deuteranopia — so tone alone carries no information here. The glyph is the channel that actually separates a healthy relay from a degraded one; two states in this slot may never share one.

The card also dropped the `bg-success/15`-style opacity washes it used for these fills in favour of real role containers, per the tonal system.

The state drives a focal icon + label + destination row (the single status surface — there is intentionally no duplicate header badge). A static preview bubble `From +15550142: <sample body>` teaches the relay format (the sample sender is a placeholder; the saved number is the *recipient*, not the sender). **Send test** is enabled only when forwarding is on and a target is set — the CGI reads the target from config, so it verifies the real saved path, not whatever is in the control input. Recent delivery failures (up to 5) show in a destructive alert with a Clear button (`clear_failures`); when there are none, a calm "No delivery problems." line shows instead.

> ℹ️ NOTE: The failures block **lost its `AnimatePresence` height animation** and is now rendered conditionally. It animated `height` on both enter and exit, breaking DESIGN.md's Transform-Only Rule and Enter-Only Rule at once. Do not reintroduce it.

#### The failure notice is a `TonalBanner`

The failure block was a hand-rolled re-implementation of `components/ui/tonal-banner.tsx`: it matched the primitive on layout, padding, disc, glyph size, title step and body step, and differed in three ways that were all regressions.

1. It took `rounded-tile` (28px) where the banner role is 20px — so a banner **out-rounded the card it sits on**, which reads as a second card rather than a notice inside one.
2. It had no `animate-banner-in` entrance, so a failure appeared by snapping in.
3. It had **no `break-words`** — which the primitive documents as load-bearing precisely because banners carry raw device strings. `f.last_error` is a daemon error string with no break opportunities, rendered inside a card with `overflow` ancestors, so a long one could push past its own edge.

`TonalBanner` is Material end to end, so there is no icon-boundary cost on a `/cellular/` route. This is its first `/cellular/` consumer: it began pre-auth-only because `/` and `/login/` were the first routes brought under the Icon-Boundary Rule, but that rule now covers the sidebar, `/dashboard`, both pre-auth routes and all of `/cellular/`. **What still scopes it is the mount point, not the route** — inside one card, `TonalBanner`; at page level, `components/ui/banner.tsx`.

Two details worth keeping:

- The wrapper `<div>` around it exists only to pin the slot height. `TonalBanner` takes a `className`, not a `style`, and the floor is `HEALTH_HEIGHT.NOTICE` — a shared constant, not a number retyped as an arbitrary class. **Both branches of that slot carry it now**; only the empty one used to, so one slot was governed by two rules and the paired cards' baselines moved the moment a failure landed.
- The empty twin is **not** a `TonalBanner`. The primitive carries three tones — warning, destructive, info — and no neutral, and a cleared failure log is not a status in any of those roles. That branch mirrors the banner's *box* on `surface-container` instead (`EMPTY_NOTICE`), rather than borrowing a functional role it has not earned.

### i18n

**This route was internationalized for the first time in this change** — it previously had zero `useTranslation` calls and shipped hardcoded English. 45 new keys under `sms.forwarding` were added to `public/locales/en/cellular.json` **only**; the other four locales fall back to English and surface as `i18n:check` warnings rather than as a fake "translated" figure. See [`sms.md` > i18n](sms.md#i18n) for the full accounting of the shared key drop.

The 2026-08-20 conformance pass renamed exactly one placeholder — `sms.forwarding.failures.title_one` / `_other` moved from `{{count}}` to `{{value}}` in all five packs, so the live count could be its own `tabular-nums` element; plural selection still keys on the numeric `count` option, which is passed alongside `value`. Two keys on this surface are built by **template literal** and are invisible to a static scan (`` `sms.forwarding.health.${health}.label` `` / `` `.description` ``), and the missing `.description` on `active` and `issue` is intentional. Details in [`sms.md` > i18n](sms.md#the-2026-08-20-conformance-pass-was-parity-neutral).

> ⚠️ WARNING: **this route has never been visually reviewed.** Static verification passes (`tsc`, `next build`, eslint, `i18n:check`, `icons:check`), and the 2026-08-20 pass visually verified the *parent* SMS Center on a fixture route — but the forwarding surface needs a live backend to reach its loaded state, so it was **not** checked. Treat its layout as mechanism-proven and visually unreviewed until someone loads it on the modem.

### Open: two items deliberately left unfixed

Both were found during the 2026-08-20 conformance pass and scoped out as unrelated to a design change. Neither is subtle once you look for it.

**Ten sites in `hooks/use-sms-forwarding.ts` reach users as hardcoded English.** Four messages — `"Failed to fetch forwarding settings"`, `"Failed to save settings"`, `"Failed to send test message"`, `"Failed to clear alerts"` — are each written at two `setError` sites (the JSON-error branch and the `catch`), and the JSON-error branches additionally pass through `json.detail || json.error`, which is untranslated backend English. That `error` string is then **preferred over the translated fallback** by every consumer: `toast.error(error || t("sms.forwarding.toast.save_error"))` and `description={error ?? t("sms.forwarding.states.error.description")}`. So a non-English operator sees English on **any** backend failure — the fallback only fires when the hook's error is empty. Fixing this means keying the hook's error strings (or returning an error *code* and translating at the call site); the surface's own labels are fully translated.

**`PHONE_REGEX` rejects a valid leading `0`.** `components/cellular/sms/forwarding/sms-forwarding-card.tsx` validates with `/^\+?[1-9]\d{6,14}$/`, so a locally-formatted number such as `0917…` fails client-side validation. That is inconsistent with the rest of the feature: `sms.sh`'s `normalize_phone()` explicitly supports the leading-`0` local format and maps it to a country code via the SIM's MCC (see [`sms.md` > Phone Number Normalization](sms.md#phone-number-normalization)). The daemon-side and CGI-side validation is the E.164-ish rule described above; only the client field is stricter than the pipeline behind it.

### Closed gaps (kept for the record)

Both gaps recorded here are now **closed**, and one of them turned out to be twice the size it was written up as.

- ~~**`SaveButton` hardcodes its transient labels.**~~ **Fixed.** `components/ui/save-button.tsx` now reads `common.actions.saving` / `common.actions.saved` through `useTranslation`. The bigger half was never recorded: **16 of the 18 call sites hardcoded English *idle* labels too**, so an Italian user saw `"Lock Selected Bands"` → `"Salvataggio…"` → `"Salvato!"` → `"Lock Selected Bands"` — the transient states translated and the resting state not. All idle labels are now keyed (new `common.actions` keys `save_settings`, `save_and_apply`, `save_profile`, `update`; new `cellular.band_locking.actions.lock_selected`). This card's own save button is one of the fixed sites. See [`dashboard-state-motion.md`](dashboard-state-motion.md) > Part 3 for the rebuilt button.
- ~~**The shadcn `Checkbox` renders a lucide glyph on Material routes.**~~ **Fixed.** `Checkbox` gained an opt-in `glyph?: MaterialSymbolName` slot; the Material-route call sites pass `glyph="check"`, and `check` was already in the bundled Material subset so it cost zero bytes. See [`icon-system.md`](icon-system.md).

### The 98 keys this rebuild shipped English-only

Worth recording on its own, because a passing gate is what let it through. The SMS tonal rebuild shipped **98 keys English-only** across `it`, `id`, `zh-CN` and `zh-TW`:

| Key group | Keys |
|---|---|
| `sms.forwarding.*` | 45 |
| `sms.inbox.*` | 39 |
| `sms.tiles.*` | 10 |
| `sms.compose.*` | 3 |
| `sms.page.forwarding` | 1 |

`bun run i18n:check` said nothing, because **at the time** it graded a missing key as a warning and exited 0 — English fallback is a deliberate design choice for community packs, and the same leniency was applied to the bundled five, where it is not one. All 98 are now backfilled with real translations; every locale is back at 100% and `i18n:check` reports **0 errors / 0 warnings**, down from 392 warnings.

> ℹ️ NOTE: **this hole is closed.** Since 2026-08-12 `bun run i18n:check` exits **1** on a missing key or an empty value, so the exit code is load-bearing again and the 392-warning state above could not recur silently. If you genuinely need to carry that kind of tracked debt through a run, use `--warn-only` (or `QM_I18N_WARN_ONLY=1`) — that is the sanctioned way to say "I know", and it leaves the default gate strict for everyone else. The contributor-facing CI policy is unchanged and stays lenient on purpose. See [`i18n.md`](i18n.md) > The repo gate.

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
