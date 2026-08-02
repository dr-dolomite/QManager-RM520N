import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { ApplyStepStatus } from "@/types/sim-profile";

// =============================================================================
// Custom Profiles + Connection Scenarios — shared geometry and tone contract
// =============================================================================
// This file is the single source of truth for the surface's shapes and tones.
// It exists because the pre-rebuild code carried the same defect in four places
// at once — `ProfileRow`, `SuggestionRow`, `ScenarioItem` and `AddScenarioItem`
// each hand-rolled a tonal container out of an opacity wash, and each skeleton
// restated its partner's geometry as literal numbers instead of mirroring it.
// Both classes of drift are invisible in review and obvious on screen.
//
// Every consumer IMPORTS from here. A skeleton that restates a number, or a row
// that hand-writes `bg-success/5`, has left the contract.
//
// -----------------------------------------------------------------------------
// THE TONE RULE (why washes are not a matter of taste here)
// -----------------------------------------------------------------------------
// `bg-{role}/5` is alpha-over-neutral. It is not a token, it does not survive a
// theme flip predictably, and two of them side by side land at different
// perceived lightness depending on what happens to be underneath. The canon
// gives three legitimate answers, and which one applies is decided by SHAPE, not
// by preference:
//
//   1. STACKED / FILLED REGION (a row, a tile, a ledger step) -> `--tone-{role}-1`.
//      Three families ship steps: success, warning, destructive. Step 1 is the
//      quiet fill that carries `text-on-surface` ink at full contrast.
//   2. CHIP or NOTICE (a Badge, a Banner, an inline callout) -> the CONTAINER
//      PAIR, `bg-{role}-container` + `text-on-{role}-container`, never crossed.
//   3. TINTED TEXT OR GLYPH ON A PLAIN CARD -> `text-{role}-on-surface`.
//      NOT `text-{role}`. The bare role token is a FILL, tuned to sit under
//      `-foreground` ink; used as ink on a card it is the single most common
//      contrast failure in this system.
//
// `info` has NO tone steps by design — the Info-Is-Brand Rule routes every
// in-progress surface to `primary-container`. If you reach for `--tone-info-1`
// it does not exist, and that is the canon telling you to use the brand.
//
// -----------------------------------------------------------------------------
// THE NO-HAIRLINE-ON-FILL RULE
// -----------------------------------------------------------------------------
// Once a row is a real tonal container it does NOT also carry a `border`. The
// incumbent code paired `border-success/40` with `bg-success/5` — a hairline
// drawn to compensate for a fill too weak to read on its own. Fix the fill and
// the hairline becomes visual noise. Separation comes from tone, not stroke.
// =============================================================================

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/**
 * A card on this surface. Both routes turned out to want the peer role rather
 * than a hero anchor — the profile list and the scenario grid each sit as one
 * card among siblings, not as the single dominant surface of their page. An
 * earlier draft also exported a `PROFILE_CARD` hero variant and a
 * `PROFILE_TITLE` step; neither found a consumer, so both are gone rather than
 * left as a menu of options nobody ordered from.
 *
 * `shadow-whisper` as a bare utility does NOT resolve — it must go through the
 * custom property, as written here.
 */
export const PROFILE_CARD_PEER =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 28px. */
export const PROFILE_PAD = "px-7";

/**
 * The page-header action pill. Identical string to `radio/page-header.tsx`'s
 * PILL_ACTION and `sms-center.tsx` — restated rather than imported so a profiles
 * consumer does not take a dependency on an unrelated route's module graph.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/**
 * Same pill, no leading-glyph gap. A dialog Cancel never carries an icon, so
 * the `gap-2` in `PILL_ACTION` would reserve space for a glyph that isn't
 * there.
 */
export const PILL_ACTION_PLAIN =
  "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";

/** The Display triple every migrated page `h1` carries. */
export const PAGE_TITLE = "text-3xl font-bold tracking-[-0.02em]";

/** The page description directly under it. */
export const PAGE_DESCRIPTION = "text-on-surface-variant";

// -----------------------------------------------------------------------------
// Profile list rows
// -----------------------------------------------------------------------------

/**
 * One profile row in the list.
 *
 * NOTE ON AN EARLIER DRAFT: this constant originally described a single-line
 * tile (`items-center`, a `min-h-[4.5rem]` floor, a leading glyph disc, a
 * trailing action cluster, and a `HEIGHT` mirror for the skeleton). That was
 * modelled on the Radio Information summary tile, NOT on the row this surface
 * actually renders — which is a multi-section stacked card: identity line,
 * scenario line, wrapped config pills, an optional mismatch notice, and a
 * footer. Every one of those members went unused, and a `HEIGHT` that mirrors
 * nothing makes the skeleton handoff jump *worse*, not better. The contract is
 * now written from the shipped component instead of from an assumed one.
 */
export const PROFILE_ROW_SHAPE = {
  /** The list wrapper. */
  LIST: "flex flex-col gap-2.5",
  /**
   * One row. Stacked, not single-line. No border — the tonal fill from
   * `profileRowTone` carries the separation (No-Hairline-On-Fill). Tile radius:
   * an inner block inside a card, never a card in its own right.
   */
  ROOT: "flex flex-col gap-3 rounded-tile px-5 py-3.5",
} as const;

/**
 * Row fill by profile status.
 *
 * WHY `active` IS NEUTRAL-PLUS-RING RATHER THAN A GREEN FILL. The first tonal
 * rebuild gave the active row `bg-tone-success-1`, which was the right call
 * against the opacity wash it replaced but the wrong one against what the row
 * actually contains: five or six `surface-container-high` config pills. Step 1
 * of a tone family is tuned to carry `on-surface` INK at full contrast, not to
 * host another neutral container inside itself — the pills landed on green and
 * lost the tonal separation that is the only thing distinguishing them from the
 * row. Emphasis moves to a channel the row's contents do not compete for: the
 * fill stays neutral and a 2px inset primary ring carries "this is the one".
 *
 * This is NOT a No-Hairline-On-Fill violation. That rule bans a stroke drawn to
 * compensate for a fill too weak to read on its own. Here the fill is neutral by
 * intent, and the ring is the emphasis itself rather than a prop holding up a
 * failing fill. It is drawn as an INSET shadow, not a `border`, so it costs no
 * layout box and the active and inactive rows stay pixel-identical in size — a
 * real border would shift every child by 2px the moment a row activated.
 *
 * `mismatch` keeps its tonal fill: a mismatch is a genuine functional state the
 * whole row is reporting, not a selection.
 */
export function profileRowTone(
  status: "active" | "mismatch" | "inactive",
): string {
  switch (status) {
    case "active":
      return `bg-surface-container text-on-surface ${PROFILE_ROW_ACTIVE_RING}`;
    case "mismatch":
      return "bg-tone-warning-1 text-on-surface";
    case "inactive":
      return "bg-surface-container text-on-surface";
  }
}

/**
 * The active row's emphasis ring. Inset so it occupies no layout box — see the
 * rationale on `profileRowTone`. Exported separately because the scenario tile
 * grid marks its in-force tile the same way, and the two must never disagree on
 * the ring's weight.
 */
export const PROFILE_ROW_ACTIVE_RING =
  "shadow-[inset_0_0_0_2px_var(--primary)]";

/**
 * The live dot beside an active profile's name: a solid core with a ring that
 * expands and fades behind it.
 *
 * THE ONE-LOOP RULE BUDGET FOR THIS SURFACE IS SPENT HERE. The approved mock
 * shows a second pulsing dot in a breadcrumb status chip; that chip is app-shell
 * chrome this page does not render, and even if it did, two loops on one surface
 * is the violation the rule names. If a future change wants an ambient loop
 * somewhere else on this page, this one has to go first.
 *
 * The ring animates `transform` + `opacity` only, on the `ambient` clock (2s,
 * deliberately NOT doubled with the rest of the scale — a loop is not a
 * transition, and a 4s breath reads as a stalled UI rather than a calm one).
 */
export const LIVE_DOT = {
  ROOT: "relative inline-flex size-[0.4375rem] flex-none",
  CORE: "relative size-[0.4375rem] rounded-pill bg-success",
  RING: "absolute inset-0 rounded-pill bg-success motion-safe:animate-live-ping",
} as const;

/**
 * A suggested-profile row. Suggestions are an offer, not a state, so they take
 * the brand container rather than a functional tone — and keep the dashed
 * stroke, which here is semantic (nothing is applied yet) rather than a
 * compensation for a weak fill.
 */
export const SUGGESTION_ROW =
  "border-primary/40 bg-surface-container text-on-surface border border-dashed";

// -----------------------------------------------------------------------------
// Identity / config pills
// -----------------------------------------------------------------------------

/**
 * The small key/value pills a profile row carries (APN, CID, PDP, TTL). These
 * are IDENTITY labels, not status, so they never take a functional role — a
 * `success` pill here would claim a health the value does not report.
 * Pill radius: anything that labels is a pill.
 */
export const CONFIG_PILL =
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium";
export const CONFIG_PILL_NEUTRAL =
  "bg-surface-container-high text-on-surface-variant";
export const CONFIG_PILL_BRAND = "bg-primary-container text-on-primary-container";

/**
 * Machine-voice values inside a pill or a config row — band lists, EARFCN, PCI,
 * APN strings, mode tokens. The Machine-Voice Rule: a value the device emits is
 * set in mono, a label a human wrote is not.
 */
export const MACHINE_VALUE = "font-mono tabular-nums";

// -----------------------------------------------------------------------------
// Scenario tiles
// -----------------------------------------------------------------------------

/**
 * A scenario tile and the "create scenario" tile beside it. Both import ROOT so
 * the two can never again disagree on their radius — the incumbent shipped
 * `rounded-card` next to `rounded-xl` in the same grid, and the skeleton
 * shadowing them used a third value.
 */
export const SCENARIO_TILE_SHAPE = {
  GRID: "grid grid-cols-1 gap-3.5 @md/card:grid-cols-2 @3xl/card:grid-cols-3",
  ROOT: "relative flex min-h-[9rem] flex-col justify-between overflow-hidden rounded-card p-4",
  HEIGHT: "h-36",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
} as const;

/** The resting scenario tile. */
export const SCENARIO_TILE_IDLE = "bg-surface-container text-on-surface";

/** The selected/active scenario tile — brand container, never a functional tone. */
export const SCENARIO_TILE_ACTIVE =
  "bg-primary-container text-on-primary-container";

/**
 * The "create scenario" ghost tile. Dashed stroke is semantic here (an empty
 * slot), so it keeps its border — but the four stacked opacity washes the
 * incumbent used (`bg-muted/30 hover:bg-primary/5 border-muted-foreground/30
 * hover:border-primary/50`) collapse to one honest container.
 */
export const SCENARIO_TILE_ADD =
  "border-outline hover:border-primary hover:bg-primary-container hover:text-on-primary-container text-on-surface-variant border border-dashed";

// -----------------------------------------------------------------------------
// Active-config card
// -----------------------------------------------------------------------------

/**
 * The active-scenario config card's rows, and the skeleton that mirrors them.
 * `connection-scenario-card.tsx` imports these for its loading state instead of
 * restating `h-11 w-11` / `h-5 w-44` / `h-4 w-24` as it did before.
 */
export const CONFIG_CARD_SHAPE = {
  ROW: "flex items-center justify-between gap-4 rounded-pill px-4 py-2.5",
  ROW_FILL: "bg-surface-container",
  LABEL: "text-on-surface-variant text-sm",
  VALUE: "text-sm font-semibold",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  HEAD_TITLE: "h-5 w-44",
  HEAD_CHIP: "h-5 w-16",
} as const;

// -----------------------------------------------------------------------------
// Apply-progress step ledger
// -----------------------------------------------------------------------------

/**
 * The apply dialog's step ledger. Mirrors the shipped `DeleteProgress` pattern
 * in `components/cellular/sms/delete-dialogs.tsx`: an `<ul aria-live="polite">`
 * of tonal steps, one per genuinely-observable backend stage.
 *
 * DO NOT fabricate steps. The SMS precedent split a real backend call in two
 * rather than animate a two-step UI over one opaque request; a ledger that
 * invents stages is theatre, and the State-Honesty Rule forbids it.
 */
export const LEDGER_SHAPE = {
  LIST: "flex flex-col gap-2",
  STEP: "flex items-center gap-3 rounded-field px-4 py-3 text-sm",
  GLYPH: "size-[1.125rem] flex-none",
} as const;

/**
 * The ledger's state union is DERIVED from the backend's own step contract, not
 * restated. An earlier draft of this file hand-wrote four members and silently
 * dropped `"skipped"` — the status a step reports when it was already correct
 * and did not need to run. Collapsing that onto `"pending"` would have rendered
 * finished work as still queued, which is exactly the State-Honesty violation
 * this file exists to prevent. Aliasing the source type makes the drift
 * impossible: add a status to `ApplyStepStatus` and `ledgerStepTone` stops
 * compiling until it is handled.
 */
type LedgerState = ApplyStepStatus;

/**
 * Step fill + glyph by state. Every state carries a DISTINCT glyph — `running`
 * and `done` must never share one, because `primary-container` and
 * `success-container` are close enough in lightness that the glyph is the only
 * channel separating them, and they are identical under deuteranopia.
 */
export function ledgerStepTone(state: LedgerState): {
  fill: string;
  glyph: MaterialSymbolName;
  spin: boolean;
} {
  switch (state) {
    case "pending":
      return {
        // `schedule` (a clock) rather than an empty circle: it reads as "queued"
        // and is already in the 97-glyph subset, so the ledger needs no font
        // regeneration. It is distinct from the other three states' glyphs,
        // which is the only property that actually matters here.
        fill: "bg-surface-container text-on-surface-variant",
        glyph: "schedule",
        spin: false,
      };
    case "running":
      return {
        fill: "bg-primary-container text-on-primary-container",
        glyph: "progress_activity",
        spin: true,
      };
    case "done":
      return {
        fill: "bg-tone-success-1 text-on-surface",
        glyph: "check_circle",
        spin: false,
      };
    case "failed":
      return {
        fill: "bg-tone-destructive-1 text-on-surface",
        glyph: "cancel",
        spin: false,
      };
    case "skipped":
      // Already correct, so the worker did not run it. This is a SUCCESS
      // outcome reported quietly — muted, never `success` (which would claim
      // the step did work) and never `pending` (which would claim it still
      // has work to do). Its glyph differs from all four others.
      return {
        fill: "bg-surface-container-high text-on-surface-variant",
        glyph: "do_not_disturb_on",
        spin: false,
      };
  }
}

// -----------------------------------------------------------------------------
// Status chips
// -----------------------------------------------------------------------------

/**
 * Profile / scenario status -> Badge variant + glyph.
 *
 * THIS MAP IS THE FIX FOR THE SURFACE'S ONE REAL ACCESSIBILITY BUG. The
 * incumbent `active-config-card.tsx` rendered its three chips with a hand-drawn
 * `<div className="rounded-full bg-success">` dot instead of a glyph.
 * `success-container` and `warning-container` measure 1.03:1 apart — the same
 * surface to the eye, and IDENTICAL under deuteranopia. A colour-only dot is
 * precisely the signal the Every-Chip-Has-A-Glyph Rule exists to forbid, so
 * "Active" and "Not Active" were indistinguishable to a colourblind user.
 *
 * Keying the tone onto `BadgeVariant` rather than a class string means a new
 * state without a matching role fails the build instead of shipping untinted.
 */
export const PROFILE_STATUS_BADGE: Record<
  "active" | "applying" | "inactive" | "mismatch" | "failed",
  { variant: BadgeVariant; glyph: MaterialSymbolName; spin?: boolean }
> = {
  active: { variant: "success", glyph: "check_circle" },
  applying: { variant: "info", glyph: "progress_activity", spin: true },
  inactive: { variant: "muted", glyph: "do_not_disturb_on" },
  mismatch: { variant: "warning", glyph: "warning" },
  failed: { variant: "destructive", glyph: "cancel" },
};

/** Badge glyph size. Matches the `[&>svg]:size-3` slot Badge reserves. */
export const BADGE_GLYPH_SIZE = 12;

// =============================================================================
// The "in force now" hero
// =============================================================================
// The page's anchor card, and the one place `rounded-hero` is earned on this
// surface: it answers the question the user arrived with (what is running on my
// modem right now) before the list of things they could run instead.
//
// This is the exception the Consistent-Layout Rule allows, not a breach of it —
// "a genuine glance surface may earn a hero card". Everything below the hero is
// still the uniform card grid. If a future change gives the hero a second
// sibling hero, that exception has been spent twice and one of them is wrong.

/** The hero shell. `rounded-hero` (40px) — one per surface. */
export const HERO_CARD =
  "@container/hero flex flex-col gap-[1.125rem] rounded-hero border-0 bg-surface p-6 shadow-[var(--shadow-whisper)]";

/**
 * The hero's leading glyph disc. 52px, brand fill with its own `-foreground`
 * ink — a CONTAINER tile would take a FILL disc and vice versa, but the hero
 * shell is plain `surface`, so the disc takes the fill pair directly.
 */
export const HERO_DISC =
  "grid size-13 flex-none place-items-center rounded-pill bg-primary text-primary-foreground";

/**
 * The eyebrow above the active profile's name.
 *
 * The generic craft floor treats an eyebrow as a reflex to delete. It is kept
 * here because this surface's own canon ships one — DESIGN.md's tile anatomy is
 * literally `eyebrow -> value -> caption`, and the pre-auth scale names an
 * eyebrow step. The committed world outranks the generic default, and the label
 * is doing real work: "Home Fixed Wireless" alone does not say whether you are
 * looking at the active profile or a saved one.
 */
export const HERO_EYEBROW =
  "text-xs font-medium tracking-[0.06em] text-on-surface-variant";

/** The three tiles under the hero's identity line. */
export const HERO_TILE_SHAPE = {
  GRID: "grid grid-cols-1 gap-3 @2xl/hero:grid-cols-3",
  ROOT: "flex flex-col gap-2.5 rounded-tile p-4",
  /** The tile's own eyebrow. Inherits ink from the tile, never restated. */
  LABEL: "text-xs font-medium",
  /** The scenario tile's inner disc — a CONTAINER tile takes a FILL disc. */
  DISC: "grid size-[2.125rem] flex-none place-items-center rounded-pill bg-primary text-primary-foreground",
} as const;

/** Neutral hero tile (Identity, Radio). */
export const HERO_TILE_NEUTRAL = "bg-surface-container text-on-surface";

/**
 * The scenario tile. Brand container, because the bound scenario is the one
 * thing in the hero the profile actively OWNS — the other two tiles report.
 * Never a functional tone: a scenario is not a health state.
 */
export const HERO_TILE_SCENARIO =
  "bg-primary-container text-on-primary-container";

/**
 * An inline notice inside the hero (mismatch / applying / partial).
 *
 * `rounded-field` (20px), so it never out-rounds the 40px hero hosting it —
 * the Radius-Follows-Size Rule. Tone comes from the CONTAINER PAIR, never a
 * wash: a 10% alpha over a tinted surface collapses in dark and is the first
 * thing to wash out in sunlight, which is the ambient condition this product
 * is explicitly designed against.
 */
export const HERO_NOTICE = "flex items-start gap-3 rounded-field px-4 py-3.5";

/**
 * Fill + glyph for each hero notice, keyed on the condition rather than on a
 * class string — the same construction as `ledgerStepTone` and
 * `PROFILE_STATUS_BADGE`, and for the same reason: a fourth notice cannot
 * quietly invent a fifth container pair, and a pair can never end up crossed.
 *
 * `applying` routes to the BRAND container, not to a fourth functional hue.
 * That is the Info-Is-Brand Rule: there is no separate info color in this
 * system, so an in-progress surface and a primary button differ by shape and
 * glyph, never by owning two different blues.
 *
 * Every state carries a DISTINCT glyph. `mismatch` and `partial` share a
 * container — both are `warning`, correctly, since each is a degraded-but-
 * running state — which makes the glyph the only channel separating them. That
 * is exactly the case the Every-Chip-Has-A-Glyph Rule is written for.
 */
export const HERO_NOTICE_TONE: Record<
  "mismatch" | "applying" | "partial",
  { fill: string; glyph: MaterialSymbolName; spin: boolean }
> = {
  mismatch: {
    fill: "bg-warning-container text-on-warning-container",
    glyph: "warning",
    spin: false,
  },
  applying: {
    fill: "bg-primary-container text-on-primary-container",
    glyph: "progress_activity",
    spin: true,
  },
  partial: {
    fill: "bg-warning-container text-on-warning-container",
    glyph: "do_not_disturb_on",
    spin: false,
  },
};

// -----------------------------------------------------------------------------
// The schedule ribbon
// -----------------------------------------------------------------------------

/**
 * A profile's scenario schedule drawn as a 24-hour strip: one proportional
 * segment per block, plus a marker at the current time.
 *
 * `rounded-field` (20px) on the segments rather than the mock's 16px, which is
 * not on the role scale. 20px is what the apply-dialog ledger step already
 * uses, so a horizontal band and a vertical band read as one family.
 *
 * Segments animate `scaleX` from a left origin, never `width` — the
 * Transform-Only Rule. On a CPU that is also carrying the user's traffic, a
 * per-segment layout pass is not free, and the aggregation strip is the single
 * sanctioned `width` animation in the product. It is not this.
 */
export const RIBBON_SHAPE = {
  ROOT: "relative flex h-13 gap-1",
  SEGMENT:
    "flex min-w-0 origin-left items-center gap-2 overflow-hidden rounded-field px-3.5",
  /** Collapsed segment — too narrow for a label, glyph only. */
  SEGMENT_TIGHT:
    "grid min-w-0 origin-left place-items-center overflow-hidden rounded-field",
  /** The "now" needle, drawn over the strip and bleeding past both edges. */
  NEEDLE: "absolute -top-1.5 -bottom-1.5 w-0.5 rounded-pill bg-on-surface",
  /** The time readout riding on top of the needle. */
  NEEDLE_LABEL:
    "absolute -top-4 -translate-x-1/2 rounded-pill bg-surface px-1.5 text-[0.6875rem] font-semibold text-on-surface",
  /** The 00 / 06 / 12 / 18 / 24 axis under the strip. */
  AXIS: "flex justify-between text-[0.6875rem] text-on-surface-variant",
} as const;

/** The resting ribbon segment. */
export const RIBBON_SEGMENT_IDLE = "bg-surface-container text-on-surface-variant";

/** The segment in force at the marker. Brand container — in force, not healthy. */
export const RIBBON_SEGMENT_LIVE =
  "bg-primary-container text-on-primary-container";

/**
 * The 8px condensed ribbon a profile ROW carries. Same proportions, same source
 * data, no labels — it is a glyph for "this profile has a schedule and here is
 * its shape", not a readable timeline. Both draw from `lib/schedule-timeline.ts`
 * so the row and the hero can never disagree about where a block starts.
 */
export const RIBBON_MINI = {
  ROOT: "flex h-2 gap-[0.1875rem]",
  SEGMENT: "min-w-0 rounded-pill",
  IDLE: "bg-surface-container-high",
  LIVE: "bg-primary",
} as const;

// -----------------------------------------------------------------------------
// Scenario tile additions
// -----------------------------------------------------------------------------

/**
 * The mono config pills on a scenario tile (mode token, band list). Smaller
 * than `CONFIG_PILL` because a tile carries two of them in a narrower column
 * than a profile row carries five.
 */
export const SCENARIO_PILL =
  "inline-flex h-[1.375rem] items-center gap-1 rounded-pill px-2.5 text-[0.6875rem]";

/** A scenario tile's meta chip: next-fire time, "locks bands", "Custom". */
export const SCENARIO_META_CHIP =
  "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[0.6875rem] font-medium";

// -----------------------------------------------------------------------------
// Apply-dialog ledger additions
// -----------------------------------------------------------------------------

/**
 * The right-aligned value a ledger step carries — the APN that landed, the AT
 * error a step returned, "Unchanged" for a skipped one. This is the backend's
 * own `ApplyStep.detail` string verbatim, so it is machine voice and takes the
 * mono face. It is NOT decoration: a step that says "done" without saying what
 * it did is exactly the opaque progress the State-Honesty Rule exists to stop.
 *
 * Ink is inherited from the step's container pair rather than restated, so the
 * value can never end up carrying one role's ink on another role's fill.
 */
export const LEDGER_VALUE = "font-mono text-[0.6875rem] tabular-nums opacity-85";

/** The determinate apply bar. `scaleX` from a left origin — never `width`. */
export const LEDGER_BAR = {
  TRACK: "relative h-1.5 w-full overflow-hidden rounded-pill bg-surface-container",
  FILL: "h-full origin-left rounded-pill",
} as const;
