"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  RefreshCwIcon,
  SignalIcon,
  ZapIcon,
  LayersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth-fetch";

// =============================================================================
// StepNetworkMode — Onboarding step 3: preferred network type (optional)
// =============================================================================

const SETTINGS_ENDPOINT = "/cgi-bin/quecmanager/cellular/settings.sh";

const NETWORK_OPTIONS = [
  {
    id: "AUTO",
    label: "Automatic",
    description: "Connect to the best available network",
    Icon: RefreshCwIcon,
    show5gArch: false,
  },
  {
    id: "LTE",
    label: "LTE Only",
    description: "4G LTE — stable and widely available",
    Icon: SignalIcon,
    show5gArch: false,
  },
  {
    id: "NR5G",
    label: "5G Only",
    description: "5G standalone — fastest where available",
    Icon: ZapIcon,
    show5gArch: true,
  },
  {
    id: "LTE:NR5G",
    label: "LTE + 5G",
    description: "Dual mode with automatic fallback",
    Icon: LayersIcon,
    show5gArch: true,
  },
];

const NR5G_ARCH_OPTIONS = [
  { id: 0, label: "Auto (SA + NSA)", description: "Use both standalone and non-standalone" },
  { id: 1, label: "NSA Only", description: "5G via LTE anchor — broader coverage" },
  { id: 2, label: "SA Only", description: "Standalone 5G — lowest latency" },
];

interface StepNetworkModeProps {
  onDataChange: (data: { mode_pref: string; nr5g_mode: number } | null) => void;
  onSubmitRef: (fn: () => Promise<void>) => void;
  onLoadingChange: (loading: boolean) => void;
  onSuccess: () => void;
}

export function StepNetworkMode({
  onDataChange,
  onSubmitRef,
  onLoadingChange,
  onSuccess,
}: StepNetworkModeProps) {
  const [selectedMode, setSelectedMode] = useState("AUTO");
  const [nr5gMode, setNr5gMode] = useState(0);

  const selectedOption = NETWORK_OPTIONS.find((o) => o.id === selectedMode)!;

  const handleModeSelect = (id: string) => {
    setSelectedMode(id);
    const show5g = NETWORK_OPTIONS.find((o) => o.id === id)?.show5gArch ?? false;
    const arch = show5g ? nr5gMode : 0;
    if (!show5g) setNr5gMode(0);
    if (id !== "AUTO" || arch !== 0) {
      onDataChange({ mode_pref: id, nr5g_mode: arch });
    } else {
      onDataChange(null);
    }
  };

  const handleArchSelect = (archId: number) => {
    setNr5gMode(archId);
    if (selectedMode !== "AUTO" || archId !== 0) {
      onDataChange({ mode_pref: selectedMode, nr5g_mode: archId });
    } else {
      onDataChange(null);
    }
  };

  const submit = useCallback(async () => {
    if (selectedMode === "AUTO" && nr5gMode === 0) {
      onSuccess();
      return;
    }

    onLoadingChange(true);
    try {
      await authFetch(SETTINGS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode_pref: selectedMode, nr5g_mode: nr5gMode }),
      });
    } catch {
      // Non-fatal
    } finally {
      onLoadingChange(false);
      onSuccess();
    }
  }, [selectedMode, nr5gMode, onLoadingChange, onSuccess]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Preferred network</h2>
        <p className="text-sm text-muted-foreground">
          How should your modem connect? You can change this anytime in Settings.
        </p>
      </div>

      {/* Network type — role="radiogroup" for screen readers */}
      <div
        role="radiogroup"
        aria-label="Network type"
        className="flex flex-col gap-2"
      >
        {NETWORK_OPTIONS.map((option) => {
          const isSelected = selectedMode === option.id;
          return (
            <motion.button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => handleModeSelect(option.id)}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 600, damping: 30 }}
              className={cn(
                "flex items-center gap-4 rounded-lg border px-4 py-3.5 text-left",
                "transition-colors duration-150",
                "hover:border-primary/50 hover:bg-primary/5",
                isSelected
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border bg-card"
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
                  isSelected
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <option.Icon className="size-4" />
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium leading-snug">{option.label}</span>
                <span className="text-xs text-muted-foreground leading-snug">
                  {option.description}
                </span>
              </div>
              <span
                aria-hidden="true"
                className={cn(
                  "ml-auto block size-4 shrink-0 rounded-full border-2 transition-colors duration-150",
                  isSelected
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40"
                )}
              />
            </motion.button>
          );
        })}
      </div>

      {/* 5G Architecture — only shown for 5G modes */}
      {selectedOption.show5gArch && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            5G Architecture
          </p>
          <div
            role="radiogroup"
            aria-label="5G architecture"
            className="flex flex-col gap-1.5"
          >
            {NR5G_ARCH_OPTIONS.map((arch) => {
              const isSelected = nr5gMode === arch.id;
              return (
                <motion.button
                  key={arch.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => handleArchSelect(arch.id)}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 600, damping: 30 }}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left",
                    "transition-colors duration-150",
                    "hover:border-primary/50 hover:bg-primary/5",
                    isSelected ? "border-primary bg-primary/5" : "border-border"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block size-3.5 shrink-0 rounded-full border-2 transition-colors duration-150",
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    )}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium leading-snug">{arch.label}</span>
                    <span className="text-xs text-muted-foreground">{arch.description}</span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
