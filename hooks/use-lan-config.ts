"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { authFetch } from "@/lib/auth-fetch";
import type {
  LanConfigStatus,
  LanConfigSaveResponse,
} from "@/types/lan-config";

// useLanConfig — reads bridge0's IPv4 address + prefix and applies a new one.
// A real change reboots the modem, so success flips straight to `applied` (no retry against the old origin).

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/lan_config.sh";
// Same request the /reboot/ page sends; it releases the backend's deferred reboot.
const REBOOT_ACK_ENDPOINT = "/cgi-bin/quecmanager/system/update.sh?action=reboot_ack";
const K = "ethernet.lan_config";

const SERVER_ERROR_CODES = new Set([
  "no_body",
  "invalid_ipaddr",
  "invalid_prefix",
  "invalid_host_in_subnet",
  "invalid_private_address",
  "lan_read_failed",
  "lan_save_failed",
  "update_in_progress",
  "lan_busy",
]);

/** A translated sentence for a backend error code, or the caller's fallback when the code is unmapped. */
export function resolveLanError(
  t: TFunction,
  code: string | undefined,
  fallback: string,
): string {
  const trimmed = code?.trim();
  if (trimmed && SERVER_ERROR_CODES.has(trimmed)) {
    return t(`${K}.server_errors.${trimmed}`);
  }
  return fallback;
}

export interface LanApplied {
  /** Address the device will be reachable at after the reboot */
  newIpaddr: string;
  /** CIDR prefix that was applied */
  prefix: number;
  /** Seconds the device is expected to be unreachable */
  windowSeconds: number;
  /** True when the backend bounces the LAN carrier (DHCP upstream reconnects on its own) */
  carrierBounce: boolean;
}

export interface SaveLanConfigResult {
  success: boolean;
  /** False when the backend found nothing to change (no reboot armed) */
  applyInProgress?: boolean;
  errorCode?: string;
  errorDetail?: string;
}

export interface UseLanConfigReturn {
  data: LanConfigStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Set once a change is committed and the reboot armed (drives the reconnect panel) */
  applied: LanApplied | null;
  error: string | null;
  refresh: () => Promise<void>;
  saveLanConfig: (ipaddr: string, prefix: number) => Promise<SaveLanConfigResult>;
}

export function useLanConfig(): UseLanConfigReturn {
  const { t } = useTranslation("common");
  // A language switch churns `t`; reading it through a ref keeps the fetch from re-running and re-seeding the draft.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [data, setData] = useState<LanConfigStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [applied, setApplied] = useState<LanApplied | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchConfig = useCallback(async (silent = false): Promise<void> => {
    const tr = tRef.current;
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(resolveLanError(tr, json.error, tr(`${K}.errors.fetch_failed`)));
        return;
      }
      setData(json as LanConfigStatus);
    } catch {
      if (!mountedRef.current) return;
      setError(tr(`${K}.errors.fetch_failed`));
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveLanConfig = useCallback(
    async (ipaddr: string, prefix: number): Promise<SaveLanConfigResult> => {
      const tr = tRef.current;
      setError(null);
      setIsSaving(true);

      let resp: Response;
      try {
        resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ipaddr, prefix }),
        });
      } catch {
        const detail = tr(`${K}.errors.save_failed`);
        if (mountedRef.current) {
          setError(detail);
          setIsSaving(false);
        }
        return { success: false };
      }

      let json: LanConfigSaveResponse | null = null;
      try {
        json = await resp.json();
      } catch {
        // handled below
      }

      if (!resp.ok || !json || !json.success) {
        const fallback = !json
          ? tr(`${K}.errors.parse_failed`)
          : tr(`${K}.errors.save_failed`);
        if (mountedRef.current) {
          setError(resolveLanError(tr, json?.error, fallback));
          setIsSaving(false);
        }
        return {
          success: false,
          errorCode: json?.error,
          errorDetail: json?.detail,
        };
      }

      // No-change save: nothing armed, nothing to reconnect to.
      if (!json.apply_in_progress) {
        if (mountedRef.current) setIsSaving(false);
        void fetchConfig(true);
        return { success: true, applyInProgress: false };
      }

      // Release the deferred reboot now the reply is in hand; failure is non-fatal (the backend reboots after 20s anyway).
      authFetch(REBOOT_ACK_ENDPOINT, { keepalive: true }).catch(() => {});

      if (mountedRef.current) {
        setIsSaving(false);
        setApplied({
          newIpaddr: json.new_ipaddr ?? ipaddr,
          prefix: json.prefix ?? prefix,
          windowSeconds: json.disconnect_window_seconds ?? 120,
          carrierBounce: json.carrier_bounce ?? false,
        });
      }
      return { success: true, applyInProgress: true };
    },
    [fetchConfig],
  );

  return {
    data,
    isLoading,
    isSaving,
    applied,
    error,
    refresh: fetchConfig,
    saveLanConfig,
  };
}
