"use client";

import * as React from "react";
import {
  ArrowRightLeftIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Repeat2Icon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import {
  splitEventMessage,
  type EventPresentation,
  type EventTone,
} from "@/lib/event-presentation";
import type { NetworkEvent } from "@/types/modem-status";

import { ABSOLUTE_INK, NOW, ROW } from "./shapes";

/** Four tones, four distinct glyphs. Two states never share one. */
export const TONE_GLYPH = {
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  error: XCircleIcon,
  routine: ArrowRightLeftIcon,
} satisfies Record<EventTone, LucideIcon>;

const BAND_GROUP = /^[Bn]\d+(?:\s*[+,]\s*[Bn]\d+)*$/;

/** Bands are identity (`Tag`); PCI and "was B28" are quantities in the UI face. */
export function EventIdentifiers({
  identifiers,
  chromatic,
}: {
  identifiers: readonly string[];
  chromatic: boolean;
}) {
  return (
    <>
      {identifiers.map((id) =>
        BAND_GROUP.test(id) ? (
          id.split(/\s*[+,]\s*/).map((band) => (
            <Tag
              key={`${id}-${band}`}
              variant={band.startsWith("n") ? "nr" : "lte"}
              className={cn(ROW.META_CHIP, chromatic && ROW.META_CHIP_ON_TONAL)}
            >
              {band}
            </Tag>
          ))
        ) : (
          <span
            key={id}
            className={chromatic ? ROW.META_ID_ON_TONAL : ROW.META_ID}
          >
            {id.replace(/\s*->\s*/g, " → ")}
          </span>
        ),
      )}
    </>
  );
}

function RowWhen({
  timeAgo,
  clockTime,
  presentation,
}: {
  timeAgo: string;
  clockTime: string;
  presentation: EventPresentation;
}) {
  return (
    <div className={ROW.WHEN}>
      <span className={cn(ROW.RELATIVE, presentation.messageClass)}>
        {timeAgo}
      </span>
      <span
        className={cn(
          ROW.ABSOLUTE,
          presentation.chromatic ? "opacity-80" : ABSOLUTE_INK,
        )}
      >
        {clockTime}
      </span>
    </div>
  );
}

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
  // A chromatic container supplies the ink for every line inside it.
  const { chromatic } = presentation;

  return (
    <div className={cn(ROW.ROOT, ROW.TRANSITION, presentation.containerClass)}>
      <RowWhen
        timeAgo={timeAgo}
        clockTime={clockTime}
        presentation={presentation}
      />
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
              className={cn(ROW.META_CHIP, chromatic && ROW.META_CHIP_ON_TONAL)}
            >
              {typeLabel}
            </Tag>
          )}
          <EventIdentifiers identifiers={identifiers} chromatic={chromatic} />
        </div>
      </div>

      <span aria-hidden />
    </div>
  );
}

export interface RunRowProps {
  id: string;
  membersId: string;
  presentation: EventPresentation;
  severityWord: string;
  title: string;
  meta: string;
  timeAgo: string;
  clockTime: string;
  open: boolean;
  toggleLabel: string;
  onToggle: () => void;
}

/** One row standing for a run of repeats; Show / Hide on the right edge. */
export function RunRow({
  id,
  membersId,
  presentation,
  severityWord,
  title,
  meta,
  timeAgo,
  clockTime,
  open,
  toggleLabel,
  onToggle,
}: RunRowProps) {
  const { chromatic } = presentation;
  return (
    <div
      id={id}
      className={cn(ROW.ROOT, ROW.TRANSITION, presentation.containerClass)}
    >
      <RowWhen
        timeAgo={timeAgo}
        clockTime={clockTime}
        presentation={presentation}
      />
      <span
        aria-hidden
        className={cn(ROW.DISC, ROW.TRANSITION, presentation.discClass)}
      >
        <Repeat2Icon className={ROW.GLYPH} />
      </span>
      <div className={ROW.BODY}>
        <span className="sr-only">{severityWord}</span>
        <span className={cn(ROW.MESSAGE, presentation.messageClass)}>
          {title}
        </span>
        <div className={ROW.META}>
          <span className={chromatic ? ROW.META_ID_ON_TONAL : ROW.META_ID}>
            {meta}
          </span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? membersId : undefined}
        aria-label={toggleLabel}
        onClick={onToggle}
        className={ROW.GROUP_TOGGLE}
      >
        <span className={ROW.GROUP_TOGGLE_LABEL}>{toggleLabel}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(ROW.GROUP_CHEVRON, open && ROW.GROUP_CHEVRON_OPEN)}
        />
      </Button>
    </div>
  );
}

export interface JumpRowProps {
  presentation: EventPresentation;
  title: string;
  meta: string;
  timeAgo: string;
  clockTime: string;
  onSelect: () => void;
}

/** A repeating run on Right now: the whole row is a button into the log. */
export function JumpRow({
  presentation,
  title,
  meta,
  timeAgo,
  clockTime,
  onSelect,
}: JumpRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(ROW.ROOT, ROW.TRANSITION, NOW.JUMP)}
    >
      <RowWhen
        timeAgo={timeAgo}
        clockTime={clockTime}
        presentation={presentation}
      />
      <span aria-hidden className={cn(ROW.DISC, presentation.discClass)}>
        <Repeat2Icon className={ROW.GLYPH} />
      </span>
      <span className={ROW.BODY}>
        <span className={cn(ROW.MESSAGE, presentation.messageClass)}>
          {title}
        </span>
        <span className={ROW.META}>
          <span className={ROW.META_ID}>{meta}</span>
        </span>
      </span>
      <span aria-hidden />
    </button>
  );
}

export interface MemberRowProps {
  event: NetworkEvent;
  presentation: EventPresentation;
  severityWord: string;
  clockTime: string;
}

/** A run member: quiet regardless of age, no meta line, clock time only. */
export function MemberRow({
  event,
  presentation,
  severityWord,
  clockTime,
}: MemberRowProps) {
  const Glyph = TONE_GLYPH[presentation.tone];
  const { text, identifiers } = splitEventMessage(event.message);
  return (
    <div className={ROW.MEMBER_ROOT}>
      <span className={ROW.MEMBER_WHEN}>{clockTime}</span>
      <span aria-hidden className={cn(ROW.MEMBER_DISC, presentation.discClass)}>
        <Glyph className={ROW.MEMBER_GLYPH} />
      </span>
      <div className={ROW.MEMBER_BODY}>
        <span className="sr-only">{severityWord}</span>
        <span className={ROW.MEMBER_MESSAGE}>{text}</span>
        <EventIdentifiers identifiers={identifiers} chromatic={false} />
      </div>
      <span aria-hidden />
    </div>
  );
}
