# Recent Activities (Dashboard Event Feed)

The Recent Activities card is the dashboard's window onto the poller's network event log: what the radio did, newest first. It does one thing the backend deliberately does not, which is decide whether anything on that list is *still* wrong. The event log is a flat transcript where "Internet Lost" reads exactly like "Internet Restored" two rows above it; the card pairs each degradation with the recovery that cancels it and gives a tonal container only to the degradations still standing. This doc covers the data path, the resolution-pairing model in `lib/event-presentation.ts`, the presentation contract the card renders from, and the invariants that are easy to break.

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Producer | `scripts/usr/lib/qmanager/events.sh` (sourced by `qmanager_poller`) |
| Backing file | `/tmp/qmanager_events.json` (NDJSON, one object per line, oldest first) |
| Ring-buffer cap | `MAX_EVENTS=50` (`scripts/usr/bin/qmanager_poller:111`) |
| CGI endpoint | `GET /cgi-bin/quecmanager/at_cmd/fetch_events.sh` (zero modem contact, RAM read only) |
| Hook | `hooks/use-recent-activities.ts` (10s poll, reverses to newest-first, keeps 20) |
| Presentation model | `lib/event-presentation.ts` (pure, no React) |
| Card | `components/dashboard/recent-activities.tsx` |
| Event types / severities | `types/modem-status.ts` (`NetworkEventType`, `EventSeverity`, `NetworkEvent`) |
| English label fallback | `constants/network-events.ts` (`EVENT_LABELS`) |
| i18n keys | `dashboard` namespace, `activities.*` subtree, all 5 locales |

## Data Path

```
events.sh  append_event()   -> /tmp/qmanager_events.json   (NDJSON, append + tail -n 50)
fetch_events.sh             -> JSON array, oldest first     (serve_ndjson_as_array)
useRecentActivities()       -> reverse() + slice(0, 20)     (newest first)
computeUnresolved(events)   -> Set<number> of indices       (full 20, never the sliced 6)
presentEvent(event, flag)   -> glyph + ink + sr-only key
```

`append_event` writes `{timestamp, type, message, severity}`, trims the file to the newest 50 lines, and mirrors the line into the poller log as `EVENT [<type>] <message>`. The CGI is a pure file read; nothing on this path touches an AT channel or takes the `/tmp/qmanager_at.lock`.

> ℹ️ NOTE: the same event log feeds `/monitoring` via `components/monitoring/network-events-card.tsx`. It has its own independent internet-lost detection and is not coupled to the Centralized Alerts engine, so a device can log a "connection lost" activity without dispatching any alert. See [alerts.md](alerts.md).

## The Unresolved-Condition Model

The card's container fill answers "is something wrong **right now**". The glyph answers "what happened". Those are two different questions and they are carried by two different channels on purpose.

### Why severity alone is not enough

`severity: "info"` in this system means *routine*, not *good*. `events.sh` emits `info` for LTE band change (`:498`), LTE PCC cell handoff (`:507`), NR band change (`:537`), NR PCC cell handoff (`:547`) and CA activation (`:557`). A handoff is the radio doing its job. Filling those rows with `success-container` would spend a functional color decoratively, which the Functional-Color Promise in `DESIGN.md` forbids.

Aging the list (fresh rows saturated, old rows greyed) fails for a different reason: wall-clock age is not the same as resolution, so a still-unrecovered failure greys out simply because time passed. It is also nearly invisible. Measured aged-vs-fresh luminance separation is 1.16:1 to 1.24:1, and dark-mode `success-container` against `destructive-container` measures about 1.00:1, meaning the two differ in hue only.

### Resolution pairing

`computeUnresolved(events)` classifies each event type into one of three shapes:

| Shape | Types | Recovery signal |
| ----- | ----- | --------------- |
| Cross-type condition (`RESOLVED_BY`) | `internet_lost`, `signal_lost`, `high_latency`, `high_packet_loss` | A **different** type appears later: `internet_restored`, `signal_restored`, `latency_recovered`, `packet_loss_recovered` |
| Self-resolving condition (`SELF_RESOLVING`) | `nr_anchor`, `ca_change`, `airplane_mode` | The **same** type appears later at severity `info`. These describe a property that flipped, so the poller reuses one type and lets severity carry the direction |
| One-shot notice | everything else (`tower_failover`, `sim_failover`, `sim_swap_detected`, `profile_deactivated`, `profile_failed`, `watchcat_recovery`, `network_mode`, `band_change`, `pci_change`, `scc_pci_change`, `profile_applied`, and the four `*_restored` / `*_recovered` types) | None. A one-shot describes a moment that has already passed, so it can never be unresolved and must never light a container |

The pass is a single forward walk over the newest-first array with three accumulators:

- `laterTypes` : every type already visited, i.e. strictly later in time.
- `laterInfoTypes` : types visited later at severity `info`, the recovery half of a self-resolver.
- `laterDegradations` : `type|severity` pairs visited later. This is what makes three stacked "Internet Lost" rows light exactly **one** container: the older two are superseded by the newer firing of the same pair.

Newest-first ordering is what makes one pass sufficient. Walking down from index 0, everything already visited is later in time, which is exactly the window a resolution has to appear in.

> ⚠️ WARNING: `computeUnresolved` must be given the hook's **full** array (up to 20), not the six rows the card draws. A recovery that has already scrolled past the clip edge still resolves the failure below it. Slicing first would leave resolved rows glowing amber forever.

The pairing lives in the client rather than in `events.sh` because it is a *reading* of the log, not a fact about the radio. `status.json` and the NDJSON stay a faithful transcript, and the interpretation can change without an OTA.

### Glyph and ink

`presentEvent(event, unresolved)` returns `{glyph, glyphTone, srSeverityKey, unresolved}`. It resolves severity first, family second:

| Condition | Glyph | Ink | sr-only word |
| --------- | ----- | --- | ------------ |
| `severity === "error"` | `XCircleIcon` | `text-destructive` | Error |
| `severity === "warning"` | `TriangleAlertIcon` | `text-warning` | Warning |
| info **and** in `RECOVERY_TYPES` | `CheckCircle2Icon` | `text-success` | Recovered |
| info, family mapped | `ArrowLeftRightIcon` handoff, `RadioTowerIcon` radio, `MicrochipIcon` SIM, `IdCardIcon` profile | `text-on-surface-variant` | Routine |
| info, unmapped | `InfoIcon` | `text-on-surface-variant` | Routine |

`RECOVERY_TYPES` is deliberately narrower than "severity info": it is the info events that report something going *right* (`internet_restored`, `signal_restored`, `latency_recovered`, `packet_loss_recovered`, `watchcat_recovery`, `profile_applied`), not everything that merely changed. A band change does not earn a green check.

An unresolved row drops its per-glyph ink and inherits the container's `on-` color, because the fill has already said "this is a problem" and a second differently-toned voice inside it would read as two statements. Its `srSeverityKey` is overridden to `activities.severity.unresolved`, since the row is describing a present condition, not a past severity.

The `sr-only` severity word is rendered **before** the label. The glyph is the sole visual carrier of severity, a screen reader cannot see a shape, and the two containers are near-equiluminant in dark mode, so the word is the only accessible path to the same information.

### Where `error` actually comes from

`events.sh` itself only ever passes `info` or `warning`. Six live call sites in other scripts that source it *do* emit `error`:

| Script | Line | Type |
| ------ | ---- | ---- |
| `qmanager_profile_apply` | 702 | `profile_failed` |
| `qmanager_watchcat` | 468, 483 | `sim_failover` |
| `qmanager_watchcat` | 512, 528, 596 | `watchcat_recovery` |

All three of those types are **one-shot notices**, so an error event renders as a red `XCircleIcon` on a neutral `bg-surface-container`, never as a `destructive-container` fill. The `unresolvedError` branch in `EventRow` (and the `error` chip tone) is therefore forward-compatible plumbing: it becomes reachable only if a type in `RESOLVED_BY` or `SELF_RESOLVING` is ever emitted at `error`. Keep it, but do not design the card around red being a common sight.

## Card Behavior

### Header chip

A single filled chip reports the verdict: `muted` + `CheckCircle2Icon` + "All clear" when `unresolved.size === 0`, otherwise `warning` (or `destructive` if any unresolved row is `error`) + the count.

The chip is **hidden while loading and on the no-data error path**. "All clear" computed from an empty array is the Saved-State Honesty Rule's exact failure case: a surface claiming a state the device never reported. Loading renders a pill-shaped `Skeleton` at the chip's own geometry so the header does not reflow; the error path renders nothing, because the alert below already says the true thing.

### States

| State | Render |
| ----- | ------ |
| `isLoading` | Six skeleton rows at the exact `ROW_H` of a real row, so the skeleton-to-data handoff moves nothing |
| `error && events.length === 0` | `role="alert"` `destructive-container` panel carrying the raw error string (the HTTP status is the only thing that distinguishes a dead service from an expired session) |
| `error && events.length > 0` | Compact `destructive-container` notice **above** a still-populated list. A stale list beats a blank card |
| `events.length === 0` | `Empty` with `CalendarX2Icon` |
| otherwise | The list |

> ⚠️ WARNING: the card previously destructured only `{events, isLoading}` and dropped the hook's `error`, so a failed poll rendered as the reassuring "No Events" empty state. Any future edit to this component must keep the error branches distinct from the empty branch.

### Row geometry

The clip height is arithmetic, not a guess, and the constants at the top of the component show the work:

```
ROW_H       = 60   // py-[11px] (22) + label leading-4 (16) + gap-0.5 (2) + message leading-5 (20)
ROW_GAP     = 8    // gap-2
ROW_ADVANCE = 68   // how far the history travels when a new head pushes it down
LIST_MAX_H  = 400  // 6 * ROW_H + 5 * ROW_GAP
RENDER_COUNT= 7    // six visible plus one that exists only to be pushed into the clip
```

Line heights are pinned rather than left implicit because a clip edge computed from a ratio drifts. `leading-4` and `leading-5` are already the ramp's defaults for `text-xs` and `text-sm`, so pinning them changes nothing visually and makes the sum checkable.

Type sizes stay on the documented ramp (`text-xs` / `text-sm`) rather than the 11px/13px pair. `DESIGN.md` does name both, but as surface-scoped exceptions (11px is the sidebar's uppercase section label, 13px is one of the SIM-swap banner's own steps). Spending them here would extend a scoped exception to a third surface to buy 24px of height, which is not worth a standing detector waiver.

## Motion

Two animations total, against a per-surface budget of three, on an ARM32 SoC rendering its own UI.

1. **Head row arrival.** When a genuinely new event lands, the head row enters `x: 24 → 0` on the `emphasized` curve. On first load there is no previous head, so it instead enters on `staggerRowItem`'s shape and curve as item 0 of the mount cascade, which stops it popping in while the rows below it rise.
2. **History push.** Everything below the head moves as ONE transform (`y: -ROW_ADVANCE → 0`). Six per-row FLIP projections via `layout` would be six concurrent animations.

Nothing animates out. A seventh row is rendered into an `overflow-hidden` box sized for six, so row six slides under the clip edge instead of vanishing.

**The three-state variant set is load-bearing.** The history group carries both lifecycles on one element via `historyGroup`: `settled` (mount entry, no push, children cascade), `pushed` (arrival entry, group starts one row high) and `visible` (the shared rest state, which also declares `staggerChildren`). It cannot be split into a push wrapper around a cascade wrapper, because **a motion child that declares its own `initial`/`animate` object stops variant propagation dead**. On the arrival path the children's initial state is `pushed`, a variant they do not define, so they sit at rest and the cascade stays a mount-only event. `delayChildren: STAGGER_STEP_ROWS` compensates for the head row being item 0 of the cascade while living outside the group.

"Genuinely new head" is read off a ref committed **after** render (`previousHeadKey`), so a render React throws away can never arm the arrival animation. Same discipline as the carrier-aggregation release clock.

## React Keys

`eventKey(e)` returns `` `${e.timestamp}-${e.type}-${e.message}` ``.

Both remaining parts are load-bearing:

- **The index is gone.** The old key was `` `${timestamp}-${type}-${i}` ``. On a newest-first list one new event shifts every index, so all six keys changed, all six rows remounted, and the entire cascade replayed on every single event.
- **The message stays.** `events.sh` emits type `pci_change` from two separate sites (LTE handoff at `:507`, NR handoff at `:547`), so an LTE and an NR handoff detected in the same poll tick share a timestamp **and** a type. Timestamp + type alone would collide.

## i18n

All card copy is keyed under the `dashboard` namespace, `activities.*`, at 100% parity across `en`, `zh-CN`, `zh-TW`, `it`, `id`:

| Key | Purpose |
| --- | ------- |
| `activities.error_title`, `activities.error_description` | Error panel and inline notice. `error_description` interpolates `{{message}}` |
| `activities.chip.quiet`, `activities.chip.unresolved_one` / `_other` | Header chip |
| `activities.severity.{routine,recovered,warning,error,unresolved}` | The `sr-only` word |
| `activities.time.{just_now,minutes_*,hours_*,days_*}` | Relative timestamps |
| `activities.events.<type>` | Row label, one key per `NetworkEventType` member (22 total) |

Two deliberate non-changes:

- **`constants/network-events.ts` was not modified.** `EVENT_LABELS` is retained as the `defaultValue` passed to `t()`, so an untranslated or newly added type degrades to its English label rather than rendering a raw key, and `components/monitoring/network-events-card.tsx` plus `components/monitoring/watchdog/watchdog-recovery-activity-card.tsx` keep working untouched.
- **`formatTimeAgo` in `types/modem-status.ts` was not modified.** It has three live call sites in `watchdog-status-card.tsx` and returns a hard-coded English string by design. The card carries a local `useTimeAgo()` hook whose thresholds (60s, 3600s, 86400s) mirror it exactly, so the two can never disagree about when "1h ago" starts.

Adding a new `NetworkEventType` therefore means: extend the union in `types/modem-status.ts`, add the English label to `EVENT_LABELS`, and add `activities.events.<type>` to all five locale files. Classify it in `lib/event-presentation.ts` only if it is a condition rather than a one-shot.

## Gotchas

- **Never slice before `computeUnresolved`.** See the warning above.
- **Never light a container from severity alone.** `warning` on a one-shot type (`tower_failover`, `sim_failover`) is history the moment it is written. Only `RESOLVED_BY` and `SELF_RESOLVING` members can be unresolved.
- **`watchcat_recovery` is in `RECOVERY_TYPES` but is never emitted at `info`.** All five call sites in `qmanager_watchcat` pass `warning` or `error`, and severity wins in `presentEvent`, so its green-check branch is currently unreachable. Intended, not a bug: the entry is there so a future "recovery succeeded" line reads correctly. `profile_applied` is the same shape in reverse, emitted at `info` for a complete apply and `warning` for a partial one.
- **The NDJSON file lives in `/tmp` and does not survive a reboot.** An empty card after a restart is correct, not a fault.
- **`MAX_EVENTS=50` on the device vs. `maxEvents=20` in the hook.** The resolution pass sees 20. A degradation whose recovery is more than 20 events old will still be flagged unresolved; in practice a recovery follows its degradation closely enough that this has not been observed, but it is the model's outer limit.

## See Also

- [alerts.md](alerts.md): the Centralized Alerts engine, which dispatches independently of this feed
- [connection-quality.md](connection-quality.md): the producer of `high_latency` / `high_packet_loss` and their thresholds
- [connection-watchdog.md](connection-watchdog.md): the producer of `watchcat_recovery` and `sim_failover`
- [carrier-aggregation.md](carrier-aggregation.md): the sibling dashboard surface whose release clock uses the same commit-after-render ref discipline
- `DESIGN.md`: the Unresolved-Condition Rule, the Functional-Color Promise, the Saved-State Honesty Rule, and the motion canon
