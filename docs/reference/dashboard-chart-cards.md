# Dashboard Chart Cards

The three dashboard cards that were the last to be retargeted onto the `QManager Dashboard Final`
mock: **Device Metrics**, **Live Latency** and **Signal History**. Two of them draw recharts line and
area charts, one draws a stack of meters, and all three carry contracts that are easy to delete by
accident because nothing in TypeScript or the build enforces them. This note records what those
contracts are and why each exists, so a future edit does not quietly break a chart that still
compiles.

## Quick Reference

| Item | Value |
|------|-------|
| Device Metrics | `components/dashboard/device-metrics.tsx` |
| Live Latency | `components/dashboard/live-latency.tsx` |
| Signal History | `components/dashboard/signal-history.tsx` |
| Meter primitive | `components/ui/metric-bar.tsx` |
| Draw-in animation | `.chart-draw` / `.chart-area` in `app/globals.css`, applied **only** via `useChartDrawIn()` |
| Chart motion hooks | `hooks/use-chart-motion.ts` — `useChartDrawIn()` (entrance) + `useChartSeriesMotion()` (poll updates) |
| Series colours | `--chart-nr` (5G NR), `--chart-lte` (4G LTE); Live Latency draws `--primary` (latency) and `--on-surface-variant` (packet loss) |
| Direction glyphs | Device Metrics' data-usage row: `text-downlink-on-surface` (rx) / `text-uplink-on-surface` (tx) — see [color-system.md](color-system.md) |
| Mandatory chart props | `{...useChartSeriesMotion()}` and `pathLength={1}` on every animated series |
| i18n namespace | `dashboard` (`metrics.*`, `latency.*`, `signal_history.*`) |
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
   invisible to `MotionConfig`, the app-wide `prefers-reduced-motion` switch, because recharts animates
   through **react-smooth**, a separate engine motion/react knows nothing about. (These props are not
   unused — they own the *poll update*, a different job entirely. See "The two clocks" below.)
2. **Hand-rolling the SVG** would give total control and lose the entire feature set these cards
   actually depend on: tooltips, `accessibilityLayer` keyboard and screen-reader support, responsive
   domain calculation, `connectNulls` gap handling, and monotone curve interpolation. That is a large
   amount of correct behaviour to re-implement in order to own one animation.
3. **CSS over recharts**, which is what ships. The animation is authored in the design system's own
   tokens, honours reduced motion through a normal `@media` block, and gets the recipe's hardest
   clause for free.

## The two clocks

A live-polling chart has two distinct motion jobs, and they were in direct conflict until
`hooks/use-chart-motion.ts` separated them.

| Job | When | Owner |
|-----|------|-------|
| **Entrance** — the trace draws itself in | Once, on first paint (and on metric switch in Signal History) | CSS `.chart-draw`, applied via `useChartDrawIn()` |
| **Update** — the trace moves to a new shape | Every poll (~2-3s Live Latency, 10s Signal History) | recharts, configured by `useChartSeriesMotion()` |

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
`useReducedMotion()` because `MotionConfig` cannot reach react-smooth.

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
| `accessibilityLayer` | Live Latency's `AreaChart` | Recharts' keyboard navigation and screen-reader announcements for the series disappear. The chart becomes a picture. |
| `useId()`-derived gradient ids | Both chart cards | SVG `<defs>` ids are **document-global**. A literal id collides the moment two instances of the card mount, and both charts then paint from whichever definition rendered last. Live Latency additionally strips `:` from the generated id, because React's `useId` emits characters that are not valid in an SVG id reference. |
| `connectNulls={false}` | Signal History's areas | A `null` means the modem reported **no 5G leg on that sample**, not a missing reading. With `connectNulls` on, recharts interpolates straight through the gap and the card draws a 5G signal that did not exist. The area must break. |
| `domain={["dataMin - 5", "dataMax + 5"]}` as **strings** | Signal History's `YAxis` | These are recharts' relative-domain expressions and only work as strings. Passing numbers pins the axis to an absolute range, which is wrong for RSRP (negative, carrier-dependent) and flattens every chart into a line near one edge. |
| `baseValue` | Signal History's areas | The fill anchors at zero instead of at the data floor. RSRP is negative, so a zero baseline fills the entire plot. The card computes it as `min(non-null values) - Y_AXIS_PAD`, and that `- Y_AXIS_PAD` is load-bearing: it must equal the `YAxis` domain floor above, **not** the bare data minimum. Recharts derives the default for an *unset* `baseValue` from the resolved axis domain (`Area.getBaseValue`), but an explicit **number** is used verbatim with no reference to the domain — so passing the bare minimum left the fill's bottom edge `Y_AXIS_PAD` units above the actual axis floor. On narrow-banded metrics (RSRP/RSRQ/SINR barely move) that blank band is most of the visible fill, which is what made a real area chart read as a thin line with a faint shadow. Live Latency looks right precisely because it sets no `baseValue` at all. |
| `chartConfig` object **keys** | Both chart cards | shadcn's `ChartStyle` emits one `--color-<key>` CSS custom property per entry, and the strokes, the gradient stops and the tooltip swatch all read those back as raw template strings (`` var(--color-${name}) ``). Renaming a key breaks all three at runtime with **no** type error. Live Latency's keys must stay `latency` / `packetloss`; Signal History's are `rsrp4G` / `rsrp5G` / `rsrq4G` / `rsrq5G` / `sinr4G` / `sinr5G`. |

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

## Live Latency

### The chip reports reachability, not latency quality

`chipTone()` derives the header chip from what the component knows first-hand:

| Condition | Variant | Glyph |
|-----------|---------|-------|
| No connectivity object | `muted` | `MinusCircleIcon` |
| `latency_ms === null` (last probe timed out) | `destructive` | `XCircleIcon` |
| A reading exists | `success` | `CheckCircle2Icon` |

It deliberately does **not** tone by a latency threshold. The backend owns latency thresholds, in the
Connection Quality presets that feed the `high_latency` alert (see
[connection-quality.md](connection-quality.md)). A second copy of those numbers in the frontend could
disagree with the alert firing directly beside it, which is worse than having no chip at all. A
distinct glyph per tone is mandatory rather than decorative: the role containers sit within ~1.03:1 of
each other, so colour alone does not separate these states for a deuteranopic reader.

The chip's label and glyph crossfade through the shared `SwapLabel` primitive, keyed on
`` `${tone.variant}-${hasReading}` ``. This card previously hand-rolled a duplicate of that component
and left the **glyph outside** it, so the one channel that separates these tones in greyscale snapped
in a single frame while the container fill morphed over `standard`. See
[dashboard-state-motion.md](dashboard-state-motion.md).

### Loading state

`isLoading` had been declared on the props interface and passed by the parent, but never destructured,
so the card had no loading state at all. It now renders a skeleton on the zero-shift overlay
construction, and the chart carries the `CHART_BOX` height whose absence let `ResponsiveContainer`
pop the layout on load (`ResponsiveContainer` renders nothing until it has measured its parent, so an
unpinned parent measures zero and then jumps).

### `CHART_BOX` is floor-plus-grow, not a fixed height

`CHART_BOX` (`min-h-[150px] flex-1`) is the single source for the plot box across all four branches —
chart, skeleton, empty and error — so the loading handoff cannot jump.

The mock's plot really is 150px, and this card matched it, yet a large dead gap opened between the
plot and the Speed Test tile. That is a **mock-vs-product structural difference**, not a wrong number:
in the mock this card sits beside two naturally-equal-height columns so 150px leaves no slack, but in
the real dashboard grid it is a row-mate of Device Metrics (seven metric rows, taller), the row
equalises heights, and the tile's `mt-auto` pools every pixel of that slack in the middle. `flex-1`
hands the slack to the plot instead.

The `min-h` floor still discharges the `ResponsiveContainer` obligation above: it guarantees a
measurable height on the first frame, before the flex parent has resolved how much slack there is.
`aspect-auto` at the call site is still required to defeat `ChartContainer`'s base `aspect-video`.

### Series colours

`latency` uses `--primary` — the surface's one brand-weight data series. `packetloss` uses
**`--on-surface-variant`**, the neutral ink.

That neutral is a deliberate answer, not a placeholder. Packet loss was originally `--lte`, i.e. the
**4G LTE identity hue**, on a series that has nothing to do with which radio is attached; a user who
learned violet = LTE on the CA strip read a violet trace here and had to unlearn it. Nothing else in
the palette fits either: packet loss has no **direction**, so neither Downlink Rose nor Uplink Cyan
applies, and painting it from the **functional** ramp would make a healthy 0% line permanently red —
"reports, never alarms" cuts hard against a fault-coloured series that is drawn even when nothing is
wrong. The legend swatch moves with it (`bg-on-surface-variant`).

> ℹ️ NOTE: the historical trap here is still worth keeping. `--secondary` is **not** Carrier Violet in
> this repo — shipped `--secondary` is a shadcn neutral that backs progress tracks, so reaching for it
> renders grey. Carrier Violet is `--lte-*`. See `DESIGN.md` > Colors > Secondary.

The cached-speedtest result chips on this card follow the direction contract rather than the radio
one: download is `downlink-container`, upload is `uplink-container`
(`live-latency.tsx:888`). See [speedtest.md](speedtest.md) and [color-system.md](color-system.md).

## Device Metrics

Seven meter rows on filled `surface-container` pills with 8px tracks, replacing hairline separators.
`DESIGN.md`'s one conditional rule backs the mock here: seven rows is a glance surface, not a data
table. The skeleton previously rendered ten rows for a body of seven and now mirrors the loaded
geometry; missing data renders a spacer so an absent bar cannot collapse a row.

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
> motion prop and so obeys the app-wide `<MotionConfig reducedMotion="user">`, but the width retarget
> is plain CSS and sits outside motion's reach — and `globals.css` carries only per-component
> reduced-motion blocks, no blanket rule. Without the variant, moving the value out of `animate`
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
  a `TickGroup`; Live Latency's single figure is deliberately ungrouped
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
