"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  MinusCircleIcon,
  PackageIcon,
  RefreshCcwIcon,
  RouteIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import {
  BAND,
  CHIP_GLYPH,
  DISC_TONE,
  DISC_TRANSITION,
  NOTICE_ACTION,
  NOTICE_SPAN,
  NOTICE_TITLE,
  TILE,
  VALUE_NONE,
  type DiscTone,
  type TtlMtuState,
} from "./shapes";

// =============================================================================
// TtlMtuStrip — Band A of /local-network/ttl-settings
// =============================================================================
// Three read-only tiles above the two write cards: what the interface is
// actually doing with TTL, hop limit and MTU right now.
//
// This band is the whole reframe. The retired page opened with the fields you
// can WRITE and never once said what was in force — the only hint was a
// pre-filled input, which is a control reporting itself rather than the device
// reporting. On a product that runs ON the modem it is reconfiguring, "what is
// true right now" is the first question, not the last.
//
// -----------------------------------------------------------------------------
// THREE TILES, AND THE FOURTH ONE WAS CUT ON PURPOSE
// -----------------------------------------------------------------------------
// The approved comp had a fourth tile — "ON REBOOT -> Reapplied / Nothing set",
// reading the `autostart` field. It is gone by user decision (2026-08-31) and
// the field is deliberately not read anywhere in this family:
//
//   ttl.sh:48-51         autostart = svc_is_enabled "$TTL_INIT"
//   platform.sh:130-133  svc_is_enabled() { [ -L "$_WANTS_DIR/$unit" ]; }
//
// That is purely "does the boot symlink exist", and the installer creates it for
// `qmanager-ttl` on every install and every OTA. The field is `true` on every
// device, forever. It is not even sufficient for reapplication: the unit carries
// `ConditionPathExists=/etc/qmanager/ttl_state`, and the state writer DELETES
// that file when ttl and hl are both zero — so a fresh device reports
// autostart:true with nothing to reapply, and the tile would have read
// "Reapplied" beside two empty values. Rendering a compile-time constant as if
// it were a reading is worse than not showing it.
//
// -----------------------------------------------------------------------------
// TWO CLOCKS, AND FAILURE IS PER-READ
// -----------------------------------------------------------------------------
// This band spans TWO endpoints — `ttl.sh` and `mtu.sh` — which fail
// independently. So a failure is never allowed to blank the whole band: if one
// read lands and the other does not, the tiles that HAVE an answer show it and
// the tile that does not shows the em-dash placeholder with a caption saying so.
// The spanning notice is reserved for the case where NEITHER endpoint answered,
// because that is the only case where the band genuinely has nothing to say.
//
// -----------------------------------------------------------------------------
// COLOUR
// -----------------------------------------------------------------------------
// Every body is `TILE.BODY` and there is no `tone` prop to make an exception. A
// disc goes `success` only when an override is genuinely in force; otherwise it
// is neutral. Running on the carrier's own TTL and MTU is not a fault and not a
// warning — it is a correctly-behaving modem — and a band that painted it amber
// would be inventing a problem to have a colour for.
// =============================================================================

const K = "ttlMtu";

/**
 * The MTU the carrier hands out on essentially every network this device sees.
 * Named rather than inlined because it appears in a caption AND is the value
 * `mtu.sh` falls back to; see `MtuStripReading` below for why that matters.
 */
const CARRIER_DEFAULT_MTU = 1500;

/**
 * The band chip's label, per state.
 *
 * A record of LITERAL key strings rather than an interpolated
 * `strip.chip_${state}`: a half-assembled key is not something any tool can
 * resolve statically, and this surface's translation coverage is checked by
 * reading call sites. Same shape the sibling ethernet strip uses for its
 * speed-limit labels.
 */
const STATE_LABEL_KEY: Record<TtlMtuState, string> = {
  custom: `${K}.strip.chip_custom`,
  default: `${K}.strip.chip_default`,
};

/** What the band knows about TTL and hop limit. */
export interface TtlStripReading {
  isEnabled: boolean;
  ttl: number;
  hl: number;
}

/**
 * What the band knows about MTU.
 *
 * `currentValue` is NOT unconditionally a measurement. `mtu.sh:96-97` reads the
 * interface and then does `current_mtu=${current_mtu:-1500}`, so a failed
 * `ip link show` and a genuine 1500 arrive on the wire as the same number. The
 * band therefore never draws an MTU figure unless the READ itself succeeded
 * (this object is non-null), and its caption states provenance —
 * "Carrier-negotiated" — rather than claiming the interface was measured. The
 * residual ambiguity is a backend gap, not a UI one: it closes when `mtu.sh`
 * reports the read status instead of substituting a plausible number for it.
 */
export interface MtuStripReading {
  isEnabled: boolean;
  currentValue: number;
}

/**
 * One tile. There is deliberately no body-tone prop: every body on this band is
 * neutral, so a caller cannot tint one back. Making the wrong thing unreachable
 * is cheaper than a comment asking nobody to do it.
 */
function Tile({
  glyph: Glyph,
  tone = "neutral",
  eyebrow,
  children,
  caption,
}: {
  glyph: LucideIcon;
  /** The disc's fill — the only colour a tile is allowed to carry. */
  tone?: DiscTone;
  eyebrow: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[tone])}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={TILE.EYEBROW}>{eyebrow}</span>
        <span className={TILE.VALUE}>{children}</span>
        <span className={TILE.CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

/**
 * The band's non-tile reading: one tile SPANNING the grid.
 *
 * Three identical "couldn't read" tiles would be one message repeated three
 * times, and a shimmer held over a dead poll is a promise the page cannot keep.
 * The notice keeps the family box and goes neutral instead — same `TILE.ROOT`,
 * same `TILE.BODY`, same disc — so it reads as this band saying something rather
 * than as a second vocabulary for the same event.
 *
 * The action slot is what closes finding 6: both hooks export `refresh` and
 * neither card ever destructured it, so a failed GET left a permanent skeleton
 * with no way out of it at all.
 */
function NoticeTile({
  glyph: Glyph,
  title,
  body,
  action,
}: {
  glyph: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY, NOTICE_SPAN)} role="status">
      <span className={cn(TILE.DISC, DISC_TONE.neutral)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={NOTICE_TITLE}>{title}</span>
        <span className={TILE.CAPTION}>{body}</span>
      </div>
      {action}
    </div>
  );
}

export interface TtlMtuStripProps {
  /** The TTL endpoint's reading. `null` when it has not answered. */
  ttl: TtlStripReading | null;
  /** The MTU endpoint's reading. `null` when it has not answered. */
  mtu: MtuStripReading | null;
  /**
   * Per-endpoint pending flags, and they are separate on purpose.
   *
   * The band composes TWO reads that resolve independently, so "no reading yet"
   * and "asked and got nothing" are different sentences and the tile has to know
   * which one is true of ITS endpoint. Collapsing them into one page-level
   * `isLoading` is how a tile ends up captioned "didn't answer" over a request
   * that is still in flight — a confident statement about a question that has
   * not been answered yet, which is the same class of defect as the `autostart`
   * tile this band dropped.
   */
  ttlPending: boolean;
  mtuPending: boolean;
  /**
   * Whether anything is overriding the carrier, and the chip role that says so.
   *
   * Both are derived in the SHELL rather than here, because the answer spans two
   * endpoints and the shell is the only component holding both. `stateBadge`
   * travels as a resolved `BadgeVariant` from the module's typed `STATE_BADGE`
   * map, so a new state without a matching chip role fails the build instead of
   * rendering an untinted chip.
   */
  state: TtlMtuState;
  stateBadge: BadgeVariant;
  /** Re-runs both GETs. Wired even when only one of them failed. */
  onRetry: () => void;
}

export function TtlMtuStrip({
  ttl,
  mtu,
  ttlPending,
  mtuPending,
  state,
  stateBadge,
  onRetry,
}: TtlMtuStripProps) {
  const { t } = useTranslation("common");

  const ttlReady = ttl !== null;
  const mtuReady = mtu !== null;
  const anyReady = ttlReady || mtuReady;

  const ttlActive = ttlReady && ttl.ttl > 0;
  const hlActive = ttlReady && ttl.hl > 0;
  const mtuActive = mtuReady && mtu.isEnabled;

  // Both endpoints answered and neither is overriding anything. That is a real
  // reading, not an absence, and it deserves a sentence rather than three tiles
  // of dashes — a blank pretending to be data is exactly what this band exists
  // to stop. The tiles come back the moment ANY override is in force, which is
  // also the only moment the MTU figure is worth a column of its own.
  const nothingInForce = ttlReady && mtuReady && state === "default";

  const retryAction = (
    <Button
      type="button"
      variant="outline"
      onClick={() => onRetry()}
      className={NOTICE_ACTION}
    >
      <RefreshCcwIcon className={CHIP_GLYPH} aria-hidden="true" />
      {t(`${K}.strip.retry`)}
    </Button>
  );

  return (
    <section aria-label={t(`${K}.strip.label`)} className="flex flex-col gap-2">
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.strip.label`)}</span>
        {/* The chip is a property of the READING, so it does not render when
            there is no reading for it to be a property of. */}
        {anyReady ? (
          <Badge variant={stateBadge}>
            {state === "custom" ? (
              <CheckCircle2Icon className={BAND.GLYPH} aria-hidden="true" />
            ) : (
              <MinusCircleIcon className={BAND.GLYPH} aria-hidden="true" />
            )}
            {t(STATE_LABEL_KEY[state])}
          </Badge>
        ) : null}
      </div>

      <div className={TILE.GRID}>
        {!anyReady && (ttlPending || mtuPending) ? (
          // Three skeletons in the SAME grid, mirroring the pin BY IMPORT rather
          // than by a restated number (The Skeleton-Mirror Rule). The retired
          // card promised `h-8 w-48` plus two `h-10` boxes against a form that
          // resolves to nothing of the kind.
          Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
          ))
        ) : !anyReady ? (
          <NoticeTile
            glyph={CircleAlertIcon}
            title={t(`${K}.strip.unavailable_title`)}
            body={t(`${K}.strip.unavailable_body`)}
            action={retryAction}
          />
        ) : nothingInForce ? (
          <NoticeTile
            glyph={MinusCircleIcon}
            title={t(`${K}.strip.idle_title`)}
            body={t(`${K}.strip.idle_body`)}
          />
        ) : (
          <>
            <Tile
              glyph={RouteIcon}
              tone={ttlActive ? "success" : "neutral"}
              eyebrow={t(`${K}.tiles.ttl.label`)}
              caption={
                !ttlReady
                  ? t(
                      ttlPending
                        ? `${K}.tiles.shared.caption_pending`
                        : `${K}.tiles.shared.caption_unread`,
                    )
                  : ttlActive
                    ? t(`${K}.tiles.ttl.caption_active`)
                    : t(`${K}.tiles.ttl.caption_idle`)
              }
            >
              <span className={TILE.VALUE_TEXT}>
                {ttlActive ? ttl.ttl : VALUE_NONE}
              </span>
            </Tile>

            <Tile
              glyph={WaypointsIcon}
              tone={hlActive ? "success" : "neutral"}
              eyebrow={t(`${K}.tiles.hl.label`)}
              caption={
                !ttlReady
                  ? t(
                      ttlPending
                        ? `${K}.tiles.shared.caption_pending`
                        : `${K}.tiles.shared.caption_unread`,
                    )
                  : hlActive
                    ? t(`${K}.tiles.hl.caption_active`)
                    : t(`${K}.tiles.hl.caption_idle`)
              }
            >
              <span className={TILE.VALUE_TEXT}>
                {hlActive ? ttl.hl : VALUE_NONE}
              </span>
            </Tile>

            <Tile
              glyph={PackageIcon}
              tone={mtuActive ? "success" : "neutral"}
              eyebrow={t(`${K}.tiles.mtu.label`)}
              caption={
                !mtuReady
                  ? t(
                      mtuPending
                        ? `${K}.tiles.shared.caption_pending`
                        : `${K}.tiles.shared.caption_unread`,
                    )
                  : mtuActive
                    ? t(`${K}.tiles.mtu.caption_active`, {
                        carrier: CARRIER_DEFAULT_MTU,
                      })
                    : t(`${K}.tiles.mtu.caption_idle`)
              }
            >
              {/* No figure without a read. `mtu.sh` substitutes 1500 for a
                  failed interface read, so the only thing this tile can honestly
                  gate on is whether the endpoint answered at all. */}
              {mtuReady ? (
                <>
                  <span className={TILE.VALUE_TEXT}>{mtu.currentValue}</span>
                  {/* "bytes" is a UNIT, which is metadata about the figure, so
                      it is a Tag and never a Badge — a filled chip says whether
                      a thing is well, and a byte is neither. */}
                  <Tag variant="neutral">{t(`${K}.tiles.mtu.unit`)}</Tag>
                </>
              ) : (
                <span className={TILE.VALUE_TEXT}>{VALUE_NONE}</span>
              )}
            </Tile>
          </>
        )}
      </div>
    </section>
  );
}

export default TtlMtuStrip;
