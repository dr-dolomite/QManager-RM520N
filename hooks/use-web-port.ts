"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  WebPortResponse,
  WebPortSaveResult,
  WebPortState,
} from "@/types/web-port";
import { DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT } from "@/types/web-port";

// GET  -> { http_port, https_port, listening, last_result }
// POST { http_port, https_port } -> { apply_in_progress, http_port, https_port }
// A POST that moves the port is self-severing (the server restarts ~1 s later), so the
// caller moves the browser (lib/web-port.ts). The mutator returns its own result for the toast.
// CGI: /cgi-bin/quecmanager/system/web_port.sh

const ENDPOINT = "/cgi-bin/quecmanager/system/web_port.sh";

function toState(json: WebPortResponse): WebPortState {
  return {
    httpPort: json.http_port ?? DEFAULT_HTTP_PORT,
    httpsPort: json.https_port ?? DEFAULT_HTTPS_PORT,
    listening: {
      http: json.listening?.http === true,
      https: json.listening?.https === true,
    },
    lastResult: json.last_result ?? null,
  };
}

export interface UseWebPortReturn {
  state: WebPortState | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Load error only; a failed save is reported through the mutator's result. */
  error: string | null;
  save: (httpPort: number, httpsPort: number) => Promise<WebPortSaveResult>;
  refresh: () => void;
}

export function useWebPort(): UseWebPortReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<WebPortState | null>(null);
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

  const fetchState = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await authFetch(ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: WebPortResponse = await resp.json();
      if (!mountedRef.current) return;
      if (!json.success) {
        setError(resolveErrorMessage(t, json.error, json.detail, t("unknown")));
        return;
      }
      setState(toState(json));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : t("unknown"));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const save = useCallback(
    async (httpPort: number, httpsPort: number): Promise<WebPortSaveResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ http_port: httpPort, https_port: httpsPort }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json: WebPortResponse = await resp.json();
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, json.error, json.detail, t("unknown")),
          };
        }
        const next = {
          ok: true,
          moving: json.apply_in_progress === true,
          httpPort: json.http_port ?? httpPort,
          httpsPort: json.https_port ?? httpsPort,
        };
        if (mountedRef.current) {
          setState((prev) =>
            prev ? { ...prev, httpPort: next.httpPort, httpsPort: next.httpsPort } : prev,
          );
        }
        return next;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : t("unknown") };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [t],
  );

  const refresh = useCallback(() => {
    void fetchState();
  }, [fetchState]);

  return { state, isLoading, isSaving, error, save, refresh };
}
