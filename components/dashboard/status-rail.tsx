"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Skeleton } from "@/components/ui/skeleton";
import { SwapLabel } from "@/components/ui/swap-label";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { staggerRows, staggerRowItem } from "@/lib/motion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type {
  NetworkStatus,
  ConnectivityStatus,
  ConnectivityState,
} from "@/types/modem-status";
import { cn } from "@/lib/utils";
import { TAG_HEIGHT } from "./shapes";

// =============================================================================
// The page-level status rail — Radio / Internet / Stale
// =============================================================================
// These three chips answer "is the whole thing up?", which is a question about
// the ROUTE and not about any one card. They lived inside the Network Status
// hero for as long as the dashboard had nowhere else to put them: it was the
// only feature route in the product with no page header, so page-level facts
// had to be parked in a card. Step 00 gave the route a header with a rail slot,
// and this file is what fills it.
//
// Everything here moved UNCHANGED from network-status.tsx apart from the legacy
// full radius, which went to the role scale with the rest of that file's 18
// sites. The tone map, the two-clock chip morph, the tooltip, the 44px touch
// target and the copy discipline around the Internet probe are all verbatim.
//
// THIS UPHOLDS THE REASONING IT MOVED AWAY FROM, rather than overturning it.
// The comment that shipped beside the Stale chip argued against promoting it to
// a BANNER — "promoting it to a banner would cry wolf" — and that is still
// right and still binding. A page-header chip is not a banner: it reports a
// live fact in the route's own address block, which is exactly what
// /cellular/settings/apn-management's header chip does. A banner asserts; a
// chip states.
// =============================================================================

interface DashboardStatusRailProps {
  data: NetworkStatus | null;
  connectivity: ConnectivityStatus | null;
  modemReachable: boolean;
  isLoading: boolean;
  isStale: boolean;
}

// ─── Chips ────────────────────────────────────────────────────────────────
// Filled tonal pills. The outline-badge pattern is retired ON THIS RAIL: the
// header needs its live signals to read at a glance, and an outline chip beside
// a 30px page title reads as debris.

// Two clocks, per DESIGN.md > Motion > "Status chip swap" (Motion Guide recipe
// 05). The container's fill and ink morph over `standard` through this CSS
// transition; the contents crossfade over `quick` through the keyed span in the
// body. The state change is therefore FELT peripherally — a 300ms colour mass
// moving at the edge of vision — before it is READ. Collapsing both onto one
// clock loses that ordering, and running the container at `quick` reads as a
// flicker, which is exactly why the old 140-160ms floor was retired.
const CHIP_BASE =
  "inline-flex items-center gap-[7px] rounded-pill text-xs font-semibold py-[7px] pr-[13px] pl-[11px] transition-colors duration-(--duration-standard) ease-standard";

// The four roles a rail chip can wear. Keyed as a record rather than a ternary
// chain so a tone with no container pairing cannot compile — the same guarantee
// `BadgeVariant` gives the shared wrapper, restated here because the rail
// renders its own pill (see the note above).
type ChipTone = "success" | "warning" | "destructive" | "muted";

const CHIP_TONE: Record<ChipTone, string> = {
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
  muted: "bg-surface-container-high text-on-surface-variant",
};

function Chip({
  tone,
  swapKey,
  children,
}: {
  tone: ChipTone;
  /** Identity of the current contents. When it changes the label and glyph
   *  crossfade; when it does not, a poll returning the same state animates
   *  nothing. Callers pass the label, which is what actually changes. */
  swapKey: string;
  children: React.ReactNode;
}) {
  const toneCls = CHIP_TONE[tone];
  return (
    <span className={`${CHIP_BASE} ${toneCls}`}>
      {/* The inner span carries the gap so the crossfade wraps glyph and label
          together: they are one statement, and fading the word while the icon
          holds would let the two disagree for 180ms. */}
      <SwapLabel swapKey={swapKey} className="gap-[7px]">
        {children}
      </SwapLabel>
    </span>
  );
}

// ─── Radio chip ───────────────────────────────────────────────────────────
// "Radio off" is a deliberate state, not a failure, so it renders muted rather
// than destructive — the loudest thing on a glance surface should be a problem
// the user did not choose.
function buildRadioChip(
  modemReachable: boolean,
  radioOn: boolean,
  isAirplaneMode: boolean,
  isSearching: boolean,
  t: TFunction,
): { tone: ChipTone; icon: React.ReactNode; label: string } {
  if (isAirplaneMode) {
    return {
      tone: "warning",
      icon: (
        <MaterialSymbol
          name="airplanemode_active"
          size={15}
          filled
          className="shrink-0"
        />
      ),
      label: t("network.airplane_mode"),
    };
  }
  // Unreachable is NOT "off". When the poller has lost the modem we cannot
  // observe CFUN at all, so claiming the radio is off would assert a device
  // state we did not read. Say we don't know instead.
  if (!modemReachable) {
    return {
      tone: "muted",
      icon: <MaterialSymbol name="help" size={15} filled className="shrink-0" />,
      label: t("network.radio_unknown"),
    };
  }
  if (!radioOn) {
    return {
      tone: "muted",
      icon: (
        <MaterialSymbol
          name="power_settings_new"
          size={15}
          filled
          className="shrink-0"
        />
      ),
      label: t("network.radio_off"),
    };
  }
  if (isSearching) {
    return {
      tone: "warning",
      icon: <MaterialSymbol name="radar" size={15} filled className="shrink-0" />,
      label: t("network.service_searching"),
    };
  }
  return {
    tone: "success",
    icon: (
      <MaterialSymbol name="cell_tower" size={15} filled className="shrink-0" />
    ),
    label: t("network.radio_on"),
  };
}

// ─── Internet chip ────────────────────────────────────────────────────────
// Reads `connectivity.status`, the five-value verdict qmanager_poller derives
// from the ICMP daemon's reachability plus its rolling packet-loss window. It
// deliberately does NOT re-derive that verdict from raw reachability: a link
// answering one ping in ten is reachable and is not healthy, and the poller is
// the only party holding the loss window needed to tell those apart.
//
// The chip used to read a sibling `state` field instead. That field was fed by
// a retired Rust HTTP daemon, so the shell probe that replaced it never wrote
// one — the poller emitted the literal string "unknown" forever, and because a
// non-empty string is truthy the fallback beneath it was unreachable code. The
// chip was therefore pinned grey on every healthy device that ever shipped.
//
// COPY DISCIPLINE. This is an ICMP probe, and plenty of carriers silently drop
// ICMP. An unanswered ping is indistinguishable from a real outage, so nothing
// here may assert an outage: the label reports what was observed (no reply) and
// the tooltip names the ambiguity. The TONE is still destructive, because a
// probe that has stopped answering is worth interrupting for even when the
// cause turns out to be a filter.
interface InternetChip {
  tone: ChipTone;
  dotCls: string;
  live: boolean;
  /**
   * Non-connected states carry a glyph instead of the heartbeat dot, and no two
   * of them may share one. `success-container` (L 0.89) and `warning-container`
   * (L 0.905) measure 1.03:1 apart and are the same surface under deuteranopia,
   * so with `prefers-reduced-motion` stripping the pulse the leading mark is
   * the only channel left. Colour must never be the sole carrier of meaning.
   */
  icon: React.ReactNode | null;
  label: string;
  tooltip: string | null;
}

function buildInternetChip(
  c: ConnectivityStatus | null,
  t: TFunction,
): InternetChip {
  // No connectivity object at all is the same statement as the poller's own
  // "unknown": nothing was measured, so nothing is claimed.
  const status: ConnectivityState = c?.status ?? "unknown";

  switch (status) {
    case "connected":
      return {
        tone: "success",
        dotCls: "bg-success",
        // The pulse is gated on real reachability — a live halo over a dead
        // link is the interface lying about what it knows. It is also this
        // state's distinct leading mark: a beating disc, which no other state
        // renders, and which degrades to a plain filled disc (still unlike any
        // of the four glyphs below) under reduced motion.
        live: true,
        icon: null,
        label: t("network.internet_online"),
        tooltip: null,
      };
    case "degraded":
      return {
        tone: "warning",
        dotCls: "bg-warning",
        // No pulse. The probes ARE answering, but a heartbeat over a link
        // losing a tenth of its packets would read as health.
        live: false,
        icon: (
          <MaterialSymbol
            name="warning"
            size={15}
            filled
            className="shrink-0"
          />
        ),
        label: t("network.internet_degraded"),
        tooltip: t("network.internet_tooltip.degraded"),
      };
    case "recovery":
      return {
        tone: "warning",
        dotCls: "bg-warning",
        live: false,
        icon: (
          <MaterialSymbol
            name="restart_alt"
            size={15}
            filled
            className="shrink-0"
          />
        ),
        label: t("network.internet_recovering"),
        tooltip: t("network.internet_tooltip.recovery"),
      };
    case "disconnected":
      return {
        tone: "destructive",
        dotCls: "bg-destructive",
        live: false,
        icon: (
          <MaterialSymbol
            name="signal_disconnected"
            size={15}
            filled
            className="shrink-0"
          />
        ),
        label: t("network.internet_unreachable"),
        tooltip: t("network.internet_tooltip.no_reply"),
      };
    case "unknown":
    default:
      return {
        tone: "muted",
        dotCls: "bg-on-surface-variant",
        live: false,
        icon: (
          <MaterialSymbol
            name="do_not_disturb_on"
            size={15}
            filled
            className="shrink-0"
          />
        ),
        label: t("network.internet_unknown"),
        tooltip: t("network.internet_tooltip.unknown"),
      };
  }
}

// Internet chip's leading element is a dot, not a glyph — "reachable" is a
// heartbeat, and only a heartbeat gets the live halo.
function InternetDot({ chip }: { chip: InternetChip }) {
  // A glyph, when we have one, beats a dot: it survives colour-blindness and
  // reduced motion, both of which erase the difference between the dots.
  if (chip.icon) return <>{chip.icon}</>;
  if (!chip.live) {
    return (
      <span
        className={`inline-flex size-2 shrink-0 rounded-pill ${chip.dotCls}`}
      />
    );
  }
  return (
    <span className="relative inline-flex size-2 shrink-0">
      <span
        className={`absolute inset-0 rounded-pill ${chip.dotCls} animate-live-ping`}
      />
      <span className={`relative size-2 rounded-pill ${chip.dotCls}`} />
    </span>
  );
}

export function DashboardStatusRail({
  data,
  connectivity,
  modemReachable,
  isLoading,
  isStale,
}: DashboardStatusRailProps) {
  const { t } = useTranslation("dashboard");

  // Airplane mode: CFUN=0 (radio off) or CFUN=4 (RF off)
  const isAirplaneMode = data?.cfun === 0 || data?.cfun === 4;
  const radioOn = modemReachable && !isAirplaneMode;
  const serviceStatus = data?.service_status ?? "unknown";

  const radio = buildRadioChip(
    modemReachable,
    radioOn,
    isAirplaneMode,
    serviceStatus === "searching",
    t,
  );
  const internet = buildInternetChip(connectivity, t);

  if (isLoading) {
    return (
      <>
        <Skeleton className={cn(TAG_HEIGHT, "w-28 rounded-pill")} />
        <Skeleton className={cn(TAG_HEIGHT, "w-24 rounded-pill")} />
      </>
    );
  }

  return (
    // `display: contents` so this element carries the stagger and nothing else:
    // the header's own rail slot already owns the flex row and its gap, and a
    // second flex box inside it would mean two places to change one spacing.
    // The transforms live on the chips below, which are real boxes.
    //
    // Variants only, no initial/animate: this cascade INHERITS the page-wide
    // clock in home-component.tsx. Declaring its own would detach it and start
    // a second clock, which is the defect the single-cascade step retired.
    <motion.div className="contents" variants={staggerRows}>
      {/* Stale — a page-level chip, and deliberately NOT a banner. "Your last
          poll was late" is not an assertive alert; promoting it to a banner
          would cry wolf. A header chip states a live fact without interrupting,
          which is the distinction /cellular/settings/apn-management set.

          Every rail item wraps in an `inline-flex` span, not a bare one:
          transforms are ignored on non-replaced inline boxes, so the row item's
          5px rise would silently do nothing while the opacity half still ran —
          a half-working entrance that reads as a design choice rather than as
          the bug it is. */}
      {isStale && (
        <motion.span variants={staggerRowItem} className="inline-flex">
          <Chip tone="warning" swapKey="stale">
            <MaterialSymbol
              name="schedule"
              size={15}
              filled
              className="shrink-0"
            />
            {t("network.data_delayed_badge")}
          </Chip>
        </motion.span>
      )}

      {/* Radio */}
      <motion.span variants={staggerRowItem} className="inline-flex">
        <Chip tone={radio.tone} swapKey={radio.label}>
          {radio.icon}
          {radio.label}
        </Chip>
      </motion.span>

      {/* Internet */}
      <motion.span variants={staggerRowItem} className="inline-flex">
        {internet.tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                // The chip is 30px tall; `before:` lifts the hit area to the
                // 44px touch floor without shifting any layout.
                //
                // The ring arrives over `quick` and is never animated away: a
                // focus ring that fades out on blur trails the caret through a
                // keyboard pass and reads as lag, which is why only the
                // appearing half is transitioned.
                className="relative rounded-pill transition-[box-shadow] duration-(--duration-quick) ease-quick before:absolute before:-inset-[7px] before:content-[''] focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Chip tone={internet.tone} swapKey={internet.label}>
                  <InternetDot chip={internet} />
                  {internet.label}
                </Chip>
              </button>
            </TooltipTrigger>
            <TooltipContent>{internet.tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <Chip tone={internet.tone} swapKey={internet.label}>
            <InternetDot chip={internet} />
            {internet.label}
          </Chip>
        )}
      </motion.span>
    </motion.div>
  );
}

export default DashboardStatusRail;
