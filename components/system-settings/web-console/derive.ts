// Web Console — derivations.
// `shapes.ts` owns how things look; this owns what the socket's state means.
// The failure taxonomy itself belongs to the HOOK: it reads the close event, so
// `ConsoleFailureKind` is decided there once and re-derived nowhere.

import type {
  ConnectionState,
  ConsoleFailure,
  ConsoleFailureKind,
} from "@/hooks/use-web-console";

// -----------------------------------------------------------------------------
// The view
// -----------------------------------------------------------------------------

/** What the pane is showing. */
export type ConsoleView = "loading" | "live" | "failed";

/**
 * The one view test the card branches on. `failed` needs a failure to describe,
 * and the hook only carries one while it has settled — so a settled state with
 * none has not landed yet and the pane stays live.
 *
 * Once a session has opened, a retry keeps the transcript visible rather than
 * covering it: `loading` is the first connect only.
 */
export function resolveView(
  state: ConnectionState,
  failure: ConsoleFailure | null,
  hasOpened: boolean,
): ConsoleView {
  const settled = state === "disconnected" || state === "unavailable";
  if (settled && failure !== null) return "failed";
  if (!hasOpened) return "loading";
  return "live";
}

// -----------------------------------------------------------------------------
// Copy keys
// -----------------------------------------------------------------------------

/** What the chip says: the live state, or — once settled — why it stopped. */
export type ChipKey =
  | "connecting"
  | "connected"
  | "reconnecting"
  | ConsoleFailureKind;

/**
 * The chip's copy key, which is also its glyph key: a chip whose label sharpens
 * to a failure kind while its glyph stays on the coarse socket state would put
 * four sentences behind two icons.
 */
export function chipCopyKey(
  state: ConnectionState,
  failure: ConsoleFailure | null,
): ChipKey {
  if (failure !== null) return failure.kind;
  // `disconnected` and `unavailable` are only ever set alongside a failure.
  return state === "connected" || state === "reconnecting"
    ? state
    : "connecting";
}

/**
 * The retry pill's copy, per kind. The act is the same reconnect every time;
 * the verb is not — a shell that exited is started again, not retried.
 */
export const FAILURE_ACTION = {
  unreachable: "retry",
  refused: "retry",
  dropped: "reconnect",
  ended: "start_session",
} satisfies Record<ConsoleFailureKind, string>;

export interface CloseDetail {
  key: string;
  params: Record<string, string | number>;
}

/**
 * The close event in machine voice, as a copy key and its parameters. Always
 * returns one: a deliberate `disconnect()` reports no code at all, and the
 * block still needs a line under its sentence.
 */
export function closeDetail(failure: ConsoleFailure): CloseDetail {
  if (failure.code === null) return { key: "close.none", params: {} };
  const reason = failure.reason.trim();
  if (reason) {
    return { key: "close.reason", params: { code: failure.code, reason } };
  }
  return { key: "close.code", params: { code: failure.code } };
}
