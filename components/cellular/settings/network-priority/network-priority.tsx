"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import CellularPageHeader from "@/components/cellular/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";

import NetworkPriorityCard from "./network-priority-card";
import { PAGE_ROOT } from "../shapes";

// =============================================================================
// Network Priority — the route shell
// =============================================================================
// Page header, then the card. SINGLE COLUMN, deliberately: the page this
// replaces rendered one card inside a `@3xl/main:grid-cols-2` grid, so on any
// display wider than the breakpoint exactly half the page was empty. A grid is
// how you arrange cards; with one card there is nothing to arrange.
//
// The header goes through `CellularPageHeader` rather than a hand-rolled `<h1
// className="text-3xl font-bold">` — same reasoning as the sibling settings
// routes, and it is what carries the Display step's `tracking-[-0.02em]`.
//
// THE CARD ARRIVES. It used to hard-appear: this route rendered its card as a
// bare child while `/cellular/settings` next door cascades its own cards
// through `staggerContainer`/`staggerItem`, so crossing between two pages of
// one family switched the entrance off. A single-card page still takes the
// cascade — `staggerContainer` with one child is a 10px rise on the standard
// curve, which is the entrance, not a choreography that needs a crowd.
// =============================================================================

const NetworkPrioritySettings = () => {
  const { t } = useTranslation("cellular");
  const K = "core_settings.network_priority";

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      <motion.div
        className="flex flex-col gap-4"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <NetworkPriorityCard />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default NetworkPrioritySettings;
