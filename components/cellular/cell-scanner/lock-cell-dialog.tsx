"use client";

import * as React from "react";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { authFetch } from "@/lib/auth-fetch";

import { TABLE } from "./shapes";

// =============================================================================
// LockCellDialog — "lock the modem to this row"
// =============================================================================
// Extracted from `scanner.tsx` and `neighbourcell/neighbour-scanner.tsx`, where
// it existed TWICE, byte for byte: the same dialog, the same POST, the same four
// toasts, the same `preventDefault` on the confirm action. Two copies of a
// mutation do not stay equal — the parent's copy grew an NR branch and the
// neighbour's did not, and nothing about the neighbour route said so.
//
// THE DIALOG OWNS THE WRITE, not just the confirmation. That is the whole reason
// this is worth extracting: a component that only asked the question and handed
// back a callback would have left both routes still holding their own identical
// `fetch`, payload builder and toast set, which is the duplication that actually
// cost something. The caller owns exactly one thing — which cell is being
// targeted — and clears it when the dialog closes.
//
// `AT+QNWLOCK` takes two different shapes for the two radios and the modem
// rejects the wrong one outright, so `kind` is a discriminator on the TARGET
// rather than a flag on the request. The neighbour route only ever reads LTE
// neighbours, so it only ever sends `lte`; the full scan branches per row.
// =============================================================================

/**
 * The cell to lock onto, in the vocabulary of the lock endpoint rather than of
 * either table's row type. Both routes map their own row into this.
 */
export interface LockCellTarget {
  /** Which `tower/lock.sh` payload shape this cell needs. */
  kind: "nr_sa" | "lte";
  /** Display only — the row's reported radio, e.g. `LTE` or `NR5G-SA`. */
  networkType: string;
  pci: number;
  /** EARFCN for LTE, NR-ARFCN for NR. One field because the endpoint takes one. */
  earfcn: number;
  /** Required by the NR payload; display-only for LTE, where it may be absent. */
  band?: number | null;
  /**
   * Subcarrier spacing, NR only. Null when the modem did not report one — the
   * common 30 kHz default is applied here rather than being fabricated upstream,
   * so there is one place to look when a lock lands on the wrong numerology.
   */
  scs?: number | null;
  provider?: string | null;
}

const NR_DEFAULT_SCS = 30;

export interface LockCellDialogProps {
  /** The staged cell, or null when the dialog is closed. */
  target: LockCellTarget | null;
  /** Called with `false` when the dialog should close. Clear your target here. */
  onOpenChange: (open: boolean) => void;
  /** Fired after the modem confirms the lock, for a route that wants to refresh. */
  onLocked?: (target: LockCellTarget) => void;
}

function buildLockBody(target: LockCellTarget): Record<string, unknown> {
  if (target.kind === "nr_sa") {
    return {
      type: "nr_sa",
      action: "lock",
      pci: target.pci,
      arfcn: target.earfcn,
      scs: target.scs ?? NR_DEFAULT_SCS,
      band: target.band,
    };
  }

  return {
    type: "lte",
    action: "lock",
    cells: [{ earfcn: target.earfcn, pci: target.pci }],
  };
}

export function LockCellDialog({
  target,
  onOpenChange,
  onLocked,
}: LockCellDialogProps) {
  const { t } = useTranslation("cellular");
  const [isLocking, setIsLocking] = React.useState(false);

  const confirmLock = React.useCallback(async () => {
    if (!target) return;
    setIsLocking(true);

    try {
      const res = await authFetch("/cgi-bin/quecmanager/tower/lock.sh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLockBody(target)),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.success) {
        toast.success(t("cell_scanner.toast.locked_title"), {
          description: t("cell_scanner.toast.locked_desc", {
            network: target.networkType,
            pci: target.pci,
            earfcn: target.earfcn,
          }),
        });
        onLocked?.(target);
      } else {
        toast.error(t("cell_scanner.toast.lock_failed_title"), {
          description:
            data.detail ||
            data.error ||
            t("cell_scanner.toast.lock_failed_unknown"),
        });
      }
    } catch {
      toast.error(t("cell_scanner.toast.lock_failed_title"), {
        description: t("cell_scanner.toast.lock_failed_network"),
      });
    } finally {
      setIsLocking(false);
      onOpenChange(false);
    }
  }, [target, onLocked, onOpenChange, t]);

  return (
    <AlertDialog
      open={target !== null}
      // A dismissal mid-write would leave the request in flight with nothing
      // reporting its result, so the dialog holds itself open until the POST
      // settles. The confirm button is already disabled; this closes the other
      // two doors (Escape and the scrim).
      onOpenChange={(open) => {
        if (!open && !isLocking) onOpenChange(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("cell_scanner.lock.title", { pci: target?.pci ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("cell_scanner.lock.description")}
          </AlertDialogDescription>
          {target ? (
            // Machine voice: every figure on this line is an identifier that
            // holds steady until something reconfigures it, which is exactly
            // the test `TABLE.IDENT` encodes.
            <p className={`${TABLE.IDENT} text-on-surface-variant`}>
              {/* Two literal keys rather than one key plus a hand-glued
                  ` · ${provider}` tail: the separator belongs to the sentence,
                  and a translator who reorders the run has to be able to move
                  it. */}
              {target.provider
                ? t("cell_scanner.lock.target_with_provider", {
                    network: target.networkType,
                    pci: target.pci,
                    earfcn: target.earfcn,
                    provider: target.provider,
                  })
                : t("cell_scanner.lock.target", {
                    network: target.networkType,
                    pci: target.pci,
                    earfcn: target.earfcn,
                  })}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLocking}>
            {t("cell_scanner.lock.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // The action closes the dialog by default, which would unmount
              // the pending state before the modem answers.
              event.preventDefault();
              void confirmLock();
            }}
            disabled={isLocking}
          >
            {isLocking ? (
              <>
                <MaterialSymbol
                  name="progress_activity"
                  size={16}
                  className="animate-spin motion-reduce:animate-none"
                />
                {t("cell_scanner.lock.locking")}
              </>
            ) : (
              t("cell_scanner.lock.confirm")
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default LockCellDialog;
