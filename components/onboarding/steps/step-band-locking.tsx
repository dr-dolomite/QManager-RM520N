"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useModemStatus } from "@/hooks/use-modem-status";
import { parseBandString } from "@/types/band-locking";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { transitionStandard } from "@/lib/motion";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";

// =============================================================================
// StepBandLocking — Onboarding step 5: band presets (optional)
// =============================================================================

const BAND_LOCK_ENDPOINT = "/cgi-bin/quecmanager/bands/lock.sh";

// -----------------------------------------------------------------------------
// Band lock request/response plumbing
// -----------------------------------------------------------------------------
// `lock.sh` locks ONE category per request, so a 5G selection costs two writes
// (NSA + SA) on top of the LTE one. Every failure path in `cgi_base.sh` emits
// `{"success":false,"error":…,"detail":…}` with NO `Status:` header, so lighttpd
// answers 200 — `resp.ok` structurally cannot see a modem_error. The `.success`
// field is the only honest signal, and `detail` is the message every other
// consumer in the repo reads.

type BandCategory = "lte" | "nsa_nr5g" | "sa_nr5g";

/** Display order for both the request queue and the failure list. */
const CATEGORY_ORDER: BandCategory[] = ["lte", "nsa_nr5g", "sa_nr5g"];

const CATEGORY_LABELS: Record<BandCategory, string> = {
  lte: "LTE bands",
  nsa_nr5g: "5G NSA bands",
  sa_nr5g: "5G SA bands",
};

interface BandLockRequest {
  category: BandCategory;
  bands: string;
}

interface BandLockResponse {
  success?: boolean;
  error?: string;
  detail?: string;
}

interface BandLockFailure {
  category: BandCategory;
  message: string;
}

/** Cumulative result of one or more submit attempts. */
interface SubmitOutcome {
  applied: BandCategory[];
  failed: BandLockFailure[];
}

/**
 * Apply one category's band lock. Resolves to `null` on success, or to a
 * human-readable failure message. Never throws.
 */
async function applyBandLock(request: BandLockRequest): Promise<string | null> {
  let response: Response;
  try {
    response = await authFetch(BAND_LOCK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        band_type: request.category,
        bands: request.bands,
      }),
    });
  } catch {
    return "Could not reach the modem.";
  }

  let data: BandLockResponse | null = null;
  try {
    data = (await response.json()) as BandLockResponse;
  } catch {
    data = null;
  }

  const detail = data?.detail || data?.error || "";

  if (!response.ok) {
    return detail || `The modem returned HTTP ${response.status}.`;
  }
  if (data?.success !== true) {
    return detail || "The modem did not confirm the change.";
  }
  return null;
}

// Preset band candidates — filtered at render time against modem-supported bands
const LTE_PRESET_CANDIDATES: Record<string, number[]> = {
  low: [5, 8, 12, 13, 17, 20, 26, 28, 71],
  mid: [1, 2, 3, 4, 7, 25, 66],
};

const NR5G_PRESET_CANDIDATES: Record<string, number[]> = {
  low: [5, 8, 28, 71],
  mid: [41, 77, 78, 79],
};

/** Filter preset candidates to only include modem-supported bands */
function buildPresets(
  candidates: Record<string, number[]>,
  supported: Set<number>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, bands] of Object.entries(candidates)) {
    const filtered = bands.filter((b) => supported.has(b));
    if (filtered.length > 0) {
      result[key] = filtered.sort((a, b) => a - b).join(":");
    }
  }
  return result;
}

type BandPreset = "all" | "low" | "mid" | "custom";

interface BandPresetSectionProps {
  title: string;
  prefix: string;
  allBands: number[];
  presets: Record<string, string>;
  selectedPreset: BandPreset;
  customBands: Set<number>;
  onPresetChange: (preset: BandPreset) => void;
  onCustomBandToggle: (band: number) => void;
}

function BandPresetSection({
  title,
  prefix,
  allBands,
  presets,
  selectedPreset,
  customBands,
  onPresetChange,
  onCustomBandToggle,
}: BandPresetSectionProps) {
  const options: { id: BandPreset; label: string; detail?: string }[] = [
    { id: "all", label: "All bands (default)" },
    // Only show low/mid presets if the modem supports any of those bands
    ...(presets.low
      ? [{
          id: "low" as BandPreset,
          label: "Low-band only",
          detail: presets.low
            .split(":")
            .map((b) => `${prefix}${b}`)
            .join(", "),
        }]
      : []),
    ...(presets.mid
      ? [{
          id: "mid" as BandPreset,
          label: "Mid-band only",
          detail: presets.mid
            .split(":")
            .map((b) => `${prefix}${b}`)
            .join(", "),
        }]
      : []),
    { id: "custom", label: "Custom\u2026" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{title}</p>
      <div role="radiogroup" aria-label={title} className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <motion.button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selectedPreset === opt.id}
            onClick={() => onPresetChange(opt.id)}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-[var(--duration-quick)] ease-out",
              "hover:border-primary/50 hover:bg-primary/5",
              selectedPreset === opt.id
                ? "border-primary bg-primary/5"
                : "border-border"
            )}
          >
            <span
              className={cn(
                "mt-0.5 block size-3.5 shrink-0 rounded-full border-2 transition-colors",
                selectedPreset === opt.id
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/40"
              )}
            />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium">{opt.label}</span>
              {opt.detail && (
                <span className="text-xs text-muted-foreground truncate">
                  {opt.detail}
                </span>
              )}
            </div>
          </motion.button>
        ))}
      </div>

      {/* Custom band grid */}
      {selectedPreset === "custom" && (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="grid grid-cols-6 gap-1.5 max-h-36 overflow-y-auto pr-1">
            {allBands.map((band) => {
              const id = `band-${prefix}-${band}`;
              return (
                <div key={band} className="flex items-center gap-1">
                  <Checkbox
                    id={id}
                    checked={customBands.has(band)}
                    onCheckedChange={() => onCustomBandToggle(band)}
                  />
                  <Label
                    htmlFor={id}
                    className="text-xs cursor-pointer select-none whitespace-nowrap"
                  >
                    {prefix}{band}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface StepBandLockingProps {
  onSubmitRef: (fn: () => Promise<void>) => void;
  onLoadingChange: (loading: boolean) => void;
  onSuccess: () => void;
}

export function StepBandLocking({
  onSubmitRef,
  onLoadingChange,
  onSuccess,
}: StepBandLockingProps) {
  const { data, isLoading } = useModemStatus();

  const [ltePreset, setLtePreset] = useState<BandPreset>("all");
  const [nr5gPreset, setNr5gPreset] = useState<BandPreset>("all");
  const [lteCustom, setLteCustom] = useState<Set<number>>(new Set());
  const [nr5gCustom, setNr5gCustom] = useState<Set<number>>(new Set());

  // Null until an attempt leaves at least one category unapplied. Editing the
  // selection clears it, so a retry never re-sends a stale band string.
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  // Derive supported bands from poller boot data
  const supportedLte = useMemo(
    () => parseBandString(data?.device.supported_lte_bands),
    [data?.device.supported_lte_bands],
  );
  const supportedNr5g = useMemo(() => {
    // Combine NSA + SA for the unified 5G selector
    const nsa = parseBandString(data?.device.supported_nsa_nr5g_bands);
    const sa = parseBandString(data?.device.supported_sa_nr5g_bands);
    return [...new Set([...nsa, ...sa])].sort((a, b) => a - b);
  }, [data?.device.supported_nsa_nr5g_bands, data?.device.supported_sa_nr5g_bands]);

  // Build presets filtered to modem-supported bands
  const ltePresets = useMemo(
    () => buildPresets(LTE_PRESET_CANDIDATES, new Set(supportedLte)),
    [supportedLte],
  );
  const nr5gPresets = useMemo(
    () => buildPresets(NR5G_PRESET_CANDIDATES, new Set(supportedNr5g)),
    [supportedNr5g],
  );

  const toggleBand = (
    set: Set<number>,
    setter: (s: Set<number>) => void,
    band: number
  ) => {
    const next = new Set(set);
    if (next.has(band)) next.delete(band);
    else next.add(band);
    setter(next);
    setOutcome(null);
  };

  const changePreset = (
    setter: (p: BandPreset) => void,
    preset: BandPreset
  ) => {
    setter(preset);
    setOutcome(null);
  };

  const getBandString = (
    preset: BandPreset,
    presets: Record<string, string>,
    custom: Set<number>
  ): string | null => {
    if (preset === "all") return null;
    if (preset === "custom") {
      if (custom.size === 0) return null;
      return [...custom].sort((a, b) => a - b).join(":");
    }
    return presets[preset] ?? null;
  };

  const submit = useCallback(async () => {
    const lteBands = getBandString(ltePreset, ltePresets, lteCustom);
    const nr5gBands = getBandString(nr5gPreset, nr5gPresets, nr5gCustom);

    const selected: BandLockRequest[] = [];
    if (lteBands) selected.push({ category: "lte", bands: lteBands });
    if (nr5gBands) {
      // Lock both NSA and SA with same selection
      selected.push({ category: "nsa_nr5g", bands: nr5gBands });
      selected.push({ category: "sa_nr5g", bands: nr5gBands });
    }

    if (selected.length === 0) {
      // No selection — skip
      onSuccess();
      return;
    }

    // A retry re-sends only what did not apply; a category that already took
    // stays applied and does not pay for another AT round-trip.
    const retrying = outcome
      ? new Set(outcome.failed.map((f) => f.category))
      : null;
    const targets = retrying
      ? selected.filter((t) => retrying.has(t.category))
      : selected;

    if (targets.length === 0) {
      onSuccess();
      return;
    }

    onLoadingChange(true);
    const applied: BandCategory[] = outcome ? [...outcome.applied] : [];
    const failed: BandLockFailure[] = [];
    try {
      // Sequential, not Promise.all: each write is a `qcmd` holding the AT
      // mutex under a 5s flock budget, and firing three at once makes them
      // contend with each other (and with the poller) for it. Serialising also
      // keeps a failure attributable to exactly one category. Cheap here —
      // `lock.sh` issues a single AT command with no COPS bounce or attach
      // cycle, so three round-trips cost far less than one APN write.
      for (const target of targets) {
        const message = await applyBandLock(target);
        if (message === null) applied.push(target.category);
        else failed.push({ category: target.category, message });
      }
    } finally {
      onLoadingChange(false);
    }

    if (failed.length > 0) {
      // Partial or total failure: report it and stay on the step. The shell
      // keeps Skip enabled, so this never traps the user on an optional step.
      setOutcome({ applied, failed });
      return;
    }

    setOutcome(null);
    onSuccess();
  }, [
    ltePreset,
    nr5gPreset,
    lteCustom,
    nr5gCustom,
    ltePresets,
    nr5gPresets,
    outcome,
    onLoadingChange,
    onSuccess,
  ]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading supported bands...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Band preferences</h2>
        <p className="text-sm text-muted-foreground">
          Lock specific frequency bands for better signal on your network.
        </p>
      </div>

      {outcome && <BandLockFailureNotice outcome={outcome} />}

      <div className="flex flex-col gap-5">
        <BandPresetSection
          title="LTE Bands"
          prefix="B"
          allBands={supportedLte}
          presets={ltePresets}
          selectedPreset={ltePreset}
          customBands={lteCustom}
          onPresetChange={(p) => changePreset(setLtePreset, p)}
          onCustomBandToggle={(b) => toggleBand(lteCustom, setLteCustom, b)}
        />

        <div className="border-t border-border" />

        <BandPresetSection
          title="5G Bands (NSA + SA)"
          prefix="N"
          allBands={supportedNr5g}
          presets={nr5gPresets}
          selectedPreset={nr5gPreset}
          customBands={nr5gCustom}
          onPresetChange={(p) => changePreset(setNr5gPreset, p)}
          onCustomBandToggle={(b) => toggleBand(nr5gCustom, setNr5gCustom, b)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BandLockFailureNotice — what did not apply, and what to do about it
// ---------------------------------------------------------------------------
// Shown when an attempt left at least one category unapplied. The step stays
// put so the user can retry with Continue or leave with Skip; it never advances
// on the user's behalf and never claims a lock the modem rejected.

function BandLockFailureNotice({ outcome }: { outcome: SubmitOutcome }) {
  const failed = CATEGORY_ORDER.map((c) =>
    outcome.failed.find((f) => f.category === c)
  ).filter((f): f is BandLockFailure => f !== undefined);

  const applied = CATEGORY_ORDER.filter((c) => outcome.applied.includes(c));
  const isPartial = applied.length > 0;

  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitionStandard}
      className="flex flex-col gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
    >
      <div className="flex items-center gap-2">
        <Badge variant="destructive">
          <AlertCircleIcon className="size-3" />
          {isPartial ? "Partly applied" : "Not applied"}
        </Badge>
        {isPartial && (
          <span className="text-xs text-muted-foreground truncate">
            {applied.map((c) => CATEGORY_LABELS[c]).join(", ")} applied
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {failed.map((f) => (
          <li key={f.category} className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {CATEGORY_LABELS[f.category]}
            </span>
            <span className="text-xs text-muted-foreground">{f.message}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        The modem may be busy. Press Continue to try again, or Skip to finish
        setup without these locks — you can set them later under Cell Locking.
      </p>
    </motion.div>
  );
}
