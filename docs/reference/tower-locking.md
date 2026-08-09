# Tower Locking (`/cellular/cell-locking/tower-locking`)

**Tower Locking pins the radio to one specific physical cell — an (EARFCN, PCI) pair on LTE, or a (PCI, ARFCN, SCS, band) tuple on 5G SA — and it is the sharpest instrument in QManager.** Where [Band Locking](band-locking.md) narrows which *frequencies* the modem may use, this page names the *tower*. Get it right and a marginal fixed-wireless install becomes stable; get it wrong and the modem is pinned to a cell it cannot reach, on a device that is serving the very page you are reading. That asymmetry shapes everything below: the confirmation dialogs on both lock paths, the failover watcher that releases the lock when signal collapses, and the deliberate honesty about *when* the lock state on screen was last read.

The 2026-08 rebuild is **frontend-only**. `hooks/use-tower-locking.ts` gained state and one bug fix but kept its contract; `types/tower-locking.ts` gained two response fields that the backend was already emitting; the five CGI scripts under `scripts/www/cgi-bin/quecmanager/tower/`, `qmanager_tower_failover` and `tower_lock_mgr.sh` are untouched. What changed is the page shape (a read-only hero over three peer cards, replacing a 2×2 grid that treated a status panel and three control surfaces as peers), the input path (the hero's on-air tiles are now the picker), and the copy (0 i18n keys → **154 per locale**, in all five).

This doc records the things a future contributor will otherwise "clean up": why the lock read-back is deliberately *not* polled, why the failover chip is a shield rather than a spinner, why `sendLockRequest`'s guard is an in-flight ref and must never go back to `watcher_running`, and why unlocking quietly turns the user's failover preference off.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking/tower-locking` (`app/cellular/cell-locking/tower-locking/page.tsx`) |
| Page coordinator | `components/cellular/tower-locking/tower-locking.tsx` |
| Geometry + tone contract | `components/cellular/tower-locking/shapes.ts` |
| Read-only hero | `components/cellular/tower-locking/tower-lock-hero.tsx` |
| LTE leg card | `components/cellular/tower-locking/lte-tower-card.tsx` |
| NR-SA leg card | `components/cellular/tower-locking/nr-sa-tower-card.tsx` |
| Schedule card | `components/cellular/tower-locking/schedule-card.tsx` |
| Simple Mode helpers | `components/cellular/tower-locking/simple-mode-utils.ts` |
| Shared `/cellular/` page header | `components/cellular/page-header.tsx` |
| Data + actions hook | `hooks/use-tower-locking.ts` |
| Types (**shared** — see Known gaps) | `types/tower-locking.ts` |
| Read lock state | `GET /cgi-bin/quecmanager/tower/status.sh` (3 AT commands) |
| Apply / clear a lock | `POST …/tower/lock.sh` |
| Persist + failover settings | `POST …/tower/settings.sh` |
| Schedule + timer arm | `POST …/tower/schedule.sh` |
| Failover flags (no modem contact) | `GET …/tower/failover_status.sh` |
| Failover watcher | `scripts/usr/bin/qmanager_tower_failover` |
| Shell library (AT + config CRUD) | `scripts/usr/lib/qmanager/tower_lock_mgr.sh` |
| Schedule timer arm helper (root) | `scripts/usr/bin/qmanager_tower_schedule_arm` |
| Config file | `/etc/qmanager/tower_lock.json` |
| Live carriers (the ACTUAL view) | `hooks/use-modem-status.ts` → `network.carrier_components` |
| i18n | `tower_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**154 keys per locale**, identical key paths across all five) |
| Scroll anchors the rail targets | `id="tower-locking-card-{leg}"` on the LTE and NR wrappers in `tower-locking.tsx` |

### AT commands this surface issues

| Operation | Command | Sent by |
| --------- | ------- | ------- |
| Lock LTE (1–3 cells) | `AT+QNWLOCK="common/4g",<n>,<earfcn1>,<pci1>[,…]` | `tower_lock_lte` |
| Clear LTE | `AT+QNWLOCK="common/4g",0` | `tower_unlock_lte` |
| Lock NR-SA | `AT+QNWLOCK="common/5g",<pci>,<arfcn>,<scs>,<band>` | `tower_lock_nr` |
| Clear NR-SA | `AT+QNWLOCK="common/5g",0` | `tower_unlock_nr` |
| Read persistence | `AT+QNWLOCK="save_ctrl"` | `tower_read_persist` |
| Write persistence | `AT+QNWLOCK="save_ctrl",<v>,<v>` | `tower_set_persist` |

`status.sh` issues the three read forms (`common/4g`, `common/5g`, `save_ctrl`) with a `sleep 0.1` between each — the "sip, don't gulp" convention for the shared AT mutex (see [at-command-transport.md](at-command-transport.md)).

## Component tree

```
TowerLockingComponent                     ← owns every hook; no child talks to CGI
├── CellularPageHeader                     (shared, components/cellular/page-header.tsx)
├── error notice + Retry                   (tower.error && !tower.isLoading)
├── warning notice + dismiss               (tower.lastWarning)
└── motion cascade
    ├── TowerLockHero                      ← read-only: camped-on tiles | lock-posture rail + settings
    └── grid (1 col → 2 at @3xl/main)
        ├── LteTowerCard    id="tower-locking-card-lte"
        ├── NrSaTowerCard   id="tower-locking-card-nr_sa"
        └── ScheduleCard
```

The two `id`s are load-bearing: each leg-card wrapper carries `id={`tower-locking-card-${leg}`}` plus `scroll-mt-20`, because the hero's rail rows call `scrollToLeg()` against them. `scroll-mt-20` is what lands a smooth-scroll *below* the sticky shell header instead of underneath it.

The coordinator is the only component that calls a hook. It reads `useModemStatus` and `useTowerLocking` and hands everything down as props. There is no profile/scenario gate chain here — unlike Band Locking, no SIM profile or Connection Scenario writes `AT+QNWLOCK`.

## The two clocks

**Short version: the two halves of the hero sit inches apart, and one of them can be an hour old.** Pretending otherwise would be the surface's biggest lie, so the rail prints an explicit "as of HH:MM" and a manual refresh instead.

| Panel | Source | Freshness |
| ----- | ------ | --------- |
| **Camped on now** (left) | `network.carrier_components` from the poller snapshot | Live, ~4s (see [poller cadence](radio-information.md)) |
| **Lock posture** (right) | `modemState.lte_cells` / `.nr_cell`, read back from `AT+QNWLOCK` by `status.sh` | Fetched **once on mount**, never polled |

The read-back is not on an interval because **it costs three AT commands on the shared `/tmp/qmanager_at.lock` mutex the poller already contends for**. Every poll of `status.sh` is three more serialized round-trips competing with the ~4s status cycle that feeds the entire app. That is a backend cost decision, not a frontend preference.

Three things change the lock **out of band**, so a stale read-back is a real possibility rather than a theoretical one:

1. The **schedule timers** (`qmanager-tower-schedule-apply.timer` / `-clear.timer`) apply or clear the lock at their configured boundaries.
2. The **failover watcher** clears both locks when signal collapses.
3. **A second browser tab** — or another device on the LAN — writing through the same CGI.

`useTowerLocking` therefore exposes `lastSyncedAt` (`Date.now()` of the last successful full read, `null` before the first one) and `refresh()`, a *quiet* re-read that raises `isRefreshing` rather than `isLoading`. The distinction matters: `isLoading` is the page's first-paint gate, so raising it would drop the entire surface back to skeletons and discard numbers already on screen in response to a single button press.

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

So the fastest path to a failover is `SETTLE + 3 × INTERVAL` ≈ **80 seconds**, and the daemon's main loop is `while true`. It exits in exactly two places: after a failover fires, and when a config re-read (every sixth cycle, ~120s) finds neither `.lte.enabled` nor `.nr_sa.enabled` true.

**Compare Band Locking.** `qmanager_band_failover` is bounded: `SETTLE_DELAY=5`, then `MAX_CHECKS=5 × CHECK_INTERVAL=5` — a ~30-second window that ends on its own and exits early the moment carrier data appears.

That asymmetry has two consequences, one visual and one that was a live bug.

### Why the chip is a shield, not a spinner

Band Locking's `FAILOVER_BADGE` maps a running watcher to `info` + a **spinning** `progress_activity`, which is correct there — a spinner describes a bounded operation that genuinely ends. Copied across, that spinner would run for **the entire life of the lock**: hours, days. It would read as a hung UI, and it breaks the One-Loop Rule (a live *process* is not live *work*).

So the tower map has **four** states, and the running one is a settled `armed`:

| Order | Condition | Key | Variant / glyph |
| ----- | --------- | --- | --------------- |
| 1 | `!failover.enabled` | `disabled` | `muted` / `do_not_disturb_on` |
| 2 | `failover.activated` | `fallback` | `warning` / `warning` |
| 3 | `failover.watcher_running` | `armed` | `success` / `shield` |
| 4 | `hasActiveLock` (enabled, nothing fired, no watcher yet) | `armed` | `success` / `shield` |
| 5 | — | `standby` | `info` / `schedule` |

`failoverKey(failover, hasActiveLock)` in `shapes.ts` resolves it, and the order is significant. `activated` outranks `watcher_running` because a watcher that has already fired is reporting a fallback, not protection, even while it keeps looping.

`standby` is the state Band Locking has no equivalent for: **failover is switched on but no lock exists**, so no watcher is running and there is nothing to protect. Calling that "armed" would claim a safety net that is not deployed. It routes to the brand container under the Info-Is-Brand Rule — a standing condition, not a fault.

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
  setError("Another tower lock operation is still in progress");
  return false;
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

**That is why the failover control lives in the hero rail and not on either leg card.** Rendering it as a row inside the LTE card would say it protects LTE; it protects the modem. It sits with `persist` and `threshold` in the rail's settings block, which is exactly the set of settings that belong to no single leg.

### Tower unlock silently disables the user's failover preference

`lock.sh`'s unlock branches check whether the *other* leg is still locked. If it is, and failover was on, the watcher is respawned. If it is not:

```sh
tower_config_update '.failover.enabled = false'
svc_disable qmanager_tower_failover
```

So **the last unlock turns the user's failover preference off**, and no subsequent lock turns it back on — `lock.sh`'s lock branches explicitly leave `.failover.enabled` at whatever the config says ("locking does not implicitly enable it"). A user who locks, unlocks, and locks again gets no safety net the second time unless they notice the switch has moved.

The UI is honest about this only because `sendLockRequest` calls `fetchStatus()` after every write, including unlock — the re-read pulls `.failover.enabled = false` back out of the config and the rail's switch moves.

> ⚠️ WARNING: a refactor that drops the post-unlock `fetchStatus()` (as an "unnecessary round trip", or in favour of an optimistic update) turns the failover switch into a lie: it would stay ON while the backend has switched it OFF. The re-fetch is the only thing keeping the two in agreement.

Whether the backend behaviour is *right* is a separate question and out of scope for the frontend rebuild. It is recorded in [Known gaps](#known-gaps).

## `persist` is one AT write to both radios, and can read back split

"Keep lock after reboot" writes a **single** value to both slots:

```sh
tower_set_persist()  →  AT+QNWLOCK="save_ctrl",$val,$val
```

But `tower_read_persist` parses the two fields back **independently** (`+QNWLOCK: "save_ctrl",<lte>,<nr>`), and `status.sh` surfaces them as two separate booleans, `persist_lte` and `persist_nr`.

The incumbent UI rendered `config.persist` — the config file's *belief* — and never read either field, so a modem reporting `1,0` displayed as a confident "Enabled".

`persistPosture(modemState)` in `shapes.ts` now derives the chip from the modem's report:

| Modem reports | Posture | Chip |
| ------------- | ------- | ---- |
| both true | `on` | `success` / `check_circle` |
| both false | `off` | `muted` / `do_not_disturb_on` |
| **disagreement** | `split` | `warning` / `warning` |
| no read yet (`modemState === null`) | `unknown` | `muted` / `schedule` |

`split` is a **real, reportable fault**, not a configuration anyone chose: one write went to both slots, so a split reading means one of them did not take. The tooltip swaps to `persist_split_help` in that state so the chip is explained where it is shown.

The row keeps both channels visible on purpose: **the chip reports the modem, the switch drives the config.** They can disagree, and when they do, the `split` chip is the only thing on screen that would tell you.

## Two backend honesty flags are now surfaced

Both were already being emitted by the shell and thrown away by the client. One was not even declared in the response type, so nothing *could* read it.

| Code | Emitted by | Means |
| ---- | ---------- | ----- |
| `service_enable_failed` | `lock.sh` (both lock branches, from `tower_spawn_failover_watcher` rc 2), `settings.sh` | The lock/watcher is **live now** but `svc_enable` failed — it will **not** survive a reboot. Most often a rootfs stuck read-only (see the mount-mode contract in `docs/BACKEND.md` §2.1) |
| `persist_command_failed` | `settings.sh` | The config was written, but the modem **rejected** the `save_ctrl` AT write — "Keep lock after reboot" did not take |

`tower_spawn_failover_watcher` returns `2` for the "daemon running, boot-persistence lost" case specifically because its *printed* boolean only describes the live daemon; without the distinct return code the lost persistence is invisible to the caller.

The hook exposes them as a `TowerWarningCode`:

```ts
export type TowerWarningCode = "service_enable_failed" | "persist_command_failed";
```

It reports **the code, not a sentence** — rendered copy lives in the components, where `useTranslation` is, so a warning can never ship as an English literal from inside a hook that has no namespace. The coordinator maps it to `tower_locking.warning.{code}` and renders a dismissible `role="status"` notice above the hero (`clearWarning()`), and every subsequent write clears it first.

**Both are `warning`, never `destructive`.** The operation landed on the modem — the radio *is* locked. Painting that red would tell the user their lock failed when it did not. `NOTICE_TONE.warning` is the partial-success channel on this surface.

## Frequency Locking is hard-gated on tower lock — one-directionally

`scripts/www/cgi-bin/quecmanager/frequency/lock.sh` sources `tower_lock_mgr.sh` and refuses to run while a tower lock is active:

```sh
cgi_error "tower_lock_active" "Cannot use frequency lock while LTE tower lock is active. Disable tower lock first."
# and, for NR:
cgi_error "tower_lock_active" "… This command cannot be used together with AT+QNWLOCK common/5g."
```

`frequency/status.sh` also reports `tower_lock_lte_active` / `tower_lock_nr_active` so that page can explain itself.

**`tower/lock.sh` has no reciprocal check.** Applying a tower lock while a frequency lock is in force silently clobbers it — the modem takes the `QNWLOCK` write, and the frequency page discovers the change only on its next read. Recorded as a known gap; closing it means a symmetrical guard in `tower/lock.sh` (read `frequency` state, refuse or warn), which is a backend change and was out of scope for a frontend rebuild.

## Two watchers, one incident, contradictory reverts

If a user has **both** band failover and tower failover armed and the signal collapses, two independent daemons respond to the same event with different remedies and different clocks:

| Watcher | Reacts after | Remedy |
| ------- | ------------ | ------ |
| `qmanager_band_failover` | ~30s (5s settle + 5 × 5s) | Restores **all supported bands** |
| `qmanager_tower_failover` | ~80s (20s settle + 3 × 20s) | Clears **both tower locks** |

Neither reads the other's flag file, and neither knows the other exists. In practice the band watcher widens the band list first, then the tower watcher clears the cell pin ~50 seconds later — which happens to be a benign ordering, since both moves are relaxations. But nothing enforces that ordering, and a future change that makes either watcher *re-apply* something rather than relax it would turn this into a genuine fight.

Noted here so the interaction is written down somewhere. Resolving it (a shared recovery claim, in the spirit of the `/tmp/qmanager_recovery_active` protocol in [tmp-file-ownership.md](tmp-file-ownership.md)) is a backend change and out of scope for a frontend rebuild.

## The hero: two panels, one section

`TowerLockHero` absorbs the incumbent "Tower Locking Settings" card, which does not survive as a card — and that is the point. Nine of its twelve rows were **read-only status** and the other three were **settings that apply to both radios at once**. Sitting it in a 2×2 grid beside the two lock forms said it was the same kind of object as them, and it is not: this reports, they change.

```
<section TOWER_HERO>                      rounded-hero (40px) — the ONE hero on this page
  <div HERO_SPLIT>                        flex-col → flex-row at @2xl/hero
    ├── HERO_ONAIR_PANEL   rounded-card   flex-1  — live-dot header, tile grid, footnote
    └── HERO_RAIL_PANEL    rounded-card   25rem   — disc + title + subtitle,
                                                    2 clickable leg rows,
                                                    freshness line,
                                                    persist / failover / threshold rows
```

Both panels are `rounded-card` (36px), **one step below** the outer section's `rounded-hero` (40px). `TOWER_HERO` claims the Consistent-Layout Rule's "a genuine glance surface may earn a hero card" exception on its own; nesting two hero-radius panels inside it would spend that exception twice on one page. The split is a **container** query against `@container/hero`, which `TOWER_HERO` itself declares, so it responds to the hero's own width rather than the viewport.

### The on-air tiles are the picker

Tower locking targets an (EARFCN, PCI) pair. A `CarrierComponent` already carries `earfcn`, `pci`, `band`, `rsrp`, `rsrq` and `sinr` — so **every tile in the grid is describing a cell the user could lock to**, and making them retype those same digits into a text box underneath is the whole reason a parallel "Simple Mode" dropdown had to be invented as a second input path.

Each tile therefore carries a "use this cell" control that fills the matching leg's form (`onPickCarrier` → the prefill bus, below).

#### Why the tile itself is not a button

The tile is painted in an **identity** fill (NR blue / LTE violet), and the Identity-Never-Acts Rule is explicit: *no control is ever tinted by them.* A whole-tile button would be exactly that — a violet control.

So the tile stays a report and the action is a small pill **inside** it, drawn in the tile's own ink via `carrierPillTone(technology, isLead, interactive = true)`. That is the same construction the identity/aggregation pills already use and the established way this codebase puts an element on a saturated identity fill. The affordance lives on the pill, never on the fill.

It reads better as UX too: a tile holding six discrete numbers is ambiguous as a single click target — a reader cannot tell whether the RSRP figure is itself actionable. One labelled control removes the guess.

**A carrier that cannot currently be targeted gets the pill DISABLED with a reason, never a missing pill.** `canTarget` in the coordinator computes the gate per leg:

| Leg | Blocked when | Reason key |
| --- | ------------ | ---------- |
| `lte` | all three slots are full (`lteFreeSlots === 0`) | `tile_blocked_slots_full` |
| `nr_sa` | `networkType === "5G-NSA"` | `tile_blocked_nsa` |
| `nr_sa` | `networkType === "LTE"` or `""` | `tile_blocked_lte_only` |

An NR carrier is visible but not SA-lockable while the modem is in NSA mode; silently dropping the control there would leave the user to infer the rule. The reason renders in a tooltip on the disabled pill.

A tile with no PCI **or** no channel gets no pill at all (`addressable`), because the AT command needs both halves of the pair — there is nothing to disable-with-a-reason, the cell simply is not addressable.

#### PCI is the headline here, where band is the headline on Band Locking

This is the one place the tile deliberately departs from its Band Locking sibling, which is otherwise the same anatomy. On that surface the reader is choosing a **frequency**, so the band designator is the answer. On this one they are choosing a **physical cell**, and PCI is its name. Same anatomy, different value promoted, because the question the surface asks is different.

Tile anatomy, top to bottom:

| Line | Content |
| ---- | ------- |
| Pills | `"LTE PCC"` / `"5G NR SCC"` identity pill (`carrierPillTone`), band designator right-aligned |
| Headline | `PCI` label + the value at `text-2xl`, mono, tabular |
| Detail | `EARFCN`/`ARFCN` + channel, and RSRP — separate flex children with a real gap, each omitted individually when unreported |
| Quality | `RSRQ` and `SINR`, same construction |
| Meter | 5px track, `mt-auto`, fill scaled to `rsrpToPercent(c.rsrp)` |
| Action | The "use this cell" pill (`HERO_ONAIR_TILE.ACTION`) |

**One tile per raw `CarrierComponent`, not per unique cell.** Ordering is `sortCarriers()`: PCC first, then LTE before NR. `Array.prototype.sort` is stable, so carriers of equal rank keep the order the radio reported them in. LTE leads because the LTE leg is the anchor in NSA — it is what a reader looks for when a 5G connection misbehaves.

#### The meter is toned against its tile

`carrierMeterTone(technology, isLead)` returns a `{ track, fill }` pair resolved against **the tile's own ink** — the `on-` token, the one colour guaranteed to contrast with that fill in both themes:

| Tile | Track | Fill |
| ---- | ----- | ---- |
| Lead (`bg-lte` / `bg-primary`) | `*-foreground/25` | `*-foreground` |
| Secondary (`*-container`) | `on-*-container/15` | `*` (strong) |

> ⚠️ WARNING: `isLead` is load-bearing in this signature, and dropping it **was** the bug on the port this contract came from. A lead tile paints `bg-lte`; a fill that also paints `bg-lte` is invisible at 1.00:1 — and the PCC is the one carrier that is always present, so the defect is on screen for every user, in every state, in both themes. A fixed `bg-surface` track makes it worse: correct against a card, but inside a saturated identity fill it is not "recessed", it is a hole punched through the tile.

The alphas are **not** the wash the Solid-Container Rule bans: they resolve over a **known opaque fill** (the tile), not over an unknown page background. And the tone stays **identity, never quality** — the bar reports *which radio*; the dBm label directly above it already reports *how weak*.

`carrierPillTone` uses the same reasoning, with an `interactive` variant that raises the resting alpha and adds a hover step, because the action pill has to read as pressable against five other elements in a dense tile.

> ⚠️ WARNING: every branch of `carrierPillTone` and `carrierMeterTone` is a **complete literal class string**. Tailwind extracts classes by scanning source text, so a name assembled at runtime (`` bg-${ink}/25 ``) is never emitted into the stylesheet and the element renders with no background at all — a failure that type-checks, builds clean, and only shows up on screen.

#### The absent-leg cell and the empty state

`AbsentLegCell` renders **only** when exactly one carrier is on air, filling the grid's second cell rather than leaving it bare, and naming the radio leg that is *not* present (NR when the lone carrier is LTE, and vice versa). With several carriers aggregated the row already fills honestly, and adding a "no 5G" cell there would be an editorial claim that the absence is a fault — on a modem whose SKU may not even support SA, it often is not.

The empty state (`camped_empty_title` / `camped_empty_body`) replaces the whole grid when nothing is camped, so it and the absent-leg cell can never share a frame — which is why both can safely use the `signal_cellular_off` glyph.

The panel header carries a live-pulse dot using **`.animate-live-ping`**, the project's own keyframe in `app/globals.css` (running on `--duration-ambient` / `--ease-ambient`), **not** Tailwind's built-in `animate-ping`. They look similar and time differently; `animate-ping` here is an off-scale duration under The One-Scale Rule. It is `motion-reduce:animate-none`-guarded.

The footer caption (`camped_note`) pre-empts the single most likely misreading: these are the cells the radio reports, not the cells you locked. A locked cell only appears here once the modem camps on it.

### The lock-posture rail

The rail's head is `HERO_RAIL_DISC` — **44px, one step below the product-wide 52px `HERO_DISC`**, because the rail is a nested panel and not the hero's own top-level anchor — beside the `eyebrow` title and a dynamic subtitle derived from the modem read-back:

| Condition | Key |
| --------- | --- |
| No read yet (`modemState === null`) | `rail_subtitle_unknown` |
| Both legs locked | `rail_subtitle_both` |
| LTE only | `rail_subtitle_lte` |
| NR only | `rail_subtitle_nr` |
| Neither | `rail_subtitle_none` |

Below it sit **two clickable rows**, one per `TOWER_LEGS` entry: the leg's short name, its read-back lock target in mono/tabular (`HERO_RAIL_ROW_TARGET` — an EARFCN and a PCI are device identifiers, which the Machine-Voice Rule puts in the machine's typeface), a `LEG_BADGE` status chip, and a `chevron_right`.

`targetLine(leg)` prints the target the **modem** reports, not the form's contents: a single `EARFCN nnn · PCI nn` pair, `rail_target_cells` with a count when LTE has more than one, and `rail_target_none` when the leg is unlocked or nothing was read.

**The chevron is a real affordance.** Clicking a row calls `scrollToLeg(leg)`, a plain `document.getElementById('tower-locking-card-${leg}')?.scrollIntoView({ behavior: "smooth", block: "start" })`. A rail that summarised the two cards without linking to them would be restating what the cards already carry, one layer removed.

> ⚠️ WARNING: the scroll target is looked up by **string-built DOM id**, so nothing mechanical links `scrollToLeg()` in `tower-lock-hero.tsx` to the `id={`tower-locking-card-${leg}`}` in `tower-locking.tsx`. Rename either template and the rows silently stop scrolling — no type error, no lint error, no failed build. The optional chain means a missed match is a no-op rather than a crash, which is the right runtime behaviour and also the reason the breakage would be quiet.

#### The `LEG_BADGE` inversion: `locked` is a warning, `unlocked` is a success

| Posture | Variant | Glyph |
| ------- | ------- | ----- |
| `locked` | `warning` | `lock` |
| `unlocked` | `success` | `lock_open` |
| `unknown` | `muted` | `schedule` |

This reads the **functional contract**, not a value judgement about locking. Pinning the radio to one physical cell is the state that can cost you the connection, so `warning` means *constrained* — not *you did something wrong*. It is the same inversion Band Locking applies to a narrowed band list, for the same reason, and keeping the two consistent is what lets a user cross the three `/cellular/cell-locking/` routes in one task without relearning the colour language.

**`unknown` is a real state, not a loading placeholder.** `status.sh` cannot distinguish a failed `AT+QNWLOCK` read from "not locked": `tower_lock_mgr.sh` prints `error`, `status.sh` logs a warning and leaves the flag `false`. A surface that renders that as a confident "Unlocked" is asserting something nobody read back. So `legPosture()` returns `unknown` whenever `modemState` is null, and the chip says so.

#### Freshness and the settings rows

Under the leg rows sits `HERO_STALENESS` — a `schedule` glyph, the `as of HH:MM` label (or `synced_never`), and `HERO_REFRESH_BUTTON`. The refresh button is a 22px glyph whose `before:` overlay reaches the project's 44px coarse-pointer floor without adding a layout box that would push the timestamp off its baseline. Its spinning state is `motion-reduce`-guarded and mirrored to an `sr-only` `aria-live` region.

Then three `HERO_ROW`s, the settings that belong to no single leg:

| Row | Control | Chip |
| --- | ------- | ---- |
| **Keep lock after reboot** | `Switch` bound to `config.persist` | `PERSIST_BADGE[persistPosture(modemState)]` — the modem's read-back |
| **Signal failover** | `Switch` bound to `failoverState.enabled` | `FAILOVER_BADGE[failoverKey(...)]` |
| **Failover threshold** | numeric `Input` + `SaveButton` (appears only when dirty), with the live quality percentage beneath | — |

The threshold row pairs the number with **the live reading it gates**, because the number only means something next to it — the incumbent put them in two rows four apart. Threshold state is a local string so a half-typed value is never sent, synced from props by render-time adjustment rather than an effect, and validated to 0–100 before the save is offered.

All three rows are `rounded-field` (20px) rather than pills: each carries a label, a help affordance and a control, and on a narrow container those wrap to a second line. A pill that has wrapped to two lines is a stadium, and the Radius-Follows-Size Rule puts a two-line block on the field step.

## The prefill bus

Clicking "use this cell" on a hero tile has to reach a form owned by a **sibling** card, so the coordinator brokers it: `handlePickCarrier` routes the picked `CarrierComponent` to `ltePrefill` or `nrPrefill`, each `{ cell, nonce }`.

**The payload carries a nonce because picking the same cell twice must still register.** Without it, a second click produces an identical object and the receiving card's render-time comparison sees no change — yet re-picking a tile after editing the fields is a meaningful gesture (it restores the tile's values).

The NR path has to source a field the tile does not carry. `carrier_components` has **no SCS**, so:

- If the picked cell **is** the cell the modem is camped on (`nr.arfcn === c.earfcn && nr.pci === c.pci`), the serving-cell SCS is authoritative.
- Otherwise it falls back to `defaultScsForBand(bandNumber)` (FR2 → 120, sub-1 GHz list → 15, else 30), and the card **flags that as a guess**.

The band designator arrives as a string (`"NR5G BAND 41"`, `"N41"`) and is reduced to an integer for the lock command.

## The leg cards

### LTE — three slots

`AT+QNWLOCK="common/4g"` accepts at most three cells, so the card is a fixed three-slot form (`SLOT_COUNT = 3`), each slot an EARFCN + PCI pair.

- **A slot contributes a cell only when BOTH halves parse.** A half-filled slot is silently dropped on write by the backend, so the card renders a warning notice (`toast.incomplete` copy) saying so rather than letting the drop go unremarked.
- **Free-slot count is reported upward** via `onFreeSlotsChange`, because slot occupancy includes local unsaved edits and the coordinator cannot derive it from `config`. That is what lets the hero disable its picker pill with `tile_blocked_slots_full` instead of letting a click land on a card that will silently discard it. It is an **effect**, not a render-time call, because it writes to a parent's state.
- **The empty state is inline, not a branch.** Band Locking can replace its whole content region when a category reports no supported bands; this card cannot, because its empty copy is "pick a cell from the tiles above, or type a channel and PCI" and swapping out the slots would remove the very fields that sentence points at. So "no targets yet" renders *above* the slot list.

#### The render-phase config/prefill sync

Both adjustments run **during render** — React's documented "adjust state when a prop changes" pattern — and both are resolved into a **single** `setSlots` call against a local `base`:

```tsx
let base = slots;
let nextSlots: SlotValue[] | null = null;
if (configCells !== prevCells) { setPrevCells(configCells); base = slotsFromCells(configCells); nextSlots = base; }
if (prefill && prefill.nonce !== prevNonce) { /* fill the first blank slot in `base` */ }
if (nextSlots) setSlots(nextSlots);
```

Two reasons this is one call and not two setters:

1. **Idempotence.** React (StrictMode especially) may re-run a render before committing. Every branch is a pure function of props plus the current `slots`, so running it twice lands on the same value. A functional updater would not: applied twice, a prefill would fill two slots instead of one.
2. **Composition.** If a config poll and a hero prefill land in the same render, the prefill searches the *config-synced* slots, so neither write silently discards the other.

> ⚠️ WARNING: neither block may become a `useEffect`. Both inputs are rebuilt by the parent on every poll, so an effect keyed on them loops. There is a quieter cost too: `eslint-plugin-react-hooks` v7 is compiler-backed and **stops at the first violation in a component**, so introducing one here would suppress every later diagnostic in the file — the mistake would hide its own neighbours.

#### Simple Mode survives the rebuild

The hero's tile picker is what Simple Mode was invented to work around, and for the common case the `prefill` prop replaces it. It stays because it is the only way to fill **slot 2 and slot 3** from the carrier list without leaving the card, and because a user who has scrolled past the hero should not have to scroll back.

It is a per-card, `localStorage`-backed preference (`qmanager_tower_lte_simple_mode`, `qmanager_tower_nr_simple_mode`), read in a **lazy initialiser with a `typeof window` guard** — this component renders during the static export's prerender, and reading storage in an effect instead would flip the switch under the user on first client paint.

It **force-disables itself** when the radio reports no carrier for that technology: a dropdown over an empty list is a dead control that looks like a live one. The `!hasOptions` caption underneath is the only thing that says *why*.

A value the radio is not currently reporting is still a legitimate lock target, so the `SelectTrigger` prints it in italic mono rather than falling back to the placeholder and implying the slot is empty.

### NR-SA — the gate, and SCS provenance

#### The gate is a condition, not a dimmer

The incumbent's answer to "you cannot lock SA right now" was `opacity-60` on the whole `<Card>` plus a sentence appended to the `CardDescription`. That is two failures in one gesture: a banned opacity wash, and — worse — it dimmed **its own explanation** below readable contrast. The one piece of text the user needs in order to act was the text made hardest to read.

The gate now **replaces the card body** with a tonal condition block at full contrast, mirroring `components/cellular/condition-screen.tsx`'s anatomy (disc → title → body) at card scale rather than importing it: that component is `rounded-hero` with 56px of vertical padding, sized to replace a whole page body, and nesting it inside a `rounded-card` leg card would out-round its own host.

| `networkType` | Gate | Tone | Glyph | Why |
| ------------- | ---- | ---- | ----- | --- |
| `"5G-NSA"` | `nsa` | `warning` | `warning` | A real condition the user can change in situ, by switching the modem's network mode. Not a fault — hence not `destructive` |
| `"LTE"` | `lte_only` | `info` | `signal_cellular_off` | A standing fact. There is no NR carrier to pin and nothing on this page changes that; amber would claim something is wrong when nothing is |

The block's body is `surface-container`, **not** the role's container — a deliberate step down from `condition-screen.tsx`. Painting ~170px of `warning-container` in a 2-up grid cell made the gate the loudest object on a page whose actual job is elsewhere. The signal moves to the two channels that survive: the filled disc (Glyph-Disc Rule) and the title, tinted with the role's `-on-surface` token, which DESIGN.md defines for exactly this case.

Neither gate carries a spinner: a spinner on a standing condition advertises work that is not happening.

#### `networkType === ""` is not "capable"

The incumbent gated on `=== "5G-NSA" || === "LTE"` and let every other value through — **including the empty string the poller reports before the modem has answered.** So on a cold load the card rendered fully enabled, with a live Lock button, while nobody yet knew whether SA locking was even possible.

The honest render for "not reported yet" is the loading state, and that is what the branch order now does: `if (isLoading || networkType === "")` returns the skeleton **before** the gate check.

#### SCS provenance is the whole point of this card

An NR-SA lock takes a subcarrier spacing, and **a wrong SCS does not fail loudly** — the modem accepts the command and simply never camps. It is the most common reason a lock "silently doesn't work". Three sources, and the card says which one it used:

| Source | Meaning | Mark |
| ------ | ------- | ---- |
| `servingcell` | Read back from the cell the modem is camped on | `check_circle`, `text-success` |
| `band_default` | Inferred from the band number — a **guess** | `warning`, `text-warning` |
| `manual` | The user typed it | none |

`resolveScs(cell, servingNr)` is pure and takes the whole cell rather than reading component state, so the render-time prefill path and the Simple Mode `onValueChange` path cannot drift apart — they were two separate copies of this rule in the incumbent. It deliberately **ignores** the picked cell's own `scs` (which `prefill` carries) and re-derives, so the provenance label is always true of the number beside it.

The guess is flagged **twice**: beside the field, and again inside the lock confirmation dialog — the last screen before the modem drops its connection, and the last moment the mistake can be caught cheaply. The confirmation's `summarise()` includes SCS for the same reason: omitting it meant the number most likely to be wrong was the number the user never saw.

#### Both cards: the lock dialog is not ceremony

Both legs route their enable switch **and** their footer action through one `requestLock()` → `AlertDialog` path. `AT+QNWLOCK` pins the radio to a single physical cell and bounces the link for 3–5 seconds, on a device that is serving this very page. It stays deliberate.

Status labels are written out per branch (`status_locked` / `status_unlocked` / `status_unknown`) rather than interpolated as `` status_${posture} ``: `i18n:check` grades a missing key as a warning and exits 0, so a key it cannot see statically is a key nothing will ever tell you about (see [i18n.md](i18n.md)).

## The schedule card

`ScheduleCard` writes `config.schedule`, and `schedule.sh` turns it into **two runtime systemd timers** — `qmanager-tower-schedule-apply.timer` and `qmanager-tower-schedule-clear.timer` — via the root helper `qmanager_tower_schedule_arm`. RM520N has **no working crond**; the incumbent's two `/var/spool/cron/crontabs/root` lines were never read by anything. See [scheduled-timers.md](scheduled-timers.md).

Three properties of that backend leak into the card's behaviour and must not be flattened:

**`armed: false` is a real outcome.** The helper deliberately uses a manual symlink into `/lib/systemd/system/timers.target.wants/` rather than `systemctl enable`, and it no-ops successfully if either target `.service` is absent (an OTA-upgraded device predating the feature). So a save can legitimately succeed at the config layer and install no live timer. `TowerScheduleSaveResult` threads `{ success, armed?, reason? }` up to the card, which warns with `arm_warning` + a translated reason (`unit_absent`, else the raw reason). An **absent** `armed` field is treated as "assume armed" for backwards compatibility with an older backend.

**Both timers carry the 1970-boot-window fire guard.** The modem has no battery RTC: every boot starts at Jan 1970, `ql_time_daemon` steps the clock ~24s in, and systemd fires every armed `OnCalendar` timer once on that step. `Persistent=false` does **not** guard this — it only controls the across-reboot stamp file. The guard is worker-side, `_qm_timer_fire_allowed()` in `schedule_timer.sh`. Any new timer on this surface must pass it.

**Three save paths, deliberately different:**

| Path | Behaviour |
| ---- | --------- |
| Enable toggle | Immediate, and **reverts the switch** if the backend refuses. The common refusal is `no_lock_targets` — a real precondition, not an error — which gets its own message; the incumbent hardcoded "No lock targets configured" for *every* failure |
| Time / day edit | 800ms debounce, and **only while enabled** — editing a window on a disabled schedule writes nothing, because there is no timer to re-arm |
| Arm result | `{ success: true, armed: false }` warns — but **only on the ON path**, since disarming is what turning it off means |

Config sync is keyed on a **value string** (`scheduleKey()`), not object identity: `config.schedule` is re-parsed from JSON on every fetch, so an identity comparison re-seeds the form on every poll and wipes whatever the user was mid-way through typing.

The day chips replace the surface's single worst line — a `Toggle variant="outline"` whose pressed state was an arbitrary-child selector painting a dot `bg-blue-500`, a raw Tailwind palette value in an OKLCH-only system and the one colour on the page that was byte-identical in light and dark. They are now real `aria-pressed` buttons on `DAY_CHIP`, with the **fill** carrying selection (`primary-container` — brand, not a functional role, because a chosen day is not a *healthy* day). `size-11` is 44px met by the paint itself rather than by an overlay, because seven sit in a row and overlapping `before:` targets would make the gaps unhittable.

"Enabled with no days selected" can never fire, so the card says so (`no_days`).

## Geometry and tone

Everything shape- or tone-bearing lives in `components/cellular/tower-locking/shapes.ts`, modelled on the band-locking contract and for the same reason: the incumbent restated its card shell in **seven places across four files**, each declaring its skeleton geometry in a different branch from its loaded geometry, so a radius fixed in one branch stayed wrong in the other six.

> ℹ️ NOTE: **restated, not imported.** Several strings here are byte-identical to `band-locking/shapes.ts`. That is the house convention: a surface takes no dependency on a sibling route's module graph, so Band Locking can be re-shaped without silently re-shaping this page. The one thing that must not drift is the carrier tile's tone rule, so those three functions carry the full rationale rather than a pointer to it.

| Constant | Purpose |
| -------- | ------- |
| `TOWER_HERO` | The one hero card, `rounded-hero` (40px), declares `@container/hero`. `shadow-whisper` must go through the custom property — the bare utility does not resolve |
| `TOWER_CARD` | One peer card, `rounded-card` (36px). Imported by the loaded, loading **and** gated branches |
| `CARD_PAD` | 24px on a peer card (the hero's 28px is baked into `TOWER_HERO`) |
| `HERO_SPLIT` | The two-panel layout: `flex-col`, becoming `flex-row items-stretch` at `@2xl/hero` |
| `HERO_ONAIR_PANEL`, `HERO_ONAIR_GRID`, `HERO_ONAIR_TILE`, `HERO_ONAIR_ABSENT` | The left panel. Declares its own `@container/onair`; the grid is a fixed 3-column ceiling, never `auto-fit`; the tile is `rounded-tile` with `PILL` / `ACTION` / `METER_TRACK` / `METER_FILL` slots that carry **no tone of their own** |
| `HERO_RAIL_PANEL`, `HERO_RAIL_DISC`, `HERO_RAIL_TITLE`, `HERO_RAIL_SUBTITLE`, `HERO_RAIL_ROW`, `HERO_RAIL_ROW_LABEL`, `HERO_RAIL_ROW_TARGET` | The right panel. Fixed `25rem` above `@2xl/hero`. `HERO_RAIL_DISC` is 44px — one step below the product-wide 52px `HERO_DISC`, because the rail is nested |
| `HERO_ROW`, `HERO_ROW_LAST` | A settings row; `rounded-field` (20px) because these rows genuinely wrap. `HERO_ROW_LAST` adds `mt-auto` to pin the last one to the rail's floor |
| `HERO_STALENESS`, `HERO_REFRESH_BUTTON`, `HERO_HELP_BUTTON` | The freshness line and its two 22px-glyph/44px-target buttons. `HERO_HELP_BUTTON` is an **alias by value, restated in intent** — the two are the same size by coincidence of the 44px floor, not by shared meaning |
| `carrierTileTone` | `(technology, isLead) => string`. Identity only — LTE violet, NR blue, strong fill for the PCC. Never quality |
| `carrierPillTone` | `(technology, isLead, interactive?) => string`. An alpha over the tile's own ink, resolved against the tile's **known** opaque fill |
| `carrierMeterTone` | `(technology, isLead) => { track, fill }`. **`isLead` is load-bearing** — dropping it makes the bar invisible on every PCC tile |
| `FIELD_GRID`, `FIELD_LABEL`, `FIELD_CONTROL`, `SELECT_CONTROL`, `FIELD_SLOT`, `FIELD_SLOT_HEAD` | The leg cards' form shapes. See the specificity note below |
| `DAY_CHIP`, `dayChipFill` | The weekday toggle. Both hovers are `enabled:`-scoped |
| `NOTICE`, `NOTICE_TONE` | The card- and hero-scoped notice, three roles / three glyphs / no shared marks. `warning` is the partial-success channel |
| `PILL_ACTION`, `PILL_ACTION_PLAIN`, `PILL_QUIET` | Action sizing. `PILL_QUIET` is deliberately smaller and carries **no fill or ink** — pair with `variant="tonal-neutral"`, never `ghost` |
| `FAILOVER_BADGE`, `LEG_BADGE`, `PERSIST_BADGE`, `BADGE_GLYPH_SIZE` | Tone + glyph maps, keyed onto the exported `BadgeVariant` type so an unmapped state fails the build |
| `failoverKey`, `persistPosture` | The two derivations shared across the rail |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by import, not by estimate |
| `TOWER_LEGS`, `TowerLeg`, `legTitleKey`, `legDescriptionKey`, `legShortKey` | Leg identity and its i18n key stems |

### The two field-specificity traps

Both are in `FIELD_CONTROL` / `SELECT_CONTROL`, and both produce a result that *looks approximately right* — which is exactly why they would survive review.

- **`dark:bg-surface-container` is not redundant.** `components/ui/input.tsx` ships `dark:bg-input/30`, and `@custom-variant dark (&:is(.dark *))` compiles that to a `(0,2,0)` selector against a bare `bg-surface-container`'s `(0,1,0)`. `tailwind-merge` cannot fold them either — they sit in different modifier scopes, and it only collapses conflicts within one scope. Without the explicit restatement, every field on this surface silently renders `input/30` in dark mode.
- **A `SelectTrigger`'s height must be restated at matching specificity.** `components/ui/select.tsx` sets `data-[size=default]:h-9` — again `(0,2,0)` via the attribute selector — so a bare `h-[2.625rem]` loses and every select renders 36px beside 42px inputs: visibly combed, and under the project's control-height floor. Hence `data-[size=default]:h-[2.625rem]` in `SELECT_CONTROL`, plus a `dark:hover:` neutralisation for the same reason.

Both leg cards hit these independently and patched them locally before the shared constants existed.

### Rows inside a card are NOT `HERO_ROW`

`CONTROL_ROW` (LTE card) and `CARD_ROW` (NR card) are the same anatomy as `HERO_ROW` but paint `bg-surface-container`, because `HERO_ROW` paints `bg-surface` — correct on the hero's `surface-container` panels, invisible on a card that *is* `bg-surface`. Same shape, one step up the tonal ladder. Reusing `HERO_ROW` in a leg card renders an invisible row.

## Props contracts

### `TowerLockHeroProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `modemState` | `TowerModemState \| null` | The AT read-back. `null` = never read → every posture is `unknown` |
| `failover` | `TowerFailoverState \| null` | `{ enabled, activated, watcher_running }` from flag files |
| `configPersist` | `boolean` | Persist as the **config** believes it — drives the switch. The chip reports the modem instead |
| `failoverThreshold` | `number` | 0–100 |
| `carrierComponents` | `CarrierComponent[]` | The ACTUAL view. Rendered **raw** — one tile per component, sorted but not deduplicated |
| `activeRsrp` | `number \| null` | RSRP of whichever leg the modem is registered on (`5G-SA` → `nr.rsrp`, else `lte.rsrp`) |
| `canTarget` | `Record<TowerLeg, { ok, reasonKey }>` | Per-leg picker gate + the reason to show when blocked |
| `isLoading` / `isRefreshing` / `isSavingFailover` | `boolean` | First paint / quiet re-read / failover write in flight |
| `lastSyncedAt` | `number \| null` | Drives "as of HH:MM" |
| `onPickCarrier` | `(c: CarrierComponent) => void` | Into the prefill bus |
| `onTogglePersist` / `onToggleFailover` | `(enabled: boolean) => Promise<boolean>` | The hero owns its own toasts |
| `onThresholdChange` | `(threshold: number) => Promise<boolean>` | |
| `onRefresh` | `() => void` | |

### `LteTowerCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `config` / `modemState` | `TowerLockConfig \| null` / `TowerModemState \| null` | Config seeds the slots; modem drives the badge |
| `carriers` | `CarrierComponent[]` | Pre-filtered to `technology === "LTE"` **by the caller** |
| `prefill` | `{ cell: LteLockCell; nonce: number } \| null` | Applied to the first **empty** slot; ignored when all three are full |
| `onFreeSlotsChange` | `(free: number) => void` | Includes unsaved local edits — the card must be the one to say this |
| `onLock` / `onUnlock` | `(cells) => Promise<boolean>` / `() => Promise<boolean>` | |
| `isLoading` / `isLocking` | `boolean` | |

### `NrSaTowerCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `carriers` | `CarrierComponent[]` | Pre-filtered to `technology === "NR"` by the caller, so two components cannot disagree about what "an NR carrier" is |
| `networkType` | `NetworkType` | Drives the gate **and** the loading branch — `""` is "not reported yet", never "capable" |
| `servingNr` | `{ arfcn, pci, scs }` | For SCS provenance |
| `prefill` | `{ cell: NrSaLockCell; nonce: number } \| null` | Nonce-keyed; the cell's own `scs` is deliberately re-derived |
| `onLock` / `onUnlock` | `(cell) => Promise<boolean>` / `() => Promise<boolean>` | |

## Card states

All three cards render `TOWER_CARD` + `CARD_PAD` in **every** branch, so the shell cannot drift:

- **Loading** — every measurement from `SKELETON_SHAPE`, so the placeholder mirrors the loaded geometry by import. The incumbent guessed `h-9 w-full rounded-md` for inputs that render at 42px with a 20px radius, and `h-5 w-20` for a Switch-plus-Label pair. Sizes are the loaded element's **line box**, not its font size: a skeleton sized to the glyph reflows the moment real text lands.
- **Gated** (NR only) — the card shell and header survive; the **body** becomes the condition block.
- **Empty** (LTE) — inline, above the slots, never instead of them.
- **Loaded** — header chip, controls, conditional notices, `sr-only` `aria-live` applying announcement, footer pinned with `mt-auto` (these cards sit in an equal-height grid row, so without it a short card leaves its buttons floating above a void).

Page level adds two more, both of which the surface previously lacked entirely:

- **Error** — `tower.error && !tower.isLoading` renders a destructive notice plus a Retry button. Before this, `tower.error` was returned by the hook and passed to nobody, so a `status.sh` that failed all three retries rendered empty defaults as though they were real readings. (`fetchStatus` auto-retries three times with 2s/4s/8s backoff before the notice appears.)
- **Warning** — the dismissible partial-success notice described above.

## Known gaps

- **`tower/lock.sh` has no reciprocal frequency-lock check.** Frequency Locking refuses to run under an active tower lock; a tower lock silently clobbers a frequency lock. Backend change, not attempted here.
- **Unlock disables the failover preference and locking never re-enables it** — see [above](#tower-unlock-silently-disables-the-users-failover-preference). The UI is honest about it only because of the post-unlock `fetchStatus()`. Whether the backend *should* behave this way is unresolved.
- **Two watchers can fire against one incident** with different clocks and no shared claim — see [above](#two-watchers-one-incident-contradictory-reverts).
- **Frequency Locking is deliberately left on the legacy look.** It is self-declared experimental, mutually exclusive with tower locking by backend design, and has **zero i18n keys**. Migrating it would mean adopting a surface that a user can only reach by first turning this one off. This is a recorded scope call, not an oversight — but it does mean `/cellular/cell-locking/` now has two migrated routes and one unmigrated one, and the third will look wrong beside them.
- **`carrierTileTone` / `carrierPillTone` / `carrierMeterTone` now exist in three places** — `components/dashboard/carrier-aggregation.tsx` (as `tileTone()` / `meterFillTone()`), `components/cellular/band-locking/shapes.ts`, and here. The restatement is deliberate per the house convention above, but three copies of one tone rule is past the point where extraction into a shared module (e.g. `lib/carrier-tone.ts`) would be the better trade. The rule that must never drift is *identity, never quality* plus the `isLead` signature.
- **`types/tower-locking.ts` is shared.** `components/cellular/frequency-locking/nr-freq-locking.tsx` imports `SCS_OPTIONS` from it. "Tidying" these types while working on Tower Locking breaks another route, and TypeScript will not tell you until the build.
- **Two exports in `types/tower-locking.ts` are now unreferenced**: `qualityLevel()` and `DAY_LABELS` (the schedule card resolves day names through `tower_locking.schedule.day_{index}` instead, and `DAY_LABELS` here is a duplicate of the identical constant in `types/system-settings.ts`, which *is* used). Harmless dead constants, documented rather than deleted so the duplication is visible if someone reaches for one.
- **The rail's scroll targets are coupled by string, not by type** — same gap Band Locking records, same reasoning for not adding a third indirection for two call sites.
- **The threshold row has no direct evidence the daemon adopted the new value.** `qmanager_tower_failover` re-reads `.failover.threshold` only every sixth cycle (~120s), so a save can be up to two minutes ahead of the running watcher. The UI does not say so.
- **`hasChanges` blocks re-applying an identical NR lock.** Correct for avoiding a pointless modem write, but it also means the failover watcher cannot be re-armed from the NR card without changing a field.

## Related

- [band-locking.md](band-locking.md) — the sibling surface. Same page shape, same tile anatomy, **bounded** failover watcher, and the `CellularPageHeader` migration that covered all three `/cellular/cell-locking/` routes
- [scheduled-timers.md](scheduled-timers.md) — the runtime `OnCalendar` timer model, `qmanager_tower_schedule_arm`, and the 1970 boot-window fire guard every new timer must pass
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the source of the camped-on tiles, and the original identity-tone convention they restate
- [radio-information.md](radio-information.md) — the poller cadence behind the ~4s clock, and the compiler-backed `react-hooks` bail-on-first-violation behaviour
- [at-command-transport.md](at-command-transport.md) — the `/tmp/qmanager_at.lock` mutex that makes polling `status.sh` expensive
- [tmp-file-ownership.md](tmp-file-ownership.md) — the flag/PID files the watcher and `failover_status.sh` share
- [i18n.md](i18n.md) — why `i18n:check` is not a gate, and why keys are never interpolated on this surface
- [icon-system.md](icon-system.md) — `/cellular/` is a Material Symbols route; every glyph used here is already in the subset allowlist
- `DESIGN.md` > Named Rules (Consistent-Layout, Identity-Never-Acts, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror, One-Scale, One-Loop, Solid-Container, Radius-Follows-Size, Machine-Voice)
