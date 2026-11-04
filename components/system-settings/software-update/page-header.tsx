"use client";

import type * as React from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { FailureDetail, UpdateView } from "./derive";
import { PAGE_HEAD, PILL_GLYPH, SKELETON, SPIN } from "./shapes";

const K = "software_update";

export interface PageHeaderProps {
  view: UpdateView;
  /** Which operation failed. A re-check is only the honest verb for a check. */
  failure: FailureDetail | null;
  isChecking: boolean;
  onCheck: () => void;
}

/**
 * The page's one title and the check verb. Every verb that acts on the delta —
 * download, install, retry — sits on the delta strip inside the anchor card, so
 * this slot only ever asks GitHub what is out there.
 */
export function PageHeader({
  view,
  failure,
  isChecking,
  onCheck,
}: PageHeaderProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  const failed = view === "check_failed" || view === "unreachable";
  const running = view === "installing" || view === "rebooting";

  // A re-check discards the work that failed, so a failed download or install
  // is offered its own verb in the card instead. A run in flight is offered
  // nothing at all.
  const runFailed =
    failed && (failure?.kind === "download" || failure?.kind === "install");
  const offersCheck = !running && !runFailed;

  const label = failed
    ? t(`${K}.actions.try_again`)
    : view === "available" || view === "staged" || view === "downloading" ||
        view === "verifying"
      ? t(`${K}.actions.check_again`)
      : t(`${K}.actions.check`);

  return (
    <motion.header variants={staggerItem} className={PAGE_HEAD.ROOT}>
      <div className={PAGE_HEAD.TITLES}>
        <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
        <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
      </div>

      <div className={PAGE_HEAD.ACTIONS}>
        {view === "loading" ? (
          <Skeleton className={SKELETON.ACTION} />
        ) : (
          offersCheck && (
            <Button
              size="action"
              onClick={onCheck}
              disabled={isChecking}
            >
              {isChecking ? (
                <>
                  <Loader2Icon
                    className={cn(PILL_GLYPH, SPIN)}
                    aria-hidden="true"
                  />
                  {t(`${K}.actions.checking`)}
                </>
              ) : (
                <>
                  <RefreshCwIcon className={PILL_GLYPH} aria-hidden="true" />
                  {label}
                </>
              )}
            </Button>
          )
        )}
      </div>
    </motion.header>
  );
}

export default PageHeader;
