"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { ExpandButton } from "@/components/ui/expand-button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { copyText } from "@/lib/clipboard";

// Icon-only pill that expands to "Copy diagnostics" on hover/focus. It sits
// beside the band-reference toggle in the Spectrum card header
// (`active-bands-card.tsx`); the page header carries no action.

export interface CopyDiagnosticsButtonProps {
  /** Returns the diagnostics blob to place on the clipboard. */
  buildDiagnostics: () => string;
  className?: string;
}

export function CopyDiagnosticsButton({
  buildDiagnostics,
  className,
}: CopyDiagnosticsButtonProps) {
  const { t } = useTranslation("cellular");
  const [copied, setCopied] = React.useState(false);
  const resetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const handleCopy = React.useCallback(async () => {
    if (await copyText(buildDiagnostics())) {
      setCopied(true);
      toast.success(t("radio_info.header.copy_success"));
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t("radio_info.header.copy_error"));
    }
  }, [buildDiagnostics, t]);

  return (
    <ExpandButton
      onClick={handleCopy}
      className={className}
      icon={<MaterialSymbol name={copied ? "check" : "content_copy"} size={18} />}
      label={
        copied ? t("radio_info.header.copied") : t("radio_info.header.copy")
      }
    />
  );
}

export default CopyDiagnosticsButton;
