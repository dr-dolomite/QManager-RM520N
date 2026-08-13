"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";

// =============================================================================
// Radio Information page header
// =============================================================================
// Mock reference: lines 43-52 (title, description, two pill actions).
//
// The cadence chip and the "Refresh now" pill stay CUT — per-user direction,
// not a mock correction. "Copy diagnostics" is the one action here that is not
// a duplicate of the sidebar's own passive refresh behaviour.
//
// The Live/Stale freshness chip was removed per direct request — it is not
// coming back without a fresh design pass.
// =============================================================================

const PILL_ACTION = "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

export interface RadioPageHeaderProps {
  /** Returns the diagnostics blob to place on the clipboard. */
  buildDiagnostics: () => string;
}

export function RadioPageHeader({ buildDiagnostics }: RadioPageHeaderProps) {
  const { t } = useTranslation("cellular");
  const [copied, setCopied] = React.useState(false);
  const resetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnostics());
      setCopied(true);
      toast.success(t("radio_info.header.copy_success"));
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked on plain HTTP in some browsers, and this
      // app is served over plain HTTP from the modem — so this path is real,
      // not theoretical.
      toast.error(t("radio_info.header.copy_error"));
    }
  }, [buildDiagnostics, t]);

  return (
    <div className="flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end">
      <div className="flex max-w-[41rem] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          {/* The mock's 32px/600 is not a ramp step. DESIGN.md > Typography >
              Hierarchy fixes the page title at text-3xl/700, and the pre-auth
              19/17/15/13 scale is scoped to `/` and `/login/` only. */}
          <h1 className="text-3xl font-bold tracking-[-0.02em]">
            {t("radio_info.page.title")}
          </h1>
        </div>
        <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
          {t("radio_info.page.description")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto">
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          className={PILL_ACTION}
        >
          <MaterialSymbol name={copied ? "check" : "content_copy"} size={18} />
          {copied
            ? t("radio_info.header.copied")
            : t("radio_info.header.copy")}
        </Button>
      </div>
    </div>
  );
}

export default RadioPageHeader;
