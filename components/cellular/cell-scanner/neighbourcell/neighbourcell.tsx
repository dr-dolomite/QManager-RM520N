"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { PAGE_SHELL } from "../shapes";
import NeighbourScanner from "./neighbour-scanner";

// =============================================================================
// Neighbour Cells — page shell
// =============================================================================
// Structurally identical to the full-scan route's shell, and that is the point:
// the two surfaces are one feature at two addresses, so learning one teaches the
// other. Only the copy and the cost differ.
//
// The header goes through `CellularPageHeader` rather than the hand-rolled `<h1
// className="text-3xl font-bold mb-2">` this file used to carry — that string
// appears in 26 files and is missing the `tracking-[-0.02em]` the Display step
// specifies, so every one of them renders its title fractionally wider than the
// migrated surfaces.
// =============================================================================

export function NeighbourcellComponent() {
  const { t } = useTranslation("cellular");

  return (
    <motion.div
      className={PAGE_SHELL}
      variants={staggerContainer}
      initial="hidden"
      // "visible", NOT "show" — a name matching no variant is not an error in
      // Motion. It simply has nothing to animate to, so every child stays pinned
      // at `opacity: 0` and the page renders a complete, correct, INVISIBLE DOM
      // that passes tsc, build, eslint and every checker.
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <CellularPageHeader
          title={t("cell_scanner.neighbour.page.title")}
          description={t("cell_scanner.neighbour.page.description")}
        />
      </motion.div>

      <NeighbourScanner />
    </motion.div>
  );
}

export default NeighbourcellComponent;
