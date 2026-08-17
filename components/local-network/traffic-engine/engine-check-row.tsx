"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";

import ResultAlert from "./result-alert";
import type { VerifyResult } from "@/types/traffic-engine";

// =============================================================================
// engine-check-row — "Test bypass" (verify) action: runs the two-phase speed
// comparison (?action=verify) and polls ?action=verify_status to completion.
// The result (with/without bypass + improvement factor) renders in
// ResultAlert. Poll window is 12 min: each phase can take two 3-min speedtest
// attempts on a throttled link, so a tight window reported false timeouts.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/video_optimizer.sh";
const POLL_MS = 3000;

export interface EngineCheckRowProps {
  binaryInstalled: boolean;
}

const EngineCheckRow = ({ binaryInstalled }: EngineCheckRowProps) => {
  const { t } = useTranslation("common");

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const poll = useCallback(async () => {
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!mountedRef.current) return false;
      try {
        const resp = await authFetch(`${CGI_ENDPOINT}?action=verify_status`);
        if (!resp.ok) continue;
        const json = await resp.json();
        if (!mountedRef.current) return false;
        if (json.status === "complete" || json.status === "error") {
          setResult(json);
          return json.status === "complete";
        }
      } catch {
        continue;
      }
    }
    setError(t("trafficEngine.verify.timeout"));
    return false;
  }, [t]);

  const runVerify = async () => {
    setError(null);
    setResult(null);
    setIsRunning(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json.success === false) {
        setError(json.detail || json.error || t("trafficEngine.verify.error"));
        return;
      }
      await poll();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : t("trafficEngine.verify.error"));
      }
    } finally {
      if (mountedRef.current) setIsRunning(false);
    }
  };

  const canRun = binaryInstalled && !isRunning;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("trafficEngine.verify.title")}</CardTitle>
        <CardDescription>{t("trafficEngine.verify.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {!binaryInstalled && (
            <p className="text-sm text-muted-foreground">
              {t("trafficEngine.verify.needs_binary")}
            </p>
          )}

          <div>
            <Button onClick={runVerify} disabled={!canRun}>
              {isRunning ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  {t("trafficEngine.verify.running")}
                </>
              ) : (
                t("trafficEngine.verify.run")
              )}
            </Button>
          </div>

          {isRunning && !result && (
            <div className="grid gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && <ResultAlert result={result} />}
        </div>
      </CardContent>
    </Card>
  );
};

export default EngineCheckRow;