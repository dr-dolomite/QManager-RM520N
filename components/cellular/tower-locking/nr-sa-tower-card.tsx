"use client";

import * as React from "react";
import { useId, useMemo, useState } from "react";
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
import { Badge, type BadgeVariant } from "@/components/ui/badge";
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
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type { CarrierComponent, NetworkType } from "@/types/modem-status";
import type {
  NrSaLockCell,
  TowerLockConfig,
  TowerModemState,
} from "@/types/tower-locking";
import { SCS_OPTIONS } from "@/types/tower-locking";

import {
  BADGE_GLYPH_SIZE,
  CARD_PAD,
  FIELD_GRID,
  FIELD_LABEL,
  LEG_BADGE,
  NOTICE,
  NOTICE_TONE,
  PILL_ACTION,
  PILL_ACTION_PLAIN,
  PILL_QUIET,
  READBACK,
  SKELETON_SHAPE,
  TOWER_CARD,
  legDescriptionKey,
  legShortKey,
  legTitleKey,
  type LegPosture,
} from "./shapes";
import {
  defaultScsForBand,
  extractBandNumber,
  compositeValue,
  parseCompositeValue,
  type CarrierOption,
} from "./simple-mode-utils";

// =============================================================================
// NrSaTowerCard — the 5G NR-SA leg of the tower-locking surface
// =============================================================================
// One AT parameter (`AT+QNWLOCK="common/5g"`), one cell, four fields. The parent
// owns every CGI call and every poll; this card owns the form and calls back.
//
// -----------------------------------------------------------------------------
// THE GATE IS A CONDITION, NOT A DIMMER — AND NOT A DELETION EITHER
// -----------------------------------------------------------------------------
// The incumbent's answer to "you cannot lock SA right now" was `opacity-60` on
// the whole `<Card>` plus a sentence appended to the `CardDescription`. That is
// two failures in one gesture: a banned opacity wash (`shapes.ts` > NOTICE names
// this exact line as the tell it replaces), and — worse — it dimmed its own
// explanation below readable contrast. The one piece of text the user needs in
// order to act was the text made hardest to read.
//
// Its replacement swung too far the other way: the gate REPLACED the whole card
// body with a condition block, which took `Remove Lock` off the screen with it.
// That is the one control this card cannot lose. QManager runs ON the modem it
// configures, so a lock pinned to an unreachable cell takes down the page you
// would use to fix it, and `Remove Lock` is the only in-UI recovery — and a
// gated card is exactly where a stale NR lock lives, since `nr_locked` can be
// true while the network has since moved the modem to NSA.
//
// So the gate is now a STATE OF THE CARD, not a substitute for it:
//
//   * full contrast everywhere — no wash, on the card or on any child
//   * a `muted` status chip carrying its own glyph, so the header says which
//     condition is in force
//   * a tonal NOTICE at the top of the body, stating the reason in full
//   * `disabled` on the individual controls, which carry the primitives' own
//     disabled treatment — EXCEPT `Remove Lock`, which stays live whenever the
//     modem reports a lock
//
// Tone is chosen per condition, not per aesthetics, following the radio page's
// canonical mapping:
//
//   5G-NSA  warning  A real condition the user can change in situ, by switching
//                    the modem's network mode. Not a fault — hence not
//                    `destructive` — but it is standing between them and the
//                    thing they came here to do.
//   LTE     info     A standing fact. There is no NR carrier to pin, and no
//                    setting on this page changes that. Painting it amber would
//                    claim something is wrong when nothing is.
//
// Neither carries a spinner: a spinner on a standing condition advertises work
// that is not happening. They carry DIFFERENT glyphs, in the notice AND in the
// chip, because `warning-container` and `primary-container` are two container
// fills and the glyph is the channel that survives grayscale.
//
// -----------------------------------------------------------------------------
// networkType === "" IS NOT "CAPABLE"
// -----------------------------------------------------------------------------
// The incumbent gated on `=== "5G-NSA" || === "LTE"` and let every other value
// through — including the empty string the poller reports before the modem has
// answered. So on a cold load the card rendered fully enabled, with a Lock
// button live, while nobody yet knew whether SA locking was even possible. The
// honest render for "not reported yet" is the loading state, and that is what
// the branch order below does.
//
// -----------------------------------------------------------------------------
// SCS PROVENANCE IS THE WHOLE POINT OF THIS CARD
// -----------------------------------------------------------------------------
// An NR-SA lock takes a subcarrier spacing, and a wrong SCS does not fail
// loudly — the modem accepts the command and simply never camps. It is the most
// common reason a lock "silently doesn't work". Three sources, and the card says
// which one it used:
//
//   servingcell   Read back from the cell the modem is camped on. Trustworthy.
//   band_default  Inferred from the band number. A GUESS, and marked as one.
//   manual        The user typed it. No claim made either way.
//
// The guess is flagged twice: beside the field, and again inside the lock
// confirmation, because the confirmation is the last moment before the radio
// drops its connection.
// =============================================================================

export interface NrSaTowerCardProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  /** Live QCAINFO carriers, already filtered to technology === "NR" by the caller. */
  carriers: CarrierComponent[];
  networkType: NetworkType;
  /** The serving NR cell from the poller snapshot, for SCS provenance. */
  servingNr: { arfcn: number | null; pci: number | null; scs: number | null };
  isLoading: boolean;
  isLocking: boolean;
  prefill: { cell: NrSaLockCell; nonce: number } | null;
  onLock: (cell: NrSaLockCell) => Promise<boolean>;
  onUnlock: () => Promise<boolean>;
}

/** Persisted preference for the carrier-picker input path. */
const STORAGE_KEY_NR_SIMPLE_MODE = "qmanager_tower_nr_simple_mode";

type ScsSource = "manual" | "band_default" | "servingcell";

/**
 * A settings row inside a LEG card.
 *
 * Deliberately NOT `shapes.ts`'s `HERO_ROW`, which is the same anatomy: that
 * constant paints `bg-surface` because it sits inside the hero's
 * `surface-container` rail. A leg card IS `bg-surface`, so reusing it would
 * render an invisible row. Same reason it adds `justify-between` — the hero rail
 * is narrow enough that its rows wrap rather than spread.
 */
const CARD_ROW =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-field bg-surface-container px-4 py-3";

/**
 * The row's leading label. Same typographic step as band locking's
 * `HERO_RAIL_ROW_LABEL` — which lives in THAT surface's `shapes.ts`, not this
 * one. Named in full because the bare constant reads as a local import that a
 * grep of this directory will never find.
 */
const CARD_ROW_LABEL = "text-sm font-semibold";

/**
 * The 44px coarse-pointer target for a `Switch`.
 *
 * The primitive paints at 18x32px, which is well under this project's floor. An
 * overlay reaches the target without adding a layout box that would push the
 * row's label off its baseline.
 *
 * Byte-identical to the LTE card's `SWITCH_TARGET` and restated for the house
 * reason — but the reason it exists AT ALL is that this card never had one. Both
 * its switches paint under the floor; retiring the "Tower lock" switch left this
 * one as the only control in the row, directly beside an LTE card whose
 * equivalent switch does meet it. Two cards in one grid row must not disagree
 * about how big a tap target is.
 */
const SWITCH_TARGET =
  "relative before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']";

/**
 * ONE VALUE CELL IN THE 2x2 GRID.
 *
 * The label and its control are ONE filled block, rather than a 12px label
 * floating over a separate 42px box. That is the mock's denser treatment, and it
 * buys back the ~16px of dead air per row that four stacked label/control pairs
 * were spending — enough to keep this card level with its three-row row-mate.
 *
 * The control inside is painted transparent so the tile's own
 * `surface-container` is the field's fill: two nested container steps in a 56px
 * block would read as a box inside a box. THE FOCUS RING MOVES WITH IT —
 * `focus-within` on the tile, `focus-visible:ring-0` on the control — because a
 * transparent control with its ring suppressed and nothing taking it over is a
 * field a keyboard user cannot find.
 *
 * `min-h-14` (56px) with a 32px control inside a full-width `<label>` clears the
 * 44px coarse-pointer floor: a tap anywhere on the label or the control lands on
 * the control, and the two stack to 48px of live surface.
 */
const FIELD_TILE = [
  "flex min-h-14 min-w-0 flex-col justify-center gap-0.5 rounded-field bg-surface-container px-4 py-2",
  "transition-[box-shadow] duration-[var(--duration-quick)] ease-out",
  "focus-within:ring-ring/50 focus-within:ring-[3px]",
].join(" ");

/** The tile's own label step. `w-full` so clicking anywhere along it focuses
 *  the control beneath — that is what makes the 56px block one target. */
const FIELD_TILE_LABEL = `${FIELD_LABEL} w-full`;

/**
 * The control inside a tile.
 *
 * Every value here is a device identifier, so it wears the machine's voice —
 * the same `font-mono … tabular-nums` the read-back line uses two blocks up, so
 * a channel reads identically whether the modem reported it or the user typed
 * it.
 *
 * `dark:bg-transparent!` is NOT redundant: `input.tsx` ships `dark:bg-input/30`
 * and `select.tsx` adds `dark:hover:bg-input/50`, both lifted by the `dark`
 * custom variant, so a bare `bg-transparent` loses to them and the control
 * renders as a visible second box in dark mode only.
 *
 * The `!` is what makes the restatement WIN rather than merely tie. `dark:` on
 * our side compiles to the same specificity as theirs, and a tie is decided by
 * emission order — Tailwind's name sort, where `bg-input…` happens to precede
 * `bg-transparent`. That is luck, not construction; `!important` is the rule.
 * See `shapes.ts` > FIELD_CONTROL for the full note.
 */
const FIELD_TILE_CONTROL = [
  "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-0 py-0 shadow-none",
  "dark:bg-transparent!",
  "font-mono text-sm font-semibold tabular-nums",
  "focus-visible:ring-0",
].join(" ");

/**
 * The same control as a `SelectTrigger`.
 *
 * Two overrides an `Input` does not need, both because `select.tsx` writes them
 * inside a variant scope that a bare utility cannot reach: `data-[size=default]:h-9`
 * (a class plus an attribute, so it outranks a plain `h-8` and tailwind-merge
 * cannot fold the two) and `dark:hover:bg-input/50` — the latter marked
 * important for the tie-break reason above.
 */
const TILE_SELECT = [
  FIELD_TILE_CONTROL,
  "data-[size=default]:h-8 dark:hover:bg-transparent!",
].join(" ");

/**
 * The control's line box, for the loading mirror. Declared HERE, beside the
 * `h-8` it stands in for, rather than in `SKELETON_SHAPE` — that map mirrors the
 * shared 42px `FIELD_CONTROL`, which this card no longer renders. The tile
 * itself is mirrored by composing `FIELD_TILE`, so only this one measurement is
 * restated at all.
 */
const SKELETON_TILE_VALUE = "h-8 w-24 rounded-field";

/** Which gate, if any, is standing between the user and an SA lock. */
type GateKind = "nsa" | "lte_only";

/**
 * Gate → tone + the two glyphs it needs.
 *
 * The FILL and DISC come from `NOTICE_TONE` so the block can never drift from
 * the surface's other tonal containers. `NOTICE` is overridden for `lte_only`:
 * `NOTICE_TONE.info.glyph` is the generic `info` mark, and `signal_cellular_off`
 * says the actual thing — there is no NR signal to pin. `nsa` keeps the role's
 * own `warning` glyph. The two must differ, and do.
 *
 * `BADGE` is the header chip's glyph, and it is a SEPARATE field rather than a
 * reuse of `NOTICE`, because the chip shares its slot with `LEG_BADGE`'s three
 * postures. `do_not_disturb_on` and `signal_cellular_off` are distinct from each
 * other AND from `lock` / `lock_open` / `schedule`, which is the rule: two states
 * that can appear in one slot never share a mark. `warning` could not be used
 * for `nsa` here — it is `LEG_BADGE.locked`'s tone partner elsewhere on the
 * surface, and an amber-looking mark on a `muted` chip reads as a fault.
 */
const GATE_SPEC: Record<
  GateKind,
  {
    tone: "warning" | "info";
    NOTICE: MaterialSymbolName;
    BADGE: MaterialSymbolName;
  }
> = {
  nsa: {
    tone: "warning",
    NOTICE: NOTICE_TONE.warning.glyph,
    BADGE: "do_not_disturb_on",
  },
  lte_only: {
    tone: "info",
    NOTICE: "signal_cellular_off",
    BADGE: "signal_cellular_off",
  },
};

/**
 * Which SCS the card should adopt for a freshly picked cell, and where it came
 * from.
 *
 * Pure, and takes the whole cell rather than reading component state, so the
 * render-time prefill path and the Simple Mode `onValueChange` path cannot drift
 * apart — they were two separate copies of this rule in the incumbent.
 *
 * The picked cell's OWN `scs` (which `prefill` carries) is deliberately ignored:
 * the only two sources this card is willing to claim are the live serving cell
 * and the band table, and re-deriving means the provenance label is always true
 * of the number beside it.
 */
function resolveScs(
  cell: { arfcn: number; pci: number; band: number | null },
  servingNr: { arfcn: number | null; pci: number | null; scs: number | null },
): { scs: string; source: ScsSource } {
  if (
    servingNr.scs !== null &&
    servingNr.arfcn === cell.arfcn &&
    servingNr.pci === cell.pci
  ) {
    return { scs: String(servingNr.scs), source: "servingcell" };
  }
  const fallback = defaultScsForBand(cell.band);
  return {
    scs: fallback !== null ? String(fallback) : "",
    source: "band_default",
  };
}

/**
 * Live NR carriers → picker options.
 *
 * `simple-mode-utils.ts` already does this, but only from a whole `ModemStatus`
 * (`nrCarriersFromQcainfo`), and its per-component mapper and de-duplicator are
 * module-private. This card's props contract hands it a pre-filtered
 * `CarrierComponent[]` instead — the parent owns the technology filter now, so
 * two components cannot disagree about what "an NR carrier" is — so the last two
 * steps are restated here. Order and dedup key match the shared helper exactly.
 */
function toOptions(carriers: CarrierComponent[]): CarrierOption[] {
  const sorted = [...carriers].sort((a, b) => {
    if (a.type !== b.type) return a.type === "PCC" ? -1 : 1;
    return (b.rsrp ?? -200) - (a.rsrp ?? -200);
  });
  const seen = new Set<string>();
  const out: CarrierOption[] = [];
  for (const c of sorted) {
    if (c.earfcn == null || c.pci == null) continue;
    const key = compositeValue(c.earfcn, c.pci);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      earfcn: c.earfcn,
      pci: c.pci,
      band: c.band,
      bandNumber: extractBandNumber(c.band),
      type: c.type,
      bandwidthMhz: c.bandwidth_mhz,
      rsrp: c.rsrp,
      rsrq: c.rsrq,
      sinr: c.sinr,
    });
  }
  return out;
}

export default function NrSaTowerCard({
  config,
  modemState,
  carriers,
  networkType,
  servingNr,
  isLoading,
  isLocking,
  prefill,
  onLock,
  onUnlock,
}: NrSaTowerCardProps): React.JSX.Element {
  const { t } = useTranslation("cellular");
  const { t: tc } = useTranslation("common");
  const { saved, markSaved } = useSaveFlash();
  const fieldId = useId();

  const title = t(legTitleKey("nr_sa"));
  const description = t(legDescriptionKey("nr_sa"));
  /** Never derived from the rendered title — see `shapes.ts` > `legTitleKey`. */
  const legName = t(legShortKey("nr_sa"));

  // --- Form state ------------------------------------------------------------
  const [arfcn, setArfcn] = useState("");
  const [pci, setPci] = useState("");
  const [band, setBand] = useState("");
  const [scs, setScs] = useState("");
  const [scsSource, setScsSource] = useState<ScsSource>("manual");

  // ---------------------------------------------------------------------------
  // Config sync. DO NOT convert to a useEffect.
  // ---------------------------------------------------------------------------
  // React's documented "adjust state when a prop changes" pattern, run during
  // render. The snapshot is a VALUE key rather than the object identity the
  // incumbent compared: `config.nr_sa` is re-parsed from JSON on every poll, so
  // an identity comparison fires on every poll and wipes whatever the user was
  // in the middle of typing. Same correction `band-grid-card.tsx` makes with its
  // `lockedKey`, for the same reason.
  //
  // Only non-null fields are assigned: a config with a PCI but no SCS must not
  // blank an SCS the user already chose.
  // ---------------------------------------------------------------------------
  const nrSa = config?.nr_sa ?? null;
  const nrSaKey = nrSa
    ? `${nrSa.arfcn}:${nrSa.pci}:${nrSa.band}:${nrSa.scs}`
    : "";
  const [prevNrSa, setPrevNrSa] = useState<string | null>(null);
  if (prevNrSa !== nrSaKey) {
    setPrevNrSa(nrSaKey);
    if (nrSa) {
      if (nrSa.arfcn !== null) setArfcn(String(nrSa.arfcn));
      if (nrSa.pci !== null) setPci(String(nrSa.pci));
      if (nrSa.band !== null) setBand(String(nrSa.band));
      if (nrSa.scs !== null) setScs(String(nrSa.scs));
    }
  }

  // ---------------------------------------------------------------------------
  // Prefill from the hero's "Use this cell" pill. Also render-time, and it runs
  // AFTER the config sync above on purpose: a poll landing in the same frame as
  // a deliberate user pick must not win.
  //
  // Keyed on a nonce rather than on the cell's values, because picking the SAME
  // tile twice is a meaningful gesture (it restores the tile's values over an
  // edit) and a value-keyed guard would swallow it. Initialised to `null`, not
  // to the incoming nonce, so a prefill already present at mount still applies.
  // ---------------------------------------------------------------------------
  const [prevNonce, setPrevNonce] = useState<number | null>(null);
  if (prefill && prefill.nonce !== prevNonce) {
    setPrevNonce(prefill.nonce);
    setArfcn(String(prefill.cell.arfcn));
    setPci(String(prefill.cell.pci));
    setBand(String(prefill.cell.band));
    const resolved = resolveScs(prefill.cell, servingNr);
    setScs(resolved.scs);
    setScsSource(resolved.source);
  }

  // --- Simple Mode -----------------------------------------------------------
  const [simpleMode, setSimpleMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY_NR_SIMPLE_MODE) === "true";
  });

  const options = useMemo(() => toOptions(carriers), [carriers]);
  const hasOptions = options.length > 0;
  /** Simple Mode is FORCED OFF with nothing to pick from — a picker over an
   *  empty list is a dead control that looks like a live one. */
  const pickerActive = simpleMode && hasOptions;

  const handleSimpleModeToggle = (on: boolean) => {
    setSimpleMode(on);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_NR_SIMPLE_MODE, String(on));
    }
  };

  const currentComposite = useMemo(() => {
    const a = parseInt(arfcn, 10);
    const p = parseInt(pci, 10);
    if (Number.isNaN(a) || Number.isNaN(p)) return "";
    return compositeValue(a, p);
  }, [arfcn, pci]);

  const pickedOption = useMemo(
    () =>
      options.find((o) => compositeValue(o.earfcn, o.pci) === currentComposite),
    [options, currentComposite],
  );

  const handleCarrierPick = (value: string) => {
    const parsed = parseCompositeValue(value);
    if (!parsed) return;
    const opt = options.find(
      (o) => o.earfcn === parsed.earfcn && o.pci === parsed.pci,
    );
    if (!opt) return;

    setArfcn(String(opt.earfcn));
    setPci(String(opt.pci));
    if (opt.bandNumber !== null) setBand(String(opt.bandNumber));
    const resolved = resolveScs(
      { arfcn: opt.earfcn, pci: opt.pci, band: opt.bandNumber },
      servingNr,
    );
    setScs(resolved.scs);
    setScsSource(resolved.source);
  };

  // --- Derived posture -------------------------------------------------------

  /**
   * `unknown` is a real state, and until now it had no way to happen on a
   * loaded card. `status.sh` seeds `nr_locked="false"` before it asks the modem
   * anything, so a failed `AT+QNWLOCK="common/5g"` read arrived here as a plain
   * `false` and painted the confident green "Unlocked" chip — an assertion
   * nobody made, on the card whose job is to report what the radio was told.
   * `nr_read_ok` is the only thing that separates the two. See `shapes.ts` >
   * LEG_BADGE.
   *
   * `=== false`, NEVER `!== true`: the field is optional (see
   * `TowerModemState`) so that a cached page bundle meeting an un-upgraded
   * `status.sh` keeps rendering real state instead of going blank.
   */
  const posture: LegPosture =
    !modemState || modemState.nr_read_ok === false
      ? "unknown"
      : modemState.nr_locked
        ? "locked"
        : "unlocked";

  /**
   * THE CELL THE MODEM REPORTS AS LOCKED — which is `nr_cell` AND `nr_locked`,
   * never `nr_cell` alone.
   *
   * `status.sh` can return a populated `nr_cell` while `nr_locked` is false (a
   * last-known target that outlived its release), so every reader on this
   * surface has to apply the same guard: `matchVerdict` does, and `hasChanges`
   * below now does too — see the trap named there.
   */
  const lockedCell = useMemo(
    () =>
      // Third guard, same family as the two above: an UNREAD leg has no
      // read-back to report, and the seeded `nr_locked=false` would otherwise
      // pass "we could not ask" off as "nothing is locked".
      modemState?.nr_read_ok !== false && modemState?.nr_locked
        ? modemState.nr_cell
        : null,
    [modemState],
  );

  /**
   * The read-back list. One entry at most — `AT+QNWLOCK="common/5g"` takes a
   * single cell — but kept as an array so this card and its LTE row-mate render
   * the read-back through the same shape. See `shapes.ts` > READBACK.
   */
  const readbackCells = useMemo<NrSaLockCell[]>(
    () => (lockedCell ? [lockedCell] : []),
    [lockedCell],
  );

  /**
   * Is the radio camped on this exact pair right now?
   *
   * `carriers` arrives pre-filtered to NR by the parent (see the prop's
   * contract), so no technology test belongs here. ABSENCE of the resulting chip
   * is what says "configured, not currently in use" — there is deliberately no
   * second chip for the negative case.
   */
  const isOnAir = (channel: number, cellPci: number): boolean =>
    carriers.some((c) => c.earfcn === channel && c.pci === cellPci);

  const parsedCell = useMemo(() => {
    const a = parseInt(arfcn, 10);
    const p = parseInt(pci, 10);
    const b = parseInt(band, 10);
    const s = parseInt(scs, 10);
    if (
      Number.isNaN(a) ||
      Number.isNaN(p) ||
      Number.isNaN(b) ||
      Number.isNaN(s)
    ) {
      return null;
    }
    return { arfcn: a, pci: p, band: b, scs: s } satisfies NrSaLockCell;
  }, [arfcn, pci, band, scs]);

  /**
   * True when the form describes something other than what is LOCKED.
   *
   * THE TRAP: this used to compare against `modemState.nr_cell` directly, which
   * is populated even when `nr_locked` is false. On an unlocked modem whose
   * last-known cell happened to equal the form, `hasChanges` came out false and
   * the Lock button went dead — there was simply no way to lock. The "enable"
   * switch was the accidental escape hatch, so deleting the switch is what turned
   * a latent bug into a dead end. Compare against `lockedCell`, which carries the
   * `nr_locked` guard, and gate the button on `posture` (see the footer).
   */
  const hasChanges = useMemo(() => {
    if (!parsedCell) return false;
    if (!lockedCell) return true;
    return (
      lockedCell.arfcn !== parsedCell.arfcn ||
      lockedCell.pci !== parsedCell.pci ||
      lockedCell.band !== parsedCell.band ||
      lockedCell.scs !== parsedCell.scs
    );
  }, [parsedCell, lockedCell]);

  const hasAnyInput = Boolean(arfcn || pci || band || scs);

  // --- Dialogs ---------------------------------------------------------------
  const [pendingCell, setPendingCell] = useState<NrSaLockCell | null>(null);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);

  /**
   * The cell as ONE SHORT IDENTIFIER, for the confirmation SENTENCE.
   *
   * This used to join four values on a middot — band, channel, PCI, SCS — into
   * a run of machine voice dropped mid-prose. A middot earns its place only
   * between two peers in a single machine-voice run with no room for labels; a
   * four-term chain is a table that has been flattened to fit a sentence, and
   * the reader has to work out which number is which from position alone.
   *
   * So the sentence takes the pair that NAMES the cell, through the same shared
   * key the read-back line uses — and the other two values move to the labelled
   * grid below it (`DIALOG_DETAIL`), where layout does the separating.
   *
   * SCS IS STILL IN THE CONFIRMATION, which is the part that must not regress.
   * It is the one field of the four that is routinely a guess, and this is the
   * last screen before the modem drops its connection — omitting it meant the
   * number most likely to be wrong was the number the user never saw. It is now
   * shown under its own label rather than as an unexplained "30 kHz" at the end
   * of a chain.
   */
  const summarise = (cell: NrSaLockCell) =>
    t("tower_locking.live.rail_target_pair", {
      channel: `${t("tower_locking.live.tile_arfcn")} ${cell.arfcn}`,
      pci: cell.pci,
    });

  /** The SCS option's own label ("30 kHz"), or the raw value if the modem ever
   *  reports a spacing outside `SCS_OPTIONS`. */
  const scsLabelFor = (value: number) =>
    SCS_OPTIONS.find((o) => o.value === value)?.label ?? String(value);

  /**
   * The one and only entry point to the lock dialog: the footer's Lock action.
   *
   * There used to be a second — an "enable" `Switch` whose `checked` came from
   * the modem read-back while its ON action wrote whatever was sitting UNSAVED in
   * the fields above. It was simultaneously a state display and two different
   * writes, and a switch promises instant, cheap and reversible.
   * `AT+QNWLOCK="common/5g"` pins the radio to a single physical cell and bounces
   * the link for 3-5 seconds — on the device serving this very page. That is a
   * deliberate button with a confirmation, which is what band locking already
   * settled on. The header `Badge` keeps reporting the state.
   */
  const requestLock = () => {
    if (!parsedCell) {
      toast.warning(t("tower_locking.toast.incomplete"));
      return;
    }
    setPendingCell(parsedCell);
    setShowLockDialog(true);
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    if (!pendingCell) return;
    const ok = await onLock(pendingCell);
    if (ok) {
      markSaved();
      toast.success(t("tower_locking.toast.locked", { leg: legName }));
    } else {
      toast.error(t("tower_locking.toast.lock_error", { leg: legName }));
    }
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    const ok = await onUnlock();
    if (ok) {
      toast.success(t("tower_locking.toast.unlocked", { leg: legName }));
    } else {
      toast.error(t("tower_locking.toast.unlock_error", { leg: legName }));
    }
  };

  const handleClear = () => {
    setArfcn("");
    setPci("");
    setBand("");
    setScs("");
    setScsSource("manual");
  };

  // ===========================================================================
  // Loading — and "not reported yet", which is the same honest answer.
  // ===========================================================================
  if (isLoading || networkType === "") {
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
          {/* Four value tiles, mirrored by COMPOSING `FIELD_TILE` rather than
              by restating its height — the tile is the geometry, so the
              placeholder cannot drift from it. */}
          <div className={FIELD_GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={FIELD_TILE}>
                <Skeleton className={SKELETON_SHAPE.FIELD_LABEL} />
                <Skeleton className={SKELETON_TILE_VALUE} />
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

  // ===========================================================================
  // Loaded — including the two GATED conditions, which are states of this card
  // rather than a replacement for it. See the header block.
  // ===========================================================================
  const gate: GateKind | null =
    networkType === "5G-NSA" ? "nsa" : networkType === "LTE" ? "lte_only" : null;
  const gateSpec = gate ? GATE_SPEC[gate] : null;

  /**
   * Every control on the card except `Remove Lock`.
   *
   * A gated card can still be HOLDING a lock — `nr_locked` survives the network
   * moving the modem out of SA — and removing it is the one thing that must
   * stay reachable from a page served by the modem it is unlocking.
   */
  const formDisabled = isLocking || gate !== null;

  /**
   * WHY `Lock Tower` CANNOT BE PRESSED, IN WORDS.
   *
   * Four unrelated conditions used to OR into one boolean and render as one
   * unexplained grey pill. Two of them are especially bad without copy: a GATED
   * card states its condition in a notice at the top of the body, which is off
   * screen by the time the reader reaches the footer; and `locked && !hasChanges`
   * shows the user their own numbers in the fields beside a dead button, with
   * nothing saying that those numbers ARE the current target.
   *
   * A non-null string is both the reason and the gate (see `SaveButton`'s
   * `blockedReason`), so the two can never disagree. `isLocking` is deliberately
   * absent: the button is already showing a spinner and "Saving…".
   */
  const lockBlockedReason = isLocking
    ? null
    : gate === "nsa"
      ? t("tower_locking.blocked.lock_gated_nsa")
      : gate === "lte_only"
        ? t("tower_locking.blocked.lock_gated_lte_only")
        : !parsedCell
          ? hasAnyInput
            ? t("tower_locking.blocked.lock_incomplete_nr")
            : t("tower_locking.blocked.lock_empty_nr")
          : posture === "locked" && !hasChanges
            ? t("tower_locking.blocked.lock_unchanged")
            : null;

  const status = LEG_BADGE[posture];
  /** Written out rather than interpolated (`status_${posture}`): `i18n:check`
   *  grades a missing key as a warning and exits 0, so a key it cannot see
   *  statically is a key nothing will ever tell you about. */
  const statusLabel =
    posture === "locked"
      ? t("tower_locking.card.status_locked")
      : posture === "unlocked"
        ? t("tower_locking.card.status_unlocked")
        : t("tower_locking.card.status_unknown");

  /**
   * THE HEADER CHIP REPORTS ONE FACT, AND A LOCK OUTRANKS A GATE.
   *
   * Two things want this slot when the card is gated: the lock posture and the
   * condition. A locked leg wins, because it is the fact with an action attached
   * — the reader needs to see that a lock is in force before they can decide to
   * remove it — and because the gate is stated in full by the NOTICE at the top
   * of the body either way, where it has room for its reason. An unlocked or
   * unread leg yields the slot to the gate, since "Unlocked" beside an inert
   * form explains nothing.
   *
   * The variant keys onto `BadgeVariant`, never a class string, so a tone
   * without a matching chip role fails the build.
   */
  const headerChip: {
    variant: BadgeVariant;
    glyph: MaterialSymbolName;
    label: string;
  } =
    gateSpec && posture !== "locked"
      ? {
          variant: "muted",
          glyph: gateSpec.BADGE,
          label:
            gate === "nsa"
              ? t("tower_locking.card.status_gated_nsa")
              : t("tower_locking.card.status_gated_lte"),
        }
      : { variant: status.variant, glyph: status.glyph, label: statusLabel };

  /**
   * The provenance mark beside the SCS label. Two sources, two glyphs, two
   * tones — never the same mark for "we read this" and "we guessed this".
   *
   * The tones are the `-on-surface` steps, not the solid `--warning` / `--success`
   * role tokens: those are container FILLS and measure below AA as ink on a
   * card. `--{role}-on-surface` exists for exactly this case — a tinted mark on
   * a plain surface, where no container is used.
   */
  const scsProvenance =
    scsSource === "band_default" && band
      ? {
          glyph: "warning" as MaterialSymbolName,
          className: "text-warning-on-surface",
          tip: t("tower_locking.fields.scs_guess", { band }),
        }
      : scsSource === "servingcell"
        ? {
            glyph: "check_circle" as MaterialSymbolName,
            className: "text-success-on-surface",
            tip: t("tower_locking.fields.scs_from_serving"),
          }
        : null;

  return (
    <>
      <Card className={TOWER_CARD}>
        <CardHeader className={CARD_PAD}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="truncate text-lg">{title}</CardTitle>
              <CardDescription className="text-pretty">
                {description}
              </CardDescription>
            </div>
            <Badge variant={headerChip.variant} className="flex-none">
              <MaterialSymbol name={headerChip.glyph} size={BADGE_GLYPH_SIZE} />
              {headerChip.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className={CARD_PAD}>
          <motion.div
            className="flex flex-col gap-4"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {/* --- The gate ----------------------------------------------
                LEADS THE BODY, because it is the reason everything under it is
                inert. Full contrast — no `opacity` on the card, on this notice,
                or on the copy that explains the condition, which is the exact
                failure this treatment replaces (see the header block).

                Copy is resolved with a literal key on each branch, never
                `gate_${gate}_title`: `i18n:check` grades a missing key as a
                warning and exits 0, so an interpolated key is one no gate can
                ever report on. */}
            {gate && gateSpec ? (
              <motion.div
                variants={staggerRowItem}
                role="status"
                className={`${NOTICE.ROOT} ${NOTICE_TONE[gateSpec.tone].fill}`}
              >
                <span
                  aria-hidden="true"
                  className={`${NOTICE.DISC} ${NOTICE_TONE[gateSpec.tone].disc}`}
                >
                  <MaterialSymbol name={gateSpec.NOTICE} filled size={16} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-semibold">
                    {gate === "nsa"
                      ? t("tower_locking.card.gate_nsa_title")
                      : t("tower_locking.card.gate_lte_title")}
                  </p>
                  <p className="leading-relaxed">
                    {gate === "nsa"
                      ? t("tower_locking.card.gate_nsa_body")
                      : t("tower_locking.card.gate_lte_body")}
                  </p>
                </div>
              </motion.div>
            ) : null}

            {/* --- Modem read-back ---------------------------------------
                The one fact the retired locked-target panel carried that
                nothing else did, printed inches from the fields it may
                disagree with. Rendered only when there is a pair: the header
                chip already says "Unlocked", and an empty captioned box is
                noise. Its inner anatomy is byte-identical to the LTE card's —
                only the wrapper differs, because this card's whole body is one
                stagger cascade and a plain `div` here would break the rhythm. */}
            {readbackCells.length > 0 ? (
              <motion.div variants={staggerRowItem} className={READBACK.ROOT}>
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
                      key={`${cell.arfcn}-${cell.pci}`}
                      className={READBACK.ROW}
                    >
                      <span className={READBACK.VALUE}>
                        {t("tower_locking.live.rail_target_pair", {
                          channel: `${t("tower_locking.live.tile_arfcn")} ${cell.arfcn}`,
                          pci: cell.pci,
                        })}
                      </span>
                      {isOnAir(cell.arfcn, cell.pci) ? (
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
              </motion.div>
            ) : null}

            {/* --- Simple Mode ------------------------------------------- */}
            <motion.div variants={staggerRowItem} className="flex flex-col gap-1.5">
              <div className={CARD_ROW}>
                <Label
                  htmlFor={`${fieldId}-simple`}
                  className={CARD_ROW_LABEL}
                >
                  <MaterialSymbol name="tune" size={18} />
                  {t("tower_locking.card.simple_mode")}
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-on-surface-variant text-xs font-medium">
                    {pickerActive ? tc("state.on") : tc("state.off")}
                  </span>
                  {/* Also off while gated: the picker fills a form that
                      cannot be written, so leaving it live would advertise a
                      path to a dead end. The NOTICE above says why. */}
                  <Switch
                    id={`${fieldId}-simple`}
                    className={SWITCH_TARGET}
                    checked={pickerActive}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || formDisabled}
                  />
                </div>
              </div>
            </motion.div>

            {/* --- Fields --------------------------------------------------
                FOUR VALUE TILES, 2x2. The label lives inside the filled block
                with its control rather than floating above a separate one —
                the mock's denser treatment, adopted for its geometry only.
                Every cell is still a live control: the mock drew a settled,
                read-only card and stopped.

                Nested cascade container: it inherits `visible` from the stack
                above and must NOT declare its own initial/animate, or the
                children would start their own timeline. */}
            <motion.div className={FIELD_GRID} variants={staggerRows}>
              <motion.div variants={staggerRowItem} className={FIELD_TILE}>
                <Label
                  htmlFor={`${fieldId}-arfcn`}
                  className={FIELD_TILE_LABEL}
                >
                  {t("tower_locking.fields.arfcn")}
                </Label>
                {pickerActive ? (
                  <Select
                    value={pickedOption ? currentComposite : ""}
                    onValueChange={handleCarrierPick}
                    disabled={formDisabled}
                  >
                    <SelectTrigger
                      id={`${fieldId}-arfcn`}
                      className={TILE_SELECT}
                    >
                      {pickedOption ? (
                        <SelectValue />
                      ) : arfcn && pci ? (
                        // Not one of the camped-on carriers: the pair is still
                        // valid, it just did not come from the picker. Shown
                        // rather than blanked, so switching modes never looks
                        // like it lost the user's values.
                        //
                        // Through the shared `rail_target_pair` rather than a
                        // locally joined middot string: a trigger is the one
                        // place with genuinely no room for two labels, which is
                        // exactly the case that key exists to serve — and
                        // routing it through the key means the separator is a
                        // translator's decision instead of a hardcoded glyph.
                        <span className="text-on-surface-variant line-clamp-1 min-w-0 font-mono text-sm font-semibold tabular-nums italic">
                          {t("tower_locking.live.rail_target_pair", {
                            channel: `${t("tower_locking.live.tile_arfcn")} ${arfcn}`,
                            pci,
                          })}
                        </span>
                      ) : (
                        <SelectValue
                          placeholder={t(
                            "tower_locking.fields.pick_placeholder",
                          )}
                        />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((opt) => {
                        const value = compositeValue(opt.earfcn, opt.pci);
                        return (
                          <SelectItem key={value} value={value}>
                            {/* ONE READING: the band and the channel that
                                identify the cell. Matched to the LTE card's
                                picker deliberately — the two legs sit on the
                                same page and a user filling both should not
                                have to re-learn the row.

                                This replaces a labelled `ARFCN n / PCI n /
                                -107 dBm` run. The labels were the right answer
                                to a middot-joined pair before it, but the real
                                problem was the number of readings, not their
                                signposting: the PCI lands in its own field the
                                moment an option is picked, and the RSRP was
                                never how a cell gets chosen here. With one
                                reading left there is nothing to disambiguate,
                                so the labels go with the values they named. */}
                            <span className="flex min-w-0 items-center gap-x-2">
                              {/* `nr`, the IDENTITY variant, and never
                                  `secondary`: that token is byte-identical to
                                  `surface-container` here, so the chip vanished
                                  into the dropdown row behind it. This is the
                                  same blue the camped tiles wear in the strip
                                  above — the same chip for the same carrier. It
                                  says which radio, never "healthy"; PCC vs SCC
                                  is carried by the word inside it. */}
                              <Tag variant="nr" className="flex-none">
                                {opt.type}
                              </Tag>
                              <span className="text-on-surface min-w-0 truncate font-mono text-sm font-semibold tabular-nums">
                                {t("tower_locking.live.tile_band_channel", {
                                  band:
                                    opt.band ||
                                    t("tower_locking.live.tile_no_value"),
                                  channel: opt.earfcn,
                                })}
                              </span>
                              {/* The PCI still reaches assistive tech, which
                                  cannot glance down at the field the pick
                                  fills. */}
                              <span className="sr-only">
                                {t("tower_locking.fields.pci")} {opt.pci}
                              </span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`${fieldId}-arfcn`}
                    inputMode="numeric"
                    autoComplete="off"
                    value={arfcn}
                    onChange={(e) => setArfcn(e.target.value)}
                    disabled={formDisabled}
                    className={FIELD_TILE_CONTROL}
                  />
                )}
              </motion.div>

              <motion.div variants={staggerRowItem} className={FIELD_TILE}>
                <Label htmlFor={`${fieldId}-pci`} className={FIELD_TILE_LABEL}>
                  {t("tower_locking.fields.pci")}
                </Label>
                <Input
                  id={`${fieldId}-pci`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={pci}
                  onChange={(e) => setPci(e.target.value)}
                  disabled={formDisabled}
                  className={FIELD_TILE_CONTROL}
                />
              </motion.div>

              {/* SCS sits third, ahead of the band, because it is the field
                  most likely to be wrong and the only one whose provenance the
                  card can report. See the header block. */}
              <motion.div variants={staggerRowItem} className={FIELD_TILE}>
                {/* The provenance button is a SIBLING of the label, not a child
                    of it. Nested inside, every click on the mark also fired the
                    label's own activation and opened the select underneath the
                    tooltip. */}
                <div className="flex w-full items-center gap-1.5">
                  <Label htmlFor={`${fieldId}-scs`} className={FIELD_LABEL}>
                    {t("tower_locking.fields.scs")}
                  </Label>
                  {scsProvenance ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* A real <button>, not the incumbent's <span>: a
                            tooltip a keyboard user cannot reach is a tooltip
                            that does not exist. */}
                        <button
                          type="button"
                          aria-label={scsProvenance.tip}
                          className="focus-visible:ring-ring/50 inline-flex rounded-pill focus-visible:ring-[3px] focus-visible:outline-none"
                        >
                          <MaterialSymbol
                            name={scsProvenance.glyph}
                            size={14}
                            className={scsProvenance.className}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {scsProvenance.tip}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                {/* WHERE THIS NUMBER CAME FROM, AS A DESCRIPTION OF THE FIELD.
                    The provenance mark carries it visually, but a tooltip is
                    not a description: a reader who tabs straight into the
                    select never touches the mark, and SCS is the one field of
                    the four that is routinely a GUESS on the last screen
                    before the modem drops its connection. This surface had no
                    `aria-describedby` anywhere; this is the field that most
                    needed one. */}
                {scsProvenance ? (
                  <span id={`${fieldId}-scs-provenance`} className="sr-only">
                    {scsProvenance.tip}
                  </span>
                ) : null}
                <Select
                  value={scs}
                  onValueChange={(v) => {
                    setScs(v);
                    setScsSource("manual");
                  }}
                  disabled={formDisabled}
                >
                  <SelectTrigger
                    id={`${fieldId}-scs`}
                    className={TILE_SELECT}
                    aria-describedby={
                      scsProvenance ? `${fieldId}-scs-provenance` : undefined
                    }
                  >
                    <SelectValue placeholder={t("tower_locking.fields.scs")} />
                  </SelectTrigger>
                  <SelectContent>
                    {SCS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </motion.div>

              <motion.div variants={staggerRowItem} className={FIELD_TILE}>
                <Label htmlFor={`${fieldId}-band`} className={FIELD_TILE_LABEL}>
                  {t("tower_locking.fields.band")}
                </Label>
                <Input
                  id={`${fieldId}-band`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={band}
                  onChange={(e) => setBand(e.target.value)}
                  disabled={formDisabled}
                  className={FIELD_TILE_CONTROL}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        </CardContent>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLocking ? t("tower_locking.a11y.applying", { leg: legName }) : ""}
        </div>

        {/* `mt-auto` pins the actions to the card's floor. These cards sit in an
            equal-height grid row, so a short card (this one has four fields to
            LTE's three slots) would otherwise leave its buttons floating in the
            middle with a void beneath them.

            TWO WRITES, THEN A FORM RESET. The two consequential actions are
            grouped and `Clear fields` is pushed to the far edge, so the footer
            cannot read as three equal pills — same construction as
            `band-grid-card.tsx`'s footer, which this surface is converging on. */}
        <CardFooter
          className={`${CARD_PAD} mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-3`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {/* `!hasChanges` alone would dead-end an UNLOCKED modem whose
                last-known cell matches the form — see the trap named on
                `hasChanges`. A form that parses is always lockable while nothing
                is locked; only a leg already holding these exact values has
                nothing left to write. */}
            <SaveButton
              onClick={requestLock}
              isSaving={isLocking}
              saved={saved}
              label={t("tower_locking.actions.lock")}
              blockedReason={lockBlockedReason}
              className={PILL_ACTION_PLAIN}
            />
            {/* Gated on `posture`, NOT on `config.nr_sa.enabled`: offering to
                remove a lock the modem does not report is offering an action
                with no effect, and `unknown` means nobody has successfully read
                the modem — so it is disabled rather than optimistically live.

                AND NOT ON `formDisabled` EITHER. This is the only control on
                the card that survives a gate, and deliberately so: the app is
                served BY the modem it is unlocking, `nr_locked` outlives the
                network moving out of SA, and a lock pinned to a cell that is no
                longer reachable takes the page down with it. Removing it must
                never require the very condition that broke it to clear first. */}
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
            onClick={handleClear}
            disabled={formDisabled || !hasAnyInput}
            className={PILL_QUIET}
          >
            {t("tower_locking.actions.clear_fields")}
          </Button>
        </CardFooter>
      </Card>

      {/* --- Lock confirmation ------------------------------------------- */}
      <AlertDialog open={showLockDialog} onOpenChange={setShowLockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tower_locking.dialog.lock_nr_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tower_locking.dialog.lock_nr_body", {
                summary: pendingCell ? summarise(pendingCell) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* THE FULL CELL, AS FOUR LABELLED VALUES.
              The sentence above names the cell; this says everything that is
              about to be written, each value under its own label. It replaces a
              four-term middot chain flattened into that sentence — the band and
              the SCS were in there as bare "N78" and "30 kHz", which the reader
              had to decode by position. */}
          {pendingCell ? (
            <dl className="grid grid-cols-2 gap-2">
              {[
                {
                  label: t("tower_locking.fields.band"),
                  value: `N${pendingCell.band}`,
                },
                {
                  label: t("tower_locking.fields.arfcn"),
                  value: String(pendingCell.arfcn),
                },
                {
                  label: t("tower_locking.fields.pci"),
                  value: String(pendingCell.pci),
                },
                {
                  label: t("tower_locking.fields.scs"),
                  value: scsLabelFor(pendingCell.scs),
                },
              ].map((row) => (
                <div key={row.label} className={FIELD_TILE}>
                  <dt className={FIELD_TILE_LABEL}>{row.label}</dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* The guess, restated at the point of no return. A wrong SCS does
              not fail loudly — the modem accepts the command and never camps —
              so this is the last moment it can be caught cheaply. */}
          {scsSource === "band_default" && band ? (
            <div className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.fill}`}>
              <span
                aria-hidden="true"
                className={`${NOTICE.DISC} ${NOTICE_TONE.warning.disc}`}
              >
                <MaterialSymbol name={NOTICE_TONE.warning.glyph} size={16} />
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">
                {t("tower_locking.fields.scs_guess", { band })}
              </span>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmLock();
              }}
            >
              {t("tower_locking.actions.lock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Unlock confirmation ------------------------------------------ */}
      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tower_locking.dialog.unlock_title", { leg: legName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tower_locking.dialog.unlock_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmUnlock();
              }}
            >
              {t("tower_locking.actions.unlock")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
