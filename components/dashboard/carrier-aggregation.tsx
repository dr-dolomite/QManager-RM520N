"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  RadioIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CarrierComponent, NetworkType } from "@/types/modem-status";
import {
  computeSegmentShares,
  isLeadRole,
  reconcileCarriers,
  releasedForMs,
  rsrpToPercent,
  summarise,
  type CarrierRole,
  type ResolvedCarrier,
} from "@/lib/carrier-aggregation";

interface CarrierAggregationProps {
  carriers: CarrierComponent[];
  networkType: NetworkType;
  isLoading: boolean;
  /** True when the dashboard has stopped trusting its own data. The release
   *  clock must not run on snapshots the app is already disowning. */
  isStale: boolean;
}

/**
 * Tone per carrier. Hue carries the radio family (blue = NR, violet = LTE);
 * fill strength carries primacy (strong tone leads its leg, container tone is
 * secondary). A released carrier drops to a neutral surface step and keeps its
 * place, so a drop reads as a gap rather than a redraw.
 */
function segmentTone(c: ResolvedCarrier): string {
  if (c.released) return "bg-surface-container-high text-on-surface-variant";
  if (c.technology === "NR") {
    return isLeadRole(c.role)
      ? "bg-primary text-primary-foreground"
      : "bg-primary-container text-on-primary-container";
  }
  return isLeadRole(c.role)
    ? "bg-lte text-lte-foreground"
    : "bg-lte-container text-on-lte-container";
}

function tileTone(c: ResolvedCarrier): string {
  if (c.released) return "bg-surface-container-high text-on-surface-variant";
  return c.technology === "NR"
    ? "bg-primary-container text-on-primary-container"
    : "bg-lte-container text-on-lte-container";
}

/**
 * The role chip inverts its tile: the tile's ink becomes the chip's fill. Both
 * sides of the pair are measured and WCAG contrast is symmetric, so inverting
 * preserves the ratio while staying legible when the container fill washes out
 * in sunlight.
 *
 * Deliberately NOT a `Badge` status variant. This labels which carrier a tile
 * is, not how it is doing, and every Badge status role is itself a container
 * fill: putting one on an already-container-filled tile would sit two adjacent
 * tones on top of each other and lose the chip. The Filled-Chip Rule governs
 * status indicators; this is an identifier.
 */
function roleChipTone(c: ResolvedCarrier): string {
  if (c.released) return "bg-on-surface-variant text-surface-container-high";
  return c.technology === "NR"
    ? "bg-on-primary-container text-primary-container"
    : "bg-on-lte-container text-lte-container";
}

/** Only ever called for a live carrier: a released tile shows its release copy
 *  where the meter would be, because a quality bar on a carrier that is gone
 *  would be reporting a measurement nothing is taking. */
function meterFillTone(c: ResolvedCarrier): string {
  return c.technology === "NR" ? "bg-primary" : "bg-lte";
}

export function CarrierAggregationComponent({
  carriers,
  networkType,
  isLoading,
  isStale,
}: CarrierAggregationProps) {
  const { t } = useTranslation("dashboard");

  // Release history lives here because the backend keeps none: a dropped SCC
  // simply stops appearing in the snapshot. Retention is this client's own
  // observation and resets on reload, which is why it can be shown honestly.
  //
  // While the data is stale the chain freezes instead of reconciling. Any
  // failed AT read empties carrier_components wholesale, so a modem stall
  // longer than the grace window would otherwise have us announce "released"
  // for carriers that never went anywhere, on the same screen where the
  // stale-data banner is saying the readings cannot be trusted.
  const retained = React.useRef<ResolvedCarrier[]>([]);
  const now = Date.now();
  const resolved = isStale
    ? retained.current
    : reconcileCarriers(retained.current, carriers, networkType, now);

  // Committed after render, never during: a render React throws away must not
  // advance the release clock.
  React.useEffect(() => {
    retained.current = resolved;
  });

  const summary = summarise(resolved, networkType);
  const shares = computeSegmentShares(resolved.map((c) => c.bandwidth_mhz));

  const roleLabel = React.useCallback(
    (c: ResolvedCarrier): string => {
      if (c.released) return t("ca.role.released");
      const map: Record<CarrierRole, string> = {
        pcc: t("ca.role.pcc", { tech: c.technology }),
        "nr-anchor": t("ca.role.anchor"),
        scc: t("ca.role.scc", { tech: c.technology }),
      };
      return map[c.role];
    },
    [t],
  );

  if (isLoading) {
    return (
      <Card className="@container/ca gap-4 rounded-hero border-0 px-7 py-6 shadow-[var(--shadow-whisper)]">
        <div className="flex flex-wrap items-center gap-3.5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-40 rounded-pill" />
          <Skeleton className="ml-auto h-8 w-36" />
        </div>
        {/* Matches the chain's own responsive height, or the page reflows 16px
            at phone width the moment data lands. */}
        <Skeleton className="h-8 w-full rounded-tile @md/ca:h-12" />
        <div className="grid grid-cols-1 gap-3 @md/ca:grid-cols-2 @3xl/ca:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-tile" />
          ))}
        </div>
      </Card>
    );
  }

  if (resolved.length === 0) {
    return (
      <Card className="gap-3 rounded-hero border-0 px-7 py-6 shadow-[var(--shadow-whisper)]">
        <h3 className="text-lg font-semibold">{t("ca.title")}</h3>
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RadioIcon />
            </EmptyMedia>
            <EmptyTitle>{t("ca.empty_title")}</EmptyTitle>
            <EmptyDescription className="max-w-xs text-pretty">
              {t("ca.empty_description")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  // Name every leg that is actually up. EN-DC is not aggregation on its own,
  // but it is not nothing either, and a chip reading "LTE-CA active" beside a
  // live NR segment would be describing half the radio.
  const statusKey = summary.nrCa && summary.lteCa
    ? "ca.status.both"
    : summary.nrCa
      ? "ca.status.nr_ca"
      : summary.lteCa
        ? summary.endc
          ? "ca.status.endc_lte_ca"
          : "ca.status.lte_ca"
        : summary.endc
          ? "ca.status.endc"
          : "ca.status.none";

  const aggregating = summary.nrCa || summary.lteCa || summary.endc;
  const hasReleased = resolved.some((c) => c.released);

  return (
    <Card className="@container/ca gap-4 rounded-hero border-0 px-7 py-6 shadow-[var(--shadow-whisper)]">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3.5">
        <h3 className="text-lg font-semibold">{t("ca.title")}</h3>

        <Badge
          variant={hasReleased ? "warning" : aggregating ? "success" : "muted"}
          className="px-3 py-1.5"
        >
          {hasReleased ? (
            <TriangleAlertIcon aria-hidden />
          ) : aggregating ? (
            <CheckCircle2Icon aria-hidden />
          ) : (
            <MinusCircleIcon aria-hidden />
          )}
          {/* When something has been released the chip must SAY so. An amber
              fill and a warning glyph over the words "NR-CA active" is the
              colour carrying meaning the sentence denies. */}
          {hasReleased
            ? t("ca.status.released", { count: summary.releasedCount })
            : t(statusKey)}
        </Badge>

        <span className="ml-auto inline-flex items-baseline gap-2">
          {/* On a drop, what remains is shown against what it was, so the
              figure reads as a loss rather than as a number that quietly
              shrank between polls. */}
          <span className="text-xl font-semibold tabular-nums">
            {summary.totalMhz}
            {hasReleased && (
              <span className="text-on-surface-variant">
                {" / "}
                {summary.previousTotalMhz}
              </span>
            )}
          </span>
          {/* A lone carrier has a bandwidth, not an aggregate. Calling 20 MHz
              "aggregated" would be the card describing something the radio is
              not doing. */}
          <span className="text-xs font-semibold text-on-surface-variant">
            {aggregating ? t("ca.aggregated") : t("ca.bandwidth")}
          </span>
        </span>
      </div>

      {/* ── Proportional chain ──
          Width is the one property in the product allowed to animate, because
          here the width IS the data: a scaleX would distort the labels riding
          inside each segment. */}
      {/* Narrow containers drop to a bare proportion bar: at phone width a 10%
          segment is ~23px, which is less than its own horizontal padding, so
          the labels would clip to nothing and the chain would read as broken.
          The proportions still carry at a glance, and the stacked tiles below
          carry every label the segments give up. */}
      <div className="flex h-8 gap-1 @md/ca:h-12 @md/ca:gap-1.5" role="list">
        {resolved.map((c, i) => (
          <div
            key={c.key}
            role="listitem"
            aria-label={t("ca.segment_label", {
              band: c.band,
              role: roleLabel(c),
              bw: c.bandwidth_mhz,
            })}
            title={`${c.band} · ${roleLabel(c)} · ${c.bandwidth_mhz} MHz`}
            style={{ width: `${shares[i]}%` }}
            className={cn(
              "ca-segment flex min-w-0 flex-col justify-center gap-px overflow-hidden rounded-tile py-1.5 whitespace-nowrap @md/ca:px-3.5",
              segmentTone(c),
            )}
          >
            <span className="hidden font-mono text-sm leading-[1.1] font-semibold @md/ca:block">
              {c.band}
            </span>
            {/* No alpha on the ink: a released segment's pair measures 6.2:1
                and 85% opacity drops it under AA. It recedes by being smaller,
                not by being faded. */}
            <span className="hidden text-xs font-medium tabular-nums @md/ca:block">
              {c.bandwidth_mhz > 0 ? `${c.bandwidth_mhz} MHz` : t("ca.bw_unknown")}
            </span>
          </div>
        ))}
      </div>

      {/* ── Per-carrier tiles ──
          Container-queried: the deck's fixed 4-column grid is desktop-only, and
          this dashboard is read on a phone beside the modem. */}
      <div className="grid grid-cols-1 gap-3 @md/ca:grid-cols-2 @3xl/ca:grid-cols-4">
        {resolved.map((c) => {
          const pct = rsrpToPercent(c.rsrp);
          const minutes = Math.floor(releasedForMs(c, now) / 60000);

          return (
            <div
              key={c.key}
              className={cn(
                "flex flex-col gap-[7px] rounded-tile px-3.5 py-[11px] transition-colors duration-(--duration-standard) ease-standard",
                tileTone(c),
              )}
            >
              <div className="flex items-center justify-between gap-2.5">
                <span className="font-mono text-base font-semibold">
                  {c.band}
                </span>
                {/* The role is text, never colour alone — it is the affordance
                    that survives glare, greyscale, and the tile row scrolling
                    out of view below the chain. */}
                <span
                  className={cn(
                    "shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold",
                    roleChipTone(c),
                  )}
                >
                  {roleLabel(c)}
                </span>
              </div>

              <div className="flex gap-3.5 font-mono text-xs font-medium tabular-nums">
                <span>PCI {c.pci ?? "—"}</span>
                <span>
                  {c.technology === "NR" ? "ARFCN" : "EARFCN"} {c.earfcn ?? "—"}
                </span>
              </div>

              {c.released ? (
                <p className="text-xs font-medium">
                  {minutes < 1
                    ? t("ca.released_moments")
                    : t("ca.released_minutes", { count: minutes })}
                </p>
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className="h-[7px] flex-1 overflow-hidden rounded-pill bg-surface">
                    {/* scaleX, not width: every meter on the page would
                        otherwise relayout on each poll. */}
                    <div
                      className={cn(
                        "ca-meter h-full origin-left rounded-pill",
                        meterFillTone(c),
                      )}
                      style={{ transform: `scaleX(${pct / 100})` }}
                    />
                  </div>
                  <span className="font-mono text-xs font-semibold tabular-nums">
                    {c.rsrp != null ? `${c.rsrp} dBm` : "—"}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default CarrierAggregationComponent;
