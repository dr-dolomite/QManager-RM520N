"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CARD_FOOT,
  CARD_FOOT_ACTIONS,
  CardFoot,
} from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { FreqLockResult } from "@/hooks/use-frequency-locking";
import { RevealButton } from "@/components/ui/reveal-button";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { findAllMatchingLTEBands, type LTEBandEntry } from "@/lib/earfcn";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type { FreqLockModemState } from "@/types/frequency-locking";
import type { ModemStatus } from "@/types/modem-status";

import { BandMatchDisplay } from "./band-match-display";
import { lockFailureMessage } from "./lock-result";
import {
  CARD_PAD,
  CARD_SHELL,
  NOTICE,
  NOTICE_TONE,
  PILL_USE_CURRENT,
  SKELETON_SHAPE,
  SLOT,
  SLOT_INPUT,
  channelFrequencyLabel,
  lockPosture,
} from "./shapes";

// =============================================================================
// LteFreqCard — the LTE leg of frequency locking, as one peer card
// =============================================================================
// Replaces `lte-freq-locking.tsx`. Behaviour is the incumbent's minus its bugs;
// every className comes from `shapes.ts` and every string from the
// `frequency_locking` i18n subtree.
//
// -----------------------------------------------------------------------------
// FOUR THINGS THAT ARE DELIBERATELY NOT THE INCUMBENT'S
// -----------------------------------------------------------------------------
//
// 1. NO ENABLE SWITCH. The incumbent's `Switch` was `checked` from the modem
//    read-back while its ON action wrote whatever sat UNSAVED in the fields
//    below it — a state display and a write in one control. A switch promises
//    instant, cheap and reversible; `AT+QNWCFG="lte_earfcn_lock"` bounces the
//    link on the device serving this page and has no failover watcher behind it.
//    The footer button is the only way to write. `tower-locking.md:541` records
//    the same decision for the sibling route: do not reintroduce it.
//
// 2. THE CARD DOES NOT OWN THE DRAFT. `draft` / `onDraftChange` are the shell's,
//    because the live strip above also pushes channels into this list. Two
//    owners would need an effect-based back-channel; one owner needs nothing.
//    The card therefore does NOT seed from `modemState` either — the shell does,
//    including CLEARING slot 2 when the modem reports a single EARFCN, which the
//    incumbent never did (`lte-freq-locking.tsx:77-84` set slot 2 and could
//    never unset it, so a stale second channel silently rejoined the next lock).
//
// 3. "USE CURRENT" FILLS BOTH SLOTS. The incumbent copied `lte.earfcn` into slot
//    1 only, which throws away the aggregated carrier the user is actually on.
//    This reads `network.carrier_components[]`, PCC first, and fills up to both
//    slots — the lock accepts two, and an aggregating modem has two worth
//    keeping.
//
// 4. "USE CURRENT" IS DISABLED WITH ITS REASON ON IT. The incumbent left the
//    button live with nothing to copy and fired a toast AFTER the click to say
//    nothing happened. A control that cannot act says so before it is pressed.
//    It also stays LIVE while a tower lock blocks Apply: prefilling is how a
//    user captures the channel they already validated in order to migrate to the
//    looser lock. Only the writes are gated — never a blanket opacity wash over
//    the card, which would grey the one control that still works.
// =============================================================================

/** `AT+QNWCFG="lte_earfcn_lock"` accepts 1-2 EARFCNs; `lock.sh:71` rejects more. */
const SLOT_COUNT = 2;

/**
 * Digits only, deliberately strict.
 *
 * `parseInt("12abc")` is 12, which would silently lock the radio to a channel
 * the user did not type. A rejected string surfaces `error.invalid_channel`
 * inline instead.
 */
function parseChannel(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isNaN(value) ? null : value;
}

/** Order-insensitive comparison key. Two channels are a SET, not a sequence. */
function channelKey(channels: readonly number[]): string {
  return [...channels].sort((a, b) => a - b).join("|");
}

export interface LteFreqCardProps {
  /** Always length `SLOT_COUNT`; "" is an empty slot. Owned by the shell. */
  draft: string[];
  onDraftChange: (next: string[]) => void;
  modemState: FreqLockModemState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  isLocking: boolean;
  towerLockActive: boolean;
  /**
   * False when the tower-lock probe FAILED. Distinct from `towerLockActive`:
   * that says "a tower lock is holding this leg", this says "nobody could find
   * out". `frequency/lock.sh` refuses the write in BOTH cases, so both have to
   * block the Lock action up front. See `FreqLockModemState`.
   */
  towerLockReadOk: boolean;
  onLock: (earfcns: number[]) => Promise<FreqLockResult>;
  onUnlock: () => Promise<FreqLockResult>;
}

export function LteFreqCard({
  draft,
  onDraftChange,
  modemState,
  modemData,
  isLoading,
  isLocking,
  towerLockActive,
  towerLockReadOk,
  onLock,
  onUnlock,
}: LteFreqCardProps): React.JSX.Element {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [showUnsupportedDialog, setShowUnsupportedDialog] = useState(false);
  const [pendingChannels, setPendingChannels] = useState<number[]>([]);

  // --- Draft, normalised -----------------------------------------------------
  // The shell owns the array; this card only guarantees it renders exactly two
  // slots however short the incoming array is.
  const slots = useMemo(
    () => Array.from({ length: SLOT_COUNT }, (_, index) => draft[index] ?? ""),
    [draft],
  );

  const setSlot = (index: number, value: string) => {
    const next = [...slots];
    next[index] = value;
    onDraftChange(next);
  };

  // --- Derived ---------------------------------------------------------------

  /** Deduped, because two identical EARFCNs are one channel with a wasted slot. */
  const stagedChannels = useMemo<number[]>(() => {
    const out: number[] = [];
    for (const raw of slots) {
      const channel = parseChannel(raw);
      if (channel !== null && !out.includes(channel)) out.push(channel);
    }
    return out;
  }, [slots]);

  const matchedPerSlot = useMemo<LTEBandEntry[][]>(
    () =>
      slots.map((raw) => {
        const channel = parseChannel(raw);
        return channel === null ? [] : findAllMatchingLTEBands(channel);
      }),
    [slots],
  );

  /** `device.supported_lte_bands` is a colon-separated string, e.g. "1:3:7:20". */
  const supportedBands = useMemo<number[]>(() => {
    const raw = modemData?.device?.supported_lte_bands;
    if (!raw) return [];
    return raw
      .split(":")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((value) => !Number.isNaN(value));
  }, [modemData?.device?.supported_lte_bands]);

  /**
   * The channels the MODEM reports holding, read only while it also reports the
   * leg as locked — `lte_entries` can outlive a release, and a stale list would
   * make `hasChanges` claim there is nothing left to write.
   */
  const lockedChannels = useMemo<number[]>(
    () =>
      modemState?.lte_locked
        ? modemState.lte_entries.map((entry) => entry.earfcn)
        : [],
    [modemState],
  );

  const posture = lockPosture(
    modemState ? { locked: modemState.lte_locked } : null,
    towerLockActive,
  );

  /** LTE channels the radio is on right now, for the row dots and outlines. */
  const onAirChannels = useMemo<number[]>(() => {
    const carriers = modemData?.network?.carrier_components ?? [];
    const out = carriers
      .filter((c) => c.technology === "LTE" && c.earfcn != null)
      .map((c) => c.earfcn as number);
    const serving = modemData?.lte?.earfcn;
    if (out.length === 0 && serving != null) out.push(serving);
    return out;
  }, [modemData]);

  /** A channel the modem holds locked while the radio is camped elsewhere. */
  const hasUnusedLock = slots.some((raw) => {
    const channel = parseChannel(raw);
    return (
      channel !== null &&
      lockedChannels.includes(channel) &&
      !onAirChannels.includes(channel)
    );
  });

  /**
   * Order-insensitive: the slots are a SET of allowed channels, so swapping them
   * is not a change worth a link bounce. Re-sending an identical list still runs
   * the AT write and still drops the connection for a guaranteed no-op.
   */
  const hasChanges = useMemo(
    () => channelKey(stagedChannels) !== channelKey(lockedChannels),
    [stagedChannels, lockedChannels],
  );

  /**
   * THE REASON THE LOCK ACTION IS NOT TAKEABLE, OR `null`.
   *
   * Two backend refusals, keyed off the identifiers `frequency/lock.sh` emits
   * rather than off its `detail` sentence — that text is hardcoded English in a
   * shell script and can never be translated:
   *
   *   `tower_lock_active`  — a tower lock holds this leg (`lock.sh:70`/`:181`)
   *   `tower_lock_unknown` — the tower-lock read failed, so the write is
   *                          refused rather than attempted (`:81`/`:190`)
   *
   * BOTH USED TO LEAVE THE BUTTON LIVE IN THE SECOND CASE. The user filled the
   * form, pressed Lock, waited out an AT round-trip and was refused — the exact
   * anti-pattern `SaveButton.blockedReason` exists to remove. `blockedReason`
   * blocks with `aria-disabled` rather than `disabled`, so the reason stays
   * reachable by hover AND by keyboard and rides along in the accessible name.
   */
  // Unread outranks active: the fail-safe default reports `towerLockActive`
  // true when nothing was read, and copy must not claim a lock nobody saw.
  const lockBlockedReason = !towerLockReadOk
    ? t("frequency_locking.blocked.tower_lock_unknown")
    : towerLockActive
      ? t("frequency_locking.blocked.tower_lock_active")
      : null;

  /** The channels the radio is on right now, PCC first, capped at the slot count. */
  const currentChannels = useMemo<number[]>(() => {
    const carriers = modemData?.network?.carrier_components ?? [];
    const lte = carriers.filter(
      (carrier) => carrier.technology === "LTE" && carrier.earfcn != null,
    );
    if (lte.length > 0) {
      const ordered = [...lte].sort((a, b) => {
        if (a.type === b.type) return 0;
        return a.type === "PCC" ? -1 : 1;
      });
      const out: number[] = [];
      for (const carrier of ordered) {
        const channel = carrier.earfcn as number;
        if (!out.includes(channel)) out.push(channel);
        if (out.length === SLOT_COUNT) break;
      }
      return out;
    }
    // No carrier-aggregation list: the serving channel is all there is, and it
    // fills slot 1 only.
    const serving = modemData?.lte?.earfcn;
    return serving != null ? [serving] : [];
  }, [modemData]);

  const canUseCurrent = currentChannels.length > 0;
  const hasAnyValue = slots.some((raw) => raw.trim() !== "");
  const hasInvalidSlot = slots.some(
    (raw) => raw.trim() !== "" && parseChannel(raw) === null,
  );

  /**
   * Does any matched band appear in the modem's supported list?
   *
   * `lock.sh:10` warns that locking to an unsupported band may CRASH-DUMP the
   * modem, and frequency locking has no failover watcher to bring it back. An
   * empty supported list means the modem never reported its bands, so there is
   * nothing to contradict — the stern dialog is withheld rather than guessed.
   */
  const anySupported = useMemo(() => {
    const matched = matchedPerSlot.flat();
    if (matched.length === 0) return true;
    return matched.some((band) => supportedBands.includes(band.band));
  }, [matchedPerSlot, supportedBands]);

  // --- Handlers --------------------------------------------------------------

  const handleUseCurrent = () => {
    if (!canUseCurrent) return;
    const next = [...slots];
    currentChannels.forEach((channel, index) => {
      next[index] = String(channel);
    });
    onDraftChange(next);
    // No toast: a draft-only edit is confirmed by the field it filled.
  };

  const requestLock = () => {
    if (stagedChannels.length === 0) {
      toast.warning(t("frequency_locking.toast.no_channels_title"), {
        description: t("frequency_locking.toast.no_channels_body"),
      });
      return;
    }
    setPendingChannels(stagedChannels);
    if (!anySupported && supportedBands.length > 0) {
      setShowUnsupportedDialog(true);
    } else {
      setShowLockDialog(true);
    }
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    setShowUnsupportedDialog(false);
    const result = await onLock(pendingChannels);
    if (result.ok) {
      markSaved();
      toast.success(t("frequency_locking.toast.lte_locked"));
    } else {
      toast.error(
        lockFailureMessage(
          t,
          result,
          t("frequency_locking.toast.lte_lock_failed"),
        ),
      );
    }
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    const result = await onUnlock();
    if (result.ok) {
      toast.success(t("frequency_locking.toast.lte_cleared"));
    } else {
      toast.error(
        lockFailureMessage(
          t,
          result,
          t("frequency_locking.toast.lte_clear_failed"),
        ),
      );
    }
  };

  const clearFields = () =>
    onDraftChange(Array.from({ length: SLOT_COUNT }, () => ""));

  // One write at a time, whichever the state calls for: Clear while the lock the
  // modem holds is what is staged, Apply when there is none or the fields now
  // differ from it. An unreadable lock state shows both: Clear is harmless when
  // nothing is locked, and the way out when something is.
  const lockedAsSaved = posture === "locked" && !hasChanges;
  // Locked with an empty draft: Clear is the only action left.
  const showUnlock =
    posture === "unknown" ||
    lockedAsSaved ||
    (posture === "locked" && stagedChannels.length === 0);
  const showApply = !lockedAsSaved;

  // --- Loading ---------------------------------------------------------------
  // Every measurement comes from SKELETON_SHAPE, so the placeholder mirrors the
  // loaded geometry by import rather than by estimate.
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className={SKELETON_SHAPE.TITLE} />
            <Skeleton className={SKELETON_SHAPE.DESC} />
          </div>
        </CardHeader>
        <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
          <div className={SLOT.LIST}>
            {Array.from({ length: SLOT_COUNT }).map((_, index) => (
              <Skeleton key={index} className={SKELETON_SHAPE.SLOT_ROW} />
            ))}
          </div>
        </CardContent>
        <div className={`${CARD_PAD} ${CARD_FOOT}`}>
          <div className={CARD_FOOT_ACTIONS}>
            <Skeleton className={SKELETON_SHAPE.ACTION} />
            <Skeleton className={SKELETON_SHAPE.ACTION} />
          </div>
        </div>
      </Card>
    );
  }

  // --- Loaded ----------------------------------------------------------------
  return (
    <>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="truncate text-lg">
              {t("frequency_locking.legs.lte.title")}
            </CardTitle>
            <CardDescription className="text-pretty">
              {t("frequency_locking.legs.lte.description")}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className={`${CARD_PAD} flex flex-1 flex-col gap-4`}>
          {/* --- Blocked ----------------------------------------------------
              Neutral, not destructive: nothing failed. The user set a tower lock
              deliberately, and `frequency/lock.sh:60` is OUR refusal, not the
              modem's. Only the writes are disabled below — never the card. */}
          {!towerLockReadOk ? (
            /* Warning, not neutral: this is not a rule the user set, it is a
               question nobody managed to ask the modem — and the write is
               refused until it can be. */
            <div className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.root}`}>
              <MaterialSymbol
                name={NOTICE_TONE.warning.glyph}
                size={16}
                filled={NOTICE_TONE.warning.filled}
                className="flex-none"
              />
              <span className={NOTICE.TEXT}>
                {t("frequency_locking.blocked.tower_lock_unknown")}
              </span>
            </div>
          ) : towerLockActive ? (
            <div className={`${NOTICE.ROOT} ${NOTICE_TONE.neutral.root}`}>
              <MaterialSymbol
                name={NOTICE_TONE.neutral.glyph}
                size={16}
                filled={NOTICE_TONE.neutral.filled}
                className="flex-none"
              />
              <span className={NOTICE.TEXT}>
                {t("frequency_locking.card.blocked_body")}
              </span>
            </div>
          ) : null}

          {/* --- Slots -------------------------------------------------------
              NO EMPTY STATE HERE, deliberately. An empty state explains a
              container that has no items; this container always has exactly
              two, because `lte_earfcn_lock` takes at most two EARFCNs and both
              rows render unconditionally. An empty block above them was a third
              telling of what the field placeholder and slot 2's "Optional" hint
              already say, and it pushed the actual controls down the card. The
              NR card DOES have one, because its list is genuinely variable
              length and can hold nothing at all. */}
          <motion.div
            className={SLOT.LIST}
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {slots.map((raw, index) => {
              const filled = raw.trim() !== "";
              const channel = parseChannel(raw);
              const invalid = filled && channel === null;
              const frequency = channelFrequencyLabel(channel, "LTE");
              const inputId = `lte-freq-slot-${index}`;
              const isOptional = index === SLOT_COUNT - 1;
              const onAir = channel !== null && onAirChannels.includes(channel);
              const unused =
                channel !== null && !onAir && lockedChannels.includes(channel);

              return (
                <motion.div
                  key={index}
                  variants={staggerRowItem}
                  className={
                    isOptional && !filled
                      ? SLOT.ROW_EMPTY
                      : `${SLOT.ROW} ${unused ? SLOT.UNUSED : ""}`
                  }
                >
                  <span className={SLOT.INDEX_ROW}>
                    <span className={SLOT.DOT_SLOT} aria-hidden="true">
                      {onAir ? (
                        <>
                          <span className={SLOT.DOT_PING} />
                          <span className={`relative ${SLOT.DOT}`} />
                        </>
                      ) : null}
                    </span>
                    <Label htmlFor={inputId} className={SLOT.INDEX}>
                      {t("frequency_locking.slots.slot", { index: index + 1 })}
                      {onAir ? (
                        <span className="sr-only">
                          {" "}
                          ({t("frequency_locking.slots.on_air")})
                        </span>
                      ) : null}
                    </Label>
                  </span>
                  <Input
                    id={inputId}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    host={isOptional && !filled ? "surface" : "container"}
                    className={SLOT_INPUT}
                    placeholder={t(
                      "frequency_locking.slots.earfcn_placeholder",
                    )}
                    value={raw}
                    onChange={(event) => setSlot(index, event.target.value)}
                    /* Read-only under a tower lock: this list cannot be written
                       until it is released. "Use current" below stays live. */
                    disabled={isLocking || towerLockActive}
                    aria-invalid={invalid || undefined}
                  />

                  {index === 0 ? (
                    <Button
                      type="button"
                      variant="tonal-neutral"
                      className={PILL_USE_CURRENT}
                      onClick={handleUseCurrent}
                      /* NOT gated on `towerLockActive` — see the header. */
                      disabled={isLocking || !canUseCurrent}
                      title={t("frequency_locking.actions.use_current_hint")}
                    >
                      <MaterialSymbol name="my_location" size={16} />
                      {canUseCurrent
                        ? t("frequency_locking.actions.use_current")
                        : t("frequency_locking.actions.use_current_none")}
                    </Button>
                  ) : null}

                  {/* Full-width so it wraps onto its own line beneath the field
                      rather than competing with it for the row's measure. */}
                  <div className="flex w-full flex-col gap-1">
                    {invalid ? (
                      <p
                        role="alert"
                        className={`${SLOT.META} text-destructive-on-surface`}
                      >
                        {t("frequency_locking.error.invalid_channel")}
                      </p>
                    ) : null}
                    {/* The CHANNEL frequency, not the band centre: EARFCN 1300
                        is 1815.0 MHz, and 1301 is a different number. A band
                        figure would not move, which defeats the point. */}
                    {frequency ? (
                      <p className={SLOT.VALUE}>{frequency}</p>
                    ) : null}
                    <BandMatchDisplay
                      bands={matchedPerSlot[index] ?? []}
                      hasInput={filled && !invalid}
                      supportedBands={supportedBands}
                      prefix="B"
                      noMatchLabel={t(
                        "frequency_locking.bands.this_frequency",
                      )}
                    />
                    {isOptional && !filled ? (
                      <p className={SLOT.HINT}>
                        {t("frequency_locking.slots.optional")}
                      </p>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </CardContent>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLocking ? t("frequency_locking.card.status_applying") : ""}
        </div>

        {/* `CARD_FOOT`'s `mt-auto` collects the LTE/NR height asymmetry behind the
            actions. */}
        <CardFoot
          className={CARD_PAD}
          status={
            <>
              <RevealButton
                glyph="close"
                label={t("frequency_locking.actions.clear_fields")}
                onClick={clearFields}
                disabled={isLocking || towerLockActive || !hasAnyValue}
              />
              {hasUnusedLock ? (
                <span className="text-warning-on-surface inline-flex items-center gap-1.5">
                  <MaterialSymbol
                    name="warning"
                    size={16}
                    className="flex-none"
                  />
                  <span className="min-w-0">
                    {t("frequency_locking.card.unused")}
                  </span>
                </span>
              ) : null}
            </>
          }
          actions={
            <>
              {showUnlock ? (
                <Button
                  type="button"
                  size="action"
                  onClick={() => setShowUnlockDialog(true)}
                  disabled={isLocking}
                >
                  {t("frequency_locking.actions.clear_lte")}
                </Button>
              ) : null}
              {showApply ? (
                <SaveButton
                  onClick={requestLock}
                  isSaving={isLocking}
                  saved={saved}
                  label={t("frequency_locking.actions.apply_lte")}
                  blockedReason={lockBlockedReason}
                  disabled={isLocking || hasInvalidSlot || stagedChannels.length === 0}
                  size="action"
                />
              ) : null}
            </>
          }
        />
      </Card>

      {/* --- Lock confirmation ---------------------------------------------- */}
      <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("frequency_locking.dialog.lock_lte_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("frequency_locking.dialog.lock_lte_body", {
                channels: pendingChannels.join(", "),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* The standing risk, said where the lock is confirmed: this
              feature has no failover watcher, so nothing restores service on
              its own if the channels lose coverage. */}
          <div className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.root}`}>
            <MaterialSymbol
              name={NOTICE_TONE.warning.glyph}
              size={16}
              filled={NOTICE_TONE.warning.filled}
              className="flex-none"
            />
            <span className={NOTICE.TEXT}>
              {t("frequency_locking.dialog.no_recovery")}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              size="action"
              disabled={isLocking}
            >
              {t("frequency_locking.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLock}
              size="action"
            >
              {t("frequency_locking.dialog.confirm_lock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Unsupported-band confirmation ----------------------------------
          The single most consequential dialog on this page. `lock.sh:10` warns
          that locking to a band the modem does not support may crash-dump it,
          and unlike band and tower locking there is NO failover watcher to
          restore service afterwards. Destructive-toned for that reason alone. */}
      <AlertDialog
        open={showUnsupportedDialog}
        onOpenChange={setShowUnsupportedDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive-on-surface">
              {t("frequency_locking.dialog.unsupported_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("frequency_locking.dialog.unsupported_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            <p className={SLOT.META}>
              <span className="font-semibold">
                {t("frequency_locking.dialog.unsupported_matched")}
              </span>{" "}
              {matchedPerSlot.flat().length > 0
                ? matchedPerSlot
                    .flat()
                    .map((band) => `B${band.band}`)
                    .join(", ")
                : t("frequency_locking.dialog.unsupported_unknown")}
            </p>
            <p className={SLOT.META}>
              <span className="font-semibold">
                {t("frequency_locking.dialog.unsupported_supported")}
              </span>{" "}
              {supportedBands.length > 0
                ? supportedBands.map((band) => `B${band}`).join(", ")
                : t("frequency_locking.dialog.unsupported_unknown")}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              size="action"
              disabled={isLocking}
            >
              {t("frequency_locking.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmLock}
              size="action"
            >
              {t("frequency_locking.dialog.unsupported_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Unlock confirmation -------------------------------------------- */}
      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("frequency_locking.dialog.unlock_lte_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("frequency_locking.dialog.unlock_lte_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              size="action"
              disabled={isLocking}
            >
              {t("frequency_locking.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnlock}
              size="action"
            >
              {t("frequency_locking.dialog.confirm_unlock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default LteFreqCard;
