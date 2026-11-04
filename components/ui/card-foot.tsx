import * as React from "react";

import { cn } from "@/lib/utils";

// =============================================================================
// CardFoot — the apply footer every editable card ends in
// =============================================================================
// The Card-Foot Apply Rule (DESIGN.md): a card that edits a draft commits it
// from a borderless row on its own bottom edge. Status on the left edge (change
// count, consequence, failure), actions on the right edge (Discard, then the
// `SaveButton`). One fixed-min-height slot, so nothing reflows between states.
//
// It is layout only: no copy, no icons, no state. Callers pass translated
// content, so the primitive stays route-neutral across both icon sets.
//
// `mt-auto` pins the row to the bottom only inside a flex-col parent (`Card` is
// one). Use a plain element, not `CardFooter`: its `[.border-t]:pt-6` fights
// `pt-4`. Never wrap a `SaveButton` in `AnimatePresence` inside the actions slot.
// =============================================================================

/** The row: no divider line (2026-10-05), fixed minimum height, wraps on a narrow card. */
export const CARD_FOOT =
  "mt-auto flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 pt-4";
/** Left edge: what is pending, its consequence, or what failed. */
export const CARD_FOOT_STATUS =
  "flex min-w-[13rem] flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground";
/** Right edge: Discard, secondary actions, then the `SaveButton` last. */
export const CARD_FOOT_ACTIONS = "ml-auto flex flex-wrap items-center justify-end gap-2.5";

export interface CardFootProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** Left-edge content. Omit for a quiet footer; the slot still holds the edge. */
  status?: React.ReactNode;
  /** Right-edge content: secondary actions first, the `SaveButton` last. */
  actions: React.ReactNode;
  /** Announce status changes (default true). */
  liveStatus?: boolean;
}

export function CardFoot({ status, actions, liveStatus = true, className, ...props }: CardFootProps) {
  return (
    <div data-slot="card-foot" className={cn(CARD_FOOT, className)} {...props}>
      <div className={CARD_FOOT_STATUS} aria-live={liveStatus ? "polite" : undefined}>
        {status}
      </div>
      <div className={CARD_FOOT_ACTIONS}>{actions}</div>
    </div>
  );
}
