// Web port helpers: build the new origin, wait for it, and move the browser there.
// The server restarts ~1 s after the save reply. A no-cors fetch resolves on any reply and rejects on a
// refused connection; Firefox keys certificate exceptions by host:port, so it can also reject on a working
// server. That is why a failed probe asks the OLD origin before giving up: if it still answers, the server
// rolled back; if not, the browser goes to the new origin anyway and shows its certificate prompt.

import { authFetch } from "@/lib/auth-fetch";
import { DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT } from "@/types/web-port";

const PROBE_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 1000;
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

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function probe(origin: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${origin}/?_qm=${Date.now()}`, {
      mode: "no-cors",
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Poll `origin` until it answers or `timeoutMs` passes, after `graceMs` for the old server to stop. */
export async function waitForOrigin(
  origin: string,
  { graceMs = 2500, timeoutMs = 20000 }: { graceMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  await sleep(graceMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(origin)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/** True when this page's own origin still serves QManager, i.e. the move did not happen. */
async function stillOnThisOrigin(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS * 2);
  try {
    const resp = await authFetch(ENDPOINT, { cache: "no-store", signal: ctrl.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Wait for `origin`, then open `origin + path`. Returns false (no navigation) only when the
 * old origin still answers, meaning the server stayed on, or rolled back to, the old ports.
 */
export async function followMove(
  origin: string,
  path: string,
  opts?: { graceMs?: number; timeoutMs?: number },
): Promise<boolean> {
  if (!(await waitForOrigin(origin, opts)) && (await stillOnThisOrigin())) return false;
  window.location.assign(`${origin}${path}`);
  return true;
}
