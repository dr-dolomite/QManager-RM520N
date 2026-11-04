"use client";

import * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Tag } from "@/components/ui/tag";
import type { FetchTestOutput } from "@/hooks/use-system-health-check";
import { staggerRowItem } from "@/lib/motion";
import type { HealthCheckTest } from "@/types/system-health-check";
import { cn } from "@/lib/utils";

import OutputPanel from "./output-panel";
import {
  DISC_TONE,
  FINDING,
  FOCUS_RING,
  ROW_BUTTON,
  TEST_ROW,
  TEST_STATUS_GLYPH,
} from "./shapes";

const K = "output";

export interface FindingRowProps {
  test: HealthCheckTest;
  fetchOutput: FetchTestOutput;
}

/**
 * One failed or warned check. The disc carries the tone and the body stays
 * neutral, so there is no status chip here — the glyph already says which.
 * The row IS the disclosure, so its label names the check AND the action.
 */
export function FindingRow({
  test,
  fetchOutput,
}: FindingRowProps): React.JSX.Element {
  const { t } = useTranslation("system-health-check");
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();

  const Glyph = TEST_STATUS_GLYPH[test.status];
  const tone = test.status === "fail" ? "destructive" : "warning";

  return (
    <motion.div variants={staggerRowItem}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t(`${K}.${open ? "hide" : "show"}`, { label: test.label })}
        className={cn(
          FINDING.ROOT,
          ROW_BUTTON,
          TEST_ROW.EXPANDABLE,
          FOCUS_RING,
        )}
      >
        <span className={cn(FINDING.DISC, DISC_TONE[tone])}>
          <Glyph className={FINDING.GLYPH} aria-hidden="true" />
        </span>
        <span className={FINDING.BODY}>
          <span className={FINDING.TEXT}>
            <span className={FINDING.LABEL}>{test.label}</span>
            {test.detail && (
              <span className={FINDING.DETAIL}>{test.detail}</span>
            )}
          </span>
          <span className={FINDING.META}>
            <Tag variant="neutral">{t(`category.${test.category}.label`)}</Tag>
            {test.duration_ms > 0 && (
              <span className={TEST_ROW.DURATION}>{test.duration_ms}ms</span>
            )}
            <ChevronRightIcon
              className={cn(TEST_ROW.CHEVRON, open && TEST_ROW.CHEVRON_OPEN)}
              aria-hidden="true"
            />
          </span>
        </span>
      </button>

      {open && (
        <OutputPanel
          id={panelId}
          testId={test.id}
          fetchOutput={fetchOutput}
        />
      )}
    </motion.div>
  );
}

export default FindingRow;
