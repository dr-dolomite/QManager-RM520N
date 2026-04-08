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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CopyableCommand } from "@/components/ui/copyable-command";
import {
  Loader2,
  PackageIcon,
  ExternalLinkIcon,
  AlertCircle,
  RefreshCcwIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  MinusCircleIcon,
  LogInIcon,
  Trash2Icon,
} from "lucide-react";
import type { UseTailscaleReturn } from "@/hooks/use-tailscale";

// =============================================================================
// TailscaleConnectionCard — Multi-state connection + settings card
// =============================================================================
// States: Loading → Error → Not Installed → Service Stopped →
//         NeedsLogin → Connected → Disconnected

type TailscaleConnectionCardProps = Omit<UseTailscaleReturn, "refresh"> & {
  refresh: () => void;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function trimDNS(dns: string): string {
  return dns?.replace(/\.$/, "") || "";
}

function getIPv4(ips: string[] | undefined): string {
  return ips?.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || "—";
}

function getIPv6(ips: string[] | undefined): string {
  return ips?.find((ip) => ip.includes(":")) || "—";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TailscaleConnectionCard({
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
  logout,
  startService,
  stopService,
  setBootEnabled,
  uninstall,
  runInstall,
  refresh,
}: TailscaleConnectionCardProps) {
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  const handleReboot = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsRebooting(true);
    fetch("/cgi-bin/quecmanager/system/reboot.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reboot" }),
      keepalive: true,
    }).catch(() => {});
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
            Tailscale has been removed. A reboot is recommended to clean up
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
          <CardTitle>Tailscale Connection</CardTitle>
          <CardDescription>
            Manage your Tailscale VPN connection.
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
          <CardTitle>Tailscale Connection</CardTitle>
          <CardDescription>
            Manage your Tailscale VPN connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Failed to load Tailscale status</AlertTitle>
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
      status.install_hint || "sudo qmanager_tailscale_mgr install";

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Tailscale Connection</CardTitle>
          <CardDescription>
            Manage your Tailscale VPN connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <PackageIcon className="size-10 text-muted-foreground" />
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium">
                Tailscale is not installed on this device.
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
                    Install Tailscale
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

  // --- From here, Tailscale IS installed -------------------------------------
  const version = status?.version;
  const backendState = status?.backend_state || "";
  const daemonRunning = status?.daemon_running;
  const bootEnabled = status?.enabled_on_boot ?? false;
  const self = status?.self;
  const tailnet = status?.tailnet;
  const health = (status?.health || []).filter(
    (msg) => !msg.includes("--accept-routes"),
  );
  const authUrl = status?.auth_url;

  // Boot toggle handler
  const handleBootToggle = async (checked: boolean) => {
    const success = await setBootEnabled(checked);
    if (success) {
      toast.success(
        checked
          ? "Tailscale will start on boot"
          : "Tailscale will not start on boot",
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
          aria-label="Enable Tailscale on boot"
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
          <p className="text-sm font-medium">Remove Tailscale</p>
          <p className="text-xs text-muted-foreground">
            Uninstall the Tailscale packages and firewall rules from this device.
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
                  Removing…
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
              <AlertDialogTitle>Uninstall Tailscale?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the Tailscale packages, firewall rules, and
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
                    toast.success("Tailscale uninstalled");
                    setShowRebootDialog(true);
                  } else {
                    toast.error("Failed to uninstall Tailscale");
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

  // --- Service Stopped -------------------------------------------------------
  if (!daemonRunning) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Tailscale Connection</CardTitle>
          <CardDescription>
            {version ? `Tailscale v${version} · ` : ""}Manage your Tailscale VPN
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
                    toast.success("Tailscale service started");
                  } else {
                    toast.error("Failed to start Tailscale service");
                  }
                }}
                disabled={isTogglingService}
              >
                {isTogglingService ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Starting…
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

  // --- Needs Login -----------------------------------------------------------
  if (backendState === "NeedsLogin" || backendState === "NeedsMachineAuth") {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Tailscale Connection</CardTitle>
          <CardDescription>
            {version ? `Tailscale v${version} · ` : ""}Manage your Tailscale VPN
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
              <Badge variant="outline" className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30">
                <LogInIcon className="size-3" />
                Needs Login
              </Badge>
            </div>

            {authUrl ? (
              <>
                <Separator />
                <Alert>
                  <AlertCircle className="size-4" />
                  <AlertDescription className="space-y-3">
                    <p>
                      Visit the link below to authenticate with your Tailscale
                      account (Google, Microsoft, etc.).
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(authUrl, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      Open Login Page
                    </Button>
                    <p className="text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">
                      Waiting for authentication…
                    </p>
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <>
                <Separator />
                <div className="pt-1">
                  <Button
                    onClick={async () => {
                      const success = await connect();
                      if (!success) {
                        toast.error("Failed to initiate connection");
                      }
                    }}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Connecting…
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </div>
              </>
            )}

            {bootToggle}
            <Separator />
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const success = await stopService();
                  if (success) {
                    toast.success("Tailscale service stopped");
                  } else {
                    toast.error("Failed to stop Tailscale service");
                  }
                }}
                disabled={isTogglingService}
              >
                {isTogglingService ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Stopping…
                  </>
                ) : (
                  "Stop Service"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Connected (Running) ---------------------------------------------------
  if (backendState === "Running") {
    const ipv4 = getIPv4(self?.tailscale_ips);
    const ipv6 = getIPv6(self?.tailscale_ips);
    const dnsName = trimDNS(self?.dns_name || "");
    const magicSuffix = tailnet?.magic_dns_enabled
      ? tailnet.magic_dns_suffix
      : "";

    const infoRows: { label: string; value: React.ReactNode }[] = [
      { label: "Hostname", value: self?.hostname || "—" },
      {
        label: "IPv4",
        value: <span className="font-mono">{ipv4}</span>,
      },
      ...(ipv6 !== "—"
        ? [
            {
              label: "IPv6",
              value: (
                <span className="font-mono break-all">{ipv6}</span>
              ),
            },
          ]
        : []),
      ...(dnsName
        ? [
            {
              label: "DNS Name",
              value: <span className="break-all">{dnsName}</span>,
            },
          ]
        : []),
      ...(tailnet?.name ? [{ label: "Tailnet", value: tailnet.name }] : []),
      ...(magicSuffix
        ? [
            {
              label: "MagicDNS",
              value: <span className="font-mono">{magicSuffix}</span>,
            },
          ]
        : []),
      ...(self?.relay
        ? [
            {
              label: "DERP Relay",
              value: self.relay.toUpperCase(),
            },
          ]
        : []),
    ];

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Tailscale Connection</CardTitle>
          <CardDescription>
            {version ? `Tailscale v${version} · ` : ""}Manage your Tailscale VPN
            connection.
          </CardDescription>
        </CardHeader>
        <CardContent aria-live="polite">
          <div className="grid gap-2">
            {staleWarning}
            {/* Boot toggle */}
            {bootToggle}
            {/* Health warnings */}
            {health.length > 0 && (
              <>
                <Separator />
                <Alert variant="destructive">
                  <AlertTriangleIcon className="size-4" />
                  <AlertTitle>Health Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 text-xs space-y-1">
                      {health.map((msg, i) => (
                        <li key={i}>{msg}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              </>
            )}

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
                    toast.success("Tailscale disconnected");
                  } else {
                    toast.error("Failed to disconnect");
                  }
                }}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Disconnecting…
                  </>
                ) : (
                  "Disconnect"
                )}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isDisconnecting}
                  >
                    Logout
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Logout from Tailscale?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove this device from your Tailscale network.
                      You will need to re-authenticate to reconnect.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        const success = await logout();
                        if (success) {
                          toast.success("Logged out from Tailscale");
                        } else {
                          toast.error("Failed to logout");
                        }
                      }}
                    >
                      Logout
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Disconnected (Stopped backend state) ----------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Tailscale Connection</CardTitle>
        <CardDescription>
          {version ? `Tailscale v${version} · ` : ""}Manage your Tailscale VPN
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
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <Button
              onClick={async () => {
                const success = await connect();
                if (!success) {
                  toast.error("Failed to connect");
                }
              }}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting…
                </>
              ) : (
                "Connect"
              )}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDisconnecting}
                >
                  Logout
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Logout from Tailscale?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove this device from your Tailscale network.
                    You will need to re-authenticate to reconnect.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const success = await logout();
                      if (success) {
                        toast.success("Logged out from Tailscale");
                      } else {
                        toast.error("Failed to logout");
                      }
                    }}
                  >
                    Logout
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {uninstallSection}
          {rebootDialog}
        </div>
      </CardContent>
    </Card>
  );
}
