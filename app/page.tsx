"use client";

import { useEffect, useState } from "react";
import OverviewCard from "@/components/public/overview-card";

const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";

function hasIndicatorCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("qm_logged_in=1");
}

function clearIndicatorCookie() {
  document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
}

// Three gate states drive what "/" renders:
//   public      — show the Overview splash (the default landing surface)
//   checking    — indicator cookie present; confirm the session before bouncing
//   redirecting — session confirmed; navigating to /dashboard/
type Gate = "public" | "checking" | "redirecting";

export default function Home() {
  // The qm_logged_in indicator cookie is an OPTIMISTIC HINT, not proof of a live
  // session. It can linger after the real session is gone — a foreign-domain
  // leftover (browsing the modem IP directly vs. through the dev proxy), a
  // cached/bfcache page, or a deploy skew. If "/" trusted it blindly it would
  // bounce a logged-out visitor to /dashboard/, where the auto-logout poller
  // then kicks them to /login/ — turning the public landing page into a login
  // trap. So we only forward to the dashboard after check.sh CONFIRMS the
  // session; anything else falls through to the public splash.
  //
  // Fast path: no indicator cookie → skip the network round-trip and render the
  // splash immediately (the common logged-out case, incl. right after logout).
  const [gate, setGate] = useState<Gate>(() =>
    hasIndicatorCookie() ? "checking" : "public",
  );

  useEffect(() => {
    if (gate !== "checking") return;
    let cancelled = false;

    // check.sh skips auth and answers 200 {authenticated:bool} off the session
    // file (not the cookie), so it's the authoritative source here.
    fetch(CHECK_ENDPOINT, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated === true) {
          setGate("redirecting");
          window.location.href = "/dashboard/";
        } else {
          // Server reachable and says NOT authenticated → the indicator cookie
          // is stale. Drop it and show the public splash.
          clearIndicatorCookie();
          setGate("public");
        }
      })
      .catch(() => {
        // Non-2xx / network / parse error: we can't confirm the session. Don't
        // trap the user — show the splash (OverviewCard degrades gracefully on
        // its own fetch). Keep the hint: this may be a transient blip on a
        // genuinely logged-in device.
        if (!cancelled) setGate("public");
      });

    return () => {
      cancelled = true;
    };
  }, [gate]);

  if (gate === "public") {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center p-4 font-sans">
        <main className="w-full max-w-lg">
          <OverviewCard />
        </main>
      </div>
    );
  }

  // "checking" or "redirecting": a blank background, never a flash of the splash
  // to a user we're about to forward to the dashboard.
  return <div className="bg-background min-h-svh" />;
}
