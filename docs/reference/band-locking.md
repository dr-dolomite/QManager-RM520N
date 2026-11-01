# Band Locking (`/cellular/cell-locking`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08, layout re-ported 2026-11-01
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Band Locking is the page where a user narrows what their radio is allowed to use, and it is one of the few surfaces in QManager where a wrong click can take the connection away while you are standing on it.** Locking a band writes `AT+QNWPREFCFG="lte_band",…` (or the NSA / SA equivalent) to the modem; if the bands you picked are not serving your location, the modem has nowhere to camp and the link drops. That risk shapes everything below: the two-axis band chip that shows a pending change *before* you write it, the un-gated "Restore all supported" recovery action, and the failover watcher that reverts a lock automatically when no carrier appears.

The page layout is a port of RM551E v0.1.34 (2026-11-01, `839b2c14`). A status card (`BandStatusCard`) sits above one card per band category. The port is **frontend-only**: all four CGI scripts under `scripts/www/cgi-bin/quecmanager/bands/` are unchanged. RM520N keeps three things RM551E does not have: the SIM Profile gate, the four-state failover verdict chip, and per-category write errors.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking` (`app/cellular/cell-locking/page.tsx`) |
| Page coordinator | `components/cellular/band-locking/band-locking.tsx` |
| Geometry + tone contract | `components/cellular/band-locking/shapes.ts` |
| Status card (on air, lock posture, failover) | `components/cellular/band-locking/band-status-card.tsx` (`BandStatusCard`) |
| One category card (×3) | `components/cellular/band-locking/band-grid-card.tsx` (`BandGridCard`) |
| Shared `/cellular/` page header | `components/cellular/page-header.tsx` |
| Data + actions hook | `hooks/use-band-locking.ts` |
| Types + band-string helpers | `types/band-locking.ts` (incl. `BandActionResult`) |
| Read current config | `GET /cgi-bin/quecmanager/bands/current.sh` |
| Apply a lock | `POST /cgi-bin/quecmanager/bands/lock.sh` — body `{ "band_type": "lte", "bands": "1:3:7" }` |
| Failover toggle / poll | `POST …/failover_toggle.sh` (`{ "enabled": true }`), `GET …/failover_status.sh` |
| Failover watcher | `scripts/usr/bin/qmanager_band_failover` |
| Supported bands + on-air carriers | `hooks/use-modem-status.ts` (`device.supported_*_bands`, `network.carrier_components`) |
| i18n | `band_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (161 leaf keys in `en` at `afc517fe`, some of them retired and unread — see [Known gaps](#known-gaps)) |
| Shared quality map (ink / meter tone) | `components/cellular/signal-quality-display.ts` |
| Shared empty/error primitive | `components/cellular/condition-screen.tsx` |
| Scroll anchors | `categoryCardId(category)` → `band-locking-card-{category}` |

> ℹ️ NOTE: `live-band-hero.tsx` (`LiveBandHero`) is **deleted**. `band-status-card.tsx` replaces it. The older `band-settings.tsx` and `band-cards.tsx` were deleted in the 2026-08 redesign.

## Component tree

```
BandLockingComponent                      ← owns every hook; no child talks to CGI
├── CellularPageHeader                     actions: Refresh button
├── sr-only aria-live region               announces the refresh; layout stays put
├── ConditionScreen (destructive)          only when current.sh failed (readError)
├── ProfileOverrideAlert | Banner          the profile gate, else the scenario gate
└── motion cascade
    ├── BandStatusCard                     on-air tiles | lock-posture rail,
    │                                      then the failover row beneath both
    └── grid (1 col → 2 at @3xl/main)
        ├── BandGridCard  category="lte"
        ├── BandGridCard  category="nsa_nr5g"
        └── BandGridCard  category="sa_nr5g"
```

The coordinator reads `useModemStatus`, `useBandLocking`, `useConnectionScenarios` and `useSimProfiles`, and hands everything down as props. There are three categories because there are three AT parameters — `lte_band`, `nsa_nr5g_band`, `nr5g_band` — and `lock.sh` maps `BandCategory` onto them one-to-one.

> ℹ️ NOTE: RM551E v0.1.34 has a fourth category, `nrdc_nr5g` (NR-DC). It is **deliberately not ported**: NR-DC band locking is unverified on the RM520N-GL. `RAIL_CATEGORIES` and `BAND_CATEGORIES` stay at three entries.

Each category-card wrapper carries `id={categoryCardId(category)}` and `scroll-mt-20`. The status card's rail rows scroll to those ids, and `scroll-mt-20` keeps the landing below the sticky shell header. Both ends now go through the one `categoryCardId` helper in `shapes.ts`, so the old string-coupling between two files is gone.

## The two-axis band chip

**Short version: a band has two independent facts about it, and a checkbox can only carry one.**

- **SELECTED** — what you have picked and not applied yet. Local React state in `BandGridCard`.
- **LIVE** — what is configured on the modem now, read from `AT+QNWPREFCFG="ue_capability_band"` by `current.sh`.

| Channel | Carries | Rendering |
| ------- | ------- | --------- |
| **Fill** | SELECTED | `primary-container` when picked, `surface-container` when not (module-local `bandChipFill`) |
| **Ring** | LIVE | 2px inset `--primary` shadow, present iff the band is on the modem (`BAND_CHIP_LIVE_RING`) |

| Fill | Ring | Means |
| ---- | ---- | ----- |
| yes | yes | Already locked, staying locked |
| yes | no | **Pending add** |
| no | yes | **Pending removal** |
| no | no | Not locked, staying that way |

`bandChipClass(selected, live)` composes both; nothing else may hand-write the classes.

**The ring is an inset shadow, not a border.** A real `border` adds a layout box, so every chip would grow 2px when a lock landed and the grid would reflow on every successful apply. A shadow is a pure repaint. `--primary` is the ring colour because it stays far from `--primary-container` on the lightness axis in both themes.

**Non-visual channels.** `bandChipA11yKey(selected, live)` resolves to `band_locking.a11y.band_live` / `band_selected` / `band_unselected`. A pending removal announces as "not selected", which is what applying would do. Chips carry `aria-pressed`, and the grid is a `role="group"` labelled with the category title.

**Touch target.** The chip paints at 40px (`h-10`) with a `before:` overlay that brings the hit area to the 44px coarse-pointer floor without a layout box.

**The legend names the configuration fact.** `BAND_LEGEND` renders only when at least one band is live, and labels the ring swatch `band_locking.legend.live` ("Currently locked"). The status card above has "On air now", which is a different fact:

| Label | Source | Fact |
| ----- | ------ | ---- |
| Status card, "On air now" | `network.carrier_components` (poller) | Where the radio is **camped** this instant |
| Card legend, "Currently locked" | `ue_capability_band` (`current.sh`) | What is **configured** |

## `unlockAll` is a WRITE, not a clear

**"Restore all supported" writes the full supported band list to the modem.** `useBandLocking.unlockAll` calls `lockBands(category, supportedBands)`: the same `lock.sh`, the same `AT+QNWPREFCFG` write, the same failover watcher arming. The modem has no concept of an empty band restriction.

**It deliberately has no confirmation dialog.** It is the one band write that can only *widen* what the modem may use, so it is the recovery action. Gating recovery behind a dialog while Apply (the write that can cost the connection) fires freely would invert the risk gradient.

It is disabled only when it would be a no-op (`categoryPosture(...) === "unrestricted"`) or when the card is frozen.

## The `prevLockedKey` render-phase sync

`band-grid-card.tsx` keeps the local selection in sync with the modem using React's "adjust state when a prop changes" pattern, **during render**:

```tsx
const [prevLockedKey, setPrevLockedKey] = useState("");
const lockedKey = currentLockedBands.join(":");
if (prevLockedKey !== lockedKey && currentLockedBands.length > 0) {
  setPrevLockedKey(lockedKey);
  setCheckedBands(new Set(currentLockedBands));
}
```

- **It must not become a `useEffect`.** `currentLockedBands` is a new array identity every parent render (a `useMemo` in the coordinator). The joined string compares contents. A compiler-backed `react-hooks` violation here would also suppress every later diagnostic in the file.
- **The `length > 0` guard is load-bearing.** `current.sh` returns `""` for a category the modem does not report, which parses to `[]`. Without the guard every poll would wipe a selection in progress.
- **It is the only thing that repaints the grid after a write.** Apply → `lockBands` → `POST lock.sh` → `fetchCurrent()` → new `currentBands` → new `lockedKey` → this block. Remove it and Apply appears to do nothing.

## The gate chain

Two things outside this page can own radio configuration. While either does, the band controls and the failover toggle are read-only.

| Gate | Source | Banner | Card badge |
| ---- | ------ | ------ | ---------- |
| **Profile** (outranks scenario) | `useSimProfiles` → the active profile's scenario binding, resolved for *now* | `ProfileOverrideAlert` | `card_badges.profile` — "Profile controlled" |
| **Scenario** | `useConnectionScenarios.activeScenarioId !== "balanced"` | `Banner role="override"` with a link to `/cellular/custom-profiles/` (scenarios live on that page) (`scenario_gate_action`, "Open scenarios") | `card_badges.scenario` — "Scenario controlled" |

The coordinator passes `gatedBy={isProfileControlled ? "profile" : "scenario"}` to each `BandGridCard`. Both gates use the `info` / `shield` chip from `CATEGORY_BADGE.scenario`; only the label changes. Before the port a profile-owned card said "Scenario controlled", which named the wrong owner.

A **Balanced** binding is "no opinion" and leaves bands editable: Balanced re-applies AUTO mode and does not touch bands.

### `resolveScheduledScenario(now, …)`, not `profile.scenario.default`

**The profile gate resolves the scenario in force at this instant, not the profile's default binding.** The on-device systemd timer applies the **windowed** scenario (see [scheduled-timers.md](scheduled-timers.md)), and scenarios issue the same `AT+QNWPREFCFG` writes this page does — real last-writer-wins contention. `nextChangeAt(now, …)` supplies the "scheduled to change at HH:MM" note (`band_locking.gate.profile_note`).

### `isGated` and `isBusy` are separate props

| Prop | Kind | Meaning |
| ---- | ---- | ------- |
| `isGated` | Standing condition | A SIM Profile or Connection Scenario owns radio config |
| `isBusy` | Transient | A band write is in flight in **any** category |
| `isLocking` | Transient, this card only | Drives this card's `SaveButton` spinner |

`isFrozen = isGated || isBusy || isUnavailable` is the interaction block. `aria-disabled` on the card carries `isGated || isUnavailable` only, because `isBusy` clears on its own in seconds.

## `isBusy` blocks all three categories during any lock

**This is deliberate, and the reason is in the shell.** When `lock.sh` arms the failover watcher it first kills any watcher already running, so only the most recent lock is monitored. The window is ~30 seconds: `SETTLE_DELAY=5`, then `MAX_CHECKS=5` checks `CHECK_INTERVAL=5` seconds apart (`scripts/usr/bin/qmanager_band_failover:47-49`). Two locks seconds apart leave the first one unmonitored.

> ⚠️ WARNING: an "apply all three categories at once" button must be a **multi-category `lock.sh` that arms ONE watcher**, never a client-side fan-out. `components/onboarding/steps/step-band-locking.tsx` once fanned out with `Promise.allSettled`; it was serialised in `578ddb2` and its loop carries a comment saying why.

## Results, not a shared error string

Every mutator in `useBandLocking` returns a `BandActionResult`:

```ts
export type BandActionResult = { ok: true } | { ok: false; error: string };
```

`error` is already resolved through `resolveErrorMessage`, so the caller shows it as-is. This replaced a single shared `error` string plus a coordinator-side `lastAttempted` scoping hack; a result returned from the call cannot be read through a stale closure, and it cannot land under the wrong card.

| Caller | On `ok: false` |
| ------ | -------------- |
| `BandGridCard` Apply / Restore all | `toast.error(result.error)`, and the coordinator's `track()` stores it in `writeErrors[category]`, which renders in that card's `CardFoot` status slot as a `role="alert"` line |
| `BandStatusCard` failover toggle | `toast.error(result.error)` |

`track()` clears the category's entry before the call, so a retry that succeeds clears the old message.

## The status card (`BandStatusCard`)

`BAND_HERO` is the page's one `rounded-hero` (20px) card and declares `@container/hero`. Inside it:

```
<section BAND_HERO>
  ├── <div HERO_SPLIT>                   flex-col; @2xl/hero:flex-row items-stretch
  │   ├── HERO_ONAIR_PANEL  rounded-card  flex-1 — title, summary, tile grid
  │   └── HERO_RAIL_PANEL   rounded-card  25rem  — disc, title, subtitle, 3 rows
  └── HERO_ROW              rounded-field full width — Band Failover
```

**The panels stretch to one height and the tiles grow into it.** `HERO_SPLIT` is `@2xl/hero:items-stretch` and `HERO_ONAIR_GRID` is `flex-1`, so the pair reads as one aligned band. This replaces the earlier `items-start` layout, where each panel ended at its own content. The breakpoint scope still matters: below `@2xl/hero` the container is `flex-col`, and the default `stretch` is what gives both panels full width there.

### On air now

One tile per raw `CarrierComponent` (a band can appear twice, as PCC and SCC). `sortCarriers()` orders PCC first, then LTE before NR; because the tile body is neutral, order is the only channel carrying PCC primacy. Do not "tidy" it back to modem order.

| Slot (`HERO_ONAIR_TILE`) | Content | i18n |
| ------------------------ | ------- | ---- |
| `BANDWIDTH` | Channel width, `absolute top-4 right-5`, only when `bandwidth_mhz > 0` | `band_locking.status.mhz` |
| `TOP` → `DISC` | 40px identity disc: `carrierDiscTone` (`bg-primary` NR / `bg-lte` LTE), glyph `signal_cellular_alt` for both | — |
| `TOP` → `BAND_ROW` / `DETAIL` | Band designator; then `EARFCN {{value}}` and `PCI {{value}}`, each omitted when null | `status.earfcn`, `status.pci` |
| `METRICS_GROUP` (`mt-auto`) | RSRP numeral in ramp ink (`qualityInkClass`), the `RSRP` word, an `sr-only` quality word, then a `MetricBar` | `status.dbm`, `status.rsrp`, `status.no_value`, `status.quality.*` |

The tile's `role="listitem"` carries `aria-label` `status.tile_aria` ("{{tech}} carrier, {{role}}"), which is how a screen reader learns LTE vs NR and PCC vs SCC.

> ⚠️ WARNING: the meter's null is decided **before** `signalToProgress` is called (`tone === null ? null : signalToProgress(...)`). `signalToProgress` returns `0`, not `null`, for a missing reading, and `MetricBar` would draw a red stub for it — inventing a signal problem for a carrier the modem reported nothing about. `MetricBar` is higher-is-worse, so `warnAt` / `dangerAt` are pinned at an unreachable `101` and the tone comes from `colorOverride`.

The tile reads the shared quality map (`getSignalQuality` / `signalToProgress` against `RSRP_THRESHOLDS`), so this tile, Tower Locking and the antenna surfaces agree on what "fair" is. It does **not** go through `lib/radio-info.ts`'s `enrichCarriers()`.

The summary line is pluralised (`status.on_air_summary_one` / `_other`, "{{count}} carriers ({{mhz}} MHz)"). With no carriers the grid is replaced by a `ConditionScreen` (`neutral`, `signal_cellular_off`, `className="rounded-tile bg-surface py-10"`); the override is load-bearing because the primitive's `neutral` ground is identical to the panel's `surface-container`.

The 2026-11 port dropped the centre frequency line, RSRQ / SINR, the lone-carrier "absent leg" cell and the on-air footnote. They are RM520N-only additions RM551E never had.

### Lock posture

`categoryPosture(locked, supported, hasReading)` in `shapes.ts` is the one derivation shared by the rail rows, the rail subtitle and each card's header chip:

| Condition (in order) | `BandPosture` | `CATEGORY_BADGE` | Rail label |
| -------------------- | ------------- | ---------------- | ---------- |
| `!hasReading` (`current.sh` failed) | `unavailable` | `muted` / `visibility_off` | `status.rail_unavailable` |
| `supported.length === 0` | `unknown` | `muted` / `help` | `status.rail_unknown` |
| `locked` empty | `locked` | `warning` / `lock` | `status.rail_locked` |
| `locked` covers every supported band | `unrestricted` | `success` / `lock_open` | `status.rail_unrestricted` |
| otherwise | `locked` | `warning` / `lock` | `status.rail_locked` |

The disc (`HERO_RAIL_DISC`, 44px) shows `POSTURE_GLYPH[overall]`. The aggregate rule is "any restriction at all is locked": `unavailable` first, then `unknown` when no category reported, `unrestricted` when none is restricted, else `locked`. The subtitle tells partial from full in words (`status.subtitle_locked`, "{{count}} of {{total}} categories locked").

> ⚠️ WARNING: `unavailable` and `unknown` must keep different glyphs. "The modem has no such list" and "we could not read the list" are different facts, both chips are `muted`, so the glyph is the only channel separating them.

Each rail row is a `<button>` (`HERO_RAIL_ROW`) with the short name, `status.ratio` ("{{count}} of {{total}} bands"), a status chip and a chevron. Clicking calls `onSelectCategory`, which smooth-scrolls to `categoryCardId(category)`. Its `aria-label` is `status.rail_aria`. A failed read shows `status.ratio_unavailable` instead of a ratio over a fabricated zero.

### Band Failover

Failover is a property of the **modem**, not of a category: `lock.sh` arms one watcher whichever category was written. So it is a hero-level row (`HERO_ROW`, `bg-surface-container`) spanning both panels, not a fourth rail row.

The control is a `SegmentedField` with `off` / `on` options (`common` `state.off` / `state.on`), `breakpoint="never"`, `disabled={isGated}`. The help copy sits behind a `HintIcon` (`settings_card.band_failover_tooltip`, aria label `band_failover_info_aria`). A change commits immediately — there is no draft and no `CardFoot` — and toasts `settings_card.toast.failover_enabled` / `failover_disabled` or the returned error. Choosing the value already in force is a no-op.

Beside it sits the RM520N **verdict chip** (RM551E shows a bare dot). `failoverKey()` and `FAILOVER_BADGE` live in `shapes.ts`, and the order is significant:

| Order | Condition | `FailoverKey` | Variant / glyph | Label (`settings_card.status.*`) |
| ----- | --------- | ------------- | --------------- | -------------------------------- |
| 1 | `!enabled` | `disabled` | `muted` / `do_not_disturb_on` | Disabled |
| 2 | `activated` | `fallback` | `warning` / `warning` | Fallback active |
| 3 | `watcher_running` | `monitoring` | `info` / `progress_activity` (spins) | Checking |
| 4 | — | `ready` | `success` / `check_circle` | Ready |

`activated` outranks `watcher_running` because a watcher that already fired is reporting a fallback, not progress. Every state has its own glyph: `success` and `warning` containers measure ~1.03:1 apart, so the glyph is the only separation between "armed" and "fired".

After a lock that returns `failover_armed: true`, the hook polls `failover_status.sh` every 1 s (flag files only, no AT traffic) until the watcher exits, then re-reads `current.sh` if it activated, because the watcher rewrote the band lists to the supported set.

## Refreshing the page

`current.sh` is fetched on mount, after a successful lock and on Refresh — nothing polls it. A scheduled scenario can rewrite bands on-device underneath an open page, so the header Refresh button is a state-honesty fix.

- **`isLoading` vs `isRefreshing`.** `isLoading` is first load only and drives skeletons; `isRefreshing` is set only by `refresh()` and keeps the loaded layout up. Fusing them blanked the page, and also hid the gate banners (they render on `!isPageLoading`), on every refresh. The 1 s failover poll calls `fetchCurrent` directly and never touches `isRefreshing`.
- **`refresh()` returns `Promise<boolean>`.** A failure toasts `band_locking.toast.refresh_error`; success is evident from the page.
- **Blocked while the watcher runs.** `lockingCategory` clears when the `lock.sh` POST resolves, which is exactly when `qmanager_band_failover` starts. The watcher treats any non-zero `qcmd` exit as "no carrier", including a lost AT-lock race, and `current.sh` takes that same lock. The button carries `title={t("band_locking.refresh_blocked_watcher")}` while blocked.
- **Foreign-watcher adoption.** `current.sh` can report `watcher_running: true` on a plain page load (another tab, a reload inside the window). An effect in `useBandLocking` starts the poll whenever `watcher_running` is true and no poll is running, so the block cannot latch on forever.
- **One gate for both refresh paths.** The header button and the read-error retry both read:

```tsx
const isRefreshBlocked =
  isBusy || isRefreshing || bandsLoading || isWatcherRunning;
```

> ⚠️ WARNING: do not restate this expression at either call site. The read-error block most often appears right after a lock, which is exactly when the watcher starts — an ungated retry there would be the only live refresh on screen at the most hazardous moment.

## When the band read fails

A failed `current.sh` sets `readError` (a separate channel from write results) and leaves `currentBands` at its previous value, or `null` on first load. The coordinator passes `hasCurrentReading = currentBands !== null`.

- **Page level:** a `ConditionScreen` with `tone="destructive"`, `glyph="visibility_off"`, `ariaRole="alert"`, retry = `handleRefresh` gated by `isRefreshBlocked` (`disabled` + `disabledReason`).
- **Card level:** posture becomes `unavailable`, the card freezes (any write would be blind and could replace a lock the user was never shown), the header chip reads `card_badges.unavailable` with no count, and the `CardFoot` status slot shows `card.unavailable_note`.
- `unavailable` **outranks the gate** for the header chip: the gate says who may change the setting, `unavailable` says nobody knows what it is.

`fetchCurrent` guards the payload (`!data.success || !data.current || !data.failover`); `BandCurrentResponse` marks both objects optional because the error envelope omits them.

`ConditionScreen` (`components/cellular/condition-screen.tsx`) has optional `disabled` / `disabledReason` props for this. The reason is exposed through `title` plus an `sr-only` node referenced by `aria-describedby` (not `aria-description`, which the `button` role does not support).

## The category card (`BandGridCard`)

Three branches, all on `BAND_CARD` (`rounded-card`):

- **Loading** — `SKELETON_SHAPE` mirrors, including `CHIP_COUNT = 12` chip placeholders.
- **Empty** (`supportedBands.length === 0`) — a SKU fact, not a fault: `ConditionScreen` `neutral` / `do_not_disturb_on`, `card_empty`.
- **Loaded** — header chip, chip grid, conditional legend, `sr-only` applying announcement, and the `CardFoot`.

`CardFoot` layout:

| Slot | Content |
| ---- | ------- |
| `status` | Two `RevealButton`s — Select all (`done_all`) and Clear (`close`) — then the write error (`role="alert"`) or the unavailable note |
| `actions` | "Restore all supported" (`tonal-neutral`, `size="action"`, text only), then the `SaveButton` "Lock selected" |

`SaveButton` is disabled when frozen, when nothing is selected, or when `pendingCount === 0`. The header chip reports the **modem** (`card_badges.bands_locked`, "{{locked}} / {{total}} Bands"); the chip fill/ring reports the **draft**.

Chip entrance uses `rowCascadeDelay(index)` through the variant's `custom`, not `staggerChildren`, because a supported list runs past twenty and an unbounded stagger reads as still loading.

## The killed translation trap

The pre-2026-08 toast built its copy by cutting `" Locking"` out of the rendered English title, which would have broken silently on the first translation. Category copy is now resolved from the `BandCategory` discriminator only:

```ts
categoryTitleKey("nsa_nr5g")  // "band_locking.cards.nsa_nr5g.title"
categoryShortKey("nsa_nr5g")  // "band_locking.card_category_label.nsa_nr5g"
```

The card interpolates `shortName` into `toast.locked_success` / `toast.unlocked_success` and `card_live_region`. `bun run i18n:check` cannot catch a hardcoded literal, so never rebuild copy from rendered strings.

## Geometry and tone (`shapes.ts`)

| Constant | Purpose |
| -------- | ------- |
| `BAND_HERO` | The status card, `rounded-hero`, declares `@container/hero` |
| `BAND_CARD`, `CARD_PAD` | Category card shell (`rounded-card`) and its `px-6` padding |
| `HERO_SPLIT` | Two-panel layout, `@2xl/hero:flex-row @2xl/hero:items-stretch` |
| `HERO_ONAIR_PANEL`, `HERO_ONAIR_GRID`, `HERO_ONAIR_TILE`, `ONAIR_TILE_MIN_H` | On-air panel (`@container/onair`), 1 → 2 → 3 column grid, tile slots, `min-h-[8.5rem]` tile floor |
| `carrierDiscTone`, `CARRIER_DISC_GLYPH` | Identity disc fill (NR `bg-primary`, LTE `bg-lte`) and glyph (`signal_cellular_alt` for both) |
| `HERO_RAIL_PANEL`, `HERO_RAIL_DISC`, `HERO_RAIL_TITLE`, `HERO_RAIL_SUBTITLE`, `HERO_RAIL_ROW*` | Posture rail: fixed `25rem` above `@2xl/hero`, 44px disc |
| `HERO_ROW`, `HERO_ROW_MIN_H`, `HERO_ROW_LABEL` | The failover row, `min-h-[3.25rem]` floor shared with its skeleton |
| `BAND_CHIP`, `BAND_CHIP_LIVE_RING`, `bandChipClass`, `bandChipA11yKey`, `BAND_LEGEND` | The two-axis chip contract |
| `FailoverKey`, `FAILOVER_BADGE`, `failoverKey` | Failover verdict chip |
| `BandPosture`, `CATEGORY_BADGE`, `categoryPosture`, `POSTURE_GLYPH`, `BADGE_GLYPH_SIZE` | Posture derivation and its chips |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by import |
| `RAIL_CATEGORIES`, `categoryTitleKey`, `categoryDescriptionKey`, `categoryShortKey`, `categoryCardId` | Category order, i18n stems, scroll-target id |

> ⚠️ WARNING: `ONAIR_TILE_MIN_H` and `HERO_ROW_MIN_H` are verbatim literals. Tailwind's scanner reads source text; a class assembled at runtime never reaches the stylesheet.

## Props contracts

### `BandStatusCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `failover` | `FailoverState` | `{ enabled, activated, watcher_running }` |
| `carrierComponents` | `CarrierComponent[]` | From `useModemStatus`; rendered raw, sorted, not deduplicated |
| `supportedBands` | `Record<BandCategory, number[]>` | `policy_band` per category |
| `lockedBands` | `Record<BandCategory, number[]>` | `ue_capability_band` per category |
| `hasCurrentReading` | `boolean` | False when `lockedBands` is the `[]` fallback of a failed read |
| `onToggleFailover` | `(enabled: boolean) => Promise<BandActionResult>` | The card toasts the result |
| `onSelectCategory` | `(category: BandCategory) => void` | Scrolls to that category's card |
| `isLoading` | `boolean` | Page-level `statusLoading \|\| bandsLoading \|\| scenariosLoading`; never ORs in `isRefreshing` |
| `isGated` | `boolean?` | Disables the failover toggle |

### `BandGridCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `bandCategory` | `BandCategory` | `"lte" \| "nsa_nr5g" \| "sa_nr5g"` |
| `supportedBands` | `number[]` | Sorted |
| `currentLockedBands` | `number[]` | Sorted; new array identity every parent render |
| `hasCurrentReading` | `boolean` | Drives `unavailable` |
| `onLock` | `(bands: number[]) => Promise<BandActionResult>` | Wrapped in the coordinator's `track()` |
| `onUnlockAll` | `() => Promise<BandActionResult>` | Wrapped in `track()` |
| `isLocking` / `isBusy` / `isLoading` | `boolean` | This card's write / any write / page load |
| `error` | `string \| null` | This category's last failed write |
| `isGated` | `boolean?` | Standing condition |
| `gatedBy` | `"profile" \| "scenario"?` | Picks the gated badge label; defaults to `"scenario"` |

## Known gaps

- **The failover help copy states the wrong window.** `band_locking.settings_card.band_failover_tooltip` (ported from RM551E) says the modem falls back after "about 5 seconds" in all five locales. The watcher's window is ~30 seconds (`SETTLE_DELAY=5` + `MAX_CHECKS=5` × `CHECK_INTERVAL=5`). The old key `band_locking.live.failover_help` says 30 seconds but nothing reads it any more. If the watcher constants are ever retuned, this string has to move with them in all five locales; nothing links them mechanically.
- **Retired keys are still in the catalogs.** The port added `band_locking.status.*`, `settings_card.*`, `card_badges.*` and others alongside the old trees, which were left in place (an add-only merge rule for this phase). At `afc517fe` nothing under `components/cellular/band-locking/` or `hooks/use-band-locking.ts` reads `band_locking.live.*`, `states.*`, `short.*` or `categories.*`. Unread keys still count toward `i18n:check` parity.
- **The failover toggle is disabled while gated**, so a scenario-controlled page cannot turn the safety net on. Left as is: [sim-profiles.md](sim-profiles.md) documents that the profile-apply path arms the watcher itself, and changing the gate here alone would create two owners for one flag.
- **An identical lock cannot be re-applied**, so an expired watcher cannot be re-armed without changing the selection (toggle a band off and on).
- **The onboarding band step** (`components/onboarding/steps/step-band-locking.tsx`) is still a visually separate implementation: `Checkbox` primitives, hardcoded English, its own `authFetch` POSTs. Its write path matches this page (serialised, judged on `data.success`) since `578ddb2`.
- **NR-DC** (`nrdc_nr5g`) is not available on this device's page; see the note under [Component tree](#component-tree).

## Related

- [sim-profiles.md](sim-profiles.md) — the profile/scenario gate's other half, scheduled-scenario resolution, the watcher on the apply path
- [scheduled-timers.md](scheduled-timers.md) — the timer that applies a windowed scenario
- [tower-locking.md](tower-locking.md) — the sibling lock page, ported in the same pass
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, which the on-air tiles read
- [antenna-alignment.md](antenna-alignment.md) — the shared `condition-screen.tsx` and `signal-quality-display.ts` primitives
- [at-command-transport.md](at-command-transport.md) — `qcmd` exit-status semantics the watcher relies on
- [i18n.md](i18n.md) — the locale pipeline and `i18n:check`
- `DESIGN.md` > Named Rules (Consistent-Layout, Glyph-Disc, Skeleton-Mirror, One-Scale)
