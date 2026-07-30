---
name: QManager
description: Modern web GUI for the Quectel RM520N-GL modem. The Operator's Console, in color — running on the modem it manages.
colors:
  # Keys are the names that resolve in app/globals.css, which is NORMATIVE.
  # Where the Material vocabulary and shadcn's collide, the shipped name wins:
  # Carrier Violet is `lte-*` (not `secondary-*`), Uplink Cyan is `uplink-*`
  # (not `tertiary-*`). shadcn's own --secondary is a NEUTRAL in this codebase.
  # --- The mark: the source pair every other hue derives from ---
  mark-ring: "oklch(0.623 0.214 259.815)"
  # --- Primary: the mark's tail. The only hue that acts. ---
  primary-light: "oklch(0.488 0.243 264.376)"
  primary-dark: "oklch(0.79 0.16 262)"
  primary-foreground-light: "oklch(0.99 0.014 264)"
  primary-foreground-dark: "oklch(0.2 0.12 258)"
  primary-container-light: "oklch(0.885 0.1 264)"
  primary-container-dark: "oklch(0.4 0.165 260)"
  on-primary-container-light: "oklch(0.275 0.17 264)"
  on-primary-container-dark: "oklch(0.92 0.09 262)"
  # --- Carrier Violet (`--lte-*`): the 4G LTE identity. Never acts. ---
  lte-light: "oklch(0.495 0.205 296)"
  lte-dark: "oklch(0.8 0.145 296)"
  lte-foreground-light: "oklch(0.99 0.012 296)"
  lte-foreground-dark: "oklch(0.21 0.1 296)"
  lte-container-light: "oklch(0.9 0.085 296)"
  lte-container-dark: "oklch(0.325 0.11 296)"
  on-lte-container-light: "oklch(0.265 0.15 296)"
  on-lte-container-dark: "oklch(0.91 0.075 296)"
  # --- Uplink Cyan (`--uplink-*`): counts, upload direction. Never acts. ---
  uplink-light: "oklch(0.49 0.13 200)"
  uplink-dark: "oklch(0.81 0.11 200)"
  uplink-foreground-light: "oklch(0.99 0.01 200)"
  uplink-foreground-dark: "oklch(0.21 0.06 200)"
  uplink-container-light: "oklch(0.885 0.09 200)"
  uplink-container-dark: "oklch(0.3 0.08 200)"
  on-uplink-container-light: "oklch(0.26 0.09 200)"
  on-uplink-container-dark: "oklch(0.9 0.07 200)"
  # --- The functional four. Five tokens each; see Colors > The functional four. ---
  success-light: "oklch(0.52 0.18 149)"
  success-dark: "oklch(0.82 0.17 149)"
  success-foreground-light: "oklch(0.99 0.02 149)"
  success-foreground-dark: "oklch(0.22 0.075 149)"
  success-on-surface-light: "oklch(0.45 0.155 149)"
  success-on-surface-dark: "oklch(0.84 0.16 149)"
  success-container-light: "oklch(0.89 0.115 149)"
  success-container-dark: "oklch(0.3 0.095 149)"
  on-success-container-light: "oklch(0.26 0.11 149)"
  on-success-container-dark: "oklch(0.91 0.11 149)"
  warning-light: "oklch(0.585 0.16 72)"
  warning-dark: "oklch(0.865 0.155 80)"
  warning-foreground-light: "oklch(0.99 0.02 80)"
  warning-foreground-dark: "oklch(0.24 0.065 70)"
  warning-on-surface-light: "oklch(0.475 0.14 70)"
  warning-on-surface-dark: "oklch(0.88 0.145 80)"
  warning-container-light: "oklch(0.905 0.125 82)"
  warning-container-dark: "oklch(0.32 0.085 70)"
  on-warning-container-light: "oklch(0.31 0.11 70)"
  on-warning-container-dark: "oklch(0.93 0.11 80)"
  destructive-light: "oklch(0.54 0.235 27)"
  destructive-dark: "oklch(0.77 0.175 25)"
  destructive-foreground-light: "oklch(0.99 0.01 27)"
  destructive-foreground-dark: "oklch(0.24 0.07 27)"
  destructive-on-surface-light: "oklch(0.475 0.21 27)"
  destructive-on-surface-dark: "oklch(0.79 0.16 22)"
  destructive-container-light: "oklch(0.905 0.08 25)"
  destructive-container-dark: "oklch(0.325 0.115 25)"
  on-destructive-container-light: "oklch(0.3 0.16 27)"
  on-destructive-container-dark: "oklch(0.91 0.075 22)"
  # `info` is an ALIAS of the brand ramp, not a fifth hue.
  info-light: "oklch(0.488 0.243 264.376)"
  info-dark: "oklch(0.79 0.16 262)"
  # --- Surfaces. Every neutral carries a trace of the mark's hue (258). ---
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
  sidebar-light: "oklch(0.952 0.026 258)"
  sidebar-dark: "oklch(0.215 0.03 258)"
  # --- Concentric tone steps. Explicit tones, never stacked alpha. ---
  tone-success-1-light: "oklch(0.935 0.065 149)"
  tone-success-2-light: "oklch(0.875 0.1 149)"
  tone-success-3-light: "oklch(0.795 0.14 149)"
  tone-success-1-dark: "oklch(0.275 0.075 149)"
  tone-success-2-dark: "oklch(0.375 0.105 149)"
  tone-success-3-dark: "oklch(0.505 0.14 149)"
  tone-warning-1-light: "oklch(0.95 0.055 80)"
  tone-warning-2-light: "oklch(0.905 0.09 78)"
  tone-warning-3-light: "oklch(0.835 0.13 78)"
  tone-warning-1-dark: "oklch(0.275 0.06 70)"
  tone-warning-2-dark: "oklch(0.365 0.09 74)"
  tone-warning-3-dark: "oklch(0.49 0.12 78)"
  tone-destructive-1-light: "oklch(0.945 0.05 25)"
  tone-destructive-2-light: "oklch(0.905 0.08 25)"
  tone-destructive-3-light: "oklch(0.835 0.12 25)"
  tone-destructive-1-dark: "oklch(0.275 0.07 25)"
  tone-destructive-2-dark: "oklch(0.365 0.105 25)"
  tone-destructive-3-dark: "oklch(0.49 0.15 25)"
  # --- Charts: one hue per radio family. Never the numbered --chart-1..6. ---
  chart-nr-light: "oklch(0.488 0.243 264.376)"
  chart-nr-dark: "oklch(0.79 0.16 262)"
  chart-lte-light: "oklch(0.495 0.205 296)"
  chart-lte-dark: "oklch(0.8 0.145 296)"
  chart-threshold-light: "oklch(0.585 0.16 72)"
  chart-threshold-dark: "oklch(0.865 0.155 80)"
typography:
  display:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "1.2"
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.1"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.55"
  body:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.5"
  row:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: "1.25rem"
  label:
    fontFamily: "Euclid Circular B, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1.333"
  numeric:
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace"
    fontWeight: 600
    fontFeature: "'tnum' 1"
  mono:
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 600
    fontFeature: "'tnum' 1"
rounded:
  inline: "0.75rem"
  field: "1.25rem"
  tile: "1.75rem"
  card: "2.25rem"
  hero: "2.5rem"
  pill: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.875rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
  xxl: "1.75rem"
components:
  button-primary:
    backgroundColor: "{colors.primary-light}"
    textColor: "{colors.primary-foreground-light}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
    height: "2.625rem"
    typography: "{typography.body}"
  button-tonal:
    backgroundColor: "{colors.primary-container-light}"
    textColor: "{colors.on-primary-container-light}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
    height: "2.625rem"
  button-destructive:
    backgroundColor: "{colors.destructive-light}"
    textColor: "{colors.destructive-foreground-light}"
    rounded: "{rounded.pill}"
    padding: "0 1.25rem"
    height: "2.625rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface-variant-light}"
    rounded: "{rounded.pill}"
    height: "2.625rem"
  chip-status:
    backgroundColor: "{colors.success-container-light}"
    textColor: "{colors.on-success-container-light}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  chip-identity:
    backgroundColor: "{colors.lte-container-light}"
    textColor: "{colors.on-lte-container-light}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.75rem"
    typography: "{typography.label}"
  card-hero:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.hero}"
    padding: "1.5rem 1.75rem"
  card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.card}"
    padding: "1.5rem"
  tile:
    backgroundColor: "{colors.primary-container-light}"
    textColor: "{colors.on-primary-container-light}"
    rounded: "{rounded.tile}"
    padding: "1rem 1.25rem"
    height: "5.75rem"
  tile-neutral:
    backgroundColor: "{colors.surface-container-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.tile}"
    padding: "1rem 1.25rem"
  metric-row-pill:
    backgroundColor: "{colors.surface-container-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1rem"
    height: "2.5rem"
    typography: "{typography.row}"
  glyph-disc:
    backgroundColor: "{colors.primary-light}"
    textColor: "{colors.primary-foreground-light}"
    rounded: "{rounded.pill}"
    size: "3.25rem"
  nav-item-active:
    backgroundColor: "{colors.primary-container-light}"
    textColor: "{colors.on-primary-container-light}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "2.25rem"
  banner:
    backgroundColor: "{colors.primary-container-light}"
    textColor: "{colors.on-primary-container-light}"
    rounded: "{rounded.field}"
    padding: "0.875rem 1rem"
  input:
    backgroundColor: "{colors.surface-container-light}"
    textColor: "{colors.on-surface-light}"
    rounded: "{rounded.field}"
    padding: "0 0.875rem"
    height: "2.625rem"
---

# Design System: QManager (RM520N-GL)

## Overview

**Creative North Star: "The Operator's Console, in color."**

QManager is the calm, expert console an operator trusts when something matters. Color is not scarce
here, it is **structured**: a Material-3-style tonal palette derived from the QManager mark, where
content sits *inside* filled tonal containers rather than being sprinkled as colored text on white.
Density is the job; color organizes the density instead of decorating it.

The aesthetic is **tonal at rest, expressive in transition, dense in data, honest in state**. A
surface tells you what kind of thing it is by its fill and its radius before you read a word of it.
Nothing shouts, because everything is a container: hierarchy comes from tone, size, and shape rather
than from one loud focal element competing for attention.

It earns its restraint twice. Once as a stylistic principle, and again as a safety principle:
QManager is served by the modem it manages, so the routine 90% should feel effortless and the risky
10% should feel deliberate. A colorful interface is not permission to become a consumer router app.

Dominant references: **Material 3** (Pixel Settings, Google Home) for the shape scale, container
roles, and motion curves; **Apple System Settings** for the uniform page-header-plus-card-grid
structure; **Vercel / Linear** for light-and-dark parity and typographic restraint; **Grafana** for
data-viz density; **UniFi** for inline status density — a density reference only, never a badge or
layout one. Anti-references: raw terminal aesthetics, legacy router admin panels, consumer-router
cartoon oversimplification, the AI/SaaS hero-metric template, and **decorative color** — a hue used
because a surface looked empty.

**Key Characteristics:**

- OKLCH only. `#000` and `#fff` never appear as literals; every neutral is tinted toward hue 258.
- The palette is **derived from the mark**, not chosen alongside it.
- Three identity hues (blue, violet, cyan) plus the functional four. No hue is decorative and
  functional at the same time.
- Euclid Circular B is the interface voice; Geist Mono is the machine voice. There is no third.
- Depth is tonal. Shadows exist, are optional, and are never load-bearing.
- Motion is expressive in duration and curve, capped at 400ms, and never overshoots.
- Light and dark are first-class equals; dark mode is genuinely colored, not desaturated.
- Responsive behavior is driven by **container queries**, not viewport breakpoints.
- No runtime asset fetches. Fonts and the icon font are self-hosted and subset at build time — the
  modem may have no internet.
- **Build on shadcn/ui first**, restyled with these tokens. Build custom only where shadcn has no
  answer.

## Migration Deltas (tracked)

These are the places where correct-per-this-canon and what-a-primitive-currently-defaults-to disagree. **A new component follows the canon and overrides at the call site**; do not "fix" an unconverted surface as a side effect of unrelated work.

| Delta | Reality today | What new work does |
| ----- | ------------- | ------------------ |
| **Shape lives at the call site, not in the primitives** | `Card` defaults to `rounded-xl` + `border` + `shadow-sm`; `Button` to `rounded-md` + `h-9`; `Input` to `rounded-md` + transparent fill | Pass the role radius explicitly: cards ship `rounded-card`/`rounded-hero border-0`, actions ship a pill (`h-[2.625rem] rounded-pill px-5`, see `radio/page-header.tsx`'s `PILL_ACTION`) |
| **Legacy radius chain is still live** | ~349 `rounded-{sm,md,lg,xl,full}` call sites resolve off `--radius: 0.65rem` | Use `rounded-inline/field/tile/card/hero/pill`. Never retarget the legacy chain globally |
| **Icon-Boundary is partially applied** | Material Symbols owns the sidebar, `/dashboard`, `/` and `/login/`, and the **entire `/cellular/` family** (index + all 17 sub-routes, 53 files). Still lucide: `/local-network/`, `/monitoring/`, `/system-settings/`, `/about-device`, `/support`, onboarding | A lucide glyph on an unconverted route is **correct code**, and a route-agnostic primitive (page-level `Banner`, apply-progress dialog) stays lucide even inside a Material route. Convert a whole route or none of it. See `docs/reference/icon-system.md` |
| **Opacity washes are unmigrated** | `bg-{role}/5`, `/10`, `/15` on icon discs, tiles, pulse rings, inline notices | Not chips — do not flip them as part of chip work. New concentric/stacked shapes use the explicit `--tone-{role}-{1,2,3}` steps |
| **Status-first column is unbuilt** | No live-service page (Watchdog, Alerts, Discord) implements the read-only-status-hero → settings → activity-log order | It is a product intent in `PRODUCT.md`, not a `DESIGN.md` rule. Move toward it on new live-service pages; don't retrofit |

## Colors

**Governing rule: the mark sets the hue, containers carry the content, functional colors report
state.** `app/globals.css` is the normative source; the frontmatter above mirrors it.

### Primary

- **Signal Blue** — the brand, the only hue that *acts*, and the identity of the 5G NR leg. It is
  the mark's 45-degree tail used literally. Owns primary buttons, the focus ring, the active nav
  container, NR chart series and carrier tiles, and every "in progress" surface.
- **Signal Blue Container** — the tonal block carrying primary-flavored content: tonal buttons, the
  active nav pill, informational banners, the bandwidth tile, in-progress rows.

### Secondary

- **Carrier Violet** (`--lte-*`) — the 4G LTE identity, and nothing else. LTE chart series, LTE
  carrier tiles and aggregation segments, the LTE signal card's identity chip, the Active MIMO tile.
  Hue 296 because the mark forces blue to mean "QManager and its primary radio", so the second radio
  family cannot also be a blue; violet is the nearest hue that stays unmistakably separate while
  sharing the cool temperature.

### Tertiary

- **Uplink Cyan** (`--uplink-*`) — counts, upload direction, minor accents. Deliberately low-chroma
  so it reads as a supporting mark, not a third brand. Owns the carrier-count tile and the upload leg
  of any paired readout. Hue 200 is the nearest value clearing 40 degrees from every functional hue
  and from both other identity hues.

### Neutral

Surfaces step tonally, and a card lifts by sitting one step above its parent in **both** themes.

- **Canvas** — the page background.
- **Surface** — cards, dialogs, popovers.
- **Surface Container** — inner tiles, metric row pills, input fills, ghost-button hover, the sidebar
  rail. In light this *recesses* below the canvas; in dark it *lifts* above it.
- **Surface Container High** — muted chips, deliberately-off states, glyph discs on neutral tiles.
- **On Surface** — primary text. **On Surface Variant** — descriptions, labels, eyebrows, row keys,
  inactive nav.
- **Outline** — input strokes and table rules only. Never a card border.

### The functional four (contract)

| Role | Meaning | Icon |
|------|---------|------|
| **success** | Healthy: connected, service active, save succeeded, profile applied | `CheckCircle2Icon` / `check_circle` |
| **warning** | Degraded: weak signal, searching, limited service, partial success, no SIM | `TriangleAlertIcon` / `warning` |
| **info** | In progress: applying, downloading, rebooting. Reports, never alarms | `ClockIcon`, `DownloadIcon`, spinner |
| **destructive** | Failed or irreversible: disconnected, apply failed, no service, reboot dialogs | `XCircleIcon` / `AlertCircleIcon` |

Each functional role ships **five** tokens, and picking the wrong one is the most common contrast
failure in this system:

| Token | Use |
|-------|-----|
| `--{role}` | The strong fill. Glyph discs, state dots, chart thresholds, meter fills |
| `--{role}-foreground` | The **only** ink allowed on that fill |
| `--{role}-on-surface` | Tinted *text on a plain card*, where no container is used |
| `--{role}-container` | The tonal block. Status chips, banners, state screens, emphasized rows |
| `--on-{role}-container` | The **only** ink allowed on that container |

### Signal quality ramp

Thresholds live in `getSignalQuality()` (`types/modem-status.ts`) and are used identically on the
dashboard, antenna statistics, and the alignment meter.

| Quality | Token | RSRP (dBm) | RSRQ (dB) | SINR (dB) |
|---------|-------|------------|-----------|-----------|
| Excellent | `success` | >= -80 | >= -5 | >= 20 |
| Good | `primary` | >= -100 | >= -10 | >= 13 |
| Fair | `warning` | >= -110 | >= -15 | >= 0 |
| Poor | `destructive` | < -110 | < -15 | < 0 |

### Data visualization

One hue per radio family: **NR** uses `--chart-nr`, **LTE** uses `--chart-lte`, so a color learned on
one card holds on the next. Area fills are a gradient of the series color (0.32 alpha falling to 0),
monotone curves, horizontal gridlines only. Threshold guides use `--chart-threshold`, dashed, at low
opacity. Any added series stays separable under deuteranopia and protanopia simulation before merge.

**Never use the numbered `--chart-1..6`.** They are shadcn-starter inheritance with two disqualifying
properties: their values are byte-identical in the light and dark blocks, so a chart built on them
does not theme at all, and `--chart-1..5` sit in one hue family (blues 250-265), so LTE and NR would
be separated by lightness alone — the first distinction to collapse under sun or a color-vision
deficiency.

### Named Rules

**The Source-Color Rule.** Every new color derives from the mark's hue family or from an existing
identity or functional role. Nobody picks a hue by eye and adds it to `globals.css`.

**The Container-Pair Rule.** A fill takes its own `-foreground`; a container takes its own `on-` ink.
Never cross them. Crossing a fill with a container's ink is the single most common way to fail
contrast here, and it is often invisible in light mode while breaking dark.

**The Paired-Theme Rule.** A role's fill and its ink move **together** across themes. Dark-mode fills
are light (L 0.77-0.87), so their inks flip dark (L 0.22-0.24). Raising a dark fill without flipping
its ink is what kept destructive measuring 2.42:1 through three migration steps. An alpha on a fill
(`bg-destructive/60`) is a request to the canvas, not to the token, so the same control renders a
different color in a card, a dialog, and a popover — never compensate with one.

**The 40-Degree Rule.** No decorative hue sits within 40 degrees of a functional one. Identity hues
occupy 264 / 296 / 200; functional hues occupy 149 / 72 / 27 plus the brand ramp.

**The Info-Is-Brand Rule.** There is no separate info hue. "In progress" renders as the brand's own
tonal container, so an informational chip and a primary button differ by **shape and glyph** (pill
plus clock vs. filled button plus label), never by owning two different blues.

**The Identity-Never-Acts Rule.** Carrier Violet and Uplink Cyan carry identity, never affordance. A
violet surface is never clickable *because* it is violet, and no control is ever tinted by them. The
corollary: `nr` and `lte` never mean "healthy".

**The Explicit-Tone Rule.** Layered translucency is banned for stacked shapes. Concentric rings, halo
discs, and nested tonal surfaces use the explicit `--tone-{role}-{1,2,3}` steps, because stacked alpha
compounds differently over each surface and yields a different color in a card than in a dialog.

**The Functional-Color Promise.** A user who learns green means healthy on the dashboard finds the
same green meaning the same thing in Watchdog, in Profile Apply, and in the alert logs. Hues get
retuned; meanings never move.

## Typography

**Interface font:** Euclid Circular B (`--font-sans`, WOFF2 via `next/font/local`), with
`system-ui, sans-serif` fallback.
**Machine font:** Geist Mono (`--font-geist-mono` → `font-mono`), self-hosted at build time.
**Icon typefaces:** Material Symbols Rounded on the shell and converted routes; lucide elsewhere. An
icon font is not a voice and does not count against the Two-Voice Rule.

**Character:** Euclid's geometric humanist forms read as engineered rather than corporate — circular
bowls and a low-contrast stroke keep dense label stacks legible at 12px. Geist Mono is the machine's
voice: every measurement, identifier, and raw device string. The pairing is the product's thesis in
two fonts — a human interface reporting machine truth, with the boundary visible.

**Loaded weights:** 300 oversized numerals only · 400 body, inputs, descriptions · 500 labels, chips,
buttons, table headers · 600 card titles, section headings, numeric readouts · 700 page titles only.

### Hierarchy

- **Display** (700, 1.875rem / 30px, -0.02em): the `h1` at the top of every feature page, followed by
  an `on-surface-variant` description. One per route.
- **Headline** (600, 1.25rem / 20px, -0.01em): large tile values, state-screen labels, section
  headings inside a hero card.
- **Title** (600, 1.125rem / 18px): the card title on converted surfaces. `CardTitle` itself ships
  only `leading-none font-semibold` and takes its size from the call site.
- **Body** (400, 0.875rem / 14px): descriptions, prose, card copy, table cells. `leading-relaxed` and
  `text-pretty` on any paragraph over one line.
- **Row** (600, 0.8125rem / 13px on a **20px** line box): metric-row keys and values on a glance card.
  **The explicit leading is not optional** — 13px is an arbitrary Tailwind size, so it would otherwise
  inherit whatever leading the card sits in; pinning the line box is what holds the row at exactly
  40px and keeps its skeleton's `h-10` mirroring it. Do not reach for 13px outside a dense metric row.
- **Label** (500, 0.75rem / 12px): chips, table headers, button text, form labels, tile eyebrows
  (600 where the eyebrow sits on a colored tile). Tiny uppercase section labels run 11px with
  `tracking-wider` in the sidebar.
- **Numeric** (600, `tabular-nums`, mono): any figure that changes. **This is the one step that is
  deliberately not a fixed ramp** — a numeral is read at the distance its container implies, so its
  size derives from the slot holding it, and a literal `text-[Npx]` on a `tabular-nums` numeral is
  correct by construction. Shipped: 52px live throughput and 44px live latency in the Speed Test
  dialog's running phase, 26px in its three result tiles, 17px with an 11px unit suffix in the
  dashboard Speed Test tile (load-bearing — the tile height is mirrored into its own skeleton).
  A numeral *not* sized to a slot still takes the ramp, and prose never qualifies.

### The banner-scoped step

A page-level `Banner` title is **15px / 600** with `tracking-[-0.005em]`; its description is 13px.
15px is not on the ramp above, and it is deliberately **the only sanctioned literal outside the
pre-auth scale**: a banner title has to out-weigh the copy beneath it without competing with the card
heading above it, on a surface that mounts at any width on any route, and both 14px and 18px fail one
of those two jobs. Do not reach for 15px anywhere else.

### The pre-auth card exception (`/` and `/login/`)

The two pre-auth surfaces run a **denser five-step scale of their own**. It applies only to the
Overview splash and the login page; nothing else may reach for these steps.

| Step | Size | Role |
|------|------|------|
| Card title | 600, 19px, -0.01em | the card's own `h1` |
| Section title | 600, 17px | the empty-state headline |
| Emphasis | 600, 15px | the 48px pill CTA label, status-tile values |
| Body | 400/500/600, 13px | subcopy, field labels, inline errors, banner body |
| Eyebrow | 600, 11px, `tracking-[0.11em] uppercase` | the label above every tile and section |

**Why.** Every other screen sits inside the app shell, where the sidebar, page title, and card grid
establish scale before a card says anything. These two are the only screens that are a single card on
an empty canvas, so the card must build five levels of hierarchy from nothing inside roughly 400px.
The 14px/12px default flattens to two levels at that width. 11px is the floor — going below it would
make uppercase text at 0.11em tracking the least legible thing in the product. **Both surfaces must
agree:** when one of these steps changes, it changes on both in the same commit.

### Named Rules

**The Two-Voice Rule.** Euclid is the interface, Geist Mono is the machine. There is no third
typeface. Pairing Euclid with another UI sans (Inter, Geist Sans, IBM Plex, Roboto) is forbidden.

**The Machine-Voice Rule.** `font-mono` is scoped to machine truth: measurements with units (RSRP,
bandwidth, latency, dBm), identifiers (band, EARFCN, PCI, ICCID, IMEI), raw AT responses, log lines,
and copyable commands. A human-authored label never wears it. A count is a measurement; a nav item is
not.

**The Weight-Discipline Rule.** 400 body, 500 labels and medium emphasis, 600 headings and numerics,
700 page titles only.

**The Tabular-Number Rule.** Any figure that can change while on screen is `tabular-nums`. A latency
readout whose digits shift width reads as the layout twitching, not as the value moving — and a tonal
pill makes that jitter more visible, not less.

**The Truncation-Pair Rule.** Where two cards sit side by side as a pair, every text node in their
headers carries `min-w-0` and `truncate`. One card wrapping to two lines while its sibling stays at
one breaks the paired baseline, and the pair stops reading as a pair. Italian is the locale that
trips it.

## Layout

**Every feature page is the same shape:** a page header (display title plus a muted one-line
description, with optional pill actions right-aligned) followed by a uniform grid of self-contained
cards. There is no bespoke per-screen composition. A user who learns one page has learned them all.

**Responsive behavior is container-driven.** The content column declares `@container/main` and cards
respond with `@3xl/main:`, `@4xl/main:`, `@5xl/main:`. A card that declares its own `@container/card`
uses `@sm/card:` and `@md/card:` inside itself. Mixing viewport `sm:` with container `@sm/card:` in
one card breaks on tablets and expanded sidebars. Viewport breakpoints stay for page-level concerns
only: the gutter (`px-4 lg:px-6`) and the sidebar's own collapse.

**The grids that ship.** The dashboard is a 5-column container grid (`@4xl/main:grid-cols-5`) with a
3-column left stack and a 2-column right rail, then full-width rows beneath. Radio Information is a
symmetric 2-up (`@3xl/main:grid-cols-2`) under a 4-up tile strip
(`@xl/main:grid-cols-2 @5xl/main:grid-cols-4`). Both collapse to a single column with no
special-casing.

**Spacing rhythm.** Page gutter 16px rising to 24px. Card grid gap 16-24px; tile grid gap 14px;
in-card row gap 6px; inline element gap 8-10px. Card padding is 24px (`px-6`) standard and 28px
(`px-7`) on hero cards, with 24-26px vertical.

**Equal heights are explicit.** A grid row of cards uses `h-full *:data-[slot=card]:h-full` on each
cell so cards match rather than each sizing to its own content. Without it, a card whose data hasn't
landed is visibly shorter than its neighbor.

**Field ergonomics.** Touch targets are a minimum 44px on coarse pointers; icon-only tab lists bump
`TabsList` height rather than shrinking triggers. Toolbars `flex-wrap` so action clusters fall to a
second row instead of overflowing. Tables wrap prose columns (`whitespace-normal break-words` with a
container-stepped `max-w`) and treat horizontal scroll as a fallback.

### Named Rules

**The Consistent-Layout Rule.** Page header plus a uniform card grid, on every feature page. A
bespoke hero-driven layout invented for a single screen is a consistency failure even when it looks
good in isolation. A genuine glance surface may earn a hero card; it is a rare exception, never the
default.

**The Card-Wrapped Surface Rule.** The unit of composition is the **card that wraps a settings
group**, not the page. The card owns its whole content (`CardHeader` plus `CardContent` with every
control); the page only arranges cards. A feature that scatters loose fragments across the viewport
has skipped the card.

**The Container-Query Rule.** New responsive behavior is a container query against `@container/main`
or a card-local `@container/card`. Reach for a viewport breakpoint only for the page gutter or the
shell itself.

## Elevation & Depth

**Depth is tonal, not cast.** A surface separates from its parent by sitting one step up the neutral
ramp — canvas, then surface, then surface-container, then surface-container-high. This is what makes a
card readable in direct sun, where a shadow is the first thing to disappear.

### Shadow Vocabulary

- **Whisper** (`0 1px 2px oklch(0.19 0.032 258 / 6%)` in light, resolving to `0 0 #0000` in dark, where
  the tonal step already does the work): an optional card lift. Never load-bearing.
- **Popover Float** (`shadow-lg` and up, via shadcn defaults): dialogs, dropdowns, popovers, the
  skip-to-content pill. This is the "not part of the page flow" signal, and it is the one place a
  shadow carries real meaning.

### Named Rules

**The Tonal-Elevation Rule.** Two surfaces at different conceptual elevations differ by at least one
container step. If two surfaces are only distinguishable by their shadow, one of them is on the wrong
step of the ramp.

**The No-Hairline-On-Fill Rule.** A tonal container never also carries a border. Cards on converted
surfaces ship `border-0` explicitly, because a hairline over a fill reads as chrome around the color
rather than as the edge of a block. `--outline` is for input strokes and genuine table rules only.

**The Highlight-by-Container Rule.** Emphasis promotes a surface one container step and changes its
ink, rather than adding a translucent wash over a neutral card. A recommended alignment slot becomes a
`primary-container` block; a running pipeline step becomes a `primary-container` row.

## Shapes

Radius carries size hierarchy: the bigger and more important the surface, the softer its corners.

| Step | Value | Owns |
|------|-------|------|
| `rounded-inline` | 0.75rem (12px) | Small inline affordances, code blocks, skeleton slivers |
| `rounded-field` | 1.25rem (20px) | Inputs, selects, small popovers, banners |
| `rounded-tile` | 1.75rem (28px) | Inner tiles, carrier tiles, alignment slots |
| `rounded-card` | 2.25rem (36px) | Standard cards in a grid, dialogs |
| `rounded-hero` | 2.5rem (40px) | The anchor card on a surface, the aggregation strip, state screens |
| `rounded-pill` | 9999px | Chips, buttons, nav items, metric rows, meters, glyph discs, state dots |

The distinction between `card` and `hero` is real and used: a grid of peer cards takes `card`; the one
card that anchors a surface — Network Status on the dashboard, the two cards on Radio Information, a
state screen replacing a body — takes `hero`.

The silhouette this produces is deliberate: **soft, generously-rounded rectangles containing
full-round elements**. Fills over strokes, round caps on every meter and progress track, no
side-stripe accent borders. Nothing has a square corner except a table rule and a chart gridline. The
mark follows the same construction — two shapes, two tones, one hue, no gradient, no shadow — and UI
shapes should read as members of that family.

### Named Rules

**The Radius-Follows-Size Rule.** A surface's radius is a function of its size and role, not of taste.
A 28px tile never sits inside a 20px field, and a banner never out-rounds the card it sits on.

**The Fill-Over-Stroke Rule.** When a shape needs to be distinguished from its neighbor, change its
fill, not its border. This system has one stroke color and it is for inputs and table rules.

**The Role-Radius Rule.** New work uses the role scale above. The legacy `rounded-{sm,md,lg,xl}` chain
off `--radius: 0.65rem` still resolves for ~349 unconverted call sites and keeps its old values, but it
is never the correct choice in a new component.

## Motion

**Character: expressive in duration and curve, and still settled.** The expressiveness is in the
easing, never in overshoot — which is what keeps it compatible with a tool whose job is holding a
connection alive. `lib/motion.ts` is the JS source of truth and mirrors the CSS custom properties in
`globals.css`; retune one layer and you retune the other in the same change.

**Durations.** `quick` 180ms (label swaps, value ticks, hover tints, focus rings) · `standard` 300ms
(the default for a state change — card entrance, nav indicator, chip morph, meter retarget) ·
`emphasized` 400ms (container size and shape, aggregation re-proportioning, banner arrival, meter
first-fill) · `ambient` 2s (the two sanctioned loops only).

**Curves.** `emphasized` `cubic-bezier(0.05, 0.7, 0.1, 1)` — a deliberate departure and a long settle.
`standard` `cubic-bezier(0.2, 0, 0, 1)` — the everyday state change. `quick` is a plain `ease-out`,
deliberately: below ~180ms a bespoke cubic is indistinguishable from the built-in.

**Entrances.** Two stagger steps, and only two. Cards cascade at **60ms** with a 10px rise
(`staggerContainer` / `staggerItem`); rows inside one card cascade at **40ms** with a 5px rise
(`staggerRows` / `staggerRowItem`). Rows sit ~6px apart, so a 10px lift would move each row past its
neighbor's resting position and read as the card reflowing rather than as content arriving. Nested
containers inherit `visible` from their parent and must **not** declare their own `initial`/`animate`,
or they detach from the parent's clock. Cascade children must be block boxes — a bare `span` silently
drops the rise.

**The live value tick.** A poll-driven figure dips to 0.35 opacity and returns, asymmetrically —
300ms down, 400ms up — so the dip is the event and the return is the settle. Figures within one
`TickGroup` stagger 100ms apart by live DOM position, not by map index. Only *measurements* tick;
identifiers (band, PCI, EARFCN) take the container morph instead, because dipping a value that holds
steady for minutes invents an event. A value that moves again mid-dip retargets rather than queueing.

**Reduced motion** is handled by one global switch — `<MotionConfig reducedMotion="user">` in
`components/motion-provider.tsx` — which is why every shared variant is pure transform and opacity.
Raw CSS keyframes carry their own `@media (prefers-reduced-motion: reduce)` block beside them.
Movement goes, opacity stays: a crossfade is still legible information where a slide is not.

### Named Rules

**The Motion-Ceiling Rule.** Nothing exceeds 400ms. `emphasized` is the ceiling, not a starting point.

**The Non-Load-Bearing Rule.** If a transition never runs — reduced motion, a backgrounded tab, a
paint that beat the animation — the UI must already be correct. Every entrance keyframe in
`globals.css` is written open-ended (`from` with no `to`) for exactly this reason: the resting value is
the truth and the keyframe only describes the journey. A `requestAnimationFrame`-armed state flip
breaks this rule, because rAF does not fire in a background tab.

**The Transform-Only Rule.** Animate `transform` and `opacity`. The single sanctioned `width`
animation in the product is the carrier-aggregation segment, where the width *is* the data and a
`scaleX` would distort the band labels riding inside it. Meters animate `scaleX`, never `width` — on a
CPU also carrying the user's traffic, a per-poll layout pass per meter is not free.

**The One-Loop Rule.** At most one ambient loop per surface, and only where something is genuinely
live. Two exist product-wide: the service-ring pulse and the live-ping dot.

**The No-Overshoot Rule.** Never springy, never elastic, never rubber-banding. The one sanctioned
overshoot in the entire product is the save-confirmation check at 1.03 scale.

**The Enter-Only Rule.** Conditions and navigation have no exit animation. A banner leaving means the
condition cleared and that should feel immediate; an outgoing route is already gone, and animating it
out only delays the incoming one.

## Components

### Buttons

- **Shape:** full-round pill, 42px tall (`h-[2.625rem]`), 20px horizontal padding, 600 weight.
- **Primary:** brand fill with its own `-foreground` ink. The default for main actions — Record, Save,
  Apply — never `outline`.
- **Tonal:** `primary-container` with `on-primary-container`. Secondary actions of equal standing.
- **Destructive:** destructive fill with `destructive-foreground`. Never `text-white` hardcoded —
  dark-mode destructive is a *light* fill and white ink on it measures 2.4:1.
- **Ghost / outline:** transparent or hairline, `on-surface-variant` ink, `surface-container` hover.
- **Focus:** a 3px `--ring` ring at 50% on the `quick` clock.
- Use `SaveButton` for save actions; it owns the loading animation and the 1.03 check.

### Chips

Two families, and confusing them is the standard failure.

**Status chips** are the five roles in `components/ui/badge.tsx` — `success`, `warning`,
`destructive`, `info`, `muted`. A role container fill, that container's `on-` ink, no visible border,
pill radius, and a **mandatory** 12px icon. The variant is the whole API: never hand-write the
classes. Fill and ink transition on `standard`, the focus ring on `quick`. Hover is `[a&]:`-scoped, so
a static status chip never responds to the cursor and advertises a click target that does not exist.

```tsx
<Badge variant="success">
  <CheckCircle2Icon className="size-3" />
  Active
</Badge>
```

`muted` is for deliberately-inactive states (Stopped, Disabled, Offline peer). Failure is
`destructive`.

**Identity chips** are `nr` and `lte`. They say which *radio* a chip belongs to and never vary with
health. They are not interchangeable with the five status roles.

`default` / `secondary` / `outline` remain for non-status labels: network type, category tags, counts.

Tone maps key onto the exported `BadgeVariant` type, never onto a class string, so a new tone without a
matching role fails the build.

### Cards / Containers

- **Corner:** 36px in a grid of peers, 40px for the anchor card on a surface.
- **Background:** `surface`, with `border-0` explicit and `--shadow-whisper` optional in light.
- **Padding:** 24px standard, 28px on hero cards.
- **Header:** plain `CardTitle` plus `CardDescription`. **Never an icon in the card header** — icons
  belong in badges, glyph discs, or a separate action area.

### Tiles

The inner unit of a glance surface: a 28px-radius block, 92px minimum height, holding a 52px
full-round glyph disc beside a text column of eyebrow → value → caption.

A tile is either a **fill** pair or a **container** pair, never crossed — and **the glyph disc always
inverts its tile's pairing**. A fill tile gets a container disc; a container tile gets a fill disc, so
the icon pops instead of dissolving into a same-tone circle, and it survives grayscale either way.

### Metric rows

Two answers, and this is the one place the system deliberately has two.

- **Glance surfaces** use full-round pills on `surface-container`: 40px tall, 16px horizontal padding,
  a 13px/600 `on-surface-variant` key against a 13px mono value. No dividers.
- **Genuine data tables** (cell scanner results, SMS inbox, log views) keep hairline rows on
  `--outline`, because density survives there where pills would not.

### Inputs / Fields

- **Shape:** 20px radius, 42px tall, `surface-container` fill, no visible border at rest.
- **Focus:** a 3px `--ring` ring at 50%; the fill does not change.
- **Invalid:** destructive ring plus destructive border, driven by `aria-invalid`.

### Navigation

The sidebar rail sits one step off the canvas so it reads as chrome, not content — recessed in light,
lifted in dark. Nav rows are full-round, 16px horizontal padding, `text-sm`.

The active row is the system's signature motion: **one** `primary-container` pill per group,
absolutely positioned, whose transform is driven from React so it *slides* between rows rather than
appearing. The row itself goes transparent and takes `on-primary-container` ink at 600 weight, and its
Material glyph animates its `FILL` axis from 0 to 1. That FILL change is an accessibility affordance,
not polish: it is what makes the active state survive grayscale. The pill's first paint is
non-animated (`data-settling`), so it starts under the active row rather than sliding up from zero.

### Banners

Two primitives, split by where they mount. **`Banner`** is page-level: eight named system roles, a CTA
slot, a dismiss slot, a 36px disc, lucide glyphs (it mounts on every route, so the Icon-Boundary Rule
pins it to lucide). **`TonalBanner`** is card-scoped: three tones, no CTA, no dismiss, a 32px disc,
Material glyphs.

Both share the rules. A banner is `bg-{role}-container` with `text-on-{role}-container` — never a
wash, because a 10% alpha over a tinted surface collapses in dark mode and washes out first in
sunlight. Its icon always sits in a filled disc on the role's **strong** fill. Radius is 20px, so it
never out-rounds its host. Informational banners use `primary-container`. Any figure that ticks inside
banner copy is `font-mono tabular-nums`. Entrance is `.animate-banner-in` (400ms emphasized, 6px rise
plus fade); there is no exit.

### Signature surfaces

- **Carrier Aggregation strip** — a full-width 40px-radius hero whose segments are proportional to
  each carrier's bandwidth. Segment width animates on `emphasized`; a newly-added carrier grows from
  zero so the chain reads as "something arrived" rather than "everything shuffled". A released carrier
  stays visible and greyed rather than silently disappearing, and the list **freezes** while data is
  stale rather than announcing releases that never happened.
- **Signal status cards** — the paired NR / LTE cards. An identity-toned quality chip whose **glyph bar
  count** carries quality (five wedge glyphs, monotonically decreasing — the `signal_cellular_{1..4}_bar`
  family, never the `alt` family, whose 1-bar mark is a 2×4px speck and which has no 0-bar at all),
  a state dot, then a stack of metric row pills with quality-tinted mono values. Every tinted value
  carries an `sr-only` quality word, because `success-on-surface` and `warning-on-surface` measure
  ~1.01:1 apart — same luminance, hue only.
- **Summary tiles** — the four-tile strip above Radio Information's two cards. All four carry color:
  the network-type tile is the identity *fill* of whichever radio is actually registered; the other
  three are `primary-container`, `uplink-container`, and `lte-container`.
- **Condition state screens** — non-registered modes *replace* the body rather than render it empty. A
  40px-radius container in the condition's tone, a 56px filled disc, a headline, a description, and an
  optional retry pill drawn from the container's **own** ink at 10-15% — never a white wash, which is
  invisible on a light container. Tone is chosen per condition, not per aesthetics: no-SIM is
  `warning` (a real fault the user can fix in situ), no-service is `destructive` (the link is down),
  searching is `primary` (transient and hopeful), unknown is neutral. Only `searching` spins — a
  spinner on a standing condition advertises work that is not happening. The shell and the tone→class
  mapping live in `components/cellular/condition-screen.tsx`; callers pass a tone, a glyph and their own
  copy. No two states in one slot may share a glyph.

### Icons

Two libraries, and the boundary is **per route**, never per directory.

| Library | Owns |
|---------|------|
| **Material Symbols Rounded** | The sidebar, `/dashboard`, the two pre-auth routes (`/` and `/login/`), and the **entire `/cellular/` family** — index plus all 17 sub-routes |
| **lucide-react** | Every other route: `/local-network/`, `/monitoring/`, `/system-settings/`, `/about-device`, `/support`, onboarding — plus every route-agnostic primitive (the page-level `Banner`, the apply-progress dialog) wherever it mounts |

Mixing two icon sets inside one screen is precisely what the rule prevents, so a lucide glyph on an
unconverted route is *correct code*, not a defect — and a route-agnostic component stays on lucide
even when it mounts inside a Material route, because it cannot know where it will appear. Convert a
whole route or none of it.

`MaterialSymbol` sets `fontSize` as an inline style, which outranks any utility — so a parent's
auto-sizing rule for lucide children (`[&>svg]:size-3`) cannot reach it. **Pass `size` explicitly at
every Material call site.** The typeface is ligature-driven (the literal text `cell_tower` becomes one
glyph), which is why these spans are always `aria-hidden` beside a real text label, and why the glyph
list is a single source of truth shared with the font-subsetting script.

Three deliberate exceptions survive on the dashboard's Network Status card, a recognized landmark
where re-glyphing buys nothing: the SIM orb keeps lucide `CardSimIcon`/`Plane`, and the RAT marks keep
`react-icons/md`, because "5G", "4G+" and "3G" are typographic marks Material Symbols has no
equivalent for.

### The three-state pattern

Every data surface ships **loading**, **empty**, and **error** — never a blank panel.

Skeletons mirror the loaded geometry *exactly*, and by shared constant rather than by estimate:
`summary-tiles.tsx` exports `TILE_SHAPE` and `states.tsx` imports it, so the two cannot drift. Sizes
are the loaded element's **line box**, not its font size — a skeleton sized to the glyph reflows the
moment real text lands. The handoff is a pure crossfade on `quick` with the outgoing skeleton overlaid
*on top of* real content, so the card is sized by its content from the first frame and the crossfade
contributes zero layout shift.

### Named Rules

**The Filled-Chip Rule.** Status chips are a role container plus that container's ink, no border, pill
radius, always an icon. `variant="outline"` is never a status indicator.

**The Every-Chip-Has-A-Glyph Rule.** `success-container` and `warning-container` measure **1.03:1**
apart — the same surface to the eye, and identical under deuteranopia. The glyph is the only thing
separating healthy from degraded. Two states in the same slot must never share a glyph either.

**The Identity-Chip Rule.** Where a chip's fill carries identity, the quality it *also* reports must be
encoded non-chromatically. On the signal cards that channel is the Material glyph's bar count.

**The Glyph-Disc Rule.** A state icon sits in a filled circle on the role's strong fill. The disc is
what survives when the container fill washes out in sunlight; a bare glyph on the container does not.

**The Skeleton-Mirror Rule.** A skeleton mirrors the loaded geometry by importing the same shape
constant, never by restating numbers.

**The Loader-and-Dots Rule.** Step or sample progress is a `Loader2Icon` spinner plus dot indicators.
Fill and progress bars are reserved for data visualization — signal strength, quality meters,
bandwidth share.

**The Age-Gated Tone Rule.** On a surface listing *history*, two independent axes decide how a row is
drawn. **Tone** is what kind of thing happened; it is a fact about the event, never expires, and is
carried by a filled icon disc in the solid role color for as long as the row exists. **Weight** is how
much the row still deserves attention, and it does expire: a row keeps its tonal container while it is
fresh (one hour) **or** unresolved, then settles onto `surface-container` with its disc at full
strength. The disc never consults the age gate — an hour-old recovery sits on a plain surface with its
green check still green, and a still-standing outage never greys out merely because time passed. Note
that `severity: "info"` here means *routine*, not *good*.

**The Dismiss-Only-Notices Rule.** A banner gets an X only when it is a *notification*. A standing
condition has no dismiss, because dismissing it would hide a fact that is still true.

**The State-Honesty Rule.** A status surface reports what is actually running — saved settings, live
service state — never the half-edited form. A control that cannot currently work explains why instead
of sitting there dead. A test only runs against saved config. An ambient animation only loops where
something is genuinely live.

## Do's and Don'ts

### Do:

- **Do** pick a **pair** — a fill with its own `-foreground`, or a container with its own `on-` ink.
- **Do** give every status chip an icon, and give two states in the same slot two different icons.
- **Do** use `--chart-nr` and `--chart-lte` for series color; one hue per radio family.
- **Do** reach for the role radii (`rounded-tile` / `card` / `hero` / `pill`) in new work.
- **Do** ship `border-0` on a card and let the tone step carry the separation.
- **Do** write responsive behavior as a container query against `@container/main`.
- **Do** wrap a settings group in a card and let the page arrange cards.
- **Do** put `min-w-0 truncate` on every text node in a paired card's header.
- **Do** mark every changing figure `font-mono tabular-nums`.
- **Do** mirror a skeleton's geometry from the same exported shape constant the loaded view uses.
- **Do** build the loading, empty, and error state in the same change as the loaded one.
- **Do** pass `size` explicitly at every `MaterialSymbol` call site.
- **Do** keep interactive targets at 44px on coarse pointers, and let toolbars wrap.
- **Do** make a status surface report *saved* state, and make an incapable control explain itself.
- **Do** defer anything that reboots the modem behind a dialog plus a persistent banner.
- **Do** key every new user-visible string across all five locales; `bun run i18n:check` gates it.

### Don't:

- **Don't** put ink from one role on another role's surface, or a container's ink on a fill.
- **Don't** hardcode `text-white` on a destructive fill — in dark mode that fill is *light*.
- **Don't** compensate for a mismatched pair with an alpha (`bg-destructive/60`); fix the pair.
- **Don't** use `variant="outline"` as a status indicator.
- **Don't** use `nr` or `lte` to mean "healthy", or tint a control with an identity hue.
- **Don't** use the numbered `--chart-1..6`; they do not theme.
- **Don't** stack alpha to build concentric shapes — use the explicit `--tone-{role}-{1,2,3}` steps.
- **Don't** put a border on a tonal container, or use `--outline` as a card edge.
- **Don't** animate `width` (the aggregation segment is the sole exception) or exceed 400ms.
- **Don't** add a third stagger step, a fifth duration, or a spring.
- **Don't** add an exit animation to a banner or a route transition.
- **Don't** loop an animation where nothing is genuinely live.
- **Don't** put an icon in a `CardHeader`.
- **Don't** invent a bespoke hero-driven layout for one screen.
- **Don't** mix Material Symbols and lucide inside a single route.
- **Don't** introduce a third typeface, or set a human-authored label in mono.
- **Don't** reach for 13px outside a dense metric row, or for the pre-auth scale outside `/` and
  `/login/`.
- **Don't** add a hue because a surface looked empty.
