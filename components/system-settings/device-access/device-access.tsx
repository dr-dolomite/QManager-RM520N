"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import PasswordCard from "@/components/system-settings/password-card";
import WebPortCard from "@/components/system-settings/web-port/web-port-card";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CARD_CELL, CARD_GRID, PAGE_HEAD, PAGE_ROOT } from "../shapes";

const K = "device_access.page";

// Two columns on desktop, one on a phone: Passwords, then Web Port.
const DeviceAccessSettings = () => {
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
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.description`)}</p>
          </div>
        </div>
      </motion.div>

      {/* A nested container: it inherits `visible` from the root and must not
          declare initial/animate. */}
      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <PasswordCard />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <WebPortCard />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default DeviceAccessSettings;
