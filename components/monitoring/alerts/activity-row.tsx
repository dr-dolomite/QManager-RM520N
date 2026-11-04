"use client";

import type { LucideIcon } from "lucide-react";

import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import {
  ABSOLUTE_INK,
  ROW,
  ROW_TONE,
  ROW_TONE_IS_TONAL,
  type RowTone,
} from "./shapes";

export interface ActivityRowProps {
  tone: RowTone;
  /** One glyph per outcome. Two rows in this slot never share one. */
  icon: LucideIcon;
  /** Screen-reader word for the outcome, since the glyph is decorative. */
  severityWord: string;
  message: string;
  /** Channel or reboot cause: metadata, so a `Tag` and never a `Badge`. */
  tagLabel: string;
  /** A recipient the device addressed verbatim. Omitted when absent. */
  identifier?: string;
  timeAgo: string;
  /** Wall-clock time. Absent when the record carried no usable epoch. */
  clockTime?: string;
}

export function ActivityRow({
  tone,
  icon: Glyph,
  severityWord,
  message,
  tagLabel,
  identifier,
  timeAgo,
  clockTime,
}: ActivityRowProps) {
  const skin = ROW_TONE[tone];
  // A chromatic container supplies the ink for every line inside it, so the
  // row must not also set per-line colours.
  const tonal = ROW_TONE_IS_TONAL[tone];

  return (
    <div className={cn(ROW.ROOT, ROW.TRANSITION, skin.ROOT)}>
      <span aria-hidden className={cn(ROW.DISC, ROW.TRANSITION, skin.DISC)}>
        <Glyph className={ROW.GLYPH} />
      </span>

      <div className={ROW.BODY}>
        <span className="sr-only">{severityWord}</span>
        {/* Truncated by `ROW.MESSAGE`, so the full string has to survive somewhere. */}
        <span className={ROW.MESSAGE} title={message}>
          {message}
        </span>
        <div className={ROW.META}>
          <Tag
            variant="neutral"
            className={cn(ROW.META_CHIP, tonal && ROW.META_CHIP_ON_TONAL)}
          >
            {tagLabel}
          </Tag>
          {identifier ? (
            <span className={tonal ? ROW.META_ID_ON_TONAL : ROW.META_ID}>
              {identifier}
            </span>
          ) : null}
        </div>
      </div>

      <div className={ROW.WHEN}>
        <span className={ROW.RELATIVE}>{timeAgo}</span>
        {clockTime ? (
          <span className={cn(ROW.ABSOLUTE, tonal ? "opacity-90" : ABSOLUTE_INK)}>
            {clockTime}
          </span>
        ) : null}
      </div>
    </div>
  );
}
