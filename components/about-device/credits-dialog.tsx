"use client";

import type * as React from "react";
import { ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag } from "@/components/ui/tag";

import { CREDITS, WIDE } from "./shapes";

const K = "aboutDevice.credits";

/**
 * Names, links and licences are identifiers, identical in every locale, so they
 * stay out of the catalogs; only the role line is translated.
 */
const CREDITED = [
  {
    id: "apn",
    name: "LineageOS",
    url: "https://github.com/LineageOS/android_vendor_apn",
    license: "Apache-2.0",
  },
  {
    id: "logos",
    name: "Hunter",
    url: "https://hunter.io",
    license: null,
  },
  {
    id: "icons",
    name: "Google",
    url: "https://www.google.com",
    license: null,
  },
] as const;

export interface CreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The outside services and open data QManager draws on, one link row each. */
export function CreditsDialog({
  open,
  onOpenChange,
}: CreditsDialogProps): React.JSX.Element {
  const { t } = useTranslation("common");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={CREDITS.ROOT}>
        <DialogHeader className={CREDITS.HEAD}>
          <DialogTitle className={CREDITS.TITLE}>{t(`${K}.title`)}</DialogTitle>
          <DialogDescription className={CREDITS.DESC}>
            {t(`${K}.description`)}
          </DialogDescription>
        </DialogHeader>

        <ul className={CREDITS.LIST}>
          {CREDITED.map((c) => (
            <li key={c.id}>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className={CREDITS.ROW}
              >
                <div className={CREDITS.TEXT}>
                  <span className={CREDITS.NAME}>{c.name}</span>
                  <span className={CREDITS.ROLE}>
                    {t(`${K}.roles.${c.id}`)}
                  </span>
                </div>
                {c.license && <Tag variant="neutral">{c.license}</Tag>}
                <ExternalLinkIcon
                  className={WIDE.EXT_GLYPH}
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default CreditsDialog;
