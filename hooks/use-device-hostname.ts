"use client";

import { useEffect, useRef, useState } from "react";
import type { DeviceHostnameResponse } from "@/types/device-hostname";

// =============================================================================
// useDeviceHostname — Pre-auth, single-shot fetch of the modem's hostname.
// =============================================================================
// Used by the login screen to render a device-identity pill. The hostname is
// effectively constant for a session, so this hook does not poll. It also does
// NOT carry credentials: the endpoint is unauthenticated by design, and the
// pre-auth surface should never leak cookies it does not need to.
//
// Graceful-degradation contract: if the CGI is missing (older firmware) or
// the hostname is empty, `hostname` resolves to `null` and the consumer hides
// the pill entirely. There is no error state surfaced pre-auth.
// =============================================================================

const FETCH_ENDPOINT = "/cgi-bin/quecmanager/public/hostname.sh";

export interface UseDeviceHostnameReturn {
  hostname: string | null;
  isLoading: boolean;
}

export function useDeviceHostname(): UseDeviceHostnameReturn {
  const [hostname, setHostname] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(FETCH_ENDPOINT, {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DeviceHostnameResponse;
        if (!mountedRef.current || controller.signal.aborted) return;
        const trimmed = (json?.hostname ?? "").trim();
        setHostname(trimmed.length > 0 ? trimmed : null);
      } catch {
        if (!mountedRef.current) return;
        // Silent failure is the contract: older firmware without the CGI,
        // network blip, or any other failure resolves to "hide the pill".
        setHostname(null);
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  return { hostname, isLoading };
}
