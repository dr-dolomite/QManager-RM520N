import type { NetworkEventType } from "@/types/modem-status";

/** Human-readable labels for each event type */
export const EVENT_LABELS: Record<NetworkEventType, string> = {
  network_mode: "Mode Change",
  band_change: "Band Change",
  pci_change: "Cell Handoff",
  scc_pci_change: "Secondary Band Change",
  ca_change: "Carrier Aggregation",
  nr_anchor: "5G Anchor Change",
  signal_lost: "Signal Lost",
  signal_restored: "Signal Restored",
  internet_lost: "Internet Lost",
  internet_restored: "Internet Restored",
  high_latency: "High Latency",
  latency_recovered: "Latency Recovered",
  high_packet_loss: "High Packet Loss",
  packet_loss_recovered: "Packet Loss Recovered",
  watchcat_recovery: "Watchdog Recovery",
  sim_failover: "SIM Failover",
  sim_swap_detected: "SIM Swap Detected",
  airplane_mode: "Airplane Mode",
  profile_applied: "Profile Applied",
  profile_failed: "Profile Failed",
  profile_deactivated: "Profile Deactivated",
  tower_failover: "Tower Lock Failover",
};

/** Tab categories used by the monitoring Network Events card */
export type EventTabCategory = "bandChanges" | "dataConnection" | "networkMode";

/** Maps each NetworkEventType to its tab category */
export const EVENT_TAB_CATEGORIES: Record<NetworkEventType, EventTabCategory> =
  {
    band_change: "bandChanges",
    pci_change: "bandChanges",
    scc_pci_change: "bandChanges",
    nr_anchor: "bandChanges",
    ca_change: "bandChanges",
    network_mode: "networkMode",
    signal_lost: "networkMode",
    signal_restored: "networkMode",
    internet_lost: "dataConnection",
    internet_restored: "dataConnection",
    high_latency: "dataConnection",
    latency_recovered: "dataConnection",
    high_packet_loss: "dataConnection",
    packet_loss_recovered: "dataConnection",
    watchcat_recovery: "dataConnection",
    sim_failover: "dataConnection",
    sim_swap_detected: "dataConnection",
    airplane_mode: "networkMode",
    profile_applied: "dataConnection",
    profile_failed: "dataConnection",
    profile_deactivated: "dataConnection",
    tower_failover: "dataConnection",
  };
