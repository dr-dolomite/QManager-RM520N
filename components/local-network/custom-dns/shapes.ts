// Custom DNS: this family's geometry, imported by the loaded cards and their skeletons.
// Restated from the IP Passthrough family, never imported across families.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] min-w-0 flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
} as const;

/** IPv4 and IPv6 sit side by side from a 64rem column (where an IPv6 field still fits beside its key), stacked below it. */
export const FAMILY_GRID = "grid grid-cols-1 gap-5 @5xl/main:grid-cols-2";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";
export const CARD_PAD = "px-6";
export const CARD_TITLE = "min-w-0 text-lg leading-tight";
/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

// -----------------------------------------------------------------------------
// Setting rows
// -----------------------------------------------------------------------------

const ROW_MIN_H = "min-h-[2.625rem]";
const KEY_LH = "leading-5";
/** A 42px control, the field and the segmented track alike. */
const CONTROL_H = "h-[2.625rem]";

export const SETTING = {
  /** One card's rows. */
  GROUP: "flex min-w-0 flex-col gap-5",
  /**
   * The Resolver card is full width: past 64rem its two rows sit side by side,
   * so a key never drifts a whole card away from its control.
   */
  GROUP_WIDE:
    "grid min-w-0 grid-cols-1 gap-5 @5xl/card:grid-cols-2 @5xl/card:gap-x-12",
  /** Key left, control right; on a narrow card the control wraps, still right-aligned. */
  ROW: `flex ${ROW_MIN_H} flex-wrap items-center justify-between gap-x-4 gap-y-2`,
  /** Shrinks beside its control down to 12rem before the control wraps beneath it. */
  KEY: "flex min-w-0 flex-[1_1_12rem] flex-col gap-px transition-opacity duration-[var(--duration-standard)] ease-standard",
  /** A server slot's one-word key ("Primary") needs far less before its field wraps. */
  KEY_SLOT: "flex min-w-0 flex-[1_1_5rem] flex-col gap-px transition-opacity duration-[var(--duration-standard)] ease-standard",
  KEY_LINE: `inline-flex items-center gap-1.5 text-sm ${KEY_LH} font-medium`,
  KEY_SUB: "text-on-surface-variant text-xs text-pretty",
  /** A held row dims its text; the disabled control dims itself, so the two never compound. */
  HELD: "opacity-55",
  CONTROL: "ml-auto flex max-w-full flex-col items-end gap-1.5",
} as const;

/** The provider list: an open-ended set of names, so a Select, at one width. */
export const PROVIDER_TRIGGER = "w-56 max-w-full";

/**
 * An address field: 42px, machine voice (addresses are opaque strings you
 * compare), its width sized to the family's longest literal.
 */
export const ADDRESS = {
  INPUT: `${CONTROL_H} px-3.5 font-mono text-[0.84375rem] font-medium placeholder:font-sans`,
  V4: "w-60 max-w-full",
  V6: "w-80 max-w-full",
  /**
   * The invalid state as an inset ring, so the field's box does not change
   * (and nothing beside it moves) the moment a character goes wrong.
   */
  INVALID:
    "shadow-[inset_0_0_0_2px_var(--destructive)] focus-visible:ring-destructive/30",
} as const;

/** A family's validation line, under its rows on the card's left edge. */
export const FIELD_ERROR = "text-destructive-on-surface text-xs leading-[1.5]";

/** The foot status: a block reason or a failure, in destructive ink. */
export const FOOT = {
  BLOCKED: "text-destructive-on-surface text-xs",
  FAILED: "text-destructive-on-surface inline-flex items-center gap-1.5 text-xs",
  GLYPH: "size-3.5 shrink-0",
} as const;

/** RM520N: the live upstream list, read-only, one address per line in machine voice. */
export const ANSWER = {
  LIST: "flex max-w-full flex-col items-end gap-0.5",
  ADDRESS: "font-mono text-[0.84375rem] font-medium leading-5 break-all text-right",
  NONE: "text-on-surface-variant text-sm leading-5",
} as const;

/** RM520N: the banners above the cards. */
export const BANNERS = "flex flex-col gap-3";

// -----------------------------------------------------------------------------
// A failed read
// -----------------------------------------------------------------------------

/** One horizontal block in place of the Resolver card's rows. */
export const CONDITION = {
  ROOT: "flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-tile bg-surface-container px-4 py-3.5 text-on-surface",
  DISC: "grid size-11 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  GLYPH: "size-[1.375rem]",
  TEXT: "flex min-w-0 flex-[1_1_14rem] flex-col gap-0.5",
  TITLE: "text-[0.9375rem] font-semibold",
  BODY: "text-on-surface-variant text-[0.8125rem] text-pretty",
  ACTION: "ml-auto h-9 bg-on-surface/10 px-4 text-on-surface hover:bg-on-surface/15",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every box reads the loaded view's own line box. */
export const SKELETON = {
  ROW_KEY: `h-5 w-24 rounded-inline`,
  ROW_SUB: `h-4 w-48 max-w-full rounded-inline`,
  PILL: `${CONTROL_H} rounded-pill`,
  FIELD: `${CONTROL_H} rounded-field`,
  ACTION: `${CONTROL_H} w-40 rounded-pill`,
} as const;
