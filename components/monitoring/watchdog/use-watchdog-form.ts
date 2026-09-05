"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useSaveFlash } from "@/components/ui/save-button";
import type {
  WatchdogSettings,
  WatchdogSavePayload,
} from "@/hooks/use-watchdog-settings";

// The backend save is ATOMIC — one POST carrying every field — so one hook owns
// the whole draft, its validation, the blocking set and the focus map.

/** Probe cadence options (seconds) offered by the Probe Interval Select. */
export const PROBE_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30] as const;

/** A callback-ref factory: the form owns the map, a card registers into it. */
export type RegisterField = (id: string) => (el: HTMLElement | null) => void;

/** The five controls, by the id they register under. */
export const FIELD_ID = {
  probeInterval: "watchdog-probe-interval",
  failThreshold: "watchdog-fail-threshold",
  cooldown: "watchdog-cooldown",
  backupSim: "watchdog-backup-slot",
  maxReboots: "watchdog-max-reboots",
} as const;

/** Reading order, which is also the order a blocked save walks them in. */
const FIELD_ORDER = [
  "probeInterval",
  "failThreshold",
  "cooldown",
  "backupSim",
  "maxReboots",
] as const;

/** The blocked save bar names the FIELD, not a tab. There are no tabs now. */
export const FIELD_LABEL_KEY: Record<keyof WatchdogFormErrors, string> = {
  probeInterval: "watchdog.detection.probe.label",
  failThreshold: "watchdog.detection.threshold.label",
  cooldown: "watchdog.detection.cooldown.label",
  backupSim: "watchdog.ladder.tier3.slotLabel",
  maxReboots: "watchdog.ladder.tier4.capLabel",
};

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
  /** Fields blocking the save, in reading order. Empty when nothing blocks. */
  blockedFields: (keyof WatchdogFormErrors)[];

  // Focus
  registerField: RegisterField;
  /** Focus and reveal the first blocking control. No-op when nothing blocks. */
  focusFirstBlocked: () => void;

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

// Value fingerprint of every field the form mirrors. A change means server
// truth moved and the fields must be re-seeded; an identical signature (the
// common case for the hook's 30s background refetch, which allocates a fresh
// settings object every tick) leaves the user's edits alone.
const settingsSignature = (s: WatchdogSettings): string =>
  [
    s.enabled,
    s.fail_threshold,
    s.probe_interval,
    s.check_interval,
    s.cooldown,
    s.tier1_enabled,
    s.tier2_enabled,
    s.tier3_enabled,
    s.tier4_enabled,
    s.backup_sim_slot,
    s.max_reboots_per_hour,
  ].join("-");

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
  const { t } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();

  const [isEnabled, setIsEnabled] = useState(settings.enabled);
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
  // Values are i18n KEYS; the rendering component translates them.
  const errors = useMemo<WatchdogFormErrors>(() => {
    const failThresholdErr =
      failThreshold && !isIntInRange(failThreshold, 1, 20)
        ? "watchdog.errors.failThreshold"
        : null;
    const probeIntervalErr =
      probeInterval && !isIntInRange(probeInterval, 1, 60)
        ? "watchdog.errors.probeInterval"
        : null;
    const cooldownErr =
      cooldown && !isIntInRange(cooldown, 10, 300)
        ? "watchdog.errors.cooldown"
        : null;
    const maxRebootsErr =
      tier4Enabled && maxRebootsPerHour && !isIntInRange(maxRebootsPerHour, 1, 10)
        ? "watchdog.errors.maxReboots"
        : null;
    // Backup slot is required whenever Tier 3 (SIM failover) is enabled — an
    // unset slot leaves the ladder unable to fail over, so block the save.
    const backupSimErr =
      tier3Enabled && !backupSimSlot
        ? "watchdog.errors.backupSim"
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

  // An empty required field is not a range error but still blocks, so the two
  // sets are merged here rather than in each consumer.
  const emptyRequired: Partial<Record<keyof WatchdogFormErrors, boolean>> = {
    probeInterval: probeInterval.trim() === "",
    failThreshold: failThreshold.trim() === "",
    cooldown: cooldown.trim() === "",
    maxReboots: tier4Enabled && maxRebootsPerHour.trim() === "",
  };

  const blockedFields = FIELD_ORDER.filter(
    (key) => errors[key] !== null || emptyRequired[key] === true,
  );

  // The map is a ref because a card mounts and unmounts its tier-3/tier-4
  // controls with the switch; nothing renders off it.
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const registerField = useCallback<RegisterField>(
    (id) => (el) => {
      fieldRefs.current[id] = el;
    },
    [],
  );

  // A DOM side effect in a handler, never a setState in an effect. With the
  // tabs gone there is nothing to switch to first, so no rAF is needed.
  const focusFirstBlocked = useCallback(() => {
    const first = blockedFields[0];
    if (!first) return;
    const el = fieldRefs.current[FIELD_ID[first]];
    if (!el) return;
    el.focus({ preventScroll: true });
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [blockedFields]);

  const submit = useCallback(async () => {
    if (hasValidationErrors || hasEmptyRequired || !isDirty || isSaving) return;

    const payload: WatchdogSavePayload = {
      action: "save_settings",
      enabled: isEnabled,
      fail_threshold: parseInt(failThreshold, 10),
      probe_interval: parseInt(probeInterval, 10),
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
      toast.success(t("watchdog.save.toastOk"));
    } else {
      toast.error(error || t("watchdog.save.toastFail"));
    }
  }, [
    hasValidationErrors,
    hasEmptyRequired,
    isDirty,
    isSaving,
    isEnabled,
    failThreshold,
    probeInterval,
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
    t,
  ]);

  // Discard resets every field to the server-truth in `settings`.
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

  // ── Re-seed on server-truth change (render-phase, React-Compiler safe) ──────
  // `discard` is the already-correct re-seed path (pure setState, no async, no
  // toast), so reuse it rather than maintaining a parallel seeding path.
  const signature = settingsSignature(settings);
  const [prevSignature, setPrevSignature] = useState(signature);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    discard();
  }

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
    blockedFields,
    registerField,
    focusFirstBlocked,
    isSaving,
    saved,
    submit,
    discard,
  };
}
