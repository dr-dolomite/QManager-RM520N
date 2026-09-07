"use client";

import type * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  CARD_BODY,
  CARD_PAD,
  CARD_SHELL,
  CARD_SHELL_HERO,
  LANG_GRID,
  LANG_ROW,
  PACK_ROW,
  ROW_GROUP,
  SKELETON,
} from "./shapes";

// The five bundled languages are always present, so the display card's height
// is knowable before the GET lands and the placeholder can be exact.
const LANG_ROWS = [0, 1, 2, 3, 4];
const PACK_ROWS = [0, 1];

export function CardSkeleton(): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  return (
    <>
      <motion.div variants={staggerItem}>
        <Card
          className={CARD_SHELL_HERO}
          role="status"
          aria-label={t("languages.loading.status")}
        >
          <CardHeader className={CARD_PAD}>
            <Skeleton className={SKELETON.CARD.TITLE} />
            <Skeleton className={SKELETON.CARD.DESC} />
          </CardHeader>
          <CardContent className={cn(CARD_PAD, CARD_BODY)}>
            <div className={cn(ROW_GROUP, LANG_GRID)}>
              {LANG_ROWS.map((row) => (
                <div key={row} className={LANG_ROW.ROOT}>
                  <Skeleton className={SKELETON.LANG.MARK} />
                  <div className={LANG_ROW.TEXT}>
                    <Skeleton className={SKELETON.LANG.NATIVE} />
                  </div>
                  <div className={LANG_ROW.META}>
                    <Skeleton className={SKELETON.LANG.CHIP} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card className={CARD_SHELL} aria-hidden="true">
          <CardHeader className={CARD_PAD}>
            <Skeleton className={SKELETON.CARD.TITLE} />
            <Skeleton className={SKELETON.CARD.DESC} />
          </CardHeader>
          <CardContent className={cn(CARD_PAD, CARD_BODY)}>
            <div className={ROW_GROUP}>
              {PACK_ROWS.map((row) => (
                <div key={row} className={PACK_ROW.ROOT}>
                  <div className={PACK_ROW.TEXT}>
                    <div className={PACK_ROW.NAMES}>
                      <Skeleton className={SKELETON.PACK.NATIVE} />
                      <Skeleton className={SKELETON.PACK.ENGLISH} />
                    </div>
                    <div className={PACK_ROW.META}>
                      <Skeleton className={SKELETON.PACK.CHIP} />
                      <Skeleton className={SKELETON.PACK.CHIP} />
                      <Skeleton className={SKELETON.PACK.CHIP} />
                    </div>
                  </div>
                  <div className={PACK_ROW.ACTION}>
                    <Skeleton className={SKELETON.PACK.ACTION} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </>
  );
}

export default CardSkeleton;
