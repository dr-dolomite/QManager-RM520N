# Antenna Alignment (`/cellular/antenna-alignment`)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

**Antenna Alignment** is the screen someone opens while standing next to the hardware with a phone in one hand and a mast in the other. It answers one question — *which way should I point this thing?* — and it answers it twice, because aiming is really two jobs. **Sweeping** means rotating slowly and watching for change; **committing** means stopping at three candidate positions, measuring each properly, and comparing them. Sweeping is *continuous* and committing is *episodic*, and the page's layout is built on that difference: the live instrument is pinned and the other two cards scroll past it. Like the rest of `/cellular/`, it adds no backend load: every figure comes from the `signal_per_antenna` block of the poller snapshot the dashboard already fetches, and there is **no CGI endpoint of its own**.

This doc records the invariants that are cheap to break and expensive to notice. Several of them are correctness fixes, and each one was a case of the page presenting a number more confidently than the number deserved: a recommendation that silently re-ranked itself when the radio flapped, a "3-sample average" that was averaging a duplicate reading, a score that punished a position for a chain being idle, an empty state that blamed the radio for the modem being unreachable, and a four-across strip that put one port's 5G reading on the same baseline as three ports' 4G readings.

> ℹ️ NOTE: the surface was rebuilt on **2026-08-17** — same data, same scoring, new composition. The scoring layer (`utils.ts`) and the recorder state machine (`use-position-recorder.ts`) were **not touched**; everything this doc says about them is unchanged. What moved is layout, component names, and three display rules. See *Composition* and *What the 2026-08-17 rebuild changed* below.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/antenna-alignment` (`app/cellular/antenna-alignment/page.tsx`) |
| Page shell + state routing + the two-column split | `components/cellular/antenna-alignment/antenna-alignment.tsx` (carries the DIRECTION CONTRACT in its header) |
| **Geometry + tone contract** (the family's single source of truth) | `components/cellular/antenna-alignment/shapes.ts` |
| **Live Aim** — the anchor instrument, exports `AimConsole` + `CondensedAim` | `components/cellular/antenna-alignment/live-aim.tsx` |
| **Positions** — the 3-slot recorder, exports `PositionsCard` | `components/cellular/antenna-alignment/recorder-card.tsx` |
| Recorder state machine + `localStorage` (**unchanged by the rebuild**) | `components/cellular/antenna-alignment/use-position-recorder.ts` |
| **Receive Chains** — the per-port strip, exports `PortStripCard` | `components/cellular/antenna-alignment/port-strip.tsx` |
| Skeleton + the two condition screens | `components/cellular/antenna-alignment/states.tsx` |
| Scoring layer (ranking scale, `scoreSnapshot`, `findBestSlot`) — **unchanged by the rebuild** | `components/cellular/antenna-alignment/utils.ts` |
| Shared condition-screen primitive | `components/cellular/condition-screen.tsx` |
| Shared quality → glyph / chip / meter mappings | `components/cellular/signal-quality-display.ts` |
| **Sentinel boundary** (shared with antenna-statistics) | `types/modem-status.ts` — `SIGNAL_SENTINELS`, `normalizeSignalValue`, `isPortReporting`, `hasAntennaData` |
| Port metadata | `ANTENNA_PORTS` in `types/modem-status.ts` |
| Data source | `hooks/use-modem-status.ts` > `/tmp/qmanager_status.json` > `signal_per_antenna` |
| Recorder storage | `localStorage` key `qmanager:antenna-alignment:v1` |
| i18n | `antenna_alignment.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**81 leaf keys per locale**) |
| Icon set | Material Symbols (the whole `/cellular/` family — see [icon-system.md](icon-system.md)) |
| Visual verification | Reproduce with a throwaway `app/qm-preview/` route (see the note at the end of Verification status) — captures are build evidence and are not kept in the repo |

### Its twin: Antenna Statistics

`/cellular/antenna-statistics` reads the **same** `signal_per_antenna` field for a different job. The two are a transpose of each other: alignment is **port-major**, statistics is **technology-major** (two cards, LTE and NR5G, each holding all four ports). Alignment answers *"which way should I point this thing"*; statistics answers *"which chain is broken"*.

They share one read boundary — see below — and both render `ANTENNA_PORTS`. Read [antenna-statistics.md](antenna-statistics.md) before changing anything in `utils.ts` or in `types/modem-status.ts`, because a change there lands on both pages.

## Card order is the order the questions arrive in

1. **Live Aim** — *is it better than it was a second ago?* (the sweep)
2. **Positions** — *which of these three positions won?* (the commit)
3. **Receive Chains** — *am I aiming with all the chains I think I have?* (the diagnostic footnote)

That order is load-bearing and has not changed. It is a deliberate inversion of the page that predated all of this, which led with four full per-port cards carrying 24 metric rows and buried the live composite readout inside the recorder card in 10px type — the smallest figure on the page was the only one usable mid-rotation.

## Composition

**Short version:** question 1 is continuous and questions 2 and 3 are episodic, so the aim console is **pinned** and the other two scroll past it, rather than all three sharing one column at equal weight.

The shell (`antenna-alignment.tsx`) owns only the hook, the state routing, the page header, the degraded banner and the split. Every card owns its own content.

| Surface | Layout |
| ------- | ------ |
| Phone (below `@4xl/main`) | One column, in the order above. The console is in flow, and a **64px pinned pill readout** (`CondensedAim`) crossfades in once the console scrolls away |
| `@4xl/main` and wider | A 12-column split: **console in a 5-of-12 column, sticky**; **Positions in the 7-of-12 work column**. **Receive Chains spans the full width beneath both** |

`CONSOLE_SPLIT` / `CONSOLE_COLUMN` / `WORK_COLUMN` / `CHAINS_ROW` in `shapes.ts` are those four pieces, and the skeleton imports the same four so the loading state cannot reflow into a different composition than the loaded one.

**Why Receive Chains is not a third card in the work column.** It was, in the locked comp. Built, the work column ran 929px against the console's 403px, so the left half of a desktop viewport was ~525px of empty canvas — and because that gap *is* the sticky travel, it grew with content rather than being a fixture anyone could tune. It also made the card this doc calls a footnote the tallest thing on the page. Full width closes the two columns to within 1px and lets the strip run 4-up. The phone order is unaffected.

### The pinned readout is a separate element, not a collapsing console

`CondensedAim` mounts only below `@4xl/main` (`CONDENSED.ROOT` carries `@4xl/main:hidden`); on a wide surface the console itself is sticky and the pill never exists. It is a second element rather than a console that collapses, because a collapse animates **height**, which is off DESIGN.md's transform-and-opacity scale, while two elements crossfade on pure opacity.

Three details in `CONDENSED` are each fixing a real defect and should not be tidied away:

- **`ROOT` is `h-0`.** A zero-height sticky element placed first in the page column pins for the page's entire scroll range and contributes no layout, so the resting page is not 64px taller for a bar nobody has summoned. The bar overflows downward out of it.
- **`SHADE` is an opaque ground**, spanning the page gutter and the gap above the pill, and it carries the crossfade so ground and bar arrive as one object. Without it a primary button visibly slid across the top of the viewport *above* the pinned readout — which reads as a z-index bug. It is a solid container step, never an alpha wash or a backdrop blur: alpha over a scrolling page collapses in dark mode.
- **`BAR` is `surface-container-high` and keeps the console's key label.** At `bg-surface-container` the pill was anatomically identical to a position row — same `h-16`, same `rounded-pill`, same fill, same numeral-plus-meter — pinned directly above three of them, so a floating instrument read as a slot that had come loose. The tonal step says "above"; the label says which instrument.

Both `AimConsole` and `CondensedAim` derive their reading from one function, `useAimReading()`. A pinned readout that contradicted the card it replaced would be worse than no readout, and deriving both from one place makes that structural rather than a review discipline. The bar is hidden by an `IntersectionObserver` on a 1px sentinel placed **inside the console column** — a sentinel as a sibling grid item would claim a cell of its own and displace the work column on wide surfaces. The observer failing open leaves `condensed = false`, which is the correct resting state (full console visible, no pill), not a broken one.

## `shapes.ts` is the family's geometry and tone contract

New in the rebuild, and it is the file to read before changing any size on this route. It exists because the surface shipped without one while every sibling `/cellular/` family had one, and the drift was measurable: four byte-identical card-shell strings across three files, three control heights (40 / 42 / 44px) inside one card, five glyph sizes, two spellings of one duration token, and two letter-spacings for one label role. None of that was visible in any single file, which is why it survived.

Every consumer imports from it, **including `states.tsx`** — which no longer imports geometry from the three card files at all. The old skeleton pulled `AIM_SHAPE` / `AIM_SHELL` / `RECORDER_GRID` / `SLOT_MIN_HEIGHT` / `PORT_GRID` / `PORT_BLOCK_MIN_HEIGHT` from three siblings, so the loading state had a hard dependency on the module graph of every card it stood in for.

Its own header names three rules that are load-bearing:

- **Never interpolate a Tailwind class.** `@${step}/main:flex` and `min-h-[${x}]` compile to no rule at all and fail silently.
- **Container queries only** (`@container/main`, or a card-local `@container/card`). Viewport widths belong to the page gutter and the shell.
- **Every pinned height mirrors its root's resolved height *and* radius.** A `min-h-` is not a mirror — measured drift on this page's twin was 26px.

> ℹ️ NOTE: house convention is that geometry is **restated** across sibling routes, never imported from one — a surface takes no dependency on another route's module graph. Genuinely family-wide primitives get promoted to `components/cellular/` instead, which is what `tile-shape.ts` and `signal-quality-display.ts` are.

## What the 2026-08-17 rebuild changed

Renames and deletions first, because these are what break a stale import:

| Was | Is |
| --- | -- |
| `LiveAimCard` | `AimConsole` (plus the new `CondensedAim`) |
| `RecorderCard` | `PositionsCard` |
| `AIM_SHELL`, `AIM_SHAPE`, `AIM_SCORE_BLOCK_HEIGHT` | **Gone.** `CONSOLE.*` and `SKELETON_SHAPE.*` in `shapes.ts` |
| `RECORDER_GRID`, `SLOT_SHAPE`, `SLOT_MIN_HEIGHT` (208) | **Gone.** `SLOT.*` in `shapes.ts`; rows are `h-16`, not a tile grid |
| `PORT_GRID`, `PORT_SHAPE`, `PORT_BLOCK_MIN_HEIGHT` (108) | **Gone.** `PORT.*` in `shapes.ts`; blocks are `h-40` |
| i18n `antenna_alignment.recorder.title` = "Alignment Meter" | **"Positions"** — the page had shipped two meters |
| i18n `antenna_alignment.ports.idle_hint` | **Deleted in all five locales** (see *Receive Chains* below) |

Measured, before → after:

| | Before | After |
| - | ------ | ----- |
| Whole page, phone | 2,353px | 1,699px |
| Positions card, all slots empty | 923px (phone) | 486px phone / 410px at 1440 |
| Receive Chains | 743px (phone) | 501px phone / ~315px at 1440 |
| Whole page, desktop | 1,283px | 980px |
| Saturated primary buttons | 3 | 1 |
| Desktop column heights | 929px vs 403px | within 1px |

### Two traps that look correct in a static screenshot

Both cost real time on this rebuild, and neither is visible in a review of the diff.

> ⚠️ WARNING: **a sticky element's travel is its parent's height minus its own, so the console column must STRETCH.** `CONSOLE_SPLIT` deliberately has no `items-start`. Under `items-start` the console column shrinks to the console's own height, the sticky child has zero slack, and it simply never moves — a page that screenshots perfectly and does not pin. Under the grid's default `stretch` the column resolves to the taller work column's height, and that difference *is* the distance the console is allowed to ride.

> ⚠️ WARNING: **cost a responsive grid step against the narrowest cell it produces in the column it actually lives in, not against the page width.** `PORT.GRID` steps to 4-up at `@3xl`, which is only safe because Receive Chains spans the full page. Inside the 7-of-12 work column that same step had to wait until `@6xl`: at `@4xl` the column was ~580px, a 4-up block ~123px, and `px-4` left ~91px inside — while one metric needs ~27px of key plus ~58px of value plus gaps. The bar lane collapsed to zero and the bar vanished, which is DESIGN.md's named bug: ramp ink on a numeral with no bar beside it.

## Live Aim: an instrument, not a hero metric

`live-aim.tsx` shows the live 0–100 composite for the primary chain, and `PRODUCT.md` bans the hero-metric template by name ("big number, small label, gradient accent"). What keeps this card legal is **decomposability**: the score never appears alone. It arrives with the two weighted legs that produced it (RSRP at 60%, SINR/SNR at 40%, each as a `MetricBar` row with its weight printed), its session peak, its change since the last measurement, and the modem's own snapshot clock time. A number you can take apart is an instrument; a number you can only admire is decoration.

**Geometry:** `CONSOLE.*` in `shapes.ts` — the 52px `SCORE`, its `SCORE_BOX`, the 8px `METER_LANE`, the `PEAK_TICK`, and the 40px `LEG_ROW` pill with its 56px `LEG_LANE`. The skeleton mirrors it through `SKELETON_SHAPE.*` in the same file, so it mirrors by import rather than by number.

The console is designed for its **slot** — ~400–430px in the sticky left column at 1440, full width on a phone — not as a full-bleed row. The build it replaces was laid out as one, which is how the radio identity tag ended up ~1400px from the "Main / PRX" caption it labels, how the two leg bars became ~1130px decorative rules, and how the right third of the score block became dead band. That is why `CONSOLE.LEG_LANE` is a fixed 56px inline lane rather than a flexed full-width bar: 56px is enough travel to compare two legs at a glance, which is the only comparison that row is for, and the 8px composite meter above is the bar you are meant to watch.

### The verdict chip is the worst of both legs, not RSRP alone

`overallQuality` in `live-aim.tsx` is `worstSignalQuality(getSignalQuality(rsrp, …), getSignalQuality(sinr, …))`. It drives three things at once: the card's big meter tone, the score numeral's ramp ink, and the primary-chain verdict chip.

**Short version:** it used to read RSRP alone, and that left a hole the moment the meter started taking its fill from the ramp. `scoreSnapshot` reweights around a missing leg, so a **SINR-only** snapshot still produces a real composite score — but an RSRP-only verdict called that same snapshot `"none"`, and `qualityMeterTone("none")` is `null`, which is the empty-track signal. The card would have drawn a live score on an empty track: a number and a bar disagreeing about whether a reading exists.

`worstSignalQuality()` skips `"none"` entries, so it returns a level whenever **any** leg reported, and `"none"` only when neither did — which is exactly when `score.value` is null too. Tone, track and numeral can therefore never disagree.

> ℹ️ NOTE: this changed what the verdict chip *says*, not just what colour it is. It was RSRP-only and is now worst-of-both-legs, so a strong RSRP with a weak SINR now reads as the weaker verdict. That was the intended trade: the chip sits directly above both leg rows, and a summary that contradicts the rows beneath it is worse than no summary. It also matches `port-strip.tsx`, which was already worst-of.

### Peak-hold and delta are session-scoped on purpose

Peak-hold is the affordance the recorder cannot provide. The recorder compares three *discrete* positions and needs you to stop moving; it cannot help you **sweep**. And you cannot watch a number while simultaneously remembering its best value with your hands on a mast. Both peak and delta are held in React state only and are **never persisted** — a peak from yesterday's roof visit would outrank what the antenna is doing right now.

Both are gated on the modem's timestamp, same as the sampler (below). A repeated fetch of an unchanged snapshot is not a new measurement, and letting it through would report a delta of `0` as though the signal had genuinely held steady.

The delta chip is `variant="secondary"`, **not** `destructive`. Signal dropping while you rotate is expected information, not a fault. Its direction rides an `arrow_upward` / `arrow_downward` glyph rather than a hue, which is also what makes it survive greyscale and deuteranopia. It renders only when the score moved at least one point — a chip reading "no change" is noise on a surface being watched continuously.

### No value tick on this card

This is the one place the product's live-value tick gesture is deliberately declined. The tick dips a figure to 0.35 opacity for 700ms to mark "this just moved" — correct on a dashboard glanced at for a second, wrong here, where the figure changes every ~4s and the user is staring at it continuously outdoors. It would be dimmed roughly a fifth of the time they are reading it. The change signal is the delta chip and the meter retarget instead. See [dashboard-state-motion.md](dashboard-state-motion.md).

### The peak mark is not animated

It is positioned with `left`, and DESIGN.md's Transform-Only Rule keeps layout properties out of animations. An instant jump is also the honest gesture: a new session high is a discrete event, and snapping is what makes the mark read as "that is the best you have managed" rather than as a second bar creeping along.

## The shared sentinel boundary

**Short version:** the modem reports several different "this port measured nothing" values, and they look like real readings. Both antenna pages strip them through one function so they cannot disagree.

This file's old local `RSRP_INVALID_SENTINELS` constant is **gone**. `normalizeValue(value, metric = "rsrp")` in `utils.ts` is a thin alias over `normalizeSignalValue()` in `types/modem-status.ts`, which owns the per-metric sentinel sets (`rsrp: {-140, -32768}`, `rsrq: {-32768}`, `sinr: {-20, -32768}`). The `metric` default exists purely for source compatibility with the single-argument call sites this function used to have.

> ⚠️ WARNING: pass the real metric at every call site. SINR additionally suppresses `-20`; RSRQ deliberately does not, because a legitimate `-19` dB RSRQ was observed live. Letting a SINR value fall through the `"rsrp"` default silently re-introduces the bug where an idle NR chain reported as **Active**.

`detectRadioMode()` and `isAntennaActive()` are implemented over the shared `hasAntennaData()` / `isPortReporting()` helpers rather than over local presence checks, so "is this port live" has exactly one definition across both pages.

Recorded snapshots are normalized **both** when captured (`use-position-recorder.ts` normalizes each sample as it accumulates, keyed through `KEY_METRIC`) and when read for scoring (`scoreSnapshot` calls `normalizeValue` on every leg). A slot recorded before the sentinel fix therefore stops drawing a raw `-20` as a real reading, and stops counting it in the ranking.

## Two scales: display vs. ranking

The bars you see and the number that picks "Best" use **different** percentage scales, on purpose. Merging them breaks the tool.

| Helper | Range | Used by |
| ------ | ----- | ------- |
| `signalToProgress(value, thresholds)` (`types/modem-status.ts`) | The narrow quality window, `floor`..`excellent` | Every **display** bar on this page |
| `rsrpToScorePercent(value: number)` / `sinrToScorePercent(value: number)` (`utils.ts`) | The full 3GPP range (RSRP -140..-44 dBm, SINR -23..30 dB) | `scoreSnapshot` **only** |

The two answer different questions. A bar asks *"where in the usable range is this reading"*, so clamping at the top of the window is correct — anything better than about -80 dBm is simply good, and the bar should say so. The composite score asks something else: it has to **rank three recorded positions against each other**. Under the quality window every position better than -80 dBm scores 100, so two genuinely different good aims come out identical and `findBestSlot` stops discriminating *exactly when* the user has found a promising spot and is fine-tuning it. Ranking needs the full spread; display needs the honest "how good is this".

> ℹ️ NOTE: both scoring helpers now take a plain **`number`**, not `number | null`. That narrowing is a bug fix, not a tidy-up — see *Missing legs reweight* below. The scoring helpers were renamed (from the old `*ToPercent` names) rather than deleted precisely so the split is visible in the call sites.

## The scoring layer (`utils.ts`)

Composite score = **60% RSRP + 40% SINR**, on the full-3GPP-range scale, from the **primary** antenna's values (index 0). NR is preferred when both radios have data, which preserves the old EN-DC rule. `SCORE_WEIGHTS` is exported and is printed in the UI next to each leg's label, because a user who can see "60%" beside RSRP can work out why a strong RSRP with a weak SINR still scores well — the difference between an instrument and an oracle.

`scoreSnapshot()` returns a `CompositeScore`:

```ts
interface CompositeScore {
  value: number | null;      // 0–100, or null when no leg is rankable
  radio: "nr" | "lte" | null; // derived FROM the snapshot, not passed in
  legs: ScoreLeg[];           // the legs that actually contributed
  partial: boolean;           // a leg was missing and the weights renormalized
}
```

`scoreLive(spa)` wraps `scoreSnapshot` over the live block, so *"what am I reading now"* and *"what did I record there"* are the same unit and directly comparable. A slot reading 78 and a live reading of 74 mean what you would expect. Without this the instrument and the recorder would answer the same question in two different units.

### `scoreSnapshot` is a pure function of the snapshot

**This is load-bearing.** It used to take the live `RadioMode` as an argument, so a RAT (radio access technology) flap — and per-antenna presence flaps several times an hour on this device — silently re-ranked all three *stored* slots with no user action at all. The recommendation could change while the user was looking away, for a reason that had nothing to do with the antenna.

The radio a slot was captured under is already latent in the slot itself: a position recorded on NR has a non-null NR leg. So it is **derived** here rather than passed in, which makes the ranking referentially stable — what you want in a number somebody is about to act on with a wrench. `findBestSlot(slots)` likewise takes no live state.

> ⚠️ WARNING: do not reintroduce a live-state argument to `scoreSnapshot` or `findBestSlot`. A stored measurement must rank identically no matter what the radio is doing when it is read. This fix needed **no new stored field**.

### Missing legs reweight instead of scoring zero

`rsrpToScorePercent` / `sinrToScorePercent` used to accept `null` and return `0` for it — **the same value a genuine `-140 dBm` maps to.** So "this chain measured nothing" and "this chain is pinned at the noise floor" ranked identically. That is the sentinel boundary's founding defect relocated from the display layer into the ranking layer: an in-band sentinel, where `0` meant both a score and an absence.

Both helpers now take `number`, so `null` is unrepresentable at the type level and the caller is forced to decide. `scoreSnapshot` decides by **dropping the missing leg and renormalizing the remaining weights to 100%**, flagging `partial: true`. Previously a suppressed SINR cost a position a flat 40 points for a reason unrelated to aim, so a physically better position could lose the recommendation because one receive chain happened to be idle.

`partial` is surfaced, not swallowed: a `muted` chip on Live Aim naming the single contributing leg, and a caveat line inside the position row (`recorder.partial`, alongside `recorder.not_comparable` for a slot with no rankable leg at all). A score built from one leg is a weaker claim than one built from two, and the UI has to be able to admit that rather than presenting both as the same number.

> ℹ️ NOTE: this closes the former "Known gap" about `computeCompositeScore` reading snapshots raw. The documented reason for *not* fixing it — "normalizing turns an idle chain into a hard 0" — was subtly wrong: it was *already* a hard 0, because the helpers returned 0 for null. The fix was the **weighting**, not the normalization, and it needed no storage-version bump.

### `findBestSlot` excludes rather than zeroes

Slots carrying no rankable leg are filtered out, so an unmeasurable position can neither win by default nor drag the comparison. The returned `BestSlot` carries `margin` (points clear of the runner-up, `null` when only one slot is rankable) and `mixedRadios` (the rankable slots were not all captured on the same radio, so the comparison spans two different scales of thing and the recommendation banner says so).

## Positions: the 3-slot recorder

`recorder-card.tsx` (`PositionsCard`) + `use-position-recorder.ts`. Three slots, each `empty → recording → recorded`, persisted to `localStorage`. The state machine and the storage contract are **unchanged**; what the rebuild changed is the presentation.

**Geometry:** `SLOT.*` in `shapes.ts`. Rows are `h-16` pills in a `SLOT.STACK`.

> ℹ️ NOTE: the card is called **Positions**, not "Alignment Meter". The page had shipped two meters — this card and the console — and naming one of them "the meter" told the user the wrong thing about which figure to steer by.

### Three comparison rows on one shared scale, not a tile grid

The outgoing card stacked three 290px tiles down the phone: 923px, 39% of the page, 1.1 phone screens for a surface that displays nothing until it is used. It is now three rows at **every** width, and the reason is not density — it is that all three rows carry a `MetricBar` on the **same 0–100 composite scale**, so *"which position won"* is answered by **bar length** at a glance rather than by reading three numerals against each other. Three bars in three separate boxes are three readings; three bars in a stack are a comparison.

> ⚠️ WARNING: the lane has **three** states and the first two must not be collapsed into each other.
>
> | Slot | Lane |
> | ---- | ---- |
> | Never recorded | **No track at all** — a localized "Not recorded" caption. Nothing was measured, so there is no place on the scale to draw |
> | Recorded, unrankable | `MetricBar value={null}` — **the empty track**, which is the honest report of a measurement that came back with nothing |
> | Recorded, rankable | The fill, on the shared 0–100 scale |
>
> Drawing an empty track for a never-recorded slot put three ~470px rules of pure chrome across a desktop card with no comparison in it yet. Drawing *no* track for an unrankable slot would erase the difference between "not measured" and "measured, and it yielded nothing" — the same in-band-sentinel defect this whole surface has been fixing at every other layer.

The numeral follows the same split: a never-recorded row prints **nothing** (the caption already says so once, and an em dash said it a second time, which is what pushed "Not recorded" into wrapping inside a 64px pill); a recording or unrankable row keeps the `—`, because there the lane is showing progress or a track and the dash is the only thing holding the numeral column.

### One primary button, and the winning row's tone

The header carries **one** `Record` pill, which records into the **next empty slot**. Per-slot re-record survives as each row's own quiet 44px ghost icon target — the affordance a user reaches for once the card already has content to justify it. That is what removes two of the three saturated full-width primary buttons the tile grid stacked down the phone, and it is why the loudest thing on the page is no longer attached to the state where the user has done nothing.

When the button cannot work it is **disabled and says why**, per DESIGN.md's State-Honesty Rule, and the two reasons get different sentences because they are genuinely different: `recording_hint` ("finish or cancel the run in progress") is temporary and self-clearing, `all_recorded_hint` ("clear one to record again") needs the user to free a slot.

> ⚠️ WARNING: the winning row is `SLOT.BEST` = `bg-primary-container text-on-primary-container`, and **two** things change on it beyond the fill.
>
> - The score **drops the ramp ink** and inherits `on-primary-container`. `--quality-N` is computed for 4.5:1 against a card ground, not against `primary-container`; in dark mode a bright ramp ink on a deep-blue container is the weakest pair on the surface. Quality is still carried there by bar length and the `sr-only` verdict, which is the non-chromatic channel the rule actually requires.
> - The bar's **track moves to `muted`**. `surface-container-high` renders *lighter* than `primary-container`, so the track read as a second, paler segment continuing past the end of the fill — on the one row that answers "which position won". A track is only invisible chrome while it is darker than what it sits on. `CondensedAim`'s lane needed the same move for the same class of collision.

### The one text field on the surface gets a shell

`SLOT.LABEL_SHELL` wraps a raw `<input>`; the input itself is transparent and unstyled. Two reasons, and both are traps:

- It is deliberately **not** the `Input` primitive. `Input`'s base string carries `dark:bg-input/30` and `md:text-sm`, and `cn()` cannot let an unprefixed class displace a variant-prefixed one — so the fill silently reverts in dark mode and the size reverts at a **768px viewport**, a viewport breakpoint leaking into a container-query surface.
- At `border-0` on a single tonal step, the page's only editable control read as a static chip in a row full of static chips. DESIGN.md keeps inputs borderless at rest, so the affordance is a glyph rather than a stroke: the shell owns fill, radius, the 44px height and the focus ring, and an `edit` mark says the value is yours to change.

### Sampling is gated on the modem's own timestamp

**Short version:** a "sample" used to mean one HTTP response, not one measurement, so the card's promised 3-sample average was often averaging a duplicate reading.

The accumulator effect was keyed on the parsed `spa` object, and `useModemStatus` calls `setData(json)` on every successful fetch — a fresh object identity regardless of whether the contents changed. The two clocks do not line up: the client polls every **2s**, while the device-side poller's cycle is **~3.7–4.0s** (recorded in `scripts/usr/bin/qmanager_poller`'s own header, measured across 103 consecutive polls; the `sleep` runs *after* the cycle body, so anything derived from `POLL_INTERVAL` alone is ~50% short). Three fetches across a 6s window therefore captured typically **two** distinct modem reads, sometimes one, with a snapshot silently double-weighted in the mean — noise reduction the tool claimed and did not perform.

`use-position-recorder.ts` now holds `lastSampledTsRef` and ignores any snapshot whose timestamp it has already counted. A sample means a measurement. The honest cost is wall time: **three genuine samples take ~8s**, not ~6s, and the copy says so rather than implying a faster loop than the device has.

> ⚠️ WARNING: `startRecording` clears `lastSampledTsRef` to `null` so the reading currently on screen counts as sample 1. Without that reset, a second recording in the same session would skip its first measurement whenever the snapshot had not yet advanced.

The per-port average discards nulls per port and per key, so a chain that dropped out for one of the three samples averages over the samples it did report rather than poisoning the mean.

### Recording progress UI

A spinning Material `progress_activity` glyph plus **step dots** — never a fill or progress bar. DESIGN.md reserves fill and progress bars for data visualisation (signal strength, quality meters); sample progress is a `Loader-and-Dots` gesture. Substituting a bar here would make a sample count look like a measurement.

While the feed is stalled (`error` or `isStale`) the dots hold and the copy switches to a "waiting for readings" line, because recording genuinely cannot advance without fresh snapshots.

### The label freezes at capture, and lives one level up

Once a slot is recorded its label is **user data**: the field is replaced outright by a `SLOT.LABEL_STATIC` span holding the stored string, so a recorded measurement can never be relabelled into claiming something it did not measure. Dropping the box rather than disabling it is also what keeps the label legible at full ink on the winning row's `primary-container` fill — there is nothing left to signal as an editable control.

Unrecorded label edits live in `recorder-card.tsx` as a `labelEdits` map keyed `${antennaType}-${index}` — **not** inside each row. They used to be row-local while the rows were keyed by that same composite string, so flipping Directional↔Omni remounted all three and silently discarded whatever the user had typed but not yet recorded. Holding the map one level up survives the flip while still scoping per type, so an angle typed under Directional does not leak into Omni's labels.

### `isDefaultLabel` is a schema extension, and the storage key stays `v1`

`RecordingSnapshot` gained an **optional** `isDefaultLabel?: boolean`, and `ALIGNMENT_STORAGE_KEY` remains `qmanager:antenna-alignment:v1` with `version: 1` in the payload. That is deliberate, and a future contributor will otherwise assume the version should have moved.

- An **optional** field is a schema *extension*. A snapshot written before the field existed reads back as `undefined`, which correctly means *"render the stored label string"* — we cannot know whether the user typed it, so honouring the stored string is the right reading of pre-existing user data.
- Only changing what an **existing** field *means* would require the `version` gate to move, and `readPersisted()` returns `DEFAULT_STATE` for any `version !== 1` — i.e. bumping it **discards every recording the user has**. That is a real cost on a page reached after fifteen minutes on a ladder.

When `isDefaultLabel` is `true`, the renderer resolves the label through i18n instead of printing the stored string, so an untouched default follows the interface language like any other default.

### Recommendation and destructive actions

- The recommendation appears only with **two or more** rankable slots. "Best" out of one is not a comparison.
- The winning slot is promoted to `bg-primary-container text-on-primary-container` per DESIGN.md's Highlight-by-Container Rule — which names this exact case. It replaces a `ring-2 ring-primary` plus a badge notched over the tile's top edge; a ring is chrome drawn *around* a block where the canon wants the block itself to carry the state.
- The recommendation itself is **one compact neutral line**, not a second loud block. The winning row already carries "this one won" as a container fill and the longest bar; what is genuinely new in the sentence is the advisory copy, the `mixedRadios` caveat and the remaining-slot count.
- **Reset** and per-slot **Clear** both route through one `AlertDialog`. Both are unrecoverable and often reached after a long climb, so `PRODUCT.md` principle 6 puts the risk in front of the action; one dialog serves both paths so the copy can name exactly what is about to be lost. Reset is an **icon target**, not a pill: a rare, destructive, confirmed action has no business competing with Record for width.
- Starting a second recording while one is active is **disabled**, not queued — the sample accumulator is shared, so a second start would silently abandon the first.

### Antenna types

| Type | Slots | Default labels | Editable |
| ---- | ----- | -------------- | -------- |
| Directional | Angles | `DEFAULT_ANGLES` = `0°`, `45°`, `90°` — numerals plus a degree sign, so they read the same in every locale and stay hardcoded | Yes, until recorded |
| Omni | Positions | `POSITION_LETTERS` = `A`, `B`, `C`, with the noun from `antenna_alignment.recorder.position` | Yes, until recorded |

## Receive Chains: the demoted per-port strip

`port-strip.tsx` (`PortStripCard`) replaces the deleted `antenna-card.tsx`. **Geometry:** `PORT.*` in `shapes.ts` — `h-40` blocks in a grid that is **2-up on a phone and 4-up from `@3xl`**, spanning the full page width beneath the split.

The narrow question worth keeping is *"am I aiming with all the chains I think I have?"* An idle MIMO chain means the composite above is being produced by fewer antennas than the hardware has, which changes what a good score means. So each port gets one verdict chip (the **worst** of its RSRP / RSRQ / SINR across every radio it actually reports on, so a strong RSRP cannot mask a poor SINR and a healthy NR chain cannot mask a degraded LTE anchor) plus the RSRP that drives the score — not a full per-metric read. The full per-metric read is what the twin page is for, and the strip carries an explicit cross-link to `/cellular/antenna-statistics`.

> ℹ️ NOTE: the verdict deliberately **differs** from `scoreSnapshot`, which *prefers* NR. Different jobs: a composite score has to commit to one scale to stay comparable across positions; a health verdict should report the worst thing it can see. Do not align the two.

An idle chain gets a stated `muted` verdict chip with the `do_not_disturb_on` glyph at **full contrast**. The `opacity-60` / `opacity-50` washes this replaces faded text, borders and value colour together, so an idle chain's own verdict lost contrast — the finding got quieter exactly as it got more important. **An idle chain is a finding, not a whisper.** Blocks are likewise never filtered, collapsed or hidden: live capture showed LTE chains dropping out 3, 7 and 10 times in a 35-minute window, and *which* port drops wanders between reads, so a disappearing block would rewrite the grid under the user's hands.

### A chain draws a radio because the surface's `mode` says so, never because it has a reading

> ⚠️ WARNING: this is a correctness rule, not an optimisation. `showLte` / `showNr` are derived from the surface-level `mode` **alone** (`lte` and `nr` draw one metric per block, `endc` draws two). They must never be gated on `lteReporting` / `nrReporting`.

They used to be, and the result was a silent cross-radio comparison. MIMO 4 reports NR only, so its LTE row was omitted and its NR value slid up into the slot the other three blocks were using for LTE. In a 4-up strip that put `-118 dBm` of 5G on the same baseline as `-88 / -92 / -95 dBm` of 4G, with nothing in the row saying so — a scanning eye reads four numbers of one kind. **A four-across comparison only means anything if every column answers the same question.**

The fix is DESIGN.md's own empty-track rule lifted one level up: a missing reading is an **empty track**, never an omission. A silent chain now draws the row with a localized "Not reported" (`antenna_alignment.aim.not_reported`) over an empty track. An absent value flows `getSignalQuality(null) → "none" → qualityMeterTone() → null`, which *is* the empty-track contract. Do not add a branch and do not `??` a fallback tone in — that is the exact bug that once painted an unread antenna green.

The old `ports.idle_hint` string, a one-line "this chain is idle" substitute that replaced the metrics entirely, was **deleted from all five locales** in the same change. It broke the shared baseline and said a third time what the `muted` chip and the rows already say.

### The bar is stacked under the key/value, not inline with it

`PORT.METRIC` / `METRIC_HEAD` / `LANE`: a baseline row of key + value, with the quality bar on its own full-width band beneath — the same anatomy `components/cellular/radio/active-bands-card.tsx` ships, which is the reference implementation for this problem.

An inline key-bar-value row makes the lane the only flexible track, so the lane is always the first thing to collapse — and it did, to zero, throughout the band where this card once sat in a 7-of-12 column. Stacked, the bar is `w-full` at every width and all four ports' bars start and end at the same x, so their **lengths** are directly comparable rather than merely present. Length is the channel carrying the adjacent-ramp-stop distinction that colour deliberately does not.

Two related pins: the port **name takes its own line** above the RX pill and the verdict chip (at 2-up on a 390px phone a block is ~155px and "Diversity" + "DRX" does not fit), and that chip line is **never `flex-wrap`** — `PORT.HEIGHT` is a pin, not a floor, and a wrapped chip would add 28px and push the last metric out of a box that cannot grow. The chip truncates its label instead, which is safe *here and nowhere else* because the glyph is the channel actually carrying the state.

### Radio mode detection is for the strip only — no longer for scoring

`detectRadioMode(spa)` inspects all four antennas via `hasAntennaData()` and returns `"lte"` | `"nr"` | `"endc"`.

> ⚠️ WARNING: its **only** remaining consumer is `PortStripCard`, which uses it to decide whether to show a port's LTE row, its NR row, or both. It is **not** used in scoring any more, and must not be reintroduced there — see *`scoreSnapshot` is a pure function of the snapshot*.

Note the fallback: with no NR data and no LTE data it returns `"lte"`. That is why `detectRadioMode` can never be the signal that "nothing is reporting" — `countReportingPorts(spa) === 0` is.

## Quality mappings are shared, not local

`components/cellular/signal-quality-display.ts` owns the four mappings that turn a `SignalQuality` into something visible, so two per-antenna surfaces cannot disagree about what "fair" looks like:

| Export | Job |
| ------ | --- |
| `QUALITY_GLYPH` | The monotonic wedge ladder `signal_cellular_4_bar` → `3_bar` → `2_bar` → `1_bar` → `0_bar` → `signal_cellular_off`. The non-chromatic channel |
| `qualityBadgeVariant(quality)` | Keys onto the exported `BadgeVariant` type, so a tone with no matching role fails the build instead of rendering transparent |
| `qualityMeterTone(quality)` | Keys onto `MetricBarTone` — `quality-1`…`quality-5`, and **`null` for `none`** |
| `qualityInkClass(quality)` | The ramp's numeral ink, `text-quality-1`…`text-quality-5`; `text-on-surface-variant` for `none` |

`success-container` and `warning-container` measure roughly **1.03:1** apart — the same surface to the eye, and identical under deuteranopia. So every quality chip on this page carries a glyph, and every tinted value carries an `sr-only` quality word. Excellent and Good deliberately share the `success` role rather than promoting Excellent to `primary`, because blue is simultaneously the brand, the only hue that acts, and the 5G NR identity — a blue quality chip would put one radio's identity on the other radio's content. Poor and Bad likewise share `destructive`: the ramp is a five-stop **scale** living on numerals and bars, while chips are **categories** living on the functional roles, and `BadgeVariant` has no fifth failure step. In both pairs the glyph ladder separates the tiers.

### The fifth level exists for this page

`getSignalQuality()` returns **five** levels above `none`: `"excellent"`, `"good"`, `"fair"`, `"poor"`, `"bad"`. The fifth one, `bad`, was minted for exactly the call this surface makes.

**Short version:** the ladder used to stop at `poor`, so everything below −110 dBm RSRP landed in one bucket — −111 dBm and −140 dBm rendered identically. The first means *nudge the antenna*; the second means *it is pointing at a wall*. On the one page whose entire job is telling those apart, that was a hole.

The new cut sits at RSRP **−120**, RSRQ **−18**, SINR **−10**. It is a product call rather than a measurement: −110 to −120 is cell edge, a weak link that aiming, a band lock or a different antenna can plausibly recover, and below −120 the cell is effectively not being received. Those numbers live in `RSRP_THRESHOLDS` / `RSRQ_THRESHOLDS` / `SINR_THRESHOLDS` and every consumer derives from them.

`bad`'s glyph is `signal_cellular_0_bar`, which had to be added to the Material Symbols subset for it. It could not borrow either neighbour: `signal_cellular_off` means `none` ("nothing was measured"), and sharing `1_bar` with `poor` would put two states behind one glyph. That matters more here than anywhere else, because `poor` and `bad` are **adjacent** ramp stops and adjacent stops sit deliberately below the 0.05 colour-separation floor — strip the glyph and the two become genuinely indistinguishable.

> ⚠️ WARNING: `SignalThresholds` has a `poor` field **and** a `floor` field, and they are not the same kind of thing. Every named member except `floor` is a **cut** — the lowest value that still earns that level. `floor` is the bottom of `signalToProgress()`'s 0–100 scale and classifies nothing. The field now called `floor` used to be called `poor`, while `getSignalQuality()` never read it at all; it was renamed *before* a real `poor` cut was added, precisely so a cut and a floor would not share one name. Keep them distinct if you add a metric.

`getSignalQuality()` returns **lowercase** strings. All `switch` / map consumers and all i18n keys (`antenna_alignment.quality.<quality>`) MUST use lowercase. Title-case keys fail silently.

## Motion

Nothing here is hand-rolled; the page inherits the shared primitives from `lib/motion.ts`.

- Page cascade: `staggerContainer` / `staggerItem` (the card step). The stale/error banner sits **outside** the cascade — a condition should arrive when the condition does, not on the page's entrance clock.
- Position rows and port blocks: `staggerRows` / `staggerRowItem` (the row step), declared as `variants` on the stack/grid so rows arrive inside their card's slot.
- The condensed readout crossfades on **opacity only** — no height animation, no spring, no blur or `backdrop-filter`. It is `pointer-events-none` and `aria-hidden` while hidden, so it is neither a phantom tab stop nor a second screen-reader announcement of the score the user is already on.
- The previous version's bespoke spring (`stiffness: 180, damping: 24` — the exact constants `components/ui/metric-bar.tsx` bans by name) is **gone**, replaced by `MetricBar`. A meter that overshoots its value and settles back is asserting a reading the radio never made. See DESIGN.md > The No-Overshoot Rule.
- Chip and label changes use `SwapLabel` so the glyph and the words crossfade together — the glyph is what tells the states apart when colour cannot.

## Three states, and why there are two condition screens

`useModemStatus()` returns six values; the outgoing page destructured two. All of it is now used, including `refresh` — which the retry buttons are wired to and which the page had **never destructured**.

| State | Condition | Renders |
| ----- | --------- | ------- |
| Loading | `isLoading` | `AlignmentSkeleton` |
| Degraded | `!isLoading && !unreachable && (error \|\| isStale)` | `Banner role="stale"` above the live body |
| **Unreachable** | `!isLoading && !data` | `AlignmentUnreachable` — `destructive`, glyph `error`, Retry |
| **No readings** | `!!spa && countReportingPorts(spa) === 0` | `AlignmentNoReadings` — `warning`, glyph `settings_input_antenna`, Retry |

The split is the point. The old page fell through to a generic "No Antenna Data" empty state which was, in practice, **the only thing that branch ever rendered**: the poller emits `signal_per_antenna` unconditionally and `detectRadioMode` falls back to LTE, so it was unreachable unless `data` was null. It therefore asserted *the radio is silent* when the truth was *the modem could not be reached* — an actively misleading instrument on the one page a technician opens to diagnose a chain.

Tones follow the canonical mapping: unreachable is `destructive` because the link to the device is genuinely down; no-readings is `warning` because it is a real fault the user can often fix where they are standing — an antenna cable that is not seated is exactly the kind of thing someone on this page can go and check. The two carry **different glyphs**, because no two states in one slot may share one.

Both screens are the shared `ConditionScreen` primitive (`components/cellular/condition-screen.tsx`), which owns the shell and the tone→class mapping; the callers own only the glyph and the copy. That primitive was extracted from `components/cellular/radio/states.tsx` in the same change, and `antenna-statistics/states.tsx` was refactored onto it too — a pure refactor with zero visual change, closing the "should be generalized before the two drift" gap recorded in [antenna-statistics.md](antenna-statistics.md).

### The skeleton mirrors by import, not by number

`states.tsx` imports its every number from `shapes.ts` — `CONSOLE_SPLIT`, `CONSOLE_COLUMN`, `WORK_COLUMN`, `CHAINS_ROW`, `CONSOLE.SHELL`, `CARD_SHELL`, `CARD_HEADER`, `SLOT.STACK`, `PORT.GRID`, and the `SKELETON_SHAPE.*` mirrors — so it has no numbers of its own to drift with (DESIGN.md > The Skeleton-Mirror Rule) and, just as importantly, **no import from any of the three card files**. It mirrors the full two-column composition, including the full-width chains row, so the ghost cannot reflow into a different shape than the thing it stands in for.

`SKELETON_SHAPE.LINE_WRAP` exists for the one description that takes two lines on a phone (Receive Chains, drawn with `<HeaderGhost wraps />`). Mirroring a two-line description with one `LINE` under-draws the header by ~20px, and a skeleton shorter than its content is a layout shift at handoff.

Two things the old loading state got wrong and this one does not: it **skeletonised the page header** (the page's identity is known before its readings are, so a grey bar where "Antenna Alignment" will appear replaces a fact with a guess — the header now renders immediately from the composition root and the skeleton starts below it), and it **omitted the recorder card entirely**, so the page drew four card ghosts and then popped a whole extra card in above them once data landed.

## i18n

`antenna_alignment.*` in the **`cellular`** namespace — **81 leaf keys per locale**, present in all five of `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json`. `bun run i18n:check` passes at 100% parity with 0 errors.

`quality.bad` ("Very weak" in English; 极弱 / 極弱 / "Molto debole" / "Sangat lemah") came in with the fifth ramp stop — the word had to read as *worse than* Poor without reading as *absent*, because "None" would collide with the `none` level.

The 2026-08-17 rebuild moved the count from 78 to 81:

| Key | Change |
| --- | ------ |
| `recorder.title` | Retitled **"Positions"** (was "Alignment Meter") — the page had shipped two meters |
| `recorder.all_recorded_hint` | **New.** Why the one Record button is disabled with all three slots full |
| `recorder.recording_hint` | **New.** Why it is disabled during a run — a separate, self-clearing reason |
| `recorder.record_slot` | **New.** `aria-label` for a row's own 44px record target |
| `recorder.cancel_slot` | **New.** `aria-label` for the same target during a run |
| `ports.idle_hint` | **Deleted in all five locales** with the idle-chain branch (see *Receive Chains*) |

The metric labels are the exception: they come from `radio_info.bands.metric.*`, reused rather than duplicated, so two pages one click apart cannot disagree about what a measurement is called. That includes the SNR-vs-SINR discriminator — 3GPP calls the same measurement **SNR** on the NR side and **SINR** on the LTE side, so Live Aim picks `snr` when the score's radio is NR.

> ⚠️ WARNING: several key families are reached through **template literals** and are invisible to static extraction. Deleting one because grep found no call site ships a raw key string to a device: `antenna_alignment.quality.<quality>`, `antenna_alignment.mode.<radio>`, `antenna_alignment.mode.<radio>_short`.

`hooks/use-breadcrumbs.ts` maps `antenna-alignment` → `items.antenna_alignment`, so the breadcrumb follows the interface language rather than always reading English.

## Known gaps

Recorded honestly — each of these is a decision that was made, not an oversight.

- **RESOLVED — `antenna-statistics/tech-card.tsx` has adopted `signal-quality-display.ts`.** Its private copies of `QUALITY_GLYPH`, `verdictVariant` and `meterTone` were deleted in the five-stop ramp migration (2026-08-17). No private copy of the quality mappings remains anywhere in the antenna family, and re-introducing one is what the module's header now forbids by name.
- **`ANTENNA_PORTS[].name` / `.description` are still hardcoded English** (`types/modem-status.ts`) and render on **both** antenna pages. Deliberately deferred: localizing one page alone makes the twins disagree about a port's name. Must be done for both in one change.
- **Peak-hold and delta are session-scoped and deliberately not persisted.** A peak from a previous session would outrank what the antenna is doing now. If persistence is ever added it needs a scoping decision (per SIM? per day?), not just a storage key.
- **A pre-existing snapshot recorded before the sentinel fix can still hold a raw `-20`.** It is normalized on read — by both the renderer and `scoreSnapshot` — so it renders and ranks correctly. But the stored bytes are still the raw value; see *Two scales* and the storage-version reasoning above before deciding to rewrite them.
- **RESOLVED — the surface has now been visually verified.** Headless-Chrome captures at 390×844 and 1440×900, in the resting, pinned and all-recorded states, were taken at the 2026-08-17 rebuild. Several entries in this doc — the 929px-vs-403px column imbalance, the collapsed bar lane, the pinned pill reading as a loose slot row, the cross-radio baseline in the 4-up strip — were found *only* because those captures exist, and none of them were visible to `tsc`, eslint or a diff.

## Verification status

Current as of the 2026-08-17 rebuild.

| Check | Result |
| ----- | ------ |
| `tsc` | Pass |
| eslint | Pass |
| `bun run i18n:check` | 0 errors, 100% parity across five locales |
| `bun run icons:check` | Pass |
| Impeccable detector | Pass |
| Production build | Pass |
| Finish review (two rounds) | 7 of 8 fixes scored resolved; the eighth was removing the throwaway preview route, since done |
| **Visual** | Headless Chrome at 390×844 and 1440×900 — resting, pinned, all-recorded |

> ℹ️ NOTE: the throwaway preview route used to capture these is **gone**. Deleting an `app/` route strands `.next/types/validator.ts`, so `tsc` will fail on a file that no longer exists until `rm -rf .next && bunx next typegen`. That is a build-cache artefact, not a regression in this surface.

## Related

- [antenna-statistics.md](antenna-statistics.md): the technology-major twin, the sentinel evidence (117-sample live capture), and the shared boundary's full rationale
- [radio-information.md](radio-information.md): the `/cellular/` index both antenna pages hang off, and the source of the shared metric labels
- [icon-system.md](icon-system.md): the Icon-Boundary Rule and the Material Symbols subset
- [dashboard-state-motion.md](dashboard-state-motion.md): `SwapLabel`, `TickGroup`, and the value-tick gesture this card declines
- `DESIGN.md` > Named Rules (Highlight-by-Container, Every-Chip-Has-A-Glyph, Skeleton-Mirror, No-Overshoot, Transform-Only)
- `PRODUCT.md` > the hero-metric ban and principle 6 (put the risk in front of the action)
