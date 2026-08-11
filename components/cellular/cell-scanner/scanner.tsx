"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useCellScanner } from "@/hooks/use-cell-scanner";
import { downloadCSV } from "@/lib/download-csv";
import { staggerItem } from "@/lib/motion";
import type { CellScanResult } from "@/types/cell-scanner";

import LockCellDialog, { type LockCellTarget } from "./lock-cell-dialog";
import RunHero from "./run-hero";
import ScanResultView from "./scan-result";
import { ScanEmptyState, ScanErrorState } from "./scan-states";
import { ScannerSkeleton } from "./scanner-skeleton";
import {
  PILL_ACTION,
  RESULTS_CARD,
  SECTION_HEAD,
  formatElapsed,
  runPosture,
} from "./shapes";

// =============================================================================
// Full band scan — the run and its results
// =============================================================================
// Two objects, and the split is the redesign. The HERO owns the run: its
// posture, its clock, its cost and its buttons, always mounted, morphing rather
// than being replaced. The RESULTS CARD owns the rows and nothing else, showing
// a skeleton, a state panel or the table.
//
// The incumbent swapped one card body between four unrelated full-height
// layouts, so the action row appeared and disappeared with the state it happened
// to be rendered beside, and there was nowhere stable to say what a sweep costs.
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
      r.bandwidth,
      r.signalStrength,
    ].join(","),
  );
}

const CELL_SCAN_CSV_HEADER =
  "Network,Provider,MCC,MNC,Band,EARFCN,PCI,Cell ID,TAC,Bandwidth,Signal (dBm)";

/**
 * Posture -> its two copy keys, spelled out as LITERALS.
 *
 * `i18n:check` grades a missing key as a warning and exits 0, so a stem it
 * cannot see statically is a stem nothing will ever report on. An interpolated
 * `` `posture.${posture}_title` `` is invisible to it; this is not.
 */
const POSTURE_COPY = {
  idle: {
    chip: "cell_scanner.run.chip_idle",
    title: "cell_scanner.run.idle_title",
    body: "cell_scanner.run.idle_body",
  },
  scanning: {
    chip: "cell_scanner.run.chip_scanning",
    title: "cell_scanner.run.scanning_title",
    body: "cell_scanner.run.scanning_body",
  },
  complete: {
    chip: "cell_scanner.run.chip_complete",
    title: "cell_scanner.run.complete_title",
    body: "cell_scanner.run.complete_body",
  },
  failed: {
    chip: "cell_scanner.run.chip_failed",
    title: "cell_scanner.run.failed_title",
    body: "cell_scanner.run.failed_body",
  },
} as const;

export function FullScanner() {
  const { t } = useTranslation("cellular");
  const { status, results, error, elapsedSeconds, startScan } =
    useCellScanner();
  const [lockTarget, setLockTarget] = React.useState<LockCellTarget | null>(
    null,
  );

  const posture = runPosture(status);
  const isScanning = posture === "scanning";
  const hasResults = posture === "complete" && results.length > 0;

  const handleLockCell = React.useCallback((cell: CellScanResult) => {
    setLockTarget({
      // The endpoint takes two different payloads and rejects the wrong one, so
      // the branch happens once here rather than inside the dialog's request.
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

  // The failed posture's title is the MODEM'S message when it gave one. A
  // generic "Scan failed" over a specific reason is a downgrade.
  const postureTitle =
    posture === "failed" && error ? error : t(copy.title);

  const postureBody =
    posture === "complete"
      ? t("cell_scanner.run.complete_body", { count: results.length })
      : t(copy.body);

  return (
    <>
      <motion.div variants={staggerItem}>
        <RunHero
          posture={posture}
          title={t("cell_scanner.run.title")}
          description={t("cell_scanner.run.description")}
          chipLabel={t(copy.chip)}
          postureTitle={postureTitle}
          postureBody={postureBody}
          clock={
            isScanning
              ? {
                  seconds: elapsedSeconds,
                  // The label must CARRY the time: an aria-label replaces the
                  // element's text outright, so "Sweep elapsed time" alone
                  // would announce the clock and hide the reading.
                  ariaLabel: t("cell_scanner.a11y.elapsed", {
                    time: formatElapsed(elapsedSeconds),
                  }),
                }
              : null
          }
          metric={hasResults ? results.length : null}
          costText={t("cell_scanner.run.cost")}
          actions={
            <>
              <Button
                type="button"
                onClick={startScan}
                disabled={isScanning}
                className={PILL_ACTION}
              >
                <MaterialSymbol
                  name={isScanning ? "progress_activity" : "radar"}
                  size={18}
                  className={
                    isScanning
                      ? "animate-spin motion-reduce:animate-none"
                      : undefined
                  }
                />
                {/* Three distinct labels for three distinct acts. Both scanning
                    routes shipped the identical string "Start New Scan" for runs
                    that differ by ~100x in what they cost the modem. */}
                {isScanning
                  ? t("cell_scanner.run.scanning_action")
                  : hasResults
                    ? t("cell_scanner.run.rerun")
                    : t("cell_scanner.run.start")}
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
              {t("cell_scanner.results.title")}
            </h2>
            <p className={SECTION_HEAD.DESC}>
              {t("cell_scanner.results.description")}
            </p>
          </div>

          {isScanning ? (
            <ScannerSkeleton />
          ) : posture === "failed" ? (
            <ScanErrorState
              message={error}
              title={t("cell_scanner.results.error_title")}
              body={t("cell_scanner.results.error_body")}
              retryLabel={t("cell_scanner.results.error_retry")}
              onRetry={startScan}
            />
          ) : results.length > 0 ? (
            <ScanResultView data={results} onLockCell={handleLockCell} />
          ) : (
            <ScanEmptyState
              title={t("cell_scanner.results.empty_title")}
              body={t("cell_scanner.results.empty_body")}
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

export default FullScanner;
