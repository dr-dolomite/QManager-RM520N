import * as React from "react";

import { cn } from "@/lib/utils";

// =============================================================================
// CellularPageHeader — the shared page header for /cellular/ sub-routes
// =============================================================================
// Every feature page in this product is a page header followed by a uniform
// grid of self-contained cards (DESIGN.md > The Consistent-Layout Rule). This is
// the header half of that shape, extracted so the three routes under
// `/cellular/cell-locking/` cannot drift apart.
//
// WHY THIS EXISTS RATHER THAN A COPY-PASTED `<h1>`. `text-3xl font-bold mb-2`
// appears in 26 component files. Twenty-six is not a style, it is a default
// nobody chose — and it is missing the `tracking-[-0.02em]` the Display step
// actually specifies, so every one of those pages renders its title fractionally
// wider than the migrated surfaces do. The tracking is the whole reason a
// shared component beats a shared class string here: a class you have to
// remember to type is a class that will be typed wrong.
//
// SCOPE. Band Locking, Tower Locking and Frequency Locking are one sub-tree that
// a user crosses three times in a single task, so they move together. The other
// 23 unmigrated routes are NOT swept as a side effect — DESIGN.md's Migration
// Deltas table is explicit that new work follows the canon and does not "fix"
// unconverted surfaces in passing.
//
// This is deliberately NOT `radio/page-header.tsx`. That component owns Radio
// Information's freshness chip, its clipboard action and its own translation
// namespace lookups; it is a page, not a primitive. This one takes rendered
// nodes and arranges them.
// =============================================================================

export interface CellularPageHeaderProps {
  /** The page's Display-step `h1`. One per route. */
  title: React.ReactNode;
  /** The muted one-line description directly beneath it. */
  description?: React.ReactNode;
  /**
   * Optional right-aligned pill actions. Callers style their own buttons with
   * `PILL_ACTION` from their surface's shapes contract — the header does not
   * impose a button shape it cannot see the content of.
   */
  actions?: React.ReactNode;
  className?: string;
}

export function CellularPageHeader({
  title,
  description,
  actions,
  className,
}: CellularPageHeaderProps) {
  return (
    <div
      className={cn(
        // Container query, not a viewport breakpoint: this header sits inside
        // `@container/main`, so it responds to the content column's real width
        // rather than to the window's — which is what keeps it correct when the
        // sidebar expands (The Container-Query Rule).
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

export default CellularPageHeader;
