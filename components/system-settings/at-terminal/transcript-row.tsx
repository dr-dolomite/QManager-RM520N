"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  MinusCircleIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { clockTime, entryToText, type EntryStatus, type HistoryEntry } from "./derive";
import { ROW, ROW_INK, STATUS_TONE } from "./shapes";

/**
 * Three statuses, three DISTINCT glyphs. Two rows in the same slot never share
 * one: the tone inks sit close enough that the glyph is the only separator a
 * row has under deuteranopia.
 */
const STATUS_GLYPH = {
  success: CheckCircle2Icon,
  error: XCircleIcon,
  blocked: MinusCircleIcon,
} satisfies Record<EntryStatus, LucideIcon>;

export interface TranscriptRowProps {
  entry: HistoryEntry;
  /** Translated screen-reader word for the row's status. */
  statusWord: string;
  copyLabel: string;
  copiedLabel: string;
}

export function TranscriptRow({
  entry,
  statusWord,
  copyLabel,
  copiedLabel,
}: TranscriptRowProps): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const Glyph = STATUS_GLYPH[entry.status];
  const ink = ROW_INK[STATUS_TONE[entry.status]];

  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(entryToText(entry));
      setCopied(true);
    } catch {
      // A denied clipboard permission is not something to shout about; the
      // transcript is still selectable.
    }
  };

  return (
    <div className={ROW.ROOT}>
      <span className={ROW.TIME}>{clockTime(entry.timestamp)}</span>
      <Glyph className={cn(ROW.GLYPH, ink.GLYPH)} aria-hidden="true" />

      <div className={ROW.BODY}>
        <span className="sr-only">{statusWord}</span>
        <span className={ROW.COMMAND}>{entry.command}</span>
        <span className={cn(ROW.RESPONSE, ink.RESPONSE)}>{entry.response}</span>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? copiedLabel : copyLabel}
        onClick={() => void handleCopy()}
        className={ROW.COPY}
      >
        {copied ? (
          <CheckIcon className={ROW.COPY_GLYPH} />
        ) : (
          <CopyIcon className={ROW.COPY_GLYPH} />
        )}
      </Button>
    </div>
  );
}

export default TranscriptRow;
