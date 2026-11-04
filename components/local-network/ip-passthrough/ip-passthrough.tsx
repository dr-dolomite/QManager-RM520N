"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIpPassthrough } from "@/hooks/use-ip-passthrough";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import IPPassthroughCard from "./ip-passthrough-card";
import StatusStrip from "./status-strip";
import { HEADER_PILL, PAGE_HEAD, PAGE_ROOT, PILL_GLYPH } from "./shapes";

// The shell owns the page's one read. The cascade root declares initial/animate once;
// children carry only `variants`, or they detach from its clock.

const K = "ipPassthrough";

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

  // A read that failed and left nothing behind, as distinct from still loading.
  const failed = passthroughMode === null && !isLoading && error !== null;

  return (
    <motion.div
      className={PAGE_ROOT}
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
            {/* `refresh(silent?)`: a click event must never reach it. */}
            <Button
              type="button"
              variant="ghost"
              onClick={() => refresh()}
              disabled={isSaving || isLoading}
              size="action"
              className={HEADER_PILL}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isLoading && "motion-safe:animate-spin")}
                aria-hidden
              />
              {t(`${K}.header.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <StatusStrip
          mode={passthroughMode}
          targetMac={targetMac}
          ipptNat={ipptNat}
          usbMode={usbMode}
          dnsProxy={dnsProxy}
          failed={failed}
          onRetry={() => refresh()}
        />
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
