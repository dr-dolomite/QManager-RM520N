"use client";

import { useCallback, useMemo, useState } from "react";
import { useSaveFlash } from "@/components/ui/save-button";
import type {
  AlertsState,
  AlertsSavePayload,
  AlertChannel,
  AlertEventKey,
} from "@/types/alerts";
import { ALERT_EVENT_ORDER, ALERT_CHANNEL_ORDER } from "@/types/alerts";

// =============================================================================
// useAlertsForm — the single editable form behind the whole Alerts page
// =============================================================================
// Seeded from server truth and re-seeded in place whenever that truth changes,
// via a render-phase sync keyed on a settings signature (NOT a useEffect — the
// React-Compiler lint rules forbid setState-in-effect, and NOT a remount — a
// `key` on the consuming subtree also destroyed the save flash, the active tab,
// the show-secret toggles and every sibling card's state). Owns all three
// channels and the routing matrix; a single atomic submit commits everything.
// =============================================================================

// E.164-ish: optional leading +, first digit 1–9, total 7–15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Discord snowflake IDs are 17–20 digit numeric strings.
const DISCORD_ID_REGEX = /^\d{17,20}$/;

const THRESHOLD_MIN = 1;
const THRESHOLD_MAX = 60;

function thresholdInvalid(v: string): boolean {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) || n < THRESHOLD_MIN || n > THRESHOLD_MAX;
}

// Value fingerprint of everything the form mirrors. A change here means server
// truth moved and the fields must be re-seeded; an identical signature (e.g. a
// refetch that returned the same values) leaves the user's edits alone.
// NOTE: secrets are represented by their `*_set` booleans — the values are
// never sent to the client — so a rotation (set → set) does NOT move the
// signature. Clearing the secret inputs after a successful save is therefore
// the settings card's job, not this sync's.
function settingsSignature(state: AlertsState): string {
  const { sms, email, discord } = state.channels;
  const routing = ALERT_EVENT_ORDER.flatMap((ev) =>
    ALERT_CHANNEL_ORDER.map((ch) =>
      state.routing.events[ev]?.[ch] ? "1" : "0",
    ),
  ).join("");
  return [
    sms.enabled,
    sms.recipient_phone,
    sms.threshold_minutes,
    email.enabled,
    email.sender_email,
    email.recipient_email,
    email.app_password_set,
    email.threshold_minutes,
    email.msmtp_installed,
    discord.enabled,
    discord.owner_discord_id,
    discord.token_set,
    discord.threshold_minutes,
    discord.connected,
    routing,
  ].join("|");
}

export type RoutingDraft = Record<AlertEventKey, Record<AlertChannel, boolean>>;

export interface AlertsFormErrors {
  smsPhone?: boolean;
  smsThreshold?: boolean;
  senderEmail?: boolean;
  recipientEmail?: boolean;
  emailThreshold?: boolean;
  discordId?: boolean;
  discordThreshold?: boolean;
}

export interface AlertsForm {
  // SMS channel
  smsEnabled: boolean;
  setSmsEnabled: (v: boolean) => void;
  smsPhone: string;
  setSmsPhone: (v: string) => void;
  smsThreshold: string;
  setSmsThreshold: (v: string) => void;

  // Email channel
  emailEnabled: boolean;
  setEmailEnabled: (v: boolean) => void;
  senderEmail: string;
  setSenderEmail: (v: string) => void;
  recipientEmail: string;
  setRecipientEmail: (v: string) => void;
  appPassword: string;
  setAppPassword: (v: string) => void;
  /** True when the device already has a stored app password (never revealed). */
  appPasswordSet: boolean;
  emailThreshold: string;
  setEmailThreshold: (v: string) => void;

  // Discord channel
  discordEnabled: boolean;
  setDiscordEnabled: (v: boolean) => void;
  discordId: string;
  setDiscordId: (v: string) => void;
  botToken: string;
  setBotToken: (v: string) => void;
  /** True when the device already has a stored bot token (never revealed). */
  botTokenSet: boolean;
  discordThreshold: string;
  setDiscordThreshold: (v: string) => void;

  // Routing matrix
  getRoute: (event: AlertEventKey, channel: AlertChannel) => boolean;
  setRoute: (event: AlertEventKey, channel: AlertChannel, v: boolean) => void;

  // Validation / dirty state
  errors: AlertsFormErrors;
  /** Empty-while-enabled blockers, keyed like errors. */
  missing: {
    smsPhone: boolean;
    senderEmail: boolean;
    recipientEmail: boolean;
    appPassword: boolean;
    discordId: boolean;
    botToken: boolean;
  };
  isDirty: boolean;
  blocked: boolean;

  // Save lifecycle
  isSaving: boolean;
  saved: boolean;
  markSaved: () => void;
  buildPayload: () => AlertsSavePayload;
  discard: () => void;
}

export function useAlertsForm({
  state,
  isSaving,
}: {
  state: AlertsState;
  isSaving: boolean;
}): AlertsForm {
  const { sms, email, discord } = state.channels;
  const { saved, markSaved } = useSaveFlash();

  // ── Seed once from server truth ────────────────────────────────────────────
  const [smsEnabled, setSmsEnabled] = useState(sms.enabled);
  const [smsPhone, setSmsPhone] = useState(sms.recipient_phone);
  const [smsThreshold, setSmsThreshold] = useState(String(sms.threshold_minutes));

  const [emailEnabled, setEmailEnabled] = useState(email.enabled);
  const [senderEmail, setSenderEmail] = useState(email.sender_email);
  const [recipientEmail, setRecipientEmail] = useState(email.recipient_email);
  const [appPassword, setAppPassword] = useState(""); // never pre-filled
  const [emailThreshold, setEmailThreshold] = useState(
    String(email.threshold_minutes),
  );

  const [discordEnabled, setDiscordEnabled] = useState(discord.enabled);
  const [discordId, setDiscordId] = useState(discord.owner_discord_id);
  const [botToken, setBotToken] = useState(""); // never pre-filled
  const [discordThreshold, setDiscordThreshold] = useState(
    String(discord.threshold_minutes),
  );

  const seedRouting = useCallback((): RoutingDraft => {
    const draft = {} as RoutingDraft;
    for (const ev of ALERT_EVENT_ORDER) {
      draft[ev] = {} as Record<AlertChannel, boolean>;
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        draft[ev][ch] = capable && (state.routing.events[ev]?.[ch] ?? false);
      }
    }
    return draft;
  }, [state]);

  const [routing, setRouting] = useState<RoutingDraft>(seedRouting);

  const getRoute = useCallback(
    (event: AlertEventKey, channel: AlertChannel) =>
      routing[event]?.[channel] ?? false,
    [routing],
  );
  const setRoute = useCallback(
    (event: AlertEventKey, channel: AlertChannel, v: boolean) => {
      // Never allow routing on an incapable cell.
      if (!(state.capabilities[event]?.[channel] ?? false)) return;
      setRouting((prev) => ({
        ...prev,
        [event]: { ...prev[event], [channel]: v },
      }));
    },
    [state.capabilities],
  );

  // ── Format validation (only when a value is present) ───────────────────────
  const errors: AlertsFormErrors = useMemo(
    () => ({
      smsPhone: !!smsPhone && !PHONE_REGEX.test(smsPhone),
      smsThreshold: thresholdInvalid(smsThreshold),
      senderEmail: !!senderEmail && !EMAIL_REGEX.test(senderEmail),
      recipientEmail: !!recipientEmail && !EMAIL_REGEX.test(recipientEmail),
      emailThreshold: thresholdInvalid(emailThreshold),
      discordId: !!discordId && !DISCORD_ID_REGEX.test(discordId.trim()),
      discordThreshold: thresholdInvalid(discordThreshold),
    }),
    [
      smsPhone,
      smsThreshold,
      senderEmail,
      recipientEmail,
      emailThreshold,
      discordId,
      discordThreshold,
    ],
  );

  // ── Empty-while-enabled blockers ───────────────────────────────────────────
  const missing = useMemo(
    () => ({
      smsPhone: smsEnabled && smsPhone.trim() === "",
      senderEmail: emailEnabled && senderEmail.trim() === "",
      recipientEmail: emailEnabled && recipientEmail.trim() === "",
      // A new secret is required only when none is stored yet.
      appPassword:
        emailEnabled && !email.app_password_set && appPassword.trim() === "",
      discordId: discordEnabled && discordId.trim() === "",
      botToken: discordEnabled && !discord.token_set && botToken.trim() === "",
    }),
    [
      smsEnabled,
      smsPhone,
      emailEnabled,
      senderEmail,
      recipientEmail,
      appPassword,
      email.app_password_set,
      discordEnabled,
      discordId,
      botToken,
      discord.token_set,
    ],
  );

  // Threshold / format errors only matter when their channel is enabled.
  const hasFormatError =
    (smsEnabled && (errors.smsPhone || errors.smsThreshold)) ||
    (emailEnabled &&
      (errors.senderEmail || errors.recipientEmail || errors.emailThreshold)) ||
    (discordEnabled && (errors.discordId || errors.discordThreshold));
  const hasMissing =
    missing.smsPhone ||
    missing.senderEmail ||
    missing.recipientEmail ||
    missing.appPassword ||
    missing.discordId ||
    missing.botToken;
  const blocked = !!hasFormatError || hasMissing;

  // ── Dirty check vs seeded server truth ─────────────────────────────────────
  const routingDirty = useMemo(() => {
    for (const ev of ALERT_EVENT_ORDER) {
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        const server = capable && (state.routing.events[ev]?.[ch] ?? false);
        if ((routing[ev]?.[ch] ?? false) !== server) return true;
      }
    }
    return false;
  }, [routing, state]);

  const isDirty =
    smsEnabled !== sms.enabled ||
    smsPhone !== sms.recipient_phone ||
    smsThreshold !== String(sms.threshold_minutes) ||
    emailEnabled !== email.enabled ||
    senderEmail !== email.sender_email ||
    recipientEmail !== email.recipient_email ||
    emailThreshold !== String(email.threshold_minutes) ||
    appPassword.trim() !== "" ||
    discordEnabled !== discord.enabled ||
    discordId !== discord.owner_discord_id ||
    discordThreshold !== String(discord.threshold_minutes) ||
    botToken.trim() !== "" ||
    routingDirty;

  // ── Payload / discard ──────────────────────────────────────────────────────
  const buildPayload = useCallback((): AlertsSavePayload => {
    const events = {} as RoutingDraft;
    for (const ev of ALERT_EVENT_ORDER) {
      events[ev] = {} as Record<AlertChannel, boolean>;
      for (const ch of ALERT_CHANNEL_ORDER) {
        const capable = state.capabilities[ev]?.[ch] ?? false;
        events[ev][ch] = capable && (routing[ev]?.[ch] ?? false);
      }
    }
    const payload: AlertsSavePayload = {
      action: "save_settings",
      sms: {
        enabled: smsEnabled,
        recipient_phone: smsPhone.trim(),
        threshold_minutes: parseInt(smsThreshold, 10),
      },
      email: {
        enabled: emailEnabled,
        sender_email: senderEmail.trim(),
        recipient_email: recipientEmail.trim(),
        threshold_minutes: parseInt(emailThreshold, 10),
      },
      discord: {
        enabled: discordEnabled,
        owner_discord_id: discordId.trim(),
        threshold_minutes: parseInt(discordThreshold, 10),
      },
      routing: { events },
    };
    if (appPassword.trim() !== "") payload.email.app_password = appPassword;
    if (botToken.trim() !== "") payload.discord.bot_token = botToken;
    return payload;
  }, [
    state.capabilities,
    routing,
    smsEnabled,
    smsPhone,
    smsThreshold,
    emailEnabled,
    senderEmail,
    recipientEmail,
    emailThreshold,
    appPassword,
    discordEnabled,
    discordId,
    discordThreshold,
    botToken,
  ]);

  const discard = useCallback(() => {
    setSmsEnabled(sms.enabled);
    setSmsPhone(sms.recipient_phone);
    setSmsThreshold(String(sms.threshold_minutes));
    setEmailEnabled(email.enabled);
    setSenderEmail(email.sender_email);
    setRecipientEmail(email.recipient_email);
    setAppPassword("");
    setEmailThreshold(String(email.threshold_minutes));
    setDiscordEnabled(discord.enabled);
    setDiscordId(discord.owner_discord_id);
    setBotToken("");
    setDiscordThreshold(String(discord.threshold_minutes));
    setRouting(seedRouting());
  }, [sms, email, discord, seedRouting]);

  // ── Re-seed on server-truth change (render-phase, React-Compiler safe) ──────
  // `discard` is the already-correct re-seed path (pure setState, no async, no
  // toast), so reuse it rather than maintaining a parallel seeding path.
  const signature = settingsSignature(state);
  const [prevSignature, setPrevSignature] = useState(signature);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    discard();
  }

  return {
    smsEnabled,
    setSmsEnabled,
    smsPhone,
    setSmsPhone,
    smsThreshold,
    setSmsThreshold,
    emailEnabled,
    setEmailEnabled,
    senderEmail,
    setSenderEmail,
    recipientEmail,
    setRecipientEmail,
    appPassword,
    setAppPassword,
    appPasswordSet: email.app_password_set,
    emailThreshold,
    setEmailThreshold,
    discordEnabled,
    setDiscordEnabled,
    discordId,
    setDiscordId,
    botToken,
    setBotToken,
    botTokenSet: discord.token_set,
    discordThreshold,
    setDiscordThreshold,
    getRoute,
    setRoute,
    errors,
    missing,
    isDirty,
    blocked,
    isSaving,
    saved,
    markSaved,
    buildPayload,
    discard,
  };
}
