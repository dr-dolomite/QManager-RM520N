import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// =============================================================================
// Tower Locking — shared geometry and tone contract
// =============================================================================
// The single source of truth for this surface's shapes, tones and skeleton
// mirrors. Modelled on `components/cellular/band-locking/shapes.ts`, and for the
// same reason: the incumbent tower-locking code restated its card shell in SEVEN
// places across four files, each file declaring its skeleton geometry in a
// different branch from its loaded geometry, so a radius fixed in one branch
// stayed wrong in the other six.
//
// RESTATED, NOT IMPORTED. Several strings here are byte-identical to the
// band-locking contract's. That is the house convention rather than an
// oversight — a surface takes no dependency on a sibling route's module graph,
// so band locking can be re-shaped without silently re-shaping this page. The
// one thing that must NOT drift is the carrier tile's tone rule, so those three
// functions carry the full rationale rather than a pointer to it.
//
// -----------------------------------------------------------------------------
// WHAT THIS SURFACE IS
// -----------------------------------------------------------------------------
// Two kinds of object, and the incumbent layout said they were the same kind:
// it put a read-only status card and three control surfaces into one 2x2 grid
// as visual peers.
//
//   1. THE HERO reports what the modem is doing right now — the cells it is
//      camped on, the lock target read back from the radio, and the failover
//      safety net. Read-only except for the settings that belong to no single
//      leg (persist, failover, threshold).
//   2. THE LEG CARDS are where you change it. One per AT lock parameter
//      (`AT+QNWLOCK="common/4g"`, `="common/5g"`), plus the schedule.
//
// The old "Tower Locking Settings" card does not survive as a card, and that is
// the point: nine of its rows were read-only status and three were settings
// that apply to both legs at once. Those are hero facts, and leaving them in a
// grid cell next to the controls is what made the page read as four unrelated
// panels.
//
// -----------------------------------------------------------------------------
// THE TWO CLOCKS (read before touching the hero)
// -----------------------------------------------------------------------------
// The hero's two panels are fed by sources that refresh at wildly different
// rates, and pretending otherwise would be the surface's biggest lie.
//
//   CAMPED ON  `carrier_components` from the poller snapshot. Live, ~4s. What
//              the radio is actually using this instant.
//   LOCK TARGET `modemState.lte_cells` / `.nr_cell`, read back from
//              `AT+QNWLOCK` by `status.sh` — which is fetched ONCE ON MOUNT and
//              never polled. It costs three AT commands on the shared
//              `/tmp/qmanager_at.lock` mutex the poller already contends for,
//              so putting it on an interval is a backend cost decision, not a
//              frontend one.
//
// Three things change the lock out of band: the schedule apply/clear timers,
// the failover watcher, and a second browser tab. So the rail prints an
// explicit "as of HH:MM" and offers a refresh, rather than letting a number
// that could be an hour old sit beside one that is four seconds old with
// nothing to tell them apart. This is the State-Honesty Rule applied to
// staleness rather than to content.
//
// -----------------------------------------------------------------------------
// THE ON-AIR TILE IS A PICKER, AND WHY THE TILE ITSELF IS NOT A BUTTON
// -----------------------------------------------------------------------------
// Tower locking targets an (EARFCN, PCI) pair. A carrier component already
// carries `earfcn`, `pci`, `band` and `rsrp` — so every tile in the on-air grid
// is describing a cell the user could lock to, and making them type those same
// digits into a text box underneath is the whole reason "Simple Mode" had to be
// invented as a second, parallel input path.
//
// But the tile is painted in an IDENTITY fill (NR blue / LTE violet), and the
// Identity-Never-Acts Rule is explicit: "no control is ever tinted by them."
// A whole-tile button would be exactly that — a violet control.
//
// So the tile stays a report and carries a small action pill INSIDE it, drawn
// in the tile's own ink via `carrierPillTone` — the same construction the
// identity/aggregation pills already use, and the established way this codebase
// puts an element on a saturated identity fill. The affordance lives on the
// pill, never on the fill.
//
// It reads better as UX too. A tile holding six discrete numbers is ambiguous
// as a single click target: a reader cannot tell whether the RSRP figure is
// itself actionable. One labelled control removes the guess.
//
// A carrier the user cannot currently lock to gets the pill in a DISABLED state
// with a reason, never a missing pill — an NR carrier is visible but not
// SA-lockable while the modem is in NSA mode, and silently dropping the control
// there would leave the user to infer the rule.
// =============================================================================

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/**
 * The page's anchor card. `rounded-hero` (40px) — one per surface.
 *
 * `shadow-whisper` as a bare utility does NOT resolve; it must go through the
 * custom property, as written.
 */
export const TOWER_HERO =
  "@container/hero flex flex-col gap-5 rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * One leg card (LTE / NR-SA / Schedule). `rounded-card` (36px) — a peer in a
 * grid, never a second hero. Imported by the loaded, loading AND gated branches
 * so the three can never again disagree about their own radius.
 */
export const TOWER_CARD =
  "@container/card flex flex-col gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 24px on a peer card, 28px on the hero (baked into TOWER_HERO). */
export const CARD_PAD = "px-6";

// -----------------------------------------------------------------------------
// The hero
// -----------------------------------------------------------------------------

/**
 * The hero's two-column shape. Both panels are `rounded-card` (36px), ONE STEP
 * BELOW the outer section's `rounded-hero` (40px) — not a second hero.
 * `TOWER_HERO` claims the page's one hero exception on its own; nesting two
 * hero-radius panels inside it would spend that exception twice.
 */
export const HERO_SPLIT =
  "flex flex-col gap-4 @2xl/hero:flex-row @2xl/hero:items-stretch";

/** The left panel: camped-on carrier tiles. Grows; the rail is the fixed side. */
export const HERO_ONAIR_PANEL =
  "@container/onair min-w-0 flex-1 flex flex-col gap-4 rounded-card bg-surface-container px-6 py-6";

/** The right panel: the lock-posture rail. Fixed width on a wide container,
 *  full width once the hero drops to one column. */
export const HERO_RAIL_PANEL =
  "flex w-full flex-none flex-col gap-3.5 rounded-card bg-surface-container px-5 py-6 @2xl/hero:w-[25rem]";

/**
 * The eyebrow above a hero panel's content.
 *
 * The generic craft floor treats an eyebrow as a reflex to delete. It is kept
 * because the committed world ships one: DESIGN.md's tile anatomy is literally
 * `eyebrow -> value -> caption`, and both the band-locking and custom-profiles
 * heroes already carry the identical step.
 */
export const HERO_EYEBROW =
  "text-xs font-medium tracking-[0.06em] text-on-surface-variant";

/**
 * The rail's own leading glyph disc — 44px, one step below the 52px `HERO_DISC`
 * used elsewhere in the product, because the rail is a nested panel rather than
 * the hero's own top-level anchor point.
 */
export const HERO_RAIL_DISC =
  "grid size-11 flex-none place-items-center rounded-pill bg-primary text-primary-foreground";

export const HERO_RAIL_TITLE = "text-base font-semibold";
export const HERO_RAIL_SUBTITLE = "text-[13px] text-on-surface-variant";

/**
 * One clickable leg row in the rail: leg name + its read-back lock target, a
 * status badge, and a chevron. The chevron is a REAL affordance — clicking the
 * row scrolls the matching leg card into view, because the rail and the cards
 * below describe the same two facts, and a rail that only summarised them
 * without linking to where they are changed would be restating the cards one
 * layer removed.
 */
export const HERO_RAIL_ROW =
  "group flex w-full items-center gap-3 rounded-field bg-surface px-4 py-3 text-left transition-colors duration-[var(--duration-quick)] ease-out hover:bg-surface-container-high focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

export const HERO_RAIL_ROW_LABEL = "text-sm font-semibold";

/**
 * The lock target under a rail row's leg name. Mono + tabular: an EARFCN and a
 * PCI are device identifiers, which the Machine-Voice Rule puts in the
 * machine's typeface.
 */
export const HERO_RAIL_ROW_TARGET =
  "font-mono text-xs text-on-surface-variant tabular-nums";

/**
 * A settings row at the foot of the rail (persist, failover, threshold).
 *
 * `rounded-field` (20px) rather than a metric-row pill, because these rows
 * WRAP: each carries a label, a help affordance and a control, and on a narrow
 * container those fall to a second line. A pill that has wrapped to two lines
 * is a stadium, not a pill, and the Radius-Follows-Size Rule puts a two-line
 * block on the field step.
 */
export const HERO_ROW =
  "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-field bg-surface px-4 py-3";

/** The last settings row, pinned to the rail's floor. */
export const HERO_ROW_LAST = `mt-auto ${HERO_ROW}`;

/**
 * The rail's freshness line — "as of HH:MM" plus the refresh affordance. See
 * THE TWO CLOCKS. It is deliberately typographically quiet: it qualifies the
 * rows above it rather than competing with them.
 */
export const HERO_STALENESS =
  "flex items-center gap-2 text-xs text-on-surface-variant";

/**
 * The refresh button beside it. A 22px glyph whose `before:` overlay reaches
 * the 44px this project requires on coarse pointers, without adding a layout
 * box that would push the timestamp off its baseline. Same construction as the
 * `Banner` dismiss button.
 */
export const HERO_REFRESH_BUTTON =
  "text-on-surface-variant hover:text-on-surface focus-visible:ring-ring/50 relative grid size-[1.375rem] flex-none place-items-center rounded-pill transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-[11px] before:content-[''] focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55";

/**
 * The inline help button used beside a settings-row label. Identical geometry
 * to `HERO_REFRESH_BUTTON` and restated rather than aliased, because the two
 * are the same SIZE by coincidence of the 44px floor, not by a shared meaning —
 * aliasing them would make a future change to one silently move the other.
 */
export const HERO_HELP_BUTTON = HERO_REFRESH_BUTTON;

// -----------------------------------------------------------------------------
// The camped-on carrier tile
// -----------------------------------------------------------------------------

/**
 * The wrapping tile grid: a fixed 3-column ceiling rather than `auto-fit`. The
 * tile carries a full metric anatomy plus an action pill, so `minmax(160px,1fr)`
 * would comb thin tiles across the panel where three legible ones read better.
 * A carrier count under 3 leaves empty cells rather than stretching — whitespace
 * below a mostly-empty grid reads as "nothing more to report", where a stretched
 * tile reads as a layout bug.
 *
 * Columns step with the panel's OWN container width (`@container/onair`,
 * declared on `HERO_ONAIR_PANEL`), not the viewport — the panel narrows
 * independently of the page whenever the hero drops to one column.
 */
export const HERO_ONAIR_GRID =
  "grid grid-cols-1 gap-3 @sm/onair:grid-cols-2 @lg/onair:grid-cols-3";

/**
 * The absent-leg cell that fills the solo layout's remaining column. Names the
 * radio that is NOT on air and offers the one action that would find it.
 *
 * `rounded-tile` and `bg-surface` match the empty state: both are "the thing
 * that is not a carrier", and they sit one step recessed from the panel's
 * `surface-container` so a reader can see at a glance which cells are live
 * radios and which are not.
 */
export const HERO_ONAIR_ABSENT = {
  ROOT: "flex flex-col gap-2 rounded-tile bg-surface px-4 py-3.5",
  DISC: "grid size-9 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  TITLE: "text-sm font-semibold",
  BODY: "text-on-surface-variant text-xs leading-relaxed text-pretty",
  LINK: "mt-auto inline-flex items-center gap-1.5 rounded-pill text-xs font-semibold text-primary transition-colors duration-[var(--duration-quick)] ease-out hover:text-primary/80 focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
} as const;

/**
 * One tile's anatomy: identity pill, band + PCI headline, the EARFCN/RSRP
 * detail line, the quality meter, then the action pill that makes this cell a
 * lock target.
 *
 * PCI IS THE HEADLINE HERE, not the band — that is the one place this tile
 * deliberately departs from the band-locking tile it is otherwise a sibling of.
 * On that surface the reader is choosing a frequency, so the band designator is
 * the answer; on this one they are choosing a physical cell, and PCI is its
 * name. Same anatomy, different value promoted, because the question the
 * surface asks is different.
 *
 * METER_TRACK carries NO fill of its own — see `carrierMeterTone`. PILL and
 * ACTION carry NO tone of their own — see `carrierPillTone`, which resolves
 * them against the tile's own ink for the same reason the meter does.
 */
export const HERO_ONAIR_TILE = {
  ROOT: "flex flex-col gap-2.5 rounded-tile px-5 py-4",
  /** The identity + aggregation pill(s) atop each tile. Sized to the Label
   *  typographic step (12px/500) — the same weight and size `chip-identity`
   *  ships, restated rather than imported because these pills carry no
   *  status/identity ROLE of their own, only the tile's own ink. */
  PILL: "inline-flex items-center rounded-pill px-3 py-1 text-xs font-medium",
  /**
   * The "use this cell" control. A real button, 32px tall with a `before:`
   * overlay reaching the 44px coarse-pointer floor — the tile is dense, so the
   * paint has to stay small while the target does not.
   *
   * It takes `carrierPillTone` rather than a role colour: it sits on a
   * saturated identity fill, and the tile's own `on-` ink is the single colour
   * guaranteed to contrast with that fill in both themes. A `primary` button
   * here would be brand-on-brand on an NR tile and invisible.
   */
  ACTION:
    "relative mt-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-pill px-3 text-xs font-semibold transition-[color,background-color] duration-[var(--duration-quick)] ease-out before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] focus-visible:ring-[3px] focus-visible:ring-current/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55",
  /**
   * `mt-auto` pins the meter to the tile's floor. Grid items stretch to the
   * tallest cell in their row and content length varies per carrier — one
   * missing PCI, EARFCN or RSRQ reading shortens a tile. Without this the meter
   * floats wherever the text stops and a row of tiles combs. Bottom-aligned,
   * the meters read as one comparable scale across the row.
   */
  METER_TRACK: "mt-auto h-[5px] overflow-hidden rounded-pill",
  METER_FILL: "h-full origin-left rounded-pill",
} as const;

/**
 * Tile tone: identity (LTE violet / NR blue), never quality — the SAME rule
 * `components/dashboard/carrier-aggregation.tsx`'s `tileTone()` and
 * band-locking's `carrierTileTone` already enforce, restated here rather than
 * imported so this surface takes no dependency on either module graph.
 *
 * `isLead` (this carrier's own `type === "PCC"`) gets the STRONG fill so the
 * anchor tile stays findable in a multi-tile grid; every other tile — SCC of
 * either radio — gets its CONTAINER fill. A quality-coloured tile would collide
 * with the identity fill it sits on, which is the "two container fills stacked"
 * problem `active-bands-card.tsx` already ruled out for its own status chip.
 */
export function carrierTileTone(
  technology: "LTE" | "NR",
  isLead: boolean,
): string {
  if (technology === "NR") {
    return isLead
      ? "bg-primary text-primary-foreground"
      : "bg-primary-container text-on-primary-container";
  }
  return isLead
    ? "bg-lte text-lte-foreground"
    : "bg-lte-container text-on-lte-container";
}

/**
 * The tone for any chip or button sitting INSIDE a tile, resolved against that
 * tile's own ink. A pill on a saturated identity fill needs a background
 * distinguishable from that fill without introducing a second colour; an alpha
 * over the tile's own ink reads as "the tile's fill, one step up" in both
 * themes, where a literal `surface`/`surface-container` chip would fight the
 * identity fill it sits on.
 *
 * `interactive` raises the resting alpha and adds a hover step. The action pill
 * has to read as pressable against five other elements in a dense tile, and at
 * the resting 12-15% of a static chip it did not.
 *
 * This is not a Solid-Container Rule violation, for the reason
 * `carrierMeterTone` also states: the alpha resolves over a KNOWN opaque fill
 * (the tile), not over an unknown page background.
 *
 * EVERY BRANCH IS A COMPLETE LITERAL CLASS STRING, and that is load-bearing
 * rather than verbose. Tailwind extracts classes by scanning source text, so a
 * name assembled at runtime (`bg-${ink}/25`) is never emitted into the
 * stylesheet and the element renders with no background at all — a failure that
 * type-checks, builds clean, and only shows up on screen.
 */
export function carrierPillTone(
  technology: "LTE" | "NR",
  isLead: boolean,
  interactive = false,
): string {
  if (isLead) {
    if (technology === "NR") {
      return interactive
        ? "bg-primary-foreground/25 text-primary-foreground enabled:hover:bg-primary-foreground/35"
        : "bg-primary-foreground/15 text-primary-foreground";
    }
    return interactive
      ? "bg-lte-foreground/25 text-lte-foreground enabled:hover:bg-lte-foreground/35"
      : "bg-lte-foreground/15 text-lte-foreground";
  }
  if (technology === "NR") {
    return interactive
      ? "bg-on-primary-container/20 text-on-primary-container enabled:hover:bg-on-primary-container/30"
      : "bg-on-primary-container/12 text-on-primary-container";
  }
  return interactive
    ? "bg-on-lte-container/20 text-on-lte-container enabled:hover:bg-on-lte-container/30"
    : "bg-on-lte-container/12 text-on-lte-container";
}

/**
 * The meter's track AND fill, resolved RELATIVE TO THE TILE THEY SIT IN.
 *
 * THIS TAKES `isLead` FOR A REASON — a signature dropped during an earlier port
 * WAS the bug. A lead tile paints `bg-lte` (or `bg-primary`); if the meter fill
 * also paints `bg-lte`, then on every PCC tile — the one carrier that is always
 * present — the fill is invisible and all a reader sees is a bare track. A
 * fixed `bg-surface` track makes it worse: correct against a card, but inside a
 * saturated identity fill it is not "recessed", it is a hole punched through
 * the tile.
 *
 * The rule that composes: a meter nested in a tonal container draws itself in
 * that container's OWN INK — the `on-` token, the single colour guaranteed to
 * contrast with the fill in both themes. Track is that ink at low alpha, fill
 * is the ink at full strength.
 *
 *   lead (strong fill)      track `*-foreground/25`     fill `*-foreground`
 *   secondary (container)   track `on-*-container/15`   fill `*` (strong)
 *
 * Tone stays IDENTITY, never quality. The bar reports WHICH RADIO; the dBm
 * label directly above it already reports HOW WEAK.
 */
export function carrierMeterTone(
  technology: "LTE" | "NR",
  isLead: boolean,
): { track: string; fill: string } {
  if (isLead) {
    return technology === "NR"
      ? { track: "bg-primary-foreground/25", fill: "bg-primary-foreground" }
      : { track: "bg-lte-foreground/25", fill: "bg-lte-foreground" };
  }
  return technology === "NR"
    ? { track: "bg-on-primary-container/15", fill: "bg-primary" }
    : { track: "bg-on-lte-container/15", fill: "bg-lte" };
}

// -----------------------------------------------------------------------------
// Form fields (the leg cards)
// -----------------------------------------------------------------------------

/**
 * A leg card's field grid. Two columns on a wide card, one when it narrows —
 * against the CARD's own container, not the viewport, because these cards sit
 * in a 2-up page grid that collapses independently of the window.
 */
export const FIELD_GRID = "grid grid-cols-1 gap-x-4 gap-y-4 @md/card:grid-cols-2";

/** One field's label. 12px/500 — the Label step. */
export const FIELD_LABEL =
  "flex items-center gap-1.5 text-xs font-medium text-on-surface-variant";

/**
 * Input and select shape: 20px radius, 42px tall, `surface-container` fill, no
 * visible border at rest. Restated here because `components/ui/input.tsx` still
 * defaults to the legacy `rounded-md` + transparent fill (DESIGN.md > Migration
 * Deltas: "Shape lives at the call site, not in the primitives").
 *
 * The incumbent fields were `h-9` text inputs and a `w-10 h-6` threshold box —
 * 24px against this project's stated 44px floor, on a page used roadside on a
 * tablet.
 *
 * THE `dark:` OVERRIDE IS NOT REDUNDANT. `components/ui/input.tsx` ships
 * `dark:bg-input/30`, and `@custom-variant dark (&:is(.dark *))` compiles that
 * to `.dark * .bg-input\/30` — specificity (0,2,0) against a bare
 * `bg-surface-container`'s (0,1,0). tailwind-merge cannot fold the two either,
 * because they sit in different modifier scopes and it only collapses conflicts
 * within one scope. Without the explicit `dark:` restatement below, every field
 * on this surface silently renders `input/30` in dark mode instead of the
 * container step — the fill looks approximately right, which is exactly why it
 * would have survived review.
 */
export const FIELD_CONTROL =
  "h-[2.625rem] rounded-field border-0 bg-surface-container dark:bg-surface-container px-3.5 text-sm shadow-none focus-visible:ring-ring/50 focus-visible:ring-[3px]";

/**
 * The same field shape for a `SelectTrigger`, which needs two more overrides
 * than an `Input` does.
 *
 * `components/ui/select.tsx` sets its height as `data-[size=default]:h-9` —
 * again (0,2,0) via the attribute selector, so a bare `h-[2.625rem]` loses and
 * every select renders 36px beside 42px inputs. The height therefore has to be
 * restated AT MATCHING SPECIFICITY rather than just repeated. It also ships
 * `dark:hover:bg-input/50`, which has to be neutralised for the same reason as
 * the resting fill — and because the canon is explicit that a field's fill does
 * not change on interaction.
 *
 * Both leg cards hit this independently and patched it locally; it lives here
 * so they cannot drift apart.
 */
export const SELECT_CONTROL = [
  FIELD_CONTROL,
  "w-full justify-between",
  "data-[size=default]:h-[2.625rem]",
  "dark:hover:bg-surface-container",
].join(" ");

/** A slot's grouping block inside the LTE card — three of these stack. */
export const FIELD_SLOT =
  "flex flex-col gap-3 rounded-tile bg-surface-container/60 p-4";

/** The slot's own heading row ("Cell 1", plus its clear affordance). */
export const FIELD_SLOT_HEAD =
  "flex items-center justify-between gap-2 text-xs font-semibold text-on-surface-variant";

// -----------------------------------------------------------------------------
// The schedule day chip
// -----------------------------------------------------------------------------

/**
 * One weekday toggle.
 *
 * This replaces the surface's single worst line: a `Toggle variant="outline"`
 * whose pressed state was signalled by an arbitrary-child selector painting a
 * dot `bg-blue-500`. That is a raw Tailwind palette value in an OKLCH-only
 * system — it does not theme, it does not derive from the mark, and it is the
 * one colour on the page that is the same in light and dark.
 *
 * Same two-channel construction as the band chip, minus the live ring: there is
 * no "configured on the modem" fact for a weekday, only selected or not. Fill
 * is `primary-container` when selected — brand, not a functional role, because
 * a chosen day is not a HEALTHY day.
 */
export const DAY_CHIP = {
  ROW: "flex flex-wrap gap-2",
  /**
   * `size-11` is 44px square — the coarse-pointer floor met by the paint
   * itself rather than by an overlay, because seven of these sit in a row and
   * overlapping `before:` targets would make the gaps unhittable.
   */
  ROOT: [
    "relative inline-flex size-11 items-center justify-center rounded-pill",
    "text-xs font-semibold select-none",
    "transition-[color,background-color] duration-[var(--duration-standard)] ease-standard",
    "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-55",
  ].join(" "),
  SKELETON: "size-11 rounded-pill",
} as const;

/**
 * Day-chip fill by selected state. Both hovers are `enabled:`-scoped —
 * Tailwind's `hover:` does not exclude a disabled element on its own, so an
 * unscoped hover would light up every chip on a card whose schedule is off,
 * advertising an interaction that is switched off.
 */
export function dayChipFill(selected: boolean): string {
  return selected
    ? "bg-primary-container text-on-primary-container enabled:hover:bg-primary-container/80"
    : "bg-surface-container text-on-surface-variant enabled:hover:bg-surface-container-high";
}

// -----------------------------------------------------------------------------
// Inline notice
// -----------------------------------------------------------------------------

/**
 * The card- and hero-scoped notice.
 *
 * This replaces two legacy tells at once: `carrier-label.tsx`'s
 * `border-success/40 text-success bg-success/10` — a 10% wash propped up by a
 * 40% hairline drawn to compensate for it — and the whole-card `opacity-60`
 * that served as the NR-SA card's disabled treatment while dimming its own
 * explanatory text below contrast.
 *
 * A 10% alpha over a tinted surface is not a stable colour: it collapses in
 * dark mode and it is the first thing to wash out in sunlight, which is the
 * exact ambient condition this product is designed against.
 *
 * `rounded-field` (20px) so it never out-rounds the 36px card hosting it.
 */
export const NOTICE = {
  ROOT: "flex items-start gap-3 rounded-field px-4 py-3 text-sm",
  /** Glyph-Disc Rule: the icon sits in a filled circle on the role's STRONG fill. */
  DISC: "grid size-7 flex-none place-items-center rounded-pill",
  /** The dismiss affordance on a warning notice. See NOTICE_TONE. */
  DISMISS:
    "relative -mr-1 grid size-6 flex-none place-items-center rounded-pill transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-2.5 before:content-[''] hover:bg-current/10 focus-visible:ring-[3px] focus-visible:ring-current/40 focus-visible:outline-none",
} as const;

/**
 * Notice tones. Three roles, three glyphs, no shared marks.
 *
 * `warning` is the partial-success channel — the write landed but something
 * beside it did not (`service_enable_failed`, `persist_command_failed`). It is
 * deliberately NOT `destructive`: the radio IS locked, and painting that red
 * would tell the user their lock failed when it did not.
 */
export const NOTICE_TONE: Record<
  "destructive" | "warning" | "info",
  { fill: string; disc: string; glyph: MaterialSymbolName }
> = {
  destructive: {
    fill: "bg-destructive-container text-on-destructive-container",
    disc: "bg-destructive text-destructive-foreground",
    glyph: "error",
  },
  warning: {
    fill: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    glyph: "warning",
  },
  info: {
    fill: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    glyph: "info",
  },
};

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/**
 * The action pill. Identical string to `radio/page-header.tsx`'s `PILL_ACTION`
 * and the band-locking contract — restated rather than imported so this surface
 * takes no dependency on an unrelated route's module graph.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/** The same pill without a leading-glyph gap, for a text-only action. */
export const PILL_ACTION_PLAIN =
  "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";

/**
 * The quiet affordances (Clear all, Fill from scan). Deliberately smaller than
 * the real actions: they change a FORM, they do not write to the modem, and
 * sizing them like `Lock` would put three equal-weight pills in one footer and
 * lose which of them is consequential.
 *
 * Carries no fill or ink of its own — pair with `variant="tonal-neutral"`,
 * never `variant="ghost"`. A ghost button has no resting fill, so next to a
 * filled primary it reads as disabled rather than as a quieter action.
 */
export const PILL_QUIET = "h-9 rounded-pill px-3.5 text-xs font-semibold";

// -----------------------------------------------------------------------------
// Status chips
// -----------------------------------------------------------------------------

/** Badge glyph size. Matches the `[&>svg]:size-3` slot `Badge` reserves. */
export const BADGE_GLYPH_SIZE = 12;

/** Which failover state is in force. See `FAILOVER_BADGE` for why there are four. */
export type TowerFailoverKey =
  | "disabled"
  | "standby"
  | "armed"
  | "fallback";

/**
 * Failover state -> Badge variant + glyph.
 *
 * Keyed onto `BadgeVariant` rather than a class string, so a fifth state
 * without a matching role fails the build instead of shipping untinted.
 *
 * FOUR STATES, AND THE BAND-LOCKING MAP'S THREE DO NOT TRANSFER. Band locking
 * ships `monitoring` as `info` + a SPINNING `progress_activity`, which is
 * correct there: `qmanager_band_failover` runs MAX_CHECKS=5 at
 * CHECK_INTERVAL=5 and exits after ~30s, so a spinner describes a bounded
 * operation that genuinely ends.
 *
 * `qmanager_tower_failover` is `while true`. It settles 20s, checks every 20s,
 * and exits only once no lock is active. A spinner copied across would run for
 * the entire life of the lock — reading as a hung UI, and breaking the One-Loop
 * Rule ("only where something is genuinely live" means live WORK, not a live
 * process). So the running state here is `armed`: a settled, steady, reassuring
 * fact, drawn with a shield rather than a spinner.
 *
 * `standby` is the state band locking has no equivalent for: failover is
 * switched on but NO lock exists, so no watcher is running and there is nothing
 * to protect. Calling that "armed" would claim a safety net that is not
 * deployed. It routes to the brand container under the Info-Is-Brand Rule —
 * a standing condition, not a fault.
 *
 * Every state carries a DISTINCT glyph. `armed` and `fallback` are the pair
 * that makes this mandatory rather than tidy: `success-container` and
 * `warning-container` measure 1.03:1 apart and are the SAME surface under
 * deuteranopia, so the glyph is the only channel separating "the safety net is
 * watching" from "the safety net has fired and your lock is not in force".
 */
export const FAILOVER_BADGE: Record<
  TowerFailoverKey,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  // Deliberately off, not broken. `muted`, never `destructive`.
  disabled: { variant: "muted", glyph: "do_not_disturb_on" },
  standby: { variant: "info", glyph: "schedule" },
  armed: { variant: "success", glyph: "shield" },
  // Degraded but running: the modem is connected, just not where you told it.
  fallback: { variant: "warning", glyph: "warning" },
};

/**
 * Resolve the failover chip from the two flags plus whether any lock exists.
 *
 * `activated` outranks `watcher_running`: a watcher that has already fired is
 * reporting a fallback, not protection, even while it keeps looping.
 */
export function failoverKey(
  failover: { enabled: boolean; activated: boolean; watcher_running: boolean },
  hasActiveLock: boolean,
): TowerFailoverKey {
  if (!failover.enabled) return "disabled";
  if (failover.activated) return "fallback";
  if (failover.watcher_running) return "armed";
  // Enabled, nothing fired, no watcher: either there is no lock to guard, or
  // the watcher has not spawned yet. Both are honestly "not currently guarding".
  return hasActiveLock ? "armed" : "standby";
}

/** One radio leg's lock posture. */
export type LegPosture = "locked" | "unlocked" | "unknown";

/**
 * Leg status -> Badge variant + glyph.
 *
 * `locked` is `warning` and `unlocked` is `success`, which is a deliberate
 * reading of the functional contract rather than a value judgement: pinning the
 * radio to one physical cell is the state that can cost you the connection, and
 * `warning` means "constrained", not "you did something wrong". The same
 * inversion band locking applies to a narrowed band list, for the same reason.
 *
 * `unknown` is a real state, not a loading placeholder: `status.sh` cannot
 * distinguish a failed `AT+QNWLOCK` read from "not locked" — `tower_lock_mgr.sh`
 * prints `error` and `status.sh` logs it and leaves the flag false. A surface
 * that renders that as a confident "Unlocked" is asserting something nobody
 * read back.
 */
export const LEG_BADGE: Record<
  LegPosture,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  locked: { variant: "warning", glyph: "lock" },
  unlocked: { variant: "success", glyph: "lock_open" },
  unknown: { variant: "muted", glyph: "schedule" },
};

/**
 * Persist state -> chip. Reads the MODEM's report, not the config file's
 * intention — see `persistPosture`.
 */
export const PERSIST_BADGE: Record<
  "on" | "off" | "split" | "unknown",
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  on: { variant: "success", glyph: "check_circle" },
  off: { variant: "muted", glyph: "do_not_disturb_on" },
  // The modem reports the two radios disagreeing. `AT+QNWLOCK="save_ctrl",v,v`
  // writes ONE value to both slots, so a split reading means one of them did
  // not take — a real, reportable fault, not a configuration the user chose.
  split: { variant: "warning", glyph: "warning" },
  unknown: { variant: "muted", glyph: "schedule" },
};

/**
 * What the MODEM says about lock persistence, which is not necessarily what the
 * config file says.
 *
 * `tower_set_persist` sends `AT+QNWLOCK="save_ctrl",$val,$val` — the same value
 * to both radios — but `tower_read_persist` returns them independently and
 * `status.sh` surfaces them as two fields. The incumbent UI rendered
 * `config.persist` (the file's belief) and never read either, so a modem
 * reporting `1,0` displayed as a confident "Enabled".
 */
export function persistPosture(
  modemState: { persist_lte: boolean; persist_nr: boolean } | null,
): "on" | "off" | "split" | "unknown" {
  if (!modemState) return "unknown";
  if (modemState.persist_lte && modemState.persist_nr) return "on";
  if (!modemState.persist_lte && !modemState.persist_nr) return "off";
  return "split";
}

// -----------------------------------------------------------------------------
// Skeleton mirrors
// -----------------------------------------------------------------------------

/**
 * Loaded geometry, restated once so the skeletons mirror it by IMPORT rather
 * than by estimate. The incumbent loading branches guessed `h-9 w-full
 * rounded-md` for inputs that render at 42px with a 20px radius, and `h-5 w-20`
 * for a Switch-plus-Label pair — a skeleton that mirrors nothing makes the
 * handoff jump worse, not better.
 *
 * Sizes are the loaded element's LINE BOX, not its font size: a skeleton sized
 * to the glyph reflows the moment real text lands.
 */
export const SKELETON_SHAPE = {
  /** Card title (18px/600) and description (14px) line boxes. */
  CARD_TITLE: "h-5 w-32",
  CARD_DESC: "h-4 w-52",
  /** The status chip in a card header. */
  CARD_CHIP: "h-5 w-24",
  /** One form field: its 12px label line box, then the 42px control. */
  FIELD_LABEL: "h-3 w-24",
  FIELD_CONTROL: "h-[2.625rem] w-full rounded-field",
  /** The footer's primary action, at the real 42px pill height. */
  ACTION: "h-[2.625rem] w-36 rounded-pill",
  ACTION_SECONDARY: "h-[2.625rem] w-40 rounded-pill",
  /** Hero rail: disc, subtitle, one leg row, one settings row. */
  HERO_DISC: "size-11 rounded-pill",
  HERO_SUBTITLE: "h-3.5 w-40",
  RAIL_ROW: "h-[3.375rem] w-full rounded-field",
  HERO_ROW: "h-[3.25rem] w-full rounded-field",
  /** One camped-on tile. Taller than band locking's because of the action pill. */
  ONAIR_TILE: "h-[10.5rem] rounded-tile",
  /** One weekday chip. */
  DAY_CHIP: DAY_CHIP.SKELETON,
} as const;

// -----------------------------------------------------------------------------
// Leg identity
// -----------------------------------------------------------------------------

/** The two radio legs this surface can lock, in reading order. */
export const TOWER_LEGS = ["lte", "nr_sa"] as const;
export type TowerLeg = (typeof TOWER_LEGS)[number];

/**
 * The i18n key stem for a leg's copy.
 *
 * THIS EXISTS TO KILL A CLASS OF TRANSLATION BUG BEFORE IT IS WRITTEN. The
 * pattern band locking had to remove was toast copy built by string surgery on
 * a rendered English title (`title.replace(" Locking", "")`), which silently
 * stops matching the moment those titles are translated — and no gate can see
 * it, because `i18n:check` grades missing keys as warnings and exits 0, and a
 * literal has no key to be missing in the first place.
 *
 * Keying off the LEG rather than off rendered text means the two cannot drift,
 * in any locale.
 */
export function legTitleKey(leg: TowerLeg): string {
  return `tower_locking.legs.${leg}.title`;
}

export function legDescriptionKey(leg: TowerLeg): string {
  return `tower_locking.legs.${leg}.description`;
}

export function legShortKey(leg: TowerLeg): string {
  return `tower_locking.short.${leg}`;
}
