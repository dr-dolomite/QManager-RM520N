"use client";

import React, { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LockIcon, LockOpenIcon, RotateCcwIcon, ShieldIcon } from "lucide-react";
import { toast } from "sonner";
import { formatBandName, type BandCategory } from "@/types/band-locking";

// =============================================================================
// BandCardsComponent — Per-Category Band Checkbox Grid + Lock/Unlock Actions
// =============================================================================
// One instance per band category (LTE, NSA NR5G, SA NR5G).
// All data flows in via props from BandLockingComponent (coordinator).
//
// Local state: checkbox selection (initialized from currentLockedBands).
// Parent owns the CGI communication — this component only calls onLock/onUnlockAll.
// =============================================================================

interface BandCardsProps {
  title: string;
  description: string;
  /** Which band category this card manages */
  bandCategory: BandCategory;
  /** All hardware-supported bands for this category (from policy_band, sorted) */
  supportedBands: number[];
  /** Currently locked/configured bands (from ue_capability_band, sorted) */
  currentLockedBands: number[];
  /** Lock selected bands — returns success boolean */
  onLock: (bands: number[]) => Promise<boolean>;
  /** Unlock all bands (reset to full supported list) — returns success boolean */
  onUnlockAll: () => Promise<boolean>;
  /** True while any lock/unlock operation is in flight (shared across all cards) */
  isLocking: boolean;
  /** True while initial data is loading */
  isLoading: boolean;
  /** Error from the hook (shared) */
  error: string | null;
  /** True when a Connection Scenario controls bands — disables all interactions */
  disabled?: boolean;
}

const BandCardsComponent = ({
  title,
  description,
  bandCategory,
  supportedBands,
  currentLockedBands,
  onLock,
  onUnlockAll,
  isLocking,
  isLoading,
  error,
  disabled = false,
}: BandCardsProps) => {
  // --- Local checkbox state (number set for O(1) lookup) --------------------
  const [checkedBands, setCheckedBands] = useState<Set<number>>(
    () => new Set(currentLockedBands),
  );

  // Sync local state when currentLockedBands prop changes (initial load or after lock).
  // "Store previous value in state" pattern per React docs — no refs, no effects.
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevLockedKey, setPrevLockedKey] = useState("");
  const lockedKey = currentLockedBands.join(":");
  if (prevLockedKey !== lockedKey && currentLockedBands.length > 0) {
    setPrevLockedKey(lockedKey);
    setCheckedBands(new Set(currentLockedBands));
  }

  // --- Derived state --------------------------------------------------------
  const isAllUnlocked = useMemo(() => {
    if (supportedBands.length === 0 || currentLockedBands.length === 0)
      return false;
    return (
      currentLockedBands.length === supportedBands.length &&
      currentLockedBands.every((b) => supportedBands.includes(b))
    );
  }, [supportedBands, currentLockedBands]);

  // Whether the user's selection differs from what's currently on the modem
  const hasChanges = useMemo(() => {
    if (currentLockedBands.length !== checkedBands.size) return true;
    return currentLockedBands.some((b) => !checkedBands.has(b));
  }, [currentLockedBands, checkedBands]);

  const noneSelected = checkedBands.size === 0;

  // --- Handlers -------------------------------------------------------------
  const handleCheckboxChange = (band: number) => {
    setCheckedBands((prev) => {
      const next = new Set(prev);
      if (next.has(band)) {
        next.delete(band);
      } else {
        next.add(band);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setCheckedBands(new Set(supportedBands));
  };

  const handleSelectNone = () => {
    setCheckedBands(new Set());
  };

  const handleLock = async () => {
    const bands = [...checkedBands].sort((a, b) => a - b);
    if (bands.length === 0) {
      toast.error("Select at least one band to lock");
      return;
    }

    const success = await onLock(bands);
    if (success) {
      toast.success(
        `${title.replace(" Locking", "")} bands locked successfully`,
      );
    } else {
      toast.error(error || "Failed to apply band lock");
    }
  };

  const handleUnlockAll = async () => {
    const success = await onUnlockAll();
    if (success) {
      toast.success(`${title.replace(" Locking", "")} bands unlocked`);
    } else {
      toast.error(error || "Failed to unlock bands");
    }
  };

  // --- Loading skeleton -----------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid lg:grid-cols-8 md:grid-cols-6 sm:grid-cols-4 grid-cols-3 grid-flow-row gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div className="flex items-center space-x-2" key={i}>
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <Skeleton className="h-9 w-40" />
        </CardFooter>
      </Card>
    );
  }

  // --- Empty state (no supported bands for this category) -------------------
  if (supportedBands.length === 0) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No supported bands reported by the modem for this category.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Combined disable flag: scenario-controlled OR mid-lock
  const isDisabled = disabled || isLocking;

  return (
    <Card className={`@container/card${disabled ? " opacity-60" : ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {disabled ? (
            <Badge
              variant="outline"
              className="bg-blue-500/20 text-blue-500 border-blue-300/50"
            >
              <ShieldIcon className="mr-1 h-3 w-3" />
              Scenario Controlled
            </Badge>
          ) : isAllUnlocked ? (
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-500 border-emerald-300/50"
            >
              <LockOpenIcon className="mr-1 h-3 w-3" />
              All Unlocked
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="bg-amber-500/20 text-amber-500 border-amber-300/50"
            >
              <LockIcon className="mr-1 h-3 w-3" />
              {currentLockedBands.length} / {supportedBands.length} Bands
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Band checkbox grid */}
        <div className="grid lg:grid-cols-8 md:grid-cols-6 sm:grid-cols-4 grid-cols-3 grid-flow-row gap-4 mt-2">
          {supportedBands.map((band) => (
            <div className="flex items-center space-x-2" key={band}>
              <Checkbox
                id={`${bandCategory}-${band}`}
                checked={checkedBands.has(band)}
                onCheckedChange={() => handleCheckboxChange(band)}
                disabled={isDisabled}
                className="hover:cursor-pointer"
              />
              <Label
                htmlFor={`${bandCategory}-${band}`}
                className={disabled ? "cursor-default" : "cursor-pointer"}
              >
                {formatBandName(bandCategory, band)}
              </Label>
            </div>
          ))}
        </div>
      </CardContent>

      <CardFooter className="flex flex-row items-center justify-between mt-4">
        <div className="flex items-center gap-x-2">
          <Button
            onClick={handleLock}
            disabled={isDisabled || noneSelected || !hasChanges}
          >
            {isLocking ? "Applying…" : "Lock Selected Bands"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleUnlockAll}
            disabled={isDisabled || isAllUnlocked}
            title="Unlock all bands (reset)"
          >
            <RotateCcwIcon />
          </Button>
        </div>
        {/* Quick actions row */}
        <div className="flex items-center gap-x-2">
          <Button
            variant="outline"
            onClick={handleSelectAll}
            disabled={isDisabled}
          >
            Select All
          </Button>
          <Button
            variant="outline"
            onClick={handleSelectNone}
            disabled={isDisabled}
          >
            Clear
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

export default BandCardsComponent;
