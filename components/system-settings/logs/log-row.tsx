"use client";

import type * as React from "react";
import {
  BugIcon,
  CircleXIcon,
  InfoIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { LogEntry, LogLevel } from "@/types/system-logs";

import {
  ABSOLUTE_INK,
  ABSOLUTE_INK_ON_TONAL,
  LEVEL_TONE,
  ROW,
  ROW_TONE,
} from "./shapes";

/**
 * Four levels, four DISTINCT glyphs. Two rows in the same slot never share one:
 * `destructive-container` and `warning-container` are near-identical surfaces
 * under deuteranopia, so the glyph is the only separator a row has.
 */
const LEVEL_GLYPH = {
  ERROR: CircleXIcon,
  WARN: TriangleAlertIcon,
  INFO: InfoIcon,
  DEBUG: BugIcon,
} satisfies Record<LogLevel, LucideIcon>;

export interface LogRowProps {
  entry: LogEntry;
  /** Translated screen-reader severity word. */
  severityWord: string;
  timeAgo: string;
  clockTime: string;
}

export function LogRow({
  entry,
  severityWord,
  timeAgo,
  clockTime,
}: LogRowProps): React.JSX.Element {
  const Glyph = LEVEL_GLYPH[entry.level];
  const spec = ROW_TONE[LEVEL_TONE[entry.level]];
  // A chromatic container supplies the ink for every line inside it, so the row
  // must not also set per-line colours.
  const chromatic = spec.CHROMATIC;

  return (
    <div className={cn(ROW.ROOT, ROW.TRANSITION, spec.CONTAINER)}>
      <span aria-hidden className={cn(ROW.DISC, ROW.TRANSITION, spec.DISC)}>
        <Glyph className={ROW.GLYPH} />
      </span>

      <div className={ROW.BODY}>
        <span className="sr-only">{severityWord}</span>
        <span className={ROW.MESSAGE}>{entry.message}</span>
        <div className={ROW.META}>
          <Tag
            variant="neutral"
            className={cn(ROW.META_CHIP, chromatic && ROW.META_CHIP_ON_TONAL)}
          >
            <span className={ROW.META_CHIP_TEXT}>{entry.component}</span>
          </Tag>
          {entry.pid ? (
            <span className={chromatic ? ROW.META_ID_ON_TONAL : ROW.META_ID}>
              {entry.pid}
            </span>
          ) : null}
        </div>
      </div>

      <div className={ROW.WHEN}>
        <span className={ROW.RELATIVE}>{timeAgo}</span>
        <span
          className={cn(
            ROW.ABSOLUTE,
            chromatic ? ABSOLUTE_INK_ON_TONAL : ABSOLUTE_INK,
          )}
        >
          {clockTime}
        </span>
      </div>
    </div>
  );
}

export default LogRow;
