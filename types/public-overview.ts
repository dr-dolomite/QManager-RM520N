// =============================================================================
// public-overview.ts — Type contract for the unauthenticated overview CGI.
// =============================================================================
// Mirrors the jq projection in
//   scripts/www/cgi-bin/quecmanager/public/overview.sh
// 1:1. Adding a field here without adding it to the CGI does nothing; adding
// it to the CGI without adding it here is a type error in consumers.
// =============================================================================

import type {
  ConnectionState,
  NetworkType,
  ServiceStatus,
} from "@/types/modem-status";

export interface PublicOverviewBand {
  band: string;
  bandwidth_mhz: number;
  pci: number | null;
  /** RSRP for this carrier component (dBm). Null when unreported. */
  rsrp: number | null;
  /** RSRQ for this carrier component (dB). Null when unreported. */
  rsrq: number | null;
  /** SINR for this carrier component (dB). Null when unreported. */
  sinr: number | null;
}

export interface PublicOverviewNetwork {
  type: NetworkType;
  service_status: ServiceStatus;
  carrier: string;
  bands: PublicOverviewBand[];
  lte_state: ConnectionState;
  nr_state: ConnectionState;
}

export interface PublicOverviewSignal {
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
}

export interface PublicOverviewOk {
  state: "ok";
  timestamp: number;
  modem_reachable: boolean;
  uptime_seconds: number;
  network: PublicOverviewNetwork;
  signal: PublicOverviewSignal;
  temperature: number | null;
}

export interface PublicOverviewSetupRequired {
  state: "setup_required";
}

export interface PublicOverviewUnavailable {
  state: "unavailable";
  reason?: string;
}

export type PublicOverview =
  | PublicOverviewOk
  | PublicOverviewSetupRequired
  | PublicOverviewUnavailable;

export type PublicOverviewState = PublicOverview["state"];
