"use client";

import * as React from "react";
import { AlertCircleIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { UpdateInfo } from "@/hooks/use-software-update";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { UpdateView } from "./derive";
import {
  AUTO_UPDATE_TIME,
  CARD_CELL,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_STACK,
  CARD_TITLE,
  FOCUS_RING_ON_CONTAINER,
  GROUP_FILL,
  NOTICE,
  ROW,
  ROW_GROUP,
  SKELETON,
  SWITCH_TARGET,
} from "./shapes";

const K = "software_update.preferences";

export interface UpdatePreferencesCardProps {
  /** `derive.ts` owns what state the surface is in; the payload's shape does not. */
  view: UpdateView;
  info: UpdateInfo | null;
  /** `isUpdating || isDownloading` — a run in flight owns the preferences. */
  busy: boolean;
  togglePrerelease: (enabled: boolean) => Promise<string | null>;
  saveAutoUpdate: (enabled: boolean, time: string) => Promise<string | null>;
}

/** The two rows, and what a save that failed was trying to change. */
type PrefRow = "auto" | "prerelease";

type PendingRow = PrefRow | null;

/** `detail` is the device's own words; `null` means it failed without saying. */
interface SaveFailure {
  row: PrefRow;
  detail: string | null;
}

function RowSkeleton(): React.JSX.Element {
  return (
    <div className={ROW.ROOT}>
      <div className={ROW.TEXT}>
        <Skeleton className={SKELETON.ROW.LABEL} />
        <Skeleton className={SKELETON.ROW.CONSEQUENCE} />
        <Skeleton className={SKELETON.ROW.CONSEQUENCE_2} />
      </div>
      <div className={ROW.CONTROL}>
        <Skeleton className={SKELETON.ROW.SWITCH} />
      </div>
    </div>
  );
}

export function UpdatePreferencesCard({
  view,
  info,
  busy,
  togglePrerelease,
  saveAutoUpdate,
}: UpdatePreferencesCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const [pending, setPending] = React.useState<PendingRow>(null);
  const [saveError, setSaveError] = React.useState<SaveFailure | null>(null);

  const autoLabelId = React.useId();
  const prereleaseLabelId = React.useId();

  // `""` is a failure the device gave no words for, so the test is against
  // `null` and never against truthiness — the sentence is this card's anyway.
  const settle = (row: PrefRow, failure: string | null, enabled: boolean) => {
    if (failure !== null) {
      setSaveError({ row, detail: failure || null });
      toast.error(t("software_update.toast.save_failed"));
      return;
    }
    setSaveError(null);
    toast.success(
      t(`software_update.toast.${row}_${enabled ? "on" : "off"}`),
    );
  };

  const handleAuto = async (enabled: boolean) => {
    setPending("auto");
    const failure = await saveAutoUpdate(enabled, AUTO_UPDATE_TIME);
    setPending(null);
    settle("auto", failure, enabled);
  };

  const handlePrerelease = async (enabled: boolean) => {
    setPending("prerelease");
    const failure = await togglePrerelease(enabled);
    setPending(null);
    settle("prerelease", failure, enabled);
  };

  const locked = busy || pending !== null;

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
          <div className={cn(ROW_GROUP, GROUP_FILL)}>
            {/* The view decides; the `info` test that follows is type narrowing. */}
            {view !== "loading" && info ? (
              <>
                <div className={ROW.ROOT}>
                  <div className={ROW.TEXT}>
                    <span id={autoLabelId} className={ROW.LABEL}>
                      {t(`${K}.auto.label`)}
                    </span>
                    <span className={ROW.CONSEQUENCE}>
                      {t(`${K}.auto.description`)}
                    </span>
                  </div>
                  <div className={ROW.CONTROL}>
                    <Switch
                      id="qm-update-auto"
                      className={cn(SWITCH_TARGET, FOCUS_RING_ON_CONTAINER)}
                      checked={info.auto_update_enabled === true}
                      onCheckedChange={handleAuto}
                      disabled={locked}
                      aria-labelledby={autoLabelId}
                    />
                  </div>
                </div>

                <div className={ROW.ROOT}>
                  <div className={ROW.TEXT}>
                    <span id={prereleaseLabelId} className={ROW.LABEL}>
                      {t(`${K}.prerelease.label`)}
                    </span>
                    <span className={ROW.CONSEQUENCE}>
                      {t(`${K}.prerelease.description`)}
                    </span>
                  </div>
                  <div className={ROW.CONTROL}>
                    <Switch
                      id="qm-update-prerelease"
                      className={cn(SWITCH_TARGET, FOCUS_RING_ON_CONTAINER)}
                      checked={info.include_prerelease === true}
                      onCheckedChange={handlePrerelease}
                      disabled={locked}
                      aria-labelledby={prereleaseLabelId}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <RowSkeleton />
                <RowSkeleton />
              </>
            )}
          </div>

          {saveError && (
            <div role="alert" className={cn(NOTICE.BOX, NOTICE.DESTRUCTIVE)}>
              <AlertCircleIcon className={NOTICE.GLYPH} aria-hidden="true" />
              <div className={NOTICE.STACK}>
                <p className={NOTICE.TEXT}>{t(`${K}.${saveError.row}.error`)}</p>
                {saveError.detail && (
                  <p className={NOTICE.DETAIL}>{saveError.detail}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default UpdatePreferencesCard;
