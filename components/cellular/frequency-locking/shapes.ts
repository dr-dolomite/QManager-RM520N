import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { formatFrequency, getDLFrequency } from "@/lib/earfcn";

// =============================================================================
// Frequency Locking — shared geometry and tone contract
// =============================================================================
// The single source of truth for this surface's shapes, tones and skeleton
// mirrors. Modelled on `components/cellular/tower-locking/shapes.ts` and
// `components/cellular/band-locking/shapes.ts`, for the same reason both of
// those exist: the incumbent frequency-locking code restated its card shell in
// two mirrored files that had drifted apart, declared its skeleton geometry in a
// different branch from its loaded geometry, and carried no status chip at all.
//
// RESTATED, NOT IMPORTED. Several strings here are byte-identical to the
// tower-locking contract's. That is the house convention rather than an
// oversight — a surface takes no dependency on a sibling route's module graph,
// so tower locking can be re-shaped without silently re-shaping this page.
//
// -----------------------------------------------------------------------------
// WHAT THIS SURFACE IS
// -----------------------------------------------------------------------------
// An ALLOW LIST, not a pair of switches. The page answers three questions in
// order, top to bottom:
//
//   1. THE LIVE STRIP — what is the radio on right now, and is it inside the
//      list? A verdict panel states the posture in one sentence; beside it the
//      carriers currently on air, each offering to join the list.
//   2. THE TWO LOCK CARDS — the lists themselves. One per AT lock parameter
//      (`AT+QNWCFG="lte_earfcn_lock"`, `="nr5g_earfcn_lock"`). LTE takes up to
//      2 channels, NR up to 32 (ARFCN, SCS) pairs.
//   3. THE APPLY BAR — one bar owning the disclaimer, Clear all, and Apply.
//
// -----------------------------------------------------------------------------
// FIVE THINGS THAT MUST NOT DRIFT (each cost a recon round to establish)
// -----------------------------------------------------------------------------
//
// 1. NEVER RENDER THE AT COMMAND. The design comp this page was built from
//    printed `AT+QNWCFG="lte_freq_lock",1,1300,3350` in the apply bar. Every
//    token of that is wrong: the key is `lte_earfcn_lock` (`lte_freq_lock` does
//    not exist on this modem and returns ERROR), the count must equal the entry
//    count, and `lock.sh:93` joins values with COLONS, not commas. A
//    hand-written AT string in JSX cannot stay in sync with `lock.sh` — which is
//    exactly how the comp ended up with three wrong ones. Render the modem's
//    READ-BACK instead: what it answered, not what we asked. See `APPLY_BAR`.
//
// 2. THERE IS NO PERSISTENCE, AND NO TIMESTAMP. `AT+QNWCFG` has no save/persist
//    key at all — the full 90-key enumeration was captured live and there is
//    none. (`save_ctrl` is a TOWER-lock feature.) Frequency locking also has no
//    config file, so nothing anywhere knows when a lock was applied. Any "stored
//    on modem" chip or "held 3 h 06 min" readout would be inventing state this
//    feature does not have. The hook's own header comment claiming `save_ctrl`
//    persistence is wrong and is corrected in this change.
//
// 3. NO NUMBER ON THE RECONNECT COST. The comp said "about five seconds"; that
//    figure is borrowed from `AT+QNWLOCK` (a different command family) and was
//    never measured for `AT+QNWCFG`. `band-locking.md:493` records a
//    copied-without-checking "15 seconds" that shipped wrong, with the lesson
//    that a number in user-facing copy is a claim about the device. Say
//    "briefly" until someone measures it.
//
// 4. CHANNEL FREQUENCY, NOT BAND CENTRE. `channelFrequencyLabel` computes the
//    real downlink frequency per TS 36.101 / TS 38.104. EARFCN 1300 is 1815.0
//    MHz, not the 1800 MHz marketing name of B3. This is load-bearing: the whole
//    point of showing a frequency beside a channel number is that a wrong digit
//    becomes visible, and a band-level figure DOES NOT CHANGE when a digit
//    changes — 1300 and 1301 would both read "1800 MHz". Never reach for
//    `lib/band-frequency.ts` here.
//
// 5. THE GATE IS ONE-DIRECTIONAL, AND IT IS OURS. `frequency/lock.sh:60` and
//    `:154` refuse to run while a tower lock is active — QManager's CGI refuses,
//    the modem never sees the command. Do not write copy saying "the modem
//    refuses". The reverse direction has NO guard: `tower/lock.sh` contains no
//    frequency check, so applying a tower lock SILENTLY WIPES a live frequency
//    lock. That is why `LOCK_BADGE` carries a `blocked` posture and why the
//    apply bar reports read-back rather than intention — the read-back is the
//    only thing that can show a lock that vanished underneath the user.

// -----------------------------------------------------------------------------
// THE TONAL RAMP HAS EXACTLY FOUR STEPS
// -----------------------------------------------------------------------------
// `globals.css` defines `surface`, `surface-container` and `surface-container-
// high` and nothing else — there is NO `-low` and NO `-highest`, and the outline
// token is `outline`, not `outline-variant`. Tailwind silently drops a class
// naming a token that does not exist, so an invented step does not fail the
// build; it renders as a transparent panel that looks almost right in dark mode
// and wrong in light.
//
// Nesting, outermost first, which is what this file's fills encode:
//
//   background              the page
//   surface                 a section card (the hero, the apply bar)
//   surface-container       a panel inside one (the verdict, the carrier rail)
//   surface-container-high  a tile inside a panel (a carrier, an input)
//
// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** Page root. Container queries against `@container/main`, never a viewport. */
export const PAGE_SHELL = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The two-up lock-card grid, and the cell that equalises heights.
 *
 * `CARD_CELL` is the house idiom for side-by-side cards, used by the dashboard
 * (`home-component.tsx:74`), tower locking (`tower-locking.tsx:396`), band
 * locking and SMS forwarding. The `Card` itself must stay height-free — the
 * CELL forces the height, so a card whose data has not landed matches its
 * row-mate instead of sizing to its own content.
 *
 * The LTE card (2 slots) and the NR card (up to 32 entries) are asymmetric by
 * nature, so pair this with `CARD_FOOT`'s `mt-auto`: the slack collects at the
 * card's floor behind its actions, rather than as a gap in the middle.
 */
export const CARD_GRID = "grid grid-cols-1 gap-4 @3xl/main:grid-cols-2";
export const CARD_CELL = "h-full *:data-[slot=card]:h-full";

/** Peer card in the grid: role radius at the call site, no border, no shadow. */
export const CARD_SHELL = "rounded-card border-0 shadow-none";
export const CARD_PAD = "px-5 @lg/card:px-6";

/**
 * Card footer. `mt-auto` pins actions to the card's floor — these cards sit in
 * an equal-height row, so without it a card shorter than its row-mate leaves its
 * buttons floating above a void.
 */
export const CARD_FOOT =
  "mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-3";

// -----------------------------------------------------------------------------
// The live strip — "Right now"
// -----------------------------------------------------------------------------

/**
 * The anchor card on this surface, so `rounded-hero` rather than `rounded-card`
 * (the Radius-Follows-Size Rule). It holds the verdict and the carriers on air.
 */
export const HERO = {
  ROOT: "rounded-hero border-0 bg-surface shadow-none",
  /**
   * Tighter vertically than horizontally. The hero's two children are already
   * padded panels, so a symmetric `p-6` stacks 24px of card padding on top of
   * 20px of panel padding at the seam and the strip reads as floating inside an
   * oversized frame. The side gutter keeps the full measure — that one is doing
   * real work against the page edge.
   */
  BODY: "flex flex-col gap-3.5 px-5 py-4 @lg/card:px-6 @lg/card:py-5",
  HEAD: "flex flex-wrap items-center gap-2.5",
  TITLE: "text-base font-semibold",
  /**
   * Verdict rail + carriers. The rail is fixed so the verdict sentence keeps a
   * stable measure while the carrier grid absorbs the reflow; below the query
   * they stack and the rail goes full width.
   */
  SPLIT: "grid grid-cols-1 gap-3 @2xl/main:grid-cols-[minmax(0,19rem)_1fr]",
} as const;

/**
 * The verdict panel — one tonal block stating the posture in a sentence.
 *
 * Tones key onto `LockPosture`. `locked` is the AMBER one, matching the chip in
 * `LOCK_BADGE` and the same treatment band locking and tower locking give a
 * constrained radio.
 *
 * `blocked` is `surface-container-high`, NOT a destructive red. The comp painted
 * it red; nothing failed there — the user deliberately set a tower lock, and
 * red would also encode the two locks as different severities when they are the
 * same kind of thing.
 */
export const VERDICT = {
  /**
   * CENTRED, on the shadcn `Empty` model: disc, title, body and chips are one
   * centred group, vertically centred in whatever height the carrier rail
   * opposite forces.
   *
   * The rail sets the row height and always outgrows this panel, so a
   * top-aligned stack left a growing void under the chips — the panel looked
   * like it had failed to load its last element. Centring turns that slack into
   * symmetric breathing room, which is exactly the empty-state read this panel
   * wants: one glyph, one sentence, done.
   *
   * Note the FOOT deliberately does NOT carry `mt-auto` any more. `mt-auto` on
   * the last child eats all the free space before it, which pins the group to
   * the top and silently cancels `justify-center`.
   */
  ROOT: "flex flex-col items-center justify-center gap-3 rounded-tile p-5 text-center",
  DISC: "flex size-10 items-center justify-center rounded-pill",
  TITLE: "text-lg font-semibold text-balance",
  BODY: "max-w-[17rem] text-[13px]/5 text-pretty",
  /** Chip row, centred under the sentence it qualifies. */
  FOOT: "flex flex-wrap items-center justify-center gap-1.5",
} as const;

export const VERDICT_TONE: Record<
  LockPosture,
  { panel: string; disc: string; glyph: MaterialSymbolName; filled: boolean }
> = {
  locked: {
    panel: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    glyph: "lock",
    filled: true,
  },
  unlocked: {
    panel: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    glyph: "lock_open",
    filled: false,
  },
  blocked: {
    panel: "bg-surface-container-high text-on-surface",
    disc: "bg-surface text-on-surface-variant",
    glyph: "block",
    filled: false,
  },
  unknown: {
    panel: "bg-surface-container text-on-surface",
    disc: "bg-surface-container-high text-on-surface-variant",
    glyph: "schedule",
    filled: false,
  },
};

// -----------------------------------------------------------------------------
// Carriers on air
// -----------------------------------------------------------------------------

export const CAMPED = {
  ROOT: "flex flex-col gap-3 rounded-tile bg-surface-container p-5",
  HEAD: "flex flex-wrap items-center gap-2",
  LABEL: "text-sm font-semibold",
  META: "ms-auto text-xs tabular-nums text-on-surface-variant",
  /** Auto-fit so 1–3 carriers fill the rail without a dead third column. */
  GRID: "grid grid-cols-1 gap-2 @xl/main:grid-cols-2 @4xl/main:grid-cols-3",
  /** Trailing note pinned to the floor, matching the verdict panel opposite. */
  NOTE: "mt-auto text-xs text-on-surface-variant text-pretty",
} as const;

/**
 * A carrier tile. `MATCH` marks a carrier already inside the allow list.
 *
 * The ring is `--primary`, NOT amber, and this is not a free choice. The comp
 * drew a 2px `--success` outline; the Fill-Over-Stroke Rule forbids a coloured
 * stroke on a tonal container, and a functional role token is never a legal
 * stroke colour in the first place. Band locking's live-band ring and tower
 * locking's `CARRIER_TILE.MATCH` both resolve this the same way — an inset
 * primary ring, which reads as "this one is spoken for" without claiming a
 * health role. Amber stays on the CHIP and the VERDICT, which is where the
 * user's mental model for "constrained" is being built.
 */
export const CARRIER_TILE = {
  ROOT: "flex flex-col gap-2 rounded-field bg-surface-container-high p-3.5",
  MATCH: "shadow-[inset_0_0_0_2px_var(--primary)]",
  HEAD: "flex items-center gap-2",
  /**
   * Channel number: the tile's headline.
   *
   * 22px is a literal rather than a ramp step, and that is correct here rather
   * than sloppy. DESIGN.md's Numeric step is "deliberately not a fixed ramp" —
   * a numeral is read at the distance its container implies, so its size comes
   * from the slot holding it, and a literal `text-[Npx]` on a mono
   * `tabular-nums` figure is correct by construction. Shipped siblings run 52,
   * 44, 26 and 17px on the same rule. Prose never qualifies; this is a figure.
   */
  VALUE: "font-mono text-[22px]/none font-semibold tabular-nums",
  VALUE_LABEL: "text-xs text-on-surface-variant",
  META: "font-mono text-xs tabular-nums text-on-surface-variant",
  /** The add/locked affordance in the tile's top-right. */
  ACTION: "ms-auto flex size-7 items-center justify-center rounded-pill",
  ACTION_FREE: "bg-primary-container text-on-primary-container",
  ACTION_HELD: "bg-warning-container text-on-warning-container",
  ACTION_OFF: "bg-surface-container text-on-surface-variant opacity-60",
} as const;

/** The dashed explainer tile that fills the carrier grid's spare cell. */
export const CARRIER_NOTE_TILE =
  "flex flex-col justify-center gap-1.5 rounded-field border border-dashed border-outline p-3.5 text-on-surface-variant";

// -----------------------------------------------------------------------------
// Slot rows — the list entries themselves
// -----------------------------------------------------------------------------

export const SLOT = {
  LIST: "flex flex-col gap-2",
  /** Filled row: a channel is staged or locked here. */
  ROW: "flex min-h-[3.625rem] flex-wrap items-center gap-x-3 gap-y-2 rounded-field bg-surface-container px-4 py-3",
  /** Empty row: dashed, quieter, same height so the list does not jump. */
  ROW_EMPTY:
    "flex min-h-[3.625rem] flex-wrap items-center gap-x-3 gap-y-2 rounded-field border border-dashed border-outline px-4 py-3",
  INDEX: "w-11 flex-none text-xs font-semibold text-on-surface-variant",
  /** The staged channel. Numeric step, sized to the row — see CARRIER_TILE.VALUE. */
  VALUE: "font-mono text-[15px] font-semibold tabular-nums",
  META: "text-xs text-on-surface-variant",
  HINT: "text-[13px] text-on-surface-variant text-pretty",
  /** Trailing remove button. */
  DROP:
    "flex size-7 flex-none items-center justify-center rounded-pill bg-surface-container-high text-on-surface-variant",
} as const;

/** Input inside a slot row. Role radius and the 42px action height. */
export const SLOT_INPUT =
  "h-[2.625rem] min-w-0 flex-1 rounded-field bg-surface-container-high font-mono text-[13px] tabular-nums";

/**
 * The "Use current" control.
 *
 * Deliberately kept LIVE while a tower lock blocks Apply. The comp greyed the
 * whole form in that state, which disables the single action that helps a user
 * migrate off a tower lock — prefilling captures the channel they already
 * validated under it. Only Apply is gated. Where there is genuinely no carrier
 * to copy, the control is DISABLED WITH THE REASON ON IT, not enabled-then-
 * toast: the incumbent fired a toast after the click to say nothing happened.
 */
export const PILL_USE_CURRENT =
  "h-8 flex-none gap-1.5 rounded-pill px-3 text-xs font-semibold";

// -----------------------------------------------------------------------------
// The empty list
// -----------------------------------------------------------------------------

export const EMPTY = {
  ROOT: "flex flex-1 flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-outline p-6 text-center",
  TITLE: "text-sm font-semibold",
  BODY: "max-w-[19rem] text-xs text-on-surface-variant text-pretty",
} as const;

// -----------------------------------------------------------------------------
// Notices
// -----------------------------------------------------------------------------

/**
 * Inline notice inside a card. A BLOCK, never a chip — a filled amber chip and a
 * filled amber callout at the same scale in the same column is what creates the
 * read collision that made `warning` ambiguous on this page. Chip-vs-block are
 * different objects and the ambiguity dissolves.
 */
export const NOTICE = {
  ROOT: "flex items-start gap-2.5 rounded-field px-4 py-3",
  TEXT: "text-xs/relaxed text-pretty",
} as const;

export const NOTICE_TONE: Record<
  "warning" | "neutral" | "info",
  { root: string; glyph: MaterialSymbolName; filled: boolean }
> = {
  warning: {
    root: "bg-warning-container text-on-warning-container",
    glyph: "warning",
    filled: true,
  },
  neutral: {
    root: "bg-surface-container text-on-surface-variant",
    glyph: "info",
    filled: false,
  },
  info: {
    root: "bg-primary-container text-on-primary-container",
    glyph: "info",
    filled: false,
  },
};

// -----------------------------------------------------------------------------
// The apply bar
// -----------------------------------------------------------------------------

/**
 * One bar owning the reconnect disclaimer, Clear all and Apply.
 *
 * Its second line is the MODEM'S READ-BACK, never the AT command — see rule 1 in
 * the header. An echoed command tells you what QManager tried; a read-back tells
 * you what the modem did, and on this page those can disagree (a rejected entry,
 * or a tower lock silently clobbering the lock). The AT string structurally
 * cannot show that, because it echoes the request.
 */
export const APPLY_BAR = {
  ROOT: "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-tile bg-surface px-5 py-4",
  COPY: "flex min-w-0 flex-col gap-0.5",
  TITLE: "text-[13px] font-semibold",
  /** The read-back line. Machine voice, so mono — per the Machine-Voice Rule. */
  READBACK: "font-mono text-xs tabular-nums text-on-surface-variant",
  /** Disclaimer when there is nothing to read back yet. */
  NOTE: "max-w-[34rem] text-xs/relaxed text-on-surface-variant text-pretty",
  ACTIONS: "ms-auto flex flex-wrap items-center gap-2",
} as const;

/** Action pills. Matches tower locking's scale so the two pages feel like one. */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";
export const PILL_ACTION_PLAIN =
  "h-[2.625rem] rounded-pill px-5 text-sm font-semibold";
export const PILL_QUIET = "h-9 rounded-pill px-3.5 text-xs font-semibold";

/** Badge glyph size. Material Symbols need an explicit `size` at every site. */
export const BADGE_GLYPH_SIZE = 12;

// -----------------------------------------------------------------------------
// Tone maps
// -----------------------------------------------------------------------------

export type LockPosture = "locked" | "unlocked" | "blocked" | "unknown";

/**
 * Lock posture -> Badge variant + glyph.
 *
 * `locked` is `warning` and `unlocked` is `success`, which is a deliberate
 * reading of the functional contract rather than a value judgement: narrowing
 * the radio to a short list of channels is the state that can cost you the
 * connection, and `warning` means "constrained", not "you did something wrong".
 * Band locking and tower locking apply the same inversion, and matching them is
 * the point — a user who learns "amber = the radio is constrained" on two
 * sibling routes must not find a different colour here.
 *
 * `blocked` is `muted` — a deliberately-inactive state, which is precisely what
 * `muted` is for. It is NOT `destructive`: nothing failed, the user set a tower
 * lock on purpose.
 *
 * Every posture carries a DISTINCT glyph, and that is load-bearing rather than
 * decorative: `success-container` and `warning-container` measure 1.03:1 apart,
 * so they are the same surface under deuteranopia and very nearly the same
 * surface to everyone else. The glyph is what separates locked from unlocked.
 * `blocked` and `unknown` share `muted` and are told apart the same way.
 */
export const LOCK_BADGE: Record<
  LockPosture,
  { variant: BadgeVariant; glyph: MaterialSymbolName; filled: boolean }
> = {
  locked: { variant: "warning", glyph: "lock", filled: true },
  unlocked: { variant: "success", glyph: "lock_open", filled: false },
  blocked: { variant: "muted", glyph: "block", filled: false },
  unknown: { variant: "muted", glyph: "schedule", filled: false },
};

/**
 * The "Experimental" chip is a NON-STATUS label, so it takes `secondary` rather
 * than a status role.
 *
 * It was amber in the comp, which put a permanently-lit `warning` chip in the
 * title row of a page whose whole state system is about to use amber for
 * "locked". Amber would have meant three things at once here, and the topmost
 * one never changes.
 *
 * Quiet is also the honest register. "Experimental" is a permanent property of
 * the feature, and a warning chip that is always on is a warning nobody reads
 * after the first visit. The risk this page actually carries — a lock onto an
 * unsupported band can crash-dump the modem (`lock.sh:10`), and nothing here
 * self-heals — is communicated where it can be acted on: in the apply bar and
 * in the confirmation dialogs, contextually and unavoidably.
 */
export const EXPERIMENTAL_BADGE = {
  variant: "secondary" as BadgeVariant,
  glyph: "science" as MaterialSymbolName,
};

// -----------------------------------------------------------------------------
// Posture helpers
// -----------------------------------------------------------------------------

/**
 * Derive a leg's posture.
 *
 * `blocked` OUTRANKS `locked`: while a tower lock is active this page cannot
 * write at all, so reporting "Locked" would offer an edit that `lock.sh` will
 * refuse. `unknown` is a real state, not a loading placeholder — a null
 * `modemState` means `status.sh` has not answered, and rendering that as a
 * confident "Unlocked" asserts something nobody read back.
 */
export function lockPosture(
  modemState: { locked: boolean } | null,
  towerLockActive: boolean,
): LockPosture {
  if (towerLockActive) return "blocked";
  if (!modemState) return "unknown";
  return modemState.locked ? "locked" : "unlocked";
}

/**
 * The real downlink centre frequency of a channel, formatted.
 *
 * Per TS 36.101 §5.7 (LTE) and TS 38.104 §5.4.2.1 (NR) via `lib/earfcn.ts`.
 * Returns `null` when the channel is not on a known raster, so callers can omit
 * the clause rather than print a placeholder.
 *
 * See rule 4 in the header: this is the CHANNEL frequency, which changes with
 * every digit, not the band's marketing centre, which does not.
 */
export function channelFrequencyLabel(
  channel: number | null,
  technology: "LTE" | "NR",
): string | null {
  const mhz = getDLFrequency(channel, technology);
  return mhz === null ? null : formatFrequency(mhz);
}

/**
 * Whether a carrier reported by the poller is inside the allow list.
 *
 * Compares CHANNEL ONLY. A frequency lock takes no PCI — that is the whole
 * difference between this page and tower locking — so a carrier matches on its
 * channel number regardless of which physical cell the modem picked.
 */
export function isChannelAllowed(
  channel: number | null,
  allowed: readonly number[],
): boolean {
  return channel !== null && allowed.includes(channel);
}

// -----------------------------------------------------------------------------
// Skeleton mirrors
// -----------------------------------------------------------------------------

/**
 * Loaded geometry, restated once so the skeletons mirror it by IMPORT rather
 * than by estimate. The incumbent loading branches guessed `h-9 w-full
 * rounded-md` for inputs that render at 42px with a 20px radius.
 *
 * Sizes are the loaded element's LINE BOX, not its font size: a skeleton sized
 * to the glyph reflows the moment real text lands.
 */
export const SKELETON_SHAPE = {
  /** `CardTitle` (17px/600) and `CardDescription` (13px) line boxes. */
  TITLE: "h-6 w-40 rounded-inline",
  DESC: "h-5 w-56 rounded-inline",
  /** A status chip: 22px tall, pill. */
  CHIP: "h-[1.375rem] w-24 rounded-pill",
  /** A slot row, mirroring `SLOT.ROW`'s min-height exactly. */
  SLOT_ROW: "h-[3.625rem] w-full rounded-field",
  /**
   * A carrier tile, mirroring `CARRIER_TILE.ROOT`: 14px pad, a 28px head row,
   * 8px gap, the 22px channel figure, 14px pad. Two rows now, not three — it
   * lost its meta line when the tile narrowed to the channel number.
   */
  CARRIER: "h-[5.375rem] w-full rounded-field",
  /** The verdict panel. */
  VERDICT: "h-[13rem] w-full rounded-tile",
  /** An action pill at `PILL_ACTION`'s 42px height. */
  ACTION: "h-[2.625rem] w-32 rounded-pill",
} as const;
