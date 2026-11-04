"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MinusCircleIcon,
  RefreshCcwIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { Checkbox } from "@/components/ui/checkbox";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { SaveButton } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { UseAlertsReturn } from "@/hooks/use-alerts";
import {
  ALERT_CHANNEL_ORDER,
  ALERT_EVENT_ORDER,
  type AlertChannel,
  type AlertsState,
} from "@/types/alerts";

import {
  ChannelField,
  ChannelNotice,
  ChannelPanelHead,
  ChannelSecretField,
} from "./channel-field";
import { ChannelRail, panelId, tabId, type ChannelRailItem } from "./channel-rail";
import { eventNameKey, reasonKey, saveErrorKey, testErrorKey } from "./constants";
import { confirmedInput, deriveCoverage, readCapability } from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  CROSSFADE_STACK,
  FIELD,
  FOOT,
  PANEL,
  RAIL,
  SKELETON,
  TICK_ROW,
  WAIT_ROW,
  type ConditionTone,
} from "./shapes";
import { blockedChannelMap, useAlertsForm, type AlertsForm } from "./use-alerts-form";

const ID_BASE = "alert-channel";
const WAIT_ID = "alert-wait";

/** What went wrong last, and where it belongs on screen. */
type ActionFault =
  | { scope: "save"; message: string }
  | { scope: "test"; channel: AlertChannel; message: string };

export interface AlertsSettingsCardProps {
  state: AlertsState;
  hook: UseAlertsReturn;
  /** Called after a test so the activity card silently refreshes. */
  onTested: () => void;
}

// -----------------------------------------------------------------------------
// The three-channel write surface: the one wait, the rail, one channel's panel
// (switch, the events it sends, its fields) and ONE atomic Save in the foot.
// -----------------------------------------------------------------------------
export function AlertsSettingsCard({ state, hook, onTested }: AlertsSettingsCardProps) {
  const { t } = useTranslation("common");
  const form = useAlertsForm({ state, isSaving: hook.isSaving });
  const [channel, setChannel] = useState<AlertChannel>("sms");
  const [fault, setFault] = useState<ActionFault | null>(null);

  // The rail reports SAVED truth, never the half-edited form (State-Honesty).
  const coverage = useMemo(() => deriveCoverage(confirmedInput(state)), [state]);
  const channelBlocked = blockedChannelMap(form);

  const channelName: Record<AlertChannel, string> = {
    sms: t("alerts.channels.name.sms"),
    email: t("alerts.channels.name.email"),
    discord: t("alerts.channels.name.discord"),
  };

  const railItems: ChannelRailItem[] = ALERT_CHANNEL_ORDER.map((ch) => ({
    channel: ch,
    label: channelName[ch],
    status: channelBlocked[ch] ? "incomplete" : coverage.channels[ch].status,
    // A saved-but-incomplete channel is "needs setup" until the user edits something.
    statusLabel: channelBlocked[ch]
      ? t(form.isDirty ? "alerts.channels.status.needs_fixing" : "alerts.channels.status.incomplete")
      : t(`alerts.channels.status.${coverage.channels[ch].status}`),
  }));

  const blockedNames = ALERT_CHANNEL_ORDER.filter((ch) => channelBlocked[ch]).map(
    (ch) => channelName[ch],
  );

  const handleSave = async () => {
    if (form.blocked) return;
    setFault(null);
    const result = await hook.saveSettings(form.buildPayload());
    if (!result.ok) {
      const message = t(saveErrorKey(result.code));
      setFault({ scope: "save", message });
      toast.error(message);
      return;
    }
    // GET never returns a secret, so a rotation moves no watched value: clearing is what settles `isDirty`.
    form.setAppPassword("");
    form.setBotToken("");
    form.markSaved();
    toast.success(t("alerts.channels.save.succeeded"));
  };

  // Runs against the SAVED config on the device.
  const handleTest = async (ch: AlertChannel) => {
    setFault(null);
    const result = await hook.sendTest(ch);
    if (result.ok) {
      toast.success(t("alerts.channels.test.succeeded", { channel: channelName[ch] }));
    } else {
      const message = t(testErrorKey(ch, result.code));
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

  const blockedText =
    blockedNames.length > 0
      ? t("alerts.channels.save.blocked_in", { channels: blockedNames.join(", ") })
      : t("alerts.channels.save.blocked");
  // Only while dirty: a disabled Save takes no pointer events, so a reason there is unreachable.
  const saveBlockedReason = form.isDirty && form.blocked ? blockedText : null;

  const testReason = testBlockedReason(channel);
  const testing = hook.testingChannel === channel;
  const visibleFault =
    fault?.scope === "save" || (fault?.scope === "test" && fault.channel === channel)
      ? fault.message
      : null;

  return (
    <Card className={CARD_SHELL}>
      <ChannelsHeader />

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
        <WaitRow form={form} />

        <ChannelRail
          label={t("alerts.channels.rail_label")}
          items={railItems}
          value={channel}
          onValueChange={setChannel}
          idBase={ID_BASE}
        />

        {/* Outgoing and incoming panels share one grid cell, so the crossfade shifts nothing. */}
        <div className={CROSSFADE_STACK}>
          <AnimatePresence initial={false}>
            <motion.div
              key={channel}
              role="tabpanel"
              id={panelId(ID_BASE, channel)}
              aria-labelledby={tabId(ID_BASE, channel)}
              className={PANEL.ROOT}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transitionStandard}
            >
              <div className={PANEL.COL}>
                <ChannelPanelHead
                  title={t(`alerts.channels.${channel}.title`)}
                  description={t(`alerts.channels.${channel}.sub`)}
                  checked={enabledOf(form, channel)}
                  onCheckedChange={(v) => setEnabled(form, channel, v)}
                />
                <SendsFor form={form} state={state} channel={channel} />
              </div>
              <div className={PANEL.COL}>
                {channel === "sms" ? (
                  <SmsFields form={form} />
                ) : channel === "email" ? (
                  <EmailFields form={form} state={state} hook={hook} />
                ) : (
                  <DiscordFields form={form} />
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {visibleFault ? (
          <ChannelNotice tone="destructive" icon={AlertCircleIcon} live>
            {visibleFault}
          </ChannelNotice>
        ) : null}
      </CardContent>

      <CardFoot
        className={CARD_PAD}
        status={
          <SaveStatus
            isDirty={form.isDirty}
            blocked={form.blocked}
            blockedText={blockedText}
            idleText={testing ? null : testReason}
          />
        }
        actions={
          <>
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              disabled={!!testReason || testing}
              onClick={() => handleTest(channel)}
            >
              {testing ? (
                <>
                  <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />
                  {t("alerts.channels.test.sending")}
                </>
              ) : (
                <>
                  <SendIcon className="size-4" aria-hidden />
                  {t(`alerts.channels.${channel}.test`)}
                </>
              )}
            </Button>
            {form.isDirty ? (
              <Button
                type="button"
                variant="ghost"
                size="action"
                className="text-on-surface-variant"
                onClick={form.discard}
                disabled={form.isSaving}
              >
                {t("alerts.channels.save.discard")}
              </Button>
            ) : null}
            <SaveButton
              type="button"
              size="action"
              label={t("alerts.channels.save.action")}
              isSaving={form.isSaving}
              saved={form.saved}
              blockedReason={saveBlockedReason}
              disabled={!form.isDirty || form.isSaving}
              onClick={handleSave}
            />
          </>
        }
      />
    </Card>
  );
}

function ChannelsHeader() {
  const { t } = useTranslation("common");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t("alerts.channels.title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("alerts.channels.description")}
      </CardDescription>
    </CardHeader>
  );
}

function enabledOf(form: AlertsForm, channel: AlertChannel): boolean {
  if (channel === "sms") return form.smsEnabled;
  if (channel === "email") return form.emailEnabled;
  return form.discordEnabled;
}

function setEnabled(form: AlertsForm, channel: AlertChannel, v: boolean) {
  if (channel === "sms") form.setSmsEnabled(v);
  else if (channel === "email") form.setEmailEnabled(v);
  else form.setDiscordEnabled(v);
}

// -----------------------------------------------------------------------------
// The one alert wait. Sent as every channel's `threshold_minutes`.
// -----------------------------------------------------------------------------
function WaitRow({ form }: { form: AlertsForm }) {
  const { t } = useTranslation("common");
  const invalid = !!form.errors.threshold;
  const noteId = `${WAIT_ID}-note`;
  return (
    <div className={WAIT_ROW.ROOT}>
      <div className={WAIT_ROW.TEXT}>
        <label htmlFor={WAIT_ID} className={WAIT_ROW.TITLE}>
          {t("alerts.channels.threshold_label")}
        </label>
        <p id={noteId} className={WAIT_ROW.HINT}>
          {t("alerts.channels.threshold_hint")}
        </p>
      </div>
      <div className={WAIT_ROW.FIELD_COL}>
        <div className={WAIT_ROW.FIELD}>
          <Input
            id={WAIT_ID}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="5"
            value={form.threshold}
            onChange={(e) => form.setThreshold(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${WAIT_ID}-error` : noteId}
            className={cn(FIELD.SHELL, FIELD.INVALID, WAIT_ROW.INPUT)}
          />
          <span aria-hidden className={WAIT_ROW.UNIT}>
            {t("alerts.channels.threshold_unit")}
          </span>
        </div>
        {invalid ? (
          <p id={`${WAIT_ID}-error`} className={FIELD.ERROR}>
            {t("alerts.channels.threshold_error")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The events this channel sends. Capability comes from the API, never a literal.
// -----------------------------------------------------------------------------
function SendsFor({
  form,
  state,
  channel,
}: {
  form: AlertsForm;
  state: AlertsState;
  channel: AlertChannel;
}) {
  const { t } = useTranslation("common");
  return (
    <>
      <p className={PANEL.SECTION_LABEL}>{t("alerts.channels.sends_for")}</p>
      <div className={PANEL.TICKS}>
        {ALERT_EVENT_ORDER.map((event) => {
          const name = t(eventNameKey(event));
          const { capable, reason } = readCapability(state.capabilities, event, channel);
          if (!capable) {
            return (
              <div key={event} className={TICK_ROW.ROOT}>
                <span>{name}</span>
                <span className={TICK_ROW.REASON}>{t(reasonKey(reason))}</span>
              </div>
            );
          }
          const id = `${ID_BASE}-${channel}-${event}`;
          return (
            <label
              key={event}
              htmlFor={id}
              className={cn(TICK_ROW.ROOT, TICK_ROW.INTERACTIVE)}
            >
              <span>{name}</span>
              <Checkbox
                id={id}
                checked={form.getRoute(event, channel)}
                onCheckedChange={(v) => form.setRoute(event, channel, v === true)}
                className={cn(TICK_ROW.BOX, "focus-visible:ring-0")}
              />
            </label>
          );
        })}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Per-channel fields
// -----------------------------------------------------------------------------
function SmsFields({ form }: { form: AlertsForm }) {
  const { t } = useTranslation("common");
  const on = form.smsEnabled;
  return (
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
  );
}

function EmailFields({
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
      {!state.channels.email.msmtp_installed ? <MailerInstall hook={hook} /> : null}
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
          form.missing.appPassword ? t("alerts.channels.email.password_missing") : undefined
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
    </>
  );
}

function DiscordFields({ form }: { form: AlertsForm }) {
  const { t } = useTranslation("common");
  const on = form.discordEnabled;
  return (
    <>
      <ChannelField
        id="discord-id"
        label={t("alerts.channels.discord.id_label")}
        labelAddon={
          <HintIcon label={t("alerts.channels.discord.id_hint_label")}>
            {t("alerts.channels.discord.id_hint")}
          </HintIcon>
        }
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
          form.missing.botToken ? t("alerts.channels.discord.token_missing") : undefined
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
    </>
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
        className="text-primary-on-surface inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
      >
        {linkLabel}
        <ExternalLinkIcon className="size-3" aria-hidden />
      </a>
    </>
  );
}

// Email delivery waits on msmtp; SMS and Discord still save.
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
        <Button type="button" size="action" onClick={hook.runInstall} disabled={running}>
          {running ? (
            <>
              <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />
              {t("alerts.channels.email.mailer_installing")}
            </>
          ) : (
            <>
              <DownloadIcon className="size-4" aria-hidden />
              {t("alerts.channels.email.mailer_install")}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="tonal-neutral"
          size="action"
          onClick={() => hook.refresh()}
          disabled={running}
        >
          <RefreshCcwIcon className="size-4" aria-hidden />
          {t("alerts.channels.email.mailer_recheck")}
        </Button>
      </div>
    </div>
  );
}

// The foot's left edge: blocked, unsaved, or (clean) why the test is unavailable.
function SaveStatus({
  isDirty,
  blocked,
  blockedText,
  idleText,
}: {
  isDirty: boolean;
  blocked: boolean;
  blockedText: string;
  idleText: string | null;
}) {
  const { t } = useTranslation("common");

  if (isDirty && blocked) {
    return (
      <span className={cn(FOOT.LINE, "text-destructive-on-surface")}>
        <AlertCircleIcon className="size-3.5 flex-none" aria-hidden />
        <span className="font-medium text-pretty">{blockedText}</span>
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className={FOOT.LINE}>
        <span className={FOOT.DOT} aria-hidden />
        <span className="text-on-surface font-medium text-pretty">
          {t("alerts.channels.save.dirty")}
        </span>
      </span>
    );
  }
  return (
    <span className="text-on-surface-variant text-pretty">
      {idleText ?? t("alerts.channels.save.clean")}
    </span>
  );
}

// -----------------------------------------------------------------------------
// The no-channels condition, and the loading state (Skeleton-Mirror).
// -----------------------------------------------------------------------------
export function AlertsChannelsCondition({
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
    <Card className={CARD_SHELL}>
      <ChannelsHeader />
      <CardContent className={CARD_PAD}>
        <div role="status" className={cn(CONDITION.ROOT, skin.ROOT)}>
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
              <RefreshCcwIcon className="size-4" aria-hidden />
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function AlertsSettingsCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card
      className={CARD_SHELL}
      role="status"
      aria-busy="true"
      aria-label={t("alerts.channels.loading")}
    >
      <ChannelsHeader />
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")} aria-hidden>
        <div className={WAIT_ROW.ROOT}>
          <div className={WAIT_ROW.TEXT}>
            <Skeleton className={cn(SKELETON.LINE, "h-4 w-36")} />
            <Skeleton className={cn(SKELETON.LINE, "h-3.5 w-52")} />
          </div>
          <Skeleton className={cn(SKELETON.FIELD, "w-[8.5rem]")} />
        </div>
        <div className={RAIL.ROOT}>
          {ALERT_CHANNEL_ORDER.map((ch) => (
            <Skeleton key={ch} className={cn(RAIL.PILL, "w-[5.5rem]")} />
          ))}
        </div>
        <div className={PANEL.ROOT}>
          <div className={PANEL.COL}>
            <Skeleton className={cn(SKELETON.ACTION, "w-full")} />
            <div className={PANEL.TICKS}>
              {ALERT_EVENT_ORDER.map((ev) => (
                <Skeleton key={ev} className={SKELETON.TICK_ROW} />
              ))}
            </div>
          </div>
          <div className={PANEL.COL}>
            {[0, 1].map((i) => (
              <div key={i} className={FIELD.ROW}>
                <Skeleton className={cn(SKELETON.LINE, "h-4 w-32")} />
                <Skeleton className={cn(SKELETON.FIELD, "w-full")} />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
      <CardFoot
        className={CARD_PAD}
        liveStatus={false}
        aria-hidden="true"
        status={<Skeleton className={cn(SKELETON.LINE, "h-4 w-36")} />}
        actions={<Skeleton className={cn(SKELETON.ACTION, "w-36")} />}
      />
    </Card>
  );
}
