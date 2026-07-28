"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CardSimIcon,
  ClockIcon,
  HelpCircleIcon,
  MinusCircleIcon,
  Plane,
  PowerOffIcon,
  RadarIcon,
  RadioTowerIcon,
  TriangleAlertIcon,
} from "lucide-react";

import {
  MdOutline5G,
  Md4gMobiledata,
  Md4gPlusMobiledata,
  Md3gMobiledata,
  MdEnergySavingsLeaf,
} from "react-icons/md";
import { FaCheck, FaXmark } from "react-icons/fa6";

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
const GLYPH = "size-[74px]";

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
// discs over one another produce a muddy, unpredictable composite.
//
// NOTE: --tone-destructive-{1,2,3} does not exist in globals.css (only the
// success and warning ramps shipped). The red stack therefore ramps through the
// neutral surface containers into destructive-container, with the failure state
// carried by the solid core. That is also the honest reading: a dead radio is
// not radiating, so the rings should recede rather than shout.
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
    ring1: "bg-surface-container",
    ring2: "bg-surface-container-high",
    ring3: "bg-destructive-container",
    center: "bg-destructive text-destructive-foreground",
  },
};

// ─── Chips ────────────────────────────────────────────────────────────────
// Filled tonal pills. The outline-badge pattern is retired ON THIS CARD ONLY:
// the hero surface needs its two live signals to read at a glance, and an
// outline chip on a borderless 40px card reads as debris.

const CHIP_BASE =
  "inline-flex items-center gap-[7px] rounded-full text-xs font-semibold py-[7px] pr-[13px] pl-[11px]";

function Chip({
  tone,
  children,
}: {
  tone: "success" | "warning" | "muted";
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "success"
      ? "bg-success-container text-on-success-container"
      : tone === "warning"
        ? "bg-warning-container text-on-warning-container"
        : "bg-surface-container-high text-on-surface-variant";
  return <span className={`${CHIP_BASE} ${toneCls}`}>{children}</span>;
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
      icon: <Plane className="size-[15px] shrink-0" />,
      label: t("network.airplane_mode"),
    };
  }
  // Unreachable is NOT "off". When the poller has lost the modem we cannot
  // observe CFUN at all, so claiming the radio is off would assert a device
  // state we did not read. Say we don't know instead.
  if (!modemReachable) {
    return {
      tone: "muted",
      icon: <HelpCircleIcon className="size-[15px] shrink-0" />,
      label: t("network.radio_unknown"),
    };
  }
  if (!radioOn) {
    return {
      tone: "muted",
      icon: <PowerOffIcon className="size-[15px] shrink-0" />,
      label: t("network.radio_off"),
    };
  }
  if (isSearching) {
    return {
      tone: "warning",
      icon: <RadarIcon className="size-[15px] shrink-0" />,
      label: t("network.service_searching"),
    };
  }
  return {
    tone: "success",
    icon: <RadioTowerIcon className="size-[15px] shrink-0" />,
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
        icon: <TriangleAlertIcon className="size-[15px] shrink-0" />,
        label: t("network.internet_unreachable"),
        tooltip: t("network.internet_tooltip.no_reply"),
      };
    default:
      return {
        tone: "muted",
        dotCls: "bg-on-surface-variant",
        live: false,
        icon: <MinusCircleIcon className="size-[15px] shrink-0" />,
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
      className={`absolute top-[4px] right-[14px] grid size-7 place-items-center rounded-full ${cls} ${BADGE_SHADOW}`}
    >
      {state === "ok" ? (
        <FaCheck className="size-[17px]" />
      ) : state === "warn" ? (
        <TriangleAlertIcon className="size-[17px]" />
      ) : (
        <FaXmark className="size-[17px]" />
      )}
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
function OrbLabel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-[3px] text-center">
      <span className="text-base leading-none font-semibold">{title}</span>
      <span className="text-sm text-on-surface-variant">{subtitle}</span>
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
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* Stale — stays a CARD-scoped chip. "Your last poll was late" is
                not an assertive alert; promoting it to a banner would cry wolf. */}
            {isStale && (
              <Chip tone="warning">
                <ClockIcon className="size-[15px] shrink-0" />
                {t("network.data_delayed_badge")}
              </Chip>
            )}

            {/* Radio */}
            <Chip tone={radio.tone}>
              {radio.icon}
              {radio.label}
            </Chip>

            {/* Internet */}
            {internet.tooltip ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    // The chip is 30px tall; `before:` lifts the hit area to
                    // the 44px touch floor without shifting any layout.
                    className="relative rounded-full before:absolute before:-inset-[7px] before:content-[''] focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <Chip tone={internet.tone}>
                      <InternetDot chip={internet} />
                      {internet.label}
                    </Chip>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{internet.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              <Chip tone={internet.tone}>
                <InternetDot chip={internet} />
                {internet.label}
              </Chip>
            )}
          </div>
        )}
      </div>

      {/* ── Three orbs ── */}
      <div className="grid grid-cols-1 gap-4 place-items-center @lg/card:grid-cols-3">
        {/* === Orb 1 — Radio / RAT === */}
        {isLoading ? (
          <OrbSkeleton />
        ) : (
          <div className="flex flex-col items-center gap-2.5">
            <div className="relative">
              <div
                className={`${ORB} grid place-items-center rounded-full ${
                  isAirplaneMode
                    ? "bg-success-container text-on-success-container"
                    : hasNetwork
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {isAirplaneMode ? (
                  <MdEnergySavingsLeaf className={GLYPH} />
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
          </div>
        )}

        {/* === Orb 2 — SIM / Carrier === */}
        {isLoading ? (
          <OrbSkeleton />
        ) : (
          <div className="flex flex-col items-center gap-2.5">
            <div className="relative">
              <div
                className={`${ORB} grid place-items-center rounded-full ${
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
          </div>
        )}

        {/* === Orb 3 — Service ring stack ===
            The isServiceActive gate is load-bearing: rings only breathe when
            service is genuinely live. A pulsing ring over "No Service" would
            animate a lie, so the inactive branch renders the same geometry
            static. */}
        {isLoading ? (
          <OrbSkeleton />
        ) : (
          <div className="flex flex-col items-center gap-2.5">
            <div className={`relative ${ORB} grid place-items-center`}>
              {isServiceActive ? (
                <>
                  <span
                    className={`absolute size-[152px] rounded-full ${serviceColors.ring1} animate-pulse-ring`}
                  />
                  <span
                    className={`absolute size-[112px] rounded-full ${serviceColors.ring2} animate-pulse-ring`}
                    style={{ animationDelay: "0.3s" }}
                  />
                  <span
                    className={`absolute size-[80px] rounded-full ${serviceColors.ring3} animate-pulse-ring`}
                    style={{ animationDelay: "0.6s" }}
                  />
                </>
              ) : (
                <>
                  <span
                    className={`absolute size-[152px] rounded-full ${serviceColors.ring1}`}
                  />
                  <span
                    className={`absolute size-[112px] rounded-full ${serviceColors.ring2}`}
                  />
                  <span
                    className={`absolute size-[80px] rounded-full ${serviceColors.ring3}`}
                  />
                </>
              )}
              <span
                aria-hidden="true"
                className={`relative grid size-[48px] place-items-center rounded-full ${serviceColors.center}`}
              >
                {/* The core glyph tracks service LIVENESS, not the ring tone:
                    a yellow stack just means single-band LTE, which is still a
                    working connection and must not wear an alert glyph. */}
                {isAirplaneMode ? (
                  <PowerOffIcon className="size-[22px]" />
                ) : isServiceActive ? (
                  <FaCheck className="size-[22px]" />
                ) : serviceStatus === "searching" ||
                  serviceStatus === "limited" ? (
                  <TriangleAlertIcon className="size-[22px]" />
                ) : (
                  <FaXmark className="size-[22px]" />
                )}
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
          </div>
        )}
      </div>
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
