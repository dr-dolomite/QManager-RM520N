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
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Loader2,
  Zap,
} from "lucide-react";
import { TbAlertTriangleFilled } from "react-icons/tb";
import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { ServiceStatusBadge } from "../service-status-badge";

function VideoOptimizerSkeleton() {
  return (
    <Card className="@container/card">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </CardContent>
    </Card>
  );
}

function ServiceStats({
  uptime,
  packets,
  domains,
}: {
  uptime: string;
  packets: number;
  domains: number;
}) {
  return (
    <div className="grid grid-cols-1 @sm/card:grid-cols-3 gap-3">
      {[
        { label: "Uptime", value: uptime },
        { label: "Packets Processed", value: packets.toLocaleString() },
        { label: "Domains Protected", value: domains.toString() },
      ].map((stat) => (
        <div key={stat.label} className="rounded-lg bg-muted/50 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {stat.label}
          </div>
          <div className="mt-1 text-base font-semibold">{stat.value}</div>
        </div>
      ))}
    </div>
  );
}

function VerificationDisplay({
  verifyResult,
  onRunTest,
  isRunning,
  serviceRunning,
}: {
  verifyResult: ReturnType<typeof useVideoOptimizer>["verifyResult"];
  onRunTest: () => void;
  isRunning: boolean;
  serviceRunning: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Verify Bypass</h4>
        <p className="text-xs text-muted-foreground">
          Run a before &amp; after speed test against a video CDN to confirm
          throttle bypass is working
        </p>
      </div>

      {verifyResult.status === "complete" &&
        verifyResult.without_bypass &&
        verifyResult.with_bypass && (
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-1 @sm/card:grid-cols-[1fr_auto_1fr]">
              <div className="p-4 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Without Bypass
                </div>
                <div
                  className={`mt-2 text-2xl font-bold ${
                    verifyResult.without_bypass.throttled
                      ? "text-destructive"
                      : "text-success"
                  }`}
                >
                  {verifyResult.without_bypass.speed_mbps.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground">Mbps</div>
                <Badge
                  variant="outline"
                  className={`mt-1.5 text-[11px] ${
                    verifyResult.without_bypass.throttled
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-success/30 bg-success/10 text-success"
                  }`}
                >
                  {verifyResult.without_bypass.throttled
                    ? "Throttled"
                    : "Not Throttled"}
                </Badge>
              </div>

              <div className="flex items-center justify-center py-1 @sm/card:py-0 @sm/card:px-2 text-muted-foreground">
                <span className="inline-block rotate-90 @sm/card:rotate-0">
                  &rarr;
                </span>
              </div>

              <div className="p-4 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  With Bypass
                </div>
                <div
                  className={`mt-2 text-2xl font-bold ${
                    verifyResult.with_bypass.throttled
                      ? "text-destructive"
                      : "text-success"
                  }`}
                >
                  {verifyResult.with_bypass.speed_mbps.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground">Mbps</div>
                <Badge
                  variant="outline"
                  className={`mt-1.5 text-[11px] ${
                    verifyResult.with_bypass.throttled
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-success/30 bg-success/10 text-success"
                  }`}
                >
                  {verifyResult.with_bypass.throttled
                    ? "Throttled"
                    : "Unthrottled"}
                </Badge>
              </div>
            </div>

            {verifyResult.improvement && (
              <div className="border-t bg-success/5 p-2.5 text-center">
                <span className="text-sm font-semibold text-success">
                  {verifyResult.improvement} faster
                </span>
                <span className="text-xs text-muted-foreground">
                  {" "}
                  &mdash; Video throttle successfully bypassed
                </span>
              </div>
            )}
          </div>
        )}

      {verifyResult.status === "error" && verifyResult.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{verifyResult.error}</AlertDescription>
        </Alert>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={onRunTest}
        disabled={isRunning || !serviceRunning}
      >
        {isRunning ? (
          <>
            <Loader2 className="animate-spin" />
            Running Verification...
          </>
        ) : (
          <>
            <Zap />
            Run Verification Test
          </>
        )}
      </Button>

      {isRunning && (
        <p className="text-center text-[11px] text-muted-foreground">
          Takes ~25 seconds. Briefly disables bypass during test.
        </p>
      )}
    </div>
  );
}

interface VideoOptimizerSettingsCardProps {
  hook: ReturnType<typeof useVideoOptimizer>;
  otherActive?: boolean;
  onSaved?: () => void;
}

export default function VideoOptimizerSettingsCard({
  hook,
  otherActive = false,
  onSaved,
}: VideoOptimizerSettingsCardProps) {
  const { settings, isLoading, error, refresh } = hook;

  if (isLoading) return <VideoOptimizerSkeleton />;

  // H4: Error state — fetch failed, no settings to show
  if (error && !settings) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Video Optimizer</CardTitle>
          <CardDescription>
            Bypass carrier video throttling on cellular connections using DPI
            evasion.
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
  const formKey = settings ? `${settings.enabled}` : "empty";

  return (
    <VideoOptimizerForm
      key={formKey}
      hook={hook}
      otherActive={otherActive}
      onSaved={onSaved}
    />
  );
}

function VideoOptimizerForm({
  hook,
  otherActive,
  onSaved,
}: {
  hook: ReturnType<typeof useVideoOptimizer>;
  otherActive: boolean;
  onSaved?: () => void;
}) {
  const {
    settings,
    isSaving,
    error,
    saveSettings,
    verifyResult,
    runVerification,
    installResult,
    runInstall,
  } = hook;

  const [isEnabled, setIsEnabled] = useState(settings?.enabled ?? false);
  const { saved, markSaved } = useSaveFlash();

  const isDirty = useMemo(() => {
    if (!settings) return false;
    return isEnabled !== settings.enabled;
  }, [settings, isEnabled]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const success = await saveSettings(isEnabled);
      if (success) {
        markSaved();
        toast.success(
          isEnabled ? "Video Optimizer enabled" : "Video Optimizer disabled",
        );
        onSaved?.();
      } else {
        toast.error(error || "Failed to save settings");
      }
    },
    [isEnabled, saveSettings, markSaved, error, onSaved],
  );

  const canEnable =
    settings?.binary_installed &&
    settings?.kernel_module_loaded &&
    !otherActive;
  // Allow toggling OFF even when canEnable is false (e.g., other feature is active)
  const canToggle = canEnable || settings?.enabled;
  const isRunning = settings?.status === "running";

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Video Optimizer</CardTitle>
        <CardDescription>
          Bypass carrier video throttling on cellular connections using DPI
          evasion. Some carriers (e.g., T-Mobile) may detect DPI evasion and
          de-prioritize your connection.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {otherActive ? (
          <Alert className="border-warning/30 bg-warning/10 text-warning mb-4">
            <TbAlertTriangleFilled />
            <AlertDescription className="text-warning">
              Traffic Masquerade is currently active. Disable it first before
              enabling Video Optimizer.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-warning/30 bg-warning/10 text-warning mb-4">
            <TbAlertTriangleFilled />
            <AlertTitle className="text-warning">Experimental Feature</AlertTitle>
          </Alert>
        )}

        {!settings?.binary_installed && (
          <div className="mb-4 space-y-3">
            <Alert>
              <Download className="h-4 w-4" />
              <AlertDescription>
                Video Optimizer requires the <code>nfqws</code> binary from the{" "}
                <a
                  href="https://github.com/bol-van/zapret"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  zapret
                </a>{" "}
                project. Click below to download and install it automatically.
              </AlertDescription>
            </Alert>

            {installResult.status === "complete" && (
              <Alert className="border-success/30 bg-success/5">
                <CheckCircle2 className="text-success" />
                <AlertDescription className="text-success">
                  {installResult.message}
                  {installResult.detail && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({installResult.detail})
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {installResult.status === "error" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {installResult.message}
                  {installResult.detail && (
                    <span className="block text-xs mt-1 opacity-80">
                      {installResult.detail}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              onClick={runInstall}
              disabled={installResult.status === "running"}
            >
              {installResult.status === "running" ? (
                <>
                  <Loader2 className="animate-spin" />
                  {installResult.message || "Installing..."}
                </>
              ) : (
                <>
                  <Download />
                  Install nfqws from zapret
                </>
              )}
            </Button>
          </div>
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

        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <Separator />
            <FieldGroup>
              <div className="flex items-center justify-between">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="dpi-enabled">
                    Enable Video Optimizer
                  </FieldLabel>
                  <Switch
                    id="dpi-enabled"
                    checked={isEnabled}
                    onCheckedChange={setIsEnabled}
                    disabled={!canToggle || isSaving}
                    aria-label="Enable Video Optimizer"
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

              {isRunning && settings && (
                <>
                  <Separator />
                  <ServiceStats
                    uptime={settings.uptime}
                    packets={settings.packets_processed}
                    domains={settings.domains_loaded}
                  />
                </>
              )}

              <Separator />

              <VerificationDisplay
                verifyResult={verifyResult}
                onRunTest={runVerification}
                isRunning={verifyResult.status === "running"}
                serviceRunning={isRunning}
              />

              <Separator />

              <SaveButton
                type="submit"
                isSaving={isSaving}
                saved={saved}
                disabled={!isDirty || !canToggle}
              />
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
    </Card>
  );
}
