"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SwapLabel } from "@/components/ui/swap-label";

// =============================================================================
// Radio Information page header
// =============================================================================
// Mock reference: lines 43-52 (title, description, two pill actions) plus the
// liveness chip lifted out of the mock's own app chrome at line 37.
//
// The cadence chip and the "Refresh now" pill stay CUT — per-user direction,
// not a mock correction. "Copy diagnostics" is the one action here that is not
// a duplicate of the sidebar's own passive refresh behaviour.
//
// The FRESHNESS chip is back, and it is not decoration. `isStale` already
// froze the carrier list on the page shell, but nothing told the user: a page
// showing eight-minute-old numbers looked exactly like a page showing live
// ones, on the single surface a technician opens to tell a bad link from a
// dead poller. Only a hard fetch `error` raised anything, and stale is the
// quieter and far more common failure.
//
// The pulse is CONDITIONAL, which is the whole reason an unconditional one was
// cut in the first place: a pulse over frozen numbers is a worse lie than no
// indicator at all. `animate-live-ping` runs only on the live branch, it is the
// page's ONLY ambient loop (The One-Loop Rule), and `globals.css` already
// disables it under `prefers-reduced-motion`.
//
// The two states never share a mark: live is a pulsing disc with no glyph,
// stale is a static `schedule` glyph. `success-container` and
// `warning-container` measure 1.03:1 apart and are one surface under
// deuteranopia, so the mark is the only channel that survives.
//
// DESIGN.md's pill-shape rule still applies to the one remaining action;
// `button.tsx` defaults to the legacy rounded-md, so the pill metrics are
// applied at the call site.
// =============================================================================

const PILL_ACTION = "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

export interface RadioPageHeaderProps {
  /** Returns the diagnostics blob to place on the clipboard. */
  buildDiagnostics: () => string;
  /** True when the snapshot on screen is older than the poller's cadence. */
  isStale: boolean;
  /** True during the very first fetch. No freshness claim is made until there
   *  is something on screen whose freshness could be claimed. */
  isLoading: boolean;
}

/**
 * The live disc: a solid dot with a second copy expanding out of it. Built from
 * two spans rather than one animated dot because the dot itself must stay put —
 * scaling the mark would make the chip's own metrics breathe.
 */
function LiveDot() {
  return (
    <span className="relative inline-flex size-2 shrink-0 items-center justify-center">
      <span className="absolute inline-flex size-2 rounded-pill bg-on-success-container animate-live-ping" />
      <span className="relative inline-flex size-2 rounded-pill bg-on-success-container" />
    </span>
  );
}

export function RadioPageHeader({
  buildDiagnostics,
  isStale,
  isLoading,
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

          {!isLoading ? (
            <Badge variant={isStale ? "warning" : "success"}>
              <SwapLabel
                swapKey={isStale ? "stale" : "live"}
                className="gap-1.5"
              >
                {isStale ? (
                  <MaterialSymbol name="schedule" size={15} filled />
                ) : (
                  <LiveDot />
                )}
                {isStale
                  ? t("radio_info.header.stale")
                  : t("radio_info.header.live")}
              </SwapLabel>
            </Badge>
          ) : null}
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
