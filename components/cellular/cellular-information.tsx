"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Banner } from "@/components/ui/banner";
import { useModemStatus } from "@/hooks/use-modem-status";
import { reconcileCarriers } from "@/lib/carrier-aggregation";
import type { ResolvedCarrier } from "@/lib/carrier-aggregation";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  buildDiagnosticsText,
  enrichCarriers,
  resolveRadioMode,
  summariseRadio,
} from "@/lib/radio-info";

import { RadioPageHeader } from "@/components/cellular/radio/page-header";
import { SummaryTiles } from "@/components/cellular/radio/summary-tiles";
import {
  RadioConditionState,
  SummaryTilesSkeleton,
  isConditionMode,
} from "@/components/cellular/radio/states";
import { CellularInformationCard } from "@/components/cellular/radio/cellular-information-card";
import { ActiveBandsCard } from "@/components/cellular/radio/active-bands-card";

// =============================================================================
// Radio Information — page shell
// =============================================================================
// This component used to destructure only `{ data, isLoading }` from
// `useModemStatus()`, throwing away `isStale`, `error` and `refresh`. That was
// a live bug, not just an omission: when the poller stopped responding the page
// kept rendering the last numbers it had, at full confidence, with nothing on
// screen saying so. All five are taken now — `error` raises the stale banner,
// `isStale` freezes the carrier list AND swaps the Spectrum card's description
// line to say so, `refresh` backs the condition-state retry.
//
// That second half was missing until now: the liveness chip this comment used
// to name was cut, and `isStale` was left driving the freeze with no visual
// output at all — so the honesty fix described above had quietly regressed into
// a quieter version of the same bug.
//
// Layout is a single-column stack of full-width sections, ordered by CADENCE:
// what moves every poll (Spectrum in use) above what moves on handover
// (Connection details). It was a 2-up container-query grid with both cards
// height-locked to each other, which is a split by symmetry — and symmetry is
// not a property either card has. See the note on the stack below.
// `@container/main` stays because the summary tiles and the header still query
// it; only the two-column rule is gone.
//
// Entrance is the shared `staggerContainer` / `staggerItem` pair, which IS the
// mock's `qm-cascade` (10px rise, 300ms, standard curve) — its four hardcoded
// 0/60/120/180ms delays are exactly the 60ms card step, so the variants
// reproduce the choreography without restating a single number.
// =============================================================================

const CellularInformationComponent = () => {
  const { t } = useTranslation("cellular");
  const { data, isLoading, isStale, receivedAtMs, error, refresh } =
    useModemStatus();

  const mode = resolveRadioMode(data, isLoading);

  const networkType = data?.network?.type ?? "";

  // `enrichCarriers` takes ResolvedCarrier[], so the raw snapshot goes through
  // `reconcileCarriers` first. Release history lives on this client because the
  // backend keeps none — a dropped SCC simply stops appearing — and the ref is
  // committed after render so a render React throws away cannot advance the
  // release clock. While the data is stale the list FREEZES instead of
  // reconciling: any failed AT read empties `carrier_components` wholesale, and
  // announcing "released" for carriers that never moved, on the same screen as
  // the stale banner, is exactly the contradiction this page exists to avoid.
  // Lifted verbatim from `components/dashboard/carrier-aggregation.tsx`.
  //
  // The release clock is `receivedAtMs` — the wall-clock moment the snapshot
  // ARRIVED, stamped once inside `useModemStatus`'s fetch callback and threaded
  // down as data. It must stay wall clock, because `lastSeenMs` set here is read
  // back by `enrichCarriers` against the same browser clock; sourcing it from
  // the poller's `timestamp` would look equally pure while silently comparing
  // the modem's clock against ours.
  //
  // It is a value rather than a render-time `Date.now()` because `lastSeenMs`
  // means "when did a poll last contain this carrier", and a render timestamp
  // answers a different question — this page re-renders for reasons that are not
  // polls, and each of those used to advance the release clock. Reading it as
  // data makes the reconcile idempotent and leaves nothing for
  // `react-hooks/purity` to flag. `components/dashboard/carrier-aggregation.tsx`
  // takes the same prop from the same source; the decision is shared, not
  // duplicated per site.
  const retained = React.useRef<ResolvedCarrier[]>([]);
  const resolved =
    isStale || receivedAtMs === null
      ? retained.current
      : reconcileCarriers(
          retained.current,
          data?.network?.carrier_components ?? [],
          networkType,
          receivedAtMs,
        );
  React.useEffect(() => {
    retained.current = resolved;
  });

  // `enrichCarriers` takes the arrival clock too, for the "released Ns ago"
  // reading. It used to call `Date.now()` internally, which the purity rule
  // cannot see — the rule only analyses Component and Hook bodies, not plain
  // helpers they call — so that read was an invisible instance of the same
  // problem. Both clocks now come from one stamp, which is also why the label
  // and the release decision can no longer disagree.
  //
  // The `?? 0` is unreachable: `resolved` is only non-empty once a reconcile has
  // run, and a reconcile requires an arrival time.
  const carriers = React.useMemo(
    () =>
      enrichCarriers(
        resolved,
        networkType,
        data?.nr?.arfcn ?? null,
        data?.nr?.scs ?? null,
        receivedAtMs ?? 0,
      ),
    [resolved, networkType, data?.nr?.arfcn, data?.nr?.scs, receivedAtMs],
  );
  const summary = React.useMemo(() => summariseRadio(carriers), [carriers]);

  const buildDiagnostics = React.useCallback(
    () =>
      buildDiagnosticsText({
        networkType,
        operator: data?.network?.carrier ?? "",
        summary,
        carriers,
        timestampIso: new Date().toISOString(),
      }),
    [networkType, data?.network?.carrier, summary, carriers],
  );

  // Non-registered modes replace the body rather than render it empty — see the
  // header comment in `radio/states.tsx` for why that is the whole point of
  // this redesign rather than a nicety.
  const showConditionState = !isLoading && isConditionMode(mode);

  return (
    // One cascade owns the page, so the beats land where the mock's hardcoded
    // 0/60/120/180ms delays put them: header, then tiles, then the two cards
    // from the nested container — without restating a single duration.
    // `aria-live` sits on the polling region itself, as on the dashboard.
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      aria-live="polite"
      aria-atomic="false"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <RadioPageHeader buildDiagnostics={buildDiagnostics} />
      </motion.div>

      {/* Outside the cascade on purpose: the banner carries its own
          `.animate-banner-in`, and a condition should never wait its turn. */}
      {error && !isLoading && (
        <Banner role="stale" title={t("radio_info.alert.modem_unreachable")} />
      )}

      {/* Cascade children are block boxes, never bare spans — a span silently
          drops the 10px rise. */}
      <motion.div variants={staggerItem}>
        {isLoading ? (
          <SummaryTilesSkeleton label={t("radio_info.states.loading_sr")} />
        ) : isConditionMode(mode) ? (
          <RadioConditionState mode={mode} onRetry={refresh} />
        ) : (
          <SummaryTiles
            mode={mode}
            summary={summary}
            mimo={data?.device?.mimo ?? null}
          />
        )}
      </motion.div>

      {!showConditionState && (
        // Nested container: inherits `visible` from the page cascade and then
        // runs its own step over the two cards. No initial/animate of its own —
        // that would detach it from the parent's clock.
        //
        // A single-column STACK, not a 2-up grid, and neither card is height-
        // locked to the other any more. The old `h-full` pair forced a static
        // reference card and a live telemetry card to the same height, which
        // left ~200px of dead space in whichever one had less to say — and
        // which one that was flipped with the carrier count. Splitting the page
        // by cadence instead of by symmetry removes the constraint rather than
        // tuning it: spectrum first because it is what moves, connection
        // details second because it is what you look up.
        <motion.div
          className="flex flex-col gap-5"
          variants={staggerContainer}
        >
          <motion.div variants={staggerItem}>
            {/* `isStale` goes to the card, not the header. This card is the
                one that froze (see the `resolved` ternary above), so it is the
                one that reports it. */}
            <ActiveBandsCard
              carriers={carriers}
              summary={summary}
              isLoading={isLoading}
              isStale={isStale}
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <CellularInformationCard data={data} isLoading={isLoading} />
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default CellularInformationComponent;
