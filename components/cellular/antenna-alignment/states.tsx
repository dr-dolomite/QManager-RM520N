"use client";

import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ConditionScreen } from "../condition-screen";

import { AIM_SHAPE, AIM_SHELL } from "./live-aim";
import { RECORDER_GRID, SLOT_MIN_HEIGHT } from "./recorder-card";
import { PORT_BLOCK_MIN_HEIGHT, PORT_GRID } from "./port-strip";

// =============================================================================
// Antenna Alignment state screens
// =============================================================================
// Every number this page renders is a geometry constant IMPORTED from the file
// that draws the loaded view — nothing here restates a size. That is the
// Skeleton-Mirror Rule made structural rather than aspirational: the skeleton
// cannot drift from the loaded card, because it has no numbers of its own to
// drift with. The one exception is the label-width slivers, which are skeleton-
// only by nature (there is no loaded element whose width they mirror).
//
// The page header is deliberately NOT skeletonised: the page's identity is known
// before its readings are, so showing a grey bar where "Antenna Alignment" will
// appear replaces a fact with a guess.
//
// The old loading state skeletonised the header AND omitted the Alignment Meter
// card entirely, so the page drew four card ghosts and then popped a whole extra
// card in above them once data landed.
// =============================================================================

export function AlignmentSkeleton({ label }: { label?: string }) {
  return (
    <div className="flex flex-col gap-5">
      {label && <span className="sr-only">{label}</span>}

      {/* --- Live Aim ----------------------------------------------------- */}
      <Card className={AIM_SHELL}>
        <CardHeader className="gap-1 px-0">
          <div className="flex items-start gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-5 w-40 rounded-inline" />
              <Skeleton className="h-5 w-56 rounded-inline" />
            </div>
            <Skeleton className="h-[1.625rem] w-16 shrink-0 rounded-pill" />
          </div>
        </CardHeader>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-24 rounded-inline" />
                <Skeleton className={cn(AIM_SHAPE.SCORE_BOX, "w-28 rounded-inline")} />
              </div>
              <Skeleton className="h-4 w-24 rounded-inline" />
            </div>
            <Skeleton className="h-2 w-full rounded-pill" />
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-[2.625rem] w-full rounded-pill" />
            ))}
          </div>
          <Skeleton className="h-[1.625rem] w-28 rounded-pill" />
        </div>
      </Card>

      {/* --- Recorder ----------------------------------------------------- */}
      <Card className="h-full gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]">
        <CardHeader className="gap-1 px-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-5 w-40 rounded-inline" />
              <Skeleton className="h-5 w-64 rounded-inline" />
            </div>
            <Skeleton className="h-[2.625rem] w-52 shrink-0 rounded-pill" />
          </div>
        </CardHeader>
        <div className={RECORDER_GRID}>
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              className="rounded-tile"
              style={{ height: SLOT_MIN_HEIGHT }}
            />
          ))}
        </div>
      </Card>

      {/* --- Receive chains ----------------------------------------------- */}
      <Card className="h-full gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]">
        <CardHeader className="gap-1 px-0">
          <div className="flex items-start gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-5 w-36 rounded-inline" />
              <Skeleton className="h-5 w-52 rounded-inline" />
            </div>
            <Skeleton className="h-[1.625rem] w-24 shrink-0 rounded-pill" />
          </div>
        </CardHeader>
        <div className={PORT_GRID}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              className="rounded-tile"
              style={{ height: PORT_BLOCK_MIN_HEIGHT }}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * The first fetch never landed, so we have nothing — not even a reason.
 *
 * This replaces a generic "No Antenna Data" empty state that was, in practice,
 * the ONLY thing that branch ever rendered: the poller emits
 * `signal_per_antenna` unconditionally and `detectRadioMode` falls back to LTE,
 * so it was unreachable except when `data` was null. It therefore asserted the
 * radio was silent when the truth was that the modem was unreachable — on the one
 * page a technician opens to diagnose a chain. The retry is wired to the hook's
 * `refresh`, which the page had never even destructured.
 */
export function AlignmentUnreachable({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation("cellular");
  return (
    <ConditionScreen
      tone="destructive"
      glyph="error"
      ariaRole="alert"
      title={t("antenna_alignment.states.unreachable.title")}
      description={t("antenna_alignment.states.unreachable.description")}
      onRetry={onRetry}
      retryLabel={t("antenna_alignment.states.retry")}
    />
  );
}

/**
 * The modem answered, and every receive chain reported nothing.
 *
 * A genuinely different condition from unreachable, and it needs saying rather
 * than rendering as a wall of em dashes: `warning`, because it is a real fault
 * the user can often fix where they are standing — an antenna cable that is not
 * seated is exactly the kind of thing someone on this page can go and check.
 */
export function AlignmentNoReadings({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation("cellular");
  return (
    <ConditionScreen
      tone="warning"
      glyph="settings_input_antenna"
      ariaRole="alert"
      title={t("antenna_alignment.states.no_readings.title")}
      description={t("antenna_alignment.states.no_readings.description")}
      onRetry={onRetry}
      retryLabel={t("antenna_alignment.states.retry")}
    />
  );
}
