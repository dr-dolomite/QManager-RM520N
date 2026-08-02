import React from "react";
import { MaterialSymbol } from "@/components/ui/material-symbol";

interface AddScenarioItemProps {
  onClick: () => void;
}

export const AddScenarioItem = ({ onClick }: AddScenarioItemProps) => (
  <div
    className="relative overflow-hidden rounded-xl cursor-pointer transition-all duration-[var(--duration-quick)] ease-out hover:scale-[1.01] border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 bg-muted/30 hover:bg-primary/5"
    onClick={onClick}
  >
    <div className="p-5 h-36 flex flex-col items-center justify-center text-muted-foreground hover:text-primary transition-colors">
      <div className="p-3 bg-background rounded-lg shadow-sm mb-2">
        <MaterialSymbol name="add" size={22} />
      </div>
      <h3 className="text-sm font-medium">Create Scenario</h3>
      <p className="text-xs text-muted-foreground/70 mt-0.5">
        Add custom configuration
      </p>
    </div>
  </div>
);
