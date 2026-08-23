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
import { Tag } from "@/components/ui/tag";
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
  FIELD_CONTROL_ON_CONTAINER,
  LEG_BADGE,
  NOTICE,
  NOTICE_TONE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  PILL_QUIET,
  READBACK,
  SKELETON_SHAPE,
  SLOT_ROW,
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
// A SLOT IS A ROW (see `shapes.ts` > SLOT_ROW)
// -----------------------------------------------------------------------------
// The three slots render as three ~58px rows, not as three stacked panels. The
// row is the only place on this surface where a visible field label is spent to
// buy density — see the comment on the slot list itself for what replaces it and
// why that trade is safe. Everything the panels hosted survives: both inputs,
// Simple Mode's carrier `Select`, the per-slot clear, and the "Serving" chip.
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
 * `FIELD_CONTROL_ON_CONTAINER`'s `h-[2.625rem]` cannot win against the
 * primitive's `data-[size=default]:h-9` on its own — they are different variant
 * groups, so `tailwind-merge` keeps both and the data-attribute rule applies.
 * The override has to be written in the same variant to replace it.
 *
 * `dark:hover:bg-surface-container-high!` is the SECOND override the same trap
 * demands and this line was missing: `select.tsx` ships `dark:hover:bg-input/50`,
 * so in dark mode the trigger's resting fill was correct and it flipped to
 * `input/50` the moment a pointer touched it. The `dark:` half of the base pair
 * only defends the RESTING state.
 *
 * The `!` is load-bearing for the same reason it is on the base pair: both
 * rules compile to (0,3,0) — utility + `.dark` + `:hover` — so they TIE, and a
 * tie is settled by emission order, which for two candidates of one utility is
 * Tailwind's name sort (`bg-input…` before `bg-surface-…`). Winning on the
 * letter `i` preceding `s` is an outcome we observed, not one we built. See
 * `shapes.ts` > FIELD_CONTROL for the full note.
 */
const SELECT_CONTROL = `${FIELD_CONTROL_ON_CONTAINER} w-full data-[size=default]:h-[2.625rem] dark:hover:bg-surface-container-high!`;

/**
 * THE TWO FIELD WIDTHS INSIDE A SLOT ROW.
 *
 * `SLOT_ROW.FIELDS` is a wrapping flex line, so each field declares a `flex`
 * shorthand rather than a width: a basis for the comfortable case, `1` to grow
 * into a wide card, and shrink so the pair narrows BEFORE `SLOT_ROW.META` gets
 * pushed off the row. Once the card is narrower than roughly `8.5rem + 5.5rem`
 * plus the index label, the line wraps and the two fields drop under `Slot N`
 * intact — which is the degradation the row was designed for, and the reason
 * neither of these carries a fixed `w-`.
 *
 * The channel gets twice the growth of the PCI: an EARFCN runs to five digits
 * and a PCI to three, and in Simple Mode the same box hosts a `Select` whose
 * option text is far longer than either.
 */
const SLOT_FIELD_CHANNEL = "flex min-w-0 flex-[2_1_8.5rem] flex-col";
const SLOT_FIELD_PCI = "flex min-w-0 flex-[1_1_5.5rem] flex-col";

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

  /**
   * THE THIRD POSTURE IS NOT DECORATIVE.
   *
   * `status.sh` seeds `lte_locked="false"` before it asks the modem anything,
   * so a failed `AT+QNWLOCK="common/4g"` read reaches this card as a plain
   * `false` and used to paint the confident green `Unlocked` chip — the card
   * asserting a fact nobody read back, on the one page whose entire job is to
   * report what the radio was told. `lte_read_ok` is the only thing that can
   * tell the two apart.
   *
   * `=== false`, NEVER `!== true`. The field is optional (see
   * `TowerModemState`): a statically-exported page bundle can outlive the CGI
   * it talks to, and `!== true` would repaint every card on an un-upgraded
   * modem as unknown.
   */
  const posture: LegPosture =
    !modemState || modemState.lte_read_ok === false
      ? "unknown"
      : modemState.lte_locked
        ? "locked"
        : "unlocked";
  const status = LEG_BADGE[posture];
  const statusLabel =
    posture === "locked"
      ? t("tower_locking.card.status_locked")
      : posture === "unlocked"
        ? t("tower_locking.card.status_unlocked")
        : t("tower_locking.card.status_unknown");

  /**
   * The pairs the MODEM reports as its lock targets, read ONLY when it also
   * reports the leg as locked.
   *
   * Never `config` and never the form: those two say what was asked for, and
   * this line exists to say what the radio was actually told — see `shapes.ts`
   * > READBACK. The `lte_locked` guard is the same one `matchVerdict` applies,
   * and for the same reason: `lte_cells` can outlive a release, so printing it
   * unconditionally would caption a stale target with "Modem reports".
   */
  const readbackCells = useMemo<LteLockCell[]>(
    () =>
      // The `read_ok` half is the same guard as `posture` above, for the same
      // reason: an unread leg has no read-back to print, and the seeded
      // `lte_locked=false` would otherwise pass this off as "nothing locked".
      modemState?.lte_read_ok !== false && modemState?.lte_locked
        ? (modemState.lte_cells ?? [])
        : [],
    [modemState],
  );

  /**
   * Is the radio camped on this exact pair right now?
   *
   * `carriers` arrives pre-filtered to LTE by the parent (see the prop's
   * contract), so no technology test belongs here. ABSENCE of the resulting chip
   * is what says "configured, not currently in use" — there is deliberately no
   * second chip for the negative case.
   */
  const isOnAir = (channel: number, cellPci: number): boolean =>
    carriers.some((c) => c.earfcn === channel && c.pci === cellPci);

  /**
   * Does the form describe something other than what the modem is already
   * holding? Gates the Lock action, the same way band locking's pending count
   * gates "Lock selected" and the NR card's own `hasChanges` gates its apply.
   *
   * THIS IS NOT COSMETIC. Re-sending the identical target still runs
   * `AT+QNWLOCK="common/4g"` and still bounces the link for 3-5 seconds on the
   * device serving this page — a real cost for a guaranteed no-op. Leaving the
   * button live also made the two leg cards disagree while both read "Locked",
   * which a reader can only interpret as one of them being broken.
   *
   * Order-insensitive: the three slots are a SET of acceptable cells, and the
   * radio only has to camp on one of them, so slot 1 and slot 2 swapping places
   * is not a change worth a link bounce. Compared as sorted `earfcn:pci` keys
   * rather than by index for exactly that reason.
   */
  const hasChanges = useMemo(() => {
    const key = (cells: LteLockCell[]) =>
      cells
        .map((c) => `${c.earfcn}:${c.pci}`)
        .sort()
        .join("|");
    return key(validCells) !== key(readbackCells);
  }, [validCells, readbackCells]);

  /**
   * WHY `Lock Tower` CANNOT BE PRESSED, IN WORDS.
   *
   * It was one boolean OR of three unrelated conditions, so all three collapsed
   * into one unexplained grey pill. The worst of them by a distance is the last:
   * the reader sees "Locked", sees their own numbers sitting in the fields, and
   * finds the button dead — with nothing anywhere on the card saying that those
   * numbers ARE the current targets and there is nothing left to write.
   *
   * A non-null string is both the reason and the gate (see `SaveButton`'s
   * `blockedReason`), so the two cannot drift apart. `isLocking` is deliberately
   * NOT in here: the button is already showing a spinner and "Saving…", which is
   * that reason, said better and in the place the eye is already looking.
   */
  const lockBlockedReason = isLocking
    ? null
    : validCells.length === 0
      ? hasAnyValue
        ? t("tower_locking.blocked.lock_incomplete_lte")
        : t("tower_locking.blocked.lock_empty_lte")
      : posture === "locked" && !hasChanges
        ? t("tower_locking.blocked.lock_unchanged")
        : null;

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
   * The one and only entry point to the lock dialog: the footer's Lock action.
   *
   * There used to be a second — an "enable" `Switch` whose `checked` came from
   * the modem read-back while its ON action wrote whatever was sitting UNSAVED
   * in the fields below. It was simultaneously a state display and two different
   * writes, and a switch promises instant, cheap and reversible.
   * `AT+QNWLOCK="common/4g"` pins the radio to a single physical cell and
   * bounces the link for 3-5 seconds — on the device serving this very page.
   * That is a deliberate button with a confirmation, which is what band locking
   * already settled on. The header `Badge` keeps reporting the state.
   */
  const requestLock = () => {
    if (validCells.length === 0) {
      toast.warning(t("tower_locking.toast.no_targets"));
      return;
    }
    setPendingCells(validCells);
    setShowLockDialog(true);
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
          {/* The read-back line, then Simple Mode: two children, two mirrors.
              Both measurements come from SKELETON_SHAPE, so neither can drift
              from the geometry it stands in for. */}
          <Skeleton className={SKELETON_SHAPE.READBACK} />
          <Skeleton className={SKELETON_SHAPE.SETTINGS_ROW} />
          {/* THE SLOT SKELETON IS THE REAL ROW, COMPOSED.
              `SLOT_ROW.ROOT` only sets a `min-h-14` floor — a loaded row hosts
              a 42px `FIELD_CONTROL` inside its vertical padding and settles
              taller than that. So there is no flat `SKELETON_SHAPE.SLOT_ROW`
              to reach for: the placeholder is built from `SLOT_ROW.ROOT` plus
              the same `FIELD_CONTROL` mirror the loaded row uses, which makes
              the two agree by construction rather than by two numbers someone
              has to keep in step by hand. */}
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
        {/* Mirrors the loaded footer's grouping too, not just its controls: two
            writes together, the form reset at the far edge. */}
        <CardFooter
          className={`${CARD_PAD} flex flex-wrap items-center justify-between gap-x-2 gap-y-3`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className={SKELETON_SHAPE.ACTION} />
            <Skeleton className={SKELETON_SHAPE.ACTION_SECONDARY} />
          </div>
          <Skeleton className={SKELETON_SHAPE.ACTION_QUIET} />
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
          {/* --- Modem read-back --------------------------------------------
              The one fact the retired locked-target panel carried that nothing
              else did, printed inches from the fields it may disagree with.
              Rendered only when there is a pair: the header chip already says
              "Unlocked", and an empty captioned box is noise. */}
          {readbackCells.length > 0 ? (
            <div className={READBACK.ROOT}>
              <span className={READBACK.LABEL}>
                <MaterialSymbol
                  name="cell_tower"
                  size={14}
                  className="flex-none"
                />
                {t("tower_locking.card.readback_label")}
              </span>
              <ul className={READBACK.LIST}>
                {readbackCells.map((cell) => (
                  <li
                    key={`${cell.earfcn}-${cell.pci}`}
                    className={READBACK.ROW}
                  >
                    <span className={READBACK.VALUE}>
                      {t("tower_locking.live.rail_target_pair", {
                        channel: `${t("tower_locking.live.tile_earfcn")} ${cell.earfcn}`,
                        pci: cell.pci,
                      })}
                    </span>
                    {isOnAir(cell.earfcn, cell.pci) ? (
                      <Badge variant="success" className="ml-auto flex-none">
                        <MaterialSymbol
                          name="cell_tower"
                          size={BADGE_GLYPH_SIZE}
                          filled
                        />
                        {t("tower_locking.live.target_serving")}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* --- Simple Mode ------------------------------------------------- */}
          <div className="flex flex-col gap-1.5">
            <div className={CONTROL_ROW}>
              <Label htmlFor="lte-simple-mode" className="min-w-0 gap-1.5">
                <MaterialSymbol
                  name="tune"
                  size={18}
                  className="text-on-surface-variant"
                />
                {/* No `defaultValue`. This line used to key off
                    `simple_mode_label`, which exists in no locale, with the
                    English text supplied inline — so it rendered English in all
                    five languages and `i18n:check` could not see it (it grades a
                    missing key as a warning and exits 0, and a literal has no
                    key to be missing). A defaultValue is how that hides. */}
                {t("tower_locking.card.simple_mode")}
              </Label>
              <Switch
                id="lte-simple-mode"
                className={SWITCH_TARGET}
                checked={simpleActive}
                onCheckedChange={handleSimpleModeToggle}
                disabled={!hasOptions || isLocking}
                /* The sentence under this row is the ONLY thing that says why
                   the switch is off and stuck. It sat there unlinked, so a
                   screen-reader user met a forced-off control with no reason
                   attached — this surface had no `aria-describedby` at all. */
                {...(!hasOptions
                  ? { "aria-describedby": "lte-simple-mode-note" }
                  : null)}
              />
            </div>
            {/* Not decoration: with the switch forced off and disabled, this is
                the only thing that says WHY. */}
            {!hasOptions ? (
              <p
                id="lte-simple-mode-note"
                className="text-on-surface-variant px-4 text-xs"
              >
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

          {/* --- Slots -------------------------------------------------------
              ONE ROW PER SLOT, AND THE FIELDS INSIDE IT STAY EDITABLE.

              This replaces three stacked panels — each a heading row over a
              two-up field grid — that put roughly 130px of card between "Cell
              1" and "Cell 2" and made a three-slot lock taller than the whole
              section above it. A slot holds two short numbers and a status, so
              it is a row.

              The compaction costs the two VISIBLE field labels, which move to
              `sr-only` with the short name carried by the placeholder instead.
              That is the one thing a compact row cannot keep, and it is spent
              carefully: assistive technology still gets the full "Channel
              (EARFCN)" / "Cell ID (PCI)" wording, and each row is a
              `role="group"` labelled by its own "Cell N" heading, so a value is
              announced as the slot it belongs to rather than as one of three
              identically-named boxes.

              The dashed `SLOT_ROW.EMPTY` marks an unfilled slot. The fields
              inside it are live regardless — the mock only ever drew the
              settled state, and reading it literally would delete this card's
              primary input path. */}
          <motion.div
            className="flex flex-col gap-2"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {activeSlots.map((slot, index) => {
              const slotLabel = t("tower_locking.fields.slot", {
                index: index + 1,
              });
              const headingId = `lte-slot-${index}`;
              const earfcnId = `lte-earfcn-${index}`;
              const pciId = `lte-pci-${index}`;
              const composite = slotComposites[index] ?? "";
              /** The camped carrier this slot currently names, if any. Held as
               *  the OPTION and not as a boolean, because the trigger prints its
               *  band and channel itself rather than echoing the option row —
               *  see the trigger for why the two cannot be the same markup. */
              const pickedOption =
                carrierOptions.find(
                  (option) =>
                    compositeValue(option.earfcn, option.pci) === composite,
                ) ?? null;
              const blank = isSlotBlank(slot);
              const cell = slotToCell(slot);
              /** ABSENCE of this chip is the negative case. There is
               *  deliberately no second chip for "configured, not in use" — a
               *  chip in both states halves the signal of the positive one. */
              const serving = cell !== null && isOnAir(cell.earfcn, cell.pci);

              return (
                <motion.div
                  key={index}
                  variants={staggerRowItem}
                  role="group"
                  aria-labelledby={headingId}
                  className={blank ? SLOT_ROW.EMPTY : SLOT_ROW.ROOT}
                >
                  <span id={headingId} className={SLOT_ROW.INDEX}>
                    {slotLabel}
                  </span>

                  <div className={SLOT_ROW.FIELDS}>
                    <div className={SLOT_FIELD_CHANNEL}>
                      <Label htmlFor={earfcnId} className="sr-only">
                        {t("tower_locking.fields.earfcn")}
                      </Label>
                      {simpleActive ? (
                        <Select
                          value={pickedOption ? composite : ""}
                          onValueChange={(value) => handleSlotPick(index, value)}
                          disabled={isLocking}
                        >
                          <SelectTrigger
                            id={earfcnId}
                            className={SELECT_CONTROL}
                            aria-label={t("tower_locking.fields.earfcn")}
                          >
                            {/* THE TRIGGER PRINTS THE READING, NOT THE OPTION
                                ROW — which is why this is a hand-rolled span
                                and not the `SelectValue` it used to be.
                                `SelectValue` mirrors the selected item's whole
                                markup, so the option's PCC/SCC chip came with
                                it, and a slot row that is also carrying its
                                index, a PCI field, a "Serving" chip and a clear
                                button has nowhere to put a chip: the channel
                                truncated to `PCC B28 …`, losing the one number
                                the control exists to show. The chip stays in
                                the dropdown, where the row is full-width and
                                the distinction is actually being used. */}
                            {pickedOption ? (
                              /* `truncate`, not `line-clamp-1`: a clamp cuts on
                                 the glyph and leaves no mark, so a squeezed
                                 `B28 – 9485` reads as the complete value `B28 –
                                 9`. An ellipsis at least says a digit is
                                 missing. `SLOT_ROW.FIELDS` is what keeps it from
                                 coming up. */
                              <span className="text-on-surface min-w-0 truncate font-mono text-sm font-semibold tabular-nums">
                                {t("tower_locking.live.tile_band_channel", {
                                  band:
                                    pickedOption.band ||
                                    t("tower_locking.live.tile_no_value"),
                                  channel: pickedOption.earfcn,
                                })}
                              </span>
                            ) : cell === null ? (
                              <SelectValue
                                placeholder={t(
                                  "tower_locking.fields.pick_placeholder",
                                )}
                              />
                            ) : (
                              /* A value the radio is not currently reporting is
                                 still a legitimate lock target, so the trigger
                                 prints it rather than falling back to the
                                 placeholder and implying the slot is empty. It
                                 keeps its PCI: with no band to name it by, the
                                 pair is all this cell has. */
                              <span className="text-on-surface-variant min-w-0 truncate font-mono text-sm italic tabular-nums">
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
                                    {/* BAND AND CHANNEL, AND NOTHING ELSE.
                                        This row used to run band, then
                                        `9485, PCI 135`, then `-107 dBm` — four
                                        readings across a control whose whole job
                                        is to name ONE cell. The PCI is not
                                        dropped, it is relocated: picking an
                                        option writes it into the PCI field
                                        inches to the right, where it is both
                                        visible and editable, so printing it here
                                        too asked the reader to reconcile two
                                        copies of the same number. The RSRP was
                                        never a choosing criterion at all — the
                                        camped tiles above already rank the
                                        carriers by signal.

                                        `text-sm` rather than the retired
                                        `text-xs`: with one reading left, the
                                        line can carry the trigger's own size
                                        instead of shrinking to fit a crowd.

                                        The PCC/SCC chip stays, and is the one
                                        thing on the row that is NOT a reading:
                                        it says whether the cell is the primary
                                        carrier or one the network aggregated
                                        alongside it, which is the difference
                                        between "the anchor this lock will hold"
                                        and "a cell that only exists while the
                                        aggregation does". Same chip, same
                                        variant, same position as the NR card's
                                        picker — the two legs sit on one page.

                                        `lte`, the IDENTITY variant, and never
                                        `secondary`: this codebase's `secondary`
                                        is byte-identical to `surface-container`,
                                        so on a dropdown row painted in the same
                                        family the chip disappeared into its own
                                        background. The violet is the same one
                                        the camped tiles wear in the strip above,
                                        which is the point — it is the SAME chip
                                        for the same carrier, one section apart.
                                        It says which radio, never "healthy";
                                        PCC vs SCC is carried by the word. */}
                                    <Tag variant="lte" className="flex-none">
                                      {option.type}
                                    </Tag>
                                    <span className="text-on-surface min-w-0 truncate font-mono text-sm font-semibold tabular-nums">
                                      {t(
                                        "tower_locking.live.tile_band_channel",
                                        {
                                          band:
                                            option.band ||
                                            t(
                                              "tower_locking.live.tile_no_value",
                                            ),
                                          channel: option.earfcn,
                                        },
                                      )}
                                    </span>
                                    {/* The PCI still reaches assistive tech,
                                        which cannot glance right at the field
                                        the pick fills. */}
                                    <span className="sr-only">
                                      {t("tower_locking.fields.pci")}{" "}
                                      {option.pci}
                                    </span>
                                    {/* `slot_in_use`, not `slot`: on its own,
                                        "Cell 2" beside a disabled option reads
                                        as a second name for the option rather
                                        than as the reason it is disabled. */}
                                    {usedIn !== -1 ? (
                                      <span className="text-on-surface-variant flex-none text-xs">
                                        {t("tower_locking.fields.slot_in_use", {
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
                          placeholder={t("tower_locking.live.tile_earfcn")}
                          className={`${FIELD_CONTROL_ON_CONTAINER} font-mono tabular-nums`}
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
                    <div className={SLOT_FIELD_PCI}>
                      <Label htmlFor={pciId} className="sr-only">
                        {t("tower_locking.fields.pci")}
                      </Label>
                      <Input
                        id={pciId}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={t("tower_locking.live.tile_pci")}
                        className={`${FIELD_CONTROL_ON_CONTAINER} font-mono tabular-nums`}
                        value={slot.pci}
                        onChange={(event) =>
                          setSlotField(index, "pci", event.target.value)
                        }
                        disabled={isLocking}
                      />
                    </div>
                  </div>

                  <div className={SLOT_ROW.META}>
                    {serving ? (
                      <Badge variant="success">
                        <MaterialSymbol
                          name="cell_tower"
                          size={BADGE_GLYPH_SIZE}
                          filled
                        />
                        {t("tower_locking.live.target_serving")}
                      </Badge>
                    ) : null}
                    <button
                      type="button"
                      className={SLOT_CLEAR}
                      aria-label={t("tower_locking.fields.slot_clear", {
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
            row-mate leaves its buttons floating above a void.

            TWO WRITES, THEN A FORM RESET. The two consequential actions are
            grouped and `Clear fields` is pushed to the far edge, so the footer
            cannot read as three equal pills — same construction as
            `band-grid-card.tsx`'s footer, which this surface is converging on. */}
        <CardFooter
          className={`${CARD_PAD} mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-3`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {/* Symmetrical with the NR card: a form that parses is always
                lockable while nothing is locked, and only a leg already holding
                these exact cells has nothing left to write. See `hasChanges`. */}
            <SaveButton
              onClick={requestLock}
              isSaving={isLocking}
              saved={saved}
              label={t("tower_locking.actions.lock")}
              blockedReason={lockBlockedReason}
              className={PILL_ACTION_PLAIN}
            />
            {/* Gated on `posture`, NOT on `config.lte.enabled`: offering to
                remove a lock the modem does not report is offering an action
                with no effect, and `unknown` means nobody has successfully read
                the modem — so it is disabled rather than optimistically live. */}
            <Button
              type="button"
              variant="outline"
              className={PILL_ACTION}
              onClick={() => setShowUnlockDialog(true)}
              disabled={isLocking || posture !== "locked"}
            >
              <MaterialSymbol name="lock_open" size={18} />
              {t("tower_locking.actions.unlock")}
            </Button>
          </div>
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
