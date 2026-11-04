// =============================================================================
// SMS Forwarding — the family shape module
// =============================================================================
// Scoped to `sms/forwarding/`: the two forwarding cards and the page shell are
// the only consumers. The SMS Center is a two-pane conversation UI with its own
// layout, so nothing here implies a shared contract with it. Follows the
// per-family convention (`band-locking/shapes.ts`, `cell-scanner/shapes.ts`):
// geometry lives here once, and the loaded view and its skeleton both read it,
// so a skeleton never restates a number and the handoff never snaps.
// =============================================================================

import type { ConditionTone } from "@/components/cellular/condition-screen";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The two-up card grid. A container query, never a viewport breakpoint. */
export const CARD_GRID = "grid grid-cols-1 gap-5 @3xl/main:grid-cols-2";

/** Equal heights are explicit, so a card whose data hasn't landed isn't shorter. */
export const CARD_CELL = "h-full *:data-[slot=card]:h-full";

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

/**
 * The SMS Forwarding cards. `rounded-card` (16px), not `rounded-hero`: two
 * co-equal, height-locked peers in a 2-up grid means neither anchors, so both
 * take the `card` step. Declares `@container/card` at the call site, as the
 * canon requires (`Card` does not).
 */
export const CARD_SHELL =
  "@container/card h-full gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** The card foot sits inside the card's `px-6` gutter. */
export const CARD_FOOT_GUTTER = "px-6";

// -----------------------------------------------------------------------------
// Forwarding form
// -----------------------------------------------------------------------------

/** Skeleton line boxes for the forwarding form, mirroring the loaded rows. */
export const FORM_SKELETON = {
  /** The On/Off segmented pill. */
  TOGGLE: "h-[2.625rem] w-32 rounded-pill",
  LABEL: "h-4 w-28 rounded-inline",
  INPUT: "h-9 w-full max-w-sm rounded-field",
  /** The `SaveButton` in the card foot. */
  ACTION: "h-[2.625rem] w-32 rounded-pill",
} as const;

// -----------------------------------------------------------------------------
// Delivery health
// -----------------------------------------------------------------------------

export const HEALTH_SHAPE = {
  /** The focal status block: one tone container, the page's first answer. */
  BLOCK: "flex items-start gap-3.5 rounded-tile px-5 py-4",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  EYEBROW: "text-xs font-semibold text-on-surface-variant",
  BUBBLE: "rounded-tile bg-surface-container px-4 py-3",
  /** The focal status statement, at the Title step (18px/600). */
  STATE_LABEL: "text-lg leading-tight font-semibold",
  STATE_DETAIL: "text-sm leading-relaxed opacity-90",
  /** The quiet "nothing wrong" row: glyph and ink, no container. */
  QUIET_ROW: "flex items-center gap-2 text-sm text-on-surface-variant",
} as const;

/**
 * Pinned block heights, in px, spent as inline styles at both the loaded and
 * skeleton ends so the handoff never snaps.
 */
export const HEALTH_HEIGHT = {
  STATE: 80,
  BUBBLE: 44,
  NOTICE: 68,
} as const;

/** Skeleton line boxes for the health card, mirroring `HEALTH_SHAPE`. */
export const HEALTH_SKELETON = {
  EYEBROW: "h-4 w-28 rounded-inline",
  HINT: "h-4 w-44 rounded-inline",
  ACTION: "h-[2.625rem] w-32 rounded-pill",
} as const;

/**
 * Relay health -> a container tone. Four states, four DISTINCT glyphs: the
 * containers sit as close as 1.03:1, so the glyph is the separating channel.
 * `unconfigured` takes `primary` (an invitation, not a fault); `off` is
 * `neutral` (a choice, not a state to alarm about).
 */
export const HEALTH_TONE = {
  active: "success",
  issue: "warning",
  unconfigured: "primary",
  off: "neutral",
} as const satisfies Record<string, ConditionTone>;
