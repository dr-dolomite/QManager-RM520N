# Critique checklist: the measured audit

Run every check against the screenshot **and** the source. A finding only counts when it has four
parts:

1. **A number** measured off the screenshot.
2. **A cause** named in code: the file and the constant, class or prop that produces it, quoted.
3. **The rule** it breaks, by its canon name (`DESIGN.md` / `PRODUCT.md`), or the sibling it has
   drifted from.
4. **A cost**: what it does to the visitor's hunt for their answer.

"Feels unbalanced" is not a finding. "About 90px of nothing between the input and the spec note,
because `FORM.NOTE` in `cell-scanner/shapes.ts` is `mt-auto` and the column is stretched to the
readout's 13rem" is a finding.

Aim for **4–7 findings**. Pick the ones that change the design. If a check finds nothing, skip it
silently rather than reporting a pass.

## Contents

- Measuring from a screenshot
- A. Reading order
- B. Dead bands and what sets each row's height
- C. Controls stretched past their content
- D. Key-to-value distance (Row-Span)
- E. Accidental pairing in row-major grids
- F. Container count per card (One-Nest)
- G. Duplicated messages and errors
- H. Card pairs that should share a row
- I. Scale mismatch between content and card width
- J. Native widget noise
- K. Copy over budget
- L. Status-chip and tag misuse
- M. Icon-boundary and subset violations
- N. Type voice, colour layer, radius, surface
- O. Phone composition
- P. Code provenance
- Q. Apply placement, confirmation and choice controls
- Writing the finding

---

## Measuring from a screenshot

- **Scale.** Get the image size with
  `python -c "from PIL import Image; print(Image.open(r'<png>').size)"`. The user's screenshots
  are usually 1920×1080 at DPR 1, so 1 image px = 1 CSS px. If the width is 2560, 2880 or 3840,
  suspect DPR > 1 and divide. Say "about" for any figure you estimate by eye.
- **Landmarks at 1920 wide.** Read the sidebar and content-column edges off the grid on the first
  shot of a run and reuse them; a full-width card is roughly 1,500–1,600px. Use these to
  sanity-check your own numbers.
- **Precise positions.** Run `scripts/pin_grid.py <png>` for a copy with labelled 5% gridlines,
  view it, and read positions off the grid. Zoom a region with `--crop`. The grid image is for
  authoring only; never embed it.
- **Pin coordinates** are percentages of the image: `left = x / width * 100`,
  `top = y / height * 100`. Put each pin on the element the finding is about, not on its label.
  Keep pins at least 3% apart and at least 2% in from the edges.
- **Cross-check with source.** Tailwind sizes convert as 1 unit = 4px (`gap-5` = 20px,
  `min-h-[13rem]` = 208px). When the screenshot and the class disagree, trust the screenshot and say
  why: stretch, wrap, or a container-query step.

## A. Reading order

The eye starts top-left and follows edges. Check that the question comes before the answer, that
the primary action sits where the input ends (on a card that edits a draft, that is its `CardFoot`,
see Q), and that the first thing seen is the thing the visitor came for.

- *Measure:* the order a first-time eye meets input, action and result.
- *Typical cause:* a two-column split with the result column first (`HERO_SPLIT` with the readout
  on the left), or an action floating mid-card with no edge.

## B. Dead bands and what sets each row's height

For every empty region over about 40px, find the element that *sets* the height:

- `min-h-*` on a sibling column
- `h-full` stretching a column to a taller neighbour
- `mt-auto` pinning something to the bottom
- `items-stretch` on a pair where one card is short and nominates no slack region (Symmetric-Pair)
- a skeleton `min-h` left in place after load (Skeleton-Mirror: a floor is not a mirror)
- a chart with a fixed height over sparse data

- *Measure:* the band's height and width in px, and which states it appears in. A structural band
  shows in every state, including idle.
- *Fix direction:* change which element sets the height. Give the space to content that wants it,
  or move the floating element onto an edge (Manufactured-Edge). Never "reduce padding"
  (Group-Before-You-Pad).

## C. Controls stretched past their content

- Segmented controls or tab lists wider than about 4× their longest label.
- Inputs sized for a phone column running across 1,000px or more.
- A primary button far from the field it submits (not a finding when it is the `SaveButton` in the
  card's `CardFoot`: that distance is the rule, see Q).
- A full-width button on desktop.

- *Measure:* the control's width against its content ("three words, 1,190px; about 400px each").
- *Fix direction:* size to content (`w-fit`, a fixed `grid-cols-[repeat(3,4.5rem)]`), and move the
  control onto an edge beside its label.

## D. Key-to-value distance (the Row-Span Rule)

Receipt rows only work when the key and value read as a pair. Over about 600px of row span, they
don't.

- *Measure:* the px gap between the end of a key and the start of its value, or between a row's
  content and its row action (a delete `×` 1,450px from the value it deletes).
- *Fix direction:* recompose into columns at the card's container step (`@5xl/card:grid-cols-2`),
  move the pair into a narrower card of a pair, or cap the inner list. Don't cap the page.

## E. Accidental pairing in row-major grids

A `grid-cols-4` key/value list flows row by row, so unrelated rows end up side by side (Duplex beside
DL frequency, Uplink range beside EARFCN range). Look for a comparison the layout breaks (DL vs UL,
LTE vs NR, current vs limit) and for pairs the layout implies but the data doesn't.

- *Measure:* which items sit adjacent and what they should sit beside instead.
- *Fix direction:* a small table with real column headers (Downlink / Uplink) and real row keys, or
  a column-major flow.

## F. Container count per card (the One-Nest Rule)

Count the nesting levels. Card, then one `surface-container` well, is the maximum. A tile holding a
bordered box, a note strip inside a hero beside a readout tile, or every list row as its own tile
(ten tiles in a card) all fail.

- *Measure:* the number of inner containers, and the nesting depth.
- *Fix direction:* one well per card, with sections divided by hairlines or a section label. Move
  metadata into a tag in the header.

## G. Duplicated messages and errors

The same fact said in two or more places. For example:

- an error under the field, in the result rail, *and* in a lower card
- a status chip plus a sentence saying the same thing
- a colour that repeats what a badge already says (Neutral-Default)
- a caption that restates the title
- a transient "Applied" / "Saved" chip or success line beside a control whose result also toasts,
  or standing in for the toast (Toast-Confirms: the toast is the only confirmation message; see Q)

- *Measure:* how many times, and where.
- *Fix direction:* one voice, in the region the visitor is already looking at. Keep the field's
  `aria-invalid` ring as the in-place signal. A failure may also leave one persistent line beside
  its field if it sits outside any `aria-live` region, because the toast already announces it.

## H. Card pairs that should share a row

Two cards that are each short, each full width, and related (results + history, status + settings)
are a pair. Check the Symmetric-Pair Rule: equal heights, and each card names one region that absorbs
the slack in every state. If one card has nothing to fill with, it belongs in a full-width band
instead, and the Grid-Step-Costing Rule costs the step against the narrowest cell it produces.

- *Measure:* each card's content width against its card width, and the vertical scroll it costs.
- *Fix direction:* a `grid` at a `@container/main` step (for example
  `@[58rem]/main:grid-cols-[3fr_2fr]`) with `items-stretch`, stacking below it. This is a card grid,
  not a narrowed page, so the Full-Width Page Rule still holds.

## I. Scale mismatch between content and card width

A card whose content is naturally 300–500px wide (one band, a ten-row history, a single toggle)
drawn at 1,500px. The reverse also counts: a dense table squeezed into a third of the width.

- *Measure:* the content's natural width against the card width.
- *Fix direction:* pair it (H), recompose it (D), or give it a sibling. Never `max-w` the page.

## J. Native widget noise

Browser defaults that add a control nobody uses, or break the look in dark mode:

- `type="number"` spinners (use `type="text" inputMode="numeric"`)
- native `<select>` on a Material route
- date inputs
- scrollbars on short lists
- autofill tint

- *Measure:* point at it on the screenshot and name the prop in code.

## K. Copy over budget

Check against `DESIGN.md` > Copy & Help:

- Page description: one sentence, about 100 characters.
- `CardDescription`: one sentence, about 80 characters, or none.
- Hint: about 60 characters.
- Empty state: title, one line, one action.
- `HintIcon`s: about one per settings group, and none by default (the No-Default-Tip Rule).

Also flag copy that restates a label, teaches a convention, or uses `·` glue (the No-Dot-Separator
Rule) or dashes as sentence glue.

- *Measure:* the character count of the offending string, from `public/locales/en/*.json`, not the
  screenshot.
- *Fix direction:* the trimmed string itself, in the mock. A copy change touches all five locale
  packs (`bun run i18n:check` is a parity gate); mention it in "Your call" if it changes meaning.

## L. Status-chip and tag misuse

- **Status** is a filled `Badge` (`success`, `warning`, `destructive`, `info`, `muted`) with a
  mandatory 12px glyph (the Two-Form and Every-Chip-Has-A-Glyph Rules).
- **Identity** (band, radio, width, spec) is an outline `Tag` (`nr`, `lte`, `spatial`, `neutral`).

Flag any of these:

- an outline-and-tint status pill (the retired pattern)
- a status chip with no glyph, or two states in one slot sharing a glyph (Glyph-Carries-The-State)
- an identity hue meaning "healthy" (Identity-Never-Acts)
- every row wearing a filled chip when most are in the expected state (the Quiet-Default Rule)
- an icon in a `CardHeader` (it is a plain `CardTitle` + `CardDescription`; the glyph belongs in a
  `Badge`, a `Tag` or `CardAction`)
- a `Badge` doing a `Tag`'s job, or the reverse
- a fact worth knowing that is neither a fault nor health (a note that applies only sometimes, such
  as "this takes about a minute") drawn as a grey outline (reads disabled), in amber (reads as a
  problem) or in green (reads healthy), instead of a filled `info` Badge with a glyph shown only
  while it applies (Fact-Is-Info, with the Quiet-Default Rule). An `info` chip is
  `bg-primary-container`, so on a promoted `primary-container` row it dissolves; the chip needs its
  own re-ground there (agent memory `reference-info-chip-dissolves-on-primary-container.md`)
- a stroked `variant="outline"` button beside a `SaveButton` (see Q)

## M. Icon-boundary and subset violations

Material Symbols Rounded owns the sidebar, `/dashboard`, the two pre-auth routes (`/`, `/login`) and
the whole `/cellular/` family. Every other route is lucide, and so is every route-agnostic
primitive wherever it mounts (a `Banner`, for one). `HintIcon` is the one exception running the
other way: Material on every route. The Network Status card's lucide SIM/airplane marks and
`react-icons/md` RAT marks are deliberate exceptions. Convert a whole route or none of it.

Flag any of these:

- mixed sets on one screen
- a lucide glyph on an unconverted route (that is correct code, not a defect; don't propose a
  conversion unless the whole route moves)
- a `MaterialSymbol` without an explicit `size` (a parent's `[&>svg]:size-*` can't reach it)
- any glyph your *proposal* needs that isn't in `app/fonts/MaterialSymbolsRounded-subset.json`.
  Check with `grep -c '"<name>"' app/fonts/MaterialSymbolsRounded-subset.json`. A missing glyph
  means `bun run icons:subset`, which needs network access. Put it in "Your call".

## N. Type voice, colour layer, radius, surface

- **Two voices only.** Rethink Sans is the interface and every figure; JetBrains Mono is the machine.
  No third typeface (the Two-Voice Rule).
- **The Machine-Voice tell.** A quantity you read (EARFCN, PCI, band, RSRP, a count, a frequency) is
  Rethink with `tabular-nums`. An opaque string you compare (IMEI, ICCID, IP, MAC, paths, interface
  names, raw AT output, a spec citation) is `font-mono`. Existing `font-mono` on EARFCN, PCI or band
  (for example `IDENT` in `cell-scanner/shapes.ts`) predates the adopted tell: flag it, name the
  constant, and note which sibling routes share it.
- **Tabular-Number Rule.** Every figure that can change on screen is `tabular-nums`.
- **Colour layer.** Colour sits on the reading, not on the furniture (Data-Ink, Three-Layer). Flag a
  large tinted identity block, a value coloured where a badge already carries the colour, and
  **ramp ink on a numeral with no quality bar beside it** (Metric rows / Quality bars: length carries
  magnitude, the glyph carries the stop).
- **Radius.** The role scale only: `rounded-inline` 8, `rounded-field` 10, `rounded-tile` 12,
  `rounded-card` 16, `rounded-hero` 20, `rounded-pill`. Legacy `rounded-{sm,md,lg,xl}` in new work
  is wrong (Role-Radius, Radius-Follows-Size).
- **Surface.** Cards are `border-0` with the `card-sheen` utility in dark (Card-Sheen); a tonal
  container never also carries a border (No-Hairline-On-Fill); a field's fill is one step above its
  host (Field-Step); emphasis promotes a container step rather than adding a wash
  (Highlight-by-Container).

## O. Phone composition

At 390px, check each of these:

- Does anything overflow or scroll sideways?
- Does a split stack in reading (question) order?
- Do tables keep a readable key column?
- Are touch targets at least 44px on coarse pointers?
- Do actions hold an edge?
- Does the pair header wrap asymmetrically (the Truncation-Pair Rule)?

The user has rejected mocks whose phone view "looks rough". Design phone deliberately; don't settle
for whatever the wide layout collapses into.

## P. Code provenance

Findings that come from *reading* the surface rather than looking at it. They are often invisible in
any single file, which is why they survive:

- **Duplicate definitions** with diverging values (four byte-identical pill strings across three
  files, three control heights in one card).
- **Exports with no consumers** (`grep -rlw NAME components app hooks lib`).
- **Retired tokens still consumed**: a token that survives in `app/globals.css`, is read by a few
  files, and appears nowhere in `DESIGN.md`.
- **A floor where canon says pin**: `min-h-*` on a tile or skeleton whose height `DESIGN.md` pins
  (tiles are a pinned 104px; `components/cellular/tile-shape.ts`).
- **An opacity wash where a token exists** (`bg-primary/10` where `primary-container` is the role).
- **Geometry imported across families** instead of restated per family `shapes.ts`.
- **A font fetched at build time.** Fonts are vendored under `app/fonts/` and loaded with
  `next/font/local`; `next/font/google` is a build-time fetch the device cannot rely on, so any
  import of it is a finding.

These usually become rows in the change table rather than pins, unless they also show on screen. Cite
file, line and value.

## Q. Apply placement, confirmation and choice controls

Three rules about what a card does when the user changes something. All three are target rules for
the surface under review: an untouched page that still breaks one is a tracked delta in `DESIGN.md`
Migration Deltas, not a finding, unless the page is the one being reworked.

- **Apply placement (The Card-Foot Apply Rule).** A card that edits a draft commits it from a
  persistent, borderless `CardFoot` row on its own bottom edge: status on the left, then Discard or
  another secondary action (ghost or `tonal-neutral`), then the `SaveButton` last on the right. The
  row has no divider line and a fixed height. Flag:
  - a Save or Apply floating mid-card, beside a field, or in a sticky or page-level bar under the
    grid
  - a footer that mounts only when something is dirty, so the card jumps (an idle card shows Apply
    disabled with its reason)
  - a divider line above the row, or shadcn `CardFooter` with its own border
  - status on the right, or the `SaveButton` not last
  - Discard, Cancel or Restore drawn as a stroked `outline` button
  - a plain `Button` doing a `SaveButton`'s job

  Exempt: dialogs and wizards (their own `DialogFooter`), per-row and inline actions, operational
  actions that are not a draft commit (start a scan, send a message, download a profile). Field
  errors stay with their field, not in the footer.
  - *Measure:* the distance from the commit control to the card's bottom edge, and whether the row's
    height changes between idle, dirty, applying and failed.
  - *Fix direction:* move the commit into `CardFoot` and delete the bar.
- **Confirmation (The Toast-Confirms Rule).** Every user-initiated mutation that finishes (save,
  apply, a persistent toggle, add, delete, reset, install, copy) fires one `toast.success` or
  `toast.error`: plain `sonner`, one sentence through `t()`, from the handler that owns the action,
  at the terminal moment. The failure reason comes from the call's returned result, never from
  `error` state read after an `await`. Copy goes through `lib/clipboard.ts` `copyText`. Flag:
  - a fading "Applied" or "Saved" chip, or an inline success line standing in for the toast
  - a handler that toasts success without checking the returned result, or reads the reason from
    stale `error` state
  - a toast for polling, background work, a draft edit or Discard
  - a hard-coded English toast string
  - a raw `navigator.clipboard` call in a changed handler

  One exception: a mutation that ends in navigation or a reload (the reboot hand-off, a password
  change) or advances a wizard step keeps that transition as its success signal and still toasts a
  failure. `SaveButton`'s own Saving/Saved state and a persistent status line stay.
  - *Measure:* count the places a result is announced; the answer is one.
- **Choice controls (Segmented pills).** On/off preferences and short mutually exclusive choices use
  the shared `SegmentedField` pill, never a bare `Switch`. Flag, on a new or redesigned surface only,
  a `Switch` for a boolean preference, or a `Select` or radio group for two to four short exclusive
  options. The pill is sized to content (section C) and drops to a `Select` below its container
  breakpoint, so check the narrow case too. The primitive is `components/ui/segmented-field.tsx`: the
  caller passes the check glyph, so a lucide route can use it without crossing the icon boundary.

## Writing the finding

The findings list in the artifact uses this shape:

```html
<li><span class="n">3</span><div><b>A three-word control 1,190px wide</b><span>Auto, LTE and NR each get about 400px, because <code>FORM.TABS</code> is <code>w-full grid-cols-3</code>. A segmented control that wide stops reading as one control (Row-Span).</span></div></li>
```

- **Title:** a concrete claim with the number in it, sentence case, under about 60 characters.
- **Body:** one or two sentences. What you measured, the cause in `<code>` (file or constant and
  its value), the rule in brackets or in words, and why it slows the hunt.
- **Order:** reading order down the page, so pin numbers run top-left to bottom-right.
- Use the same number on the pin and the list item.
