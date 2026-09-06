// System Health Check — geometry, tone and face contract for this one surface.
// It deliberately RESTATES the family's numbers rather than importing them: a
// sibling shape module is not a shared library, the design system's numbers are.

import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2Icon,
  ClockIcon,
  DownloadIcon,
  ListChecksIcon,
  Loader2Icon,
  MinusCircleIcon,
  OctagonAlertIcon,
  PackageIcon,
  ServerOffIcon,
  StethoscopeIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";

import type { BadgeVariant } from "@/components/ui/badge";
import type {
  TestCategory,
  TestStatus,
} from "@/types/system-health-check";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/** The page header: titles left, actions pushed right once the page is wide. */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

/** The 42px action pill. Restated per family, never imported across one. */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/** The lucide glyph inside an action pill. */
export const PILL_GLYPH = "size-4";

/** The lucide glyph inside a `Badge` — `size-3`, written out for `Tag` too. */
export const CHIP_GLYPH = "size-3";

/** The one spin class, so a `Face` carrying `spin` has one spelling to reach. */
export const SPIN = "animate-spin";

// -----------------------------------------------------------------------------
// The status band
// -----------------------------------------------------------------------------

/** The band header: label left, an optional state chip pushed right. */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  GLYPH: "size-3",
} as const;

/**
 * The tile box. `ROOT` is PINNED at 104px, never a `min-h-` floor — a floor
 * resolves to its content and cannot mirror a skeleton.
 */
export const TILE = {
  GRID: "grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  BODY: "bg-surface-container text-on-surface",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The glyph inside DISC — 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/**
 * Disc fills, and the only colour on the band. Each is a FILL pair, never a
 * container pair — pale containers collapse under deuteranopia, fills do not.
 */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  primary: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  destructive: "bg-destructive text-destructive-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The tone transition for a disc that changes mid-run. Scoped to two named
 * properties, and every custom property takes `var()` — the naked arbitrary
 * shorthand compiles to a declaration the browser discards.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/** The eyebrow above a tile's figure. `uppercase` lives HERE, never in a leaf. */
export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** The figure. `tabular-nums` in the UI face — a count is a reading, not an ID. */
export const VALUE =
  "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums";

/** The truncating text child of a `VALUE` box. */
export const VALUE_TEXT = "truncate";

/** The caption under a figure. ONE spelling. */
export const CAPTION = "text-on-surface-variant truncate text-xs";

/** The placeholder for a figure with no reading — needs no translator. */
export const VALUE_NONE = "—";

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

/**
 * The peer card shell. `border-0` is explicit: a tonal surface never also
 * carries a hairline. The whisper is important-marked because `twMerge` reads an
 * arbitrary shadow as a colour and cannot dedupe it against `card.tsx`.
 */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** The anchor card on this surface — "Needs attention" — at the hero radius. */
export const CARD_SHELL_HERO =
  "@container/card gap-5 rounded-hero border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, matching every sibling surface. */
export const CARD_PAD = "px-7";

/** `CardTitle` takes its size from the call site; unsized it flattens the ramp. */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink, so the ink is written here. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** A card body stacking more than one block — a notice above its row groups. */
export const CARD_STACK = "flex min-h-0 flex-1 flex-col gap-3.5";

// -----------------------------------------------------------------------------
// Notices
// -----------------------------------------------------------------------------

/**
 * The card-scoped notice for `job.error` — a container and its own ink as a
 * PAIR; a bare `text-warning` is a fill role's ink with nothing under it.
 */
export const NOTICE = {
  BOX: "flex items-start gap-2.5 rounded-field px-4 py-3 bg-warning-container text-on-warning-container",
  GLYPH: "mt-0.5 size-4 flex-none",
  TEXT: "text-[0.8125rem] leading-relaxed text-pretty",
  /** Backend text quoted inside a notice — machine voice, ink stepped back. */
  DETAIL: "font-mono text-xs leading-relaxed break-words opacity-90",
  /** The notice's text column, beside the glyph. */
  STACK: "flex min-w-0 flex-col gap-1",
} as const;

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

/**
 * One tonal group holding a card's rows. The group is `surface-container`, one
 * step above the card's `surface` — that ladder is what makes a borderless row
 * legible without a hairline.
 */
export const ROW_GROUP =
  "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/** A card's slack absorber: the page grid locks the cell, the group grows. */
export const GROUP_FILL = "min-h-0 flex-1";

/** The row list under a group header — one flex child, so it restates the gap. */
export const GROUP_ROWS = "flex flex-col gap-0.5";

/**
 * One finding on the "Needs attention" card. The 40px disc carries the tone and
 * the body stays neutral — colour marks the datum, not the container.
 */
export const FINDING = {
  ROOT: "flex items-start gap-3 rounded-field px-4 py-3.5",
  DISC: "grid size-10 flex-none place-items-center rounded-pill",
  /** The glyph inside DISC — 20px, half the disc. */
  GLYPH: "size-5",
  /**
   * Text and meta stack until the card can seat them side by side. The meta
   * cluster is `flex-none` and ~180px wide, so on a phone it starves the text
   * column to ~58px and the mono detail wraps one character per line.
   */
  BODY: "flex min-w-0 flex-1 flex-col gap-2 @2xl/card:flex-row @2xl/card:items-start @2xl/card:gap-3",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  META: "flex flex-none flex-wrap items-center gap-2.5",
  LABEL: "text-[0.9375rem] font-semibold",
  /** The runner's own sentence about the failure — machine voice. */
  DETAIL:
    "font-mono text-on-surface-variant text-[0.78125rem] leading-relaxed break-words",
} as const;

/** A row that IS its own disclosure target, so it needs a button's own reset. */
export const ROW_BUTTON = "w-full text-left";

/** The group header button: label and description left, tally and chevron right. */
export const GROUP_HEAD = {
  ROOT: "flex w-full items-center gap-3 rounded-field px-4 py-3 text-left",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  LABEL: "truncate text-[0.9375rem] font-semibold",
  DESC: "text-on-surface-variant truncate text-[0.78125rem]",
  META: "flex flex-none items-center gap-2.5",
} as const;

/**
 * One dense row on an "All checks" card. `ROOT` is the button itself, so the
 * whole row is the disclosure target rather than a chevron inside it.
 */
export const TEST_ROW = {
  ROOT: "flex w-full items-center gap-3 rounded-field px-4 py-2.5 text-left",
  EXPANDABLE:
    "cursor-pointer transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container-high",
  STATIC: "cursor-default",
  CHEVRON:
    "size-4 flex-none text-on-surface-variant transition-transform duration-[var(--duration-quick)] ease-out",
  /** Rotates the one chevron rather than swapping two glyphs. */
  CHEVRON_OPEN: "rotate-90",
  /** Reserves the chevron's box on a row that cannot expand. */
  CHEVRON_HOLD: "size-4 flex-none",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  LABEL: "truncate text-sm font-medium",
  DETAIL: "truncate font-mono text-on-surface-variant text-xs",
  META: "flex flex-none items-center gap-2.5",
  /** A measured duration: `tabular-nums` in the UI face, never `font-mono`. */
  DURATION: "text-on-surface-variant text-xs tabular-nums",
} as const;

/**
 * The captured-output panel. A SOLID token, never an alpha wash — an alpha over
 * a tinted surface collapses toward its ground in dark mode.
 */
export const OUTPUT = {
  PANEL: "rounded-field bg-surface-container-high px-4 py-3.5",
  PRE: "font-mono text-xs leading-relaxed whitespace-pre-wrap break-words max-h-[13.75rem] overflow-auto",
  META: "text-on-surface-variant text-xs",
  /** The truncation footer, the only child that ever stacks under the pre box. */
  TRUNCATED: "text-on-surface-variant mt-2.5 text-xs",
  FAILED: "text-destructive text-xs",
  /** The panel hangs under its row inside the group, so it keeps the row's inset. */
  SLOT: "px-1 pb-1",
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/** What lets a `ConditionBlock` fill a height-locked card rather than float in it. */
export const CONDITION_PANEL = {
  SCREEN: "min-h-0 flex-1 justify-center",
} as const;

/** The category rail inside the empty state's condition block. */
export const CONDITION_RAIL =
  "flex max-w-[34rem] flex-wrap justify-center gap-1.5";

/**
 * The empty state. `ConditionBlock` takes no children, so the tonal ground
 * moves out to `ROOT` and the block itself runs transparent over it.
 */
export const EMPTY_STATE = {
  ROOT: "flex flex-col items-center gap-3.5 rounded-hero bg-surface-container px-8 pb-10",
  BLOCK: "w-full bg-transparent px-0 pb-0",
} as const;

/** The count inside a category tag. A tally is a reading, so it aligns. */
export const TAG_COUNT = "tabular-nums";

/**
 * The error state: the block, with the device's own status text beneath it.
 * The raw text stays machine voice rather than being folded into the sentence.
 */
export const ERROR_STATE = {
  ROOT: "flex flex-col items-center gap-2.5",
  BLOCK: "w-full",
  DETAIL: "text-on-surface-variant break-words text-center font-mono text-xs",
} as const;

// -----------------------------------------------------------------------------
// Faces
// -----------------------------------------------------------------------------

/**
 * A tile's face: ONE state union, ONE `Record`-typed map. Three independent
 * ternaries let the value line, the caption and the disc disagree.
 *
 * Every state in a map carries its OWN glyph. `success-container` and
 * `warning-container` measure 1.03:1 apart and the disc fills are no easier
 * under deuteranopia, so the glyph is the only separator a tile has.
 */
export interface Face {
  tone: DiscTone;
  glyph: LucideIcon;
  spin?: boolean;
}

export type ResultState =
  | "unreachable"
  | "none"
  | "running"
  | "errored"
  | "failed"
  | "warned"
  | "passed";

export const RESULT_FACE: Record<ResultState, Face> = {
  // All three are destructive-toned, so none of them may share a glyph: the
  // device not answering, the runner giving up, and a check failing are three
  // different facts.
  unreachable: { tone: "destructive", glyph: ServerOffIcon },
  none: { tone: "neutral", glyph: StethoscopeIcon },
  running: { tone: "primary", glyph: Loader2Icon, spin: true },
  errored: { tone: "destructive", glyph: OctagonAlertIcon },
  failed: { tone: "destructive", glyph: XCircleIcon },
  warned: { tone: "warning", glyph: TriangleAlertIcon },
  passed: { tone: "success", glyph: CheckCircle2Icon },
};

/** The Checks tile has ONE state — a tally is never healthy or unhealthy. */
export const CHECKS_FACE: Face = { tone: "neutral", glyph: ListChecksIcon };

export type BundleState = "ready" | "building" | "absent";

export const BUNDLE_FACE: Record<BundleState, Face> = {
  // `primary` says the bundle is there and downloadable — never that the run
  // was healthy, which is what `success` on the result tile is for.
  ready: { tone: "primary", glyph: DownloadIcon },
  building: { tone: "neutral", glyph: Loader2Icon, spin: true },
  absent: { tone: "neutral", glyph: PackageIcon },
};

/**
 * Per-test status. Keyed onto the exported `BadgeVariant`, never a class string,
 * so a status without a matching chip role fails the build.
 */
export const TEST_STATUS_BADGE: Record<TestStatus, BadgeVariant> = {
  pass: "success",
  fail: "destructive",
  warn: "warning",
  skip: "muted",
  pending: "muted",
  running: "info",
};

/** `pending` and `skip` share the `muted` role, so their glyphs must differ. */
export const TEST_STATUS_GLYPH: Record<TestStatus, LucideIcon> = {
  pass: CheckCircle2Icon,
  fail: XCircleIcon,
  warn: TriangleAlertIcon,
  skip: MinusCircleIcon,
  pending: ClockIcon,
  running: Loader2Icon,
};

/**
 * Group-tally chips on an "All checks" card header. `pending` is the group whose
 * checks have not resolved yet — muted, because "not yet known" is not health.
 */
export const TALLY_BADGE = {
  fail: "destructive",
  warn: "warning",
  pass: "success",
  pending: "muted",
} as const satisfies Record<"fail" | "warn" | "pass" | "pending", BadgeVariant>;

/** One glyph per tally state — the chip fills alone do not separate them. */
export const TALLY_GLYPH = {
  fail: XCircleIcon,
  warn: TriangleAlertIcon,
  pass: CheckCircle2Icon,
  pending: ClockIcon,
} as const satisfies Record<keyof typeof TALLY_BADGE, LucideIcon>;

/**
 * Static per-category cardinality, counted from `qmanager_health_check`'s
 * catalog — a fixed jq literal that seeds all 43 tests before the first runs.
 */
export const CATEGORY_TEST_COUNT: Record<TestCategory, number> = {
  binaries: 10,
  permissions: 5,
  at_transport: 6,
  sms: 3,
  sudoers: 1,
  services: 6,
  network: 6,
  configuration: 6,
};

/** The catalog's size, derived from the map above so the two cannot drift. */
export const TOTAL_TESTS = Object.values(CATEGORY_TEST_COUNT).reduce(
  (sum, n) => sum + n,
  0,
);

/** The runner's own order. Stable — never re-sorted while a run is in flight. */
export const CATEGORY_ORDER: TestCategory[] = [
  "binaries",
  "permissions",
  "at_transport",
  "sms",
  "sudoers",
  "services",
  "network",
  "configuration",
];

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/**
 * Line boxes — a rendered line's HEIGHT, never its font size. A line of
 * 15px/normal occupies 22px, and 22px is what stands in for it.
 */
const LINE = {
  /** `CARD_TITLE` (18px/tight), `FINDING.LABEL` and `GROUP_HEAD.LABEL` (15px). */
  LABEL: "h-[1.375rem] rounded-inline",
  /** `TEST_ROW.LABEL` at 14px. */
  ROW_LABEL: "h-[1.25rem] rounded-inline",
  /** `FINDING.DETAIL` and `CARD_DESC` at 12.5-14px/relaxed. */
  DETAIL: "h-[1.25rem] rounded-inline",
  /** `EYEBROW` at 11px. */
  EYEBROW: "h-[1.0625rem] rounded-inline",
  /** `VALUE` at 22px with 1.1 leading. */
  VALUE: "h-[1.5rem] rounded-inline",
  /** `CAPTION` and `TEST_ROW.DETAIL` at 12px. */
  CAPTION: "h-[1.125rem] rounded-inline",
} as const;

/**
 * Every placeholder reads its geometry from the loaded view's own constant, so
 * a height cannot drift out from under its skeleton. The band's skeleton wears
 * the real `TILE.ROOT`, which is why there is no box mirror here.
 */
export const SKELETON = {
  TILE: {
    DISC: "size-[3.25rem] flex-none rounded-pill",
    EYEBROW: LINE.EYEBROW,
    VALUE: LINE.VALUE,
    CAPTION: LINE.CAPTION,
  },
  TEST: {
    LABEL: `${LINE.ROW_LABEL} w-48`,
    DETAIL: `${LINE.CAPTION} w-32`,
    DURATION: "h-[1.125rem] w-10 rounded-inline",
    CHIP: "h-[1.375rem] w-[4.5rem] rounded-pill",
  },
  /** One category group's head. `DESC` is 12.5px, so it takes the taller box. */
  GROUP: {
    LABEL: `${LINE.LABEL} w-40`,
    DESC: `${LINE.DETAIL} w-56 max-w-full`,
    CHIP: "h-[1.375rem] w-24 rounded-pill",
  },
  CARD: {
    TITLE: `${LINE.LABEL} w-44`,
    DESC: `${LINE.DETAIL} w-72 max-w-full`,
  },
  /** The header's action pills. Absent, the head jumps by 42px plus its gap. */
  ACTION: "h-[2.625rem] w-36 rounded-pill",
} as const;

/** How often the band's "N ago" captions re-read the clock, in milliseconds. */
export const CLOCK_TICK_MS = 15_000;

/** The family's ONE focus ring — 3px `--ring` at 50%, the canon's spelling. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
