"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIcon,
  PowerIcon,
  RouteIcon,
  TargetIcon,
  TriangleAlertIcon,
  XCircleIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { TickGroup } from "@/components/ui/tick-group";
import { TickingValue } from "@/components/ui/ticking-value";
import { cn } from "@/lib/utils";

import { DISC_RING, DISC_TONE, DISC_TRANSITION, TILE, type DiscTone } from "./shapes";
import type { DpiMode } from "@/types/traffic-engine";

// =============================================================================
// LiveStrip — the four live tiles under the page header
// =============================================================================
// Replaces `engine-status-card.tsx`, and the replacement is a correctness fix
// before it is a visual one.
//
// -----------------------------------------------------------------------------
// THE RETIRED CARD COULD REPORT THE WRONG MODE
// -----------------------------------------------------------------------------
// The shell read `videoOptimizer.data ?? masquerade.data` and the card then
// picked its own shape from `"sni_domain" in data`. Both hooks fetch, so the
// Video Optimizer's payload was essentially always present and always won —
// which meant that with MASQUERADE enabled the card still rendered the Video
// Optimizer layout and showed "Domains loaded", a figure for a mode that has no
// domain list (docs/reference/dpi.md > Modes).
//
// The strip does not sniff anything. The shell derives ONE `mode` from the two
// `enabled` flags and passes it in, so there is a single answer to "which mode
// is active" and every tile reads it. That single answer is also what makes the
// three-way selector possible; the two are the same change.
//
// -----------------------------------------------------------------------------
// ONE CLOCK, AND THE FAILURE STATES LIVE ABOVE IT
// -----------------------------------------------------------------------------
// Every figure here comes from the same 2s GET, so a failed read is a property
// of the whole strip rather than of one column of it. That is why the strip
// carries NO failure branch of its own: a read that never landed replaces the
// strip with one banner in the shell, and a poll that fails on top of data
// holds the figures — they are still the last thing the modem confirmed — and
// says so in a stale banner above them. Four identical "couldn't read" tiles
// would be one message repeated four times.
//
// -----------------------------------------------------------------------------
// COLOUR, AND THE ONE AMBIENT LOOP
// -----------------------------------------------------------------------------
// Every body is `TILE.BODY`; there is no `tone` prop to make an exception. Two
// discs move at runtime — the engine's and the redirect rule's — because they
// are the only two things here with a functional state. Processed and Scope are
// counts, and a count is neutral (see `shapes.ts` for why the comp's `downlink`
// and `spatial` discs were not taken).
//
// The engine disc carries the surface's ONLY ambient loop, and it is gated on
// the engine genuinely RUNNING rather than on the page having loaded. The three
// engine states never share a glyph: `success-container` and `warning-container`
// measure 1.03:1 apart and are identical under deuteranopia, so the glyph is the
// channel that actually carries the state.
// =============================================================================

/** What the strip reads. A subset of the GET, so it cannot depend on more. */
export interface LiveStripReading {
  status: string;
  uptime: string;
  packets_processed: number;
  kernel_module_loaded: boolean;
}

/**
 * One tile. There is deliberately no body-tone prop: every body on this strip is
 * neutral, so a caller cannot tint one back. Making the wrong thing unreachable
 * is cheaper than a comment asking nobody to do it.
 */
function Tile({
  glyph: Glyph,
  tone = "neutral",
  animate = false,
  ring = false,
  eyebrow,
  children,
  caption,
}: {
  glyph: LucideIcon;
  /** The disc's fill pair — the only colour a tile is allowed to carry. */
  tone?: DiscTone;
  /** True only for the two discs that genuinely change at runtime. */
  animate?: boolean;
  /** The ambient loop. True only while the engine is actually running. */
  ring?: boolean;
  eyebrow: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, animate && DISC_TRANSITION, DISC_TONE[tone])}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
        {ring ? <span className={DISC_RING} aria-hidden="true" /> : null}
      </span>
      <div className={TILE.TEXT}>
        <span className={TILE.EYEBROW}>{eyebrow}</span>
        <span className={TILE.VALUE}>{children}</span>
        <span className={TILE.CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

/** Engine status -> disc tone and glyph. Never two states on one glyph. */
const ENGINE_SPEC: Record<string, { tone: DiscTone; glyph: LucideIcon }> = {
  running: { tone: "success", glyph: ZapIcon },
  restarting: { tone: "warning", glyph: TriangleAlertIcon },
  error: { tone: "destructive", glyph: XCircleIcon },
  stopped: { tone: "neutral", glyph: PowerIcon },
};

export interface LiveStripProps {
  /** The single derived answer to "which mode is active". Never sniffed. */
  mode: DpiMode;
  /** The GET's payload. `null` while the first read has not landed. */
  reading: LiveStripReading | null;
  /** Derived from successive packet samples by the shell. */
  packetsPerSecond: number;
  /** Hostlist size. Read from its own endpoint, so it survives a mode change. */
  domainCount: number;
}

export function LiveStrip({
  mode,
  reading,
  packetsPerSecond,
  domainCount,
}: LiveStripProps) {
  const { t } = useTranslation("common");

  const ready = reading !== null;

  const status = reading?.status ?? "stopped";
  const engine = ENGINE_SPEC[status] ?? ENGINE_SPEC.stopped;
  const isRunning = status === "running";

  const engineCaption = isRunning
    ? t("trafficEngine.tiles.engine.caption_uptime", { uptime: reading?.uptime ?? "" })
    : status === "restarting"
      ? t("trafficEngine.tiles.engine.caption_restarting")
      : status === "error"
        ? t("trafficEngine.tiles.engine.caption_error")
        : t("trafficEngine.tiles.engine.caption_stopped");

  // A stopped engine has not processed anything since it stopped, and the
  // counter it would print is the REDIRECT rule's, which keeps its last value.
  // Printing that under "Processed" while nothing is being processed is the
  // misstatement the em dash exists for.
  const packets = isRunning
    ? (reading?.packets_processed ?? 0).toLocaleString()
    : TILE.NONE;

  const scope =
    mode === "masquerade"
      ? {
          value: t("trafficEngine.tiles.scope.value_all"),
          caption: t("trafficEngine.tiles.scope.caption_all"),
        }
      : mode === "video_optimizer"
        ? {
            value: t("trafficEngine.tiles.scope.value_domains", { count: domainCount }),
            caption: t("trafficEngine.tiles.scope.caption_list"),
          }
        : {
            value: t("trafficEngine.tiles.scope.value_none"),
            caption: t("trafficEngine.tiles.scope.caption_saved", { count: domainCount }),
          };

  const ruleActive = reading?.kernel_module_loaded ?? false;

  return (
    <section aria-label={t("trafficEngine.strip.label")} className="flex flex-col gap-2">
      <div className={TILE.GRID}>
        {ready ? (
          // Only the packet counter ticks. The engine state, the scope and the
          // rule are CATEGORIES — dipping a value that holds steady for hours
          // invents an event that did not happen.
          <TickGroup>
            <Tile
              glyph={engine.glyph}
              tone={engine.tone}
              animate
              ring={isRunning}
              eyebrow={t("trafficEngine.tiles.engine.label")}
              caption={engineCaption}
            >
              <span className={TILE.VALUE_TEXT}>
                {t(`trafficEngine.status.${status}`)}
              </span>
            </Tile>

            <Tile
              glyph={ActivityIcon}
              eyebrow={t("trafficEngine.tiles.packets.label")}
              caption={
                isRunning
                  ? t("trafficEngine.tiles.packets.caption_rate", { n: packetsPerSecond })
                  : t("trafficEngine.tiles.packets.caption_idle")
              }
            >
              <TickingValue value={packets} className={TILE.VALUE_TEXT}>
                {packets}
              </TickingValue>
            </Tile>

            <Tile
              glyph={TargetIcon}
              eyebrow={t("trafficEngine.tiles.scope.label")}
              caption={scope.caption}
            >
              <span className={TILE.VALUE_TEXT}>{scope.value}</span>
            </Tile>

            <Tile
              glyph={ruleActive ? RouteIcon : PowerIcon}
              tone={ruleActive ? "primary" : "neutral"}
              animate
              eyebrow={t("trafficEngine.tiles.rule.label")}
              caption={t("trafficEngine.tiles.rule.caption")}
            >
              <span className={TILE.VALUE_TEXT}>
                {t(
                  ruleActive
                    ? "trafficEngine.tiles.rule.value_active"
                    : "trafficEngine.tiles.rule.value_removed",
                )}
              </span>
            </Tile>
          </TickGroup>
        ) : (
          // Four skeletons in the SAME grid, mirroring the pin BY IMPORT rather
          // than by number (The Skeleton-Mirror Rule). The retired card guessed
          // `h-16` against tiles that resolve to 104px.
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
          ))
        )}
      </div>
    </section>
  );
}

export default LiveStrip;
