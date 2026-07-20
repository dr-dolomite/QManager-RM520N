"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useReducedMotion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CopyableCommand } from "@/components/ui/copyable-command";
import {
  Loader2,
  EyeIcon,
  EyeOffIcon,
  SendIcon,
  PackageIcon,
  RefreshCcwIcon,
  CheckIcon,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AlertsState, AlertChannel } from "@/types/alerts";
import type { UseAlertsReturn } from "@/hooks/use-alerts";
import type { AlertsForm } from "./use-alerts-form";
import { AlertRoutingGrid } from "./alert-routing-grid";

type SettingsTab = "routing" | "sms" | "email" | "discord";

const TAB_LABEL: Record<SettingsTab, string> = {
  routing: "Routing",
  sms: "SMS",
  email: "Email",
  discord: "Discord",
};

interface AlertsSettingsCardProps {
  form: AlertsForm;
  state: AlertsState;
  hook: UseAlertsReturn;
  /** Bumped after a successful test so the log card silently refreshes. */
  onTested: () => void;
}

// -----------------------------------------------------------------------------
// AlertsSettingsCard — one card, four tabs (Routing / SMS / Email / Discord),
// one atomic Save. The sticky bar commits every pending change on the page
// regardless of the visible tab; each tab shows a destructive dot when a field
// on it is invalid, and a blocked Save jumps to the first offending tab + focuses
// it.
// -----------------------------------------------------------------------------
export function AlertsSettingsCard({
  form,
  state,
  hook,
  onTested,
}: AlertsSettingsCardProps) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<SettingsTab>("routing");
  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const { errors, missing, smsEnabled, emailEnabled, discordEnabled } = form;

  // ── Per-tab error state ────────────────────────────────────────────────────
  const smsHasError =
    (smsEnabled && (!!errors.smsPhone || !!errors.smsThreshold)) ||
    missing.smsPhone;
  const emailHasError =
    (emailEnabled &&
      (!!errors.senderEmail ||
        !!errors.recipientEmail ||
        !!errors.emailThreshold)) ||
    missing.senderEmail ||
    missing.recipientEmail ||
    missing.appPassword;
  const discordHasError =
    (discordEnabled && (!!errors.discordId || !!errors.discordThreshold)) ||
    missing.discordId ||
    missing.botToken;

  const tabErrors: Record<SettingsTab, boolean> = {
    routing: false,
    sms: smsHasError,
    email: emailHasError,
    discord: discordHasError,
  };

  // ── Focus-first-invalid on a blocked save ──────────────────────────────────
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      fieldRefs.current[id] = el;
    },
    [],
  );
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(
    null,
  );
  useEffect(() => {
    if (!focusReq) return;
    const raf = requestAnimationFrame(() => {
      const el = fieldRefs.current[focusReq.id];
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({
          block: "center",
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [focusReq, reduceMotion]);

  const orderedErrors: { tab: SettingsTab; id: string; present: boolean }[] = [
    {
      tab: "sms",
      id: "sms-phone",
      present: (smsEnabled && !!errors.smsPhone) || missing.smsPhone,
    },
    { tab: "sms", id: "sms-threshold", present: smsEnabled && !!errors.smsThreshold },
    {
      tab: "email",
      id: "sender-email",
      present: (emailEnabled && !!errors.senderEmail) || missing.senderEmail,
    },
    {
      tab: "email",
      id: "recipient-email",
      present:
        (emailEnabled && !!errors.recipientEmail) || missing.recipientEmail,
    },
    { tab: "email", id: "app-password", present: missing.appPassword },
    {
      tab: "email",
      id: "email-threshold",
      present: emailEnabled && !!errors.emailThreshold,
    },
    {
      tab: "discord",
      id: "discord-id",
      present: (discordEnabled && !!errors.discordId) || missing.discordId,
    },
    { tab: "discord", id: "bot-token", present: missing.botToken },
    {
      tab: "discord",
      id: "discord-threshold",
      present: discordEnabled && !!errors.discordThreshold,
    },
  ];

  const handleSave = async () => {
    if (form.blocked) {
      const first = orderedErrors.find((f) => f.present);
      if (first) {
        setTab(first.tab);
        setFocusReq((prev) => ({ id: first.id, n: (prev?.n ?? 0) + 1 }));
      }
      return;
    }
    const ok = await hook.saveSettings(form.buildPayload());
    if (ok) {
      form.markSaved();
      toast.success("Alert settings saved");
    } else {
      toast.error(hook.error || "Failed to save alert settings");
    }
  };

  const erroredTabNames = (["routing", "sms", "email", "discord"] as const)
    .filter((tk) => tabErrors[tk])
    .map((tk) => TAB_LABEL[tk]);

  // ── Test gating (tests run against SAVED config on the device) ─────────────
  const canTestSms =
    state.channels.sms.enabled &&
    state.channels.sms.configured &&
    !form.isDirty &&
    hook.testingChannel === null;
  const canTestEmail =
    state.channels.email.enabled &&
    state.channels.email.configured &&
    state.channels.email.msmtp_installed &&
    !form.isDirty &&
    hook.testingChannel === null;
  const canTestDiscord =
    state.channels.discord.enabled &&
    state.channels.discord.configured &&
    state.channels.discord.connected &&
    !form.isDirty &&
    hook.testingChannel === null;

  const handleTest = async (channel: AlertChannel) => {
    const ok = await hook.sendTest(channel);
    const label =
      channel === "sms" ? "SMS" : channel === "email" ? "email" : "Discord";
    if (ok) toast.success(`Test ${label} sent successfully`);
    else
      toast.error(
        hook.error || `Failed to send test ${label} — check your configuration`,
      );
    onTested();
  };

  const msmtpInstalled = state.channels.email.msmtp_installed;

  return (
    <Card className="@container/card min-h-0 flex-1">
      <CardHeader>
        <CardTitle>Alert Settings</CardTitle>
        <CardDescription>
          Choose which events reach each channel, then configure SMS, email, and
          Discord.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
          className="min-h-0 flex-1"
        >
          <TabsList className="w-full">
            {(["routing", "sms", "email", "discord"] as const).map((tk) => (
              <TabsTrigger key={tk} value={tk} className="gap-1.5">
                {TAB_LABEL[tk]}
                {tabErrors[tk] && (
                  <span
                    aria-label="This tab has fields that need attention"
                    className="bg-destructive size-1.5 rounded-full"
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ================= ROUTING ================= */}
          <TabsContent
            value="routing"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <p className="text-muted-foreground mb-4 text-sm">
              Pick which events go to which channel. Some combinations aren&apos;t
              possible and are shown as unavailable.
            </p>
            <div className="rounded-lg border p-4">
              <AlertRoutingGrid form={form} capabilities={state.capabilities} />
            </div>
          </TabsContent>

          {/* ================= SMS ================= */}
          <TabsContent
            value="sms"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <FieldSet>
              <FieldGroup>
                <ChannelEnableRow
                  id="sms-enabled"
                  label="Enable SMS alerts"
                  onHint="Alerts will be texted to your phone over the cellular network."
                  offHint="SMS alerts are off."
                  checked={smsEnabled}
                  onChange={form.setSmsEnabled}
                />

                <Field>
                  <FieldLabel htmlFor="sms-phone">Recipient phone</FieldLabel>
                  <Input
                    ref={registerField("sms-phone")}
                    id="sms-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+14155551234"
                    className="max-w-sm font-mono"
                    value={form.smsPhone}
                    onChange={(e) => form.setSmsPhone(e.target.value)}
                    disabled={!smsEnabled}
                    aria-invalid={smsEnabled && !!errors.smsPhone}
                    aria-describedby={
                      errors.smsPhone ? "sms-phone-error" : "sms-phone-desc"
                    }
                  />
                  {smsEnabled && errors.smsPhone ? (
                    <FieldError id="sms-phone-error">
                      Include country code, e.g. +14155551234
                    </FieldError>
                  ) : (
                    <FieldDescription id="sms-phone-desc">
                      Include the country code with a leading +, e.g.
                      +14155551234.
                    </FieldDescription>
                  )}
                </Field>

                <ThresholdField
                  id="sms-threshold"
                  registerField={registerField}
                  value={form.smsThreshold}
                  onChange={form.setSmsThreshold}
                  disabled={!smsEnabled}
                  invalid={smsEnabled && !!errors.smsThreshold}
                />

                <TestRow
                  label="Send Test SMS"
                  isSending={hook.testingChannel === "sms"}
                  canSend={canTestSms}
                  showHint={form.isDirty && smsEnabled}
                  onSend={() => handleTest("sms")}
                />
              </FieldGroup>
            </FieldSet>
          </TabsContent>

          {/* ================= EMAIL ================= */}
          <TabsContent
            value="email"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            {!msmtpInstalled && (
              <MsmtpInstallBanner
                installResult={hook.installResult}
                onInstall={hook.runInstall}
                onRefresh={hook.refresh}
              />
            )}

            <FieldSet>
              <FieldGroup>
                <ChannelEnableRow
                  id="email-enabled"
                  label="Enable email alerts"
                  onHint="Alerts will be emailed via Gmail once the connection is back."
                  offHint="Email alerts are off."
                  checked={emailEnabled}
                  onChange={form.setEmailEnabled}
                />

                <Field>
                  <FieldLabel htmlFor="sender-email">Sender email</FieldLabel>
                  <Input
                    ref={registerField("sender-email")}
                    id="sender-email"
                    type="email"
                    autoComplete="email"
                    placeholder="alerts@gmail.com"
                    className="max-w-sm"
                    value={form.senderEmail}
                    onChange={(e) => form.setSenderEmail(e.target.value)}
                    disabled={!emailEnabled}
                    aria-invalid={emailEnabled && !!errors.senderEmail}
                    aria-describedby={
                      errors.senderEmail
                        ? "sender-email-error"
                        : "sender-email-desc"
                    }
                  />
                  {emailEnabled && errors.senderEmail ? (
                    <FieldError id="sender-email-error">
                      Enter a valid email address.
                    </FieldError>
                  ) : (
                    <FieldDescription id="sender-email-desc">
                      The Gmail account that will send the alert.
                    </FieldDescription>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="recipient-email">
                    Recipient email
                  </FieldLabel>
                  <Input
                    ref={registerField("recipient-email")}
                    id="recipient-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="max-w-sm"
                    value={form.recipientEmail}
                    onChange={(e) => form.setRecipientEmail(e.target.value)}
                    disabled={!emailEnabled}
                    aria-invalid={emailEnabled && !!errors.recipientEmail}
                    aria-describedby={
                      errors.recipientEmail
                        ? "recipient-email-error"
                        : "recipient-email-desc"
                    }
                  />
                  {emailEnabled && errors.recipientEmail ? (
                    <FieldError id="recipient-email-error">
                      Enter a valid email address.
                    </FieldError>
                  ) : (
                    <FieldDescription id="recipient-email-desc">
                      Where alerts will be delivered.
                    </FieldDescription>
                  )}
                </Field>

                <SecretField
                  id="app-password"
                  registerField={registerField}
                  label="Gmail app password"
                  value={form.appPassword}
                  onChange={form.setAppPassword}
                  disabled={!emailEnabled}
                  isSet={form.appPasswordSet}
                  missing={missing.appPassword}
                  missingText="An app password is required to send email."
                  savedPlaceholder="Leave blank to keep the saved password"
                  freshPlaceholder="xxxx xxxx xxxx xxxx"
                  autoComplete="new-password"
                  show={showPassword}
                  onToggleShow={() => setShowPassword((v) => !v)}
                  showAria={showPassword ? "Hide password" : "Show password"}
                  description={
                    <>
                      Generate an{" "}
                      <a
                        href="https://myaccount.google.com/apppasswords"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-info hover:text-info/80 underline underline-offset-2"
                      >
                        App Password
                      </a>{" "}
                      in your Google Account.
                    </>
                  }
                />

                <ThresholdField
                  id="email-threshold"
                  registerField={registerField}
                  value={form.emailThreshold}
                  onChange={form.setEmailThreshold}
                  disabled={!emailEnabled}
                  invalid={emailEnabled && !!errors.emailThreshold}
                />

                <TestRow
                  label="Send Test Email"
                  isSending={hook.testingChannel === "email"}
                  canSend={canTestEmail}
                  showHint={form.isDirty && emailEnabled}
                  onSend={() => handleTest("email")}
                />
              </FieldGroup>
            </FieldSet>
          </TabsContent>

          {/* ================= DISCORD ================= */}
          <TabsContent
            value="discord"
            className="mt-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          >
            <FieldSet>
              <FieldGroup>
                <ChannelEnableRow
                  id="discord-enabled"
                  label="Enable Discord alerts"
                  onHint="Alerts will be sent as a direct message from your bot on Discord."
                  offHint="Discord alerts are off."
                  checked={discordEnabled}
                  onChange={form.setDiscordEnabled}
                />

                <Field>
                  <FieldLabel htmlFor="discord-id">Owner Discord ID</FieldLabel>
                  <Input
                    ref={registerField("discord-id")}
                    id="discord-id"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="123456789012345678"
                    className="max-w-sm font-mono"
                    value={form.discordId}
                    onChange={(e) => form.setDiscordId(e.target.value)}
                    disabled={!discordEnabled}
                    aria-invalid={discordEnabled && !!errors.discordId}
                    aria-describedby={
                      errors.discordId ? "discord-id-error" : "discord-id-desc"
                    }
                  />
                  {discordEnabled && errors.discordId ? (
                    <FieldError id="discord-id-error">
                      Enter your numeric Discord user ID (17–20 digits).
                    </FieldError>
                  ) : (
                    <FieldDescription id="discord-id-desc">
                      Your numeric Discord user ID — enable Developer Mode, then
                      right-click your name and Copy User ID.
                    </FieldDescription>
                  )}
                </Field>

                <SecretField
                  id="bot-token"
                  registerField={registerField}
                  label="Bot token"
                  value={form.botToken}
                  onChange={form.setBotToken}
                  disabled={!discordEnabled}
                  isSet={form.botTokenSet}
                  missing={missing.botToken}
                  missingText="A bot token is required to send Discord alerts."
                  savedPlaceholder="Leave blank to keep the saved token"
                  freshPlaceholder="Paste your bot token"
                  autoComplete="off"
                  show={showToken}
                  onToggleShow={() => setShowToken((v) => !v)}
                  showAria={showToken ? "Hide bot token" : "Show bot token"}
                  description={
                    <>
                      Create a bot and copy its token in the{" "}
                      <a
                        href="https://discord.com/developers/applications"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-info hover:text-info/80 underline underline-offset-2"
                      >
                        Discord Developer Portal
                      </a>
                      .
                    </>
                  }
                />

                <ThresholdField
                  id="discord-threshold"
                  registerField={registerField}
                  value={form.discordThreshold}
                  onChange={form.setDiscordThreshold}
                  disabled={!discordEnabled}
                  invalid={discordEnabled && !!errors.discordThreshold}
                />

                <TestRow
                  label="Send Test Message"
                  isSending={hook.testingChannel === "discord"}
                  canSend={canTestDiscord}
                  showHint={form.isDirty && discordEnabled}
                  onSend={() => handleTest("discord")}
                />
              </FieldGroup>
            </FieldSet>
          </TabsContent>
        </Tabs>

        {/* ---- Sticky save bar — commits every pending change on the page. ---- */}
        <div className="bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex shrink-0 items-center justify-between gap-3 rounded-b-xl border-t px-6 py-4 backdrop-blur">
          <SaveStatus
            isDirty={form.isDirty}
            blocked={form.blocked}
            saved={form.saved}
            erroredTabNames={erroredTabNames}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={form.discard}
              disabled={!form.isDirty || form.isSaving}
            >
              Discard
            </Button>
            <SaveButton
              type="button"
              size="sm"
              isSaving={form.isSaving}
              saved={form.saved}
              disabled={!form.isDirty || form.isSaving}
              onClick={handleSave}
              label="Save Settings"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// ChannelEnableRow — the state-tinted master toggle at the top of a channel tab.
// -----------------------------------------------------------------------------
function ChannelEnableRow({
  id,
  label,
  onHint,
  offHint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  onHint: string;
  offHint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors duration-300 motion-reduce:transition-none",
        checked ? "border-primary/30 bg-primary/5" : "bg-muted/20",
      )}
    >
      <Field orientation="horizontal" className="justify-between">
        <div className="grid min-w-0 gap-1">
          <FieldLabel htmlFor={id} className="m-0">
            {label}
          </FieldLabel>
          <FieldDescription>{checked ? onHint : offHint}</FieldDescription>
        </div>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onChange}
          aria-label={label}
        />
      </Field>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ThresholdField — the shared "Alert After (minutes)" numeric input.
// -----------------------------------------------------------------------------
function ThresholdField({
  id,
  registerField,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  registerField: (id: string) => (el: HTMLElement | null) => void;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  invalid: boolean;
}) {
  return (
    <Field className="@sm/card:max-w-[18rem]">
      <FieldLabel htmlFor={id}>Alert After (minutes)</FieldLabel>
      <Input
        ref={registerField(id)}
        id={id}
        type="number"
        inputMode="numeric"
        min="1"
        max="60"
        placeholder="5"
        className="tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : `${id}-desc`}
      />
      {invalid ? (
        <FieldError id={`${id}-error`}>
          Duration must be 1–60 minutes.
        </FieldError>
      ) : (
        <FieldDescription id={`${id}-desc`}>
          How long the connection must be down before an alert is sent. Prevents
          alerts for brief, transient outages.
        </FieldDescription>
      )}
    </Field>
  );
}

// -----------------------------------------------------------------------------
// SecretField — a masked, write-only credential input (Gmail app password / bot
// token). Never pre-filled; when a secret is already stored the field shows a
// "Saved · leave blank to keep" affordance and only overwrites if you type.
// -----------------------------------------------------------------------------
function SecretField({
  id,
  registerField,
  label,
  value,
  onChange,
  disabled,
  isSet,
  missing,
  missingText,
  savedPlaceholder,
  freshPlaceholder,
  autoComplete,
  show,
  onToggleShow,
  showAria,
  description,
}: {
  id: string;
  registerField: (id: string) => (el: HTMLElement | null) => void;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  isSet: boolean;
  missing: boolean;
  missingText: string;
  savedPlaceholder: string;
  freshPlaceholder: string;
  autoComplete: string;
  show: boolean;
  onToggleShow: () => void;
  showAria: string;
  description: React.ReactNode;
}) {
  return (
    <Field>
      <div className="flex items-center gap-2">
        <FieldLabel htmlFor={id} className="m-0">
          {label}
        </FieldLabel>
        {isSet && (
          <span className="bg-success/15 text-success border-success/30 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium">
            <CheckIcon className="size-2.5" />
            Saved
          </span>
        )}
      </div>
      <div className="relative max-w-sm">
        <Input
          ref={registerField(id)}
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={isSet ? savedPlaceholder : freshPlaceholder}
          className="pr-10 font-mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={missing}
          aria-describedby={`${id}-desc`}
        />
        <button
          type="button"
          aria-label={showAria}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2.5 -translate-y-1/2 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          onClick={onToggleShow}
        >
          {show ? (
            <EyeOffIcon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </button>
      </div>
      {missing ? (
        <FieldError id={`${id}-desc`}>{missingText}</FieldError>
      ) : (
        <FieldDescription id={`${id}-desc`}>{description}</FieldDescription>
      )}
    </Field>
  );
}

// -----------------------------------------------------------------------------
// TestRow — per-channel "send a real test" action, gated on a saved config.
// -----------------------------------------------------------------------------
function TestRow({
  label,
  isSending,
  canSend,
  showHint,
  onSend,
}: {
  label: string;
  isSending: boolean;
  canSend: boolean;
  showHint: boolean;
  onSend: () => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={!canSend}
        onClick={onSend}
      >
        {isSending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <SendIcon className="size-4" />
            {label}
          </>
        )}
      </Button>
      {showHint && !canSend && (
        <p className="text-muted-foreground text-xs">
          Save your changes before sending a test.
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// MsmtpInstallBanner — inline "mailer not installed" affordance. Unlike the old
// email page, this does NOT block the form: SMS, Discord + routing still save
// while the mailer is missing; only email delivery waits on the install.
// -----------------------------------------------------------------------------
function MsmtpInstallBanner({
  installResult,
  onInstall,
  onRefresh,
}: {
  installResult: UseAlertsReturn["installResult"];
  onInstall: () => void;
  onRefresh: () => void;
}) {
  const running = installResult.status === "running";
  return (
    <div className="border-warning/30 bg-warning/5 mb-5 grid gap-3 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <PackageIcon className="text-warning mt-0.5 size-5 shrink-0" />
        <div className="grid gap-0.5">
          <p className="text-sm font-medium">
            msmtp is not installed on this device.
          </p>
          <p className="text-muted-foreground text-xs">
            Install it to send email alerts. SMS, Discord and routing still save
            without it.
          </p>
        </div>
      </div>

      {installResult.status === "complete" && (
        <Alert className="border-success/30 bg-success/5">
          <AlertCircle className="text-success" />
          <AlertDescription className="text-success">
            <p>{installResult.message}</p>
          </AlertDescription>
        </Alert>
      )}
      {installResult.status === "error" && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            <p>
              {installResult.message}
              {installResult.detail && (
                <span className="mt-1 block text-xs opacity-80">
                  {installResult.detail}
                </span>
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onInstall} disabled={running}>
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {installResult.message || "Installing…"}
            </>
          ) : (
            <>
              <PackageIcon className="size-4" />
              Install msmtp
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={running}
        >
          <RefreshCcwIcon className="size-3.5" />
          Check Again
        </Button>
      </div>

      <div className="grid gap-1.5">
        <span className="text-muted-foreground text-xs">
          Or install it manually:
        </span>
        <CopyableCommand command="opkg update && opkg install msmtp" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SaveStatus — the four-state truthful save line (shared shape with Watchdog).
// -----------------------------------------------------------------------------
function SaveStatus({
  isDirty,
  blocked,
  saved,
  erroredTabNames,
}: {
  isDirty: boolean;
  blocked: boolean;
  saved: boolean;
  erroredTabNames: string[];
}) {
  if (isDirty && blocked) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="bg-destructive size-2 shrink-0 rounded-full"
          aria-hidden
        />
        <p className="text-destructive truncate text-xs font-medium">
          {erroredTabNames.length > 0
            ? `Fix the errors in ${erroredTabNames.join(", ")}`
            : "Fix the highlighted fields"}
        </p>
      </div>
    );
  }
  if (isDirty) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="relative flex size-2 shrink-0" aria-hidden>
          <span className="bg-primary/50 absolute inline-flex size-full animate-ping rounded-full motion-reduce:hidden" />
          <span className="bg-primary relative inline-flex size-2 rounded-full" />
        </span>
        <p className="truncate text-xs font-medium">Unsaved changes</p>
      </div>
    );
  }
  if (saved) {
    return (
      <div className="text-success flex min-w-0 items-center gap-1.5">
        <CheckIcon className="size-3.5 shrink-0" aria-hidden />
        <p className="truncate text-xs font-medium">Saved!</p>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground truncate text-xs">All changes saved</p>
  );
}
