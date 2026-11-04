"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Connection Quality moved under Monitoring; this keeps old bookmarks working.
export default function ConnectionQualityRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/monitoring/connection-quality");
  }, [router]);

  return null;
}
