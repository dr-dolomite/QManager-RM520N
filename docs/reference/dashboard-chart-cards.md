# Dashboard Chart Cards

The three data-dense dashboard cards: **Device Metrics**, **Connection Quality** and **Signal
History**. Signal History draws a recharts area chart, Device Metrics draws a stack of meters, and
Connection Quality draws latency bars plus two 28-cell history strips with no chart library. All three
carry contracts that are easy to delete by accident because nothing in TypeScript or the build
enforces them. This note records what those contracts are and why each exists, so a future edit does
not quietly break a card that still compiles.

> ℹ️ NOTE: Connection Quality replaced the **Live Latency** card (`live-latency.tsx`, a recharts
> latency/packet-loss chart with the Speed Test tile beneath it) on 2026-10-11. It was ported from
> QManager-the101's `components/dashboard/connection-quality.tsx` and re-aligned to this backend. The
> `latency.*` i18n keys went with the old card.

## Quick Reference

| Item | Value |
|------|-------|
| Device Metrics | `components/dashboard/device-metrics.tsx` |
| Connection Quality | `components/dashboard/connection-quality.tsx`; geometry in `QUALITY` (`components/dashboard/shapes.ts`) |
| Connection Quality data | `connectivity` from the status poll (prop) + `useLatencyHistory()` → `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh` every 30 s |
| Signal History | `components/dashboard/signal-history.tsx` |
| Meter primitive | `components/ui/metric-bar.tsx` |
| Draw-in animation | `.chart-draw` / `.chart-area` in `app/globals.css`, applied **only** via `useChartDrawIn()` |
| Chart motion hooks | `hooks/use-chart-motion.ts` — `useChartDrawIn()` (entrance) + `useChartSeriesMotion()` (poll updates) |
| Series colours | `--chart-nr` (5G NR), `--chart-lte` (4G LTE) |
| Direction glyphs | Device Metrics' data-usage row and its Speed Test tile's cached figures: `text-downlink-on-surface` (down) / `text-uplink-on-surface` (up) — see [color-system.md](color-system.md) |
| Mandatory chart props | `{...useChartSeriesMotion()}` and `pathLength={1}` on every animated series |
| i18n namespace | `dashboard` (`metrics.*`, `connection_quality.*`, `speedtest.*`, `signal_history.*`) |
| Design canon | `DESIGN.md` > Motion > "Chart draw-in", and > Color > "Data visualization" |

> ℹ️ NOTE: "recharts" is the charting library these cards use. It renders SVG and owns the DOM nodes
> for every line and area, which is the fact the motion contract below is built around.

## The motion contract: CSS over recharts

The draw-in is Motion Guide recipe 16, the last of the guide's sixteen recipes to be implemented. The
stroke draws itself over the `standard` duration and the area fill follows 80ms behind, so the chart
reads as being plotted rather than pasted.

It is implemented in `app/globals.css` as `.chart-draw`, applied to the shadcn `ChartContainer`, whose
selectors reach **recharts' own emitted class names**:

```css
.chart-draw .recharts-line-curve,
.chart-draw .recharts-area-curve { /* stroke draw */ }
.chart-draw .recharts-area-area  { /* fill, 80ms behind */ }
```

### Why this construction and not the alternatives

There were three ways to build it, and the two obvious ones lose more than they gain.

1. **Recharts' own animation props** (`isAnimationActive`, `animationDuration`, `animationEasing`)
   cannot express the recipe. They offer one duration and one easing for the whole series, no way to
   stagger the fill behind the stroke, and, decisively, no "first paint only" mode. They are also
   invisible to `MotionConfig`, the app-wide reduced-motion switch, because recharts animates
   through **react-smooth**, a separate engine motion/react knows nothing about. (These props are not
   unused — they own the *poll update*, a different job entirely. See "The two clocks" below.)
2. **Hand-rolling the SVG** would give total control and lose the entire feature set these cards
   actually depend on: tooltips, `accessibilityLayer` keyboard and screen-reader support, responsive
   domain calculation, `connectNulls` gap handling, and monotone curve interpolation. That is a large
   amount of correct behaviour to re-implement in order to own one animation.
3. **CSS over recharts**, which is what ships. The animation is authored in the design system's own
   tokens, honours reduced motion through an `@variant motion-reduce` block, and gets the recipe's hardest
   clause for free.

## The two clocks

A live-polling chart has two distinct motion jobs, and they were in direct conflict until
`hooks/use-chart-motion.ts` separated them.

| Job | When | Owner |
|-----|------|-------|
| **Entrance** — the trace draws itself in | Once, on first paint (and on metric switch in Signal History) | CSS `.chart-draw`, applied via `useChartDrawIn()` |
| **Update** — the trace moves to a new shape | Every poll (10s Signal History) | recharts, configured by `useChartSeriesMotion()` |

Only recharts can do the second job: it interpolates each point from its previous *plot* position to
its new one (`Area.js:250-265`), and nothing outside recharts knows where a point sits in plot space.

### Why they conflicted, and the one rule that resolves it

Recharts wraps an animated series in `<Animate key={"area-" + animationId}>` (`Area.js:245`), where
`animationId` is the chart's `updateId`, incremented on **every data change**
(`generateCategoricalChart.js:2035`). A changed React key remounts the subtree, so each poll produces
a **brand-new `<path>` node** — and a CSS `@keyframes` fires on element *mount*.

So leaving `.chart-draw` on a live chart replays the entrance on every poll: the line re-draws from
zero and the fill flashes transparent, on top of the poll's own morph.

> ⚠️ WARNING: **Never hardcode `chart-draw` in a className.** The class is correct only while it is
> *temporary*. `useChartDrawIn()` returns `"chart-draw"` for the length of the entrance and `""`
> afterwards; the remounts still happen, there is simply no CSS left for them to fire. Pass the same
> value used as the `ChartContainer`'s `key` as the hook's `resetKey` (Signal History passes
> `signalType`) or the entrance will not replay when the chart genuinely remounts.

The earlier answer was to disable recharts' animation outright with `isAnimationActive={false}`, which
kept one stable path node across polls. That did retire a real defect — the charts had been re-running
recharts' default **1500ms `ease`**, 3.75x the motion ceiling on a curve from no design system, and
unreachable by `MotionConfig` — but it also killed the poll-to-poll morph, so the trace *teleported*
to each new shape in a single frame. `useChartSeriesMotion()` restores the movement without the
defect: `standard` on `--ease-standard`, with reduced motion handled in the hook via
`useMotionReduced()` because `MotionConfig` cannot reach react-smooth. That hook honours the in-app
Animations preference ahead of the OS query; see [motion-preference.md](motion-preference.md).

> ℹ️ NOTE: recharts types `animationEasing` as a union of the five CSS keyword easings. That union is
> under-specified rather than restrictive — react-smooth's `configEasing` explicitly parses
> `cubic-bezier(x1,y1,x2,y2)` (`react-smooth/es6/easing.js:167`), which is how the project's real curve
> gets through. The cast in the hook is annotated accordingly.

### The other mandatory prop

**`pathLength={1}`** normalizes any path to one SVG user unit, which is what makes
`stroke-dasharray: 1` in `.chart-draw` a single dash covering the whole line at any width. These cards
are container-responsive, so real path length changes with the viewport, and a fixed dash array cannot
be correct at more than one width.

> ⚠️ WARNING: Do not copy the mock's `stroke-dasharray: 2400`. Visible dash length is
> `min(L, D - offset)`, so against a path 400 to 700px long nothing appears at all until the offset
> falls under ~1800. The first 75% of the animation is dead time and the line snaps in over the last
> 75ms. Copying the constant faithfully ships a snap and calls it a draw.

### Non-load-bearing by construction

The keyframes are open-ended, a `from` with no `to`, the same construction as `.ca-meter`. Resting
`stroke-dashoffset` is 0 and resting opacity is 1, so the chart is already correct if the animation
never runs at all. The reduced-motion block clears `stroke-dasharray` rather than only stopping the
keyframe, because the dash array is the *mechanism* and not the appearance: a merely stopped animation
would leave the line visibly dashed.

## Contracts a future edit must not drop

These are all silent failures. Each one compiles, renders, and is wrong.

| Contract | Where | What breaks without it |
|----------|-------|------------------------|
| `accessibilityLayer` | Signal History's `AreaChart` | Recharts' keyboard navigation and screen-reader announcements for the series disappear. The chart becomes a picture. |
| `useId()`-derived gradient ids | Signal History (`gradientId`, also the segment `layoutId`) | SVG `<defs>` ids are **document-global**. A literal id collides the moment two instances of the card mount, and both charts then paint from whichever definition rendered last. |
| `connectNulls={false}` | Signal History's areas | A `null` means the modem reported **no 5G leg on that sample**, not a missing reading. With `connectNulls` on, recharts interpolates straight through the gap and the card draws a 5G signal that did not exist. The area must break. |
| A `null` latency sample stays `null` | Connection Quality's rows and reachability strip, and the Latency Monitoring card's realtime + aggregate series | A lost ping is an **absent** reading, not a fast one. Mapping it to `0` drew a total blackout as a perfectly healthy-looking 0 ms link. Connection Quality passes a `null` `latency_ms` / `dns_lookup_ms` to `MetricBar` untouched (an empty track and `—`) and counts a `null` history `lat` as a **lost probe** (amber; red only with two or more failed rows at the loss cut, since a cell holds just 3-5 rows). The Latency Monitoring card passes `null` through so recharts breaks the path, and its rolling average must **exclude** gaps rather than average in zeros, or the headline number sinks precisely when the link is worst. See [connection-quality.md](connection-quality.md#latency-charts-null-is-a-gap). |
| `domain={["dataMin - 5", "dataMax + 5"]}` as **strings** | Signal History's `YAxis` | These are recharts' relative-domain expressions and only work as strings. Passing numbers pins the axis to an absolute range, which is wrong for RSRP (negative, carrier-dependent) and flattens every chart into a line near one edge. |
| `baseValue` | Signal History's areas | The fill anchors at zero instead of at the data floor. RSRP is negative, so a zero baseline fills the entire plot. The card computes it as `min(non-null values) - Y_AXIS_PAD`, and that `- Y_AXIS_PAD` is load-bearing: it must equal the `YAxis` domain floor above, **not** the bare data minimum. Recharts derives the default for an *unset* `baseValue` from the resolved axis domain (`Area.getBaseValue`), but an explicit **number** is used verbatim with no reference to the domain — so passing the bare minimum left the fill's bottom edge `Y_AXIS_PAD` units above the actual axis floor. On narrow-banded metrics (RSRP/RSRQ/SINR barely move) that blank band is most of the visible fill, which is what made a real area chart read as a thin line with a faint shadow. |
| `chartConfig` object **keys** | Signal History | shadcn's `ChartStyle` emits one `--color-<key>` CSS custom property per entry, and the strokes, the gradient stops and the tooltip swatch all read those back as raw template strings (`` var(--color-${name}) ``). Renaming a key breaks all three at runtime with **no** type error. Signal History's keys are `rsrp4G` / `rsrp5G` / `rsrq4G` / `rsrq5G` / `sinr4G` / `sinr5G`. |

## Signal History

### One height constant, four branches

`CHART_H` (`h-[250px]`) is the single source of the chart block's height, and **all four state
branches use it**: loading, empty, error and populated. This is the zero-layout-jump property, and it
is the one thing this card already got right before the retarget, so it stays true. The skeleton
mirrors the loaded geometry inside that height (the 34px mono y-axis rail, the 190px plot, the x-axis
caption row and the legend row) per the Skeleton-Mirror Rule. Change `CHART_H` and the skeleton's
internal geometry has to move with it.

The 250px covers a 190px plot plus the axis captions and legend, which live *outside* the plot in the
mock and *inside* the recharts surface here.

### Honest error state

The hook has always exposed `error` and the card never rendered it, so a failed fetch was
indistinguishable from "no data yet", which is reassuring and wrong. A dead endpoint and an expired
session both surface here, so the message carries the status text rather than a generic line. It
renders as a `role="alert"` destructive container filling `CHART_H`.

### The segmented switcher

The metric switcher is a segmented pill whose active segment **travels** between positions on
`standard` rather than appearing, matching the nav indicator's gesture. Its `layoutId` is scoped
through `useId()` so two instances of the card on one page cannot capture each other's pill, and a
settled flag suppresses the slide on first paint. The `Select` fallback below 540px is retained
deliberately: a five-way segmented control does not fit a phone.

### Entrance cascade

Signal History was the only dashboard card outside the entrance cascade, a bare `div` while every
sibling rose into place. It now takes `staggerItem` in `home-component.tsx`, with **no** delay. The
mock's 240ms offset belongs to a single page-wide cascade, and this page runs several independent
stagger containers, so a hardcoded delay would land the widest card late rather than recreate the
mock's rhythm.

## Connection Quality

One card answering "how steady has the link been over the last half hour". It reads two sources and grades every mark against the cuts the poller
already applies, so the card cannot disagree with the Internet chip or the `high_latency` /
`high_packet_loss` events beside it.

### Anatomy and sources

Top to bottom, every row from `components/dashboard/connection-quality.tsx`:

| Row | Shows | Source |
|-----|-------|--------|
| Internet | Current RTT, bar + ms | `connectivity.latency_ms` |
| DNS lookup | Carrier-resolver lookup time, bar + ms | `connectivity.dns_lookup_ms` — the row is **omitted** when the key is absent, and drawn as an empty track and `—` when it is `null` |
| Probing | The host being pinged, mono | `connectivity.ping_target` (this backend has no `probe_target`) |
| Last outage | Duration of the last outage cleared this boot plus its age, e.g. `1m 46s (12m ago)`, or "None"; a `HintIcon` before the value carries the WAN IP and whether it changed | `connectivity.last_outage_s` / `_ago_s` / `_wan_ip` / `_wan_changed` — the row is **omitted** when `last_outage_s` is absent (older poller), and reads "None" when it is `null`. Producer: [alerts.md → Last cleared outage](alerts.md#last-cleared-outage-tmpqmanager_last_outage) |
| Reachability strip | 28 cells over 30 minutes, oldest first, plus a state label | `useLatencyHistory()` cells; label from `connectivity.status` |
| Jitter strip | 28 bars over the same buckets, plus "N ms now" | history `jit` per bucket; header from `connectivity.jitter_ms` |
| Axis | Age of the oldest visible sample … "Now" | the bucketed history |
| Footer | Typical / Worst / Loss, pinned to the card's bottom edge by `mt-auto` | `avg_latency_ms` / `max_latency_ms` / `packet_loss_pct` (Loss to one decimal) |

The Speed Test row that used to close this card moved to Device Metrics on 2026-11-01 (RM551E
v0.1.34 parity) — see [The Speed Test tile](#the-speed-test-tile).

The status poll arrives as a prop from `home-component.tsx`, whose cadence is
`connectivity.history_interval_sec × 1000 + 250` ms (`POLL_BUFFER_MS`, `home-component.tsx:47`). The strips come from
`useLatencyHistory()` (`hooks/use-latency-history.ts`), which polls
`fetch_ping_history.sh` every 30 s, so the strips move at most twice a minute while the rows move every
poll. Geometry lives in `QUALITY` in `components/dashboard/shapes.ts` and is shared with the
skeleton: `BUCKETS: 28`, `WINDOW_S: 1800`, `TRACK_H: 26`.

### Thresholds come from the poller

Every latency and loss cut reads `connectivity.thresholds` (`{ latency_ms, loss_pct }`, resolved from
the Connection Quality preset; see [connection-quality.md](connection-quality.md)). Only when an older
poller omits the block does the card fall back to `250` ms / `30` % (`connection-quality.tsx:55-56`),
which are the backend's `tolerant` defaults.

| Mark | Green | Amber | Red |
|------|-------|-------|-----|
| Internet / DNS bar (track = 2 × cut) | below the cut | `>=` latency cut | `>=` 2 × latency cut |
| Reachability cell | answered, worst RTT within the cut, worst loss under the loss cut | worst RTT `>` latency cut, or a lone failed row | two or more failed rows whose share of the span's rows is `>=` loss cut, or worst `loss >=` loss cut |
| Jitter bar (height = jitter / 80 ms, floor 7 px) | `< 15` ms | `15`–`39` ms | `>= 40` ms |

> ⚠️ WARNING: Do not reintroduce fixed latency cuts on the rows. The port first kept the101's 60 /
> 100 ms, so a normal 114 ms cellular RTT drew a red bar beside "Responsive" above an all-green strip.
> Grading on `thresholds.latency_ms` fixed it; measured on RM520N-GL data, 114 ms and 210 ms render
> green at 23 % and 42 % of the track. The jitter cuts (15 / 40 ms, `connection-quality.tsx:59-60`)
> are fixed on purpose: the backend has no jitter threshold.

> ℹ️ NOTE: the bar turns amber **at** the cut (`MetricBar` tests `value >= warnAt`) while a strip cell
> turns amber only **above** it (`lat > latencyMs`). A reading of exactly the cut can therefore show
> an amber bar over a green cell.

### Bucketing rules (`bucketHistory`)

- **The window is anchored on the newest entry's `ts`**, the modem's clock, never `Date.now()`. The
  browser's clock and the modem's can disagree (the modem boots at 1970 until its clock is set); anchoring on the browser would push every
  sample out of the window.
- **A span with no samples is unmeasured** (`bg-surface-container-high` cell, 3 px jitter stub), never
  green. "Nothing was recorded" is not "the link was fine".
- **Jitter comes only from answered probes.** A failed row's `jit` is the window statistic, often a
  literal `0`, so reading it would draw a dropout as perfectly smooth.
- **The jitter header goes to "No reading" while the current probe fails**, because `jitter_ms` is
  then a stale window statistic.
- **A `null` footer figure renders `—`**: the window is under the poller's ten-sample floor. It is
  never coerced to `0`.

### The reachability label

`reachState()` maps `connectivity.status`:

| `status` | Label | Ink |
|----------|-------|-----|
| `connected` | Responsive | `text-success-on-surface` |
| `degraded`, `recovery` | Degraded | `text-warning-on-surface` |
| `disconnected` **and** `dns_lookup_ms` is a number | No ping reply | `text-warning-on-surface` |
| `disconnected` | Unreachable | `text-destructive-on-surface` |
| `unknown` or missing | Not measured | `text-on-surface-variant` |

The "No ping reply" branch exists because some carriers filter ICMP: when DNS still resolves, the
link is up and only the ping is blocked, so red would overstate it.

### Three states

| State | When | Renders |
|-------|------|---------|
| Loading | `isLoading` | `QualitySkeleton`, built from the same `QUALITY` constants |
| Error | `!modemReachable && !connectivity` — no poll has **ever** landed | "Can't reach the modem" `Empty`. A later failed poll keeps the last reading instead |
| Empty | `connectivity.internet_available === null` (the ping daemon is not reporting) | "Nothing is probing" `Empty` with a link to `/monitoring/connection-quality` |

### Known gaps

- Off-scale shapes and type copied from the101: `rounded-[3px]` / `rounded-[2px]` on cells and bars (`QUALITY.CELL` / `QUALITY.BAR`, and the skeleton), and 10.5 / 11 / 13 / 19 px text sizes, against the type-ramp rule under [What the mock was deliberately not followed on](#what-the-mock-was-deliberately-not-followed-on).
- The `timeline` glyph (`components/ui/material-symbol-names.ts:173`) is no longer used by any component but is still in the font subset; it was Live Latency's empty-state icon.

## Device Metrics

Four meter rows with 8px tracks (temperature, CPU, memory, storage), two filled `surface-container`
pills (data used; one cell-distance row carrying the LTE and NR legs, each led by its identity
`Tag`, with one hint covering both timing-advance caveats), then the pinned Speed Test tile.
`DESIGN.md`'s one conditional rule backs the mock here: this is a glance surface, not a data table.
`MetricsSkeleton` mirrors the loaded geometry (four meters, two 40px pills, the tile at
`SPEEDTEST.TILE_H`); missing data renders a spacer so an absent bar cannot collapse a row.

### The Speed Test tile

Moved here from the foot of Connection Quality on 2026-11-01 (RM551E v0.1.34 parity). It is one
`SPEEDTEST.TILE` (`components/dashboard/shapes.ts`), **pinned at 68px (`h-[4.25rem]`) in every
state** — result, running, never-run and skeleton — so a run starting or ending moves nothing.

- **Run control first.** A default-variant `size="icon-lg"` button on the left opens
  `SpeedtestDialog`: `play_arrow` when idle, `visibility` (label `speedtest.view_running`) while a
  run is in flight. The glyph and the body
  crossfade on `DUR.quick` only on a real idle ↔ running change; a card that mounts already running
  rides the page cascade instead.
- **Idle / cached body:** three `SpeedFigure`s spread edge to edge — download, upload, ping. Direction
  ink sits on the glyph only (`DIRECTION.DOWN` / `DIRECTION.UP`); the numeral stays neutral. Never run
  draws `—` with no unit. Below `@sm` the glyphs hide and the words stay, because three glyph-led
  labels do not fit a phone-width card.
- **Running body:** an `animate-live-ping` dot with the phase label, the live figure, and a full-width
  `MetricBar` with `track="surface-container-high"` and no warn/danger cuts.
- **The card holds the one watching hook**, `useSpeedtest({ watch: true })` (`device-metrics.tsx:285`),
  so a run started from the dialog or another tab shows here. `SpeedtestDialog`, which the card
  mounts, keeps its own non-watching `useSpeedtest()`. See [speedtest.md](speedtest.md).
- **The live figure is not a `TickingValue`.** The run updates every 500 ms and the tick would never
  finish. The cached figures are `TickingValue`s and join the card's `TickGroup`.
- **The tile is wrapped in `mt-auto`**, which pins it to the card's bottom edge. See
  [dashboard.md](dashboard.md#the-trio-row-and-why-one-card-could-not-absorb-slack).

> ℹ️ NOTE: the tile shows no result age. The old Connection Quality row carried an age `Tag` (with
> the "older than 365 days reads just now" clock guard); the tile dropped it with the move.

### `baseTone` vs `colorOverride` on MetricBar

`MetricBar` gained three additive, defaulted props in this change: `size` (`sm` hairline, default, or
`md` 8px), `track` (`muted`, default, or `surface-container-high`) and `baseTone`. All four existing
call sites in `modem-subsystem-card.tsx` render byte-identically.

The distinction between the two colour props is the part worth understanding:

- **`baseTone`** sets the tone the fill carries **below `warnAt`** only. The warn and danger steps
  still take over above their thresholds. Temperature passes `baseTone="success"` because a cool modem
  is actively good news rather than merely not-yet-bad, and it still escalates through amber and red.
- **`colorOverride`** is a hard pin that ignores `value` entirely. Using it for the temperature meter
  would have **disabled the thresholds on the one meter where overheating matters**.

Reach for `baseTone` when a healthy reading deserves a colour; reach for `colorOverride` only when the
meter genuinely has no threshold semantics.

### The static-class-map lesson

`colorOverride` used to build a dynamic class string, `` `bg-${colorOverride}` ``. **Tailwind v4's
static extractor cannot see that**, because it scans source text for complete class names rather than
evaluating expressions. It rendered correctly only by accident: `bg-primary`, `bg-warning` and
`bg-destructive` each happen to appear as literals elsewhere in the codebase, so those classes were in
the bundle for unrelated reasons.

`bg-success` had no such coincidence backing it. The new green temperature meter would have rendered
with **no fill at all**, while compiling cleanly and passing type checks. The fix is `TONE_CLASS`, a
static map, with `MetricBarTone` derived from its keys, so a tone with no class fails the build rather
than rendering transparent. `TRACK_CLASS` and `SIZE_CLASS` follow the same pattern for the same
reason.

> ⚠️ WARNING: This failure mode applies to any Tailwind class assembled from a variable anywhere in
> the codebase. If you find yourself writing `` `bg-${x}` ``, `` `text-${x}` `` or
> `` `border-${x}` ``, replace it with a lookup map of complete class names.

### The fill's value and its entrance run on two different mechanisms

`MetricBar` deliberately splits them (see `DESIGN.md` > Motion > "Meter fill"):

- **Value → layout `width`**, as a plain CSS `transition`.
- **Entrance (0 → value, once, on mount) → `scaleX`**, as a motion prop.

The reason is that **a CSS `transform` scales `border-radius` along with the box**. A `scaleX`-only
fill squashed its own `rounded-full` cap into a near-flat ellipse at low percentages — at 37% a 4px
pill cap renders as roughly 1.5px, so the leading edge read square instead of rounded and the fill
looked harsher and darker than the mock. `width` resizes the box without touching its radius.

The old objection to `width` ("it relayouts every frame") was about animating width *per frame*.
Nothing does that here: width changes only on a poll retarget, and the entrance — the one gesture that
does run per frame — is still a compositor-only transform, landing at `scaleX(1)` where the radius
distortion is zero. This is the mock's own technique.

> ⚠️ WARNING: `motion-reduce:transition-none` on the fill is load-bearing. The `scaleX` entrance is a
> motion prop and so obeys the app-wide `<MotionConfig>`, but the width retarget is plain CSS and
> sits outside motion's reach — and `globals.css` has no blanket rule for transitions (its one global
> reduced rule zeroes tw-animate's movement variables only). Without the variant, moving the value out of `animate`
> silently gives reduced-motion users an animation they cannot turn off.

## What the mock was deliberately not followed on

Three points where the `QManager Dashboard Final` mock loses to canon, recorded so a future pass does
not "fix" them back:

- **The mock's 11px and 13px type steps stay off the ramp.** `DESIGN.md` scopes those to the sidebar
  and banners as surface-scoped exceptions. Recent Activities set this precedent.
- **The mock's teal at hue 185 is not imported.** Shipped `--uplink` is hue 200, because 185 sits 36
  degrees from success at 149, under the 40-degree separation floor.
- **The mock's 240ms cascade offset on Signal History is not reproduced** (see Entrance cascade above).

## Related docs

- [dashboard-state-motion.md](dashboard-state-motion.md) for the other dashboard motion contract — the
  live value tick cascade (`TickGroup`) and the status chip morph (`SwapLabel`). Device Metrics carries
  a `TickGroup`; Connection Quality's `TickingValue` figures are not grouped
- [carrier-aggregation.md](carrier-aggregation.md) for the other dashboard data-visualisation surface
- [recent-activities.md](recent-activities.md) for the dashboard event feed and the Age-Gated Tone Rule
- [connection-quality.md](connection-quality.md) for who owns latency thresholds and where the
  `high_latency` alert comes from
- `DESIGN.md` > Motion > "Chart draw-in", and > Color > "Data visualization"

## Known deferred

**`text-destructive` used as coloured body text.** Roughly a dozen sites place `text-destructive`, the
**fill** token, as text directly on a plain surface, where `--destructive-on-surface` exists precisely
for that job. The two highest-leverage sites are `components/ui/dropdown-menu.tsx:77` and
`components/ui/context-menu.tsx:129`, because every destructive menu item in the product inherits from
them.

This was not folded into the step 3b token change because it is entangled with the still-unmigrated
`bg-destructive/5` through `/20` opacity-wash family, which those same two lines also use for their
focus states. Deciding wash-versus-container is a judgement call per surface, so it wants its own pass
rather than a grep-driven sweep. See `CLAUDE.md` > Tracked migration deltas and the opacity-wash
note beneath the table.
