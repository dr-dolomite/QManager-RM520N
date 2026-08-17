"use client";

import { useTranslation } from "react-i18next";

import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ConditionScreen } from "../condition-screen";
import {
  CARD_HEADER,
  CARD_SHELL,
  CONSOLE,
  CHAINS_ROW,
  CONSOLE_COLUMN,
  CONSOLE_SPLIT,
  PORT,
  SKELETON_SHAPE,
  SLOT,
  WORK_COLUMN,
} from "./shapes";

// =============================================================================
// Antenna Alignment state screens
// =============================================================================
// Every number here is a geometry constant imported from `./shapes` — the ONE
// contract both the skeleton and the loaded cards read from. Nothing in this
// file restates a size, and nothing in it imports from `live-aim.tsx` or
// `recorder-card.tsx`. That second half matters as much as the first: the
// outgoing version pulled `AIM_SHAPE` / `AIM_SHELL` / `RECORDER_GRID` /
// `SLOT_MIN_HEIGHT` / `PORT_GRID` / `PORT_BLOCK_MIN_HEIGHT` from three sibling
// card files, so the loading state had a hard dependency on the module graph of
// every card it was standing in for. A shared contract makes the mirror
// structural rather than aspirational.
//
// TWO THINGS THE OLD LOADING STATE GOT WRONG, deliberately not reintroduced:
//
//   1. It SKELETONISED THE PAGE HEADER. A page's identity is known before its
//      readings are, so a grey bar where "Antenna Alignment" will appear
//      replaces a fact with a guess. The header now renders immediately, from
//      the composition root, and this component starts below it.
//
//   2. It OMITTED A WHOLE CARD. The page drew ghosts for some cards and then
//      popped a real card in ABOVE them once data landed, which reads as the
//      layout breaking rather than filling. The skeleton now mirrors the full
//      two-column composition: the console column, then the work column's
//      Positions rows and Receive Chains grid.
// =============================================================================

/**
 * A card's title + description + trailing chip. Three cards, one shape.
 *
 * `wraps` draws `SKELETON_SHAPE.LINE_WRAP` under the description line, for a
 * description that takes two lines on a phone. Mirroring a two-line description
 * with one `LINE` under-draws the header by ~20px, and a skeleton shorter than
 * the content replacing it is a layout shift at handoff — the exact class of
 * defect the Skeleton-Mirror Rule exists to prevent.
 */
function HeaderGhost({ wraps = false }: { wraps?: boolean }) {
  return (
    <CardHeader className={CARD_HEADER}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Skeleton className={SKELETON_SHAPE.TITLE} />
          <Skeleton className={SKELETON_SHAPE.LINE} />
          {wraps && <Skeleton className={SKELETON_SHAPE.LINE_WRAP} />}
        </div>
        <Skeleton className={cn(SKELETON_SHAPE.CHIP, "shrink-0")} />
      </div>
    </CardHeader>
  );
}

export function AlignmentSkeleton({ label }: { label?: string }) {
  return (
    <>
      {/* Outside the grid on purpose: a `sr-only` span is absolutely positioned
          and would not claim a cell, but a future non-absolute label would. */}
      {label && <span className="sr-only">{label}</span>}

      <div className={CONSOLE_SPLIT}>
        {/* --- Console column ------------------------------------------------ */}
        <div className={CONSOLE_COLUMN}>
          <Card className={CONSOLE.SHELL}>
            <HeaderGhost />

            <div className="flex flex-col gap-5">
              {/* The composite numeral, its verdict chip, and the 8px meter. */}
              <div className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-4">
                  <Skeleton className={SKELETON_SHAPE.SCORE} />
                  <Skeleton className={SKELETON_SHAPE.CHIP} />
                </div>
                <Skeleton className={SKELETON_SHAPE.METER} />
              </div>

              {/* The two weighted leg rows. */}
              <div className="flex flex-col gap-2">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className={SKELETON_SHAPE.LEG_ROW} />
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* --- Work column --------------------------------------------------- */}
        <div className={WORK_COLUMN}>
          {/* Positions: three comparison ROWS at every width, never a tile grid. */}
          <Card className={CARD_SHELL}>
            <HeaderGhost />
            <div className={SLOT.STACK}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className={SKELETON_SHAPE.SLOT_ROW} />
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Receive chains: full width BENEATH the split, not a third card in the
          work column — 2-up on a phone, 4-up once the row can fund it. Mirrors
          the loaded card's own `CHAINS_ROW` + `PORT.GRID`, so the ghost cannot
          reflow into a different shape than the thing it stands in for. */}
      <div className={CHAINS_ROW}>
        <Card className={CARD_SHELL}>
          <HeaderGhost wraps />
          <div className={PORT.GRID}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className={SKELETON_SHAPE.PORT_BLOCK} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * The first fetch never landed, so we have nothing — not even a reason.
 *
 * `destructive` + `error`. This replaces a generic "No Antenna Data" empty state
 * that was, in practice, the ONLY thing that branch ever rendered: the poller
 * emits `signal_per_antenna` unconditionally and `detectRadioMode` falls back to
 * LTE, so it was unreachable except when `data` was null. It therefore asserted
 * the radio was silent when the truth was that the modem was unreachable — on
 * the one page a technician opens to diagnose a chain.
 *
 * DO NOT unify this with `AlignmentNoReadings`. The split is the whole point:
 * this one means the link is down and there is nothing the user can do at the
 * mast; the other means the radio is silent, which is often a fault they can fix
 * where they stand. And no two states in one slot may share a glyph, because the
 * tonal containers measure ~1.03:1 apart — identical under deuteranopia — so the
 * glyph is the only channel actually separating them.
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
 * `warning` + `settings_input_antenna`. A genuinely different condition from
 * unreachable, and it needs saying rather than rendering as a wall of em dashes.
 * `warning` because it is a real fault the user can often fix where they are
 * standing — an antenna cable that is not seated is exactly the kind of thing
 * someone on this page can go and check. See the note on `AlignmentUnreachable`
 * for why the tone and the glyph must both stay distinct.
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
