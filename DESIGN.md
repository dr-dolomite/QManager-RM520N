---
name: QManager
description: Modern web GUI for managing the Quectel RM520N-GL modem. The Operator's Console, running on the modem it manages.
colors:
  signal-indigo: "oklch(0.488 0.243 264.376)"
  sidebar-indigo-light: "oklch(0.546 0.245 262.881)"
  sidebar-indigo-dark: "oklch(0.623 0.214 259.815)"
  secondary-light: "oklch(0.967 0.001 286.375)"
  secondary-dark: "oklch(0.274 0.006 286.033)"
  uplink-green: "oklch(0.59 0.18 149)"
  uplink-green-dark: "oklch(0.65 0.17 149)"
  caution-amber: "oklch(0.75 0.18 75)"
  caution-amber-dark: "oklch(0.80 0.16 75)"
  telemetry-blue: "oklch(0.62 0.19 255)"
  telemetry-blue-dark: "oklch(0.68 0.17 255)"
  fault-red: "oklch(0.577 0.245 27.325)"
  fault-red-dark: "oklch(0.704 0.191 22.216)"
  neutral-bg-light: "oklch(1 0 0)"
  neutral-bg-dark: "oklch(0.141 0.005 285.823)"
  neutral-fg-light: "oklch(0.141 0.005 285.823)"
  neutral-fg-dark: "oklch(0.985 0 0)"
  surface-card-light: "oklch(1 0 0)"
  surface-card-dark: "oklch(0.21 0.006 285.885)"
  surface-sidebar-light: "oklch(0.985 0 0)"
  surface-sidebar-dark: "oklch(0.21 0.006 285.885)"
  surface-muted-light: "oklch(0.967 0.001 286.375)"
  surface-muted-dark: "oklch(0.274 0.006 286.033)"
  muted-fg-light: "oklch(0.552 0.016 285.938)"
  muted-fg-dark: "oklch(0.705 0.015 286.067)"
  border-light: "oklch(0.92 0.004 286.32)"
  border-dark: "oklch(1 0 0 / 0.10)"
  ring-light: "oklch(0.708 0 0)"
  ring-dark: "oklch(0.556 0 0)"
  chart-1: "oklch(0.809 0.105 251.813)"
  chart-2: "oklch(0.623 0.214 259.815)"
  chart-3: "oklch(0.546 0.245 262.881)"
  chart-4: "oklch(0.488 0.243 264.376)"
  chart-5: "oklch(0.424 0.199 265.638)"
  chart-6: "oklch(0.705 0.213 47.604)"
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
    scope: "AT terminal, logs, copyable commands, technical identifiers"
rounded:
  sm: "calc(0.65rem - 4px)"
  md: "calc(0.65rem - 2px)"
  lg: "0.65rem"
  xl: "calc(0.65rem + 4px)"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-indigo}"
    textColor: "oklch(0.97 0.014 254.604)"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.25rem"
  button-destructive:
    backgroundColor: "{colors.fault-red}"
    textColor: "white"
    rounded: "{rounded.md}"
    height: "2.25rem"
  button-outline:
    backgroundColor: "{colors.neutral-bg-light}"
    textColor: "{colors.neutral-fg-light}"
    rounded: "{rounded.md}"
    height: "2.25rem"
  badge-outline-status:
    pattern: "variant=outline + bg-{role}/15 text-{role} hover:bg-{role}/20 border-{role}/30 + size-3 icon"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.surface-card-light}"
    textColor: "{colors.neutral-fg-light}"
    rounded: "{rounded.xl}"
    padding: "1.5rem"
  input:
    backgroundColor: "transparent (light) / input/30 (dark)"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.75rem"
    height: "2.25rem"
---

# Design System: QManager (RM520N-GL)

## 1. Overview

**Creative North Star: "The Operator's Console"**

QManager is the calm, expert console an operator trusts when something matters. It is served by the modem it manages (lighttpd + CGI on the RM520N-GL itself), so it earns its restraint twice: once as a stylistic principle (Linear and Vercel polish, no flash), and again as a safety principle (the routine 90% should feel effortless, the risky 10% should feel deliberate). The system rejects the engineer-default ugliness of classic router admin panels, the marketing-slick oversimplification of consumer router apps, and the AI-slop hero-metric template that has flattened every SaaS dashboard into the same product.

The aesthetic is **restrained at rest, responsive in interaction, quiet in motion, dense in data**. Surfaces are calm until a user reaches for them. Charts and signal readouts are allowed to be dense (this is a modem GUI; density is the job) but the density is earned with hierarchy, not dumped on the page. The interface is a peer to the technically literate user it serves: never patronizing, never showing off.

The dominant visual references, per project canon:

- **Apple System Preferences** for clarity and hierarchy: every feature page is a page header plus a uniform card layout, never a bespoke per-screen composition.
- **Vercel / Linear** for typography, motion restraint, and whitespace.
- **Grafana / Datadog** for data-visualization density done with discipline.
- **UniFi** for network-management UX patterns and inline status density. UniFi is a density reference, not a layout reference.

Anti-references: raw terminal aesthetics, cluttered legacy network tools, overly playful consumer styling. Never sacrifice clarity for visual flair.

**Key Characteristics:**

- Quiet by default, expressive in the moments that matter (destructive actions, recovery feedback, signal events).
- OKLCH-only color system. `#000` and `#fff` are forbidden as literals; every neutral is tinted toward the brand hue.
- **Euclid Circular B** is the interface voice; hierarchy comes from weight + scale. The mono voice (`font-mono`) is reserved for machine output and technical identifiers.
- Depth from tonal surfaces and hairline borders; shadows stay at `shadow-sm` or below at rest.
- Short, settled motion (140-250ms ease-out) with a single global reduced-motion switch (`MotionConfig reducedMotion="user"`).
- **Dense pill-and-tag status patterns** (UniFi heritage): outline badges with tinted washes, never solid badge fills.
- **Feature pages compose as a page header plus a uniform card grid**, responsive via container queries (`@container/main`), the way macOS System Settings panes are.
- **Build on shadcn/ui first.** When a surface needs a primitive (tabs, dialog, popover, tooltip, select, dropdown), use the shadcn component. Only build custom when shadcn genuinely does not provide one.
- Live-updating values tick smoothly via tabular numbers + short color transitions; never via layout shifts or fade-flashes.
- Dark and light themes are first-class equals. Neither is "the default." (`next-themes`, class strategy, `defaultTheme="system"`.)

## 2. Colors

A muted neutral foundation tinted toward the brand indigo, with four named functional colors that each own a specific operational meaning. The palette stays restrained: the product UI runs on tinted neutrals plus one true action accent at well under 10% of any given screen.

**Governing rule: Indigo acts, functional colors report, neutrals carry everything else.**

All values below are transcribed from `app/globals.css` and are the source of truth for both themes.

### Primary

- **Signal Indigo** (`oklch(0.488 0.243 264.376)`, identical in light and dark): the one true action accent. Primary buttons, links, the active sidebar selection, text selection highlight, primary action affordances. Never decorative. If a screen has more than two patches of Signal Indigo, one of them is wrong.
- **Primary foreground** (`oklch(0.97 0.014 254.604)`): text on indigo surfaces.
- **Sidebar Indigo** (`oklch(0.546 0.245 262.881)` light / `oklch(0.623 0.214 259.815)` dark): the sidebar's own primary steps, slightly lighter than the action accent so active nav reads as related but distinct.

### Secondary (Neutral Control Surface)

Unlike some sibling builds, this project's `--secondary` is **achromatic-neutral, not an indigo tint**. It shares its value with `--muted` and `--accent`:

- Light: `oklch(0.967 0.001 286.375)` with `--secondary-foreground: oklch(0.21 0.006 285.885)`
- Dark: `oklch(0.274 0.006 286.033)` with `--secondary-foreground: oklch(0.985 0 0)`

Secondary buttons and muted washes are therefore quiet gray surfaces. There is no second brand color and no identity palette; do not introduce one.

### Functional / Operational Colors

The four colors below are **functional**: each one signals a specific operational state. They never appear decoratively.

| Role | Light | Dark | Meaning | Icon pairing |
|------|-------|------|---------|--------------|
| **Uplink Green** (`--success`) | `oklch(0.59 0.18 149)` | `oklch(0.65 0.17 149)` | Healthy: connected, active service, successful save, profile applied | `CheckCircle2Icon` |
| **Caution Amber** (`--warning`) | `oklch(0.75 0.18 75)` | `oklch(0.80 0.16 75)` | Warning: degraded signal, searching, limited service, partial success | `TriangleAlertIcon` |
| **Telemetry Blue** (`--info`) | `oklch(0.62 0.19 255)` | `oklch(0.68 0.17 255)` | Informational: in-progress steps, notices that report rather than alarm | context-specific (`DownloadIcon`, `ClockIcon`, spinner) |
| **Fault Red** (`--destructive`) | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | Destructive or failed: reboot dialogs, failed applies, disconnected link | `XCircleIcon` or `AlertCircleIcon` |

Dark-mode functional colors are deliberately brighter for contrast against the dark canvas.

### Neutral

- **Pearl White** (`oklch(1 0 0)`): light-theme background, card, and popover surface. The only place pure white appears, and only via token.
- **Graphite** (`oklch(0.141 0.005 285.823)`): dark-theme background and light-theme foreground text. Tinted toward indigo (chroma 0.005) so it never reads as dead `#000`.
- **Slate** (`oklch(0.21 0.006 285.885)`): dark-theme card, popover, and sidebar surface.
- **Mist** (`oklch(0.967 0.001 286.375)` light / `oklch(0.274 0.006 286.033)` dark): muted surfaces, secondary buttons, accent hover washes.
- **Muted foreground** (`oklch(0.552 0.016 285.938)` light / `oklch(0.705 0.015 286.067)` dark): secondary text, descriptions, labels.
- **Hairline** (`oklch(0.92 0.004 286.32)` light / `oklch(1 0 0 / 10%)` dark): borders, dividers, input strokes. Dark inputs use a slightly stronger `oklch(1 0 0 / 15%)`.
- **Focus ring** (`oklch(0.708 0 0)` light / `oklch(0.556 0 0)` dark): the focus ring is a neutral gray in this build, rendered at 50% opacity and 3px width by the shadcn primitives. Destructive fields swap to a `ring-destructive/20` tint.

### Data Visualization (Chart Ramp)

- Five steps of indigo-blue (`chart-1` through `chart-5`, lightness 0.81 → 0.42, hue 251-266) for monochromatic series, consumed by the Recharts wrapper at `components/ui/chart.tsx`.
- One contrast accent (`chart-6` = `oklch(0.705 0.213 47.604)`, warm orange) for highlighting the "current" or "active" data point in a series.
- Any added chart color must remain readable under deuteranopia and protanopia simulation before merge.

### Signal Quality Ramp

Signal metrics map to functional colors through one shared ramp (`getSignalQuality()` in `types/modem-status.ts`), used identically on the dashboard, antenna statistics, and the alignment meter:

| Quality | Color | RSRP (dBm) | RSRQ (dB) | SINR (dB) |
|---------|-------|------------|-----------|-----------|
| Excellent | `text-success` | >= -80 | >= -5 | >= 20 |
| Good | `text-info` | >= -100 | >= -10 | >= 13 |
| Fair | `text-warning` | >= -110 | >= -15 | >= 0 |
| Poor | `text-destructive` | < -110 | < -15 | < 0 |

### Named Rules

**The Signal-Indigo Reserve.** Signal Indigo is rationed. Reserve it for the single most-important action affordance on a screen. If a Save button, a primary CTA, and a highlighted recommendation all appear on the same page, two of them must use a quieter variant. Rarity is what makes it read as "primary".

**The Functional-Color Promise.** A user who learns that Uplink Green means "healthy" on the dashboard must find the same green meaning the same thing in Watchdog, in Profile Apply, and in the alert logs. Functional colors are a contract; never decorate with them.

**The One-Accent Rule.** QManager has a single action accent: Signal Indigo. `--secondary` is a neutral control surface, not a brand color. Any attempt to introduce a second accent or identity color violates the restrained principle.

**The Semantic-Token Rule.** Always reach for semantic classes (`text-info`, `bg-success/15`, `text-muted-foreground`), never raw Tailwind palette colors (`text-blue-500`, `bg-green-500`). The theme switch depends on it.

**The OKLCH-Only Rule.** No hex literals. No `#000`, no `#fff`. New colors enter the system in OKLCH form in `globals.css`; conversion is the author's job, not the consumer's.

## 3. Typography

QManager's interface voice is **Euclid Circular B**, a clean geometric sans loaded locally as WOFF2 files in `app/layout.tsx` via `next/font/local` and applied to `<body>`. It maps to `font-sans` through `--font-sans: var(--font-euclid)` in `globals.css`.

**Loaded weights:**

| Weight | File | Usage |
|--------|------|-------|
| 300 (Light) | `EuclidCircularB-Light.woff2` | Decorative / oversized numerals only |
| 400 (Regular) | `EuclidCircularB-Regular.woff2` | Body text, inputs, descriptions |
| 400 (Italic) | `EuclidCircularB-Italic.woff2` | Rare emphasis |
| 500 (Medium) | `EuclidCircularB-Medium.woff2` | Labels, buttons, badges, table headers |
| 600 (SemiBold) | `EuclidCircularB-SemiBold.woff2` | Card titles, section headings, numeric readouts |
| 700 (Bold) | `EuclidCircularB-Bold.woff2` | Page titles (`h1`) |

**Secondary: Manrope.** Loaded through `next/font/google` in `app/layout.tsx` and designated the secondary typeface in project canon. Be honest about its current wiring: it is loaded but not bound to a CSS variable or utility class, so no rendered surface uses it today. It is a reserved fallback voice, not an active one. Do not hand-wire Manrope into components; if a genuine secondary-face need appears, bind it properly via a font variable first.

**Mono: Geist Mono (the machine voice).** `globals.css` maps `--font-mono: var(--font-geist-mono)`. `font-mono` is used across roughly two dozen surfaces: the AT terminal, system and alert logs, `CopyableCommand`, IMEI tools, cell data readouts, and dense signal values in the alignment meter. **Known gap, stated plainly:** `--font-geist-mono` is not currently defined by any loaded font (neither `layout.tsx` nor a package provides it), so at runtime `font-mono` spans fall back to the inherited UI font. The *scoping* is real and must be maintained; loading Geist Mono to honor the token is an open task. When adding machine-output surfaces, still mark them `font-mono`: the semantic boundary matters even before the glyphs do.

### Hierarchy

- **Display / Page Title** (Euclid 700, `text-3xl` / 30px): the `h1` at the top of every feature page, followed by a `text-muted-foreground` description.
- **Headline** (Euclid 600, `text-xl` / 20px): large card titles and state labels (e.g. dashboard status card titles use `text-lg font-semibold`).
- **Title** (Euclid 600, 1rem / 16px, `leading-none`): the `CardTitle` default. Tight leading so titles align cleanly with adjacent metadata.
- **Body** (Euclid 400, `text-sm` / 14px): default UI text, descriptions, table cells.
- **Label** (Euclid 500, `text-xs` / 12px): badges, table headers, button text, form labels, tiny uppercase section labels (`uppercase tracking-wider`).
- **Numeric** (Euclid 600, sized to slot, `tabular-nums`): live signal values, counters, timers. Always tabular so values do not jitter as they update.
- **Mono** (`font-mono`, usually `text-xs` / `text-sm`): AT terminal streams, log viewers, copyable commands, IMEI/ICCID identifiers, and compact signal readouts where column stability matters.

### Named Rules

**The Two-Voice Rule.** Euclid Circular B speaks for the interface; `font-mono` speaks for the machine and for dense technical identifiers. There is no third voice. Pairing Euclid with another UI sans is forbidden; Manrope stays reserved until it is properly bound.

**The Machine-Voice Rule.** `font-mono` (token target: Geist Mono) is scoped to device output and technical data: the AT terminal (input + output), raw log viewers, `CopyableCommand`, inline `<code>` for AT command strings, and identifier/value readouts (IMEI, ICCID, dBm values in compact meters). It is never reached for as decoration on headings, buttons, or prose.

**The Tabular-Number Rule.** Any number that updates live (signal values, latency, byte counters, countdowns, step counters) must use `tabular-nums`. This is already the observed convention across the dashboard, latency monitor, reboot countdown, and apply dialog; keep it universal. Non-tabular updates cause perceptible jitter in dense readouts.

**The Weight-Discipline Rule.** 400 body, 500 labels and medium emphasis, 600 headings and numerics, 700 page titles only. Hierarchy comes from weight contrast and scale, not from font mixing.

## 4. Elevation

QManager uses **tonal layering plus hairline borders** as the load-bearing depth signal. Shadows are quiet and mostly static; nothing about the layout breaks if they disappear.

- **Light theme:** Background (`Pearl White`) → Card (`Pearl White`) is intentionally flat; depth comes from the 1px Hairline border plus the card's `shadow-sm`. The sidebar is `oklch(0.985 0 0)`, one step off the canvas.
- **Dark theme:** Background (`Graphite`) → Card (`Slate`) is a tonal step lighter, so cards lift without needing shadow. The sidebar matches card tonality. Borders thin to `oklch(1 0 0 / 10%)`.

### Shadow Vocabulary (as shipped)

- **Whisper** (`shadow-xs`): inputs and outline buttons at rest. So subtle it is almost subliminal.
- **Resting** (`shadow-sm`): the `Card` primitive's built-in shadow (`rounded-xl border py-6 shadow-sm`). The only persistent shadow in the system.
- **Popover Float** (`shadow-lg` and up, via shadcn defaults): dialogs, dropdowns, popovers, the skip-to-content pill. The "this is not part of the page flow" signal.

### Named Rules

**The Tonal-First Rule.** Depth is communicated by surface tone and border before any shadow is considered. If two surfaces are at different conceptual elevations, their colors differ by at least one tonal step; in dark mode this is the *only* signal (Graphite canvas, Slate card).

**The Border-Carries-Structure Rule.** Every card, input, bordered row, and sub-tile draws a 1px Hairline border. Inner groupings use bordered rounded rows (`rounded-lg border p-4`) or muted washes (`bg-muted/30`), never heavier shadows. If a surface looks "popped out" without the user touching it, the shadow is too strong.

**The Highlight-by-Tint Rule.** Emphasis states tint border and background together with the relevant token at low opacity: the recommended alignment slot uses `border-primary/30 bg-primary/5` plus `ring-2 ring-primary`; a running pipeline step tints `bg-info/5`; an error banner sits on `bg-destructive/10`. Emphasis is a wash, not a lift.

## 4a. Motion System

Motion in QManager is quiet, short, and centrally governed. There is deliberately less motion machinery here than in sibling builds; what exists is consistent and must stay that way.

### The global switch

`components/motion-provider.tsx` wraps the app in `<MotionConfig reducedMotion="user">`. Every `motion/react` animation automatically honors `prefers-reduced-motion`: transform movement collapses to instant while opacity is preserved. Keep shared variants pure transform + opacity so this one switch is all that is ever needed. Raw CSS keyframes (like `pulse-ring` in `globals.css`) carry their own `@media (prefers-reduced-motion: reduce)` off-switch, as `globals.css` already demonstrates.

### The vocabulary (as implemented)

- **Page entrance** (`components/app-layout.tsx`): the route content, keyed on `pathname`, rises 6px and fades in over 0.2s `easeOut`. Enter-only; there is no exit animation. This is the most-felt animation in the product; do not embellish it.
- **Staggered card entrance** (`lib/motion-presets.ts`): `staggerContainer` + `staggerItem`, a 60ms cascade where each child rises 8px and fades in over 250ms `easeOut`. The dashboard grid is the reference consumer. New surfaces should import these presets rather than re-declaring local copies (the dashboard's inline duplicate is legacy to be converged, not a pattern to follow).
- **Value and label swaps**: `AnimatePresence mode="wait"` with 140-180ms fades and small 6px travel, as in `SaveButton`'s Saving / Saved / idle label swap.
- **Determinate fills**: small meter bars animate `scaleX` only, origin left, on a well-damped spring (`stiffness ~180, damping ~24`, no visible overshoot), as in the alignment meter's `MiniSignalBar`.
- **Confirmation pops**: the `SaveButton` "Saved!" check scales in on a tight spring (`stiffness 400, damping 22`). This is the sanctioned scale of springiness: a settle, never a wobble.
- **Ambient pulse**: `animate-pulse-ring` (2s ease-in-out alternate) for live/active dots, defined in `globals.css` with a reduced-motion kill switch.
- **Utility transitions**: `tw-animate-css` powers shadcn's built-in dialog/popover enter-exit transitions; `transition-colors` / `transition-all` handle hover and state tints at default speed.

### Named Rules

**The Settled-Motion Rule.** Every transition ends at rest with no visible overshoot. `easeOut` is the default curve; springs are permitted only when heavily damped and only for small confirmations and fills. Bouncy, elastic, and Material decelerate-and-bounce motion is banned. If a transition wobbles at the end, the parameters are wrong.

**The Short-Duration Rule.** The observed duration scale is 140-160ms (label swaps), 200ms (page entrance, color tints), 250ms (card entrances). Nothing in the UI should animate longer than ~500ms except deliberately ambient loops (pulse rings, spinners).

**The Loader-and-Dots Rule (project canon).** Step and sample progress renders as a `Loader2Icon` spinner plus discrete dot indicators (see the alignment meter's "Sample 3 of 5" row). Fill/progress bars are reserved for *data visualization* (signal strength, quality meters), never for step progress. This is a hard convention from CLAUDE.md.

**The Transform-Only Rule.** Animations touch `opacity` and `transform` (and `color` via CSS transitions) only. Never animate layout properties; never let a layout depend on a transition completing.

## 5. Components

Every component follows the **calm and confident** philosophy: surfaces are quiet at rest and respond clearly to interaction. All primitives are shadcn/ui (new-york style, lucide icons); the custom layer is thin and listed below.

### Buttons

- **Shape:** `rounded-md` (`0.65rem - 2px` ≈ 8.4px), `text-sm font-medium`, gap-2 icon spacing.
- **Default (Primary):** Signal Indigo background, light foreground, `h-9` (36px), `px-4`. Hover dims to `bg-primary/90`. Focus: 3px neutral ring at 50% opacity. **Primary actions (Record, Save, Apply) use this default variant, never outline.** (Project canon.)
- **Destructive:** Fault Red background, white text; dark mode runs `bg-destructive/60` for comfort. Used only for irreversible actions (reboot, delete, factory-level operations).
- **Outline:** Hairline border, `bg-background` (dark: `bg-input/30`), `shadow-xs` at rest, accent-tint hover. Tertiary actions: Cancel, Reset, Check again.
- **Secondary:** Mist background. Low-priority but meaningful actions.
- **Ghost:** no background at rest; accent tint on hover. Icon buttons, table-row actions. Icon-only buttons always carry `aria-label`.
- **Link:** Signal Indigo text, underline on hover, inline within text only.
- **Sizes:** `xs` (h-6), `sm` (h-8), `default` (h-9), `lg` (h-10), plus square `icon-xs` / `icon-sm` / `icon` / `icon-lg` variants.
- **Save actions always use `SaveButton`** (`components/ui/save-button.tsx`): a min-width 120px primary button that swaps its label between idle, "Saving…" (spinner), and a "Saved!" check flash driven by the `useSaveFlash` hook (1.8s). Recreating save UI inline is forbidden.

### Status Badges

The signature pattern of QManager, kept exactly consistent with CLAUDE.md. **All status badges use `variant="outline"`** plus semantic color classes and a `size-3` lucide icon. Solid `success` / `warning` / `destructive` / `info` variants exist in `components/ui/badge.tsx` but are **forbidden for status indicators**; the outline-plus-tint pattern is the rule.

| State | Classes | Icon |
| ----- | ------- | ---- |
| Success / Active | `bg-success/15 text-success hover:bg-success/20 border-success/30` | `CheckCircle2Icon` |
| Warning | `bg-warning/15 text-warning hover:bg-warning/20 border-warning/30` | `TriangleAlertIcon` |
| Destructive / Error | `bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30` | `XCircleIcon` or `AlertCircleIcon` |
| Info | `bg-info/15 text-info hover:bg-info/20 border-info/30` | Context-specific (`DownloadIcon`, `ClockIcon`, spinner) |
| Muted / Disabled | `bg-muted/50 text-muted-foreground border-muted-foreground/30` | `MinusCircleIcon` |

```tsx
<Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
  <CheckCircle2Icon className="size-3" />
  Active
</Badge>
```

**Choose Muted for deliberately inactive states** (Stopped, Offline peer, Disabled-by-config); **reserve Destructive for failure or error** (Disconnected link, Failed email). No shared badge wrapper component exists in the tree; the pattern is composed inline today. If a reusable wrapper is ever extracted, migrate inline copies to it and update CLAUDE.md in the same change.

### Cards / Containers

- **Shape:** `rounded-xl` (`0.65rem + 4px` ≈ 14.4px), the largest radius in the system.
- **Surface:** `bg-card` (Pearl White / Slate), 1px Hairline border always present, `shadow-sm`. Borders carry the depth, not shadows.
- **Padding:** `py-6` with `px-6` on header/content/footer; `gap-6` between card sections (built into the primitive).
- **CardHeader contract (project canon):** plain `CardTitle` + `CardDescription`, **no icons in headers**. Icons belong in badges or the `CardAction` slot (the header grid reserves a column for it). A refresh icon button in `CardAction` is the sanctioned header action.
- Inner groupings use bordered rounded rows (`rounded-lg border p-4`) and muted washes (`rounded-lg border bg-muted/30 p-3`), the alignment meter's "Live Signal" preview being the reference.

### Inputs / Fields

- **Shape:** `rounded-md`, `h-9` (36px), `px-3`.
- **Background:** transparent in light, `bg-input/30` in dark. Hairline (`border-input`) border in both themes, `shadow-xs` at rest.
- **Focus:** 3px neutral ring (`ring-ring/50`) + `border-ring`, transitioned on `color, box-shadow`.
- **Error:** `aria-invalid` drives `border-destructive` + `ring-destructive/20` (40% in dark).
- **Disabled:** `opacity-50`, `pointer-events-none`, not-allowed cursor.
- Supporting field primitives: `field.tsx` (label + value display), `input-group.tsx` (prefix/suffix), `kbd.tsx`, `copyable-command.tsx` (mono command with copy affordance).

### Sidebar Navigation

- shadcn sidebar, **inset variant**: header (logo + product name), grouped nav sections (`NavMain`, `NavCellular`, `NavLocalNetwork`, `NavMonitoring`, `NavSystem`, `NavSecondary`), `NavUser` footer.
- **Surface:** `--sidebar` (one step off canvas in light, equal to card in dark). Active items use the Sidebar Indigo steps; hover uses the Mist accent wash.
- Collapsible groups for dense sections (Cellular, Monitoring); flat lists elsewhere. On mobile the sidebar collapses to a sheet.
- The header bar above content carries the `SidebarTrigger`, a hairline separator, and breadcrumbs (parents hidden below the `desktop` breakpoint, 68.75rem).

### Dialogs / Confirmation

- **Shape:** `rounded-xl` on card surface with popover-level shadow; standard shadcn overlay dimming.
- **Destructive dialogs:** consequences spelled out in `DialogDescription`, destructive-variant CTA ("Reboot Now"), outline "Later" escape. Reboot-required operations surface this dialog rather than rebooting mid-request.
- **Persistent banners:** app-level warnings that must outlive a page render as a banner above the content area; `SimSwapBanner` (rendered in `AppLayout`) is the reference.
- **Toasts:** `sonner` for action feedback (`toast.success` / `toast.error` with description). Toasts confirm; they never carry the only copy of an error a user must act on.

### Apply Progress Dialog (Signature Component)

The canonical shape for **async, multi-step apply pipelines**, implemented at `components/cellular/custom-profiles/apply-progress-dialog.tsx` for the profile-apply pipeline (APN → TTL/HL → Connection Scenario → IMEI). It is one of the rare sanctioned modals: profile activation is an irreversible, connection-affecting operation whose progress genuinely is the content.

Anatomy, as shipped:

- **Header:** `DialogTitle` ("Applying Profile") with the live status rendered as a standard outline badge beside it: Applying… (info + spinner), Complete (success), Partial (warning), Failed (destructive). `DialogDescription` carries the profile name and a tabular-nums "Step N of M" counter while running.
- **Step ledger:** a compact list of per-step rows: status icon + step label + truncated detail. `pending` (muted clock), `running` (info spinner, row tints `bg-info/5`), `done` (success check), `failed` (destructive X), `skipped` (muted check, detail reads **"Unchanged"** because the value already matched; the muted check reads as "nothing to do" both transiently and at completion).
- **Honest pre-poll state:** in the short window before the backend's first status poll, the dialog renders a single "Preparing…" row instead of a fabricated placeholder list (the real step count is not yet known).
- **Reboot heartbeat:** when a step requires a modem restart, a calm info notice appears ("Modem is restarting… This usually takes 30-60 seconds. The dashboard will reconnect automatically."). The dialog never triggers an inline reboot beyond what the pipeline itself requires, and it sets expectations with copy plus a spinner rather than a fake timer.
- **Terminal resolution:** the dialog cannot be dismissed until the pipeline reaches a terminal state (`complete` / `partial` / `failed`), so a half-finished apply is never abandoned by an accidental click. Partial and failed states reveal Retry (when a handler is provided) and Close.

Config restore and similar pipelines should adopt this shape rather than inventing their own progress UI.

### Alignment Recorder (Signature Component)

The antenna-alignment surface (`components/cellular/antenna-alignment/alignment-meter.tsx`) is QManager's signature measure-and-compare instrument: record three antenna angles (directional) or placements (omni), average five samples per recording, and get a recommendation.

- **Live preview:** a muted-wash inset (`rounded-lg border bg-muted/30`) with compact mono signal values over slim quality-tinted fill bars (the one sanctioned use of fill bars: data visualization).
- **Three slot cards:** bordered rounded regions with an editable label input. Recording state shows the `Loader2Icon` spinner + "Sample N of 5" + a row of discrete dots that fill as samples land (the Loader-and-Dots Rule in action). The winning slot gains `ring-2 ring-primary` and a floating "Best" badge with a trophy icon.
- **Recommendation panel:** an `AnimatePresence` fade-rise inset on `border-primary/30 bg-primary/5` naming the winning angle/position in primary color, with honest copy when slots remain unrecorded.
- State persists to `localStorage` (versioned), and every slot carries a `role="region"` label describing its status for screen readers.

### Dashboard Status Cards (Signature Surface)

The dashboard (`components/dashboard/home-component.tsx`) is the product's one sanctioned glance surface: a two-column composition (3/5 status + 2/5 device panel at `@4xl/main`) of self-contained status cards (Network, LTE/NR carriers, SCC, Device, signal history chart, live latency, recent activities), entering with the staggered fade-up cascade.

- **Values are tabular, colored by the signal-quality ramp** via `getSignalQuality()`; connection state maps to functional colors (Connected green, Searching/Limited amber, Disconnected red, Inactive muted).
- **Skeletons mirror the loaded geometry** (same row counts, same icon slot), so the page does not reflow when data lands.
- **Poll cadence follows the backend:** the poll interval derives from the ping daemon's write interval plus a small buffer; the UI never pretends to be more live than its data source.
- A stale-data condition surfaces as an honest full-width `role="alert"` wash ("Unable to reach the modem. Data shown may be outdated."), never a silent freeze.

### Reboot Countdown Ring

`components/reboot/reboot-countdown.tsx` renders the one radial gauge in the system: an SVG stroke-dashoffset ring counting down a reboot with a tabular-nums center. Radial meters are reserved for genuinely bounded, time-or-fraction readings like this; they are not a general dashboard decoration.

### Activity Log Cards

Watchdog, Email Alerts, and SMS Alerts each pair a status card and a settings card with a log card (`email-alerts-log-card.tsx`, `sms-alerts-log-card.tsx`): a paginated table of recent events, newest first, timestamps in `font-mono text-xs` per the machine-output allowance, statuses as outline badges. Empty states live inside the table so the card shape does not jump when the first row arrives.

### The Three-State Pattern

Every data-driven component handles loading, error, and empty deliberately:

- **Loading:** `Skeleton` blocks mirroring the final layout.
- **Error:** a destructive `Alert` (or inline destructive wash for page-level failures) with the actual message.
- **Empty:** the `Empty` primitive (icon, title, one-line description pointing at the action that produces data).

Never a blank card, never a spinner in a void.

### Layout & Responsiveness

- **Page anatomy (the Consistent-Layout Rule, Apple heritage):** every feature page is a thin wrapper: `@container/main` scope, an `h1` (`text-3xl font-bold`) plus muted description, then a uniform grid of self-contained cards with container-query columns (`grid gap-4 @3xl/main:grid-cols-2`, `@4xl:grid-cols-2`). See `app/local-network/custom-dns/page.tsx` and `components/local-network/ethernet-status.tsx` for the reference shape. A user who learns one page has learned them all.
- **The Card-Wrapped Surface Rule:** the card component owns its whole content (`CardHeader` + `CardContent` with every control); the page only arranges cards. `CustomDnsCard`, `EthernetStatusCard`, and the Custom Profiles cards are the reference units. The page is never the layout canvas with cards demoted to fragments.
- **Container queries over viewport queries inside cards:** a card that declares `@container/card` must use `@sm/card:` / `@md/card:` for everything inside it. Mixing viewport `sm:` with container `@sm/card:` in one card breaks on tablets and expanded sidebars. Viewport breakpoints stay for page-level concerns (padding, heading scale).
- **Toolbars flex-wrap** so action clusters fall to a second row instead of overflowing; **tables wrap prose columns** (`whitespace-normal break-words` with container-stepped `max-w`) and treat horizontal scroll as a fallback only.
- **Touch targets:** minimum 44px on coarse pointers; icon-only tab lists bump `TabsList` height rather than shrinking triggers.
- **Page padding:** `px-4 lg:px-6` is the target rhythm (the dashboard already follows it); legacy `mx-auto p-2` wrappers are being phased out, do not add new ones.

### Icons

- **Lucide** is the primary library: `size-3` in badges, `size-4` inline, `size-5` in buttons, `size-8+` in empty states.
- **Tabler** (`@tabler/icons-react`) is the sanctioned secondary for glyphs lucide lacks. Some legacy surfaces import from `react-icons` (Md/Fa6/Tb); do not extend that dependency in new work.
- Icon-only buttons always include `aria-label`.

### Named Rules

**The Outline-Badge Rule.** All status badges in feature surfaces use `variant="outline"` + semantic tint classes + `size-3` icon. Solid badge variants are forbidden for status. If a badge needs to feel louder, the answer is a banner or an alert, not a solid badge.

**The No-Header-Icon Rule.** `CardHeader` is `CardTitle` + `CardDescription` only. Icons live in badges or in the `CardAction` slot. Once one card grows a header icon, every card grows one.

**The Save-Button Singleton.** All save actions use `SaveButton` + `useSaveFlash`. It carries the loading spinner and success flash; extend it rather than fork it.

**The Consistent-Layout Rule (Apple heritage).** Feature pages compose as a page header plus a uniform container-query grid of self-contained cards. A bespoke asymmetric layout unique to one screen is almost always wrong; the dashboard is the one sanctioned glance surface, and even it is built from the same self-contained cards.

**The Loader-and-Dots Rule.** Step and sample progress is a `Loader2Icon` spinner plus discrete dots. Fill bars are data visualization only (signal strength, quality meters, countdown rings).

**The Skeleton-Mirror Rule.** Loading skeletons reproduce the geometry of the loaded state; the page must not reflow when real data arrives. A centered spinner where a card's content will be is a violation.

**The Saved-State Honesty Rule.** Surfaces describing live behavior tell the truth: status cards render saved settings and actual daemon state, the dashboard flags stale data instead of freezing silently, and the apply dialog renders "Preparing…" rather than a fabricated step list before the first poll.

**The Muted-vs-Destructive Rule.** Muted styling means "deliberately off" (Stopped, Disabled, Offline peer). Destructive styling means "failed" (Disconnected link, Failed email). Confusing the two erodes the functional-color contract.

**The Deferred-Reboot Rule.** Nothing reboots the modem as a side effect. Reboot-requiring changes surface an explicit dialog (destructive CTA + "Later" escape) or an in-pipeline heartbeat notice; persistent conditions get a banner (`SimSwapBanner` pattern).

### Aspirational / Not Yet Built

Documented for direction only; none of these exist in this tree today. Do not reference them as if they ship.

- **Circular signal meter** (Nokia FastMile-style 240° arc) for signal/antenna pages; the current alignment surface uses linear mini-bars.
- **Topology / neighbor-cell map** (UniFi-style pannable canvas); cell scanning currently renders as dense tables.
- **Sticky save bar** with per-tab error dots for long tabbed settings forms; current forms keep the `SaveButton` in the card footer.
- **Shared `ServiceStatusBadge` wrapper**; the outline-badge pattern is composed inline until it lands.
- **Geist Mono actually loaded** so the `--font-geist-mono` token resolves to real glyphs.

## 6. Do's and Don'ts

### Do:

- **Do** use `oklch()` for every color, entered as tokens in `globals.css`. Never reach for hex.
- **Do** reserve Signal Indigo for the single most-important affordance on a screen (Save, Apply, active nav, the "Best" recommendation). Less than 10% of any screen.
- **Do** use the **outline status badge** pattern (`variant="outline"` + `bg-{role}/15 text-{role} hover:bg-{role}/20 border-{role}/30` + `size-3` icon) for every status indicator, exactly as CLAUDE.md specifies.
- **Do** keep `CardHeader` to `CardTitle` + `CardDescription`. Put icons in badges or in `CardAction`.
- **Do** use `tabular-nums` for any live-updating numeric readout, and color it by the shared `getSignalQuality()` ramp when it is a signal metric.
- **Do** use semantic tokens (`text-info`, `bg-success/15`) instead of raw Tailwind palette colors; test every new surface in both themes.
- **Do** animate with short ease-out transitions (140-250ms) and well-damped springs only; import `staggerContainer` / `staggerItem` from `lib/motion-presets.ts` for card entrances instead of re-declaring variants.
- **Do** respect reduced motion everywhere: `motion/react` work is covered by the global `MotionConfig`; raw CSS keyframes need their own `@media (prefers-reduced-motion: reduce)` block.
- **Do** compose feature pages as a page header plus a uniform container-query card grid, and author each card as a self-contained component the page arranges (`CustomDnsCard`, `EthernetStatusCard` are the reference shape).
- **Do** build on shadcn/ui first; when a surface needs tabs, a dialog, a popover, a select, use the shadcn primitive and style it with the tokens here.
- **Do** use container queries (`@sm/card:` etc.) for all responsive logic inside a card that declares `@container/card`; keep viewport breakpoints for page-level decisions.
- **Do** render step/sample progress as `Loader2Icon` + dot indicators; keep fill bars for data visualization only.
- **Do** use `SaveButton` for every save action and default-variant buttons for every primary action (Record, Apply, Confirm).
- **Do** make skeletons mirror the loaded layout, put table empty states inside the table, and surface stale data with an honest alert wash.
- **Do** use Muted badge styling for deliberately inactive states and reserve Destructive for actual failures.
- **Do** defer reboots behind explicit dialogs or in-pipeline notices with honest time expectations; use a persistent banner (`SimSwapBanner` pattern) for conditions that must outlive a page.
- **Do** mark machine output and technical identifiers with `font-mono` (AT terminal, logs, commands, IMEI/ICCID, dense signal values), and nowhere else.
- **Do** include `aria-label` on icon-only buttons, `role="status"` / `aria-live` on polling surfaces, and `role="alert"` on failure washes; the codebase already does, keep the bar.

### Don't:

- **Don't** use `#000` or `#fff` literals. They are forbidden in this codebase; the white and near-black that exist are tokens.
- **Don't** use solid `success` / `warning` / `destructive` / `info` badge variants for status indicators. They exist in `badge.tsx` for completeness; outline-and-tint is the only correct status badge.
- **Don't** add icons to `CardHeader`. They drift into hero-metric SaaS template territory.
- **Don't** introduce a second UI typeface. Euclid Circular B is the interface voice; Manrope stays reserved until properly bound; Inter, Geist Sans, IBM Plex, and Roboto are forbidden as UI fonts. `font-mono` is scoped by the Machine-Voice Rule, never decoration.
- **Don't** hand-wire fonts into components with `font-family` styles or ad-hoc classes; fonts enter through `next/font` variables and the `@theme` mapping in `globals.css`.
- **Don't** use side-stripe borders (`border-left: 3px solid`) on cards or callouts; emphasis is a full tinted wash (`border-primary/30 bg-primary/5`), consistent with the Hairline discipline.
- **Don't** use `background-clip: text` gradient text. Solid color only; emphasis through weight or size.
- **Don't** ship the hero-metric SaaS template (giant gradient number + three supporting stats). The dashboard's status cards are the anti-template: tabular values, quality-coded color, contained in the normal card layout.
- **Don't** invent a bespoke hero layout for a single feature page when the uniform card grid serves better; and don't build grids of decorative icon-plus-heading cards that carry no real controls.
- **Don't** hand-roll a component shadcn/ui already provides (tabs, accordion, dialog, popover, tooltip, select, dropdown). Custom components are for the gaps shadcn does not cover.
- **Don't** add bouncy, springy, or elastic motion with visible overshoot. The two shipped springs (meter fill, saved-check pop) are heavily damped settles; that is the ceiling, not the floor.
- **Don't** animate value changes via fade-out-then-fade-in or layout shifts. Tabular-nums plus a short color transition is the sanctioned pattern for live values.
- **Don't** use progress/fill bars for step progress; that is the Loader-and-Dots Rule's territory. (Fill bars belong to signal meters and data viz.)
- **Don't** mix viewport breakpoints and container queries inside the same card; one breakpoint authority per card.
- **Don't** make modals the first thought. Inline disclosure, destructive buttons with clear descriptions, and deferred banners cover most confirmations. Modals are for the genuinely irreversible or genuinely blocking (reboot, profile apply pipeline).
- **Don't** document or reference removed features (NetBird VPN, DPI/Traffic Engine, Low Power Mode daemons) as design surfaces; they no longer exist on this branch.
- **Don't** let a UI claim liveness it doesn't have: no fake timers, no placeholder step lists, no frozen values without a stale-data notice.
- **Don't** use em dashes in documentation. Use commas, colons, semicolons, periods, or parentheses. (UI copy follows its own rules; this convention is for docs and code comments.)
