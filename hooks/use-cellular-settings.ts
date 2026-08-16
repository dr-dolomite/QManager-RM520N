"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import {
  WRITABLE_SETTING_KEYS,
  isWritableSettingKey,
  type CellularSettings,
  type CellularSettingsPatch,
  type CellularSettingsApplyResult,
  type WritableSettingKey,
  type AmbrData,
  type DualSlotEntry,
  type CellularSettingsResponse,
  type CellularSettingsApplyResponse,
} from "@/types/cellular-settings";

// =============================================================================
// useCellularSettings — Settings + AMBR fetch, edit-buffer, and apply hook
// =============================================================================
// Fetches current cellular settings and AMBR data on mount, and owns the
// pending-edit buffer that backs the persistent "N changes pending" save bar.
//
// The CGI endpoint queries the modem via qcmd (several AT commands), so the
// initial fetch may take a few seconds.
//
// WHY THE EDIT BUFFER LIVES HERE, NOT IN THE CARD
// -----------------------------------------------
// Pending edits are long-lived now: a user can stage several changes before
// pressing Save. Two paths used to destroy them silently, both by producing a
// fresh `settings` object that the card's sync then copied over local state:
//
//   1. every save ends with a refetch, so any row edited *after* pressing Save
//      was reverted;
//   2. the error banner's Retry calls `refresh`, so a user with 3 staged
//      changes lost all 3 by retrying a failed read.
//
// The fix is a merge rule rather than a timing fix: the server snapshot and the
// pending patch are separate state, and `draft` is the overlay of one on the
// other. A refresh replaces the snapshot only, so untouched fields track the
// modem freely while every dirty field keeps the user's value. Nothing the
// server says can clobber an edit the user has not saved or discarded.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/cellular/settings.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/settings.sh";

/**
 * Client-side settle time after a disruptive write, measured on-device.
 *
 * SIM slot: the backend itself takes ~4s (CFUN=0, sleep 2, QUIMSLOT, sleep 2,
 * CFUN=1) plus up to 10 verification read-backs; the modem then needs ~8s more
 * to re-register. CFUN / mode_pref execute instantly but network recovery takes
 * ~3-5s. These durations are inherited unchanged from the previous
 * implementation — do not retune them without a device measurement.
 */
const RECOVERY_MS = {
  simSlot: 8000,
  radio: 3000,
  none: 0,
} as const;

/**
 * Coarse stage of an apply, for a step ledger. A slot change runs ~35s
 * end-to-end, which is far too long to render as one undifferentiated spinner.
 */
export type ApplyPhase = "idle" | "writing" | "recovering" | "verifying";

export interface UseCellularSettingsReturn {
  // --- Server truth ---
  /** Last snapshot read from the modem (null before first fetch) */
  settings: CellularSettings | null;
  /** AMBR data (null before first fetch) */
  ambr: AmbrData | null;
  /**
   * Both physical SIM slots, or `null` when the modem did not report them.
   *
   * `null` here is NOT a failed read — it is the legitimate answer on firmware
   * that cannot answer the question at all, which is why its absence is
   * deliberately excluded from the payload guard in `fetchSettings`. Consumers
   * must degrade by rendering nothing, never by claiming an empty pair of slots.
   */
  dualSlot: DualSlotEntry[] | null;

  // --- Edit buffer ---
  /**
   * Merged view the UI renders and validates against: the pending value for
   * every dirty field, the server value for every other field. Null only while
   * the first fetch has not yet produced a snapshot.
   */
  draft: CellularSettings | null;
  /** Stage a change. Setting a field back to its server value un-dirties it. */
  setField: <K extends WritableSettingKey>(
    key: K,
    value: CellularSettings[K],
  ) => void;
  /** Fields whose staged value differs from the server value */
  dirtyFields: ReadonlySet<WritableSettingKey>;
  /** The staged edits themselves — pair with `settings` to render before → after */
  pending: Readonly<CellularSettingsPatch>;
  /** True when at least one field is dirty */
  isDirty: boolean;
  /** Number of dirty fields — the N in "N changes pending" */
  changeCount: number;
  /** Drop every staged edit and fall back to the server snapshot */
  discard: () => void;

  // --- Status ---
  /** True while the initial (non-silent) fetch is in progress */
  isLoading: boolean;
  /** True from the moment a save starts until the post-save refetch settles */
  isSaving: boolean;
  /** Stage of the in-flight apply */
  applyPhase: ApplyPhase;
  /** Settle time chosen for the in-flight apply, ms (0 when not recovering) */
  applyRecoveryMs: number;
  /** Fetch or save error message */
  error: string | null;
  /** Outcome of the most recent apply, including per-field partial results */
  lastApply: CellularSettingsApplyResult | null;

  // --- Actions ---
  /** Apply the staged edits. Applied fields are cleared; failed fields stay dirty. */
  saveSettings: () => Promise<CellularSettingsApplyResult>;
  /**
   * Re-fetch from the modem. Never disturbs a dirty field, and always shows
   * the loading state — it is safe to hand straight to an `onClick`.
   */
  refresh: () => void;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Drop staged edits that the server snapshot has caught up with, so a value the
 * modem now reports stops counting as a pending change. Returns the same
 * reference when nothing changed, keeping the render-phase sync idempotent.
 */
function prunePending(
  pending: CellularSettingsPatch,
  server: CellularSettings,
): CellularSettingsPatch {
  let changed = false;
  const next: CellularSettingsPatch = {};

  for (const key of WRITABLE_SETTING_KEYS) {
    const staged = pending[key];
    if (staged === undefined) continue;
    if (staged === server[key]) {
      changed = true;
      continue;
    }
    // Assigning through a per-key union needs the widened write below; the
    // read above already proves `staged` is this key's value type.
    (next as Record<string, unknown>)[key] = staged;
  }

  return changed ? next : pending;
}

/** Narrow the backend's `string[]` field lists to real writable keys. */
function narrowFields(fields: string[] | undefined): WritableSettingKey[] {
  return (fields ?? []).filter(isWritableSettingKey);
}

// -----------------------------------------------------------------------------

export function useCellularSettings(): UseCellularSettingsReturn {
  const [settings, setSettings] = useState<CellularSettings | null>(null);
  const [ambr, setAmbr] = useState<AmbrData | null>(null);
  const [dualSlot, setDualSlot] = useState<DualSlotEntry[] | null>(null);
  const [pending, setPending] = useState<CellularSettingsPatch>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [applyPhase, setApplyPhase] = useState<ApplyPhase>("idle");
  const [applyRecoveryMs, setApplyRecoveryMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastApply, setLastApply] =
    useState<CellularSettingsApplyResult | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Reconcile pending edits against a new server snapshot — during render, not
  // in an effect (no setState-in-effect; React-Compiler safe). Mirrors the
  // pattern in components/system-settings/system-settings-card.tsx.
  //
  // This only *prunes* edits the modem has caught up with. It never writes a
  // server value into the pending patch, which is what makes a refresh
  // incapable of destroying an unsaved change.
  // ---------------------------------------------------------------------------
  const [prevSettings, setPrevSettings] = useState(settings);
  if (settings !== prevSettings) {
    setPrevSettings(settings);
    if (settings) {
      setPending((current) => prunePending(current, settings));
    }
  }

  // ---------------------------------------------------------------------------
  // Derived edit-buffer state
  // ---------------------------------------------------------------------------
  const dirtyFields = useMemo<ReadonlySet<WritableSettingKey>>(() => {
    const set = new Set<WritableSettingKey>();
    for (const key of WRITABLE_SETTING_KEYS) {
      if (pending[key] !== undefined) set.add(key);
    }
    return set;
  }, [pending]);

  const draft = useMemo<CellularSettings | null>(() => {
    if (!settings) return null;
    return { ...settings, ...pending };
  }, [settings, pending]);

  const changeCount = dirtyFields.size;
  const isDirty = changeCount > 0;

  const setField = useCallback(
    <K extends WritableSettingKey>(key: K, value: CellularSettings[K]) => {
      setPending((current) => {
        const next: CellularSettingsPatch = { ...current };
        // Re-selecting the modem's current value is not a change, so it must
        // not inflate the "N changes pending" count.
        if (settings && settings[key] === value) {
          if (next[key] === undefined) return current;
          delete next[key];
        } else {
          if (next[key] === value) return current;
          next[key] = value;
        }
        return next;
      });
    },
    [settings],
  );

  const discard = useCallback(() => {
    setPending({});
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch settings + AMBR
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: CellularSettingsResponse = await resp.json();
      if (!mountedRef.current) return;

      if (!data.success) {
        setError(data.error || "Failed to fetch cellular settings");
        return;
      }

      // A successful envelope with no payload is a contract violation, and it
      // is treated as a failed read rather than partially applied: the CGI
      // omits `settings`/`ambr` exactly when the compound AT read produced
      // nothing, and writing `undefined` into the snapshot here would revive
      // the fabricated-defaults problem one layer up.
      if (!data.settings || !data.ambr) {
        setError(data.error || "Failed to fetch cellular settings");
        return;
      }

      setSettings(data.settings);
      setAmbr(data.ambr);
      // NOT part of the guard above, deliberately. `dual_slot` is omitted on any
      // firmware that cannot answer `AT+QSIMCFG="dual_slot_status"`, and an
      // OTA-upgraded device in that position must still get a working settings
      // page — just one readout fewer. Written on every read (never merged), so
      // a modem that stops reporting it stops being reported on.
      setDualSlot(data.dual_slot ?? null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch cellular settings",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  /**
   * The user-initiated re-read. It exists so `fetchSettings` is never handed
   * straight to an `onClick`.
   *
   * THE MOUSEEVENT TRAP. `fetchSettings` is `(silent = false) => Promise<void>`
   * and was exported directly as `refresh`, typed `() => void`. Both call sites
   * pass it as a bare handler (`onClick={form.refresh}`), so React handed it the
   * click event — a truthy object landing in `silent`. Every Retry and every
   * "Re-read from modem" press therefore ran in SILENT mode and showed no
   * loading state at all, which is the opposite of what a button the user just
   * pressed should do. The wrapper takes no arguments, so a handler cannot leak
   * one in again.
   *
   * `fetchSettings` keeps its own signature: the post-save verification read at
   * the end of `saveSettings` genuinely wants the silent form.
   */
  const refresh = useCallback(() => {
    void fetchSettings(false);
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Save staged edits
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(async (): Promise<CellularSettingsApplyResult> => {
    const changes = pending;
    const attempted = Object.keys(changes).filter(
      isWritableSettingKey,
    ) as WritableSettingKey[];

    if (attempted.length === 0) {
      const noop: CellularSettingsApplyResult = {
        success: true,
        appliedFields: [],
        failedFields: [],
        error: null,
      };
      setLastApply(noop);
      return noop;
    }

    // Settle time is keyed on what we ATTEMPTED, not on what came back applied,
    // and is therefore fixed before the outcome is known.
    //
    // A rejected slot change disturbs the radio MORE than a successful one, not
    // less: settings.sh runs CFUN=0 -> QUIMSLOT -> CFUN=1 plus 10 read-back
    // attempts, and on verification failure runs that entire cycle a SECOND time
    // before reporting the error (settings.sh:400-413). Keying the wait on
    // `applied` meant the worst case — two full radio cycles — got a 0ms window,
    // so the verification refetch read the modem mid-re-registration and fed an
    // incoherent snapshot into `settings` on top of a failed save.
    //
    // The failure is asymmetric: an unnecessary 8s wait costs the user nothing,
    // while skipping a needed one corrupts the displayed state. When in doubt,
    // wait. (The one genuinely undisturbed case — the first AT+CFUN=0 itself
    // erroring — is not worth distinguishing.)
    const recoveryMs = attempted.includes("sim_slot")
      ? RECOVERY_MS.simSlot
      : attempted.includes("cfun") || attempted.includes("mode_pref")
        ? RECOVERY_MS.radio
        : RECOVERY_MS.none;

    setError(null);
    setLastApply(null);
    setIsSaving(true);
    setApplyPhase("writing");
    setApplyRecoveryMs(0);

    const fail = (message: string): CellularSettingsApplyResult => ({
      success: false,
      appliedFields: [],
      failedFields: attempted,
      error: message,
    });

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data: CellularSettingsApplyResponse = await resp.json();
      if (!mountedRef.current) return fail("unmounted");

      // The backend reports applied/failed lists on partial failure. When it
      // reports neither, assume all-or-nothing on `success`.
      const applied = data.applied_fields
        ? narrowFields(data.applied_fields)
        : data.success
          ? attempted
          : [];
      const failed = data.failed_fields
        ? narrowFields(data.failed_fields)
        : attempted.filter((key) => !applied.includes(key));

      const result: CellularSettingsApplyResult = {
        success: Boolean(data.success) && failed.length === 0,
        appliedFields: applied,
        failedFields: failed,
        error: applyErrorText(data, failed),
      };

      // Clear only what actually landed — anything the modem rejected stays
      // dirty so the save bar can offer a retry over just those fields.
      if (applied.length > 0) {
        setPending((current) => {
          const next: CellularSettingsPatch = { ...current };
          for (const key of applied) delete next[key];
          return next;
        });
      }

      if (result.error) setError(result.error);
      setLastApply(result);

      // No early return on total failure: a failed slot write is exactly the
      // case that left the radio cycling, so it needs the settle window and the
      // read-back MORE than a success does — the user has to be shown which
      // slot the modem actually landed on.
      //
      // Let the modem settle before reading back, otherwise the verification
      // fetch races the radio cycle and reports a pre-write or half-initialised
      // state.
      if (recoveryMs > 0) {
        setApplyPhase("recovering");
        setApplyRecoveryMs(recoveryMs);
        await new Promise((resolve) => setTimeout(resolve, recoveryMs));
        if (!mountedRef.current) return result;
      }

      // Re-fetch actual modem state (silent — no skeleton). The render-phase
      // reconcile above prunes only the edits this snapshot confirms; anything
      // the user staged while the save was in flight survives untouched.
      setApplyPhase("verifying");
      setApplyRecoveryMs(0);
      await fetchSettings(true);

      // `fetchSettings` clears `error` on entry, so a partial-failure message
      // has to be re-asserted afterwards or the save bar goes quiet about the
      // fields that did not land.
      if (mountedRef.current && result.error) setError(result.error);
      return result;
    } catch (err) {
      if (!mountedRef.current) return fail("unmounted");
      const message =
        err instanceof Error ? err.message : "Failed to apply settings";
      setError(message);
      const result = fail(message);
      setLastApply(result);
      return result;
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
        setApplyPhase("idle");
        setApplyRecoveryMs(0);
      }
    }
  }, [fetchSettings, pending]);

  return {
    settings,
    ambr,
    dualSlot,
    draft,
    setField,
    dirtyFields,
    pending,
    isDirty,
    changeCount,
    discard,
    isLoading,
    isSaving,
    applyPhase,
    applyRecoveryMs,
    error,
    lastApply,
    saveSettings,
    refresh,
  };
}

/** Error text for an apply outcome, or null when everything landed. */
function applyErrorText(
  data: CellularSettingsApplyResponse,
  failed: WritableSettingKey[],
): string | null {
  if (data.success && failed.length === 0) return null;
  if (failed.length > 0) {
    return data.error || `Failed to apply: ${failed.join(", ")}`;
  }
  return data.error || "Failed to apply settings";
}
