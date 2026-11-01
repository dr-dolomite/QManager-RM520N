// Shared result shape for the Passwords card's two tabs (`verify_only` and full change).
// The card toasts the device's reason from the returned value, never from hook state.

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
