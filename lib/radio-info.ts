// =============================================================================
// radio-info.ts — view model for the /cellular/ Radio Information page
// =============================================================================
// A PURE module: no React, no hooks, no JSX, no imports from components/.
// Everything the page renders is derived here so the components stay a
// rendering of a decision rather than the place the decision is made.
//
// It composes the existing helpers rather than re-deriving anything:
//   lib/carrier-aggregation.ts — role assignment + release reconciliation
//   lib/earfcn.ts             — ARFCN → frequency, band names, duplex, SCS
//   types/modem-status.ts     — signal thresholds + quality bucketing
// =============================================================================

import type {
  ModemStatus,
  SignalQuality,
} from "@/types/modem-status";
import {
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
  getSignalQuality,
  normalizeMetricValue,
  signalToProgress,
  worstSignalQuality,
} from "@/types/modem-status";
import type { CarrierRole, ResolvedCarrier } from "@/lib/carrier-aggregation";
import { carrierKey, releasedForMs } from "@/lib/carrier-aggregation";
import {
  NR_BANDS,
  findAllMatchingNRBands,
  getBandName,
  getDLFrequency,
  getDuplexMode,
  getULFrequency,
  parseBandNumber,
  suggestNRSCS,
} from "@/lib/earfcn";

// =============================================================================
// Page mode
// =============================================================================

export type RadioMode =
  | "loading" // no data yet
  | "no-sim" // service_status === "sim_error"
  | "no-service" // service_status === "no_service", or cfun === 0/4 (RF off)
  | "searching" // service_status === "searching"
  | "registered-lte" // network.type === "LTE"
  | "registered-nsa" // network.type === "5G-NSA"
  | "registered-sa" // network.type === "5G-SA"
  | "unknown"; // network.type === "" or unrecognised

/**
 * Single source of truth for what the page renders. Mirrors the shipped
 * `resolveBodyMode()` pattern in components/public/overview/states: one
 * function owns the branch order, so a header, a body and a footer can never
 * disagree about which state the radio is in.
 *
 * Order is load-bearing. A missing SIM outranks "no service" because it is the
 * cause; RF-off outranks "searching" because a radio that is off is not
 * looking for anything.
 */
export function resolveRadioMode(
  data: ModemStatus | null | undefined,
  isLoading: boolean,
): RadioMode {
  // No snapshot means "nothing to show yet" whether or not a fetch is in
  // flight, so `isLoading` deliberately does not branch here. A failed first
  // fetch must not resolve to `no-service`: that would blame the radio for a
  // transport problem, on the one page a technician opens to tell those apart.
  // The param stays because the shell passes it and the signature is shared.
  void isLoading;
  if (!data) return "loading";

  const network = data.network;
  if (!network) return "loading";

  if (network.service_status === "sim_error") return "no-sim";

  // AT+CFUN? 0 = minimum functionality, 4 = RF off (airplane). Either way the
  // radio is not transmitting, which is a different story from "no coverage".
  if (network.cfun === 0 || network.cfun === 4) return "no-service";
  if (network.service_status === "no_service") return "no-service";
  if (network.service_status === "searching") return "searching";

  switch (network.type) {
    case "LTE":
      return "registered-lte";
    case "5G-NSA":
      return "registered-nsa";
    case "5G-SA":
      return "registered-sa";
    default:
      return "unknown";
  }
}

// =============================================================================
// Metrics
// =============================================================================

export type MetricId = "rsrp" | "rsrq" | "sinr" | "rssi";

export interface RadioMetric {
  id: MetricId;
  /** i18n key suffix, NOT display text. e.g. "rsrp". The component calls t(). */
  labelKey: string;
  value: number | null;
  unit: "dBm" | "dB";
  /** 0-100 for a MetricBar, or null when value is null. */
  percent: number | null;
  quality: SignalQuality;
  /** true when this metric has no bar and renders as a plain value row (RSSI). */
  barless: boolean;
}

/**
 * A null value is NOT a zero percent. An empty bar reads as "signal is zero",
 * which is a lie about a metric the radio simply did not report — and SCCs
 * routinely report only a subset. `percent: null` lets the component say
 * "not reported" instead.
 */
function buildMetrics(carrier: ResolvedCarrier): RadioMetric[] {
  // Normalize ONCE, at the top, then read only the normalized locals below.
  // The three channels a metric renders through — the printed number, the bar
  // and the quality chip — have to agree, and the only way to guarantee that is
  // for them to be derived from the same value rather than from the same field.
  //
  // This is where AT+QCAINFO's raw LTE RSSNR gets caught: field 10 arrives as
  // 251 on a carrier whose real SINR is 8 dB (see METRIC_RANGES for the live
  // capture). Before this, `value` printed "251", `percent` clamped to a full
  // bar and `quality` said "excellent" — three channels agreeing loudly on a
  // number the radio never measured.
  const rsrp = normalizeMetricValue(carrier.rsrp, "rsrp");
  const rsrq = normalizeMetricValue(carrier.rsrq, "rsrq");
  const sinr = normalizeMetricValue(carrier.sinr, "sinr");

  const metrics: RadioMetric[] = [
    {
      id: "rsrp",
      labelKey: "rsrp",
      value: rsrp,
      unit: "dBm",
      // signalToProgress, NOT rsrpToPercent: the RSRQ and SINR rows below
      // already length on the shared quality window, and RSRP colouring its
      // numeral from RSRP_THRESHOLDS while lengthing its bar on the
      // carrier-aggregation scale (-125..-65) made it the last surviving
      // rival RSRP scale — -80 dBm drew 100% on band-locking and 75% here.
      // rsrpToPercent survives only for components/dashboard/carrier-
      // aggregation.tsx, which plots it under its own documented convention.
      percent: rsrp === null ? null : signalToProgress(rsrp, RSRP_THRESHOLDS),
      quality: getSignalQuality(rsrp, RSRP_THRESHOLDS),
      barless: false,
    },
    {
      id: "rsrq",
      labelKey: "rsrq",
      value: rsrq,
      unit: "dB",
      percent: rsrq === null ? null : signalToProgress(rsrq, RSRQ_THRESHOLDS),
      quality: getSignalQuality(rsrq, RSRQ_THRESHOLDS),
      barless: false,
    },
    {
      id: "sinr",
      labelKey: "sinr",
      value: sinr,
      unit: "dB",
      percent: sinr === null ? null : signalToProgress(sinr, SINR_THRESHOLDS),
      quality: getSignalQuality(sinr, SINR_THRESHOLDS),
      barless: false,
    },
  ];

  // RSSI is per-carrier AND LTE-only: AT+QCAINFO's NR lines carry no RSSI field
  // at all, so every NR component reports null. Emitting the row anyway would
  // invent a permanently-empty metric. It is also barless — RSSI has no
  // meaningful 0-100 scale to plot against.
  // RSSI takes the same range guard even though it has no quality verdict to
  // corrupt: an out-of-range RSSI would still PRINT, and a printed number is a
  // claim regardless of whether a chip sits next to it.
  const rssi = normalizeMetricValue(carrier.rssi, "rssi");
  if (carrier.technology === "LTE" && rssi !== null) {
    metrics.push({
      id: "rssi",
      labelKey: "rssi",
      value: rssi,
      unit: "dBm",
      percent: null,
      quality: "none",
      barless: true,
    });
  }

  return metrics;
}

// =============================================================================
// Carriers
// =============================================================================

export interface EnrichedCarrier {
  key: string; // carrierKey() — NEVER an array index or PCI
  technology: "LTE" | "NR";
  band: string; // "B3" | "N41"
  role: CarrierRole; // "pcc" | "nr-anchor" | "scc"
  /** i18n key suffix: "pcc" | "anchor" | "scc". Component renders t() + sccIndex. */
  roleKey: string;
  sccIndex: number | null; // 1-based ordinal among SCCs, else null
  earfcn: number | null;
  /**
   * i18n key suffix under `radio_info.bands.detail.*`: "arfcn" for NR,
   * "earfcn" for LTE. Same shape as `roleKey` above — the component renders
   * `t()`, this file never holds display text.
   *
   * It USED to be the literal "ARFCN" / "EARFCN" while its own comment claimed
   * to be "a label discriminator, not display text". It was rendered verbatim,
   * so one hardcoded English word sat on the same line as a translated `PCI`
   * label in all five locales.
   */
  arfcnLabelKey: "arfcn" | "earfcn";
  duplex: "FDD" | "TDD" | null;
  bandwidthMhz: number | null; // null when 0 / unrecognised enum
  pci: number | null;
  bandName: string | null;
  dlFrequencyMhz: number | null;
  ulFrequencyMhz: number | null;
  scsKhz: number | null; // see the SCS rule below
  scsInferred: boolean; // true when scsKhz came from suggestNRSCS
  quality: SignalQuality; // worst across available metrics
  metrics: RadioMetric[]; // ordered; RSSI last and LTE-only
  released: boolean; // from reconcileCarriers
  releasedForMs: number | null;
}

const ROLE_KEYS: Record<CarrierRole, string> = {
  pcc: "pcc",
  "nr-anchor": "anchor",
  scc: "scc",
};

/**
 * Resolve the SCS for an NR carrier.
 *
 * Only ONE carrier can honestly claim a reported SCS: `carrier_components[]`
 * has no `scs` key at all, and the only value the modem gives us is `nr.scs`,
 * which describes the SERVING NR cell. So the carrier whose ARFCN matches the
 * serving NR ARFCN gets the reported value; every other NR carrier gets a value
 * inferred from its band's duplex mode, flagged so the UI can say so. Showing
 * an inference as if the modem reported it would be the page lying quietly.
 */
function inferScs(band: string, earfcn: number | null): number | null {
  const bandNum = parseBandNumber(band);
  const entry =
    (bandNum !== null ? NR_BANDS.find((b) => b.band === bandNum) : undefined) ??
    (earfcn !== null ? findAllMatchingNRBands(earfcn)[0] : undefined);
  return entry ? suggestNRSCS(entry) : null;
}

/** getDuplexMode returns "FDD" | "TDD" | "SDL" | ""; the view model carries only
 *  the two the page renders, and treats SDL/unknown as "not applicable". */
function normaliseDuplex(band: string, technology: "LTE" | "NR"): "FDD" | "TDD" | null {
  const duplex = getDuplexMode(band, technology);
  return duplex === "FDD" || duplex === "TDD" ? duplex : null;
}

export function enrichCarriers(
  resolved: ResolvedCarrier[],
  networkType: string,
  nrArfcn: number | null,
  nrScs: number | null,
  /**
   * Browser wall-clock ms at which the snapshot behind `resolved` arrived, used
   * only for the `releasedForMs` reading.
   *
   * A parameter rather than a `Date.now()` call in here, and the reason is worth
   * keeping: this function is called from a component's render path, so reading
   * a clock inside it made the same mistake `react-hooks/purity` flags at a call
   * site — except the rule never reported it, because it analyses Component and
   * Hook bodies and does not trace into ordinary helpers they call. Taking the
   * clock as an argument is what makes that impossible rather than merely
   * unreported, and it means the release DECISION (made by `reconcileCarriers`)
   * and the release LABEL (made here) are measured against the same instant.
   */
  nowMs: number,
): EnrichedCarrier[] {
  void networkType; // roles are already assigned upstream by assignRoles()

  let sccSeen = 0;

  return resolved.map((carrier) => {
    const isScc = carrier.role === "scc";
    const sccIndex = isScc ? ++sccSeen : null;

    // bandwidth_mhz === 0 means "unrecognised enum", not "zero width". Keeping
    // it as 0 would put a stray "+ 0" in the breakdown caption and drag the
    // aggregate down as if a real carrier contributed nothing.
    const bandwidthMhz = carrier.bandwidth_mhz > 0 ? carrier.bandwidth_mhz : null;

    let scsKhz: number | null = null;
    let scsInferred = false;
    if (carrier.technology === "NR") {
      if (
        nrScs !== null &&
        nrArfcn !== null &&
        carrier.earfcn !== null &&
        carrier.earfcn === nrArfcn
      ) {
        scsKhz = nrScs;
        scsInferred = false;
      } else {
        scsKhz = inferScs(carrier.band, carrier.earfcn);
        scsInferred = scsKhz !== null;
      }
    }

    const metrics = buildMetrics(carrier);
    const bandName = getBandName(carrier.band, carrier.technology);

    return {
      key: carrier.key || carrierKey(carrier),
      technology: carrier.technology,
      band: carrier.band,
      role: carrier.role,
      roleKey: ROLE_KEYS[carrier.role],
      sccIndex,
      earfcn: carrier.earfcn,
      // carrier_components[].earfcn carries the NR-ARFCN for NR components under
      // an LTE-sounding key. The field keeps its name; only the label is fixed.
      arfcnLabelKey: carrier.technology === "NR" ? "arfcn" : "earfcn",
      duplex: normaliseDuplex(carrier.band, carrier.technology),
      bandwidthMhz,
      pci: carrier.pci,
      bandName: bandName || null,
      dlFrequencyMhz: getDLFrequency(carrier.earfcn, carrier.technology),
      ulFrequencyMhz: getULFrequency(carrier.earfcn, carrier.technology, carrier.band),
      scsKhz,
      scsInferred,
      // Worst-of, never best-of: excellent RSRP alongside poor SINR is a poor
      // carrier. Metrics with no value are skipped rather than counted as bad.
      quality: worstSignalQuality(...metrics.map((m) => m.quality)),
      metrics,
      released: carrier.released,
      releasedForMs: carrier.released ? releasedForMs(carrier, nowMs) : null,
    };
  });
}

// =============================================================================
// Summary
// =============================================================================

export interface RadioSummary {
  carrierCount: number;
  lteCount: number;
  nrCount: number;
  totalMhz: number | null;
  /** Per-carrier widths in list order, for the "15 + 20 + 60" caption. */
  breakdownMhz: number[];
  endc: boolean;
}

/**
 * Counts come from `carrier_components[].technology`, NEVER from `ca_count` /
 * `nr_ca_count`. Those are SECONDARY-carrier counts with an NSA minus-one rule,
 * and a live link with a real NR carrier has been observed reporting
 * `nr_ca_count: 0`. Grouping the array is the only honest count.
 *
 * Released carriers stay on screen but are excluded from every number here —
 * the aggregate describes what the radio has right now.
 */
export function summariseRadio(carriers: EnrichedCarrier[]): RadioSummary {
  const active = carriers.filter((c) => !c.released);

  const lteCount = active.filter((c) => c.technology === "LTE").length;
  const nrCount = active.filter((c) => c.technology === "NR").length;

  // A null width is an unrecognised enum, not a zero-width carrier: it is left
  // out of the breakdown entirely rather than printed as "+ 0".
  const breakdownMhz = active
    .map((c) => c.bandwidthMhz)
    .filter((mhz): mhz is number => mhz !== null);

  const totalMhz = breakdownMhz.length
    ? breakdownMhz.reduce((sum, mhz) => sum + mhz, 0)
    : null;

  return {
    carrierCount: active.length,
    lteCount,
    nrCount,
    totalMhz,
    breakdownMhz,
    // EN-DC is dual connectivity: both legs carrying traffic at once.
    endc: lteCount > 0 && nrCount > 0,
  };
}

// =============================================================================
// Diagnostics clipboard payload
// =============================================================================

const ROLE_LABEL: Record<CarrierRole, string> = {
  pcc: "PCC",
  "nr-anchor": "ANCHOR",
  scc: "SCC",
};

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/**
 * Clipboard payload. Radio metrics ONLY.
 *
 * Deliberately excludes IMEI, ICCID, WAN IPv4/IPv6, DNS, Cell ID, eNodeB,
 * Sector, TAC and APN. The whole point of the button is that the result can be
 * pasted into a public forum without the user having to audit it first, so this
 * payload does not widen — anything identifying stays out.
 */
export function buildDiagnosticsText(input: {
  networkType: string;
  operator: string;
  summary: RadioSummary;
  carriers: EnrichedCarrier[];
  timestampIso: string;
}): string {
  const { networkType, operator, summary, carriers, timestampIso } = input;

  const lines: string[] = [
    "QManager radio diagnostics",
    timestampIso,
    "",
    `Network: ${networkType || "-"}   Operator: ${operator || "-"}`,
    `Aggregate: ${summary.totalMhz ?? "-"} MHz / ${summary.carrierCount} carriers (LTE ${summary.lteCount}, NR ${summary.nrCount})`,
  ];

  for (const c of carriers) {
    const role =
      c.role === "scc" && c.sccIndex !== null
        ? `SCC ${c.sccIndex}`
        : ROLE_LABEL[c.role];

    const head = [
      pad(role, 6),
      pad(c.technology, 4),
      pad(c.band, 6),
      // The clipboard blob is a deliberately English, fixed-width machine
      // payload for a forum post or a support ticket — it does not go through
      // `t()`. So the key maps back to a literal HERE, at the one call site
      // that wants display text, rather than the contract carrying one.
      pad(
        `${c.arfcnLabelKey === "arfcn" ? "ARFCN" : "EARFCN"} ${c.earfcn ?? "-"}`,
        15,
      ),
      pad(c.bandwidthMhz !== null ? `BW ${c.bandwidthMhz} MHz` : "BW -", 12),
      c.pci !== null ? `PCI ${c.pci}` : "PCI -",
    ].join(" ");

    // Omit metrics with no value rather than printing "null".
    const metrics = c.metrics
      .filter((m) => m.value !== null)
      // SINR is labelled SNR on an NR carrier — that is what the 5G spec calls it.
      .map((m) => {
        const label =
          m.id === "sinr" && c.technology === "NR" ? "SNR" : m.id.toUpperCase();
        return pad(`${label} ${m.value} ${m.unit}`, 14);
      })
      .join(" ")
      .trimEnd();

    lines.push(head.trimEnd());
    if (metrics) lines.push(`  ${metrics}`);
  }

  if (carriers.length === 0) lines.push("No carriers reported.");

  return lines.join("\n");
}
