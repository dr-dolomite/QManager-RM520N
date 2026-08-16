"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeftRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  CircleAlertIcon,
  GaugeIcon,
  HelpCircleIcon,
  Loader2Icon,
  RefreshCcwIcon,
  SlidersHorizontalIcon,
  UnplugIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Ethernet Status — presentational body of `/local-network/ethernet`
// =============================================================================
// This module owns NO data. The page shell (`ethernet-status.tsx`) fetches,
// polls and applies the speed limit; everything here renders what it is given.
//
// The layout follows the Radio Information page's vocabulary, which is the
// DESIGN.md canon for a glance surface:
//
//   1. A four-tile summary strip. The link-state tile CARRIES the state — its
//      container fill is `success-container` when the cable is up and
//      `destructive-container` when it is not ("Disconnected link" is the
//      canon's own destructive example). The other three tiles are static
//      container pairs: `uplink-container` for the data-rate figure (cyan is
//      the counts/upload family), `primary-container` for the negotiation
//      setting, neutral for duplex. The glyph disc always inverts the tile's
//      pairing (a container tile gets a strong-fill disc) so the icon pops,
//      and each link state carries a DIFFERENT glyph so the state survives
//      grayscale (Every-Chip-Has-A-Glyph Rule, applied to tiles).
//
//   2. A single settings card holding the speed-limit Select. The Select
//      APPLIES ON CHANGE (the backend contract: POST speed_limit → PHY bounce
//      → confirm-poll), so the trigger itself carries the three-state
//      confirmation — spinner "Applying…" → check "Saved" — instead of a
//      separate save button. This is the same in-place confirmation the old
//      page used; only the shape is new (pill trigger on
//      `surface-container-high`).
//
// The skeleton mirrors the loaded tile geometry through the shared
// `ETH_TILE_SHAPE` constant (Skeleton-Mirror Rule), and the whole route stays
// on lucide per the Icon-Boundary Rule.
// =============================================================================

/** The CGI response shape. Kept here so the shell and the body agree on it. */
export interface EthernetStatus {
  link_status: string;
  speed: string;
  duplex: string;
  auto_negotiation: string;
  speed_limit: string;
  supports_2500?: boolean;
}

// -----------------------------------------------------------------------------
// Geometry — exported so the skeleton cannot drift from the real tiles
// -----------------------------------------------------------------------------

/**
 * Same geometry as the Radio Information tiles (`TILE_SHAPE`), restated here
 * rather than imported: `/local-network/` is a separate route family and must
 * not reach into `components/cellular/radio/`. The values are the system's,
 * and the skeleton mirrors them through this constant.
 */
export const ETH_TILE_SHAPE = {
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  ROOT: "flex min-h-[5.75rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's resolved height, for the skeleton. */
  HEIGHT: "h-[5.75rem]",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
} as const;

const NEUTRAL_TILE = "bg-surface-container text-on-surface";
const NEUTRAL_DISC = "bg-surface-container-high text-on-surface-variant";

/** Link-state tiles. The state IS the tone; the disc inverts to the strong fill. */
const LINK_UP_TILE = "bg-success-container text-on-success-container";
const LINK_UP_DISC = "bg-success text-success-foreground";
const LINK_DOWN_TILE = "bg-destructive-container text-on-destructive-container";
const LINK_DOWN_DISC = "bg-destructive text-destructive-foreground";

/** Link speed is CAPACITY, which is Downlink Rose's second meaning — the same
 *  reason the Radio Information bandwidth tile wears it. It was Uplink Cyan,
 *  which since 2026-08-16 means the UPLOAD direction specifically; a negotiated
 *  Ethernet link rate is bidirectional, so cyan was claiming a direction the
 *  figure does not have. */
const SPEED_TILE = "bg-downlink-container text-on-downlink-container";
const SPEED_DISC = "bg-downlink text-downlink-foreground";
/** Negotiation mode is a link SETTING, not a radio — but `primary` is also the
 *  brand and this is a plain configuration readout, which is the one thing the
 *  brand ramp is always allowed to be. */
const NEGOTIATION_TILE = "bg-primary-container text-on-primary-container";
const NEGOTIATION_DISC = "bg-primary text-primary-foreground";

const LABEL = "text-xs font-semibold";
const VALUE = "text-xl font-semibold leading-[1.1]";
const TABULAR_VALUE = cn(VALUE, "tabular-nums");
const CAPTION = "truncate text-xs";
const CAPTION_CLASS = "text-xs text-on-surface-variant";

function Tile({
  glyph: Glyph,
  label,
  children,
  caption,
  tone = NEUTRAL_TILE,
  disc = NEUTRAL_DISC,
  captionClassName = CAPTION_CLASS,
  animate = false,
}: {
  glyph: LucideIcon;
  label: string;
  children: React.ReactNode;
  caption: React.ReactNode;
  tone?: string;
  disc?: string;
  captionClassName?: string;
  /** True when the tone can change at runtime (the link tile) — the fill and
   *  ink then transition on the standard clock so a link event reads as a
   *  state change rather than a repaint. Never `transition-all`. */
  animate?: boolean;
}) {
  return (
    <div
      className={cn(
        ETH_TILE_SHAPE.ROOT,
        animate &&
          "transition-[background-color,color] duration-[--duration-standard] ease-[--ease-standard]",
        tone,
      )}
    >
      <span
        className={cn(
          ETH_TILE_SHAPE.DISC,
          animate &&
            "transition-[background-color,color] duration-[--duration-standard] ease-[--ease-standard]",
          disc,
        )}
      >
        <Glyph className="size-7" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span
          className={cn(
            LABEL,
            tone === NEUTRAL_TILE ? "text-on-surface-variant" : "opacity-85",
          )}
        >
          {label}
        </span>
        {children}
        <span className={cn(CAPTION, captionClassName)}>{caption}</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

function formatSpeed(speed: string): string {
  if (!speed || speed === "Unknown") return "N/A";
  // If already formatted like "1000Mb/s", convert to a friendlier display.
  const match = speed.match(/^(\d+)Mb\/s$/);
  if (match) {
    const mbps = parseInt(match[1], 10);
    if (mbps >= 1000) return `${mbps / 1000} Gbps`;
    return `${mbps} Mbps`;
  }
  return speed;
}

function formatDuplex(duplex: string): string {
  if (!duplex || duplex === "Unknown") return "N/A";
  return duplex.charAt(0).toUpperCase() + duplex.slice(1);
}

// -----------------------------------------------------------------------------
// Summary tiles
// -----------------------------------------------------------------------------

export interface EthernetTilesProps {
  status: EthernetStatus;
}

export function EthernetTiles({ status }: EthernetTilesProps) {
  const { t } = useTranslation("common");
  const K = "ethernet.tiles";

  const isConnected = status.link_status === "up";

  // The link tile's tone and glyph follow the link, not aesthetics: up is
  // `success-container`, down is `destructive-container` (a disconnected link
  // is a failure state, per DESIGN.md), unknown stays neutral. The three
  // states never share a glyph.
  const linkSpec = isConnected
    ? {
        tone: LINK_UP_TILE,
        disc: LINK_UP_DISC,
        glyph: CheckCircle2Icon,
        value: t(`${K}.link.value_up`),
        caption: t(`${K}.link.caption_up`),
      }
    : status.link_status === "down"
      ? {
          tone: LINK_DOWN_TILE,
          disc: LINK_DOWN_DISC,
          glyph: UnplugIcon,
          value: t(`${K}.link.value_down`),
          caption: t(`${K}.link.caption_down`),
        }
      : {
          tone: NEUTRAL_TILE,
          disc: NEUTRAL_DISC,
          glyph: HelpCircleIcon,
          value: t(`${K}.link.value_unknown`),
          caption: t(`${K}.link.caption_unknown`),
        };

  // The speed and duplex figures only mean anything while the link is up; when
  // it is down they report "N/A" with a caption that says why, instead of
  // pretending a negotiation happened.
  const speed = isConnected ? formatSpeed(status.speed) : t(`${K}.speed.value_na`);
  const duplex = isConnected ? formatDuplex(status.duplex) : t(`${K}.duplex.value_na`);

  // `speed_limit` reflects the SAVED setting, which is valid with or without a
  // link — so the negotiation tile never blanks out on a down link.
  const speedLimit = status.speed_limit;
  const negotiation =
    speedLimit === "auto"
      ? {
          value: t(`${K}.negotiation.value_auto`),
          caption: t(`${K}.negotiation.caption_auto`),
        }
      : speedLimit
        ? {
            value: t(`${K}.negotiation.value_manual`),
            caption: t(`${K}.negotiation.caption_manual`),
          }
        : {
            value: t(`${K}.negotiation.value_na`),
            caption: t(`${K}.negotiation.caption_na`),
          };

  return (
    <div className={ETH_TILE_SHAPE.GRID}>
      <Tile
        glyph={linkSpec.glyph}
        label={t(`${K}.link.label`)}
        tone={linkSpec.tone}
        disc={linkSpec.disc}
        caption={linkSpec.caption}
        captionClassName={
          linkSpec.tone === NEUTRAL_TILE ? CAPTION_CLASS : "text-xs opacity-85"
        }
        animate
      >
        <span className={cn(VALUE, "truncate")}>{linkSpec.value}</span>
      </Tile>

      <Tile
        glyph={GaugeIcon}
        label={t(`${K}.speed.label`)}
        tone={SPEED_TILE}
        disc={SPEED_DISC}
        caption={
          isConnected
            ? t(`${K}.speed.caption`)
            : t(`${K}.speed.caption_down`)
        }
        captionClassName="text-xs opacity-85"
      >
        <span className={TABULAR_VALUE}>{speed}</span>
      </Tile>

      <Tile
        glyph={ArrowLeftRightIcon}
        label={t(`${K}.duplex.label`)}
        tone={NEUTRAL_TILE}
        disc={NEUTRAL_DISC}
        caption={
          isConnected
            ? t(`${K}.duplex.caption`)
            : t(`${K}.duplex.caption_down`)
        }
      >
        <span className={VALUE}>{duplex}</span>
      </Tile>

      <Tile
        glyph={SlidersHorizontalIcon}
        label={t(`${K}.negotiation.label`)}
        tone={NEGOTIATION_TILE}
        disc={NEGOTIATION_DISC}
        caption={negotiation.caption}
        captionClassName="text-xs opacity-85"
      >
        <span className={cn(VALUE, "truncate")}>{negotiation.value}</span>
      </Tile>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Settings card — the speed-limit Select
// -----------------------------------------------------------------------------

/** The family's canonical Select shape (see `cellular/settings/shapes.ts`). */
const SELECT_TRIGGER =
  "h-[2.625rem] w-full rounded-pill border-0 bg-surface-container-high px-4 text-[0.84375rem] font-medium @2xl/card:w-auto";

const SPEED_LIMIT_LABEL_ID = "ethernet-speed-limit-label";

export interface EthernetSettingsCardProps {
  speedLimit: string;
  supports2500: boolean;
  isSaving: boolean;
  saved: boolean;
  onSpeedChange: (value: string) => void;
}

export function EthernetSettingsCard({
  speedLimit,
  supports2500,
  isSaving,
  saved,
  onSpeedChange,
}: EthernetSettingsCardProps) {
  const { t } = useTranslation("common");
  const K = "ethernet.settings";

  return (
    <Card className="@container/card gap-5 rounded-hero border-0 bg-surface py-[1.625rem] shadow-sm">
      <CardHeader>
        <CardTitle>{t(`${K}.title`)}</CardTitle>
        <CardDescription>{t(`${K}.description`)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 @2xl/card:flex-row @2xl/card:items-center @2xl/card:justify-between @2xl/card:gap-6">
          <span
            id={SPEED_LIMIT_LABEL_ID}
            className="text-[0.8125rem] font-semibold leading-5 text-on-surface-variant"
          >
            {t(`${K}.row_label`)}
          </span>
          <Select
            value={speedLimit}
            onValueChange={onSpeedChange}
            disabled={isSaving}
          >
            <SelectTrigger
              aria-labelledby={SPEED_LIMIT_LABEL_ID}
              className={SELECT_TRIGGER}
            >
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" />
                  {t(`${K}.applying`)}
                </span>
              ) : saved ? (
                <span className="flex items-center gap-2">
                  <CheckIcon className="size-3.5" />
                  {t(`${K}.saved`)}
                </span>
              ) : (
                <SelectValue placeholder={t(`${K}.placeholder`)} />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t(`${K}.group_label`)}</SelectLabel>
                <SelectItem value="auto">{t(`${K}.option_auto`)}</SelectItem>
                <SelectItem value="10">{t(`${K}.option_10`)}</SelectItem>
                <SelectItem value="100">{t(`${K}.option_100`)}</SelectItem>
                <SelectItem value="1000">{t(`${K}.option_1000`)}</SelectItem>
                {supports2500 ? (
                  <SelectItem value="2500">{t(`${K}.option_2500`)}</SelectItem>
                ) : null}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Loading skeleton
// -----------------------------------------------------------------------------
// Mirrors the loaded tile geometry exactly — same grid, same 92px block, same
// 28px radius — by importing ETH_TILE_SHAPE rather than restating numbers. The
// settings card is not skeletonised: it appears with the loaded state, the way
// Radio Information's cards do.

export function EthernetTilesSkeleton({ label }: { label?: string }) {
  return (
    <div className={ETH_TILE_SHAPE.GRID}>
      {label && <span className="sr-only">{label}</span>}
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={cn(ETH_TILE_SHAPE.HEIGHT, "rounded-tile")} />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Error state — only shown when no data has ever loaded
// -----------------------------------------------------------------------------

export interface EthernetErrorStateProps {
  title: string;
  body: string;
  retryLabel: string;
  onRetry: () => void;
}

export function EthernetErrorState({
  title,
  body,
  retryLabel,
  onRetry,
}: EthernetErrorStateProps) {
  return (
    <Card className="gap-5 rounded-hero border-0 bg-surface py-[1.625rem] shadow-sm">
      <CardContent>
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <span className="grid size-14 place-items-center rounded-pill bg-surface-container-high text-on-surface-variant">
            <CircleAlertIcon className="size-7" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-on-surface-variant">{body}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onRetry}
            className="h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold"
          >
            <RefreshCcwIcon className="size-4" />
            {retryLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
