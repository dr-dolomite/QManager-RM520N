"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

// =============================================================================
// Radio Information page header
// =============================================================================
// Mock reference: lines 43-52 (title, description, two pill actions) plus the
// liveness chip lifted out of the mock's own app chrome at line 37.
//
// Two corrections to the mock, both in the same family — an indicator that
// asserts something the device is not doing:
//
//  1. LIVENESS. The mock draws a green pulsing dot unconditionally. A pulsing
//     liveness indicator over frozen numbers is a worse lie than no indicator
//     at all, so the dot is bound to `isStale`: it pulses only while the data
//     really is arriving, and degrades to a still warning chip otherwise. While
//     the first read is in flight the chip is hidden entirely rather than
//     guessing (Saved-State Honesty).
//
//  2. CADENCE. The mock's "Updates every 30s" is false by roughly 8x — the
//     client polls at 2s and the modem's CA data refreshes every ~3.7-4.0s
//     (measured on the live device). `active-bands.tsx:161` ships the same
//     false claim today; it is deliberately not carried forward. The honest
//     statement is qualitative.
//
// DESIGN.md allows exactly one filled primary action per surface, so "Refresh
// now" is `default` and "Copy diagnostics" is `outline`. Both are pill-shaped
// per the M3 shape scale; `button.tsx` still defaults to the legacy rounded-md,
// so the pill metrics are applied at the call site.
// =============================================================================

const PILL_ACTION = "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

export interface RadioPageHeaderProps {
  isLoading: boolean;
  isStale: boolean;
  onRefresh: () => void;
  /** Returns the diagnostics blob to place on the clipboard. */
  buildDiagnostics: () => string;
}

export function RadioPageHeader({
  isLoading,
  isStale,
  onRefresh,
  buildDiagnostics,
}: RadioPageHeaderProps) {
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
          {!isLoading && <LivenessChip isStale={isStale} />}
        </div>
        <p className="text-on-surface-variant text-sm leading-relaxed text-pretty">
          {t("radio_info.page.description")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto">
        <span className="bg-surface-container text-on-surface-variant inline-flex h-[2.625rem] items-center gap-2 rounded-pill px-4 text-xs font-semibold">
          <MaterialSymbol name="schedule" size={15} />
          {t("radio_info.header.cadence")}
        </span>
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
        <Button type="button" onClick={onRefresh} className={PILL_ACTION}>
          <MaterialSymbol name="refresh" size={18} />
          {t("radio_info.header.refresh")}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Liveness chip
// -----------------------------------------------------------------------------
// Two states, and they differ by glyph/shape as well as hue: the live one is a
// pulsing dot pair (`.animate-live-ping`, which carries its own reduced-motion
// guard in globals.css), the stale one a still warning glyph. Colour alone
// never carries the distinction.

function LivenessChip({ isStale }: { isStale: boolean }) {
  const { t } = useTranslation("cellular");

  if (isStale) {
    return (
      <span
        role="status"
        className="bg-warning-container text-on-warning-container inline-flex items-center gap-2 rounded-pill px-3.5 py-[0.4375rem] text-xs font-semibold"
      >
        <MaterialSymbol name="warning" filled size={15} />
        {t("radio_info.header.stale")}
      </span>
    );
  }

  return (
    <span
      role="status"
      className="bg-success-container text-on-success-container inline-flex items-center gap-2 rounded-pill py-[0.4375rem] pl-[0.6875rem] pr-3.5 text-xs font-semibold"
    >
      <span aria-hidden className="relative inline-flex size-2">
        <span
          className={cn(
            "bg-success absolute inset-0 rounded-pill",
            "animate-live-ping",
          )}
        />
        <span className="bg-success relative size-2 rounded-pill" />
      </span>
      {t("radio_info.header.live")}
    </span>
  );
}

export default RadioPageHeader;
