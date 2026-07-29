"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Banner } from "@/components/ui/banner";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useAboutDevice } from "@/hooks/use-about-device";
import NetworkStatusComponent from "./network-status";
import DeviceStatus from "./device-status";
import LTEStatusComponent from "./lte-status";
import NrStatusComponent from "./nr-status";
import CarrierAggregationComponent from "./carrier-aggregation";
import { SignalHistoryComponent } from "./signal-history";
import RecentActivitiesComponent from "./recent-activities";
import DeviceMetricsComponent from "./device-metrics";
import LiveLatencyComponent from "./live-latency";

const DEFAULT_POLL_MS = 2000;
const POLL_BUFFER_MS = 250; // Small lag past each daemon write to avoid catching a half-written cache

const HomeComponent = () => {
  const { t } = useTranslation("dashboard");
  const [pollInterval, setPollInterval] = React.useState<number>(DEFAULT_POLL_MS);
  const { data, isLoading, isStale, receivedAtMs, error } = useModemStatus({
    pollInterval,
  });
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

  return (
    <div className="grid grid-cols-1 gap-6 px-4 lg:px-6 @4xl/main:grid-cols-5" aria-live="polite" aria-atomic="false">
      {error && !isLoading && (
        <Banner
          role="stale"
          title={t("alert.modem_unreachable")}
          className="col-span-full"
        />
      )}
      {/* One stagger owns the whole left column, so the hero card enters with
          the cascade instead of popping in ahead of its own siblings. */}
      <motion.div
        className="grid gap-4 col-span-1 @4xl/main:col-span-3"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <NetworkStatusComponent
            data={data?.network ?? null}
            connectivity={data?.connectivity ?? null}
            modemReachable={data?.modem_reachable ?? false}
            isLoading={isLoading}
            isStale={isStale}
          />
        </motion.div>
        {/* Nested container: inherits `visible` from the column above, then
            runs its own cascade over the carrier cards. No initial/animate of
            its own — that would detach it from the parent's timing. */}
        <motion.div
          className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4"
          variants={staggerContainer}
        >
          {/* LTE PCC — shown in LTE and NSA modes; spans the row when it is the
              only carrier card (LTE-only, i.e. no NR leg beside it). */}
          {networkType !== "5G-SA" && (
            <motion.div
              variants={staggerItem}
              className={cn(
                "h-full *:data-[slot=card]:h-full",
                networkType === "LTE" && "@3xl/main:col-span-2",
              )}
            >
              <LTEStatusComponent
                data={data?.lte ?? null}
                isLoading={isLoading}
              />
            </motion.div>
          )}

          {/* NR PCC — shown in SA and NSA modes; spans the row when it is the
              only carrier card (5G-SA, i.e. no LTE leg beside it). */}
          {networkType !== "LTE" && (
            <motion.div
              variants={staggerItem}
              className={cn(
                "h-full *:data-[slot=card]:h-full",
                networkType === "5G-SA" && "@3xl/main:col-span-2",
              )}
            >
              <NrStatusComponent
                data={data?.nr ?? null}
                isLoading={isLoading}
              />
            </motion.div>
          )}

        </motion.div>
      </motion.div>
      {/* Device Information is the head of the right column, so it enters on
          the same clock as the hero at the head of the left one — a lone
          `staggerItem` with its own initial/animate, no container, because a
          single child needs no cascade. It was the one column card outside the
          entrance entirely, which made it pop in ahead of every sibling. */}
      <motion.div
        className="col-span-1 @4xl/main:col-span-2 h-full *:data-[slot=card]:h-full"
        variants={staggerItem}
        initial="hidden"
        animate="visible"
      >
        <DeviceStatus
          data={data?.device ?? null}
          isLoading={isLoading}
          lanGateway={aboutDevice?.network.lan_gateway}
        />
      </motion.div>

      {/* Carrier Aggregation — full width because the proportional chain is the
          point, and a chain squeezed into a 3/5 column stops being readable at
          the narrow end. It replaces the old Secondary Carriers card, which
          showed a strict subset of these same values. */}
      <motion.div
        className="col-span-full"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <CarrierAggregationComponent
            carriers={carrierComponents}
            networkType={networkType}
            isLoading={isLoading}
            isStale={isStale}
            receivedAtMs={receivedAtMs}
          />
        </motion.div>
      </motion.div>

      <div className="col-span-full">
        <motion.div
          className="grid grid-cols-1 @3xl/main:grid-cols-2 @5xl/main:grid-cols-3 grid-flow-row gap-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem} className="h-full *:data-[slot=card]:h-full">
            <DeviceMetricsComponent
              deviceData={data?.device ?? null}
              lteData={data?.lte ?? null}
              nrData={data?.nr ?? null}
              isLoading={isLoading}
            />
          </motion.div>
          <motion.div variants={staggerItem} className="h-full *:data-[slot=card]:h-full">
            <LiveLatencyComponent
              connectivity={data?.connectivity ?? null}
              isLoading={isLoading}
            />
          </motion.div>
          <motion.div variants={staggerItem} className="h-full *:data-[slot=card]:h-full">
            <RecentActivitiesComponent />
          </motion.div>
        </motion.div>
      </div>

      {/* Signal History was the one dashboard card outside the entrance
          cascade — a bare div while every sibling rose into place — so it
          popped in fully formed against neighbours that were still arriving.
          The design mock gives it the cascade's last beat; this gives it the
          same rise and fade as its siblings.

          Deliberately NO extra delay to reproduce the mock's 240ms offset.
          That offset belongs to a single page-wide cascade, and this page runs
          several independent containers (the left column, the three-card row,
          and now this), each starting its own clock. Stacking a hardcoded
          delay on top of that would not recreate the mock's rhythm, it would
          just land the widest card late — which is the exact failure the
          60ms step is documented to avoid, a last card that reads as the page
          still loading rather than as choreography. */}
      <motion.div
        className="col-span-full"
        variants={staggerItem}
        initial="hidden"
        animate="visible"
      >
        <SignalHistoryComponent />
      </motion.div>
    </div>
  );
};

export default HomeComponent;
