"use client";

import { motion, type Variants } from "motion/react";
import { SignalIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useModemStatus } from "@/hooks/use-modem-status";
import { detectRadioMode } from "./utils";
import { AntennaCard, AntennaCardSkeleton } from "./antenna-card";
import AlignmentMeterSection from "./alignment-meter";

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

const QUALITY_LEGEND = [
  {
    label: "Excellent",
    classes: "bg-success/15 text-success border-success/30",
  },
  { label: "Good", classes: "bg-success/15 text-success border-success/30" },
  {
    label: "Fair",
    classes: "bg-warning/15 text-warning border-warning/30",
  },
  {
    label: "Poor",
    classes:
      "bg-destructive/15 text-destructive border-destructive/30",
  },
];

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: "easeOut" },
  },
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AntennaAlignmentComponent() {
  const { data, isLoading, isStale, error } = useModemStatus();
  const spa = data?.signal_per_antenna ?? null;
  const mode = spa ? detectRadioMode(spa) : null;

  if (isLoading) {
    return (
      <div className="@container/main mx-auto p-2">
        <div className="mb-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <div className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <AntennaCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Antenna Alignment</h1>
        <p className="text-muted-foreground">
          Per-antenna signal strength for each receiver chain. Record and
          compare positions to find the best aim or placement.
        </p>
      </div>

      {(error || isStale) && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4"
        >
          {error
            ? "Unable to reach the modem. Data shown may be outdated."
            : "Signal data is stale — modem may be unresponsive."}
        </div>
      )}

      {spa && mode ? (
        <div className="grid grid-cols-1 gap-4">
          <AlignmentMeterSection spa={spa} mode={mode} />

          <motion.div
            className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2 @5xl/main:grid-cols-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {[0, 1, 2, 3].map((index) => (
              <motion.div key={index} variants={itemVariants}>
                <AntennaCard index={index} spa={spa} mode={mode} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SignalIcon />
            </EmptyMedia>
            <EmptyTitle>No Antenna Data</EmptyTitle>
            <EmptyDescription className="max-w-xs text-pretty">
              Antenna metrics will appear when the modem poller is running and
              reporting per-antenna signal data.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
