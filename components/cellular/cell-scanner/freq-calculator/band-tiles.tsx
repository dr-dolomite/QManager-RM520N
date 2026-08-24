"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  BAND_TILE,
  FIGURE,
  IDENT,
  VERDICT,
  VERDICT_TONE,
  type VerdictTone,
} from "../shapes";
import {
  type BandAgreement,
  type CalculationResult,
  type MatchingBand,
  type NetworkType,
  bandAgreement,
} from "./calc-model";

// =============================================================================
// The matching bands, as a grid of peer tiles
// =============================================================================
// THE CASCADE IS BOUNDED BY THE ANSWER, NOT BY THE PAGE. These tiles mount on a
// swap — long after the page's own entrance clock has settled — so this
// container declares `initial` and `animate` rather than inheriting them. A
// variants-only child mounting on a swap stays pinned at `hidden` forever,
// which is the failure mode that renders a complete DOM at zero opacity and
// passes every checker. Same reason `scan-table.tsx` declares them on its body.
//
// It uses the ROW cascade (80ms step, 5px rise), not the card one: these are
// siblings inside a single card, sitting a few pixels apart, and a 10px lift
// would move each tile past its neighbour's resting position and read as the
// card reflowing rather than as answers arriving.
//
// `key` on the container is the channel, so a NEW calculation replays the
// cascade. Without it React reconciles four tiles into four tiles and the
// second answer arrives with no motion at all — the exact case where the reader
// most needs to see that something happened.
// =============================================================================

export const BAND_LABEL_KEY = {
  LTE: "cell_scanner.calculator.result.band_lte",
  NR: "cell_scanner.calculator.result.band_nr",
} as const satisfies Record<NetworkType, string>;

const CHANNEL_RANGE_KEY = {
  LTE: "cell_scanner.calculator.result.earfcn_range",
  NR: "cell_scanner.calculator.result.nrarfcn_range",
} as const satisfies Record<NetworkType, string>;

/**
 * The agreement verdict, keyed literally so `i18n:check` can see it.
 *
 * `single` is absent on purpose — one band gets no verdict, because a line
 * saying "1 band matched" under a list of one is noise the reader has to read
 * before discovering it says nothing.
 */
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className={BAND_TILE.KEY}>{label}</dt>
      <dd className={BAND_TILE.VALUE}>{children}</dd>
    </>
  );
}

function BandTile({
  band,
  networkType,
}: {
  band: MatchingBand;
  networkType: NetworkType;
}) {
  const { t } = useTranslation("cellular");

  const mhz = (value: string | number) =>
    t("cell_scanner.calculator.units.mhz", { value });
  const rangeMhz = (low: string | number, high: string | number) =>
    t("cell_scanner.calculator.units.range_mhz", { low, high });

  return (
    <motion.div variants={staggerRowItem} className={BAND_TILE.ROOT}>
      <div className={BAND_TILE.HEAD}>
        <span className={BAND_TILE.BAND}>
          {t(BAND_LABEL_KEY[networkType], { band: band.band })}
        </span>
        <span className={BAND_TILE.NAME}>{band.name}</span>
      </div>

      <dl className={BAND_TILE.LIST}>
        <Row label={t("cell_scanner.calculator.result.duplex")}>
          {band.duplexType}
        </Row>

        <Row label={t("cell_scanner.calculator.result.dl_frequency")}>
          <span className={FIGURE}>{mhz(band.dlFrequency)}</span>
        </Row>

        <Row label={t("cell_scanner.calculator.result.ul_frequency")}>
          {band.ulFrequency === null ? (
            <span className="text-on-surface-variant">
              {t("cell_scanner.calculator.result.downlink_only")}
            </span>
          ) : (
            <span className={FIGURE}>{mhz(band.ulFrequency)}</span>
          )}
        </Row>

        <Row label={t("cell_scanner.calculator.result.downlink_range")}>
          <span className={IDENT}>{rangeMhz(band.dlLow, band.dlHigh)}</span>
        </Row>

        {band.duplexType === "FDD" ? (
          <Row label={t("cell_scanner.calculator.result.uplink_range")}>
            <span className={IDENT}>{rangeMhz(band.ulLow, band.ulHigh)}</span>
          </Row>
        ) : null}

        <Row label={t(CHANNEL_RANGE_KEY[networkType])}>
          <span className={IDENT}>
            {t("cell_scanner.calculator.units.range", {
              low: band.channelRange[0],
              high: band.channelRange[1],
            })}
          </span>
        </Row>

        {band.ulChannel !== null ? (
          <Row label={t("cell_scanner.calculator.result.ul_earfcn")}>
            <span className={IDENT}>{band.ulChannel}</span>
          </Row>
        ) : null}
      </dl>
    </motion.div>
  );
}

export function BandTiles({ result }: { result: CalculationResult }) {
  const { t } = useTranslation("cellular");
  const agreement = bandAgreement(result.bands);
  const verdict = agreement === "single" ? null : AGREEMENT[agreement];

  return (
    <div className="flex flex-col gap-4">
      <motion.div
        key={`${result.networkType}:${result.channel}`}
        variants={staggerRows}
        initial="hidden"
        animate="visible"
        className={BAND_TILE.GRID}
      >
        {result.bands.map((band) => (
          <BandTile
            key={`${result.networkType}-${band.band}`}
            band={band}
            networkType={result.networkType}
          />
        ))}
      </motion.div>

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
