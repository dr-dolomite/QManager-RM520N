import type { NetworkEvent, NetworkEventType } from "@/types/modem-status";

// =============================================================================
// Network-event presentation model.
// =============================================================================
// The poller's event log is a flat transcript: every line is equally loud, and
// "Internet Lost" reads exactly like "Internet Restored" two rows above it.
// This module turns that transcript into something scannable, along two
// independent axes that must not be confused with each other:
//
//   TONE:   what KIND of thing happened. Failure, degradation, recovery, or
//           routine radio housekeeping. Derived from severity, then from
//           whether an info-severity type reports something going right rather
//           than merely changing.
//
//   WEIGHT: how much the row still MATTERS. A tonal container is spent on
//           rows that are recent, or on problems that have not been resolved
//           yet. Everything else settles to a neutral surface and keeps only
//           its coloured icon disc.
//
// The row's ANATOMY comes from the Motion Guide's recipe 04 (Alert arrival):
// a filled circular icon disc in the solid role colour, then the message as the
// primary line, then a machine-voice timestamp caption. The earlier pass drew
// the Recommended Hybrid variant instead — a bare glyph under a "Carrier
// Aggregation — 2 min ago" label line — which is why the slots below invert
// relative to that version.
//
// Weight still moves the CONTAINER between two states, exactly as it did: three
// recent rows in their role containers, and a row an hour old sitting on the
// plain surface. What changed is what survives the settle. It used to be a bare
// green check; it is now a saturated green disc, which is a stronger carrier of
// the same statement — tone is a fact about the event and never expires.
//
// The resolution pairing below is the one derivation the backend deliberately
// does not do, and it survives as the guard on the age rule rather than as the
// fill rule itself: a degradation nobody has recovered from must never quietly
// fade to grey just because an hour passed. It is still true, so it stays lit.
//
// The pairing is done here rather than in `events.sh` because it is a reading
// of the log, not a fact about the radio. status.json stays a faithful
// transcript; the interpretation lives in the client, where it can change
// without an OTA.
// =============================================================================

// -----------------------------------------------------------------------------
// Resolution pairing
// -----------------------------------------------------------------------------

/**
 * Degradation types whose recovery is a DIFFERENT event type. The poller emits
 * the two halves as separate lines, so the only link between them is this map.
 */
const RESOLVED_BY: Partial<Record<NetworkEventType, NetworkEventType>> = {
  internet_lost: "internet_restored",
  signal_lost: "signal_restored",
  high_latency: "latency_recovered",
  high_packet_loss: "packet_loss_recovered",
};

/**
 * Degradation types whose recovery is the SAME type re-emitted at severity
 * "info". These describe a property that flipped rather than a thing that
 * broke, so the poller reuses one type for both directions and lets severity
 * carry the direction:
 *
 *   nr_anchor     "5G NR anchor lost" (warning) -> "acquired" (info)
 *   ca_change     "LTE/NR CA deactivated" (warning) -> "activated" (info)
 *   airplane_mode enabled (warning) -> disabled (info)
 *
 * Read by TWO consumers, which is why it is worth keeping as one list: the
 * pairing pass below, and `toneOf`, where membership plus info severity is what
 * makes a gained carrier green instead of grey.
 */
const SELF_RESOLVING: ReadonlySet<NetworkEventType> = new Set([
  "nr_anchor",
  "ca_change",
  "airplane_mode",
]);

// Everything not named above is a one-shot notice, not a condition:
// tower_failover, sim_failover, sim_swap_detected, profile_deactivated,
// profile_failed, watchcat_recovery, network_mode, band_change, pci_change,
// scc_pci_change, profile_applied, and the four *_restored / *_recovered
// types. A one-shot describes a moment that has already passed, so it can
// never be "unresolved".
//
// It can still be TONAL, which is the change the age rule brings: a one-shot
// wears its container for its first hour and then settles. What "unresolved"
// buys a row is exemption from that settling, and only a condition can earn
// it.

/**
 * Which rows are still-standing problems, computed in ONE pass over the full
 * event array.
 *
 * `events` must be the hook's complete newest-first array (up to 20), not the
 * five rows the card draws. A recovery that has already scrolled out of the
 * visible slice still resolves the degradation below it, and slicing first
 * would leave stale rows glowing amber forever. The visible count shrinking
 * from six to five makes this MORE load-bearing, not less: there is now one
 * fewer row of headroom before a recovery falls past the clip edge.
 *
 * Newest-first is what makes a single pass possible: walking from index 0
 * downward, everything already visited is strictly LATER in time than the event
 * being judged, which is exactly the window a resolution has to appear in.
 *
 * Returns indices into `events`.
 */
export function computeUnresolved(
  events: readonly NetworkEvent[],
): ReadonlySet<number> {
  const unresolved = new Set<number>();

  // Types seen at a lower index, i.e. later in time.
  const laterTypes = new Set<NetworkEventType>();
  // Types seen later at severity "info", the recovery half of a self-resolver.
  const laterInfoTypes = new Set<NetworkEventType>();
  // type|severity pairs seen later. A degradation that has already re-fired
  // more recently is superseded by that newer firing, so three stacked
  // "Internet Lost" rows light exactly one container, not three.
  const laterDegradations = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const degraded = e.severity === "warning" || e.severity === "error";

    if (degraded) {
      const recovery = RESOLVED_BY[e.type];
      const superseded = laterDegradations.has(`${e.type}|${e.severity}`);

      if (!superseded) {
        if (recovery !== undefined) {
          if (!laterTypes.has(recovery)) unresolved.add(i);
        } else if (SELF_RESOLVING.has(e.type)) {
          if (!laterInfoTypes.has(e.type)) unresolved.add(i);
        }
      }
    }

    laterTypes.add(e.type);
    if (e.severity === "info") laterInfoTypes.add(e.type);
    else laterDegradations.add(`${e.type}|${e.severity}`);
  }

  return unresolved;
}

// -----------------------------------------------------------------------------
// Glyph and tone
// -----------------------------------------------------------------------------

export type EventGlyph =
  | "success"
  | "warning"
  | "error"
  | "handoff"
  | "radio"
  | "sim"
  | "profile"
  | "neutral";

/**
 * What kind of thing the row reports. Independent of how loudly it is drawn.
 *
 * "routine" is the large majority of a healthy modem's log: band changes, cell
 * handoffs, mode switches. They are information, not news.
 */
export type EventTone = "error" | "warning" | "success" | "routine";

/**
 * Everything the row needs to draw itself, and nothing it already knows.
 *
 * `unresolved` and a `tonal` flag both used to be echoed back here and neither
 * is: the caller supplies the first and the second is fully readable from
 * `containerClass`. What survives is the classification (`tone`) plus the class
 * slots, which is the smallest set that keeps every colour decision in this
 * module instead of leaking into the component's className chain.
 *
 * The slots inverted with the recipe-04 anatomy. There used to be a
 * `labelClass` for an event-type line above the message and a `glyphClass` for
 * a bare icon; there is now a `metaClass` for the timestamp caption BELOW the
 * message, and the glyph's colour is folded into `discClass` because the disc
 * and the glyph inside it are one paired decision, never two.
 */
export interface EventPresentation {
  glyph: EventGlyph;
  /** The semantic classification. The one output worth reading directly. */
  tone: EventTone;
  /** Container fill, plus paired `on-` ink when the fill is chromatic. */
  containerClass: string;
  /** The icon disc: its fill and the glyph ink paired with it. Never empty. */
  discClass: string;
  /** Ink for the message line. Empty when the container supplies it. */
  messageClass: string;
  /** Ink for the timestamp caption. */
  metaClass: string;
  /** i18n key under the `dashboard` namespace for the sr-only severity word. */
  srSeverityKey: string;
}

/**
 * How long a row keeps its tonal container. One hour, taken straight from the
 * design reference, where a 16-minute row is filled and a 1h03m row is not.
 *
 * The comparison uses the browser clock against a modem-written `date +%s`
 * (events.sh:84). That is a cross-machine subtraction and it can skew, but it
 * is the SAME subtraction that already prints "2 min ago" beside the row, so
 * the fill and the timestamp can only ever be wrong together and consistently.
 * A freshness gate computed some other way would be the real hazard: two
 * clocks disagreeing inside one row.
 */
export const FRESH_WINDOW_SEC = 3600;

/** Whether a row still counts as recent, given a unix-seconds "now". */
export function isFresh(event: NetworkEvent, nowSec: number): boolean {
  return nowSec - event.timestamp < FRESH_WINDOW_SEC;
}

/** Info-severity types that report something going RIGHT rather than something
 *  merely changing. They earn the success glyph; a band change does not.
 *
 *  This set names types that are recoveries OUTRIGHT — every event of this type
 *  is good news. It is deliberately not the whole story: see `SELF_RESOLVING`
 *  in `toneOf`, where the direction lives in severity rather than in the type. */
const RECOVERY_TYPES: ReadonlySet<NetworkEventType> = new Set([
  "internet_restored",
  "signal_restored",
  "latency_recovered",
  "packet_loss_recovered",
  "watchcat_recovery",
  "profile_applied",
]);

/** Family glyphs for routine info events, so a row is scannable by shape
 *  before it is read. Anything unmapped falls through to "neutral". */
const FAMILY_GLYPHS: Partial<Record<NetworkEventType, EventGlyph>> = {
  pci_change: "handoff",
  scc_pci_change: "handoff",
  band_change: "radio",
  ca_change: "radio",
  nr_anchor: "radio",
  network_mode: "radio",
  sim_failover: "sim",
  sim_swap_detected: "sim",
  profile_deactivated: "profile",
  profile_failed: "profile",
};

/**
 * The tonal container each tone spends when the row is drawn at full weight.
 *
 * Three of the four are chromatic and carry their own paired `on-` ink, so a
 * row using them needs no per-line colour at all: the pair is contrast-checked
 * by construction and the whole row speaks with one voice.
 *
 * "routine" is deliberately ACHROMATIC, and this is the one place the design
 * reference had to be extrapolated rather than traced: it shows no fresh
 * routine row, so there was no literal answer to copy. Both coloured options
 * were worse than a neutral step:
 *
 *   success-container would claim a band change is good news. It is not news
 *   at all, and DESIGN.md's Functional-Color Promise reserves green for
 *   something actually going right.
 *
 *   primary-container measures L 0.400 in dark mode against 0.300 / 0.320 /
 *   0.325 for success / warning / destructive. A routine handoff would be the
 *   BRIGHTEST row on the card, louder than an outage. Inverted urgency.
 *
 * surface-container-high (L 0.918 light, 0.312 dark) is a step up from the
 * resting surface without making a colour claim, which is exactly the reading:
 * noted, recent, not important. It is also already the shipped meaning of the
 * `muted` badge role, so the vocabulary stays consistent across the product.
 */
const TONAL_FILL: Record<EventTone, string> = {
  error: "bg-destructive-container text-on-destructive-container",
  warning: "bg-warning-container text-on-warning-container",
  success: "bg-success-container text-on-success-container",
  routine: "bg-surface-container-high",
};

/**
 * The icon disc, recipe 04's defining move: a filled circle in the SOLID role
 * colour with that role's near-white ink, not a bare glyph tinted with it.
 *
 * The solid role is a full step more saturated than the container it usually
 * sits inside (`--success` L 0.52 against `--success-container` L 0.89 in
 * light, 0.82 against 0.30 in dark), so the disc separates from its own row in
 * both themes without a border, and it stays the loudest thing in the row when
 * the row settles to a neutral surface. That is the whole reason the disc, not
 * the container, is now the primary tone carrier: a container that expires
 * cannot be where a permanent fact lives.
 *
 * "routine" is absent on purpose — it has no solid role colour to spend and its
 * disc is a function of whatever surface the row landed on. See `discFor`.
 */
const DISC_FILL: Record<Exclude<EventTone, "routine">, string> = {
  error: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-warning-foreground",
  success: "bg-success text-success-foreground",
};

/**
 * The routine disc is defined by its RELATIONSHIP to the row, not by a colour.
 *
 * The reference puts it one surface step BELOW the row — a recessed well rather
 * than a raised token, which is exactly the reading routine deserves: present,
 * not announcing itself. That works on a fresh routine row, which sits on
 * `surface-container-high` and can afford a step down.
 *
 * An aged row has already spent that step; it sits on `surface-container`, and
 * stepping down again lands on `surface`, i.e. the card itself, which erases
 * the disc entirely. So an aged routine disc steps UP instead. The magnitude of
 * the delta is preserved (one step, ~0.034 L in both themes) and only its
 * direction flips, which keeps the disc a soft halo in both cases. The GLYPH is
 * what has to be legible, and `on-surface-variant` clears 4.5:1 against every
 * surface in the chain.
 */
function routineDisc(tonal: boolean): string {
  return tonal
    ? "bg-surface-container text-on-surface-variant"
    : "bg-surface-container-high text-on-surface-variant";
}

/** Screen-reader severity word per tone, before the unresolved override. */
const SR_KEY: Record<EventTone, string> = {
  error: "activities.severity.error",
  warning: "activities.severity.warning",
  success: "activities.severity.recovered",
  routine: "activities.severity.routine",
};

/**
 * Severity first, family second.
 *
 * Note on the error branch, because it is easy to get wrong: severity "error"
 * IS emitted, just never from events.sh. The six sites are all in the other
 * binaries that call append_event: qmanager_watchcat (:468, :483 sim_failover,
 * :512, :528, :596 watchcat_recovery) and qmanager_profile_apply (:702
 * profile_failed). Grepping events.sh alone reports zero and is misleading.
 *
 * Under the age rule a red FILL is now reachable, which it was not before: an
 * error-severity one-shot is drawn in destructive-container for its first hour
 * and then settles to a red glyph on the plain surface. Previously only
 * `unresolved` rows were ever filled, and no error-emitting type can be
 * unresolved (none enters RESOLVED_BY or SELF_RESOLVING), so that branch was
 * unreachable plumbing.
 *
 * The SELF_RESOLVING branch is the one that stops a carrier being ADDED from
 * reading as housekeeping. `ca_change` is a single type carrying both
 * directions — "LTE CA activated: B1+B3" at info (events.sh:721), "LTE carriers
 * changed from 2 to 3 (+B3)" at info (:754), "LTE CA deactivated" at warning
 * (:730) — and the count-shrink case already downgrades itself to warning
 * (:736). So by the time control reaches here, an info-severity self-resolver
 * has ALREADY been filtered by the two severity guards above: it can only be
 * the recovery half. That is why the set needs no severity check of its own,
 * and why gaining a carrier is green while a band handoff stays routine. A
 * handoff swaps one band for another and nothing improved; this is capacity
 * that was missing and came back.
 *
 * Reusing SELF_RESOLVING rather than listing `ca_change` in RECOVERY_TYPES is
 * the point: that set is already DEFINED as "types whose info half is the
 * recovery", so tone and the unresolved pairing now read one fact instead of
 * two lists that can drift apart. It also, by construction, greens the other
 * two members on their info half — "5G NR anchor acquired" (:674) and airplane
 * mode disabled — which is the same statement in both cases: a radio capability
 * that was gone is back.
 */
function toneOf(event: NetworkEvent): EventTone {
  if (event.severity === "error") return "error";
  if (event.severity === "warning") return "warning";
  if (RECOVERY_TYPES.has(event.type) || SELF_RESOLVING.has(event.type))
    return "success";
  return "routine";
}

function glyphOf(event: NetworkEvent, tone: EventTone): EventGlyph {
  if (tone === "error") return "error";
  if (tone === "warning") return "warning";
  if (tone === "success") return "success";
  return FAMILY_GLYPHS[event.type] ?? "neutral";
}

/**
 * Build the row's full visual description.
 *
 * `fresh` and `unresolved` are ORed rather than ANDed on purpose. Freshness
 * decides the common case, and resolution is the safety valve underneath it: a
 * degradation still standing after an hour keeps its container, because the
 * alternative is a live outage rendered in the same grey as a band change from
 * last Tuesday. Age may retire history. It may not retire a problem.
 */
export function presentEvent(
  event: NetworkEvent,
  unresolved: boolean,
  fresh: boolean,
): EventPresentation {
  const tone = toneOf(event);
  const glyph = glyphOf(event, tone);
  const tonal = fresh || unresolved;

  // A chromatic container ships its own ink for every line inside it, so the
  // row must NOT also set per-line colours; a second voice inside the fill
  // reads as two statements rather than one.
  const chromatic = tonal && tone !== "routine";

  const containerClass = tonal ? TONAL_FILL[tone] : "bg-surface-container";

  return {
    glyph,
    tone,
    containerClass,
    // The one slot that does NOT consult `tonal` for a chromatic tone. An aged
    // warning row goes grey and keeps a full-strength amber disc, which is the
    // age rule stated in one line: the row stops competing for attention, the
    // event does not stop having been a warning.
    discClass: tone === "routine" ? routineDisc(tonal) : DISC_FILL[tone],
    messageClass: chromatic ? "" : "text-on-surface",
    // On a chromatic row the caption inherits the container's `on-` ink and is
    // pushed back by a whisper. 90% rather than the reference's 75%: at 75% the
    // 12px caption falls to roughly 3.5:1 against its own container, under the
    // 4.5:1 floor, and this line carries the timestamp — the one thing on the
    // row a user squints at. Size, weight and the mono voice already do most of
    // the recession; the opacity only finishes it.
    metaClass: chromatic ? "opacity-90" : "text-on-surface-variant",
    // An unresolved row is not describing a past severity, it is describing a
    // present condition, and the screen-reader label has to say which.
    srSeverityKey: unresolved ? "activities.severity.unresolved" : SR_KEY[tone],
  };
}

/**
 * Stable React key for an event row.
 *
 * The message is load-bearing, not decoration. events.sh emits type
 * "pci_change" from two separate sites (the LTE handoff at :507 and the NR one
 * at :547), so an LTE and an NR handoff detected in the same poll tick share a
 * timestamp AND a type, and a timestamp+type key would collide. The index used
 * to be in here, which was worse: on a newest-first list one new event shifts
 * every index, so all six keys changed and all six rows remounted on every
 * single event.
 */
export function eventKey(e: NetworkEvent): string {
  return `${e.timestamp}-${e.type}-${e.message}`;
}
