"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type {
  ConnectivityState,
  ConnectivityStatus,
  PingHistoryEntry,
} from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  MIN_STAT_SAMPLES,
  STRIP_SLOTS,
  formatPct,
  hhmm,
  lastAnswer,
  latencyTone,
  lossTone,
  msParts,
  msText,
  resolveCuts,
  spanParts,
  type Cuts,
  type SpanUnit,
  type UnitLabels,
} from "./derive";
import {
  BAR_FILL,
  CARD_BODY,
  CARD_DESC,
  CARD_FILL,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  EYEBROW,
  EYEBROW_H,
  FIGURE_INK,
  NOW,
  ROWS,
  STATUS_LABEL_KEY,
  STATUS_VARIANT,
  STRIP,
  TRANSITION_FILL,
  TRANSITION_INK,
} from "./shapes";

/** One distinct glyph per state, so the chip never leans on its fill alone. */
const STATUS_GLYPH: Record<ConnectivityState, LucideIcon> = {
  connected: CircleCheckIcon,
  degraded: TriangleAlertIcon,
  disconnected: CircleXIcon,
  recovery: RotateCwIcon,
  unknown: ClockIcon,
};

const FAMILY_LABEL_KEY = {
  ipv4: "latencyMonitor.now.family_ipv4",
  ipv6: "latencyMonitor.now.family_ipv6",
} as const;

const LIMITS_HREF = "/monitoring/connection-quality/";

/** Height of a probe's bar: RTT against twice the cut, floored so it reads. */
function barHeight(ms: number, cuts: Cuts): string {
  const pct = Math.max(12, Math.min(100, (ms / (cuts.latencyMs * 2)) * 100));
  return `${pct.toFixed(1)}%`;
}

function NowSkeleton() {
  return (
    <>
      <div className={NOW.FIGURE} aria-hidden>
        <Skeleton className={cn(EYEBROW_H, "w-28 rounded-inline")} />
        <Skeleton className={cn(NOW.VALUE_H, "w-32 rounded-inline")} />
        <Skeleton className={cn(NOW.CAPTION_H, "w-48 rounded-inline")} />
        <Skeleton className={cn(NOW.BAR, "bg-accent")} />
      </div>
      <div className={STRIP.ROOT} aria-hidden>
        <Skeleton className={cn(STRIP.BARS_H, "rounded-inline")} />
        <div className={STRIP.FOOT}>
          <Skeleton className={cn(STRIP.FOOT_H, "w-16 rounded-inline")} />
          <Skeleton className={cn(STRIP.FOOT_H, "w-8 rounded-inline")} />
        </div>
      </div>
      <div className={ROWS.ROOT} aria-hidden>
        {Array.from({ length: ROWS.COUNT }).map((_, i) => (
          <div key={i} className={ROWS.ROW}>
            <Skeleton className="h-[0.8125rem] w-20 rounded-inline" />
            <Skeleton className="h-[0.8125rem] w-16 rounded-inline" />
          </div>
        ))}
      </div>
    </>
  );
}

interface ProbeStripProps {
  slots: (number | null | undefined)[];
  cuts: Cuts;
  units: UnitLabels;
  intervalSec: number;
  ariaLabel: string;
}

/** The 60-probe strip, with a hover readout of the probe under the pointer. */
function ProbeStrip({ slots, cuts, units, intervalSec, ariaLabel }: ProbeStripProps) {
  const { t } = useTranslation("dashboard");
  const [hover, setHover] = useState<number | null>(null);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * slots.length);
    const at = Math.max(0, Math.min(slots.length - 1, i));
    setHover(slots[at] === undefined ? null : at);
  };

  const probe = hover === null ? undefined : slots[hover];
  let readout: React.ReactNode = null;
  if (hover !== null && probe !== undefined) {
    const age = (slots.length - 1 - hover) * intervalSec;
    const ageText =
      age === 0
        ? t("latencyMonitor.now.strip_end")
        : age < 60
          ? t("latencyMonitor.now.probe_seconds", { seconds: age })
          : t("latencyMonitor.now.strip_start", { minutes: Math.round(age / 60) });
    // Clamped so the readout never hangs past the card edge.
    const left = Math.min(88, Math.max(12, ((hover + 0.5) / slots.length) * 100));
    readout = (
      <span className={STRIP.READOUT} style={{ left: `${left}%` }}>
        <span className={cn(STRIP.READOUT_VALUE, FIGURE_INK[probe === null ? "bad" : latencyTone(probe, cuts)])}>
          {probe === null ? t("latencyMonitor.now.no_reply") : msText(probe, units)}
        </span>
        <span className={STRIP.READOUT_AGE}>{ageText}</span>
      </span>
    );
  }

  return (
    <div
      className={STRIP.HOVER_ROOT}
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => setHover(null)}
    >
      <div className={STRIP.BARS} role="img" aria-label={ariaLabel}>
        {slots.map((v, i) => {
          const dim = hover !== null && hover !== i && STRIP.DIM;
          return v === undefined ? (
            <span key={i} className={cn(STRIP.BAR, STRIP.EMPTY)} />
          ) : v === null ? (
            <span key={i} className={cn(STRIP.BAR, STRIP.MISS, STRIP.BAR_FADE, dim)} />
          ) : (
            <span
              key={i}
              className={cn(STRIP.BAR, BAR_FILL[latencyTone(v, cuts)], STRIP.BAR_FADE, dim)}
              style={{ height: barHeight(v, cuts) }}
            />
          );
        })}
      </div>
      {readout}
    </div>
  );
}

interface NowBodyProps {
  connectivity: ConnectivityStatus;
  history: PingHistoryEntry[];
  snapshotAt: number | null;
  onOutage: () => void;
}

function NowBody({ connectivity, history, snapshotAt, onOutage }: NowBodyProps) {
  const { t } = useTranslation("dashboard");
  const cuts = resolveCuts(connectivity);
  const units: UnitLabels = {
    ms: t("latencyMonitor.unit_ms"),
    s: t("latencyMonitor.unit_s"),
  };
  const spanUnits: Record<SpanUnit, string> = {
    s: t("latencyMonitor.unit_s"),
    min: t("latencyMonitor.unit_min"),
    h: t("latencyMonitor.unit_h"),
    d: t("latencyMonitor.unit_d"),
  };
  const dash = t("latencyMonitor.unmeasured");

  const probes = (connectivity.latency_history ?? []).slice(-STRIP_SLOTS);
  const failed = probes.filter((v) => v === null).length;
  const slots: (number | null | undefined)[] = [
    ...Array<undefined>(Math.max(0, STRIP_SLOTS - probes.length)).fill(undefined),
    ...probes,
  ];
  const intervalSec = connectivity.history_interval_sec || 5;
  const stripMinutes = Math.max(1, Math.round((STRIP_SLOTS * intervalSec) / 60));

  const rtt = connectivity.latency_ms;
  const parts = rtt === null ? null : msParts(rtt);
  // The archive's own timestamp; ring slots are not evenly spaced during an outage.
  const down = rtt === null;
  const found = down ? lastAnswer(history) : null;
  const outageSec = found && snapshotAt !== null ? snapshotAt - found.atMs / 1000 : NaN;
  const outage = spanParts(outageSec);
  const last = found && outage.length > 0 ? found : null;
  // Pull the archive forward when an outage starts, so its newest answer is fresh.
  useEffect(() => {
    if (down) onOutage();
  }, [down, onOutage]);
  // A live reading takes its tone; an outage reads in plain ink, the chip carries the verdict.
  const tone = rtt === null ? "ok" : latencyTone(rtt, cuts);

  let caption = "";
  if (rtt !== null) {
    if (connectivity.avg_latency_ms !== null && connectivity.max_latency_ms !== null) {
      caption = t("latencyMonitor.now.caption", {
        average: msText(connectivity.avg_latency_ms, units),
        worst: msText(connectivity.max_latency_ms, units),
      });
    }
  } else if (last) {
    caption = t("latencyMonitor.now.last_answer", {
      time: hhmm(last.atMs),
      value: msText(last.ms, units),
    });
  } else {
    caption = t("latencyMonitor.now.no_reply");
  }

  let figure: React.ReactNode;
  if (parts) {
    figure = (
      <>
        {parts.value}
        <small className={NOW.VALUE_UNIT}>{units[parts.unit]}</small>
      </>
    );
  } else if (last) {
    figure = outage.map((p, i) => (
      <Fragment key={p.unit}>
        <span className={cn(i > 0 && NOW.VALUE_PAIR)}>{p.value}</span>
        <small className={NOW.VALUE_UNIT}>{spanUnits[p.unit]}</small>
      </Fragment>
    ));
  } else {
    figure = <span className={NOW.VALUE_DASH}>{dash}</span>;
  }

  const collecting =
    probes.length < MIN_STAT_SAMPLES ? (
      <span className={ROWS.QUIET}>
        {t("latencyMonitor.now.collecting", {
          done: probes.length,
          total: MIN_STAT_SAMPLES,
        })}
      </span>
    ) : (
      <span className={ROWS.QUIET}>{dash}</span>
    );

  const jitter = connectivity.jitter_ms;
  const loss = connectivity.packet_loss_pct;
  const lossT = loss === null ? null : lossTone(loss, cuts);
  const family =
    connectivity.last_family === "ipv4" || connectivity.last_family === "ipv6"
      ? connectivity.last_family
      : null;

  return (
    <>
      <div className={NOW.FIGURE}>
        <span className={cn(EYEBROW, EYEBROW_H)}>
          {t(last ? "latencyMonitor.now.eyebrow_down" : "latencyMonitor.now.eyebrow")}
        </span>
        <span className={cn(NOW.VALUE, NOW.VALUE_H, FIGURE_INK[tone], TRANSITION_INK)}>
          {figure}
        </span>
        <span className={cn(NOW.CAPTION, NOW.CAPTION_H)}>{caption}</span>
        <div
          className={NOW.BAR}
          role="img"
          aria-label={t("latencyMonitor.now.bar_aria", {
            limit: msText(cuts.latencyMs, units),
          })}
        >
          {rtt !== null ? (
            <span
              className={cn(NOW.BAR_FILL, BAR_FILL[tone], TRANSITION_FILL)}
              style={{
                width: `${Math.min(100, (rtt / (cuts.latencyMs * 2)) * 100)}%`,
              }}
            />
          ) : null}
          <span aria-hidden className={NOW.BAR_TICK} />
        </div>
      </div>

      <div className={STRIP.ROOT}>
        <ProbeStrip
          slots={slots}
          cuts={cuts}
          units={units}
          intervalSec={connectivity.history_interval_sec || 5}
          ariaLabel={t("latencyMonitor.now.strip_aria", {
            total: probes.length,
            failed,
          })}
        />
        <div className={STRIP.FOOT}>
          <span>{t("latencyMonitor.now.strip_start", { minutes: stripMinutes })}</span>
          <span>{t("latencyMonitor.now.strip_end")}</span>
        </div>
      </div>

      <dl className={ROWS.ROOT}>
        <div className={ROWS.ROW}>
          <dt className={ROWS.KEY}>{t("latencyMonitor.now.jitter")}</dt>
          <dd className={ROWS.VALUE}>
            {jitter !== null ? msText(jitter, units) : collecting}
          </dd>
        </div>
        <div className={ROWS.ROW}>
          <dt className={ROWS.KEY}>{t("latencyMonitor.now.loss")}</dt>
          <dd className={ROWS.VALUE}>
            {loss !== null && lossT !== null ? (
              <>
                <span aria-hidden className={ROWS.LANE}>
                  <span
                    className={cn(NOW.BAR_FILL, BAR_FILL[lossT], TRANSITION_FILL)}
                    style={{ width: `${Math.min(100, loss)}%` }}
                  />
                </span>
                <span className={cn(FIGURE_INK[lossT], TRANSITION_INK)}>
                  {formatPct(loss)} {t("latencyMonitor.unit_pct")}
                </span>
              </>
            ) : (
              collecting
            )}
          </dd>
        </div>
        <div className={ROWS.ROW}>
          <dt className={ROWS.KEY}>{t("latencyMonitor.now.target")}</dt>
          <dd className={ROWS.VALUE}>
            <span className={ROWS.MONO}>{connectivity.ping_target || dash}</span>
            {family ? (
              <Tag variant="neutral">{t(FAMILY_LABEL_KEY[family])}</Tag>
            ) : null}
          </dd>
        </div>
        <div className={ROWS.ROW}>
          <dt className={ROWS.KEY}>{t("latencyMonitor.now.limits")}</dt>
          <dd className={ROWS.VALUE}>
            <Link href={LIMITS_HREF} className={ROWS.LINK}>
              {t("latencyMonitor.now.limits_value", {
                latency: msText(cuts.latencyMs, units),
                loss: `${cuts.lossPct} ${t("latencyMonitor.unit_pct")}`,
              })}
              <ArrowUpRightIcon aria-hidden className={ROWS.LINK_GLYPH} />
            </Link>
          </dd>
        </div>
      </dl>
    </>
  );
}

export interface NowCardProps {
  connectivity: ConnectivityStatus | null;
  history: PingHistoryEntry[];
  /** Modem clock of the connectivity snapshot; an outage is dated against it. */
  snapshotAt: number | null;
  unreachable: boolean;
  onRetry: () => void;
  /** Called when the live reading goes missing, to refresh the archive. */
  onOutage: () => void;
}

export function NowCard({
  connectivity,
  history,
  snapshotAt,
  unreachable,
  onRetry,
  onOutage,
}: NowCardProps) {
  const { t } = useTranslation("dashboard");
  const status = unreachable ? "unknown" : (connectivity?.status ?? "unknown");
  const Glyph = STATUS_GLYPH[status];

  return (
    <Card className={cn(CARD_SHELL, CARD_FILL)}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("latencyMonitor.now.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("latencyMonitor.now.description")}
        </CardDescription>
        <CardAction>
          {unreachable || connectivity ? (
            <Badge variant={STATUS_VARIANT[status]}>
              <Glyph className="size-3" />
              {t(STATUS_LABEL_KEY[status])}
            </Badge>
          ) : (
            <Skeleton className={NOW.BADGE_SK} />
          )}
        </CardAction>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {unreachable ? (
          <ConditionBlock
            tone="destructive"
            icon={WifiOffIcon}
            title={t("latencyMonitor.unreachable.title")}
            description={t("latencyMonitor.unreachable.description")}
            actionLabel={t("latencyMonitor.retry")}
            onAction={onRetry}
            actionIcon={RotateCwIcon}
          />
        ) : connectivity ? (
          <NowBody
            connectivity={connectivity}
            history={history}
            snapshotAt={snapshotAt}
            onOutage={onOutage}
          />
        ) : (
          <NowSkeleton />
        )}
      </CardContent>
    </Card>
  );
}
