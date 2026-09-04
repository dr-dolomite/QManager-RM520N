// =============================================================================
// Alerts — presentation metadata
// =============================================================================
// Capability truth lives in the backend and arrives via the API. This file
// carries ONLY how to present a channel, plus the recipient masks the channels
// card uses. It must never encode which (event, channel) pairs are possible.
// =============================================================================

import {
  MessageSquareIcon,
  MailIcon,
  MessageCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type { AlertChannel } from "@/types/alerts";

/** Names and copy live in the locale packs; only the glyph belongs here. */
export const CHANNEL_META: Record<AlertChannel, { icon: LucideIcon }> = {
  sms: { icon: MessageSquareIcon },
  email: { icon: MailIcon },
  discord: { icon: MessageCircleIcon },
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
