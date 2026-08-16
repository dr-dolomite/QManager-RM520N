"use client";

import * as React from "react";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SwapLabel } from "@/components/ui/swap-label";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import {
  POSTURE,
  READOUT,
  READOUT_DISC,
  networkIdentity,
} from "../shapes";
import type { NetworkType } from "./calc-model";

// =============================================================================
// The readout rail — the anchor's left column
// =============================================================================
// This slot is the scanner family's posture rail, holding an answer instead of
// a state. It reuses `POSTURE.ROOT` and `POSTURE.DISC` outright: the two
// surfaces are the same object at the same size in the same corner of the same
// hero, and the one thing they must never do is drift apart by a padding step.
//
// THE SWAP IS THE PAGE'S ONE AUTHORED MOMENT. Everything else here arrives with
// the entrance cascade and then holds still. The calculation is user-initiated
// and instantaneous — there is no request, no spinner, and nothing to wait for
// — so without motion the 44px figure simply becomes a different 44px figure
// between two frames, and a reader who mistypes one digit cannot tell whether
// the button did anything. `SwapLabel` gives the outgoing value an exit and the
// incoming one an entrance offset by one stagger step, which is the difference
// between "the number changed" and "the number is different now".
//
// Four states, FOUR DISTINCT GLYPHS. `tune` before anything is calculated,
// `graphic_eq` for a resolved frequency on either radio, `error` for a failure.
// Idle and resolved must not share a glyph even though they share a slot, and
// the two radios must not be told apart by disc colour alone — the band label
// and the identity tag directly beneath carry that in words.
// =============================================================================

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
      /** Stands in for the band label when several bands do. */
      caption: string | null;
    };

export function CalcReadout({
  state,
  idleTitle,
  idleBody,
  failedTitle,
  failedBody,
}: {
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

  // Everything the figure renders has to be in the key, not just the value:
  // two calculations that resolve to the same MHz on different radios should
  // still read as a change, and two that render identically should not.
  const swapKey =
    state.kind === "result"
      ? `${state.networkType}:${state.channelLabel}:${state.figure}`
      : state.kind;

  return (
    <div
      className={POSTURE.ROOT}
      role={state.kind === "failed" ? "alert" : undefined}
      aria-live="polite"
    >
      <span className={cn(POSTURE.DISC, READOUT_DISC[tone])}>
        <MaterialSymbol
          name={glyph}
          size={32}
          filled={state.kind !== "idle"}
        />
      </span>

      {state.kind === "result" ? (
        <>
          <SwapLabel
            swapKey={swapKey}
            className="flex-col items-center gap-1"
          >
            <span className={READOUT.FIGURE}>{state.figure}</span>
            <span className={READOUT.UNIT}>{state.unit}</span>
          </SwapLabel>

          <span className={READOUT.CHANNEL}>{state.channelLabel}</span>

          <span className="flex flex-wrap items-center justify-center gap-2">
            <Tag variant={networkIdentity(state.networkType)}>
              {state.networkType}
            </Tag>
            {state.bandLabel ? (
              <span className={READOUT.BAND}>{state.bandLabel}</span>
            ) : null}
          </span>

          {state.caption ? (
            <span className={READOUT.CAPTION}>{state.caption}</span>
          ) : null}
        </>
      ) : (
        <>
          <span className={POSTURE.TITLE}>
            {state.kind === "failed" ? failedTitle : idleTitle}
          </span>
          <span className={POSTURE.BODY}>
            {state.kind === "failed" ? failedBody : idleBody}
          </span>
        </>
      )}
    </div>
  );
}

export type { ReadoutState };
