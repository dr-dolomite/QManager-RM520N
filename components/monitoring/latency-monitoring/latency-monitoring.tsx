"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  AudioWaveformIcon,
  CrosshairIcon,
  GaugeIcon,
  PackageCheckIcon,
  PackageXIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { LATENCY_THRESHOLDS } from "@/types/modem-status";

import { RoundTripCard } from "./round-trip-card";
import { SamplesCard } from "./samples-card";
import { PAGE_ROOT } from "./shapes";
import {
  ConnectionChip,
  StatusBand,
  StatusBandSkeleton,
  TileMeta,
  type StatusTileProps,
} from "./status-band";
import { useLatencyMonitoring } from "./use-latency-monitoring";

const LatencyMonitoringComponent = () => {
  const { t } = useTranslation("dashboard");
  const {
    viewMode,
    setViewMode,
    connectivity,
    samples,
    total,
    tableSamples,
    intervalSec,
    isLoading,
    error,
    refresh,
  } = useLatencyMonitoring();

  const dash = t("latencyMonitor.unmeasured");
  const ms = t("latencyMonitor.unit_ms");

  const showMs = React.useCallback(
    (value: number | null) =>
      value === null ? dash : `${value.toLocaleString()} ${ms}`,
    [dash, ms],
  );

  const tiles = React.useMemo<StatusTileProps[]>(() => {
    if (!connectivity) return [];

    const history = connectivity.latency_history ?? [];
    const windowCount = history.length;
    const lostCount = history.filter((v) => v === null).length;

    const avg = connectivity.avg_latency_ms;
    // The "fair" cut is the last one that still reads as a usable link.
    const avgAlert = avg !== null && avg > LATENCY_THRESHOLDS.fair;

    const loss = connectivity.packet_loss_pct;
    const lossAlert = loss !== null && loss > 0;

    const hasSpread =
      connectivity.min_latency_ms !== null &&
      connectivity.max_latency_ms !== null;

    return [
      {
        icon: avgAlert ? TriangleAlertIcon : GaugeIcon,
        eyebrow: t("latencyMonitor.band.average_eyebrow"),
        value: showMs(avg),
        caption: hasSpread ? (
          <TileMeta
            parts={[
              t("latencyMonitor.band.average_min", {
                value: showMs(connectivity.min_latency_ms),
              }),
              t("latencyMonitor.band.average_max", {
                value: showMs(connectivity.max_latency_ms),
              }),
            ]}
          />
        ) : (
          t("latencyMonitor.band.average_unmeasured")
        ),
        alert: avgAlert,
      },
      {
        icon: AudioWaveformIcon,
        eyebrow: t("latencyMonitor.band.jitter_eyebrow"),
        value: showMs(connectivity.jitter_ms),
        caption:
          connectivity.jitter_ms === null
            ? t("latencyMonitor.band.jitter_unmeasured")
            : t("latencyMonitor.band.jitter_samples", { count: windowCount }),
      },
      {
        icon: lossAlert ? PackageXIcon : PackageCheckIcon,
        eyebrow: t("latencyMonitor.band.loss_eyebrow"),
        value:
          loss === null
            ? dash
            : `${loss.toLocaleString()}${t("latencyMonitor.unit_pct")}`,
        caption:
          loss === null
            ? t("latencyMonitor.band.loss_unmeasured")
            : t("latencyMonitor.band.loss_counted", {
                lost: lostCount,
                total: windowCount,
              }),
        alert: lossAlert,
      },
      {
        icon: CrosshairIcon,
        eyebrow: t("latencyMonitor.band.target_eyebrow"),
        value: connectivity.ping_target || dash,
        caption: connectivity.last_family ? (
          <TileMeta
            mono
            parts={[connectivity.last_family, connectivity.profile]}
          />
        ) : (
          t("latencyMonitor.band.target_unknown")
        ),
      },
    ];
  }, [connectivity, dash, showMs, t]);

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={t("latencyMonitor.page.title")}
          description={t("latencyMonitor.page.description")}
          actions={<ConnectionChip status={connectivity?.status ?? null} />}
        />
      </motion.div>

      {/* The band reports the live probe window, so it may only appear once a
          snapshot has landed — an empty payload is not an all-clear. */}
      <motion.div variants={staggerItem}>
        {connectivity ? (
          <StatusBand tiles={tiles} />
        ) : error !== null ? null : (
          <StatusBandSkeleton />
        )}
      </motion.div>

      <motion.div variants={staggerItem}>
        <RoundTripCard
          viewMode={viewMode}
          setViewMode={setViewMode}
          samples={samples}
          intervalSec={intervalSec}
          isLoading={isLoading}
          error={error}
          onRetry={refresh}
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <SamplesCard
          viewMode={viewMode}
          rows={tableSamples}
          total={total}
          isLoading={isLoading}
          error={error}
          onRetry={refresh}
        />
      </motion.div>
    </motion.div>
  );
};

export default LatencyMonitoringComponent;
