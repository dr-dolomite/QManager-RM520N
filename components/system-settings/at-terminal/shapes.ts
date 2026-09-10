// =============================================================================
// AT Terminal — the console's geometry and tone contract
// =============================================================================
// The page shell, card grammar and state block are IMPORTED from the family one
// level up and re-exported (the Logs / Languages precedent), so a component
// inside this route imports from "./shapes" and never reaches across "../shapes".
//
// Everything below them is the console's own grammar. The transcript is a LOG
// VIEW, not a settings surface: it keeps hairline rules on `--border` rather
// than the tonal row pills used elsewhere in the family, because density
// survives there where pills would not (DESIGN.md > Data display).
//
// The numbers this module adds:
//
//   42px prompt field   36px header action   32px gate disc   28px copy button
// =============================================================================

import type { BadgeVariant } from "@/components/ui/badge";

import type { EntryStatus } from "./derive";

import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  COARSE_TARGET,
  FOCUS_RING,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
} from "../shapes";

export {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FOCUS_RING,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
};

// -----------------------------------------------------------------------------
// Focus rings, per ground
// -----------------------------------------------------------------------------

/**
 * The ring's 2px GAP takes the colour of whatever the control sits on, so the
 * family's page-ground `FOCUS_RING` cuts a visible halo anywhere else. Same
 * split as `software-update/shapes.ts`; these are this route's three grounds.
 */
const FOCUS_RING_BASE =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2";

/** Host = the card's own surface, or the dialog panel's (both `bg-surface`). */
export const FOCUS_RING_ON_SURFACE = `${FOCUS_RING_BASE} focus-visible:ring-offset-surface`;

/** Host = the commands popover's panel. */
export const FOCUS_RING_ON_POPOVER = `${FOCUS_RING_BASE} focus-visible:ring-offset-popover`;

/** Host = the confirmation gate's tonal container, the loudest mismatch. */
export const FOCUS_RING_ON_WARNING = `${FOCUS_RING_BASE} focus-visible:ring-offset-warning-container`;

/** The spin class, named once so the prompt and any sibling agree. */
export const SPIN = "animate-spin";

// -----------------------------------------------------------------------------
// The card
// -----------------------------------------------------------------------------

/** The console body: transcript, hint, gate, prompt. */
export const CONSOLE_BODY = "flex min-w-0 flex-col gap-3";

/**
 * The header's action rail. It spans the header's full width and only pulls
 * right at `@2xl/card` — parked in the grid's right column it starves the
 * title, and three actions collapse the description to a ribbon on a phone.
 */
export const HEAD_ACTIONS =
  "col-span-full flex flex-wrap items-center gap-2 pt-1 @2xl/card:pt-0 @2xl/card:justify-end";

/** A 36px header action, the family's action pill one step down. */
export const HEAD_ACTION =
  "h-9 gap-1.5 rounded-pill px-3.5 text-[0.8125rem] font-medium pointer-coarse:h-11";

/** The glyph inside a header action, and inside the game chip. */
export const HEAD_GLYPH = "size-4";

/** The Signal Storm chip's glyph, sized to the chip's 12px text. */
export const CHIP_GLYPH = "size-3";

// -----------------------------------------------------------------------------
// The transcript
// -----------------------------------------------------------------------------

/**
 * The scroll viewport is PINNED at its floor and capped by the viewport, so the
 * prompt does not walk up the page as the console fills. Both states — the
 * empty block and the log — wear the same floor, so the first command lands
 * without the card resizing under the cursor.
 */
const TRANSCRIPT_FLOOR = "min-h-[16rem]";

export const TRANSCRIPT = {
  // `svh` rather than `vh`: mobile Safari counts the collapsible URL bar into
  // `vh`, so the cap could exceed the viewport this line exists to stay inside.
  ROOT: `${TRANSCRIPT_FLOOR} max-h-[clamp(16rem,50svh,40rem)] overflow-y-auto overscroll-contain`,
  /** The rules. `--border` is for genuine table rules, and this is one. */
  LIST: "flex flex-col divide-y divide-border border-y border-border",
  EMPTY: `${TRANSCRIPT_FLOOR} flex items-center justify-center`,
  /** The empty block fills the viewport rather than shrink-wrapping its title. */
  EMPTY_BLOCK: "w-full",
} as const;

/**
 * One transcript row. `group/row` is what lets the copy affordance answer to
 * both hover and keyboard focus without a second state variable.
 */
export const ROW = {
  ROOT: "group/row flex items-start gap-3 px-2 py-2.5",
  /**
   * The clock column. Machine voice: the stamp the entry carries, mono and
   * tabular so the column is a column rather than a ragged edge.
   */
  TIME: "text-on-surface-variant w-[4.25rem] flex-none pt-[2px] font-mono text-[0.6875rem] leading-5 tabular-nums",
  /** The tone glyph. Three distinct shapes — colour is never the only channel. */
  GLYPH: "mt-[3px] size-3.5 flex-none",
  BODY: "flex min-w-0 flex-1 flex-col gap-0.5",
  /** The echoed command: the exact string the device was handed. */
  COMMAND: "font-mono text-[0.8125rem] leading-5 font-medium break-all",
  /** The device's own answer, newlines preserved. */
  RESPONSE: "font-mono text-xs leading-5 break-words whitespace-pre-wrap",
  /**
   * Revealed on hover AND focus — a hover-only control is unreachable by key,
   * and on a coarse pointer neither fires at all, so touch gets it outright at
   * the 44px floor.
   */
  COPY: "size-7 flex-none rounded-pill opacity-0 transition-opacity duration-[var(--duration-quick)] ease-out group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100",
  COPY_GLYPH: "size-3.5",
} as const;

/**
 * Status to status ROLE, keyed onto `BadgeVariant` so a status the console
 * grows without a matching role fails the build rather than rendering untoned.
 *
 * `blocked` is `muted` — the command was deliberately not sent, which is not a
 * failure. `error` is the failure.
 */
export const STATUS_TONE = {
  success: "success",
  error: "destructive",
  blocked: "muted",
} satisfies Record<EntryStatus, BadgeVariant>;

export type StatusTone = (typeof STATUS_TONE)[EntryStatus];

interface RowInk {
  /** The tone glyph's ink — the `-on-surface` ramp, measured against a card. */
  GLYPH: string;
  /** The response body's ink. */
  RESPONSE: string;
}

/**
 * A row's ink, keyed onto the tone rather than onto the status, so the two maps
 * cannot drift apart. The command line always takes the card's own ink: it is
 * what the user typed, and tinting it would say the input was at fault.
 */
export const ROW_INK = {
  success: {
    GLYPH: "text-success-on-surface",
    RESPONSE: "text-on-surface-variant",
  },
  destructive: {
    GLYPH: "text-destructive-on-surface",
    RESPONSE: "text-destructive-on-surface",
  },
  muted: {
    GLYPH: "text-on-surface-variant",
    RESPONSE: "text-on-surface-variant",
  },
} satisfies Record<StatusTone, RowInk>;

// -----------------------------------------------------------------------------
// The completion hint
// -----------------------------------------------------------------------------

/**
 * The tab-completion preview. It replaces a 9px label at 35% opacity — under
 * every contrast floor the system has — with the `Kbd` primitive at the 12px
 * Label step and the on-surface-variant ink.
 */
export const HINT = {
  ROOT: "flex min-w-0 items-center gap-2 px-2",
  TEXT: "text-on-surface-variant min-w-0 truncate font-mono text-[0.8125rem]",
  KEY: "text-on-surface-variant bg-surface-container-high h-5 rounded-inline px-1.5 text-xs",
} as const;

// -----------------------------------------------------------------------------
// The confirmation gate
// -----------------------------------------------------------------------------

/**
 * A filled tonal banner, replacing a `border-warning/30` over `bg-warning/10`
 * wash — not a stable colour, since a 10% alpha over a tinted surface collapses
 * in dark mode. Container fill plus its measured ink, the glyph on the role's
 * STRONG fill, `rounded-field`, and no border on a tonal container.
 */
export const GATE = {
  ROOT: "flex items-start gap-3 rounded-field bg-warning-container px-4 py-[0.875rem] text-on-warning-container",
  DISC: "grid size-8 flex-none place-items-center rounded-pill bg-warning text-warning-foreground",
  DISC_GLYPH: "size-[1.125rem]",
  BODY: "flex min-w-0 flex-1 flex-col gap-2",
  TITLE: "text-sm leading-[1.35] font-semibold",
  TEXT: "min-w-0 text-[0.8125rem] leading-relaxed break-words",
  /** The command being gated, quoted in the device's own voice. */
  COMMAND: "font-mono text-xs break-all opacity-90",
  ACTIONS: "flex flex-wrap items-center gap-2 pt-0.5",
  /**
   * Both actions are RAW buttons, the `ConditionBlock` precedent, and both are
   * re-grounded on the container's OWN ink. `variant="ghost"` plus a tonal fill
   * is the trap `button.tsx` documents: ghost's `dark:hover:bg-accent/50`
   * compiles to a `:is(.dark *)`-qualified selector and outranks a plain
   * `hover:` override, so the tonal hover silently loses in dark mode.
   */
  ACTION_BASE: `inline-flex items-center justify-center transition-colors duration-[var(--duration-quick)] ease-out ${PILL_ACTION}`,
  CONFIRM:
    "bg-on-warning-container text-warning-container hover:bg-on-warning-container/90 focus-visible:ring-on-warning-container",
  DISMISS:
    "bg-on-warning-container/10 hover:bg-on-warning-container/15 focus-visible:ring-on-warning-container",
} as const;

// -----------------------------------------------------------------------------
// The prompt
// -----------------------------------------------------------------------------

/**
 * The 42px control height, IMPORTANT-MARKED and written exactly once. The
 * marker lives INSIDE the literal: appended at a call site it never reaches
 * Tailwind's scanner, so the rule is never generated at all.
 */
const PROMPT_HEIGHT = "h-[2.625rem]!";

/**
 * The family's `FOCUS_RING`, on the `focus-within` axis — the ring belongs to
 * the pill, and the thing that takes focus is the bare input inside it. The gap
 * takes the CARD's ground, which is what the bar actually sits on.
 */
const PROMPT_RING =
  "focus-within:outline-none focus-within:ring-[3px] focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-surface";

/**
 * The prompt bar, replacing a flush square-cornered `InputGroup` with a hairline
 * and a shadow.
 *
 * THE FILL IS ONE STEP ABOVE ITS HOST. The bar's host is the card, which is
 * `bg-surface`, so `surface-container` is exactly host + 1 (The Field-Step
 * Rule). The dark half is explicit and important-marked for the same reason the
 * family's `FIELD` is: once both rules are prefixed they tie, and a tie is
 * decided by Tailwind's name sort rather than by the call site.
 */
export const PROMPT = {
  ROOT: `flex ${PROMPT_HEIGHT} w-full items-center gap-2 rounded-pill bg-surface-container dark:bg-surface-container! pr-1.5 pl-4 ${PROMPT_RING}`,
  /** The `❯` glyph. A prompt sigil, so mono. */
  GLYPH: "text-on-surface-variant flex-none font-mono text-sm leading-none select-none",
  /**
   * A bare input rather than the `Input` primitive: the primitive ships its own
   * radius, hairline and dark fill, and the pill around it already carries all
   * three.
   */
  INPUT:
    "placeholder:text-on-surface-variant min-w-0 flex-1 border-0 bg-transparent font-mono text-[0.84375rem] outline-none disabled:cursor-not-allowed disabled:opacity-50",
  /**
   * The Send pill, inset inside the bar. It paints 34px and cannot grow inside
   * a 42px bar, so the coarse-pointer floor is met by the family's overlay.
   */
  SEND: `h-[2.125rem] flex-none gap-1.5 rounded-pill px-4 text-[0.8125rem] font-semibold ${COARSE_TARGET}`,
  SEND_GLYPH: "size-4",
} as const;

// -----------------------------------------------------------------------------
// The commands popover
// -----------------------------------------------------------------------------

export const POPOVER = {
  CONTENT: "w-84 rounded-field p-0",
  /** The `cmdk` list, off the primitive's own square-ish corners. */
  LIST: "max-h-72",
  /** An item never repeats its container's radius — one step down (DESIGN.md). */
  ITEM: "gap-2 rounded-inline",
  LABEL: "min-w-0 flex-1 truncate text-[0.8125rem] font-medium",
  /** The command preview: metadata, so an outline `Tag`, never a filled chip. */
  PREVIEW: "max-w-36 shrink-0 font-mono",
  PREVIEW_TEXT: "truncate",
  FOOT: "text-on-surface-variant flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs",
  /** A live figure, so tabular. */
  COUNT: "tabular-nums",
  /** Its ground is the popover panel, and touch takes it to the 44px floor. */
  MANAGE: `inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium underline underline-offset-2 transition-colors duration-[var(--duration-quick)] ease-out hover:text-on-surface pointer-coarse:h-11 pointer-coarse:px-3 ${FOCUS_RING_ON_POPOVER}`,
} as const;

/** The Manage Custom Commands dialog. */
export const MANAGE = {
  CONTENT: "max-w-lg rounded-card",
  LIST: "flex flex-col gap-1",
  ROW: "flex items-center gap-2 rounded-field px-3 py-2 transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container",
  ROW_TEXT: "flex min-w-0 flex-1 flex-col",
  ROW_LABEL: "truncate text-sm font-medium",
  ROW_COMMAND: "text-on-surface-variant truncate font-mono text-xs",
  DELETE: "size-8 flex-none rounded-pill pointer-coarse:size-11",
  DELETE_GLYPH: "size-3.5",
  EMPTY: "text-on-surface-variant py-4 text-center text-sm",
  FORM: "flex flex-wrap items-center gap-2",
  /**
   * Two text fields on a dialog ground; `surface-container` is host + 1. The
   * basis is what makes the row wrap instead of squeezing a mono AT command
   * into ~90px beside a flex-none Add pill.
   */
  FIELD: `${PROMPT_HEIGHT} min-w-0 flex-1 basis-40 rounded-pill border-0 bg-surface-container px-4 text-[0.84375rem] dark:bg-surface-container! aria-invalid:ring-[3px] aria-invalid:ring-destructive/40 ${FOCUS_RING_ON_SURFACE}`,
  FIELD_MONO: "font-mono",
  ADD: PILL_ACTION,
  ERROR: "text-destructive-on-surface text-xs",
} as const;
