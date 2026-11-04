// Web port helpers: follow the apply's result and move the browser to the new origin.
// The CGI's `Access-Control-Allow-Origin: *` blocks a cookie read from another port, so other origins get a no-cors probe.

import { authFetch } from "@/lib/auth-fetch";
import type { WebPortLastResult, WebPortResponse } from "@/types/web-port";
import { DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT } from "@/types/web-port";

const PROBE_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 1000;
// apply: 1 s + up to three lighttpd restarts with a 10 s listen wait each (~35 s), plus slack.
const SETTLE_MS = 45000;
const MAX_WAIT_MS = 60000;
// A follow that starts late (onboarding's Done) still looks for this long.
const MIN_LOOK_MS = 10000;
const ENDPOINT = "/cgi-bin/quecmanager/system/web_port.sh";

/** The origin this page would have on the given ports (same protocol). */
export function originForPorts(httpPort: number, httpsPort: number): string {
  const { protocol, hostname } = window.location;
  const https = protocol === "https:";
  const port = https ? httpsPort : httpPort;
  const isDefault = port === (https ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT);
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${protocol}//${host}${isDefault ? "" : `:${port}`}`;
}

/** A saved move the browser has not followed yet. */
export interface PendingMove {
  origin: string;
  /** `Date.now()` when the save returned. */
  startedAt: number;
}

export type MoveOutcome =
  | { kind: "navigated" }
  /** The server stayed on, or went back to, `origin`. */
  | { kind: "rolled_back"; origin: string }
  /** No final result within the bound. */
  | { kind: "timeout" }
  /** The caller's signal fired; nothing was done. */
  | { kind: "aborted" };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const sameOrigin = (a: string, b: string) => new URL(a).origin === new URL(b).origin;

async function probe(origin: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    // no-cors requires redirect "follow"; "manual" made every probe throw.
    await fetch(`${origin}/?_qm=${Date.now()}`, {
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/** This origin's last apply result: the result (or null), or undefined when this origin is down. */
async function readResult(): Promise<WebPortLastResult | null | undefined> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS * 2);
  try {
    const resp = await authFetch(ENDPOINT, { cache: "no-store", signal: ctrl.signal });
    if (!resp.ok) return undefined;
    const json: WebPortResponse = await resp.json();
    return json.success ? (json.last_result ?? null) : undefined;
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Follow a saved move to `target`, then open `target + path`. Navigates only once the apply
 * reports `applied` or the target answers; a rollback or a stalled apply leaves the page in place.
 */
export async function followMove(
  target: string,
  path: string,
  { startedAt = Date.now(), signal }: { startedAt?: number; signal?: AbortSignal } = {},
): Promise<MoveOutcome> {
  const here = window.location.origin;
  const fallback = originForPorts(DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT);
  const deadline = Math.max(startedAt + MAX_WAIT_MS, Date.now() + MIN_LOOK_MS);
  const ABORTED: MoveOutcome = { kind: "aborted" };
  const go = (): MoveOutcome => {
    if (signal?.aborted) return ABORTED;
    window.location.assign(`${target}${path}`);
    return { kind: "navigated" };
  };

  while (Date.now() < deadline) {
    if (signal?.aborted) return ABORTED;
    const result = await readResult();
    if (signal?.aborted) return ABORTED;
    // `set` writes `pending` before the save replies, so any final status read now is this move's.
    if (result && result.status !== "pending") {
      const landed = originForPorts(result.http_port, result.https_port);
      if (result.status === "applied" && sameOrigin(landed, target)) return go();
      return { kind: "rolled_back", origin: here };
    }
    // lighttpd binds every socket or none, so a new origin that answers is the applied config.
    if (!sameOrigin(target, here) && (await probe(target))) return go();
    if (result === undefined) {
      if (!sameOrigin(fallback, here) && !sameOrigin(fallback, target) && (await probe(fallback))) {
        return signal?.aborted ? ABORTED : { kind: "rolled_back", origin: fallback };
      }
      // Nothing else answers once a rollback would have finished: the target is up but its
      // certificate blocks the probe (Firefox keys exceptions by host:port).
      if (!sameOrigin(target, here) && Date.now() - startedAt >= SETTLE_MS) return go();
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (!sameOrigin(target, here) && (await readResult()) === undefined) return go();
  return signal?.aborted ? ABORTED : { kind: "timeout" };
}
