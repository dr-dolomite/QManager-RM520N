"use client";

import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

// =============================================================================
// engine-enable-row — the mode enable/disable switch.
// Enabling one mode while the other is active requires a takeover confirm:
// only one mode can own the engine, and the backend enforces the mutex on
// save. The dialog makes that explicit before the switch flips.
// =============================================================================

export interface EngineEnableRowProps {
  enabled: boolean;
  otherEnabled: boolean;
  isSaving: boolean;
  otherModeLabel: string;
  title: string;
  description: string;
  toastEnabled: string;
  toastDisabled: string;
  onSave: (enabled: boolean) => Promise<boolean>;
}

const EngineEnableRow = ({
  enabled,
  otherEnabled,
  isSaving,
  otherModeLabel,
  title,
  description,
  toastEnabled,
  toastDisabled,
  onSave,
}: EngineEnableRowProps) => {
  const { t } = useTranslation("common");

  const commit = async (next: boolean) => {
    const ok = await onSave(next);
    if (ok) toast.success(next ? toastEnabled : toastDisabled);
  };

  const row = (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={enabled}
        disabled={isSaving}
        onCheckedChange={(v) => {
          if (v && otherEnabled) return; // gated by the takeover dialog below
          commit(v);
        }}
      />
    </div>
  );

  // Enabling while the other mode owns the engine → takeover confirm.
  if (otherEnabled && !enabled) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <Switch checked={enabled} disabled={isSaving} />
          </div>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("trafficEngine.takeover.title", { mode: otherModeLabel })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("trafficEngine.takeover.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("trafficEngine.takeover.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => commit(true)}>
              {t("trafficEngine.takeover.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return row;
};

export default EngineEnableRow;