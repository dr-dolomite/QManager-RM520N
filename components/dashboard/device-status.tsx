"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";

import { formatUptime, type DeviceStatus } from "@/types/modem-status";
import packageJson from "@/package.json";

const MASK = "••••••••••••";

/**
 * Live value tick (DESIGN.md > Motion > "Live value tick"): an 180ms opacity
 * dip when the rendered text changes, and nothing else — no fade-out-then-in,
 * no layout shift, no color flash. Driven by remounting on a key derived from
 * the value itself, so a poll that returns the same string animates nothing.
 * Opacity-only, so it survives `prefers-reduced-motion` intact and stays
 * non-load-bearing: the final text is correct whether or not the dip runs.
 */
const TickValue = ({
  value,
  className,
}: {
  value: string;
  className?: string;
}) => (
  <motion.span
    key={value}
    initial={{ opacity: 0.3 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.18, ease: "easeOut" }}
    className={className}
  >
    {value}
  </motion.span>
);

interface DeviceStatusComponentProps {
  data: DeviceStatus | null;
  isLoading: boolean;
  lanGateway?: string;
}

const DeviceStatusComponent = ({
  data,
  isLoading,
  lanGateway,
}: DeviceStatusComponentProps) => {
  const { t } = useTranslation("dashboard");
  const [hidePrivate, setHidePrivate] = useState(false);

  const rows = [
    { label: t("device_status.manufacturer"), value: data?.manufacturer || "-" },
    {
      label: t("device_status.firmware_version"),
      value: data?.firmware || "-",
      mono: true,
    },
    { label: t("device_status.build_date"), value: data?.build_date || "-" },
    {
      label: t("device_status.phone_number"),
      value: data?.phone_number || "-",
      mono: true,
      private: true,
    },
    {
      label: t("device_status.imsi"),
      value: data?.imsi || "-",
      mono: true,
      private: true,
    },
    {
      label: t("device_status.iccid"),
      value: data?.iccid || "-",
      mono: true,
      private: true,
    },
    {
      label: t("device_status.device_imei"),
      value: data?.imei || "-",
      mono: true,
      private: true,
    },
    { label: t("device_status.lan_gateway"), value: lanGateway || "-", mono: true },
    {
      label: t("device_status.qmanager_version"),
      value: packageJson.version,
      mono: true,
    },
  ];

  const connUptime = data?.conn_uptime_seconds ?? 0;
  const deviceUptime = data?.uptime_seconds ?? 0;

  if (isLoading) {
    return (
      <Card className="@container/card h-full gap-4 rounded-hero border-0 bg-surface">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tracking-tight @[250px]/card:text-3xl">
            {t("device_status.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="flex justify-center pt-1.5 pb-2.5">
            <Skeleton className="aspect-square w-[188px] max-w-full rounded-full" />
          </div>
          <dl className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <Skeleton key={row.label} className="h-[41px] rounded-pill" />
            ))}
          </dl>
          <div className="mt-auto flex gap-2.5 pt-2">
            <Skeleton className="h-[62px] flex-1 rounded-tile" />
            <Skeleton className="h-[62px] flex-1 rounded-tile" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card h-full gap-4 rounded-hero border-0 bg-surface">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight @[250px]/card:text-3xl">
          {t("device_status.title")}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHidePrivate((prev) => !prev)}
            aria-pressed={hidePrivate}
            className="size-9 rounded-pill bg-surface-container text-on-surface-variant transition-colors duration-(--duration-quick) ease-quick hover:bg-surface-container-high"
            aria-label={
              hidePrivate
                ? t("device_status.show_private")
                : t("device_status.hide_private")
            }
          >
            {hidePrivate ? (
              <EyeOff className="size-5" />
            ) : (
              <Eye className="size-5" />
            )}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {/* Hero: the module itself, on a primary-container disc. Deliberately
            still — the One-Loop Rule reserves ambient motion for surfaces
            where something is genuinely live, and a photo of a modem is not. */}
        <div className="flex justify-center pt-1.5 pb-2.5">
          <div className="grid aspect-square w-[188px] max-w-full place-items-center rounded-full bg-primary-container p-[18px]">
            <img
              src="/device-icon.svg"
              alt={t("device_status.icon_alt")}
              className="size-full object-contain drop-shadow-[0_4px_6px_oklch(0.15_0.03_262_/_0.35)] dark:drop-shadow-[0_4px_8px_oklch(0.05_0.02_262_/_0.6)]"
            />
          </div>
        </div>

        <motion.dl
          className="flex flex-col gap-1.5"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {rows.map((row) => {
            const masked = hidePrivate && row.private;
            const display = masked ? MASK : row.value;
            return (
              <motion.div
                key={row.label}
                variants={staggerItem}
                className="flex items-center justify-between gap-3 rounded-pill bg-surface-container px-[15px] py-2.5"
              >
                <dt className="text-sm font-semibold text-on-surface-variant">
                  {row.label}
                </dt>
                {/* The mask swap rides the same 180ms tick as a live value —
                    the label changes, the row does not move.
                    `shrink-0`: when the pill runs out of room on a phone the
                    label wraps and the row grows taller. The value is what the
                    user opened this card to read, so it is never the thing
                    that gets clipped — a half-printed IMEI is worse than a
                    two-line label. */}
                <dd
                  className={cn(
                    "shrink-0 text-right text-sm font-semibold",
                    row.mono && "font-mono tabular-nums",
                  )}
                >
                  <TickValue value={display} />
                </dd>
              </motion.div>
            );
          })}
        </motion.dl>

        {/* Uptime tiles. `mt-auto` pins them to the floor of the stretched
            panel so the card never ends in dead space. The connection tile
            only wears the success fill while the connection is actually up —
            a green tile over a dead link would be the UI lying. The fill
            morphs over `standard` when that flips, per the chip-swap recipe. */}
        <div className="mt-auto flex gap-2.5 pt-2">
          <div
            className={cn(
              "flex flex-1 flex-col gap-px rounded-tile px-4 py-3 transition-colors duration-(--duration-standard) ease-standard",
              connUptime > 0
                ? "bg-success-container text-on-success-container"
                : "bg-surface-container",
            )}
          >
            <span
              className={cn(
                "text-xs font-semibold tracking-[0.06em] uppercase",
                connUptime > 0 ? "" : "text-on-surface-variant",
              )}
            >
              {t("device_status.conn_uptime_short")}
            </span>
            <TickValue
              className="font-mono text-base font-semibold tabular-nums"
              value={connUptime > 0 ? formatUptime(connUptime) : "-"}
            />
          </div>
          <div className="flex flex-1 flex-col gap-px rounded-tile bg-surface-container px-4 py-3">
            <span className="text-xs font-semibold tracking-[0.06em] text-on-surface-variant uppercase">
              {t("device_status.device_uptime_short")}
            </span>
            <TickValue
              className="font-mono text-base font-semibold tabular-nums"
              value={deviceUptime > 0 ? formatUptime(deviceUptime) : "-"}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceStatusComponent;
