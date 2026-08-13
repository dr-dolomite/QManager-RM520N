"use client";

import { useTranslation } from "react-i18next";

import CellularPageHeader from "@/components/cellular/page-header";

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

      <NetworkPriorityCard />
    </div>
  );
};

export default NetworkPrioritySettings;
