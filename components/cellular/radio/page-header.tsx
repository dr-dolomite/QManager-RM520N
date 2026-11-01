"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

// =============================================================================
// Radio Information page header
// =============================================================================
// Title and one-line description. The cadence chip and the "Refresh now" pill
// stay CUT — per-user direction, not a mock correction. "Copy diagnostics" moved
// into the Active MIMO tile's corner (`copy-diagnostics-button.tsx`), so the
// header holds no action and the description runs the full row on desktop.
//
// The Live/Stale freshness chip was removed per direct request — it is not
// coming back without a fresh design pass.
// =============================================================================

export function RadioPageHeader() {
  const { t } = useTranslation("cellular");

  return (
    <div className="flex flex-col gap-1.5">
      {/* The mock's 32px/600 is not a ramp step. DESIGN.md > Typography >
          Hierarchy fixes the page title at text-3xl/700, and the pre-auth
          19/17/15/13 scale is scoped to `/` and `/login/` only. */}
      <h1 className="text-3xl font-bold tracking-[-0.02em]">
        {t("radio_info.page.title")}
      </h1>
      <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
        {t("radio_info.page.description")}
      </p>
    </div>
  );
}

export default RadioPageHeader;
