// =============================================================================
// Alerts — presentation metadata (icons + English copy only)
// =============================================================================
// Capability truth lives in the backend and arrives via the API. This file
// carries ONLY how to present each event and channel: which icon, which label.
// It must never encode which (event, channel) pairs are possible.
// =============================================================================

import {
  MessageSquareIcon,
  MailIcon,
  MessageCircleIcon,
  WifiOffIcon,
  Wifi as WifiIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  PowerIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import type {
  AlertChannel,
  AlertEventKey,
  RebootCause,
} from "@/types/alerts";

interface ChannelMeta {
  icon: LucideIcon;
  /** Full display name (e.g. "SMS"). */
  name: string;
  /** Short display name used in badges / column heads. */
  short: string;
}

export const CHANNEL_META: Record<AlertChannel, ChannelMeta> = {
  sms: { icon: MessageSquareIcon, name: "SMS", short: "SMS" },
  email: { icon: MailIcon, name: "Email", short: "Email" },
  discord: { icon: MessageCircleIcon, name: "Discord", short: "Discord" },
};

interface EventMeta {
  icon: LucideIcon;
  name: string;
  desc: string;
}

export const EVENT_META: Record<AlertEventKey, EventMeta> = {
  connection_lost: {
    icon: WifiOffIcon,
    name: "Connection lost",
    desc: "The internet has been down past the alert threshold.",
  },
  connection_restored: {
    icon: WifiIcon,
    name: "Connection restored",
    desc: "The internet came back after an outage.",
  },
  reboot: {
    icon: RotateCcwIcon,
    name: "Modem rebooted",
    desc: "The modem restarted. Sent once it's back online, with the reason.",
  },
};

// ─── Incapable-cell reason copy (keyed by the backend's *_reason value) ──────

export const REASON_TEXT: Record<string, string> = {
  email_needs_internet:
    "Email can't be sent while the internet is down — only SMS works during an outage.",
  discord_needs_internet:
    "Discord can't be sent while the internet is down — only SMS works during an outage.",
  not_supported: "This channel doesn't support this event.",
};

export function reasonText(reasonKey?: string): string {
  return REASON_TEXT[reasonKey ?? "not_supported"] ?? REASON_TEXT.not_supported;
}

// ─── Reboot-cause presentation (icon + tone + label) ─────────────────────────
// Tone is a status role, never a brand accent: `unplanned` earns attention
// (warning), `watchdog` reads as an automated recovery (info), `user` is the
// expected, low-signal case (muted). Color is always paired with icon + text.

type RebootTone = "warning" | "info" | "muted";

interface RebootCauseMeta {
  icon: LucideIcon;
  tone: RebootTone;
  label: string;
}

export const REBOOT_CAUSE_META: Record<RebootCause, RebootCauseMeta> = {
  unplanned: { icon: TriangleAlertIcon, tone: "warning", label: "Unexpected" },
  watchdog: { icon: ShieldCheckIcon, tone: "info", label: "Watchdog" },
  user: { icon: PowerIcon, tone: "muted", label: "Planned" },
};

export const REBOOT_TONE_BADGE: Record<RebootTone, string> = {
  warning: "bg-warning/15 text-warning border-warning/30",
  info: "bg-info/15 text-info border-info/30",
  muted: "bg-muted/50 text-muted-foreground border-muted-foreground/30",
};

// ─── Recipient masking (never show the full contact in the glance hero) ──────

/** `+14155551234` → `••• ••• 1234`; keeps the last 4 digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length <= 4) return phone;
  return `••• ••• ${digits.slice(-4)}`;
}

/** `you@example.com` → `y•••@example.com`; keeps first char + domain. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return email;
  return `${email[0]}•••${email.slice(at)}`;
}

/** `123456789012345678` → `••••••5678`; keeps the last 4 digits of the ID. */
export function maskDiscordId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 4) return trimmed;
  return `••••••${trimmed.slice(-4)}`;
}
