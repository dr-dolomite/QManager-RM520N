import {
  BellOffIcon,
  CheckCircle2Icon,
  MinusCircleIcon,
  PowerOffIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type { AlertChannel, AlertEventKey } from "@/types/alerts";
import type { CellState, ChannelStatus } from "./derive";
import type { CellTone } from "./shapes";
import { CHANNEL_META } from "./constants";

// Glyph and i18n-key maps shared by the band and the matrix. Icons come from
// `constants.tsx`; every user-visible string is a key, never English.

export const CHANNEL_GLYPH: Record<AlertChannel, LucideIcon> = {
  sms: CHANNEL_META.sms.icon,
  email: CHANNEL_META.email.icon,
  discord: CHANNEL_META.discord.icon,
};

export const channelNameKey = (channel: AlertChannel) =>
  `alerts.coverage.channel.${channel}`;

export const eventNameKey = (event: AlertEventKey) =>
  `alerts.coverage.event.${event}.name`;

export const eventDescKey = (event: AlertEventKey) =>
  `alerts.coverage.event.${event}.desc`;

/** `off` and `unused` share the `muted` chip role, so their glyphs must differ. */
export const CHANNEL_STATUS_GLYPH: Record<ChannelStatus, LucideIcon> = {
  ready: CheckCircle2Icon,
  incomplete: TriangleAlertIcon,
  unused: MinusCircleIcon,
  off: PowerOffIcon,
};

export const channelStatusKey = (status: ChannelStatus) =>
  `alerts.coverage.channelStatus.${status}`;

/**
 * The five things a cell can say. `attempt` is not an engine state: it is
 * `fires` on a channel with no credentials yet, drawn apart so "Sends" never
 * promises a delivery that will fail at send time.
 */
export type CellDisplay = CellState | "attempt";

export const cellDisplay = (cell: {
  state: CellState;
  attemptOnly: boolean;
}): CellDisplay => (cell.attemptOnly ? "attempt" : cell.state);

/** One glyph per cell display: two of them never share one. */
export const CELL_STATE_GLYPH: Record<CellDisplay, LucideIcon> = {
  fires: CheckCircle2Icon,
  attempt: TriangleAlertIcon,
  quiet: BellOffIcon,
  unrouted: MinusCircleIcon,
  incapable: XCircleIcon,
};

/** Every word here names the OUTCOME, never the tick that produced it. */
export const CELL_STATE_LABEL_KEY: Record<CellDisplay, string> = {
  fires: "alerts.coverage.cell.fires",
  attempt: "alerts.coverage.cell.attempt",
  quiet: "alerts.coverage.cell.quiet",
  unrouted: "alerts.coverage.cell.unrouted",
  incapable: "alerts.coverage.cell.incapable",
};

/** `incapable` explains itself from its own reason key, so it is absent here. */
export const CELL_STATE_NOTE_KEY: Partial<Record<CellDisplay, string>> = {
  attempt: "alerts.coverage.cell.attemptNote",
  quiet: "alerts.coverage.cell.quietNote",
  unrouted: "alerts.coverage.cell.unroutedNote",
};

/** The ground each display takes. `pending` composes its ring on top, not here. */
export const CELL_DISPLAY_TONE: Record<CellDisplay, CellTone> = {
  fires: "fires",
  attempt: "attempt",
  quiet: "quiet",
  unrouted: "rest",
  incapable: "dead",
};

const KNOWN_REASONS = new Set([
  "email_needs_internet",
  "discord_needs_internet",
  "not_supported",
]);

/** An unrecognised reason key falls back rather than printing a raw token. */
export const reasonKey = (reason?: string) =>
  `alerts.coverage.reason.${reason && KNOWN_REASONS.has(reason) ? reason : "not_supported"}`;
