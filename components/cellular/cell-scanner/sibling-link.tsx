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
// Blocked while a run is in flight (one `flock` for both routes); `aria-disabled`
// keeps it focusable so the tooltip can carry the reason.
// =============================================================================

export interface SiblingRouteLinkProps {
  href: string;
  glyph: MaterialSymbolName;
  label: string;
  /** `null` when takeable; otherwise the stated reason, whose presence blocks the link. */
  blockedReason?: string | null;
  /** A shorter visible label below `@xl/section`; `label` stays the accessible name. */
  shortLabel?: string;
}

/** The visible label: the short form on a narrow host card when one is given. */
function LinkLabel({ label, shortLabel }: { label: string; shortLabel?: string }) {
  if (!shortLabel) return <>{label}</>;
  return (
    <>
      <span className="@xl/section:hidden">{shortLabel}</span>
      <span className="hidden @xl/section:inline">{label}</span>
    </>
  );
}

export function SiblingRouteLink({
  href,
  glyph,
  label,
  blockedReason = null,
  shortLabel,
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
            // The reason travels with the accessible name, not only in the tooltip.
            aria-label={`${label} — ${blockedReason}`}
          >
            <MaterialSymbol name={glyph} size={16} />
            <LinkLabel label={label} shortLabel={shortLabel} />
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
      <Link href={href} aria-label={shortLabel ? label : undefined}>
        <MaterialSymbol name={glyph} size={16} />
        <LinkLabel label={label} shortLabel={shortLabel} />
      </Link>
    </Button>
  );
}

export default SiblingRouteLink;
