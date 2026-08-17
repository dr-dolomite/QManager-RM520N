---
name: QManager
description: Web GUI for the Quectel RM520N-GL modem. An instrument console — colour on the data, not on the furniture — running on the modem it manages.
colors:
  # Keys mirror the names that resolve in app/globals.css, which is NORMATIVE.
  # Where the Material vocabulary and shadcn's collide, the shipped name wins:
  # Carrier Violet is `lte-*` (not `secondary-*`); shadcn's own --secondary is a
  # NEUTRAL in this codebase.
  #
  # EVERY value below is inside the sRGB gamut by construction (chroma floored
  # to 98.5% of the in-gamut maximum for its lightness and hue). That is a
  # correctness property, not a nicety: Lightning CSS gamut-maps out-of-range
  # oklch() at build time, so an out-of-gamut token ships a colour nobody
  # authored. Here declared == shipped. See The In-Gamut Rule.
  #
  # --- The mark: the source pair every other hue derives from ---
  mark-ring: "oklch(0.623 0.214 259.815)"

  # --- Neutrals: the ground everything else sits on ---
  background-light: "oklch(0.985 0.003 258)"
  background-dark: "oklch(0.120 0.008 258)"
  foreground-light: "oklch(0.205 0.011 258)"
  foreground-dark: "oklch(0.965 0.004 258)"
  surface-light: "oklch(1.000 0.000 258)"
  surface-dark: "oklch(0.170 0.009 258)"
  card-light: "oklch(1.000 0.000 258)"
  card-dark: "oklch(0.170 0.009 258)"
  surface-container-light: "oklch(0.967 0.005 258)"
  surface-container-dark: "oklch(0.200 0.010 258)"
  surface-container-high-light: "oklch(0.938 0.007 258)"
  surface-container-high-dark: "oklch(0.235 0.012 258)"
  on-surface-light: "oklch(0.205 0.011 258)"
  on-surface-dark: "oklch(0.965 0.004 258)"
  on-surface-variant-light: "oklch(0.505 0.012 258)"
  on-surface-variant-dark: "oklch(0.762 0.011 258)"
  border-light: "oklch(0.905 0.006 258)"
  border-dark: "oklch(0.288 0.012 258)"
  input-light: "oklch(0.868 0.008 258)"
  input-dark: "oklch(0.330 0.013 258)"

  # --- Primary / NR / info / action: the mark's blue. The only hue that acts. ---
  primary-light: "oklch(0.565 0.235 262)"
  primary-dark: "oklch(0.605 0.200 262)"
  primary-foreground-light: "oklch(0.985 0.006 262)"
  primary-foreground-dark: "oklch(0.195 0.055 262)"
  primary-on-surface-light: "oklch(0.535 0.220 262)"
  primary-on-surface-dark: "oklch(0.650 0.183 262)"
  primary-container-light: "oklch(0.890 0.052 262)"
  primary-container-dark: "oklch(0.375 0.145 262)"
  on-primary-container-light: "oklch(0.360 0.160 262)"
  on-primary-container-dark: "oklch(0.900 0.047 262)"

  # --- Carrier Violet (`--lte-*`): the 4G LTE identity. Never acts. ---
  lte-light: "oklch(0.510 0.240 296)"
  lte-dark: "oklch(0.700 0.175 296)"
  lte-foreground-light: "oklch(0.985 0.007 296)"
  lte-foreground-dark: "oklch(0.195 0.055 296)"
  lte-on-surface-light: "oklch(0.465 0.220 296)"
  lte-on-surface-dark: "oklch(0.740 0.149 296)"
  lte-container-light: "oklch(0.850 0.082 296)"
  lte-container-dark: "oklch(0.270 0.145 296)"
  on-lte-container-light: "oklch(0.360 0.160 296)"
  on-lte-container-dark: "oklch(0.900 0.053 296)"

  # --- Downlink Rose (`--downlink-*`): the download direction. Only that. ---
  downlink-light: "oklch(0.480 0.204 341)"
  downlink-dark: "oklch(0.660 0.200 341)"
  downlink-foreground-light: "oklch(0.985 0.009 341)"
  downlink-foreground-dark: "oklch(0.195 0.055 341)"
  downlink-on-surface-light: "oklch(0.450 0.191 341)"
  downlink-on-surface-dark: "oklch(0.700 0.200 341)"
  downlink-container-light: "oklch(0.875 0.087 341)"
  downlink-container-dark: "oklch(0.285 0.121 341)"
  on-downlink-container-light: "oklch(0.360 0.153 341)"
  on-downlink-container-dark: "oklch(0.900 0.068 341)"

  # --- Uplink Cyan (`--uplink-*`): the upload direction. Only that. ---
  uplink-light: "oklch(0.545 0.091 200)"
  uplink-dark: "oklch(0.820 0.137 200)"
  uplink-foreground-light: "oklch(0.985 0.012 200)"
  uplink-foreground-dark: "oklch(0.195 0.032 200)"
  uplink-on-surface-light: "oklch(0.515 0.086 200)"
  uplink-on-surface-dark: "oklch(0.870 0.145 200)"
  uplink-container-light: "oklch(0.915 0.105 200)"
  uplink-container-dark: "oklch(0.345 0.057 200)"
  on-uplink-container-light: "oklch(0.360 0.060 200)"
  on-uplink-container-dark: "oklch(0.900 0.110 200)"

  # --- Spatial Azure (`--spatial-*`): antenna and spatial-stream readouts. ---
  spatial-light: "oklch(0.550 0.110 232)"
  spatial-dark: "oklch(0.790 0.127 232)"
  spatial-foreground-light: "oklch(0.985 0.008 232)"
  spatial-foreground-dark: "oklch(0.195 0.039 232)"
  spatial-on-surface-light: "oklch(0.515 0.103 232)"
  spatial-on-surface-dark: "oklch(0.820 0.108 232)"
  spatial-container-light: "oklch(0.855 0.085 232)"
  spatial-container-dark: "oklch(0.265 0.053 232)"
  on-spatial-container-light: "oklch(0.360 0.072 232)"
  on-spatial-container-dark: "oklch(0.900 0.058 232)"

  # --- The functional three ---
  destructive-light: "oklch(0.480 0.192 27)"
  destructive-dark: "oklch(0.640 0.200 27)"
  destructive-foreground-light: "oklch(0.985 0.007 27)"
  destructive-foreground-dark: "oklch(0.195 0.055 27)"
  destructive-on-surface-light: "oklch(0.440 0.176 27)"
  destructive-on-surface-dark: "oklch(0.680 0.200 27)"
  destructive-container-light: "oklch(0.835 0.089 27)"
  destructive-container-dark: "oklch(0.245 0.098 27)"
  on-destructive-container-light: "oklch(0.360 0.144 27)"
  on-destructive-container-dark: "oklch(0.900 0.051 27)"
  warning-light: "oklch(0.560 0.118 72)"
  warning-dark: "oklch(0.790 0.166 72)"
  warning-foreground-light: "oklch(0.985 0.011 72)"
  warning-foreground-dark: "oklch(0.195 0.041 72)"
  warning-on-surface-light: "oklch(0.525 0.110 72)"
  warning-on-surface-dark: "oklch(0.815 0.151 72)"
  warning-container-light: "oklch(0.855 0.115 72)"
  warning-container-dark: "oklch(0.410 0.086 72)"
  on-warning-container-light: "oklch(0.360 0.075 72)"
  on-warning-container-dark: "oklch(0.900 0.077 72)"
  success-light: "oklch(0.540 0.150 149)"
  success-dark: "oklch(0.740 0.200 149)"
  success-foreground-light: "oklch(0.985 0.012 149)"
  success-foreground-dark: "oklch(0.195 0.054 149)"
  success-on-surface-light: "oklch(0.505 0.140 149)"
  success-on-surface-dark: "oklch(0.780 0.200 149)"
  success-container-light: "oklch(0.895 0.145 149)"
  success-container-dark: "oklch(0.310 0.086 149)"
  on-success-container-light: "oklch(0.360 0.100 149)"
  on-success-container-dark: "oklch(0.900 0.110 149)"

  # --- Signal quality ramp: a LIGHTNESS staircase, not a hue wheel ---
  quality-1-light: "oklch(0.385 0.154 27)"
  quality-1-dark: "oklch(0.640 0.200 27)"
  quality-2-light: "oklch(0.415 0.116 45)"
  quality-2-dark: "oklch(0.665 0.187 45)"
  quality-3-light: "oklch(0.445 0.093 72)"
  quality-3-dark: "oklch(0.710 0.149 72)"
  quality-4-light: "oklch(0.475 0.106 115)"
  quality-4-dark: "oklch(0.755 0.168 115)"
  quality-5-light: "oklch(0.505 0.140 149)"
  quality-5-dark: "oklch(0.800 0.200 149)"
  quality-1-bar-light: "oklch(0.480 0.192 27)"
  quality-1-bar-dark: "oklch(0.600 0.220 27)"
  quality-2-bar-light: "oklch(0.510 0.143 45)"
  quality-2-bar-dark: "oklch(0.645 0.181 45)"
  quality-3-bar-light: "oklch(0.540 0.113 72)"
  quality-3-bar-dark: "oklch(0.690 0.145 72)"
  quality-4-bar-light: "oklch(0.570 0.127 115)"
  quality-4-bar-dark: "oklch(0.735 0.164 115)"
  quality-5-bar-light: "oklch(0.600 0.166 149)"
  quality-5-bar-dark: "oklch(0.780 0.216 149)"

  # --- Outline tags: identity and metadata, border + text, no fill ---
  tag-nr-text-light: "oklch(0.535 0.220 262)"
  tag-nr-text-dark: "oklch(0.650 0.183 262)"
  tag-nr-border-light: "oklch(0.600 0.190 262)"
  tag-nr-border-dark: "oklch(0.600 0.190 262)"
  tag-lte-text-light: "oklch(0.465 0.220 296)"
  tag-lte-text-dark: "oklch(0.740 0.149 296)"
  tag-lte-border-light: "oklch(0.545 0.190 296)"
  tag-lte-border-dark: "oklch(0.540 0.190 296)"
  tag-spatial-text-light: "oklch(0.515 0.103 232)"
  tag-spatial-text-dark: "oklch(0.820 0.108 232)"
  tag-spatial-border-light: "oklch(0.615 0.123 232)"
  tag-spatial-border-dark: "oklch(0.640 0.128 232)"
  tag-neutral-text-light: "oklch(0.505 0.012 258)"
  tag-neutral-text-dark: "oklch(0.762 0.011 258)"
  tag-neutral-border-light: "oklch(0.620 0.012 258)"
  tag-neutral-border-dark: "oklch(0.520 0.012 258)"

typography:
  sans: "Rethink Sans (--font-sans, WOFF2 variable, next/font/local)"
  mono: "JetBrains Mono (--font-jetbrains-mono → font-mono)"
  icons: "Material Symbols Rounded (shell, /dashboard, pre-auth, all of /cellular/) · lucide-react (everywhere else)"
  weights: "400 body · 500 labels · 600 titles and numerics · 700 page titles only"
  display: "700 / 1.875rem / -0.02em"
  headline: "600 / 1.25rem / -0.01em"
  title: "600 / 1.125rem"
  body: "400 / 0.875rem"
  row: "600 / 0.8125rem on a 20px line box"
  label: "500 / 0.75rem"
  numeric: "600 tabular-nums in --font-sans, sized by its slot"

rounded:
  inline: "0.75rem"
  field: "1.25rem"
  tile: "1.75rem"
  card: "2.25rem"
  hero: "2.5rem"
  pill: "9999px"

spacing:
  page-gutter: "16px → 24px"
  card-grid-gap: "16-24px"
  tile-grid-gap: "14px"
  in-card-row-gap: "6px"
  inline-gap: "8-10px"
  card-padding: "24px standard · 28px hero"

components:
  button: "pill, 42px tall, 20px horizontal, 600"
  status-chip: "filled role container + on- ink, no border, pill, mandatory 12px glyph"
  outline-tag: "1px role border + role text, transparent fill, pill, no glyph required"
  card: "36px radius in a grid, 40px for an anchor; border-0; surface fill"
  tile: "28px radius, 104px pinned height, 52px glyph disc + text column"
  metric-row: "40px pill on surface-container, 16px horizontal"
  input: "20px radius, 42px tall, surface-container fill, no rest border"
  quality-bar: "full-round track, 4px tall, ramp-coloured fill, length carries the value"
---

# Design System: QManager (RM520N-GL)

## Overview

QManager is an **instrument console**. It reports what a cellular modem is doing, on the modem itself, to someone who understands modems. The design language follows from three facts about that job.

**Colour belongs to the data, not to the furniture.** A card is a neutral surface. What is coloured is the reading: the numeral, the chart stroke, the quality bar, the glyph in its disc. This is the single largest change from the previous system, which spent its colour on large tonal container fills and left the live diagnostic values grey. That inversion was measured and it was backwards — on the surface built to showcase the colour system, four tinted tiles carried restated facts while RSRP and SINR sat in neutral text below them.

It is also the accessible answer, which is not a coincidence. Across this palette, **ink colours separate in 0 of 28 pairs under deuteranopia and protanopia simulation. So do fills. Pale identity containers separate in 2 of 10.** Colour on ink works; colour on large pale surfaces does not. The design direction and the measurement agree, so the system commits to the layer that survives.

**Density is the product, and hierarchy is how it stays readable.** A modem console shows a lot at once. The answer is never to show less; it is to rank what is shown. Neutral surfaces, one coloured thing per row, and a consistent card grid are what let forty routes feel like one product.

**Every hue owns exactly one meaning.** A colour a user learns on the dashboard means the same thing on the cell scanner. Where a figure has no honest hue, it stays neutral rather than being given a decorative one.

**Reference language:** WiFiman (Ubiquiti) and Firewalla — near-black canvas, saturated data strokes, coloured numerals, thin quality bars, outline metadata tags. **Structural reference:** the grouped-card, consistent-shape page from macOS System Settings and the Apple pro-app inspectors. **Not** a consumer router app, not a generic SaaS dashboard, not a terminal utility.

Both themes are first-class and each is authored. Dark is a near-black instrument panel; light is a white-card console. Neither is a desaturated copy of the other, and every value in both was measured rather than derived by inversion.

## Migration Deltas (tracked)

**This document is ahead of the code in the rows still marked Open.** The token set above has landed in `app/globals.css`; what remains is component work. This list is the implementation backlog, and a delta is removed only when the code matches.

| Delta | Where | Status |
| --- | --- | --- |
| ~~Token set not yet written~~ | `app/globals.css` — both themes, plus `@theme inline` | **Landed** 2026-08-16 |
| ~~`--*-on-surface` ink tokens missing~~ | `primary` and `lte` were the gap | **Landed** |
| ~~Quality ramp tokens do not exist~~ | `--quality-{1..5}` / `--quality-{1..5}-bar` | **Landed** |
| ~~Outline-tag tokens do not exist~~ | `--tag-*-text` / `--tag-*-border` | **Landed** |
| ~~`getSignalQuality()` returns four levels~~ | `types/modem-status.ts` — the ladder returns five (`bad` below `poor`), `SIGNAL_QUALITY_RANK` ranks all six members, and `SignalThresholds.poor` was renamed to `floor` so the progress-scale bottom and the new classification cut no longer share a name | **Landed** 2026-08-17 |
| ~~Quality "Good" still maps to the brand blue~~ | every consumer of the quality scale now reads `components/cellular/signal-quality-display.ts`; the four rival maps were deleted and `--primary` appears nowhere on the scale | **Landed** 2026-08-17 |
| ~~Identity chips are filled containers~~ | `components/ui/tag.tsx` is the outline-tag primitive (`nr` / `lte` / `spatial` / `neutral`); all 11 identity sites migrated, and `nr` / `lte` / `downlink` / `uplink` / `spatial` were deleted from `components/ui/badge.tsx` | **Landed** 2026-08-17 |
| ~~Radio summary tiles are four tinted containers~~ | `components/cellular/radio/summary-tiles.tsx` — all four bodies are neutral; colour survives only on the 52px disc, and `Tile` no longer accepts a `tone` prop | **Landed** 2026-08-17 |
| ~~Quality bars are not built~~ | `components/ui/metric-bar.tsx` carries `quality-1`…`quality-5` in its static `TONE_CLASS`, and `value={null}` renders an empty track with no fill element. Ten surfaces consume the ramp; `bg-quality-*-bar` also appears in `public/overview/tone.ts`, whose band meter is a hand-built 7px `motion.div` rather than a `MetricBar` but takes its tone from the same `qualityMeterTone()` | **Landed** 2026-08-17 |
| ~~`--primary` used as a health state~~ | `components/public/overview/tone.ts` and `fplmn-settings/fplmn-card.tsx:114` both moved to `success` (`ConditionTone` gained a `success` member to make the second one possible) | **Landed** 2026-08-17 |
| ~~`.impeccable/design.json` sidecar is stale~~ | Regenerated from `app/globals.css` by script rather than by hand, so every `canonical` is a verbatim source string. 155 entries as `<token>-light` / `<token>-dark` pairs. The 8-step `tonalRamp` arrays were **dropped, not refreshed**: they were an artifact of the retired Material-3 derivation, and the shipped world authors exactly two values per token — inventing ramps would have recorded values the build does not contain | **Landed** 2026-08-17 |
| `--chart-threshold` is an orphan | `app/globals.css:448` / `:612` define it in both themes (it tracks `--warning-on-surface`), but **no component consumes it**, and Data Visualization above still specifies threshold guides as dashed `--border` at low opacity. Two answers to one question. Either the token is deleted or the rule adopts it — not decided here | Open |
| Legacy `--chart-1..6` still present | `app/globals.css` — **blocked**: `--chart-3` and `--chart-6` have live consumers in `latency-monitoring-card.tsx` and `signal-storm-game.tsx`. Both are retargeted onto the new palette and given real dark values so those surfaces theme; the block is deletable only once both callers move to `--chart-nr` / a quality stop | Blocked |
| Identity `Tag` on a `primary-container` row | `components/cellular/antenna-alignment/recorder-card.tsx` — the winning position row is a `primary-container` block (Highlight-by-Container) and still carries its `nr` / `lte` outline tag, so a role border sits on another role's surface. Legible in both recorded captures; left standing because the alternatives are dropping identity from the one row that matters, or weakening a compiler-enforced split for one row's harmony | Open (accepted) |
| Positions header order inverts on a phone | same file — below `@2xl/main` the header reads title → controls → description. The description takes the full width so it does not wrap to five lines in the ~220px it had beside the controls on desktop; the cost is that a phone reads the controls before the sentence explaining them. An order swap, not a restructure | Open |
| `condition-screen.tsx` is off the One-Scale spelling | `components/cellular/condition-screen.tsx`, shared by every `/cellular/` condition state — the bracket form `duration-[var(--duration-quick)]`, and `ease-out` where `ease-standard` belongs. It does retune, so this is drift rather than the named bug, but it is the spelling a shared primitive should not be teaching | Open |
| Antenna Alignment ceiling items left open | `components/cellular/antenna-alignment/**` — no representation of **time** on a page whose whole gesture is watching a number climb; the anchor console carries the same `--shadow-whisper` as its peer cards rather than reading as the thing in front; one 52px composite numeral serves both a 1440 desktop and a phone held at arm's length outdoors. Named here so they are not rediscovered as bugs | Open |

**The token layer is in and the component layer is complete: both halves — identity and quality — have landed.** Every surface renders the new neutrals, inks and fills automatically, because components resolve `bg-surface`, `text-on-surface-variant`, `bg-primary` and so on. On top of that, the shapes that were wrong rather than merely mis-coloured have been rebuilt on the identity axis — identity and metadata now render as outline tags through `components/ui/tag.tsx`, the radio summary strip is neutral-bodied with colour only on its discs, and `--primary` no longer stands in for a health state anywhere.

Removing `nr` / `lte` / `spatial` (and the two unused direction variants) from `badge.tsx` means `BadgeVariant` no longer contains an identity or direction member at all, so **the Two-Form Rule is now enforced by the compiler rather than by reviewer discipline**: a status tone map cannot key onto an identity name, and a `variant="nr"` on a `Badge` fails the build.

The quality half landed on 2026-08-17. `getSignalQuality()` returns five levels above `none`, the `--quality-{1..5}` ramp has real consumers on ten surfaces, and no surface of the scale routes its colour through `success` / `warning` / `destructive` any more. The generated sidecar was regenerated the same day. What is left in the table above is the `--chart-*` block and the orphaned `--chart-threshold` — token-layer bookkeeping, not component work.

Two facts from that migration are worth carrying forward, because they are the ones a future change can undo by accident.

> ℹ️ NOTE: **there is exactly one quality→colour map, and re-forking it is the failure mode.** `components/cellular/signal-quality-display.ts` owns `QUALITY_GLYPH`, `qualityBadgeVariant()`, `qualityMeterTone()` and `qualityInkClass()`. Four rival copies used to exist — in `antenna-statistics/tech-card.tsx`, `radio/active-bands-card.tsx`, `public/overview/tone.ts` and `dashboard/signal-card-utils.ts` — and they were deleted, not merely aligned. One of them had already drifted: its `meterTone()` sent `none` through a `default:` arm to `success`, so **an antenna with no reading painted green**. That is why `qualityMeterTone()` returns `null` rather than a colour for `none`, and why `MetricBar` accepts `value={null}` — the absence is a value the caller must handle, not a case it can fall through.
>
> `components/cellular/cell-scanner/shapes.ts` carries a deliberately separate **3-tier** scale for scan results. A scan row compares candidate cells to each other; a serving-cell readout compares one cell to physics. It is not a fifth copy of this map and must **not** be unified with it.

> ℹ️ NOTE: the ramp is a **scale**, and status chips are **categories** — the two axes did not merge. `BadgeVariant` still has only the five status roles, so `bad` and `poor` both key onto `destructive` and are separated by their glyphs (`signal_cellular_0_bar` vs `signal_cellular_1_bar`). Giving chips a fifth failure step would mean minting a `--quality-N-container` / `--on-quality-N-container` pair for every stop — a token-layer change with its own CVD and contrast work, deliberately not attempted here. Until someone does that work, the glyph is the channel, which is what the Every-Chip-Has-A-Glyph Rule is for.

## Colors

### The three layers

Every role in this system exists in up to three layers, and **each layer has one job**. Choosing the wrong layer is the standard failure, so the layers are named and their jobs are exclusive.

| Layer | Tokens | Job | Measured |
| --- | --- | --- | --- |
| **Ink** | `--X-on-surface` | Coloured text, numerals, chart strokes, bare glyphs, table values — on a **neutral** ground. **This is the primary mechanism.** | 0 of 28 pairs collapse, both themes |
| **Fill** | `--X` + `--X-foreground` | Compact emphasis: glyph discs, quality-bar fills, primary buttons, the active nav pill, meter fills. Small and saturated. | 0 of 28 pairs collapse, both themes |
| **Container** | `--X-container` + `--on-X-container` | Large tinted blocks. **Restricted to status chips, banners, and condition screens** — the functional roles only. | Status subset: 0 of 10. Identity: 8 of 10 collapse in light |

The restriction on containers is not taste. In light mode the usable pale-tint band (L 0.83–0.96 at low chroma) is too narrow to hold five identity hues plus `surface-container-high` above the 0.05 separation floor; an optimiser proved it infeasible rather than merely difficult. The functional roles fit because there are fewer of them and they are permitted to differ in lightness as well as hue. **So identity gets ink and outline, and never a large tinted block.**

### The ground

Neutrals carry a slight cool cast (hue 258, chroma ≤ 0.012) so they sit in the mark's family without reading as blue.

| Step | Light | Dark | Owns |
| --- | --- | --- | --- |
| `--background` | 0.985 | **0.120** | The page canvas |
| `--surface` / `--card` | 1.000 | 0.170 | Cards, the primary content plane |
| `--surface-container` | 0.967 | 0.200 | Metric-row pills, inputs, recessed blocks |
| `--surface-container-high` | 0.938 | 0.235 | One step further in: hover, stripes, muted chips |

Dark mode is genuinely near-black (`#040608`) with cards barely lifted off it (`#0d1013`), per the reference language. Light mode inverts the relationship rather than the values: the canvas is a soft grey and cards are pure white, so a card still reads as the thing in front.

### Identity — which radio

- **Primary / NR Blue** (`--primary-*`), hue **262**. The mark's blue, and the only hue in the system that *acts*. It is simultaneously the brand, the action accent, the `info` role, and the identity of the 5G NR leg. Those are one meaning wearing four hats, not four meanings — see The Info-Is-Brand Rule.
- **Carrier Violet** (`--lte-*`), hue **296**. The 4G LTE leg. It never acts and never means healthy.

Identity renders as **ink** (a coloured value, a chart stroke) or as an **outline tag**. It does not render as a large tinted block. On a glyph disc it uses the **fill**, never the pale container — light-mode identity containers collapse under simulation and the fills do not.

### Direction — which way the bytes go

- **Downlink Rose** (`--downlink-*`), hue **341**. The download direction.
- **Uplink Cyan** (`--uplink-*`), hue **200**. The upload direction.

**These mean direction and nothing else.** The previous system gave rose a second meaning ("and capacity") and cyan a second meaning ("and counts"), which made the axis untrue: a carrier-count tile wore upload cyan while reporting nothing about upload, two clicks from a latency card where the same cyan meant upload beside an up-arrow. A count is not a direction. A count is neutral.

Direction is primarily a **chart-stroke and numeral** pair now, so both carry vivid `-on-surface` inks. They always pair with an arrow glyph; hue alone never says which way.

### Spatial — how many antennas

**Spatial Azure** (`--spatial-*`), hue **232**. Antenna and spatial-stream readouts: MIMO layer counts, per-antenna chains, alignment surfaces. A MIMO figure routinely names both radios in one string (`LTE 1x2 | NR 2x4`), so no identity hue is honest, and layers are neither a direction nor a state.

### State — the functional three

`success` (149), `warning` (72), `destructive` (27). `info` resolves to the brand ramp rather than owning a fourth hue.

**Only these report health.** An identity hue never means "fine"; a direction hue never means "degraded". This is the rule the previous system broke in its own canon, where the quality scale mapped "Good" to the brand blue — so an LTE-only user saw good signal rendered in the 5G identity colour, on every surface that read the scale.

`muted` (`surface-container-high` + `on-surface-variant`) is the fourth chip role and means **deliberately inactive** — Stopped, Disabled, Offline peer. It never carries live data. A live figure on a muted ground reads as switched off.

### The signal quality ramp

A **five-stop continuous scale** for measured signal quality — RSRP, RSRQ, SINR, aim score. It is a separate axis from the functional three, and it is the only place in the system where colour is read as a position on a scale rather than as a category.

| Stop | Hue | Level | Replaces |
| --- | --- | --- | --- |
| `--quality-1` | 27 | **bad** | *new — see below* |
| `--quality-2` | 45 | poor | `destructive` |
| `--quality-3` | 72 | fair | `warning` |
| `--quality-4` | 115 | good | **`primary`** — the defect this fixes |
| `--quality-5` | 149 | excellent | `success` |

Two things changed and both are substantive.

**A fifth level exists.** `getSignalQuality()` used to return four, so everything below −110 dBm RSRP landed in one `poor` bucket: −111 and −140 rendered identically, when the first means nudge the antenna and the second means it is pointing at a wall. On an alignment meter that is the difference between a task and a dead end. The cut sits at RSRP −120, RSRQ −18, SINR −10 — a product call, not a measurement: −110 to −120 is cell edge, a link that aiming or a band lock can plausibly recover, and below that the honest message is "not this cell".

`SignalThresholds` names every member except `floor` as a **cut** (the lowest value that still earns that level). `floor` is the bottom of `signalToProgress()`'s 0–100 scale and classifies nothing. Keep the two distinct: the field now called `floor` was called `poor` while `getSignalQuality()` never read it, and adding a real `poor` cut beside it would have left a cut and a floor sharing one name.

**The ramp contains no identity hue.** Removing brand blue from the middle of a health scale is the whole reason the ramp is worth minting.

**The ramp is a lightness staircase, not a hue wheel.** Under deuteranopia, hues 27 / 45 / 72 / 115 / 149 flatten onto a single yellow axis — the ramp cannot separate by hue *at all* for those users. So each ramp is monotone in lightness (light 0.385 → 0.505 in 0.030 steps; dark 0.620 → 0.800 in 0.045 steps) and the staircase is what carries it. Adjacent stops sit deliberately below the 0.05 floor because **bar length carries adjacent distinctions**; every non-adjacent pair clears it (worst: 0.055 light, 0.077 dark).

`--quality-N` is the **numeral** ink; `--quality-N-bar` is the **bar fill**, one lightness step bolder. In light mode stops 1–3 resolve to deep reds and browns rather than vivid red-orange: 4.5:1 against a near-white ground caps those hues at L ≈ 0.50, and the non-adjacent floor then forces the span downward from that cap. This is a gamut ceiling, not a conservative choice. Where the numeral is large enough for the 3:1 threshold, use the `-bar` value as the ink instead.

### Outline tags

Identity and metadata render as **outline-and-tint**: a 1px role border, role text, transparent fill, pill radius.

| Tag | Border | Text |
| --- | --- | --- |
| NR / 5G | `--tag-nr-border` | `--tag-nr-text` |
| LTE / 4G | `--tag-lte-border` | `--tag-lte-text` |
| Spatial | `--tag-spatial-border` | `--tag-spatial-text` |
| Neutral metadata | `--tag-neutral-border` | `--tag-neutral-text` |

Text clears 4.5:1 against every card ground; borders clear 3:1. Borders separate from each other in 0 of 6 pairs collapsed, both themes.

An outline tag is **never a status indicator**. It labels *what a thing is* — a band number, a radio family, a channel width, a capability. Status is always a filled chip with a glyph. The two forms exist precisely so that "which radio" and "is it healthy" cannot be confused at a glance, which is the failure the previous single-form system kept producing.

### Data visualization

Series colour comes from the **ink** tokens directly — `--primary-on-surface` for NR, `--lte-on-surface` for LTE, `--downlink-on-surface` / `--uplink-on-surface` for a directional pair. One hue per family, so a colour learned on one card holds on the next.

- **Strokes are saturated and 2px.** A chart line is the boldest thing on its card; the card is neutral so it can be.
- **Area fills** are a gradient of the series ink, 0.32 alpha falling to 0. Monotone curves, horizontal gridlines only.
- **Threshold guides** are dashed, `--border`, low opacity.
- **Legends** use a filled dot in the series ink beside the label, never a colour-only key.
- Any added series is measured against every existing one under both simulations before merge.

**Never use the numbered `--chart-1..6`.** They are shadcn-starter inheritance with two disqualifying properties: their values are byte-identical in the light and dark blocks, so a chart built on them does not theme at all; and `--chart-1..5` sit in one hue family, so LTE and NR would be separated by lightness alone.

### Named Rules

**The Data-Ink Rule.** Colour belongs to the reading, not to the container holding it. A card is neutral; the numeral, stroke, bar, and glyph disc on it are coloured. Before tinting a surface, ask what fact the tint encodes — if the answer is "it looked plain", the surface stays neutral. Large tinted blocks are reserved for the functional roles, where the tint *is* the state.

**The Three-Layer Rule.** Ink for values and strokes on neutral ground; fill for compact emphasis; container for functional-role blocks only. Identity and direction have no container job. Never cross a pair: a fill takes its own `-foreground`, a container takes its own `on-` ink, and a neutral-ramp ink (`on-surface-variant`) on a tinted surface is always a bug.

**The In-Gamut Rule.** Every token is inside sRGB by construction. This is correctness, not polish: Lightning CSS gamut-maps out-of-range `oklch()` at build time and its mapping is not naive clipping, so an out-of-gamut token ships a colour nobody authored and measured separation computed from the source value is fiction. The previous palette had 87 such tokens; this one has zero, which is what makes "declared equals shipped" true. Any new value is checked for gamut before it is checked for anything else.

**The Measured-Separation Rule.** Colour decisions are measured, never reasoned from hue arithmetic. This replaces the old 40-Degree Rule, which was a proxy for a measurement and behaved like one: it permitted pairs that collapsed and forbade pairs that were fine, and it needed an exception every time it met real data. Simulate deuteranopia and protanopia, compute OKLab ΔE, and hold the **0.05 floor** — on the layer the colour will actually ship on. Degrees of hue separation are not evidence.

**The Identity-Never-Acts Rule.** `nr` and `lte` say which radio. They never mean healthy, never tint a control, and never appear in a quality scale. Where a surface carries identity *and* reports quality, the quality is encoded non-chromatically — the signal cards use the Material glyph's bar count.

**The Info-Is-Brand Rule.** An informational state resolves to the brand ramp. It does not get its own hue. An info chip and a primary button differ by shape and glyph, not by owning two different blues.

**The Direction-Is-Not-A-Radio Rule.** Rose and cyan say which way the bytes are going, on either radio. A download figure on the LTE leg is rose-on-violet and neither hue is guessing about the other. Neither carries a second meaning: counts and capacities are neutral.

**The Glyph-Carries-The-State Rule.** Colour is never the sole carrier. Every status chip has a glyph, no two states in one slot share a glyph, every directional readout pairs its hue with an arrow, and the quality ramp always pairs its colour with bar length. This is load-bearing rather than decorative: adjacent ramp stops are intentionally below the separation floor, and the bar is what makes that safe.

**The Neutral-Default Rule.** A figure with no honest hue stays neutral. Adding a colour because a block looked plain is the failure mode this whole system exists to prevent, and it is the one that recurs.

## Typography

**Interface font:** Rethink Sans (`--font-sans`, WOFF2 variable font via `next/font/local`), with `system-ui, sans-serif` fallback.
**Machine font:** JetBrains Mono (`--font-jetbrains-mono` → `font-mono`), self-hosted at build time.
**Icon typefaces:** Material Symbols Rounded on the shell and converted routes; lucide elsewhere. An icon font is not a voice and does not count against the Two-Voice Rule.

**Character:** Rethink Sans's rounder terminals and open counters read as warmer than geometric humanist forms, while keeping enough weight contrast to stay legible in dense label stacks at 12px. JetBrains Mono is the machine's voice: identifiers and raw strings the device emits verbatim. The pairing is the product's thesis in two fonts — a human interface reporting machine truth.

**Loaded weights:** 400 body, inputs, descriptions · 500 labels, chips, buttons, table headers · 600 card titles, section headings, numeric readouts · 700 page titles only. Rethink Sans is a true variable font (wght 400–800), so it self-hosts as two files — normal and italic — rather than a static cut per weight.

### Hierarchy

- **Display** (700, 1.875rem / 30px, -0.02em): the `h1` at the top of every feature page, followed by an `on-surface-variant` description. One per route.
- **Headline** (600, 1.25rem / 20px, -0.01em): large tile values, state-screen labels, section headings inside a hero card.
- **Title** (600, 1.125rem / 18px): the card title. `CardTitle` itself ships only `leading-none font-semibold` and takes its size from the call site.
- **Body** (400, 0.875rem / 14px): descriptions, prose, card copy, table cells. `leading-relaxed` and `text-pretty` on any paragraph over one line.
- **Row** (600, 0.8125rem / 13px on a **20px** line box): metric-row keys and values on a glance card. **The explicit leading is not optional** — 13px is an arbitrary Tailwind size, so it would otherwise inherit whatever leading the card sits in; pinning the line box is what holds the row at exactly 40px and keeps its skeleton's `h-10` mirroring it. Do not reach for 13px outside a dense metric row.
- **Label** (500, 0.75rem / 12px): chips, tags, table headers, button text, form labels, tile eyebrows. Tiny uppercase section labels run 11px with `tracking-wider` in the sidebar.
- **Numeric** (600, `tabular-nums`): any figure that changes. **This is the one step deliberately not on a fixed ramp** — a numeral is read at the distance its container implies, so its size derives from the slot holding it, and a literal `text-[Npx]` on a `tabular-nums` numeral is correct by construction. It renders in `--font-sans`, not `font-mono`. A numeral *not* sized to a slot still takes the ramp, and prose never qualifies.

### The banner-scoped step

A page-level `Banner` title is **15px / 600** with `tracking-[-0.005em]`; its description is 13px. 15px is deliberately **the only sanctioned literal outside the pre-auth scale**: a banner title has to out-weigh the copy beneath it without competing with the card heading above it, on a surface that mounts at any width on any route, and both 14px and 18px fail one of those two jobs.

### The pre-auth card exception (`/` and `/login/`)

The two pre-auth surfaces run a **denser five-step scale of their own**. It applies only to the Overview splash and the login page.

| Step | Size | Role |
|------|------|------|
| Card title | 600, 19px, -0.01em | the card's own `h1` |
| Section title | 600, 17px | the empty-state headline |
| Emphasis | 600, 15px | the 48px pill CTA label, status-tile values |
| Body | 400/500/600, 13px | subcopy, field labels, inline errors, banner body |
| Eyebrow | 600, 11px, `tracking-[0.11em] uppercase` | the label above every tile and section |

**Why.** Every other screen sits inside the app shell, where the sidebar, page title, and card grid establish scale before a card says anything. These two are the only screens that are a single card on an empty canvas, so the card must build five levels of hierarchy from nothing inside roughly 400px. 11px is the floor. **Both surfaces must agree:** when one of these steps changes, it changes on both in the same commit.

### Named Rules

**The Two-Voice Rule.** Rethink Sans is the interface, JetBrains Mono is the machine. There is no third typeface. Pairing Rethink Sans with another UI sans (Inter, Geist Sans, IBM Plex, Roboto, Manrope) is forbidden.

**The Machine-Voice Rule.** `font-mono` is scoped to machine truth that is not itself a changing figure: identifiers (band, EARFCN, PCI, ICCID, IMEI, MAC/IP), static facts read back from config, raw AT responses, log lines, copyable commands. A human-authored label never wears it. A live measurement — RSRP, throughput, a countdown — is the interface *reporting* a number, so it takes `--font-sans` and `tabular-nums`. The tell: does the value change while the user watches without them acting? Then `font-sans`. Does it hold steady until something reconfigures it? Then `font-mono`.

**The Weight-Discipline Rule.** 400 body, 500 labels and medium emphasis, 600 headings and numerics, 700 page titles only.

**The Tabular-Number Rule.** Any figure that can change while on screen is `tabular-nums`, in whichever voice it is already in. The class controls digit-width jitter; it does not decide which voice owns the value. A latency readout whose digits shift width reads as the layout twitching, not as the value moving.

**The Truncation-Pair Rule.** Where two cards sit side by side as a pair, every text node in their headers carries `min-w-0` and `truncate`. One card wrapping to two lines while its sibling stays at one breaks the paired baseline. Italian is the locale that trips it.

## Layout

**Every feature page is the same shape:** a page header (display title plus a muted one-line description, with optional pill actions right-aligned) followed by a uniform grid of self-contained cards. There is no bespoke per-screen composition. A user who learns one page has learned them all.

**Responsive behavior is container-driven.** The content column declares `@container/main` and cards respond with `@3xl/main:`, `@4xl/main:`, `@5xl/main:`. A card that declares its own `@container/card` uses `@sm/card:` and `@md/card:` inside itself. Mixing viewport `sm:` with container `@sm/card:` in one card breaks on tablets and expanded sidebars. Viewport breakpoints stay for page-level concerns only: the gutter (`px-4 lg:px-6`) and the sidebar's own collapse.

**The grids that ship.** The dashboard is a 5-column container grid (`@4xl/main:grid-cols-5`) with a 3-column left stack and a 2-column right rail, then full-width rows beneath. Radio Information is a **single-column stack of full-width cards ordered by cadence** — what moves every poll above what moves on handover — under a 4-up tile strip. Both collapse to a single column with no special-casing.

> Radio Information was once a symmetric 2-up with both cards `h-full`-locked to each other. That is a split by **symmetry**, and symmetry is not a property either card has: the lock forced a static reference card and a live telemetry card to one height, stranding ~200px of dead space in whichever had less to say — and which one that was flipped with the carrier count. **Split a page by cadence, not by symmetry**, and let each card size to its own content.

**Spacing rhythm.** Page gutter 16px rising to 24px. Card grid gap 16-24px; tile grid gap 14px; in-card row gap 6px; inline element gap 8-10px. Card padding is 24px (`px-6`) standard and 28px (`px-7`) on hero cards, with 24-26px vertical.

**Equal heights are explicit.** A grid row of cards uses `h-full *:data-[slot=card]:h-full` on each cell so cards match rather than each sizing to its own content.

**Field ergonomics.** Touch targets are a minimum 44px on coarse pointers; icon-only tab lists bump `TabsList` height rather than shrinking triggers. Toolbars `flex-wrap`. Tables wrap prose columns and treat horizontal scroll as a fallback.

### The pinned console

A surface whose primary reading must never leave the screen splits into a **sticky anchor column and a scrolling work column**, with any full-width strip below both rather than inside either. Antenna Alignment is the first instance: at `@4xl/main` a 12-column grid gives the console 5 and the work column 7, and Receive Chains spans the full width beneath the split.

Three facts about it are load-bearing, and all three live in `components/cellular/antenna-alignment/shapes.ts`:

- **The console column must stretch.** A sticky child travels inside its own containing block, so its slack is the parent's height minus its own. An `items-start` tidy-up shrinks the column to the console's own height, the slack goes to zero, and the pane never pins — while looking perfectly correct in a static screenshot. The grid's default `stretch` is the feature, not an oversight.
- **A full-width strip is a different card from a column card.** In the work column the diagnostic "footnote" was the tallest card on the page, and the columns ran 929px against 403px — half a desktop viewport of empty canvas, growing with content because that gap *is* the sticky travel. Below the split the two columns close to within ~20px and the strip earns its 4-up step.
- **Mobile order is question order** — console, positions, chains — and moving a card between a column and a full-width row must not disturb it.

**A per-family `shapes.ts`.** `components/cellular/antenna-alignment/shapes.ts` is the seventh of these modules under `components/cellular/**`, on the same conventions as `settings/shapes.ts` and `cell-scanner/shapes.ts`: one module per route family owning geometry, control heights, glyph sizes and tone maps, imported by the loaded views *and* by their skeletons. Geometry is restated across sibling families, never imported from one; anything genuinely family-wide is promoted to `components/cellular/` instead (`tile-shape.ts`, `signal-quality-display.ts`). Without one, this surface had accumulated four byte-identical card-shell strings across three files, three control heights inside one card, five glyph sizes, and two letter-spacings for a single label role — none of it visible in any one file, which is why it survived.

### Named Rules

**The Consistent-Layout Rule.** Page header plus a uniform card grid, on every feature page. A bespoke hero-driven layout invented for a single screen is a consistency failure even when it looks good in isolation. A genuine glance surface may earn a hero card; it is a rare exception, never the default.

**The Card-Wrapped Surface Rule.** The unit of composition is the **card that wraps a settings group**, not the page. The card owns its whole content; the page only arranges cards. A feature that scatters loose fragments across the viewport has skipped the card.

**The Container-Query Rule.** New responsive behavior is a container query against `@container/main` or a card-local `@container/card`. Reach for a viewport breakpoint only for the page gutter or the shell itself.

**The Sticky-Slack Rule.** A sticky pane's travel is its parent's height minus its own, so the column holding it stretches. When a "pinned" element never moves, check the column's alignment before the offsets.

**The Grid-Step-Costing Rule.** Cost a responsive grid step against the narrowest cell it produces **in the column it actually lives in**, never against the page width. A 4-up step that is safe full-width at `@3xl` collapses the bar lane to nothing inside a 7-of-12 column at the same breakpoint — which is the named bug of ramp ink on a numeral with no bar beside it.

## Elevation & Depth

**Depth is tonal, not cast.** A surface separates from its parent by sitting one step along the neutral ramp — canvas, then surface, then surface-container, then surface-container-high.

The reason is now structural rather than environmental. The previous justification was sunlight legibility, and that requirement has been retired. What remains is stronger: **this system has no colour to spare for chrome.** Colour is spent on data, so a shadow would be the only other separation mechanism — and in near-black dark mode a shadow is invisible against the ground, which means a shadow-separated layout has no dark theme at all. The tonal step works identically in both themes. A shadow does not.

### Shadow Vocabulary

- **Whisper** (`0 1px 2px oklch(0.205 0.011 258 / 6%)` in light, resolving to `0 0 #0000` in dark): an optional card lift. Light mode's canvas-to-card step is 0.985 → 1.000, a deliberately narrow gap, and the whisper is what keeps that edge legible without a hairline. Never load-bearing.
- **Popover Float** (`shadow-lg` and up, via shadcn defaults): dialogs, dropdowns, popovers, the skip-to-content pill. The "not part of the page flow" signal, and the one place a shadow carries real meaning.

### Named Rules

**The Tonal-Elevation Rule.** Two surfaces at different conceptual elevations differ by at least one container step. If two surfaces are only distinguishable by their shadow, one of them is on the wrong step of the ramp.

**The No-Hairline-On-Fill Rule.** A tonal container never also carries a border. Cards ship `border-0` explicitly, because a hairline over a fill reads as chrome around the colour rather than as the edge of a block. **The outline tag is the one deliberate exception in the system** — there the border *is* the component, because there is no fill for it to sit on top of. `--border` is otherwise for input strokes and genuine table rules only.

**The Highlight-by-Container Rule.** Emphasis promotes a surface one container step and changes its ink, rather than adding a translucent wash over a neutral card. A recommended alignment slot becomes a `primary-container` block; a running pipeline step becomes a `primary-container` row.

## Shapes

Radius carries size hierarchy: the bigger and more important the surface, the softer its corners.

| Step | Value | Owns |
|------|-------|------|
| `rounded-inline` | 0.75rem (12px) | Small inline affordances, code blocks, skeleton slivers |
| `rounded-field` | 1.25rem (20px) | Inputs, selects, small popovers, banners |
| `rounded-tile` | 1.75rem (28px) | Inner tiles, carrier tiles, alignment slots |
| `rounded-card` | 2.25rem (36px) | Standard cards in a grid, dialogs |
| `rounded-hero` | 2.5rem (40px) | The anchor card on a surface, the aggregation strip, state screens |
| `rounded-pill` | 9999px | Chips, tags, buttons, nav items, metric rows, meters, glyph discs, quality bars |

The distinction between `card` and `hero` is real and used: a grid of peer cards takes `card`; the one card that anchors a surface takes `hero`.

The silhouette this produces is deliberate: **soft, generously-rounded rectangles containing full-round elements**. Fills over strokes, round caps on every meter and progress track, no side-stripe accent borders. Nothing has a square corner except a table rule and a chart gridline. The mark follows the same construction — two shapes, two tones, one hue, no gradient, no shadow — and UI shapes read as members of that family.

### Named Rules

**The Radius-Follows-Size Rule.** A surface's radius is a function of its size and role, not of taste. A 28px tile never sits inside a 20px field, and a banner never out-rounds the card it sits on.

**The Fill-Over-Stroke Rule.** When a shape needs to be distinguished from its neighbour, change its fill, not its border. The outline tag is the sanctioned exception, and it is a *component*, not a technique to generalise.

**The Role-Radius Rule.** New work uses the role scale above. The legacy `rounded-{sm,md,lg,xl}` chain off `--radius: 0.65rem` still resolves for unconverted call sites and keeps its old values, but it is never the correct choice in a new component.

## Motion

**Character: expressive in duration and curve, and still settled.** The expressiveness is in the easing, never in overshoot — which is what keeps it compatible with a tool whose job is holding a connection alive. `lib/motion.ts` is the JS source of truth and mirrors the CSS custom properties in `globals.css`; retune one layer and you retune the other in the same change.

**Durations.** `quick` 360ms (label swaps, value ticks, hover tints, focus rings) · `standard` 600ms (the default for a state change — card entrance, nav indicator, chip morph, meter retarget) · `emphasized` 800ms (container size and shape, aggregation re-proportioning, banner arrival, meter first-fill) · `ambient` 2s (the two sanctioned loops only).

**Why these are double the Motion Guide's printed figures.** The guide's token table reads 400/300/180ms, and those are the numbers it *renders at 1x* — but every demo in it is authored as `calc(<loop> * var(--sp))`, driven by a Playback control that sets `--sp` to `1 / speed`. Playback exists because, in the guide's own words, half or quarter speed "is the only way to actually inspect a 180ms token". Reviewed at that 0.5 setting — exactly this scale — the system reads as deliberate rather than snappy. **The guide's figures are the inspection baseline; the figures above are the shipped scale, and this document wins.** The *ratios* are untouched (3 : 5 : 6.67), which is what keeps every composed gesture in shape.

`ambient` is deliberately **not** doubled. A loop is not a transition, and it is the one animation that means "this is alive" — at 4s a breathing ring reads as a stalled UI rather than a calm one.

**Curves.** `emphasized` `cubic-bezier(0.05, 0.7, 0.1, 1)` — a deliberate departure and a long settle. `standard` `cubic-bezier(0.2, 0, 0, 1)` — the everyday state change. `quick` is a plain `ease-out`, deliberately: at the short end of the scale a bespoke cubic is indistinguishable from the built-in. **These two curves and `ease-out` are the whole vocabulary** — an `ease-[cubic-bezier(...)]` arbitrary value in a className is a violation, not a variant, and so is a bare `ease-linear` outside a data-driven progress bar.

**Entrances.** Two stagger steps, and only two. Cards cascade at **120ms** with a 10px rise (`staggerContainer` / `staggerItem`); rows inside one card cascade at **80ms** with a 5px rise (`staggerRows` / `staggerRowItem`). A list cascade bounded by row count uses `rowCascadeDelay(index)`, which derives both the step and its ten-row cap from `STAGGER_STEP_ROWS`. Rows sit ~6px apart, so a 10px lift would move each row past its neighbour's resting position and read as the card reflowing rather than as content arriving. Nested containers inherit `visible` from their parent and must **not** declare their own `initial`/`animate`, or they detach from the parent's clock. Cascade children must be block boxes — a bare `span` silently drops the rise.

**The live value tick.** A poll-driven figure dips to 0.35 opacity and returns, asymmetrically — 600ms down, 800ms up — so the dip is the event and the return is the settle. Figures within one `TickGroup` stagger 200ms apart by live DOM position, not by map index. **This is the tightest thing in the system against the poll:** a full seven-figure cascade runs 1.4s of lead plus a 1.4s dip, and the measured poll cadence is ~3.7-4.0s (not the ~2s the Motion Guide assumes — the poller's `sleep 2` runs *after* the cycle body). ~900ms of headroom. Re-check that arithmetic before raising the scale again or making the poller faster. Only *measurements* tick; identifiers take the container morph instead, because dipping a value that holds steady for minutes invents an event. A value that moves again mid-dip retargets rather than queueing.

**Reduced motion** is handled by one global switch in `components/motion-provider.tsx`, which is why every shared variant is pure transform and opacity. Raw CSS keyframes carry their own `@media (prefers-reduced-motion: reduce)` block beside them. Movement goes, opacity stays: a crossfade is still legible information where a slide is not.

That switch has **three** states, not two. `MotionConfig reducedMotion="user"` is only the *default*; the animations preference below can outrank it in either direction.

### The animations preference

The sidebar account dropdown carries an **Animations** row cycling System / Full / Reduced, beside the theme row. The whole contract is one attribute on `<html>`:

| Choice | Attribute | `MotionConfig reducedMotion` |
| ------ | --------- | ---------------------------- |
| System (default) | **absent** | `"user"` |
| Full | `data-motion="full"` | `"never"` |
| Reduced | `data-motion="reduced"` | `"always"` |

**The absence of the attribute is load-bearing.** "System" *removes* it rather than writing `data-motion="system"`, and that absence is what lets the bare media query decide. The key, the type and the pre-paint boot script live together in `lib/motion-preference.ts`; `app/layout.tsx` injects the boot script render-blocking, because an attribute landing in a mount effect arrives *after* first paint — a user on Reduced would see one frame of every entrance animation, precisely the frame they asked not to see.

**The load-bearing part is the CSS half.** Tailwind's stock `motion-reduce:` compiles to a bare media query with no selector hook, so an attribute on `<html>` *physically cannot* override it. Both variants are therefore redefined as `@custom-variant`s at the top of `globals.css`, each emitting `@slot` twice — once media-gated with the opposing attribute excluded, once attribute-gated.

> ⚠️ **`motion-safe` needs the same treatment, and this is the half that is easy to skip.** Without it, a user on OS-reduce who explicitly picks **Full** gets every `motion-safe:` spinner frozen — the exact inverse of what they asked for. Redefine both or neither.

Both guards are wrapped in `:where()` so they contribute **zero** specificity. The two variants can match simultaneously; duplicate identical declarations are harmless.

### Named Rules

**The Motion-Ceiling Rule.** Nothing exceeds `emphasized` (800ms), and `emphasized` is the ceiling, not a starting point. State the rule as *the token*, never as the number.

**The One-Scale Rule.** A duration in a component is a bug. Every transition reads `duration-[var(--duration-standard)]` (or `-quick` / `-emphasized`) in a className, or `DUR.standard` in a `motion/react` transition; a bare `duration-200`, an inline `{ duration: 0.25 }`, or a `transition-all` with no duration (silently inheriting Tailwind's 150ms) is off the scale and will not retune with it. The exceptions are narrow and each carries a comment: continuous loops with their own tempo, and linear data-driven progress bars. `{ duration: 0 }` as a reduced-motion escape is always fine.

**The Non-Load-Bearing Rule.** If a transition never runs — reduced motion, a backgrounded tab, a paint that beat the animation — the UI must already be correct. Every entrance keyframe is written open-ended (`from` with no `to`): the resting value is the truth and the keyframe only describes the journey. A `requestAnimationFrame`-armed state flip breaks this rule, because rAF does not fire in a background tab.

**The Transform-Only Rule.** Animate `transform` and `opacity`. The single sanctioned `width` animation is the carrier-aggregation segment, where the width *is* the data and a `scaleX` would distort the band labels riding inside it. Meters animate `scaleX`, never `width` — on a CPU also carrying the user's traffic, a per-poll layout pass per meter is not free.

**The One-Loop Rule.** At most one ambient loop per surface, and only where something is genuinely live. Two exist product-wide: the service-ring pulse and the live-ping dot.

**The No-Overshoot Rule.** Never springy, never elastic, never rubber-banding. The one sanctioned overshoot is the save-confirmation check at 1.03 scale — and it is a **number**, not a sentence: `SAVE_CHECK_OVERSHOOT` / `SAVE_CHECK_KEYFRAMES` / `transitionSaveCheck` in `lib/motion.ts`. Anything that wants the pop imports the constant. A ceiling enforced only by prose is not a ceiling — this rule once cited the save check as the sanctioned exception while the button underneath ran an underdamped spring whose peak was bounded by nothing.

**The Enter-Only Rule.** Conditions and navigation have no exit animation. A banner leaving means the condition cleared and that should feel immediate; an outgoing route is already gone, and animating it out only delays the incoming one.

**The Modal-Exit Rule.** A modal's exit duration is an **input-latency budget**, not a taste call, and every modal surface writes its two directions separately: `data-[state=open]:` on `emphasized`, `data-[state=closed]:` on `quick`. Never one unqualified `duration-*` for both.

The reason is mechanical. Radix sets `pointer-events: none` on `<body>` for as long as a modal layer is mounted, and `<Presence>` holds that layer mounted until `animationend` fires on the content node. So **the entire page is click-dead for exactly the length of the exit animation.** An unqualified `emphasized` buys 800ms of dead clicks every time a dialog closes; a scrim with no duration leaves the backdrop on tw-animate's off-scale 150ms default, so the page *looks* live for the final 650ms of the lockout. On a dialog-dense surface that reads as the app dropping input.

- **The scrim shares the content's clock in both directions.** They are one object arriving and leaving; an overlay with no duration is a One-Scale violation *and* the thing that turns a slow exit into an apparently broken one.
- **`quick` is the ceiling for a modal exit, not a suggestion.** Distance does not buy budget: a sheet travels a full viewport edge and still exits on `quick`.

## Components

### Buttons

- **Shape:** full-round pill, 42px tall (`h-[2.625rem]`), 20px horizontal padding, 600 weight.
- **Primary:** brand fill with its own `-foreground` ink. The default for main actions — Record, Save, Apply — never `outline`.
- **Tonal:** `primary-container` with `on-primary-container`. Secondary actions of equal standing.
- **Destructive:** destructive fill with `destructive-foreground`. Never `text-white` hardcoded — dark-mode destructive is a *light* fill.
- **Ghost / outline:** transparent or hairline, `on-surface-variant` ink, `surface-container` hover.
- **Focus:** a 3px `--ring` ring at 50% on the `quick` clock.
- Use `SaveButton` for save actions. It owns all three states (idle label → spinner + "Saving…" → check + "Saved!"), the 1.03 check, and the **width lock**: the three layers share one grid cell and stay mounted, so the pill sizes to the widest of them per locale and a toolbar never reflows mid-save. Never `AnimatePresence` around them. Pass a **translated** `label`.

### Chips and tags

**Two forms with two jobs, and the split is the point.** The previous system had one form doing both, which is how "which radio" and "is it healthy" kept getting confused.

**Status chips — filled.** The five status roles in `components/ui/badge.tsx`: `success`, `warning`, `destructive`, `info`, `muted`. A role container fill, that container's `on-` ink, no border, pill radius, and a **mandatory** 12px glyph. The variant is the whole API: never hand-write the classes. Fill and ink transition on `standard`, the focus ring on `quick`. Hover is `[a&]:`-scoped, so a static chip never advertises a click target that does not exist.

```tsx
<Badge variant="success">
  <CheckCircle2Icon className="size-3" />
  Active
</Badge>
```

**Outline tags — identity and metadata.** `nr`, `lte`, `spatial`, `neutral`. A 1px role border, role text, transparent fill, pill radius. A glyph is optional here, because an outline tag reports *what a thing is* rather than whether it is well — there is no second state for a glyph to disambiguate.

```tsx
<Tag variant="nr">5G NR</Tag>
<Tag variant="neutral">n78</Tag>
```

The forms are not interchangeable. **An outline tag is never a status indicator, and a filled chip never carries identity.** `muted` covers deliberately-inactive states (Stopped, Disabled, Offline peer); failure is `destructive`.

Tone maps key onto the exported `BadgeVariant` / `TagVariant` types, never onto a class string, so a new tone without a matching role fails the build.

### Cards / Containers

- **Corner:** 36px in a grid of peers, 40px for the anchor card on a surface.
- **Background:** `surface`, with `border-0` explicit and `--shadow-whisper` optional in light.
- **Padding:** 24px standard, 28px on hero cards.
- **Header:** plain `CardTitle` plus `CardDescription`. **Never an icon in the card header** — icons belong in glyph discs, tags, or a separate action area.

### Tiles

The inner unit of a glance surface: a 28px-radius block at a **pinned** 104px height, holding a 52px full-round glyph disc beside a text column of eyebrow → value → caption.

**A tile body is neutral. The disc carries the colour.** This is The Data-Ink Rule at tile scale, and it is what the previous four-tinted-tile composition got wrong: four pale bodies at near-identical container lightness encode category without encoding importance, so the strip flattens to equal weight and the eye has nowhere to land. A neutral body with a saturated disc gives the tile a focal point at 1/8th the tinted area.

**The height is pinned, not floored.** A `min-h-` made the skeleton a lie: measured live, tiles resolved to 118 / 98 / 95px against a 92px skeleton, a 26px jump at the handoff. A floor cannot be a mirror; only a pin can. Geometry lives in `components/cellular/tile-shape.ts` so a strip and its skeleton cannot drift.

### Metric rows

Two answers, and this is the one place the system deliberately has two.

- **Glance surfaces** use full-round pills on `surface-container`: 40px tall, 16px horizontal padding, a 13px/600 `on-surface-variant` key against a 13px value — `font-mono` when that value is an identifier, `font-sans tabular-nums` when it is a live measurement. No dividers. **A value that carries quality takes its ramp ink here**, which is the row-level equivalent of WiFiman's coloured dBm figure.
- **Genuine data tables** (cell scanner results, SMS inbox, log views) keep hairline rows on `--border`, because density survives there where pills would not.

### Quality bars

The row-level data graphic, and the non-chromatic half of the quality ramp.

- A full-round track on `surface-container`, 4px tall. It spans the row where the row is the bar's own line, and shrinks to a **56px lane** where it has to sit inline beside the figure it belongs to (the dashboard signal rows, the tower-locking carrier tiles). A lane is the right answer when a full-width bar under the last line would read as a coloured bottom border rather than as a gauge.
- The fill is `--quality-N-bar`, its **length** proportional to the value within the metric's physical range.
- Length is the primary encoding and colour is the reinforcement — which is what makes adjacent ramp stops safe below the separation floor. **Ramp ink on a numeral without a bar beside it is a bug**, and so is a ramp tone on a fill whose length does not encode the value.
- A missing reading renders an empty track, never a zero-length red fill: an unused antenna drawn as an empty red bar labelled "−140 dBm" reads as a signal problem the user should go and fix. In code that is `MetricBar value={null}`, which omits the fill element entirely — and `qualityMeterTone()` returning `null` rather than a colour, so no caller can `??` a fallback in.
- **A track is invisible chrome only while it is darker than its ground.** The default `surface-container-high` track is right on `surface` and on `surface-container`; on a lighter ground it renders *lighter* than what it sits on and reads as a second, paler segment continuing past the end of the fill. `MetricBar` takes `track="muted"` there — needed on Antenna Alignment's winning `primary-container` row, where the false extra length landed on the one row that answers "which position won", and inside its `surface-container-high` pinned readout.
- The **entrance** is `scaleX` (compositor-only, once, on mount). The **value retarget** is layout `width`, not `scaleX`: a transform scales the whole box including its `border-radius`, so at low percentages a `scaleX`-only fill squashed its own pill cap into a near-flat ellipse. Width changes only on a poll retarget, not per frame, so the usual objection to animating width does not apply here. See the comment in `components/ui/metric-bar.tsx` before changing this back.

### Inputs / Fields

- **Shape:** 20px radius, 42px tall, `surface-container` fill, no visible border at rest.
- **Focus:** a 3px `--ring` ring at 50%; the fill does not change.
- **Invalid:** destructive ring plus destructive border, driven by `aria-invalid`.

### Navigation

The sidebar rail sits one step off the canvas so it reads as chrome, not content. Nav rows are full-round, 16px horizontal padding, `text-sm`.

The active row is the system's signature motion: **one** `primary-container` pill per group, absolutely positioned, whose transform is driven from React so it *slides* between rows rather than appearing. The row goes transparent and takes `on-primary-container` ink at 600 weight, and its Material glyph animates its `FILL` axis from 0 to 1. That FILL change is an accessibility affordance, not polish: it is what makes the active state survive grayscale. The pill's first paint is non-animated (`data-settling`), so it starts under the active row rather than sliding up from zero.

### Banners

Two primitives, split by where they mount. **`Banner`** is page-level: named system roles, a CTA slot, a dismiss slot, a 36px disc, lucide glyphs (it mounts on every route, so the Icon-Boundary Rule pins it to lucide). **`TonalBanner`** is card-scoped: three tones, no CTA, no dismiss, a 32px disc, Material glyphs.

Both share the rules. A banner is `bg-{role}-container` with `text-on-{role}-container` — never a wash, because a 10% alpha over a tinted surface collapses in dark mode. Its icon always sits in a filled disc on the role's **strong** fill. Radius is 20px, so it never out-rounds its host. Informational banners use `primary-container`. A figure that ticks inside banner copy is `tabular-nums` in the interface font. Entrance is `.animate-banner-in` (`emphasized`, 6px rise plus fade); there is no exit.

Banners are one of the three sanctioned container uses, and the reason is that a banner *is* its state — the tint is the message, not decoration on top of one.

### Signature surfaces

- **Carrier Aggregation strip** — a full-width 40px-radius hero whose segments are proportional to each carrier's bandwidth. Segment width animates on `emphasized`; a newly-added carrier grows from zero so the chain reads as "something arrived" rather than "everything shuffled". A released carrier stays visible and **explicitly marked** rather than silently disappearing, and the list **freezes** while data is stale rather than announcing releases that never happened.

  > A released carrier must not be distinguished from an active LTE carrier by tone alone. Measured, `lte-container` and `surface-container-high` were **identical** under deuteranopia — 0.0000 separation — so "dropped" and "live LTE" were one swatch. The distinction is now carried by a glyph or a strikethrough, with tone as reinforcement.

- **Signal status cards** — the paired NR / LTE cards. An identity-tagged card whose **glyph bar count** carries quality (five wedge glyphs, monotonically decreasing — the `signal_cellular_{1..4}_bar` family, never the `alt` family, whose 1-bar mark is a 2×4px speck and which has no 0-bar at all), then a stack of metric row pills with **ramp-inked values and quality bars**. Every tinted value carries an `sr-only` quality word.

- **The radio summary strip** — the four-tile grid above Radio Information's cards. Four 104px tiles at `rounded-tile`, one per track at `@xl` and four across at `@5xl`. Neutral bodies; each disc carries its axis colour — identity fill for Network, downlink for Bandwidth, neutral for Carriers (a count is not a direction), spatial for Active MIMO. The same `TILE_SHAPE` backs the Antenna Statistics context tiles and the SMS Center strip, so all three are dimensionally identical and each skeleton is a real mirror.

- **The pinned aim readout** — the phone-width counterpart to a sticky anchor card, and the pattern for any surface whose live reading has to survive scrolling. A **zero-height** sticky wrapper placed first in the page column: it pins for the page's entire scroll range and contributes no layout, so the resting page is not 64px taller for a readout nobody has summoned, and the 64px pill overflows downward out of it. It is a *separate element*, never the anchor card collapsing — a collapse animates height, and this system's motion is transform and opacity — so the two crossfade on **opacity alone**, driven by an `IntersectionObserver` sentinel that defaults to hidden if the observer never fires. Behind the pill sits an **opaque shade spanning the page gutter and the gap above it**, carrying the same crossfade: without it the page scrolls through the transparent band over the bar's head, and a button sliding across the top of the viewport reads as a z-index bug rather than as a pinned element. The pill sits one tonal step above the rows it pins over (`surface-container-high` against their `surface-container`) and keeps a key label, because at equal tone and identical geometry — same height, same pill radius, same numeral-plus-meter anatomy — a floating instrument reads as a slot that has come loose.

- **Comparison rows on a shared scale** — where a surface exists to answer *which of these won*, the candidates are 64px pill rows at every width rather than a grid of tiles, and their `MetricBar` lengths share **one** 0–100 composite, so the answer is read by length instead of by comparing three numerals against each other. The winner is a `primary-container` row per Highlight-by-Container, and its numeral drops the ramp ink for `on-primary-container`: the ramp is computed for 4.5:1 against a card ground, and quality is still carried by bar length plus an `sr-only` verdict, which is the non-chromatic channel the rule actually asks for. **Two absences are distinguished, deliberately.** A row that was never recorded draws **no track at all** — nothing was measured, so there is no scale to show, and three empty rules across a desktop card would be pure chrome. A row that was recorded but cannot be ranked keeps `MetricBar value={null}` and its **empty track**, because there the track is the honest report of a measurement that came back with nothing.

- **Condition state screens** — non-registered modes *replace* the body rather than render it empty. A 40px-radius container in the condition's tone, a 56px filled disc, a headline, a description, and an optional retry pill drawn from the container's **own** ink at 10-15% — never a white wash, which is invisible on a light container. Tone is chosen per condition: no-SIM is `warning` (a real fault the user can fix in situ), no-service is `destructive` (the link is down), searching is `info` (transient), unknown is neutral. Only `searching` spins — a spinner on a standing condition advertises work that is not happening. No two states in one slot may share a glyph.

  This is the third sanctioned container use, for the same reason as banners: the whole block *is* the state.

### Icons

Two libraries, and the boundary is **per route**, never per directory.

| Library | Owns |
|---------|------|
| **Material Symbols Rounded** | The sidebar, `/dashboard`, the two pre-auth routes, and the **entire `/cellular/` family** — index plus all 17 sub-routes |
| **lucide-react** | Every other route: `/local-network/`, `/monitoring/`, `/system-settings/`, `/about-device`, `/support`, onboarding — plus every route-agnostic primitive wherever it mounts |

Mixing two icon sets inside one screen is precisely what the rule prevents, so a lucide glyph on an unconverted route is *correct code*, not a defect — and a route-agnostic component stays on lucide even when it mounts inside a Material route, because it cannot know where it will appear. Convert a whole route or none of it.

`MaterialSymbol` sets `fontSize` as an inline style, which outranks any utility — so a parent's auto-sizing rule for lucide children (`[&>svg]:size-3`) cannot reach it. **Pass `size` explicitly at every Material call site.** The typeface is ligature-driven, which is why these spans are always `aria-hidden` beside a real text label, and why the glyph list is a single source of truth shared with the font-subsetting script.

Three deliberate exceptions survive on the dashboard's Network Status card: the SIM orb keeps lucide `CardSimIcon`/`Plane`, and the RAT marks keep `react-icons/md`, because "5G", "4G+" and "3G" are typographic marks Material Symbols has no equivalent for.

### The three-state pattern

Every data surface ships **loading**, **empty**, and **error** — never a blank panel.

Skeletons mirror the loaded geometry *exactly*, and by shared constant rather than by estimate. Sizes are the loaded element's **line box**, not its font size — a skeleton sized to the glyph reflows the moment real text lands. The handoff is a pure crossfade on `quick` with the outgoing skeleton overlaid *on top of* real content, so the card is sized by its content from the first frame and the crossfade contributes zero layout shift.

### Named Rules

**The Two-Form Rule.** Status is a filled chip with a glyph. Identity and metadata are an outline tag. Neither form ever does the other's job, and a component that needs both renders both.

**The Every-Chip-Has-A-Glyph Rule.** Status containers are close by construction — the functional roles share a narrow tint band, and `success-container` against `warning-container` has measured as low as **1.03:1**. The glyph is what separates healthy from degraded. Two states in the same slot must never share a glyph either.

**The Identity-Chip Rule.** Where a surface carries identity *and* reports quality, the quality is encoded non-chromatically. On the signal cards that channel is the Material glyph's bar count; on a metric row it is the quality bar's length.

**The Glyph-Disc Rule.** A state or category icon sits in a filled circle on the role's **strong** fill, never on the pale container. In light mode the identity containers collapse under simulation and the fills do not, so the disc is the only place identity colour is reliably legible.

**The Skeleton-Mirror Rule.** A skeleton mirrors the loaded geometry by importing the same shape constant, never by restating numbers. A `min-h-` is not a mirror.

**The Loader-and-Dots Rule.** Step or sample progress is a `Loader2Icon` spinner plus dot indicators. Fill and progress bars are reserved for data visualization — signal strength, quality meters, bandwidth share.

**The Age-Gated Tone Rule.** On a surface listing *history*, two independent axes decide how a row is drawn. **Tone** is what kind of thing happened; it is a fact about the event, never expires, and is carried by a filled icon disc in the solid role colour for as long as the row exists. **Weight** is how much the row still deserves attention, and it does expire: a row keeps its tonal container while it is fresh (one hour) **or** unresolved, then settles onto `surface-container` with its disc at full strength. The disc never consults the age gate. Note that `severity: "info"` here means *routine*, not *good*.

**The Dismiss-Only-Notices Rule.** A banner gets an X only when it is a *notification*. A standing condition has no dismiss, because dismissing it would hide a fact that is still true.

**The State-Honesty Rule.** A status surface reports what is actually running — saved settings, live service state — never the half-edited form. A control that cannot currently work explains why instead of sitting there dead. A test only runs against saved config. An ambient animation only loops where something is genuinely live.

**The No-Dot-Separator Rule.** A meta line joining two or more short facts (`PCI 135`, `EARFCN 9485`) uses plain spacing, never a `·` glue character. Give the facts room instead of punctuating between them.

## Do's and Don'ts

### Do:

- **Do** put the colour on the reading — the numeral, the stroke, the bar, the disc — and leave the card neutral.
- **Do** pick a **layer** before a colour: ink for values on neutral ground, fill for compact emphasis, container for a functional-role block.
- **Do** pick a **pair** — a fill with its own `-foreground`, or a container with its own `on-` ink.
- **Do** give every status chip a glyph, and give two states in the same slot two different glyphs.
- **Do** use an outline tag for identity and metadata, and a filled chip for state.
- **Do** pair the quality ramp with bar length, always.
- **Do** measure a new colour — gamut first, then contrast, then deuteranopia and protanopia against the layer it will ship on.
- **Do** reach for the role radii (`rounded-tile` / `card` / `hero` / `pill`) in new work.
- **Do** ship `border-0` on a card and let the tone step carry the separation.
- **Do** write responsive behavior as a container query against `@container/main`.
- **Do** wrap a settings group in a card and let the page arrange cards.
- **Do** put `min-w-0 truncate` on every text node in a paired card's header.
- **Do** mark every changing figure `tabular-nums` in `font-sans`, and reserve `font-mono` for identifiers.
- **Do** mirror a skeleton's geometry from the same exported shape constant the loaded view uses.
- **Do** build the loading, empty, and error state in the same change as the loaded one.
- **Do** pass `size` explicitly at every `MaterialSymbol` call site.
- **Do** keep interactive targets at 44px on coarse pointers, and let toolbars wrap.
- **Do** make a status surface report *saved* state, and make an incapable control explain itself.
- **Do** defer anything that reboots the modem behind a dialog plus a persistent banner.
- **Do** key every new user-visible string across all five locales; `bun run i18n:check` gates it.

### Don't:

- **Don't** tint a large surface because it looked plain — that is the failure this system exists to prevent.
- **Don't** give identity or direction a large container block; they are ink, outline, and disc only.
- **Don't** put ink from one role on another role's surface, or a neutral-ramp ink on a tinted one.
- **Don't** hardcode `text-white` on a destructive fill — in dark mode that fill is *light*.
- **Don't** compensate for a mismatched pair with an alpha (`bg-destructive/60`); fix the pair.
- **Don't** use an outline tag as a status indicator, or a filled chip as an identity label.
- **Don't** use `nr` or `lte` to mean "healthy", or put an identity hue anywhere in a quality scale.
- **Don't** ship an out-of-gamut `oklch()` — the build will map it and you will not have authored what ships.
- **Don't** argue a colour decision from degrees of hue separation; measure it.
- **Don't** use the numbered `--chart-1..6`; they do not theme.
- **Don't** put a border on a tonal container, or use `--border` as a card edge.
- **Don't** distinguish two states by tone alone when one of them is a released, disabled, or absent thing.
- **Don't** animate `width` (the aggregation segment is the sole exception) or exceed `emphasized`.
- **Don't** write a raw duration (`duration-200`, `{ duration: 0.25 }`) or a `transition-all` with no duration.
- **Don't** add a third stagger step, a fifth duration, or a spring.
- **Don't** add an exit animation to a banner or a route transition.
- **Don't** give a modal one unqualified `duration-*` for both directions, or leave its scrim without one.
- **Don't** loop an animation where nothing is genuinely live.
- **Don't** put an icon in a `CardHeader`.
- **Don't** invent a bespoke hero-driven layout for one screen.
- **Don't** mix Material Symbols and lucide inside a single route.
- **Don't** introduce a third typeface, or set a human-authored label in mono.
- **Don't** reach for 13px outside a dense metric row, or for the pre-auth scale outside `/` and `/login/`.
