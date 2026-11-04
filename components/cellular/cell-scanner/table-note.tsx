"use client";

import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";

import { TABLE_NOTE } from "./shapes";

// =============================================================================
// ScanTableNote — the strip under the results table
// =============================================================================
// Two halves, and they answer the two questions the table itself cannot.
//
// LEFT: what a row can DO. Locking a row copies its band, EARFCN and PCI into
// Tower Locking, and the only way to learn that was to try it. On the neighbour
// route the same slot explains why half the rows carry no quality at all.
//
// RIGHT: what the rows ADD UP TO. A tier tally is the one reading of a long
// table a reader cannot get by scrolling it.
//
// THE TALLY IS A LIST, NOT A SENTENCE, and that is load-bearing twice over. The
// No-Dot-Separator Rule bans `·` as glue between short facts, so the items are
// separate inline elements with a gap; and each item is its own i18next plural,
// because one string cannot carry four independent counts through a plural rule.
// Both incumbents hardcoded `n === 1 ? "cell" : "cells"`, which is wrong in four
// of the five shipped locales before a translator ever sees it.
// =============================================================================

export interface ScanTableNoteProps {
  /** Distinct from every other glyph in this slot on the same route. */
  glyph: MaterialSymbolName;
  text: string;
  /** Pre-pluralised by the caller, one string per fact. */
  tally: string[];
}

export function ScanTableNote({ glyph, text, tally }: ScanTableNoteProps) {
  return (
    <div className={TABLE_NOTE.ROOT}>
      <MaterialSymbol
        name={glyph}
        size={18}
        className="text-on-surface-variant flex-none"
      />
      <p className={TABLE_NOTE.TEXT}>{text}</p>

      {tally.length > 0 ? (
        <span className={TABLE_NOTE.TALLY} aria-live="polite">
          {tally.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export default ScanTableNote;
