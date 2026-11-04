"use client";

import { useEffect, useState } from "react";
import { isLoggedIn } from "@/hooks/use-auth";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { Spinner } from "@/components/ui/spinner";

// First-time setup. Logged in → /dashboard/; password already set → /login/.
// check.sh can answer before the CGI backend is up on first boot, so it is retried, then /login/ is the safe fallback.

const CHECK_ENDPOINT = "/cgi-bin/quecmanager/auth/check.sh";
const CHECK_ATTEMPTS = 3;
const CHECK_RETRY_MS = 1500;

export default function SetupPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) {
      window.location.href = "/dashboard/";
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;

    const checkSetup = () => {
      fetch(CHECK_ENDPOINT)
        .then((r) => r.json())
        .then((data: { setup_required?: boolean }) => {
          if (cancelled) return;
          if (!data.setup_required) {
            window.location.href = "/login/";
            return;
          }
          setReady(true);
        })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt < CHECK_ATTEMPTS) {
            timer = window.setTimeout(checkSetup, CHECK_RETRY_MS);
          } else {
            window.location.href = "/login/";
          }
        });
    };

    checkSetup();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-on-surface-variant" />
      </div>
    );
  }

  return <OnboardingWizard />;
}
