"use client";

import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";

import {
  BADGE_GLYPH_SIZE,
  SIGNAL_BADGE,
  networkIdentity,
  signalTier,
  type SignalTier,
} from "./shapes";

// =============================================================================
// The two chips every scan row carries
// =============================================================================
// Both are shared by the full scan and the neighbour read, which is why the
// thresholds, tones and glyphs live in `shapes.ts` rather than in the branches
// below: one vocabulary for "fair" across the whole family.
//
// The tiers were previously inlined here as a three-branch `if` on raw dBm, with
// no `none` case at all — so a neighbour cell reporting 0 dBm for an unmeasured
// port rendered as "Bad", which is a verdict rather than the absence of one.
// =============================================================================

/**
 * Signal quality, told apart by GLYPH first and tone second.
 *
 * `success-container` and `warning-container` measure 1.03:1 apart — the same
 * surface to the eye and identical under deuteranopia — so Good and Fair cannot
 * be separated by fill. The bar count survives a colourblind reader, a greyscale
 * print, and the modem's own low-contrast field display.
 */
export function SignalBadge({ strength }: { strength: number | null }) {
  const { t } = useTranslation("cellular");
  const tier = signalTier(strength);
  const spec = SIGNAL_BADGE[tier];

  // Literal key stems. `i18n:check` grades a missing key as a warning and exits
  // 0, so an interpolated stem is a key nothing will ever report on.
  const LABEL_KEY: Record<SignalTier, string> = {
    good: "cell_scanner.signal.good",
    fair: "cell_scanner.signal.fair",
    poor: "cell_scanner.signal.poor",
    none: "cell_scanner.signal.none",
  };

  return (
    <Badge variant={spec.variant}>
      <MaterialSymbol name={spec.glyph} size={BADGE_GLYPH_SIZE} />
      {t(LABEL_KEY[tier])}
    </Badge>
  );
}

/**
 * Which RADIO the row belongs to. An IDENTITY tag, never a status role.
 *
 * This shipped as `variant="default"` — solid `bg-primary`, the brand's one
 * acting colour — for BOTH radios at once. Identity was unreadable (LTE and NR
 * rows looked identical), and a passive label wearing the primary fill
 * advertised a click target it does not have.
 *
 * It is now an outline `Tag` rather than a filled `Badge`, which is the whole
 * reason this file imports both forms: the row's quality verdict beside it is a
 * filled chip with a glyph, and "NR" is not a verdict (The Two-Form Rule). The
 * exported name is left alone on purpose — renaming it would touch four
 * unrelated table files for no reader-visible gain.
 */
export function NetworkTypeBadge({ type }: { type: string }) {
  return <Tag variant={networkIdentity(type)}>{type}</Tag>;
}
