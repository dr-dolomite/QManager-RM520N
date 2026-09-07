"use client";

import type * as React from "react";
import { DownloadIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { FailureDetail, UpdateView } from "./derive";
import {
  ANCHOR_CHIP,
  CHIP_GLYPH,
  PAGE_HEAD,
  PILL_ACTION,
  PILL_GLYPH,
  SKELETON,
  SPIN,
  VALUE_NONE,
} from "./shapes";

const K = "software_update";

/** The check verb, which is the same control under three different labels. */
interface CheckActionProps {
  variant: "default" | "outline";
  label: string;
  isChecking: boolean;
  onCheck: () => void;
}

function CheckAction({
  variant,
  label,
  isChecking,
  onCheck,
}: CheckActionProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  return (
    <Button
      variant={variant}
      className={PILL_ACTION}
      onClick={onCheck}
      disabled={isChecking}
    >
      {isChecking ? (
        <>
          <Loader2Icon className={cn(PILL_GLYPH, SPIN)} aria-hidden="true" />
          {t(`${K}.actions.checking`)}
        </>
      ) : (
        <>
          <RefreshCwIcon className={PILL_GLYPH} aria-hidden="true" />
          {label}
        </>
      )}
    </Button>
  );
}

export interface PageHeaderProps {
  view: UpdateView;
  /** Which operation failed. A re-check is only the honest verb for a check. */
  failure: FailureDetail | null;
  latestVersion: string | null;
  isChecking: boolean;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

/**
 * The page's one title and its one verb. The action is resolved from the view
 * union in a single switch, so the label, the glyph and the handler cannot
 * disagree about what state the page is in.
 */
export function PageHeader({
  view,
  failure,
  latestVersion,
  isChecking,
  onCheck,
  onDownload,
  onInstall,
}: PageHeaderProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");
  const version = latestVersion ?? VALUE_NONE;

  const renderPrimary = (): React.JSX.Element => {
    switch (view) {
      case "loading":
        return <Skeleton className={SKELETON.ACTION} />;

      // A run in flight has no verb left to offer, so the slot reports rather
      // than acts. The glyph comes from `ANCHOR_CHIP` so the two states in this
      // one slot cannot share it — the `info` fill separates neither.
      case "installing":
      case "rebooting": {
        const chip = ANCHOR_CHIP[view];
        const ChipGlyph = chip.glyph;
        return (
          <Badge variant={chip.variant}>
            <ChipGlyph
              className={cn(CHIP_GLYPH, chip.spin && SPIN)}
              aria-hidden="true"
            />
            {t(`${K}.actions.${view}`)}
          </Badge>
        );
      }

      case "downloading":
        return (
          <Button className={PILL_ACTION} disabled>
            <Loader2Icon className={cn(PILL_GLYPH, SPIN)} aria-hidden="true" />
            {t(`${K}.actions.downloading`)}
          </Button>
        );

      case "verifying":
        return (
          <Button className={PILL_ACTION} disabled>
            <Loader2Icon className={cn(PILL_GLYPH, SPIN)} aria-hidden="true" />
            {t(`${K}.actions.verifying`)}
          </Button>
        );

      case "available":
        return (
          <Button className={PILL_ACTION} onClick={onDownload}>
            <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
            {t(`${K}.actions.download`, { version })}
          </Button>
        );

      case "staged":
        return (
          <Button className={PILL_ACTION} onClick={onInstall}>
            <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
            {t(`${K}.actions.install`, { version })}
          </Button>
        );

      // A re-check discards the work that failed, so it is only offered when
      // the check is what failed. A staged package is offered again instead.
      case "check_failed":
        if (failure?.kind === "download") {
          return (
            <Button variant="outline" className={PILL_ACTION} onClick={onDownload}>
              <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.actions.retry_download`)}
            </Button>
          );
        }
        if (failure?.kind === "install") {
          return (
            <Button className={PILL_ACTION} onClick={onInstall}>
              <DownloadIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.actions.install`, { version })}
            </Button>
          );
        }
        return (
          <CheckAction
            variant="outline"
            label={t(`${K}.actions.try_again`)}
            isChecking={isChecking}
            onCheck={onCheck}
          />
        );

      case "unreachable":
        return (
          <CheckAction
            variant="outline"
            label={t(`${K}.actions.try_again`)}
            isChecking={isChecking}
            onCheck={onCheck}
          />
        );

      default:
        return (
          <CheckAction
            variant="default"
            label={t(`${K}.actions.check`)}
            isChecking={isChecking}
            onCheck={onCheck}
          />
        );
    }
  };

  const knownUpdate = view === "available" || view === "staged";

  return (
    <motion.header variants={staggerItem} className={PAGE_HEAD.ROOT}>
      <div className={PAGE_HEAD.TITLES}>
        <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
        <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
      </div>

      <div className={PAGE_HEAD.ACTIONS}>
        {renderPrimary()}

        {knownUpdate && (
          <CheckAction
            variant="outline"
            label={t(`${K}.actions.check_again`)}
            isChecking={isChecking}
            onCheck={onCheck}
          />
        )}
      </div>
    </motion.header>
  );
}

export default PageHeader;
