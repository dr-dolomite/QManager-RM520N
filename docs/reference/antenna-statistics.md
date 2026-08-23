# Antenna Statistics (`/cellular/antenna-statistics`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Antenna Statistics** is the screen someone opens to answer one question: *are all four of my receive chains actually working?* The RM520N-GL has four antenna ports, and the modem reports RSRP, RSRQ and SINR separately for each one, per radio. This page lays those twelve-to-twenty-four numbers out so a dead or unplugged chain is obvious at a glance. Like the rest of `/cellular/`, it adds no backend load: every figure comes from the `signal_per_antenna` block of the poller snapshot (`/tmp/qmanager_status.json`) that the dashboard already fetches, and there is no CGI endpoint of its own.

It has a twin. `/cellular/antenna-alignment` reads the **same** field for a different job, and the difference is a transpose: antenna-statistics is **technology-major** (two cards, LTE and NR5G, each holding four ports), antenna-alignment is **port-major** (one card per port, showing both radios). That transpose *is* the distinction between the two pages, and it is deliberate — statistics answers "which chain is broken", alignment answers "which way should I point this thing".

This doc records the invariants that are cheap to break and expensive to notice. The headline one is the **sentinel normalization boundary**: before this change, a perfectly idle antenna rendered as a legible, plausible, entirely wrong "-140 dBm / Poor / empty bar".

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/antenna-statistics` (`app/cellular/antenna-statistics/page.tsx`) |
| Page shell + state routing | `components/cellular/antenna-statistics/antenna-statistics.tsx` |
| Per-technology card, port block, metric row, geometry constants | `components/cellular/antenna-statistics/tech-card.tsx` |
| 3-tile context strip | `components/cellular/antenna-statistics/context-tiles.tsx` |
| Skeleton + unreachable screen | `components/cellular/antenna-statistics/states.tsx` |
| Shared condition-screen primitive (shell + tone spec) | `components/cellular/condition-screen.tsx` |
| Canonical quality → glyph / chip / meter / ink mappings | `components/cellular/signal-quality-display.ts` |
| **Sentinel boundary** (shared with antenna-alignment) | `types/modem-status.ts` — `SIGNAL_SENTINELS`, `normalizeSignalValue`, `isPortReporting`, `hasAntennaData` |
| Port metadata | `ANTENNA_PORTS` in `types/modem-status.ts` |
| Data source | `hooks/use-modem-status.ts` > `/tmp/qmanager_status.json` > `signal_per_antenna` |
| Backend producer | `scripts/usr/lib/qmanager/parse_at.sh` — `parse_qrsrp` / `parse_qrsrq` / `parse_qsinr` (`AT+QRSRP`, `AT+QRSRQ`, `AT+QSINR`) |
| i18n | `antenna_statistics.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (38 keys per locale) |
| Icon set | Material Symbols (the whole `/cellular/` family — see [icon-system.md](icon-system.md)) |

## Layout

Page header → a 3-tile context strip → two hero cards, 2-up at `@3xl/main`.

The **context strip** (`context-tiles.tsx`) exists because users arrive here from the Radio Information page's MIMO tile, whose link text is literally "Per-antenna detail". The strip is the bridge between that tile and these four chains: *Active MIMO* (what the modem says it is running), *Serving mode* (LTE / NR / EN-DC / none), and *Chains reporting* (`n / 4`). Its geometry is **imported** from `components/cellular/tile-shape.ts` (`TILE_SHAPE`) rather than restated, so the strip is dimensionally identical to the one the user just left.

> ℹ️ NOTE: `TILE_SHAPE` used to live in `components/cellular/radio/summary-tiles.tsx`, and this strip imported it from there. It was extracted in 2026-08-16 after that strip briefly became an anchor-plus-grouped-box composition that did not use those values at all — which would have left three surfaces importing their geometry from a component that had stopped honouring it. Shared geometry now lives in a file nobody can recompose out from under its consumers. See [radio-information.md](radio-information.md).

**The Active MIMO tile carries `spatial-container`** (Spatial Azure), matching the Radio Information MIMO tile exactly — same figure, same role. It was `lte-container`, inherited from the mock, and the violet claimed "LTE readout" about a compound `LTE 1x2 | NR 2x4` value that names *both* radios in its own string. Antennas and spatial streams are neither a radio, a direction, nor a state, which is why they were given their own axis rather than borrowing one. The two MIMO tiles a user meets one click apart now agree. See [color-system.md](color-system.md).

Each **card** holds four persistent port blocks. A block is: port name + RX designator chip + a per-port verdict chip, then three metric rows (RSRP / RSRQ / SINR), each being key + `MetricBar` + a mono value.

## The sentinel boundary (read this one)

**Short version:** the modem has three different ways of saying "this antenna port measured nothing", the poller only understands one of them, and the other two happen to be *valid-looking numbers that sit exactly on the bottom of their metric's scale*. So an unused chain scored as a real, terrible signal instead of as no signal.

`types/modem-status.ts` now owns the whole policy. It is a single read boundary, deliberately, because two pages reading one field through two different sentinel rules is exactly what let this page call a dead chain "Poor" while antenna-alignment called the same chain "—".

```ts
const SIGNAL_SENTINELS: Record<SignalMetric, ReadonlySet<number>> = {
  rsrp: new Set([-140, -32768]),
  rsrq: new Set([-32768]),
  sinr: new Set([-20, -32768]),
};
```

| Export | Job |
| ------ | --- |
| `normalizeSignalValue(value, metric)` | Returns `null` for anything the radio did not actually measure. Every per-antenna surface goes through it |
| `isPortReporting(signal, index, prefix)` | Is *this port* live *on this radio*? True if any of its three metrics normalizes non-null |
| `hasAntennaData(signal, prefix)` | Does this radio have any reporting port at all? |

### Why the sets differ per metric

They are **not thresholds** and they are **not interchangeable**. The hazard is specifically that a sentinel lands exactly on that metric's `floor` — the bottom of the progress scale in `SignalThresholds`, which is a different field from the `poor` cut and was renamed apart from it during the five-stop ramp migration. Without the sentinel set, `getSignalQuality()` scores such a value `bad` and `signalToProgress()` returns 0, producing an empty bar in the ramp's darkest ink labelled `-140 dBm`. That is worse than a blank, because it looks like a signal problem the user should go and fix.

Verified against a **117-sample live capture** on `RM520NGLAAR03A03M4G_A0.303`:

- **`-32768` is the *documented* sentinel** — it is the one `parse_at.sh:20-23` already maps to `null` in `_sig_val()`. It occurred **zero times**. It stays in every set for firmware that does emit it, but it is not the case that bites.
- **`-140` (RSRP)** is the 3GPP floor. In the capture it lands in the same sample *and the same port index* as `null` in that port's RSRQ and SINR — the modem saying "port off" three ways at once, of which the poller understands one.
- **`-20` (SINR)** appears **without** a corroborating null, so it is the only available signal that an NR chain is idle. A genuine -20 dB SINR is unusable by definition (it is the bottom of the scale), so suppressing the real value costs nothing a user could act on.
- **`-20` is deliberately NOT a sentinel for RSRQ**, even though it is RSRQ's `floor`. The same capture contains a legitimate **`-19` dB** RSRQ, so that region of the range is genuinely reachable by real data. Only `-32768` is suppressed there.

> ⚠️ WARNING: do not "simplify" this into one shared set. The three sets encode three different measured facts about one firmware build, and collapsing them either re-introduces the false bottom-of-scale reading or silently discards real RSRQ data.

### A null metric is not zero percent

`MetricRow` renders the localized "Not reported" caption where the bar would be, rather than a zero-width bar. A zero-width bar reads as *"signal is zero"*, which is a different and more alarming claim than *"the radio did not report this"* — and on this page the usual cause is an idle receive chain, not a weak one. Same rule, same reasoning as the per-carrier metrics on [radio-information.md](radio-information.md).

## Port blocks are persistent, never filtered or dimmed

The live capture showed LTE chains dropping out **3, 7 and 10 times in a 35-minute window**, with *which* port drops wandering between reads. So all four blocks stay mounted at a pinned `PORT_BLOCK_HEIGHT` floor (140px) and state **"Not reporting"** rather than collapsing, disappearing, or fading.

The previous page dimmed idle ports to `opacity-25`. That is gone. **An idle chain is a finding, not a whisper** — it is the single thing this page exists to surface — and a block that collapsed on each drop would make the entire card jump every ~20 seconds.

`PORT_BLOCK_HEIGHT` is exported as a **number**, not a class, because it is the sum of four independent line boxes; deriving it once and spending it as an inline style at both ends is what keeps the skeleton a real mirror rather than an estimate. Same idiom as `BAND_ROW_HEIGHT` in `active-bands-card.tsx`.

## Quality is encoded non-chromatically

`success-container` and `warning-container` measure roughly **1.03:1** apart — the same surface to the eye, and identical under deuteranopia (the most common form of colour blindness). So colour cannot be the channel that separates a healthy chain from a degraded one.

- **Verdict chips** carry the monotonic wedge ladder: `signal_cellular_4_bar` → `3_bar` → `2_bar` → `1_bar` → `0_bar` → `signal_cellular_off`. Bar count reads in greyscale and at a glance, and every quality gets its **own** glyph (DESIGN.md > The Every-Chip-Has-A-Glyph Rule). `signal_cellular_0_bar` is `bad`'s glyph and was added to the Material Symbols subset for it; it could not borrow either neighbour, because `signal_cellular_off` is `none` ("nothing was measured") and sharing `1_bar` with `poor` would put two states behind one glyph. The `signal_cellular_alt` family is deliberately unused: it is non-monotone, its 1-bar mark is a 2×4px speck, and it has no 0-bar member.
- **Two pairs of levels share a chip role, and the glyph is what separates them.** Excellent and Good both take `success`: DESIGN.md's ramp assigns Good → hue 115, but on a *chip* that would resolve through `primary`, and blue is simultaneously the brand, the only hue that acts, *and* the 5G NR identity — a blue quality chip inside the LTE card puts one radio's identity on the other radio's content. Poor and Bad both take `destructive` for a structural reason: the ramp is a five-stop **scale** and lives on numerals and bars, while chips are **categories** and live on the functional three plus `muted`. `BadgeVariant` has no fifth failure role, and minting one is a token-layer change. In both pairs the glyph carries the distinction, which is the channel that survives greyscale anyway.
- **Every tinted value carries an `sr-only` quality word.** The metric values take their ink from `qualityInkClass()` — the ramp's `--quality-N` numeral colour — and adjacent ramp stops sit *deliberately* below the 0.05 separation floor, on the understanding that bar length carries the fine distinction. Without the hidden word, a screen-reader user gets no quality signal at all, and without the `MetricBar` beside it the tint is a bug rather than a shortcut.
- **Meters are `aria-hidden`.** The bar is a redundant view of the number and quality word immediately to its right, both of which are real text. Exposing it as a `progressbar` would announce the same fact twice, once as an unlabelled percentage.

The card's own identity chip (an outline `Tag variant="nr" | "lte"`, `components/ui/tag.tsx`) says **which radio the card is about** and never means "healthy" — see DESIGN.md > Identity-Chip Rule. Quality lives only in the per-port verdict chips.

### The verdict is the worst of the three metrics

`worstSignalQuality()` across RSRP, RSRQ and SINR, so a strong RSRP cannot mask a poor SINR. A chain that receives plenty of power but nothing intelligible is a broken chain, and averaging would hide it.

## SNR vs SINR — the labels are shared with Radio Information

3GPP calls the same measurement **SNR** on the NR side and **SINR** on the LTE side. `MetricRow` picks the key with that discriminator:

```ts
const labelKey = metric === "sinr" && prefix === "nr" ? "snr" : metric;
// → t(`radio_info.bands.metric.${labelKey}`)
```

Note the namespace: these are the **pre-existing Radio Information keys**, reused on purpose rather than duplicated into `antenna_statistics.*`. Minting a parallel set would let two pages one click apart disagree about what a measurement is called, and translators would have to keep two copies in step across five locales. Same principle as the shared `radio_info.network_type.*` keys documented in [radio-information.md](radio-information.md).

## Three states, and why the third one matters

`useModemStatus()` returns six values; the outgoing page destructured two (`data`, `isLoading`). All of it is now used.

| State | Condition | Renders |
| ----- | --------- | ------- |
| Loading | `isLoading` | `AntennaStatsSkeleton` |
| Degraded | `!isLoading && !unreachable && (error \|\| isStale)` | `Banner role="stale"` above the live body |
| Unreachable | `!isLoading && !data` | `AntennaStatsUnreachable`, a `destructive` condition screen with Retry |

**`error` and `isStale` are different facts** and do not share a message: the fetch failed, versus the fetch succeeded but the poller's own timestamp is old. The banner sits **outside** the entrance cascade, because a condition should never wait its turn.

The unreachable screen is the important one. The old page fell through to two "No LTE Signal" / "No NR5G Signal" empty states whenever the very first fetch failed — **asserting that the radio was silent when the truth was that the modem could not be reached.** That is an actively misleading instrument on the exact screen someone opens to diagnose a chain. Tone is `destructive` because the link to the device is genuinely down, not merely degraded.

> ℹ️ NOTE: the Retry button's scrim is drawn from the container's **own** ink (`bg-on-destructive-container/10`). A white-at-alpha wash is invisible on the light container and only works in dark mode.

### The skeleton mirrors by import, not by number

`states.tsx` imports `CARD_GRID`, `CARD_SHELL`, `HEADER_SHAPE`, `PORT_SHAPE.STACK`, `PORT_BLOCK_HEIGHT` and `CONTEXT_GRID` from the real components, so the two cannot drift (DESIGN.md > The Skeleton-Mirror Rule). The page header itself is never skeletonised: the page's identity is known before its readings are.

One trap worth keeping: the skeleton uses the **real `CardHeader` element**, not a hand-rolled `div`. `CardHeader` ships `grid-rows-[auto_auto]`, and that second (empty) track still emits its row gutter. Reproducing the header as a plain flex column silently dropped those 4px and left the skeleton short.

## Card order comes from the network type, not from antenna presence

```ts
const nrFirst = data?.network?.type === "5G-SA";
```

Ordering on *which radios currently have per-antenna readings* would swap the two cards past each other mid-read — and with no motion at all, because both slots hold the same component type and React re-renders rather than remounts. Per-antenna presence flaps several times an hour; the registered network type is the stable fact.

The two wrappers are **keyed** by which radio occupies the slot, so a genuine RAT (radio access technology) change remounts the card and animates, instead of teleporting the contents.

## Motion

The page inherits the shared primitives; nothing here is hand-rolled. The previous version's bespoke spring meter is gone, replaced by `MetricBar` — which explicitly bans that spring, because a meter that overshoots its value and settles back is asserting a reading the radio never made.

- Page cascade: `staggerContainer` / `staggerItem` (the card step).
- Port stack: `staggerRows` / `staggerRowItem` (the row step). The stack declares **`variants` only**, no `initial`/`animate` of its own, so port blocks arrive inside their card's slot rather than at `t=0`. Several shipped card bodies restate the clock instead; that also works, but it detaches the row cascade from the card's slot so both cards' rows start together.
- `MetricBar` receives the **row** index (0/1/2), not the port index — so the three meters in a block cascade against each other. Passing the port index would spend the card step on an in-card element and fire all three bars simultaneously.
- One `TickGroup` per card, not one per page: it coordinates the dip order of values sharing an axis and a container, and wrapping the whole page would stagger LTE against NR as if they were one reading. See [dashboard-state-motion.md](dashboard-state-motion.md).

## i18n

New `antenna_statistics.*` subtree in the **`cellular`** namespace — **38 leaf keys per locale** (`quality.bad`, "Very weak", was the 38th — added with the fifth ramp stop), present in all five of `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json`. `bun run i18n:check` passes at 100% parity. The metric labels are the exception: they come from `radio_info.bands.metric.*` (see above).

> ⚠️ WARNING: several key families are reached through **template literals** and are invisible to static extraction. Deleting one because grep found no call site ships a raw key string to a device: `antenna_statistics.quality.<quality>`, `antenna_statistics.card.<prefix>.{title,description,identity}`, `antenna_statistics.empty.<prefix>.{title,description}`, `antenna_statistics.context.mode.<mode>`.

`hooks/use-breadcrumbs.ts` gained `antenna-statistics` → `items.antenna_statistics` and `antenna-alignment` → `items.antenna_alignment`. This fixed a live bug on both routes: the sidebar rendered 天线统计 while the breadcrumb beside it rendered hardcoded English.

## Known gaps

Recorded honestly — each of these is a decision that was made, not an oversight.

- **`ANTENNA_PORTS[].name` and `.description` are hardcoded English** (`types/modem-status.ts`) and render on **both** antenna pages. Left alone deliberately: localizing on one page only would make the twins disagree about a port's name. Should be done for both in one change.
- **RESOLVED — the context tile no longer grows past its skeleton.** This used to read as a live defect: a two-leg `LTE 1x4 | NR 2x4` value stacks into two lines, and against `TILE_SHAPE.HEIGHT`'s *92px floor* it resolved taller than the skeleton, jumping at the handoff. **A floor cannot be a mirror; only a pin can** — that is the whole finding. `components/cellular/tile-shape.ts` now PINS the tile at 104px (`h-[6.5rem]`, on both `ROOT` and `HEIGHT`), a figure derived from the text column rather than the 52px disc: eyebrow 16 + 3 + value + 3 + caption 16, plus `py-4` either side, leaves a 34px value budget that fits every shape these strips render. Its comment records the four measured states that forced the pin (two-leg MIMO 118px, LTE single-carrier 98, degraded 95, against a 92px mirror — a 26px worst case). Nothing clips at the pin either: the eyebrow, caption, value and MIMO legs all carry `truncate`, so a long translation shortens rather than overflows. The fix landed in `tile-shape.ts`, so it covers every consumer at once — this strip, the radio summary strip, and the SMS Center's.
- **RESOLVED — the unreachable screen is now a shared primitive.** It used to duplicate `components/cellular/radio/states.tsx`'s condition screen almost verbatim. The shell and the tone→class mapping were extracted into **`components/cellular/condition-screen.tsx`**, and this file, `radio/states.tsx` and the two new antenna-alignment condition screens all consume it. The primitive carries no i18n namespace of its own, which is what lets `radio_info.states.*`, `antenna_statistics.states.*` and `antenna_alignment.states.*` share one screen; callers own the glyph, the tone and the copy. Pure refactor, zero visual change. See [antenna-alignment.md](antenna-alignment.md) > Three states.

  > ⚠️ WARNING: this page's glyph is `error`, while the radio page's `no-service` screen uses `signal_cellular_off`. That divergence is deliberate — no two states in one slot may share a glyph, because the tonal containers sit ~1.03:1 apart. Do not "unify" the glyphs as part of adopting the primitive.

- **RESOLVED — `tech-card.tsx`'s private quality mappings are gone.** It carried local, value-identical copies of `QUALITY_GLYPH`, `verdictVariant` and `meterTone`. All three were **deleted**, not aligned, and the file now imports `QUALITY_GLYPH`, `qualityBadgeVariant()`, `qualityMeterTone()` and `qualityInkClass()` from **`components/cellular/signal-quality-display.ts`**. There are no private copies left anywhere in the antenna family, and re-introducing one is the failure mode the module's own header warns about: a fifth stop added on one side only would make two surfaces disagree about what "fair" looks like.
- **The parser-level fix was deliberately not taken.** Mapping `-140` and `-20` to `null` inside `parse_at.sh`'s `_sig_val()` would make this correct by construction for every consumer. But it is a **Tier 3 backend change** that also rewrites the meaning of existing lines in `/tmp/qmanager_signal_history.json` mid-file, so it needs its own recon and validator pass. The frontend boundary is the safe fix, not the final one.
- **`parse_at.sh:734`'s comment is wrong.** It documents `-32768` as *the* inactive-port sentinel — which is precisely the one that never occurs on the observed firmware. Worth correcting when the parser is next touched.

## Related

- [antenna-alignment.md](antenna-alignment.md): the port-major twin, which shares the sentinel boundary and `ANTENNA_PORTS`
- [radio-information.md](radio-information.md): the `/cellular/` index this page is reached from, and the source of the shared metric labels
- [icon-system.md](icon-system.md): the Icon-Boundary Rule and the Material Symbols subset
- [dashboard-state-motion.md](dashboard-state-motion.md): `TickGroup`, `TickingValue` and `SwapLabel`
- `DESIGN.md` > Named Rules (Identity-Chip, Every-Chip-Has-A-Glyph, Skeleton-Mirror, Tiles)
