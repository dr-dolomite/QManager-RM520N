"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PAGE_TITLE, PAGE_DESCRIPTION } from "../shapes";
import ConnectionScenariosCard from "./connection-scenario-card";

// =============================================================================
// Connection Scenarios — page shell
// =============================================================================
// Rebuilt on the SMS Center / Radio Information cascade: one root motion.div
// owns the clock (staggerContainer), and every direct section is a
// motion.div carrying ONLY `variants={staggerItem}` — never its own
// initial/animate, or it detaches from the parent's timing. The card itself
// stays a plain component; its own internal cascades (the tile grid) inherit
// this root's "visible" state by propagation rather than declaring a second
// clock.
// =============================================================================

const ConnectionScenariosComponent = () => {
  const { t } = useTranslation("cellular");

  // Deep-link support: ?action=create opens the "New Scenario" dialog on
  // mount. Set by the SIM Profile form's "Create new custom scenario…" path
  // — see custom-profile-form.tsx.
  const searchParams = useSearchParams();
  const autoOpenAdd = searchParams.get("action") === "create";

  return (
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className="flex max-w-[41rem] flex-col gap-1.5">
          <h1 className={PAGE_TITLE}>{t("scenarios.page.title")}</h1>
          <p className={cn(PAGE_DESCRIPTION, "text-sm leading-relaxed text-pretty")}>
            {t("scenarios.page.description")}
          </p>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <ConnectionScenariosCard autoOpenAddDialog={autoOpenAdd} />
      </motion.div>
    </motion.div>
  );
};

export default ConnectionScenariosComponent;
