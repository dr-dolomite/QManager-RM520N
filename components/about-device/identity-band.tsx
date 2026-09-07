"use client";

import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  CpuIcon,
  GlobeIcon,
  RefreshCwIcon,
  RouterIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AboutDeviceData } from "@/types/about-device";

import {
  ABOUT_ENDPOINT_LABEL,
  PUBLIC_IP_PROBE,
  identityFigures,
  internetTone,
  isInternetReachable,
  publicAddress,
} from "./derive";
import {
  BAND,
  CAPTION,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  NOTICE,
  PILL_ACTION,
  PILL_GLYPH,
  SKELETON,
  TILE,
  VALUE,
  VALUE_MONO,
  VALUE_NONE,
  type AboutView,
  type DiscTone,
} from "./shapes";

const K = "aboutDevice";

interface TileProps {
  glyph: LucideIcon;
  tone: DiscTone;
  eyebrow: string;
  value: string;
  caption: string;
  /** A firmware build id is a machine string; a model name is not. */
  mono?: boolean;
}

function Tile({
  glyph: Glyph,
  tone,
  eyebrow,
  value,
  caption,
  mono,
}: TileProps): React.JSX.Element {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <div className={cn(TILE.DISC, DISC_TONE[tone], DISC_TRANSITION)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </div>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={mono ? VALUE_MONO : VALUE} title={value || undefined}>
          {value || VALUE_NONE}
        </span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

export interface IdentityBandProps {
  view: AboutView;
  data: AboutDeviceData | null;
  /** The device's own words for why the read failed. */
  error: string | null;
  onRetry: () => void;
}

/**
 * The four answers to "what am I looking at", and the page's ONE failure
 * message. Only the internet disc changes tone — a colour that never changes
 * encodes nothing.
 */
export function IdentityBand({
  view,
  data,
  error,
  onRetry,
}: IdentityBandProps): React.JSX.Element {
  const { t } = useTranslation("common");
  const figures = data ? identityFigures(data) : null;

  return (
    <motion.section variants={staggerItem} className={BAND.ROOT}>
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.band.label`)}</span>
        {view === "unreachable" ? (
          <Badge variant="warning">
            <TriangleAlertIcon className={BAND.GLYPH} aria-hidden="true" />
            {t(`${K}.band.not_responding`)}
          </Badge>
        ) : null}
      </div>

      {view === "unreachable" ? (
        <div className={NOTICE.ROOT} role="status">
          <div className={cn(TILE.DISC, DISC_TONE.warning)}>
            <TriangleAlertIcon className={TILE.GLYPH} aria-hidden="true" />
          </div>
          <div className={NOTICE.TEXT}>
            <span className={NOTICE.TITLE}>
              {t(`${K}.band.unreachable.title`)}
            </span>
            <span className={NOTICE.SUB}>
              {withSlot(
                t(`${K}.band.unreachable.detail`, {
                  reason: error ?? t(`${K}.band.unreachable.no_reason`),
                  endpoint: SLOT,
                }),
                <span className={NOTICE.DETAIL}>{ABOUT_ENDPOINT_LABEL}</span>,
              )}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            className={PILL_ACTION}
            onClick={onRetry}
          >
            <RefreshCwIcon className={PILL_GLYPH} aria-hidden="true" />
            {t(`${K}.actions.retry`)}
          </Button>
        </div>
      ) : (
        <div className={TILE.GRID}>
          {view === "loaded" && data && figures ? (
            <>
              <Tile
                glyph={RouterIcon}
                tone="neutral"
                eyebrow={t(`${K}.tiles.model.eyebrow`)}
                value={figures.model}
                caption={figures.manufacturer || VALUE_NONE}
              />
              <Tile
                glyph={CpuIcon}
                tone="neutral"
                eyebrow={t(`${K}.tiles.firmware.eyebrow`)}
                value={figures.firmware}
                caption={t(`${K}.tiles.firmware.caption`, {
                  date: figures.buildDate || VALUE_NONE,
                })}
                mono
              />
              <Tile
                glyph={TerminalIcon}
                tone="neutral"
                eyebrow={t(`${K}.tiles.host.eyebrow`)}
                value={figures.hostname}
                caption={t(`${K}.tiles.host.caption`, {
                  kernel: figures.kernel || VALUE_NONE,
                })}
              />
              <Tile
                glyph={GlobeIcon}
                tone={internetTone(data)}
                eyebrow={t(`${K}.tiles.internet.eyebrow`)}
                value={
                  isInternetReachable(data)
                    ? t(`${K}.tiles.internet.reachable`)
                    : t(`${K}.tiles.internet.not_reachable`)
                }
                caption={
                  isInternetReachable(data)
                    ? t(`${K}.tiles.internet.caption_reachable`, {
                        address: publicAddress(data),
                      })
                    : t(`${K}.tiles.internet.caption_unreachable`, {
                        probe: PUBLIC_IP_PROBE,
                      })
                }
              />
            </>
          ) : (
            // Four boxes wearing the tile's own pin, imported rather than
            // restated, so the handoff cannot jump.
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className={SKELETON.TILE} />
            ))
          )}
        </div>
      )}
    </motion.section>
  );
}

export default IdentityBand;
