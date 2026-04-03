"use client";

import React from "react";
import { motion } from "motion/react";
import { SignalIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useModemStatus } from "@/hooks/use-modem-status";
import {
  ANTENNA_PORTS,
  getSignalQuality,
  signalToProgress,
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
} from "@/types/modem-status";
import type { SignalPerAntenna } from "@/types/modem-status";

const QUALITY_BAR_COLORS: Record<string, string> = {
  excellent: "bg-success",
  good: "bg-success",
  fair: "bg-warning",
  poor: "bg-destructive",
  none: "bg-muted-foreground",
};

// =============================================================================
// Helpers
// =============================================================================

/** Check if a technology has any non-null antenna data */
function hasData(
  signal: SignalPerAntenna | undefined,
  prefix: "lte" | "nr"
): boolean {
  if (!signal) return false;
  const rsrp = signal[`${prefix}_rsrp`];
  const rsrq = signal[`${prefix}_rsrq`];
  const sinr = signal[`${prefix}_sinr`];
  return [...rsrp, ...rsrq, ...sinr].some((v) => v !== null);
}

/** Format a signal value with unit, or "—" for null */
function fmtSignal(value: number | null, unit: string): string {
  if (value === null || value === undefined) return "—";
  return `${value} ${unit}`;
}

// =============================================================================
// Sub-components
// =============================================================================

/** Animated progress bar (spring scaleX) — matches active-bands.tsx pattern */
function AnimatedProgress({
  value,
  label,
  barColor = "bg-primary",
}: {
  value: number;
  label: string;
  barColor?: string;
}) {
  return (
    <div
      className="h-1.5 flex-1 min-w-0 overflow-hidden rounded-full bg-secondary"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <motion.div
        className={`h-full rounded-full ${barColor}`}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: value / 100 }}
        style={{ originX: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 24 }}
      />
    </div>
  );
}

/** A single metric row: label → progress bar → colored value */
function MetricRow({
  label,
  value,
  unit,
  thresholds,
}: {
  label: string;
  value: number | null;
  unit: string;
  thresholds: { excellent: number; good: number; fair: number; poor: number };
}) {
  const quality = getSignalQuality(value, thresholds);
  const progress = signalToProgress(value, thresholds);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground w-10 shrink-0">
        {label}
      </span>
      <AnimatedProgress
        value={progress}
        label={`${label} signal strength`}
        barColor={QUALITY_BAR_COLORS[quality]}
      />
      <span className="text-sm font-semibold tabular-nums min-w-17 text-right shrink-0">
        {fmtSignal(value, unit)}
      </span>
    </div>
  );
}

/** A single antenna section with 3 stacked metric rows */
function AntennaSection({
  name,
  rx,
  rsrp,
  rsrq,
  sinr,
}: {
  name: string;
  rx: string;
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
}) {
  const isInactive = rsrp === null && rsrq === null && sinr === null;

  return (
    <div className={isInactive ? "opacity-25" : ""}>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-base font-semibold">{name}</span>
        <span className="text-xs text-muted-foreground">{rx}</span>
      </div>
      <div className="grid gap-1.5">
        <MetricRow label="RSRP" value={rsrp} unit="dBm" thresholds={RSRP_THRESHOLDS} />
        <MetricRow label="RSRQ" value={rsrq} unit="dB" thresholds={RSRQ_THRESHOLDS} />
        <MetricRow label="SINR" value={sinr} unit="dB" thresholds={SINR_THRESHOLDS} />
      </div>
    </div>
  );
}

/** Technology signal card (LTE or NR5G) */
function TechCard({
  title,
  description,
  signal,
  prefix,
}: {
  title: string;
  description: string;
  signal: SignalPerAntenna | undefined;
  prefix: "lte" | "nr";
}) {
  const active = hasData(signal, prefix);

  if (!active) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="h-full bg-muted/30">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SignalIcon />
              </EmptyMedia>
              <EmptyTitle>No {title.split(" ")[0]} Signal</EmptyTitle>
              <EmptyDescription className="max-w-xs text-pretty">
                Antenna metrics will appear when{" "}
                {prefix === "lte" ? "4G LTE" : "5G NR"} is active.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const rsrp = signal![`${prefix}_rsrp`];
  const rsrq = signal![`${prefix}_rsrq`];
  const sinr = signal![`${prefix}_sinr`];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <motion.div
          className="divide-y divide-border"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05 } },
          }}
        >
          {ANTENNA_PORTS.map((ant, i) => (
            <motion.div
              key={ant.rx}
              className={i === 0 ? "pb-3" : "py-3"}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <AntennaSection
                name={ant.name}
                rx={ant.rx}
                rsrp={rsrp[i] ?? null}
                rsrq={rsrq[i] ?? null}
                sinr={sinr[i] ?? null}
              />
            </motion.div>
          ))}
        </motion.div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function AntennaStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 @3xl/main:grid-cols-2 gap-4">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-48 mt-1" />
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className={j === 0 ? "pb-3" : "py-3"}>
                  <Skeleton className="h-5 w-24 mb-2" />
                  <div className="grid gap-1.5">
                    {[0, 1, 2].map((k) => (
                      <div key={k} className="flex items-center gap-2">
                        <Skeleton className="h-3.5 w-10" />
                        <Skeleton className="h-1.5 flex-1" />
                        <Skeleton className="h-4 w-17" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function AntennaStatistics() {
  const { data, isLoading } = useModemStatus();
  const signal = data?.signal_per_antenna;

  const lteHasData = hasData(signal, "lte");
  const nrHasData = hasData(signal, "nr");

  // Dynamic ordering: active tech first. Default LTE first.
  const nrFirst = nrHasData && !lteHasData;

  const lteCard = (
    <TechCard
      title="LTE Signal"
      description="Per-antenna metrics for 4G LTE"
      signal={signal}
      prefix="lte"
    />
  );

  const nrCard = (
    <TechCard
      title="NR5G Signal"
      description="Per-antenna metrics for 5G NR"
      signal={signal}
      prefix="nr"
    />
  );

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Antenna Statistics</h1>
        <p className="text-muted-foreground">
          Per-antenna signal metrics for each receiver chain. Compare signal
          quality across Main, Diversity, and MIMO antenna ports.
        </p>
      </div>
      {isLoading ? (
        <AntennaStatsSkeleton />
      ) : (
        <div className="grid grid-cols-1 @3xl/main:grid-cols-2 gap-4">
          {nrFirst ? nrCard : lteCard}
          {nrFirst ? lteCard : nrCard}
        </div>
      )}
    </div>
  );
}
