"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  MinusCircleIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import type { TailscalePeer, TailscaleStatus } from "@/hooks/use-tailscale";
import { rowCascadeDelay, transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CROSSFADE_STACK,
  HEAD_TAG,
  SKELETON,
  TABLE,
} from "./shapes";

const MotionTableRow = motion.create(TableRow);

const peerRowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

/** Anything before this is the pre-clock-step 1970 window, not a real reading. */
const CLOCK_SANE_MS = Date.UTC(2020, 0, 1);
/** A year. Past this the delta is arithmetic on a bad clock, not an age. */
const AGE_CEILING_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The device has no battery RTC and boots at Jan 1970, so a delta taken before
 * the clock is stepped renders every peer as decades stale. Say unknown instead.
 */
function formatLastSeen(
  lastSeen: string,
  online: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (online) return t("tailscale.peers.seenNow");
  if (!lastSeen) return t("tailscale.peers.seenUnknown");

  const at = new Date(lastSeen).getTime();
  const now = Date.now();
  if (!Number.isFinite(at) || now < CLOCK_SANE_MS) {
    return t("tailscale.peers.seenUnknown");
  }

  const diff = now - at;
  if (diff < 0 || diff > AGE_CEILING_MS) return t("tailscale.peers.seenUnknown");

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("tailscale.peers.seenJustNow");
  if (minutes < 60) return t("tailscale.peers.seenMinutes", { n: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("tailscale.peers.seenHours", { n: hours });

  return t("tailscale.peers.seenDays", { n: Math.floor(hours / 24) });
}

const OS_NAMES: Record<string, string> = {
  linux: "Linux",
  windows: "Windows",
  macos: "macOS",
  darwin: "macOS",
  ios: "iOS",
  android: "Android",
  freebsd: "FreeBSD",
};

function osLabel(os: string, dash: string): string {
  if (!os) return dash;
  return OS_NAMES[os.toLowerCase()] ?? os.charAt(0).toUpperCase() + os.slice(1);
}

export interface PeersCardProps {
  status: TailscaleStatus | null;
  isLoading: boolean;
  error?: string | null;
  onRetry: () => void;
}

export function PeersCard({
  status,
  isLoading,
  error,
  onRetry,
}: PeersCardProps) {
  const { t } = useTranslation("common");
  const dash = t("tailscale.peers.dash");

  const connected = status?.backend_state === "Running";
  const peers: TailscalePeer[] = (connected && status?.peers) || [];
  const onlineCount = peers.filter((p) => p.online).length;
  const exitNodes = peers.filter((p) => p.exit_node).length;

  let body: React.ReactNode;
  if (!isLoading && !status && error) {
    body = (
      <ConditionBlock
        tone="destructive"
        icon={TriangleAlertIcon}
        title={t("tailscale.peers.errorTitle")}
        description={error}
        actionLabel={t("tailscale.actions.retry")}
        actionIcon={RefreshCcwIcon}
        onAction={onRetry}
      />
    );
  } else if (peers.length === 0) {
    body = (
      <ConditionBlock
        tone="muted"
        icon={UsersIcon}
        title={
          connected
            ? t("tailscale.peers.emptyTitle")
            : t("tailscale.peers.offlineTitle")
        }
        description={
          connected
            ? t("tailscale.peers.emptyDescription")
            : t("tailscale.peers.offlineDescription")
        }
      />
    );
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow className={TABLE.ROW}>
            <TableHead className={TABLE.HEAD}>
              {t("tailscale.peers.colDevice")}
            </TableHead>
            <TableHead className={TABLE.HEAD}>
              {t("tailscale.peers.colAddress")}
            </TableHead>
            <TableHead className={cn(TABLE.HEAD, "hidden @sm/card:table-cell")}>
              {t("tailscale.peers.colOs")}
            </TableHead>
            <TableHead className={cn(TABLE.HEAD, "w-24")}>
              {t("tailscale.peers.colStatus")}
            </TableHead>
            <TableHead
              className={cn(TABLE.HEAD, "hidden w-28 @md/card:table-cell")}
            >
              {t("tailscale.peers.colLastSeen")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody aria-live="polite">
          {peers.map((peer, i) => (
            <MotionTableRow
              key={`${peer.hostname}-${peer.tailscale_ips?.[0] ?? i}`}
              className={cn(TABLE.ROW, TABLE.ROW_HEIGHT)}
              custom={i}
              variants={peerRowItem}
              initial="hidden"
              animate="visible"
            >
              <TableCell className={cn(TABLE.CELL, "max-w-56")}>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={TABLE.NAME}>
                      {peer.hostname || t("tailscale.peers.unnamed")}
                    </span>
                    {/* A capability, not a status: an outline tag, never a badge. */}
                    {peer.exit_node ? (
                      <Tag variant="neutral" className={TABLE.TAG}>
                        {t("tailscale.peers.exitNode")}
                      </Tag>
                    ) : null}
                  </div>
                  {peer.dns_name ? (
                    <span className={TABLE.SUBNAME}>
                      {peer.dns_name.replace(/\.$/, "")}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className={TABLE.CELL_MONO}>
                {peer.tailscale_ips?.[0] || dash}
              </TableCell>
              <TableCell className={cn(TABLE.CELL, "hidden @sm/card:table-cell")}>
                {osLabel(peer.os, dash)}
              </TableCell>
              <TableCell className={TABLE.CELL}>
                {peer.online ? (
                  <Badge variant="success">
                    <CheckCircle2Icon className="size-3" />
                    {t("tailscale.peers.online")}
                  </Badge>
                ) : (
                  <Badge variant="muted">
                    <MinusCircleIcon className="size-3" />
                    {t("tailscale.peers.offline")}
                  </Badge>
                )}
              </TableCell>
              <TableCell
                className={cn(TABLE.CELL_MUTED, "hidden @md/card:table-cell")}
              >
                {formatLastSeen(peer.last_seen, peer.online, t)}
              </TableCell>
            </MotionTableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className="flex min-w-0 flex-col gap-1.5">
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.peers.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.peers.description")}
          </CardDescription>
        </div>
        {peers.length > 0 ? (
          <div className={CARD_HEAD_ACTIONS}>
            <Tag variant="neutral" className={HEAD_TAG}>
              {t("tailscale.peers.countOnline", {
                online: onlineCount,
                total: peers.length,
              })}
            </Tag>
            {exitNodes > 0 ? (
              <Tag variant="neutral" className={HEAD_TAG}>
                {t("tailscale.peers.countExitNodes", { count: exitNodes })}
              </Tag>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {/* Skeleton and table share ONE grid cell, so the swap costs no shift. */}
        <div className={cn(CROSSFADE_STACK, "flex-1")}>
          {isLoading && !status ? <PeersSkeleton /> : body}
        </div>
      </CardContent>
    </Card>
  );
}

/** Placeholder rows read the SAME pinned height constant the real rows do. */
function PeersSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      <Skeleton className={SKELETON.HEAD} />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={SKELETON.ROW} />
      ))}
    </div>
  );
}
