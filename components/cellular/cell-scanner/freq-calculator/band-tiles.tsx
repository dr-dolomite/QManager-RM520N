"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  BAND_HIT_INK,
  BAND_TILE,
  VERDICT,
  VERDICT_TONE,
  type VerdictTone,
} from "../shapes";
import {
  positionInBand,
  uplinkChannelRange,
  type BandAgreement,
  type CalculationResult,
  type MatchingBand,
  type NetworkType,
  bandAgreement,
} from "./calc-model";

// Matching bands as hairline sections of one well, each a Downlink/Uplink table.
// The cascade mounts on a swap, so it declares its own initial/animate, keyed on the channel.

export const BAND_LABEL_KEY = {
  LTE: "cell_scanner.calculator.result.band_lte",
  NR: "cell_scanner.calculator.result.band_nr",
} as const satisfies Record<NetworkType, string>;

/** The channel row's key — "EARFCN" or "NR-ARFCN". */
const CHANNEL_LABEL_KEY = {
  LTE: "cell_scanner.calculator.result.earfcn",
  NR: "cell_scanner.calculator.result.nrarfcn",
} as const satisfies Record<NetworkType, string>;

/** The agreement verdict, keyed literally for `i18n:check`; one band gets none. */
const AGREEMENT: Record<
  Exclude<BandAgreement, "single">,
  { tone: VerdictTone; glyph: "layers" | "warning"; key: string }
> = {
  agree: {
    tone: "muted",
    glyph: "layers",
    key: "cell_scanner.calculator.result.bands_agree",
  },
  conflict: {
    tone: "warning",
    glyph: "warning",
    key: "cell_scanner.calculator.result.bands_conflict",
  },
};

function BandSection({
  band,
  networkType,
  channel,
}: {
  band: MatchingBand;
  networkType: NetworkType;
  channel: number;
}) {
  const { t } = useTranslation("cellular");

  const tone = networkType === "NR" ? "nr" : "lte";
  const ink = BAND_HIT_INK[tone];
  const ulRange = uplinkChannelRange(band, channel);
  // One flag decides every row: TDD and SDL both collapse the uplink column into a sentence.
  const hasUplink = ulRange !== null && band.ulFrequency !== null;
  const pct = Math.round(positionInBand(channel, band.channelRange) * 100);

  const mhz = (value: string | number) =>
    t("cell_scanner.calculator.units.mhz", { value });
  const rangeMhz = (low: string | number, high: string | number) =>
    t("cell_scanner.calculator.units.range_mhz", { low, high });
  const ofRange = (low: number, high: number) =>
    t("cell_scanner.calculator.result.of_range", { low, high });

  const uplinkNote =
    band.duplexType === "SDL"
      ? t("cell_scanner.calculator.result.sdl_uplink")
      : t("cell_scanner.calculator.result.tdd_uplink");

  return (
    <motion.div variants={staggerRowItem} className={BAND_TILE.SECTION}>
      <div className={BAND_TILE.HEAD}>
        <span className={BAND_TILE.BAND}>
          {t(BAND_LABEL_KEY[networkType], { band: band.band })}
        </span>
        <span className={BAND_TILE.NAME}>{band.name}</span>
        <Tag className={BAND_TILE.DUPLEX}>{band.duplexType}</Tag>
      </div>

      <table className={BAND_TILE.TABLE}>
        <thead>
          <tr>
            <th className={BAND_TILE.TH} scope="col" />
            <th className={BAND_TILE.TH_DIRECTION} scope="col">
              <MaterialSymbol name="arrow_downward" size={14} className="mr-1 -mb-px inline-block" />
              {t("cell_scanner.calculator.result.downlink")}
            </th>
            <th
              className={cn(BAND_TILE.TH_DIRECTION, !hasUplink && BAND_TILE.WIDE_ONLY)}
              scope="col"
            >
              <MaterialSymbol name="arrow_upward" size={14} className="mr-1 -mb-px inline-block" />
              {t("cell_scanner.calculator.result.uplink")}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cn(BAND_TILE.TD, BAND_TILE.TD_KEY)}>
              {t("cell_scanner.calculator.result.frequency")}
            </td>
            <td className={cn(BAND_TILE.TD, BAND_TILE.TD_VALUE, ink.text)}>
              {mhz(band.dlFrequency)}
            </td>
            {hasUplink ? (
              <td className={cn(BAND_TILE.TD, BAND_TILE.TD_VALUE)}>
                {mhz(band.ulFrequency as string)}
              </td>
            ) : (
              <td className={cn(BAND_TILE.TD_NOTE, BAND_TILE.WIDE_ONLY)} rowSpan={4}>
                {uplinkNote}
              </td>
            )}
          </tr>
          <tr>
            <td className={cn(BAND_TILE.TD, BAND_TILE.TD_KEY)}>
              {t("cell_scanner.calculator.result.range_mhz_label")}
            </td>
            <td className={cn(BAND_TILE.TD, BAND_TILE.TD_VALUE)}>
              {rangeMhz(band.dlLow, band.dlHigh)}
            </td>
            {hasUplink ? (
              <td className={cn(BAND_TILE.TD, BAND_TILE.TD_VALUE)}>
                {rangeMhz(band.ulLow, band.ulHigh)}
              </td>
            ) : null}
          </tr>
          <tr>
            <td className={cn(BAND_TILE.TD, BAND_TILE.TD_KEY)}>
              {t(CHANNEL_LABEL_KEY[networkType])}
            </td>
            <td className={cn(BAND_TILE.TD, BAND_TILE.TD_VALUE)}>
              {channel}{" "}
              <span className={BAND_TILE.OF_RANGE}>
                {ofRange(band.channelRange[0], band.channelRange[1])}
              </span>
            </td>
            {hasUplink && ulRange ? (
              <td className={cn(BAND_TILE.TD, BAND_TILE.TD_VALUE)}>
                {band.ulChannel}{" "}
                <span className={BAND_TILE.OF_RANGE}>
                  {ofRange(ulRange[0], ulRange[1])}
                </span>
              </td>
            ) : null}
          </tr>
          <tr>
            <td className={cn(BAND_TILE.TD, BAND_TILE.TD_KEY)}>
              {t("cell_scanner.calculator.result.in_band")}
            </td>
            <td className={BAND_TILE.TD} colSpan={hasUplink ? 2 : 1}>
              <div
                className={BAND_TILE.POSITION_TRACK}
                role="img"
                aria-label={t("cell_scanner.calculator.result.position_aria", {
                  pct,
                })}
              >
                <span
                  className={cn(BAND_TILE.POSITION_DOT, ink.bg)}
                  style={{ left: `${pct}%` }}
                />
              </div>
            </td>
          </tr>
          {hasUplink ? null : (
            <tr className={BAND_TILE.NOTE_ROW}>
              <td className={BAND_TILE.TD_NOTE} colSpan={2}>
                {uplinkNote}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </motion.div>
  );
}

export function BandTiles({ result }: { result: CalculationResult }) {
  const { t } = useTranslation("cellular");
  const agreement = bandAgreement(result.bands);
  const verdict = agreement === "single" ? null : AGREEMENT[agreement];

  return (
    <div className="flex flex-col gap-4">
      <div className={BAND_TILE.WELL}>
        <motion.div
          key={`${result.networkType}:${result.channel}`}
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          {result.bands.map((band) => (
            <BandSection
              key={`${result.networkType}-${band.band}`}
              band={band}
              networkType={result.networkType}
              channel={result.channel}
            />
          ))}
        </motion.div>
      </div>

      {verdict ? (
        <p className={cn(VERDICT.ROOT, VERDICT_TONE[verdict.tone])}>
          <MaterialSymbol
            name={verdict.glyph}
            size={18}
            filled
            className="mt-px flex-none"
          />
          <span className={VERDICT.TEXT}>
            {t(verdict.key, { count: result.bands.length })}
          </span>
        </p>
      ) : null}
    </div>
  );
}
