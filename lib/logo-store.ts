// =============================================================================
// logo-store.ts — fetched brand logos, kept in this browser
// =============================================================================
// Feeds `components/ui/brand-mark.tsx` (SMS sender discs and Sites tiles) for a
// domain that has no mapped glyph. The BROWSER fetches; the device never does.
//
// Ladder per domain, checked once and remembered in localStorage:
//   1. Hunter (`logos.hunter.io/<domain>`, 128px, CORS-open). The image is
//      redrawn to a small WebP on a canvas and the bytes are stored, so a known
//      logo paints on the first frame, offline too. Under 32px counts as none.
//   2. Google s2 favicon. Not CORS-readable, so only the verdict is stored and
//      the image comes from the browser's HTTP cache. 16px or less = no icon.
//   3. Neither: a miss. The caller shows its monogram.
//
// A stored verdict is never re-fetched until it expires (hit 30 days, miss 7
// days); a stale hit keeps showing while it is re-checked. A network error
// stores nothing, so the next visit tries again. Storage is capped; the oldest
// checks are dropped first.
//
// Privacy: the only thing that leaves the browser is the domain the caller
// passes (a curated SMS sender domain or a Sites host), never a sender ID or a
// number.
// =============================================================================

import { useEffect, useSyncExternalStore } from "react";

export type LogoEntry =
  /** Hunter logo, stored as a data URI. `sq`: roughly square, safe to fill a disc. */
  | { s: "h"; d: string; sq: boolean; a: number }
  /** Google s2 favicon verified (> 16px); load it by URL. */
  | { s: "g"; a: number }
  /** Checked: no logo anywhere. */
  | { s: "m"; a: number };

const STORAGE_KEY = "qm_logos_v2";
const MAX_ENTRIES = 200;
const DAY_MS = 86_400_000;
const HIT_TTL_MS = 30 * DAY_MS;
const MISS_TTL_MS = 7 * DAY_MS;
const MAX_IN_FLIGHT = 4;
const FETCH_TIMEOUT_MS = 8_000;

/** Stored size: covers a 40px disc at 3x. */
const STORE_PX = 128;
/** Hunter sometimes answers with a 16px favicon (pldt.com); upscaled it is a blur. */
const HUNTER_MIN_PX = 32;
/** Width/height within this band counts as square. */
const SQUARE_MIN = 0.8;
const SQUARE_MAX = 1.25;

const S2_PX = 64;
/** s2 answers an unknown domain with a 16px globe. */
const S2_MIN_PX = 17;

export function hunterUrl(domain: string): string {
  return `https://logos.hunter.io/${encodeURIComponent(domain)}`;
}

export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${S2_PX}`;
}

export function logoKey(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

// ---- persistence ------------------------------------------------------------

let entries: Map<string, LogoEntry> | null = null;
const listeners = new Set<() => void>();

function isEntry(v: unknown): v is LogoEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  if (typeof e.a !== "number") return false;
  if (e.s === "h") return typeof e.d === "string" && e.d.startsWith("data:image/");
  return e.s === "g" || e.s === "m";
}

function load(): Map<string, LogoEntry> {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isEntry(v)) entries.set(k, v);
      }
    }
  } catch {
    // Blocked or corrupt storage: start empty, everything gets checked again.
  }
  return entries;
}

function persist(map: Map<string, LogoEntry>): void {
  const sorted = [...map.entries()].sort((x, y) => y[1].a - x[1].a);
  const kept = sorted.slice(0, MAX_ENTRIES);
  // Quota: drop the oldest half until it fits (logos are a few KB each).
  for (let n = kept.length; n > 0; n = Math.floor(n / 2)) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept.slice(0, n))));
      return;
    } catch {
      // try smaller
    }
  }
}

function put(key: string, entry: LogoEntry): void {
  const map = load();
  map.set(key, entry);
  persist(map);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isFresh(e: LogoEntry): boolean {
  const ttl = e.s === "m" ? MISS_TTL_MS : HIT_TTL_MS;
  return Date.now() - e.a < ttl;
}

// ---- checking ---------------------------------------------------------------

const inFlight = new Set<string>();
const queue: string[] = [];
let running = 0;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

/** Hunter: an entry, `null` for a confirmed 404, or throws on a network fault. */
async function tryHunter(key: string): Promise<LogoEntry | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(hunterUrl(key), {
      signal: ctl.signal,
      referrerPolicy: "no-referrer",
      credentials: "omit",
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null;
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`hunter ${res.status}`);

  const url = URL.createObjectURL(await res.blob());
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    // Too small to draw well: treated like no Hunter logo, so s2 gets its turn.
    if (Math.max(w, h) < HUNTER_MIN_PX) return null;
    const scale = Math.min(1, STORE_PX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const d = canvas.toDataURL("image/webp", 0.85);
    const ratio = w / h;
    return { s: "h", d, sq: ratio >= SQUARE_MIN && ratio <= SQUARE_MAX, a: Date.now() };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function tryFavicon(key: string): Promise<LogoEntry> {
  try {
    const img = await loadImage(faviconUrl(key));
    if (img.naturalWidth >= S2_MIN_PX) return { s: "g", a: Date.now() };
  } catch {
    // s2 answers unknown domains with an image, so an error is a fault, not a miss.
    throw new Error("s2");
  }
  return { s: "m", a: Date.now() };
}

async function check(key: string): Promise<void> {
  try {
    const hunter = await tryHunter(key);
    put(key, hunter ?? (await tryFavicon(key)));
  } catch {
    // Network fault: store nothing, the next visit asks again.
  }
}

function pump(): void {
  while (running < MAX_IN_FLIGHT && queue.length > 0) {
    const key = queue.shift() as string;
    running += 1;
    void check(key).finally(() => {
      running -= 1;
      inFlight.delete(key);
      pump();
    });
  }
}

/** Queue a check unless the domain has a fresh verdict or one is under way. */
export function requestLogo(domain: string): void {
  if (typeof window === "undefined") return;
  const key = logoKey(domain);
  if (!key || inFlight.has(key)) return;
  const e = load().get(key);
  if (e && isFresh(e)) return;
  inFlight.add(key);
  queue.push(key);
  pump();
}

/** The stored verdict for `domain` (stale included), or null; checks it when due. */
export function useLogo(domain: string): LogoEntry | null {
  const key = logoKey(domain);
  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? (load().get(key) ?? null) : null),
    () => null,
  );
  useEffect(() => {
    if (key) requestLogo(key);
  }, [key]);
  return entry;
}
