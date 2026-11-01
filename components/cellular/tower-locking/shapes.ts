import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";

// =============================================================================
// Tower Locking shapes — geometry, tone maps and verdict logic
// =============================================================================
// One file so a strip, its skeleton and its loaded state cannot drift apart
// (Skeleton-Mirror Rule). Layout ported from RM551E v0.1.34.
//
// Page anatomy: header, "Right now", automation (failover, schedule, keep-after-reboot), then a 2-up of leg cards.
// Failover and keep-after-reboot act on the whole modem, not a leg (`save_ctrl,v,v` writes both radios).
// =============================================================================

// --- Surfaces ----------------------------------------------------------------

/** "Right now": the surface's one `rounded-hero` anchor. */
export const TOWER_HERO =
  "@container/section flex flex-col gap-5 rounded-hero border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/** "Lock automation": a peer of the leg cards, so `rounded-card`. */
export const TOWER_SECTION =
  "@container/section flex flex-col gap-5 rounded-card border-0 bg-surface p-7 shadow-[var(--shadow-whisper)]";

/** One leg card. Declares `@container/card` for its own recomposition. */
export const TOWER_CARD =
  "@container/card flex flex-col gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]";

export const CARD_PAD = "px-6";

/** The coordinator owns both section shells and headers; children render bodies. */
export const SECTION_HEAD = {
  ROOT: "flex flex-col gap-1",
  TITLE: "text-base leading-normal font-semibold",
  DESCRIPTION: "text-sm leading-relaxed text-pretty text-on-surface-variant",
} as const;

export const BADGE_GLYPH_SIZE = 12;

// --- Live strip: carriers ------------------------------------------

export const STRIP_PANEL =
  "@container/panel flex min-w-0 flex-col gap-2.5 rounded-tile bg-surface-container px-4 py-3.5";

export const CARRIER_GRID =
  "grid grid-cols-1 gap-3 @md/panel:grid-cols-2 @2xl/panel:grid-cols-3";

/**
 * One carrier on air. The body is neutral; identity is the `Tag`, quality is the
 * numeral plus its bar. PCI and RSRP are quantities: Rethink + tabular-nums.
 */
export const CARRIER_TILE = {
  ROOT: "flex min-w-0 flex-col gap-2 rounded-tile bg-surface px-3.5 py-3 transition-[box-shadow] duration-[var(--duration-standard)] ease-standard",
  HEAD: "flex items-center gap-2",
  BAND: "min-w-0 truncate text-xs font-semibold tabular-nums text-on-surface-variant",
  BODY: "flex items-center gap-2",
  PCI_LABEL: "flex-none text-xs text-on-surface-variant",
  PCI_VALUE: "text-xl leading-none font-semibold tabular-nums",
  METER: "ml-auto flex min-w-0 items-center gap-2",
  RSRP: "flex-none text-[13px]/5 font-semibold tabular-nums",
  /** 32px disc, 44px hit area via the overlay. */
  ACTION:
    "relative ml-auto grid size-8 flex-none place-items-center rounded-pill transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-1.5 before:content-[''] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] focus-visible:outline-none aria-disabled:cursor-not-allowed",
  /** An action that is available: neutral until hovered. */
  ACTION_IDLE:
    "bg-surface-container-high text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container aria-disabled:hover:bg-surface-container-high aria-disabled:hover:text-on-surface-variant",
  /** The tile's own lock: click removes it. */
  ACTION_ON:
    "bg-primary-container text-on-primary-container hover:bg-primary-container/80",
  /** The tile that is a current lock target. */
  MATCH: "shadow-[inset_0_0_0_2px_var(--primary)]",
} as const;

// --- Live strip: match verdict -------------------------------------------------

/** Is the radio on the cell the modem says it was told to hold? */
export type TowerMatchVerdict =
  | "on_target"
  | "off_target"
  | "unverified"
  | "unlocked"
  | "unknown";

/** The verdict row above the carriers: disc, then one sentence. */
export const VERDICT_ROW = {
  ROOT: "flex min-h-[3.25rem] items-center gap-3 rounded-tile px-4 py-3",
  DISC: "grid size-7 flex-none place-items-center rounded-pill",
  /** The state word is announced; the glyph and the body carry it visually. */
  TITLE: "sr-only",
  BODY: "min-w-0 flex-1 text-[13px]/5 text-pretty",
} as const;

/**
 * Verdict -> fill, disc, glyph. The three neutral verdicts share a fill; `unlocked` is neutral, not success, since
 * with no lock there was no ask.
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
  // Connected, just not where it was told to be: warning, never destructive.
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
 * A leg matches when SOME camped carrier of that radio has the modem's exact (channel, PCI) target (LTE needs one of
 * three). Unread leg = `unknown` (tested `=== false`); a lock with nothing on air is `off_target`.
 */
export function matchVerdict(
  modemState: {
    lte_locked: boolean;
    lte_cells: { earfcn: number; pci: number }[];
    nr_locked: boolean;
    nr_cell: { arfcn: number; pci: number } | null;
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
  // Locked, but nothing on air to compare against.
  if (onAir.length === 0) return "unverified";

  const camped = (technology: "LTE" | "NR", channel: number, pci: number) =>
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

/** Pill note for the radio that is NOT on air. A note, not a carrier tile. */
export const CAMPED_ABSENT =
  "flex min-h-11 items-center gap-2.5 rounded-pill bg-surface px-3.5 py-1.5 text-xs text-on-surface-variant";

// --- Leg cards: fields -------------------------------------------------------

/** One labelled control row (Simple Mode). */
export const CONTROL_ROW =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-field bg-surface-container px-4 py-3";

export const FIELD_CONTROL = "text-sm tabular-nums";

export const FIELD_LABEL =
  "flex items-center gap-1.5 text-xs font-medium text-on-surface-variant";

/** LTE slot rows: SHELL-free, fields step up to `surface-container-high`. */
export const SLOT_ROW = {
  ROOT: "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 rounded-field bg-surface-container px-4 py-2.5 transition-[box-shadow] duration-[var(--duration-standard)] ease-standard",
  /** Locked on the modem, but the modem is not using this cell. */
  UNUSED: "shadow-[inset_0_0_0_2px_var(--warning)]",
  /** The "Cell N" label; the dot slot is always reserved so labels line up. */
  INDEX_ROW: "flex min-w-[4.25rem] flex-none items-center gap-1.5",
  DOT_SLOT: "relative grid size-2 flex-none place-items-center",
  DOT: "size-2 rounded-pill bg-success",
  DOT_PING: "absolute inset-0 rounded-pill bg-success animate-live-ping",
  EMPTY:
    "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 rounded-field border border-dashed border-outline px-4 py-2.5",
  INDEX: "min-w-[3.25rem] flex-none text-xs font-semibold text-on-surface-variant",
  FIELDS: "flex min-w-0 flex-[1_1_13rem] items-center gap-2",
  CHANNEL: "flex min-w-0 flex-[2_1_6rem] flex-col",
  PCI: "flex min-w-0 flex-[1_1_4rem] flex-col",
  META: "ml-auto flex flex-none items-center gap-2",
  CLEAR:
    "relative -mr-1 grid size-6 flex-none place-items-center rounded-pill text-on-surface-variant transition-colors duration-[var(--duration-quick)] ease-out before:absolute before:-inset-2.5 before:content-[''] hover:bg-current/10 hover:text-on-surface focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55",
} as const;

/** NR value tiles (SHELL resolution: the tile carries fill and focus ring). */
export const FIELD_GRID = "grid grid-cols-1 gap-3 @md/card:grid-cols-2";

export const FIELD_TILE = {
  ROOT: [
    "flex min-h-14 min-w-0 flex-col justify-center gap-0.5 rounded-field bg-surface-container px-4 py-2",
    "transition-[box-shadow] duration-[var(--duration-quick)] ease-out",
    "focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background focus-within:ring-[3px]",
  ].join(" "),
  /** Locked on the modem, but the modem is not camped on this cell. */
  UNUSED: "shadow-[inset_0_0_0_2px_var(--warning)]",
  LABEL: `${FIELD_LABEL} w-full`,
  CONTROL: [
    "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-0 py-0 shadow-none",
    "text-sm font-semibold tabular-nums focus-visible:ring-0",
  ].join(" "),
  SELECT:
    "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-0 py-0 shadow-none text-sm font-semibold tabular-nums focus-visible:ring-0 data-[size=default]:h-8",
} as const;

// --- Notices -----------------------------------------------------------------

export const NOTICE = {
  ROOT: "flex items-start gap-3 rounded-field px-4 py-3 text-sm",
  DISC: "grid size-7 flex-none place-items-center rounded-pill",
} as const;

export const NOTICE_TONE: Record<
  "warning" | "info",
  { fill: string; disc: string; glyph: MaterialSymbolName }
> = {
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

// --- Automation tiles --------------------------------------------------------

export const AUTO_GRID =
  "grid grid-cols-1 gap-3 @xl/section:grid-cols-2 @xl/section:items-stretch";

export const AUTO_TILE = {
  ROOT: "flex min-w-0 flex-col gap-3 rounded-tile bg-surface-container px-5 py-4",
  HEAD: "flex flex-wrap items-center gap-x-2.5 gap-y-2",
  DISC: "grid size-9 flex-none place-items-center rounded-pill transition-colors duration-[var(--duration-standard)] ease-standard",
  DISC_NEUTRAL: "bg-surface-container-high text-on-surface-variant",
  TITLE: "text-sm font-semibold",
  BODY: "text-xs leading-relaxed text-pretty text-on-surface-variant",
  FOOT: "mt-auto",
} as const;

/**
 * The disc carries the state: its fill is the matching `Badge` variant's tonal pair, with the state name as its
 * accessible label.
 */
const DISC_TONE: Partial<Record<BadgeVariant, string>> = {
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
  info: "bg-primary-container text-on-primary-container",
};

/** Anything without a verdict tone (muted, unknown) stays the neutral disc. */
export function discTone(variant: BadgeVariant): string {
  return DISC_TONE[variant] ?? AUTO_TILE.DISC_NEUTRAL;
}

/** Live-quality strip: rising columns (not a track, so it never reads as a second slider); each is 5% of
 * quality, with a notch where failover releases. */
export const METER_BARS = 20;
export const AUTO_METER = {
  ROOT: "relative pb-2",
  BARS: "flex h-6 w-full items-end gap-[3px]",
  BAR: "min-w-0 flex-1 rounded-t-[3px] transition-colors duration-[var(--duration-standard)] ease-standard",
  NOTCH:
    "absolute bottom-0 size-2 -translate-x-1/2 bg-on-surface [clip-path:polygon(50%_0,0_100%,100%_100%)]",
} as const;

/** Height of column `index` (0-based): 25% at the first, 100% at the last. */
export function meterBarHeight(index: number): string {
  return `${25 + (75 * index) / (METER_BARS - 1)}%`;
}

/**
 * Column colour: one hue (primary), shade by position; unlit columns are neutral so headroom never competes with the
 * reading.
 */
export function meterBarColor(index: number, lit: boolean): string {
  if (!lit) return "var(--surface-container-high)";
  const strength = 30 + Math.round((70 * index) / (METER_BARS - 1));
  return `color-mix(in oklab, var(--primary) ${strength}%, transparent)`;
}

/** A column is lit when the reading reaches at least half of its 5% band. */
export function meterBarLit(index: number, qualityPct: number | null): boolean {
  if (qualityPct === null) return false;
  return qualityPct >= (index * 100) / METER_BARS + 100 / METER_BARS / 2;
}

export const DAY_CHIP = {
  ROW: "flex flex-wrap gap-2",
  ROOT: [
    "relative inline-flex size-11 items-center justify-center rounded-pill",
    "text-xs font-semibold select-none",
    "transition-[color,background-color] duration-[var(--duration-standard)] ease-standard",
    "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-55",
  ].join(" "),
} as const;

export function dayChipFill(selected: boolean): string {
  return selected
    ? "bg-primary-container text-on-primary-container enabled:hover:bg-primary-container/80"
    : "bg-surface-container-high text-on-surface-variant enabled:hover:text-on-surface";
}

// --- Status chips ------------------------------------------------------------

export type TowerLockPresence = "present" | "absent" | "unknown";

/** Is any lock on the modem? An unread leg never counts as "absent". */
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

export type TowerFailoverKey =
  | "disabled"
  | "ready"
  | "watching"
  | "released"
  | "stalled"
  | "unknown";

/** Every state wears its own glyph (the glyph is the only separation). */
export const FAILOVER_BADGE: Record<
  TowerFailoverKey,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  disabled: { variant: "muted", glyph: "do_not_disturb_on" },
  ready: { variant: "info", glyph: "schedule" },
  watching: { variant: "success", glyph: "shield" },
  released: { variant: "warning", glyph: "warning" },
  stalled: { variant: "destructive", glyph: "error" },
  unknown: { variant: "muted", glyph: "help" },
};

/**
 * `ready` = on, nothing to guard yet. `stalled` = on, a lock exists, but no
 * watcher is running. `released` = the watcher fired and dropped the lock.
 */
export function failoverKey(
  failover: { enabled: boolean; activated: boolean; watcher_running: boolean },
  presence: TowerLockPresence,
): TowerFailoverKey {
  if (!failover.enabled) return "disabled";
  if (failover.activated) return "released";
  if (failover.watcher_running) return "watching";
  if (presence === "present") return "stalled";
  if (presence === "unknown") return "unknown";
  return "ready";
}

export type LegPosture = "locked" | "unlocked" | "unknown";

// --- Skeletons ---------------------------------------------------------------

/** Mirrors of the loaded shapes. Slot rows compose `SLOT_ROW.ROOT` instead. */
export const SKELETON_SHAPE = {
  CARD_TITLE: "h-5 w-32",
  CARD_DESC: "h-4 w-52",
  CARD_CHIP: "h-5 w-24",
  SECTION_TITLE: "h-5 w-32",
  FIELD_LABEL: "h-3 w-24",
  FIELD_CONTROL: "h-[2.625rem] w-full rounded-field",
  TILE_VALUE: "h-8 w-24 rounded-field",
  ACTION: "h-[2.625rem] w-36 rounded-pill",
  ACTION_SECONDARY: "h-[2.625rem] w-40 rounded-pill",
  REVEAL: "h-[2.625rem] w-[2.625rem] rounded-pill",
  CONTROL_ROW: "h-[3.25rem] w-full rounded-field",
  READBACK: "h-[4.25rem] w-full rounded-field",
  CARRIER_TILE: "h-[5.4375rem] w-full rounded-tile",
  AUTO_TILE: "h-[14.625rem] w-full rounded-tile",
  VERDICT: "h-[3.25rem] w-full rounded-tile",
  PERSIST_FIELD: "h-[2.625rem] w-[17.125rem] rounded-pill",
  DAY_CHIP: "size-11 rounded-pill",
} as const;

// --- Legs --------------------------------------------------------------------

export type TowerLeg = "lte" | "nr_sa";

const K = "tower_locking";

/** Literal keys per leg: `i18n:check` cannot see an interpolated stem. */
export const LEG_KEYS: Record<
  TowerLeg,
  { title: string; description: string; short: string }
> = {
  lte: {
    title: `${K}.legs.lte.title`,
    description: `${K}.legs.lte.description`,
    short: `${K}.short.lte`,
  },
  nr_sa: {
    title: `${K}.legs.nr_sa.title`,
    description: `${K}.legs.nr_sa.description`,
    short: `${K}.short.nr_sa`,
  },
};

/** DOM ids the carrier tiles scroll to. */
export const LEG_CARD_ID: Record<TowerLeg, string> = {
  lte: "tower-card-lte",
  nr_sa: "tower-card-nr-sa",
};
