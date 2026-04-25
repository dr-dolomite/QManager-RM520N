"use client";

import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useLanConfig } from "@/hooks/use-lan-config";
import { toast } from "sonner";

function ValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="grid gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  );
}

function formatLease(seconds: number | null) {
  if (!seconds) return "-";
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

export default function LanConfigComponent() {
  const { data, error, isLoading, isRefreshing, isSaving, refresh, saveConfig } =
    useLanConfig();
  const [lanIp, setLanIp] = useState("");
  const [subnetMask, setSubnetMask] = useState("");
  const [dhcpEnabled, setDhcpEnabled] = useState(true);
  const [dhcpStart, setDhcpStart] = useState("");
  const [dhcpEnd, setDhcpEnd] = useState("");
  const [leaseTime, setLeaseTime] = useState("43200");

  useEffect(() => {
    if (!data) return;
    setLanIp(data.lan.ip_address);
    setSubnetMask(data.lan.subnet_mask);
    setDhcpEnabled(data.dhcp.enabled);
    setDhcpStart(data.dhcp.start_ip);
    setDhcpEnd(data.dhcp.end_ip);
    setLeaseTime(String(data.dhcp.lease_time_seconds ?? 43200));
  }, [data]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      lanIp !== data.lan.ip_address ||
      subnetMask !== data.lan.subnet_mask ||
      dhcpEnabled !== data.dhcp.enabled ||
      dhcpStart !== data.dhcp.start_ip ||
      dhcpEnd !== data.dhcp.end_ip ||
      leaseTime !== String(data.dhcp.lease_time_seconds ?? 43200)
    );
  }, [data, lanIp, subnetMask, dhcpEnabled, dhcpStart, dhcpEnd, leaseTime]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const lease = Number.parseInt(leaseTime, 10);
    if (!Number.isFinite(lease)) {
      toast.error("Lease time must be numeric");
      return;
    }

    const result = await saveConfig({
      lan_ip: lanIp.trim(),
      subnet_mask: subnetMask.trim(),
      dhcp_enabled: dhcpEnabled,
      dhcp_start: dhcpStart.trim(),
      dhcp_end: dhcpEnd.trim(),
      lease_time_seconds: lease,
    });

    if (!result?.success) {
      toast.error(result?.detail || result?.error || "Failed to save LAN config");
      return;
    }

    if (result.at_lanip_warning) {
      toast.warning(result.at_lanip_warning);
    } else {
      toast.success("LAN/DHCP settings saved. Reboot if clients do not pick up the new range.");
    }
  };

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6 flex flex-col gap-4 @3xl/main:flex-row @3xl/main:items-start @3xl/main:justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">LAN &amp; DHCP Settings</h1>
          <p className="text-muted-foreground">
            Configure the modem&apos;s local gateway address and DHCP pool for
            Ethernet clients.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={isRefreshing}>
          <RefreshCwIcon className={isRefreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_320px]">
          <LoadingCard />
          <LoadingCard />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Network Configuration</CardTitle>
              <CardDescription>
                Changing the LAN IP may move the GUI to the new address.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={handleSave}>
                <div className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="lan-ip">LAN IP</Label>
                    <Input
                      id="lan-ip"
                      value={lanIp}
                      onChange={(event) => setLanIp(event.target.value)}
                      placeholder="192.168.225.1"
                      disabled={isSaving}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="subnet-mask">Subnet Mask</Label>
                    <Input
                      id="subnet-mask"
                      value={subnetMask}
                      onChange={(event) => setSubnetMask(event.target.value)}
                      placeholder="255.255.252.0"
                      disabled={isSaving}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="dhcp-start">DHCP Range Start</Label>
                    <Input
                      id="dhcp-start"
                      value={dhcpStart}
                      onChange={(event) => setDhcpStart(event.target.value)}
                      placeholder="192.168.225.20"
                      disabled={isSaving || !dhcpEnabled}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="dhcp-end">DHCP Range End</Label>
                    <Input
                      id="dhcp-end"
                      value={dhcpEnd}
                      onChange={(event) => setDhcpEnd(event.target.value)}
                      placeholder="192.168.225.170"
                      disabled={isSaving || !dhcpEnabled}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="lease-time">Lease Time (seconds)</Label>
                    <Input
                      id="lease-time"
                      type="number"
                      min={60}
                      max={604800}
                      value={leaseTime}
                      onChange={(event) => setLeaseTime(event.target.value)}
                      disabled={isSaving || !dhcpEnabled}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div>
                      <Label htmlFor="dhcp-enabled">DHCP Server</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable the modem DHCP server for LAN clients.
                      </p>
                    </div>
                    <Switch
                      id="dhcp-enabled"
                      checked={dhcpEnabled}
                      onCheckedChange={setDhcpEnabled}
                      disabled={isSaving}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={!isDirty || isSaving}>
                    {isSaving ? "Saving..." : "Save Settings"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving}
                    onClick={() => {
                      setLanIp(data.lan.ip_address);
                      setSubnetMask(data.lan.subnet_mask);
                      setDhcpEnabled(data.dhcp.enabled);
                      setDhcpStart(data.dhcp.start_ip);
                      setDhcpEnd(data.dhcp.end_ip);
                      setLeaseTime(String(data.dhcp.lease_time_seconds ?? 43200));
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current Status</CardTitle>
              <CardDescription>
                Active LAN and DHCP values reported by the modem.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ValueRow
                label="DHCP"
                value={
                  <Badge variant={data.dhcp.enabled ? "success" : "secondary"}>
                    {data.dhcp.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                }
              />
              <ValueRow label="Gateway" value={data.lan.ip_address || "-"} />
              <ValueRow label="Subnet" value={data.lan.subnet_mask || "-"} />
              <ValueRow
                label="DHCP Pool"
                value={`${data.dhcp.start_ip || "-"} - ${data.dhcp.end_ip || "-"}`}
              />
              <ValueRow
                label="Lease"
                value={formatLease(data.dhcp.lease_time_seconds)}
              />
              <ValueRow
                label="bridge0"
                value={`${data.lan.bridge0.state || "unknown"} ${
                  data.lan.bridge0.ipv4_cidr || ""
                }`}
              />
              <ValueRow
                label="eth0"
                value={`${data.lan.eth0.state || "unknown"} ${
                  data.lan.eth0.ipv4_cidr || ""
                }`}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
