"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import type { MetricBarTone } from "@/components/ui/metric-bar";
import { SLOT, withSlot } from "@/components/auth/interpolation-slot";
import { cn } from "@/lib/utils";

import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import {
  TILE_BODY,
  TILE_CAPTION,
  TILE_COMBINED_SPAN,
  TILE_DISC_NEUTRAL,
  TILE_DISC_UNREAD,
  TILE_EYEBROW,
  TILE_GRID,
  TILE_VALUE_ABSENT,
  TILE_VALUE_TABULAR,
} from "./shapes";
import type { SmsStorage } from "@/types/sms";

// =============================================================================
// SMS summary tiles — three neutral tiles, one coloured disc
// =============================================================================
// GEOMETRY is imported, never restated: `TILE_SHAPE` from
// `components/cellular/tile-shape.ts` (the family-wide 52px-disc tile) and this
// strip's own grid, tone and type steps from `./shapes.ts`. That is what makes
// `SmsTilesSkeleton` in `states.tsx` a true mirror rather than an estimate
// (DESIGN.md > The Skeleton-Mirror Rule).
//
// COLOUR. The tile BODY is neutral on every tile and the DISC carries the hue —
// the same composition `radio/summary-tiles.tsx` arrived at after five
// generations, and the reasoning lives with the constants in `./shapes.ts`.
// This strip previously ran two retired generations at once: the unread tile on
// the STRONG FILL (`bg-primary`, a 104px block of it) and the two storage tiles
// on pale containers, one of them in Uplink Cyan.
//
// The cyan was argued for as "the hue that owns counts system-wide". That is the
// exact argument `radio/summary-tiles.tsx` names and rejects — "A count is not a
// direction. That gave cyan a second meaning and made the whole direction axis
// untrue" — after it had already been tried and reverted once on the Carriers
// tile. A stored-message count has no honest hue, so both storage tiles take the
// NEUTRAL disc and the meter length carries the reading (The Neutral-Default
// Rule). Only "unread", which is the one figure on this strip a user acts on,
// keeps the brand fill.
//
// Every VALUE here is re-derived from the device, not from the comp: the mock
// draws ME 18/50 and SM 6/20, while the live RM520N-GL reports ME 64/255 and SM
// 0/35. The real SM meter sits at 0%, so the tile has to read correctly when it
// is nearly empty — which the mock's comfortable mid-fill never tested.
// =============================================================================

function Tile({
  glyph,
  label,
  disc = TILE_DISC_NEUTRAL,
  children,
  className,
}: {
  glyph: MaterialSymbolName;
  label: string;
  /**
   * The disc's fill pair. There is deliberately NO `tone` prop: the body is
   * neutral on every tile, so a caller cannot tint one back. Making the wrong
   * thing unreachable is cheaper than a comment asking nobody to do it — the
   * same call `radio/summary-tiles.tsx` makes for the same reason.
   */
  disc?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(TILE_SHAPE.ROOT, TILE_BODY, className)}>
      <span aria-hidden="true" className={cn(TILE_SHAPE.DISC, disc)}>
        <MaterialSymbol name={glyph} filled size={28} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={TILE_EYEBROW}>{label}</span>
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
  unknownLabel,
}: {
  used: number;
  total: number;
  baseTone: MetricBarTone;
  unknownLabel: string;
}) {
  const hasCapacity = Number.isFinite(total) && total > 0;
  const safeUsed = Number.isFinite(used) ? used : 0;

  if (!hasCapacity) {
    // One step BELOW a real reading: "Unknown" must not out-weigh the figures
    // beside it just because the sentence is longer.
    return <span className={TILE_VALUE_ABSENT}>{unknownLabel}</span>;
  }

  return (
    <>
      <span className={TILE_VALUE_TABULAR}>
        {safeUsed} / {total}
      </span>
      {/* A storage meter is data visualization — a share-of-capacity readout
          that can go DOWN when messages are deleted — not step progress, so
          the Loader-and-Dots Rule does not apply and a bar is correct here.
          `MetricBar` already animates the value in `width` with the entrance as
          a one-time `scaleX`, and bans the spring the mock's ancestors used.

          `index={0}` on purpose. A per-meter index would open a SECOND
          uncoordinated clock inside a card that is itself arriving on the page
          cascade, so the two meters would drift against the tile they sit in
          (The One-Clock Rule). The tiles' own stagger is the page's. */}
      <MetricBar
        value={safeUsed}
        max={total}
        warnAt={total * 0.8}
        dangerAt={total * 0.95}
        baseTone={baseTone}
        size="md"
        // The body is `surface-container`, so the track takes the step above it.
        track="surface-container-high"
        index={0}
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
    <div className={TILE_GRID}>
      <Tile
        glyph="mark_email_unread"
        label={t("sms.tiles.unread.label")}
        disc={TILE_DISC_UNREAD}
      >
        {/* Read-state is per-browser localStorage, so a fresh browser legitimately
            reads "39 of 39". The figure and its denominator are separate nodes at
            separate sizes precisely so the near-100% case reads as a normal
            sentence rather than as a broken ratio. */}
        <span className="flex items-baseline gap-1.5">
          <span className={TILE_VALUE_TABULAR}>{unreadCount}</span>
          <span className="text-sm font-semibold">
            {t("sms.tiles.unread.of", { total: totalCount })}
          </span>
        </span>
        <span className={cn("truncate", TILE_CAPTION)}>
          {newest
            ? // MONO IS SCOPED TO THE STAMP, not to the sentence. The whole
              // translated string used to be wrapped in `font-mono`, so the
              // human word "Newest" (and its four translations) shipped in
              // JetBrains Mono — the Machine-Voice Rule inverted. The sentinel
              // helper slices ONE interpolated value back out of the finished
              // string, so the translator keeps full control of word order and
              // no locale gains a `<0>` tag it cannot see rendered. See
              // `components/auth/interpolation-slot.tsx` for why this beats both
              // `<Trans>` and splitting the key in two.
              withSlot(
                t("sms.tiles.unread.caption_newest", { timestamp: SLOT }),
                <span className="font-mono tabular-nums">{newest}</span>,
              )
            : t("sms.tiles.unread.caption_none")}
        </span>
      </Tile>

      {hasSplit ? (
        <>
          <Tile glyph="memory" label={t("sms.tiles.me.label")}>
            <StorageMeter
              used={me.used}
              total={me.total}
              baseTone="primary"
              unknownLabel={t("sms.tiles.capacity_unknown")}
            />
          </Tile>

          <Tile glyph="sim_card" label={t("sms.tiles.sm.label")}>
            <StorageMeter
              used={sm.used}
              total={sm.total}
              baseTone="primary"
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
          className={TILE_COMBINED_SPAN}
        >
          <StorageMeter
            used={storage?.used ?? 0}
            total={storage?.total ?? 0}
            baseTone="primary"
            unknownLabel={t("sms.tiles.capacity_unknown")}
          />
          <span className={cn("truncate", TILE_CAPTION)}>
            {t("sms.tiles.combined.caption")}
          </span>
        </Tile>
      )}
    </div>
  );
}

export default SmsSummaryTiles;
