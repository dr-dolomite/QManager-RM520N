import type { PingProfile, PingProfileTargets } from "@/hooks/use-ping-profile";
import type { QualityNamedPreset } from "@/types/modem-status";

// Connection Quality: this family's geometry, imported by the loaded views AND
// their skeletons. Restated here, never imported across families.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper, as on the other Monitoring pages. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** Probe Targets beside Quality Thresholds, one height, stacked below 58rem. */
export const PAIR =
  "grid grid-cols-1 items-stretch gap-5 @[58rem]/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** A pair cell hands its full height to the card inside it. */
export const CARD_CELL = "flex min-w-0 flex-col";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card flex-1 gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

/** The body column. `flex-1` lets a pair card hand its slack to one region. */
export const CARD_BODY = "flex flex-1 flex-col gap-4";

export const CARD_TITLE = "col-start-1 min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant col-start-1 text-sm";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const PILL_GLYPH = "size-4";

/** The 42px action height every pill button and field shares here. */
const CONTROL_H = "h-[2.625rem]";
/** CONTROL_H as a floor, for a row that may wrap; kept literal so Tailwind scans it. */
const CONTROL_MIN_H = "min-h-[2.625rem]";

// -----------------------------------------------------------------------------
// Groups and eyebrows
// -----------------------------------------------------------------------------

export const EYEBROW =
  "text-on-surface-variant min-w-0 truncate text-[0.6875rem] leading-[1.125rem] font-semibold tracking-[0.02em] uppercase";

/** An eyebrow over its rows: 9px between them, 5px between rows. */
export const GROUP = "flex flex-col gap-[0.5625rem]";
/** min-h-5 is the HintIcon trigger, so a head with or without one keeps one height. */
export const GROUP_HEAD = "flex min-h-5 flex-wrap items-center gap-x-2 gap-y-2 px-1";
export const ROW_STACK = "flex flex-col gap-[0.3125rem]";

/** The pending-edit marker in the card foot. */
export const DELTA = "text-primary text-[0.6875rem] font-semibold tracking-[0.06em] uppercase";

/** A failed save, left in the foot until the next edit or save. */
export const FAILED = {
  ROOT: "text-destructive-on-surface inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold",
  GLYPH: "size-3.5 flex-none",
} as const;

// -----------------------------------------------------------------------------
// Probe Targets: the four-leg chain
// -----------------------------------------------------------------------------

/** The chain in PROBE ORDER: the daemon stops at the first leg that answers. */
export const SLOT_ORDER = [
  "target_host_1",
  "target_host_2",
  "target_ip_1",
  "target_ip_2",
] as const satisfies readonly (keyof PingProfileTargets)[];

export type SlotKey = (typeof SLOT_ORDER)[number];

/** The two hostname legs come first, so the RESOLVER picks the family. */
export const HOSTNAME_LEGS = 2;

/** Each profile's own cadence in seconds, mirrored from `conn_state_cadence` so a draft previews it. */
export const PROFILE_INTERVAL_SEC: Record<PingProfile, number> = {
  sensitive: 1,
  regular: 2,
  relaxed: 5,
  quiet: 10,
};

/** One leg: a 28px number disc beside its 42px field, the error under the field. */
export const LEG = {
  ROOT: "flex flex-col gap-1",
  ROW: "flex items-center gap-3",
  DISC: "grid size-7 flex-none place-items-center rounded-pill text-[0.8125rem] leading-none font-semibold tabular-nums transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
  DISC_REST: "bg-surface-container-high text-on-surface-variant",
  DISC_ANSWERED: "bg-primary text-primary-foreground",
} as const;

/** A probe target is an identifier the device echoes back verbatim, so mono. */
const FIELD_H = `${CONTROL_H} pointer-coarse:h-11`;
export const FIELD_MONO = `${FIELD_H} min-w-0 flex-1 font-mono text-[0.84375rem] font-medium`;

/** Indented past the disc and gap, so it starts at the field's edge. */
export const FIELD_ERROR = "text-destructive-on-surface pl-10 text-xs leading-relaxed";

// -----------------------------------------------------------------------------
// Pill rows, restated from Cellular Information's ROW_SHAPE
// -----------------------------------------------------------------------------

/** Wraps like the dashboard PillRow: on a phone the value drops under its key instead of cutting it. */
export const ROW = {
  ROOT: `flex ${CONTROL_MIN_H} min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-0.5 rounded-pill bg-surface-container px-4 py-[0.3125rem] text-[0.8125rem] leading-5 font-semibold`,
  KEY: "text-on-surface-variant min-w-0",
  VALUE: "ml-auto flex min-w-0 items-center gap-1.5 whitespace-nowrap tabular-nums",
  QUIET: "text-on-surface-variant font-medium",
  LINK: "text-primary-on-surface inline-flex items-center gap-1 rounded-inline font-semibold underline-offset-4 hover:underline",
  LINK_GLYPH: "size-3.5",
  /** The over-limit notch, centred on the 20px line box beside its figure. */
  ALERT: "size-3.5 flex-none",
} as const;

/** The custom limit field inside a pill row: a compact numeric input plus its unit. */
export const CUSTOM_FIELD = {
  WRAP: "ml-auto flex items-center gap-1.5",
  INPUT: "h-8 w-24 rounded-pill bg-card px-3 text-right text-[0.8125rem] font-semibold tabular-nums",
  UNIT: "text-on-surface-variant font-medium",
} as const;

/** The over-limit glyph's ink, by Latency Monitor's own tone. */
export const ALERT_INK = {
  warn: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

// -----------------------------------------------------------------------------
// Quality Thresholds
// -----------------------------------------------------------------------------

/**
 * The preset table from `cq_preset_latency` / `cq_preset_loss` in
 * `scripts/usr/lib/qmanager/conn_state.sh`: latency flags above the cut, loss AT it.
 * `custom` is not here: it takes the user's number with `CUSTOM_DEBOUNCE`.
 */
export const PRESET_LIMIT = {
  latency: {
    standard: { limit: 150, debounce: 3 },
    tolerant: { limit: 250, debounce: 3 },
    "very-tolerant": { limit: 500, debounce: 2 },
  },
  loss: {
    standard: { limit: 15, debounce: 3 },
    tolerant: { limit: 30, debounce: 3 },
    "very-tolerant": { limit: 50, debounce: 2 },
  },
} satisfies Record<
  "latency" | "loss",
  Record<QualityNamedPreset, { limit: number; debounce: number }>
>;

/** Polls a custom limit must hold for, as `cq_preset_latency custom` sets it. */
export const CUSTOM_DEBOUNCE = 3;

/**
 * The CGI's accepted custom range. Loss starts at 1: the shell compares loss with
 * `-ge`, so a 0 % cut would flag a link with no loss at all.
 */
export const CUSTOM_RANGE = {
  latency: { min: 1, max: 10000 },
  loss: { min: 1, max: 100 },
} as const;

/** Eyebrow left, the preset pill right; below 32rem the Select wraps to its own line. */
export const METRIC_HEAD =
  "flex min-h-[2.625rem] flex-wrap items-center gap-x-3 gap-y-[0.5625rem] pl-1";

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3.5 rounded-hero px-8 py-10 text-center",
  DISC: "grid size-14 flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.625rem]",
  TITLE: "text-xl font-semibold tracking-[-0.01em]",
  TEXT: "flex flex-col gap-1.5",
  BODY: "max-w-[44ch] text-sm leading-relaxed text-pretty",
  ACTION: `mt-2 ${CONTROL_H} gap-2 rounded-pill px-6 text-sm font-semibold`,
  /** A state block fills the card body instead of a form. */
  SCREEN: "min-h-0 flex-1 justify-center",
} as const;

// -----------------------------------------------------------------------------
// Skeletons: placeholder boxes from the loaded constants
// -----------------------------------------------------------------------------

export const SKELETON_LOCAL = {
  /** The verdict Badge's 22px box, inline so it sits in the same line box. */
  VERDICT: "inline-block h-[1.375rem] w-28 rounded-pill align-middle",
  EYEBROW: "h-3 w-24 rounded-inline",
  DISC: "size-7 flex-none rounded-pill",
  FIELD: `${FIELD_H} min-w-0 flex-1 rounded-field`,
  ROW_TEXT: "h-3 rounded-inline",
  /** SegmentedField's 42px track; full width where the Select stands in for it. */
  SEGMENT: `${CONTROL_H} w-full rounded-pill @lg/card:w-72`,
  ACTION: `${CONTROL_H} w-36 rounded-pill`,
} as const;
