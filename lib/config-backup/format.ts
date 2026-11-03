// lib/config-backup/format.ts — the .qmbackup envelope: AAD, parse, filename.
import type { BackupEnvelope, BackupEnvelopeHeader } from "@/types/config-backup";

import { BackupError } from "./crypto";

export const BACKUP_MAGIC = "QMBACKUP";
export const BACKUP_PLATFORM = "rm520n";
export const BACKUP_FORMAT_MAJOR = 1;
const SUPPORTED_VERSIONS = new Set([1]);

/** Canonical header JSON in a fixed key order, bound as the GCM AAD. */
export function canonicalHeaderAad(header: BackupEnvelopeHeader): Uint8Array {
  const ordered = {
    magic: header.magic,
    version: header.version,
    format_version: header.format_version,
    platform: header.platform,
    created_at: header.created_at,
    device: {
      model: header.device.model,
      firmware: header.device.firmware,
      imei: header.device.imei,
      qmanager_version: header.device.qmanager_version,
    },
    sections_included: [...header.sections_included].sort(),
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

export function buildEnvelope(
  header: BackupEnvelopeHeader,
  crypto: Pick<BackupEnvelope, "kdf" | "cipher">,
): BackupEnvelope {
  return { ...header, ...crypto };
}

/** Parse and check the header; platform and format checks run before any passphrase. */
export function parseEnvelope(blob: string): BackupEnvelope {
  let obj: unknown;
  try {
    obj = JSON.parse(blob);
  } catch {
    throw new BackupError("invalid_envelope", "not JSON");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new BackupError("invalid_envelope", "not an object");
  }
  const e = obj as Partial<BackupEnvelope>;
  if (e.magic !== BACKUP_MAGIC) throw new BackupError("invalid_envelope", "wrong magic");
  if (typeof e.version !== "number" || !SUPPORTED_VERSIONS.has(e.version)) {
    throw new BackupError("wrong_version", String(e.version));
  }
  if (e.platform !== BACKUP_PLATFORM) {
    throw new BackupError("foreign_platform", String(e.platform ?? "none"));
  }
  const major = Number.parseInt(String(e.format_version ?? ""), 10);
  if (!Number.isFinite(major)) throw new BackupError("invalid_envelope", "format_version");
  if (major > BACKUP_FORMAT_MAJOR) throw new BackupError("backup_too_new", String(e.format_version));
  if (
    !e.device ||
    typeof e.device.model !== "string" ||
    typeof e.created_at !== "string" ||
    !Array.isArray(e.sections_included)
  ) {
    throw new BackupError("invalid_envelope", "missing fields");
  }
  if (
    !e.kdf ||
    !e.cipher ||
    typeof e.kdf.salt !== "string" ||
    typeof e.kdf.iter !== "number" ||
    typeof e.cipher.iv !== "string" ||
    typeof e.cipher.ciphertext !== "string"
  ) {
    throw new BackupError("invalid_envelope", "missing crypto fields");
  }
  return e as BackupEnvelope;
}

/** `qmanager-<model>-<YYYYMMDD-HHMMSS>.qmbackup`, UTC. */
export function envelopeFilename(model: string, created: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts =
    created.getUTCFullYear().toString() +
    pad(created.getUTCMonth() + 1) +
    pad(created.getUTCDate()) +
    "-" +
    pad(created.getUTCHours()) +
    pad(created.getUTCMinutes()) +
    pad(created.getUTCSeconds());
  const safeModel = (model || "modem").replace(/[^A-Za-z0-9_-]/g, "_");
  return `qmanager-${safeModel}-${ts}.qmbackup`;
}

/** `BackupError` → its code; anything else → null (caller falls back). */
export function errorCodeOf(e: unknown): string | null {
  if (e instanceof BackupError) return e.code;
  return null;
}
