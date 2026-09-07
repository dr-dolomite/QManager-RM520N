"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  CARD_PAD,
  CARD_SHELL,
  CARD_SHELL_HERO,
  CARD_STACK,
  DELTA,
  LADDER,
  NOTES,
  NOTICE,
  SKELETON,
  STEP_ORDER,
} from "./shapes";

/** Enough slivers to fill `NOTES.PANEL`'s cap, which a real changelog reaches. */
const NOTES_LINES = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * The anchor card's placeholder. It wears the real hero shell and fills the
 * real delta strip and ladder boxes, so its height RESOLVES to the loaded
 * card's rather than being asserted.
 */
export function AnchorCardSkeleton(): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  return (
    <motion.div variants={staggerItem}>
      <Card
        className={CARD_SHELL_HERO}
        role="status"
        aria-label={t("software_update.states.loading.status")}
      >
        <CardHeader className={CARD_PAD}>
          <Skeleton className={SKELETON.CARD.TITLE} />
          <Skeleton className={SKELETON.CARD.DESC} />
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          <div className={DELTA.ROOT}>
            <div className={DELTA.SLOT}>
              <Skeleton className={SKELETON.DELTA.EYEBROW} />
              <Skeleton className={SKELETON.DELTA.VALUE} />
            </div>
            <Skeleton className={SKELETON.DELTA.ARROW} />
            <div className={DELTA.SLOT}>
              <Skeleton className={SKELETON.DELTA.EYEBROW} />
              <Skeleton className={SKELETON.DELTA.VALUE} />
            </div>
            <div className={DELTA.META}>
              <Skeleton className={SKELETON.DELTA.TAG} />
              <Skeleton className={SKELETON.DELTA.TAG} />
            </div>
          </div>

          {/* The ladder is always four rows, so the placeholder is too. A
              resting row carries no chip, so neither does its stand-in. */}
          <div className={LADDER.GROUP}>
            {STEP_ORDER.map((step) => (
              <div key={step} className={LADDER.ROW}>
                <Skeleton className={SKELETON.LADDER.DISC} />
                <div className={LADDER.TEXT}>
                  <Skeleton className={SKELETON.LADDER.LABEL} />
                  <Skeleton className={SKELETON.LADDER.DETAIL} />
                </div>
              </div>
            ))}
          </div>

          {/* Without this the page settles upward by the notice's height. */}
          <div className={cn(NOTICE.BOX, NOTICE.WARNING)}>
            <Skeleton className={SKELETON.NOTICE.GLYPH} />
            <div className={NOTICE.STACK}>
              <Skeleton className={SKELETON.NOTICE.TEXT} />
              <Skeleton className={SKELETON.NOTICE.TEXT_2} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** The release-notes placeholder: the real panel box, filled with prose. */
export function NotesCardSkeleton(): React.JSX.Element {
  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <Skeleton className={SKELETON.CARD.TITLE} />
          <Skeleton className={SKELETON.CARD.DESC} />
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          <div className={SKELETON.NOTES.PANEL}>
            <div className={NOTICE.STACK}>
              {NOTES_LINES.map((line) => (
                <Skeleton key={line} className={SKELETON.NOTES.LINE} />
              ))}
              <Skeleton className={SKELETON.NOTES.LINE_SHORT} />
            </div>
          </div>

          <div className={NOTES.FOOTER}>
            <Skeleton className={SKELETON.ACTION} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
