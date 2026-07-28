import type { NetworkEvent, NetworkEventType } from "@/types/modem-status";

// =============================================================================
// Network-event presentation model.
// =============================================================================
// The poller's event log is a flat transcript: every line is equally loud, and
// "Internet Lost" reads exactly like "Internet Restored" two rows above it. The
// question a person actually brings to this card is not "what happened" but "is
// anything still wrong right now", and the transcript alone cannot answer it.
//
// So this module does one derivation the backend deliberately does not: it
// pairs each degradation with the recovery that cancels it, and reports which
// degradations are still standing. Only those get a tonal container in the UI.
// Everything else is history, and history is quiet.
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
// never be "unresolved" and must never light a container.

/**
 * Which rows are still-standing problems, computed in ONE pass over the full
 * event array.
 *
 * `events` must be the hook's complete newest-first array (up to 20), not the
 * six rows the card draws. A recovery that has already scrolled out of the
 * visible slice still resolves the degradation below it, and slicing first
 * would leave stale rows glowing amber forever.
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

export interface EventPresentation {
  glyph: EventGlyph;
  /** Tailwind class for the glyph ink. */
  glyphTone: string;
  /** i18n key under the `dashboard` namespace for the sr-only severity word. */
  srSeverityKey: string;
  unresolved: boolean;
}

/** Info-severity types that report something going RIGHT rather than something
 *  merely changing. They earn the success glyph; a band change does not. */
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
 * Severity first, family second.
 *
 * Note on the error branch, because it is easy to get wrong: severity "error"
 * IS emitted, just never from events.sh. The six sites are all in the other
 * binaries that call append_event: qmanager_watchcat (:468, :483 sim_failover,
 * :512, :528, :596 watchcat_recovery) and qmanager_profile_apply (:702
 * profile_failed). Grepping events.sh alone reports zero and is misleading.
 *
 * What that means for this card: a red GLYPH is reachable today, a red FILL is
 * not. All three error-emitting types are one-shot notices, so none of them
 * enters RESOLVED_BY or SELF_RESOLVING, so none can ever be `unresolved`, so
 * the destructive-container branch in the row (and the `destructive` chip tone,
 * which reads only unresolved rows) stays unreachable plumbing. That is a
 * consequence of the resolution model, not an accident, and it holds as long as
 * no error-severity type gains a paired recovery.
 */
export function presentEvent(
  event: NetworkEvent,
  unresolved: boolean,
): EventPresentation {
  let glyph: EventGlyph;
  let glyphTone: string;
  let srSeverityKey: string;

  if (event.severity === "error") {
    glyph = "error";
    glyphTone = "text-destructive";
    srSeverityKey = "activities.severity.error";
  } else if (event.severity === "warning") {
    glyph = "warning";
    glyphTone = "text-warning";
    srSeverityKey = "activities.severity.warning";
  } else if (RECOVERY_TYPES.has(event.type)) {
    glyph = "success";
    glyphTone = "text-success";
    srSeverityKey = "activities.severity.recovered";
  } else {
    glyph = FAMILY_GLYPHS[event.type] ?? "neutral";
    glyphTone = "text-on-surface-variant";
    srSeverityKey = "activities.severity.routine";
  }

  // An unresolved row is not describing a past severity, it is describing a
  // present condition, and the screen-reader label has to say which.
  if (unresolved) srSeverityKey = "activities.severity.unresolved";

  return { glyph, glyphTone, srSeverityKey, unresolved };
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
