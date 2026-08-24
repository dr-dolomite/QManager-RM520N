"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { staggerItem } from "@/lib/motion";

import { ScanEmptyState } from "../scan-states";
import {
  CALC_HERO,
  FORM,
  HERO_SPLIT,
  PILL_ACTION,
  PILL_QUIET,
  RESULTS_CARD,
  SECTION_HEAD,
} from "../shapes";
import { SiblingRouteLink } from "../sibling-link";
import { BAND_LABEL_KEY, BandTiles } from "./band-tiles";
import {
  type CalcError,
  type CalcMode,
  type CalculationResult,
  type HistoryEntry,
  HISTORY_LIMIT,
  LTE_SPEC,
  MAX_LTE_EARFCN,
  MIN_NR_ARFCN,
  NR_SPEC,
  calculateFrequency,
  readHistory,
  toHistoryEntry,
  writeHistory,
} from "./calc-model";
import { CalcReadout, type ReadoutState } from "./calc-readout";
import { HistoryList } from "./history-list";

// =============================================================================
// Frequency Calculator — the anchor, its bands, and its history
// =============================================================================
// THIS FILE USED TO ARGUE AGAINST ITS OWN ANCHOR, and the argument is worth
// leaving on the record because it was half right. It said a `rounded-hero`
// radius here would be "a promise of importance the page cannot keep", on the
// grounds that the family's heroes are RUN heroes and nothing here runs. True
// about runs, wrong about heroes: what an anchor promises is that one object is
// the thing the reader came for. On this page that is unambiguous — you came to
// turn a channel number into a frequency. Two peer cards claimed the converter
// and its own history were equally important, which is the single thing this
// page is certain they are not.
//
// The anchor therefore takes `CALC_HERO` (which IS `RUN_HERO`, deliberately the
// same object) and `HERO_SPLIT`, and none of the run vocabulary: no posture, no
// elapsed clock, no spinner, and no cost statement, because nothing is spent.
// `shapes.ts` carries the long form of that decision.
//
// THREE CARDS, AND THE MIDDLE ONE NEVER DISAPPEARS. The bands card is present
// before the first calculation, carrying an empty state, exactly as the sweep's
// results card is. A card that pops into existence on the first result shifts
// everything below it and makes the page feel like it is assembling itself; a
// card that is always there simply fills in.
// =============================================================================

const MODE_LABEL_KEY = {
  auto: "cell_scanner.calculator.form.label_auto",
  lte: "cell_scanner.calculator.form.label_lte",
  nr: "cell_scanner.calculator.form.label_nr",
} as const satisfies Record<CalcMode, string>;

const ERROR_KEY = {
  empty: "cell_scanner.calculator.error.empty",
  not_a_number: "cell_scanner.calculator.error.not_a_number",
  negative: "cell_scanner.calculator.error.negative",
  auto_gap: "cell_scanner.calculator.error.auto_gap",
  no_band: "cell_scanner.calculator.error.no_band",
  unexpected: "cell_scanner.calculator.error.unexpected",
} as const;

const CHANNEL_READOUT_KEY = {
  LTE: "cell_scanner.calculator.readout.channel_lte",
  NR: "cell_scanner.calculator.readout.channel_nr",
} as const;

const FrequencyCalculator = () => {
  const { t } = useTranslation("cellular");

  const [channel, setChannel] = React.useState("");
  const [result, setResult] = React.useState<CalculationResult | null>(null);
  const [error, setError] = React.useState<CalcError | null>(null);
  const [mode, setMode] = React.useState<CalcMode>("auto");
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);

  // The saved history is read AFTER mount, not in a lazy `useState` initialiser.
  // The initialiser runs during render, which on a statically exported page means
  // the server produces an empty list and the client's first render produces ten
  // rows — a hydration mismatch React resolves by throwing the server's markup
  // away. Seeding empty and filling in an effect costs one paint and is correct.
  React.useEffect(() => {
    const saved = readHistory();
    if (saved.length > 0) setHistory(saved);
  }, []);

  React.useEffect(() => {
    writeHistory(history);
  }, [history]);

  /**
   * Run the calculation and put the surface into one consistent state.
   *
   * `record` is what separates an ASKED-FOR calculation from a re-derivation.
   * Pressing Calculate or Enter is a request and lands in the history; switching
   * the mode tab re-answers a question already on screen and does not, or ten
   * tab presses would bury the ten calculations the reader actually made.
   */
  const run = React.useCallback(
    (value: string, nextMode: CalcMode, record: boolean) => {
      try {
        const outcome = calculateFrequency(value, nextMode === "auto" ? null : nextMode);

        if ("code" in outcome) {
          setError(outcome);
          setResult(null);
          return;
        }

        setResult(outcome);
        setError(null);

        if (record) {
          const entry = toHistoryEntry(
            outcome,
            new Date().toISOString(),
            `${Date.now()}`,
          );
          setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
        }
      } catch (err) {
        setError({
          code: "unexpected",
          detail: err instanceof Error ? err.message : String(err),
        });
        setResult(null);
      }
    },
    [],
  );

  const handleModeChange = (next: CalcMode) => {
    setMode(next);
    // Only re-answer a question already on screen. With nothing resolved yet the
    // tab is just a preference for the next calculation, and raising an error
    // for an empty field the user has not submitted would be scolding them for
    // reading the options.
    if (result || error) run(channel, next, false);
  };

  const handleChannelChange = (value: string) => {
    setChannel(value);
    // Typing is the recovery. Leaving the strip up — and `aria-invalid` on —
    // while the reader corrects the value makes the field claim the new input is
    // wrong before anything has looked at it.
    if (error) setError(null);
  };

  const errorText = error
    ? t(ERROR_KEY[error.code], {
        value: channel,
        message: error.detail ?? "",
        low: MAX_LTE_EARFCN + 1,
        high: MIN_NR_ARFCN - 1,
      })
    : null;

  const readout: ReadoutState = React.useMemo(() => {
    if (error) return { kind: "failed" };
    if (!result) return { kind: "idle" };

    const single = result.bands.length === 1 ? result.bands[0] : null;

    return {
      kind: "result",
      networkType: result.networkType,
      figure: result.frequency,
      unit: t("cell_scanner.calculator.units.mhz_short"),
      channelLabel: t(CHANNEL_READOUT_KEY[result.networkType], {
        value: result.channel,
      }),
      bandLabel: single
        ? t(BAND_LABEL_KEY[result.networkType], { band: single.band })
        : null,
      caption: single
        ? null
        : t("cell_scanner.calculator.readout.several_bands", {
            count: result.bands.length,
          }),
    };
  }, [result, error, t]);

  // The spec citation, and ONLY once there is a result to cite. The
  // pre-calculation hint that used to fill this slot ("Auto picks LTE or NR from
  // the number's range") was removed on 2026-08-14 by user decision — the three
  // mode tabs sitting directly above it already say Auto is one of three
  // choices. The slot stays empty until the reader has an answer.
  const noteText = result
    ? t("cell_scanner.calculator.result.method", {
        spec: result.networkType === "NR" ? NR_SPEC : LTE_SPEC,
      })
    : null;

  return (
    <>
      {/* ── The anchor ───────────────────────────────────────────────────── */}
      <motion.div variants={staggerItem}>
        <Card className={CALC_HERO}>
          <div className={SECTION_HEAD.ROOT}>
            <div className={SECTION_HEAD.TITLES}>
              <h2 className={SECTION_HEAD.TITLE}>
                {t("cell_scanner.calculator.form.title")}
              </h2>
              <p className={SECTION_HEAD.DESC}>
                {t("cell_scanner.calculator.form.description")}
              </p>
            </div>
            <div className={SECTION_HEAD.META}>
              <SiblingRouteLink
                href="/cellular/cell-scanner"
                glyph="radar"
                label={t("cell_scanner.calculator.page.sibling")}
              />
            </div>
          </div>

          <div className={HERO_SPLIT}>
            <CalcReadout
              state={readout}
              idleTitle={t("cell_scanner.calculator.readout.idle_title")}
              idleBody={t("cell_scanner.calculator.readout.idle_body")}
              failedTitle={t("cell_scanner.calculator.readout.failed_title")}
              failedBody={t("cell_scanner.calculator.readout.failed_body")}
            />

            <div className={FORM.ROOT}>
              <Tabs
                value={mode}
                onValueChange={(value) => handleModeChange(value as CalcMode)}
              >
                <TabsList className={FORM.TABS}>
                  <TabsTrigger value="auto" className={FORM.TAB}>
                    {t("cell_scanner.calculator.form.mode_auto")}
                  </TabsTrigger>
                  <TabsTrigger value="lte" className={FORM.TAB}>
                    {t("cell_scanner.calculator.form.mode_lte")}
                  </TabsTrigger>
                  <TabsTrigger value="nr" className={FORM.TAB}>
                    {t("cell_scanner.calculator.form.mode_nr")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className={FORM.FIELD}>
                <Label htmlFor="earfcn">{t(MODE_LABEL_KEY[mode])}</Label>
                <div className={FORM.ROW}>
                  <Input
                    id="earfcn"
                    type="number"
                    inputMode="numeric"
                    className={FORM.INPUT}
                    placeholder={t("cell_scanner.calculator.form.placeholder")}
                    value={channel}
                    onChange={(e) => handleChannelChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") run(channel, mode, true);
                    }}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "earfcn-error" : undefined}
                  />
                  <Button
                    type="button"
                    onClick={() => run(channel, mode, true)}
                    className={PILL_ACTION}
                  >
                    {t("cell_scanner.calculator.form.submit")}
                  </Button>
                </div>
              </div>

              {errorText ? (
                <p id="earfcn-error" role="alert" className={FORM.ERROR}>
                  <MaterialSymbol
                    name="error"
                    size={18}
                    filled
                    className="mt-px flex-none"
                  />
                  {errorText}
                </p>
              ) : null}

              {/*
               * The quiet sentence and the error are ONE SLOT, never both. Both
               * failure codes that can reach this column already end with the
               * recovery ("Pick LTE or NR to calculate it anyway"), so leaving
               * the hint up beneath a red strip prints the same advice twice in
               * two different voices and makes the reader check whether they
               * disagree. The error is the more specific of the two, so it wins
               * and the hint stands down until it clears.
               */}
              {errorText || !noteText ? null : (
                <div className={FORM.NOTE}>
                  <MaterialSymbol
                    name="info"
                    size={18}
                    className="text-on-surface-variant flex-none"
                  />
                  <p className={FORM.NOTE_TEXT}>{noteText}</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ── The matching bands ───────────────────────────────────────────── */}
      <motion.div variants={staggerItem}>
        <Card className={RESULTS_CARD}>
          <div className={SECTION_HEAD.ROOT}>
            <div className={SECTION_HEAD.TITLES}>
              <h2 className={SECTION_HEAD.TITLE}>
                {t("cell_scanner.calculator.result.bands_title")}
              </h2>
              <p className={SECTION_HEAD.DESC}>
                {t("cell_scanner.calculator.result.bands_description")}
              </p>
            </div>
          </div>

          {result ? (
            <BandTiles result={result} />
          ) : (
            <ScanEmptyState
              title={t(
                error
                  ? "cell_scanner.calculator.result.bands_failed_title"
                  : "cell_scanner.calculator.result.bands_empty_title",
              )}
              body={t(
                error
                  ? "cell_scanner.calculator.result.bands_failed_body"
                  : "cell_scanner.calculator.result.bands_empty_body",
              )}
            />
          )}
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
            <div className={SECTION_HEAD.TITLES}>
              <h2 className={SECTION_HEAD.TITLE}>
                {t("cell_scanner.calculator.history.title")}
              </h2>
              <p className={SECTION_HEAD.DESC}>
                {t("cell_scanner.calculator.history.description")}
              </p>
            </div>
            {history.length > 0 ? (
              <div className={SECTION_HEAD.META}>
                <Button
                  type="button"
                  variant="tonal-destructive"
                  className={PILL_QUIET}
                  onClick={() => setHistory([])}
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
            <HistoryList
              history={history}
              onDelete={(id) =>
                setHistory((prev) => prev.filter((entry) => entry.id !== id))
              }
            />
          )}
        </Card>
      </motion.div>
    </>
  );
};

export default FrequencyCalculator;
