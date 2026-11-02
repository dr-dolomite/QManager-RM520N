"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { isMotionReduced } from "@/lib/motion-preference";
import { useSaveFlash } from "@/components/ui/save-button";
import type {
  WatchdogSettings,
  WatchdogSavePayload,
  WatchdogSaveResult,
} from "@/hooks/use-watchdog-settings";
import { isIntInRange, type TierIndex } from "./derive";

// Ladder and Detection each commit their own draft. The CGI save is atomic, so
// a card's save sends its draft over the OTHER card's saved values.

/** Probe cadence options (seconds) offered by the Probe Every control. */
export const PROBE_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30] as const;

/** A callback-ref factory: the form owns the map, a card registers into it. */
export type RegisterField = (id: string) => (el: HTMLElement | null) => void;

export type WatchdogScope = "ladder" | "detection";

/** The five controls, by the id they register under. */
export const FIELD_ID = {
  probeInterval: "watchdog-probe-interval",
  failThreshold: "watchdog-fail-threshold",
  cooldown: "watchdog-cooldown",
  backupSim: "watchdog-backup-slot",
  recheckInterval: "watchdog-recheck-interval",
  maxReboots: "watchdog-max-reboots",
  qualityConsecutive: "watchdog-quality-consecutive",
  ssrGrace: "watchdog-ssr-grace",
} as const;

/** Reading order per card, which is also the order a blocked save walks them in. */
const SCOPE_FIELDS = {
  ladder: ["backupSim", "recheckInterval", "maxReboots"],
  detection: ["probeInterval", "failThreshold", "cooldown", "qualityConsecutive", "ssrGrace"],
} as const satisfies Record<WatchdogScope, readonly (keyof WatchdogFormErrors)[]>;

/** A blocked save names the FIELD by its visible label. */
export const FIELD_LABEL_KEY: Record<keyof WatchdogFormErrors, string> = {
  probeInterval: "watchdog.detection.probe.label",
  failThreshold: "watchdog.detection.threshold.label",
  cooldown: "watchdog.detection.cooldown.label",
  backupSim: "watchdog.ladder.tier3.slotLabel",
  recheckInterval: "watchdog.ladder.failback.intervalLabel",
  maxReboots: "watchdog.ladder.tier4.capLabel",
  qualityConsecutive: "watchdog.detection.quality.label",
  ssrGrace: "watchdog.detection.ssr.label",
};

export interface WatchdogFormErrors {
  failThreshold: string | null;
  probeInterval: string | null;
  cooldown: string | null;
  maxReboots: string | null;
  backupSim: string | null;
  recheckInterval: string | null;
  qualityConsecutive: string | null;
  ssrGrace: string | null;
}

/** Every field the two cards edit. Numbers stay strings while typed. */
export interface WatchdogDraft {
  enabled: boolean;
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
  tier4: boolean;
  backupSlot: string;
  recheck: boolean;
  recheckInterval: string;
  maxReboots: string;
  probeInterval: string;
  failThreshold: string;
  cooldown: string;
  quality: boolean;
  qualityConsecutive: string;
  ssrAware: boolean;
  ssrGrace: string;
}

const SCOPE_KEYS = {
  ladder: [
    "enabled",
    "tier1",
    "tier2",
    "tier3",
    "tier4",
    "backupSlot",
    "recheck",
    "recheckInterval",
    "maxReboots",
  ],
  detection: [
    "probeInterval",
    "failThreshold",
    "cooldown",
    "quality",
    "qualityConsecutive",
    "ssrAware",
    "ssrGrace",
  ],
} as const satisfies Record<WatchdogScope, readonly (keyof WatchdogDraft)[]>;

export interface ScopeState {
  dirty: boolean;
  /** Fields blocking this card's save, in reading order. */
  blockedFields: (keyof WatchdogFormErrors)[];
  isSaving: boolean;
  /** Either card is saving; one save at a time. */
  busy: boolean;
  saved: boolean;
  submit: () => Promise<void>;
  discard: () => void;
  /** Focus and reveal the first blocking control. No-op when nothing blocks. */
  focusFirstBlocked: () => void;
}

export interface WatchdogForm {
  /** The draft both cards render: saved truth overlaid with unsaved edits. */
  draft: WatchdogDraft;
  setFields: (patch: Partial<WatchdogDraft>) => void;
  errors: WatchdogFormErrors;
  scopes: Record<WatchdogScope, ScopeState>;
  /** Newly lets the watchdog reboot unattended; keyed on master AND tier 4 (stock ships tier 4 armed, master off). */
  grantsRebootAuthority: boolean;
  registerField: RegisterField;
}

interface UseWatchdogFormArgs {
  settings: WatchdogSettings;
  isSaving: boolean;
  saveSettings: (payload: WatchdogSavePayload) => Promise<WatchdogSaveResult>;
}

const savedDraft = (s: WatchdogSettings): WatchdogDraft => ({
  enabled: s.enabled,
  tier1: s.tier1_enabled,
  tier2: s.tier2_enabled,
  tier3: s.tier3_enabled,
  tier4: s.tier4_enabled,
  backupSlot: s.backup_sim_slot != null ? String(s.backup_sim_slot) : "",
  recheck: s.primary_recheck_enabled ?? false,
  recheckInterval: String(s.primary_recheck_interval ?? 30),
  maxReboots: String(s.max_reboots_per_hour),
  probeInterval: String(s.probe_interval),
  failThreshold: String(s.fail_threshold),
  cooldown: String(s.cooldown),
  quality: s.quality_enabled ?? false,
  qualityConsecutive: String(s.quality_consecutive ?? 5),
  ssrAware: s.ssr_aware ?? true,
  ssrGrace: String(s.ssr_grace ?? 45),
});

/** The recheck interval is editable only while its row is live. */
const recheckLive = (d: WatchdogDraft) => d.enabled && d.tier3 && d.recheck;

const toPayload = (d: WatchdogDraft): WatchdogSavePayload => ({
  action: "save_settings",
  enabled: d.enabled,
  fail_threshold: parseInt(d.failThreshold, 10),
  probe_interval: parseInt(d.probeInterval, 10),
  cooldown: parseInt(d.cooldown, 10),
  tier1_enabled: d.tier1,
  tier2_enabled: d.tier2,
  tier3_enabled: d.tier3,
  tier4_enabled: d.tier4,
  backup_sim_slot: d.backupSlot ? parseInt(d.backupSlot, 10) : null,
  max_reboots_per_hour: parseInt(d.maxReboots || "3", 10),
  primary_recheck_enabled: d.recheck,
  primary_recheck_interval: recheckLive(d) ? parseInt(d.recheckInterval, 10) : undefined,
  quality_enabled: d.quality,
  quality_consecutive: d.quality ? parseInt(d.qualityConsecutive, 10) : undefined,
  ssr_aware: d.ssrAware,
  // Off leaves the stored grace alone, so an unvalidated field is never sent.
  ssr_grace: d.ssrAware ? parseInt(d.ssrGrace, 10) : undefined,
});

const omit = (
  edits: Partial<WatchdogDraft>,
  keys: readonly (keyof WatchdogDraft)[],
): Partial<WatchdogDraft> => {
  const next = { ...edits };
  for (const k of keys) delete next[k];
  return next;
};

export function useWatchdogForm({
  settings,
  isSaving,
  saveSettings,
}: UseWatchdogFormArgs): WatchdogForm {
  const { t } = useTranslation("common");
  const ladderFlash = useSaveFlash();
  const detectionFlash = useSaveFlash();

  // Edits overlay server truth, so a re-read never eats a typed value and one
  // card's save leaves the other card's half-edit alone.
  const [edits, setEdits] = useState<Partial<WatchdogDraft>>({});
  const [savingScope, setSavingScope] = useState<WatchdogScope | null>(null);

  const saved = useMemo(() => savedDraft(settings), [settings]);
  const draft = useMemo<WatchdogDraft>(() => ({ ...saved, ...edits }), [saved, edits]);

  const setFields = useCallback((patch: Partial<WatchdogDraft>) => {
    setEdits((prev) => ({ ...prev, ...patch }));
  }, []);

  // Values are i18n KEYS; the rendering component translates them.
  const errors = useMemo<WatchdogFormErrors>(
    () => ({
      failThreshold:
        draft.failThreshold && !isIntInRange(draft.failThreshold, 1, 20)
          ? "watchdog.errors.failThreshold"
          : null,
      probeInterval:
        draft.probeInterval && !isIntInRange(draft.probeInterval, 1, 60)
          ? "watchdog.errors.probeInterval"
          : null,
      cooldown:
        draft.cooldown && !isIntInRange(draft.cooldown, 10, 300)
          ? "watchdog.errors.cooldown"
          : null,
      maxReboots:
        draft.tier4 && draft.maxReboots && !isIntInRange(draft.maxReboots, 1, 10)
          ? "watchdog.errors.maxReboots"
          : null,
      // An unset slot leaves the ladder unable to fail over, so it blocks.
      backupSim:
        draft.tier3 && !draft.backupSlot ? "watchdog.errors.backupSim" : null,
      recheckInterval:
        recheckLive(draft) &&
        draft.recheckInterval &&
        !isIntInRange(draft.recheckInterval, 5, 1440)
          ? "watchdog.errors.recheckInterval"
          : null,
      qualityConsecutive:
        draft.quality &&
        draft.qualityConsecutive &&
        !isIntInRange(draft.qualityConsecutive, 1, 60)
          ? "watchdog.errors.qualityConsecutive"
          : null,
      ssrGrace:
        draft.ssrAware && draft.ssrGrace && !isIntInRange(draft.ssrGrace, 10, 120)
          ? "watchdog.errors.ssrGrace"
          : null,
    }),
    [draft],
  );

  // An empty required field is not a range error but still blocks.
  const emptyRequired: Partial<Record<keyof WatchdogFormErrors, boolean>> = {
    probeInterval: draft.probeInterval.trim() === "",
    failThreshold: draft.failThreshold.trim() === "",
    cooldown: draft.cooldown.trim() === "",
    maxReboots: draft.tier4 && draft.maxReboots.trim() === "",
    recheckInterval: recheckLive(draft) && draft.recheckInterval.trim() === "",
    qualityConsecutive: draft.quality && draft.qualityConsecutive.trim() === "",
    ssrGrace: draft.ssrAware && draft.ssrGrace.trim() === "",
  };

  const blockedFor = (scope: WatchdogScope) =>
    SCOPE_FIELDS[scope].filter(
      (key) => errors[key] !== null || emptyRequired[key] === true,
    );
  const dirtyFor = (scope: WatchdogScope) =>
    SCOPE_KEYS[scope].some((k) => draft[k] !== saved[k]);

  const grantsRebootAuthority =
    draft.enabled && draft.tier4 && !(settings.enabled && settings.tier4_enabled);

  // A ref, because nothing renders off it.
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = useCallback<RegisterField>(
    (id) => (el) => {
      fieldRefs.current[id] = el;
    },
    [],
  );

  const focusField = (key: keyof WatchdogFormErrors) => {
    const host = fieldRefs.current[FIELD_ID[key]];
    if (!host) return;
    // A segmented control registers its wrapper; focus its first visible segment.
    const el = host.matches("input, button")
      ? host
      : Array.from(host.querySelectorAll<HTMLElement>("input, button")).find(
          (n) => n.getClientRects().length > 0 && !n.hasAttribute("disabled"),
        );
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({
      block: "center",
      behavior: isMotionReduced() ? "auto" : "smooth",
    });
  };

  const submitScope = async (scope: WatchdogScope) => {
    if (!dirtyFor(scope) || blockedFor(scope).length > 0 || isSaving) return;
    // This card's draft over the other card's SAVED values.
    const sent: WatchdogDraft = { ...saved };
    for (const k of SCOPE_KEYS[scope]) Object.assign(sent, { [k]: draft[k] });

    setSavingScope(scope);
    // The RESULT carries the backend's reason; hook `error` state would be stale here.
    const result = await saveSettings(toPayload(sent));
    setSavingScope(null);
    if (result.ok) {
      setEdits((prev) => omit(prev, SCOPE_KEYS[scope]));
      (scope === "ladder" ? ladderFlash : detectionFlash).markSaved();
      toast.success(t("watchdog.save.toastOk"));
    } else {
      toast.error(t("watchdog.save.toastFail"), {
        description: result.message ?? undefined,
      });
    }
  };

  const scopeState = (scope: WatchdogScope): ScopeState => ({
    dirty: dirtyFor(scope),
    blockedFields: blockedFor(scope),
    isSaving: isSaving && savingScope === scope,
    busy: isSaving,
    saved: (scope === "ladder" ? ladderFlash : detectionFlash).saved,
    submit: () => submitScope(scope),
    discard: () => setEdits((prev) => omit(prev, SCOPE_KEYS[scope])),
    focusFirstBlocked: () => {
      const first = blockedFor(scope)[0];
      if (first) focusField(first);
    },
  });

  return {
    draft,
    setFields,
    errors,
    scopes: { ladder: scopeState("ladder"), detection: scopeState("detection") },
    grantsRebootAuthority,
    registerField,
  };
}

/** Tier on/off by index, for the rungs and the timeline. */
export const draftTiers = (d: WatchdogDraft): Record<TierIndex, boolean> => ({
  1: d.tier1,
  2: d.tier2,
  3: d.tier3,
  4: d.tier4,
});
