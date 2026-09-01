import type { TFunction } from "i18next";

import type { LteStatus, NrStatus } from "@/types/modem-status";
import {
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
} from "@/types/modem-status";

import {
  ABSENT,
  type RadioFamily,
  type SignalStatusRow,
} from "./signal-status-card";

// =============================================================================
// The signal pair's row builder
// =============================================================================
// This replaces `nr-status.tsx` and `lte-status.tsx`, which were two components
// that rendered nothing. Each mapped one poller block to `SignalStatusRow[]`
// and forwarded the same six props to `SignalStatusCard`; the only differences
// were which block they read and which labels they used. A component whose
// entire body is "map this object to that prop bundle" is a function wearing a
// component's costume, and two of them side by side are two copies of one
// function.
//
// The line count is not the point. What the two copies were carrying:
//
//   · the three threshold sets, imported twice,
//   · the absent-value formatter, written twice,
//   · and — the reason this arrived in the same commit as the no-reading
//     state — a state that would otherwise have had to be authored twice and
//     kept in step by hand.
//
// THE TWO LEGS ARE NOT THE SAME LIST, so this branches on `family` rather than
// pretending they are and reading through an optional field. NR carries SCS and
// no RSSI; LTE carries RSSI and no SCS; and their channel numbers are different
// quantities with different names (ARFCN vs EARFCN), not one field spelled two
// ways. The measurement trio in the middle IS shared, and it is shared by
// construction here rather than by two authors happening to agree.
//
// ROW ORDER IS PART OF THE CONTRACT. `TickGroup` ranks the values that moved
// this poll by their live DOM position, and the card's row grid has no
// `grid-cols-*`, so document order IS reading order. Identity first, then the
// channel and cell identifiers, then the measurements. Do not reorder to make
// the two legs symmetrical — LTE's RSSI sits with the measurements because it
// is one, and NR's SCS sits last because it is an identifier.
// =============================================================================

/**
 * What the card needs to render one leg of the pair.
 *
 * The title comes back with the rows rather than being derived a second time at
 * the call site: it is a function of `family` exactly like the rows are, and
 * two places deriving it is two places to translate it.
 */
export interface SignalCardModel {
  title: string;
  state: string;
  rsrp: number | null;
  rows: SignalStatusRow[];
}

/**
 * Formats a measurement for display, or the shared absent sentinel.
 *
 * `ABSENT` rather than a hyphen, and an em dash rather than a hyphen-minus: a
 * hyphen is a joiner that happens to be on the keyboard, and beside a column of
 * right-aligned figures it reads as a minus sign with its digits missing. The
 * sentinel is imported rather than spelled, because the card's identity-pill
 * guard has to recognise the same string — a pill wrapping a placeholder reads
 * as a broken chip, so the guard falls back to plain ink, and a builder and a
 * guard that disagree about the placeholder ship exactly the broken chip the
 * guard exists to prevent.
 */
function fmt(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return ABSENT;
  return `${value} ${unit}`;
}

export function buildSignalRows(
  family: "nr",
  data: NrStatus | null,
  t: TFunction,
): SignalCardModel;
export function buildSignalRows(
  family: "lte",
  data: LteStatus | null,
  t: TFunction,
): SignalCardModel;
export function buildSignalRows(
  family: RadioFamily,
  data: NrStatus | LteStatus | null,
  t: TFunction,
): SignalCardModel {
  // The overloads above are what the call sites see, and they are what keeps
  // `family` and `data` from being mixed up. Inside the implementation the
  // parameter is necessarily the union, so each branch narrows once, by hand,
  // against the family it just tested.
  const band = data?.band || ABSENT;

  // `thresholds` is what marks a row as a MEASUREMENT — a row that has a
  // position on the quality scale, whether or not this poll found one. The card
  // reads it as a property of the row, never of the reading; that split is the
  // whole of the no-reading state. A row with no `thresholds` is an identifier
  // and must never be tinted, gauged or announced with a quality word.
  const measurements = (source: {
    rsrp: number | null;
    rsrq: number | null;
    sinr: number | null;
  }): SignalStatusRow[] => [
    {
      label: t("signal_status.rsrp"),
      value: fmt(source.rsrp, "dBm"),
      rawValue: source.rsrp,
      thresholds: RSRP_THRESHOLDS,
    },
    {
      label: t("signal_status.rsrq"),
      value: fmt(source.rsrq, "dB"),
      rawValue: source.rsrq,
      thresholds: RSRQ_THRESHOLDS,
    },
    {
      label: t("signal_status.sinr"),
      value: fmt(source.sinr, "dB"),
      rawValue: source.sinr,
      thresholds: SINR_THRESHOLDS,
    },
  ];

  const trio = measurements({
    rsrp: data?.rsrp ?? null,
    rsrq: data?.rsrq ?? null,
    sinr: data?.sinr ?? null,
  });

  if (family === "nr") {
    const nr = data as NrStatus | null;
    return {
      title: t("signal_status.nr_primary_title"),
      state: nr?.state ?? "unknown",
      rsrp: nr?.rsrp ?? null,
      rows: [
        { label: t("signal_status.band"), value: band, asIdentity: true },
        {
          label: t("signal_status.arfcn"),
          value: nr?.arfcn?.toString() ?? ABSENT,
          isIdentifier: true,
        },
        {
          label: t("signal_status.pci"),
          value: nr?.pci?.toString() ?? ABSENT,
          isIdentifier: true,
        },
        ...trio,
        // Subcarrier spacing is a configuration of the carrier, not a reading
        // off it — 30 kHz is not better or worse than 15. Identifier, last.
        {
          label: t("signal_status.scs"),
          value: fmt(nr?.scs, "kHz"),
          isIdentifier: true,
        },
      ],
    };
  }

  const lte = data as LteStatus | null;
  return {
    title: t("signal_status.lte_primary_title"),
    state: lte?.state ?? "unknown",
    rsrp: lte?.rsrp ?? null,
    rows: [
      { label: t("signal_status.band"), value: band, asIdentity: true },
      {
        label: t("signal_status.earfcn"),
        value: lte?.earfcn?.toString() ?? ABSENT,
        isIdentifier: true,
      },
      {
        label: t("signal_status.pci"),
        value: lte?.pci?.toString() ?? ABSENT,
        isIdentifier: true,
      },
      ...trio.slice(0, 2),
      // RSSI is a measurement, and it sits between RSRQ and SINR exactly where
      // it shipped. It carries NO threshold set, and that is deliberate rather
      // than an omission: total received power including noise and interference
      // has no good-or-bad reading on its own — a strong RSSI beside a weak
      // RSRQ is a congested cell, not a healthy one. Untinted, ungauged, and
      // announced with no quality word.
      { label: t("signal_status.rssi"), value: fmt(lte?.rssi, "dBm") },
      ...trio.slice(2),
    ],
  };
}
