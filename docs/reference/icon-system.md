# Icon System

QManager draws its glyphs from two libraries separated by a hard, tracked boundary. **Material Symbols Rounded** is scoped to the sidebar navigation and the dashboard route; **lucide-react** covers every other route. The boundary exists because the failure it prevents is *two icon sets inside one screen*, not "Material is nicer than lucide". Before this change the dashboard carried four icon sets in a single viewport (`lucide-react`, `react-icons/md`, `react-icons/fa6`, `react-icons/tb`) sitting beside a sidebar that was already on Material Symbols. The rule that governs it is DESIGN.md's **Icon-Boundary Rule**, which replaced the retired Nav-Glyph Boundary Rule.

Material Symbols is a **self-hosted, ligature-driven icon font**, not an SVG component library. That single fact produces every gotcha on this page: the sizing behaviour, the build-time subsetting step, and the way a missing glyph fails.

## Quick Reference

| Thing | Where |
|-------|-------|
| Icon component | `components/ui/material-symbol.tsx` |
| **Canonical glyph list (single source of truth)** | `MATERIAL_SYMBOL_NAMES` in `components/ui/material-symbol-names.ts` |
| Allowed glyph names (TS type) | `MaterialSymbolName`, **derived** from that array |
| Subset generator | `scripts-dev/subset-icons.ts` (imports the same array) |
| Shipped font file | `app/fonts/MaterialSymbolsRounded-subset.woff2` (56 glyphs, 20.2 KB) |
| Generator manifest | `app/fonts/MaterialSymbolsRounded-subset.json` — what was requested + sha256 of what shipped |
| Font binding | `app/layout.tsx` (`next/font/local`, bound to a CSS variable) |
| Regenerate the font | `bun run icons:subset` |
| **Verify the font is not stale** | `bun run icons:check` — runs inside `bun run package` |
| Canon | `DESIGN.md` > Components > Icons; the Icon-Boundary Rule, the Network Status Landmark Rule |
| Machine-readable copy (audit tooling reads this) | `.impeccable/design.json` |

```sh
# after editing the glyph list
bun run icons:subset
bun run icons:check
git add app/fonts/MaterialSymbolsRounded-subset.woff2 \
        app/fonts/MaterialSymbolsRounded-subset.json
```

## Where each library is allowed

| Surface | Library |
|---------|---------|
| Sidebar nav (`components/app-sidebar.tsx`, `nav-section.tsx`, `nav-user.tsx`) | Material Symbols |
| Dashboard route (`components/dashboard/*`) | Material Symbols |
| Cellular, Local Network, Monitoring, System Settings, their dialogs | lucide |
| Header bar above the content (`SidebarTrigger`, breadcrumbs) | lucide — it is not the sidebar |
| Banners (`components/ui/banner.tsx`) | lucide — banners are route-agnostic and mount on lucide pages too |
| Glyphs lucide lacks | Tabler (`@tabler/icons-react`), the sanctioned secondary |

### The two sanctioned exceptions

Both live in `components/dashboard/network-status.tsx` and are covered by DESIGN.md's **Network Status Landmark Rule**: Network Status is a recognized landmark on the one glance surface, and re-glyphing it buys nothing.

1. **The SIM orb keeps lucide** `CardSimIcon` and `Plane`.
2. **The RAT glyphs keep `react-icons/md`** — `MdOutline5G`, `Md4gPlusMobiledata`, `Md4gMobiledata`, `Md3gMobiledata`. These are typographic marks (the low-power leaf that used to sit here migrated to Material `energy_savings_leaf` — it is an ordinary pictogram, so the exception never covered it). They are ("5G", "4G+", "3G"), not pictograms, and Material Symbols has no equivalent.

> ℹ️ NOTE: `react-icons` is a legacy dependency that is not to be extended. These five glyphs are the only sanctioned survivors on the dashboard.

## Adding a glyph

Because the typeface is ligature-driven — the component renders the literal text `cell_tower` and the font substitutes a glyph for it — a name the type permits but the shipped subset lacks does **not** fail the build. It type-checks, it builds, and it ships a card that renders the literal word `sim_card` to a technician standing at a mast. This is the one failure mode in the icon system that is invisible until it reaches a device: there is no runtime error to trace, because a ligature font failing to substitute is just a font drawing the letters it was given.

The procedure is two steps:

1. Add the ligature name to `MATERIAL_SYMBOL_NAMES` in `components/ui/material-symbol-names.ts`, **keeping the array sorted**.
2. Run `bun run icons:subset`, then **commit the regenerated `.woff2` and `.json` together**.

There is no second list to keep in step. `MaterialSymbolName` is derived from the array (`(typeof MATERIAL_SYMBOL_NAMES)[number]`) and the generator imports the same array, so the compiler and the font cannot disagree about which glyphs exist. That used to be two hand-maintained copies with nothing checking them; the duplication was removed rather than policed.

Sorting is enforced, and not for tidiness: it keeps "we added one glyph" a one-line diff, and stops two people who each append to the end in the same week from colliding on the same line.

### What `icons:check` actually proves

The remaining hazard is the **committed font going stale**. Editing the list is one text edit; regenerating the font is a network round-trip plus a `git add` of a binary — that is the half people skip, and skipping it produces a clean diff, a passing `tsc`, a successful `next build`, and a broken device.

WOFF2 cannot be cheaply introspected: it is Brotli-compressed with per-table transforms, so reading its ligature table needs a real font parser. Rather than take that dependency, **the generator testifies** — `icons:subset` writes `MaterialSymbolsRounded-subset.json` recording the exact names requested, the axis string, the byte count, and the sha256 of the bytes received. `icons:check` compares the committed font against that testimony and fails the build on any mismatch. It catches:

| Failure | How it is caught |
|---------|------------------|
| Glyph added to the list, font not regenerated | name in the array but not in `manifest.icons` |
| Font cut from a stale list | name in `manifest.icons` but not in the array |
| List left unsorted | direct sort comparison, names the first offending entry |
| Font hand-edited, truncated, or corrupted in transit | byte count, then sha256 |
| `FILL` axis collapsed to a pinned value | `manifest.axes` vs `MATERIAL_SYMBOL_AXES` — a change no glyph list can reveal |
| Glyph carried with no call site | **warning only**, see below |

> ⚠️ WARNING: the unused-glyph scan is a **substring search, not a resolver.** A name that also reads as an ordinary string — `check`, `info`, `home`, `router` — looks used even when it is not, so the scan can miss dead weight. It must never fail the build over one.

**Stated honestly, this proves the `.woff2` is the file the generator produced for this list and these axes. It does not re-derive the glyphs from the font's own tables**, so a hand-edited font committed alongside a hand-edited manifest would pass. That is not a realistic accident, and it is the price of staying dependency-free.

### How the generator works

`scripts-dev/subset-icons.ts` asks Google Fonts for a CSS file with an `icon_names=` parameter, which performs the subsetting **server side**, then follows the `url(...)` in the response and downloads the WOFF2. Two constraints are load-bearing:

- **`FILL` must stay a range (`0..1`), never a pinned value.** Pinning it collapses the variable axis and the active nav row's filled-glyph affordance silently stops working. The URL requests `opsz,wght,FILL,GRAD@20..48,400,0..1,0`.
- **A desktop `User-Agent` is sent on both requests.** Google serves WOFF2 only to user agents it believes support it.

The full family is roughly 3.4 MB, which is why the subset exists at all: QManager is served *by* the modem, which frequently has no internet, so a `fonts.googleapis.com` link at runtime would render a page of literal words. The subset grew from 19 glyphs / 10.4 KB to **56 glyphs / 20.2 KB** when the boundary moved to include the dashboard.

`MATERIAL_SYMBOL_NAMES` lives in its own **import-free** module on purpose. `subset-icons.ts` is run by bun from `scripts-dev/`, which `tsconfig.json` excludes, so pulling the list out of `material-symbol.tsx` would couple font generation to React and the `@/` path alias. The array is referenced only at type level by the component, so bundlers tree-shake it — verified absent from the production chunks, meaning the modem never downloads the 56 strings.

## The sizing gotcha

`MaterialSymbol` renders a `<span>` and sets `fontSize` as an **inline style**. An inline style outranks any utility class, so a parent's auto-sizing rule that reaches a lucide `<svg>` child does not reach a Material glyph:

| Parent | Rule | Reaches lucide | Reaches MaterialSymbol |
|--------|------|----------------|------------------------|
| `components/ui/badge.tsx` | `[&>svg]:size-3` | yes | **no** |
| `components/ui/empty.tsx` | `[&_svg:not([class*='size-'])]:size-6` | yes | **no** |

A parallel sizing rule for `[data-slot=material-symbol]` would lose to the inline style too, so it is not attempted. **Every Material glyph passes `size` explicitly at its call site**: 12 in a dense chip, 15-17 in a status chip or corner badge, 16 where the glyph is the only channel carrying meaning, 24 in an `EmptyMedia`, 96 in a Network Status orb. Only `pointer-events` ports across, via a parallel `[&>[data-slot=material-symbol]]:pointer-events-none` rule added to both files. Both files carry a comment saying so.

## Dashboard glyph decisions worth keeping

These shipped alongside the icon retarget and are documented in full in `DESIGN.md`; they are summarized here because they are what a reader of this file will be looking at.

### Service ring state table (`network-status.tsx`)

Two orthogonal axes. **Ring tone** tracks RAT quality; **core glyph** tracks service liveness. Amber ring means a *working* connection that is not optimal, not a fault.

| Ring tone | Pulse | Core glyph | Meaning |
|-----------|-------|------------|---------|
| Green | Pulses | `check` | Optimal |
| Amber | Pulses | `check` | LTE without carrier aggregation |
| Amber | Static | `warning` | Searching / Limited |
| Red | Static | `priority_high` | No Service / SIM error / unknown |

The pulse is a **redundant** channel, gated by `isServiceActive`. `prefers-reduced-motion` removes it and the glyph carries the meaning alone. Tone says how bad; motion says whether it is alive, which is what keeps a full-strength red ring from crying wolf.

The rings are built from `--tone-destructive-1/2/3`, new in this change, so all three ramps (success, warning, destructive) are now symmetric. The red branch previously borrowed `surface-container` / `surface-container-high` / `destructive-container` — a neutral grey ramp with one red note — because no destructive tone steps existed. It read as broken chrome rather than as a red state. The governing rule, from the Motion Guide's Service Rings recipe: *build the rings from four explicit tone steps, never from one colour at stacked alpha — stacked alpha composites to a flat disc and the ring structure disappears.*

Orb geometry: a 152px disc with a 96px glyph (up from 74px), leaving roughly 28px of optical padding. 96 is near the ceiling set by the corner badge, which occupies x 110-138 / y 4-32 of the orb box. Re-check that overlap before raising it.

### Identity chips on the Primary Status cards (`signal-status-card.tsx`)

The quality chip's **fill** now carries radio identity via two new `Badge` variants, and its **glyph** carries quality.

| Variant | Renders | Means |
|---------|---------|-------|
| `nr` | `bg-primary-container text-on-primary-container` | 5G NR leg |
| `lte` | `bg-lte-container text-on-lte-container` | 4G LTE leg |

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

> ⚠️ WARNING: `nr` and `lte` are **identity** roles, not status roles. An identity fill says "this is the NR card", never "this is fine". The five status roles (`success`, `warning`, `destructive`, `info`, `muted`) remain the only correct choice for a status indicator.

The rule that generalises, DESIGN.md's **Identity-Chip Rule**: *where a chip carries identity, the quality it also reports must be encoded somewhere non-chromatic.* Here that is the bar count, a five-step monotonic ladder legible in greyscale and under deuteranopia. It is a stronger channel than the fill ever was, since `success-container` and `warning-container` measure 1.03:1 apart.

### Metric rows: 13px, tints, and the `sr-only` word

- **13px is now a documented ramp step**, the dense metric-row step, written `text-[13px]/5`. The explicit `/5` leading is load-bearing: 13px is an arbitrary Tailwind size and would otherwise inherit the card's leading, and pinning the line box to 20px is what holds the row at exactly 40px so the loading skeleton's `h-10` keeps mirroring it (Skeleton-Mirror Rule).
- **Metric value tints stay green/amber/red for both radios.** The design mock tinted some LTE values violet; that was deliberately not followed, because a value's colour is a verdict and a verdict must not change meaning with the radio reporting it. The mock's literal tints were also unusable on contrast grounds: it reaches for the *solid* role tokens, which measure **4.29:1 (`--ok`)** and **3.74:1 (`--wa`)** on `surface-container` in light mode, both below AA. The shipped code uses the darkened `-on-surface` ink steps (5.88 / 5.95). Do not "fix" this divergence from the mock.
- **Every tinted value carries an `sr-only` quality word after it.** `success-on-surface` and `warning-on-surface` measure roughly 1.01:1 apart in light mode — same luminance, hue only — and green and amber converge under deuteranopia, so a "good" SINR and a "fair" SINR were the same grey number to a colourblind technician in sunlight. Identifier rows (Band, ARFCN, PCI, SCS) are untinted and must **not** get one; they have no good-or-bad reading to announce.
- **The card header carries `min-w-0` + `truncate`.** Italian trips it: `"Potenza del segnale"` over `"Nessun segnale"` wrapped one card's header to two lines while its sibling stayed at one, and the paired cards stopped reading as a pair.

## Known Risks

- **The manifest is testimony, not proof.** `icons:check` verifies the font is the artifact the generator reported producing; it does not parse the font's ligature table. A hand-edited font plus a matching hand-edited manifest would pass. Accepted deliberately — the alternative is a font-parser dependency.
- **The unused-glyph scan under-reports.** It is a substring search, so common words (`check`, `info`, `home`, `router`) always read as used. Warning-only by design; never make it fail the build.
- **The generator needs network access** (Google Fonts). It cannot run on the modem, and it cannot run in an offline CI job — which is precisely why the *check* is offline and dependency-free while the *generator* is not. `icons:check` is in `bun run package`; `icons:subset` deliberately is not.

*Resolved:* the two hand-synced glyph lists and the missing `icons:check` gate were both live risks here until the list was collapsed to a single source of truth and the manifest gate landed.

## Related

- `DESIGN.md` > Components > Icons, Status chips, Service rings; Typography > Hierarchy; Migration Sequence step 3d
- `.impeccable/design.json` — the machine-readable copy the design-audit tooling reads. **Keep it in step with `DESIGN.md` in the same change**, or the audit will flag correct code.
- `docs/reference/recent-activities.md` — the dashboard event feed, whose glyphs moved to Material in the same pass
- `docs/reference/carrier-aggregation.md` — the CA strip, also on the dashboard route
