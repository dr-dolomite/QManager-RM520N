// Software Update — geometry, tone and face contract for this one surface.
// It deliberately RESTATES the family's numbers rather than importing them: a
// sibling shape module is not a shared library, the design system's numbers are.

import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2Icon,
  CloudOffIcon,
  DownloadIcon,
  HelpCircleIcon,
  Loader2Icon,
  MinusCircleIcon,
  OctagonAlertIcon,
  PackageCheckIcon,
  PackageIcon,
  PackageOpenIcon,
  RefreshCwIcon,
  RotateCwIcon,
  ServerOffIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";

import type { BadgeVariant } from "@/components/ui/badge";

import type { FailureKind, UpdateView } from "./derive";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 p-2";

/** The page header: titles left, actions pushed right once the page is wide. */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

/**
 * The two-up card grid. `items-stretch` plus the child height lock is what lets
 * a card absorb its row-mate's slack, which `GROUP_FILL` then spends.
 */
export const CARD_GRID =
  "grid grid-cols-1 items-stretch gap-5 *:h-full *:*:data-[slot=card]:h-full @3xl/main:grid-cols-2";

/** One grid cell. Each card cascades on its own step, so it needs a wrapper. */
export const CARD_CELL = "flex min-w-0 flex-col";

/** The 42px control height every pill, field and their skeletons compose from. */
const CONTROL_HEIGHT = "h-[2.625rem]";

/** The 42px action pill. Restated per family, never imported across one. */
export const PILL_ACTION = `${CONTROL_HEIGHT} gap-2 rounded-pill px-5 text-sm font-semibold`;

/** The lucide glyph inside an action pill. */
export const PILL_GLYPH = "size-4";

/** The lucide glyph inside a `Badge` — written out for `Tag` too. */
export const CHIP_GLYPH = "size-3";

/** The one spin class, so a `Face` carrying `spin` has one spelling to reach. */
export const SPIN = "animate-spin";

// -----------------------------------------------------------------------------
// Focus
// -----------------------------------------------------------------------------

/**
 * The ring itself — 3px of full-strength `--ring` over a 2px gap. The gap is
 * what makes the ring visible on a filled control, where the ring is the same
 * colour as the fill.
 *
 * The GAP'S COLOUR IS THE HOST'S GROUND, never always the page canvas: light
 * mode hides the difference (`--background` 0.985 against `--surface` 1.0), but
 * dark mode paints a visibly darker halo (0.12 against 0.17, and two steps off
 * against a `surface-container` row group). `banner.tsx` solves the same
 * problem per tone; these four are this surface's four grounds.
 */
const FOCUS_RING_BASE =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2";

/** Host = the page canvas. */
export const FOCUS_RING = `${FOCUS_RING_BASE} focus-visible:ring-offset-background`;

/** Host = a card's own surface, or a dialog panel's (both `bg-surface`). */
export const FOCUS_RING_ON_SURFACE = `${FOCUS_RING_BASE} focus-visible:ring-offset-surface`;

/** Host = a `ROW_GROUP` or the delta strip. */
export const FOCUS_RING_ON_CONTAINER = `${FOCUS_RING_BASE} focus-visible:ring-offset-surface-container`;

// -----------------------------------------------------------------------------
// The status band
// -----------------------------------------------------------------------------

/** The band header: label left, an optional state chip pushed right. */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  GLYPH: "size-3",
} as const;

/** The band disc's 52px box, shared with its own skeleton. */
const TILE_DISC_SIZE = "size-[3.25rem]";

/**
 * The tile box. `ROOT` is PINNED at 104px, never a floor — a floor resolves to
 * its content and cannot mirror a skeleton. Nothing clips, because the eyebrow,
 * value and caption all truncate.
 */
export const TILE = {
  GRID: "grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  BODY: "bg-surface-container text-on-surface",
  DISC: `grid ${TILE_DISC_SIZE} flex-none place-items-center rounded-pill`,
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
 * properties. `--duration-*` takes `var()` because it is NOT `@theme`-
 * registered; `--ease-*` is, so it spells as the first-class utility.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-standard";

/** The eyebrow above a tile's figure. Casing lives HERE, never in a leaf. */
export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase";

/** The figure. `tabular-nums` in the UI face — a reading, not an identifier. */
export const VALUE =
  "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums";

/** The truncating text child of a `VALUE` box. */
export const VALUE_TEXT = "truncate";

/**
 * COMPOSES ONTO `VALUE` for the Installed and Latest tiles: a version tag is an
 * identifier, so it takes the machine face. It does not restate `tabular-nums`,
 * which is the UI face's treatment and not the mono face's.
 */
export const VALUE_MONO = "font-mono tracking-[-0.01em]";

/** The caption under a figure. ONE spelling. */
export const CAPTION = "text-on-surface-variant truncate text-xs";

/** The placeholder for a figure with no reading — needs no translator. */
export const VALUE_NONE = "—";

// -----------------------------------------------------------------------------
// Cards
// -----------------------------------------------------------------------------

/**
 * The peer card shell. `border-0` is explicit: a tonal surface never also
 * carries a hairline. The whisper is important-marked because `twMerge` reads
 * an arbitrary shadow as a colour and cannot dedupe it against `card.tsx`.
 *
 * BOTH SHELLS STEP DOWN ONE RUNG BELOW 576px, and the wide half is
 * important-marked: the role radii are custom names whose emission order is
 * alphabetical, so the marker decides the pair rather than the alphabet.
 */
export const CARD_SHELL =
  "@container/card gap-5 rounded-tile @xl/main:rounded-card! border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** The anchor card — the delta strip, the ladder and the notice — at hero. */
export const CARD_SHELL_HERO =
  "@container/card gap-5 rounded-card @xl/main:rounded-hero! border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, stepping down to 20px on a phone. */
export const CARD_PAD = "px-5 @xl/main:px-7";

/** A card body stacking more than one block — a strip above a ladder. */
export const CARD_STACK = "flex min-h-0 flex-1 flex-col gap-3.5";

/** `CardTitle` takes its size from the call site; unsized it flattens the ramp. */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink, so the ink is written here. */
export const CARD_DESC = "text-on-surface-variant text-sm";

// -----------------------------------------------------------------------------
// Notices
// -----------------------------------------------------------------------------

/**
 * Dim ink on a tonal fill: inherit the container's own ink, then step it back.
 * A role token here would be a fill role's ink with nothing under it.
 */
const META_INK_ON_TONAL = "opacity-90";

/**
 * The card-scoped notice. `BOX` carries no fill — the tone is the caller's,
 * because the same box says "this reboots the modem" in warning and "the check
 * failed" in destructive.
 */
export const NOTICE = {
  BOX: "flex items-start gap-2.5 rounded-field px-4 py-3",
  WARNING: "bg-warning-container text-on-warning-container",
  DESTRUCTIVE: "bg-destructive-container text-on-destructive-container",
  /** The leading glyph, nudged onto the first line's optical baseline. */
  GLYPH: "mt-0.5 size-4 flex-none",
  TEXT: "text-[0.8125rem] leading-relaxed text-pretty",
  /** A two-line notice: the sentence, then the machine text under it. */
  STACK: "flex min-w-0 flex-col gap-1",
  /** Backend text quoted inside a notice — machine voice, ink stepped back. */
  DETAIL: `font-mono text-xs leading-relaxed break-words ${META_INK_ON_TONAL}`,
} as const;

// -----------------------------------------------------------------------------
// The version delta strip
// -----------------------------------------------------------------------------

/**
 * The anchor card's opening line: what is installed, what is offered.
 *
 * A COLUMN until the card can seat the two versions side by side, which is why
 * the arrow carries its rotation in the resting state and drops it at the flip.
 * `VALUE_NEXT` is the only colour in the strip (the Data-Ink Rule).
 */
/** The strip arrow's 20px box, shared with its own skeleton. */
const DELTA_ARROW_SIZE = "size-5";

export const DELTA = {
  ROOT: "flex flex-col gap-3.5 rounded-tile bg-surface-container px-[1.375rem] py-[1.125rem] @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-5",
  SLOT: "flex min-w-0 flex-col gap-1",
  EYEBROW:
    "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em] uppercase",
  VALUE:
    "truncate font-mono text-[1.375rem] font-bold leading-[1.1] tracking-[-0.01em]",
  VALUE_NEXT: "text-primary-on-surface",
  ARROW: `${DELTA_ARROW_SIZE} flex-none rotate-90 text-on-surface-variant @2xl/card:rotate-0`,
  META: "flex flex-wrap items-center gap-2 @2xl/card:ml-auto",
} as const;

// -----------------------------------------------------------------------------
// The step ladder
// -----------------------------------------------------------------------------

/**
 * Four rows that are ALWAYS rendered. At rest all four are pending, which is
 * how the reboot becomes visible before the user commits; a run changes tone in
 * place so nothing mounts and nothing moves.
 */
/** The ladder disc's 40px box, shared with its own skeleton. */
const STEP_DISC_SIZE = "size-10";

export const LADDER = {
  GROUP: "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5",
  ROW: "flex items-center gap-3 rounded-field px-4 py-3 transition-[background-color,color] duration-[var(--duration-standard)] ease-standard",
  /** One tonal step above the group — the only thing marking the live row. */
  ROW_ACTIVE: "bg-surface-container-high",
  DISC: `grid ${STEP_DISC_SIZE} flex-none place-items-center rounded-pill`,
  /** The glyph inside DISC — 20px, half the disc. */
  GLYPH: "size-5",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  LABEL: "text-[0.9375rem] font-semibold",
  DETAIL:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  META: "flex flex-none items-center gap-2.5",
} as const;

export type StepKey = "download" | "verify" | "install" | "reboot";

export type StepState = "done" | "active" | "pending";

/** The backend's own order. Never re-sorted while a run is in flight. */
export const STEP_ORDER: readonly StepKey[] = [
  "download",
  "verify",
  "install",
  "reboot",
];

/** What a step shows before it runs — its own subject, not a state glyph. */
export const STEP_PENDING_GLYPH: Record<StepKey, LucideIcon> = {
  download: DownloadIcon,
  verify: ShieldCheckIcon,
  install: PackageIcon,
  reboot: RotateCwIcon,
};

/** Disc fills per row state. Fill pairs, matching the band's discs. */
export const STEP_DISC: Record<StepState, string> = {
  done: "bg-success text-success-foreground",
  active: "bg-primary text-primary-foreground",
  pending: "bg-surface-container-high text-on-surface-variant",
};

/** `null` means the row falls through to its own `STEP_PENDING_GLYPH`. */
export const STEP_GLYPH: Record<StepState, LucideIcon | null> = {
  done: CheckCircle2Icon,
  active: Loader2Icon,
  pending: null,
};

/**
 * The row's meta chip, keyed onto the exported `BadgeVariant` so a state
 * without a matching chip role fails the build. `pending` has no chip.
 */
export const STEP_BADGE: Record<Exclude<StepState, "pending">, BadgeVariant> = {
  done: "success",
  active: "info",
};

// -----------------------------------------------------------------------------
// Release notes
// -----------------------------------------------------------------------------

/**
 * The changelog panel. A SOLID token, never an alpha wash — an alpha over a
 * tinted surface collapses toward its ground in dark mode.
 */
export const NOTES = {
  /**
   * Both axes are DECLARED: `RELEASE_NOTES.md` ships verbatim curl/wget blocks,
   * so the sideways scroll is real and not inherited from the y-axis. The panel
   * is focusable because it scrolls, so it also carries a ring — its host is the
   * card's own surface.
   */
  PANEL: `rounded-field bg-surface-container-high px-5 py-4 max-h-[13.75rem] overflow-x-auto overflow-y-auto ${FOCUS_RING_ON_SURFACE}`,
  /** Markdown ink on canon tokens; the primitive's own inks are retired. */
  PROSE:
    "prose prose-sm dark:prose-invert max-w-none prose-p:text-on-surface-variant prose-li:text-on-surface-variant prose-headings:text-on-surface prose-strong:text-on-surface prose-code:bg-surface-container prose-code:text-on-surface prose-hr:border-outline prose-a:text-primary",
  FOOTER: "flex justify-end",
} as const;

/** The same panel at the dialog's taller cap; its host is `bg-surface` too. */
export const DIALOG_PANEL = `rounded-field bg-surface-container-high px-5 py-4 max-h-[26rem] overflow-x-auto overflow-y-auto ${FOCUS_RING_ON_SURFACE}`;

/**
 * A dialog's two directions, written SEPARATELY. Radix pins the body's pointer
 * events for the whole exit, so an unqualified emphasized buys 800ms of dead
 * clicks. Applies to the scrim as well as the panel.
 */
export const DIALOG_MOTION =
  "data-[state=open]:duration-[var(--duration-emphasized)] data-[state=closed]:duration-[var(--duration-quick)]";

// -----------------------------------------------------------------------------
// Rows and fields
// -----------------------------------------------------------------------------

/**
 * One tonal group holding a card's setting rows. The group is one step above
 * the card's surface — that ladder is what makes a borderless row legible.
 */
export const ROW_GROUP =
  "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/** A card's slack absorber: the page grid locks the cell, the group grows. */
export const GROUP_FILL = "min-h-0 flex-1";

/**
 * One setting row. A min-height FLOOR, not a pin — a consequence sentence wraps
 * to two lines on a narrow container where a fixed height would clip it.
 *
 * `TEXT` carries `flex-1` and not merely a zero minimum: against a `flex-none`
 * control the column would otherwise shrink to nothing and wrap one word a line.
 */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL: "text-[0.9375rem] font-semibold",
  /** REQUIRED on a row that makes a decision — here, that the modem reboots. */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
} as const;

/**
 * `CONTROL_HEIGHT`'s number, important-marked INSIDE the string. `select.tsx`
 * ships a default 36px behind a data-attribute selector, which outranks a bare
 * arbitrary height; a marker appended to an interpolation never appears in
 * source and is never generated, which is why this one literal is restated.
 */
const FIELD_HEIGHT = "h-[2.625rem]!";

/**
 * The version select. THE FIELD-STEP RULE: this control's host is the card's
 * own surface rather than a row group, so its fill is one step up from there.
 * The dark half is written as a PAIR and important-marked, because the field
 * primitives ship their own dark fill at higher specificity.
 */
export const FIELD = `${FIELD_HEIGHT} w-full rounded-pill border-0 bg-surface-container dark:bg-surface-container! px-4 text-[0.84375rem] font-medium ${FOCUS_RING_ON_SURFACE} disabled:cursor-not-allowed disabled:opacity-50`;

/** The select and its Install button: stacked until the card can seat them. */
export const FIELD_ROW =
  "flex flex-col gap-2.5 @2xl/card:flex-row @2xl/card:items-center";

/**
 * The Install button beside the select. Unmarked: `button.tsx` declares its
 * default height plainly, so `twMerge` dedupes it and the call site wins.
 */
export const FIELD_ACTION = `${CONTROL_HEIGHT} w-full gap-2 rounded-pill px-5 text-sm font-semibold @2xl/card:w-auto`;

/** One version row inside `SelectContent`: tag left, its state pushed right. */
export const SELECT_ITEM = {
  ROOT: "flex w-full min-w-0 items-center gap-3",
  /** A version tag is an identifier, so it keeps the machine face. */
  LABEL: "truncate font-mono text-[0.8125rem]",
  META: "ml-auto flex flex-none items-center gap-2",
  /** Radix's `ItemText` span shrink-wraps, leaving `META`'s auto margin no slack. */
  HOST: "[&>span:last-child]:flex-1",
  /** The select primitive repaints any descendant svg carrying no text colour. */
  CHIP_GLYPH: `${CHIP_GLYPH} text-current`,
} as const;

/**
 * The 44px coarse-pointer target, as a pseudo-element overlay rather than a
 * layout box — a layout box moves the row's label baseline. `Switch` paints
 * 32x18 and cannot grow without breaking the row it rides in.
 */
export const SWITCH_TARGET =
  "relative before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']";

/** `Switch`'s own painted box (`switch.tsx`), so its skeleton cannot invent one. */
const SWITCH_BOX = "h-[1.15rem] w-8";

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

/** What lets a condition block fill a height-locked card rather than float. */
export const CONDITION_PANEL = {
  SCREEN: "min-h-0 flex-1 justify-center",
} as const;

/**
 * The unreachable state: the block, with the device's own status text INSIDE
 * it, so the alert announces both. The raw text stays machine voice rather than
 * folded into the sentence, and takes the container's own ink stepped back —
 * a role ink here would be a fill role's ink with nothing under it.
 */
export const ERROR_STATE = {
  ROOT: "flex flex-col items-center gap-2.5",
  BLOCK: "w-full",
  DETAIL: `break-words text-center font-mono text-xs ${META_INK_ON_TONAL}`,
} as const;

// -----------------------------------------------------------------------------
// Faces
// -----------------------------------------------------------------------------

/**
 * A tile's face: ONE state union, ONE `Record`-typed map. Three independent
 * ternaries let the value line, the caption and the disc disagree.
 *
 * Every state in a map carries its OWN glyph: the success and warning
 * containers measure 1.03:1 apart and the disc fills are no easier under
 * deuteranopia, so the glyph is the only separator a tile has.
 */
export interface Face {
  tone: DiscTone;
  glyph: LucideIcon;
  spin?: boolean;
}

export type InstalledState = "normal" | "interrupted";

export const INSTALLED_FACE: Record<InstalledState, Face> = {
  // `primary` says a build is installed and running — never that it is
  // healthy, which is what `success` on the Latest tile is for.
  normal: { tone: "primary", glyph: PackageIcon },
  interrupted: { tone: "warning", glyph: TriangleAlertIcon },
};

export type LatestState =
  | "up_to_date"
  | "available"
  | "downloading"
  | "verifying"
  | "verified"
  | "installing"
  | "check_failed"
  | "download_failed"
  | "install_failed"
  | "never_checked";

export const LATEST_FACE: Record<LatestState, Face> = {
  up_to_date: { tone: "success", glyph: CheckCircle2Icon },
  available: { tone: "primary", glyph: DownloadIcon },
  // Every `primary` state carries its own glyph: the fills are one surface to a
  // large minority, so the caption is not allowed to be the only separator.
  downloading: { tone: "primary", glyph: Loader2Icon, spin: true },
  verifying: { tone: "primary", glyph: ShieldCheckIcon },
  verified: { tone: "primary", glyph: PackageCheckIcon },
  installing: { tone: "primary", glyph: PackageOpenIcon },
  // The three destructive states share a fill, so each takes its own glyph.
  check_failed: { tone: "destructive", glyph: CloudOffIcon },
  download_failed: { tone: "destructive", glyph: XCircleIcon },
  install_failed: { tone: "destructive", glyph: OctagonAlertIcon },
  never_checked: { tone: "neutral", glyph: HelpCircleIcon },
};

export type AutoState = "on" | "off";

export const AUTO_FACE: Record<AutoState, Face> = {
  on: { tone: "primary", glyph: RefreshCwIcon },
  off: { tone: "neutral", glyph: MinusCircleIcon },
};

/**
 * The anchor card's own chip, one entry per view. No two views sharing a
 * variant share a glyph — the fills are indistinguishable to a large minority.
 */
export const ANCHOR_CHIP: Record<
  UpdateView,
  { variant: BadgeVariant; glyph: LucideIcon; spin?: boolean }
> = {
  loading: { variant: "muted", glyph: Loader2Icon, spin: true },
  unreachable: { variant: "destructive", glyph: ServerOffIcon },
  check_failed: { variant: "destructive", glyph: CloudOffIcon },
  up_to_date: { variant: "success", glyph: CheckCircle2Icon },
  available: { variant: "info", glyph: DownloadIcon },
  downloading: { variant: "info", glyph: Loader2Icon, spin: true },
  verifying: { variant: "info", glyph: ShieldCheckIcon },
  staged: { variant: "success", glyph: PackageIcon },
  installing: { variant: "info", glyph: PackageOpenIcon },
  rebooting: { variant: "info", glyph: RotateCwIcon, spin: true },
};

/**
 * The anchor chip when the failing view is `check_failed`: the view alone
 * cannot tell a failed check from a failed download or install, so the chip
 * keys off the failure's kind. Same three glyphs as `LATEST_FACE`, so the band
 * and the card never name the same failure differently.
 */
export const FAILURE_CHIP: Record<
  FailureKind,
  { variant: BadgeVariant; glyph: LucideIcon }
> = {
  check: { variant: "destructive", glyph: CloudOffIcon },
  download: { variant: "destructive", glyph: XCircleIcon },
  install: { variant: "destructive", glyph: OctagonAlertIcon },
};

/**
 * The value posted to `save_auto_update`. The CGI still validates the field,
 * but the timer runs daily on a randomised delay, so the key is inert.
 */
export const AUTO_UPDATE_TIME = "03:00";

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/**
 * Line boxes — a rendered line's HEIGHT, never its font size. A line of
 * 15px/normal occupies 22px, and 22px is what stands in for it.
 */
const LINE = {
  /** `CARD_TITLE` (18px/tight), `ROW.LABEL` and `LADDER.LABEL` (15px). */
  LABEL: "h-[1.375rem] rounded-inline",
  /** `ROW.CONSEQUENCE`, `LADDER.DETAIL` and `CARD_DESC` at 12.5-14px. */
  DETAIL: "h-[1.25rem] rounded-inline",
  /** `EYEBROW` and `DELTA.EYEBROW` at 11px. */
  EYEBROW: "h-[1.0625rem] rounded-inline",
  /** `VALUE` and `DELTA.VALUE` at 22px with 1.1 leading. */
  VALUE: "h-[1.5rem] rounded-inline",
  /** `CAPTION` at 12px. */
  CAPTION: "h-[1.125rem] rounded-inline",
  /** A slice of prose inside the notes panel, at the panel's own 14px. */
  PROSE: "h-[1.3125rem] rounded-inline",
} as const;

/**
 * Every placeholder reads its geometry from the loaded view's own constant, so
 * a height cannot drift out from under its skeleton. The band's skeleton wears
 * the real `TILE.ROOT` and the ladder's wears `LADDER.ROW`, which is why
 * neither has a box mirror here.
 */
export const SKELETON = {
  TILE: {
    DISC: `${TILE_DISC_SIZE} flex-none rounded-pill`,
    EYEBROW: LINE.EYEBROW,
    VALUE: LINE.VALUE,
    CAPTION: LINE.CAPTION,
  },
  CARD: {
    TITLE: `${LINE.LABEL} w-44`,
    DESC: `${LINE.DETAIL} w-72 max-w-full`,
  },
  /** The header's action pill. Absent, the head jumps by 42px plus its gap. */
  ACTION: `${CONTROL_HEIGHT} w-36 rounded-pill`,
  /** The delta strip, worn inside the real `DELTA.ROOT`. */
  DELTA: {
    EYEBROW: `${LINE.EYEBROW} w-16`,
    VALUE: `${LINE.VALUE} w-28`,
    ARROW: `${DELTA_ARROW_SIZE} flex-none rounded-inline`,
    TAG: "h-[1.375rem] w-16 rounded-pill",
  },
  /** One ladder row, worn inside the real `LADDER.ROW`. */
  LADDER: {
    DISC: `${STEP_DISC_SIZE} flex-none rounded-pill`,
    LABEL: `${LINE.LABEL} w-24`,
    DETAIL: `${LINE.DETAIL} w-56 max-w-full`,
    CHIP: "h-[1.375rem] w-20 rounded-pill",
  },
  /** The consequence notice, worn inside the real `NOTICE.BOX`. */
  NOTICE: {
    /** `NOTICE.GLYPH`'s box INCLUDING its optical nudge, or it sits 2px high. */
    GLYPH: `${NOTICE.GLYPH} rounded-inline`,
    TEXT: `${LINE.DETAIL} w-full`,
    /** The second line `notice.rest` and `notice.staged` wrap to at hero width. */
    TEXT_2: `${LINE.DETAIL} w-3/5`,
  },
  /** The notes panel: the real box, filled past its own 220px cap. */
  NOTES: {
    PANEL: NOTES.PANEL,
    /** The prose stack's own rhythm — a notice's two-line stack is not it. */
    STACK: "flex min-w-0 flex-col gap-1.5",
    LINE: LINE.PROSE,
    LINE_SHORT: `${LINE.PROSE} w-2/3`,
  },
  /** One preferences row, worn inside the real `ROW.ROOT`. */
  ROW: {
    LABEL: `${LINE.LABEL} w-40`,
    CONSEQUENCE: `${LINE.DETAIL} w-64 max-w-full`,
    /** The second line the consequence wraps to at real card widths. */
    CONSEQUENCE_2: `${LINE.DETAIL} w-48 max-w-full`,
    /** The `Switch` in the control box — 32x18.4px, not a field. */
    SWITCH: `${SWITCH_BOX} rounded-pill`,
  },
  /** Mirrors `FIELD`'s height and radius, and the button beside it. */
  FIELD: `${CONTROL_HEIGHT} w-full rounded-pill`,
  FIELD_ACTION: `${CONTROL_HEIGHT} w-full rounded-pill @2xl/card:w-28`,
} as const;

/** How often the band's "Checked N ago" caption re-reads the clock, in ms. */
export const CLOCK_TICK_MS = 15_000;
