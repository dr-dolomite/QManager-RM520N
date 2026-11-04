// Alerts — presentation metadata only. Capability truth arrives from the API;
// nothing here may encode which (event, channel) pairs are possible.

import {
  MailIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  WifiIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";
import type { AlertChannel, AlertEventKey } from "@/types/alerts";

export const CHANNEL_GLYPH: Record<AlertChannel, LucideIcon> = {
  sms: MessageSquareIcon,
  email: MailIcon,
  discord: MessageCircleIcon,
};

export const EVENT_GLYPH: Record<AlertEventKey, LucideIcon> = {
  connection_lost: WifiOffIcon,
  connection_restored: WifiIcon,
  reboot: RotateCcwIcon,
};

export const channelNameKey = (channel: AlertChannel) =>
  `alerts.channels.name.${channel}`;

export const eventNameKey = (event: AlertEventKey) =>
  `alerts.coverage.event.${event}.name`;

/** The engine's trigger keys, so a log row can name the event instead of the key. */
export function isEventKey(value: string): value is AlertEventKey {
  return Object.prototype.hasOwnProperty.call(EVENT_GLYPH, value);
}

const KNOWN_REASONS = new Set([
  "email_needs_internet",
  "discord_needs_internet",
  "not_supported",
]);

// Save-path cgi_error slugs (alerts.sh and its secret helper) → translated copy.
const SAVE_ERROR_KEY: Record<string, string> = {
  invalid_threshold: "alerts.channels.save.errors.invalid_threshold",
  invalid_phone: "alerts.channels.save.errors.invalid_phone",
  invalid_email: "alerts.channels.save.errors.invalid_email",
  invalid_sender: "alerts.channels.save.errors.invalid_email",
  missing_app_password: "alerts.channels.save.errors.missing_app_password",
  invalid_discord_id: "alerts.channels.save.errors.invalid_discord_id",
  missing_bot_token: "alerts.channels.save.errors.missing_bot_token",
  empty_value: "alerts.channels.save.errors.invalid_secret",
  invalid_value: "alerts.channels.save.errors.invalid_secret",
  value_too_long: "alerts.channels.save.errors.invalid_secret",
  marker_write_failed: "alerts.channels.save.errors.partial",
  service_restart_failed: "alerts.channels.save.errors.service_restart_failed",
  service_enable_failed: "alerts.channels.save.errors.service_enable_failed",
};

// Test-path slugs; send_failed means something different on each channel.
const TEST_ERROR_KEY: Record<string, string> = {
  library_missing: "alerts.channels.test.errors.library_missing",
  not_configured: "alerts.channels.test.errors.not_configured",
  bot_not_running: "alerts.channels.test.errors.bot_not_running",
  msmtp_missing: "alerts.channels.test.errors.msmtp_missing",
};
const SEND_FAILED_KEY: Record<AlertChannel, string> = {
  sms: "alerts.channels.test.errors.send_failed_sms",
  email: "alerts.channels.test.errors.send_failed_email",
  discord: "alerts.channels.test.errors.send_failed_discord",
};

const own = (map: Record<string, string>, code: string | null) =>
  code !== null && Object.prototype.hasOwnProperty.call(map, code) ? map[code] : undefined;

/** An unknown or missing slug falls back to the generic failure, never the English detail. */
export const saveErrorKey = (code: string | null) =>
  own(SAVE_ERROR_KEY, code) ?? "alerts.channels.save.failed";

export const testErrorKey = (channel: AlertChannel, code: string | null) =>
  code === "send_failed"
    ? SEND_FAILED_KEY[channel]
    : (own(TEST_ERROR_KEY, code) ?? "alerts.channels.test.failed");

/** An unrecognised reason key falls back rather than printing a raw token. */
export const reasonKey = (reason?: string) =>
  `alerts.coverage.reason.${reason && KNOWN_REASONS.has(reason) ? reason : "not_supported"}`;
