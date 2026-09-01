"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Banner } from "@/components/ui/banner";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useAboutDevice } from "@/hooks/use-about-device";
import { BAND, PAGE_GRID } from "./shapes";
import { DashboardPageHeader } from "./page-header";
import { DashboardStatusRail } from "./status-rail";
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
    // ONE cascade owns the page.
    //
    // This was five independent containers — the hero column, Device
    // Information, Carrier Aggregation, the three-card row and Signal History —
    // each declaring its own initial/animate and so each starting its own clock
    // on mount. Five clocks that begin together are not one choreography; they
    // are five cards arriving at once in three different rhythms, and the
    // symptom was a full-width card popping in fully formed beside neighbours
    // that were still rising.
    //
    // Now: one container, five direct children, 120ms apart. The tail lands at
    // 4 x 120 = 480ms, well inside the poller's measured ~3.7-4.0s cycle, so the
    // entrance is finished long before the first data swap can compete with it.
    // Every nested container below keeps its `variants` and declares NO
    // initial/animate of its own — that is what keeps it on this clock.
    <motion.div
      className={PAGE_GRID}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      aria-live="polite"
      aria-atomic="false"
    >
      {error && !isLoading && (
        <Banner
          role="stale"
          title={t("alert.modem_unreachable")}
          className={BAND.FULL}
        />
      )}

      {/* Beat 1 — the page heading, and the Radio / Internet / Stale rail that
          now rides in its slot.

          The rail is built HERE rather than inside a card because the three
          chips answer "is the whole thing up?", which is a question about the
          route. Every input they need was already in this component — it hands
          the same four values down to the hero — so moving them up re-fetches
          nothing. */}
      <motion.div className={BAND.FULL} variants={staggerItem}>
        <DashboardPageHeader
          rail={
            <DashboardStatusRail
              data={data?.network ?? null}
              connectivity={data?.connectivity ?? null}
              modemReachable={data?.modem_reachable ?? false}
              isLoading={isLoading}
              isStale={isStale}
            />
          }
        />
      </motion.div>

      {/* Beat 2 — the hero band. A nested grid with the SAME five columns and
          gutter as the page grid, so folding the two columns into one cascade
          child changes the tree without changing a resolved column width. */}
      <motion.div className={BAND.TOP} variants={staggerContainer}>
        <motion.div className={BAND.HERO_COL} variants={staggerContainer}>
          <motion.div variants={staggerItem}>
            <NetworkStatusComponent
              data={data?.network ?? null}
              modemReachable={data?.modem_reachable ?? false}
              isLoading={isLoading}
            />
          </motion.div>

          <motion.div className={BAND.CARRIERS} variants={staggerContainer}>
            {/* LTE PCC — shown in LTE and NSA modes; spans the row when it is the
                only carrier card (LTE-only, i.e. no NR leg beside it). */}
            {networkType !== "5G-SA" && (
              <motion.div
                variants={staggerItem}
                className={cn(
                  BAND.STRETCH,
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
                  BAND.STRETCH,
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

        {/* Device Information heads the right column, on the same beat as the
            hero heading the left one. */}
        <motion.div className={BAND.SIDE_COL} variants={staggerItem}>
          <DeviceStatus
            data={data?.device ?? null}
            isLoading={isLoading}
            lanGateway={aboutDevice?.network.lan_gateway}
          />
        </motion.div>
      </motion.div>

      {/* Beat 3 — Carrier Aggregation, full width because the proportional
          chain is the point, and a chain squeezed into a 3/5 column stops being
          readable at the narrow end. */}
      <motion.div className={BAND.FULL} variants={staggerContainer}>
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

      {/* Beat 4 — the three cards that share one shell. */}
      <motion.div className={BAND.TRIO} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={BAND.STRETCH}>
          <DeviceMetricsComponent
            deviceData={data?.device ?? null}
            lteData={data?.lte ?? null}
            nrData={data?.nr ?? null}
            isLoading={isLoading}
          />
        </motion.div>
        <motion.div variants={staggerItem} className={BAND.STRETCH}>
          <LiveLatencyComponent
            connectivity={data?.connectivity ?? null}
            isLoading={isLoading}
          />
        </motion.div>
        <motion.div variants={staggerItem} className={BAND.STRETCH}>
          <RecentActivitiesComponent />
        </motion.div>
      </motion.div>

      {/* Beat 5 — Signal History gets the cascade's last beat, which is now an
          actual beat of one cascade rather than a fifth clock pretending to be
          one. No hardcoded offset: the 120ms step is the offset. */}
      <motion.div className={BAND.FULL} variants={staggerItem}>
        <SignalHistoryComponent />
      </motion.div>
    </motion.div>
  );
};

export default HomeComponent;
