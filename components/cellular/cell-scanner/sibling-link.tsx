"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { HERO_LINK } from "./shapes";

// =============================================================================
// SiblingRouteLink — the path between the two scanning routes
// =============================================================================
// It did not exist. A reader on the sweep page who wanted the two-second answer
// instead had to go back out to the sidebar and find it, on a surface whose
// entire argument is that these are two answers to one question at prices that
// differ by 100x. The link sits in the hero header, which is also the slot the
// retired posture chip used to occupy.
//
// -----------------------------------------------------------------------------
// WHY IT IS `aria-disabled` AND NOT `disabled`
// -----------------------------------------------------------------------------
// While a run is in flight the sibling route cannot start anything: the scan
// singleton is one `flock` shared by both, and the second scan is refused with
// `other_scan_running`. So the control is blocked — and DESIGN.md's
// State-Honesty Rule says a control that cannot currently work explains itself
// rather than sitting there dead.
//
// A `disabled` button cannot be focused and does not receive pointer events, so
// it can host neither a tooltip nor a keyboard reader's attention: the reason
// would be unreachable by exactly the users who most need it. `aria-disabled`
// keeps the control in the tab order, announces the blocked state, and lets the
// tooltip carry the reason on hover AND on focus. The element is a `<button>`
// with no handler, so there is nothing to navigate to in the blocked state
// regardless of what a click does.
// =============================================================================

export interface SiblingRouteLinkProps {
  href: string;
  glyph: MaterialSymbolName;
  label: string;
  /**
   * `null` when the link is takeable. A string is the STATED REASON it is not,
   * and its presence is what blocks the control — the two can never disagree.
   */
  blockedReason?: string | null;
}

export function SiblingRouteLink({
  href,
  glyph,
  label,
  blockedReason = null,
}: SiblingRouteLinkProps) {
  if (blockedReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="tonal-neutral"
            className={HERO_LINK.ROOT}
            aria-disabled="true"
            // The label alone reads as a working link to a screen reader; the
            // reason has to travel with the name, not only in the tooltip.
            aria-label={`${label} — ${blockedReason}`}
          >
            <MaterialSymbol name={glyph} size={16} />
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{blockedReason}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      asChild
      variant="tonal-neutral"
      className={HERO_LINK.ROOT}
    >
      {/* `next/link`, never an `<a>`: this is a static export served by lighttpd
          off the modem itself, and a full document load costs a round trip to
          the device the user is currently reconfiguring. */}
      <Link href={href}>
        <MaterialSymbol name={glyph} size={16} />
        {label}
      </Link>
    </Button>
  );
}

export default SiblingRouteLink;
