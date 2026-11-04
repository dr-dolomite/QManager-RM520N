"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Network Events moved to /monitoring/events; this keeps old bookmarks working.
export default function MonitoringRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/monitoring/events");
  }, [router]);

  return null;
}
