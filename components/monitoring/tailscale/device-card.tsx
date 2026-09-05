"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { UnplugIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TailscaleStatus } from "@/hooks/use-tailscale";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  METRIC,
  SKELETON,
  type TailscaleView,
} from "./shapes";

// -----------------------------------------------------------------------------
// This device — the tailnet identity, as pill rows. No hairlines.
// -----------------------------------------------------------------------------

interface IdentityRow {
  key: string;
  label: string;
  value: string;
}

/** Everything here is an identifier the device emitted, so every value is mono. */
function identityRows(
  status: TailscaleStatus,
  t: (key: string) => string,
): IdentityRow[] {
  const self = status.self;
  const tailnet = status.tailnet;
  const ips = self?.tailscale_ips ?? [];
  const ipv4 = ips.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
  const ipv6 = ips.find((ip) => ip.includes(":"));
  const dnsName = self?.dns_name?.replace(/\.$/, "");
  const magicSuffix = tailnet?.magic_dns_enabled
    ? tailnet.magic_dns_suffix
    : "";

  const rows: IdentityRow[] = [];
  if (self?.hostname)
    rows.push({
      key: "hostname",
      label: t("tailscale.device.hostname"),
      value: self.hostname,
    });
  if (ipv4)
    rows.push({ key: "ipv4", label: t("tailscale.device.ipv4"), value: ipv4 });
  if (ipv6)
    rows.push({ key: "ipv6", label: t("tailscale.device.ipv6"), value: ipv6 });
  if (dnsName)
    rows.push({
      key: "dns",
      label: t("tailscale.device.dnsName"),
      value: dnsName,
    });
  if (tailnet?.name)
    rows.push({
      key: "tailnet",
      label: t("tailscale.device.tailnet"),
      value: tailnet.name,
    });
  if (magicSuffix)
    rows.push({
      key: "magicdns",
      label: t("tailscale.device.magicDns"),
      value: magicSuffix,
    });
  // Not upper-cased: the relay name is what the daemon reported, verbatim.
  if (self?.relay)
    rows.push({
      key: "relay",
      label: t("tailscale.device.relay"),
      value: self.relay,
    });

  return rows;
}

export function DeviceCard({
  view,
  status,
}: {
  view: TailscaleView;
  status: TailscaleStatus;
}) {
  const { t } = useTranslation("common");
  const rows = view === "running" ? identityRows(status, t) : [];

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("tailscale.device.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("tailscale.device.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {rows.length === 0 ? (
          <ConditionBlock
            tone="muted"
            icon={UnplugIcon}
            title={t("tailscale.device.emptyTitle")}
            description={t("tailscale.device.emptyDescription")}
          />
        ) : (
          // Nested container: it inherits `visible` and must NOT declare its own.
          <motion.div className={METRIC.STACK} variants={staggerRows}>
            {rows.map((row) => (
              <motion.div
                key={row.key}
                className={METRIC.ROW}
                variants={staggerRowItem}
              >
                <span className={METRIC.LABEL}>{row.label}</span>
                <span className={METRIC.VALUE_MONO} title={row.value}>
                  {row.value}
                </span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

/** Mirrors the loaded row height from the same constant. */
export function DeviceCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("tailscale.device.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("tailscale.device.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <div className={METRIC.STACK}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className={SKELETON.METRIC} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
