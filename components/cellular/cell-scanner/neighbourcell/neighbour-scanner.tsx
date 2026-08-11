"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useNeighbourScanner } from "@/hooks/use-neighbour-scanner";
import { downloadCSV } from "@/lib/download-csv";
import { staggerItem } from "@/lib/motion";
import type { NeighbourCellResult } from "@/types/cell-scanner";

import LockCellDialog, { type LockCellTarget } from "../lock-cell-dialog";
import RunHero from "../run-hero";
import { ScanEmptyState, ScanErrorState } from "../scan-states";
import { ScannerSkeleton } from "../scanner-skeleton";
import { PILL_ACTION, RESULTS_CARD, SECTION_HEAD, runPosture } from "../shapes";
import NeighbourScanResultView from "./neighbour-scan-result";

// =============================================================================
// Neighbour cells — the read and its results
// =============================================================================
// The same two objects as the full-scan route, from the same components: a hero
// that owns the run and a card that owns the rows. This file used to be a FORK
// of `scanner.tsx` — the error block, the action row, the lock dialog and the
// CSV button were byte-for-byte identical, and because they were authored twice
// this copy silently missed four things the parent later gained. It now shares
// all four rather than restating them, and what remains here is only what is
// genuinely different about a neighbour read.
//
// WHAT IS GENUINELY DIFFERENT IS THE COST, AND THE PAGE SAYS SO. A sweep holds
// the modem's single AT channel for up to three minutes; this asks the serving
// cell for a list it already maintains and is done in about two. Both routes
// previously shipped a button reading the identical string "Start New Scan",
// which is precisely the confusion the cost slot exists to remove.
//
// THERE IS NO ELAPSED CLOCK HERE, deliberately. A timer on a two-second
// operation is a progress indicator for something that has already finished by
// the time the reader's eye reaches it; the hero's `metric` slot carries the
// result count instead.
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

/** Posture -> its copy keys, spelled out as LITERALS for `i18n:check`. */
const POSTURE_COPY = {
  idle: {
    chip: "cell_scanner.neighbour.run.chip_idle",
    title: "cell_scanner.neighbour.run.idle_title",
    body: "cell_scanner.neighbour.run.idle_body",
  },
  scanning: {
    chip: "cell_scanner.neighbour.run.chip_scanning",
    title: "cell_scanner.neighbour.run.scanning_title",
    body: "cell_scanner.neighbour.run.scanning_body",
  },
  complete: {
    chip: "cell_scanner.neighbour.run.chip_complete",
    title: "cell_scanner.neighbour.run.complete_title",
    body: "cell_scanner.neighbour.run.complete_body",
  },
  failed: {
    chip: "cell_scanner.neighbour.run.chip_failed",
    title: "cell_scanner.neighbour.run.failed_title",
    body: "cell_scanner.neighbour.run.failed_body",
  },
} as const;

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
    // Always the LTE payload: `tower/lock.sh`'s NR branch needs a band and an
    // SCS, and a neighbour report carries neither. The column suppresses the
    // action for non-LTE rows, so this never sees one.
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

  // The modem's own message beats a generic failure line when it gave one.
  const postureTitle = posture === "failed" && error ? error : t(copy.title);

  const postureBody =
    posture === "complete"
      ? t("cell_scanner.neighbour.run.complete_body", { count: results.length })
      : t(copy.body);

  return (
    <>
      <motion.div variants={staggerItem}>
        <RunHero
          posture={posture}
          title={t("cell_scanner.neighbour.run.title")}
          description={t("cell_scanner.neighbour.run.description")}
          chipLabel={t(copy.chip)}
          postureTitle={postureTitle}
          postureBody={postureBody}
          clock={null}
          metric={hasResults ? results.length : null}
          costText={t("cell_scanner.neighbour.run.cost")}
          actions={
            <>
              <Button
                type="button"
                onClick={startScan}
                disabled={isScanning}
                className={PILL_ACTION}
              >
                <MaterialSymbol
                  name={isScanning ? "progress_activity" : "cell_tower"}
                  size={18}
                  className={
                    isScanning
                      ? "animate-spin motion-reduce:animate-none"
                      : undefined
                  }
                />
                {isScanning
                  ? t("cell_scanner.neighbour.run.scanning_action")
                  : hasResults
                    ? t("cell_scanner.neighbour.run.rerun")
                    : t("cell_scanner.neighbour.run.start")}
              </Button>

              {hasResults ? (
                <Button
                  type="button"
                  variant="tonal-neutral"
                  className={PILL_ACTION}
                  onClick={handleDownload}
                >
                  <MaterialSymbol name="download" size={18} />
                  {t("cell_scanner.run.download")}
                </Button>
              ) : null}
            </>
          }
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card className={RESULTS_CARD}>
          <div className={SECTION_HEAD.ROOT}>
            <h2 className={SECTION_HEAD.TITLE}>
              {t("cell_scanner.neighbour.results.title")}
            </h2>
            <p className={SECTION_HEAD.DESC}>
              {t("cell_scanner.neighbour.results.description")}
            </p>
          </div>

          {isScanning ? (
            <ScannerSkeleton />
          ) : posture === "failed" ? (
            <ScanErrorState
              message={error}
              title={t("cell_scanner.neighbour.results.error_title")}
              body={t("cell_scanner.results.error_body")}
              retryLabel={t("cell_scanner.neighbour.results.error_retry")}
              onRetry={startScan}
            />
          ) : results.length > 0 ? (
            <NeighbourScanResultView
              data={results}
              onLockCell={handleLockCell}
            />
          ) : (
            <ScanEmptyState
              title={t("cell_scanner.neighbour.results.empty_title")}
              body={t("cell_scanner.neighbour.results.empty_body")}
            />
          )}
        </Card>
      </motion.div>

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
