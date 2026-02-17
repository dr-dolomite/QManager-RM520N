"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

import type { CarrierComponent } from "@/types/modem-status";
import {
  getSignalQuality,
  signalToProgress,
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
} from "@/types/modem-status";
import {
  getDLFrequency,
  getULFrequency,
  formatFrequency,
  getBandName,
  getDuplexMode,
} from "@/lib/earfcn";
import { TbCircleArrowDownFilled, TbCircleArrowUpFilled } from "react-icons/tb";

// =============================================================================
// Props
// =============================================================================

interface ActiveBandsComponentProps {
  carrierComponents: CarrierComponent[] | null;
  isLoading: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Quality level → tailwind color class for progress bar indicator */
function qualityColor(
  quality: "excellent" | "good" | "fair" | "poor" | "none",
): string {
  switch (quality) {
    case "excellent":
      return "text-green-500";
    case "good":
      return "text-blue-500";
    case "fair":
      return "text-yellow-500";
    case "poor":
      return "text-red-500";
    default:
      return "text-muted-foreground";
  }
}

/** Technology badge styling */
function techBadgeClass(tech: "LTE" | "NR"): string {
  return tech === "NR"
    ? "bg-blue-500 hover:bg-blue-500 text-white"
    : "bg-emerald-500 hover:bg-emerald-500 text-white";
}

/** Format a signal value with unit, or "-" for null */
function fmtSignal(value: number | null, unit: string): string {
  if (value === null || value === undefined) return "-";
  return `${value} ${unit}`;
}

// =============================================================================
// Sub-components
// =============================================================================

/** A single signal metric row with label, progress bar, and value */
function SignalRow({
  label,
  value,
  unit,
  progress,
  quality,
}: {
  label: string;
  value: number | null;
  unit: string;
  progress: number;
  quality: "excellent" | "good" | "fair" | "poor" | "none";
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <div className="flex items-center">
        <Progress className="w-24 mr-2" value={progress} />
        <p className="text-sm ml-2 font-bold w-20 text-right">
          {fmtSignal(value, unit)}
        </p>
      </div>
    </div>
  );
}

/** A simple info row (no progress bar) */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

const ActiveBandsComponent = ({
  carrierComponents,
  isLoading,
}: ActiveBandsComponentProps) => {
  // Loading state
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Active Cellular Bands</CardTitle>
          <CardDescription>
            Detailed information about the currently active cellular bands.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  const components = carrierComponents ?? [];

  // Empty state
  if (components.length === 0) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Active Cellular Bands</CardTitle>
          <CardDescription>
            Detailed information about the currently active cellular bands.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            No active carrier components detected. Carrier aggregation data
            updates every ~30 seconds.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Active Cellular Bands</CardTitle>
        <CardDescription>
          {components.length} active carrier{components.length !== 1 ? "s" : ""}
          . Expand each band for detailed signal metrics.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion
          type="single"
          collapsible
          className="w-full"
          defaultValue="item-0"
        >
          {components.map((cc, idx) => {
            const rsrpQuality = getSignalQuality(cc.rsrp, RSRP_THRESHOLDS);
            const rsrqQuality = getSignalQuality(cc.rsrq, RSRQ_THRESHOLDS);
            const sinrQuality = getSignalQuality(cc.sinr, SINR_THRESHOLDS);

            return (
              <AccordionItem
                key={`${cc.band}-${cc.pci}-${idx}`}
                value={`item-${idx}`}
              >
                <AccordionTrigger className="font-bold">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      className={`text-xs rounded-full ${techBadgeClass(cc.technology)}`}
                    >
                      {cc.type} {getDuplexMode(cc.band, cc.technology)}
                    </Badge>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold">
                        {cc.technology} {cc.band}
                      </p>
                      <span className="text-sm text-muted-foreground">–</span>
                      <p className="text-sm">
                        {/* Show E/U/FRCN */}
                        {cc.earfcn}
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="grid gap-1.5 text-base">
                  {/* Signal metrics with progress bars */}
                  <SignalRow
                    label="RSRP"
                    value={cc.rsrp}
                    unit="dBm"
                    progress={signalToProgress(cc.rsrp, RSRP_THRESHOLDS)}
                    quality={rsrpQuality}
                  />
                  <SignalRow
                    label="RSRQ"
                    value={cc.rsrq}
                    unit="dB"
                    progress={signalToProgress(cc.rsrq, RSRQ_THRESHOLDS)}
                    quality={rsrqQuality}
                  />
                  <SignalRow
                    label={cc.technology === "NR" ? "SNR" : "SINR"}
                    value={cc.sinr}
                    unit="dB"
                    progress={signalToProgress(cc.sinr, SINR_THRESHOLDS)}
                    quality={sinrQuality}
                  />
                  {cc.technology === "LTE" && cc.rssi !== null && (
                    <InfoRow label="RSSI" value={`${cc.rssi} dBm`} />
                  )}
                  {/* Static info */}
                  <InfoRow
                    label="Band Name"
                    value={getBandName(cc.band, cc.technology)}
                  />
                  <InfoRow
                    label="UL Frequency"
                    value={
                      cc.earfcn !== null
                        ? formatFrequency(
                            getULFrequency(cc.earfcn, cc.technology, cc.band),
                          )
                        : "-"
                    }
                  />
                  <InfoRow
                    label="DL Frequency"
                    value={
                      cc.earfcn !== null
                        ? formatFrequency(
                            getDLFrequency(cc.earfcn, cc.technology),
                          )
                        : "-"
                    }
                  />
                  <InfoRow
                    label="Bandwidth"
                    value={
                      cc.bandwidth_mhz > 0 ? `${cc.bandwidth_mhz} MHz` : "-"
                    }
                  />
                  <InfoRow
                    label="PCI"
                    value={cc.pci !== null ? String(cc.pci) : "-"}
                  />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
};

export default ActiveBandsComponent;
