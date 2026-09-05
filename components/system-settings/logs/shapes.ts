// =============================================================================
// System Logs — the /system-settings/logs family's geometry and tone contract
// =============================================================================
// Two sources, and the split is deliberate.
//
// The page shell, band and card grammar are IMPORTED from
// `components/system-settings/shapes.ts`: that is the same family one level up,
// and re-declaring its twenty names would be the duplication the restate rule
// exists to prevent.
//
// The transcript grammar — rail, row, day divider, notice, condition — is
// RESTATED from `components/monitoring/network-events/shapes.ts` rather than
// imported. A sibling family's module is not a shared library; what is shared
// is the SYSTEM's numbers. Those numbers, verbatim:
//
//   52px pinned row   32px row disc   36px filter chip   6px row gap
// =============================================================================

import type { BadgeVariant } from "@/components/ui/badge";
import type { LogLevel } from "@/types/system-logs";

import {
  BAND,
  CAPTION,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  CONDITION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FIELD,
  FOCUS_RING,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  SKELETON,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
  type DiscTone,
} from "../shapes";

export {
  BAND,
  CAPTION,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  // The state block's geometry, IMPORTED rather than restated: the family one
  // level up already owns it, and the local copy was byte-identical.
  CONDITION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FIELD,
  FOCUS_RING,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  SKELETON,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
};
export type { DiscTone };

// -----------------------------------------------------------------------------
// The Feed tile's ambient loop
// -----------------------------------------------------------------------------

/**
 * The surface's ONE ambient loop (One-Loop Rule), spent on the Feed disc and
 * only while the 10s poll is actually armed. `animate-pulse-ring` is the
 * canon's CSS-only keyframe on the ambient token, and its reduced-motion block
 * lives beside it in `globals.css` — nothing here starts it from JS.
 */
export const FEED_RING =
  "animate-pulse-ring absolute -inset-1.5 rounded-pill bg-primary/25";

/** The box the ring and the disc share. Flex, so it shrink-wraps the disc
 *  instead of inheriting an inline box's line-height. */
export const FEED_DISC_WRAP = "relative flex flex-none";

// -----------------------------------------------------------------------------
// The transcript card
// -----------------------------------------------------------------------------

/** The card body: rail, filter row, notice, log. */
export const CARD_BODY = "flex flex-col gap-4";

/** The level rail. Wraps rather than scrolling. */
export const RAIL = "flex flex-wrap items-center gap-2";

/** A 36px filter chip. The active state is a FILL, never a border. */
export const FILTER_PILL =
  "h-9 gap-1.5 rounded-pill px-3.5 text-[0.8125rem] font-medium pointer-coarse:h-11";
export const FILTER_PILL_REST =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";
export const FILTER_PILL_ACTIVE =
  "bg-primary text-primary-foreground hover:bg-primary/90";

/** The live count riding inside a chip. NO alpha: `primary-foreground` on
 *  `primary` is 4.60:1 at full strength, so any wash drops it under AA. */
export const FILTER_COUNT = "text-[0.6875rem] font-semibold tabular-nums";

/** Row 2: search, component, line budget, archived. */
export const FILTER_ROW = "flex flex-wrap items-end gap-2.5";

/** The search field's box — it takes the rail's slack. */
export const SEARCH_BOX = "relative min-w-[12rem] flex-1";

export const SEARCH_GLYPH =
  "text-on-surface-variant pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2";

/**
 * The family's `FIELD`, released from the settings-row width lock and padded
 * for the leading search glyph. This rail sizes controls to their content, not
 * to a row's control column.
 *
 * Two counters to `input.tsx`, written INSIDE the constant: its viewport-keyed
 * `md:text-sm` survives `twMerge` and rendered 14px beside two 13.5px selects,
 * and it has no coarse bump, so the field sat at 42px beside their 44px.
 */
export const FIELD_SEARCH = `${FIELD} pl-11 pointer-coarse:h-11! md:text-[0.84375rem] @2xl/card:w-full @2xl/card:min-w-0`;

/**
 * A select trigger on the rail. The coarse bump is IMPORTANT-MARKED inside the
 * constant: `select.tsx` ships its own height behind a data-attribute selector,
 * which outranks a bare media-variant utility, and a marker written outside the
 * constant never reaches Tailwind's scanner at all.
 */
export const FIELD_SELECT = `${FIELD} pointer-coarse:h-11!`;

/** The line-budget select — a three-digit figure needs no 216px floor. */
export const FIELD_SELECT_NARROW = `${FIELD} pointer-coarse:h-11! @2xl/card:min-w-[7rem]`;

/** The archived switch and its label, paired. */
export const SWITCH_ROW = "flex h-[2.625rem] items-center gap-2.5 px-1";
export const SWITCH_LABEL =
  "text-on-surface-variant text-[0.8125rem] font-medium whitespace-nowrap";

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
  /** Scoped to two named properties, and every custom property takes `var()`. */
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
  DISC: "grid size-8 flex-none place-items-center rounded-pill",
  GLYPH: "size-4",
  BODY: "flex min-w-0 flex-1 flex-col gap-[2px]",
  MESSAGE: "truncate text-sm leading-[1.35] font-medium",
  META: "flex h-4 min-w-0 items-center gap-1.5 overflow-hidden",
  /** Size overrides only; the role stays the `Tag` variant's job. It SHRINKS,
   *  unlike the reference's, because this chip holds a raw device component
   *  name: `cgi_neighbour_scan_status` was 156px in a 143px box at 375px. */
  META_CHIP: "h-4 min-w-0 shrink px-1.5 py-0 text-[0.6875rem] leading-none",
  /** The name inside the chip. `Tag` is a flex box, so the text truncates. */
  META_CHIP_TEXT: "truncate",
  /** On a tinted row the chip takes the container's OWN ink; a neutral-ramp
   *  stroke on a chromatic surface is a crossed pair. 65% is the floor that
   *  keeps the stroke at 3:1 on both containers (45% measured 2.13:1 on
   *  `warning-container`), which `tag.tsx` requires of every tag border. */
  META_CHIP_ON_TONAL: "border-current/65 text-current",
  /** Machine voice: the PID the device emitted verbatim. */
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

/** The same figure on a tinted row. 90%, not 80% — at 80% the clock measured
 *  4.44:1 on `warning-container` in light, and it now matches META_ID_ON_TONAL. */
export const ABSOLUTE_INK_ON_TONAL = "opacity-90";

/**
 * Level to status ROLE. Keyed onto `BadgeVariant`, so a level the backend grows
 * without a matching role fails the build rather than rendering untoned.
 *
 * `DEBUG` is `muted` — the deliberately-quiet level — and never `secondary`,
 * which is not one of the five status roles.
 */
export const LEVEL_TONE = {
  ERROR: "destructive",
  WARN: "warning",
  INFO: "info",
  DEBUG: "muted",
} satisfies Record<LogLevel, BadgeVariant>;

export type LevelTone = (typeof LEVEL_TONE)[LogLevel];

interface RowSpec {
  /** The row's own container. Only the two weighted levels take a tone. */
  CONTAINER: string;
  /** The 32px glyph disc — a FILL pair, never a container pair. */
  DISC: string;
  /** True where the container supplies the ink for every line inside it. */
  CHROMATIC: boolean;
}

/**
 * The row's surfaces, keyed onto `LevelTone` rather than onto a level. A tone
 * with no row spec fails the build, so the two maps cannot drift apart.
 */
export const ROW_TONE = {
  destructive: {
    CONTAINER: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    CHROMATIC: true,
  },
  warning: {
    CONTAINER: "bg-warning-container text-on-warning-container",
    DISC: "bg-warning text-warning-foreground",
    CHROMATIC: true,
  },
  info: {
    CONTAINER: "bg-surface-container",
    DISC: "bg-primary text-primary-foreground",
    CHROMATIC: false,
  },
  muted: {
    CONTAINER: "bg-surface-container",
    DISC: "bg-surface-container-high text-on-surface-variant",
    CHROMATIC: false,
  },
} satisfies Record<LevelTone, RowSpec>;

/** The day divider. The one place the canon allows a square edge. */
export const DAY = {
  ROOT: "flex items-center gap-3 px-1",
  LABEL:
    "text-on-surface-variant shrink-0 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase",
  RULE: "h-px flex-1 bg-border",
} as const;

/** A stale-data notice: non-blocking, above the log, never replacing it. */
export const NOTICE =
  "rounded-field bg-destructive-container text-on-destructive-container flex items-center gap-2 px-3.5 py-2 text-xs leading-4 font-medium";
export const NOTICE_GLYPH = "size-3.5 flex-none";

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** A row placeholder wears the real row's PINNED height, never a restated one. */
export const SKELETON_ROW = `${ROW_HEIGHT} rounded-tile`;
