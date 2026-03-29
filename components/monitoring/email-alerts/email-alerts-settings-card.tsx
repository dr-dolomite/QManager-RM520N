"use client";

import React, { useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, EyeIcon, EyeOffIcon, SendIcon, AlertCircle, RefreshCcwIcon, PackageIcon } from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  useEmailAlerts,
  type EmailAlertsSavePayload,
  type EmailAlertsSettings,
} from "@/hooks/use-email-alerts";

// =============================================================================
// EmailAlertsSettingsCard — Toggle + Configuration Form
// =============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EmailAlertsSettingsCardProps {
  onTestEmailSent?: () => void;
}

const EmailAlertsSettingsCard = ({ onTestEmailSent }: EmailAlertsSettingsCardProps) => {
  const {
    settings,
    msmtpInstalled,
    isLoading,
    isSaving,
    isSendingTest,
    error,
    saveSettings,
    sendTestEmail,
    refresh,
  } = useEmailAlerts();

  // --- Local form state (synced from server data during render) --------------
  const { saved, markSaved } = useSaveFlash();
  const [prevSettings, setPrevSettings] = useState<EmailAlertsSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [senderEmail, setSenderEmail] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [appPassword, setAppPassword] = useState(""); // never pre-filled
  const [thresholdMinutes, setThresholdMinutes] = useState("5");
  const [showPassword, setShowPassword] = useState(false);

  // Adjust state during render when server data changes (React-recommended pattern)
  if (settings && settings !== prevSettings) {
    setPrevSettings(settings);
    setIsEnabled(settings.enabled);
    setSenderEmail(settings.sender_email);
    setRecipientEmail(settings.recipient_email);
    setAppPassword(settings.app_password);
    setThresholdMinutes(String(settings.threshold_minutes));
  }

  // --- Validation ------------------------------------------------------------
  const senderEmailError =
    senderEmail && !EMAIL_REGEX.test(senderEmail)
      ? "Enter a valid email address"
      : null;

  const recipientEmailError =
    recipientEmail && !EMAIL_REGEX.test(recipientEmail)
      ? "Enter a valid email address"
      : null;

  const thresholdError =
    thresholdMinutes &&
    (isNaN(Number(thresholdMinutes)) ||
      Number(thresholdMinutes) < 1 ||
      Number(thresholdMinutes) > 60)
      ? "Duration must be 1\u201360 minutes"
      : null;

  const hasValidationErrors = !!(
    senderEmailError ||
    recipientEmailError ||
    thresholdError
  );

  // --- Dirty check -----------------------------------------------------------
  const isDirty = settings
    ? isEnabled !== settings.enabled ||
      senderEmail !== settings.sender_email ||
      recipientEmail !== settings.recipient_email ||
      thresholdMinutes !== String(settings.threshold_minutes) ||
      appPassword !== settings.app_password
    : false;

  const canSave = !hasValidationErrors && isDirty && !isSaving && !isSendingTest;

  // --- Handlers --------------------------------------------------------------
  const handleToggle = (checked: boolean) => {
    setIsEnabled(checked);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const payload: EmailAlertsSavePayload = {
      action: "save_settings",
      enabled: isEnabled,
      sender_email: senderEmail,
      recipient_email: recipientEmail,
      threshold_minutes: parseInt(thresholdMinutes, 10),
    };

    // Only include password if it changed from the saved value
    if (appPassword !== (settings?.app_password ?? "")) {
      payload.app_password = appPassword;
    }

    const success = await saveSettings(payload);
    if (success) {
      markSaved();
      toast.success("Email alert settings saved");
    } else {
      toast.error(error || "Failed to save email alert settings");
    }
  };

  const handleSendTest = async () => {
    const success = await sendTestEmail();
    if (success) {
      toast.success("Test email sent successfully");
    } else {
      toast.error("Failed to send test email — check your configuration");
    }
    // Refresh log on both success and failure — backend logs both outcomes
    onTestEmailSent?.();
  };

  // Test button enabled only when fully configured and saved
  const canSendTest =
    settings?.enabled &&
    !!settings?.app_password &&
    EMAIL_REGEX.test(senderEmail) &&
    EMAIL_REGEX.test(recipientEmail) &&
    !isSaving &&
    !isSendingTest;

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Email Alert Settings</CardTitle>
          <CardDescription>
            Sends via Gmail SMTP using an app password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <Skeleton className="h-10 w-full max-w-sm" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (initial fetch failed) ------------------------------------
  if (!isLoading && error && !settings) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Email Alert Settings</CardTitle>
          <CardDescription>
            Sends via Gmail SMTP using an app password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load settings</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refresh()}
              >
                <RefreshCcwIcon className="size-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // --- Not installed state — msmtp missing -----------------------------------
  if (!msmtpInstalled) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Email Alert Settings</CardTitle>
          <CardDescription>
            Sends via Gmail SMTP using an app password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <PackageIcon className="size-10 text-muted-foreground" />
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium">
                <code>msmtp</code> is not installed on this device.
              </p>
              <p className="text-xs text-muted-foreground">
                Install it via the terminal, then check again.
              </p>
            </div>
            <button
              type="button"
              className="bg-muted px-4 py-2.5 rounded-md text-xs font-mono text-muted-foreground select-all max-w-full overflow-x-auto text-left cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={async () => {
                const cmd = "opkg update && opkg install msmtp";
                try {
                  await navigator.clipboard.writeText(cmd);
                  toast.success("Copied to clipboard");
                } catch {
                  const textarea = document.createElement("textarea");
                  textarea.value = cmd;
                  textarea.style.position = "fixed";
                  textarea.style.opacity = "0";
                  document.body.appendChild(textarea);
                  textarea.select();
                  document.execCommand("copy");
                  document.body.removeChild(textarea);
                  toast.success("Copied to clipboard");
                }
              }}
              title="Click to copy"
            >
              opkg update &amp;&amp; opkg install msmtp
            </button>
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCcwIcon className="size-3.5" />
              Check Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Email Alert Settings</CardTitle>
        <CardDescription>
          Sends via Gmail SMTP using an app password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <FieldGroup>
              {/* Enable toggle */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="email-alerts-enabled">
                  Enable Email Alerts
                </FieldLabel>
                <Switch
                  id="email-alerts-enabled"
                  checked={isEnabled}
                  onCheckedChange={handleToggle}
                />
              </Field>

              {/* Sender email */}
              <Field>
                <FieldLabel htmlFor="sender-email">Sender Email</FieldLabel>
                <Input
                  id="sender-email"
                  type="email"
                  placeholder="alerts@gmail.com"
                  className="max-w-sm"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!senderEmailError}
                  aria-describedby={
                    senderEmailError ? "sender-email-error" : "sender-email-desc"
                  }
                  autoComplete="email"
                />
                {senderEmailError ? (
                  <FieldError id="sender-email-error">
                    {senderEmailError}
                  </FieldError>
                ) : (
                  <FieldDescription id="sender-email-desc">
                    The Gmail account that will send the alert.
                  </FieldDescription>
                )}
              </Field>

              {/* Recipient email */}
              <Field>
                <FieldLabel htmlFor="recipient-email">
                  Recipient Email
                </FieldLabel>
                <Input
                  id="recipient-email"
                  type="email"
                  placeholder="you@example.com"
                  className="max-w-sm"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!recipientEmailError}
                  aria-describedby={
                    recipientEmailError
                      ? "recipient-email-error"
                      : "recipient-email-desc"
                  }
                  autoComplete="email"
                />
                {recipientEmailError ? (
                  <FieldError id="recipient-email-error">
                    {recipientEmailError}
                  </FieldError>
                ) : (
                  <FieldDescription id="recipient-email-desc">
                    Where alerts will be delivered.
                  </FieldDescription>
                )}
              </Field>

              {/* Gmail App Password */}
              <Field>
                <FieldLabel htmlFor="app-password">
                  Gmail App Password
                </FieldLabel>
                <div className="relative max-w-sm">
                  <Input
                    id="app-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className="pr-10"
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    disabled={!isEnabled}
                    required={isEnabled}
                    autoComplete="new-password"
                    aria-describedby="app-password-desc"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
                <FieldDescription id="app-password-desc">
                  Generate an{" "}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-info underline underline-offset-2 hover:text-info/80"
                  >
                    App Password
                  </a>{" "}
                  in your Google Account.
                </FieldDescription>
              </Field>

              {/* Threshold duration */}
              <Field>
                <FieldLabel htmlFor="threshold-minutes">
                  Alert After (minutes)
                </FieldLabel>
                <Input
                  id="threshold-minutes"
                  type="number"
                  min="1"
                  max="60"
                  placeholder="5"
                  className="max-w-sm"
                  value={thresholdMinutes}
                  onChange={(e) => setThresholdMinutes(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!thresholdError}
                  aria-describedby={
                    thresholdError ? "threshold-error" : "threshold-desc"
                  }
                />
                {thresholdError ? (
                  <FieldError id="threshold-error">{thresholdError}</FieldError>
                ) : (
                  <FieldDescription id="threshold-desc">
                    How long the connection must be down before an alert is sent.
                    Prevents alerts for brief, transient outages.
                  </FieldDescription>
                )}
              </Field>

              {/* Action buttons */}
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <SaveButton
                    type="submit"
                    isSaving={isSaving}
                    saved={saved}
                    disabled={!canSave}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    disabled={!canSendTest}
                    onClick={handleSendTest}
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <SendIcon className="size-4" />
                        Send Test Email
                      </>
                    )}
                  </Button>
                </div>
                {isDirty && !canSendTest && isEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Save your changes before sending a test email.
                  </p>
                )}
              </div>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
};

export default EmailAlertsSettingsCard;
