// The /support family's only shapes module — the page and the Donate dialog both
// read from here. Geometry is restated per family, never imported across one.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Every container query on this page keys off `main`. */
export const PAGE_ROOT = "@container/main mx-auto flex flex-col gap-5 p-2";

/**
 * The page header. `/support` is static, so the header carries no action and no
 * refresh — a title and one sentence saying what the page is for.
 */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
} as const;

// -----------------------------------------------------------------------------
// The peer card row
// -----------------------------------------------------------------------------

/**
 * The Symmetric-Pair lock: the motion cell and the card inside it both take the
 * row height, and each card nominates one region to absorb the slack.
 */
export const CARD_GRID =
  "grid grid-cols-1 items-stretch gap-5 *:h-full *:*:data-[slot=card]:h-full @3xl/main:grid-cols-2";

/** One grid cell. Each card cascades on its own step, so it needs a wrapper. */
export const CARD_CELL = "flex min-w-0 flex-col";

/**
 * A peer card, not the anchor. The important marker is load-bearing: tailwind-merge
 * reads an arbitrary shadow as a COLOUR, so card.tsx's own default otherwise wins.
 */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, matching every sibling surface. */
export const CARD_PAD = "px-7";

/** The content box that fills a height-locked cell. */
export const CARD_BODY = "flex min-h-0 flex-1 flex-col";

/**
 * CardTitle takes its size from the call site; unsized it inherits 16px and
 * flattens the type ramp. It wraps, so leading-none has to go with it.
 */
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/**
 * card.tsx hardcodes the retired muted ink inside CardDescription, so the real
 * ink is written here and passed explicitly at every call site.
 */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** The keyboard focus ring for the bare anchors on this page. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// -----------------------------------------------------------------------------
// Get help — the action rows
// -----------------------------------------------------------------------------

/** The list of action rows. It is the left card's slack absorber. */
export const ACTION_LIST = "flex min-h-0 flex-1 flex-col gap-2";

/**
 * One 64px action row — a floor, not a pin, so a longer translation cannot clip.
 * The duration takes var(): Tailwind v4 drops the bare-var arbitrary shorthand.
 */
export const ACTION_ROW = {
  ROOT: "flex min-h-16 items-center gap-3.5 rounded-field bg-surface-container px-4 py-2.5 transition-[background-color] duration-[var(--duration-quick)] ease-quick hover:bg-surface-container-high",
  /** The 40px neutral disc. Colour and shape are allowed here, not in a header. */
  DISC:
    "grid size-10 shrink-0 place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  GLYPH: "size-5",
  TEXT: "flex min-w-0 flex-1 flex-col gap-px",
  LABEL: "text-sm font-semibold",
  /** The destination sub-line, as prose. */
  DEST: "text-on-surface-variant truncate text-xs",
  /** The destination sub-line when it is an address the machine emits verbatim. */
  DEST_MONO: "text-on-surface-variant truncate font-mono text-xs",
  EXT: "text-on-surface-variant size-4 shrink-0",
} as const;

// -----------------------------------------------------------------------------
// Community
// -----------------------------------------------------------------------------

export const COMMUNITY = {
  /** The right card's slack absorber, centring the QR in whatever height it gets. */
  BODY: "flex min-h-0 flex-1 flex-col items-center justify-center gap-4",
  COPY: "text-on-surface-variant max-w-[38ch] text-center text-sm leading-relaxed text-pretty",
  /**
   * Functional white, not a theme miss: the QR's black modules need a true-white
   * quiet zone in both themes, or the code is unscannable in dark mode.
   */
  PLATE: "w-max rounded-tile bg-white p-3",
  IMAGE: "block size-40",
} as const;

// -----------------------------------------------------------------------------
// The donate band and the shared links
// -----------------------------------------------------------------------------

/**
 * The full-width donate band. Anchor in width only, so it stays a peer radius.
 */
export const BAND = {
  ROOT: "flex flex-col gap-5 rounded-card border-0 bg-surface px-7 py-6 shadow-[var(--shadow-whisper)]!",
  INNER:
    "flex flex-col gap-5 @2xl/main:flex-row @2xl/main:items-start @2xl/main:gap-6",
  /** The 72px primary disc — the one saturated element on the page. */
  DISC:
    "grid size-[4.5rem] shrink-0 place-items-center rounded-pill bg-primary text-primary-foreground",
  DISC_GLYPH: "size-[1.875rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-2.5",
  TITLE: "text-lg font-semibold",
  BODY: "text-on-surface-variant max-w-[70ch] text-sm leading-relaxed text-pretty",
} as const;

/** The row the three donation pills sit in. Wraps rather than scrolling. */
export const DONATE_ACTIONS = "flex flex-wrap items-center gap-2.5";

/**
 * The 42px donation pill — the coarse-pointer floor, which sm would fall under.
 */
export const PILL_ACTION =
  "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold";

/** The glyph inside a donation pill. */
export const PILL_GLYPH = "size-4";

// The one sanctioned raw-hex exception: brand identity on a payment button is
// functional, and user-affirmed. Dark halves exist because the light fills
// measure ~1.3:1 on a dark card — invisible.

/** Wise. Dark ground takes Wise's own bright green with its dark ink. */
export const PILL_WISE =
  "bg-[#163300] text-white hover:bg-[#1F4A00] dark:bg-[#9FE870] dark:text-[#163300] dark:hover:bg-[#8FD75E]";

/** PayPal. Dark ground takes PayPal Blue rather than the navy wordmark fill. */
export const PILL_PAYPAL =
  "bg-[#003087] text-white hover:bg-[#00246B] dark:bg-[#0070BA] dark:text-white dark:hover:bg-[#005B96]";

/** GitHub Sponsors. One value clears both grounds, so there is no pair to make. */
export const PILL_SPONSOR =
  "bg-[#BF3989] text-white hover:bg-[#A32F75] dark:hover:bg-[#D14A99]";

// -----------------------------------------------------------------------------
// The Donate dialog
// -----------------------------------------------------------------------------

/**
 * Sized by constraint, not a breakpoint. The marker beats the primitive's own
 * responsive max-width, and the min() keeps the mobile inset it provides.
 */
export const DIALOG = {
  ROOT: "flex w-full max-w-[min(34rem,calc(100%-2rem))]! flex-col gap-[1.125rem] rounded-card p-[1.625rem]",
  /**
   * DialogHeader ships a column and centred text, so both are restated; the right
   * padding reserves the primitive's absolutely-placed close button.
   */
  HEAD: "flex flex-row items-start gap-3.5 pr-7 text-left",
  /** The 44px heart disc — the coarse-pointer floor, as a disc. */
  DISC:
    "grid size-11 shrink-0 place-items-center rounded-pill bg-primary text-primary-foreground",
  DISC_GLYPH: "size-[1.375rem]",
  TITLES: "flex min-w-0 flex-1 flex-col gap-1 text-left",
  /** `DialogTitle` ships `leading-none`, which clips a wrapped title. */
  TITLE: "text-lg leading-tight font-semibold",
  BODY: "flex flex-col gap-2.5",
  PARAGRAPH: "text-on-surface-variant text-sm leading-relaxed text-pretty",
} as const;
