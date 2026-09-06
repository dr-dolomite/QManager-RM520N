"use client";

import type * as React from "react";
import { motion } from "motion/react";

import { staggerRowItem } from "@/lib/motion";
import type { HealthCheckTest } from "@/types/system-health-check";
import { cn } from "@/lib/utils";

import HealthStatusBadge from "./health-status-badge";
import { isTerminal } from "./derive";
import { TEST_ROW } from "./shapes";

export interface TestRowProps {
  test: HealthCheckTest;
}

/**
 * One dense row. Deliberately NOT a button — only failures and warnings expand,
 * and those live on the findings card.
 */
export function TestRow({ test }: TestRowProps): React.JSX.Element {
  return (
    <motion.div
      variants={staggerRowItem}
      className={cn(TEST_ROW.ROOT, TEST_ROW.STATIC)}
    >
      <span className={TEST_ROW.TEXT}>
        <span className={TEST_ROW.LABEL}>{test.label}</span>
        {test.detail && <span className={TEST_ROW.DETAIL}>{test.detail}</span>}
      </span>
      <span className={TEST_ROW.META}>
        {isTerminal(test.status) && test.duration_ms > 0 && (
          <span className={TEST_ROW.DURATION}>{test.duration_ms}ms</span>
        )}
        <HealthStatusBadge status={test.status} />
      </span>
    </motion.div>
  );
}

export default TestRow;
