"use client";

import { useMemo, useState } from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CARD_FOOT,
  CARD_FOOT_ACTIONS,
  CardFoot,
} from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { RevealButton } from "@/components/ui/reveal-button";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";
import {
  formatBandName,
  type BandActionResult,
  type BandCategory,
} from "@/types/band-locking";

import {
  BADGE_GLYPH_SIZE,
  BAND_CARD,
  BAND_CHIP,
  BAND_LEGEND,
  CARD_PAD,
  CATEGORY_BADGE,
  SKELETON_SHAPE,
  bandChipA11yKey,
  bandChipClass,
  categoryDescriptionKey,
  categoryPosture,
  categoryShortKey,
  categoryTitleKey,
} from "./shapes";

// =============================================================================
// BandGridCard — one band category as a grid of two-axis chips
// =============================================================================
// Ported from RM551E v0.1.34. The parent owns every CGI call; this card owns the local selection. A failed write
// shows in this card's CardFoot, from the result the mutator returned.
//
// `isGated` (a scenario owns radio config) is standing, `isBusy` (a write in flight) is transient. A lock in ANY
// category blocks all: `lock.sh` replaces the failover watcher, so two quick locks would leave one unmonitored.
// =============================================================================

const K = "band_locking";

export interface BandGridCardProps {
  bandCategory: BandCategory;
  /** The lockable universe (the modem's supported list), sorted. */
  supportedBands: number[];
  /** Bands configured on the modem now, sorted. */
  currentLockedBands: number[];
  /** False when `current.sh` failed and `currentLockedBands` is `[]`. */
  hasCurrentReading: boolean;
  onLock: (bands: number[]) => Promise<BandActionResult>;
  /** Locks the full supported list: widening only, so no confirmation. */
  onUnlockAll: () => Promise<BandActionResult>;
  /** True while THIS category's write is in flight. */
  isLocking: boolean;
  /** True while ANY category's write is in flight. */
  isBusy: boolean;
  isLoading: boolean;
  /** This card's last failed write, or null. */
  error: string | null;
  /** A SIM Profile or Connection Scenario owns radio config. */
  isGated?: boolean;
  /** Which one owns it; picks the badge label. */
  gatedBy?: "profile" | "scenario";
}

/** Chip entrance: per-chip delay capped by `rowCascadeDelay`, because a band
 *  list runs past twenty and an unbounded stagger reads as still loading. */
const chipVariants: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DUR.standard,
      ease: EASE_STANDARD,
      delay: rowCascadeDelay(index),
    },
  }),
};

// The two selection buttons share a flex row, so an expanding one pushes its neighbour along (see `RevealButton`).
const SELECTION_TOOLS = "flex flex-none items-center gap-1.5";

export function BandGridCard({
  bandCategory,
  supportedBands,
  currentLockedBands,
  hasCurrentReading,
  onLock,
  onUnlockAll,
  isLocking,
  isBusy,
  isLoading,
  error,
  isGated = false,
  gatedBy = "scenario",
}: BandGridCardProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  const title = t(categoryTitleKey(bandCategory));
  const description = t(categoryDescriptionKey(bandCategory));
  const shortName = t(categoryShortKey(bandCategory));

  const [checkedBands, setCheckedBands] = useState<Set<number>>(
    () => new Set(currentLockedBands),
  );

  // Adjust state during render, never in an effect (the array is rebuilt every render); `length > 0` keeps an
  // unreported category from wiping a selection, and this is what repaints the grid after a write.
  const [prevLockedKey, setPrevLockedKey] = useState("");
  const lockedKey = currentLockedBands.join(":");
  if (prevLockedKey !== lockedKey && currentLockedBands.length > 0) {
    setPrevLockedKey(lockedKey);
    setCheckedBands(new Set(currentLockedBands));
  }

  const liveBands = useMemo(
    () => new Set(currentLockedBands),
    [currentLockedBands],
  );

  const posture = categoryPosture(
    currentLockedBands,
    supportedBands,
    hasCurrentReading,
  );
  const isUnrestricted = posture === "unrestricted";
  const isUnavailable = posture === "unavailable";

  const pendingCount = useMemo(() => {
    let count = 0;
    for (const band of supportedBands) {
      if (checkedBands.has(band) !== liveBands.has(band)) count += 1;
    }
    return count;
  }, [supportedBands, checkedBands, liveBands]);

  const hasChanges = pendingCount > 0;
  const noneSelected = checkedBands.size === 0;
  // An unreadable lock freezes the card: any write from it would be blind and
  // could silently replace a lock the user was never shown.
  const isFrozen = isGated || isBusy || isUnavailable;

  const toggleBand = (band: number) => {
    setCheckedBands((prev) => {
      const next = new Set(prev);
      if (next.has(band)) next.delete(band);
      else next.add(band);
      return next;
    });
  };

  const handleApply = async () => {
    const bands = [...checkedBands].sort((a, b) => a - b);
    const result = await onLock(bands);
    if (result.ok) {
      markSaved();
      toast.success(
        t(`${K}.toast.locked_success`, { category_label: shortName }),
      );
    } else {
      toast.error(result.error);
    }
  };

  const handleUnlockAll = async () => {
    const result = await onUnlockAll();
    if (result.ok) {
      toast.success(
        t(`${K}.toast.unlocked_success`, { category_label: shortName }),
      );
    } else {
      toast.error(result.error);
    }
  };

  // --- Loading ---------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className={BAND_CARD}>
        <CardHeader className={CARD_PAD}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <Skeleton className={SKELETON_SHAPE.CARD_TITLE} />
              <Skeleton className={SKELETON_SHAPE.CARD_DESC} />
            </div>
            <Skeleton className={SKELETON_SHAPE.CARD_CHIP} />
          </div>
        </CardHeader>
        <CardContent className={CARD_PAD}>
          <div className={BAND_CHIP.GRID}>
            {Array.from({ length: SKELETON_SHAPE.CHIP_COUNT }).map((_, i) => (
              <Skeleton key={i} className={SKELETON_SHAPE.CHIP} />
            ))}
          </div>
        </CardContent>
        <div className={`${CARD_PAD} ${CARD_FOOT}`}>
          <div className={CARD_FOOT_ACTIONS}>
            <Skeleton className={SKELETON_SHAPE.ACTION_SECONDARY} />
            <Skeleton className={SKELETON_SHAPE.ACTION} />
          </div>
        </div>
      </Card>
    );
  }

  // --- Empty: a SKU that reports no bands here. A fact, not a fault. --------
  if (supportedBands.length === 0) {
    return (
      <Card className={BAND_CARD}>
        <CardHeader className={CARD_PAD}>
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className={CARD_PAD}>
          <ConditionScreen
            tone="neutral"
            glyph="do_not_disturb_on"
            ariaRole="status"
            title={t(`${K}.card.empty_title`)}
            description={t(`${K}.card_empty`)}
            className="rounded-tile"
          />
        </CardContent>
      </Card>
    );
  }

  // --- Loaded ----------------------------------------------------------------
  // `unavailable` outranks the gate: the gate says who may change the setting,
  // `unavailable` says we do not know what it is.
  const statusKey: keyof typeof CATEGORY_BADGE = isUnavailable
    ? "unavailable"
    : isGated
      ? "scenario"
      : isUnrestricted
        ? "unrestricted"
        : "locked";
  const status = CATEGORY_BADGE[statusKey];
  const statusLabel =
    statusKey === "locked"
      ? t(`${K}.card_badges.bands_locked`, {
          locked: currentLockedBands.length,
          total: supportedBands.length,
        })
      : statusKey === "scenario" && gatedBy === "profile"
        ? t(`${K}.card_badges.profile`)
        : t(`${K}.card_badges.${statusKey}`);

  const chips = (
    <motion.div
      className={BAND_CHIP.GRID}
      initial="hidden"
      animate="visible"
      role="group"
    >
      {supportedBands.map((band, index) => {
        const selected = checkedBands.has(band);
        const live = liveBands.has(band);
        const label = formatBandName(bandCategory, band);
        return (
          <motion.button
            key={band}
            type="button"
            custom={index}
            variants={chipVariants}
            aria-pressed={selected}
            aria-label={t(bandChipA11yKey(selected, live), { band: label })}
            disabled={isFrozen}
            onClick={() => toggleBand(band)}
            className={bandChipClass(selected, live)}
          >
            {label}
          </motion.button>
        );
      })}
    </motion.div>
  );

  const footStatus = error ? (
    <span role="alert" className="inline-flex items-center gap-1.5 text-destructive-on-surface">
      <MaterialSymbol name="error" size={16} className="flex-none" />
      <span className="min-w-0">{error}</span>
    </span>
  ) : isUnavailable ? (
    <span className="inline-flex items-center gap-1.5">
      <MaterialSymbol name="visibility_off" size={16} className="flex-none" />
      {t(`${K}.card.unavailable_note`)}
    </span>
  ) : null;

  return (
    <Card
      className={BAND_CARD}
      aria-disabled={isGated || isUnavailable || undefined}
    >
      <CardHeader className={CARD_PAD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="text-pretty">
              {description}
            </CardDescription>
          </div>
          <Badge variant={status.variant} className="flex-none">
            <MaterialSymbol name={status.glyph} size={BADGE_GLYPH_SIZE} />
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent
        className={`${CARD_PAD} flex flex-col gap-4`}
        aria-label={title}
        role="group"
      >
        {chips}

        {liveBands.size > 0 ? (
          <div className={BAND_LEGEND.ROOT}>
            <span className={BAND_LEGEND.ITEM}>
              <span className={BAND_LEGEND.SWATCH_SELECTED} aria-hidden="true" />
              {t(`${K}.legend.selected`)}
            </span>
            <span className={BAND_LEGEND.ITEM}>
              <span className={BAND_LEGEND.SWATCH_LIVE} aria-hidden="true" />
              {t(`${K}.legend.live`)}
            </span>
          </div>
        ) : null}
      </CardContent>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isLocking
          ? t(`${K}.card_live_region`, { category_label: shortName })
          : ""}
      </div>

      <CardFoot
        className={CARD_PAD}
        status={
          <>
            <div className={SELECTION_TOOLS}>
              <RevealButton
                glyph="done_all"
                label={t(`${K}.card_buttons.select_all`)}
                onClick={() => setCheckedBands(new Set(supportedBands))}
                disabled={isFrozen}
              />
              <RevealButton
                glyph="close"
                label={t(`${K}.card_buttons.deselect_all`)}
                onClick={() => setCheckedBands(new Set())}
                disabled={isFrozen || noneSelected}
              />
            </div>
            {footStatus}
          </>
        }
        actions={
          <>
            <Button
              type="button"
              variant="tonal-neutral"
              onClick={handleUnlockAll}
              disabled={isFrozen || isUnrestricted}
              size="action"
            >
              {t(`${K}.card_buttons.unlock_all`)}
            </Button>
            <SaveButton
              onClick={handleApply}
              isSaving={isLocking}
              saved={saved}
              label={t(`${K}.card_buttons.lock_selected`)}
              disabled={isFrozen || noneSelected || !hasChanges}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
}

export default BandGridCard;
