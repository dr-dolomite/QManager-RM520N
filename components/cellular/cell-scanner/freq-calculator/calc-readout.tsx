"use client";

import * as React from "react";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SwapLabel } from "@/components/ui/swap-label";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import { CALC_RAIL, READOUT, READOUT_DISC, networkIdentity } from "../shapes";
import type { NetworkType } from "./calc-model";

// The answer rail: disc, swapped figure, identity block on the right edge — and the only place a failure prints.
// Four states, distinct glyphs: `tune` idle, `graphic_eq` either radio, `error` failed.

type ReadoutState =
  | { kind: "idle" }
  | { kind: "failed" }
  | {
      kind: "result";
      networkType: NetworkType;
      /** Already formatted, unit stripped — the unit is its own node. */
      figure: string;
      unit: string;
      channelLabel: string;
      /** The band label, when exactly one band claims this channel. */
      bandLabel: string | null;
      /** The single band's name, when there is one. */
      bandName: string | null;
      /** Stands in for the band name when several bands share the channel. */
      caption: string | null;
    };

export function CalcReadout({
  id,
  state,
  idleTitle,
  idleBody,
  failedTitle,
  failedBody,
}: {
  /** The rail's own id, so the field's `aria-describedby` can point at it. */
  id: string;
  state: ReadoutState;
  idleTitle: string;
  idleBody: string;
  failedTitle: string;
  failedBody: string;
}) {
  const tone =
    state.kind === "idle"
      ? "idle"
      : state.kind === "failed"
        ? "failed"
        : state.networkType === "NR"
          ? "nr"
          : "lte";

  const glyph =
    state.kind === "idle" ? "tune" : state.kind === "failed" ? "error" : "graphic_eq";

  // Everything the figure renders is in the key, so the same MHz on another radio still swaps.
  const swapKey =
    state.kind === "result"
      ? `${state.networkType}:${state.channelLabel}:${state.figure}`
      : state.kind;

  return (
    <div
      id={id}
      className={CALC_RAIL.ROOT}
      role={state.kind === "failed" ? "alert" : undefined}
      aria-live="polite"
    >
      <span className={cn(CALC_RAIL.DISC, READOUT_DISC[tone])}>
        <MaterialSymbol name={glyph} size={28} filled={state.kind !== "idle"} />
      </span>

      {state.kind === "result" ? (
        <>
          <div className={CALC_RAIL.FIGURE}>
            <SwapLabel swapKey={swapKey} className={CALC_RAIL.FIGURE_VALUE}>
              <span className={READOUT.FIGURE}>{state.figure}</span>
              <span className={READOUT.UNIT}>{state.unit}</span>
            </SwapLabel>
            <span className={READOUT.CHANNEL}>{state.channelLabel}</span>
          </div>

          <div className={CALC_RAIL.IDENTITY}>
            <div className={CALC_RAIL.IDENTITY_ROW}>
              <Tag variant={networkIdentity(state.networkType)}>
                {state.networkType}
              </Tag>
              {state.bandLabel ? (
                <span className={READOUT.BAND}>{state.bandLabel}</span>
              ) : null}
            </div>
            <span className={READOUT.CAPTION}>
              {state.bandName ?? state.caption}
            </span>
          </div>
        </>
      ) : (
        <div className={CALC_RAIL.MESSAGE}>
          <span className={READOUT.TITLE}>
            {state.kind === "failed" ? failedTitle : idleTitle}
          </span>
          <span className={READOUT.BODY}>
            {state.kind === "failed" ? failedBody : idleBody}
          </span>
        </div>
      )}
    </div>
  );
}

export type { ReadoutState };
