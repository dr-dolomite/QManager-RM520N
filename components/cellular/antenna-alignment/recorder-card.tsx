"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { cn } from "@/lib/utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type { SignalPerAntenna } from "@/types/modem-status";

import { usePositionRecorder } from "./use-position-recorder";
import {
  DEFAULT_ANGLES,
  POSITION_LETTERS,
  SAMPLES_PER_RECORDING,
  SLOT_COUNT,
  findBestSlot,
  scoreSnapshot,
} from "./utils";
import type { AntennaType, RecordingSnapshot } from "./utils";

// =============================================================================
// Alignment Meter — the 3-slot position recorder
// =============================================================================
// Extracted from the old 713-line `alignment-meter.tsx`, which held the recorder,
// the live readout, the hook and four sub-components in one file.
//
// The recorder answers a different question from the Live Aim card above it. Live
// Aim is for SWEEPING — rotate and watch, with peak-hold carrying what you cannot
// hold in your head while your hands are busy. The recorder is for COMMITTING:
// stop at a position, average several genuine measurements, and compare three
// candidates on one scale. Both now speak in the same composite score, so a slot
// reading 78 and a live reading of 74 are directly comparable.
//
// Three behaviours here are load-bearing and were preserved deliberately:
//   - Step dots, never a progress bar. DESIGN.md reserves fill and progress bars
//     for data visualisation (signal strength, quality meters); sample progress
//     is a `Loader-and-Dots` gesture. Substituting a bar here would make sample
//     count look like a measurement.
//   - The label freezes once a slot is recorded, so a stored measurement can
//     never be relabelled into claiming something it did not measure.
//   - The recommendation appears only with two or more rankable slots. "Best" out
//     of one is not a comparison.
// =============================================================================

export const RECORDER_GRID = "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-3";

export const SLOT_SHAPE = {
  ROOT: "relative flex flex-col gap-3 rounded-tile px-4 py-4 transition-colors duration-(--duration-standard) ease-standard",
  NEUTRAL: "bg-surface-container text-on-surface",
  /**
   * The winning slot is promoted a container step and changes its ink, per
   * DESIGN.md's Highlight-by-Container Rule — which names this exact case: "a
   * recommended alignment slot becomes a `primary-container` block". It replaces
   * a `ring-2 ring-primary` plus a badge notched over the tile's top edge; a ring
   * is chrome drawn around a block, where the canon wants the block itself to
   * carry the state.
   */
  BEST: "bg-primary-container text-on-primary-container",
  HEAD: "flex items-center gap-2",
  SCORE: "font-mono text-[40px] font-semibold leading-none tabular-nums",
  BODY: "flex flex-1 flex-col items-center justify-center gap-2 text-center",
} as const;

/**
 * The slot tile's floor height, as a NUMBER because it is the sum of independent
 * line boxes (label field, score row, two leg rows, footnote) that no Tailwind
 * class can name honestly. Spent as an inline `minHeight` at both the live and
 * skeleton ends so the two cannot drift, and so the three tiles stay level
 * whatever mix of empty / recording / recorded states they are in.
 */
export const SLOT_MIN_HEIGHT = 208;

// -----------------------------------------------------------------------------
// One recording slot
// -----------------------------------------------------------------------------

type PendingConfirm =
  | { kind: "reset" }
  | { kind: "clear"; index: number; label: string }
  | null;

function SlotTile({
  slotIndex,
  snapshot,
  antennaType,
  label,
  onLabelChange,
  isRecording,
  samplesCollected,
  isBest,
  margin,
  stalled,
  recordDisabled,
  onRecord,
  onCancel,
  onRequestClear,
}: {
  slotIndex: number;
  snapshot: RecordingSnapshot | null;
  antennaType: AntennaType;
  label: string;
  onLabelChange: (value: string) => void;
  isRecording: boolean;
  samplesCollected: number;
  isBest: boolean;
  margin: number | null;
  stalled: boolean;
  recordDisabled: boolean;
  onRecord: () => void;
  onCancel: () => void;
  onRequestClear: () => void;
}) {
  const { t } = useTranslation("cellular");

  const score = snapshot ? scoreSnapshot(snapshot) : null;

  const slotStatus = isRecording
    ? t("antenna_alignment.recorder.status.recording")
    : snapshot
      ? isBest
        ? t("antenna_alignment.recorder.status.recorded_best")
        : t("antenna_alignment.recorder.status.recorded")
      : t("antenna_alignment.recorder.status.empty");

  return (
    <motion.div
      variants={staggerRowItem}
      role="region"
      aria-label={t("antenna_alignment.recorder.slot_sr", {
        index: slotIndex + 1,
        label,
        status: slotStatus,
      })}
      style={{ minHeight: SLOT_MIN_HEIGHT }}
      className={cn(
        SLOT_SHAPE.ROOT,
        isBest && snapshot ? SLOT_SHAPE.BEST : SLOT_SHAPE.NEUTRAL
      )}
    >
      {/* --- Label ------------------------------------------------------- */}
      <div className={SLOT_SHAPE.HEAD}>
        <MaterialSymbol
          name={antennaType === "directional" ? "explore" : "location_on"}
          size={16}
          className="shrink-0 opacity-70"
        />
        <Input
          value={label}
          onChange={(event) => onLabelChange(event.target.value)}
          disabled={isRecording || !!snapshot}
          aria-label={t("antenna_alignment.recorder.label_sr", {
            index: slotIndex + 1,
          })}
          className="h-[2.625rem] rounded-field border-0 bg-surface-container-high px-3 text-sm font-medium"
          placeholder={
            antennaType === "directional"
              ? t("antenna_alignment.recorder.placeholder_angle")
              : t("antenna_alignment.recorder.placeholder_position")
          }
        />
        {snapshot && (
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-pill"
            aria-label={t("antenna_alignment.recorder.clear", { label })}
            onClick={onRequestClear}
          >
            <MaterialSymbol name="delete" size={18} />
          </Button>
        )}
      </div>

      {/* --- Recording --------------------------------------------------- */}
      {isRecording && (
        <div className={SLOT_SHAPE.BODY}>
          <div className="flex items-center justify-center gap-2" aria-live="polite">
            <MaterialSymbol
              name="progress_activity"
              size={16}
              className="motion-safe:animate-spin"
            />
            <span className="text-xs">
              {stalled
                ? t("antenna_alignment.recorder.waiting")
                : t("antenna_alignment.recorder.sample_progress", {
                    current: samplesCollected,
                    total: SAMPLES_PER_RECORDING,
                  })}
            </span>
          </div>
          {/* Step dots, not a progress bar — see the file header. */}
          <div className="flex items-center justify-center gap-1.5">
            {Array.from({ length: SAMPLES_PER_RECORDING }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={cn(
                  "size-2 rounded-pill transition-colors duration-(--duration-standard) ease-standard",
                  i < samplesCollected
                    ? "bg-primary"
                    : "bg-surface-container-high"
                )}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={onCancel}
            className="h-[2.625rem] w-full rounded-pill text-sm font-semibold"
          >
            {t("antenna_alignment.recorder.cancel")}
          </Button>
        </div>
      )}

      {/* --- Recorded ---------------------------------------------------- */}
      {!isRecording && snapshot && score && (
        <div className={SLOT_SHAPE.BODY}>
          {/* This group — not the tile — owns the centering, so the footnote
              below stays pinned to the tile's floor instead of being dragged
              toward the middle by the same flex-1/justify-center pair. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <div className="flex items-end gap-2">
              <span className={SLOT_SHAPE.SCORE}>
                {score.value === null ? "—" : score.value}
              </span>
              {score.radio && (
                <Badge
                  variant={score.radio === "nr" ? "nr" : "lte"}
                  className="mb-1.5 shrink-0 px-2 py-0.5 text-xs font-semibold"
                >
                  {t(`antenna_alignment.mode.${score.radio}`)}
                </Badge>
              )}
            </div>

            {/* Why a slot is unrankable, or why its score is a weaker claim
                than its neighbour's. Silence here is what let a position
                lose the recommendation for a reason unrelated to where it
                was pointing. */}
            {score.value === null ? (
              <span className="text-xs opacity-80">
                {t("antenna_alignment.recorder.not_comparable")}
              </span>
            ) : score.partial ? (
              <span className="text-xs opacity-80">
                {t("antenna_alignment.recorder.partial")}
              </span>
            ) : null}

            {isBest && score.value !== null && (
              <Badge
                variant="secondary"
                className="w-fit gap-1 px-2 py-0.5 text-xs font-semibold"
              >
                <MaterialSymbol name="trophy" size={12} filled />
                {margin === null
                  ? t("antenna_alignment.recorder.best")
                  : t("antenna_alignment.recorder.best_margin", { margin })}
              </Badge>
            )}
          </div>

          <span className="flex items-center gap-1 text-xs opacity-80">
            <MaterialSymbol name="check_circle" size={12} filled />
            {t("antenna_alignment.recorder.recorded_at", {
              time: new Date(snapshot.ts).toLocaleTimeString(),
            })}
          </span>
        </div>
      )}

      {/* --- Empty ------------------------------------------------------- */}
      {!isRecording && !snapshot && (
        <div className={SLOT_SHAPE.BODY}>
          <span className="text-center text-xs text-on-surface-variant">
            {t("antenna_alignment.recorder.not_recorded")}
          </span>
          <Button
            onClick={onRecord}
            disabled={recordDisabled}
            className="h-[2.625rem] w-full rounded-pill px-5 text-sm font-semibold"
          >
            {antennaType === "directional"
              ? t("antenna_alignment.recorder.record_angle")
              : t("antenna_alignment.recorder.record_position")}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// The card
// -----------------------------------------------------------------------------

export function RecorderCard({
  spa,
  snapshotTs,
  feedStalled,
}: {
  spa: SignalPerAntenna;
  snapshotTs: number | null;
  /** True when the snapshot feed has stopped advancing (error or stale). */
  feedStalled: boolean;
}) {
  const { t } = useTranslation("cellular");
  const {
    state,
    startRecording,
    cancelRecording,
    clearSlot,
    setAntennaType,
    resetAll,
  } = usePositionRecorder(spa, snapshotTs);

  const { slots, activeSlot, antennaType, samplesCollected } = state;

  /**
   * Label edits live HERE, keyed by `${antennaType}-${index}`, rather than inside
   * each tile.
   *
   * They used to be tile-local, and the tiles were keyed by the same composite
   * string — so flipping Directional↔Omni REMOUNTED all three tiles and silently
   * discarded whatever the user had typed but not yet recorded. Holding the map
   * one level up keeps the state across a flip while still scoping it per type,
   * so an angle typed in Directional does not leak into Omni's labels.
   */
  const [labelEdits, setLabelEdits] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState<PendingConfirm>(null);

  const defaultLabel = React.useCallback(
    (index: number) =>
      antennaType === "directional"
        ? DEFAULT_ANGLES[index]
        : t("antenna_alignment.recorder.position", {
            letter: POSITION_LETTERS[index],
          }),
    [antennaType, t]
  );

  const filledCount = slots.filter(Boolean).length;
  const best = filledCount >= 2 ? findBestSlot(slots) : null;
  const remaining = SLOT_COUNT - filledCount;

  const labelFor = (index: number) => {
    const snapshot = slots[index];
    if (snapshot) {
      // A stored label is user data unless it was never touched, in which case it
      // follows the interface language like any other default.
      return snapshot.isDefaultLabel ? defaultLabel(index) : snapshot.label;
    }
    return labelEdits[`${antennaType}-${index}`] ?? defaultLabel(index);
  };

  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === "reset") resetAll();
    else clearSlot(pending.index);
    setPending(null);
  };

  return (
    <Card className="h-full gap-5 rounded-card border-0 bg-surface px-6 py-6 shadow-[var(--shadow-whisper)]">
      <CardHeader className="gap-1 px-0">
        <div className="flex flex-col gap-3 @2xl/main:flex-row @2xl/main:items-start @2xl/main:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="min-w-0 truncate text-xl font-semibold">
              {t("antenna_alignment.recorder.title")}
            </CardTitle>
            <CardDescription className="text-[13px] leading-relaxed text-pretty">
              {antennaType === "directional"
                ? t("antenna_alignment.recorder.description_directional", {
                    samples: SAMPLES_PER_RECORDING,
                  })
                : t("antenna_alignment.recorder.description_omni", {
                    samples: SAMPLES_PER_RECORDING,
                  })}
            </CardDescription>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              value={antennaType}
              onValueChange={(value) => {
                if (value) setAntennaType(value as AntennaType);
              }}
              className="rounded-pill"
            >
              <ToggleGroupItem
                value="directional"
                className="h-[2.625rem] gap-2 rounded-pill px-4 text-sm font-semibold"
              >
                <MaterialSymbol name="explore" size={16} />
                {t("antenna_alignment.recorder.type_directional")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="omni"
                className="h-[2.625rem] gap-2 rounded-pill px-4 text-sm font-semibold"
              >
                <MaterialSymbol name="location_on" size={16} />
                {t("antenna_alignment.recorder.type_omni")}
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="outline"
              onClick={() => setPending({ kind: "reset" })}
              disabled={activeSlot !== null || filledCount === 0}
              className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
            >
              <MaterialSymbol name="restart_alt" size={16} />
              {t("antenna_alignment.recorder.reset")}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-0">
        <motion.div className={RECORDER_GRID} variants={staggerRows}>
          {[0, 1, 2].map((index) => (
            <SlotTile
              key={index}
              slotIndex={index}
              snapshot={slots[index]}
              antennaType={antennaType}
              label={labelFor(index)}
              onLabelChange={(value) =>
                setLabelEdits((edits) => ({
                  ...edits,
                  [`${antennaType}-${index}`]: value,
                }))
              }
              isRecording={activeSlot === index}
              samplesCollected={activeSlot === index ? samplesCollected : 0}
              isBest={best?.index === index}
              margin={best?.index === index ? best.margin : null}
              stalled={feedStalled}
              // A second recording would silently abandon the first, because the
              // sample accumulator is shared. Say so by disabling instead.
              recordDisabled={activeSlot !== null}
              onRecord={() => {
                const edited = labelEdits[`${antennaType}-${index}`];
                const isDefault = edited === undefined || edited === defaultLabel(index);
                startRecording(index, labelFor(index), isDefault);
              }}
              onCancel={cancelRecording}
              onRequestClear={() =>
                setPending({ kind: "clear", index, label: labelFor(index) })
              }
            />
          ))}
        </motion.div>

        {best && (
          <TonalBanner
            tone="info"
            icon="trophy"
            title={t("antenna_alignment.recommendation.title", {
              label: labelFor(best.index),
            })}
          >
            {antennaType === "directional"
              ? t("antenna_alignment.recommendation.body_directional")
              : t("antenna_alignment.recommendation.body_omni")}
            {best.mixedRadios && (
              <> {t("antenna_alignment.recommendation.mixed_radios")}</>
            )}
            {remaining > 0 && (
              <>
                {" "}
                {t("antenna_alignment.recommendation.remaining", {
                  count: remaining,
                })}
              </>
            )}
          </TonalBanner>
        )}
      </CardContent>

      {/* Unrecoverable, and often reached after fifteen minutes on a ladder —
          PRODUCT.md principle 6 puts the risk in front of the action rather than
          behind it. One dialog serves both destructive paths so the copy can name
          exactly what is about to be lost. */}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent className="rounded-card">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "reset"
                ? t("antenna_alignment.recorder.reset_confirm_title")
                : t("antenna_alignment.recorder.clear_confirm_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "reset"
                ? t("antenna_alignment.recorder.reset_confirm_body")
                : t("antenna_alignment.recorder.clear_confirm_body", {
                    label: pending?.kind === "clear" ? pending.label : "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-[2.625rem] rounded-pill px-5">
              {t("antenna_alignment.recorder.confirm_cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPending}
              className="h-[2.625rem] rounded-pill bg-destructive px-5 text-destructive-foreground hover:bg-destructive/90"
            >
              {pending?.kind === "reset"
                ? t("antenna_alignment.recorder.reset_confirm_action")
                : t("antenna_alignment.recorder.clear_confirm_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default RecorderCard;
