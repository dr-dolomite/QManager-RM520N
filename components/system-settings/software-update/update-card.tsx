"use client";

import type * as React from "react";
import {
  ArrowRightIcon,
  DownloadIcon,
  Loader2Icon,
  OctagonAlertIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UpdateInfo } from "@/hooks/use-software-update";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { type FailureDetail, type UpdateView } from "./derive";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL_HERO,
  CARD_STACK,
  CARD_TITLE,
  DELTA,
  NOTICE,
  PILL_GLYPH,
  SPIN,
  VALUE_NONE,
} from "./shapes";
import StepLadder from "./step-ladder";

const K = "software_update";

/**
 * Which sentence sits under the ladder, one entry per view so a new state
 * cannot reach the slot without a decision. `null` omits the notice: mid
 * download nothing has been replaced yet, so there is no consequence to warn
 * about.
 */
const NOTICE_COPY: Record<
  UpdateView,
  "rest" | "staged" | "running" | "failed" | "stalled" | null
> = {
  loading: null,
  unreachable: "failed",
  check_failed: "failed",
  up_to_date: "rest",
  available: "rest",
  downloading: null,
  verifying: null,
  staged: "staged",
  installing: "running",
  rebooting: "running",
};

/** Whether the strip has a second version to offer. */
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

export interface UpdateCardProps {
  view: UpdateView;
  info: UpdateInfo | null;
  failure: FailureDetail | null;
  packageStaged: boolean;
  onDownload: () => void;
  onInstall: () => void;
  /** Opens the confirm for the manual reboot offered by a stalled install. */
  onReboot: () => void;
}

/**
 * The anchor: what is installed against what is offered, the verb that acts on
 * that delta, the four steps an install takes, and the consequence of running
 * them. Title, description and verb all resolve from the one view, or from the
 * failure kind when the view is a failure, so they cannot disagree.
 */
export function UpdateCard({
  view,
  info,
  failure,
  packageStaged,
  onDownload,
  onInstall,
  onReboot,
}: UpdateCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  // A failing view names its own failure, so the copy slug keys off the kind
  // rather than the view.
  const failureKind = view === "check_failed" ? (failure?.kind ?? "check") : null;
  const copyKey = failureKind ? `${failureKind}_failed` : view;

  const installed = info?.current_version || VALUE_NONE;
  const next = SHOWS_NEXT[view] ? (info?.latest_version ?? null) : null;
  const version = info?.latest_version ?? VALUE_NONE;

  const stalled = view === "installing" && failure?.kind === "stalled";
  const notice = stalled ? "stalled" : NOTICE_COPY[view];
  const failed = notice === "failed";
  const noticeKey = stalled
    ? "notice.stalled"
    : failed
    ? failure?.kind === "download"
      ? "notice.failed_download"
      : failure?.kind === "install"
        ? "notice.failed_install"
        : "notice.failed_check"
    : `notice.${notice}`;
  const NoticeGlyph = failed ? OctagonAlertIcon : TriangleAlertIcon;
  const detail = failed ? (failure?.message ?? "") : "";

  // The page's one verb, sitting on the delta it acts on. A run in flight
  // returns null: the ladder is what reports a run, so there is nothing here
  // left to say.
  const renderAction = (): React.JSX.Element | null => {
    switch (view) {
      case "available":
        return (
          <Button size="action" onClick={onDownload}>
            <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
            {t(`${K}.actions.download`, { version })}
          </Button>
        );

      case "staged":
        return (
          <Button size="action" onClick={onInstall}>
            <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
            {t(`${K}.actions.install`, { version })}
          </Button>
        );

      case "downloading":
      case "verifying":
        return (
          <Button size="action" disabled>
            <Loader2Icon className={cn(PILL_GLYPH, SPIN)} aria-hidden="true" />
            {t(`${K}.actions.${view}`)}
          </Button>
        );

      // A retry offers back exactly what failed; a failed check has no delta
      // to act on, so its verb stays in the header.
      case "check_failed":
        if (failure?.kind === "download") {
          return (
            <Button
              variant="outline"
              size="action"
              onClick={onDownload}
            >
              <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.actions.retry_download`)}
            </Button>
          );
        }
        if (failure?.kind === "install") {
          return (
            <Button size="action" onClick={onInstall}>
              <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.actions.install`, { version })}
            </Button>
          );
        }
        return null;

      default:
        return null;
    }
  };

  const action = renderAction();

  return (
    <motion.div variants={staggerItem}>
      <Card className={CARD_SHELL_HERO}>
        <CardHeader className={CARD_PAD}>
          <CardTitle className={CARD_TITLE}>
            {t(`${K}.card.${copyKey}.title`)}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(`${K}.card.${copyKey}.description`)}
          </CardDescription>
        </CardHeader>

        <CardContent className={cn(CARD_PAD, CARD_STACK)}>
          <div className={DELTA.ROOT}>
            <div className={DELTA.SLOT}>
              <span className={DELTA.EYEBROW}>{t(`${K}.delta.installed`)}</span>
              <span className={DELTA.VALUE}>{installed}</span>
            </div>

            {next && (
              <>
                <ArrowRightIcon className={DELTA.ARROW} aria-hidden="true" />
                <div className={DELTA.SLOT}>
                  <span className={DELTA.EYEBROW}>
                    {t(`${K}.delta.available`)}
                  </span>
                  <span className={cn(DELTA.VALUE, DELTA.VALUE_NEXT)}>
                    {next}
                  </span>
                </div>
              </>
            )}

            {action && <div className={DELTA.META}>{action}</div>}
          </div>

          <StepLadder view={view} packageStaged={packageStaged} />

          {notice && (
            <div
              className={cn(
                NOTICE.BOX,
                failed ? NOTICE.DESTRUCTIVE : NOTICE.WARNING,
              )}
              role={failed || stalled ? "alert" : "status"}
            >
              <NoticeGlyph className={NOTICE.GLYPH} aria-hidden="true" />
              <div className={NOTICE.STACK}>
                <p className={NOTICE.TEXT}>{t(`${K}.${noticeKey}`)}</p>
                {detail && <p className={NOTICE.DETAIL}>{detail}</p>}
              </div>
            </div>
          )}

          {stalled && (
            <div className="flex justify-end">
              <Button size="action" onClick={onReboot}>
                <RotateCwIcon className={PILL_GLYPH} aria-hidden="true" />
                {t(`${K}.actions.reboot_now`)}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default UpdateCard;
