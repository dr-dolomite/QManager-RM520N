// =============================================================================
// password-change.ts — Shared result shape for the Passwords card's two tabs
// =============================================================================
// Web Password (`auth/password.sh`) and SSH Password (`auth/ssh_password.sh`)
// both take `verify_only` (check the current password, change nothing) and a
// full change. Their hooks resolve to this, so the card toasts the device's
// reason from the returned value and never from hook state read after an await.
// =============================================================================

export interface PasswordActionResult {
  success: boolean;
  /**
   * The reason, already translated (`resolveErrorMessage`). Absent on success
   * and when the failure carried no reason, so the caller shows its own line.
   */
  message?: string;
}

/** What one tab of the Passwords card needs from its hook. */
export interface PasswordActions {
  /** Check the current password; change nothing. */
  verifyPassword: (currentPassword: string) => Promise<PasswordActionResult>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
    enforceStrong: boolean,
  ) => Promise<PasswordActionResult>;
  isPending: boolean;
}
