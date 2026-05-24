// ─── Signal Storm — label bundle ─────────────────────────────────────────────
// Pure TS. The engine reads these at draw time. RM520N has no i18n setup, so
// strings are hard-coded English to match the rest of the project's UI copy.
// Shape preserved so the engine/boss modules can consume `GameLabels` unchanged.

export interface GameLabels {
  hud: {
    score: string;
    best: string;
    wave: string;
  };
  power_ups: {
    /** Prefix only. Suffix " Ns" is concatenated by the engine. */
    rapid_fire: string;
    /** Prefix only. Suffix " Ns" is concatenated by the engine. */
    spread: string;
    shield: string;
  };
  pause: {
    title: string;
    resume_hint: string;
  };
  game_over: {
    title: string;
    score_label: string;
    new_high_score: string;
    /** Prefix only. Suffix " N" is concatenated by the engine. */
    best_prefix: string;
    controls_hint: string;
  };
  boss_defeated: string;
  muted: string;
  boss_names: Record<1 | 2 | 3 | 4 | 5, string>;
  boss_subtitles: Record<1 | 2 | 3 | 4 | 5, string>;
}

export const GAME_LABELS: GameLabels = {
  hud: {
    score: "Score",
    best: "Best",
    wave: "Wave",
  },
  power_ups: {
    rapid_fire: "Rapid Fire",
    spread: "Spread Shot",
    shield: "Shield",
  },
  pause: {
    title: "Paused",
    resume_hint: "Press P to resume",
  },
  game_over: {
    title: "Game Over",
    score_label: "Final Score",
    new_high_score: "New High Score!",
    best_prefix: "Best",
    controls_hint: "Press R to retry  ·  Esc to exit",
  },
  boss_defeated: "Boss Defeated!",
  muted: "Muted",
  boss_names: {
    1: "Jammer",
    2: "Disruptor",
    3: "Interceptor",
    4: "Saboteur",
    5: "Overlord",
  },
  boss_subtitles: {
    1: "Tier 1 — Signal Noise",
    2: "Tier 2 — Frequency Hijacker",
    3: "Tier 3 — Spectrum Killer",
    4: "Tier 4 — Phase Inverter",
    5: "Tier 5 — Final Storm",
  },
};
