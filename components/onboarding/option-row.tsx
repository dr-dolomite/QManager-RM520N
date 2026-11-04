"use client";

import { motion } from "motion/react";
import { DUR, EASE_QUICK } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  OPTION_DOT_FILL,
  optionDetail,
  optionDisc,
  optionDot,
  optionRow,
} from "./shapes";

// The one selectable row every onboarding choice uses: a radio inside the caller's
// radiogroup, or a toggle (aria-pressed) when `mode="toggle"`.

interface OptionRowProps {
  selected: boolean;
  onSelect: () => void;
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  size?: "lg" | "sm";
  mode?: "radio" | "toggle";
  disabled?: boolean;
  className?: string;
}

export function OptionRow({
  selected,
  onSelect,
  label,
  detail,
  icon,
  size = "lg",
  mode = "radio",
  disabled = false,
  className,
}: OptionRowProps) {
  return (
    <motion.button
      type="button"
      role={mode === "radio" ? "radio" : undefined}
      aria-checked={mode === "radio" ? selected : undefined}
      aria-pressed={mode === "toggle" ? selected : undefined}
      onClick={onSelect}
      disabled={disabled}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: DUR.quick, ease: EASE_QUICK }}
      className={cn(optionRow(selected, size), className)}
    >
      {icon && <span className={optionDisc(selected)}>{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium leading-snug">{label}</span>
        {detail && (
          <span className={cn("text-xs leading-snug text-pretty", optionDetail(selected))}>
            {detail}
          </span>
        )}
      </span>
      <span aria-hidden="true" className={optionDot(selected)}>
        {selected && <span className={OPTION_DOT_FILL} />}
      </span>
    </motion.button>
  );
}
