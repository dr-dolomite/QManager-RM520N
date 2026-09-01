"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import { HEADER } from "./shapes";

// =============================================================================
// Dashboard page header
// =============================================================================
// The h1 + description + rail pattern every other route family already has, and
// the dashboard did not: the route opened straight onto a hero card, so the
// page had no accessible heading at all and the sidebar's label was the only
// thing naming it.
//
// The description is a hand-rolled `p`, NOT `CardDescription`. That primitive
// hardcodes `text-muted-foreground`, a retired ink on this surface — every
// dashboard card speaks its secondary text in `on-surface-variant`, and a
// header that disagrees with the cards beneath it is the one place the
// difference is most visible.
//
// `rail` ships EMPTY. Step 01 moves the Radio / Internet / Stale chips out of
// `network-status.tsx` and into it; until then the slot renders nothing at all
// rather than an empty flex box, so the header has no invisible gap on its end.
// =============================================================================

export interface DashboardPageHeaderProps {
  /** Status chips, right-aligned on a wide container. Empty until step 01. */
  rail?: React.ReactNode;
}

export function DashboardPageHeader({ rail }: DashboardPageHeaderProps) {
  const { t } = useTranslation("dashboard");

  return (
    <div className={HEADER.ROOT}>
      <div className={HEADER.TEXT}>
        {/* DESIGN.md > Typography > Hierarchy fixes the page title at
            text-3xl/700. The pre-auth 19/17/15/13 scale is scoped to `/` and
            `/login/` only, and does not reach this route. */}
        <h1 className={HEADER.TITLE}>{t("page.title")}</h1>
        <p className={HEADER.DESC}>{t("page.description")}</p>
      </div>

      {rail ? <div className={HEADER.RAIL}>{rail}</div> : null}
    </div>
  );
}

export default DashboardPageHeader;
