import type { BadgeVariant } from "@/components/ui/badge";

// Alerts — the /monitoring/alerts family's geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).
// The page header is `components/monitoring/page-header.tsx`, so its type scale
// is deliberately absent here: one owner per shape.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** A 36px header pill. The coarse-pointer bump is what reaches the 44px floor. */
export const PILL_ACTION =
  "h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11";

/** The same pill with no label, for an icon-only card action. */
export const PILL_ICON =
  "grid size-9 place-items-center rounded-pill pointer-coarse:size-11";

/** The lucide glyph inside either pill. */
export const PILL_GLYPH = "size-4";

/**
 * The side-by-side region: Channels beside Activity.
 *
 * `items-stretch` plus `*:data-[slot=card]:h-full` is the whole lock — a
 * stretched cell holding a content-height card looks exactly like no change.
 * A card entering this grid MUST have a state built to FILL (see `CARD_FILL`
 * and `CARD_FILL_REGION`), or the lock buys symmetry with a dead void.
 * The 4xl step keeps each column past ~430px, which is what the 42px field
 * plus its hint needs before the pair is worth splitting at all.
 */
export const COLS =
  "grid grid-cols-1 items-stretch gap-5 *:data-[slot=card]:h-full @4xl/main:grid-cols-2";

/** Put on the `Card` itself when it is not reached by `COLS`'s child selector. */
export const CARD_FILL = "h-full";

/** The ONE region inside a stretched card that absorbs the slack. */
export const CARD_FILL_REGION = "flex-1 min-h-0";

// -----------------------------------------------------------------------------
// The status band
// -----------------------------------------------------------------------------

/**
 * Three tiles that reflow by their own minimum rather than by a breakpoint
 * ladder, so the band is correct at every sidebar state without a query.
 */
export const TILE = {
  GRID: "grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]",
  /** 104px PINNED, never floored: a floor cannot mirror a skeleton. */
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile bg-card px-5 py-4 shadow-[var(--shadow-whisper)]!",
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/** The band's disc fills. The tile picks one at runtime from its own verdict. */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  good: "bg-success text-success-foreground",
  alert: "bg-warning text-warning-foreground",
  bad: "bg-destructive text-destructive-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** The figure. `tabular-nums` in the UI face, never mono: it is a live count. */
export const TILE_VALUE =
  "truncate text-[1.375rem] leading-[1.1] font-bold tracking-[-0.015em] tabular-nums";

/** Ink for a figure reporting a degraded or absent coverage verdict. */
export const TILE_VALUE_TONE = {
  neutral: "",
  alert: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

export type TileValueTone = keyof typeof TILE_VALUE_TONE;

export const TILE_CAPTION = "text-on-surface-variant truncate text-xs";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** A card in the pair: 36px radius, no hairline, the whisper carrying the edge. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The anchor card on the surface: 40px radius, 28px pad, one per route. */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 bg-card py-7 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const HERO_PAD = "px-7";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** Title block on the left, actions pinned right, both able to shrink. */
export const CARD_HEAD = "flex items-start gap-4";
export const CARD_HEAD_ACTIONS = "ml-auto flex flex-none gap-2";

// -----------------------------------------------------------------------------
// The coverage matrix
// -----------------------------------------------------------------------------

/** A 74px FLOOR, not a pin: a cell grows for its note, and the skeleton reads
 *  the same constant so an empty placeholder lands exactly on the floor. */
const CELL_MIN_HEIGHT = "min-h-[4.625rem]";

/**
 * Three events by three channels. Below the card's 2xl step the grid collapses
 * to one column and each event becomes a stack, so a cell must name its own
 * channel there (`CHANNEL_LABEL`) — the column heads are gone.
 */
export const MATRIX = {
  GRID:
    "grid grid-cols-1 items-stretch gap-4 @2xl/card:grid-cols-[minmax(9.375rem,1.15fr)_repeat(3,minmax(7rem,1fr))] @2xl/card:gap-3",
  /** The empty top-left corner. Present only once the heads are. */
  CORNER: "hidden @2xl/card:block",
  /** One event's row: contents on the grid, a stack once it collapses. */
  GROUP: "flex flex-col gap-2 @2xl/card:contents",
  COLHEAD:
    "hidden flex-col items-start gap-1.5 px-0.5 pb-0.5 @2xl/card:flex",
  COLHEAD_NAME: "flex items-center gap-[7px] text-[0.8125rem] font-semibold",
  COLHEAD_GLYPH: "text-on-surface-variant size-[0.9375rem]",
  /** The status chip plus, only while unsaved, the fix-me chip beside it. */
  COLHEAD_CHIPS: "flex flex-wrap items-center gap-1.5",
  ROWHEAD: "flex min-w-0 flex-col justify-center gap-[3px] pr-2",
  ROWHEAD_TITLE: "text-[0.84375rem] font-semibold",
  ROWHEAD_DESC: "text-on-surface-variant text-xs leading-[1.4]",
  CELL_MIN_HEIGHT,
  CELL: `flex w-full ${CELL_MIN_HEIGHT} flex-col justify-center gap-2 rounded-tile! border-0 p-3 text-left`,
  CELL_TRANSITION:
    "transition-[background-color,color,box-shadow] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  DISC: "grid size-[1.625rem] flex-none place-items-center rounded-pill",
  GLYPH: "size-[0.9375rem]",
  LABEL: "text-[0.78125rem] font-semibold",
  /** The note IS the cell's explanation, so it stays at full alpha: an 0.85
   *  wash took it to 3.9:1 in light, under the 4.5:1 floor. */
  NOTE: "text-[0.71875rem] leading-[1.35]",
  /** Only visible once the column heads are gone, so it is the ONLY thing
   *  naming the channel there — full alpha, never dimmed. */
  CHANNEL_LABEL:
    "text-[0.6875rem] font-semibold tracking-[0.02em] uppercase @2xl/card:hidden",
} as const;

/**
 * The grounds a cell can take. `pending` is `fires` plus an inset primary ring:
 * the cell already reports what WILL fire, the ring says it is unsaved.
 */
export const CELL_TONE = {
  fires: {
    ROOT: "bg-success-container text-on-success-container",
    DISC: "bg-success text-success-foreground",
  },
  /** Capable and switched on, simply not ticked. */
  rest: {
    ROOT: "bg-surface-container text-on-surface-variant",
    DISC: "bg-surface-container-high text-on-surface-variant",
  },
  /** Ticked but held by the master switch. Still a control: you can untick it,
   *  so it never takes a not-allowed cursor. Only `dead` is truly inert. */
  quiet: {
    ROOT: "bg-surface-container text-on-surface-variant",
    DISC: "bg-surface-container-high text-on-surface-variant",
  },
  dead: {
    ROOT: "bg-surface-container text-on-surface-variant cursor-not-allowed",
    DISC: "bg-surface-container-high text-on-surface-variant",
  },
  /** The engine will attempt this send and fail: routed and on, but not set up. */
  attempt: {
    ROOT: "bg-warning-container text-on-warning-container",
    DISC: "bg-warning text-warning-foreground",
  },
} satisfies Record<string, { ROOT: string; DISC: string }>;

export type CellTone = keyof typeof CELL_TONE;

/** The ring alone, so an unsaved tick can compose over whichever ground it lands on. */
export const CELL_PENDING_RING = "shadow-[inset_0_0_0_2px_var(--primary)]";

// -----------------------------------------------------------------------------
// The channel rail
// -----------------------------------------------------------------------------

export const RAIL = {
  ROOT: "flex flex-wrap items-center gap-2",
  /** A 36px selector pill. The active state is a fill, never a border. */
  PILL: "h-9 gap-[7px] rounded-pill px-3.5 text-[0.8125rem] font-medium pointer-coarse:h-11",
  PILL_REST:
    "bg-surface-container text-on-surface-variant hover:bg-surface-container-high",
  PILL_ACTIVE: "bg-primary text-primary-foreground hover:bg-primary/90",
  /** 7px. On the selected pill it inherits the pill's own ink instead. */
  DOT: "size-[7px] flex-none rounded-pill",
  DOT_ON_ACTIVE: "bg-current",
} as const;

/** The rail dot is a second channel beside the pill label, never the only one. */
export const RAIL_DOT_TONE = {
  ready: "bg-success",
  attention: "bg-warning",
  off: "bg-on-surface-variant/50",
} as const;

export type RailDotTone = keyof typeof RAIL_DOT_TONE;

// -----------------------------------------------------------------------------
// Fields and the channel switch
// -----------------------------------------------------------------------------

/** 42px. Named once so `SHELL` and the skeleton box cannot drift apart. */
const FIELD_HEIGHT = "h-[2.625rem]";

export const FIELD = {
  ROW: "flex flex-col gap-[7px]",
  LABEL: "text-[0.8125rem] font-semibold",
  HINT: "text-on-surface-variant text-xs leading-[1.5]",
  HEIGHT: FIELD_HEIGHT,
  /**
   * 42px, 20px radius, NO rest border. The bangs are not decoration: the
   * `Input` primitive's own `h-9 rounded-md border` out-specifies a call site
   * whenever the utility names sort ahead of ours, and its `dark:bg-input/30`
   * is a (0,2,0) rule that beats an unprefixed fill outright.
   */
  SHELL: `${FIELD_HEIGHT}! w-full rounded-field! border-0! bg-surface-container dark:bg-surface-container! px-4 text-sm text-on-surface shadow-none! placeholder:text-on-surface-variant`,
  /** `SHELL` drops the rest border, so the ring alone has to carry invalid. */
  INVALID: "aria-invalid:ring-[3px] aria-invalid:ring-destructive/50",
  /** Machine voice: a phone number, an address, a Discord id. */
  MONO: "font-mono text-[0.8125rem]",
  /** A figure the user types, not one the device emitted. */
  NUM: "tabular-nums",
  /** The threshold field never needs the full column. */
  NARROW: "max-w-[17.5rem]",
  ERROR: "text-destructive-on-surface text-xs leading-[1.5]",
} as const;

/** 66px: the row's own resting height, kept as a floor so a long translated
 *  description can still wrap. The skeleton reads the same constant. */
const SWITCH_MIN_HEIGHT = "min-h-[4.125rem]";

/** The channel master switch. On, it becomes a primary container. */
export const SWITCH_ROW = {
  MIN_HEIGHT: SWITCH_MIN_HEIGHT,
  ROOT: `flex ${SWITCH_MIN_HEIGHT} items-center gap-3.5 rounded-tile px-[1.125rem] py-3.5`,
  REST: "bg-surface-container text-on-surface",
  ON: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  TEXT: "min-w-0 flex-1",
  TITLE: "text-sm font-semibold",
  DESC: "mt-0.5 text-xs opacity-85",
} as const;

// -----------------------------------------------------------------------------
// The save bar
// -----------------------------------------------------------------------------

export const SAVEBAR = {
  ROOT: "flex flex-wrap items-center gap-3 pt-1",
  STATUS: "text-on-surface-variant flex items-center gap-2 text-[0.8125rem]",
  ACTIONS: "ml-auto flex gap-2.5",
  /** The one ambient loop on this surface, and only while something is unsaved. */
  PULSE: "animate-pulse-ring size-[7px] flex-none rounded-pill bg-primary",
} as const;

// -----------------------------------------------------------------------------
// The activity log
// -----------------------------------------------------------------------------

/** One day's block of rows. 6px apart, no hairline rules. */
export const LOG = "flex flex-col gap-1.5";

/** The stack of day blocks. */
export const LOG_STACK = "flex flex-col gap-3";

/** Skeleton and content share ONE grid cell, so the box is sized by the taller
 *  of the two and the swap between them contributes zero layout shift. */
export const CROSSFADE_STACK =
  "grid grid-cols-1 grid-rows-1 *:col-start-1 *:row-start-1";

/**
 * PINNED at 52px, which is what lets the skeleton mirror it exactly: 8px of
 * padding over an 18.9px message line, a 2px gap and a 16px meta line. The
 * values are restated from the Network Events row rather than imported —
 * sibling families do not reach into each other's shapes.
 */
const ROW_HEIGHT = "h-[3.25rem]";

export const ROW = {
  HEIGHT: ROW_HEIGHT,
  ROOT: `flex ${ROW_HEIGHT} items-center gap-3 rounded-tile px-4 py-2`,
  /** The settle from weighted to quiet. It must read as a row going quiet. */
  TRANSITION:
    "transition-colors duration-(--duration-standard) ease-standard motion-reduce:transition-none",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: "size-4",
  BODY: "flex min-w-0 flex-1 flex-col gap-[2px]",
  MESSAGE: "truncate text-sm leading-[1.35] font-medium",
  META: "flex h-4 min-w-0 items-center gap-1.5",
  /** Size overrides only; the role stays the `Tag` variant's job. */
  META_CHIP: "h-4 shrink-0 px-1.5 py-0 text-[0.6875rem] leading-none",
  /** On a tinted row the chip takes the container's OWN ink; a neutral-ramp
   *  stroke on a chromatic surface is a crossed pair. */
  META_CHIP_ON_TONAL: "border-current/45 text-current",
  /** Machine voice: a recipient the device addressed verbatim. */
  META_ID:
    "text-on-surface-variant truncate font-mono text-[0.6875rem] leading-none",
  /** Inherit the container's `on-` ink on a chromatic row. */
  META_ID_ON_TONAL: "truncate font-mono text-[0.6875rem] leading-none opacity-90",
  WHEN: "flex flex-none flex-col items-end pl-2",
  RELATIVE: "text-[0.8125rem] leading-none font-semibold tabular-nums",
  ABSOLUTE: "text-[0.6875rem] leading-none tabular-nums pt-[4px]",
} as const;

/** Ink for the absolute time on a row that has no chromatic container. */
export const ABSOLUTE_INK = "text-on-surface-variant";

/** The row grounds. A reboot record is not an alert, so it stays neutral. */
export const ROW_TONE = {
  sent: {
    ROOT: "bg-success-container text-on-success-container",
    DISC: "bg-success text-success-foreground",
  },
  failed: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
  },
  notable: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-warning text-warning-foreground",
  },
  neutral: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
  },
} satisfies Record<string, { ROOT: string; DISC: string }>;

export type RowTone = keyof typeof ROW_TONE;

/** True for the two grounds that carry their own `on-` ink. */
export const ROW_TONE_IS_TONAL = {
  sent: true,
  failed: true,
  notable: false,
  neutral: false,
} satisfies Record<RowTone, boolean>;

/** The day divider. The one place the canon allows a square edge. */
export const DAY = {
  ROOT: "flex items-center gap-3 px-1",
  LABEL:
    "text-on-surface-variant shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase",
  RULE: "h-px flex-1 bg-border",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/**
 * The two condition tones this surface can reach. Keyed onto `BadgeVariant` so
 * a tone with no matching role fails the build.
 */
export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION:
    "mt-1 h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11",
} as const;

/**
 * A condition block is one of the three sanctioned container uses: the block IS
 * the state. The retry pill is drawn from the container's own ink, never a wash.
 */
export const CONDITION_TONE = {
  muted: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
    ACTION: "bg-on-surface/10 text-on-surface hover:bg-on-surface/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

/** A coverage or staleness notice: non-blocking, above the thing, never replacing it. */
export const NOTICE =
  "rounded-field flex items-center gap-2 px-3.5 py-2 text-xs leading-[1.35] font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";

export const NOTICE_TONE = {
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
} satisfies Partial<Record<BadgeVariant, string>>;

export type NoticeTone = keyof typeof NOTICE_TONE;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/**
 * Every placeholder box reads its geometry from the loaded view's own constant,
 * so a height can never drift out from under its skeleton.
 */
export const SKELETON = {
  TILE: `${TILE.HEIGHT} rounded-tile`,
  CELL: `${CELL_MIN_HEIGHT} rounded-tile`,
  ROW: `${ROW_HEIGHT} rounded-tile`,
  SWITCH: `${SWITCH_MIN_HEIGHT} rounded-tile`,
  FIELD: `${FIELD_HEIGHT} rounded-field`,
  /** A text placeholder takes the small role radius, not the row's. */
  LINE: "rounded-inline",
} as const;
