"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import AdaptivePollingCard from "@/components/system-settings/adaptive-polling/adaptive-polling-card";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CARD_CELL, PAGE_HEAD, PAGE_ROOT } from "../shapes";

const K = "adaptive_polling";

// One full-width card: it has no row-mate, so its rows recompose on a wide card instead.
const AdaptivePollingSettings = () => {
  const { t } = useTranslation("system-settings");
  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page_title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page_description`)}</p>
          </div>
        </div>
      </motion.div>
      <motion.div variants={staggerItem} className={CARD_CELL}>
        <AdaptivePollingCard />
      </motion.div>
    </motion.div>
  );
};

export default AdaptivePollingSettings;
