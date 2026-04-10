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
import { Loader2, SendIcon, AlertCircle, RefreshCcwIcon } from "lucide-react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  useSmsAlerts,
  type SmsAlertsSavePayload,
  type SmsAlertsSettings,
} from "@/hooks/use-sms-alerts";

// =============================================================================
// SmsAlertsSettingsCard — Toggle + Configuration Form
// =============================================================================

// E.164-ish: optional leading +, first digit 1–9, total 7–15 digits
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

interface SmsAlertsSettingsCardProps {
  onTestSmsSent?: () => void;
}

const SmsAlertsSettingsCard = ({ onTestSmsSent }: SmsAlertsSettingsCardProps) => {
  const {
    settings,
    isLoading,
    isSaving,
    isSendingTest,
    error,
    saveSettings,
    sendTestSms,
    refresh,
  } = useSmsAlerts();

  // --- Local form state (synced from server data during render) -------------
  const { saved, markSaved } = useSaveFlash();
  const [prevSettings, setPrevSettings] = useState<SmsAlertsSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [thresholdMinutes, setThresholdMinutes] = useState("5");

  if (settings && settings !== prevSettings) {
    setPrevSettings(settings);
    setIsEnabled(settings.enabled);
    setRecipientPhone(settings.recipient_phone);
    setThresholdMinutes(String(settings.threshold_minutes));
  }

  // --- Validation ------------------------------------------------------------
  const phoneError =
    recipientPhone && !PHONE_REGEX.test(recipientPhone)
      ? "Include country code, e.g. +14155551234"
      : null;

  const thresholdError =
    thresholdMinutes &&
    (isNaN(Number(thresholdMinutes)) ||
      Number(thresholdMinutes) < 1 ||
      Number(thresholdMinutes) > 60)
      ? "Duration must be 1\u201360 minutes"
      : null;

  const hasValidationErrors = !!(phoneError || thresholdError);

  // --- Dirty check -----------------------------------------------------------
  const isDirty = settings
    ? isEnabled !== settings.enabled ||
      recipientPhone !== settings.recipient_phone ||
      thresholdMinutes !== String(settings.threshold_minutes)
    : false;

  const canSave = !hasValidationErrors && isDirty && !isSaving && !isSendingTest;

  // --- Handlers --------------------------------------------------------------
  const handleToggle = (checked: boolean) => {
    setIsEnabled(checked);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const payload: SmsAlertsSavePayload = {
      action: "save_settings",
      enabled: isEnabled,
      recipient_phone: recipientPhone,
      threshold_minutes: parseInt(thresholdMinutes, 10),
    };

    const success = await saveSettings(payload);
    if (success) {
      markSaved();
      toast.success("SMS alert settings saved");
    } else {
      toast.error(error || "Failed to save SMS alert settings");
    }
  };

  const handleSendTest = async () => {
    const success = await sendTestSms();
    if (success) {
      toast.success("Test SMS sent successfully");
    } else {
      toast.error("Failed to send test SMS — check your configuration");
    }
    onTestSmsSent?.();
  };

  // Test button enabled only when fully configured and saved
  const canSendTest =
    settings?.enabled &&
    !!settings?.recipient_phone &&
    PHONE_REGEX.test(recipientPhone) &&
    !isSaving &&
    !isSendingTest;

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>SMS Alert Settings</CardTitle>
          <CardDescription>
            Sends SMS via your modem&apos;s cellular network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-56" />
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
          <CardTitle>SMS Alert Settings</CardTitle>
          <CardDescription>
            Sends SMS via your modem&apos;s cellular network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load settings</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => refresh()}>
                <RefreshCcwIcon className="size-3.5" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>SMS Alert Settings</CardTitle>
        <CardDescription>
          Sends SMS via your modem&apos;s cellular network.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <FieldGroup>
              {/* Enable toggle */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="sms-alerts-enabled">
                  Enable SMS Alerts
                </FieldLabel>
                <Switch
                  id="sms-alerts-enabled"
                  checked={isEnabled}
                  onCheckedChange={handleToggle}
                />
              </Field>

              {/* Recipient phone */}
              <Field>
                <FieldLabel htmlFor="recipient-phone">
                  Recipient Phone
                </FieldLabel>
                <Input
                  id="recipient-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+14155551234"
                  className="max-w-sm font-mono"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!phoneError}
                  aria-describedby={
                    phoneError ? "recipient-phone-error" : "recipient-phone-desc"
                  }
                  autoComplete="tel"
                />
                {phoneError ? (
                  <FieldError id="recipient-phone-error">
                    {phoneError}
                  </FieldError>
                ) : (
                  <FieldDescription id="recipient-phone-desc">
                    Include the country code with a leading +, e.g. +14155551234.
                  </FieldDescription>
                )}
              </Field>

              {/* Threshold duration */}
              <Field>
                <FieldLabel htmlFor="sms-threshold-minutes">
                  Alert After (minutes)
                </FieldLabel>
                <Input
                  id="sms-threshold-minutes"
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
                    thresholdError ? "sms-threshold-error" : "sms-threshold-desc"
                  }
                />
                {thresholdError ? (
                  <FieldError id="sms-threshold-error">
                    {thresholdError}
                  </FieldError>
                ) : (
                  <FieldDescription id="sms-threshold-desc">
                    How long the connection must be down before an alert is
                    sent. Prevents alerts for brief, transient outages.
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
                        Sending&hellip;
                      </>
                    ) : (
                      <>
                        <SendIcon className="size-4" />
                        Send Test SMS
                      </>
                    )}
                  </Button>
                </div>
                {isDirty && !canSendTest && isEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Save your changes before sending a test SMS.
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

export default SmsAlertsSettingsCard;
