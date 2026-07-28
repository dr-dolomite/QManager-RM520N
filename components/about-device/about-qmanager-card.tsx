"use client";

import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import QManagerMark from "@/public/qmanager-mark.svg";
import packageJson from "@/package.json";

import type { AboutDeviceData } from "@/types/about-device";

// =============================================================================
// AboutQManagerCard — QManager info + network details
// =============================================================================

interface AboutQManagerCardProps {
  data: AboutDeviceData | null;
  isLoading: boolean;
}

const AboutQManagerCard = ({ data, isLoading }: AboutQManagerCardProps) => {
  const networkRows = [
    { label: "Device IP", value: data?.network.device_ip },
    { label: "LAN Gateway", value: data?.network.lan_gateway },
    { label: "WWAN IPv4", value: data?.network.wan_ipv4 },
    { label: "WWAN IPv6", value: data?.network.wan_ipv6 },
    { label: "Public IPv4", value: data?.network.public_ipv4 },
    { label: "Public IPv6", value: data?.network.public_ipv6 },
  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">About QManager</CardTitle>
        <CardDescription>
          Modem management interface for Quectel modems.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6">
          {/* Logo */}
          <div className="flex items-center justify-center">
            <Image
              src={QManagerMark}
              alt="QManager"
              className="size-24"
              priority
            />
          </div>

          {/* Description */}
          <div className="grid gap-y-4">
            <p className="text-sm text-muted-foreground text-pretty leading-relaxed font-medium">
              Hey there! Rus here. QManager is the latest iteration of
              QuecManager, built with a newer and more reliable approach
              compared to its predecessor &mdash; while still combining
              technical settings for advanced users with a simplified UI for
              those just getting started. QManager promises to deliver the same
              features QuecManager had, only better, more reliable, and more
              user-friendly. Special thanks to iamromulan, clndwhr, and Wutang
              Clan! If you like this project, any kind of support is much
              appreciated. Thanks!
            </p>

            {/* All rights reserved */}
            <p className="text-sm text-muted-foreground text-center">
              © {new Date().getFullYear()} QManager. All rights reserved.
            </p>
          </div>

          {/* QManager version */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              QManager
            </h3>
            <dl className="grid divide-y divide-border border-y border-border">
              <div className="flex items-center justify-between py-2">
                <dt className="text-sm font-semibold text-muted-foreground">
                  Version
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {packageJson.version}
                </dd>
              </div>
            </dl>
          </div>

          {/* Network info */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Network
            </h3>
            <dl className="grid divide-y divide-border border-y border-border">
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2"
                    >
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))
                : networkRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between py-2"
                    >
                      <dt className="text-sm font-semibold text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd
                        className="text-sm font-semibold tabular-nums min-w-0 truncate ml-4"
                        title={row.value || undefined}
                      >
                        {row.value || "-"}
                      </dd>
                    </div>
                  ))}
            </dl>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AboutQManagerCard;
