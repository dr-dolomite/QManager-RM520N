import { toast } from "sonner";
import type { TFunction } from "i18next";

import type {
  TowerActionResult,
  TowerSettingsChange,
  TowerWarningCode,
} from "@/types/tower-locking";

const K = "tower_locking";

export type UpdateTowerSettings = (
  change: TowerSettingsChange,
) => Promise<TowerActionResult>;

/** Literal keys: `i18n:check` cannot see an interpolated stem. */
const WARNING_KEY: Record<TowerWarningCode, string> = {
  persist_command_failed: `${K}.warning.persist_command_failed`,
  service_enable_failed: `${K}.warning.service_enable_failed`,
  service_disable_failed: `${K}.warning.service_disable_failed`,
};

/** One toast for one finished tower write (error, partial-success warning, or success); returns whether it
 * landed cleanly. */
export function reportTowerResult(
  t: TFunction,
  result: TowerActionResult,
  successMessage: string,
  fallback: string,
): boolean {
  if (!result.ok) {
    toast.error(result.error ?? fallback);
    return false;
  }
  if (result.warning) {
    toast.warning(t(WARNING_KEY[result.warning]));
    return false;
  }
  toast.success(successMessage);
  return true;
}

/** One settings write, one toast, whichever control asked; a rejected `save_ctrl` warns and counts as not landed. */
export async function writeTowerSettings(
  t: TFunction,
  update: UpdateTowerSettings,
  change: TowerSettingsChange,
  successMessage: string,
): Promise<boolean> {
  const result = await update(change);
  const landed = reportTowerResult(
    t,
    result,
    successMessage,
    t(`${K}.errors.settings_failed`),
  );
  // A boot-unit warning still means the setting itself was written.
  return landed || (result.ok && result.warning !== "persist_command_failed");
}
