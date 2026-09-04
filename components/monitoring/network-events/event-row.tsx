"use client";

import * as React from "react";
import {
  ArrowRightLeftIcon,
  CheckCircle2Icon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import {
  splitEventMessage,
  type EventPresentation,
  type EventTone,
} from "@/lib/event-presentation";
import type { NetworkEvent } from "@/types/modem-status";

import { ABSOLUTE_INK, ROW } from "./shapes";

/** Four tones, four distinct glyphs. Two states never share one. */
const TONE_GLYPH = {
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  error: XCircleIcon,
  routine: ArrowRightLeftIcon,
} satisfies Record<EventTone, LucideIcon>;

export interface EventRowProps {
  event: NetworkEvent;
  presentation: EventPresentation;
  /** Translated event-type label, e.g. "Cell Handoff". */
  typeLabel: string;
  /** Translated screen-reader severity word. */
  severityWord: string;
  /** Translated "Ongoing" marker, rendered in place of the type tag. */
  ongoingLabel: string;
  unresolved: boolean;
  timeAgo: string;
  clockTime: string;
}

export function EventRow({
  event,
  presentation,
  typeLabel,
  severityWord,
  ongoingLabel,
  unresolved,
  timeAgo,
  clockTime,
}: EventRowProps) {
  const Glyph = TONE_GLYPH[presentation.tone];
  const { text, identifiers } = splitEventMessage(event.message);
  // A chromatic container supplies the ink for every line inside it, so the row
  // must not also set per-line colours.
  const { chromatic } = presentation;

  return (
    <div
      className={cn(ROW.ROOT, ROW.TRANSITION, presentation.containerClass)}
    >
      <span
        aria-hidden
        className={cn(ROW.DISC, ROW.TRANSITION, presentation.discClass)}
      >
        <Glyph className={ROW.GLYPH} />
      </span>

      <div className={ROW.BODY}>
        <span className="sr-only">{severityWord}</span>
        <span className={cn(ROW.MESSAGE, presentation.messageClass)}>
          {text}
        </span>
        <div className={ROW.META}>
          {unresolved ? (
            <span className={ROW.META_MARKER}>
              <span aria-hidden className={ROW.META_MARKER_DOT} />
              {ongoingLabel}
            </span>
          ) : (
            <Tag
              variant="neutral"
              className={cn(
                ROW.META_CHIP,
                chromatic && ROW.META_CHIP_ON_TONAL,
              )}
            >
              {typeLabel}
            </Tag>
          )}
          {identifiers.map((id) => (
            <span
              key={id}
              className={chromatic ? ROW.META_ID_ON_TONAL : ROW.META_ID}
            >
              {id}
            </span>
          ))}
        </div>
      </div>

      <div className={ROW.WHEN}>
        <span className={cn(ROW.RELATIVE, presentation.messageClass)}>
          {timeAgo}
        </span>
        <span
          className={cn(ROW.ABSOLUTE, chromatic ? "opacity-80" : ABSOLUTE_INK)}
        >
          {clockTime}
        </span>
      </div>
    </div>
  );
}
