"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { staggerContainer, staggerItem } from "@/lib/motion";
import ATTerminalCard from "@/components/system-settings/at-terminal/at-terminal-card";

import { PAGE_HEAD, PAGE_ROOT } from "./shapes";

const K = "at_terminal";

const ATTerminal = (): React.JSX.Element => {
  const { t } = useTranslation("system-settings");

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
        <ATTerminalCard />
      </motion.div>
    </motion.div>
  );
};

export default ATTerminal;
