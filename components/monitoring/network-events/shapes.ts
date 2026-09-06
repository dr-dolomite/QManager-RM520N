import type { BadgeVariant } from "@/components/ui/badge";

// Network Events — the /monitoring family's geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT =
  "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** The device's event ring holds 300; the CGI serves the newest 50 of them. */
export const RING_CAP = 300;

/** A 36px header pill. The coarse-pointer bump is what reaches the 44px floor. */
export const PILL_ACTION =
  "h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11";

/** The pill's lucide glyph. */
export const PILL_GLYPH = "size-4";

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
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile bg-card px-5 py-4",
  HEIGHT: "h-[6.5rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/** The band's disc fills. Only the Ongoing tile picks between them at runtime. */
export const DISC_NEUTRAL = "bg-surface-container-high text-on-surface-variant";
export const DISC_ALERT = "bg-warning text-warning-foreground";

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** The figure. `tabular-nums` in the UI face, never mono: it is a live count. */
export const TILE_VALUE =
  "truncate text-[1.375rem] leading-[1.1] font-bold tracking-[-0.015em] tabular-nums";

/** Ink for a figure that is reporting something standing. */
export const TILE_VALUE_ALERT = "text-warning-on-surface";

export const TILE_CAPTION = "text-on-surface-variant truncate text-xs";

// -----------------------------------------------------------------------------
// The log card
// -----------------------------------------------------------------------------

export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** The filter and sort rail. Wraps rather than scrolling. */
export const RAIL = "flex flex-wrap items-center gap-2";

/** A 36px filter chip. The active state is a fill, never a border. */
export const FILTER_PILL =
  "h-9 gap-1.5 rounded-pill px-3.5 text-[0.8125rem] font-medium pointer-coarse:h-11";
export const FILTER_PILL_REST =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";
export const FILTER_PILL_ACTIVE =
  "bg-primary text-primary-foreground hover:bg-primary/90";
/** The live count riding inside a chip. */
export const FILTER_COUNT = "text-[0.6875rem] font-semibold tabular-nums opacity-70";

// -----------------------------------------------------------------------------
// The log
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
 * padding over an 18.9px message line, a 2px gap and a 16px meta line.
 */
const ROW_HEIGHT = "h-[3.25rem]";

export const ROW = {
  HEIGHT: ROW_HEIGHT,
  ROOT: `flex ${ROW_HEIGHT} items-center gap-3 rounded-tile px-4 py-2`,
  /** The settle from weighted to quiet. It must read as a row going quiet. */
  TRANSITION: "transition-colors duration-(--duration-standard) ease-standard",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: "size-4",
  BODY: "flex min-w-0 flex-1 flex-col gap-[2px]",
  MESSAGE: "truncate text-sm leading-[1.35] font-medium",
  META: "flex h-4 min-w-0 items-center gap-1.5",
  /** Size overrides only; the role stays the `Tag` variant's job. */
  META_CHIP: "h-4 shrink-0 px-1.5 py-0 text-[0.6875rem] leading-none",
  /** On a tinted row the chip takes the container's OWN ink; a neutral-ramp
   *  stroke on a chromatic surface is a crossed pair. 65% is the floor that
   *  holds it at 3:1 on all three tonal rows; 45% measured 2.13:1 on
   *  `warning-container` in light. */
  META_CHIP_ON_TONAL: "border-current/65 text-current",
  /** "Ongoing" is a plain marker, not a status chip: the row's tonal container
   *  already reports the state and the disc already carries the glyph. */
  META_MARKER: "flex shrink-0 items-center gap-1 text-[0.6875rem] leading-none font-semibold",
  META_MARKER_DOT: "size-1.5 flex-none rounded-pill bg-current",
  /** Machine voice: an identifier the device emitted verbatim. */
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
  ACTION: "mt-1 h-9 gap-2 rounded-pill px-4 text-sm font-medium pointer-coarse:h-11",
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

/** A stale-data notice: non-blocking, above the list, never replacing it. */
export const NOTICE =
  "rounded-field bg-destructive-container text-on-destructive-container flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";
