# Recent Activities (Dashboard Event Feed)

The Recent Activities card is the dashboard's window onto the poller's network event log: what the radio did, newest first. It does one thing the backend deliberately does not, which is decide whether anything on that list is *still* wrong. The event log is a flat transcript where "Internet Lost" reads exactly like "Internet Restored" two rows above it; the card gives every row a **tone** (what kind of thing happened) and then decides its **weight** (how loudly to draw it) from age, with unresolved conditions exempt from ageing out. This doc covers the data path, the tone and resolution-pairing model in `lib/event-presentation.ts`, the presentation contract the card renders from, and the invariants that are easy to break.

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
| Rows shown | `VISIBLE_ROWS = 5` (the only number to change; everything else derives) |
| Tonal window | `FRESH_WINDOW_SEC = 3600` (one hour) |
| Clock tick | `CLOCK_TICK_MS = 30_000`, independent of the 10s data poll |

## Data Path

```
events.sh  append_event()   -> /tmp/qmanager_events.json   (NDJSON, append + tail -n 50)
fetch_events.sh             -> JSON array, oldest first     (serve_ndjson_as_array)
useRecentActivities()       -> reverse() + slice(0, 20)     (newest first)
computeUnresolved(events)   -> Set<number> of indices       (full 20, never the sliced 5)
isFresh(event, nowSec)      -> boolean                      (now - timestamp < 3600)
presentEvent(ev, unres, fr) -> glyph + tone + 4 class slots + sr-only key
```

`append_event` writes `{timestamp, type, message, severity}`, trims the file to the newest 50 lines, and mirrors the line into the poller log as `EVENT [<type>] <message>`. The CGI is a pure file read; nothing on this path touches an AT channel or takes the `/tmp/qmanager_at.lock`.

> ℹ️ NOTE: the same event log feeds `/monitoring` via `components/monitoring/network-events-card.tsx`. It has its own independent internet-lost detection and is not coupled to the Centralized Alerts engine, so a device can log a "connection lost" activity without dispatching any alert. See [alerts.md](alerts.md).

## The Age-Gated Tone Model

This is the reference implementation of `DESIGN.md`'s **Age-Gated Tone Rule**. Two axes, independent, and confusing them is the standard failure:

| Axis | Question | Carried by | Expires? |
| ---- | -------- | ---------- | -------- |
| **Tone** | What KIND of thing happened | The icon disc, plus the container fill while the row has one | No. It is a fact about the event |
| **Weight** | How much the row still deserves attention | Whether the row gets a tonal container at all | Yes, after one hour, unless the row is unresolved |

A row is drawn **tonal** when it is `fresh || unresolved`. Otherwise it settles onto `bg-surface-container` and keeps its full-strength icon disc: three recent rows in their role containers, and a row an hour old sitting on the plain surface with its green check still green.

> ℹ️ NOTE: tone used to be carried by a **bare glyph** tinted with a `GLYPH_INK` role color. It is now carried by a **filled disc** in the solid role color (see Row anatomy). This strengthened the rule rather than changing it: an aged row's only surviving tone signal went from a ~20px colored outline to a 28px saturated fill, so the settle now reads as the row going quiet rather than as the row half-disappearing.

### Why the gate is an OR, not an AND

Freshness decides the common case; resolution is the safety valve underneath it. A degradation nobody has recovered from must never quietly fade to grey just because an hour passed, because the alternative is a live outage rendered in the same grey as a band change from last Tuesday. Age may retire history. It may not retire a problem.

This is also why the earlier resolution-only model was replaced rather than extended: it was correct about the safety valve and wrong about the common case. Under it, a failure and its recovery from four minutes ago both rendered as flat grey history, so the card had no way to say "this just happened".

### The tones and their fills

`EventTone` is derived severity-first, family second:

| Tone | Derived from | Tonal fill (`TONAL_FILL`) | Icon disc (`DISC_FILL`) |
| ---- | ------------ | ------------------------- | ----------------------- |
| `error` | `severity === "error"` | `bg-destructive-container text-on-destructive-container` | `bg-destructive text-destructive-foreground` |
| `warning` | `severity === "warning"` | `bg-warning-container text-on-warning-container` | `bg-warning text-warning-foreground` |
| `success` | info **and** in `RECOVERY_TYPES` | `bg-success-container text-on-success-container` | `bg-success text-success-foreground` |
| `routine` | everything else | `bg-surface-container-high` (**achromatic**, no `on-` pair) | see `routineDisc` below |

The three chromatic fills ship their own paired `on-` ink, so a row using them sets **no** per-line color at all: `presentEvent` returns an empty `messageClass` on a chromatic row. A second, differently toned voice inside the fill would read as two statements rather than one.

The disc column is the one that does **not** consult the age gate. A chromatic tone gets its solid role fill whether the row is fresh or settled, which is the whole rule in one line: the row stops competing for attention, the event does not stop having been a warning.

#### The routine disc

`routine` has no solid role color to spend, so its disc is defined by its **relationship** to the row rather than by a color, via `routineDisc(tonal)`:

| Row state | Row fill | Disc fill | Direction |
| --------- | -------- | --------- | --------- |
| fresh | `bg-surface-container-high` | `bg-surface-container` | one step **down** |
| settled | `bg-surface-container` | `bg-surface-container-high` | one step **up** |

The reference draws the recessed-well version (down), which reads as *present, not announcing itself* — correct for routine. A settled row has already spent that step, so stepping down again lands on `surface`, i.e. the card itself, and the disc vanishes. Flipping direction preserves the magnitude (one step, ~0.034 L in both themes) so the disc stays a soft halo either way. Measured disc-vs-row separation is 1.11:1 light / 1.19:1 dark — deliberately near-invisible, because the disc carries no information here. The **glyph** does, and `on-surface-variant` measures 6.2:1 to 7.8:1 against every surface in the chain.

### Why `routine` is achromatic

This is the one place the design reference had to be extrapolated rather than traced: it shows no fresh routine row, so there was no literal answer to copy. Both colored options were worse than a neutral step.

`success-container` would claim a band change is good news. It is not news at all. `severity: "info"` in this system means *routine*, not *good*: `events.sh` emits `info` for LTE band change (`:498`), LTE PCC cell handoff (`:507`), NR band change (`:537`), NR PCC cell handoff (`:547`) and CA activation (`:557`). A handoff is the radio doing its job, and tinting it green would spend a functional color decoratively, which the Functional-Color Promise forbids.

`primary-container` measures **L 0.400** in dark mode against **0.300 / 0.320 / 0.325** for success / warning / destructive. A routine handoff would be the brightest row on the card, louder than an outage. Inverted urgency.

`surface-container-high` (L 0.918 light, 0.312 dark) is a step up from the resting surface without making a color claim, which is exactly the reading: noted, recent, not important. It is also already the shipped meaning of the `muted` badge role, so the vocabulary stays consistent across the product.

**This decision is what keeps the card quiet.** A live device probe of the 50-event ring found **48 of 50 events at `info` severity and 44 of 50 of type `band_change`**, with the whole ring spanning roughly 750 seconds of wall clock. If routine were chromatic, the overwhelmingly common case would be a wall of color and the rare chromatic fills would mean nothing.

### Why the fill is the weak channel

The fill is a supporting signal, never the only one. Measured aged-vs-fresh luminance separation is 1.16:1 to 1.24:1, and dark-mode `success-container` against `destructive-container` measures about 1.00:1, meaning the two differ in **hue only** and are identical under deuteranopia. Consequences, both mandatory:

- Every row carries a glyph, and two states that can occupy the same slot must never share one.
- Every row carries an `sr-only` severity word spoken **before** the label, since a screen reader can see neither a shape nor a background.

### Freshness and the clock

`isFresh(event, nowSec)` is `nowSec - event.timestamp < FRESH_WINDOW_SEC` (3600). One hour comes straight from the design reference, where a 16-minute row is filled and a 1h03m row is not.

This subtracts a browser clock from a modem-written `date +%s` (`events.sh:84`), which is a cross-machine comparison and can skew. That is accepted deliberately, because it is the **same** subtraction that already prints "2 min ago" beside the row: the fill and the timestamp can only ever be wrong together and consistently. A freshness gate computed some other way would be the real hazard, two clocks disagreeing inside one row.

Three pieces of discipline hold that together:

1. **One clock reading per render.** `useTimeAgo(timestamp, nowSec)` takes `nowSec` as a parameter rather than calling `Date.now()` itself. Two readings in one render can straddle the hour boundary and print "1h ago" on a row still drawn as fresh.
2. **A negative-diff clamp.** `Math.max(0, nowSec - timestamp)`. On a device whose RTC is unset and which runs neither NTP nor NITZ, the difference can legitimately come out negative. `types/modem-status.ts:769` carries the same clamp; the local hook previously claimed to mirror those thresholds "exactly" while missing precisely this branch.
3. **An independent ticker.** `useNowSec()` re-reads the wall clock every `CLOCK_TICK_MS` (30s), not on the data poll. The hook's error path calls `setError` and deliberately never calls `setEvents` (`use-recent-activities.ts:85-90`), and on a sustained failure the message string is identical every time, so React bails out of the re-render entirely. Without the ticker the card would go on rendering its stale list with a frozen age classification: rows asserting "just now" about data that has not refreshed in an hour, which is the Saved-State Honesty Rule failure the header chip is already careful to avoid. 30s rather than 10s because nothing here changes faster than a minute and an idle dashboard should not wake three times as often as it needs to.

### Resolution pairing

`computeUnresolved(events)` classifies each event type into one of three shapes:

| Shape | Types | Recovery signal |
| ----- | ----- | --------------- |
| Cross-type condition (`RESOLVED_BY`) | `internet_lost`, `signal_lost`, `high_latency`, `high_packet_loss` | A **different** type appears later: `internet_restored`, `signal_restored`, `latency_recovered`, `packet_loss_recovered` |
| Self-resolving condition (`SELF_RESOLVING`) | `nr_anchor`, `ca_change`, `airplane_mode` | The **same** type appears later at severity `info`. These describe a property that flipped, so the poller reuses one type and lets severity carry the direction |
| One-shot notice | everything else (`tower_failover`, `sim_failover`, `sim_swap_detected`, `profile_deactivated`, `profile_failed`, `watchcat_recovery`, `network_mode`, `band_change`, `pci_change`, `scc_pci_change`, `profile_applied`, and the four `*_restored` / `*_recovered` types) | None. A one-shot describes a moment that has already passed, so it can never be unresolved |

> ℹ️ NOTE: a one-shot **can** still be tonal. That is what the age gate changed. A one-shot wears its container for its first hour and then settles; what `unresolved` buys a row is exemption from that settling, and only a condition can earn it.

The pass is a single forward walk over the newest-first array with three accumulators:

- `laterTypes` : every type already visited, i.e. strictly later in time.
- `laterInfoTypes` : types visited later at severity `info`, the recovery half of a self-resolver.
- `laterDegradations` : `type|severity` pairs visited later. This is what makes three stacked "Internet Lost" rows light exactly **one** container: the older two are superseded by the newer firing of the same pair.

Newest-first ordering is what makes one pass sufficient. Walking down from index 0, everything already visited is later in time, which is exactly the window a resolution has to appear in.

> ⚠️ WARNING: `computeUnresolved` must be given the hook's **full** array (up to 20), not the five rows the card draws. A recovery that has already scrolled past the clip edge still resolves the failure below it. Slicing first would leave resolved rows glowing amber forever. The visible count shrinking from six to five makes this **more** load-bearing, not less: there is now one fewer row of headroom before a recovery falls past the clip edge.

The pairing lives in the client rather than in `events.sh` because it is a *reading* of the log, not a fact about the radio. `status.json` and the NDJSON stay a faithful transcript, and the interpretation can change without an OTA.

### The presentation contract

`presentEvent(event, unresolved, fresh)` returns exactly this, and nothing the caller already knows:

```ts
interface EventPresentation {
  glyph: EventGlyph;        // which lucide icon
  tone: EventTone;          // the semantic classification
  containerClass: string;   // fill, plus paired `on-` ink when chromatic
  discClass: string;        // disc fill + its paired glyph ink. never ""
  messageClass: string;     // "" when the container supplies the ink
  metaClass: string;        // ink (or `opacity-90`) for the timestamp caption
  srSeverityKey: string;    // i18n key under the `dashboard` namespace
}
```

> ⚠️ WARNING: the class slots **inverted** when the row was retargeted to the Motion Guide anatomy. `labelClass` (an event-type line *above* the message) and `glyphClass` (a bare icon) are both gone. `metaClass` replaces the first and styles the timestamp caption *below* the message; `discClass` replaces the second and folds the glyph's ink into the disc, because the disc and the glyph inside it are one paired decision, never two.
>
> An earlier pass had already changed `presentEvent(event, unresolved)` → `presentEvent(event, unresolved, fresh)` and dropped `glyphTone` plus the `tonal` / `unresolved` echo fields. That signature is unchanged here; only the returned slots moved.

Glyph selection is severity first, family second:

| Condition | Glyph | sr-only word |
| --------- | ----- | ------------ |
| tone `error` | `XCircleIcon` | Error |
| tone `warning` | `TriangleAlertIcon` | Warning |
| tone `success` (info **and** in `RECOVERY_TYPES`) | `CheckCircle2Icon` | Recovered |
| tone `routine`, family mapped (`FAMILY_GLYPHS`) | `ArrowLeftRightIcon` handoff, `RadioTowerIcon` radio, `MicrochipIcon` SIM, `IdCardIcon` profile | Routine |
| tone `routine`, unmapped | `InfoIcon` | Routine |

`RECOVERY_TYPES` is deliberately narrower than "severity info": it is the info events that report something going *right* (`internet_restored`, `signal_restored`, `latency_recovered`, `packet_loss_recovered`, `watchcat_recovery`, `profile_applied`), not everything that merely changed. A band change does not earn a green check.

`srSeverityKey` is overridden to `activities.severity.unresolved` on an unresolved row, since the row is describing a present condition, not a past severity. It is rendered **before** the label.

### Where `error` actually comes from

`events.sh` itself only ever passes `info` or `warning`. Six live call sites in other scripts that source it *do* emit `error`:

| Script | Line | Type |
| ------ | ---- | ---- |
| `qmanager_profile_apply` | 702 | `profile_failed` |
| `qmanager_watchcat` | 468, 483 | `sim_failover` |
| `qmanager_watchcat` | 512, 528, 596 | `watchcat_recovery` |

Grepping `events.sh` alone reports zero `error` events and is misleading. All three of those types are **one-shot notices**, so none of them can ever be `unresolved`.

**Under the age gate the red fill is now reachable, which it was not before.** An error-severity one-shot is drawn in `destructive-container` for its first hour and then settles to a red `XCircleIcon` on the plain `bg-surface-container`. Previously only unresolved rows were ever filled, and since no error-emitting type enters `RESOLVED_BY` or `SELF_RESOLVING`, that branch was unreachable plumbing. Note the header chip's `destructive` tone is a *separate* question: it still keys off unresolved rows only, so a fresh red row can coexist with an "All clear" chip. That pair is intended, and reads as a story rather than a contradiction because the recovery sits directly above the failure it cancelled.

Red is still not a common sight on a healthy device. Do not design the card around it.

## Card Behavior

### Header chip

A single filled chip reports the verdict: `muted` + `CheckCircle2Icon` + "All clear" when `unresolved.size === 0`, otherwise `warning` (or `destructive` if any unresolved row is `error`) + the count.

The chip is **hidden while loading and on the no-data error path**. "All clear" computed from an empty array is the Saved-State Honesty Rule's exact failure case: a surface claiming a state the device never reported. Loading renders a pill-shaped `Skeleton` at the chip's own geometry so the header does not reflow; the error path renders nothing, because the alert below already says the true thing.

### States

| State | Render |
| ----- | ------ |
| `isLoading` | `VISIBLE_ROWS` skeleton rows at the exact `ROW_H` of a real row, so the skeleton-to-data handoff moves nothing |
| `error && events.length === 0` | `role="alert"` `destructive-container` panel carrying the raw error string (the HTTP status is the only thing that distinguishes a dead service from an expired session) |
| `error && events.length > 0` | Compact `destructive-container` notice **above** a still-populated list. A stale list beats a blank card |
| `events.length === 0` | `Empty` with `CalendarX2Icon` |
| otherwise | The list |

> ⚠️ WARNING: the card previously destructured only `{events, isLoading}` and dropped the hook's `error`, so a failed poll rendered as the reassuring "No Events" empty state. Any future edit to this component must keep the error branches distinct from the empty branch.

### Row anatomy

The row is the Motion Guide's **recipe 04 (Alert arrival)**, not the `Recommended Hybrid` treatment the first pass drew:

```
[ disc 28px ]  gap-3   Internet lost on rmnet_data0   <- text-sm leading-5 font-medium
                       3d ago                          <- font-mono text-xs leading-4
```

| Element | Class | Note |
| ------- | ----- | ---- |
| Row | `flex items-center gap-3 rounded-tile px-3.5 py-[11px]` | `items-center`, not `items-start`: the disc is a self-contained object, not a mark belonging to the first line. At `items-start` it reads as a bullet |
| Disc | `grid size-7 shrink-0 place-items-center rounded-full` + `discClass` | 16px glyph in a 28px disc holds the reference's 0.58 ratio on values the spacing scale already owns |
| Message | `truncate text-sm leading-5 font-medium` + `messageClass` | The primary line. `truncate` is what makes `ROW_H` strictly true; without it a long message wraps and breaks the clip arithmetic |
| Caption | `font-mono text-xs leading-4 tabular-nums` + `metaClass` | Timestamp only |

**The event-type label is gone by decision.** The message already names what happened and the disc already names its kind, so "Carrier Aggregation" above "NR-CA active: n78 + n41" was the row saying the same thing twice at two type sizes. The `activities.events.*` keys stay in the locale files: they are parity-clean, unreferenced by this card, and the natural home for them is the Monitoring events page, which still renders the untranslated `EVENT_LABELS` map.

> ℹ️ NOTE: the reference draws 12px over 10px. Those are **tile-scale figures, not a spec** — the Motion Guide's demo tiles run a smaller scale than the dashboard mock throughout (26px card radius against the dashboard's 36px). Taking them literally would put a 10px size into the product, two steps below the sidebar's already-scoped 11px exception, to render the one line a user squints at. The ramp keeps the reference's *hierarchy* — message dominant, caption subordinate and in the machine voice — at sizes the product already owns.

The mono caption sits at the edge of the **Machine-Voice Rule**: a modem-written relative time is device-clock output, but "2 min ago" is also prose. It is spent here because it is the cheapest way to make the caption unmistakably a different *kind* of line from the message above it without another color or another size step.

#### Measured contrast

Both themes, `presentEvent` output rendered against real surfaces:

| | light | dark |
| --- | ----- | ---- |
| Message / row | 9.25 – 16.04 | 9.33 – 13.74 |
| Caption / row (incl. `opacity-90`) | 6.22 – 8.44 | 6.52 – 8.69 |
| Glyph / disc | 4.15 – 6.89 | 3.86 – 10.60 |
| Disc / row, chromatic | 3.15 – 4.72 | 3.26 – 9.87 |

`metaClass` uses `opacity-90` on a chromatic row, not the reference's 75%: at 75% the caption falls to roughly 3.5:1 against its own container, under the 4.5:1 floor. Size, weight and the mono voice already do most of the recession.

> ⚠️ WARNING: **dark-mode `error` discs are the weakest link at 3.26:1** against their container, where `warning` and `success` measure 8.15 and 7.94. This is a token asymmetry, not a bug in this card: dark `--destructive` is L 0.62 while `--warning` and `--success` were lightened to 0.865 and 0.82. It clears the 3:1 non-text floor, but it means the most urgent row has the least-separated disc. Light mode is symmetric (3.15 – 3.81 across all three). Fixing it means touching a global role token, which is out of scope for this card.

### Row geometry

The clip height is arithmetic, not a guess, and the constants at the top of the component show the work:

```
ROW_H        = 60  // py-[11px] (22) + message leading-5 (20) + gap-0.5 (2) + caption leading-4 (16)
ROW_GAP      = 8   // gap-2
ROW_ADVANCE  = 68  // how far the history travels when a new head pushes it down
VISIBLE_ROWS = 5   // the only number to change if the count moves again
LIST_MAX_H   = 332 // VISIBLE_ROWS * ROW_H + (VISIBLE_ROWS - 1) * ROW_GAP
RENDER_COUNT = 6   // VISIBLE_ROWS + 1: one row that exists only to be pushed into the clip
```

`RENDER_COUNT` must stay exactly `VISIBLE_ROWS + 1`. With no spare row the bottom row is pulled into view at the start of the push and then vanishes at the end, instead of sliding under the edge.

> ⚠️ WARNING: `ActivitiesSkeleton` derives its row count from `VISIBLE_ROWS` and must keep doing so. As a literal it already silently outlived one change to the row count: a six-row skeleton handing off to a five-row list drops the card 68px and drags every grid sibling below it up with it.

Line heights are pinned rather than left implicit because a clip edge computed from a ratio drifts. `leading-4` and `leading-5` are already the ramp's defaults for `text-xs` and `text-sm`, so pinning them changes nothing visually and makes the sum checkable.

Type sizes stay on the documented ramp (`text-xs` / `text-sm`) rather than the 11px/13px pair. `DESIGN.md` does name both, but as surface-scoped exceptions (11px is the sidebar's uppercase section label, 13px is one of the SIM-swap banner's own steps). Spending them here would extend a scoped exception to a third surface to buy 24px of height, which is not worth a standing detector waiver.

> ℹ️ NOTE: **60px survived the recipe-04 retarget unchanged**, which is deliberate rather than lucky. The two lines swapped roles but kept their sizes, so `LIST_MAX_H`, `ROW_ADVANCE`, the clip edge and the skeleton all stayed valid and the card did not change height against its two grid siblings. Verified at 60.00px on all ten rendered tone × age combinations.

## Motion

Two animations total, against a per-surface budget of three, on an ARM32 SoC rendering its own UI.

1. **Head row arrival.** When a genuinely new event lands, the head row enters `x: "100%" → 0` on the `emphasized` curve — it genuinely arrives from off the trailing edge, which is what the reference draws and what the recipe is named for. On first load there is no previous head, so it instead enters on `staggerRowItem`'s shape and curve as item 0 of the mount cascade, which stops it popping in while the rows below it rise.

   > ⚠️ WARNING: this was `x: 24` for one release. Safe, and wrong. A 24px offset on a ~375px row is 6% travel, which the eye reads as a jitter rather than an arrival, and this is the one moment on the dashboard allowed to be *felt* before it is read. Percent rather than pixels so it stays a full entrance when the dashboard grid collapses to one column. Measured: 374px of travel, 79% of it covered in the first ~100ms and the last 21% spent settling over ~300ms, which is the `emphasized` curve's whole character. The list clip is `overflow-hidden` on **both** axes, so the offscreen half never widens the page — verified at 0px document overflow on every frame.
2. **History push.** Everything below the head moves as ONE transform (`y: -ROW_ADVANCE → 0`). Five per-row FLIP projections via `layout` would be five concurrent animations.

Nothing animates out. A sixth row is rendered into an `overflow-hidden` box sized for five, so row five slides under the clip edge instead of vanishing.

The settle from tonal to neutral is not counted against that budget: it is a `transition-colors` on the `standard` curve, not a keyframed animation. It is the only thing on this card that happens without the user or the radio doing anything, so it gets the everyday curve and no more. It must read as a row going quiet, never as an event arriving.

**The three-state variant set is load-bearing.** The history group carries both lifecycles on one element via `historyGroup`: `settled` (mount entry, no push, children cascade), `pushed` (arrival entry, group starts one row high) and `visible` (the shared rest state, which also declares `staggerChildren`). It cannot be split into a push wrapper around a cascade wrapper, because **a motion child that declares its own `initial`/`animate` object stops variant propagation dead**. On the arrival path the children's initial state is `pushed`, a variant they do not define, so they sit at rest and the cascade stays a mount-only event. `delayChildren: STAGGER_STEP_ROWS` compensates for the head row being item 0 of the cascade while living outside the group.

"Genuinely new head" is read off a ref committed **after** render (`previousHeadKey`), so a render React throws away can never arm the arrival animation. Same discipline as the carrier-aggregation release clock.

## React Keys

`eventKey(e)` returns `` `${e.timestamp}-${e.type}-${e.message}` ``.

Both remaining parts are load-bearing:

- **The index is gone.** The old key was `` `${timestamp}-${type}-${i}` ``. On a newest-first list one new event shifts every index, so every key changed, every row remounted, and the entire cascade replayed on every single event.
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
- **Never derive `unresolved` from severity alone.** `warning` on a one-shot type (`tower_failover`, `sim_failover`) is history the moment it is written. Only `RESOLVED_BY` and `SELF_RESOLVING` members can be unresolved. A one-shot may still be *tonal*, but only for its first hour, and only via `fresh`.
- **Never add a chromatic fill for `routine`.** See "Why `routine` is achromatic". A green or blue routine row breaks the Functional-Color Promise or inverts urgency, and 44 of 50 buffered events on a live device were routine band changes.
- **Change `VISIBLE_ROWS`, never the numbers derived from it.** `LIST_MAX_H`, `RENDER_COUNT` and `ActivitiesSkeleton` all read it. A stray literal is a page jump waiting to happen.
- **`watchcat_recovery` is in `RECOVERY_TYPES` but is never emitted at `info`.** All five call sites in `qmanager_watchcat` pass `warning` or `error`, and severity wins in `presentEvent`, so its green-check branch is currently unreachable. Intended, not a bug: the entry is there so a future "recovery succeeded" line reads correctly. `profile_applied` is the same shape in reverse, emitted at `info` for a complete apply and `warning` for a partial one.
- **The NDJSON file lives in `/tmp` and does not survive a reboot.** An empty card after a restart is correct, not a fault.
- **`MAX_EVENTS=50` on the device vs. `maxEvents=20` in the hook.** The resolution pass sees 20. A degradation whose recovery is more than 20 events old will still be flagged unresolved; in practice a recovery follows its degradation closely enough that this has not been observed, but it is the model's outer limit.

## Known Issues

### `band_change` has no debounce, and it can evict the entire ring

**No code change was made for this in the presentation pass. It is a telemetry bug and deserves its own change.**

Latency and packet loss are both debounced before an event is written: `events.sh:370` and `:390` require `_qt_lat_debounce` / `_qt_loss_debounce` consecutive readings (3 on the `standard` preset) before `append_event` fires. Band change is not. `events.sh:488-489` compares the current `lte_band` against the previous **2-second** sample with a raw `!=` and emits immediately (`:498`); the NR path at `:526-528` does the same and emits at `:537`.

The arithmetic is unforgiving. `POLL_INTERVAL=2` (`qmanager_poller:39`) and `MAX_EVENTS=50` (`qmanager_poller:111`), so a modem oscillating between two bands on consecutive polls can write 50 events in **about 100 seconds** and, at a more realistic every-other-poll flap, consume the whole ring in **roughly 12 minutes**, evicting every other event in it. A live probe caught this in progress: 44 of 50 buffered events were `band_change` and the entire 50-event ring spanned about 750 seconds of wall clock, meaning nothing older than 12 minutes was recoverable.

Consequences worth knowing before touching this card:

- The 20 events the hook keeps can be entirely band changes, so `computeUnresolved` may never see a recovery that did happen. The pass is correct; its input was starved.
- The user-visible symptom is a card that scrolls constantly and says nothing.

The fix belongs in `events.sh`, mirroring the latency pattern: require N consecutive samples on the new band before emitting, and ideally collapse a flap between two known bands into one event. Doing it in the client would only hide the eviction, not stop it.

## See Also

- [alerts.md](alerts.md): the Centralized Alerts engine, which dispatches independently of this feed
- [connection-quality.md](connection-quality.md): the producer of `high_latency` / `high_packet_loss` and their thresholds
- [connection-watchdog.md](connection-watchdog.md): the producer of `watchcat_recovery` and `sim_failover`
- [carrier-aggregation.md](carrier-aggregation.md): the sibling dashboard surface whose release clock uses the same commit-after-render ref discipline
- `DESIGN.md`: the Age-Gated Tone Rule, the Functional-Color Promise, the Saved-State Honesty Rule, and the motion canon
