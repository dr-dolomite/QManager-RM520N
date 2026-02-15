"use client";

import React from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CardSimIcon } from "lucide-react";

import { TbCloudFilled } from "react-icons/tb";
import {
  MdOutline5G,
  Md4gMobiledata,
  Md4gPlusMobiledata,
  Md3gMobiledata,
} from "react-icons/md";
import { FaCheck, FaXmark } from "react-icons/fa6";

import type {
  NetworkStatus,
  ConnectivityStatus,
  ServiceStatus,
} from "@/types/modem-status";

interface NetworkStatusComponentProps {
  data: NetworkStatus | null;
  connectivity: ConnectivityStatus | null;
  modemReachable: boolean;
  isLoading: boolean;
  isStale: boolean;
}

// --- Helper: Determine network icon & label from type + CA status ---
function getNetworkDisplay(
  type: string,
  caActive: boolean,
  nrCaActive: boolean
) {
  switch (type) {
    case "5G-NSA":
      return {
        icon: <MdOutline5G className="size-full text-white" />,
        label: "5G Signal",
        sublabel: nrCaActive ? "5G + LTE / NR-CA" : "5G + LTE",
        hasNetwork: true,
      };
    case "5G-SA":
      return {
        icon: <MdOutline5G className="size-full text-white" />,
        label: "5G Signal",
        sublabel: nrCaActive ? "Standalone / NR-CA" : "Standalone",
        hasNetwork: true,
      };
    case "LTE":
      return caActive
        ? {
            icon: <Md4gPlusMobiledata className="size-full text-white" />,
            label: "LTE+ Signal",
            sublabel: "4G Carrier Aggregation",
            hasNetwork: true,
          }
        : {
            icon: <Md4gMobiledata className="size-full text-white" />,
            label: "LTE Signal",
            sublabel: "4G Connected",
            hasNetwork: true,
          };
    default:
      return {
        icon: <Md3gMobiledata className="size-full text-white/50" />,
        label: "Signal",
        sublabel: "No 4G/5G",
        hasNetwork: false,
      };
  }
}

// --- Helper: Service status label ---
function getServiceLabel(status: ServiceStatus) {
  switch (status) {
    case "optimal":
      return "Optimal";
    case "connected":
      return "Connected";
    case "limited":
      return "Limited";
    case "no_service":
      return "No Service";
    case "searching":
      return "Searching";
    case "sim_error":
      return "SIM Error";
    default:
      return "Unknown";
  }
}

// --- Helper: Pulsating icon color based on network type ---
// Green: LTE+ (CA), 5G-SA, 5G-NSA, SA with NR-CA
// Yellow: single-band LTE or 3G
// Red: no signal
function getServiceColor(
  type: string,
  caActive: boolean,
  serviceStatus: ServiceStatus
): string {
  // No service / no signal → red
  if (
    serviceStatus === "no_service" ||
    serviceStatus === "sim_error" ||
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

// Color map for the pulsating service rings
const serviceColorMap: Record<
  string,
  { ring1: string; ring2: string; ring3: string; center: string }
> = {
  green: {
    ring1: "bg-green-200",
    ring2: "bg-green-300",
    ring3: "bg-green-400",
    center: "bg-green-600",
  },
  yellow: {
    ring1: "bg-yellow-200",
    ring2: "bg-yellow-300",
    ring3: "bg-yellow-400",
    center: "bg-yellow-600",
  },
  red: {
    ring1: "bg-red-200",
    ring2: "bg-red-300",
    ring3: "bg-red-400",
    center: "bg-red-600",
  },
};

const NetworkStatusComponent = ({
  data,
  connectivity,
  modemReachable,
  isLoading,
  isStale,
}: NetworkStatusComponentProps) => {
  // Derive display values
  const networkType = data?.type ?? "";
  const serviceStatus = data?.service_status ?? "unknown";
  const carrier = data?.carrier ?? "";
  const simSlot = data?.sim_slot ?? 1;
  const caActive = data?.ca_active ?? false;
  const nrCaActive = data?.nr_ca_active ?? false;

  const networkDisplay = getNetworkDisplay(networkType, caActive, nrCaActive);
  const serviceLabel = getServiceLabel(serviceStatus);
  const serviceColor = getServiceColor(networkType, caActive, serviceStatus);
  const serviceColors =
    serviceColorMap[serviceColor] ?? serviceColorMap.red;

  // Radio is ON when the modem is reachable (AT+CFUN=1 implied by modem responding)
  const radioOn = modemReachable;

  // Service is active when we have a good service status
  const isServiceActive =
    serviceStatus === "optimal" || serviceStatus === "connected";

  // Whether we have a real network (LTE/5G), not fallback 3G
  const hasNetwork = networkDisplay.hasNetwork;

  // Internet status — driven by ping daemon via connectivity data
  // true = reachable, false = unreachable, null = ping daemon not running / unknown
  const internetAvailable = connectivity?.internet_available ?? null;

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex md:flex-row flex-col xl:items-center justify-center xl:justify-between gap-2">
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            Network Status
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
                  className="bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 border border-yellow-300/50 backdrop-blur-sm"
                >
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  Stale Data
                </Badge>
              )}

              {/* Radio status — based on modem reachability */}
              <Badge
                variant="outline"
                className={
                  radioOn
                    ? "bg-green-500/20 text-green-500 hover:bg-green-500/30 border border-green-300/50 backdrop-blur-sm"
                    : "bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-300/50 backdrop-blur-sm"
                }
              >
                <div
                  className={`w-2 h-2 rounded-full ${radioOn ? "bg-green-500" : "bg-red-500"}`}
                />
                {radioOn ? "Radio On" : "Radio Off"}
              </Badge>

              {/* Internet status — green/red/gray based on ping daemon */}
              <Badge
                variant="outline"
                className={
                  internetAvailable === true
                    ? "bg-green-500/20 text-green-500 hover:bg-green-500/30 border border-green-300/50 backdrop-blur-sm"
                    : internetAvailable === false
                      ? "bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-300/50 backdrop-blur-sm"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted/70 border border-muted-foreground/30 backdrop-blur-sm"
                }
              >
                <TbCloudFilled
                  className={
                    internetAvailable === true
                      ? "text-green-500"
                      : internetAvailable === false
                        ? "text-red-500"
                        : "text-muted-foreground"
                  }
                />
                Internet
              </Badge>
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
                    hasNetwork ? "bg-primary" : "bg-muted"
                  }`}
                >
                  {networkDisplay.icon}
                </div>
                {/* Status badge overlay — check when 4G/5G, X when 3G fallback */}
                <div
                  className={`absolute top-1 right-4 w-6 h-6 rounded-full flex items-center justify-center shadow-md ${
                    hasNetwork ? "bg-green-500" : "bg-red-500"
                  }`}
                >
                  {hasNetwork ? (
                    <FaCheck className="w-4 h-4 text-white" />
                  ) : (
                    <FaXmark className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>
              <div className="grid gap-0.5 text-center">
                <h3 className="text-md font-semibold leading-none">
                  {networkDisplay.label}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {networkDisplay.sublabel}
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
                <div className="rounded-full size-36 bg-primary/15 flex items-center justify-center p-4">
                  <CardSimIcon className="size-full text-primary" />
                </div>
                <div
                  className={`absolute top-1 right-4 w-6 h-6 rounded-full flex items-center justify-center shadow-md ${
                    isServiceActive ? "bg-green-500" : "bg-red-500"
                  }`}
                >
                  {isServiceActive ? (
                    <FaCheck className="w-4 h-4 text-white" />
                  ) : (
                    <FaXmark className="w-4 h-4 text-white" />
                  )}
                </div>
              </div>
              <div className="grid gap-0.5 text-center">
                <h3 className="text-md font-semibold leading-none">
                  SIM {simSlot}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {carrier || "No Carrier"}
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
                <h3 className="text-md font-semibold leading-none">Service</h3>
                <p className="text-muted-foreground text-sm">
                  {serviceLabel}
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
