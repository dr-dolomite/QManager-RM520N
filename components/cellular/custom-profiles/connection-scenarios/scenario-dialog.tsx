"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NETWORK_MODE_OPTIONS } from "@/types/connection-scenario";
import { DEFAULT_SCENARIO_ICON_ID, SCENARIO_ICONS } from "./scenario-icons";

// ONE dialog for adding and editing a custom scenario; it only edits a draft, the card builds the request body. The
// parent remounts it per open via `key`, which seeds the draft from `initial` once.

export interface ScenarioDraft {
  name: string;
  description: string;
  /** AT `mode_pref` value (NETWORK_MODE_OPTIONS). */
  mode: string;
  /** Edit only: the stored optimization token or the user's own words. */
  optimization: string;
  /** Glyph id from `SCENARIO_ICONS`. */
  icon: string;
  lteBands: string;
  saBands: string;
  nsaBands: string;
}

export const EMPTY_SCENARIO_DRAFT: ScenarioDraft = {
  name: "",
  description: "",
  mode: "AUTO",
  optimization: "",
  icon: DEFAULT_SCENARIO_ICON_ID,
  lteBands: "",
  saBands: "",
  nsaBands: "",
};

// NR5G-only is SA (NSA needs an LTE anchor); AUTO and LTE:NR5G can use every radio.
function bandFieldsForMode(mode: string) {
  if (mode === "LTE") return { lte: true, sa: false, nsa: false };
  if (mode === "NR5G") return { lte: false, sa: true, nsa: false };
  return { lte: true, sa: true, nsa: true };
}

interface ScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "add" for a new scenario, "edit" for an existing custom one. */
  mode: "add" | "edit";
  initial: ScenarioDraft;
  isSaving: boolean;
  onSubmit: (draft: ScenarioDraft) => void;
}

export function ScenarioDialog({
  open,
  onOpenChange,
  mode,
  initial,
  isSaving,
  onSubmit,
}: ScenarioDialogProps) {
  const { t } = useTranslation("cellular");
  const F = "scenarios.dialog.fields";
  const [draft, setDraft] = useState<ScenarioDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const nameMissing = !draft.name.trim();
  const isAdd = mode === "add";

  const set = (key: keyof ScenarioDraft) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const { lte: showLte, sa: showSa, nsa: showNsa } = bandFieldsForMode(draft.mode);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (nameMissing || isSaving) return;
    // Hidden fields keep their text for a mode flip back, but never submit a lock the user can't see.
    onSubmit({
      ...draft,
      lteBands: showLte ? draft.lteBands : "",
      saBands: showSa ? draft.saBands : "",
      nsaBands: showNsa ? draft.nsaBands : "",
    });
  };

  const formId = `scenario-dialog-${mode}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      {/* Capped to the viewport; only the form scrolls, so the header and Create stay reachable on short phones. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] rounded-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isAdd
              ? t("scenarios.dialog.add.title")
              : t("scenarios.dialog.edit.title")}
          </DialogTitle>
          <DialogDescription>{t("scenarios.dialog.description")}</DialogDescription>
        </DialogHeader>

        <form
          id={formId}
          onSubmit={handleSubmit}
          noValidate
          className="-mx-6 min-h-0 overflow-y-auto overscroll-contain px-6 py-1 [scrollbar-width:thin]"
        >
          <FieldGroup className="gap-5">
            <Field data-invalid={attempted && nameMissing ? true : undefined}>
              <FieldLabel htmlFor={`${formId}-name`}>{t(`${F}.name_label`)}</FieldLabel>
              <Input
                id={`${formId}-name`}
                value={draft.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder={t(
                  isAdd ? `${F}.name_placeholder_add` : `${F}.name_placeholder_edit`,
                )}
                aria-invalid={(attempted && nameMissing) || undefined}
              />
              {attempted && nameMissing ? (
                <FieldError>{t("scenarios.dialog.name_required")}</FieldError>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor={`${formId}-description`}>
                {t(`${F}.description_label`)}
              </FieldLabel>
              <Input
                id={`${formId}-description`}
                value={draft.description}
                onChange={(e) => set("description")(e.target.value)}
                placeholder={t(
                  isAdd
                    ? `${F}.description_placeholder_add`
                    : `${F}.description_placeholder_edit`,
                )}
              />
            </Field>

            <Field>
              <FieldLabel id={`${formId}-icon-label`}>{t(`${F}.icon_label`)}</FieldLabel>
              <div
                role="group"
                aria-labelledby={`${formId}-icon-label`}
                className="grid grid-cols-6 gap-2"
              >
                {SCENARIO_ICONS.map(({ id, icon, labelKey }) => {
                  const selected = draft.icon === id;
                  const label = t(labelKey);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => set("icon")(id)}
                      aria-pressed={selected}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "grid h-9 place-items-center pointer-coarse:h-11 rounded-inline transition-colors duration-[var(--duration-quick)] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-surface-container-high text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container",
                      )}
                    >
                      <MaterialSymbol name={icon} size={16} />
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor={`${formId}-mode`}>{t(`${F}.network_mode_label`)}</FieldLabel>
              <Select value={draft.mode} onValueChange={set("mode")}>
                <SelectTrigger id={`${formId}-mode`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NETWORK_MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {isAdd ? null : (
              <Field>
                <FieldLabel htmlFor={`${formId}-optimization`}>
                  {t(`${F}.optimization_label`)}
                </FieldLabel>
                <Input
                  id={`${formId}-optimization`}
                  value={draft.optimization}
                  onChange={(e) => set("optimization")(e.target.value)}
                  placeholder={t(`${F}.optimization_placeholder`)}
                />
              </Field>
            )}

            {showLte ? (
              <Field>
                <FieldLabel htmlFor={`${formId}-lte`}>{t(`${F}.lte_band_label`)}</FieldLabel>
                <Input
                  id={`${formId}-lte`}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={draft.lteBands}
                  onChange={(e) => set("lteBands")(e.target.value)}
                  placeholder={t(`${F}.lte_band_placeholder`)}
                />
              </Field>
            ) : null}

            {showSa || showNsa ? (
              <div
                className={cn("grid grid-cols-1 gap-4", showSa && showNsa && "sm:grid-cols-2")}
              >
                {showSa ? (
                  <Field>
                    <FieldLabel htmlFor={`${formId}-sa`}>{t(`${F}.sa_band_label`)}</FieldLabel>
                    <Input
                      id={`${formId}-sa`}
                      inputMode="numeric"
                      className="tabular-nums"
                      value={draft.saBands}
                      onChange={(e) => set("saBands")(e.target.value)}
                      placeholder={t(`${F}.band_placeholder`)}
                    />
                  </Field>
                ) : null}
                {showNsa ? (
                  <Field>
                    <FieldLabel htmlFor={`${formId}-nsa`}>{t(`${F}.nsa_band_label`)}</FieldLabel>
                    <Input
                      id={`${formId}-nsa`}
                      inputMode="numeric"
                      className="tabular-nums"
                      value={draft.nsaBands}
                      onChange={(e) => set("nsaBands")(e.target.value)}
                      placeholder={t(`${F}.band_placeholder`)}
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </FieldGroup>
        </form>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="action" disabled={isSaving}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
          </DialogClose>
          <SaveButton
            type="submit"
            form={formId}
            size="action"
            isSaving={isSaving}
            saved={false}
            label={
              isAdd
                ? t("scenarios.dialog.buttons.create")
                : t("scenarios.dialog.buttons.save_changes")
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ScenarioDialog;
