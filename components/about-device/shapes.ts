// =============================================================================
// About Device — the /about-device family's geometry and tone contract
// =============================================================================
// Every geometry string, control height, tone map and skeleton line box for
// this surface lives here, and the loaded views and their skeletons read the
// same values (The Skeleton-Mirror Rule).
//
// The numbers are the system's, restated rather than imported: `/about-device`
// is its own route family, and reaching into `components/cellular/` or
// `components/local-network/` for a class string couples two families that ship
// independently. What is shared is the SYSTEM's scale, not a module:
//
//   104px pinned tile   40px metric row   52px disc   42px control   36px card
// =============================================================================

// -----------------------------------------------------------------------------
// The page's one state
// -----------------------------------------------------------------------------

/**
 * The three facts this surface can be in. `unreachable` covers both a failed
 * request and a request that returned nothing — either way nothing was read,
 * and the page says so once instead of once per card.
 */
export type AboutView = "loading" | "loaded" | "unreachable";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Every container query on this page keys off `main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The page header. The title carries the Display step's tracking, and the
 * spacing lives on the flex gap so the header composes rather than pushing.
 */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @2xl/main:flex-row @2xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @2xl/main:ml-auto",
} as const;

/** The 42px action pill — Refresh, and every pill in the QManager band. */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/** The lucide glyph inside an action pill. */
export const PILL_GLYPH = "size-4";

/** The one spin class, so a refreshing pill has a single spelling to reach. */
export const SPIN = "animate-spin";

/**
 * The peer-card grid. `items-stretch` plus the two height locks are what let
 * one card absorb its row-mate's slack — and they are why `CARD_BODY` and
 * `GROUP_FILL` exist: a stretched cell holding a content-height body is a
 * symmetric void.
 */
export const CARD_GRID =
  "grid grid-cols-1 items-stretch gap-5 *:h-full *:*:data-[slot=card]:h-full @3xl/main:grid-cols-2";

/** One grid cell — the motion wrapper the height lock reaches through. */
export const CARD_CELL = "flex min-w-0 flex-col";

// -----------------------------------------------------------------------------
// Band A — the identity tiles
// -----------------------------------------------------------------------------

/**
 * The band header: label left, the unresponsive chip pushed right by `mr-auto`.
 * `min-h` matches the chip's own 22px box so the band cannot breathe when the
 * chip appears.
 */
export const BAND = {
  ROOT: "flex flex-col gap-1.5",
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  /** The glyph inside the header chip, sized to its 12px text. */
  GLYPH: "size-3",
} as const;

/**
 * The tile box.
 *
 * `ROOT` is PINNED at 104px, never floored: a floor cannot be a mirror, so the
 * skeleton-to-content handoff would jump by whatever the content needed.
 * Nothing clips at the pin — eyebrow, value and caption all truncate.
 */
export const TILE = {
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-2 @5xl/main:grid-cols-4",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-[6.5rem]",
  /** The ONLY tile body. There is no `tone` prop anywhere to override it. */
  BODY: "bg-surface-container text-on-surface",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The lucide glyph inside DISC — 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
  /** The text column inside ROOT. */
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
} as const;

/**
 * Disc fills, and the ONLY colour in the band — every body is `TILE.BODY`.
 *
 * Each is a FILL pair, never a container pair: the disc is the one element
 * small enough to want a strong fill, and pale containers collapse under
 * deuteranopia where fills do not.
 */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The tone transition for the ONE disc that changes at runtime — the internet
 * tile's. Scoped to two named properties, and every custom property takes
 * `var()`: Tailwind v4 dropped the bare-var arbitrary shorthand, and that
 * spelling compiles to a declaration the browser discards while tsc, eslint and
 * the build all stay green.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/**
 * The eyebrow above a tile's figure. ONE spelling, and the caps live HERE
 * rather than in the copy — an uppercased JSON leaf ships English casing to
 * five locales, where `text-transform` is locale-aware and a no-op in zh-CN.
 */
export const EYEBROW =
  "text-on-surface-variant truncate text-[0.6875rem] font-semibold uppercase tracking-[0.02em]";

/**
 * The tile figure. `tabular-nums` in the UI face — a model name, a hostname and
 * a reachability verdict are prose, not machine strings.
 */
export const VALUE =
  "truncate text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums";

/**
 * The tile figure when it IS a machine string — a firmware build id the device
 * emits verbatim. Steps down to 17px because JetBrains Mono runs wider than the
 * UI face at the same size and would truncate a full firmware string.
 */
export const VALUE_MONO =
  "truncate font-mono text-[1.0625rem] font-semibold leading-[1.1] tracking-[-0.01em]";

/** The caption under a tile figure. ONE spelling. */
export const CAPTION = "text-on-surface-variant truncate text-xs";

/**
 * The placeholder for a value the device does not report. An em dash reads as
 * an absence in all five locales and needs no translator; a hyphen reads as a
 * value that happens to be short.
 */
export const VALUE_NONE = "—";

/**
 * The band's failure notice. It occupies the band's own slot — `min-h` matches
 * the tile pin — so a failed read does not collapse the page by 104px.
 *
 * Four identical "couldn't read" tiles would be one message said four times,
 * and an `Alert` would be a second vocabulary for the same event.
 */
export const NOTICE = {
  ROOT: "flex min-h-[6.5rem] flex-col items-start gap-3.5 rounded-tile bg-surface-container px-5 py-[1.125rem] @xl/main:flex-row @xl/main:items-center",
  TEXT: "flex min-w-0 flex-1 flex-col gap-0.5",
  TITLE: "text-base font-semibold",
  /** The endpoint that answered, quoted in the machine voice. */
  SUB: "text-on-surface-variant text-[0.8125rem] leading-relaxed text-pretty",
  DETAIL: "font-mono",
} as const;

// -----------------------------------------------------------------------------
// The two peer cards
// -----------------------------------------------------------------------------

/**
 * The card shell. A PEER, so `rounded-card` and the whisper shadow, which is
 * the only card lift in the vocabulary. `border-0` is explicit — a tonal
 * surface never also carries a hairline.
 *
 * THE WHISPER IS IMPORTANT-MARKED, AND IT HAS TO BE. `card.tsx` ships
 * `shadow-sm`, and `cn()` cannot dedupe it against this one: tailwind-merge
 * reads an arbitrary shadow value as a shadow COLOUR, so both survive the merge
 * and the winner is Tailwind's name sort, which the primitive wins. The marker
 * must live INSIDE this literal — appended at a call site the string never
 * appears in source and Tailwind never generates the rule.
 */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, matching every sibling surface. */
export const CARD_PAD = "px-7";

/** The card's slack absorber, paired with `GROUP_FILL` on the body inside. */
export const CARD_BODY = "flex min-h-0 flex-1 flex-col";

/**
 * The card's title. `CardTitle` takes its size from the call site, so an
 * unsized one inherits 16px and flattens the surface's type ramp. It WRAPS
 * rather than truncating, which is why `leading-none` has to go with it.
 */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/**
 * The card's description ink, passed EXPLICITLY at every call site.
 * `CardDescription` hardcodes the retired `text-muted-foreground` inside the
 * primitive, so a surface that omits this looks clean in a grep and still
 * renders the retired ink.
 */
export const CARD_DESC = "text-on-surface-variant text-sm leading-relaxed";

/** The stack of labelled groups. `flex-1` is the ONE region that absorbs slack. */
export const GROUPS = "flex min-h-0 flex-1 flex-col gap-4";

/** One labelled cluster of metric rows. */
export const GROUP = "flex flex-col gap-1.5";

/** A group's caps label — Local, WWAN, Public, 3GPP release. */
export const GROUP_LABEL =
  "text-on-surface-variant px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.09em]";

/** The rows themselves. The fill is on each ROW, so this stays transparent. */
export const ROW_LIST = "flex flex-col gap-1.5";

/**
 * One metric row: a 40px pill, key left, value right.
 *
 * A PIN rather than a floor, because the skeleton mirrors it — and nothing
 * inside can wrap, since both the key and the value are single-line.
 */
export const ROW = {
  ROOT: "flex h-10 items-center justify-between gap-3 rounded-pill bg-surface-container px-4",
  /** Mirrors ROOT's pinned height, for the skeleton. */
  HEIGHT: "h-10",
  KEY: "text-on-surface-variant text-[0.8125rem] font-semibold leading-5 whitespace-nowrap",
  VALUE:
    "min-w-0 truncate text-right text-[0.8125rem] font-semibold leading-5 tabular-nums",
  /**
   * The machine voice. Firmware, firmware revision, IMEI and every address are
   * identifiers the device emits verbatim, which is exactly what the
   * Machine-Voice Rule sends to mono — the retired card set `tabular-nums` here
   * and shipped none of them in the mono face.
   */
  VALUE_MONO: "font-mono font-medium",
  /** A value the device does not report: the em dash, in the quieter ink. */
  VALUE_NONE: "text-on-surface-variant",
} as const;

/** Where the public addresses came from, and what an em dash means. */
export const PROVENANCE = "text-on-surface-variant px-1 text-xs text-pretty";

/**
 * A card with nothing to show. Built to FILL — `flex-1` — because the page grid
 * locks the pair to one height, and a content-height empty state under a lock
 * is a symmetric void.
 */
export const EMPTY = {
  ROOT: "flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 rounded-tile bg-surface-container px-3 py-[1.625rem] text-center",
  DISC: "grid size-11 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  GLYPH: "size-5",
  TITLE: "text-[0.9375rem] font-semibold",
  BODY: "text-on-surface-variant max-w-[34ch] text-[0.8125rem] leading-relaxed text-pretty",
} as const;

// -----------------------------------------------------------------------------
// The About QManager band
// -----------------------------------------------------------------------------

/**
 * The full-width band. Same shell vocabulary as a peer card — including the
 * important-marked whisper, for the same reason — at the page's full width,
 * because it is a statement rather than a pair of readings.
 */
export const WIDE = {
  ROOT: "flex flex-col gap-[1.125rem] rounded-card border-0 bg-surface px-7 py-[1.625rem] shadow-[var(--shadow-whisper)]!",
  INNER:
    "flex flex-col gap-[1.125rem] @2xl/main:flex-row @2xl/main:items-start @2xl/main:gap-[1.625rem]",
  /** The 72px plate the product mark sits on. */
  MARK_DISC:
    "grid size-[4.5rem] flex-none place-items-center rounded-pill bg-surface-container",
  MARK: "size-10",
  TEXT: "flex min-w-0 flex-1 flex-col gap-2.5",
  TITLE_ROW: "flex flex-wrap items-center gap-[0.5625rem]",
  TITLE: "text-lg font-semibold",
  BODY: "text-on-surface-variant max-w-[70ch] text-sm leading-relaxed text-pretty",
  /** The copyright line: the same body, stepped back rather than re-coloured. */
  LEGAL: "text-on-surface-variant max-w-[70ch] text-sm leading-relaxed opacity-85",
  ACTIONS: "flex flex-wrap gap-2.5 pt-0.5",
  /** The trailing external-link glyph on an outbound pill. */
  EXT_GLYPH: "size-3.5",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/**
 * Every placeholder reads its geometry from the loaded view's own constant, so
 * a height can never drift out from under its skeleton.
 *
 * The row counts mirror the loaded cards exactly — eight rows in Modem (six
 * plus the two 3GPP rows), six in Addresses. A skeleton with the wrong row
 * count under-states its card by 46px per missing row.
 */
export const SKELETON = {
  /** The band: four boxes wearing the tile's own pin. */
  TILE: `${TILE.HEIGHT} rounded-tile`,
  /** One metric row, wearing the row's own pin. */
  ROW: `${ROW.HEIGHT} rounded-pill`,
  /** How many rows each card stands in for. */
  MODEM_ROWS: 8,
  ADDRESS_ROWS: 6,
} as const;
