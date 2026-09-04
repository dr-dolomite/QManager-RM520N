import type { BadgeVariant } from "@/components/ui/badge";
import {
  ALERT_CHANNEL_ORDER,
  ALERT_EVENT_ORDER,
  type AlertCapabilities,
  type AlertChannel,
  type AlertChannels,
  type AlertEventKey,
  type AlertRouting,
} from "@/types/alerts";
import type { DiscTone, RailDotTone, TileValueTone } from "./shapes";

// Alerts — the page's ONE derived model.
// The backend resolves every alert with a three-way AND: capable AND channel
// enabled AND routed. No component may re-infer any of that from a payload.

/** The only event that has to survive the outage it is reporting. */
export const OUTAGE_EVENT: AlertEventKey = "connection_lost";

// -----------------------------------------------------------------------------
// The resolved model
// -----------------------------------------------------------------------------

/**
 * What one (event, channel) pair will actually do.
 *
 * `quiet` and `unrouted` are both "nothing happens", separated because only one
 * of them is the user's own decision: `quiet` means they ticked the cell and the
 * channel's master switch is holding it back.
 */
export type CellState = "fires" | "quiet" | "unrouted" | "incapable";

export interface AlertCell {
  event: AlertEventKey;
  channel: AlertChannel;
  state: CellState;
  /** The backend's three inputs, kept so a cell can explain itself in place. */
  capable: boolean;
  channelEnabled: boolean;
  routed: boolean;
  /** The capability table's reason key. Only ever set when `capable` is false. */
  reason?: string;
  /** The tick has not reached the device yet. */
  pending: boolean;
  /**
   * Presentational only. The engine WILL attempt this send and fail, because
   * the channel has no credentials yet — `state` still mirrors the engine.
   */
  attemptOnly: boolean;
  /** An incapable pair is not a control; nothing the user does can arm it. */
  interactive: boolean;
}

/**
 * A channel's own verdict. `configured` is deliberately NOT part of a cell's
 * state: the engine does not gate on it, so an unconfigured channel resolves as
 * firing and then fails at send time. It belongs to the channel, and it is why
 * `incomplete` exists.
 */
export type ChannelStatus = "ready" | "incomplete" | "unused" | "off";

export interface ChannelCoverage {
  channel: AlertChannel;
  status: ChannelStatus;
  enabled: boolean;
  configured: boolean;
  /** Events this channel will actually send. */
  firing: AlertEventKey[];
  /** Events the platform lets this channel send at all. */
  capable: AlertEventKey[];
  /** Ticked but held back by the master switch. */
  quiet: AlertEventKey[];
}

/** The band's headline verdict. Never `neutral`: coverage always has an answer. */
export type CoverageTone = Exclude<DiscTone, "neutral">;

export interface AlertsCoverage {
  cells: Record<AlertEventKey, Record<AlertChannel, AlertCell>>;
  channels: Record<AlertChannel, ChannelCoverage>;
  /** Events with at least one firing cell. */
  covered: AlertEventKey[];
  uncovered: AlertEventKey[];
  eventCount: number;
  coveredCount: number;
  /** Channels that will report an outage. SMS is the only capable one today. */
  outageChannels: AlertChannel[];
  /** An outage would pass silently. */
  outageGap: boolean;
  /** Not one cell on the whole matrix fires. */
  silent: boolean;
  /** Cells whose resolved state has not reached the device yet. */
  pendingCount: number;
  tone: CoverageTone;
}

/** What `deriveCoverage` reads. A draft and a server payload have the same shape. */
export interface CoverageInput {
  channels: AlertChannels;
  routing: AlertRouting["events"];
  capabilities: AlertCapabilities;
}

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------

/**
 * Channel status onto a chip role, never a class string. `off` and `unused` share
 * `muted` on purpose, so their glyphs must differ: the fill is not the separator.
 */
export const CHANNEL_STATUS_BADGE: Record<ChannelStatus, BadgeVariant> = {
  ready: "success",
  incomplete: "warning",
  unused: "muted",
  off: "muted",
};

/** The rail dot beside a channel's name. A second channel, never the only one. */
export const CHANNEL_STATUS_DOT: Record<ChannelStatus, RailDotTone> = {
  ready: "ready",
  incomplete: "attention",
  unused: "attention",
  off: "off",
};

/** The band figure's ink. A good verdict keeps the neutral foreground. */
export const COVERAGE_VALUE_TONE: Record<CoverageTone, TileValueTone> = {
  good: "neutral",
  alert: "alert",
  bad: "bad",
};

// -----------------------------------------------------------------------------
// Derivation
// -----------------------------------------------------------------------------

function readCapability(
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

/**
 * Resolve the whole 3x3 matrix plus its roll-ups.
 *
 * Pass the user's working draft as `input` and the device's last confirmed state
 * as `confirmed`; a cell whose resolved state differs between the two is marked
 * pending. With no `confirmed`, nothing is pending.
 */
export function deriveCoverage(
  input: CoverageInput,
  confirmed?: CoverageInput,
): AlertsCoverage {
  const cells = {} as Record<AlertEventKey, Record<AlertChannel, AlertCell>>;
  const channels = {} as Record<AlertChannel, ChannelCoverage>;

  for (const channel of ALERT_CHANNEL_ORDER) {
    const state = input.channels?.[channel];
    channels[channel] = {
      channel,
      status: "off",
      enabled: state?.enabled === true,
      configured: state?.configured === true,
      firing: [],
      capable: [],
      quiet: [],
    };
  }

  let pendingCount = 0;

  for (const event of ALERT_EVENT_ORDER) {
    const row = {} as Record<AlertChannel, AlertCell>;

    for (const channel of ALERT_CHANNEL_ORDER) {
      const { capable, reason } = readCapability(
        input.capabilities,
        event,
        channel,
      );
      const channelEnabled = channels[channel].enabled;
      const routed = input.routing?.[event]?.[channel] === true;
      const state = resolveState(capable, channelEnabled, routed);

      let pending = false;
      if (confirmed) {
        const was = readCapability(confirmed.capabilities, event, channel);
        const wasState = resolveState(
          was.capable,
          confirmed.channels?.[channel]?.enabled === true,
          confirmed.routing?.[event]?.[channel] === true,
        );
        pending = wasState !== state;
        if (pending) pendingCount += 1;
      }

      row[channel] = {
        event,
        channel,
        state,
        capable,
        channelEnabled,
        routed,
        reason,
        pending,
        attemptOnly: state === "fires" && !channels[channel].configured,
        interactive: capable,
      };

      if (capable) channels[channel].capable.push(event);
      if (state === "fires") channels[channel].firing.push(event);
      if (state === "quiet") channels[channel].quiet.push(event);
    }

    cells[event] = row;
  }

  for (const channel of ALERT_CHANNEL_ORDER) {
    const c = channels[channel];
    if (!c.enabled) c.status = "off";
    else if (!c.configured) c.status = "incomplete";
    else if (c.firing.length === 0) c.status = "unused";
    else c.status = "ready";
  }

  const covered: AlertEventKey[] = [];
  const uncovered: AlertEventKey[] = [];
  for (const event of ALERT_EVENT_ORDER) {
    const firesSomewhere = ALERT_CHANNEL_ORDER.some(
      (channel) => cells[event][channel].state === "fires",
    );
    (firesSomewhere ? covered : uncovered).push(event);
  }

  const outageChannels = ALERT_CHANNEL_ORDER.filter(
    (channel) => cells[OUTAGE_EVENT]?.[channel]?.state === "fires",
  );
  const outageGap = outageChannels.length === 0;
  const silent = covered.length === 0;

  // An outage that passes silently is the failure this page exists to prevent,
  // so it outranks a merely incomplete channel.
  const incomplete = ALERT_CHANNEL_ORDER.some(
    (channel) => channels[channel].status === "incomplete",
  );
  const tone: CoverageTone =
    silent || outageGap
      ? "bad"
      : uncovered.length > 0 || incomplete
        ? "alert"
        : "good";

  return {
    cells,
    channels,
    covered,
    uncovered,
    eventCount: ALERT_EVENT_ORDER.length,
    coveredCount: covered.length,
    outageChannels,
    outageGap,
    silent,
    pendingCount,
    tone,
  };
}
