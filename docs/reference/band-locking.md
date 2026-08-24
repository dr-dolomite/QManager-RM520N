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
| i18n | `band_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**84 leaf keys per locale** as of 2026-08-24, after `tile_no_aggregation` was deleted; counted and verified identical across all five via `bun run i18n:check`) |
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

> ⚠️ WARNING: a future "apply all three categories at once" button must be built as a **multi-category `lock.sh` that arms ONE watcher**, not as a client-side fan-out. Three concurrent POSTs would have each one kill the previous watcher, leaving two of the three narrowings unmonitored — strictly worse than the serialised behaviour this flag enforces. `components/onboarding/steps/step-band-locking.tsx` used to demonstrate exactly this pathology with a `Promise.allSettled` fan-out; it was serialised on 2026-08-23 (`578ddb2`) for this reason, and its loop carries a comment saying so. Serialising costs almost nothing here, because `lock.sh` issues a single AT command with no COPS bounce or attach cycle.

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

Each tile (`HERO_ONAIR_TILE`) carries, top to bottom — **restructured 2026-08-24**, see [The identity tag row is gone](#the-identity-tag-row-is-gone) below for why:

| Line | Content | i18n |
| ---- | ------- | ---- |
| Bandwidth (`BANDWIDTH`) | The channel width, `absolute`-positioned to the tile's top-right corner — out of flow, so it does not compete with `TOP`'s own width budget | `radio_info.bands.units.mhz` |
| Disc + band/EARFCN pair (`TOP`) | A 40px identity disc (`carrierDiscTone` fill, `CARRIER_DISC_GLYPH` mark), `items-center`-aligned against a two-row text column: the designator (mono, 2xl, tabular) beside its centre frequency from `bandFrequencyMhz()` (`lib/band-frequency.ts`) when the band is in the static 3GPP lookup, then `EARFCN {{earfcn}}` and `PCI {{pci}}` as separate flex children with a real gap between them (not a joined separator glyph), each omitted individually when the modem did not report it for THIS component | `radio_info.bands.units.mhz`, `band_locking.live.tile_earfcn`, `radio_info.bands.detail.pci` |
| Reading (`METRICS_GROUP`) | RSRP (`{{value}} dBm`, or `–` when null) carrying the quality ramp's **numeral ink** (`qualityInkClass`), the `RSRP` word and an `sr-only` quality word, tightly paired (`gap-1`) with its own `MetricBar` directly beneath — see [The tile body is neutral; the disc carries the colour](#the-tile-body-is-neutral-the-disc-carries-the-colour) — then `RSRQ`/`SINR` as separate flex children beneath THAT pair at a still-tight but slightly larger `gap-1.5`, when reported | `band_locking.live.tile_rsrp` / `tile_no_value` / `tile_rsrq` / `tile_sinr`, `radio_info.bands.metric.*`, `radio_info.bands.quality.{quality}` |

**This is a reversal of a documented decision, not an oversight.** The tile used to be deliberately Turn 2's compact single-metric-line cut, on the stated reasoning that the hero is "half of a hero, not the whole page" and a fuller tile anatomy would need a second thing to keep in sync with the dashboard's own carrier card. The 2026-08 pass took Turn 3's full-detail tile anyway, because the grid it sits in changed at the same time: `HERO_ONAIR_GRID` moved from `auto-fit, minmax(160px,1fr)` to a fixed 3-column grid (below), and a thin single-line tile inside a wider fixed column sat padded and mostly empty. The width the grid now grants each tile is what makes the fuller anatomy the right call, not a change of mind about density on its own.

**No poller or CGI change was needed for this pass.** EARFCN, PCI, RSRQ and SINR were already on `CarrierComponent` and simply unused by the old compact tile — `AT+QCAINFO` already reports all four per carrier (see `parse_at.sh`'s `parse_qcainfo()`). The tile deliberately does **not** show a cell ID: `AT+QCAINFO` never reports one per component, only the serving-cell query does (`data.lte.cell_id` / `data.nr.cell_id`), and that value describes ONE cell — the PCC's. Showing it correctly would mean showing it on some tiles and not others for a reason a reader has no way to know, so the line was dropped rather than shipped half-right.

**Detail and signal segments are separate flex children, not a joined string.** The first pass joined `EARFCN 9410`, `PCI 214` etc. with `" · "`. That reads fine in isolation but ties the visual gap to a glyph that renders differently across the interface and machine fonts and does not scale with the container query the way a flex `gap` does. Both rows now map their segment array to individual `<span>`s inside a `flex flex-wrap gap-x-3 gap-y-0.5` row, so the spacing is a layout property, not a character.

**Centre frequency is a static lookup, not a poll.** `bandFrequencyMhz(technology, band)` in `lib/band-frequency.ts` maps a 3GPP band designator to its commonly-cited centre frequency (e.g. `"B28"` → 700). It is reference data fixed by spec, not something the modem could report differently, so it is a plain object lookup rather than a hook. A band absent from the table (a rare regional allocation this modem's SKUs do not ship) renders without the frequency line rather than guessing.

#### The identity tag row is gone

**2026-08-24, by request.** The tile used to carry a row of real `Tag`s above the band designator — `nr`/`lte` for the radio family, `neutral` for the raw `PCC`/`SCC` field, a third `neutral` `"No aggregation"` tag when `onAir.length === 1` (also removed by request, see below). All three are deleted; nothing replaces them visually. The justification: the identity disc one row down already carries both facts non-verbally — its fill (`carrierDiscTone`) is the radio family in colour, and its glyph (`CARRIER_DISC_GLYPH`) is a second, non-chromatic channel for the same fact — so the tag row was reporting the same two things a second time. `PCC`/`SCC` primacy still reads from `sortCarriers()`'s ordering alone (see [PCC primacy is now ORDER, not colour](#pcc-primacy-is-now-order-not-colour)); the tag was reinforcement for that ordering, not the only channel carrying it.

What the tag row is **not** redundant with is a screen reader: the tile's `role="listitem"` now carries an explicit `aria-label` (`"{{tech}} {{type}}"`, e.g. `"5G NR PCC"`) so that fact is still announced in words even though nothing on screen prints `LTE` or `PCC` any more.

**The disc is now centred against the band/EARFCN pair, not the tile's top edge.** With the tag row gone, the disc's only neighbours are the band/frequency line and the EARFCN/PCI line — `TOP` (`items-center`) centres the 40px disc against that pair as a unit, replacing the old `items-start` `HEAD` row (which existed only to stop a *wrapped* tag row dragging the disc's baseline down with it — there is no tag row left to wrap).

**The reading is now two groups, not one row plus a floating meter.** RSRP and its bar are one visual object — the bar IS the RSRP reading, drawn as a length — so `HERO_ONAIR_TILE.READING` keeps them at a tight `gap-1`. RSRQ/SINR is supporting detail and sits beneath that pair at `METRICS_GROUP`'s `gap-1.5`, still tighter than the tile's general `gap-2.5` rhythm. This replaces the old single `METRICS` row (RSRP and RSRQ/SINR side by side, wrapping past each other on a narrow container) with a fixed top-to-bottom order that reads the same at every width, and `METRICS_GROUP` — not the meter alone — now carries the `mt-auto` that pins the whole reading to the tile's floor.

**Bandwidth went back to the top-right corner it started in — but as `absolute`, not a flex sibling.** The wireframe this pass executed asked for the disc centred against the band/EARFCN pair AND the bandwidth figure back at top-right; doing both as ordinary flex children of `TOP` (disc, text column, bandwidth) squeezes the text column hard in the 3-column grid, where a tile's content is only ~184px wide. Measured live: with three flex siblings the text column fell to 77px, narrow enough that every token — band, frequency, `EARFCN`, its value, `PCI`, its value — landed on its own line. `HERO_ONAIR_TILE.BANDWIDTH` is `absolute top-4 right-5` instead, out of `TOP`'s flow entirely, so the text column keeps its full ~132px; `BAND_ROW` alone carries a `pr-11` reservation (not the whole `TEXT` column — the badge is only as tall as that one row) so a long band/frequency pair wraps under the corner rather than running into it. See `HERO_ONAIR_TILE.BANDWIDTH`'s own comment in `shapes.ts` for the measured clearances that validated `pr-11`.

**`tile_no_aggregation` is deleted from all five locale files, not just unused.** The lone-carrier "No aggregation" tag had no remaining home once the tag row it lived in was removed, and by request it is not relocated — a solo tile beside `AbsentLegCell` already implies nothing else is aggregated with it. `bun run i18n:check` confirms 2343/2343 keys across all five locales after the deletion (one fewer key each), so nothing was left dangling.

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
| Radio-family + `PCC`/`SCC` identity | `aria-label` on the tile's `role="listitem"` root, NOT a visible `Tag` since 2026-08-24 | The disc's fill and glyph already say which radio in a channel a screen reader can't read; the `aria-label` is what keeps that fact in words. See [The identity tag row is gone](#the-identity-tag-row-is-gone) |
| RSRP numeral | `qualityInkClass(quality)` | Ramp ink — legal only beside a bar carrying the same reading |
| Meter | `MetricBar` + `qualityMeterTone(quality)` | The ramp's required second, non-chromatic channel |

##### The ramp's null is decided upstream of `signalToProgress`

`qualityMeterTone` returns `null` for quality `none`, and that single null drives all three channels: no meter fill, no ramp ink on the numeral, and the em-dash instead of a reading.

> ⚠️ WARNING: the null must be decided **before** `signalToProgress` is called, and the code does exactly that (`rsrpTone === null ? null : signalToProgress(...)`). `signalToProgress` returns `0` — not `null` — for a missing reading, so feeding it straight to `MetricBar` would make `hasReading` true, render a fill, and the ramp-floor branch would give it a visible stub: **a red dot beside a red numeral, inventing a signal problem for a carrier the modem reported nothing about.** `components/ui/metric-bar.tsx` documents that exact bug on its own `value` prop. A missing reading is an empty track (`MetricBar value={null}`), never a zero-length fill.

`MetricBar` is higher-is-worse by default, so `warnAt` and `dangerAt` are pinned at an unreachable `101` and the tone comes from `colorOverride`. Omitting them, or leaving them at a real threshold, would paint a **strong** signal `destructive`. The track is `surface-container-high` rather than the default `muted`, because the tile is now `bg-surface` and `muted` would nearly vanish against it.

The bar is `aria-hidden`: it is the ramp ink's required visual second channel, and its reading is already announced in words by the `sr-only` `radio_info.bands.quality.{quality}` label beside the numeral. Those six keys already match the `SignalQuality` union exactly, so a `band_locking.*` copy would only be a seventh thing to translate and a seventh thing to drift.

`HERO_ONAIR_TILE.METRICS_GROUP` keeps `mt-auto` (moved there from the meter alone on 2026-08-24, since the reading is now a two-part group — see [The identity tag row is gone](#the-identity-tag-row-is-gone)). Grid items stretch to the tallest cell in their row and that height is uneven for real reasons — a carrier reporting no PCI has one fewer detail segment, and a wrapped band/EARFCN line is taller than an unwrapped one — so without it the reading floats wherever the text above it stops instead of reading as one comparable scale across the row.

##### PCC primacy is now ORDER, not colour

The lead carrier used to be findable by its strong fill. With the body neutral, `sortCarriers()` is the **only** channel left carrying it — PCC first, then LTE before NR. It was briefly reinforced by an explicit `PCC` / `SCC` tag on the tile itself; that tag is gone as of 2026-08-24 (see [The identity tag row is gone](#the-identity-tag-row-is-gone)), so ordering alone carries this fact now.

**A tonal step was deliberately NOT substituted for the fill.** Distinguishing two states by tone alone is ruled out on this surface — it is the same reasoning that puts a distinct glyph on every status chip — and position plus an explicit word survive greyscale, sunlight and every colour-vision deficiency, none of which the fill did.

> ⚠️ WARNING: do not "tidy" `sortCarriers()` back to the order the modem reported. That order is not meaningful, and it is now the only positional channel saying which carrier anchors the camp.

#### The tile's height is a binding floor, not a pin

`ONAIR_TILE_MIN_H` is `min-h-[12rem]` (192px, **re-measured 2026-08-24**; was `min-h-[13.5rem]`/216px), shared by `HERO_ONAIR_TILE.ROOT` and `SKELETON_SHAPE.ONAIR_TILE` so the loaded tile and its placeholder cannot drift (Skeleton-Mirror Rule).

Losing the tag row and tightening the reading (see [The identity tag row is gone](#the-identity-tag-row-is-gone)) shrank the tile enough to need a re-measure, done live in a browser rather than by hand: with CSS Grid's row-stretch temporarily neutralised, a full-detail tile comes to 144px at a width where its band/EARFCN lines don't wrap, 186px at the 3-column grid width where `DETAIL`'s `EARFCN`/`PCI` segments wrap (a pre-existing property of that row's own `flex-wrap`, not something this pass introduced), and a sparse tile with none of EARFCN/PCI/RSRQ/SINR comes to 126px. No single `h-` is right across every width and reading shape, for the same reason the retired 216px floor was not. Setting the floor **above** the observed 186px ceiling keeps the pin's exact-mirror guarantee in the common case without a pin's failure mode: nothing here truncates or clips, so a hard `h-` would spill a wrapped row outside the rounded box instead of the box growing to hold it — confirmed live, since the 186px case already exceeds 192px by less than the margin and still simply grows when it needs to.

The value the 216px floor itself replaced was `h-[6.5rem]` (104px), asserted by the skeleton alone about a tile that carried no height at all — a ~100px handoff jump, in the direction that got worse the more the modem had to report. `HERO_ROW_MIN_H` (`min-h-[3.25rem]`, 52px) is the same construction for the failover row, whose tallest child is the 22px help trigger (~46px at `py-3`, so the floor binds) and which also wraps on a narrow container.

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

### 4. Both refresh affordances read ONE gate expression

The guards in 2 and 3 are only worth what the *narrowest* path through them enforces, and for a while there were two paths. The page has two controls that fire the same `current.sh` read: the header Refresh pill, and the retry button on the read-error block (below). They were written at different times, and the retry was **ungated entirely** while the pill carried the full four-way disable.

The gate is now one named const in `band-locking.tsx`, passed to both:

```tsx
const isRefreshBlocked =
  isBusy || isRefreshing || bandsLoading || isWatcherRunning;
```

> ⚠️ WARNING: do not restate this expression at either call site, and do not let the two affordances take different gates. They are causally linked, which is what makes the drift dangerous rather than merely untidy. `lockBands` re-reads immediately after a successful write, and that is exactly the moment `qmanager_band_failover` spawns and starts taking the AT mutex. So the single likeliest way to be looking at the read-error block at all is the one moment when pressing its retry is hazardous, and at that moment the header pill is greyed out, which leaves an unguarded retry as the **only** live refresh on screen.

## When the band read fails

**Short version: a failed `current.sh` used to render as a fully loaded page reporting "Locked, 0 of 31 bands allowed", and the grid underneath it stayed clickable. Three changes make the failure visible, and make the controls that would write blind inert.** Shipped 2026-08-23 in `60e3100`, closing follow-up 6.

### `readError` is a separate channel from the write `error`

`useBandLocking` now exposes `readError` alongside `error`. They were one string, and fusing them was wrong in both directions:

| Channel | Set by | Scoped to | Rendered as |
| ------- | ------ | --------- | ----------- |
| `error` | A **write**: lock, unlock, failover toggle | One category, via `lastAttempted` | A filled tonal notice inside that card |
| `readError` | A **`current.sh` read**, on mount or refresh | Nothing. It belongs to no category | A page-level `ConditionScreen` |

Fusing them meant a write that actually landed, followed by a re-read that lost the AT mutex, raised the green "Locked" toast **and** a red inline notice blaming the write that had worked. In the other direction, a first-load read failure had no category to attach to, because `lastAttempted` is null until the user writes something, so it was displayed to nobody at all.

`fetchCurrent` also now guards the **payload** rather than the `success` flag alone (`!data.success || !data.current || !data.failover`). The error envelope omits both objects, so `BandCurrentResponse` marks them optional; the type previously declared them present and got away with it only because of the early return.

### The page-level block

`readError` renders a `ConditionScreen` at page level, independent of `lastAttempted`:

- **`tone="destructive"`, not `warning`, with `ariaRole="alert"`.** Every band figure on the page is now stale or absent, and the page's entire job is reporting what the modem is set to.
- **`glyph="visibility_off"`, not the `error` mark.** `error` means "your write failed" everywhere else on this surface, and the two blocks can be on screen together. Sharing the glyph of the "Not readable" chips it explains is what lets a reader see the block and the three chips as one fact.
- **Retry is `handleRefresh`**, gated by `isRefreshBlocked` above, so the fix is one press rather than a browser reload.
- **The refresh toast survives it** rather than being replaced by it. The block is a standing condition and looks identical before and after a failed retry; the toast is the only thing that tells the user their press did anything.

### The grid freezes, and that is the load-bearing half

`categoryPosture` returning `unavailable` was at first used only for **display**: the header chip said "Not readable" while the grid underneath drew 31 unselected, ring-less chips, which says the exact opposite, that nothing is locked. `isFrozen` therefore includes it:

```tsx
const isFrozen = isGated || isBusy || isUnavailable;
```

An unavailable read means the current lock is **unknown**, so any write from that card is blind: ticking one band and pressing Apply sends that band alone and silently destroys a lock the user was never shown. `aria-disabled` on the card carries `isGated || isUnavailable` and not `isBusy`, because those two are standing conditions and `isBusy` is transient.

`unavailable` also **outranks the gate** when choosing the header chip. Both are standing conditions, but the gate says who may *change* the setting while `unavailable` says we do not know what the setting *is*, and a "Scenario controlled" chip over a grid drawn from a failed read asserts that the scenario's bands are the ones shown. The band count is **suppressed** rather than zeroed for the same reason: a zero is a claim where the truth is an absence.

The card also renders a `role="status"` note next to the frozen controls, in `CONDITION_TONE.neutral` rather than `NOTICE_TONE`. The chip names the condition but never says the controls below it are inert or why, so a frozen grid read as a broken one. `NOTICE_TONE` is destructive and belongs to a failed **write**, which can be on screen at the same time; a missing reading is not a fault of the radio.

> ⚠️ WARNING: `CATEGORY_BADGE.unavailable` and `POSTURE_GLYPH.unavailable` are both `visibility_off` and both `muted`. They must **not** borrow `unknown`'s `help`. "The modem carries no such list" and "we could not fetch the list it carries" are different facts with different fixes, and since the two chips share a variant the glyph is the only channel separating them, which is the Glyph-Carries-The-State Rule. Both maps are now keyed on `BandPosture` itself, so a new posture without a chip or a disc glyph fails the build rather than failing at the call site.

### `ConditionScreen` gained a `disabled` contract

`components/cellular/condition-screen.tsx` is a shared `/cellular/` primitive, so this is a route-wide addition rather than a band-locking one. Two optional props, unset by default, so every existing call site is unchanged:

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `disabled` | `boolean?` | Gates the retry button |
| `disabledReason` | `string?` | Why. Surfaced on the control itself |

The reason it exists generalises past this page: **a condition screen's retry re-runs the very read that failed**, and on some surfaces that read is only safe in some windows. A retry that routes around its page's write guard is the guard not existing.

Two details are deliberate:

- The control keeps its shape and takes the house `disabled:pointer-events-none disabled:opacity-50` treatment, the same pair `Button` ships. An affordance that still looks pressable but is not is its own defect.
- The reason is carried by `title` plus an `sr-only` node referenced through **`aria-describedby`**, not `aria-description`. The latter is an ARIA 1.3 draft attribute that the `button` role does not support: it fails `jsx-a11y` lint and is not reliably announced.

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
| `hasCurrentReading` | `boolean` | `currentBands !== null` at the coordinator. False means `lockedBands` is the `[]` fallback from a failed `current.sh`, not the modem's answer. Feeds `categoryPosture` |
| `onToggleFailover` | `(enabled: boolean) => Promise<boolean>` | Returns success; the hero owns its own toast |
| `isLoading` | `boolean` | Page-level (`statusLoading \|\| bandsLoading \|\| scenariosLoading`). The hook's `isRefreshing` is deliberately **not** ORed into this — that is the whole point of the split |
| `isGated` | `boolean?` | Disables the failover switch — see Known gaps |

### `BandGridCardProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `bandCategory` | `BandCategory` | `"lte" \| "nsa_nr5g" \| "sa_nr5g"`; also the i18n key stem |
| `supportedBands` | `number[]` | From `device.supported_*_bands` (`policy_band`), sorted |
| `currentLockedBands` | `number[]` | From `ue_capability_band`, sorted. **New array identity every parent render** |
| `hasCurrentReading` | `boolean` | False when `current.sh` failed. Drives the `unavailable` posture, which freezes the card. See [When the band read fails](#when-the-band-read-fails) |
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

The **Loaded** branch has one further variant rather than a fourth branch: when the posture is `unavailable` it keeps the same shell and grid but freezes every control, swaps the header chip for "Not readable" with no count, and adds a `role="status"` note saying why. See [When the band read fails](#when-the-band-read-fails).

## Known gaps

- **The failover switch is disabled while gated**, so a scenario-controlled page cannot turn the safety net **on** — arguably backwards, since a scenario-applied band lock is exactly the case where you most want the net. It is left unchanged deliberately: [sim-profiles.md](sim-profiles.md) documents that the profile-apply path arms the watcher itself, and changing the gate here without changing that path would create two owners for one flag.
- **`hasChanges` blocks re-applying an identical lock.** `SaveButton` is disabled when `pendingCount === 0`, which is right for avoiding a pointless modem write — but it also means the **failover watcher cannot be re-armed without changing the selection**. If a watcher's 30-second window has expired and the user wants to re-arm it, they must toggle a band off and back on.
- **`components/onboarding/steps/step-band-locking.tsx` is still a visually independent implementation** that this redesign did not touch. Its **write path was fixed** on 2026-08-23 (`578ddb2`) and now matches this page's serialised, `data.success`-judged behaviour (see follow-up 3 below). What has not been touched is everything above the wire: it still renders `Checkbox` primitives rather than the two-axis band chip, hand-rolls its own preset radio group out of `motion.button` with raw `border-primary` / `bg-primary/5` washes and a spring transition (both against `DESIGN.md`'s One-Scale Rule), carries **hardcoded English copy** with no `t()` calls at all, and POSTs to `lock.sh` through its own `authFetch` helper rather than through `useBandLocking`. It also has no notion of the modem's *current* lock, so it cannot show the live axis or a pending-change count. A user's **first** band-lock experience therefore still diverges visually from every later one.
- **The failover help copy said 15 seconds — FIXED in this pass, and worth knowing why it was wrong.** The incumbent tooltip claimed the modem falls back "after 15 seconds", and the new i18n key inherited the figure verbatim before anyone checked it against the daemon. `qmanager_band_failover` is `SETTLE_DELAY=5` then `MAX_CHECKS=5 × CHECK_INTERVAL=5` — a **~30 second** window, which the script's own log line at `:84` states outright. All five locales now say "about 30 seconds". The lesson generalises: a number in user-facing copy is a claim about the device, and the State-Honesty Rule applies to it exactly as it does to a status chip. If `SETTLE_DELAY`, `CHECK_INTERVAL` or `MAX_CHECKS` is ever retuned, `band_locking.live.failover_help` has to move in the same change, in all five locales — nothing links them mechanically.
- **RESOLVED — the two unreferenced `shapes.ts` exports are gone.** `POSTURE_GLYPH` is wired to the rail disc (see The disc is a real state indicator now) and `SKELETON_SHAPE.HERO_EYEBROW` is deleted. `bandChipFill` was also un-exported and is now module-local.
- **The rail's scroll targets are coupled by string, not by type** — see the warning in [The lock-posture rail](#the-lock-posture-rail). A shared `bandCardDomId(category)` helper in `shapes.ts` would close this; it was not added because the two call sites are one file apart and adding a third indirection for two usages was judged worse than the warning.
- **Tower Locking's and Frequency Locking's header strings are hardcoded English.** The header-only migration passed literals to `CellularPageHeader` rather than `t()` calls; those two routes are not yet in the i18n sweep.

### Follow-ups opened by the 2026-08-22 pass

These are **recorded, not fixed**. Each was a deliberate scope call.

1. **`signalToProgress` saturates above −80 dBm — DECIDED 2026-08-23: accepted as correct, not a defect.** The map is `[floor, excellent]` → `[0, 100]` and `RSRP_THRESHOLDS.excellent` is `-80`, so every reading in the `excellent` stop draws a full bar. That is the intended behaviour: a bar answers *"where in the usable range is this"*, and past the top cut the honest answer is "as good as this scale measures". Discriminating above the cut is the **score** scale's job — `components/cellular/antenna-alignment/utils.ts:141-149` keeps a separate full-range map (`rsrpToScorePercent`, `sinrToScorePercent`) for exactly that, and `scoreSnapshot` never reads `signalToProgress`, so nothing about aim scoring depends on this. The repo previously contradicted itself here: `antenna-alignment.md:175` argued saturation is right while this list called it a defect. The tie is broken in favour of `antenna-alignment.md`.
   **What the CVD argument actually supports.** Extending the map (e.g. to `[-140, -44]`) would *not* fix the concern that motivated this entry. At any cut a continuous map draws both sides nearly the same — −80 dBm is 100%, −81 dBm is 98.3% — and widening the range reproduces that at every cut while shortening every bar by 25–37 percentage points on seven surfaces. Two readings 1 dB apart genuinely *are* nearly the same signal; drawing them alike is honest. What separates one **stop** from the next is `QUALITY_GLYPH`'s monotonic wedge ladder, not bar length. `DESIGN.md` overstated this and has been corrected in the same pass.
   **One real defect did fall out of the review, and is fixed:** `lib/radio-info.ts:145` lengthened its RSRP bar with `rsrpToPercent` (`[-125, -65]`, from `lib/carrier-aggregation.ts`) while colouring the same numeral from `RSRP_THRESHOLDS` — the last surviving rival RSRP scale, and inconsistent with the RSRQ and SINR rows directly beneath it in the same array. −80 dBm drew 100% on this page and 75% on `/cellular/`. It now routes through `signalToProgress`. `rsrpToPercent` survives only for `components/dashboard/carrier-aggregation.tsx:438`, which plots it under its own documented convention.
2. **`tailwind-merge` could not dedupe this repo's custom radius names, RESOLVED 2026-08-23 in `10d5ab9`.** The bug, for the record, because the failure mode is invisible and will recur if the fix is ever reverted: `cn()` (`lib/utils.ts`) called bare `twMerge` with no `extendTailwindMerge`, so `rounded-card` / `field` / `hero` / `inline` / `pill` / `tile` were not recognised as members of the `border-radius` group. Both classes therefore shipped, and CSS source order decided the winner. Tailwind v4 emits the `rounded-*` utilities **alphabetically** — verified 2026-08-22 by grepping the real built stylesheet under `out/_next/static/chunks/`, which yields `card, field, full, hero, inline, lg, md, none, pill, sm, tile, xl, xs`. So `<Skeleton>`'s default `rounded-md` **beat `rounded-card`, `rounded-field`, `rounded-hero` and `rounded-inline`**, and **lost to `rounded-pill` and `rounded-tile`**, which means this page's `rounded-tile` overrides on the tile skeleton and on `ConditionScreen` were correct by luck, not by `twMerge`. `cn()` now registers all six names into tailwind-merge's `radius` group via `extendTailwindMerge`, so competing `rounded-*` classes dedupe and the **last class wins**, which is the behaviour every call site already assumed. About 174 call sites were affected. The fix is in `lib/utils.ts` rather than in `components/ui/skeleton.tsx`, because the defect was never Skeleton's: any primitive with a default radius had it.
3. **The onboarding band-locking step's concurrent fan-out, RESOLVED 2026-08-23 in `578ddb2`.** `components/onboarding/steps/step-band-locking.tsx` fired up to three `lock.sh` POSTs under a single `Promise.allSettled`, which is the watcher-starvation pathology this page's `isBusy` flag exists to make unrepresentable: each `lock.sh` kills the watcher armed by the previous one, so two of three narrowings ended up unmonitored. Worse, it read `resp.ok` rather than `data.success`, and every failure path in `cgi_base.sh` answers HTTP 200 with `{"success":false,…}` and no `Status:` header, so a rejected lock structurally could not be seen, and the step called `onSuccess()` and advanced the wizard. The three writes are now **serialised** in `CATEGORY_ORDER`, each response is judged on `data.success`, applied and failed categories are tracked in one `SubmitOutcome`, `onSuccess()` fires only when everything the user selected actually applied, and a retry re-sends **only the categories that failed**. Serialising is cheap here: `lock.sh` issues a single AT command with no COPS bounce or attach cycle. See [`isBusy` blocks all three categories during any lock](#isbusy-blocks-all-three-categories-during-any-lock).
4. **`lock.sh` and `current.sh` carried the repo-wide dead `case "$result" in *ERROR*)` branch, RESOLVED repo-wide 2026-08-23 in `b4d87ef`, and these two files were never actually broken.** `qcmd` reports failure by **exit status and stderr**; `ERROR` never reaches stdout, so that branch can never match. In `lock.sh` and `current.sh` the `case` sits *after* an `[ $rc -ne 0 ] || [ -z "$result" ]` guard, which makes their `*ERROR*` arms unreachable belt-and-braces rather than a hole. The 26 unguarded sites across 9 files elsewhere in the tree have been swept (11 files touched, two of them library companions). See [at-command-transport.md](at-command-transport.md) for the surviving inventory and the `grep -qx 'OK'` write assertion the sweep introduced.
5. **`docs/reference/icon-system.md:63` still names the deleted `band-cards.tsx`** as a Material-route `Checkbox` call site. The file no longer exists and the chip grid no longer uses `Checkbox` at all.
6. **`categoryPosture()` reported an empty lock list as "Locked", RESOLVED 2026-08-23 in `60e3100`.** With an empty `locked` array against a non-empty `supported` array, the posture rail rendered **"LTE · Locked · 0 of 31 bands allowed"**, which reads as *deliberately restricted to nothing*: the opposite of the truth, on the one page whose whole job is saying what the radio is really set to. Confirmed visually 2026-08-22 during verification of this pass, which is why it was recorded last rather than grouped with the others.

   The guess recorded here turned out to be right, and the reasoning is worth keeping. **`locked: []` is not a modem state.** The modem has no concept of an empty band restriction, and `unlockAll` represents "unlocked" as *all* supported bands rather than as none, so an empty array only ever arrives one way: `current.sh` failed and the caller fell back to `[]`. The supported list comes from a **different** source, the poller snapshot, so it stays fully populated straight through that failure, which is what produced the `locked=[] supported=[31]` signature. That failure is routine rather than exotic: `qcmd` gives a 5s flock budget and the poller re-takes the AT mutex every ~4 seconds, so a page load can simply lose the race.

   Nothing in the two arrays can tell a failed read from a genuine one, so the caller now says. `categoryPosture(locked, supported, hasReading)` takes a third argument and returns a new `BandPosture` member, **`unavailable`**, when `hasReading` is false; the coordinator passes `currentBands !== null`. Everything downstream of that is covered under [When the band read fails](#when-the-band-read-fails). Every other branch is unchanged, so an empty locked list from a *successful* read still reads `locked`: contradictory, but genuinely reported, and therefore the honest render for that case.

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
