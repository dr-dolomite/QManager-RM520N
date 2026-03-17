"use client";

import { useState, useEffect, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, RotateCcwIcon } from "lucide-react";
import type { MbnProfile, MbnSaveRequest } from "@/types/mbn-settings";

interface MBNCardProps {
  profiles: MbnProfile[] | null;
  autoSel: number | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (request: MbnSaveRequest) => Promise<boolean>;
  onReboot: () => Promise<boolean>;
}

const MBNCard = ({
  profiles,
  autoSel,
  isLoading,
  isSaving,
  onSave,
  onReboot,
}: MBNCardProps) => {
  // Form state
  const [localAutoSel, setLocalAutoSel] = useState<string>("");
  const [selectedProfile, setSelectedProfile] = useState<string>("");

  // Reboot dialog
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  // Sync form state from fetched data
  useEffect(() => {
    if (autoSel !== null) {
      setLocalAutoSel(String(autoSel));
    }
    if (profiles) {
      const active = profiles.find((p) => p.selected);
      setSelectedProfile(active?.name ?? "");
    }
  }, [profiles, autoSel]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!profiles) return;

    const currentAutoSel = autoSel !== null ? String(autoSel) : "";
    const currentProfile = profiles.find((p) => p.selected);

    // Case 1: Auto-select changed to enabled
    if (localAutoSel === "1" && currentAutoSel !== "1") {
      const success = await onSave({ action: "auto_sel", auto_sel: 1 });
      if (success) {
        toast.success("Auto-select enabled — reboot required");
        setShowRebootDialog(true);
      } else {
        toast.error("Failed to enable auto-select");
      }
      return;
    }

    // Case 2: Auto-select changed to disabled (without profile change)
    if (localAutoSel === "0" && currentAutoSel !== "0" && selectedProfile === currentProfile?.name) {
      const success = await onSave({ action: "auto_sel", auto_sel: 0 });
      if (success) {
        toast.success("Auto-select disabled — reboot required");
        setShowRebootDialog(true);
      } else {
        toast.error("Failed to disable auto-select");
      }
      return;
    }

    // Case 3: Profile changed (auto-sel is off or being turned off)
    if (localAutoSel === "0" && selectedProfile && selectedProfile !== currentProfile?.name) {
      const success = await onSave({
        action: "apply_profile",
        profile_name: selectedProfile,
      });
      if (success) {
        toast.success("Carrier profile applied — reboot required");
        setShowRebootDialog(true);
      } else {
        toast.error("Failed to apply carrier profile");
      }
      return;
    }

    toast.info("No changes to save");
  };

  const handleReset = () => {
    if (autoSel !== null) {
      setLocalAutoSel(String(autoSel));
    }
    if (profiles) {
      const active = profiles.find((p) => p.selected);
      setSelectedProfile(active?.name ?? "");
    }
  };

  const handleReboot = async (e: React.MouseEvent) => {
    e.preventDefault(); // Keep dialog open to show rebooting state
    setIsRebooting(true);
    const sent = await onReboot();
    if (sent) {
      toast.success("Device is rebooting...");
    } else {
      toast.error("Reboot failed — restart the device manually");
      setIsRebooting(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Carrier Profile</CardTitle>
          <CardDescription>
            Select which carrier firmware profile is active on the modem. A reboot is required after changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="space-y-2 ">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2 ">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-9 w-full" />
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
        <CardTitle>Carrier Profile</CardTitle>
        <CardDescription>
          Select which carrier firmware profile is active on the modem. A reboot is required after changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="mbn-auto-select">Auto-Select Profile</FieldLabel>
                  <Select
                    value={
                      localAutoSel ||
                      (autoSel !== null ? String(autoSel) : "")
                    }
                    onValueChange={setLocalAutoSel}
                    disabled={isSaving}
                  >
                    <SelectTrigger id="mbn-auto-select" aria-label="Auto-Select Profile">
                      <SelectValue placeholder="Choose Auto-Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Enabled</SelectItem>
                      <SelectItem value="0">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="mbn-carrier-config">Carrier Configuration</FieldLabel>
                  <Select
                    value={
                      selectedProfile ||
                      (profiles
                        ? profiles.find((p) => p.selected)?.name ?? ""
                        : "")
                    }
                    onValueChange={setSelectedProfile}
                    disabled={isSaving || localAutoSel === "1"}
                  >
                    <SelectTrigger id="mbn-carrier-config" aria-label="Carrier Configuration">
                      <SelectValue placeholder="Choose Carrier Configuration" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles?.map((p) => (
                        <SelectItem key={p.index} value={p.name}>
                          {p.name}
                          {p.selected && p.activated ? " (Active)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </FieldSet>
          </div>
          <div className="flex items-center gap-x-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Settings"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={isSaving}
              aria-label="Reset to saved values"
            >
              <RotateCcwIcon />
            </Button>
          </div>
        </form>

        {/* Reboot confirmation dialog */}
        <AlertDialog open={showRebootDialog} onOpenChange={(open) => {
          if (!isRebooting) setShowRebootDialog(open);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reboot Required</AlertDialogTitle>
              <AlertDialogDescription>
                Carrier profile changes require a device reboot to take effect.
                Would you like to reboot now?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRebooting}>
                Reboot Later
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isRebooting}
                onClick={handleReboot}
              >
                {isRebooting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Rebooting...
                  </>
                ) : (
                  "Reboot Now"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};

export default MBNCard;
