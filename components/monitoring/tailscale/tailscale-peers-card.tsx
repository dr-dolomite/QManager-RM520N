"use client";

import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MotionTableRow = motion.create(TableRow);

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UsersIcon, ShieldIcon, AlertCircle } from "lucide-react";
import type { TailscaleStatus, TailscalePeer } from "@/hooks/use-tailscale";

// =============================================================================
// TailscalePeersCard — Peer list table for Tailscale network
// =============================================================================

interface TailscalePeersCardProps {
  status: TailscaleStatus | null;
  isLoading: boolean;
  error?: string | null;
}

function formatLastSeen(lastSeen: string, online: boolean): string {
  if (online) return "Now";
  if (!lastSeen) return "Unknown";

  const date = new Date(lastSeen);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0 || isNaN(diffMs)) return lastSeen;

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function capitalizeOS(os: string): string {
  if (!os) return "—";
  // Common OS name formatting
  const map: Record<string, string> = {
    linux: "Linux",
    windows: "Windows",
    macos: "macOS",
    darwin: "macOS",
    ios: "iOS",
    android: "Android",
    freebsd: "FreeBSD",
  };
  return map[os.toLowerCase()] || os.charAt(0).toUpperCase() + os.slice(1);
}

export function TailscalePeersCard({
  status,
  isLoading,
  error,
}: TailscalePeersCardProps) {
  const isConnected = status?.backend_state === "Running";
  const peers: TailscalePeer[] = (isConnected && status?.peers) || [];
  const hasExitNode = peers.some((p) => p.exit_node);

  // --- Loading skeleton ------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Network Peers</CardTitle>
          <CardDescription>
            Devices on your Tailscale network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="border-b px-4 py-3">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state (fetch failed, no data) ------------------------------------
  if (!isLoading && error && !status) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Network Peers</CardTitle>
          <CardDescription>
            Devices on your Tailscale network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <AlertCircle className="size-10 text-destructive" />
            <p className="text-sm text-muted-foreground text-center">
              Failed to load peer data.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Empty / not connected state -------------------------------------------
  if (!isConnected || peers.length === 0) {
    const message = !isConnected
      ? "Connect to Tailscale to see your network peers."
      : "No peers found on your Tailscale network.";

    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Network Peers</CardTitle>
          <CardDescription>
            Devices on your Tailscale network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <UsersIcon className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              {message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Peer table ------------------------------------------------------------
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Network Peers</CardTitle>
        <CardDescription>
          Devices on your Tailscale network.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead className="hidden @sm/card:table-cell">OS</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="hidden @md/card:table-cell w-24">
                  Last Seen
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-live="polite">
              {peers.map((peer, i) => (
                <MotionTableRow
                  key={`${peer.hostname}-${peer.tailscale_ips?.[0] ?? i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.05, 0.4), ease: "easeOut" }}
                >
                  <TableCell className="max-w-48">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate">
                          {peer.hostname || "Unknown"}
                        </span>
                        {peer.exit_node && (
                          <Badge
                            variant="outline"
                            className="text-xs shrink-0"
                          >
                            <ShieldIcon className="size-3 mr-1" />
                            Exit Node
                          </Badge>
                        )}
                      </div>
                      {peer.dns_name && (
                        <span className="block text-xs text-muted-foreground truncate">
                          {peer.dns_name.replace(/\.$/, "")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {peer.tailscale_ips?.[0] || "—"}
                  </TableCell>
                  <TableCell className="hidden @sm/card:table-cell text-sm">
                    {capitalizeOS(peer.os)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={peer.online ? "success" : "secondary"}
                    >
                      {peer.online ? "Online" : "Offline"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden @md/card:table-cell text-xs text-muted-foreground">
                    {formatLastSeen(peer.last_seen, peer.online)}
                  </TableCell>
                </MotionTableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <div className="text-xs text-muted-foreground">
          Showing <strong>{peers.length}</strong>{" "}
          {peers.length === 1 ? "peer" : "peers"}
        </div>
        {hasExitNode && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldIcon className="size-3" />
            Exit node active
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
