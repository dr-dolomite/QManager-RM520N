"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TbInfoCircleFilled } from "react-icons/tb";

// -----------------------------------------------------------------------------
// InfoTip — keyboard-focusable info tooltip trigger (shared across the Alerts
// surface). The trigger is a real <button>, so it is reachable by keyboard and
// the tooltip is announced with the given aria-label (WCAG 2.2).
// -----------------------------------------------------------------------------
export function InfoTip({ text, aria }: { text: string; aria: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-info inline-flex shrink-0"
          aria-label={aria}
        >
          <TbInfoCircleFilled className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}
