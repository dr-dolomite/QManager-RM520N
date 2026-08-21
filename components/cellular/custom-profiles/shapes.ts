import { TILE_SHAPE } from "@/components/cellular/tile-shape";
import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import type { ApplyStepStatus } from "@/types/sim-profile";

// =============================================================================
// Custom Profiles + Connection Scenarios — shared geometry and tone contract
// =============================================================================
// This file is the single source of truth for the surface's shapes and tones.
// Every consumer IMPORTS from here. A skeleton that restates a number, or a row
// that hand-writes `bg-success/5`, has left the contract.
//
// -----------------------------------------------------------------------------
// WHAT THE 2026-08-21 RE-AUTHORING CHANGED, AND WHY
// -----------------------------------------------------------------------------
// The previous generation of this file was written against the *tonal* language
// that preceded the finalized one. It was correct for its own system and is
// wrong for this one in a single, consistent way: it spent COLOUR ON THE BOX.
// A mismatched profile row painted its whole 76px fill `--tone-warning-1`; the
// hero's scenario tile and the in-force scenario tile painted 104px and 144px
// of `--primary-container`; band numbers rendered as filled neutral pills.
//
// The finalized canon assigns each of the three colour layers a size:
//
//   INK      (`--X-on-surface`)                  — values and strokes on neutral
//                                                  ground. THE DEFAULT.
//   FILL     (`--X` + `--X-foreground`)          — compact emphasis only: glyph
//                                                  discs, bar fills, buttons.
//   CONTAINER(`--X-container` + `--on-X-…`)      — status chips, banners and
//                                                  condition screens. NOTHING
//                                                  ELSE.
//
// A tile is not a chip and a row is not a banner, so neither may take the
// container layer. The rule this file now enforces everywhere is the one the
// SMS family states in one line: THE BODY IS NEUTRAL, THE DISC CARRIES THE
// COLOUR. A row's fill is `surface-container` whatever its status; the status is
// carried by its glyph disc and by a filled `Badge` that NAMES the state in
// words. That is also what makes the state survive deuteranopia, where
// `success-container` and `warning-container` are the same surface.
//
// Identity — an APN string, a band number, a scenario name, a PDP type — is not
// status, so it never takes a Badge. It takes an outline `Tag`
// (`components/ui/tag.tsx`), whose `nr` / `lte` / `neutral` roles make `n78`
// read as NR on this page exactly as it does on the dashboard and the scanner.
// The `CONFIG_PILL*` family that used to live here is gone for that reason: it
// was a filled chip doing a tag's job, and the compiler cannot catch that as
// long as a class string is available to reach for.
//
// -----------------------------------------------------------------------------
// THE TONE RULE (why washes are not a matter of taste here)
// -----------------------------------------------------------------------------
// `bg-{role}/5` is alpha-over-neutral. It is not a token, it does not survive a
// theme flip predictably, and two of them side by side land at different
// perceived lightness depending on what happens to be underneath. Where this
// surface needs a stroke rather than a fill — the suggestion row, the add-tile —
// it draws an INSET RING from a real token, so the element costs no extra layout
// box and an active/inactive pair stays pixel-identical in size.
// =============================================================================

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/**
 * A card on this surface. The profile list, the scenario grid and the Today
 * strip each sit as one card among siblings, not as the single dominant surface
 * of the page — only the hero is the anchor.
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

/**
 * The compact pill an inline action takes: the hero's Edit / Deactivate, a
 * scenario tile's Apply. 36px, so a cluster of them beside a 22px status chip
 * does not out-weigh the chip it sits next to.
 */
export const PILL_ACTION_SM =
  "h-9 gap-1.5 rounded-pill px-3.5 text-[0.8125rem] font-semibold";

/**
 * A square icon-only button — the row's overflow menu. Same 36px height as
 * `PILL_ACTION_SM` so a row's trailing cluster sits on one optical baseline.
 */
export const ICON_ACTION = "size-9 rounded-pill p-0";

/**
 * The Display triple every migrated page `h1` carries.
 *
 * Prefer `CellularPageHeader` (`components/cellular/page-header.tsx`), which
 * owns this string plus the description step and the actions row. This export
 * survives only for the dialog titles that need the tracking without the header
 * component's layout.
 */
export const PAGE_TITLE = "text-3xl font-bold tracking-[-0.02em]";

/** The page description directly under it. */
export const PAGE_DESCRIPTION = "text-on-surface-variant";

/** An eyebrow above a value, anywhere on this surface. */
export const EYEBROW =
  "text-xs font-medium tracking-[0.06em] text-on-surface-variant";

/** The quiet caption under a tile's value — a schedule window, a hint. */
export const TILE_CAPTION = "text-xs text-on-surface-variant";

/**
 * Machine-voice values — band lists, EARFCN, PCI, APN strings, ICCIDs, mode
 * tokens. The Machine-Voice Rule: a value the device emits is set in mono, a
 * label a human wrote is not.
 */
export const MACHINE_VALUE = "font-mono tabular-nums";

/** Glyph size inside a `Badge` or a `Tag`. Matches their `[&>svg]:size-3` slot. */
export const BADGE_GLYPH_SIZE = 12;

// -----------------------------------------------------------------------------
// Profile list rows
// -----------------------------------------------------------------------------

/**
 * One profile row.
 *
 * NOTE ON THE TWO EARLIER DRAFTS. The first modelled this on the Radio
 * Information summary TILE — single-line, `items-center`, a `HEIGHT` mirror —
 * and every member went unused because the shipped row was a stacked card. The
 * second wrote the stacked card down faithfully: identity line, scenario line,
 * a wrapped strip of five config pills, an optional notice, a footer. Recording
 * it accurately was right; keeping it was not. Five filled pills per row over
 * four rows is twenty filled boxes in a column, which is what forced the row's
 * own fill to go coloured to stay distinguishable from its contents — the
 * defect chased its own cause.
 *
 * The row is now single-line again, but on the right anatomy this time: a 40px
 * glyph disc, a name over a wrapped strip of OUTLINE tags, the profile's
 * schedule as an 8px condensed ribbon, a status chip, an overflow button. The
 * tags are transparent, so the row's neutral fill is the only fill in it and
 * never has to compete.
 *
 * RADIUS. `rounded-pill` at wide widths — a row that acts is a pill (the Shape
 * Scale). It steps down to `rounded-tile` in a narrow container, where the tags
 * wrap to a second line and a 38px end-cap on a 110px-tall box reads as a
 * lozenge rather than a row.
 *
 * HEIGHT IS A FLOOR, DELIBERATELY. `TILE_SHAPE` pins because a tile's content
 * is bounded; a row's is not — the tag strip wraps. The skeleton therefore
 * mirrors by rendering `ROOT` itself with placeholder children (see
 * `custom-profile-view.tsx`), not by restating a number, which is the only
 * honest mirror for a variable-height box.
 */
export const PROFILE_ROW_SHAPE = {
  /** The list wrapper. */
  LIST: "flex flex-col gap-3",
  ROOT: "group/row flex min-h-[4.75rem] items-center gap-3.5 rounded-tile px-4 py-3 @lg/card:rounded-pill @lg/card:px-[1.125rem]",
  /** The leading glyph disc. 40px — a row disc, not the hero's 52px. */
  DISC: "grid size-10 flex-none place-items-center rounded-pill",
  /** Name over tags. `min-w-0` so the name truncates instead of pushing. */
  COL: "flex min-w-0 flex-1 flex-col gap-1.5",
  NAME: "truncate text-[0.9375rem] font-semibold tracking-[-0.01em]",
  META: "flex flex-wrap items-center gap-1.5",
  /** The trailing cluster: chip + overflow. Never wraps under the name. */
  ACTIONS: "flex flex-none items-center gap-2",
} as const;

/**
 * Row fill by profile status.
 *
 * ALL THREE ARE NEUTRAL, AND THAT IS THE POINT. The previous generation gave
 * `mismatch` a `--tone-warning-1` fill, which is a legitimate construction in
 * the ramp's own idiom — the cell scanner still uses it correctly for a
 * condition band. It is wrong HERE for two reasons. First, a mismatch is a
 * property of the profile's binding, not of the row's existence, and painting
 * the whole row makes the SIM the loudest object on a page whose subject is the
 * profile. Second, warning is then spent twice in the same row: once on the fill
 * and once on the chip that says "SIM changed" in words — and only the chip
 * survives a colourblind read, so the fill is decoration paid for in contrast.
 *
 * Emphasis instead moves to channels the row's contents do not compete for: the
 * glyph disc (see `PROFILE_ROW_DISC_TONE`) and the status chip. `active` adds a
 * 2px INSET primary ring, which costs no layout box, so an active and an
 * inactive row stay pixel-identical in size — a real border would shift every
 * child by 2px the moment a row activated.
 *
 * This is not a No-Hairline-On-Fill violation. That rule bans a stroke drawn to
 * compensate for a fill too weak to read. Here the fill is neutral by intent and
 * the ring IS the emphasis.
 */
export function profileRowTone(
  status: "active" | "mismatch" | "inactive",
): string {
  const base =
    "bg-surface-container text-on-surface transition-colors duration-[var(--duration-standard)] ease-[var(--ease-standard)] hover:bg-surface-container-high";
  switch (status) {
    case "active":
      return `${base} ${PROFILE_ROW_ACTIVE_RING}`;
    case "mismatch":
    case "inactive":
      return base;
  }
}

/**
 * The active row's emphasis ring. Inset so it occupies no layout box — see the
 * rationale on `profileRowTone`. Exported separately because the scenario tile
 * grid marks its in-force tile the same way, and the two must never disagree on
 * the ring's weight.
 */
export const PROFILE_ROW_ACTIVE_RING = "shadow-[inset_0_0_0_2px_var(--primary)]";

/**
 * The row's glyph disc, by status. This is the surface's one coloured object
 * per row, and it takes the FILL layer (`--X` + `--X-foreground`) rather than a
 * container pair — the Glyph-Disc Rule: a state icon sits in a filled circle on
 * the role's strong fill, never its pale container.
 *
 * `mismatch` is `warning` here and NOT on the row body, which is the whole
 * substitution this re-authoring makes.
 */
export const PROFILE_ROW_DISC_TONE: Record<
  "active" | "applying" | "mismatch" | "inactive",
  string
> = {
  active: "bg-primary text-primary-foreground",
  applying: "bg-primary text-primary-foreground",
  mismatch: "bg-warning text-warning-foreground",
  inactive: "bg-surface-container-high text-on-surface-variant",
};

/**
 * A suggested-profile row. A suggestion is an OFFER, not a state: nothing is
 * applied, so it takes no fill at all. The dashed inset ring says "empty slot"
 * — semantic, not a prop under a weak fill — and `--outline` is the canon
 * stroke token, replacing the `border-primary/40` opacity wash that could not
 * survive a theme flip.
 *
 * A `border` rather than an inset shadow, because CSS cannot dash a shadow. It
 * is the one bordered box on this surface, and it is bordered precisely because
 * it has no fill for a border to be redundant against.
 */
export const SUGGESTION_ROW =
  "border-outline text-on-surface border border-dashed bg-transparent";

/** Its disc: an outline ring, matching the row's own no-fill construction. */
export const SUGGESTION_DISC =
  "border-outline text-on-surface-variant border border-dashed bg-transparent";

/**
 * The live dot beside the armed schedule readout.
 *
 * THE ONE-LOOP RULE BUDGET FOR THIS SURFACE IS SPENT HERE. It moved out of the
 * profile row and into the Today strip in the re-authoring: a dot per row is
 * one loop per row, and the strip is where "armed" is actually asserted. If a
 * future change wants an ambient loop somewhere else on this page, this one has
 * to go first.
 *
 * `currentColor`, so the caller's ink decides the hue and the dot can never end
 * up green beside destructive text. The ring animates `transform` + `opacity`
 * only, on the `ambient` clock (2s, deliberately NOT doubled with the rest of
 * the scale — a loop is not a transition, and a 4s breath reads as a stalled UI
 * rather than a calm one).
 */
export const LIVE_DOT = {
  ROOT: "relative inline-flex size-[0.4375rem] flex-none",
  CORE: "relative size-[0.4375rem] rounded-pill bg-current",
  RING: "absolute inset-0 rounded-pill bg-current motion-safe:animate-live-ping",
} as const;

// -----------------------------------------------------------------------------
// Status chips
// -----------------------------------------------------------------------------

/**
 * Profile / scenario status -> Badge variant + glyph.
 *
 * THIS MAP IS THE FIX FOR THE SURFACE'S ONE REAL ACCESSIBILITY BUG. The
 * pre-rebuild `active-config-card.tsx` rendered its chips with a hand-drawn
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
  "active" | "applying" | "inactive" | "mismatch" | "partial" | "failed",
  { variant: BadgeVariant; glyph: MaterialSymbolName; spin?: boolean }
> = {
  active: { variant: "success", glyph: "check_circle" },
  applying: { variant: "info", glyph: "progress_activity", spin: true },
  inactive: { variant: "muted", glyph: "do_not_disturb_on" },
  // The three degraded states are deliberately separated by GLYPH, not by tone.
  // `mismatch` and `partial` are both `warning` — they are the same severity —
  // and `success-container`/`warning-container` measure 1.03:1 apart, so the
  // glyph is doing all of the work: `swap_horiz` (the modem is running a
  // DIFFERENT profile than the one saved) versus `warning` (the profile IS the
  // saved one, but a step of the apply did not land). `failed` is the only
  // `destructive` member because it is the only total failure.
  mismatch: { variant: "warning", glyph: "swap_horiz" },
  partial: { variant: "warning", glyph: "warning" },
  failed: { variant: "destructive", glyph: "cancel" },
};

// =============================================================================
// The "in force now" hero
// =============================================================================
// The page's anchor card, and the ONE place `rounded-hero` is earned on this
// surface: it answers the question the user arrived with (what is running on my
// modem right now) before the list of things they could run instead.
//
// This is the exception the Consistent-Layout Rule allows, not a breach of it —
// "a genuine glance surface may earn a hero card". The Today strip directly
// below it is a PEER card (`PROFILE_CARD_PEER`, 36px) for exactly this reason,
// even though it reads as a second banner: a surface gets one anchor, and the
// hero has it.

/** The hero shell. `rounded-hero` (40px) — one per surface. */
export const HERO_CARD =
  "@container/hero flex flex-col gap-5 rounded-hero border-0 bg-surface p-6 shadow-[var(--shadow-whisper)]";

/** The hero's identity line: disc, name column, trailing chip + actions. */
export const HERO_TOP = "flex flex-wrap items-start gap-[1.125rem]";

/**
 * The hero's leading glyph disc — geometry only. 52px, matching the tile disc
 * one step below it so the hero and its own tiles read as one family.
 */
export const HERO_DISC =
  "grid size-[3.25rem] flex-none place-items-center rounded-pill";

/**
 * Its fill, by what the hero is currently reporting. FILL layer, per the
 * Glyph-Disc Rule — the hero shell is plain `surface`, so the disc takes the
 * strong fill and its own `-foreground` ink directly.
 *
 * `applying` is BRAND, not a fourth hue: the Info-Is-Brand Rule. `partial` and
 * `mismatch` are both genuinely degraded-but-running, so both are `warning` and
 * the glyph is what separates them (see `HERO_NOTICE_TONE`).
 *
 * `error` is the slot's THIRD state — the list names an active profile and its
 * detail GET came back empty. It is `warning`, not `destructive`, and the
 * reasoning is on `ActiveProfileUnavailable`: nothing on the modem failed, our
 * READ of it did, and `destructive` has to keep meaning "confirmed failure".
 * The member exists at all because that card used to hand-write
 * `bg-warning text-warning-foreground` inline, which is a tone keyed onto a
 * class string — the one construction this file exists to make impossible. With
 * it here, a future state without a matching fill fails the build instead of
 * shipping untinted. NOTE that `error` and `empty` therefore differ ONLY in
 * fill; the glyph is what separates them for a deuteranopic user, which is why
 * `cloud_off` and `sim_card_alert` must never converge.
 */
export const HERO_DISC_TONE: Record<
  "live" | "applying" | "partial" | "mismatch" | "empty" | "error",
  string
> = {
  live: "bg-primary text-primary-foreground",
  applying: "bg-primary text-primary-foreground",
  partial: "bg-warning text-warning-foreground",
  mismatch: "bg-warning text-warning-foreground",
  empty: "bg-surface-container-high text-on-surface-variant",
  error: "bg-warning text-warning-foreground",
};

/**
 * THE HERO SLOT'S NON-LOADED STATES — one scale for all three.
 *
 * The slot renders three components (`ActiveProfileHero`, `NoActiveProfile`,
 * `ActiveProfileUnavailable`) and until now they agreed on nothing: 52 / 56 /
 * 56px discs, 26 / 29 / 29px glyphs, and three different title steps
 * (`text-[1.375rem]`/-0.02em, `text-xl`/-0.01em, `text-lg`/none). The empty
 * state even carried a comment claiming its disc was "imported rather than
 * restated" — only the FILL was imported, the geometry was hand-written 4px
 * larger, so the comment described an intention rather than the code.
 *
 * They are three states of ONE box that cross-fade into each other in place, so
 * every number they disagree on is a visible jump at the swap. `HERO_DISC` and
 * `HERO_DISC_TONE` already carry the disc; this carries the rest.
 *
 * THE TITLE STEP IS THE LOADED HERO'S, and the two exceptional states move up
 * to meet it rather than the reverse. Two reasons. The loaded state is what the
 * user sees essentially always, so it is the one whose scale is already
 * calibrated against the 40px `rounded-hero` shell hosting it — shrinking it to
 * match a state that appears once would detune the common case to tidy the rare
 * one. And the exceptional states are not LESS important than the loaded one: a
 * profile that is in force but unreadable is the most urgent thing this page can
 * say, and it was rendering at `text-lg` with tracking left unset, two steps
 * below the state it interrupts. `-0.02em` is not decoration either — it is the
 * Display tracking every heading at this optical size on `/cellular/` carries.
 */
export const HERO_STATE = {
  /**
   * The state screen's shell, composed ONTO `HERO_CARD` — it adds only the
   * centring and the vertical air, never a second radius or fill. One padding
   * for both states, so the slot's height barely moves across a swap; the error
   * card used to sit 12px shorter than the empty one and the page nudged.
   */
  SHELL: "items-center gap-3.5 py-12 text-center",
  /**
   * The glyph inside `HERO_DISC`. Matches the loaded hero's, which is the whole
   * point of exporting it — a 52px disc with a 29px glyph inside it has a
   * different optical weight from the same disc with a 26px glyph, so importing
   * the disc while restating the glyph would leave the drift half-fixed.
   */
  GLYPH_SIZE: 26,
  /** The heading. See the step rationale above; `HERO_NAME` derives from it. */
  TITLE: "text-[1.375rem] font-semibold tracking-[-0.02em]",
  /** The sentence under it. */
  BODY: "text-on-surface-variant max-w-[34rem] text-sm leading-relaxed text-pretty",
  /**
   * The backend's own error string, in machine voice. Same measure as `BODY` —
   * two differently-capped columns stacked under one centred heading read as a
   * layout mistake rather than a hierarchy.
   */
  DETAIL: "max-w-[34rem] text-xs break-words text-on-surface-variant",
} as const;

/**
 * The Saved Profiles card's wrapper, and the target of the hero-empty state's
 * "Activate a profile" jump.
 *
 * `h-full` is LOAD-BEARING, not padding on a decorative box. The card itself is
 * `<Card className="@container/card h-full">` and was the direct grid item, so
 * its `h-full` resolved against the grid AREA and stretched it to the taller of
 * the two columns. Interposing a wrapper makes the WRAPPER the grid item, and
 * `h-full` on a `height: auto` parent resolves to `auto` — so without this the
 * card silently stops stretching and the two columns go ragged. Same shape as
 * `band-locking.tsx:263`, which wraps its own scroll target the same way.
 *
 * `scroll-mt-20` clears the sticky shell header, so a `block: "start"` scroll
 * lands on the card's title rather than under the chrome.
 *
 * The ring is `focus-visible` ONLY. The wrapper takes `tabIndex={-1}` and is
 * focused programmatically so a keyboard user's next Tab continues from the
 * card they were sent to; a plain `:focus` ring would then also fire on the
 * mouse path, drawing a 3px halo around a whole card because someone clicked a
 * button. `rounded-card` is here purely so the ring traces the card's own
 * corners — the wrapper paints nothing.
 */
export const SAVED_PROFILES_ANCHOR =
  "h-full scroll-mt-20 rounded-card outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]";

/**
 * The eyebrow above the active profile's name.
 *
 * The generic craft floor treats an eyebrow as a reflex to delete. It is kept
 * here because this surface's own canon ships one — DESIGN.md's tile anatomy is
 * literally `eyebrow -> value -> caption` — and the label is doing real work:
 * "Home Fixed Wireless" alone does not say whether you are looking at the active
 * profile or a saved one.
 */
export const HERO_EYEBROW = EYEBROW;

/**
 * The active profile's name — the loaded state's heading.
 *
 * DERIVED from `HERO_STATE.TITLE`, which is what makes "the three states of one
 * slot share one title step" a property of the module rather than a promise in
 * a comment. Concatenating two COMPLETE class strings is safe under Tailwind's
 * JIT (it scans source text, and `text-[1.375rem]` appears verbatim in
 * `HERO_STATE`); what is not safe is interpolating a VALUE into a bracket, and
 * nothing here does that. `SCENARIO_TILE_ACTIVE` already composes this way.
 */
export const HERO_NAME = `truncate ${HERO_STATE.TITLE}`;

/**
 * The three tiles under the hero's identity line.
 *
 * DISC and the 104px measure come from `components/cellular/tile-shape.ts` —
 * the same block the Radio, Antenna and SMS strips render — so the hero's tiles
 * and every other `/cellular/` tile share one geometry. GRID is local because it
 * resolves against `@container/hero` rather than `@container/main`.
 *
 * THE ONE DELIBERATE DIVERGENCE: 104px is a FLOOR here, where `TILE_SHAPE.ROOT`
 * makes it a PIN. Every tile on this strip carries a wrapping tag row under its
 * value — the APN's PDP type, CID and IMEI-override tags; the scenario's band
 * count; the radio's band tags — where the Radio/Antenna/SMS strips carry a
 * single bounded reading. A pin on genuinely unbounded content is a lie that
 * resolves as a clip, so this strip floors and top-aligns instead.
 *
 * It floors on ALL THREE, never a mix. A `h-` tile in a CSS grid opts out of
 * `align-self: stretch`, so one floored sibling beside two pinned ones grows
 * alone and leaves the row ragged; three floored siblings all stretch to the
 * tallest and the row stays square. The skeleton renders this same ROOT.
 */
export const HERO_TILE_SHAPE = {
  GRID: "grid grid-cols-1 gap-3.5 @2xl/hero:grid-cols-3",
  /**
   * 104px FLOOR, top-aligned — see the divergence note above. The measure is
   * restated rather than interpolated from `TILE_SHAPE.HEIGHT`: Tailwind's JIT
   * scans source text for class names, so a template-assembled arbitrary value
   * never reaches the stylesheet and the tile ships with no minimum at all.
   */
  ROOT: "flex min-h-[6.5rem] items-start gap-3.5 rounded-tile px-5 py-4",
  DISC: TILE_SHAPE.DISC,
  /** The tile's text column. */
  COL: "flex min-w-0 flex-1 flex-col gap-1",
  VALUE: "truncate text-[0.9375rem] font-semibold tracking-[-0.01em]",
  /** The wrapping tag row every tile ends with. */
  TAGS: "flex min-w-0 flex-wrap items-center gap-1.5",
} as const;

/**
 * THE TILE BODY IS NEUTRAL. THE DISC CARRIES THE COLOUR.
 *
 * There is deliberately no `HERO_TILE_SCENARIO` beside this. The previous
 * generation exported one — `bg-primary-container text-on-primary-container` —
 * and it painted 104px of brand container to say "this profile owns a
 * scenario", which is the Container layer used at four times its sanctioned
 * size. The scenario tile now looks exactly like the other two and marks itself
 * with a `bg-primary` disc, which is both the smaller claim and the more legible
 * one. Not exporting a tinted body is what stops a future caller tinting one
 * back.
 */
export const HERO_TILE_BODY = "bg-surface-container text-on-surface";

/** The scenario tile's disc, when a scenario is bound. FILL layer. */
export const HERO_TILE_DISC_BRAND = "bg-primary text-primary-foreground";

/** Every other tile disc: reporting, not owning. */
export const HERO_TILE_DISC_NEUTRAL =
  "bg-surface-container-high text-on-surface-variant";

/**
 * An inline notice inside the hero (mismatch / applying / partial).
 *
 * `rounded-field` (20px), so it never out-rounds the 40px hero hosting it —
 * the Radius-Follows-Size Rule. Tone comes from the CONTAINER PAIR, which is
 * sanctioned here and only here on this surface: a banner is one of the three
 * things the container layer is for.
 */
export const HERO_NOTICE = "flex items-start gap-3 rounded-field px-4 py-3.5";

/** The notice's own glyph disc: 32px, on the role's STRONG fill. */
export const HERO_NOTICE_DISC =
  "grid size-8 flex-none place-items-center rounded-pill";

export const HERO_NOTICE_TITLE = "text-[0.8125rem] font-semibold";
export const HERO_NOTICE_BODY =
  "mt-0.5 text-[0.8125rem] leading-[1.45] text-pretty";

/**
 * Fill + disc + glyph for each hero notice, keyed on the condition rather than
 * on a class string — the same construction as `ledgerStepTone` and
 * `PROFILE_STATUS_BADGE`, and for the same reason: a fourth notice cannot
 * quietly invent a fifth container pair, and a pair can never end up crossed.
 *
 * `applying` routes to the BRAND container, not to a fourth functional hue —
 * the Info-Is-Brand Rule.
 *
 * Every state carries a DISTINCT glyph. `mismatch` and `partial` share a
 * container — both are `warning`, correctly, since each is a degraded-but-
 * running state — which makes the glyph the only channel separating them. That
 * is exactly the case the Every-Chip-Has-A-Glyph Rule is written for.
 */
export const HERO_NOTICE_TONE: Record<
  "mismatch" | "applying" | "partial",
  { fill: string; disc: string; glyph: MaterialSymbolName; spin: boolean }
> = {
  mismatch: {
    fill: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    glyph: "swap_horiz",
    spin: false,
  },
  applying: {
    fill: "bg-primary-container text-on-primary-container",
    disc: "bg-primary text-primary-foreground",
    glyph: "progress_activity",
    spin: true,
  },
  partial: {
    fill: "bg-warning-container text-on-warning-container",
    disc: "bg-warning text-warning-foreground",
    glyph: "warning",
    spin: false,
  },
};

// =============================================================================
// The Today strip — the 24-hour schedule, promoted out of the hero
// =============================================================================
// The ribbon used to be a band inside the hero, competing with three tiles and
// two buttons for the same ~400px. At that width a 20-minute block is about
// eight pixels: a proportional graphic with no room to be proportional. Given
// the full page width it answers a question the old layout did not answer at
// all — WHAT IS THE SHAPE OF TODAY — and DESIGN.md already sanctions the
// full-width proportional strip as a signature surface.
//
// It is a PEER card, not a second hero. See the note on `HERO_CARD`.

/** The strip's head: summary sentence left, armed readout right. */
export const TODAY_HEAD = "flex flex-wrap items-center gap-3";

/** "Balanced in force until 18:00, then Speed." */
export const TODAY_SUMMARY = "flex flex-wrap items-center gap-2";
export const TODAY_SUMMARY_NAME =
  "text-[1.0625rem] font-semibold tracking-[-0.01em]";
export const TODAY_SUMMARY_JOIN = "text-[0.8125rem] text-on-surface-variant";
export const TODAY_SUMMARY_TIME = "text-[0.9375rem] font-semibold";

/**
 * The "Schedule armed" readout. INK layer on neutral ground — this is a small
 * true statement about the schedule, not a status chip about the profile, and
 * giving it a second filled chip beside the hero's would put two competing
 * claims on one screen.
 */
export const TODAY_ARMED = "flex items-center gap-2 text-xs font-semibold";
export const TODAY_ARMED_ON = "text-success-on-surface";
export const TODAY_ARMED_OFF = "text-on-surface-variant";

/**
 * A profile's scenario schedule drawn as a 24-hour strip: one proportional
 * segment per block, plus a marker at the current time.
 *
 * ONE TRACK, GAPPED SEGMENTS. The track is a single `surface-container` pill
 * with `overflow-hidden`; the segments sit inside it separated by a 3px gap
 * through which the track shows. That gap is what separates two adjacent idle
 * blocks, so the segments themselves need no second tonal step and no hairline —
 * an earlier mock separated them with an 18%-alpha inset ring, which is exactly
 * the wash this file bans.
 *
 * Segments animate `scaleX` from a left origin, never `width` — the
 * Transform-Only Rule. On a CPU that is also carrying the user's traffic, a
 * per-segment layout pass is not free.
 */
export const RIBBON_SHAPE = {
  /** The track. Segments are clipped by it, so they carry no radius of their own. */
  TRACK:
    "relative flex h-13 gap-[0.1875rem] overflow-hidden rounded-pill bg-surface-container",
  SEGMENT:
    "flex min-w-0 origin-left items-center gap-[0.4375rem] overflow-hidden px-3.5",
  /** Collapsed segment — too narrow for a label, glyph only. */
  SEGMENT_TIGHT: "grid min-w-0 origin-left place-items-center overflow-hidden",
  SEGMENT_LABEL: "truncate text-[0.78125rem] font-semibold",
  /** The "now" needle, drawn over the strip and bleeding past both edges. */
  NEEDLE:
    "absolute -top-1.5 -bottom-1.5 z-10 w-0.5 rounded-pill bg-on-surface pointer-events-none",
  /** The dot capping the needle. */
  NEEDLE_CAP:
    "absolute -top-1 left-1/2 size-[0.5625rem] -translate-x-1/2 rounded-pill bg-on-surface",
  /** The 00 / 03 / 06 … axis under the strip. */
  AXIS: "mt-2.5 flex justify-between px-0.5 text-[0.6875rem] font-medium text-on-surface-variant",
} as const;

/** The resting ribbon segment. */
export const RIBBON_SEGMENT_IDLE =
  "bg-surface-container-high text-on-surface-variant";

/**
 * The segment in force at the marker. FILL layer — a bar fill is exactly what
 * the fill layer is for, and at 52px tall against a neutral track the container
 * pair the previous generation used was too quiet to find at a glance.
 *
 * `--primary` is the only hue this segment may take. A scenario is not identity,
 * not direction, not state and not measured quality, so under the
 * Neutral-Default Rule it has no honest hue of its own — the segments separate
 * by their GLYPH, which is the decision `scenario-icons.ts` already made when it
 * replaced a 12-entry gradient palette. Primary here does not describe the
 * scenario; it marks which block is running.
 */
export const RIBBON_SEGMENT_LIVE = "bg-primary text-primary-foreground";

/**
 * The 8px condensed ribbon a profile ROW carries. Same proportions, same source
 * data, no labels — it is a glyph for "this profile has a schedule and here is
 * its shape", not a readable timeline. Both draw from `lib/schedule-timeline.ts`
 * so the row and the strip can never disagree about where a block starts.
 *
 * Hidden below `@lg/card`: at narrow widths the row's tags already wrap, and an
 * 88px graphic with no axis is the first thing that stops paying for its space.
 */
export const RIBBON_MINI = {
  ROOT: "hidden h-2 w-22 flex-none gap-[0.125rem] overflow-hidden rounded-pill bg-surface-container-high @lg/card:flex",
  SEGMENT: "min-w-0",
  IDLE: "bg-surface-container-high",
  LIVE: "bg-primary",
} as const;

// -----------------------------------------------------------------------------
// Scenario tiles
// -----------------------------------------------------------------------------

/**
 * A scenario tile and the "create scenario" tile beside it. Both import ROOT so
 * the two can never again disagree on their radius — an earlier generation
 * shipped `rounded-card` next to `rounded-xl` in the same grid, and the skeleton
 * shadowing them used a third value.
 *
 * `rounded-tile` (28px), corrected from `rounded-card` (36px): this is an inner
 * block inside a card, and a child may not carry its parent's radius.
 *
 * `min-h-[6.5rem]` is a FLOOR and the skeleton mirrors by rendering ROOT, not by
 * restating a height — the previous generation floored at `min-h-[9rem]` while
 * its skeleton pinned `h-36`, so every tile whose band line wrapped jumped at
 * the handoff.
 */
export const SCENARIO_TILE_SHAPE = {
  GRID: "grid grid-cols-1 gap-3.5 @xl/card:grid-cols-2",
  ROOT: "flex min-h-[6.5rem] items-start gap-3.5 rounded-tile px-5 py-4",
  /** 44px — between the row's 40 and the hero tile's 52. */
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  COL: "flex min-w-0 flex-1 flex-col gap-1.5",
  NAME: "truncate text-[0.9375rem] font-semibold tracking-[-0.01em]",
  META: "flex flex-wrap items-center gap-1.5",
} as const;

/** The resting scenario tile. Neutral body — the disc carries the colour. */
export const SCENARIO_TILE_IDLE = "bg-surface-container text-on-surface";

/**
 * The in-force scenario tile. SAME neutral body, plus the same 2px inset primary
 * ring the active profile row takes — the two "this is the one" marks on this
 * page are now literally the same constant.
 *
 * It used to be `bg-primary-container text-on-primary-container` across a 144px
 * tile, and nothing consumed it: `scenario-item.tsx` hand-wrote the classes and
 * kept a private ring constant beside them. Both are gone.
 */
export const SCENARIO_TILE_ACTIVE = `bg-surface-container text-on-surface ${PROFILE_ROW_ACTIVE_RING}`;

/** The tile's glyph disc, in force vs at rest. */
export const SCENARIO_DISC_ACTIVE = "bg-primary text-primary-foreground";
export const SCENARIO_DISC_IDLE =
  "bg-surface-container-high text-on-surface-variant";

/**
 * The "create scenario" ghost tile. Dashed stroke is semantic here (an empty
 * slot), so it keeps its border — but its hover no longer flips 144px to
 * `primary-container`; it steps one tonal stop, which is what every other
 * hoverable neutral box on this surface does.
 */
export const SCENARIO_TILE_ADD =
  "border-outline hover:border-primary hover:bg-surface-container-high text-on-surface-variant border border-dashed bg-transparent transition-colors duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

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
// UNTOUCHED BY THE RE-AUTHORING, ON PURPOSE. The apply and deactivate dialogs
// were already migrated correctly — distinct glyph per state, honest container
// pairs, a documented width chain — and rewriting a correct subsystem is churn,
// not a win. The `--tone-{role}-1` fills below are the ramp used in its own
// idiom (a stacked ledger of condition bands, exactly as the cell scanner uses
// it), which is a different construction from painting a list row's fill.

/**
 * The apply dialog's step ledger. Mirrors the shipped `DeleteProgress` pattern
 * in `components/cellular/sms/delete-dialogs.tsx`: an `<ul aria-live="polite">`
 * of tonal steps, one per genuinely-observable backend stage.
 *
 * DO NOT fabricate steps. The SMS precedent split a real backend call in two
 * rather than animate a two-step UI over one opaque request; a ledger that
 * invents stages is theatre, and the State-Honesty Rule forbids it.
 */
/**
 * THE MIN-CONTENT CHAIN (read before touching any width class below).
 *
 * An earlier version of this comment claimed the `min-w-0` on `STEP` was what
 * stopped a long `detail` string blowing the dialog open. It is not, and that
 * claim cost a live investigation — the dialog shipped overflowing. Three
 * things are true and each one is counter-intuitive:
 *
 *   1. `truncate` does NOT bound an element's intrinsic width, it MAXIMIZES it.
 *      It expands to `overflow:hidden; text-overflow:ellipsis; white-space:
 *      nowrap`, and `white-space:nowrap` makes the element's min-content width
 *      equal to the FULL string. Truncation is a paint-time clip; it happens
 *      only once some ancestor has already imposed a width.
 *   2. `min-w-0` removes an item's AUTOMATIC MINIMUM SIZE. It does not reduce
 *      that item's own min-content contribution to its parent. So `min-w-0` on
 *      a leaf is not a fix — it has to exist on the box whose width is being
 *      resolved.
 *   3. A PERCENTAGE `max-width` resolves to `none` during intrinsic sizing, so
 *      `max-w-[52%]` contributes nothing to a min-content pass and cannot cap a
 *      blowout on its own. It is load-bearing only once the row's width is
 *      already definite.
 *
 * The dialog's `DialogContent` is `display:grid` with one implicit `auto`
 * track, so an `auto` track's minimum is its item's minimum contribution — and
 * the ledger's own outer block is that grid item. `ROOT` therefore carries the
 * `min-w-0` that makes the minimum contribution zero, which pins the track to
 * the dialog's `sm:max-w-md` instead of to the longest `+CME ERROR:` payload
 * the modem happens to return. Everything below `ROOT` then has a DEFINITE
 * width to resolve against, which is what finally makes (1) and (3) work: the
 * detail's `max-w-[52%]` becomes a real cap, and `truncate` has an edge to clip
 * at. Delete the `min-w-0` on `ROOT` and every guard downstream goes inert.
 */
export const LEDGER_SHAPE = {
  /**
   * The ledger's outer block, and the DIRECT GRID ITEM of `DialogContent`. Its
   * `min-w-0` is the single load-bearing width guard on this surface — see THE
   * MIN-CONTENT CHAIN above.
   */
  ROOT: "flex min-w-0 flex-col gap-[7px]",
  LIST: "flex min-w-0 flex-col gap-2",
  STEP: "flex min-w-0 items-center gap-3 rounded-field px-4 py-3 text-sm",
  GLYPH: "size-[1.125rem] flex-none",
  /**
   * The step's human label. `flex-1` (basis 0) so it absorbs the whole row when
   * the step reports no detail, rather than leaving a dead gap.
   */
  LABEL: "min-w-0 flex-1 truncate text-[13px] font-semibold",
  /**
   * The detail slot. `shrink` — NOT `flex-none`: a non-shrinkable sibling is
   * guaranteed to push the row past its box, which is precisely the bug this
   * file used to describe incorrectly. `max-w-[52%]` is the label's floor: with
   * the label on basis 0 the flex algorithm would otherwise hand the detail
   * every pixel it asked for and collapse the label to nothing, so a 200-char
   * payload would ellipsize the step's NAME away. The cap is honest here
   * because `ROOT` has already made this row's width definite.
   */
  VALUE: "min-w-0 max-w-[52%] shrink truncate text-right",
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

/**
 * The apply dialog's own panel.
 *
 * No fill here on purpose: `DialogContent`/`AlertDialogContent` now default to
 * `bg-surface` (see `components/ui/dialog.tsx`, `components/ui/alert-dialog.tsx`),
 * so do NOT re-add a call-site `bg-*` — the primitive owns it. The old default
 * was `bg-background`, which never made the panel *invisible* (a `bg-black/50`
 * scrim composites between panel and page, so it always read as a lighter
 * rectangle); the actual defect was elevation INVERSION — in dark mode the
 * dialog painted at `--background` 0.155 while every card under it sits at
 * `--surface` 0.215, putting the most elevated element below the cards on the
 * tonal ramp. DESIGN.md:348-349 assigns dialogs to Surface, same step as cards.
 *
 * `overflow-hidden` stays as a belt-and-braces clip behind the width guards in
 * THE MIN-CONTENT CHAIN, not as the primary fix.
 */
export const APPLY_DIALOG_PANEL = "overflow-hidden rounded-card sm:max-w-md";

/**
 * The right-aligned value a ledger step carries — the APN that landed, the AT
 * error a step returned, "Unchanged" for a skipped one. This is the backend's
 * own `ApplyStep.detail` string verbatim, so it is machine voice and takes the
 * mono face. It is NOT decoration: a step that says "done" without saying what
 * it did is exactly the opaque progress the State-Honesty Rule exists to stop.
 *
 * Ink is inherited from the step's container pair rather than restated, so the
 * value can never end up carrying one role's ink on another role's fill. The
 * `opacity-85` an earlier draft carried is gone — a wash is not an ink token,
 * and the container pair is already the quieter half of its role.
 */
export const LEDGER_VALUE = "font-mono text-[0.6875rem] tabular-nums";

/** The determinate apply bar. `scaleX` from a left origin — never `width`. */
export const LEDGER_BAR = {
  TRACK:
    "relative h-1.5 w-full overflow-hidden rounded-pill bg-surface-container",
  FILL: "h-full origin-left rounded-pill",
} as const;
