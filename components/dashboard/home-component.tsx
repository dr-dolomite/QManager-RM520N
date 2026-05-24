"use client";

import React from "react";
import { motion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useAboutDevice } from "@/hooks/use-about-device";
import NetworkStatusComponent from "./network-status";
import DeviceStatus from "./device-status";
import LTEStatusComponent from "./lte-status";
import NrStatusComponent from "./nr-status";
import SccStatusComponent from "./scc-status";
import { SignalHistoryComponent } from "./signal-history";
import RecentActivitiesComponent from "./recent-activities";
import DeviceMetricsComponent from "./device-metrics";
import LiveLatencyComponent from "./live-latency";

const DEFAULT_POLL_MS = 2000;
const POLL_BUFFER_MS = 250; // Small lag past each daemon write to avoid catching a half-written cache

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
};

const HomeComponent = () => {
  const [pollInterval, setPollInterval] = React.useState<number>(DEFAULT_POLL_MS);
  const { data, isLoading, isStale, error } = useModemStatus({ pollInterval });
  const { data: aboutDevice } = useAboutDevice();

  // Tie poll cadence to the ping daemon's write interval (Connection Sensitivity).
  // history_interval_sec comes straight from the active profile, so this adapts
  // automatically when the user changes Sensitivity in System Settings.
  const daemonIntervalSec = data?.connectivity?.history_interval_sec;
  React.useEffect(() => {
    if (!daemonIntervalSec || daemonIntervalSec <= 0) return;
    const next = daemonIntervalSec * 1000 + POLL_BUFFER_MS;
    setPollInterval((prev) => (prev === next ? prev : next));
  }, [daemonIntervalSec]);

  const networkType = data?.network?.type ?? "";
  const carrierComponents = data?.network?.carrier_components ?? [];
  const hasScc = carrierComponents.some((c) => c.type === "SCC");

  return (
    <div className="grid grid-cols-1 gap-6 px-4 lg:px-6 @4xl/main:grid-cols-5" aria-live="polite" aria-atomic="false">
      {error && !isLoading && (
        <div role="alert" className="col-span-full rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Unable to reach the modem. Data shown may be outdated.
        </div>
      )}
      <div className="grid gap-4 col-span-1 @4xl/main:col-span-3">
        <NetworkStatusComponent
          data={data?.network ?? null}
          connectivity={data?.connectivity ?? null}
          modemReachable={data?.modem_reachable ?? false}
          isLoading={isLoading}
          isStale={isStale}
        />
        <motion.div
          className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* LTE PCC — shown in LTE and NSA modes; spans full width when no SCCs */}
          {networkType !== "5G-SA" && (
            <motion.div
              variants={itemVariants}
              className={cn(
                "h-full *:data-[slot=card]:h-full",
                networkType === "LTE" && !hasScc && "@3xl/main:col-span-2",
              )}
            >
              <LTEStatusComponent
                data={data?.lte ?? null}
                isLoading={isLoading}
              />
            </motion.div>
          )}

          {/* NR PCC — shown in SA and NSA modes; spans full width when no SCCs */}
          {networkType !== "LTE" && (
            <motion.div
              variants={itemVariants}
              className={cn(
                "h-full *:data-[slot=card]:h-full",
                networkType === "5G-SA" && !hasScc && "@3xl/main:col-span-2",
              )}
            >
              <NrStatusComponent
                data={data?.nr ?? null}
                isLoading={isLoading}
              />
            </motion.div>
          )}

          {/*
           * SCC card on the right — Primary always on the left, Secondary always on the right.
           * 5G-NSA intentionally omits SCC here to keep the dual-Primary row uncluttered;
           * carrier-aggregation details for NSA live on the Cellular Information page.
           */}
          {(networkType === "LTE" || networkType === "5G-SA") && hasScc && (
            <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
              <SccStatusComponent carriers={carrierComponents} />
            </motion.div>
          )}
        </motion.div>
      </div>
      <div className="col-span-1 @4xl/main:col-span-2 h-full *:data-[slot=card]:h-full">
        <DeviceStatus
          data={data?.device ?? null}
          isLoading={isLoading}
          lanGateway={aboutDevice?.network.lan_gateway}
        />
      </div>

      <div className="col-span-full">
        <motion.div
          className="grid grid-cols-1 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3 grid-flow-row gap-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
            <DeviceMetricsComponent
              deviceData={data?.device ?? null}
              trafficData={data?.traffic ?? null}
              lteData={data?.lte ?? null}
              nrData={data?.nr ?? null}
              isLoading={isLoading}
            />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
            <LiveLatencyComponent
              connectivity={data?.connectivity ?? null}
              isLoading={isLoading}
            />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full *:data-[slot=card]:h-full">
            <RecentActivitiesComponent />
          </motion.div>
        </motion.div>
      </div>

      <div className="col-span-full">
        <SignalHistoryComponent />
      </div>
    </div>
  );
};

export default HomeComponent;
