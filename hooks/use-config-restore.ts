"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { authFetch } from "@/lib/auth-fetch";
import {
  BackupError,
  base64Decode,
  decryptPayload,
  DecryptAuthError,
  deriveKey,
} from "@/lib/config-backup/crypto";
import {
  BACKUP_PLATFORM,
  canonicalHeaderAad,
  errorCodeOf,
  parseEnvelope,
} from "@/lib/config-backup/format";
import { isSectionKey, SECTION_KEYS } from "@/lib/config-backup/sections";
import { CONFIG_BACKUP_CGI } from "@/hooks/use-config-backup";
import type {
  ApplyRequest,
  ApplyResponse,
  ApplyStatusResponse,
  BackupEnvelope,
  BackupPayload,
  BackupSectionKey,
  RestoreProgress,
  RestoreUiState,
} from "@/types/config-backup";

const POLL_INTERVAL_MS = 1000;
// The APN section drops the link for ~4 s; give up only after ~90 s of silence.
const MAX_POLL_MISSES = 90;

interface State {
  ui: RestoreUiState;
  envelope: BackupEnvelope | null;
  payload: BackupPayload | null;
  progress: RestoreProgress | null;
  /** Error code (or raw message) of the last failure. */
  error: string | null;
  detail: string | null;
}

type Action =
  | { type: "reset" }
  | { type: "start_reading" }
  | { type: "envelope_parsed"; envelope: BackupEnvelope }
  | { type: "password_bad" }
  | { type: "decrypted"; payload: BackupPayload }
  | { type: "apply_started" }
  | { type: "progress"; progress: RestoreProgress }
  | { type: "apply_done"; progress: RestoreProgress }
  | { type: "error"; code: string | null; detail: string | null };

const INITIAL: State = {
  ui: "idle",
  envelope: null,
  payload: null,
  progress: null,
  error: null,
  detail: null,
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "reset":
      return INITIAL;
    case "start_reading":
      return { ...INITIAL, ui: "reading" };
    case "envelope_parsed":
      return { ...s, envelope: a.envelope, ui: "password_required" };
    case "password_bad":
      return { ...s, ui: "password_incorrect" };
    case "decrypted":
      return { ...s, payload: a.payload, ui: "ready" };
    case "apply_started":
      return { ...s, ui: "applying", progress: null, error: null, detail: null };
    case "progress":
      return { ...s, progress: a.progress };
    case "apply_done": {
      const p = a.progress;
      const sum = p.summary;
      const clean =
        p.status === "done" && !!sum && sum.failed === 0 && sum.skipped === 0;
      return { ...s, progress: p, ui: clean ? "success" : "partial_success" };
    }
    case "error":
      return { ...s, error: a.code ?? a.detail, detail: a.detail, ui: "failed" };
    default:
      return s;
  }
}

export type StartApplyResult =
  | { ok: true; jobId: string }
  | { ok: false; code: string | null; detail: string | null };

export interface UseConfigRestoreReturn {
  state: State;
  /** Section keys the backup carries, in picker order. */
  planned: BackupSectionKey[];
  readFile: (file: File) => Promise<void>;
  tryPassword: (passphrase: string) => Promise<void>;
  startApply: (keys: BackupSectionKey[], imeiConfirmed: boolean) => Promise<StartApplyResult>;
  cancel: () => Promise<boolean>;
  reset: () => void;
}

export function useConfigRestore(): UseConfigRestoreReturn {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const readFile = useCallback(async (file: File) => {
    dispatch({ type: "start_reading" });
    try {
      const text = await file.text();
      const envelope = parseEnvelope(text);
      dispatch({ type: "envelope_parsed", envelope });
    } catch (e) {
      dispatch({
        type: "error",
        code: errorCodeOf(e),
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const envelope = state.envelope;
  const tryPassword = useCallback(
    async (passphrase: string) => {
      if (!envelope) return;
      try {
        const salt = base64Decode(envelope.kdf.salt);
        const iv = base64Decode(envelope.cipher.iv);
        const ct = base64Decode(envelope.cipher.ciphertext);
        const key = await deriveKey(passphrase, salt, envelope.kdf.iter);
        const pt = await decryptPayload(key, iv, ct, canonicalHeaderAad(envelope));
        let payload: BackupPayload;
        try {
          payload = JSON.parse(new TextDecoder().decode(pt)) as BackupPayload;
        } catch {
          throw new BackupError("invalid_payload");
        }
        if (!payload || typeof payload.sections !== "object" || payload.sections === null) {
          throw new BackupError("invalid_payload");
        }
        dispatch({ type: "decrypted", payload });
      } catch (e) {
        // Only a tag that fails to verify is a wrong passphrase; the rest are real faults.
        if (e instanceof DecryptAuthError) {
          dispatch({ type: "password_bad" });
        } else {
          dispatch({
            type: "error",
            code: errorCodeOf(e),
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
    },
    [envelope],
  );

  const poll = useCallback((jobId: string) => {
    const tick = (misses: number) => {
      pollTimer.current = setTimeout(async () => {
        if (!alive.current) return;
        let next = misses + 1;
        try {
          const r = await authFetch(`${CONFIG_BACKUP_CGI}/apply_status.sh`);
          const body = (await r.json()) as ApplyStatusResponse;
          if (body.success && body.status !== "idle" && body.job_id === jobId) {
            next = 0;
            const progress: RestoreProgress = {
              job_id: body.job_id,
              status: body.status,
              started_at: body.started_at,
              completed_at: body.completed_at,
              reboot_required: body.reboot_required === true,
              sections: Array.isArray(body.sections) ? body.sections : [],
              summary: body.summary ?? null,
            };
            dispatch({ type: "progress", progress });
            if (progress.status !== "running") {
              dispatch({ type: "apply_done", progress });
              return;
            }
          }
        } catch {
          /* a missed poll: the link may be down while a section applies */
        }
        if (!alive.current) return;
        if (next >= MAX_POLL_MISSES) {
          dispatch({ type: "error", code: "status_lost", detail: null });
          return;
        }
        tick(next);
      }, POLL_INTERVAL_MS);
    };
    tick(0);
  }, []);

  const payload = state.payload;
  const startApply = useCallback(
    async (keys: BackupSectionKey[], imeiConfirmed: boolean): Promise<StartApplyResult> => {
      if (!payload || !envelope) return { ok: false, code: null, detail: null };
      dispatch({ type: "apply_started" });
      const sections: Record<string, unknown> = {};
      for (const k of keys) {
        if (k in payload.sections) sections[k] = payload.sections[k];
      }
      const body: ApplyRequest = {
        schema: 1,
        platform: BACKUP_PLATFORM,
        format_version: envelope.format_version,
        source_model: envelope.device.model,
        // The card decides: the IMEI section or a profile IMEI the user confirmed.
        options: { imei_confirmed: imeiConfirmed },
        sections,
      };
      try {
        const res = await authFetch(`${CONFIG_BACKUP_CGI}/apply.sh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        let data: ApplyResponse;
        try {
          data = (await res.json()) as ApplyResponse;
        } catch {
          throw new BackupError("start_failed", `HTTP ${res.status}`);
        }
        if (!data.success) {
          const code = data.error ?? "start_failed";
          dispatch({ type: "error", code, detail: data.detail ?? null });
          return { ok: false, code, detail: data.detail ?? null };
        }
        stopPolling();
        poll(data.job_id);
        return { ok: true, jobId: data.job_id };
      } catch (e) {
        const code = errorCodeOf(e);
        const detail = e instanceof Error ? e.message : String(e);
        dispatch({ type: "error", code, detail });
        return { ok: false, code, detail };
      }
    },
    [payload, envelope, poll, stopPolling],
  );

  const cancel = useCallback(async (): Promise<boolean> => {
    try {
      const res = await authFetch(`${CONFIG_BACKUP_CGI}/apply_cancel.sh`, { method: "POST" });
      const body = (await res.json()) as { success?: boolean };
      return body.success === true;
    } catch {
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    dispatch({ type: "reset" });
  }, [stopPolling]);

  const planned: BackupSectionKey[] = payload
    ? SECTION_KEYS.filter((k) => isSectionKey(k) && k in payload.sections)
    : [];

  return { state, planned, readFile, tryPassword, startApply, cancel, reset };
}
