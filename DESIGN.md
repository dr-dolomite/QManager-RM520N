---
name: QManager
description: Modern web GUI for managing the Quectel RM520N-GL modem. The Operator's Console, in color, running on the modem it manages.
colors:
  # --- Brand / primary (source: the mark's tail) ---
  primary-light: "oklch(0.488 0.243 264.376)"
  primary-dark: "oklch(0.79 0.16 262)"
  primary-foreground-light: "oklch(0.99 0.014 264)"
  primary-foreground-dark: "oklch(0.20 0.12 258)"
  primary-container-light: "oklch(0.885 0.10 264)"
  primary-container-dark: "oklch(0.40 0.165 260)"
  on-primary-container-light: "oklch(0.275 0.17 264)"
  on-primary-container-dark: "oklch(0.92 0.09 262)"
  # --- Secondary (4G LTE identity) ---
  secondary-light: "oklch(0.495 0.205 296)"
  secondary-dark: "oklch(0.80 0.145 296)"
  secondary-container-light: "oklch(0.90 0.085 296)"
  secondary-container-dark: "oklch(0.325 0.11 296)"
  on-secondary-container-light: "oklch(0.265 0.15 296)"
  on-secondary-container-dark: "oklch(0.91 0.075 296)"
  # --- Tertiary (counts, upload, minor identity) ---
  tertiary-light: "oklch(0.49 0.13 200)"
  tertiary-dark: "oklch(0.81 0.11 200)"
  tertiary-container-light: "oklch(0.885 0.09 200)"
  tertiary-container-dark: "oklch(0.30 0.08 200)"
  on-tertiary-container-light: "oklch(0.26 0.09 200)"
  on-tertiary-container-dark: "oklch(0.90 0.07 200)"
  # --- Functional four (contract) ---
  success-light: "oklch(0.52 0.18 149)"
  success-dark: "oklch(0.82 0.17 149)"
  success-container-light: "oklch(0.89 0.115 149)"
  success-container-dark: "oklch(0.30 0.095 149)"
  on-success-container-light: "oklch(0.26 0.11 149)"
  on-success-container-dark: "oklch(0.91 0.11 149)"
  warning-light: "oklch(0.585 0.16 72)"
  warning-dark: "oklch(0.865 0.155 80)"
  warning-container-light: "oklch(0.905 0.125 82)"
  warning-container-dark: "oklch(0.32 0.085 70)"
  on-warning-container-light: "oklch(0.31 0.11 70)"
  on-warning-container-dark: "oklch(0.93 0.11 80)"
  destructive-light: "oklch(0.54 0.235 27)"
  destructive-dark: "oklch(0.77 0.175 25)"
  destructive-container-light: "oklch(0.905 0.08 25)"
  destructive-container-dark: "oklch(0.325 0.115 25)"
  on-destructive-container-light: "oklch(0.30 0.16 27)"
  on-destructive-container-dark: "oklch(0.91 0.075 22)"
  # --- Surfaces / neutrals (tinted toward the mark) ---
  background-light: "oklch(0.978 0.014 258)"
  background-dark: "oklch(0.155 0.024 258)"
  surface-light: "oklch(1 0 0)"
  surface-dark: "oklch(0.215 0.03 258)"
  surface-container-light: "oklch(0.952 0.026 258)"
  surface-container-dark: "oklch(0.262 0.04 258)"
  surface-container-high-light: "oklch(0.918 0.04 258)"
  surface-container-high-dark: "oklch(0.312 0.05 258)"
  on-surface-light: "oklch(0.19 0.032 258)"
  on-surface-dark: "oklch(0.96 0.012 258)"
  on-surface-variant-light: "oklch(0.435 0.05 258)"
  on-surface-variant-dark: "oklch(0.782 0.03 258)"
  outline-light: "oklch(0.86 0.028 258)"
  outline-dark: "oklch(0.365 0.04 258)"
  # --- Signal-quality ring steps (explicit tones, never stacked alpha) ---
  ring-success-1-light: "oklch(0.935 0.065 149)"
  ring-success-2-light: "oklch(0.875 0.10 149)"
  ring-success-3-light: "oklch(0.795 0.14 149)"
  ring-success-1-dark: "oklch(0.275 0.075 149)"
  ring-success-2-dark: "oklch(0.375 0.105 149)"
  ring-success-3-dark: "oklch(0.505 0.14 149)"
  ring-warning-1-light: "oklch(0.95 0.055 80)"
  ring-warning-2-light: "oklch(0.905 0.09 78)"
  ring-warning-3-light: "oklch(0.835 0.13 78)"
  ring-warning-1-dark: "oklch(0.275 0.06 70)"
  ring-warning-2-dark: "oklch(0.365 0.09 74)"
  ring-warning-3-dark: "oklch(0.49 0.12 78)"
  # --- Chart series (one hue per radio family) ---
  chart-nr: "oklch(0.488 0.243 264.376)"
  chart-lte: "oklch(0.495 0.205 296)"
  chart-threshold: "oklch(0.585 0.16 72)"
typography:
  display:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "1.2"
  headline:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.25"
  title:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1"
  body:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.5"
  label:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1"
  numeric:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontWeight: 600
    fontFeature: "'tnum' 1"
  mono:
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace"
    scope: "AT terminal, logs, copyable commands, technical identifiers, live signal values"
rounded:
  sm: "0.75rem"
  md: "1.25rem"
  lg: "1.75rem"
  xl: "2.25rem"
  hero: "2.5rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary-light}"
    textColor: "{colors.primary-foreground-light}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
    height: "2.5rem"
  button-tonal:
    backgroundColor: "{colors.primary-container-light}"
    textColor: "{colors.on-primary-container-light}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
    height: "2.5rem"
  button-destructive:
    backgroundColor: "{colors.destructive-light}"
    textColor: "oklch(0.99 0.01 27)"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
    height: "2.5rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface-variant-light}"
    rounded: "{rounded.pill}"
    height: "2.5rem"
  chip-status:
    backgroundColor: "{colors.success-container-light}"
    textColor: "{colors.on-success-container-light}"
    rounded: "{rounded.pill}"
    padding: "0.4375rem 0.8125rem"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.xl}"
    padding: "1.5rem"
  card-inner-tile:
    backgroundColor: "{colors.surface-container-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.lg}"
    padding: "1rem"
  metric-row-pill:
    backgroundColor: "{colors.surface-container-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 0.9375rem"
  nav-item-active:
    backgroundColor: "{colors.primary-container-light}"
    textColor: "{colors.on-primary-container-light}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 0.875rem"
  input:
    backgroundColor: "{colors.surface-container-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.875rem"
    height: "2.5rem"
---

# Design System: QManager (RM520N-GL)

> **Status: committed target, migration in progress.** This document supersedes the monotone-indigo
> system. The tokens below are the binding design canon for all new work. **Step 1 has landed: every
> token here resolves at runtime in `app/globals.css`**, under the names given in Token Names in Code
> below. Components have not yet been retargeted; see Migration Sequence at the end of this file for
> steps 2 through 4.
>
> Three previously named rules are **retired** and are called out as such below: the One-Accent Rule,
> the Outline-Badge Rule, and the 140ms motion floor. Everything else (the functional-color contract,
> the two-voice typography rule, tabular numbers, the Loader-and-Dots Rule, the Consistent-Layout
> Rule, the honesty rules) survives unchanged.

## Overview

**Creative North Star: "The Operator's Console, in color."**

QManager is still the calm, expert console an operator trusts when something matters. What changed is
how that calm is expressed: color is no longer scarce, it is **structured**. The system is a real
Material-3-style tonal palette derived from the QManager mark, where content sits *inside* filled
tonal containers rather than being sprinkled as colored text on white. Density stays the job; color
now organizes the density instead of decorating it.

The aesthetic is **tonal at rest, expressive in transition, dense in data, honest in state**. A
surface tells you what kind of thing it is by its fill and its radius before you read a word of it.
Nothing shouts, because everything is a container: hierarchy comes from tone, size, and shape rather
than from one loud focal element competing for attention.

It earns its restraint twice, as it always did. Once as a stylistic principle, and again as a safety
principle: QManager is served by the modem it manages (lighttpd plus CGI on the RM520N-GL itself), so
the routine 90% should feel effortless and the risky 10% should feel deliberate. A colorful interface
is not permission to become a consumer router app.

Dominant references:

- **Material 3 / Material You** (Pixel Settings, Google Home, Wallet) for the shape scale, the
  container roles, the grouped-rows-inside-tonal-boxes structure, and the motion curves.
- **Apple System Preferences**, still the structural authority: every feature page is a page header
  plus a uniform card layout, never a bespoke per-screen composition.
- **Vercel / Linear** for light-and-dark parity and expert-tool typographic restraint.
- **Grafana / Datadog** for data-visualization density done with discipline.
- **UniFi** for inline status density. The pattern survives; its outline treatment does not. UniFi is
  a density reference, not a layout or badge reference.

Anti-references are unchanged: raw terminal aesthetics, legacy router admin panels, consumer-router
cartoon oversimplification, and the AI/SaaS hero-metric template. One is added: **decorative color**,
a hue used because a surface looked empty.

**Key Characteristics:**

- OKLCH-only. `#000` and `#fff` never appear as literals; every neutral is tinted toward the mark's hue.
- The palette is **derived from the mark**, not chosen alongside it.
- Three identity hues (primary blue, secondary violet, tertiary cyan) plus the functional four. No hue
  is decorative and functional at the same time.
- Euclid Circular B is the interface voice; Geist Mono is the machine voice. There is no third voice.
- Depth is tonal. Shadows are optional and never load-bearing.
- Motion is expressive in duration and curve, and never overshoots.
- Light and dark are first-class equals; dark mode is genuinely colored, not desaturated.
- **Build on shadcn/ui first.** When a surface needs a primitive (tabs, dialog, popover, tooltip,
  select, dropdown), use the shadcn component and restyle it with these tokens. Build custom only
  where shadcn genuinely has no answer.

## Colors

**Governing rule: the mark sets the hue, containers carry the content, functional colors report state.**

### Source color

The QManager mark (`public/qmanager-mark.svg`, the "Tonal Q") is two tones of one blue: ring
`oklch(0.623 0.214 259.815)` and tail `oklch(0.488 0.243 264.376)`. That pair is treated as a
Material source pair:

- The **tail** is light-mode `--primary`.
- The **ring's** hue drives the dark-mode `--primary-container` and the active-nav tone.
- Every neutral carries a trace of that hue (chroma 0.012 rising to 0.05), so surfaces read as a family.

### Primary

- **Signal Blue** (light `oklch(0.488 0.243 264.376)` / dark `oklch(0.79 0.16 262)`): the brand, the
  only action accent, the focus ring, the active nav tone, and the identity of the 5G NR leg. It is
  the mark's tail, used literally.
- **Signal Blue Container** (light `oklch(0.885 0.10 264)` / dark `oklch(0.40 0.165 260)`): the tonal
  block that carries primary-flavored content. Tonal buttons, active nav pills, in-progress rows,
  emphasized recommendation panels, NR carrier tiles.

### Secondary

- **Carrier Violet** (light `oklch(0.495 0.205 296)` / dark `oklch(0.80 0.145 296)`): the 4G LTE
  identity. LTE chart series, LTE carrier tiles, LTE aggregation segments. Chosen at 296 because the
  mark forces blue to mean "QManager and its primary radio", so the second radio family cannot also
  be a blue; violet is the nearest hue that stays unmistakably separate while sharing the cool
  temperature. It never acts.

### Tertiary

- **Uplink Cyan** (light `oklch(0.49 0.13 200)` / dark `oklch(0.81 0.11 200)`): counts, upload
  direction, minor accents. Deliberately low-chroma so it reads as a supporting mark, not a third
  brand. It never acts.

  **Hue corrected from 185 to 200.** The handoff bundle shipped this role at 185, which sits 36
  degrees from success (149) and therefore violates the 40-degree separation rule stated below, in
  the same document. Turn 2a of the exploration rejects teal for the LTE role on exactly that
  arithmetic ("Teal would harmonise better but sits only 36 degrees from success-green, which breaks
  the functional contract"), so 185 was an oversight carried into the token table rather than a
  considered exception. Hue 200 is the nearest value that clears 40 degrees from every functional
  hue (51 from success) and from both other identity hues (64 from primary, 96 from Carrier Violet).
  Lightness and chroma are untouched, so the role's weight in the system is unchanged.

### Neutral

Surfaces step tonally: `background`, then `surface`, then `surface-container`, then
`surface-container-high`. A card lifts by sitting one step above its parent, in both themes.

- **Canvas** (light `oklch(0.978 0.014 258)` / dark `oklch(0.155 0.024 258)`): the page background.
- **Surface** (light `oklch(1 0 0)` / dark `oklch(0.215 0.03 258)`): cards, dialogs, popovers.
- **Surface Container** (light `oklch(0.952 0.026 258)` / dark `oklch(0.262 0.04 258)`): inner tiles,
  pill metric rows, input fills, ghost-button hover.
- **Surface Container High** (light `oklch(0.918 0.04 258)` / dark `oklch(0.312 0.05 258)`): muted
  chips, deliberately-off states, the third tonal step.
- **On Surface** (light `oklch(0.19 0.032 258)` / dark `oklch(0.96 0.012 258)`): primary text.
- **On Surface Variant** (light `oklch(0.435 0.05 258)` / dark `oklch(0.782 0.03 258)`): descriptions,
  labels, secondary text, inactive nav.
- **Outline** (light `oklch(0.86 0.028 258)` / dark `oklch(0.365 0.04 258)`): input strokes and table
  rules only. Not a card border.

### Tonal roles at a glance

Each identity hue ships as four tokens: the fill, the ink on the fill, the container, and the ink on
the container. Consumers only ever pick a *pair*.

| Role | Owns | Light fill | Light container | Dark fill | Dark container |
|------|------|-----------|-----------------|-----------|----------------|
| **Primary** (blue, hue 264) | Brand, actions, focus, active nav, 5G NR identity | `0.488 0.243 264.376` | `0.885 0.10 264` | `0.79 0.16 262` | `0.40 0.165 260` |
| **Secondary** (violet, hue 296) | 4G LTE identity, LTE chart series, LTE carrier tiles | `0.495 0.205 296` | `0.90 0.085 296` | `0.80 0.145 296` | `0.325 0.11 296` |
| **Tertiary** (cyan, hue 200) | Counts, upload direction, minor accents | `0.49 0.13 200` | `0.885 0.09 200` | `0.81 0.11 200` | `0.30 0.08 200` |

### The functional four (contract)

| Role | Meaning | Icon | Light fill | Dark fill |
|------|---------|-------|-------|------|
| **success** | Healthy: connected, service active, save succeeded, profile applied | `CheckCircle2Icon` | `0.52 0.18 149` | `0.82 0.17 149` |
| **warning** | Degraded: weak signal, searching, limited service, partial success | `TriangleAlertIcon` | `0.585 0.16 72` | `0.865 0.155 80` |
| **info** | In progress: applying, downloading, rebooting; reports rather than alarms | `ClockIcon`, `DownloadIcon`, spinner | brand ramp | brand ramp |
| **destructive** | Failed or irreversible: disconnected, apply failed, reboot dialogs | `XCircleIcon` or `AlertCircleIcon` | `0.54 0.235 27` | `0.77 0.175 25` |

Two deliberate changes, both required by the new palette:

1. **`--info` collapses into the brand hue.** A saturated brand blue and a saturated info blue cannot
   coexist without ambiguity, and the old info blue at hue 255 sat within a few degrees of the mark.
   "In progress" is now rendered as the brand's own tonal container, which is how Material renders a
   neutral-informational surface anyway. Info keeps its meaning and its icon vocabulary; it stops
   being a separate hue. The cost: a downloading chip and a primary button no longer differ by hue,
   they differ by **shape and glyph** (pill chip plus clock vs. filled button plus label).
2. **`--warning` drops from L 0.75 to L 0.585 in light mode.** The old amber measured 2.4:1 on a white
   card and failed AA. This is a correctness fix, not a taste change.

No decorative hue sits within 40 degrees of a functional one: identity hues occupy 264 / 296 / 200,
functional hues occupy 149 / 72 / 27 plus the brand ramp.

### Signal quality ramp

Thresholds are unchanged (`getSignalQuality()` in `types/modem-status.ts`), remapped onto the new
tokens. Used identically on the dashboard, antenna statistics, and the alignment meter.

| Quality | Token | RSRP (dBm) | RSRQ (dB) | SINR (dB) |
|---------|-------|------------|-----------|-----------|
| Excellent | `success` | >= -80 | >= -5 | >= 20 |
| Good | `primary` | >= -100 | >= -10 | >= 13 |
| Fair | `warning` | >= -110 | >= -15 | >= 0 |
| Poor | `destructive` | < -110 | < -15 | < 0 |

### Data visualization

- **5G NR** series uses `primary`; **4G LTE** series uses `secondary`. One hue per radio family,
  matching the carrier tiles and the aggregation strip, so a color learned on one card holds on the next.
- Area fills are a gradient of the series color (0.32 alpha falling to 0), monotone curves, horizontal
  gridlines only.
- Threshold guides use `warning` at low opacity, dashed.
- Any added series must stay separable under deuteranopia and protanopia simulation before merge.

### Named Rules

**The Source-Color Rule.** New colors are derived from the mark's hue family or from an existing
identity or functional role. Nobody picks a hue by eye and adds it to `globals.css`.

**The Container-Pair Rule.** Never place text on a role's *fill* unless you are using that role's
`-foreground`; never place it on a container unless you are using that container's `on-` ink. Mixing
a fill with a container's ink is the single most common way to fail contrast here.

**The Functional-Color Promise** (kept). A user who learns green means healthy on the dashboard finds
the same green meaning the same thing in Watchdog, in Profile Apply, and in the alert logs. Hue and
chroma were retuned; meanings did not move, and functional colors are never decorative.

**The Identity-Never-Acts Rule.** Secondary and tertiary carry identity, never affordance. A violet
surface means "this is the LTE leg", never "click me". Only `primary` acts. *(This replaces the
retired One-Accent Rule, whose intent it preserves: exactly one hue acts.)*

**The Semantic-Token Rule** (kept). Reach for `bg-success-container` and `text-on-surface-variant`,
never raw Tailwind palette classes like `text-blue-500`. The theme switch depends on it.

**The OKLCH-Only Rule** (kept). No hex literals, ever. New colors enter the system in OKLCH form in
`globals.css`; conversion is the author's job, not the consumer's.

**The Explicit-Tone Rule.** Layered translucency is banned for stacked shapes. The service rings
composite to a flat disc when built from one color at 0.15 / 0.25 / 0.40 alpha; they use four
explicit tone steps instead (`ring-success-1` through `ring-success-3` plus the fill).

### Token Names in Code

Two roles above ship under different names in `globals.css`, because the canon's vocabulary collides
with shadcn's. The collision is real, not cosmetic: shadcn's `--secondary` is a **neutral** consumed by
progress-track fills and secondary buttons, so binding Carrier Violet to it would turn progress tracks
violet and hand affordance to a hue that must never act.

| Canon role | Token family in `globals.css` | Utilities |
|------------|-------------------------------|-----------|
| Secondary (Carrier Violet, 4G LTE) | `--lte`, `--lte-foreground`, `--lte-container`, `--on-lte-container` | `bg-lte-container`, `text-on-lte-container` |
| Tertiary (Uplink Cyan) | `--uplink`, `--uplink-foreground`, `--uplink-container`, `--on-uplink-container` | `bg-uplink-container`, `text-on-uplink-container` |
| Signal ring steps | `--tone-success-1..3`, `--tone-warning-1..3` | `bg-tone-success-2` |
| Outline (inputs, table rules) | `--outline` | `border-outline` |

Everything else uses its canon name: `--primary-container`, `--on-primary-container`,
`--success-container`, `--on-success-container`, `--warning-container`, `--destructive-container`,
`--info-container`, `--surface`, `--surface-container`, `--surface-container-high`, `--on-surface`,
`--on-surface-variant`, `--chart-nr`, `--chart-lte`, `--chart-threshold`.

`--secondary`, `--muted`, and `--accent` remain shadcn neutrals and are now mapped onto the surface
steps (`surface-container` for secondary and muted, `surface-container-high` for accent), so the
existing neutral vocabulary joins the tonal family without any component edit.

Two values are deliberately held one step off the table above until step 3:

- **Dark `--destructive` sits at `oklch(0.62 0.21 25)`, not the canon's `0.77 0.175 25`.** `Button` and
  `Badge` hardcode `text-white` on the destructive variant, and step 1 may not edit components; white
  ink on an L 0.77 fill fails AA. It moves to the canon value in the same change that flips the chips.
- **`--border` is a quiet `oklch(0.905 0.022 258)`, softer than `--outline`.** Cards still render a
  hairline in code until step 3, and promoting `--border` to the outline value would make the very
  hairlines this system retires *more* prominent. `--outline` carries the canon value today and is
  already bound to `--input`.

## Typography

Unchanged from the incumbent system, and deliberately so: the type system was already right.

**Interface Font:** Euclid Circular B (with `system-ui, sans-serif`), loaded locally as WOFF2 via
`next/font/local` in `app/layout.tsx` and mapped to `font-sans` through `--font-sans: var(--font-euclid)`.
**Machine Font:** Geist Mono (with `ui-monospace, monospace`), loaded via `next/font/google`, bound to
`--font-geist-mono`, mapped to `font-mono`. Self-hosted at build time, so the modem never fetches a
font at runtime.

**Character:** a clean geometric sans doing the talking and a precise monospace doing the reporting.
Hierarchy comes from weight and scale, never from mixing families.

**Loaded weights:**

| Weight | File | Usage |
|--------|------|-------|
| 300 (Light) | `EuclidCircularB-Light.woff2` | Decorative and oversized numerals only |
| 400 (Regular) | `EuclidCircularB-Regular.woff2` | Body text, inputs, descriptions, table cells |
| 400 (Italic) | `EuclidCircularB-Italic.woff2` | Rare emphasis |
| 500 (Medium) | `EuclidCircularB-Medium.woff2` | Labels, chips, buttons, table headers |
| 600 (SemiBold) | `EuclidCircularB-SemiBold.woff2` | Card titles, section headings, numeric readouts |
| 700 (Bold) | `EuclidCircularB-Bold.woff2` | Page titles (`h1`) only |

**No secondary UI typeface.** Manrope was once loaded but never bound to a variable, so no surface
ever rendered in it; the dead import is gone. If a genuine secondary-face need ever appears, load it
deliberately and bind it via a font variable in the same change. Never hand-wire a font into a component.

A third font file does enter the build under the new system, but it is an **icon font, not a voice**:
Material Symbols Rounded, self-hosted and scoped to the sidebar. See Components > Icons.

### Hierarchy

- **Display / Page Title** (700, `text-3xl` / 30px, line-height 1.2): the `h1` at the top of every
  feature page, followed by an `on-surface-variant` description.
- **Headline** (600, `text-xl` / 20px, line-height 1.25): large card titles and state labels.
- **Title** (600, 1rem / 16px, `leading-none`): the `CardTitle` default. Tight leading so titles
  align cleanly with adjacent metadata.
- **Body** (400, `text-sm` / 14px, line-height 1.5): default UI text, descriptions, table cells.
- **Label** (500, `text-xs` / 12px): chips, table headers, button text, form labels, tiny uppercase
  section labels (`uppercase tracking-wider`, 11px in the sidebar).
- **Numeric** (600, sized to slot, `tabular-nums`): live signal values, counters, timers.
- **Mono** (`font-mono`, usually `text-xs` or `text-sm`): AT terminal streams, log viewers, copyable
  commands, IMEI/ICCID identifiers, band and ARFCN values, dBm readouts.

### Named Rules

**The Two-Voice Rule** (kept). Euclid Circular B speaks for the interface; Geist Mono speaks for the
machine. There is no third voice. Pairing Euclid with another UI sans (Inter, Geist Sans, IBM Plex,
Roboto) is forbidden. An icon font is not a voice and does not count against this rule.

**The Machine-Voice Rule** (kept). `font-mono` is scoped to device output and technical data: the AT
terminal (input and output), raw log viewers, `CopyableCommand`, inline `<code>` for AT command
strings, and identifier or value readouts (IMEI, ICCID, ARFCN, dBm). It is never reached for as
decoration on headings, buttons, or prose.

**The Tabular-Number Rule** (kept). Any value that updates live is `tabular-nums`. Non-negotiable: a
tonal pill makes jitter more visible, not less.

**The Weight-Discipline Rule** (kept). 400 body, 500 labels and medium emphasis, 600 headings and
numerics, 700 page titles only.

## Layout

**Page anatomy (the Consistent-Layout Rule, Apple heritage).** Every feature page is a thin wrapper:
an `@container/main` scope, an `h1` (`text-3xl font-bold`) plus a muted description, then a uniform
grid of self-contained cards with container-query columns (`grid gap-4 @3xl/main:grid-cols-2`). See
`app/local-network/custom-dns/page.tsx` and `components/local-network/ethernet-status.tsx` for the
reference shape. A user who learns one page has learned them all.

**The Card-Wrapped Surface Rule.** The card component owns its whole content (`CardHeader` plus
`CardContent` with every control); the page only arranges cards. `CustomDnsCard`, `EthernetStatusCard`,
and the Custom Profiles cards are the reference units. The page is never the layout canvas with cards
demoted to fragments.

**Container queries over viewport queries inside cards.** A card that declares `@container/card` uses
`@sm/card:` and `@md/card:` for everything inside it. Mixing viewport `sm:` with container `@sm/card:`
in one card breaks on tablets and expanded sidebars. Viewport breakpoints stay for page-level concerns
(padding, heading scale).

**Rhythm and density.** Page padding is `px-4 lg:px-6`; legacy `mx-auto p-2` wrappers are being phased
out, do not add new ones. Card padding is 1.5rem with 1.5rem between card sections. Spacing steps are
0.25 / 0.5 / 1 / 1.5 / 2rem.

**Toolbars flex-wrap** so action clusters fall to a second row instead of overflowing. **Tables wrap
prose columns** (`whitespace-normal break-words` with container-stepped `max-w`) and treat horizontal
scroll as a fallback only.

**Touch targets** are a minimum of 44px on coarse pointers; icon-only tab lists bump `TabsList` height
rather than shrinking triggers. The move to pill-shaped controls raises the default control height to
2.5rem, which helps here.

**Status-first column (target shape, not yet built).** For features backed by a live service (Watchdog,
Alerts, Discord bot), the intended arrangement of those same self-contained cards is a stacked column
in the order the user's questions arrive: read-only live-status hero, then settings card, then activity
log. New live-service pages should move toward it, not away from it.

## Elevation & Depth

Depth is **tonal, and only tonal**. The previous system leaned on a 1px hairline plus `shadow-sm`; in
a container system that hairline fights the fill.

- **Light theme:** background `0.978 0.014 258`, then card `1 0 0`, then inner container `0.952 0.026 258`.
- **Dark theme:** background `0.155 0.024 258`, then card `0.215 0.03 258`, then inner container `0.262 0.04 258`.
- Cards carry **no border**. An optional whisper shadow (`0 1px 2px` at 6% in light) is allowed and
  must not be load-bearing; nothing about the layout breaks if it disappears.
- Popovers, dialogs, and dropdowns keep a real float shadow (`shadow-lg` and up, via shadcn defaults):
  that is the "not part of the page flow" signal.

### Shadow Vocabulary

- **Whisper** (`0 1px 2px` at 6% light, absent in dark): optional card lift. Never load-bearing.
- **Popover Float** (`shadow-lg` and up): dialogs, dropdowns, popovers, the skip-to-content pill.

### Named Rules

**The Tonal-First Rule** (kept, strengthened). Two surfaces at different conceptual elevations differ
by at least one container step. This is now the *only* elevation signal in both themes.

**The No-Hairline-On-Fill Rule** (replaces the retired Border-Carries-Structure Rule). Bordered rows
inside a tonal card are replaced by container fills. A border is reserved for inputs, for table rules
in genuine data tables, and for the outlined-card variant.

**The Highlight-by-Container Rule** (replaces Highlight-by-Tint). Emphasis promotes a surface one
container step and changes its ink, rather than adding a translucent wash over a neutral card. The
recommended alignment slot becomes a `primary-container` block; a running pipeline step becomes a
`primary-container` row.

## Shapes

Radius carries size hierarchy: the bigger and more important the surface, the softer its corners. A
glance tells you what kind of thing you are looking at before you read it.

| Step | Value | Owns |
|------|-------|------|
| `sm` | 0.75rem (12px) | Small inline affordances, code blocks, skeleton blocks |
| `md` | 1.25rem (20px) | Inputs, selects, small popovers |
| `lg` | 1.75rem (28px) | Inner tiles inside a card, carrier tiles, alignment slots |
| `xl` | 2.25rem (36px) | Standard cards, dialogs |
| `hero` | 2.5rem (40px) | Hero surfaces, the aggregation strip, full-width glance panels |
| `pill` | 9999px | Chips, buttons, nav items, metric rows, meter fills, progress tracks |

In code the steps carry **role names, not t-shirt sizes**: `rounded-inline` (12px), `rounded-field`
(20px), `rounded-tile` (28px), `rounded-card` (36px), `rounded-hero` (40px), `rounded-pill`. The
legacy `rounded-{sm,md,lg,xl}` chain off `--radius: 0.65rem` is still live and still bound to its old
values, because `rounded-md` alone has 114 call sites on dropdown items, table cells, and small
buttons; silently retargeting it to 20px would be a regression, not a migration. Step 2 moves surfaces
onto the role names one component at a time, and the legacy chain retires when the last one moves.
**New work uses the role names.**

Form language beyond radius: fills over strokes, round caps on every meter and progress track, and no
side-stripe accent borders. The mark itself follows the same construction (two shapes, two tones, one
hue, no gradient and no shadow), and UI shapes should read as members of that family.

### Named Rules

**The Radius-Follows-Size Rule.** A surface's radius is a function of its size and role, not of taste.
A 28px tile never sits inside a 20px card, and a chip is always fully round.

**The Fill-Over-Stroke Rule.** When a shape needs to be distinguished from its neighbor, change its
fill, not its border. Borders survive only on inputs and genuine table rules.

## Motion

Motion is now **expressive in duration and curve, and still settled**. Material's expressiveness comes
from the easing, not from overshoot, which is what makes it compatible with a tool that keeps a
connection alive.

### Tokens

| Token | Value | Owns |
|-------|-------|------|
| **emphasized** | `400ms cubic-bezier(0.05, 0.7, 0.1, 1)` | Container size and shape changes, the aggregation chain re-proportioning, alert arrival, page-level enter |
| **standard** | `300ms cubic-bezier(0.2, 0, 0, 1)` | Nav indicator, card entrance, meter fill, chip container morph |
| **quick** | `180ms ease-out` | Label swaps, live value ticks, hover tints, focus rings |
| **ambient** | `2s ease-in-out alternate` | Service rings, live ping dot, spinners; the only loops in the product |

In code, all four tokens exist as real values, so no surface has to hardcode a curve or a duration:

| Token | Curve utility | Duration property |
|-------|---------------|-------------------|
| emphasized | `ease-emphasized` | `--duration-emphasized` |
| standard | `ease-standard` | `--duration-standard` |
| quick | `ease-quick` | `--duration-quick` |
| ambient | `ease-ambient` | `--duration-ambient` |

Plus `--stagger-step` (60ms) for the card cascade. Curves live in `@theme` and emit Tailwind
utilities; durations are plain custom properties, used as `duration-[var(--duration-standard)]` in a
class or read directly inside a `motion/react` transition. Tailwind v4 has no `--duration-*` theme
namespace, so declaring them in `@theme` would emit meaningless utilities.

An ambient loop is `var(--duration-ambient) var(--ease-ambient) infinite alternate`. If you find
yourself typing `2s ease-in-out` or `180ms ease-out` literally, use the token instead: the point of
naming the four is that a future retune moves every surface at once.

### The global switch

`components/motion-provider.tsx` wraps the app in `<MotionConfig reducedMotion="user">`. Every
`motion/react` animation automatically honors `prefers-reduced-motion`: transform movement collapses
to instant while opacity is preserved. Keep shared variants pure transform and opacity so this one
switch is all that is ever needed. Raw CSS keyframes (like `pulse-ring` in `globals.css`) carry their
own `@media (prefers-reduced-motion: reduce)` off-switch.

### The vocabulary

- **Page entrance.** Route content, keyed on `pathname`, rises 10px and fades over `standard`. Enter
  only; there is no exit animation. This is the most-felt animation in the product; do not embellish it.
- **Card cascade.** `staggerContainer` and `staggerItem` from `lib/motion-presets.ts`, a 60ms step,
  each child rising 10px over `standard`. Import the presets rather than re-declaring local copies.
  Keep the 60ms step: wider and the last card feels late behind a slow poll.
- **Nav indicator.** The active pill translates between rows over `standard` instead of appearing.
  This is the single most Material-feeling change in the shell.
- **Meter fill.** `scaleX` from `transform-origin: left` over `standard`. Never animate width, except
  the aggregation chain, where the width *is* the data.
- **Live value tick.** An 180ms opacity dip on a `tabular-nums` value. No fade-out-then-in, no layout
  shift, no color flash.
- **Status chip swap.** The label crossfades over `quick` while the container color morphs over
  `standard`, so the state change is felt before it is read. The icon always changes with the color.
- **Aggregation re-proportion.** Segment widths animate over `emphasized` when a carrier is added or
  released; released segments stay in place, greyed, rather than being removed.
- **Alert arrival.** New Recent Activity rows enter from the trailing edge over `emphasized`; existing
  rows move on transform. Nothing animates out; history does not retreat.
- **Save confirmation.** `SaveButton` swaps idle to "Saving..." to "Saved!" on `useSaveFlash` timing;
  the check scales to 1.03 and settles. The check is the **only** element in the product permitted to
  exceed 1.0 scale, and only to 1.03.
- **Service rings.** `animate-pulse-ring`, three concentric discs on the `tone-{role}-{1,2,3}` steps,
  offset 0 / 0.3s / 0.6s. This is the only thing on the dashboard that loops continuously, and **it
  stops the moment the service is not active** — a ring that pulses over a dead service is a lie.
- **Live ping dot.** `animate-live-ping`: a disc scales to 2.4 and fades out over the ambient duration.
  Reserved for a genuinely live stream (poller ticking, watchdog probing), never for "this page loaded".

Every one of these carries its own reduced-motion off-switch: `motion/react` variants through the
global `MotionConfig`, raw keyframes through a `@media (prefers-reduced-motion: reduce)` block beside
the class in `globals.css`.

### Named Rules

**The Settled-Motion Rule** (kept). Every transition ends at rest. The save check at 1.03 is the
ceiling for overshoot, not the floor. Bouncy, elastic, and rubber-band motion stay banned. If a
transition wobbles at the end, the parameters are wrong.

**The Expressive-Duration Rule** (replaces the retired Short-Duration Rule). Anything that changes a
container's size, shape, or fill runs at `standard` or `emphasized`. The old 140-160ms floor is
**retired**: at 140ms a container color change reads as a flicker rather than a morph. Value and label
swaps stay at `quick`.

**The Transform-Only Rule** (kept). Animations touch `opacity` and `transform`, plus color via CSS
transitions. The aggregation chain's width is the sole documented exception, and it is data, not decoration.

**The One-Loop Rule.** At most one ambient loop per surface, and only where something is genuinely
live. A loop that runs while nothing is happening is a lie.

**The Motion-Ceiling Rule.** Nothing exceeds 400ms. `emphasized` is the ceiling, not a starting point,
and the only durations longer than it in the product are ambient loops, which are not transitions.

**The Non-Load-Bearing Rule.** No transition may be load-bearing: if it never runs, the UI is still
correct. This is stronger than the Reduced-Motion Rule, which only covers the user's preference. A
transition can also be skipped because the element mounted mid-flight, because the tab was backgrounded,
or because a slow poll landed the data before the animation started. Final state is computed and
correct on its own; the animation is only how it got there. The nav indicator is the reference: its
position is derived from the active row, and the slide is a `transition` on top of a value that is
already right (see `.nav-indicator[data-settling="true"]`, which suppresses the slide on first paint).

**The Reduced-Motion Rule** (kept). Movement goes, opacity stays, and no layout depends on a transition
completing. The UI must remain perfectly usable, and feel intentional, with motion off. Because
durations are now longer, this matters more than it did.

**The Loader-and-Dots Rule** (kept, project canon). Step and sample progress is a `Loader2Icon` spinner
plus discrete dot indicators. Fill bars remain data visualization only.

## Components

Every component follows the **tonal and confident** philosophy: a surface announces what it is by its
fill and radius, then responds clearly to interaction. All primitives are shadcn/ui (new-york style,
lucide icons); the custom layer is thin and listed below.

### Status chips (replaces status badges)

**All status indicators are filled tonal chips**: `bg-{role}-container`, `text-on-{role}-container`, a
`size-4` lucide icon, pill radius. The outline-plus-tint pattern is **retired**. Inside a tonal system
an outlined badge reads as a weaker copy of the container beside it, and it loses legibility first in
sunlight, which is the field-tech failure case.

| State | Fill | Ink | Icon |
|-------|------|-----|-------|
| Success / Active | `success-container` | `on-success-container` | `CheckCircle2Icon` |
| Warning | `warning-container` | `on-warning-container` | `TriangleAlertIcon` |
| Destructive / Error | `destructive-container` | `on-destructive-container` | `XCircleIcon` or `AlertCircleIcon` |
| Info / In progress | `primary-container` | `on-primary-container` | `ClockIcon`, `DownloadIcon`, spinner |
| Muted / Disabled | `surface-container-high` | `on-surface-variant` | `MinusCircleIcon` |

Choose **Muted** for deliberately inactive states (Stopped, Offline peer, Disabled-by-config) and
reserve **Destructive** for failure or error (Disconnected link, Failed email). No shared chip wrapper
component exists in the tree; the pattern is composed inline. If a reusable `ServiceStatusChip` is ever
extracted, migrate inline copies to it and update `CLAUDE.md` in the same change.

### Buttons

- **Shape:** pill radius, `text-sm font-medium`, gap-2 icon spacing, `h-10` (2.5rem) default.
- **Primary:** `primary` fill, `primary-foreground` ink. One per surface. Primary actions (Record,
  Save, Apply, Confirm) use this, never a quieter variant. Hover dims to `primary/90`.
- **Tonal:** `primary-container` fill, `on-primary-container` ink. The new secondary action; it
  replaces outline for Cancel, Reset, and Check again.
- **Destructive:** `destructive` fill, reserved for irreversible actions (reboot, delete, factory-level).
- **Ghost:** no fill at rest, `surface-container` on hover. Icon buttons and row actions; always
  carries `aria-label`.
- **Text:** `primary` ink, underline on hover, inline within text only.
- **Sizes:** `xs` (h-7), `sm` (h-9), `default` (h-10), `lg` (h-11), plus square `icon-xs` / `icon-sm` /
  `icon` / `icon-lg` variants. Every size keeps the pill radius.
- **Save actions always use `SaveButton`** (`components/ui/save-button.tsx`): a min-width 120px primary
  button that swaps its label between idle, "Saving..." (spinner), and a "Saved!" check flash driven by
  the `useSaveFlash` hook (1.8s). Recreating save UI inline is forbidden.

### Cards / Containers

- **Corner style:** 2.25rem (36px) standard, 2.5rem (40px) for hero surfaces, 1.75rem (28px) for inner tiles.
- **Background:** `surface` fill, one tonal step above the page background.
- **Shadow strategy:** none required; see Elevation & Depth. The optional whisper shadow is never load-bearing.
- **Border:** none. A card that carries a tonal fill does not also carry a hairline.
- **Internal padding:** 1.5rem, with 1.5rem between card sections.
- **CardHeader contract** (project canon, kept): plain `CardTitle` plus `CardDescription`, **no icons
  in headers**. Icons belong in chips or the `CardAction` slot (the header grid reserves a column for
  it). A refresh icon button in `CardAction` is the sanctioned header action.
- Inner groupings are container fills (`surface-container` at 28px radius), not bordered rows.

### Metric rows: pills or hairlines

The one deliberately conditional rule in the system.

- **Glance surfaces (roughly 12 rows or fewer)**, meaning dashboard signal cards, device metrics, and
  carrier tiles, use **filled pill rows** on `surface-container`. This is where the tonal system does
  its emotional work.
- **Genuine data tables**, meaning Cell Scanner results, neighbor cells, log views, and the SMS inbox,
  keep **hairline rows**. Pills cost roughly a third of the visible rows, and density is the job there.

If you are unsure which you are building, count the rows a real device produces, not the rows in the mock.

### Inputs / Fields

- **Style:** `surface-container` fill in both themes, 1.25rem radius, `h-10`, `px-3.5`, no border at rest.
- **Focus:** a 3px `primary` ring at 50% opacity plus a `primary` edge, transitioned on `color, box-shadow`.
- **Error:** `aria-invalid` drives a `destructive` edge plus a `destructive` ring tint (40% in dark).
- **Disabled:** `opacity-50`, `pointer-events-none`, not-allowed cursor.
- Supporting field primitives: `field.tsx` (label plus value display), `input-group.tsx` (prefix/suffix),
  `kbd.tsx`, `copyable-command.tsx` (mono command with a copy affordance).

### Navigation

The sidebar is the one surface that carries Material Symbols Rounded glyphs (see Icons).

- shadcn sidebar, **inset variant**: header (mark plus product name), grouped nav sections (`NavMain`,
  `NavCellular`, `NavLocalNetwork`, `NavMonitoring`, `NavSystem`, `NavSecondary`), `NavUser` footer.
- **Pill nav items** at full radius. The active item sits on `primary-container` with
  `on-primary-container` ink and the **filled** (`FILL 1`) glyph weight; inactive items are
  `on-surface-variant` with the outlined (`FILL 0`) weight, no fill, and a `surface-container` hover.
  The fill axis is the affordance, so the active state survives grayscale.
- **The active indicator translates between items over `standard`** rather than appearing.
- Sidebar surface is `surface-container` in light and `surface` in dark.
- Grouped sections keep their 11px uppercase labels on `on-surface-variant`. Collapsible groups for
  dense sections (Cellular, Monitoring); flat lists elsewhere. On mobile the sidebar collapses to a sheet.
- The header bar above content carries the `SidebarTrigger`, a hairline separator, and breadcrumbs
  (parents hidden below the `desktop` breakpoint, 68.75rem). **The header bar is not the sidebar**: its
  trigger and controls stay on lucide.

### Dialogs, banners, toasts

- **Dialogs:** `surface` at hero radius (2.5rem) with a float shadow; standard shadcn overlay dimming.
- **Destructive dialogs:** consequences spelled out in `DialogDescription`, a destructive-fill CTA
  ("Reboot Now"), and a tonal "Later" escape. Reboot-required operations surface this dialog rather
  than rebooting mid-request.
- **Banners:** see the next section. Banners are a system with eight roles, not a one-off per feature.
- **Toasts:** `sonner` for action feedback. Toasts confirm; they never carry the only copy of an error
  a user must act on.

### Banner System

A page-level banner states a **condition or a notice about the system itself** — something that
outlives a single interaction and that no card on the page owns. It is the widest, loudest surface in
the product, so the set is closed: eight roles, one anatomy, no per-feature variants.

**Anatomy** (leading glyph, content, one CTA, optional dismiss):

- **Container:** `bg-{role}-container` with `text-on-{role}-container`, card radius, **no border**.
- **Glyph:** a `size-9` filled circle on the role's strong fill (`bg-{role}`, `text-{role}-foreground`)
  holding a `size-5` icon. Never a bare icon on the container.
- **Title:** 15px semibold. **Identity line** (optional): a machine-voice row of carrier, number, or
  masked ICCID in `font-mono`. **Description:** 13px, one or two sentences, says what happens next.
- **CTA:** exactly one pill button, right-aligned, wrapping below on narrow widths.
- **Dismiss:** an absolutely-positioned `size-8` circle at the top-trailing corner, present only on
  notices.

**The eight roles:**

| # | Role | Container | Dismissible | ARIA |
|---|------|-----------|-------------|------|
| 01 | SIM swap, matching profile | `primary-container` | Yes, durably | `role="alert"` |
| 02 | SIM swap, no matching profile | `primary-container` | Yes, durably | `role="alert"` |
| 03 | Stale data / modem unreachable | `destructive-container` | **No** | `role="alert"` + `aria-live="assertive"` |
| 04 | Degraded but functioning | `warning-container` | **No** | `role="alert"` |
| 05 | In progress | `primary-container` | **No** | `role="status"` |
| 06 | Success, transient | `success-container` | Auto-dismisses | `role="status"` |
| 07 | Page-scoped override (profile-managed) | `surface-container` | **No** | `role="note"` |
| 08 | Deferred reboot | `warning-container` | **No** | `role="alert"` |

Role 05 carries a spinner in the glyph disc and a dot row for step progress (Loader-and-Dots Rule).
Role 07 is the neutral one: its glyph disc sits on `surface-container-high` with `on-surface-variant`
ink, because "this page is managed elsewhere" is information, not a status.

#### Named Rules

**The Solid-Container Rule.** A banner is `bg-{role}-container`, never a wash. The retired pattern was
`border-info/30 bg-info/10`; a 10% alpha over a tinted surface is not a stable color — its value moves
with whatever sits behind it, it collapses to near-invisible in dark mode, and it is the first thing to
wash out in sunlight. The container and its `on-` ink are a measured pair, which is also why the border
becomes unnecessary.

**The Glyph-Disc Rule.** The icon always sits in a filled circle. A bare 16px glyph disappears against
a saturated container, and the disc is the element that survives when the container fill washes out. It
also makes the banner and the status chip read as the same family.

**The One-CTA Rule** (kept from the existing canon). One action per banner. Role 08 is the single
sanctioned exception: "review what changed" and "do the risky thing" are genuinely different decisions,
so it carries a tonal **Review** and a destructive-fill **Reboot now**.

**The Dismiss-Only-Notices Rule.** A banner gets an X only when it is a *notification*. Conditions —
stale data, deferred reboot, in progress, degraded — leave when the condition leaves, and never before.
Nothing that reports a broken link gets a dismiss affordance. When a notice is dismissible it must be
dismissible **durably**: the SIM-swap banner persists its dismissal server-side in the SIM registry, not
in component state.

**The Info-Is-Brand Rule.** Informational banners use `primary-container`, not a separate info hue. The
SIM notice and the apply pipeline are the same class of "the system is telling you something", and the
functional four already spend the saturated-blue slot on the brand.

**The Tabular-Counter Rule.** Any figure that ticks inside banner copy is `font-mono tabular-nums`.
Without it, "38 s" → "39 s" reflows the whole sentence once a second.

**Motion.** Enter on `emphasized` (400ms): a 6px rise plus a fade, replacing the older
`duration-300 slide-in-from-top-1`. There is **no exit animation** — a banner leaving means the
condition cleared, and that should feel immediate rather than negotiated.

**Contrast floor.** The tightest pair in the set is light `on-warning-container` on `warning-container`
at 8.4:1; the white-alpha secondary buttons in roles 04 and 08 sit at 6.9:1 against their ink; dark's
tightest is `on-destructive-container` at 9.1:1. Any new banner role must clear AA on both the body
copy and the CTA ink.

### Carrier Aggregation strip (signature component)

The full-width surface that replaces the SCC card on the dashboard.

- A **proportional chain**: one segment per carrier, width proportional to bandwidth, tone by radio
  family (primary for NR, secondary for LTE), the strong tone for the primary carrier and the container
  tone for secondaries. Segment labels carry bandwidth only and never wrap.
- A **tile row** beneath: one tile per carrier with band, role chip, PCI, ARFCN or EARFCN, and an RSRP
  quality bar.
- On loss, released segments **stay in place greyed**, with the aggregate figure showing what remains
  against what it was, so a drop reads as a gap rather than a redraw.
- Empty and degraded states are honest: "released 3 min ago", never a silent absence.

### Apply Progress Dialog (signature component)

The canonical shape for **async, multi-step apply pipelines**, implemented at
`components/cellular/custom-profiles/apply-progress-dialog.tsx` for the profile-apply pipeline (APN,
then TTL/HL, then Connection Scenario, then IMEI). It is one of the rare sanctioned modals: profile
activation is an irreversible, connection-affecting operation whose progress genuinely is the content.

- **Header:** `DialogTitle` ("Applying Profile") with live status as a filled status chip beside it:
  Applying (primary-container plus spinner), Complete (success-container), Partial (warning-container),
  Failed (destructive-container). `DialogDescription` carries the profile name and a `tabular-nums`
  "Step N of M" counter while running.
- **Step ledger:** a compact list of per-step rows, each an icon plus a step label plus a truncated
  detail. `pending` (muted clock), `running` (spinner, the row promotes to a `primary-container` fill),
  `done` (success check), `failed` (destructive X), `skipped` (muted check, detail reads **"Unchanged"**
  because the value already matched).
- **Honest pre-poll state:** in the short window before the backend's first status poll, the dialog
  renders a single "Preparing..." row instead of a fabricated placeholder list.
- **Reboot heartbeat:** when a step requires a modem restart, a calm `primary-container` notice appears
  ("Modem is restarting... This usually takes 30-60 seconds. The dashboard will reconnect automatically.").
  It sets expectations with copy plus a spinner, never a fake timer.
- **Terminal resolution:** the dialog cannot be dismissed until the pipeline reaches a terminal state
  (`complete`, `partial`, `failed`), so a half-finished apply is never abandoned by an accidental click.

Config restore and similar pipelines adopt this shape rather than inventing their own progress UI.

### Alignment Recorder (signature component)

The antenna-alignment surface (`components/cellular/antenna-alignment/alignment-meter.tsx`) is
QManager's signature measure-and-compare instrument: record three antenna angles (directional) or
placements (omni), average five samples per recording, and get a recommendation.

- **Live preview:** a `surface-container` inset at 28px radius with compact mono signal values over
  slim quality-tinted pill fills (one of the sanctioned uses of fill bars: data visualization).
- **Three slot cards:** `surface-container` tiles with an editable label input. Recording state shows
  a `Loader2Icon` spinner plus "Sample N of 5" plus a row of discrete dots that fill as samples land
  (the Loader-and-Dots Rule in action). The winning slot promotes to `primary-container` with a
  floating "Best" chip and a trophy icon.
- **Recommendation panel:** an `AnimatePresence` fade-rise `primary-container` inset naming the winning
  angle or position, with honest copy when slots remain unrecorded.
- State persists to `localStorage` (versioned), and every slot carries a `role="region"` label
  describing its status for screen readers.

### Dashboard Status Cards (signature surface)

The dashboard (`components/dashboard/home-component.tsx`) is the product's one sanctioned glance
surface: a two-column composition (3/5 status plus 2/5 device panel at `@4xl/main`) of self-contained
status cards (Network Status, LTE/NR carriers, Carrier Aggregation, Device, signal history chart, live
latency, recent activities), entering with the staggered fade-up cascade. The card model itself was
kept deliberately: the augmentation is color, shape, and motion, not a re-architecture.

- **Network Status keeps its existing icon set.** Its glyphs are recognized landmarks for returning
  users; they are re-tinted onto the new tonal roles and otherwise left alone. Do not swap them while
  restyling the card.
- **Values are tabular and quality-coded** via `getSignalQuality()`; connection state maps to
  functional containers (Connected success, Searching or Limited warning, Disconnected destructive,
  Inactive muted).
- **Skeletons mirror the loaded geometry** (same row counts, same icon slot), so the page does not
  reflow when data lands.
- **Poll cadence follows the backend:** the poll interval derives from the ping daemon's write interval
  plus a small buffer; the UI never pretends to be more live than its data source.
- A stale-data condition surfaces as an honest full-width `role="alert"` `destructive-container` band
  ("Unable to reach the modem. Data shown may be outdated."), never a silent freeze.
- **Service rings** use the explicit tone steps (see the Explicit-Tone Rule) and stop pulsing when
  service is not active.

### Reboot Countdown Ring

`components/reboot/reboot-countdown.tsx` renders the one radial gauge in the system: an SVG
stroke-dashoffset ring counting down a reboot with a `tabular-nums` center. Radial meters are reserved
for genuinely bounded, time-or-fraction readings like this; they are not a general dashboard decoration.

### Activity Log Cards

Watchdog, Email Alerts, and SMS Alerts each pair a status card and a settings card with a log card
(`email-alerts-log-card.tsx`, `sms-alerts-log-card.tsx`): a paginated table of recent events, newest
first, timestamps in `font-mono text-xs` per the machine-output allowance, statuses as filled status
chips, hairline rows (these are genuine data tables). Empty states live inside the table so the card
shape does not jump when the first row arrives.

### The Three-State Pattern

Every data-driven component handles loading, error, and empty deliberately:

- **Loading:** `Skeleton` blocks mirroring the final layout, at the same radius as the content they stand in for.
- **Error:** a `destructive-container` alert with the actual message, never a generic one.
- **Empty:** the `Empty` primitive (icon, title, one-line description pointing at the action that produces data).

Never a blank card, never a spinner in a void.

### Icons

Two libraries, one hard boundary. The boundary is **the sidebar**, not a vibe.

- **Material Symbols Rounded is scoped to the sidebar navigation, and nothing else.** Its filled
  (`FILL 1`) and outlined (`FILL 0`) axes are what make the active nav pill read as active without
  relying on the container tone alone, which is why the swap is worth a second icon dependency here
  and nowhere else. It must be **self-hosted** (a subset WOFF2 shipped with the build, bound through a
  font variable like every other face): the app is served by the modem itself and can never depend on
  `fonts.googleapis.com`. Subset it to the glyphs the nav actually uses.
- **Lucide is the library for everything else**: cards, chips, buttons, dialogs, tables, empty states,
  the header bar, page content. Prefer its rounded, filled-adjacent glyphs so the icon weight matches
  the shape scale.
- **Network Status keeps its current icons.** It is a recognized landmark on the one glance surface,
  and re-glyphing it buys nothing. Re-tint it onto the new tonal roles and leave the icon set alone.
- **Tabler** (`@tabler/icons-react`) remains the sanctioned secondary for glyphs lucide lacks. Some
  legacy surfaces import from `react-icons` (Md/Fa6/Tb); do not extend that dependency in new work.
- `size-4` inline, `size-5` in chips and buttons, `size-8` and up in empty states. Icon-only buttons
  always include `aria-label`.

### Named Rules

**The Nav-Glyph Boundary Rule.** Material Symbols Rounded appears in the sidebar nav and nowhere else;
every other surface is lucide. A Material Symbol outside the sidebar, or a lucide icon inside a nav
item, is a bug. If a future surface wants Material glyphs, it moves the boundary deliberately in one
change, it does not leak.

**The Filled-Chip Rule** (replaces the retired Outline-Badge Rule). Every status indicator is a filled
tonal chip: a role container fill, that container's `on-` ink, an icon, and pill radius. If a chip needs
to feel louder, the answer is a banner or an alert, not a stronger fill.

**The No-Header-Icon Rule** (kept). `CardHeader` is `CardTitle` plus `CardDescription` only. Icons live
in chips or in the `CardAction` slot. Once one card grows a header icon, every card grows one.

**The Save-Button Singleton** (kept). All save actions use `SaveButton` plus `useSaveFlash`. Extend it
rather than fork it.

**The Consistent-Layout Rule** (kept, Apple heritage). Feature pages compose as a page header plus a
uniform container-query grid of self-contained cards. A bespoke asymmetric layout unique to one screen
is almost always wrong; the dashboard is the one sanctioned glance surface, and even it is built from
the same self-contained cards.

**The Skeleton-Mirror Rule** (kept). Loading skeletons reproduce the geometry of the loaded state, radius
included; the page must not reflow when real data arrives. A centered spinner where a card's content will
be is a violation.

**The Saved-State Honesty Rule** (kept). Surfaces describing live behavior tell the truth: status cards
render saved settings and actual daemon state, the dashboard flags stale data instead of freezing
silently, a released carrier stays visible and greyed rather than vanishing, and the apply dialog renders
"Preparing..." rather than a fabricated step list before the first poll.

**The Muted-vs-Destructive Rule** (kept, and it matters more now). Muted means "deliberately off"
(Stopped, Disabled, Offline peer). Destructive means "failed" (Disconnected link, Failed email). Muted
must stay genuinely grey so the two never blur.

**The Deferred-Reboot Rule** (kept). Nothing reboots the modem as a side effect. Reboot-requiring changes
surface an explicit dialog (destructive CTA plus a "Later" escape) or an in-pipeline heartbeat notice;
persistent conditions get a banner (`SimSwapBanner` pattern).

### Aspirational / Not Yet Built

Documented for direction only; none of these exist in this tree today. Do not reference them as if they ship.

- **Circular signal meter** (Nokia FastMile-style 240 degree arc) for signal and antenna pages; the
  current alignment surface uses linear mini-bars.
- **Topology / neighbor-cell map** (UniFi-style pannable canvas); cell scanning currently renders as
  dense tables.
- **Sticky save bar** with per-tab error dots for long tabbed settings forms; current forms keep the
  `SaveButton` in the card footer.
- **Shared `ServiceStatusChip` wrapper**; the filled-chip pattern is composed inline until it lands.
- **Status-first column** anatomy for live-service pages (see Layout).

## Do's and Don'ts

### Do:

- **Do** derive new colors from the mark's hue family or an existing role, in OKLCH, as tokens in `globals.css`.
- **Do** pick a *pair*: a fill with its `-foreground`, or a container with its `on-` ink. Never mix across.
- **Do** use filled tonal chips with an icon for every status indicator.
- **Do** keep the functional four meaning exactly what they meant before.
- **Do** use pill metric rows on glance surfaces (12 rows or fewer) and hairline rows in genuine data tables.
- **Do** carry elevation with a container step, and let shadows be optional.
- **Do** scale radius with surface size: 28px inner tiles, 36px cards, 40px hero surfaces, full-round chips and nav.
- **Do** animate container changes at `standard` or `emphasized`, and value or label swaps at `quick`.
- **Do** build stacked shapes from explicit tone steps, never from stacked alpha.
- **Do** keep `tabular-nums` on every live value and `font-mono` on machine output and identifiers.
- **Do** keep Material Symbols Rounded inside the sidebar and lucide everywhere else, and self-host the
  Material subset rather than linking Google's CDN.
- **Do** test both themes, and measure the worst text pairing on each new surface before merge.
- **Do** keep `CardHeader` to title plus description, and put icons in chips or `CardAction`.
- **Do** use `SaveButton` for saves and exactly one filled primary action per surface.
- **Do** compose feature pages as a page header plus a uniform container-query card grid, and author each
  card as a self-contained component the page arranges.
- **Do** build on shadcn/ui first; restyle its primitives with these tokens rather than hand-rolling.
- **Do** use container queries (`@sm/card:`) inside a card that declares `@container/card`, and keep
  viewport breakpoints for page-level decisions.
- **Do** render step and sample progress as a spinner plus dot indicators; keep fill bars for data visualization.
- **Do** make skeletons mirror the loaded layout, put table empty states inside the table, and surface
  stale data with an honest alert band.
- **Do** defer reboots behind explicit dialogs or in-pipeline notices with honest time expectations.
- **Do** include `aria-label` on icon-only buttons, `role="status"` or `aria-live` on polling surfaces,
  and `role="alert"` on failure bands.

### Don't:

- **Don't** use hex literals, `#000`, or `#fff`. Every color enters as an OKLCH token.
- **Don't** place text on a fill using a container's ink, or on a container using a fill's foreground.
- **Don't** use outline-and-tint status badges. *(Retired rule: the Outline-Badge Rule.)*
- **Don't** treat secondary or tertiary as an action color, or as a second brand. *(The One-Accent Rule
  is retired as written; its intent survives as the Identity-Never-Acts Rule: exactly one hue acts.)*
- **Don't** animate a container color, size, or shape in 140ms. *(Retired rule: the 140-160ms floor.)*
- **Don't** add overshoot beyond the sanctioned 1.03 save check; no bounce, no elastic, no rubber band.
- **Don't** stack translucent copies of one color to fake tonal layers.
- **Don't** put pill rows in a 60-row table, or hairline rows on a four-row glance card.
- **Don't** reintroduce a hairline border on a card that already carries a tonal fill.
- **Don't** add icons to `CardHeader`. They drift into hero-metric SaaS template territory.
- **Don't** put a Material Symbol outside the sidebar, a lucide icon inside a nav item, or re-glyph
  Network Status while restyling it.
- **Don't** load an icon font or webfont from a remote CDN; the modem serves this app and may have no
  internet.
- **Don't** introduce a second UI typeface, or hand-wire a font into a component with a `font-family` style.
- **Don't** use `background-clip: text` gradients, side-stripe accent borders, or glassmorphism.
- **Don't** ship the hero-metric SaaS template, or invent a bespoke layout for one feature page.
- **Don't** build grids of decorative icon-plus-heading cards that carry no real controls.
- **Don't** hand-roll a component shadcn/ui already provides (tabs, accordion, dialog, popover, tooltip,
  select, dropdown).
- **Don't** let a functional hue be decorative, or a decorative hue land within 40 degrees of a functional one.
- **Don't** mix viewport breakpoints and container queries inside the same card; one breakpoint authority per card.
- **Don't** make modals the first thought. Inline disclosure, destructive buttons with clear descriptions,
  and deferred banners cover most confirmations.
- **Don't** let a UI claim liveness it does not have: no fake timers, no placeholder step lists, no frozen
  values without a stale-data notice.
- **Don't** document or reference removed features (NetBird VPN, DPI/Traffic Engine, Low Power Mode daemons)
  as design surfaces; they no longer exist on this branch.
- **Don't** use em dashes in documentation. Use commas, colons, semicolons, periods, or parentheses.
  (UI copy follows its own rules; this convention is for docs and code comments.)

## Migration Sequence

The system above is the committed canon. It is **not yet implemented**. Land it in this order; each
step is independently shippable and leaves the product correct.

| Step | Scope | State |
|------|-------|-------|
| 1 | **Tokens in `globals.css`.** Container roles, tinted surface steps, retuned amber, info aliased to the brand ramp, ring tone steps, the shape scale as additive role radii, motion curves and durations. No component touched; the product changes color and stays correct. | **Landed** |
| 2 | **Shell and shape scale.** Sidebar pills with the sliding indicator and the self-hosted Material Symbols Rounded subset, the role radii applied to cards and controls (retiring the legacy `--radius` chain), the new mark wired in (`public/qmanager-mark.svg` is already in the tree, currently unreferenced). | Not started |
| 3 | **Chips, banners, and the dashboard.** Flip the badge pattern to filled chips, retarget the banners to the eight-role system (`SimSwapBanner` first — it is the reference anatomy), adopt containers and pill rows on the status cards (Network Status keeps its icons), land the Carrier Aggregation strip. | Not started |
| 4 | **Dense pages.** Cell Scanner, log views, and SMS adopt the new tokens while keeping hairline rows. This is where the system is proven or corrected. | Not started |

**Step 3 is the CLAUDE.md gate.** The status-badge table in `CLAUDE.md` still documents the shipped
outline-and-tint pattern because that is what the code does today. Flip it to the filled-chip pattern
in the same change as step 3, not before, so the two documents never disagree about what ships.

Source of the direction: `reimagine/dashboard-design-exploration-directions/` (Claude Design handoff
bundle). "Recommended Hybrid" is the committed dashboard composition; the brand deck carries the
rationale slides.
