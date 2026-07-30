"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Banner } from "@/components/ui/banner";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { ContextTiles } from "./context-tiles";
import { AntennaStatsSkeleton, AntennaStatsUnreachable } from "./states";
import { CARD_GRID, TechCard } from "./tech-card";

export default function AntennaStatistics() {
  const { t } = useTranslation("cellular");
  const { data, isLoading, isStale, error, refresh } = useModemStatus();

  const signal = data?.signal_per_antenna;

  // Card order is taken from the SERVING NETWORK TYPE, not from which radios
  // currently have per-antenna readings. Per-antenna presence flaps — live
  // capture shows LTE chains dropping out several times an hour — and ordering
  // on it would swap the two cards past each other mid-read, with no motion,
  // because both slots hold the same component type and React re-renders
  // rather than remounts. The registered network type is the stable fact.
  const nrFirst = data?.network?.type === "5G-SA";

  // The first fetch never landed. Distinct from "the radio reported nothing":
  // one is a dead path to the device, the other is a real reading of silence,
  // and they need different screens.
  const unreachable = !isLoading && !data;

  const lteCard = <TechCard signal={signal} prefix="lte" />;
  const nrCard = <TechCard signal={signal} prefix="nr" />;

  return (
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className="flex max-w-[41rem] flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-[-0.02em]">
            {t("antenna_statistics.page.title")}
          </h1>
          <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
            {t("antenna_statistics.page.description")}
          </p>
        </div>
      </motion.div>

      {/* Outside the cascade on purpose: the banner carries its own entrance,
          and a condition should never wait its turn. `error` and `isStale` are
          different facts — the fetch failed, versus the fetch succeeded but the
          poller's own timestamp is old — so they do not share a message. */}
      {!isLoading && !unreachable && (error || isStale) && (
        <Banner
          role="stale"
          title={
            error
              ? t("antenna_statistics.states.error_banner")
              : t("antenna_statistics.states.stale_banner")
          }
        />
      )}

      {isLoading ? (
        <AntennaStatsSkeleton
          label={t("antenna_statistics.states.loading_sr")}
        />
      ) : unreachable ? (
        <AntennaStatsUnreachable onRetry={refresh} />
      ) : (
        <>
          <motion.div variants={staggerItem}>
            <ContextTiles signal={signal} mimo={data?.device?.mimo ?? null} />
          </motion.div>

          <motion.div className={CARD_GRID} variants={staggerContainer}>
            {/* Keyed by which radio occupies the slot, so a genuine RAT change
                REMOUNTS the card instead of re-rendering the same component
                type with swapped contents. Without the key the two cards'
                contents would teleport past each other with no motion at all. */}
            <motion.div
              key={nrFirst ? "nr" : "lte"}
              variants={staggerItem}
              className="h-full *:data-[slot=card]:h-full"
            >
              {nrFirst ? nrCard : lteCard}
            </motion.div>
            <motion.div
              key={nrFirst ? "lte" : "nr"}
              variants={staggerItem}
              className="h-full *:data-[slot=card]:h-full"
            >
              {nrFirst ? lteCard : nrCard}
            </motion.div>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
