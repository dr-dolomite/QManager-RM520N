"use client";

import * as React from "react";
import {
  CheckCircle2Icon,
  DownloadIcon,
  MinusCircleIcon,
  PackageOpenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { ConditionBlock } from "@/components/system-settings/condition-block";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import type { UpdateInfo } from "@/hooks/use-software-update";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { UpdateView } from "./derive";
import {
  CARD_CELL,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_STACK,
  CARD_TITLE,
  CONDITION_PANEL,
  DIALOG_MOTION,
  FIELD,
  FIELD_ACTION,
  FIELD_ROW,
  GROUP_FILL,
  NOTICE,
  PILL_GLYPH,
  SELECT_ITEM,
  SKELETON,
} from "./shapes";

const K = "software_update.versions";

export interface VersionManagementCardProps {
  /** `derive.ts` owns what state the surface is in; the payload's shape does not. */
  view: UpdateView;
  info: UpdateInfo | null;
  /** `isUpdating || isDownloading` — a run in flight owns the whole card. */
  busy: boolean;
  packageSize: string | null;
  selectedVersion: string;
  onSelectVersion: (tag: string) => void;
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  onInstallVersion: (version: string) => Promise<void>;
}

export function VersionManagementCard({
  view,
  info,
  busy,
  packageSize,
  selectedVersion,
  onSelectVersion,
  dialogOpen,
  onDialogOpenChange,
  onInstallVersion,
}: VersionManagementCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  const versions = info?.available_versions ?? [];
  const isReinstall =
    selectedVersion !== "" && selectedVersion === info?.current_version;

  // The chosen build's own asset is the honest figure; the page-resolved size
  // (the latest release's) is only the fallback.
  const size =
    versions.find((v) => v.tag === selectedVersion)?.asset_size ?? packageSize;

  const dialogDescription = [
    t(
      isReinstall ? `${K}.dialog.description_reinstall` : `${K}.dialog.description_install`,
      { version: selectedVersion, current: info?.current_version ?? "" },
    ),
    size ? t(`${K}.dialog.size`, { size }) : null,
    t(`${K}.dialog.warning`),
  ]
    .filter(Boolean)
    .join(" ");

  // `onInstallVersion` never rejects: a failure lands in the hook's `errorKind`
  // and repaints the view.
  const handleConfirm = async () => {
    onDialogOpenChange(false);
    if (!selectedVersion) return;
    await onInstallVersion(selectedVersion);
  };

  return (
    <motion.div variants={staggerItem} className={CARD_CELL}>
      <Card className={CARD_SHELL}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>{t(`${K}.title`)}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          {/* The view decides; the `info` test that follows is type narrowing. */}
          {view === "loading" || !info ? (
            <div className={FIELD_ROW}>
              <Skeleton className={SKELETON.FIELD} />
              <Skeleton className={SKELETON.FIELD_ACTION} />
            </div>
          ) : versions.length === 0 ? (
            <ConditionBlock
              tone="neutral"
              glyph={PackageOpenIcon}
              ariaRole="status"
              title={t(`${K}.empty_title`)}
              description={t(`${K}.empty_description`)}
              className={cn(CONDITION_PANEL.SCREEN, GROUP_FILL)}
            />
          ) : (
            <div className={FIELD_ROW}>
              <Select
                value={selectedVersion}
                onValueChange={onSelectVersion}
                disabled={busy}
              >
                <SelectTrigger
                  className={FIELD}
                  aria-label={t(`${K}.select_label`)}
                >
                  <SelectValue placeholder={t(`${K}.select_placeholder`)}>
                    <span className={SELECT_ITEM.LABEL}>{selectedVersion}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem
                      key={v.tag}
                      value={v.tag}
                      disabled={!v.has_assets}
                      className={SELECT_ITEM.HOST}
                    >
                      <span className={SELECT_ITEM.ROOT}>
                        <Tag variant="neutral" className={SELECT_ITEM.LABEL}>
                          {v.tag}
                        </Tag>
                        <span className={SELECT_ITEM.META}>
                          {v.is_current && (
                            <Badge variant="info">
                              <CheckCircle2Icon
                                className={SELECT_ITEM.CHIP_GLYPH}
                                aria-hidden="true"
                              />
                              {t(`${K}.current`)}
                            </Badge>
                          )}
                          {!v.has_assets && (
                            <Badge variant="muted">
                              <MinusCircleIcon
                                className={SELECT_ITEM.CHIP_GLYPH}
                                aria-hidden="true"
                              />
                              {t(`${K}.no_binary`)}
                            </Badge>
                          )}
                          {v.has_assets && v.asset_size && (
                            <Tag variant="neutral">{v.asset_size}</Tag>
                          )}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                className={FIELD_ACTION}
                onClick={() => onDialogOpenChange(true)}
                disabled={!selectedVersion || busy}
              >
                <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
                {t(`${K}.install`)}
              </Button>
            </div>
          )}

          <div className={cn(NOTICE.BOX, NOTICE.WARNING)}>
            <TriangleAlertIcon className={NOTICE.GLYPH} aria-hidden="true" />
            <p className={NOTICE.TEXT}>{t("software_update.notice.versions")}</p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
        <AlertDialogContent className={DIALOG_MOTION}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                isReinstall ? `${K}.dialog.title_reinstall` : `${K}.dialog.title_install`,
                { version: selectedVersion },
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.dialog.cancel`)}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(
                isReinstall
                  ? `${K}.dialog.confirm_reinstall`
                  : `${K}.dialog.confirm_install`,
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

export default VersionManagementCard;
