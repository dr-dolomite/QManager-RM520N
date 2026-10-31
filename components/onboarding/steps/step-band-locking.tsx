"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertCircleIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useModemStatus } from "@/hooks/use-modem-status";
import { parseBandString, type BandCategory } from "@/types/band-locking";
import { OptionRow } from "../option-row";
import { postStep, stepFailureMessage, type StepWriteResult } from "../post-step";
import {
  INNER_TILE,
  SECTION_LABEL,
  STEP_DESCRIPTION,
  STEP_HEADING,
} from "../shapes";

// lock.sh locks one category per request, so writes run serially and each failure stays
// attributable. Applied/failed is state: a retry re-sends only what failed, and any edit clears it.

const BAND_LOCK_ENDPOINT = "/cgi-bin/quecmanager/bands/lock.sh";

/** Display order for both the request queue and the failure list. */
const CATEGORY_ORDER: BandCategory[] = ["lte", "nsa_nr5g", "sa_nr5g"];

const CATEGORY_LABEL_KEY: Record<BandCategory, string> = {
  lte: "band_locking.category_lte",
  nsa_nr5g: "band_locking.category_nsa",
  sa_nr5g: "band_locking.category_sa",
};

interface BandLockRequest {
  category: BandCategory;
  bands: string;
}

interface BandLockFailure {
  category: BandCategory;
  result: StepWriteResult;
}

/** Cumulative result of one or more submit attempts. */
interface SubmitOutcome {
  applied: BandCategory[];
  failed: BandLockFailure[];
}

// Colon-delimited presets, filtered against the bands the modem reports.
const LTE_PRESETS: Record<string, string> = {
  low: "5:8:12:13:17:20:26:28:71",
  mid: "1:2:3:4:7:25:66",
};

const NR5G_PRESETS: Record<string, string> = {
  low: "5:8:28:71",
  mid: "41:77:78:79",
};

type BandPreset = "all" | "low" | "mid" | "custom";

function mergeUniqueBands(...bandGroups: number[][]): number[] {
  return [...new Set(bandGroups.flat())].sort((a, b) => a - b);
}

/** The bands of a preset the modem actually supports. */
function presetBands(presets: Record<string, string>, key: string, supported: number[]): number[] {
  return parseBandString(presets[key]).filter((band) => supported.includes(band));
}

function getBandString(
  preset: BandPreset,
  presets: Record<string, string>,
  custom: Set<number>,
  supportedBands: number[],
): string | null {
  if (preset === "all") return null;
  const selected =
    preset === "custom"
      ? [...custom].filter((band) => supportedBands.includes(band)).sort((a, b) => a - b)
      : presetBands(presets, preset, supportedBands);
  return selected.length > 0 ? selected.join(":") : null;
}

interface BandPresetSectionProps {
  title: string;
  prefix: string;
  availableBands: number[];
  presets: Record<string, string>;
  selectedPreset: BandPreset;
  customBands: Set<number>;
  loading: boolean;
  onPresetChange: (preset: BandPreset) => void;
  onCustomBandToggle: (band: number) => void;
}

function BandPresetSection({
  title,
  prefix,
  availableBands,
  presets,
  selectedPreset,
  customBands,
  loading,
  onPresetChange,
  onCustomBandToggle,
}: BandPresetSectionProps) {
  const { t } = useTranslation("onboarding");
  const low = presetBands(presets, "low", availableBands);
  const mid = presetBands(presets, "mid", availableBands);
  const format = (bands: number[]) => bands.map((b) => `${prefix}${b}`).join(", ");

  // Low/mid appear only once the modem supports one of their bands; All and Custom always do.
  const options: { id: BandPreset; label: string; detail?: string }[] = [
    { id: "all", label: t("band_locking.preset_label_all") },
    ...(low.length > 0
      ? [{ id: "low" as const, label: t("band_locking.preset_label_low"), detail: format(low) }]
      : []),
    ...(mid.length > 0
      ? [{ id: "mid" as const, label: t("band_locking.preset_label_mid"), detail: format(mid) }]
      : []),
    { id: "custom", label: t("band_locking.preset_label_custom") },
  ];

  const labelId = `onboard-bands-${prefix}`;

  return (
    <div className="flex flex-col gap-2.5">
      <p id={labelId} className={SECTION_LABEL}>
        {title}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <OptionRow
            key={opt.id}
            size="sm"
            selected={selectedPreset === opt.id}
            onSelect={() => onPresetChange(opt.id)}
            label={opt.label}
            detail={opt.detail}
          />
        ))}
      </div>

      {selectedPreset === "custom" &&
        (loading && availableBands.length === 0 ? (
          <div className={`${INNER_TILE} flex items-center gap-2 text-sm text-on-surface-variant`}>
            <Loader2Icon className="size-4 motion-safe:animate-spin" />
            {t("band_locking.loading_bands")}
          </div>
        ) : availableBands.length > 0 ? (
          <div className={`${INNER_TILE} @container`}>
            <div className="grid max-h-40 grid-cols-4 gap-x-2 gap-y-1 overflow-y-auto pr-1 @[17rem]:grid-cols-5 @[20rem]:grid-cols-6">
              {availableBands.map((band) => {
                const id = `band-${prefix}-${band}`;
                return (
                  <div key={band} className="flex min-h-8 items-center gap-1.5">
                    <Checkbox
                      id={id}
                      checked={customBands.has(band)}
                      onCheckedChange={() => onCustomBandToggle(band)}
                    />
                    <Label
                      htmlFor={id}
                      className="cursor-pointer select-none whitespace-nowrap text-xs font-medium tabular-nums"
                    >
                      {prefix}
                      {band}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`${INNER_TILE} text-sm text-on-surface-variant`}>
            {t("band_locking.error_no_bands")}
          </div>
        ))}
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
  const { t } = useTranslation("onboarding");
  const { data, isLoading, error } = useModemStatus();
  const [ltePreset, setLtePreset] = useState<BandPreset>("all");
  const [nr5gPreset, setNr5gPreset] = useState<BandPreset>("all");
  const [lteCustom, setLteCustom] = useState<Set<number>>(new Set());
  const [nr5gCustom, setNr5gCustom] = useState<Set<number>>(new Set());

  // Null until an attempt leaves a category unapplied; any edit clears it.
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  const supportedLteBands = useMemo(
    () => parseBandString(data?.device.supported_lte_bands),
    [data?.device.supported_lte_bands],
  );
  const supportedNrBands = useMemo(
    () =>
      mergeUniqueBands(
        parseBandString(data?.device.supported_nsa_nr5g_bands),
        parseBandString(data?.device.supported_sa_nr5g_bands),
      ),
    [data?.device.supported_nsa_nr5g_bands, data?.device.supported_sa_nr5g_bands],
  );

  // Functional update, so two toggles inside one render cannot overwrite each other.
  const toggleBand = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    band: number,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(band)) next.delete(band);
      else next.add(band);
      return next;
    });
    setOutcome(null);
  };

  const changePreset = (setter: (p: BandPreset) => void, preset: BandPreset) => {
    setter(preset);
    setOutcome(null);
  };

  const submit = useCallback(async () => {
    const lteBands = getBandString(ltePreset, LTE_PRESETS, lteCustom, supportedLteBands);
    const nr5gBands = getBandString(nr5gPreset, NR5G_PRESETS, nr5gCustom, supportedNrBands);

    const selected: BandLockRequest[] = [];
    if (lteBands) selected.push({ category: "lte", bands: lteBands });
    if (nr5gBands) {
      // One 5G selection locks both NSA and SA.
      selected.push({ category: "nsa_nr5g", bands: nr5gBands });
      selected.push({ category: "sa_nr5g", bands: nr5gBands });
    }

    const retrying = outcome ? new Set(outcome.failed.map((f) => f.category)) : null;
    const targets = retrying ? selected.filter((r) => retrying.has(r.category)) : selected;

    if (targets.length === 0) {
      setOutcome(null);
      onSuccess();
      return;
    }

    onLoadingChange(true);
    const applied: BandCategory[] = outcome ? [...outcome.applied] : [];
    const failed: BandLockFailure[] = [];
    try {
      for (const target of targets) {
        const result = await postStep(BAND_LOCK_ENDPOINT, {
          band_type: target.category,
          bands: target.bands,
        });
        if (result.ok) applied.push(target.category);
        else failed.push({ category: target.category, result });
      }
    } finally {
      onLoadingChange(false);
    }

    if (failed.length > 0) {
      // One toast for the event; the notice keeps the per-category reasons.
      setOutcome({ applied, failed });
      toast.error(
        applied.length > 0 ? t("band_locking.toast_partial") : t("band_locking.toast_failed"),
      );
      return;
    }

    setOutcome(null);
    onSuccess();
  }, [
    ltePreset,
    nr5gPreset,
    lteCustom,
    nr5gCustom,
    supportedLteBands,
    supportedNrBands,
    outcome,
    onLoadingChange,
    onSuccess,
    t,
  ]);

  useEffect(() => {
    onSubmitRef(submit);
  }, [submit, onSubmitRef]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 className={STEP_HEADING}>{t("band_locking.heading")}</h2>
        <p className={STEP_DESCRIPTION}>{t("band_locking.description")}</p>
      </div>

      {outcome && <BandLockFailureNotice outcome={outcome} />}

      {error && !data && (
        <Banner
          role="degraded"
          icon={TriangleAlertIcon}
          description={t("band_locking.error_bands_unavailable")}
        />
      )}

      <div className="flex flex-col gap-6">
        <BandPresetSection
          title={t("band_locking.section_lte_title")}
          prefix="B"
          availableBands={supportedLteBands}
          presets={LTE_PRESETS}
          selectedPreset={ltePreset}
          customBands={lteCustom}
          loading={isLoading}
          onPresetChange={(p) => changePreset(setLtePreset, p)}
          onCustomBandToggle={(b) => toggleBand(setLteCustom, b)}
        />

        <BandPresetSection
          title={t("band_locking.section_5g_title")}
          prefix="N"
          availableBands={supportedNrBands}
          presets={NR5G_PRESETS}
          selectedPreset={nr5gPreset}
          customBands={nr5gCustom}
          loading={isLoading}
          onPresetChange={(p) => changePreset(setNr5gPreset, p)}
          onCustomBandToggle={(b) => toggleBand(setNr5gCustom, b)}
        />
      </div>
    </div>
  );
}

// What did not apply: `degraded` when part of the selection took, `stale` when none did.
// The step stays put; Continue retries, Skip leaves.
function BandLockFailureNotice({ outcome }: { outcome: SubmitOutcome }) {
  const { t } = useTranslation("onboarding");

  const failed = CATEGORY_ORDER.map((c) => outcome.failed.find((f) => f.category === c)).filter(
    (f): f is BandLockFailure => f !== undefined,
  );
  const applied = CATEGORY_ORDER.filter((c) => outcome.applied.includes(c));
  const isPartial = applied.length > 0;

  return (
    <Banner
      role={isPartial ? "degraded" : "stale"}
      icon={isPartial ? TriangleAlertIcon : AlertCircleIcon}
      title={isPartial ? t("band_locking.notice_title_partial") : t("band_locking.notice_title_failed")}
      description={
        <span className="flex flex-col gap-1.5">
          <span className="flex flex-col gap-1">
            {failed.map((f) => (
              <span key={f.category} className="flex flex-col">
                <span className="font-medium">{t(CATEGORY_LABEL_KEY[f.category])}</span>
                <span>{stepFailureMessage(t, f.result, t("band_locking.error_unconfirmed"))}</span>
              </span>
            ))}
          </span>
          {isPartial && (
            <span>
              {t("band_locking.notice_applied", {
                list: applied.map((c) => t(CATEGORY_LABEL_KEY[c])).join(", "),
              })}
            </span>
          )}
          <span>{t("band_locking.notice_retry")}</span>
        </span>
      }
    />
  );
}
