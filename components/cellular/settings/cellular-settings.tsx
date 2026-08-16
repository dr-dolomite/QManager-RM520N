"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { TonalBanner } from "@/components/ui/tonal-banner";
import CellularPageHeader from "@/components/cellular/page-header";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useCellularSettings } from "@/hooks/use-cellular-settings";
import { useModemStatus } from "@/hooks/use-modem-status";

import CellularSettingsCard from "./cellular-settings-card";
import ModemHeroCard from "./modem-hero-card";
import PendingSaveBar from "./pending-save-bar";
import { CARD_CELL, PAGE_ROOT, PILL_ACTION, SAVE_BAR } from "./shapes";

// =============================================================================
// Cellular Basic Settings — the route shell
// =============================================================================
// Page header, one read-only hero, then a grid of write cards. The page
// arranges cards; it never becomes the canvas itself.
//
// PAGE ANATOMY (the band-locking shape, not the old two-column mix): the hero
// reports what the modem is doing RIGHT NOW (poller readout + carrier rate
// limits), and the two cards below change what it MAY do (SIM & Radio Power,
// Network Mode & Roaming). Read-only facts and writable settings are different
// kinds of object and no longer share a grid.
//
// TWO DATA SOURCES, DELIBERATELY SEPARATE. `useCellularSettings` owns the
// writable CGI surface (and the dirty/merge contract behind the save bar);
// `useModemStatus` owns the read-only poller snapshot. They refresh on
// different clocks and must not be collapsed into one — the settings hook
// re-reads only around a save, while the poller ticks continuously.
//
// ONE SAVE BAR FOR BOTH CARDS. The two settings cards share a single form
// state; the backend POST accepts any subset of fields in one request, so the
// save bar lives HERE, under the grid, rather than inside either card — a
// per-card bar would show the same "N changes pending" twice. The re-read
// footer owns the same slot when nothing is pending.
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
    isStale: statusStale,
    error: statusError,
  } = useModemStatus();

  const K = "core_settings.basic";

  // The save bar's "saved" flash. Owned here (not by either settings card)
  // because the bar is shared — see the header comment.
  const [saved, setSaved] = React.useState(false);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const failedLabels = (form.lastApply?.failedFields ?? []).map((key) =>
    t(`${K}.rows.${key}.label`),
  );

  const handleSave = async () => {
    const result = await form.saveSettings();
    if (result.success) {
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
    }
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
              className="h-8 rounded-pill px-3 text-xs font-semibold underline-offset-4"
            >
              {t(`${K}.page.retry`)}
            </Button>
          </span>
        </TonalBanner>
      ) : null}

      {/* The card cascade: hero, then the write cards, 120ms apart on the
          standard curve. The save bar and footer sit OUTSIDE the cascade —
          they arrive on state changes with their own (quicker) entrance, and
          a pending-changes action should never wait its turn. */}
      <motion.div
        className="flex flex-col gap-4"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <ModemHeroCard
            status={status}
            statusLoading={statusLoading}
            // Both hooks clear `isLoading` on failure and leave `data` at
            // `null`. Without the error threaded through, the hero's readiness
            // flags are false forever after a dead poller or a 500 and the card
            // shimmers indefinitely — including over the freshness chip, which
            // is the one thing on the page that would have said so.
            statusError={statusError}
            ambr={form.ambr}
            ambrLoading={form.isLoading}
            ambrError={form.error}
            networkType={status?.network.type ?? ""}
            isStale={statusStale}
            // The SAVED snapshot, never `draft` (The State-Honesty Rule). It is
            // also the better of the two sources for `cfun` / `sim_slot`: the
            // poller seeds both to `1` for its first ~60s and self-corrects,
            // while the settings GET at least re-reads on every request. Note
            // that `settings.sh` defaults the same two fields when its AT query
            // comes back empty and still returns `success:true`, so neither
            // source can currently express "not read" — see the hero's header
            // comment.
            saved={form.settings}
            // Same GET as `saved`, so both slot readouts run on one clock.
            // `null` on firmware that cannot report the slots at all — the hero
            // omits the row rather than inventing a placeholder for it.
            dualSlot={form.dualSlot}
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
            <CellularSettingsCard form={form} section="network" />
          </motion.div>
        </motion.div>

        {/* `SAVE_BAR` keys its side-by-side layout off `@2xl/card`, which is
            correct for the three call sites inside a card and matched NOTHING
            here — the shell's only container ancestor is `@container/main`, so
            the bar shipped as a left-aligned stacked column at every width
            including full desktop. `SAVE_BAR.HOST` gives it the container it is
            written against. */}
        <div className={SAVE_BAR.HOST}>
          <PendingSaveBar
            changeCount={form.changeCount}
            isSaving={form.isSaving}
            applyPhase={form.applyPhase}
            failedLabels={failedLabels}
            onDiscard={form.discard}
            onSave={handleSave}
            saved={saved}
            copy={{
              count: t(`${K}.save_bar.count`, { count: form.changeCount }),
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
        </div>

        {/* The resting footer. Only shown when nothing is pending — otherwise
            the save bar owns this slot and two status lines would contradict
            each other. */}
        {form.changeCount === 0 && !form.isSaving ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={form.refresh}
              className={PILL_ACTION}
            >
              <MaterialSymbol name="refresh" size={17} />
              {t(`${K}.footer.reread`)}
            </Button>
            <span className="text-on-surface-variant text-xs">
              {t(`${K}.footer.in_sync`)}
            </span>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
};

export default CellularSettingsComponent;
