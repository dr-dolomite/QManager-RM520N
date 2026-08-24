# Tower Locking (`/cellular/cell-locking/tower-locking`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Tower Locking pins the radio to one specific physical cell — an (EARFCN, PCI) pair on LTE, or a (PCI, ARFCN, SCS, band) tuple on 5G SA — and it is the sharpest instrument in QManager.** Where [Band Locking](band-locking.md) narrows which *frequencies* the modem may use, this page names the *tower*. Get it right and a marginal fixed-wireless install becomes stable; get it wrong and the modem is pinned to a cell it cannot reach, on a device that is serving the very page you are reading. That asymmetry shapes everything below: the confirmation dialog in front of every lock and every unlock, the failover watcher that releases the lock when signal collapses, and the deliberate honesty about *when* the lock state on screen was last read.

The 2026-08 rebuild is **frontend-only**. `hooks/use-tower-locking.ts` gained state and one bug fix but kept its contract; `types/tower-locking.ts` gained two response fields that the backend was already emitting; the five CGI scripts under `scripts/www/cgi-bin/quecmanager/tower/`, `qmanager_tower_failover` and `tower_lock_mgr.sh` were untouched **by that rebuild**. The backend then changed substantially on **2026-08-23**, for AT-failure-detection reasons rather than UI ones — one change across six files plus a systemd unit, all of it downstream of a single fact: `qcmd` reports failure by **exit status**, never by writing `ERROR` to stdout, so every layer here that pattern-matched printed text was reading a failed command as a successful one. `tower/status.sh` gained the [per-read honesty flags](#the-read_ok-contract-absent-means-true); `tower_lock_mgr.sh` gained the [in-flight marker](#the-in-flight-marker) and lost two fabricated sentinels; `qmanager_tower_failover` stopped [inventing a quality figure out of absent data](#absent-rsrp-is-not-a-measurement-of-zero); `qmanager_tower_schedule` and `tower/lock.sh` picked up real `rc` checks; and `qmanager-tower-failover.service` had its [activation-flag lifecycle](#the-activation-flag-lifecycle) corrected. That change also carried the frontend's honest `unknown` states, and [The Field-Step Rule](#the-field-step-rule-six-invisible-controls). What changed is the page shape, the input path (the camped-on carriers are now the picker), the number of ways to apply a lock (**one**), and the copy (0 i18n keys → **155 per locale**, in all five).

The page shape moved four times, and every move is worth knowing so none of them is undone:

1. **2×2 grid → hero over three peer cards.** The grid put a read-only status card and three control surfaces on the page as visual peers, which said all four were the same kind of object.
2. **Hero → the MATCH LINE, and the three unattended behaviours → one automation card.** The hero still held two facts (the lock target, the camped cells) with nothing between them, so the reader diffed an EARFCN by eye; and it carried three settings rows in a rail while the schedule sat as an orphaned third cell in a 2-up grid beside empty space.
3. **The page inverted: the automation group became the hero, and the match line shrank to a strip above it.** The three unattended behaviours moved from the page's last card to its `rounded-hero` section, the match line's locked-target column was deleted outright, and what remains of it — the verdict and the camped-on carriers — is now a compact **live strip**. See [The modem read-back line](#the-modem-read-back-line).
4. **The merged hero split into two sibling sections.** The live strip and the three automation tiles briefly shared one `rounded-hero` card. They are now `TOWER_HERO` ("Right now") and `TOWER_SECTION` ("While nobody is watching"), and the freshness stamp moved out of the verdict block and up into the first section's header. See [Two sections, not one merged hero](#two-sections-not-one-merged-hero).

**Short version of the third move: the read-only half of a settings page had become the tallest thing on it, and most of what it printed was already on the leg cards below.** The locked-target column named which leg was locked and to what — the same two facts a leg card's status chip and form fields already carry — so a reader met the same pair of numbers twice before reaching a single control. The one fact it carried *alone* (the modem's own `AT+QNWLOCK` read-back, as against the `config` the forms are seeded from) did not disappear; it moved into the leg card that owns it, inches from the values it can contradict. See [The modem read-back line](#the-modem-read-back-line).

**Short version of the fourth: a merged hero has exactly one title, and that title had to be the automation copy — so the live strip sat as an unlabelled preamble under a heading about reboots and schedules.** A heading names the thing beneath it, and this one named the wrong thing. Split, each section states its own subject and the freshness stamp can head the section it actually dates. The task-order argument that promoted the automation group survives the split intact: the target is chosen once, while the unattended behaviour is checked every visit, so the two read-and-decide sections lead and the two three-field forms come last.

This doc records the things a future contributor will otherwise "clean up": why the lock read-back is deliberately *not* polled, why the freshness stamp heads the "Right now" section rather than sitting on the verdict, why the failover chip is a shield rather than a spinner, why there is exactly **one** way to apply a lock and no `Switch` anywhere near it, why `sendLockRequest`'s guard is an in-flight ref and must never go back to `watcher_running`, and why unlocking quietly turns the user's failover preference off.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking/tower-locking` (`app/cellular/cell-locking/tower-locking/page.tsx`) |
| Page coordinator | `components/cellular/tower-locking/tower-locking.tsx` |
| Geometry + tone contract | `components/cellular/tower-locking/shapes.ts` |
| Section 1 shell + header ("Right now") | the `TOWER_HERO` `<section>` in `tower-locking.tsx` — **no child renders it** |
| Section 2 shell + header ("While nobody is watching") | the `TOWER_SECTION` `<section>` in `tower-locking.tsx` — **no child renders it** |
| Live strip (section 1's body, read-only) | `components/cellular/tower-locking/live-strip.tsx` |
| Automation tiles (section 2's body) | `components/cellular/tower-locking/automation-tiles.tsx` |
| Schedule tile (the third automation tile) | `components/cellular/tower-locking/schedule-tile.tsx` |
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
| Failover systemd unit | `scripts/etc/systemd/system/qmanager-tower-failover.service` |
| Shell library (AT + config CRUD, `tower_write_begin`) | `scripts/usr/lib/qmanager/tower_lock_mgr.sh` |
| Schedule daemon | `scripts/usr/bin/qmanager_tower_schedule` |
| Per-read honesty flags | `modem_state.lte_read_ok` / `nr_read_ok` / `persist_read_ok` — **absent means `true`**, test `=== false` |
| Write-settle marker | `/tmp/qmanager_tower_write_inflight` (`root:root 0666`, seeded in `qmanager_setup`; holds a future UNIX deadline) |
| Failover activation flag | `/tmp/qmanager_tower_failover` — cleared by the unit's `ExecStartPre`, **not** on stop |
| Schedule timer arm helper (root) | `scripts/usr/bin/qmanager_tower_schedule_arm` |
| Config file | `/etc/qmanager/tower_lock.json` |
| Live carriers (the ACTUAL view) | `hooks/use-modem-status.ts` → `network.carrier_components` |
| i18n | `tower_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**155 keys per locale**, identical key paths across all five) |
| Cell Scanner link (page header action) | `radio_info.bands.scanner.link` → `/cellular/cell-scanner` — see [The page header gained one action](#the-page-header-gained-one-action) |
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
│   └── actions: "Open cell scanner" → /cellular/cell-scanner
├── error notice + Retry                   (tower.error && !tower.isLoading)
├── warning notice + dismiss               (tower.lastWarning)
└── motion cascade
    ├── <section TOWER_HERO>               ← "Right now"; rounded-hero, the ONE anchor
    │   ├── SECTION_HEAD                     h2 + META (freshness STAMP + refresh)
    │   └── TowerLiveStrip                 ← body only; NO shell, NO header
    │       ├── VERDICT_BLOCK
    │       └── STRIP_PANEL → CARRIER_GRID (tiles + CARRIER_NOTE_TILE)
    ├── <section TOWER_SECTION>            ← "While nobody is watching"; rounded-card
    │   ├── SECTION_HEAD                     h2 + DESCRIPTION
    │   └── TowerAutomationTiles           ← body only; NO card, NO header
    │       ├── persist tile
    │       ├── failover tile (switch + threshold + gated meter)
    │       └── ScheduleTile
    └── grid (1 col → 2 at @3xl/main)
        ├── LteTowerCard
        └── NrSaTowerCard
```

The reading order is **what is happening now** (section 1), then **what happens unattended** (section 2), then **where the lock points** (the leg cards). Three objects: one `rounded-hero` section, one `rounded-card` section, and one 2-up of peer cards.

### Two sections, not one merged hero

For one revision the strip and the tiles shared a single `TOWER_HERO`, and the doc argued they were "the premise and the standing orders that act on it". The split reverses that, and the reason is a heading rather than a shape: **a card has one title, so the merged hero's title had to be the automation copy — which left the live strip as an unlabelled preamble under a heading about reboots, failover and schedules.** A heading is a promise about what sits under it, and that one was false for the first thing a reader met.

Splitting also frees the freshness stamp. Merged, a stamp in the card header would have appeared to date the three settings tiles as well; the only honest home left for it was the verdict block. Split, `SECTION_HEAD.META` on "Right now" dates exactly the content that has a clock — see [Freshness heads the section](#freshness-heads-the-section).

Only `TOWER_HERO` keeps `rounded-hero` (40px). One anchor per surface, claimed by the section that **leads** the page; `TOWER_SECTION` is `rounded-card` (36px), a peer of the leg cards below it. The two shells are otherwise byte-identical, including the container name.

> ⚠️ WARNING: **both sections declare `@container/section`, and neither declares `@container/hero` any more.** That is what lets `SECTION_HEAD` and `AUTO_GRID` behave identically in either section without the constant knowing which one is hosting it. A stale `@container/hero` or `@container/card` variant left behind in this subtree would silently never match — the grid would stay single-column at every width, and the collapse would look like a design choice rather than a dead query.

**The coordinator owns both section shells and both section headers.** The two children render only their bodies. A child rendering its own `Card` would put a card inside a section; a child rendering its own heading would let the two headers' geometry drift apart. The header slots are used asymmetrically and deliberately so: "Right now" fills `SECTION_HEAD.META` (stamp + refresh) and skips the description, because the tiles under it demonstrate what it is; "While nobody is watching" fills `SECTION_HEAD.DESCRIPTION` and has no meta, because nothing in it has a clock.

Each section is labelled with `aria-labelledby` pointing at its own `<h2>`, never an `aria-label` — the heading is already on screen, and duplicating it as an attribute is how the two silently drift apart in translation.

The coordinator is the only component that calls a hook. It reads `useModemStatus` and `useTowerLocking` and hands everything down as props. There is no profile/scenario gate chain here — unlike Band Locking, no SIM profile or Connection Scenario writes `AT+QNWLOCK`.

### The page header gained one action

`CellularPageHeader`'s `actions` slot now carries a link to the Cell Scanner: `<Button asChild variant="tonal" className={PILL_ACTION}>` wrapping a `next/link` to `/cellular/cell-scanner`, with the `radar` glyph.

The scanner is where a target comes from when the cell you want is *not* one the modem is already camped on — the strip can only offer what is on air — so it belongs beside the page it feeds rather than only in the sidebar. `variant="tonal"` and not `default`: this navigates, it does not write to the radio, and the page's real primary actions are the leg cards' Lock buttons.

**It reuses `radio_info.bands.scanner.link` rather than adding a `tower_locking.*` key of its own.** One translated sentence pointing at one route; a second key would be the same English words translated twice, drifting the moment one of them is edited. `components/cellular/band-locking/live-band-hero.tsx` records the identical rationale for the identical borrow, and `components/cellular/radio/active-bands-card.tsx` is the key's original home.

## The two clocks

**Short version: two readings on this page sit inches apart, and one of them can be an hour old.** Pretending otherwise would be the surface's biggest lie, so the "Right now" section prints an explicit "as of HH:MM" in its header and offers a manual refresh instead.

| Reading | Source | Freshness |
| ------- | ------ | --------- |
| **The lock target** — the verdict's left operand, and the leg cards' "Modem reports" line | `modemState.lte_cells` / `.nr_cell`, read back from `AT+QNWLOCK` by `status.sh` | Fetched **once on mount**, never polled |
| **Camped on now** — the strip's carrier grid, and each leg card's `Serving` chip | `network.carrier_components` from the poller snapshot | Live, ~4s (see [poller cadence](radio-information.md)) |

**The stamp heads the "Right now" section, not a corner of the page**, and that placement is an argument rather than a layout preference. The original argument was that the verdict is computed from *both* readings, so it is only ever as fresh as its **stalest** operand — a conclusion drawn across two clocks has to wear the slower one. That argument is intact, and it is exactly *why* the stamp moved up out of `VERDICT_BLOCK` when the page split into two sections: **both** operands — the ~4s carrier grid and the once-on-mount lock read-back — now live inside the one section the stamp heads, and nothing else does. So it dates all of them rather than only the conclusion drawn from them.

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
| `TOWER_WRITE_SETTLE` | 30s | How long a tower-lock write marks itself in flight, so the watcher skips the reconnect blip. Lives in `tower_lock_mgr.sh`, not the daemon — see [The in-flight marker](#the-in-flight-marker) |

So the fastest path to a failover is `SETTLE + 3 × INTERVAL` ≈ **80 seconds**, and the daemon's main loop is `while true`. It exits in exactly two places: after a failover fires, and when a config re-read (every sixth cycle, ~120s) finds neither `.lte.enabled` nor `.nr_sa.enabled` true.

**Compare Band Locking.** `qmanager_band_failover` is bounded: `SETTLE_DELAY=5`, then `MAX_CHECKS=5 × CHECK_INTERVAL=5` — a ~30-second window that ends on its own and exits early the moment carrier data appears.

That asymmetry has two consequences, one visual and one that was a live bug.

### Why the chip is a shield, not a spinner

Band Locking's `FAILOVER_BADGE` maps a running watcher to `info` + a **spinning** `progress_activity`, which is correct there — a spinner describes a bounded operation that genuinely ends. Copied across, that spinner would run for **the entire life of the lock**: hours, days. It would read as a hung UI, and it breaks the One-Loop Rule (a live *process* is not live *work*).

So the tower map has **five** states, and the running one is a settled `armed`:

| Order | Condition | Key | Variant / glyph |
| ----- | --------- | --- | --------------- |
| 1 | `!failover.enabled` | `disabled` | `muted` / `do_not_disturb_on` |
| 2 | `failover.activated` | `fallback` | `warning` / `warning` |
| 3 | `failover.watcher_running` | `armed` | `success` / `shield` |
| 4 | enabled, nothing fired, no watcher, `presence === "present"` | `stalled` | `destructive` / `error` |
| 5 | … `presence === "unknown"` | `unknown` | `muted` / `help` |
| 6 | … `presence === "absent"` | `standby` | `info` / `schedule` |

`failoverKey(failover, presence)` in `shapes.ts` resolves it, and the order is significant. `activated` outranks `watcher_running` because a watcher that has already fired is reporting a fallback, not protection, even while it keeps looping.

**Rows 4–6 used to be one row.** The signature took a `hasActiveLock` **boolean** and returned `armed` when it was true — a claim that a watcher is watching, made in the one case where the config says a lock exists and no watcher is running. That is the reading it must never give, and it is reachable: `qmanager_tower_failover`'s give-up-honestly exit (see [the release is all-or-nothing](#the-failover-watchers-release-is-all-or-nothing)) leaves exactly `enabled && !activated && !watcher_running` with the lock still on.

The boolean was also why `unknown` had nowhere to land. `status.sh` seeds `lte_locked="false"` before it asks the modem anything, so a failed `AT+QNWLOCK` read arrives as `locked:false` — indistinguishable from a genuine "not locked", and the chip promised "nothing to guard" about a modem nobody had managed to ask. The fix is a third value, not a guard:

```ts
export type TowerLockPresence = "present" | "absent" | "unknown";
lockPresence(modemState): TowerLockPresence
```

`lockPresence` resolves it leg by leg: a leg that reports locked **on a successful read** settles it as `present`; failing that, any leg whose read failed makes the whole verdict `unknown`, because an unlocked-and-read leg cannot vouch for its unread sibling; only when both legs were read and neither is locked is the answer honestly `absent`. It tests `=== false`, never `!== true` — see [The `read_ok` contract](#the-read_ok-contract-absent-means-true).

`standby` is the state Band Locking has no equivalent for: **failover is switched on but no lock exists**, so no watcher is running and there is nothing to protect. Calling that "armed" would claim a safety net that is not deployed. It routes to the brand container under the Info-Is-Brand Rule — a standing condition, not a fault.

`stalled` is the only state on this chip that routes to `destructive`, because it is the only one describing something that is not *working*: the net should be out and it is not. Its `error` glyph is unused by the other four, for the reason the paragraph below gives.

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

**That is why the failover control lives in the automation tiles and not on either leg card.** Rendering it as a row inside the LTE card would say it protects LTE; it protects the modem. It sits with `persist` and the schedule in the one group whose three members are exactly the settings that belong to no single leg. See [The standing orders](#the-standing-orders).

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
2. **ABSENT MEANS `true`. Test `=== false`, NEVER `!== true`.** A statically-exported page bundle can outlive the CGI it talks to, so a cached client will meet an un-upgraded `status.sh` that emits none of these. `!== true` would repaint an entire working page as `unknown` the moment the two halves fall out of step. The fields are optional in `TowerModemState` for exactly this reason, and every consumer (`lockPresence`, `persistPosture`, `matchVerdict`, both leg cards) is written against `=== false`.
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

`/tmp/qmanager_tower_failover` is the trace that a failover **has fired**. It is what makes the `fallback` chip reachable, and until 2026-08-23 it was unreachable, because two pieces of the system encoded opposite intentions and the wrong one won:

- the daemon writes the flag on activation and then exits 0, and its own `EXIT` trap **deliberately spares** the flag so the trace outlives the process;
- the systemd unit's `ExecStopPost` deleted it on **every** exit — including that `exit 0`, milliseconds after it was written.

So `activated` was true for a window no poll could ever land in, and `failoverKey`'s `fallback` branch had never once rendered.

The delete moved to `ExecStartPre`. `ExecStopPost` now removes only the PID file. The flag's meaning is therefore precise: **a failover has fired since the watcher last started.**

```ini
ExecStartPre=-/bin/sh -c 'rm -f /tmp/qmanager_tower_failover'
ExecStart=/usr/bin/qmanager_tower_failover
ExecStopPost=/bin/sh -c 'rm -f /tmp/qmanager_tower_failover.pid'
```

That lifetime is what the chip's copy has to match, and it does: *"Released — weak signal"* is a past-tense report of an event, not a claim about a condition still in progress. It is self-consistent with the state it implies, too — the lock is gone, so there is nothing left to guard and `armed` would be a lie.

Two consequences:

- **`tower/lock.sh` no longer tries to `rm` the flag on its unlock branches.** Those two lines were dead: the CGI runs as `www-data`, the flag is root-owned, and `/tmp` is sticky — so `unlink` returns EPERM, and `rm -f` exits 0 regardless, making the failure invisible. Leaving a fired failover's flag in place until the next watcher start is now deliberate.
- **The daemon's give-up-honestly exit does not write the flag.** See [the release is all-or-nothing](#the-failover-watchers-release-is-all-or-nothing) — with the flag now surviving the daemon's exit, writing `activated` for an unlock that never confirmed would leave that lie in place indefinitely.

> ℹ️ NOTE: **no installer change was needed.** `install_rm520n.sh:1202` glob-installs every `qmanager*.service` unconditionally on every install and every OTA run, so a unit-file edit ships with the next update on its own.

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
| `persist_read_ok === false`, or no read yet (`modemState === null`) | `unknown` | `muted` / `help` |

`split` is a **real, reportable fault**, not a configuration anyone chose: one write went to both slots, so a split reading means one of them did not take. The tooltip swaps to `persist_split_help` in that state so the chip is explained where it is shown.

> ℹ️ NOTE — corrected 2026-08-23: **the `unknown` row existed but could not be reached.** It was gated on `modemState === null`, which a `success: true` response never produces. `status.sh` seeds both persist flags `false` before it asks the modem anything, so a **failed** read arrived here as `false, false` and rendered the muted `Disabled` chip — "the user turned this off". That was the single most dishonest pixel on the surface, because it describes a deliberate choice nobody made. `persist_read_ok === false` is what makes the branch reachable; see [The `read_ok` contract](#the-read_ok-contract-absent-means-true).
>
> The glyph moved from `schedule` to `help` at the same time. A clock says *"waiting, this will arrive"*; the state is *"the modem did not answer and nothing is coming until you retry"*. It also has to stay distinct from `off`'s `do_not_disturb_on` — both are `muted`, so the glyph is the **only** thing separating "switched off" from "never read". The same swap was made on `LEG_BADGE.unknown`, for the same reason.

The persist tile keeps both channels visible on purpose: **the chip reports the modem, the switch drives the config.** They can disagree, and when they do, the `split` chip is the only thing on screen that would tell you.

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

The hook exposes them as a `TowerWarningCode`:

```ts
export type TowerWarningCode =
  | "service_enable_failed"
  | "service_disable_failed"
  | "persist_command_failed";
```

It reports **the code, not a sentence** — rendered copy lives in the components, where `useTranslation` is, so a warning can never ship as an English literal from inside a hook that has no namespace. The coordinator maps it to `tower_locking.warning.{code}` and renders a dismissible `role="status"` notice above both sections (`clearWarning()`), and every subsequent write clears it first.

**Both are `warning`, never `destructive`.** The operation landed on the modem — the radio *is* locked. Painting that red would tell the user their lock failed when it did not. `NOTICE_TONE.warning` is the partial-success channel on this surface.

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

## The standing orders

**Three answers to one question.** Persistence, signal failover and the schedule were three separate objects on this page: two rows buried at the foot of an old hero rail, and a whole card of its own sitting in a 2-up grid as the orphaned third cell beside empty space. Nothing said they were related, and the schedule in particular read as a feature parked wherever there happened to be room — at the same visual rank as the two lock forms, while answering a different question from either of them.

They are all the same question — **what does this lock do when nobody is looking?** — asked about three different absences: across a reboot, during a signal collapse, and on a clock. Grouping them is what turns "three settings" into one thing a reader can hold.

**They sit second, directly under "Right now", where they used to be the page's last card.** The order the old layout encoded — see where you are, choose where to point, then decide what happens unattended — describes the **first session only**. After one setup the target rarely moves, while everything a returning reader wants is in the top two sections: is the lock holding, does it survive a reboot, is the safety net armed, is the window still right. The two three-field forms come last because after the first session they are the part nobody opens.

```
<section TOWER_SECTION>                   rounded-card (36px) — a peer, not a second anchor
  ├── SECTION_HEAD                        h2 "While nobody is watching" + DESCRIPTION
  └── <div AUTO_GRID>                     1 → 2 at @xl/section → [1fr 1fr 1.5fr] at @4xl/section
      ├── AUTO_TILE     restart_alt       persist: switch + PERSIST_BADGE + help copy
      ├── AUTO_TILE     shield            failover: switch + FAILOVER_BADGE +
      │                                     threshold Input/SaveButton + AUTO_METER
      └── ScheduleTile  (AUTO_TILE)       enable + window + day chips
```

Every tile inside the section is `rounded-tile` (28px) on `surface-container` — a step below the section's `rounded-card` (36px), per Radius-Follows-Size, and the same step the live strip's panel uses in the section above, so the two sections' inner units read as peers. `TOWER_HERO` claims the Consistent-Layout Rule's "a genuine glance surface may earn a hero card" exception on its own; nesting card- or hero-radius panels inside either section would spend that exception twice on one page.

The columns are **stepped, not equal thirds**: the schedule carries seven 44px day chips plus two time fields and genuinely needs the room, where persistence is a label and a switch. Equal thirds either wrap the weekday row or leave the first tile mostly empty.

`AUTO_TILE` is deliberately **not** the retired `HERO_ROW`. That shape painted `bg-surface`, correct on an old hero's `surface-container` panels and invisible here, where the host section *is* `bg-surface`. Same failure mode `CONTROL_ROW` / `CARD_ROW` already documents for the leg cards.

> ⚠️ WARNING: `AUTO_GRID` queries **`@container/section`** — not `@container/card`, and no longer `@container/hero`. These tiles have now lived in a `TOWER_CARD`, in a `TOWER_HERO`, and in a `TOWER_SECTION`; every move left a dead query behind it. `section` is declared by *both* shells, which is what makes the tiles portable between them. Nothing in `automation-tiles.tsx` imports a container name, and that is the point.

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

**The question this page exists to answer is not "what is the modem doing" and not "what did I ask for" — it is whether those two are the same thing.** The strip is the body of the "Right now" section, and it is two parts read as one clause:

```
VERDICT   ▸   CAMPED ON NOW
```

The verdict is the only genuinely *new* fact the page can compute — neither the modem's lock read-back nor the poller's carrier list carries it alone — so it leads. The camped grid is the evidence behind it, and it stays on screen rather than collapsing to a count because **every tile in it is a lock target one click from a form**.

`TowerLiveStrip` renders **no shell and no header**. The `TOWER_HERO` section, its `<h2>` and the freshness stamp all belong to the coordinator; this component is content only.

```
<div STRIP_GRID>                          1 col → [18.5rem minmax(0,1fr)] at @3xl/section
  ├── VERDICT_BLOCK   rounded-tile        disc + title + body   (no stamp)
  └── STRIP_PANEL     rounded-tile        CAMPED ON NOW: live-dot header + count,
        │                                   @container/panel
        ├── CARRIER_GRID                  1 → 2 at @md/panel → 3 at @2xl/panel
        │   ├── CARRIER_TILE  × n         one per camped carrier
        │   └── CARRIER_NOTE_TILE         fills the grid's ragged remainder
        ├── CAMPED_ABSENT                 only when exactly one carrier is on air
        └── STRIP_FOOTNOTE                pinned with mt-auto
```

**Two container scopes, and the distinction is load-bearing.** `STRIP_GRID` queries `@container/section`, which both section shells declare, so the two-column split responds to the section's width. `CARRIER_GRID` queries `@container/panel`, declared by `STRIP_PANEL` itself — because the carrier column sits in the *right* track of a grid whose left track is a fixed `18.5rem`, so the space it actually has is not a function of the section's width alone. A `/section` query on the tile grid would count space the verdict column has already taken.

The verdict column is a **fixed `18.5rem`**: it holds a state word and one line of consequence, so letting it flex would stretch a two-word conclusion across half the section. Everything else goes to the carrier grid, which is the part with a variable number of tiles.

`STRIP_GRID` is **`items-start`, not `items-stretch`**, and that is a correction rather than a preference. Stretching made the verdict as tall as a three-carrier grid and left ~90px of empty container between its body copy and its floor — on a *saturated* `success-container`, where a void is the loudest thing in the section. A conclusion sizes to itself; only the grid it judges grows.

### Three columns became two, and what happened to the third

**The retired column printed which leg was locked and to which (channel, PCI) pairs — both already on the leg cards below.** It was a set of clickable leg rows, each followed by an indented `TARGET_CELL` list with the serving pair marked, and a `LEG_BADGE` chip; `scrollToLeg()` scrolled from a row to the matching card. All of that is gone, and the deletion is the point: a reader met the same pair of numbers twice before reaching a single control, and the read-only half of a settings page was the tallest thing on it.

The single fact it carried alone moved to the leg cards — see [The modem read-back line](#the-modem-read-back-line).

> ⚠️ WARNING: do not reintroduce a locked-target panel, a "match line", or a target-summary rail as a tidy-up. It looks like the honest thing to add to a page whose subject is a lock, and it has been tried twice. The facts it would carry are on the leg cards; the only reading that was ever unique to it is now printed inside the card that owns it.

**Smaller, not lesser.** The verdict dropped from a 176px centred tile to a left-aligned block, and the camped carriers from one 172px identity-filled lead block plus a list of one-line rows to a uniform grid of 87px tiles. Every *reading* that identifies a cell survived. Centring is what made the old verdict read as the page's headline metric; at strip scale it is a sentence about the section it opens, and a sentence starts at the left margin.

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
- **The neutral fill is `surface-container`, matching the carrier panel beside it.** `bg-surface` would be the section's own fill and would render the block invisible.

The disc is mandatory rather than decorative. `success-container` and `warning-container` measure 1.03:1 apart and are the same surface under deuteranopia, so the container fill *cannot* be the channel separating "on target" from "not on target". The filled disc on the role's **strong** fill is (Glyph-Disc Rule). The three neutral verdicts share one fill, so each carries a distinct glyph for the same reason.

#### Freshness heads the section

**`VERDICT_BLOCK.STAMP` no longer exists.** The `schedule` glyph, the `as of HH:MM` label (or `synced_never`) and `HERO_REFRESH_BUTTON` now sit in `SECTION_HEAD.META` on the "Right now" header, rendered by the coordinator.

**The argument that put the stamp on the verdict is what moved it.** A verdict is only ever as fresh as its **stalest** operand — a conclusion drawn across two clocks has to wear the slower one — and while the strip and the automation tiles shared one card, the verdict block was the only place that could say so without appearing to date three unrelated settings. Split into two sections, *both* operands (the ~4s carrier grid and the once-on-mount `AT+QNWLOCK` read-back) live inside the section the stamp heads, and nothing else does. So the stamp now dates all of the evidence rather than only the conclusion drawn from it. See [The two clocks](#the-two-clocks).

The stamp itself is `SECTION_HEAD.STAMP`: a 28px `surface-container` pill, `tabular-nums` but deliberately **not** `font-mono` — the machine's voice covers the timestamp, not the sentence wrapped around it. `META` carries `ml-auto` rather than putting `justify-between` on the header root, because that row wraps: with three children and `justify-between`, a wrap leaves the description marooned against the right edge of its own line.

The refresh button is a 22px glyph whose `before:` overlay reaches the project's 44px coarse-pointer floor without adding a layout box that would push the timestamp off its baseline. Its spinning state is `motion-reduce`-guarded and mirrored to an `sr-only` `aria-live` region.

> ⚠️ WARNING: `HERO_REFRESH_BUTTON` still **inherits its colour** (`text-current`, opacity-stepped) rather than declaring `on-surface-variant`, even though it no longer sits on a tonal fill. That inheritance was written for the verdict block, where a hardcoded neutral grey would have been a grey glyph on an amber container; it survived the move unchanged and is kept so the button can be dropped back into a tonal host without a second look. Do not "tidy" it to an explicit ink.

### Every camped carrier is a peer tile

**No carrier leads.** Every camped carrier gets the same two-line `CARRIER_TILE` in a wrapping `CARRIER_GRID`, and primacy is carried by the identity chip alone — `LTE PCC` against `LTE SCC`, `NR PCC` against `NR SCC` — and by nothing else: not by area, not by anatomy, not by fill.

That is the honest shape, and reaching it took two corrections in a row. The first replaced a 3-up grid of 168px identity-filled tiles with one full-anatomy lead block over a list of one-line secondary rows, and its governing rule was recorded as **the lead is distinguished by ANATOMY, not by area** — a correction of a version that had made the primary a 172px saturated identity tile, i.e. the largest object on a settings page. That rule is what makes the uniform grid work, taken one step further: *the lead is distinguished by neither*. A shape that has to shout to establish rank has already spent more paint than the rank is worth, and the identity chip was doing the job on its own by the time the anatomy shrank to two lines.

**`AT+QNWLOCK` pins a PRIMARY cell**, so the ranking was never wrong — but aggregation is *context* here rather than the subject. A reader looks at the SCCs to answer "what else is on air", and **a secondary is a legitimate lock target the moment the network reselects**. Giving it a visibly lesser affordance implied a ranking the AT layer does not have.

Tower locking targets an (EARFCN, PCI) pair. A `CarrierComponent` already carries `earfcn`, `pci`, `band` and `rsrp` — so **every carrier the radio reports is describing a cell the user could lock to**, and making them retype those same digits into a text box underneath is the whole reason a parallel "Simple Mode" dropdown had to be invented as a second input path.

**One entry per raw `CarrierComponent`, not per unique cell.** Ordering is `sortCarriers()`: PCC first, then LTE before NR. `Array.prototype.sort` is stable, so carriers of equal rank keep the order the radio reported them in. LTE leads because the LTE leg is the anchor in NSA — it is what a reader looks for when a 5G connection misbehaves.

Tile anatomy, top to bottom:

| Line | Content |
| ---- | ------- |
| `HEAD` | An outline `Tag variant="lte"\|"nr"` reading `"LTE PCC"`, the band designator (`BAND`, mono), then the action — the pick button, or the filled `lock` chip when this tile *is* the lock target |
| `BODY` | the `PCI` label and its value (`PCI_VALUE`, `text-xl`), with `RSRP` pushed right by `ml-auto` |

**Nothing in this grid is identity-filled, and that is what lets every picker be an ordinary neutral control.** A saturated `bg-primary` / `bg-lte` block forces every element inside it to be drawn as an alpha over its own ink, because a role colour on an identity ground is either invisible or brand-on-brand — three tone helpers (`carrierTileTone`, `carrierPillTone`, `carrierMeterTone`) existed only to serve that, and all three retired with the fill. `CARRIER_TILE.ROOT` is plain `bg-surface`, one step *recessed* from the panel's `surface-container` rather than climbing to `surface-container-high` as the mock does: that keeps the top rung of the tonal ramp in reserve for the things that genuinely sit above the page's ground (the action pill, the disabled disc), and it is the same relationship the retired lead block and secondary rows already used, so nothing about the tone changed when the anatomy did. Identity travels on the outline `Tag variant="nr"|"lte"` each tile carries — a role border and role ink over a transparent fill, which is the only form identity takes in this system.

`CARRIER_GRID` uses **`gap-3` (12px), not the mock's 8px.** Each tile's action carries a `before:` overlay reaching 6px past its paint on every side to make the 44px coarse-pointer floor; at 8px the overlays of two horizontally adjacent tiles would leave a 0px dead lane between them, and on a tablet a tap in that lane resolves to whichever tile won the stacking order.

#### The third metric line was cut, and one of the reasons was a correctness hazard

The mock this grid comes from carried a third line per tile — `EARFCN · RSRQ · SINR` — and it is gone for two reasons, only one of which is about density.

- **It was redundant.** The channel and its quality figures are already printed by the leg card that owns the lock, inches below.
- **Its NR form printed a guess in the typeface of a measurement.** `CarrierComponent` has no subcarrier spacing, so an NR tile could only fill that slot by looking the SCS up in a **band table** — the same `defaultScsForBand` fallback the NR card is careful to flag as a guess. Rendered in mono, tabular, beside two real readings, it would have claimed the authority of something the modem reported. That is a state-honesty failure, not a layout one, and it is the reason this line must not come back even if the density budget later allows it.

The two readings that survive are **PCI and RSRP**, which are exactly the pair that names a cell and says whether it is worth having.

#### The locked-target marker: three channels, never colour alone

A camped tile whose carrier *is* the cell the modem currently reports as its lock target gets marked three ways at once:

1. **`CARRIER_TILE.MATCH`** — a 2px **inset box-shadow in `--primary`**, painted on the tile.
2. **A filled `lock` chip replaces the pick button** — a `size-8` `primary-container` disc with a filled `lock` glyph, non-interactive, in the exact slot the `add` button would occupy. There is nothing to pick, so there is no button.
3. **An `sr-only` sentence** (`tile_locked_a11y`, "Band {{band}}, PCI {{pci}} is the current lock target"), because a ring is a shape signal with no name.

`isLockTarget()` in `live-strip.tsx` is the same comparison `matchVerdict()` makes in `shapes.ts`, read from the other end: `matchVerdict` asks "is any camped carrier a target" to produce one page-level verdict, `isLockTarget` asks "is *this* carrier a target" to mark one tile. Both gate on `*_locked` first — a stale `lte_cells` array behind a false `lte_locked` is not a target — and both compare the exact (channel, PCI) pair, so a tile can never be ringed by a rule the verdict above it disagrees with.

> ⚠️ WARNING: the marker is deliberately **not** the mock's `outline: 2px solid var(--ok)`. Two separate rules land on that outline: Fill-Over-Stroke forbids a coloured stroke on a tonal container, and a functional role (`--success`) is never a legal stroke colour in the first place. The inset shadow is the sibling route's answer to the identical problem — see `BAND_CHIP_LIVE_RING` in `components/cellular/band-locking/shapes.ts`. It costs no layout box, it paints in `--primary` rather than in a health role, and it is a *shape* signal, so it survives greyscale and every colour-vision deficiency. `CARRIER_TILE.ROOT` names `box-shadow` explicitly in its transition for this reason; a bare `transition-all` would inherit Tailwind's off-scale 150ms and stop responding to a retune of `--duration-standard` (The One-Scale Rule).

#### Why the tile itself is not a button

**A block holding four discrete numbers is ambiguous as a single click target** — a reader cannot tell whether the RSRP figure is itself actionable. So the tile stays a *report* and carries one small labelled action inside it, which removes the guess. When the tile is already the lock target that action becomes the filled `lock` chip above: a report needs no control.

This used to be an accessibility-and-tone argument as well: while the lead block was identity-filled, a whole-block button would have been a violet control, which the Identity-Never-Acts Rule forbids outright. That constraint went with the fill, and the UX argument is the one that keeps the shape.

**A carrier that cannot currently be targeted gets its control DISABLED with a reason, never a missing control.** `canTarget` in the coordinator computes the gate per leg:

| Leg | Blocked when | Reason key |
| --- | ------------ | ---------- |
| `lte` | all three slots are full (`lteFreeSlots === 0`) | `tile_blocked_slots_full` |
| `nr_sa` | `networkType === "5G-NSA"` | `tile_blocked_nsa` |
| `nr_sa` | `networkType === "LTE"` or `""` | `tile_blocked_lte_only` |

An NR carrier is visible but not SA-lockable while the modem is in NSA mode; silently dropping the control there would leave the user to infer the rule. The reason renders in a tooltip on the disabled control (but see [Known gaps](#known-gaps) — the HTML `disabled` attribute makes that tooltip unreliable in Chrome).

**The glyph, not the opacity, is what separates the two states.** A pickable tile's action carries `add`; a blocked one carries `do_not_disturb_on`. The primitive's 45% disabled opacity is the first thing to go in sunlight, which is the ambient condition this product is designed against.

A carrier with no PCI **or** no channel gets no control at all (`addressable`), because the AT command needs both halves of the pair — there is nothing to disable-with-a-reason, the cell simply is not addressable.

#### PCI is the headline here, where band is the headline on Band Locking

This is the one place the tile deliberately departs from its Band Locking sibling, which is otherwise the same anatomy. On that surface the reader is choosing a **frequency**, so the band designator is the answer. On this one they are choosing a **physical cell**, and PCI is its name. Same anatomy, different value promoted, because the question the surface asks is different.

`CARRIER_TILE.PCI_VALUE` is `text-xl` (20px) mono/tabular, against the band designator's 12px and the RSRP's 13px — two steps of rank inside a tile 87px tall.

**The RSRP tint is never the only channel — and it now runs on three.** `CARRIER_TILE.RSRP` ships **no colour of its own**. The component tones it via `qualityInkClass(quality)` from `components/cellular/signal-quality-display.ts` (the canonical map), draws a 56px gauge beside it, and pairs both with an `sr-only` quality word from `radio_info.bands.quality.*`.

It used to take `getValueColorClass()` off the functional three — `success-on-surface` / `warning-on-surface` / `destructive-on-surface`. That mapping had **four** levels to spend, which is one too few for the call a reader makes here: this is the surface where they decide whether to *lock* to a cell, and "weak but recoverable" and "not this cell" landed in the same bucket. The five-stop ramp (2026-08-17) splits them at RSRP −120. The old contrast measurement that forced the `-on-surface` steps still stands, and the ramp respects it by construction: `--quality-N` is tuned as ink against its ground, which is why its light-mode low stops resolve to deep reds and browns rather than vivid red-orange. That is a gamut ceiling — see [color-system.md](color-system.md) > The signal-quality ramp.

#### The signal meter came back as a 56px lane (2026-08-17)

**Short version: the objection that killed the meter was correct, and still is — about the shape it killed. What changed is that the ramp made an unaccompanied tint unsafe, so the choice became "add a gauge" or "drop the tint", and adding the gauge won.**

The old lead tile drew a 6px quality bar under its detail line, toned by `carrierMeterTone`. Rebuilt at tile scale it drew a 4px **identity**-coloured bar across the tile's full width directly under the detail line, and **on screen that reads as a coloured bottom border rather than as a gauge** — the exact tell the craft floor bans. It was also a third channel reporting what two elements already reported: the `Tag variant="nr"|"lte"` says *which radio*, the dBm figure says *how weak*. It was cut for both reasons.

What reopened it is the five-stop ramp. The ramp is a lightness staircase, not a hue wheel, so **adjacent stops sit deliberately below the 0.05 CVD separation floor** on the explicit understanding that bar *length* carries the fine distinction. Ramp ink with no bar beside it is therefore a bug rather than a shortcut. Since the RSRP figure on this tile was already tinted, the options were to add a gauge or to drop the tint and render the figure neutral. Keeping the tint was the deliberate call, on the grounds above: this is the surface where the recoverable/hopeless distinction decides an action.

**Both halves of the original objection still bind the new shape**, and a future change must keep them binding:

| Original objection | How the 56px lane answers it |
| ------------------ | ---------------------------- |
| It drew an **identity** colour | It draws a **measurement** — `signalToProgress(rsrp, RSRP_THRESHOLDS)` in `--quality-N-bar`. Identity stays on the outline `Tag`, which no meter may borrow |
| Full-bleed under the last line, reading as a bottom border | It is a **short lane inside the body row**, immediately left of the figure it belongs to, so it reads as belonging to that number |

Staying inside the existing row also keeps the tile at the **87px** `SKELETON_SHAPE.CARRIER_TILE` mirrors. A meter given its own row would grow the tile to ~99px and break that mirror silently — a floor cannot be a mirror, and neither can a stale one.

The redundancy the original objection named is real and is now the *point*: the bar restates the figure on purpose, because that restatement is the accessibility mechanism, not clutter. `rsrpToPercent` remains uncalled on this page — the lane uses `signalToProgress`, and `AUTO_METER` in the failover tile is still a different object entirely, reporting a **device-wide** quality against a threshold in `bg-primary` because it draws a magnitude the amber marker judges.

#### The note tile, the absent-leg note, and the empty state

Three different absences, three different treatments, and they are deliberately not interchangeable.

**`CARRIER_NOTE_TILE` always renders, as the last child of the grid**, and its job is to say what the empty cells *mean* rather than letting the grid trail off. Two readings: with more than one carrier on air it prints `note_ca_counts` ("3 LTE, 2 NR") over `note_ca_body` ("Aggregation is live. Only the primary cell can be locked."); with one or none it prints `note_solo_title` / `note_solo_body`. It carries `role="listitem"` even though it is not a carrier — every child of a `role="list"` must be a list item, and this one genuinely belongs to the set, because it describes where the set stops.

It is the **one dashed stroke sanctioned on this surface**. Fill-Over-Stroke bans a border drawn *around content*; this border is drawn around an *absence*. It is `border-outline` at 1px, and it is deliberately **not** a filled tile: with every real carrier on `bg-surface`, a filled note would enter the reading order as one more carrier.

**`carrierNoteSpan(carrierCount)` makes it fill the grid's ragged remainder.** CSS cannot do this on its own — there is no "span to the end of the row" for an item whose start column is implicit — so the span is computed from the carrier count against each of `CARRIER_GRID`'s three column counts. A count that divides evenly means the note starts a fresh row and takes the whole of it, which is exactly what a 3-carrier, 3-column layout should do. The classes are written out as **literals** in two lookup tables, never interpolated: Tailwind scans source text, so `@2xl/panel:col-span-${n}` would compile to nothing. The base one-column case needs no class at all, since one column *is* the row.

**`CAMPED_ABSENT` renders only when exactly one carrier is on air**, below the grid, and names the radio leg that is *not* present (NR when the lone carrier is LTE, and vice versa). With several carriers aggregated the grid already fills honestly. It is a **note, not a tile**: a second tile claiming "no 5G" would enter the reading order as a carrier, and would read as an editorial claim that the absence is a fault — on a modem whose SKU may not even support SA, it often is not.

**The empty state** (`camped_empty_title` / `camped_empty_body`) replaces the grid entirely when nothing is camped — the panel's header and footnote survive, the tiles and both notes do not. It and the absent-leg note therefore can never share a frame, which is why both can safely use the `signal_cellular_off` glyph.

The panel header carries a live-pulse dot using **`.animate-live-ping`**, the project's own keyframe in `app/globals.css` (running on `--duration-ambient` / `--ease-ambient`), **not** Tailwind's built-in `animate-ping`. They look similar and time differently; `animate-ping` here is an off-scale duration under The One-Scale Rule. It is `motion-reduce:animate-none`-guarded. Beside it, `ml-auto` parks the `camped_summary` count ("3 carriers across 60 MHz"), summed from each carrier's `bandwidth_mhz`.

The panel's footnote (`camped_note`, on `STRIP_FOOTNOTE`) pre-empts the single most likely misreading: these are the cells the radio reports, not the cells you locked. A locked cell only appears here once the modem camps on it — and the cells you *did* lock are printed on the leg cards, under "Modem reports".

## The prefill bus

Clicking "use this cell" on a live-strip carrier tile has to reach a form owned by a **sibling** card, so the coordinator brokers it: `handlePickCarrier` routes the picked `CarrierComponent` to `ltePrefill` or `nrPrefill`, each `{ cell, nonce }`.

**The payload carries a nonce because picking the same cell twice must still register.** Without it, a second click produces an identical object and the receiving card's render-time comparison sees no change — yet re-picking a tile after editing the fields is a meaningful gesture (it restores that carrier's values).

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

The corollary is in the standing-orders section: the only switches that write anything are now the three automation settings, each of which saves the instant it moves. See [A switch on this page means one thing](#a-switch-on-this-page-means-one-thing).

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

> ℹ️ NOTE: the copy still comes from `tower_locking.live.rail_target_pair`, a **fossil** of the long-retired lock-posture rail and now the only surviving `rail_*` key. It was deliberately not renamed: a rename touches five locale files and re-translates nothing, so the tidy-up buys nothing and risks breaking five files to no end. (When this was written the risk was *silent* — `i18n:check` graded a missing key as a warning and exited 0. Since 2026-08-12 a half-finished rename would fail the gate loudly instead, which lowers the risk but does not create a reason to do it.) Read `rail_target_pair` as "one channel/PCI pair".

#### The `LEG_BADGE` inversion: `locked` is a warning, `unlocked` is a success

| Posture | Variant | Glyph |
| ------- | ------- | ----- |
| `locked` | `warning` | `lock` |
| `unlocked` | `success` | `lock_open` |
| `unknown` | `muted` | `schedule` |

This reads the **functional contract**, not a value judgement about locking. Pinning the radio to one physical cell is the state that can cost you the connection, so `warning` means *constrained* — not *you did something wrong*. It is the same inversion Band Locking applies to a narrowed band list, for the same reason, and keeping the two consistent is what lets a user cross the three `/cellular/cell-locking/` routes in one task without relearning the colour language.

**`unknown` is a real state, not a loading placeholder.** A surface that renders a failed read as a confident "Unlocked" is asserting something nobody read back. So the posture is `unknown` whenever `modemState` is null, and the chip says so.

> ℹ️ NOTE — corrected 2026-08-23, and **the null test alone was never enough**. `modemState` is null only before the first fetch or on an HTTP-level failure; `status.sh` has always answered a literal `success: true` with a populated object, so on a failed AT read the posture above could not fire and the chip said "Unlocked". The backend reached the same wrong answer for the same reason: it only ever pattern-matched the printed text of `tower_read_lte_lock` / `tower_read_nr_lock` / `tower_read_persist`, so a failed read fell through the `locked*` arms and was published with a fabricated "unlocked, persistence off" `modem_state`. All three helpers had always returned the correct exit status; nothing read it.
>
> `status.sh` now captures all three return codes and reports them **per field** as `lte_read_ok` / `nr_read_ok` / `persist_read_ok`, which is what makes `unknown` an honest trigger. It deliberately does **not** refuse the whole endpoint on a single failed read — one bad NR read must not blind the UI to the two that succeeded. The three `error)` arms that logged a warning and continued are gone; the return codes carry that now. `tower_read_persist`'s failure sentinel also moved from a fabricated `"0 0"` to the string `"error"`, matching its two siblings, so a future caller that forgets to check `$?` at least cannot mistake a failed read for a legitimately-read "persistence off". Full contract: [The `read_ok` contract](#the-read_ok-contract-absent-means-true).
>
> The glyph moved from `schedule` to `help` in the same change — a clock implies "waiting, this will arrive", where the real state is "the modem did not answer". `unknown` and `unlocked` are separated by `muted` vs `success-container`, which measure ~1.03:1 apart and are the same surface under deuteranopia, so the glyph is the only separator every reader is guaranteed to get.

That fabrication was not confined to this page. `frequency/lock.sh` calls the same two helpers for its mutual-exclusion gate, and a read failure there walked a user straight toward the stacked-lock path that file's header warns can crash-dump the modem. See [frequency-locking.md](frequency-locking.md#the-tri-state-tower-lock-contract).

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
- **The empty state is inline, not a branch.** Band Locking can replace its whole content region when a category reports no supported bands; this card cannot, because its empty copy is "Pick a cell from the list above, or type a channel and PCI" and swapping out the slots would remove the very fields that sentence points at. So "no targets yet" renders *above* the slot list.

#### A slot is a ROW, not a panel

`FIELD_SLOT` and `FIELD_SLOT_HEAD` are gone. A slot is now a single row on `SLOT_ROW`:

| Key | Role |
| --- | ---- |
| `ROOT` | The filled row — `min-h-14` (56px), `rounded-field`, `bg-surface-container`, wrapping |
| `EMPTY` | The unfilled variant: same geometry, **no fill**, 1px dashed `border-outline` |
| `INDEX` | The `Cell N` heading, `min-w-[3.25rem]` |
| `FIELDS` | The wrapping flex line holding the two controls, `min-w-0` |
| `META` | `ml-auto` — the `Serving` chip (when applicable) and the per-slot clear button |

**This replaces three stacked `rounded-tile` panels**, each a heading row over a two-up field grid, which put roughly 130px of card between "Cell 1" and "Cell 2" and made a three-slot lock taller than the whole section above it. A slot holds two short numbers and a status; it is a row, and at 56px it clears the 44px coarse-pointer floor with room for the controls it hosts.

**The inputs stay live in every state, including the dashed empty one.** The mock only ever drew the settled, read-only card, and reading it literally would delete this card's primary input path — the whole point of a slot is that the pair inside it can be *typed* as well as picked from a carrier tile. `EMPTY` takes no fill for a related reason: a dashed border over `surface-container` reads as a disabled control rather than as an open slot.

`FIELDS` carries `min-w-0` so the two controls shrink before `META` gets pushed off the row, and each declares a `flex` shorthand rather than a width — `SLOT_FIELD_CHANNEL` is `flex-[2_1_8.5rem]`, `SLOT_FIELD_PCI` is `flex-[1_1_5.5rem]`. The channel gets twice the growth because an EARFCN runs to five digits against a PCI's three, and in Simple Mode the same box hosts a `Select` whose option text is far longer than either. Below roughly `8.5rem + 5.5rem` plus the index label the line wraps and the two fields drop under `Cell N` intact — the degradation the row was designed for, and the reason neither carries a fixed `w-`. `INDEX` is `min-w-`, not a hard `w-`, so a locale whose word for "Cell" is longer than 52px gets more room instead of a clipped label.

##### What the row cost, and how it was paid for

**The two visible field labels.** This is the one thing a compact row cannot keep, and it is the only place on this surface where a visible label is spent to buy density — so the trade is documented rather than assumed:

- The per-field `<Label>`s are now `sr-only`, still carrying the full wording (`Channel (EARFCN)`, `Cell ID (PCI)`) for assistive technology and still bound by `htmlFor`/`id`.
- Sighted users get the short names from the **placeholders** (`EARFCN`, `PCI`) instead.
- Each row is a **`role="group"` with `aria-labelledby`** pointing at its own `Cell N` heading (`id="lte-slot-{index}"`), so a screen reader announces a value as the slot it belongs to rather than as one of three identically-named boxes.

The placeholder is doing real work here, which is normally a smell: a placeholder disappears the moment a value lands. It is acceptable *only* because the field's name is also carried by the row heading and the `sr-only` label, and because both values are digits whose format is unambiguous once typed. Do not extend this pattern to a field whose value could be mistaken for a different quantity.

> ℹ️ NOTE: there is deliberately **no** `SKELETON_SHAPE.SLOT_ROW`. See [Constants that no longer exist](#constants-that-no-longer-exist) — the loading branch composes the real `SLOT_ROW.ROOT` around the same `FIELD_CONTROL` mirror the loaded row uses, so the two agree by construction rather than by two numbers someone has to keep in step.

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

The strip's carrier picker is what Simple Mode was invented to work around, and for the common case the `prefill` prop replaces it. It stays because it is the only way to fill **slot 2 and slot 3** from the carrier list without leaving the card, and because a user who has scrolled past the strip should not have to scroll back.

It is a per-card, `localStorage`-backed preference (`qmanager_tower_lte_simple_mode`, `qmanager_tower_nr_simple_mode`), read in a **lazy initialiser with a `typeof window` guard** — this component renders during the static export's prerender, and reading storage in an effect instead would flip the switch under the user on first client paint.

It **force-disables itself** when the radio reports no carrier for that technology: a dropdown over an empty list is a dead control that looks like a live one. The `!hasOptions` caption underneath is the only thing that says *why*.

A value the radio is not currently reporting is still a legitimate lock target, so the `SelectTrigger` prints it in italic mono rather than falling back to the placeholder and implying the slot is empty.

> ⚠️ WARNING: this row's label is `t("tower_locking.card.simple_mode")` with **no `defaultValue`**, and it must stay that way. It used to read `t("tower_locking.card.simple_mode_label", { defaultValue: "Pick from carriers on air" })` — a key present in **no** locale, with the English supplied inline — so it rendered English in all five languages and no gate could see it — **and still cannot**. `i18n:check` is now a hard gate on missing keys, but a `defaultValue` means the key is never *reported* missing: i18next resolves it from the inline English and the checker only ever compares locale files against `en`, where the key does not appear either. A `defaultValue` on a user-visible string is how an untranslated literal hides in plain sight, and it is one of the few i18n bugs a stricter exit code did nothing to close (see [i18n.md](i18n.md)).

Both cards' Simple Mode switches carry the shared `SWITCH_TARGET` overlay, which lifts the primitive's 18×32px paint to the project's 44px coarse-pointer floor without adding a layout box that would push the row label off its baseline. The NR card had no overlay at all until retiring the "Tower lock" switch left this one alone in its row — beside an LTE card whose equivalent switch did meet the floor. Two cards in one grid row must not disagree about how big a tap target is.

### NR-SA — the gate, and SCS provenance

#### The gate is a STATE of the card, not a dimmer and not a deletion

This treatment has been wrong twice, in opposite directions, and both failures are worth carrying.

**First failure — the dimmer.** The incumbent's answer to "you cannot lock SA right now" was `opacity-60` on the whole `<Card>` plus a sentence appended to the `CardDescription`. Two failures in one gesture: a banned opacity wash, and — worse — it dimmed **its own explanation** below readable contrast. The one piece of text the user needs in order to act was the text made hardest to read.

**Second failure — the replacement.** Its fix swung too far: an early return swapped the whole card body for a `GATE` condition block. That took **Remove Lock off the screen with it**, and Remove Lock is the one control this card cannot lose.

> ⚠️ WARNING: **do not restore an early return that replaces the NR card's body.** It reads as the cleaner branch and it is a trap specific to this device. QManager runs *on* the modem it configures, so a lock pinned to an unreachable cell takes down the page you would use to fix it, and Remove Lock is the only in-UI recovery. A gated card is also **exactly where a stale NR lock lives**: `nr_locked` outlives the network moving the modem out of SA, so the branch removed the only recovery control precisely in the state that needs it.

Gated now means four things, and no fifth:

- **Full contrast everywhere** — no `opacity` wash on the card, on the notice, or on the copy that explains the condition.
- **A `muted` header chip carrying its own glyph**, so the header says which condition is in force.
- **A tonal `NOTICE` leading the card body**, stating the reason in full — it leads because it is the reason everything under it is inert.
- **`formDisabled` on every control _except_ Remove Lock.** `formDisabled = isLocking || gate !== null` reaches the Simple Mode switch, all four field controls and Clear fields. Remove Lock is gated on `isLocking || posture !== "locked"` alone, so it stays live whenever the modem reports a lock — including under a gate.

| `networkType` | Gate | Tone | Notice glyph | Chip glyph | Why |
| ------------- | ---- | ---- | ------------ | ---------- | --- |
| `"5G-NSA"` | `nsa` | `warning` | `warning` | `do_not_disturb_on` | A real condition the user can change in situ, by switching the modem's network mode. Not a fault — hence not `destructive` |
| `"LTE"` | `lte_only` | `info` | `signal_cellular_off` | `signal_cellular_off` | A standing fact. There is no NR carrier to pin and nothing on this page changes that; amber would claim something is wrong when nothing is |

`GATE_SPEC` in `nr-sa-tower-card.tsx` holds the mapping, taking its fill and disc from `NOTICE_TONE` so the block can never drift from the surface's other tonal containers. Three details in that table are load-bearing:

- **`lte_only` is `info`, not `warning`, by decision.** No NR carrier to pin is a *standing fact*, not a fault. Amber here would tell a user on an LTE-only site that something had gone wrong on a page that cannot fix it either way. `nsa` earns `warning` because it is a condition the user can actually clear.
- **The notice glyph is overridden for `lte_only`.** `NOTICE_TONE.info.glyph` is the generic `info` mark; `signal_cellular_off` says the actual thing. `nsa` keeps its role's own `warning` glyph. The two must differ, and do.
- **The chip glyph is a separate field, not a reuse of the notice glyph.** The header chip shares its slot with `LEG_BADGE`'s three postures, so `do_not_disturb_on` and `signal_cellular_off` have to be distinct from each other *and* from `lock` / `lock_open` / `schedule` — two states that can appear in one slot never share a mark.

**A lock outranks a gate in the header chip.** Two facts want that slot when the card is gated, and `headerChip` resolves it: the gate chip renders only while `posture !== "locked"`. A locked leg keeps its `LEG_BADGE`, because that is the fact with an action attached — the reader has to see a lock is in force before deciding to remove it — and the gate is stated in full by the notice below either way, where it has room for its reason. An unlocked or unread leg yields the slot to the gate, since "Unlocked" beside an inert form explains nothing.

Neither gate carries a spinner: a spinner on a standing condition advertises work that is not happening. Both gate titles and bodies are resolved with a **literal key per branch**, never `gate_${gate}_title` — `i18n:check` compares key *sets*, so a key that exists only as a runtime concatenation appears in no file and no gate, however strict, can report on it.

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

The guess is flagged **twice**: beside the field, and again inside the lock confirmation dialog — the last screen before the modem drops its connection, and the last moment the mistake can be caught cheaply. **SCS is still in the confirmation, and that is the part that must not regress:** it is the one field of the four that is routinely a guess, and omitting it meant the number most likely to be wrong was the number the user never saw. It is now shown under its own label in the dialog's `<dl>` rather than as an unexplained "30 kHz" at the end of a joined chain — see [The middot rule](#the-middot-rule).

#### Both cards: the lock dialog is not ceremony

`requestLock()` → `AlertDialog` is the **only** path to a lock on either leg, now that the footer button is the only entry point to it. `AT+QNWLOCK` pins the radio to a single physical cell and bounces the link for 3–5 seconds, on a device that is serving this very page. It stays deliberate. Remove Lock has its own confirmation for the same reason.

Status labels are written out per branch (`status_locked` / `status_unlocked` / `status_unknown`) rather than interpolated as `` status_${posture} ``: `i18n:check` compares key sets, so a key it cannot see statically is a key nothing will ever tell you about — that stays true no matter how strict the exit code gets (see [i18n.md](i18n.md)).

## The middot rule

A user-requested pass removed most of this surface's middots. The rule it applied is worth more than the list of edits, because the next contributor will otherwise reintroduce them one at a time:

> **A middot survives only where it separates two peers inside a single machine-voice run with no room for labels. Everywhere else the value gets a label, and layout does the separating.**

A middot is a *substitute* for structure. It is fine between two equal readings in a space too small for anything else — a `SelectTrigger`, a chip — because there the reader can hold two items in order. It fails the moment there are three or four, because a joined chain is a table that has been flattened to fit a sentence, and the reader has to work out which number is which from position alone.

What the pass changed, and what each change demonstrates:

| Where | Change | Which half of the rule |
| ----- | ------ | ---------------------- |
| `camped_summary_one` / `_other` | `{{count}} carriers · {{mhz}} MHz` → `{{count}} carriers across {{mhz}} MHz` | Not a machine-voice run at all — it is a sentence, so it gets sentence connectives |
| `rail_target_pair` | `{{channel}} · PCI {{pci}}` → `{{channel}}, PCI {{pci}}` | Two peers, and it **keeps** its separator — just a comma instead of a glyph, because the second term already carries a label |
| `note_ca_counts` | `{{lte}} LTE, {{nr}} NR` (and `、` in `zh-CN` / `zh-TW`) | The separator is a **translator's** decision; a hardcoded `·` in the component would have been the same mark in every script |
| `fields.custom_value` | Deleted | Orphaned — it had no caller left |
| `nr-sa-tower-card.tsx`, three literals | See below | All three replaced by labels plus layout |

The NR card carried the surface's only hardcoded middots, and each one resolved differently:

- **`summarise()`** used to join four values — band, channel, PCI, SCS — into one run dropped mid-prose in the lock confirmation. It now returns only the pair that *names* the cell, through the shared `rail_target_pair` key, and the full cell moves to a labelled `<dl>` beneath the sentence, each value under its own `<dt>`. Four terms is a table; the dialog now draws one.
- **The `SelectTrigger` fallback** — the value shown when the typed pair is not one of the carriers on air — routes through `rail_target_pair` instead of a locally joined string. A trigger is the one place with genuinely no room for two labels, which is exactly the case that key exists to serve, and routing it through the key means the separator is a translator's decision rather than a hardcoded glyph.
- **Each `SelectItem` reading gets its own name.** A dropdown row *has* room for labels, so `ARFCN 632628` and `PCI 421` are announced by name with a gap doing the separating. `PICKER_READING` is the shape: the wrapper is the machine's voice, and the *name* inside it steps back to `font-sans font-normal`, because "ARFCN" is a word this product is saying, not a value the modem reported. That typographic split is what lets two readings sit on one line with nothing but a gap between them.

## Geometry and tone

Everything shape- or tone-bearing lives in `components/cellular/tower-locking/shapes.ts`, modelled on the band-locking contract and for the same reason: the incumbent restated its card shell in **seven places across four files**, each declaring its skeleton geometry in a different branch from its loaded geometry, so a radius fixed in one branch stayed wrong in the other six.

> ℹ️ NOTE: **restated, not imported.** Several strings here are byte-identical to `band-locking/shapes.ts`. That is the house convention: a surface takes no dependency on a sibling route's module graph, so Band Locking can be re-shaped without silently re-shaping this page.

| Constant | Purpose |
| -------- | ------- |
| `TOWER_HERO` | The "Right now" section and the page's one anchor, `rounded-hero` (40px). Declares **`@container/section`** — deliberately not `hero`, because two sibling sections now declare it and a `/hero` query would never match inside `TOWER_SECTION`. `shadow-whisper` must go through the custom property; the bare utility does not resolve |
| `TOWER_CARD` | One peer card, `rounded-card` (36px). Imported by the loaded, loading **and** gated branches |
| `CARD_PAD` | 24px on a peer card; the sections' 28px is baked into `TOWER_HERO` / `TOWER_SECTION` |
| `TOWER_SECTION` | The "While nobody is watching" section. Byte-identical to `TOWER_HERO` except its radius — `rounded-card` (36px), a peer of the leg cards, not a second anchor. Declares the **same** `@container/section` name |
| `SECTION_HEAD` | The header both sections share: `ROOT` / `TITLE` / `DESCRIPTION` / `META` / `STAMP`. The description sits on the title's **row**, not under it — a section header signposts content the reader can already see, where a leg card's `CardHeader` explains a control whose effect is not visible until used. `META` is `ml-auto`, not `justify-between` on the root, because the row wraps |
| `STRIP_GRID` | The live strip: one column, becoming `[18.5rem minmax(0,1fr)]` at `@3xl/section`. The verdict track is FIXED, and the grid is `items-start` so a two-word conclusion does not stretch to the height of the carrier grid |
| `STRIP_PANEL`, `STRIP_HEAD`, `STRIP_FOOTNOTE` | The carrier half of the strip, `rounded-tile` on `surface-container`, declaring `@container/panel`. The footnote is `mt-auto` so it stays pinned to the panel's floor |
| `VERDICT_BLOCK`, `VERDICT_TONE`, `matchVerdict`, `TowerMatchVerdict` | The verdict half. `ROOT` / `HEAD` / `DISC` / `TITLE` / `BODY` — **no `STAMP`**, which moved to `SECTION_HEAD.META`. Left-aligned; the tone map keys five verdicts, three of which share a neutral fill and are separated **by glyph alone** |
| `READBACK` | The leg cards' "Modem reports" line: `ROOT` / `LABEL` / `LIST` / `ROW` / `VALUE`. `ROW` is `min-h-8`, not the 44px metric floor — it carries no control |
| `CARRIER_GRID`, `CARRIER_TILE`, `CARRIER_NOTE_TILE`, `carrierNoteSpan`, `CAMPED_ABSENT` | The camped-on grid. `CARRIER_GRID` queries **`@container/panel`** (1 → 2 at `@md` → 3 at `@2xl`) at `gap-3`; `CARRIER_TILE` is `ROOT` / `HEAD` / `BAND` / `BODY` / `PCI_LABEL` / `PCI_VALUE` / `RSRP` / `ACTION` / `MATCH` on plain `bg-surface`; the note tile fills the ragged remainder via `carrierNoteSpan()`. **No identity fills**, and the only meter is the 56px RSRP lane, whose wrapper classes are inline in `live-strip.tsx` rather than here — see the strip section |
| `AUTO_GRID`, `AUTO_TILE`, `AUTO_METER` | The standing-orders section's three tiles. `AUTO_GRID` queries **`@container/section`**; columns are stepped because the schedule tile needs the room; `AUTO_METER.ROOT` carries no `overflow-hidden` so the threshold marker can overhang the track |
| `HERO_EYEBROW` | The strip panel's eyebrow. Kept rather than deleted as a reflex: DESIGN.md's tile anatomy is literally `eyebrow → value → caption`, and the band-locking and custom-profiles heroes ship the identical step |
| `HERO_REFRESH_BUTTON`, `HERO_HELP_BUTTON` | The two 22px-glyph/44px-target buttons. Both **inherit their ink** (`text-current`) — see [Freshness heads the section](#freshness-heads-the-section). `HERO_HELP_BUTTON` is an **alias by value, restated in intent** — the two are the same size by coincidence of the 44px floor, not by shared meaning |
| `FIELD_GRID`, `FIELD_LABEL`, `FIELD_SHAPE`, `FIELD_CONTROL`, `FIELD_CONTROL_ON_CONTAINER`, `SWITCH_TARGET` | The leg cards' shared form shapes. `FIELD_GRID` is the NR card's 2×2 of value tiles. `FIELD_SHAPE` is geometry only; the fill is chosen by the **host**, one tonal step below — see [The Field-Step Rule](#the-field-step-rule-six-invisible-controls) and the specificity note below. `SWITCH_TARGET` is the 44px overlay all five switches share |
| `SLOT_ROW` | One LTE cell slot, as a row: `ROOT` / `EMPTY` / `INDEX` / `FIELDS` / `META`. `EMPTY` is dashed and unfilled; the inputs inside stay live in both variants |
| `DAY_CHIP`, `dayChipFill` | The weekday toggle. Both hovers are `enabled:`-scoped |
| `NOTICE`, `NOTICE_TONE` | The card- and page-scoped notice, three roles / three glyphs / no shared marks. `warning` is the partial-success channel |
| `PILL_ACTION`, `PILL_ACTION_PLAIN`, `PILL_QUIET` | Action sizing. `PILL_ACTION_PLAIN` is the Lock `SaveButton`, `PILL_ACTION` the glyph-bearing Remove Lock; `PILL_QUIET` is deliberately smaller for Clear fields and carries **no fill or ink** — pair with `variant="tonal-neutral"`, never `ghost` |
| `FAILOVER_BADGE`, `LEG_BADGE`, `PERSIST_BADGE`, `BADGE_GLYPH_SIZE` | Tone + glyph maps, keyed onto the exported `BadgeVariant` type so an unmapped state fails the build |
| `failoverKey`, `lockPresence`, `TowerLockPresence`, `persistPosture` | The derivations the automation tiles read. `failoverKey` takes a `TowerLockPresence` tri-state, **not** a boolean — see [Why the chip is a shield, not a spinner](#why-the-chip-is-a-shield-not-a-spinner) |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by import, not by estimate — see [Skeleton figures are measured, not estimated](#skeleton-figures-are-measured-not-estimated) |
| `TOWER_LEGS`, `TowerLeg`, `legTitleKey`, `legDescriptionKey`, `legShortKey` | Leg identity and its i18n key stems |

### Constants that no longer exist

Retired across the match-line deletion, the identity-fill removal, the section split and the tile-grid rebuild. They are listed so a search that turns up an old reference — in a stale worktree, a comment, or this doc's history — resolves to "gone on purpose" rather than "missing":

| Gone | Was |
| ---- | --- |
| `MATCH_GRID`, `MATCH_PANEL`, `MATCH_PANEL_HEAD`, `MATCH_FOOTNOTE` | The three-column match line and its two side panels → `STRIP_GRID` / `STRIP_PANEL` / `STRIP_HEAD` / `STRIP_FOOTNOTE` |
| `VERDICT_TILE` | The centred verdict tile → `VERDICT_BLOCK`, left-aligned and self-sizing |
| `VERDICT_BLOCK.STAMP` | The freshness line and its re-read control inside the verdict → `SECTION_HEAD.META` on the "Right now" header. The argument that put it on the verdict is what moved it: both operands now sit in the section the stamp heads |
| `CAMPED_PCC` | The identity-filled 172px lead tile → superseded twice, ending at `CARRIER_TILE` |
| `CAMPED_LEAD`, `CAMPED_SCC` | The lead-block-plus-secondary-rows arrangement → `CARRIER_GRID` + a uniform `CARRIER_TILE`. **No carrier leads any more**; primacy is the `LTE PCC` / `NR PCC` identity chip alone |
| `TARGET_ROW`, `TARGET_ROW_LABEL`, `TARGET_ROW_TARGET`, `TARGET_CELL` | The locked-target panel's clickable leg rows and cell lists → deleted; the modem's pairs are now `READBACK` inside each leg card |
| `HERO_STALENESS` | The freshness line → folded into the stamp, which then moved to `SECTION_HEAD` |
| `HERO_RAIL_SUBTITLE` | The hero's dynamic lock-posture subtitle → a static description line |
| `HERO_DESCRIPTION` | The merged hero's own description → `SECTION_HEAD.DESCRIPTION`, which "While nobody is watching" uses and "Right now" deliberately does not |
| `SELECT_CONTROL` | A shared `SelectTrigger` shape that **had zero consumers**. Both leg cards already declared their own local constant and never imported this one, because the two selects are not the same size: the LTE slot row's is a 42px `SELECT_CONTROL` built on `FIELD_CONTROL`, the NR card's is a 32px `TILE_SELECT` living inside a `FIELD_TILE`. A shared constant for two different geometries is a false economy — see the specificity note below |
| `FIELD_SLOT`, `FIELD_SLOT_HEAD` | The three stacked slot panels (a heading row over a two-up field grid) → `SLOT_ROW`, one row per slot |
| `carrierTileTone`, `carrierPillTone`, `carrierMeterTone` | The three identity-fill tone helpers. **They exist only to put controls on a saturated identity ground**; with no identity fill left on this surface, every control here is an ordinary neutral one and none of the three has a caller |

`SKELETON_SHAPE` lost `.TARGET_ROW`, `.PCC_BLOCK` and `.SCC_ROW`, and gained `.READBACK`, `.VERDICT`, `.CARRIER_TILE`, `.SECTION_TITLE`, `.SECTION_DESC`, `.SECTION_META` and `.AUTO_TILE`. `.PCC_BLOCK` and `.SCC_ROW` were two mirrors for two carrier shapes; there is one shape now, so there is one mirror.

> ⚠️ WARNING: there is deliberately **no `SKELETON_SHAPE.SLOT_ROW`, and adding one is a regression.** `SLOT_ROW.ROOT` sets only a `min-h-14` floor, and a loaded row hosts a 42px `FIELD_CONTROL` inside its vertical padding, so it settles *taller* than that floor. A flat number here would be a second measurement of the same row, kept in step by hand. `lte-tower-card.tsx` instead builds its placeholder out of `SLOT_ROW.ROOT` plus the same `FIELD_CONTROL` mirror the loaded row uses — including the two `flex-[…]` shorthands — so the two agree by construction. **Composing beats mirroring wherever the real shape is available to compose.** The NR card makes the same call for its value tiles, composing `FIELD_TILE` and restating only the 32px control's line box as a local `SKELETON_TILE_VALUE`.

### Skeleton figures are measured, not estimated

Two of the strip's mirrors are in-browser measurements rather than reasoned guesses, and both round the same direction on purpose.

| Constant | Value | Measured |
| -------- | ----- | -------- |
| `SKELETON_SHAPE.VERDICT` | `h-[7.0625rem]` (**113px**) | 92px for one-line verdict bodies (`on_target`), 111px for two-line (`unlocked`), at the 18.5rem track width |
| `SKELETON_SHAPE.CARRIER_TILE` | `h-[5.4375rem]` (**87px**) | 87px, and every carrier tile is the same height |

**`VERDICT` sits 2px above the tallest measurement, not at an average of the two**, and that is the rule to keep: **a skeleton that shrinks on load pulls the panel beside it upward into space the reader had already started on, whereas one that grows only pushes down into space nobody has read yet.** The same reasoning sizes `SKELETON_SHAPE.READBACK` for the caption plus *one* pair even though the LTE card can render three, and sets the strip's tile count to `onAir.length + 1` with a floor of 1 — the carrier list comes from a different hook than `isLoading`, so the real count is usually already known while the skeleton renders.

A carrier tile can render *taller* than 87px when it shares a grid row with the note tile, because grid rows stretch to their tallest cell. That is the row stretching the tile, not the tile growing, so it is not what the mirror stands in for.

**`SKELETON_SHAPE.SECTION_META` is deliberately wider than its content.** The real slot is a 28px stamp pill (76px at en-GB's `07:31 PM`) plus the 22px refresh button and its 10px gap — about 108px — and the mirror is `w-32` (128px). The stamp's width is set by **the locale's time format**, which the mirror cannot see. Erring wide is free here: the slot is `ml-auto`, so a placeholder a few pixels over only eats empty header space, while one that is too narrow lets the header's right edge jump on handoff.

### The Field-Step Rule: six invisible controls

**A field's resting fill is one tonal step above ITS HOST, never a fixed token.** `surface` / `card` host → `surface-container` field; `surface-container` host → `surface-container-high` field. This is now binding canon — `DESIGN.md` > Components > Inputs / Fields — and this surface is where it was found.

DESIGN.md gives an input no border at rest, so **the fill is the entire affordance**: there is nothing else on screen saying where the box is. A fixed fill token is therefore only *accidentally* correct. `FIELD_CONTROL` shipped as the only answer, painting `bg-surface-container`, and **not one call site on this surface had the host it described** — every field here lives inside `SLOT_ROW` or `AUTO_TILE`, both `bg-surface-container`. All six painted their host's exact colour and rendered at **1.00:1**. The doc comment above the constant described a host that did not exist, which is how it survived review.

`shapes.ts` now splits the geometry from the fill: `FIELD_SHAPE` (unfilled), `FIELD_CONTROL` (for a `surface` / `card` host) and `FIELD_CONTROL_ON_CONTAINER` (`-high`, which on this surface means everywhere).

Two corollaries carried into DESIGN.md:

- **`-high` is the top rung, so the HOST steps down.** A field can never be hosted by a `surface-container-high` block. Never solve it with a border — an outlined field beside three unbordered ones reads as a different *kind* of control.
- **STEP or SHELL, one per card, never mixed.** STEP is the table above. SHELL is the alternative the NR card's `FIELD_TILE` uses: the control is transparent and the *host* carries both the fill and the focus ring (`focus-within:ring`). The bug is only ever the third state — a control painting its host's own colour.

`SWITCH_TARGET` was extracted in the same pass. The `Switch` primitive paints 18x32px, well under the 44px floor; a pseudo-element overlay reaches the target without adding a layout box that would push the row's label off its baseline. Two byte-identical copies were declared locally in the two leg cards, and the surface's other three switches — persist, failover, schedule-enable — had **none at all**: the same primitive shipping at two target sizes on one page, with the smaller size on the three controls that actually write to the modem.

### The field-specificity traps

Both produce a result that *looks approximately right*, which is exactly why they would survive review. The shared field constants carry the first; the second lives at the two call sites that actually render a select, since the shared constant for it had no consumers and is gone.

- **The `dark:` restatement is not redundant, and it is not sufficient either.** `components/ui/input.tsx` ships `dark:bg-input/30`, and `@custom-variant dark (&:is(.dark *))` compiles that to a `(0,2,0)` selector against a bare `bg-surface-container-high`'s `(0,1,0)` — so a light-only override simply loses in dark mode. `tailwind-merge` cannot fold them either: different modifier scopes, and it only collapses conflicts within one scope. **But once ours is `dark:`-prefixed too, both rules are (0,2,0) and they TIE** — and specificity decides nothing in a tie. The winner is emission order, which for two candidates of the same utility is Tailwind's deterministic candidate sort, i.e. by name: `bg-input…` sorts before `bg-surface-…` only because *i* precedes *s*. That is an **observed** outcome, not a constructed one — rename `--color-input`, mint a token that sorts between them, or change the sort, and every one of these fills flips in dark mode only, with no error anywhere. The shipped constants mark the dark half with Tailwind v4's important modifier (`dark:bg-surface-container-high!`) so the rule wins by construction. Same family as the `twMerge` custom-radius trap, where alphabetical order decides a conflict the tooling cannot see. Use `!` **only** against a primitive's own `dark:` fill — it is not a general escape hatch.
- **A `SelectTrigger`'s height must be restated at matching specificity.** `components/ui/select.tsx` sets `data-[size=default]:h-9` — again `(0,2,0)` via the attribute selector — so a bare height utility loses and the select renders 36px beside its sibling inputs: visibly combed, and under the project's control-height floor. The LTE card writes `data-[size=default]:h-[2.625rem]` in its local `SELECT_CONTROL`; the NR card writes `data-[size=default]:h-8` in `TILE_SELECT`, plus a `dark:hover:bg-transparent` neutralisation of `select.tsx`'s `dark:hover:bg-input/50`.

Both leg cards hit these independently, and both keep their own answer because their two selects are different sizes.

### The blocked pick button is `aria-disabled`, not `disabled`

`CARRIER_TILE.ACTION`'s blocked rules are written on **`aria-disabled:`**. A natively `disabled` element is not focusable and dispatches no pointer events, so the tooltip carrying the *reason* a carrier cannot be targeted (`tile_blocked_nsa`, `tile_blocked_lte_only`, `tile_blocked_slots_full`) could never open — by mouse or by keyboard. `live-strip.tsx` now blocks the picker with `aria-disabled="true"` plus a no-op click guard, which keeps the element reachable while still announcing as unavailable.

> ⚠️ WARNING: **the two changes are one change.** The instant the native attribute went away, all four `disabled:` rules stopped matching and the blocked tile rendered at full opacity, with a pointer cursor, still lighting up to `primary-container` on hover — this surface's affirmative "this is takeable" signal, painted on a control that cannot be taken. A dead control that highlights like a live one is worse than a grey one with no explanation. The `disabled:` originals are deliberately **not** kept alongside: `live-strip.tsx` is the only consumer in the repo (frequency locking declares its own `CARRIER_TILE`), and a dead second rule set is a second place for "blocked" to be decided.

This is the general shape of disabled-with-a-reason on this surface. Where a control is dead *and the user needs to know why*, `aria-disabled` is the attribute and the tone rules must move with it.

### A tile on a `bg-surface` host is NOT a hero row

`CONTROL_ROW` (LTE card), `CARD_ROW` (NR card) and `AUTO_TILE` (the automation tiles) are all the same anatomy as the long-retired `HERO_ROW`, and all paint `bg-surface-container` where it painted `bg-surface`. `HERO_ROW`'s fill was correct on an old hero's `surface-container` *panels*; it is **invisible** on a card or a section that *is* `bg-surface` — which `TOWER_CARD`, `TOWER_HERO` and `TOWER_SECTION` all are. Same shape, one step up the tonal ladder. This is the single easiest way to render a row that is there and cannot be seen.

## Props contracts

### `TowerLiveStripProps`

The strip is **read-only end to end**: it takes no setting, no writer, and no save-state. Its only outbound edge is the prefill bus. That is the point of the split — this reports, the cards and the tiles change.

**Five props, down from seven.** `lastSyncedAt`, `isRefreshing` and `onRefresh` moved to the coordinator when the freshness stamp moved into `SECTION_HEAD.META`; the strip no longer knows the surface has a clock at all.

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `modemState` | `TowerModemState \| null` | The AT read-back. `null` = never read → the verdict is `unknown` |
| `carrierComponents` | `CarrierComponent[]` | The ACTUAL view. Rendered **raw** — sorted by `sortCarriers()`, not deduplicated; one tile per raw component |
| `canTarget` | `Record<TowerLeg, { ok: boolean; reasonKey: string \| null }>` | Per-leg picker gate + the reason to show when blocked |
| `isLoading` | `boolean` | First paint. Gates the verdict skeleton and the tile skeletons |
| `onPickCarrier` | `(carrier: CarrierComponent) => void` | Into the prefill bus |

### `TowerAutomationTilesProps`

Renders **no card shell and no header** — those belong to the `TOWER_SECTION` the coordinator owns. Everything else is as it was when this was a card.

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
| `config` / `modemState` | `TowerLockConfig \| null` / `TowerModemState \| null` | Config seeds the four fields (keyed on a **value string**, never object identity); modem drives the badge, the read-back line and the dirty gate |
| `carriers` | `CarrierComponent[]` | Pre-filtered to `technology === "NR"` by the caller, so two components cannot disagree about what "an NR carrier" is |
| `networkType` | `NetworkType` | Drives the gate **and** the loading branch — `""` is "not reported yet", never "capable" |
| `servingNr` | `{ arfcn, pci, scs }` | For SCS provenance |
| `prefill` | `{ cell: NrSaLockCell; nonce: number } \| null` | Nonce-keyed; the cell's own `scs` is deliberately re-derived |
| `onLock` / `onUnlock` | `(cell) => Promise<boolean>` / `() => Promise<boolean>` | |
| `isLoading` / `isLocking` | `boolean` | `isLocking` feeds `formDisabled`; **Remove Lock reads it directly** and never reads `formDisabled` |

## Card states

Both leg cards render `TOWER_CARD` + `CARD_PAD` in **every** branch, so the shell cannot drift. Both `<section>`s render their shell unconditionally in the coordinator, and each body skeletons independently:

| Surface | Loading render |
| ------- | -------------- |
| "Right now" header | `SKELETON_SHAPE.SECTION_META` replaces the stamp + refresh button |
| Live strip | `SKELETON_SHAPE.VERDICT`, then `onAir.length + 1` (floor 1) × `SKELETON_SHAPE.CARRIER_TILE` inside the real `CARRIER_GRID` |
| Automation tiles | three `SKELETON_SHAPE.AUTO_TILE`s inside the real `AUTO_GRID` |
| Leg cards | `.CARD_TITLE` / `.CARD_DESC` / `.CARD_CHIP`, then `.READBACK`, `.SETTINGS_ROW`, the per-card field mirrors, and `.ACTION` / `.ACTION_SECONDARY` / `.ACTION_QUIET` in the footer's real grouping |

> ℹ️ NOTE: `SKELETON_SHAPE.READBACK` is sized for **the caption plus one pair**, even though the LTE card can render three. The skeleton cannot know how many will land, and a placeholder sized for three collapses on the common single-cell case — a skeleton that *shrinks* is worse than one that grows, because the content below it jumps upward into space the reader had already started on. `.VERDICT` makes the same call against a real measurement — see [Skeleton figures are measured, not estimated](#skeleton-figures-are-measured-not-estimated).

- **Loading** — every measurement from `SKELETON_SHAPE`, except where the real shape can be *composed* instead (the LTE slot rows, the NR value tiles). The incumbent guessed `h-9 w-full rounded-md` for inputs that render at 42px with a 20px radius, and `h-5 w-20` for a Switch-plus-Label pair. Sizes are the loaded element's **line box**, not its font size: a skeleton sized to the glyph reflows the moment real text lands.
- **Gated** (NR only) — the card shell, header, read-back, fields and footer all survive at full contrast; a tonal `NOTICE` leads the body and `formDisabled` reaches every control except Remove Lock.
- **Empty** (LTE) — inline, above the slots, never instead of them.
- **Loaded** — header chip, controls, conditional notices, `sr-only` `aria-live` applying announcement, footer pinned with `mt-auto` (these cards sit in an equal-height grid row, so without it a short card leaves its buttons floating above a void).

Page level adds two more, both of which the surface previously lacked entirely:

- **Error** — `tower.error && !tower.isLoading` renders a destructive notice plus a Retry button. Before this, `tower.error` was returned by the hook and passed to nobody, so a `status.sh` that failed all three retries rendered empty defaults as though they were real readings. (`fetchStatus` auto-retries three times with 2s/4s/8s backoff before the notice appears.)
- **Warning** — the dismissible partial-success notice described above.

## Proposed in the mockup, deliberately not built

The current shape comes from a mockup, and several of its proposals were rejected on inspection. **This is the highest-value section in this doc**, because every item below looks like an obvious improvement and will be re-proposed by anyone reading the mock beside the shipped page.

| Mockup proposal | Why it is not built |
| --------------- | ------------------- |
| **"held 2 h 14 min"** under the verdict | **No timestamp exists anywhere in the tower pipeline.** Nothing in `status.sh`, `tower_lock_mgr.sh` or `/etc/qmanager/tower_lock.json` records when a lock was applied, so this is not a missing field — it is a new mechanism. Worse, stamping one collides with the RM520N's **no-RTC 1970 boot window**: wall-clock arithmetic across a boot is meaningless until `ql_time_daemon` steps the clock ~24s in. An honest implementation would need `/proc/uptime` plus explicit invalidation on reboot (see [scheduled-timers.md](scheduled-timers.md)), which is a backend design, not a label |
| **Per-tile SCS** in the carrier grid | Not on `CarrierComponent`. The only available source is the band table, so the tile would print a **guess in the typeface of a measurement** — the same hazard the NR card spends a whole provenance mechanism avoiding |
| **"B3, 1800 MHz"** under a configured slot | `LteLockCell` is `{ earfcn, pci }` and nothing more. Reaching a centre frequency means two chained derivations (EARFCN → band → centre frequency), the second returning `null` for any unmapped band, in order to print a **marketing** figure in machine voice beside a hard EARFCN the user can verify |
| **"Apply when SA becomes available"** on the gated NR card | A new config key plus an NSA→SA transition detector. `config.sh` has **no key-migration primitive** — `qm_config_init` only seeds an empty file — so a new key silently breaks every OTA-upgraded device until a migration step is written for it |
| **"Standby" chip** on a filled-but-not-serving slot | **Chip absence is this codebase's negative case.** The `Serving` chip's whole signal is that it appears; a chip in both states halves it. Same rule the read-back line already follows |
| **Read-only leg cards with no footer** | The mock drew only the settled state. Every control survives — and Remove Lock especially, since it is the only in-UI recovery from a lock pinned to an unreachable cell, on a device that serves this very page |
| **Green "Locked" / neutral "Unlocked"** | Kept as shipped (`locked` = `warning`, `unlocked` = `success`) **by explicit user decision**, matching Band Locking next door. Pinning the radio is the *constrained* state, not the healthy one, and a user crossing the three `/cellular/cell-locking/` routes in one task must not have to relearn the colour language |
| **`opacity: .85`** on the whole gated NR card | Banned outright, and specifically the treatment this card already retired: the incumbent's `opacity-60` dimmed its own explanation below readable contrast. See [the gate](#the-gate-is-a-state-of-the-card-not-a-dimmer-and-not-a-deletion) |
| **Folding the modem read-back into the form rows** | The two are **on different clocks** — the form is the config's live view, the read-back is `AT+QNWLOCK` fetched once on mount and never polled — and a reader who cannot tell them apart cannot interpret a disagreement between them. That is exactly why `READBACK` keeps its own captioned block. See [The two clocks](#the-two-clocks) |

## Known gaps

- **`tower/lock.sh` has no reciprocal frequency-lock check.** Frequency Locking refuses to run under an active tower lock; a tower lock silently clobbers a frequency lock. Backend change, not attempted here.
- **Unlock disables the failover preference and locking never re-enables it** — see [above](#tower-unlock-silently-disables-the-users-failover-preference). The UI is honest about it only because of the post-unlock `fetchStatus()`. Whether the backend *should* behave this way is unresolved.
- **Two watchers can fire against one incident** with different clocks and no shared claim — see [above](#two-watchers-one-incident-contradictory-reverts).
- ~~**Frequency Locking is deliberately left on the legacy look.**~~ **Closed 2026-08-22.** That route was rebuilt on the same system and now carries 134 i18n keys per locale; all three `/cellular/cell-locking/` surfaces are migrated. See [frequency-locking.md](frequency-locking.md).
- **The carrier identity-tone helpers still exist in two places, and this surface is no longer one of them.** `components/dashboard/carrier-aggregation.tsx` (as `tileTone()` / `meterFillTone()`) and `components/cellular/band-locking/shapes.ts` still carry their own copies; tower locking dropped its three when the lead block lost its identity fill. Extraction into a shared module (e.g. `lib/carrier-tone.ts`) is now a two-copy trade rather than a three-copy one. The rule that must never drift, wherever it lives, is *identity, never quality* plus the `isLead` signature — a lead tile paints `bg-lte`, so a fill that also paints `bg-lte` is invisible at 1.00:1.
- **`types/tower-locking.ts` is shared.** `components/cellular/frequency-locking/nr-freq-locking.tsx` imports `SCS_OPTIONS` from it. "Tidying" these types while working on Tower Locking breaks another route, and TypeScript will not tell you until the build.
- **Two exports in `types/tower-locking.ts` are now unreferenced**: `qualityLevel()` and `DAY_LABELS` (the schedule tile resolves day names through `tower_locking.schedule.day_{index}` instead, and `DAY_LABELS` here is a duplicate of the identical constant in `types/system-settings.ts`, which *is* used). Harmless dead constants, documented rather than deleted so the duplication is visible if someone reaches for one.
- **There is no longer any way to jump from the strip to a leg card.** The retired locked-target panel's rows were clickable and `scrollToLeg()` smooth-scrolled the matching card into view; the two DOM `id`s and the `scroll-mt-20` that served it were removed with it, since they had become ids referenced only by themselves plus an offset correcting for a scroll that no longer happens. Nothing is broken — the cards are one short scroll below the two sections — but if a "jump to this leg" affordance is ever wanted again, both the anchors and the header offset have to come back together, and the offset is the half that gets forgotten.
- **The `read_ok` flags cover the three AT reads only, and nothing else on the page carries one.** `failover_state` comes from flag files rather than the modem, and `config` is the file's belief; neither can fail the way an AT read fails, so neither needs a flag. But a future field on this endpoint that *does* come from the modem needs its own, and the absent-means-true rule then has to be extended to it deliberately — an un-upgraded CGI omitting a **new** flag will read as `true` whether or not that is honest for it.
- **`TOWER_WRITE_SETTLE` is derived from three measured numbers that live in three different files.** `INTERVAL` is in `qmanager_tower_failover`, the attach-cycle drop is documented in [wan-profile-management.md](wan-profile-management.md), and the poller cadence in [radio-information.md](radio-information.md). Nothing links them mechanically; if any one of the three moves, the constant is silently wrong and fails on roughly half of writes. The comment above it in `tower_lock_mgr.sh` is the only guard.
- **The threshold row has no direct evidence the daemon adopted the new value.** `qmanager_tower_failover` re-reads `.failover.threshold` only every sixth cycle (~120s), so a save can be up to two minutes ahead of the running watcher. The UI does not say so, and the `AUTO_METER` marker moves the instant the save lands — so for up to two minutes it draws a line the daemon is not yet enforcing.
- **The verdict inherits the lock read-back's staleness and can only say so, not fix it.** The stamp in `SECTION_HEAD.META` marks it honestly, but a lock cleared out of band (schedule timer, failover watcher, a second tab) will keep reading `on_target` against a target the modem no longer holds until someone presses refresh. The leg cards' "Modem reports" line and the tiles' `CARRIER_TILE.MATCH` rings inherit exactly the same staleness, from the same fetch. Closing this needs a *poller-side* field, never a second client on the AT mutex — see [The two clocks](#the-two-clocks).
- **`hasChanges` blocks re-applying an identical lock on either leg.** Correct for avoiding a pointless modem write and a 3–5s link bounce, but it also means the failover watcher cannot be re-armed from a leg card without changing a field. (`lock.sh` spawns the watcher on a lock write, so a re-lock is currently the only UI path to a respawn.)
- **The NR card carries roughly 196px of slack above its footer in its sparsest state.** With SA available, nothing locked and the fields staged from config, the NR card renders a header, a Simple Mode row and four value tiles against an LTE card holding a header, a Simple Mode row and three slot rows — and the 2-up grid forces equal height. The **footers align**, which is what equal height is for and is the property worth keeping; the slack is what it costs. It closes on its own in the two states where the card has more to say: a gate adds a `NOTICE`, and a live lock adds the `READBACK` block. Filling it in the sparse case would mean inventing content for a card that genuinely has none, which is worse than empty space.
- ~~**The disabled pick button's tooltip is not reliably hoverable in Chrome.**~~ **Closed 2026-08-23.** `live-strip.tsx:379` now blocks the picker with `aria-disabled` plus a no-op click guard, and `CARRIER_TILE.ACTION`'s blocked rules moved to `aria-disabled:` in the same change — see [The blocked pick button is `aria-disabled`, not `disabled`](#the-blocked-pick-button-is-aria-disabled-not-disabled).

## Related

- [band-locking.md](band-locking.md) — the sibling surface: the footer construction this one converged on (one primary write, one outline write, one quiet form reset; its only `Switch` is failover), the `BAND_CHIP_LIVE_RING` inset-shadow pattern `CARRIER_TILE.MATCH` borrows, the shared `radio_info.bands.scanner.link` key, and a failover watcher that is **bounded** where this one is not
- [scheduled-timers.md](scheduled-timers.md) — the runtime `OnCalendar` timer model, `qmanager_tower_schedule_arm`, and the 1970 boot-window fire guard every new timer must pass
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the source of the camped-on carriers, and the identity-tone convention this surface's lead block no longer needs
- [radio-information.md](radio-information.md) — the poller cadence behind the ~4s clock, and the compiler-backed `react-hooks` bail-on-first-violation behaviour
- [at-command-transport.md](at-command-transport.md) — the `/tmp/qmanager_at.lock` mutex that makes polling `status.sh` expensive, and the exit-status-only failure contract every `*_read_ok` flag rests on
- [tmp-file-ownership.md](tmp-file-ownership.md) — the flag/PID files the watcher and `failover_status.sh` share, and the `root:root 0666` seeding contract behind `/tmp/qmanager_tower_write_inflight`
- [i18n.md](i18n.md) — the two severity policies over one engine, and why keys are never interpolated on this surface
- [icon-system.md](icon-system.md) — `/cellular/` is a Material Symbols route; every glyph used here is already in the subset allowlist
- `DESIGN.md` > Named Rules (Consistent-Layout, Identity-Never-Acts, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror, One-Scale, One-Loop, Solid-Container, Radius-Follows-Size, Machine-Voice, **Field-Step**) and > Components > Inputs / Fields
