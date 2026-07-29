"use client";

import { useState, useEffect, type FormEvent } from "react";
import { toast } from "sonner";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { CellularSettings } from "@/types/cellular-settings";

interface CellularSettingsCardProps {
  settings: CellularSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (changes: Partial<CellularSettings>) => Promise<boolean>;
}

const CellularSettingsCard = ({
  settings,
  isLoading,
  isSaving,
  onSave,
}: CellularSettingsCardProps) => {
  const { saved, markSaved } = useSaveFlash();
  const [simSlot, setSimSlot] = useState<string>("");
  const [cfun, setCfun] = useState<string>("");
  const [modePref, setModePref] = useState<string>("");
  const [nr5gMode, setNr5gMode] = useState<string>("");
  const [roamPref, setRoamPref] = useState<string>("");

  // Sync form state from fetched settings
  useEffect(() => {
    if (settings) {
      setSimSlot(String(settings.sim_slot));
      setCfun(String(settings.cfun));
      setModePref(settings.mode_pref);
      setNr5gMode(String(settings.nr5g_mode));
      setRoamPref(String(settings.roam_pref));
    }
  }, [settings]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    const changes: Partial<CellularSettings> = {};

    if (Number(simSlot) !== settings.sim_slot) {
      changes.sim_slot = Number(simSlot);
    }
    if (Number(cfun) !== settings.cfun) {
      changes.cfun = Number(cfun);
    }
    if (modePref !== settings.mode_pref) {
      changes.mode_pref = modePref;
    }
    if (Number(nr5gMode) !== settings.nr5g_mode) {
      changes.nr5g_mode = Number(nr5gMode);
    }
    if (Number(roamPref) !== settings.roam_pref) {
      changes.roam_pref = Number(roamPref);
    }

    if (Object.keys(changes).length === 0) {
      toast.info("No changes to save");
      return;
    }

    const success = await onSave(changes);
    if (success) {
      markSaved();
      toast.success("Modem settings saved");
    } else {
      toast.error("Failed to save modem settings");
    }
  };

  const handleReset = () => {
    if (settings) {
      setSimSlot(String(settings.sim_slot));
      setCfun(String(settings.cfun));
      setModePref(settings.mode_pref);
      setNr5gMode(String(settings.nr5g_mode));
      setRoamPref(String(settings.roam_pref));
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Cellular Basic Settings</CardTitle>
          <CardDescription>
            Manage your cellular connection settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
            <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
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
        <CardTitle>Modem Radio Settings</CardTitle>
        <CardDescription>
          Configure SIM slot, radio power, network type, and roaming preferences.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSave}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>SIM Slot</FieldLabel>
                    <Select
                      value={simSlot || (settings ? String(settings.sim_slot) : "")}
                      onValueChange={setSimSlot}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose SIM Slot" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">SIM 1</SelectItem>
                        <SelectItem value="2">SIM 2</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>Radio Power</FieldLabel>
                    <Select
                      value={cfun || (settings ? String(settings.cfun) : "")}
                      onValueChange={setCfun}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Radio Power Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Radio Off (Low Power)</SelectItem>
                        <SelectItem value="1">Normal Operation</SelectItem>
                        <SelectItem value="4">
                          Airplane Mode (RF Off)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>Preferred Network Type</FieldLabel>
                    <Select
                      value={modePref || (settings ? settings.mode_pref : "")}
                      onValueChange={setModePref}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Network Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AUTO">Automatic</SelectItem>
                        <SelectItem value="LTE">LTE Only</SelectItem>
                        <SelectItem value="NR5G">5G Only</SelectItem>
                        <SelectItem value="LTE:NR5G">LTE + 5G</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>5G Architecture</FieldLabel>
                    <Select
                      value={nr5gMode || (settings ? String(settings.nr5g_mode) : "")}
                      onValueChange={setNr5gMode}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose 5G Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Auto (SA + NSA)</SelectItem>
                        <SelectItem value="1">NSA Only (5G via LTE)</SelectItem>
                        <SelectItem value="2">SA Only (Standalone)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div className="grid @md/card:grid-cols-2 grid-cols-1 grid-flow-row gap-4">
                  <Field>
                    <FieldLabel>Roaming Preference</FieldLabel>
                    <Select
                      value={roamPref || (settings ? String(settings.roam_pref) : "")}
                      onValueChange={setRoamPref}
                      disabled={isSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose Roaming Preference" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="255">Any Network</SelectItem>
                        <SelectItem value="1">Home Network Only</SelectItem>
                        <SelectItem value="3">Partner Networks</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </FieldGroup>
            </FieldSet>
          </div>
          <div className="flex items-center gap-x-2">
            <SaveButton type="submit" isSaving={isSaving} saved={saved} />
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
      </CardContent>
    </Card>
  );
};

export default CellularSettingsCard;
