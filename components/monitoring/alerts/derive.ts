import type { BadgeVariant } from "@/components/ui/badge";
import {
  ALERT_CHANNEL_ORDER,
  ALERT_EVENT_ORDER,
  type AlertCapabilities,
  type AlertChannel,
  type AlertChannels,
  type AlertEventKey,
  type AlertRouting,
  type AlertsState,
} from "@/types/alerts";
import type { RailDotTone } from "./shapes";

// Alerts — the page's ONE derived model, from SAVED truth only.
// The backend resolves every alert with a three-way AND: capable AND channel
// enabled AND routed. No component may re-infer any of that from a payload.

/** The only event that has to survive the outage it is reporting. */
export const OUTAGE_EVENT: AlertEventKey = "connection_lost";

/** What one (event, channel) pair will actually do. */
export type CellState = "fires" | "quiet" | "unrouted" | "incapable";

export interface AlertCell {
  state: CellState;
  capable: boolean;
  /** The capability table's reason key. Only ever set when `capable` is false. */
  reason?: string;
}

/**
 * A channel's own verdict. `configured` is not part of a cell's state: the
 * engine does not gate on it, so an unconfigured channel fires and then fails.
 */
export type ChannelStatus = "ready" | "incomplete" | "unused" | "off";

export interface ChannelCoverage {
  status: ChannelStatus;
  enabled: boolean;
  configured: boolean;
  firing: AlertEventKey[];
  capable: AlertEventKey[];
}

/** One Coverage row: channels that will deliver, and channels that will try and fail. */
export interface CoverageRow {
  event: AlertEventKey;
  fires: AlertChannel[];
  attempt: AlertChannel[];
}

export type CoverageVerdict =
  | { kind: "all"; variant: BadgeVariant }
  | { kind: "outage"; variant: BadgeVariant }
  | { kind: "partial"; variant: BadgeVariant; covered: number; total: number }
  | { kind: "none"; variant: BadgeVariant };

export interface AlertsCoverage {
  cells: Record<AlertEventKey, Record<AlertChannel, AlertCell>>;
  channels: Record<AlertChannel, ChannelCoverage>;
  rows: CoverageRow[];
  verdict: CoverageVerdict;
}

export interface CoverageInput {
  channels: AlertChannels;
  routing: AlertRouting["events"];
  capabilities: AlertCapabilities;
}

/** The rail dot beside a channel's name. A second channel, never the only one. */
export const CHANNEL_STATUS_DOT: Record<ChannelStatus, RailDotTone> = {
  ready: "ready",
  incomplete: "attention",
  unused: "attention",
  off: "off",
};

export function confirmedInput(state: AlertsState): CoverageInput {
  return {
    channels: state.channels,
    routing: state.routing?.events ?? ({} as AlertRouting["events"]),
    capabilities: state.capabilities,
  };
}

export function readCapability(
  capabilities: AlertCapabilities | undefined,
  event: AlertEventKey,
  channel: AlertChannel,
): { capable: boolean; reason?: string } {
  // Fail closed: a pair the device never advertised is not a pair we claim sends.
  const cell = capabilities?.[event];
  if (!cell) return { capable: false, reason: "not_supported" };
  const capable = cell[channel] === true;
  return capable ? { capable } : { capable, reason: cell[`${channel}_reason`] };
}

function resolveState(
  capable: boolean,
  channelEnabled: boolean,
  routed: boolean,
): CellState {
  if (!capable) return "incapable";
  if (!routed) return "unrouted";
  return channelEnabled ? "fires" : "quiet";
}

function verdictOf(rows: CoverageRow[]): CoverageVerdict {
  const covered = rows.filter((row) => row.fires.length > 0).length;
  if (covered === 0) return { kind: "none", variant: "destructive" };
  const outage = rows.find((row) => row.event === OUTAGE_EVENT);
  if (outage && outage.fires.length === 0)
    return { kind: "outage", variant: "warning" };
  if (covered < rows.length)
    return { kind: "partial", variant: "warning", covered, total: rows.length };
  return { kind: "all", variant: "success" };
}

export function deriveCoverage(input: CoverageInput): AlertsCoverage {
  const cells = {} as Record<AlertEventKey, Record<AlertChannel, AlertCell>>;
  const channels = {} as Record<AlertChannel, ChannelCoverage>;

  for (const channel of ALERT_CHANNEL_ORDER) {
    const state = input.channels?.[channel];
    channels[channel] = {
      status: "off",
      enabled: state?.enabled === true,
      configured: state?.configured === true,
      firing: [],
      capable: [],
    };
  }

  const rows: CoverageRow[] = [];
  for (const event of ALERT_EVENT_ORDER) {
    const row = {} as Record<AlertChannel, AlertCell>;
    const view: CoverageRow = { event, fires: [], attempt: [] };
    for (const channel of ALERT_CHANNEL_ORDER) {
      const { capable, reason } = readCapability(input.capabilities, event, channel);
      const c = channels[channel];
      const routed = input.routing?.[event]?.[channel] === true;
      const state = resolveState(capable, c.enabled, routed);
      row[channel] = { state, capable, reason };
      if (capable) c.capable.push(event);
      if (state === "fires") {
        c.firing.push(event);
        (c.configured ? view.fires : view.attempt).push(channel);
      }
    }
    cells[event] = row;
    rows.push(view);
  }

  for (const channel of ALERT_CHANNEL_ORDER) {
    const c = channels[channel];
    if (!c.enabled) c.status = "off";
    else if (!c.configured) c.status = "incomplete";
    else if (c.firing.length === 0) c.status = "unused";
    else c.status = "ready";
  }

  return { cells, channels, rows, verdict: verdictOf(rows) };
}

/** True when the device advertised no capable pair at all — a real empty. */
export function coverageIsEmpty(coverage: AlertsCoverage): boolean {
  return ALERT_CHANNEL_ORDER.every(
    (channel) => coverage.channels[channel].capable.length === 0,
  );
}
