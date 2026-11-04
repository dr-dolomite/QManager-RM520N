import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// =============================================================================
// Scenario identity glyphs
// =============================================================================
// A scenario's identity is carried by its GLYPH, not by colour. This replaced a
// 12-entry raw-Tailwind gradient palette (`from-violet-600 via-purple-600 …`)
// that sat outside the token system entirely and could not follow the theme.
//
// Glyph rather than colour is not just token hygiene. Every custom scenario
// previously rendered the same `Sparkles` icon, so the gradient was the ONLY
// thing telling two of them apart — which meant the identity channel was one a
// colour-blind user could not read at all, and one that vanished the moment the
// tile was viewed in sunlight. A glyph survives both.
//
// The `id` is what gets persisted, never the component. Storing a stable key
// means the icon set can be re-drawn, renamed or re-ordered without rewriting
// records already on device flash.
//
// Adding an entry is safe and needs no migration. REMOVING one is not: records
// referencing a dropped id fall back to `Sparkles`, silently losing the user's
// choice. Prefer re-pointing a retired id at a replacement glyph.
// =============================================================================

export interface ScenarioIconOption {
  /** Stable persisted key. Never rename one that has shipped. */
  id: string;
  icon: MaterialSymbolName;
  /** i18n key for the picker tooltip / aria-label, under `scenarios.icons.*`.
   *  Resolved with `t()` at render time — this is a module-level array, so it
   *  cannot hold a translated string directly. */
  labelKey: string;
}

export const SCENARIO_ICONS: ScenarioIconOption[] = [
  { id: "sparkles", icon: "auto_awesome", labelKey: "scenarios.icons.sparkles" },
  { id: "gamepad", icon: "sports_esports", labelKey: "scenarios.icons.gamepad" },
  { id: "play", icon: "play_arrow", labelKey: "scenarios.icons.play" },
  { id: "zap", icon: "bolt", labelKey: "scenarios.icons.zap" },
  { id: "globe", icon: "public", labelKey: "scenarios.icons.globe" },
  { id: "rocket", icon: "rocket_launch", labelKey: "scenarios.icons.rocket" },
  { id: "video", icon: "videocam", labelKey: "scenarios.icons.video" },
  { id: "download", icon: "download", labelKey: "scenarios.icons.download" },
  { id: "shield", icon: "shield", labelKey: "scenarios.icons.shield" },
  { id: "plane", icon: "airplanemode_active", labelKey: "scenarios.icons.plane" },
  { id: "moon", icon: "dark_mode", labelKey: "scenarios.icons.moon" },
  { id: "briefcase", icon: "work", labelKey: "scenarios.icons.briefcase" },
];

/** The glyph used when a stored scenario has no `icon`, or an unknown one. */
export const DEFAULT_SCENARIO_ICON_ID = "sparkles";

/**
 * Resolve a persisted icon id to its ligature name.
 *
 * Falls back rather than throwing on purpose: scenarios saved before the icon
 * field existed carry no `icon` at all, and they must still render. Those
 * records are the reason this is total instead of a plain map lookup.
 */
export function resolveScenarioIcon(id: string | undefined): MaterialSymbolName {
  const match = SCENARIO_ICONS.find((opt) => opt.id === id);
  return match ? match.icon : "auto_awesome";
}
