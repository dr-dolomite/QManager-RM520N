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
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { TbInfoCircleFilled } from "react-icons/tb";
import { Input } from "@/components/ui/input";
import { Loader2, Crosshair } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";

import type {
  TowerLockConfig,
  TowerModemState,
  LteLockCell,
} from "@/types/tower-locking";
import type { ModemStatus } from "@/types/modem-status";

interface LTELockingProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  isLocking: boolean;
  isWatcherRunning: boolean;
  onLock: (cells: LteLockCell[]) => Promise<boolean>;
  onUnlock: () => Promise<boolean>;
}

const LTELockingComponent = ({
  config,
  modemState,
  modemData,
  isLoading,
  isLocking,
  isWatcherRunning,
  onLock,
  onUnlock,
}: LTELockingProps) => {
  // Local form state for the 3 input pairs
  const [earfcn1, setEarfcn1] = useState("");
  const [pci1, setPci1] = useState("");
  const [earfcn2, setEarfcn2] = useState("");
  const [pci2, setPci2] = useState("");
  const [earfcn3, setEarfcn3] = useState("");
  const [pci3, setPci3] = useState("");

  // Confirmation dialog state
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [pendingCells, setPendingCells] = useState<LteLockCell[]>([]);

  // Sync form from config when data loads
  useEffect(() => {
    if (config?.lte?.cells) {
      const cells = config.lte.cells;
      if (cells[0]) {
        setEarfcn1(String(cells[0].earfcn));
        setPci1(String(cells[0].pci));
      }
      if (cells[1]) {
        setEarfcn2(String(cells[1].earfcn));
        setPci2(String(cells[1].pci));
      }
      if (cells[2]) {
        setEarfcn3(String(cells[2].earfcn));
        setPci3(String(cells[2].pci));
      }
    }
  }, [config?.lte?.cells]);

  // Derive enabled state from modem state (actual lock) or config
  const isEnabled = modemState?.lte_locked ?? config?.lte?.enabled ?? false;

  // Build cells array from form inputs
  const buildCells = (): LteLockCell[] => {
    const cells: LteLockCell[] = [];
    const e1 = parseInt(earfcn1, 10);
    const p1 = parseInt(pci1, 10);
    if (!isNaN(e1) && !isNaN(p1)) cells.push({ earfcn: e1, pci: p1 });

    const e2 = parseInt(earfcn2, 10);
    const p2 = parseInt(pci2, 10);
    if (!isNaN(e2) && !isNaN(p2)) cells.push({ earfcn: e2, pci: p2 });

    const e3 = parseInt(earfcn3, 10);
    const p3 = parseInt(pci3, 10);
    if (!isNaN(e3) && !isNaN(p3)) cells.push({ earfcn: e3, pci: p3 });

    return cells;
  };

  const handleToggle = (checked: boolean) => {
    if (isWatcherRunning) {
      toast.warning("Failover check in progress", {
        description:
          "Please wait for the failover watcher to finish before toggling the lock.",
      });
      return;
    }
    if (checked) {
      const cells = buildCells();
      if (cells.length === 0) {
        toast.warning("No cell targets", {
          description: "Enter at least one EARFCN + PCI pair before enabling.",
        });
        return;
      }
      // Show confirmation dialog
      setPendingCells(cells);
      setShowLockDialog(true);
    } else {
      setShowUnlockDialog(true);
    }
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    await onLock(pendingCells);
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    await onUnlock();
  };

  // "Use Current" — copy active PCell into slot 1
  const handleUseCurrent = () => {
    const earfcn = modemData?.lte?.earfcn;
    const pci = modemData?.lte?.pci;
    if (earfcn != null && pci != null) {
      setEarfcn1(String(earfcn));
      setPci1(String(pci));
      toast.info("Populated from active LTE PCell", {
        description: `EARFCN: ${earfcn}, PCI: ${pci}`,
      });
    } else {
      toast.warning("No active LTE cell", {
        description: "LTE PCell data is not available.",
      });
    }
  };

  const hasActiveLteCell =
    modemData?.lte?.earfcn != null && modemData?.lte?.pci != null;

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>LTE Tower Locking</CardTitle>
          <CardDescription>
            Manage LTE tower locking settings for your device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-44" />
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
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-10" />
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
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>LTE Tower Locking</CardTitle>
          <CardDescription>
            Manage LTE tower locking settings for your device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <TbInfoCircleFilled className="w-5 h-5 text-blue-500" />
                <p className="font-semibold text-muted-foreground text-sm">
                  LTE Tower Locking Enabled
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {isLocking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
                <Switch
                  id="lte-tower-locking"
                  checked={isEnabled}
                  onCheckedChange={handleToggle}
                  disabled={isLocking || isWatcherRunning}
                />
                <Label htmlFor="lte-tower-locking">
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
                          <FieldLabel htmlFor="earfcn1">E/ARFCN</FieldLabel>
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={handleUseCurrent}
                            disabled={isLocking || !hasActiveLteCell}
                          >
                            Use Current
                          </Button>
                        </div>
                        <Input
                          id="earfcn1"
                          type="text"
                          placeholder="Enter E/ARFCN"
                          value={earfcn1}
                          onChange={(e) => setEarfcn1(e.target.value)}
                          disabled={isLocking}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="pci1">PCI</FieldLabel>
                        <Input
                          id="pci1"
                          type="text"
                          placeholder="Enter PCI"
                          value={pci1}
                          onChange={(e) => setPci1(e.target.value)}
                          disabled={isLocking}
                        />
                      </Field>
                    </div>
                    {/* Optional locking entry 2 */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="earfcn2">E/ARFCN 2</FieldLabel>
                        <Input
                          id="earfcn2"
                          type="text"
                          placeholder="Enter E/ARFCN 2"
                          value={earfcn2}
                          onChange={(e) => setEarfcn2(e.target.value)}
                          disabled={isLocking}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="pci2">PCI 2</FieldLabel>
                        <Input
                          id="pci2"
                          type="text"
                          placeholder="Enter PCI 2"
                          value={pci2}
                          onChange={(e) => setPci2(e.target.value)}
                          disabled={isLocking}
                        />
                      </Field>
                    </div>
                    {/* Optional locking entry 3 */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="earfcn3">E/ARFCN 3</FieldLabel>
                        <Input
                          id="earfcn3"
                          type="text"
                          placeholder="Enter E/ARFCN 3"
                          value={earfcn3}
                          onChange={(e) => setEarfcn3(e.target.value)}
                          disabled={isLocking}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="pci3">PCI 3</FieldLabel>
                        <Input
                          id="pci3"
                          type="text"
                          placeholder="Enter PCI 3"
                          value={pci3}
                          onChange={(e) => setPci3(e.target.value)}
                          disabled={isLocking}
                        />
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
            <AlertDialogTitle>Lock to LTE Tower?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock your modem to{" "}
              {pendingCells.length === 1
                ? `EARFCN ${pendingCells[0]?.earfcn}, PCI ${pendingCells[0]?.pci}`
                : `${pendingCells.length} cell targets`}
              . The modem will only connect to{" "}
              {pendingCells.length === 1 ? "this tower" : "these towers"} and
              may briefly disconnect during the switch.
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
            <AlertDialogTitle>Unlock LTE Tower?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the LTE tower lock. The modem will be free to
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

export default LTELockingComponent;
