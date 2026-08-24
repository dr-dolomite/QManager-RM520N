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
import { cn } from "@/lib/utils";
import type { NeighbourCellResult } from "@/types/cell-scanner";

import LockCellDialog, { type LockCellTarget } from "../lock-cell-dialog";
import RunHero from "../run-hero";
import RunSummary, {
  type SummaryTile,
  type SummaryVerdict,
} from "../run-summary";
import { ScanEmptyState, ScanErrorState } from "../scan-states";
import { ScannerSkeleton } from "../scanner-skeleton";
import SiblingRouteLink from "../sibling-link";
import {
  PILL_ACTION,
  POSTURE_DISC,
  POSTURE_GLYPH,
  RESULTS_CARD,
  SECTION_HEAD,
  SUMMARY,
  runPosture,
  type SignalTier,
} from "../shapes";
import { MAX_TILE_CHANNELS, summariseNeighbours } from "../summaries";
import NeighbourScanResultView, {
  CELL_TYPE_KEY,
} from "./neighbour-scan-result";

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
// WHAT IS GENUINELY DIFFERENT IS THE COST, AND THE BUTTONS SAY SO. A sweep
// holds the modem's single AT channel for up to three minutes; this asks the
// serving cell for a list it already maintains and is done in about two. Both
// routes previously shipped a button reading the identical string "Start New
// Scan"; they now read "Sweep all bands" and "Read neighbours". The standing
// cost PARAGRAPH that used to sit in the hero was removed on 2026-08-14 by user
// decision — see `shapes.ts`'s file header.
//
// THERE IS NO ELAPSED CLOCK HERE, deliberately. A timer on a two-second
// operation is a progress indicator for something that has already finished by
// the time the reader's eye reaches it; the hero's `metric` slot carries the
// result count instead.
//
// -----------------------------------------------------------------------------
// AND NO IDLE COLLAPSE, FOR THE SAME REASON (2026-08-24)
// -----------------------------------------------------------------------------
// The sweep route's hero collapses to a launch bar at idle and GROWS into its
// body when a run starts, on the 800ms emphasized clock. This route takes every
// other part of that change — the stacked section head, the neutral summary
// tiles with their tier discs, the header action row, the returned ink — and
// deliberately NOT the height morph. `RunHero` exposes it as `idleCollapsed`,
// and this file is the reason the prop exists rather than the behaviour being
// unconditional.
//
// The cost asymmetry that separates these two routes everywhere else separates
// them here too. A sweep holds the AT lock for 30-180 seconds, so its grow lands
// once, early, and the reader then waits inside the shape it grew into — the
// morph reads as the page committing to a long operation. A neighbour read is
// done in about two seconds: the container would finish an 800ms grow, hold the
// skeleton for barely a second, and swap to the result. Same gesture, and at
// that cadence it reads as the panel twitching rather than as progress. Growth
// that resolves before the reader has finished registering it is not
// choreography, it is jitter.
//
// So this hero is always open. Its rail is present at idle carrying the `idle`
// posture, which is also the only place on this route that explains what a
// neighbour read IS before you run one — and with no summary beside it yet, the
// rail takes the full width rather than anchoring an empty split (see
// `HERO_RAIL_ONLY`). The results card stays mounted at idle with its quiet
// `ScanEmptyState` for the same reason: a two-second act does not need the page
// rearranged around it.
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
 * A signal tier -> its label key, as LITERALS. Restated from the sweep route
 * rather than shared, by the same house convention `shapes.ts`'s header states:
 * four keys are cheaper than a copy module, and neither route should be able to
 * re-word the other's accessible labels.
 */
const SIGNAL_LABEL_KEY: Record<SignalTier, string> = {
  good: "cell_scanner.signal.good",
  fair: "cell_scanner.signal.fair",
  poor: "cell_scanner.signal.poor",
  none: "cell_scanner.signal.none",
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

  // The run's own status, folded into the tile grid as a peer card instead of a
  // differently-sized rail beside it — see `RunHero`'s `hideRail` and
  // `RunSummary`'s `leading`. Built only when there is a completed count to
  // show; `RunHero` falls back to its own rail whenever this is absent.
  const readFinishedTile = hasResults ? (
    <div className={SUMMARY.TILE}>
      <span className={cn(SUMMARY.DISC, POSTURE_DISC.complete)}>
        <MaterialSymbol
          name={POSTURE_GLYPH.complete.glyph}
          size={26}
          filled={POSTURE_GLYPH.complete.filled}
        />
      </span>
      <div className={SUMMARY.COPY}>
        <span className={SUMMARY.LABEL}>{t(POSTURE_COPY.complete.title)}</span>
        <span className={SUMMARY.DETAILS}>
          <span className={SUMMARY.DETAIL_FIGURE}>
            {t("cell_scanner.results.tally_rows", { count: results.length })}
          </span>
        </span>
      </div>
    </div>
  ) : null;

  // Pure and total: an empty read, a single row and an all-sentinel read all
  // produce a well-formed summary rather than `NaN` or `-Infinity`.
  const summary = React.useMemo(() => summariseNeighbours(results), [results]);

  const summaryTiles = React.useMemo<SummaryTile[]>(() => {
    // One tile per relation the read actually returned, then the measurement
    // split. `nr5g` gets a tile of its own when it appears rather than being
    // silently absent from an intra/inter pair that would then not add up.
    const tiles: SummaryTile[] = summary.groups.map((group) => ({
      id: group.type,
      label: t(CELL_TYPE_KEY[group.type]),
      // The disc is the relation's best measured tier, graded in
      // `summaries.ts`. `tierLabel` is that tier in words for a screen reader —
      // the glyph carrying it is a ligature and is always aria-hidden.
      tier: group.tier,
      tierLabel: t(SIGNAL_LABEL_KEY[group.tier]),
      details: [
        // The count moved into the fact line when the tile became a row. This
        // route counts ROWS rather than cells: a neighbour report names one
        // entry per relation, which the footer tally already calls a row.
        {
          text: t("cell_scanner.results.tally_rows", { count: group.count }),
          voice: "figure" as const,
        },
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
        // This tile is a COUNT rather than a relation, so it has no tier of its
        // own; it takes the best tier across the whole read. That is the honest
        // reading of "with measurements": when nothing was measured the tier is
        // `none` and the disc says so, which is exactly this tile's subject.
        tier: summary.tier,
        tierLabel: t(SIGNAL_LABEL_KEY[summary.tier]),
        details: [
          {
            text: t("cell_scanner.neighbour.results.tally_measured", {
              count: summary.measured,
            }),
            voice: "figure" as const,
          },
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

  // The modem's own message beats a generic failure line when it gave one — and
  // when it is the modem's own string it is a raw machine string, so it takes
  // machine voice. Authored English never does.
  const usesModemMessage = posture === "failed" && Boolean(error);
  const postureTitle = usesModemMessage && error ? error : t(copy.title);

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
          postureTitleIsMachine={usesModemMessage}
          postureBody={postureBody}
          metric={hasResults ? results.length : null}
          // NO `idleCollapsed` — see this file's header. A two-second read does
          // not earn an 800ms container morph.
          // `hideRail` only when there is a folded-in `readFinishedTile` to take
          // its place — `RunHero` falls back to its own rail otherwise.
          hideRail={hasResults}
          summary={
            isScanning || posture === "complete" ? (
              <RunSummary
                isLoading={isScanning}
                tiles={summaryTiles}
                verdict={verdict}
                emptyText={t("cell_scanner.neighbour.run.summary_empty")}
                leading={readFinishedTile}
              />
            ) : null
          }
          actions={
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
          }
        />
      </motion.div>

      <motion.div variants={staggerItem}>
        <Card className={RESULTS_CARD}>
          <div className={SECTION_HEAD.ROOT}>
            <div className={SECTION_HEAD.TITLES}>
              <h2 className={SECTION_HEAD.TITLE}>
                {t("cell_scanner.neighbour.results.title")}
              </h2>
              <p className={SECTION_HEAD.DESC}>
                {t("cell_scanner.neighbour.results.description")}
              </p>
            </div>
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
            <>
              <NeighbourScanResultView
                data={results}
                onLockCell={handleLockCell}
              />

              {/* End-justified, below the table's own footer/pager — the
                  header action row now carries only the one act you can take on
                  this whole read ("Read again"); exporting what it found is a
                  fact about the finished table, so it lives at the table's own
                  bottom edge. */}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="tonal-neutral"
                  className={PILL_ACTION}
                  onClick={handleDownload}
                >
                  <MaterialSymbol name="download" size={18} />
                  {t("cell_scanner.run.download")}
                </Button>
              </div>
            </>
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
