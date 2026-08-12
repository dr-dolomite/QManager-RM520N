"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

import { PILL_QUIET, POSTURE, POSTURE_DISC } from "./shapes";

// =============================================================================
// scan-states — the results card's empty and error panels
// =============================================================================
// The error block below existed byte-for-byte in BOTH scanning routes, down to
// the `py-16` and the `max-w-xs`. It also carried two of the patterns the canon
// replaces: `bg-destructive/10` (an opacity wash where a tone step belongs) and
// a `rounded-full` disc (a radius outside the role scale).
//
// Both panels are the same object as the hero's posture rail — a disc, a title,
// a line of body, centred in a tile — so they import `POSTURE` rather than
// restating it. That is what keeps `SKELETON_SHAPE.POSTURE` an honest mirror of
// every state this surface can be in.
//
// THE ERROR NAMES THE PROBLEM AND THE RECOVERY. The message from the worker is
// the title; the body says what to do about it; the button does it. An error
// that only apologises is the one shape this product's voice rules out.
// =============================================================================

export interface ScanStatePanelProps {
  /**
   * `empty` is "nothing has run yet", `error` is "a run failed". They take the
   * idle and failed tones from the shared posture map, so a state panel and the
   * hero above it can never disagree about what a tone means.
   */
  tone: "empty" | "error";
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}

const STATE_TONE = {
  empty: { disc: POSTURE_DISC.idle, glyph: "radar", filled: false },
  error: { disc: POSTURE_DISC.failed, glyph: "error", filled: true },
} as const;

export function ScanStatePanel({
  tone,
  title,
  body,
  action,
}: ScanStatePanelProps) {
  const spec = STATE_TONE[tone];

  return (
    <div className={POSTURE.ROOT} role={tone === "error" ? "alert" : undefined}>
      <span className={cn(POSTURE.DISC, spec.disc)}>
        {/* 32, matching the hero rail's disc. `POSTURE.DISC` grew to 64px and
            these panels are the same object at a different address, so a 24px
            glyph would float inside an oversized circle here only. */}
        <MaterialSymbol name={spec.glyph} size={32} filled={spec.filled} />
      </span>
      <span className={POSTURE.TITLE}>{title}</span>
      <span className={POSTURE.BODY}>{body}</span>
      {action ? (
        <Button
          type="button"
          variant="tonal-neutral"
          className={PILL_QUIET}
          onClick={action.onClick}
        >
          <MaterialSymbol name="refresh" size={16} />
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export interface ScanErrorStateProps {
  /** The worker's own message. Falls back to `title` when it has none. */
  message?: string | null;
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
}

export function ScanErrorState({
  message,
  title,
  body,
  retryLabel,
  onRetry,
}: ScanErrorStateProps) {
  return (
    <ScanStatePanel
      tone="error"
      title={message || title}
      body={body}
      action={{ label: retryLabel, onClick: onRetry }}
    />
  );
}

export interface ScanEmptyStateProps {
  title: string;
  body: string;
  /** Optional: the hero already carries the primary action on both routes. */
  action?: { label: string; onClick: () => void };
}

export function ScanEmptyState({ title, body, action }: ScanEmptyStateProps) {
  return <ScanStatePanel tone="empty" title={title} body={body} action={action} />;
}
