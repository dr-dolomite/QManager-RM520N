"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  type LTEBandEntry,
  type NRBandEntry,
  LTE_BANDS,
  NR_BANDS,
  findAllMatchingLTEBands,
  findAllMatchingNRBands,
  lteDLFrequency,
  lteULFrequency,
  nrArfcnToFrequency,
  nrULFrequency,
} from "@/lib/earfcn";

import { ScanEmptyState } from "../scan-states";
import { PILL_ACTION, PILL_QUIET, RESULTS_CARD, SECTION_HEAD, networkIdentity } from "../shapes";

// =============================================================================
// Frequency Calculator — the converter and its history
// =============================================================================
// TWO PEER CARDS, AND NO ANCHOR. Every other surface in this family opens with a
// `rounded-hero` run hero because a scan is a run: one object owns the operation
// and everything below reports on it. Nothing here runs. The calculator and its
// history are two equal objects a reader moves between, so both take
// `RESULTS_CARD` — `rounded-card`, 36px, the peer step — and the surface has no
// 40px radius on it anywhere. A hero radius with no hero behind it is a promise
// of importance the page cannot keep.
//
// THE MACHINE-VOICE SPLIT IS PER VALUE, NOT PER COLUMN. The test is whether a
// figure changes while the reader watches without them acting on it:
//
//   - A channel number (EARFCN, NR-ARFCN, UL EARFCN) and a band's fixed edges
//     (its frequency range, its channel range) are IDENTIFIERS. They hold still
//     until something reconfigures them, so they are `font-mono`.
//   - A frequency in MHz derived from what was just typed is a COMPUTED FIGURE.
//     It is the interface font with `tabular-nums` — mono here would say "this
//     is a name" about a number that is a reading.
//
// Both live in the same `<dl>`, one row apart, which is exactly why the rule has
// to be applied value by value rather than by picking one class for the block.
//
// THE ERRORS ARE CODES, NOT SENTENCES. `calculateFrequency` is a pure module
// function outside the component and therefore outside `t`. It used to return
// `{ error: "Please enter a valid number" }` — an English sentence smuggled
// through state into the DOM, invisible to `i18n:check` because no key was ever
// involved. It now returns a code, and the code is mapped to a LITERAL key at
// the call site.
// =============================================================================

// --- Auto-detection boundaries (derived from shared band tables) -------------
const MAX_LTE_EARFCN = Math.max(...LTE_BANDS.map((b) => b.earfcnRange[1]));
const MIN_NR_ARFCN = Math.min(...NR_BANDS.map((b) => b.nrarfcnRange[0]));

/**
 * The spec citations are PROPER NOUNS. They live in code rather than in the five
 * locale files so that a translator cannot accidentally localise a clause number
 * — `t()` receives the surrounding sentence and interpolates these verbatim.
 */
const NR_SPEC = "3GPP TS 38.104 Section 5.4.2.1";
const LTE_SPEC = "3GPP TS 36.101 Section 5.7";

// --- Types -------------------------------------------------------------------

type LTEMatchingBand = LTEBandEntry & {
  dlFrequency: string;
  ulFrequency: string;
  ulEarfcn: number;
  dlHigh: number;
  ulHigh: number;
};

type NRMatchingBand = NRBandEntry & {
  dlFrequency: string;
  ulFrequency: string;
  dlHigh: number;
  ulHigh: number;
};

type LTEResult = {
  networkType: "LTE";
  earfcn: number;
  frequency: string;
  possibleBands: LTEMatchingBand[];
};

type NRResult = {
  networkType: "NR";
  earfcn: number;
  frequency: string;
  possibleBands: NRMatchingBand[];
};

type CalculationResult = LTEResult | NRResult | null;

type CalcMode = "auto" | "lte" | "nr";

/** A machine-readable failure. Rendered through a literal key, never as prose. */
type CalcErrorCode = "empty" | "not_a_number" | "no_band" | "unexpected";

type CalcError = { code: CalcErrorCode; detail?: string };

type HistoryEntry = {
  networkType: "LTE" | "NR";
  earfcn: number;
  frequency: string;
  possibleBands: (LTEMatchingBand | NRMatchingBand)[];
  timestamp: string;
  id: string;
};

// --- Literal key maps --------------------------------------------------------
// `i18n:check` scans SOURCE TEXT, so a key assembled as `cell_scanner.calculator.
// ${mode}` is a key it cannot see and therefore cannot report missing in four
// locales. Every dynamic lookup on this surface goes through one of these maps.

const MODE_LABEL_KEY = {
  auto: "cell_scanner.calculator.form.label_auto",
  lte: "cell_scanner.calculator.form.label_lte",
  nr: "cell_scanner.calculator.form.label_nr",
} as const satisfies Record<CalcMode, string>;

const ERROR_KEY = {
  empty: "cell_scanner.calculator.error.empty",
  not_a_number: "cell_scanner.calculator.error.not_a_number",
  no_band: "cell_scanner.calculator.error.no_band",
  unexpected: "cell_scanner.calculator.error.unexpected",
} as const satisfies Record<CalcErrorCode, string>;

const CHANNEL_LABEL_KEY = {
  LTE: "cell_scanner.calculator.result.earfcn",
  NR: "cell_scanner.calculator.result.nrarfcn",
} as const;

const CHANNEL_RANGE_KEY = {
  LTE: "cell_scanner.calculator.result.earfcn_range",
  NR: "cell_scanner.calculator.result.nrarfcn_range",
} as const;

const BAND_LABEL_KEY = {
  LTE: "cell_scanner.calculator.result.band_lte",
  NR: "cell_scanner.calculator.result.band_nr",
} as const;

const HISTORY_BAND_KEY = {
  LTE: "cell_scanner.calculator.history.band_lte",
  NR: "cell_scanner.calculator.history.band_nr",
} as const;

// --- Calculation functions using shared library --------------------------------

const calculateLTEFrequency = (earfcn: number): LTEResult | null => {
  const bands = findAllMatchingLTEBands(earfcn);
  if (bands.length === 0) return null;

  const matchingBands: LTEMatchingBand[] = bands.map((band) => {
    const dlFreq = lteDLFrequency(earfcn) ?? 0;
    const ulFreq = lteULFrequency(earfcn);
    const ulEarfcn = band.duplexType === "FDD" ? earfcn + 18000 : earfcn;

    // Compute band high edges from EARFCN range
    const rangeSpan = (band.earfcnRange[1] - band.earfcnOffset) * band.spacing;
    const dlHigh = Math.round((band.dlLow + rangeSpan) * 10) / 10;
    const ulHigh =
      band.duplexType === "SDL"
        ? 0
        : band.duplexType === "TDD"
          ? dlHigh
          : Math.round((band.ulLow + rangeSpan) * 10) / 10;

    return {
      ...band,
      dlFrequency: dlFreq.toFixed(2),
      ulFrequency: ulFreq !== null ? ulFreq.toFixed(2) : "-",
      ulEarfcn,
      dlHigh,
      ulHigh,
    };
  });

  return {
    networkType: "LTE",
    earfcn,
    frequency: matchingBands[0].dlFrequency,
    possibleBands: matchingBands,
  };
};

const calculateNRFrequency = (nrarfcn: number): NRResult | null => {
  const frequency = nrArfcnToFrequency(nrarfcn);
  if (frequency === null) return null;

  const bands = findAllMatchingNRBands(nrarfcn);
  if (bands.length === 0) return null;

  const matchingBands: NRMatchingBand[] = bands.map((band) => {
    const dlFreq = frequency;
    const ulFreq = nrULFrequency(nrarfcn, band.band);

    // Compute high edges from NR-ARFCN range
    const dlHigh = nrArfcnToFrequency(band.nrarfcnRange[1]) ?? band.dlLow;
    const bandwidth = dlHigh - band.dlLow;
    const ulHigh =
      band.duplexType === "SDL"
        ? 0
        : band.duplexType === "TDD"
          ? dlHigh
          : band.ulLow + bandwidth;

    return {
      ...band,
      dlFrequency: dlFreq.toFixed(2),
      ulFrequency: ulFreq !== null ? ulFreq.toFixed(2) : "-",
      dlHigh: Math.round(dlHigh * 100) / 100,
      ulHigh: Math.round(ulHigh * 100) / 100,
    };
  });

  return {
    networkType: "NR",
    earfcn: nrarfcn,
    frequency: frequency.toFixed(2),
    possibleBands: matchingBands,
  };
};

// Decide which calculation to use based on the EARFCN/NR-ARFCN range
const calculateFrequency = (
  earfcn: string,
  forceType: "lte" | "nr" | null = null,
): CalculationResult | CalcError => {
  const earfcnNum = parseInt(earfcn);

  if (isNaN(earfcnNum)) {
    return { code: "not_a_number" };
  }

  if (
    forceType === "lte" ||
    (forceType === null && earfcnNum >= 0 && earfcnNum <= MAX_LTE_EARFCN)
  ) {
    return calculateLTEFrequency(earfcnNum);
  } else if (
    forceType === "nr" ||
    (forceType === null && earfcnNum >= MIN_NR_ARFCN)
  ) {
    return calculateNRFrequency(earfcnNum);
  }

  return null;
};

// Initialize history from localStorage
const getInitialHistory = (): HistoryEntry[] => {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const savedHistory = localStorage.getItem("earfcnHistory");
      if (savedHistory) {
        return JSON.parse(savedHistory) as HistoryEntry[];
      }
    } catch {
      // Silently fail
    }
  }
  return [];
};

// --- Presentation primitives -------------------------------------------------

/**
 * The label/value grid. One column below `@md/section` — at the modem's own
 * narrow web view a 9.5rem label column leaves the value nowhere to go, and a
 * frequency that wraps mid-number is worse than a stacked pair.
 *
 * The container is `/section` because `RESULTS_CARD` declares it. A query written
 * against `/card` here would match nothing and silently never fire.
 */
const DETAIL_LIST =
  "grid grid-cols-1 gap-x-4 gap-y-1 text-sm @md/section:grid-cols-[9.5rem_minmax(0,1fr)] @md/section:gap-y-2";

/** Identifiers: channel numbers and fixed band edges. Machine voice. */
const IDENT = "font-mono text-[13px] tabular-nums";
/** Computed readings: anything in MHz derived from what was just typed. */
const FIGURE = "tabular-nums";

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </>
  );
}

const FrequencyCalculator = () => {
  const { t } = useTranslation("cellular");

  const [earfcn, setEarfcn] = React.useState<string>("");
  const [result, setResult] = React.useState<CalculationResult>(null);
  const [error, setError] = React.useState<CalcError | null>(null);
  const [activeTab, setActiveTab] = React.useState<CalcMode>("auto");
  const [history, setHistory] = React.useState<HistoryEntry[]>(getInitialHistory);

  // Save history to localStorage whenever it changes
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        if (history.length > 0) {
          localStorage.setItem("earfcnHistory", JSON.stringify(history));
        } else {
          localStorage.removeItem("earfcnHistory");
        }
      } catch {
        // Silently fail
      }
    }
  }, [history]);

  const handleCalculate = (): void => {
    if (!earfcn) {
      setError({ code: "empty" });
      setResult(null);
      return;
    }

    try {
      const forceType = activeTab === "auto" ? null : activeTab;
      const calculationResult = calculateFrequency(earfcn, forceType);

      if (calculationResult && !("code" in calculationResult)) {
        setResult(calculationResult);
        setError(null);

        const historyEntry: HistoryEntry = {
          ...calculationResult,
          timestamp: new Date().toISOString(),
          id: Date.now().toString(),
        };

        setHistory((prev) => [historyEntry, ...prev.slice(0, 9)]);
      } else if (calculationResult && "code" in calculationResult) {
        setError(calculationResult);
        setResult(null);
      } else {
        setError({ code: "no_band" });
        setResult(null);
      }
    } catch (err) {
      setError({
        code: "unexpected",
        detail: err instanceof Error ? err.message : String(err),
      });
      setResult(null);
    }
  };

  const deleteHistoryEntry = (id: string): void => {
    setHistory((prev) => prev.filter((entry) => entry.id !== id));
  };

  const clearHistory = (): void => {
    setHistory([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCalculate();
    }
  };

  // The error is a code; the recovery advice lives in the copy, and both the
  // offending value and the runtime message are interpolated rather than
  // concatenated, so a locale can put them wherever its grammar wants them.
  const errorText = error
    ? t(ERROR_KEY[error.code], { value: earfcn, message: error.detail ?? "" })
    : null;

  const mhz = (value: string | number) =>
    t("cell_scanner.calculator.units.mhz", { value });
  const rangeMhz = (low: string | number, high: string | number) =>
    t("cell_scanner.calculator.units.range_mhz", { low, high });

  return (
    <motion.div
      // A nested cascade container declares `variants` ONLY. Its `initial` and
      // `animate` come from the page shell above it; restating them here would
      // start a second, independent cascade on the same elements.
      variants={staggerContainer}
      className="grid items-start gap-5 @3xl/main:grid-cols-2"
    >
      {/* ── The converter ────────────────────────────────────────────────── */}
      <motion.div variants={staggerItem}>
        <Card className={RESULTS_CARD}>
          <div className={SECTION_HEAD.ROOT}>
            <h2 className={SECTION_HEAD.TITLE}>
              {t("cell_scanner.calculator.form.title")}
            </h2>
            <p className={SECTION_HEAD.DESC}>
              {t("cell_scanner.calculator.form.description")}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as CalcMode)}
            >
              <TabsList className="grid h-[2.625rem] w-full grid-cols-3 rounded-pill bg-surface-container p-1">
                <TabsTrigger value="auto" className="rounded-pill">
                  {t("cell_scanner.calculator.form.mode_auto")}
                </TabsTrigger>
                <TabsTrigger value="lte" className="rounded-pill">
                  {t("cell_scanner.calculator.form.mode_lte")}
                </TabsTrigger>
                <TabsTrigger value="nr" className="rounded-pill">
                  {t("cell_scanner.calculator.form.mode_nr")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-col gap-2">
              <Label htmlFor="earfcn">{t(MODE_LABEL_KEY[activeTab])}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="earfcn"
                  type="number"
                  inputMode="numeric"
                  className="h-[2.625rem] min-w-0 flex-1 rounded-field font-mono tabular-nums"
                  placeholder={t("cell_scanner.calculator.form.placeholder")}
                  value={earfcn}
                  onChange={(e) => setEarfcn(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "earfcn-error" : undefined}
                />
                <Button
                  type="button"
                  onClick={handleCalculate}
                  className={PILL_ACTION}
                >
                  {t("cell_scanner.calculator.form.submit")}
                </Button>
              </div>
            </div>

            {errorText ? (
              <p
                id="earfcn-error"
                role="alert"
                className="flex items-start gap-2.5 rounded-field bg-destructive-container px-4 py-3 text-sm/relaxed text-on-destructive-container text-pretty"
              >
                <MaterialSymbol
                  name="error"
                  size={18}
                  filled
                  className="mt-px flex-none"
                />
                {errorText}
              </p>
            ) : null}

            {result ? (
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-3 rounded-tile bg-surface-container p-5">
                  <h3 className="text-sm font-semibold">
                    {t("cell_scanner.calculator.result.title")}
                  </h3>
                  <dl className={DETAIL_LIST}>
                    <Detail
                      label={t("cell_scanner.calculator.result.network_type")}
                    >
                      <Badge variant={networkIdentity(result.networkType)}>
                        {result.networkType}
                      </Badge>
                    </Detail>
                    <Detail label={t(CHANNEL_LABEL_KEY[result.networkType])}>
                      <span className={IDENT}>{result.earfcn}</span>
                    </Detail>
                    <Detail
                      label={t("cell_scanner.calculator.result.frequency")}
                    >
                      <span className={FIGURE}>{mhz(result.frequency)}</span>
                    </Detail>
                  </dl>
                </section>

                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold">
                    {t("cell_scanner.calculator.result.bands_title")}
                  </h3>
                  <div className="flex flex-col gap-3">
                    {result.possibleBands.map((band) => (
                      <div
                        key={`${band.band}-${band.name}`}
                        className="flex flex-col gap-3 rounded-tile bg-surface-container p-5"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="font-mono text-sm font-semibold tabular-nums">
                            {t(BAND_LABEL_KEY[result.networkType], {
                              band: band.band,
                            })}
                          </span>
                          <span className="text-sm text-on-surface-variant">
                            {band.name}
                          </span>
                        </div>

                        <dl className={DETAIL_LIST}>
                          <Detail
                            label={t("cell_scanner.calculator.result.duplex")}
                          >
                            {band.duplexType}
                          </Detail>

                          <Detail
                            label={t(
                              "cell_scanner.calculator.result.downlink_range",
                            )}
                          >
                            <span className={IDENT}>
                              {rangeMhz(band.dlLow, band.dlHigh)}
                            </span>
                          </Detail>

                          {band.duplexType === "FDD" ? (
                            <Detail
                              label={t(
                                "cell_scanner.calculator.result.uplink_range",
                              )}
                            >
                              <span className={IDENT}>
                                {rangeMhz(band.ulLow, band.ulHigh)}
                              </span>
                            </Detail>
                          ) : null}

                          <Detail
                            label={t(CHANNEL_RANGE_KEY[result.networkType])}
                          >
                            <span className={IDENT}>
                              {"earfcnRange" in band
                                ? t("cell_scanner.calculator.units.range", {
                                    low: band.earfcnRange[0],
                                    high: band.earfcnRange[1],
                                  })
                                : t("cell_scanner.calculator.units.range", {
                                    low: (band as NRMatchingBand)
                                      .nrarfcnRange[0],
                                    high: (band as NRMatchingBand)
                                      .nrarfcnRange[1],
                                  })}
                            </span>
                          </Detail>

                          <Detail
                            label={t(
                              "cell_scanner.calculator.result.dl_frequency",
                            )}
                          >
                            <span className={FIGURE}>
                              {mhz(band.dlFrequency)}
                            </span>
                          </Detail>

                          <Detail
                            label={t(
                              "cell_scanner.calculator.result.ul_frequency",
                            )}
                          >
                            {band.duplexType === "SDL" ? (
                              <span className="text-on-surface-variant">
                                {t(
                                  "cell_scanner.calculator.result.downlink_only",
                                )}
                              </span>
                            ) : (
                              <span className={FIGURE}>
                                {mhz(band.ulFrequency)}
                              </span>
                            )}
                          </Detail>

                          {"earfcnRange" in band && band.duplexType === "FDD" ? (
                            <Detail
                              label={t(
                                "cell_scanner.calculator.result.ul_earfcn",
                              )}
                            >
                              <span className={IDENT}>
                                {(band as LTEMatchingBand).ulEarfcn}
                              </span>
                            </Detail>
                          ) : null}
                        </dl>
                      </div>
                    ))}
                  </div>
                </section>

                <p className="text-xs/relaxed text-on-surface-variant text-pretty">
                  {t("cell_scanner.calculator.result.method", {
                    spec: result.networkType === "NR" ? NR_SPEC : LTE_SPEC,
                  })}
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      </motion.div>

      {/* ── The history ──────────────────────────────────────────────────── */}
      <motion.div variants={staggerItem}>
        <Card className={RESULTS_CARD}>
          {/*
           * The Clear action sits in the section header's META slot, not inside
           * a `CardHeader`. The canon's CardHeader is plain title + description:
           * an action nested in it competes with the title for the same reading
           * position and, when the row wraps, lands under the description as if
           * it belonged to it.
           */}
          <div className={SECTION_HEAD.ROOT}>
            <h2 className={SECTION_HEAD.TITLE}>
              {t("cell_scanner.calculator.history.title")}
            </h2>
            <p className={SECTION_HEAD.DESC}>
              {t("cell_scanner.calculator.history.description")}
            </p>
            {history.length > 0 ? (
              <div className={SECTION_HEAD.META}>
                <Button
                  type="button"
                  variant="tonal-destructive"
                  className={PILL_QUIET}
                  onClick={clearHistory}
                >
                  <MaterialSymbol name="delete" size={16} />
                  {t("cell_scanner.calculator.history.clear")}
                </Button>
              </div>
            ) : null}
          </div>

          {history.length === 0 ? (
            <ScanEmptyState
              title={t("cell_scanner.calculator.history.empty_title")}
              body={t("cell_scanner.calculator.history.empty_body")}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 rounded-tile bg-surface-container p-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`${IDENT} font-semibold`}>
                        {entry.earfcn}
                      </span>
                      <Badge variant={networkIdentity(entry.networkType)}>
                        {entry.networkType}
                      </Badge>
                      <span
                        className={`${FIGURE} text-sm font-medium text-on-surface-variant`}
                      >
                        {mhz(entry.frequency)}
                      </span>
                    </div>

                    {entry.possibleBands?.length ? (
                      <p className="text-sm text-pretty">
                        <span className="text-on-surface-variant">
                          {t("cell_scanner.calculator.history.bands")}
                        </span>{" "}
                        <span className="font-mono tabular-nums">
                          {entry.possibleBands
                            .map((band) =>
                              t(HISTORY_BAND_KEY[entry.networkType], {
                                band: band.band,
                              }),
                            )
                            .join(", ")}
                        </span>
                      </p>
                    ) : null}

                    <p className="text-xs tabular-nums text-on-surface-variant">
                      {entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString()
                        : t("cell_scanner.calculator.history.no_timestamp")}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteHistoryEntry(entry.id)}
                    aria-label={t("cell_scanner.calculator.a11y.delete_entry")}
                    className="size-9 flex-none rounded-pill text-on-surface-variant"
                  >
                    <MaterialSymbol name="close" size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
};

export default FrequencyCalculator;
