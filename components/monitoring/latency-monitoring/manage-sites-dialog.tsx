"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";
import type { MutationResult } from "@/types/mutation-result";
import type { SiteConfigEntry, SitesConfig } from "@/types/sites";

import {
  MAX_SITES,
  hostError,
  normalizeHost,
  type HostError,
} from "./derive";
import { DIALOG } from "./shapes";
import { SiteMark } from "./site-mark";

const BASE_INTERVALS = [60, 300, 900, 3600] as const;

const HOST_ERROR_KEY = {
  invalid: "latencyMonitor.manage.error_invalid",
  duplicate: "latencyMonitor.manage.error_duplicate",
  full: "latencyMonitor.manage.error_full",
} satisfies Record<HostError, string>;

type Monitor = "on" | "off";

const glyph = (className: string) => (
  <CheckIcon aria-hidden className={cn("size-4", className)} />
);

/** A sweep interval in the largest whole unit: "1 h", "5 min", "90 s". */
export function useIntervalLabel() {
  const { t } = useTranslation("dashboard");
  return (sec: number) =>
    sec % 3600 === 0
      ? t("latencyMonitor.interval.hours", { n: sec / 3600 })
      : sec % 60 === 0
        ? t("latencyMonitor.interval.minutes", { n: sec / 60 })
        : t("latencyMonitor.interval.seconds", { n: sec });
}

interface ManageFormProps {
  seed: SitesConfig;
  onSave: (config: SitesConfig) => Promise<MutationResult>;
  onDone: () => void;
}

function ManageForm({ seed, onSave, onDone }: ManageFormProps) {
  const { t } = useTranslation("dashboard");
  const errorId = useId();
  const [monitor, setMonitor] = useState<Monitor>(seed.enabled ? "on" : "off");
  const [intervalSec, setIntervalSec] = useState(String(seed.interval_sec));
  const [sites, setSites] = useState<SiteConfigEntry[]>(seed.sites);
  const [input, setInput] = useState("");
  const [error, setError] = useState<HostError | null>(null);
  const [saving, setSaving] = useState(false);
  const { saved, markSaved } = useSaveFlash();

  const formatInterval = useIntervalLabel();

  // A saved interval outside the four presets is shown as itself, never rounded.
  const intervals = [...new Set<number>([...BASE_INTERVALS, seed.interval_sec])].sort(
    (a, b) => a - b,
  );
  const intervalOptions = intervals.map((sec) => ({
    value: String(sec),
    label: formatInterval(sec),
    numeric: true,
  }));

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const host = normalizeHost(input);
    const problem = hostError(
      host,
      sites.map((s) => s.host),
    );
    setError(problem);
    if (problem) {
      setInput(host);
      return;
    }
    setSites((prev) => [...prev, { host, label: host }]);
    setInput("");
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await onSave({
      enabled: monitor === "on",
      interval_sec: Number(intervalSec),
      sites,
    });
    setSaving(false);
    if (result.ok) {
      markSaved();
      toast.success(t("latencyMonitor.toast.save_ok"));
      onDone();
    } else {
      toast.error(t("latencyMonitor.toast.save_failed"), {
        description: result.error ?? undefined,
      });
    }
  };

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle>{t("latencyMonitor.manage.title")}</DialogTitle>
        <DialogDescription className="text-on-surface-variant">
          {t("latencyMonitor.manage.description", { max: MAX_SITES })}
        </DialogDescription>
      </DialogHeader>

      <div className={DIALOG.ROW}>
        <span className={DIALOG.ROW_LABEL}>{t("latencyMonitor.manage.monitor")}</span>
        <SegmentedField<Monitor>
          value={monitor}
          onValueChange={setMonitor}
          options={[
            { value: "on", label: t("latencyMonitor.manage.on") },
            { value: "off", label: t("latencyMonitor.manage.off") },
          ]}
          ariaLabel={t("latencyMonitor.manage.monitor")}
          breakpoint="never"
          glyph={glyph}
        />
      </div>

      <div className={DIALOG.ROW}>
        <span className={DIALOG.ROW_LABEL}>{t("latencyMonitor.manage.interval")}</span>
        <SegmentedField
          value={intervalSec}
          onValueChange={setIntervalSec}
          options={intervalOptions}
          ariaLabel={t("latencyMonitor.manage.interval")}
          breakpoint="lg"
          glyph={glyph}
        />
      </div>

      <div className={DIALOG.WELL}>
        {sites.length === 0 ? (
          <p className={DIALOG.EMPTY}>{t("latencyMonitor.manage.empty")}</p>
        ) : (
          <ul className={DIALOG.LIST} aria-label={t("latencyMonitor.manage.list_aria")}>
            {sites.map((site) => (
              <li key={site.host} className={DIALOG.ITEM}>
                <SiteMark host={site.host} label={site.label} size="row" />
                <span className={DIALOG.HOST}>{site.host}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("latencyMonitor.manage.remove", { host: site.host })}
                  onClick={() =>
                    setSites((prev) => prev.filter((s) => s.host !== site.host))
                  }
                >
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className={DIALOG.ADD} onSubmit={handleAdd} noValidate>
        <Input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          placeholder={t("latencyMonitor.manage.add_placeholder")}
          aria-label={t("latencyMonitor.manage.add_label")}
          aria-invalid={error !== null || undefined}
          aria-describedby={error ? errorId : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
        <Button
          type="submit"
          variant="tonal"
          className="h-[2.625rem]"
          disabled={sites.length >= MAX_SITES}
        >
          <PlusIcon aria-hidden />
          {t("latencyMonitor.manage.add")}
        </Button>
      </form>
      {error ? (
        <p id={errorId} className={DIALOG.ERROR}>
          {t(HOST_ERROR_KEY[error], { max: MAX_SITES })}
        </p>
      ) : null}

      <DialogFooter className={DIALOG.FOOTER}>
        <span className={DIALOG.COUNT}>
          {t("latencyMonitor.manage.count", { n: sites.length, max: MAX_SITES })}
        </span>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {t("latencyMonitor.manage.cancel")}
          </Button>
        </DialogClose>
        <SaveButton
          isSaving={saving}
          saved={saved}
          label={t("latencyMonitor.manage.save")}
          onClick={handleSave}
          disabled={saving}
        />
      </DialogFooter>
    </>
  );
}

export interface ManageSitesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-seeds the draft on every open, so a cancelled edit never lingers. */
  formKey: number;
  seed: SitesConfig | null;
  onSave: (config: SitesConfig) => Promise<MutationResult>;
}

export function ManageSitesDialog({
  open,
  onOpenChange,
  formKey,
  seed,
  onSave,
}: ManageSitesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG.CONTENT}>
        {seed ? (
          <ManageForm
            key={formKey}
            seed={seed}
            onSave={onSave}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
