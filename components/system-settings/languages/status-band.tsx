"use client";

import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { SwapLabel } from "@/components/ui/swap-label";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerItem, staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  activeLanguage,
  catalogState,
  readyCount,
  updateCount,
  type CatalogView,
} from "./derive";
import {
  BAND,
  CAPTION,
  CATALOG_FACE,
  DISC_TONE,
  DISC_TRANSITION,
  DISPLAY_FACE,
  EYEBROW,
  READY_FACE,
  SKELETON,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
  type DiscTone,
} from "./shapes";

const K = "languages.band";

// -----------------------------------------------------------------------------
// Tile
// -----------------------------------------------------------------------------

interface TileProps {
  glyph: LucideIcon;
  tone: DiscTone;
  eyebrow: string;
  value: React.ReactNode;
  caption: string;
}

function Tile({
  glyph: Glyph,
  tone,
  eyebrow,
  value,
  caption,
}: TileProps): React.JSX.Element {
  return (
    <motion.div variants={staggerRowItem} className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[tone])}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>{value}</span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </motion.div>
  );
}

function TileSkeleton(): React.JSX.Element {
  return (
    <motion.div variants={staggerRowItem} className={cn(TILE.ROOT, TILE.BODY)}>
      <Skeleton className={SKELETON.TILE.DISC} />
      <div className={TILE.TEXT}>
        <Skeleton className={cn(SKELETON.TILE.EYEBROW, "w-24")} />
        <Skeleton className={cn(SKELETON.TILE.VALUE, "w-28")} />
        <Skeleton className={cn(SKELETON.TILE.CAPTION, "w-36")} />
      </div>
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// Band
// -----------------------------------------------------------------------------

export interface StatusBandProps {
  view: CatalogView;
  activeCode: string;
  isLoading: boolean;
  /** Non-null when the list GET failed or the device couldn't reach GitHub. */
  catalogError: string | null;
}

export function StatusBand({
  view,
  activeCode,
  isLoading,
  catalogError,
}: StatusBandProps): React.JSX.Element {
  const { t } = useTranslation("system-settings");

  // --- Display language ----------------------------------------------------
  const active = activeLanguage(activeCode, view);
  const displayValue = active?.nativeName ?? VALUE_NONE;
  const displayCaption = active
    ? t(`${K}.display.caption_${active.provenance}`, { code: active.code })
    : t(`${K}.display.caption_unknown`);

  // --- Ready to use --------------------------------------------------------
  const ready = readyCount(view);
  const readyCaption =
    ready.downloaded > 0
      ? t(`${K}.ready.caption_with_downloaded`, {
          count: ready.downloaded,
          builtIn: ready.builtIn,
        })
      : t(`${K}.ready.caption_built_in`, { count: ready.builtIn });

  // --- Community catalog ---------------------------------------------------
  const catalog = catalogState({ error: catalogError, view });
  const updates = updateCount(view);
  const catalogFace = CATALOG_FACE[catalog];

  const catalogValue =
    catalog === "unreachable"
      ? t(`${K}.catalog.value_unreachable`)
      : catalog === "none"
        ? VALUE_NONE
        : catalog === "updates"
          ? String(updates)
          : String(view.available.length);

  const catalogCaption =
    catalog === "updates"
      ? t(`${K}.catalog.caption_updates`, { count: updates })
      : t(`${K}.catalog.caption_${catalog}`);

  return (
    <motion.section variants={staggerItem}>
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.head`)}</span>
      </div>

      <motion.div
        className={TILE.GRID}
        variants={staggerRows}
        aria-live="polite"
        aria-busy={isLoading}
      >
        {isLoading ? (
          <>
            <TileSkeleton />
            <TileSkeleton />
            <TileSkeleton />
          </>
        ) : (
          <>
            <Tile
              glyph={DISPLAY_FACE.glyph}
              tone={DISPLAY_FACE.tone}
              eyebrow={t(`${K}.display.eyebrow`)}
              value={
                <SwapLabel swapKey={active?.code ?? "none"}>
                  <span className={VALUE_TEXT}>{displayValue}</span>
                </SwapLabel>
              }
              caption={displayCaption}
            />
            <Tile
              glyph={READY_FACE.glyph}
              tone={READY_FACE.tone}
              eyebrow={t(`${K}.ready.eyebrow`)}
              value={<span className={VALUE_TEXT}>{ready.total}</span>}
              caption={readyCaption}
            />
            <Tile
              glyph={catalogFace.glyph}
              tone={catalogFace.tone}
              eyebrow={t(`${K}.catalog.eyebrow`)}
              value={<span className={VALUE_TEXT}>{catalogValue}</span>}
              caption={catalogCaption}
            />
          </>
        )}
      </motion.div>
    </motion.section>
  );
}

export default StatusBand;
