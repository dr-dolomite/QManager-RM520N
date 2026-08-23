"use client";

import { useMemo, useState } from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  CONDITION_TONE,
  ConditionScreen,
} from "@/components/cellular/condition-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";
import { formatBandName, type BandCategory } from "@/types/band-locking";

import {
  BADGE_GLYPH_SIZE,
  BAND_CARD,
  BAND_CHIP,
  BAND_LEGEND,
  CARD_PAD,
  CATEGORY_BADGE,
  NOTICE,
  NOTICE_TONE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  PILL_QUIET,
  SKELETON_SHAPE,
  bandChipA11yKey,
  bandChipClass,
  categoryDescriptionKey,
  categoryPosture,
  categoryShortKey,
  categoryTitleKey,
} from "./shapes";

// =============================================================================
// BandGridCard — one band category, as a grid of two-axis toggle chips
// =============================================================================
// One instance per band category. The parent owns every CGI call; this
// component owns only the local selection and calls back.
//
// See `shapes.ts` > THE TWO-AXIS BAND CHIP for why a chip replaced the
// checkbox: a checkbox has one channel, and this surface has two facts
// (selected, and live-on-the-modem) that the incumbent grid could not tell
// apart. The two states it could not express — a pending add and a pending
// removal — are the ones a user most needs to see before writing to a radio
// they are connected through.
//
// -----------------------------------------------------------------------------
// THREE CARD SHELLS, ONE CONSTANT
// -----------------------------------------------------------------------------
// The loading, empty and loaded branches all render `BAND_CARD`. The incumbent
// declared its shell separately in each branch, so its radius, border and shadow
// were three independent facts that happened to agree. They will not stay
// agreeing.
//
// -----------------------------------------------------------------------------
// `isGated` AND `isBusy` ARE NOT THE SAME FLAG
// -----------------------------------------------------------------------------
// The incumbent fused them into one `isDisabled`, and only the header chip told
// them apart. They mean different things and the user needs both:
//
//   isGated  A STANDING CONDITION — a Custom SIM Profile or a Connection
//            Scenario owns radio configuration right now. It is explained by a
//            page-level banner and resolved by changing something elsewhere.
//   isBusy   TRANSIENT — a lock is in flight. It clears on its own.
//
// `isBusy` covers a lock in ANY category, not just this one, which is a
// deliberate correction rather than an inherited behaviour: `lock.sh` kills any
// existing failover watcher when it arms a new one, so two locks fired seconds
// apart leave the first one's narrowing completely unmonitored for the rest of
// its 30-second safety window. `isLocking` stays this card's OWN operation, so
// the spinner still lands on the button the user actually pressed.
// =============================================================================

export interface BandGridCardProps {
  bandCategory: BandCategory;
  /** Hardware-supported bands for this category (from `policy_band`, sorted). */
  supportedBands: number[];
  /** Bands currently configured on the modem (from `ue_capability_band`, sorted). */
  currentLockedBands: number[];
  /**
   * False when `current.sh` failed and `currentLockedBands` is the coordinator's
   * `[]` fallback rather than the modem's answer.
   *
   * Without it this card printed "0 of 31 locked" for a failed read, because an
   * empty locked list and a fully-restricted radio are indistinguishable from
   * the array alone. See `categoryPosture` in `shapes.ts`.
   */
  hasCurrentReading: boolean;
  onLock: (bands: number[]) => Promise<boolean>;
  /** Restores the full supported list. NOT a clear — see `handleRestoreAll`. */
  onRestoreAll: () => Promise<boolean>;
  /** True while THIS category's write is in flight. Drives the save spinner. */
  isLocking: boolean;
  /** True while ANY category's write is in flight. Blocks interaction. */
  isBusy: boolean;
  isLoading: boolean;
  /** Scoped to this category by the coordinator — never the shared hook error. */
  error: string | null;
  /** True when a profile or scenario owns radio config. A standing condition. */
  isGated?: boolean;
}

/**
 * The chip entrance.
 *
 * `staggerRows` is deliberately NOT used here even though a chip is a row-scale
 * object. It drives its cascade with `staggerChildren`, which is unbounded, and
 * a supported-band list routinely runs past twenty entries — at the 80ms row
 * step the twenty-first chip would land 1.68s after the first, which reads as
 * the card still loading rather than as content arriving.
 *
 * `rowCascadeDelay` is the project's answer to exactly that (it caps at index
 * 10), but it is a per-child delay and cannot be combined with `staggerChildren`
 * — so the delay moves onto the item variant via `custom`. Every value is still
 * a token: the 5px rise and the curve are `staggerRowItem`'s, and the step and
 * its cap both derive from `STAGGER_STEP_ROWS`.
 */
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

export function BandGridCard({
  bandCategory,
  supportedBands,
  currentLockedBands,
  hasCurrentReading,
  onLock,
  onRestoreAll,
  isLocking,
  isBusy,
  isLoading,
  error,
  isGated = false,
}: BandGridCardProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  const title = t(categoryTitleKey(bandCategory));
  const description = t(categoryDescriptionKey(bandCategory));
  /** The category's own short name. NEVER derived from the rendered title —
   *  see `shapes.ts` > `categoryTitleKey` for the bug that pattern caused. */
  const shortName = t(categoryShortKey(bandCategory));

  const [checkedBands, setCheckedBands] = useState<Set<number>>(
    () => new Set(currentLockedBands),
  );

  // ---------------------------------------------------------------------------
  // DO NOT convert this to a useEffect.
  // ---------------------------------------------------------------------------
  // This is React's documented "adjust state when a prop changes" pattern, run
  // during render. `currentLockedBands` is rebuilt on every parent render, so it
  // is a NEW ARRAY EVERY TIME — an effect keyed on it would loop forever, and
  // because the react-hooks compiler plugin bails at the first violation in a
  // component, doing so would also silently hide every later diagnostic in this
  // file. The joined string key is what makes the comparison meaningful.
  //
  // The `length > 0` guard is not dead defensiveness either: `current.sh`
  // returns "" for a category the modem does not report, which parses to [], and
  // without the guard every poll of an unreported category would wipe a
  // selection the user was in the middle of making.
  //
  // This block is also the ONLY thing that repaints the grid after a successful
  // write. The chain is: restore/apply -> lockBands -> fetchCurrent -> new
  // currentLockedBands -> new lockedKey -> here. Nothing else connects a click
  // to the grid updating.
  // ---------------------------------------------------------------------------
  const [prevLockedKey, setPrevLockedKey] = useState("");
  const lockedKey = currentLockedBands.join(":");
  if (prevLockedKey !== lockedKey && currentLockedBands.length > 0) {
    setPrevLockedKey(lockedKey);
    setCheckedBands(new Set(currentLockedBands));
  }

  /** Fast lookup for the chip's LIVE axis. */
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
  /** `current.sh` failed, so `currentLockedBands` is the coordinator's `[]`
   *  fallback rather than the modem's answer. */
  const isUnavailable = posture === "unavailable";

  /** How many chips differ from what is on the modem — the pending-change count. */
  const pendingCount = useMemo(() => {
    let count = 0;
    for (const band of supportedBands) {
      if (checkedBands.has(band) !== liveBands.has(band)) count += 1;
    }
    return count;
  }, [supportedBands, checkedBands, liveBands]);

  const hasChanges = pendingCount > 0;
  const noneSelected = checkedBands.size === 0;
  /**
   * Interaction block. Distinct from `isGated` — see the header note.
   *
   * `isUnavailable` belongs in it, and leaving it out was the defect. That
   * posture was used only for DISPLAY: the header chip said "Not readable"
   * while the grid underneath drew 31 unselected, ring-less chips, which says
   * the opposite — that nothing is locked. An unavailable read means the
   * current lock is UNKNOWN, so any write from this card is BLIND: ticking one
   * band and pressing Apply sends that band alone and silently destroys a lock
   * the user was never shown. Freezing every control is the only honest state
   * until the read succeeds.
   */
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
    if (bands.length === 0) {
      toast.error(t("band_locking.toast.none_selected"));
      return;
    }
    const ok = await onLock(bands);
    if (ok) {
      markSaved();
      toast.success(t("band_locking.toast.locked", { category: shortName }));
    } else {
      toast.error(t("band_locking.toast.lock_error", { category: shortName }));
    }
  };

  /**
   * "Restore all supported" writes the FULL supported list — it does not clear
   * anything. That is worth naming precisely, because the incumbent called it
   * "unlock/reset" behind an unlabelled `restart_alt` icon whose only
   * explanation was a `title` attribute that never appears on touch.
   *
   * It gets a visible label and no confirmation dialog, deliberately. It is the
   * one band write that can only ever WIDEN what the modem may use, so it is the
   * recovery action — and gating the recovery while `Apply` (the write that can
   * actually cost you the connection) fires freely would invert the risk
   * gradient this product is built around.
   */
  const handleRestoreAll = async () => {
    const ok = await onRestoreAll();
    if (ok) {
      toast.success(t("band_locking.toast.unlocked", { category: shortName }));
    } else {
      toast.error(t("band_locking.toast.unlock_error", { category: shortName }));
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
        <CardFooter className={`${CARD_PAD} gap-2`}>
          <Skeleton className={SKELETON_SHAPE.ACTION} />
          <Skeleton className={SKELETON_SHAPE.ACTION_SECONDARY} />
        </CardFooter>
      </Card>
    );
  }

  // --- Empty -----------------------------------------------------------------
  // A real state, not a failure: plenty of RM520N SKUs report no SA band list at
  // all. It keeps the card shell so the grid does not reflow around it.
  //
  // It renders through the shared `ConditionScreen` rather than a hand-rolled
  // tile, for the reason that primitive exists: this surface had its own copy of
  // the disc/headline/body stack, so its geometry and its tone were free to
  // drift from the four `/cellular/` screens that say the same kind of thing.
  //
  // `neutral`, not `warning`. A SKU that reports no bands in a category is a
  // fact about the hardware, not a fault the user can act on — and
  // `condition-screen.tsx`'s own tone table reserves neutral for exactly this
  // ("we do not know, and pretending otherwise would be the actual bug").
  // `ariaRole="status"` follows from the same reading: nothing here is urgent.
  // No `spin`: this is a standing condition, and a spinner would advertise work
  // that is not happening.
  if (supportedBands.length === 0) {
    return (
      <Card className={BAND_CARD}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className={CARD_PAD}>
          <ConditionScreen
            tone="neutral"
            glyph="do_not_disturb_on"
            ariaRole="status"
            title={t("band_locking.card.empty_title")}
            description={t("band_locking.card.empty_body")}
          />
        </CardContent>
      </Card>
    );
  }

  // --- Loaded ----------------------------------------------------------------
  // `unavailable` OUTRANKS the gate. Both are standing conditions, but the gate
  // says who may CHANGE this setting while `unavailable` says we do not know
  // what the setting IS — and a "Scenario controlled" chip over a grid drawn
  // from a failed read asserts the scenario's bands are the ones shown.
  //
  // The count is suppressed rather than zeroed: "0 of 31 locked" is the exact
  // fabrication this branch exists to delete, and a zero is a claim where the
  // truth is an absence.
  const statusKey: keyof typeof CATEGORY_BADGE =
    posture === "unavailable"
      ? "unavailable"
      : isGated
        ? "scenario"
        : isUnrestricted
          ? "unrestricted"
          : "locked";
  const status = CATEGORY_BADGE[statusKey];
  const statusLabel =
    posture === "unavailable"
      ? t("band_locking.card.status_unavailable")
      : isGated
        ? t("band_locking.card.status_scenario")
        : isUnrestricted
          ? t("band_locking.card.status_unrestricted")
          : t("band_locking.card.status_locked", {
              count: currentLockedBands.length,
              total: supportedBands.length,
            });

  return (
    // Both STANDING conditions, so both belong here; `isBusy` does not, being
    // transient.
    <Card
      className={BAND_CARD}
      aria-disabled={isGated || isUnavailable || undefined}
    >
      <CardHeader className={CARD_PAD}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="truncate text-lg">{title}</CardTitle>
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

      <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
        <motion.div
          className={BAND_CHIP.GRID}
          initial="hidden"
          animate="visible"
          role="group"
          aria-label={title}
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

        {/* The legend renders only where the ring is actually in play. A key
            explaining a mark that appears nowhere on screen is noise. */}
        {liveBands.size > 0 ? (
          <div className={BAND_LEGEND.ROOT}>
            <span className={BAND_LEGEND.ITEM}>
              <span className={BAND_LEGEND.SWATCH_SELECTED} aria-hidden="true" />
              {t("band_locking.card.legend_selected")}
            </span>
            <span className={BAND_LEGEND.ITEM}>
              <span className={BAND_LEGEND.SWATCH_LIVE} aria-hidden="true" />
              {t("band_locking.card.legend_live")}
            </span>
          </div>
        ) : null}

        {/* The gated path explains itself through the header chip AND a
            page-level banner. The unavailable path had only the chip, which
            names the condition but never says the controls below it are inert
            or why — so a frozen grid read as a broken one. This is that reason,
            in the card, next to the controls it applies to.

            `neutral` from the shared tone table, not `NOTICE_TONE`: that one is
            destructive and belongs to a failed WRITE, which can be on screen at
            the same time. A missing reading is not a fault of the radio. */}
        {isUnavailable ? (
          <div
            role="status"
            className={`${NOTICE.ROOT} ${CONDITION_TONE.neutral.container}`}
          >
            <span
              aria-hidden="true"
              className={`${NOTICE.DISC} ${CONDITION_TONE.neutral.disc}`}
            >
              <MaterialSymbol name="visibility_off" size={16} />
            </span>
            <span className="min-w-0 flex-1 leading-relaxed">
              {t("band_locking.card.unavailable_note")}
            </span>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className={`${NOTICE.ROOT} ${NOTICE_TONE.fill}`}>
            <span
              aria-hidden="true"
              className={`${NOTICE.DISC} ${NOTICE_TONE.disc}`}
            >
              <MaterialSymbol name={NOTICE_TONE.glyph} size={16} />
            </span>
            <span className="min-w-0 flex-1 leading-relaxed">{error}</span>
          </div>
        ) : null}
      </CardContent>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isLocking ? t("band_locking.a11y.applying", { category: shortName }) : ""}
      </div>

      <CardFooter
        className={`${CARD_PAD} flex flex-wrap items-center justify-between gap-x-2 gap-y-3`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SaveButton
            onClick={handleApply}
            isSaving={isLocking}
            saved={saved}
            label={t("band_locking.actions.lock_selected")}
            disabled={isFrozen || noneSelected || !hasChanges}
            className={PILL_ACTION_PLAIN}
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleRestoreAll}
            disabled={isFrozen || isUnrestricted}
            className={PILL_ACTION}
          >
            <MaterialSymbol name="restart_alt" size={18} />
            {t("band_locking.actions.restore_all")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {/* Pending count sits with the selection controls, not in the header:
              the header chip reports the MODEM's state and this reports the
              FORM's. Putting them in one place would merge two different
              truths into one line. */}
          {hasChanges ? (
            <span className="text-on-surface-variant mr-1 text-xs font-medium tabular-nums">
              {t("band_locking.card.pending", { count: pendingCount })}
            </span>
          ) : null}
          <Button
            type="button"
            variant="tonal-neutral"
            onClick={() => setCheckedBands(new Set(supportedBands))}
            disabled={isFrozen}
            className={PILL_QUIET}
          >
            {t("band_locking.actions.select_all")}
          </Button>
          <Button
            type="button"
            variant="tonal-neutral"
            onClick={() => setCheckedBands(new Set())}
            disabled={isFrozen || noneSelected}
            className={PILL_QUIET}
          >
            {t("band_locking.actions.select_none")}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export default BandGridCard;
