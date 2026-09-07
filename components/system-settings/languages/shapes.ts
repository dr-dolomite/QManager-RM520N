// =============================================================================
// Languages — the /system-settings/languages family's geometry and tone contract
// =============================================================================
// Shared names are imported and re-exported from `../shapes.ts` one level up;
// only what this surface invents is here, and never anything from a sibling.
// =============================================================================

import type { LucideIcon } from "lucide-react";
import {
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  CloudOffIcon,
  DownloadIcon,
  GlobeIcon,
  LanguagesIcon,
} from "lucide-react";

import {
  BAND,
  CAPTION,
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_ON_TONAL,
  COARSE_TARGET,
  CONDITION,
  CONDITION_PANEL,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FOCUS_RING,
  GROUP_FILL,
  META_INK_ON_TONAL,
  NOTICE,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  ROW_GROUP,
  SKELETON as FAMILY_SKELETON,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
  type DiscTone,
} from "../shapes";

export {
  BAND,
  CAPTION,
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_ON_TONAL,
  COARSE_TARGET,
  CONDITION,
  CONDITION_PANEL,
  DISC_TONE,
  DISC_TRANSITION,
  EYEBROW,
  FOCUS_RING,
  GROUP_FILL,
  META_INK_ON_TONAL,
  NOTICE,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_ACTION,
  PILL_GLYPH,
  ROW_GROUP,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
};
export type { DiscTone };

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/**
 * The anchor card — Display language, so it takes the hero radius. The whisper
 * is important-marked because `twMerge` reads an arbitrary shadow as a colour
 * and cannot dedupe it against `card.tsx`'s own `shadow-sm`.
 */
export const CARD_SHELL_HERO =
  "@container/card gap-5 rounded-hero border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** The one spin class, so a face carrying `spin` has one spelling to reach. */
export const SPIN = "animate-spin";

/** The lucide glyph inside a `Badge` — `size-3`, written out for `Tag` too. */
export const CHIP_GLYPH = "size-3";

/** A version string is an identifier the publisher emits, so it rides mono. */
export const MONO_TAG = "font-mono tabular-nums";

/**
 * A `Tag` riding a PROMOTED row. Its own neutral border and ink are measured
 * against `surface`, so on a `primary-container` row it is nearly the ground it
 * sits on. Re-grounded on the row's own ink, and the ink inherited outright.
 */
export const TAG_ON_TONAL = `${CHIP_ON_TONAL} border-transparent text-current`;

// -----------------------------------------------------------------------------
// The display-language rows
// -----------------------------------------------------------------------------

/**
 * The row track list, worn by `ROW_GROUP` itself. A PLAIN two-column flip,
 * never `auto-fit`/`minmax`: given an indefinite available width `auto-fit`
 * resolves to a SINGLE track, whatever the group is re-parented into.
 */
export const LANG_GRID = "grid grid-cols-1 @2xl/card:grid-cols-2";

/**
 * One selectable language. `ROOT` is PINNED at 52px rather than floored so the
 * skeleton can mirror it; `TRANSITION` names its two properties rather than
 * sweeping, and reads the duration from the scale so a retune reaches it.
 */
export const LANG_ROW = {
  ROOT: "flex h-[3.25rem] w-full min-w-0 items-center gap-3 rounded-tile px-4 text-left",
  /** The 20px selection ring. Its stroke is the row's own ink. */
  MARK: "grid size-5 flex-none place-items-center rounded-pill border-2 border-current",
  /** A resting ring takes the dim ink; a promoted one inherits the row's. */
  MARK_REST: "text-on-surface-variant",
  MARK_DOT: "size-2.5 rounded-pill bg-current",
  /** The spinner standing in for the dot while this row's pack loads. */
  MARK_GLYPH: "size-3",
  /** Highlight-by-Container: the active row IS the primary container. */
  ACTIVE: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
  TEXT: "flex min-w-0 flex-1 flex-col justify-center",
  NATIVE: "truncate text-[0.9375rem] font-semibold",
  /** Ink is applied at the call site: a promoted row owns its own dim step. */
  ENGLISH: "hidden truncate text-[0.8125rem] @xl/card:block",
  META: "flex flex-none items-center gap-1.5",
  /** The Remove affordance. 32px painted, 44px reachable via `COARSE_TARGET`. */
  REMOVE: "grid size-8 flex-none place-items-center rounded-pill",
  /** Its hover ground, per host: the promoted row has no neutral to reach for. */
  REMOVE_REST: "hover:bg-surface-container-high",
  REMOVE_ACTIVE: "hover:bg-on-primary-container/20",
  REMOVE_GLYPH: "size-4",
} as const;

// -----------------------------------------------------------------------------
// The community pack rows
// -----------------------------------------------------------------------------

/**
 * One community pack. A FLOOR, not a pin: the meta cluster wraps to a second
 * line on a narrow card and a fixed height would clip it.
 */
export const PACK_ROW = {
  ROOT: "flex min-w-0 flex-col gap-3 rounded-tile px-4 py-3.5 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1.5",
  NAMES: "flex min-w-0 flex-col",
  NATIVE: "truncate text-[0.9375rem] font-semibold",
  ENGLISH: "text-on-surface-variant truncate text-[0.8125rem]",
  META: "flex flex-wrap items-center gap-1.5",
  /** The action cluster. `@2xl/card:ml-auto` right-aligns only side by side. */
  ACTION: "flex min-w-0 flex-none items-center gap-2 @2xl/card:ml-auto",
  /** The failure notice hangs under its row, keeping the row's inset. */
  SLOT: "px-1 pb-1",
} as const;

/**
 * The install meter — the one place `progress` (0-100) is rendered at all.
 * The percentage is a reading, so `tabular-nums` in the UI face, never mono.
 */
export const METER = {
  // A DEFINITE width, not `flex-1`: the meter rides the row's `flex-none`
  // action cluster, which is shrink-to-fit, and a percentage width there has
  // nothing to resolve against.
  ROOT: "flex w-[13rem] min-w-0 max-w-full flex-col gap-1.5",
  HEAD: "flex min-w-0 items-center gap-2",
  STEP: "text-on-surface-variant min-w-0 flex-1 truncate text-xs",
  PCT: "text-on-surface-variant flex-none text-xs tabular-nums",
  TRACK: "h-1.5 w-full overflow-hidden rounded-pill bg-surface-container-high",
  FILL: "h-full rounded-pill bg-primary",
} as const;

/**
 * The manual-SSH recovery command. `select-all` so one click hands the whole
 * line to the clipboard shortcut as well as to the copy button.
 */
export const CMD =
  "w-full max-w-full overflow-x-auto rounded-field bg-surface-container-high px-4 py-3 text-left font-mono text-xs leading-relaxed break-words select-all";

/**
 * The unreachable-catalog state: the block, with the device's own status text
 * beneath it. The raw text stays machine voice rather than being folded into
 * the sentence — a backend string does not translate.
 */
export const ERROR_STATE = {
  ROOT: "flex min-h-0 flex-1 flex-col gap-2.5",
  DETAIL:
    "text-on-surface-variant break-words px-1 font-mono text-xs leading-relaxed",
} as const;

/**
 * The install-failure block. The command box sits BELOW the notice rather than
 * inside it: `CMD` is `surface-container-high`, one step above the row group it
 * hangs in, and inside a `destructive-container` notice that step is a hole.
 */
export const FAILURE = {
  ROOT: "flex min-w-0 flex-col gap-2",
  MANUAL: "flex min-w-0 flex-col gap-1.5",
  HINT: "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
} as const;

// -----------------------------------------------------------------------------
// Faces
// -----------------------------------------------------------------------------

/**
 * A tile's face: ONE state union, ONE `Record`-typed map. Every state carries
 * its OWN glyph — the disc fills do not separate under deuteranopia, so the
 * glyph is the only thing a tile has.
 */
export interface Face {
  tone: DiscTone;
  glyph: LucideIcon;
}

/** The display tile has ONE state: a language is always selected. */
export const DISPLAY_FACE: Face = { tone: "primary", glyph: LanguagesIcon };

/** The ready tile has ONE state: a tally is never healthy or unhealthy. */
export const READY_FACE: Face = { tone: "neutral", glyph: CheckCircle2Icon };

export type CatalogState = "unreachable" | "none" | "available" | "updates";

export const CATALOG_FACE: Record<CatalogState, Face> = {
  // `warning`, not `destructive`: a catalog nobody has published yet, or a
  // device with no route to GitHub, is not a fault in this modem.
  unreachable: { tone: "warning", glyph: CloudOffIcon },
  none: { tone: "neutral", glyph: GlobeIcon },
  // Both are `primary`, so the two glyphs are the only separator between
  // "there is something new" and "something you have is out of date".
  available: { tone: "primary", glyph: DownloadIcon },
  updates: { tone: "primary", glyph: ArrowUpCircleIcon },
};

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/**
 * Line boxes — a rendered line's HEIGHT, never its font size. A line of
 * 15px/normal occupies 22px, and 22px is what stands in for it.
 */
const LINE = {
  /** `CARD_TITLE` (18px/tight) and the row's native name (15px). */
  LABEL: "h-[1.375rem] rounded-inline",
  /** `CARD_DESC` and the row's English name at 13px. */
  DETAIL: "h-[1.25rem] rounded-inline",
} as const;

/**
 * Every placeholder reads its geometry from the loaded view's own constant, so
 * a height cannot drift out from under its skeleton. The band's skeleton wears
 * the real `TILE.ROOT` and a language row's wears the real `LANG_ROW.ROOT`,
 * which is why there is no box mirror here.
 */
export const SKELETON = {
  /** The status band's three tiles, reused verbatim from the family. */
  TILE: FAMILY_SKELETON.TILE,
  CARD: {
    TITLE: `${LINE.LABEL} w-48`,
    DESC: `${LINE.DETAIL} w-80 max-w-full`,
  },
  /** A language row: the mark ring, the name, and the meta chip. */
  LANG: {
    MARK: "size-5 flex-none rounded-pill",
    NATIVE: `${LINE.LABEL} w-28`,
    CHIP: "h-[1.375rem] w-16 rounded-pill",
  },
  /** A pack row: two name lines, three meta chips and the action pill. */
  PACK: {
    NATIVE: `${LINE.LABEL} w-32`,
    ENGLISH: `${LINE.DETAIL} w-24`,
    CHIP: "h-[1.375rem] w-20 rounded-pill",
    ACTION: "h-[2.625rem] w-28 rounded-pill",
  },
  /** The header's Refresh pill. Absent, the head jumps by 42px plus its gap. */
  ACTION: "h-[2.625rem] w-32 rounded-pill",
} as const;
