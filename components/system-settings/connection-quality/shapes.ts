// =============================================================================
// Connection Quality — the /system-settings/connection-quality family's
// geometry and tone contract
// =============================================================================
// Two sources, and the split is deliberate.
//
// The page shell, band and card grammar are IMPORTED from
// `components/system-settings/shapes.ts` — the same family one level up, so
// re-declaring its names would be the duplication the restate rule prevents.
//
// Everything below the re-export block is LOCAL to this route: the probe-leg
// row, the mono field a target is typed into, the preset rail, the readout
// block under it, and the two tonal notes. Those are restated from the
// SYSTEM's numbers rather than imported from a sibling family:
//
//   42px control   28px leg disc   20px field radius   1.5px row gap
// =============================================================================

import type { PingProfileTargets } from "@/hooks/use-ping-profile";
import type { QualityPreset } from "@/types/modem-status";

import {
  BAND,
  CAPTION,
  CARD_BODY,
  CARD_CELL,
  CARD_DESC,
  CARD_GRID,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_ON_TONAL,
  COARSE_TARGET,
  CONDITION,
  CONDITION_PANEL,
  DELTA,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FIELD,
  FOCUS_RING,
  GROUP_FILL,
  LABEL_LINE,
  NOTICE,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  RECEIPT_ROW,
  ROW,
  ROW_GROUP,
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
  CARD_BODY,
  CARD_CELL,
  CARD_DESC,
  CARD_GRID,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_ON_TONAL,
  COARSE_TARGET,
  // The state block's geometry, IMPORTED rather than restated: the family one
  // level up already owns it, and this route is lucide like the rest of it.
  CONDITION,
  CONDITION_PANEL,
  DELTA,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FIELD,
  FOCUS_RING,
  GROUP_FILL,
  LABEL_LINE,
  NOTICE,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  RECEIPT_ROW,
  ROW_GROUP,
  SKELETON,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
};
export type { DiscTone };

// -----------------------------------------------------------------------------
// The Internet tile's ambient loop
// -----------------------------------------------------------------------------

/**
 * The surface's ONE ambient loop (One-Loop Rule), spent on the Internet disc
 * and only while the probe daemon is actually reporting. `animate-pulse-ring`
 * is the canon's CSS-only keyframe on the ambient token; its reduced-motion
 * block lives beside it in `globals.css` and nothing here starts it from JS.
 */
export const RING =
  "animate-pulse-ring absolute -inset-1.5 rounded-pill bg-primary/25";

/** The box the ring and the disc share. Flex, so it shrink-wraps the disc
 *  instead of inheriting an inline box's line-height. */
export const RING_WRAP = "relative flex flex-none";

/**
 * The answering leg's meta line: the target string beside its family tag.
 * Pinned to `CAPTION`'s own 18px line box so the tile stays at its 104px pin.
 */
export const TARGET_LINE = {
  ROW: "flex h-[1.125rem] min-w-0 items-center gap-1.5 overflow-hidden",
  /** Machine voice: the endpoint the daemon echoes back verbatim. */
  HOST: "text-on-surface-variant truncate font-mono text-[0.6875rem]",
  /** Size overrides only; the role stays the `Tag` variant's job. */
  CHIP: "h-4 min-w-0 shrink px-1.5 py-0 text-[0.6875rem] leading-none",
  CHIP_TEXT: "truncate",
} as const;

// -----------------------------------------------------------------------------
// Probe Targets — the four-leg chain
// -----------------------------------------------------------------------------

/**
 * The chain in PROBE ORDER, and the whole point of the design: the daemon
 * short-circuits on the first leg that answers. Both the card and the status
 * band index by it, so a fifth slot cannot land in one and not the other.
 */
export const SLOT_ORDER = [
  "target_host_1",
  "target_host_2",
  "target_ip_1",
  "target_ip_2",
] as const satisfies readonly (keyof PingProfileTargets)[];

export type SlotKey = (typeof SLOT_ORDER)[number];

/** The two hostname legs come first, so the RESOLVER picks the family. */
export const HOSTNAME_LEGS = 2;

/**
 * One numbered probe leg.
 *
 * A `min-h` FLOOR, not a pin: the kind sentence wraps to two lines on a narrow
 * container where a fixed height would clip it. Its skeleton wears `ROOT` and
 * fills it with slivers, so the height RESOLVES rather than being asserted.
 *
 * `REST` is empty on purpose — a resting leg has no fill of its own, because
 * it already sits on `ROW_GROUP`, so promotion is the only colour on the list.
 */
export const LEG = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
  /** Disc and text column, paired tighter than the row's own flip gap. */
  MAIN: "flex min-w-0 flex-1 items-start gap-3",
  DISC: "grid size-7 flex-none place-items-center rounded-pill",
  NUMBER: "text-[0.8125rem] leading-none font-semibold tabular-nums",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL: "text-[0.9375rem] font-semibold",
  /** The one-line kind sentence, on the family's consequence step. */
  KIND: ROW.CONSEQUENCE,
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
  REST: "",
  ANSWERED: "bg-primary-container text-on-primary-container",
  DISC_REST: "bg-surface-container-high text-on-surface-variant",
  DISC_ANSWERED: "bg-primary text-primary-foreground",
} as const;

/**
 * The family `FIELD` in machine voice: a probe target is an identifier the
 * device echoes back verbatim, so it is mono (The Machine-Voice Rule).
 *
 * The coarse bump is IMPORTANT-MARKED and written INSIDE the constant.
 * `input.tsx` ships its own height behind a higher-specificity selector, and a
 * marker written outside the constant never reaches Tailwind's scanner at all.
 * The 42px height and the explicit light/dark fill pair come from `FIELD`
 * unchanged — do not restate either here.
 */
export const FIELD_MONO = `${FIELD} font-mono pointer-coarse:h-11!`;

/** A validation message under a field. Its own ink, on the row's neutral fill. */
export const FIELD_ERROR =
  "text-destructive-on-surface text-xs leading-relaxed";

/**
 * A tonal note hanging under the leg group: what the chain is, and where probe
 * timing actually lives. `surface-container`, one step above the card, so it
 * reads as an aside rather than as another row.
 */
export const NOTE = {
  ROOT: "rounded-field bg-surface-container px-4 py-3",
  TEXT: "text-on-surface-variant text-[0.8125rem] leading-relaxed text-pretty",
  LINK: "text-primary-on-surface font-medium underline-offset-4 hover:underline",
} as const;

// -----------------------------------------------------------------------------
// Latency & Loss Thresholds
// -----------------------------------------------------------------------------

/**
 * What each preset actually means, mirrored from `_qt_apply_lat` /
 * `_qt_apply_loss` in `scripts/usr/lib/qmanager/events.sh`. It lives here
 * because the status band and the thresholds card both read it and neither
 * owns the other — the band needs the SAVED cut to tone its discs.
 *
 * The comparisons are the producer's, not a paraphrase: latency flags above
 * the cut, loss flags AT it.
 */
export const PRESET_LIMIT = {
  latency: {
    standard: { limit: 150, debounce: 3 },
    tolerant: { limit: 250, debounce: 3 },
    "very-tolerant": { limit: 500, debounce: 2 },
  },
  loss: {
    standard: { limit: 15, debounce: 3 },
    tolerant: { limit: 30, debounce: 3 },
    "very-tolerant": { limit: 50, debounce: 2 },
  },
} satisfies Record<
  "latency" | "loss",
  Record<QualityPreset, { limit: number; debounce: number }>
>;

/** One threshold block: its title, the reserved delta box, and its rail. */
export const BLOCK = {
  ROOT: "flex flex-col gap-3",
  HEAD: "flex min-h-[1.375rem] items-center gap-2 px-1",
  TITLE: "text-[0.9375rem] font-semibold",
} as const;

const PRESET_HEIGHT = "h-[2.625rem] pointer-coarse:h-11";

/**
 * The three-chip preset rail.
 *
 * AN AUTO-FIT GRID, NOT A WRAPPING FLEX ROW. `flex-wrap` plus `flex-1` divides
 * the full width among only the chips that wrapped, so a narrow rail renders
 * two peers beside one double-width outlier. A track list fixes every column
 * at the same width. Same idiom as the family's `DAY_PILL.RAIL`.
 *
 * `THUMB` is the travelling fill, shared by `layoutId`. A rail using it keeps
 * every chip on `OFF` and takes `ON_INK` for the selected label only —
 * painting `ON`'s fill underneath would leave the outgoing chip blue.
 */
export const PRESET = {
  RAIL: "grid items-center gap-1.5 grid-cols-[repeat(auto-fit,minmax(6rem,1fr))]",
  HEIGHT: PRESET_HEIGHT,
  ROOT: `relative ${PRESET_HEIGHT} min-w-0 rounded-pill px-3 text-[0.8125rem] font-semibold transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]`,
  ON: "bg-primary text-primary-foreground",
  ON_INK: "text-primary-foreground",
  OFF: "bg-surface-container-high text-on-surface-variant",
  /** Rides above `THUMB`, and truncates: `Molto tollerante` overruns a 96px
   *  column that `Standard` sits comfortably inside. */
  LABEL: "relative z-10 block min-w-0 truncate",
  THUMB: "absolute inset-0 rounded-pill bg-primary",
} as const;

/**
 * The readout under a rail: what the selected preset does, and what the live
 * reading is against it. NO BORDER — a hairline over a fill is chrome around
 * the colour rather than the edge of a block (The No-Hairline-On-Fill Rule).
 */
export const READOUT = {
  ROOT: "flex flex-col gap-2.5 rounded-field bg-surface-container-high px-4 py-3.5",
  TITLE: "text-[0.9375rem] font-semibold",
  BLURB:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  /** The live figure and its quality bar, on one line box. */
  BAR_ROW: "flex items-center gap-3",
  PAIRS: "grid grid-cols-3 gap-x-3 gap-y-1",
  PAIR: "flex min-w-0 flex-col gap-0.5",
  PAIR_LABEL: EYEBROW,
  /** A reading, so the UI face with `tabular-nums` — never `font-mono`. */
  PAIR_VALUE: "truncate text-[0.8125rem] font-semibold tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Line boxes — a rendered line's HEIGHT, never its font size. */
const LINE = {
  /** `LEG.LABEL` / `READOUT.TITLE` (15px/normal) and `BLOCK.TITLE`. */
  LABEL: "h-[1.375rem] rounded-inline",
  /** `LEG.KIND` and `READOUT.BLURB` at 12.5px/relaxed. */
  KIND: "h-[1.25rem] rounded-inline",
  /** `READOUT.PAIR_VALUE` at 13px. */
  PAIR: "h-[1.1875rem] rounded-inline",
} as const;

/**
 * Placeholders read their box from the loaded view's own constant, so a height
 * can never drift out from under its skeleton. A leg wears the real `LEG.ROOT`
 * at the call site, a chip wears `PRESET.ROOT`, a readout wears `READOUT.ROOT`,
 * and the band's tiles wear `TILE.ROOT` — this module restates none of them.
 */
export const SKELETON_LOCAL = {
  LEG: {
    DISC: "size-7 flex-none rounded-pill",
    LABEL: LINE.LABEL,
    KIND: LINE.KIND,
    /** The family's field placeholder, plus this route's coarse bump. */
    FIELD: `${SKELETON.TIME.FIELD} pointer-coarse:h-11`,
  },
  BLOCK: {
    TITLE: LINE.LABEL,
    /** Wears a `PRESET.RAIL` cell, so it tracks the grid, not a flex basis. */
    CHIP: `${PRESET_HEIGHT} min-w-0 rounded-pill`,
  },
  READOUT: {
    TITLE: LINE.LABEL,
    BLURB: LINE.KIND,
    PAIR_LABEL: "h-[1.0625rem] rounded-inline",
    PAIR_VALUE: LINE.PAIR,
  },
} as const;
