"use client";

import {
  CheckCircle2Icon,
  XCircleIcon,
  MinusCircleIcon,
  TriangleAlertIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { TbInfoCircleFilled } from "react-icons/tb";
import { motion, type Variants } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { MetricBar } from "@/components/ui/metric-bar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModemSubsys } from "@/hooks/use-modem-subsys";
import type { ModemSubsysState } from "@/types/modem-subsys";
import { staggerContainer, staggerItem } from "@/lib/motion";

// ─── Animation variants ────────────────────────────────────────────────────



// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── State badge ────────────────────────────────────────────────────────────

function ModemStateBadge({ state }: { state: ModemSubsysState }) {
  switch (state) {
    case "online":
      return (
        <Badge variant="success">
          <CheckCircle2Icon className="size-3" />
          Online
        </Badge>
      );
    case "crashed":
      return (
        <Badge variant="destructive">
          <XCircleIcon className="size-3" />
          Crashed
        </Badge>
      );
    case "offline":
      return (
        <Badge variant="muted">
          <MinusCircleIcon className="size-3" />
          Offline
        </Badge>
      );
    case "unknown":
    default:
      return (
        <Badge variant="muted">
          <MinusCircleIcon className="size-3" />
          Unknown
        </Badge>
      );
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ModemSubsystemCard() {
  const { data, isLoading, error, refetch } = useModemSubsys();

  // --- Loading skeleton ---
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>
            Subsystem state and host resource usage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {/* State */}
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-6 w-20" />
            </div>
            {/* Crashes since boot */}
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-8" />
            </div>
            {/* Last crashed */}
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-24" />
            </div>
            {/* CPU Frequency */}
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-16" />
            </div>
            {/* CPU Usage */}
            <Separator />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-12" />
              </div>
              <Skeleton className="h-1 w-full" />
            </div>
            {/* Load Average */}
            <Separator />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-28" />
              </div>
              <Skeleton className="h-1 w-full" />
            </div>
            {/* Memory */}
            <Separator />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-28" />
              </div>
              <Skeleton className="h-1 w-full" />
            </div>
            {/* Storage */}
            <Separator />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-28" />
              </div>
              <Skeleton className="h-1 w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Error state ---
  if (error && !data) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>
            Subsystem state and host resource usage.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            className="self-start"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // --- Derived metric values ---
  const load1m = data?.cpu?.load_1m ?? null;
  const load5m = data?.cpu?.load_5m ?? null;
  const load15m = data?.cpu?.load_15m ?? null;
  const coreCount = data?.cpu?.core_count ?? null;
  const cpuUsagePct = data?.cpu?.usage_pct ?? null;

  const freqKhz = data?.cpu?.freq_khz ?? null;

  // Load-average bar tuning, anchored to core count so the bar means the same
  // thing on 1-core and N-core devices. On a 1-core RM520N-GL these resolve to
  // warn=1.5, danger=2.0, max=3.0 — matches the "above 2 = problem" rule of
  // thumb and leaves visual headroom so the bar isn't pegged at 100%.
  const loadBarMax = coreCount !== null ? coreCount * 3 : null;
  const loadWarnAt = coreCount !== null ? coreCount * 1.5 : null;
  const loadDangerAt = coreCount !== null ? coreCount * 2 : null;
  const showLoadRow =
    load1m !== null &&
    coreCount !== null &&
    loadBarMax !== null &&
    loadWarnAt !== null &&
    loadDangerAt !== null;

  const memTotalKb = data?.memory?.total_kb ?? 0;
  const memUsedKb = data?.memory?.used_kb ?? 0;
  const showMemBar = data?.memory != null && memTotalKb > 0;

  const storageTotalKb = data?.storage?.total_kb ?? 0;
  const storageUsedKb = data?.storage?.used_kb ?? 0;
  const showStorageBar = data?.storage != null && storageTotalKb > 0;

  // --- Data state ---
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>System Health</CardTitle>
        <CardDescription>
          Subsystem state and host resource usage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <motion.div
          className="grid gap-2"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* ── State ──────────────────────────────────────────────── */}
          <Separator />
          <motion.div
            variants={staggerItem}
            className="flex items-center justify-between"
          >
            <p className="font-semibold text-muted-foreground text-sm">State</p>
            {data ? (
              <ModemStateBadge state={data.state} />
            ) : (
              <Badge variant="muted">
                <MinusCircleIcon className="size-3" />
                Unknown
              </Badge>
            )}
          </motion.div>

          {/* ── Crashes since boot ─────────────────────────────────── */}
          <Separator />
          <motion.div
            variants={staggerItem}
            className="flex items-center justify-between"
          >
            <p className="font-semibold text-muted-foreground text-sm">
              Crashes since boot
            </p>
            <p className="text-sm font-medium tabular-nums">
              {data?.crash_count != null ? data.crash_count : "—"}
            </p>
          </motion.div>

          {/* ── Last crashed ───────────────────────────────────────── */}
          <Separator />
          <motion.div
            variants={staggerItem}
            className="flex items-center justify-between"
          >
            <p className="font-semibold text-muted-foreground text-sm">
              Last crashed
            </p>
            <p className="text-sm font-medium tabular-nums">
              {data?.last_crash_at != null
                ? formatRelativeTime(data.last_crash_at)
                : "Never"}
            </p>
          </motion.div>

          {/* ── CPU Frequency ──────────────────────────────────────── */}
          <Separator />
          <motion.div
            variants={staggerItem}
            className="flex items-center justify-between"
          >
            <p className="font-semibold text-muted-foreground text-sm">
              CPU Frequency
            </p>
            <p className="text-sm font-medium tabular-nums">
              {freqKhz !== null
                ? `${(freqKhz / 1_000_000).toFixed(1)} GHz`
                : "—"}
            </p>
          </motion.div>

          {/* ── CPU Usage ──────────────────────────────────────────── */}
          <Separator />
          <motion.div variants={staggerItem} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                CPU Usage
              </p>
              <p className="text-sm font-medium tabular-nums">
                {cpuUsagePct !== null ? `${Math.round(cpuUsagePct)}%` : "—"}
              </p>
            </div>
            {cpuUsagePct !== null && (
              <MetricBar
                value={cpuUsagePct}
                max={100}
                warnAt={75}
                dangerAt={90}
              />
            )}
          </motion.div>

          {/* ── Load Average ───────────────────────────────────────── */}
          {showLoadRow && (
            <>
              <Separator />
              <motion.div
                variants={staggerItem}
                className="flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex"
                          aria-label="More info"
                        >
                          <TbInfoCircleFilled className="size-5 text-info" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Average number of processes waiting on the CPU over
                          the last 1, 5, and 15 minutes.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <p className="font-semibold text-muted-foreground text-sm">
                      Load Average
                    </p>
                  </div>
                  <p className="text-sm font-medium tabular-nums">
                    {load1m!.toFixed(2)}
                    <span className="text-muted-foreground"> / </span>
                    {load5m !== null ? load5m.toFixed(2) : "—"}
                    <span className="text-muted-foreground"> / </span>
                    {load15m !== null ? load15m.toFixed(2) : "—"}
                  </p>
                </div>
                <MetricBar
                  value={load1m!}
                  max={loadBarMax!}
                  warnAt={loadWarnAt!}
                  dangerAt={loadDangerAt!}
                />
              </motion.div>
            </>
          )}

          {/* ── Memory ─────────────────────────────────────────────── */}
          <Separator />
          <motion.div variants={staggerItem} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                Memory
              </p>
              <p className="text-sm font-medium tabular-nums">
                {data?.memory != null
                  ? `${Math.round(memUsedKb / 1024)} / ${Math.round(memTotalKb / 1024)} MB`
                  : "—"}
              </p>
            </div>
            {showMemBar && (
              <MetricBar
                value={(memUsedKb / memTotalKb) * 100}
                max={100}
                warnAt={70}
                dangerAt={90}
              />
            )}
          </motion.div>

          {/* ── Storage ────────────────────────────────────────────── */}
          <Separator />
          <motion.div variants={staggerItem} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p
                className="font-semibold text-muted-foreground text-sm"
                title="/usrdata partition"
              >
                Storage
              </p>
              <p className="text-sm font-medium tabular-nums">
                {data?.storage != null
                  ? `${Math.round(storageUsedKb / 1024)} / ${Math.round(storageTotalKb / 1024)} MB`
                  : "—"}
              </p>
            </div>
            {showStorageBar && (
              <MetricBar
                value={(storageUsedKb / storageTotalKb) * 100}
                max={100}
                warnAt={70}
                dangerAt={90}
              />
            )}
          </motion.div>

          {/* ── Coredump warning (rendered only when present) ──────── */}
          {data?.coredump_present && (
            <>
              <Separator />
              <motion.div
                variants={staggerItem}
                className="flex items-center justify-between"
              >
                <p className="font-semibold text-muted-foreground text-sm">
                  Diagnostic data
                </p>
                <Badge variant="warning">
                  <TriangleAlertIcon className="size-3" />
                  Coredump available
                </Badge>
              </motion.div>
            </>
          )}
        </motion.div>
      </CardContent>
    </Card>
  );
}
