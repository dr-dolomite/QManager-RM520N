"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
import { SaveButton } from "@/components/ui/save-button";
import { cn } from "@/lib/utils";
import { BackButton, ViewBody, ViewHeader } from "./card-view";
import type { EngineMode } from "./engine-card";
import { HandshakeStrip } from "./handshake-strip";
import { HostnamesMenu, HostnamesView, useHostlistDraft, type Hostlist } from "./hostnames-view";
import { DrillRow, MetricRow } from "./metric-row";
import { CARD_BODY, CARD_PAD, CARD_SHELL, HIGHLIGHT, ROWS } from "./shapes";

/** The DOM id a `?mode=` deep link scrolls to. */
export const modeCardId = (mode: EngineMode) => `traffic-engine-${mode}`;

/** What every mode card knows about the engine. */
export interface EngineState {
  /** This mode owns the engine, it runs, and nothing is in flight. */
  active: boolean;
  /** This mode's config owns the engine. */
  owner: boolean;
  /** The other mode owns the engine. */
  otherOwns: boolean;
  /** An engine change is in flight. */
  busy: boolean;
  highlighted: boolean;
}

/** The ownership line both feet show at rest, so the pair reads alike. */
function useOwnershipStatus(mode: EngineMode, engine: EngineState): string {
  const { t } = useTranslation("local-network");
  const self = t(mode === "video" ? "traffic_engine.mode_video" : "traffic_engine.mode_full_bypass");
  const other = t(mode === "video" ? "traffic_engine.mode_full_bypass" : "traffic_engine.mode_video");
  if (engine.owner) return t("traffic_engine.foot_owner", { mode: self });
  if (engine.otherOwns) return t("traffic_engine.foot_other_owns", { mode: other });
  return t("traffic_engine.foot_idle", { mode: self });
}

// -----------------------------------------------------------------------------
// Video Optimizer
// -----------------------------------------------------------------------------

interface VideoOptimizerCardProps extends EngineState {
  hostlist: Hostlist;
}

export function VideoOptimizerCard({ hostlist, ...engine }: VideoOptimizerCardProps) {
  const { t } = useTranslation("local-network");
  const [view, setView] = useState<"main" | "hosts">("main");
  const [direction, setDirection] = useState<1 | -1>(1);
  const draft = useHostlistDraft(hostlist);
  const ownership = useOwnershipStatus("video", engine);
  const isHosts = view === "hosts";
  const modeLabel = t("traffic_engine.mode_video");

  const open = (next: "main" | "hosts") => {
    setDirection(next === "hosts" ? 1 : -1);
    setView(next);
  };

  const actsOn = hostlist.isLoading || (hostlist.error && hostlist.domains.length === 0)
    ? t("traffic_engine.stat_empty")
    : t("traffic_engine.acts_on_domains", { count: hostlist.domains.length });

  // A clean draft shows who owns the engine; a dirty one names when the edit takes effect.
  let status: ReactNode = ownership;
  if (draft.dirty && draft.invalid) status = t("traffic_engine.foot_hosts_empty");
  else if (draft.dirty) {
    status = engine.owner
      ? t("traffic_engine.foot_hosts_live")
      : engine.otherOwns
        ? t("traffic_engine.foot_switch_to_apply", { mode: modeLabel })
        : t("traffic_engine.foot_on_enable", { mode: modeLabel });
  }

  return (
    <Card id={modeCardId("video")} className={cn(CARD_SHELL, engine.highlighted && HIGHLIGHT)}>
      <ViewHeader
        viewKey={view}
        padClassName={CARD_PAD}
        title={isHosts ? t("traffic_engine.hosts_title") : modeLabel}
        description={isHosts ? t("traffic_engine.hosts_desc") : t("traffic_engine.video_tagline")}
        action={
          isHosts ? (
            <>
              {engine.otherOwns ? (
                <Badge variant="info">
                  <InfoIcon className="size-3" aria-hidden="true" />
                  {t("traffic_engine.hosts_not_used")}
                </Badge>
              ) : null}
              <HostnamesMenu draft={draft} />
              <BackButton onBack={() => open("main")} />
            </>
          ) : undefined
        }
      />

      {isHosts ? (
        <ViewBody viewKey="hosts" direction={direction} className={cn(CARD_PAD, CARD_BODY)}>
          <HostnamesView hostlist={hostlist} draft={draft} />
        </ViewBody>
      ) : (
        <ViewBody viewKey="main" direction={direction} className={CARD_PAD}>
          <div className={CARD_BODY}>
            <HandshakeStrip
              mode="video"
              active={engine.active}
              hint={
                <HintIcon label={t("traffic_engine.aria_video_how")}>
                  {t("traffic_engine.video_how")}
                </HintIcon>
              }
            />
            <div className={ROWS}>
              <MetricRow
                label={t("traffic_engine.metric_carrier_reads")}
                value={t("traffic_engine.carrier_reads_none")}
                quiet={!engine.active}
              />
              <DrillRow
                label={t("traffic_engine.metric_acts_on")}
                ariaLabel={t("traffic_engine.aria_edit_hostnames")}
                value={actsOn}
                quiet={!engine.active}
                onOpen={() => open("hosts")}
              />
            </div>
          </div>
          <CardFoot
            status={status}
            actions={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={draft.discard}
                  disabled={!draft.dirty || hostlist.isSaving}
                >
                  {t("traffic_engine.discard")}
                </Button>
                <SaveButton
                  type="button"
                  isSaving={hostlist.isSaving}
                  saved={draft.saved}
                  disabled={!draft.dirty || draft.invalid || hostlist.isRestoring}
                  onClick={() => void draft.save()}
                  label={t("actions.apply", { ns: "common" })}
                  savingLabel={t("traffic_engine.applying")}
                />
              </>
            }
          />
        </ViewBody>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Full Bypass
// -----------------------------------------------------------------------------

/** No setting of its own (tpws has no SNI to choose), so no draft: the foot states ownership. */
export function FullBypassCard(engine: EngineState) {
  const { t } = useTranslation("local-network");
  const ownership = useOwnershipStatus("full_bypass", engine);

  return (
    <Card
      id={modeCardId("full_bypass")}
      className={cn(CARD_SHELL, engine.highlighted && HIGHLIGHT)}
    >
      <ViewHeader
        viewKey="main"
        padClassName={CARD_PAD}
        title={t("traffic_engine.mode_full_bypass")}
        description={t("traffic_engine.full_bypass_tagline")}
      />
      <ViewBody viewKey="main" direction={-1} className={CARD_PAD}>
        <div className={CARD_BODY}>
          <HandshakeStrip
            mode="full_bypass"
            active={engine.active}
            hint={
              <HintIcon label={t("traffic_engine.aria_full_bypass_how")}>
                {t("traffic_engine.full_bypass_how")}
              </HintIcon>
            }
          />
          <div className={ROWS}>
            <MetricRow
              label={t("traffic_engine.metric_carrier_reads")}
              value={t("traffic_engine.carrier_reads_none")}
              quiet={!engine.active}
            />
            <MetricRow
              label={t("traffic_engine.metric_acts_on")}
              value={t("traffic_engine.acts_on_all")}
              quiet={!engine.active}
            />
          </div>
        </div>
        <CardFoot status={ownership} actions={null} />
      </ViewBody>
    </Card>
  );
}
