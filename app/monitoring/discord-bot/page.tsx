"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Discord Bot page has been folded into the centralized Alerts page. This
// route is kept only so old bookmarks/links forward to the new location.
export default function DiscordBotRedirectPage() {
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
