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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  findAllMatchingNRBands,
  suggestNRSCS,
  type NRBandEntry,
} from "@/lib/earfcn";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type {
  FreqLockModemState,
  NrFreqLockEntry,
} from "@/types/frequency-locking";
import type { ModemStatus } from "@/types/modem-status";
// Cross-route import, kept deliberately: SCS is a property of the 5G NR radio,
// not of either page, and both locking surfaces must offer the same five values.
// The coupling is one frozen array; duplicating it is how the two pages would
// drift apart.
import { SCS_OPTIONS } from "@/types/tower-locking";

import { BandMatchDisplay } from "./band-match-display";
import {
  BADGE_GLYPH_SIZE,
  CARD_FOOT,
  CARD_PAD,
  CARD_SHELL,
  EMPTY,
  LOCK_BADGE,
  NOTICE,
  NOTICE_TONE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  PILL_QUIET,
  PILL_USE_CURRENT,
  SKELETON_SHAPE,
  SLOT,
  SLOT_INPUT,
  channelFrequencyLabel,
  lockPosture,
} from "./shapes";

// =============================================================================
// NrFreqCard — the 5G NR leg of frequency locking, as one peer card
// =============================================================================
// Replaces `nr-freq-locking.tsx`. Same three rebuild moves as the LTE card (no
// enable Switch, the shell owns the draft, every string is a key), plus three
// that are specific to this leg.
//
// -----------------------------------------------------------------------------
// 1. A LIST, NOT FOUR FIXED SLOTS
// -----------------------------------------------------------------------------
// `lock.sh:165` accepts up to 32 entries. The incumbent hard-coded
// `NUM_SLOTS = 4` and then told the user so in its own description — a 32-entry
// feature capped at four by a constant nobody meant as a limit. Entries are a
// dynamic list here: add rows until the modem's ceiling.
//
// -----------------------------------------------------------------------------
// 2. THE DRAFT IS NUMERIC, SO THE ADD ROW IS LOCAL
// -----------------------------------------------------------------------------
// `draft` is `NrFreqLockEntry[]` — committed pairs, owned by the shell, which is
// what the live strip's Add pushes into. A half-typed ARFCN is not a pair, so it
// cannot live there; the add row keeps its own two strings and commits a whole
// entry at once. That also removes the incumbent's worst failure mode, where a
// slot carrying an ARFCN with no SCS was silently dropped on write.
//
// -----------------------------------------------------------------------------
// 3. THE MODEM'S OWN SCS OUTRANKS THE INFERENCE
// -----------------------------------------------------------------------------
// `suggestNRSCS()` is a heuristic — FDD→15, TDD→30, FR2→60 — and it is simply
// wrong on any TDD band the operator runs at 15 kHz. When `nr.scs` is reported
// it is the ground truth and wins; the inference only fills a field nobody has
// answered. A wrong spacing is the quietest failure this page can produce: the
// entry looks valid, the modem accepts the write, and then never uses it. That
// is what `card.scs_warning` says, and it is why the notice is permanent.
// =============================================================================

/** `AT+QNWCFG="nr5g_earfcn_lock"` ceiling — `lock.sh:165` rejects beyond this. */
const MAX_ENTRIES = 32;

/** Digits only. See the LTE card: `parseInt("12abc")` is a silent wrong lock. */
function parseChannel(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isNaN(value) ? null : value;
}

/** Order-insensitive comparison key. The entries are a SET of allowed pairs. */
function entryKey(entries: readonly NrFreqLockEntry[]): string {
  return entries
    .map((entry) => `${entry.arfcn}:${entry.scs}`)
    .sort()
    .join("|");
}

/**
 * SCS picker geometry.
 *
 * `SLOT_INPUT`'s `h-[2.625rem]` cannot beat the Select primitive's
 * `data-[size=default]:h-9` on its own — different variant groups, so
 * `tailwind-merge` keeps both and the data-attribute rule wins. The override has
 * to be written in the same variant. `flex-none` likewise replaces the shared
 * constant's `flex-1`, since this control has a fixed measure.
 */
const SCS_CONTROL = `${SLOT_INPUT} w-32 flex-none data-[size=default]:h-[2.625rem]`;

/** The remove button's interaction layer. `SLOT.DROP` is shape only. */
const DROP_INTERACT =
  "transition-colors duration-[var(--duration-quick)] ease-out hover:text-on-surface focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55";

export interface NrFreqCardProps {
  /** Committed (ARFCN, SCS) pairs, 0..32. Owned by the shell. */
  draft: NrFreqLockEntry[];
  onDraftChange: (next: NrFreqLockEntry[]) => void;
  modemState: FreqLockModemState | null;
  modemData: ModemStatus | null;
  isLoading: boolean;
  isLocking: boolean;
  error: string | null;
  towerLockActive: boolean;
  /**
   * False when the tower-lock probe FAILED. Distinct from `towerLockActive`:
   * that says "a tower lock is holding this leg", this says "nobody could find
   * out". `frequency/lock.sh` refuses the write in BOTH cases, so both have to
   * block the Lock action up front. See `FreqLockModemState`.
   */
  towerLockReadOk: boolean;
  onLock: (entries: NrFreqLockEntry[]) => Promise<boolean>;
  onUnlock: () => Promise<boolean>;
}

export function NrFreqCard({
  draft,
  onDraftChange,
  modemState,
  modemData,
  isLoading,
  isLocking,
  error,
  towerLockActive,
  towerLockReadOk,
  onLock,
  onUnlock,
}: NrFreqCardProps): React.JSX.Element {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [showUnsupportedDialog, setShowUnsupportedDialog] = useState(false);
  const [pendingEntries, setPendingEntries] = useState<NrFreqLockEntry[]>([]);

  // --- The add row (local: a half-typed pair is not a committed entry) --------
  const [newArfcn, setNewArfcn] = useState("");
  const [newScs, setNewScs] = useState("");
  /**
   * Whether the user chose the spacing themselves.
   *
   * Load-bearing, and inherited from the incumbent, which got this right: once
   * someone has picked a spacing, typing another digit into the ARFCN must not
   * quietly overwrite it with `suggestNRSCS`'s guess.
   */
  const [scsManual, setScsManual] = useState(false);

  // --- Derived ---------------------------------------------------------------

  const parsedNewArfcn = parseChannel(newArfcn);
  const parsedNewScs = parseChannel(newScs);
  const newArfcnInvalid = newArfcn.trim() !== "" && parsedNewArfcn === null;

  const newBands = useMemo<NRBandEntry[]>(
    () => (parsedNewArfcn === null ? [] : findAllMatchingNRBands(parsedNewArfcn)),
    [parsedNewArfcn],
  );

  const matchedPerEntry = useMemo<NRBandEntry[][]>(
    () => draft.map((entry) => findAllMatchingNRBands(entry.arfcn)),
    [draft],
  );

  /** SA and NSA lists are both colon-separated; a band in either is supported. */
  const supportedBands = useMemo<number[]>(() => {
    const sa = modemData?.device?.supported_sa_nr5g_bands ?? "";
    const nsa = modemData?.device?.supported_nsa_nr5g_bands ?? "";
    const bands = `${sa}:${nsa}`
      .split(":")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((value) => !Number.isNaN(value));
    return [...new Set(bands)];
  }, [
    modemData?.device?.supported_sa_nr5g_bands,
    modemData?.device?.supported_nsa_nr5g_bands,
  ]);

  /** Read only while the modem also reports the leg locked — see the LTE card. */
  const lockedEntries = useMemo<NrFreqLockEntry[]>(
    () => (modemState?.nr_locked ? modemState.nr_entries : []),
    [modemState],
  );

  const posture = lockPosture(
    modemState ? { locked: modemState.nr_locked } : null,
    towerLockActive,
  );
  const tone = LOCK_BADGE[posture];
  const statusLabel =
    posture === "locked"
      ? t("frequency_locking.card.status_locked")
      : posture === "unlocked"
        ? t("frequency_locking.card.status_unlocked")
        : posture === "blocked"
          ? t("frequency_locking.card.status_blocked")
          : t("frequency_locking.card.status_unknown");

  const hasChanges = useMemo(
    () => entryKey(draft) !== entryKey(lockedEntries),
    [draft, lockedEntries],
  );

  /**
   * The NR channel the radio is on right now, with the spacing it is actually
   * using. `nr.scs` wins outright; the inference is the fallback and is allowed
   * to fail, in which case the spacing field is left for the user to answer.
   */
  const currentNr = useMemo<{ arfcn: number; scs: number | null } | null>(() => {
    const arfcn = modemData?.nr?.arfcn;
    if (arfcn == null) return null;
    const reported = modemData?.nr?.scs;
    if (reported != null) return { arfcn, scs: reported };
    const bands = findAllMatchingNRBands(arfcn);
    return {
      arfcn,
      scs: bands.length > 0 && bands[0] ? suggestNRSCS(bands[0]) : null,
    };
  }, [modemData]);

  /** Null when the modem is LTE-only, which is this device's normal state. */
  const canUseCurrent = currentNr !== null;

  const isDuplicate =
    parsedNewArfcn !== null &&
    parsedNewScs !== null &&
    draft.some(
      (entry) => entry.arfcn === parsedNewArfcn && entry.scs === parsedNewScs,
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
   * THE SECOND USED TO LEAVE THE BUTTON LIVE. The user filled the form, pressed
   * Lock, waited out an AT round-trip and was refused — the exact anti-pattern
   * `SaveButton.blockedReason` exists to remove. `blockedReason` blocks with
   * `aria-disabled` rather than `disabled`, so the reason stays reachable by
   * hover AND by keyboard and rides along in the accessible name.
   */
  const lockBlockedReason = towerLockActive
    ? t("frequency_locking.blocked.tower_lock_active")
    : !towerLockReadOk
      ? t("frequency_locking.blocked.tower_lock_unknown")
      : null;

  const isFull = draft.length >= MAX_ENTRIES;
  const canAdd =
    !isLocking &&
    !towerLockActive &&
    !isFull &&
    !isDuplicate &&
    parsedNewArfcn !== null &&
    parsedNewScs !== null;

  /** See the LTE card: an empty supported list is unknown, not unsupported. */
  const anySupported = useMemo(() => {
    const matched = matchedPerEntry.flat();
    if (matched.length === 0) return true;
    return matched.some((band) => supportedBands.includes(band.band));
  }, [matchedPerEntry, supportedBands]);

  // --- Handlers --------------------------------------------------------------

  const handleArfcnChange = (value: string) => {
    setNewArfcn(value);
    if (scsManual) return;
    const channel = parseChannel(value);
    if (channel === null) return;
    const bands = findAllMatchingNRBands(channel);
    if (bands.length > 0 && bands[0]) setNewScs(String(suggestNRSCS(bands[0])));
  };

  const handleScsChange = (value: string) => {
    setNewScs(value);
    setScsManual(true);
  };

  const resetAddRow = () => {
    setNewArfcn("");
    setNewScs("");
    setScsManual(false);
  };

  const handleAdd = () => {
    if (!canAdd || parsedNewArfcn === null || parsedNewScs === null) return;
    onDraftChange([...draft, { arfcn: parsedNewArfcn, scs: parsedNewScs }]);
    resetAddRow();
  };

  const handleRemove = (index: number) => {
    onDraftChange(draft.filter((_, position) => position !== index));
  };

  /**
   * "Use current" fills the ADD ROW rather than committing straight into the
   * list, because an NR entry is a PAIR: when the modem reports no spacing and
   * no band matches, committing would mean inventing the one value that fails
   * silently. Prefilling puts the question in front of the user instead.
   *
   * Deliberately live while a tower lock blocks Apply — capturing the channel
   * the user already validated is exactly how they migrate to the looser lock.
   */
  const handleUseCurrent = () => {
    if (!currentNr) return;
    setNewArfcn(String(currentNr.arfcn));
    if (currentNr.scs !== null) {
      setNewScs(String(currentNr.scs));
      // The modem's own reading is authoritative, so pin it against the
      // inference that would otherwise overwrite it on the next keystroke.
      setScsManual(true);
    }
    toast.success(t("frequency_locking.toast.filled_from_current"));
  };

  const requestLock = () => {
    if (draft.length === 0) {
      toast.warning(t("frequency_locking.toast.no_channels_title"), {
        description: t("frequency_locking.toast.no_channels_body"),
      });
      return;
    }
    setPendingEntries(draft);
    if (!anySupported && supportedBands.length > 0) {
      setShowUnsupportedDialog(true);
    } else {
      setShowLockDialog(true);
    }
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    setShowUnsupportedDialog(false);
    const ok = await onLock(pendingEntries);
    if (ok) {
      markSaved();
      toast.success(t("frequency_locking.toast.nr_locked"));
    } else {
      toast.error(t("frequency_locking.toast.nr_lock_failed"));
    }
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    const ok = await onUnlock();
    if (ok) {
      toast.success(t("frequency_locking.toast.nr_cleared"));
    } else {
      toast.error(t("frequency_locking.toast.nr_clear_failed"));
    }
  };

  const clearFields = () => {
    onDraftChange([]);
    resetAddRow();
  };

  /** The pending list as one readable string for the dialogs. */
  const pendingSummary = pendingEntries
    .map(
      (entry) =>
        `${entry.arfcn} · ${t("frequency_locking.slots.scs_unit", {
          value: entry.scs,
        })}`,
    )
    .join(", ");

  // --- Loading ---------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <Skeleton className={SKELETON_SHAPE.TITLE} />
              <Skeleton className={SKELETON_SHAPE.DESC} />
            </div>
            <Skeleton className={SKELETON_SHAPE.CHIP} />
          </div>
        </CardHeader>
        <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
          <div className={SLOT.LIST}>
            {/* Two rows plus the add row: the list is dynamic, so the skeleton
                stands for the shape of a short list, not for a fixed count. */}
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className={SKELETON_SHAPE.SLOT_ROW} />
            ))}
          </div>
        </CardContent>
        <CardFooter className={`${CARD_PAD} ${CARD_FOOT}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className={SKELETON_SHAPE.ACTION} />
            <Skeleton className={SKELETON_SHAPE.ACTION} />
          </div>
        </CardFooter>
      </Card>
    );
  }

  // --- Loaded ----------------------------------------------------------------
  return (
    <>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="truncate text-lg">
                {t("frequency_locking.legs.nr.title")}
              </CardTitle>
              <CardDescription className="text-pretty">
                {t("frequency_locking.legs.nr.description")}
              </CardDescription>
            </div>
            <Badge variant={tone.variant} className="flex-none">
              <MaterialSymbol
                name={tone.glyph}
                size={BADGE_GLYPH_SIZE}
                filled={tone.filled}
              />
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className={`${CARD_PAD} flex flex-1 flex-col gap-4`}>
          {/* --- Error ------------------------------------------------------- */}
          {error ? (
            <div
              role="alert"
              className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.root}`}
            >
              <MaterialSymbol
                name={NOTICE_TONE.warning.glyph}
                size={16}
                filled={NOTICE_TONE.warning.filled}
                className="flex-none"
              />
              <span className={NOTICE.TEXT}>
                <strong className="font-semibold">
                  {t("frequency_locking.error.load_title")}
                </strong>{" "}
                {t("frequency_locking.error.load_body")}
              </span>
            </div>
          ) : null}

          {/* --- Blocked ----------------------------------------------------- */}
          {towerLockActive ? (
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
          ) : !towerLockReadOk ? (
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
          ) : null}

          {/* --- The spacing warning ------------------------------------------
              Permanent, and a BLOCK rather than a chip: a wrong SCS is accepted
              by the modem and then never used, so there is no failure to report
              after the fact — only this, before it. */}
          {/* --- Empty / count ----------------------------------------------- */}
          {draft.length === 0 ? (
            <div className={EMPTY.ROOT}>
              <MaterialSymbol
                name="playlist_add"
                size={28}
                className="text-on-surface-variant"
              />
              <p className={EMPTY.TITLE}>
                {t("frequency_locking.card.empty_title")}
              </p>
              <p className={EMPTY.BODY}>
                {t("frequency_locking.card.empty_body_nr")}
              </p>
            </div>
          ) : (
            <p className={SLOT.META}>
              {/* While the list differs from the read-back, say the fuller
                  sentence: the entries are staged, not on the modem. */}
              {hasChanges
                ? t("frequency_locking.slots.staged_count", {
                    count: draft.length,
                    max: MAX_ENTRIES,
                  })
                : t("frequency_locking.card.count", {
                    used: draft.length,
                    max: MAX_ENTRIES,
                  })}
            </p>
          )}

          {/* --- Entries ------------------------------------------------------ */}
          {draft.length > 0 ? (
            <motion.div
              className={SLOT.LIST}
              variants={staggerRows}
              initial="hidden"
              animate="visible"
            >
              {draft.map((entry, index) => {
                const frequency = channelFrequencyLabel(entry.arfcn, "NR");
                return (
                  <motion.div
                    key={`${entry.arfcn}-${entry.scs}-${index}`}
                    variants={staggerRowItem}
                    className={SLOT.ROW}
                  >
                    <span className={SLOT.INDEX}>
                      {t("frequency_locking.slots.slot", { index: index + 1 })}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className={SLOT.VALUE}>{entry.arfcn}</span>
                        <span className={SLOT.META}>
                          {t("frequency_locking.slots.scs_unit", {
                            value: entry.scs,
                          })}
                        </span>
                        {/* The CHANNEL frequency, per TS 38.104 — it moves with
                            every digit, which a band centre would not. */}
                        {frequency ? (
                          <span className={SLOT.META}>{frequency}</span>
                        ) : null}
                      </div>
                      <BandMatchDisplay
                        bands={matchedPerEntry[index] ?? []}
                        hasInput
                        supportedBands={supportedBands}
                        prefix="n"
                        noMatchLabel={t(
                          "frequency_locking.bands.this_frequency",
                        )}
                      />
                    </div>
                    <button
                      type="button"
                      className={`${SLOT.DROP} ${DROP_INTERACT}`}
                      aria-label={t("frequency_locking.a11y.remove_entry")}
                      onClick={() => handleRemove(index)}
                      disabled={isLocking || towerLockActive}
                    >
                      <MaterialSymbol name="close" size={16} />
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : null}

          {/* --- Add row ------------------------------------------------------
              Dashed, like an empty slot, because that is what it is: the next
              entry, not yet committed. Hidden once the modem's ceiling is
              reached — 32 entries is the command's limit, not ours. */}
          {!isFull ? (
            <div className={SLOT.ROW_EMPTY}>
              <Input
                id="nr-freq-add-arfcn"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className={SLOT_INPUT}
                placeholder={t("frequency_locking.slots.arfcn_placeholder")}
                aria-label={t("frequency_locking.slots.arfcn_placeholder")}
                value={newArfcn}
                onChange={(event) => handleArfcnChange(event.target.value)}
                disabled={isLocking || towerLockActive}
                aria-invalid={newArfcnInvalid || undefined}
              />
              <Select
                value={newScs}
                onValueChange={handleScsChange}
                disabled={isLocking || towerLockActive}
              >
                <SelectTrigger
                  id="nr-freq-add-scs"
                  className={SCS_CONTROL}
                  aria-label={t("frequency_locking.slots.scs_label")}
                >
                  <SelectValue
                    placeholder={t("frequency_locking.slots.scs_label")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {/* `SCS_OPTIONS.label` is an English literal in the shared
                      type module, so the unit is rendered from the locale
                      instead and only the numeric value is taken from it. */}
                  {SCS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {t("frequency_locking.slots.scs_unit", {
                        value: option.value,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="tonal-neutral"
                className={PILL_USE_CURRENT}
                onClick={handleUseCurrent}
                /* NOT gated on `towerLockActive` — see `handleUseCurrent`. */
                disabled={isLocking || !canUseCurrent}
                title={t("frequency_locking.actions.use_current_hint")}
              >
                <MaterialSymbol name="my_location" size={16} />
                {canUseCurrent
                  ? t("frequency_locking.actions.use_current")
                  : t("frequency_locking.actions.use_current_none")}
              </Button>

              <Button
                type="button"
                variant="tonal-neutral"
                className={PILL_QUIET}
                onClick={handleAdd}
                disabled={!canAdd}
              >
                <MaterialSymbol name="add" size={16} />
                {t("frequency_locking.actions.add")}
              </Button>

              <div className="flex w-full flex-col gap-1">
                {newArfcnInvalid ? (
                  <p
                    role="alert"
                    className={`${SLOT.META} text-destructive-on-surface`}
                  >
                    {t("frequency_locking.error.invalid_channel")}
                  </p>
                ) : null}
                {/* The reason Add is disabled, said on the row rather than in a
                    toast after the click. */}
                {isDuplicate ? (
                  <p className={SLOT.HINT}>
                    {t("frequency_locking.slots.in_list")}
                  </p>
                ) : null}
                {parsedNewArfcn !== null &&
                channelFrequencyLabel(parsedNewArfcn, "NR") ? (
                  <p className={SLOT.VALUE}>
                    {channelFrequencyLabel(parsedNewArfcn, "NR")}
                  </p>
                ) : null}
                <BandMatchDisplay
                  bands={newBands}
                  hasInput={parsedNewArfcn !== null}
                  supportedBands={supportedBands}
                  prefix="n"
                  noMatchLabel={t("frequency_locking.bands.this_frequency")}
                />
              </div>
            </div>
          ) : null}

          {/* --- The SCS caveat ----------------------------------------------
              Placed directly under the spacing control it is about, not at the
              top of the card. It started above everything, where it was the
              loudest object on an empty card and warned about a control the
              reader had not reached yet.

              Still permanent while the card is usable, and still a BLOCK rather
              than a chip: a wrong SCS is accepted by the modem and then simply
              never used, so there is no failure to report after the fact — only
              this, before it. Hidden while a tower lock blocks the card, since
              nothing here can be set then. */}
          {!towerLockActive ? (
            <div className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.root}`}>
              <MaterialSymbol
                name={NOTICE_TONE.warning.glyph}
                size={16}
                filled={NOTICE_TONE.warning.filled}
                className="flex-none"
              />
              <span className={NOTICE.TEXT}>
                {t("frequency_locking.card.scs_warning")}
              </span>
            </div>
          ) : null}
        </CardContent>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLocking ? t("frequency_locking.card.status_applying") : ""}
        </div>

        <CardFooter className={`${CARD_PAD} ${CARD_FOOT}`}>
          <div className="flex flex-wrap items-center gap-2">
            <SaveButton
              onClick={requestLock}
              isSaving={isLocking}
              saved={saved}
              label={t("frequency_locking.actions.apply_nr")}
              blockedReason={lockBlockedReason}
              disabled={
                isLocking ||
                draft.length === 0 ||
                (posture === "locked" && !hasChanges)
              }
              className={PILL_ACTION_PLAIN}
            />
            <Button
              type="button"
              variant="outline"
              className={PILL_ACTION}
              onClick={() => setShowUnlockDialog(true)}
              disabled={isLocking || posture !== "locked"}
            >
              <MaterialSymbol name="lock_open" size={18} />
              {t("frequency_locking.actions.clear_nr")}
            </Button>
          </div>
          <Button
            type="button"
            variant="tonal-neutral"
            className={PILL_QUIET}
            onClick={clearFields}
            disabled={
              isLocking ||
              towerLockActive ||
              (draft.length === 0 && newArfcn.trim() === "")
            }
          >
            {t("frequency_locking.actions.clear_fields")}
          </Button>
        </CardFooter>
      </Card>

      {/* --- Lock confirmation ---------------------------------------------- */}
      <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("frequency_locking.dialog.lock_nr_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("frequency_locking.dialog.lock_nr_body", {
                channels: pendingSummary,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              className={PILL_ACTION_PLAIN}
              disabled={isLocking}
            >
              {t("frequency_locking.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLock}
              className={PILL_ACTION_PLAIN}
            >
              {t("frequency_locking.dialog.confirm_lock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Unsupported-band confirmation -----------------------------------
          `lock.sh:10`: locking to a band the modem does not support can make it
          restart unexpectedly, and this feature has no failover watcher. */}
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
              {matchedPerEntry.flat().length > 0
                ? matchedPerEntry
                    .flat()
                    .map((band) => `n${band.band}`)
                    .join(", ")
                : t("frequency_locking.dialog.unsupported_unknown")}
            </p>
            <p className={SLOT.META}>
              <span className="font-semibold">
                {t("frequency_locking.dialog.unsupported_supported")}
              </span>{" "}
              {supportedBands.length > 0
                ? supportedBands.map((band) => `n${band}`).join(", ")
                : t("frequency_locking.dialog.unsupported_unknown")}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              className={PILL_ACTION_PLAIN}
              disabled={isLocking}
            >
              {t("frequency_locking.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmLock}
              className={PILL_ACTION_PLAIN}
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
              {t("frequency_locking.dialog.unlock_nr_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("frequency_locking.dialog.unlock_nr_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              className={PILL_ACTION_PLAIN}
              disabled={isLocking}
            >
              {t("frequency_locking.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnlock}
              className={PILL_ACTION_PLAIN}
            >
              {t("frequency_locking.dialog.confirm_unlock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default NrFreqCard;
