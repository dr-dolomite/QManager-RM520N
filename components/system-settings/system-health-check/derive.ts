import type {
  HealthCheckTest,
  TestCategory,
  TestStatus,
} from "@/types/system-health-check";

import { CATEGORY_ORDER } from "./shapes";

/** A status the runner has actually resolved. `pending` is not one. */
export function isTerminal(status: TestStatus): boolean {
  return (
    status === "pass" ||
    status === "fail" ||
    status === "warn" ||
    status === "skip"
  );
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** `tarball_size` is a byte count or null; a unit suffix needs no translator. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

export interface CategoryGroup {
  category: TestCategory;
  tests: HealthCheckTest[];
  fail: number;
  warn: number;
  pass: number;
}

/**
 * The eight groups, always all eight and always in the runner's order — the
 * catalog is static, so a category is never absent and never re-ranked.
 */
export function groupByCategory(
  tests: readonly HealthCheckTest[],
): CategoryGroup[] {
  const buckets = new Map<TestCategory, HealthCheckTest[]>();
  for (const category of CATEGORY_ORDER) buckets.set(category, []);
  for (const test of tests) buckets.get(test.category)?.push(test);

  return CATEGORY_ORDER.map((category) => {
    const bucket = buckets.get(category) ?? [];
    return {
      category,
      tests: bucket,
      fail: bucket.filter((t) => t.status === "fail").length,
      warn: bucket.filter((t) => t.status === "warn").length,
      pass: bucket.filter((t) => t.status === "pass").length,
    };
  });
}

/** Everything that failed or warned, fails first, category order within each. */
export function collectFindings(
  tests: readonly HealthCheckTest[],
): HealthCheckTest[] {
  const rank = (status: TestStatus) => (status === "fail" ? 0 : 1);
  return tests
    .filter((test) => test.status === "fail" || test.status === "warn")
    .sort((a, b) => {
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
      return (
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
      );
    });
}
