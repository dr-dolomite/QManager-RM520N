"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { resolveCuts } from "./derive";
import { HistoryCard } from "./history-card";
import { NowCard } from "./now-card";
import { PAGE_ROOT, PAIR } from "./shapes";
import { SitesCard } from "./sites-card";
import { useLatencyMonitoring } from "./use-latency-monitoring";

const LatencyMonitoringComponent = () => {
  const { t } = useTranslation("dashboard");
  const {
    connectivity,
    unreachable,
    refreshStatus,
    history,
    historyLoading,
    historyError,
    refreshHistory,
  } = useLatencyMonitoring();

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
        />
      </motion.div>

      <motion.div variants={staggerItem} className={PAIR}>
        <NowCard
          connectivity={connectivity}
          history={history}
          unreachable={unreachable}
          onRetry={refreshStatus}
        />
        <HistoryCard
          connectivity={connectivity}
          history={history}
          isLoading={historyLoading}
          error={historyError}
          onRetry={refreshHistory}
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <SitesCard
          cuts={resolveCuts(connectivity)}
          linkDown={!unreachable && connectivity?.status === "disconnected"}
        />
      </motion.div>
    </motion.div>
  );
};

export default LatencyMonitoringComponent;
