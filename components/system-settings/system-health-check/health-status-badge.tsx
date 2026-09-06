"use client";

import type * as React from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import type { TestStatus } from "@/types/system-health-check";
import { cn } from "@/lib/utils";

import { CHIP_GLYPH, SPIN, TEST_STATUS_BADGE, TEST_STATUS_GLYPH } from "./shapes";

const K = "status";

export interface HealthStatusBadgeProps {
  status: TestStatus;
}

/**
 * The per-test chip. `running` is carried because the backend types it, but the
 * runner never writes it — in-flight state lives on `job.status`.
 */
export function HealthStatusBadge({
  status,
}: HealthStatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation("system-health-check");
  const Glyph = TEST_STATUS_GLYPH[status];

  return (
    <Badge variant={TEST_STATUS_BADGE[status]}>
      <Glyph
        className={cn(CHIP_GLYPH, status === "running" && SPIN)}
        aria-hidden="true"
      />
      {t(`${K}.${status}`)}
    </Badge>
  );
}

export default HealthStatusBadge;
