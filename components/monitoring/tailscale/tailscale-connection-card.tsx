"use client";

import React from "react";
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
import {
  Loader2,
  PackageIcon,
  ExternalLinkIcon,
  AlertCircle,
  RefreshCcwIcon,
  AlertTriangleIcon,
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
  error,
  connect,
  disconnect,
  logout,
  startService,
  stopService,
  setBootEnabled,
  refresh,
}: TailscaleConnectionCardProps) {
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
                Install it via the terminal, then check again.
              </p>
            </div>
            <button
              type="button"
              className="bg-muted px-4 py-2.5 rounded-md text-xs font-mono text-muted-foreground select-all max-w-full overflow-x-auto text-left cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={async () => {
                const cmd =
                  status.install_hint ||
                  "opkg update && opkg install luci-app-tailscale";
                try {
                  await navigator.clipboard.writeText(cmd);
                  toast.success("Copied to clipboard");
                } catch {
                  // Fallback for older browsers / non-HTTPS contexts
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
              {status.install_hint ||
                "opkg update && opkg install luci-app-tailscale"}
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
              <Badge className="bg-muted text-muted-foreground border-border">
                Stopped
              </Badge>
            </div>
            {bootToggle}
            <Separator />
            <div className="pt-1">
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
              <Badge className="bg-warning text-warning-foreground border-warning">
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
              <Badge className="bg-success text-success-foreground border-success">
                Connected
              </Badge>
            </div>

            {/* Info rows */}
            {infoRows.map((row) => (
              <React.Fragment key={row.label}>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-muted-foreground shrink-0">
                    {row.label}
                  </p>
                  <p className="text-sm font-semibold text-right min-w-0 break-all">
                    {row.value}
                  </p>
                </div>
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
            <Badge className="bg-muted text-muted-foreground border-border">
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
        </div>
      </CardContent>
    </Card>
  );
}
