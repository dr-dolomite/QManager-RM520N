# Antenna Alignment (`/cellular/antenna-alignment`)

**Antenna Alignment** is the screen someone opens while standing next to the hardware with a phone in one hand and a mast in the other. It answers one question — *which way should I point this thing?* — and it answers it twice, because aiming is really two jobs. **Sweeping** means rotating slowly and watching for change; **committing** means stopping at three candidate positions, measuring each properly, and comparing them. The page gives each job its own card. Like the rest of `/cellular/`, it adds no backend load: every figure comes from the `signal_per_antenna` block of the poller snapshot the dashboard already fetches, and there is **no CGI endpoint of its own**.

This doc records the invariants that are cheap to break and expensive to notice. Four of them are recent correctness fixes, and each one was a case of the page presenting a number more confidently than the number deserved: a recommendation that silently re-ranked itself when the radio flapped, a "3-sample average" that was averaging a duplicate reading, a score that punished a position for a chain being idle, and an empty state that blamed the radio for the modem being unreachable.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/antenna-alignment` (`app/cellular/antenna-alignment/page.tsx`) |
| Page shell + state routing | `components/cellular/antenna-alignment/antenna-alignment.tsx` |
| **Live Aim** — the anchor instrument card | `components/cellular/antenna-alignment/live-aim.tsx` |
| **Alignment Meter** — the 3-slot recorder | `components/cellular/antenna-alignment/recorder-card.tsx` |
| Recorder state machine + `localStorage` | `components/cellular/antenna-alignment/use-position-recorder.ts` |
| **Receive Chains** — the per-port strip | `components/cellular/antenna-alignment/port-strip.tsx` |
| Skeleton + the two condition screens | `components/cellular/antenna-alignment/states.tsx` |
| Scoring layer (ranking scale, `scoreSnapshot`, `findBestSlot`) | `components/cellular/antenna-alignment/utils.ts` |
| Shared condition-screen primitive | `components/cellular/condition-screen.tsx` |
| Shared quality → glyph / chip / meter mappings | `components/cellular/signal-quality-display.ts` |
| **Sentinel boundary** (shared with antenna-statistics) | `types/modem-status.ts` — `SIGNAL_SENTINELS`, `normalizeSignalValue`, `isPortReporting`, `hasAntennaData` |
| Port metadata | `ANTENNA_PORTS` in `types/modem-status.ts` |
| Data source | `hooks/use-modem-status.ts` > `/tmp/qmanager_status.json` > `signal_per_antenna` |
| Recorder storage | `localStorage` key `qmanager:antenna-alignment:v1` |
| i18n | `antenna_alignment.*` in `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json` (**77 leaf keys per locale**) |
| Icon set | Material Symbols (the whole `/cellular/` family — see [icon-system.md](icon-system.md)) |

### Its twin: Antenna Statistics

`/cellular/antenna-statistics` reads the **same** `signal_per_antenna` field for a different job. The two are a transpose of each other: alignment is **port-major**, statistics is **technology-major** (two cards, LTE and NR5G, each holding all four ports). Alignment answers *"which way should I point this thing"*; statistics answers *"which chain is broken"*.

They share one read boundary — see below — and both render `ANTENNA_PORTS`. Read [antenna-statistics.md](antenna-statistics.md) before changing anything in `utils.ts` or in `types/modem-status.ts`, because a change there lands on both pages.

## Card order is the order the questions arrive in

1. **Live Aim** — *is it better than it was a second ago?* (the sweep)
2. **Alignment Meter** — *which of these three positions won?* (the commit)
3. **Receive Chains** — *am I aiming with all the chains I think I have?* (the diagnostic footnote)

That is a deliberate inversion. The page used to lead with four full per-port cards carrying 24 metric rows and bury the live composite readout inside the recorder card in 10px type — the smallest figure on the page was the only one usable mid-rotation.

## Live Aim: an instrument, not a hero metric

`live-aim.tsx` shows the live 0–100 composite for the primary chain, and `PRODUCT.md` bans the hero-metric template by name ("big number, small label, gradient accent"). What keeps this card legal is **decomposability**: the score never appears alone. It arrives with the two weighted legs that produced it (RSRP at 60%, SINR/SNR at 40%, each as a `MetricBar` row with its weight printed), its session peak, its change since the last measurement, and the modem's own snapshot clock time. A number you can take apart is an instrument; a number you can only admire is decoration.

**Exported geometry:** `AIM_SHELL`, `AIM_SHAPE`, `AIM_SCORE_BLOCK_HEIGHT` — imported by `states.tsx` so the skeleton mirrors by import rather than by number.

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
| `signalToProgress(value, thresholds)` (`types/modem-status.ts`) | The narrow quality window, `poor`..`excellent` | Every **display** bar on this page |
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

`partial` is surfaced, not swallowed: a `muted` chip on Live Aim naming the single contributing leg, and a "partial" footnote in the slot tile. A score built from one leg is a weaker claim than one built from two, and the UI has to be able to admit that rather than presenting both as the same number.

> ℹ️ NOTE: this closes the former "Known gap" about `computeCompositeScore` reading snapshots raw. The documented reason for *not* fixing it — "normalizing turns an idle chain into a hard 0" — was subtly wrong: it was *already* a hard 0, because the helpers returned 0 for null. The fix was the **weighting**, not the normalization, and it needed no storage-version bump.

### `findBestSlot` excludes rather than zeroes

Slots carrying no rankable leg are filtered out, so an unmeasurable position can neither win by default nor drag the comparison. The returned `BestSlot` carries `margin` (points clear of the runner-up, `null` when only one slot is rankable) and `mixedRadios` (the rankable slots were not all captured on the same radio, so the comparison spans two different scales of thing and the recommendation banner says so).

## Alignment Meter: the 3-slot recorder

`recorder-card.tsx` + `use-position-recorder.ts`. Three slots, each `empty → recording → recorded`, persisted to `localStorage`.

**Exported geometry:** `RECORDER_GRID`, `SLOT_SHAPE`, `SLOT_MIN_HEIGHT` (a **number**, 208, because it is the sum of independent line boxes that no Tailwind class can name honestly — spent as an inline `minHeight` at both the live and skeleton ends).

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

Once a slot is recorded its label is **user data**: the `Input` disables and the stored string is what renders, so a recorded measurement can never be relabelled into claiming something it did not measure.

Unrecorded label edits live in `recorder-card.tsx` as a `labelEdits` map keyed `${antennaType}-${index}` — **not** inside each tile. They used to be tile-local while the tiles were keyed by that same composite string, so flipping Directional↔Omni remounted all three tiles and silently discarded whatever the user had typed but not yet recorded. Holding the map one level up survives the flip while still scoping per type, so an angle typed under Directional does not leak into Omni's labels.

### `isDefaultLabel` is a schema extension, and the storage key stays `v1`

`RecordingSnapshot` gained an **optional** `isDefaultLabel?: boolean`, and `ALIGNMENT_STORAGE_KEY` remains `qmanager:antenna-alignment:v1` with `version: 1` in the payload. That is deliberate, and a future contributor will otherwise assume the version should have moved.

- An **optional** field is a schema *extension*. A snapshot written before the field existed reads back as `undefined`, which correctly means *"render the stored label string"* — we cannot know whether the user typed it, so honouring the stored string is the right reading of pre-existing user data.
- Only changing what an **existing** field *means* would require the `version` gate to move, and `readPersisted()` returns `DEFAULT_STATE` for any `version !== 1` — i.e. bumping it **discards every recording the user has**. That is a real cost on a page reached after fifteen minutes on a ladder.

When `isDefaultLabel` is `true`, the renderer resolves the label through i18n instead of printing the stored string, so an untouched default follows the interface language like any other default.

### Recommendation and destructive actions

- The recommendation appears only with **two or more** rankable slots. "Best" out of one is not a comparison.
- The winning slot is promoted to `bg-primary-container text-on-primary-container` per DESIGN.md's Highlight-by-Container Rule — which names this exact case. It replaces a `ring-2 ring-primary` plus a badge notched over the tile's top edge; a ring is chrome drawn *around* a block where the canon wants the block itself to carry the state.
- **Reset** and per-slot **Clear** both route through one `AlertDialog`. Both are unrecoverable and often reached after a long climb, so `PRODUCT.md` principle 6 puts the risk in front of the action; one dialog serves both paths so the copy can name exactly what is about to be lost.
- Starting a second recording while one is active is **disabled**, not queued — the sample accumulator is shared, so a second start would silently abandon the first.

### Antenna types

| Type | Slots | Default labels | Editable |
| ---- | ----- | -------------- | -------- |
| Directional | Angles | `DEFAULT_ANGLES` = `0°`, `45°`, `90°` — numerals plus a degree sign, so they read the same in every locale and stay hardcoded | Yes, until recorded |
| Omni | Positions | `POSITION_LETTERS` = `A`, `B`, `C`, with the noun from `antenna_alignment.recorder.position` | Yes, until recorded |

## Receive Chains: the demoted per-port strip

`port-strip.tsx` replaces the deleted `antenna-card.tsx`. **Exported geometry:** `PORT_GRID`, `PORT_SHAPE`, `PORT_BLOCK_MIN_HEIGHT` (108).

The narrow question worth keeping is *"am I aiming with all the chains I think I have?"* An idle MIMO chain means the composite above is being produced by fewer antennas than the hardware has, which changes what a good score means. So each port gets one verdict chip (the **worst** of its RSRP / RSRQ / SINR, so a strong RSRP cannot mask a poor SINR) plus the RSRP that drives the score — not a full per-metric read. The full per-metric read is what the twin page is for, and the strip carries an explicit cross-link to `/cellular/antenna-statistics`.

An idle chain gets a stated `muted` verdict chip with the `do_not_disturb_on` glyph at **full contrast**. The `opacity-60` / `opacity-50` washes this replaces faded text, borders and value colour together, so an idle chain's own verdict lost contrast — the finding got quieter exactly as it got more important. **An idle chain is a finding, not a whisper.**

### Radio mode detection is for the strip only — no longer for scoring

`detectRadioMode(spa)` inspects all four antennas via `hasAntennaData()` and returns `"lte"` | `"nr"` | `"endc"`.

> ⚠️ WARNING: its **only** remaining consumer is `PortStripCard`, which uses it to decide whether to show a port's LTE row, its NR row, or both. It is **not** used in scoring any more, and must not be reintroduced there — see *`scoreSnapshot` is a pure function of the snapshot*.

Note the fallback: with no NR data and no LTE data it returns `"lte"`. That is why `detectRadioMode` can never be the signal that "nothing is reporting" — `countReportingPorts(spa) === 0` is.

## Quality mappings are shared, not local

`components/cellular/signal-quality-display.ts` owns the three mappings that turn a `SignalQuality` into something visible, so two per-antenna surfaces cannot disagree about what "fair" looks like:

| Export | Job |
| ------ | --- |
| `QUALITY_GLYPH` | The monotonic wedge ladder `signal_cellular_4_bar` → `3_bar` → `2_bar` → `1_bar` → `signal_cellular_off`. The non-chromatic channel |
| `qualityBadgeVariant(quality)` | Keys onto the exported `BadgeVariant` type, so a tone with no matching role fails the build instead of rendering transparent |
| `qualityMeterTone(quality)` | Keys onto `MetricBarTone` |

`success-container` and `warning-container` measure roughly **1.03:1** apart — the same surface to the eye, and identical under deuteranopia. So every quality chip on this page carries a glyph, and every tinted value carries an `sr-only` quality word (`success-on-surface` and `warning-on-surface` measure ~1.01:1 apart: same luminance, hue only). Excellent and Good deliberately share the `success` role rather than promoting Excellent to `primary`, because blue is simultaneously the brand, the only hue that acts, and the 5G NR identity — a blue quality chip would put one radio's identity on the other radio's content. The glyph ladder separates the tiers instead.

`getSignalQuality()` returns **lowercase** strings: `"excellent"`, `"good"`, `"fair"`, `"poor"`, `"none"`. All `switch` / map consumers and all i18n keys (`antenna_alignment.quality.<quality>`) MUST use lowercase. Title-case keys fail silently.

## Motion

Nothing here is hand-rolled; the page inherits the shared primitives from `lib/motion.ts`.

- Page cascade: `staggerContainer` / `staggerItem` (the card step). The stale/error banner sits **outside** the cascade — a condition should arrive when the condition does, not on the page's entrance clock.
- Slot tiles and port blocks: `staggerRows` / `staggerRowItem` (the row step), declared as `variants` on the grid so rows arrive inside their card's slot.
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

`states.tsx` imports `AIM_SHELL`, `AIM_SHAPE`, `RECORDER_GRID`, `SLOT_MIN_HEIGHT`, `PORT_GRID` and `PORT_BLOCK_MIN_HEIGHT` from the files that draw the loaded view, so it has no numbers of its own to drift with (DESIGN.md > The Skeleton-Mirror Rule). The only exception is the label-width slivers, which are skeleton-only by nature.

Two things the old loading state got wrong and this one does not: it **skeletonised the page header** (the page's identity is known before its readings are, so a grey bar where "Antenna Alignment" will appear replaces a fact with a guess), and it **omitted the Alignment Meter card entirely**, so the page drew four card ghosts and then popped a whole extra card in above them once data landed.

## i18n

`antenna_alignment.*` in the **`cellular`** namespace — **77 leaf keys per locale**, present in all five of `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json`. `bun run i18n:check` passes at 100% parity (1136/1136).

The metric labels are the exception: they come from `radio_info.bands.metric.*`, reused rather than duplicated, so two pages one click apart cannot disagree about what a measurement is called. That includes the SNR-vs-SINR discriminator — 3GPP calls the same measurement **SNR** on the NR side and **SINR** on the LTE side, so Live Aim picks `snr` when the score's radio is NR.

> ⚠️ WARNING: several key families are reached through **template literals** and are invisible to static extraction. Deleting one because grep found no call site ships a raw key string to a device: `antenna_alignment.quality.<quality>`, `antenna_alignment.mode.<radio>`, `antenna_alignment.mode.<radio>_short`.

`hooks/use-breadcrumbs.ts` maps `antenna-alignment` → `items.antenna_alignment`, so the breadcrumb follows the interface language rather than always reading English.

## Known gaps

Recorded honestly — each of these is a decision that was made, not an oversight.

- **`antenna-statistics/tech-card.tsx` has not adopted `signal-quality-display.ts`.** It still carries private, value-identical copies of `QUALITY_GLYPH`, `verdictVariant` and `meterTone`. The shared module is the canonical home; that file should adopt it the next time the antenna family is touched. It was left alone only to keep a design migration from editing a shipped surface it had no other reason to open.
- **`ANTENNA_PORTS[].name` / `.description` are still hardcoded English** (`types/modem-status.ts`) and render on **both** antenna pages. Deliberately deferred: localizing one page alone makes the twins disagree about a port's name. Must be done for both in one change.
- **Peak-hold and delta are session-scoped and deliberately not persisted.** A peak from a previous session would outrank what the antenna is doing now. If persistence is ever added it needs a scoping decision (per SIM? per day?), not just a storage key.
- **A pre-existing snapshot recorded before the sentinel fix can still hold a raw `-20`.** It is normalized on read — by both the renderer and `scoreSnapshot` — so it renders and ranks correctly. But the stored bytes are still the raw value; see *Two scales* and the storage-version reasoning above before deciding to rewrite them.
- **No live visual verification was performed.** The dev server redirects to `/setup/` without an authenticated session, so the loaded state has not been screenshotted. Static verification only: `tsc`, production build, eslint on the changed files, the Impeccable detector, and `bun run i18n:check`.

## Related

- [antenna-statistics.md](antenna-statistics.md): the technology-major twin, the sentinel evidence (117-sample live capture), and the shared boundary's full rationale
- [radio-information.md](radio-information.md): the `/cellular/` index both antenna pages hang off, and the source of the shared metric labels
- [icon-system.md](icon-system.md): the Icon-Boundary Rule and the Material Symbols subset
- [dashboard-state-motion.md](dashboard-state-motion.md): `SwapLabel`, `TickGroup`, and the value-tick gesture this card declines
- `DESIGN.md` > Named Rules (Highlight-by-Container, Every-Chip-Has-A-Glyph, Skeleton-Mirror, No-Overshoot, Transform-Only)
- `PRODUCT.md` > the hero-metric ban and principle 6 (put the risk in front of the action)
