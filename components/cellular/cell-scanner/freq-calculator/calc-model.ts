// =============================================================================
// calc-model — the calculator's types and its arithmetic, with no copy in them
// =============================================================================
// Everything here is PURE and TOTAL. It is the same split `summaries.ts` makes
// for the two scanning routes: derivation lives away from the render body, and
// nothing in this file has ever seen `t`.
//
// THE ERRORS ARE CODES, NOT SENTENCES. This module used to live inside the
// render file and returned `{ error: "Please enter a valid number" }` — an
// English sentence smuggled through React state into the DOM, invisible to
// `bun run i18n:check` because no key was ever involved. Anything user-visible
// leaves here as a code and is mapped to a LITERAL key at the call site.
//
// THE MODEL KNOWS WHAT IT DOES NOT KNOW. A channel number does not uniquely
// identify a band: NR-ARFCN 528030 sits inside n7 (FDD) and n41 (TDD) at once,
// and those two disagree about where the uplink is — not by a rounding step, by
// 120 MHz and a duplex scheme. `bandAgreement` exists so the surface can say so
// instead of picking the first match and presenting it as the answer.
// =============================================================================

import {
  type LTEBandEntry,
  type NRBandEntry,
  LTE_BANDS,
  NR_BANDS,
  findAllMatchingLTEBands,
  findAllMatchingNRBands,
  lteDLFrequency,
  lteULEarfcn,
  lteULFrequency,
  nrArfcnToFrequency,
  nrULFrequency,
} from "@/lib/earfcn";

// --- Auto-detection boundaries (derived from the shared band tables) ----------

export const MAX_LTE_EARFCN = Math.max(...LTE_BANDS.map((b) => b.earfcnRange[1]));
export const MIN_NR_ARFCN = Math.min(...NR_BANDS.map((b) => b.nrarfcnRange[0]));

/**
 * The spec citations are PROPER NOUNS. They live in code rather than in the five
 * locale files so a translator cannot accidentally localise a clause number —
 * `t()` receives the surrounding sentence and interpolates these verbatim.
 */
export const NR_SPEC = "3GPP TS 38.104 Section 5.4.2.1";
export const LTE_SPEC = "3GPP TS 36.101 Section 5.7";

// --- Types -------------------------------------------------------------------

export type NetworkType = "LTE" | "NR";

export type CalcMode = "auto" | "lte" | "nr";

export type MatchingBand = {
  band: number;
  name: string;
  duplexType: "FDD" | "TDD" | "SDL";
  /** Band edges — fixed facts about the band, not about the input. */
  dlLow: number;
  dlHigh: number;
  ulLow: number;
  ulHigh: number;
  /** The band's own channel range, [min, max]. */
  channelRange: [number, number];
  /** Derived from the input, per THIS band. */
  dlFrequency: string;
  /** `null` for SDL, which has no uplink at all. */
  ulFrequency: string | null;
  /** LTE FDD/TDD only — NR has no separate uplink channel number. */
  ulChannel: number | null;
};

export type CalculationResult = {
  networkType: NetworkType;
  channel: number;
  /**
   * The downlink frequency, in MHz.
   *
   * Safe to hold at the top level even when several bands match: LTE EARFCN
   * ranges are disjoint (so there is never more than one), and the NR downlink
   * frequency comes from the GLOBAL raster in TS 38.104 §5.4.2.1, which is a
   * function of the ARFCN alone. Two NR bands claiming one ARFCN agree about
   * the downlink and disagree about everything else — see `bandAgreement`.
   */
  frequency: string;
  bands: MatchingBand[];
};

/** A machine-readable failure. Rendered through a literal key, never as prose. */
export type CalcErrorCode =
  | "empty"
  | "not_a_number"
  | "negative"
  | "auto_gap"
  | "no_band"
  | "unexpected";

export type CalcError = { code: CalcErrorCode; detail?: string };

export type HistoryEntry = {
  networkType: NetworkType;
  channel: number;
  frequency: string;
  bands: number[];
  timestamp: string;
  id: string;
};

/**
 * What the matching bands do and do not agree on.
 *
 * `"single"` is the ordinary case and gets no verdict at all — a vacuous "1
 * band matched" line under a list of one is noise. `"agree"` and `"conflict"`
 * are both worth saying, and they are worth saying differently: several bands
 * sharing a channel and a duplex scheme is a curiosity, while several bands
 * disagreeing about duplex means the uplink shown below is only correct for
 * whichever band the network actually uses.
 */
export type BandAgreement = "single" | "agree" | "conflict";

export function bandAgreement(bands: MatchingBand[]): BandAgreement {
  if (bands.length <= 1) return "single";
  const first = bands[0].duplexType;
  return bands.every((b) => b.duplexType === first) ? "agree" : "conflict";
}

// --- LTE ---------------------------------------------------------------------

function toLTEBand(entry: LTEBandEntry, earfcn: number): MatchingBand {
  const dlFreq = lteDLFrequency(earfcn) ?? entry.dlLow;
  const ulFreq = lteULFrequency(earfcn);

  // The band's high edge, from its own EARFCN range rather than from the input.
  const rangeSpan = (entry.earfcnRange[1] - entry.earfcnOffset) * entry.spacing;
  const dlHigh = Math.round((entry.dlLow + rangeSpan) * 10) / 10;
  const ulHigh =
    entry.duplexType === "SDL"
      ? 0
      : entry.duplexType === "TDD"
        ? dlHigh
        : Math.round((entry.ulLow + rangeSpan) * 10) / 10;

  return {
    band: entry.band,
    name: entry.name,
    duplexType: entry.duplexType,
    dlLow: entry.dlLow,
    dlHigh,
    ulLow: entry.ulLow,
    ulHigh,
    channelRange: entry.earfcnRange,
    dlFrequency: dlFreq.toFixed(2),
    ulFrequency: ulFreq !== null ? ulFreq.toFixed(2) : null,
    ulChannel: lteULEarfcn(entry, earfcn),
  };
}

// --- NR ----------------------------------------------------------------------

function toNRBand(entry: NRBandEntry, nrarfcn: number, dlFreq: number): MatchingBand {
  const ulFreq = nrULFrequency(nrarfcn, entry.band);

  const dlHigh = nrArfcnToFrequency(entry.nrarfcnRange[1]) ?? entry.dlLow;
  const bandwidth = dlHigh - entry.dlLow;
  const ulHigh =
    entry.duplexType === "SDL"
      ? 0
      : entry.duplexType === "TDD"
        ? dlHigh
        : entry.ulLow + bandwidth;

  return {
    band: entry.band,
    name: entry.name,
    duplexType: entry.duplexType,
    dlLow: entry.dlLow,
    dlHigh: Math.round(dlHigh * 100) / 100,
    ulLow: entry.ulLow,
    ulHigh: Math.round(ulHigh * 100) / 100,
    channelRange: entry.nrarfcnRange,
    dlFrequency: dlFreq.toFixed(2),
    ulFrequency: ulFreq !== null ? ulFreq.toFixed(2) : null,
    // NR numbers the uplink on the same global raster as the downlink; there is
    // no second channel number to show, unlike LTE's N_Offs-UL.
    ulChannel: null,
  };
}

// --- Dispatch ----------------------------------------------------------------

function calculateLTE(earfcn: number): CalculationResult | CalcError {
  const entries = findAllMatchingLTEBands(earfcn);
  if (entries.length === 0) return { code: "no_band" };

  const bands = entries.map((entry) => toLTEBand(entry, earfcn));
  return {
    networkType: "LTE",
    channel: earfcn,
    frequency: bands[0].dlFrequency,
    bands,
  };
}

function calculateNR(nrarfcn: number): CalculationResult | CalcError {
  const frequency = nrArfcnToFrequency(nrarfcn);
  if (frequency === null) return { code: "no_band" };

  const entries = findAllMatchingNRBands(nrarfcn);
  if (entries.length === 0) return { code: "no_band" };

  return {
    networkType: "NR",
    channel: nrarfcn,
    frequency: frequency.toFixed(2),
    bands: entries.map((entry) => toNRBand(entry, nrarfcn, frequency)),
  };
}

/**
 * Turn typed text into a result or a failure code.
 *
 * AUTO HAS A GAP, AND IT NOW SAYS SO. The LTE table stops at EARFCN 56739 and
 * the NR table starts at ARFCN 123400. Auto used to fall off the end of its own
 * if/else for everything between the two and report the generic "no band
 * matches", which reads as "your number is wrong" when the real answer is
 * "Auto cannot tell which scheme you meant here — pick one." That gap is a fact
 * about our band tables, not about the input, so it gets its own code and its
 * own sentence pointing at the LTE and NR tabs.
 */
export function calculateFrequency(
  raw: string,
  forceType: "lte" | "nr" | null = null,
): CalculationResult | CalcError {
  const trimmed = raw.trim();
  if (!trimmed) return { code: "empty" };

  const channel = Number.parseInt(trimmed, 10);
  if (Number.isNaN(channel)) return { code: "not_a_number" };
  if (channel < 0) return { code: "negative" };

  if (forceType === "lte") return calculateLTE(channel);
  if (forceType === "nr") return calculateNR(channel);

  if (channel <= MAX_LTE_EARFCN) return calculateLTE(channel);
  if (channel >= MIN_NR_ARFCN) return calculateNR(channel);
  return { code: "auto_gap" };
}

// --- Persistence -------------------------------------------------------------

export const HISTORY_KEY = "earfcnHistory";
export const HISTORY_LIMIT = 10;

/**
 * Read the saved history, tolerating the shape it was saved in.
 *
 * The stored row used to be a whole `CalculationResult` — `earfcn` rather than
 * `channel`, and `possibleBands` as an array of full band OBJECTS, every field
 * of which this surface recomputes anyway. Narrowing it to band numbers cuts
 * the payload by roughly 90% and stops a schema change in the band tables from
 * being able to resurrect a stale duplex mode out of localStorage.
 *
 * The KEY DOES NOT CHANGE, so a user who already has ten calculations keeps
 * them: the legacy shape is normalised on read rather than discarded. Rows that
 * survive neither shape are dropped individually instead of failing the whole
 * parse — one corrupt row should not empty the list.
 */
export function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((row): HistoryEntry[] => {
      if (typeof row !== "object" || row === null) return [];
      const r = row as Record<string, unknown>;

      const networkType = r.networkType === "NR" ? "NR" : r.networkType === "LTE" ? "LTE" : null;
      const channel = typeof r.channel === "number" ? r.channel : typeof r.earfcn === "number" ? r.earfcn : null;
      const frequency = typeof r.frequency === "string" ? r.frequency : null;
      if (networkType === null || channel === null || frequency === null) return [];

      const source = Array.isArray(r.bands) ? r.bands : Array.isArray(r.possibleBands) ? r.possibleBands : [];
      const bands = source.flatMap((b): number[] => {
        if (typeof b === "number") return [b];
        if (typeof b === "object" && b !== null && typeof (b as { band?: unknown }).band === "number") {
          return [(b as { band: number }).band];
        }
        return [];
      });

      return [
        {
          networkType,
          channel,
          frequency,
          bands,
          timestamp: typeof r.timestamp === "string" ? r.timestamp : "",
          id: typeof r.id === "string" ? r.id : `${networkType}:${channel}:${bands.join(",")}`,
        },
      ];
    });
  } catch {
    // A corrupt or unreadable store is an empty history, never a crash.
    return [];
  }
}

export function writeHistory(history: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    if (history.length > 0) {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } else {
      window.localStorage.removeItem(HISTORY_KEY);
    }
  } catch {
    // Private-mode and quota failures are not worth a visible error here: the
    // history is a convenience, and the calculation itself already succeeded.
  }
}

/** The history row for a result. Bands are stored as numbers, not objects. */
export function toHistoryEntry(
  result: CalculationResult,
  timestamp: string,
  id: string,
): HistoryEntry {
  return {
    networkType: result.networkType,
    channel: result.channel,
    frequency: result.frequency,
    bands: result.bands.map((b) => b.band),
    timestamp,
    id,
  };
}
