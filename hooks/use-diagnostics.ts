"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  DiagnosticsCaptureResponse,
  DiagnosticsCaptureResult,
} from "@/types/diagnostics";

// useDiagnostics: POST system/diagnostics.sh {"action":"capture"}; `content` downloads as a text/plain Blob.
// Action-only, no mount fetch.

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/diagnostics.sh";
const FALLBACK_FILENAME = "qmanager-debug-report.txt";

export type DiagnosticsStage = "idle" | "capturing" | "done" | "error";

export interface UseDiagnosticsReturn {
  stage: DiagnosticsStage;
  /** The last failure's reason, kept for the card's persistent notice. */
  error: string | null;
  capture: () => Promise<DiagnosticsCaptureResult>;
  reset: () => void;
}

/** The device returns a full path; a download name cannot carry slashes. */
function downloadName(path: string): string {
  const base = path.split("/").pop()?.trim();
  return base || FALLBACK_FILENAME;
}

export function useDiagnostics(): UseDiagnosticsReturn {
  const { t } = useTranslation("errors");
  // A ref, so a language switch does not rebuild `capture`.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [stage, setStage] = useState<DiagnosticsStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setStage("idle");
    setError(null);
  }, []);

  const capture = useCallback(async (): Promise<DiagnosticsCaptureResult> => {
    setError(null);
    setStage("capturing");

    const failWith = (reason: string): DiagnosticsCaptureResult => {
      if (mountedRef.current) {
        setError(reason);
        setStage("error");
      }
      return { ok: false, reason };
    };

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "capture" }),
      });
      if (!resp.ok) {
        return failWith(tRef.current("unknown"));
      }

      const json: DiagnosticsCaptureResponse = await resp.json();
      if (!json.success) {
        return failWith(
          resolveErrorMessage(
            tRef.current,
            json.error,
            json.detail,
            tRef.current("unknown"),
          ),
        );
      }

      const blob = new Blob([json.content], { type: "text/plain" });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = downloadName(json.filename);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);

      if (mountedRef.current) setStage("done");
      return { ok: true };
    } catch {
      return failWith(tRef.current("unknown"));
    }
  }, []);

  return { stage, error, capture, reset };
}
