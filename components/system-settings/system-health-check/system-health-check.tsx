"use client";

import * as React from "react";
import { ServerOffIcon, StethoscopeIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import ConditionBlock from "@/components/system-settings/condition-block";
import { Tag } from "@/components/ui/tag";
import { useSystemHealthCheck } from "@/hooks/use-system-health-check";
import { staggerContainer, staggerItem } from "@/lib/motion";

import AllChecksCard from "./all-checks-card";
import AttentionCard from "./attention-card";
import CardSkeleton from "./card-skeleton";
import PageHeader from "./page-header";
import StatusBand from "./status-band";
import { collectFindings, groupByCategory } from "./derive";
import {
  CATEGORY_ORDER,
  CATEGORY_TEST_COUNT,
  CONDITION_RAIL,
  EMPTY_STATE,
  ERROR_STATE,
  PAGE_ROOT,
  TAG_COUNT,
} from "./shapes";

export function SystemHealthCheck(): React.JSX.Element {
  const { t } = useTranslation("system-health-check");
  const {
    job,
    isLoading,
    isRunning,
    isStarting,
    isClearing,
    isDownloading,
    error,
    start,
    clear,
    refresh,
    fetchTestOutput,
    downloadBundle,
  } = useSystemHealthCheck();

  const tests = React.useMemo(() => job?.tests ?? [], [job]);
  const groups = React.useMemo(() => groupByCategory(tests), [tests]);
  // Rows keep their own `key`, so a finding arriving mid-run reconciles into
  // place rather than restarting the page cascade.
  const findings = React.useMemo(() => collectFindings(tests), [tests]);

  const unreachable = Boolean(error) && !job;
  const canDownload = Boolean(
    job && job.status === "complete" && job.tarball_path,
  );
  const canClear = Boolean(job) && !isRunning && !isStarting;

  return (
    <motion.div
      className={PAGE_ROOT}
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
    >
      <PageHeader
        isLoading={isLoading}
        isRunning={isRunning}
        isStarting={isStarting}
        isClearing={isClearing}
        isDownloading={isDownloading}
        canDownload={canDownload}
        canClear={canClear}
        onRun={() => void start()}
        onClear={() => void clear()}
        onDownload={() => void downloadBundle()}
      />

      <StatusBand job={job} isLoading={isLoading} error={error} />

      {isLoading ? (
        <CardSkeleton />
      ) : unreachable ? (
        <motion.div variants={staggerItem} className={ERROR_STATE.ROOT}>
          <ConditionBlock
            tone="destructive"
            glyph={ServerOffIcon}
            ariaRole="alert"
            title={t("states.error.title")}
            description={t("states.error.description")}
            onRetry={() => void refresh()}
            retryLabel={t("actions.retry")}
            className={ERROR_STATE.BLOCK}
          />
          {error && <p className={ERROR_STATE.DETAIL}>{error}</p>}
        </motion.div>
      ) : !job ? (
        <motion.div variants={staggerItem} className={EMPTY_STATE.ROOT}>
          <ConditionBlock
            tone="neutral"
            glyph={StethoscopeIcon}
            ariaRole="status"
            title={t("states.empty.title")}
            description={t("states.empty.description")}
            className={EMPTY_STATE.BLOCK}
          />
          <div className={CONDITION_RAIL}>
            {CATEGORY_ORDER.map((category) => (
              <Tag key={category} variant="neutral">
                <span>{t(`category.${category}.label`)}</span>
                <span className={TAG_COUNT}>
                  {t("states.empty.checks", {
                    count: CATEGORY_TEST_COUNT[category],
                  })}
                </span>
              </Tag>
            ))}
          </div>
        </motion.div>
      ) : (
        <>
          <AttentionCard
            job={job}
            findings={findings}
            isRunning={isRunning}
            fetchOutput={fetchTestOutput}
          />
          <AllChecksCard
            jobId={job.job_id}
            settled={!isRunning}
            groups={groups}
          />
        </>
      )}
    </motion.div>
  );
}

export default SystemHealthCheck;
