"use client";

import { useCallback, useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Card,
  CardAction,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle2, Info, Loader2, Zap } from "lucide-react";
import Link from "next/link";
import { TbAlertTriangleFilled } from "react-icons/tb";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import { ServiceStatusBadge } from "../service-status-badge";

function MasqueradeSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </CardContent>
    </Card>
  );
}

interface TrafficMasqueradeSettingsCardProps {
  hook: ReturnType<typeof useTrafficMasquerade>;
  otherActive?: boolean;
  onSaved?: () => void;
}

export default function TrafficMasqueradeSettingsCard({
  hook,
  otherActive = false,
  onSaved,
}: TrafficMasqueradeSettingsCardProps) {
  const { settings, isLoading, error, refresh } = hook;

  if (isLoading) return <MasqueradeSkeleton />;

  // H4: Error state — fetch failed, no settings to show
  if (error && !settings) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Traffic Masquerade</CardTitle>
          <CardDescription>
            Make HTTPS traffic appear as a whitelisted service to carrier DPI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Failed to load settings.{" "}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => refresh()}
              >
                Retry
              </button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // H3: Key-based remount — when settings change (initial load or post-save
  // re-fetch), the form reinitializes with fresh values from useState defaults.
  const formKey = settings
    ? `${settings.enabled}-${settings.sni_domain}`
    : "empty";

  return (
    <TrafficMasqueradeForm
      key={formKey}
      hook={hook}
      otherActive={otherActive}
      onSaved={onSaved}
    />
  );
}

function TrafficMasqueradeForm({
  hook,
  otherActive,
  onSaved,
}: {
  hook: ReturnType<typeof useTrafficMasquerade>;
  otherActive: boolean;
  onSaved?: () => void;
}) {
  const { settings, isSaving, error, saveSettings, testResult, runTest } = hook;

  const [isEnabled, setIsEnabled] = useState(settings?.enabled ?? false);
  const [sniDomain, setSniDomain] = useState(
    settings?.sni_domain || "speedtest.net",
  );
  const { saved, markSaved } = useSaveFlash();

  const isDirty = useMemo(() => {
    if (!settings) return false;
    return isEnabled !== settings.enabled || sniDomain !== settings.sni_domain;
  }, [settings, isEnabled, sniDomain]);

  const sniError = useMemo(() => {
    if (!sniDomain.trim()) return "Domain is required";
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(sniDomain))
      return "Invalid domain format";
    if (!sniDomain.includes(".")) return "Must contain at least one dot";
    if (sniDomain.length > 253) return "Domain too long (max 253 chars)";
    return null;
  }, [sniDomain]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (sniError) return;

      const success = await saveSettings(isEnabled, sniDomain);
      if (success) {
        markSaved();
        toast.success(
          isEnabled
            ? "Traffic Masquerade enabled"
            : "Traffic Masquerade disabled",
        );
        onSaved?.();
      } else {
        toast.error(error || "Failed to save settings");
      }
    },
    [isEnabled, sniDomain, sniError, saveSettings, markSaved, error, onSaved],
  );

  const canEnable =
    settings?.binary_installed &&
    settings?.kernel_module_loaded &&
    !otherActive;
  const canToggle = canEnable || settings?.enabled;
  const isRunning = settings?.status === "running";

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Traffic Masquerade</CardTitle>
        <CardDescription>
          Make HTTPS traffic appear as a whitelisted service to carrier DPI by
          injecting fake TLS handshakes with a spoofed domain. This sends fake
          Some carriers may detect this behavior and de-prioritize your
          connection.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert className="border-warning/30 bg-warning/10 text-warning mb-4">
          <TbAlertTriangleFilled />
          <AlertTitle className="text-warning">Experimental Feature</AlertTitle>
        </Alert>

        {!settings?.binary_installed && (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Requires the <code>nfqws</code> binary. Install it from the{" "}
              <Link
                href="/local-network/video-optimizer"
                className="underline underline-offset-4"
              >
                Video Optimizer
              </Link>{" "}
              page.
            </AlertDescription>
          </Alert>
        )}

        {settings?.binary_installed && !settings?.kernel_module_loaded && (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Required kernel module not found. Run{" "}
              <code className="text-xs">opkg install kmod-nft-queue</code> on
              the device.
            </AlertDescription>
          </Alert>
        )}

        {otherActive && (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Video Optimizer is currently active. Disable it first before
              enabling Traffic Masquerade.
            </AlertDescription>
          </Alert>
        )}

        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <Separator />
            <FieldGroup>
              <div className="flex items-center justify-between">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="masq-enabled">
                    Enable Traffic Masquerade
                  </FieldLabel>
                  <Switch
                    id="masq-enabled"
                    checked={isEnabled}
                    onCheckedChange={setIsEnabled}
                    disabled={!canToggle || isSaving}
                    aria-label="Enable Traffic Masquerade"
                  />
                </Field>
                {settings && (
                  <CardAction>
                    <ServiceStatusBadge
                      status={settings.status}
                      installed={settings.binary_installed}
                    />
                  </CardAction>
                )}
              </div>

              <Field>
                <FieldLabel htmlFor="sni-domain">Masquerade Domain</FieldLabel>
                <Input
                  id="sni-domain"
                  type="text"
                  value={sniDomain}
                  onChange={(e) => setSniDomain(e.target.value)}
                  disabled={!isEnabled || !canEnable || isSaving}
                  placeholder="speedtest.net"
                  className="max-w-sm"
                  aria-invalid={!!sniError && isEnabled}
                  aria-describedby={
                    sniError && isEnabled ? "sni-error" : "sni-desc"
                  }
                />
                {sniError && isEnabled ? (
                  <FieldError id="sni-error">{sniError}</FieldError>
                ) : (
                  <FieldDescription id="sni-desc">
                    Carriers typically whitelist speedtest domains to ensure
                    accurate speed tests
                  </FieldDescription>
                )}
              </Field>

              {isRunning && settings && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Uptime", value: settings.uptime },
                      {
                        label: "Packets Processed",
                        value: settings.packets_processed.toLocaleString(),
                      },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-lg bg-muted/50 p-3"
                      >
                        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          {stat.label}
                        </div>
                        <div className="mt-1 text-base font-semibold">
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {isRunning && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-medium">Test Injection</h4>
                      <p className="text-xs text-muted-foreground">
                        Make an HTTPS request and verify packets are being
                        intercepted
                      </p>
                    </div>

                    {testResult.status === "complete" && (
                      <Alert
                        className={
                          testResult.injected
                            ? "border-success/30 bg-success/5 text-success"
                            : "border-destructive/30 bg-destructive/10 text-destructive"
                        }
                      >
                        {testResult.injected ? (
                          <CheckCircle2 />
                        ) : (
                          <AlertTriangle />
                        )}
                        <AlertDescription
                          className={
                            testResult.injected
                              ? "text-success"
                              : "text-destructive"
                          }
                        >
                          {testResult.message}
                        </AlertDescription>
                      </Alert>
                    )}

                    {testResult.status === "error" && testResult.error && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>{testResult.error}</AlertDescription>
                      </Alert>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={runTest}
                      disabled={testResult.status === "running"}
                    >
                      {testResult.status === "running" ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Zap />
                          Test Injection
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}

              <Separator />

              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                disabled={!isDirty || !canToggle || (isEnabled && !!sniError)}
              />
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}
