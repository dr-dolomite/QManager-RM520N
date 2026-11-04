import type { TFunction } from "i18next";

import type { FreqLockResult } from "@/hooks/use-frequency-locking";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

// =============================================================================
// The failure sentence for a lock or unlock write
// =============================================================================
// Toasts take the reason from the write's OWN returned result, never from
// shared hook state (DESIGN.md > Confirmation Toasts). The two tower-gate
// refusals have copy of their own on this surface, because `lock.sh`'s detail
// is hard-coded English and the generic error catalogue has no sentence that
// says what the user should do next. Every other code goes through
// `resolveErrorMessage`.
// =============================================================================

export function lockFailureMessage(
  t: TFunction,
  result: FreqLockResult,
  fallback: string,
): string {
  if (result.error === "tower_lock_active") {
    return t("frequency_locking.blocked.tower_lock_active");
  }
  if (result.error === "tower_lock_unknown") {
    return t("frequency_locking.blocked.tower_lock_unknown");
  }
  return resolveErrorMessage(t, result.error, result.detail, fallback);
}
