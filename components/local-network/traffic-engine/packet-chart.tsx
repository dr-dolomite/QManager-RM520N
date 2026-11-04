"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CHART_FLOOR, CHART_HEIGHT_PX, CHART_WASH, LIVE } from "./shapes";

/** One minute of history, one sample per 2 s poll (the hooks' cadence). */
export const CHART_SAMPLES = 30;

const TOP = 16;
const BOTTOM = 2;
const TICKS = [1, 0.5, 0] as const;
const CEILINGS = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];

function niceCeil(v: number) {
  for (const s of CEILINGS) if (v <= s) return s;
  return Math.ceil(v / 5000) * 5000;
}

type Point = readonly [number, number];

/** Monotone cubic through the points, so the curve never overshoots a sample. */
function monotone(pts: Point[]) {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const d: number[] = [];
  const t: number[] = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  }
  t[0] = d[0];
  t[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / d[i];
    const b = t[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * d[i];
      t[i + 1] = k * b * d[i];
    }
  }
  let p = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1][0] - pts[i][0];
    p += `C${(pts[i][0] + h / 3).toFixed(1)},${(pts[i][1] + (t[i] * h) / 3).toFixed(1)} ${(pts[i + 1][0] - h / 3).toFixed(1)},${(pts[i + 1][1] - (t[i + 1] * h) / 3).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return p;
}

interface PacketChartProps {
  /** Oldest first, one entry per poll. `null` is a gap (idle or restarting), never a zero. */
  history: readonly (number | null)[];
  /** A mode is running: draws the endpoint and its pulse. */
  live: boolean;
}

/**
 * New connections the engine redirected per second over the last minute (a nat REDIRECT
 * counter, not packets). The ceiling never drops under `CHART_FLOOR`.
 */
export function PacketChart({ history, live }: PacketChartProps) {
  const { t } = useTranslation("local-network");
  const gradientId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = CHART_HEIGHT_PX;
  const values = history.filter((v): v is number => v !== null);
  const peak = values.length ? Math.max(...values) : 0;
  const ceil = niceCeil(Math.max(CHART_FLOOR, peak * 1.12));
  const span = Math.max(1, history.length - 1);
  const x = (i: number) => (i / span) * width;
  const y = (v: number) => TOP + (1 - v / ceil) * (h - TOP - BOTTOM);

  const runs: Point[][] = [];
  let run: Point[] = [];
  history.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push([x(i), y(v)]);
    }
  });
  if (run.length) runs.push(run);

  const last = history[history.length - 1];
  const fmt = (n: number) => Math.round(n).toLocaleString();

  return (
    <div>
      <div ref={ref} className={LIVE.PLOT}>
        <svg
          width={width}
          height={h}
          viewBox={`0 0 ${width} ${h}`}
          className="block overflow-visible"
          role="img"
          aria-label={
            values.length
              ? t("traffic_engine.chart_aria", { max: fmt(peak) })
              : t("traffic_engine.chart_aria_idle")
          }
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--foreground)"
                stopOpacity={CHART_WASH.TOP}
              />
              <stop
                offset="100%"
                stopColor="var(--foreground)"
                stopOpacity={CHART_WASH.BOTTOM}
              />
            </linearGradient>
          </defs>
          <g>
            {TICKS.map((f) => (
              <line
                key={f}
                x1={0}
                x2={width}
                y1={y(ceil * f)}
                y2={y(ceil * f)}
                strokeWidth={1}
                className={LIVE.GRIDLINE}
              />
            ))}
          </g>
          {runs.map((r, i) => {
            const line = monotone(r);
            const area =
              r.length > 1
                ? `${line}L${r[r.length - 1][0].toFixed(1)},${h - BOTTOM}L${r[0][0].toFixed(1)},${h - BOTTOM}Z`
                : "";
            return (
              <g key={i}>
                {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
                <path
                  d={line}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={LIVE.LINE}
                />
              </g>
            );
          })}
          {live && last !== null && last !== undefined ? (
            <g>
              <circle
                cx={x(history.length - 1)}
                cy={y(last)}
                r={4}
                className={LIVE.ENDPOINT_RING}
              />
              <circle
                cx={x(history.length - 1)}
                cy={y(last)}
                r={4}
                className={LIVE.ENDPOINT}
              />
            </g>
          ) : null}
        </svg>
        {TICKS.map((f) => (
          <span
            key={f}
            aria-hidden="true"
            className={LIVE.Y_LABEL}
            style={{ top: y(ceil * f) }}
          >
            {fmt(ceil * f)}
          </span>
        ))}
        {values.length === 0 ? (
          <div className={LIVE.EMPTY}>
            {t(live ? "traffic_engine.chart_waiting" : "traffic_engine.chart_empty")}
          </div>
        ) : null}
      </div>
      <div className={LIVE.X_AXIS} aria-hidden="true">
        <span>{t("traffic_engine.chart_x_start")}</span>
        <span>{t("traffic_engine.chart_x_end")}</span>
      </div>
    </div>
  );
}

