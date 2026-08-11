"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { PAGE_SHELL } from "../shapes";
import FrequencyCalculator from "./calculator";

// =============================================================================
// Frequency Calculator — page shell
// =============================================================================
// The same shell as the two scanning routes, so all three addresses under
// `/cellular/cell-scanner/` open the same way. The header goes through
// `CellularPageHeader` rather than the hand-rolled `<h1 className="text-3xl
// font-bold mb-2">` this file used to carry: that string appears in 26 files and
// is missing the `tracking-[-0.02em]` the Display step specifies, so every one of
// them renders its title fractionally wider than the migrated surfaces.
//
// WHAT THIS PAGE DELIBERATELY DOES NOT HAVE. No run hero, no posture chip, no
// cost statement. Those exist on the scanning routes because a scan is a RUN with
// a price — it holds the modem's single AT channel and pauses everything else.
// This page never touches the modem at all: it is arithmetic over the band tables
// in `lib/earfcn.ts`, running entirely in the browser. Giving it the run
// vocabulary would advertise a cost it does not have.
// =============================================================================

export function FrequencyCalculatorComponent() {
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
          title={t("cell_scanner.calculator.page.title")}
          description={t("cell_scanner.calculator.page.description")}
        />
      </motion.div>

      <FrequencyCalculator />
    </motion.div>
  );
}

export default FrequencyCalculatorComponent;
