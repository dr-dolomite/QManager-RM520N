"use client";

import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";

interface CopyableCommandProps {
  command: string;
}

export function CopyableCommand({ command }: CopyableCommandProps) {
  const handleCopy = async () => {
    if (await copyText(command)) {
      toast.success("Copied to clipboard");
    } else {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <button
      type="button"
      className="bg-muted px-4 py-2.5 rounded-md text-xs font-mono text-muted-foreground select-all max-w-full overflow-x-auto text-left cursor-pointer hover:bg-muted/80 transition-colors duration-[var(--duration-quick)] ease-out"
      onClick={handleCopy}
      title="Click to copy"
      aria-label="Copy install command to clipboard"
    >
      {command}
    </button>
  );
}
