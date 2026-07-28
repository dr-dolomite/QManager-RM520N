"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { motion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangleIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { MetaPanel, MetaPair } from "@/components/ui/meta-panel";

import { useQualityThresholds } from "@/hooks/use-quality-thresholds";
import { useModemStatus } from "@/hooks/use-modem-status";
import {
  QUALITY_PRESETS,
  type QualityPreset,
  type QualityThresholdsSettings,
} from "@/types/modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";

// ─── Preset metadata ────────────────────────────────────────────────────────

interface PresetMeta {
  label: string;
  blurb: string;
  threshold: number;
  debounce: number;
}

const LATENCY_META: Record<QualityPreset, PresetMeta> = {
  standard: {
    label: "Standard",
    blurb: "Good cellular. Flags any sustained latency over 150 ms.",
    threshold: 150,
    debounce: 3,
  },
  tolerant: {
    label: "Tolerant",
    blurb: "Average cellular. Allows occasional spikes before flagging.",
    threshold: 250,
    debounce: 3,
  },
  "very-tolerant": {
    label: "Very Tolerant",
    blurb: "Poor signal areas. Only flags when latency stays high for a while.",
    threshold: 500,
    debounce: 2,
  },
};

const LOSS_META: Record<QualityPreset, PresetMeta> = {
  standard: {
    label: "Standard",
    blurb: "Tight quality bar. Flags loss above 15 %.",
    threshold: 15,
    debounce: 3,
  },
  tolerant: {
    label: "Tolerant",
    blurb: "Acceptable on cellular under load. Won't fire from short bursts.",
    threshold: 30,
    debounce: 3,
  },
  "very-tolerant": {
    label: "Very Tolerant",
    blurb: "Severe drops only — useful in poor signal areas.",
    threshold: 50,
    debounce: 2,
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${Math.round(ms)} ms`;
}

function formatLoss(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—";
  return `${pct} %`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function QualityThresholdsCard() {
  const { thresholds, isDefault, isLoading, error, isSaving, saveError, save } =
    useQualityThresholds();
  const { data: modemStatus } = useModemStatus();
  const { saved, markSaved } = useSaveFlash();

  // SSR-safe stable ids for tablist <-> visible-label association (WCAG 1.3.1).
  const latencyLabelId = useId();
  const lossLabelId = useId();

  const [selected, setSelected] = useState<QualityThresholdsSettings | undefined>(
    thresholds,
  );

  useEffect(() => {
    if (thresholds && !selected) setSelected(thresholds);
  }, [thresholds, selected]);

  const isDirty = useMemo(() => {
    if (!thresholds || !selected) return false;
    return (
      selected.latency.preset !== thresholds.latency.preset ||
      selected.loss.preset !== thresholds.loss.preset
    );
  }, [thresholds, selected]);

  const canSave = isDirty && !isSaving;

  const handleSave = async () => {
    if (!canSave || !selected) return;
    try {
      await save(selected);
      markSaved();
      toast.success("Quality thresholds updated");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
          <CardDescription>
            When QManager flags slow latency or packet loss as a network event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-20 w-full rounded-md" />
            <div className="flex justify-end">
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error variant ──────────────────────────────────────────────────────
  if (error && !thresholds) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
          <CardDescription>
            When QManager flags slow latency or packet loss as a network event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!selected) return null;

  const latPreset = selected.latency.preset;
  const lossPreset = selected.loss.preset;
  const latMeta = LATENCY_META[latPreset];
  const lossMeta = LOSS_META[lossPreset];

  const liveLatency = modemStatus?.connectivity?.latency_ms ?? null;
  const liveLoss = modemStatus?.connectivity?.packet_loss_pct ?? null;

  const latencyOk =
    liveLatency === null || liveLatency <= latMeta.threshold;
  const lossOk = liveLoss === null || liveLoss < lossMeta.threshold;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Latency &amp; Loss Thresholds</CardTitle>
        <CardDescription>
          When QManager flags slow latency or packet loss as a network event.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {saveError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="size-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <motion.div
          className="grid gap-5"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* ── Latency row ─────────────────────────────────────────── */}
          <motion.div variants={staggerItem} className="grid gap-3">
            <span id={latencyLabelId} className="text-sm font-medium">Latency</span>

            <Tabs
              value={latPreset}
              onValueChange={(v) => {
                if (v && (QUALITY_PRESETS as readonly string[]).includes(v)) {
                  setSelected({
                    ...selected,
                    latency: { preset: v as QualityPreset },
                  });
                }
              }}
            >
              <TabsList
                className="grid w-full grid-cols-3"
                aria-labelledby={latencyLabelId}
              >
                {QUALITY_PRESETS.map((p) => (
                  <TabsTrigger
                    key={p}
                    value={p}
                    aria-label={`${LATENCY_META[p].label} (${LATENCY_META[p].threshold} ms)`}
                  >
                    {LATENCY_META[p].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <MetaPanel title={latMeta.label} blurb={latMeta.blurb}>
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                <MetaPair label="Threshold" value={`${latMeta.threshold} ms`} />
                <MetaPair label="Debounce" value={`${latMeta.debounce} samples`} />
                <MetaPair
                  label="Current"
                  value={formatLatency(liveLatency)}
                  glyph={
                    liveLatency === null
                      ? null
                      : latencyOk
                        ? "ok"
                        : "warn"
                  }
                />
              </div>
            </MetaPanel>
          </motion.div>

          <Separator />

          {/* ── Packet loss row ─────────────────────────────────────── */}
          <motion.div variants={staggerItem} className="grid gap-3">
            <span id={lossLabelId} className="text-sm font-medium">Packet loss</span>

            <Tabs
              value={lossPreset}
              onValueChange={(v) => {
                if (v && (QUALITY_PRESETS as readonly string[]).includes(v)) {
                  setSelected({
                    ...selected,
                    loss: { preset: v as QualityPreset },
                  });
                }
              }}
            >
              <TabsList
                className="grid w-full grid-cols-3"
                aria-labelledby={lossLabelId}
              >
                {QUALITY_PRESETS.map((p) => (
                  <TabsTrigger
                    key={p}
                    value={p}
                    aria-label={`${LOSS_META[p].label} (${LOSS_META[p].threshold} percent)`}
                  >
                    {LOSS_META[p].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <MetaPanel title={lossMeta.label} blurb={lossMeta.blurb}>
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                <MetaPair label="Threshold" value={`${lossMeta.threshold} %`} />
                <MetaPair label="Debounce" value={`${lossMeta.debounce} samples`} />
                <MetaPair
                  label="Current"
                  value={formatLoss(liveLoss)}
                  glyph={liveLoss === null ? null : lossOk ? "ok" : "warn"}
                />
              </div>
            </MetaPanel>
          </motion.div>

          {isDefault && (
            <motion.p
              variants={staggerItem}
              className="text-xs text-muted-foreground"
            >
              Using default thresholds — pick Standard to flag smaller spikes.
            </motion.p>
          )}

          {/* ── Save button ──────────────────────────────────────────── */}
          <motion.div variants={staggerItem} className="flex justify-end">
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={saved}
              disabled={!canSave}
            />
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  );
}

