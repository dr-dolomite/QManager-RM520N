import React from "react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import { SCENARIO_TILE_ADD, SCENARIO_TILE_SHAPE } from "../shapes";

// =============================================================================
// AddScenarioItem — the ghost tile at the end of the scenario grid
// =============================================================================
// A real <button>, not a clickable <div>: it is the only control in the grid
// that opens a dialog, and it was previously unreachable by keyboard entirely.
// Its accessible name comes from the visible title + caption, so it needs no
// aria-label.
//
// Geometry is the SAME `SCENARIO_TILE_SHAPE.ROOT` the scenario tiles use, so
// the ghost slot can never again disagree with its neighbours on radius or
// height. Only the skin differs: `SCENARIO_TILE_ADD`'s dashed stroke, which is
// semantic here (an empty slot) rather than a hairline propping up a weak fill.
//
// Left-aligned and bottom-weighted to match the loaded tiles beside it — the
// centred layout this carried before made the ghost read as a different kind of
// object in the same grid.
// =============================================================================

interface AddScenarioItemProps {
  onClick: () => void;
}

export const AddScenarioItem = ({ onClick }: AddScenarioItemProps) => {
  const { t } = useTranslation("cellular");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        SCENARIO_TILE_SHAPE.ROOT,
        SCENARIO_TILE_ADD,
        "w-full cursor-pointer items-start justify-end gap-1.5 text-left transition-[background-color,border-color,color] duration-[var(--duration-quick)] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {/* Ink is INHERITED throughout, never restated. `SCENARIO_TILE_ADD`
          swaps the whole tile to `primary-container` on hover, and a child
          pinned to `on-surface` would be that container's ink crossed with
          another role's. Hierarchy comes from size and weight instead. */}
      <span
        className={cn(SCENARIO_TILE_SHAPE.DISC, "bg-surface-container mb-auto")}
      >
        <MaterialSymbol name="add" size={21} />
      </span>
      <span className="text-[0.9375rem] font-semibold">
        {t("scenarios.tile.add.title")}
      </span>
      <span className="text-xs">{t("scenarios.tile.add.description")}</span>
    </button>
  );
};
