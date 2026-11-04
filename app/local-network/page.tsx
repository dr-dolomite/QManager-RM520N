"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Ethernet is the Local Network landing page; this keeps old bookmarks working.
export default function LocalNetworkRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/local-network/ethernet");
  }, [router]);

  return null;
}
