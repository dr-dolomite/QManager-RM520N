"use client";

import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRightIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import type { UpdateInfo } from "@/hooks/use-software-update";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { channelKey, type FailureDetail, type UpdateView } from "./derive";
import {
  ANCHOR_CHIP,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL_HERO,
  CARD_STACK,
  CARD_TITLE,
  CHIP_GLYPH,
  DELTA,
  FAILURE_CHIP,
  NOTICE,
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
  "rest" | "staged" | "running" | "failed" | null
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
  packageSize: string | null;
  packageStaged: boolean;
}

/**
 * The anchor: what is installed against what is offered, the four steps an
 * install takes, and the consequence of running them. Title, description and
 * chip all resolve from the one view, or from the failure kind when the view is
 * a failure, so they cannot disagree.
 */
export function UpdateCard({
  view,
  info,
  failure,
  packageSize,
  packageStaged,
}: UpdateCardProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  // One lookup for the whole header. A failing view names its own failure, so
  // the copy slug and the chip both key off the kind rather than the view.
  const failureKind = view === "check_failed" ? (failure?.kind ?? "check") : null;
  const copyKey = failureKind ? `${failureKind}_failed` : view;
  const chip: { variant: BadgeVariant; glyph: LucideIcon; spin?: boolean } =
    failureKind ? FAILURE_CHIP[failureKind] : ANCHOR_CHIP[view];
  const ChipGlyph = chip.glyph;

  const installed = info?.current_version || VALUE_NONE;
  const next = SHOWS_NEXT[view] ? (info?.latest_version ?? null) : null;

  const notice = NOTICE_COPY[view];
  const failed = notice === "failed";
  const noticeKey = failed
    ? failure?.kind === "download"
      ? "notice.failed_download"
      : failure?.kind === "install"
        ? "notice.failed_install"
        : "notice.failed_check"
    : `notice.${notice}`;
  const NoticeGlyph = failed ? OctagonAlertIcon : TriangleAlertIcon;
  const detail = failed ? (failure?.message ?? "") : "";

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
          <CardAction>
            <Badge variant={chip.variant}>
              <ChipGlyph
                className={cn(CHIP_GLYPH, chip.spin && SPIN)}
                aria-hidden="true"
              />
              {t(`${K}.card.chip.${copyKey}`)}
            </Badge>
          </CardAction>
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

            <div className={DELTA.META}>
              {next && packageSize && (
                <Tag variant="neutral">{packageSize}</Tag>
              )}
              <Tag variant="neutral">
                {t(`${K}.delta.channel_${channelKey(info)}`)}
              </Tag>
            </div>
          </div>

          <StepLadder view={view} packageStaged={packageStaged} />

          {notice && (
            <div
              className={cn(
                NOTICE.BOX,
                failed ? NOTICE.DESTRUCTIVE : NOTICE.WARNING,
              )}
              role={failed ? "alert" : "status"}
            >
              <NoticeGlyph className={NOTICE.GLYPH} aria-hidden="true" />
              <div className={NOTICE.STACK}>
                <p className={NOTICE.TEXT}>{t(`${K}.${noticeKey}`)}</p>
                {detail && <p className={NOTICE.DETAIL}>{detail}</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default UpdateCard;
