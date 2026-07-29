import { MaterialSymbol } from "@/components/ui/material-symbol";

interface ScanningViewProps {
  elapsedSeconds: number;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ScanningView({ elapsedSeconds }: ScanningViewProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
      {/* Animated icon — pulse is opacity-only (GPU composited, low power) */}
      <div className="relative flex items-center justify-center">
        <div className="absolute size-16 motion-safe:animate-pulse rounded-full bg-primary/10" />
        <div className="relative flex size-12 items-center justify-center rounded-full bg-primary/15">
          <MaterialSymbol name="radar" size={20} className="text-primary" />
        </div>
      </div>

      {/* Elapsed time */}
      <p
        className="text-2xl font-semibold tabular-nums tracking-tight text-foreground"
        role="timer"
        aria-live="off"
        aria-label={`Scan elapsed time: ${formatElapsed(elapsedSeconds)}`}
      >
        {formatElapsed(elapsedSeconds)}
      </p>

      {/* Status copy */}
      <div className="max-w-xs space-y-1">
        <p className="text-sm font-medium text-foreground">
          Scanning nearby towers...
        </p>
        <p className="text-xs text-muted-foreground">
          This usually takes 2-3 minutes. Other modem operations are paused
          during the scan.
        </p>
      </div>

      {/* Navigation warning */}
      <p className="text-xs text-muted-foreground/60">
        Please don&apos;t close the tab or refresh the page.
      </p>
    </div>
  );
}
