"use client";

import React from "react";
import { motion } from "motion/react";
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
import { Skeleton } from "@/components/ui/skeleton";

import type { CarrierComponent } from "@/types/modem-status";
import { staggerContainer, staggerRows } from "@/lib/motion";
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

/** Animated progress bar (spring scaleX) */
function AnimatedProgress({ value }: { value: number }) {
  return (
    <div className="w-20 @[350px]/card:w-28 h-2 overflow-hidden rounded-full bg-secondary">
      <motion.div
        className="h-full rounded-full bg-primary"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: value / 100 }}
        style={{ originX: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 24 }}
      />
    </div>
  );
}

/** A single signal metric row with label, progress bar, and value */
function SignalRow({
  label,
  value,
  unit,
  progress,
}: {
  label: string;
  value: number | null;
  unit: string;
  progress: number;
  quality: "excellent" | "good" | "fair" | "poor" | "none";
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <AnimatedProgress value={progress} />
        <span className="text-sm font-bold w-20 text-right tabular-nums">
          {fmtSignal(value, unit)}
        </span>
      </dd>
    </div>
  );
}

/** A simple info row (no progress bar) */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-sm font-bold">{value}</dd>
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
          <motion.div
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            {components.map((cc, idx) => {
              const rsrpQuality = getSignalQuality(cc.rsrp, RSRP_THRESHOLDS);
              const rsrqQuality = getSignalQuality(cc.rsrq, RSRQ_THRESHOLDS);
              const sinrQuality = getSignalQuality(cc.sinr, SINR_THRESHOLDS);

              return (
                <motion.div
                  key={`${cc.band}-${cc.pci}-${idx}`}
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  <AccordionItem value={`item-${idx}`}>
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
                    <AccordionContent>
                      <motion.dl
                        className="grid gap-1.5 text-base"
                        initial="hidden"
                        animate="visible"
                        variants={staggerRows}
                      >
                        {/* Signal metrics with progress bars */}
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
                          <SignalRow
                            label="RSRP"
                            value={cc.rsrp}
                            unit="dBm"
                            progress={signalToProgress(cc.rsrp, RSRP_THRESHOLDS)}
                            quality={rsrpQuality}
                          />
                        </motion.div>
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
                          <SignalRow
                            label="RSRQ"
                            value={cc.rsrq}
                            unit="dB"
                            progress={signalToProgress(cc.rsrq, RSRQ_THRESHOLDS)}
                            quality={rsrqQuality}
                          />
                        </motion.div>
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
                          <SignalRow
                            label={cc.technology === "NR" ? "SNR" : "SINR"}
                            value={cc.sinr}
                            unit="dB"
                            progress={signalToProgress(cc.sinr, SINR_THRESHOLDS)}
                            quality={sinrQuality}
                          />
                        </motion.div>
                        {cc.technology === "LTE" && cc.rssi !== null && (
                          <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
                            <InfoRow label="RSSI" value={`${cc.rssi} dBm`} />
                          </motion.div>
                        )}
                        {/* Static info */}
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
                          <InfoRow
                            label="Band Name"
                            value={getBandName(cc.band, cc.technology)}
                          />
                        </motion.div>
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
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
                        </motion.div>
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
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
                        </motion.div>
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
                          <InfoRow
                            label="Bandwidth"
                            value={
                              cc.bandwidth_mhz > 0 ? `${cc.bandwidth_mhz} MHz` : "-"
                            }
                          />
                        </motion.div>
                        <motion.div variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }} transition={{ duration: 0.18, ease: "easeOut" }}>
                          <InfoRow
                            label="PCI"
                            value={cc.pci !== null ? String(cc.pci) : "-"}
                          />
                        </motion.div>
                      </motion.dl>
                    </AccordionContent>
                  </AccordionItem>
                </motion.div>
              );
            })}
          </motion.div>
        </Accordion>
      </CardContent>
    </Card>
  );
};

export default ActiveBandsComponent;
