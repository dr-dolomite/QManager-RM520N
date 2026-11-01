"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
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
import { writeTowerSettings, type UpdateTowerSettings } from "./settings-write";
import {
  AUTO_GRID,
  AUTO_METER,
  AUTO_TILE,
  FAILOVER_BADGE,
  FIELD_CONTROL,
  METER_BARS,
  SKELETON_SHAPE,
  discTone,
  failoverKey,
  meterBarColor,
  meterBarHeight,
  meterBarLit,
  lockPresence,
  type TowerFailoverKey,
} from "./shapes";

// =============================================================================
// TowerAutomationTiles — what the lock does while nobody is watching
// =============================================================================
// Failover, schedule and keep-after-reboot, each showing the SAVED state (config) and, where the modem has one, the
// LIVE state. Keep-after-reboot is one modem-wide switch: `save_ctrl,v,v` writes both radios.
// =============================================================================

const K = "tower_locking";

/** Quiet time after the last slider/keystroke before the threshold is saved. */
const THRESHOLD_AUTOSAVE_MS = 1500;

const FAILOVER_STATE_LABEL: Record<TowerFailoverKey, string> = {
  disabled: `${K}.automation.failover_state_disabled`,
  ready: `${K}.automation.failover_state_ready`,
  watching: `${K}.automation.failover_state_watching`,
  released: `${K}.automation.failover_state_released`,
  stalled: `${K}.automation.failover_state_stalled`,
  unknown: `${K}.automation.failover_state_unknown`,
};

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol
    name="check"
    size={16}
    className={className}
    aria-hidden="true"
  />
);

export interface TowerAutomationTilesProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  failover: TowerFailoverState | null;
  /** RSRP of the leg the modem is registered on; null when unreported. */
  activeRsrp: number | null;
  isLoading: boolean;
  isSavingSettings: boolean;
  onUpdateSettings: UpdateTowerSettings;
  onScheduleChange: (
    schedule: TowerScheduleConfig,
  ) => Promise<TowerScheduleSaveResult>;
}

export function TowerAutomationTiles({
  config,
  modemState,
  failover,
  activeRsrp,
  isLoading,
  isSavingSettings,
  onUpdateSettings,
  onScheduleChange,
}: TowerAutomationTilesProps) {
  const { t } = useTranslation("cellular");

  // `null`, never a default: an unread threshold is an empty field.
  const savedThreshold = config ? config.failover.threshold : null;
  const savedText = savedThreshold === null ? "" : String(savedThreshold);
  const [thresholdInput, setThresholdInput] = useState(savedText);
  const [prevThreshold, setPrevThreshold] = useState(savedThreshold);
  if (savedThreshold !== prevThreshold) {
    setPrevThreshold(savedThreshold);
    // Adopt the saved value only while the draft is untouched: a draft that moved on while the save was in flight is
    // newer than the echo.
    const prevText = prevThreshold === null ? "" : String(prevThreshold);
    if (thresholdInput === prevText) setThresholdInput(savedText);
  }

  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ config, onUpdateSettings, t });
  useEffect(() => {
    latestRef.current = { config, onUpdateSettings, t };
  });
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const parsedThreshold = Number.parseInt(thresholdInput, 10);
  const thresholdValid =
    /^\d{1,3}$/.test(thresholdInput.trim()) &&
    parsedThreshold >= 0 &&
    parsedThreshold <= 100;
  const thresholdBlank = thresholdInput.trim() === "";
  const thresholdErrored = !thresholdBlank && !thresholdValid;
  const thresholdUnread = savedThreshold === null;

  const handleFailover = async (next: boolean) => {
    if (!config || next === config.failover.enabled) return;
    await writeTowerSettings(
      t,
      onUpdateSettings,
      { failover: { enabled: next } },
      next
        ? t(`${K}.toast.failover_enabled`)
        : t(`${K}.toast.failover_disabled`),
    );
  };

  // Commits the draft once the user stops moving the slider or typing; Enter
  // commits at once. Invalid or unchanged drafts never write.
  const commitThreshold = async (text: string) => {
    const { config: cfg, onUpdateSettings: update, t: tr } = latestRef.current;
    const value = Number.parseInt(text, 10);
    if (!cfg || !/^\d{1,3}$/.test(text.trim()) || value < 0 || value > 100) {
      return;
    }
    if (value === cfg.failover.threshold) return;
    // One write at a time; a newer draft waits for the in-flight one to land.
    if (savingRef.current) {
      saveTimerRef.current = setTimeout(() => void commitThreshold(text), 250);
      return;
    }
    savingRef.current = true;
    try {
      const landed = await writeTowerSettings(
        tr,
        update,
        { failover: { threshold: value } },
        tr(`${K}.toast.threshold_saved`),
      );
      // A failed write leaves the control showing a value the modem never took;
      // put it back unless the user has already moved on.
      if (!landed) {
        const restored = String(cfg.failover.threshold);
        setThresholdInput((cur) => (cur === text ? restored : cur));
      }
    } finally {
      savingRef.current = false;
    }
  };

  const editThreshold = (text: string, immediate = false) => {
    setThresholdInput(text);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(
      () => void commitThreshold(text),
      immediate ? 0 : THRESHOLD_AUTOSAVE_MS,
    );
  };

  const presence = lockPresence(modemState);
  const failState = failoverKey(
    failover ?? { enabled: false, activated: false, watcher_running: false },
    presence,
  );
  const failBadge = FAILOVER_BADGE[failState];
  const failLabel = t(FAILOVER_STATE_LABEL[failState]);

  const qualityPct =
    activeRsrp === null ? null : rsrpToQualityPercent(activeRsrp);
  const qualityLabel =
    qualityPct === null
      ? t(`${K}.automation.quality_unknown`)
      : t(`${K}.automation.quality_value`, { value: qualityPct });

  if (isLoading) {
    return (
      <div className={AUTO_GRID}>
        {[0, 1].map((i) => (
          <Skeleton key={i} className={SKELETON_SHAPE.AUTO_TILE} />
        ))}
      </div>
    );
  }

  const controlsDisabled = !config || isSavingSettings;
  // The threshold stays live during its own autosave: disabling it mid-drag
  // drops the thumb and snaps it to the last saved value.
  const thresholdDisabled = !config;

  return (
    <motion.div
      className={AUTO_GRID}
      initial="hidden"
      animate="visible"
      variants={staggerRows}
    >
      {/* --- Signal failover (whole modem, both radios) ------------------- */}
      <motion.div variants={staggerRowItem} className={AUTO_TILE.ROOT}>
        <div className={AUTO_TILE.HEAD}>
          <span
            role="img"
            aria-label={failLabel}
            title={failLabel}
            className={`${AUTO_TILE.DISC} ${discTone(failBadge.variant)}`}
          >
            <MaterialSymbol name="shield" size={20} aria-hidden="true" />
          </span>
          <span className={AUTO_TILE.TITLE}>
            {t(`${K}.automation.failover_label`)}
          </span>
          <HintIcon label={t(`${K}.automation.failover_help_label`)}>
            {t(`${K}.automation.failover_help`)}
          </HintIcon>
          <div className="ml-auto" role="group">
            <SegmentedField
              value={config?.failover.enabled ? "on" : "off"}
              onValueChange={(v) => void handleFailover(v === "on")}
              options={[
                { value: "off", label: t("state.off", { ns: "common" }) },
                { value: "on", label: t("state.on", { ns: "common" }) },
              ]}
              ariaLabel={t(`${K}.automation.failover_label`)}
              disabled={controlsDisabled}
              breakpoint="never"
              glyph={renderCheckGlyph}
            />
          </div>
        </div>

        {/* Locking never turns failover on by itself. */}
        {presence === "present" && failState === "disabled" ? (
          <p className={AUTO_TILE.BODY}>
            {t(`${K}.automation.failover_hint`)}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="tower-failover-threshold"
            className={AUTO_TILE.BODY}
          >
            {t(`${K}.automation.threshold_label`)}
          </label>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="relative w-[6.5rem]">
              <Input
                id="tower-failover-threshold"
                inputMode="numeric"
                autoComplete="off"
                host="container"
                value={thresholdInput}
                onChange={(e) => editThreshold(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") editThreshold(thresholdInput, true);
                }}
                disabled={thresholdDisabled}
                aria-invalid={thresholdErrored || undefined}
                aria-describedby={
                  thresholdErrored
                    ? "tower-failover-threshold-note"
                    : thresholdUnread
                      ? "tower-failover-threshold-note"
                      : undefined
                }
                placeholder={t(`${K}.live.tile_no_value`)}
                className={`${FIELD_CONTROL} pr-8 text-center`}
              />
              <span
                aria-hidden="true"
                className="text-on-surface-variant pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
              >
                %
              </span>
            </div>
            <Slider
              aria-label={t(`${K}.automation.threshold_label`)}
              min={0}
              max={100}
              step={1}
              value={[thresholdValid ? parsedThreshold : 0]}
              onValueChange={([v]) => editThreshold(String(v))}
              disabled={thresholdDisabled}
              className="min-w-32 flex-1"
            />
          </div>
          {thresholdErrored ? (
            <p
              id="tower-failover-threshold-note"
              role="alert"
              className="text-destructive-on-surface text-xs"
            >
              {t(`${K}.automation.threshold_invalid`)}
            </p>
          ) : thresholdUnread ? (
            <p
              id="tower-failover-threshold-note"
              className="text-on-surface-variant text-xs"
            >
              {t(`${K}.automation.threshold_unread`)}
            </p>
          ) : null}
        </div>

        {/* The live reading on the quality ramp; the notch is the threshold. */}
        <div className={AUTO_TILE.FOOT}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="img"
                tabIndex={0}
                aria-label={qualityLabel}
                className={`${AUTO_METER.ROOT} focus-visible:ring-ring rounded-field outline-none focus-visible:ring-[3px]`}
              >
                <div className={AUTO_METER.BARS} aria-hidden="true">
                  {Array.from({ length: METER_BARS }, (_, i) => (
                    <span
                      key={i}
                      className={AUTO_METER.BAR}
                      style={{
                        height: meterBarHeight(i),
                        backgroundColor: meterBarColor(
                          i,
                          meterBarLit(i, qualityPct),
                        ),
                      }}
                    />
                  ))}
                </div>
                {thresholdValid ? (
                  <span
                    aria-hidden="true"
                    className={AUTO_METER.NOTCH}
                    style={{ left: `${parsedThreshold}%` }}
                  />
                ) : null}
              </div>
            </TooltipTrigger>
            <TooltipContent>{qualityLabel}</TooltipContent>
          </Tooltip>
        </div>
      </motion.div>

      <motion.div variants={staggerRowItem} className="h-full">
        <ScheduleTile config={config} onScheduleChange={onScheduleChange} />
      </motion.div>
    </motion.div>
  );
}

export default TowerAutomationTiles;
