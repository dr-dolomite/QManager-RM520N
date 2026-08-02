"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { useModemStatus } from "@/hooks/use-modem-status";
import { parseBandString } from "@/types/band-locking";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2Icon } from "lucide-react";

// =============================================================================
// StepBandLocking — Onboarding step 5: band presets (optional)
// =============================================================================

const BAND_LOCK_ENDPOINT = "/cgi-bin/quecmanager/bands/lock.sh";

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

    if (!lteBands && !nr5gBands) {
      // No selection — skip
      onSuccess();
      return;
    }

    onLoadingChange(true);
    try {
      const requests: Promise<unknown>[] = [];
      if (lteBands) {
        requests.push(
          authFetch(BAND_LOCK_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ band_type: "lte", bands: lteBands }),
          })
        );
      }
      if (nr5gBands) {
        // Lock both NSA and SA with same selection
        requests.push(
          authFetch(BAND_LOCK_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ band_type: "nsa_nr5g", bands: nr5gBands }),
          })
        );
        requests.push(
          authFetch(BAND_LOCK_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ band_type: "sa_nr5g", bands: nr5gBands }),
          })
        );
      }
      await Promise.allSettled(requests);
    } catch {
      // Non-fatal
    } finally {
      onLoadingChange(false);
      onSuccess();
    }
  }, [ltePreset, nr5gPreset, lteCustom, nr5gCustom, ltePresets, nr5gPresets, onLoadingChange, onSuccess]);

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

      <div className="flex flex-col gap-5">
        <BandPresetSection
          title="LTE Bands"
          prefix="B"
          allBands={supportedLte}
          presets={ltePresets}
          selectedPreset={ltePreset}
          customBands={lteCustom}
          onPresetChange={setLtePreset}
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
          onPresetChange={setNr5gPreset}
          onCustomBandToggle={(b) => toggleBand(nr5gCustom, setNr5gCustom, b)}
        />
      </div>
    </div>
  );
}
