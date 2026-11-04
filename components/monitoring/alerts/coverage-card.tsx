"use client";

import { useMemo, type ReactNode } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  BellOffIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  MinusCircleIcon,
  PlugZapIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
  UnplugIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ALERT_EVENT_ORDER, type AlertsState } from "@/types/alerts";

import {
  CHANNEL_GLYPH,
  EVENT_GLYPH,
  channelNameKey,
  eventNameKey,
} from "./constants";
import {
  confirmedInput,
  coverageIsEmpty,
  deriveCoverage,
  type CoverageRow,
  type CoverageVerdict,
} from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  COVERAGE_ROW,
  NOTICE,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PILL_GLYPH,
  SKELETON,
} from "./shapes";

// What reaches you, as SAVED. A draft in Channels never moves this card.

const VERDICT_GLYPH: Record<CoverageVerdict["kind"], LucideIcon> = {
  all: CheckCircle2Icon,
  outage: UnplugIcon,
  partial: CircleAlertIcon,
  none: BellOffIcon,
};

export interface AlertsCoverageCardProps {
  /** Saved device state. `null` with no error renders the loading skeleton. */
  state: AlertsState | null;
  /** Set when the last read failed. With state in hand it degrades to a notice. */
  error?: string | null;
  onRetry?: () => void;
}

export function AlertsCoverageCard({ state, error, onRetry }: AlertsCoverageCardProps) {
  const { t } = useTranslation("common");
  const coverage = useMemo(
    () => (state ? deriveCoverage(confirmedInput(state)) : null),
    [state],
  );

  const verdict =
    coverage && !coverageIsEmpty(coverage) && coverage.verdict.kind !== "none"
      ? coverage.verdict
      : null;
  const loading = !coverage && !error;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("alerts.coverage.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("alerts.coverage.description")}
        </CardDescription>
        {verdict ? (
          <CardAction>
            <VerdictChip verdict={verdict} />
          </CardAction>
        ) : loading ? (
          <CardAction aria-hidden>
            <Skeleton className={cn(SKELETON.CHIP, "w-28")} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {!coverage ? (
          error ? (
            <ConditionBlock
              tone="destructive"
              glyph={PlugZapIcon}
              title={t("alerts.coverage.errorTitle")}
              description={t("alerts.coverage.errorDesc")}
              action={
                onRetry
                  ? { label: t("alerts.coverage.errorRetry"), onClick: onRetry }
                  : undefined
              }
            />
          ) : (
            <div
              role="status"
              aria-busy
              aria-label={t("alerts.coverage.loading")}
              className={COVERAGE_ROW.STACK}
            >
              {ALERT_EVENT_ORDER.map((event) => (
                <Skeleton key={event} className={SKELETON.COVERAGE_ROW} />
              ))}
            </div>
          )
        ) : coverageIsEmpty(coverage) ? (
          <ConditionBlock
            tone="muted"
            glyph={BellOffIcon}
            title={t("alerts.coverage.emptyTitle")}
            description={t("alerts.coverage.emptyDesc")}
          />
        ) : (
          <>
            {error ? (
              <p className={cn(NOTICE, NOTICE_TONE.warning)} role="status">
                <TriangleAlertIcon className={NOTICE_GLYPH} aria-hidden />
                {t("alerts.coverage.staleNotice")}
              </p>
            ) : null}
            <CoverageRows rows={coverage.rows} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VerdictChip({ verdict }: { verdict: CoverageVerdict }) {
  const { t } = useTranslation("common");
  const Glyph = VERDICT_GLYPH[verdict.kind];
  const label =
    verdict.kind === "partial"
      ? t("alerts.coverage.verdict.partial", {
          covered: verdict.covered,
          total: verdict.total,
        })
      : t(`alerts.coverage.verdict.${verdict.kind}`);
  // The Badge base already eases its fill and ink on the standard tokens.
  return (
    <Badge variant={verdict.variant}>
      <Glyph className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}

function CoverageRows({ rows }: { rows: CoverageRow[] }) {
  const { t } = useTranslation("common");
  // A row with no channel stays quiet unless a neighbour is covered (Quiet-Default).
  const allEmpty = rows.every((row) => !row.fires.length && !row.attempt.length);

  return (
    <motion.ul
      className={COVERAGE_ROW.STACK}
      variants={staggerRows}
      initial="hidden"
      animate="visible"
    >
      {rows.map((row) => {
        const EventGlyph = EVENT_GLYPH[row.event];
        const empty = !row.fires.length && !row.attempt.length;
        return (
          <motion.li key={row.event} variants={staggerRowItem} className={COVERAGE_ROW.ROOT}>
            <span className={COVERAGE_ROW.EVENT}>
              <EventGlyph className={COVERAGE_ROW.EVENT_GLYPH} aria-hidden />
              {t(eventNameKey(row.event))}
            </span>
            <span className={COVERAGE_ROW.VIA}>
              {row.fires.map((channel) => {
                const Glyph = CHANNEL_GLYPH[channel];
                return (
                  <Tag key={channel} variant="neutral">
                    <Glyph aria-hidden />
                    {t(channelNameKey(channel))}
                  </Tag>
                );
              })}
              {row.attempt.map((channel) => (
                <Badge key={channel} variant="warning">
                  <WrenchIcon className="size-3" aria-hidden />
                  {t("alerts.coverage.needsSetup", {
                    channel: t(channelNameKey(channel)),
                  })}
                </Badge>
              ))}
              {empty ? (
                allEmpty ? (
                  <span className={COVERAGE_ROW.QUIET}>
                    {t("alerts.coverage.notSent")}
                  </span>
                ) : (
                  <Badge variant="warning">
                    <MinusCircleIcon className="size-3" aria-hidden />
                    {t("alerts.coverage.notSent")}
                  </Badge>
                )
              ) : null}
            </span>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

function ConditionBlock({
  tone,
  glyph: Glyph,
  title,
  description,
  action,
}: {
  tone: keyof typeof CONDITION_TONE;
  glyph: LucideIcon;
  title: string;
  description: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const skin = CONDITION_TONE[tone];
  return (
    <div className={cn(CONDITION.ROOT, skin.ROOT)} role="status">
      <span className={cn(CONDITION.DISC, skin.DISC)} aria-hidden>
        <Glyph className={CONDITION.GLYPH} />
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
