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
  FIELD_CONTROL,
  FIELD_GRID,
  FIELD_LABEL,
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
// THE GATE IS A CONDITION, NOT A DIMMER
// -----------------------------------------------------------------------------
// The incumbent's answer to "you cannot lock SA right now" was `opacity-60` on
// the whole `<Card>` plus a sentence appended to the `CardDescription`. That is
// two failures in one gesture: a banned opacity wash (`shapes.ts` > NOTICE names
// this exact line as the tell it replaces), and — worse — it dimmed its own
// explanation below readable contrast. The one piece of text the user needs in
// order to act was the text made hardest to read.
//
// So the gate now REPLACES the card body with a tonal condition block, at the
// same contrast as everything else on the page, in the condition's own role
// colour. The shape mirrors `components/cellular/condition-screen.tsx` at card
// scale rather than importing it: that component is `rounded-hero` (40px) with
// 56px of vertical padding, sized to replace a whole page body, and nesting it
// inside a `rounded-card` (36px) leg card would out-round its own host.
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
// that is not happening. They carry DIFFERENT glyphs, because
// `warning-container` and `primary-container` are two container fills and the
// glyph is the channel that survives grayscale.
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

/** The row's leading label. Matches `HERO_RAIL_ROW_LABEL`'s typographic step. */
const CARD_ROW_LABEL = "text-sm font-semibold";

/**
 * `FIELD_CONTROL` + the one thing it cannot win on its own, for a SelectTrigger.
 *
 * `components/ui/select.tsx` sets its height as `data-[size=default]:h-9`, which
 * compiles to `.data-\[size\=default\]\:h-9[data-size="default"]` — a class PLUS
 * an attribute, so it outranks `FIELD_CONTROL`'s bare `h-[2.625rem]` on
 * specificity and tailwind-merge cannot fold the two (different modifier
 * scopes). Left alone, the two Selects in this grid render 36px beside four
 * 42px controls: visibly combed, and under the project's control-height floor.
 *
 * So the height is restated AT THE SAME SPECIFICITY. It is the only value
 * duplicated from `FIELD_CONTROL`, and it is duplicated because a class name has
 * to exist literally in the source for Tailwind to emit it. `Input` needs none
 * of this — its `h-9` is a bare utility, which tailwind-merge resolves.
 */
const SELECT_CONTROL = `w-full data-[size=default]:h-[2.625rem] ${FIELD_CONTROL}`;

/**
 * The gate block: `condition-screen.tsx`'s anatomy (disc → title → body) at card
 * scale. `rounded-tile` (28px) so it stays a step inside the `rounded-card`
 * (36px) shell hosting it.
 *
 * THE BODY IS `surface-container`, NOT THE ROLE'S CONTAINER, and that is a
 * deliberate step down from `condition-screen.tsx`. That component replaces a
 * whole PAGE body, where a full tonal wash is proportionate. This block fills a
 * card in a 2-up grid, and painting ~170px of `warning-container` there made the
 * gate the loudest object on a page whose actual job is elsewhere — it read as
 * an error the user had caused rather than a standing fact about the network
 * mode.
 *
 * The signal moves to the two channels that survive the change: the filled disc
 * (Glyph-Disc Rule — the disc is what still reads when a container fill washes
 * out in sunlight) and the title, tinted with the role's `-on-surface` token.
 * That token exists for exactly this case: DESIGN.md defines `--{role}-on-surface`
 * as "tinted text on a plain card, where no container is used".
 */
const GATE = {
  ROOT: "bg-surface-container flex flex-col items-center gap-3 rounded-tile px-6 py-8 text-center",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  TITLE: "text-base font-semibold",
  BODY: "text-on-surface-variant max-w-[44ch] text-sm leading-relaxed text-pretty",
} as const;

/** The role tint for the gate's title. See GATE.ROOT for why this is
 *  `-on-surface` rather than an `on-*-container` ink. */
const GATE_TITLE_TONE: Record<"warning" | "info", string> = {
  warning: "text-warning-on-surface",
  info: "text-primary",
};

/** Which gate, if any, is standing between the user and an SA lock. */
type GateKind = "nsa" | "lte_only";

/**
 * Gate → tone + glyph.
 *
 * The FILL and DISC come from `NOTICE_TONE` so the block can never drift from
 * the surface's other tonal containers. The GLYPH is overridden for `lte_only`:
 * `NOTICE_TONE.info.glyph` is the generic `info` mark, and
 * `signal_cellular_off` says the actual thing — there is no NR signal to pin.
 * `nsa` keeps the role's own `warning` glyph. The two must differ, and do.
 */
const GATE_SPEC: Record<
  GateKind,
  { tone: "warning" | "info"; glyph: MaterialSymbolName }
> = {
  nsa: { tone: "warning", glyph: NOTICE_TONE.warning.glyph },
  lte_only: { tone: "info", glyph: "signal_cellular_off" },
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
  const isEnabled = modemState?.nr_locked ?? config?.nr_sa?.enabled ?? false;

  /** `unknown` is a real state: `status.sh` cannot tell a failed `AT+QNWLOCK`
   *  read from "not locked", so a confident "Unlocked" would be an assertion
   *  nobody made. See `shapes.ts` > LEG_BADGE. */
  const posture: LegPosture = !modemState
    ? "unknown"
    : modemState.nr_locked
      ? "locked"
      : "unlocked";

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

  /** True when the form describes something other than what the radio reports.
   *  Drives the apply button, the same way band locking's pending count does. */
  const hasChanges = useMemo(() => {
    if (!parsedCell) return false;
    const live = modemState?.nr_cell ?? null;
    if (!live) return true;
    return (
      live.arfcn !== parsedCell.arfcn ||
      live.pci !== parsedCell.pci ||
      live.band !== parsedCell.band ||
      live.scs !== parsedCell.scs
    );
  }, [parsedCell, modemState]);

  const hasAnyInput = Boolean(arfcn || pci || band || scs);

  // --- Dialogs ---------------------------------------------------------------
  const [pendingCell, setPendingCell] = useState<NrSaLockCell | null>(null);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);

  /**
   * The cell, in machine voice, for the confirmation body.
   *
   * SCS IS IN HERE and was not in the incumbent's. It is the one field of the
   * four that is routinely a guess, and the confirmation is the last screen
   * before the modem drops its connection — omitting it meant the number most
   * likely to be wrong was the number the user never saw.
   */
  const summarise = (cell: NrSaLockCell) => {
    const scsLabel =
      SCS_OPTIONS.find((o) => o.value === cell.scs)?.label ?? String(cell.scs);
    return [
      `N${cell.band}`,
      `${t("tower_locking.live.tile_arfcn")} ${cell.arfcn}`,
      `${t("tower_locking.live.tile_pci")} ${cell.pci}`,
      scsLabel,
    ].join(" · ");
  };

  const requestLock = () => {
    if (!parsedCell) {
      toast.warning(t("tower_locking.toast.incomplete"));
      return;
    }
    setPendingCell(parsedCell);
    setShowLockDialog(true);
  };

  const handleToggle = (checked: boolean) => {
    if (checked) requestLock();
    else setShowUnlockDialog(true);
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
          <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
          <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
          <div className={FIELD_GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className={SKELETON_SHAPE.FIELD_LABEL} />
                <Skeleton className={SKELETON_SHAPE.FIELD_CONTROL} />
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

  // ===========================================================================
  // Gated — the card shell and header survive, the BODY is the condition.
  // ===========================================================================
  const gate: GateKind | null =
    networkType === "5G-NSA" ? "nsa" : networkType === "LTE" ? "lte_only" : null;

  if (gate) {
    const spec = GATE_SPEC[gate];
    const tone = NOTICE_TONE[spec.tone];
    return (
      <Card className={TOWER_CARD}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="text-pretty">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className={CARD_PAD}>
          <div role="status" className={GATE.ROOT}>
            <span aria-hidden="true" className={`${GATE.DISC} ${tone.disc}`}>
              <MaterialSymbol name={spec.glyph} filled size={22} />
            </span>
            {/* Copy resolved with a literal key on each branch, not
                `gate_${gate}_title` — see `statusLabel` below for why an
                interpolated key is a key no gate can ever report on. */}
            <p className={`${GATE.TITLE} ${GATE_TITLE_TONE[spec.tone]}`}>
              {gate === "nsa"
                ? t("tower_locking.card.gate_nsa_title")
                : t("tower_locking.card.gate_lte_title")}
            </p>
            <p className={GATE.BODY}>
              {gate === "nsa"
                ? t("tower_locking.card.gate_nsa_body")
                : t("tower_locking.card.gate_lte_body")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ===========================================================================
  // Loaded
  // ===========================================================================
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

  /** The provenance mark beside the SCS label. Two sources, two glyphs, two
   *  tones — never the same mark for "we read this" and "we guessed this". */
  const scsProvenance =
    scsSource === "band_default" && band
      ? {
          glyph: "warning" as MaterialSymbolName,
          className: "text-warning",
          tip: t("tower_locking.fields.scs_guess", { band }),
        }
      : scsSource === "servingcell"
        ? {
            glyph: "check_circle" as MaterialSymbolName,
            className: "text-success",
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
            <Badge variant={status.variant} className="flex-none">
              <MaterialSymbol name={status.glyph} size={BADGE_GLYPH_SIZE} />
              {statusLabel}
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
                  <Switch
                    id={`${fieldId}-simple`}
                    checked={pickerActive}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || isLocking}
                  />
                </div>
              </div>
              {!hasOptions ? (
                <p className="text-on-surface-variant px-4 text-xs">
                  {t("tower_locking.live.absent_nr_title")}
                </p>
              ) : null}
            </motion.div>

            {/* --- Enable ------------------------------------------------- */}
            <motion.div variants={staggerRowItem} className={CARD_ROW}>
              <Label htmlFor={`${fieldId}-enable`} className={CARD_ROW_LABEL}>
                <MaterialSymbol
                  name={isEnabled ? "lock" : "lock_open"}
                  size={18}
                />
                {t("tower_locking.card.enable_label")}
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-on-surface-variant text-xs font-medium">
                  {isEnabled ? tc("state.enabled") : tc("state.disabled")}
                </span>
                <Switch
                  id={`${fieldId}-enable`}
                  checked={isEnabled}
                  onCheckedChange={handleToggle}
                  disabled={isLocking}
                />
              </div>
            </motion.div>

            {/* --- Fields -------------------------------------------------- */}
            {/* Nested cascade container: it inherits `visible` from the stack
                above and must NOT declare its own initial/animate, or the
                children would start their own timeline. */}
            <motion.div className={FIELD_GRID} variants={staggerRows}>
              <motion.div variants={staggerRowItem} className="flex flex-col gap-2">
                <Label htmlFor={`${fieldId}-arfcn`} className={FIELD_LABEL}>
                  {t("tower_locking.fields.arfcn")}
                </Label>
                {pickerActive ? (
                  <Select
                    value={pickedOption ? currentComposite : ""}
                    onValueChange={handleCarrierPick}
                    disabled={isLocking}
                  >
                    <SelectTrigger
                      id={`${fieldId}-arfcn`}
                      className={SELECT_CONTROL}
                    >
                      {pickedOption ? (
                        <SelectValue />
                      ) : arfcn && pci ? (
                        // Not one of the camped-on carriers: the pair is still
                        // valid, it just did not come from the picker. Shown
                        // rather than blanked, so switching modes never looks
                        // like it lost the user's values.
                        <span className="text-on-surface-variant line-clamp-1 min-w-0 font-mono text-xs tabular-nums italic">
                          {`${t("tower_locking.live.tile_arfcn")} ${arfcn} · ${t("tower_locking.live.tile_pci")} ${pci}`}
                        </span>
                      ) : (
                        <SelectValue
                          placeholder={t("tower_locking.live.tile_use")}
                        />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((opt) => {
                        const value = compositeValue(opt.earfcn, opt.pci);
                        return (
                          <SelectItem key={value} value={value}>
                            <span className="flex min-w-0 items-center gap-2">
                              <Badge variant="secondary">{opt.type}</Badge>
                              <span className="font-medium">
                                {opt.band || t("tower_locking.live.tile_no_value")}
                              </span>
                              <span className="text-on-surface-variant font-mono text-xs tabular-nums">
                                {`${t("tower_locking.live.tile_arfcn")} ${opt.earfcn} · ${t("tower_locking.live.tile_pci")} ${opt.pci}`}
                              </span>
                              {opt.rsrp !== null ? (
                                <span className="text-on-surface-variant font-mono text-xs tabular-nums">
                                  {t("tower_locking.live.tile_rsrp", {
                                    value: opt.rsrp,
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
                    id={`${fieldId}-arfcn`}
                    inputMode="numeric"
                    value={arfcn}
                    onChange={(e) => setArfcn(e.target.value)}
                    disabled={isLocking}
                    className={FIELD_CONTROL}
                  />
                )}
              </motion.div>

              <motion.div variants={staggerRowItem} className="flex flex-col gap-2">
                <Label htmlFor={`${fieldId}-pci`} className={FIELD_LABEL}>
                  {t("tower_locking.fields.pci")}
                </Label>
                <Input
                  id={`${fieldId}-pci`}
                  inputMode="numeric"
                  value={pci}
                  onChange={(e) => setPci(e.target.value)}
                  disabled={isLocking}
                  className={FIELD_CONTROL}
                />
              </motion.div>

              <motion.div variants={staggerRowItem} className="flex flex-col gap-2">
                <Label htmlFor={`${fieldId}-band`} className={FIELD_LABEL}>
                  {t("tower_locking.fields.band")}
                </Label>
                <Input
                  id={`${fieldId}-band`}
                  inputMode="numeric"
                  value={band}
                  onChange={(e) => setBand(e.target.value)}
                  disabled={isLocking}
                  className={FIELD_CONTROL}
                />
              </motion.div>

              <motion.div variants={staggerRowItem} className="flex flex-col gap-2">
                <Label htmlFor={`${fieldId}-scs`} className={FIELD_LABEL}>
                  {t("tower_locking.fields.scs")}
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
                </Label>
                <Select
                  value={scs}
                  onValueChange={(v) => {
                    setScs(v);
                    setScsSource("manual");
                  }}
                  disabled={isLocking}
                >
                  <SelectTrigger
                    id={`${fieldId}-scs`}
                    className={SELECT_CONTROL}
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
            </motion.div>
          </motion.div>
        </CardContent>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLocking ? t("tower_locking.a11y.applying", { leg: legName }) : ""}
        </div>

        {/* `mt-auto` pins the actions to the card's floor. These cards sit in an
            equal-height grid row, so a short card (this one has four fields to
            LTE's three slots) would otherwise leave its buttons floating in the
            middle with a void beneath them. */}
        <CardFooter
          className={`${CARD_PAD} mt-auto flex flex-wrap items-center gap-x-2 gap-y-3`}
        >
          <SaveButton
            onClick={requestLock}
            isSaving={isLocking}
            saved={saved}
            label={t("tower_locking.actions.lock")}
            disabled={isLocking || !hasChanges}
            className={PILL_ACTION_PLAIN}
          />
          <Button
            type="button"
            variant="tonal-neutral"
            onClick={handleClear}
            disabled={isLocking || !hasAnyInput}
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
