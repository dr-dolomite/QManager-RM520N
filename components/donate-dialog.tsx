"use client";

import type * as React from "react";
import { HeartIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import DonateLinks from "@/components/support/donate-links";
import { DIALOG } from "@/components/support/shapes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const K = "donate";

export interface DonateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Opened from the sidebar and from About Device. It renders the same
 * `DonateLinks` the `/support` band does, so the channels cannot drift.
 */
export function DonateDialog({
  open,
  onOpenChange,
}: DonateDialogProps): React.JSX.Element {
  const { t } = useTranslation("common");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG.ROOT}>
        <DialogHeader className={DIALOG.HEAD}>
          <div className={DIALOG.DISC} aria-hidden="true">
            <HeartIcon className={cn(DIALOG.DISC_GLYPH, "fill-current")} />
          </div>
          <div className={DIALOG.TITLES}>
            <DialogTitle className={DIALOG.TITLE}>
              {t(`${K}.dialog.title`)}
            </DialogTitle>
            <DialogDescription className={DIALOG.PARAGRAPH}>
              {t(`${K}.dialog.description`)}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className={DIALOG.BODY}>
          <p className={DIALOG.PARAGRAPH}>{t(`${K}.dialog.body`)}</p>
          <p className={DIALOG.PARAGRAPH}>{t(`${K}.dialog.thanks`)}</p>
        </div>

        <DonateLinks />
      </DialogContent>
    </Dialog>
  );
}

export default DonateDialog;
