"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useCellScanner } from "@/hooks/use-cell-scanner";
import { downloadCSV } from "@/lib/download-csv";
import { staggerItem } from "@/lib/motion";
import type { CellScanResult } from "@/types/cell-scanner";

import LockCellDialog, { type LockCellTarget } from "./lock-cell-dialog";
import RunHero from "./run-hero";
import RunSummary, { type SummaryTile, type SummaryVerdict } from "./run-summary";
import ScanResultView from "./scan-result";
import { ScanErrorState } from "./scan-states";
import { ScannerSkeleton } from "./scanner-skeleton";
import SiblingRouteLink from "./sibling-link";
import {
  EMPTY_PANEL,
  PILL_ACTION,
  RESULTS_CARD,
  SECTION_HEAD,
  runPosture,
  type SignalTier,
} from "./shapes";
import { summariseSweep } from "./summaries";

// =============================================================================
// Full band scan — the run and its results
// =============================================================================
// Two objects, and the split is the redesign. The HERO owns the run: its
// posture and its buttons, always mounted, morphing rather than being replaced.
// The RESULTS CARD owns the rows and nothing else, showing a skeleton, a state
// panel or the table.
//
// The incumbent swapped one card body between four unrelated full-height
// layouts, so the action row appeared and disappeared with the state it happened
// to be rendered beside.
//
// THE RESULTS CARD DOES NOT RENDER AT IDLE (2026-08-24). Before a run there are
// no results, and a card whose entire content is a dashed box announcing their
// absence is furniture — it was also the second panel resizing on a single
// click, since it swapped that box for a taller skeleton at the same moment the
// hero grew. The card ENTERS on the standard card cascade when a run starts, and
// from then on it stays.
//
// Its `Empty` panel is therefore reachable only after a sweep that COMPLETED and
// listed nothing, and it no longer carries a button: the hero directly above it
// is showing a 0 and a "Sweep again" action in exactly that state, and the whole
// point of moving the primary action into the hero header was that one act gets
// one affordance. See `EMPTY_PANEL` in `shapes.ts`.
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
    title: "cell_scanner.run.idle_title",
    body: "cell_scanner.run.idle_body",
  },
  scanning: {
    title: "cell_scanner.run.scanning_title",
    body: "cell_scanner.run.scanning_body",
  },
  // No `body` on `complete`: the rail's figure IS the count, so a sentence
  // restating it was the same fact twice, 40px apart. See `shapes.ts`'s header.
  complete: { title: "cell_scanner.run.complete_title" },
  failed: {
    title: "cell_scanner.run.failed_title",
    body: "cell_scanner.run.failed_body",
  },
} as const;

/** The neighbour route, for the header cross-link. Literal, not built at runtime. */
const NEIGHBOUR_ROUTE = "/cellular/cell-scanner/neighbourcell-scanner";

/**
 * A uniform tier -> its verdict copy and mark, spelled out as LITERALS.
 *
 * `i18n:check` only sees keys it can read statically, so an interpolated
 * `` `verdict_all_${tier}` `` is a key nothing will ever report as missing. The
 * glyphs are the bar-count marks: three verdicts can appear in one slot and
 * `success-container` / `warning-container` are 1.03:1 apart, so the mark is
 * what tells them apart in sunlight, in greyscale and under deuteranopia.
 */
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

/**
 * A signal tier -> its label key, spelled out as LITERALS.
 *
 * The summary tile's disc is a `MaterialSymbol`, which is ligature-driven and
 * therefore always `aria-hidden` — so the tier reaches a screen reader only
 * through this label, rendered `sr-only` inside the disc. Same literal-stem rule
 * as `POSTURE_COPY`: `i18n:check` cannot see an interpolated key, so a key built
 * at runtime is a key nothing will ever report as missing.
 */
const SIGNAL_LABEL_KEY: Record<SignalTier, string> = {
  good: "cell_scanner.signal.good",
  fair: "cell_scanner.signal.fair",
  poor: "cell_scanner.signal.poor",
  none: "cell_scanner.signal.none",
};

export function FullScanner() {
  const { t } = useTranslation("cellular");
  // `elapsedSeconds` is deliberately NOT destructured. The hook still computes
  // and returns it — the transport was left alone so this stays a surface
  // decision — but the running state carries no numbers at all now. See
  // `run-hero.tsx`.
  const { status, results, error, startScan } = useCellScanner();
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

  // Every aggregate on this page, derived once. `summariseSweep` is pure and
  // total: an empty array, a single row and an all-sentinel result set all
  // return a well-formed summary rather than `NaN` or `-Infinity`.
  const summary = React.useMemo(() => summariseSweep(results), [results]);

  const summaryTiles = React.useMemo<SummaryTile[]>(() => {
    const tiles: SummaryTile[] = summary.groups.map((group) => ({
      // The worker can report a cell with no operator name at all. An empty
      // label would render as a blank tile with a disc beside it.
      id: group.provider || "__unnamed",
      label: group.provider || t("cell_scanner.run.summary_provider_unknown"),
      // The tile's disc is the group's best measured tier, graded in
      // `summaries.ts`. The label is the tier in words for a screen reader,
      // since the glyph carrying it is a ligature and always aria-hidden.
      tier: group.tier,
      tierLabel: t(SIGNAL_LABEL_KEY[group.tier]),
      details: [
        // The count moved into the fact line when the tile became a row: the
        // disc holds the left edge now, and a bare numeral with no unit beside
        // it read as a second, competing figure to the rail's count.
        {
          text: t("cell_scanner.results.count", { count: group.cells }),
          voice: "figure" as const,
        },
        ...(group.bands.length > 0
          ? [{ text: group.bands.join(" "), voice: "ident" as const }]
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

    // A dense urban sweep returns roaming partners nobody asked about. The
    // grid caps itself and says so rather than growing into a list.
    if (summary.overflowProviders > 0) {
      tiles.push({
        id: "__overflow",
        label: t("cell_scanner.run.summary_others", {
          count: summary.overflowProviders,
        }),
        // The best tier among the FOLDED groups, not `none`: the overflow may
        // hold the strongest reading of the whole run, and a muted disc there
        // would claim nothing in it was measured.
        tier: summary.overflowTier,
        tierLabel: t(SIGNAL_LABEL_KEY[summary.overflowTier]),
        details: [
          {
            text: t("cell_scanner.results.count", {
              count: summary.overflowCells,
            }),
            voice: "figure" as const,
          },
        ],
      });
    }

    return tiles;
  }, [summary, t]);

  const verdict = React.useMemo<SummaryVerdict | null>(() => {
    if (results.length === 0) return null;

    // Nothing at all was measured: every row is the 0 sentinel. Muted, because
    // that is an absence of readings, not a bad reading.
    if (summary.measured === 0) {
      return {
        tone: "muted",
        glyph: "signal_cellular_off",
        text: t("cell_scanner.run.verdict_no_readings"),
      };
    }

    // A mixed spread gets NO verdict. "The readings vary" explains nothing, and
    // a strip that is always present stops being read.
    if (!summary.uniform) return null;

    const spec = VERDICT_COPY[summary.uniform];
    return {
      tone: spec.tone,
      glyph: spec.glyph,
      text: t(spec.key, { count: summary.measured }),
    };
  }, [results.length, summary, t]);

  // The failed posture's title is the MODEM'S message when it gave one. A
  // generic "Scan failed" over a specific reason is a downgrade — and when it is
  // the modem's own string it is a raw machine string, so it takes machine
  // voice. Authored English never does.
  const usesModemMessage = posture === "failed" && Boolean(error);
  const postureTitle =
    usesModemMessage && error ? error : t(copy.title);

  const postureBody = "body" in copy ? t(copy.body) : null;

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
              // The scan singleton is one `flock` across both routes, so the
              // neighbour read would be refused with `other_scan_running`
              // anyway. Say so here rather than at the far end.
              blockedReason={
                isScanning ? t("cell_scanner.run.link_blocked") : null
              }
            />
          }
          postureTitle={postureTitle}
          postureTitleIsMachine={usesModemMessage}
          postureBody={postureBody}
          metric={hasResults ? results.length : null}
          // THE SWEEP COLLAPSES AT IDLE. It holds the modem's AT lock for
          // 30-180 seconds, so the grow lands once, early, and then the reader
          // waits — the morph reads as the page committing to a long operation.
          idleCollapsed
          summary={
            isScanning || posture === "complete" ? (
              <RunSummary
                // While a sweep runs, the panel would otherwise show the LAST
                // run's numbers under this run's posture.
                isLoading={isScanning}
                tiles={summaryTiles}
                verdict={verdict}
                emptyText={t("cell_scanner.run.summary_empty")}
              />
            ) : null
          }
          actions={
            // NOTHING ON THE FAILED POSTURE, deliberately. The results card
            // below carries the recovery action in that state, so a launch
            // button here would put two buttons on one screen for one act — the
            // same duplication that retired the empty panel's own trigger.
            posture === "failed" ? null : (
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
                  {/* Three distinct labels for three distinct acts. Both
                      scanning routes shipped the identical string "Start New
                      Scan" for runs that differ by ~100x in what they cost the
                      modem. */}
                  {isScanning
                    ? t("cell_scanner.run.scanning_action")
                    : hasResults
                      ? t("cell_scanner.run.rerun")
                      : t("cell_scanner.run.start")}
                </Button>
              </>
            )
          }
        />
      </motion.div>

      {/* NOT RENDERED AT IDLE. There are no results before a run, and a card
          holding nothing but a dashed box announcing that is furniture. It
          ENTERS on the standard card cascade the moment a sweep starts — the
          same `staggerItem` every other card on the page arrives on — and from
          then on it stays through complete, failed and a re-run. */}
      {posture === "idle" ? null : (
      <motion.div variants={staggerItem}>
        <Card className={RESULTS_CARD}>
          <div className={SECTION_HEAD.ROOT}>
            <div className={SECTION_HEAD.TITLES}>
              <h2 className={SECTION_HEAD.TITLE}>
                {t("cell_scanner.results.title")}
              </h2>
              <p className={SECTION_HEAD.DESC}>
                {t("cell_scanner.results.description")}
              </p>
            </div>
          </div>

          {isScanning ? (
            <ScannerSkeleton />
          ) : posture === "failed" ? (
            <ScanErrorState
              // NO `message` HERE, deliberately. The hero rail 200px above
              // already carries the modem's own words as its posture title;
              // passing them again made the failed state two identical
              // disc-title-body stacks on one screen, which is the same "two
              // objects, one fact" duplication that retired the posture chip.
              // The rail names the problem, this panel offers the recovery.
              title={t("cell_scanner.results.error_title")}
              body={t("cell_scanner.results.error_body")}
              retryLabel={t("cell_scanner.results.error_retry")}
              onRetry={startScan}
            />
          ) : results.length > 0 ? (
            <>
              <ScanResultView data={results} onLockCell={handleLockCell} />

              {/* End-justified, below the table's own footer/pager — the
                  header action row now carries only "Sweep again"; exporting a
                  finished sweep is a fact about the table, so it lives at the
                  table's own bottom edge. Mirrors the neighbour route. */}
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
            /* Reached ONLY after a sweep that completed and listed nothing —
               the card does not render before the first run at all. It carries
               NO button: the hero directly above is showing a 0 and a "Sweep
               again" action in exactly this state, and one act gets one
               affordance. */
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
