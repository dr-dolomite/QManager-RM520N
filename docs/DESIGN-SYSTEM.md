# QManager Design System (Developer Reference)

> ⚠️ **The authoritative visual design system is the root [`DESIGN.md`](../DESIGN.md).**
> Product strategy, users, and principles live in the root [`PRODUCT.md`](../PRODUCT.md).
> `DESIGN.md` carries the verified OKLCH tokens, typography truth, motion system, component
> rules, and the named Do's/Don'ts. **On any conflict, `DESIGN.md` wins.** This file used to
> duplicate all of that; it has been trimmed to the practical, developer-facing scaffolding
> that `DESIGN.md` does not carry (the shadcn/ui setup, the component inventory, concrete
> responsive recipes, and the theming mechanism).

Read `DESIGN.md` first. Come here for the wiring: which components exist, how the responsive
recipes are written, and how dark mode is implemented.

---

## Where the visual truth lives

Everything below is documented in full (with values, rationale, and named rules) in `DESIGN.md`.
Do not re-document it here; point to it.

| Topic | Authority |
|-------|-----------|
| OKLCH color tokens (light + dark), functional colors, chart ramp, signal-quality ramp | `DESIGN.md` §2 Colors |
| Typography (Euclid Circular B, Geist Mono machine voice, weight discipline) | `DESIGN.md` §3 Typography |
| Radius (`0.65rem` base) and spacing scale | `DESIGN.md` frontmatter (`rounded`, `spacing`) |
| Elevation, shadows, tonal layering | `DESIGN.md` §4 Elevation |
| Motion system (durations, springs, reduced-motion, presets) | `DESIGN.md` §4a Motion System |
| Buttons, badges, cards, inputs, dialogs, the signature components | `DESIGN.md` §5 Components |
| Do's and Don'ts | `DESIGN.md` §6 |

> ℹ️ NOTE: Two claims in the older version of this file were **wrong** and are corrected in
> `DESIGN.md`: (1) **Status badges use the outline-plus-tint pattern**
> (`variant="outline"` + `bg-{role}/15 text-{role} hover:bg-{role}/20 border-{role}/30` + `size-3`
> icon), *not* solid `variant="default"`/`variant="destructive"` fills. (2) The fonts are
> **Euclid Circular B** (UI) and **Geist Mono** (machine voice, bound to `--font-geist-mono`);
> the previously-loaded-but-unbound Manrope has been removed. See `DESIGN.md` §3.

---

## Component Library

### shadcn/ui configuration

QManager is built on shadcn/ui (`components.json`), new-york style, lucide icons, Tailwind v4 with
CSS variables. Build on these primitives first; only write a custom component for a genuine gap.

```json
{
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": { "baseColor": "zinc", "cssVariables": true },
  "iconLibrary": "lucide",
  "registries": { "@magicui": "https://magicui.design/r/{name}.json" }
}
```

The `@magicui` registry is wired in `components.json`, so MagicUI components can be pulled with the
shadcn CLI alongside the standard registry.

### Primitives location

All primitives live in `components/ui/`. That directory is the live inventory — run
`ls components/ui` rather than trusting a frozen list here (the previous hardcoded count drifted).
It currently holds the standard shadcn set (button, card, dialog, popover, tooltip, select,
dropdown-menu, tabs, table, badge, alert, alert-dialog, sheet, sidebar, breadcrumb, sonner, etc.)
plus the custom/non-standard components below.

### Custom components (repo-specific)

These are not vanilla shadcn primitives; they are QManager additions a developer needs to know:

| Component | Purpose |
|-----------|---------|
| `save-button.tsx` | The mandated save control (idle / "Saving…" / "Saved!" flash via `useSaveFlash`). Every save action uses it. |
| `copyable-command.tsx` | Mono command string with a copy affordance (machine-voice surface). |
| `empty.tsx` | Empty-state primitive (icon + title + one-line description). The third of the three states. |
| `field.tsx` | Labeled read-only value display (label + value). |
| `input-group.tsx` | Input with prefix/suffix adornments. |
| `kbd.tsx` | Keyboard-shortcut key rendering. |
| `metric-bar.tsx` | Quality-tinted linear signal/metric fill bar (data-viz fill, per the Loader-and-Dots Rule). |
| `meta-panel.tsx` | Grid-laid attribute readouts (`MetaPair`) for device/detail panels. |
| `spinner.tsx` | Shared spinner primitive. |
| `animated-beam.tsx`, `animated-list.tsx` | MagicUI-derived motion helpers for signal-beam / list transitions. |

For where these are consumed (pages, hooks, routing), see [FRONTEND.md](FRONTEND.md).

---

## Responsive Recipes

`DESIGN.md` §5 states the *rules* (container queries inside cards, one breakpoint authority per
card, toolbars flex-wrap, tables wrap prose). These are the concrete snippets that implement them.

### Container scope

```tsx
<main className="@container/main">
  <div className="grid gap-4 @3xl/main:grid-cols-2 @4xl/main:grid-cols-2">
    {/* cards resize to the container, not the viewport */}
  </div>
</main>

<Card className="@container/card">
  {/* use @sm/card:, @md/card: for everything inside this card */}
</Card>
```

> ⚠️ WARNING: Never mix viewport queries (`sm:`, `md:`) with container queries (`@sm/card:`) inside
> the same card. A card can be narrow while the viewport is wide (expanded sidebar, tablet), so
> viewport-keyed labels appear before the card has room for them. Viewport breakpoints stay for
> **page-level** concerns only (page padding, heading scale).

### Toolbars inside cards

Toolbars that combine tabs and actions must `flex-wrap` so the action cluster drops to a second row
instead of overflowing:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <TabsList>…</TabsList>
  <div className="ml-auto flex items-center gap-2">{/* actions */}</div>
</div>
```

### Tables inside cards

`TableCell` inherits `whitespace-nowrap`. For prose columns (event messages, long names), opt back
into wrapping and cap width across container breakpoints; keep date/short-id columns nowrap:

```tsx
<TableCell className="max-w-[12rem] @sm/card:max-w-[20rem] @md/card:max-w-md whitespace-normal break-words">
  {longMessage}
</TableCell>
```

The wrapping `<Table>` provides `overflow-x-auto` as a fallback only; relying on horizontal scroll
for primary content is a phone UX anti-pattern.

### Breakpoint reference

Viewport breakpoints (page-level decisions: padding, heading scale, breadcrumb visibility):

| Prefix | Width | Usage |
|--------|-------|-------|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Tablet landscape / small desktop |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large desktop |

Container-query breakpoints (inside a card that declares `@container/card`):

| Prefix | Width | Card has room for |
|--------|-------|-------------------|
| `@sm/card` | 384px | Short text labels |
| `@md/card` | 448px | Full text labels ("Band Changes", "Network Mode") |
| `@lg/card` | 512px | Dense multi-column layouts |

### Mobile

- Sidebar collapses to a sheet; cards stack vertically.
- Touch targets minimum 44px. For icon-only tab lists, bump `TabsList` height
  (`h-11 @md/card:h-9`) rather than overriding individual trigger min-widths (which collapses
  `flex-1` triggers below their content size).
- Page wrappers use `px-4 lg:px-6`; legacy `mx-auto p-2` wrappers are being phased out.

---

## Dark Mode Implementation

`DESIGN.md` §2/§4 cover the dark palette and the tonal-layering rationale. This is the mechanism.

Theming uses `next-themes` with class-based toggling. `app/layout.tsx` wraps the app in
`ThemeProvider` with `attribute="class"` and `defaultTheme="system"` (both themes are first-class;
neither is "the default"). The `.dark` variant is declared in `app/globals.css`:

```css
@custom-variant dark (&:is(.dark *));
```

All colors switch through CSS variables, so components never need theme conditionals.

- Never use hardcoded colors (`#fff`, `rgb(0,0,0)`); always semantic tokens (`text-foreground`,
  `bg-card`). See the OKLCH-Only and Semantic-Token rules in `DESIGN.md` §2.
- Test both themes when adding a surface. Dark-mode functional colors are deliberately brighter for
  contrast against the dark canvas.

---

## Sidebar Structure

The sidebar is the shadcn `inset` variant (header + grouped nav sections + `NavUser` footer). The
nav grouping, at a glance:

| Section | Contents |
|---------|----------|
| Header | QManager logo + product name |
| NavMain | Home / dashboard |
| NavCellular | Cellular Info, SMS, Profiles, Band Locking, Cell Scanner, Settings (collapsible) |
| NavLocalNetwork | Ethernet, IP Passthrough, DNS, TTL & MTU |
| NavMonitoring | Events, Email/SMS Alerts, Tailscale, Watchdog, Logs (collapsible) |
| NavSystem | System-level tools and settings |
| NavSecondary | About Device, Support, Donate |
| Footer (NavUser) | Avatar, change password, logout |

> ℹ️ NOTE: The exact item list drifts as features ship. For the authoritative routing and nav
> wiring, read the nav components and [FRONTEND.md](FRONTEND.md), not this table.
