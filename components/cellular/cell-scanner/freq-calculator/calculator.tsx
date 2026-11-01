"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { staggerItem } from "@/lib/motion";

import { ScanEmptyState } from "../scan-states";
import {
  BAND_TILE,
  CALC_HERO,
  CALC_SPLIT,
  FORM,
  HISTORY_CLEAR,
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

// Frequency Calculator: controls left, answer rail right; a failure prints once, in the rail.
// Bands and history are always-present peer cards, paired on a wide screen.

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

/** The rail's own id — the field's `aria-describedby` target while it is invalid. */
const RAIL_ID = "calc-rail";

const FrequencyCalculator = () => {
  const { t } = useTranslation("cellular");

  const [channel, setChannel] = React.useState("");
  const [result, setResult] = React.useState<CalculationResult | null>(null);
  const [error, setError] = React.useState<CalcError | null>(null);
  const [mode, setMode] = React.useState<CalcMode>("auto");
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);

  // Read after mount, not in a lazy initialiser: the static export would otherwise hydrate-mismatch.
  React.useEffect(() => {
    const saved = readHistory();
    if (saved.length > 0) setHistory(saved);
  }, []);

  React.useEffect(() => {
    writeHistory(history);
  }, [history]);

  // `record` is true only for an asked-for calculation; mode switches and recalls re-derive silently.
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
    // Only re-answer a question already on screen; with nothing resolved the tab is a preference.
    if (result || error) run(channel, next, false);
  };

  const handleChannelChange = (value: string) => {
    setChannel(value);
    // Typing is the recovery, so the failure state clears as soon as the value changes.
    if (error) setError(null);
  };

  /** Recall a history row: restore its channel, force `auto`, and re-derive without recording. */
  const handleRecall = (entry: HistoryEntry) => {
    const value = String(entry.channel);
    setChannel(value);
    setMode("auto");
    run(value, "auto", false);
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
      bandName: single ? single.name : null,
      caption: single
        ? null
        : t("cell_scanner.calculator.readout.several_bands", {
            count: result.bands.length,
          }),
    };
  }, [result, error, t]);

  // The spec citation sits on the bands card it cites, once there is a result.
  const specTag = result
    ? {
        text: result.networkType === "NR" ? NR_SPEC : LTE_SPEC,
        title: t("cell_scanner.calculator.result.method", {
          spec: result.networkType === "NR" ? NR_SPEC : LTE_SPEC,
        }),
      }
    : null;

  return (
    <>
      {/* ── The anchor ───────────────────────────────────────────────────── */}
      <motion.div variants={staggerItem}>
        <Card className={CALC_HERO}>
          <div className={SECTION_HEAD.ROOT}>
            <div className={SECTION_HEAD.TITLES}>
              <CardTitle as="h2" className={SECTION_HEAD.TITLE}>
                {t("cell_scanner.calculator.form.title")}
              </CardTitle>
              <CardDescription className={SECTION_HEAD.DESC}>
                {t("cell_scanner.calculator.form.description")}
              </CardDescription>
            </div>
            <div className={SECTION_HEAD.META}>
              <SiblingRouteLink
                href="/cellular/cell-scanner"
                glyph="radar"
                label={t("cell_scanner.calculator.page.sibling")}
              />
            </div>
          </div>

          <div className={CALC_SPLIT}>
            <div className={FORM.ROOT}>
              <Tabs
                value={mode}
                onValueChange={(value) => handleModeChange(value as CalcMode)}
              >
                <div className={FORM.TOP}>
                  <Label htmlFor="earfcn" className={FORM.LABEL}>
                    {t(MODE_LABEL_KEY[mode])}
                  </Label>
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
                </div>
              </Tabs>

              <div className={FORM.ROW}>
                <Input
                  id="earfcn"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  className={FORM.INPUT}
                  placeholder={t("cell_scanner.calculator.form.placeholder")}
                  value={channel}
                  onChange={(e) => handleChannelChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run(channel, mode, true);
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? RAIL_ID : undefined}
                />
                <Button
                  type="button"
                  onClick={() => run(channel, mode, true)}
                  size="action"
                >
                  {t("cell_scanner.calculator.form.submit")}
                </Button>
              </div>
            </div>

            <CalcReadout
              id={RAIL_ID}
              state={readout}
              idleTitle={t("cell_scanner.calculator.readout.idle_title")}
              idleBody={t("cell_scanner.calculator.readout.idle_body")}
              failedTitle={t("cell_scanner.calculator.readout.failed_title")}
              failedBody={errorText ?? t("cell_scanner.calculator.readout.failed_body")}
            />
          </div>
        </Card>
      </motion.div>

      {/* ── Bands and history, paired on a wide screen ──────────────────── */}
      <div className="grid grid-cols-1 gap-5 @4xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @4xl/main:items-stretch">
        <motion.div variants={staggerItem} className="flex">
          <Card className={`${RESULTS_CARD} h-full min-w-0 flex-1`}>
            <div className={SECTION_HEAD.ROOT}>
              <div className={SECTION_HEAD.TITLES}>
                <CardTitle as="h2" className={SECTION_HEAD.TITLE}>
                  {t("cell_scanner.calculator.result.bands_title")}
                </CardTitle>
                <CardDescription className={SECTION_HEAD.DESC}>
                  {t("cell_scanner.calculator.result.bands_description")}
                </CardDescription>
              </div>
              {specTag ? (
                <div className={SECTION_HEAD.META}>
                  <Tag className="font-mono text-[11.5px]" title={specTag.title}>
                    {specTag.text}
                  </Tag>
                </div>
              ) : null}
            </div>

            {result ? (
              <BandTiles result={result} />
            ) : (
              <div className={BAND_TILE.WELL}>
                <ScanEmptyState
                  title={t("cell_scanner.calculator.result.bands_empty_title")}
                  body={t("cell_scanner.calculator.result.bands_empty_body")}
                />
              </div>
            )}
          </Card>
        </motion.div>

        {/* ── The history ────────────────────────────────────────────────── */}
        <motion.div variants={staggerItem} className="flex">
          <Card className={`${RESULTS_CARD} h-full min-w-0 flex-1`}>
            <div className={SECTION_HEAD.ROOT}>
              <div className={SECTION_HEAD.TITLES}>
                <CardTitle as="h2" className={SECTION_HEAD.TITLE}>
                  {t("cell_scanner.calculator.history.title")}
                </CardTitle>
                <CardDescription className={SECTION_HEAD.DESC}>
                  {t("cell_scanner.calculator.history.description")}
                </CardDescription>
              </div>
              {history.length > 0 ? (
                <div className={SECTION_HEAD.META}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={HISTORY_CLEAR}
                    onClick={() => setHistory([])}
                  >
                    <MaterialSymbol name="delete" size={16} />
                    {t("cell_scanner.calculator.history.clear")}
                  </Button>
                </div>
              ) : null}
            </div>

            {/* `BAND_TILE.WELL` is the one inner-container shape both cards share. */}
            <div className={BAND_TILE.WELL}>
              {history.length === 0 ? (
                <ScanEmptyState
                  title={t("cell_scanner.calculator.history.empty_title")}
                  body={t("cell_scanner.calculator.history.empty_body")}
                />
              ) : (
                <HistoryList
                  history={history}
                  onRecall={handleRecall}
                  onDelete={(id) =>
                    setHistory((prev) => prev.filter((entry) => entry.id !== id))
                  }
                />
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </>
  );
};

export default FrequencyCalculator;
