import React from "react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import { SCENARIO_TILE_ADD, SCENARIO_TILE_SHAPE, TILE_CAPTION } from "../shapes";

// =============================================================================
// AddScenarioItem — the ghost tile at the end of the scenario grid
// =============================================================================
// A real <button>, not a clickable <div>: it is the only control in the grid
// that opens a dialog, and it was previously unreachable by keyboard entirely.
// Its accessible name comes from the visible title + caption, so it needs no
// aria-label.
//
// Geometry is the SAME `SCENARIO_TILE_SHAPE.ROOT` / `.DISC` / `.COL` / `.NAME`
// the scenario tiles use, so the ghost slot can never disagree with its
// neighbours on radius, height or anatomy. Only the skin differs:
// `SCENARIO_TILE_ADD`'s dashed stroke, which is semantic here (an empty slot)
// rather than a hairline propping up a weak fill.
//
// Its hover steps ONE TONAL STOP (`surface-container-high`), which is what
// every other hoverable neutral box on this surface does. It used to flip the
// whole 144px tile to `primary-container` — the container layer used as a
// hover state on a box four times its sanctioned size — which is why the ink
// here was left to inherit. It no longer has to be: the caption takes
// `TILE_CAPTION` like every other tile caption on the page.
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
        "h-full w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span
        className={cn(SCENARIO_TILE_SHAPE.DISC, "bg-surface-container-high")}
      >
        <MaterialSymbol name="add" size={21} />
      </span>
      <span className={SCENARIO_TILE_SHAPE.COL}>
        <span className={SCENARIO_TILE_SHAPE.NAME}>
          {t("scenarios.tile.add.title")}
        </span>
        <span className={TILE_CAPTION}>
          {t("scenarios.tile.add.description")}
        </span>
      </span>
    </button>
  );
};
