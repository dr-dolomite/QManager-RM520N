"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";

import FullScanner from "./scanner";
import { PAGE_SHELL } from "./shapes";

// =============================================================================
// Cell Scanner — page shell
// =============================================================================
// Reads top to bottom as one argument: what this page is, then the run and what
// it costs, then what the run found.
//
// The header goes through `CellularPageHeader` rather than a hand-rolled `<h1
// className="text-3xl font-bold mb-2">` — that string appears in 26 files and is
// missing the `tracking-[-0.02em]` the Display step actually specifies, so every
// one of those pages renders its title fractionally wider than the migrated
// surfaces. See the component's own header for why a shared component beats a
// shared class string here.
// =============================================================================

export function CellScannerComponent() {
  const { t } = useTranslation("cellular");

  return (
    <motion.div
      className={PAGE_SHELL}
      variants={staggerContainer}
      initial="hidden"
      // "visible", NOT "show". `staggerContainer`/`staggerItem` name their
      // settled state `visible`; a name matching no variant is not an error in
      // Motion, it simply has nothing to animate to, so every child stays pinned
      // at `opacity: 0` and the page renders a complete, correct, INVISIBLE DOM
      // that passes tsc, build, eslint and every checker. The only detector is
      // looking at it.
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <CellularPageHeader
          title={t("cell_scanner.page.title")}
          description={t("cell_scanner.page.description")}
        />
      </motion.div>

      {/* Renders the hero and the results card as two more cascade items. A
          plain component in between does not break variant propagation — the
          two `staggerItem` children inside it are still this container's
          children as far as Motion's tree walk is concerned. */}
      <FullScanner />
    </motion.div>
  );
}

export default CellScannerComponent;
