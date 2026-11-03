"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { useBackupSupport } from "@/hooks/use-config-backup";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CARD_CELL, CARD_GRID, PAGE_HEAD, PAGE_ROOT } from "../shapes";
import ConfigBackupCard from "./config-backup-card";
import RestoreConfigBackupCard from "./restore-backup-card";

const K = "config_backup";

const ConfigurationBackup = () => {
  const { t } = useTranslation("system-settings");
  // Lifted: both cards read which sections this build supports, from one GET.
  const support = useBackupSupport();

  return (
    <motion.div className={PAGE_ROOT} variants={staggerContainer} initial="hidden" animate="visible">
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page_title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page_description`)}</p>
          </div>
        </div>
      </motion.div>

      <div className={CARD_GRID}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <ConfigBackupCard support={support} />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <RestoreConfigBackupCard support={support} />
        </motion.div>
      </div>
    </motion.div>
  );
};

export default ConfigurationBackup;
