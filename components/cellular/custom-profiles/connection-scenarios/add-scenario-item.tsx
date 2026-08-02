import React from "react";
import { useTranslation } from "react-i18next";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";
import { SCENARIO_TILE_ADD, SCENARIO_TILE_SHAPE } from "../shapes";

interface AddScenarioItemProps {
  onClick: () => void;
}

export const AddScenarioItem = ({ onClick }: AddScenarioItemProps) => {
  const { t } = useTranslation("cellular");

  return (
    <div
      className={cn(
        SCENARIO_TILE_SHAPE.ROOT,
        "cursor-pointer items-center text-center transition-[background-color,border-color,color,transform] duration-[var(--duration-quick)] ease-out hover:scale-[1.01]",
        SCENARIO_TILE_ADD,
      )}
      onClick={onClick}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <span
          className={cn(
            SCENARIO_TILE_SHAPE.DISC,
            "bg-surface text-on-surface-variant",
          )}
        >
          <MaterialSymbol name="add" size={22} />
        </span>
        <div>
          <h3 className="text-sm font-medium">
            {t("scenarios.tile.add.title")}
          </h3>
          <p className="text-on-surface-variant mt-0.5 text-xs">
            {t("scenarios.tile.add.description")}
          </p>
        </div>
      </div>
    </div>
  );
};
