"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { useWebPort } from "@/hooks/use-web-port";
import { originForPorts, type PendingMove } from "@/lib/web-port";
import { STEP_DESCRIPTION, STEP_HEADING } from "../shapes";

// Step 6 (optional). A change is saved here, but the browser moves only from the
// Done step (onMove hands the wizard the new origin), so the wizard is not cut off mid-step.

interface StepWebPortProps {
  onSubmitRef: (fn: () => Promise<void>) => void;
  onLoadingChange: (loading: boolean) => void;
  onSuccess: () => void;
  /** Called with the new origin when the server is moving to new ports. */
  onMove: (move: PendingMove) => void;
}

function parsePort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

export function StepWebPort({
  onSubmitRef,
  onLoadingChange,
  onSuccess,
  onMove,
}: StepWebPortProps) {
  const { t } = useTranslation("onboarding");
  const { state, save } = useWebPort();

  const [httpDraft, setHttpDraft] = useState("");
  const [httpsDraft, setHttpsDraft] = useState("");
  const [seen, setSeen] = useState<string | null>(null);
  const savedKey = state ? `${state.httpPort}/${state.httpsPort}` : null;
  if (savedKey !== seen) {
    setSeen(savedKey);
    setHttpDraft(state ? String(state.httpPort) : "");
    setHttpsDraft(state ? String(state.httpsPort) : "");
  }
  // Bumped after a failed save so the shell's Continue is re-armed with submit.
  const [attempt, setAttempt] = useState(0);

  const httpPort = parsePort(httpDraft);
  const httpsPort = parsePort(httpsDraft);
  const invalid = httpPort === null || httpsPort === null;
  const same = !invalid && httpPort === httpsPort;

  const submit = useCallback(async () => {
    if (!state) {
      onSuccess();
      return;
    }
    if (httpPort === null || httpsPort === null || httpPort === httpsPort) {
      setAttempt((n) => n + 1);
      return;
    }
    if (httpPort === state.httpPort && httpsPort === state.httpsPort) {
      onSuccess();
      return;
    }
    onLoadingChange(true);
    const result = await save(httpPort, httpsPort);
    onLoadingChange(false);
    if (!result.ok) {
      toast.error(result.error ?? t("web_port.toast_failed"));
      setAttempt((n) => n + 1);
      return;
    }
    if (result.moving) {
      onMove({
        origin: originForPorts(
          result.httpPort ?? httpPort,
          result.httpsPort ?? httpsPort,
        ),
        startedAt: Date.now(),
      });
    }
    onSuccess();
  }, [state, httpPort, httpsPort, save, onLoadingChange, onSuccess, onMove, t]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef, attempt]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className={STEP_HEADING}>{t("web_port.heading")}</h2>
        <p className={STEP_DESCRIPTION}>{t("web_port.description")}</p>
      </div>

      <FieldGroup>
        <Field data-invalid={httpPort === null || same ? true : undefined}>
          <FieldLabel htmlFor="web-http-port">
            {t("web_port.label_http")}
          </FieldLabel>
          <Input
            id="web-http-port"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            className="tabular-nums"
            value={httpDraft}
            disabled={!state}
            aria-invalid={httpPort === null || same ? true : undefined}
            onChange={(e) => setHttpDraft(e.target.value.trim())}
          />
        </Field>
        <Field data-invalid={httpsPort === null || same ? true : undefined}>
          <FieldLabel htmlFor="web-https-port">
            {t("web_port.label_https")}
          </FieldLabel>
          <Input
            id="web-https-port"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            className="tabular-nums"
            value={httpsDraft}
            disabled={!state}
            aria-invalid={httpsPort === null || same ? true : undefined}
            onChange={(e) => setHttpsDraft(e.target.value.trim())}
          />
          {state && invalid ? (
            <FieldError>{t("web_port.error_invalid")}</FieldError>
          ) : same ? (
            <FieldError>{t("web_port.error_same")}</FieldError>
          ) : (
            <FieldDescription>{t("web_port.hint_default")}</FieldDescription>
          )}
        </Field>
      </FieldGroup>
    </div>
  );
}
