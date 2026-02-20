"use client";

import React, { useState, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Input } from "@/components/ui/input";
import { Loader2, Crosshair } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";

import type {
  TowerLockConfig,
  TowerModemState,
  NrSaLockCell,
} from "@/types/tower-locking";
import type { ModemStatus, NetworkType } from "@/types/modem-status";
import { SCS_OPTIONS } from "@/types/tower-locking";

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

/**
 * Extract numeric band from 3GPP band string.
 * e.g., "N41" → 41, "N78" → 78
 */
function extractBandNumber(band: string | null | undefined): number | null {
  if (!band) return null;
  const match = band.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

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

  // Confirmation dialog state
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [pendingCell, setPendingCell] = useState<NrSaLockCell | null>(null);

  // Sync form from config when data loads
  useEffect(() => {
    if (config?.nr_sa) {
      if (config.nr_sa.arfcn !== null) setArfcn(String(config.nr_sa.arfcn));
      if (config.nr_sa.pci !== null) setPci(String(config.nr_sa.pci));
      if (config.nr_sa.band !== null) setBand(String(config.nr_sa.band));
      if (config.nr_sa.scs !== null) setScs(String(config.nr_sa.scs));
    }
  }, [config?.nr_sa]);

  // Derive enabled state from modem state or config
  const isEnabled = modemState?.nr_locked ?? config?.nr_sa?.enabled ?? false;

  // NSA mode gating — NR-SA locking not available in NSA or LTE-only mode
  const isNsaMode = networkType === "5G-NSA";
  const isLteOnly = networkType === "LTE";
  const isCardDisabled = isNsaMode || isLteOnly;
  const isDisabled = isCardDisabled || isLocking || isWatcherRunning;

  const handleToggle = (checked: boolean) => {
    if (isWatcherRunning) {
      toast.warning("Failover check in progress", {
        description: "Please wait for the failover watcher to finish before toggling the lock.",
      });
      return;
    }
    if (checked) {
      const parsedArfcn = parseInt(arfcn, 10);
      const parsedPci = parseInt(pci, 10);
      const parsedBand = parseInt(band, 10);
      const parsedScs = parseInt(scs, 10);

      if (
        isNaN(parsedArfcn) ||
        isNaN(parsedPci) ||
        isNaN(parsedBand) ||
        isNaN(parsedScs)
      ) {
        toast.warning("Incomplete fields", {
          description:
            "All four fields (ARFCN, PCI, Band, SCS) are required to enable NR-SA locking.",
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
      await onLock(pendingCell);
    }
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    await onUnlock();
  };

  // "Use Current" — copy active NR PCell into form fields
  const handleUseCurrent = () => {
    const nrArfcn = modemData?.nr?.arfcn;
    const nrPci = modemData?.nr?.pci;
    const nrBandNum = extractBandNumber(modemData?.nr?.band);
    const nrScs = modemData?.nr?.scs;

    if (nrArfcn != null && nrPci != null) {
      setArfcn(String(nrArfcn));
      setPci(String(nrPci));
      if (nrBandNum != null) setBand(String(nrBandNum));
      if (nrScs != null) setScs(String(nrScs));
      toast.info("Populated from active NR PCell", {
        description: `ARFCN: ${nrArfcn}, PCI: ${nrPci}${nrBandNum ? `, Band: ${nrBandNum}` : ""}${nrScs ? `, SCS: ${nrScs} kHz` : ""}`,
      });
    } else {
      toast.warning("No active NR cell", {
        description: "NR PCell data is not available.",
      });
    }
  };

  const hasActiveNrCell =
    modemData?.nr?.arfcn != null && modemData?.nr?.pci != null;

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>NR-SA Tower Locking</CardTitle>
          <CardDescription>
            Manage NR-SA tower locking settings for your device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-48" />
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
      <Card
        className={`@container/card ${isCardDisabled ? "opacity-60" : ""}`}
      >
        <CardHeader>
          <CardTitle>NR-SA Tower Locking</CardTitle>
          <CardDescription>
            Manage NR-SA tower locking settings for your device.
            {isNsaMode && " Not compatible with NR5G-NSA mode."}
            {isLteOnly && " No NR connection available."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                <p className="font-semibold text-muted-foreground text-sm">
                  NR Tower Locking Enabled
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {isLocking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
            <form
              className="grid gap-4 mt-6"
              onSubmit={(e) => e.preventDefault()}
            >
              <div className="w-full">
                <FieldSet>
                  <FieldGroup>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <div className="flex items-center justify-between">
                          <FieldLabel htmlFor="nrarfcn1">NR ARFCN</FieldLabel>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={handleUseCurrent}
                            disabled={isDisabled || !hasActiveNrCell}
                          >
                            <Crosshair className="w-3 h-3 mr-1" />
                            Use Current
                          </Button>
                        </div>
                        <Input
                          id="nrarfcn1"
                          type="text"
                          placeholder="Enter NR ARFCN"
                          value={arfcn}
                          onChange={(e) => setArfcn(e.target.value)}
                          disabled={isDisabled}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="nrpci">NR PCI</FieldLabel>
                        <Input
                          id="nrpci"
                          type="text"
                          placeholder="Enter NR PCI"
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
                        <FieldLabel htmlFor="scs">SCS</FieldLabel>
                        <Select
                          value={scs}
                          onValueChange={setScs}
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
            </form>
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
              connect to this tower and may briefly disconnect during the switch.
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
              Unlock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default NRSALockingComponent;
