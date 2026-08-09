"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
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
import { Switch } from "@/components/ui/switch";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type { CarrierComponent } from "@/types/modem-status";
import type {
  LteLockCell,
  TowerLockConfig,
  TowerModemState,
} from "@/types/tower-locking";

import { compositeValue, parseCompositeValue } from "./simple-mode-utils";
import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  FIELD_CONTROL,
  FIELD_GRID,
  FIELD_LABEL,
  FIELD_SLOT,
  FIELD_SLOT_HEAD,
  LEG_BADGE,
  NOTICE,
  NOTICE_TONE,
  PILL_ACTION_PLAIN,
  PILL_QUIET,
  SKELETON_SHAPE,
  TOWER_CARD,
  legDescriptionKey,
  legShortKey,
  legTitleKey,
  type LegPosture,
} from "./shapes";

// =============================================================================
// LteTowerCard — the LTE leg of tower locking, as one peer card
// =============================================================================
// Replaces `lte-locking.tsx`. The behaviour is the incumbent's; the geometry,
// tone and copy all come from `shapes.ts` and the `tower_locking` i18n subtree,
// which is the whole point of the rebuild — the incumbent restated its card
// shell per branch, painted its own tones, and shipped every string as an
// English literal that no locale could ever reach.
//
// -----------------------------------------------------------------------------
// THREE CARD SHELLS, ONE CONSTANT
// -----------------------------------------------------------------------------
// The loading and loaded branches both render `TOWER_CARD` with `CARD_PAD`, the
// same way `band-grid-card.tsx` does. A radius fixed in one branch can no longer
// stay wrong in the other.
//
// -----------------------------------------------------------------------------
// THE EMPTY STATE IS INLINE, NOT A BRANCH
// -----------------------------------------------------------------------------
// `band-grid-card.tsx` can replace its whole content region when a category
// reports no supported bands, because there is genuinely nothing to interact
// with. This card cannot: its empty copy is "Pick a cell from the tiles above,
// or type a channel and PCI", and swapping out the slots would remove the very
// fields that sentence points at. So "no targets yet" renders as a block ABOVE
// the slot list rather than instead of it. Same three states, same shell — the
// empty one just keeps its own exit route on screen.
//
// -----------------------------------------------------------------------------
// WHY SIMPLE MODE SURVIVES THE REBUILD
// -----------------------------------------------------------------------------
// `shapes.ts` argues that the hero's on-air tile picker is what Simple Mode was
// invented to work around. That is true for the common case, and the `prefill`
// prop is that path. Simple Mode stays because it is the only way to fill slot 2
// and slot 3 from the carrier list without leaving the card, and because a user
// who has scrolled past the hero should not have to scroll back. It is a
// per-card, localStorage-backed preference, and it force-disables itself the
// moment the radio reports no LTE carrier — a dropdown over an empty list is a
// dead control, not a simpler one.
// =============================================================================

/** Fixed slot count. `AT+QNWLOCK="common/4g"` accepts at most three cells. */
const SLOT_COUNT = 3;

const STORAGE_KEY_LTE_SIMPLE_MODE = "qmanager_tower_lte_simple_mode";

/**
 * A settings row inside the card.
 *
 * Deliberately NOT `HERO_ROW` from `shapes.ts`, even though the geometry is
 * identical: that constant paints `bg-surface` because it sits on the hero's
 * `surface-container` panels. A card IS `bg-surface`, so the same fill here
 * would render an invisible row. Same shape, one step up the tonal ladder.
 */
const CONTROL_ROW =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-field bg-surface-container px-4 py-3";

/**
 * The 44px coarse-pointer target for a `Switch`.
 *
 * The primitive paints at 18x32px, which is well under this project's floor. An
 * overlay reaches the target without adding a layout box that would push the
 * row's label off its baseline — the same construction `HERO_REFRESH_BUTTON`
 * uses, restated because it is a different element with a different paint size.
 */
const SWITCH_TARGET =
  "relative before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']";

/**
 * A slot's clear affordance. 20px glyph, `before:` overlay to 44px.
 *
 * Restated rather than aliased to `NOTICE.DISMISS`: the two are the same size by
 * coincidence of the coarse-pointer floor, not by a shared meaning, and aliasing
 * would make a future change to the notice silently move this.
 */
const SLOT_CLEAR =
  "relative -mr-1 grid size-6 flex-none place-items-center rounded-pill text-on-surface-variant transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-2.5 before:content-[''] hover:bg-current/10 hover:text-on-surface focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55";

/**
 * Select trigger geometry.
 *
 * `FIELD_CONTROL`'s `h-[2.625rem]` cannot win against the primitive's
 * `data-[size=default]:h-9` on its own — they are different variant groups, so
 * `tailwind-merge` keeps both and the data-attribute rule applies. The override
 * has to be written in the same variant to replace it.
 */
const SELECT_CONTROL = `${FIELD_CONTROL} w-full data-[size=default]:h-[2.625rem]`;

/** One slot's two raw field values. Strings, because the user is mid-typing. */
interface SlotValue {
  earfcn: string;
  pci: string;
}

/** A live LTE carrier, reduced to what the picker actually renders. */
interface SlotCarrier {
  earfcn: number;
  pci: number;
  band: string;
  type: "PCC" | "SCC";
  rsrp: number | null;
}

const EMPTY_SLOT: SlotValue = { earfcn: "", pci: "" };

function slotsFromCells(
  cells: (LteLockCell | null)[] | undefined,
): SlotValue[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const cell = cells?.[index];
    return cell
      ? { earfcn: String(cell.earfcn), pci: String(cell.pci) }
      : EMPTY_SLOT;
  });
}

function isSlotBlank(slot: SlotValue): boolean {
  return slot.earfcn.trim() === "" && slot.pci.trim() === "";
}

/** A slot contributes a cell only when BOTH halves parse. Half-filled is dropped. */
function slotToCell(slot: SlotValue): LteLockCell | null {
  const earfcn = Number.parseInt(slot.earfcn, 10);
  const pci = Number.parseInt(slot.pci, 10);
  if (Number.isNaN(earfcn) || Number.isNaN(pci)) return null;
  return { earfcn, pci };
}

export interface LteTowerCardProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  /** Live QCAINFO carriers, already filtered to technology === "LTE" by the caller. */
  carriers: CarrierComponent[];
  isLoading: boolean;
  isLocking: boolean;
  /** Set when the user clicks "Use this cell" on a hero tile. Apply into the
   *  first EMPTY slot; if all three are full, ignore it (the hero disables the
   *  button in that case, so this is a belt-and-braces guard). */
  prefill: { cell: LteLockCell; nonce: number } | null;
  /**
   * How many of the three slots are currently blank, reported upward so the
   * hero can DISABLE its "use this cell" pill with a reason instead of letting
   * the click land on a card that will silently drop it.
   *
   * The card has to be the one to say this: slot occupancy includes local,
   * unsaved edits, so the container cannot derive it from `config`.
   */
  onFreeSlotsChange?: (free: number) => void;
  onLock: (cells: LteLockCell[]) => Promise<boolean>;
  onUnlock: () => Promise<boolean>;
}

export default function LteTowerCard({
  config,
  modemState,
  carriers,
  isLoading,
  isLocking,
  prefill,
  onLock,
  onUnlock,
  onFreeSlotsChange,
}: LteTowerCardProps): React.JSX.Element {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  /** The leg's own short name. NEVER derived from the rendered title — see
   *  `shapes.ts` > `legTitleKey` for the translation bug that pattern caused. */
  const shortName = t(legShortKey("lte"));

  const [slots, setSlots] = useState<SlotValue[]>(() =>
    slotsFromCells(config?.lte?.cells),
  );

  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    // Lazy, and guarded: this component renders during the static export's
    // prerender, where `window` does not exist. Reading localStorage in the
    // initialiser body rather than in an effect is also what keeps the first
    // client paint from flipping the switch under the user.
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY_LTE_SIMPLE_MODE) === "true";
  });

  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [pendingCells, setPendingCells] = useState<LteLockCell[]>([]);

  // ---------------------------------------------------------------------------
  // DO NOT convert either adjustment below to a useEffect.
  // ---------------------------------------------------------------------------
  // This is React's documented "adjust state when a prop changes" pattern, run
  // during render. Both inputs are rebuilt by the parent on every poll, so an
  // effect keyed on them would loop; and because the react-hooks compiler plugin
  // bails at the FIRST violation in a component, introducing one here would also
  // silently hide every later diagnostic in this file.
  //
  // They are resolved into a single `setSlots` call against a local `base`
  // rather than as two independent setters, for two reasons:
  //
  //   1. IDEMPOTENCE. React (and StrictMode especially) may re-run this render
  //      before committing. Every branch below is a pure function of props plus
  //      the CURRENT `slots`, so running it twice lands on the same value. A
  //      functional updater would not: applied twice, a prefill would fill two
  //      slots instead of one.
  //   2. COMPOSITION. If a config poll and a hero prefill ever land in the same
  //      render, the prefill searches the config-synced slots — not the stale
  //      ones — so neither write silently discards the other.
  // ---------------------------------------------------------------------------
  const [prevCells, setPrevCells] = useState(config?.lte?.cells);
  const [prevNonce, setPrevNonce] = useState<number | null>(null);

  const configCells = config?.lte?.cells;
  let base = slots;
  let nextSlots: SlotValue[] | null = null;

  if (configCells !== prevCells) {
    setPrevCells(configCells);
    base = slotsFromCells(configCells);
    nextSlots = base;
  }

  if (prefill && prefill.nonce !== prevNonce) {
    setPrevNonce(prefill.nonce);
    const target = base.findIndex(isSlotBlank);
    // All three full: ignore. The hero already disables its button here, so
    // reaching this line means the two views disagreed — dropping the prefill is
    // the honest resolution, never overwriting a cell the user typed.
    if (target !== -1) {
      const applied = [...base];
      applied[target] = {
        earfcn: String(prefill.cell.earfcn),
        pci: String(prefill.cell.pci),
      };
      nextSlots = applied;
    }
  }

  if (nextSlots) setSlots(nextSlots);
  const activeSlots = nextSlots ?? slots;

  // Report free-slot count upward so the hero's picker can explain itself when
  // there is nowhere left to put a cell. An effect rather than a render-time
  // call: this writes to a PARENT's state, and doing that during render would
  // be a cross-component update React rejects.
  const freeSlots = activeSlots.filter(isSlotBlank).length;
  useEffect(() => {
    onFreeSlotsChange?.(freeSlots);
  }, [freeSlots, onFreeSlotsChange]);

  // --- Derived ---------------------------------------------------------------

  /** The picker's option list: live LTE carriers, PCC first, deduped on (earfcn, pci). */
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
        rsrp: carrier.rsrp,
      });
    }
    return out;
  }, [carriers]);

  const hasOptions = carrierOptions.length > 0;
  /** Simple Mode is a preference; this is whether it is actually in force. */
  const simpleActive = simpleMode && hasOptions;

  /** Each slot's composite key, or "" when the pair does not parse. Drives the
   *  cross-slot dedup in the picker. */
  const slotComposites = useMemo(
    () =>
      activeSlots.map((slot) => {
        const cell = slotToCell(slot);
        return cell ? compositeValue(cell.earfcn, cell.pci) : "";
      }),
    [activeSlots],
  );

  const validCells = useMemo(
    () =>
      activeSlots
        .map(slotToCell)
        .filter((cell): cell is LteLockCell => cell !== null),
    [activeSlots],
  );

  /** A slot with exactly one half filled is silently dropped on write. Say so. */
  const hasPartialSlot = activeSlots.some(
    (slot) => !isSlotBlank(slot) && slotToCell(slot) === null,
  );
  const hasAnyValue = activeSlots.some((slot) => !isSlotBlank(slot));

  const posture: LegPosture = modemState
    ? modemState.lte_locked
      ? "locked"
      : "unlocked"
    : "unknown";
  const status = LEG_BADGE[posture];
  const statusLabel =
    posture === "locked"
      ? t("tower_locking.card.status_locked")
      : posture === "unlocked"
        ? t("tower_locking.card.status_unlocked")
        : t("tower_locking.card.status_unknown");

  const isEnabled = modemState?.lte_locked ?? config?.lte?.enabled ?? false;

  // --- Handlers --------------------------------------------------------------

  const setSlotField = (index: number, field: keyof SlotValue, value: string) => {
    setSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)),
    );
  };

  const clearSlot = (index: number) => {
    setSlots((prev) => prev.map((slot, i) => (i === index ? EMPTY_SLOT : slot)));
  };

  const handleSimpleModeToggle = (on: boolean) => {
    setSimpleMode(on);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_LTE_SIMPLE_MODE, String(on));
    }
  };

  /** Picking an option sets BOTH halves of the slot — that is the whole point. */
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

  /**
   * The one entry point to the lock dialog, shared by the enable switch and the
   * footer's Lock action.
   *
   * The dialog is not optional ceremony. `AT+QNWLOCK="common/4g"` pins the radio
   * to a single physical cell and bounces the link for 3-5 seconds — on a device
   * that is serving this very page. It stays deliberate.
   */
  const requestLock = () => {
    if (validCells.length === 0) {
      toast.warning(t("tower_locking.toast.no_targets"));
      return;
    }
    setPendingCells(validCells);
    setShowLockDialog(true);
  };

  const handleToggle = (checked: boolean) => {
    if (checked) requestLock();
    else setShowUnlockDialog(true);
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    const ok = await onLock(pendingCells);
    if (ok) {
      markSaved();
      toast.success(t("tower_locking.toast.locked", { leg: shortName }));
    } else {
      toast.error(t("tower_locking.toast.lock_error", { leg: shortName }));
    }
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    const ok = await onUnlock();
    if (ok) {
      toast.success(t("tower_locking.toast.unlocked", { leg: shortName }));
    } else {
      toast.error(t("tower_locking.toast.unlock_error", { leg: shortName }));
    }
  };

  // --- Loading ---------------------------------------------------------------
  // Every measurement comes from SKELETON_SHAPE, so the placeholder mirrors the
  // loaded geometry by import rather than by estimate.
  if (isLoading) {
    return (
      <Card className={TOWER_CARD}>
        <CardHeader className={CARD_PAD}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <Skeleton className={SKELETON_SHAPE.CARD_TITLE} />
              <Skeleton className={SKELETON_SHAPE.CARD_DESC} />
            </div>
            <Skeleton className={SKELETON_SHAPE.CARD_CHIP} />
          </div>
        </CardHeader>
        <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
          <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
          <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
          <div className="flex flex-col gap-3">
            {Array.from({ length: SLOT_COUNT }).map((_, index) => (
              <div key={index} className={FIELD_SLOT}>
                <Skeleton className={SKELETON_SHAPE.FIELD_LABEL} />
                <div className={FIELD_GRID}>
                  <div className="flex flex-col gap-2">
                    <Skeleton className={SKELETON_SHAPE.FIELD_LABEL} />
                    <Skeleton className={SKELETON_SHAPE.FIELD_CONTROL} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Skeleton className={SKELETON_SHAPE.FIELD_LABEL} />
                    <Skeleton className={SKELETON_SHAPE.FIELD_CONTROL} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className={`${CARD_PAD} gap-2`}>
          <Skeleton className={SKELETON_SHAPE.ACTION} />
          <Skeleton className={SKELETON_SHAPE.ACTION_SECONDARY} />
        </CardFooter>
      </Card>
    );
  }

  // --- Loaded ----------------------------------------------------------------
  return (
    <>
      <Card className={TOWER_CARD}>
        <CardHeader className={CARD_PAD}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="truncate text-lg">
                {t(legTitleKey("lte"))}
              </CardTitle>
              <CardDescription className="text-pretty">
                {t(legDescriptionKey("lte"))}
              </CardDescription>
            </div>
            <Badge variant={status.variant} className="flex-none">
              <MaterialSymbol name={status.glyph} size={BADGE_GLYPH_SIZE} />
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
          {/* --- Enable ------------------------------------------------------ */}
          <div className={CONTROL_ROW}>
            <Label htmlFor="lte-tower-lock" className="min-w-0">
              {t("tower_locking.card.enable_label")}
            </Label>
            <div className="flex items-center gap-3">
              {isLocking ? (
                <MaterialSymbol
                  name="progress_activity"
                  size={18}
                  className="text-on-surface-variant animate-spin motion-reduce:animate-none"
                />
              ) : null}
              <Switch
                id="lte-tower-lock"
                className={SWITCH_TARGET}
                checked={isEnabled}
                onCheckedChange={handleToggle}
                disabled={isLocking}
              />
            </div>
          </div>

          {/* --- Simple Mode ------------------------------------------------- */}
          <div className="flex flex-col gap-1.5">
            <div className={CONTROL_ROW}>
              <Label htmlFor="lte-simple-mode" className="min-w-0 gap-1.5">
                <MaterialSymbol
                  name="tune"
                  size={18}
                  className="text-on-surface-variant"
                />
                {t("tower_locking.card.simple_mode_label", {
                  defaultValue: "Pick from carriers on air",
                })}
              </Label>
              <Switch
                id="lte-simple-mode"
                className={SWITCH_TARGET}
                checked={simpleActive}
                onCheckedChange={handleSimpleModeToggle}
                disabled={!hasOptions || isLocking}
              />
            </div>
            {/* Not decoration: with the switch forced off and disabled, this is
                the only thing that says WHY. */}
            {!hasOptions ? (
              <p className="text-on-surface-variant px-4 text-xs">
                {t("tower_locking.live.camped_empty_title")}
              </p>
            ) : null}
          </div>

          {/* --- Empty ------------------------------------------------------- */}
          {!hasAnyValue ? (
            <div className="bg-surface-container flex flex-col items-center gap-2 rounded-tile px-6 py-6 text-center">
              <span className="bg-surface-container-high text-on-surface-variant grid size-11 place-items-center rounded-pill">
                <MaterialSymbol name="cell_tower" size={22} />
              </span>
              <p className="text-sm font-semibold">
                {t("tower_locking.card.empty_title")}
              </p>
              <p className="text-on-surface-variant max-w-72 text-sm text-pretty">
                {t("tower_locking.card.empty_body")}
              </p>
            </div>
          ) : null}

          {/* --- Slots ------------------------------------------------------- */}
          <motion.div
            className="flex flex-col gap-3"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {activeSlots.map((slot, index) => {
              const slotLabel = t("tower_locking.fields.slot", {
                index: index + 1,
              });
              const earfcnId = `lte-earfcn-${index}`;
              const pciId = `lte-pci-${index}`;
              const composite = slotComposites[index] ?? "";
              const inList = carrierOptions.some(
                (option) =>
                  compositeValue(option.earfcn, option.pci) === composite,
              );

              return (
                <motion.div
                  key={index}
                  variants={staggerRowItem}
                  className={FIELD_SLOT}
                >
                  <div className={FIELD_SLOT_HEAD}>
                    <span>{slotLabel}</span>
                    <button
                      type="button"
                      className={SLOT_CLEAR}
                      aria-label={t("tower_locking.fields.slot_clear", {
                        index: index + 1,
                      })}
                      onClick={() => clearSlot(index)}
                      disabled={isLocking || isSlotBlank(slot)}
                    >
                      <MaterialSymbol name="close" size={16} />
                    </button>
                  </div>

                  <div className={FIELD_GRID}>
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor={earfcnId} className={FIELD_LABEL}>
                        {t("tower_locking.fields.earfcn")}
                      </Label>
                      {simpleActive ? (
                        <Select
                          value={inList ? composite : ""}
                          onValueChange={(value) => handleSlotPick(index, value)}
                          disabled={isLocking}
                        >
                          <SelectTrigger
                            id={earfcnId}
                            className={SELECT_CONTROL}
                            aria-label={t("tower_locking.fields.earfcn")}
                          >
                            {/* A value the radio is not currently reporting is
                                still a legitimate lock target, so the trigger
                                prints it rather than falling back to the
                                placeholder and implying the slot is empty. */}
                            {inList || slotToCell(slot) === null ? (
                              <SelectValue
                                placeholder={t("tower_locking.fields.earfcn")}
                              />
                            ) : (
                              <span className="text-on-surface-variant line-clamp-1 min-w-0 font-mono text-sm italic tabular-nums">
                                {t("tower_locking.live.rail_target_pair", {
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
                                    <span className="text-xs font-semibold">
                                      {option.band ||
                                        t("tower_locking.live.tile_no_value")}
                                    </span>
                                    <span className="text-on-surface-variant font-mono text-xs tabular-nums">
                                      {t(
                                        "tower_locking.live.rail_target_pair",
                                        {
                                          channel: option.earfcn,
                                          pci: option.pci,
                                        },
                                      )}
                                    </span>
                                    {option.rsrp != null ? (
                                      <span className="text-on-surface-variant font-mono text-xs tabular-nums">
                                        {t("tower_locking.live.tile_rsrp", {
                                          value: option.rsrp,
                                        })}
                                      </span>
                                    ) : null}
                                    {usedIn !== -1 ? (
                                      <span className="text-on-surface-variant text-xs">
                                        {t("tower_locking.fields.slot", {
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
                          className={`${FIELD_CONTROL} font-mono tabular-nums`}
                          value={slot.earfcn}
                          onChange={(event) =>
                            setSlotField(index, "earfcn", event.target.value)
                          }
                          disabled={isLocking}
                        />
                      )}
                    </div>

                    {/* PCI stays a text input in every mode: picking a carrier
                        fills it, but a user reading a PCI off a scan must always
                        be able to type it. */}
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor={pciId} className={FIELD_LABEL}>
                        {t("tower_locking.fields.pci")}
                      </Label>
                      <Input
                        id={pciId}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        className={`${FIELD_CONTROL} font-mono tabular-nums`}
                        value={slot.pci}
                        onChange={(event) =>
                          setSlotField(index, "pci", event.target.value)
                        }
                        disabled={isLocking}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          {/* A half-filled slot is dropped on write without comment. Warning,
              not destructive: the lock still applies, just not to that cell. */}
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
                {t("tower_locking.toast.incomplete")}
              </span>
            </div>
          ) : null}
        </CardContent>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLocking ? t("tower_locking.a11y.applying", { leg: shortName }) : ""}
        </div>

        {/* `mt-auto` pins the actions to the card's floor — these cards sit in
            an equal-height grid row, so without it a card shorter than its
            row-mate leaves its buttons floating above a void. */}
        <CardFooter
          className={`${CARD_PAD} mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-3`}
        >
          <SaveButton
            onClick={requestLock}
            isSaving={isLocking}
            saved={saved}
            label={t("tower_locking.actions.lock")}
            disabled={isLocking || validCells.length === 0}
            className={PILL_ACTION_PLAIN}
          />
          <Button
            type="button"
            variant="tonal-neutral"
            className={PILL_QUIET}
            onClick={() => setSlots(slotsFromCells(undefined))}
            disabled={isLocking || !hasAnyValue}
          >
            {t("tower_locking.actions.clear_fields")}
          </Button>
        </CardFooter>
      </Card>

      {/* --- Lock confirmation --------------------------------------------- */}
      <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tower_locking.dialog.lock_lte_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tower_locking.dialog.lock_lte_body", {
                count: pendingCells.length,
                summary: pendingCells[0]
                  ? t("tower_locking.live.rail_target_pair", {
                      channel: pendingCells[0].earfcn,
                      pci: pendingCells[0].pci,
                    })
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              className={PILL_ACTION_PLAIN}
              disabled={isLocking}
            >
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLock}
              className={PILL_ACTION_PLAIN}
            >
              {t("tower_locking.actions.lock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Unlock confirmation -------------------------------------------- */}
      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tower_locking.dialog.unlock_title", { leg: shortName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tower_locking.dialog.unlock_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="tonal-neutral"
              className={PILL_ACTION_PLAIN}
              disabled={isLocking}
            >
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnlock}
              className={PILL_ACTION_PLAIN}
            >
              {t("tower_locking.actions.unlock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
