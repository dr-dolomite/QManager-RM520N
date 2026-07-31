"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import type { MetricBarTone } from "@/components/ui/metric-bar";
import { cn } from "@/lib/utils";

import { TILE_SHAPE } from "@/components/cellular/radio/summary-tiles";
import type { SmsStorage } from "@/types/sms";

// =============================================================================
// SMS summary tiles — the strip above the Inbox card
// =============================================================================
// Mock reference: `reimagine/SMS Center.dc.html` lines 85-112. The ANATOMY is
// kept verbatim (52px glyph disc → eyebrow → value → caption/meter) by importing
// `TILE_SHAPE` from the Radio Information strip, which is the shipped reference
// implementation of this shape. Nothing here restates a number that lives there,
// so `SmsSummaryTilesSkeleton` below is a true mirror rather than an estimate
// (DESIGN.md > The Skeleton-Mirror Rule).
//
// Every VALUE in the mock is a fabrication and is re-derived here. The mock
// draws ME 18/50 and SM 6/20; the live RM520N-GL reports ME 64/255 and SM 0/35.
// That matters for more than accuracy: the real ME meter sits near 25% and the
// real SM meter sits at 0%, so the tile has to read correctly when it is nearly
// empty, which the mock's comfortable mid-fill never tested.
//
// COLOUR, and the one place this file departs from the comp.
//
// The mock paints the SIM tile in Carrier Violet (its `--sc`). Violet is the 4G
// LTE identity and nothing else (DESIGN.md > Secondary), and this page is two
// clicks from the dashboard signal cards where a violet chip means "the LTE
// leg". A violet tile labelled SIM moves that meaning. The SIM tile therefore
// takes `uplink-container`, which is the system's third identity hue and already
// owns "counts and supporting readouts" on the Radio Information strip.
//
// The mock also draws each glyph disc as a white alpha wash of its own tile (an
// 18% and a 50% pure-white overlay). That is wrong twice: pure white is a
// literal the system bans outright, and in dark mode these role fills are
// LIGHT, so a white wash over them nearly vanishes. Instead every disc INVERTS
// its tile's pairing — a fill tile gets a container disc, a container tile gets
// a fill disc — so the glyph pops off its own circle and survives grayscale.
// =============================================================================

/**
 * The strip's grid. Three tracks, not the Radio strip's four, because this
 * surface has three figures — so the column count is the one piece of geometry
 * that legitimately differs and is declared here rather than borrowed.
 *
 * `TILE_SHAPE.GRID` is deliberately NOT reused: it steps to `grid-cols-4`, which
 * would leave a fourth empty track at wide widths. Everything else about a tile
 * — its height, padding, radius and disc — still comes from `TILE_SHAPE`.
 *
 * Exported so the skeleton lays out on exactly these tracks.
 */
export const SMS_TILE_GRID =
  "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @4xl/main:grid-cols-3";

/**
 * The degraded storage tile spans two tracks, so the strip keeps THREE column
 * tracks in both the split and the combined case. Without this the skeleton
 * would have to guess which shape it is about to hand off to, and an
 * un-upgraded device would take a visible reflow on first paint.
 */
const COMBINED_SPAN = "@xl/main:col-span-2 @4xl/main:col-span-2";

// Tile / disc pairings. A tile is either a FILL pair or a CONTAINER pair, never
// crossed, and the disc always inverts whichever the tile chose.
const UNREAD_TILE = "bg-primary text-primary-foreground";
const UNREAD_DISC = "bg-primary-container text-on-primary-container";
const ME_TILE = "bg-primary-container text-on-primary-container";
const ME_DISC = "bg-primary text-primary-foreground";
const SM_TILE = "bg-uplink-container text-on-uplink-container";
const SM_DISC = "bg-uplink text-uplink-foreground";

/** Headline step (600 / 20px). The mock's 19px belongs to the pre-auth scale. */
const VALUE = "text-xl font-semibold leading-[1.1]";
const MONO_VALUE = cn(VALUE, "font-mono tabular-nums");

function Tile({
  glyph,
  label,
  tone,
  disc,
  children,
  className,
}: {
  glyph: MaterialSymbolName;
  label: string;
  tone: string;
  disc: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, tone, className)}>
      <span aria-hidden="true" className={cn(TILE_SHAPE.DISC, disc)}>
        <MaterialSymbol name={glyph} filled size={28} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-xs font-semibold opacity-85">{label}</span>
        {children}
      </div>
    </div>
  );
}

/**
 * One storage meter. `used`/`total` are whatever the CGI actually reported for
 * that memory; a `total` of 0 (or anything non-finite) renders the label and NO
 * meter rather than dividing by zero, because a full-width bar over an unknown
 * capacity is a confident lie about a number we do not have.
 */
function StorageMeter({
  used,
  total,
  baseTone,
  index,
  unknownLabel,
}: {
  used: number;
  total: number;
  baseTone: MetricBarTone;
  index: number;
  unknownLabel: string;
}) {
  const hasCapacity = Number.isFinite(total) && total > 0;
  const safeUsed = Number.isFinite(used) ? used : 0;

  if (!hasCapacity) {
    return <span className={MONO_VALUE}>{unknownLabel}</span>;
  }

  return (
    <>
      <span className={MONO_VALUE}>
        {safeUsed} / {total}
      </span>
      {/* A storage meter is data visualization — a share-of-capacity readout
          that can go DOWN when messages are deleted — not step progress, so
          the Loader-and-Dots Rule does not apply and a bar is correct here.
          `MetricBar` already animates the value in `width` with the entrance as
          a one-time `scaleX`, and bans the spring the mock's ancestors used. */}
      <MetricBar
        value={safeUsed}
        max={total}
        warnAt={total * 0.8}
        dangerAt={total * 0.95}
        baseTone={baseTone}
        size="md"
        track="surface-container-high"
        index={index}
      />
    </>
  );
}

export interface SmsSummaryTilesProps {
  unreadCount: number;
  totalCount: number;
  /**
   * Timestamp of the newest message, verbatim from the modem
   * ("MM/DD/YY HH:MM:SS"), or null when the inbox is empty.
   */
  newestTimestamp: string | null;
  storage: SmsStorage | undefined;
}

export function SmsSummaryTiles({
  unreadCount,
  totalCount,
  newestTimestamp,
  storage,
}: SmsSummaryTilesProps) {
  const { t } = useTranslation("cellular");

  // The per-memory breakdown is OPTIONAL in `types/sms.ts` on purpose: a device
  // that has not taken the OTA update runs the old CGI, which emits only the
  // summed `used`/`total`. Both halves must be present to draw two meters —
  // half a breakdown is not a breakdown.
  const me = storage?.me;
  const sm = storage?.sm;
  const hasSplit = !!me && !!sm;

  // The modem clock has no timezone and the caption must not read as a
  // duration: `Date.now()` during render is a `react-hooks/purity` violation,
  // and modem-vs-browser skew can make a relative caption read NEGATIVE. So the
  // newest message is reported as the absolute stamp it already carries, minus
  // the seconds, which are noise at this size.
  const newest = newestTimestamp
    ? newestTimestamp.replace(/:\d{2}$/, "")
    : null;

  return (
    <div className={SMS_TILE_GRID}>
      <Tile
        glyph="mark_email_unread"
        label={t("sms.tiles.unread.label")}
        tone={UNREAD_TILE}
        disc={UNREAD_DISC}
      >
        {/* Read-state is per-browser localStorage, so a fresh browser legitimately
            reads "39 of 39". The figure and its denominator are separate nodes at
            separate sizes precisely so the near-100% case reads as a normal
            sentence rather than as a broken ratio. */}
        <span className="flex items-baseline gap-1.5">
          <span className={MONO_VALUE}>{unreadCount}</span>
          <span className="text-sm font-semibold">
            {t("sms.tiles.unread.of", { total: totalCount })}
          </span>
        </span>
        <span className="truncate text-xs opacity-85">
          {newest ? (
            <span className="font-mono tabular-nums">
              {t("sms.tiles.unread.caption_newest", { timestamp: newest })}
            </span>
          ) : (
            t("sms.tiles.unread.caption_none")
          )}
        </span>
      </Tile>

      {hasSplit ? (
        <>
          <Tile
            glyph="memory"
            label={t("sms.tiles.me.label")}
            tone={ME_TILE}
            disc={ME_DISC}
          >
            <StorageMeter
              used={me.used}
              total={me.total}
              baseTone="primary"
              index={0}
              unknownLabel={t("sms.tiles.capacity_unknown")}
            />
          </Tile>

          <Tile
            glyph="sim_card"
            label={t("sms.tiles.sm.label")}
            tone={SM_TILE}
            disc={SM_DISC}
          >
            <StorageMeter
              used={sm.used}
              total={sm.total}
              baseTone="uplink"
              index={1}
              unknownLabel={t("sms.tiles.capacity_unknown")}
            />
          </Tile>
        </>
      ) : (
        // Degradation path. The summed `total` (290 on the live device) is two
        // capacities in physically different memories added together, and a
        // message cannot spill from one into the other — so it is never labelled
        // as a capacity. "Slots used across both memories" is the honest reading
        // of the only number this device gives us.
        <Tile
          glyph="memory"
          label={t("sms.tiles.combined.label")}
          tone={ME_TILE}
          disc={ME_DISC}
          className={COMBINED_SPAN}
        >
          <StorageMeter
            used={storage?.used ?? 0}
            total={storage?.total ?? 0}
            baseTone="primary"
            index={0}
            unknownLabel={t("sms.tiles.capacity_unknown")}
          />
          <span className="truncate text-xs opacity-85">
            {t("sms.tiles.combined.caption")}
          </span>
        </Tile>
      )}
    </div>
  );
}

export default SmsSummaryTiles;
