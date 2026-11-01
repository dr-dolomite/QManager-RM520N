"use client";

import { useId, useMemo, useState } from "react";
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
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
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
import { HintIcon } from "@/components/ui/hint-icon";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import type { CarrierComponent, NetworkType } from "@/types/modem-status";
import {
  SCS_OPTIONS,
  type NrSaLockCell,
  type TowerActionResult,
  type TowerLockConfig,
  type TowerModemState,
} from "@/types/tower-locking";

import { TowerPersistField } from "./persist-field";
import { reportTowerResult } from "./settings-write";
import { compositeValue, defaultScsForBand, parseCompositeValue } from "./simple-mode-utils";
import {
  CARD_PAD,
  CONTROL_ROW,
  FIELD_GRID,
  FIELD_LABEL,
  FIELD_TILE,
  LEG_CARD_ID,
  LEG_KEYS,
  NOTICE,
  NOTICE_TONE,
  SKELETON_SHAPE,
  TOWER_CARD,
  type LegPosture,
} from "./shapes";

// =============================================================================
// NrSaTowerCard — pin the 5G standalone radio to a single cell
// =============================================================================
// Locking needs standalone mode: 5G NSA warns, LTE-only says there is nothing to pin. Remove Lock is gated on the
// modem's lock state only, never the network gate: removing a bad lock must survive every state.
//
// SCS is the field most likely to be wrong: read from the serving cell when it is the one on air, otherwise a flagged
// band-default guess; a wrong SCS is accepted by the modem and then never camps.
// =============================================================================

const K = "tower_locking";
const STORAGE_KEY = "qmanager_tower_nr_simple_mode";

type ScsSource = "manual" | "band_default" | "servingcell";
type GateKind = "nsa" | "lte_only";

const GATE_SPEC: Record<
  GateKind,
  { tone: "warning" | "info"; glyph: MaterialSymbolName }
> = {
  nsa: { tone: "warning", glyph: "warning" },
  lte_only: { tone: "info", glyph: "signal_cellular_off" },
};

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol
    name="check"
    size={16}
    className={className}
    aria-hidden="true"
  />
);

interface NrOption {
  earfcn: number;
  pci: number;
  band: string;
  bandNumber: number | null;
  type: "PCC" | "SCC";
}

function bandNumberOf(band: string): number | null {
  const match = band.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function toOptions(carriers: CarrierComponent[]): NrOption[] {
  const sorted = [...carriers].sort((a, b) => {
    if (a.type !== b.type) return a.type === "PCC" ? -1 : 1;
    return (b.rsrp ?? -200) - (a.rsrp ?? -200);
  });
  const seen = new Set<string>();
  const out: NrOption[] = [];
  for (const c of sorted) {
    if (c.earfcn == null || c.pci == null) continue;
    const key = compositeValue(c.earfcn, c.pci);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      earfcn: c.earfcn,
      pci: c.pci,
      band: c.band,
      bandNumber: bandNumberOf(c.band),
      type: c.type,
    });
  }
  return out;
}

function resolveScs(
  cell: { arfcn: number; pci: number; band: number | null },
  serving: { arfcn: number | null; pci: number | null; scs: number | null },
): { scs: string; source: ScsSource } {
  if (
    serving.scs !== null &&
    serving.arfcn === cell.arfcn &&
    serving.pci === cell.pci
  ) {
    return { scs: String(serving.scs), source: "servingcell" };
  }
  const fallback = cell.band === null ? null : defaultScsForBand(cell.band);
  return {
    scs: fallback !== null ? String(fallback) : "",
    source: "band_default",
  };
}

// Detected is the default: only an explicit switch to Manual is remembered.
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
    // Storage blocked: the preference just does not persist.
  }
}

export interface NrSaTowerCardProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  carriers: CarrierComponent[];
  /** "" until the first poll lands: the card is in its loading state. */
  networkType: NetworkType;
  servingNr: { arfcn: number | null; pci: number | null; scs: number | null };
  isLoading: boolean;
  isLocking: boolean;
  onLock: (cell: NrSaLockCell) => Promise<TowerActionResult>;
  onUnlock: () => Promise<TowerActionResult>;
  isSavingSettings: boolean;
  onSetPersist: (on: boolean) => void;
}

export default function NrSaTowerCard({
  config,
  modemState,
  carriers,
  networkType,
  servingNr,
  isLoading,
  isLocking,
  onLock,
  onUnlock,
  isSavingSettings,
  onSetPersist,
}: NrSaTowerCardProps): React.JSX.Element {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();
  const fieldId = useId();
  const legName = t(LEG_KEYS.nr_sa.short);

  // --- Draft fields -----------------------------------------------------------
  const [arfcn, setArfcn] = useState("");
  const [pci, setPci] = useState("");
  const [band, setBand] = useState("");
  const [scs, setScs] = useState("");
  const [scsSource, setScsSource] = useState<ScsSource>("manual");
  const [pickMode, setPickMode] = useState<boolean>(readPickMode);
  const [pendingCell, setPendingCell] = useState<NrSaLockCell | null>(null);
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  // Seed from the saved cell whenever its VALUE changes (adjust during render).
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

  // --- Pick mode --------------------------------------------------------------
  const options = useMemo(() => toOptions(carriers), [carriers]);
  const hasOptions = options.length > 0;
  const pickActive = pickMode && hasOptions;

  const handlePickMode = (value: "type" | "pick") => {
    const on = value === "pick";
    setPickMode(on);
    writePickMode(on);
  };

  const currentComposite = useMemo(() => {
    const a = Number.parseInt(arfcn, 10);
    const p = Number.parseInt(pci, 10);
    if (Number.isNaN(a) || Number.isNaN(p)) return "";
    return compositeValue(a, p);
  }, [arfcn, pci]);

  const pickedOption = options.find(
    (o) => compositeValue(o.earfcn, o.pci) === currentComposite,
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

  // --- Derived ----------------------------------------------------------------
  const posture: LegPosture =
    !modemState || modemState.nr_read_ok === false
      ? "unknown"
      : modemState.nr_locked
        ? "locked"
        : "unlocked";

  const lockedCell =
    modemState?.nr_read_ok !== false && modemState?.nr_locked
      ? modemState.nr_cell
      : null;

  const isOnAir = (channel: number, cellPci: number): boolean =>
    carriers.some((c) => c.earfcn === channel && c.pci === cellPci);

  const parsedCell = useMemo<NrSaLockCell | null>(() => {
    const a = Number.parseInt(arfcn, 10);
    const p = Number.parseInt(pci, 10);
    const b = Number.parseInt(band, 10);
    const s = Number.parseInt(scs, 10);
    if ([a, p, b, s].some(Number.isNaN)) return null;
    return { arfcn: a, pci: p, band: b, scs: s };
  }, [arfcn, pci, band, scs]);

  const hasChanges =
    parsedCell !== null &&
    (lockedCell === null ||
      lockedCell.arfcn !== parsedCell.arfcn ||
      lockedCell.pci !== parsedCell.pci ||
      lockedCell.band !== parsedCell.band ||
      lockedCell.scs !== parsedCell.scs);

  const hasAnyInput = Boolean(arfcn || pci || band || scs);

  const scsLabelFor = (value: number) =>
    SCS_OPTIONS.find((o) => o.value === value)?.label ?? String(value);

  // --- Handlers ---------------------------------------------------------------
  const requestLock = () => {
    if (!parsedCell) return;
    setPendingCell(parsedCell);
    setShowLockDialog(true);
  };

  const confirmLock = async () => {
    setShowLockDialog(false);
    if (!pendingCell) return;
    setWriteError(null);
    const result = await onLock(pendingCell);
    if (result.ok) markSaved();
    if (!result.ok) setWriteError(result.error ?? t(`${K}.errors.lock_failed`));
    reportTowerResult(t, result, t(`${K}.toast.locked`, { leg: legName }), t(`${K}.errors.lock_failed`));
  };

  const confirmUnlock = async () => {
    setShowUnlockDialog(false);
    setWriteError(null);
    const result = await onUnlock();
    if (!result.ok) setWriteError(result.error ?? t(`${K}.errors.unlock_failed`));
    reportTowerResult(t, result, t(`${K}.toast.unlocked`, { leg: legName }), t(`${K}.errors.unlock_failed`));
  };

  const handleClear = () => {
    setArfcn("");
    setPci("");
    setBand("");
    setScs("");
    setScsSource("manual");
  };

  // --- Loading: also while the network type has not been reported ------------
  if (isLoading || networkType === "") {
    return (
      <Card id={LEG_CARD_ID.nr_sa} className={TOWER_CARD}>
        <CardHeader className={CARD_PAD}>
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className={SKELETON_SHAPE.CARD_TITLE} />
            <Skeleton className={SKELETON_SHAPE.CARD_DESC} />
          </div>
        </CardHeader>
        <CardContent className={`${CARD_PAD} flex flex-col gap-4`}>
          <Skeleton className={SKELETON_SHAPE.CONTROL_ROW} />
          {/* Composed from the real tile so the two cannot drift. */}
          <div className={FIELD_GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={FIELD_TILE.ROOT}>
                <Skeleton className={SKELETON_SHAPE.FIELD_LABEL} />
                <Skeleton className={SKELETON_SHAPE.TILE_VALUE} />
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

  const gate: GateKind | null =
    networkType === "5G-NSA" ? "nsa" : networkType === "LTE" ? "lte_only" : null;
  const formDisabled = isLocking || gate !== null;

  const lockBlockedReason = isLocking
    ? null
    : gate === "nsa"
      ? t(`${K}.blocked.lock_gated_nsa`)
      : gate === "lte_only"
        ? t(`${K}.blocked.lock_gated_lte_only`)
        : !parsedCell
          ? hasAnyInput
            ? t(`${K}.blocked.lock_incomplete_nr`)
            : t(`${K}.blocked.lock_empty_nr`)
          : null;

  // Which of the two writes the state calls for (see the footer).
  const lockedAsSaved = posture === "locked" && !hasChanges;
  const showUnlock = posture === "unknown" || lockedAsSaved;
  const showLock = !lockedAsSaved;

  // The modem holds this cell, the fields still match it, and it is not on air.
  const lockedUnused =
    lockedAsSaved &&
    lockedCell !== null &&
    !isOnAir(lockedCell.arfcn, lockedCell.pci);

  const tileClass = lockedUnused
    ? `${FIELD_TILE.ROOT} ${FIELD_TILE.UNUSED}`
    : FIELD_TILE.ROOT;

  // Only a guess is worth saying: a value read from the serving cell is the
  // expected case and needs no mark.
  const scsGuessTip =
    scsSource === "band_default" && band
      ? t(`${K}.fields.scs_guess`, { band })
      : null;

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
  ) : lockedUnused ? (
    <span className="text-warning-on-surface inline-flex items-center gap-1.5">
      <MaterialSymbol name="warning" size={16} className="flex-none" />
      <span className="min-w-0">{t(`${K}.card.unused_nr`)}</span>
    </span>
  ) : null;

  const gateSpec = gate ? GATE_SPEC[gate] : null;

  return (
    <>
      <Card id={LEG_CARD_ID.nr_sa} className={`${TOWER_CARD} scroll-mt-20`}>
        <CardHeader className={CARD_PAD}>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="truncate text-lg">
              {t(LEG_KEYS.nr_sa.title)}
            </CardTitle>
            <CardDescription className="text-pretty">
              {t(LEG_KEYS.nr_sa.description)}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className={CARD_PAD}>
          <motion.div
            className="flex flex-col gap-4"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {/* The gate leads the body: it is why everything under it is inert.
                Full contrast, no opacity wash. Literal keys per branch. */}
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
                  <MaterialSymbol name={gateSpec.glyph} filled size={16} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-semibold">
                    {gate === "nsa"
                      ? t(`${K}.card.gate_nsa_title`)
                      : t(`${K}.card.gate_lte_title`)}
                  </p>
                  <p className="leading-relaxed">
                    {gate === "nsa"
                      ? t(`${K}.card.gate_nsa_body`)
                      : t(`${K}.card.gate_lte_body`)}
                  </p>
                </div>
              </motion.div>
            ) : null}

            <motion.div variants={staggerRowItem} className={CONTROL_ROW}>
              <Label id={`${fieldId}-mode-label`} className="min-w-0">
                {t(`${K}.card.input_mode`)}
              </Label>
              <div role="group" aria-labelledby={`${fieldId}-mode-label`}>
                <SegmentedField
                  value={pickActive ? "pick" : "type"}
                  onValueChange={handlePickMode}
                  options={[
                    { value: "pick", label: t(`${K}.card.mode_pick`) },
                    { value: "type", label: t(`${K}.card.mode_type`) },
                  ]}
                  ariaLabel={t(`${K}.card.input_mode`)}
                  disabled={!hasOptions || formDisabled}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </div>
            </motion.div>

            {/* Four value tiles (SHELL resolution: the tile carries fill and
                focus ring, the control inside is transparent). */}
            <motion.div className={FIELD_GRID} variants={staggerRows}>
              <motion.div
                variants={staggerRowItem}
                className={tileClass}
              >
                <Label
                  htmlFor={`${fieldId}-arfcn`}
                  className={FIELD_TILE.LABEL}
                >
                  {t(`${K}.fields.arfcn`)}
                </Label>
                {pickActive ? (
                  <Select
                    value={pickedOption ? currentComposite : ""}
                    onValueChange={handleCarrierPick}
                    disabled={formDisabled}
                  >
                    <SelectTrigger
                      id={`${fieldId}-arfcn`}
                      className={FIELD_TILE.SELECT}
                    >
                      {pickedOption ? (
                        <span className="min-w-0 truncate">
                          {t(`${K}.live.band_channel`, {
                            band:
                              pickedOption.band || t(`${K}.live.tile_no_value`),
                            channel: pickedOption.earfcn,
                          })}
                        </span>
                      ) : arfcn && pci ? (
                        <span className="text-on-surface-variant line-clamp-1 min-w-0 text-sm font-semibold tabular-nums italic">
                          {t(`${K}.live.target_pair`, {
                            channel: `${t(`${K}.live.tile_arfcn`)} ${arfcn}`,
                            pci,
                          })}
                        </span>
                      ) : (
                        <SelectValue
                          placeholder={t(`${K}.fields.pick_placeholder`)}
                        />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((opt) => {
                        const value = compositeValue(opt.earfcn, opt.pci);
                        return (
                          <SelectItem key={value} value={value}>
                            <span className="flex min-w-0 items-center gap-x-2">
                              <Tag variant="nr" className="flex-none">
                                {opt.type}
                              </Tag>
                              <span className="text-on-surface min-w-0 truncate text-sm font-semibold tabular-nums">
                                {t(`${K}.live.band_channel`, {
                                  band: opt.band || t(`${K}.live.tile_no_value`),
                                  channel: opt.earfcn,
                                })}
                              </span>
                              <span className="sr-only">
                                {t(`${K}.fields.pci`)} {opt.pci}
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
                    className={FIELD_TILE.CONTROL}
                  />
                )}
              </motion.div>

              <motion.div
                variants={staggerRowItem}
                className={tileClass}
              >
                <Label htmlFor={`${fieldId}-pci`} className={FIELD_TILE.LABEL}>
                  {t(`${K}.fields.pci`)}
                </Label>
                <Input
                  id={`${fieldId}-pci`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={pci}
                  onChange={(e) => setPci(e.target.value)}
                  disabled={formDisabled}
                  className={FIELD_TILE.CONTROL}
                />
              </motion.div>

              <motion.div
                variants={staggerRowItem}
                className={tileClass}
              >
                {/* The provenance mark is a sibling of the label, not a child:
                    nested, its click also activates the label and opens the
                    select under the tooltip. */}
                <div className="flex w-full items-center gap-1.5">
                  <Label htmlFor={`${fieldId}-scs`} className={FIELD_LABEL}>
                    {t(`${K}.fields.scs`)}
                  </Label>
                  {scsGuessTip ? (
                    <HintIcon tone="warning" label={t(`${K}.fields.scs`)}>
                      {scsGuessTip}
                    </HintIcon>
                  ) : null}
                </div>
                {scsGuessTip ? (
                  <span id={`${fieldId}-scs-provenance`} className="sr-only">
                    {scsGuessTip}
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
                    className={FIELD_TILE.SELECT}
                    aria-describedby={
                      scsGuessTip ? `${fieldId}-scs-provenance` : undefined
                    }
                  >
                    <SelectValue placeholder={t(`${K}.fields.scs`)} />
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

              <motion.div
                variants={staggerRowItem}
                className={tileClass}
              >
                <Label htmlFor={`${fieldId}-band`} className={FIELD_TILE.LABEL}>
                  {t(`${K}.fields.band`)}
                </Label>
                <Input
                  id={`${fieldId}-band`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={band}
                  onChange={(e) => setBand(e.target.value)}
                  disabled={formDisabled}
                  className={FIELD_TILE.CONTROL}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        </CardContent>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isLocking ? t(`${K}.a11y.applying`, { leg: legName }) : ""}
        </div>

        <CardFoot
          className={CARD_PAD}
          status={
            <>
              <RevealButton
                glyph="close"
                label={t(`${K}.actions.clear_fields`)}
                onClick={handleClear}
                disabled={formDisabled || !hasAnyInput}
              />
              {footStatus}
            </>
          }
          actions={
            <>
              <TowerPersistField
                leg="nr_sa"
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
            <AlertDialogTitle>{t(`${K}.dialog.lock_nr_title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.dialog.lock_nr_body`, {
                summary: pendingCell
                  ? t(`${K}.live.target_pair`, {
                      channel: `${t(`${K}.live.tile_arfcn`)} ${pendingCell.arfcn}`,
                      pci: pendingCell.pci,
                    })
                  : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Everything about to be written, each value under its own label. */}
          {pendingCell ? (
            <dl className="grid grid-cols-2 gap-2">
              {[
                {
                  label: t(`${K}.fields.band`),
                  value: `N${pendingCell.band}`,
                },
                {
                  label: t(`${K}.fields.arfcn`),
                  value: String(pendingCell.arfcn),
                },
                { label: t(`${K}.fields.pci`), value: String(pendingCell.pci) },
                {
                  label: t(`${K}.fields.scs`),
                  value: scsLabelFor(pendingCell.scs),
                },
              ].map((row) => (
                <div key={row.label} className={FIELD_TILE.ROOT}>
                  <dt className={FIELD_TILE.LABEL}>{row.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* A wrong SCS is accepted and then never camps: last chance to catch it. */}
          {scsSource === "band_default" && band ? (
            <div className={`${NOTICE.ROOT} ${NOTICE_TONE.warning.fill}`}>
              <span
                aria-hidden="true"
                className={`${NOTICE.DISC} ${NOTICE_TONE.warning.disc}`}
              >
                <MaterialSymbol name={NOTICE_TONE.warning.glyph} size={16} />
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">
                {t(`${K}.fields.scs_guess`, { band })}
              </span>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel variant="tonal-neutral" size="action">
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmLock();
              }}
              size="action"
            >
              {t(`${K}.actions.lock`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${K}.dialog.unlock_title`, { leg: legName })}
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
