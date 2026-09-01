// =============================================================================
// Dashboard — shared geometry contract
// =============================================================================
// The `/dashboard` family's FIRST shapes module, and it is the pre-step of the
// design-language adoption pass for a reason: every later step imports from
// here, so no step after this one has anywhere to restate a number.
//
// The dashboard has essentially no TOKEN drift — DESIGN.md was written FROM
// this surface. All of its drift is GRAMMAR: one card shell spelled out three
// times in three files, one row pill spelled two ways, a clock interval
// declared twice, and a tile geometry the rest of the product hoisted into a
// shared module years of surfaces ago. Every one of those is a place two
// authors can disagree without either of them being wrong, which is exactly
// what a shapes module removes.
//
// -----------------------------------------------------------------------------
// WHY THE TILE GEOMETRY IS RESTATED RATHER THAN IMPORTED
// -----------------------------------------------------------------------------
// `components/cellular/tile-shape.ts` holds the identical tile box, and this
// file deliberately does NOT import it. `/dashboard` is a separate route family
// and must not reach into `components/cellular/`; the ethernet, custom-dns,
// ttl-mtu, ip-passthrough and traffic-engine modules all restate their geometry
// from each other for the same reason. What is shared is the SYSTEM's numbers,
// not a module. The values below are the system's, verbatim:
//
//   104px pinned tile   28px radius   52px disc   36px card   40px row
//
// -----------------------------------------------------------------------------
// THREE DIVERGENCES THIS MODULE RECORDS RATHER THAN SILENTLY NORMALISES
// -----------------------------------------------------------------------------
// Each belongs to a later step of the pass. Writing them down here is what
// stops the next reader re-deriving them from scratch — and, more usefully,
// stops them "fixing" one in isolation and finding out afterwards that the
// skeleton beside it was mirroring the old number.
//
//   1. `device-status.tsx` writes the row pill with `px-[15px]` where the other
//      two sites use `px-4` (16px). `ROW` standardises on `px-4`; device-status
//      is NOT re-pointed here. Step 03 owns that file.
//
//   2. `signal-history.tsx` is a grid PEER (`rounded-card`) but padded `px-7`,
//      which is the HERO padding, with a comment defending the mock's 28px.
//      The pass resolves that in favour of `px-6` so the card matches its
//      row-mates; step 08 owns the re-point, not this step.
//
//   3. `TILE` is minted at the system's 104px pinned geometry and has NO
//      consumer yet. The dashboard's only current tiles are device-status's
//      62px uptime pair, which are not migrated here — step 03 owns them. An
//      export with no call site is expected at this point in the pass, not an
//      oversight.
//
// -----------------------------------------------------------------------------
// GEOMETRY ONLY — NO JSX
// -----------------------------------------------------------------------------
// This is a `.ts` file, like all thirteen of its siblings. Components that need
// a home of their own get one: `PillRow` lives in `./pill-row.tsx` and consumes
// `ROW` from here.
// =============================================================================

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/**
 * The route wrapper. Container queries on this surface key off `@container/main`.
 *
 * Declared here so the route's own `app/dashboard/page.tsx` and any later band
 * read one spelling; the page file is not re-pointed in this step, because a
 * re-point is only provably zero-visual-change when the string it replaces is
 * byte-identical, and that is the bar every re-point in step 00 had to clear.
 */
export const PAGE_ROOT = "@container/main";

/**
 * The page grid, verbatim as shipped.
 *
 * It mixes a viewport breakpoint (`lg:px-6`, the page gutter — which is the one
 * sanctioned use of a viewport breakpoint) with a container query for the
 * column count. That is kept EXACTLY as it is: this step is the foundation
 * step, and it changes no card's rendered geometry. Re-reading the gutter is
 * not step 00's call to make.
 */
export const PAGE_GRID =
  "grid grid-cols-1 gap-6 px-4 lg:px-6 @4xl/main:grid-cols-5";

/**
 * The bands the single entrance cascade staggers over.
 *
 * Five direct children, 120ms apart, tail at 480ms — comfortably inside the
 * poller's measured ~3.7–4.0s cycle, so the cascade is finished long before the
 * first data swap can compete with it.
 *
 * `TOP` is a nested grid with the SAME column count and gutter as `PAGE_GRID`,
 * so wrapping the hero column and the device column into one cascade child
 * changes the tree without changing a single resolved column width.
 */
export const BAND = {
  /** Anything that owns a whole page row. */
  FULL: "col-span-full",
  /** The hero + device-information band, restating the page grid one level down. */
  TOP: "col-span-full grid grid-cols-1 gap-6 @4xl/main:grid-cols-5",
  /** The hero column: 3 of 5 once the container is wide enough to split. */
  HERO_COL: "grid gap-4 col-span-1 @4xl/main:col-span-3",
  /** The device-information column: the remaining 2 of 5. */
  SIDE_COL: "col-span-1 @4xl/main:col-span-2 h-full *:data-[slot=card]:h-full",
  /** The LTE/NR carrier pair inside the hero column. */
  CARRIERS: "grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4",
  /** Metrics / Latency / Recent Activity — the three cards that share a shell. */
  TRIO:
    "col-span-full grid grid-cols-1 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3 grid-flow-row gap-4",
  /**
   * Makes a grid cell stretch its Card to the row height.
   *
   * The `*:data-[slot=card]:h-full` half only works while the `Card` is the
   * DIRECT child of the cell — which is why the skeleton overlays on this
   * surface live inside their cards rather than wrapping them.
   */
  STRETCH: "h-full *:data-[slot=card]:h-full",
} as const;

// -----------------------------------------------------------------------------
// Page header
// -----------------------------------------------------------------------------

/**
 * The route heading, matching the pattern every other route family already has:
 * an h1, a description, and a rail slot on the end for status chips.
 *
 * `DESC` is `text-on-surface-variant`, and it is written as a plain `p` rather
 * than reaching for `CardDescription`: that primitive hardcodes
 * `text-muted-foreground`, which is a retired ink on this surface — every
 * dashboard card already speaks its secondary text in `on-surface-variant`.
 */
export const HEADER = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TEXT: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  /**
   * Where the Radio / Internet / Stale chips land. It owns the row and its gap;
   * `DashboardStatusRail` renders `display: contents` so the spacing has one
   * home rather than two nested flex boxes.
   */
  RAIL: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/**
 * The grid-peer card shell.
 *
 * `gap-4`, not the mock's literal 14px. This is the gap between a card's title
 * and its body, and it is the one measurement that reads ACROSS the three cards
 * sharing the trio row — so 14px would set one card 2px out of step with the
 * card beside it to gain fidelity nobody can see. The 14px inner rhythm between
 * metric groups is kept where the mock's value is doing real work.
 *
 * `border-0` is explicit: a tonal surface never also carries a hairline (The
 * No-Hairline-On-Fill Rule). `h-full` is redundant against the grid's own
 * `STRETCH`, but it is redundant identically in all three trio cards, and a
 * shell that differs from its neighbours reads as intent.
 *
 * THE WHISPER SHADOW IS A KNOWN TIE, and this constant does NOT resolve it.
 * `card.tsx` ships `shadow-sm`, and `cn()` cannot dedupe the two: tailwind-merge
 * cannot tell whether an arbitrary shadow value is a box-shadow or a shadow
 * COLOUR, so both classes survive the merge and the winner is Tailwind's
 * deterministic name sort. The sibling families fix this per call site with a
 * trailing important marker. It is deliberately NOT added here, because this
 * string is byte-identical to the three shipped shells it replaces and adding
 * the marker would make step 00 a visual change. Later steps own that call.
 */
export const CARD_SHELL =
  "@container/card h-full gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]";

/**
 * The anchor card on the surface — `rounded-hero` (40px) rather than
 * `rounded-card` (36px), 28px padding rather than 24px, and one step more
 * breathing room between its groups.
 *
 * There is exactly ONE hero per surface, by definition. A grid full of heroes
 * is a grid with no anchor.
 */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 px-7 py-[26px] shadow-[var(--shadow-whisper)]";

/**
 * A card's title.
 *
 * `CardTitle` ships only `leading-none font-semibold` and takes its size from
 * the call site, so an unsized one inherits 16px and flattens the surface's
 * type ramp.
 */
export const CARD_TITLE = "text-lg font-semibold";

/** A card's supporting line, in the surface's secondary ink. */
export const CARD_DESC = "text-on-surface-variant text-sm leading-relaxed";

// -----------------------------------------------------------------------------
// Rows and meters
// -----------------------------------------------------------------------------

/**
 * The 40px metric row: label left, value right, on a tonal pill.
 *
 * The height is arithmetic, not a pin: `py-2.5` (10px either side) plus a 20px
 * line box is exactly 40, which is why `HEIGHT` can be a literal `h-10` and
 * still be a true mirror (The Skeleton-Mirror Rule). Nothing here needs a fixed
 * height, so nothing gets one — the value cells all carry `shrink-0` and the
 * key cell truncates.
 *
 * `px-4`. `device-status.tsx` writes the same pill at `px-[15px]`; see
 * divergence 1 in the header note — step 03 re-points it, not this step.
 *
 * `KEY` and `VALUE` are the row's TYPE, minted here and consumed from step 03
 * onward. They are 13px on a 20px line box, which is the ramp step below the
 * card title's supporting text and the reason a row of eight reads as a table
 * rather than as eight sentences. `PillRow` still writes its key cell inline
 * today at the shipped `text-sm`, because step 00 changes nothing that renders.
 */
export const ROW = {
  ROOT: "flex items-center justify-between gap-3 rounded-pill bg-surface-container px-4 py-2.5",
  /** Mirrors ROOT's resolved height, for the skeleton. */
  HEIGHT: "h-10",
  KEY: "text-[13px]/5 font-semibold",
  VALUE: "text-[13px]/5 font-semibold",
} as const;

/**
 * The figure in a metric row or meter group.
 *
 * `on-surface`, never a role colour: the row sits on `surface-container` and
 * text on a container takes that container's own ink (The Container-Pair Rule).
 * Colour on this surface belongs to glyphs and bars, not to figures.
 */
export const VALUE_CLASS = "text-sm font-semibold text-on-surface";

/**
 * The meter track height, shared by a loaded bar and its skeleton slot so the
 * handoff moves nothing.
 *
 * It mirrors `MetricBar`'s ONE track height — the product resolved to a single
 * 8px bar on 2026-09-01, so there is no size prop left for this to drift
 * against.
 */
export const METER_H = "h-2";

/**
 * The focus ring for a BARE trigger — a hand-rolled button or a tooltip
 * trigger. Anything built on `Button` already carries the project ring.
 *
 * `focus-visible:transition-shadow` rather than a base `transition-shadow` is
 * the Motion Guide's "focus is never animated AWAY" clause spelled in CSS: a
 * transition is read off the state being moved TO, so on blur the element
 * reverts to a base with no transition and the ring simply stops existing.
 *
 * Every custom property here uses the v4 parenthesis shorthand. Tailwind v4
 * dropped the bare-var arbitrary form — writing a custom property inside square
 * brackets without wrapping it — and that spelling compiles to a declaration
 * whose value is the property NAME rather than its value. The class is still
 * generated, so grepping finds it and tsc, eslint and next build all pass; only
 * the emitted CSS tells, and what it says is that the transition never runs.
 */
export const FOCUS_RING =
  "rounded-pill outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:transition-shadow focus-visible:duration-(--duration-quick) focus-visible:ease-quick";

/**
 * The down/up pair's shared treatment.
 *
 * Down and up are the one place a SOLID role colour is right on a container:
 * they are accent glyphs, not text, and the figure beside each keeps the
 * container's own ink. Both take the `-on-surface` variant, which is the tinted
 * ink token sized for a plain card rather than for a filled chip.
 *
 * Two rows consume this after step 06 — Data Used, and the speed-test result —
 * and they are the reason it is a constant at all. Download was `text-primary`
 * here once, which is the 5G NR identity hue on a figure counting every byte
 * received on any radio; upload has been Uplink Cyan all along while the
 * speedtest surfaces painted it Carrier Violet. A pair rendered two ways on one
 * page is precisely the drift this module exists to prevent.
 *
 * `SIZE` is passed EXPLICITLY at every call site. `MaterialSymbol` sets its
 * font size inline, so no utility class can override it, and inside a `Badge`
 * or a `SwapLabel` the parent's glyph sizing cannot reach it anyway.
 */
export const DIRECTION = {
  DOWN: {
    ICON: "arrow_circle_down",
    CLASS: "shrink-0 text-downlink-on-surface",
  },
  UP: {
    ICON: "arrow_circle_up",
    CLASS: "shrink-0 text-uplink-on-surface",
  },
  SIZE: 20,
  FILLED: true,
} as const;

// -----------------------------------------------------------------------------
// Tiles
// -----------------------------------------------------------------------------

/**
 * The glance tile: a 52px glyph disc beside an eyebrow → value → caption
 * column, in a 28px-radius block PINNED at 104px.
 *
 * It is PINNED because a floor made the skeleton's mirror a lie. Measured on
 * the sibling strips before that correction: a two-leg tile resolved to 118px,
 * a single-carrier one to 98, a degraded one to 95 — all against a skeleton
 * mirroring a 92px floor, a 26px jump at the handoff. A floor cannot be a
 * mirror; only a pin can. Nothing clips at the pin, because the eyebrow, value
 * and caption all truncate.
 *
 * No consumer yet — see divergence 3 in the header note.
 */
export const TILE = {
  /** Grid wrapper. Container queries, never viewport breakpoints. */
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The text column inside ROOT. */
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  EYEBROW:
    "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]",
  /**
   * The figure. `tabular-nums` in the UI face and NEVER `font-mono`: a tile
   * value is a live measurement or a category, and neither is an identifier the
   * device emits verbatim — which is the only thing the Machine-Voice Rule
   * sends to mono.
   */
  VALUE:
    "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums",
  CAPTION: "text-on-surface-variant truncate text-xs",
} as const;

/**
 * The quality-bar lane in a measurement row.
 *
 * 56px and `shrink-0`, so the bar's LENGTH is comparable from row to row —
 * which is the whole point. DESIGN.md rests the five-stop ramp on length
 * precisely because adjacent stops sit below the CVD separation floor, so a
 * lane that resizes with its neighbour's text would take the one channel the
 * ramp may not lose. The bar centres in the same 20px line box its row already
 * has, so adding a lane does not change the row's height.
 */
export const LANE = "w-14 shrink-0";

// -----------------------------------------------------------------------------
// The hero orb
// -----------------------------------------------------------------------------

/**
 * The three hero orbs — one geometry, two sizes, ONE ratio.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS IS A PROPERTY AND NOT TWO SETS OF NUMBERS
 * -----------------------------------------------------------------------------
 * The service orb is four concentric absolutely-positioned discs — an outer
 * ring, two inner rings and a core — and their sizes only mean anything
 * RELATIVE to each other. Shipped, they were 152 / 112 / 80 / 48, which is
 * 1 : 0.7368 : 0.5263 : 0.3158.
 *
 * Adding a second size by re-typing four numbers is four chances to get one of
 * them wrong, and a wrong one fails nothing that would tell you: not the build,
 * not the typecheck, not a screenshot. It just makes the stack very slightly
 * not concentric, at one width, on one device class. So `--orb` carries the
 * size and every other dimension below is a `calc()` against it. There is one
 * number to change and the proportions cannot drift.
 *
 * -----------------------------------------------------------------------------
 * WHY THE COMPACT SIZE IS FLUID RATHER THAN A FLAT 92px
 * -----------------------------------------------------------------------------
 * Below the card query the orbs sit 3-across, and three 92px discs plus their
 * gaps do not fit a hero card on a 320px phone: the page gutter and the card's
 * own `px-7` leave ~232px of content there, against 3 × 92 + 2 × 12 = 300.
 * A flat 92 would overflow exactly the device class R3 exists for.
 *
 * `min(92px, 28cqw)` reads 92px wherever the card has ~329px of content and
 * degrades below it, so the cap is the design value and the query unit is only
 * the fallback — not the other way round. At the narrowest realistic card it
 * resolves to ~65px against a 69px ceiling, which is the fit this ratio was
 * chosen to clear.
 *
 * ⚠️ `cqw` AND THE SIZE QUERY BOTH MEASURE THE CONTENT BOX, not the border box.
 * `HERO_SHELL` declares `@container/card` and carries `px-7`, so a 624px card
 * queries as 568. This was measured, not assumed, and it corrected this
 * module's first draft twice: the threshold below had been pushed one step up
 * on border-box arithmetic that said three full-size orbs would not fit a
 * 512px card. Against the content box they fit with 24px to spare, and the
 * step-up had simply stopped firing at widths where the full orbs belong.
 *
 * -----------------------------------------------------------------------------
 * THE PULSE SURVIVES THE SCALING FOR FREE
 * -----------------------------------------------------------------------------
 * `animate-pulse-ring` is a `scale(0.82) → scale(1)` keyframe. A transform
 * scale is proportional by construction, so it reads identically at 92px and at
 * 152px and needed no second tuning. Had it been written in px it would have.
 */
export const ORB = {
  /**
   * Declares `--orb` for a whole orb grid. Must sit on an ancestor of both the
   * loaded orbs and their skeletons, which is why `GRID` carries it — the two
   * then read one source and the handoff moves nothing.
   *
   * The step-up is `@lg/card` (512px of CONTENT — see the content-box note
   * above). Three 152px discs plus two 16px gaps need 488px, so they clear it
   * with 24px to spare, and the full-size orbs come back at the width they
   * were designed for.
   */
  SCALE: "[--orb:min(92px,28cqw)] @lg/card:[--orb:152px]",
  /**
   * Three across at EVERY width. Stacked, the orbs ran ~456px of disc plus
   * three label blocks — roughly 600px before the reader reached anything else,
   * on the surface built for a thirty-second glance beside the modem.
   */
  GRID: "grid grid-cols-3 place-items-center gap-3 @lg/card:gap-4",
  /** One orb's box, shared by the real orb and its skeleton. */
  BOX: "size-[var(--orb)]",
  /**
   * The glyph inside an orb — 0.6316, i.e. 96 in the full 152 disc.
   *
   * 96 leaves ~28px of optical padding; 74 left 39px, which read as a small
   * mark floating in a large disc rather than as a single object. The ceiling
   * is set by the corner badge, not by taste: the badge occupies x 110–138 /
   * y 4–32 of the full-size orb box, and at 96px the widest glyph's ink still
   * clears it. Do not raise this ratio without re-checking that overlap.
   */
  GLYPH: "size-[calc(var(--orb)*0.6316)]",
  /** The ring stack, outward in. 1 / 0.7368 / 0.5263 around a 0.3158 core. */
  RING_1: "size-[var(--orb)]",
  RING_2: "size-[calc(var(--orb)*0.7368)]",
  RING_3: "size-[calc(var(--orb)*0.5263)]",
  CORE: "size-[calc(var(--orb)*0.3158)]",
  /**
   * The corner badge's disc and its inset, on the same ratio — with a FLOOR.
   *
   * The floor is the one place the ratio is deliberately broken, and it is not
   * a taste call. The badge glyph is what carries ok/warn/fail when colour
   * cannot: `success-container` and `warning-container` measure 1.03:1 apart
   * and are the same surface under deuteranopia, so DESIGN.md's Every-Chip-Has-
   * A-Glyph contract rests on that mark being READ. Pure proportion put it at
   * 14px on a 76px orb, which is below the size at which a check and a cross
   * are reliably told apart. Scaling wins down to 20px; legibility wins below.
   */
  BADGE:
    "size-[max(20px,calc(var(--orb)*0.1842))] top-[calc(var(--orb)*0.0263)] right-[calc(var(--orb)*0.0921)]",
  /**
   * The badge's lift. Deliberately NOT a token: it is a one-off elevation on a
   * small disc, and the whisper shadow is a card-level shadow, not this one.
   */
  LIFT: "shadow-[0_2px_6px_oklch(0.20_0.05_262_/_0.25)]",
  /**
   * Font sizes for the Material glyphs that must scale with the orb.
   *
   * `MaterialSymbol` sets `fontSize` as an inline style from its numeric
   * `size`, which no utility class can override — so a class alone cannot
   * scale these three, and this is the one place on the surface where that
   * matters. The component spreads its `style` prop AFTER `fontSize`, so a
   * call site passes `size` for the optical-size axis and overrides the font
   * size here.
   */
  SYMBOL: {
    BODY: "calc(var(--orb)*0.6316)",
    /** Floored with its disc above, and for the same contrast reason. */
    BADGE: "max(12px,calc(var(--orb)*0.1118))",
    CORE: "calc(var(--orb)*0.1447)",
  },
  /**
   * The `size` numbers those three call sites still pass, for the `opsz`
   * variable axis. They are the FULL-size figures: `opsz` is clamped to the
   * subset's 20..48 range, so the two larger ones are already saturated and
   * only the badge glyph could differ — by an amount below the threshold at
   * which the axis changes a stroke.
   */
  OPSZ: { BODY: 96, BADGE: 17, CORE: 22 },
  /**
   * The label block beneath an orb. It steps with the disc: three 92px columns
   * cannot hold "4G Carrier Aggregation" at 16px without wrapping to four
   * lines, which would give back the vertical space the smaller orb just saved.
   */
  LABEL: {
    ROOT: "flex flex-col gap-[3px] text-center",
    TITLE:
      "justify-center text-sm leading-tight font-semibold text-balance @lg/card:text-base @lg/card:leading-none",
    SUB: "justify-center text-xs text-on-surface-variant text-balance @lg/card:text-sm",
  },
} as const;

// -----------------------------------------------------------------------------
// Clocks
// -----------------------------------------------------------------------------

/**
 * How often a relative timestamp re-evaluates.
 *
 * A label like "14 min ago" is a function of TIME, not of the payload, so it
 * cannot be left to re-render only when a fetch lands: the status endpoints
 * return byte-identical cached results between changes, React bails out of the
 * re-render, and the label sits frozen at whatever it said when the result
 * first arrived — a card asserting "just now" about data an hour old.
 *
 * 30s rather than the 10s poll: nothing on this surface changes faster than a
 * minute, and an idle dashboard should not wake three times as often as it
 * needs to.
 *
 * It was declared independently in two files before this module existed, which
 * is exactly how two cards on one page end up disagreeing about what "just now"
 * means.
 */
export const CLOCK_TICK_MS = 30_000;
