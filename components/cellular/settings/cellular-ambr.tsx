"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBitrate } from "@/types/cellular-settings";
import type { AmbrData } from "@/types/cellular-settings";

import {
  AMBR_BLOCK,
  AMBR_EMPTY,
  CARD_PAD,
  CARD_SHELL,
  RATE_CHIP,
} from "./shapes";

// =============================================================================
// Data Rate Limits (AMBR) — read-only, carrier-reported
// =============================================================================
// These are the maximum rates the CARRIER allows per bearer, reported by the
// modem. Nothing here is a QManager setting and nothing here is writable — the
// card must never look like it takes input.
//
// -----------------------------------------------------------------------------
// VIOLET IS THE LANGUAGE
// -----------------------------------------------------------------------------
// The approved comp put three LTE signals on one block: an
// `lte_mobiledata_badge` glyph, a small "LTE" chip, and the violet container.
// Two are gone by product decision. The card title says LTE and the container
// fill IS the LTE identity — `lte-container` exists to mean exactly that — so
// the chip and the glyph were saying the same thing a second and third time.
//
// This makes the fill load-bearing, which is only safe because of what this
// block does NOT report. Per the Identity-Chip Rule, a fill carrying identity
// may not also imply health; violet must never read as "good". This block
// reports an APN and two numbers — no quality, no state — so identity is the
// only job the colour has. If a health signal is ever added here it needs a
// non-chromatic channel (a glyph, a bar count) and cannot lean on the fill.
//
// The 5G block is the other half of that language: `primary-container`, because
// blue is simultaneously the brand and the NR identity. The pair only teaches
// the user anything if BOTH sides are stated.
//
// The EMPTY states stay NEUTRAL (`surface-container`) rather than taking their
// radio's tint. An identity fill asserts "this is the 5G reading"; painting it
// when there is no reading would be the fill claiming data that does not exist.
// The empty row identifies its radio in words instead.
//
// -----------------------------------------------------------------------------
// DIRECTION SURVIVES COLOUR-BLINDNESS
// -----------------------------------------------------------------------------
// Down and up chips sit on the SAME fill deliberately. The arrow glyph is the
// differentiator, not a hue — a red/green down/up pair would vanish under
// deuteranopia, and this product is used outdoors on tablets.
// =============================================================================

export interface CellularAMBRCardProps {
  ambr: AmbrData | null;
  isLoading: boolean;
}

interface RateRowProps {
  /** APN (LTE) or DNN (5G). A machine string. */
  name: string;
  dlKbps: number;
  ulKbps: number;
  chipFill: string;
  downLabel: string;
  upLabel: string;
}

function RateRow({
  name,
  dlKbps,
  ulKbps,
  chipFill,
  downLabel,
  upLabel,
}: RateRowProps) {
  return (
    <div className={AMBR_BLOCK.ROW}>
      <span className={AMBR_BLOCK.APN}>{name}</span>
      <div className={AMBR_BLOCK.RATES}>
        <span
          className={cn(RATE_CHIP.ROOT, chipFill)}
          aria-label={`${downLabel} ${formatBitrate(dlKbps)}`}
        >
          <MaterialSymbol
            name="arrow_downward"
            filled
            size={RATE_CHIP.GLYPH}
          />
          {formatBitrate(dlKbps)}
        </span>
        <span
          className={cn(RATE_CHIP.ROOT, chipFill)}
          aria-label={`${upLabel} ${formatBitrate(ulKbps)}`}
        >
          <MaterialSymbol name="arrow_upward" filled size={RATE_CHIP.GLYPH} />
          {formatBitrate(ulKbps)}
        </span>
      </div>
    </div>
  );
}

export function CellularAMBRCard({ ambr, isLoading }: CellularAMBRCardProps) {
  const { t } = useTranslation("cellular");
  const K = "core_settings.basic.ambr";

  if (isLoading || !ambr) {
    return (
      <Card className={cn(CARD_SHELL)}>
        <CardHeader className={CARD_PAD}>
          <CardTitle>{t(`${K}.title`)}</CardTitle>
          <CardDescription>{t(`${K}.description`)}</CardDescription>
        </CardHeader>
        <CardContent className={cn(CARD_PAD, "flex flex-col gap-3")}>
          <Skeleton className={cn(AMBR_BLOCK.HEIGHT, "rounded-tile")} />
          <Skeleton className={cn(AMBR_EMPTY.HEIGHT, "rounded-tile")} />
        </CardContent>
      </Card>
    );
  }

  const downLabel = t(`${K}.download`);
  const upLabel = t(`${K}.upload`);

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-3")}>
        {/* LTE */}
        {ambr.lte.length > 0 ? (
          <div className={AMBR_BLOCK.LTE}>
            <span className={AMBR_BLOCK.TITLE}>{t(`${K}.lte_title`)}</span>
            {ambr.lte.map((entry) => (
              <RateRow
                key={entry.apn}
                name={entry.apn}
                dlKbps={entry.dl_kbps}
                ulKbps={entry.ul_kbps}
                chipFill={RATE_CHIP.ON_LTE}
                downLabel={downLabel}
                upLabel={upLabel}
              />
            ))}
          </div>
        ) : (
          <div className={AMBR_EMPTY.ROOT}>
            <MaterialSymbol
              name="signal_cellular_off"
              size={AMBR_EMPTY.GLYPH}
              className="text-on-surface-variant"
            />
            <span className={AMBR_EMPTY.TITLE}>{t(`${K}.lte_empty_title`)}</span>
            <span className={AMBR_EMPTY.BODY}>{t(`${K}.lte_empty_body`)}</span>
          </div>
        )}

        {/* 5G. The comp's empty-state copy claimed "It has been LTE only on
            this site since 06:41" — a specific historical assertion this page
            has no data source for, and one that would be fabricated outright on
            any device whose serving-cell parse failed. Removed; what remains
            states only the mechanism, which is verifiable. */}
        {ambr.nr5g.length > 0 ? (
          <div className={AMBR_BLOCK.NR}>
            <span className={AMBR_BLOCK.TITLE}>{t(`${K}.nr_title`)}</span>
            {ambr.nr5g.map((entry) => (
              <RateRow
                key={entry.dnn}
                name={entry.dnn}
                dlKbps={entry.dl_kbps}
                ulKbps={entry.ul_kbps}
                chipFill={RATE_CHIP.ON_NR}
                downLabel={downLabel}
                upLabel={upLabel}
              />
            ))}
          </div>
        ) : (
          <div className={AMBR_EMPTY.ROOT}>
            <MaterialSymbol
              name="signal_cellular_off"
              size={AMBR_EMPTY.GLYPH}
              className="text-on-surface-variant"
            />
            <span className={AMBR_EMPTY.TITLE}>{t(`${K}.nr_empty_title`)}</span>
            <span className={AMBR_EMPTY.BODY}>{t(`${K}.nr_empty_body`)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CellularAMBRCard;
