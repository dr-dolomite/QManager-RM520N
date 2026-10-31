// Onboarding family shapes: the single-card shell and the selection row every choice step shares.
// A row rests on surface-container; the chosen row is promoted to primary-container (Highlight-by-Container).

/** The wizard's one card. Onboarding runs its own single-card shell, not a feature page. */
export const SHELL_CARD =
  "card-sheen bg-card text-card-foreground flex flex-col gap-8 rounded-hero border-0 px-6 py-8 shadow-[var(--shadow-whisper)] sm:px-10 sm:py-10";

/** Step heading block. */
export const STEP_HEADING = "text-2xl font-semibold tracking-tight text-balance";
export const STEP_DESCRIPTION = "text-sm text-on-surface-variant text-pretty";

/** Section label over a run of rows (Group-Before-You-Pad Rule). */
export const SECTION_LABEL = "text-xs font-medium text-on-surface-variant";

const ROW_BASE =
  "flex w-full items-center text-left rounded-tile outline-none transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-60";

/** A selectable row; `selected` promotes it one container step. */
export function optionRow(selected: boolean, size: "lg" | "sm" = "lg"): string {
  return [
    ROW_BASE,
    size === "lg" ? "min-h-16 gap-4 px-4 py-3" : "min-h-12 gap-3 px-3.5 py-2.5",
    selected
      ? "bg-primary-container text-on-primary-container"
      : "bg-surface-container text-on-surface hover:bg-surface-container-high",
  ].join(" ");
}

/** Secondary line inside a row: quiet on rest, the container's own ink when chosen. */
export function optionDetail(selected: boolean): string {
  return selected ? "text-on-primary-container/80" : "text-on-surface-variant";
}

/** The 32px glyph disc leading a large row. */
export function optionDisc(selected: boolean): string {
  return [
    "grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-[var(--duration-quick)] ease-out",
    selected
      ? "bg-primary text-primary-foreground"
      : "bg-surface-container-high text-on-surface-variant",
  ].join(" ");
}

/** The radio dot: an outline at rest, a filled ring when chosen. */
export function optionDot(selected: boolean): string {
  return [
    "grid size-4 shrink-0 place-items-center rounded-full border-2 transition-colors duration-[var(--duration-quick)] ease-out",
    selected ? "border-primary" : "border-on-surface-variant",
  ].join(" ");
}

/** Inner fill of the chosen dot. */
export const OPTION_DOT_FILL = "block size-2 rounded-full bg-primary";

/** The one inner container a step may hold (One-Nest Rule). */
export const INNER_TILE = "rounded-tile bg-surface-container p-3";
