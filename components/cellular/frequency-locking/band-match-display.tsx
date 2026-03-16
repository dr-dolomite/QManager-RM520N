// =============================================================================
// BandMatchDisplay — Inline band match feedback below an EARFCN/ARFCN input
// =============================================================================
// Shared by both LTE and NR frequency locking cards. Shows which bands match
// the entered frequency, highlighting unsupported bands in destructive color.
// =============================================================================

interface BandEntry {
  band: number;
  name: string;
}

interface BandMatchDisplayProps {
  /** Matched band entries from earfcn lookup */
  bands: BandEntry[];
  /** Whether the input field has any value */
  hasInput: boolean;
  /** Hardware-supported band numbers for this technology */
  supportedBands: number[];
  /** Band prefix for display (e.g., "B" for LTE, "n" for NR) */
  prefix: string;
  /** Label for the "no match" error (e.g., "this channel", "this NR-ARFCN") */
  noMatchLabel?: string;
}

export function BandMatchDisplay({
  bands,
  hasInput,
  supportedBands,
  prefix,
  noMatchLabel = "this frequency",
}: BandMatchDisplayProps) {
  if (!hasInput) return null;

  if (bands.length === 0) {
    return (
      <p className="text-xs text-destructive mt-1">
        No matching bands found for {noMatchLabel}
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground mt-1">
      Possible bands:{" "}
      {bands.map((b, i) => {
        const isSupported =
          supportedBands.length === 0 || supportedBands.includes(b.band);
        return (
          <span key={b.band}>
            {i > 0 && ", "}
            <span
              className={isSupported ? "" : "text-destructive font-medium"}
            >
              {prefix}{b.band} ({b.name}){!isSupported && " — unsupported"}
            </span>
          </span>
        );
      })}
    </p>
  );
}
