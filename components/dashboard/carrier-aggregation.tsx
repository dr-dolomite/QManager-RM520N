"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { TickingValue } from "@/components/ui/ticking-value";
import { TickGroup } from "@/components/ui/tick-group";
import { DUR } from "@/lib/motion";
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
  /**
   * Browser wall-clock ms at which the snapshot behind `carriers` ARRIVED, from
   * `useModemStatus`. This is the release clock, and it is a prop rather than a
   * render-time `Date.now()` on purpose — see the note at the reconcile call.
   * `null` before the first snapshot lands.
   */
  receivedAtMs: number | null;
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

const CARD_SHELL =
  "@container/ca gap-4 rounded-hero border-0 px-7 py-6 shadow-[var(--shadow-whisper)]";

/**
 * Extracted so the loading branch and the crossfade overlay render the SAME
 * geometry from one definition. Two copies would drift, and a skeleton that has
 * drifted from the thing it stands in for is the Skeleton-Mirror Rule failing
 * silently — the handoff would show as a jump rather than a fade.
 */
function AggregationSkeleton() {
  return (
    <Card className={CARD_SHELL}>
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

export function CarrierAggregationComponent({
  carriers,
  networkType,
  isLoading,
  isStale,
  receivedAtMs,
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
  // The release clock is the snapshot's ARRIVAL time, threaded in from
  // `useModemStatus`, not a `Date.now()` read here. Three reasons, in order of
  // how much they matter:
  //
  // 1. Correctness. `lastSeenMs` means "when did a poll last contain this
  //    carrier". A render timestamp answers a different question, because this
  //    component re-renders for reasons that are not polls — the `handoff`
  //    state below is one. Every such render used to advance the clock and get
  //    committed by the effect, so the 6s grace window was measuring time since
  //    the last render that happened to include a carrier, and a burst of
  //    unrelated re-renders could carry a carrier across the release threshold
  //    with no new data behind it.
  // 2. Purity. Render is now a function of its props: the same snapshot
  //    reconciles to the same chain however many times React invokes this
  //    component. That is what `react-hooks/purity` asks for, and it is
  //    satisfied by moving the clock read to the fetch callback rather than by
  //    suppressing the rule.
  // 3. It stays WALL CLOCK. `receivedAtMs` is stamped by the browser, so it is
  //    comparable to other browser-side times. Sourcing this from the poller's
  //    own `timestamp` would look equally pure while silently comparing the
  //    modem's clock against ours.
  //
  // Before the first snapshot lands there is no arrival time and nothing to
  // reconcile against, so the chain holds whatever it already had — the same
  // branch `isStale` takes, for the same reason.
  const retained = React.useRef<ResolvedCarrier[]>([]);
  const now = receivedAtMs;
  const resolved =
    isStale || now === null
      ? retained.current
      : reconcileCarriers(retained.current, carriers, networkType, now);

  // Committed after render, never during: a render React throws away must not
  // advance the release clock.
  React.useEffect(() => {
    retained.current = resolved;
  });

  const summary = summarise(resolved, networkType);
  const shares = computeSegmentShares(resolved.map((c) => c.bandwidth_mhz));

  // A carrier is "entering" only if the card has already drawn a chain without
  // it. Derived from `retained` — committed state, never a value this render
  // invented — so a render React discards cannot mark a segment as new.
  //
  // The distinction matters because the two cases mean different things. Four
  // segments appearing together is the card arriving, and that belongs to the
  // skeleton crossfade; one segment appearing beside three that were already
  // there is the radio adding a carrier, which is the event this widget exists
  // to report. Only the second one grows.
  //
  // Read straight off the ref rather than memoised: the effect above commits
  // `retained` AFTER render, so during render it still holds the PREVIOUS
  // chain, which is exactly the set we need to diff against.
  const previousKeys = new Set(retained.current.map((c) => c.key));
  const hasDrawnChain = retained.current.length > 0;

  // Skeleton handoff (Motion Guide recipe 03). The overlay lives for one
  // `quick` and then unmounts; nothing downstream depends on it, so a missed
  // timer degrades to an ordinary instant swap rather than a stuck skeleton.
  const [handoff, setHandoff] = React.useState(false);
  const wasLoading = React.useRef(isLoading);
  React.useEffect(() => {
    const landed = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (!landed) return;

    setHandoff(true);
    const id = window.setTimeout(() => setHandoff(false), DUR.quick * 1000);
    return () => window.clearTimeout(id);
  }, [isLoading]);

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

  /**
   * The crossfade shell. Every branch returns through here so the skeleton can
   * fade out ON TOP of whatever replaced it.
   *
   * Overlay rather than sibling on purpose: stacked as siblings, the container
   * would size to the taller of the two for the duration of the fade and then
   * collapse, so the handoff would end with a jolt. As an overlay the real
   * content owns the card's height from its very first frame and the crossfade
   * itself contributes no layout shift at all — which is the whole point of
   * recipe 03.
   */
  const shell = (body: React.ReactNode) => (
    <div className="relative">
      <div className={cn(handoff && "ca-content-in")}>{body}</div>
      {/* `[&>*]:h-full` so the outgoing skeleton matches whatever height the
          real content just claimed. Left at its natural height it would
          overhang the card by however many carriers the radio did not have. */}
      {handoff && (
        <div
          aria-hidden
          className="ca-skeleton-out pointer-events-none absolute inset-0 [&>*]:h-full"
        >
          <AggregationSkeleton />
        </div>
      )}
    </div>
  );

  if (isLoading) {
    return shell(<AggregationSkeleton />);
  }

  if (resolved.length === 0) {
    return shell(
      <Card className="gap-3 rounded-hero border-0 px-7 py-6 shadow-[var(--shadow-whisper)]">
        <h3 className="text-lg font-semibold">{t("ca.title")}</h3>
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {/* Explicit 24px: `empty.tsx`'s icon variant sizes `svg` via a
                  class utility, and MaterialSymbol sets fontSize inline, which
                  no class can override. */}
              <MaterialSymbol name="cell_tower" size={24} />
            </EmptyMedia>
            <EmptyTitle>{t("ca.empty_title")}</EmptyTitle>
            <EmptyDescription className="max-w-xs text-pretty">
              {t("ca.empty_description")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>,
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

  return shell(
    <Card className={CARD_SHELL}>
      {/* One tick cascade for the card: the aggregate bandwidth figure in the
          header, then each carrier tile's RSRP. The tile grid runs
          `grid-cols-1 -> @md:grid-cols-2 -> @3xl:grid-cols-4`, and no direction
          handling is needed for that flip because CSS grid places row-major, so
          document order stays reading order in all three states — a column when
          stacked, left-to-right-then-wrap when not. `TickGroup` sorts the live
          nodes, so it inherits that for free.

          Distinct from the meter cascade already on this card: `--meter-index`
          below staggers the FILL arrival at the 60ms card step on first paint,
          while this staggers the value DIP on every poll at the 40ms row step.
          Two different gestures on two different clocks; leave both alone. */}
      <TickGroup>
        {/* ── Header ── */}
        <div className="flex flex-wrap items-center gap-3.5">
          <h3 className="text-lg font-semibold">{t("ca.title")}</h3>

          {/* Two clocks, per the chip-swap recipe: the Badge's own transition
              morphs the container fill over `standard` (see badge.tsx), while the
              glyph and label crossfade over `quick` on the key change below. The
              state is felt peripherally, in the colour, a beat before it is read.

              Keyed on what the chip SAYS rather than on its variant: two
              different released counts share the warning fill but are not the
              same statement, and a chip whose text changed without acknowledging
              it is the sort of silent swap this recipe exists to prevent. */}
          <Badge
            variant={hasReleased ? "warning" : aggregating ? "success" : "muted"}
            className="px-3 py-1.5"
          >
            <SwapLabel
              swapKey={
                hasReleased ? `released-${summary.releasedCount}` : statusKey
              }
              className="gap-1"
            >
              {/* `size={12}` is explicit here for two reasons, and either alone
                  would be enough. Badge's base class sizes `[&>svg]`, a DIRECT
                  child, and the crossfade wrapper puts the glyph one level deeper
                  than that selector reaches; and MaterialSymbol sets its fontSize
                  as an inline style, which a class utility cannot override even
                  when the selector does reach it. */}
              {hasReleased ? (
                <MaterialSymbol name="warning" size={12} filled />
              ) : aggregating ? (
                <MaterialSymbol name="check_circle" size={12} filled />
              ) : (
                <MaterialSymbol name="do_not_disturb_on" size={12} filled />
              )}
              {/* When something has been released the chip must SAY so. An amber
                  fill and a warning glyph over the words "NR-CA active" is the
                  colour carrying meaning the sentence denies. */}
              {hasReleased
                ? t("ca.status.released", { count: summary.releasedCount })
                : t(statusKey)}
            </SwapLabel>
          </Badge>

          <span className="ml-auto inline-flex items-baseline gap-2">
            {/* On a drop, what remains is shown against what it was, so the
                figure reads as a loss rather than as a number that quietly
                shrank between polls. */}
            <TickingValue
              value={summary.totalMhz}
              className="text-xl font-semibold"
            >
              {summary.totalMhz}
              {hasReleased && (
                <span className="text-on-surface-variant">
                  {" / "}
                  {summary.previousTotalMhz}
                </span>
              )}
            </TickingValue>
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
                // Grows in from nothing only when the radio ADDED this carrier.
                // The inline width above stays the truth throughout, so a segment
                // whose animation never runs is still exactly the right size.
                hasDrawnChain && !previousKeys.has(c.key) && "ca-segment-enter",
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
          {resolved.map((c, i) => {
            const pct = rsrpToPercent(c.rsrp);
            // `now` is non-null wherever this runs: `resolved` can only be
            // non-empty if a reconcile produced it, and a reconcile requires an
            // arrival time. The fallback keeps the type honest; it does not
            // describe a reachable state.
            const minutes = Math.floor(releasedForMs(c, now ?? 0) / 60000);

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
                          otherwise relayout on each poll.

                          `--meter-index` staggers the arrival across the tile
                          grid (60ms apart, `.ca-meter` in globals.css). The
                          inline transform stays the single source of truth for
                          the resting scale — the index only shifts when the fill
                          starts, never where it ends. */}
                      <div
                        className={cn(
                          "ca-meter h-full origin-left rounded-pill",
                          meterFillTone(c),
                        )}
                        style={
                          {
                            transform: `scaleX(${pct / 100})`,
                            "--meter-index": i,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                    {/* The card's most genuinely live figure: RSRP moves on
                        almost every poll. The dip is what separates "the radio
                        re-reported this" from "this number has been frozen since
                        you opened the tab" — a distinction a monitoring tool
                        cannot afford to leave to the user's memory. */}
                    <TickingValue
                      value={c.rsrp}
                      className="text-xs font-semibold"
                    >
                      {c.rsrp != null ? `${c.rsrp} dBm` : "—"}
                    </TickingValue>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </TickGroup>
    </Card>
  );
}

export default CarrierAggregationComponent;
