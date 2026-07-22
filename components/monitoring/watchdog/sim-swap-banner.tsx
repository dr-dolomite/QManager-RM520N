"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/auth-fetch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardSimIcon, XIcon } from "lucide-react";
import { useModemStatus } from "@/hooks/use-modem-status";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/watchdog.sh";

// =============================================================================
// Client-owned dismissal — why the browser is the source of truth here
// =============================================================================
// The "new SIM detected" flag lives in /tmp on the modem, created by the root
// poller (root:root 644). The dismiss CGI runs as www-data and cannot overwrite
// a root-owned file, so a server-side dismiss silently never sticks and the
// banner re-nags every page load. Rather than widen the modem's permission
// surface for a purely cosmetic, per-boot flag, we track dismissal in the
// browser — the same "modem can't own this state" pattern as use-sms-read-state.
//
// Keyed by ICCID (the SIM's identity, already present as modemStatus.device.iccid)
// so dismissal is: instant, permanent across reloads AND reboots (localStorage
// persists; the /tmp flag does not), and still fires once for a *genuinely
// different* new SIM. The server dismiss POST is kept as best-effort — harmless
// if it fails, and it settles the server flag on any device where it can.
const DISMISS_KEY = "qmanager.simswap.dismissed.v1";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function persistDismissed(iccids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(iccids));
  } catch {
    // localStorage full/unavailable — falls back to in-session dismissal.
  }
}

export function SimSwapBanner() {
  const { data: modemStatus } = useModemStatus();
  const router = useRouter();
  const [isDismissing, setIsDismissing] = useState(false);
  const [dismissedIccids, setDismissedIccids] = useState<string[]>([]);

  // Hydrate persisted dismissals after mount — static export renders client-only,
  // so localStorage is read post-hydration, never during SSR.
  useEffect(() => {
    setDismissedIccids(readDismissed());
  }, []);

  const simSwap = modemStatus?.sim_swap;
  const iccid = modemStatus?.device?.iccid?.trim() ?? "";

  const handleDismiss = useCallback(async () => {
    // Persist locally first — this is what actually stops the re-nag.
    if (iccid) {
      setDismissedIccids((prev) => {
        if (prev.includes(iccid)) return prev;
        const next = [...prev, iccid];
        persistDismissed(next);
        return next;
      });
    }
    // Best-effort server clear so the poller's /tmp flag also settles where it can.
    setIsDismissing(true);
    try {
      await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_sim_swap" }),
      });
    } catch {
      // Ignored — the local dismissal above already hid the banner permanently.
    } finally {
      setIsDismissing(false);
    }
  }, [iccid]);

  const handleApplyProfile = useCallback(() => {
    router.push("/cellular/custom-profiles");
  }, [router]);

  // Hide when no swap is active, or when this SIM was already dismissed.
  if (!simSwap?.detected) return null;
  if (iccid && dismissedIccids.includes(iccid)) return null;

  const hasMatchingProfile = !!simSwap.matching_profile_id;

  return (
    <div className="px-2 lg:px-6">
      <Alert className="relative mb-2 border-info/30 bg-info/10 pr-11 duration-300 animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none">
        <CardSimIcon className="size-4 text-info" />
        <div className="col-start-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="space-y-0.5">
            <AlertTitle className="text-foreground">New SIM card detected</AlertTitle>
            <AlertDescription>
              {hasMatchingProfile ? (
                <>
                  Profile{" "}
                  <strong className="font-medium text-foreground break-all">
                    {simSwap.matching_profile_name}
                  </strong>{" "}
                  matches this SIM.
                </>
              ) : (
                <>No matching profile found for this SIM.</>
              )}
            </AlertDescription>
          </div>
          {hasMatchingProfile && (
            <Button
              size="sm"
              onClick={handleApplyProfile}
              className="shrink-0 self-start sm:self-auto"
            >
              Apply Profile
            </Button>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleDismiss}
          disabled={isDismissing}
          aria-label="Dismiss SIM swap notification"
          className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-4" />
        </Button>
      </Alert>
    </div>
  );
}
