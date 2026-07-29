"use client";

import { useState, useEffect, type FormEvent, type ChangeEvent } from "react";
import { toast } from "sonner";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { BackupImeiConfig } from "@/types/imei-settings";

interface BackupIMEICardProps {
  backupEnabled: boolean | null;
  backupImei: string | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (config: BackupImeiConfig) => Promise<boolean>;
}

const BackupIMEICard = ({
  backupEnabled,
  backupImei,
  isLoading,
  isSaving,
  onSave,
}: BackupIMEICardProps) => {
  const { saved, markSaved } = useSaveFlash();
  const [localEnabled, setLocalEnabled] = useState(false);
  const [localImei, setLocalImei] = useState("");
  const [showInfoDialog, setShowInfoDialog] = useState(false);

  // Sync form state from fetched data
  useEffect(() => {
    if (backupEnabled !== null) {
      setLocalEnabled(backupEnabled);
    }
    if (backupImei !== null) {
      setLocalImei(backupImei);
    }
  }, [backupEnabled, backupImei]);

  const isValidImei = /^\d{15}$/.test(localImei);

  const handleSwitchChange = (checked: boolean) => {
    if (checked) {
      // Show informational dialog before enabling
      setShowInfoDialog(true);
    } else {
      setLocalEnabled(false);
    }
  };

  const handleInfoConfirm = () => {
    setLocalEnabled(true);
    setShowInfoDialog(false);
  };

  const handleInfoCancel = () => {
    setShowInfoDialog(false);
    // Switch stays OFF
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();

    if (localEnabled && !isValidImei) {
      toast.error("Backup IMEI must be exactly 15 digits");
      return;
    }

    // Check for changes
    const enabledChanged = localEnabled !== (backupEnabled ?? false);
    const imeiChanged = localImei !== (backupImei ?? "");

    if (!enabledChanged && !imeiChanged) {
      toast.info("No changes to save");
      return;
    }

    const success = await onSave({ enabled: localEnabled, imei: localImei });
    if (success) {
      markSaved();
      toast.success("Backup IMEI configuration saved");
    } else {
      toast.error("Failed to save backup configuration");
    }
  };

  const handleReset = () => {
    if (backupEnabled !== null) {
      setLocalEnabled(backupEnabled);
    }
    if (backupImei !== null) {
      setLocalImei(backupImei);
    }
  };

  // Only allow digits in the input
  const handleImeiChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 15);
    setLocalImei(value);
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Backup Device IMEI</CardTitle>
          <CardDescription>
            Automatically sets up a backup IMEI for your device to ensure
            connectivity in case of primary IMEI issues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-3 w-72" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-9" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Backup Device IMEI</CardTitle>
        <CardDescription>
          If the network rejects the current IMEI after a reboot, the device
          can automatically switch to a backup IMEI and restart.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <FieldSet>
            <FieldGroup>
              <div className="grid gap-2">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="backup-imei-toggle">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="inline-flex" aria-label="More info">
                          <MaterialSymbol name="info" filled size={20} className="text-info" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          Switch to a backup IMEI when the primary IMEI was
                          rejected by the network.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    Enable Backup IMEI
                  </FieldLabel>
                  <Switch
                    id="backup-imei-toggle"
                    checked={localEnabled}
                    onCheckedChange={handleSwitchChange}
                    disabled={isSaving}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="backup-imei-input">
                  Set Backup IMEI
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="backup-imei-input"
                    placeholder="Enter Backup IMEI"
                    value={localImei}
                    onChange={handleImeiChange}
                    maxLength={15}
                    inputMode="numeric"
                    disabled={isSaving || !localEnabled}
                  />
                  <InputGroupAddon align="inline-start">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="pl-1.5 inline-flex items-center"
                          aria-label="IMEI legal warning"
                        >
                          <MaterialSymbol name="warning" size={16} className="text-muted-foreground" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          IMEI modification regulations vary by country.
                          <br />
                          Check your local laws before changing the IMEI.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Switching to the backup IMEI will require a device reboot to
                  take effect.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
          <div className="flex items-center gap-x-2">
            <SaveButton
              type="submit"
              isSaving={isSaving}
              saved={saved}
              disabled={localEnabled && !isValidImei}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleReset}
              disabled={isSaving}
              aria-label="Reset to saved values"
            >
              <MaterialSymbol name="restart_alt" size={16} />
            </Button>
          </div>
        </form>

        {/* Informational dialog when enabling backup IMEI */}
        <AlertDialog open={showInfoDialog} onOpenChange={setShowInfoDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Backup IMEI Auto-Recovery</AlertDialogTitle>
              <AlertDialogDescription>
                When backup IMEI is enabled, the device will automatically check
                for IMEI rejection after each reboot following an IMEI change.
                If the network rejects the primary IMEI, the device will switch
                to the backup IMEI and reboot automatically.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleInfoCancel}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleInfoConfirm}>
                Enable Backup
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};

export default BackupIMEICard;
