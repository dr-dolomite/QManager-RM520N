"use client";

import type { ReactNode } from "react";
import {
  CheckCircle2Icon,
  InfoIcon,
  TriangleAlertIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  type NoticeTone,
} from "./shapes";

export type ResultTone = NoticeTone;

const GLYPH: Record<ResultTone, LucideIcon> = {
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  destructive: XCircleIcon,
  info: InfoIcon,
};

/** The one tonal notice (verify, install, prerequisites) every engine surface shares. */
export function ResultAlert({
  tone,
  children,
  className,
}: {
  tone: ResultTone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = GLYPH[tone];
  return (
    <div
      role={tone === "destructive" || tone === "warning" ? "alert" : "status"}
      className={cn(NOTICE, NOTICE_TONE[tone], "animate-banner-in", className)}
    >
      <Icon className={NOTICE_GLYPH} aria-hidden="true" />
      <span className={NOTICE_BODY}>{children}</span>
    </div>
  );
}
