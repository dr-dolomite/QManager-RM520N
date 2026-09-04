"use client";

import * as React from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDownIcon,
  InboxIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UnplugIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  DUR,
  EASE_QUICK,
  rowCascadeDelay,
  transitionStandard,
} from "@/lib/motion";

import { ConditionBlock } from "./condition-block";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CROSSFADE_STACK,
  DAY,
  FILTER_PILL,
  FILTER_PILL_REST,
  NOTICE,
  NOTICE_GLYPH,
  RAIL,
  TABLE,
} from "./shapes";
import type { LatencySample, ViewMode } from "./use-latency-monitoring";

const MotionTableRow = motion.create(TableRow);

type SortOrder = "newest" | "oldest";

/** The cut the device itself raises `high_packet_loss` on. Below it, loss is
 *  real but survivable; at it, the link is not usable. */
const LOSS_ALERT_PCT = 20;

/** A unit is an annotation beside the reading, never part of the figure. */
const CELL_UNIT = "text-on-surface-variant ml-0.5 text-[0.6875rem] font-normal";

/** A reading the device did not take reads as absent, not as zero. */
const CELL_UNMEASURED = "text-on-surface-variant";

/** Softens the primitive's own hover wash onto a surface role and the scale. */
const ROW_HOVER =
  "hover:bg-surface-container duration-[var(--duration-quick)]";

/** Row entrance. Both the curve and the ten-row cap come from `lib/motion`. */
const sampleRowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

/** A real reading must never print as `0`; below the precision we show, it says
 *  so. Mirrors `formatLatency`'s existing "< 1ms" notation. */
function formatMs(value: number): string {
  if (value === 0) return "0";
  return value < 1 ? "<1" : String(Math.round(value));
}

function formatLoss(pct: number): string {
  if (pct === 0) return "0";
  if (pct >= 10) return String(Math.round(pct));
  const oneDp = Math.round(pct * 10) / 10;
  return oneDp >= 0.1 ? oneDp.toFixed(1) : "<0.1";
}

function dayKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface DayGroup {
  key: string;
  /** null in the daily view, where each bucket already IS a day. */
  label: string | null;
  rows: LatencySample[];
}

export interface SamplesCardProps {
  viewMode: ViewMode;
  /** ALREADY CAPPED to TABLE_CAP by the hook, still oldest first. */
  rows: LatencySample[];
  /** The uncapped count, so the description can say "50 of 312". */
  total: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function SamplesCard({
  viewMode,
  rows,
  total,
  isLoading,
  error,
  onRetry,
}: SamplesCardProps) {
  const { t } = useTranslation("dashboard");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("newest");

  // The cascade is a mount event. Touching the sort rail — or arriving on a new
  // range — retires it rather than re-choreographing fifty rows per press.
  const [cascade, setCascade] = React.useState(true);
  const [seenMode, setSeenMode] = React.useState(viewMode);
  if (viewMode !== seenMode) {
    setSeenMode(viewMode);
    setCascade(false);
  }

  const chooseSort = (next: SortOrder) => {
    setCascade(false);
    setSortOrder(next);
  };

  const sorted = React.useMemo(
    () => (sortOrder === "newest" ? rows.toReversed() : rows),
    [rows, sortOrder],
  );

  const dayLabel = React.useCallback(
    (timestampMs: number): string => {
      const now = Date.now();
      const key = dayKey(timestampMs);
      if (key === dayKey(now)) return t("latencyMonitor.samples.day_today");
      if (key === dayKey(now - 86_400_000))
        return t("latencyMonitor.samples.day_yesterday");
      return new Date(timestampMs).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    },
    [t],
  );

  const groups = React.useMemo<DayGroup[]>(() => {
    if (viewMode === "daily") {
      return sorted.length ? [{ key: "days", label: null, rows: sorted }] : [];
    }
    const out: DayGroup[] = [];
    for (const sample of sorted) {
      const key = dayKey(sample.timestamp);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(sample);
      else out.push({ key, label: dayLabel(sample.timestamp), rows: [sample] });
    }
    return out;
  }, [sorted, viewMode, dayLabel]);

  // A daily bucket has no clock time; the day is the reading, so the cell says
  // the day rather than a fabricated midnight.
  const timeLabel = (sample: LatencySample): string =>
    viewMode === "daily"
      ? dayLabel(sample.timestamp)
      : new Date(sample.timestamp).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          ...(viewMode === "realtime" ? { second: "2-digit" as const } : {}),
        });

  const unreadable = error !== null && rows.length === 0;
  const description = isLoading
    ? t("latencyMonitor.samples.description_loading")
    : unreadable
      ? t("latencyMonitor.samples.description_unreadable")
      : t("latencyMonitor.samples.description", { shown: rows.length, total });

  const dash = <span className={CELL_UNMEASURED}>{t("latencyMonitor.unmeasured")}</span>;

  const renderRtt = (sample: LatencySample) => {
    if (!sample.ok || sample.latency === null) {
      return (
        <Badge variant="destructive">
          <XCircleIcon />
          {t("latencyMonitor.samples.timeout")}
        </Badge>
      );
    }
    return (
      <>
        {formatMs(sample.latency)}
        <span className={CELL_UNIT}>{t("latencyMonitor.unit_ms")}</span>
      </>
    );
  };

  const renderLoss = (sample: LatencySample) => {
    if (sample.loss === null) return dash;
    const ink =
      sample.loss >= LOSS_ALERT_PCT
        ? TABLE.CELL_INK_ALERT
        : sample.loss > 0
          ? TABLE.CELL_INK_WARN
          : undefined;
    return (
      <span className={ink}>
        {formatLoss(sample.loss)}
        <span className={CELL_UNIT}>{t("latencyMonitor.unit_pct")}</span>
      </span>
    );
  };

  let body: React.ReactNode;
  if (error && rows.length === 0) {
    body = (
      <ConditionBlock
        tone="destructive"
        icon={UnplugIcon}
        title={t("latencyMonitor.error.title")}
        description={t("latencyMonitor.error.description", { message: error })}
        actionLabel={t("latencyMonitor.error.retry")}
        actionIcon={RefreshCwIcon}
        onAction={onRetry}
      />
    );
  } else if (!isLoading && rows.length === 0) {
    body = (
      <ConditionBlock
        tone="muted"
        icon={InboxIcon}
        title={t("latencyMonitor.empty.title")}
        description={t("latencyMonitor.empty.description")}
      />
    );
  } else {
    let rendered = -1;
    body = (
      <Table>
        <TableHeader>
          <TableRow className={TABLE.ROW}>
            <TableHead className={TABLE.HEAD}>
              {t("latencyMonitor.samples.col_time")}
            </TableHead>
            <TableHead className={cn(TABLE.HEAD, "text-right")}>
              {t("latencyMonitor.samples.col_rtt")}
            </TableHead>
            <TableHead className={cn(TABLE.HEAD, "text-right")}>
              {t("latencyMonitor.samples.col_jitter")}
            </TableHead>
            <TableHead className={cn(TABLE.HEAD, "text-right")}>
              {t("latencyMonitor.samples.col_loss")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group, groupIndex) => (
            <React.Fragment key={group.key}>
              {group.label !== null ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="px-3 pt-4 pb-2">
                    <div className={DAY.ROOT}>
                      <span className={DAY.LABEL}>{group.label}</span>
                      {groupIndex > 0 ? (
                        <span aria-hidden className={DAY.RULE} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {group.rows.map((sample) => {
                rendered += 1;
                return (
                  <MotionTableRow
                    key={sample.key}
                    className={cn(TABLE.ROW, TABLE.ROW_HEIGHT, ROW_HOVER)}
                    custom={rendered}
                    variants={sampleRowItem}
                    initial={cascade ? "hidden" : false}
                    animate="visible"
                  >
                    <TableCell className={cn(TABLE.CELL, "tabular-nums")}>
                      {timeLabel(sample)}
                    </TableCell>
                    <TableCell className={cn(TABLE.CELL, TABLE.CELL_NUM)}>
                      {renderRtt(sample)}
                    </TableCell>
                    <TableCell className={cn(TABLE.CELL, TABLE.CELL_NUM)}>
                      {sample.jitter === null ? (
                        dash
                      ) : (
                        <>
                          {formatMs(sample.jitter)}
                          <span className={CELL_UNIT}>
                            {t("latencyMonitor.unit_ms")}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className={cn(TABLE.CELL, TABLE.CELL_NUM)}>
                      {renderLoss(sample)}
                    </TableCell>
                  </MotionTableRow>
                );
              })}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("latencyMonitor.samples.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>{description}</CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <div className={RAIL}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(FILTER_PILL, FILTER_PILL_REST, "ml-auto")}
              >
                <ArrowUpDownIcon className="size-3.5" />
                {sortOrder === "newest"
                  ? t("latencyMonitor.samples.sort_newest")
                  : t("latencyMonitor.samples.sort_oldest")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t("latencyMonitor.samples.sort_label")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={sortOrder === "newest"}
                onCheckedChange={() => chooseSort("newest")}
              >
                {t("latencyMonitor.samples.sort_newest")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortOrder === "oldest"}
                onCheckedChange={() => chooseSort("oldest")}
              >
                {t("latencyMonitor.samples.sort_oldest")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* With samples in hand the read failure is a notice above the table,
            never a replacement for it. */}
        {error && rows.length > 0 ? (
          <div role="alert" className={NOTICE}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            {t("latencyMonitor.notice.stale", { message: error })}
          </div>
        ) : null}

        {/* Skeleton and table share one grid cell, so the swap costs no layout
            shift. The range/sort swap is sync rather than `wait`, which latches
            in a throttled tab. */}
        <div className={CROSSFADE_STACK}>
          {isLoading ? (
            <SamplesSkeleton />
          ) : (
            <AnimatePresence>
              <motion.div
                key={`${viewMode}-${sortOrder}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.quick, ease: EASE_QUICK }}
              >
                {body}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Skeleton rows read the SAME pinned height constant the real rows do. */
export function SamplesSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn(TABLE.ROW_HEIGHT, "rounded-inline")} />
      ))}
    </div>
  );
}
