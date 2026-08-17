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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { Tag } from "@/components/ui/tag";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import {
  RSRP_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  worstSignalQuality,
} from "@/types/modem-status";
import type { SignalPerAntenna } from "@/types/modem-status";
import {
  qualityInkClass,
  qualityMeterTone,
} from "../signal-quality-display";

import { usePositionRecorder } from "./use-position-recorder";
import {
  CARD_CONTENT,
  CARD_DESCRIPTION,
  CARD_HEADER,
  CARD_SHELL,
  CARD_TITLE,
  GLYPH,
  ICON_TARGET,
  PILL_ACTION,
  RECORD_GLYPH,
  SEGMENTED_ITEM,
  SLOT,
  SLOT_GLYPH,
} from "./shapes";
import {
  DEFAULT_ANGLES,
  POSITION_LETTERS,
  SAMPLES_PER_RECORDING,
  SLOT_COUNT,
  findBestSlot,
  normalizeValue,
  scoreSnapshot,
} from "./utils";
import type { AntennaType, RecordingSnapshot } from "./utils";

// =============================================================================
// Positions — the 3-slot comparison recorder
// =============================================================================
// This card used to be three 290px tiles stacked down the phone: 923px, 39% of
// the page, and 1.1 full phone screens for a surface that displays NOTHING until
// it has been used. Each tile carried its own full-width saturated primary
// "Record angle" button, so the loudest thing on the page was attached to the
// state where the user has done nothing yet.
//
// It is now three comparison ROWS at every width, and the rewrite turns on four
// decisions:
//
//   1. ROWS, NOT TILES. All three rows carry a `MetricBar` on the SAME 0-100
//      composite scale, so "which heading won" is answered by BAR LENGTH at a
//      glance rather than by reading three numerals against one another. A tile
//      grid cannot do that — three bars in three separate boxes are three
//      readings, three bars in a stack are a comparison.
//
//   2. ONE PRIMARY BUTTON, NOT THREE. The header carries a single `Record` pill
//      that records into the NEXT EMPTY slot. Per-slot re-record survives as
//      each row's own quiet icon target, which is the affordance a user reaches
//      for after they have already recorded something — i.e. once the card has
//      content to justify it. When all three slots are full the pill is disabled
//      AND says why, per DESIGN.md's State-Honesty Rule.
//
//   3. AN EMPTY SLOT IS AN EMPTY TRACK. `MetricBar value={null}` renders the
//      track with no fill element at all, never a zero-length fill — "nothing
//      recorded here" and "recorded, and it is terrible" must not draw the same
//      mark (DESIGN.md > Quality bars).
//
//   4. THE RAMP LIVES ON THE NUMERAL AND THE BAR TOGETHER. Adjacent ramp stops
//      sit below the CVD separation floor by design, so the tint is only legal
//      here because the bar is beside it carrying the same value in length.
//
// Four behaviours are load-bearing and were preserved deliberately:
//   - Step dots, never a progress bar, for sample progress. DESIGN.md reserves
//     fill and progress bars for data visualisation; a bar here would make a
//     sample COUNT look like a MEASUREMENT.
//   - The label freezes once a slot is recorded, so a stored measurement can
//     never be relabelled into claiming something it did not measure.
//   - A second recording while one is active is DISABLED, not queued: the sample
//     accumulator is shared, so a second start would silently abandon the first.
//   - The recommendation appears only with two or more rankable slots. "Best"
//     out of one is not a comparison.
// =============================================================================

type PendingConfirm =
  | { kind: "reset" }
  | { kind: "clear"; index: number; label: string }
  | null;

// -----------------------------------------------------------------------------
// One comparison row
// -----------------------------------------------------------------------------

function PositionRow({
  slotIndex,
  snapshot,
  antennaType,
  label,
  onLabelChange,
  isRecording,
  samplesCollected,
  isBest,
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
  stalled: boolean;
  recordDisabled: boolean;
  onRecord: () => void;
  onCancel: () => void;
  onRequestClear: () => void;
}) {
  const { t } = useTranslation("cellular");

  const score = snapshot ? scoreSnapshot(snapshot) : null;

  /**
   * The quality verdict, read from the SAME legs the composite was built from.
   *
   * `worstSignalQuality` skips `"none"` entries, so it returns a level whenever
   * any leg reported and `"none"` only when neither did — which is exactly when
   * `score.value` is null too. Numeral ink, bar tone and bar length therefore
   * cannot disagree about whether there is a reading.
   */
  const rsrp =
    snapshot && score
      ? normalizeValue(
          score.radio === "nr" ? snapshot.nr_rsrp[0] : snapshot.lte_rsrp[0],
          "rsrp"
        )
      : null;
  const sinr =
    snapshot && score
      ? normalizeValue(
          score.radio === "nr" ? snapshot.nr_sinr[0] : snapshot.lte_sinr[0],
          "sinr"
        )
      : null;
  const quality = worstSignalQuality(
    getSignalQuality(rsrp, RSRP_THRESHOLDS),
    getSignalQuality(sinr, SINR_THRESHOLDS)
  );

  const slotStatus = isRecording
    ? t("antenna_alignment.recorder.status.recording")
    : snapshot
      ? isBest
        ? t("antenna_alignment.recorder.status.recorded_best")
        : t("antenna_alignment.recorder.status.recorded")
      : t("antenna_alignment.recorder.status.empty");

  const progressCopy = stalled
    ? t("antenna_alignment.recorder.waiting")
    : t("antenna_alignment.recorder.sample_progress", {
        current: samplesCollected,
        total: SAMPLES_PER_RECORDING,
      });

  const caveat =
    score && !isRecording
      ? score.value === null
        ? { glyph: "block" as const, text: t("antenna_alignment.recorder.not_comparable") }
        : score.partial
          ? { glyph: "info" as const, text: t("antenna_alignment.recorder.partial") }
          : null
      : null;

  return (
    <motion.div
      variants={staggerRowItem}
      role="group"
      aria-label={t("antenna_alignment.recorder.slot_sr", {
        index: slotIndex + 1,
        label,
        status: slotStatus,
      })}
      className={cn(SLOT.ROOT, isBest && snapshot ? SLOT.BEST : SLOT.NEUTRAL)}
    >
      {/* --- Label ------------------------------------------------------- */}
      {snapshot ? (
        /* Frozen at capture. There is nothing left to signal as an editable
           control, so it drops the box entirely and inherits the row's own ink
           at full strength — which is also what keeps it legible on the
           winning row's `primary-container` fill. */
        <span className={SLOT.LABEL_STATIC} title={label}>
          {label}
        </span>
      ) : (
        /* A shell, not a bare field. At `border-0` on one tonal step the page's
           ONLY text input read as a static chip in a row full of static chips,
           so the one editable thing on the surface advertised nothing. DESIGN.md
           keeps inputs borderless at rest, so the affordance is the `edit` mark
           rather than a stroke; the shell owns the fill, radius, 44px height and
           the focus ring. */
        <div className={cn(SLOT.LABEL_SHELL, isRecording && "opacity-60")}>
          <MaterialSymbol
            name="edit"
            size={GLYPH.CHIP}
            aria-hidden="true"
            className="shrink-0 text-on-surface-variant"
          />
          <input
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            disabled={isRecording}
            aria-label={t("antenna_alignment.recorder.label_sr", {
              index: slotIndex + 1,
            })}
            placeholder={
              antennaType === "directional"
                ? t("antenna_alignment.recorder.placeholder_angle")
                : t("antenna_alignment.recorder.placeholder_position")
            }
            className={cn(
              SLOT.LABEL_FIELD,
              "text-on-surface placeholder:text-on-surface-variant"
            )}
          />
        </div>
      )}

      {/* --- Score ------------------------------------------------------- */}
      {/* Ramp ink is legal here ONLY because the bar sits immediately beside it
          carrying the same value in length. On the winning row the numeral drops
          the ramp and takes the container's own ink instead: `--quality-N` is
          computed against a card ground, not against `primary-container`, and
          the row's non-chromatic channels (bar length, the sr-only verdict) are
          already carrying the quality. */}
      <span
        className={cn(
          SLOT.SCORE,
          snapshot && score?.value !== null && !isBest && qualityInkClass(quality)
        )}
      >
        {score && score.value !== null && !isRecording
          ? score.value
          : /* A never-recorded row says so ONCE, in the lane. The em dash here
               was the same statement a second time, and it was what pushed
               "Not recorded" into wrapping across two lines inside a 64px pill.
               Recording and unrankable rows keep the dash: there the lane is
               showing progress or a track, so the dash is the only thing
               holding the numeral column. */
            snapshot || isRecording
            ? "—"
            : null}
      </span>
      {snapshot && score?.value !== null && (
        <span className="sr-only">{t(`antenna_alignment.quality.${quality}`)}</span>
      )}

      {/* --- Lane -------------------------------------------------------- */}
      {isRecording ? (
        <div className={cn(SLOT.LANE, "flex items-center gap-2")}>
          <MaterialSymbol
            name={RECORD_GLYPH.recording}
            size={GLYPH.INLINE}
            className="shrink-0 motion-safe:animate-spin"
          />
          {/* Step dots, not a fill — see the file header. */}
          <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: SAMPLES_PER_RECORDING }, (_, i) => (
              <span
                key={i}
                className={cn(
                  SLOT.DOT,
                  i < samplesCollected ? "bg-primary" : "bg-surface-container-high"
                )}
              />
            ))}
          </span>
          <span
            className={cn(SLOT.CAPTION, "hidden min-w-0 truncate @md/card:inline")}
            aria-hidden="true"
          >
            {progressCopy}
          </span>
          <span className="sr-only" aria-live="polite">
            {progressCopy}
          </span>
        </div>
      ) : !snapshot ? (
        /* A slot that has NEVER been recorded gets no track at all.
           "Nothing has been measured here" and "this was measured and yielded
           nothing" are different facts, and only the second one is a reading
           with a place on the scale. Drawing an empty track for the first put
           three ~470px rules of pure chrome across a desktop card that has no
           comparison in it yet — the phone fix not travelling to 1440. The
           unrankable case below keeps its empty track, because there the track
           is the honest report of a measurement that came back with nothing. */
        <span
          className={cn(
            SLOT.LANE,
            SLOT.CAPTION,
            "truncate whitespace-nowrap text-on-surface-variant",
          )}
        >
          {t("antenna_alignment.recorder.not_recorded")}
        </span>
      ) : (
        <div className={cn(SLOT.LANE, "flex flex-col gap-1.5")}>
          {/* `value={null}` on an unrankable slot renders the track ALONE —
              never a zero-length fill. */}
          <MetricBar
            value={score?.value ?? null}
            max={100}
            warnAt={101}
            dangerAt={101}
            colorOverride={qualityMeterTone(quality)}
            size="md"
            /* The winning row is `primary-container`, against which
               `surface-container-high` renders LIGHTER than its own ground — so
               the track read as a second, paler segment continuing past the end
               of the fill, on the one row that answers "which position won".
               `muted` is the same move the pinned readout needed for the same
               class of collision. A track is only invisible chrome while it is
               darker than what it sits on. */
            track={isBest && snapshot ? "muted" : "surface-container-high"}
            index={slotIndex}
          />
          {(score?.radio || caveat) && (
            <div className="flex min-w-0 items-center gap-1.5">
              {score?.radio && (
                <Tag
                  variant={score.radio === "nr" ? "nr" : "lte"}
                  className="shrink-0 px-1.5 py-0"
                >
                  {t(`antenna_alignment.mode.${score.radio}_short`)}
                </Tag>
              )}
              {caveat && (
                <>
                  <MaterialSymbol
                    name={caveat.glyph}
                    size={GLYPH.CHIP}
                    className="shrink-0 opacity-80"
                    aria-hidden="true"
                  />
                  <span
                    className={cn(SLOT.CAPTION, "hidden min-w-0 truncate @md/card:inline")}
                    aria-hidden="true"
                  >
                    {caveat.text}
                  </span>
                  <span className="sr-only">{caveat.text}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- The row's own action ---------------------------------------- */}
      {/* One 44px target, three meanings: record this slot, cancel the run,
          clear the recording. Quiet by construction — the card's single loud
          affordance lives in the header. */}
      {isRecording ? (
        <Button
          variant="ghost"
          size="icon"
          className={SLOT.ICON_TARGET}
          aria-label={t("antenna_alignment.recorder.cancel_slot", { label })}
          onClick={onCancel}
        >
          <MaterialSymbol name={RECORD_GLYPH.cancel} size={GLYPH.ACTION} />
        </Button>
      ) : snapshot ? (
        <Button
          variant="ghost"
          size="icon"
          className={SLOT.ICON_TARGET}
          aria-label={t("antenna_alignment.recorder.clear", { label })}
          onClick={onRequestClear}
        >
          <MaterialSymbol name={RECORD_GLYPH.clear} size={GLYPH.ACTION} />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className={SLOT.ICON_TARGET}
          disabled={recordDisabled}
          aria-label={t("antenna_alignment.recorder.record_slot", { label })}
          onClick={onRecord}
        >
          <MaterialSymbol name={RECORD_GLYPH.idle} size={GLYPH.ACTION} />
        </Button>
      )}
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// The card
// -----------------------------------------------------------------------------

export function PositionsCard({
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
   * Label edits live HERE, keyed by `${antennaType}-${index}`, rather than
   * inside each row.
   *
   * They used to be row-local, and the rows were keyed by the same composite
   * string — so flipping Directional↔Omni REMOUNTED all three and silently
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
  const nextEmpty = slots.findIndex((snapshot) => !snapshot);
  const isRecording = activeSlot !== null;

  const labelFor = (index: number) => {
    const snapshot = slots[index];
    if (snapshot) {
      // A stored label is user data unless it was never touched, in which case
      // it follows the interface language like any other default.
      return snapshot.isDefaultLabel ? defaultLabel(index) : snapshot.label;
    }
    return labelEdits[`${antennaType}-${index}`] ?? defaultLabel(index);
  };

  const recordInto = (index: number) => {
    const edited = labelEdits[`${antennaType}-${index}`];
    const isDefault = edited === undefined || edited === defaultLabel(index);
    startRecording(index, labelFor(index), isDefault);
  };

  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === "reset") resetAll();
    else clearSlot(pending.index);
    setPending(null);
  };

  /**
   * Why the one primary action cannot currently work.
   *
   * DESIGN.md's State-Honesty Rule: "a control that cannot currently work
   * explains why instead of sitting there dead." Both reasons are real and
   * distinct — one is temporary and self-clearing, the other needs the user to
   * free a slot — so they get different sentences rather than one hedge.
   */
  const recordBlockedReason = isRecording
    ? t("antenna_alignment.recorder.recording_hint")
    : nextEmpty === -1
      ? t("antenna_alignment.recorder.all_recorded_hint")
      : null;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_HEADER}>
        <CardTitle className={CARD_TITLE}>
          {t("antenna_alignment.recorder.title")}
        </CardTitle>
        <CardDescription className={CARD_DESCRIPTION}>
          {antennaType === "directional"
            ? t("antenna_alignment.recorder.description_directional", {
                samples: SAMPLES_PER_RECORDING,
              })
            : t("antenna_alignment.recorder.description_omni", {
                samples: SAMPLES_PER_RECORDING,
              })}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_CONTENT, "@container/card gap-3")}>
        {/* Type selector and reset share the top row, justified apart: the
            tabs frame what the rows below mean (angles vs. positions), reset
            is the rare destructive escape hatch, and the two have nothing to
            say to each other so they anchor opposite edges instead of
            clustering. Record lives at the bottom of the card, after the rows
            and the recommendation, as the card's closing call to action
            rather than a control bar sitting above empty slots. */}
        <div className="flex items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            value={antennaType}
            onValueChange={(value) => {
              if (value) setAntennaType(value as AntennaType);
            }}
            className="rounded-pill"
          >
            <ToggleGroupItem value="directional" className={SEGMENTED_ITEM}>
              <MaterialSymbol name={SLOT_GLYPH.directional} size={GLYPH.INLINE} />
              {t("antenna_alignment.recorder.type_directional")}
            </ToggleGroupItem>
            <ToggleGroupItem value="omni" className={SEGMENTED_ITEM}>
              <MaterialSymbol name={SLOT_GLYPH.omni} size={GLYPH.INLINE} />
              {t("antenna_alignment.recorder.type_omni")}
            </ToggleGroupItem>
          </ToggleGroup>

          <Button
            variant="ghost"
            size="icon"
            className={ICON_TARGET}
            onClick={() => setPending({ kind: "reset" })}
            disabled={isRecording || filledCount === 0}
            aria-label={t("antenna_alignment.recorder.reset")}
          >
            <MaterialSymbol name="restart_alt" size={GLYPH.ACTION} />
          </Button>
        </div>

        <motion.div className={SLOT.STACK} variants={staggerRows}>
          {[0, 1, 2].map((index) => (
            <PositionRow
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
              stalled={feedStalled}
              // A second recording would silently abandon the first, because the
              // sample accumulator is shared. Say so by disabling instead.
              recordDisabled={isRecording}
              onRecord={() => recordInto(index)}
              onCancel={cancelRecording}
              onRequestClear={() =>
                setPending({ kind: "clear", index, label: labelFor(index) })
              }
            />
          ))}
        </motion.div>

        {/* The winning row already carries "this one won" as a container fill and
            the longest bar. What is genuinely new here is the advisory sentence,
            the mixed-radios caveat and the remaining-slot count — one compact
            neutral line, not a second loud block restating the same headline. */}
        {best && (
          <p
            role="status"
            className="flex items-start gap-2 text-xs leading-relaxed text-pretty text-on-surface-variant"
          >
            <MaterialSymbol
              name={RECORD_GLYPH.best}
              size={GLYPH.CHIP}
              filled
              className="mt-0.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="font-semibold text-on-surface">
                {t("antenna_alignment.recommendation.title", {
                  label: labelFor(best.index),
                })}
              </span>{" "}
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
            </span>
          </p>
        )}

        {/* THE card's one primary button, at the bottom as its closing call to
            action. It records into the next empty slot, which is what removes
            two of the three saturated pills the outgoing tile grid stacked
            down the phone. Its disabled-reason hint shares the button's row,
            justified apart and vertically centered against it, rather than
            sitting in a line of its own underneath. */}
        <div className="flex flex-col gap-2 @sm/card:flex-row @sm/card:items-center @sm/card:justify-between">
          {recordBlockedReason ? (
            <p
              role="status"
              className="text-xs leading-relaxed text-pretty text-on-surface-variant"
            >
              {recordBlockedReason}
            </p>
          ) : (
            <span />
          )}

          <Button
            className={cn(PILL_ACTION, "w-full @sm/card:w-fit @sm/card:shrink-0")}
            disabled={recordBlockedReason !== null}
            onClick={() => {
              if (nextEmpty !== -1) recordInto(nextEmpty);
            }}
          >
            <MaterialSymbol name={RECORD_GLYPH.idle} size={GLYPH.ACTION} />
            {antennaType === "directional"
              ? t("antenna_alignment.recorder.record_angle")
              : t("antenna_alignment.recorder.record_position")}
          </Button>
        </div>
      </CardContent>

      {/* Unrecoverable, and often reached after fifteen minutes on a ladder —
          PRODUCT.md principle 6 puts the risk in front of the action rather than
          behind it. One dialog serves both destructive paths so the copy can
          name exactly what is about to be lost. */}
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
            <AlertDialogCancel className={PILL_ACTION}>
              {t("antenna_alignment.recorder.confirm_cancel")}
            </AlertDialogCancel>
            {/* The role's own pair, never `bg-destructive/90`: an alpha wash of
                a role is not a role, and it drifts against whatever ground the
                dialog happens to sit on. */}
            <AlertDialogAction
              onClick={confirmPending}
              className={cn(
                PILL_ACTION,
                "bg-destructive text-destructive-foreground hover:bg-destructive-container hover:text-on-destructive-container"
              )}
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

export default PositionsCard;
