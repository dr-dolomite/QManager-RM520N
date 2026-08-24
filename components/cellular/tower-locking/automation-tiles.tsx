"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import {
  rsrpToQualityPercent,
  type TowerFailoverState,
  type TowerLockConfig,
  type TowerModemState,
  type TowerScheduleConfig,
  type TowerScheduleSaveResult,
} from "@/types/tower-locking";

import ScheduleTile from "./schedule-tile";
import {
  AUTO_GRID,
  AUTO_METER,
  AUTO_TILE,
  BADGE_GLYPH_SIZE,
  FAILOVER_BADGE,
  FIELD_CONTROL_ON_CONTAINER,
  HERO_HELP_BUTTON,
  PERSIST_BADGE,
  SKELETON_SHAPE,
  SWITCH_TARGET,
  failoverKey,
  lockPresence,
  persistPosture,
} from "./shapes";

// =============================================================================
// TowerAutomationTiles — "While nobody is watching"
// =============================================================================
// THREE ANSWERS TO ONE QUESTION.
//
// Persistence, signal failover and the schedule used to be three separate
// objects: two rows buried at the foot of the old hero's rail, and a whole card
// of its own sitting in a 2-up grid as the orphaned third cell beside empty
// space. Nothing said they were related, and the schedule in particular read as
// a feature parked wherever there happened to be room.
//
// They are all the same question — WHAT DOES THIS LOCK DO WHEN NOBODY IS
// LOOKING? — asked about three different absences: across a reboot, during a
// signal collapse, and on a clock. Grouping them is what turns "three settings"
// into one thing a reader can hold.
//
// -----------------------------------------------------------------------------
// THEY SIT SECOND, AND THEY USED TO BE THE PAGE'S LAST CARD
// -----------------------------------------------------------------------------
// The earlier order was: see where you are, choose where to point, then decide
// what happens unattended. That is the FIRST SESSION, and only the first. After
// one setup the target rarely moves, while everything a returning reader wants is
// here — does the lock survive a reboot, is the safety net armed, is the window
// still right. Putting these directly under "Right now", and the three-field
// forms below them, matches how the page is actually used.
//
// This component renders NO CARD SHELL AND NO HEADER. It is the body of
// `TOWER_SECTION`, a section the page coordinator owns along with its
// `SECTION_HEAD` title and description — so the two sections on this surface
// cannot drift apart in header geometry. Nesting a `Card` here would put a card
// inside a section for no gain.
//
// THESE TILES ARE NOT INSIDE THE HERO. They were, for one revision, and
// `AUTO_GRID` still carried a `@container/hero` query from it. Both sections now
// declare `@container/section` instead, so the grid responds to whichever one is
// hosting it without this file having to know which — see `AUTO_GRID`. Nothing
// here imports a container name, which is the point.
//
// -----------------------------------------------------------------------------
// WHY FAILOVER BELONGS HERE AND NOT ON A LEG CARD
// -----------------------------------------------------------------------------
// `qmanager_tower_failover` releases BOTH radios when it fires, and it has only
// one device-wide RSRP to work from (`.lte.rsrp` falling back to `.nr.rsrp`) —
// there is no per-leg quality figure anywhere in the pipeline. Rendering it
// inside the LTE card would claim it protects LTE; it protects the modem.
//
// -----------------------------------------------------------------------------
// TWO CHANNELS PER SETTING, AND THEY CAN DISAGREE
// -----------------------------------------------------------------------------
// The persistence tile keeps its CHIP and its SWITCH in the same tile, and that
// pairing is load-bearing rather than tidy. `AT+QNWLOCK="save_ctrl",v,v` writes
// ONE value to both radios but reads them back independently, so a modem can
// report `1,0`. The chip reports what the MODEM says; the switch drives what the
// CONFIG says. When they disagree, the `split` chip is the only thing on screen
// that would tell you — which is only true while the two sit together.
//
// These three are the only switches on this surface that WRITE ANYTHING TO THE
// MODEM, and that is deliberate. Each is a setting that saves the instant it
// moves. The leg cards' "Tower lock" switches were retired because they were not
// settings: they wrote whatever was sitting unsaved in a form and bounced the
// link for 3-5 seconds, which is a button's job.
//
// The leg cards do each keep one more switch — Simple Mode — and it is not a
// counter-example: it writes `localStorage` and swaps an input for a picker,
// touching neither the modem nor the config. So a switch on this page means one
// of exactly two things, and never "perform a write and hope the form was
// right".
// =============================================================================

export interface TowerAutomationTilesProps {
  config: TowerLockConfig | null;
  /** The AT read-back. Drives the persistence chip; `null` = never read. */
  modemState: TowerModemState | null;
  failover: TowerFailoverState | null;
  /** Persist as the CONFIG believes it. The chip reports the MODEM instead. */
  configPersist: boolean;
  /**
   * The configured release threshold, or `null` when NOBODY HAS READ ONE.
   *
   * It is nullable on purpose. The coordinator used to substitute a hardcoded
   * `20` for a missing value, which rendered in this input as a confident
   * two-digit number — including in the error state, where `status.sh` had
   * failed all three retries and nothing had been read at all. A reader has no
   * way to tell a fabricated default from a real setting, and this one gates
   * whether the modem drops a lock. DESIGN.md's State-Honesty Rule: a missing
   * reading is an EMPTY field, never a plausible-looking value.
   */
  failoverThreshold: number | null;
  /** RSRP of the leg the modem is registered on — the figure failover gates. */
  activeRsrp: number | null;
  isLoading: boolean;
  isSavingFailover: boolean;
  onTogglePersist: (enabled: boolean) => Promise<boolean>;
  onToggleFailover: (enabled: boolean) => Promise<boolean>;
  onThresholdChange: (threshold: number) => Promise<boolean>;
  onScheduleChange: (
    schedule: TowerScheduleConfig,
  ) => Promise<TowerScheduleSaveResult>;
}

export function TowerAutomationTiles({
  config,
  modemState,
  failover,
  configPersist,
  failoverThreshold,
  activeRsrp,
  isLoading,
  isSavingFailover,
  onTogglePersist,
  onToggleFailover,
  onThresholdChange,
  onScheduleChange,
}: TowerAutomationTilesProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  // --- Failover threshold -----------------------------------------------------
  // Local string state so a half-typed value is never sent, synced from props by
  // render-time adjustment rather than an effect.
  /**
   * An unread threshold is the EMPTY STRING, and stays empty until the user
   * types — see the prop's contract. The empty case is not "invalid input", it
   * is "no reading", so it gets its own branch everywhere below rather than
   * falling into the 0–100 error copy.
   */
  const thresholdText = failoverThreshold === null ? "" : String(failoverThreshold);
  const [thresholdInput, setThresholdInput] = useState(thresholdText);
  const [prevThreshold, setPrevThreshold] = useState(failoverThreshold);
  if (failoverThreshold !== prevThreshold) {
    setPrevThreshold(failoverThreshold);
    setThresholdInput(thresholdText);
  }

  const parsedThreshold = Number.parseInt(thresholdInput, 10);
  const thresholdValid =
    !Number.isNaN(parsedThreshold) &&
    parsedThreshold >= 0 &&
    parsedThreshold <= 100;
  const thresholdDirty = thresholdInput !== thresholdText;
  /** Blank is UNREAD, not wrong. Only a typed value can be out of range. */
  const thresholdBlank = thresholdInput.trim() === "";
  const thresholdErrored = !thresholdBlank && !thresholdValid;
  /**
   * Blank AND nothing was ever read. A user who clears a real reading to retype
   * it is also blank, and telling THEM the modem never answered would be a
   * second fabrication in the opposite direction — so the note is gated on the
   * PROP, not on the box.
   */
  const thresholdUnread = thresholdBlank && failoverThreshold === null;

  const handleThresholdSave = async () => {
    if (!thresholdValid) return;
    const ok = await onThresholdChange(parsedThreshold);
    if (ok) {
      markSaved();
      toast.success(t("tower_locking.live.threshold_toast_saved"));
    } else {
      toast.error(t("tower_locking.live.threshold_toast_error"));
    }
  };

  const handlePersist = async (checked: boolean) => {
    const ok = await onTogglePersist(checked);
    if (ok) {
      toast.success(
        checked
          ? t("tower_locking.live.persist_toast_enabled")
          : t("tower_locking.live.persist_toast_disabled"),
      );
    } else {
      toast.error(t("tower_locking.live.persist_toast_error"));
    }
  };

  const handleFailover = async (checked: boolean) => {
    const ok = await onToggleFailover(checked);
    if (ok) {
      toast.success(
        checked
          ? t("tower_locking.live.failover_toast_enabled")
          : t("tower_locking.live.failover_toast_disabled"),
      );
    } else {
      toast.error(t("tower_locking.live.failover_toast_error"));
    }
  };

  /**
   * Does a lock exist for failover to guard?
   *
   * THIS WAS `(lte_locked ?? false) || (nr_locked ?? false)` — the one consumer
   * of the three lock booleans with no `read_ok` guard, in a file that got the
   * guard everywhere else. `status.sh` seeds `lte_locked="false"` before it asks
   * the modem anything, so a failed `AT+QNWLOCK` read reached `failoverKey` as
   * a confident "not locked" and the chip answered `standby` — "no lock to
   * guard" — about a modem that may well be locked.
   *
   * A boolean could not hold the fix: on a failed read the seed and the truth
   * are the same value. `lockPresence` is the tri-state, and `unknown` is a
   * chip state of its own.
   */
  const presence = lockPresence(modemState);

  const failState = failoverKey(
    failover ?? { enabled: false, activated: false, watcher_running: false },
    presence,
  );
  const failBadge = FAILOVER_BADGE[failState];

  const persistState = persistPosture(modemState);
  const persistBadge = PERSIST_BADGE[persistState];

  const qualityPct =
    activeRsrp === null ? null : rsrpToQualityPercent(activeRsrp);

  if (isLoading) {
    return (
      <div className={AUTO_GRID}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={SKELETON_SHAPE.AUTO_TILE} />
        ))}
      </div>
    );
  }

  return (
    <motion.div
      className={AUTO_GRID}
      initial="hidden"
      animate="visible"
      variants={staggerRows}
    >
      {/* --- Survive a reboot ---------------------------------------------- */}
      <motion.div variants={staggerRowItem} className={AUTO_TILE.ROOT}>
        <div className={AUTO_TILE.HEAD}>
          <span className={AUTO_TILE.DISC} aria-hidden="true">
            <MaterialSymbol name="restart_alt" size={20} />
          </span>
          <span className={AUTO_TILE.TITLE}>
            {t("tower_locking.live.persist_label")}
          </span>
          <Switch
            id="tower-persist"
            checked={configPersist}
            onCheckedChange={handlePersist}
            aria-label={t("tower_locking.live.persist_label")}
            className={`${SWITCH_TARGET} ml-auto`}
          />
        </div>

        {/* The MODEM's read-back, which is not necessarily what the config file
            believes. `split` is a real reportable fault. */}
        <Badge variant={persistBadge.variant} className="self-start">
          <MaterialSymbol name={persistBadge.glyph} size={BADGE_GLYPH_SIZE} />
          {t(`tower_locking.live.persist_state_${persistState}`)}
        </Badge>

        <p className={`${AUTO_TILE.FOOT} ${AUTO_TILE.BODY}`}>
          {persistState === "split"
            ? t("tower_locking.live.persist_split_help")
            : t("tower_locking.live.persist_help")}
        </p>
      </motion.div>

      {/* --- Release on bad signal ----------------------------------------- */}
      <motion.div variants={staggerRowItem} className={AUTO_TILE.ROOT}>
        <div className={AUTO_TILE.HEAD}>
          <span className={AUTO_TILE.DISC} aria-hidden="true">
            <MaterialSymbol name="shield" size={20} />
          </span>
          <span className={AUTO_TILE.TITLE}>
            {t("tower_locking.live.failover_label")}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("tower_locking.live.failover_help_label")}
                className={HERO_HELP_BUTTON}
              >
                <MaterialSymbol name="info" size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              <p>{t("tower_locking.live.failover_help")}</p>
            </TooltipContent>
          </Tooltip>
          <Switch
            id="tower-failover"
            checked={failover?.enabled ?? false}
            onCheckedChange={handleFailover}
            disabled={isSavingFailover}
            aria-label={t("tower_locking.live.failover_label")}
            className={`${SWITCH_TARGET} ml-auto`}
          />
        </div>

        <Badge variant={failBadge.variant} className="self-start">
          <MaterialSymbol name={failBadge.glyph} size={BADGE_GLYPH_SIZE} />
          {t(`tower_locking.live.failover_state_${failState}`)}
        </Badge>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className={`${FIELD_CONTROL_ON_CONTAINER} w-[6.5rem]`}>
              <InputGroupInput
                id="tower-failover-threshold"
                inputMode="numeric"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleThresholdSave();
                }}
                /* An empty box is not a mistake the user made — it is the modem
                   failing to answer — so it carries no destructive ring and no
                   error copy, only the unread note wired in below. */
                aria-invalid={thresholdErrored || undefined}
                aria-label={t("tower_locking.live.threshold_label")}
                aria-describedby={
                  thresholdErrored
                    ? "tower-failover-threshold-error"
                    : thresholdUnread
                      ? "tower-failover-threshold-unread"
                      : undefined
                }
                placeholder={t("tower_locking.live.tile_no_value")}
                className="text-center font-mono tabular-nums"
              />
              <InputGroupAddon align="inline-end" className="text-on-surface-variant">
                <MaterialSymbol name="percent" size={16} />
              </InputGroupAddon>
            </InputGroup>
            {thresholdDirty || saved ? (
              <SaveButton
                onClick={handleThresholdSave}
                isSaving={false}
                saved={saved}
                label={t("common:actions.update")}
                /* Was a bare `disabled`: an unexplained grey pill that appeared
                   the moment the box went dirty and gave no reason. The two ways
                   to be unsaveable are different problems and now say so. */
                blockedReason={
                  thresholdBlank
                    ? t("tower_locking.blocked.threshold_empty")
                    : thresholdValid
                      ? null
                      : t("tower_locking.live.threshold_invalid")
                }
                className="h-[2.625rem] rounded-pill px-4 text-sm font-semibold"
              />
            ) : null}
          </div>
          <label htmlFor="tower-failover-threshold" className={AUTO_TILE.BODY}>
            {t("tower_locking.live.threshold_label")}
          </label>
        </div>

        {thresholdErrored ? (
          <p
            id="tower-failover-threshold-error"
            role="alert"
            className="text-destructive-on-surface text-xs"
          >
            {t("tower_locking.live.threshold_invalid")}
          </p>
        ) : null}

        {/* NOT an error, and deliberately not styled as one: the field is empty
            because the read failed, which is the modem's problem and not the
            reader's. Saying so is what stops the blank box reading as a bug. */}
        {thresholdUnread ? (
          <p
            id="tower-failover-threshold-unread"
            className="text-on-surface-variant text-xs"
          >
            {t("tower_locking.live.threshold_unread")}
          </p>
        ) : null}

        {/* The threshold and the reading it gates, on ONE track. A "35%" in a
            box says nothing until you can see the modem is at 93%; the previous
            layout put them in two rows four apart. */}
        <div className={`${AUTO_TILE.FOOT} flex flex-col gap-1.5`}>
          <div className={AUTO_METER.ROOT}>
            <div className={AUTO_METER.TRACK}>
              <div
                className={`${AUTO_METER.FILL} bg-primary`}
                style={{ transform: `scaleX(${(qualityPct ?? 0) / 100})` }}
              />
            </div>
            {thresholdValid ? (
              <span
                aria-hidden="true"
                className={AUTO_METER.MARK}
                style={{ left: `${parsedThreshold}%` }}
              />
            ) : null}
          </div>
          <span className={AUTO_TILE.BODY}>
            {t("tower_locking.live.quality_label")}
            {": "}
            <span className="tabular-nums">
              {qualityPct === null
                ? t("tower_locking.live.quality_unknown")
                : t("tower_locking.live.quality_value", { value: qualityPct })}
            </span>
          </span>
        </div>
      </motion.div>

      {/* --- On a clock ---------------------------------------------------- */}
      <motion.div variants={staggerRowItem} className="h-full">
        <ScheduleTile config={config} onScheduleChange={onScheduleChange} />
      </motion.div>
    </motion.div>
  );
}

export default TowerAutomationTiles;
