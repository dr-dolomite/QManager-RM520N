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
| Draw-in animation | `.chart-draw` / `.chart-area` in `app/globals.css` |
| Series colours | `--chart-nr` (5G NR), `--chart-lte` (4G LTE), plus `--primary` / `--lte` in Live Latency |
| Mandatory chart props | `isAnimationActive={false}` and `pathLength={1}` on every animated series |
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
   stagger the fill behind the stroke, no access to the design system's curve tokens, and, decisively,
   no "first paint only" mode. They are also invisible to `MotionConfig`, the app-wide
   `prefers-reduced-motion` switch, so a reduced-motion user cannot turn them off.
2. **Hand-rolling the SVG** would give total control and lose the entire feature set these cards
   actually depend on: tooltips, `accessibilityLayer` keyboard and screen-reader support, responsive
   domain calculation, `connectNulls` gap handling, and monotone curve interpolation. That is a large
   amount of correct behaviour to re-implement in order to own one animation.
3. **CSS over recharts**, which is what ships. The animation is authored in the design system's own
   tokens, honours reduced motion through a normal `@media` block, and gets the recipe's hardest
   clause for free.

That free clause is **"first paint only"**. A CSS animation fires when an element *mounts*. Once
recharts' internal `<Animate>` wrapper is gone, recharts keeps the same `<path>` node across every
poll and merely rewrites its `d` attribute. No remount, no replay, and no bookkeeping to write.

### The two mandatory props

Every animated series in these cards passes both. Neither is optional, and neither failure produces a
TypeScript error.

**`isAnimationActive={false}`** removes recharts' `<Animate>` wrapper, which is what makes the path
node stable across polls. Without it the CSS animation replays on every remount, and worse, recharts'
own animation runs: it keys that wrapper on the **identity of the data array**, and both chart cards
rebuild their array on every poll, so the charts had been re-running a 1500ms `ease` animation every
couple of seconds. That is well past the motion ceiling, on an easing curve from no design system, and
invisible to `MotionConfig`. Retiring that defect is part of what landing recipe 16 bought.

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
| `baseValue` | Signal History's areas | The fill anchors at zero instead of at the data floor. RSRP is negative, so a zero baseline fills the entire plot. The card computes it as the minimum non-null value across both series. |
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

### Loading state

`isLoading` had been declared on the props interface and passed by the parent, but never destructured,
so the card had no loading state at all. It now renders a skeleton on the zero-shift overlay
construction, and the chart carries the `CHART_H` height pin whose absence let `ResponsiveContainer`
pop the layout on load (`ResponsiveContainer` renders nothing until it has measured its parent, so an
unpinned parent measures zero and then jumps).

### Series colours

`latency` uses `--primary`; `packetloss` uses `--lte`, **not** `--secondary`. Shipped `--secondary` is
a neutral (it backs progress tracks), so reaching for it would have rendered the intended Carrier
Violet as grey. See `DESIGN.md` > Token Names in Code.

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

The `scaleX` fill motion is untouched by this change (see `DESIGN.md` > Motion > "Meter fill").

## What the mock was deliberately not followed on

Three points where the `QManager Dashboard Final` mock loses to canon, recorded so a future pass does
not "fix" them back:

- **The mock's 11px and 13px type steps stay off the ramp.** `DESIGN.md` scopes those to the sidebar
  and banners as surface-scoped exceptions. Recent Activities set this precedent.
- **The mock's teal at hue 185 is not imported.** Shipped `--uplink` is hue 200, because 185 sits 36
  degrees from success at 149, under the 40-degree separation floor.
- **The mock's 240ms cascade offset on Signal History is not reproduced** (see Entrance cascade above).

## Related docs

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
rather than a grep-driven sweep. See `DESIGN.md` > Migration Sequence, step 3b and the opacity-wash
note beneath the table.
