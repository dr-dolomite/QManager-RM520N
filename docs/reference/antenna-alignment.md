# Antenna Alignment

> A no-CGI frontend tool that reads live per-antenna signal data from the poller cache and guides users through recording and comparing antenna positions to find the best physical orientation.

---

## Route & data source

- **Route**: `/cellular/antenna-alignment`
- **No CGI endpoint** — reads exclusively from the `useModemStatus` hook (poller cache `signal_per_antenna` field). There is no backend call; all data comes from the shared poller cache.

### Its twin: Antenna Statistics

`/cellular/antenna-statistics` reads the **same** `signal_per_antenna` field for a different job. The two are a transpose of each other: alignment is **port-major** (one card per antenna port, showing both radios), statistics is **technology-major** (two cards, LTE and NR5G, each holding all four ports). Alignment answers *"which way should I point this thing"*; statistics answers *"which chain is broken"*.

They now share one read boundary — see below. Read [antenna-statistics.md](antenna-statistics.md) before changing anything in `utils.ts`, because a change there lands on both pages.

---

## The shared sentinel boundary

**Short version:** the modem reports several different "this port measured nothing" values, and they look like real readings. Both antenna pages now strip them through one function so they cannot disagree.

This file's local `RSRP_INVALID_SENTINELS` constant is **gone**. `normalizeValue(value, metric = "rsrp")` is now a thin alias over `normalizeSignalValue()` in `types/modem-status.ts`, which owns the per-metric sentinel sets (`rsrp: {-140, -32768}`, `rsrq: {-32768}`, `sinr: {-20, -32768}`). The `metric` default exists purely for source compatibility with the single-argument call sites this function used to have — the shared `rsrp` set is byte-for-byte what this file used to carry locally.

> ⚠️ Pass the real metric at every call site. SINR additionally suppresses `-20`; RSRQ deliberately does not, because a legitimate `-19` dB RSRQ was observed live. Letting a SINR value fall through the `"rsrp"` default silently re-introduces the bug below.

**This fixed a live bug on this page, not just on the new one.** `-20` was never stripped here, so `isAntennaActive()` saw a non-null SINR and reported an idle NR chain as **Active**. `detectRadioMode()` and `isAntennaActive()` are now reimplemented over the shared `hasAntennaData()` / `isPortReporting()` helpers rather than over local presence checks, so "is this port live" has exactly one definition across both pages.

Recorded snapshots are normalized both when captured (`usePositionRecorder` normalizes each sample as it accumulates) and when a stored snapshot is rendered, so a slot recorded before this fix stops drawing a raw `-20` as a real reading.

---

## Two scales: display vs. ranking

The bars you see and the number that picks "Best" use **different** percentage scales, on purpose. Merging them breaks the tool.

| Helper | Range | Used by |
| ------ | ----- | ------- |
| `signalToProgress(value, thresholds)` (`types/modem-status.ts`) | The narrow quality window, `poor`..`excellent` | Every **display** bar on this page |
| `rsrpToScorePercent` / `sinrToScorePercent` (`utils.ts`) | The full 3GPP range (RSRP -140..-44 dBm, SINR -23..30 dB) | `computeCompositeScore` **only** |

The two answer different questions. A bar asks *"where in the usable range is this reading"*, so clamping at the top of the window is correct — anything better than about -80 dBm is simply good, and the bar should say so. The composite score asks something else: it has to **rank three recorded positions against each other**. Under the quality window every position better than -80 dBm scores 100, so two genuinely different good aims come out identical and `findBestSlot` stops discriminating *exactly when* the user has found a promising spot and is fine-tuning it. Ranking needs the full spread; display needs the honest "how good is this".

The two full-range helpers were previously the display scale too. They were renamed (from the old `*ToPercent` names) rather than deleted precisely so the split is visible in the call sites.

---

## Component structure

The feature uses a coordinator pattern with four files:

| File | Role |
|------|------|
| `antenna-alignment.tsx` | Coordinator — top-level page component |
| `antenna-card.tsx` | Per-port detail card |
| `alignment-meter.tsx` | 3-position recording tool |
| `utils.ts` | Shared helpers and constants |

**Shared constant**: Uses `ANTENNA_PORTS` from `types/modem-status.ts` (re-exported via local `utils.ts`). Any new per-antenna UI must import from there — do not duplicate port definitions.

`utils.ts` also re-exports the shared read boundary (`normalizeSignalValue` as `normalizeValue`, plus `hasAntennaData` / `isPortReporting`). It is a **shared** surface now: `/cellular/antenna-statistics` imports the same functions directly from `types/modem-status.ts`.

---

## Signal quality gotcha

`getSignalQuality()` returns **lowercase** strings: `"excellent"`, `"good"`, `"fair"`, `"poor"`, `"none"`. All `switch`/map consumers MUST use lowercase keys. Using title-case or uppercase keys will silently fail to match.

---

## Alignment Meter

The Alignment Meter is a 3-slot recording tool:

- Each slot averages `SAMPLES_PER_RECORDING` (3) samples before storing a reading.
- After recording, slots are compared using a composite RSRP + SINR score with a **60/40 weight** (60% RSRP, 40% SINR) to recommend the best antenna position or angle.
- The best recommendation appears only after 2 or more slots have been recorded.
- In EN-DC mode (simultaneous LTE + NR), NR signal is preferred over LTE when computing the composite score for the primary antenna.

### Recording progress UI

Uses `Loader2Icon` spinner + step dots — NOT fill/progress bars. Fill bars are reserved for signal quality visualization (signal strength meters, quality bars) per the UI Component Conventions. Do not substitute a progress bar here.

---

## Antenna types

Two antenna types are supported, user-selectable via a toggle group:

| Type | Positions/Angles | Labels |
|------|-----------------|--------|
| Directional | Angles: 0°, 45°, 90° | Editable |
| Omni | Positions: A, B, C | Editable |

Labels for both types are user-editable in the UI.

---

## Radio mode detection

`detectRadioMode()` inspects all 4 antennas via the shared `hasAntennaData()` helper and returns one of:

- `"lte"` — LTE-only data present
- `"nr"` — NR-only data present
- `"endc"` — Both LTE and NR data present (EN-DC: LTE + NR dual connectivity)

The detected mode determines which signal values are used in the composite scoring comparison.

---

## Scoring formula

Composite score = **60% RSRP + 40% SINR** using the primary antenna's values, on the full-3GPP-range scale (see *Two scales* above — not the display scale). In EN-DC mode, NR values are preferred over LTE values for the primary antenna score. This formula drives the "Best position" recommendation shown after 2+ slots are recorded.

---

## Known gaps

- **`computeCompositeScore` reads stored snapshots raw.** It indexes `snap.lte_rsrp[0]` etc. directly, without `normalizeValue`. For slots recorded *before* the sentinel fix, the display and the ranking therefore disagree: the bar shows "—" while the score still counts a `-20`.

  This was **deliberately not fixed**, and the reason is worth understanding before someone "corrects" it. Normalizing on the way into the score turns an idle chain into a hard `0` (both helpers return `0` for `null`), and a `0` contribution can rank a physically *better* position below a worse one that happened to have all its chains reporting. The right fix needs a decision about what the alignment tool's ranking actually means when a chain is idle — and probably a `version: 2` bump on `ALIGNMENT_STORAGE_KEY` so pre-fix slots are discarded rather than reinterpreted.

- **`ANTENNA_PORTS[].name` / `.description` are hardcoded English** (`types/modem-status.ts`) and render on this page *and* on [antenna-statistics.md](antenna-statistics.md). Localizing on one page only would make the twins disagree about a port's name, so it should be done for both in one change.

- **This route is pre-migration.** It still carries legacy `rounded-lg` radii, `bg-destructive/10` opacity washes, `text-[10px]` type steps and no i18n. That was left untouched on purpose: converting a route to the tonal system is all-or-nothing (see the tracked migration deltas in `CLAUDE.md`), and a half-converted page is worse than an unconverted one. Only the icon set was converted, as part of the whole-`/cellular/`-family boundary pass — see [icon-system.md](icon-system.md).

---

## Related

- [antenna-statistics.md](antenna-statistics.md): the technology-major twin, the sentinel evidence (117-sample live capture), and the shared boundary's full rationale
- [radio-information.md](radio-information.md): the `/cellular/` index both antenna pages hang off
- [icon-system.md](icon-system.md): the Icon-Boundary Rule and this route's conversion
