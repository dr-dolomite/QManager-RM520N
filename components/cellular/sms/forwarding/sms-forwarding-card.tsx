"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { AlertCircleIcon, RefreshCcwIcon } from "lucide-react";
import { staggerItem } from "@/lib/motion-presets";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";
import { type SmsForwardingData } from "@/types/sms-forwarding";

// =============================================================================
// SmsForwardingCard — the control surface for the daemon-backed SMS relay.
// Setup only: enable toggle + destination number + save. Live status, the
// recipient preview, the test action, and delivery failures all live in the
// companion DeliveryHealthCard, which shares this card's lifted hook.
// =============================================================================

// E.164-ish: optional leading +, first digit 1-9, total 7-15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

const SmsForwardingCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { data, isLoading, isSaving, isSendingTest, error, saveSettings, refresh } =
    fwd;

  const { saved, markSaved } = useSaveFlash();
  const [prevData, setPrevData] = useState<SmsForwardingData | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [targetPhone, setTargetPhone] = useState("");

  // Sync server → local during render (no setState-in-effect; React-Compiler safe).
  if (data && data !== prevData) {
    setPrevData(data);
    setIsEnabled(data.settings.enabled);
    setTargetPhone(data.settings.target_phone);
  }

  // Only validate while enabling — turning forwarding off must never be blocked
  // by a stale/invalid number left in the field.
  const phoneError =
    isEnabled && targetPhone && !PHONE_REGEX.test(targetPhone)
      ? "Enter a valid phone number (e.g. +15551234567)."
      : null;

  const isDirty = data
    ? isEnabled !== data.settings.enabled ||
      targetPhone !== data.settings.target_phone
    : false;

  const canSave = !phoneError && isDirty && !isSaving && !isSendingTest;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const success = await saveSettings({
      enabled: isEnabled,
      target_phone: targetPhone,
    });
    if (success) {
      markSaved();
      toast.success("Forwarding settings saved");
    } else {
      toast.error(error || "Failed to save settings");
    }
  };

  // --- Loading skeleton ------------------------------------------------------
  // Mirrors the real form geometry (toggle row → labeled input → button) so the
  // card holds its height and nothing snaps when data lands.
  if (isLoading) {
    return (
      <Card className="@container/card h-full">
        <CardHeader>
          <CardTitle>Forwarding Relay</CardTitle>
          <CardDescription>
            Automatically forward incoming SMS to another number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            {/* Enable toggle row */}
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
            {/* Target field: label + input + helper */}
            <div className="grid gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full max-w-sm" />
              <Skeleton className="h-3 w-48" />
            </div>
            {/* Save */}
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Initial fetch error ---------------------------------------------------
  if (!isLoading && error && !data) {
    return (
      <Card className="@container/card h-full">
        <CardHeader>
          <CardTitle>Forwarding Relay</CardTitle>
          <CardDescription>
            Automatically forward incoming SMS to another number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircleIcon className="size-4" />
            <AlertTitle>Couldn&apos;t load forwarding settings</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
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

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardTitle>Forwarding Relay</CardTitle>
        <CardDescription>
          Automatically forward incoming SMS to another number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <motion.form
          className="grid gap-4"
          onSubmit={handleSave}
          variants={staggerItem}
          initial="hidden"
          animate="visible"
        >
          <FieldSet>
            <FieldGroup>
              {/* Enable toggle */}
              <Field orientation="horizontal" className="w-fit">
                <FieldLabel htmlFor="sms-forwarding-enabled">
                  Enable forwarding
                </FieldLabel>
                <Switch
                  id="sms-forwarding-enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                />
              </Field>

              {/* Target phone */}
              <Field>
                <FieldLabel htmlFor="sms-forwarding-target">
                  Forward to
                </FieldLabel>
                <Input
                  id="sms-forwarding-target"
                  type="tel"
                  inputMode="tel"
                  placeholder="+15551234567"
                  className="max-w-sm font-mono"
                  value={targetPhone}
                  onChange={(e) => setTargetPhone(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!phoneError}
                  aria-describedby={
                    phoneError
                      ? "sms-forwarding-target-error"
                      : "sms-forwarding-target-desc"
                  }
                  autoComplete="tel"
                />
                {phoneError ? (
                  <FieldError id="sms-forwarding-target-error">
                    {phoneError}
                  </FieldError>
                ) : (
                  <FieldDescription id="sms-forwarding-target-desc">
                    Include the country code. Every incoming message is relayed
                    here.
                  </FieldDescription>
                )}
              </Field>

              {/* Save */}
              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                disabled={!canSave}
                className="w-fit"
              />
            </FieldGroup>
          </FieldSet>
        </motion.form>
      </CardContent>
    </Card>
  );
};

export default SmsForwardingCard;
