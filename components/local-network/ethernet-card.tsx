"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CgEthernet } from "react-icons/cg";
import {
  RefreshCcwIcon,
  Loader2,
  AlertCircle,
  CheckIcon,
  CheckCircle2Icon,
  XCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSaveFlash } from "@/components/ui/save-button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { AnimatedBeam } from "../ui/animated-beam";
import { Separator } from "../ui/separator";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ethernet.sh";

interface EthernetStatus {
  link_status: string;
  speed: string;
  duplex: string;
  auto_negotiation: string;
  speed_limit: string;
  supports_2500?: boolean;
}

const EthernetStatusCard = () => {
  const [status, setStatus] = useState<EthernetStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { saved, markSaved } = useSaveFlash();

  const containerRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);
  const ethernetRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch ethernet status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        hasDataRef.current = true;
        setError(null);
        setStatus({
          link_status: data.link_status,
          speed: data.speed,
          duplex: data.duplex,
          auto_negotiation: data.auto_negotiation,
          speed_limit: data.speed_limit,
          supports_2500: data.supports_2500,
        });
      }
    } catch {
      // Only surface errors when we have no data to show
      if (mountedRef.current && !hasDataRef.current) {
        setError("Unable to reach the modem");
      }
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    const interval = setInterval(() => {
      fetchStatus(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Set link speed limit
  // ---------------------------------------------------------------------------
  const handleSpeedChange = async (value: string) => {
    setIsSaving(true);
    // Optimistic update so the dropdown shows the requested value during PHY bounce.
    setStatus((prev) => prev ? { ...prev, speed_limit: value } : prev);

    const MAX_POLLS = 6;
    const POLL_INTERVAL_MS = 1500;

    // Polls until the link comes back up at the requested speed, or gives up.
    // Returns true if confirmed, false if exhausted.
    const confirmSpeedChange = async (requestedValue: string, windowSec: number): Promise<boolean> => {
      await new Promise((resolve) => setTimeout(resolve, windowSec * 1000));

      for (let i = 0; i < MAX_POLLS; i++) {
        if (!mountedRef.current) return false;
        try {
          const pollResp = await authFetch(CGI_ENDPOINT);
          if (pollResp.ok) {
            const pollData = await pollResp.json();
            if (!mountedRef.current) return false;
            if (
              pollData.success === true &&
              pollData.speed_limit === requestedValue &&
              pollData.link_status === "up" &&
              pollData.speed &&
              pollData.speed !== "Unknown"
            ) {
              setStatus({
                link_status: pollData.link_status,
                speed: pollData.speed,
                duplex: pollData.duplex,
                auto_negotiation: pollData.auto_negotiation,
                speed_limit: pollData.speed_limit,
                supports_2500: pollData.supports_2500,
              });
              setError(null);
              hasDataRef.current = true;
              return true;
            }
          }
        } catch {
          // PHY may still be renegotiating; retry.
        }
        if (i < MAX_POLLS - 1) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      }

      // Exhausted — re-sync to whatever the modem currently reports.
      if (mountedRef.current) await fetchStatus(true);
      return false;
    };

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed_limit: value }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        // Backend reports how long the PHY link bounce takes. Fall back to
        // 8 s if the field is missing (older builds / non-ethtool paths).
        const windowSec =
          typeof data.disconnect_window_seconds === "number"
            ? data.disconnect_window_seconds
            : 8;

        await confirmSpeedChange(value, windowSec);

        // markSaved() must fire after the confirm-poll resolves, in the same
        // synchronous continuation as the finally block's setIsSaving(false)
        // below — otherwise isSaving stays true (and wins the render ternary
        // over saved) for the whole ~8s poll window. See issue #10.
        if (mountedRef.current) {
          markSaved();
          toast.success("Link speed updated");
        }
      } else {
        toast.error(data.detail || "Failed to set link speed");
      }
    } catch {
      // Network error during POST likely means the PHY bounced mid-request.
      // Confirm silently rather than showing a false-negative error.
      if (mountedRef.current) {
        const confirmed = await confirmSpeedChange(value, 8);
        if (confirmed) {
          markSaved();
          toast.success("Link speed updated");
        } else {
          toast.error("Couldn't confirm new speed — check the link");
        }
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const isConnected = status?.link_status === "up";

  // Colors based on connection state
  const ringColors = isConnected
    ? {
        outer: "bg-success/15",
        mid: "bg-success/25",
        inner: "bg-success/40",
        center: "bg-success",
      }
    : {
        outer: "bg-muted-foreground/10",
        mid: "bg-muted-foreground/15",
        inner: "bg-muted-foreground/25",
        center: "bg-muted-foreground/50",
      };

  // Resolve CSS custom properties to computed values for SVG stopColor
  const beamColors = useMemo(() => {
    if (typeof document === "undefined") {
      return { start: "#3b82f6", stop: "#22c55e" };
    }
    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue("--primary").trim();
    const success = styles.getPropertyValue("--success").trim();
    const muted = styles.getPropertyValue("--muted-foreground").trim();

    return isConnected
      ? { start: primary || "#3b82f6", stop: success || "#22c55e" }
      : { start: muted || "#9ca3af", stop: muted || "#6b7280" };
  }, [isConnected]);

  // Format display values
  const formatSpeed = (speed: string) => {
    if (!speed || speed === "Unknown") return "N/A";
    // If already formatted like "1000Mb/s", convert to friendlier display
    const match = speed.match(/^(\d+)Mb\/s$/);
    if (match) {
      const mbps = parseInt(match[1], 10);
      if (mbps >= 1000) return `${mbps / 1000} Gbps`;
      return `${mbps} Mbps`;
    }
    return speed;
  };

  const formatDuplex = (duplex: string) => {
    if (!duplex || duplex === "Unknown") return "N/A";
    return duplex.charAt(0).toUpperCase() + duplex.slice(1);
  };

  // Reflects user intent: "auto" speed_limit means autoneg is on, fixed value means manual.
  const formatNegotiationMode = (speedLimit?: string) => {
    if (!speedLimit) return "N/A";
    return speedLimit === "auto" ? "Automatic" : "Manual";
  };

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Ethernet Status</CardTitle>
          <CardDescription>
            Live link state and speed limit for the host ethernet interface.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="size-16 @xs/card:size-32 rounded-full" />
              <Skeleton className="size-12 @xs/card:size-24 rounded-full" />
              <Skeleton className="size-16 @xs/card:size-32 rounded-full" />
            </div>
            <div className="grid gap-2 w-full">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state (only when no data has ever loaded)
  // ---------------------------------------------------------------------------
  if (error && !status) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Ethernet Status</CardTitle>
          <CardDescription>
            Live link state and speed limit for the host ethernet interface.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <AlertCircle className="size-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">{error}</p>
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load ethernet status. Try refreshing.
              </p>
            </div>
            <Button variant="outline" onClick={() => fetchStatus()}>
              <RefreshCcwIcon className="mr-2 size-4" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Ethernet Status</CardTitle>
            <CardDescription>
              Live link state and speed limit for the host ethernet interface.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh ethernet status"
            onClick={() => fetchStatus()}
            disabled={isSaving}
          >
            <RefreshCcwIcon className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid space-y-6">
          <div
            ref={containerRef}
            className="relative flex items-center justify-between"
          >
            <div
              ref={deviceRef}
              className="size-16 @xs/card:size-24 bg-primary/15 rounded-full p-3 @xs/card:p-4 flex items-center justify-center"
            >
              <img
                src="/device-icon.svg"
                alt="Device"
                className="size-full drop-shadow-md object-contain"
                loading="lazy"
              />
            </div>

            <div
              ref={ringsRef}
              className="relative flex items-center justify-center size-12 @xs/card:size-24"
            >
              {/* Outer rings - pulsating when connected, static when disconnected */}
              <div
                className={`absolute rounded-full size-12 @xs/card:size-24 ${ringColors.outer} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
              />
              <div
                className={`absolute rounded-full size-9 @xs/card:size-16 ${ringColors.mid} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
                style={isConnected ? { animationDelay: "0.3s" } : undefined}
              />
              <div
                className={`absolute rounded-full size-6 @xs/card:size-12 ${ringColors.inner} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
                style={isConnected ? { animationDelay: "0.6s" } : undefined}
              />
              {/* Center circle */}
              <div
                className={`relative rounded-full size-4 ${ringColors.center}`}
              />
            </div>

            <div
              ref={ethernetRef}
              className={`size-16 @xs/card:size-24 rounded-full p-3 @xs/card:p-6 flex items-center justify-center ${
                isConnected ? "bg-primary" : "bg-muted-foreground/50"
              }`}
            >
              <CgEthernet className="size-full text-primary-foreground" />
            </div>

            {/* Animated beams connecting the elements */}
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={deviceRef}
              toRef={ringsRef}
              duration={2}
              pathWidth={3}
              gradientStartColor={beamColors.start}
              gradientStopColor={beamColors.stop}
              startXOffset={72}
              endXOffset={-56}
            />
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={ringsRef}
              toRef={ethernetRef}
              duration={2}
              pathWidth={3}
              gradientStartColor={beamColors.stop}
              gradientStopColor={beamColors.start}
              startXOffset={56}
              endXOffset={-72}
            />
          </div>
          <div className="grid gap-2 w-full">
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                Link Status
              </p>
              {isConnected ? (
                <Badge variant="success">
                  <CheckCircle2Icon className="h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircleIcon className="h-3 w-3" />
                  Disconnected
                </Badge>
              )}
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                Auto-Negotiation
              </p>
              <p className="font-semibold @sm/card:text-base text-sm">
                {formatNegotiationMode(status?.speed_limit)}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                Active Link Speed
              </p>
              <p className="font-semibold @sm/card:text-base text-sm">
                {isConnected ? formatSpeed(status?.speed ?? "") : "N/A"}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                Duplex
              </p>
              <p className="font-semibold @sm/card:text-base text-sm">
                {isConnected ? formatDuplex(status?.duplex ?? "") : "N/A"}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                Set Link Speed
              </p>
              <Select
                value={status?.speed_limit ?? "auto"}
                onValueChange={handleSpeedChange}
                disabled={isSaving}
              >
                <SelectTrigger
                  aria-label="Set link speed limit"
                  className="w-full max-w-[50%] font-semibold text-muted-foreground @sm/card:text-base text-sm"
                >
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Applying...
                    </span>
                  ) : saved ? (
                    <span className="flex items-center gap-2">
                      <CheckIcon className="h-3 w-3" />
                      Saved
                    </span>
                  ) : (
                    <SelectValue placeholder="Select speed" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                    <SelectLabel>Speed Limit</SelectLabel>
                    <SelectItem value="auto">Auto (max)</SelectItem>
                    <SelectItem value="10">10 Mbps</SelectItem>
                    <SelectItem value="100">100 Mbps</SelectItem>
                    <SelectItem value="1000">1 Gbps</SelectItem>
                    {status?.supports_2500 ? (
                      <SelectItem value="2500">2.5 Gbps</SelectItem>
                    ) : null}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Separator />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EthernetStatusCard;
