"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
  type CarrierComponent,
  type SignalQuality,
} from "@/types/modem-status";
import type { TowerModemState } from "@/types/tower-locking";

import {
  CAMPED_ABSENT,
  CARRIER_GRID,
  CARRIER_NOTE_TILE,
  CARRIER_TILE,
  HERO_EYEBROW,
  SKELETON_SHAPE,
  STRIP_GRID,
  STRIP_HEAD,
  STRIP_PANEL,
  VERDICT_BLOCK,
  VERDICT_TONE,
  carrierNoteSpan,
  legShortKey,
  matchVerdict,
  type TowerLeg,
  type TowerMatchVerdict,
} from "./shapes";

// =============================================================================
// TowerLiveStrip — the body of the "Right now" section
// =============================================================================
// Two parts, read as one clause:
//
//     VERDICT   ▸   CAMPED ON NOW
//
// THIS COMPONENT RENDERS NO SHELL AND NO HEADER. The page coordinator owns the
// `TOWER_HERO` section, its `SECTION_HEAD` title and the freshness stamp in that
// header's `META` slot. This is only the content.
//
// The stamp used to live down here, on the verdict block, on the argument that a
// conclusion drawn across two clocks has to wear the slower one. That argument is
// intact and is exactly why the stamp moved UP: BOTH of the verdict's operands —
// the ~4s carrier list and the once-on-mount lock read-back — sit inside the one
// section the stamp now heads, so it dates all of them rather than only the
// conclusion drawn from them. See THE TWO CLOCKS in `shapes.ts`.
//
// -----------------------------------------------------------------------------
// EVERY CAMPED CARRIER IS A PEER TILE
// -----------------------------------------------------------------------------
// The arrangement this replaces was one full-anatomy LEAD block over a list of
// one-line secondary rows. Primacy is now carried by the identity chip alone —
// "LTE PCC" against "LTE SCC" — and by nothing else: not by area, not by
// anatomy, not by fill.
//
// That is the honest shape. `AT+QNWLOCK` pins a PRIMARY cell; the SCCs are
// carriers the network attached alongside it, and a secondary IS a legitimate
// lock target the moment the network reselects. Giving it a visibly lesser
// affordance implied a ranking the AT layer does not have.
//
// TWO READINGS PER TILE, PCI AND RSRP, AND NO THIRD LINE. The mock this grid
// comes from carried an `EARFCN · RSRQ · SINR` row. It is cut: the channel and
// its quality figures are already printed by the leg card that owns the lock,
// inches below, and the NR variant of that line printed a subcarrier spacing
// looked up from a BAND TABLE — a guess wearing the typeface of a measurement.
//
// THE RSRP TINT IS NEVER THE ONLY CHANNEL, AND UNDER THE FIVE-STOP RAMP IT CAN
// NEVER BE. The ramp is a LIGHTNESS STAIRCASE, not a hue wheel: adjacent stops
// sit deliberately below the 0.05 CVD separation floor, on the understanding
// that bar LENGTH carries the adjacent distinctions. So each reading here runs
// on three channels — the ramp numeral ink, a 56px meter pinned to that figure,
// and an `sr-only` quality word — and a missing reading renders an EMPTY TRACK
// rather than a zero-length fill at the bottom of the scale.
//
// Every one of those comes from `components/cellular/signal-quality-display.ts`
// (`qualityInkClass` / `qualityMeterTone`), the same module `radio/active-bands-
// card.tsx` reads, so the two surfaces cannot disagree about what a tint means.
// =============================================================================

export interface TowerLiveStripProps {
  modemState: TowerModemState | null;
  /** Live QCAINFO carriers from `useModemStatus`. */
  carrierComponents: CarrierComponent[];
  /** Which legs can currently accept a lock target from a carrier. */
  canTarget: Record<TowerLeg, { ok: boolean; reasonKey: string | null }>;
  isLoading: boolean;
  onPickCarrier: (carrier: CarrierComponent) => void;
}

/**
 * Verdict -> its two copy keys, written out as LITERALS rather than built as
 * `` `verdict_${v}_title` ``.
 *
 * `i18n:check` grades a missing key as a warning and exits 0, so a key it
 * cannot see statically is a key nothing will ever tell you about. An
 * interpolated stem is invisible to it; these are not. Same reasoning as the
 * leg cards' status labels — see `docs/reference/i18n.md`.
 */
const VERDICT_COPY: Record<TowerMatchVerdict, { title: string; body: string }> =
  {
    on_target: {
      title: "tower_locking.live.verdict_on_target_title",
      body: "tower_locking.live.verdict_on_target_body",
    },
    off_target: {
      title: "tower_locking.live.verdict_off_target_title",
      body: "tower_locking.live.verdict_off_target_body",
    },
    unverified: {
      title: "tower_locking.live.verdict_unverified_title",
      body: "tower_locking.live.verdict_unverified_body",
    },
    unlocked: {
      title: "tower_locking.live.verdict_unlocked_title",
      body: "tower_locking.live.verdict_unlocked_body",
    },
    unknown: {
      title: "tower_locking.live.verdict_unknown_title",
      body: "tower_locking.live.verdict_unknown_body",
    },
  };

/**
 * The non-chromatic half of an RSRP reading, borrowed from the `/cellular/`
 * index rather than restated — one vocabulary for "fair" across the route.
 *
 * Literal keys for the same reason `VERDICT_COPY` spells its own out: an
 * interpolated stem is a key the drift gate cannot see.
 */
const QUALITY_LABEL_KEY: Record<SignalQuality, string> = {
  excellent: "radio_info.bands.quality.excellent",
  good: "radio_info.bands.quality.good",
  fair: "radio_info.bands.quality.fair",
  poor: "radio_info.bands.quality.poor",
  // The fifth ramp stop, below `poor`. RSRP under −120 dBm is not "try harder"
  // territory — the cell is effectively not being received — and this is the
  // surface where that matters most, because the reader is deciding whether to
  // LOCK to the cell in question. `Record<SignalQuality, …>` is what forced this
  // member to be written rather than silently defaulting.
  bad: "radio_info.bands.quality.bad",
  none: "radio_info.bands.quality.none",
};

/**
 * Camped-on carriers, ordered PCC first then LTE before NR — the LTE leg is the
 * anchor in NSA, so it is the one a reader looks for first when a 5G connection
 * misbehaves. `Array.prototype.sort` is stable, so carriers within one rank keep
 * the order the radio reported them in.
 */
function sortCarriers(components: CarrierComponent[]): CarrierComponent[] {
  return [...components].sort((a, b) => {
    const leadRank = (c: CarrierComponent) => (c.type === "PCC" ? 0 : 1);
    const techRank = (c: CarrierComponent) => (c.technology === "LTE" ? 0 : 1);
    return leadRank(a) - leadRank(b) || techRank(a) - techRank(b);
  });
}

/** Which leg a carrier would be locked on. */
function legForCarrier(c: CarrierComponent): TowerLeg {
  return c.technology === "LTE" ? "lte" : "nr_sa";
}

/** Literal keys, for the reason `VERDICT_COPY` spells them out. */
function techKey(technology: "LTE" | "NR"): string {
  return technology === "LTE"
    ? "tower_locking.live.tile_tech_LTE"
    : "tower_locking.live.tile_tech_NR";
}

/**
 * Is THIS camped carrier one of the cells the modem reports as a lock target?
 *
 * The same comparison `matchVerdict()` makes in `shapes.ts`, read from the other
 * end: that function asks "is any camped carrier a target" to produce one
 * page-level verdict, this one asks "is this carrier a target" to mark one tile.
 * Both gate on `*_locked` first — a stale `lte_cells` array behind a false
 * `lte_locked` is not a target — and both compare the exact (channel, PCI) pair,
 * so a tile can never be ringed by a rule the verdict above it disagrees with.
 */
function isLockTarget(
  c: CarrierComponent,
  modemState: TowerModemState | null,
): boolean {
  if (modemState === null || c.earfcn === null || c.pci === null) return false;
  if (c.technology === "LTE") {
    if (!modemState.lte_locked) return false;
    return (modemState.lte_cells ?? []).some(
      (cell) => cell.earfcn === c.earfcn && cell.pci === c.pci,
    );
  }
  if (!modemState.nr_locked || modemState.nr_cell === null) return false;
  return (
    modemState.nr_cell.arfcn === c.earfcn && modemState.nr_cell.pci === c.pci
  );
}

export function TowerLiveStrip({
  modemState,
  carrierComponents,
  canTarget,
  isLoading,
  onPickCarrier,
}: TowerLiveStripProps) {
  const { t } = useTranslation("cellular");

  const onAir = useMemo(
    () => sortCarriers(carrierComponents),
    [carrierComponents],
  );

  const verdict = matchVerdict(modemState, onAir);
  const verdictTone = VERDICT_TONE[verdict];
  const verdictCopy = VERDICT_COPY[verdict];

  /** The picker gate for one carrier: addressable at all, then leg-permitted. */
  const pickState = (c: CarrierComponent) => {
    // A cell with no PCI or no channel cannot be a lock target at all — the AT
    // command needs both halves of the pair.
    const addressable = c.pci !== null && c.earfcn !== null;
    const gate = canTarget[legForCarrier(c)];
    return { addressable, gate, pickable: addressable && gate.ok };
  };

  // The carrier list is fed by a DIFFERENT hook than `isLoading` (which gates
  // the lock read-back), so the real cell count is usually already known while
  // this branch renders — mirror it exactly, plus the one note tile the grid
  // always carries. One tile is the floor, because a skeleton that SHRINKS on
  // load pulls the panel beside it upward into space the reader had started on.
  const skeletonTiles = onAir.length > 0 ? onAir.length + 1 : 1;

  return (
    <div className={STRIP_GRID}>
      {/* --- 1. The verdict ------------------------------------------------
          The only fact on this page neither source carries on its own. */}
      {isLoading ? (
        <Skeleton className={SKELETON_SHAPE.VERDICT} />
      ) : (
        <div
          role="status"
          className={`${VERDICT_BLOCK.ROOT} ${verdictTone.fill}`}
        >
          <span
            aria-hidden="true"
            className={`${VERDICT_BLOCK.DISC} ${verdictTone.disc}`}
          >
            <MaterialSymbol name={verdictTone.glyph} size={26} filled />
          </span>
          {/* The state word is announced, never drawn — the disc's glyph and
              fill carry it visually, and the body says it in full underneath.
              See `VERDICT_BLOCK` for why the key survives rather than the
              copy being folded into the body. */}
          <span className={VERDICT_BLOCK.TITLE}>{t(verdictCopy.title)}</span>
          <p className={VERDICT_BLOCK.BODY}>{t(verdictCopy.body)}</p>
        </div>
      )}

      {/* --- 2. Camped on now --------------------------------------------- */}
      <div className={STRIP_PANEL}>
        <div className={STRIP_HEAD}>
          <span className="relative inline-flex size-2" aria-hidden="true">
            <span className="animate-live-ping bg-success absolute inset-0 rounded-pill motion-reduce:animate-none" />
            <span className="bg-success relative size-2 rounded-pill" />
          </span>
          <span className={HERO_EYEBROW}>
            {t("tower_locking.live.camped_on")}
          </span>
        </div>

        {isLoading ? (
          <div className={CARRIER_GRID}>
            {Array.from({ length: skeletonTiles }).map((_, i) => (
              <Skeleton key={i} className={SKELETON_SHAPE.CARRIER_TILE} />
            ))}
          </div>
        ) : onAir.length === 0 ? (
          <div className="rounded-tile bg-surface flex items-center gap-3.5 px-4 py-4">
            <span className="bg-surface-container-high text-on-surface-variant grid size-11 flex-none place-items-center rounded-pill">
              <MaterialSymbol name="signal_cellular_off" size={22} />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-semibold">
                {t("tower_locking.live.camped_empty_title")}
              </p>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                {t("tower_locking.live.camped_empty_body")}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className={CARRIER_GRID} role="list">
              {onAir.map((c) => {
                const { addressable, gate, pickable } = pickState(c);
                const locked = isLockTarget(c, modemState);
                const quality = getSignalQuality(c.rsrp, RSRP_THRESHOLDS);
                // `null` for `none`, and that single null drives all three
                // channels below: no fill, no ramp ink, and the "no reading"
                // word instead of a quality verdict.
                const rsrpTone = qualityMeterTone(quality);
                const rsrpPercent =
                  rsrpTone === null
                    ? null
                    : signalToProgress(c.rsrp, RSRP_THRESHOLDS);
                return (
                  <div
                    key={`${c.technology}-${c.type}-${c.band}-${c.earfcn ?? "x"}`}
                    role="listitem"
                    className={`${CARRIER_TILE.ROOT} ${locked ? CARRIER_TILE.MATCH : ""}`}
                  >
                    <div className={CARRIER_TILE.HEAD}>
                      {/* IDENTITY, not health: `nr`/`lte` say which radio this
                          tile belongs to and never mean "healthy". */}
                      <Tag
                        variant={c.technology === "LTE" ? "lte" : "nr"}
                        className="flex-none"
                      >
                        {t(techKey(c.technology))} {c.type}
                      </Tag>
                      <span className={CARRIER_TILE.BAND}>{c.band}</span>

                      {locked ? (
                        /* The tile is already the lock target, so there is
                           nothing to pick. The filled disc is the second
                           channel beside `CARRIER_TILE.MATCH`'s inset ring —
                           the ring alone would be a shape signal with no
                           name, and it is announced in words below. */
                        <>
                          <span
                            aria-hidden="true"
                            className="bg-primary-container text-on-primary-container ml-auto grid size-8 flex-none place-items-center rounded-pill"
                          >
                            <MaterialSymbol name="lock" size={16} filled />
                          </span>
                          <span className="sr-only">
                            {t("tower_locking.live.tile_locked_a11y", {
                              band: c.band,
                              pci: c.pci,
                            })}
                          </span>
                        </>
                      ) : addressable ? (
                        /* Disabled with a REASON rather than absent when the
                           leg cannot take a target — silently dropping the
                           control leaves the user to infer the rule.

                           `aria-disabled`, NOT the native `disabled`, and the
                           tooltip is why. A disabled element receives no
                           pointer events and cannot be focused, so the reason
                           it was carrying was reachable by neither hover nor
                           keyboard: this was the one explained control on the
                           page and its explanation did not actually arrive.
                           `aria-disabled` announces the same state, keeps the
                           tile's button in the tab order, and lets the reason
                           land on hover AND on focus. Dropping the handler
                           rather than guarding inside it means there is no
                           second place for "blocked" to be decided — see
                           `cell-scanner/sibling-link.tsx`. */
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-disabled={!pickable || undefined}
                              onClick={
                                pickable ? () => onPickCarrier(c) : undefined
                              }
                              className={CARRIER_TILE.ACTION}
                              /* The reason travels with the NAME too: a screen
                                 reader that hears "Use B3 / PCI 135 for LTE"
                                 has been told this control works. */
                              aria-label={
                                pickable || !gate.reasonKey
                                  ? t("tower_locking.live.tile_use_a11y", {
                                      band: c.band,
                                      pci: c.pci,
                                      leg: t(legShortKey(legForCarrier(c))),
                                    })
                                  : `${t("tower_locking.live.tile_use_a11y", {
                                      band: c.band,
                                      pci: c.pci,
                                      leg: t(legShortKey(legForCarrier(c))),
                                    })} — ${t(gate.reasonKey)}`
                              }
                            >
                              {/* The glyph, not the 45% disabled opacity, is
                                  what separates "pick this" from "you cannot
                                  pick this" — opacity is the first thing to
                                  go in sunlight. */}
                              <MaterialSymbol
                                name={pickable ? "add" : "do_not_disturb_on"}
                                size={18}
                              />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64">
                            <p>
                              {pickable
                                ? t("tower_locking.live.tile_use")
                                : gate.reasonKey
                                  ? t(gate.reasonKey)
                                  : null}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>

                    <div className={CARRIER_TILE.BODY}>
                      <span className={CARRIER_TILE.PCI_LABEL}>
                        {t("tower_locking.live.tile_pci")}
                      </span>
                      <span className={CARRIER_TILE.PCI_VALUE}>
                        {c.pci ?? t("tower_locking.live.tile_no_value")}
                      </span>
                      {/* THE GAUGE AND THE FIGURE ARE ONE OBJECT, and they have
                          to be. `CARRIER_TILE.RSRP` ships no colour of its own;
                          the tone is now the five-stop ramp's numeral ink, and a
                          ramp colour is only legal beside a bar whose LENGTH
                          carries the same reading — adjacent stops sit below the
                          0.05 CVD separation floor by design.

                          The bar is a 56px lane pinned to the figure, NOT the
                          full-width rule under the tile body that `shapes.ts`
                          records as cut. That objection was twofold and both
                          halves are answered: it drew an IDENTITY colour (a
                          third channel restating the `nr`/`lte` Tag), where this
                          draws a measurement; and full-bleed under the last line
                          it read as a coloured bottom border rather than a
                          gauge, where a short lane inside the row reads as
                          belonging to the number it sits against. Staying inside
                          the existing row also keeps the tile at the 87px
                          `SKELETON_SHAPE.CARRIER_TILE` mirrors. */}
                      {/* `div`, not `span`: `MetricBar` renders a `div` track,
                          and a block inside an inline element is invalid markup
                          browsers silently reflow around. */}
                      <div className="ml-auto flex min-w-0 items-center gap-2 self-center">
                        <div className="w-14 min-w-6 shrink" aria-hidden="true">
                          <MetricBar
                            value={rsrpPercent}
                            max={100}
                            // Unreachable: `colorOverride` pins the tone. Present
                            // only to satisfy the required props.
                            warnAt={101}
                            dangerAt={101}
                            // Null passes straight through, never a fallback
                            // colour — with no reading there is no fill for it
                            // to tint.
                            colorOverride={rsrpTone}
                            track="surface-container-high"
                          />
                        </div>
                        <span
                          className={`${CARRIER_TILE.RSRP} ${qualityInkClass(quality)}`}
                        >
                          {c.rsrp === null
                            ? t("tower_locking.live.tile_no_value")
                            : t("tower_locking.live.tile_rsrp", {
                                value: c.rsrp,
                              })}
                        </span>
                      </div>
                      {/* The non-chromatic channel. Announced for an absent
                          reading too: an empty track and a full one differ by
                          pixels no screen reader can see. */}
                      <span className="sr-only">
                        {t(QUALITY_LABEL_KEY[quality])}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* The note fills the grid's ragged remainder, so the set ends
                  rather than trailing off — and it spends that space on the
                  one rule of this feature the grid cannot demonstrate: what
                  the + does, and that a tower lock pins BOTH halves of the
                  pair. It used to print a carrier tally over a claim that only
                  the primary is lockable; see `CARRIER_NOTE_TILE` for why both
                  halves of that were wrong in this slot.

                  `role="listitem"` even though it is not a carrier: every child
                  of a `role="list"` must be a list item, and this one genuinely
                  belongs to the set — it describes where the set stops. Same
                  treatment as band locking's absent-leg cell. */}
              <div
                role="listitem"
                className={`${CARRIER_NOTE_TILE.ROOT} ${carrierNoteSpan(onAir.length)}`}
              >
                <MaterialSymbol
                  name="cell_tower"
                  size={18}
                  className="flex-none"
                />
                <span className={CARRIER_NOTE_TILE.BODY}>
                  {t("tower_locking.live.note_hint")}
                </span>
              </div>
            </div>

            {/* One carrier on air: name the radio that is NOT, rather than
                leaving it unsaid. A note and not a tile — a second tile
                claiming "no 5G" would enter the reading order as a carrier,
                and on a modem whose SKU may not support SA the absence is
                often not a fault at all. */}
            {onAir.length === 1 ? (
              <p className={CAMPED_ABSENT}>
                <MaterialSymbol
                  name="signal_cellular_off"
                  size={16}
                  className="flex-none"
                />
                {t(
                  onAir[0].technology === "LTE"
                    ? "tower_locking.live.absent_nr_title"
                    : "tower_locking.live.absent_lte_title",
                )}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default TowerLiveStrip;
