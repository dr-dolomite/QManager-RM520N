# Latency & Loss Thresholds — Configurable Sensitivity for Network Quality Events

**Date:** 2026-05-09
**Branch context:** `feat/ping-profile-ui`
**Type:** Frontend card + new backend CGI + poller library edit

---

## Problem

The poller emits `high_latency` and `high_packet_loss` events into `/tmp/qmanager_events.json` based on **two hardcoded thresholds** in `scripts/usr/lib/qmanager/events.sh`:

- Latency: `> 90 ms` for `>= 3` consecutive samples
- Packet loss: `>= 20 %` for `>= 3` consecutive samples

These thresholds were tuned for wired/strong-signal baselines. On the actual user audience (hobbyists running RM520N-GL on average cellular signal), the 90 ms latency floor flaps constantly.

### Live evidence (test device, 2026-05-09)

```
profile        : relaxed (5s probe interval)
latency_ms     : 131 (avg 152, min 80, max 351, jitter 52)
packet_loss    : 0 %
events 24h     : 25 × high_latency, 25 × latency_recovered  (50 noise events)
```

The user's environment averages 152 ms — entirely healthy cellular RTT — yet generates a `high_latency` event roughly every 2 minutes. Recent Activities becomes useless for spotting actual network issues.

## Goal

Make the latency and packet-loss thresholds **user-configurable** via a new System Settings card, with presets sized for the cellular audience. Existing `Connectivity Sensitivity` card stays unchanged — it controls *presence* (is internet up?), not *quality* (is latency high?).

## Non-Goals

- No raw ms / % numeric input — preset chips only
- No new email or SMS alert paths — `high_latency` events feed only the events ring buffer (Recent Activities UI + Discord `/events`)
- No changes to the Rust ping daemon (`qmanager_ping`) — it tracks presence, not quality
- No watchcat / SimFailover changes — they consume `conn_internet_available`, not quality events
- No "off / disabled" preset — keeps the model simple, avoids "why is my events list empty?" support questions
- No relative thresholds (e.g. "alert when current > 2× avg") — kept absolute for v1; revisit only if user feedback asks for it

## Design

### UI — System Settings card

**Title:** `Latency & Loss Thresholds`
**Description:** *"When QManager flags slow latency or packet loss as a network event."*
**Placement:** `app/system-settings/page.tsx` — directly below `<ConnectivitySensitivityCard />`. The two cards form a logical pair (presence vs. quality).

**Layout:** One card, two rows. Each row has its own preset chip group and own meta panel. Single Save button at bottom — saves both rows atomically (one POST). Save button enables only when selection differs from loaded state.

```
┌─ Latency & Loss Thresholds ─────────────────────────────────┐
│ When QManager flags slow latency or packet loss as a        │
│ network event.                                              │
│                                                             │
│ Latency                                  Current: 131 ms    │
│ ┌──────────┬──────────┬──────────────┐                      │
│ │ Standard │ Tolerant │ Very Tolerant│                      │
│ └──────────┴──────────┴──────────────┘                      │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Tolerant — Average cellular. Allows occasional         │  │
│ │ spikes before flagging.                                │  │
│ │  Threshold   Debounce       Current                    │  │
│ │  250 ms      3 samples      131 ms ●                   │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                             │
│ Packet loss                                Current: 0 %     │
│ ┌──────────┬──────────┬──────────────┐                      │
│ │ Standard │ Tolerant │ Very Tolerant│                      │
│ └──────────┴──────────┴──────────────┘                      │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Tolerant — Acceptable on cellular under load.          │  │
│ │ Won't fire from short bursts.                          │  │
│ │  Threshold   Debounce       Current                    │  │
│ │  30 %        3 samples      0 % ●                      │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                       [Save]│
└─────────────────────────────────────────────────────────────┘
```

**Component conventions (must follow):**
- `ToggleGroup` segmented control — same component as `ConnectivitySensitivityCard`
- Active-preset meta panel reuses the `MetaPair` sub-component pattern (`Threshold / Debounce / Current`)
- `Current` cell shows live value with status glyph: `●` (success-color) when within threshold, `⚠` (warning-color, pulsing) when above. Live value sourced from `useModemStatus().connectivity.latency_ms` and `.packet_loss_pct`
- `SaveButton` + `useSaveFlash` reused
- `motion` stagger animation matching existing card
- Loading + error variants mirror `ConnectivitySensitivityCard` exactly

### Presets (3 per row)

**Latency:**

| Preset | Threshold | Debounce | Blurb |
|---|---|---|---|
| Standard | 150 ms | 3 samples | Good cellular. Flags any sustained latency over 150 ms. |
| Tolerant | 250 ms | 3 samples | Average cellular. Allows occasional spikes before flagging. |
| Very Tolerant | 500 ms | 2 samples | Poor signal areas. Only flags when latency stays high for a while. |

**Packet loss:**

| Preset | Threshold | Debounce | Blurb |
|---|---|---|---|
| Standard | 15 % | 3 samples | Tight quality bar. Flags loss above 15 %. |
| Tolerant | 30 % | 3 samples | Acceptable on cellular under load. Won't fire from short bursts. |
| Very Tolerant | 50 % | 2 samples | Severe drops only — useful in poor signal areas. |

**Debounce is baked into the preset, not user-visible as a separate knob.** Users see it in the meta panel as informational ("Debounce: 3 samples") but can't tune it independently.

**`Very Tolerant` debounce drops to 2 samples deliberately:** at high thresholds you want fewer samples confirming a real problem, not more.

### Backend — config schema

**Config file:** `/etc/qmanager/quality_thresholds.json`

```json
{
  "latency": { "preset": "tolerant" },
  "loss":    { "preset": "tolerant" }
}
```

**Single source of truth for preset → values is `events.sh`** — same pattern as `qmanager_ping`'s `for_profile()`. The CGI writes only preset names; `events.sh` resolves them at the top of each detection cycle.

Why preset-name-on-disk (not raw values):
- Future tuning of preset numbers ships as a single backend update — no migration of user configs
- Validation reduces to a `case` with 3 known names — no range-checking ms numbers
- Symmetric with `ping_profile.json` next door

### Backend — CGI

**Path:** `scripts/www/cgi-bin/quecmanager/settings/quality_thresholds.sh`

Direct copy-shape of `ping_profile.sh`:

- `GET` → `{ success: true, settings: { latency: { preset }, loss: { preset } }, is_default: bool }`. Defaults to `tolerant` for both rows when config missing/malformed. `is_default: true` when the file is absent (post-upgrade, user has not yet saved); `false` once the user has saved at least once. The frontend uses this flag to decide whether to render the muted "default after recent update" hint.
- `POST { action: "save_settings", latency: { preset }, loss: { preset } }` validates both presets independently against the allow-list `standard|tolerant|very-tolerant`, writes atomically (`.tmp` + `mv`), touches `/tmp/qmanager_events_reload`. After a successful save the file exists, so subsequent GETs return `is_default: false`
- Errors: `missing_action`, `unknown_action`, `invalid_latency_preset`, `invalid_loss_preset`, `write_failed`

### Backend — poller wire-up (`events.sh`)

**Three edits to `scripts/usr/lib/qmanager/events.sh`:**

**1.** Module-level config state added after `_EVENTS_LOADED` guard:

```sh
QUALITY_CONFIG="${QUALITY_CONFIG:-/etc/qmanager/quality_thresholds.json}"
QUALITY_RELOAD_FLAG="${QUALITY_RELOAD_FLAG:-/tmp/qmanager_events_reload}"

# Defaults match the "tolerant" preset
_qt_lat_thresh=250
_qt_lat_debounce=3
_qt_loss_thresh=30
_qt_loss_debounce=3
```

**2.** New helpers `_qt_apply_lat`, `_qt_apply_loss`, `_qt_load`, `_qt_check_reload` (full bodies in implementation plan).

**3.** Replace the two hardcoded literals in `detect_data_connection_events`:
- `> 90` → `> $_qt_lat_thresh`
- `>= 3` (latency debounce) → `>= $_qt_lat_debounce`
- `>= 20` → `>= $_qt_loss_thresh`
- `>= 3` (loss debounce) → `>= $_qt_loss_debounce`
- Add `_qt_check_reload` call at the top of the function

**4.** Initial load: call `_qt_load` once after `_EVENTS_LOADED=1`. After that, only the reload flag triggers a re-read.

**Cost:**
- Cold path (no flag): one `[ -f ]` test per poller cycle (~every 2s) — sub-microsecond
- Warm path (flag present): one `jq` call + two `case` evaluations + `rm` — runs at most once per save

**Why a new flag (not `qmanager_ping_reload`):** Different consumer (poller's events module vs. Rust ping daemon). Crossing them couples two unrelated reload paths.

### Frontend — hook

**Path:** `hooks/use-quality-thresholds.ts`

Mirrors `hooks/use-ping-profile.ts` shape. Returns:

```ts
interface UseQualityThresholdsReturn {
  thresholds: QualityThresholdsSettings | undefined;
  isDefault: boolean;        // true until the user saves once (drives the muted upgrade hint)
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  save: (next: QualityThresholdsSettings) => Promise<QualityThresholdsResponse>;
}
```

GET on mount, optimistic update + silent refetch on save. After a successful save, the silent refetch updates `isDefault` to `false`, hiding the upgrade hint. No React Query — matches the existing `use-ping-profile.ts` pattern (`useState` + `useRef(mounted)`).

### Frontend — types

**Path:** `types/modem-status.ts` additions:

```ts
export type QualityPreset = "standard" | "tolerant" | "very-tolerant";

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  "standard", "tolerant", "very-tolerant",
] as const;

export interface QualityThresholdsSettings {
  latency: { preset: QualityPreset };
  loss:    { preset: QualityPreset };
}
```

## Migration & Defaults

**Fresh install:** `quality_thresholds.json` ships in `scripts/etc/qmanager/` with `tolerant`/`tolerant`. Installer copies to `/etc/qmanager/`.

**Upgrade from v0.1.x:** No `quality_thresholds.json` on disk until user touches the card. `_qt_load` is a no-op when the file is missing; in-memory defaults (`tolerant`) win.

**Behavior change is deliberate:**
- v0.1.x: hardcoded 90 ms / 20 % → 25 high_latency events/hour on test device
- v0.2.x post-upgrade default: 250 ms / 30 % → expected 0–2 events/hour on the same device

**Two non-negotiables:**

1. `RELEASE_NOTES.md` "New Features" entry must explicitly call out the default change. Suggested copy:

   > **Configurable Latency & Loss Thresholds** — Recent Activities no longer floods with `High Latency` events on average cellular signal. New System Settings card lets you pick `Standard / Tolerant / Very Tolerant` per row. **Default changes from 90 ms / 20 % to 250 ms / 30 %** — pick `Standard` if you want stricter thresholds.

2. Card UI shows a one-line muted hint under the active-preset blurb when the loaded preset is `tolerant` AND no config file exists yet (i.e. user hasn't saved). Hint text: *"Default after recent update — pick Standard for stricter thresholds."* The hint disappears the moment the user saves anything.

**Rollback policy:** Decision **A** — old defaults (90 ms / 20 %) are gone. `Standard` (150 ms / 15 %) is close-but-stricter. Rationale: the old defaults were wrong for the audience; preserving them as a chip would be preserving the bug.

## File Inventory

**New files (4):**

| Path | Purpose |
|---|---|
| `scripts/etc/qmanager/quality_thresholds.json` | Default config shipped to `/etc/qmanager/` on fresh installs |
| `scripts/www/cgi-bin/quecmanager/settings/quality_thresholds.sh` | CGI mirroring `ping_profile.sh` shape |
| `hooks/use-quality-thresholds.ts` | React hook mirroring `use-ping-profile.ts` |
| `components/system-settings/quality-thresholds-card.tsx` | The card |

**Modified files (4):**

| Path | Change |
|---|---|
| `scripts/usr/lib/qmanager/events.sh` | Three edits (config state, helpers, replace hardcoded literals) |
| `types/modem-status.ts` | Add `QualityPreset`, `QUALITY_PRESETS`, `QualityThresholdsSettings` |
| `app/system-settings/page.tsx` | Mount `<QualityThresholdsCard />` below `<ConnectivitySensitivityCard />` |
| `RELEASE_NOTES.md` | New Features bullet (default change disclosure) |

**Test files (2):**

| Path | Coverage |
|---|---|
| `scripts/test/quality-thresholds-cgi.sh` | GET default-fallback, POST happy path, per-preset validation errors, atomic-write integrity, reload-flag touched |
| `scripts/test/events-quality-thresholds.sh` | Source `events.sh`, fake `conn_latency`/`conn_packet_loss`, assert preset boundaries, assert reload-flag re-reads JSON |

**Verified out-of-scope:**
- `qmanager_poller` binary entry point — sources `events.sh`; no init changes needed (`_qt_load` runs at source-time)
- `qmanager_ping` Rust daemon — separate concern (presence vs. quality)
- Watchcat / SimFailover / `email_alerts.sh` / `sms_alerts.sh` — no consumers of `high_latency`/`high_packet_loss` events
- Discord bot — `/events` reads the events ring buffer; new event volume is lower, not different shape
- Installer — already glob-deploys CGI scripts and `scripts/etc/qmanager/` contents

## Wire Diagram

```
┌─ Browser ────────┐                ┌─ Modem ─────────────────────────────┐
│ Settings page    │                │                                     │
│                  │                │   /etc/qmanager/                    │
│ QualityCard      │ GET/POST CGI   │     quality_thresholds.json         │
│  └ useQuality─── │ ─────────────► │            ▲                        │
│       Thresholds │                │            │ atomic write           │
└──────────────────┘                │   quality_thresholds.sh ─touch─┐    │
                                    │                                ▼    │
                                    │   /tmp/qmanager_events_reload (flag)│
                                    │            ▲                        │
                                    │            │ checked once/cycle     │
                                    │   qmanager_poller                   │
                                    │     └─ events.sh ─ _qt_check_reload │
                                    │            ▲                        │
                                    │            └─ uses _qt_lat_thresh   │
                                    │                    _qt_loss_thresh  │
                                    └─────────────────────────────────────┘
```

## Deployment Ordering

No flag day required. New CGI script + `events.sh` edit + JSON config can ship in any sub-order during install:
- `_qt_load` is no-op on missing file
- CGI is no-op until called
- Frontend is no-op until rendered

## Testing Strategy

**Backend (shell):**
- CGI test mirrors `scripts/test/ping-profile-cgi.sh` — GET/POST/error path coverage with `QM_LIB_DIR` override
- Events test sources `events.sh` in isolation, fakes poller globals, asserts each preset boundary fires/silences correctly, asserts reload flag triggers re-read

**Frontend:**
- Manual UAT via the dev server: select each preset, save, verify backend writes, verify daemon picks up via reload flag, verify "Current" cell flips between ● and ⚠ glyphs at the threshold boundary
- Verify dirty-state Save button gating
- Verify light + dark mode parity
- Verify card placement directly under ConnectivitySensitivityCard on `/system-settings`

**Live device validation:**
- After deploying to test device (currently averaging 152 ms latency, 25 high_latency events/h on relaxed profile):
  - With default `tolerant` preset: confirm event count drops to 0–2/h over a 1h window
  - Switch to `Standard`: confirm event count rises (closer to old behavior)
  - Switch to `Very Tolerant`: confirm only sustained 500ms+ flapping fires events

## Open Decisions (Locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Card placement | Section 1: Separate card below `ConnectivitySensitivityCard` |
| 2 | Surfacing debounce | Bake into preset (visible in meta panel, not tunable) |
| 3 | Threshold mode | Absolute ms / % (not relative) |
| 4 | Include packet loss? | Yes — same card, second row |
| 5 | Preset count | 3 (Standard / Tolerant / Very Tolerant) |
| 6 | Default on fresh install | `tolerant` for both rows |
| 7 | Old-default preservation | A — gone; `Standard` is the strictest available |
