"use client";

import type * as React from "react";
import { RefreshCcwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { PAGE_HEAD, PILL_ACTION, PILL_GLYPH, SKELETON, SPIN } from "./shapes";

const K = "languages";

export interface PageHeaderProps {
  isLoading: boolean;
  isRefetching: boolean;
  onRefresh: () => void;
}

/**
 * The page's title and its one action. Refresh is the surface's reconciliation
 * affordance — it is what makes a pack published a minute ago appear.
 */
export function PageHeader({
  isLoading,
  isRefetching,
  onRefresh,
}: PageHeaderProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  return (
    <motion.header variants={staggerItem} className={PAGE_HEAD.ROOT}>
      <div className={PAGE_HEAD.TITLES}>
        <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page.title`)}</h1>
        <p className={PAGE_HEAD.DESC}>{t(`${K}.page.description`)}</p>
      </div>

      <div className={PAGE_HEAD.ACTIONS}>
        {isLoading ? (
          <Skeleton className={SKELETON.ACTION} />
        ) : (
          <Button
            type="button"
            variant="outline"
            className={PILL_ACTION}
            onClick={onRefresh}
            disabled={isLoading || isRefetching}
            aria-label={t(`${K}.actions.refresh_aria`)}
          >
            <RefreshCcwIcon
              className={cn(PILL_GLYPH, isRefetching && SPIN)}
              aria-hidden="true"
            />
            {isRefetching
              ? t(`${K}.actions.refreshing`)
              : t(`${K}.actions.refresh`)}
          </Button>
        )}
      </div>
    </motion.header>
  );
}

export default PageHeader;
