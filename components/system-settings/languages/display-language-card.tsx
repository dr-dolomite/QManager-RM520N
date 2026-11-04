"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { staggerItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import LanguageRow from "./language-row";
import type { LanguageRow as LanguageRowData } from "./derive";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL_HERO,
  CARD_TITLE,
  GROUP_FILL,
  LANG_GRID,
  ROW_GROUP,
} from "./shapes";

const K = "languages.display";

export interface DisplayLanguageCardProps {
  rows: LanguageRowData[];
  activeCode: string;
  switchingCode: string | null;
  onSelect: (code: string) => void;
  onRemove: (code: string, isActive: boolean) => Promise<void>;
}

/**
 * The anchor card: every language this device can render right now, as one
 * radiogroup. Selecting a row switches the interface, so the row IS the control
 * and there is no separate Use button to hunt for.
 */
export function DisplayLanguageCard({
  rows,
  activeCode,
  switchingCode,
  onSelect,
  onRemove,
}: DisplayLanguageCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  const refs = React.useRef<(HTMLDivElement | null)[]>([]);
  const checkedIndex = Math.max(
    0,
    rows.findIndex((row) => row.code === activeCode),
  );

  // Arrows move focus AND selection, the stock radiogroup contract: switching
  // is instant and reversible, so there is nothing here to confirm first.
  const handleKeyDown =
    (index: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
      const count = rows.length;
      if (count === 0) return;
      let next: number;
      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          next = (index + 1) % count;
          break;
        case "ArrowUp":
        case "ArrowLeft":
          next = (index - 1 + count) % count;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = count - 1;
          break;
        case " ":
        case "Enter":
          event.preventDefault();
          onSelect(rows[index].code);
          return;
        default:
          return;
      }
      event.preventDefault();
      refs.current[next]?.focus();
      onSelect(rows[next].code);
    };

  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL_HERO}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          {/* The page clock has already run by the time this mounts, so this
              cascade declares its own initial/animate rather than inheriting. */}
          <motion.div
            role="radiogroup"
            aria-label={t(`${K}.group_aria`)}
            className={cn(ROW_GROUP, LANG_GRID, GROUP_FILL)}
            initial="hidden"
            animate="visible"
            variants={staggerRows}
          >
            {rows.map((row, index) => (
              <LanguageRow
                key={row.code}
                row={row}
                isActive={row.code === activeCode}
                switching={switchingCode === row.code}
                tabIndex={index === checkedIndex ? 0 : -1}
                onSelect={onSelect}
                onKeyDown={handleKeyDown(index)}
                onRemove={onRemove}
                registerRef={(element) => {
                  refs.current[index] = element;
                }}
              />
            ))}
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default DisplayLanguageCard;
