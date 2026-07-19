"use client";

import React, { useState } from "react";
import { motion, type Variants } from "motion/react";
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

import type { DeviceStatus } from "@/types/modem-status";
import packageJson from "@/package.json";

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
};

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
    { label: t("device_status.firmware_version"), value: data?.firmware || "-" },
    { label: t("device_status.build_date"), value: data?.build_date || "-" },
    {
      label: t("device_status.phone_number"),
      value: data?.phone_number || "-",
      mono: true,
      private: true,
    },
    { label: t("device_status.imsi"), value: data?.imsi || "-", mono: true, private: true },
    { label: t("device_status.iccid"), value: data?.iccid || "-", mono: true, private: true },
    {
      label: t("device_status.device_imei"),
      value: data?.imei || "-",
      mono: true,
      private: true,
    },
    {
      label: t("device_status.lte_category"),
      value: data?.lte_category ? `Cat ${data.lte_category}` : "-",
      mono: true,
    },
    { label: t("device_status.active_mimo"), value: data?.mimo || "-", mono: true },
    { label: t("device_status.lan_gateway"), value: lanGateway || "-", mono: true },
    { label: t("device_status.qmanager_version"), value: packageJson.version, mono: true },
  ];

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold @[250px]/card:text-3xl">
            {t("device_status.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="flex items-center justify-center mb-4">
              <Skeleton className="size-44 rounded-full" />
            </div>
            <div className="grid divide-y divide-border border-y border-border">
              {Array.from({ length: 11 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2"
                >
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-36" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold @[250px]/card:text-3xl">
          Device Information
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHidePrivate((prev) => !prev)}
            aria-label={
              hidePrivate
                ? t("device_status.show_private")
                : t("device_status.hide_private")
            }
          >
            {hidePrivate ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="flex items-center justify-center mb-4">
            <div className="size-44 bg-primary/15 rounded-full p-4 flex items-center justify-center">
              <img
                src="/device-icon.svg"
                alt={t("device_status.icon_alt")}
                className="size-full drop-shadow-md object-contain"
              />
            </div>
          </div>

          <motion.dl
            className="grid divide-y divide-border border-y border-border"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {rows.map((row) => (
              <motion.div key={row.label} variants={itemVariants} className="flex items-center justify-between py-2">
                <dt className="font-semibold text-muted-foreground xl:text-base text-sm">
                  {row.label}
                </dt>
                <dd
                  className={`font-semibold xl:text-base text-sm ${
                    row.mono ? "tabular-nums" : ""
                  }`}
                >
                  {hidePrivate && row.private ? "••••••••••••" : row.value}
                </dd>
              </motion.div>
            ))}
          </motion.dl>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceStatusComponent;
