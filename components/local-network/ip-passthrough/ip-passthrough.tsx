"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ArrowRightIcon, MinusCircleIcon, RefreshCcwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIpPassthrough } from "@/hooks/use-ip-passthrough";
import { staggerContainer, staggerItem } from "@/lib/motion";

import IPPassthroughCard from "./ip-passthrough-card";
import IpptStrip from "./ippt-strip";
import {
  BAND,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  STATE_BADGE,
  type IpptBandState,
} from "./shapes";

// =============================================================================
// IP Passthrough — page shell
// =============================================================================
// The shell owns the ONE read this page makes (`useIpPassthrough`) and renders
// the page: a header with a Refresh pill, then a `staggerContainer` cascade over
// Band A (what was last applied) and Band B (the one write card).
//
// The retired shell was a server-rendered `<div>` with an inline `text-3xl
// font-bold mb-2` header and a two-column grid holding exactly one card. It
// carried no motion, no translation, and no data — the card fetched for itself,
// which is why nothing on the page could report the read's state.
//
// -----------------------------------------------------------------------------
// THE BAND HEADER LIVES HERE, WITH THE READ IT IS A PROPERTY OF
// -----------------------------------------------------------------------------
// The band's status chip and the Refresh pill answer the same question about the
// same single GET, so they are owned by the component that owns the GET. What
// `IpptStrip` owns is the tile GRID and its three states. Splitting it the other
// way would have the strip deriving a page-level verdict from props it was
// handed.
//
// The chip's two states take DIFFERENT glyphs, and must keep doing so:
// `success-container` and `warning-container` measure 1.03:1 apart and are
// identical under deuteranopia, so on a chip the glyph is the channel that
// actually carries the state.
//
// -----------------------------------------------------------------------------
// "LAST APPLIED", NOT "IN FORCE"
// -----------------------------------------------------------------------------
// `ip_passthrough.sh` (GET) reads `/etc/qmanager/ippt_config.json` — a file this
// UI's own POST wrote — and falls back to poller fields captured once at boot.
// No AT command is issued. Band A is therefore a report of CONFIGURATION, and
// every string on it is written that way. See `ippt-strip.tsx` for the full
// note; it is the single most breakable thing on this surface.
//
// -----------------------------------------------------------------------------
// MOTION
// -----------------------------------------------------------------------------
// The cascade root declares `initial`/`animate` ONCE. The header, band and card
// are `staggerItem` children and must NOT declare their own, or they detach from
// the parent's clock and render at `hidden` forever.
// =============================================================================

const K = "ipPassthrough";

/**
 * Literal key strings, never an interpolated `state_${band}` — a half-assembled
 * key is not something any tool can resolve statically.
 */
const STATE_LABEL_KEY: Record<IpptBandState, string> = {
  router: `${K}.strip.state_router`,
  passthrough: `${K}.strip.state_passthrough`,
};

const IPPassthroughComponent = () => {
  const { t } = useTranslation("common");

  const {
    passthroughMode,
    targetMac,
    ipptNat,
    usbMode,
    dnsProxy,
    isLoading,
    isSaving,
    error,
    saveSettings,
    refresh,
  } = useIpPassthrough();

  const ready = passthroughMode !== null;
  // A read that FAILED and left nothing behind. Distinct from "still loading":
  // the skeleton is a promise, and this is where the promise is broken.
  const failed = !ready && !isLoading && error !== null;

  const bandState: IpptBandState =
    passthroughMode !== null && passthroughMode !== "disabled"
      ? "passthrough"
      : "router";

  return (
    <motion.div
      className={PAGE_ROOT}
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
          </div>

          <div className={PAGE_HEAD.ACTIONS}>
            {/* `refresh` is `useCallback(async (silent = false) => …)`, so a bare
                `onClick={refresh}` would pass the MouseEvent as `silent` and
                suppress the loading state the press exists to show. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => refresh()}
              disabled={isSaving}
              className={PILL_ACTION}
            >
              <RefreshCcwIcon className="size-4" aria-hidden="true" />
              {t(`${K}.header.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <section
          aria-label={t(`${K}.strip.label`)}
          className="flex flex-col gap-2"
        >
          <div className={BAND.HEAD}>
            <span className={BAND.LABEL}>{t(`${K}.strip.label`)}</span>
            {ready ? (
              <Badge variant={STATE_BADGE[bandState]}>
                {bandState === "passthrough" ? (
                  <ArrowRightIcon className={BAND.GLYPH} aria-hidden="true" />
                ) : (
                  <MinusCircleIcon className={BAND.GLYPH} aria-hidden="true" />
                )}
                {t(STATE_LABEL_KEY[bandState])}
              </Badge>
            ) : null}
          </div>

          <IpptStrip
            mode={passthroughMode}
            targetMac={targetMac}
            ipptNat={ipptNat}
            dnsProxy={dnsProxy}
            isLoading={isLoading}
            failed={failed}
            onRetry={() => refresh()}
          />
        </section>
      </motion.div>

      <motion.div variants={staggerItem}>
        <IPPassthroughCard
          passthroughMode={passthroughMode}
          targetMac={targetMac}
          ipptNat={ipptNat}
          usbMode={usbMode}
          dnsProxy={dnsProxy}
          isLoading={isLoading}
          isSaving={isSaving}
          failed={failed}
          saveSettings={saveSettings}
        />
      </motion.div>
    </motion.div>
  );
};

export default IPPassthroughComponent;
