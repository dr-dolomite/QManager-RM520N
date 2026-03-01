"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
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
import { RefreshCcwIcon, Loader2 } from "lucide-react";
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

  const containerRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);
  const ethernetRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

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
        setStatus({
          link_status: data.link_status,
          speed: data.speed,
          duplex: data.duplex,
          auto_negotiation: data.auto_negotiation,
          speed_limit: data.speed_limit,
        });
      }
    } catch {
      // silently fail — keep current state
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
    ? { outer: "bg-green-200", mid: "bg-green-300", inner: "bg-green-400", center: "bg-green-600" }
    : { outer: "bg-gray-200", mid: "bg-gray-300", inner: "bg-gray-400", center: "bg-gray-500" };

  const beamStartColor = isConnected ? "#3b82f6" : "#9ca3af";
  const beamStopColor = isConnected ? "#22c55e" : "#6b7280";

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
            Displays the current status of the Ethernet connection, including
            speed and connectivity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="size-32 rounded-full" />
              <Skeleton className="size-24 rounded-full" />
              <Skeleton className="size-32 rounded-full" />
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
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Ethernet Status</CardTitle>
            <CardDescription>
              Displays the current status of the Ethernet connection, including
              speed and connectivity.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => fetchStatus()}
            disabled={isSaving}
          >
            <RefreshCcwIcon className="h-4 w-4" />
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
              className="size-32 bg-primary/15 rounded-full p-6 flex items-center justify-center"
            >
              <Image
                src={deviceIcon}
                alt="Device Icon"
                className="size-full rounded-full drop-shadow-md"
                priority
              />
            </div>

            <div
              ref={ringsRef}
              className="relative flex items-center justify-center size-24"
            >
              {/* Outer rings - pulsating when connected, static when disconnected */}
              <div
                className={`absolute rounded-full size-24 ${ringColors.outer} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
              />
              <div
                className={`absolute rounded-full size-16 ${ringColors.mid} ${
                  isConnected ? "animate-pulse-ring" : ""
                }`}
                style={isConnected ? { animationDelay: "0.3s" } : undefined}
              />
              <div
                className={`absolute rounded-full size-12 ${ringColors.inner} ${
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
              className={`size-32 rounded-full p-6 flex items-center justify-center ${
                isConnected ? "bg-primary" : "bg-muted-foreground/50"
              }`}
            >
              <CgEthernet className="size-full text-white" />
            </div>

            {/* Animated beams connecting the elements */}
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={deviceRef}
              toRef={ringsRef}
              duration={2}
              pathWidth={3}
              gradientStartColor={beamStartColor}
              gradientStopColor={beamStopColor}
              startXOffset={72}
              endXOffset={-56}
            />
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={ringsRef}
              toRef={ethernetRef}
              duration={2}
              pathWidth={3}
              gradientStartColor={beamStopColor}
              gradientStopColor={beamStartColor}
              startXOffset={56}
              endXOffset={-72}
            />
          </div>
          <div className="grid gap-2 w-full">
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Link Status
              </p>
              <Badge
                variant={isConnected ? "default" : "destructive"}
                className={isConnected ? "bg-green-600 hover:bg-green-600" : ""}
              >
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Auto-negotiation
              </p>
              <p className="font-semibold xl:text-md text-sm">
                {formatAutoNeg(status?.auto_negotiation ?? "")}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Active Link Speed
              </p>
              <p className="font-semibold xl:text-md text-sm">
                {isConnected
                  ? formatSpeed(status?.speed ?? "")
                  : "N/A"}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Duplex
              </p>
              <p className="font-semibold xl:text-md text-sm">
                {isConnected
                  ? formatDuplex(status?.duplex ?? "")
                  : "N/A"}
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground xl:text-md text-sm">
                Set Link Speed
              </p>
              <Select
                value={status?.speed_limit ?? "auto"}
                onValueChange={handleSpeedChange}
                disabled={isSaving}
              >
                <SelectTrigger className="w-full max-w-46 font-semibold text-muted-foreground xl:text-md text-sm">
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
                  <SelectGroup className="font-semibold text-muted-foreground xl:text-md text-sm">
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
