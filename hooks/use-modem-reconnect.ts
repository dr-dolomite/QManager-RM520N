"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";

const CGI_ENDPOINT =
  "/cgi-bin/quecmanager/system/reboot.sh";

export type ReconnectStep = "disconnecting" | "reconnecting";

interface ReconnectResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

interface ReconnectOptions {
  onStep?: (step: ReconnectStep) => void;
}

export interface ReconnectResult {
  success: boolean;
  error?: string;
}

export interface UseModemReconnectReturn {
  isReconnecting: boolean;
  step: ReconnectStep | null;
  error: string | null;
  reconnectModem: (options?: ReconnectOptions) => Promise<ReconnectResult>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useModemReconnect(): UseModemReconnectReturn {
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [step, setStep] = useState<ReconnectStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reconnectModem = useCallback(
    async (options?: ReconnectOptions): Promise<ReconnectResult> => {
      if (isReconnecting) {
        return { success: false, error: "Reconnect already in progress" };
      }

      if (mountedRef.current) {
        setError(null);
        setIsReconnecting(true);
      }

      const notifyStep = (nextStep: ReconnectStep) => {
        if (mountedRef.current) {
          setStep(nextStep);
        }
        options?.onStep?.(nextStep);
      };

      try {
        // Show "disconnecting" immediately; flip to "reconnecting" after ~1.5s
        // for visual feedback while the server runs COPS=2 → 2s sleep → COPS=0.
        notifyStep("disconnecting");

        const visualTimer = sleep(1500).then(() => notifyStep("reconnecting"));

        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reconnect" }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json: ReconnectResponse = await resp.json();
        if (!json.success) {
          throw new Error(
            json.detail || json.error || "Failed to reconnect modem",
          );
        }

        // Ensure the visual step has fired before we resolve.
        await visualTimer;

        return { success: true };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to reconnect modem";

        if (mountedRef.current) {
          setError(message);
        }

        return { success: false, error: message };
      } finally {
        if (mountedRef.current) {
          setIsReconnecting(false);
          setStep(null);
        }
      }
    },
    [isReconnecting],
  );

  return {
    isReconnecting,
    step,
    error,
    reconnectModem,
  };
}
