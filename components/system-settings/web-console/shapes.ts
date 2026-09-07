// Web Console — the route's geometry and tone contract.
// The page shell, card grammar and action pill are IMPORTED from the family one
// level up and re-exported (the Logs / Languages precedent), so a component here
// reaches "./shapes" and never "../shapes". Below them is the console's own
// furniture: the card's definite height, the terminal pane and the two tone maps.

import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2Icon,
  LoaderCircleIcon,
  PlugZapIcon,
  PowerOffIcon,
  RefreshCwIcon,
  ShieldXIcon,
  WifiOffIcon,
} from "lucide-react";

import type { ConditionTone } from "@/components/cellular/condition-screen";
import type { BadgeVariant } from "@/components/ui/badge";
import type { ConsoleFailureKind } from "@/hooks/use-web-console";

import type { ChipKey } from "./derive";

import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  META_INK_ON_TONAL,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
} from "../shapes";

export {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
};

// -----------------------------------------------------------------------------
// The console
// -----------------------------------------------------------------------------

/**
 * The pane's own padding, restated as an inset so anything covering the
 * terminal lands on exactly the terminal's rectangle.
 */
const PANE_INSET = "absolute inset-3";

export const CONSOLE = {
  /**
   * A column wrapper with no height of its own. Both the page and the card wear
   * it, so it has to nest without either one claiming the row.
   */
  SLOT: "flex min-w-0 min-h-0 flex-col",
  /**
   * The full-screen sheet. INSET rather than bled to the viewport edge, so the
   * card keeps `rounded-card` — a square corner is not on the shape scale.
   */
  OVERLAY: "fixed inset-3 z-50",
  /**
   * The card's height in page flow. A terminal has no content height to resolve
   * to, so this is the one card in the family that states one: the viewport
   * less the app shell's chrome, this route's header and the page gutters.
   * The floor keeps the pane usable on a short window; the page scrolls there.
   */
  HEIGHT: "h-[calc(100svh-12.5rem)] min-h-[26rem] overflow-hidden",
  /** The card inside the sheet, which is already a definite box. */
  HEIGHT_FULL: "h-full overflow-hidden",
  /** The hints-and-actions row under the title. It spans the header's grid. */
  TOOLS:
    "col-span-full flex flex-col gap-3 pt-1 @2xl/card:flex-row @2xl/card:items-center",
  /**
   * The copy and paste hints. They render at EVERY width — a narrow,
   * touch-adjacent screen is where guessing a paste shortcut is hardest.
   */
  HINTS: "flex flex-wrap items-center gap-x-4 gap-y-1.5",
  HINT: "text-on-surface-variant flex items-center gap-1.5 text-xs",
  ACTIONS: "flex flex-wrap items-center gap-2 @2xl/card:ml-auto",
  /**
   * The machine surface. `surface-container` is one step above the card it sits
   * in, so the pane is legible without a hairline, and xterm's own background
   * resolves from the SAME token at runtime (`terminal-theme.ts`).
   */
  PANE: "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tile bg-surface-container p-3",
  /** The box xterm mounts into. */
  TERMINAL: "min-h-0 flex-1",
  /** The state block's cover. The terminal host stays mounted underneath it. */
  COVER: `${PANE_INSET} grid place-items-center`,
  /** Backend words quoted inside the block — machine voice. */
  DETAIL: `font-mono text-xs leading-relaxed break-words ${META_INK_ON_TONAL}`,
  /** The block itself, capped so it does not stretch across a wide pane. */
  BLOCK: "w-full max-w-md",
} as const;

/** The lucide glyph inside a status chip, sized to the chip's 12px text. */
export const CHIP_GLYPH = "size-3";

/** The spin class, named once so the chip and the pane agree. */
export const SPIN = "animate-spin";

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------

export interface ChipFace {
  variant: BadgeVariant;
  glyph: LucideIcon;
  spin?: boolean;
}

/** `Record` rather than `satisfies` here only so the optional `spin` survives
 *  the union: `satisfies` keeps each literal, and five of them omit it. */

/**
 * What the chip says, to a role and a glyph. Keyed onto `ChipKey` — the live
 * states plus the hook's four failure kinds — so a state without a face fails
 * the build.
 *
 * SEVEN DISTINCT GLYPHS. The fills cannot separate them on their own:
 * `success-container` and `warning-container` measure 1.03:1 apart, and
 * `refused` and `dropped` share `destructive` outright, so the glyph is the
 * only channel that tells the four settled kinds apart.
 */
export const STATE_CHIP: Record<ChipKey, ChipFace> = {
  connecting: { variant: "info", glyph: LoaderCircleIcon, spin: true },
  reconnecting: { variant: "info", glyph: RefreshCwIcon, spin: true },
  connected: { variant: "success", glyph: CheckCircle2Icon },
  unreachable: { variant: "warning", glyph: PlugZapIcon },
  refused: { variant: "destructive", glyph: ShieldXIcon },
  dropped: { variant: "destructive", glyph: WifiOffIcon },
  // The shell exited on its own terms: deliberately inactive, never a failure.
  ended: { variant: "muted", glyph: PowerOffIcon },
};

export interface FailureFace {
  tone: ConditionTone;
  glyph: LucideIcon;
}

/**
 * Failure kind to condition tone, and the same glyph the chip used, so the two
 * slots never disagree about what happened. `warning` where the user can fix it
 * where they stand, `destructive` where the link or the server said no,
 * `neutral` where nothing went wrong at all.
 */
export const FAILURE_FACE = {
  unreachable: { tone: "warning", glyph: PlugZapIcon },
  refused: { tone: "destructive", glyph: ShieldXIcon },
  dropped: { tone: "destructive", glyph: WifiOffIcon },
  ended: { tone: "neutral", glyph: PowerOffIcon },
} satisfies Record<ConsoleFailureKind, FailureFace>;

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------

export const SKELETON = {
  /**
   * The pane's placeholder. It wears the cover box rather than a height of its
   * own, so it fills exactly the terminal's rectangle instead of sharing the
   * pane's row with the host it stands in for.
   */
  PANE: `${PANE_INSET} rounded-tile`,
} as const;
