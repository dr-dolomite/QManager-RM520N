"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MonitoringPageHeader } from "@/components/monitoring/page-header";
import { usePingProfile } from "@/hooks/use-ping-profile";
import { useQualityThresholds } from "@/hooks/use-quality-thresholds";
import { staggerContainer, staggerItem } from "@/lib/motion";

import ProbeTargetsCard from "./probe-targets-card";
import QualityThresholdsCard from "./quality-thresholds-card";
import { CARD_CELL, PAIR, PAGE_ROOT } from "./shapes";

const K = "connection_quality";

export function ConnectionQualitySettings(): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const profile = usePingProfile();
  const quality = useQualityThresholds();

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* The cascade root declares initial/animate once; children only take variants. */}
      <motion.div variants={staggerItem}>
        <MonitoringPageHeader
          title={t(`${K}.page.title`)}
          description={t(`${K}.page.description`)}
        />
      </motion.div>

      <motion.div className={PAIR} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <ProbeTargetsCard profile={profile} />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <QualityThresholdsCard quality={quality} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

export default ConnectionQualitySettings;
