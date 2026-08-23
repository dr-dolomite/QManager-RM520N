"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ModemStatus } from "@/types/modem-status";
import type { FreqLockModemState } from "@/types/frequency-locking";

import { APPLY_BAR, PILL_ACTION_PLAIN, SKELETON_SHAPE } from "./shapes";

// =============================================================================
// The apply bar
// =============================================================================
// One bar owning the reconnect cost, the standing risk, and Clear all.
//
// WHY THIS RENDERS READ-BACK AND NEVER THE AT COMMAND. The design comp printed
// `AT+QNWCFG="lte_freq_lock",1,1300,3350` here in a mono face, which reads as
// "this is literally what the device was told". Every token of it was wrong:
// the key is `lte_earfcn_lock` (`lte_freq_lock` does not exist on this modem
// and returns ERROR), the count must equal the entry count, and `lock.sh:93`
// joins the values with COLONS. It was wrong precisely BECAUSE it was
// hand-written in markup — a literal in JSX cannot track `lock.sh`.
//
// The substitution is not a downgrade. An echoed command states what QManager
// TRIED; a read-back states what the modem DID, and on this page those can
// disagree in two ways the command string structurally cannot express:
//
//   - an entry the modem rejected, so the list on screen and the list in force
//     are different;
//   - a tower lock applied from the sibling page, which SILENTLY replaces a
//     frequency lock (`tower/lock.sh` has no reciprocal guard). The command we
//     sent still looks correct; the lock is simply gone.
//
// The read-back is the only thing on this page that can show either.
// =============================================================================

export interface FreqApplyBarProps {
  modemState: FreqLockModemState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  /** True while either leg is mid-write. */
  isBusy: boolean;
  towerLockActive: boolean;
  /**
   * Whether `towerLockActive` is a READING or the hook's fail-safe default.
   *
   * This bar and the hero verdict are the only two surfaces that explain the
   * block, so they are the only two that take this. Everything else on the page
   * keeps a plain boolean gate.
   */
  towerLockStateKnown: boolean;
  onClearAll: () => void;
}

export function FreqApplyBar({
  modemState,
  modemData,
  isLoading,
  isBusy,
  towerLockActive,
  towerLockStateKnown,
  onClearAll,
}: FreqApplyBarProps) {
  const { t } = useTranslation("cellular");

  const isLocked = Boolean(modemState?.lte_locked || modemState?.nr_locked);

  /**
   * The modem's own answer, in the page's vocabulary.
   *
   * Built from `status.sh`'s entry arrays — the values the modem read back —
   * and cross-referenced against the live carrier list so the user can see at a
   * glance whether the channel actually in use is one of the allowed ones.
   */
  const readback = React.useMemo(() => {
    const parts: string[] = [];
    // Defaulted INSIDE the memo: a `?? []` in the component body allocates a new
    // array every render, which would make this memo's deps change every time
    // and quietly turn it into a no-op.
    const lteEntries = modemState?.lte_entries ?? [];
    const nrEntries = modemState?.nr_entries ?? [];

    if (modemState?.lte_locked && lteEntries.length > 0) {
      parts.push(
        t("frequency_locking.apply.readback_lte", {
          channels: lteEntries.map((e) => e.earfcn).join(", "),
        }),
      );
    }
    if (modemState?.nr_locked && nrEntries.length > 0) {
      parts.push(
        t("frequency_locking.apply.readback_nr", {
          channels: nrEntries.map((e) => e.arfcn).join(", "),
        }),
      );
    }

    // Which channel is the radio actually on? Sourced from the poller's live
    // carrier list, not from the lock state, so it stays true even when the two
    // have drifted apart.
    const serving = modemData?.network?.carrier_components?.find(
      (c) => c.type === "PCC",
    )?.earfcn;
    if (parts.length > 0 && serving != null) {
      parts.push(
        t("frequency_locking.apply.readback_serving", { channel: serving }),
      );
    }

    return parts.length > 0 ? parts.join(" · ") : null;
  }, [modemState, modemData, t]);

  if (isLoading) {
    return (
      <div className={APPLY_BAR.ROOT}>
        <Skeleton className="size-5 rounded-pill" />
        <div className={APPLY_BAR.COPY}>
          <Skeleton className="h-4 w-52 rounded-inline" />
          <Skeleton className="mt-1 h-3 w-72 rounded-inline" />
        </div>
        <div className={APPLY_BAR.ACTIONS}>
          <Skeleton className={SKELETON_SHAPE.ACTION} />
        </div>
      </div>
    );
  }

  // ---- Applying -------------------------------------------------------------
  if (isBusy) {
    return (
      <div className={APPLY_BAR.ROOT}>
        <MaterialSymbol
          name="progress_activity"
          size={20}
          className="text-primary animate-spin"
        />
        <div className={APPLY_BAR.COPY}>
          <span className={APPLY_BAR.TITLE}>
            {t("frequency_locking.apply.applying_title")}
          </span>
          <span className={APPLY_BAR.NOTE}>
            {t("frequency_locking.progress.wait_note")}
          </span>
        </div>
      </div>
    );
  }

  // ---- Blocked by a tower lock, or by not knowing ---------------------------
  // Two different facts, one consequence. The write is refused either way, but
  // the bar may only claim a tower lock is active when `status.sh` actually
  // said so. `visibility_off` rather than `block` for the unread case, so the
  // two never share a mark in the same slot.
  if (towerLockActive) {
    const blockedByUnknown = !towerLockStateKnown;
    return (
      <div className={APPLY_BAR.ROOT}>
        <MaterialSymbol
          name={blockedByUnknown ? "visibility_off" : "block"}
          size={20}
          className="text-on-surface-variant"
        />
        <div className={APPLY_BAR.COPY}>
          <span className={APPLY_BAR.TITLE}>
            {blockedByUnknown
              ? t("frequency_locking.apply.blocked_unknown_title")
              : t("frequency_locking.apply.blocked_title")}
          </span>
          <span className={APPLY_BAR.READBACK}>
            {blockedByUnknown
              ? t("frequency_locking.apply.blocked_unknown_readback")
              : t("frequency_locking.apply.blocked_readback")}
          </span>
        </div>
      </div>
    );
  }

  // ---- Locked, or free ------------------------------------------------------
  return (
    <div className={APPLY_BAR.ROOT}>
      <MaterialSymbol
        name={isLocked ? "lock" : "warning"}
        size={20}
        filled={isLocked}
        className={cn(
          isLocked ? "text-warning-on-surface" : "text-on-surface-variant",
        )}
      />

      <div className={APPLY_BAR.COPY}>
        {isLocked ? (
          <>
            <span className={APPLY_BAR.TITLE}>
              {t("frequency_locking.apply.live_title")}
            </span>
            <span className={APPLY_BAR.READBACK}>
              {readback ?? t("frequency_locking.apply.readback_none")}
            </span>
            {/* The standing risk, stated once a lock is actually in force.
                Verified live: no systemd unit, no process, no config file. */}
            <span className={cn(APPLY_BAR.NOTE, "mt-1")}>
              {t("frequency_locking.apply.no_recovery")}
            </span>
          </>
        ) : (
          <>
            <span className={APPLY_BAR.TITLE}>
              {t("frequency_locking.apply.readback_none")}
            </span>
            {/* No number here on purpose. The comp said "about five seconds";
                that figure belongs to `AT+QNWLOCK`, a different command family,
                and was never measured for `AT+QNWCFG`. */}
            <span className={APPLY_BAR.NOTE}>
              {t("frequency_locking.apply.disclaimer")}
            </span>
          </>
        )}
      </div>

      <div className={APPLY_BAR.ACTIONS}>
        <Button
          type="button"
          variant="outline"
          className={PILL_ACTION_PLAIN}
          onClick={onClearAll}
          disabled={!isLocked}
        >
          {t("frequency_locking.actions.clear_all")}
        </Button>
      </div>
    </div>
  );
}

export default FreqApplyBar;
