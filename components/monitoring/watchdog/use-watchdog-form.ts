"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSaveFlash } from "@/components/ui/save-button";
import type {
  WatchdogSettings,
  WatchdogSavePayload,
} from "@/hooks/use-watchdog-settings";

// -----------------------------------------------------------------------------
// useWatchdogForm — the single form-state coordinator for the watchdog page.
// -----------------------------------------------------------------------------
// The page splits the surface into a status hero + a tabbed settings card, but
// the backend save is ATOMIC: one `save_settings` POST carrying every field. So
// one hook owns the whole form — every value, every validation rule, the dirty
// check, the submit, and the discard — and each card consumes the slice it
// renders.
//
// The consuming component is keyed on a signature of `settings` (see
// `watchdog.tsx`), so this hook remounts and re-seeds its `useState` defaults
// from fresh server values after every save / background refetch. That keeps the
// initial-value pattern honest without a setState-in-effect (forbidden by the
// project's React-Compiler lint rules).

/** Probe cadence options (seconds) offered by the Probe Interval Select. */
export const PROBE_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30] as const;

export interface WatchdogFormErrors {
  failThreshold: string | null;
  probeInterval: string | null;
  cooldown: string | null;
  maxReboots: string | null;
  backupSim: string | null;
}

export interface WatchdogForm {
  // Master
  isEnabled: boolean;
  setIsEnabled: (v: boolean) => void;

  // Detection policy
  probeInterval: string; // one of PROBE_INTERVAL_OPTIONS, as a string (ping cadence)
  setProbeInterval: (v: string) => void;
  failThreshold: string;
  setFailThreshold: (v: string) => void;
  cooldown: string;
  setCooldown: (v: string) => void;
  /** probe_interval × fail_threshold — honest "declares down after ~Ns". */
  estimatedDownSecs: number | null;

  // Recovery ladder tiers
  tier1Enabled: boolean;
  setTier1Enabled: (v: boolean) => void;
  tier2Enabled: boolean;
  setTier2Enabled: (v: boolean) => void;
  tier3Enabled: boolean;
  setTier3Enabled: (v: boolean) => void;
  tier4Enabled: boolean;
  setTier4Enabled: (v: boolean) => void;
  backupSimSlot: string;
  setBackupSimSlot: (v: string) => void;
  maxRebootsPerHour: string;
  setMaxRebootsPerHour: (v: string) => void;

  // Derived
  errors: WatchdogFormErrors;
  hasValidationErrors: boolean;
  isDirty: boolean;
  canSave: boolean;

  // Flow
  isSaving: boolean;
  saved: boolean;
  submit: () => Promise<void>;
  discard: () => void;
}

interface UseWatchdogFormArgs {
  settings: WatchdogSettings;
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: WatchdogSavePayload) => Promise<boolean>;
}

const isIntInRange = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  return !(raw === "" || isNaN(n) || !Number.isInteger(n) || n < min || n > max);
};

export function useWatchdogForm({
  settings,
  isSaving,
  error,
  saveSettings,
}: UseWatchdogFormArgs): WatchdogForm {
  const { saved, markSaved } = useSaveFlash();

  const [isEnabled, setIsEnabled] = useState(settings.enabled);
  // check_interval is the watchdog's internal sampling loop. It no longer has a
  // user-facing control (probe_interval is the meaningful cadence now), but we
  // still round-trip its saved value through the atomic save so it's preserved.
  const [checkInterval] = useState(String(settings.check_interval));
  const [probeInterval, setProbeInterval] = useState(
    String(settings.probe_interval),
  );
  const [failThreshold, setFailThreshold] = useState(
    String(settings.fail_threshold),
  );
  const [cooldown, setCooldown] = useState(String(settings.cooldown));
  const [tier1Enabled, setTier1Enabled] = useState(settings.tier1_enabled);
  const [tier2Enabled, setTier2Enabled] = useState(settings.tier2_enabled);
  const [tier3Enabled, setTier3Enabled] = useState(settings.tier3_enabled);
  const [tier4Enabled, setTier4Enabled] = useState(settings.tier4_enabled);
  const [backupSimSlot, setBackupSimSlot] = useState(
    settings.backup_sim_slot != null ? String(settings.backup_sim_slot) : "",
  );
  const [maxRebootsPerHour, setMaxRebootsPerHour] = useState(
    String(settings.max_reboots_per_hour),
  );

  // --- Derived preview ---
  // Raw probe streak at the probe cadence: probe_interval × fail_threshold.
  const estimatedDownSecs = useMemo<number | null>(() => {
    if (!isIntInRange(probeInterval, 1, 60)) return null;
    if (!isIntInRange(failThreshold, 1, 20)) return null;
    return Number(probeInterval) * Number(failThreshold);
  }, [probeInterval, failThreshold]);

  // --- Validation (mirrors the CGI field ranges) ---
  const errors = useMemo<WatchdogFormErrors>(() => {
    const failThresholdErr =
      failThreshold && !isIntInRange(failThreshold, 1, 20)
        ? "Must be 1–20"
        : null;
    const probeIntervalErr =
      probeInterval && !isIntInRange(probeInterval, 1, 60)
        ? "Must be 1–60 seconds"
        : null;
    const cooldownErr =
      cooldown && !isIntInRange(cooldown, 10, 300)
        ? "Must be 10–300 seconds"
        : null;
    const maxRebootsErr =
      tier4Enabled && maxRebootsPerHour && !isIntInRange(maxRebootsPerHour, 1, 10)
        ? "Must be 1–10"
        : null;
    // Backup slot is required whenever Tier 3 (SIM failover) is enabled — an
    // unset slot leaves the ladder unable to fail over, so block the save.
    const backupSimErr =
      tier3Enabled && !backupSimSlot
        ? "Choose a backup SIM slot to enable failover."
        : null;

    return {
      failThreshold: failThresholdErr,
      probeInterval: probeIntervalErr,
      cooldown: cooldownErr,
      maxReboots: maxRebootsErr,
      backupSim: backupSimErr,
    };
  }, [failThreshold, probeInterval, cooldown, tier4Enabled, maxRebootsPerHour, tier3Enabled, backupSimSlot]);

  const hasValidationErrors = useMemo(
    () => Object.values(errors).some(Boolean),
    [errors],
  );

  // Empty-while-required fields aren't range errors but still can't be saved.
  const hasEmptyRequired =
    failThreshold.trim() === "" ||
    probeInterval.trim() === "" ||
    cooldown.trim() === "" ||
    (tier4Enabled && maxRebootsPerHour.trim() === "");

  const isDirty = useMemo(
    () =>
      isEnabled !== settings.enabled ||
      probeInterval !== String(settings.probe_interval) ||
      failThreshold !== String(settings.fail_threshold) ||
      cooldown !== String(settings.cooldown) ||
      tier1Enabled !== settings.tier1_enabled ||
      tier2Enabled !== settings.tier2_enabled ||
      tier3Enabled !== settings.tier3_enabled ||
      tier4Enabled !== settings.tier4_enabled ||
      backupSimSlot !==
        (settings.backup_sim_slot != null
          ? String(settings.backup_sim_slot)
          : "") ||
      maxRebootsPerHour !== String(settings.max_reboots_per_hour),
    [
      settings,
      isEnabled,
      probeInterval,
      failThreshold,
      cooldown,
      tier1Enabled,
      tier2Enabled,
      tier3Enabled,
      tier4Enabled,
      backupSimSlot,
      maxRebootsPerHour,
    ],
  );

  const canSave =
    !hasValidationErrors && !hasEmptyRequired && isDirty && !isSaving;

  const submit = useCallback(async () => {
    if (hasValidationErrors || hasEmptyRequired || !isDirty || isSaving) return;

    const payload: WatchdogSavePayload = {
      action: "save_settings",
      enabled: isEnabled,
      fail_threshold: parseInt(failThreshold, 10),
      probe_interval: parseInt(probeInterval, 10),
      // Preserved untouched: no user-facing control, round-tripped at its saved value.
      check_interval: parseInt(checkInterval, 10),
      cooldown: parseInt(cooldown, 10),
      tier1_enabled: tier1Enabled,
      tier2_enabled: tier2Enabled,
      tier3_enabled: tier3Enabled,
      tier4_enabled: tier4Enabled,
      backup_sim_slot: backupSimSlot ? parseInt(backupSimSlot, 10) : null,
      max_reboots_per_hour: parseInt(maxRebootsPerHour || "3", 10),
    };

    const ok = await saveSettings(payload);
    if (ok) {
      markSaved();
      toast.success("Watchdog settings saved");
    } else {
      toast.error(error || "Failed to save watchdog settings");
    }
  }, [
    hasValidationErrors,
    hasEmptyRequired,
    isDirty,
    isSaving,
    isEnabled,
    failThreshold,
    probeInterval,
    checkInterval,
    cooldown,
    tier1Enabled,
    tier2Enabled,
    tier3Enabled,
    tier4Enabled,
    backupSimSlot,
    maxRebootsPerHour,
    saveSettings,
    markSaved,
    error,
  ]);

  // Discard resets every field to the server-truth in `settings`.
  // check_interval has no control, so it never diverges — nothing to reset.
  const discard = useCallback(() => {
    setIsEnabled(settings.enabled);
    setProbeInterval(String(settings.probe_interval));
    setFailThreshold(String(settings.fail_threshold));
    setCooldown(String(settings.cooldown));
    setTier1Enabled(settings.tier1_enabled);
    setTier2Enabled(settings.tier2_enabled);
    setTier3Enabled(settings.tier3_enabled);
    setTier4Enabled(settings.tier4_enabled);
    setBackupSimSlot(
      settings.backup_sim_slot != null ? String(settings.backup_sim_slot) : "",
    );
    setMaxRebootsPerHour(String(settings.max_reboots_per_hour));
  }, [settings]);

  return {
    isEnabled,
    setIsEnabled,
    probeInterval,
    setProbeInterval,
    failThreshold,
    setFailThreshold,
    cooldown,
    setCooldown,
    estimatedDownSecs,
    tier1Enabled,
    setTier1Enabled,
    tier2Enabled,
    setTier2Enabled,
    tier3Enabled,
    setTier3Enabled,
    tier4Enabled,
    setTier4Enabled,
    backupSimSlot,
    setBackupSimSlot,
    maxRebootsPerHour,
    setMaxRebootsPerHour,
    errors,
    hasValidationErrors,
    isDirty,
    canSave,
    isSaving,
    saved,
    submit,
    discard,
  };
}
