"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import CellularPageHeader from "@/components/cellular/page-header";
import { MaterialSymbol } from "@/components/ui/material-symbol";

import { PAGE_ROOT } from "../shapes";
import FPLMNCard from "./fplmn-card";

// =============================================================================
// Blocked Networks — the route shell
// =============================================================================
// Page header, one card, one note. SINGLE COLUMN: the incumbent shell put this
// lone card in a two-column grid, so it rendered half-width with a column of
// dead space beside it. A grid is for a set of cards; this surface has one.
//
// The header is `CellularPageHeader` rather than a hand-written `h1` + `p`
// carrying `PAGE_TITLE` / `PAGE_DESCRIPTION`. It renders the identical Display
// triple (`text-3xl font-bold tracking-[-0.02em]`) over an
// `on-surface-variant` description — which is exactly the gap being closed
// here — and it is what the sibling `/cellular/settings/` routes already ship,
// so this page cannot drift away from them later. A class you have to remember
// to type is a class that will eventually be typed wrong.
//
// THE NOTE IS NEUTRAL, NOT A BANNER. `TonalBanner`'s informational tone is
// `primary-container`, which is the exact fill the card's clean state uses —
// two primary blocks stacked would read as one continuous condition. This is a
// standing footnote about how the feature works, not a condition that arose, so
// it sits on the neutral container step and takes the same disc pair
// `ConditionScreen` gives its own neutral tone.
// =============================================================================

const K = "core_settings.fplmn";

export function FPLMNSettingsComponent() {
  const { t } = useTranslation("cellular");

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      <div className="flex flex-col gap-3">
        <FPLMNCard />

        <div className="flex items-start gap-3 rounded-tile bg-surface-container px-4 py-3.5">
          <span
            aria-hidden="true"
            className="bg-surface-container-high text-on-surface-variant grid size-8 flex-none place-items-center rounded-pill"
          >
            <MaterialSymbol name="info" filled size={18} />
          </span>
          <p className="text-on-surface-variant min-w-0 text-[0.8125rem] leading-relaxed text-pretty">
            {t(`${K}.page.note`)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default FPLMNSettingsComponent;
