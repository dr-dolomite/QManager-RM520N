"use client";

import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import TestRow from "./test-row";
import { DUR, EASE_STANDARD, staggerRows } from "@/lib/motion";
import {
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  type HealthCheckTest,
  type TestCategory,
} from "@/types/system-health-check";

interface CategoryCardProps {
  category: TestCategory;
  tests: HealthCheckTest[];
  fetchOutput: (testId: string) => Promise<string>;
}

export default function CategoryCard({ category, tests, fetchOutput }: CategoryCardProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{CATEGORY_LABELS[category]}</CardTitle>
        <CardDescription>{CATEGORY_DESCRIPTIONS[category]}</CardDescription>
      </CardHeader>
      <CardContent>
        <motion.div
          className="divide-y"
          initial="hidden"
          animate="visible"
          variants={staggerRows}
        >
          {tests.map((t) => (
            <motion.div
              key={t.id}
              variants={{ hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } }}
              transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
            >
              <TestRow test={t} fetchOutput={fetchOutput} />
            </motion.div>
          ))}
        </motion.div>
      </CardContent>
    </Card>
  );
}
