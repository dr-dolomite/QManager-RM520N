"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useNeighbourScanner } from "@/hooks/use-neighbour-scanner";
import { downloadCSV } from "@/lib/download-csv";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { NeighbourCellResult } from "@/types/cell-scanner";

import LockCellDialog, { type LockCellTarget } from "../lock-cell-dialog";
import RunHero from "../run-hero";
import LedgerRows, { type LedgerRow } from "../run-summary";
import { ScanErrorState } from "../scan-states";
import { ScannerSkeleton } from "../scanner-skeleton";
import SiblingRouteLink from "../sibling-link";
import {
  EMPTY_PANEL,
  PILL_QUIET,
  SCAN_RESULTS_CARD,
  SECTION_HEAD,
  runPosture,
} from "../shapes";
import { summariseNeighbours } from "../summaries";
import NeighbourScanResultView, {
  CELL_TYPE_KEY,
} from "./neighbour-scan-result";

// =============================================================================
// Neighbour cells — the read and its results
// =============================================================================
// The sweep's launch bar, ledger and results card; no progress bar (a read takes seconds).
// =============================================================================

function buildCsvRows(results: NeighbourCellResult[]): string[] {
  return results.map((r) =>
    [
      r.networkType,
      r.cellType,
      r.frequency,
      r.pci,
      r.signalStrength,
      r.rsrq ?? "",
      r.rssi ?? "",
      r.sinr ?? "",
    ].join(","),
  );
}

const NEIGHBOUR_CSV_HEADER =
  "Network,Cell Type,Frequency,PCI,Signal (dBm),RSRQ,RSSI,SINR";

/** Posture -> its copy keys, as literals for `i18n:check`. */
const POSTURE_COPY = {
  idle: {
    title: "cell_scanner.neighbour.run.idle_title",
    body: "cell_scanner.neighbour.run.idle_body",
  },
  scanning: {
    title: "cell_scanner.neighbour.run.scanning_title",
    body: "cell_scanner.neighbour.run.scanning_body",
  },
  // No body on complete: the figure is the count.
  complete: { title: "cell_scanner.neighbour.run.complete_title" },
  failed: {
    title: "cell_scanner.neighbour.run.failed_title",
    body: "cell_scanner.neighbour.run.failed_body",
  },
} as const;

/** The full-sweep route, for the header cross-link. */
const SWEEP_ROUTE = "/cellular/cell-scanner";

/** The ledger's dBm figure, or `null` for the blank mark. */
function formatDbm(value: number | null): string | null {
  return value === null ? null : String(value);
}

export function NeighbourScanner() {
  const { t } = useTranslation("cellular");
  const { status, results, error, startScan } = useNeighbourScanner();
  const [lockTarget, setLockTarget] = React.useState<LockCellTarget | null>(
    null,
  );

  const posture = runPosture(status);
  const isScanning = posture === "scanning";
  const hasResults = posture === "complete" && results.length > 0;

  const handleLockCell = React.useCallback((cell: NeighbourCellResult) => {
    // Always the LTE payload: a neighbour report carries no band or SCS for NR.
    setLockTarget({
      kind: "lte",
      networkType: cell.networkType,
      pci: cell.pci,
      earfcn: cell.frequency,
    });
  }, []);

  const handleDownload = React.useCallback(() => {
    downloadCSV(
      NEIGHBOUR_CSV_HEADER,
      buildCsvRows(results),
      `neighbour_cells_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }, [results]);

  const copy = POSTURE_COPY[posture];

  const summary = React.useMemo(() => summariseNeighbours(results), [results]);

  const ledgerRows = React.useMemo<LedgerRow[]>(
    () =>
      summary.groups.map((group) => ({
        id: group.type,
        name: t(CELL_TYPE_KEY[group.type]),
        cells: group.count,
        cellsUnit: t("cell_scanner.run.ledger.cells_unit", {
          count: group.count,
        }),
        bands: [],
        strength: group.best,
        dbmText: formatDbm(group.best),
      })),
    [summary, t],
  );

  const usesModemMessage = posture === "failed" && Boolean(error);
  const postureTitle = usesModemMessage && error ? error : t(copy.title);
  const postureBody = "body" in copy ? t(copy.body) : null;

  // Scanning or complete only: on failed, `results` may hold the previous read.
  const ledgerRowsNode =
    isScanning || posture === "complete" ? (
      <LedgerRows
        rows={ledgerRows}
        isLoading={isScanning}
        emptyText={t("cell_scanner.neighbour.run.summary_empty")}
        head={{
          carrier: t("cell_scanner.neighbour.columns.cell_type"),
          cells: t("cell_scanner.run.ledger.col_cells"),
          best: t("cell_scanner.run.ledger.col_best"),
        }}
        dbmUnit={t("cell_scanner.run.ledger.dbm_unit")}
      />
    ) : null;

  return (
    <>
      <motion.div variants={staggerItem}>
        <RunHero
          posture={posture}
          title={t("cell_scanner.neighbour.run.title")}
          description={t("cell_scanner.neighbour.run.description")}
          link={
            <SiblingRouteLink
              href={SWEEP_ROUTE}
              glyph="radar"
              label={t("cell_scanner.neighbour.run.link_sweep")}
              blockedReason={
                isScanning ? t("cell_scanner.neighbour.run.link_blocked") : null
              }
            />
          }
          postureTitle={postureTitle}
          postureTitleIsMachine={usesModemMessage}
          postureBody={postureBody}
          metric={posture === "complete" ? summary.total : null}
          metricUnit={
            posture === "complete"
              ? t("cell_scanner.neighbour.run.ledger.figure_unit", {
                  count: summary.total,
                })
              : null
          }
          rows={ledgerRowsNode}
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
                  name={isScanning ? "progress_activity" : "cell_tower"}
                  size={18}
                  className={
                    isScanning
                      ? "motion-safe:animate-spin"
                      : undefined
                  }
                />
                {isScanning
                  ? t("cell_scanner.neighbour.run.scanning_action")
                  : hasResults
                    ? t("cell_scanner.neighbour.run.rerun")
                    : t("cell_scanner.neighbour.run.start")}
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
                  {t("cell_scanner.neighbour.results.title")}
                </CardTitle>
                <CardDescription className={SECTION_HEAD.DESC}>
                  {t("cell_scanner.neighbour.results.description")}
                </CardDescription>
              </div>
            </div>

            {isScanning ? (
              <ScannerSkeleton />
            ) : posture === "failed" ? (
              // No `message`: the hero's status cell already names the reason.
              <ScanErrorState
                title={t("cell_scanner.neighbour.results.error_title")}
                body={t("cell_scanner.neighbour.run.failed_body")}
                retryLabel={t("cell_scanner.neighbour.results.error_retry")}
                onRetry={startScan}
              />
            ) : results.length > 0 ? (
              <NeighbourScanResultView
                data={results}
                onLockCell={handleLockCell}
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
              // Only after a completed read that listed nothing; no button.
              <Empty className={EMPTY_PANEL}>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MaterialSymbol name="radar" size={24} aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t("cell_scanner.neighbour.results.empty_title")}
                  </EmptyTitle>
                  <EmptyDescription className="text-pretty">
                    {t("cell_scanner.neighbour.results.empty_body")}
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

export default NeighbourScanner;
