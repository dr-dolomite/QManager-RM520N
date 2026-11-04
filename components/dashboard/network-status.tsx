"use client";

import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

import type { NetworkStatus, ServiceStatus } from "@/types/modem-status";

import { CARD_DESC, CARD_TITLE, HERO_SHELL, ORB } from "./shapes";

interface NetworkStatusComponentProps {
  data: NetworkStatus | null;
  modemReachable: boolean;
  isLoading: boolean;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Hero glance surface. Deliberately carries NO numeric telemetry: this card
 * answers "is it up?", the sibling carrier cards answer "how good is it?".
 * Do not add dB/ms/percent values here.
 *
 * It no longer carries the Radio / Internet / Stale rail either. Those three
 * chips answer "is the WHOLE THING up?", which is a page question, and they now
 * render through the page header's rail slot from
 * `components/dashboard/status-rail.tsx`. What is left here is three orbs and
 * their labels, which is what the card was always about.
 *
 * All geometry comes from `./shapes`. This file used to declare its own
 * identical copies of the orb box, the glyph size and the badge lift beside the
 * ones in the shapes module — two declarations of one number, either of which
 * a future author could have changed alone.
 * ────────────────────────────────────────────────────────────────────────────*/

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
        icon: <MdOutline5G className={ORB.GLYPH} />,
        labelKey: "network.signal_5g",
        sublabelKey: nrCaActive ? "network.signal_5g_lte_nrca" : "network.signal_5g_lte",
        hasNetwork: true,
      };
    case "5G-SA":
      return {
        icon: <MdOutline5G className={ORB.GLYPH} />,
        labelKey: "network.signal_5g",
        sublabelKey: nrCaActive ? "network.signal_sa_nrca" : "network.signal_sa",
        hasNetwork: true,
      };
    case "LTE":
      return caActive
        ? {
            icon: <Md4gPlusMobiledata className={ORB.GLYPH} />,
            labelKey: "network.signal_lte_plus",
            sublabelKey: "network.ca_4g",
            hasNetwork: true,
          }
        : {
            icon: <Md4gMobiledata className={ORB.GLYPH} />,
            labelKey: "network.signal_lte",
            sublabelKey: "network.connected_4g",
            hasNetwork: true,
          };
    default:
      return {
        icon: <Md3gMobiledata className={ORB.GLYPH} />,
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

// The neutral ramp, used by the two states where a role colour would assert
// something the card did not observe: a deliberate airplane-mode off-state, and
// a poll that never came back.
const MUTED_RINGS = {
  ring1: "bg-surface-container",
  ring2: "bg-surface-container-high",
  ring3: "bg-surface-container-high",
  center: "bg-surface-container-high text-on-surface-variant",
};

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
      className={`absolute ${ORB.BADGE} grid place-items-center rounded-pill transition-colors duration-(--duration-standard) ease-standard ${cls} ${ORB.LIFT}`}
    >
      {/* The badge is a small disc, so its fill morph is easy to miss.
          Crossfading the glyph on the `quick` clock is what makes the change
          legible at that size — and the glyph is the half that survives
          greyscale and deuteranopia, so it is the half that must not snap.

          The `style` override is what scales the glyph with the orb: the size
          prop lands as an inline fontSize that no utility can reach, and the
          primitive spreads `style` after it. `size` still carries the optical-
          size axis. */}
      <SwapLabel swapKey={state} className="justify-center">
        <MaterialSymbol
          name={state === "ok" ? "check" : state === "warn" ? "warning" : "close"}
          size={ORB.OPSZ.BADGE}
          filled
          style={{ fontSize: ORB.SYMBOL.BADGE }}
        />
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
    <div className={ORB.LABEL.ROOT}>
      <SwapLabel swapKey={title} className={ORB.LABEL.TITLE}>
        {title}
      </SwapLabel>
      <SwapLabel swapKey={subtitle} className={ORB.LABEL.SUB}>
        {subtitle}
      </SwapLabel>
    </div>
  );
}

function OrbSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <Skeleton className={`${ORB.BOX} rounded-pill`} />
      <div className="flex flex-col items-center gap-[3px]">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3.5 w-20" />
      </div>
    </div>
  );
}

const NetworkStatusComponent = ({
  data,
  modemReachable,
  isLoading,
}: NetworkStatusComponentProps) => {
  const { t } = useTranslation("dashboard");
  // Derive display values
  const networkType = data?.type ?? "";
  const serviceStatus = data?.service_status ?? "unknown";
  const carrier = data?.carrier ?? "";
  const simSlot = data?.sim_slot ?? 1;
  const caActive = data?.ca_active ?? false;
  const nrCaActive = data?.nr_ca_active ?? false;

  // The last poll did not come back. Everything below is then a statement about
  // a payload that was never read, so the card says so rather than drawing a
  // full, confident set of orbs underneath a page banner that says the modem is
  // unreachable. The card and the banner used to disagree.
  const unreachable = !modemReachable;

  const networkDisplay = getNetworkDisplay(networkType, caActive, nrCaActive);
  const networkLabel = t(networkDisplay.labelKey);
  const networkSublabel = t(networkDisplay.sublabelKey);
  const serviceLabel = t(getServiceLabelKey(serviceStatus));
  const serviceColor = getServiceColor(networkType, caActive, serviceStatus);
  // Airplane mode: CFUN=0 (radio off) or CFUN=4 (RF off)
  const isAirplaneMode = !unreachable && (data?.cfun === 0 || data?.cfun === 4);

  // Airplane mode reports `no_service`, which maps to the destructive ramp —
  // but the user CHOSE this. Destructive fill is reserved for failures the user
  // did not pick, so a deliberate off-state wears muted surface tones instead.
  // An unreachable modem takes the same ramp for the mirror-image reason: we
  // did not observe a failure, we observed nothing.
  const serviceColors =
    unreachable || isAirplaneMode ? MUTED_RINGS : serviceColorMap[serviceColor];

  // The unreachable orb body. Neutral, because the alternative is painting a
  // role colour onto a reading that does not exist.
  const MUTED_ORB = "bg-surface-container-high text-on-surface-variant";

  // Service is active when we have a good service status.
  //
  // THIS IS THE ONLY GATE ON THE AMBIENT LOOP and it is deliberately left as it
  // was. It already covers the unreachable case rather than needing a second
  // clause beside it: `determine_service_status()` in qmanager_poller resets
  // service_status to "unknown" on every cycle where modem_reachable is not
  // true (qmanager_poller:1313-1319), so an unreachable modem can never reach
  // either arm below. Two gates on one loop is how a later author removes the
  // wrong one. Verified against the poller, not assumed.
  const isServiceActive =
    serviceStatus === "optimal" || serviceStatus === "connected";

  // The core disc's verdict, named once so the glyph's crossfade key and the
  // glyph itself can never disagree about which state is being drawn — keying
  // a swap on a value re-derived beside the branch is how a crossfade silently
  // stops firing.
  const coreState: "off" | "ok" | "warn" | "fail" | "unknown" = unreachable
    ? "unknown"
    : isAirplaneMode
      ? "off"
      : isServiceActive
        ? "ok"
        : serviceStatus === "searching" || serviceStatus === "limited"
          ? "warn"
          : "fail";

  // Whether we have a real network (LTE/5G), not fallback 3G
  const hasNetwork = networkDisplay.hasNetwork;

  return (
    <Card className={HERO_SHELL}>
      {/* The heading sits at the shared 18px Title step, not at the Display
          step it used to wear. That size belongs to the page h1 — one per
          route — and this card was standing in for a page header the route did
          not have until step 00 gave it one.

          CardDescription carries an explicit ink class because the primitive
          hardcodes a retired one. */}
      <CardHeader className="px-0">
        <CardTitle className={CARD_TITLE}>{t("network.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {unreachable
            ? t("network.description_unreachable")
            : t("network.description")}
        </CardDescription>
      </CardHeader>

      {/* ── Three orbs ──
          One branch, not three: the cascade has to key on the skeleton→data
          handoff, and with a ternary per orb the wrapper grid persists across
          that handoff, so a container mounted with the skeletons would have
          fired its entrance against placeholder geometry and left the real
          orbs to appear with no motion at all.

          Both branches carry ORB.SCALE, which declares the one custom property
          every dimension below derives from — so the skeleton and the loaded
          orb are the same size at every width by construction. */}
      {isLoading ? (
        <div className={`${ORB.SCALE} ${ORB.GRID}`}>
          <OrbSkeleton />
          <OrbSkeleton />
          <OrbSkeleton />
        </div>
      ) : (
        <motion.div
          className={`${ORB.SCALE} ${ORB.GRID}`}
          // Variants only, no initial/animate: this cascade INHERITS the
          // page-wide clock in home-component.tsx. Declaring its own would
          // detach it and start a second clock, which is the defect the
          // single-cascade step retired.
          variants={staggerRows}
        >
          {/* === Orb 1 — Radio / RAT === */}
          <motion.div
            variants={staggerRowItem}
            className="flex flex-col items-center gap-2.5"
          >
            <div className="relative">
              {/* Every orb fill morphs over `standard`. These are the largest
                  colour mass on the dashboard, and a hard swap on a RAT
                  handover or an airplane toggle is the single most jarring
                  frame the card can produce. */}
              <div
                className={`${ORB.BOX} grid place-items-center rounded-pill transition-colors duration-(--duration-standard) ease-standard ${
                  unreachable
                    ? MUTED_ORB
                    : isAirplaneMode
                      ? "bg-success-container text-on-success-container"
                      : hasNetwork
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {unreachable ? (
                  <MaterialSymbol
                    name="signal_cellular_off"
                    size={ORB.OPSZ.BODY}
                    filled
                    style={{ fontSize: ORB.SYMBOL.BODY }}
                  />
                ) : isAirplaneMode ? (
                  <MaterialSymbol
                    name="energy_savings_leaf"
                    size={ORB.OPSZ.BODY}
                    filled
                    style={{ fontSize: ORB.SYMBOL.BODY }}
                  />
                ) : (
                  networkDisplay.icon
                )}
              </div>
              {!isAirplaneMode && (
                <CornerBadge
                  state={unreachable ? "fail" : hasNetwork ? "ok" : "fail"}
                />
              )}
            </div>
            <OrbLabel
              title={
                unreachable
                  ? networkLabel
                  : isAirplaneMode
                    ? t("network.low_power")
                    : networkLabel
              }
              subtitle={
                unreachable
                  ? t("network.unreachable")
                  : isAirplaneMode
                    ? t("network.radio_off")
                    : networkSublabel
              }
            />
          </motion.div>

          {/* === Orb 2 — SIM / Carrier ===
              On the STRONG fill, not the pale container: The Glyph-Disc Rule.
              In light mode the identity containers collapse under CVD
              simulation and the fills do not, so a 152px category disc on a
              container is the one place the identity colour is least legible. */}
          <motion.div
            variants={staggerRowItem}
            className="flex flex-col items-center gap-2.5"
          >
            <div className="relative">
              <div
                className={`${ORB.BOX} grid place-items-center rounded-pill transition-colors duration-(--duration-standard) ease-standard ${
                  unreachable || isAirplaneMode
                    ? MUTED_ORB
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {isAirplaneMode ? (
                  <Plane className={ORB.GLYPH} strokeWidth={1.25} />
                ) : (
                  <CardSimIcon className={ORB.GLYPH} strokeWidth={1.25} />
                )}
              </div>
              {!isAirplaneMode && (
                <CornerBadge
                  state={unreachable ? "fail" : simBadgeState(serviceStatus)}
                />
              )}
            </div>
            <OrbLabel
              // A slot number is a reading like any other. With no poll to read
              // it from, the label drops the number rather than asserting 1.
              title={
                unreachable
                  ? t("network.sim_generic")
                  : t("network.sim_label", { slot: simSlot })
              }
              subtitle={
                unreachable
                  ? t("network.unreachable")
                  : isAirplaneMode
                    ? t("network.airplane_mode")
                    : carrier || t("network.no_carrier")
              }
            />
          </motion.div>

          {/* === Orb 3 — Service ring stack ===
              The isServiceActive gate is load-bearing: rings only breathe when
              service is genuinely live. A pulsing ring over "No Service" would
              animate a lie, so the inactive branch renders the same geometry
              static — and an unreachable modem reaches that branch for free,
              because the poller resets service_status to "unknown" whenever it
              cannot see the device.

              The ring tones morph over `standard` in BOTH branches. That is
              the seam the gate creates: crossing it swaps the whole ramp (say
              success → destructive) at the same instant the pulse starts or
              stops, and without the transition the stack jump-cuts to a new
              colour. The morph runs on background-color while the ambient loop
              runs on transform and opacity, so the two never contend.

              Every disc below is a calc against ORB.SCALE's one property, at
              the shipped 1 / 0.7368 / 0.5263 proportions around a 0.3158 core.
              animate-pulse-ring is a transform scale, so it is proportional and
              reads the same at both sizes. */}
          <motion.div
            variants={staggerRowItem}
            className="flex flex-col items-center gap-2.5"
          >
            <div className={`relative ${ORB.BOX} grid place-items-center`}>
              {isServiceActive ? (
                <>
                  <span
                    className={`absolute ${ORB.RING_1} rounded-pill transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring1} animate-pulse-ring`}
                  />
                  <span
                    className={`absolute ${ORB.RING_2} rounded-pill transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring2} animate-pulse-ring`}
                    style={{ animationDelay: "0.3s" }}
                  />
                  <span
                    className={`absolute ${ORB.RING_3} rounded-pill transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring3} animate-pulse-ring`}
                    style={{ animationDelay: "0.6s" }}
                  />
                </>
              ) : (
                <>
                  <span
                    className={`absolute ${ORB.RING_1} rounded-pill transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring1}`}
                  />
                  <span
                    className={`absolute ${ORB.RING_2} rounded-pill transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring2}`}
                  />
                  <span
                    className={`absolute ${ORB.RING_3} rounded-pill transition-colors duration-(--duration-standard) ease-standard ${serviceColors.ring3}`}
                  />
                </>
              )}
              <span
                aria-hidden="true"
                className={`relative ${ORB.CORE} grid place-items-center rounded-pill transition-colors duration-(--duration-standard) ease-standard ${serviceColors.center}`}
              >
                {/* The core glyph tracks service LIVENESS, not the ring tone:
                    a yellow stack just means single-band LTE, which is still a
                    working connection and must not wear an alert glyph — hence
                    amber-pulsing rings around a `check`. `warning` is reserved
                    for the transitional states (searching / limited),
                    `priority_high` for outright failure and `help` for a poll
                    that never returned, so all five states hold distinct glyphs
                    and the card never encodes its verdict in hue alone.
                    Crossfaded on `quick` so the glyph and the disc fill never
                    disagree for longer than a label swap. */}
                <SwapLabel swapKey={coreState} className="justify-center">
                  <MaterialSymbol
                    name={
                      coreState === "unknown"
                        ? "help"
                        : coreState === "off"
                          ? "power_settings_new"
                          : coreState === "ok"
                            ? "check"
                            : coreState === "warn"
                              ? "warning"
                              : "priority_high"
                    }
                    size={ORB.OPSZ.CORE}
                    filled={coreState === "warn"}
                    style={{ fontSize: ORB.SYMBOL.CORE }}
                  />
                </SwapLabel>
              </span>
            </div>
            <OrbLabel
              title={
                isAirplaneMode
                  ? t("network.standby_label")
                  : t("network.service_label")
              }
              subtitle={
                unreachable
                  ? t("network.unreachable")
                  : isAirplaneMode
                    ? t("network.radio_off")
                    : serviceLabel
              }
            />
          </motion.div>
        </motion.div>
      )}
    </Card>
  );
};

export default NetworkStatusComponent;
