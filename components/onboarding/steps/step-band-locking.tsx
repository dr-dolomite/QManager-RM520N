"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// =============================================================================
// StepBandLocking — Onboarding step 5: band presets (optional)
// =============================================================================

const BAND_LOCK_ENDPOINT = "/cgi-bin/quecmanager/bands/lock.sh";

// Preset band strings (colon-delimited, sorted numerically)
const LTE_PRESETS: Record<string, string> = {
  low: "5:8:12:13:17:20:26:28:71",
  mid: "1:2:3:4:7:25:66",
};

const NR5G_PRESETS: Record<string, string> = {
  low: "5:8:28:71",
  mid: "41:77:78:79",
};

// All known LTE bands for custom selector
const ALL_LTE_BANDS = [
  1, 2, 3, 4, 5, 7, 8, 12, 13, 14, 17, 18, 19, 20, 21, 25, 26, 28, 29, 30, 31,
  32, 39, 40, 41, 42, 43, 44, 45, 46, 48, 49, 50, 51, 52, 53, 54, 55, 56, 61,
  71, 72, 73, 74, 75, 76,
];

// All known NR5G bands for custom selector
const ALL_NR5G_BANDS = [
  1, 2, 3, 5, 7, 8, 11, 12, 13, 14, 18, 20, 21, 25, 26, 28, 29, 30, 31, 32,
  38, 39, 40, 41, 43, 46, 47, 48, 49, 50, 51, 53, 54, 55, 56, 57, 58, 59, 60,
  61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
];

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
    {
      id: "low",
      label: "Low-band only",
      detail: presets.low
        .split(":")
        .map((b) => `${prefix}${b}`)
        .join(", "),
    },
    {
      id: "mid",
      label: "Mid-band only",
      detail: presets.mid
        .split(":")
        .map((b) => `${prefix}${b}`)
        .join(", "),
    },
    { id: "custom", label: "Custom…" },
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
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
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
  const [ltePreset, setLtePreset] = useState<BandPreset>("all");
  const [nr5gPreset, setNr5gPreset] = useState<BandPreset>("all");
  const [lteCustom, setLteCustom] = useState<Set<number>>(new Set());
  const [nr5gCustom, setNr5gCustom] = useState<Set<number>>(new Set());

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
    const lteBands = getBandString(ltePreset, LTE_PRESETS, lteCustom);
    const nr5gBands = getBandString(nr5gPreset, NR5G_PRESETS, nr5gCustom);

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
  }, [ltePreset, nr5gPreset, lteCustom, nr5gCustom, onLoadingChange, onSuccess]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef]);

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
          allBands={ALL_LTE_BANDS}
          presets={LTE_PRESETS}
          selectedPreset={ltePreset}
          customBands={lteCustom}
          onPresetChange={setLtePreset}
          onCustomBandToggle={(b) => toggleBand(lteCustom, setLteCustom, b)}
        />

        <div className="border-t border-border" />

        <BandPresetSection
          title="5G Bands (NSA + SA)"
          prefix="N"
          allBands={ALL_NR5G_BANDS}
          presets={NR5G_PRESETS}
          selectedPreset={nr5gPreset}
          customBands={nr5gCustom}
          onPresetChange={setNr5gPreset}
          onCustomBandToggle={(b) => toggleBand(nr5gCustom, setNr5gCustom, b)}
        />
      </div>
    </div>
  );
}
