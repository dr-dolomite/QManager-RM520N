// types/config-backup.ts — the .qmbackup envelope and the config-backup CGI contract.

/** Canonical section keys, in picker order. */
export type BackupSectionKey =
  | "network_mode"
  | "bands"
  | "apn"
  | "tower_lock"
  | "ttl_mtu"
  | "imei"
  | "profiles"
  | "scenarios"
  | "ip_passthrough"
  | "sms"
  | "lan"
  | "custom_dns"
  | "ethernet"
  | "traffic_engine"
  | "watchdog"
  | "quality"
  | "sites"
  | "alerts"
  | "adaptive_polling"
  | "system";

/** The four picker groups (labels via i18n). */
export type BackupSectionGroup =
  | "connection"
  | "local_network"
  | "monitoring"
  | "system";

/** One section in the picker. Labels live under `config_backup.sections.<key>`. */
export interface BackupSectionMeta {
  key: BackupSectionKey;
  group: BackupSectionGroup;
  defaultChecked: boolean;
  /** Restoring it queues a change that only takes effect after a reboot. */
  needsReboot: boolean;
}

/** Header fields of a backup envelope (not encrypted, but bound as AAD). */
export interface BackupEnvelopeHeader {
  magic: "QMBACKUP";
  version: 1;
  format_version: string;
  platform: string;
  created_at: string;
  device: {
    model: string;
    firmware: string;
    imei: string;
    qmanager_version: string;
  };
  sections_included: string[];
}

/** Full envelope: header plus KDF/cipher parameters and ciphertext. */
export interface BackupEnvelope extends BackupEnvelopeHeader {
  kdf: { algo: "PBKDF2-SHA256"; iter: number; salt: string };
  cipher: { algo: "AES-256-GCM"; iv: string; ciphertext: string };
}

/** Plaintext payload (what gets encrypted). */
export interface BackupPayload {
  schema: 1;
  sections: Record<string, unknown>;
}

/** `GET collect.sh` without arguments. */
export interface CollectSupportResponse {
  success: true;
  sections: string[];
}

/** `GET collect.sh?sections=…` */
export type CollectResponse =
  | {
      success: true;
      header: BackupEnvelopeHeader;
      payload: BackupPayload;
      unavailable?: string[];
    }
  | { success: false; error?: string; detail?: string };

/** `POST apply.sh` body. */
export interface ApplyRequest {
  schema: 1;
  platform: "rm520n";
  format_version: string;
  source_model: string;
  options: { imei_confirmed: boolean };
  sections: Record<string, unknown>;
}

export type ApplyResponse =
  | { success: true; status: "started"; job_id: string }
  | { success: false; error?: string; detail?: string };

/** Per-section status during a restore run. */
export type SectionStatus =
  | "pending"
  | "running"
  | `retrying:${number}`
  | "success"
  | "failed"
  | "skipped:incompatible"
  | "skipped:not_supported"
  | "skipped:sim_mismatch";

export interface SectionProgress {
  key: string;
  status: SectionStatus;
  attempts: number;
  message?: string;
  ignored_keys?: number;
  dropped?: number;
}

export type RestoreRunStatus = "running" | "done" | "cancelled" | "crashed";

/** `GET apply_status.sh` while a job exists. */
export interface RestoreProgress {
  job_id: string;
  status: RestoreRunStatus;
  started_at?: number;
  completed_at?: number;
  reboot_required: boolean;
  sections: SectionProgress[];
  summary: {
    success: number;
    failed: number;
    skipped: number;
    ignored_keys?: number;
    dropped?: number;
  } | null;
}

export type ApplyStatusResponse =
  | { success: true; status: "idle" }
  | ({ success: true } & RestoreProgress)
  | { success: false; error?: string; detail?: string };

/** Restore card state machine. */
export type RestoreUiState =
  | "idle"
  | "reading"
  | "password_required"
  | "password_incorrect"
  | "ready"
  | "applying"
  | "success"
  | "partial_success"
  | "failed";

/** Codes raised in the browser, resolved through the `errors` namespace. */
export type BackupClientErrorCode =
  | "invalid_envelope"
  | "wrong_version"
  | "foreign_platform"
  | "backup_too_new"
  | "insecure_context"
  | "decrypt_failed"
  | "invalid_payload"
  | "collect_failed";
