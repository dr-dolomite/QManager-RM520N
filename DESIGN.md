---
name: QManager
description: Modern web GUI for managing the Quectel RM520N-GL modem. The Operator's Console, in color, running on the modem it manages.
colors:
  # --- Brand / primary (source: the mark) ---
  mark-ring: "oklch(0.623 0.214 259.815)"
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
  ring-destructive-1-light: "oklch(0.945 0.05 25)"
  ring-destructive-2-light: "oklch(0.905 0.08 25)"
  ring-destructive-3-light: "oklch(0.835 0.12 25)"
  ring-destructive-1-dark: "oklch(0.275 0.07 25)"
  ring-destructive-2-dark: "oklch(0.365 0.105 25)"
  ring-destructive-3-dark: "oklch(0.49 0.15 25)"
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
> below. Component retargeting is partway: the status chips and the Banner System have landed, the
> shape scale and the opacity washes have not. See Migration Sequence at the end of this file for
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

The QManager mark (`public/qmanager-mark.svg`, the "Tonal Q") is two tones of one blue, carried in
the frontmatter above as `mark-ring` and `primary-light`. That pair is treated as a Material source
pair:

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
- **Use the radio-family tokens, `--chart-nr` and `--chart-lte`, not the numbered `--chart-1..6`.** The
  dashboard charts (Signal History, Live Latency) are now bound to the family tokens. The numbered ramp
  is inherited from the shadcn starter and has two disqualifying properties: its six values are
  **byte-identical in the light and dark blocks** of `globals.css`, so a chart built on them does not
  theme at all, and `--chart-1` through `--chart-5` sit in **one hue family** (blues around 250 to 265),
  so LTE and NR would be separated by lightness alone, which is the first distinction to collapse under
  a bright screen or a color-vision deficiency. The numbered tokens are kept only so existing
  non-dashboard call sites keep resolving; any new chart uses the family tokens. One trap when reaching
  for a role token directly: shipped `--secondary` is a **neutral** (it backs progress tracks), so the
  intended Carrier Violet has to come from `--lte`, not from `--secondary` (see Token Names in Code).
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

**The Age-Gated Tone Rule.** On a surface that lists *history*, two independent axes decide how a row is
drawn, and confusing them is the standard failure. **Tone** is what KIND of thing happened: failure,
degradation, recovery, or routine housekeeping. It is a fact about the event, it never expires, and it is
carried by a **filled icon disc in the solid role color** for as long as the row exists, plus by the
container fill for as long as the row has one. **Weight** is how much the row still deserves attention, and
it does expire. A row is drawn in its tonal container while it is **fresh or unresolved**, and once it is
neither it settles onto `bg-surface-container` keeping its disc at full strength: an hour-old recovery sits
on the plain surface with its green check still green. The OR is the entire rule.

The disc, rather than a tinted bare glyph, is what makes the settle survivable. The solid role is a full
step more saturated than the container it usually sits inside (`--success` L 0.52 against
`--success-container` L 0.89 in light, 0.82 against 0.30 in dark), so it separates from its own row in both
themes without a border and it stays the loudest thing in the row once the row goes neutral. A container
that expires cannot be where a permanent fact lives. The corollary is a hard one: **the disc never consults
the age gate.** An aged warning row goes grey and keeps a full-strength amber disc. Freshness (one hour) decides the common case, and
resolution is the safety valve underneath it, because age may retire history but it must never retire a
problem; a still-standing outage greyed out simply because time passed would read exactly like a band change
from last Tuesday. "Unresolved" means a degradation no later event has cancelled, which is a reading of the
log rather than a fact about the radio, so it is computed in the client. Three constraints this rule does
not get to relax. First, `severity: "info"` in this system means *routine*, not *good*: a cell handoff or a
band change is the radio working, so a fresh routine row is filled with the achromatic
`surface-container-high` and never with `success-container`, which would spend a functional color
decoratively and break the Functional-Color Promise. `primary-container` is no better a fit: it measures
L 0.400 in dark mode against 0.300 / 0.320 / 0.325 for success / warning / destructive, so a routine handoff
would be the brightest row on the card, louder than an outage. Second, the fill is a weak channel and the
glyph is the strong one: aged-vs-fresh separation measures only 1.16:1 to 1.24:1, and dark
`success-container` against `destructive-container` measures about 1.00:1, a hue-only difference. Two states
in the same slot must therefore never share a glyph. Third, because the glyph is then the sole visual
carrier of tone on every settled row and a screen reader cannot see a shape, any surface applying this rule
owes an `sr-only` severity word spoken before the label. Reference implementation:
`lib/event-presentation.ts` (the pure tone and pairing model) and
`components/dashboard/recent-activities.tsx`; the reading lives in the client, not in the poller, so the
device's transcript stays faithful and the interpretation can change without an OTA.

**The Identity-Never-Acts Rule.** Secondary and tertiary carry identity, never affordance. A violet
surface means "this is the LTE leg", never "click me". Only `primary` acts. *(This replaces the
retired One-Accent Rule, whose intent it preserves: exactly one hue acts.)*

**The Semantic-Token Rule** (kept). Reach for `bg-success-container` and `text-on-surface-variant`,
never raw Tailwind palette classes like `text-blue-500`. The theme switch depends on it.

**The OKLCH-Only Rule** (kept). No hex literals, ever. New colors enter the system in OKLCH form in
`globals.css`; conversion is the author's job, not the consumer's.

**The Explicit-Tone Rule.** Layered translucency is banned for stacked shapes. The service rings
composite to a flat disc when built from one color at 0.15 / 0.25 / 0.40 alpha; they use four
explicit tone steps instead (`tone-{role}-1` through `tone-{role}-3` plus the solid role at the core).
All three ring ramps are now symmetric: `--tone-success-*`, `--tone-warning-*`, and
`--tone-destructive-*` each walk their own role's hue outward-in. The red branch used to borrow
`surface-container` / `surface-container-high` / `destructive-container` because no destructive tone
steps existed, which is a neutral grey ramp with one red note: it read as broken chrome rather than
as a red state.

### Token Names in Code

Two roles above ship under different names in `globals.css`, because the canon's vocabulary collides
with shadcn's. The collision is real, not cosmetic: shadcn's `--secondary` is a **neutral** consumed by
progress-track fills and secondary buttons, so binding Carrier Violet to it would turn progress tracks
violet and hand affordance to a hue that must never act.

| Canon role | Token family in `globals.css` | Utilities |
|------------|-------------------------------|-----------|
| Secondary (Carrier Violet, 4G LTE) | `--lte`, `--lte-foreground`, `--lte-container`, `--on-lte-container` | `bg-lte-container`, `text-on-lte-container` |
| Tertiary (Uplink Cyan) | `--uplink`, `--uplink-foreground`, `--uplink-container`, `--on-uplink-container` | `bg-uplink-container`, `text-on-uplink-container` |
| Signal ring steps | `--tone-success-1..3`, `--tone-warning-1..3`, `--tone-destructive-1..3` | `bg-tone-success-2` |
| Outline (inputs, table rules) | `--outline` | `border-outline` |

Everything else uses its canon name: `--primary-container`, `--on-primary-container`,
`--success-container`, `--on-success-container`, `--warning-container`, `--destructive-container`,
`--info-container`, `--surface`, `--surface-container`, `--surface-container-high`, `--on-surface`,
`--on-surface-variant`, `--chart-nr`, `--chart-lte`, `--chart-threshold`.

`--secondary`, `--muted`, and `--accent` remain shadcn neutrals and are now mapped onto the surface
steps (`surface-container` for secondary and muted, `surface-container-high` for accent), so the
existing neutral vocabulary joins the tonal family without any component edit.

Two values are deliberately held one step off the table above. Step 3 was meant to pay them; both were
measured during that change and both are blocked on work step 3 does not cover, so they moved to step
3b in the Migration Sequence rather than shipping a regression:

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
Material Symbols Rounded, self-hosted and scoped to the sidebar and the dashboard route.
See Components > Icons.

### Hierarchy

- **Display / Page Title** (700, `text-3xl` / 30px, line-height 1.2): the `h1` at the top of every
  feature page, followed by an `on-surface-variant` description.
- **Headline** (600, `text-xl` / 20px, line-height 1.25): large card titles and state labels.
- **Title** (600, 1rem / 16px, `leading-none`): the `CardTitle` default. Tight leading so titles
  align cleanly with adjacent metadata.
- **Body** (400, `text-sm` / 14px, line-height 1.5): default UI text, descriptions, table cells.
- **Metric row** (600, `text-[13px]/5` / 13px on a 20px line box): the dense metric-row step, used for
  both the label and the value of a pill metric row on a glance card. It is a real ramp step, not a
  one-off: the two dashboard Primary Status cards render every row at it
  (`components/dashboard/signal-status-card.tsx`). **The `/5` is not optional.** 13px is an arbitrary
  Tailwind size, so it would otherwise inherit whatever leading the card sits in; pinning the line box
  to 20px is what holds the row at exactly 40px and keeps the loading skeleton's `h-10` mirroring it
  (the Skeleton-Mirror Rule). Do not reach for 13px outside a dense metric row; 14px body and 12px
  label remain the defaults.
- **Label** (500, `text-xs` / 12px): chips, table headers, button text, form labels, tiny uppercase
  section labels (`uppercase tracking-wider`, 11px in the sidebar).
- **Numeric** (600, sized to slot, `tabular-nums`): live signal values, counters, timers.
- **Mono** (`font-mono`, usually `text-xs` or `text-sm`): AT terminal streams, log viewers, copyable
  commands, IMEI/ICCID identifiers, band and ARFCN values, dBm readouts.

#### The pre-auth card exception (`/` and `/login/`)

The two pre-auth surfaces run a **denser five-step scale of their own**, sanctioned by the
`Login and Overview` comp. This is a surface-scoped exception in the same sense as the sidebar's 11px
label, and it applies **only** to the Overview splash and the login page — nothing else may reach for
these steps.

| Step | Size | Role |
|------|------|------|
| Card title | 600, `text-[1.1875rem]` / 19px, `tracking-[-0.01em]` | `Modem overview` — the card's own `h1` |
| Section title | 600, `text-[1.0625rem]` / 17px | the empty-state headline |
| Emphasis | 600, `text-[0.9375rem]` / 15px | the 48px pill CTA label, status-tile values |
| Body | 400/500/600, `text-[0.8125rem]` / 13px | subcopy, field labels, inline errors, banner body |
| Eyebrow | 600, `text-[0.6875rem]` / 11px, `tracking-[0.11em] uppercase` | the label above every tile and section |

**Why these surfaces get their own scale.** Every other screen in the product sits inside the app
shell, where the sidebar, page title and card grid establish scale before a card says anything. These
two are the only screens that are a single card on an empty canvas, so the card has to build its own
hierarchy from nothing — and it has to do it across five levels inside roughly 400px of width. The
14px/12px body-and-label default flattens to two levels at that size and the composition reads as
sparse rather than considered.

**The comp draws the eyebrow at 10px; it ships at 11px.** 11px is the floor already set by the
sidebar exception and by the eyebrow the Overview card shipped before the retarget. Going below it
would make uppercase text at 0.11em tracking the smallest type anywhere in the product, on the least
legible thing on the page. Comp fidelity does not justify a new product-wide minimum.

**Both surfaces must agree.** The 48px pill CTA appears on both and is the same role in both; a user
meets them back to back. When one of these steps changes, it changes on both screens in the same
commit.

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
| **emphasized** | `400ms cubic-bezier(0.05, 0.7, 0.1, 1)` | Container size and shape changes, the aggregation chain re-proportioning, alert arrival |
| **standard** | `300ms cubic-bezier(0.2, 0, 0, 1)` | Nav indicator, card entrance, meter fill, chip container morph |
| **quick** | `180ms ease-out` | Label swaps, live value ticks, hover tints, focus rings |
| **ambient** | `2s ease-in-out alternate` | Service rings, live ping dot, spinners; the only loops in the product |

`lib/motion.ts` is the JS mirror of these tokens and the **single** motion source in the tree
(`lib/motion-presets.ts` and the seven local variant clones that shadowed it are gone). Use it for any
`motion/react` transition; use the CSS custom properties for anything styled in a class. The two layers
carry the same values on purpose, so retune both in one change or the product drifts apart curve by
curve.

In code, all four tokens exist as real values, so no surface has to hardcode a curve or a duration:

| Token | Curve utility | Duration property |
|-------|---------------|-------------------|
| emphasized | `ease-emphasized` | `--duration-emphasized` |
| standard | `ease-standard` | `--duration-standard` |
| quick | `ease-quick` | `--duration-quick` |
| ambient | `ease-ambient` | `--duration-ambient` |

Page-level enter sits on **standard**, not emphasized. It is listed under standard below and is
implemented that way in `components/app-layout.tsx`; a navigation is the one moment where the user is
already waiting, so it gets the shorter curve.

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
- **Card cascade.** `staggerContainer` and `staggerItem` from `lib/motion.ts`, a 60ms step, each child
  rising 10px over `standard`. Import them rather than re-declaring local copies. Keep the 60ms step:
  wider and the last card feels late behind a slow poll.
- **Row cascade.** `staggerRows` and `staggerRowItem` from `lib/motion.ts`, a 40ms step, for rows
  *inside* one card (metric rows, test results, band rows, activity entries). `staggerRowItem` is the
  child that pairs with `staggerRows`, exactly as `staggerItem` pairs with `staggerContainer`. The step
  is denser than the card step on purpose: a cascade's total length is the step times the child count,
  so a card holding a dozen rows would take most of a second to finish at 60ms and read as still
  loading. Rows inside a shared border are also grouped by the eye as one object, so they should arrive
  nearly together. The rise is shorter too, **5px rather than the card's 10px**, and for the same
  reason it is not a taste call: rows inside one card sit at ~6px spacing, so a 10px lift carries each
  row past its own neighbour's resting position and the group reads as the card reflowing rather than
  as content arriving. Cards sit in a 16px page gutter, where 10px still reads as a lift. **Choosing
  between the two: if the children are cards, use `staggerContainer`/`staggerItem`; if they are rows
  sharing one card's border, use `staggerRows`/`staggerRowItem`.** These two are the only stagger steps
  in the product; no surface declares its own — the live value tick's cascade (below) reuses the 40ms
  row step rather than minting a third, because the figures it stages are rows inside one card's
  border. One implementation trap: a cascade child must be a
  block or `inline-flex` box. Transforms are ignored on non-replaced inline boxes, so a bare
  `motion.span` silently drops the 5px rise while still running the opacity fade, which looks like a
  half-broken animation rather than a missing one.
- **Nav indicator.** The active pill translates between rows over `standard` instead of appearing.
  This is the single most Material-feeling change in the shell.
- **Meter fill.** `scaleX` from `transform-origin: left` over `standard`. Never animate width, except
  the aggregation chain, where the width *is* the data. Fills **on first paint only**: subsequent polls
  move the scale through a transition rather than replaying from zero. Implemented as `.ca-meter` in
  `globals.css`, whose `@keyframes ca-meter-fill` carries a `from` and **no** `to`, so it animates up
  to whatever scale the element's own inline `transform` already holds. That construction is what keeps
  it non-load-bearing: the correct scale is always in the DOM and the keyframe only describes the
  journey. Do not reach for a `requestAnimationFrame`-armed state flip instead; rAF does not fire in a
  backgrounded tab, which would strand every meter at zero until the user returned to the page.
- **Chart draw-in.** A line chart plots itself on first paint instead of appearing whole: the stroke
  draws left to right over `standard` and the area fill follows 80ms behind it, so the line reads as
  leading and the fill as following rather than the two arriving as one block. Implemented as
  `.chart-draw` in `globals.css`, put on the `ChartContainer`, whose selectors reach **recharts' own
  emitted classes** (`.recharts-line-curve`, `.recharts-area-curve`, `.recharts-area-area`) rather than
  wrapping them. That indirection buys the recipe's hardest clause, "first paint only", for free: a CSS
  animation fires on element *mount*, and recharts mutates a path's `d` attribute across polls instead
  of remounting the node, so there is nothing to replay and no bookkeeping to write. Two props are
  mandatory on every consuming series. **`isAnimationActive={false}`** removes recharts' own `<Animate>`
  wrapper, which is what makes the path node stable; recharts keys that wrapper on the data array's
  *identity*, so a polling card that rebuilds its array each tick re-runs a 1500ms `ease` animation
  every poll, well past the motion ceiling, on a curve from no design system, and invisible to
  `MotionConfig` so a reduced-motion user cannot escape it. **`pathLength={1}`** normalizes any path to
  one SVG user unit, which is what makes `stroke-dasharray: 1` a single dash covering the whole line at
  any width; these cards are container-responsive, so real path length changes with the viewport. (The
  design mock hardcodes `stroke-dasharray: 2400` against paths 400 to 700px long. Visible length is
  `min(L, D - offset)`, so nothing appears until the offset falls under ~1800: the first 75% of its
  300ms is dead time and the line snaps in over the last 75ms. Copying that constant faithfully would
  have shipped a snap and called it a draw.) Open-ended keyframes, a `from` and no `to`, on the same
  construction as `.ca-meter`: resting `stroke-dashoffset` is 0 and resting opacity is 1, so the chart
  is already correct if the animation never runs. Its reduced-motion block clears `stroke-dasharray`
  rather than merely stopping the keyframe, because the dash array is the mechanism and not the
  appearance, and a stopped animation would otherwise leave the line visibly dashed.
- **Live value tick.** An 180ms opacity dip to 35% on a `tabular-nums` value. No fade-out-then-in, no
  layout shift, no color flash. Use `TickingValue` (`components/ui/ticking-value.tsx`), or
  `useValueTick` directly where a hook is legal; the component exists because the values that need this
  are usually inside a `.map`. Three contracts ride with it: it fires on a **change** and never on
  first paint (arrival belongs to the skeleton crossfade), it **interrupts and retargets** rather than
  queueing when a value moves mid-dip, and it is driven by the Web Animations API rather than a keyed
  remount so it does not churn the DOM inside a polling surface's `aria-live` region. It is the one
  place reduced motion removes an opacity change rather than preserving it: a repeating luminance flash
  every two seconds carries no information the new number is not already carrying.

  **A card full of live figures cascades rather than flashing.** All of a card's values arrive in one
  poll response and land in one React commit, so every dip used to fire on the same frame and the card
  read as *the whole card blinking* instead of as its individual numbers ticking. Recipe 06's own demo
  stages its three values apart for exactly this reason. `TickGroup`
  (`components/ui/tick-group.tsx`) is the primitive that gives a group an order: it is a context
  provider that **renders no DOM**, so dropping one around a card body cannot disturb the layout.
  Inside a group `useValueTick` *enqueues* on a change instead of starting; the group drains on a
  shared microtask and starts each member at `rank × 40ms`.

  Four things about that cascade are load-bearing, and each of them is a rejected alternative:

  1. **Rank is assigned among the values that CHANGED, not by ordinal position in the card.** Ordinal
     indexing is the obvious build and it is measurably wrong here. Device Information holds nine
     identity rows (manufacturer, firmware, IMEI, ICCID…) that change approximately never, above two
     live uptime tiles: a typical poll would sit silent through nine slots and then dip at **540ms and
     600ms**, which is not a cascade, it is unexplained latency. Device Metrics would cascade with
     *holes* wherever a value happened not to move, which reads as rows failing to render. Ranking
     over only what moved gives a gapless cascade whose length is bounded by how many figures actually
     changed — typically three to five, so a ≤160ms tail. The honest cost: one row's *absolute* delay
     shifts between polls. What never shifts is its position relative to its neighbours, which is what
     the eye is actually reading.
  2. **Order comes from live DOM nodes (`compareDocumentPosition`), not an index prop or an axis
     flag.** Document order *is* reading order for every group in this dashboard without a direction
     hint: vertical stacks read top-to-bottom, the Data Used rx/tx pair reads left-to-right, and
     Carrier Aggregation's `grid-cols-1 → @md:grid-cols-2 → @3xl:grid-cols-4` grid places **row-major**,
     so index order survives all three breakpoints. Sorting live nodes also means a conditionally
     rendered value is simply *absent* rather than leaving a dead beat — Signal Status' band row takes
     an identity-pill branch that mounts no tick at all, and a naive map index would have opened every
     cascade with a silent slot.
  3. **The drain is a shared microtask, not a parent layout effect.** A parent effect would also see
     every child, since React runs child layout effects first — but only if the parent re-rendered in
     that commit, so a memoized subtree updating alone would strand its registrations. A microtask
     flushes after the whole commit's layout effects regardless of which components rendered.
  4. **The step is `STAGGER_STEP_ROWS` (40ms), the row step — not the 60ms card step, and emphatically
     not the demo's 350ms.** These figures are rows inside one card's border, which is exactly what the
     denser step owns. Recipe 06's demo does stage its values 350ms apart, but that is a 2s *looping*
     demo spacing three dips far enough apart to be legible in isolation, and the Motion Guide's own
     Don'ts cap stagger at 60ms: the demo's offsets are legibility spacing, not a product value. Do not
     "restore" them after re-reading the mock. Rank is clamped at `MAX_RANK` (7) so a group past the
     guide's ~8-item ceiling shares the tail slot instead of growing an unbounded tail.

  The cascade also forced a fix to the retarget contract above. `useValueTick` used to `cancel()` the
  running animation, which snaps opacity back to 1 — invisible while every tick started on the frame it
  was requested, but under a delay it becomes **snap → freeze → dip**, so the fastest-moving figures on
  a card would get the worst feedback. The fix is two halves: read the element's *current computed*
  opacity **before** cancelling (cancelling is what discards it) and use it as the first keyframe, and
  add **`fill: "backwards"`** so that keyframe holds through the delay instead of painting the resting
  state. Same construction as `.ca-meter`'s `animation-fill-mode: backwards` in `globals.css`, which
  stops a staggered meter painting at full scale before its turn.

  Scope one `TickGroup` per card body, not per sub-group; a group of one is pointless, and a group
  spanning several cards would let a single poll cascade past the poll interval itself.
- **Status chip swap.** The label crossfades over `quick` while the container color morphs over
  `standard`, so the state change is felt before it is read. The icon always changes with the color.
  The container half lives in `components/ui/badge.tsx`, which writes its transition longhand because
  it runs on two clocks: fill and ink on `standard`, focus ring on `quick`. No single Tailwind duration
  utility can express that, which is how `background-color` fell out of the list and every chip in the
  product spent a while cutting straight to its new fill. The label half is
  `components/ui/swap-label.tsx`: use the shared `SwapLabel` primitive at every chip whose contents
  change at runtime, and put the **glyph inside it** — the glyph is the only channel separating these
  tones in greyscale, so leaving it outside snaps it in one frame while the fill morphs over 300ms.
  Key `SwapLabel` on what the chip **says**, not on its variant, since two states can share a
  container — and equally, a key coarser than the variant animates nothing when only the tone moves,
  so encode both where they can move independently. Do **not** hand-roll the label half from a keyed
  `motion.span`: without `AnimatePresence` React drops the outgoing node in a single commit, so only
  the incoming label animates and half the crossfade is silently missing. One accessibility clause
  rides with it: `SwapLabel` uses `mode="popLayout"`, which keeps the outgoing and incoming spans
  mounted together for the length of the crossfade, so an `sr-only` accessible name must stay
  **outside** the wrapper or a screen reader meets it twice on every tone change.
- **Aggregation re-proportion.** Segment widths animate over `emphasized` when a carrier is added or
  released; released segments stay in place, greyed, rather than being removed. A carrier the radio has
  just **added** additionally grows in from zero width via `.ca-segment-enter`, on the same open-ended
  keyframe construction as the meter. Entrance is scoped to genuine additions: a whole chain appearing
  at once is the card arriving, which belongs to the skeleton handoff, and four simultaneous `width`
  animations would be four layout passes to announce something that was never absent.
- **Skeleton handoff.** A crossfade over `quick`, with no movement. The outgoing skeleton is an
  **overlay on top of** the real content, never a sibling beside it: stacked as siblings the container
  sizes to the taller of the two for the duration of the fade and then collapses, so the handoff ends on
  a jolt. As an overlay the content owns the container's height from its first frame and the crossfade
  contributes no layout shift at all. Render the skeleton from a single extracted definition shared by
  the loading branch and the overlay, or the two drift and the Skeleton-Mirror Rule fails silently.
  `.ca-skeleton-out` / `.ca-content-in` are the reference implementation.
- **Alert arrival.** New Recent Activity rows enter from the trailing edge over `emphasized`; existing
  rows move on transform. Nothing animates out; history does not retreat.
- **Save confirmation.** `SaveButton` swaps idle to "Saving..." to "Saved!" on `useSaveFlash` timing;
  the check scales to 1.03 and settles. The check is the **only** element in the product permitted to
  exceed 1.0 scale, and only to 1.03.
- **Service rings.** `animate-pulse-ring`, three concentric discs on the `tone-{role}-{1,2,3}` steps
  (all three ramps, success / warning / destructive), offset 0 / 0.3s / 0.6s. This is the only thing
  on the dashboard that loops continuously, and **it stops the moment the service is not active** — a
  ring that pulses over a dead service is a lie. The pulse is also what stops a full-strength red ramp
  from crying wolf: red and static-amber stacks are frozen while only a live one breathes, so tone
  says how bad and motion says whether it is alive. See Components > Service rings for the state table.
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

**All status indicators are filled tonal chips**: `bg-{role}-container`, `text-on-{role}-container`, an
icon, pill radius. The icon is lucide everywhere except the dashboard route, which is on Material
Symbols (see Icons). The outline-plus-tint pattern is **retired**. Inside a tonal system
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
reserve **Destructive** for failure or error (Disconnected link, Failed email).

The wrapper exists: these five roles are variants in `components/ui/badge.tsx`'s `cva`, so a chip is
written `<Badge variant="success">` and the classes above are an implementation detail. Tone maps key
onto the exported `BadgeVariant` type rather than a class string, which makes a tone without a matching
role a build error instead of a review catch.

**Colour never carries the state on its own.** `success-container` (L 0.89) and `warning-container`
(L 0.905) measure **1.03:1** apart — the same surface to the eye, and indistinguishable under
deuteranopia. The glyph is doing the work, so every chip has one, and two states that can appear in the
same slot must not share a glyph. The signal-quality chips in the cell scanner are the worked example:
Good / Fair / Bad carry `SignalHigh` / `SignalMedium` / `SignalLow`, which encode the verdict by bar
count and survive both a colourblind reader and a greyscale print.

#### Identity chips: `nr` and `lte` (not status chips)

Two further variants live in the same `cva`, and they are a **different kind of thing**. `nr`
(`primary-container`, brand blue) and `lte` (`lte-container`, Carrier Violet) carry which **radio** a
chip belongs to. They never vary with health, and an identity fill never means "this is fine".

They exist so a radio-identity tone can key onto the exported `BadgeVariant` type like every other
tone map, instead of being hand-written as a class string at the call site. The shipped consumer is
the quality chip on the two dashboard Primary Status cards
(`components/dashboard/signal-status-card.tsx`), which is toned by RAT so the paired cards are told
apart from across a room.

> ⚠️ WARNING: this is not a licence to tint status indicators by identity. The five status roles
> above remain the **only** correct choice for an actual status indicator.

**The Identity-Chip Rule.** Where a chip carries identity, the quality it also reports must be
encoded somewhere **non-chromatic**. On the signal cards that channel is the Material glyph's bar
count, a five-step monotonic ladder that survives greyscale and deuteranopia:

| Quality | Glyph |
|---------|-------|
| Excellent | `signal_cellular_4_bar` |
| Good | `signal_cellular_3_bar` |
| Fair | `signal_cellular_2_bar` |
| Poor | `signal_cellular_1_bar` |
| None | `signal_cellular_off` |

The **wedge** family, not the `signal_cellular_alt*` bar family the source mock drew. The mock only
rendered Excellent and Good, so it never exposed what the alt family does further down: `alt_1_bar`
is a single 120×240-unit mark (~2×4px at `size={16}`, indistinguishable from a failed icon load) and
there is no `alt_0_bar` at all, so Poor and None fall back to full-size wedges. Ink mass would run
large → medium → speck → large → large. The wedge family holds one constant silhouette and grows the
solid fill, so every rung shares a footprint and the ladder scans as a meter.

This is a stronger channel than the fill ever was. `success-container` and `warning-container`
measure 1.03:1 apart, so the previous quality-toned chip was already leaning on its icon to be read;
moving the fill to identity cost nothing that was actually carrying meaning.

### Service rings (Network Status)

The dashboard's Network Status orbs are three concentric tone discs plus a solid core, built per the
Explicit-Tone Rule from `--tone-{role}-1/2/3` and never from stacked alpha. **Two orthogonal axes
run through them, and they must stay distinct in any surface that reuses the pattern:**

- **Ring tone tracks RAT quality.** Amber is a *working* connection that is not optimal, not a fault.
- **Core glyph tracks service liveness.** It answers "is there service at all".

| Ring tone | Pulse | Core glyph | Meaning |
|-----------|-------|------------|---------|
| Green | Pulses | `check` | Optimal |
| Amber | Pulses | `check` | LTE without carrier aggregation: working, not optimal |
| Amber | Static | `warning` | Searching / Limited |
| Red | Static | `priority_high` | No Service / SIM error / unknown |

The pulse is a **redundant** channel, gated by `isServiceActive`: tone says how bad, motion says
whether it is alive. `prefers-reduced-motion` removes the pulse entirely and the glyph still carries
the whole meaning on its own. That gating is also what keeps a red ramp from crying wolf: red and
static-amber stacks are frozen, and only a live one breathes.

Orb geometry is shared with the skeletons so the two can never drift: a 152px disc with a 96px glyph,
leaving roughly 28px of optical padding. 96 is near the ceiling, not a taste call. The corner badge
occupies x 110-138 / y 4-32 of the orb box, and at 96px the widest glyph's ink still clears it.
Re-check that overlap before raising it.

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

**Metric value tints stay on the functional palette, on both radios.** A tinted metric value uses the
darkened `-on-surface` ink steps (green / amber / red), never the identity hue, and never the solid
role tokens. The design mock tinted some LTE values violet; that was deliberately not followed,
because a value's colour is a verdict and a verdict must not change meaning with the radio reporting
it. The mock's literal tints were also unusable on contrast grounds: it reaches for the **solid** role
tokens, which measure **4.29:1 (`--ok`)** and **3.74:1 (`--wa`)** on `surface-container` in light mode,
both below AA. The shipped `-on-surface` ink steps measure 5.88 and 5.95.

Colour is never the only channel on a metric row either. `success-on-surface` and
`warning-on-surface` measure roughly **1.01:1** apart in light mode, so they are the same luminance
separated only by hue, and green and amber converge under deuteranopia: a "good" SINR and a "fair"
SINR were the same grey number to a colourblind technician in sunlight. Every tinted value therefore
carries an `sr-only` quality word after it. Identifier rows (Band, ARFCN, PCI, SCS) are untinted and
must **not** get one, because they have no good-or-bad reading to announce.

### Inputs / Fields

- **Style:** `surface-container` fill in both themes, 1.25rem radius, `h-10`, `px-3.5`, no border at rest.
- **Focus:** a 3px `primary` ring at 50% opacity plus a `primary` edge, transitioned on `color, box-shadow`.
- **Error:** `aria-invalid` drives a `destructive` edge plus a `destructive` ring tint (40% in dark).
- **Disabled:** `opacity-50`, `pointer-events-none`, not-allowed cursor.
- Supporting field primitives: `field.tsx` (label plus value display), `input-group.tsx` (prefix/suffix),
  `kbd.tsx`, `copyable-command.tsx` (mono command with a copy affordance).

### Navigation

The sidebar was the first surface to carry Material Symbols Rounded glyphs, and the dashboard route
has since joined it (see Icons).

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

- **Container:** `bg-{role}-container` with `text-on-{role}-container`, **field radius** (20px,
  `rounded-field`), **no border**. Not card radius: at 36px the banner would out-round the cards
  beneath it and invert the shape hierarchy, which is the opposite of what the shape scale is for.
- **Glyph:** a `size-9` filled circle on the role's strong fill (`bg-{role}`, `text-{role}-foreground`)
  holding a `size-5` icon. Never a bare icon on the container.
- **Title:** 15px semibold (tracking -0.005em). **Note:** 15px and 13px are the banner's own two type
  steps — a banner is denser than body copy and looser than a label, and both steps are measured for
  AA on every role container. 13px has since been promoted to a real ramp step (the dense metric-row
  step, see Typography > Hierarchy); 15px remains banner-scoped and is now the only sanctioned literal
  font size outside the ramp. **Identity line** (optional): a machine-voice row of carrier, number, or
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
Its spinner is a **default, not a fixture**: pass an explicit `icon` and that glyph is used instead.
Role 05 is also the right container for a calm standing notice that happens to be primary-toned (the
deferred-reboot notice inside the profile apply dialog is the first such caller), and a spinner there
would advertise work that is not running. Callers that pass no icon are unaffected.
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

**Motion.** Enter on `emphasized` (400ms): a 6px **descent** plus a fade (`translateY(-6px)` to
`none`, i.e. the banner settles down into place from above, which is where it comes from), replacing the older
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
  tone for secondaries. Segment labels carry the band and its bandwidth, and never wrap. (The band
  was added when the strip was built: bandwidth alone leaves the chain unreadable, since a bare "60
  MHz" does not say which carrier it belongs to. Below the `@md` container step the labels drop
  entirely and the chain becomes a bare proportion bar, because at phone width a small segment is
  narrower than its own padding; the tiles beneath carry every label the segments give up.)
- A **tile row** beneath: one tile per carrier with band, role chip, PCI, ARFCN or EARFCN, and an RSRP
  quality bar.
- On loss, released segments **stay in place greyed**, with the aggregate figure showing what remains
  against what it was, so a drop reads as a gap rather than a redraw.
- Empty and degraded states are honest: "released 3 min ago", never a silent absence.
- **Motion.** This is the surface where the largest share of the motion vocabulary lands at once, and
  the reference implementation for four of its entries: the skeleton handoff, the meter fill, the
  aggregation re-proportion (including the added-carrier entrance), and the live value tick on RSRP and
  on the aggregate MHz figure. All of it is one-shot; the strip carries **no** ambient loop, because
  nothing on it is continuously live in the way a service ring or a ping dot is. Note that a
  four-carrier configuration ticking together puts five concurrent animations on the surface, one over
  the Motion Guide's stated ceiling of three. That is a deliberate, measured exception rather than an
  oversight: they are opacity-only, compositor-promoted, and collectively cheaper than the single
  `width` animation the same guide sanctions ten pixels above them.

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

Two libraries, one hard boundary. The boundary is **the route**, not a vibe, and it is tracked
deliberately rather than allowed to drift.

- **Material Symbols Rounded is scoped to the sidebar navigation and the dashboard route.** Its
  filled (`FILL 1`) and outlined (`FILL 0`) axes are what make the active nav pill read as active
  without relying on the container tone alone, and the same fill axis gives the dashboard's glance
  surfaces a heavier, tonal glyph weight that matches the shape scale. It must be **self-hosted** (a
  subset WOFF2 shipped with the build, bound through a font variable like every other face): the app
  is served by the modem itself and can never depend on `fonts.googleapis.com`.
- **Lucide is the library for every other route**: Cellular, Local Network, Monitoring, System
  Settings, dialogs launched from them, the header bar, page content. Prefer its rounded,
  filled-adjacent glyphs so the icon weight matches the shape scale.
- **Tabler** (`@tabler/icons-react`) remains the sanctioned secondary for glyphs lucide lacks. Some
  legacy surfaces import from `react-icons` (Md/Fa6/Tb); do not extend that dependency in new work.
- `size-4` inline, `size-5` in chips and buttons, `size-8` and up in empty states. Icon-only buttons
  always include `aria-label`.

**Sizing gotcha: `MaterialSymbol` sets `fontSize` inline.** An inline style outranks any utility, so
the auto-sizing rules that reach a lucide child do **not** reach a Material glyph:
`badge.tsx`'s `[&>svg]:size-3` and `empty.tsx`'s `[&_svg:not([class*='size-'])]:size-6` both silently
lose. Every Material glyph therefore passes `size` explicitly at its call site (12 in a dense chip,
16 where the glyph is the only channel carrying meaning, 24 in an `EmptyMedia`). Both files carry a
comment saying so. Only `pointer-events` ports across, via a parallel
`[&>[data-slot=material-symbol]]` rule.

**Adding a glyph is a one-list, one-binary change.** `MATERIAL_SYMBOL_NAMES`
(`components/ui/material-symbol-names.ts`) is the single source of truth: `MaterialSymbolName` is
derived from it and `scripts-dev/subset-icons.ts` imports it, so the compiler and the font cannot
disagree about which glyphs exist. Add the name (**keeping the array sorted**), run
`bun run icons:subset`, and commit the regenerated `.woff2` **and** `.json` together.

The failure this guards against is invisible until it reaches a device: the typeface is
ligature-driven, so a glyph the type permits but the font lacks type-checks, builds, and then renders
the literal word `sim_card` on a modem in the field. `bun run icons:check` — which runs inside
`bun run package` — compares the committed font against the manifest the generator writes, catching a
stale font, an unsorted list, and a collapsed `FILL` axis. See `docs/reference/icon-system.md`.

### Named Rules

**The Icon-Boundary Rule** (replaces the retired Nav-Glyph Boundary Rule). Material Symbols Rounded
appears in the **sidebar nav and the dashboard route**; every other route is lucide. A lucide icon
inside a nav item is a bug, and so is a Material Symbol on an unmigrated route. The boundary is
per-route on purpose: the failure this rule exists to prevent is **two icon sets inside one screen**,
and the dashboard was carrying four (lucide, `react-icons/md`, `/fa6`, `/tb`) beside a Material
sidebar. When another route wants Material glyphs it moves the boundary deliberately in one change
and updates this rule, `.impeccable/design.json`, and `CLAUDE.md` with it. It does not leak.

**The Network Status Landmark Rule.** Network Status keeps its existing icons through any restyle. It
is a recognized landmark on the one glance surface and re-glyphing it buys nothing. Two exceptions to
the icon boundary survive on it by explicit decision, and they are the only two on the dashboard: the
SIM orb keeps lucide `CardSimIcon` / `Plane`, and the RAT glyphs keep `react-icons/md` (`MdOutline5G`,
`Md4gPlusMobiledata`, `Md4gMobiledata`, `Md3gMobiledata`), because "5G", "4G+"
and "3G" are typographic marks Material Symbols has no equivalent for.

**The Identity-Chip Rule.** `nr` and `lte` are identity roles, not status roles. Where a chip carries
identity, the quality it also reports must be encoded somewhere non-chromatic. See Status chips.

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
- **Migration of the opacity washes** (`bg-{role}/5`, `/10`, `/15` on icon discs, tone tiles, pulse
  rings and inline notices); the chip flip retired the tinted *badge*, not these.
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
- **Do** keep Material Symbols Rounded inside the sidebar and the dashboard route, lucide on every
  other route, and self-host the Material subset rather than linking Google's CDN.
- **Do** pass `size` explicitly on every `MaterialSymbol`; its inline `fontSize` outranks the parent's
  auto-sizing utilities.
- **Do** add a new glyph to `MATERIAL_SYMBOL_NAMES` (sorted), then re-run `bun run icons:subset` and
  commit the regenerated WOFF2 **and** its manifest `.json` in the same change. `bun run icons:check`
  fails the build if you forget.
- **Do** encode quality non-chromatically (bar count, glyph ladder) whenever a chip's fill is spent on
  identity.
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
- **Don't** put a Material Symbol on a route still on lucide, a lucide icon inside a nav item, or
  re-glyph Network Status while restyling it. *(Retired rule: the Nav-Glyph Boundary Rule, which
  scoped Material Symbols to the sidebar alone.)*
- **Don't** use `nr` or `lte` for a status indicator. They say which radio, never whether it is well.
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
| 2 | **Shell and shape scale.** Sidebar pills with the sliding indicator and the self-hosted Material Symbols Rounded subset, the role radii applied to cards and controls (retiring the legacy `--radius` chain), the new mark wired in (`public/qmanager-mark.svg` is already in the tree, currently unreferenced). | **Partial.** Nav half landed. The dashboard's own cards now carry role radii (`rounded-hero` on the two hero cards, `rounded-card` on the rest). The legacy `--radius` chain is still live everywhere else: `rounded-md` alone has 114 call sites, so retargeting it silently would be a regression, not a migration. |
| 3 | **Chips, banners, and the dashboard.** Flip the badge pattern to filled chips, retarget the banners to the eight-role system (`SimSwapBanner` first — it is the reference anatomy), adopt containers and pill rows on the status cards (Network Status keeps its icons), land the Carrier Aggregation strip. | **Landed.** The Banner System shipped as `components/ui/banner.tsx` (all eight roles; 01/02/03/05/07 mounted, 04/06/08 available but unmounted). **The badge flip is done**: the five chip roles live in `components/ui/badge.tsx`'s `cva`, all 90+ call sites across 33 files render `variant="…"`, four tone maps key onto the exported `BadgeVariant` type, and the `CLAUDE.md` table now documents the filled chip. **The Carrier Aggregation strip has landed** (`components/dashboard/carrier-aggregation.tsx` plus the pure view model in `lib/carrier-aggregation.ts`), mounted `col-span-full` and replacing the deleted `scc-status.tsx`; the dashboard's carrier surfaces now carry pill metric rows on `surface-container`, filled quality chips and identity-toned band pills. Step 3 is closed. **Four retargeted dashboard cards now also carry the motion canon.** Three of them, Network Status, Device Information and the 4G/5G Primary Status card, had tonal surfaces but no state-change motion, and were animating only via the outer card cascade. They now use `staggerRows`/`staggerRowItem` for their in-card rows, `TickingValue` for live readings, a label crossfade for chip contents (shipped then as a locally keyed `motion.span`; since extracted to the shared `SwapLabel`, which is the only correct construction — see the "Status chip swap" vocabulary entry), badge glyphs and orb labels, `standard` colour transitions on containers (chips, orb fills, ring tones, the core disc, band pills) and `quick` ones on ink and focus rings. The split between the two tick mechanisms is the load-bearing part: `TickingValue` bakes in `tabular-nums` and keys on a datum that moves every poll, so it is for figures; a word that changes on a handover takes the label crossfade instead. `components/ui/metric-bar.tsx` lost its spring in the same pass: a spring settles by oscillating, which the Settled-Motion Rule bans outright, and it made a 61% meter overshoot to ~64 and rock back. **The fourth card, Recent Activities, was rewritten rather than retuned**, and it is where the Age-Gated Tone Rule (see Named Rules, Color) enters the system: the card's tonal fill now encodes weight rather than severity, lit while a row is fresh or still unresolved and settling to a colored icon disc on the plain surface once it is neither, so a historical list can say "this is recent, and this is still wrong" without ever tinting routine radio events as good news. It ships two animations against the three-per-surface budget, recipe 04's `emphasized` head-row arrival plus a single group transform for the history push, and the three-state variant set (`settled`/`pushed`/`visible`) that lets one element carry both lifecycles, since a motion child declaring its own `initial`/`animate` object stops variant propagation. Its glyphs moved from `react-icons/tb` to lucide under the then-current Nav-Glyph Boundary Rule, and moved again to Material Symbols in step 3d; its type stayed on the `text-xs`/`text-sm` ramp rather than taking the sidebar's 11px (still a surface-scoped exception) or 13px (since promoted to a real ramp step in step 3d, but scoped to dense metric rows, which an activity row is not). **A follow-up pass retargeted the row from the `Recommended Hybrid` treatment to the Motion Guide's recipe 04 anatomy**, which is the version that ships: a filled 28px disc in the solid role color, the message promoted to the primary line, a `font-mono` timestamp caption below it, and the event-type label dropped as a restatement of what the message and the disc already say. The arrival gesture was retuned in the same pass from a 24px nudge to `x: "100%"`, i.e. an actual entrance from off the trailing edge — at 6% travel the row had been twitching rather than arriving. `ROW_H` stayed 60px through both changes because the two lines swapped roles without changing size, so the clip arithmetic and the card's height against its grid siblings never moved. See `docs/reference/recent-activities.md`. This is refinement inside step 3, not a new step. **The dashboard retarget is now complete.** The three cards the `QManager Dashboard Final` mock had not yet reached, Device Metrics, Live Latency and Signal History, have landed, so all seven dashboard cards carry the tonal system and the motion canon. Device Metrics moved from hairline separators to filled pill rows on `surface-container` with 8px meter tracks; Live Latency and Signal History became gradient area charts on `--chart-nr` / `--chart-lte` with the recipe 16 draw-in, and Signal History joined the entrance cascade (it had been the one dashboard card outside it, a bare div while every sibling rose into place). Diffing `Recommended Hybrid` against `QManager Dashboard Final` over this block returns only animation attributes, so the Final mock is the Hybrid plus motion and both halves landed together. See `docs/reference/dashboard-chart-cards.md`. |
| 3b | **Token debt owed by step 3.** Move dark `--destructive` to the canon value and promote `--border` to `--outline` (see "held one step off" above). | **The `--destructive` half has landed; the `--border` half is still deferred.** Destructive kept deferring because it was never a one-token move. It was the last functional role still carrying the LIGHT-mode *shape* in dark: a mid fill (L 0.62) under near-white ink (L 0.99). Raising the fill alone to the canon `oklch(0.77 0.175 25)` measures **2.42:1**, below even the 3:1 large-text floor, which is exactly what earlier passes measured and correctly refused to ship. The fix is to move the **pair**, fill light and ink dark, precisely as success (0.82 / 0.22) and warning (0.865 / 0.24) already do: `--destructive-foreground` is now `oklch(0.24 0.07 27)` and the pair measures ~6.3:1. That reframes `text-white` on a destructive fill as the bug rather than the blocker. Only **two** sites carried it, and both now read `text-destructive-foreground`: `Button`'s destructive variant, and the hand-rolled copy of that variant on the delete-profile `AlertDialogAction` in `custom-profile-view.tsx`. **Badge was never one of them**, despite earlier revisions of this row naming it: its destructive variant moved to `bg-destructive-container` / `text-on-destructive-container` with the chip flip, so it has never placed ink on a fill. `Button`'s `dark:bg-destructive/60` went in the same change; it was compensation for the mismatched pair, not intent, and against the correct pair it *inverts* (60% of an L 0.77 fill over a dark card lands near L 0.65, dropping ~6.3:1 to ~5.1:1) while an alpha is a request to the canvas rather than to the token, so the same button rendered a different red in a dialog, a card and a popover. **`--border` to `--outline` is unchanged and still deferred**: it is gated on cards dropping their hairlines, which has not happened, and step 4 keeps hairlines in the dense tables deliberately, so promoting it now would make the very hairlines this system retires *more* prominent. It moves when that blocker clears, not before. |
| 3c | **Identity colour outside the token system.** Retire the connection-scenario gradient palette and move scenario identity onto glyphs; convert the profile apply dialog's deferred-reboot wash to the Banner primitive. | **Landed.** `gradientOptions` (12 raw Tailwind gradients) and `getRingColor()` (12 `ring-*-500` classes selected by substring-matching the gradient) are gone. Scenario tiles are `surface-container` with a filled `bg-primary` glyph disc, and identity is a persisted glyph key resolved through `scenario-icons.ts`. `AbstractPattern` now draws in `currentColor`, so the texture follows the theme instead of assuming a dark tile. |
| 3d | **The dashboard's icon and chip finish.** Move the icon boundary from "sidebar only" to "sidebar plus the dashboard route", give the failed service ring a real tone ramp, and settle the Primary Status cards' chip and type treatment. | **Landed.** Every dashboard card body is now Material Symbols; the route previously carried four icon sets in one viewport (`lucide-react`, `react-icons/md`, `/fa6`, `/tb`) beside a Material sidebar. The Nav-Glyph Boundary Rule is retired and replaced by the **Icon-Boundary Rule**; the two Network Status exceptions (SIM orb on lucide, RAT marks on `react-icons/md`) are named in the **Network Status Landmark Rule** rather than left as drift. The subset grew 19 → 56 glyphs, 10.4 KB → 20.2 KB. `--tone-destructive-1/2/3` shipped in both themes, so all three ring ramps are now symmetric. The Primary Status quality chip moved from quality tone to **radio identity** via the new `nr` / `lte` `Badge` variants, with quality re-encoded as the glyph's bar count (the **Identity-Chip Rule**). 13px joined the type ramp as the dense metric-row step. Two accessibility additions ride along: an `sr-only` quality word after each tinted metric value, and `min-w-0` + `truncate` on the card header. See `docs/reference/icon-system.md`. |
| 4 | **Dense pages.** Cell Scanner, log views, and SMS adopt the new tokens while keeping hairline rows. This is where the system is proven or corrected. | Not started |

**Step 3's CLAUDE.md gate is closed.** The status-chip table in `CLAUDE.md` was flipped to the
filled-chip pattern in the same commit as the code, so the two documents agree about what ships.

**The opacity washes are a separate family and are still unmigrated.** `bg-{role}/5`, `/10` and `/15`
survive on icon discs, tone tiles, pulse rings and inline notices (`TONE_RING`, `TONE_TILE`, the
ethernet ring ramp, the error notices in the frequency-locking and calculator cards). These were never
chips, so the chip flip deliberately left them alone. They need their own pass, and it should decide
whether a tonal container replaces each wash or whether the wash is the right answer for a large
surface. Note that `bg-muted/50` is overloaded — it is also a plain surface tint on tables, popovers
and toolbars — so that pass cannot be driven by grep alone.

One wash has already been converted, and step 3c records it so the eventual pass does not read the
file as untouched: the apply dialog's deferred-reboot notice moved from `border-info/30 bg-info/10` to
Banner role 05. It was converted because an exact role already existed for it, not because notices are
being migrated generally. Its three siblings in that same dialog (the start-request error, and the
partial and failed summaries) are still washes on purpose — they have no banner role, and inventing
one for a dialog-scoped message would widen the Banner System past what it is for. `TONE_RING`'s
`info` entry likewise stays: it is the live tone for the in-flight hero glyph, not a leftover of the
notice that moved.

Source of the direction: `reimagine/dashboard-design-exploration-directions/` (Claude Design handoff
bundle). "Recommended Hybrid" is the committed dashboard composition; the brand deck carries the
rationale slides.
