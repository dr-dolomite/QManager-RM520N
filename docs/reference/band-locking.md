# Band Locking (`/cellular/cell-locking`)

**Band Locking is the page where a user narrows what their radio is allowed to use — and it is one of the few surfaces in QManager where a wrong click can take the connection away while you are standing on it.** Locking a band writes `AT+QNWPREFCFG="lte_band",…` (or the NSA / SA equivalent) to the modem; if the bands you picked are not actually serving your location, the modem has nowhere to camp and the link drops. That single risk shapes everything below: the two-axis band chip that shows you a pending change *before* you write it, the deliberately un-gated "Restore all supported" recovery action, and the failover watcher that reverts your lock automatically when no carrier appears.

The 2026-08 redesign is **frontend-only**. `hooks/use-band-locking.ts`, `types/band-locking.ts` and all four CGI scripts under `scripts/www/cgi-bin/quecmanager/bands/` are untouched. What changed is the shape of the page (a read-only hero over three peer control cards, replacing a four-way grid that treated a status panel and three control surfaces as peers), the control itself (a two-axis chip replacing a checkbox), and the copy (2 i18n keys → 67, in all five locales).

The hero itself was then rebuilt a second time, onto shape **"2a" ("Compact tile grid")** of the *Band Locking Hero Options* design exploration (`claude.ai/design/p/681e72a4-f061-4bb2-857a-408c64670b36`). It is now **two side-by-side panels inside one hero section** — a wrapping grid of on-air carrier tiles on the left, a clickable "Lock posture" rail on the right — replacing the single-column stack of eyebrow + posture badges + failover strip + on-air text. See [The hero: two panels, one section](#the-hero-two-panels-one-section).

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
| i18n | `band_locking.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**71 keys per locale**, key paths verified identical across all five) |
| Scroll anchors the hero rail targets | `id="band-locking-card-{category}"` on each card wrapper in `band-locking.tsx` |

> ℹ️ NOTE: `band-settings.tsx` and `band-cards.tsx` are **deleted**, not renamed. `live-band-hero.tsx` and `band-grid-card.tsx` are their replacements, and neither is a port — the card replaced its control, and the hero has since been rebuilt a second time into the two-panel split described below.

## Component tree

```
BandLockingComponent                      ← owns every hook; no child talks to CGI
├── CellularPageHeader                     (shared, components/cellular/page-header.tsx)
├── ProfileOverrideAlert | Banner          (the two gates, one primitive)
└── motion cascade
    ├── LiveBandHero                       ← read-only: on-air tile grid | lock-posture rail + failover
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

- `bun run i18n:check` grades **missing** keys as warnings and exits 0, so a green run proves nothing about a locale landing (see [i18n.md](i18n.md)).
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

`HERO_SPLIT` lays the two panels out: `flex-col` below `@2xl/hero`, `flex-row` above it — a **container** query against `@container/hero`, which `BAND_HERO` itself declares, so the split responds to the hero's own width rather than the viewport.

```
<section BAND_HERO>                      rounded-hero (40px) — the ONE hero on this page
  <div HERO_SPLIT>
    ├── HERO_ONAIR_PANEL   rounded-card   flex-1  — live-dot header, tile grid, footnote
    └── HERO_RAIL_PANEL    rounded-card   25rem   — disc + title + subtitle,
                                                    3 clickable category rows,
                                                    HERO_ROW (failover) pinned by mt-auto
```

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
| Pills + bandwidth | `"LTE PCC"` / `"5G NR SCC"` pill (`tile_tech_{technology}` plus the raw `type` field), a second `"No aggregation"` pill when `onAir.length === 1`, and the bandwidth right-aligned | `band_locking.live.tile_tech_LTE` / `_NR`, `tile_no_aggregation`, `radio_info.bands.units.mhz` |
| Band + frequency | The designator (mono, 2xl, tabular) beside its centre frequency from `bandFrequencyMhz()` (`lib/band-frequency.ts`), when the band is in the static 3GPP lookup | `radio_info.bands.units.mhz` |
| Detail | `EARFCN {{earfcn}}` and `PCI {{pci}}` as separate flex children with a real gap between them (not a joined separator glyph), each omitted individually when the modem did not report it for THIS component | `band_locking.live.tile_earfcn`, `radio_info.bands.detail.pci` |
| Signal | RSRP (`{{value}} dBm`, or `–` when null) plus the `RSRP` word, beside `RSRQ {{value}} dB` and `SINR {{value}} dB` as separate flex children when reported | `band_locking.live.tile_rsrp` / `tile_no_value` / `tile_rsrq` / `tile_sinr`, `radio_info.bands.metric.rsrp` / `rsrq` / `sinr` |
| Meter | A 5px track, `mt-auto`, with a fill scaled to `rsrpToPercent(c.rsrp)` — see [The meter is toned against its tile](#the-meter-is-toned-against-its-tile) | — |

**This is a reversal of a documented decision, not an oversight.** The tile used to be deliberately Turn 2's compact single-metric-line cut, on the stated reasoning that the hero is "half of a hero, not the whole page" and a fuller tile anatomy would need a second thing to keep in sync with the dashboard's own carrier card. The 2026-08 pass took Turn 3's full-detail tile anyway, because the grid it sits in changed at the same time: `HERO_ONAIR_GRID` moved from `auto-fit, minmax(160px,1fr)` to a fixed 3-column grid (below), and a thin single-line tile inside a wider fixed column sat padded and mostly empty. The width the grid now grants each tile is what makes the fuller anatomy the right call, not a change of mind about density on its own.

**No poller or CGI change was needed for this pass.** EARFCN, PCI, RSRQ and SINR were already on `CarrierComponent` and simply unused by the old compact tile — `AT+QCAINFO` already reports all four per carrier (see `parse_at.sh`'s `parse_qcainfo()`). The tile deliberately does **not** show a cell ID: `AT+QCAINFO` never reports one per component, only the serving-cell query does (`data.lte.cell_id` / `data.nr.cell_id`), and that value describes ONE cell — the PCC's. Showing it correctly would mean showing it on some tiles and not others for a reason a reader has no way to know, so the line was dropped rather than shipped half-right.

**Detail and signal segments are separate flex children, not a joined string.** The first pass joined `EARFCN 9410`, `PCI 214` etc. with `" · "`. That reads fine in isolation but ties the visual gap to a glyph that renders differently across the interface and machine fonts and does not scale with the container query the way a flex `gap` does. Both rows now map their segment array to individual `<span>`s inside a `flex flex-wrap gap-x-3 gap-y-0.5` row, so the spacing is a layout property, not a character.

**Centre frequency is a static lookup, not a poll.** `bandFrequencyMhz(technology, band)` in `lib/band-frequency.ts` maps a 3GPP band designator to its commonly-cited centre frequency (e.g. `"B28"` → 700). It is reference data fixed by spec, not something the modem could report differently, so it is a plain object lookup rather than a hook. A band absent from the table (a rare regional allocation this modem's SKUs do not ship) renders without the frequency line rather than guessing.

#### The meter is toned against its tile

**Short version: a progress bar drawn inside a coloured tile has to take its colours from that tile, not from the page — and the first version of this tile did not, so on every PCC tile the bar was invisible.**

The original pair was a fixed `bg-surface` track with `carrierMeterTone(technology)` returning `bg-lte` / `bg-primary` for the fill. Both halves were wrong in the same place:

- The **fill** collided with the tile. A lead tile paints `bg-lte`; the fill also painted `bg-lte`. Identical colour, 1.00:1 — and the PCC is the one carrier that is always present, so the defect was on screen for every user, in every state, in both themes.
- The **track** was a hole. `surface` is the correct recessed colour against the hero card, but inside a saturated identity fill it is not "one step down", it is a near-black slot punched through the tile.

`carrierMeterTone(technology, isLead)` now returns a `{ track, fill }` pair resolved **against the tile's own ink** — the `on-` token, which is the one colour guaranteed to contrast with that fill in both themes:

| Tile | Track | Fill |
| ---- | ----- | ---- |
| Lead (`bg-lte` / `bg-primary`) | `*-foreground/25` | `*-foreground` |
| Secondary (`*-container`) | `on-*-container/15` | `*` (strong) |

> ⚠️ WARNING: `isLead` is load-bearing in this signature. Dropping it — which reads like a harmless simplification, since "the bar reports which radio" — restores the invisible-bar bug exactly.

Two notes on what this is *not*. The alphas are not the wash the Solid-Container Rule bans: a track is a groove rather than a surface carrying content, and both resolve over a **known opaque fill** (the tile) rather than over an unknown page background. And the tone is still **identity, never quality** — the design mock tints its weakest carrier's bar with `--wa`, which is a mock inconsistency and not a spec; the dBm label directly above the bar already reports how weak, and a quality-toned bar on an identity-toned fill is the same two-fills collision `active-bands-card.tsx` ruled out.

`METER_TRACK` also carries `mt-auto`. Grid items stretch to the tallest cell in their row and that height is uneven for two independent reasons — a carrier reporting no PCI has one fewer line, and in the solo layout below the tile is stretched by the cell beside it — so without it the meters comb across a row and the lone tile gets a slab of dead colour under its bar.

#### The absent-leg cell fills a spare column, it no longer reshapes the grid

The original `auto-fit` grid hit a specific failure at exactly one carrier: `auto-fit` hands a single item the whole row, so one carrier stretched a 160px tile to the full panel width and read as a broken layout. The fix at the time (Turn 3 of the exploration) was a dedicated solo layout, `HERO_ONAIR_GRID_SOLO` — `2fr 1fr` above `@sm/onair`, one column below it.

**That layout no longer exists.** Once the grid became a fixed 3-column `HERO_ONAIR_GRID` (below), a lone tile simply occupies one of the three columns like any other item — nothing stretches, so nothing needs a second layout to prevent it. `AbsentLegCell` still renders at `onAir.length === 1`, filling the grid's second cell rather than leaving it bare, and still names the radio leg that is **not** on air: NR when the lone carrier is LTE, LTE when it is NR. It links to `/cellular/cell-scanner`, the one action that would find the missing cell.

**It renders only in the solo case, and that is a decision rather than an oversight.** It exists so the row reads at all; that it is also informative is a bonus. With four LTE carriers aggregated the grid already fills its row honestly, and adding a fifth "no 5G" cell there would be an editorial claim that the absence is a fault — on a modem whose SKU may not even have an NR list, it often is not.

> ℹ️ NOTE: the cell reuses **`radio_info.bands.scanner.link`** ("Open cell scanner") rather than adding a `band_locking.*` key, and `signal_cellular_off` rather than the mock's `signal_cellular_nodata`. The first is the same borrow-don't-duplicate convention as `units.mhz` / `detail.pci` above. The second is because the allowlist in `components/ui/material-symbol-names.ts` has no `signal_cellular_nodata`, and adding one costs a font re-subset that `icons:subset` can only perform online. Sharing the glyph with the on-air **empty** state is safe rather than sloppy: the empty state replaces the entire grid, this cell only exists when the grid has exactly one tile, so the two can never share a frame.

> ℹ️ NOTE: `radio_info.bands.units.mhz` and `radio_info.bands.detail.pci` are **deliberately borrowed from another feature's namespace** rather than duplicated under `band_locking.*`. "MHz" and "PCI" are the identical word in every locale QManager ships, so a second key would only create a second thing to translate and a second thing to drift.

**Tone is identity, never quality.** `carrierTileTone(technology, isLead)` and `carrierMeterTone(technology)` give LTE the violet `lte` / `lte-container` pair and NR the blue `primary` / `primary-container` pair; `isLead` (this carrier's own `type === "PCC"`) gets the STRONG fill so the anchor tile stays findable in a five-tile grid. This restates the rule `components/dashboard/carrier-aggregation.tsx`'s `tileTone()` / `meterFillTone()` already enforce — a quality-coloured tile would put two container fills on top of each other, which is the same collision `active-bands-card.tsx` already ruled out for its own status chip. See [carrier-aggregation.md](carrier-aggregation.md).

**It does NOT go through `enrichCarriers()`.** `lib/radio-info.ts`'s pipeline — the dashboard's own — needs a release-reconciliation history, the current network type and the serving NR ARFCN/SCS, none of which this hero receives or needs. A tile here disappears the instant the modem stops reporting the carrier; it has no reason to remember one existed a moment ago. What it *does* reuse are the two pure, dependency-free primitives: `rsrpToPercent` from `lib/carrier-aggregation.ts`, and the identity-tone convention above. So the two surfaces cannot quietly disagree about what a tile's colour means, even though neither imports the other's component.

**Ordering** is `sortCarriers()`, a local helper: PCC first, then LTE before NR. `Array.prototype.sort` is stable, so carriers of equal rank keep the order the radio reported them in. LTE leads because the LTE leg is the anchor in NSA — it is what a reader looks for when a 5G connection misbehaves.

**Grid geometry.** `HERO_ONAIR_GRID` is a fixed 3-column ceiling (`grid-cols-1 @sm/onair:grid-cols-2 @lg/onair:grid-cols-3`, against the panel's own `@container/onair`), not `auto-fit`. This is a reversal of the previous `repeat(auto-fit, minmax(160px, 1fr))`: that geometry suited the compact single-line tile, but the full-detail tile (above) needs real width to lay out five lines legibly, and `auto-fit` was combing up to five *thin* tiles across the panel rather than giving three tiles room to read. A carrier count under 3 leaves the remaining grid cells empty — accepted whitespace, not a bug, and no different in spirit from the empty space `HERO_ONAIR_GRID_SOLO` used to reserve on purpose for exactly one carrier.

#### The panel's header and footer

The header row carries a live-pulse dot, the `on_air` eyebrow, and a right-aligned count summary.

> ⚠️ WARNING: the dot uses **`.animate-live-ping`**, the project's own keyframe in `app/globals.css` (running on `--duration-ambient` / `--ease-ambient`), **not** Tailwind's built-in `animate-ping`. They look similar and time differently; a `animate-ping` here is an off-scale duration under The One-Scale Rule. It is `motion-reduce:animate-none`-guarded, and `globals.css` disables it under reduced motion as well.

The summary reads `{{count}} carriers · {{mhz}} MHz` via **real i18next pluralization** — `on_air_summary_one` / `on_air_summary_other`, replacing the previous singular-only key. `mhz` is the sum of every reported `bandwidth_mhz` (negative/zero values contribute nothing).

The footer caption (`on_air_note`) exists to pre-empt the single most likely misreading of this panel: *"Reported by the radio, not by your lock list. A locked band only appears here once the modem camps on it."* Without it, a user who just locked B3 and does not see a B3 tile concludes the lock failed. It carries `mt-auto` so it pins to the panel's own bottom edge regardless of how many tiles are above it — a 2-3 carrier camp inside a 3-column grid leaves whitespace, and that whitespace belongs between the grid and the footer, not between the footer and the panel's edge (which would leave the note floating mid-panel instead of reading as a footer).

The empty state (`on_air_empty_title` / `on_air_empty_body`) is a glyph disc plus two lines, replacing the previous plain-text "No carriers reported". It is a real state — the modem genuinely is not camped on anything — and it says so while making clear the locks below still apply once it attaches.

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

Below it sit **three clickable rows**, one per `BAND_CATEGORIES` entry (`HERO_RAIL_ROW`): the category short name, a `rail_ratio` caption (`{{count}} of {{total}} bands allowed`), a `CATEGORY_BADGE` status chip, and a `chevron_right`.

**The chevron is a real affordance.** Clicking a row calls `scrollToCategory(category)`, which is a plain `document.getElementById('band-locking-card-${category}')?.scrollIntoView({ behavior: "smooth", block: "start" })`. A rail that summarised the three cards without linking to them would be restating information the cards already carry, one layer removed — the exact failing of the badges-only round it replaced.

> ⚠️ WARNING: the scroll target is looked up by **string-built DOM id**, so nothing mechanical links `scrollToCategory()` in `live-band-hero.tsx` to the `id={`band-locking-card-${category}`}` in `band-locking.tsx`. Rename either template and the rows silently stop scrolling — no type error, no lint error, no failed build. The optional-chain (`?.`) means a missed match is a no-op rather than a crash, which is the right runtime behaviour and also the reason the breakage would be quiet.

The row's badge uses **new, shorter labels** — `rail_status_locked` / `_unrestricted` / `_unknown` ("Locked" / "Unrestricted" / "Not reported"), resolved through `railStatusKey(posture)`. They are deliberately distinct from the category card's own longer badge text (`{{count}} of {{total}} locked`), because the row already prints the ratio on its own line and repeating it inside the badge would be the same number twice in one row. The full sentence goes to assistive technology as the button's `aria-label`: short name — ratio — status.

> ℹ️ NOTE: the previous round's aria-only keys `band_locking.live.category_locked` / `category_unrestricted` / `category_unknown` and the singular `on_air_empty` are **removed**. Nothing reads them.

Posture is **derived, never asserted**, by one shared helper — `categoryPosture(locked, supported)` in `shapes.ts`:

| Condition | Posture | Badge (`CATEGORY_BADGE`) | Rail label |
| --------- | ------- | ------------------------ | ---------- |
| `supported.length === 0` | `unknown` | `muted` / `schedule` | "Not reported" |
| `locked` covers the whole supported list | `unrestricted` | `success` / `lock_open` | "Unrestricted" |
| otherwise (incl. an empty `locked` list) | `locked` | `warning` / `lock` | "Locked" |

`unknown` is a real state, not a loading state. A modem that has not reported a supported-band list yet must not be described as unrestricted, because "all supported bands available" would be a claim about a list nobody has seen.

**`categoryPosture` is shared with `BandGridCard` on purpose.** The card's own header chip reads the same helper (`isUnrestricted` is a call, not a local re-derivation), so the rail row and the card's status chip can never quietly disagree about what "unrestricted" means. Before, they were two independent comparisons that happened to agree.

> ℹ️ NOTE: `BAND_CATEGORIES` is exported from `types/band-locking.ts` and imported by both `band-locking.tsx` and `live-band-hero.tsx`. It was previously a local const inside the coordinator; two iterations over three categories must not be able to disagree about order.

### Why failover lives in the hero

Band failover is not a fourth setting alongside the three categories — it is the safety net under all of them. `lock.sh` arms **one** watcher for the most recent lock regardless of which category it belonged to, so failover is a property of the modem, not of a card. Rendering it as a peer of the category cards said otherwise.

It now sits at the **foot of the rail** (`HERO_ROW`, pinned with `mt-auto`), sized like the rail's own category rows rather than as the full-bleed hero strip it used to be — it is the safety net for the three locks directly above it, so it belongs with them rather than spanning the whole hero.

Its chip is a genuine four-state indicator (`FAILOVER_BADGE`), derived by `failoverKey()` in a **significant order**:

| Order | Condition | Key | Variant / glyph |
| ----- | --------- | --- | --------------- |
| 1 | `!failover.enabled` | `disabled` | `muted` / `do_not_disturb_on` |
| 2 | `failover.activated` | `fallback` | `warning` / `warning` |
| 3 | `failover.watcher_running` | `monitoring` | `info` / `progress_activity` (spins) |
| 4 | — | `ready` | `success` / `check_circle` |

`activated` outranks `watcher_running` because a watcher that has already fired is reporting a fallback, not progress, even while it keeps running. Every state carries a **distinct** glyph, which here is mandatory rather than tidy: `success-container` and `warning-container` measure ~1.03:1 apart and are the same surface under deuteranopia, so the glyph is the only channel separating "the safety net is armed" from "the safety net has fired and your lock is not in force". `disabled` is `muted`, never `destructive` — it is deliberately off, not broken.

The hook drives this chip live. After a successful lock that returns `failover_armed: true`, `useBandLocking` polls `failover_status.sh` every 1s (it reads flag files only — no modem contact) until the watcher exits, then re-fetches `current.sh` if the watcher activated, because the watcher will have rewritten all three band lists back to the supported set.

## Geometry and tone

Everything shape- or tone-bearing on this surface lives in `components/cellular/band-locking/shapes.ts`, modelled on the custom-profiles contract and for the same reason: the incumbent declared its card shell in **three places inside one file** — the loading, empty and loaded branches of `band-cards.tsx` — so a radius fixed in one branch stayed wrong in the other two.

| Constant | Purpose |
| -------- | ------- |
| `BAND_HERO` | The one hero card, `rounded-hero` (40px). Also declares `@container/hero`, which `HERO_SPLIT` queries. A second hero on this page spends the Consistent-Layout Rule's glance-surface exception twice |
| `BAND_CARD` | One category card, `rounded-card` (36px). Imported by all three branches |
| `CARD_PAD`, `HERO_EYEBROW` | Card padding (24px peer / 28px hero) and the eyebrow type step |
| `HERO_SPLIT` | The hero's two-panel layout: `flex-col`, becoming `flex-row items-stretch` at `@2xl/hero` |
| `HERO_ONAIR_PANEL`, `HERO_ONAIR_GRID`, `HERO_ONAIR_TILE`, `HERO_ONAIR_ABSENT` | The left panel. Panel is `rounded-card` on `surface-container` and declares its own `@container/onair`; the grid is a fixed 3-column ceiling (`grid-cols-1 @sm/onair:grid-cols-2 @lg/onair:grid-cols-3`); the tile is `rounded-tile`, `px-5 py-4`, with a `PILL` (identity/aggregation pills, toned by `carrierPillTone`) and a `METER_TRACK` (`mt-auto`, no fill of its own) / `METER_FILL` pair; `HERO_ONAIR_ABSENT` is the lone-carrier absent-leg cell |
| `HERO_RAIL_PANEL`, `HERO_RAIL_DISC`, `HERO_RAIL_TITLE`, `HERO_RAIL_SUBTITLE`, `HERO_RAIL_ROW`, `HERO_RAIL_ROW_LABEL`, `HERO_RAIL_ROW_RATIO` | The right panel. Fixed `25rem` above `@2xl/hero`, full width below it. `HERO_RAIL_DISC` is 44px — one step below the product-wide 52px `HERO_DISC`, because the rail is a nested panel |
| `HERO_ROW` | The failover row at the foot of the rail. `mt-auto` pins it; `rounded-field` (20px) because this row genuinely wraps, and a pill that has wrapped to two lines is a stadium |
| `carrierTileTone` | `(technology, isLead) => string`. Identity tone only — LTE violet, NR blue, strong fill for the PCC. Never quality |
| `carrierMeterTone` | `(technology, isLead) => { track, fill }`. **`isLead` is load-bearing** — dropping it makes the bar invisible on every PCC tile. See The meter is toned against its tile |
| `carrierPillTone` | `(technology, isLead) => string`. Same construction as `carrierMeterTone`'s track: an alpha over the tile's own ink, resolved against the tile's KNOWN opaque fill rather than an unknown page background |
| `BAND_CHIP`, `BAND_CHIP_LIVE_RING`, `bandChipFill`, `bandChipClass`, `bandChipA11yKey`, `BAND_LEGEND` | The chip contract (above). `BAND_LEGEND`'s rationale comment carries the "Currently locked" naming rule — see The legend names the CONFIGURATION fact |
| `NOTICE`, `NOTICE_TONE` | The card-scoped error slot |
| `PILL_ACTION`, `PILL_ACTION_PLAIN`, `PILL_QUIET` | Action sizing. `PILL_QUIET` is deliberately smaller: Select all / Clear change a selection, they do not write to the modem, and three equal-weight pills in one footer loses which is consequential. It carries **size only** — no fill, no ink |
| `FAILOVER_BADGE`, `CATEGORY_BADGE`, `BADGE_GLYPH_SIZE` | Tone + glyph maps, keyed onto the exported `BadgeVariant` type so an unmapped state fails the build |
| `POSTURE_GLYPH` | **Currently unreferenced.** It mapped an `overallPosture` onto the old hero's single leading glyph disc; the rail's disc is now a fixed `settings_input_antenna` because the disc is no longer a state indicator — the three rows and the dynamic subtitle carry the state instead. Kept as an export, but nothing imports it |
| `categoryPosture` | `(locked, supported) => BandPosture`. The single derivation shared by the rail's rows, the rail subtitle and the card's header chip |
| `railStatusKey` | `(posture) => "band_locking.live.rail_status_{posture}"`. The rail row's short badge label, distinct from the card's longer one |
| `SKELETON_SHAPE` | Loaded geometry restated once so skeletons mirror by import, not by estimate. `HERO_DISC` (44px), `RAIL_ROW`, `HERO_ROW` and `ONAIR_TILE` are the hero's four mirrors |
| `categoryTitleKey`, `categoryDescriptionKey`, `categoryShortKey` | Category → i18n key (above) |

`CATEGORY_BADGE` reads the functional contract, not a value judgement about locking: `unrestricted` is `success`, `locked` is `warning` (a narrowed band list is the state that can cost you the connection — `warning` means *constrained*, not *you did something wrong*), and `scenario` is `info` (something else owns the setting; a standing condition, not a fault). It carries a **fourth** entry, `unknown` (`muted` / `schedule`), because the hero rail's rows have to render a category the modem has not reported a supported-band list for — the card never reaches that state (it renders its Empty branch instead).

### Select all / Clear are `tonal-neutral`, never `ghost`

`PILL_QUIET` sizes those two footer buttons but deliberately carries **no fill and no ink of its own** — the `variant="tonal-neutral"` Button supplies both. It used to be `variant="ghost"` plus a hardcoded `text-on-surface-variant` in the constant, and a ghost button has no resting fill at all: sitting beside a filled `Apply` and an outlined `Restore all supported`, it read as *disabled or absent* rather than as a third, quieter action. `tonal-neutral` gives it a real but muted presence (`surface-container`) instead of asking the reader to discover it by hovering.

Both chip hovers are `enabled:`-scoped. Tailwind's `hover:` does not exclude a disabled element on its own, so an unscoped hover would light up every chip on a gated card — advertising an interaction that is switched off.

Chip entrance motion uses `rowCascadeDelay(index)` from `lib/motion.ts` on the item variant via `custom`, **not** `staggerRows`. `staggerChildren` is unbounded, and a supported-band list routinely exceeds twenty entries: at the 80ms row step the twenty-first chip would land 1.68s after the first, which reads as the card still loading. `rowCascadeDelay` caps the index, but is a per-child delay and cannot be combined with `staggerChildren` — hence the `custom` route.

## The shared `/cellular/` page header

`components/cellular/page-header.tsx` (`CellularPageHeader`) is the header half of the Consistent-Layout Rule's page shape: a Display-step `h1`, an optional muted description, and optional right-aligned actions, laid out with a **container query** against `@container/main` so it responds to the content column rather than the viewport (and stays correct when the sidebar expands).

It exists rather than a copy-pasted `<h1>` because `text-3xl font-bold mb-2` appears in 26 component files and is missing the `tracking-[-0.02em]` the Display step actually specifies — so every one of those pages renders its title fractionally wider than the migrated surfaces. A class you have to remember to type is a class that will be typed wrong.

**Scope is deliberately three routes.** Band Locking, Tower Locking and Frequency Locking are one sub-tree a user crosses three times in a single task, so they move together; Tower and Frequency received **header-only** edits. The other unmigrated routes are not swept as a side effect — DESIGN.md's Migration Deltas table is explicit that new work follows the canon without "fixing" unconverted surfaces in passing.

It is deliberately **not** `components/cellular/radio/page-header.tsx`. That component owns Radio Information's freshness chip, its clipboard action and its own namespace lookups; it is a page, not a primitive.

## Props contracts

### `LiveBandHeroProps`

| Prop | Type | Notes |
| ---- | ---- | ----- |
| `failover` | `FailoverState` | `{ enabled, activated, watcher_running }` |
| `carrierComponents` | `CarrierComponent[]` | From `useModemStatus`; the ACTUAL view. Rendered **raw** — one tile per component, sorted but not deduplicated |
| `supportedBands` | `Record<BandCategory, number[]>` | Hardware-supported bands **per category** (`policy_band`). Replaced the summed `supportedTotal: number` |
| `lockedBands` | `Record<BandCategory, number[]>` | Configured bands **per category** (`ue_capability_band`). Replaced the summed `lockedTotal: number` |
| `onToggleFailover` | `(enabled: boolean) => Promise<boolean>` | Returns success; the hero owns its own toast |
| `isLoading` | `boolean` | Page-level (`statusLoading \|\| bandsLoading \|\| scenariosLoading`) |
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
- **Empty** (`supportedBands.length === 0`) — a real state, not a failure: plenty of RM520N SKUs report no SA band list at all. It keeps the card shell so the grid does not reflow around it.
- **Loaded** — header chip, chip grid, conditional legend (rendered only when at least one band is live, because a key explaining a mark that appears nowhere is noise), conditional error notice, `sr-only` live region for the applying announcement, and the footer.

The footer separates two different truths: the header chip reports the **modem's** state (`{count} of {total} locked`), while the pending count beside Select all / Clear reports the **form's** (`{count} pending changes`). Merging them into one line would merge two facts.

## Known gaps

- **The failover switch is disabled while gated**, so a scenario-controlled page cannot turn the safety net **on** — arguably backwards, since a scenario-applied band lock is exactly the case where you most want the net. It is left unchanged deliberately: [sim-profiles.md](sim-profiles.md) documents that the profile-apply path arms the watcher itself, and changing the gate here without changing that path would create two owners for one flag.
- **`hasChanges` blocks re-applying an identical lock.** `SaveButton` is disabled when `pendingCount === 0`, which is right for avoiding a pointless modem write — but it also means the **failover watcher cannot be re-armed without changing the selection**. If a watcher's 30-second window has expired and the user wants to re-arm it, they must toggle a band off and back on.
- **`components/onboarding/steps/step-band-locking.tsx` is a fully independent implementation** that this redesign did not touch. It still uses checkboxes, its own preset radio group, hardcoded English copy, its own `authFetch` POSTs straight to `lock.sh`, and a `Promise.allSettled` fan-out of up to three concurrent locks (the watcher-starvation pathology described above). A user's **first** band-lock experience therefore diverges from every later one.
- **The failover help copy said 15 seconds — FIXED in this pass, and worth knowing why it was wrong.** The incumbent tooltip claimed the modem falls back "after 15 seconds", and the new i18n key inherited the figure verbatim before anyone checked it against the daemon. `qmanager_band_failover` is `SETTLE_DELAY=5` then `MAX_CHECKS=5 × CHECK_INTERVAL=5` — a **~30 second** window, which the script's own log line at `:84` states outright. All five locales now say "about 30 seconds". The lesson generalises: a number in user-facing copy is a claim about the device, and the State-Honesty Rule applies to it exactly as it does to a status chip. If `SETTLE_DELAY`, `CHECK_INTERVAL` or `MAX_CHECKS` is ever retuned, `band_locking.live.failover_help` has to move in the same change, in all five locales — nothing links them mechanically.
- **Two exports in `shapes.ts` are now unreferenced**: `POSTURE_GLYPH` and `SKELETON_SHAPE.HERO_EYEBROW`, both left behind by the hero rebuild. They are harmless (dead constants, not dead code paths) and are documented rather than deleted so a future contributor does not re-derive `POSTURE_GLYPH`'s three-distinct-glyph rule from scratch if a single-slot posture indicator ever returns.
- **The rail's scroll targets are coupled by string, not by type** — see the warning in [The lock-posture rail](#the-lock-posture-rail). A shared `bandCardDomId(category)` helper in `shapes.ts` would close this; it was not added because the two call sites are one file apart and adding a third indirection for two usages was judged worse than the warning.
- **Tower Locking's and Frequency Locking's header strings are hardcoded English.** The header-only migration passed literals to `CellularPageHeader` rather than `t()` calls; those two routes are not yet in the i18n sweep.

## Related

- [sim-profiles.md](sim-profiles.md) — the profile/scenario gate's other half, the scheduled-scenario resolution, and the band-failover watcher on the apply path
- [scheduled-timers.md](scheduled-timers.md) — the on-device timer that applies a windowed scenario, and why a schedule is authoritative over a static binding
- [radio-information.md](radio-information.md) — `active-bands-card.tsx` (which owns ARFCN rendering), and the compiler-backed `react-hooks` bail-on-first-violation behaviour
- [carrier-aggregation.md](carrier-aggregation.md) — `carrier_components[]`, the ACTUAL view the hero's on-air tiles read, and the `tileTone()` / `meterFillTone()` identity convention they restate
- [wan-profile-management.md](wan-profile-management.md) — the configured-vs-actual gap that motivated keeping the on-air panel
- [i18n.md](i18n.md) — the locale pipeline and why `i18n:check` is not a gate
- [icon-system.md](icon-system.md) — `/cellular/` is a Material Symbols route; every glyph used here is already in the subset allowlist
- `DESIGN.md` > Named Rules (Consistent-Layout, Identity-Chip, Filled-Chip, Glyph-Disc, Skeleton-Mirror, One-Scale, Solid-Container)
