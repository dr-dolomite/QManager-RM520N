"use client";

import { useTranslation } from "react-i18next";

import { SLOT } from "./shapes";

// =============================================================================
// BandMatchDisplay — which bands a channel number lands in
// =============================================================================
// Shared by both frequency-lock cards, rendered directly under the channel a
// user typed or staged. Two jobs, and the second one is the load-bearing one:
//
//   1. Say which bands the number maps to, so a typo that lands on a real but
//      unintended band is visible before it is applied.
//   2. Mark the bands this modem does NOT support. `frequency/lock.sh:10` warns
//      that locking to an unsupported band can crash-dump the modem, and this
//      feature has no failover watcher to recover from it. This line is the
//      first of the two guards; the confirmation dialog is the second.
//
// -----------------------------------------------------------------------------
// TWO THINGS THAT CHANGED IN THE REBUILD
// -----------------------------------------------------------------------------
// EVERY STRING IS A KEY. The incumbent shipped "Possible bands:", "No matching
// bands found for …" and " — unsupported" as English literals, so no locale
// could ever reach them. They are `frequency_locking.bands.*` now. The
// `noMatchLabel` prop stays a plain string rather than a key because the caller
// knows whether it is describing an EARFCN or an ARFCN — but it must arrive
// ALREADY TRANSLATED, never as a key name for this component to interpolate.
//
// TOKENS, NOT RAW COLOURS. `text-muted-foreground` became `SLOT.META` (which is
// this surface's meta ink) and the unsupported marker moved from `destructive`
// to `destructive-on-surface` — the token that exists precisely because
// `--destructive` is a FILL, and reading it as ink on a plain card surface fails
// contrast in light mode.
// =============================================================================

interface BandEntry {
  band: number;
  name: string;
}

export interface BandMatchDisplayProps {
  /** Matched band entries from the earfcn/arfcn lookup. */
  bands: BandEntry[];
  /** Whether the channel this line describes has a value at all. */
  hasInput: boolean;
  /** Band numbers this modem reports as supported. Empty = unknown, so no marks. */
  supportedBands: number[];
  /** Band prefix: "B" for LTE, "n" for NR. */
  prefix: string;
  /**
   * The noun for the "no match" sentence, ALREADY TRANSLATED by the caller.
   * Defaults to `bands.this_frequency`.
   */
  noMatchLabel?: string;
}

export function BandMatchDisplay({
  bands,
  hasInput,
  supportedBands,
  prefix,
  noMatchLabel,
}: BandMatchDisplayProps): React.JSX.Element | null {
  const { t } = useTranslation("cellular");

  if (!hasInput) return null;

  const label = noMatchLabel ?? t("frequency_locking.bands.this_frequency");

  if (bands.length === 0) {
    return (
      <p className={`${SLOT.META} text-destructive-on-surface`}>
        {t("frequency_locking.bands.none", { label })}
      </p>
    );
  }

  return (
    <p className={SLOT.META}>
      {t("frequency_locking.bands.possible")}{" "}
      {bands.map((entry, index) => {
        // An empty supported list means the modem has not reported its bands,
        // not that nothing is supported. Marking everything unsupported there
        // would be a false alarm on the one page where a false alarm is
        // expensive, so the marks are simply withheld.
        const isSupported =
          supportedBands.length === 0 || supportedBands.includes(entry.band);
        return (
          <span key={entry.band}>
            {index > 0 ? ", " : null}
            <span
              className={
                isSupported ? undefined : "text-destructive-on-surface font-medium"
              }
            >
              {prefix}
              {entry.band} ({entry.name})
              {isSupported
                ? null
                : ` — ${t("frequency_locking.bands.unsupported_suffix")}`}
            </span>
          </span>
        );
      })}
    </p>
  );
}
