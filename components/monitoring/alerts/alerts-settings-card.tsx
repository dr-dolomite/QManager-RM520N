"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCcwIcon,
  MinusCircleIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SaveButton } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { UseAlertsReturn } from "@/hooks/use-alerts";
import type { AlertChannel, AlertsState } from "@/types/alerts";
import { ALERT_CHANNEL_ORDER } from "@/types/alerts";

import {
  CHANNEL_BUTTON,
  ChannelField,
  ChannelNotice,
  ChannelSecretField,
  ChannelSwitchRow,
} from "./channel-field";
import { ChannelRail, panelId, tabId, type ChannelRailItem } from "./channel-rail";
import { maskDiscordId, maskEmail, maskPhone } from "./constants";
import { deriveCoverage } from "./derive";
import {
  CARD_DESC,
  CARD_FILL,
  CARD_FILL_REGION,
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  FIELD,
  RAIL,
  SAVEBAR,
  SKELETON,
  type ConditionTone,
} from "./shapes";
import { blockedChannelMap, type AlertsForm } from "./use-alerts-form";

const ID_BASE = "alert-channel";

/** What went wrong last, and where it belongs on screen. */
type ActionFault =
  | { scope: "save"; message: string }
  | { scope: "test"; channel: AlertChannel; message: string };

export interface AlertsSettingsCardProps {
  form: AlertsForm;
  state: AlertsState;
  hook: UseAlertsReturn;
  /** Bumped after a successful test so the activity card silently refreshes. */
  onTested: () => void;
}

// -----------------------------------------------------------------------------
// AlertsSettingsCard — the three-channel write surface. Routing lives on the
// coverage hero; this card owns transports, credentials and one atomic Save.
// -----------------------------------------------------------------------------
export function AlertsSettingsCard({
  form,
  state,
  hook,
  onTested,
}: AlertsSettingsCardProps) {
  const { t } = useTranslation("common");
  const [channel, setChannel] = useState<AlertChannel>("sms");
  const [fault, setFault] = useState<ActionFault | null>(null);
  const [tested, setTested] = useState<AlertChannel | null>(null);

  // The rail reports SAVED truth, never the half-edited form (State-Honesty).
  const coverage = useMemo(
    () =>
      deriveCoverage({
        channels: state.channels,
        routing: state.routing?.events ?? ({} as AlertsState["routing"]["events"]),
        capabilities: state.capabilities,
      }),
    [state],
  );

  const channelsUsable =
    !!state.channels?.sms && !!state.channels?.email && !!state.channels?.discord;

  // Per-channel form faults, shared with the coverage hero so the two surfaces
  // cannot disagree about which channel is holding the save back.
  const channelBlocked = blockedChannelMap(form);

  const channelName: Record<AlertChannel, string> = {
    sms: t("alerts.channels.name.sms"),
    email: t("alerts.channels.name.email"),
    discord: t("alerts.channels.name.discord"),
  };

  // A channel holding an unsaved fault borrows `incomplete`, so the dot asks for
  // attention from a tab you are not standing on. No new tone is invented.
  const railItems: ChannelRailItem[] = ALERT_CHANNEL_ORDER.map((ch) => ({
    channel: ch,
    label: channelName[ch],
    status: channelBlocked[ch] ? "incomplete" : coverage.channels[ch].status,
    statusLabel: channelBlocked[ch]
      ? t("alerts.channels.status.needs_fixing")
      : t(`alerts.channels.status.${coverage.channels[ch].status}`),
  }));

  const blockedNames = ALERT_CHANNEL_ORDER.filter((ch) => channelBlocked[ch]).map(
    (ch) => channelName[ch],
  );

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (form.blocked) return;
    setFault(null);
    setTested(null);
    const ok = await hook.saveSettings(form.buildPayload());
    if (!ok) {
      const message = hook.error || t("alerts.channels.save.failed");
      setFault({ scope: "save", message });
      toast.error(message);
      return;
    }
    // Load-bearing: GET never returns a secret, so a rotation moves no value the
    // form watches. Clearing here is what lets `isDirty` settle after a save.
    form.setAppPassword("");
    form.setBotToken("");
    form.markSaved();
    toast.success(t("alerts.channels.save.succeeded"));
  };

  // ── Test (runs against SAVED config on the device) ─────────────────────────
  const handleTest = async (ch: AlertChannel) => {
    setFault(null);
    setTested(null);
    const ok = await hook.sendTest(ch);
    if (ok) {
      setTested(ch);
      toast.success(t("alerts.channels.test.succeeded", { channel: channelName[ch] }));
    } else {
      const message = hook.error || t("alerts.channels.test.failed");
      setFault({ scope: "test", channel: ch, message });
      toast.error(message);
    }
    onTested();
  };

  /** `null` when the test is takeable; otherwise the stated reason it is not. */
  const testBlockedReason = (ch: AlertChannel): string | null => {
    const saved = state.channels[ch];
    if (!saved.enabled) return t("alerts.channels.test.blocked_off");
    if (!saved.configured) return t("alerts.channels.test.blocked_incomplete");
    if (ch === "email" && !state.channels.email.msmtp_installed)
      return t("alerts.channels.test.blocked_mailer");
    if (ch === "discord" && !state.channels.discord.connected)
      return t("alerts.channels.test.blocked_offline");
    if (form.isDirty) return t("alerts.channels.test.blocked_dirty");
    if (hook.testingChannel !== null) return t("alerts.channels.test.blocked_busy");
    return null;
  };

  // Guarded: a partial payload reaches this line before the condition below.
  const testRecipient: Record<AlertChannel, string> = {
    sms: maskPhone(state.channels?.sms?.recipient_phone ?? ""),
    email: maskEmail(state.channels?.email?.recipient_email ?? ""),
    discord: maskDiscordId(state.channels?.discord?.owner_discord_id ?? ""),
  };

  // Only while dirty: a not-dirty Save is `disabled`, and a disabled button
  // takes no pointer events, so a reason attached there would be unreachable.
  const saveBlockedReason =
    form.isDirty && form.blocked
      ? blockedNames.length > 0
        ? t("alerts.channels.save.blocked_in", {
            channels: blockedNames.join(", "),
          })
        : t("alerts.channels.save.blocked")
      : null;

  return (
    <Card className={cn(CARD_SHELL, CARD_FILL)}>
      <CardHeader className={CARD_PAD}>
        <div className={CARD_HEAD}>
          <div className="min-w-0 space-y-1">
            <CardTitle className={CARD_TITLE}>
              {t("alerts.channels.title")}
            </CardTitle>
            <CardDescription className={CARD_DESC}>
              {t("alerts.channels.description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex min-h-0 flex-1 flex-col gap-5")}>
        {!channelsUsable ? (
          <ChannelsCondition
            tone={hook.error ? "destructive" : "muted"}
            title={
              hook.error
                ? t("alerts.channels.error.title")
                : t("alerts.channels.empty.title")
            }
            description={
              hook.error
                ? hook.error
                : t("alerts.channels.empty.description")
            }
            actionLabel={hook.error ? t("alerts.channels.error.retry") : undefined}
            onAction={hook.error ? hook.refresh : undefined}
          />
        ) : (
          <>
            <ChannelRail
              label={t("alerts.channels.rail_label")}
              items={railItems}
              value={channel}
              onValueChange={setChannel}
              idBase={ID_BASE}
            />

            {/* THE FILL REGION. Everything above and below it is content-height,
                so this is the one place the pair's slack can land. */}
            {/* No entrance keyframe: a panel that is invisible until a frame
                runs is not correct at rest. The rail pill's fill carries the
                swap instead. */}
            <div
              role="tabpanel"
              id={panelId(ID_BASE, channel)}
              aria-labelledby={tabId(ID_BASE, channel)}
              className={cn(CARD_FILL_REGION, "flex flex-col gap-5")}
            >
              {channel === "sms" ? (
                <SmsPanel form={form} />
              ) : channel === "email" ? (
                <EmailPanel form={form} state={state} hook={hook} />
              ) : (
                <DiscordPanel form={form} />
              )}

              <TestAction
                label={t(`alerts.channels.${channel}.test`)}
                blockedReason={testBlockedReason(channel)}
                isSending={hook.testingChannel === channel}
                sendingLabel={t("alerts.channels.test.sending")}
                sentLabel={t("alerts.channels.test.sent")}
                sentTo={tested === channel ? testRecipient[channel] : null}
                fault={
                  fault?.scope === "test" && fault.channel === channel
                    ? fault.message
                    : null
                }
                onSend={() => handleTest(channel)}
              />
            </div>

            {fault?.scope === "save" ? (
              <ChannelNotice tone="destructive" icon={AlertCircleIcon} live>
                {fault.message}
              </ChannelNotice>
            ) : null}

            <div className={SAVEBAR.ROOT}>
              <SaveStatus
                isDirty={form.isDirty}
                blocked={form.blocked}
                saved={form.saved}
                blockedNames={blockedNames}
              />
              <div className={SAVEBAR.ACTIONS}>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(CHANNEL_BUTTON, "text-on-surface-variant")}
                  onClick={form.discard}
                  disabled={!form.isDirty || form.isSaving}
                >
                  {t("alerts.channels.save.discard")}
                </Button>
                <SaveButton
                  type="button"
                  className={CHANNEL_BUTTON}
                  label={t("alerts.channels.save.action")}
                  isSaving={form.isSaving}
                  saved={form.saved}
                  blockedReason={saveBlockedReason}
                  disabled={!form.isDirty || form.isSaving}
                  onClick={handleSave}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Panels
// -----------------------------------------------------------------------------
function SmsPanel({ form }: { form: AlertsForm }) {
  const { t } = useTranslation("common");
  const on = form.smsEnabled;
  return (
    <>
      <ChannelSwitchRow
        id="sms-enabled"
        title={t("alerts.channels.sms.switch_title")}
        description={t(
          on ? "alerts.channels.sms.switch_on" : "alerts.channels.sms.switch_off",
        )}
        checked={on}
        onCheckedChange={form.setSmsEnabled}
      />
      <ChannelField
        id="sms-phone"
        label={t("alerts.channels.sms.phone_label")}
        hint={t("alerts.channels.sms.phone_hint")}
        error={
          form.missing.smsPhone
            ? t("alerts.channels.sms.phone_missing")
            : on && form.errors.smsPhone
              ? t("alerts.channels.sms.phone_error")
              : undefined
        }
        value={form.smsPhone}
        onChange={form.setSmsPhone}
        disabled={!on}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+14155551234"
        mono
      />
      <ThresholdField
        id="sms-threshold"
        value={form.smsThreshold}
        onChange={form.setSmsThreshold}
        disabled={!on}
        invalid={on && !!form.errors.smsThreshold}
      />
    </>
  );
}

function EmailPanel({
  form,
  state,
  hook,
}: {
  form: AlertsForm;
  state: AlertsState;
  hook: UseAlertsReturn;
}) {
  const { t } = useTranslation("common");
  const on = form.emailEnabled;
  return (
    <>
      {!state.channels.email.msmtp_installed ? (
        <MailerInstall hook={hook} />
      ) : null}
      <ChannelSwitchRow
        id="email-enabled"
        title={t("alerts.channels.email.switch_title")}
        description={t(
          on
            ? "alerts.channels.email.switch_on"
            : "alerts.channels.email.switch_off",
        )}
        checked={on}
        onCheckedChange={form.setEmailEnabled}
      />
      <ChannelField
        id="sender-email"
        label={t("alerts.channels.email.sender_label")}
        hint={t("alerts.channels.email.sender_hint")}
        error={
          form.missing.senderEmail
            ? t("alerts.channels.email.sender_missing")
            : on && form.errors.senderEmail
              ? t("alerts.channels.email.address_error")
              : undefined
        }
        value={form.senderEmail}
        onChange={form.setSenderEmail}
        disabled={!on}
        type="email"
        autoComplete="email"
        placeholder="alerts@gmail.com"
        mono
      />
      <ChannelField
        id="recipient-email"
        label={t("alerts.channels.email.recipient_label")}
        hint={t("alerts.channels.email.recipient_hint")}
        error={
          form.missing.recipientEmail
            ? t("alerts.channels.email.recipient_missing")
            : on && form.errors.recipientEmail
              ? t("alerts.channels.email.address_error")
              : undefined
        }
        value={form.recipientEmail}
        onChange={form.setRecipientEmail}
        disabled={!on}
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        mono
      />
      <ChannelSecretField
        id="app-password"
        label={t("alerts.channels.email.password_label")}
        hint={
          <ExternalHint
            text={t("alerts.channels.email.password_hint")}
            href="https://myaccount.google.com/apppasswords"
            linkLabel={t("alerts.channels.email.password_link")}
          />
        }
        error={
          form.missing.appPassword
            ? t("alerts.channels.email.password_missing")
            : undefined
        }
        value={form.appPassword}
        onChange={form.setAppPassword}
        disabled={!on}
        isSet={form.appPasswordSet}
        savedLabel={t("alerts.channels.secret_saved")}
        placeholder={
          form.appPasswordSet
            ? t("alerts.channels.email.password_keep")
            : t("alerts.channels.email.password_placeholder")
        }
        autoComplete="new-password"
        showLabel={t("alerts.channels.email.password_show")}
        hideLabel={t("alerts.channels.email.password_hide")}
      />
      <ThresholdField
        id="email-threshold"
        value={form.emailThreshold}
        onChange={form.setEmailThreshold}
        disabled={!on}
        invalid={on && !!form.errors.emailThreshold}
      />
    </>
  );
}

function DiscordPanel({ form }: { form: AlertsForm }) {
  const { t } = useTranslation("common");
  const on = form.discordEnabled;
  return (
    <>
      <ChannelSwitchRow
        id="discord-enabled"
        title={t("alerts.channels.discord.switch_title")}
        description={t(
          on
            ? "alerts.channels.discord.switch_on"
            : "alerts.channels.discord.switch_off",
        )}
        checked={on}
        onCheckedChange={form.setDiscordEnabled}
      />
      <ChannelField
        id="discord-id"
        label={t("alerts.channels.discord.id_label")}
        hint={t("alerts.channels.discord.id_hint")}
        error={
          form.missing.discordId
            ? t("alerts.channels.discord.id_missing")
            : on && form.errors.discordId
              ? t("alerts.channels.discord.id_error")
              : undefined
        }
        value={form.discordId}
        onChange={form.setDiscordId}
        disabled={!on}
        inputMode="numeric"
        autoComplete="off"
        placeholder="123456789012345678"
        mono
      />
      <ChannelSecretField
        id="bot-token"
        label={t("alerts.channels.discord.token_label")}
        hint={
          <ExternalHint
            text={t("alerts.channels.discord.token_hint")}
            href="https://discord.com/developers/applications"
            linkLabel={t("alerts.channels.discord.token_link")}
          />
        }
        error={
          form.missing.botToken
            ? t("alerts.channels.discord.token_missing")
            : undefined
        }
        value={form.botToken}
        onChange={form.setBotToken}
        disabled={!on}
        isSet={form.botTokenSet}
        savedLabel={t("alerts.channels.secret_saved")}
        placeholder={
          form.botTokenSet
            ? t("alerts.channels.discord.token_keep")
            : t("alerts.channels.discord.token_placeholder")
        }
        autoComplete="off"
        showLabel={t("alerts.channels.discord.token_show")}
        hideLabel={t("alerts.channels.discord.token_hide")}
      />
      <ThresholdField
        id="discord-threshold"
        value={form.discordThreshold}
        onChange={form.setDiscordThreshold}
        disabled={!on}
        invalid={on && !!form.errors.discordThreshold}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Shared rows
// -----------------------------------------------------------------------------

/** Each channel counts the SAME outage against its OWN wait; say only that. */
function ThresholdField({
  id,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  const { t } = useTranslation("common");
  return (
    <ChannelField
      id={id}
      label={t("alerts.channels.threshold_label")}
      hint={t("alerts.channels.threshold_hint")}
      error={invalid ? t("alerts.channels.threshold_error") : undefined}
      value={value}
      onChange={onChange}
      disabled={disabled}
      type="number"
      inputMode="numeric"
      min="1"
      max="60"
      placeholder="5"
      numeric
      narrow
      unit={t("alerts.channels.threshold_unit")}
    />
  );
}

function ExternalHint({
  text,
  href,
  linkLabel,
}: {
  text: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <>
      {text}{" "}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
      >
        {linkLabel}
        <ExternalLinkIcon className="size-3" aria-hidden />
      </a>
    </>
  );
}

function TestAction({
  label,
  blockedReason,
  isSending,
  sendingLabel,
  sentLabel,
  sentTo,
  fault,
  onSend,
}: {
  label: string;
  blockedReason: string | null;
  isSending: boolean;
  sendingLabel: string;
  sentLabel: string;
  sentTo: string | null;
  fault: string | null;
  onSend: () => void;
}) {
  return (
    // No `mt-auto`: the slack belongs AFTER the channel's own block, not wedged
    // between its fields and its action.
    <div className="flex flex-col gap-2.5 pt-1">
      {fault ? (
        <ChannelNotice tone="destructive" icon={AlertCircleIcon} live>
          {fault}
        </ChannelNotice>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="tonal-neutral"
          className={CHANNEL_BUTTON}
          disabled={!!blockedReason || isSending}
          onClick={onSend}
        >
          {isSending ? (
            <>
              <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
              {sendingLabel}
            </>
          ) : (
            <>
              <SendIcon className="size-4" />
              {label}
            </>
          )}
        </Button>
        {sentTo && !isSending ? (
          <span className="flex min-w-0 items-center gap-2">
            <Badge variant="success">
              <CheckCircle2Icon className="size-3" />
              {sentLabel}
            </Badge>
            <span className="text-on-surface-variant truncate font-mono text-xs">
              {sentTo}
            </span>
          </span>
        ) : null}
      </div>
      {blockedReason && !isSending ? (
        <p className={FIELD.HINT}>{blockedReason}</p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// MailerInstall — email delivery waits on msmtp; SMS and Discord still save.
// -----------------------------------------------------------------------------
function MailerInstall({ hook }: { hook: UseAlertsReturn }) {
  const { t } = useTranslation("common");
  const { installResult } = hook;
  const running = installResult.status === "running";
  return (
    <div className="flex flex-col gap-2.5">
      <ChannelNotice tone="warning" icon={TriangleAlertIcon}>
        {t("alerts.channels.email.mailer_missing")}
      </ChannelNotice>
      {installResult.status === "error" ? (
        <ChannelNotice tone="destructive" icon={AlertCircleIcon} live>
          {installResult.detail || installResult.message}
        </ChannelNotice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          type="button"
          className={CHANNEL_BUTTON}
          onClick={hook.runInstall}
          disabled={running}
        >
          {running ? (
            <>
              <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
              {t("alerts.channels.email.mailer_installing")}
            </>
          ) : (
            <>
              <DownloadIcon className="size-4" />
              {t("alerts.channels.email.mailer_install")}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="tonal-neutral"
          className={CHANNEL_BUTTON}
          onClick={hook.refresh}
          disabled={running}
        >
          <RefreshCcwIcon className="size-4" />
          {t("alerts.channels.email.mailer_recheck")}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SaveStatus — the four truthful states of the bar's left half.
// -----------------------------------------------------------------------------
function SaveStatus({
  isDirty,
  blocked,
  saved,
  blockedNames,
}: {
  isDirty: boolean;
  blocked: boolean;
  saved: boolean;
  blockedNames: string[];
}) {
  const { t } = useTranslation("common");

  if (isDirty && blocked) {
    return (
      <p className={cn(SAVEBAR.STATUS, "text-destructive-on-surface min-w-0")}>
        <AlertCircleIcon className="size-3.5 flex-none" aria-hidden />
        <span className="truncate font-medium">
          {blockedNames.length > 0
            ? t("alerts.channels.save.blocked_in", {
                channels: blockedNames.join(", "),
              })
            : t("alerts.channels.save.blocked")}
        </span>
      </p>
    );
  }
  if (isDirty) {
    return (
      <p className={cn(SAVEBAR.STATUS, "min-w-0")}>
        <span className={SAVEBAR.PULSE} aria-hidden />
        <span className="text-on-surface truncate font-medium">
          {t("alerts.channels.save.dirty")}
        </span>
      </p>
    );
  }
  if (saved) {
    return (
      <p className={cn(SAVEBAR.STATUS, "text-success-on-surface min-w-0")}>
        <CheckCircle2Icon className="size-3.5 flex-none" aria-hidden />
        <span className="truncate font-medium">
          {t("alerts.channels.save.saved")}
        </span>
      </p>
    );
  }
  return (
    <p className={cn(SAVEBAR.STATUS, "min-w-0")}>
      <span className="truncate">{t("alerts.channels.save.clean")}</span>
    </p>
  );
}

// -----------------------------------------------------------------------------
// The empty / error condition. It IS the state, so it takes the fill region.
// -----------------------------------------------------------------------------
function ChannelsCondition({
  tone,
  title,
  description,
  actionLabel,
  onAction,
}: {
  tone: ConditionTone;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const skin = CONDITION_TONE[tone];
  return (
    <div
      role="status"
      className={cn(
        CONDITION.ROOT,
        skin.ROOT,
        CARD_FILL_REGION,
        "justify-center",
      )}
    >
      <span aria-hidden className={cn(CONDITION.DISC, skin.DISC)}>
        {tone === "destructive" ? (
          <AlertCircleIcon className={CONDITION.GLYPH} />
        ) : (
          <MinusCircleIcon className={CONDITION.GLYPH} />
        )}
      </span>
      <span className={CONDITION.TITLE}>{title}</span>
      <p className={CONDITION.DESC}>{description}</p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onAction}
          className={cn(CONDITION.ACTION, skin.ACTION)}
        >
          <RefreshCcwIcon className="size-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// The loading state. Geometry comes from the same constants the loaded view
// reads, and the fill region is in the same place (Skeleton-Mirror).
// -----------------------------------------------------------------------------
export function AlertsSettingsCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card
      className={cn(CARD_SHELL, CARD_FILL)}
      role="status"
      aria-busy="true"
      aria-label={t("alerts.channels.loading")}
    >
      <CardHeader className={CARD_PAD}>
        <div className={CARD_HEAD}>
          <div className="min-w-0 space-y-1">
            <CardTitle className={CARD_TITLE}>
              {t("alerts.channels.title")}
            </CardTitle>
            <CardDescription className={CARD_DESC}>
              {t("alerts.channels.description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex min-h-0 flex-1 flex-col gap-5")}>
        <div className={RAIL.ROOT} aria-hidden>
          {ALERT_CHANNEL_ORDER.map((ch) => (
            <Skeleton key={ch} className={cn(RAIL.PILL, "w-[5.5rem]")} />
          ))}
        </div>

        <div className={cn(CARD_FILL_REGION, "flex flex-col gap-5")} aria-hidden>
          <Skeleton className={cn(SKELETON.SWITCH, "w-full")} />
          {[0, 1].map((i) => (
            <div key={i} className={FIELD.ROW}>
              <Skeleton className={cn(SKELETON.LINE, "h-4 w-32")} />
              <Skeleton className={cn(SKELETON.FIELD, "w-full")} />
              <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-56")} />
            </div>
          ))}
          <div className="pt-1">
            <Skeleton className={cn(CHANNEL_BUTTON, "w-44")} />
          </div>
        </div>

        <div className={SAVEBAR.ROOT} aria-hidden>
          <Skeleton className={cn(SKELETON.LINE, "h-4 w-36")} />
          <div className={SAVEBAR.ACTIONS}>
            <Skeleton className={cn(CHANNEL_BUTTON, "w-24")} />
            <Skeleton className={cn(CHANNEL_BUTTON, "w-36")} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
