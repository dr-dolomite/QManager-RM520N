"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import CellularPageHeader from "@/components/cellular/page-header";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { useImeiSettings } from "@/hooks/use-imei-settings";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { CARD_CELL, PAGE_ROOT, WORKBENCH_SPLIT } from "../shapes";
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
// THE LEGAL WARNING IS A BANNER, NOT A TOOLTIP — BUT IT IS A NOTE, NOT AN ALARM
// -----------------------------------------------------------------------------
// It used to be a 16px `warning` glyph in an input addon, whose tooltip has to
// be hovered to be read — duplicated in two cards, with a THIRD, differently
// worded copy in the loading skeleton, so the sentence visibly changed as the
// skeleton resolved. A notice that a user must discover is not a notice. One
// banner, one wording, always visible, above everything it governs. That part
// stands.
//
// WHAT CHANGED IS ITS ROLE. It shipped as `degraded` — the warning container,
// the triangle glyph, and `role="alert"` — and it is permanent, so this page
// fired a screen-reader alert about a condition that had not arisen on every
// single load, and painted the warning container as wallpaper. `CARD_FOOTNOTE`
// in `../shapes` already states the principle: a banner IS its state, and a
// block with no off state is not a state.
//
// The cost was not only semantic. The one banner on this page a user must ACT
// on — `deferred-reboot`, "you wrote an IMEI and the modem has not restarted" —
// is also warning-toned, so it arrived as the second amber block under a
// permanent first one and read as more of the same. `override` is the set's
// neutral page-scoped note (`ariaRole: "note"`, `surface-container`, the one
// unfilled disc), which is precisely what this is. Amber on this page now means
// exactly one thing, and it means it only when it is true.
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
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
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
        role="override"
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

      {/* The card cascade. `initial`/`animate` are declared HERE, on the
          container, and the three children carry `variants` alone so they
          inherit this one clock — a child that redeclares them detaches and
          runs its own. The banners above are deliberately outside it: they
          own `.animate-banner-in` in globals.css, and a condition arriving
          should not wait its turn behind the page's furniture. */}
      <motion.div
        className={WORKBENCH_SPLIT}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {/* Left column: the two write surfaces, stacked. They cascade as two
            cards rather than as one column, because that is what they are.

            Every cell carries `CARD_CELL` because a grid cell stretches by
            default but a block child does not inherit that as its own height —
            DESIGN.md > Layout, "Equal heights are explicit". On the device card,
            which owns the template's `auto` row alone, that resolves to its own
            content height; it is here so the row template stays the ONE place
            that decides which card absorbs slack. */}
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <IMEISettingsCard
            anchorId={DEVICE_CARD_ID}
            currentImei={currentImei}
            isLoading={isLoading}
            isSaving={isSaving}
            onSave={saveImei}
            onRebootNow={handleReboot}
            onRebootDeferred={markRebootPending}
          />
        </motion.div>

        <motion.div
          variants={staggerItem}
          className={cn(CARD_CELL, "@4xl/main:row-start-2")}
        >
          <BackupIMEICard
            backupEnabled={backupEnabled}
            backupImei={backupImei}
            isLoading={isLoading}
            isSaving={isSaving}
            onSave={saveBackup}
          />
        </motion.div>

        {/* Right column: the read-only workbench. Nothing here touches NVM, so
            it sits away from the two write surfaces.

            It spans both write rows and is height-matched to them. See
            `WORKBENCH_SPLIT` for why that lock is safe on this page and what
            would make it stop being safe; the card spends its own residual slack
            through `CARD_BODY_FILL` rather than trailing it as a void. */}
        <motion.div
          variants={staggerItem}
          className={cn(
            CARD_CELL,
            "@4xl/main:col-start-2 @4xl/main:row-span-2 @4xl/main:row-start-1",
          )}
        >
          <IMEIToolsCard />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default IMEISettings;
