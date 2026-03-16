"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCcwIcon, XIcon } from "lucide-react";
import { useModemStatus } from "@/hooks/use-modem-status";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/watchdog.sh";

export function SimSwapBanner() {
  const { data: modemStatus } = useModemStatus();
  const router = useRouter();
  const [isDismissing, setIsDismissing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(async () => {
    setIsDismissing(true);
    try {
      const resp = await fetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_sim_swap" }),
      });
      if (resp.ok) {
        setDismissed(true);
      }
    } catch {
      // Silently fail — banner just stays visible
    } finally {
      setIsDismissing(false);
    }
  }, []);

  const handleApplyProfile = useCallback(() => {
    router.push("/cellular/custom-profiles");
  }, [router]);

  const simSwap = modemStatus?.sim_swap;

  // Don't render if no swap detected or already dismissed
  if (!simSwap?.detected || dismissed) {
    return null;
  }

  const hasMatchingProfile = !!simSwap.matching_profile_id;

  return (
    <div className="px-2 lg:px-6">
      <Alert className="mb-2">
        <RefreshCcwIcon className="size-4" />
        <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span>
            {hasMatchingProfile ? (
              <>
                New SIM card detected. Profile{" "}
                <strong className="break-all">{simSwap.matching_profile_name}</strong>{" "}
                matches this SIM.
              </>
            ) : (
              <>New SIM card detected. No matching profile found.</>
            )}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {hasMatchingProfile && (
              <Button size="sm" variant="default" onClick={handleApplyProfile}>
                Apply Profile
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              disabled={isDismissing}
              aria-label="Dismiss SIM swap notification"
            >
              <XIcon className="size-4" />
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}
