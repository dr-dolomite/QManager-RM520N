"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import { DUR, EASE_QUICK, EASE_STANDARD } from "@/lib/motion";

import { HISTORY_ROW, networkIdentity } from "../shapes";
import type { HistoryEntry, NetworkType } from "./calc-model";

// =============================================================================
// The calculation history
// =============================================================================
// THIS IS THE ONE PLACE ON THE SURFACE THAT EARNS AN EXIT ANIMATION, and it is
// worth saying why, because the Enter-Only Rule bans them nearly everywhere.
// That rule is about CONDITIONS and NAVIGATION: a banner leaving means the
// condition cleared and should feel immediate, and an outgoing route is already
// gone. Neither applies to a row the user just deleted. Here the deletion IS
// the event, the row is the thing that was acted on, and a row that vanishes
// between two frames while the four below it jump up is indistinguishable from
// having deleted the wrong one.
//
// So: enter on `standard`, exit on `quick`. The exit is deliberately the faster
// leg — the same input-latency reasoning behind the Modal-Exit Rule. A row
// leaving is confirmation of something already decided, and confirmation should
// not be slower than the decision.
//
// `initial={false}` on the list keeps the first paint silent. Rows restored
// from localStorage arrive with the card's own entrance cascade; replaying an
// insert animation for ten stored rows would claim ten things just happened.
// Only a row that arrives AFTER mount animates in, which is exactly the one the
// user just created.
// =============================================================================

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
  onDelete,
}: {
  history: HistoryEntry[];
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation("cellular");

  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {history.map((entry) => (
          <motion.li
            key={entry.id}
            layout="position"
            initial={ROW_MOTION.initial}
            animate={ROW_MOTION.animate}
            exit={ROW_MOTION.exit}
            transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
            className={HISTORY_ROW.ROOT}
          >
            <div className={HISTORY_ROW.MAIN}>
              <div className={HISTORY_ROW.HEAD}>
                <span className={HISTORY_ROW.CHANNEL}>{entry.channel}</span>
                <Tag variant={networkIdentity(entry.networkType)}>
                  {entry.networkType}
                </Tag>
                <span className={HISTORY_ROW.FIGURE}>
                  {t("cell_scanner.calculator.units.mhz", {
                    value: entry.frequency,
                  })}
                </span>
              </div>

              {entry.bands.length > 0 ? (
                <p className={HISTORY_ROW.BANDS}>
                  <span className={HISTORY_ROW.BANDS_KEY}>
                    {t("cell_scanner.calculator.history.bands")}
                  </span>{" "}
                  <span className={HISTORY_ROW.BANDS_VALUE}>
                    {entry.bands
                      .map((band) =>
                        t(HISTORY_BAND_KEY[entry.networkType], { band }),
                      )
                      .join(", ")}
                  </span>
                </p>
              ) : null}

              <p className={HISTORY_ROW.TIME}>
                {entry.timestamp
                  ? new Date(entry.timestamp).toLocaleString()
                  : t("cell_scanner.calculator.history.no_timestamp")}
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onDelete(entry.id)}
              aria-label={t("cell_scanner.calculator.a11y.delete_entry")}
              className={HISTORY_ROW.DELETE}
            >
              <MaterialSymbol name="close" size={16} />
            </Button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
