"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SCENARIO_CREATE_ACTION } from "@/components/cellular/custom-profiles/connection-scenarios/connection-scenario-card";

// =============================================================================
// /cellular/custom-profiles/connection-scenarios — retired route, now a redirect
// =============================================================================
// Connection Scenarios merged into Custom SIM Profiles: one feature, one page.
// This route survives only so an old bookmark, an old deep link, or a stale
// browser history entry still lands somewhere useful.
//
// WHY A CLIENT-SIDE REDIRECT AND NOT A REAL ONE. QManager is a Next.js STATIC
// EXPORT (`output: "export"`) served by lighttpd off the modem. There is no Node
// process at runtime, so `next.config`'s `redirects()` never executes — it is a
// dev-server-only feature here — and there is no server to emit a 308. The
// navigation has to happen in the browser after the exported HTML loads.
//
// `router.replace`, never `push`: a redirect that leaves itself in the history
// stack traps the Back button in a loop between the two pages.
//
// The frame before navigation renders a real centred notice rather than a blank
// page. On the modem's own CPU that frame is not always instantaneous, and a
// white flash reads as a broken link.
// =============================================================================

const TARGET = "/cellular/custom-profiles";

function ConnectionScenariosRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation("cellular");

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    // The old route's create deep-link is `?action=create`. The merged page
    // hosts both profiles and scenarios, so a bare `create` no longer says
    // which one — translate it on the way through instead of dropping it and
    // silently breaking the scenario picker's "Create new custom scenario…".
    if (next.get("action") === "create") {
      next.set("action", SCENARIO_CREATE_ACTION);
    }
    const query = next.toString();
    router.replace(query ? `${TARGET}?${query}` : TARGET);
  }, [router, searchParams]);

  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-2"
      role="status"
      aria-live="polite"
    >
      <MaterialSymbol
        name="progress_activity"
        size={24}
        className="text-on-surface-variant animate-spin motion-reduce:animate-none"
      />
      <p className="text-on-surface-variant text-sm">
        {t("scenarios.redirect.label")}
      </p>
    </div>
  );
}

// Suspense is mandatory, not defensive: `useSearchParams()` triggers a CSR
// bailout and an unwrapped read fails the static export build.
const ConnectionScenariosPage = () => (
  <Suspense>
    <ConnectionScenariosRedirect />
  </Suspense>
);

export default ConnectionScenariosPage;
