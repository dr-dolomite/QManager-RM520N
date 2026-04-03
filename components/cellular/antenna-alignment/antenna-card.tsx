"use client";

import { CheckCircle2Icon, MinusCircleIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
} from "@/types/modem-status";
import type { SignalPerAntenna } from "@/types/modem-status";
import {
  ANTENNA_PORTS,
  normalizeValue,
  formatValue,
  getQualityColor,
  getQualityBadgeClasses,
  isAntennaActive,
  type RadioMode,
} from "./utils";

// ---------------------------------------------------------------------------
// Metric row inside an antenna card section
// ---------------------------------------------------------------------------

function MetricRow({
  label,
  value,
  rawValue,
  unit,
  thresholds,
}: {
  label: string;
  value: number | null | undefined;
  rawValue?: number | null;
  unit: string;
  thresholds: typeof RSRP_THRESHOLDS;
}) {
  const normalized = normalizeValue(rawValue ?? value ?? null);
  const quality = getSignalQuality(normalized, thresholds);
  const isNull = normalized === null;

  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "font-mono text-sm font-medium tabular-nums",
            isNull ? "text-muted-foreground/50" : getQualityColor(quality)
          )}
        >
          {formatValue(normalized, unit)}
        </span>
        {!isNull && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0 h-4",
              getQualityBadgeClasses(quality)
            )}
          >
            {quality.charAt(0).toUpperCase() + quality.slice(1)}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single antenna card
// ---------------------------------------------------------------------------

export function AntennaCard({
  index,
  spa,
  mode,
}: {
  index: number;
  spa: SignalPerAntenna;
  mode: RadioMode;
}) {
  const { name, description } = ANTENNA_PORTS[index];
  const active = isAntennaActive(spa, index);

  const showLte = mode === "lte" || mode === "endc";
  const showNr = mode === "nr" || mode === "endc";

  const lteActive =
    normalizeValue(spa.lte_rsrp[index]) !== null ||
    normalizeValue(spa.lte_rsrq[index]) !== null ||
    normalizeValue(spa.lte_sinr[index]) !== null;
  const nrActive =
    normalizeValue(spa.nr_rsrp[index]) !== null ||
    normalizeValue(spa.nr_rsrq[index]) !== null ||
    normalizeValue(spa.nr_sinr[index]) !== null;

  return (
    <Card className={cn(!active && "opacity-60")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{name}</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {description}
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              active
                ? "bg-success/15 text-success hover:bg-success/20 border-success/30"
                : "bg-muted/50 text-muted-foreground border-muted-foreground/30"
            }
          >
            {active ? (
              <CheckCircle2Icon className="size-3" />
            ) : (
              <MinusCircleIcon className="size-3" />
            )}
            {active ? "Active" : "Inactive"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {showLte && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              4G / LTE{mode === "endc" && " (Anchor)"}
            </p>
            <div
              className={cn(
                "divide-y divide-border rounded-lg border px-3",
                !lteActive && "opacity-50"
              )}
            >
              <MetricRow
                label="RSRP"
                value={spa.lte_rsrp[index]}
                unit="dBm"
                thresholds={RSRP_THRESHOLDS}
              />
              <MetricRow
                label="RSRQ"
                value={spa.lte_rsrq[index]}
                unit="dB"
                thresholds={RSRQ_THRESHOLDS}
              />
              <MetricRow
                label="SINR"
                value={spa.lte_sinr[index]}
                unit="dB"
                thresholds={SINR_THRESHOLDS}
              />
            </div>
          </div>
        )}

        {showNr && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              5G / NR{mode === "endc" && " (Secondary)"}
            </p>
            <div
              className={cn(
                "divide-y divide-border rounded-lg border px-3",
                !nrActive && "opacity-50"
              )}
            >
              <MetricRow
                label="RSRP"
                value={spa.nr_rsrp[index]}
                unit="dBm"
                thresholds={RSRP_THRESHOLDS}
              />
              <MetricRow
                label="RSRQ"
                value={spa.nr_rsrq[index]}
                unit="dB"
                thresholds={RSRQ_THRESHOLDS}
              />
              <MetricRow
                label="SINR"
                value={spa.nr_sinr[index]}
                unit="dB"
                thresholds={SINR_THRESHOLDS}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton card
// ---------------------------------------------------------------------------

export function AntennaCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i}>
            <Skeleton className="h-3 w-12 mb-2" />
            <div className="rounded-lg border px-3 divide-y divide-border">
              {[0, 1, 2].map((j) => (
                <div key={j} className="flex justify-between py-1.5">
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
