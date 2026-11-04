"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  GlobeIcon,
  PowerIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useSites } from "@/hooks/use-sites";
import { DUR, EASE_STANDARD, rowCascadeDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SiteEntry, SitesConfig, SitesRange, SitesResponse } from "@/types/sites";

import { ConditionBlock } from "./condition-block";
import { latencyTone, msText, siteAverage, type Cuts, type UnitLabels } from "./derive";
import { ManageSitesDialog, useIntervalLabel } from "./manage-sites-dialog";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  HEADER_ACTIONS,
  NOTICE,
  NOTICE_GLYPH,
  SITES,
  SITE_INK,
  TRANSITION_INK,
} from "./shapes";
import { SiteMark } from "./site-mark";

const SITES_RANGES: readonly SitesRange[] = ["now", "1h", "24h", "7d"];

const RANGE_LABEL_KEY = {
  now: "latencyMonitor.range.now",
  "1h": "latencyMonitor.range.h1",
  "24h": "latencyMonitor.range.h24",
  "7d": "latencyMonitor.range.d7",
} satisfies Record<SitesRange, string>;

/** The saved config as the CGI reports it: every configured site, gateway excluded. */
function configOf(data: SitesResponse): SitesConfig {
  return {
    enabled: data.enabled,
    interval_sec: data.interval_sec,
    sites: data.sites
      .filter((s) => s.kind === "site")
      .map(({ host, label }) => ({ host, label })),
  };
}

interface SiteCellProps {
  site: SiteEntry;
  index: number;
  cuts: Cuts;
  units: UnitLabels;
  checking: boolean;
  /** "now" data carries no series, so the figure is the live sample itself. */
  live: boolean;
  /** The probe link is down, so a failed site is expected and stays quiet. */
  linkDown: boolean;
}

function SiteCell({ site, index, cuts, units, checking, live, linkDown }: SiteCellProps) {
  const { t } = useTranslation("dashboard");
  const figure = live ? (site.latest?.ms ?? null) : siteAverage(site.series);

  let value: ReactNode;
  if (!site.latest) {
    value = <span className={SITES.QUIET}>{t("latencyMonitor.sites.not_checked")}</span>;
  } else if (!site.latest.ok && linkDown) {
    value = <span className={SITES.QUIET}>{t("latencyMonitor.unmeasured")}</span>;
  } else if (!site.latest.ok) {
    value = (
      <span className={SITE_INK.bad}>{t("latencyMonitor.now.no_reply")}</span>
    );
  } else if (figure === null) {
    value = <span className={SITES.QUIET}>{t("latencyMonitor.unmeasured")}</span>;
  } else {
    value = (
      <span className={SITE_INK[latencyTone(figure, cuts)]}>{msText(figure, units)}</span>
    );
  }

  return (
    <motion.div
      className={SITES.CELL}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DUR.standard,
        ease: EASE_STANDARD,
        delay: rowCascadeDelay(index),
      }}
    >
      <SiteMark host={site.host} label={site.label} size="cell" />
      <span className={cn(SITES.LABEL, SITES.LABEL_H)} title={site.host}>
        {site.label}
      </span>
      <span
        className={cn(
          SITES.VALUE,
          SITES.VALUE_H,
          TRANSITION_INK,
          checking && SITES.CHECKING,
        )}
      >
        {value}
      </span>
    </motion.div>
  );
}

function SitesSkeleton() {
  return (
    <div className={SITES.GRID} aria-hidden>
      {Array.from({ length: SITES.SKELETON_COUNT }).map((_, i) => (
        <div key={i} className={SITES.CELL}>
          <Skeleton className={SITES.TILE} />
          <Skeleton className={cn(SITES.LABEL_H, "w-[4.5rem] rounded-inline")} />
          <Skeleton className={cn(SITES.VALUE_H, "w-11 rounded-inline")} />
        </div>
      ))}
    </div>
  );
}

export interface SitesCardProps {
  cuts: Cuts;
  /** The probe target isn't answering: one note replaces a grid of red failures. */
  linkDown: boolean;
}

export function SitesCard({ cuts, linkDown }: SitesCardProps) {
  const { t } = useTranslation("dashboard");
  const intervalLabel = useIntervalLabel();
  const [range, setRange] = useState<SitesRange>("now");
  const { data, dataRange, isLoading, error, checkPending, refresh, checkNow, save } =
    useSites(range);

  const [turningOn, setTurningOn] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const units: UnitLabels = {
    ms: t("latencyMonitor.unit_ms"),
    s: t("latencyMonitor.unit_s"),
  };

  const off = data !== null && !data.enabled;
  const checking = (data?.checking ?? false) || checkPending;

  // A saved list is checked at once, so new sites show a value without waiting a sweep.
  const handleSave = async (config: SitesConfig) => {
    const result = await save(config);
    if (result.ok && config.enabled) {
      void checkNow().then((check) => {
        if (!check.ok) {
          toast.error(t("latencyMonitor.toast.check_failed"), {
            description: check.error ?? undefined,
          });
        }
      });
    }
    return result;
  };

  const handleTurnOn = async () => {
    if (!data) return;
    setTurningOn(true);
    const result = await save({ ...configOf(data), enabled: true });
    setTurningOn(false);
    if (result.ok) {
      toast.success(t("latencyMonitor.toast.turn_on_ok"));
    } else {
      toast.error(t("latencyMonitor.toast.turn_on_failed"), {
        description: result.error ?? undefined,
      });
    }
  };

  const openManage = () => {
    setFormKey((k) => k + 1);
    setManageOpen(true);
  };

  const sites = data?.sites ?? [];

  let body: ReactNode;
  if (!data && isLoading) {
    body = <SitesSkeleton />;
  } else if (!data) {
    body = (
      <ConditionBlock
        tone="destructive"
        icon={TriangleAlertIcon}
        title={t("latencyMonitor.sites.error_title")}
        description={t("latencyMonitor.sites.error_description")}
        actionLabel={t("latencyMonitor.retry")}
        onAction={refresh}
        actionIcon={RotateCwIcon}
      />
    );
  } else if (off) {
    body = (
      <ConditionBlock
        tone="muted"
        icon={PowerIcon}
        title={t("latencyMonitor.sites.off_title")}
        description={t("latencyMonitor.sites.off_description", {
          interval: intervalLabel(data.interval_sec),
        })}
        actionLabel={t("latencyMonitor.sites.turn_on")}
        onAction={handleTurnOn}
        actionIcon={PowerIcon}
        actionVariant="tonal"
        actionBusy={turningOn}
      />
    );
  } else if (sites.length === 0) {
    body = (
      <ConditionBlock
        tone="muted"
        icon={GlobeIcon}
        title={t("latencyMonitor.sites.empty_title")}
        description={t("latencyMonitor.sites.empty_description")}
        actionLabel={t("latencyMonitor.sites.manage")}
        onAction={openManage}
        actionIcon={SlidersHorizontalIcon}
      />
    );
  } else {
    body = (
      <>
        {linkDown ? (
          <div role="status">
            <Badge variant="info" className="max-w-full whitespace-normal">
              <WifiOffIcon className="size-3" />
              {t("latencyMonitor.sites.link_down")}
            </Badge>
          </div>
        ) : null}
        <div className={SITES.GRID} aria-busy={checking || undefined}>
          {sites.map((site, i) => (
            <SiteCell
              key={site.host}
              site={site}
              index={i}
              cuts={cuts}
              units={units}
              checking={checking}
              live={dataRange === "now"}
              linkDown={linkDown}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t("latencyMonitor.sites.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("latencyMonitor.sites.description")}
        </CardDescription>
        <CardAction className={HEADER_ACTIONS}>
          {off ? null : (
            <SegmentedField
              value={range}
              onValueChange={setRange}
              options={SITES_RANGES.map((r) => ({
                value: r,
                label: t(RANGE_LABEL_KEY[r]),
                numeric: true,
              }))}
              ariaLabel={t("latencyMonitor.sites.range_aria")}
              breakpoint="never"
              glyph={() => null}
            />
          )}
          <Button type="button" variant="ghost" onClick={openManage} disabled={!data}>
            <SlidersHorizontalIcon aria-hidden />
            {t("latencyMonitor.sites.manage")}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-5")}>
        {error && data ? (
          <div role="alert" className={NOTICE}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            {t("latencyMonitor.notice_stale")}
          </div>
        ) : null}
        {body}
      </CardContent>

      <ManageSitesDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        formKey={formKey}
        seed={data ? configOf(data) : null}
        onSave={handleSave}
      />
    </Card>
  );
}
