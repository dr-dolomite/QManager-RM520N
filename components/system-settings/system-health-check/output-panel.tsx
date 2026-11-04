"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import type {
  FetchTestOutput,
  TestOutput,
} from "@/hooks/use-system-health-check";
import { DUR, EASE_QUICK } from "@/lib/motion";

import { OUTPUT } from "./shapes";

const K = "output";

export interface OutputPanelProps {
  id: string;
  testId: string;
  fetchOutput: FetchTestOutput;
}

/**
 * The captured-output disclosure. It mounts only while open, so the fetch runs
 * once per open and the entrance is transform and opacity only.
 */
export function OutputPanel({
  id,
  testId,
  fetchOutput,
}: OutputPanelProps): React.JSX.Element {
  const { t } = useTranslation("system-health-check");
  const [result, setResult] = React.useState<TestOutput | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await fetchOutput(testId);
        if (!cancelled) setResult(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchOutput, testId]);

  const pending = result === null && error === null;

  return (
    <motion.div
      id={id}
      className={OUTPUT.SLOT}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.quick, ease: EASE_QUICK }}
    >
      {/* The fetch resolves after the disclosure has already reported "expanded",
          so without this the arriving output is silent to a screen reader. */}
      <div
        className={OUTPUT.PANEL}
        role="status"
        aria-live="polite"
        aria-busy={pending}
      >
        {pending && <p className={OUTPUT.META}>{t(`loading.output`)}</p>}
        {error !== null && (
          <p className={OUTPUT.FAILED}>{t(`${K}.failed`, { error })}</p>
        )}
        {result !== null && (
          <>
            <pre className={OUTPUT.PRE}>
              {result.output.trim().length > 0
                ? result.output
                : t(`${K}.empty`)}
            </pre>
            {result.truncated && (
              <p className={OUTPUT.TRUNCATED}>{t(`${K}.truncated`)}</p>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

export default OutputPanel;
