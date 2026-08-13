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
import type { NetworkType } from "@/types/modem-status";

import {
  AMBR_BLOCK,
  EMPTY_BLOCK,
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
// EXACTLY ONE BLOCK, NEVER TWO — AMBR FOLLOWS THE ANCHOR, NOT THE RADIO
// -----------------------------------------------------------------------------
// An earlier draft always rendered BOTH the LTE and 5G blocks, falling back to
// an empty state for whichever array was unpopulated. That is not a real
// device state: LTE AMBR governs the bearer whenever the anchor is LTE — which
// is true in BOTH `LTE` and `5G-NSA` (NSA's NR leg is a secondary carrier on
// top of the LTE-anchored PDN session, not a second PDN with its own AMBR).
// NR5G AMBR only governs anything once the modem is in `5G-SA`, where NR IS
// the anchor. So exactly one of the two arrays is ever the live figure; the
// other is either empty or a stale leftover from a technology the modem isn't
// currently anchored on, and showing it next to a permanently-empty sibling
// card read as "half this feature is broken" rather than "only one applies."
// `resolveActiveAmbr` below picks the one block that matches
// `NetworkStatus.type`, with a data-driven fallback only for the genuinely
// unknown case (empty `type`, e.g. before first registration).
//
// -----------------------------------------------------------------------------
// VIOLET IS THE LANGUAGE
// -----------------------------------------------------------------------------
// The card title says which radio and the container fill IS that radio's
// identity — `lte-container` for the LTE block, `primary-container` for the
// 5G block, because blue is simultaneously the brand and the NR identity.
//
// This makes the fill load-bearing, which is only safe because of what this
// block does NOT report. Per the Identity-Chip Rule, a fill carrying identity
// may not also imply health; neither violet nor blue may read as "good" here.
// This block reports an APN and two numbers — no quality, no state — so
// identity is the only job the colour has. If a health signal is ever added
// here it needs a non-chromatic channel (a glyph, a bar count) and cannot
// lean on the fill.
//
// The EMPTY state stays NEUTRAL (`surface-container`) rather than taking the
// active radio's tint. An identity fill asserts "this is a real reading";
// painting it when there is no reading would be the fill claiming data that
// does not exist. The empty row identifies its radio in words instead.
//
// -----------------------------------------------------------------------------
// DOWNLOAD IS BLUE, UPLOAD IS VIOLET — NOT A THIRD ACCENT HUE
// -----------------------------------------------------------------------------
// The rate chips are coloured by DIRECTION, not by which radio block they sit
// in: download is always `primary` (blue), upload is always `lte` (violet).
// Both hues are already load-bearing in this product's palette — brand/NR and
// LTE identity, respectively — so a download/upload pair reads as part of the
// same blue-and-violet family this card (and the dashboard) already lives in,
// rather than introducing Uplink Cyan as a third accent that has no other
// anchor on a card whose own container fill IS one of these two hues. This
// matches `speedtest-dialog.tsx`'s own three-way contract, which assigns
// `upload -> lte` for the identical reason once a third measurement (ping)
// needed cyan for itself. The radio's own identity still shows one layer out
// — it is the LTE/5G container fill — so this card states two facts at once:
// which radio, and which direction, each on its own channel. The arrow glyph
// rides along as direction's second channel, so the pairing still survives
// colour-blindness even where it lands inside the LTE block and one chip
// shares that block's hue family (see `RATE_CHIP` in shapes.ts for the full
// reasoning, including why cyan is still the right call on the dashboard's
// own `device-metrics.tsx` tile, which has no adjacent purple to clash with).
// =============================================================================

export interface CellularAMBRCardProps {
  ambr: AmbrData | null;
  isLoading: boolean;
  /**
   * The modem's current access technology, used only to pick which AMBR
   * block is the live one. `""` (not yet determined) falls back to whichever
   * array actually has entries.
   */
  networkType: NetworkType;
}

type ActiveRadio = "lte" | "nr5g";

interface ActiveAmbr {
  radio: ActiveRadio;
  entries: AmbrData["lte"] | AmbrData["nr5g"];
}

/**
 * LTE AMBR governs `LTE` and `5G-NSA` (NSA anchors on LTE); NR5G AMBR only
 * governs `5G-SA`. An unknown/empty type (before first registration) falls
 * back to whichever array the modem actually populated, preferring LTE when
 * both or neither are — LTE is the far more common anchor.
 */
function resolveActiveAmbr(
  networkType: NetworkType,
  ambr: AmbrData,
): ActiveAmbr {
  if (networkType === "5G-SA") return { radio: "nr5g", entries: ambr.nr5g };
  if (networkType === "LTE" || networkType === "5G-NSA")
    return { radio: "lte", entries: ambr.lte };
  if (ambr.nr5g.length > 0 && ambr.lte.length === 0)
    return { radio: "nr5g", entries: ambr.nr5g };
  return { radio: "lte", entries: ambr.lte };
}

interface RateRowProps {
  /** APN (LTE) or DNN (5G). A machine string. */
  name: string;
  dlKbps: number;
  ulKbps: number;
  downLabel: string;
  upLabel: string;
}

function RateRow({ name, dlKbps, ulKbps, downLabel, upLabel }: RateRowProps) {
  return (
    <div className={AMBR_BLOCK.ROW}>
      <span className={AMBR_BLOCK.APN}>{name}</span>
      <div className={AMBR_BLOCK.RATES}>
        <span
          className={cn(RATE_CHIP.ROOT, RATE_CHIP.ON_DOWNLOAD)}
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
          className={cn(RATE_CHIP.ROOT, RATE_CHIP.ON_UPLOAD)}
          aria-label={`${upLabel} ${formatBitrate(ulKbps)}`}
        >
          <MaterialSymbol name="arrow_upward" filled size={RATE_CHIP.GLYPH} />
          {formatBitrate(ulKbps)}
        </span>
      </div>
    </div>
  );
}

export function CellularAMBRCard({
  ambr,
  isLoading,
  networkType,
}: CellularAMBRCardProps) {
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
        </CardContent>
      </Card>
    );
  }

  const downLabel = t(`${K}.download`);
  const upLabel = t(`${K}.upload`);
  const { radio, entries } = resolveActiveAmbr(networkType, ambr);
  const isLte = radio === "lte";

  return (
    <Card className={cn(CARD_SHELL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className={CARD_PAD}>
        {entries.length > 0 ? (
          <div className={isLte ? AMBR_BLOCK.LTE : AMBR_BLOCK.NR}>
            <span className={AMBR_BLOCK.TITLE}>
              {t(isLte ? `${K}.lte_title` : `${K}.nr_title`)}
            </span>
            {entries.map((entry) => {
              const name = isLte
                ? (entry as AmbrData["lte"][number]).apn
                : (entry as AmbrData["nr5g"][number]).dnn;
              return (
                <RateRow
                  key={name}
                  name={name}
                  dlKbps={entry.dl_kbps}
                  ulKbps={entry.ul_kbps}
                  downLabel={downLabel}
                  upLabel={upLabel}
                />
              );
            })}
          </div>
        ) : (
          <div className={EMPTY_BLOCK.ROOT}>
            <MaterialSymbol
              name="signal_cellular_off"
              size={EMPTY_BLOCK.GLYPH}
              className="text-on-surface-variant"
            />
            <span className={EMPTY_BLOCK.TITLE}>
              {t(isLte ? `${K}.lte_empty_title` : `${K}.nr_empty_title`)}
            </span>
            <span className={EMPTY_BLOCK.BODY}>
              {t(isLte ? `${K}.lte_empty_body` : `${K}.nr_empty_body`)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CellularAMBRCard;
