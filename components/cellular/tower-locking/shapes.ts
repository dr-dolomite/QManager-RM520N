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
// one thing that must NOT drift is the carrier tile's tone rule, so it carries
// the full rationale rather than a pointer to it.
//
// -----------------------------------------------------------------------------
// WHAT THIS SURFACE IS
// -----------------------------------------------------------------------------
// Three kinds of object, in reading order:
//
//   1. "RIGHT NOW" (`TOWER_HERO`) is the PREMISE: the lock verdict, and every
//      carrier the radio is actually camped on, as a uniform tile grid. It is
//      the page's anchor because it is the only part that changes on its own —
//      everything below it changes only when the reader changes it.
//   2. "WHILE NOBODY IS WATCHING" (`TOWER_SECTION`) is the STANDING ORDERS —
//      what this lock does unattended: across a reboot, during a signal
//      collapse, and on a clock. Three tiles, one question.
//   3. THE LEG CARDS are where the target changes, and the single place a leg's
//      own state is reported. One per AT lock parameter
//      (`AT+QNWLOCK="common/4g"`, `="common/5g"`).
//
// THE TWO SECTIONS ARE SIBLINGS, NOT ONE MERGED HERO. They were merged for one
// revision, and the merge was what forced the freshness stamp down onto the
// verdict block: a stamp at the top of a card that also contained three settings
// tiles would have appeared to date the settings. Split, the stamp can head the
// section it actually describes. Only `TOWER_HERO` keeps `rounded-hero` — one
// anchor per surface, and it is the section that leads the page.
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
// leg card that owns it. What is left of the match line is a strip, not a grid.
//
// -----------------------------------------------------------------------------
// THE TWO CLOCKS (read before touching the "Right now" section)
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
// the failover watcher, and a second browser tab. So the section prints an
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
// EVERY CAMPED CARRIER IS A PICKER, AND WHY THE TILE ITSELF IS NOT A BUTTON
// -----------------------------------------------------------------------------
// Tower locking targets an (EARFCN, PCI) pair. A carrier component already
// carries `earfcn`, `pci`, `band` and `rsrp` — so every carrier the radio
// reports is describing a cell the user could lock to, and making them retype
// those same digits into a text box underneath is the whole reason "Simple
// Mode" had to be invented as a second, parallel input path.
//
// A tile stays a REPORT and carries a small labelled action inside it, never
// becoming one big button. A block holding four discrete numbers is ambiguous
// as a single click target: a reader cannot tell whether the RSRP figure is
// itself actionable. One control removes the guess.
//
// NO CARRIER IS IDENTITY-FILLED, and that is what lets every picker be an
// ordinary neutral control. The retired lead block painted `bg-primary` /
// `bg-lte` at 172px tall, which made the read-only half of a settings page the
// largest object on it, and forced its own controls and meter to be drawn as
// alphas over the fill (`carrierPillTone`, `carrierMeterTone` — both retired
// with it). Identity now travels on the outline `Tag variant="nr"|"lte"` each tile
// carries — a stroke and role ink on a neutral ground, which is the form the
// Two-Form Rule reserves for identity.
//
// A carrier the user cannot currently lock to gets its control in a DISABLED
// state with a reason, never a missing control — an NR carrier is visible but
// not SA-lockable while the modem is in NSA mode, and silently dropping the
// affordance there would leave the user to infer the rule.
// =============================================================================

// -----------------------------------------------------------------------------
// Section and card shells
// -----------------------------------------------------------------------------

/**
 * The "Right now" section, and the page's anchor. `rounded-hero` (40px) — one
 * per surface, claimed by the section that LEADS the page.
 *
 * It establishes `@container/section`, which is what `STRIP_GRID` below queries.
 * The container name is deliberately `section` rather than the old `hero`: two
 * sibling sections now declare it, and a query written against `/hero` would
 * silently never match inside `TOWER_SECTION`.
 *
 * `shadow-whisper` as a bare utility does NOT resolve; it must go through the
 * custom property, as written.
 */
export const TOWER_HERO =
  "@container/section flex flex-col gap-5 rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * The "While nobody is watching" section. Identical to `TOWER_HERO` in every
 * respect except its radius: `rounded-card` (36px), because it is a peer of the
 * leg cards below it and not a second anchor.
 *
 * It declares the SAME `@container/section` name, so `SECTION_HEAD` and
 * `AUTO_GRID` behave identically in either section without either constant
 * having to know which one is hosting it.
 */
export const TOWER_SECTION =
  "@container/section flex flex-col gap-5 rounded-card border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/**
 * One leg card (LTE / NR-SA). `rounded-card` (36px) — a peer in a grid, never a
 * second hero. Imported by the loaded, loading AND gated branches so the three
 * can never again disagree about their own radius.
 */
export const TOWER_CARD =
  "@container/card flex flex-col gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

/** Card padding: 24px on a peer card, 28px on a section (baked into the shells). */
export const CARD_PAD = "px-6";

/**
 * The header row both sections share.
 *
 * THE DESCRIPTION SITS ON THE TITLE'S ROW, not under it, and that is the one
 * place this departs from the leg cards' `CardHeader`. A section header is a
 * signpost over content the reader can already see; stacking it would spend two
 * lines of vertical rhythm restating what the tiles beneath it demonstrate. The
 * leg cards keep the stacked form because their descriptions explain a control
 * whose effect is NOT visible until it is used.
 *
 * `META` is the right-aligned slot, and on the "Right now" section it holds the
 * freshness stamp plus `HERO_REFRESH_BUTTON`. It carries `ml-auto` rather than
 * `justify-between` on the root, because the row wraps: with three children and
 * `justify-between`, a wrap leaves the description marooned against the right
 * edge of its own line.
 */
export const SECTION_HEAD = {
  ROOT: "flex flex-wrap items-center gap-x-3 gap-y-1.5",
  TITLE: "text-base font-semibold",
  DESCRIPTION: "text-sm leading-relaxed text-pretty text-on-surface-variant",
  META: "ml-auto flex flex-none items-center gap-2.5",
  /**
   * The freshness stamp that sits in `META`. A 28px pill, which is what
   * `SKELETON_SHAPE.SECTION_META` mirrors.
   *
   * `tabular-nums` but NOT `font-mono`: the machine's voice covers the
   * timestamp, not the sentence wrapped around it.
   */
  STAMP:
    "bg-surface-container text-on-surface-variant flex h-7 min-w-0 items-center gap-1.5 rounded-pill px-3 text-xs tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// "Right now": THE LIVE STRIP
// -----------------------------------------------------------------------------
// Two parts, read left to right as one clause:
//
//     VERDICT   ▸   CAMPED ON NOW
//
// The verdict is the only genuinely NEW fact this page can compute — neither the
// modem's lock read-back nor the poller's carrier list carries it alone — so it
// leads. What the radio is camped on is the evidence behind it, and it stays on
// screen because every tile in it is a lock target one click from a form.
//
// The three-column match line this replaces was 400px tall and led the page with
// a comparison whose left operand the leg cards below already printed. So the
// verdict drops from a 176px centred tile to a left-aligned block, and the
// camped carriers from one identity-filled lead plus a list of rows to a
// uniform wrapping tile grid. Every READING survives at roughly a third of the
// area; the lead's signal meter is the one thing genuinely cut, and see
// `CARRIER_TILE` for why it was a false border rather than a gauge.
// -----------------------------------------------------------------------------

/**
 * The strip's two columns.
 *
 * The verdict column is a fixed `18.5rem`: it holds a state word and one line of
 * consequence, so letting it flex would stretch a two-word conclusion across
 * half the section. Everything else goes to the carrier grid, which is the part
 * with a variable number of tiles.
 *
 * The two columns STRETCH to the taller of them, so the verdict and the carrier
 * panel read as one strip rather than as a short block parked beside a tall one.
 *
 * That is only safe because `VERDICT_BLOCK.ROOT` centres its own content. The
 * arrangement this replaces stretched the block while its copy stayed pinned to
 * the top, which left ~90px of empty container between the body line and the
 * floor — on a SATURATED `success-container`, where an asymmetric void is the
 * loudest thing in the section. Centring is what makes the extra height read as
 * breathing room instead of as truncation, and the two changes only work as a
 * pair: reverting one without the other brings the void back.
 */
export const STRIP_GRID =
  "grid grid-cols-1 gap-3 @3xl/section:grid-cols-[18.5rem_minmax(0,1fr)]";

/**
 * The carrier half of the strip. `rounded-tile` (28px) rather than the retired
 * match panel's `rounded-card` (36px) — Radius-Follows-Size, and it makes the
 * strip a peer of the automation tiles in the next section rather than a third
 * rank between them and the `rounded-hero` shell. `TOWER_HERO` claims the page's
 * one hero exception on its own.
 *
 * It establishes `@container/panel`, which `CARRIER_GRID` queries. The grid must
 * respond to the PANEL and not to the section: this column's width is set by
 * `STRIP_GRID`'s fixed left track, so it narrows and widens on its own schedule.
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
 * A condition block at strip scale: a filled glyph disc, a state word, and one
 * line of consequence. The disc is mandatory rather than decorative — the
 * Glyph-Disc Rule exists because `success-container` and `warning-container`
 * measure 1.03:1 apart and are the SAME surface under deuteranopia, so the
 * container fill cannot be the channel that separates "on target" from "not on
 * target". The disc, painted on the role's STRONG fill, is.
 *
 * AN EMPTY-STATE STACK, NOT A HEADED BLOCK: a centred disc over one centred
 * sentence, with NO visible state word. That is a deliberate reversal of the
 * left-aligned head-plus-body arrangement this replaces, and the reasoning that
 * killed the arrangement before THAT one — "a sentence starts at the left
 * margin" — is what makes it work. The state word was never the sentence; it was
 * a two-word label ("No lock", "Not on target") sitting above a body that
 * already said the same thing in full ("The modem picks its own cell and
 * reselects freely"). Two headings for one fact is what made the block read as a
 * metric tile rather than as the verdict on the section it opens.
 *
 * THE STATE WORD IS NOT DELETED, IT IS MOVED OFF SCREEN. `TITLE` is `sr-only`,
 * so the block still ANNOUNCES "No lock. The modem picks its own cell…" through
 * its `role="status"`. Sighted readers get the state from the disc's glyph and
 * fill; everyone else gets it in words. Dropping the key outright would have
 * left the five verdicts distinguishable to assistive tech only by whatever the
 * body copy happened to imply, in five locales, with nothing to catch a
 * translation that blurred two of them.
 *
 * The disc steps up to 48px from 36px, because it is now the only thing carrying
 * the state visually and it leads the stack rather than sharing a row with a
 * heading. The body steps up to 13px for the same reason: it is the only copy
 * left, and at 12px centred in an 18.5rem column it read as a caption for a
 * missing headline.
 *
 * NO STAMP. The freshness line and its re-read control used to live here, on the
 * argument that a verdict is only ever as fresh as its stalest operand (see THE
 * TWO CLOCKS). That argument is intact and is exactly why the stamp moved UP to
 * `SECTION_HEAD.META`: BOTH operands — the ~4s carrier list and the once-on-
 * mount lock read-back — now sit inside the one section the stamp heads, so it
 * dates all of them instead of only the conclusion drawn from them.
 *
 * CONTENT IS VERTICALLY CENTRED, which is load-bearing rather than cosmetic.
 * `STRIP_GRID` stretches this column to the carrier panel's height, so on any
 * grid taller than two lines of copy there is spare container underneath.
 * Centring splits it above and below; top-aligning would pool all of it at the
 * floor and read as a block that ran out of content. See `STRIP_GRID`.
 */
export const VERDICT_BLOCK = {
  ROOT: "flex min-w-0 flex-col items-center justify-center gap-3 rounded-tile px-5 py-6 text-center",
  DISC: "grid size-12 flex-none place-items-center rounded-pill",
  /** The state word, announced but not drawn. See the note above. */
  TITLE: "sr-only",
  /**
   * `text-balance`, not `text-pretty`. Both bodies are short enough to be
   * BALANCED rather than merely widow-proofed, and a centred two-line sentence
   * whose lines are wildly unequal is the one place the difference is visible.
   */
  BODY: "text-[13px]/5 text-balance opacity-90",
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
 * The neutral fill is `surface-container`, matching the panel beside it, so a
 * neutral verdict reads as a second panel rather than as a hole in the section.
 * `bg-surface` would be the section's own fill and would render the block
 * invisible.
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
    /**
     * A verdict compares the LOCK against what is on air, so it is only as
     * trustworthy as the lock read. With either leg unread, the honest answer
     * is `unknown` rather than "nothing to match" — the latter is a POSITIVE
     * claim that no lock is in force. `=== false`, never `!== true`: absent
     * means true, so an un-upgraded `status.sh` still gets a real verdict.
     */
    lte_read_ok?: boolean;
    nr_read_ok?: boolean;
  } | null,
  onAir: {
    technology: "LTE" | "NR";
    earfcn: number | null;
    pci: number | null;
  }[],
): TowerMatchVerdict {
  if (!modemState) return "unknown";
  if (modemState.lte_read_ok === false || modemState.nr_read_ok === false) {
    return "unknown";
  }

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
  const nrOk = nrTarget === null || camped("NR", nrTarget.arfcn, nrTarget.pci);

  return lteOk && nrOk ? "on_target" : "off_target";
}

/**
 * The eyebrow above a panel's content.
 *
 * The generic craft floor treats an eyebrow as a reflex to delete. It is kept
 * because the committed world ships one: DESIGN.md's tile anatomy is literally
 * `eyebrow -> value -> caption`, and both the band-locking and custom-profiles
 * heroes already carry the identical step.
 */
export const HERO_EYEBROW =
  "text-xs font-medium tracking-[0.06em] text-on-surface-variant";

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
 * wrote something else) was previously visible only in the strip, one scroll
 * away from the fields it contradicted. Printed here it sits inches from the
 * values it disagrees with, which is the only place a disagreement is
 * actionable.
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
 * The refresh button beside the freshness stamp, in `SECTION_HEAD.META`. A 22px
 * glyph whose `before:` overlay reaches the 44px this project requires on coarse
 * pointers, without adding a layout box that would push the timestamp off its
 * baseline. Same construction as the `Banner` dismiss button.
 *
 * Colour is inherited rather than declared. It sat inside the verdict block
 * until the stamp moved up, and a hardcoded `on-surface-variant` would have been
 * a neutral grey on a warning container; inheritance survived that move
 * unchanged, and keeping it means the button can be dropped into a tonal host
 * again without a second look.
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
// The camped-on carrier grid
// -----------------------------------------------------------------------------

// EVERY CAMPED CARRIER IS A PEER TILE. NO CARRIER LEADS.
//
// The arrangement this replaces was one full-anatomy lead block over a list of
// one-line secondary rows, and its governing rule was recorded as THE LEAD IS
// DISTINGUISHED BY ANATOMY, NOT BY AREA — a correction of an earlier version
// that made the primary a 172px saturated identity tile, i.e. the largest object
// on a settings page. That rule is worth keeping in mind and is now taken one
// step further: the lead is distinguished by NEITHER. Every camped carrier gets
// the same two-line tile, and primacy is carried by the identity chip alone
// ("LTE PCC" against "LTE SCC", "NR PCC" against "NR SCC").
//
// That is the honest shape, because aggregation is context here rather than the
// subject. `AT+QNWLOCK` pins a PRIMARY cell; the SCCs are carriers the network
// attached alongside it, and a reader looks at them to answer "what else is on
// air". A secondary IS a legitimate lock target once the network reselects, so
// it needs the same affordance — and giving it a visibly lesser one implied a
// ranking the AT layer does not have.
//
// THE MEASUREMENTS THAT SURVIVE ARE PCI AND RSRP, AND THAT IS DELIBERATE. The
// mock this grid comes from carried a third line — `EARFCN · RSRQ · SINR` — and
// it is cut for two reasons. The channel and its quality figures are already
// printed by the leg card that owns the lock, inches below; and the NR variant
// of that line printed a subcarrier spacing looked up from a BAND TABLE, which
// is a guess wearing the typeface of a measurement.
//
// THE SIGNAL METER CAME BACK, AS A 56px LANE — and the history matters, because
// the objection that killed it the first time was correct and is still correct
// about the shape it killed.
//
// It was cut when, rebuilt at tile scale, it drew a 4px IDENTITY-coloured bar
// across the tile's full width directly under the detail line: on screen that
// reads as a coloured bottom border rather than as a gauge, the exact tell the
// craft floor bans. It was also a third channel saying what two already said —
// the `Tag variant="nr"|"lte"` reports which radio, the dBm figure reports how
// weak.
//
// What changed is the five-stop quality ramp. Its adjacent stops sit BELOW the
// 0.05 CVD separation floor deliberately, on the explicit understanding that bar
// LENGTH carries the fine distinctions — so the ramp ink on the RSRP figure is
// only legal beside a bar. The redundancy is now the safety mechanism rather
// than clutter. The alternative was to drop the tint entirely; keeping it was a
// deliberate call, on the grounds that this is the surface where "weak but
// recoverable" vs "not this cell" decides whether the reader locks.
//
// BOTH HALVES OF THE OLD OBJECTION STILL BIND THE NEW SHAPE. It draws a
// MEASUREMENT, never identity. And it is a short lane INSIDE the body row,
// immediately left of the figure it belongs to — never a full-bleed rule under
// the last line. Staying in the row also keeps the tile at the 87px
// `SKELETON_SHAPE.CARRIER_TILE` mirrors; a new row would break that mirror.

/**
 * The wrapping tile grid inside `STRIP_PANEL`.
 *
 * Queries `@container/panel`, never the section: this grid lives in the right
 * track of `STRIP_GRID`, whose left track is a fixed 18.5rem, so the space it
 * actually has is not a function of the section's width alone.
 *
 * `gap-3` (12px) and NOT the 8px the mock draws. Each tile's action carries a
 * `before:` overlay that reaches 6px past its paint on every side to make the
 * 44px coarse-pointer floor; at 8px the overlays of two horizontally adjacent
 * tiles would leave a 0px dead lane between them, and on a tablet a tap in that
 * lane resolves to whichever tile won the stacking order. 12px keeps a real gap.
 */
export const CARRIER_GRID =
  "grid grid-cols-1 gap-3 @md/panel:grid-cols-2 @2xl/panel:grid-cols-3";

/**
 * One camped carrier. Two lines: identity + band + action, then the PCI headline
 * with the RSRP reading pushed right.
 *
 * PCI IS THE HEADLINE HERE, not the band — the one place this deliberately
 * departs from its band-locking sibling. On that surface the reader is choosing
 * a frequency, so the band designator is the answer; on this one they are
 * choosing a physical cell, and PCI is its name.
 *
 * `bg-surface` — one step RECESSED from the panel's `surface-container`, rather
 * than climbing to `surface-container-high` as the mock does. Two reasons. It
 * keeps the top rung of the tonal ramp in reserve for the things that genuinely
 * sit above the page's ground (the action pill, the disabled disc), and it is
 * the relationship the retired lead block and secondary rows both already used,
 * so nothing about the tone changed when the anatomy did.
 *
 * NOT an identity fill: the retired lead painted `bg-primary`/`bg-lte` and had
 * to draw its own pill, action and meter as alphas over that fill, because a
 * role colour on a saturated identity ground is either invisible or
 * brand-on-brand. Identity travels on the outline `Tag variant="nr"|"lte"` instead.
 *
 * `RSRP` carries NO colour of its own. The reading's tone comes from
 * `qualityInkClass()` in `components/cellular/signal-quality-display.ts` — the
 * five-stop quality ramp (`text-quality-1` … `text-quality-5`), whose light-mode
 * values are already tuned to clear AA as ink on these surfaces.
 *
 * It used to be one of `text-success-on-surface` / `text-warning-on-surface` /
 * `text-destructive-on-surface`, the functional three. Those had four levels and
 * so could not separate "weak but recoverable" from "not this cell" — the exact
 * call a reader is making on this surface, because they are deciding whether to
 * LOCK to the cell in question.
 *
 * IT IS PAIRED WITH A GAUGE, AND THAT IS NOT OPTIONAL. See the note on the
 * signal meter above: it was cut once, and it came back under the ramp because
 * adjacent ramp stops sit BELOW the 0.05 CVD separation floor by design, on the
 * understanding that bar LENGTH carries the fine distinctions. Ramp ink without
 * a bar beside it is a bug (DESIGN.md > Quality bars).
 */
export const CARRIER_TILE = {
  /**
   * The transition names `box-shadow` explicitly, for `MATCH` below. A bare
   * `transition-all` would silently inherit Tailwind's off-scale 150ms and stop
   * responding to a retune of `--duration-standard` (The One-Scale Rule).
   */
  ROOT: [
    "flex min-w-0 flex-col gap-2 rounded-tile bg-surface px-3.5 py-3",
    "transition-[box-shadow] duration-[var(--duration-standard)] ease-standard",
  ].join(" "),
  HEAD: "flex items-center gap-2",
  /** The band designator. A device identifier, so it wears the machine's voice. */
  BAND: "min-w-0 truncate font-mono text-xs font-semibold tabular-nums text-on-surface-variant",
  BODY: "flex items-baseline gap-2",
  PCI_LABEL: "flex-none text-xs text-on-surface-variant",
  PCI_VALUE: "font-mono text-xl leading-none font-semibold tabular-nums",
  /** Pair with a `*-on-surface` signal tone — see the note above. */
  RSRP: "ml-auto flex-none text-[13px]/5 font-semibold tabular-nums",
  /**
   * The per-tile picker. 32px of paint, 44px of target via the `before:`
   * overlay — the same construction the retired secondary rows used, kept
   * verbatim because it is the one control geometry on this surface that has
   * already been measured against the coarse-pointer floor.
   *
   * THE BLOCKED RULES ARE WRITTEN ON `aria-disabled:`, NOT `disabled:`.
   * `live-strip.tsx` blocks its picker with `aria-disabled` so the reason stays
   * reachable by hover AND by keyboard — a natively `disabled` button takes no
   * pointer events and no focus, so the tooltip explaining the block never
   * arrived. The instant the native attribute went away, all four `disabled:`
   * rules below stopped matching and the blocked tile rendered at FULL opacity,
   * with a pointer cursor, still lighting up to `primary-container` on hover:
   * this surface's affirmative "this is takeable" signal, painted on a control
   * that cannot be taken. A dead control that highlights like a live one is
   * worse than a grey one with no explanation.
   *
   * The `disabled:` originals are NOT kept alongside. `live-strip.tsx:383` is
   * the only consumer in the repo (frequency locking declares its own
   * `CARRIER_TILE` in its own `shapes.ts`), and it no longer renders a native
   * `disabled` at all — a dead second rule set is a second place for "blocked"
   * to be decided.
   */
  ACTION:
    "relative ml-auto grid size-8 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-1.5 before:content-[''] hover:bg-primary-container hover:text-on-primary-container focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:bg-surface-container-high aria-disabled:hover:text-on-surface-variant",
  /**
   * Marks the tile whose carrier IS the current lock target.
   *
   * A 2px INSET BOX-SHADOW, not the mock's `outline: 2px solid var(--ok)`. Two
   * separate rules land on that outline: Fill-Over-Stroke forbids a coloured
   * stroke on a tonal container, and a functional role (`--success`) is never a
   * legal stroke colour in the first place. The inset shadow is the sibling
   * route's answer to the identical problem — see `BAND_CHIP_LIVE_RING` in
   * `components/cellular/band-locking/shapes.ts`. It costs no layout box, it
   * paints in `--primary` rather than in a health role, and it is a SHAPE
   * signal, so it survives grayscale and every colour-vision deficiency.
   *
   * It is never the only channel: the component pairs it with a filled `lock`
   * glyph in place of the tile's `add` action, and announces the state in words
   * to assistive technology.
   */
  MATCH: "shadow-[inset_0_0_0_2px_var(--primary)]",
} as const;

/**
 * The hint note, occupying the ragged remainder of `CARRIER_GRID`.
 *
 * It exists so the grid ENDS rather than trailing off into empty cells, and it
 * is the one dashed stroke sanctioned on this surface: Fill-Over-Stroke bans a
 * border drawn AROUND CONTENT, and this border is drawn around an ABSENCE. It
 * is `border-outline`, the canon stroke token, at 1px.
 *
 * It is deliberately not a filled tile. With every real carrier on `bg-surface`,
 * a filled note would enter the reading order as a further carrier; unfilled, it
 * reads as the edge of the set.
 *
 * WHAT IT SAYS CHANGED, AND THAT MATTERS MORE THAN THE SHAPE DID. It used to be
 * a TALLY — "3 LTE, 2 NR" over "Aggregation is live. Only the primary cell can
 * be locked." Both halves were wrong for this spot. The count restated the
 * summary the panel head already prints two inches above it ("2 carriers ·
 * 35 MHz"), and the sentence contradicted the grid it sat in: every addressable
 * tile here carries a picker, SECONDARIES INCLUDED, precisely because a
 * secondary becomes a legitimate target the moment the network reselects (see
 * EVERY CAMPED CARRIER IS A PICKER). A note claiming only the primary can be
 * locked, printed beside four enabled + buttons, teaches the reader to distrust
 * the controls.
 *
 * It now does what its `frequency-locking` counterpart does — states what the
 * picker does and the one rule of the feature that is not guessable from the UI
 * — because that is the same job in the same slot on a sibling route, and the
 * two surfaces should not answer it in two different shapes. The glyph leads on
 * its own line rather than inline with a heading, since there is no longer a
 * heading for it to lead.
 */
export const CARRIER_NOTE_TILE = {
  ROOT: "flex min-w-0 flex-col justify-center gap-2 rounded-tile border border-dashed border-outline px-4 py-3.5 text-on-surface-variant",
  BODY: "text-xs leading-relaxed text-pretty",
} as const;

/**
 * The note tile's column span, so it fills the remainder of the grid's last row
 * instead of leaving a hole beside it.
 *
 * CSS cannot compute this on its own — there is no "span to the end of the row"
 * for an item whose start column is implicit — so the span is derived from the
 * carrier count against each of `CARRIER_GRID`'s three column counts. A count
 * that divides evenly means the note starts a fresh row and takes the whole of
 * it, which is exactly what a 3-carrier, 3-column layout should do.
 *
 * The classes are written out as literals rather than interpolated: Tailwind
 * scans source text, and `@2xl/panel:col-span-${n}` would compile to nothing.
 * The base 1-column case needs no class at all, since one column IS the row.
 */
const NOTE_SPAN_TWO_UP: Record<number, string> = {
  1: "@md/panel:col-span-1",
  2: "@md/panel:col-span-2",
};

const NOTE_SPAN_THREE_UP: Record<number, string> = {
  1: "@2xl/panel:col-span-1",
  2: "@2xl/panel:col-span-2",
  3: "@2xl/panel:col-span-3",
};

export function carrierNoteSpan(carrierCount: number): string {
  const remainder = (columns: number): number => {
    if (carrierCount <= 0) return columns;
    const used = carrierCount % columns;
    return used === 0 ? columns : columns - used;
  };
  return [
    NOTE_SPAN_TWO_UP[remainder(2)] ?? "",
    NOTE_SPAN_THREE_UP[remainder(3)] ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The note that stands in for the carrier grid when the radio reports a single
 * carrier — naming the radio leg that is NOT on air rather than leaving the
 * space blank.
 *
 * It is a note and not a tile: with the grid already carrying the panel, a
 * second block claiming "no 5G" would read as an editorial judgement that the
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
 * FIELD GEOMETRY, WITHOUT A FILL. 20px radius, 42px tall, no visible border at
 * rest. Restated here because `components/ui/input.tsx` still defaults to the
 * legacy `rounded-md` (DESIGN.md > Migration Deltas: "Shape lives at the call
 * site, not in the primitives").
 *
 * The incumbent fields were `h-9` text inputs and a `w-10 h-6` threshold box —
 * 24px against this project's stated 44px floor, on a page used roadside on a
 * tablet.
 *
 * A `SelectTrigger` needs two MORE overrides than an `Input` does, because
 * `components/ui/select.tsx` sets its height as `data-[size=default]:h-9` and
 * its hover as `dark:hover:bg-input/50`. Those live at the one call site that
 * actually renders a select against this shape.
 */
const FIELD_SHAPE =
  "h-[2.625rem] rounded-field border-0 px-3.5 text-sm shadow-none focus-visible:ring-ring/50 focus-visible:ring-[3px]";

/**
 * THE FIELD-STEP RULE: A FIELD'S RESTING FILL IS ONE TONAL STEP ABOVE ITS HOST,
 * NEVER A FIXED TOKEN.
 *
 *   host `surface` / `card`   →  field `surface-container`      (FIELD_CONTROL)
 *   host `surface-container`  →  field `surface-container-high` (…_ON_CONTAINER)
 *
 * DESIGN.md gives an input no border at rest, so THE FILL IS THE ENTIRE
 * AFFORDANCE — there is nothing else on screen saying where the box is. A fixed
 * fill token is therefore only ACCIDENTALLY correct: it works on the one host
 * whose own fill happens to sit a step below it, and renders at 1.00:1 — a
 * field with no edge at all — on every other. This is the Tonal-Elevation Rule
 * that already governs surfaces, extended to the controls sitting on them.
 *
 * `FIELD_CONTROL` shipped as the only answer, and NOT ONE CALL SITE ON THIS
 * SURFACE HAD THE HOST IT DESCRIBED: every field here lives inside `SLOT_ROW`
 * or `AUTO_TILE`, both `bg-surface-container`, so all six painted their own
 * background and disappeared into it. The doc comment above it described a host
 * that did not exist, which is how it survived.
 *
 * `surface-container-high` is the top rung, so a field can never be hosted by a
 * `surface-container-high` block: when that happens the HOST steps DOWN and the
 * field takes `-high`. Never a border — an outlined field beside three
 * unbordered ones reads as a different KIND of control, not as the same control
 * on a different background.
 *
 * The other legal resolution is SHELL rather than STEP: the host carries the
 * fill AND the focus ring (`focus-within:ring`) while the control inside is
 * painted transparent, which is what the NR card's `FIELD_TILE` does. One or
 * the other per card, never both — see `nr-sa-tower-card.tsx` > FIELD_TILE.
 *
 * THE `dark:` RESTATEMENT IS NOT REDUNDANT, AND THE `!` IS NOT DECORATION.
 *
 * `components/ui/input.tsx` ships `dark:bg-input/30`. Two separate facts, and
 * the second is the one that bites:
 *
 * 1. WHY THE `dark:` LINE EXISTS AT ALL. `@custom-variant dark (&:is(.dark *))`
 *    compiles the primitive's rule to specificity (0,2,0) — one for the utility
 *    class, one for `.dark` inside `:is()`. A BARE `bg-surface-container-high`
 *    is (0,1,0) and simply loses in dark mode: the field is correct in light,
 *    and approximately-right-looking in dark, which is exactly why it survives
 *    review. tailwind-merge cannot fold the two either — different modifier
 *    scopes, and it only collapses conflicts within one scope.
 *
 * 2. WHY THE `dark:` LINE ALONE IS NOT ENOUGH. Restating it as `dark:` makes
 *    OURS (0,2,0) too. The two rules TIE. Nothing about specificity decides a
 *    tie — the winner is whichever Tailwind emits LAST, and for two candidates
 *    of the same utility that order is Tailwind's deterministic candidate SORT,
 *    i.e. by NAME. `bg-input…` sorts before `bg-surface-…` purely because `i`
 *    precedes `s`, so ours happened to land second and win. That is an OBSERVED
 *    outcome, not a constructed one: rename `--color-input`, add a token that
 *    sorts between them, or change the sort, and every one of these fills flips
 *    in dark mode ONLY, with no error anywhere. It is the same family as the
 *    recorded twMerge/custom-`rounded-*` trap, where alphabetical order decides
 *    a conflict the tooling cannot see.
 *
 *    The trailing `!` (Tailwind v4's important modifier) is what replaces luck
 *    with a rule: `!important` beats a same-specificity rule regardless of
 *    emission order. It is used ONLY where a fill collides with a primitive's
 *    own `dark:` fill — never as a general escape hatch.
 *
 * So an explicit field fill on this surface is ALWAYS written as a light/dark
 * PAIR with the dark half marked important, or the control is a native element
 * rather than the shadcn primitive.
 */
export const FIELD_CONTROL = `${FIELD_SHAPE} bg-surface-container dark:bg-surface-container!`;

/**
 * The same field one rung up, for a `surface-container` host — which on this
 * surface means every `SLOT_ROW` and every `AUTO_TILE`, i.e. all of them.
 * `FIELD_CONTROL` is kept for a field that lands directly on a card or section.
 */
export const FIELD_CONTROL_ON_CONTAINER = `${FIELD_SHAPE} bg-surface-container-high dark:bg-surface-container-high!`;

/**
 * The 44px coarse-pointer target for a `Switch`.
 *
 * The primitive paints at 18x32px, which is well under this project's floor. An
 * overlay reaches the target without adding a layout box that would push the
 * row's label off its baseline — the same construction `HERO_REFRESH_BUTTON`
 * uses, restated because it is a different element with a different paint size.
 *
 * IT LIVES HERE BECAUSE FIVE SWITCHES SHARE IT. Two byte-identical copies were
 * declared locally in the two leg cards, and the surface's other three switches
 * — persist, failover and schedule-enable — had none at all: the same primitive
 * shipping at two different target sizes on one page, with the SMALLER size on
 * the three controls that actually write to the modem.
 */
export const SWITCH_TARGET =
  "relative before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']";

/**
 * ONE LTE CELL SLOT, AS A ROW.
 *
 * This replaces the three stacked `rounded-tile` panels the LTE card used to
 * grow — each one a heading row over a two-up field grid, which put roughly
 * 130px of card between "Cell 1" and "Cell 2" and made a three-slot lock taller
 * than the section above it. A slot holds two short numbers and a status; it is
 * a row, and at `min-h-14` (56px) it clears the 44px floor with room for the
 * controls it hosts.
 *
 * IT HOSTS EDITABLE INPUTS, NOT READ-ONLY TEXT. The mock only ever drew the
 * settled state, and reading it literally would delete the surface's primary
 * input path — the whole point of a slot is that the pair inside it can be typed
 * as well as picked from a carrier tile. `FIELDS` therefore carries `min-w-0` so
 * two `FIELD_CONTROL` inputs can shrink rather than push `META` off the row, and
 * `ROOT` wraps rather than overflowing once the card is narrow.
 *
 * `INDEX` is `min-w-`, not a hard `w-`. The three labels are the same word with
 * a different digit, so they are the same width in every locale and the column
 * combs correctly — but a locale whose word for "Slot" is longer than 52px gets
 * more room instead of a clipped label.
 *
 * `EMPTY` is the unfilled variant, and its dashed stroke is legal for the same
 * reason `CARRIER_NOTE_TILE`'s is: the border is drawn around an ABSENCE, which
 * is the one sanctioned dash in this canon. Note it takes NO fill — a dashed
 * border over `surface-container` would read as a disabled control rather than
 * as an open slot.
 */
export const SLOT_ROW = {
  ROOT: "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 rounded-field bg-surface-container px-4 py-2.5",
  EMPTY:
    "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 rounded-field border border-dashed border-outline px-4 py-2.5",
  INDEX: "min-w-[3.25rem] flex-none text-xs font-semibold text-on-surface-variant",
  /**
   * The pair of controls. `flex-[1_1_11rem]`, and the BASIS is the load-bearing
   * part rather than the grow.
   *
   * `META` beside it is `flex-none`, so with a basis of `0` this column was the
   * only thing on the row that could give — and it gave all the way down to
   * ~111px on a narrow card, which is under what the channel control needs.
   * `line-clamp-1` then swallowed the second half of the number: a slot reading
   * `B28 – 9` where the reader has no way to know a digit is missing. A clipped
   * measurement is worse than a wrapped row, because only one of the two is
   * visible as damage.
   *
   * Declaring a real basis makes the ROOT's `flex-wrap` fire first: once the
   * line cannot seat `INDEX + 11rem + META`, the meta drops to its own line and
   * both fields keep their full width. The row grows by one line instead of
   * eating a digit.
   */
  FIELDS: "flex min-w-0 flex-[1_1_11rem] flex-wrap items-center gap-2",
  META: "ml-auto flex flex-none items-center gap-2",
} as const;

// -----------------------------------------------------------------------------
// "While nobody is watching": THE STANDING ORDERS
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
// THEY SIT SECOND, DIRECTLY UNDER "RIGHT NOW", where they used to be the page's
// last card. The original order — see where you are, choose where to point, then
// decide what happens unattended — described the FIRST SESSION only. After that
// one setup the target rarely moves, and everything a returning reader wants is
// in the top two sections: is the lock holding, does it survive a reboot, is the
// safety net armed, is the window still right. The three-field forms come after.
//
// It also resolves where failover belongs. `qmanager_tower_failover` releases
// BOTH radios and has only one device-wide RSRP to work from, so rendering it
// inside the LTE card would claim it protects LTE. These tiles are not leg
// cards, which is exactly the property that makes a section of their own the
// right home.

/**
 * Three tiles, stepped rather than equal: the schedule carries seven 44px day
 * chips plus two time fields and genuinely needs the room, where persistence is
 * a label and a switch. Equal thirds would either wrap the weekday row or leave
 * the first tile mostly empty.
 *
 * QUERIES `@container/section`, NOT `/card` and no longer `/hero`. These tiles
 * live in `TOWER_SECTION`, which — like `TOWER_HERO` — declares `section`. A
 * stale `/hero` or `/card` variant left behind here would silently never match,
 * so the grid would stay single-column at every width and the collapse would
 * look like a design choice rather than a dead query.
 */
export const AUTO_GRID =
  "grid grid-cols-1 gap-3 @xl/section:grid-cols-2 @4xl/section:grid-cols-[1fr_1fr_1.5fr] @xl/section:items-stretch";

/**
 * One automation tile. `rounded-tile` (28px) inside the 36px section, per
 * Radius-Follows-Size, on the `surface-container` step so it reads as an inner
 * unit of the section rather than as a card of its own — and so it matches the
 * live strip's panels in the section above.
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
  TRACK: "h-full w-full overflow-hidden rounded-pill bg-surface-container-high",
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
 * The card- and section-scoped notice.
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

/** Which failover state is in force. See `FAILOVER_BADGE` for why there are five. */
export type TowerFailoverKey =
  | "disabled"
  | "standby"
  | "armed"
  | "stalled"
  | "unknown"
  | "fallback";

/**
 * Is there a lock for failover to guard?
 *
 * A TRI-STATE, BECAUSE A BOOLEAN CANNOT CARRY THE ANSWER. `status.sh` seeds
 * `lte_locked="false"` before it asks the modem anything and only ever emits
 * `lte_read_ok:false` ALONGSIDE that seed — so on a failed read, "no lock" and
 * "nobody managed to ask" arrive as the identical boolean. A `read_ok` guard
 * written against a boolean sink therefore changes nothing at all; the third
 * value is the fix. See `lockPresence`.
 */
export type TowerLockPresence = "present" | "absent" | "unknown";

/**
 * Collapse the two legs into one presence verdict for the failover chip.
 *
 * A leg that reports locked on a SUCCESSFUL read settles it: `present`. Failing
 * that, any leg whose read failed makes the whole verdict `unknown` — an
 * unlocked-and-read leg cannot vouch for its unread sibling. Only when both
 * legs were read and neither is locked is the answer honestly `absent`.
 *
 * `=== false`, never `!== true`: the flags are optional and absent means true,
 * because a statically-exported bundle can outlive the CGI that emits them (see
 * `TowerModemState`). `!== true` would repaint a working page as unknown the
 * moment the two halves fall out of step.
 */
export function lockPresence(
  modemState: {
    lte_locked?: boolean;
    nr_locked?: boolean;
    lte_read_ok?: boolean;
    nr_read_ok?: boolean;
  } | null,
): TowerLockPresence {
  if (!modemState) return "unknown";
  const lteUnread = modemState.lte_read_ok === false;
  const nrUnread = modemState.nr_read_ok === false;
  if (!lteUnread && modemState.lte_locked) return "present";
  if (!nrUnread && modemState.nr_locked) return "present";
  if (lteUnread || nrUnread) return "unknown";
  return "absent";
}

/**
 * Failover state -> Badge variant + glyph.
 *
 * Keyed onto `BadgeVariant` rather than a class string, so a fifth state
 * without a matching role fails the build instead of shipping untinted.
 *
 * FIVE STATES, AND THE BAND-LOCKING MAP'S THREE DO NOT TRANSFER. Band locking
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
 * `stalled` is the fifth, and it is a FAULT rather than a condition: failover
 * is switched on, a lock exists to guard, and no watcher is running — the net
 * should be out and it is not. It is the only state on this chip that routes to
 * `destructive`, because it is the only one describing something that is not
 * working. See `failoverKey` for the daemon path that produces it.
 *
 * Every state carries a DISTINCT glyph. `armed` and `fallback` are the pair
 * that makes this mandatory rather than tidy: `success-container` and
 * `warning-container` measure 1.03:1 apart and are the SAME surface under
 * deuteranopia, so the glyph is the only channel separating "the safety net is
 * watching" from "the safety net has fired and your lock is not in force".
 * `stalled` takes `error`, unused by the other four for the same reason.
 */
export const FAILOVER_BADGE: Record<
  TowerFailoverKey,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  // Deliberately off, not broken. `muted`, never `destructive`.
  disabled: { variant: "muted", glyph: "do_not_disturb_on" },
  standby: { variant: "info", glyph: "schedule" },
  armed: { variant: "success", glyph: "shield" },
  // Switched on, a lock to guard, and NO watcher. See `failoverKey`.
  stalled: { variant: "destructive", glyph: "error" },
  // Switched on, no watcher, and the lock read failed — so which of the two
  // above is in force cannot be known. `muted` + `help`, matching `LEG_BADGE`.
  unknown: { variant: "muted", glyph: "help" },
  // Degraded but running: the modem is connected, just not where you told it.
  fallback: { variant: "warning", glyph: "warning" },
};

/**
 * Resolve the failover chip from the two flags plus whether any lock exists.
 *
 * `activated` outranks `watcher_running`: a watcher that has already fired is
 * reporting a fallback, not protection, even while it keeps looping.
 *
 * THE `fallback` BRANCH IS LIVE CODE AS OF THIS CHANGE, AND WAS NOT BEFORE.
 * `qmanager-tower-failover.service` used to delete the activation flag in
 * `ExecStopPost`, milliseconds after the daemon wrote it and exited, so
 * `activated` was true for a window no poll could ever land in and this line
 * had never once rendered. The delete has moved to `ExecStartPre`, which gives
 * the flag a real lifetime: A FAILOVER HAS FIRED SINCE THE WATCHER LAST
 * STARTED.
 *
 * That lifetime is what the chip's copy has to match, and it does: "Released —
 * weak signal" is a past-tense report of an event, not a claim about a
 * condition still in progress. It is also self-consistent with the state it
 * implies — the lock is gone, so there is nothing left to guard, and `armed`
 * would be a lie. The glyph (`warning`) is distinct from all three of its
 * slot-mates, which is what carries it: `armed` is `success-container` and this
 * is `warning-container`, 1.03:1 apart and identical under deuteranopia.
 */
export function failoverKey(
  failover: { enabled: boolean; activated: boolean; watcher_running: boolean },
  presence: TowerLockPresence,
): TowerFailoverKey {
  if (!failover.enabled) return "disabled";
  if (failover.activated) return "fallback";
  if (failover.watcher_running) return "armed";
  // Enabled, nothing fired, NO watcher. All three remaining cases are honestly
  // "not currently guarding", and they are three different facts:
  //
  //   absent   -> `standby`. Nothing to protect; the net is correctly furled.
  //   present  -> `stalled`. THE NET SHOULD BE OUT AND IT IS NOT.
  //   unknown  -> `unknown`. Nobody read the modem, so neither claim is ours.
  //
  // This line returned `armed` for `present`, which is the one reading it must
  // never give. `qmanager_tower_failover` now has a give-up-honestly exit
  // (`:245`): it refuses to write the activation flag it cannot justify, then
  // exits 0 — leaving exactly `enabled && !activated && !watcher_running` with
  // the lock still on. The old dishonest flag write at least produced
  // `fallback`; `armed` claims a daemon that has died in failure is watching.
  //
  // And it took a BOOLEAN, which is why `unknown` had nowhere to land: a failed
  // `AT+QNWLOCK` read arrives as `locked:false`, so the chip promised "no lock
  // to guard" about a modem nobody had managed to ask.
  if (presence === "present") return "stalled";
  if (presence === "unknown") return "unknown";
  return "standby";
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
 * `unknown` is a real state, not a loading placeholder: `status.sh` seeds
 * `lte_locked="false"` before it asks the modem anything, so a failed
 * `AT+QNWLOCK` read arrives downstream indistinguishable from "not locked". A
 * surface that renders that as a confident "Unlocked" is asserting something
 * nobody read back. `modem_state.lte_read_ok` / `nr_read_ok` are what finally
 * tell the two apart — see `TowerModemState`.
 *
 * The glyph is `help`, NOT the `schedule` clock it used to be. A clock says
 * "waiting, this will arrive"; the state it actually describes is "the modem
 * did not answer and nothing is coming until you retry". It is distinct from
 * both of its slot-mates, which is mandatory rather than tidy — `unlocked`'s
 * `success-container` and a `warning-container` measure 1.03:1 apart and are
 * the same surface under deuteranopia, so the glyph is the only separator any
 * reader is guaranteed to get.
 */
export const LEG_BADGE: Record<
  LegPosture,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  locked: { variant: "warning", glyph: "lock" },
  unlocked: { variant: "success", glyph: "lock_open" },
  unknown: { variant: "muted", glyph: "help" },
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
  // `help`, not a clock: this is now reached by `persist_read_ok === false`,
  // which is "the modem did not answer", not "the answer is on its way". It
  // must also stay distinct from `off`'s `do_not_disturb_on` — those two are
  // both `muted`, so the glyph is the ONLY thing separating "switched off" from
  // "never read".
  unknown: { variant: "muted", glyph: "help" },
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
 *
 * `persist_read_ok` IS WHAT MAKES THE `unknown` BRANCH REACHABLE. It already
 * returned `unknown`, but only for a null `modemState` — which a `success:true`
 * response never produces, so that branch never ran. `status.sh` seeds both
 * persist flags false before it asks the modem, so a FAILED read arrived here
 * as `false, false` and rendered the muted `Disabled` chip: "the user turned
 * this off". That was the single most dishonest pixel on the surface, since it
 * describes a deliberate choice nobody made.
 *
 * TESTED `=== false`, NEVER `!== true`. The field is optional on purpose — see
 * `TowerModemState` — so that a cached page bundle meeting an un-upgraded
 * `status.sh` reads `undefined` and keeps rendering the fields it was given,
 * rather than repainting a working page as unknown.
 */
export function persistPosture(
  modemState: {
    persist_lte: boolean;
    persist_nr: boolean;
    persist_read_ok?: boolean;
  } | null,
): "on" | "off" | "split" | "unknown" {
  if (!modemState) return "unknown";
  if (modemState.persist_read_ok === false) return "unknown";
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
  /**
   * `SECTION_HEAD`'s three parts. The title is 16px/600 and the description
   * 14px, both a step up from a leg card's — a section heads more content, so
   * its skeleton must not mirror the card scale.
   */
  SECTION_TITLE: "h-6 w-36",
  SECTION_DESC: "h-5 w-72",
  /**
   * The right-hand meta slot: freshness stamp plus `HERO_REFRESH_BUTTON`.
   * MEASURED at 28px tall. The width is a 28px stamp pill (76px at en-GB's
   * `07:31 PM`) plus the 22px refresh button and its 10px gap — about 108px.
   *
   * `w-32` (128px) is deliberately WIDER than that, because the stamp's width
   * is set by the locale's time format and this mirror cannot see it. Erring
   * wide is free here: the slot is `ml-auto`, so a placeholder a few pixels
   * over only eats empty header space, while one that is too narrow lets the
   * header's right edge jump on handoff.
   */
  SECTION_META: "h-7 w-32 rounded-pill",
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
   * The verdict block.
   *
   * MEASURED in-browser across the verdict states at 18.5rem: 128px for the
   * one-line bodies (`on_target`), 148px for the two-line ones (`unlocked`).
   * This figure is the TALLER measurement, not an average of the two.
   *
   * Both numbers grew ~35px when the block became a centred empty-state stack:
   * the disc went 36px -> 48px and moved OFF the title's row onto one of its
   * own, and the padding went `py-3.5` -> `py-6`. A mirror left at the old
   * 113px would now under-shoot every state.
   *
   * The taller case is the one to mirror. A skeleton that SHRINKS on load pulls
   * the panel beside it upward into space the reader had already started on,
   * whereas one that grows only pushes down into space nobody has read yet.
   *
   * A FLOOR, NOT A FIXED HEIGHT. `STRIP_GRID` stretches this column to the
   * carrier panel beside it, and a `h-` would win against that stretch — so the
   * placeholder would sit at 113px while the loaded block fills the row, and the
   * strip would visibly re-square itself on load. `min-h-` keeps the measured
   * floor for the stacked layout and lets the stretch take over above `@3xl`.
   */
  VERDICT: "min-h-[9.25rem] w-full rounded-tile",
  /**
   * One camped-carrier tile. MEASURED in-browser at 87px.
   *
   * Every carrier tile is the same height, so unlike the retired
   * lead-plus-rows pair this needs exactly one mirror. Note that a tile can
   * render TALLER than this when it shares a grid row with the note tile —
   * grid rows stretch to their tallest cell. That is the row stretching the
   * tile, not the tile growing, so it is not what this mirrors.
   */
  CARRIER_TILE: "h-[5.4375rem] w-full rounded-tile",
  /*
   * There is deliberately NO `SLOT_ROW` mirror here.
   *
   * `SLOT_ROW.ROOT` sets a `min-h-14` floor, but a loaded row hosts a 42px
   * `FIELD_CONTROL` inside its vertical padding and settles taller than that
   * floor. A flat number here would be a second measurement of the same row,
   * kept in step by hand. `lte-tower-card.tsx` instead builds its placeholder
   * out of `SLOT_ROW.ROOT` plus the same `FIELD_CONTROL` mirror the loaded row
   * uses, so the two agree by construction. Composing beats mirroring wherever
   * the real shape is available to compose — do not add the constant back.
   */
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
