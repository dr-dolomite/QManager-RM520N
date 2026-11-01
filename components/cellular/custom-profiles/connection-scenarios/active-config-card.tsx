"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { CONDITION_TONE } from "@/components/cellular/condition-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  bandsLabel,
  modeLabel,
  optimizationLabel,
} from "@/components/cellular/custom-profiles/scenario-labels";
import { cn } from "@/lib/utils";
import { BADGE_GLYPH_SIZE } from "../shapes";
import type { Scenario } from "./scenario-item";

// =============================================================================
// ActiveConfigCard — the Selected-scenario card
// =============================================================================
// Shows the selected tile's config and commits it from the CardFoot; Activate is withheld (body says why) while the
// active profile owns the radio. The body folds on a `0fr -> 1fr` grid-row morph, closed by default.
// =============================================================================

/** Glance metric pill: key left, value right, no dividers. */
const ROW =
  "flex h-10 items-center justify-between gap-4 rounded-pill bg-surface-container px-4 text-[13px]";
const ROW_GRID = "grid gap-2 @xl/card:grid-cols-2 @4xl/card:grid-cols-3";
/** The card's own gap is cancelled outside and restored inside the clip, so a
 *  folded body leaves no gap behind. */
const FOLD =
  "-mt-6 grid motion-safe:transition-[grid-template-rows] motion-safe:duration-[var(--duration-emphasized)] motion-safe:ease-[var(--ease-emphasized)]";

interface ActiveConfigCardProps {
  scenario: Scenario | undefined;
  isActive: boolean;
  isActivating: boolean;
  isLoading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onActivate: () => void;
  /** The active profile owns scenario activation. */
  locked: boolean;
  /** The ownership comes from an enabled schedule (not a static binding). */
  scheduleLocked: boolean;
  /** "HH:MM" of the next scheduled transition (shown while schedule-locked). */
  nextChangeAt: string | null;
  /** Name of the profile that owns the scenario. */
  ownerProfileName?: string | null;
}

export const ActiveConfigCard = ({
  scenario,
  isActive,
  isActivating,
  isLoading,
  onEdit,
  onDelete,
  onActivate,
  locked,
  scheduleLocked,
  nextChangeAt,
  ownerProfileName,
}: ActiveConfigCardProps) => {
  const { t } = useTranslation("cellular");
  const K = "scenarios.active_config";
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  if (isLoading || !scenario) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardFoot
          className="px-6"
          liveStatus={false}
          aria-hidden="true"
          actions={<Skeleton className="h-[2.625rem] w-32 rounded-pill" />}
        />
      </Card>
    );
  }

  const isCustom = !scenario.isDefault;
  const info = CONDITION_TONE.primary;
  const showActivate = open && !locked;

  const { lte_bands, sa_nr_bands, nsa_nr_bands } = scenario.config;
  const rows: { label: string; value: string; quiet?: boolean }[] = [
    { label: t(`${K}.rows.network_mode`), value: modeLabel(t, scenario.config.atModeValue) },
    {
      label: t(`${K}.rows.optimization`),
      value: optimizationLabel(t, scenario.config.optimization),
    },
    { label: t(`${K}.rows.lte_bands`), value: bandsLabel(t, lte_bands), quiet: !lte_bands },
    { label: t(`${K}.rows.nr_sa_bands`), value: bandsLabel(t, sa_nr_bands), quiet: !sa_nr_bands },
    {
      label: t(`${K}.rows.nr_nsa_bands`),
      value: bandsLabel(t, nsa_nr_bands),
      quiet: !nsa_nr_bands,
    },
  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          {/* Mouse convenience only; the chevron is the keyboard trigger. */}
          <div
            className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5"
            onClick={() => setOpen((v) => !v)}
          >
            <CardTitle>{t(`${K}.title`, { name: scenario.name })}</CardTitle>
            <CardDescription>{scenario.description}</CardDescription>
          </div>
          <div className="flex flex-none items-center gap-2">
            {/* Running state lives on the tile's disc; only the schedule lock,
                which explains the missing Activate, is stated here. */}
            {scheduleLocked ? (
              <Badge variant="info">
                <MaterialSymbol name="lock_clock" size={BADGE_GLYPH_SIZE} />
                {t("scenarios.schedule_lock.badge")}
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={t(open ? `${K}.hide_details` : `${K}.show_details`)}
              onClick={() => setOpen((v) => !v)}
              className="-my-2 -mr-2"
            >
              <MaterialSymbol
                name="expand_more"
                size={20}
                className={cn(
                  "motion-safe:transition-transform motion-safe:duration-[var(--duration-standard)] motion-safe:ease-[var(--ease-standard)]",
                  open && "rotate-180",
                )}
              />
            </Button>
          </div>
        </div>
      </CardHeader>

      <div
        id={bodyId}
        inert={!open}
        className={cn(FOLD, open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="min-h-0 overflow-hidden">
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className={ROW_GRID}>
              {rows.map((row) => (
                <div key={row.label} className={ROW}>
                  <span className="truncate font-semibold text-on-surface-variant">
                    {row.label}
                  </span>
                  <span
                    className={cn(
                      "truncate text-right tabular-nums",
                      row.quiet ? "text-on-surface-variant" : "font-semibold",
                    )}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {locked ? (
              <div
                role="status"
                className={cn("flex items-start gap-3 rounded-tile px-4 py-3", info.container)}
              >
                <MaterialSymbol name="lock_clock" size={18} className="mt-px flex-none" />
                <div className="grid gap-0.5 text-sm">
                  <p>
                    {ownerProfileName
                      ? t(`${K}.disabled_tooltip`, { profile: ownerProfileName })
                      : t("scenarios.ownership_notice")}
                  </p>
                  {scheduleLocked && nextChangeAt ? (
                    <p className="text-xs tabular-nums opacity-80">
                      {t("scenarios.schedule_lock.next_change", { time: nextChangeAt })}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </div>
      </div>

      {isCustom || showActivate ? (
        <CardFoot
          className="px-6"
          actions={
            <>
              {isCustom ? (
                <>
                  <Button type="button" variant="ghost" size="action" onClick={onDelete}>
                    <MaterialSymbol name="delete" size={18} />
                    {t("scenarios.tile.delete_dialog.confirm")}
                  </Button>
                  <Button type="button" variant="tonal-neutral" size="action" onClick={onEdit}>
                    <MaterialSymbol name="edit" size={18} />
                    {t(`${K}.edit`)}
                  </Button>
                </>
              ) : null}
              {showActivate ? (
                <SaveButton
                  type="button"
                  onClick={onActivate}
                  isSaving={isActivating}
                  saved={false}
                  disabled={isActive}
                  label={t(`${K}.activate`)}
                  size="action"
                />
              ) : null}
            </>
          }
        />
      ) : null}
    </Card>
  );
};
