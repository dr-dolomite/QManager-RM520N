"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { BandFigure, BandView, StripView } from "./derive";
import {
  DISC_LIVE,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FIGURE_TONE,
  HERO_PAD,
  HERO_SHELL,
  SKELETON,
  STATUS,
  STRIP,
} from "./shapes";

/** A reading the device did not report. Never a zero, which is a claim. */
const ABSENT = "—";

function Figure({ figure }: { figure: BandFigure }) {
  const { t } = useTranslation("common");
  return (
    <div className={STATUS.FIG}>
      <span className={cn(EYEBROW, STATUS.FIG_EYEBROW)}>{t(figure.eyebrowKey)}</span>
      <span className={cn(STATUS.FIG_VALUE, FIGURE_TONE[figure.tone])}>
        {figure.value === null ? (
          <>
            <span aria-hidden>{ABSENT}</span>
            <span className="sr-only">{t("watchdog.band.absent")}</span>
          </>
        ) : (
          figure.value
        )}
      </span>
      <span className={STATUS.FIG_CAPTION}>
        {t(figure.captionKey, figure.captionParams)}
      </span>
    </div>
  );
}

function ProbeStrip({ strip }: { strip: StripView }) {
  const { t } = useTranslation("common");
  if (strip.kind === "empty") {
    return <div className={STRIP.EMPTY}>{t("watchdog.strip.empty")}</div>;
  }
  return (
    <div className={STRIP.ROOT}>
      <div className={STRIP.HEAD}>
        <span className={STRIP.TITLE}>{t("watchdog.strip.title")}</span>
        <span className={STRIP.HEAD_END}>
          {strip.missed > 0 ? (
            <Badge variant="destructive">
              <XCircleIcon className="size-3" />
              {t("watchdog.strip.noReply", { n: strip.missed })}
            </Badge>
          ) : null}
          {strip.avgMs !== null ? (
            <span>{t("watchdog.strip.average", { ms: strip.avgMs })}</span>
          ) : null}
        </span>
      </div>
      <div
        role="img"
        aria-label={t("watchdog.strip.aria", {
          total: strip.total,
          missed: strip.missed,
        })}
        className={STRIP.BARS}
      >
        {strip.bars.map((bar, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              STRIP.BAR,
              bar.kind === "ok"
                ? STRIP.BAR_OK
                : bar.kind === "miss"
                  ? STRIP.BAR_MISS
                  : STRIP.BAR_NONE,
            )}
            style={bar.kind === "ok" ? { height: `${bar.heightPct}%` } : undefined}
          />
        ))}
      </div>
      <div className={STRIP.FOOT}>
        <span>{t("watchdog.strip.ago", { minutes: strip.minutes })}</span>
        <span>{t("watchdog.strip.now")}</span>
      </div>
    </div>
  );
}

/** Phase and figures on two edges, the probe strip under both. */
export function StatusCard({ band, strip }: { band: BandView; strip: StripView }) {
  const { t } = useTranslation("common");
  const Glyph = band.glyph;
  return (
    <Card className={HERO_SHELL} aria-label={t("watchdog.band.aria")} role="region">
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.HEAD}>
          <div className={STATUS.PHASE}>
            <span
              aria-hidden
              className={cn(
                STATUS.DISC,
                DISC_TRANSITION,
                DISC_TONE[band.disc],
                band.live && DISC_LIVE,
              )}
            >
              <Glyph className={STATUS.GLYPH} />
            </span>
            <div className={STATUS.TEXT}>
              <p className={STATUS.TITLE}>{t(band.labelKey)}</p>
              <p className={band.blurbNumeric ? STATUS.BLURB_NUM : STATUS.BLURB}>
                {t(band.blurbKey, band.blurbParams)}
              </p>
            </div>
          </div>
          <div className={STATUS.FIGS}>
            {band.figures.map((figure) => (
              <Figure key={figure.key} figure={figure} />
            ))}
          </div>
        </div>
        <ProbeStrip strip={strip} />
      </CardContent>
    </Card>
  );
}

/** Mirrors the status card from the same constants. */
export function StatusCardSkeleton() {
  return (
    <Card className={HERO_SHELL} aria-hidden>
      <CardContent className={cn(HERO_PAD, STATUS.BODY)}>
        <div className={STATUS.HEAD}>
          <div className={STATUS.PHASE}>
            <Skeleton className={STATUS.DISC} />
            <div className={cn(STATUS.TEXT, "flex-1 gap-2")}>
              <Skeleton className={cn(SKELETON.STATUS_TITLE, "w-32")} />
              <Skeleton className={cn(SKELETON.STATUS_BLURB, "w-64 max-w-full")} />
            </div>
          </div>
          <div className={STATUS.FIGS}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={cn(STATUS.FIG, "gap-y-1")}>
                <Skeleton className={cn(SKELETON.FIG_EYEBROW, STATUS.FIG_EYEBROW, "w-20")} />
                <Skeleton className={cn(SKELETON.FIG_VALUE, STATUS.FIG_VALUE, "w-12")} />
                <Skeleton className={cn(SKELETON.LINE, STATUS.FIG_CAPTION, "h-3 w-28")} />
              </div>
            ))}
          </div>
        </div>
        <div className={STRIP.ROOT}>
          <div className={STRIP.HEAD}>
            <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-14")} />
            <Skeleton className={cn(SKELETON.LINE, "h-3 w-24")} />
          </div>
          <Skeleton className={SKELETON.STRIP} />
          <div className={STRIP.FOOT}>
            <Skeleton className={cn(SKELETON.LINE, "h-3 w-16")} />
            <Skeleton className={cn(SKELETON.LINE, "h-3 w-8")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
