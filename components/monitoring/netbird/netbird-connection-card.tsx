"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CopyableCommand } from "@/components/ui/copyable-command";
import {
  Loader2,
  PackageIcon,
  AlertCircle,
  RefreshCcwIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  MinusCircleIcon,
  Trash2Icon,
  KeyIcon,
} from "lucide-react";
import type { UseNetBirdReturn } from "@/hooks/use-netbird";

// =============================================================================
// NetBirdConnectionCard — Multi-state connection + settings card
// =============================================================================
// States: Loading → Error → Not Installed → Service Stopped →
//         Disconnected → Connected

type NetBirdConnectionCardProps = Omit<UseNetBirdReturn, "refresh"> & {
  refresh: () => void;
};

// ─── Component ──────────────────────────────────────────────────────────────

export function NetBirdConnectionCard({
  status,
  isLoading,
  isConnecting,
  isDisconnecting,
  isTogglingService,
  isUninstalling,
  installResult,
  error,
  connect,
  disconnect,
  startService,
  stopService,
  setBootEnabled,
  uninstall,
  runInstall,
  refresh,
}: NetBirdConnectionCardProps) {
  const [setupKey, setSetupKey] = useState("");
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  const handleReboot = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsRebooting(true);
    fetch("/cgi-bin/quecmanager/system/reboot.sh", { method: "POST" }).catch(
      () => {}
    );
    setTimeout(() => {
      sessionStorage.setItem("qm_rebooting", "1");
      document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
      window.location.href = "/reboot/";
    }, 2000);
  };

  // Reboot confirmation dialog (shown after successful uninstall)
  // Defined before early returns so it renders in all states including "Not Installed"
  const rebootDialog = (
    <AlertDialog open={showRebootDialog} onOpenChange={(open) => {
      if (!isRebooting) setShowRebootDialog(open);
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reboot Required</AlertDialogTitle>
          <AlertDialogDescription>
            NetBird has been removed. A reboot is recommended to clean up
            firewall rules and other artifacts. Would you like to reboot now?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRebooting}>
            Reboot Later
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isRebooting}
            onClick={handleReboot}
          >
            {isRebooting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Rebooting…
              </>
            ) : (
              "Reboot Now"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>NetBird Connection</CardTitle>
          <CardDescription>
            Manage your NetBird VPN connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            <Skeleton className="h-6 w-28" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (initial fetch failed) ------------------------------------
  if (!isLoading && error && !status) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>NetBird Connection</CardTitle>
          <CardDescription>
            Manage your NetBird VPN connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load NetBird status</AlertTitle>
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

  // --- Not Installed ---------------------------------------------------------
  if (status && !status.installed) {
    const installCmd =
      status.install_hint || "opkg update && opkg install netbird";

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>NetBird Connection</CardTitle>
          <CardDescription>
            Manage your NetBird VPN connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <PackageIcon className="size-10 text-muted-foreground" />
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium">
                NetBird is not installed on this device.
              </p>
              <p className="text-xs text-muted-foreground">
                Install automatically or run the command manually.
              </p>
            </div>

            {installResult.status === "complete" && (
              <Alert className="border-success/30 bg-success/5">
                <CheckCircle2Icon className="text-success" />
                <AlertDescription className="text-success">
                  <p>{installResult.message}</p>
                </AlertDescription>
              </Alert>
            )}

            {installResult.status === "error" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p>
                    {installResult.message}
                    {installResult.detail && (
                      <span className="block text-xs mt-1 opacity-80">
                        {installResult.detail}
                      </span>
                    )}
                  </p>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={runInstall}
                disabled={installResult.status === "running"}
              >
                {installResult.status === "running" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {installResult.message || "Installing..."}
                  </>
                ) : (
                  <>
                    <PackageIcon className="size-4" />
                    Install NetBird
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refresh()}
                disabled={installResult.status === "running"}
              >
                <RefreshCcwIcon className="size-3.5" />
                Check Again
              </Button>
            </div>

            <div className="w-full flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>or install manually</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <CopyableCommand command={installCmd} />
          </div>
          {rebootDialog}
        </CardContent>
      </Card>
    );
  }

  // --- Stale data warning (poll failed but we have previous data) ------------
  const staleWarning = error && status && (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertDescription className="flex items-center justify-between">
        <span className="text-xs">{error}</span>
        <Button variant="outline" size="sm" onClick={() => refresh()}>
          <RefreshCcwIcon className="size-3.5" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );

  // --- From here, NetBird IS installed ---------------------------------------
  const version = status?.version;
  const backendState = status?.backend_state || "";
  const daemonRunning = status?.daemon_running;
  const bootEnabled = status?.enabled_on_boot ?? false;

  // Boot toggle handler
  const handleBootToggle = async (checked: boolean) => {
    const success = await setBootEnabled(checked);
    if (success) {
      toast.success(
        checked
          ? "NetBird will start on boot"
          : "NetBird will not start on boot",
      );
    } else {
      toast.error("Failed to update boot setting");
    }
  };

  // Boot toggle element (reused across states)
  const bootToggle = (
    <>
      <Separator />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-muted-foreground">
          Start on Boot
        </p>
        <Switch
          checked={bootEnabled}
          onCheckedChange={handleBootToggle}
          aria-label="Enable NetBird on boot"
        />
      </div>
    </>
  );

  // Uninstall section (follows Email Alerts / Video Optimizer pattern)
  const uninstallSection = (
    <>
      <Separator className="mt-4" />
      <div className="flex items-center justify-between pt-4">
        <div>
          <p className="text-sm font-medium">Remove NetBird</p>
          <p className="text-xs text-muted-foreground">
            Uninstall the NetBird package and firewall rules from this device.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={isUninstalling}
            >
              {isUninstalling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Removing...
                </>
              ) : (
                <>
                  <Trash2Icon className="size-4" />
                  Uninstall
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Uninstall NetBird?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the NetBird package, firewall rules, and
                all connection state from this device. The device will reboot
                to clean up any remaining artifacts.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  const success = await uninstall();
                  if (success) {
                    toast.success("NetBird uninstalled");
                    setShowRebootDialog(true);
                  } else {
                    toast.error("Failed to uninstall NetBird");
                  }
                }}
              >
                Uninstall
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );

  // Setup key input (reused in disconnected / needs-connect states)
  const setupKeyInput = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Setup key (optional)"
          value={setupKey}
          onChange={(e) => setSetupKey(e.target.value)}
          className="font-mono text-xs"
          disabled={isConnecting}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Enter a setup key from your NetBird dashboard, or leave empty if already
        registered.
      </p>
    </div>
  );

  // --- Service Stopped -------------------------------------------------------
  if (!daemonRunning) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>NetBird Connection</CardTitle>
          <CardDescription>
            {version ? `NetBird v${version} · ` : ""}Manage your NetBird VPN
            connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            {staleWarning}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-muted-foreground">
                Service
              </p>
              <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
                <MinusCircleIcon className="size-3" />
                Stopped
              </Badge>
            </div>
            {bootToggle}
            <Separator />
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                onClick={async () => {
                  const success = await startService();
                  if (success) {
                    toast.success("NetBird service started");
                  } else {
                    toast.error("Failed to start NetBird service");
                  }
                }}
                disabled={isTogglingService}
              >
                {isTogglingService ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "Start Service"
                )}
              </Button>

            </div>
            {uninstallSection}
            {rebootDialog}
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Connected -------------------------------------------------------------
  if (backendState === "Connected") {
    const management = status?.management || "Unknown";
    const signal = status?.signal || "Unknown";
    const fqdn = status?.fqdn || "";
    const netbirdIp = status?.netbird_ip || "";

    const infoRows: { label: string; value: React.ReactNode }[] = [
      ...(fqdn
        ? [
            {
              label: "FQDN",
              value: <span className="break-all">{fqdn}</span>,
            },
          ]
        : []),
      ...(netbirdIp
        ? [
            {
              label: "NetBird IP",
              value: <span className="font-mono">{netbirdIp}</span>,
            },
          ]
        : []),
      {
        label: "Management",
        value:
          management === "Connected" ? (
            <Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
              <CheckCircle2Icon className="size-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30">
              <AlertTriangleIcon className="size-3" />
              {management}
            </Badge>
          ),
      },
      {
        label: "Signal",
        value:
          signal === "Connected" ? (
            <Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
              <CheckCircle2Icon className="size-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30">
              <AlertTriangleIcon className="size-3" />
              {signal}
            </Badge>
          ),
      },
    ];

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>NetBird Connection</CardTitle>
          <CardDescription>
            {version ? `NetBird v${version} · ` : ""}Manage your NetBird VPN
            connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            {staleWarning}
            {/* Boot toggle */}
            {bootToggle}

            <Separator />

            {/* Status badge */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-muted-foreground">
                Status
              </p>
              <Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
                <CheckCircle2Icon className="size-3" />
                Connected
              </Badge>
            </div>

            {/* Info rows */}
            {infoRows.map((row, i) => (
              <React.Fragment key={row.label}>
                <Separator />
                <motion.div
                  className="flex items-center justify-between gap-2"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.05, 0.35), ease: "easeOut" }}
                >
                  <p className="text-sm font-semibold text-muted-foreground shrink-0">
                    {row.label}
                  </p>
                  <p className="text-sm font-semibold text-right min-w-0 break-all">
                    {row.value}
                  </p>
                </motion.div>
              </React.Fragment>
            ))}

            {/* Actions */}
            <Separator />
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const success = await disconnect();
                  if (success) {
                    toast.success("NetBird disconnected");
                  } else {
                    toast.error("Failed to disconnect");
                  }
                }}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  "Disconnect"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Disconnected / Connecting / Unknown -----------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>NetBird Connection</CardTitle>
        <CardDescription>
          {version ? `NetBird v${version} · ` : ""}Manage your NetBird VPN
          connection.
        </CardDescription>
      </CardHeader>
      <CardContent aria-live="polite">
        <div className="grid gap-2">
          {staleWarning}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              Status
            </p>
            <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
              <MinusCircleIcon className="size-3" />
              Disconnected
            </Badge>
          </div>

          {bootToggle}

          <Separator />
          {setupKeyInput}
          <Separator />

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button
              onClick={async () => {
                const success = await connect(setupKey || undefined);
                if (success) {
                  toast.success("NetBird connected");
                  setSetupKey("");
                } else {
                  toast.error("Failed to connect");
                }
              }}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const success = await stopService();
                if (success) {
                  toast.success("NetBird service stopped");
                } else {
                  toast.error("Failed to stop NetBird service");
                }
              }}
              disabled={isTogglingService}
            >
              {isTogglingService ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Stopping...
                </>
              ) : (
                "Stop Service"
              )}
            </Button>

          </div>
            {uninstallSection}
            {rebootDialog}
        </div>
      </CardContent>
    </Card>
  );
}
