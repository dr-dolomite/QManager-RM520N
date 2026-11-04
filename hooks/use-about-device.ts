"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { AboutDeviceData, AboutDeviceResponse } from "@/types/about-device";

// =============================================================================
// useAboutDevice — one-shot read of the device's identity and addresses
// =============================================================================
// Backend: GET /cgi-bin/quecmanager/device/about.sh. No polling — the figures
// are static for the life of a boot.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/device/about.sh";

export interface UseAboutDeviceReturn {
  data: AboutDeviceData | null;
  /** The first read, which is the only one that may show skeletons. */
  isLoading: boolean;
  /** A re-read behind an already-painted page. */
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAboutDevice(): UseAboutDeviceReturn {
  const [data, setData] = useState<AboutDeviceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `about.sh` hardcodes `success: true` in its only `jq -n`, so the envelope's
  // flag has never been a failure signal — the HTTP status is.
  const fetchData = useCallback(async (silent: boolean) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: AboutDeviceResponse = await resp.json();
      if (!mountedRef.current) return;

      setData({
        device: json.device,
        threeGppRelease: json["3gpp_release"],
        network: json.network,
        system: json.system,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch device information",
      );
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  /** Re-reads behind the painted page: the pill spins, the figures stay put. */
  const refresh = useCallback(() => {
    void fetchData(true);
  }, [fetchData]);

  return { data, isLoading, isRefreshing, error, refresh };
}
