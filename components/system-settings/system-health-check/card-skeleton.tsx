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
  CARD_STACK,
  GROUP_HEAD,
  GROUP_ROWS,
  ROW_GROUP,
  SKELETON,
  TEST_ROW,
} from "./shapes";

/** Placeholder rows per group. Long enough to read as a list, short enough
    that the real list never shrinks the page on arrival. */
const ROWS = [0, 1, 2];
const GROUPS = [0, 1];

export function CardSkeleton(): React.JSX.Element {
  const { t } = useTranslation("system-health-check");

  return (
    <motion.div variants={staggerItem}>
      {/* Stands in for "All checks" — the one card that always renders — so it
          wears that card's shell, not the hero radius of the findings card. */}
      <Card
        className={CARD_SHELL}
        role="status"
        aria-label={t("loading.status")}
      >
        <CardHeader className={CARD_PAD}>
          <Skeleton className={SKELETON.CARD.TITLE} />
          <Skeleton className={SKELETON.CARD.DESC} />
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          {GROUPS.map((group) => (
            <div key={group} className={ROW_GROUP}>
              <div className={GROUP_HEAD.ROOT}>
                <div className={GROUP_HEAD.TEXT}>
                  <Skeleton className={SKELETON.GROUP.LABEL} />
                  <Skeleton className={SKELETON.GROUP.DESC} />
                </div>
                <div className={GROUP_HEAD.META}>
                  <Skeleton className={SKELETON.GROUP.CHIP} />
                </div>
              </div>

              <div className={GROUP_ROWS}>
                {ROWS.map((row) => (
                  <div key={row} className={cn(TEST_ROW.ROOT, TEST_ROW.STATIC)}>
                    <div className={TEST_ROW.TEXT}>
                      <Skeleton className={SKELETON.TEST.LABEL} />
                      <Skeleton className={SKELETON.TEST.DETAIL} />
                    </div>
                    <div className={TEST_ROW.META}>
                      <Skeleton className={SKELETON.TEST.DURATION} />
                      <Skeleton className={SKELETON.TEST.CHIP} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default CardSkeleton;
