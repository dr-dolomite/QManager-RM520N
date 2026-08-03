"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  buildDayTimeline,
  formatMinute,
  nextScenarioChange,
} from "@/lib/schedule-timeline";
import { cn } from "@/lib/utils";
import {
  bandsToDisplay,
  modeValueToLabel,
  type ConnectionScenario,
} from "@/types/connection-scenario";
import type { ProfileApplyState, SimProfile } from "@/types/sim-profile";

import { resolveScenarioIcon } from "./connection-scenarios/scenario-icons";
import { ScheduleRibbon } from "./schedule-ribbon";
import {
  BADGE_GLYPH_SIZE,
  CONFIG_PILL,
  CONFIG_PILL_BRAND,
  CONFIG_PILL_NEUTRAL,
  HERO_CARD,
  HERO_DISC,
  HERO_EYEBROW,
  HERO_NOTICE,
  HERO_TILE_NEUTRAL,
  HERO_TILE_SCENARIO,
  HERO_TILE_SHAPE,
  MACHINE_VALUE,
  PILL_ACTION,
  PROFILE_STATUS_BADGE,
  RIBBON_SHAPE,
} from "./shapes";

// =============================================================================
// The "in force now" hero
// =============================================================================
// The page's anchor card: what is running on the modem RIGHT NOW, answered
// before the list of things the user could run instead. Everything it renders
// is DERIVED from real state — there is no `showMismatchNotice` prop, because a
// notice driven by a boolean the caller passes in is a notice that can be wrong
// while looking right, and the three states this card reports (SIM mismatch,
// apply in flight, partial apply) are precisely the ones a user acts on.
//
// NOTICE PRIORITY. At most one notice renders, in the order applying → partial
// → mismatch. An apply in flight is the most current fact on the card and the
// only one that is still changing; a partial apply is a finished event the user
// must act on; a SIM mismatch is a standing condition that the identity line's
// badge already announces on its own. Stacking all three would push the tiles —
// the card's actual subject — below the fold on a tablet.
//
// GLYPHS. `fingerprint` (IMEI override) and `edit_calendar` (edit schedule)
// were both absent from `MATERIAL_SYMBOL_NAMES` when this file was first
// written and rendered as `badge` / `schedule` stand-ins. Both have since been
// added to the allowlist and the subset regenerated (`bun run icons:subset &&
// bun run icons:check`), so the call sites below use the real glyphs. If you add
// another, extend the allowlist and regenerate in the same change — the name
// list is type-checked, so an unlisted glyph fails the build rather than
// silently rendering the literal text "fingerprint" on a modem in the field.
// =============================================================================

export interface ActiveProfileHeroProps {
  /** The profile currently in force. */
  profile: SimProfile;
  /** Every known scenario, for name + glyph resolution across the card. */
  scenarios: ConnectionScenario[];
  /** The scenario actually in force, when it is known. */
  activeScenario: ConnectionScenario | null;
  /** Live apply lifecycle, or null when nothing has been applied this boot. */
  applyState: ProfileApplyState | null;
  /** ICCID read off the inserted SIM. Null while unknown — never a mismatch. */
  currentIccid: string | null;
  /** One clock for the whole page, so needle and caption cannot disagree. */
  now: Date;
  /**
   * A mutation the modem is still working through — a deactivate round trip or
   * an apply in flight. Both of the card's actions go dead while it is true.
   *
   * This is not cosmetic. Deactivate is a blocking 8-12s attach cycle and apply
   * is a four-step worker; firing a second mutation into a modem that is
   * mid-`AT+COPS` either collides with the APN lock (a wasted `apn_busy`) or
   * queues a second detach behind the first. The card cannot know this on its
   * own — it is 100% props and fetches nothing — so the coordinator tells it.
   */
  busy?: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onEditSchedule: () => void;
}

export function ActiveProfileHero({
  profile,
  scenarios,
  activeScenario,
  applyState,
  currentIccid,
  now,
  busy = false,
  onEdit,
  onDeactivate,
  onEditSchedule,
}: ActiveProfileHeroProps) {
  const { t } = useTranslation("cellular");

  const { settings, scenario: binding } = profile;
  const schedule = binding.schedule;

  // --- Derived state --------------------------------------------------------
  // A mismatch needs BOTH sides known. A profile saved without an ICCID, or a
  // SIM whose ICCID has not been read yet, is not a mismatch — it is an absence
  // of evidence, and warning on it would train the user to ignore the notice.
  const isMismatch =
    Boolean(profile.sim_iccid) &&
    Boolean(currentIccid) &&
    profile.sim_iccid !== currentIccid;

  const isApplying = applyState?.status === "applying";
  const isPartial = applyState?.status === "partial";

  const applyingStep = isApplying
    ? applyState?.steps[(applyState.current_step ?? 1) - 1]
    : undefined;
  const failedStep = isPartial
    ? applyState?.steps.find((s) => s.status === "failed")
    : undefined;

  const timeline = React.useMemo(
    () => buildDayTimeline(schedule, binding.default, now),
    [schedule, binding.default, now],
  );
  const nextChange = React.useMemo(
    () => nextScenarioChange(timeline.segments, timeline.nowMinute),
    [timeline],
  );

  const scenarioLabel =
    activeScenario?.name ?? t("custom_profiles.hero.scenario.unknown");
  const scenarioGlyph = resolveScenarioIcon(activeScenario?.icon);

  const nextChangeName = nextChange
    ? (scenarios.find((s) => s.id === nextChange.scenarioId)?.name ??
      t("custom_profiles.hero.ribbon.unknown_scenario"))
    : null;

  const showRibbon = schedule.enabled && schedule.blocks.length > 0;

  // The radio tile reports ONE "NR bands" row, but a scenario stores NSA and SA
  // band lists separately. They are merged and de-duplicated rather than one of
  // them being picked: showing only `sa_nr_bands` would silently under-report a
  // profile that locks NSA, and two extra rows would not fit the tile.
  const nrBands = React.useMemo(() => {
    const cfg = activeScenario?.config;
    if (!cfg) return "";
    const merged = [...cfg.nsa_nr_bands.split(":"), ...cfg.sa_nr_bands.split(":")]
      .map((b) => b.trim())
      .filter(Boolean);
    return Array.from(new Set(merged))
      .sort((a, b) => Number(a) - Number(b))
      .join(":");
  }, [activeScenario]);

  const mismatchBadge = PROFILE_STATUS_BADGE.mismatch;

  return (
    <motion.div variants={staggerContainer} className={HERO_CARD}>
      {/* --- Identity line --------------------------------------------- */}
      <motion.div
        variants={staggerItem}
        className="flex flex-col gap-4 @2xl/hero:flex-row @2xl/hero:items-start"
      >
        <span className={HERO_DISC}>
          <MaterialSymbol name="sim_card" size={27} filled />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={HERO_EYEBROW}>{t("custom_profiles.hero.eyebrow")}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="min-w-0 truncate text-xl font-semibold tracking-[-0.01em]">
              {profile.name}
            </span>
            {isMismatch ? (
              <Badge variant={mismatchBadge.variant}>
                <MaterialSymbol
                  name={mismatchBadge.glyph}
                  size={BADGE_GLYPH_SIZE}
                  filled
                />
                {t("custom_profiles.hero.badge_mismatch")}
              </Badge>
            ) : null}
          </span>
          <span className="text-on-surface-variant flex min-w-0 flex-wrap items-center gap-2.5 text-[0.8125rem]">
            <span className="min-w-0 truncate">
              {profile.mno || t("custom_profiles.hero.unknown_operator")}
            </span>
            {profile.sim_iccid ? (
              <>
                <span
                  aria-hidden="true"
                  className="bg-outline size-[0.1875rem] flex-none rounded-pill"
                />
                <span className={cn(MACHINE_VALUE, "min-w-0 truncate text-xs")}>
                  {t("custom_profiles.hero.iccid", { value: profile.sim_iccid })}
                </span>
              </>
            ) : null}
          </span>
        </div>

        <div className="flex flex-none items-center gap-2.5">
          {/* Both actions go dead while the modem is mid-mutation. Editing is
              disabled too, not just Deactivate: saving an ACTIVE profile now
              auto-reapplies it, so Edit is a modem mutation as well. */}
          <Button
            variant="tonal-neutral"
            className={PILL_ACTION}
            onClick={onEdit}
            disabled={busy}
          >
            <MaterialSymbol name="edit" size={17} />
            {t("custom_profiles.hero.edit")}
          </Button>
          <Button
            variant="tonal"
            className={PILL_ACTION}
            onClick={onDeactivate}
            disabled={busy}
          >
            <MaterialSymbol name="power_settings_new" size={17} />
            {t("custom_profiles.hero.deactivate")}
          </Button>
        </div>
      </motion.div>

      {/* --- One notice, at most --------------------------------------- */}
      {isApplying ? (
        <motion.div
          variants={staggerItem}
          aria-live="polite"
          className={cn(HERO_NOTICE, "bg-primary-container text-on-primary-container")}
        >
          <MaterialSymbol
            name="progress_activity"
            size={19}
            className="flex-none animate-spin motion-reduce:animate-none"
          />
          <span className="text-[0.8125rem] leading-relaxed text-pretty">
            {t("custom_profiles.hero.notice.applying", {
              name: applyState?.profile_name || profile.name,
              step: applyState?.current_step ?? 1,
              total: applyState?.total_steps ?? 1,
            })}{" "}
            <span className={cn(MACHINE_VALUE, "text-xs")}>
              {applyingStep?.name ?? ""}
            </span>
          </span>
        </motion.div>
      ) : isPartial ? (
        <motion.div
          variants={staggerItem}
          className={cn(HERO_NOTICE, "bg-warning-container text-on-warning-container")}
        >
          <MaterialSymbol
            name="do_not_disturb_on"
            size={19}
            filled
            className="flex-none"
          />
          <span className="text-[0.8125rem] leading-relaxed text-pretty">
            {t("custom_profiles.hero.notice.partial_lead")}{" "}
            <span className={cn(MACHINE_VALUE, "text-xs")}>
              {failedStep?.name ?? t("custom_profiles.hero.notice.unknown_step")}
            </span>{" "}
            {t("custom_profiles.hero.notice.partial_tail")}{" "}
            <span className={cn(MACHINE_VALUE, "text-xs")}>
              {failedStep?.detail || applyState?.error || "—"}
            </span>
          </span>
        </motion.div>
      ) : isMismatch ? (
        <motion.div
          variants={staggerItem}
          className={cn(HERO_NOTICE, "bg-warning-container text-on-warning-container")}
        >
          <MaterialSymbol name="warning" size={19} filled className="flex-none" />
          <span className="text-[0.8125rem] leading-relaxed text-pretty">
            {t("custom_profiles.hero.notice.mismatch_lead")}{" "}
            <span className={cn(MACHINE_VALUE, "text-xs")}>{currentIccid}</span>{" "}
            {t("custom_profiles.hero.notice.mismatch_tail")}
          </span>
        </motion.div>
      ) : null}

      {/* --- The three tiles -------------------------------------------- */}
      <motion.div variants={staggerItem} className={HERO_TILE_SHAPE.GRID}>
        {/* Identity */}
        <div className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_NEUTRAL)}>
          <span
            className={cn(HERO_TILE_SHAPE.LABEL, "text-on-surface-variant")}
          >
            {t("custom_profiles.hero.tiles.identity")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {settings.apn.name ? (
              <span
                className={cn(CONFIG_PILL, CONFIG_PILL_NEUTRAL, MACHINE_VALUE)}
              >
                {settings.apn.name}
              </span>
            ) : null}
            {settings.apn.cid > 0 ? (
              <span
                className={cn(CONFIG_PILL, CONFIG_PILL_NEUTRAL, MACHINE_VALUE)}
              >
                CID {settings.apn.cid}
              </span>
            ) : null}
            <span
              className={cn(CONFIG_PILL, CONFIG_PILL_NEUTRAL, MACHINE_VALUE)}
            >
              {settings.apn.pdp_type}
            </span>
            {/* A 0 TTL/HL means "don't set", so the pill is omitted rather than
                printing "TTL 0", which reads as a configured value of zero. */}
            {settings.ttl > 0 ? (
              <span
                className={cn(CONFIG_PILL, CONFIG_PILL_NEUTRAL, MACHINE_VALUE)}
              >
                TTL {settings.ttl}
              </span>
            ) : null}
            {settings.hl > 0 ? (
              <span
                className={cn(CONFIG_PILL, CONFIG_PILL_NEUTRAL, MACHINE_VALUE)}
              >
                HL {settings.hl}
              </span>
            ) : null}
            {settings.imei ? (
              <span className={cn(CONFIG_PILL, CONFIG_PILL_BRAND)}>
                <MaterialSymbol name="fingerprint" size={14} />
                {t("custom_profiles.hero.tiles.imei_override")}
              </span>
            ) : null}
          </div>
        </div>

        {/* Scenario in force */}
        <div className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_SCENARIO)}>
          <span className="flex items-center justify-between gap-2">
            <span className={cn(HERO_TILE_SHAPE.LABEL, "min-w-0 truncate")}>
              {t("custom_profiles.hero.tiles.scenario")}
            </span>
            {schedule.enabled ? (
              <span className="inline-flex flex-none items-center gap-1 text-[0.6875rem] font-medium">
                <MaterialSymbol name="schedule" size={14} />
                {t("custom_profiles.hero.tiles.scheduled")}
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-2.5">
            <span className={HERO_TILE_SHAPE.DISC}>
              <MaterialSymbol name={scenarioGlyph} size={19} filled />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="min-w-0 truncate text-base font-semibold">
                {scenarioLabel}
              </span>
              <span className="min-w-0 truncate text-xs">
                {nextChange && nextChangeName
                  ? t("custom_profiles.hero.scenario.next_change", {
                      name: nextChangeName,
                      time: formatMinute(nextChange.atMinute),
                    })
                  : t("custom_profiles.hero.scenario.no_next_change")}
              </span>
            </span>
          </span>
        </div>

        {/* Radio, owned by the scenario */}
        <div className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_NEUTRAL)}>
          <span className="flex items-center justify-between gap-2">
            <span
              className={cn(
                HERO_TILE_SHAPE.LABEL,
                "text-on-surface-variant min-w-0 truncate",
              )}
            >
              {t("custom_profiles.hero.tiles.radio")}
            </span>
            {/* `text-primary` rather than `text-primary-on-surface`: the brand
                family ships no `-on-surface` step (only `warning` does), and
                `text-primary` is already the sanctioned link ink — it is what
                `buttonVariants`' `link` variant resolves to. */}
            <Link
              href="/cellular/band-locking"
              className="text-primary flex-none text-xs font-medium hover:underline"
            >
              {t("custom_profiles.hero.tiles.band_locking")}
            </Link>
          </span>
          <div className="flex flex-col gap-1.5">
            <RadioRow
              label={t("custom_profiles.hero.tiles.network_mode")}
              value={
                activeScenario
                  ? modeValueToLabel(activeScenario.config.atModeValue)
                  : "—"
              }
            />
            <RadioRow
              label={t("custom_profiles.hero.tiles.lte_bands")}
              value={
                activeScenario
                  ? bandsToDisplay(activeScenario.config.lte_bands)
                  : "—"
              }
            />
            <RadioRow
              label={t("custom_profiles.hero.tiles.nr_bands")}
              value={activeScenario ? bandsToDisplay(nrBands) : "—"}
            />
          </div>
        </div>
      </motion.div>

      {/* --- Today's schedule ------------------------------------------- */}
      {showRibbon ? (
        <motion.div variants={staggerItem}>
          <ScheduleRibbon
            segments={timeline.segments}
            nowPercent={timeline.nowPercent}
            nowLabel={formatMinute(timeline.nowMinute)}
            scenarios={scenarios}
            onEditSchedule={onEditSchedule}
          />
        </motion.div>
      ) : null}
    </motion.div>
  );
}

function RadioRow({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center justify-between gap-2.5 text-xs">
      <span className="text-on-surface-variant min-w-0 truncate">{label}</span>
      <span className={cn(MACHINE_VALUE, "min-w-0 truncate font-medium")}>
        {value}
      </span>
    </span>
  );
}

/**
 * The hero's loading state.
 *
 * Every geometry it mirrors is IMPORTED — `HERO_CARD`, `HERO_DISC`,
 * `HERO_TILE_SHAPE.GRID`/`.ROOT`, `RIBBON_SHAPE.ROOT` — so retuning the hero
 * retunes its skeleton in the same edit (the Skeleton-Mirror Rule). Only the
 * placeholder BAR lengths are literal, because a bar length mirrors a string
 * that does not exist yet and has no constant to import.
 *
 * `bg-accent` is appended after each imported constant on purpose: `cn` is
 * tailwind-merge, so the later background wins over `HERO_DISC`'s `bg-primary`
 * while every dimension in the constant survives.
 */
export function ActiveProfileHeroSkeleton() {
  return (
    <div className={HERO_CARD}>
      <div className="flex items-center gap-4">
        <Skeleton className={cn(HERO_DISC, "bg-accent")} />
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-5 w-56 rounded-pill" />
          <Skeleton className="h-3.5 w-72 rounded-pill" />
        </div>
        <Skeleton className={cn(PILL_ACTION, "ml-auto w-32 flex-none")} />
      </div>

      <div className={HERO_TILE_SHAPE.GRID}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn(HERO_TILE_SHAPE.ROOT, HERO_TILE_NEUTRAL)}>
            <Skeleton className="h-3 w-24 rounded-pill" />
            <Skeleton className="h-8 w-full rounded-pill" />
            <Skeleton className="h-3 w-2/3 rounded-pill" />
          </div>
        ))}
      </div>

      <Skeleton className={cn(RIBBON_SHAPE.ROOT, "bg-accent")} />
    </div>
  );
}
