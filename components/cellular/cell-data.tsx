"use client";

import React from "react";
import { motion } from "motion/react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Button } from "@/components/ui/button";

import type {
  NetworkStatus,
  LteStatus,
  NrStatus,
  DeviceStatus,
} from "@/types/modem-status";
import { formatNumericField } from "@/types/modem-status";

// =============================================================================
// Props
// =============================================================================

interface CellDataComponentProps {
  network: NetworkStatus | null;
  lte: LteStatus | null;
  nr: NrStatus | null;
  device: DeviceStatus | null;
  isLoading: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Map network type enum to human-readable display */
function formatNetworkType(type: string): string {
  switch (type) {
    case "5G-NSA":
      return "5G NR + LTE";
    case "5G-SA":
      return "5G NR SA";
    case "LTE":
      return "LTE";
    default:
      return type || "-";
  }
}

/** Build CA summary string from network status */
function formatCarrierAggregation(network: NetworkStatus): string {
  const isNSA = network.type === "5G-NSA";
  const parts: string[] = [];

  if (network.ca_active && network.ca_count > 0) {
    parts.push(`LTE (${network.ca_count + 1} carriers)`);
  } else if (isNSA) {
    // NSA always has an LTE anchor — show "LTE" even without CA
    parts.push("LTE");
  }

  if (network.nr_ca_active && network.nr_ca_count > 0) {
    // Genuine NR CA — show carrier count (+1 for primary NR carrier)
    parts.push(`NR (${network.nr_ca_count + 1} carriers)`);
  } else if (isNSA) {
    // NSA dual connectivity: NR leg is active but not doing CA
    parts.push("NR");
  }

  if (parts.length === 0) return "Inactive";
  return parts.join(" + ");
}

/** Convert decimal to hex string for TAC tooltip, e.g. 49026 → "BF82" */
function decToHex(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return value.toString(16).toUpperCase();
}

/**
 * Normalize an IPv6 address to RFC 5952 compressed form.
 * Handles both standard colon notation and Quectel's dotted-decimal
 * octet format (16 dot-separated bytes from AT+CGCONTRDP).
 *
 * Examples:
 *   "253.0.151.106.0.0.0.0.0.0.0.0.0.0.0.9" → "fd00:9b6a::9"
 *   "2607:fb90:0000:0000:0000:0000:0000:c505" → "2607:fb90::c505"
 *   "10.151.151.44" (IPv4, 4 octets) → returned as-is
 */
function compressIPv6(ip: string): string {
  if (!ip) return "-";

  let groups: string[];

  // Detect Quectel dotted-decimal IPv6: exactly 16 dot-separated decimal octets
  const dotParts = ip.split(".");
  if (dotParts.length === 16 && dotParts.every((p) => /^\d{1,3}$/.test(p))) {
    // Pair octets into 8 hex groups
    groups = [];
    for (let i = 0; i < 16; i += 2) {
      const hi = parseInt(dotParts[i], 10);
      const lo = parseInt(dotParts[i + 1], 10);
      groups.push(((hi << 8) | lo).toString(16));
    }
  } else if (ip.includes(":")) {
    // Standard colon notation — expand :: to full 8 groups first
    const halves = ip.split("::");
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(":") : [];
      const right = halves[1] ? halves[1].split(":") : [];
      const fill = 8 - left.length - right.length;
      groups = [...left, ...Array(fill).fill("0"), ...right];
    } else {
      groups = ip.split(":");
    }
    // Strip leading zeros from each group
    groups = groups.map((g) => (parseInt(g, 16) || 0).toString(16));
  } else {
    // IPv4 or unknown — return as-is
    return ip;
  }

  // Find longest run of consecutive "0" groups (RFC 5952: use :: for first longest)
  let bestStart = -1,
    bestLen = 0,
    curStart = -1,
    curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  if (curLen > bestLen) {
    bestStart = curStart;
    bestLen = curLen;
  }

  // Collapse the longest zero run into ::
  if (bestLen >= 2) {
    const left = groups.slice(0, bestStart).join(":");
    const right = groups.slice(bestStart + bestLen).join(":");
    if (!left && !right) return "::";
    if (!left) return "::" + right;
    if (!right) return left + "::";
    return left + "::" + right;
  }

  return groups.join(":");
}

// =============================================================================
// IP Address Row
// =============================================================================

/**
 * Row for IPv6 / DNS values that may overflow on narrow viewports.
 * - Compresses IPv6 to RFC 5952 form
 * - Allows the value to wrap mid-string (`break-all`) since IPv6 has no
 *   natural break points
 * - `min-w-0` lets the value column shrink below its intrinsic width inside
 *   the parent flex container
 * - Tooltip surfaces the original (uncompressed) form when compression
 *   actually shortens it
 */
function IpAddressRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const compressed = value ? compressIPv6(value) : "-";
  const showTooltip = !!value && compressed !== value;

  return (
    <motion.div
      className="flex items-start justify-between gap-3"
      variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <p className="text-sm font-semibold text-muted-foreground shrink-0">
        {label}
      </p>
      <div className="flex items-start gap-1.5 min-w-0">
        {showTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0"
                aria-label="Show full address"
              >
                <TbInfoCircleFilled className="size-5 text-info" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-mono break-all max-w-[14rem]">{value}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <p className="text-sm font-semibold font-mono break-all text-right min-w-0">
          {compressed}
        </p>
      </div>
    </motion.div>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function CellDataSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Cellular Information</CardTitle>
        <CardDescription>
          Detailed information about the connected cellular network.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <React.Fragment key={i}>
              <Separator />
              <div className="flex items-center justify-between py-0.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-36" />
              </div>
            </React.Fragment>
          ))}
          <Separator />
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Component
// =============================================================================

const CellDataComponent = ({
  network,
  lte,
  nr,
  device,
  isLoading,
}: CellDataComponentProps) => {
  if (isLoading) return <CellDataSkeleton />;

  // Determine which RAT provides Cell ID and TAC
  // SA mode: use NR values. NSA/LTE: use LTE values.
  const isSA = network?.type === "5G-SA";
  const cellId = isSA ? nr?.cell_id : lte?.cell_id;
  const tac = isSA ? nr?.tac : lte?.tac;
  const enodebId = isSA ? nr?.enodeb_id : lte?.enodeb_id;
  const sectorId = isSA ? nr?.sector_id : lte?.sector_id;
  const cellIdLabel = isSA ? "gNodeB" : "eNodeB";

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Cellular Information</CardTitle>
        <CardDescription>
          Detailed information about the connected cellular network.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <motion.div
          className="grid gap-2"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
        >
          {/* ISP */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">ISP</p>
            <p className="text-sm font-semibold">{network?.carrier || "-"}</p>
          </motion.div>

          {/* APN */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              Access Point Name (APN)
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold">{network?.apn || "-"}</p>
              <Button
                variant="link"
                size="sm"
                className="p-0.5 cursor-pointer"
                asChild
              >
                <Link href="/cellular/settings/apn-management">Edit</Link>
              </Button>
            </div>
          </motion.div>

          {/* Network Type */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              Network Type
            </p>
            <p className="text-sm font-semibold">
              {network ? formatNetworkType(network.type) : "-"}
            </p>
          </motion.div>

          {/* Cell ID */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              Cell ID
            </p>
            <div className="flex items-center gap-1.5">
              {cellId != null && enodebId != null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="inline-flex" aria-label="More info">
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="grid">
                      <p>
                        {cellIdLabel} ID:{" "}
                        <span className="font-semibold">
                          {formatNumericField(enodebId)}
                        </span>
                      </p>

                      <p>
                        Sector:{" "}
                        <span className="font-semibold">
                          {formatNumericField(sectorId)}
                        </span>
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold">
                {formatNumericField(cellId)}
              </p>
            </div>
          </motion.div>

          {/* TAC */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              Tracking Area Code
            </p>
            <div className="flex items-center gap-1.5">
              {tac != null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="inline-flex" aria-label="More info">
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Hex:{" "}
                      <span className="font-semibold">0x{decToHex(tac)}</span>
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold">{formatNumericField(tac)}</p>
            </div>
          </motion.div>

          {/* Total Bandwidth */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              Total Bandwidth in Use
            </p>
            <div className="flex items-center gap-1.5">
              {network?.bandwidth_details ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="inline-flex" aria-label="More info">
                      <TbInfoCircleFilled className="size-5 text-info" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{network.bandwidth_details}</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <p className="text-sm font-semibold">
                {network?.total_bandwidth_mhz
                  ? `${network.total_bandwidth_mhz} MHz`
                  : "-"}
              </p>
            </div>
          </motion.div>

          {/* Carrier Aggregation */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              Carrier Aggregation
            </p>
            <p className="text-sm font-semibold">
              {network ? formatCarrierAggregation(network) : "-"}
            </p>
          </motion.div>

          {/* Active MIMO */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              Active MIMO
            </p>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold">{device?.mimo || "-"}</p>
              <Button
                variant="link"
                size="sm"
                className="p-0.5 cursor-pointer"
                asChild
              >
                <Link href="/cellular/antenna-statistics">Per-Antenna</Link>
              </Button>
            </div>
          </motion.div>

          {/* WAN IPv4 */}
          <Separator />
          <motion.div
            className="flex items-center justify-between"
            variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0 } }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <p className="text-sm font-semibold text-muted-foreground">
              WAN IPv4
            </p>
            <p className="text-sm font-semibold font-mono">
              {network?.wan_ipv4 || "-"}
            </p>
          </motion.div>

          {/* WAN IPv6 */}
          <Separator />
          <IpAddressRow label="WAN IPv6" value={network?.wan_ipv6} />

          {/* Primary DNS */}
          <Separator />
          <IpAddressRow label="Primary DNS" value={network?.primary_dns} />

          {/* Secondary DNS */}
          <Separator />
          <IpAddressRow label="Secondary DNS" value={network?.secondary_dns} />
          <Separator />
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default CellDataComponent;
