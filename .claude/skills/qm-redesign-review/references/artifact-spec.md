# Artifact spec: the anatomy of a redesign review page

The output is one self-contained HTML page, published through the Artifact tool. Start from
`assets/template.html`, which already has every section, token block and style listed here. Skim
`assets/exemplar-frequency-calculator.html` as the worked reference, on this repo's own Frequency
Calculator.

## Contents

- Page skeleton (sections in order)
- Section 0: Header (the reframe)
- Section 1: Where it reads rough today
- Section 2: Proposed layout (demo bar, stage, mock)
- Section 3: Before and after
- Section 4: What changes
- Section 5: Kept as is / Your call before build
- Tokens, fonts, theming
- Shipped geometry
- Mock craft rules
- Data realism
- Hard rules (the at-rest checklist)

---

## Page skeleton (sections in order)

```
<title>{Page} Review</title>            two to four words, a name, never "X: explainer"
<meta name="viewport" …>                without it a phone lays the page out at 980px
main.doc
  header.doc-head                       0. route eyebrow, h1, the reframe in one sentence
  section#h-now                         1. Where it reads rough today
  section#h-new                         2. Proposed layout
  section#h-ba                          3. Before and after
  section#h-chg                         4. What changes
  section.cols2                         5. Kept as is | Your call before build
script                                  state machine, width toggle, theme toggle
```

Keep the doc chrome terse. The user's standing preference is "No need for much explanation inside
the artifact. All that matters is the design." Each section gets its `h2` and at most one lede
sentence. Put no prose between the mock and the table.

## Section 0: Header (the reframe)

- **Eyebrow:** the route, in mono (`/cellular/cell-scanner/frequency-calculator`).
- **h1:** "{Page}, polished" for a polish, "{Page}, redesigned" for a re-authoring. Which one is
  decided by the evidence test in `SKILL.md` step 3, not by ambition.
- **One sentence: the reframe.** Lead with the question the page answers and what the current
  layout does to it, then the headline moves. Not a list of tweaks. For example: "The page answers
  one question, what frequency is this channel, and today the answer arrives before the question;
  the anchor stops fighting its own height, the band detail reads as downlink against uplink, and
  bands and history share one row."

## Section 1: Where it reads rough today

The part the user values most.

- **Lede:** what the screenshot shows ("Pins mark the live page at 1920px with channel 150
  calculated.").
- **Figure:** the screenshot as a base64 data URI (`__SHOT__`, embedded by `scripts/finalize.py`),
  with numbered `.pin`s at percentage coordinates and a caption naming the theme. Set the `img`
  `width`/`height` to the real pixel size. A phone screenshot goes in a second
  `figure.shot.phone-shot` with its own pins, continuing the numbering.
- **Findings:** the numbered evidence list, an `ol.findings` in pin order, 4–7 items. Each names the
  number, the file or constant with its value, the rule, and the cost (`critique-checklist.md` >
  "Writing the finding"). Code-provenance findings with no on-screen position (checklist P) go in
  the change table instead of here, so pins and findings stay one to one.
- On wide screens the shot takes 7fr and the findings 5fr. Below 1000px they stack.

## Section 2: Proposed layout

- **Lede:** one sentence saying what works in the mock and what is sample data.
- **Demo bar:**
  - **State** chips cover **every state the surface really has**: idle or empty, loading if it
    matters, the typical result, applying/in force/partial where the surface has a pipeline, one or
    two edge cases that stress the layout, and error. A surface shown only in its happy state is not
    designed. Name chips with real content ("LTE 150", "NR 627264, two bands"), not "State 2". The
    default chip starts pressed.
  - **Width:** Wide | Phone (390px). Phone is the narrow-width column: `.qm` is a real
    `container: main`, so the toggle shows the container query resolving, the same way the app does.
  - **Theme:** Auto | Light | Dark. Both themes are first-class; a proposal that shows one is half a
    proposal.
- **Stage:** `.stage > .frame#frame > .qm`. Cards declare `container: card` for card-local steps.
- **The mock itself:**
  - the QManager page header (`h1` plus a muted one-line description, the real `en` strings unless
    you're trimming them)
  - then the cards, full width of the stage, with no `max-w` on the page
  - It must be **interactive**: forms compute, toggles toggle, rows respond. Wire state-dependent
    regions through one `render()`, so a state chip and a real interaction land in the same place.

## Section 3: Before and after

The single clearest carrier of what changed: **one row or one component**, rendered twice at the
same width, today's version on the left (above on phone) and the proposal beside it.

- **Reconstruct "before" honestly, from the real class strings.** Translate the shipped Tailwind
  classes into the template primitives value for value, and print the key class string under it in
  `<code>` (for example `HISTORY_ROW.ROOT`: `rounded-tile bg-surface-container p-4`).
- **"After"** uses the same primitives as the mock and names the constant it becomes.
- Pick the component where the change is densest (a history row, a band tile, a settings row). One
  pair only.

## Section 4: What changes

- **Lede:** the scope fence in one or two sentences. Name any shared constant you're deliberately
  *not* editing, and why.
- **Table:** Change | Why | Where. One row per change, ordered as the reader meets them.
  - **Change:** a short noun phrase. Append `<span class="new">new</span>` when the row adds
    behaviour or content the page doesn't have today.
  - **Why:** the finding it fixes or the rule it follows, by name, with numbers where they help. One
    or two sentences. Say when a row **upholds** an existing code decision and quote it.
  - **Where:** real file names and constants in `<code>`. Every file and constant must exist in the
    repo now unless marked new (`grep` it).
- The table sits in `.tbl-wrap`, which scrolls horizontally on its own. The page never does.

## Section 5: Kept as is / Your call before build

- **Kept as is:** 3–5 items, each a bold noun plus one sentence. The scope's other half: what
  already works (shell, motion, state contracts, copy that's fine), what is deliberately untouched
  because it is already migrated (data model, CGI contract, pipelines), and an icon line saying
  whether every glyph is in the subset.
- **Your call before build:** first the one or two **veto-worthy decisions** (say upheld or
  overturned), then every `new` row, every copy change that alters meaning (all five locale packs
  move), any missing glyph that needs `icons:subset` (network), any real bug found out of scope,
  and any choice between two good options. Phrase each as a question with the recommended answer
  implied.

## Tokens, fonts, theming

- **Declared must equal shipped.** Tokens come from `app/globals.css`, which is normative, and are
  copied **verbatim**: no eyeballed hexes, no conversion out of OKLCH. The app themes with a `.dark`
  class; the artifact themes by the Artifact contract instead. So:
  1. the `:root` values from `globals.css` go verbatim into the artifact's bare `:root` block
  2. the `.dark` values go verbatim into `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`
  3. and again, identically, into `:root[data-theme="dark"] { … }`

  `body` gets an explicit background. The template mirrors `globals.css` under the app's own
  variable names, so `bg-surface-container` maps to `var(--surface-container)`. Before each run,
  re-grep the names it uses from both blocks of `globals.css` and fix any drift in all three
  artifact blocks. A token you add goes in all three.
- **Mock-only tokens** (`--seg-on`, `--seg-shadow`) derive from a primitive's classes, not from
  `globals.css`; the template says which. Keep them few and labelled.
- **Fonts** load from Google Fonts only: Rethink Sans, JetBrains Mono and Material Symbols Rounded.
  That's the one external host the Artifact CSP admits for fonts. The app vendors Rethink Sans and
  the icon subset itself; don't let the artifact suggest otherwise. `finalize.py` fails any other
  family.
- **Voices** (the Two-Voice Rule):
  - Rethink Sans (`var(--font-sans)`) for everything human: headings, body, labels, and every
    figure, with `font-variant-numeric: tabular-nums`. The `.num` class does that.
  - JetBrains Mono (`var(--font-mono)`, the `.mono` class) for opaque strings: IMEI, ICCID, IP,
    MAC, paths, interface names, spec citations, raw AT output. EARFCN, PCI and band are quantities
    and take `.num` (the Machine-Voice tell).
- **Icons:**
  - Material Symbols ligatures that exist in `app/fonts/MaterialSymbolsRounded-subset.json`, on
    routes inside the Material boundary (sidebar, `/dashboard`, `/`, `/login`, `/cellular/**`).
  - On lucide routes (`/local-network/**`, `/monitoring/**`, `/system-settings/**`,
    `/about-device`, `/support`, onboarding), draw small inline SVGs in lucide's style (24px
    viewBox, 2px round stroke). A mock that crosses the boundary proposes a violation.
  - `HintIcon` stays Material on every route, lucide routes included.

## Shipped geometry

Copy these, not approximations. Check the family `shapes.ts` for its own values first.

| Thing | Value |
|---|---|
| Pill action | 42px (`Button size="action"`), 20px padding, 600 weight |
| Quiet toolbar pill | 36px (`PILL_QUIET`: `h-9 px-3.5 text-xs font-semibold`) |
| Dialog action | 40px |
| Field | 42px, `rounded-field` 10px, no rest border, fill one step above its host via the primitive's `host` prop |
| Glyph disc | 52px tile (`TILE_SHAPE.DISC`), 44px block, 40px row |
| Tile | 104px, **pinned** not floored, `rounded-tile` 12px |
| Metric row pill | 40px, 13px/600 key and value on a 20px line box |
| Quality bar | 8px, one thickness everywhere; 56px lane when inline |
| Radius scale | 8 / 10 / 12 / 16 / 20 / pill (`inline`, `field`, `tile`, `card`, `hero`, `pill`) |
| Card | `rounded-card` 16px, padding 24px; hero `rounded-hero` 20px, padding 28px; `border-0` |
| Chip and tag box | `px-2 py-0.5 text-xs font-medium`, 1px border (transparent on a chip), 22px |
| Badge glyph | 12px (`size-3` / `BADGE_GLYPH_SIZE`) |
| Touch floor | 44px on coarse pointers |

## Mock craft rules

The mock has to look like the app after the change, not like a generic dashboard. Use the template
primitives. They mirror `components/ui/*`:

- **Cards:** `border-0`, a tonal step from the page, `card-sheen` in dark, the radius and padding
  above.
- **Card header:** `CardTitle` plus a one-line `CardDescription`. Actions go on the header's right
  edge (`.sh-m`). Never an icon in the title.
- **Nesting:** at most one inner `.well` per card, divided into `.part`s by hairlines or section
  labels.
- **Rows:** receipt rows (`.rows`), key hard left, value hard right. Default values are quiet
  (`.v.quiet`).
- **Badges and tags:** status is a filled `.badge` with a glyph; identity is an outline `.tag`.
- **Controls:** at most one primary per card. Segmented controls are sized to content. Numeric
  inputs use `type="text" inputmode="numeric"`.
- **Quality:** ramp ink on a numeral only with its 8px bar beside it.
- **Motion:** `standard` (600ms, `cubic-bezier(0.2,0,0,1)`) for state changes, `quick` (360ms) for
  hovers and label swaps, entrance fades with a 6px rise, nothing over 800ms. No overshoot, no exit
  animations. `prefers-reduced-motion` turns it all off.
- **Recompose on wide cards.** Put side by side what the phone stacks: the `.pair` grid at `58rem`
  of main, `.cols` at 48rem of card. Name the Tailwind step you're imitating in the "Where" column.
- **Phone:** design it, don't just let it collapse. Splits stack in reading order, tables keep a
  narrow key column, long numbers don't overflow, touch targets are at least 44px, and hover-only
  affordances are visible under `@media (hover: none)`.

## Data realism

- **Use real content.** Real routes, `en` catalog strings, band names, units, and the user's own
  values from the screenshot. Never lorem ipsum, "Value", or "Item 1".
- **Compute derived data with the real formulas and show them working.** The exemplar implements
  the 3GPP EARFCN and NR-ARFCN arithmetic (TS 36.101 §5.7, TS 38.104 §5.4.2.1). Other pages have
  their own: `signalToProgress()` quality windows and `QUALITY_GLYPH` stops, byte formatting, cycle
  projections. Port the real one.
- **Examples must be possible on the target modem.** The RM520N-GL is the reference target; per
  device facts (including the RG501Q-EU) live in `docs/reference/platform-matrix.md`, and the
  router's feature doc says what a surface supports. Don't mock a capability those mark absent or
  retired. When unsure, leave it out and say so in the lede.
- **Label sample data as sample.** Never let a mock imply a live reading.

## Hard rules (the at-rest checklist)

`scripts/finalize.py` checks the mechanical ones. The rest are yours:

1. **Complete at rest.** The default state chip shows a representative result, every section is
   filled, and no placeholder remains.
2. **Declared equals shipped, both themes.** Tokens verbatim in all three blocks. Check any colour
   literal in both themes; the pins and their dark halo are the only deliberate literals.
3. **No horizontal page scroll at 390px.** Only `.tbl-wrap` may scroll sideways. Watch long mono
   strings (`overflow-wrap: anywhere`) and fixed-width grids.
4. **Mock copy obeys the Copy & Help budgets:** page description about 100 characters, card
   description about 80, hint about 60, empty state title plus one line plus one action, no `·`
   glue, no em dashes.
5. **No invented hardware claims.** See Data realism.
6. **Data is real or computed.** See Data realism.
7. **Single file.** No external scripts beyond the allowed CDNs (none are needed). The screenshot is
   a data URI. The whole page stays under 16MB.
8. **No repo edits.** The artifact proposes changes. The build runs later on the normal change flow.
