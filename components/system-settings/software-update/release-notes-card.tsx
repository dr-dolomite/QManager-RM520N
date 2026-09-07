"use client";

import * as React from "react";
import { FileTextIcon } from "lucide-react";
import { motion } from "motion/react";
import Markdown from "react-markdown";
import { useTranslation } from "react-i18next";

import { ConditionBlock } from "@/components/system-settings/condition-block";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag } from "@/components/ui/tag";
import type { UpdateInfo } from "@/hooks/use-software-update";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { UpdateView } from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_STACK,
  CARD_TITLE,
  CONDITION_PANEL,
  DIALOG_MOTION,
  DIALOG_PANEL,
  NOTES,
  PILL_ACTION,
  VALUE_MONO,
} from "./shapes";

const K = "software_update.notes";

/**
 * Whether the surface is talking about a NEXT release or the installed one.
 * A `Record` rather than a set, so a new view fails the build instead of
 * silently falling through to the current changelog.
 */
const SHOWS_NEXT: Record<UpdateView, boolean> = {
  loading: false,
  unreachable: false,
  check_failed: false,
  up_to_date: false,
  available: true,
  downloading: true,
  verifying: true,
  staged: true,
  installing: true,
  rebooting: true,
};

export interface ReleaseNotesCardProps {
  view: UpdateView;
  info: UpdateInfo | null;
}

export function ReleaseNotesCard({
  view,
  info,
}: ReleaseNotesCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const next = SHOWS_NEXT[view];
  const version = next
    ? (info?.latest_version ?? info?.current_version ?? null)
    : (info?.current_version ?? null);
  const changelog =
    (next ? info?.changelog : info?.current_changelog)?.trim() || null;

  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.description`, { version })}
          </CardDescription>
          {version && (
            <CardAction>
              <Tag variant="neutral" className={VALUE_MONO}>
                {version}
              </Tag>
            </CardAction>
          )}
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          {changelog ? (
            <>
              <div
                role="region"
                aria-label={t(`${K}.region_label`)}
                tabIndex={0}
                className={cn(NOTES.PANEL, NOTES.PROSE)}
              >
                <Markdown>{changelog}</Markdown>
              </div>
              <div className={NOTES.FOOTER}>
                <Button
                  variant="outline"
                  className={PILL_ACTION}
                  onClick={() => setDialogOpen(true)}
                >
                  {t("software_update.actions.read_full_notes")}
                </Button>
              </div>
            </>
          ) : (
            <ConditionBlock
              tone="neutral"
              glyph={FileTextIcon}
              ariaRole="status"
              title={t(`${K}.empty_title`)}
              description={t(`${K}.empty_description`)}
              className={CONDITION_PANEL.SCREEN}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={DIALOG_MOTION} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t(`${K}.dialog_title`, { version })}</DialogTitle>
          </DialogHeader>
          <div
            role="region"
            aria-label={t(`${K}.region_label`)}
            tabIndex={0}
            className={cn(DIALOG_PANEL, NOTES.PROSE)}
          >
            <Markdown>{changelog ?? ""}</Markdown>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default ReleaseNotesCard;
