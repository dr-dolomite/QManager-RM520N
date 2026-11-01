"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSaveFlash } from "@/components/ui/save-button";
import { TonalBanner } from "@/components/ui/tonal-banner";
import CellularPageHeader from "@/components/cellular/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useCellularSettings } from "@/hooks/use-cellular-settings";
import { STATUS_POLL_SLOW_MS, useModemStatus } from "@/hooks/use-modem-status";

import CellularSettingsCard from "./cellular-settings-card";
import LiveStateStrip from "./live-state-strip";
import ApplyFoot from "./apply-foot";
import RefreshButton from "./refresh-button";
import RateCeilingDisclosure from "./rate-ceiling-disclosure";
import { CARD_CELL, PAGE_ROOT } from "./shapes";

// =============================================================================
// Cellular Basic Settings — the route shell
// =============================================================================
// Page header, two read-only bands, then a grid of write cards. The page
// arranges bands; it never becomes the canvas itself.
//
// PAGE ANATOMY. Band A is the LIVE STATE STRIP — four `TILE_SHAPE` tiles under
// the header, the family shape `/cellular/` and Radio Information already use.
// Band A2 is the RATE CEILING, a summary line with the per-bearer detail behind
// a disclosure. Then the two write cards change what the modem MAY do (SIM &
// Radio Power, Network Mode & Roaming). Read-only facts and writable settings
// are different kinds of object and do not share a grid.
//
// THERE IS NO HERO CARD ON THIS SURFACE, and the band split is the reason. The
// 826-line `ModemHeroCard` this replaces led with AMBR — the network-granted
// rate ceiling, the most specialist number on the page, not settable anywhere on
// it — across two of its three columns, and rendered eighteen distinct facts in
// one box.
//
// TWO DATA SOURCES, DELIBERATELY SEPARATE, AND NOW ONE PER BAND.
// `useCellularSettings` owns the writable CGI surface (and the dirty/merge
// contract behind the apply footer); `useModemStatus` owns the read-only poller
// snapshot. They refresh on different clocks and must not be collapsed into one
// — the settings hook re-reads only around a save, while the poller ticks
// continuously. The hero mixed them and needed two readiness flags, two failure
// branches, a freshness chip scoped to one of its three bands, and a footnote
// whose JSDoc admitted the card had "TWO CLOCKS and one of them does not tick".
// Band A is poller-only and its freshness chip is therefore honest about all of
// it; band A2 is settings-only and carries its own provenance sentence. No
// surface on this page holds two clocks, and that footnote is deleted.
//
// ONE APPLY FOR BOTH CARDS. The backend POST takes any subset of fields, so one
// footer commits both; it sits on the Network card, last in reading order.
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
// touched, which is what makes it safe to leave this button next to Save.
// =============================================================================

const CellularSettingsComponent = () => {
  const { t } = useTranslation("cellular");
  const form = useCellularSettings();
  const {
    data: status,
    isLoading: statusLoading,
    isStale: statusStale,
    error: statusError,
  } = useModemStatus({ pollInterval: STATUS_POLL_SLOW_MS });

  const K = "core_settings.basic";

  // The shared footer's Save flash; owned here because the footer spans both cards.
  const { saved, markSaved } = useSaveFlash();

  const failedLabels = (form.lastApply?.failedFields ?? []).map((key) =>
    t(`${K}.rows.${key}.label`),
  );

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSave = async () => {
    const result = await form.saveSettings();
    // The hook reports "unmounted" as a failure; the write may have landed.
    if (!mountedRef.current) return;
    if (result.success) {
      // A no-op save succeeds with nothing applied, so it confirms nothing.
      if (result.appliedFields.length > 0) {
        markSaved();
        toast.success(t(`${K}.toast.saved`));
      }
      return;
    }
    // One error toast, never a success then an error. `result.error` is a raw
    // backend code, so the description names the fields that failed instead.
    toast.error(t(`${K}.toast.save_failed`), {
      description:
        result.failedFields.length > 0
          ? result.failedFields.map((key) => t(`${K}.rows.${key}.label`)).join(", ")
          : undefined,
    });
  };

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
              className="h-8 px-3 text-xs font-semibold underline-offset-4"
            >
              {t(`${K}.page.retry`)}
            </Button>
          </span>
        </TonalBanner>
      ) : null}

      {/* The card cascade: the bands, then the write cards, 120ms apart on
          the standard curve. */}
      <motion.div
        className="flex flex-col gap-4"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        {/* Band A: the live state, on the POLLER clock only. */}
        <motion.div variants={staggerItem}>
          <LiveStateStrip
            status={status}
            statusLoading={statusLoading}
            // Both hooks clear `isLoading` on failure and leave `data` at
            // `null`. Without the error threaded through, the readiness flag is
            // false forever after a dead poller and the strip shimmers
            // indefinitely — including over the freshness chip, which is the one
            // thing on the page that would have said so.
            statusError={statusError}
            isStale={statusStale}
            // From the SETTINGS GET, and the only fact in the strip that is not
            // poller-fed. Which card sits in the other slot is a hardware fact,
            // not a reading that goes stale between polls. `null` on firmware
            // that cannot report the slots at all — the tile omits the caption
            // rather than inventing a placeholder for it.
            dualSlot={form.dualSlot}
          />
        </motion.div>

        {/* Band A2: the rate ceiling, on the SETTINGS clock only, with its own
            provenance line. Two bands rather than one card because the hero
            these replace held both clocks and needed a footnote to apologise
            for it. */}
        <motion.div variants={staggerItem}>
          <RateCeilingDisclosure
            ambr={form.ambr}
            ambrLoading={form.isLoading}
            ambrError={form.error}
            networkType={status?.network.type ?? ""}
          />
        </motion.div>

        {/* Nested cascade container: it inherits `visible` from its parent and
            must NOT declare its own initial/animate, or it detaches from the
            parent's clock. `CARD_CELL` on each cell keeps the two cards equal
            height — a row whose consequence wraps to two lines in one locale
            must not leave its peer visibly shorter. */}
        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2"
          variants={staggerContainer}
        >
          <motion.div variants={staggerItem} className={CARD_CELL}>
            <CellularSettingsCard form={form} section="sim" />
          </motion.div>
          <motion.div variants={staggerItem} className={CARD_CELL}>
            <CellularSettingsCard
              form={form}
              section="network"
              foot={
                <ApplyFoot
                  changeCount={form.changeCount}
                  isSaving={form.isSaving}
                  applyPhase={form.applyPhase}
                  failedLabels={failedLabels}
                  onDiscard={form.discard}
                  onSave={handleSave}
                  saved={saved}
                  leading={
                    <RefreshButton
                      onClick={form.refresh}
                      disabled={form.isSaving}
                    />
                  }
                  copy={{
                    note: t(`${K}.save_bar.note`),
                    discard: t(`${K}.save_bar.discard`),
                    save: t(`${K}.save_bar.save`),
                    failed: t(`${K}.save_bar.failed`, {
                      fields: failedLabels.join(", "),
                    }),
                    steps: {
                      writing: t(`${K}.apply.writing`),
                      recovering: t(`${K}.apply.recovering`),
                      verifying: t(`${K}.apply.verifying`),
                    },
                  }}
                />
              }
            />
          </motion.div>
        </motion.div>

      </motion.div>
    </div>
  );
};

export default CellularSettingsComponent;
