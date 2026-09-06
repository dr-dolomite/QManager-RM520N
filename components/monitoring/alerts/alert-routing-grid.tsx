"use client";

import { useTranslation } from "react-i18next";
import { TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ALERT_CHANNEL_ORDER,
  ALERT_EVENT_ORDER,
  type AlertChannel,
  type AlertEventKey,
} from "@/types/alerts";
import { CELL_PENDING_RING, CELL_TONE, MATRIX, SKELETON } from "./shapes";
import {
  CHANNEL_STATUS_BADGE,
  type AlertCell,
  type AlertsCoverage,
} from "./derive";
import {
  CELL_DISPLAY_TONE,
  CELL_STATE_GLYPH,
  CELL_STATE_LABEL_KEY,
  CELL_STATE_NOTE_KEY,
  CHANNEL_GLYPH,
  CHANNEL_STATUS_GLYPH,
  cellDisplay,
  channelNameKey,
  channelStatusKey,
  eventDescKey,
  eventNameKey,
  reasonKey,
} from "./coverage-labels";

// The coverage matrix: three events by three channels. It EDITS routing and
// REPORTS what will fire, and `deriveCoverage` is the only thing that decides
// which — no cell re-reads a payload.

export interface CoverageMatrixProps {
  /** Draft-resolved coverage. Pending cells are already marked. */
  coverage: AlertsCoverage;
  onToggle: (
    event: AlertEventKey,
    channel: AlertChannel,
    next: boolean,
  ) => void;
  /** Channels whose form cannot be saved. The column chip reports SAVED truth,
   *  so an unsaved fault needs its own marker beside it. */
  blockedChannels?: readonly AlertChannel[];
}

export function CoverageMatrix({
  coverage,
  onToggle,
  blockedChannels = [],
}: CoverageMatrixProps) {
  const { t } = useTranslation("common");

  return (
    <div className={MATRIX.GRID}>
      <div className={MATRIX.CORNER} />

      {ALERT_CHANNEL_ORDER.map((channel) => {
        const Glyph = CHANNEL_GLYPH[channel];
        const status = coverage.channels[channel].status;
        const StatusGlyph = CHANNEL_STATUS_GLYPH[status];
        return (
          <div key={channel} className={MATRIX.COLHEAD}>
            <span className={MATRIX.COLHEAD_NAME}>
              <Glyph className={MATRIX.COLHEAD_GLYPH} aria-hidden />
              {t(channelNameKey(channel))}
            </span>
            <span className={MATRIX.COLHEAD_CHIPS}>
              <Badge variant={CHANNEL_STATUS_BADGE[status]}>
                <StatusGlyph className="size-3" />
                {t(channelStatusKey(status))}
              </Badge>
              {blockedChannels.includes(channel) ? (
                <Badge variant="warning" className="px-1.5">
                  <TriangleAlertIcon className="size-3" />
                  <span className="sr-only">
                    {t("alerts.channels.status.needs_fixing")}
                  </span>
                </Badge>
              ) : null}
            </span>
          </div>
        );
      })}

      {ALERT_EVENT_ORDER.map((event) => (
        <div key={event} className={MATRIX.GROUP}>
          <div className={MATRIX.ROWHEAD}>
            <span className={MATRIX.ROWHEAD_TITLE}>{t(eventNameKey(event))}</span>
            <span className={MATRIX.ROWHEAD_DESC}>{t(eventDescKey(event))}</span>
          </div>
          {ALERT_CHANNEL_ORDER.map((channel) => (
            <CoverageCell
              key={channel}
              cell={coverage.cells[event][channel]}
              onToggle={onToggle}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CoverageCell({
  cell,
  onToggle,
}: {
  cell: AlertCell;
  onToggle: CoverageMatrixProps["onToggle"];
}) {
  const { t } = useTranslation("common");

  const display = cellDisplay(cell);
  const tone = CELL_TONE[CELL_DISPLAY_TONE[display]];
  const Glyph = CELL_STATE_GLYPH[display];
  const channelName = t(channelNameKey(cell.channel));
  const eventName = t(eventNameKey(cell.event));
  const label = t(CELL_STATE_LABEL_KEY[display]);

  // `pending` never occupies the note slot: the ring already says "unsaved",
  // and the note is the only place a cell explains WHY it will not send.
  const noteKey = CELL_STATE_NOTE_KEY[display];
  const note =
    display === "incapable"
      ? t(reasonKey(cell.reason))
      : noteKey
        ? t(noteKey)
        : null;

  const body = (
    <>
      <span className={MATRIX.CHANNEL_LABEL}>{channelName}</span>
      <span className={cn(MATRIX.DISC, tone.DISC)}>
        <Glyph className={MATRIX.GLYPH} aria-hidden />
      </span>
      <span className={MATRIX.LABEL}>{label}</span>
      {note ? <span className={MATRIX.NOTE}>{note}</span> : null}
    </>
  );

  const sentence = t("alerts.coverage.cellAction", {
    event: eventName,
    channel: channelName,
    state: label,
  });

  if (!cell.interactive) {
    // Not operable, so it stays out of the tab order — but it carries the most
    // important fact on the page, so it must still have an accessible name.
    return (
      <div
        role="img"
        aria-label={note ? `${sentence}. ${note}` : sentence}
        className={cn(MATRIX.CELL, MATRIX.CELL_TRANSITION, tone.ROOT)}
      >
        {/* `contents` keeps the flex column intact while the label above is
            the element's ONE accessible name. */}
        <span aria-hidden className="contents">
          {body}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={cell.routed}
      aria-label={sentence}
      onClick={() => onToggle(cell.event, cell.channel, !cell.routed)}
      className={cn(
        MATRIX.CELL,
        MATRIX.CELL_TRANSITION,
        tone.ROOT,
        "cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        cell.pending && CELL_PENDING_RING,
      )}
    >
      {body}
      {cell.pending ? (
        <span className="sr-only">{t("alerts.coverage.cell.pendingNote")}</span>
      ) : null}
    </button>
  );
}

/** Mirrors the loaded grid: same columns, same pinned cell height. */
export function CoverageMatrixSkeleton() {
  return (
    <div className={MATRIX.GRID} aria-hidden>
      <div className={MATRIX.CORNER} />
      {ALERT_CHANNEL_ORDER.map((channel) => (
        <div key={channel} className={MATRIX.COLHEAD}>
          <Skeleton className={cn(SKELETON.LINE, "h-4 w-20")} />
          <Skeleton className={cn(SKELETON.LINE, "h-[1.375rem] w-16")} />
        </div>
      ))}
      {ALERT_EVENT_ORDER.map((event) => (
        <div key={event} className={MATRIX.GROUP}>
          <div className={MATRIX.ROWHEAD}>
            <Skeleton className={cn(SKELETON.LINE, "h-4 w-36")} />
            <Skeleton className={cn(SKELETON.LINE, "mt-1.5 h-3 w-44")} />
          </div>
          {ALERT_CHANNEL_ORDER.map((channel) => (
            <Skeleton key={channel} className={cn(SKELETON.CELL, "w-full")} />
          ))}
        </div>
      ))}
    </div>
  );
}
