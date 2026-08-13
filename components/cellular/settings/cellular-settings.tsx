"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { TonalBanner } from "@/components/ui/tonal-banner";
import CellularPageHeader from "@/components/cellular/page-header";
import { useCellularSettings } from "@/hooks/use-cellular-settings";
import { useModemStatus } from "@/hooks/use-modem-status";
import { cn } from "@/lib/utils";

import CellularAMBRCard from "./cellular-ambr";
import CellularSettingsCard from "./cellular-settings-card";
import ModemReportsCard from "./modem-reports-card";
import { CARD_CELL, PAGE_GRID, PAGE_ROOT } from "./shapes";

// =============================================================================
// Cellular Basic Settings — the route shell
// =============================================================================
// Page header, then a uniform grid of self-contained cards. The page arranges
// cards; it never becomes the canvas itself.
//
// TWO DATA SOURCES, DELIBERATELY SEPARATE. `useCellularSettings` owns the
// writable CGI surface (and the dirty/merge contract behind the save bar);
// `useModemStatus` owns the read-only poller snapshot. They refresh on
// different clocks and must not be collapsed into one — the settings hook
// re-reads only around a save, while the poller ticks continuously.
//
// ON THE ERROR BANNER. The incumbent markup was a hand-rolled
// `div[role=alert]` filled with `bg-destructive/10` — an alpha wash, which
// DESIGN.md calls out directly ("Don't compensate for a mismatched pair with an
// alpha; fix the pair"). It is now the shared `TonalBanner` on the real
// container pair.
//
// THE RETRY BUTTON USED TO DESTROY WORK. `refresh` re-reads the server, and
// under the old contract that overwrote every local field — so a user with
// three staged edits who tapped Retry lost all three, silently. The hook's
// merge rule now guarantees a refresh can only update fields the user has NOT
// touched, which is what makes it safe to leave this button next to a save bar.
// =============================================================================

const CellularSettingsComponent = () => {
  const { t } = useTranslation("cellular");
  const form = useCellularSettings();
  const {
    data: status,
    isLoading: statusLoading,
  } = useModemStatus();

  const K = "core_settings.basic";

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      {form.error && !form.isLoading ? (
        <TonalBanner
          tone="destructive"
          icon="error"
          title={t(`${K}.page.error_title`)}
        >
          <span className="flex flex-wrap items-center gap-2">
            {t(`${K}.page.error_body`)}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={form.refresh}
              className="h-8 rounded-pill px-3 text-xs font-semibold underline-offset-4"
            >
              {t(`${K}.page.retry`)}
            </Button>
          </span>
        </TonalBanner>
      ) : null}

      <div className={PAGE_GRID}>
        <div className={CARD_CELL}>
          <CellularSettingsCard form={form} />
        </div>

        {/* The right column matches the settings card's height (grid's
            default row stretch, carried down by `CARD_CELL`). AMBR keeps its
            own content height; the reports card is the one that GROWS to
            take up the remainder, so a taller settings card never leaves a
            gap of dead space at the bottom of this column. */}
        <div className="flex h-full flex-col gap-4">
          <CellularAMBRCard
            ambr={form.ambr}
            isLoading={form.isLoading}
            networkType={status?.network.type ?? ""}
          />
          <div className={cn("flex-1", CARD_CELL)}>
            <ModemReportsCard status={status} isLoading={statusLoading} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CellularSettingsComponent;
