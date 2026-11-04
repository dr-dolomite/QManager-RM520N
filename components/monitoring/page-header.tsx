import * as React from "react";

import { cn } from "@/lib/utils";

// =============================================================================
// MonitoringPageHeader — the shared page header for /monitoring routes.
// =============================================================================
// Deliberately a sibling of `components/cellular/page-header.tsx` rather than an
// import of it: a route family does not reach into another family's components,
// and this one lives on the lucide side of the Icon-Boundary Rule.
// =============================================================================

export interface MonitoringPageHeaderProps {
  /** The page's Display-step `h1`. One per route. */
  title: React.ReactNode;
  /** The muted one-line description directly beneath it. */
  description?: React.ReactNode;
  /** Optional right-aligned pill actions. Callers style their own controls. */
  actions?: React.ReactNode;
  className?: string;
}

export function MonitoringPageHeader({
  title,
  description,
  actions,
  className,
}: MonitoringPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
        className,
      )}
    >
      <div className="flex max-w-[41rem] min-w-0 flex-col gap-1.5">
        <h1 className="text-3xl font-bold tracking-[-0.02em]">{title}</h1>
        {description ? (
          <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export default MonitoringPageHeader;
