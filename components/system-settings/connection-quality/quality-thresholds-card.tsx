"use client";

import * as React from "react";
import { useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricBar } from "@/components/ui/metric-bar";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { TickGroup } from "@/components/ui/tick-group";
import { TickingValue } from "@/components/ui/ticking-value";
import { useModemStatus } from "@/hooks/use-modem-status";
import type { UseQualityThresholdsReturn } from "@/hooks/use-quality-thresholds";
import { staggerRowItem, staggerRows, transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  QUALITY_PRESETS,
  type QualityPreset,
  type QualityThresholdsSettings,
} from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  BLOCK,
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  DELTA,
  FOCUS_RING,
  GROUP_FILL,
  LABEL_LINE,
  NOTE,
  NOTICE,
  PILL_ACTION,
  PRESET,
  PRESET_LIMIT,
  READOUT,
  RECEIPT_ROW,
  ROW_GROUP,
  SKELETON,
  SKELETON_LOCAL,
  VALUE_NONE,
} from "./shapes";

// =============================================================================
// Latency & Loss Thresholds — the cuts that turn a slow link into an event
// =============================================================================
// Two decisions, one save. Neither restarts anything: these are the alerting
// cuts `events.sh` compares against, and recovery is the Watchdog's job.
//
// The six numbers behind them live in `PRESET_LIMIT`, which the status band
// also reads — so the band's discs and this card's chips cannot disagree about
// whether a live reading is over its cut.
// =============================================================================

const K = "connection_quality.thresholds";

/** A metric's axis. Both halves of the card are the same shape on two data. */
type Metric = "latency" | "loss";

/** `very-tolerant` is a value, not a key: i18next leaves have no hyphens. */
const PRESET_KEY = {
  standard: "standard",
  tolerant: "tolerant",
  "very-tolerant": "very_tolerant",
} satisfies Record<QualityPreset, string>;

/**
 * The live reading against its selected cut. Two states, two glyphs — a chip's
 * fill is never the only channel (The Every-Chip-Has-A-Glyph Rule).
 */
const STATE_CHIP = {
  under: { variant: "success", glyph: CheckCircle2Icon },
  over: { variant: "warning", glyph: TriangleAlertIcon },
} satisfies Record<"under" | "over", { variant: BadgeVariant; glyph: LucideIcon }>;

// -----------------------------------------------------------------------------
// The preset rail
// -----------------------------------------------------------------------------

interface PresetRailProps {
  value: QualityPreset;
  onSelect: (preset: QualityPreset) => void;
  /** The visible block title this rail is named by (WCAG 1.3.1). */
  labelledBy: string;
  labels: Record<QualityPreset, string>;
}

/**
 * A real radiogroup, replacing a `Tabs` that promised a panel it never had.
 *
 * Arrows move SELECTION here, which is the APG contract — legal because the
 * choice is a local draft until Save, unlike a rail whose selection restarts a
 * service. Exactly one chip is tabbable, so the group is one tab stop.
 */
function PresetRail({
  value,
  onSelect,
  labelledBy,
  labels,
}: PresetRailProps): React.JSX.Element {
  // Instance-scoped: two rails share this component, and a module-constant id
  // would put both thumbs in one layout group and fling them between rails.
  const thumbId = useId();
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = Math.max(0, QUALITY_PRESETS.indexOf(value));

  const move = (index: number) => {
    const next = QUALITY_PRESETS[index];
    if (!next) return;
    onSelect(next);
    chipRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Both axes: a radio group's arrow contract is direction-agnostic.
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;

    if (step !== 0) {
      event.preventDefault();
      // Wrapping, per APG — a radio group is a ring, not a list with ends.
      move((activeIndex + step + QUALITY_PRESETS.length) % QUALITY_PRESETS.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      move(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      move(QUALITY_PRESETS.length - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={PRESET.RAIL}
      onKeyDown={handleKeyDown}
    >
      {QUALITY_PRESETS.map((preset, index) => {
        const selected = preset === value;
        return (
          <button
            key={preset}
            ref={(node) => {
              chipRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onSelect(preset)}
            className={cn(
              PRESET.ROOT,
              PRESET.OFF,
              FOCUS_RING,
              selected && PRESET.ON_INK,
            )}
          >
            {/* ONE fill travelling on a shared layoutId — not two backgrounds
                crossfading, which would leave the outgoing chip blue. */}
            {selected ? (
              <motion.span
                layoutId={`${thumbId}-preset-thumb`}
                className={PRESET.THUMB}
                transition={transitionStandard}
                aria-hidden="true"
              />
            ) : null}
            <span className={PRESET.LABEL}>{labels[preset]}</span>
          </button>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// One threshold block
// -----------------------------------------------------------------------------

interface MetricBlockProps {
  metric: Metric;
  title: string;
  draft: QualityPreset;
  saved: QualityPreset;
  onSelect: (preset: QualityPreset) => void;
  /** The poller's reading, or `null` for "not measured". Never a zero. */
  live: number | null;
  unsaved: string;
}

function MetricBlock({
  metric,
  title,
  draft,
  saved,
  onSelect,
  live,
  unsaved,
}: MetricBlockProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const titleId = useId();

  const { limit, debounce } = PRESET_LIMIT[metric][draft];
  const dirty = draft !== saved;

  // events.sh flags latency ABOVE its cut and loss AT it; the status band's
  // `measure()` mirrors the same pair, so the two surfaces cannot disagree.
  const over = live !== null && (metric === "loss" ? live >= limit : live > limit);
  const chip = STATE_CHIP[over ? "over" : "under"];
  const ChipGlyph = chip.glyph;

  const format = (value: number) =>
    metric === "latency"
      ? t(`${K}.readout.latency_value`, { ms: Math.round(value) })
      : t(`${K}.readout.loss_value`, { pct: value });

  const labels = {
    standard: t(`${K}.preset.standard`),
    tolerant: t(`${K}.preset.tolerant`),
    "very-tolerant": t(`${K}.preset.very_tolerant`),
  } satisfies Record<QualityPreset, string>;

  return (
    <motion.div variants={staggerRowItem} className={BLOCK.ROOT}>
      <div className={BLOCK.HEAD}>
        <span id={titleId} className={BLOCK.TITLE}>
          {title}
        </span>
        <span className={cn(DELTA.ROOT, !dirty && DELTA.CLEAN)}>{unsaved}</span>
      </div>

      <PresetRail
        value={draft}
        onSelect={onSelect}
        labelledBy={titleId}
        labels={labels}
      />

      <div className={READOUT.ROOT}>
        <div>
          <p className={READOUT.TITLE}>{labels[draft]}</p>
          <p className={READOUT.BLURB}>
            {t(`${K}.blurb.${metric}_${PRESET_KEY[draft]}`)}
          </p>
        </div>

        {/* Headroom against the selected cut. A null reading is an EMPTY track:
            below the poller's ten-sample floor, loss is unknown, not perfect. */}
        <div className={READOUT.BAR_ROW}>
          <MetricBar
            value={live}
            max={limit}
            warnAt={limit}
            dangerAt={limit}
            // Pinned to the same `over` the chip reads, so the fill and the
            // word can never report different verdicts at the cut.
            colorOverride={over ? "warning" : "primary"}
            track="muted"
          />
        </div>

        <div className={READOUT.PAIRS}>
          <div className={READOUT.PAIR}>
            <span className={READOUT.PAIR_LABEL}>
              {t(`${K}.readout.threshold`)}
            </span>
            <span className={READOUT.PAIR_VALUE}>{format(limit)}</span>
          </div>
          <div className={READOUT.PAIR}>
            <span className={READOUT.PAIR_LABEL}>
              {t(`${K}.readout.debounce`)}
            </span>
            <span className={READOUT.PAIR_VALUE}>
              {t(`${K}.readout.debounce_value`, { count: debounce })}
            </span>
          </div>
          <div className={READOUT.PAIR}>
            <span className={READOUT.PAIR_LABEL}>{t(`${K}.readout.now`)}</span>
            <span className={READOUT.LIVE_LINE}>
              <TickingValue value={live} className={READOUT.PAIR_VALUE}>
                {live === null ? VALUE_NONE : format(live)}
              </TickingValue>
              {/* An unmeasured reading is not "under" — no chip at all. */}
              {live === null ? null : (
                <Badge variant={chip.variant}>
                  <ChipGlyph className="size-3" aria-hidden="true" />
                  {t(`${K}.state.${over ? "over" : "under"}`)}
                </Badge>
              )}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// The loaded form
// -----------------------------------------------------------------------------

interface ThresholdsFormProps {
  quality: UseQualityThresholdsReturn;
  thresholds: QualityThresholdsSettings;
}

function ThresholdsForm({
  quality,
  thresholds,
}: ThresholdsFormProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const { saved: flashed, markSaved } = useSaveFlash();
  const { data: status } = useModemStatus();

  // The draft holds only what the user CHANGED, and the saved value shows
  // through underneath. Nothing syncs server state into local state in an
  // effect, so a re-read can never silently eat a pending edit.
  const [draft, setDraft] = useState<Partial<QualityThresholdsSettings>>({});

  const latency = draft.latency?.preset ?? thresholds.latency.preset;
  const loss = draft.loss?.preset ?? thresholds.loss.preset;

  const dirty =
    latency !== thresholds.latency.preset || loss !== thresholds.loss.preset;
  const canSave = dirty && !quality.isSaving;

  // NEVER `??` a 0 in: a null loss means the poller's window is under its
  // ten-sample floor — not measured, rather than measured and perfect.
  const liveLatency = status?.connectivity?.latency_ms ?? null;
  const liveLoss = status?.connectivity?.packet_loss_pct ?? null;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      await quality.save({ latency: { preset: latency }, loss: { preset: loss } });
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } catch {
      // The hook records `saveError`; the notice above the blocks reports it
      // without taking the form down.
    }
  };

  const unsaved = t(`${K}.unsaved`);

  return (
    <>
      {quality.saveError ? (
        <div role="alert" className={cn(NOTICE.BOX, NOTICE.FAILED)}>
          <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
          <span className={NOTICE.STACK}>
            <span className={NOTICE.TEXT}>{t(`${K}.save_failed`)}</span>
            <span className={NOTICE.DETAIL}>{quality.saveError}</span>
          </span>
        </div>
      ) : null}

      {/* No `initial`/`animate`: this is a child of the page cascade. */}
      <motion.div
        className={cn(ROW_GROUP, GROUP_FILL, "gap-4")}
        variants={staggerRows}
      >
        <TickGroup>
          <MetricBlock
            metric="latency"
            title={t(`${K}.latency.title`)}
            draft={latency}
            saved={thresholds.latency.preset}
            onSelect={(preset) =>
              setDraft((prev) => ({ ...prev, latency: { preset } }))
            }
            live={liveLatency}
            unsaved={unsaved}
          />
          <MetricBlock
            metric="loss"
            title={t(`${K}.loss.title`)}
            draft={loss}
            saved={thresholds.loss.preset}
            onSelect={(preset) =>
              setDraft((prev) => ({ ...prev, loss: { preset } }))
            }
            live={liveLoss}
            unsaved={unsaved}
          />
        </TickGroup>
      </motion.div>

      <div className="flex flex-col gap-1 px-1">
        <span className={NOTE.TEXT}>{t(`${K}.footer`)}</span>
        {quality.isDefault ? (
          <span className={NOTE.TEXT}>{t(`${K}.default_note`)}</span>
        ) : null}
      </div>

      <div className={RECEIPT_ROW}>
        <span className={LABEL_LINE}>
          <span className={cn(DELTA.ROOT, !dirty && DELTA.CLEAN)}>
            {unsaved}
          </span>
          <SaveButton
            onClick={handleSave}
            isSaving={quality.isSaving}
            saved={flashed}
            label={t(`${K}.save`)}
            disabled={!canSave}
            className={PILL_ACTION}
          />
        </span>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Loading
// -----------------------------------------------------------------------------

/**
 * Real `PRESET.RAIL` cells and a real `READOUT.ROOT` wearing slivers, so the
 * placeholder's height RESOLVES to the loaded block's rather than being
 * asserted against it. The bar is a real `MetricBar` with no reading.
 */
function ThresholdsSkeleton(): React.JSX.Element {
  return (
    <>
      <div className={cn(ROW_GROUP, GROUP_FILL, "gap-4")}>
        {[0, 1].map((block) => (
          <div key={block} className={BLOCK.ROOT}>
            <div className={BLOCK.HEAD}>
              <Skeleton className={cn(SKELETON_LOCAL.BLOCK.TITLE, "w-28")} />
            </div>
            <div className={PRESET.RAIL}>
              {[0, 1, 2].map((chip) => (
                <Skeleton key={chip} className={SKELETON_LOCAL.BLOCK.CHIP} />
              ))}
            </div>
            <div className={READOUT.ROOT}>
              <div>
                <Skeleton
                  className={cn(SKELETON_LOCAL.READOUT.TITLE, "w-24")}
                />
                <Skeleton
                  className={cn(SKELETON_LOCAL.READOUT.BLURB, "mt-1 w-full")}
                />
              </div>
              <div className={READOUT.BAR_ROW}>
                {/* Inert bounds — with no reading no fill is rendered at all. */}
                <MetricBar value={null} max={100} warnAt={100} dangerAt={100} track="muted" />
              </div>
              <div className={READOUT.PAIRS}>
                {[0, 1, 2].map((pair) => (
                  <div key={pair} className={READOUT.PAIR}>
                    <Skeleton
                      className={cn(SKELETON_LOCAL.READOUT.PAIR_LABEL, "w-16")}
                    />
                    <Skeleton
                      className={cn(SKELETON_LOCAL.READOUT.PAIR_VALUE, "w-14")}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 px-1">
        <Skeleton className={cn(SKELETON_LOCAL.READOUT.BLURB, "w-full")} />
      </div>

      {/* The receipt strip. Absent, the card grows by its height plus the gap. */}
      <div className={RECEIPT_ROW}>
        <Skeleton className={SKELETON.TIME.ACTION} />
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

export interface QualityThresholdsCardProps {
  quality: UseQualityThresholdsReturn;
}

/**
 * ONE chrome for all three states. The header used to be restated verbatim in
 * each branch, which is how three copies of one title drift apart.
 */
export default function QualityThresholdsCard({
  quality,
}: QualityThresholdsCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle as="h2" className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY, "gap-4")}>
        {quality.isLoading ? (
          <ThresholdsSkeleton />
        ) : !quality.thresholds ? (
          // A failed read. The form would otherwise fill itself with defaults
          // and present them as the device's saved cuts.
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error.title`)}
            description={t(`${K}.error.body`)}
            onAction={() => void quality.refresh()}
            actionLabel={t(`${K}.error.retry`)}
            actionGlyph={RefreshCwIcon}
            className={CONDITION_PANEL.SCREEN}
          />
        ) : (
          <ThresholdsForm quality={quality} thresholds={quality.thresholds} />
        )}
      </CardContent>
    </Card>
  );
}
