"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { StethoscopeIcon, PlayIcon, Loader2Icon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSystemHealthCheck } from "@/hooks/use-system-health-check";
import SummaryCard from "./summary-card";
import CategoryCard from "./category-card";
import { DUR, EASE_STANDARD, staggerContainer } from "@/lib/motion";
import {
  CATEGORY_LABELS,
  type HealthCheckTest,
  type TestCategory,
} from "@/types/system-health-check";

const CATEGORY_ORDER: TestCategory[] = [
  "binaries",
  "permissions",
  "at_transport",
  "sms",
  "sudoers",
  "services",
  "network",
  "configuration",
];

export default function SystemHealthCheck() {
  const {
    job,
    isRunning,
    isStarting,
    isClearing,
    error,
    start,
    clear,
    fetchTestOutput,
    downloadBundle,
  } = useSystemHealthCheck();

  // Group tests by category, then sort categories fail-first.
  const groups = useMemo(() => {
    const buckets = new Map<TestCategory, HealthCheckTest[]>();
    if (job?.tests) {
      for (const t of job.tests) {
        const arr = buckets.get(t.category) ?? [];
        arr.push(t);
        buckets.set(t.category, arr);
      }
    }
    const items: { category: TestCategory; tests: HealthCheckTest[]; failCount: number }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const tests = buckets.get(cat);
      if (!tests || tests.length === 0) continue;
      const failCount = tests.filter((t) => t.status === "fail").length;
      items.push({ category: cat, tests, failCount });
    }
    items.sort((a, b) => {
      if ((a.failCount > 0) === (b.failCount > 0)) {
        return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      }
      return a.failCount > 0 ? -1 : 1;
    });
    return items;
  }, [job]);

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">System Health Check</h1>
        <p className="text-muted-foreground">
          Diagnose QManager subsystems and download a redacted bundle for support.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <SummaryCard
          job={job}
          isRunning={isRunning}
          isStarting={isStarting}
          isClearing={isClearing}
          onRun={start}
          onClear={clear}
          onDownload={downloadBundle}
        />
        {error && (
          <div className="text-sm text-destructive">Error: {error}</div>
        )}
        {groups.length > 0 && (
          <motion.div
            key={job?.job_id ?? "no-job"}
            className="grid grid-cols-1 @4xl/main:grid-cols-2 gap-4 items-stretch"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            {groups.map((g) => (
              <motion.div
                key={g.category}
                className="h-full"
                variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
              >
                <CategoryCard
                  category={g.category}
                  tests={g.tests}
                  fetchOutput={fetchTestOutput}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
        {!job && (
          <Card>
            <CardContent className="flex flex-col items-center text-center gap-4 py-10">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <StethoscopeIcon className="size-6 text-muted-foreground" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold">Ready to run diagnostics</h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  Probes every QManager subsystem and packages the results into a redacted bundle you can share with support.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 max-w-lg">
                {CATEGORY_ORDER.map((c) => (
                  <Badge key={c} variant="outline" className="text-muted-foreground">
                    {CATEGORY_LABELS[c]}
                  </Badge>
                ))}
              </div>
              <Button onClick={start} disabled={isStarting} className="mt-2">
                {isStarting ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-4" />
                    Run Diagnostics
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
