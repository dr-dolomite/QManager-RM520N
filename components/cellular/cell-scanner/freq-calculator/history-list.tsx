"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import { DUR, EASE_QUICK, EASE_STANDARD } from "@/lib/motion";

import { HISTORY_ROW, networkIdentity } from "../shapes";
import { relativeTimeBucket, type HistoryEntry, type NetworkType } from "./calc-model";

// History as hairline rows in one well; each row is two SIBLING buttons (recall, delete), never nested.
// A deleted row is the one exit animation this surface earns; `initial={false}` keeps restored rows silent.

const HISTORY_BAND_KEY = {
  LTE: "cell_scanner.calculator.history.band_lte",
  NR: "cell_scanner.calculator.history.band_nr",
} as const satisfies Record<NetworkType, string>;

const ROW_MOTION = {
  initial: { opacity: 0, y: 5 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.standard, ease: EASE_STANDARD },
  },
  exit: {
    opacity: 0,
    x: 8,
    transition: { duration: DUR.quick, ease: EASE_QUICK },
  },
} as const;

export function HistoryList({
  history,
  onRecall,
  onDelete,
}: {
  history: HistoryEntry[];
  /** Puts `entry.channel` back in the field and re-derives it without recording. */
  onRecall: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation("cellular");

  return (
    <ul className={HISTORY_ROW.LIST}>
      <AnimatePresence initial={false}>
        {history.map((entry) => {
          const bucket = entry.timestamp ? relativeTimeBucket(entry.timestamp) : null;
          const relativeLabel = !bucket
            ? t("cell_scanner.calculator.history.no_timestamp")
            : bucket.unit === "now"
              ? t("cell_scanner.calculator.history.time_now")
              : bucket.unit === "yesterday"
                ? t("cell_scanner.calculator.history.time_yesterday")
                : t(`cell_scanner.calculator.history.time_${bucket.unit}`, {
                    count: bucket.count,
                  });
          const absoluteTitle = entry.timestamp
            ? new Date(entry.timestamp).toLocaleString()
            : undefined;

          return (
            <motion.li
              key={entry.id}
              layout="position"
              initial={ROW_MOTION.initial}
              animate={ROW_MOTION.animate}
              exit={ROW_MOTION.exit}
              transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
              className={HISTORY_ROW.ROOT}
            >
              <button
                type="button"
                onClick={() => onRecall(entry)}
                aria-label={t("cell_scanner.calculator.a11y.recall_entry", {
                  value: entry.channel,
                })}
                title={absoluteTitle}
                className={HISTORY_ROW.RECALL}
              >
                <span className={HISTORY_ROW.LEAD}>
                  <span className={HISTORY_ROW.CHANNEL}>{entry.channel}</span>
                  <Tag variant={networkIdentity(entry.networkType)}>
                    {entry.networkType}
                  </Tag>
                </span>
                <span className={HISTORY_ROW.FIGURE}>
                  {t("cell_scanner.calculator.units.mhz", {
                    value: entry.frequency,
                  })}
                </span>

                <span className={HISTORY_ROW.BANDS}>
                  {entry.bands
                    .map((band) => t(HISTORY_BAND_KEY[entry.networkType], { band }))
                    .join(", ")}
                </span>
                <span className={HISTORY_ROW.TIME}>{relativeLabel}</span>
              </button>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(entry.id)}
                aria-label={t("cell_scanner.calculator.a11y.delete_entry")}
                className={HISTORY_ROW.DELETE}
              >
                <MaterialSymbol name="close" size={16} />
              </Button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
