import {
  BriefcaseIcon,
  DownloadIcon,
  Gamepad2Icon,
  GlobeIcon,
  MoonIcon,
  PlaneIcon,
  PlayIcon,
  RocketIcon,
  ShieldIcon,
  SparklesIcon,
  VideoIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

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
  Icon: LucideIcon;
  /** Picker tooltip / aria-label. */
  label: string;
}

export const SCENARIO_ICONS: ScenarioIconOption[] = [
  { id: "sparkles", Icon: SparklesIcon, label: "Sparkles" },
  { id: "gamepad", Icon: Gamepad2Icon, label: "Gaming" },
  { id: "play", Icon: PlayIcon, label: "Media" },
  { id: "zap", Icon: ZapIcon, label: "Performance" },
  { id: "globe", Icon: GlobeIcon, label: "Browsing" },
  { id: "rocket", Icon: RocketIcon, label: "Speed" },
  { id: "video", Icon: VideoIcon, label: "Video calls" },
  { id: "download", Icon: DownloadIcon, label: "Downloads" },
  { id: "shield", Icon: ShieldIcon, label: "Secure" },
  { id: "plane", Icon: PlaneIcon, label: "Travel" },
  { id: "moon", Icon: MoonIcon, label: "Overnight" },
  { id: "briefcase", Icon: BriefcaseIcon, label: "Work" },
];

/** The glyph used when a stored scenario has no `icon`, or an unknown one. */
export const DEFAULT_SCENARIO_ICON_ID = "sparkles";

/**
 * Resolve a persisted icon id to its component.
 *
 * Falls back rather than throwing on purpose: scenarios saved before the icon
 * field existed carry no `icon` at all, and they must still render. Those
 * records are the reason this is total instead of a plain map lookup.
 */
export function resolveScenarioIcon(id: string | undefined): LucideIcon {
  const match = SCENARIO_ICONS.find((opt) => opt.id === id);
  return match ? match.Icon : SparklesIcon;
}
