"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CheckIcon,
  Loader2,
  MinusCircleIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import type { UseTtlSettingsReturn } from "@/hooks/use-ttl-settings";
import { cn } from "@/lib/utils";
import type { DpiEngineStatus } from "@/types/traffic-engine";
import { BypassHotspotRow } from "./bypass-hotspot-row";
import { BackButton, ViewBody, ViewHeader } from "./card-view";
import { DrillRow, MetricRow } from "./metric-row";
import { PacketChart } from "./packet-chart";
import {
  CONTROL_COL,
  ENGINE_GRID,
  ENGINE_ROWS,
  HERO_PAD,
  HERO_SHELL,
  LABEL,
  LIVE,
  METRIC,
  MODE_FIELD,
  MODE_SELECT,
  ROWS,
  ROWS_3,
} from "./shapes";

/** The two tpws modes, by their deep-link names (`?mode=`). */
export type EngineMode = "video" | "full_bypass";
export type EngineChoice = EngineMode | "off";

/** `start` idle to on, `stop` on to idle, `switch` one mode to the other. */
export type EngineTransition = "start" | "stop" | "switch";

const TRANSITION_KEY: Record<EngineTransition, string> = {
  start: "traffic_engine.state_starting",
  stop: "traffic_engine.state_stopping",
  switch: "traffic_engine.state_switching",
};

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** The steady-state chip: a filled status Badge with its glyph. */
function StatusChip({ status }: { status: DpiEngineStatus }) {
  const { t } = useTranslation("local-network");
  const label = t(`traffic_engine.status_${status}`);
  if (status === "running") {
    return (
      <Badge variant="success">
        <CheckCircle2Icon className="size-3" aria-hidden="true" />
        {label}
      </Badge>
    );
  }
  if (status === "restarting") {
    return (
      <Badge variant="info">
        <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
        {label}
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive">
        <XCircleIcon className="size-3" aria-hidden="true" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="muted">
      <MinusCircleIcon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

interface EngineCardProps {
  /** The mode the control shows: the target while a change is in flight. */
  shownMode: EngineChoice;
  /** The mode whose config owns the engine, or null when it is off. */
  activeMode: EngineMode | null;
  transition: EngineTransition | null;
  status: DpiEngineStatus;
  /** The REDIRECT rule is in place (the wire's `kernel_module_loaded`). */
  ruleOk: boolean;
  onModeChange: (next: EngineChoice) => void;
  uptime: string;
  packets: number;
  history: readonly (number | null)[];
  ttl: UseTtlSettingsReturn;
  isUninstalling: boolean;
  /** The removal worker's current step, while it runs. */
  uninstallStep: string | null;
  onUninstall: () => void;
}

/**
 * The anchor: live view (mode, bypass, stats, chart) or package view, which keeps
 * Remove away from the live stats.
 */
export function EngineCard({
  shownMode,
  activeMode,
  transition,
  status,
  ruleOk,
  onModeChange,
  uptime,
  packets,
  history,
  ttl,
  isUninstalling,
  uninstallStep,
  onUninstall,
}: EngineCardProps) {
  const { t } = useTranslation("local-network");
  const [view, setView] = useState<"live" | "package">("live");
  const [direction, setDirection] = useState<1 | -1>(1);
  const isPackage = view === "package";
  const running = activeMode !== null && status === "running" && transition === null;
  const engaged = activeMode !== null || transition !== null;
  const dash = t("traffic_engine.stat_empty");

  const open = (next: "live" | "package") => {
    setDirection(next === "package" ? 1 : -1);
    setView(next);
  };

  const chip: ReactNode = transition ? (
    <Badge variant="info">
      <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
      {t(TRANSITION_KEY[transition])}
    </Badge>
  ) : (
    <StatusChip status={activeMode ? status : "stopped"} />
  );

  const last = history[history.length - 1];
  const rate = running && last !== null && last !== undefined ? last.toLocaleString() : dash;

  const okGlyph = <CheckCircle2Icon className={METRIC.GLYPH} aria-hidden="true" />;
  const ruleMissing = running && !ruleOk;
  const ruleValue = ruleOk ? (
    t("traffic_engine.pkg_rule_active")
  ) : ruleMissing ? (
    <Badge variant="destructive">
      <XCircleIcon className="size-3" aria-hidden="true" />
      {t("traffic_engine.pkg_rule_missing")}
    </Badge>
  ) : (
    t("traffic_engine.pkg_rule_off")
  );

  return (
    <Card id="traffic-engine-engine" className={HERO_SHELL}>
      <ViewHeader
        viewKey={view}
        padClassName={HERO_PAD}
        title={isPackage ? t("traffic_engine.package_title") : t("traffic_engine.engine_title")}
        description={isPackage ? t("traffic_engine.package_desc") : t("traffic_engine.engine_desc")}
        action={
          <>
            <span aria-live="polite">{chip}</span>
            {isPackage ? <BackButton onBack={() => open("live")} /> : null}
          </>
        }
      />

      {isPackage ? (
        <ViewBody viewKey="package" direction={direction} className={HERO_PAD}>
          <div className={ROWS_3}>
            <MetricRow
              label={t("traffic_engine.pkg_rule")}
              value={ruleValue}
              glyph={ruleOk ? okGlyph : undefined}
              quiet={!ruleMissing}
            />
            <MetricRow
              label={t("traffic_engine.pkg_engine")}
              value={t("traffic_engine.pkg_installed")}
              glyph={okGlyph}
              quiet
            />
            <MetricRow
              label={t("traffic_engine.pkg_source")}
              value={t("traffic_engine.pkg_source_value")}
              quiet
            />
          </div>
          <CardFoot
            status={
              isUninstalling && uninstallStep
                ? uninstallStep
                : engaged
                  ? t("traffic_engine.pkg_status_busy")
                  : t("traffic_engine.pkg_status_idle")
            }
            actions={
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isUninstalling || transition !== null}>
                    {isUninstalling ? (
                      <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2Icon aria-hidden="true" />
                    )}
                    {isUninstalling
                      ? t("traffic_engine.advanced_removing")
                      : t("traffic_engine.advanced_remove_button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("traffic_engine.advanced_dialog_title")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("traffic_engine.advanced_dialog_desc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={onUninstall}
                    >
                      {t("traffic_engine.advanced_dialog_confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            }
          />
        </ViewBody>
      ) : (
        <ViewBody viewKey="live" direction={direction} className={HERO_PAD}>
          <CardContent className={cn("px-0", ENGINE_GRID)}>
            <div className={CONTROL_COL}>
              <span className={LABEL}>{t("traffic_engine.label_mode")}</span>
              <SegmentedField<EngineChoice>
                value={shownMode}
                onValueChange={onModeChange}
                ariaLabel={t("traffic_engine.aria_mode_selector")}
                disabled={transition !== null || isUninstalling}
                breakpoint="sm"
                glyph={renderCheckGlyph}
                className={MODE_FIELD}
                selectTriggerClassName={MODE_SELECT}
                options={[
                  { value: "off", label: t("traffic_engine.mode_off") },
                  { value: "video", label: t("traffic_engine.mode_video") },
                  { value: "full_bypass", label: t("traffic_engine.mode_full_bypass") },
                ]}
              />
              <BypassHotspotRow ttl={ttl} />
              <div className={cn(ROWS, ENGINE_ROWS)}>
                <MetricRow
                  label={t("traffic_engine.tile_uptime")}
                  value={running ? uptime : dash}
                  quiet={!running}
                />
                <MetricRow
                  label={t("traffic_engine.metric_packets")}
                  value={running ? packets.toLocaleString() : dash}
                  quiet={!running}
                />
                <DrillRow
                  label={t("traffic_engine.metric_package")}
                  ariaLabel={t("traffic_engine.aria_open_package")}
                  onOpen={() => open("package")}
                  quiet={!ruleMissing}
                  value={
                    ruleMissing ? (
                      <Badge variant="destructive">
                        <XCircleIcon className="size-3" aria-hidden="true" />
                        {t("traffic_engine.pkg_rule_missing")}
                      </Badge>
                    ) : (
                      t("traffic_engine.pkg_installed")
                    )
                  }
                />
              </div>
            </div>

            <div className={LIVE.ROOT}>
              <div className={LIVE.HEAD}>
                <span className={LIVE.LEGEND}>
                  <span className={LIVE.LEGEND_DOT} aria-hidden="true" />
                  {t("traffic_engine.live_legend")}
                </span>
                <span className={LIVE.NUMERAL}>
                  <span className={cn(LIVE.RATE, running ? LIVE.RATE_ON : LIVE.RATE_OFF)}>{rate}</span>
                  <span className={LIVE.UNIT}>{t("traffic_engine.hero_rate_unit")}</span>
                </span>
              </div>
              <PacketChart history={history} live={running} />
            </div>
          </CardContent>
        </ViewBody>
      )}
    </Card>
  );
}
