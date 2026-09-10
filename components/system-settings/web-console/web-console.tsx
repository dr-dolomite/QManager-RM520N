"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";

import { DUR, EASE_STANDARD, staggerContainer, staggerItem } from "@/lib/motion";

import { CONSOLE, PAGE_HEAD, PAGE_ROOT } from "./shapes";
import { WebConsoleCard } from "./web-console-card";

const K = "web_console";

/**
 * Opacity only. A transform on this element would make it the containing block
 * for the full-screen console, which is positioned fixed.
 */
const CARD_ENTER: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DUR.standard, ease: EASE_STANDARD },
  },
};

export function WebConsole(): React.JSX.Element {
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
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
          </div>
        </div>
      </motion.div>

      <motion.div variants={CARD_ENTER} className={CONSOLE.SLOT}>
        <WebConsoleCard />
      </motion.div>
    </motion.div>
  );
}

export default WebConsole;
