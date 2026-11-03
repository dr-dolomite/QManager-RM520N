"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { LanDevice, LanDevicesResponse } from "@/types/lan-devices";

// =============================================================================
// useLanDevices — Connected LAN Device List
// =============================================================================
// Reads the modem's connected LAN devices (DHCP leases merged with ip neigh /
// ARP) so a UI can offer a "pick a device" affordance instead of hand-typing a
// MAC. Read-only; safe to refresh on demand. Backs the IP Passthrough MAC picker.
//
// Backend endpoint:
//   GET /cgi-bin/quecmanager/network/lan_devices.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/lan_devices.sh";

export interface UseLanDevicesReturn {
  /** Connected devices; empty array when none are visible on the LAN */
  devices: LanDevice[];
  /** True while a fetch is in progress */
  isLoading: boolean;
  /** Error message if the fetch failed, else null */
  error: string | null;
  /** Re-scan the LAN */
  refresh: () => void;
}

/**
 * @param enabled - When false, the hook stays idle and performs no fetch.
 *   The IP Passthrough card only needs devices while passthrough is active, so
 *   it gates the scan on mode !== "disabled".
 */
export function useLanDevices(enabled = true): UseLanDevicesReturn {
  const [devices, setDevices] = useState<LanDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchDevices = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: LanDevicesResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error ?? "Failed to load connected devices");
        return;
      }

      setDevices(Array.isArray(data.devices) ? data.devices : []);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load connected devices"
      );
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch once when first enabled; thereafter refresh is manual. Gating on
  // `enabled` avoids scanning the LAN while passthrough is disabled.
  useEffect(() => {
    if (enabled && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchDevices();
    }
  }, [enabled, fetchDevices]);

  return {
    devices,
    isLoading,
    error,
    refresh: fetchDevices,
  };
}
