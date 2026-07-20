"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CardSimIcon, Plane } from "lucide-react";

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

// --- Helper: Determine network icon & label keys from type + CA status ---
// Returns dashboard-namespace keys (network.*); the component resolves them via
// t() so these stay pure, hook-free helpers.
function getNetworkDisplay(
  type: string,
  caActive: boolean,
  nrCaActive: boolean,
) {
  switch (type) {
    case "5G-NSA":
      return {
        icon: <MdOutline5G className="size-full text-white" />,
        labelKey: "network.signal_5g",
        sublabelKey: nrCaActive ? "network.signal_5g_lte_nrca" : "network.signal_5g_lte",
        hasNetwork: true,
      };
    case "5G-SA":
      return {
        icon: <MdOutline5G className="size-full text-white" />,
        labelKey: "network.signal_5g",
        sublabelKey: nrCaActive ? "network.signal_sa_nrca" : "network.signal_sa",
        hasNetwork: true,
      };
    case "LTE":
      return caActive
        ? {
            icon: <Md4gPlusMobiledata className="size-full text-white" />,
            labelKey: "network.signal_lte_plus",
            sublabelKey: "network.ca_4g",
            hasNetwork: true,
          }
        : {
            icon: <Md4gMobiledata className="size-full text-white" />,
            labelKey: "network.signal_lte",
            sublabelKey: "network.connected_4g",
            hasNetwork: true,
          };
    default:
      return {
        icon: <Md3gMobiledata className="size-full text-white/50" />,
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

// --- Helper: Pulsating icon color based on network type ---
// Green: LTE+ (CA), 5G-SA, 5G-NSA, SA with NR-CA
// Yellow: single-band LTE or 3G
// Red: no signal
function getServiceColor(
  type: string,
  caActive: boolean,
  serviceStatus: ServiceStatus,
): string {
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

// ─── Internet badge — tri-state with optional tooltip ──────────────────────

interface InternetBadge {
  cls: string;
  label: string;
  state: PingTriState;
  tooltip: string | null;
}

function buildInternetBadge(
  c: ConnectivityStatus | null,
  t: TFunction,
): InternetBadge {
  // Prefer the new tri-state field; fall back to internet_available for
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
        cls: "bg-success/15 text-success hover:bg-success/20 border-success/30",
        label: t("network.internet_online"),
        state,
        tooltip: null,
      };
    case "disconnected":
      return {
        cls: "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30",
        label: t("network.internet_offline"),
        state,
        tooltip: downTooltip(c?.down_reason ?? null, t),
      };
    default:
      return {
        cls: "bg-muted/50 text-muted-foreground hover:bg-muted/70 border-muted-foreground/30",
        label: t("network.internet_label"),
        state,
        tooltip: null,
      };
  }
}

function downTooltip(reason: string | null, t: TFunction): string {
  switch (reason) {
    case "timeout":
      return t("network.internet_tooltip.down_timeout");
    case "refused":
      return t("network.internet_tooltip.down_refused");
    case "reset":
      return t("network.internet_tooltip.down_reset");
    case "dns":
      return t("network.internet_tooltip.down_dns");
    case "malformed":
      return t("network.internet_tooltip.down_malformed");
    default:
      return t("network.internet_tooltip.down_generic");
  }
}

// Color map for the pulsating service rings
const serviceColorMap: Record<
  string,
  { ring1: string; ring2: string; ring3: string; center: string }
> = {
  green: {
    ring1: "bg-success/15",
    ring2: "bg-success/25",
    ring3: "bg-success/40",
    center: "bg-success",
  },
  yellow: {
    ring1: "bg-warning/15",
    ring2: "bg-warning/25",
    ring3: "bg-warning/40",
    center: "bg-warning",
  },
  red: {
    ring1: "bg-destructive/15",
    ring2: "bg-destructive/25",
    ring3: "bg-destructive/40",
    center: "bg-destructive",
  },
};

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
  const serviceColors = serviceColorMap[serviceColor] ?? serviceColorMap.red;

  // Airplane mode: CFUN=0 (radio off) or CFUN=4 (RF off)
  const isAirplaneMode = data?.cfun === 0 || data?.cfun === 4;

  // Radio is ON when the modem is reachable and not in airplane mode
  const radioOn = modemReachable && !isAirplaneMode;

  // Service is active when we have a good service status
  const isServiceActive =
    serviceStatus === "optimal" || serviceStatus === "connected";

  // Whether we have a real network (LTE/5G), not fallback 3G
  const hasNetwork = networkDisplay.hasNetwork;

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex md:flex-row flex-col xl:items-center justify-center xl:justify-between gap-2">
          <CardTitle className="text-2xl font-semibold @[250px]/card:text-3xl">
            {t("network.title")}
          </CardTitle>

          {/* Status badges */}
          {isLoading ? (
            <div className="flex items-center gap-x-1.5">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          ) : (
            <div className="flex items-center gap-x-1.5">
              {/* Stale indicator */}
              {isStale && (
                <Badge
                  variant="outline"
                  className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
                >
                  <div className="w-2 h-2 rounded-full bg-warning" />
                  {t("network.data_delayed_badge")}
                </Badge>
              )}

              {/* Radio status — based on modem reachability + CFUN */}
              <Badge
                variant="outline"
                className={
                  isAirplaneMode
                    ? "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30"
                    : radioOn
                      ? "bg-success/15 text-success hover:bg-success/20 border-success/30"
                      : "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30"
                }
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    isAirplaneMode
                      ? "bg-warning"
                      : radioOn
                        ? "bg-success"
                        : "bg-destructive"
                  }`}
                />
                {isAirplaneMode
                  ? t("network.airplane_mode")
                  : radioOn
                    ? t("network.radio_on")
                    : t("network.radio_off")}
              </Badge>

              {/* Internet status — tri-state from ping daemon */}
              {(() => {
                const b = buildInternetBadge(connectivity, t);
                const dot =
                  b.state === "connected" ? (
                    <span className="relative flex size-2 shrink-0">
                      <span className="absolute inline-flex size-full rounded-full bg-success opacity-75 animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-success" />
                    </span>
                  ) : b.state === "disconnected" ? (
                    <span className="inline-flex size-2 rounded-full shrink-0 bg-destructive" />
                  ) : (
                    <span className="inline-flex size-2 rounded-full shrink-0 bg-muted-foreground" />
                  );
                const badge = (
                  <Badge variant="outline" className={b.cls}>
                    {dot}
                    {b.label}
                  </Badge>
                );
                if (b.tooltip) {
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>{badge}</TooltipTrigger>
                      <TooltipContent>{b.tooltip}</TooltipContent>
                    </Tooltip>
                  );
                }
                return badge;
              })()}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid xl:grid-cols-3 grid-cols-1 grid-flow-row gap-4 place-items-center place-content-center">
          {/* === Network Type Circle === */}
          {isLoading ? (
            <div className="grid gap-2 place-items-center">
              <Skeleton className="rounded-full size-36" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-28" />
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="relative">
                <div
                  className={`rounded-full size-36 flex items-center justify-center p-2 ${
                    isAirplaneMode
                      ? "bg-success/15"
                      : hasNetwork
                        ? "bg-primary"
                        : "bg-muted"
                  }`}
                >
                  {isAirplaneMode ? (
                    <MdEnergySavingsLeaf className="size-full text-success" />
                  ) : (
                    networkDisplay.icon
                  )}
                </div>
                {/* Status badge overlay — check when 4G/5G, X when 3G fallback, hidden in airplane mode */}
                {!isAirplaneMode && (
                  <div
                    className={`absolute top-1 right-4 size-6 rounded-full flex items-center justify-center shadow-md ${
                      hasNetwork ? "bg-success" : "bg-destructive"
                    }`}
                  >
                    {hasNetwork ? (
                      <FaCheck className="size-4 text-success-foreground" />
                    ) : (
                      <FaXmark className="size-4 text-destructive-foreground" />
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-0.5 text-center">
                <h3 className="text-base font-semibold leading-none">
                  {isAirplaneMode ? t("network.low_power") : networkLabel}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {isAirplaneMode ? t("network.radio_off") : networkSublabel}
                </p>
              </div>
            </div>
          )}

          {/* === SIM / Carrier Circle === */}
          {isLoading ? (
            <div className="grid gap-2 place-items-center">
              <Skeleton className="rounded-full size-36" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="relative">
                <div
                  className={`rounded-full size-36 flex items-center justify-center p-4 ${
                    isAirplaneMode ? "bg-muted" : "bg-primary/15"
                  }`}
                >
                  {isAirplaneMode ? (
                    <Plane className="size-full text-muted-foreground" />
                  ) : (
                    <CardSimIcon className="size-full text-primary" />
                  )}
                </div>
                {!isAirplaneMode && (
                  <div
                    className={`absolute top-1 right-4 size-6 rounded-full flex items-center justify-center shadow-md ${
                      isServiceActive ? "bg-success" : "bg-destructive"
                    }`}
                  >
                    {isServiceActive ? (
                      <FaCheck className="size-4 text-success-foreground" />
                    ) : (
                      <FaXmark className="size-4 text-destructive-foreground" />
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-0.5 text-center">
                <h3 className="text-base font-semibold leading-none">
                  {t("network.sim_label", { slot: simSlot })}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {isAirplaneMode
                    ? t("network.airplane_mode")
                    : carrier || t("network.no_carrier")}
                </p>
              </div>
            </div>
          )}

          {/* === Service Status Pulsating Circle === */}
          {isLoading ? (
            <div className="grid gap-2 place-items-center">
              <Skeleton className="rounded-full size-36" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="relative flex items-center justify-center size-36">
                {isServiceActive ? (
                  <>
                    <div
                      className={`absolute rounded-full size-36 ${serviceColors.ring1} animate-pulse-ring`}
                    />
                    <div
                      className={`absolute rounded-full size-28 ${serviceColors.ring2} animate-pulse-ring`}
                      style={{ animationDelay: "0.3s" }}
                    />
                    <div
                      className={`absolute rounded-full size-20 ${serviceColors.ring3} animate-pulse-ring`}
                      style={{ animationDelay: "0.6s" }}
                    />
                  </>
                ) : (
                  <>
                    <div
                      className={`absolute rounded-full size-36 ${serviceColors.ring1}`}
                    />
                    <div
                      className={`absolute rounded-full size-28 ${serviceColors.ring2}`}
                    />
                    <div
                      className={`absolute rounded-full size-20 ${serviceColors.ring3}`}
                    />
                  </>
                )}
                <div
                  className={`relative rounded-full size-12 ${serviceColors.center}`}
                />
              </div>
              <div className="grid gap-0.5 text-center">
                <h3 className="text-base font-semibold leading-none">
                  {isAirplaneMode ? t("network.standby_label") : t("network.service_label")}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {isAirplaneMode ? t("network.radio_off") : serviceLabel}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex-col items-start gap-1.5 text-sm" />
    </Card>
  );
};

export default NetworkStatusComponent;
