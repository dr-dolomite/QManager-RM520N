"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import {
  BackupError,
  base64Encode,
  CRYPTO_PARAMS,
  deriveKey,
  encryptPayload,
  hasWebCrypto,
  randomBytes,
} from "@/lib/config-backup/crypto";
import {
  buildEnvelope,
  canonicalHeaderAad,
  envelopeFilename,
  errorCodeOf,
} from "@/lib/config-backup/format";
import type {
  BackupSectionKey,
  CollectResponse,
  CollectSupportResponse,
} from "@/types/config-backup";

export const CONFIG_BACKUP_CGI = "/cgi-bin/quecmanager/system/config-backup";
export const MIN_PASSPHRASE_LEN = 10;

// ─── Which sections this device build can back up ───────────────────────────

export interface UseBackupSupportReturn {
  /** Keys `collect.sh` reports; null until the first successful read. */
  supported: ReadonlySet<string> | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useBackupSupport(): UseBackupSupportReturn {
  const [supported, setSupported] = useState<ReadonlySet<string> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${CONFIG_BACKUP_CGI}/collect.sh`);
      const body = (await res.json()) as
        | CollectSupportResponse
        | { success: false; error?: string };
      if (!mounted.current) return;
      if (!body.success || !Array.isArray(body.sections)) {
        setError(("error" in body && body.error) || `HTTP ${res.status}`);
      } else {
        setSupported(new Set(body.sections));
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return { supported, isLoading, error, refresh };
}

// ─── Create and download a backup ───────────────────────────────────────────

type BackupStage = "idle" | "collecting" | "encrypting" | "downloading";

export type BackupRunResult =
  | { ok: true; unavailable: string[] }
  | { ok: false; code: string | null; detail: string | null };

export interface UseConfigBackupReturn {
  stage: BackupStage;
  runBackup: (selected: BackupSectionKey[], passphrase: string) => Promise<BackupRunResult>;
}

function triggerDownload(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the download has the URL when it starts.
  window.setTimeout(() => URL.revokeObjectURL(objUrl), 0);
}

export function useConfigBackup(): UseConfigBackupReturn {
  const [stage, setStage] = useState<BackupStage>("idle");

  const runBackup = useCallback(
    async (selected: BackupSectionKey[], passphrase: string): Promise<BackupRunResult> => {
      try {
        if (selected.length === 0) throw new BackupError("no_sections");
        if (passphrase.length < MIN_PASSPHRASE_LEN) throw new BackupError("passphrase_too_short");
        // Checked before the collect, so a plain-http page fails without a round trip.
        if (!hasWebCrypto()) throw new BackupError("insecure_context");

        setStage("collecting");
        const url = `${CONFIG_BACKUP_CGI}/collect.sh?sections=${encodeURIComponent(selected.join(","))}`;
        const res = await authFetch(url);
        let data: CollectResponse;
        try {
          data = (await res.json()) as CollectResponse;
        } catch {
          throw new BackupError("collect_failed", `HTTP ${res.status}`);
        }
        if (!data.success) {
          throw new BackupError(data.error || "collect_failed", data.detail);
        }

        setStage("encrypting");
        const salt = randomBytes(CRYPTO_PARAMS.SALT_LEN);
        const iv = randomBytes(CRYPTO_PARAMS.IV_LEN);
        const key = await deriveKey(passphrase, salt);
        const aad = canonicalHeaderAad(data.header);
        const plaintext = new TextEncoder().encode(JSON.stringify(data.payload));
        const ct = await encryptPayload(key, iv, plaintext, aad);

        const envelope = buildEnvelope(data.header, {
          kdf: { algo: "PBKDF2-SHA256", iter: CRYPTO_PARAMS.KDF_ITER, salt: base64Encode(salt) },
          cipher: { algo: "AES-256-GCM", iv: base64Encode(iv), ciphertext: base64Encode(ct) },
        });

        setStage("downloading");
        triggerDownload(
          JSON.stringify(envelope),
          envelopeFilename(data.header.device.model, new Date()),
        );
        return { ok: true, unavailable: data.unavailable ?? [] };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return { ok: false, code: errorCodeOf(e), detail };
      } finally {
        setStage("idle");
      }
    },
    [],
  );

  return { stage, runBackup };
}
