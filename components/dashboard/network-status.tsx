"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRows, staggerRowItem } from "@/lib/motion";
import { SwapLabel } from "@/components/ui/swap-label";
import { MaterialSymbol } from "@/components/ui/material-symbol";
// Two lucide glyphs survive the Material sweep by explicit decision
// (DESIGN.md > Network Status Landmark Rule): the SIM orb's card and its
// airplane-mode stand-in. They are a recognized landmark on the one glance
// surface and re-glyphing them buys nothing.
import { CardSimIcon, Plane } from "lucide-react";

// The RAT glyphs stay react-icons/md for the same reason: "5G", "4G+", "3G" are
// typographic marks Material Symbols has no equivalent for. The exception ends
// there — the low-power leaf is an ordinary pictorial glyph and migrated.
import {
  MdOutline5G,
  Md4gMobiledata,
  Md4gPlusMobiledata,
  Md3gMobiledata,
} from "react-icons/md";

import type {
  NetworkStatus,
  ConnectivityStatus,
  ServiceStatus,
  PingTriState,
} from "@/types/modem-status";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NetworkStatusComponentProps {
  data: NetworkStatus | null;
  connectivity: ConnectivityStatus | null;
  modemReachable: boolean;
  isLoading: boolean;
  isStale: boolean;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Hero glance surface. Deliberately carries NO numeric telemetry: this card
 * answers "is it up?", the sibling carrier cards answer "how good is it?".
 * Do not add dB/ms/percent values here.
 * ────────────────────────────────────────────────────────────────────────────*/

// Shared geometry so the skeletons and the real orbs can never drift apart.
const ORB = "size-[152px]";
// 96 in a 152 disc leaves ~28px of optical padding. 74 left 39px, which read as
// a small mark floating in a large disc rather than as a single object. The
// ceiling is set by the corner badge, not by taste: the badge occupies
// x 110-138 / y 4-32 of the orb box, and at 96px the widest glyph's ink still
// clears it. Do not raise this without re-checking that overlap.
const GLYPH = "size-[96px]";

// The prototype's badge lift. Not a token: it is a one-off elevation on a
// 28px disc, and --shadow-whisper is a card-level shadow, not this.
const BADGE_SHADOW = "shadow-[0_2px_6px_oklch(0.20_0.05_262_/_0.25)]";

// --- Helper: Determine network icon & label keys from type + CA status ---
// Returns dashboard-namespace keys (network.*); the component resolves them via
// t() so these stay pure, hook-free helpers. Glyphs inherit `currentColor` from
// the orb so the same icon works on a filled and a container surface.
function getNetworkDisplay(
  type: string,
  caActive: boolean,
  nrCaActive: boolean,
) {
  switch (type) {
    case "5G-NSA":
      return {
        icon: <MdOutline5G className={GLYPH} />,
        labelKey: "network.signal_5g",
        sublabelKey: nrCaActive ? "network.signal_5g_lte_nrca" : "network.signal_5g_lte",
        hasNetwork: true,
      };
    case "5G-SA":
      return {
        icon: <MdOutline5G className={GLYPH} />,
        labelKey: "network.signal_5g",
        sublabelKey: nrCaActive ? "network.signal_sa_nrca" : "network.signal_sa",
        hasNetwork: true,
      };
    case "LTE":
      return caActive
        ? {
            icon: <Md4gPlusMobiledata className={GLYPH} />,
            labelKey: "network.signal_lte_plus",
            sublabelKey: "network.ca_4g",
            hasNetwork: true,
          }
        : {
            icon: <Md4gMobiledata className={GLYPH} />,
            labelKey: "network.signal_lte",
            sublabelKey: "network.connected_4g",
            hasNetwork: true,
          };
    default:
      return {
        icon: <Md3gMobiledata className={GLYPH} />,
        labelKey: "network.signal_generic",
        sublabelKey: "network.no_signal",
        hasNetwork: false,
      };
  }
}

// --- Helper: Service status label key ---
function getServiceLabelKey(status: ServiceStatus) {
  switch (status) {
    case "optimal":
      return "network.service_optimal";
    case "connected":
      return "network.service_connected";
    case "limited":
      return "network.service_limited";
    case "no_service":
      return "network.service_no_service";
    case "searching":
      return "network.service_searching";
    case "sim_error":
      return "network.service_sim_error";
    default:
      return "network.service_unknown";
  }
}

// --- Helper: Ring-stack tone family based on network type ---
// Green: LTE+ (CA), 5G-SA, 5G-NSA, SA with NR-CA
// Yellow: single-band LTE or 3G
// Red: no signal
function getServiceColor(
  type: string,
  caActive: boolean,
  serviceStatus: ServiceStatus,
): "green" | "yellow" | "red" {
  // No service / no signal → red
  if (
    serviceStatus === "no_service" ||
    serviceStatus === "sim_error" ||
    serviceStatus === "unknown" ||
    !type
  ) {
    return "red";
  }

  // 5G (NSA or SA, with or without CA) → green
  if (type === "5G-NSA" || type === "5G-SA") {
    return "green";
  }

  // LTE with carrier aggregation (LTE+) → green
  if (type === "LTE" && caActive) {
    return "green";
  }

  // Single-band LTE or 3G → yellow
  return "yellow";
}

// Ring stacks use explicit tone steps, never stacked alpha — three translucent
// discs over one another composite to a flat disc and the ring structure
// disappears (Motion Guide recipe 13).
//
// All three ramps are now symmetric: each walks its own role's --tone-{role}-1
// →2→3 outward-in and lands on the solid role at the core. The red branch used
// to borrow the neutral surface containers with a single red note, which read
// as broken chrome rather than as a red state — greyed-out UI, not an outage.
// A failed link is not quiet; it is the loudest thing on the glance surface.
//
// What keeps that from crying wolf is the PULSE, not the palette: isServiceActive
// gates the animation, so red and static-amber stacks are frozen while only a
// live one breathes. Tone says how bad, motion says whether it is alive.
const serviceColorMap: Record<
  "green" | "yellow" | "red",
  { ring1: string; ring2: string; ring3: string; center: string }
> = {
  green: {
    ring1: "bg-tone-success-1",
    ring2: "bg-tone-success-2",
    ring3: "bg-tone-success-3",
    center: "bg-success text-success-foreground",
  },
  yellow: {
    ring1: "bg-tone-warning-1",
    ring2: "bg-tone-warning-2",
    ring3: "bg-tone-warning-3",
    center: "bg-warning text-warning-foreground",
  },
  red: {
    ring1: "bg-tone-destructive-1",
    ring2: "bg-tone-destructive-2",
    ring3: "bg-tone-destructive-3",
    center: "bg-destructive text-destructive-foreground",
  },
};

// ─── Chips ────────────────────────────────────────────────────────────────
// Filled tonal pills. The outline-badge pattern is retired ON THIS CARD ONLY:
// the hero surface needs its two live signals to read at a glance, and an
// outline chip on a borderless 40px card reads as debris.

// Two clocks, per DESIGN.md > Motion > "Status chip swap" (Motion Guide recipe
// 05). The container's fill and ink morph over `standard` through this CSS
// transition; the contents crossfade over `quick` through the keyed span in the
// body. The state change is therefore FELT peripherally — a 300ms colour mass
// moving at the edge of vision — before it is READ. Collapsing both onto one
// clock loses that ordering, and running the container at `quick` reads as a
// flicker, which is exactly why the old 140-160ms floor was retired.
const CHIP_BASE =
  "inline-flex items-center gap-[7px] rounded-full text-xs font-semibold py-[7px] pr-[13px] pl-[11px] transition-colors duration-(--duration-standard) ease-standard";

function Chip({
  tone,
  swapKey,
  children,
}: {
  tone: "success" | "warning" | "muted";
  /** Identity of the current contents. When it changes the label and glyph
   *  crossfade; when it does not, a poll returning the same state animates
   *  nothing. Callers pass the label, which is what actually changes. */
  swapKey: string;
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "success"
      ? "bg-success-container text-on-success-container"
      : tone === "warning"
        ? "bg-warning-container text-on-warning-container"
        : "bg-surface-container-high text-on-surface-variant";
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
): { tone: "success" | "warning" | "muted"; icon: React.ReactNode; label: string } {
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
// The producer is a shell ICMP probe: it emits reachable / streak_fail /
// last_family and nothing else. The old down_reason branches (timeout, refused,
// reset, dns, malformed) were plumbing for a retired Rust HTTP daemon and could
// never fire — they are gone, along with the copy that named a cause.
//
// Unreachable renders WARNING, not destructive: ICMP is carrier-variable (some
// carriers silently drop it), so a missing reply is a strong hint, not a fact.
// Making a known-noisy signal the loudest thing on the glance surface trains
// the user to ignore it.
interface InternetChip {
  tone: "success" | "warning" | "muted";
  dotCls: string;
  live: boolean;
  /**
   * Non-connected states carry a glyph instead of the heartbeat dot. Green and
   * amber converge under deuteranopia and `success-container` (L 0.89) and
   * `warning-container` (L 0.905) are near-identical in lightness, so without
   * this the pulse is the ONLY differentiator — and `prefers-reduced-motion`
   * removes the pulse. Colour must never be the sole carrier of meaning.
   */
  icon: React.ReactNode | null;
  label: string;
  tooltip: string | null;
}

function buildInternetChip(
  c: ConnectivityStatus | null,
  t: TFunction,
): InternetChip {
  // Prefer the tri-state field; fall back to internet_available for
  // rolling-upgrade safety (poller without Phase 2 forwarding).
  let state: PingTriState = "unknown";
  if (c?.state) {
    state = c.state;
  } else if (c?.internet_available === true) {
    state = "connected";
  } else if (c?.internet_available === false) {
    state = "disconnected";
  }

  switch (state) {
    case "connected":
      return {
        tone: "success",
        dotCls: "bg-success",
        // The pulse is gated on real reachability — a live halo over a dead
        // link is the interface lying about what it knows.
        live: true,
        icon: null,
        label: t("network.internet_online"),
        tooltip: null,
      };
    case "disconnected":
      return {
        tone: "warning",
        dotCls: "bg-warning",
        live: false,
        icon: (
          <MaterialSymbol
            name="warning"
            size={15}
            filled
            className="shrink-0"
          />
        ),
        label: t("network.internet_unreachable"),
        tooltip: t("network.internet_tooltip.no_reply"),
      };
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
        label: t("network.internet_label"),
        tooltip: null,
      };
  }
}

// ─── Corner badge ─────────────────────────────────────────────────────────
// The glyph changes with the colour. That is the colour-blindness contract,
// not a stylistic choice: never encode ok/warn/fail in hue alone.
function CornerBadge({ state }: { state: "ok" | "warn" | "fail" }) {
  const cls =
    state === "ok"
      ? "bg-success text-success-foreground"
      : state === "warn"
        ? "bg-warning text-warning-foreground"
        : "bg-destructive text-destructive-foreground";
  return (
    <span
      aria-hidden="true"
      className={`absolute top-[4px] right-[14px] grid size-7 place-items-center rounded-full transition-colors duration-(--duration-standard) ease-standard ${cls} ${BADGE_SHADOW}`}
    >
      {/* The badge is a 28px disc, so its fill morph is small enough to miss.
          Crossfading the glyph on the `quick` clock is what makes the change
          legible at that size — and the glyph is the half that survives
          greyscale and deuteranopia, so it is the half that must not snap. */}
      <SwapLabel swapKey={state} className="justify-center">
        {state === "ok" ? (
          <MaterialSymbol name="check" size={17} filled />
        ) : state === "warn" ? (
          <MaterialSymbol name="warning" size={17} filled />
        ) : (
          <MaterialSymbol name="close" size={17} filled />
        )}
      </SwapLabel>
    </span>
  );
}

// SIM orb verdict: sim_error / no_service are failures; searching and limited
// are transitional, which is exactly what the warning glyph is for.
function simBadgeState(status: ServiceStatus): "ok" | "warn" | "fail" {
  if (status === "optimal" || status === "connected") return "ok";
  if (status === "searching" || status === "limited") return "warn";
  return "fail";
}

// ─── Orb label block ──────────────────────────────────────────────────────
// Both lines swap on real state changes only — the RAT label on a handover, the
// carrier and service lines when the network moves. These are LABEL swaps, not
// live values, so they take the `SwapLabel` crossfade that DESIGN.md
// prescribes for the label half of a chip, not `TickingValue`: that component
// bakes in `tabular-nums`, which is right for a figure and wrong for prose, and
// its contract is a datum that moves on a poll rather than a word that changes
// on a handover. The block is centre-aligned, which is what lets a width change
// ride under the crossfade without the text appearing to slide.
function OrbLabel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-[3px] text-center">
      <SwapLabel
        swapKey={title}
        className="justify-center text-base leading-none font-semibold"
      >
        {title}
      </SwapLabel>
      <SwapLabel
        swapKey={subtitle}
        className="justify-center text-sm text-on-surface-variant"
      >
        {subtitle}
      </SwapLabel>
    </div>
  );
}

function OrbSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <Skeleton className={`${ORB} rounded-full`} />
      <div className="flex flex-col items-center gap-[3px]">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3.5 w-28" />
      </div>
    </div>
  );
}

const NetworkStatusComponent = ({
  data,
  connectivity,
  modemReachable,
  isLoading,
  isStale,
}: NetworkStatusComponentProps) => {
  const { t } = useTranslation("dashboard");
  // Derive display values
  const networkType = data?.type ?? "";
  const serviceStatus = data?.service_status ?? "unknown";
  const carrier = data?.carrier ?? "";
  const simSlot = data?.sim_slot ?? 1;
  const caActive = data?.ca_active ?? false;
  const nrCaActive = data?.nr_ca_active ?? false;

  const networkDisplay = getNetworkDisplay(networkType, caActive, nrCaActive);
  const networkLabel = t(networkDisplay.labelKey);
  const networkSublabel = t(networkDisplay.sublabelKey);
  const serviceLabel = t(getServiceLabelKey(serviceStatus));
  const serviceColor = getServiceColor(networkType, caActive, serviceStatus);
  // Airplane mode: CFUN=0 (radio off) or CFUN=4 (RF off)
  const isAirplaneMode = data?.cfun === 0 || data?.cfun === 4;

  // Airplane mode reports `no_service`, which maps to the destructive ramp —
  // but the user CHOSE this. Destructive fill is reserved for failures the user
  // did not pick, so a deliberate off-state wears muted surface tones instead.
  const serviceColors = isAirplaneMode
    ? {
        ring1: "bg-surface-container",
        ring2: "bg-surface-container-high",
        ring3: "bg-surface-container-high",
        center: "bg-surface-container-high text-on-surface-variant",
      }
    : serviceColorMap[serviceColor];

  // Radio is ON when the modem is reachable and not in airplane mode
  const radioOn = modemReachable && !isAirplaneMode;

  // Service is active when we have a good service status
  const isServiceActive =
    serviceStatus === "optimal" || serviceStatus === "connected";

  // The core disc's verdict, named once so the glyph's crossfade key and the
  // glyph itself can never disagree about which state is being drawn — keying
  // a swap on a value re-derived beside the branch is how a crossfade silently
  // stops firing.
  const coreState: "off" | "ok" | "warn" | "fail" = isAirplaneMode
    ? "off"
    : isServiceActive
      ? "ok"
      : serviceStatus === "searching" || serviceStatus === "limited"
        ? "warn"
        : "fail";

  // Whether we have a real network (LTE/5G), not fallback 3G
  const hasNetwork = networkDisplay.hasNetwork;

  const radio = buildRadioChip(
    modemReachable,
    radioOn,
    isAirplaneMode,
    serviceStatus === "searching",
    t,
  );
  const internet = buildInternetChip(connectivity, t);

  return (
    <Card className="@container/card gap-5 rounded-hero border-0 px-7 py-[26px] shadow-[var(--shadow-whisper)]">
      {/* ── Header row ── */}
      <div className="flex flex-wrap items-center gap-4">
        {/* h3 to match the sibling CardTitle level — the hero's prominence is
            carried by size, not by jumping the heading hierarchy. */}
        <h3 className="text-[30px] font-semibold tracking-[-0.02em]">
          {t("network.title")}
        </h3>

        {isLoading ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Skeleton className="h-[30px] w-28 rounded-full" />
            <Skeleton className="h-[30px] w-24 rounded-full" />
          </div>
        ) : (
          // flex-wrap so up to three chips break BETWEEN pills on a phone
          // rather than overflowing the hero or wrapping inside a pill.
          //
          // The rail cascades on the row step when data first lands. It is the
          // shorter of the card's two groups and sits above the orbs, so it
          // reads as the first beat of one entrance rather than as a second,
          // competing one.
          <motion.div
            className="ml-auto flex flex-wrap items-center justify-end gap-2"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {/* Stale — stays a CARD-scoped chip. "Your last poll was late" is
                not an assertive alert; promoting it to a banner would cry wolf.

                Every rail item wraps in an `inline-flex` span, not a bare one:
                transforms are ignored on non-replaced inline boxes, so the row
                item's 5px rise would silently do nothing while the opacity
                half still ran — a half-working entrance that reads as a design
                choice rather than as the bug it is. */}
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
                      // The chip is 30px tall; `before:` lifts the hit area to
                      // the 44px touch floor without shifting any layout.
                      //
                      // The ring arrives over `quick` and is never animated
                      // away: a focus ring that fades out on blur trails the
                      // caret through a keyboard pass and reads as lag, which
                      // is why only the appearing half is transitioned.
                      className="relative rounded-full transition-[box-shadow] duration-(--duration-quick) ease-quick before:absolute before:-inset-[7px] before:content-[''] focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
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
        )}
      </div>

      {/* ── Three orbs ──
          One branch, not three: the cascade has to key on the skeleton→data
          handoff, and with a ternary per orb the wrapper grid persists across
          that handoff, so a container mounted with the skeletons would have
          fired its entrance against placeholder geometry and left the real
          orbs to appear with no motion at all. */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 place-items-center @lg/card:grid-cols-3">
          <OrbSkeleton />
          <OrbSkeleton />
          <OrbSkeleton />
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-1 gap-4 place-items-center @lg/card:grid-cols-3"
          variants={staggerRows}
          initial="hidden"
          animate="visible"
        >
          {/* === Orb 1 — Radio / RAT === */}
          <motion.div
            variants={staggerRowItem}
            className="flex flex-col items-center gap-2.5"
          >
            <div className="relative">
              {/* Every orb fill morphs over `standard`. These are 152px
                  containers changing fill — the largest colour mass on the
                  dashboard — and a hard swap on a RAT handover or an airplane
                  toggle is the single most jarring frame the card can produce. */}
              <div
                className={`${ORB} grid place-items-center rounded-full transition-colors duration-(--duration-standard) ease-standard ${
                  isAirplaneMode
                    ? "bg-success-container text-on-success-container"
                    : hasNetwork
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {isAirplaneMode ? (
                  <MaterialSymbol name="energy_savings_leaf" size={96} filled />
                ) : (
                  networkDisplay.icon
                )}
              </div>
              {!isAirplaneMode && (
                <CornerBadge state={hasNetwork ? "ok" : "fail"} />
              )}
            </div>
            <OrbLabel
              title={isAirplaneMode ? t("network.low_power") : networkLabel}
              subtitle={isAirplaneMode ? t("network.radio_off") : networkSublabel}
            />
          </motion.div>

          {/* === Orb 2 — SIM / Carrier === */}
          <motion.div
            variants={staggerRowItem}
            className="flex flex-col items-center gap-2.5"
          >
            <div className="relative">
              <div
                className={`${ORB} grid place-items-center rounded-full transition-colors duration-(--duration-standard) ease-standard ${
                  isAirplaneMode
                    ? "bg-surface-container-high text-on-surface-variant"
                    : "bg-primary-container text-on-primary-container"
                }`}
              >
                {isAirplaneMode ? (
                  <Plane className={GLYPH} strokeWidth={1.25} />
                ) : (
                  <CardSimIcon className={GLYPH} strokeWidth={1.25} />
                )}
              </div>
              {!isAirplaneMode && (
                <CornerBadge state={simBadgeState(serviceStatus)} />
              )}
            </div>
            <OrbLabel
              title={t("network.sim_label", { slot: simSlot })}
              subtitle={
                isAirplaneMode
                  ? t("network.airplane_mode")
                  : carrier || t("network.no_carrier")
              }
            />
          </motion.div>

          {/* === Orb 3 — Service ring stack ===
              The isServiceActive gate is load-bearing: rings only breathe when
              service is genuinely live. A pulsing ring over "No Service" would
              animate a lie, so the inactive branch renders the same geometry
              static.

              The ring tones morph over `standard` in BOTH branches. That is
              the seam the gate creates: crossing it swaps the whole ramp (say
              success → destructive) at the same instant the pulse starts or
              stops, and without the transition the stack jump-cuts to a new
              colour. The morph runs on background-color while the ambient loop
              runs on transform and opacity, so the two never contend. */}
          <motion.div
            variants={staggerRowItem}
            className="flex flex-col items-center gap-2.5"
          >
            <div className={`relative ${ORB} grid place-items-center`}>
              {isServiceActive ? (
                <>
                  <span
                    className={`absolute size-[152px] rounded-full transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring1} animate-pulse-ring`}
                  />
                  <span
                    className={`absolute size-[112px] rounded-full transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring2} animate-pulse-ring`}
                    style={{ animationDelay: "0.3s" }}
                  />
                  <span
                    className={`absolute size-[80px] rounded-full transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring3} animate-pulse-ring`}
                    style={{ animationDelay: "0.6s" }}
                  />
                </>
              ) : (
                <>
                  <span
                    className={`absolute size-[152px] rounded-full transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring1}`}
                  />
                  <span
                    className={`absolute size-[112px] rounded-full transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring2}`}
                  />
                  <span
                    className={`absolute size-[80px] rounded-full transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring3}`}
                  />
                </>
              )}
              <span
                aria-hidden="true"
                className={`relative grid size-[48px] place-items-center rounded-full transition-colors duration-(--duration-standard) ease-standard ${serviceColors.center}`}
              >
                {/* The core glyph tracks service LIVENESS, not the ring tone:
                    a yellow stack just means single-band LTE, which is still a
                    working connection and must not wear an alert glyph — hence
                    amber-pulsing rings around a `check`. `warning` is reserved
                    for the transitional states (searching / limited) and
                    `priority_high` for outright failure, so all four states
                    hold distinct glyphs and the card never encodes its verdict
                    in hue alone.
                    Crossfaded on `quick` so the glyph and the disc fill never
                    disagree for longer than a label swap. */}
                <SwapLabel swapKey={coreState} className="justify-center">
                  {coreState === "off" ? (
                    <MaterialSymbol name="power_settings_new" size={22} />
                  ) : coreState === "ok" ? (
                    <MaterialSymbol name="check" size={22} />
                  ) : coreState === "warn" ? (
                    <MaterialSymbol name="warning" size={22} filled />
                  ) : (
                    <MaterialSymbol name="priority_high" size={22} />
                  )}
                </SwapLabel>
              </span>
            </div>
            <OrbLabel
              title={
                isAirplaneMode
                  ? t("network.standby_label")
                  : t("network.service_label")
              }
              subtitle={isAirplaneMode ? t("network.radio_off") : serviceLabel}
            />
          </motion.div>
        </motion.div>
      )}
    </Card>
  );
};

// Internet chip's leading element is a dot, not a glyph — "reachable" is a
// heartbeat, and only a heartbeat gets the live halo.
function InternetDot({ chip }: { chip: InternetChip }) {
  // A glyph, when we have one, beats a dot: it survives colour-blindness and
  // reduced motion, both of which erase the difference between the dots.
  if (chip.icon) return <>{chip.icon}</>;
  if (!chip.live) {
    return (
      <span
        className={`inline-flex size-2 shrink-0 rounded-full ${chip.dotCls}`}
      />
    );
  }
  return (
    <span className="relative inline-flex size-2 shrink-0">
      <span
        className={`absolute inset-0 rounded-full ${chip.dotCls} animate-live-ping`}
      />
      <span className={`relative size-2 rounded-full ${chip.dotCls}`} />
    </span>
  );
}

export default NetworkStatusComponent;
