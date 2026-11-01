// Types for the SSH password endpoint; mirrors auth/ssh_password.sh.

export interface SshPasswordChangeRequest {
  current_password: string;
  new_password: string;
  enforce_strong: boolean;
}

/** Check the current root password only; nothing is changed. */
export interface SshPasswordVerifyRequest {
  current_password: string;
  verify_only: true;
}

export type SshPasswordErrorCode =
  | "missing_fields"
  | "password_weak"
  | "password_mismatch"
  | "rate_limited"
  | "invalid_password"
  | "no_password_set"
  | "hash_tool_missing"
  | "root_hash_unsupported"
  | "verify_unavailable"
  | "passwd_failed";

export interface SshPasswordChangeSuccess {
  success: true;
}

export interface SshPasswordChangeFailure {
  success: false;
  error: SshPasswordErrorCode | string;
  detail?: string;
  /** Present with `rate_limited`: seconds until the lockout lifts. */
  retry_after?: number;
  /** Present with `invalid_password` and `rate_limited`. */
  attempts_remaining?: number;
}

export type SshPasswordChangeResponse =
  | SshPasswordChangeSuccess
  | SshPasswordChangeFailure;
