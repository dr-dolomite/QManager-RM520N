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
import type {
  InstallResult,
  TailscaleActionResult,
  TailscaleStatus,
} from "@/hooks/use-tailscale";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import { InstallLogViewer } from "./install-log-viewer";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  METRIC,
  SKELETON,
  type TailscaleView,
} from "./shapes";
import { UpdateControl } from "./update-control";

// -----------------------------------------------------------------------------
// This device — the tailnet identity, as pill rows. No hairlines.
// -----------------------------------------------------------------------------

interface IdentityRow {
  key: string;
  label: string;
  value: string;
  /** Identifiers are mono; a version is a quantity and reads in the UI face. */
  mono?: boolean;
}

/** Identifiers the device emitted are mono; the version is the one quantity. */
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
  isUpdating,
  installResult,
  runUpdate,
}: {
  view: TailscaleView;
  status: TailscaleStatus;
  isUpdating: boolean;
  /** The shared install/update transcript; read here only while an update runs. */
  installResult: InstallResult;
  runUpdate: () => Promise<TailscaleActionResult>;
}) {
  const { t } = useTranslation("common");
  const identity = view === "running" ? identityRows(status, t) : [];
  // The version is shown in every installed view; the identity rows only while connected.
  const rows: IdentityRow[] = status.version
    ? [
        ...identity,
        {
          key: "version",
          label: t("tailscale.device.version"),
          value: status.version,
          mono: false,
        },
      ]
    : identity;

  // The update is offered on the Version row, never louder than the version.
  const updating = isUpdating || status.busy === "update";
  const latestVersion = status.latest_version ?? "";
  const updateAvailable = !!status.update_available && latestVersion !== "";

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.device.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.device.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {identity.length === 0 ? (
          <ConditionBlock
            tone="muted"
            icon={UnplugIcon}
            title={t("tailscale.device.emptyTitle")}
            description={t("tailscale.device.emptyDescription")}
          />
        ) : null}
        {rows.length > 0 ? (
          // Nested container: it inherits `visible` and must NOT declare its own.
          <motion.div className={METRIC.STACK} variants={staggerRows}>
            {rows.map((row) => (
              <motion.div
                key={row.key}
                className={METRIC.ROW}
                variants={staggerRowItem}
              >
                <span className={METRIC.LABEL}>{row.label}</span>
                <span
                  className={cn(
                    row.mono === false ? METRIC.VALUE : METRIC.VALUE_MONO,
                    // The update chip must not squeeze the version it follows.
                    row.key === "version" && "shrink-0",
                  )}
                  title={row.value}
                >
                  {row.value}
                </span>
                {row.key === "version" && (updateAvailable || updating) ? (
                  <UpdateControl
                    latestVersion={latestVersion}
                    updating={updating}
                    disabled={!!status.busy}
                    runUpdate={runUpdate}
                  />
                ) : null}
              </motion.div>
            ))}
          </motion.div>
        ) : null}

        {/* The transcript of a running update; the install log's twin. */}
        {updating ? (
          <InstallLogViewer
            title={t("tailscale.connection.updateLogTitle")}
            log={installResult.op === "update" ? (installResult.log ?? "") : ""}
            isRunning
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Mirrors the loaded row height from the same constant. */
export function DeviceCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.device.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.device.description")}
          </CardDescription>
        </div>
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
