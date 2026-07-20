"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// SMS Alerts has been folded into the centralized Alerts page. This route is
// kept only so old bookmarks/links forward to the new location.
export default function SmsAlertsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/monitoring/alerts");
  }, [router]);

  return (
    <div className="text-muted-foreground p-6 text-sm">
      Redirecting to Alerts…
    </div>
  );
}
