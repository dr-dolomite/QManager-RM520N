"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { usePingProfile } from "@/hooks/use-ping-profile";
import { useQualityThresholds } from "@/hooks/use-quality-thresholds";
import { staggerContainer, staggerItem } from "@/lib/motion";

import ProbeTargetsCard from "./probe-targets-card";
import QualityThresholdsCard from "./quality-thresholds-card";
import { StatusBand } from "./status-band";
import { CARD_CELL, CARD_GRID, PAGE_HEAD, PAGE_ROOT } from "./shapes";

const K = "connection_quality";

export function ConnectionQualitySettings(): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  // The shell owns both GETs: the band reads the SAVED targets and presets to
  // tone its discs, and each card owns the half it writes.
  const profile = usePingProfile();
  const quality = useQualityThresholds();

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* The cascade root declares initial/animate once. Every child below is a
          staggerItem and must NOT declare its own, or it detaches from the clock. */}
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <StatusBand targets={profile.targets} thresholds={quality.thresholds} />
      </motion.div>

      {/* A nested container: it inherits `visible` from the root and gives each
          card its own 120ms step. It must not declare initial/animate. */}
      <motion.div className={CARD_GRID} variants={staggerContainer}>
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
