"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import CellularPageHeader from "@/components/cellular/page-header";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { useImeiSettings } from "@/hooks/use-imei-settings";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { clearPendingReboot, requestRebootLater } from "@/lib/reboot";
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
// Writing an IMEI does nothing until the modem restarts. The dialog offers
// "Reboot now" / "Later", and Later is recorded: it sets the app-wide
// pending-reboot flag (`requestRebootLater("imei")`), so the shell's
// `PendingRebootBanner` stays on every route until the modem restarts. The fork
// kept a page-local sessionStorage key and its own banner here; this target
// already has the one banner, mounted once in the app layout, so the page only
// sets the flag and renders no copy of it.
//
// NEVER reboot inline in a request path. The app is served BY the modem, so an
// in-flight reboot kills its own HTTP response; the reboot always sits behind a
// dialog or this banner, and the actual restart is a handoff to /reboot/.
// =============================================================================

/** Anchor id for the device card. */
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

  const markRebootPending = React.useCallback(() => {
    requestRebootLater("imei");
  }, []);

  const handleReboot = React.useCallback(async () => {
    // Rebooting now satisfies any reboot that was owed.
    clearPendingReboot();
    const sent = await rebootDevice();
    if (!sent) {
      // Keep the reboot owed so the banner can offer it again.
      requestRebootLater("imei");
      toast.error(t(`${K}.reboot.toast_failed`));
    }
  }, [rebootDevice, t]);

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

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
