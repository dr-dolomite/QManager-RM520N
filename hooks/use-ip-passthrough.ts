"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PassthroughMode,
  UsbMode,
  DnsProxy,
  IpptNat,
  IpPassthroughSettingsResponse,
  IpPassthroughSaveRequest,
  IpPassthroughSaveResponse,
} from "@/types/ip-passthrough";

// =============================================================================
// useIpPassthrough — Fetch & Save Hook for IP Passthrough Settings
// =============================================================================
// Fetches current IPPT configuration on mount and exposes a saveSettings action.
// Applying settings triggers an immediate device reboot — no separate reboot
// action is needed.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/ip_passthrough.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ip_passthrough.sh";

export interface IpPassthroughApplyData {
  passthrough_mode: PassthroughMode;
  target_mac: string;
  ippt_nat: IpptNat;
  usb_mode: UsbMode;
  dns_proxy: DnsProxy;
}

export interface UseIpPassthroughReturn {
  /** Current passthrough mode (null before first fetch) */
  passthroughMode: PassthroughMode | null;
  /** Target device MAC — empty string when disabled/unconfigured (null before first fetch) */
  targetMac: string | null;
  /** IPPT NAT mode (null before first fetch) */
  ipptNat: IpptNat | null;
  /** Current USB modem protocol (null before first fetch) */
  usbMode: UsbMode | null;
  /** DNS offloading state (null before first fetch) */
  dnsProxy: DnsProxy | null;
  /** MAC address of the requesting browser device (null before first fetch) */
  clientMac: string | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /**
   * Apply all IP Passthrough settings. The backend will apply AT commands
   * and immediately trigger a device reboot. Returns true if the request
   * was accepted (reboot will follow).
   */
  saveSettings: (data: IpPassthroughApplyData) => Promise<boolean>;
  /** Re-fetch settings */
  refresh: () => void;
}

export function useIpPassthrough(): UseIpPassthroughReturn {
  const [passthroughMode, setPassthroughMode] =
    useState<PassthroughMode | null>(null);
  const [targetMac, setTargetMac] = useState<string | null>(null);
  const [ipptNat, setIpptNat] = useState<IpptNat | null>(null);
  const [usbMode, setUsbMode] = useState<UsbMode | null>(null);
  const [dnsProxy, setDnsProxy] = useState<DnsProxy | null>(null);
  const [clientMac, setClientMac] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current settings
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await fetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: IpPassthroughSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error || "Failed to fetch IP Passthrough settings");
        return;
      }

      setPassthroughMode(data.passthrough_mode);
      setTargetMac(data.target_mac);
      setIpptNat(data.ippt_nat);
      setUsbMode(data.usb_mode);
      setDnsProxy(data.dns_proxy);
      setClientMac(data.client_mac);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch IP Passthrough settings"
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Apply all IP Passthrough settings (backend reboots immediately after)
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (data: IpPassthroughApplyData): Promise<boolean> => {
      setError(null);
      setIsSaving(true);

      try {
        const request: IpPassthroughSaveRequest = {
          action: "apply",
          passthrough_mode: data.passthrough_mode,
          target_mac: data.target_mac,
          ippt_nat: data.ippt_nat,
          usb_mode: data.usb_mode,
          dns_proxy: data.dns_proxy,
        };

        const resp = await fetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const result: IpPassthroughSaveResponse = await resp.json();
        if (!mountedRef.current) return false;

        if (!result.success) {
          setError(result.detail || result.error || "Failed to apply settings");
          return false;
        }

        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to apply settings"
        );
        return false;
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    []
  );

  return {
    passthroughMode,
    targetMac,
    ipptNat,
    usbMode,
    dnsProxy,
    clientMac,
    isLoading,
    isSaving,
    error,
    saveSettings,
    refresh: fetchSettings,
  };
}
