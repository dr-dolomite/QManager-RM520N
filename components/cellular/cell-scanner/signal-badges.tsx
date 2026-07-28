import { SignalHighIcon, SignalMediumIcon, SignalLowIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// These three chips share one table column, so they are read against each other
// rather than in isolation. `success-container` and `warning-container` sit
// 1.03:1 apart in measured contrast — the same surface to the eye, and identical
// under deuteranopia — so Good and Fair cannot be told apart by fill. The signal
// glyph encodes the verdict by bar count, which survives both a colourblind
// reader and a greyscale print.
export function SignalBadge({ strength }: { strength: number }) {
  if (strength >= -85)
    return (
      <Badge variant="success">
        <SignalHighIcon className="size-3" />
        Good
      </Badge>
    );
  if (strength >= -100)
    return (
      <Badge variant="warning">
        <SignalMediumIcon className="size-3" />
        Fair
      </Badge>
    );
  return (
    <Badge variant="destructive">
      <SignalLowIcon className="size-3" />
      Bad
    </Badge>
  );
}

export function NetworkTypeBadge({ type }: { type: string }) {
  return <Badge variant="default">{type}</Badge>;
}
