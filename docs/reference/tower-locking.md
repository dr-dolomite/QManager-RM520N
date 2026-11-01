# Tower Locking (`/cellular/cell-locking/tower-locking`)

> **Applies to:** RM520N-GL (SDX65) · backend verified 2026-08-23, layout re-ported 2026-11-01
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Tower Locking pins the radio to one specific physical cell — an (EARFCN, PCI) pair on LTE, or a (PCI, ARFCN, SCS, band) tuple on 5G SA — and it is the sharpest instrument in QManager.** Where [Band Locking](band-locking.md) narrows which *frequencies* the modem may use, this page names the *tower*. Get it right and a marginal fixed-wireless install becomes stable; get it wrong and the modem is pinned to a cell it cannot reach, on a device that is serving the very page you are reading. That asymmetry shapes everything below: the failover watcher that releases the lock when signal collapses, Remove Lock staying live in every state, and the honesty about which readings on screen are live and which were read once.

The page layout is a port of RM551E v0.1.34 (2026-11-01, `839b2c14`). The layout port was **frontend-only**: the five CGI scripts under `scripts/www/cgi-bin/quecmanager/tower/`, `qmanager_tower_failover` and `tower_lock_mgr.sh` were unchanged by it, and the NR-SA request body is identical in both trees. RM520N keeps three things RM551E does not have: the match verdict (`matchVerdict`), the `service_enable_failed` / `service_disable_failed` warnings, and the per-read honesty flags. Per-radio "Keep after reboot" followed on 2026-11-01 with a backend change — see [Keep after reboot is per radio](#keep-after-reboot-is-per-radio).

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking/tower-locking` (`app/cellular/cell-locking/tower-locking/page.tsx`) |
| Page coordinator (owns both section shells and headers) | `components/cellular/tower-locking/tower-locking.tsx` |
| Geometry, tone maps, verdict logic | `components/cellular/tower-locking/shapes.ts` |
| One toast per write | `components/cellular/tower-locking/settings-write.ts` (`reportTowerResult`, `writeTowerSettings`) |
| "Right now" body: verdict + carrier tiles | `components/cellular/tower-locking/live-strip.tsx` (`TowerLiveStrip`) |
| Automation body: failover, schedule | `components/cellular/tower-locking/automation-tiles.tsx` (`TowerAutomationTiles`) |
| Per-radio keep-after-reboot (in each leg card's `CardFoot`) | `components/cellular/tower-locking/persist-field.tsx` (`TowerPersistField`) |
| Schedule tile | `components/cellular/tower-locking/schedule-tile.tsx` |
| LTE leg card / NR-SA leg card | `components/cellular/tower-locking/lte-tower-card.tsx` / `nr-sa-tower-card.tsx` |
| Simple-mode helpers (`defaultScsForBand`, `compositeValue`) | `components/cellular/tower-locking/simple-mode-utils.ts` |
| Slider primitive (threshold) | `components/ui/slider.tsx` (wraps `@radix-ui/react-slider`) |
| Data + actions hook | `hooks/use-tower-locking.ts` |
| Types (**shared** — see Known gaps) | `types/tower-locking.ts` (`TowerActionResult`, `TowerWarningCode`, `TowerSettingsChange`) |
| Read lock state | `GET /cgi-bin/quecmanager/tower/status.sh` (3 AT commands) |
| Apply / clear a lock | `POST …/tower/lock.sh` |
| Persist + failover settings | `POST …/tower/settings.sh` — any subset of `{ "persist_lte": true, "persist_nr": false, "failover_enabled": true, "failover_threshold": 20 }`; legacy `"persist"` sets both radios |
| Schedule + timer arm | `POST …/tower/schedule.sh` |
| Failover flags (no modem contact) | `GET …/tower/failover_status.sh` |
| Failover watcher | `scripts/usr/bin/qmanager_tower_failover` |
| Failover systemd unit | `scripts/etc/systemd/system/qmanager-tower-failover.service` |
| Shell library (AT + config CRUD, `tower_write_begin`) | `scripts/usr/lib/qmanager/tower_lock_mgr.sh` |
| Schedule daemon / arm helper (root) | `scripts/usr/bin/qmanager_tower_schedule` / `qmanager_tower_schedule_arm` |
| Per-read honesty flags | `modem_state.lte_read_ok` / `nr_read_ok` / `persist_read_ok` — **absent means `true`**, test `=== false` |
| Write-settle marker | `/tmp/qmanager_tower_write_inflight` (`root:root 0666`, seeded in `qmanager_setup`; holds a future UNIX deadline) |
| Failover activation flag | `/tmp/qmanager_tower_failover` — cleared by the unit's `ExecStartPre`, **not** on stop |
| Config file | `/etc/qmanager/tower_lock.json` |
| Live carriers | `hooks/use-modem-status.ts` → `network.carrier_components` |
| Pick/Type preference (per browser) | `localStorage["qmanager_tower_lte_simple_mode"]`, `localStorage["qmanager_tower_nr_simple_mode"]` |
| i18n | `tower_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (208 leaf keys in `en` at `afc517fe`) |
| Cell Scanner link (header action) | `radio_info.bands.scanner.link` → `/cellular/cell-scanner` |

### AT commands this surface issues

| Operation | Command | Sent by |
| --------- | ------- | ------- |
| Lock LTE (1–3 cells) | `AT+QNWLOCK="common/4g",<n>,<earfcn1>,<pci1>[,…]` | `tower_lock_lte` |
| Clear LTE | `AT+QNWLOCK="common/4g",0` | `tower_unlock_lte` |
| Lock NR-SA | `AT+QNWLOCK="common/5g",<pci>,<arfcn>,<scs>,<band>` | `tower_lock_nr` |
| Clear NR-SA | `AT+QNWLOCK="common/5g",0` | `tower_unlock_nr` |
| Read persistence | `AT+QNWLOCK="save_ctrl"` | `tower_read_persist` |
| Write persistence | `AT+QNWLOCK="save_ctrl",<lte>,<nr>` | `tower_set_persist <lte> [nr]` (`nr` defaults to `lte`) |

`status.sh` issues the three read forms (`common/4g`, `common/5g`, `save_ctrl`) with a `sleep 0.1` between each, the "sip, don't gulp" convention for the shared AT lock (see [at-command-transport.md](at-command-transport.md)).

## Component tree

```
TowerLockingComponent                    ← owns every hook; no child talks to CGI
├── CellularPageHeader                    actions: "Open cell scanner" link, Refresh
├── sr-only aria-live region              announces the refresh
├── ConditionScreen (destructive)         only when status.sh failed (readError)
└── motion cascade
    ├── Card TOWER_HERO   "Right now"     rounded-hero; h2 tower_locking.live.title
    │   └── TowerLiveStrip                body only: verdict row, carrier tiles
    ├── Card TOWER_SECTION  automation    rounded-card; h2 + description
    │   └── TowerAutomationTiles          body only: failover tile, ScheduleTile
    └── grid (1 col → 2 at @3xl/main)
        ├── LteTowerCard                  CardFoot: TowerPersistField (lte), Lock / Remove lock
        └── NrSaTowerCard                 CardFoot: TowerPersistField (nr_sa), Lock / Remove lock
```

Reading order: **what is happening now**, then **what happens unattended**, then **where the lock points**. The coordinator owns both section shells and both `<h2>`s; the children render bodies only, so the two headers' geometry cannot drift. Each section is labelled by `aria-labelledby` pointing at its own heading. Both shells declare `@container/section`, which `AUTO_GRID` queries.

> ⚠️ WARNING: do not re-merge the two sections. A card has one title, and each section's header describes only its own body.

The coordinator reads `useModemStatus` and `useTowerLocking` only. There is no profile/scenario gate here: no SIM Profile or Connection Scenario writes `AT+QNWLOCK`.

The header carries two actions: the Cell Scanner link (`variant="tonal"`, it navigates and does not write) and Refresh (`variant="tonal-neutral"`). Refresh is disabled while any write is in flight (`isLteLocking || isNrLocking || isSavingSettings`), during a refresh, and on first load, because a read mid-write would race the AT lock the write holds. The read-error `ConditionScreen` retry reads the same gate and explains it with `tower_locking.blocked.refresh_writing`.

## Writes report through one toast path (`settings-write.ts`)

Every tower mutation in the hook resolves to a `TowerActionResult`:

```ts
export interface TowerActionResult {
  ok: boolean;
  error?: string;            // already translated via resolveErrorMessage
  warning?: TowerWarningCode;
}

export type TowerWarningCode =
  | "persist_command_failed"
  | "service_enable_failed"
  | "service_disable_failed";
```

`reportTowerResult(t, result, successMessage, fallback)` turns one result into **exactly one toast**: `toast.error` on failure, `toast.warning(t("tower_locking.warning.<code>"))` for a partial success, `toast.success` otherwise. It returns whether the write landed cleanly. The warning keys are a literal `WARNING_KEY` map, because `i18n:check` cannot see an interpolated key.

`writeTowerSettings(t, update, change, successMessage)` is the settings variant used by the automation controls and both per-radio persist fields. It returns whether the setting **landed**: a `persist_command_failed` warning counts as not landed (the modem rejected `save_ctrl`), while a `service_*_failed` warning still counts as landed, because the setting itself was written and only the boot unit did not follow.

This replaced a dismissible page-level warning notice and a `lastWarning` / `clearWarning()` pair in the hook. Both are gone.

### `updateSettings(change)` sends persistence only when asked

```ts
export interface TowerSettingsChange {
  persist_lte?: boolean;
  persist_nr?: boolean;
  persist?: boolean; // both radios; older callers
  failover?: { enabled?: boolean; threshold?: number };
}
```

Failover is always sent whole (the part not changing comes from `configRef.current`). The persist fields are sent **only when given**, so a failover save never touches `save_ctrl` and one radio's write never touches the other:

```json
{ "persist_nr": true, "failover_enabled": false, "failover_threshold": 20 }
```

After a successful response the hook sets `modemState.persist_lte` / `persist_nr` from the response's per-radio values (a `null` keeps the previous value) and `config.persist` from the response's `persist`.

## The two clocks

**Short version: two readings on this page sit inches apart, and one of them can be an hour old.** The lock read-back is fetched on mount, after every write and on Refresh; the carriers on air are live.

| Reading | Source | Freshness |
| ------- | ------ | --------- |
| **The lock target** — the verdict's left operand, the tiles' `MATCH` ring, each leg card's `hasChanges` baseline | `modemState.lte_cells` / `.nr_cell`, read back from `AT+QNWLOCK` by `status.sh` | Fetched on mount, after each write and on Refresh; never polled |
| **Camped on now** — the carrier tiles, the LTE slots' serving dot, the "not in use" outlines | `network.carrier_components` from the poller snapshot | Live, ~4s (see [poller cadence](radio-information.md)) |

> ℹ️ NOTE: the 2026-11 port dropped the "as of HH:MM" freshness stamp and the leg cards' captioned "Modem reports" line. The page no longer prints when the read-back was taken; the header Refresh button is the only remedy for a stale read-back. See [Known gaps](#known-gaps).

The read-back is not on an interval because **it costs three AT commands on the shared `/run/qmanager_at/at.lock` mutex the poller already contends for**. Every poll of `status.sh` is three more serialized round-trips competing with the ~4s status cycle that feeds the entire app. That is a backend cost decision, not a frontend preference.

Three things change the lock **out of band**, so a stale read-back is a real possibility rather than a theoretical one:

1. The **schedule timers** (`qmanager-tower-schedule-apply.timer` / `-clear.timer`) apply or clear the lock at their configured boundaries.
2. The **failover watcher** clears both locks when signal collapses.
3. **A second browser tab** — or another device on the LAN — writing through the same CGI.

`useTowerLocking` therefore exposes `refresh()`, a *quiet* re-read that raises `isRefreshing` rather than `isLoading`. The distinction matters: `isLoading` is the page's first-paint gate, so raising it would drop the entire surface back to skeletons and discard numbers already on screen in response to a single button press.

> ⚠️ WARNING: do not add a poll interval to `status.sh` without accounting for the AT-mutex cost. If a future change genuinely needs live lock state, the right shape is a *poller-side* field (parsed once per status cycle by the daemon that already holds the mutex), not a second client on the same lock.

This is the State-Honesty Rule applied to **staleness** rather than to content: a number that could be an hour old must not sit beside one that is four seconds old with nothing to tell them apart.

## The failover watcher is unbounded — and that is the whole design constraint

`qmanager_tower_failover` reads RSRP from the poller's cached `/tmp/qmanager_status.json` (no AT commands of its own), converts it to a 0–100 quality via `calc_signal_quality`, and clears the locks after `BAD_LIMIT` consecutive readings below the configured threshold.

| Constant | Value | Meaning |
| -------- | ----- | ------- |
| `SETTLE` | 20s | Wait before the first check — the modem drops for 3–5s after a lock |
| `INTERVAL` | 20s | Between checks |
| `BAD_LIMIT` | 3 | Consecutive sub-threshold readings before failover |
| `CONFIG_EVERY` | 6 | Cycles between config re-reads — also the **only** exit check |
| `TOWER_WRITE_SETTLE` | 30s | How long a tower-lock write marks itself in flight, so the watcher skips the reconnect blip. Lives in `tower_lock_mgr.sh`, not the daemon — see [The in-flight marker](#the-in-flight-marker) |

So the fastest path to a failover is `SETTLE + 3 × INTERVAL` ≈ **80 seconds**, and the daemon's main loop is `while true`. It exits in exactly two places: after a failover fires, and when a config re-read (every sixth cycle, ~120s) finds neither `.lte.enabled` nor `.nr_sa.enabled` true.

**Compare Band Locking.** `qmanager_band_failover` is bounded: `SETTLE_DELAY=5`, then `MAX_CHECKS=5 × CHECK_INTERVAL=5` — a ~30-second window that ends on its own and exits early the moment carrier data appears.

That asymmetry has two consequences, one visual and one that was a live bug.

### Why the failover disc is a shield, not a spinner

Band Locking's `FAILOVER_BADGE` maps a running watcher to `info` + a **spinning** `progress_activity`, which is correct there — a spinner describes a bounded operation that genuinely ends. Copied across, that spinner would run for **the entire life of the lock**: hours, days. It would read as a hung UI, and it breaks the One-Loop Rule (a live *process* is not live *work*).

So the tower map (`FAILOVER_BADGE` in `components/cellular/tower-locking/shapes.ts`) has six states, and the running one is a settled `watching`. Since the 2026-11 port the state renders as the failover tile's `shield` disc, filled by `discTone(variant)`, with the state name as its accessible label (`tower_locking.automation.failover_state_*`):

| Order | Condition | Key | Variant / glyph |
| ----- | --------- | --- | --------------- |
| 1 | `!failover.enabled` | `disabled` | `muted` / `do_not_disturb_on` |
| 2 | `failover.activated` | `released` | `warning` / `warning` |
| 3 | `failover.watcher_running` | `watching` | `success` / `shield` |
| 4 | enabled, nothing fired, no watcher, `presence === "present"` | `stalled` | `destructive` / `error` |
| 5 | … `presence === "unknown"` | `unknown` | `muted` / `help` |
| 6 | … `presence === "absent"` | `ready` | `info` / `schedule` |

`failoverKey(failover, presence)` in `shapes.ts` resolves it, and the order is significant. `activated` outranks `watcher_running` because a watcher that has already fired is reporting a release, not protection, even while it keeps looping.

**Rows 4–6 used to be one row.** The signature took a `hasActiveLock` **boolean** and returned the watching state when it was true — a claim that a watcher is watching, made in the one case where the config says a lock exists and no watcher is running. That is the reading it must never give, and it is reachable: `qmanager_tower_failover`'s give-up-honestly exit (see [the release is all-or-nothing](#the-failover-watchers-release-is-all-or-nothing)) leaves exactly `enabled && !activated && !watcher_running` with the lock still on.

The boolean was also why `unknown` had nowhere to land. `status.sh` seeds `lte_locked="false"` before it asks the modem anything, so a failed `AT+QNWLOCK` read arrives as `locked:false` — indistinguishable from a genuine "not locked", and the chip promised "nothing to guard" about a modem nobody had managed to ask. The fix is a third value, not a guard:

```ts
export type TowerLockPresence = "present" | "absent" | "unknown";
lockPresence(modemState): TowerLockPresence
```

`lockPresence` resolves it leg by leg: a leg that reports locked **on a successful read** settles it as `present`; failing that, any leg whose read failed makes the whole verdict `unknown`, because an unlocked-and-read leg cannot vouch for its unread sibling; only when both legs were read and neither is locked is the answer honestly `absent`. It tests `=== false`, never `!== true` — see [The `read_ok` contract](#the-read_ok-contract-absent-means-true).

`ready` is the state Band Locking has no equivalent for: **failover is switched on but no lock exists**, so no watcher is running and there is nothing to protect. Calling that "watching" would claim a safety net that is not deployed. It routes to the brand container under the Info-Is-Brand Rule — a standing condition, not a fault.

`stalled` is the only state on this map that routes to `destructive`, because it is the only one describing something that is not *working*: the net should be out and it is not. Its `error` glyph is unused by the other five, for the reason the paragraph below gives.

Every state carries a **distinct** glyph, which here is mandatory rather than tidy: `success-container` and `warning-container` measure ~1.03:1 apart and are the same surface under deuteranopia, so the glyph is the only channel separating "the safety net is watching" from "the safety net has fired and your lock is not in force". `disabled` is `muted`, never `destructive` — it is deliberately off, not broken.

### The bug that asymmetry caused (post-mortem)

**Short version: with signal failover switched on, both lock switches on this page were permanently dead, behind a toast claiming a signal check was in progress that never ended.**

`sendLockRequest` in `hooks/use-tower-locking.ts` used to open with a guard on `failoverState?.watcher_running`:

```ts
// the removed guard
if (body.action === "lock" && failoverState?.watcher_running) {
  setError("Signal quality check is running, please wait");
  return false;
}
```

That line was copied from Band Locking, where it is a reasonable anti-spam guard: the band watcher exits in ~30 seconds, so "wait for the watcher" is a real, short wait a user will sit through.

The tower watcher **never exits while a lock is live**. So the chain was:

1. User enables failover and locks a cell.
2. `lock.sh` spawns `qmanager_tower_failover`, which loops forever.
3. `watcher_running` is now permanently `true` in every `status.sh` and `failover_status.sh` response.
4. Every subsequent `action: "lock"` — on *either* leg, LTE or NR — short-circuits before touching the network.
5. The user sees a toast reading "Signal quality check is running, please wait." It is never followed by anything.

The only escape was to unlock (which passed the guard, since it only gated `action === "lock"`) or to turn failover off, neither of which the message suggested.

**The fix** replaces the condition with `lockInFlightRef.current` — a `useRef` set at the top of `sendLockRequest` and cleared in its `finally`:

```ts
if (body.action === "lock" && lockInFlightRef.current) {
  return { ok: false, error: t(`${K}.in_flight`) };
}
```

Three notes on the shape of that fix:

- **In-flight is the fact the guard actually wanted.** The real hazard is two concurrent `AT+QNWLOCK` writes, not a background watcher.
- **A ref, not state.** `sendLockRequest` reads it at call time and must not re-create itself — and therefore every `useCallback` downstream — on each flip.
- **Unlock still passes freely.** It is the recovery action, and `lock.sh` stops the watcher *before* sending the AT command, precisely so the 3–5s disconnect from the unlock cannot be misread by the daemon as "no signal".

> ⚠️ WARNING: do not "restore" a `watcher_running` guard here as a tidy-up. It looks like the conservative choice and is the exact opposite. If a future change makes the tower watcher bounded, the guard becomes viable again — and that change must land in `qmanager_tower_failover` first, not in the hook.

### Failover releases BOTH radios

When the watcher fires, it does **not** release only the weak leg:

```sh
tower_unlock_lte      # unconditional
tower_unlock_nr       # unconditional
tower_config_update '.lte.enabled = false | .nr_sa.enabled = false'
```

It has no per-leg RSRP to work from either — it reads `.lte.rsrp` from the poller cache and falls back to `.nr.rsrp`, giving one quality figure for the device, not one per leg.

**That is why the failover control lives in the automation tiles and not on either leg card.** Rendering it as a row inside the LTE card would say it protects LTE; it protects the modem. It sits with the schedule in the one group whose members are exactly the settings that belong to no single leg; keep-after-reboot is per radio, so it moved onto the leg cards. See [The automation section](#the-automation-section).

### Tower unlock silently disables the user's failover preference

`lock.sh`'s unlock branches check whether the *other* leg is still locked. If it is, and failover was on, the watcher is respawned. If it is not:

```sh
tower_config_update '.failover.enabled = false'
svc_disable qmanager_tower_failover
```

So **the last unlock turns the user's failover preference off**, and no subsequent lock turns it back on — `lock.sh`'s lock branches explicitly leave `.failover.enabled` at whatever the config says ("locking does not implicitly enable it"). A user who locks, unlocks, and locks again gets no safety net the second time unless they notice the switch has moved.

The UI is honest about this only because `sendLockRequest` calls `fetchStatus()` after every write, including unlock — the re-read pulls `.failover.enabled = false` back out of the config and the failover tile's switch moves.

> ⚠️ WARNING: a refactor that drops the post-unlock `fetchStatus()` (as an "unnecessary round trip", or in favour of an optimistic update) turns the failover switch into a lie: it would stay ON while the backend has switched it OFF. The re-fetch is the only thing keeping the two in agreement.

Whether the backend behaviour is *right* is a separate question and out of scope for the frontend rebuild. It is recorded in [Known gaps](#known-gaps).

## Read honesty: a failed AT read is not an answer

**Short version: `qcmd` reports failure by exit status and never prints `ERROR` to stdout, so a failed AT command's output is EMPTY — and empty falls through every `case` arm into the success branch.** On this surface that meant six places where a read nobody could complete rendered as a confident answer: a green `Unlocked` chip, a muted `Disabled` persistence chip ("the user turned this off"), a `standby` failover chip, and — worst of the four — a daemon that turned no reading at all into a quality of 0% and cleared both locks over it. All six were fixed together on 2026-08-23.

`$?` is the only signal, and it is fragile: **any** intervening command clobbers it, including a `[` test. Capture it on the very next line.

```sh
lte_state=$(tower_read_lte_lock)
lte_rc=$?                          # NOT after the `[ -z ... ]` below
```

### The `read_ok` contract: absent means true

`GET /tower/status.sh` now emits three booleans inside `modem_state`:

| Field | Vouches for |
| ----- | ----------- |
| `lte_read_ok` | `AT+QNWLOCK="common/4g"` → `lte_locked`, `lte_cells` |
| `nr_read_ok` | `AT+QNWLOCK="common/5g"` → `nr_locked`, `nr_cell` |
| `persist_read_ok` | `AT+QNWLOCK="save_ctrl"` → `persist_lte`, `persist_nr` |

Three rules, all load-bearing:

1. **`success: true` still means only "the endpoint ran".** The response shape never changes on a failed read — the `*_locked` / `persist_*` fields keep their pre-failure seed value of `false`, so a consumer that reads `lte_locked` without checking `lte_read_ok` sees "unlocked", not an error. The flags exist as separate fields, rather than as a tri-state on the booleans themselves, precisely so the shape is stable.
2. **ABSENT MEANS `true`. Test `=== false`, NEVER `!== true`.** A statically-exported page bundle can outlive the CGI it talks to, so a cached client will meet an un-upgraded `status.sh` that emits none of these. `!== true` would repaint an entire working page as `unknown` the moment the two halves fall out of step. The fields are optional in `TowerModemState` for exactly this reason, and every consumer (`lockPresence`, `TowerPersistField`, `matchVerdict`, both leg cards) is written against `=== false`.
3. **Per-field, not all-or-nothing.** One transient NR read failure must not blind the UI to the two reads that succeeded. `status.sh` deliberately does **not** refuse the whole endpoint on any single failed read; it emits the flags and logs `qlog_error` once with all three return codes.

> ℹ️ NOTE: the flags are emitted with `jq --argjson`, not `--arg`. Via `--arg` they would land as JSON **strings** — and `"false"` is truthy in JavaScript, so every `=== false` test would silently never match and the whole mechanism would be inert while looking correct in the response body.

The jq-failure fallback `printf` at the bottom of `status.sh` emits all three as `false`, which is honest: jq itself failed, so nothing about the modem reads can be vouched for.

Two of the three read helpers also stopped fabricating a sentinel. `tower_read_persist` returned a literal `"0 0"` on failure — a legitimately-parseable "persistence off" — and now returns the string `error` with rc 1, matching its two siblings. And `tower_read_nr_lock` turned a missing `+QNWLOCK:` line into `printf 'unlocked'; return 0`, while its LTE twin returned `error` / rc 1 for the same shape of response.

> ℹ️ NOTE — **settled on live hardware, so nobody re-litigates it.** That NR/LTE asymmetry looked like it might be an empirical accommodation: perhaps `common/5g` legitimately returns nothing on a device with no NR leg. A live probe against an LTE-only device (B28 PCC + B3 SCC, no NR registered at all, SA or NSA) shows `AT+QNWLOCK="common/5g"` returning a full `+QNWLOCK: "common/5g",0` line with rc 0, byte-structurally identical to the `common/4g` reply. **The command answers from the modem's stored lock configuration, not from live NR registration**, so it does not need an NR leg to exist in order to report on one. The fall-through was therefore unreachable on a healthy read, and the asymmetry was sloppiness. The *locked*-NR parse path below it remains unexercised until an NR cell is actually locked on an SA network — a separate, un-gated code path, and not a reason to add speculative handling.

### Absent RSRP is not a measurement of zero

The highest-value fix in the change, because it could destroy a working lock unprompted.

`qmanager_tower_failover` reads `.lte.rsrp` from the poller cache and falls back to `.nr.rsrp`. When **both** were empty it fell through to `quality=0` — and 0 is always below any threshold, so **three consecutive polls with no RSRP (~60s, e.g. a poller hiccup on an otherwise-reachable modem) cleared BOTH locks** and wrote an event reading *"signal quality 0% below 20% threshold"*: a percentage the daemon invented from absent data, presented to the user as a measurement.

It now skips the cycle, the same treatment the modem-unreachable branch above it already had. `calc_signal_quality`'s rc is checked too, on the same principle — it signals invalid input the way `qcmd` signals failure, with rc != 0 plus a printed `0` that must not be mistaken for a measured zero.

> ⚠️ WARNING: **no reading and a bad reading are different facts, and only one of them is evidence.** Any future consumer of the poller cache on a path that can *act* has to make the same distinction. A skipped cycle costs 20 seconds; a fabricated zero costs the user their lock.

### The in-flight marker

**Short version: a lock you just applied could be silently reverted about 20 seconds later by a failover watcher it never coordinated with, and the UI would report success before the revert happened.**

The watcher clears both locks after `BAD_LIMIT` consecutive sub-threshold readings. A lock or unlock write bounces the modem for a few seconds, so a watcher already sitting at `bad=2` — from the *previous* lock — would take the reconnect blip as its third bad reading and clear the brand-new lock. The UI's post-write `fetchStatus()` lands at about +5s, well before that, and reports the lock as applied.

**The first fix attempt was rejected**, and the reason is worth keeping: stopping the watcher before the AT write created four error-exit paths on which the write could fail *after* the stop, leaving a dead watcher with `.failover.enabled` still `true` in config. That trades a 20-second revert for an indefinite, invisible loss of the safety net — strictly worse.

What shipped instead is a marker the *writer* sets and the *watcher* consults:

```sh
# tower_lock_mgr.sh — called immediately before every tower-lock AT write
TOWER_WRITE_INFLIGHT="/tmp/qmanager_tower_write_inflight"
TOWER_WRITE_SETTLE=30
tower_write_begin() {
    printf '%s' "$(( $(date +%s) + TOWER_WRITE_SETTLE ))" > "$TOWER_WRITE_INFLIGHT"
}
```

Four properties, each deliberate:

**It holds a future deadline, not a boolean.** A `lock.sh` killed mid-write — crash, OOM, lighttpd recycling the CGI — cannot wedge the watcher into skipping forever; the marker simply goes stale. **There is no matching `tower_write_end`, and none should be added**: a `trap … rm -f` cleanup would reintroduce exactly the must-not-leak fragility this shape avoids (and www-data cannot unlink it anyway).

**`TOWER_WRITE_SETTLE=30` is load-bearing for three independent reasons.** Retuning it down means re-deriving all three, and a too-small value fails *silently* and only about half the time:

| Must exceed | Value | Because |
| ----------- | ----- | ------- |
| the daemon's `INTERVAL` | 20s | The marker is checked once per cycle. At `SETTLE <= INTERVAL`, whether the daemon ever sees it before it expires is a coin flip on write timing — a write landing in the second half of a cycle expires unseen. This was a real bug at `SETTLE=10` |
| the attach-cycle link drop | ~4s | The physical event being guarded — the same one the daemon's own `SETTLE=20` estimates |
| the poller cadence | ~3.7-4.0s | The daemon reads the **cache** (`/tmp/qmanager_status.json`), not live signal, so a bad sample taken during the blip sits in that cache for at least one more poller cycle **after** the blip ends. The guard must outlast blip + cadence. (The cadence is ~4s, not 2s: the poller's `sleep 2` runs *after* the cycle body — see [radio-information.md](radio-information.md)) |

**The daemon resets `bad=0` when it skips**, and this is not leniency. `bad` counts *consecutive readings against one lock target*, and a write **replaces** the target — every sample taken before it was measuring a cell the user has just abandoned. Carrying the count across the write would let a watcher at `bad=2` need only one more bad reading after the marker expires to clear the new lock: the original defect, reproduced one cycle later instead of prevented.

**All four write paths mark themselves**: both lock branches and both unlock branches in `tower/lock.sh`, and both the apply and clear branches of `qmanager_tower_schedule`. The schedule's **clear** branch is the most exposed of them, because it deliberately leaves `.lte.enabled` / `.nr_sa.enabled` `true` in config — so a running watcher keeps sampling against a modem that was just unlocked underneath it, and without the marker the schedule could trigger a failover that permanently disables the very lock it manages.

> ℹ️ NOTE — **the 1970 boot window, deliberately not handled further.** The RM520N has no battery RTC and boots at Jan 1970; `ql_time_daemon` steps the clock ~24s in. If that step lands between `tower_write_begin`'s `date +%s` and the daemon's check, `now` jumps decades past a deadline computed pre-step and the marker stops matching — the skip is lost for that one write. This fails **open** (a normal read, not a wedged-shut watcher), and the `bad=0` reset is what makes it survivable. Switching to `/proc/uptime` for a 30-second window against a once-per-boot event is not worth it. See [scheduled-timers.md](scheduled-timers.md).

The file is seeded `root:root 0666` in `qmanager_setup` because **both UIDs write it** — www-data from `tower/lock.sh` under lighttpd, root from `qmanager_tower_schedule`. It is content-bearing (a parsed timestamp), not an existence-only flag, so the "do not seed a flag" exception does not apply. Without the seed, whichever UID called `tower_write_begin()` first after a boot would own it for the whole uptime and the other's writes would be refused — silently, since the write redirects stderr to `/dev/null`. See [tmp-file-ownership.md](tmp-file-ownership.md#the-tower-lock-in-flight-marker).

### The activation flag lifecycle

`/tmp/qmanager_tower_failover` is the trace that a failover **has fired**. It is what makes the `released` state reachable, and until 2026-08-23 it was unreachable, because two pieces of the system encoded opposite intentions and the wrong one won:

- the daemon writes the flag on activation and then exits 0, and its own `EXIT` trap **deliberately spares** the flag so the trace outlives the process;
- the systemd unit's `ExecStopPost` deleted it on **every** exit — including that `exit 0`, milliseconds after it was written.

So `activated` was true for a window no poll could ever land in, and `failoverKey`'s `activated` branch had never once rendered.

The delete moved to `ExecStartPre`. `ExecStopPost` now removes only the PID file. The flag's meaning is therefore precise: **a failover has fired since the watcher last started.**

```ini
ExecStartPre=-/bin/sh -c 'rm -f /tmp/qmanager_tower_failover'
ExecStart=/usr/bin/qmanager_tower_failover
ExecStopPost=/bin/sh -c 'rm -f /tmp/qmanager_tower_failover.pid'
```

That lifetime is what the chip's copy has to match, and it does: *"Released — weak signal"* is a past-tense report of an event, not a claim about a condition still in progress. It is self-consistent with the state it implies, too — the lock is gone, so there is nothing left to guard and `watching` would be a lie.

Two consequences:

- **`tower/lock.sh` no longer tries to `rm` the flag on its unlock branches.** Those two lines were dead: the CGI runs as `www-data`, the flag is root-owned, and `/tmp` is sticky — so `unlink` returns EPERM, and `rm -f` exits 0 regardless, making the failure invisible. Leaving a fired failover's flag in place until the next watcher start is now deliberate.
- **The daemon's give-up-honestly exit does not write the flag.** See [the release is all-or-nothing](#the-failover-watchers-release-is-all-or-nothing) — with the flag now surviving the daemon's exit, writing `activated` for an unlock that never confirmed would leave that lie in place indefinitely.

> ℹ️ NOTE: **no installer change was needed.** `install_rm520n.sh:1202` glob-installs every `qmanager*.service` unconditionally on every install and every OTA run, so a unit-file edit ships with the next update on its own.

## Keep after reboot is per radio

**Short version: each leg card's footer holds that radio's "Keep after reboot" (`TowerPersistField`), shows what the modem reads back, and writes on change.** `AT+QNWLOCK=?` on the RM520N-GL lists `"save_ctrl",(0,1),(0,1)`: the two slots are independent, so `1,0` is a valid setting, not a fault.

`save_ctrl` still takes both slots in one command, so `settings.sh` reads the live pair first (`tower_read_persist`) and rewrites only the radio that was asked:

| Request | Write |
| ------- | ----- |
| `persist_lte` and/or `persist_nr` | `save_ctrl,<want_lte>,<want_nr>`, the untouched radio at its read value |
| legacy `persist` | both radios to that value; `persist_lte` / `persist_nr` in the same body override it |
| values equal to the read | no AT write |
| read fails | **no write**, `persist_command_failed`; the untouched radio is never guessed |

Proven on the RM520N-GL 2026-11-01 (as `www-data`): `persist_lte:true` read back `1,0`, a repeat sent no write, `persist_nr:true` gave `1,1`, legacy `persist:false` gave `0,0`.

The response carries `persist_lte` / `persist_nr` (each radio after the call; `null` when persistence was not asked or could not be read). `config.persist` now means "both radios on"; nothing reads it for display.

`TowerPersistField` renders from `modemState.persist_lte` / `persist_nr`, never the config. When `persist_read_ok === false` or there is no read yet, **neither option is selected** and the control is disabled: an unread value must not render as "Off" (the old `unknown` chip existed for the same reason; see [The `read_ok` contract](#the-read_ok-contract-absent-means-true)). It is also disabled while that card's lock write or any settings write is in flight. The toast names the radio (`tower_locking.toast.persist_enabled` / `persist_disabled`).

> ℹ️ NOTE: an older page bundle always sends `persist` with every failover save. Against the new `settings.sh`, a device set to `1,0` would be rewritten to `0,0` by such a save. Page and CGI ship together in one OTA, so this needs a stale cached bundle.

The old modem-wide tile, its `split` chip and `persistPosture` / `PERSIST_BADGE` were removed with this change. The `tower_locking.live.persist_*` locale keys are now unused (catalogs are add-only).

## Three backend honesty flags are now surfaced

The first two were already being emitted by the shell and thrown away by the client; one was not even declared in the response type, so nothing *could* read it. The third was added on 2026-08-23 together with the envelope change that produces it.

| Code | Emitted by | Means |
| ---- | ---------- | ----- |
| `service_enable_failed` | `lock.sh` (both lock branches, from `tower_spawn_failover_watcher` rc 2), `settings.sh` | The lock/watcher is **live now** but `svc_enable` failed — it will **not** survive a reboot. Most often a rootfs stuck read-only (see the mount-mode contract in `docs/BACKEND.md` §2.1) |
| `service_disable_failed` | `lock.sh` (both **unlock** branches, `:223` / `:351`), `settings.sh` | The unlock **landed on the modem**, but `svc_disable` failed — the failover/persistence unit is still armed on boot and will re-arm at the next one |
| `persist_command_failed` | `settings.sh` | The config was written, but the modem **rejected** the `save_ctrl` AT write — "Keep lock after reboot" did not take |

**`service_disable_failed` arrived with an envelope change, and the two halves are one change.** Those unlock branches used to answer `cgi_error` — i.e. `success: false` — for an operation whose AT write had already **succeeded**, laundering a confirmed unlock into an apparent failure. They now answer `{"success":true, …, "service_disable_failed":true}`, which is the honest envelope. But an honest envelope only reports honestly if something **reads** the field: `success: true` plus a field nobody consumes is strictly *worse* than the misleading error it replaced, because the user is told the unlock worked while the unit re-arms at the next boot in complete silence. Declaring it and consuming it must never be split across two changes.

> ⚠️ WARNING: the hook's warning chain is an `else if` ladder, and `service_disable_failed` was previously folded into the `service_enable_failed` arm. That put *"the lock will not survive a reboot"* on a failure to **disable** — the opposite claim. The two now have their own arms and their own `tower_locking.warning.*` copy.

`tower_spawn_failover_watcher` returns `2` for the "daemon running, boot-persistence lost" case specifically because its *printed* boolean only describes the live daemon; without the distinct return code the lost persistence is invisible to the caller.

The hook returns them as `TowerActionResult.warning` (a `TowerWarningCode`, see [Writes report through one toast path](#writes-report-through-one-toast-path-settings-writets)). The order of precedence is `persist_command_failed`, then `service_enable_failed`, then `service_disable_failed`.

It returns **the code, not a sentence**, so a warning can never ship as an English literal from a hook. `reportTowerResult` maps the code to `tower_locking.warning.<code>` through a literal key map and shows it as `toast.warning`, **in place of** the success toast.

**All three are warnings, never errors.** The operation landed on the modem: the radio *is* locked or unlocked. A red error would tell the user their lock failed when it did not.

## Frequency Locking is hard-gated on tower lock — one-directionally

`scripts/www/cgi-bin/quecmanager/frequency/lock.sh` sources `tower_lock_mgr.sh` and refuses to run while a tower lock is active:

```sh
cgi_error "tower_lock_active" "Cannot use frequency lock while LTE tower lock is active. Disable tower lock first."
# and, for NR:
cgi_error "tower_lock_active" "… This command cannot be used together with AT+QNWLOCK common/5g."
```

`frequency/status.sh` also reports `tower_lock_lte_active` / `tower_lock_nr_active` so that page can explain itself. Those two fields are **tri-state** — `true` / `false` / `null`, where `null` means the tower read failed — and the gate fails **closed** on `null` in both layers, with the machine code `tower_state_unknown`. `frequency/lock.sh` retries the tower read exactly once at 0.1s spacing before refusing, because a single failed AT read is a transient hiccup rather than proof of a lock nobody can see. Until 2026-08-23 that gate failed **open**: the reader's `error` sentinel matched no `case` arm, so an unreadable tower state fell straight through and sent the frequency lock — the stacked-lock path that file's own header warns can crash-dump the modem. See [frequency-locking.md](frequency-locking.md#the-tri-state-tower-lock-contract).

> ℹ️ NOTE: the tri-state is scoped to the **frequency** surface. This page keeps its per-field `*_read_ok` booleans, which answer a different question — *"is this particular read trustworthy?"* rather than *"is a lock active, as far as anyone knows?"*. Both were built independently and merged deliberately; the tri-state won on the frequency side because a `boolean` + sidecar pair fails **open** unless every consumer honours the sidecar, and two of the four there gate on `*_active` alone.

**`tower/lock.sh` has no reciprocal check.** Applying a tower lock while a frequency lock is in force silently clobbers it — the modem takes the `QNWLOCK` write, and the frequency page discovers the change only on its next read. Recorded as a known gap; closing it means a symmetrical guard in `tower/lock.sh` (read `frequency` state, refuse or warn), which is a backend change and was out of scope for a frontend rebuild.

## Two watchers, one incident, contradictory reverts

If a user has **both** band failover and tower failover armed and the signal collapses, two independent daemons respond to the same event with different remedies and different clocks:

| Watcher | Reacts after | Remedy |
| ------- | ------------ | ------ |
| `qmanager_band_failover` | ~30s (5s settle + 5 × 5s) | Restores **all supported bands** |
| `qmanager_tower_failover` | ~80s (20s settle + 3 × 20s) | Clears **both tower locks** |

Neither reads the other's flag file, and neither knows the other exists. In practice the band watcher widens the band list first, then the tower watcher clears the cell pin ~50 seconds later — which happens to be a benign ordering, since both moves are relaxations. But nothing enforces that ordering, and a future change that makes either watcher *re-apply* something rather than relax it would turn this into a genuine fight.

Noted here so the interaction is written down somewhere. Resolving it (a shared recovery claim, in the spirit of the `/tmp/qmanager_recovery_active` protocol in [tmp-file-ownership.md](tmp-file-ownership.md)) is a backend change and out of scope for a frontend rebuild.

### The failover watcher's release is all-or-nothing

When `qmanager_tower_failover` fires, it clears **both** locks and then declares "FAILOVER COMPLETE". Success is now tracked as two flags, `lte_ok` and `nr_ok`, and **both** must be set before that claim is made, in the first attempt and in the retry.

It used to be one shared `ok` flag, set by whichever `case` arm ran last, which is an OR across the two RATs. That meant a failed LTE unlock plus a successful NR unlock reported a complete failover with the LTE lock **still applied**, on the one daemon whose entire purpose is getting the radio out of a lock that killed the connection. The bug was inert only because the surrounding `case "$result" in *ERROR*)` test could never match, so the failure arm never ran and `ok` was forced to 1 regardless. Fixing the detection (`b4d87ef`) would have activated it, which is why the flags were split in the same change.

> ℹ️ NOTE: the generalisable lesson is in the sequencing, not the flag. Repairing a dead check **activates** every branch behind it, so each newly-reachable body has to be read rather than assumed correct. A branch that has never executed has also never been tested.

The retry tail was exactly such a branch, and reading it bore that out. It ran `tower_unlock_lte >/dev/null 2>&1`, discarded the result, then **unconditionally** wrote `.lte.enabled = false | .nr_sa.enabled = false`, wrote the activation flag and logged `FAILOVER COMPLETE (retry)` — whether or not the retry had worked. It now applies the same per-RAT rc check as the first attempt, and when both attempts fail to confirm it takes a **give-up-honestly exit**: it writes neither the activation flag nor the config, appends an `error`-severity event saying the unlock could not be confirmed, and stops.

Two reasons the give-up exit refuses to write:

- **The activation flag now survives the daemon's exit** (see [The activation flag lifecycle](#the-activation-flag-lifecycle)), so an `activated` written for an unlock that never confirmed would tell the UI a failover completed and leave that lie in place indefinitely.
- **Config is not the source of truth for lock state** — `tower/status.sh`'s live AT reads are, and a failed read there now reports `lte_read_ok` / `nr_read_ok` `false` rather than a confident answer. Forcing `enabled = false` would just layer a second unconfirmed guess on top of the first.

That exit is also what makes `failoverKey`'s new `stalled` state reachable: it leaves exactly `enabled && !activated && !watcher_running` with the lock still on.

## The automation section

`TowerAutomationTiles` renders two tiles in `AUTO_GRID` (one column, two at `@xl/section`): signal failover and the schedule. Keep-after-reboot is per radio and lives on the leg cards. Each reports the **saved** state (config) and, where the modem has its own opinion, the **live** state separately.

### Signal failover tile

| Element | Detail |
| ------- | ------ |
| Disc | `shield`, filled with `discTone(FAILOVER_BADGE[failState].variant)`. The disc carries the verdict; its `aria-label` / `title` is the state name (`tower_locking.automation.failover_state_*`). There is no separate chip |
| Help | `HintIcon` with `automation.failover_help` |
| Toggle | `SegmentedField` off/on (`common` `state.off` / `state.on`), `breakpoint="never"`, disabled while `!config \|\| isSavingSettings` |
| Hint | `automation.failover_hint` ("Locking never turns it on") when a lock is present and failover is `disabled` |
| Threshold | Numeric `Input` (0–100, `%` suffix) **plus** a `Slider` on the same value |
| Meter | 20 rising bars (`METER_BARS`) showing live quality, with a notch at the threshold |

**The threshold autosaves.** Each keystroke or slider move restarts a 1500 ms timer (`THRESHOLD_AUTOSAVE_MS`); Enter commits at once. Invalid (not `^\d{1,3}$` or outside 0–100) or unchanged drafts never write. One write runs at a time: a newer draft waits 250 ms and retries while one is in flight. A failed write puts the field back to the saved value unless the user has already moved on.

> ⚠️ WARNING: the threshold controls stay **enabled** during their own autosave (`thresholdDisabled = !config`). Disabling them mid-drag drops the Radix thumb and snaps it back to the last saved value.

The saved-value sync is render-phase and **adopts a new saved value only while the draft is untouched**, so the echo of an earlier commit cannot overwrite a value the user is still dragging. An unread threshold renders an empty field with `automation.threshold_unread`, never a default number.

**The meter is columns, not a track**, so it never reads as a second slider beside the real one. Each column is 5% of quality. `meterBarHeight(i)` rises from 25% to 100%; `meterBarColor(i, lit)` mixes `--primary` from 30% to 100% strength for lit columns and uses `--surface-container-high` for unlit ones; `meterBarLit(i, q)` lights a column once the reading reaches half its 5% band. Quality comes from `rsrpToQualityPercent(activeRsrp)` (`types/tower-locking.ts`), where `activeRsrp` is the NR RSRP on `5G-SA` and the LTE RSRP otherwise. The meter is a focusable `role="img"` with a `Tooltip` naming the value (`automation.quality_value` / `quality_unknown`).

### Schedule tile

`ScheduleTile` applies the lock only inside a daily window. Enabling saves at once and reverts if the backend refuses (for example, no lock target is set). Time and day edits are debounced 800 ms (`SAVE_DEBOUNCE_MS`) and saved only while the schedule is enabled. A save that landed but returned `armed: false` warns instead of claiming success. Config sync is keyed on a value string (`enabled|start|end|days`), so a re-read returning the same schedule never clobbers an edit in progress. Day chips are `DAY_CHIP` + `dayChipFill`, labelled through literal `tower_locking.schedule.day_0`…`day_6` keys. The timer side is in [scheduled-timers.md](scheduled-timers.md).

## The "Right now" section

### The verdict

`matchVerdict(modemState, onAir)` in `shapes.ts` answers the one question neither source answers alone: **is the radio on the cell the modem was told to hold?**

| Condition (in order) | Verdict | `VERDICT_TONE` glyph |
| -------------------- | ------- | -------------------- |
| no `modemState`, or `lte_read_ok === false` or `nr_read_ok === false` | `unknown` | `schedule` |
| no LTE target and no NR target | `unlocked` | `lock_open` |
| locked, but nothing on air | `unverified` | `help` |
| every locked radio has a camped carrier on an exact (channel, PCI) target — LTE needs only one of its three | `on_target` | `check_circle` (success fill) |
| otherwise | `off_target` | `warning` (warning fill) |

`off_target` is `warning`, never `destructive`: the radio is connected, just not where it was told to be. `unlocked` is neutral, not success: with no lock there was no ask. The three neutral verdicts share a fill, so the glyph separates them. The verdict row is `role="status"`; its title is `sr-only` and the body sentence is visible.

### Carrier tiles

One tile per camped `CarrierComponent`, sorted PCC first, then LTE before NR. Each tile shows an identity `Tag` (`lte` / `nr` variant plus `PCC` / `SCC`), the band, the PCI as the headline, and RSRP in ramp ink beside a `MetricBar` (null decided before `signalToProgress`, as on Band Locking). A tile whose (channel, PCI) is a current lock target wears `CARRIER_TILE.MATCH`, a 2px inset `--primary` ring.

**Each tile has a one-click action button** (`CARRIER_TILE.ACTION`, 32px disc with a 44px hit area):

| `TileAction` | When | What the coordinator sends |
| ------------ | ---- | -------------------------- |
| `lock` | Nothing locked on that radio | LTE `lockLte([cell])`; NR `lockNrSa({ pci, arfcn, scs, band })` |
| `add` | LTE already holds a lock | `lockLte([...held, cell])` — the modem takes the list in one command, so no unlock first. A cell already held or saved toasts `toast.cell_exists` and writes nothing |
| `replace` | NR already holds a cell | `lockNrSa(...)` with the new cell |
| `unlock` | This tile is a lock target | LTE: `lockLte(others)`, or `unlockLte()` when it was the last cell; NR: `unlockNrSa()` |

> ⚠️ WARNING: **tile actions write immediately, with no confirmation dialog.** Only the leg cards' Lock and Remove Lock buttons go through an `AlertDialog`. The cell set a tile action sends is built from the **live** `modemState.lte_cells`, never from a leg card's unsaved draft.

A tile's NR lock needs an SCS, and `carrier_components` has none. The coordinator uses `modemData.nr.scs` when the tile is the serving cell (`nr.arfcn` and `nr.pci` match), otherwise `defaultScsForBand(band) ?? 30`.

**Blocked actions say why.** The coordinator builds `canTarget` per leg: NR is blocked on `5G-NSA` (`live.tile_blocked_nsa`) and on `LTE` or an unknown network type (`live.tile_blocked_lte_only`); LTE is blocked when three cells are already held (`live.tile_blocked_slots_full`). An unlock is never blocked. A blocked button keeps its shape, swaps its glyph to `do_not_disturb_on`, sets `aria-disabled` with a no-op click, and puts the reason in its `Tooltip` and `aria-label`. `aria-disabled` rather than `disabled` keeps the tooltip hoverable.

With exactly one carrier on air, a `CAMPED_ABSENT` pill names the radio that is not on air (`live.absent_nr_title` / `absent_lte_title`). It is a note, not a tile, so it never enters the list as a carrier. With none, an empty block shows `live.camped_empty_title` / `_body`.

## The leg cards

Both cards render `TOWER_CARD` in every branch, own their local draft and call back; neither calls CGI. Neither has a header status chip any more: the posture is carried by the footer (which write is offered) and the `CardFoot` status line.

### One write at a time, chosen by state

Both cards compute the same three values:

```ts
const lockedAsSaved = posture === "locked" && !hasChanges;
const showUnlock = posture === "unknown" || lockedAsSaved;
const showLock = !lockedAsSaved;
```

- Fields match the lock the modem holds → only **Remove lock**.
- No lock, or the fields differ from it → only **Lock** (`SaveButton` with a `blockedReason` naming what is missing).
- Lock state unreadable (`*_read_ok === false`) → **both**: Remove lock is harmless when nothing is locked and the way out when something is.

`hasChanges` compares the draft against the **modem read-back** (`modemState.lte_cells` / `nr_cell`), not against the config file. Both writes open an `AlertDialog` before sending. Remove Lock is never gated on the network type: removing a bad lock must survive every state.

`CardFoot` status shows, in priority order: the last write error (`role="alert"`), `card.unread_note` when the lock state was not read, or `card.unused_lte` / `card.unused_nr` when a locked cell is not on air.

### LTE — three slots

Three slot rows (`SLOT_ROW`), each with a channel and a PCI field and a clear button. A half-filled slot is dropped on write, so a warning `NOTICE` (`toast.incomplete`) says so. A slot whose cell is on air shows a pulsing success dot (`SLOT_ROW.DOT_PING`, `animate-live-ping`) and an `sr-only` "serving" word; a slot locked on the modem but not on air wears `SLOT_ROW.UNUSED`, a 2px inset `--warning` ring. Empty slots render `SLOT_ROW.EMPTY` (dashed outline).

The **Pick / Type** `SegmentedField` swaps the channel field for a picker over the carriers on air (deduplicated by `compositeValue(earfcn, pci)`, PCC first, then by RSRP). The PCI stays typed, because a PCI read off a scan must always be enterable. With no carriers on air the control is forced to Type and the reason is printed under it. Pick is the default; only an explicit switch to Type is remembered (`localStorage`, wrapped in `try/catch`).

The draft re-seeds from `config.lte.cells` during render whenever that array changes, so a re-read after a write repaints the slots.

### NR-SA — four value tiles, the gate, and SCS provenance

Four `FIELD_TILE`s in `FIELD_GRID`: channel, PCI, SCS, band. The gate is a **state of the card**, not a dimmer: on `5G-NSA` a warning `NOTICE` explains there is no standalone cell to lock; on `LTE` an info `NOTICE` says there is nothing to pin. Every control except Remove Lock is disabled (`formDisabled = isLocking || gate !== null`), at full contrast.

**SCS is the field most likely to be wrong.** A wrong SCS is accepted by the modem and then never camps. `resolveScs()` records where the value came from (`ScsSource`): `servingcell` when the picked cell is the serving cell and `nr.scs` is known, `band_default` from `defaultScsForBand()` otherwise, `manual` when typed. Only a guess is marked: `band_default` shows `fields.scs_guess`.

`types/tower-locking.ts`'s `SCS_OPTIONS` labels the SCS select; Frequency Locking imports the same constant.

## Geometry and tone (`shapes.ts`)

| Constant | Purpose |
| -------- | ------- |
| `TOWER_HERO` / `TOWER_SECTION` / `TOWER_CARD`, `CARD_PAD`, `SECTION_HEAD` | "Right now" (`rounded-hero`, the one anchor), automation (`rounded-card`), leg card; both sections declare `@container/section` |
| `STRIP_PANEL`, `CARRIER_GRID`, `CARRIER_TILE` | The carrier grid (`@container/panel`, 1 → 2 → 3 columns) and tile slots incl. `ACTION`, `ACTION_IDLE`, `ACTION_ON`, `MATCH` |
| `TowerMatchVerdict`, `VERDICT_ROW`, `VERDICT_TONE`, `matchVerdict` | The verdict |
| `CAMPED_ABSENT` | The lone-radio note |
| `AUTO_GRID`, `AUTO_TILE`, `discTone` | Automation tiles; `discTone(variant)` maps a badge variant to the disc's tonal pair |
| `METER_BARS`, `AUTO_METER`, `meterBarHeight`, `meterBarColor`, `meterBarLit` | The 20-bar quality meter and its threshold notch |
| `DAY_CHIP`, `dayChipFill` | Schedule day chips (44px) |
| `TowerLockPresence`, `lockPresence` | `present` / `absent` / `unknown`; an unread leg never counts as absent |
| `TowerFailoverKey`, `FAILOVER_BADGE`, `failoverKey` | Failover state |
| `CONTROL_ROW`, `FIELD_CONTROL`, `FIELD_LABEL`, `SLOT_ROW`, `FIELD_GRID`, `FIELD_TILE`, `NOTICE`, `NOTICE_TONE` | Leg-card fields and notices |
| `SKELETON_SHAPE` | Loaded geometry restated for skeletons |
| `TowerLeg`, `LEG_KEYS`, `LEG_CARD_ID` | Leg identity, literal i18n keys, card DOM ids (`tower-card-lte`, `tower-card-nr-sa`) |

## Props contracts

### `TowerLiveStripProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `modemState` | `TowerModemState \| null` | The read-back; feeds `matchVerdict` and the `MATCH` ring |
| `carrierComponents` | `CarrierComponent[]` | Live, from `useModemStatus` |
| `canTarget` | `Record<TowerLeg, CanTarget>` | `{ ok, reason }`; `reason` is already translated |
| `busy` | `Record<TowerLeg, boolean>` | A lock write is in flight on that radio; the button spins |
| `isLoading` | `boolean` | First load |
| `onActCarrier` | `(carrier, action: TileAction) => void` | The coordinator writes and toasts |

### `TowerAutomationTilesProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `config` | `TowerLockConfig \| null` | Saved state; `null` disables the controls and blanks the threshold |
| `modemState` | `TowerModemState \| null` | For `lockPresence` |
| `failover` | `TowerFailoverState \| null` | Watcher flags |
| `activeRsrp` | `number \| null` | RSRP of the registered leg |
| `isLoading`, `isSavingSettings` | `boolean` | |
| `onUpdateSettings` | `UpdateTowerSettings` = `(change: TowerSettingsChange) => Promise<TowerActionResult>` | |
| `onScheduleChange` | `(schedule) => Promise<TowerScheduleSaveResult>` | |

### `LteTowerCardProps` / `NrSaTowerCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `config` | `TowerLockConfig \| null` | Seeds the draft |
| `modemState` | `TowerModemState \| null` | Posture and `hasChanges` baseline |
| `carriers` | `CarrierComponent[]` | That radio's carriers only (the coordinator filters by technology) |
| `isLoading`, `isLocking` | `boolean` | |
| `onLock` | LTE `(cells: LteLockCell[]) => Promise<TowerActionResult>`; NR `(cell: NrSaLockCell) => Promise<TowerActionResult>` | |
| `onUnlock` | `() => Promise<TowerActionResult>` | |
| `isSavingSettings` | `boolean` | Disables the persist field during any settings write |
| `onSetPersist` | `(on: boolean) => void` | The coordinator writes that radio and toasts |
| `networkType` (NR only) | `NetworkType` | `""` until the first poll lands |
| `servingNr` (NR only) | `{ arfcn, pci, scs }`, each `number \| null` | SCS provenance |

## Known gaps

- **The automation description still mentions reboot.** `tower_locking.automation.description` ("…across a reboot, in bad signal, and on a timer") predates moving keep-after-reboot onto the leg cards.
- **Carrier-tile actions skip the confirmation dialog** that guards the leg cards' Lock and Remove Lock. A single click on a tile can pin the radio. This is the RM551E v0.1.34 behaviour, ported as is.
- **`tower/lock.sh` has no reciprocal frequency-lock check.** A tower lock silently clobbers a frequency lock. Backend change.
- **Unlock disables the failover preference and locking never re-enables it** — see [above](#tower-unlock-silently-disables-the-users-failover-preference).
- **Two watchers can fire against one incident** with different clocks and no shared claim — see [above](#two-watchers-one-incident-contradictory-reverts).
- **`types/tower-locking.ts` is shared.** `components/cellular/frequency-locking/nr-freq-card.tsx` imports `SCS_OPTIONS` from it.
- **Unreferenced exports.** `qualityLevel()` and `DAY_LABELS` in `types/tower-locking.ts`, and `LEG_BADGE` and `READBACK` in `components/cellular/tower-locking/shapes.ts`, have no consumers at `afc517fe`. `LEG_CARD_ID`'s comment says the carrier tiles scroll to those ids; nothing scrolls to them.
- **The `service_enable_failed` copy names the wrong cause.** `tower_locking.warning.service_enable_failed` says "the modem rejected the save command", but the code fires when `svc_enable` of the boot unit fails, not on an AT rejection. The text predates this port.
- **The read-back is fetched once and can go stale.** The verdict, the `MATCH` rings and every card's `hasChanges` baseline inherit that staleness; a lock cleared out of band keeps reading as held until Refresh. Closing this needs a poller-side field, never a second client on the AT lock.
- **The threshold has no evidence the daemon adopted it.** `qmanager_tower_failover` re-reads `.failover.threshold` every sixth cycle (~120 s), so the notch can lead the running watcher by up to two minutes.
- **`TOWER_WRITE_SETTLE` is derived from three numbers in three files** (`INTERVAL`, the attach-cycle drop, the poller cadence). Nothing links them mechanically.
- **An identical lock cannot be re-applied from a leg card**, so the watcher cannot be re-armed without changing a field.

## Related

- [band-locking.md](band-locking.md) — the sibling page, ported in the same pass; its failover watcher is bounded where this one is not
- [scheduled-timers.md](scheduled-timers.md) — the runtime `OnCalendar` timers, `qmanager_tower_schedule_arm`, the 1970 boot-window guard
- [frequency-locking.md](frequency-locking.md) — the tri-state tower-lock gate on the frequency page
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the source of the carrier tiles
- [radio-information.md](radio-information.md) — the poller cadence behind the live clock
- [at-command-transport.md](at-command-transport.md) — the AT lock that makes polling `status.sh` expensive, and the exit-status failure contract
- [tmp-file-ownership.md](tmp-file-ownership.md) — the flag/PID files and the `root:root 0666` in-flight marker
- [i18n.md](i18n.md) — why keys are never interpolated on this surface
- `DESIGN.md` > Named Rules (Consistent-Layout, Glyph-Disc, Skeleton-Mirror, One-Scale, One-Loop, Field-Step)
