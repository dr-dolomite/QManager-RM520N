import React, { useState } from "react";
import { motion } from "motion/react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AbstractPattern } from "./abstract-pattern";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ScenarioConfig } from "@/types/connection-scenario";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
  pattern: "gaming" | "streaming" | "balanced" | "custom";
  config: ScenarioConfig;
  isDefault?: boolean;
}

interface ScenarioItemProps {
  scenario: Scenario;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

// Map gradient to matching ring color
const getRingColor = (gradient: string) => {
  if (gradient.includes("violet")) return "ring-violet-500";
  if (gradient.includes("rose")) return "ring-rose-500";
  if (gradient.includes("emerald")) return "ring-emerald-500";
  if (gradient.includes("blue")) return "ring-blue-500";
  if (gradient.includes("amber")) return "ring-amber-500";
  if (gradient.includes("slate")) return "ring-slate-500";
  if (gradient.includes("sky")) return "ring-sky-500";
  if (gradient.includes("lime")) return "ring-lime-500";
  if (gradient.includes("fuchsia")) return "ring-fuchsia-500";
  if (gradient.includes("yellow")) return "ring-yellow-500";
  if (gradient.includes("cyan")) return "ring-cyan-500";
  if (gradient.includes("orange")) return "ring-orange-500";
  return "ring-primary";
};

export const ScenarioItem = ({
  scenario,
  isActive,
  isSelected,
  onSelect,
  onDelete,
}: ScenarioItemProps) => {
  const Icon = scenario.icon;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isCustom = scenario.pattern === "custom";

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    onDelete?.(scenario.id);
    setShowDeleteDialog(false);
  };

  return (
    <>
      <motion.div
        className={cn(
          "relative overflow-hidden rounded-xl cursor-pointer",
          isActive
            ? `ring-2 ${getRingColor(scenario.gradient)} ring-offset-3 ring-offset-background`
            : isSelected
              ? "ring-2 ring-muted-foreground/40 ring-offset-2 ring-offset-background"
              : "",
        )}
        animate={{ scale: isActive || isSelected ? 1.01 : 1 }}
        whileHover={!isActive && !isSelected ? { scale: 1.02, y: -2 } : {}}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        onClick={() => onSelect(scenario.id)}
      >
        {/* Background gradient */}
        <div
          className={cn("absolute inset-0 bg-linear-to-br", scenario.gradient)}
        />

        {/* Abstract pattern overlay */}
        <AbstractPattern
          type={scenario.pattern}
          className="absolute inset-0 w-full h-full"
        />

        {/* Content */}
        <div className="relative p-5 h-36 flex flex-col justify-between text-white group">
          {/* Top row - Icon and badges/delete */}
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <div className="p-2.5 bg-white/20 backdrop-blur-sm rounded-lg">
                <Icon size={20} />
              </div>
              {isActive && (
                <span className="px-2 py-0.5 bg-white/25 backdrop-blur-sm rounded-full text-xs font-medium">
                  Active
                </span>
              )}
            </div>
            {isCustom && (
              <button
                onClick={handleDeleteClick}
                className="p-2 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-destructive/80 transition-all opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>

          {/* Bottom row - Name and description */}
          <div>
            <h3 className="text-base font-semibold mb-0.5">{scenario.name}</h3>
            <p className="text-white/80 text-xs">{scenario.description}</p>
          </div>
        </div>
      </motion.div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scenario</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{scenario.name}&quot;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
