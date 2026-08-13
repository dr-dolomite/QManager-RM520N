"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import CellularPageHeader from "@/components/cellular/page-header";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { useImeiSettings } from "@/hooks/use-imei-settings";

import { CARD_CELL, PAGE_GRID, PAGE_ROOT } from "../shapes";
import BackupIMEICard from "./backup-imei-card";
import IMEISettingsCard from "./imei-settings-card";
import IMEIToolsCard from "./imei-tools-card";

// =============================================================================
// IMEI Settings — the route shell
// =============================================================================
// Page header, then the page's standing conditions as banners, then the card
// grid. The page arranges; it never becomes the canvas itself.
//
// -----------------------------------------------------------------------------
// THE LEGAL WARNING IS A BANNER, NOT A TOOLTIP
// -----------------------------------------------------------------------------
// It used to be a 16px `warning` glyph in an input addon, whose tooltip has to
// be hovered to be read — duplicated in two cards, with a THIRD, differently
// worded copy in the loading skeleton, so the sentence visibly changed as the
// skeleton resolved. A notice that a user must discover is not a notice. One
// banner, one wording, always visible, above everything it governs.
//
// -----------------------------------------------------------------------------
// THE DEFERRED REBOOT
// -----------------------------------------------------------------------------
// Writing an IMEI does nothing until the modem restarts. The incumbent dialog
// offered "Reboot Now" / "Reboot Later" and then DROPPED the choice: picking
// Later recorded nothing, so the user got no reminder, no second chance, and a
// modem still answering on its old identity with no indication why.
//
// The pending state is now persisted under `qm_imei_reboot_pending` in
// sessionStorage — the same store the product-wide reboot handoff already uses
// (`qm_rebooting`) — so it survives a route change and a return to this page,
// and dies with the tab, which is the right lifetime for "you have not restarted
// yet". It is deliberately NOT a global reboot-state system: exactly one surface
// writes this key and exactly one reads it.
//
// While it is set, the page carries the `deferred-reboot` Banner — the one role
// in `components/ui/banner.tsx` permitted two CTAs (a tonal "Review" and a
// destructive "Reboot"), and until now the only role in the set with no call
// sites at all.
//
// NEVER reboot inline in a request path. The app is served BY the modem, so an
// in-flight reboot kills its own HTTP response; the reboot always sits behind a
// dialog or this banner, and the actual restart is a handoff to /reboot/.
// =============================================================================

/** sessionStorage key holding "an IMEI was written, the modem has not restarted". */
export const IMEI_REBOOT_PENDING_KEY = "qm_imei_reboot_pending";

/** Anchor for the banner's "Review" action. */
const DEVICE_CARD_ID = "imei-device-card";

const IMEISettings = () => {
  const { t } = useTranslation("cellular");
  const {
    currentImei,
    backupEnabled,
    backupImei,
    isLoading,
    isSaving,
    error,
    saveImei,
    saveBackup,
    rebootDevice,
    refresh,
  } = useImeiSettings();

  const K = "core_settings.imei";

  // Read in an effect, not in a `useState` initialiser: this route is a static
  // export, so the initialiser also runs where `sessionStorage` does not exist,
  // and a value read during render would hydrate mismatched anyway.
  const [rebootPending, setRebootPending] = React.useState(false);
  React.useEffect(() => {
    setRebootPending(
      window.sessionStorage.getItem(IMEI_REBOOT_PENDING_KEY) === "1",
    );
  }, []);

  const markRebootPending = React.useCallback(() => {
    window.sessionStorage.setItem(IMEI_REBOOT_PENDING_KEY, "1");
    setRebootPending(true);
  }, []);

  const handleReboot = React.useCallback(() => {
    // Clear the marker BEFORE handing off. sessionStorage survives the reload
    // that lands on /login/ after the modem comes back, so leaving it set would
    // resurrect the banner for a reboot that already happened.
    window.sessionStorage.removeItem(IMEI_REBOOT_PENDING_KEY);
    rebootDevice();
  }, [rebootDevice]);

  const handleReview = React.useCallback(() => {
    const card = document.getElementById(DEVICE_CARD_ID);
    if (!card) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      {rebootPending ? (
        <Banner
          role="deferred-reboot"
          title={t(`${K}.reboot.banner.title`)}
          description={t(`${K}.reboot.banner.description`)}
          action={
            <>
              <button
                type="button"
                onClick={handleReview}
                className={bannerActionVariants({ tone: "on-warning" })}
              >
                {t(`${K}.reboot.banner.review`)}
              </button>
              <button
                type="button"
                onClick={handleReboot}
                className={bannerActionVariants({ tone: "destructive" })}
              >
                {t(`${K}.reboot.banner.reboot`)}
              </button>
            </>
          }
        />
      ) : null}

      <Banner
        role="degraded"
        title={t(`${K}.legal.title`)}
        description={t(`${K}.legal.body`)}
      />

      {error && !isLoading ? (
        <Banner
          role="stale"
          title={t(`${K}.page.error_title`)}
          description={t(`${K}.page.error_body`, { detail: error })}
          action={
            <button
              type="button"
              onClick={() => refresh()}
              className={bannerActionVariants({ tone: "destructive" })}
            >
              {t("common:actions.retry")}
            </button>
          }
        />
      ) : null}

      <div className={PAGE_GRID}>
        {/* Left column: the two write surfaces, stacked. */}
        <div className="flex h-full flex-col gap-4">
          <IMEISettingsCard
            anchorId={DEVICE_CARD_ID}
            currentImei={currentImei}
            isLoading={isLoading}
            isSaving={isSaving}
            onSave={saveImei}
            onRebootNow={handleReboot}
            onRebootDeferred={markRebootPending}
          />
          <BackupIMEICard
            backupEnabled={backupEnabled}
            backupImei={backupImei}
            isLoading={isLoading}
            isSaving={isSaving}
            onSave={saveBackup}
          />
        </div>

        {/* Right column: the read-only workbench. Nothing here touches NVM. */}
        <div className={CARD_CELL}>
          <IMEIToolsCard />
        </div>
      </div>
    </div>
  );
};

export default IMEISettings;
