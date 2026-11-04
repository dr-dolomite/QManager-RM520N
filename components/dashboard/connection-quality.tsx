"use client";

import React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HintIcon } from "@/components/ui/hint-icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { TickingValue } from "@/components/ui/ticking-value";

import { useLatencyHistory } from "@/hooks/use-latency-history";
import {
  type ConnectivityStatus,
  type PingHistoryEntry,
} from "@/types/modem-status";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  ABSENT,
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  FIGURE,
  QUALITY,
} from "./shapes";

// --- Thresholds --------------------------------------------------------------

// The strip grades with the poller's own cuts (connectivity.thresholds); these
// are the backend's `tolerant` defaults, used only when an older poller omits them.
const FALLBACK_DEGRADED_MS = 250;
const FALLBACK_DEGRADED_LOSS_PCT = 30;

/** Jitter grading in ms, tuned for cellular scheduling variance. */
const JITTER_STEADY_MS = 15;
const JITTER_ROUGH_MS = 40;

/** Fixed jitter full-scale, so bar height means the same thing every poll. */
const JITTER_TRACK_MAX_MS = 80;

// --- Bucketing ---------------------------------------------------------------

type BucketTone = "none" | "success" | "warning" | "destructive";

interface Bucket {
  measured: boolean;
  tone: BucketTone;
  /** Worst jitter from ANSWERED probes only; null when none answered. */
  jitter: number | null;
}

interface StripThresholds {
  latencyMs: number;
  lossPct: number;
}

/**
 * Folds the archive into QUALITY.BUCKETS spans anchored on the NEWEST entry's
 * modem-clock `ts` (never Date.now()); an empty span stays unmeasured.
 */
function bucketHistory(
  entries: PingHistoryEntry[],
  limits: StripThresholds,
): { buckets: Bucket[]; spanSec: number | null } {
  const empty: Bucket[] = Array.from({ length: QUALITY.BUCKETS }, () => ({
    measured: false,
    tone: "none" as BucketTone,
    jitter: null,
  }));

  if (!Array.isArray(entries) || entries.length === 0) {
    return { buckets: empty, spanSec: null };
  }

  let anchorTs = -Infinity;
  for (const e of entries) {
    if (typeof e?.ts === "number" && e.ts > anchorTs) anchorTs = e.ts;
  }
  if (!Number.isFinite(anchorTs)) return { buckets: empty, spanSec: null };

  const startTs = anchorTs - QUALITY.WINDOW_S;
  const step = QUALITY.WINDOW_S / QUALITY.BUCKETS;

  const rows = Array<number>(QUALITY.BUCKETS).fill(0);
  const failed = Array<number>(QUALITY.BUCKETS).fill(0);
  const touched = Array.from({ length: QUALITY.BUCKETS }, () => false);
  const worstLat: (number | null)[] = Array(QUALITY.BUCKETS).fill(null);
  const worstJit: (number | null)[] = Array(QUALITY.BUCKETS).fill(null);
  const worstLoss: (number | null)[] = Array(QUALITY.BUCKETS).fill(null);

  let oldestVisibleTs: number | null = null;

  for (const e of entries) {
    if (typeof e?.ts !== "number" || !Number.isFinite(e.ts)) continue;
    if (e.ts <= startTs) continue;
    // The anchor sits on the closing edge; clamp it into the newest cell.
    const idx = Math.min(
      QUALITY.BUCKETS - 1,
      Math.max(0, Math.floor((e.ts - startTs) / step)),
    );

    touched[idx] = true;
    rows[idx] += 1;
    if (oldestVisibleTs === null || e.ts < oldestVisibleTs) oldestVisibleTs = e.ts;

    const answered = typeof e.lat === "number" && Number.isFinite(e.lat);
    if (e.lat === null || e.lat === undefined) {
      failed[idx] += 1;
    } else if (answered) {
      const cur = worstLat[idx];
      if (cur === null || e.lat > cur) worstLat[idx] = e.lat;
    }

    // A failed row's `jit` is the window statistic (often a literal 0), not a reading.
    if (answered && typeof e.jit === "number" && Number.isFinite(e.jit)) {
      const cur = worstJit[idx];
      if (cur === null || e.jit > cur) worstJit[idx] = e.jit;
    }

    if (typeof e.loss === "number" && Number.isFinite(e.loss)) {
      const cur = worstLoss[idx];
      if (cur === null || e.loss > cur) worstLoss[idx] = e.loss;
    }
  }

  const buckets: Bucket[] = empty.map((_, i) => {
    if (!touched[i]) return { measured: false, tone: "none", jitter: null };
    const lat = worstLat[i];
    const loss = worstLoss[i];
    // A cell holds only 3-5 rows, so one drop is already 20-33 %: it takes two failed
    // rows at the loss cut (or the poller's rolling loss at it) to go red.
    const failedPct = (failed[i] / rows[i]) * 100;
    const tone: BucketTone =
      (failed[i] >= 2 && failedPct >= limits.lossPct) ||
      (loss !== null && loss >= limits.lossPct)
        ? "destructive"
        : failed[i] > 0 || (lat !== null && lat > limits.latencyMs)
          ? "warning"
          : "success";
    return { measured: true, tone, jitter: worstJit[i] };
  });

  return {
    buckets,
    spanSec: oldestVisibleTs === null ? null : anchorTs - oldestVisibleTs,
  };
}

// --- Presentation ------------------------------------------------------------

const CELL_TONE: Record<BucketTone, string> = {
  none: "bg-surface-container-high",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/** Tone grades the jitter value; bar height encodes it, so colour is never alone. */
function jitterTone(ms: number): string {
  if (ms >= JITTER_ROUGH_MS) return "bg-destructive";
  if (ms >= JITTER_STEADY_MS) return "bg-warning";
  return "bg-success";
}

function reachState(connectivity: ConnectivityStatus | null): {
  key: string;
  className: string;
} {
  switch (connectivity?.status) {
    case "connected":
      return { key: "reach_responsive", className: "text-success-on-surface" };
    case "degraded":
    case "recovery":
      return { key: "reach_degraded", className: "text-warning-on-surface" };
    case "disconnected":
      // ICMP silent but DNS still resolving: ping is filtered, not the link down.
      if (typeof connectivity?.dns_lookup_ms === "number") {
        return { key: "reach_no_ping_reply", className: "text-warning-on-surface" };
      }
      return { key: "reach_unreachable", className: "text-destructive-on-surface" };
    default:
      return { key: "reach_unknown", className: "text-on-surface-variant" };
  }
}

/** An outage length, coarsest two units: "45s", "1m 46s", "2h 5m", "3d 4h". */
function formatOutage(sec: number, t: TFunction): string {
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return t("connection_quality.dur_dh", { d, h });
  if (h > 0) return t("connection_quality.dur_hm", { h, m });
  if (m > 0) return t("connection_quality.dur_ms", { m, s: s % 60 });
  return t("connection_quality.dur_s", { s });
}

/** How long ago, from a modem-side age in seconds (never the browser clock). */
function formatAgo(sec: number, t: TFunction): string {
  if (sec < 60) return t("activities.time.just_now");
  if (sec < 3600) return t("activities.time.minutes", { count: Math.floor(sec / 60) });
  if (sec < 86400) return t("activities.time.hours", { count: Math.floor(sec / 3600) });
  return t("activities.time.days", { count: Math.floor(sec / 86400) });
}

// --- Latency row -------------------------------------------------------------

/** A null value reaches MetricBar untouched, so "no reading" is an empty track.
 *  Amber from the configured latency cut (as on the strip), red from twice it. */
function LatencyRow({
  icon,
  label,
  value,
  unit,
  cutMs,
}: {
  icon: MaterialSymbolName;
  label: string;
  value: number | null;
  unit: string;
  cutMs: number;
}) {
  return (
    <div className="flex h-5 items-center gap-2">
      <MaterialSymbol
        name={icon}
        size={16}
        className="shrink-0 text-on-surface-variant"
      />
      <span className="min-w-0 grow truncate text-[13px] font-semibold text-on-surface-variant">
        {label}
      </span>
      <span className={QUALITY.LANE}>
        <MetricBar
          value={value}
          max={cutMs * 2}
          warnAt={cutMs}
          dangerAt={cutMs * 2}
          baseTone="success"
          track="surface-container-high"
        />
      </span>
      <span
        className={cn(
          QUALITY.VALUE_COL,
          "text-sm font-semibold tabular-nums text-on-surface",
        )}
      >
        {value === null ? (
          ABSENT
        ) : (
          <>
            <TickingValue value={value}>{Math.round(value)}</TickingValue>
            <em className="font-semibold text-on-surface-variant not-italic">
              {` ${unit}`}
            </em>
          </>
        )}
      </span>
    </div>
  );
}

// --- Skeleton ----------------------------------------------------------------

function QualitySkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className={QUALITY.TILE}>
        {/* Internet, DNS, Probing and Last outage rows. */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-5 items-center gap-2">
            <Skeleton className="size-4 rounded-inline" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className={cn(QUALITY.LANE, "ml-auto h-2 rounded-pill")} />
            <Skeleton className={cn(QUALITY.VALUE_COL, "h-3.5")} />
          </div>
        ))}
      </div>

      {[0, 1].map((s) => (
        <div key={s} className="flex flex-col gap-1.5">
          <div className={QUALITY.LABEL_ROW}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton
            className="w-full rounded-[3px]"
            style={{ height: QUALITY.TRACK_H }}
          />
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-8" />
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-surface-container-high pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-[22px] w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Card --------------------------------------------------------------------

interface ConnectionQualityProps {
  /** The poller's `connectivity` block. Null until the first poll lands. */
  connectivity: ConnectivityStatus | null;
  isLoading: boolean;
  modemReachable: boolean;
}

const ConnectionQualityComponent = ({
  connectivity,
  isLoading,
  modemReachable,
}: ConnectionQualityProps) => {
  const { t } = useTranslation("dashboard");
  // The strip folds only the newest 30 min; 400 rows covers it at the 10-16 s row cadence.
  const { data: history } = useLatencyHistory({ last: 400 });

  const latencyCut = connectivity?.thresholds?.latency_ms;
  const lossCut = connectivity?.thresholds?.loss_pct;
  const { buckets, spanSec } = React.useMemo(
    () =>
      bucketHistory(history, {
        latencyMs: latencyCut ?? FALLBACK_DEGRADED_MS,
        lossPct: lossCut ?? FALLBACK_DEGRADED_LOSS_PCT,
      }),
    [history, latencyCut, lossCut],
  );

  const header = (
    <CardHeader className="px-0">
      <CardTitle className={CARD_TITLE}>{t("connection_quality.title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("connection_quality.description")}
      </CardDescription>
    </CardHeader>
  );

  const shell = (body: React.ReactNode) => (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className="flex flex-1 flex-col px-0">{body}</CardContent>
    </Card>
  );

  if (isLoading) return shell(<QualitySkeleton />);

  // Only when no poll has ever landed; later failures keep the last reading.
  if (!modemReachable && !connectivity) {
    return shell(
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MaterialSymbol name="cloud_off" size={24} />
          </EmptyMedia>
          <EmptyTitle>{t("connection_quality.error_title")}</EmptyTitle>
          <EmptyDescription className="max-w-xs text-pretty">
            {t("connection_quality.error_description")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
  }

  // `internet_available === null` means the ping daemon is not reporting — not an outage.
  if (connectivity && connectivity.internet_available === null) {
    return shell(
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MaterialSymbol name="radar" size={24} />
          </EmptyMedia>
          <EmptyTitle>{t("connection_quality.empty_title")}</EmptyTitle>
          <EmptyDescription className="max-w-xs text-pretty">
            {t("connection_quality.empty_description")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="secondary">
            <Link href="/monitoring/connection-quality">
              {t("connection_quality.empty_action")}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>,
    );
  }

  const latencyMs = connectivity?.latency_ms ?? null;
  // Absent field = no DNS probe on this poller (omit the row); null = probed, no answer.
  const hasDnsField =
    connectivity !== null && connectivity.dns_lookup_ms !== undefined;
  const dnsMs = connectivity?.dns_lookup_ms ?? null;
  // While the current probe fails, `jitter_ms` is a stale window statistic.
  const jitterMs = latencyMs === null ? null : (connectivity?.jitter_ms ?? null);
  const reach = reachState(connectivity);
  const probeTarget = connectivity?.ping_target;
  // Absent field = older poller (omit the row); null = no outage has cleared this boot.
  const hasOutageField =
    connectivity !== null && connectivity.last_outage_s !== undefined;
  const outageS = connectivity?.last_outage_s ?? null;
  const outageAgoS = connectivity?.last_outage_ago_s ?? null;
  // Read from the routing table when the outage cleared; null when unknown.
  const outageWanIp = connectivity?.last_outage_wan_ip ?? null;
  const outageWanChanged = connectivity?.last_outage_wan_changed ?? null;
  const outageWanKey =
    outageWanChanged === true
      ? "last_outage_ip_new"
      : outageWanChanged === false
        ? "last_outage_ip_same"
        : "last_outage_ip_known";

  const spanMinutes = spanSec === null ? null : Math.floor(spanSec / 60);
  const axisReach =
    spanMinutes === null
      ? t("connection_quality.axis_reach_none")
      : spanMinutes < 1
        ? t("connection_quality.axis_reach_sub_minute")
        : t("connection_quality.axis_reach", { count: spanMinutes });
  const windowMinutes = Math.round(QUALITY.WINDOW_S / 60);

  const latencyTile = (
    <div className={QUALITY.TILE}>
      <LatencyRow
        icon="public"
        label={t("connection_quality.internet")}
        value={latencyMs}
        unit={t("connection_quality.unit_ms")}
        cutMs={latencyCut ?? FALLBACK_DEGRADED_MS}
      />
      {hasDnsField ? (
        <LatencyRow
          icon="dns"
          label={t("connection_quality.dns")}
          value={dnsMs}
          unit={t("connection_quality.unit_ms")}
          cutMs={latencyCut ?? FALLBACK_DEGRADED_MS}
        />
      ) : null}
      {probeTarget ? (
        <div className="flex h-5 items-center gap-2">
          <MaterialSymbol
            name="radar"
            size={16}
            className="shrink-0 text-on-surface-variant"
          />
          <span className="min-w-0 grow truncate text-[13px] font-semibold text-on-surface-variant">
            {t("connection_quality.probing")}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold font-mono text-on-surface">
            {probeTarget}
          </span>
        </div>
      ) : null}
      {hasOutageField ? (
        // Wraps like PillRow: the value drops to its own line before it can overlap the key.
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
          <MaterialSymbol
            name="history"
            size={16}
            className="shrink-0 text-on-surface-variant"
          />
          <span className="shrink-0 grow text-[13px] font-semibold text-on-surface-variant">
            {t("connection_quality.last_outage")}
          </span>
          {outageS === null ? (
            <span className="ml-auto shrink-0 text-sm font-semibold text-on-surface-variant">
              {t("connection_quality.last_outage_none")}
            </span>
          ) : (
            <span className="ml-auto flex flex-wrap items-center justify-end gap-x-1 text-sm font-semibold tabular-nums text-on-surface">
              {/* The tip qualifies the reading, so it leads the value it describes. */}
              <span className="flex items-center gap-1 whitespace-nowrap">
                {outageWanIp ? (
                  <HintIcon label={t("connection_quality.last_outage_ip_label")}>
                    {t(`connection_quality.${outageWanKey}`)}{" "}
                    <span className="font-mono">{outageWanIp}</span>
                  </HintIcon>
                ) : null}
                {formatOutage(outageS, t)}
              </span>
              {outageAgoS !== null ? (
                <span className="whitespace-nowrap text-on-surface-variant">
                  {t("connection_quality.last_outage_ago", { ago: formatAgo(outageAgoS, t) })}
                </span>
              ) : null}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );

  const reachStrip = (
    <div className="flex flex-col gap-1.5">
      <div className={QUALITY.LABEL_ROW}>
        <span className="truncate text-[11px] font-semibold tracking-[0.02em] text-on-surface-variant">
          {t("connection_quality.reach_label")}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px] leading-tight font-semibold",
            reach.className,
          )}
        >
          {t(`connection_quality.${reach.key}`)}
        </span>
      </div>
      <div
        className={cn(QUALITY.ROW, QUALITY.GAP)}
        role="img"
        aria-label={t("connection_quality.reach_aria", { minutes: windowMinutes })}
      >
        {buckets.map((b, i) => (
          <span
            key={i}
            className={cn(QUALITY.CELL, CELL_TONE[b.tone])}
            style={{ height: QUALITY.TRACK_H }}
          />
        ))}
      </div>
    </div>
  );

  const jitterStrip = (
    <div className="flex flex-col gap-1.5">
      <div className={QUALITY.LABEL_ROW}>
        <span className="truncate text-[11px] font-semibold tracking-[0.02em] text-on-surface-variant">
          {t("connection_quality.jitter_label")}
        </span>
        <span className="shrink-0 text-[11px] leading-tight font-semibold tabular-nums text-on-surface">
          {jitterMs === null
            ? t("connection_quality.jitter_no_reading")
            : t("connection_quality.jitter_now", { value: Math.round(jitterMs) })}
        </span>
      </div>
      <div
        className={cn(QUALITY.ROW, QUALITY.GAP)}
        style={{ height: QUALITY.TRACK_H }}
        role="img"
        aria-label={t("connection_quality.jitter_aria", { minutes: windowMinutes })}
      >
        {buckets.map((b, i) => {
          // Unmeasured and all-lost spans both have no jitter reading: a muted stub.
          if (!b.measured || b.jitter === null) {
            return (
              <span
                key={i}
                className={cn(QUALITY.BAR, "bg-surface-container-high")}
                style={{ height: QUALITY.STUB_H }}
              />
            );
          }
          const ratio = Math.min(1, Math.max(0, b.jitter / JITTER_TRACK_MAX_MS));
          const height = Math.max(
            QUALITY.MEASURED_MIN_H,
            Math.round(ratio * QUALITY.TRACK_H),
          );
          return (
            <span
              key={i}
              className={cn(QUALITY.BAR, jitterTone(b.jitter))}
              style={{ height }}
            />
          );
        })}
      </div>
    </div>
  );

  const axis = (
    <div className="flex items-center justify-between gap-2 text-[10.5px] leading-tight text-on-surface-variant">
      <span className="truncate tabular-nums">{axisReach}</span>
      <span className="shrink-0">{t("connection_quality.axis_now")}</span>
    </div>
  );

  // A null aggregate means "window too short", never zero.
  const footerFigure = (
    labelKey: string,
    value: number | null,
    unit: string,
    decimals = 0,
  ) => (
    <div className={FIGURE.ROOT}>
      <span className={FIGURE.LABEL}>{t(labelKey)}</span>
      <span className={FIGURE.VALUE}>
        {value === null ? (
          ABSENT
        ) : (
          <>
            <TickingValue value={value}>{value.toFixed(decimals)}</TickingValue>
            <span className={FIGURE.UNIT}>{unit}</span>
          </>
        )}
      </span>
    </div>
  );

  // Variants only: this cascade inherits the page clock in home-component.tsx.
  return shell(
    <motion.div className="flex flex-1 flex-col gap-3" variants={staggerRows}>
      <motion.div variants={staggerRowItem}>{latencyTile}</motion.div>
      <motion.div variants={staggerRowItem}>{reachStrip}</motion.div>
      <motion.div variants={staggerRowItem}>{jitterStrip}</motion.div>
      <motion.div variants={staggerRowItem}>{axis}</motion.div>
      <motion.div
        variants={staggerRowItem}
        className="mt-auto grid grid-cols-3 gap-2 border-t border-surface-container-high pt-3"
      >
        {footerFigure(
          "connection_quality.footer_typical",
          connectivity?.avg_latency_ms ?? null,
          t("connection_quality.unit_ms"),
        )}
        {footerFigure(
          "connection_quality.footer_worst",
          connectivity?.max_latency_ms ?? null,
          t("connection_quality.unit_ms"),
        )}
        {footerFigure(
          "connection_quality.footer_loss",
          connectivity?.packet_loss_pct ?? null,
          t("connection_quality.unit_pct"),
          1,
        )}
      </motion.div>
    </motion.div>,
  );
};

export default ConnectionQualityComponent;
