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
import type {
  NeighbourCellResult,
  NeighbourCellType,
} from "@/types/cell-scanner";

import LockCellDialog, { type LockCellTarget } from "../lock-cell-dialog";
import RunHero from "../run-hero";
import RunSummary, {
  type SummaryTile,
  type SummaryVerdict,
} from "../run-summary";
import { ScanEmptyState, ScanErrorState } from "../scan-states";
import { ScannerSkeleton } from "../scanner-skeleton";
import SiblingRouteLink from "../sibling-link";
import { PILL_ACTION, RESULTS_CARD, SECTION_HEAD, runPosture } from "../shapes";
import { MAX_TILE_CHANNELS, summariseNeighbours } from "../summaries";
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
    title: "cell_scanner.neighbour.run.idle_title",
    body: "cell_scanner.neighbour.run.idle_body",
  },
  scanning: {
    title: "cell_scanner.neighbour.run.scanning_title",
    body: "cell_scanner.neighbour.run.scanning_body",
  },
  // No `body` on `complete` — the rail's figure is the count. See `shapes.ts`.
  complete: { title: "cell_scanner.neighbour.run.complete_title" },
  failed: {
    title: "cell_scanner.neighbour.run.failed_title",
    body: "cell_scanner.neighbour.run.failed_body",
  },
} as const;

/** The full-sweep route, for the header cross-link. */
const SWEEP_ROUTE = "/cellular/cell-scanner";

/**
 * Relation -> its tile label key, as LITERALS. Same reasoning as the column
 * map in `neighbour-scan-result.tsx`: `i18n:check` cannot see an interpolated
 * stem, so a key built at runtime is a key nothing will ever report as missing.
 */
const RELATION_LABEL_KEY: Record<NeighbourCellType, string> = {
  intra: "cell_scanner.neighbour.cell_type.intra",
  inter: "cell_scanner.neighbour.cell_type.inter",
  nr5g: "cell_scanner.neighbour.cell_type.nr5g",
};

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

  // Pure and total: an empty read, a single row and an all-sentinel read all
  // produce a well-formed summary rather than `NaN` or `-Infinity`.
  const summary = React.useMemo(() => summariseNeighbours(results), [results]);

  const summaryTiles = React.useMemo<SummaryTile[]>(() => {
    // One tile per relation the read actually returned, then the measurement
    // split. `nr5g` gets a tile of its own when it appears rather than being
    // silently absent from an intra/inter pair that would then not add up.
    const tiles: SummaryTile[] = summary.groups.map((group) => ({
      id: group.type,
      label: t(RELATION_LABEL_KEY[group.type]),
      value: group.count,
      details: [
        ...(group.channels.length > 0
          ? [
              group.channels.length <= MAX_TILE_CHANNELS
                ? // Few enough to name: channel numbers are identifiers, so
                  // machine voice, separated by space rather than glued.
                  {
                    text: group.channels.join(" "),
                    voice: "ident" as const,
                  }
                : // Too many to name: a count is a figure, not an identifier.
                  {
                    text: t("cell_scanner.neighbour.run.summary_channels", {
                      count: group.channels.length,
                    }),
                    voice: "figure" as const,
                  },
            ]
          : []),
        {
          text:
            group.best === null
              ? t("cell_scanner.run.summary_no_reading")
              : t("cell_scanner.run.summary_best", { value: group.best }),
          voice: "figure" as const,
        },
      ],
    }));

    if (summary.total > 0) {
      tiles.push({
        id: "__measured",
        label: t("cell_scanner.neighbour.run.summary_measured_label"),
        value: summary.measured,
        details: [
          {
            text: t("cell_scanner.neighbour.run.summary_channel_only", {
              count: summary.channelOnly,
            }),
            voice: "figure" as const,
          },
        ],
      });
    }

    return tiles;
  }, [summary, t]);

  // One verdict, and only when there is something to explain: the rows the
  // serving cell named but did not measure. They carry no quality and cannot be
  // locked, which is otherwise learned by clicking a disabled menu item.
  const verdict = React.useMemo<SummaryVerdict | null>(
    () =>
      summary.channelOnly > 0
        ? {
            tone: "muted",
            glyph: "visibility_off",
            text: t("cell_scanner.neighbour.run.verdict_channel_only", {
              count: summary.channelOnly,
            }),
          }
        : null,
    [summary.channelOnly, t],
  );

  // The modem's own message beats a generic failure line when it gave one.
  const postureTitle = posture === "failed" && error ? error : t(copy.title);

  const postureBody = "body" in copy ? t(copy.body) : null;

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
          postureBody={postureBody}
          metric={hasResults ? results.length : null}
          summary={
            isScanning || posture === "complete" ? (
              <RunSummary
                isLoading={isScanning}
                title={t("cell_scanner.neighbour.run.summary_title")}
                tiles={summaryTiles}
                verdict={verdict}
                emptyText={t("cell_scanner.neighbour.run.summary_empty")}
              />
            ) : null
          }
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
              // No `message`: the hero rail above already carries the modem's
              // own words. See the sweep route for the full reasoning.
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
