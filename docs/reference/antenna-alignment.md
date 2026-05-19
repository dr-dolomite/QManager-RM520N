# Antenna Alignment

> A no-CGI frontend tool that reads live per-antenna signal data from the poller cache and guides users through recording and comparing antenna positions to find the best physical orientation.

---

## Route & data source

- **Route**: `/cellular/antenna-alignment`
- **No CGI endpoint** — reads exclusively from the `useModemStatus` hook (poller cache `signal_per_antenna` field). There is no backend call; all data comes from the shared poller cache.

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

`detectRadioMode()` inspects all 4 antennas for valid LTE/NR data and returns one of:

- `"lte"` — LTE-only data present
- `"nr"` — NR-only data present
- `"endc"` — Both LTE and NR data present (EN-DC: LTE + NR dual connectivity)

The detected mode determines which signal values are used in the composite scoring comparison.

---

## Scoring formula

Composite score = **60% RSRP + 40% SINR** using the primary antenna's values. In EN-DC mode, NR values are preferred over LTE values for the primary antenna score. This formula drives the "Best position" recommendation shown after 2+ slots are recorded.
