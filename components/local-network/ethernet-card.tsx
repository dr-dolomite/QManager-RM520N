"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import { toast } from "sonner";
import deviceIcon from "@/public/device-icon.svg";

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
import { RefreshCcwIcon, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
}

const EthernetStatusCard = () => {
  const [status, setStatus] = useState<EthernetStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const resp = await fetch(CGI_ENDPOINT);
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
        });
      }
    } catch {
      // Only surface errors when we have no data to show
      if (mountedRef.current && !hasDataRef.current) {
        setError("Unable to reach device");
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

    try {
      const resp = await fetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed_limit: value }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        toast.success("Link speed limit updated");

        // Recovery delay for link renegotiation
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Silent re-fetch to get new negotiated speed
        await fetchStatus(true);
      } else {
        toast.error(data.detail || "Failed to set link speed limit");
      }
    } catch {
      if (mountedRef.current) {
        toast.error("Failed to set link speed limit");
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

  const formatAutoNeg = (autoNeg: string) => {
    if (!autoNeg || autoNeg === "Unknown") return "N/A";
    return autoNeg === "on" ? "Active" : "Inactive";
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
            Current Ethernet link status, speed, and duplex settings.
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
            Current Ethernet link status, speed, and duplex settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <AlertCircle className="size-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">{error}</p>
              <p className="text-sm text-muted-foreground">
                Could not load ethernet status from the device.
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
              Current Ethernet link status, speed, and duplex settings.
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
              <Image
                src={deviceIcon}
                alt="Device Icon"
                className="size-full drop-shadow-md object-contain"
                priority
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
              <Badge
                variant={isConnected ? "default" : "destructive"}
                className={isConnected ? "bg-success hover:bg-success text-success-foreground" : ""}
              >
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                Auto-negotiation
              </p>
              <p className="font-semibold @sm/card:text-base text-sm">
                {formatAutoNeg(status?.auto_negotiation ?? "")}
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
                <SelectTrigger aria-label="Set Link Speed" className="w-full max-w-[50%] font-semibold text-muted-foreground @sm/card:text-base text-sm">
                  {isSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Applying...
                    </span>
                  ) : (
                    <SelectValue placeholder="Select a link speed" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup className="font-semibold text-muted-foreground @sm/card:text-base text-sm">
                    <SelectLabel>Link Speed Limit</SelectLabel>
                    <SelectItem value="auto">Auto (Max Speed)</SelectItem>
                    <SelectItem value="10">10 Mbps</SelectItem>
                    <SelectItem value="100">100 Mbps</SelectItem>
                    <SelectItem value="1000">1000 Mbps</SelectItem>
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
