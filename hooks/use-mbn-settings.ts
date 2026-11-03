"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { authFetch } from "@/lib/auth-fetch";
import { enterRebootFlow } from "@/lib/reboot";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  MbnActionResult,
  MbnProfile,
  MbnSettingsResponse,
  MbnSaveRequest,
  MbnSaveResponse,
} from "@/types/mbn-settings";

// =============================================================================
// useMbnSettings — One-Shot MBN Fetch & Save Hook
// =============================================================================
// Fetches MBN auto-select status and profile list on mount. saveMbn applies a
// change; rebootDevice asks mbn.sh to reboot, then hands off to /reboot/.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/mbn.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/mbn.sh";
const K = "core_settings.apn.mbn.errors";

// mbn.sh codes whose shared `errors` entry names a different feature (select_failed = network mode).
const MBN_ERROR_KEYS: Record<string, string> = {
  autosel_failed: `${K}.autosel_failed`,
  deactivate_failed: `${K}.deactivate_failed`,
  select_failed: `${K}.select_failed`,
};

function saveErrorMessage(t: TFunction, data: MbnSaveResponse): string {
  const local = data.error ? MBN_ERROR_KEYS[data.error] : undefined;
  if (local) return t(local);
  return resolveErrorMessage(t, data.error, data.detail, t(`${K}.save_failed`));
}

export interface UseMbnSettingsReturn {
  /** All MBN profiles (null before first fetch) */
  profiles: MbnProfile[] | null;
  /** Auto-select status: 1 = enabled, 0 = disabled (null before first fetch) */
  autoSel: number | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Why the last READ failed (translated), or null. Saves return theirs. */
  error: string | null;
  /** Apply MBN changes. */
  saveMbn: (request: MbnSaveRequest) => Promise<MbnActionResult>;
  /** Trigger device reboot. Returns true if the command was accepted. */
  rebootDevice: () => Promise<boolean>;
  /** Re-fetch MBN data from the modem */
  refresh: () => void;
}

export function useMbnSettings(): UseMbnSettingsReturn {
  const { t } = useTranslation("cellular");
  // Read through a ref so a language switch (a new `t`) does not re-run the mount fetch.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [profiles, setProfiles] = useState<MbnProfile[] | null>(null);
  const [autoSel, setAutoSel] = useState<number | null>(null);
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
  // Fetch MBN auto-select status + profile list
  // ---------------------------------------------------------------------------
  const fetchMbn = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: MbnSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        // read_failed is the only read code; its shared `errors` entry is absent.
        setError(tRef.current(`${K}.load_failed`));
        return;
      }

      setProfiles(data.profiles);
      setAutoSel(data.auto_sel);
    } catch {
      if (!mountedRef.current) return;
      setError(tRef.current(`${K}.load_failed`));
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchMbn();
  }, [fetchMbn]);

  // ---------------------------------------------------------------------------
  // Save MBN change (apply profile or toggle auto-select)
  // ---------------------------------------------------------------------------
  const saveMbn = useCallback(
    async (request: MbnSaveRequest): Promise<MbnActionResult> => {
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data: MbnSaveResponse = await resp.json();

        if (!data.success) {
          return { ok: false, error: saveErrorMessage(tRef.current, data) };
        }

        // Silent re-fetch to update local state (no skeleton)
        if (mountedRef.current) await fetchMbn(true);
        return { ok: true };
      } catch {
        return { ok: false, error: tRef.current(`${K}.save_failed`) };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchMbn],
  );

  // ---------------------------------------------------------------------------
  // Reboot device (separate from save — called from the reboot dialog)
  // ---------------------------------------------------------------------------
  const rebootDevice = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reboot" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: MbnSaveResponse = await resp.json();
      if (data.success) {
        enterRebootFlow("mbn");
      }
      return data.success;
    } catch {
      return false;
    }
  }, []);

  return {
    profiles,
    autoSel,
    isLoading,
    isSaving,
    error,
    saveMbn,
    rebootDevice,
    refresh: fetchMbn,
  };
}
