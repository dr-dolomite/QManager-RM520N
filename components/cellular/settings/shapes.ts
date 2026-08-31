import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// =============================================================================
// Cellular settings — shared geometry and tone contract
// =============================================================================
// Single source of truth for this surface family's shapes. Every consumer
// imports from here, INCLUDING the skeletons — a skeleton that restates a
// number has left the contract (The Skeleton-Mirror Rule).
//
// SCOPE. This began as the contract for Cellular Basic Settings alone. It now
// governs five routes under `/cellular/settings/`: the basic settings page,
// APN Management, Network Priority, IMEI Settings and Blocked Networks. The
// four latecomers were each carrying their own hand-rolled geometry (legacy
// `rounded-xl`, `text-muted-foreground`, `bg-muted/30` washes) — adopting this
// file is what makes them one surface rather than four that merely sit under
// one nav group. Anything genuinely shared belongs here; anything true of ONE
// page stays in that page's own module.
//
// This file exists because the surface it replaces had the defect in miniature:
// the loading branch of `cellular-settings-card.tsx` hand-restated `h-4 w-36`
// and `h-9 w-full` per field, and its skeleton `CardTitle` read "Cellular Basic
// Settings" while the loaded card read "Modem Radio Settings" — a visible title
// swap on every load, invisible in review because the two strings sat 46 lines
// apart. Naming both from one place is what stops that recurring.
//
// -----------------------------------------------------------------------------
// RADIUS MAPPING FROM THE APPROVED COMP
// -----------------------------------------------------------------------------
// The comp is drawn in raw pixels; this surface ships the role scale. The map is
// by SHAPE ROLE, not by nearest number:
//
//   comp 32px  card shell        -> `rounded-card`  (36px)
//   comp 26px  row group         -> `rounded-tile`  (28px)
//   comp 22px  promoted row      -> `rounded-field` (20px)
//   comp 999px chips, segments   -> `rounded-pill`
//
// A promoted row is deliberately a step TIGHTER than the group that contains it.
// Radius-Follows-Size means the inner thing is rounder-per-pixel but smaller in
// absolute radius; matching the group's 28px would make the promoted row read as
// a sibling of its own container.
//
// -----------------------------------------------------------------------------
// THE TONE RULE ON THIS SURFACE
// -----------------------------------------------------------------------------
// Rows stay NEUTRAL at rest and while dirty. The DELTA_CHIP ("SIM 1 -> SIM 2")
// is the row's one indicator of an unsaved edit — a `bg-primary` pill is
// already the brand acting, and repeating that signal as a full-row
// `primary-container` fill restated the same fact twice on one row.
//
// This was a promote-on-dirty container fill until 2026-08-30: see
// docs/reference/cellular-settings-family.md's "Rows are neutral..." section
// for the retired rule and why it existed. Removing it also retired every
// `_ON_FILL` control twin it required (`SEGMENTED.SEGMENT_ON_FILL` /
// `.TRACK_ON_FILL`, `SELECT_TRIGGER_ON_FILL`, `FIELD_SHELL_ON_FILL`) — a
// control never needs an ink pair for a container it can no longer sit on.
//
// No row carries a border. Separation between rows is a hairline DIVIDER inside
// the group (`bg-surface-container-high`).
// =============================================================================

// -----------------------------------------------------------------------------
// Page + card shells
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-6 p-2";

/**
 * The two-column body. The comp runs 1.35fr / 1fr; expressed here as a
 * container query so it responds to the content column rather than the window
 * (the sidebar expanding must not restack the page).
 *
 * NO `items-start`. CSS grid's default `align-items: stretch` is what we want
 * here (DESIGN.md's Equal Heights rule) — the right column (AMBR + modem
 * reports) should rise to match the settings card's height rather than
 * leaving it visibly taller. `CARD_CELL` below is what actually carries that
 * stretch down into each `Card`.
 */
export const PAGE_GRID =
  "grid grid-cols-1 gap-4 @4xl/main:grid-cols-[1.35fr_1fr]";

/**
 * Wraps a grid cell so the stretched row height reaches the `Card` inside it.
 * A grid cell stretches by default, but a block child does not inherit that
 * as its own height unless told to — see DESIGN.md > Layout > "Equal heights
 * are explicit".
 */
export const CARD_CELL = "h-full *:data-[slot=card]:h-full";

/** A card on this surface. Peer role — no hero anchor here. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 28px, matching the sibling `/cellular/` surfaces. */
export const CARD_PAD = "px-7";

/**
 * A peer card's title: the Title step (18px), plus the truncation pair.
 *
 * `CardTitle` ships only `leading-none font-semibold` and takes its size from
 * the call site, so an unsized one inherits 16px — which is what these cards
 * shipped, leaving them the same size as the hero anchor above them and
 * flattening the surface's whole type ramp.
 *
 * `min-w-0` is the other half. These two cards are peers in a grid and are
 * height-locked to each other by `CARD_CELL`; without it a long title in one
 * locale (Italian is the one that trips it) pushes its own header box wider
 * than the grid track instead of wrapping inside it. It WRAPS rather than
 * truncating — a card title that silently loses its last word is worse than a
 * two-line one — which is why `leading-none` has to go with it.
 */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

// -----------------------------------------------------------------------------
// Band A — the live-state strip
// -----------------------------------------------------------------------------

/**
 * The four glance tiles that replaced the 826-line "Current Connection" hero.
 *
 * WHY A STRIP AND NOT A CARD. The hero asked the wrong question. A settings
 * surface is opened to answer "what is this modem set to, and what happens if I
 * touch this?" — the hero instead led with AMBR, the network-granted rate
 * ceiling, across two of its three columns. AMBR is the most specialist number
 * on the page, is not settable anywhere on it, and none of the six writable
 * fields can move it. Eighteen distinct facts rendered in one card.
 *
 * THE RAIL RAN A GENERATION THE FAMILY DELETED TWICE. `HERO_RAIL_TONE.NR` was
 * `bg-primary text-primary-foreground` painted across a full-width block.
 * `radio/summary-tiles.tsx` documents five generations of exactly that shape:
 * Gen 2 measured it live at 623x212 = 132,033px^2 carrying 9,526px^2 of ink
 * (7.2%) and called it "a large empty purple slab"; GEN 5 REMOVED BODY TINT
 * ENTIRELY — "Every tile body is now NEUTRAL_TILE and the disc is the only
 * coloured element on the strip." The hero's own JSDoc cited that file as its
 * precedent while running the composition it had abandoned. So the geometry
 * comes from `components/cellular/tile-shape.ts` (the 104px pin, the 52px disc)
 * and the tone rule comes with it: `BODY` is the only body fill on this strip,
 * and every hue lives on a `DISC_*` key.
 *
 * ONE CLOCK. Every fact in a tile is read from the poller snapshot, which ticks
 * continuously, so the freshness chip in `HEAD` is honest about the whole band —
 * which is what the retired `HERO_FOOTNOTE` existed to apologise for. The rate
 * ceiling, which runs on the settings GET and does not tick, is a separate band
 * with its own provenance line (`RATE_CEILING` below). No surface here holds two
 * clocks.
 *
 * THE SIM TILE DELIBERATELY OVERLAPS THE `sim_slot` CONTROL BELOW IT, and that
 * is the point rather than a duplication: the tile reports the slot the modem is
 * ON (poller), the control holds the slot the user has ASKED FOR (settings).
 * During the ~35s slot apply they legitimately disagree, and a technician needs
 * to see both. The two facts the hero really did render twice — radio power and
 * the active slot as read-only `ParamRow`s over the same `saved` object the
 * control below was bound to — are gone.
 *
 * THE EMPTY STATE IS PER TILE, not a branch of the strip. A modem with no
 * carrier name, no APN and no aggregation is a fully successful read of a real
 * device state; each tile states its own absence as a fact ("No carrier
 * reported") rather than the band collapsing into one empty screen. The strip's
 * own third state is a FAILED read, which takes `NOTICE_*`.
 */
export const STRIP = {
  /** The band header. Label left, freshness chip pushed right by `mr-auto`. */
  HEAD: "flex items-center gap-3 px-1 pb-0.5",
  /** "Live state" — the thing the freshness chip is a property OF. */
  HEAD_LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  /** The tile's text column, inside `TILE_SHAPE.ROOT`. */
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  EYEBROW:
    "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]",
  /**
   * The figure. `tabular-nums` and NOT `font-mono`: a slot number and a carrier
   * count are changing figures, not identifiers (The Machine-Voice Rule).
   * `min-w-0` rather than `truncate` — this is a flex container, so the
   * truncation has to happen on the text child (`VALUE_TEXT`).
   */
  VALUE:
    "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums",
  /**
   * The same figure when it is an IDENTIFIER the device emits verbatim — the
   * APN, and nothing else on this strip. Mono is wider per glyph, so it drops a
   * step to keep a 21-character APN inside the 104px tile.
   */
  VALUE_MONO:
    "flex min-w-0 items-center gap-2 font-mono text-[1.125rem] font-bold leading-[1.1] tracking-[-0.01em]",
  /** The truncating text child of either VALUE box. */
  VALUE_TEXT: "truncate",
  CAPTION: "text-on-surface-variant truncate text-xs",
  /**
   * Every tile body on this strip, with no exception and no `tone` prop to make
   * one — see the Gen 5 note above. Making the wrong thing unreachable is
   * cheaper than a comment asking nobody to do it.
   */
  BODY: "bg-surface-container text-on-surface",
  /** The glyph inside `TILE_SHAPE.DISC`. */
  GLYPH: 28,
  /**
   * Disc fills, and the ONLY colour on the strip. Each is a FILL pair
   * (`bg-X` + `text-X-foreground`), never a container pair — the disc is the one
   * element small enough to want a strong fill, and the pair is never crossed.
   *
   * An UNIDENTIFIED radio (`network.type === ""`) takes the neutral disc. It
   * must never claim the 5G blue (The Identity-Chip Rule).
   */
  DISC_NR: "bg-primary text-primary-foreground",
  DISC_LTE: "bg-lte text-lte-foreground",
  DISC_SPATIAL: "bg-spatial text-spatial-foreground",
  DISC_NEUTRAL: "bg-surface-container-high text-on-surface-variant",
  /**
   * A FAILED read. The band keeps the family box and goes neutral rather than
   * shimmering: a skeleton is a promise that data is on its way, and holding one
   * indefinitely over a dead poller is the misstatement this whole re-authoring
   * was done to remove. No freshness chip renders beside it — there is no
   * reading for one to be a property of.
   */
  NOTICE_SPAN: "@xl/main:col-span-2 @5xl/main:col-span-4",
  NOTICE_TITLE: "truncate text-lg font-semibold",
} as const;

// -----------------------------------------------------------------------------
// Band A2 — the rate-ceiling disclosure
// -----------------------------------------------------------------------------

/**
 * AMBR, demoted from headline to a summary line with the per-bearer detail
 * behind a disclosure.
 *
 * The governing pair is always visible, because "what will the network let this
 * connection do" is a legitimate glance question. The per-bearer table for both
 * radios is not: it is two blocks of two figures plus a DNN, for a fact no
 * control on this page can change. It opens on click.
 *
 * THIS BAND OWNS ITS OWN CLOCK AND SAYS SO. The figures come from the settings
 * GET, read on mount and re-read only around a save — they do not tick. The
 * retired `HERO_FOOTNOTE` carried that admission for a card whose freshness chip
 * described a different data source entirely; here the provenance line sits
 * under the numbers it is about, and no chip on this band claims liveness.
 *
 * THE PANEL ANIMATES `grid-template-rows`, WHICH IS NEITHER TRANSFORM NOR
 * OPACITY. `<MotionConfig reducedMotion="user">` collapses transform movement
 * for motion/react components and cannot see a CSS grid transition, so the
 * consumer must call `useReducedMotion()` and drop `PANEL_MOTION` itself. Same
 * mechanism and same reason as the frequency-locking skeleton (4b4d688).
 */
export const RATE_CEILING = {
  ROOT: "overflow-hidden rounded-tile bg-surface-container",
  /**
   * The always-visible summary. A real `<button>`, so it is keyboard-reachable
   * and announces its own expanded state.
   */
  SUMMARY: "flex w-full items-center gap-3.5 bg-transparent px-5 py-4 text-left",
  /**
   * A 40px disc — one step below the strip's 52px, because this is a summary
   * line and not a tile, and the size difference is what says so.
   *
   * DOWNLINK ROSE, not an identity hue. A rate ceiling belongs to no radio: the
   * summary shows whichever radio governs, and painting the disc after that
   * radio would make the same band change colour on a handover. `bg-downlink`
   * is the direction axis (`RATE_CHIP` documents why it exists), and the
   * download figure is the one this line leads with.
   */
  DISC: "grid size-10 flex-none place-items-center rounded-pill",
  DISC_RATE: "bg-downlink text-downlink-foreground",
  /** The same disc on a FAILED read — neutral, never a hue over absent data. */
  DISC_NEUTRAL: "bg-surface-container-high text-on-surface-variant",
  GLYPH: 22,
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  EYEBROW:
    "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]",
  /** The governing pair, and the tag naming which radio it belongs to. */
  VALUE:
    "flex min-w-0 flex-wrap items-center gap-2 text-[1.125rem] font-bold leading-[1.1] tracking-[-0.01em] tabular-nums",
  CHEVRON:
    "text-on-surface-variant ml-auto flex-none transition-transform duration-[--duration-standard] ease-[--ease-standard]",
  CHEVRON_OPEN: "rotate-180",
  /**
   * The 0fr -> 1fr row. The row VALUE is set at the call site (it is state, not
   * geometry); this carries the clock, and is dropped entirely under reduced
   * motion.
   */
  PANEL: "grid",
  PANEL_MOTION:
    "transition-[grid-template-rows] duration-[--duration-emphasized] ease-[--ease-emphasized]",
  /** `min-h-0` is what lets the 0fr row actually collapse. */
  PANEL_CLIP: "min-h-0 overflow-hidden",
  INNER: "grid grid-cols-1 gap-3.5 px-5 pb-5 @2xl/main:grid-cols-2",
  /**
   * One radio's block. `bg-surface` INSIDE `bg-surface-container` — the panel is
   * the container and the block steps back DOWN to the page ground, which is
   * what keeps two nested neutrals legible without a hairline.
   *
   * `rounded-field` (20px) is a step tighter than the panel's `rounded-tile`
   * (28px), per Radius-Follows-Size: the inner block is rounder per pixel and
   * smaller in absolute radius. It is deliberately NOT an identity container
   * fill — inside a disclosure that is already about one governing radio, two
   * tinted blocks re-introduce exactly the "large empty slab" the strip above
   * was rebuilt to delete. Identity is an outline `Tag` in the block header
   * instead (The Two-Form Rule), which is also the channel that survives
   * grayscale.
   */
  BLOCK: "flex flex-col gap-2.5 rounded-field bg-surface p-4",
  /**
   * The block heading, a step BELOW `RATE_CEILING.EYEBROW`'s parent value. 14px
   * bold, not the hero's 18px: inside a panel that is already introduced by the
   * summary line above it, an 18px heading competes with the figure it is
   * subordinate to.
   */
  BLOCK_TITLE: "min-w-0 truncate text-sm font-bold",
  /** The in-force marker, pushed to the block header's end. */
  BLOCK_MARK: "ml-auto flex-none",
  /** The band's provenance sentence, and each block's own. */
  PROVENANCE: "text-on-surface-variant text-xs leading-[1.6] text-pretty",
  /**
   * Mirrors the summary row's resolved height for the skeleton: `py-4` either
   * side (32) over a 40px disc, which is taller than the eyebrow + value column
   * (16 + 3 + 20 = 39). 72px -> 4.5rem, and the radius travels with it (The
   * Skeleton-Mirror Rule).
   */
  HEIGHT: "h-[4.5rem] rounded-tile",
} as const;
// -----------------------------------------------------------------------------
// The governing-block marker
// -----------------------------------------------------------------------------

/**
 * Which rate block governs the bearer the modem is actually using.
 *
 * WHY THIS EXISTS. LTE AMBR governs `LTE` and `5G-NSA` (NSA's NR leg is a
 * secondary carrier on the LTE-anchored PDN, with no AMBR of its own); NR5G
 * AMBR governs `5G-SA` only. The old hero encoded that by rendering exactly
 * one block. Rendering both is a better read — the user can see what each
 * radio would grant — but it drops the fact that only one of them is in force,
 * and that fact has to come back somewhere.
 *
 * IT MUST NOT COME BACK AS A HUE ALONE, and it must not come back as a STATUS
 * ROLE at all. `success` would claim health, and governance is not health — an
 * idle radio's rate ceiling is not "degraded", it is simply not the one in
 * force (The Functional-Color Promise). So the marker is a GLYPH plus a WORD in
 * two shapes: a filled chip against plain inline text. Both survive grayscale
 * and deuteranopia, which is what lets the chip also carry the block's radio
 * hue without that hue being load-bearing.
 *
 * THE CHIP WEARS ITS BLOCK'S RADIO FILL PAIR, which is now the only place a
 * radio hue is filled anywhere in the disclosure — the blocks themselves went
 * neutral, and their identity is an outline `Tag`. A `bg-lte` chip on a
 * `bg-surface` block is a fill on a ground, the pairing the tile discipline
 * already uses; it declares both halves, so consumers set no ink.
 *
 * ABSENCE IS NOT THE SIGNAL. The non-governing block states its state in
 * words too. A marker that only ever appears once would leave the other block
 * ambiguous between "not in use" and "we didn't check".
 */
export const GOVERNING_MARK = {
  CHIP: "inline-flex h-[1.375rem] flex-none items-center gap-1.5 rounded-pill px-2.5 text-[0.6875rem] font-semibold",
  ON_LTE: "bg-lte text-lte-foreground",
  ON_NR: "bg-primary text-primary-foreground",
  /** The non-governing state: no chip, no fill, the block's own ink dimmed. */
  IDLE: "inline-flex flex-none items-center gap-1.5 text-[0.6875rem] font-semibold opacity-90",
  GLYPH: 13,
} as const;

/** Glyphs. Both already in the font subset — this change adds no glyph. */
export const GOVERNING_GLYPH = {
  governing: "check_circle",
  idle: "do_not_disturb_on",
} as const satisfies Record<string, MaterialSymbolName>;

// -----------------------------------------------------------------------------
// The per-slot SIM chip (dual-slot readout)
// -----------------------------------------------------------------------------

/**
 * One physical SIM slot in the live-state strip's SIM tile caption: which slot,
 * and the tail of the card sitting in it.
 *
 * IT RENDERS THE SLOT THE TILE IS NOT ABOUT. The tile's own value states the
 * slot the modem is switched to, as read from the POLLER; this chip states what
 * is in the other one, as read from the SETTINGS GET. The two sources are
 * allowed to disagree for the ~35s a slot apply takes, which is why the ACTIVE
 * leg below is not dead code: during that window `dual_slot` reports the new
 * slot active while the poller still reports the old one, and a chip that could
 * only render the standby form would flatten a real, temporary, visible fact.
 *
 * `bg-primary` on ACTIVE is correct against `STRIP.BODY`
 * (`surface-container`) — a fill on a container, never a container on a
 * container.
 *
 * THIS IS `GOVERNING_MARK` ONE ROW DOWN, and it is deliberately built to the
 * same rule rather than to a status role. "The modem is switched to this slot"
 * is not a health claim — a standby SIM is not degraded, and an empty second
 * slot is a configuration, not a fault — so `success` / `muted` are both wrong
 * answers here (The Functional-Color Promise). The operative peer is marked
 * exactly as the governing AMBR block is: a FILLED CHIP with its own glyph,
 * against PLAIN INLINE TEXT with a different glyph. Shape, glyph and fill all
 * move together, so the pair survives grayscale and deuteranopia.
 *
 * The fill pair declares its own ink, so consumers set none.
 *
 * ABSENCE IS NOT THE SIGNAL — the peer slot always renders, empty or not. A
 * readout that showed only the slot in use would leave the other ambiguous
 * between "empty" and "not read", which is the whole reason this chip exists.
 * The one case where nothing renders is `dual_slot` being ABSENT from the GET,
 * which is the honest "the modem cannot answer this at all".
 */
export const SLOT_CHIP = {
  /** The slot the modem is switched to. */
  ACTIVE:
    "inline-flex h-[1.375rem] flex-none items-center gap-1.5 rounded-pill bg-primary px-2.5 text-[0.6875rem] font-semibold text-primary-foreground",
  /** Every other slot: no chip, no fill, the column's quieter ink. */
  IDLE: "text-on-surface-variant inline-flex flex-none items-center gap-1.5 text-[0.6875rem] font-semibold",
  /**
   * The masked ICCID tail. A raw device-emitted identifier, so `font-mono`
   * (The Machine-Voice Rule) — and `tabular-nums` because it sits beside a
   * second slot's tail and the two should align.
   */
  ICCID: "font-mono tabular-nums",
  GLYPH: 13,
} as const;

/**
 * Glyphs for a slot chip. Presence and activity are ONE glyph slot, not two: a
 * 13px chip has room for a single mark, and the tail text beside it already
 * states occupancy in words when a slot is empty.
 *
 * All three are in the font subset — this change adds no glyph.
 */
export const SLOT_GLYPH = {
  /** Switched to, card present. */
  active: "check_circle",
  /** Card present, standing by. */
  present: "sim_card",
  /** No ICCID reported for this slot. */
  empty: "sim_card_alert",
} as const satisfies Record<string, MaterialSymbolName>;

/** The page-header action pill. Restated, not imported — see custom-profiles. */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/**
 * The glyph inside a `PILL_ACTION`.
 *
 * Named rather than typed at each call site. Blocked Networks carried `17` in
 * three places and `14` in a fourth for what are two roles, not four sizes —
 * the kind of drift a per-family shapes module exists to make impossible.
 */
export const PILL_ACTION_GLYPH = 17;

/**
 * The compact action that rides INSIDE a `TonalBanner`'s copy.
 *
 * A banner's CTA cannot be a `PILL_ACTION`: at 42px it out-weighs the sentence
 * it belongs to and pushes the banner's own height past the card row it sits
 * above. 32px on the Label step is the shorter twin, and it keeps the pill
 * radius so it still reads as the same family of control.
 *
 * Promoted here because the byte-identical string had been typed three times
 * across this family — twice on APN Management, once on the settings index —
 * which is the exact count that made `sms/shapes.ts` worth extracting. The
 * third site adds `underline-offset-4` and is deliberately NOT swept in with
 * this change: it is on another route, and a near-identical string is a
 * judgement call rather than a mechanical one.
 */
export const BANNER_ACTION =
  "h-8 rounded-pill px-3 text-xs font-semibold";

/**
 * The action row that sits BELOW a `ConditionScreen`, inside the same card.
 *
 * Centred rather than trailing, because a condition screen is centred and a
 * right-aligned action under a centred block reads as belonging to something
 * else. Stacked below the card's own `@lg/card` step so a phone gets full-width
 * targets — this is the one place on the surface where the primary action is
 * destructive and irreversible.
 */
export const CONDITION_ACTIONS =
  "flex flex-col gap-2.5 @lg/card:flex-row @lg/card:justify-center";

/**
 * An inline text link inside a `CardDescription`.
 *
 * `--primary` is the only hue in this system that acts (DESIGN.md > Identity),
 * so a link is brand-inked by construction. The pill focus ring is what keeps
 * it consistent with every other focusable thing on the surface; a default
 * browser outline on a rounded surface is the "browser default that belongs to
 * no design system" this pass exists to remove.
 */
export const INLINE_LINK =
  "text-primary inline-flex items-center gap-1 rounded-pill font-medium underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** The glyph inside an `INLINE_LINK` — sized to the 14px body it rides on. */
export const INLINE_LINK_GLYPH = 14;

/**
 * A standing footnote beneath a card — a fact about how the feature works that
 * is always true, rather than a condition that arose.
 *
 * DELIBERATELY NOT A `TonalBanner`. A banner IS its state ("the tint is the
 * message"), and this note has no off state: a permanently-tinted block is
 * wallpaper, and wallpaper in a functional role spends a container the system
 * reserves for states. So it sits on the neutral container step and borrows
 * `ConditionScreen`'s own neutral disc pair, which keeps the two neutral blocks
 * on one surface reading as the same voice.
 *
 * `text-sm`, not the 12.5px consequence step. This is a standalone paragraph,
 * not a line riding under a row label — and DESIGN.md's Don'ts name 13px prose
 * outside a dense metric row explicitly. `on-surface-variant` is what demotes
 * it, not a smaller size.
 */
export const CARD_FOOTNOTE = {
  ROOT: "flex items-start gap-3 rounded-tile bg-surface-container px-4 py-3.5",
  DISC: "bg-surface-container-high text-on-surface-variant grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: 18,
  BODY: "text-on-surface-variant min-w-0 text-sm leading-relaxed text-pretty",
} as const;

// -----------------------------------------------------------------------------
// The settings row group (the Pixel Settings pattern)
// -----------------------------------------------------------------------------

/**
 * One tonal group holding hairline-separated setting rows.
 *
 * `p-1.5` (6px) matches the comp's group padding and is what lets a promoted row
 * inset visibly rather than reaching the group's edge. Without it the promotion
 * fill is flush and reads as the group changing color, not the row.
 */
export const ROW_GROUP = {
  ROOT: "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5",
  /**
   * The hairline between two rows. Inset from the group edge so it reads as a
   * separator rather than a full-bleed rule. Hidden adjacent to a promoted row.
   */
  DIVIDER: "mx-4 h-px bg-surface-container-high",
} as const;

/**
 * One setting row.
 *
 * -----------------------------------------------------------------------------
 * THE DELTA CHIP RIDES THE LABEL'S LINE. IT USED TO OWN ONE.
 * -----------------------------------------------------------------------------
 * The chip ("SIM 2 -> SIM 1") was previously rendered UNCONDITIONALLY on its own
 * line between the label and the consequence, merely going `invisible` when the
 * row was clean. That bought a dirty-state-independent height, and it cost 28px
 * of permanent blank between a title and the sentence explaining it — which read
 * as two unrelated blocks rather than one decision, and is what a reviewer saw
 * on the shipped page.
 *
 * The chip now sits INSIDE `LABEL_ROW`, beside the label, on a row that is
 * `items-center` and `min-h`-floored to the chip's own 1.375rem. An invisible
 * chip is zero-width and shorter than the label's line box, so on every row this
 * surface actually renders it adds NOTHING to the height in either state — the
 * reservation is still there, it is just horizontal now.
 *
 * The residual, stated rather than hidden: the label is allowed to WRAP
 * (`min-w-0`, never truncated — clipping a setting's name is worse than a
 * reflow), so a text column narrow enough that `label + chip` will not fit on
 * one line can still gain a line on promotion. That needs the longest shipped
 * label (Italian, "Rilevamento sostituzione SIM a caldo", ~270px) beside the
 * ~120px chip inside a text column under ~400px, which happens only on a phone.
 * The old failure was a guaranteed 30px jump at 760px AND 1500px body width;
 * this one is a possible 22px jump in one locale at one size, and the control
 * is stacked BELOW the text there rather than `items-center` beside it, so it
 * does not half-shift the segmented thumb the way the old one did.
 *
 * -----------------------------------------------------------------------------
 * HEIGHT
 * -----------------------------------------------------------------------------
 * A `min-h` FLOOR on ROOT, not a fixed height — the consequence line wraps to
 * two lines on narrow containers and a fixed height would clip it. Derived, not
 * guessed: label row 22 + gap 4 + consequence 20 = 46, plus `py-4` x2 = 78 ->
 * 5rem. The old floor was 6.125rem and included the chip's retired line; keeping
 * it would have left the 28px the chip vacated sitting under every row instead
 * of between the title and its sentence, which is the same blank moved rather
 * than removed.
 */
export const SETTING_ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /** Mirrors ROOT's resolved floor, for the skeleton. */
  HEIGHT: "h-[5rem]",
  /**
   * The label + consequence column.
   *
   * `flex-1` is load-bearing, not cosmetic. With `min-w-0` alone this column
   * will shrink to zero against a `flex-none` control, and the consequence
   * sentence then wraps to ONE WORD PER LINE — a ~500px tall row. Caught on
   * screen, not in review: it only appears when the control happens to be wide
   * (an untranslated label, a long locale, four segments), so the layout looks
   * fine right up until it doesn't. `flex-1` makes the text claim its share
   * first; `min-w-0` still lets it wrap rather than overflow.
   *
   * `gap-1` (4px) is the whole vertical distance between a title and the
   * sentence that explains it. They are one unit; the group's own hairlines are
   * what separate one decision from the next.
   */
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  /**
   * The label's own line, carrying the delta chip beside it.
   *
   * `min-h` matches `SETTING_ROW_DIRTY.DELTA_CHIP`'s height so the row cannot
   * breathe when the chip appears, and `items-center` is what puts a 22px pill
   * on the optical centre of a 22.5px line box rather than on its baseline.
   */
  LABEL_ROW: "flex min-h-[1.375rem] min-w-0 items-center gap-2",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The one-line consequence. This is the sentence that makes a settings row a
   * decision rather than a field — it is required on every row, not optional.
   */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The control cluster. `@2xl/card:ml-auto` right-aligns only once side by side. */
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
} as const;

/**
 * The line a write card shows INSTEAD of its rows when the modem was never
 * read — one quiet sentence occupying exactly one row's slot inside the group.
 *
 * WHY IT EXISTS. The card's loading branch is `isLoading || !draft || !settings`,
 * and on a failed read `isLoading` goes false while `settings` stays `null`. So
 * both write cards held their skeleton FOREVER, shimmering with no explanation —
 * a skeleton is a promise that data is on its way, and this is where that promise
 * is broken. Same defect the hero fixed with its `unavailable` branches
 * (now `STRIP.NOTICE_TITLE`), arriving one card over.
 *
 * IT IS DELIBERATELY QUIET, NOT A SECOND ALARM. The route shell already renders a
 * `destructive` `TonalBanner` with the retry action when `error` is set; the page
 * says "Couldn't read the modem" once, and a card repeating it in a functional
 * role would say it three times on a page with two cards. This states only why
 * THIS card has nothing to show — no glyph, no chip, no role colour.
 *
 * A LATER failure does not use this branch. The hook leaves the previous
 * snapshot in place on a failed re-read, so the card keeps rendering real values
 * and the banner is what says they may be stale. Only the never-read case has
 * nothing to draw.
 *
 * GEOMETRY IS COMPOSED, NEVER RESTATED. It wears `SETTING_ROW.ROOT`'s own box
 * (radius, padding, the 5rem floor) and `SETTING_ROW.CONSEQUENCE`'s ink and
 * size, so the card holds its height and the notice cannot drift from the rows
 * it replaces.
 */
export const CARD_NOTICE = `${SETTING_ROW.ROOT} ${SETTING_ROW.CONSEQUENCE}`;

/**
 * Tone for a row holding an unsaved edit. The row itself no longer promotes —
 * `DELTA_CHIP` is the sole indicator now, so this is a single-key object
 * rather than a retired name; see the shapes.ts header's Tone Rule note.
 *
 * `CONSEQUENCE_ON_FILL` also survives as a general ink-on-`primary-container`
 * utility for a PERMANENT accent block unrelated to row dirtiness — see
 * `imei-tools-card.tsx`'s check-digit cell. Do not read its name as implying a
 * dirty row; it predates that block and the block kept it.
 */
export const SETTING_ROW_DIRTY = {
  /** Ink for text sitting on a permanent `bg-primary-container` block. */
  CONSEQUENCE_ON_FILL: "text-[0.78125rem] leading-relaxed text-pretty opacity-90",
  /**
   * The "before -> after" chip. Machine-voice: these are literal setting values,
   * so `font-mono` is correct here and nowhere else in the row.
   *
   * IT RIDES THE LABEL'S LINE inside `SETTING_ROW.LABEL_ROW`, and is rendered on
   * a clean row too (with `invisible`, which keeps the element and drops its
   * width to zero). `flex-none` so it is never the thing that shrinks — a
   * half-width "SIM 2 -> S…" states the wrong pending value. See `SETTING_ROW`
   * for why the line it used to own is gone and what the residual is.
   */
  DELTA_CHIP:
    "inline-flex h-[1.375rem] w-fit flex-none items-center rounded-pill bg-primary px-2.5 font-mono text-[0.6875rem] font-semibold text-primary-foreground",
} as const;

// -----------------------------------------------------------------------------
// The segmented control
// -----------------------------------------------------------------------------

/**
 * Track + segment geometry for the pill group that replaces a Select on binary
 * and three-way choices.
 *
 * The active fill is a TRAVELLING `motion.span` carrying an instance-scoped
 * `layoutId` (see `signal-history.tsx:302-315`). Two rules ride on that:
 *   1. Nothing animates `width` — motion tweens the box between positions.
 *      Segments have unequal label widths, so a cross-fade would visibly jump.
 *   2. The `layoutId` MUST be scoped per instance. This surface renders SIX
 *      segmented controls at once — three rows in each of two write cards, not
 *      three in one card as this comment used to say; sharing an id makes their
 *      thumbs fly across each other on first paint.
 *   3. EVERY SEGMENT RESERVES THE CHECK GLYPH. See `GLYPH_RESERVED`. The thumb
 *      is `absolute inset-0`, so its box IS the segment's box: a glyph that
 *      renders only on the active segment changes both ends of the animation
 *      Framer is computing, mid-flight.
 *
 * SEGMENT neutralises the ToggleGroupItem's own `data-[state=on]` fill so the
 * travelling span is the only thing that paints.
 */
export const SEGMENTED = {
  TRACK: "flex rounded-pill bg-surface-container-high p-1",
  SEGMENT:
    "relative h-[2.125rem] gap-1.5 rounded-pill px-4 text-[0.84375rem] font-medium text-on-surface-variant hover:bg-transparent hover:text-on-surface data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-primary-foreground",
  /** The travelling fill. */
  THUMB: "absolute inset-0 rounded-pill bg-primary",
  /** Label sits above the thumb. */
  LABEL: "relative",
  /** Glyph size inside a segment. */
  GLYPH: 16,
  /**
   * The check glyph on the ACTIVE segment.
   *
   * The check reinforces selection non-chromatically, so the choice survives
   * grayscale and sunlight washout — the fill alone is never allowed to be the
   * only carrier.
   */
  GLYPH_ACTIVE:
    "relative opacity-100 scale-100 transition-[opacity,transform] duration-[--duration-quick] ease-[--ease-quick]",
  /**
   * The same glyph on an INACTIVE segment: still in the box, invisible to the
   * eye. THIS IS THE PRIMARY FIX for the segmented control's travelling fill,
   * and it is a layout fix, not a decoration.
   *
   * MEASURED. The glyph plus `gap-1.5` is worth 21.7px (15.7px advance + 6px
   * gap) and used to render only on the active segment. The thumb is
   * `absolute inset-0`, so its box IS the segment's box — changing a segment's
   * width therefore changes BOTH ends of the animation Framer is computing.
   * "Preferred Network Type" at 1914px, before -> after one click:
   *
   *   before (Automatic active)  118.3 | 86 | 79.6 | 82.3
   *   after  (5G only active)     96.6 | 86 | 101.4 | 82.3
   *
   * Consequences, all visible: the fill STRETCHED while it travelled (first
   * frame `translate3d(-266.99px, 0, 0) scale(1.13606, 1)`, and on `rounded-pill`
   * a 1.14 scaleX makes the caps read as ellipses in flight); the label you
   * clicked slid 21.8px out from under your cursor, un-animated; and the whole
   * track reshuffled as a hard cut while the one animated thing glided for
   * 600ms. Reserved, the widths go to 118.3 | 108 | 122.6 | 104.3 ->
   * 118.6 | 108 | 122.6 | 104.2.
   *
   * `opacity` + `scale` ONLY — never `display`, `hidden` or a conditional
   * render, all three of which give the box back. The residual 0.3px is
   * `data-[state=on]:font-semibold` and is left alone: widths are stable to the
   * eye, not to the pixel, and chasing `scaleX === 1` would cost the weight
   * change that makes the active label read as active.
   */
  GLYPH_RESERVED:
    "relative opacity-0 scale-[0.6] transition-[opacity,transform] duration-[--duration-quick] ease-[--ease-quick]",
} as const;

/**
 * Below this container width the segmented control is replaced by a Select.
 *
 * Four segments ("Automatic" / "LTE + 5G" / "5G NR only" / "LTE only") do not
 * fit one row on a phone, and shrinking them below a 44px touch target is not
 * an option on a surface field techs use on a tablet. The Select is the honest
 * fallback and is bound to the same state.
 */
/**
 * The pill-group / Select switch, parameterised by the card step it keys off.
 *
 * WHY A FACTORY. The basic settings page used to hold all six rows in one wide
 * card; it now holds three rows in each of two narrower peers, and the family's
 * default `@2xl/card` step (42rem) would push a half-width card onto the Select
 * fallback at desktop widths where the old single card showed the pill group —
 * a silent control change on exactly the widths a desktop review looks at.
 *
 * THE CLASSES MUST BE LITERAL. Tailwind's scanner only compiles class names it
 * finds verbatim in source, so the map below is written out in full — a
 * template string like `` @${step}/card:flex `` produces NO rule, which once
 * shipped as exactly that: the pill group silently vanished at every width and
 * every SegmentedField rendered only its Select. If a step is added, the four
 * strings for it must be spelled out, never interpolated.
 *
 * The ROW keeps its own `@2xl/card` step: between the two breakpoints a row is
 * stacked (text above control) and the pill group renders full-width under it,
 * which is the same arrangement a phone already shows.
 *
 * -----------------------------------------------------------------------------
 * WHY `5xl` EXISTS, AND WHY IT IS ONE ROW'S STEP RATHER THAN THE FAMILY'S
 * -----------------------------------------------------------------------------
 * A step ABOVE the row's own flip is not a contradiction — it is the only place
 * a fallback can live. `SETTING_ROW.ROOT` flips stacked -> side-by-side at
 * `@2xl/card` (672px), and it is exactly THERE that the text column collapses
 * against a wide track. Below 672 the control is full-width under the text and
 * nothing competes; above 672 the two share one line and the widest control on
 * the surface takes the text column's share.
 *
 * Reserving the check glyph on every segment (see `GLYPH_RESERVED`) widened the
 * four-segment track from ~386px to 452px, which turned a pre-existing squeeze
 * into a visible one. Measured on the real component (`SettingRow` +
 * `SegmentedField`, English, card container width swept directly), the
 * `mode_pref` row — the only four-way row, and the only one that can render
 * FIVE segments when the modem reports a value we do not offer:
 *
 *   card px  |  4 segments (`lg`)      |  5 segments (`lg`)
 *   ---------|-------------------------|-----------------------
 *   672      |  102px text, 3 lines    |    0px text, 6 lines, 249px row
 *   700      |  130px text, 2 lines    |    0px text, 6 lines, 249px row
 *   740      |  170px text, 2 lines    |    0px text, 6 lines, 249px row
 *   800      |  230px text, 2 lines    |   57px text, 5 lines, 229px row
 *   860      |  290px text, 1 line     |  117px text, 3 lines, 166px row
 *   896      |  326px text, 1 line     |  153px text, 2 lines, 146px row
 *   1024     |  454px text, 1 line     |  281px text, 1 line,  103px row
 *
 * That is `SETTING_ROW.TEXT`'s own documented failure arriving for real: a
 * 249px row of one-word lines, at widths a desktop review actually looks at.
 *
 * WHY 64rem AND NOT 56rem. `@4xl` (896px) was measured too and does clear the
 * four-segment case, but the five-segment case only crosses into two lines at
 * 870px — 26px of margin — and returns the pill group into a 146px row, 43px
 * above the row's own 102.8px floor. At `@5xl` (1024px) BOTH the four- and
 * five-segment cases render one consequence line in a 102.8px row at every card
 * width from 672 up: the control change and the row settling coincide, which is
 * what makes the switch read as a layout decision rather than a symptom.
 *
 * THE OTHER FIVE ROWS KEEP `lg`. Two- and three-segment tracks are 309px at
 * most and are not the offender — `nr5g_mode` measured identically (244.7px
 * text / 3 lines / 143.4px row at 672) before and after this change. Demoting
 * them to a Select at desktop widths would spend the pill group to fix a row
 * that does not have the problem.
 */
const SEGMENTED_BREAKPOINTS = {
  lg: {
    GROUP: "hidden @lg/card:flex",
    SELECT: "flex w-full @lg/card:hidden",
    /** The wrapper: full width in stacked-row mode, natural width side by side. */
    WRAP: "flex w-full @lg/card:w-auto",
  },
  xl: {
    GROUP: "hidden @xl/card:flex",
    SELECT: "flex w-full @xl/card:hidden",
    WRAP: "flex w-full @xl/card:w-auto",
  },
  "2xl": {
    GROUP: "hidden @2xl/card:flex",
    SELECT: "flex w-full @2xl/card:hidden",
    WRAP: "flex w-full @2xl/card:w-auto",
  },
  "5xl": {
    GROUP: "hidden @5xl/card:flex",
    SELECT: "flex w-full @5xl/card:hidden",
    WRAP: "flex w-full @5xl/card:w-auto",
  },
} as const;

/** Literal strings only — see the header comment. Never interpolate. */
export const segmentedBreakpoint = (
  step: "lg" | "xl" | "2xl" | "5xl" = "2xl",
) => SEGMENTED_BREAKPOINTS[step];

/** The dropdown trigger for rows that stay a Select at every width. */
export const SELECT_TRIGGER =
  "h-[2.625rem] w-full rounded-pill border-0 bg-surface-container-high px-4 text-[0.84375rem] font-medium @2xl/card:w-auto";

/**
 * A free-text field on this surface, as a RAW `<input>` rather than
 * `components/ui/input.tsx`.
 *
 * WHY THE PRIMITIVE IS NOT USED. `input.tsx` ships `dark:bg-input/30` and
 * `md:text-sm`. `tailwind-merge` groups by class type *including the modifier*,
 * so an unprefixed `bg-surface-container-high` from `SELECT_TRIGGER` does not
 * displace a `dark:`-scoped fill and an unprefixed text size does not displace
 * an `md:`-scoped one — tailwind-merge keeps BOTH and the last one wins at the
 * breakpoint. The field therefore reverts to the primitive's fill in dark mode
 * and to its type size above 768px, silently, on exactly the two axes a
 * desktop light-mode review never looks at. Overriding them at the call site
 * means restating `SELECT_TRIGGER`'s own numbers as `dark:` and `md:` variants,
 * which is the drift this file exists to prevent.
 *
 * Two independent builders hit this on two different pages in the same change
 * and each wrote their own local constant; this is that constant, promoted once
 * so the third page cannot write a fourth version of it.
 *
 * MONO IS CORRECT HERE and is not a costume: every consumer holds an identifier
 * the device emits verbatim (an IMEI, a TAC, an APN). The letter-spacing is
 * what makes fifteen undifferentiated digits scannable. The placeholder
 * deliberately drops back to the interface voice — a placeholder is
 * human-authored instruction, not machine output, and mono'd prompt text reads
 * as though the field were already filled.
 *
 * MODULE-PRIVATE ON PURPOSE. Nothing outside this file ever imported it — the
 * real API is the two `FIELD_SHELL` composites below, which is what
 * `imei-settings-card.tsx` reaches for. An exported half-a-field invites a
 * fourth local variant of exactly the drift documented above.
 */
const FIELD_INPUT = [
  "font-mono tracking-[0.06em] tabular-nums",
  "placeholder:font-sans placeholder:tracking-normal placeholder:text-on-surface-variant",
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  "aria-invalid:ring-[3px] aria-invalid:ring-destructive/40",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

/** A complete text field. Compose with a width and nothing else. */
export const FIELD_SHELL = `${SELECT_TRIGGER} ${FIELD_INPUT}`;

/**
 * Inline validation copy on a plain card.
 *
 * `--destructive` is the STRONG FILL and belongs only under
 * `--destructive-foreground`. Tinted error text sitting directly on a card is
 * the `--{role}-on-surface` slot — picking the wrong one of the five is the
 * failure DESIGN.md calls "the most common contrast failure in this system",
 * and it bites hardest in dark mode where `--destructive` is a LIGHT fill.
 *
 * `shadcn`'s `FieldError` hardcodes `text-destructive`, so this is passed as a
 * `className` override at the call site rather than being fixed in the
 * primitive — `field.tsx` is route-agnostic and shared with unconverted
 * surfaces that still want the legacy token.
 */
export const INLINE_ERROR = "text-destructive-on-surface";

/** A hairline rule between sections INSIDE a card, not between rows. */
export const SECTION_DIVIDER = "h-px bg-surface-container-high";

// -----------------------------------------------------------------------------
// The pending-changes save bar
// -----------------------------------------------------------------------------

/**
 * The bar only exists while something is pending — it is not a permanently
 * mounted footer that greys out.
 *
 * ON THE EXIT ANIMATION. DESIGN.md bans exit animations on BANNERS, scoped to
 * "conditions and navigation": a banner leaving means the condition cleared and
 * that should feel immediate. A save bar is not a condition — its disappearance
 * is the terminal frame of a commit the user initiated, and cutting it dead
 * reads as the app dropping the interaction. So it exits, but on the QUICK
 * clock, transform + opacity only (the Modal-Exit Rule's reasoning by analogy:
 * the exit clock is how long the user waits to see the result).
 *
 * `SaveButton` must never be wrapped in `AnimatePresence` — unmounting one of
 * its stacked layers removes that layer's width contribution and breaks its
 * width lock.
 */
export const SAVE_BAR = {
  ROOT: "flex flex-col gap-3 rounded-tile bg-surface-container px-5 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4",
  /**
   * The wrapper a save bar needs when it is NOT rendered inside a card.
   *
   * `ROOT` and `ACTIONS` key off `@2xl/card`, which is correct for the three
   * call sites that live inside a `CARD_SHELL` (`@container/card` is declared
   * there). The basic-settings shell renders `PendingSaveBar` under the card
   * grid instead, where the only container ancestor is `@container/main` — so
   * the query matched NOTHING at any width and the bar shipped as a
   * left-aligned stacked column on full desktop, count above note above
   * buttons.
   *
   * The fix is to give the bar the container it is written against rather than
   * to re-key it: re-keying would need `@2xl/main` spelled beside every
   * `@2xl/card` utility, and a bar sitting in a HALF-WIDTH card on a wide page
   * would then go side-by-side at a width where it does not fit.
   *
   * `empty:hidden` is load-bearing. The bar only exists while something is
   * pending, so this wrapper is an empty flex item the rest of the time — and
   * an empty flex item still claims its parent's `gap-4`, leaving 16px of dead
   * air above the re-read footer.
   */
  HOST: "@container/card empty:hidden",
  TEXT: "flex min-w-0 flex-col gap-0.5",
  COUNT: "text-sm font-semibold tabular-nums",
  NOTE: "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  ACTIONS: "flex flex-none items-center gap-2 @2xl/card:ml-auto",
} as const;

/**
 * The step ledger the bar becomes while applying.
 *
 * A slot change holds the modem for ~35s (radio cycle, then up to ten
 * verification read-backs, then an 8s client recovery wait). A button that
 * simply spins for that long reads as a hang, so the bar names the phase it is
 * in. Progress is DOTS plus a spinner, never a fill bar — fills are reserved
 * for data visualisation (The Loader-and-Dots Rule).
 */
export const APPLY_LEDGER = {
  ROOT: "flex flex-col gap-2.5",
  STEP: "flex items-center gap-2.5 text-[0.8125rem]",
  DOT: "size-1.5 flex-none rounded-pill",
  DOT_PENDING: "bg-outline",
  DOT_ACTIVE: "bg-primary",
  DOT_DONE: "bg-success",
} as const;

// -----------------------------------------------------------------------------
// The read-only "What the modem reports now" card
// -----------------------------------------------------------------------------

/**
 * A fact row. Label left, value right.
 *
 * NO DOT SEPARATORS. The comp joined facts with a `·` ("SIM 2 · ready",
 * "talkntext · 51502"); DESIGN.md's No-Dot-Separator Rule forbids it — a meta
 * line joining short facts uses spacing, never a glue character. VALUE_GROUP
 * gives the facts a real gap instead.
 */
export const READOUT_ROW = {
  LIST: "flex flex-col gap-1.5",
  ROOT: "flex items-center gap-3 rounded-pill bg-surface-container px-4 py-2.5",
  LABEL: "text-on-surface-variant flex-none text-[0.8125rem]",
  /** Multiple facts in one value cell, spaced rather than punctuated. */
  VALUE_GROUP: "ml-auto flex min-w-0 items-center gap-2.5",
  /** Machine strings: identifiers, MCCMNC, slot names. */
  VALUE_MONO:
    "font-mono text-[0.8125rem] font-semibold tabular-nums truncate",
  /**
   * Human-authored labels never take mono (The Machine-Voice Rule) — but this
   * slot also carries CHANGING FIGURES that are not identifiers: a slot number
   * and a carrier-aggregation breakdown, both of which the poller re-writes
   * under the reader. `tabular-nums` is the Numeric step's defining property
   * and belongs on any figure that ticks, mono or not.
   */
  VALUE_TEXT: "text-[0.8125rem] font-semibold tabular-nums truncate",
  /** Mirrors ROOT's resolved height AND radius for the skeleton. */
  HEIGHT: "h-[2.5625rem] rounded-pill",
  /**
   * Two-up readout rows, for a strip reporting more facts than a single column
   * can hold at a comfortable measure.
   *
   * WHY THIS IS NOT A TILE GRID. The APN comp drew "what the network granted"
   * as `repeat(5, 1fr)` stat tiles. Two of those five cells hold a full APN
   * (`internet.talkntext.ph`, 21 chars) and a full IPv6 (up to 39 chars after
   * RFC 5952 compression) — at 1fr of a card column each, both truncate to
   * noise, and the two that truncate are the two a technician actually opened
   * the page to read. A label-left/value-right row gives the value the whole
   * remaining width and degrades by truncating the LONG tail of one value
   * rather than all five at once. Tiles are for figures that are short by
   * construction (a count, a bandwidth, a signal reading); these are
   * identifiers, and identifiers get rows.
   */
  GRID: "grid grid-cols-1 gap-1.5 @2xl/card:grid-cols-2 @2xl/card:gap-x-2.5",
} as const;

// -----------------------------------------------------------------------------
// Network Priority — the reorderable rank list
// -----------------------------------------------------------------------------

/**
 * One draggable priority row.
 *
 * Geometry follows SETTING_ROW rather than inventing a second row shape, but
 * it is deliberately SHORTER: a priority row carries no control, so the 4.75rem
 * floor that exists to clear a 42px pill would leave a visibly hollow row.
 *
 * DRAGGING IS NOT THE ONLY WAY IN. `dnd-kit`'s KeyboardSensor is already wired,
 * and the handle is a real focusable button with an `sr-only` label — a rank
 * list that can only be reordered by pointer is unusable to exactly the
 * technician most likely to be on a tablet with a keyboard case.
 */
export const REORDER_ROW = {
  ROOT: "flex items-center gap-3.5 rounded-field px-3 py-3.5",
  /**
   * The grab handle's BOX, split out from its interaction so the skeleton can
   * share it rather than restate it.
   *
   * `size-8` is the visual size; the coarse-pointer bump to 44px is NOT
   * optional and lives here rather than at the call site. This is the one
   * control on the surface whose whole job is being dragged, and 32px is under
   * the touch floor — on the tablet where someone is actually reordering RATs
   * in a van, a 32px target next to a scrolling list is a miss.
   */
  HANDLE_BOX:
    "flex size-8 flex-none items-center justify-center rounded-pill [@media(pointer:coarse)]:size-11",
  /**
   * The handle itself: the box above plus everything that makes it a control.
   * `touch-none` is set by the consumer alongside dnd-kit's activator ref, not
   * here, because it is a gesture-routing concern rather than a shape one.
   */
  HANDLE:
    "flex size-8 flex-none cursor-grab items-center justify-center rounded-pill text-on-surface-variant hover:bg-surface-container-high active:cursor-grabbing focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [@media(pointer:coarse)]:size-11",
  HANDLE_GLYPH: 20,
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.75",
  LABEL: "text-[0.9375rem] font-semibold",
  /**
   * The label's resolved LINE BOX — 15px at the inherited 1.5 leading. Sizes
   * for a skeleton are the line box, never the font size, or the sliver reflows
   * the moment real text lands.
   */
  LABEL_LINE: "h-[1.40625rem]",
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The consequence's resolved line box — 12.5px x `leading-relaxed` (1.625). */
  CONSEQUENCE_LINE: "h-[1.26953rem]",
  /** The trailing chip cluster ("Serving now"). */
  META: "flex flex-none items-center gap-2",
  /**
   * Lifted while dragging.
   *
   * `bg-surface` is load-bearing, not decoration. A resting row paints no fill
   * of its own — it reads as a row because the GROUP under it is
   * `surface-container`. Lift that row without giving it a fill and the shadow
   * ends up drawn around a transparent box, so the "raised" row shows the group
   * straight through itself: a shadow with nothing casting it. Promoting it to
   * `surface` is also the honest tonal statement — the row has left the group's
   * step and risen to the card plane, which is exactly what Tonal-Elevation
   * says depth is.
   *
   * The shadow is then the ONE place on this surface a shadow is load-bearing.
   * Everywhere else a tone step carries elevation; here the row has to read as
   * off the stack entirely while it is under the pointer, and there is no
   * higher step to promote it to.
   */
  DRAGGING:
    "relative z-10 bg-surface opacity-80 shadow-[0_12px_28px_-8px_oklch(0.19_0.032_258/0.35)]",
} as const;

/**
 * The skeleton for one `REORDER_ROW`. It has NO geometry of its own: the
 * wrapper is `REORDER_ROW.ROOT`, the handle box is `REORDER_ROW.HANDLE_BOX`,
 * the text column is `REORDER_ROW.TEXT`, and the two slivers take the label's
 * and consequence's own line boxes. Height therefore RESOLVES to the real row's
 * (73.81px measured, at both) instead of being asserted.
 *
 * It replaces one full-width bar under a pinned `h-[4.25rem]`, which broke the
 * mirror three ways.
 *
 * 1. THE PIN WAS SIMPLY WRONG. `4.25rem` is 68px; the row measures **73.81px**
 *    with a one-line consequence and **94.13px** with two. So the constant that
 *    existed to guarantee the mirror was itself the mismatch — and because it
 *    was a number rather than a derivation, nothing could catch it. It had
 *    exactly one consumer, the skeleton it was lying to, so it is deleted
 *    rather than corrected: a second magic number is a second thing to get
 *    wrong. (A skeleton still cannot know how far the copy wraps; matching the
 *    one-line row is the honest floor, and it is now exact.)
 *
 * 2. THE RADIUS DID NOT RESOLVE. The call site passed `rounded-field` to a
 *    `Skeleton` whose own base string ends `rounded-md`. `cn()` is bare
 *    tailwind-merge and it cannot dedupe THIS REPO'S CUSTOM radius names, so
 *    both utilities survived into the class list and the winner was CSS
 *    declaration order — alphabetical, so `rounded-md` (10.4px) beat
 *    `rounded-field` (20px) on every render. The skeleton drew corners half the
 *    size of the row it stood in for, and nothing errored. `rounded-pill` wins
 *    that same coin-flip, which is why the slivers below need no escape hatch
 *    and the bar did.
 *
 * 3. A BAR IS NOT A ROW. The loaded row is a handle, a rank disc and a two-line
 *    text column; one solid block resolving into that is a pop, not a
 *    handoff.
 */
export const REORDER_ROW_SKELETON = {
  HANDLE: "size-5 rounded-pill",
  RANK: "size-[1.875rem] flex-none rounded-pill",
  LABEL: "w-[7.5rem] max-w-full rounded-pill",
  CONSEQUENCE: "w-[13rem] max-w-full rounded-pill",
} as const;

/**
 * The rank numeral.
 *
 * THE NUMERAL WEARS THE RADIO FAMILY'S HUE. This is the comp's "identity hues
 * per radio family, rank stated as a numeral" read literally, and it replaces
 * a real defect: the shipped `RAT_COLORS` map painted LTE `bg-success` and
 * WCDMA `bg-destructive`, so a perfectly healthy 4G row rendered green-for-good
 * and a perfectly functional 3G fallback rendered red-for-broken. Those are the
 * functional roles being spent on identity, which is precisely what
 * The Functional-Color Promise forbids — a user who learns red means failure on
 * the dashboard found it meaning "3G" here.
 *
 * WCDMA gets a NEUTRAL, not a third identity hue. The palette ships exactly
 * three identity hues (primary/NR, lte/violet, uplink/cyan) and cyan is spoken
 * for; inventing a fourth by eye is what The Source-Color Rule exists to stop.
 * A neutral rank pill is also honest — WCDMA is the fallback of last resort,
 * and it is the one leg with no brand identity in this product.
 *
 * Each entry is a complete FILL pair, so it stays correct sitting on a neutral
 * row or on a promoted `primary-container` one (same reasoning as RATE_CHIP).
 *
 * `tabular-nums` in font-sans, NOT mono: the rank changes while the user drags
 * it, which is the Machine-Voice Rule's tell for the interface voice.
 */
export const RANK_PILL = {
  ROOT: "grid size-[1.875rem] flex-none place-items-center rounded-pill text-[0.8125rem] font-semibold tabular-nums",
  NR5G: "bg-primary text-primary-foreground",
  LTE: "bg-lte text-lte-foreground",
  NEUTRAL: "bg-surface-container-high text-on-surface-variant",
} as const;

/** Radio-family tone for a rank pill, keyed by the modem's own RAT token. */
export const RAT_RANK_TONE: Record<string, string> = {
  NR5G: RANK_PILL.NR5G,
  LTE: RANK_PILL.LTE,
  WCDMA: RANK_PILL.NEUTRAL,
};

// -----------------------------------------------------------------------------
// The single-select choice list (Carrier Profile / MBN)
// -----------------------------------------------------------------------------

/**
 * A list of mutually-exclusive options where the SELECTED one is promoted.
 *
 * WHY NOT RADIO CIRCLES. The comp drew Material's `radio_button_checked` /
 * `radio_button_unchecked` pair. Neither glyph is in the font subset, and
 * adding them means a Google Fonts round-trip plus a committed binary — for an
 * affordance this system already expresses better. Selection here is the same
 * promotion the settings rows use for pendingness' sibling state: the chosen
 * row IS a `primary-container` block. That reads at a glance across the card,
 * where an 18px circle does not, and it survives grayscale.
 *
 * SCROLL_CAP is not cosmetic. Some carrier firmware ships twenty-plus MBN
 * bundles; an uncapped list runs off the card and takes the save action with
 * it. The cap is in rem so it scales with the user's text size rather than
 * clipping the fifth row at 200% zoom.
 */
export const CHOICE_ROW = {
  SCROLL_CAP: "max-h-[17rem] overflow-y-auto",
  ROOT: "flex w-full items-center gap-3 rounded-field px-4 py-3 text-left transition-[background-color,color] duration-[--duration-standard] ease-[--ease-standard] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  REST: "hover:bg-surface-container-high",
  SELECTED: "bg-primary-container text-on-primary-container",
  /** Mirrors ROOT's resolved height for the skeleton. */
  HEIGHT: "h-[3.25rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  /** Bundle names are machine strings read back from firmware. */
  NAME: "font-mono text-[0.84375rem] font-semibold truncate",
  /**
   * The caption reports the LIVE state ("running since last boot"), which is a
   * different question from which row the user has currently drafted — so it
   * can land on a promoted row or a neutral one depending on whether the draft
   * agrees with the modem.
   *
   * It therefore sets no ink of its own and dims whatever the row already
   * carries. That is what makes it correct on both: `on-primary-container` when
   * promoted, `on-surface` when not. An earlier version of this comment claimed
   * only the selected row could carry a caption and so no on-fill variant was
   * needed — that was wrong the moment a user picked a bundle the modem is not
   * yet running, which is the entire point of the control.
   */
  CAPTION: "text-[0.71875rem] opacity-90",
  GLYPH: 18,
} as const;

// -----------------------------------------------------------------------------
// Data Rate Limits (AMBR)
// -----------------------------------------------------------------------------

/**
 * The INSIDE of one radio's rate block — the bearer list and nothing else. The
 * block's own container is `RATE_CEILING.BLOCK`.
 *
 * THE IDENTITY CONTAINER FILLS ARE GONE, and with them `LTE` / `NR` / `TITLE` /
 * `HEIGHT` / `COL_MIN` / `COL_HEIGHT`. They belonged to the hero's three-column
 * body, where each rate column was a full-height tinted block and the fill was
 * the only thing saying which radio it was about. Inside a disclosure the block
 * is neutral (`bg-surface` on the panel's `surface-container`) and identity is
 * carried by an outline `Tag` in the block header — the Two-Form Rule's answer,
 * and a better one: the previous arrangement had `lte-container` doing identity
 * work with no second channel, which was safe only for as long as the block
 * reported no quality at all.
 */
export const AMBR_BLOCK = {
  /** The bearer/DNN name. Machine string. */
  APN: "font-mono text-[0.84375rem] font-medium truncate",
  /**
   * One entry: the bearer name on its own line, its two rate chips under it.
   *
   * IT WAS A ROW AND THE ROW DID NOT FIT. `flex items-center` with an
   * `ml-auto flex-none` chip pair overflowed its own block at the gridded
   * step: a rate chip measures ~115px (`px-3` 24 + glyph 15 + `gap-1.5` 6 +
   * nine mono digits at 13px ~70), so the pair plus its gap is ~238px against
   * a 222-262px content box — and because the pair is `flex-none`, the
   * overflow was paid entirely by `APN`, truncating the one identifier a
   * technician opened the page to read down to nothing. This is the
   * `READOUT_ROW.GRID` argument arriving one level in: identifiers get their
   * own line rather than competing with figures for a shared one.
   *
   * RATES therefore drops `ml-auto` and `flex-none` and takes `flex-wrap`, so
   * on a phone-width hero the second chip wraps instead of overflowing.
   */
  ROW: "flex flex-col gap-2",
  RATES: "flex flex-wrap gap-2",
  /**
   * Heading + governing marker on one baseline. `items-start` so a wrapped
   * heading does not drag the chip down with it.
   */
  HEADER: "flex items-center gap-2",
  /**
   * The NSA gloss, and any other one-line explanation inside a block. It sets no
   * ink of its own and dims whatever the block already carries, which is what
   * keeps it correct on a neutral block and on a filled one alike.
   */
  NOTE: "text-[0.71875rem] leading-relaxed text-pretty opacity-90",
  /** The entry list. `gap-2.5` because a multi-PDN device shows two rows. */
  LIST: "flex flex-col gap-2.5",
} as const;

/**
 * A single down/up rate chip.
 *
 * DIRECTION IS THE COLOUR, NOT THE RADIO. An earlier draft coloured both
 * chips after the block's radio identity (`bg-lte` inside the LTE block,
 * `bg-primary` inside the 5G block) — which is why an LTE download chip and
 * an LTE upload chip were the same purple, distinguished only by their arrow
 * glyph. A figure's DIRECTION now reads the same colour regardless of which
 * radio block it sits in — the radio identity still lives one layer out from the
 * chip, on the block's own identity `Tag` — and the two hues carrying that
 * direction belong to neither radio.
 *
 * WHY ROSE AND CYAN, AND NOT BLUE AND VIOLET. An earlier pass used `primary`
 * (download) and `lte` (upload), reasoning that cyan read as a discordant third
 * accent sitting inside the violet LTE block. That observation was true and the
 * conclusion was still wrong: it fixed a local adjacency by spending the two
 * RADIO identity hues on a fact that is not about radios. Inside the LTE block
 * an upload chip then rendered in the LTE hue for reasons having nothing to do
 * with LTE, and blue meant 5G NR, the brand, "in progress" AND download
 * depending on which page you were reading.
 *
 * Direction now has its own axis: Downlink Rose (hue 341) and Uplink Cyan (hue
 * 200), neither of which can be confused for a radio. The chips sit ON the
 * block's radio container rather than borrowing from it, which is what makes a
 * rose download chip inside the violet LTE block legible as two independent
 * facts instead of one muddled one. Hue 341 is not a taste pick — sweeping the
 * full circle against every taken hue leaves exactly one window clearing the
 * 40-degree floor.
 *
 * The arrow glyph stays as the direction's SECOND channel (never the only
 * one — PRODUCT.md requires a paired readout to survive colour-blindness),
 * so the pairing degrades gracefully rather than depending on hue alone. That
 * matters more than it looks: at container lightness in dark mode this
 * system's tonal pairs collapse under deuteranopia and protanopia simulation,
 * so on a dark block the arrow is the information and the hue is reinforcement.
 *
 * ON THE FILL CHOICE. An earlier draft wrote `bg-lte/25` and `bg-primary/25`.
 * Both are alpha washes, and this file's Tone Rule forbids them: an alpha is a
 * different perceived lightness in each theme. The correct move for a chip
 * that must lift off a CONTAINER is the role's own FILL pair — `bg-downlink`
 * carries `text-downlink-foreground`, `bg-uplink` carries
 * `text-uplink-foreground`, a real pair in both themes. Note the pairs are
 * declared here, so consumers must NOT also set an ink class on the chip.
 */
export const RATE_CHIP = {
  ROOT: "inline-flex h-[1.875rem] items-center gap-1.5 rounded-pill px-3 font-mono text-[0.8125rem] font-semibold tabular-nums",
  ON_DOWNLOAD: "bg-downlink text-downlink-foreground",
  ON_UPLOAD: "bg-uplink text-uplink-foreground",
  GLYPH: 15,
} as const;

/**
 * The honest empty state for a radio with no reported rates.
 *
 * The comp's copy asserted "It has been LTE only on this site since 06:41" —
 * a claim this page has no data source for, and one that would be fabricated on
 * any device where the serving-technology parse failed. Removed by product
 * decision; the remaining sentence states only what is verifiable.
 */
export const EMPTY_BLOCK = {
  ROOT: "flex flex-col items-center gap-1.5 rounded-tile bg-surface-container px-4 py-5 text-center",
  GLYPH: 26,
  TITLE: "text-sm font-semibold",
  BODY: "text-on-surface-variant max-w-[19rem] text-[0.78125rem] leading-relaxed text-pretty",
} as const;

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------

/**
 * SIM presence, as published by the poller's `.sim.status`.
 *
 * Every state carries its OWN glyph — `success-container` and `warning-container`
 * measure 1.03:1 apart and are identical under deuteranopia, so the glyph is the
 * only thing separating a ready SIM from one asking for a PIN. `not_inserted` is
 * `muted`, not `destructive`: an empty slot is a deliberate configuration, not a
 * fault. `error` is the fault.
 *
 * Keyed onto `BadgeVariant`, never onto a class string, so a new state without a
 * matching role fails the build.
 */
export const SIM_STATUS_BADGE: Record<
  string,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  ready: { variant: "success", glyph: "check_circle" },
  pin_required: { variant: "warning", glyph: "sim_card_alert" },
  puk_required: { variant: "warning", glyph: "lock" },
  not_inserted: { variant: "muted", glyph: "sim_card" },
  error: { variant: "destructive", glyph: "error" },
  unknown: { variant: "muted", glyph: "help" },
};

/** Glyph size inside a dense chip. */
export const BADGE_GLYPH_SIZE = 12;
