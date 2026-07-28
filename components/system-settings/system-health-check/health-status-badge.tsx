"use client";

import {
  CheckCircle2Icon,
  XCircleIcon,
  TriangleAlertIcon,
  MinusCircleIcon,
  Loader2Icon,
  ClockIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TestStatus } from "@/types/system-health-check";

interface HealthStatusBadgeProps {
  status: TestStatus;
}

export default function HealthStatusBadge({ status }: HealthStatusBadgeProps) {
  switch (status) {
    case "pass":
      return (
        <Badge variant="success">
          <CheckCircle2Icon className="size-3" />
          Pass
        </Badge>
      );
    case "fail":
      return (
        <Badge variant="destructive">
          <XCircleIcon className="size-3" />
          Fail
        </Badge>
      );
    case "warn":
      return (
        <Badge variant="warning">
          <TriangleAlertIcon className="size-3" />
          Warning
        </Badge>
      );
    case "skip":
      return (
        <Badge variant="muted">
          <MinusCircleIcon className="size-3" />
          Skipped
        </Badge>
      );
    case "running":
      return (
        <Badge variant="info">
          <Loader2Icon className="size-3 animate-spin" />
          Running
        </Badge>
      );
    case "pending":
    default:
      return (
        <Badge variant="muted">
          <ClockIcon className="size-3" />
          Pending
        </Badge>
      );
  }
}
