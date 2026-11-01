"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CARD_FOOT,
  CARD_FOOT_ACTIONS,
  CardFoot,
} from "@/components/ui/card-foot";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { RevealButton } from "@/components/ui/reveal-button";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type { CarrierComponent } from "@/types/modem-status";
import type {
  LteLockCell,
  TowerActionResult,
  TowerLockConfig,
  TowerModemState,
} from "@/types/tower-locking";

import { TowerPersistField } from "./persist-field";
import { reportTowerResult } from "./settings-write";
import { compositeValue, parseCompositeValue } from "./simple-mode-utils";
import {
  CARD_PAD,
  CONTROL_ROW,
  FIELD_CONTROL,
  LEG_CARD_ID,
  LEG_KEYS,
  NOTICE,
  NOTICE_TONE,
  SKELETON_SHAPE,
  SLOT_ROW,
  TOWER_CARD,
  type LegPosture,
} from "./shapes";

// =============================================================================
// LteTowerCard — pin the LTE radio to up to three cells (EARFCN + PCI)
// =============================================================================
// Three slot rows; a half-filled slot is dropped on write, so the card warns. Unlock stays live whenever the modem
// reports a lock: a lock on an unreachable cell can take this page down.
// =============================================================================

const K = "tower_locking";
const SLOT_COUNT = 3;
const STORAGE_KEY = "qmanager_tower_lte_simple_mode";

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol
    name="check"
    size={16}
    className={className}
    aria-hidden="true"
  />
);

interface SlotValue {
  earfcn: string;
  pci: string;
}

interface SlotCarrier {
  earfcn: number;
  pci: number;
  band: string;
  type: "PCC" | "SCC";
}

const EMPTY_SLOT: SlotValue = { earfcn: "", pci: "" };

function slotsFromCells(cells: (LteLockCell | null)[] | undefined): SlotValue[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const cell = cells?.[index];
    return cell
      ? { earfcn: String(cell.earfcn), pci: String(cell.pci) }
      : EMPTY_SLOT;
  });
}

const isSlotBlank = (slot: SlotValue) =>
  slot.earfcn.trim() === "" && slot.pci.trim() === "";

function slotToCell(slot: SlotValue): LteLockCell | null {
  const earfcn = Number.parseInt(slot.earfcn, 10);
  const pci = Number.parseInt(slot.pci, 10);
  if (Number.isNaN(earfcn) || Number.isNaN(pci)) return null;
  return { earfcn, pci };
}

// Detected is the default: it is the safer way in, and only an explicit
// switch to Manual is remembered.
function readPickMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writePickMode(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(on));
  } catch {
    // Private window or blocked storage: the preference just does not persist.
  }
}

export interface LteTowerCardProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  carriers: CarrierComponent[];
  isLoading: boolean;
  isLocking: boolean;
  onLock: (cells: LteLockCell[]) => Promise<TowerActionResult>;
  onUnlock: () => Promise<TowerActionResult>;
  isSavingSettings: boolean;
  onSetPersist: (on: boolean) => void;
}

export default function LteTowerCard({
  config,
  modemState,
  carriers,
  isLoading,
  isLocking,
  onLock,
  onUnlock,
  isSavingSettings,
  onSetPersist,
}: LteTowerCardProps): React.JSX.Element {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();
  const shortName = t(LEG_KEYS.lte.short);

  const [slots, setSlots] = useState<SlotValue[]>(() =>
    slotsFromCells(config?.lte?.cells),
  );
  const [pickMode, setPickMode] = useState<boolean>(readPickMode);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [pendingCells, setPendingCells] = useState<LteLockCell[]>([]);
  const [writeError, setWriteError] = useState<string | null>(null);

  // --- Seed from config, during render ------------------------------------
  // Re-seed when the saved cells change (a re-read after a write).
  const [prevCells, setPrevCells] = useState(config?.lte?.cells);
  const configCells = config?.lte?.cells;
  let activeSlots = slots;
  if (configCells !== prevCells) {
    setPrevCells(configCells);
    activeSlots = slotsFromCells(configCells);
    setSlots(activeSlots);
  }

  // --- Derived ----------------------------------------------------------------
  const carrierOptions = useMemo<SlotCarrier[]>(() => {
    const seen = new Set<string>();
    const out: SlotCarrier[] = [];
    const sorted = [...carriers].sort((a, b) => {
      if (a.type !== b.type) return a.type === "PCC" ? -1 : 1;
      return (b.rsrp ?? -200) - (a.rsrp ?? -200);
    });
    for (const carrier of sorted) {
      if (carrier.earfcn == null || carrier.pci == null) continue;
      const key = compositeValue(carrier.earfcn, carrier.pci);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        earfcn: carrier.earfcn,
        pci: carrier.pci,
        band: carrier.band,
        type: carrier.type,
      });
    }
    return out;
  }, [carriers]);

  const hasOptions = carrierOptions.length > 0;
  // Pick needs a carrier to pick from; with none on air the control falls back to Type.
  const pickActive = pickMode && hasOptions;

  const slotComposites = activeSlots.map((slot) => {
    const cell = slotToCell(slot);
    return cell ? compositeValue(cell.earfcn, cell.pci) : "";
  });

  const validCells = activeSlots
    .map(slotToCell)
    .filter((cell): cell is LteLockCell => cell !== null);

  const hasPartialSlot = activeSlots.some(
    (slot) => !isSlotBlank(slot) && slotToCell(slot) === null,
  );
  const hasAnyValue = activeSlots.some((slot) => !isSlotBlank(slot));

  const posture: LegPosture =
    !modemState || modemState.lte_read_ok === false
      ? "unknown"
      : modemState.lte_locked
        ? "locked"
        : "unlocked";
  const readbackCells = useMemo<LteLockCell[]>(
    () =>
      modemState?.lte_read_ok !== false && modemState?.lte_locked
        ? (modemState.lte_cells ?? [])
        : [],
    [modemState],
  );

  const isOnAir = (channel: number, cellPci: number): boolean =>
    carriers.some((c) => c.earfcn === channel && c.pci === cellPci);

  const cellsKey = (cells: LteLockCell[]) =>
    cells
      .map((c) => `${c.earfcn}:${c.pci}`)
      .sort()
      .join("|");
  const hasChanges = cellsKey(validCells) !== cellsKey(readbackCells);
  // The modem holds these, in the same shape as the slot composites.
  const lockedComposites = new Set(
    readbackCells.map((c) => compositeValue(c.earfcn, c.pci)),
  );
  const hasUnusedLock = slotComposites.some(
    (composite, i) => {
      const cell = slotToCell(activeSlots[i]);
      return (
        composite !== "" &&
        lockedComposites.has(composite) &&
        cell !== null &&
        !isOnAir(cell.earfcn, cell.pci)
      );
    },
  );

  const lockBlockedReason = isLocking
    ? null
    : validCells.length === 0
      ? hasAnyValue
        ? t(`${K}.blocked.lock_incomplete_lte`)
        : t(`${K}.blocked.lock_empty_lte`)
      : null;

  // Which of the two writes the state calls for (see the footer).
  const lockedAsSaved = posture === "locked" && !hasChanges;
  const showUnlock = posture === "unknown" || lockedAsSaved;
  const showLock = !lockedAsSaved;

  // --- Handlers ---------------------------------------------------------------
  const setSlotField = (index: number, field: keyof SlotValue, value: string) =>
    setSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)),
    );

  const clearSlot = (index: number) =>
    setSlots((prev) => prev.map((slot, i) => (i === index ? EMPTY_SLOT : slot)));

  const handlePickMode = (value: "type" | "pick") => {
    const on = value === "pick";
    setPickMode(on);
    writePickMode(on);
  };

  const handleSlotPick = (index: number, value: string) => {
    const parsed = parseCompositeValue(value);
    if (!parsed) return;
    setSlots((prev) =>
      prev.map((slot, i) =>
        i === index
          ? { earfcn: String(parsed.earfcn), pci: String(parsed.pci) }
          : slot,
      ),
    );
  };

  const requestLock = () => {
    if (validCells.length === 0) return;
    setPendingCells(validCells);
    setShowLockDialog(true);
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    setWriteError(null);
    const result = await onLock(pendingCells);
    if (result.ok) markSaved();
    if (!result.ok) setWriteError(result.error ?? t(`${K}.errors.lock_failed`));
    reportTowerResult(t, result, t(`${K}.toast.locked`, { leg: shortName }), t(`${K}.errors.lock_failed`));
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    setWriteError(null);
    const result = await onUnlock();
    if (!result.ok) setWriteError(result.error ?? t(`${K}.errors.unlock_failed`));
    reportTowerResult(t, result, t(`${K}.toast.unlocked`, { leg: shortName }), t(`${K}.errors.unlock_failed`));
  };

  // --- Loading ----------------------------------------------------------------
  if (isLoading) {
    return (
      <Card id={LEG_CARD_ID.lte} className={TOWER_CARD}>
        <CardHeader className={CARD_PAD}>
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className={SKELETON_SHAPE.CARD_TITLE} />
            <Skeleton className={SKELETON_SHAPE.CARD_DESC} />
          </div>
        </CardHeader>
        <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
          <Skeleton className={SKELETON_SHAPE.CONTROL_ROW} />
          {/* Composed from the real row so the two agree by construction. */}
          <div className="flex flex-col gap-2">
            {Array.from({ length: SLOT_COUNT }).map((_, index) => (
              <div key={index} className={SLOT_ROW.ROOT}>
                <Skeleton className={`${SKELETON_SHAPE.FIELD_LABEL} flex-none`} />
                <div className={SLOT_ROW.FIELDS}>
                  <Skeleton
                    className={`${SKELETON_SHAPE.FIELD_CONTROL} min-w-0 flex-[2_1_8.5rem]`}
                  />
                  <Skeleton
                    className={`${SKELETON_SHAPE.FIELD_CONTROL} min-w-0 flex-[1_1_5.5rem]`}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
        <div className={`${CARD_PAD} ${CARD_FOOT}`}>
          <div className="flex items-center gap-1.5">
            <Skeleton className={SKELETON_SHAPE.REVEAL} />
            <Skeleton className={SKELETON_SHAPE.REVEAL} />
          </div>
          <div className={CARD_FOOT_ACTIONS}>
            <Skeleton className={SKELETON_SHAPE.PERSIST_FIELD} />
            <Skeleton className={SKELETON_SHAPE.ACTION} />
          </div>
        </div>
      </Card>
    );
  }

  const footStatus = writeError ? (
    <span
      role="alert"
      className="text-destructive-on-surface inline-flex items-center gap-1.5"
    >
      <MaterialSymbol name="error" size={16} className="flex-none" />
      <span className="min-w-0">{writeError}</span>
    </span>
  ) : posture === "unknown" ? (
    <span className="inline-flex items-center gap-1.5">
      <MaterialSymbol name="visibility_off" size={16} className="flex-none" />
      {t(`${K}.card.unread_note`)}
    </span>
  ) : hasUnusedLock ? (
    <span className="text-warning-on-surface inline-flex items-center gap-1.5">
      <MaterialSymbol name="warning" size={16} className="flex-none" />
      <span className="min-w-0">{t(`${K}.card.unused_lte`)}</span>
    </span>
  ) : null;

  return (
    <>
      <Card id={LEG_CARD_ID.lte} className={`${TOWER_CARD} scroll-mt-20`}>
        <CardHeader className={CARD_PAD}>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="truncate text-lg">
              {t(LEG_KEYS.lte.title)}
            </CardTitle>
            <CardDescription className="text-pretty">
              {t(LEG_KEYS.lte.description)}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
          <div className="flex flex-col gap-1.5">
            <div className={CONTROL_ROW}>
              <Label id="lte-input-mode-label" className="min-w-0">
                {t(`${K}.card.input_mode`)}
              </Label>
              <div
                role="group"
                aria-labelledby="lte-input-mode-label"
                {...(!hasOptions
                  ? { "aria-describedby": "lte-input-mode-note" }
                  : null)}
              >
                <SegmentedField
                  value={pickActive ? "pick" : "type"}
                  onValueChange={handlePickMode}
                  options={[
                    { value: "pick", label: t(`${K}.card.mode_pick`) },
                    { value: "type", label: t(`${K}.card.mode_type`) },
                  ]}
                  ariaLabel={t(`${K}.card.input_mode`)}
                  disabled={!hasOptions || isLocking}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </div>
            </div>
            {/* With the control forced to Type, this is the only thing saying why. */}
            {!hasOptions ? (
              <p
                id="lte-input-mode-note"
                className="text-on-surface-variant px-4 text-xs"
              >
                {t(`${K}.live.camped_empty_title`)}
              </p>
            ) : null}
          </div>

          {!hasAnyValue ? (
            <div className="bg-surface-container flex flex-col items-center gap-2 rounded-tile px-6 py-6 text-center">
              <span className="bg-surface-container-high text-on-surface-variant grid size-11 place-items-center rounded-pill">
                <MaterialSymbol name="cell_tower" size={22} />
              </span>
              <p className="text-sm font-semibold">
                {t(`${K}.card.empty_title`)}
              </p>
              <p className="text-on-surface-variant text-sm text-pretty">
                {t(`${K}.card.empty_body`)}
              </p>
            </div>
          ) : null}

          {/* One row per slot. Labels are sr-only (the placeholder carries the
              short name) and each row is a group named by its own "Cell N". */}
          <motion.div
            className="flex flex-col gap-2"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {activeSlots.map((slot, index) => {
              const headingId = `lte-slot-${index}`;
              const earfcnId = `lte-earfcn-${index}`;
              const pciId = `lte-pci-${index}`;
              const composite = slotComposites[index] ?? "";
              const pickedOption =
                carrierOptions.find(
                  (option) =>
                    compositeValue(option.earfcn, option.pci) === composite,
                ) ?? null;
              const blank = isSlotBlank(slot);
              const cell = slotToCell(slot);
              const serving = cell !== null && isOnAir(cell.earfcn, cell.pci);
              // Locked on the modem yet not carrying traffic: outline it.
              const unused =
                cell !== null && !serving && lockedComposites.has(composite);
              // A filled row sits on surface-container, so its fields step up.
              const host = blank ? "surface" : "container";

              return (
                <motion.div
                  key={index}
                  variants={staggerRowItem}
                  role="group"
                  aria-labelledby={headingId}
                  className={
                    blank
                      ? SLOT_ROW.EMPTY
                      : `${SLOT_ROW.ROOT} ${unused ? SLOT_ROW.UNUSED : ""}`
                  }
                >
                  <span className={SLOT_ROW.INDEX_ROW}>
                    <span className={SLOT_ROW.DOT_SLOT} aria-hidden="true">
                      {serving ? (
                        <>
                          <span className={SLOT_ROW.DOT_PING} />
                          <span className={`relative ${SLOT_ROW.DOT}`} />
                        </>
                      ) : null}
                    </span>
                    <span id={headingId} className={SLOT_ROW.INDEX}>
                      {t(`${K}.fields.slot`, { index: index + 1 })}
                      {serving ? (
                        <span className="sr-only">
                          {" "}
                          ({t(`${K}.live.target_serving`)})
                        </span>
                      ) : null}
                    </span>
                  </span>

                  <div className={SLOT_ROW.FIELDS}>
                    <div className={SLOT_ROW.CHANNEL}>
                      <Label htmlFor={earfcnId} className="sr-only">
                        {t(`${K}.fields.earfcn`)}
                      </Label>
                      {pickActive ? (
                        <Select
                          value={pickedOption ? composite : ""}
                          onValueChange={(value) => handleSlotPick(index, value)}
                          disabled={isLocking}
                        >
                          <SelectTrigger
                            id={earfcnId}
                            host={host}
                            className={`${FIELD_CONTROL} w-full`}
                            aria-label={t(`${K}.fields.earfcn`)}
                          >
                            {/* The trigger prints the reading, not the option
                                row: the PCC/SCC tag belongs in the dropdown. */}
                            {pickedOption ? (
                              <span className="text-on-surface min-w-0 truncate text-sm font-semibold tabular-nums">
                                {t(`${K}.live.band_channel`, {
                                  band:
                                    pickedOption.band ||
                                    t(`${K}.live.tile_no_value`),
                                  channel: pickedOption.earfcn,
                                })}
                              </span>
                            ) : cell === null ? (
                              <SelectValue
                                placeholder={t(`${K}.fields.pick_placeholder`)}
                              />
                            ) : (
                              <span className="text-on-surface-variant min-w-0 truncate text-sm tabular-nums italic">
                                {t(`${K}.live.target_pair`, {
                                  channel: slot.earfcn,
                                  pci: slot.pci,
                                })}
                              </span>
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {carrierOptions.map((option) => {
                              const value = compositeValue(
                                option.earfcn,
                                option.pci,
                              );
                              const usedIn = slotComposites.findIndex(
                                (entry, i) => entry === value && i !== index,
                              );
                              return (
                                <SelectItem
                                  key={value}
                                  value={value}
                                  disabled={usedIn !== -1}
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <Tag variant="lte" className="flex-none">
                                      {option.type}
                                    </Tag>
                                    <span className="text-on-surface min-w-0 truncate text-sm font-semibold tabular-nums">
                                      {t(`${K}.live.band_channel`, {
                                        band:
                                          option.band ||
                                          t(`${K}.live.tile_no_value`),
                                        channel: option.earfcn,
                                      })}
                                    </span>
                                    {/* The PCI lands in its own field on pick. */}
                                    <span className="sr-only">
                                      {t(`${K}.fields.pci`)} {option.pci}
                                    </span>
                                    {usedIn !== -1 ? (
                                      <span className="text-on-surface-variant flex-none text-xs">
                                        {t(`${K}.fields.slot_in_use`, {
                                          index: usedIn + 1,
                                        })}
                                      </span>
                                    ) : null}
                                  </span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={earfcnId}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder={t(`${K}.live.tile_earfcn`)}
                          host={host}
                          className={FIELD_CONTROL}
                          value={slot.earfcn}
                          onChange={(event) =>
                            setSlotField(index, "earfcn", event.target.value)
                          }
                          disabled={isLocking}
                        />
                      )}
                    </div>

                    <div className={SLOT_ROW.PCI}>
                      <Label htmlFor={pciId} className="sr-only">
                        {t(`${K}.fields.pci`)}
                      </Label>
                      <Input
                        id={pciId}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={t(`${K}.live.tile_pci`)}
                        host={host}
                        className={FIELD_CONTROL}
                        value={slot.pci}
                        onChange={(event) =>
                          setSlotField(index, "pci", event.target.value)
                        }
                        disabled={isLocking}
                      />
                    </div>
                  </div>

                  <div className={SLOT_ROW.META}>
                    <button
                      type="button"
                      className={SLOT_ROW.CLEAR}
                      aria-label={t(`${K}.fields.slot_clear`, {
                        index: index + 1,
                      })}
                      onClick={() => clearSlot(index)}
                      disabled={isLocking || blank}
                    >
                      <MaterialSymbol name="close" size={16} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          {/* A half-filled slot is dropped on write. Warning: the lock still
              applies, just not to that cell. */}
          {hasPartialSlot ? (
            <div
              role="alert"
              className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.fill}`}
            >
              <span
                aria-hidden="true"
                className={`${NOTICE.DISC} ${NOTICE_TONE.warning.disc}`}
              >
                <MaterialSymbol name={NOTICE_TONE.warning.glyph} size={16} />
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">
                {t(`${K}.toast.incomplete`)}
              </span>
            </div>
          ) : null}
        </CardContent>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLocking ? t(`${K}.a11y.applying`, { leg: shortName }) : ""}
        </div>

        <CardFoot
          className={CARD_PAD}
          status={
            <>
              <RevealButton
                glyph="close"
                label={t(`${K}.actions.clear_fields`)}
                onClick={() => setSlots(slotsFromCells(undefined))}
                disabled={isLocking || !hasAnyValue}
              />
              {footStatus}
            </>
          }
          actions={
            <>
              <TowerPersistField
                leg="lte"
                modemState={modemState}
                disabled={isLocking || isSavingSettings}
                onSetPersist={onSetPersist}
              />
              {/* One write at a time, whichever the state calls for: Remove
                  lock while the saved lock is what is on the modem, Lock when
                  there is none or the fields now differ from it. An unreadable
                  lock state shows both: Remove lock is harmless when nothing is
                  locked, and the way out when something is. */}
              {showUnlock ? (
                <Button
                  type="button"
                  size="action"
                  onClick={() => setShowUnlockDialog(true)}
                  disabled={isLocking}
                >
                  {t(`${K}.actions.unlock`)}
                </Button>
              ) : null}
              {showLock ? (
                <SaveButton
                  onClick={requestLock}
                  isSaving={isLocking}
                  saved={saved}
                  label={t(`${K}.actions.lock`)}
                  blockedReason={lockBlockedReason}
                  size="action"
                />
              ) : null}
            </>
          }
        />
      </Card>

      <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.dialog.lock_lte_title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.dialog.lock_lte_body`, {
                count: pendingCells.length,
                summary: pendingCells[0]
                  ? t(`${K}.live.target_pair`, {
                      channel: `${t(`${K}.live.tile_earfcn`)} ${pendingCells[0].earfcn}`,
                      pci: pendingCells[0].pci,
                    })
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="tonal-neutral" size="action">
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmLock} size="action">
              {t(`${K}.actions.lock`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${K}.dialog.unlock_title`, { leg: shortName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.dialog.unlock_body`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="tonal-neutral" size="action">
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnlock} size="action">
              {t(`${K}.actions.unlock`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
