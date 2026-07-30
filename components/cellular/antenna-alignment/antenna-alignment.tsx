"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { LiveAimCard } from "./live-aim";
import { PortStripCard } from "./port-strip";
import { RecorderCard } from "./recorder-card";
import { AlignmentNoReadings, AlignmentSkeleton, AlignmentUnreachable } from "./states";
import { countReportingPorts, detectRadioMode } from "./utils";

// =============================================================================
// Antenna Alignment
// =============================================================================
// Page shell only: the hook, state routing, the header, the degraded banner, and
// the card order. Every card owns its own content.
//
// Card order is the order the aiming user's questions arrive in:
//   1. Live Aim      — "is it better than it was a second ago?" (the sweep)
//   2. Alignment Meter — "which of these three positions won?" (the commit)
//   3. Receive Chains  — "am I aiming with all the chains I think I have?"
//
// That is a deliberate inversion of the old page, which led with four per-antenna
// cards and buried the live readout inside the recorder card in 10px type.
// =============================================================================

export default function AntennaAlignmentComponent() {
  const { t, i18n } = useTranslation("cellular");
  const { data, isLoading, isStale, error, refresh } = useModemStatus();

  const spa = data?.signal_per_antenna ?? null;
  const mode = spa ? detectRadioMode(spa) : null;

  /** The first fetch never landed — we have nothing, not even a reason. */
  const unreachable = !isLoading && !data;
  /** The modem answered and every chain reported nothing. */
  const noReadings = !!spa && countReportingPorts(spa) === 0;

  /**
   * The modem's own timestamp for this snapshot, rendered as a clock time.
   *
   * Deliberately the device's stamp and not an elapsed age: computing "3s ago"
   * means reading a clock during render, which `react-hooks/purity` flags and
   * `use-modem-status.ts` explicitly asks consumers not to do. A frozen clock
   * time is just as legible as a frozen counter — if the figure stops advancing,
   * the feed has stopped — and it needs no timer to stay honest.
   */
  const updatedAt =
    data?.timestamp != null
      ? new Date(data.timestamp * 1000).toLocaleTimeString(i18n.language)
      : null;

  /** Recording depends on fresh snapshots arriving; say so when they are not. */
  const feedStalled = !!error || isStale;

  return (
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem} className="flex max-w-[41rem] flex-col gap-1.5">
        <h1 className="text-3xl font-bold tracking-[-0.02em]">
          {t("antenna_alignment.page.title")}
        </h1>
        <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
          {t("antenna_alignment.page.description")}
        </p>
      </motion.div>

      {/* Outside the cascade: a condition banner should arrive when the condition
          does, not on the page's entrance clock. */}
      {!isLoading && !unreachable && feedStalled && (
        <Banner
          role="stale"
          title={
            error
              ? t("antenna_alignment.states.error_banner")
              : t("antenna_alignment.states.stale_banner")
          }
        />
      )}

      {isLoading ? (
        <AlignmentSkeleton label={t("antenna_alignment.states.loading_sr")} />
      ) : unreachable ? (
        <motion.div variants={staggerItem}>
          <AlignmentUnreachable onRetry={refresh} />
        </motion.div>
      ) : noReadings ? (
        <motion.div variants={staggerItem}>
          <AlignmentNoReadings onRetry={refresh} />
        </motion.div>
      ) : spa && mode ? (
        <>
          <motion.div variants={staggerItem}>
            <LiveAimCard
              spa={spa}
              snapshotTs={data?.timestamp ?? null}
              updatedAt={updatedAt}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <RecorderCard
              spa={spa}
              snapshotTs={data?.timestamp ?? null}
              feedStalled={feedStalled}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <PortStripCard spa={spa} mode={mode} />
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
}
