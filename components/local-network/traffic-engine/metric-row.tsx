"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { METRIC } from "./shapes";

interface MetricRowProps {
  label: string;
  value: ReactNode;
  /** The value is a placeholder or the mode is off: quiet ink. */
  quiet?: boolean;
  /** An opaque string (a domain): machine voice. */
  mono?: boolean;
  /** A lucide glyph before the value. */
  glyph?: ReactNode;
}

/** A 40px key / value pill on `surface-container`: key left, value right. */
export function MetricRow({ label, value, quiet, mono, glyph }: MetricRowProps) {
  return (
    <div className={METRIC.ROOT}>
      <span className={METRIC.KEY}>{label}</span>
      <span
        className={cn(
          METRIC.VALUE,
          quiet ? METRIC.VALUE_QUIET : METRIC.VALUE_ON,
          mono && METRIC.MONO,
        )}
      >
        {glyph}
        {value}
      </span>
    </div>
  );
}

interface DrillRowProps extends Omit<MetricRowProps, "mono"> {
  /** Names the view the row opens. */
  ariaLabel: string;
  onOpen: () => void;
}

/** The same pill as a button with a trailing chevron: opens a view of its own card. */
export function DrillRow({ label, value, quiet, glyph, ariaLabel, onOpen }: DrillRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className={cn("group/drill", METRIC.ROOT, METRIC.DRILL)}
    >
      <span className={METRIC.KEY}>{label}</span>
      <span className={cn(METRIC.VALUE, quiet ? METRIC.VALUE_QUIET : METRIC.VALUE_ON)}>
        {glyph}
        {value}
        <ChevronRightIcon className={METRIC.CHEVRON} aria-hidden="true" />
      </span>
    </button>
  );
}
