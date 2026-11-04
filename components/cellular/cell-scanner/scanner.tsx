"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatCellBandwidth } from "@/lib/earfcn";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { useCellScanner } from "@/hooks/use-cell-scanner";
import { useModemStatus } from "@/hooks/use-modem-status";
import { downloadCSV } from "@/lib/download-csv";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { CellScanResult } from "@/types/cell-scanner";

import LockCellDialog, { type LockCellTarget } from "./lock-cell-dialog";
import RunHero from "./run-hero";
import LedgerRows, { type LedgerRow } from "./run-summary";
import ScanResultView from "./scan-result";
import { ScanErrorState } from "./scan-states";
import { ScannerSkeleton } from "./scanner-skeleton";
import SiblingRouteLink from "./sibling-link";
import {
  EMPTY_PANEL,
  PILL_QUIET,
  SCAN_RESULTS_CARD,
  SECTION_HEAD,
  VERDICT,
  VERDICT_TONE,
  runPosture,
  type VerdictTone,
} from "./shapes";
import { cellMatchesSim, simPlmnFromImsi } from "./sim-plmn";
import { summariseSweep } from "./summaries";

// =============================================================================
// Full band sweep — the run and its results
// =============================================================================
// The hero owns the run; the results card owns the rows. The card is not
// rendered at idle: it enters when a sweep starts and stays from then on.
// =============================================================================

function buildCsvRows(results: CellScanResult[]): string[] {
  return results.map((r) =>
    [
      r.networkType,
      `"${(r.provider || "").replace(/"/g, '""')}"`,
      r.mcc,
      r.mnc,
      r.band,
      r.earfcn,
      r.pci,
      r.cellID,
      r.tac,
      `"${formatCellBandwidth(r.networkType, r.bandwidth, r.scs)}"`,
      r.signalStrength,
    ].join(","),
  );
}

const CELL_SCAN_CSV_HEADER =
  "Network,Provider,MCC,MNC,Band,EARFCN,PCI,Cell ID,TAC,Bandwidth,Signal (dBm)";

/** Posture -> its copy keys, as literals so `i18n:check` can see them. */
const POSTURE_COPY = {
  idle: {
    title: "cell_scanner.run.idle_title",
    body: "cell_scanner.run.idle_body",
  },
  scanning: {
    title: "cell_scanner.run.scanning_title",
    body: "cell_scanner.run.scanning_body",
  },
  // No body on complete: the figure is the count.
  complete: { title: "cell_scanner.run.complete_title" },
  failed: {
    title: "cell_scanner.run.failed_title",
    body: "cell_scanner.run.failed_body",
  },
} as const;

/** The neighbour route, for the header cross-link. */
const NEIGHBOUR_ROUTE = "/cellular/cell-scanner/neighbourcell-scanner";

/** A uniform tier -> its verdict copy and mark, as literals. */
const VERDICT_COPY = {
  good: {
    key: "cell_scanner.run.verdict_all_good",
    tone: "success",
    glyph: "signal_cellular_3_bar",
  },
  fair: {
    key: "cell_scanner.run.verdict_all_fair",
    tone: "warning",
    glyph: "signal_cellular_2_bar",
  },
  poor: {
    key: "cell_scanner.run.verdict_all_poor",
    tone: "destructive",
    glyph: "signal_cellular_1_bar",
  },
} as const;

/** A sweep's typical run, in seconds; the worker's hard limit is 180. */
const SCAN_EXPECTED_SECONDS = 150;

/**
 * An ESTIMATE of sweep progress from elapsed time, 0-99: linear to 90% over the
 * typical run, then an asymptote that never reaches 99. Only `complete` fills it.
 */
function estimateScanProgress(elapsedSeconds: number): number {
  const t = Math.max(0, elapsedSeconds);
  if (t <= SCAN_EXPECTED_SECONDS) return (t / SCAN_EXPECTED_SECONDS) * 90;
  return 90 + 9 * (1 - Math.exp(-(t - SCAN_EXPECTED_SECONDS) / 20));
}

/** The worker's last-resort provider name, `<mcc>/<mnc>`: an identifier, so machine voice. */
const NUMERIC_PROVIDER_RE = /^\d{1,4}\/\d{1,4}$/;

/** The ledger's dBm figure, or `null` for the blank mark. */
function formatDbm(value: number | null): string | null {
  return value === null ? null : String(value);
}

export function FullScanner() {
  const { t } = useTranslation("cellular");
  const { status, results, error, elapsedSeconds, startScan } =
    useCellScanner();

  // The SIM's home PLMN, from its IMSI. Rows on any other network keep a
  // disabled "Lock to this cell".
  const { data: modemStatus } = useModemStatus({ pollInterval: 10000 });
  const imsi = modemStatus?.device?.imsi;
  const simPlmn = React.useMemo(() => simPlmnFromImsi(imsi), [imsi]);
  const canLockCell = React.useCallback(
    (cell: CellScanResult) => cellMatchesSim(cell, simPlmn),
    [simPlmn],
  );
  const [lockTarget, setLockTarget] = React.useState<LockCellTarget | null>(
    null,
  );

  const posture = runPosture(status);
  const isScanning = posture === "scanning";
  const hasResults = posture === "complete" && results.length > 0;

  const handleLockCell = React.useCallback((cell: CellScanResult) => {
    setLockTarget({
      // The endpoint takes two payload shapes and rejects the wrong one.
      kind: cell.networkType.toUpperCase().startsWith("NR") ? "nr_sa" : "lte",
      networkType: cell.networkType,
      pci: cell.pci,
      earfcn: cell.earfcn,
      band: cell.band,
      scs: cell.scs ?? null,
      provider: cell.provider,
    });
  }, []);

  const handleDownload = React.useCallback(() => {
    downloadCSV(
      CELL_SCAN_CSV_HEADER,
      buildCsvRows(results),
      `cell_scan_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }, [results]);

  const copy = POSTURE_COPY[posture];

  // Every aggregate, derived once; `simPlmn` decides which group leads.
  const summary = React.useMemo(
    () => summariseSweep(results, simPlmn),
    [results, simPlmn],
  );

  const ledgerRows = React.useMemo<LedgerRow[]>(() => {
    const rows: LedgerRow[] = summary.groups.map((group) => ({
      // An empty id would collide across every unnamed group.
      id: group.provider || "__unnamed",
      name: group.provider || t("cell_scanner.run.summary_provider_unknown"),
      nameVoice: NUMERIC_PROVIDER_RE.test(group.provider) ? "machine" : "text",
      isSim: group.isSim,
      cells: group.cells,
      cellsUnit: t("cell_scanner.run.ledger.cells_unit", {
        count: group.cells,
      }),
      bands: group.bands,
      strength: group.best,
      dbmText: formatDbm(group.best),
    }));

    if (summary.overflowProviders > 0) {
      rows.push({
        id: "__overflow",
        name: t("cell_scanner.run.summary_others", {
          count: summary.overflowProviders,
        }),
        cells: summary.overflowCells,
        cellsUnit: t("cell_scanner.run.ledger.cells_unit", {
          count: summary.overflowCells,
        }),
        bands: [],
        strength: summary.overflowBest,
        dbmText: formatDbm(summary.overflowBest),
      });
    }

    return rows;
  }, [summary, t]);

  const verdictData = React.useMemo<{
    tone: VerdictTone;
    glyph: MaterialSymbolName;
    text: string;
  } | null>(() => {
    if (results.length === 0) return null;

    // Nothing measured: an absence of readings, so muted.
    if (summary.measured === 0) {
      return {
        tone: "muted",
        glyph: "signal_cellular_off",
        text: t("cell_scanner.run.verdict_no_readings"),
      };
    }

    // A mixed spread gets no verdict.
    if (!summary.uniform) return null;

    const spec = VERDICT_COPY[summary.uniform];
    return {
      tone: spec.tone,
      glyph: spec.glyph,
      text: t(spec.key, { count: summary.measured }),
    };
  }, [results.length, summary, t]);

  // The failed title is the reported reason when there is one, in machine voice.
  const usesModemMessage = posture === "failed" && Boolean(error);
  const postureTitle = usesModemMessage && error ? error : t(copy.title);
  const postureBody = "body" in copy ? t(copy.body) : null;

  // Scanning or complete only: on failed, `results` may hold the previous run.
  const ledgerRowsNode =
    isScanning || posture === "complete" ? (
      <LedgerRows
        rows={ledgerRows}
        isLoading={isScanning}
        emptyText={t("cell_scanner.run.summary_empty")}
        head={{
          carrier: t("cell_scanner.run.ledger.col_carrier"),
          cells: t("cell_scanner.run.ledger.col_cells"),
          bands: t("cell_scanner.run.ledger.col_bands"),
          best: t("cell_scanner.run.ledger.col_best"),
        }}
        simTagLabel={t("cell_scanner.run.ledger.your_sim")}
        dbmUnit={t("cell_scanner.run.ledger.dbm_unit")}
      />
    ) : null;

  // Complete only: while scanning, `results` still describes the previous run.
  const verdictNode =
    verdictData && posture === "complete" ? (
      <p className={cn(VERDICT.ROOT, VERDICT_TONE[verdictData.tone])}>
        <MaterialSymbol
          name={verdictData.glyph}
          size={18}
          filled
          className="flex-none"
        />
        <span className={VERDICT.TEXT}>{verdictData.text}</span>
      </p>
    ) : null;

  return (
    <>
      <motion.div variants={staggerItem}>
        <RunHero
          posture={posture}
          title={t("cell_scanner.run.title")}
          description={t("cell_scanner.run.description")}
          link={
            <SiblingRouteLink
              href={NEIGHBOUR_ROUTE}
              glyph="cell_tower"
              label={t("cell_scanner.run.link_neighbour")}
              shortLabel={t("cell_scanner.run.link_neighbour_short")}
              // One scan `flock` for both routes: the read would be refused.
              blockedReason={
                isScanning ? t("cell_scanner.run.link_blocked") : null
              }
            />
          }
          postureTitle={postureTitle}
          postureTitleIsMachine={usesModemMessage}
          postureBody={postureBody}
          metric={posture === "complete" ? summary.total : null}
          metricUnit={
            posture === "complete"
              ? t("cell_scanner.run.ledger.cells_unit", {
                  count: summary.total,
                })
              : null
          }
          progress={isScanning ? estimateScanProgress(elapsedSeconds) : null}
          progressLabel={t("cell_scanner.run.progress_label")}
          rows={ledgerRowsNode}
          verdict={verdictNode}
          idleCollapsed
          actions={
            // None on failed: the results card carries the retry.
            posture === "failed" ? null : (
              <Button
                type="button"
                onClick={startScan}
                disabled={isScanning}
                size="action"
              >
                <MaterialSymbol
                  name={isScanning ? "progress_activity" : "radar"}
                  size={18}
                  className={
                    isScanning
                      ? "motion-safe:animate-spin"
                      : undefined
                  }
                />
                {isScanning
                  ? t("cell_scanner.run.scanning_action")
                  : hasResults
                    ? t("cell_scanner.run.rerun")
                    : t("cell_scanner.run.start")}
              </Button>
            )
          }
        />
      </motion.div>

      {posture === "idle" ? null : (
        <motion.div variants={staggerItem} initial="hidden" animate="visible">
          <Card className={SCAN_RESULTS_CARD}>
            <div className={SECTION_HEAD.ROOT}>
              <div className={SECTION_HEAD.TITLES}>
                <CardTitle as="h2" className={SECTION_HEAD.TITLE}>
                  {t("cell_scanner.results.title")}
                </CardTitle>
                <CardDescription className={SECTION_HEAD.DESC}>
                  {t("cell_scanner.results.description")}
                </CardDescription>
              </div>
            </div>

            {isScanning ? (
              <ScannerSkeleton />
            ) : posture === "failed" ? (
              // No `message`: the hero's status cell already names the reason.
              <ScanErrorState
                title={t("cell_scanner.results.error_title")}
                body={t("cell_scanner.results.error_body")}
                retryLabel={t("cell_scanner.results.error_retry")}
                onRetry={startScan}
              />
            ) : results.length > 0 ? (
              <ScanResultView
                data={results}
                onLockCell={handleLockCell}
                canLockCell={canLockCell}
                toolbarActions={
                  <Button
                    type="button"
                    variant="tonal-neutral"
                    className={cn(PILL_QUIET, "gap-1.5")}
                    onClick={handleDownload}
                    aria-label={t("cell_scanner.run.download")}
                  >
                    <MaterialSymbol name="download" size={16} />
                    <span className="hidden @sm/section:inline">
                      {t("cell_scanner.run.download")}
                    </span>
                  </Button>
                }
              />
            ) : (
              // Only after a completed sweep that listed nothing; no button.
              <Empty className={EMPTY_PANEL}>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MaterialSymbol name="radar" size={24} aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{t("cell_scanner.results.empty_title")}</EmptyTitle>
                  <EmptyDescription className="text-pretty">
                    {t("cell_scanner.results.empty_body")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </Card>
        </motion.div>
      )}

      <LockCellDialog
        target={lockTarget}
        onOpenChange={(open) => {
          if (!open) setLockTarget(null);
        }}
      />
    </>
  );
}

export default FullScanner;
