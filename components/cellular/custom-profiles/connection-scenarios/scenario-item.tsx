"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import { staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ConnectionScenario } from "@/types/connection-scenario";
import { resolveScenarioIcon } from "./scenario-icons";

// =============================================================================
// ScenarioItem — one scenario as a selectable tile
// =============================================================================
// Selecting a tile only shows it in the Selected-scenario card; activation is the explicit commit there. Only the
// running scenario uses colour: `success` disc, pulse rings (off under reduced motion), sr-only label.
// =============================================================================

export interface Scenario extends Omit<ConnectionScenario, "isDefault"> {
  isDefault?: boolean;
}

/** The tile box; the card's skeleton renders this same class. */
export const SCENARIO_TILE =
  "flex h-full min-h-[9rem] w-full flex-col gap-3.5 rounded-tile px-6 py-5 text-left transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] focus-visible:outline-none";

export const SCENARIO_TILE_GRID =
  "grid grid-cols-1 gap-3 @md/card:grid-cols-2 @4xl/card:grid-cols-4";

interface ScenarioItemProps {
  scenario: Scenario;
  isActive: boolean;
  isSelected: boolean;
  /** Translated network-mode label, from `atModeValue`. */
  modeLabel: string;
  onSelect: (id: string) => void;
  /** "HH:MM" of the next scheduled start, when a schedule will run it. */
  nextAt?: string | null;
}

export const ScenarioItem = ({
  scenario,
  isActive,
  isSelected,
  modeLabel,
  onSelect,
  nextAt,
}: ScenarioItemProps) => {
  const { t } = useTranslation("cellular");
  const { lte_bands, nsa_nr_bands, sa_nr_bands } = scenario.config;
  const pinsBands = Boolean(lte_bands || nsa_nr_bands || sa_nr_bands);

  return (
    <motion.div variants={staggerRowItem} className="h-full">
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onSelect(scenario.id)}
        className={cn(
          SCENARIO_TILE,
          isSelected
            ? "bg-surface-container-high ring-1 ring-outline ring-inset"
            : "bg-surface-container hover:bg-surface-container-high",
        )}
      >
        <span aria-hidden="true" className="relative grid size-10 flex-none place-items-center">
          {isActive ? (
            <>
              {/* Translucent `success`: a tone step sits within a step of the
                  tile ground in dark mode and vanishes. */}
              <span className="absolute -inset-3 animate-pulse-ring rounded-pill bg-success/25" />
              <span
                className="absolute -inset-1.5 animate-pulse-ring rounded-pill bg-success/40"
                style={{ animationDelay: "0.3s" }}
              />
            </>
          ) : null}
          <span
            className={cn(
              "relative grid size-10 place-items-center rounded-pill transition-colors duration-[var(--duration-standard)] ease-out",
              isActive
                ? "bg-success text-success-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            <MaterialSymbol name={resolveScenarioIcon(scenario.icon)} size={20} filled />
          </span>
        </span>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">
            {scenario.name}
            {isActive ? (
              <span className="sr-only"> ({t("scenarios.tile.in_force")})</span>
            ) : null}
          </span>
          <span className="line-clamp-2 text-xs text-on-surface-variant">
            {scenario.description}
          </span>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          <Tag variant="neutral">{modeLabel}</Tag>
          {pinsBands ? (
            <Tag variant="neutral">{t("scenarios.scenario_item.band_lock")}</Tag>
          ) : null}
          {nextAt ? (
            <Tag variant="neutral" className="tabular-nums">
              {t("scenarios.tile.caption_next", { time: nextAt })}
            </Tag>
          ) : null}
        </div>
      </button>
    </motion.div>
  );
};
