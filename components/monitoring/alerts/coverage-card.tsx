"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BellOffIcon,
  PlugZapIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALERT_CHANNEL_ORDER,
  type AlertChannel,
  type AlertEventKey,
} from "@/types/alerts";
import {
  CARD_DESC,
  CARD_HEAD,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  HERO_PAD,
  HERO_SHELL,
  NOTICE,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PILL_GLYPH,
  type NoticeTone,
} from "./shapes";
import { OUTAGE_EVENT, type AlertsCoverage } from "./derive";
import { CoverageMatrix, CoverageMatrixSkeleton } from "./alert-routing-grid";
import { coverageIsEmpty } from "./coverage-model";
import { channelNameKey } from "./coverage-labels";

// The anchor card. The page's condition is carried here, not by the matrix:
// the matrix always renders a full 3x3 or nothing at all.

export interface AlertsCoverageCardProps {
  /** Draft-resolved coverage. `null` renders the loading skeleton. */
  coverage: AlertsCoverage | null;
  onToggle: (
    event: AlertEventKey,
    channel: AlertChannel,
    next: boolean,
  ) => void;
  /** Set when the last read failed. With coverage it degrades to a stale notice. */
  error?: string | null;
  onRetry?: () => void;
  /** True while any edit on this page is still only in the browser. */
  isDirty?: boolean;
  /** Channels whose form is invalid, so nothing here can reach the device. */
  blockedChannels?: readonly AlertChannel[];
}

export function AlertsCoverageCard({
  coverage,
  onToggle,
  error,
  onRetry,
  isDirty,
  blockedChannels,
}: AlertsCoverageCardProps) {
  const { t } = useTranslation("common");

  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={HERO_PAD}>
        <div className={CARD_HEAD}>
          <div className="min-w-0">
            <CardTitle className={CARD_TITLE}>
              {t("alerts.coverage.title")}
            </CardTitle>
            <CardDescription className={CARD_DESC}>
              {t("alerts.coverage.description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn(HERO_PAD, "flex flex-col gap-4")}>
        <CoverageBody
          coverage={coverage}
          onToggle={onToggle}
          error={error}
          onRetry={onRetry}
          isDirty={isDirty}
          blockedChannels={blockedChannels}
        />
      </CardContent>
    </Card>
  );
}

function CoverageBody({
  coverage,
  onToggle,
  error,
  onRetry,
  isDirty,
  blockedChannels = [],
}: AlertsCoverageCardProps) {
  const { t } = useTranslation("common");

  if (!coverage) {
    return error ? (
      <ConditionBlock
        tone="destructive"
        glyph={<PlugZapIcon className={CONDITION.GLYPH} />}
        title={t("alerts.coverage.errorTitle")}
        description={t("alerts.coverage.errorDesc")}
        action={
          onRetry
            ? { label: t("alerts.coverage.errorRetry"), onClick: onRetry }
            : undefined
        }
      />
    ) : (
      <div role="status" aria-busy aria-label={t("alerts.coverage.loading")}>
        <CoverageMatrixSkeleton />
      </div>
    );
  }

  if (coverageIsEmpty(coverage)) {
    return (
      <ConditionBlock
        tone="muted"
        glyph={<BellOffIcon className={CONDITION.GLYPH} />}
        title={t("alerts.coverage.emptyTitle")}
        description={t("alerts.coverage.emptyDesc")}
      />
    );
  }

  return (
    <>
      {error ? (
        <Notice tone="warning" text={t("alerts.coverage.staleNotice")} />
      ) : null}
      <UnsavedNotice isDirty={isDirty} blockedChannels={blockedChannels} />
      <GapNotice coverage={coverage} />
      <CoverageMatrix
        coverage={coverage}
        onToggle={onToggle}
        blockedChannels={blockedChannels}
      />
    </>
  );
}

/**
 * A blocked form freezes this whole matrix, and the reason is a card away. The
 * blocking channel is named here so the cell and its explanation stay together.
 */
function UnsavedNotice({
  isDirty,
  blockedChannels,
}: {
  isDirty?: boolean;
  blockedChannels: readonly AlertChannel[];
}) {
  const { t } = useTranslation("common");

  if (blockedChannels.length > 0) {
    return (
      <Notice
        tone="destructive"
        text={t("alerts.coverage.blockedNotice", {
          channels: blockedChannels
            .map((channel) => t(channelNameKey(channel)))
            .join(", "),
        })}
      />
    );
  }
  if (!isDirty) return null;
  return <Notice tone="warning" text={t("alerts.coverage.unsavedNotice")} />;
}

/** At most one gap notice: `silent` is the stronger truth and outranks the outage. */
function GapNotice({ coverage }: { coverage: AlertsCoverage }) {
  const { t } = useTranslation("common");

  if (coverage.silent) {
    return <Notice tone="destructive" text={t("alerts.coverage.silentNotice")} />;
  }
  if (!coverage.outageGap) return null;

  const capable = ALERT_CHANNEL_ORDER.filter(
    (channel: AlertChannel) => coverage.cells[OUTAGE_EVENT][channel].capable,
  );

  return (
    <Notice
      tone="destructive"
      text={
        capable.length > 0
          ? t("alerts.coverage.outageNoticeWith", {
              channels: capable.map((c) => t(channelNameKey(c))).join(", "),
            })
          : t("alerts.coverage.outageNoticeNone")
      }
    />
  );
}

function Notice({ tone, text }: { tone: NoticeTone; text: string }) {
  return (
    <p className={cn(NOTICE, NOTICE_TONE[tone])} role="status">
      <TriangleAlertIcon className={NOTICE_GLYPH} aria-hidden />
      {text}
    </p>
  );
}

function ConditionBlock({
  tone,
  glyph,
  title,
  description,
  action,
}: {
  tone: keyof typeof CONDITION_TONE;
  glyph: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  const skin = CONDITION_TONE[tone];
  return (
    <div className={cn(CONDITION.ROOT, skin.ROOT)} role="status">
      <span className={cn(CONDITION.DISC, skin.DISC)} aria-hidden>
        {glyph}
      </span>
      <span className={CONDITION.TITLE}>{title}</span>
      <p className={CONDITION.DESC}>{description}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={cn(
            CONDITION.ACTION,
            skin.ACTION,
            "inline-flex items-center justify-center",
          )}
        >
          <RefreshCcwIcon className={PILL_GLYPH} aria-hidden />
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
