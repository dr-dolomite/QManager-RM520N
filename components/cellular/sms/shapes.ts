// =============================================================================
// SMS — the family shape module
// =============================================================================
// The eighth of these modules under `components/cellular/**`, on the same
// conventions as `settings/shapes.ts`, `cell-scanner/shapes.ts` and
// `antenna-alignment/shapes.ts`: ONE module per route family owning geometry,
// control heights, glyph sizes and tone maps, imported by the loaded views AND
// by their skeletons (DESIGN.md > Layout > "A per-family `shapes.ts`").
//
// SMS was the only `/cellular/` family without one, and it had every symptom the
// canon predicts — none of them visible in any single file, which is why they
// survived review:
//
//   - `PILL_ACTION` existed in FOUR byte-identical copies across THREE files:
//     `sms-center.tsx`, `sms-compose-dialog.tsx`, and twice inline in
//     `states.tsx`. A fifth lived in `forwarding/sms-forwarding-card.tsx`.
//   - THREE unrelated control heights inside one card — 42px, 40px and 36px —
//     with no constant naming the split, so nothing recorded that the 36px
//     toolbar was a deliberate density choice rather than drift.
//   - `DIALOG_TONAL = DIALOG_ACTION`, an alias to nothing, left over from a
//     split that no longer exists.
//   - Skeletons that GUESSED: the toolbar skeleton mirrored a 44px tab strip
//     against a real 38px one, drew ONE trailing pill where the loaded toolbar
//     renders TWO, and inset its rows `px-3` against the loaded `px-4`.
//
// GEOMETRY IS RESTATED ACROSS SIBLING FAMILIES, NEVER IMPORTED FROM ONE. The
// values below that match `settings/shapes.ts` or `antenna-alignment/shapes.ts`
// are deliberate copies, not an oversight — a sibling family must be free to
// retune without reaching into this one. What IS genuinely family-wide lives one
// level up in `components/cellular/` (`tile-shape.ts`, `signal-quality-display.ts`,
// `condition-screen.tsx`) and is imported from there.
// =============================================================================

import { cn } from "@/lib/utils";
import type { ConditionTone } from "@/components/cellular/condition-screen";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/**
 * The page column. `gap-5`, matching both reference surfaces
 * (`radio/cellular-information.tsx`, `antenna-alignment.tsx`) — note
 * `settings/shapes.ts` carries `gap-6` for the same key; that family is older on
 * this point and the two are not required to agree.
 */
export const PAGE_SHELL = "@container/main mx-auto flex flex-col gap-5 p-2";

/** Display step: 30px / 700 / -0.02em. */
export const PAGE_TITLE = "text-3xl font-bold tracking-[-0.02em]";

/** Body step under the title. */
export const PAGE_DESCRIPTION =
  "text-on-surface-variant text-sm leading-relaxed text-pretty";

/**
 * The house pill action: 42px on the role scale, clearing the 44px coarse-pointer
 * target once its 2px focus ring is counted.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/**
 * The dense in-card control, 36px. DELIBERATELY one step under `PILL_ACTION`:
 * the inbox toolbar and card-header actions sit inside a table-bearing card
 * where a 42px control row would out-weigh the rows it filters. The
 * `pointer-coarse:` bump is what keeps it a legal touch target at 44px, so the
 * two facts travel together rather than the height looking like an accident.
 */
export const TOOLBAR_PILL =
  "h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11";

/** The 36px icon-only twin of TOOLBAR_PILL, on a fill (the Fill-Over-Stroke Rule). */
export const ICON_PILL =
  "size-9 rounded-pill bg-surface-container text-on-surface-variant hover:bg-surface-container-high pointer-coarse:size-11";

/**
 * The dialog action, 40px — one step under the primary pill, because a dialog
 * footer is already the most emphatic thing on screen.
 *
 * There was a second name for this exact string (`DIALOG_TONAL = DIALOG_ACTION`).
 * It is gone: an alias that adds nothing records a distinction the code does not
 * make. A tonal dialog action is this constant plus `variant="tonal"`.
 */
export const DIALOG_ACTION =
  "h-10 gap-2 rounded-pill px-4 text-sm font-semibold pointer-coarse:h-11";

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

/**
 * The SMS Center's Inbox card. `rounded-hero` is CORRECT here and is not the
 * same call as the forwarding pair below: the Inbox is the single card on its
 * surface, so it genuinely anchors it.
 *
 * `shadow-whisper` as a bare utility does NOT resolve — it must go through the
 * custom property.
 */
export const INBOX_CARD =
  "@container/card gap-5 rounded-hero border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Hero-card padding: 28px, against the standard card's 24px. */
export const INBOX_PAD = "px-7";

/** The card title's own step: Title, 18px/600. */
export const INBOX_TITLE = "text-lg";

/**
 * The SMS Forwarding cards. `rounded-card` (36px), NOT `rounded-hero`.
 *
 * Both forwarding cards previously wore the hero radius. DESIGN.md > Shapes:
 * "a grid of peer cards takes `card`; the one card that anchors a surface takes
 * `hero`." Two co-equal, height-locked peers in a 2-up grid means NEITHER
 * anchors, and giving both 40px spends the distinction without buying anything.
 *
 * `@container/card` is declared here even though nothing queries it yet. Without
 * it on the shell, the first `@md/card:` a contributor writes inside one of these
 * cards matches NOTHING at any width and ships as a silently unresponsive layout
 * — the exact failure `settings/shapes.ts` records for its own save bar.
 */
export const CARD_SHELL =
  "@container/card h-full gap-5 rounded-card border-0 bg-surface px-7 py-6 shadow-[var(--shadow-whisper)]";

/** The two-up card grid. A container query, never a viewport breakpoint. */
export const CARD_GRID = "grid grid-cols-1 gap-5 @3xl/main:grid-cols-2";

/** Equal heights are explicit, so a card whose data hasn't landed isn't shorter. */
export const CARD_CELL = "h-full *:data-[slot=card]:h-full";

/** Card header text. `min-w-0 truncate` on every node — Italian is the tripwire. */
export const CARD_TITLE = "min-w-0 truncate text-lg font-semibold";
export const CARD_DESCRIPTION = "min-w-0 truncate text-sm";

/**
 * The card header's line boxes, for both skeletons. `CardTitle` ships
 * `leading-none`, so `text-lg` is an 18px box rather than the 24px a naive `h-6`
 * would guess.
 */
export const HEADER_SHAPE = {
  TITLE: "h-5 w-44",
  DESCRIPTION: "h-5 w-60",
  GAP: "gap-1",
} as const;

// -----------------------------------------------------------------------------
// Tile strip
// -----------------------------------------------------------------------------
// Dimensions come from `components/cellular/tile-shape.ts` (family-wide). What
// lives here is only this strip's grid and its tone pairings.

/**
 * Three tracks, not the shared four. The degraded/combined storage tile spans
 * two, so the strip keeps THREE tracks in both the split and the combined case
 * and the skeleton never has to guess which shape it is handing off to.
 */
export const TILE_GRID =
  "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @4xl/main:grid-cols-3";

export const TILE_COMBINED_SPAN = "@xl/main:col-span-2 @4xl/main:col-span-2";

/**
 * THE TILE BODY IS NEUTRAL. THE DISC CARRIES THE COLOUR.
 *
 * This strip previously ran Gen 1 and Gen 4 simultaneously — one body on the
 * STRONG FILL (`bg-primary`) and two on pale containers — which is the exact
 * composition `radio/summary-tiles.tsx` spent five generations removing, and the
 * inversion DESIGN.md's Overview names as "the single largest change from the
 * previous system": four tinted tiles carrying restated facts while the live
 * readings sat in neutral text.
 *
 * Both halves were wrong for stated reasons. A 104px body is not "compact
 * emphasis", so the strong fill was off-layer. And four pale bodies at
 * near-identical container lightness encode CATEGORY without encoding
 * IMPORTANCE, so the strip flattens to equal weight and the eye has nowhere to
 * land. A neutral body with a saturated disc gives each tile a focal point at
 * ~1/8th the tinted area, and gives the strip a reading order again.
 *
 * There is deliberately NO tone/body export. A caller cannot tint a body back,
 * which is cheaper than a comment asking nobody to.
 */
export const TILE_BODY = "bg-surface-container text-on-surface";

/** Eyebrow and caption ink. Fixed here, not a caller's decision.
 *  These were `opacity-85` — an alpha standing in for an ink token, which only
 *  existed because the body was tinted and a neutral-ramp ink on a tinted
 *  surface is itself a cross-pair. A neutral body makes the real token legal. */
export const TILE_EYEBROW = "text-xs font-semibold text-on-surface-variant";
export const TILE_CAPTION = "text-xs text-on-surface-variant";

/** Headline step. */
export const TILE_VALUE = "text-xl font-semibold leading-[1.1]";
export const TILE_VALUE_TABULAR = cn(TILE_VALUE, "tabular-nums");

/**
 * An absent capacity sits one step BELOW a real reading: "Unknown" should not
 * out-weigh the figures beside it just because the sentence is longer.
 */
export const TILE_VALUE_ABSENT = "text-sm font-semibold text-on-surface-variant";

/**
 * Disc fills. Always a FILL pair (`bg-X` + `text-X-foreground`), never a
 * container — The Glyph-Disc Rule: in light mode the pale identity containers
 * collapse under CVD simulation and the fills do not, so the disc is the only
 * place a role colour is reliably legible.
 *
 * The SIM-memory tile is NEUTRAL. It previously wore Uplink Cyan, justified in
 * its own header as "the system's third identity hue [which] already owns counts
 * and upload direction system-wide". That reasoning is what
 * `radio/summary-tiles.tsx` explicitly names and rejects — "A count is not a
 * direction. That gave cyan a second meaning and made the whole direction axis
 * untrue" — after the identical argument had already been tried and reverted on
 * the Carriers tile. A stored-message count has no honest hue, so per The
 * Neutral-Default Rule it stays neutral and the meter length carries the reading.
 *
 * (The header also cited "DESIGN.md > Secondary" and "DESIGN.md > Tertiary".
 * Neither heading exists; the file was reasoning from a retired document.)
 */
export const TILE_DISC_UNREAD = "bg-primary text-primary-foreground";
export const TILE_DISC_NEUTRAL =
  "bg-surface-container-high text-on-surface-variant";

// -----------------------------------------------------------------------------
// Inbox table
// -----------------------------------------------------------------------------

export const TABLE_SHAPE = {
  /** The table's own container: one tonal step down from the hero card. */
  SHELL: "overflow-hidden rounded-tile bg-surface-container",
  /** Header strip, one further step up so it reads as a rule, not a row. */
  HEAD: "bg-surface-container-high",
  /** Header cell. 12px/500 label step. */
  HEAD_CELL:
    "h-10 px-4 text-xs font-medium text-on-surface-variant whitespace-nowrap",
  /**
   * The hairline. `--outline` is sanctioned for table rules (and input strokes)
   * and nothing else — never as a card edge.
   */
  ROW: "border-outline border-b last:border-0",
  /**
   * Body cell padding — 16px, not the 12px a plain shadcn table would use,
   * because this table sits inside its own `rounded-tile` (28px) shell rather
   * than flush against a card's padded edge: the first/last cell needs enough
   * clearance to read as inset from that curve rather than clipped by it.
   */
  CELL: "px-4 py-3 align-middle",
  /** Mirrors the resolved height of one populated row, for the skeleton. */
  ROW_HEIGHT: "h-[3.25rem]",
  /** The 16px slot reserved for the unread glyph so senders stay aligned. */
  FLAG: "size-4 flex-none",
  /**
   * Row transition. `components/ui/table.tsx` is stock shadcn and ships
   * `transition-colors` with NO duration, so every hover and selection on this
   * table silently inherited Tailwind's off-scale 150ms. The One-Scale Rule is
   * about the class RETUNING with the system; a bare `transition-colors` cannot.
   */
  ROW_MOTION: "transition-colors duration-[var(--duration-quick)] ease-out",
} as const;

/** How many rows the table paginates at — spent by the loaded view AND by the
 *  skeleton, which previously drew five against a real ten. */
export const ROWS_PER_PAGE = 10;

/**
 * The toolbar's real resting geometry, for the skeleton to mirror.
 *
 * `TabsList` is `h-auto gap-1 p-1` around `h-9` triggers, which resolves to
 * 38px — NOT the 44px the old skeleton guessed. The search field is bounded at
 * both ends. And the toolbar renders TWO trailing pills (sort, mark-all-read),
 * where the skeleton drew one.
 */
export const TOOLBAR_SKELETON = {
  TABS: "h-[2.375rem] w-[17rem] rounded-pill",
  SEARCH: "h-9 w-full min-w-[12rem] max-w-[15rem] rounded-field",
  PILL: "h-9 w-28 rounded-pill",
  PILL_COUNT: 2,
} as const;

/** The pagination footer: a select, a page label and four icon buttons. */
export const PAGINATION_SKELETON = {
  SELECT: "h-9 w-[4.5rem] rounded-field",
  LABEL: "h-5 w-28 rounded-inline",
  BUTTON: "size-9 rounded-pill",
  BUTTON_COUNT: 4,
} as const;

/** Skeleton slivers take the 12px inline radius, not `Skeleton`'s legacy
 *  `rounded-md` default. */
export const SKELETON_LINE = "rounded-inline";

/** The checkbox skeleton mirrors the real control's 4px radius, not the 12px
 *  inline step — at 16px square, `rounded-inline` renders a near-circle where
 *  the loaded control is a near-square. */
export const SKELETON_CHECKBOX = "size-4 rounded-[4px]";

// -----------------------------------------------------------------------------
// Forwarding form
// -----------------------------------------------------------------------------

/**
 * The enable row, as a metric-row pill. 44px, a coarse-pointer target in its own
 * right — and the `FieldLabel htmlFor` association is what makes the whole row
 * activatable rather than just the ~18x32px switch inside it.
 */
export const TOGGLE_ROW =
  "flex h-11 w-full items-center gap-3 rounded-pill px-4";
export const TOGGLE_LABEL = "min-w-0 flex-auto truncate text-sm font-semibold";

export const FIELD_LABEL = "text-sm font-semibold";

/**
 * Field help and inline error, at the BODY step (14px).
 *
 * These were `text-[13px]`. 13px is the Row step and DESIGN.md scopes it to a
 * dense metric row, restating it as a hard Don't: "Do not reach for 13px outside
 * a dense metric row." A field description is prose. (Where 13px IS correct, the
 * canon's spelling is `text-[13px]/5` — the explicit 20px line box is what pins
 * a metric row at 40px — and none of the removed sites carried it.)
 */
export const FIELD_HELP =
  "text-on-surface-variant text-sm leading-relaxed text-pretty";

/** Tinted text on a PLAIN card takes the `-on-surface` ink step, never
 *  `--destructive`, which is the strong FILL and fails contrast as ink. */
export const INLINE_ERROR = "text-destructive-on-surface text-sm leading-relaxed";

/** Its twin, for a promoted row: on `primary-container` the neutral-ramp error
 *  ink is a cross-pair. */
export const INLINE_ERROR_ON_FILL =
  "text-on-primary-container text-sm leading-relaxed opacity-90";

/**
 * THE FIELD SHELL, AND WHY IT IS SPENT ON A RAW `<input>`.
 *
 * `components/ui/input.tsx` ships `dark:bg-input/30`. The `dark` variant compiles
 * to `&:is(.dark *)`, giving it specificity (0,2,0) against a bare
 * `bg-surface-container`'s (0,1,0) — and tailwind-merge cannot fold the two
 * because they sit in different modifier scopes. So a call site that "overrides"
 * the fill does not: EVERY forwarding field was rendering `input/30` in dark
 * mode instead of the container step. It looks approximately right, which is
 * exactly why it survived review. The primitive also ships `md:text-sm`, which
 * leaks a VIEWPORT breakpoint into a container-query surface, and
 * `transition-[color,box-shadow]` with no duration (off-scale 150ms).
 *
 * Handing this string to a raw `<input>` is the only spelling that closes all
 * three. `settings/shapes.ts` and `tower-locking/shapes.ts` independently
 * document the identical trap.
 *
 * Restated here rather than imported from `settings/shapes.ts` — sibling
 * families restate.
 */
const FIELD_BASE =
  "h-[2.625rem] w-full rounded-field border-0 px-4 text-sm shadow-none outline-none " +
  "font-mono tracking-[0.06em] tabular-nums " +
  "placeholder:font-sans placeholder:tracking-normal " +
  "focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
  "aria-invalid:ring-[3px] aria-invalid:ring-destructive/40 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD_SHELL = cn(
  FIELD_BASE,
  "bg-surface-container text-on-surface placeholder:text-on-surface-variant",
);

/**
 * The promoted twin. THESE EXIST AS A PAIR: a free-text field is the one control
 * where an edit is guaranteed to make its row dirty, so the field must have an
 * on-fill spelling or the row promotes underneath ink that stayed neutral —
 * one role's ink on another role's container, the most common way this pattern
 * goes wrong.
 *
 * The placeholder ink is appended LAST on purpose: it lands in the same
 * tailwind-merge group as FIELD_BASE's own placeholder rules, so order decides.
 */
export const FIELD_SHELL_ON_FILL = cn(
  FIELD_BASE,
  "bg-primary text-primary-foreground",
  "placeholder:text-primary-foreground/70",
);

/**
 * The dirty-row promotion. A pending edit is the brand ACTING — an action
 * awaiting commit — and is explicitly NOT a status: a dirty row is neither
 * "good" nor "warning", so no functional role may stand in for pendingness.
 */
export const ROW_DIRTY = "bg-primary-container text-on-primary-container";

// -----------------------------------------------------------------------------
// Delivery health
// -----------------------------------------------------------------------------

export const HEALTH_SHAPE = {
  BLOCK: "flex items-center gap-3.5 rounded-tile px-5 py-4",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  SMALL_DISC: "grid size-8 flex-none place-items-center rounded-pill",
  EYEBROW: "text-xs font-semibold text-on-surface-variant",
  BUBBLE: "rounded-tile bg-surface-container px-4 py-3",
  /** Body step. Was 13px — see FIELD_HELP. */
  HINT: "text-sm leading-relaxed text-on-surface-variant text-pretty",
  /**
   * The focal status statement, at the TITLE step (18px/600).
   *
   * It shipped at `text-base` — 16px/600 — which is not a step on the ramp at
   * all: it sits between Title and Body owning no role. The same defect was
   * found and fixed on the settings family's column headings.
   */
  STATE_LABEL: "text-lg leading-tight font-semibold",
  STATE_DETAIL: "text-sm leading-relaxed opacity-90",
  SECTION_TITLE: "text-sm font-semibold",
} as const;

/**
 * Pinned block heights, in px, spent as inline styles at BOTH ends.
 *
 * STATE: py-4 (32) + the taller of the 44px disc and the two-line text column
 * = 76 natural, floored at 80 so a wrapped detail line still matches.
 * BUBBLE: py-3 (24) + a 20px line box = 44.
 * NOTICE: the failure banner's own resting height, applied to BOTH branches of
 * that slot — the populated branch previously carried none, so one slot was
 * governed by two rules.
 */
export const HEALTH_HEIGHT = {
  STATE: 80,
  BUBBLE: 44,
  NOTICE: 68,
} as const;

/** Skeleton line boxes for the health card, mirroring HEALTH_SHAPE above.
 *  `text-xs` at `leading-relaxed` is a 19.5px box, NOT the 16px an `h-4` guesses. */
export const HEALTH_SKELETON = {
  EYEBROW: "h-4 w-28 rounded-inline",
  HINT: "h-5 w-52 rounded-inline",
  ACTION: "h-[2.625rem] w-36 rounded-pill",
} as const;

/** Skeleton line boxes for the forwarding form, mirroring the constants above. */
export const FORM_SKELETON = {
  TOGGLE: "h-11 w-full rounded-pill",
  LABEL: "h-5 w-28 rounded-inline",
  INPUT: "h-[2.625rem] w-full max-w-sm rounded-field",
  HELP: "h-5 w-56 rounded-inline",
  ACTION: "h-[2.625rem] w-36 rounded-pill",
} as const;

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------
// Both key onto `ConditionTone` and resolve their classes through
// `CONDITION_TONE` in `components/cellular/condition-screen.tsx`. Neither holds
// a class string, so a tone without a matching role is a BUILD failure.

/** Relay health -> a container tone. Four states, four DISTINCT glyphs — the
 *  containers sit as close as 1.03:1, so the glyph is the separating channel. */
export const HEALTH_TONE = {
  active: "success",
  issue: "warning",
  unconfigured: "primary",
  off: "neutral",
} as const satisfies Record<string, ConditionTone>;

/** Delete-progress step -> a container tone. `running` on `primary-container` is
 *  the Highlight-by-Container Rule: a running pipeline step promotes a surface
 *  one step rather than taking a wash. */
export const DELETE_STEP_TONE = {
  pending: "neutral",
  running: "primary",
  done: "success",
  failed: "destructive",
} as const satisfies Record<string, ConditionTone>;

/** Glyph size in a status chip. `[&>svg]:size-3` cannot reach a MaterialSymbol
 *  — its `fontSize` is an inline style — so every Material glyph in a chip
 *  passes `size` explicitly. */
export const GLYPH = { CHIP: 12, INLINE: 16, ACTION: 18 } as const;
