"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// useDataUsedReset — Data-Usage Counter Reset Mutation
// =============================================================================
// The counter itself is read from the shared status payload (`.data_used`), so
// this hook does not poll. It POSTs to data_used_reset.sh; the poller picks up
// the flag on its next tick and the next status poll shows the counter at ~0.
//
// Usage:
//   const { resetCounter, isResetting } = useDataUsedReset();
// =============================================================================

const RESET_ENDPOINT = "/cgi-bin/quecmanager/network/data_used_reset.sh";

export interface UseDataUsedResetReturn {
  /** True while a reset POST is in-flight */
  isResetting: boolean;
  /** POST a reset request. Returns true on success. */
  resetCounter: () => Promise<boolean>;
}

export function useDataUsedReset(): UseDataUsedResetReturn {
  const [isResetting, setIsResetting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetCounter = useCallback(async (): Promise<boolean> => {
    setIsResetting(true);
    try {
      const response = await authFetch(RESET_ENDPOINT, { method: "POST" });
      return response.ok;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) setIsResetting(false);
    }
  }, []);

  return { isResetting, resetCounter };
}
