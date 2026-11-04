"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import CellularPageHeader from "@/components/cellular/page-header";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { CARD_FOOTNOTE, PAGE_ROOT } from "../shapes";
import FPLMNCard from "./fplmn-card";

// =============================================================================
// Blocked Networks — the route shell
// =============================================================================
// Page header, one card, one note. SINGLE COLUMN: the incumbent shell put this
// lone card in a two-column grid, so it rendered half-width with a column of
// dead space beside it. A grid is for a set of cards; this surface has one.
//
// The header is `CellularPageHeader` rather than a hand-written `h1` + `p`
// carrying `PAGE_TITLE` / `PAGE_DESCRIPTION`. It renders the identical Display
// triple (`text-3xl font-bold tracking-[-0.02em]`) over an
// `on-surface-variant` description — which is exactly the gap being closed
// here — and it is what the sibling `/cellular/settings/` routes already ship,
// so this page cannot drift away from them later. A class you have to remember
// to type is a class that will eventually be typed wrong.
//
// THE NOTE IS NEUTRAL, NOT A BANNER — and the reason has changed since this was
// written. The original argument was that `TonalBanner`'s informational tone is
// `primary-container`, the same fill the card's clean state used, so two primary
// blocks would stack into one continuous condition. The clean state has since
// moved to `success` (`ConditionTone` gained that member), so that collision no
// longer exists. The note stays neutral on the stronger reason: a banner IS its
// state, and this note has no off state. A tint that is always on is wallpaper,
// and it spends a container the system reserves for conditions that arose.
//
// Its geometry now lives in `CARD_FOOTNOTE` rather than inline here. It was six
// values typed at this call site — a radius, a fill, two padding steps, a disc
// pair and a type size — on a surface whose whole family keeps geometry in one
// shapes module precisely so no single file has to be read to know what the
// product looks like. The type size moved with it: 13px prose is named in
// DESIGN.md's Don'ts, and `on-surface-variant` is what demotes a footnote
// anyway.
//
// THE PAGE ARRIVES. Card then note, 120ms apart on the card cascade — the same
// entrance `/cellular/settings` gives its own cards. Both elements used to
// hard-appear, which made this route the odd one out in its own family.
// =============================================================================

const K = "core_settings.fplmn";

export function FPLMNSettingsComponent() {
  const { t } = useTranslation("cellular");

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
      />

      <motion.div
        className="flex flex-col gap-3"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <FPLMNCard />
        </motion.div>

        <motion.div variants={staggerItem} className={CARD_FOOTNOTE.ROOT}>
          <span aria-hidden="true" className={CARD_FOOTNOTE.DISC}>
            <MaterialSymbol name="info" filled size={CARD_FOOTNOTE.GLYPH} />
          </span>
          <p className={CARD_FOOTNOTE.BODY}>{t(`${K}.page.note`)}</p>
        </motion.div>
      </motion.div>
    </div>
  );
}

export default FPLMNSettingsComponent;
