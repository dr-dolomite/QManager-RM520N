# Band Locking (`/cellular/cell-locking`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Band Locking is the page where a user narrows what their radio is allowed to use — and it is one of the few surfaces in QManager where a wrong click can take the connection away while you are standing on it.** Locking a band writes `AT+QNWPREFCFG="lte_band",…` (or the NSA / SA equivalent) to the modem; if the bands you picked are not actually serving your location, the modem has nowhere to camp and the link drops. That single risk shapes everything below: the two-axis band chip that shows you a pending change *before* you write it, the deliberately un-gated "Restore all supported" recovery action, and the failover watcher that reverts your lock automatically when no carrier appears.

The 2026-08 redesign is **frontend-only**. `hooks/use-band-locking.ts`, `types/band-locking.ts` and all four CGI scripts under `scripts/www/cgi-bin/quecmanager/bands/` are untouched. What changed is the shape of the page (a read-only hero over three peer control cards, replacing a four-way grid that treated a status panel and three control surfaces as peers), the control itself (a two-axis chip replacing a checkbox), and the copy (2 i18n keys → 67, in all five locales).

The hero itself was then rebuilt a second time, onto shape **"2a" ("Compact tile grid")** of the *Band Locking Hero Options* design exploration (`claude.ai/design/p/681e72a4-f061-4bb2-857a-408c64670b36`). It is now **two side-by-side panels inside one hero section** — a wrapping grid of on-air carrier tiles on the left, a clickable "Lock posture" rail on the right — replacing the single-column stack of eyebrow + posture badges + failover strip + on-air text. See [The hero: two panels, one section](#the-hero-two-panels-one-section).

A third pass (2026-08-22) then did four things, all still frontend-only:

- **The carrier tile lost its body tint.** The tile is now a neutral `bg-surface` body with a 40px identity disc, real outline `Tag`s, and the shared five-stop signal-quality ramp on its RSRP numeral and bar. See [The tile body is neutral; the disc carries the colour](#the-tile-body-is-neutral-the-disc-carries-the-colour).
- **Failover left the rail and became a hero-spanning row.** This **reverses** the placement this doc previously argued for by name — see [Why failover spans the hero](#why-failover-spans-the-hero) for the two facts that overruled it.
- **The page gained a Refresh action**, plus the two guards that make pressing it safe. See [Refreshing the page](#refreshing-the-page).
- **The rail disc became a real state indicator.** `POSTURE_GLYPH` had been a dead export while the disc hard-coded one glyph for all three postures; it is now wired to a derived aggregate posture.

This doc records the invariants that a future contributor will otherwise "clean up": why the live ring is a shadow and not a border, why `unlockAll` is a write, why one render-phase state sync must never become an effect, why the busy flag blocks all three categories, and why a string-surgery toast was a translation bug waiting to fire.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/cell-locking` (`app/cellular/cell-locking/page.tsx`) |
| Page coordinator | `components/cellular/band-locking/band-locking.tsx` |
| Geometry + tone contract | `components/cellular/band-locking/shapes.ts` |
| Read-only hero | `components/cellular/band-locking/live-band-hero.tsx` |
| One category card (×3) | `components/cellular/band-locking/band-grid-card.tsx` |
| Shared `/cellular/` page header | `components/cellular/page-header.tsx` |
| Data + actions hook | `hooks/use-band-locking.ts` |
| Types + band-string helpers | `types/band-locking.ts` |
| Read current config | `GET /cgi-bin/quecmanager/bands/current.sh` |
| Apply a lock | `POST /cgi-bin/quecmanager/bands/lock.sh` |
| Failover toggle / poll | `POST …/failover_toggle.sh`, `GET …/failover_status.sh` |
| Failover watcher | `scripts/usr/bin/qmanager_band_failover` |
| Supported bands + on-air bands | `hooks/use-modem-status.ts` (`device.supported_*_bands`, `network.carrier_components`) |
| i18n | `band_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**78 leaf keys per locale**, counted and verified identical across all five) |
| Shared quality map (ink / meter tone / glyph) | `components/cellular/signal-quality-display.ts` |
| Shared empty/error primitive | `components/cellular/condition-screen.tsx` |
| Scroll anchors the hero rail targets | `id="band-locking-card-{category}"` on each card wrapper in `band-locking.tsx` |

> ℹ️ NOTE: `band-settings.tsx` and `band-cards.tsx` are **deleted**, not renamed. `live-band-hero.tsx` and `band-grid-card.tsx` are their replacements, and neither is a port — the card replaced its control, and the hero has since been rebuilt a second time into the two-panel split described below.

## Component tree

```
BandLockingComponent                      ← owns every hook; no child talks to CGI
├── CellularPageHeader                     (shared, components/cellular/page-header.tsx)
│   └── actions: Refresh pill              ← see "Refreshing the page"
├── sr-only aria-live region               ← announces the refresh; the layout stays put
├── ProfileOverrideAlert | Banner          (the two gates, one primitive)
└── motion cascade
    ├── LiveBandHero                       ← read-only: on-air tile grid | lock-posture rail,
    │                                        then a hero-spanning failover row beneath both
    └── grid (1 col → 2 at @3xl/main)
        ├── BandGridCard  category="lte"        id="band-locking-card-lte"
        ├── BandGridCard  category="nsa_nr5g"   id="band-locking-card-nsa_nr5g"
        └── BandGridCard  category="sa_nr5g"    id="band-locking-card-sa_nr5g"
```

The three `id`s are not decoration: each category-card wrapper `motion.div` in `band-locking.tsx` carries `id={`band-locking-card-${category}`}` plus `scroll-mt-20`, because the hero's rail rows scroll to them (see [The lock-posture rail](#the-lock-posture-rail)). The `scroll-mt-20` is what keeps a smooth-scroll landing *below* the sticky shell header instead of underneath it.

The coordinator is the only component that calls a hook. It reads `useModemStatus`, `useBandLocking`, `useConnectionScenarios` and `useSimProfiles`, and hands everything down as props. There are three band categories because there are three AT parameters — `lte_band`, `nsa_nr5g_band`, `nr5g_band` — and `lock.sh` maps `BandCategory` onto them one-to-one.

## The two-axis band chip

**Short version: a band has two independent facts about it, and the old checkbox could only carry one.** The two facts are:

- **SELECTED** — what you have picked and have not applied yet. Purely local React state.
- **LIVE** — what is actually configured on the modem right now, read back from `AT+QNWPREFCFG="ue_capability_band"` by `current.sh`.

A checkbox has one channel. So the moment you clicked, the incumbent grid claimed the new state as though the modem already had it — and the two most important states on this page, *pending add* and *pending removal*, could not be drawn at all.

The chip splits them onto two channels that cannot interfere:

| Channel | Carries | Rendering |
| ------- | ------- | --------- |
| **Fill** | SELECTED | `primary-container` when picked, `surface-container` when not (`bandChipFill`) |
| **Ring** | LIVE | 2px inset `--primary` shadow, present iff the band is on the modem (`BAND_CHIP_LIVE_RING`) |

Which gives four readable combinations:

| Fill | Ring | Means |
| ---- | ---- | ----- |
| yes | yes | Already locked, staying locked |
| yes | no | **Pending add** — will be locked when you apply |
| no | yes | **Pending removal** — will be dropped when you apply |
| no | no | Not locked, staying that way |

`bandChipClass(selected, live)` composes both; nothing else may hand-write the classes.

### Why the ring is an inset shadow, not a border

A real CSS `border` adds a layout box. Every chip in the grid would therefore grow by 2px the instant a lock landed, and the whole grid would visibly reflow on **every successful apply** — the one moment the user is watching it most closely. An inset `box-shadow` costs no box, so gaining or losing the ring is a pure repaint. This is the same construction and the same reasoning as `PROFILE_ROW_ACTIVE_RING` in [sim-profiles.md](sim-profiles.md)'s shapes contract.

This is *not* a No-Hairline-On-Fill violation. That rule bans a stroke drawn to prop up a fill too weak to read on its own. Here the fill reads fine alone and the ring carries a **different fact** — a second independent signal, not a crutch for the first.

`--primary` is the ring colour because it has to survive on both fills, in both themes. `--primary` and `--primary-container` sit far apart on the lightness axis and move in opposite directions across the theme flip (light: L 0.488 on L 0.885; dark: L 0.79 on L 0.4). A ring drawn in `on-primary-container` would vanish against the container it sits on.

### Non-visual channels

The ring is a *shape* signal, so it survives greyscale and every colour-vision deficiency. Screen readers get words regardless: `bandChipA11yKey(selected, live)` resolves to one of three sentences (`{{band}}, selected` / `, not selected` / `, selected and active on the modem`). A pending removal announces as "not selected", which is the truthful description of what applying would do.

Chips also carry `aria-pressed={selected}`, and the grid is a `role="group"` labelled with the category title.

### Touch target

The chip paints at **40px** (`h-10`, matching the metric-row-pill height so a band chip and a glance row read as one family) with a `before:` overlay expanding the hit area to the project's 44px coarse-pointer floor without adding a layout box. The incumbent target was a `size-4` checkbox — 16px, on a page used roadside, in sun, on a tablet, on a device whose connection you are about to reconfigure.

### The legend names the CONFIGURATION fact

The legend under a chip grid (`BAND_LEGEND`, rendered only when at least one band is live) labels the ring swatch **"Currently locked"** (`band_locking.card.legend_live`). It used to read "On the modem now" — and the hero directly above the card has its own, unrelated **"On air now"** block. Two near-identical phrases, one metre apart, describing different data:

| Label | Source | Fact |
| ----- | ------ | ---- |
| Hero, "On air now" | `network.carrier_components` (poller) | Where the radio is **actually camped** this instant |
| Card legend, "Currently locked" | `ue_capability_band` (`current.sh`) | What is **configured** — whether or not the radio is using it right now |

Both are loosely describable as "on the modem now", which is exactly how they got conflated. The rename is copy-only: no props, no components and no keys changed, just the English string plus its translated equivalents in the other four locales, and the rationale comment above `BAND_LEGEND` in `shapes.ts`.

## `unlockAll` is a WRITE, not a clear

**"Restore all supported" does not clear anything — it writes the full supported band list to the modem.** `useBandLocking.unlockAll` (`hooks/use-band-locking.ts:265-279`) is a thin wrapper that calls `lockBands(category, supportedBands)`. The same `lock.sh` endpoint, the same `AT+QNWPREFCFG` write, the same failover watcher arming. "Unlock" on this page means "lock to everything", because the modem has no concept of an empty band restriction.

The incumbent labelled it "unlock/reset" behind an unlabelled `restart_alt` icon whose only explanation was a `title` attribute — which never appears on a touch device. It now has a visible label, `Restore all supported`.

**It deliberately has no confirmation dialog.** It is the one band write on this page that can only ever *widen* what the modem may use, so it is the recovery action — the thing you reach for when a lock you just applied left you with no service. Gating recovery behind a dialog while `Apply` (the write that can actually cost you the connection) fires freely would invert the risk gradient this product is built around.

It is disabled only when it would be a no-op (`categoryPosture(...) === "unrestricted"`) or when the card is frozen. That check goes through the shared helper in `shapes.ts`, so the button's enabled-ness, the card's header chip and the hero's badge for this category all read one definition of "unrestricted".

## The `prevLockedKey` render-phase sync

`band-grid-card.tsx` keeps the local selection in sync with the modem using React's documented "adjust state when a prop changes" pattern, run **during render**:

```tsx
const [prevLockedKey, setPrevLockedKey] = useState("");
const lockedKey = currentLockedBands.join(":");
if (prevLockedKey !== lockedKey && currentLockedBands.length > 0) {
  setPrevLockedKey(lockedKey);
  setCheckedBands(new Set(currentLockedBands));
}
```

Three things about this block are load-bearing.

**It must not become a `useEffect`.** `currentLockedBands` is rebuilt by a `useMemo` in the coordinator on every parent render, so it is a **new array identity every time**. An effect keyed on it would re-run forever. The joined string key is what makes the comparison meaningful — it compares *contents*, not identity.

There is a second, quieter cost to getting this wrong: `eslint-plugin-react-hooks` v7 is compiler-backed and **stops at the first violation it finds in a component**. Introducing one here would suppress every later diagnostic in the file, so the mistake would also hide its own neighbours. (Same toolchain behaviour documented in [radio-information.md](radio-information.md).)

**The `length > 0` guard is not dead defensiveness.** `current.sh` initialises each band variable to `""` and only fills it if the corresponding `+QNWPREFCFG:` line is present — so a category the modem does not report comes back as an empty string, which `parseBandString` turns into `[]`. Without the guard, every poll of an unreported category would wipe a selection the user was in the middle of making.

**This block is the ONLY thing that repaints the grid after a write.** The full chain is:

```
Apply / Restore all
  → onLock / onRestoreAll (coordinator)
  → lockBands  (hooks/use-band-locking.ts)
  → POST lock.sh
  → fetchCurrent()  → GET current.sh
  → new currentBands → new lockedBands memo → new currentLockedBands prop
  → new lockedKey → THIS BLOCK → setCheckedBands
```

Nothing else connects a click to the grid updating. Delete or "simplify" this block and Apply becomes a button that appears to do nothing.

## The gate chain

Two things outside this page can own radio configuration, and while either does, the band controls are read-only.

| Gate | Source | Banner |
| ---- | ------ | ------ |
| **Profile** (outranks scenario) | `useSimProfiles` → the active profile's scenario binding, resolved for *now* | `ProfileOverrideAlert` |
| **Scenario** | `useConnectionScenarios.activeScenarioId !== "balanced"` | `Banner role="override"` |

Both banners go through one primitive family. The incumbent rendered the profile gate through the shared `Banner` and the scenario gate through a legacy `Alert`, so two near-identical sentences arrived in two different shapes depending on which override happened to be in force.

A **Balanced** binding is treated as "no opinion" and leaves bands editable: Balanced re-applies AUTO mode and does not touch bands, so it is not competing for this setting.

### `resolveScheduledScenario(now, …)` is not `profile.scenario.default`

**The gate resolves the scenario that is in force at this instant, not the profile's default binding — and the difference is a real conflict, not a nicety.**

`profile.scenario.default` mirrors only the profile's fallback binding. It is blind to a schedule window that is active right now. The on-device systemd timer applies the **windowed** scenario (see [scheduled-timers.md](scheduled-timers.md) and [sim-profiles.md](sim-profiles.md)), so reading the static field would make this page disagree with the modem — and would let a user edit bands that a scheduled scenario is about to overwrite.

That matters because **scenarios issue the identical `AT+QNWPREFCFG` writes this page does.** It is genuine last-writer-wins contention over one modem parameter, not an advisory hint. `nextChangeAt(now, …)` supplies the "the active scenario is scheduled to change at HH:MM" note in the same banner.

### `isGated` and `isBusy` are separate props — keep them separate

The incumbent fused them into a single `isDisabled`, and only the header chip told them apart. They mean different things and the user needs both:

| Prop | Kind | Meaning | How it clears |
| ---- | ---- | ------- | ------------- |
| `isGated` | **Standing condition** | A Custom SIM Profile or Connection Scenario owns radio config | By changing something on another page; explained by the page-level banner |
| `isBusy` | **Transient** | A band write is in flight | On its own, in seconds |
| `isLocking` | Transient, **this card only** | *This* category's write is in flight | Drives the `SaveButton` spinner |

`isFrozen = isGated || isBusy` is the interaction block; `isLocking` stays per-card so the spinner lands on the button the user actually pressed. The header status chip reads `scenario` (info / `shield`) when gated, so a disabled card always says *why*.

## `isBusy` blocks all three categories during any lock

**This is a deliberate correction to the incumbent's per-category blocking, and the reason is in the shell, not the UI.**

When `lock.sh` arms the failover watcher, it first **kills any watcher already running** (`lock.sh`, the `FAILOVER_PID_FILE` branch) — only the most recent lock is monitored. The watcher's safety window is ~30 seconds: a 5-second settle, then five `AT+QCAINFO` checks 5 seconds apart (`SETTLE_DELAY=5`, `CHECK_INTERVAL=5`, `MAX_CHECKS=5` in `scripts/usr/bin/qmanager_band_failover`). It exits early and cleanly the moment any check finds carrier data.

So two locks fired seconds apart leave the **first** narrowing completely unmonitored for the rest of its safety window. If that first lock was the one that killed your connection, nothing is watching for it any more. Blocking all three cards while any one writes is the cheapest way to make that unrepresentable from this page.

> ⚠️ WARNING: a future "apply all three categories at once" button must be built as a **multi-category `lock.sh` that arms ONE watcher**, not as a client-side fan-out. Three concurrent POSTs would have each one kill the previous watcher, leaving two of the three narrowings unmonitored — strictly worse than the serialised behaviour this flag enforces. `components/onboarding/steps/step-band-locking.tsx` already demonstrates exactly this pathology: it fires up to three `lock.sh` POSTs under a single `Promise.allSettled`.

## Error scoping

`useBandLocking` exposes **one shared `error` string** for all three categories. The incumbent handed it to all three cards, so a failed SA write painted an identical red notice under LTE, NSA and SA and the user had to guess which had actually failed.

The coordinator scopes it with a single piece of state:

```tsx
const [lastAttempted, setLastAttempted] = useState<BandCategory | null>(null);
// …
error={lastAttempted === category ? error : null}
```

`setLastAttempted(category)` runs **before** the call, so it is already correct by the time a failure lands. This scopes the error without reshaping the hook's contract — deliberately, since the hook is shared with nothing else and reshaping it would be a larger change than the bug warrants.

The notice itself is a filled tonal block (`NOTICE` + `NOTICE_TONE`, `destructive-container` with a `destructive` glyph disc), replacing the surface's loudest legacy tell: `bg-destructive/10 border border-destructive/30 text-destructive`. A 10% alpha over a tinted surface is not a stable colour — it collapses in dark mode and washes out first in sunlight, which is the exact ambient condition this product is designed against.

## The killed translation trap

**Short version: the incumbent built its toast copy by cutting a substring out of the rendered English title, so translating the page would have broken the toast — silently, with no gate able to see it.**

The incumbent line was:

```tsx
toast.success(`${title.replace(" Locking", "")} bands locked successfully`)
```

The first thing any i18n pass does is translate the card titles — they are the most visible strings on the page. The moment that happens, `.replace(" Locking", "")` stops matching, and the toast reads "LTE Band Locking bands locked successfully" **in English**, beside a translated title.

No gate catches this:

- `bun run i18n:check` exits **1** on a missing key since 2026-08-12, so a green run does now prove every locale landed — but it can only grade keys that *exist*, so a hardcoded English literal remains invisible to it (see [i18n.md](i18n.md)).
- A hardcoded literal has **no key to be missing** in the first place, so the check cannot see it at all.

The fix is `categoryShortKey(category)` in `shapes.ts`, alongside `categoryTitleKey` and `categoryDescriptionKey`. Each resolves an i18n key from the **`BandCategory` discriminator**, never from rendered copy:

```ts
categoryTitleKey("nsa_nr5g")  // "band_locking.categories.nsa_nr5g.title"  → "5G NSA"
categoryShortKey("nsa_nr5g")  // "band_locking.short.nsa_nr5g"             → "5G NSA"
```

`band-grid-card.tsx` reads `shortName` once and interpolates it into all five toast keys and the `sr-only` applying announcement. The title and the short name are now derived from the same enum in every locale, so they cannot drift.

## The hero: two panels, one section

`LiveBandHero` replaced `band-settings.tsx` — six label/value rows held apart by seven `<Separator>` elements (one of them trailing, with nothing after it) sitting in the same grid as the three interactive cards, as though a read-only status panel and a control surface were the same kind of object.

Its current shape is **"2a" ("Compact tile grid")** from the *Band Locking Hero Options* design exploration. The single-column hero it replaced stacked three unrelated full-width strips inside one card, so the tallest element on the page was also the emptiest, the most valuable live fact (what the radio is actually camped on) sat last and smallest, and a posture summary restated what each category card's own corner badge already said.

`HERO_SPLIT` lays the two panels out: `flex-col` below `@2xl/hero`, `flex-row` above it — a **container** query against `@container/hero`, which `BAND_HERO` itself declares, so the split responds to the hero's own width rather than the viewport. Since the 2026-08-22 pass a **third** element sits inside the same hero section, below the split: the full-width failover row (see [Why failover spans the hero](#why-failover-spans-the-hero)).

```
<section BAND_HERO>                      rounded-hero (40px) — the ONE hero on this page
  ├── <div HERO_SPLIT>                   @2xl/hero:flex-row @2xl/hero:items-start
  │   ├── HERO_ONAIR_PANEL rounded-card  flex-1  — live-dot header, tile grid, footnote
  │   └── HERO_RAIL_PANEL  rounded-card  25rem   — disc + title + subtitle,
  │                                                3 clickable category rows
  └── HERO_ROW             rounded-field full width — the failover switch
```

### `HERO_SPLIT` aligns to `items-start`, not `items-stretch`

**Each panel now ends where its own content ends, and unequal panel heights are the honest outcome rather than a defect.** Stretching was survivable only while the failover row sat at the rail's foot on `mt-auto` and absorbed the slack. With that row promoted to hero level, and the on-air panel grown taller (the tile gained a 40px disc row), stretching left the rail as a disc block plus three rows floating in a tall empty box.

The fix is *not* to inflate the rows to fill it. A rail row's content is fixed — a label, a ratio, a status badge, a chevron — so its height encodes nothing, and stretching it would make that height vary with **how many carriers are on air**, a completely unrelated fact. That is the Data-Ink Rule applied to geometry: a dimension that varies must vary with something it represents.

> ⚠️ WARNING: `items-start` has to be **set**, not merely un-set. `stretch` is the CSS default for `align-items`, so deleting the utility restores the old behaviour rather than removing an opinion. Both alignment utilities are also `@2xl/hero:`-scoped: below that breakpoint the container is `flex-col` with no `align-items` utility in force, and the default `stretch` on the cross axis is exactly what gives both panels their full width there. Written unscoped, `items-start` would collapse them to their content width.

### Why both panels are `rounded-card`, not `rounded-hero`

The panels sit at **36px, one step below** the outer section's 40px. `BAND_HERO` still solely claims the Consistent-Layout Rule's "a genuine glance surface may earn a hero card" exception; nesting two hero-radius panels inside it would spend that exception twice on one page. The step-down is the same nesting the surface already used for `HERO_ROW` (`rounded-field`, 20px, inside the hero) and for `HERO_ONAIR_TILE` (`rounded-tile`) inside the panel — each level of containment drops a step on the role scale.

### The on-air tile grid

The left panel answers one question: **is this band actually on air right now?** It is the only on-page evidence that a lock actually took.

| View | Source | What it proves |
| ---- | ------ | -------------- |
| **CONFIGURED** | `ue_capability_band` via `current.sh` | What you asked the modem for |
| **ACTUAL** | `network.carrier_components` via the poller | Where the modem is actually camped |

Those are different facts, and the gap between them is exactly the class of bug that bit APN management, where `AT+CGDCONT?` reported a context the modem had never attached with (see [wan-profile-management.md](wan-profile-management.md)). Delete this panel and applying a band lock gives you a green button and no evidence.

**One tile per RAW `CarrierComponent`, not per unique band.** The previous round deduplicated by band designator (a `useOnAirBands` memo producing an `OnAirBand[]`); both that helper and its interface are **gone**. A band legitimately appears twice — as PCC and as SCC — and those are two separate carriers with their own bandwidth, RSRP and PCI, so collapsing them threw away the per-carrier facts the tile now shows.

Each tile (`HERO_ONAIR_TILE`) carries, top to bottom:

| Line | Content | i18n |
| ---- | ------- | ---- |
| Disc + tags + bandwidth (`HEAD`) | A 40px identity disc (`carrierDiscTone` fill, `CARRIER_DISC_GLYPH` mark), then real outline `Tag`s — `nr`/`lte` for the radio family, `neutral` for the raw `PCC`/`SCC` field, a third `neutral` `"No aggregation"` tag when `onAir.length === 1` — with the bandwidth right-aligned | `band_locking.live.tile_tech_LTE` / `_NR`, `tile_no_aggregation`, `radio_info.bands.units.mhz` |
| Band + frequency | The designator (mono, 2xl, tabular) beside its centre frequency from `bandFrequencyMhz()` (`lib/band-frequency.ts`), when the band is in the static 3GPP lookup | `radio_info.bands.units.mhz` |
| Detail | `EARFCN {{earfcn}}` and `PCI {{pci}}` as separate flex children with a real gap between them (not a joined separator glyph), each omitted individually when the modem did not report it for THIS component | `band_locking.live.tile_earfcn`, `radio_info.bands.detail.pci` |
| Signal | RSRP (`{{value}} dBm`, or `–` when null) carrying the quality ramp's **numeral ink** (`qualityInkClass`), plus the `RSRP` word, an `sr-only` quality word, and `RSRQ`/`SINR` as separate flex children when reported | `band_locking.live.tile_rsrp` / `tile_no_value` / `tile_rsrq` / `tile_sinr`, `radio_info.bands.metric.*`, `radio_info.bands.quality.{quality}` |
| Meter | A shared `MetricBar` toned by `qualityMeterTone(quality)` and lengthed by `signalToProgress(rsrp, RSRP_THRESHOLDS)`, `mt-auto`, `aria-hidden` — see [The tile body is neutral; the disc carries the colour](#the-tile-body-is-neutral-the-disc-carries-the-colour) | — |

**This is a reversal of a documented decision, not an oversight.** The tile used to be deliberately Turn 2's compact single-metric-line cut, on the stated reasoning that the hero is "half of a hero, not the whole page" and a fuller tile anatomy would need a second thing to keep in sync with the dashboard's own carrier card. The 2026-08 pass took Turn 3's full-detail tile anyway, because the grid it sits in changed at the same time: `HERO_ONAIR_GRID` moved from `auto-fit, minmax(160px,1fr)` to a fixed 3-column grid (below), and a thin single-line tile inside a wider fixed column sat padded and mostly empty. The width the grid now grants each tile is what makes the fuller anatomy the right call, not a change of mind about density on its own.

**No poller or CGI change was needed for this pass.** EARFCN, PCI, RSRQ and SINR were already on `CarrierComponent` and simply unused by the old compact tile — `AT+QCAINFO` already reports all four per carrier (see `parse_at.sh`'s `parse_qcainfo()`). The tile deliberately does **not** show a cell ID: `AT+QCAINFO` never reports one per component, only the serving-cell query does (`data.lte.cell_id` / `data.nr.cell_id`), and that value describes ONE cell — the PCC's. Showing it correctly would mean showing it on some tiles and not others for a reason a reader has no way to know, so the line was dropped rather than shipped half-right.

**Detail and signal segments are separate flex children, not a joined string.** The first pass joined `EARFCN 9410`, `PCI 214` etc. with `" · "`. That reads fine in isolation but ties the visual gap to a glyph that renders differently across the interface and machine fonts and does not scale with the container query the way a flex `gap` does. Both rows now map their segment array to individual `<span>`s inside a `flex flex-wrap gap-x-3 gap-y-0.5` row, so the spacing is a layout property, not a character.

**Centre frequency is a static lookup, not a poll.** `bandFrequencyMhz(technology, band)` in `lib/band-frequency.ts` maps a 3GPP band designator to its commonly-cited centre frequency (e.g. `"B28"` → 700). It is reference data fixed by spec, not something the modem could report differently, so it is a plain object lookup rather than a hook. A band absent from the table (a rare regional allocation this modem's SKUs do not ship) renders without the frequency line rather than guessing.

#### The tile body is neutral; the disc carries the colour

**Short version: the tile used to paint a saturated identity fill across its whole body, and nearly every awkward thing about the old tile was a workaround for that fill.** The 2026-08-22 pass deleted the tint, and the workarounds dissolved with it.

The retired composition gave the lead carrier `bg-primary` / `bg-lte` and every other carrier the matching `*-container`, through a `carrierTileTone(technology, isLead)` helper. Three consequences, all structural rather than cosmetic:

1. **The identity chip could not be a real `Tag`.** An outline does not read on a strong fill, so the pill was a hand-rolled alpha over the tile's own ink (`carrierPillTone`) — a third chip form, outside the Two-Form Rule entirely.
2. **The meter collided with the ground it was drawn on.** A lead tile painted `bg-lte`; the fill painted `bg-lte` too. `carrierMeterTone` therefore grew a load-bearing `isLead` parameter and two alpha tracks purely to stop that collision.
3. **The five-stop signal ramp was structurally excluded.** The retired comment said so outright: a quality-toned bar on an identity-toned fill is "two container fills stacked". So the one measurement in the tile — how good this carrier actually is — was the one thing colour could not report.

A neutral body dissolves all three at once. The tag becomes a real `Tag`, the meter becomes a real `MetricBar`, and the ramp lands on the numeral and the bar where DESIGN.md > The signal quality ramp puts it. This is the Data-Ink Rule at tile scale: **colour belongs to the reading, not to the container holding it.** `components/cellular/radio/summary-tiles.tsx` had already been through five generations of the same argument and retired the body tint outright ("GEN 5 REMOVES THE BODY TINT ENTIRELY"); this surface was still shipping Gen 1.

What the change deleted, concretely: three tone functions (`carrierTileTone`, `carrierPillTone`, `carrierMeterTone`), eight alpha washes, five `opacity-*` ink washes, the hand-rolled `METER_TRACK` / `METER_FILL` pair, and a dependency on `rsrpToPercent` from `lib/carrier-aggregation.ts` — a **rival RSRP scale** carrying its own floor/ceiling constants beside the `RSRP_THRESHOLDS` every other `/cellular/` surface reads.

| What it is now | Token / helper | Why |
| -------------- | -------------- | --- |
| Tile body | `bg-surface` (`HERO_ONAIR_TILE.ROOT`) | One step recessed from the panel's `surface-container`, so a live carrier still separates from its panel now that hue no longer does it. Same ground as `HERO_ONAIR_ABSENT` — both are cells in one grid |
| Identity disc, 40px | `carrierDiscTone` → `bg-primary` (NR) / `bg-lte` (LTE) | The **strong** fill, per the Glyph-Disc Rule: in light mode the identity *containers* collapse under deuteranopia and protanopia simulation and the fills do not |
| Disc glyph | `CARRIER_DISC_GLYPH` → `cell_tower` (NR) / `signal_cellular_alt` (LTE) | Two distinct marks, because the disc is a single-slot indicator. Keyed onto `MaterialSymbolName`, so a glyph outside the font subset fails the build |
| Radio-family tag | `<Tag variant="nr" \| "lte">` | Identity, never health. A filled `Badge` here would be byte-identical to `variant="info"` |
| `PCC` / `SCC` tag | `<Tag variant="neutral">` | A standard 3GPP identifier, printed raw and untranslated. Metadata with no honest hue |
| RSRP numeral | `qualityInkClass(quality)` | Ramp ink — legal only beside a bar carrying the same reading |
| Meter | `MetricBar` + `qualityMeterTone(quality)` | The ramp's required second, non-chromatic channel |

##### The ramp's null is decided upstream of `signalToProgress`

`qualityMeterTone` returns `null` for quality `none`, and that single null drives all three channels: no meter fill, no ramp ink on the numeral, and the em-dash instead of a reading.

> ⚠️ WARNING: the null must be decided **before** `signalToProgress` is called, and the code does exactly that (`rsrpTone === null ? null : signalToProgress(...)`). `signalToProgress` returns `0` — not `null` — for a missing reading, so feeding it straight to `MetricBar` would make `hasReading` true, render a fill, and the ramp-floor branch would give it a visible stub: **a red dot beside a red numeral, inventing a signal problem for a carrier the modem reported nothing about.** `components/ui/metric-bar.tsx` documents that exact bug on its own `value` prop. A missing reading is an empty track (`MetricBar value={null}`), never a zero-length fill.

`MetricBar` is higher-is-worse by default, so `warnAt` and `dangerAt` are pinned at an unreachable `101` and the tone comes from `colorOverride`. Omitting them, or leaving them at a real threshold, would paint a **strong** signal `destructive`. The track is `surface-container-high` rather than the default `muted`, because the tile is now `bg-surface` and `muted` would nearly vanish against it.

The bar is `aria-hidden`: it is the ramp ink's required visual second channel, and its reading is already announced in words by the `sr-only` `radio_info.bands.quality.{quality}` label beside the numeral. Those six keys already match the `SignalQuality` union exactly, so a `band_locking.*` copy would only be a seventh thing to translate and a seventh thing to drift.

`HERO_ONAIR_TILE.METER` keeps `mt-auto`. Grid items stretch to the tallest cell in their row and that height is uneven for real reasons — a carrier reporting no PCI has one fewer detail segment, and a wrapped metric row is taller than an unwrapped one — so without it the meters comb across a row instead of reading as one comparable scale.

##### PCC primacy is now ORDER, not colour

The lead carrier used to be findable by its strong fill. With the body neutral, `sortCarriers()` is the only channel left carrying it — PCC first, then LTE before NR — reinforced by the explicit `PCC` / `SCC` tag on the tile itself.

**A tonal step was deliberately NOT substituted for the fill.** Distinguishing two states by tone alone is ruled out on this surface — it is the same reasoning that puts a distinct glyph on every status chip — and position plus an explicit word survive greyscale, sunlight and every colour-vision deficiency, none of which the fill did.

> ⚠️ WARNING: do not "tidy" `sortCarriers()` back to the order the modem reported. That order is not meaningful, and it is now the only positional channel saying which carrier anchors the camp.

#### The tile's height is a binding floor, not a pin

`ONAIR_TILE_MIN_H` is `min-h-[13.5rem]` (216px), shared by `HERO_ONAIR_TILE.ROOT` and `SKELETON_SHAPE.ONAIR_TILE` so the loaded tile and its placeholder cannot drift (Skeleton-Mirror Rule).

The measured anatomy comes to ~204px, and the real range is **~184–210px** across the container states this grid renders — the metric row wraps at some widths and not others, and a solo carrier's third tag wraps the head row. No single `h-` is right for all of them. Setting the floor **above** the natural ceiling buys a pin's exact-mirror guarantee without a pin's failure mode: at 216px it binds in every state, so every tile and every skeleton is exactly 216px — but nothing here truncates or clips, so a hard `h-` would spill a wrapped metric row outside the rounded box instead of the box growing to hold it.

The value it replaced was `h-[6.5rem]` (104px), asserted by the skeleton alone about a tile that carried no height at all — a ~100px handoff jump, in the direction that got worse the more the modem had to report. `HERO_ROW_MIN_H` (`min-h-[3.25rem]`, 52px) is the same construction for the failover row, whose tallest child is the 22px help trigger (~46px at `py-3`, so the floor binds) and which also wraps on a narrow container.

> ⚠️ WARNING: `ONAIR_TILE_MIN_H` and `HERO_ROW_MIN_H` are written as **verbatim literals**, not assembled from parts. Tailwind's scanner reads source *text*; an arbitrary value composed at runtime never reaches the stylesheet at all.

#### The absent-leg cell fills a spare column, it no longer reshapes the grid

The original `auto-fit` grid hit a specific failure at exactly one carrier: `auto-fit` hands a single item the whole row, so one carrier stretched a 160px tile to the full panel width and read as a broken layout. The fix at the time (Turn 3 of the exploration) was a dedicated solo layout, `HERO_ONAIR_GRID_SOLO` — `2fr 1fr` above `@sm/onair`, one column below it.

**That layout no longer exists.** Once the grid became a fixed 3-column `HERO_ONAIR_GRID` (below), a lone tile simply occupies one of the three columns like any other item — nothing stretches, so nothing needs a second layout to prevent it. `AbsentLegCell` still renders at `onAir.length === 1`, filling the grid's second cell rather than leaving it bare, and still names the radio leg that is **not** on air: NR when the lone carrier is LTE, LTE when it is NR. It links to `/cellular/cell-scanner`, the one action that would find the missing cell.

**It renders only in the solo case, and that is a decision rather than an oversight.** It exists so the row reads at all; that it is also informative is a bonus. With four LTE carriers aggregated the grid already fills its row honestly, and adding a fifth "no 5G" cell there would be an editorial claim that the absence is a fault — on a modem whose SKU may not even have an NR list, it often is not.

> ℹ️ NOTE: the cell reuses **`radio_info.bands.scanner.link`** ("Open cell scanner") rather than adding a `band_locking.*` key, and `signal_cellular_off` rather than the mock's `signal_cellular_nodata`. The first is the same borrow-don't-duplicate convention as `units.mhz` / `detail.pci` above. The second is because the allowlist in `components/ui/material-symbol-names.ts` has no `signal_cellular_nodata`, and adding one costs a font re-subset that `icons:subset` can only perform online. Sharing the glyph with the on-air **empty** state is safe rather than sloppy: the empty state replaces the entire grid, this cell only exists when the grid has exactly one tile, so the two can never share a frame.

> ℹ️ NOTE: `radio_info.bands.units.mhz` and `radio_info.bands.detail.pci` are **deliberately borrowed from another feature's namespace** rather than duplicated under `band_locking.*`. "MHz" and "PCI" are the identical word in every locale QManager ships, so a second key would only create a second thing to translate and a second thing to drift.

**Identity tone is now scoped to the disc, and quality has its own channels.** `carrierDiscTone(technology)` gives LTE the violet `lte` fill and NR the blue `primary` fill — identity only, and there is deliberately no lead/secondary axis in the signature any more, because primacy moved to order. Quality is reported by the numeral's ramp ink and the `MetricBar` beside it, which is exactly the separation the old body tint made impossible. `components/dashboard/carrier-aggregation.tsx` still carries its own `tileTone()` / `meterFillTone()` convention for its own tiles; see [carrier-aggregation.md](carrier-aggregation.md).

**It does NOT go through `enrichCarriers()`.** `lib/radio-info.ts`'s pipeline — the dashboard's own — needs a release-reconciliation history, the current network type and the serving NR ARFCN/SCS, none of which this hero receives or needs. A tile here disappears the instant the modem stops reporting the carrier; it has no reason to remember one existed a moment ago. What it *does* now share with the rest of `/cellular/` is the **one** quality map DESIGN.md names — `getSignalQuality` / `signalToProgress` against `RSRP_THRESHOLDS`, rendered through `components/cellular/signal-quality-display.ts` — so this tile, `tower-locking` and both antenna surfaces cannot disagree about what "fair" is. It previously reused `rsrpToPercent` from `lib/carrier-aggregation.ts`, a second scale with its own floor and ceiling; that import is gone.

**Ordering** is `sortCarriers()`, a local helper: PCC first, then LTE before NR. `Array.prototype.sort` is stable, so carriers of equal rank keep the order the radio reported them in. LTE leads because the LTE leg is the anchor in NSA — it is what a reader looks for when a 5G connection misbehaves. Since the body tint was removed, this ordering is also the surface's **only positional channel for PCC primacy** — see [PCC primacy is now ORDER, not colour](#pcc-primacy-is-now-order-not-colour).

**Grid geometry.** `HERO_ONAIR_GRID` is a fixed 3-column ceiling (`grid-cols-1 @sm/onair:grid-cols-2 @lg/onair:grid-cols-3`, against the panel's own `@container/onair`), not `auto-fit`. This is a reversal of the previous `repeat(auto-fit, minmax(160px, 1fr))`: that geometry suited the compact single-line tile, but the full-detail tile (above) needs real width to lay out five lines legibly, and `auto-fit` was combing up to five *thin* tiles across the panel rather than giving three tiles room to read. A carrier count under 3 leaves the remaining grid cells empty — accepted whitespace, not a bug, and no different in spirit from the empty space `HERO_ONAIR_GRID_SOLO` used to reserve on purpose for exactly one carrier.

#### The panel's header and footer

The header row carries a live-pulse dot, the `on_air` eyebrow, and a right-aligned count summary.

> ⚠️ WARNING: the dot uses **`.animate-live-ping`**, the project's own keyframe in `app/globals.css` (running on `--duration-ambient` / `--ease-ambient`), **not** Tailwind's built-in `animate-ping`. They look similar and time differently; a `animate-ping` here is an off-scale duration under The One-Scale Rule. It is `motion-reduce:animate-none`-guarded, and `globals.css` disables it under reduced motion as well.

The summary reads `{{count}} carriers · {{mhz}} MHz` via **real i18next pluralization** — `on_air_summary_one` / `on_air_summary_other`, replacing the previous singular-only key. `mhz` is the sum of every reported `bandwidth_mhz` (negative/zero values contribute nothing).

The footer caption (`on_air_note`) exists to pre-empt the single most likely misreading of this panel: *"Reported by the radio, not by your lock list. A locked band only appears here once the modem camps on it."* Without it, a user who just locked B3 and does not see a B3 tile concludes the lock failed. It carries `mt-auto` so it pins to the panel's own bottom edge regardless of how many tiles are above it — a 2-3 carrier camp inside a 3-column grid leaves whitespace, and that whitespace belongs between the grid and the footer, not between the footer and the panel's edge (which would leave the note floating mid-panel instead of reading as a footer).

The empty state (`on_air_empty_title` / `on_air_empty_body`) is a real state — the modem genuinely is not camped on anything — and it says so while making clear the locks below still apply once it attaches. It renders through the shared `ConditionScreen` primitive (`components/cellular/condition-screen.tsx`); see [Both empty states use the shared `ConditionScreen`](#both-empty-states-use-the-shared-conditionscreen) for the two overrides it needs.

### The lock-posture rail

The right panel names each category with its real ratio and links to the card that changes it.

**The headline used to be a single number summed across all three categories, and that number could not be acted on.** It read `lockedTotal` / `supportedTotal` — LTE, NSA-NR5G and SA-NR5G band counts added together — producing a sentence like "Locked to 12 of 34 bands". Three unrelated band lists do not add up to anything a reader can use: "LTE fully locked, both NR categories open" and "NR narrowed a little, LTE untouched" are very different radio states that sum to the identical headline, and neither tells you *which* category to go fix. The round after that replaced it with a badges-only summary row (`HERO_POSTURE_ROW`), which named the categories but still did not go anywhere.

The rail's head is `HERO_RAIL_DISC` — **44px, one step below the 52px `HERO_DISC`** used everywhere else in the product, because the rail is a nested panel and not the hero's own top-level anchor — beside `HERO_RAIL_TITLE` (the existing `band_locking.live.eyebrow` key, "Lock posture", restyled but not renamed) and a **dynamic** subtitle:

| Condition | Key | English |
| --------- | --- | ------- |
| No category has a reported supported list | `rail_subtitle_unknown` | "Not reported yet" |
| No category is restricted | `rail_subtitle_none` | "No band restrictions in place" |
| All three are restricted | `rail_subtitle_all` | "All three radios are restricted" |
| Some are | `rail_subtitle_partial` | "{{count}} of {{total}} radios restricted" |

#### The disc is a real state indicator now — `overallPosture`

**The disc used to draw one hard-coded `settings_input_antenna` for every state**, while `POSTURE_GLYPH` sat in `shapes.ts` as an unreferenced export. A single-slot indicator that cannot indicate is worse than no indicator: locked, unrestricted and never-reported all wore the same mark on the same `bg-primary` fill, so the disc said "brand", not "state".

Wiring it needed a value this page did not have. `categoryPosture()` is **per-category**, and the subtitle above has **four** branches where `POSTURE_GLYPH` has **three** keys — there was literally nothing for the disc to index. `live-band-hero.tsx` now derives an aggregate:

| Condition | `overallPosture` | Glyph |
| --------- | ---------------- | ----- |
| `reportedCount === 0` (no category has a supported list) | `unknown` | `help` |
| `restrictedCount === 0` | `unrestricted` | `lock_open` |
| otherwise (all *or* some restricted) | `locked` | `lock` |

The collapse from four subtitle branches to three glyph states happens on one rule: **any restriction at all is a locked posture.** The disc answers "is this modem restricted?", and partial is still yes — so `all` and `partial` share `locked` while the subtitle keeps telling them apart in words.

`POSTURE_GLYPH`'s three values changed in the same pass, and the reason is that the **Every-Chip-Has-A-Glyph Rule is hero-scoped, not component-scoped**:

- `unrestricted` was `cell_tower` — the same mark `CARRIER_DISC_GLYPH` gives the NR carrier, on the same `bg-primary` fill, one flex row away inside the same hero. A reader would have seen one glyph meaning "no band restrictions" and an identical glyph meaning "this is the 5G leg". It is `lock_open` now.
- `locked` was `settings_input_antenna`, which named the hardware rather than the state. It is `lock` now.
- `unknown` was `schedule`; a clock reads as *pending* or *scheduled*, and this state is neither. It is `help` now, and **`CATEGORY_BADGE.unknown` moved from `schedule` to `help` in the same change** so the disc and the rows it summarises cannot speak different vocabularies.

Reusing `CATEGORY_BADGE`'s `lock` / `lock_open` marks is correct rather than a collision: the disc *summarises* the three rows directly beneath it, so saying the same thing in the same mark is the point. A disc that summarised those rows in a private vocabulary would be the actual defect. All three glyphs were already in the subset allowlist, so no font re-subset was needed (`icons:subset` fetches from Google and cannot run offline).

> ℹ️ NOTE: `unknown` here means the modem has **never reported** a supported-band list, not that one is still loading. `categoryPosture` returns it only for an empty supported list, and a loading rail draws `SKELETON_SHAPE.HERO_DISC` without ever reaching this map.

Below it sit **three clickable rows**, one per `BAND_CATEGORIES` entry (`HERO_RAIL_ROW`): the category short name, a `rail_ratio` caption (`{{count}} of {{total}} bands allowed`), a `CATEGORY_BADGE` status chip, and a `chevron_right`.

**The chevron is a real affordance.** Clicking a row calls `scrollToCategory(category)`, which is a plain `document.getElementById('band-locking-card-${category}')?.scrollIntoView({ behavior: "smooth", block: "start" })`. A rail that summarised the three cards without linking to them would be restating information the cards already carry, one layer removed — the exact failing of the badges-only round it replaced.

> ⚠️ WARNING: the scroll target is looked up by **string-built DOM id**, so nothing mechanical links `scrollToCategory()` in `live-band-hero.tsx` to the `id={`band-locking-card-${category}`}` in `band-locking.tsx`. Rename either template and the rows silently stop scrolling — no type error, no lint error, no failed build. The optional-chain (`?.`) means a missed match is a no-op rather than a crash, which is the right runtime behaviour and also the reason the breakage would be quiet.

The row's badge uses **new, shorter labels** — `rail_status_locked` / `_unrestricted` / `_unknown` ("Locked" / "Unrestricted" / "Not reported"), resolved through `railStatusKey(posture)`. They are deliberately distinct from the category card's own longer badge text (`{{count}} of {{total}} locked`), because the row already prints the ratio on its own line and repeating it inside the badge would be the same number twice in one row. The full sentence goes to assistive technology as the button's `aria-label`: short name — ratio — status.

> ℹ️ NOTE: the previous round's aria-only keys `band_locking.live.category_locked` / `category_unrestricted` / `category_unknown` and the singular `on_air_empty` are **removed**. Nothing reads them.

Posture is **derived, never asserted**, by one shared helper — `categoryPosture(locked, supported)` in `shapes.ts`:

| Condition | Posture | Badge (`CATEGORY_BADGE`) | Rail label |
| --------- | ------- | ------------------------ | ---------- |
| `supported.length === 0` | `unknown` | `muted` / `help` | "Not reported" |
| `locked` covers the whole supported list | `unrestricted` | `success` / `lock_open` | "Unrestricted" |
| otherwise (incl. an empty `locked` list) | `locked` | `warning` / `lock` | "Locked" |

`unknown` is a real state, not a loading state. A modem that has not reported a supported-band list yet must not be described as unrestricted, because "all supported bands available" would be a claim about a list nobody has seen.

**`categoryPosture` is shared with `BandGridCard` on purpose.** The card's own header chip reads the same helper (`isUnrestricted` is a call, not a local re-derivation), so the rail row and the card's status chip can never quietly disagree about what "unrestricted" means. Before, they were two independent comparisons that happened to agree.

> ℹ️ NOTE: `BAND_CATEGORIES` is exported from `types/band-locking.ts` and imported by both `band-locking.tsx` and `live-band-hero.tsx`. It was previously a local const inside the coordinator; two iterations over three categories must not be able to disagree about order.

### Why failover spans the hero

Band failover is not a fourth setting alongside the three categories — it is the safety net under all of them. `lock.sh` arms **one** watcher for the most recent lock regardless of which category it belonged to, so failover is a property of the **modem**, not of a card. Rendering it as a peer of the category cards said otherwise.

It is a **hero-level row** (`HERO_ROW`): a direct child of `BAND_HERO`, spanning the full width below both panels.

> ℹ️ NOTE: **this reverses a placement this doc previously argued for by name.** The earlier round docked the row to the *foot of the rail*, pinned with `mt-auto` and sized like the rail's own category rows, on the reading that failover "is the safety net for the three locks directly above it, so it belongs with them rather than spanning the whole hero". That argument is retired, not qualified — two facts overrule it:
>
> 1. **One watcher, not three.** `lock.sh` arms exactly one watcher for the modem regardless of which category was written. A control docked to a three-row category list reads as *the fourth row of that list* — which is precisely the "failover is a fourth setting" misreading the move into the hero was meant to fix.
> 2. **The rail stacks last.** On a narrow container the hero drops to one column and the rail falls below the on-air panel, burying the single control that decides whether a mistaken lock is **recoverable** underneath everything it protects.

Two consequences of the move are worth knowing before touching it:

- **`bg-surface-container`, not `bg-surface`.** Inside a `surface-container` panel the row recessed *down* to `surface`. At hero level its ground is `BAND_HERO`'s own `bg-surface`, so the same token would make it invisible. It steps **up** now — the same one-step separation, read in the other direction.
- **It took the rail's only floor pin with it**, which is why `HERO_SPLIT` now aligns to `items-start`. See [`HERO_SPLIT` aligns to `items-start`](#hero_split-aligns-to-items-start-not-items-stretch).

#### The help copy stays in its tooltip

An instruction to promote `failover_help` from its tooltip into a visible description line under the label was **tried and reverted during the build**, and the reversal is deliberate: commit `69df6ac` ("drop over-explanatory info copy from lock/scanner surfaces") had already deleted standing explanatory copy from this exact panel. The string is written in on-demand-help register — it explains a hypothetical ("When enabled, the modem returns to its default bands…") in 22 words, restating the premise of the four-state chip sitting beside the switch. The extra width the hero-level row gained is not a reason to spend it on prose.

Its chip is a genuine four-state indicator (`FAILOVER_BADGE`), derived by `failoverKey()` in a **significant order**:

| Order | Condition | Key | Variant / glyph |
| ----- | --------- | --- | --------------- |
| 1 | `!failover.enabled` | `disabled` | `muted` / `do_not_disturb_on` |
| 2 | `failover.activated` | `fallback` | `warning` / `warning` |
| 3 | `failover.watcher_running` | `monitoring` | `info` / `progress_activity` (spins) |
| 4 | — | `ready` | `success` / `check_circle` |

`activated` outranks `watcher_running` because a watcher that has already fired is reporting a fallback, not progress, even while it keeps running. Every state carries a **distinct** glyph, which here is mandatory rather than tidy: `success-container` and `warning-container` measure ~1.03:1 apart and are the same surface under deuteranopia, so the glyph is the only channel separating "the safety net is armed" from "the safety net has fired and your lock is not in force". `disabled` is `muted`, never `destructive` — it is deliberately off, not broken.

The hook drives this chip live. After a successful lock that returns `failover_armed: true`, `useBandLocking` polls `failover_status.sh` every 1s (it reads flag files only — no modem contact) until the watcher exits, then re-fetches `current.sh` if the watcher activated, because the watcher will have rewritten all three band lists back to the supported set.

## Refreshing the page

**Short version: `useBandLocking` had always exported a `refresh()`, and the coordinator never destructured it — so the function was unreachable, and a scheduled scenario that rewrote bands on-device left this page reporting the previous configuration until someone reloaded the browser.** It is now a Refresh pill in the page header, and three things had to be made true before pressing it was safe.

The staleness is real rather than theoretical. This page's band configuration comes from `current.sh`, which the hook fetches **on mount and after a successful lock, and nothing else** — there is no poller behind it. A scheduled Connection Scenario issues the identical `AT+QNWPREFCFG` writes (see [The gate chain](#the-gate-chain)), so the modem can change underneath a page whose header chip claims to report what the modem is actually set to. That makes the pill a State-Honesty fix, not a convenience.

> ℹ️ NOTE: this is why Band Locking has a Refresh and `/cellular/` (Radio Information) deliberately does not. That page reads `useModemStatus`, which polls; a manual refresh there duplicates something already happening. This page has no such property, so the same cut does not apply.

### 1. `isLoading` was split into `isLoading` + `isRefreshing`

The two flags make different claims and must not be fused:

| Flag | Claim | May drive skeletons? |
| ---- | ----- | -------------------- |
| `isLoading` | **There is nothing to show yet.** First load only | Yes |
| `isRefreshing` | The data on screen is real but possibly stale, and we are re-reading it | **No** — the loaded layout stays up |

`refresh()` used to call `setIsLoading(true)`. Because the coordinator ORs the hook's `isLoading` into a page-level `isPageLoading` (`statusLoading || bandsLoading || scenariosLoading`) that the hero and all three cards read, **pressing Refresh collapsed the entire page to skeletons** — blanking the very surface the user asked to re-read.

The quieter half of that bug is the worse one: `isPageLoading` also gates the two override banners (`!isPageLoading && …`), so a refresh on a gated page **hid the only explanation for why the controls were disabled**. A refresh that blanks its own surface teaches the user not to press it, which defeats the staleness problem it exists to solve.

`isRefreshing` responds to `refresh()` only. The 1s `failover_status.sh` poller calls `fetchCurrent` directly and can neither set nor clear it, so a watcher cycle can never make the header spin.

`refresh()` also now returns `Promise<boolean>`, because a failed refresh has to be reportable. `fetchCurrent` returns whether the **read** succeeded — an unmount mid-flight still returns the true result and simply skips the state writes, since "the page went away" is not a failed read. The page reports failure by **toast** (`band_locking.toast.refresh_error`) rather than through the hook's shared `error`: that string is scoped to one category by `lastAttempted` (see [Error scoping](#error-scoping)), and a refresh belongs to no category, so routing it there would land the message under whichever card last wrote, or nowhere at all. There is no success toast — a refresh that worked is evident from the page updating.

### 2. The button is disabled while the failover watcher runs

**This is the important guard, and `isBusy` is not sufficient for it.** `lockingCategory` clears the instant the `lock.sh` POST resolves — which is precisely when `qmanager_band_failover` *starts*. It then spends ~30 seconds running `AT+QCAINFO` up to five times, and its carrier check is:

```sh
if [ $qcainfo_rc -eq 0 ] && printf '%s\n' "$qcainfo_result" | grep -q '^+QCAINFO:'; then
```

Any non-zero `qcmd` exit counts as **"no carrier"** — including one that simply lost the AT-mutex race. `current.sh` takes that same mutex. So UI-initiated AT traffic fired into the watcher's window can contribute to the watcher **reverting the user's own lock**.

> ℹ️ NOTE: to be honest about the size of the risk — the watcher exits on the **first** success, so one lost race cannot cause a revert on its own; it burns one of five checks. The guard exists for the repeated-press case, and because this is the one control on this page whose failure costs the user their connection rather than their patience.

The disable reads `failover.watcher_running`, a field that had existed on `FailoverState` with **no consumer at all** until this change. The button also carries the reason in `title` and `aria-description` (`band_locking.a11y.refresh_blocked_watcher`), so a disabled control always says why. `bandsLoading` appears in the disable expression too — during first load there is nothing to revalidate, and a press would queue a second `current.sh` behind the mount fetch on the same mutex — but it deliberately does **not** reach the spinner or the live region, so it cannot re-create the blanking bug.

### 3. A foreign-watcher adoption effect

The 1s poll is armed only by `lock.sh` returning `failover_armed` — i.e. by a lock **this tab** performed. But `current.sh` legitimately reports `watcher_running: true` on a plain page load: another tab, another operator, or a reload inside the ~30s window.

Without adoption, nothing would be polling, so the flag would stay true until the component remounted — and now that the UI *disables* controls on it, **a guard that can latch on forever is worse than no guard**, because the surface looks permanently broken rather than briefly busy. A small effect in `useBandLocking` starts the poll whenever `failover.watcher_running` is true and no poll is already running.

It cannot loop: `startFailoverPolling` stops itself the moment the watcher is gone and writes `watcher_running: false`, which makes the condition false; the ref guard keeps it from restarting a poll already in flight. And adopting costs **no AT traffic** — `failover_status.sh` reads filesystem flags only and makes zero modem contact, which is exactly what makes it safe to run during the window it is watching.

## Both empty states use the shared `ConditionScreen`

Both hand-rolled empty blocks on this surface — the hero's "no carriers on air" and the category card's "this SKU reports no bands" — now render through `components/cellular/condition-screen.tsx`. This was the last surface on the route still drawing its own disc/headline/body stack, so its geometry and tone were free to drift from the four `/cellular/` screens saying the same kind of thing.

Both pass `tone="neutral"` and `ariaRole="status"`, and neither passes `spin`:

- **`neutral`, not `warning`.** A SKU that reports no bands in a category is a fact about the hardware; a modem not currently camped on anything is a fact about the radio. Neither is a fault the user can act on, and `condition-screen.tsx`'s own tone table reserves neutral for exactly this ("we do not know, and pretending otherwise would be the actual bug").
- **No `spin`.** These are standing conditions, and a spinner would advertise work that is not happening.

> ⚠️ WARNING: the hero's instance needs `className="rounded-tile bg-surface py-10"` and both overrides are load-bearing. The primitive's `neutral` tone is `bg-surface-container`, which is **byte-identical to the on-air panel's own ground** — so without the override the block has no visible edge at all. `rounded-tile` steps it down from the primitive's own `rounded-hero` (40px), which would otherwise out-round the `rounded-card` panel hosting it. `bg-surface` also matches `HERO_ONAIR_ABSENT`, so every "not a carrier" cell in that panel sits on one surface.

## Geometry and tone

Everything shape- or tone-bearing on this surface lives in `components/cellular/band-locking/shapes.ts`, modelled on the custom-profiles contract and for the same reason: the incumbent declared its card shell in **three places inside one file** — the loading, empty and loaded branches of `band-cards.tsx` — so a radius fixed in one branch stayed wrong in the other two.

| Constant | Purpose |
| -------- | ------- |
| `BAND_HERO` | The one hero card, `rounded-hero` (40px). Also declares `@container/hero`, which `HERO_SPLIT` queries. A second hero on this page spends the Consistent-Layout Rule's glance-surface exception twice |
| `BAND_CARD` | One category card, `rounded-card` (36px). Imported by all three branches |
| `CARD_PAD`, `HERO_EYEBROW` | Card padding (24px peer / 28px hero) and the eyebrow type step |
| `HERO_SPLIT` | The hero's two-panel layout: `flex-col`, becoming `flex-row items-start` at `@2xl/hero`. Both alignment utilities are breakpoint-scoped on purpose — see `items-start`, not `items-stretch` |
| `HERO_ONAIR_PANEL`, `HERO_ONAIR_GRID`, `HERO_ONAIR_TILE`, `ONAIR_TILE_MIN_H`, `HERO_ONAIR_ABSENT` | The left panel. Panel is `rounded-card` on `surface-container` and declares its own `@container/onair`; the grid is a fixed 3-column ceiling (`grid-cols-1 @sm/onair:grid-cols-2 @lg/onair:grid-cols-3`); the tile is `rounded-tile` on a **neutral `bg-surface`**, `px-5 py-4`, at a binding `ONAIR_TILE_MIN_H` floor, with `HEAD` / `DISC` / `TAGS` / `BANDWIDTH` / `BAND` / `FREQ` / `DETAIL` / `METRICS` / `RSRP` / `RSRP_UNIT` / `SECONDARY` / `METER` (`mt-auto`) slots; `HERO_ONAIR_ABSENT` is the lone-carrier absent-leg cell |
| `HERO_RAIL_PANEL`, `HERO_RAIL_DISC`, `HERO_RAIL_TITLE`, `HERO_RAIL_SUBTITLE`, `HERO_RAIL_ROW`, `HERO_RAIL_ROW_LABEL`, `HERO_RAIL_ROW_RATIO` | The right panel. Fixed `25rem` above `@2xl/hero`, full width below it. `HERO_RAIL_DISC` is 44px — one step below the product-wide 52px `HERO_DISC`, because the rail is a nested panel |
| `HERO_ROW`, `HERO_ROW_MIN_H`, `HERO_ROW_LABEL` | The failover row, at **hero level** spanning both panels — no longer the rail's last child, and no longer `mt-auto`. `bg-surface-container` (it steps *up* from the hero's `bg-surface`); `rounded-field` (20px) because this row genuinely wraps, and a pill that has wrapped to two lines is a stadium; `HERO_ROW_MIN_H` is the 52px floor it shares with its skeleton |
| `carrierDiscTone` | `(technology) => string`. The 40px identity disc's **strong** fill — LTE violet, NR blue. Identity only; there is deliberately no `isLead` axis any more, because PCC primacy moved to `sortCarriers()` order |
| `CARRIER_DISC_GLYPH` | `Record<"LTE" \| "NR", MaterialSymbolName>` — `signal_cellular_alt` / `cell_tower`. Two distinct marks for a single-slot indicator |
| `BAND_CHIP`, `BAND_CHIP_LIVE_RING`, `bandChipClass`, `bandChipA11yKey`, `BAND_LEGEND` | The chip contract (above). `bandChipFill` is now **module-local** — its only consumer is `bandChipClass`, and a caller composing the fill by hand could pair it with the wrong `ROOT` or drop the live ring, which is the two-axis chip's one failure mode. `BAND_LEGEND`'s rationale comment carries the "Currently locked" naming rule |
| `NOTICE`, `NOTICE_TONE` | The card-scoped error slot |
| `PILL_ACTION`, `PILL_ACTION_PLAIN`, `PILL_QUIET` | Action sizing. `PILL_QUIET` is deliberately smaller: Select all / Clear change a selection, they do not write to the modem, and three equal-weight pills in one footer loses which is consequential. It carries **size only** — no fill, no ink |
| `FAILOVER_BADGE`, `CATEGORY_BADGE`, `BADGE_GLYPH_SIZE` | Tone + glyph maps, keyed onto the exported `BadgeVariant` type so an unmapped state fails the build |
| `POSTURE_GLYPH` | **Live now** (`lock` / `lock_open` / `help`), indexed by the aggregate `overallPosture` derived in `live-band-hero.tsx`. It was an unreferenced export while the disc hard-coded one glyph — see The disc is a real state indicator now |
| `categoryPosture` | `(locked, supported) => BandPosture`. The single derivation shared by the rail's rows, the rail subtitle and the card's header chip |
| `railStatusKey` | `(posture) => "band_locking.live.rail_status_{posture}"`. The rail row's short badge label, distinct from the card's longer one |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by import, not by estimate. `HERO_DISC` (44px), `RAIL_ROW`, `HERO_ROW` and `ONAIR_TILE` are the hero's four mirrors — the last two now **interpolate** `HERO_ROW_MIN_H` / `ONAIR_TILE_MIN_H` rather than restating a number. `HERO_EYEBROW` is deleted (nothing read it) |
| `categoryTitleKey`, `categoryDescriptionKey`, `categoryShortKey` | Category → i18n key (above) |

`CATEGORY_BADGE` reads the functional contract, not a value judgement about locking: `unrestricted` is `success`, `locked` is `warning` (a narrowed band list is the state that can cost you the connection — `warning` means *constrained*, not *you did something wrong*), and `scenario` is `info` (something else owns the setting; a standing condition, not a fault). It carries a **fourth** entry, `unknown` (`muted` / `help`), because the hero rail's rows have to render a category the modem has not reported a supported-band list for — the card never reaches that state (it renders its Empty branch instead). That glyph moved from `schedule` to `help` alongside `POSTURE_GLYPH.unknown`: a clock reads as *pending*, and this state is "never reported".

### Select all / Clear are `tonal-neutral`, never `ghost`

`PILL_QUIET` sizes those two footer buttons but deliberately carries **no fill and no ink of its own** — the `variant="tonal-neutral"` Button supplies both. It used to be `variant="ghost"` plus a hardcoded `text-on-surface-variant` in the constant, and a ghost button has no resting fill at all: sitting beside a filled `Apply` and an outlined `Restore all supported`, it read as *disabled or absent* rather than as a third, quieter action. `tonal-neutral` gives it a real but muted presence (`surface-container`) instead of asking the reader to discover it by hovering.

Both chip hovers are `enabled:`-scoped. Tailwind's `hover:` does not exclude a disabled element on its own, so an unscoped hover would light up every chip on a gated card — advertising an interaction that is switched off.

Chip entrance motion uses `rowCascadeDelay(index)` from `lib/motion.ts` on the item variant via `custom`, **not** `staggerRows`. `staggerChildren` is unbounded, and a supported-band list routinely exceeds twenty entries: at the 80ms row step the twenty-first chip would land 1.68s after the first, which reads as the card still loading. `rowCascadeDelay` caps the index, but is a per-child delay and cannot be combined with `staggerChildren` — hence the `custom` route.

## The shared `/cellular/` page header

`components/cellular/page-header.tsx` (`CellularPageHeader`) is the header half of the Consistent-Layout Rule's page shape: a Display-step `h1`, an optional muted description, and optional right-aligned actions, laid out with a **container query** against `@container/main` so it responds to the content column rather than the viewport (and stays correct when the sidebar expands).

It exists rather than a copy-pasted `<h1>` because `text-3xl font-bold mb-2` appears in 26 component files and is missing the `tracking-[-0.02em]` the Display step actually specifies — so every one of those pages renders its title fractionally wider than the migrated surfaces. A class you have to remember to type is a class that will be typed wrong.

**Scope is deliberately three routes.** Band Locking, Tower Locking and Frequency Locking are one sub-tree a user crosses three times in a single task, so they move together; Tower and Frequency received **header-only** edits. The other unmigrated routes are not swept as a side effect — DESIGN.md's Migration Deltas table is explicit that new work follows the canon without "fixing" unconverted surfaces in passing.

It is deliberately **not** `components/cellular/radio/page-header.tsx`. That component owns Radio Information's freshness chip, its clipboard action and its own namespace lookups; it is a page, not a primitive.

Band Locking uses its optional `actions` slot for the Refresh pill (styled by the page's own `PILL_ACTION`, since `CellularPageHeader` deliberately does not style its callers' buttons). See [Refreshing the page](#refreshing-the-page).

## Props contracts

### `LiveBandHeroProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `failover` | `FailoverState` | `{ enabled, activated, watcher_running }` |
| `carrierComponents` | `CarrierComponent[]` | From `useModemStatus`; the ACTUAL view. Rendered **raw** — one tile per component, sorted but not deduplicated |
| `supportedBands` | `Record<BandCategory, number[]>` | Hardware-supported bands **per category** (`policy_band`). Replaced the summed `supportedTotal: number` |
| `lockedBands` | `Record<BandCategory, number[]>` | Configured bands **per category** (`ue_capability_band`). Replaced the summed `lockedTotal: number` |
| `onToggleFailover` | `(enabled: boolean) => Promise<boolean>` | Returns success; the hero owns its own toast |
| `isLoading` | `boolean` | Page-level (`statusLoading \|\| bandsLoading \|\| scenariosLoading`). The hook's `isRefreshing` is deliberately **not** ORed into this — that is the whole point of the split |
| `isGated` | `boolean?` | Disables the failover switch — see Known gaps |

### `BandGridCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `bandCategory` | `BandCategory` | `"lte" \| "nsa_nr5g" \| "sa_nr5g"`; also the i18n key stem |
| `supportedBands` | `number[]` | From `device.supported_*_bands` (`policy_band`), sorted |
| `currentLockedBands` | `number[]` | From `ue_capability_band`, sorted. **New array identity every parent render** |
| `onLock` | `(bands: number[]) => Promise<boolean>` | Coordinator sets `lastAttempted`, then calls `lockBands` |
| `onRestoreAll` | `() => Promise<boolean>` | Coordinator sets `lastAttempted`, then calls `unlockAll` |
| `isLocking` | `boolean` | THIS category only — drives the spinner |
| `isBusy` | `boolean` | ANY category — blocks interaction |
| `isLoading` | `boolean` | Page-level |
| `error` | `string \| null` | Already scoped by the coordinator; never the raw hook error |
| `isGated` | `boolean?` | Standing condition |

The card owns only `checkedBands` (the local selection), `prevLockedKey` (the sync guard) and its `useSaveFlash` state. Everything else is a prop.

## Card states

Three branches, all rendering `BAND_CARD` so the shell cannot drift:

- **Loading** — skeletons imported from `SKELETON_SHAPE`, including `CHIP_COUNT = 12` chip placeholders at the real 40px height and the footer actions at the real 42px pill height. The incumbent guessed `h-9 w-40` for a 42px button and `size-4` slivers for a control that no longer exists.
- **Empty** (`supportedBands.length === 0`) — a real state, not a failure: plenty of RM520N SKUs report no SA band list at all. It keeps the card shell so the grid does not reflow around it, and renders the shared `ConditionScreen` (`neutral` / `do_not_disturb_on` / `ariaRole="status"`, no `spin`) rather than a hand-rolled disc block — see [Both empty states use the shared `ConditionScreen`](#both-empty-states-use-the-shared-conditionscreen).
- **Loaded** — header chip, chip grid, conditional legend (rendered only when at least one band is live, because a key explaining a mark that appears nowhere is noise), conditional error notice, `sr-only` live region for the applying announcement, and the footer.

The footer separates two different truths: the header chip reports the **modem's** state (`{count} of {total} locked`), while the pending count beside Select all / Clear reports the **form's** (`{count} pending changes`). Merging them into one line would merge two facts.

## Known gaps

- **The failover switch is disabled while gated**, so a scenario-controlled page cannot turn the safety net **on** — arguably backwards, since a scenario-applied band lock is exactly the case where you most want the net. It is left unchanged deliberately: [sim-profiles.md](sim-profiles.md) documents that the profile-apply path arms the watcher itself, and changing the gate here without changing that path would create two owners for one flag.
- **`hasChanges` blocks re-applying an identical lock.** `SaveButton` is disabled when `pendingCount === 0`, which is right for avoiding a pointless modem write — but it also means the **failover watcher cannot be re-armed without changing the selection**. If a watcher's 30-second window has expired and the user wants to re-arm it, they must toggle a band off and back on.
- **`components/onboarding/steps/step-band-locking.tsx` is a fully independent implementation** that this redesign did not touch. It still uses checkboxes, its own preset radio group, hardcoded English copy, its own `authFetch` POSTs straight to `lock.sh`, and a `Promise.allSettled` fan-out of up to three concurrent locks (the watcher-starvation pathology described above). A user's **first** band-lock experience therefore diverges from every later one.
- **The failover help copy said 15 seconds — FIXED in this pass, and worth knowing why it was wrong.** The incumbent tooltip claimed the modem falls back "after 15 seconds", and the new i18n key inherited the figure verbatim before anyone checked it against the daemon. `qmanager_band_failover` is `SETTLE_DELAY=5` then `MAX_CHECKS=5 × CHECK_INTERVAL=5` — a **~30 second** window, which the script's own log line at `:84` states outright. All five locales now say "about 30 seconds". The lesson generalises: a number in user-facing copy is a claim about the device, and the State-Honesty Rule applies to it exactly as it does to a status chip. If `SETTLE_DELAY`, `CHECK_INTERVAL` or `MAX_CHECKS` is ever retuned, `band_locking.live.failover_help` has to move in the same change, in all five locales — nothing links them mechanically.
- **RESOLVED — the two unreferenced `shapes.ts` exports are gone.** `POSTURE_GLYPH` is wired to the rail disc (see The disc is a real state indicator now) and `SKELETON_SHAPE.HERO_EYEBROW` is deleted. `bandChipFill` was also un-exported and is now module-local.
- **The rail's scroll targets are coupled by string, not by type** — see the warning in [The lock-posture rail](#the-lock-posture-rail). A shared `bandCardDomId(category)` helper in `shapes.ts` would close this; it was not added because the two call sites are one file apart and adding a third indirection for two usages was judged worse than the warning.
- **Tower Locking's and Frequency Locking's header strings are hardcoded English.** The header-only migration passed literals to `CellularPageHeader` rather than `t()` calls; those two routes are not yet in the i18n sweep.

### Follow-ups opened by the 2026-08-22 pass

These are **recorded, not fixed**. Each was a deliberate scope call.

1. **`signalToProgress` saturates above −80 dBm.** The tile's `MetricBar` maps `[floor, excellent]` → `[0, 100]`, and `RSRP_THRESHOLDS.excellent` is `-80`, so **every good reading pins at 100%** and the bar reads more optimistic than the `rsrpToPercent` scale it replaced. Kept deliberately: `signalToProgress` is the canonical shared map that `tower-locking` and both antenna surfaces already length their bars with, and remapping it here would create a **sixth** rival quality scale — the exact thing this change existed to delete. Fix it family-wide in `types/modem-status.ts` or not at all.
2. **`tailwind-merge` cannot dedupe this repo's custom radius names.** `cn()` (`lib/utils.ts`) calls bare `twMerge` with no `extendTailwindMerge`, so `rounded-card` / `field` / `tile` / `hero` / `pill` are not recognised as members of the `border-radius` group. Both classes therefore ship and CSS source order decides the winner. Tailwind v4 emits the `rounded-*` utilities **alphabetically** — verified 2026-08-22 by grepping the real built stylesheet under `out/_next/static/chunks/`, which yields `card, field, full, hero, inline, lg, md, none, pill, sm, tile, xl, xs`. So `<Skeleton>`'s default `rounded-md` **beats `rounded-card`, `rounded-field`, `rounded-hero` and `rounded-inline`**, and **loses to `rounded-pill` and `rounded-tile`**. Any `<Skeleton className="rounded-card">` or `rounded-hero` is therefore silently rendering at `md` (6px) — a wider blast radius than a `field`/`inline`-only reading suggests, and it affects ~20 call sites across several surfaces. Conversely, this page's `rounded-tile` overrides on the tile skeleton and on `ConditionScreen` land **only because `tile` sorts after `md` and `hero`** — correct by luck, not by `twMerge`. The fix belongs in `components/ui/skeleton.tsx` (or in a shared `extendTailwindMerge` config), not on this page.
3. **`components/onboarding/steps/step-band-locking.tsx` fires up to three concurrent `lock.sh` POSTs under `Promise.allSettled`** — the watcher-starvation pathology this page's `isBusy` flag exists to make unrepresentable, still live in a different feature. See [`isBusy` blocks all three categories during any lock](#isbusy-blocks-all-three-categories-during-any-lock).
4. **`lock.sh` and `current.sh` carry the repo-wide dead `case "$result" in *ERROR*)` branch.** `qcmd` reports failure by **exit status and stderr** — `ERROR` never reaches stdout — so that branch never matches and a failed AT write can report success. This is a known repo-wide defect (~7 scripts), not specific to band locking; see `at-command-transport.md`.
5. **`docs/reference/icon-system.md:63` still names the deleted `band-cards.tsx`** as a Material-route `Checkbox` call site. The file no longer exists and the chip grid no longer uses `Checkbox` at all.
6. **`categoryPosture()` reports an empty lock list as "Locked".** With an empty `locked` array against a non-empty `supported` array, the posture rail renders **"LTE · Locked · 0 of 10 bands allowed"** — which reads as *deliberately restricted to nothing*, the opposite of the truth. Confirmed visually 2026-08-22, during verification of this pass — after the other five were recorded, which is why it is last rather than grouped with them. `unlockAll` represents "unlocked" as **all** supported bands, so an empty `locked` list is more likely a parse failure or an odd modem state than a normal one — but that is a guess, and the honest render depends on which it is. Needs a live probe of what `current.sh` / `ue_capability_band` actually return in each real state before a fix is chosen.

## Related

- [sim-profiles.md](sim-profiles.md) — the profile/scenario gate's other half, the scheduled-scenario resolution, and the band-failover watcher on the apply path
- [scheduled-timers.md](scheduled-timers.md) — the on-device timer that applies a windowed scenario, and why a schedule is authoritative over a static binding
- [radio-information.md](radio-information.md) — `active-bands-card.tsx` (which owns ARFCN rendering), and the compiler-backed `react-hooks` bail-on-first-violation behaviour
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the ACTUAL view the hero's on-air tiles read, and the dashboard's own `tileTone()` / `meterFillTone()` identity convention
- [antenna-alignment.md](antenna-alignment.md) — the two shared `/cellular/` primitives this surface now consumes: `components/cellular/condition-screen.tsx` (both empty states) and `components/cellular/signal-quality-display.ts` (the tile's ramp ink and meter tone)
- [tower-locking.md](tower-locking.md) — the sibling lock page, and the other consumer of the shared `signalToProgress` scale whose saturation is noted under Follow-ups
- [wan-profile-management.md](wan-profile-management.md) — the configured-vs-actual gap that motivated keeping the on-air panel
- [i18n.md](i18n.md) — the locale pipeline, and the two severity policies `i18n:check` and CI apply over one engine
- [icon-system.md](icon-system.md) — `/cellular/` is a Material Symbols route; every glyph used here is already in the subset allowlist
- `DESIGN.md` > Named Rules (Consistent-Layout, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror, One-Scale, Solid-Container)
