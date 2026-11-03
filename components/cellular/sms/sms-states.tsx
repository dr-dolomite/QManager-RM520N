"use client";

import * as React from "react";

import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  THREAD_DISC_SIZE,
  THREAD_LIST_GAP,
  THREAD_ROW_FRAME,
} from "./sms-threads";

// =============================================================================
// sms-states — every panel the SMS surface can show instead of content
// =============================================================================
// No-thread-selected, empty inbox, loading and fetch error (the send-failed
// state lives on the bubble itself, in sms-conversation.tsx). Never a blank
// panel.
//
// The state discs follow DESIGN.md > The Glyph-Disc Rule: a state or category
// icon sits on the role's STRONG fill, so the discs are `bg-{role}` +
// `{role}-foreground`. Neutral has no strong step, so it keeps
// `surface-container-high`.
// =============================================================================

export type SmsStateTone = "neutral" | "primary" | "destructive";

const STATE_DISC: Record<SmsStateTone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  primary: "bg-primary text-primary-foreground",
  destructive: "bg-destructive text-destructive-foreground",
};

export interface SmsStatePanelProps {
  icon: MaterialSymbolName;
  tone?: SmsStateTone;
  title: string;
  description: string;
  /** Optional second line, set smaller: the machine's own words about a failure. */
  detail?: string | null;
  /** Optional single call to action. */
  action?: React.ReactNode;
  className?: string;
  /** `status` by default; the fetch-error panel passes `alert`. */
  role?: "status" | "alert";
}

/** The centred glyph-disc state panel every empty/error surface here uses. */
export function SmsStatePanel({
  icon,
  tone = "neutral",
  title,
  description,
  detail,
  action,
  className,
  role = "status",
}: SmsStatePanelProps) {
  return (
    <div
      role={role}
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mb-1 grid size-13 flex-none place-items-center rounded-full",
          STATE_DISC[tone],
        )}
      >
        {/* MaterialSymbol sets fontSize inline: size is always explicit. */}
        <MaterialSymbol name={icon} size={24} />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-on-surface-variant max-w-[17rem] text-xs leading-relaxed text-balance">
        {description}
      </p>
      {detail ? (
        <p className="text-on-surface-variant max-w-[17rem] text-[0.6875rem] leading-relaxed text-balance">
          {detail}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Thread-list skeleton.
 *
 * The Skeleton-Mirror Rule: the frame, disc size and row gap are imported from
 * `sms-threads.ts`, the same constants the real row reads, so the two cannot
 * drift apart. Only the text slivers are approximations, because text is the
 * one thing whose width the loaded state does not fix either.
 */
export function SmsThreadListSkeleton({ rows = 6 }: { rows?: number }) {
  // Deterministic widths: a random set would reflow on every re-render while
  // the fetch is still in flight, which reads as the list thrashing.
  const widths = ["58%", "44%", "66%", "50%", "62%", "48%"];
  const previews = ["88%", "74%", "55%", "80%", "68%", "72%"];

  return (
    <div
      aria-hidden="true"
      className={cn("flex flex-col px-2.5 pb-3", THREAD_LIST_GAP)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={THREAD_ROW_FRAME}>
          <Skeleton className={cn(THREAD_DISC_SIZE, "flex-none rounded-full")} />
          <div className="min-w-0 flex-1 pt-0.5">
            <Skeleton
              className="h-2.5 rounded-full"
              style={{ width: widths[i % widths.length] }}
            />
            <Skeleton
              className="bg-surface-container mt-2 h-2 rounded-full"
              style={{ width: previews[i % previews.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Conversation skeleton: alternating bubble blanks at the loaded proportions. */
export function SmsConversationSkeleton() {
  const bubbles: Array<{ side: "in" | "out"; w: string }> = [
    { side: "in", w: "62%" },
    { side: "out", w: "40%" },
    { side: "in", w: "54%" },
    { side: "in", w: "70%" },
  ];

  return (
    <div
      aria-hidden="true"
      className="flex min-h-0 flex-1 flex-col justify-end gap-2 px-5 pt-5 pb-6 @2xl/pane:px-7"
    >
      {bubbles.map((b, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-10 rounded-[1.125rem]",
            b.side === "out"
              ? "bg-primary-container/60 self-end"
              : "bg-surface dark:bg-surface-container-high self-start",
          )}
          style={{ width: b.w }}
        />
      ))}
    </div>
  );
}
