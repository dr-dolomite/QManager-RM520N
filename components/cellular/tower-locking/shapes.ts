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
// Two kinds of object:
//
//   1. THE HERO is the STANDING ORDERS — what this lock does when nobody is
//      watching: across a reboot, during a signal collapse, and on a clock.
//      Its three tiles are the page's headline, and above them a compact LIVE
//      STRIP states the premise those orders act on: the verdict, and what the
//      radio is camped on right now. See THE LIVE STRIP below.
//   2. THE LEG CARDS are where the target changes, and the single place a leg's
//      own state is reported. One per AT lock parameter
//      (`AT+QNWLOCK="common/4g"`, `="common/5g"`).
//
// Three earlier arrangements are worth recording as things NOT to restore.
//
// A 2x2 grid put a read-only status card and three control surfaces on the page
// as visual peers, which said all four were the same kind of object. Replacing
// it with a hero fixed that, but left the hero carrying three settings rows in
// its rail and left the schedule as an orphaned third cell in a 2-up grid — so
// the page still read as "status, controls, and a leftover".
//
// Grouping the three unattended behaviours into a card of their own fixed the
// orphan, but left the page led by a THREE-COLUMN MATCH LINE — locked target,
// verdict, camped on now — whose left column restated, one layer removed, the
// two facts the leg cards below already carry: which leg is locked, and to what.
// A reader met the same pair of numbers twice before reaching a single control.
// So the locked-target column is gone, its one non-duplicated fact (the modem's
// AT read-back, as against the config the forms are seeded from) moved INTO the
// leg card that owns it, and the automation group was promoted from the page's
// last card to its hero. What is left of the match line is a strip, not a grid.
//
// -----------------------------------------------------------------------------
// THE TWO CLOCKS (read before touching the hero)
// -----------------------------------------------------------------------------
// The two facts the live strip compares are fed by sources that refresh at
// wildly different rates, and pretending otherwise would be the surface's
// biggest lie.
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
// the failover watcher, and a second browser tab. So the verdict prints an
// explicit "as of HH:MM" and offers a refresh, rather than letting a number
// that could be an hour old sit beside one that is four seconds old with
// nothing to tell them apart. This is the State-Honesty Rule applied to
// staleness rather than to content.
//
// The SAME stamp is why the leg card's read-back line is captioned "Modem
// reports" rather than printed bare: that line is on the slow clock while the
// form fields beside it are the config's live view, and a reader who cannot
// tell which is which has no way to interpret a disagreement between them.
//
// -----------------------------------------------------------------------------
// THE CAMPED CELL IS A PICKER, AND WHY THE BLOCK ITSELF IS NOT A BUTTON
// -----------------------------------------------------------------------------
// Tower locking targets an (EARFCN, PCI) pair. A carrier component already
// carries `earfcn`, `pci`, `band` and `rsrp` — so every carrier the radio
// reports is describing a cell the user could lock to, and making them retype
// those same digits into a text box underneath is the whole reason "Simple
// Mode" had to be invented as a second, parallel input path.
//
// The block stays a REPORT and carries a small labelled action inside it, never
// becoming one big button. A block holding six discrete numbers is ambiguous as
// a single click target: a reader cannot tell whether the RSRP figure is itself
// actionable. One labelled control removes the guess.
//
// NEITHER THE LEAD BLOCK NOR THE ROWS ARE IDENTITY-FILLED ANY MORE, and that is
// what lets both pickers be ordinary neutral controls. The lead used to paint
// `bg-primary` / `bg-lte` at 172px tall, which made it the largest object on a
// page whose subject is a settings group, and forced its own controls and meter
// to be drawn as alphas over the fill (`carrierPillTone`, `carrierMeterTone` —
// both retired with it). Identity now travels on the `Badge variant="nr"|"lte"`
// each row already carries, which is the one element in this system whose fill
// and ink are guaranteed to agree, and the lead is distinguished by ANATOMY
// instead of by area: two lines against the secondaries' one.
//
// A carrier the user cannot currently lock to gets its control in a DISABLED
// state with a reason, never a missing control — an NR carrier is visible but
// not SA-lockable while the modem is in NSA mode, and silently dropping the
// affordance there would leave the user to infer the rule.
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
// The hero's premise: THE LIVE STRIP
// -----------------------------------------------------------------------------
// Two parts, read left to right as one clause:
//
//     VERDICT   ▸   CAMPED ON NOW
//
// The verdict is the only genuinely NEW fact this page can compute — neither the
// modem's lock read-back nor the poller's carrier list carries it alone — so it
// leads. What the radio is camped on is the evidence behind it, and it stays on
// screen because every row in it is a lock target one click from a form.
//
// It is a STRIP and not the page's subject. The three-column match line this
// replaces was 400px tall and led the page with a comparison whose left operand
// the leg cards below already printed; the tiles under this strip are what the
// reader came to set. So the verdict drops from a 176px centred tile to a
// left-aligned block, and the camped lead from a 172px identity-filled tile to
// two compressed lines. Every READING survives — the PCI headline, the channel,
// RSRP, RSRQ and SINR are all still on the lead — at roughly a third of the
// area. The lead's signal meter is the one thing genuinely cut; see
// `CAMPED_LEAD` for why it was a false border rather than a gauge.
// -----------------------------------------------------------------------------

/**
 * The strip's two columns.
 *
 * The verdict column is a fixed `15rem`: it holds a state word and one line of
 * consequence, so letting it flex would stretch a two-word conclusion across
 * half the hero. Everything else goes to the carrier list, which is the part
 * with a variable number of rows.
 *
 * `items-start`, NOT `items-stretch`, and that is a correction rather than a
 * preference. Stretching made the verdict as tall as a three-carrier list and
 * left ~90px of empty container between its body copy and its stamp — on a
 * SATURATED `success-container`, where a void is the loudest thing in the hero.
 * A conclusion sizes to itself; only the list it judges grows.
 */
export const STRIP_GRID =
  "grid grid-cols-1 gap-3 @3xl/hero:grid-cols-[15rem_minmax(0,1fr)] @3xl/hero:items-start";

/**
 * The carrier half of the strip. `rounded-tile` (28px) rather than the retired
 * match panel's `rounded-card` (36px) — Radius-Follows-Size, and it makes the
 * strip a peer of the automation tiles below it rather than a third rank between
 * them and the `rounded-hero` section. `TOWER_HERO` claims the page's one hero
 * exception on its own.
 */
export const STRIP_PANEL =
  "@container/panel flex min-w-0 flex-col gap-2.5 rounded-tile bg-surface-container px-4 py-3.5";

/** A panel's eyebrow row: the label, plus whatever qualifies it on the right. */
export const STRIP_HEAD = "flex flex-wrap items-center gap-2.5";

/**
 * The quiet line at a panel's floor. `mt-auto` pins it, because the two strip
 * columns stretch to the taller of them and a footnote floating mid-panel reads
 * as an orphan rather than as a caption.
 */
export const STRIP_FOOTNOTE =
  "text-on-surface-variant mt-auto flex items-start gap-2 text-xs leading-relaxed text-pretty";

/**
 * The verdict block.
 *
 * A condition block at strip scale: a filled glyph disc, a state word, one line
 * of consequence, and the freshness stamp. The disc is mandatory rather than
 * decorative — the Glyph-Disc Rule exists because `success-container` and
 * `warning-container` measure 1.03:1 apart and are the SAME surface under
 * deuteranopia, so the container fill cannot be the channel that separates "on
 * target" from "not on target". The disc, painted on the role's STRONG fill, is.
 *
 * LEFT-ALIGNED, where the retired tile was centred. Centring is what made that
 * block read as the page's headline metric; at strip scale the verdict is a
 * sentence about the tiles below it, and a sentence starts at the left margin.
 *
 * STAMP is load-bearing and is the reason this is not just a chip. The verdict
 * compares a reading that is ~4s old (the camped carriers, from the poller)
 * against one fetched ONCE ON MOUNT and never polled (the lock read-back), so it
 * is only ever as fresh as its stalest operand — and the stamp plus the re-read
 * control therefore live ON it rather than in a corner of the page. It carries
 * NO `mt-auto`: the block sizes to its content now (see `STRIP_GRID`), so
 * pinning the stamp to a floor would only reopen the void that removed.
 */
export const VERDICT_BLOCK = {
  ROOT: "flex min-w-0 flex-col gap-2 rounded-tile px-4 py-3.5",
  HEAD: "flex items-center gap-2.5",
  DISC: "grid size-9 flex-none place-items-center rounded-pill",
  TITLE: "text-sm font-semibold",
  BODY: "text-xs leading-relaxed text-pretty opacity-90",
  STAMP: "flex items-center gap-1.5 pt-0.5 text-xs",
} as const;

/** Whether the radio is on the cell the modem says it was told to hold. */
export type TowerMatchVerdict =
  | "on_target"
  | "off_target"
  | "unverified"
  | "unlocked"
  | "unknown";

/**
 * Verdict -> container fill, disc fill, glyph.
 *
 * THE THREE NEUTRAL VERDICTS CARRY THREE DIFFERENT GLYPHS, which is mandatory
 * rather than tidy: they share one slot, they share one fill, and the glyph is
 * the only thing distinguishing "nothing was asked for" from "nobody has read
 * the modem yet" from "there is nothing on air to compare against".
 *
 * `unlocked` is NEUTRAL, not `success` — and that is deliberately the opposite
 * reading from `LEG_BADGE`, which paints an unlocked leg green. The two answer
 * different questions. `LEG_BADGE` asks "is this radio constrained?", where
 * unconstrained is the safe state. The verdict asks "are you where you asked to
 * be?", and with no lock in force there was no ask — so the honest answer is
 * "nothing to match", which is neither good news nor bad.
 *
 * The neutral fill is `surface-container`, matching the two panels beside it, so
 * a neutral verdict reads as a third panel rather than as a hole in the hero.
 * `bg-surface` would be the hero's own fill and would render the block invisible.
 */
export const VERDICT_TONE: Record<
  TowerMatchVerdict,
  { fill: string; disc: string; glyph: MaterialSymbolName }
> = {
  on_target: {
    fill: "bg-success-container text-on-success-container",
    disc: "bg-success text-success-foreground",
    glyph: "check_circle",
  },
  // Config says one thing, the radio says another. WARNING, never destructive:
  // the modem is connected, it is simply not where it was told to be.
  off_target: {
    fill: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    glyph: "warning",
  },
  unverified: {
    fill: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    glyph: "help",
  },
  unlocked: {
    fill: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    glyph: "lock_open",
  },
  unknown: {
    fill: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    glyph: "schedule",
  },
};

/**
 * Is the radio camped on a cell the modem reports as a lock target?
 *
 * Structural parameter types rather than imports from `types/tower-locking.ts`,
 * matching `persistPosture` below: this module is a geometry and tone contract
 * and takes no dependency on the response schema.
 *
 * A leg counts as matched when SOME camped carrier of that radio family carries
 * the exact (channel, PCI) pair the modem reports as a target. LTE may hold up
 * to three targets and the radio only has to be on ONE of them — that is what
 * the three slots MEAN, so requiring all three would report a working multi-cell
 * lock as a fault.
 *
 * A leg locked to a radio family that has no carrier on air at all resolves to
 * `off_target`, and that is correct rather than pedantic: an LTE lock the modem
 * is not honouring because it is registered 5G-SA is a lock that is not in
 * force, and saying so is the point of the verdict.
 */
export function matchVerdict(
  modemState: {
    lte_locked: boolean;
    lte_cells: { earfcn: number; pci: number }[];
    nr_locked: boolean;
    nr_cell: { arfcn: number; pci: number } | null;
  } | null,
  onAir: {
    technology: "LTE" | "NR";
    earfcn: number | null;
    pci: number | null;
  }[],
): TowerMatchVerdict {
  if (!modemState) return "unknown";

  const lteTargets = modemState.lte_locked ? (modemState.lte_cells ?? []) : [];
  const nrTarget = modemState.nr_locked ? modemState.nr_cell : null;
  if (lteTargets.length === 0 && nrTarget === null) return "unlocked";

  // Locked, but the radio has reported nothing to compare against. Neither
  // "on target" nor "off target" is a claim anyone can stand behind here.
  if (onAir.length === 0) return "unverified";

  const camped = (
    technology: "LTE" | "NR",
    channel: number,
    pci: number,
  ): boolean =>
    onAir.some(
      (c) =>
        c.technology === technology && c.earfcn === channel && c.pci === pci,
    );

  const lteOk =
    lteTargets.length === 0 ||
    lteTargets.some((cell) => camped("LTE", cell.earfcn, cell.pci));
  const nrOk =
    nrTarget === null || camped("NR", nrTarget.arfcn, nrTarget.pci);

  return lteOk && nrOk ? "on_target" : "off_target";
}

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

/** The line under the hero's own title. */
export const HERO_DESCRIPTION =
  "text-sm text-on-surface-variant leading-relaxed text-pretty";

/**
 * The MODEM READ-BACK line inside a leg card, directly under its status chip.
 *
 * THIS IS THE ONE FACT THE RETIRED LOCKED-TARGET PANEL CARRIED THAT NOTHING ELSE
 * DID, and moving it here is what makes deleting that panel a distillation
 * rather than a loss.
 *
 * A leg card's form fields are seeded from `config` — the file's intention — and
 * its status chip reports `modemState.*_locked`. Neither says WHICH cells the
 * modem itself reports as its targets, so a config that drifted from the radio
 * (a schedule timer fired, the failover watcher released the lock, a second tab
 * wrote something else) was previously visible only in the hero, one scroll away
 * from the fields it contradicted. Printed here it sits inches from the values
 * it disagrees with, which is the only place a disagreement is actionable.
 *
 * It is a captioned list and not a chip row, because LTE can hold three pairs
 * and the caption is doing real work: see THE TWO CLOCKS on why "Modem reports"
 * has to be said out loud rather than implied.
 *
 * ROW is `min-h-8` and not the 44px metric-row floor on purpose — it carries no
 * control, so no coarse-pointer target applies to it. The optional "on air" chip
 * inside it is the same `Badge` the strip uses, so the two views of "the radio
 * settled on this pair" can never disagree about how they say it.
 */
export const READBACK = {
  ROOT: "flex flex-col gap-1 rounded-field bg-surface-container px-4 py-2.5",
  LABEL:
    "flex items-center gap-1.5 text-xs font-medium text-on-surface-variant",
  LIST: "flex flex-col gap-0.5",
  ROW: "flex min-h-8 flex-wrap items-center gap-x-2.5 gap-y-1",
  /** Mono + tabular: a channel and a PCI are device identifiers, which the
   *  Machine-Voice Rule puts in the machine's typeface. */
  VALUE: "font-mono text-[13px]/5 font-semibold tabular-nums",
} as const;

/**
 * The refresh button beside the freshness stamp. A 22px glyph whose `before:`
 * overlay reaches the 44px this project requires on coarse pointers, without
 * adding a layout box that would push the timestamp off its baseline. Same
 * construction as the `Banner` dismiss button.
 *
 * Colour is inherited rather than declared: this button sits inside the verdict
 * block, whose fill changes with the verdict, and a hardcoded
 * `on-surface-variant` would be a neutral grey on a warning container. The stamp
 * that hosts it is `VERDICT_BLOCK.STAMP`, which inherits for the same reason —
 * they were two constants until the freshness line stopped being reusable.
 */
export const HERO_REFRESH_BUTTON =
  "relative grid size-[1.375rem] flex-none place-items-center rounded-pill opacity-80 transition-opacity duration-[var(--duration-quick)] ease-out before:absolute before:-inset-[11px] before:content-[''] hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-current/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45";

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

// ONE CARRIER LEADS, THE REST ARE A LIST.
//
// Aggregation is context here, not the subject. `AT+QNWLOCK` pins a PRIMARY
// cell; the SCCs are carriers the network attached alongside it, and a reader
// looks at them to answer "what else is on air", never "which of these am I
// locking to". So the PCC keeps the full anatomy and the SCCs stay one line
// each — still individually pickable, because a secondary IS a legitimate lock
// target once the network reselects, but never competing with the cell that
// leads.
//
// THE LEAD IS DISTINGUISHED BY ANATOMY, NOT BY AREA. It was a 172px block in a
// saturated identity fill, which made the read-only half of a settings page the
// largest object on it. It is now two lines against the secondaries' one — a
// difference a reader resolves instantly, at a fifth of the area.
//
// ITS METER IS GONE, AND NOT MERELY BECAUSE OF THE SHRINK. Rebuilt at row scale
// it drew a 4px identity-coloured bar across the block's full width directly
// under the detail line, and on screen that reads as a coloured bottom border
// rather than as a gauge — the exact tell the craft floor bans. It was also a
// third channel saying what two already said: the `Badge variant="nr"|"lte"`
// reports which radio, and the dBm figure beside it reports how weak. The
// secondary rows never carried one, so dropping it is also what makes every
// carrier row on this surface report signal the same single way.

/**
 * The lead (PCC) block: identity badge and band, the PCI headline, the channel
 * and quality detail, and the labelled action that makes this cell a lock
 * target.
 *
 * PCI IS THE HEADLINE HERE, not the band — the one place this deliberately
 * departs from its band-locking sibling. On that surface the reader is choosing
 * a frequency, so the band designator is the answer; on this one they are
 * choosing a physical cell, and PCI is its name.
 *
 * `bg-surface` — one step recessed from the panel's `surface-container`, the
 * same relationship the secondary rows use. NOT an identity fill: the retired
 * version painted `bg-primary`/`bg-lte` and had to draw its own pill, action and
 * meter as alphas over that fill, because a role colour on a saturated identity
 * ground is either invisible or brand-on-brand. Dropping the fill retires all
 * three of those alpha helpers and lets every control here be an ordinary
 * neutral one. Identity travels on the `Badge variant="nr"|"lte"` instead.
 */
export const CAMPED_LEAD = {
  ROOT: "flex flex-col gap-2 rounded-tile bg-surface px-3.5 py-3",
  HEAD: "flex flex-wrap items-center gap-x-2.5 gap-y-1.5",
  LABEL: "text-xs font-medium text-on-surface-variant",
  /** The PCI headline. 20px — two steps down from the retired tile's 30px, still
   *  two steps clear of the secondaries' 13px, so the rank survives the shrink. */
  VALUE: "font-mono text-xl leading-none font-semibold tabular-nums",
  BAND: "font-mono text-xs font-semibold tabular-nums text-on-surface-variant",
  DETAIL:
    "flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-on-surface-variant",
  /**
   * The "use this cell" control. A real button, 34px tall with a `before:`
   * overlay reaching the 44px coarse-pointer floor.
   *
   * IT SWITCHES WIDTH ON THE PANEL, NOT THE VIEWPORT. On a wide panel `ml-auto`
   * parks it at the head row's right edge, so it never sits between two
   * readings. Once the panel is under `@sm` the head row wraps, and a
   * right-parked auto-width pill then floats alone on its own line looking like
   * a stray chip between the PCI and the detail — so it goes `w-full` instead
   * and reads as the deliberate action of the block. Wrapping is the trigger,
   * and the panel is what wraps: this block also sits in a hero column that
   * collapses independently of the window.
   */
  ACTION:
    "relative inline-flex h-[2.125rem] w-full flex-none items-center justify-center gap-1.5 rounded-pill bg-surface-container-high px-3.5 text-xs font-semibold text-on-surface transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] enabled:hover:bg-primary-container enabled:hover:text-on-primary-container focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55 @sm/panel:ml-auto @sm/panel:w-auto",
} as const;

/**
 * A secondary carrier, one per line.
 *
 * `rounded-pill` at 44px is the canonical metric row from DESIGN.md, and it
 * fits here where `HERO_ROW`'s field step did not, for the reason that rule
 * gives: these rows carry short mono values and a single icon target, so they
 * do not wrap to a second line. `bg-surface` sits one step recessed from the
 * panel's `surface-container`, the same relationship `CAMPED_LEAD` above uses.
 *
 * The identity is a real `Badge variant="nr"|"lte"`, never a tinted fill on the
 * row itself. That is now true of the LEAD as well — it was the one element on
 * this surface painted in a saturated identity fill, and the alpha-over-own-ink
 * helpers that existed to put controls on top of it retired with it. One rule for
 * every carrier row: identity lives on the badge, the row stays neutral, and
 * every control on it is an ordinary neutral control.
 */
export const CAMPED_SCC = {
  LIST: "flex flex-col gap-1.5",
  ROW: "flex min-h-11 items-center gap-2.5 rounded-pill bg-surface px-3 py-1.5",
  LABEL: "text-xs font-medium text-on-surface-variant",
  VALUE: "font-mono text-[13px]/5 font-semibold tabular-nums",
  META: "ml-auto font-mono text-xs text-on-surface-variant tabular-nums",
  /** The compact picker. 32px paint, 44px target via the `before:` overlay. */
  PICK: "relative grid size-8 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-1.5 before:content-[''] hover:bg-primary-container hover:text-on-primary-container focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-surface-container-high disabled:hover:text-on-surface-variant",
} as const;

/**
 * The note that stands in for the SCC list when the radio reports a single
 * carrier — naming the radio leg that is NOT on air rather than leaving the
 * space blank.
 *
 * It is a note and not a tile: with the lead block already carrying the panel,
 * a second block claiming "no 5G" would read as an editorial judgement that the
 * absence is a fault, and on a modem whose SKU may not support SA it often is
 * not.
 */
export const CAMPED_ABSENT =
  "flex min-h-11 items-center gap-2.5 rounded-pill bg-surface px-3.5 py-1.5 text-xs text-on-surface-variant";

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
// The hero's subject: THE STANDING ORDERS ("While nobody is watching")
// -----------------------------------------------------------------------------
// THREE ANSWERS TO ONE QUESTION.
//
// Persistence, signal failover and the schedule were three separate objects on
// this page: two rows buried at the foot of the hero rail, and a whole card of
// its own sitting in a 2-up grid as the orphaned third cell beside empty space.
// Nothing said they were related, and the schedule in particular read as a
// feature that had been parked wherever there was room.
//
// They are all the same question — WHAT DOES THIS LOCK DO WHEN NOBODY IS
// LOOKING? — asked about three different absences: across a reboot, during a
// signal collapse, and on a clock. Grouping them is what turns "three settings"
// into one thing a reader can hold.
//
// THEY ARE NOW THE HERO, where they used to be the page's last card. The earlier
// order — see where you are, choose where to point, then decide what happens
// unattended — described the FIRST SESSION only. After that one setup the target
// rarely moves, and everything a returning reader wants is here: does the lock
// survive a reboot, is the safety net armed, is the window still right. Putting
// the answer at the top and the three-field forms below it matches how the page
// is actually used, and it is what freed the space the retired match line spent
// restating the leg cards.
//
// It also resolves where failover belongs. `qmanager_tower_failover` releases
// BOTH radios and has only one device-wide RSRP to work from, so rendering it
// inside the LTE card would claim it protects LTE. These tiles are not leg
// cards, which is exactly the property that made the hero rail the right home
// before and makes the hero proper the right home now.

/**
 * Three tiles, stepped rather than equal: the schedule carries seven 44px day
 * chips plus two time fields and genuinely needs the room, where persistence is
 * a label and a switch. Equal thirds would either wrap the weekday row or leave
 * the first tile mostly empty.
 *
 * QUERIES `@container/hero`, NOT `/card`. These tiles moved out of a `TOWER_CARD`
 * and into `TOWER_HERO`; a `/card` variant left behind here would silently never
 * match — the hero declares no `card` container — so the grid would stay
 * single-column at every width and the collapse would look like a design choice.
 */
export const AUTO_GRID =
  "grid grid-cols-1 gap-3 @xl/hero:grid-cols-2 @4xl/hero:grid-cols-[1fr_1fr_1.5fr] @xl/hero:items-stretch";

/**
 * One automation tile. `rounded-tile` (28px) inside the 40px hero, per
 * Radius-Follows-Size, on the `surface-container` step so it reads as an inner
 * unit of the section rather than as a card of its own — and so it matches the
 * live strip's two panels, which are its peers directly above.
 *
 * Note this is deliberately NOT the retired `HERO_ROW`: that shape painted
 * `bg-surface`, which was correct on the old hero's `surface-container` panels
 * and would be invisible here, where the host section IS `bg-surface`.
 */
export const AUTO_TILE = {
  ROOT: "flex min-w-0 flex-col gap-3 rounded-tile bg-surface-container px-5 py-4",
  HEAD: "flex flex-wrap items-center gap-x-2.5 gap-y-2",
  /** Glyph-Disc Rule at tile scale: 36px against the 52px product-wide disc. */
  DISC: "grid size-9 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  TITLE: "text-sm font-semibold",
  BODY: "text-on-surface-variant text-xs leading-relaxed text-pretty",
  /** The last element in a tile, pinned so the three tiles' floors agree. */
  FOOT: "mt-auto",
} as const;

/**
 * The failover tile's quality meter: the live reading, with the threshold that
 * gates it marked ON the same track.
 *
 * The number and the reading it is compared against only mean something
 * together — a "35%" in a box says nothing until you can see that the modem is
 * currently at 93%. The marker is drawn in `warning`, the role that owns the
 * threshold guides in this system's charts, and it is `absolute` over the track
 * rather than a second bar so the two cannot disagree about scale.
 */
export const AUTO_METER = {
  /**
   * The positioning context only. It carries NO `overflow-hidden`, because the
   * marker deliberately overhangs the track top and bottom so a 2px rule is
   * findable — clipping it to the 6px track would leave a speck.
   */
  ROOT: "relative h-1.5 w-full",
  /** The clipped bar. `overflow-hidden` lives here, where the FILL is. */
  TRACK:
    "h-full w-full overflow-hidden rounded-pill bg-surface-container-high",
  FILL: "h-full origin-left rounded-pill transition-transform duration-[var(--duration-standard)] ease-standard",
  MARK: "absolute inset-y-[-0.25rem] w-0.5 -translate-x-1/2 rounded-pill bg-warning",
} as const;

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
  /**
   * The footer's three actions, at their real heights. Both writes are 42px
   * pills; the form reset is the 36px quiet step, and it gets its own mirror
   * because a footer that loads three controls and skeletons two shifts on
   * handoff — the exact failure the import rule exists to prevent.
   */
  ACTION: "h-[2.625rem] w-36 rounded-pill",
  ACTION_SECONDARY: "h-[2.625rem] w-40 rounded-pill",
  ACTION_QUIET: "h-9 w-24 rounded-pill",
  /**
   * A leg card's own settings row (`CONTROL_ROW` / `CARD_ROW`), which is the
   * same 52px field geometry the retired hero rows used.
   */
  SETTINGS_ROW: "h-[3.25rem] w-full rounded-field",
  /**
   * The leg card's modem read-back line. Sized for the CAPTION PLUS ONE PAIR,
   * which is the honest mirror: the LTE card can render three pairs, but the
   * skeleton cannot know how many will land, and a placeholder sized for three
   * would collapse on the common single-cell case — a skeleton that shrinks is
   * worse than one that grows, because the content below it jumps upward into
   * space the reader had already started reading.
   */
  READBACK: "h-[4.25rem] w-full rounded-field",
  /**
   * The verdict block. MEASURED, not estimated: 143px in the loaded state — a
   * 36px disc row, a two-line body and the 22px stamp inside 28px of vertical
   * padding — so the strip does not resize under the reader when the modem
   * answers.
   *
   * Two lines is the case it mirrors because four of the five verdict bodies wrap
   * to two at this column's fixed 15rem. `unverified` runs to three and will
   * grow by one line on load; that is the right direction to be wrong in, since a
   * skeleton that SHRINKS pulls the tiles below it upward into space the reader
   * had already started on.
   */
  VERDICT: "h-[8.9375rem] w-full rounded-tile",
  /** The lead carrier block (measured: 82px), and one secondary row. */
  PCC_BLOCK: "h-[5.125rem] w-full rounded-tile",
  SCC_ROW: "h-11 w-full rounded-pill",
  /** One automation tile, and one weekday chip. */
  AUTO_TILE: "h-[9.5rem] w-full rounded-tile",
  DAY_CHIP: DAY_CHIP.SKELETON,
} as const;

// -----------------------------------------------------------------------------
// Leg identity
// -----------------------------------------------------------------------------

/**
 * The two radio legs this surface can lock, in reading order.
 *
 * NOT DEAD CODE, despite nothing iterating it any more — the retired hero's
 * locked-target panel was its only `.map()`, and `TowerLeg` below is now its one
 * consumer. Deleting the array to "clean up" means hand-writing the union, which
 * is how a third leg would later get added in one place and not the other.
 */
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
