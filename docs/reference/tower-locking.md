# Tower Locking (`/cellular/cell-locking/tower-locking`)

**Tower Locking pins the radio to one specific physical cell — an (EARFCN, PCI) pair on LTE, or a (PCI, ARFCN, SCS, band) tuple on 5G SA — and it is the sharpest instrument in QManager.** Where [Band Locking](band-locking.md) narrows which *frequencies* the modem may use, this page names the *tower*. Get it right and a marginal fixed-wireless install becomes stable; get it wrong and the modem is pinned to a cell it cannot reach, on a device that is serving the very page you are reading. That asymmetry shapes everything below: the confirmation dialog in front of every lock and every unlock, the failover watcher that releases the lock when signal collapses, and the deliberate honesty about *when* the lock state on screen was last read.

The 2026-08 rebuild is **frontend-only**. `hooks/use-tower-locking.ts` gained state and one bug fix but kept its contract; `types/tower-locking.ts` gained two response fields that the backend was already emitting; the five CGI scripts under `scripts/www/cgi-bin/quecmanager/tower/`, `qmanager_tower_failover` and `tower_lock_mgr.sh` are untouched. What changed is the page shape, the input path (the camped-on carriers are now the picker), the number of ways to apply a lock (**one**), and the copy (0 i18n keys → **148 per locale**, in all five).

The page shape moved three times, and every move is worth knowing so none of them is undone:

1. **2×2 grid → hero over three peer cards.** The grid put a read-only status card and three control surfaces on the page as visual peers, which said all four were the same kind of object.
2. **Hero → the MATCH LINE, and the three unattended behaviours → one automation card.** The hero still held two facts (the lock target, the camped cells) with nothing between them, so the reader diffed an EARFCN by eye; and it carried three settings rows in a rail while the schedule sat as an orphaned third cell in a 2-up grid beside empty space.
3. **The page inverted: the automation group became the hero, and the match line shrank to a strip above it.** The three unattended behaviours moved from the page's last card to its `rounded-hero` section, the match line's locked-target column was deleted outright, and what remains of it — the verdict and the camped-on carriers — is now a compact **live strip** sitting above the three tiles inside that same section. See [The hero is the standing orders](#the-hero-is-the-standing-orders) and [The live strip](#the-live-strip).

**Short version of that third move: the read-only half of a settings page had become the tallest thing on it, and most of what it printed was already on the leg cards below.** The locked-target column named which leg was locked and to what — the same two facts a leg card's status chip and form fields already carry — so a reader met the same pair of numbers twice before reaching a single control. The one fact it carried *alone* (the modem's own `AT+QNWLOCK` read-back, as against the `config` the forms are seeded from) did not disappear; it moved into the leg card that owns it, inches from the values it can contradict. See [The modem read-back line](#the-modem-read-back-line).

Promoting the automation group is the other half of the same argument. The task order the old layout encoded — see where you are, choose where to point, then decide what happens unattended — describes the **first session only**. After one setup the target rarely moves, while what a returning reader checks every visit is exactly the unattended behaviour: does the lock survive a reboot, is the safety net armed, is the window still right. So that is what leads now, and the two three-field forms sit below it.

This doc records the things a future contributor will otherwise "clean up": why the lock read-back is deliberately *not* polled, why the freshness stamp lives on the verdict, why the failover chip is a shield rather than a spinner, why there is exactly **one** way to apply a lock and no `Switch` anywhere near it, why `sendLockRequest`'s guard is an in-flight ref and must never go back to `watcher_running`, and why unlocking quietly turns the user's failover preference off.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking/tower-locking` (`app/cellular/cell-locking/tower-locking/page.tsx`) |
| Page coordinator | `components/cellular/tower-locking/tower-locking.tsx` |
| Geometry + tone contract | `components/cellular/tower-locking/shapes.ts` |
| Hero shell ("While nobody is watching") | the `<section>` in `tower-locking.tsx` — **no child renders it** |
| Automation tiles (the hero's subject) | `components/cellular/tower-locking/automation-tiles.tsx` |
| Schedule tile (the third automation tile) | `components/cellular/tower-locking/schedule-tile.tsx` |
| Live strip (read-only, above the tiles) | `components/cellular/tower-locking/live-strip.tsx` |
| LTE leg card | `components/cellular/tower-locking/lte-tower-card.tsx` |
| NR-SA leg card | `components/cellular/tower-locking/nr-sa-tower-card.tsx` |
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
| i18n | `tower_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**148 keys per locale**, identical key paths across all five) |
| Leg-card DOM anchors | None. The `id="tower-locking-card-{leg}"` pair and its `scroll-mt-20` were removed with their only caller — see [Three columns became two](#three-columns-became-two-and-what-happened-to-the-third) |

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
    ├── <section TOWER_HERO>               ← the ONE hero, owned by the coordinator
    │   ├── h2 "While nobody is watching" + HERO_DESCRIPTION
    │   ├── TowerLiveStrip                 ← read-only premise:
    │   │                                    verdict | camped on now
    │   └── TowerAutomationTiles           ← the subject; NO card, NO header
    │       ├── persist tile
    │       ├── failover tile (switch + threshold + gated meter)
    │       └── ScheduleTile
    └── grid (1 col → 2 at @3xl/main)
        ├── LteTowerCard
        └── NrSaTowerCard
```

The order is **what the lock does unattended** (hero), then **where it points** (leg cards). Two objects, not four: one `rounded-hero` section and one 2-up of peers.

**The coordinator owns the hero shell rather than delegating it to a child, and that is what the composition is for.** The strip and the tiles are two parts of one section — the premise and the standing orders that act on it — so a single `TOWER_HERO` wraps both. `TowerAutomationTiles` therefore renders no `Card` and no header at all: a child rendering its own card shell would put a card inside a hero and split one idea across two surfaces. This is also why `AUTO_GRID` queries `@container/hero` and not `@container/card` — there is no longer a `card` container anywhere in that subtree for a `/card` variant to match.

The coordinator is the only component that calls a hook. It reads `useModemStatus` and `useTowerLocking` and hands everything down as props. There is no profile/scenario gate chain here — unlike Band Locking, no SIM profile or Connection Scenario writes `AT+QNWLOCK`.

## The two clocks

**Short version: two readings on this page sit inches apart, and one of them can be an hour old.** Pretending otherwise would be the surface's biggest lie, so the verdict prints an explicit "as of HH:MM" and offers a manual refresh instead.

| Reading | Source | Freshness |
| ------- | ------ | --------- |
| **The lock target** — the verdict's left operand, and the leg cards' "Modem reports" line | `modemState.lte_cells` / `.nr_cell`, read back from `AT+QNWLOCK` by `status.sh` | Fetched **once on mount**, never polled |
| **Camped on now** — the strip's right column, and each leg card's `Serving` chip | `network.carrier_components` from the poller snapshot | Live, ~4s (see [poller cadence](radio-information.md)) |

**The stamp lives on the verdict block, not in a corner of the page**, and that placement is an argument rather than a layout preference. The verdict is computed from *both* readings, so it is only ever as fresh as its **stalest** operand — a conclusion drawn across two clocks has to wear the slower one. Moving the timestamp away from the verdict would leave the page's single loudest claim as the only thing on it with no freshness qualifier.

The same fact is why the leg cards' read-back line is **captioned** rather than printed bare: that line is on the slow clock while the form fields directly beside it are the config's live view, and a reader who cannot tell which is which has no way to interpret a disagreement between them. See [The modem read-back line](#the-modem-read-back-line).

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

**That is why the failover control lives in the hero's automation tiles and not on either leg card.** Rendering it as a row inside the LTE card would say it protects LTE; it protects the modem. It sits with `persist` and the schedule in the one group whose three members are exactly the settings that belong to no single leg. See [The hero is the standing orders](#the-hero-is-the-standing-orders).

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

The persist tile keeps both channels visible on purpose: **the chip reports the modem, the switch drives the config.** They can disagree, and when they do, the `split` chip is the only thing on screen that would tell you.

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

## The hero is the standing orders

**Three answers to one question.** Persistence, signal failover and the schedule were three separate objects on this page: two rows buried at the foot of an old hero rail, and a whole card of its own sitting in a 2-up grid as the orphaned third cell beside empty space. Nothing said they were related, and the schedule in particular read as a feature parked wherever there happened to be room — at the same visual rank as the two lock forms, while answering a different question from either of them.

They are all the same question — **what does this lock do when nobody is looking?** — asked about three different absences: across a reboot, during a signal collapse, and on a clock. Grouping them is what turns "three settings" into one thing a reader can hold.

**They are the *hero* because they are what a returning reader came for.** A target is chosen once and then rarely touched; whether the lock survived last night's reboot, whether the safety net is armed, and whether the window is still right are checked every visit. Leading with the answer and putting the two three-field forms below it matches how the page is actually used — and it is what freed the vertical space the retired match line was spending on a restatement of those forms.

```
<section TOWER_HERO>                      rounded-hero (40px) — the ONE hero on this page
  ├── h2 "While nobody is watching" + HERO_DESCRIPTION
  ├── <div STRIP_GRID>                    the premise — see The live strip
  └── <div AUTO_GRID>                     1 → 2 at @xl/hero → [1fr 1fr 1.5fr] at @4xl/hero
      ├── AUTO_TILE     restart_alt       persist: switch + PERSIST_BADGE + help copy
      ├── AUTO_TILE     shield            failover: switch + FAILOVER_BADGE +
      │                                     threshold Input/SaveButton + AUTO_METER
      └── ScheduleTile  (AUTO_TILE)       enable + window + day chips
```

Every tile inside the section is `rounded-tile` (28px) on `surface-container` — **two steps below** the outer section's `rounded-hero` (40px), per Radius-Follows-Size, and the same step the live strip's panels use so the strip reads as a peer of the tiles rather than as a third rank between them and the section. `TOWER_HERO` claims the Consistent-Layout Rule's "a genuine glance surface may earn a hero card" exception on its own; nesting card- or hero-radius panels inside it would spend that exception twice on one page.

The columns are **stepped, not equal thirds**: the schedule carries seven 44px day chips plus two time fields and genuinely needs the room, where persistence is a label and a switch. Equal thirds either wrap the weekday row or leave the first tile mostly empty.

`AUTO_TILE` is deliberately **not** the retired `HERO_ROW`. That shape painted `bg-surface`, correct on an old hero's `surface-container` panels and invisible here, where the host section *is* `bg-surface`. Same failure mode `CONTROL_ROW` / `CARD_ROW` already documents for the leg cards.

> ⚠️ WARNING: `AUTO_GRID` queries **`@container/hero`**, not `@container/card`. These tiles moved out of a `TOWER_CARD` and into `TOWER_HERO`, and a `/card` variant left behind here would silently never match — the hero declares no `card` container — so the grid would stay single-column at every width and the collapse would look like a design choice rather than a bug.

### A switch on this page means one thing

The three switches in these tiles — persist, failover, schedule — are the only ones that **write anything**, and each writes the instant it moves. The leg cards' "Tower lock" switches are gone precisely so that is true: see [One way to lock](#one-way-to-lock). A switch here now carries a single promise — a preference, saved immediately, cheap to reverse — which is exactly the promise `AT+QNWLOCK` cannot keep.

> ℹ️ NOTE: each leg card also keeps a **Simple Mode** switch. That one is not a counterexample: it writes nothing but a `localStorage` preference and changes only which input control the form renders. Nothing on this page reaches the modem through a switch any more.

### Why failover belongs here and not on a leg card

`qmanager_tower_failover` releases **both** radios when it fires, and it has only one device-wide RSRP to work from (`.lte.rsrp` falling back to `.nr.rsrp`) — there is no per-leg quality figure anywhere in the pipeline. Rendering it inside the LTE card would claim it protects LTE; it protects the modem.

These tiles are not leg cards, which is exactly the property that made the old hero rail the right home before and makes the hero proper the right home now.

### The persist chip and switch must stay in one tile

`AT+QNWLOCK="save_ctrl",v,v` writes one value to both radios but reads them back independently, so a modem can report `1,0`. The **chip reports the modem**; the **switch drives the config**. When they disagree, the `split` chip is the only thing on screen that would tell you — and that is only true while the two sit together. Splitting the chip out as a "status" elsewhere and leaving the switch here would destroy the affordance.

### The threshold and the reading it gates share one track

`AUTO_METER` draws the live quality as a fill and the configured threshold as an absolute marker on the **same** track. A "35%" in a box says nothing until you can see that the modem is at 93%; the pre-hero layout put them in two rows four apart, and the rail put them in one row without a scale.

Threshold state is a local string so a half-typed value is never sent, synced from props by render-time adjustment rather than an effect, and validated to 0–100 before the save is offered.

`AUTO_METER.ROOT` carries **no** `overflow-hidden` — the clipping lives on `.TRACK`, where the fill is — because the marker deliberately overhangs the 6px track top and bottom. Clipping it to the track leaves a 2×6px speck.

The fill is `bg-primary`, not a quality ramp: the bar reports a **magnitude**, and the amber marker beside it carries the judgement. Colouring the fill by quality would make the meter argue with the threshold it is drawn against.

### The schedule tile

`ScheduleTile` writes `config.schedule`, and `schedule.sh` turns it into **two runtime systemd timers** — `qmanager-tower-schedule-apply.timer` and `qmanager-tower-schedule-clear.timer` — via the root helper `qmanager_tower_schedule_arm`. RM520N has **no working crond**; the incumbent's two `/var/spool/cron/crontabs/root` lines were never read by anything. See [scheduled-timers.md](scheduled-timers.md).

Three properties of that backend leak into the tile's behaviour and must not be flattened:

**`armed: false` is a real outcome.** The helper deliberately uses a manual symlink into `/lib/systemd/system/timers.target.wants/` rather than `systemctl enable`, and it no-ops successfully if either target `.service` is absent (an OTA-upgraded device predating the feature). So a save can legitimately succeed at the config layer and install no live timer. `TowerScheduleSaveResult` threads `{ success, armed?, reason? }` up to the tile, which warns with `arm_warning` + a translated reason (`unit_absent`, else the raw reason). An **absent** `armed` field is treated as "assume armed" for backwards compatibility with an older backend.

**Both timers carry the 1970-boot-window fire guard.** The modem has no battery RTC: every boot starts at Jan 1970, `ql_time_daemon` steps the clock ~24s in, and systemd fires every armed `OnCalendar` timer once on that step. `Persistent=false` does **not** guard this — it only controls the across-reboot stamp file. The guard is worker-side, `_qm_timer_fire_allowed()` in `schedule_timer.sh`. Any new timer on this surface must pass it.

**Three save paths, deliberately different:**

| Path | Behaviour |
| ---- | --------- |
| Enable toggle | Immediate, and **reverts the switch** if the backend refuses. The common refusal is `no_lock_targets` — a real precondition, not an error — which gets its own message; the incumbent hardcoded "No lock targets configured" for *every* failure |
| Time / day edit | 800ms debounce, and **only while enabled** — editing a window on a disabled schedule writes nothing, because there is no timer to re-arm |
| Arm result | `{ success: true, armed: false }` warns — but **only on the ON path**, since disarming is what turning it off means |

Config sync is keyed on a **value string** (`scheduleKey()`), not object identity: `config.schedule` is re-parsed from JSON on every fetch, so an identity comparison re-seeds the form on every poll and wipes whatever the user was mid-way through typing.

The day chips replace the surface's single worst line — a `Toggle variant="outline"` whose pressed state was an arbitrary-child selector painting a dot `bg-blue-500`, a raw Tailwind palette value in an OKLCH-only system and the one colour on the page that was byte-identical in light and dark. They are now real `aria-pressed` buttons on `DAY_CHIP`, with the **fill** carrying selection (`primary-container` — brand, not a functional role, because a chosen day is not a *healthy* day). `size-11` is 44px met by the paint itself rather than by an overlay, because seven sit in a row and overlapping `before:` targets would make the gaps unhittable.

"Enabled with no days selected" can never fire, so the tile says so (`no_days`).

## The live strip

**The question this page exists to answer is not "what is the modem doing" and not "what did I ask for" — it is whether those two are the same thing.** The strip is the premise the standing orders act on, and it is two parts read as one clause:

```
VERDICT   ▸   CAMPED ON NOW
```

The verdict is the only genuinely *new* fact the page can compute — neither the modem's lock read-back nor the poller's carrier list carries it alone — so it leads. The camped list is the evidence behind it, and it stays on screen rather than collapsing to a count because **every row in it is a lock target one click from a form**.

```
<div STRIP_GRID>                          1 col → [15rem minmax(0,1fr)] at @3xl/hero
  ├── VERDICT_BLOCK   rounded-tile        disc + title + body + freshness STAMP
  └── STRIP_PANEL     rounded-tile        CAMPED ON NOW: live-dot header,
                                            CAMPED_LEAD block,
                                            CAMPED_SCC rows (or CAMPED_ABSENT),
                                            STRIP_FOOTNOTE pinned with mt-auto
```

The split is a **container** query against `@container/hero`, which `TOWER_HERO` declares, so it responds to the hero's own width rather than the viewport.

The verdict column is a **fixed `15rem`**: it holds a state word and one line of consequence, so letting it flex would stretch a two-word conclusion across half the hero. Everything else goes to the carrier list, which is the part with a variable number of rows.

`STRIP_GRID` is **`items-start`, not `items-stretch`**, and that is a correction rather than a preference. Stretching made the verdict as tall as a three-carrier list and left ~90px of empty container between its body copy and its stamp — on a *saturated* `success-container`, where a void is the loudest thing in the hero. A conclusion sizes to itself; only the list it judges grows. (`VERDICT_BLOCK.STAMP` carries no `mt-auto` for the same reason: pinning the stamp to a floor would reopen exactly that void.)

### Three columns became two, and what happened to the third

**The retired column printed which leg was locked and to which (channel, PCI) pairs — both already on the leg cards below.** It was a set of clickable leg rows, each followed by an indented `TARGET_CELL` list with the serving pair marked, and a `LEG_BADGE` chip; `scrollToLeg()` scrolled from a row to the matching card. All of that is gone, and the deletion is the point: a reader met the same pair of numbers twice before reaching a single control, and the read-only half of a settings page was the tallest thing on it.

The single fact it carried alone moved to the leg cards — see [The modem read-back line](#the-modem-read-back-line).

> ⚠️ WARNING: do not reintroduce a locked-target panel, a "match line", or a target-summary rail as a tidy-up. It looks like the honest thing to add to a page whose subject is a lock, and it has been tried twice. The facts it would carry are on the leg cards; the only reading that was ever unique to it is now printed inside the card that owns it.

**Smaller, not lesser.** The verdict dropped from a 176px centred tile to a left-aligned block, and the camped lead from a 172px identity-filled tile to two compressed lines. Every *reading* survived — PCI still leads, and the channel, RSRP, RSRQ and SINR are all still on the lead. Rank now comes from **anatomy** (two lines against the secondaries' one) rather than from area. Centring is what made the old verdict read as the page's headline metric; at strip scale it is a sentence about the tiles below it, and a sentence starts at the left margin.

### The verdict, and what makes it honest

`matchVerdict(modemState, onAir)` in `shapes.ts` is a pure function over structural parameter types — it takes no dependency on the response schema, matching `persistPosture` beside it.

| Verdict | When | Tone / glyph |
| ------- | ---- | ------------ |
| `unknown` | `modemState === null` — nothing read back yet | neutral / `schedule` |
| `unlocked` | Neither leg reports a target | neutral / `lock_open` |
| `unverified` | Locked, but **no carrier is on air** to compare against | neutral / `help` |
| `on_target` | Every locked leg has a camped carrier matching one of its targets | `success` / `check_circle` |
| `off_target` | At least one locked leg has no match | `warning` / `warning` |

Four properties are load-bearing:

- **A leg matches when SOME target matches, not all of them.** `AT+QNWLOCK="common/4g"` takes up to three cells and the radio only has to be on *one* of them — that is what the three slots mean. Requiring all three would report a working multi-cell lock as a fault.
- **A leg locked to a radio family with nothing on air resolves to `off_target`**, and that is correct rather than pedantic. An LTE lock the modem is not honouring because it registered 5G-SA is a lock that is not in force, and saying so is the point of the verdict.
- **`unlocked` is NEUTRAL, and that is deliberately the opposite reading from `LEG_BADGE`,** which paints an unlocked leg green. The two answer different questions. `LEG_BADGE` asks *"is this radio constrained?"*, where unconstrained is the safe state. The verdict asks *"are you where you asked to be?"* — with no lock in force there was no ask, so the honest answer is "nothing to match", which is neither good news nor bad.
- **The neutral fill is `surface-container`, matching the carrier panel beside it.** `bg-surface` would be the hero's own fill and would render the block invisible.

The disc is mandatory rather than decorative. `success-container` and `warning-container` measure 1.03:1 apart and are the same surface under deuteranopia, so the container fill *cannot* be the channel separating "on target" from "not on target". The filled disc on the role's **strong** fill is (Glyph-Disc Rule). The three neutral verdicts share one fill, so each carries a distinct glyph for the same reason.

#### Freshness sits on the verdict

`VERDICT_BLOCK.STAMP` holds a `schedule` glyph, the `as of HH:MM` label (or `synced_never`), and `HERO_REFRESH_BUTTON`. See [The two clocks](#the-two-clocks) for why it is here: the verdict spans both sources, so it wears the slower one.

The refresh button is a 22px glyph whose `before:` overlay reaches the project's 44px coarse-pointer floor without adding a layout box that would push the timestamp off its baseline. Its spinning state is `motion-reduce`-guarded and mirrored to an `sr-only` `aria-live` region.

> ⚠️ WARNING: the stamp and `HERO_REFRESH_BUTTON` **inherit their colour** (`text-current`, opacity-stepped) rather than declaring `on-surface-variant`. They sit on a fill that changes with the verdict; a hardcoded neutral grey would be a grey label on an amber container. Do not "restore" an explicit ink here.

### The camped cell: one carrier leads, the rest are a list

**`AT+QNWLOCK` pins a PRIMARY cell.** The SCCs are carriers the network attached alongside it — context for "what else is on air", never the answer to "which of these am I locking to". Drawing all of them as peer 168px tiles in a 3-up grid made the live-status half of the page the tallest thing on it and buried the PCC among its own secondaries.

So the lead carrier gets the full anatomy (`CAMPED_LEAD`), and the secondaries drop to one line each (`CAMPED_SCC`). The lead is `onAir[0]` — derived from the sort rather than re-tested, so the panel and `sortCarriers()` cannot disagree about which carrier leads.

**The lead is distinguished by ANATOMY, not by area.** It was a 172px block in a saturated identity fill; it is now two lines against the secondaries' one, at roughly a fifth of the paint, and a reader resolves that difference instantly.

**Nothing in this panel is identity-filled any more, and that is what lets every picker be an ordinary neutral control.** A saturated `bg-primary` / `bg-lte` block forces every element inside it to be drawn as an alpha over its own ink, because a role colour on an identity ground is either invisible or brand-on-brand — three tone helpers (`carrierTileTone`, `carrierPillTone`, `carrierMeterTone`) existed only to serve that, and all three retired with the fill. On `bg-surface` the "use this cell" control is a plain `surface-container-high` button, and identity travels on the `Badge variant="nr"|"lte"` each row already carried: the one element in this system whose fill and ink are guaranteed to agree.

**Secondaries stay individually pickable.** A secondary becomes a legitimate lock target the moment the network reselects, so hiding its picker would be a guess about the future.

Tower locking targets an (EARFCN, PCI) pair. A `CarrierComponent` already carries `earfcn`, `pci`, `band`, `rsrp`, `rsrq` and `sinr` — so **every carrier the radio reports is describing a cell the user could lock to**, and making them retype those same digits into a text box underneath is the whole reason a parallel "Simple Mode" dropdown had to be invented as a second input path.

#### Why the lead block itself is not a button

**A block holding six discrete numbers is ambiguous as a single click target** — a reader cannot tell whether the RSRP figure is itself actionable. So the block stays a report and carries one labelled control, which removes the guess.

This used to be an accessibility-and-tone argument as well: while the block was identity-filled, a whole-block button would have been a violet control, which the Identity-Never-Acts Rule forbids outright. That constraint is gone with the fill, and the UX argument is the one that keeps the shape.

`CAMPED_LEAD.ACTION` **switches width on the panel, not the viewport.** Above `@sm/panel` an `ml-auto` parks it at the head row's right edge, so it never sits between two readings; below that the head row wraps, and a right-parked auto-width pill floating alone on its own line reads as a stray chip between the PCI and the detail — so it goes `w-full` instead. Wrapping is the trigger and the *panel* is what wraps, because this block also sits in a hero column that collapses independently of the window.

**A carrier that cannot currently be targeted gets its control DISABLED with a reason, never a missing control.** `canTarget` in the coordinator computes the gate per leg:

| Leg | Blocked when | Reason key |
| --- | ------------ | ---------- |
| `lte` | all three slots are full (`lteFreeSlots === 0`) | `tile_blocked_slots_full` |
| `nr_sa` | `networkType === "5G-NSA"` | `tile_blocked_nsa` |
| `nr_sa` | `networkType === "LTE"` or `""` | `tile_blocked_lte_only` |

An NR carrier is visible but not SA-lockable while the modem is in NSA mode; silently dropping the control there would leave the user to infer the rule. The reason renders in a tooltip on the disabled control.

A carrier with no PCI **or** no channel gets no control at all (`addressable`), because the AT command needs both halves of the pair — there is nothing to disable-with-a-reason, the cell simply is not addressable.

#### PCI is the headline here, where band is the headline on Band Locking

This is the one place the block deliberately departs from its Band Locking sibling, which is otherwise the same anatomy. On that surface the reader is choosing a **frequency**, so the band designator is the answer. On this one they are choosing a **physical cell**, and PCI is its name. Same anatomy, different value promoted, because the question the surface asks is different.

It is set at `text-xl` (20px) — down from the retired tile's 30px, but still two steps clear of the secondaries' 13px, so the rank survives the shrink.

Lead block anatomy, top to bottom:

| Line | Content |
| ---- | ------- |
| Head | `Badge variant="lte"\|"nr"` reading `"LTE PCC"`, band designator, the `PCI` label and its value, then the action |
| Detail | `EARFCN`/`ARFCN` + channel, RSRP, RSRQ, SINR — separate flex children with a real gap, each omitted individually when unreported |

A secondary row carries the identity Badge, band, `PCI nnn`, RSRP, and the `CAMPED_SCC.PICK` icon button — 32px of paint reaching the 44px coarse-pointer floor through a `before:` overlay.

**One entry per raw `CarrierComponent`, not per unique cell.** Ordering is `sortCarriers()`: PCC first, then LTE before NR. `Array.prototype.sort` is stable, so carriers of equal rank keep the order the radio reported them in. LTE leads because the LTE leg is the anchor in NSA — it is what a reader looks for when a 5G connection misbehaves.

#### The lead's signal meter is retired, and should not come back

The old tile drew a 6px quality bar under its detail line, toned by `carrierMeterTone`. At row scale that bar spans the block's full width at 4px, and **on screen it reads as a coloured bottom border rather than as a gauge** — the exact tell the craft floor bans. It was also a third channel reporting what two elements already report: the `Badge variant="nr"|"lte"` says *which radio*, and the dBm figure beside it says *how weak*.

The secondary rows never carried one, so dropping it is also what makes every carrier row on this surface report signal exactly one way. `rsrpToPercent` is consequently no longer called anywhere on this page; the only meter left is `AUTO_METER` in the failover tile, which reports a **device-wide** quality against a threshold and is a different object entirely.

#### The absent-leg note and the empty state

`CAMPED_ABSENT` renders **only** when exactly one carrier is on air — in the slot the secondary list would occupy — and names the radio leg that is *not* present (NR when the lone carrier is LTE, and vice versa). With several carriers aggregated the list already fills honestly.

It is a **note, not a block**. With the lead block already carrying the panel, a second block claiming "no 5G" would read as an editorial claim that the absence is a fault — on a modem whose SKU may not even support SA, it often is not.

The empty state (`camped_empty_title` / `camped_empty_body`) replaces the whole panel body when nothing is camped, so it and the absent-leg note can never share a frame — which is why both can safely use the `signal_cellular_off` glyph.

The panel header carries a live-pulse dot using **`.animate-live-ping`**, the project's own keyframe in `app/globals.css` (running on `--duration-ambient` / `--ease-ambient`), **not** Tailwind's built-in `animate-ping`. They look similar and time differently; `animate-ping` here is an off-scale duration under The One-Scale Rule. It is `motion-reduce:animate-none`-guarded.

The panel's footnote (`camped_note`, on `STRIP_FOOTNOTE`) pre-empts the single most likely misreading: these are the cells the radio reports, not the cells you locked. A locked cell only appears here once the modem camps on it — and the cells you *did* lock are printed on the leg cards, under "Modem reports".

## The prefill bus

Clicking "use this cell" on a live-strip row has to reach a form owned by a **sibling** card, so the coordinator brokers it: `handlePickCarrier` routes the picked `CarrierComponent` to `ltePrefill` or `nrPrefill`, each `{ cell, nonce }`.

**The payload carries a nonce because picking the same cell twice must still register.** Without it, a second click produces an identical object and the receiving card's render-time comparison sees no change — yet re-picking a row after editing the fields is a meaningful gesture (it restores that carrier's values).

The NR path has to source a field the strip does not carry. `carrier_components` has **no SCS**, so:

- If the picked cell **is** the cell the modem is camped on (`nr.arfcn === c.earfcn && nr.pci === c.pci`), the serving-cell SCS is authoritative.
- Otherwise it falls back to `defaultScsForBand(bandNumber)` (FR2 → 120, sub-1 GHz list → 15, else 30), and the card **flags that as a guess**.

The band designator arrives as a string (`"NR5G BAND 41"`, `"N41"`) and is reduced to an integer for the lock command.

## The leg cards

A leg card is where the target changes, and it is now also **the single place a leg's own state is reported**: the header `Badge`, the modem read-back line, and the two form paths all live in one card, one per AT lock parameter.

### One way to lock

**Short version: both cards used to offer two different ways to apply a lock, one of which was also a state display. There is now one, and it is a button.**

Each footer reads, left to right: **Lock Tower** (`actions.lock`, a primary `SaveButton` on `PILL_ACTION_PLAIN`), **Remove Lock** (`actions.unlock`, `variant="outline"` with a `lock_open` glyph), and **Clear fields** (`actions.clear_fields`, `PILL_QUIET` + `variant="tonal-neutral"`, pushed to the far edge by `justify-between`). Two writes grouped together, then a form reset that touches nothing on the modem — the same construction as `band-grid-card.tsx`'s footer, which this surface is converging on. Lock is additionally disabled while the form parses to nothing (`validCells.length === 0` on LTE, `!parsedCell` on NR); `mt-auto` pins the whole footer so the two cards' buttons line up in an equal-height grid row.

The deleted control was a per-leg "Tower lock" `Switch`. It failed on three counts at once:

- **It was a state display and a write in the same control.** Its `checked` came from the modem read-back, so it reported; its `onCheckedChange` wrote. A control that both reports and acts has no resting truth — you cannot tell whether a flipped switch means "the modem is locked" or "I asked for a lock".
- **Its ON action wrote whatever sat UNSAVED in the form.** No confirmation of *what* was about to be sent, from a control whose whole affordance says "this is instant".
- **A switch promises instant, cheap and reversible.** `AT+QNWLOCK` pins the radio to one physical cell and **bounces the link for 3–5 seconds, on the device serving this page**. That is a deliberate button with a confirmation dialog, which is what Band Locking already settled on — its only `Switch` is likewise failover.

Both confirmation dialogs are unchanged, and the header `Badge` still reports state — that half of the switch's job was always the `LEG_BADGE`'s. `tower_locking.card.enable_label` was deleted from all five locales.

The corollary is on the hero: the only switches that write anything are now the three automation settings, each of which saves the instant it moves. See [A switch on this page means one thing](#a-switch-on-this-page-means-one-thing).

> ⚠️ WARNING: do not reintroduce an enable `Switch` on a leg card as a convenience. It reads as the tidier control and it is the one shape this operation cannot honestly wear. It also *hid* a real bug for as long as it existed — see the NR dirty-gate trap below, where the switch was the accidental escape hatch from a dead Lock button.

### The modem read-back line

**This is the one fact the retired locked-target column carried that nothing else did, and moving it here is what makes deleting that column a distillation rather than a loss.**

Both cards render a captioned `READBACK` block under the header: the label "Modem reports" (`tower_locking.card.readback_label`, new in all five locales), then the (channel, PCI) pairs the **modem itself** reports over `AT+QNWLOCK`, each marked with a `Serving` chip when the radio is camped on that exact pair right now.

Why it belongs here rather than in the strip:

- **A leg card's form fields are seeded from `config` — the file's *intention*.** The read-back is the modem's *answer*. They can disagree: a schedule timer fired, the failover watcher released the lock, a second tab wrote something else. Printed one scroll away in a hero, that disagreement was invisible at the moment it mattered; printed here it sits inches from the values it contradicts, which is the only place a disagreement is actionable.
- **The caption is mandatory, not decoration.** That line is on the slow clock (`status.sh`, once on mount, never polled) while the fields beside it are the config's live view. A reader who cannot tell which is which has no way to interpret the difference. See [The two clocks](#the-two-clocks).
- **The pairs are read only when the leg also reports as *locked*.** `lte_cells` / `nr_cell` can outlive a release, so printing them unconditionally would caption a stale target with "Modem reports". Both cards apply the same `*_locked` guard `matchVerdict` applies, for the same reason.

The block renders **only when there is at least one pair** — the header chip already says "Unlocked", and an empty captioned box is noise. Only the serving pair is marked; the *absence* of a chip is what says "configured, not currently in use", which avoids inventing a second glyph for a standby state that has no natural mark. The `Serving` chip is the same `Badge` the strip uses, so the two views of "the radio settled on this pair" cannot disagree about how they say it.

`READBACK.ROW` is `min-h-8` rather than the 44px metric-row floor: it carries no control, so no coarse-pointer target applies. The values are mono and tabular — a channel and a PCI are device identifiers, which the Machine-Voice Rule puts in the machine's typeface.

> ℹ️ NOTE: the copy still comes from `tower_locking.live.rail_target_pair`, a **fossil** of the long-retired lock-posture rail and now the only surviving `rail_*` key. It was deliberately not renamed: a rename touches five locale files, re-translates nothing, and `i18n:check` grades a missing key as a *warning* that exits 0 — so the tidy-up buys nothing and risks a silent breakage. Read `rail_target_pair` as "one channel/PCI pair".

#### The `LEG_BADGE` inversion: `locked` is a warning, `unlocked` is a success

| Posture | Variant | Glyph |
| ------- | ------- | ----- |
| `locked` | `warning` | `lock` |
| `unlocked` | `success` | `lock_open` |
| `unknown` | `muted` | `schedule` |

This reads the **functional contract**, not a value judgement about locking. Pinning the radio to one physical cell is the state that can cost you the connection, so `warning` means *constrained* — not *you did something wrong*. It is the same inversion Band Locking applies to a narrowed band list, for the same reason, and keeping the two consistent is what lets a user cross the three `/cellular/cell-locking/` routes in one task without relearning the colour language.

**`unknown` is a real state, not a loading placeholder.** `status.sh` cannot distinguish a failed `AT+QNWLOCK` read from "not locked": `tower_lock_mgr.sh` prints `error`, `status.sh` logs a warning and leaves the flag `false`. A surface that renders that as a confident "Unlocked" is asserting something nobody read back. So the posture is `unknown` whenever `modemState` is null, and the chip says so.

This chip is also what gates **Remove Lock**, which is disabled unless `posture === "locked"` — gated on the modem's report, never on `config.*.enabled`. Offering to remove a lock the modem does not report is offering an action with no effect, and `unknown` means nobody has successfully read the modem, so it stays disabled rather than optimistically live.

### Both cards gate Lock on a real change

**Re-sending the identical target is not free.** It still runs `AT+QNWLOCK` and still bounces the link for 3–5 seconds for a guaranteed no-op, so both cards now disable Lock when `posture === "locked" && !hasChanges`. Two bugs were fixed getting there, and both are the kind that recur:

- **NR compared against the wrong field.** `hasChanges` diffed the form against `modemState.nr_cell` directly — a field `status.sh` can return *populated while `nr_locked` is false* (a last-known target that outlived its release). On an unlocked modem whose stale cell happened to equal the form, `hasChanges` came out false and the Lock button was simply dead; the enable `Switch` was the accidental escape hatch, so deleting the switch is what turned a latent bug into a dead end. It now compares against `lockedCell`, which carries the `nr_locked` guard, and the button gates on `posture` as well.
- **LTE had no dirty gate at all.** Its Lock button stayed live while the modem already held those exact cells — the guaranteed-no-op link bounce above — and it made the two cards visibly disagree while both read "Locked", which a reader can only interpret as one of them being broken. It now gates the same way.

**The LTE comparison is order-insensitive.** The three slots are a **set** of acceptable cells and the radio only has to camp on one of them, so slot 1 and slot 2 swapping places is not a change worth a link bounce. `hasChanges` compares sorted `earfcn:pci` keys rather than indices for exactly that reason.

> ℹ️ NOTE: the gate is `posture === "locked" && !hasChanges`, never `!hasChanges` alone. A form that parses must always be lockable while nothing is locked — that is the condition the NR trap above turned into a dead end.

### LTE — three slots

`AT+QNWLOCK="common/4g"` accepts at most three cells, so the card is a fixed three-slot form (`SLOT_COUNT = 3`), each slot an EARFCN + PCI pair.

- **A slot contributes a cell only when BOTH halves parse.** A half-filled slot is silently dropped on write by the backend, so the card renders a warning notice (`toast.incomplete` copy) saying so rather than letting the drop go unremarked.
- **Free-slot count is reported upward** via `onFreeSlotsChange`, because slot occupancy includes local unsaved edits and the coordinator cannot derive it from `config`. That is what lets the live strip disable its picker with `tile_blocked_slots_full` instead of letting a click land on a card that will silently discard it. It is an **effect**, not a render-time call, because it writes to a parent's state.
- **The empty state is inline, not a branch.** Band Locking can replace its whole content region when a category reports no supported bands; this card cannot, because its empty copy is "Pick a cell from the list above, or type a channel and PCI" and swapping out the slots would remove the very fields that sentence points at. So "no targets yet" renders *above* the slot list. (`empty_body` says "the list above" in all five locales — it was reworded from "the tiles above" when the hero's 3-up tile grid became the strip's lead-plus-list.)

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
2. **Composition.** If a config poll and a strip prefill land in the same render, the prefill searches the *config-synced* slots, so neither write silently discards the other.

> ⚠️ WARNING: neither block may become a `useEffect`. Both inputs are rebuilt by the parent on every poll, so an effect keyed on them loops. There is a quieter cost too: `eslint-plugin-react-hooks` v7 is compiler-backed and **stops at the first violation in a component**, so introducing one here would suppress every later diagnostic in the file — the mistake would hide its own neighbours.

#### Simple Mode survives the rebuild

The strip's carrier picker is what Simple Mode was invented to work around, and for the common case the `prefill` prop replaces it. It stays because it is the only way to fill **slot 2 and slot 3** from the carrier list without leaving the card, and because a user who has scrolled past the hero should not have to scroll back.

It is a per-card, `localStorage`-backed preference (`qmanager_tower_lte_simple_mode`, `qmanager_tower_nr_simple_mode`), read in a **lazy initialiser with a `typeof window` guard** — this component renders during the static export's prerender, and reading storage in an effect instead would flip the switch under the user on first client paint.

It **force-disables itself** when the radio reports no carrier for that technology: a dropdown over an empty list is a dead control that looks like a live one. The `!hasOptions` caption underneath is the only thing that says *why*.

A value the radio is not currently reporting is still a legitimate lock target, so the `SelectTrigger` prints it in italic mono rather than falling back to the placeholder and implying the slot is empty.

> ⚠️ WARNING: this row's label is `t("tower_locking.card.simple_mode")` with **no `defaultValue`**, and it must stay that way. It used to read `t("tower_locking.card.simple_mode_label", { defaultValue: "Pick from carriers on air" })` — a key present in **no** locale, with the English supplied inline — so it rendered English in all five languages and no gate could see it: `i18n:check` grades a missing key as a warning and exits 0, and a `defaultValue` means the key is never missing in the first place. A `defaultValue` on a user-visible string is how an untranslated literal hides in plain sight (see [i18n.md](i18n.md)).

Both cards' Simple Mode switches carry the shared `SWITCH_TARGET` overlay, which lifts the primitive's 18×32px paint to the project's 44px coarse-pointer floor without adding a layout box that would push the row label off its baseline. The NR card had no overlay at all until retiring the "Tower lock" switch left this one alone in its row — beside an LTE card whose equivalent switch did meet the floor. Two cards in one grid row must not disagree about how big a tap target is.

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

`requestLock()` → `AlertDialog` is the **only** path to a lock on either leg, now that the footer button is the only entry point to it. `AT+QNWLOCK` pins the radio to a single physical cell and bounces the link for 3–5 seconds, on a device that is serving this very page. It stays deliberate. Remove Lock has its own confirmation for the same reason.

Status labels are written out per branch (`status_locked` / `status_unlocked` / `status_unknown`) rather than interpolated as `` status_${posture} ``: `i18n:check` grades a missing key as a warning and exits 0, so a key it cannot see statically is a key nothing will ever tell you about (see [i18n.md](i18n.md)).

## Geometry and tone

Everything shape- or tone-bearing lives in `components/cellular/tower-locking/shapes.ts`, modelled on the band-locking contract and for the same reason: the incumbent restated its card shell in **seven places across four files**, each declaring its skeleton geometry in a different branch from its loaded geometry, so a radius fixed in one branch stayed wrong in the other six.

> ℹ️ NOTE: **restated, not imported.** Several strings here are byte-identical to `band-locking/shapes.ts`. That is the house convention: a surface takes no dependency on a sibling route's module graph, so Band Locking can be re-shaped without silently re-shaping this page.

| Constant | Purpose |
| -------- | ------- |
| `TOWER_HERO` | The one hero card, `rounded-hero` (40px), declares `@container/hero`. `shadow-whisper` must go through the custom property — the bare utility does not resolve |
| `TOWER_CARD` | One peer card, `rounded-card` (36px). Imported by the loaded, loading **and** gated branches |
| `CARD_PAD` | 24px on a peer card (the hero's 28px is baked into `TOWER_HERO`) |
| `STRIP_GRID` | The live strip: one column, becoming `[15rem minmax(0,1fr)]` at `@3xl/hero`. The verdict track is FIXED, and the grid is `items-start` so a two-word conclusion does not stretch to the height of the carrier list |
| `STRIP_PANEL`, `STRIP_HEAD`, `STRIP_FOOTNOTE` | The carrier half of the strip, `rounded-tile` on `surface-container`, declaring `@container/panel`. The footnote is `mt-auto` so it stays pinned to the panel's floor |
| `VERDICT_BLOCK`, `VERDICT_TONE`, `matchVerdict`, `TowerMatchVerdict` | The verdict half. `ROOT` / `HEAD` / `DISC` / `TITLE` / `BODY` / `STAMP`, left-aligned and with **no** `mt-auto` on the stamp; the tone map keys five verdicts, three of which share a neutral fill and are separated **by glyph alone** |
| `READBACK` | The leg cards' "Modem reports" line: `ROOT` / `LABEL` / `LIST` / `ROW` / `VALUE`. `ROW` is `min-h-8`, not the 44px metric floor — it carries no control |
| `CAMPED_LEAD`, `CAMPED_SCC`, `CAMPED_ABSENT` | The camped-on list: the lead block (`ROOT` / `HEAD` / `LABEL` / `VALUE` / `BAND` / `DETAIL` / `ACTION`) on plain `bg-surface`, the secondaries as 44px pill rows, and the one-line note standing in for an empty secondary list. **No identity fills and no meter** — see the strip section |
| `AUTO_GRID`, `AUTO_TILE`, `AUTO_METER` | The hero's three automation tiles. `AUTO_GRID` queries **`@container/hero`**; columns are stepped because the schedule tile needs the room; `AUTO_METER.ROOT` carries no `overflow-hidden` so the threshold marker can overhang the track |
| `HERO_EYEBROW`, `HERO_DESCRIPTION` | The strip panel's eyebrow and the hero's own description line |
| `HERO_REFRESH_BUTTON`, `HERO_HELP_BUTTON` | The two 22px-glyph/44px-target buttons. Both **inherit their ink** (`text-current`), because the refresh sits inside the verdict's role fill. `HERO_HELP_BUTTON` is an **alias by value, restated in intent** — the two are the same size by coincidence of the 44px floor, not by shared meaning |
| `FIELD_GRID`, `FIELD_LABEL`, `FIELD_CONTROL`, `SELECT_CONTROL`, `FIELD_SLOT`, `FIELD_SLOT_HEAD` | The leg cards' form shapes. See the specificity note below |
| `DAY_CHIP`, `dayChipFill` | The weekday toggle. Both hovers are `enabled:`-scoped |
| `NOTICE`, `NOTICE_TONE` | The card- and page-scoped notice, three roles / three glyphs / no shared marks. `warning` is the partial-success channel |
| `PILL_ACTION`, `PILL_ACTION_PLAIN`, `PILL_QUIET` | Action sizing. `PILL_ACTION_PLAIN` is the Lock `SaveButton`, `PILL_ACTION` the glyph-bearing Remove Lock; `PILL_QUIET` is deliberately smaller for Clear fields and carries **no fill or ink** — pair with `variant="tonal-neutral"`, never `ghost` |
| `FAILOVER_BADGE`, `LEG_BADGE`, `PERSIST_BADGE`, `BADGE_GLYPH_SIZE` | Tone + glyph maps, keyed onto the exported `BadgeVariant` type so an unmapped state fails the build |
| `failoverKey`, `persistPosture` | The two derivations the automation tiles read |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by import, not by estimate |
| `TOWER_LEGS`, `TowerLeg`, `legTitleKey`, `legDescriptionKey`, `legShortKey` | Leg identity and its i18n key stems |

### Constants that no longer exist

Retired with the match line and the identity-filled carrier tile. They are listed so a search that turns up an old reference — in a stale worktree, a comment, or this doc's history — resolves to "gone on purpose" rather than "missing":

| Gone | Was |
| ---- | --- |
| `MATCH_GRID`, `MATCH_PANEL`, `MATCH_PANEL_HEAD`, `MATCH_FOOTNOTE` | The three-column match line and its two side panels → `STRIP_GRID` / `STRIP_PANEL` / `STRIP_HEAD` / `STRIP_FOOTNOTE` |
| `VERDICT_TILE` | The centred verdict tile → `VERDICT_BLOCK`, left-aligned and self-sizing |
| `CAMPED_PCC` | The identity-filled 172px lead tile → `CAMPED_LEAD` on `bg-surface`, two lines, no meter |
| `TARGET_ROW`, `TARGET_ROW_LABEL`, `TARGET_ROW_TARGET`, `TARGET_CELL` | The locked-target panel's clickable leg rows and cell lists → deleted; the modem's pairs are now `READBACK` inside each leg card |
| `HERO_STALENESS` | The freshness line → folded into `VERDICT_BLOCK.STAMP`, which was the only place it was used |
| `HERO_RAIL_SUBTITLE` | The hero's dynamic lock-posture subtitle → `HERO_DESCRIPTION`, a static line about the automation group |
| `carrierTileTone`, `carrierPillTone`, `carrierMeterTone` | The three identity-fill tone helpers. **They exist only to put controls on a saturated identity ground**; with no identity fill left on this surface, every control here is an ordinary neutral one and none of the three has a caller |

`SKELETON_SHAPE` lost `.TARGET_ROW` and gained `.READBACK`, `.VERDICT` (re-measured at 143px) and `.AUTO_TILE` for the same reasons.

### The two field-specificity traps

Both are in `FIELD_CONTROL` / `SELECT_CONTROL`, and both produce a result that *looks approximately right* — which is exactly why they would survive review.

- **`dark:bg-surface-container` is not redundant.** `components/ui/input.tsx` ships `dark:bg-input/30`, and `@custom-variant dark (&:is(.dark *))` compiles that to a `(0,2,0)` selector against a bare `bg-surface-container`'s `(0,1,0)`. `tailwind-merge` cannot fold them either — they sit in different modifier scopes, and it only collapses conflicts within one scope. Without the explicit restatement, every field on this surface silently renders `input/30` in dark mode.
- **A `SelectTrigger`'s height must be restated at matching specificity.** `components/ui/select.tsx` sets `data-[size=default]:h-9` — again `(0,2,0)` via the attribute selector — so a bare `h-[2.625rem]` loses and every select renders 36px beside 42px inputs: visibly combed, and under the project's control-height floor. Hence `data-[size=default]:h-[2.625rem]` in `SELECT_CONTROL`, plus a `dark:hover:` neutralisation for the same reason.

Both leg cards hit these independently and patched them locally before the shared constants existed.

### A tile on a `bg-surface` host is NOT a hero row

`CONTROL_ROW` (LTE card), `CARD_ROW` (NR card) and `AUTO_TILE` (the hero's automation tiles) are all the same anatomy as the long-retired `HERO_ROW`, and all paint `bg-surface-container` where it painted `bg-surface`. `HERO_ROW`'s fill was correct on an old hero's `surface-container` *panels*; it is **invisible** on a card or a section that *is* `bg-surface` — which both `TOWER_CARD` and `TOWER_HERO` are. Same shape, one step up the tonal ladder. This is the single easiest way to render a row that is there and cannot be seen.

## Props contracts

### `TowerLiveStripProps`

The strip is **read-only end to end**: it takes no setting, no writer, and no save-state. Its only outbound edge is the prefill bus. That is the point of the split — this reports, the cards and the tiles change.

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `modemState` | `TowerModemState \| null` | The AT read-back. `null` = never read → the verdict is `unknown` |
| `carrierComponents` | `CarrierComponent[]` | The ACTUAL view. Rendered **raw** — sorted, not deduplicated; `[0]` is the lead |
| `canTarget` | `Record<TowerLeg, { ok, reasonKey }>` | Per-leg picker gate + the reason to show when blocked |
| `isLoading` / `isRefreshing` | `boolean` | First paint / quiet re-read |
| `lastSyncedAt` | `number \| null` | Drives "as of HH:MM" on the verdict block |
| `onPickCarrier` | `(c: CarrierComponent) => void` | Into the prefill bus |
| `onRefresh` | `() => void` | |

### `TowerAutomationTilesProps`

Renders **no card shell and no header** — those belong to the hero `<section>` the coordinator owns. Everything else is as it was when this was a card.

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `config` | `TowerLockConfig \| null` | Seeds the schedule tile |
| `modemState` | `TowerModemState \| null` | Drives the persistence chip — the modem's read-back, not the config's belief |
| `failover` | `TowerFailoverState \| null` | `{ enabled, activated, watcher_running }` from flag files |
| `configPersist` | `boolean` | Persist as the **config** believes it — drives the switch. The chip reports the modem instead |
| `failoverThreshold` | `number` | 0–100 |
| `activeRsrp` | `number \| null` | RSRP of whichever leg the modem is registered on (`5G-SA` → `nr.rsrp`, else `lte.rsrp`) — the figure failover gates |
| `isLoading` / `isSavingFailover` | `boolean` | First paint / failover write in flight |
| `onTogglePersist` / `onToggleFailover` | `(enabled: boolean) => Promise<boolean>` | The tiles own their own toasts |
| `onThresholdChange` | `(threshold: number) => Promise<boolean>` | |
| `onScheduleChange` | `(s) => Promise<TowerScheduleSaveResult>` | Threaded straight through to `ScheduleTile` |

### `LteTowerCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `config` / `modemState` | `TowerLockConfig \| null` / `TowerModemState \| null` | Config seeds the slots; modem drives the badge, the read-back line and the dirty gate |
| `carriers` | `CarrierComponent[]` | Pre-filtered to `technology === "LTE"` **by the caller** — which is also why the read-back's `Serving` test needs no technology check of its own |
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

Both leg cards render `TOWER_CARD` + `CARD_PAD` in **every** branch, so the shell cannot drift. The hero `<section>` renders `TOWER_HERO` unconditionally in the coordinator, and its two halves skeleton independently: the strip mirrors `SKELETON_SHAPE.VERDICT` + `.PCC_BLOCK` + `.SCC_ROW`, the tiles mirror three `SKELETON_SHAPE.AUTO_TILE`s in the same `AUTO_GRID`. Each leg card additionally mirrors `SKELETON_SHAPE.READBACK` above its settings row.

> ℹ️ NOTE: `SKELETON_SHAPE.READBACK` is sized for **the caption plus one pair**, even though the LTE card can render three. The skeleton cannot know how many will land, and a placeholder sized for three collapses on the common single-cell case — a skeleton that *shrinks* is worse than one that grows, because the content below it jumps upward into space the reader had already started on. `.VERDICT` makes the same call: two body lines, where `unverified` runs to three.

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
- **The carrier identity-tone helpers still exist in two places, and this surface is no longer one of them.** `components/dashboard/carrier-aggregation.tsx` (as `tileTone()` / `meterFillTone()`) and `components/cellular/band-locking/shapes.ts` still carry their own copies; tower locking dropped its three when the lead block lost its identity fill. Extraction into a shared module (e.g. `lib/carrier-tone.ts`) is now a two-copy trade rather than a three-copy one. The rule that must never drift, wherever it lives, is *identity, never quality* plus the `isLead` signature — a lead tile paints `bg-lte`, so a fill that also paints `bg-lte` is invisible at 1.00:1.
- **`types/tower-locking.ts` is shared.** `components/cellular/frequency-locking/nr-freq-locking.tsx` imports `SCS_OPTIONS` from it. "Tidying" these types while working on Tower Locking breaks another route, and TypeScript will not tell you until the build.
- **Two exports in `types/tower-locking.ts` are now unreferenced**: `qualityLevel()` and `DAY_LABELS` (the schedule tile resolves day names through `tower_locking.schedule.day_{index}` instead, and `DAY_LABELS` here is a duplicate of the identical constant in `types/system-settings.ts`, which *is* used). Harmless dead constants, documented rather than deleted so the duplication is visible if someone reaches for one.
- **There is no longer any way to jump from the strip to a leg card.** The retired locked-target panel's rows were clickable and `scrollToLeg()` smooth-scrolled the matching card into view; the two DOM `id`s and the `scroll-mt-20` that served it were removed with it, since they had become ids referenced only by themselves plus an offset correcting for a scroll that no longer happens. Nothing is broken — the cards are one short scroll below the hero — but if a "jump to this leg" affordance is ever wanted again, both the anchors and the header offset have to come back together, and the offset is the half that gets forgotten.
- **The threshold row has no direct evidence the daemon adopted the new value.** `qmanager_tower_failover` re-reads `.failover.threshold` only every sixth cycle (~120s), so a save can be up to two minutes ahead of the running watcher. The UI does not say so, and the `AUTO_METER` marker moves the instant the save lands — so for up to two minutes it draws a line the daemon is not yet enforcing.
- **The verdict inherits the lock read-back's staleness and can only say so, not fix it.** `VERDICT_BLOCK.STAMP` marks it honestly, but a lock cleared out of band (schedule timer, failover watcher, a second tab) will keep reading `on_target` against a target the modem no longer holds until someone presses refresh. The leg cards' "Modem reports" line inherits exactly the same staleness, from the same fetch. Closing this needs a *poller-side* field, never a second client on the AT mutex — see [The two clocks](#the-two-clocks).
- **`hasChanges` blocks re-applying an identical lock on either leg.** Correct for avoiding a pointless modem write and a 3–5s link bounce, but it also means the failover watcher cannot be re-armed from a leg card without changing a field. (`lock.sh` spawns the watcher on a lock write, so a re-lock is currently the only UI path to a respawn.)

## Related

- [band-locking.md](band-locking.md) — the sibling surface, and the footer construction this one converged on (one primary write, one outline write, one quiet form reset; its only `Switch` is failover). Band locking keeps the 3-up carrier tile grid this surface replaced with a lead-plus-list, and its failover watcher is **bounded**
- [scheduled-timers.md](scheduled-timers.md) — the runtime `OnCalendar` timer model, `qmanager_tower_schedule_arm`, and the 1970 boot-window fire guard every new timer must pass
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the source of the camped-on carriers, and the identity-tone convention this surface's lead block no longer needs
- [radio-information.md](radio-information.md) — the poller cadence behind the ~4s clock, and the compiler-backed `react-hooks` bail-on-first-violation behaviour
- [at-command-transport.md](at-command-transport.md) — the `/tmp/qmanager_at.lock` mutex that makes polling `status.sh` expensive
- [tmp-file-ownership.md](tmp-file-ownership.md) — the flag/PID files the watcher and `failover_status.sh` share
- [i18n.md](i18n.md) — why `i18n:check` is not a gate, and why keys are never interpolated on this surface
- [icon-system.md](icon-system.md) — `/cellular/` is a Material Symbols route; every glyph used here is already in the subset allowlist
- `DESIGN.md` > Named Rules (Consistent-Layout, Identity-Never-Acts, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror, One-Scale, One-Loop, Solid-Container, Radius-Follows-Size, Machine-Voice)
