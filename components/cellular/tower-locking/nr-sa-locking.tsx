"use client";

import React, { useState, useMemo } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";

import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";

import type {
  TowerLockConfig,
  TowerModemState,
  NrSaLockCell,
} from "@/types/tower-locking";
import type { ModemStatus, NetworkType } from "@/types/modem-status";
import { SCS_OPTIONS } from "@/types/tower-locking";
import {
  nrCarriersFromQcainfo,
  defaultScsForBand,
  compositeValue,
  parseCompositeValue,
  type CarrierOption,
} from "./simple-mode-utils";
import { CarrierLabel } from "./carrier-label";

interface NRSALockingProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  modemData: ModemStatus | null;
  networkType: NetworkType | string;
  isLoading: boolean;
  isLocking: boolean;
  isWatcherRunning: boolean;
  onLock: (cell: NrSaLockCell) => Promise<boolean>;
  onUnlock: () => Promise<boolean>;
}

const STORAGE_KEY_NR_SIMPLE_MODE = "qmanager_tower_nr_simple_mode";

type ScsSource = "manual" | "band_default" | "servingcell";

const NRSALockingComponent = ({
  config,
  modemState,
  modemData,
  networkType,
  isLoading,
  isLocking,
  isWatcherRunning,
  onLock,
  onUnlock,
}: NRSALockingProps) => {
  // Local form state
  const [arfcn, setArfcn] = useState("");
  const [pci, setPci] = useState("");
  const [band, setBand] = useState("");
  const [scs, setScs] = useState("");
  const [prevNrSa, setPrevNrSa] = useState(config?.nr_sa);

  // Simple Mode state (persisted to localStorage)
  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY_NR_SIMPLE_MODE) === "true";
  });

  const [scsSource, setScsSource] = useState<ScsSource>("manual");

  const handleSimpleModeToggle = (on: boolean) => {
    setSimpleMode(on);
    setScsSource("manual");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_NR_SIMPLE_MODE, String(on));
    }
  };

  // Confirmation dialog state
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [pendingCell, setPendingCell] = useState<NrSaLockCell | null>(null);

  // Sync form from config when data loads (render-time update avoids effect cascade)
  if (config?.nr_sa !== prevNrSa) {
    setPrevNrSa(config?.nr_sa);
    if (config?.nr_sa) {
      if (config.nr_sa.arfcn !== null) setArfcn(String(config.nr_sa.arfcn));
      if (config.nr_sa.pci !== null) setPci(String(config.nr_sa.pci));
      if (config.nr_sa.band !== null) setBand(String(config.nr_sa.band));
      if (config.nr_sa.scs !== null) setScs(String(config.nr_sa.scs));
    }
  }

  // Derive carrier options for Simple Mode
  const carrierOptions = useMemo<CarrierOption[]>(
    () => (modemData ? nrCarriersFromQcainfo(modemData) : []),
    [modemData],
  );
  const hasOptions = carrierOptions.length > 0;

  const handleCarrierPick = (value: string) => {
    const parsed = parseCompositeValue(value);
    if (!parsed) return;
    const opt = carrierOptions.find(
      (o) => o.earfcn === parsed.earfcn && o.pci === parsed.pci,
    );
    if (!opt) return;

    setArfcn(String(opt.earfcn));
    setPci(String(opt.pci));
    if (opt.bandNumber != null) setBand(String(opt.bandNumber));

    // SCS resolution: trust live serving cell when picking the PCC.
    const liveScs = modemData?.nr?.scs ?? null;
    const liveArfcn = modemData?.nr?.arfcn ?? null;
    const livePci = modemData?.nr?.pci ?? null;
    const isLiveServingCell =
      liveArfcn === opt.earfcn && livePci === opt.pci && liveScs !== null;

    if (isLiveServingCell) {
      setScs(String(liveScs));
      setScsSource("servingcell");
    } else {
      const fallback = defaultScsForBand(opt.bandNumber);
      setScs(fallback !== null ? String(fallback) : "");
      setScsSource("band_default");
    }
  };

  const currentArfcnComposite = useMemo(() => {
    const aNum = parseInt(arfcn, 10);
    const pNum = parseInt(pci, 10);
    if (Number.isNaN(aNum) || Number.isNaN(pNum)) return "";
    return compositeValue(aNum, pNum);
  }, [arfcn, pci]);

  const arfcnInList = useMemo(
    () =>
      carrierOptions.find(
        (o) => compositeValue(o.earfcn, o.pci) === currentArfcnComposite,
      ),
    [carrierOptions, currentArfcnComposite],
  );

  // Derive enabled state from modem state or config
  const isEnabled = modemState?.nr_locked ?? config?.nr_sa?.enabled ?? false;

  // NSA mode gating — NR-SA locking not available in NSA or LTE-only mode
  const isNsaMode = networkType === "5G-NSA";
  const isLteOnly = networkType === "LTE";
  const isCardDisabled = isNsaMode || isLteOnly;
  const isDisabled = isCardDisabled || isLocking;

  const handleToggle = (checked: boolean) => {
    if (checked && isWatcherRunning) {
      toast.warning("Failover check in progress", {
        description: "Signal quality check is running, please wait.",
      });
      return;
    }
    if (checked) {
      const parsedArfcn = parseInt(arfcn, 10);
      const parsedPci = parseInt(pci, 10);
      const parsedBand = parseInt(band, 10);
      const parsedScs = parseInt(scs, 10);

      if (
        Number.isNaN(parsedArfcn) ||
        Number.isNaN(parsedPci) ||
        Number.isNaN(parsedBand) ||
        Number.isNaN(parsedScs)
      ) {
        toast.warning("Incomplete fields", {
          description: "Please fill in all required tower fields before locking.",
        });
        return;
      }

      const cell: NrSaLockCell = {
        arfcn: parsedArfcn,
        pci: parsedPci,
        band: parsedBand,
        scs: parsedScs,
      };
      setPendingCell(cell);
      setShowLockDialog(true);
    } else {
      setShowUnlockDialog(true);
    }
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    if (pendingCell) {
      const success = await onLock(pendingCell);
      if (success) {
        toast.success("NR-SA tower lock applied");
      } else {
        toast.error("Failed to lock tower — check modem connection");
      }
    }
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    const success = await onUnlock();
    if (success) {
      toast.success("NR-SA tower lock cleared");
    } else {
      toast.error("Failed to remove tower lock");
    }
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>NR-SA Tower Locking</CardTitle>
          <CardDescription>
            Lock to a specific 5G SA cell tower by entering its channel, cell ID, band, and subcarrier spacing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
            <Separator />
            <div className="grid gap-4 mt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={`@container/card ${isCardDisabled ? "opacity-60" : ""}`}>
        <CardHeader>
          <CardTitle>NR-SA Tower Locking</CardTitle>
          <CardDescription>
            Lock to a specific 5G SA cell tower by entering its channel, cell ID, band, and subcarrier spacing.
            {isNsaMode && " Not compatible with NR5G-NSA mode."}
            {isLteOnly && " No NR connection available."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <MaterialSymbol name="info" filled size={16} className="text-muted-foreground" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {hasOptions
                        ? "Pick from currently visible 5G carriers (PCC + SCCs from QCAINFO). Band and SCS auto-fill."
                        : "No 5G carriers visible in QCAINFO right now. Switch off Simple Mode to enter values manually."}
                    </TooltipContent>
                  </Tooltip>
                  <p className="font-medium text-muted-foreground text-sm">
                    Simple Mode
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="nr-sa-simple-mode"
                    aria-label="Toggle NR Simple Mode"
                    checked={simpleMode && hasOptions}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || isDisabled}
                  />
                  <Label htmlFor="nr-sa-simple-mode">
                    {simpleMode && hasOptions ? "On" : "Off"}
                  </Label>
                </div>
              </div>
              {!hasOptions && (
                <p className="text-xs text-muted-foreground">
                  No 5G carriers visible in QCAINFO right now.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <MaterialSymbol name="info" filled size={20} className="text-info" />
                <p className="font-semibold text-muted-foreground text-sm">
                  NR Tower Locking Enabled
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {isLocking ? (
                  <MaterialSymbol name="progress_activity" size={16} className="animate-spin motion-reduce:animate-none text-muted-foreground" />
                ) : null}
                <Switch
                  id="nr-sa-tower-locking"
                  checked={isEnabled}
                  onCheckedChange={handleToggle}
                  disabled={isDisabled}
                />
                <Label htmlFor="nr-sa-tower-locking">
                  {isEnabled ? "Enabled" : "Disabled"}
                </Label>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 mt-6">
              <div className="w-full">
                <FieldSet>
                  <FieldGroup>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="nrarfcn1">Channel (ARFCN)</FieldLabel>
                        {simpleMode && hasOptions ? (
                          <Select
                            value={arfcnInList ? currentArfcnComposite : ""}
                            onValueChange={handleCarrierPick}
                            disabled={isDisabled}
                          >
                            <SelectTrigger id="nrarfcn1" className="w-full">
                              {arfcnInList ? (
                                <SelectValue />
                              ) : arfcn && pci ? (
                                <span
                                  className="min-w-0 italic text-muted-foreground line-clamp-1"
                                  title={`Custom: ARFCN ${arfcn}, PCI ${pci}`}
                                >
                                  {`Custom: ARFCN ${arfcn}, PCI ${pci}`}
                                </span>
                              ) : (
                                <SelectValue placeholder="Pick a 5G carrier" />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {carrierOptions.map((opt) => {
                                const value = compositeValue(opt.earfcn, opt.pci);
                                return (
                                  <SelectItem key={value} value={value}>
                                    <CarrierLabel opt={opt} />
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id="nrarfcn1"
                            type="text"
                            placeholder="Enter ARFCN"
                            value={arfcn}
                            onChange={(e) => setArfcn(e.target.value)}
                            disabled={isDisabled}
                          />
                        )}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="nrpci">Cell ID (PCI)</FieldLabel>
                        <Input
                          id="nrpci"
                          type="text"
                          placeholder="Enter PCI"
                          value={pci}
                          onChange={(e) => setPci(e.target.value)}
                          disabled={isDisabled}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="nr-band">NR Band</FieldLabel>
                        <Input
                          id="nr-band"
                          type="text"
                          placeholder="Enter NR Band"
                          value={band}
                          onChange={(e) => setBand(e.target.value)}
                          disabled={isDisabled}
                        />
                      </Field>
                      <Field>
                        <div className="flex items-center justify-between gap-2">
                          <FieldLabel htmlFor="scs">Subcarrier Spacing</FieldLabel>
                          {simpleMode && scsSource === "band_default" && band && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <MaterialSymbol name="warning" size={14} className="text-warning" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {`SCS auto-filled from band default for N${band}. Verify against your tower if locking fails.`}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <Select
                          value={scs}
                          onValueChange={(v) => {
                            setScs(v);
                            setScsSource("manual");
                          }}
                          disabled={isDisabled}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="SCS" />
                          </SelectTrigger>
                          <SelectContent>
                            {SCS_OPTIONS.map((opt) => (
                              <SelectItem
                                key={opt.value}
                                value={String(opt.value)}
                              >
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  </FieldGroup>
                </FieldSet>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lock confirmation dialog */}
      <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock to NR-SA Tower?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock your modem to NR ARFCN {pendingCell?.arfcn}, PCI{" "}
              {pendingCell?.pci} (Band {pendingCell?.band}). The modem will only
              connect to this tower and may briefly disconnect during the
              switch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLock}>
              Lock Tower
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unlock confirmation dialog */}
      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock NR-SA Tower?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the NR-SA tower lock. The modem will be free to
              select any available tower and may briefly disconnect during the
              switch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnlock}>
              Remove Lock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default NRSALockingComponent;
