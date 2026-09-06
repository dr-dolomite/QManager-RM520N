"use client";

import type * as React from "react";
import {
  ActivityIcon,
  CheckCircle2Icon,
  OctagonAlertIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import ConditionBlock from "@/components/system-settings/condition-block";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FetchTestOutput } from "@/hooks/use-system-health-check";
import { staggerItem, staggerRows } from "@/lib/motion";
import type { HealthCheckJob, HealthCheckTest } from "@/types/system-health-check";
import { cn } from "@/lib/utils";

import FindingRow from "./finding-row";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL_HERO,
  CARD_STACK,
  CARD_TITLE,
  CONDITION_PANEL,
  GROUP_FILL,
  NOTICE,
  ROW_GROUP,
} from "./shapes";

const K = "attention";

export interface AttentionCardProps {
  job: HealthCheckJob;
  findings: HealthCheckTest[];
  isRunning: boolean;
  fetchOutput: FetchTestOutput;
}

/**
 * The anchor card: every fail then every warn, across all eight categories.
 * `job.error` rides above them, because a runner that stopped early is the
 * reason a category can look clean when it never ran.
 */
export function AttentionCard({
  job,
  findings,
  isRunning,
  fetchOutput,
}: AttentionCardProps): React.JSX.Element {
  const { t } = useTranslation("system-health-check");
  // A settled run reports every catalogued check. Anything short of that can
  // say what failed, never that the rest passed — and a skip is not a pass, so
  // the all-clear counts `pass` and names the skips separately.
  const { summary } = job;
  const reported = summary.pass + summary.fail + summary.warn + summary.skip;
  const incomplete =
    job.status === "error" ||
    summary.total <= 0 ||
    reported < summary.total;

  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL_HERO}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          {job.error && (
            <div className={NOTICE.BOX} role="status">
              <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
              <div className={NOTICE.STACK}>
                <p className={NOTICE.TEXT}>{t("notice.run_error")}</p>
                <p className={NOTICE.DETAIL}>{job.error}</p>
              </div>
            </div>
          )}

          {findings.length > 0 ? (
            <motion.div
              className={cn(ROW_GROUP, GROUP_FILL)}
              variants={staggerRows}
            >
              {findings.map((test) => (
                <FindingRow
                  key={test.id}
                  test={test}
                  fetchOutput={fetchOutput}
                />
              ))}
            </motion.div>
          ) : isRunning ? (
            <ConditionBlock
              tone="neutral"
              glyph={ActivityIcon}
              ariaRole="status"
              title={t("states.running.title")}
              description={t("states.running.description")}
              className={CONDITION_PANEL.SCREEN}
            />
          ) : incomplete ? (
            <ConditionBlock
              tone="destructive"
              glyph={OctagonAlertIcon}
              ariaRole="status"
              title={t("states.incomplete.title")}
              description={t("states.incomplete.description")}
              className={CONDITION_PANEL.SCREEN}
            />
          ) : summary.skip > 0 ? (
            <ConditionBlock
              tone="success"
              glyph={ShieldCheckIcon}
              ariaRole="status"
              title={t("states.all_clear_skipped.title", {
                count: summary.pass,
              })}
              description={t("states.all_clear_skipped.description", {
                count: summary.skip,
              })}
              className={CONDITION_PANEL.SCREEN}
            />
          ) : (
            <ConditionBlock
              tone="success"
              glyph={CheckCircle2Icon}
              ariaRole="status"
              title={t("states.all_clear.title", { count: summary.pass })}
              description={t("states.all_clear.description")}
              className={CONDITION_PANEL.SCREEN}
            />
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default AttentionCard;
