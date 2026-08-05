"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FailoverState } from "@/types/band-locking";
import type { CarrierComponent } from "@/types/modem-status";

import {
  BADGE_GLYPH_SIZE,
  BAND_HERO,
  FAILOVER_BADGE,
  HERO_DISC,
  HERO_EYEBROW,
  HERO_ONAIR,
  HERO_ROW,
  HERO_VALUE,
  POSTURE_GLYPH,
  SKELETON_SHAPE,
} from "./shapes";

// =============================================================================
// LiveBandHero — what the modem is doing right now
// =============================================================================
// The page's anchor card, and the read-only half of Band Locking. It answers
// the question the user arrived with — *what is my radio actually allowed to
// use* — before the three cards below offer to change it.
//
// This replaces `band-settings.tsx`, which was a card of six label/value rows
// held apart by seven `<Separator>` elements (one of them trailing, with nothing
// after it) sitting in the same grid as the three interactive cards, as though a
// read-only status panel and a control surface were the same kind of object.
//
// -----------------------------------------------------------------------------
// WHAT WAS CUT, AND WHY THE REST STAYED
// -----------------------------------------------------------------------------
// The incumbent rendered four rows: Active LTE Bands, Active LTE Channels,
// Active 5G Bands, Active 5G Channels — all four derived from
// `carrier_components`, the same poller field `/cellular/` consumes.
//
// The two CHANNEL rows are gone. `components/cellular/radio/active-bands-card.tsx`
// already renders every ARFCN per carrier, with the correct RAT-specific label,
// a per-carrier quality chip and released-carrier handling. Four comma-joined
// strings here were a worse copy of a better surface. (The incumbent helper even
// documented "includes duplicates since different carriers can share the same
// ARFCN" and then deduplicated on the next line, so it did not do what it said.)
//
// The two BAND rows stayed, as chips, because they are the only on-page evidence
// that a lock actually took. `Apply` confirms the CONFIGURED view —
// `ue_capability_band`, what you asked for. `carrier_components` is the ACTUAL
// view — where the modem is camped. Those are different facts, and the gap
// between them is exactly the class of bug that bit APN management, where
// `CGDCONT?` reported a context the modem had never attached with. Delete these
// and applying a band lock gives you a green button and no evidence.
//
// -----------------------------------------------------------------------------
// WHY FAILOVER MOVED HERE
// -----------------------------------------------------------------------------
// Band failover is not a fourth setting alongside the three categories — it is
// the safety net under all of them. `lock.sh` arms one watcher for the most
// recent lock regardless of which category it belonged to, so failover is a
// property of the modem, not of a card. Rendering it as a peer of the category
// cards said otherwise.
//
// Its chip is a genuine four-state indicator and every state carries a distinct
// glyph (`FAILOVER_BADGE`), which is mandatory rather than tidy here: `ready`
// and `fallback` are `success-container` and `warning-container`, 1.03:1 apart
// and the same surface under deuteranopia. The glyph is the only channel
// separating "the safety net is armed" from "the safety net has fired and your
// lock is not in force".
// =============================================================================

export interface LiveBandHeroProps {
  failover: FailoverState;
  /** Active carrier components from `useModemStatus` (QCAINFO). */
  carrierComponents: CarrierComponent[];
  /** Total bands configured across all three categories. */
  lockedTotal: number;
  /** Total bands the hardware reports as supported across all three categories. */
  supportedTotal: number;
  onToggleFailover: (enabled: boolean) => Promise<boolean>;
  isLoading: boolean;
  /** True when a Custom SIM Profile or Connection Scenario owns radio config. */
  isGated?: boolean;
}

type Posture = "locked" | "unrestricted" | "unknown";

/** One band actually on air, with the radio family that owns it. */
interface OnAirBand {
  label: string;
  /** Identity variant — which RADIO this band belongs to. Never a health claim. */
  variant: "nr" | "lte";
}

/**
 * The bands the modem is currently camped on, deduplicated and sorted by band
 * number within each radio family.
 *
 * A band can legitimately appear twice in `carrier_components` (as PCC and as
 * SCC), so the dedupe is not defensive — it is the difference between "B3" and
 * "B3, B3". The sort strips the `B`/`N` prefix first, because a lexical sort
 * puts B12 before B3 and a technician reading a band list notices immediately.
 */
function useOnAirBands(components: CarrierComponent[]): OnAirBand[] {
  return useMemo(() => {
    const collect = (technology: "LTE" | "NR"): OnAirBand[] => {
      const labels = components
        .filter((c) => c.technology === technology)
        .map((c) => c.band)
        .filter(Boolean);

      return [...new Set(labels)]
        .sort(
          (a, b) =>
            parseInt(a.replace(/^[BN]/, ""), 10) -
            parseInt(b.replace(/^[BN]/, ""), 10),
        )
        .map((label) => ({
          label,
          variant: technology === "NR" ? ("nr" as const) : ("lte" as const),
        }));
    };

    // LTE first, then NR: the LTE leg is the anchor in NSA, so it is the one a
    // reader looks for first when a 5G connection is misbehaving.
    return [...collect("LTE"), ...collect("NR")];
  }, [components]);
}

/** Which of the four failover states is in force. Order is significant. */
function failoverKey(
  failover: FailoverState,
): "disabled" | "fallback" | "monitoring" | "ready" {
  if (!failover.enabled) return "disabled";
  // `activated` outranks `watcher_running`: a watcher that has already fired is
  // reporting a fallback, not progress, even while it keeps running.
  if (failover.activated) return "fallback";
  if (failover.watcher_running) return "monitoring";
  return "ready";
}

export function LiveBandHero({
  failover,
  carrierComponents,
  lockedTotal,
  supportedTotal,
  onToggleFailover,
  isLoading,
  isGated = false,
}: LiveBandHeroProps) {
  const { t } = useTranslation("cellular");
  const onAir = useOnAirBands(carrierComponents);

  // The posture is DERIVED, never asserted. `unknown` is a real state and not a
  // loading state: a modem that has not reported a supported-band list yet must
  // not be described as unrestricted, because "all supported bands available"
  // would be a claim about a list nobody has seen.
  const posture: Posture =
    supportedTotal === 0
      ? "unknown"
      : lockedTotal >= supportedTotal
        ? "unrestricted"
        : "locked";

  const postureLabel =
    posture === "unknown"
      ? t("band_locking.live.posture_unknown")
      : posture === "unrestricted"
        ? t("band_locking.live.posture_unrestricted")
        : t("band_locking.live.posture_locked", {
            count: lockedTotal,
            total: supportedTotal,
          });

  const handleToggle = async (checked: boolean) => {
    const ok = await onToggleFailover(checked);
    if (ok) {
      toast.success(
        checked
          ? t("band_locking.live.failover_toast_enabled")
          : t("band_locking.live.failover_toast_disabled"),
      );
    } else {
      toast.error(t("band_locking.live.failover_toast_error"));
    }
  };

  const status = FAILOVER_BADGE[failoverKey(failover)];

  return (
    <section className={BAND_HERO} aria-label={t("band_locking.live.title")}>
      {/* --- Lock posture ---------------------------------------------------- */}
      <div className="flex items-center gap-4">
        {isLoading ? (
          <Skeleton className={SKELETON_SHAPE.HERO_DISC} />
        ) : (
          <span className={HERO_DISC} aria-hidden="true">
            <MaterialSymbol name={POSTURE_GLYPH[posture]} size={26} />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span className={HERO_EYEBROW}>
            {t("band_locking.live.eyebrow")}
          </span>
          {isLoading ? (
            <Skeleton className={SKELETON_SHAPE.HERO_VALUE} />
          ) : (
            <span className={HERO_VALUE}>{postureLabel}</span>
          )}
        </div>
      </div>

      {/* --- Failover ---------------------------------------------------------
          The safety net for every category, so it lives with the state rather
          than with any one control card. */}
      {isLoading ? (
        <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
      ) : (
        <div className={HERO_ROW}>
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="text-sm font-semibold">
              {t("band_locking.live.failover_label")}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A 30px disc whose `before:` overlay reaches the 44px this
                    project requires on coarse pointers, without adding a layout
                    box that would push the label off-centre. */}
                <button
                  type="button"
                  aria-label={t("band_locking.live.failover_help_label")}
                  className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring/50 relative grid size-[1.375rem] place-items-center rounded-pill transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-[11px] before:content-[''] focus-visible:ring-[3px] focus-visible:outline-none"
                >
                  <MaterialSymbol name="info" size={18} />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                <p>{t("band_locking.live.failover_help")}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Badge variant={status.variant}>
              <MaterialSymbol
                name={status.glyph}
                size={BADGE_GLYPH_SIZE}
                className={
                  status.spin
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              {t(`band_locking.live.failover_state.${failoverKey(failover)}`)}
            </Badge>
            <Switch
              id="band-failover"
              checked={failover.enabled}
              onCheckedChange={handleToggle}
              disabled={isGated}
              aria-label={t("band_locking.live.failover_label")}
            />
          </div>
        </div>
      )}

      {/* --- On air now -------------------------------------------------------
          Identity chips: the fill says which RADIO the band belongs to, never
          how healthy it is (The Identity-Never-Acts Rule). Band designators are
          device identifiers, so they take the machine typeface. */}
      <div className={HERO_ONAIR.ROOT}>
        <span className={HERO_EYEBROW}>{t("band_locking.live.on_air")}</span>
        <div className={HERO_ONAIR.LIST}>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className={SKELETON_SHAPE.ONAIR_CHIP} />
            ))
          ) : onAir.length === 0 ? (
            <p className="text-on-surface-variant text-sm">
              {t("band_locking.live.on_air_empty")}
            </p>
          ) : (
            onAir.map((band) => (
              <Badge
                key={`${band.variant}-${band.label}`}
                variant={band.variant}
                className="font-mono tabular-nums"
              >
                {band.label}
              </Badge>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export default LiveBandHero;
