// lib/i18n/language-pack-client.ts
//
// Thin authFetch wrappers over the runtime language-pack CGI, implemented by
// scripts/www/cgi-bin/quecmanager/system/language-packs/. All calls are
// cookie-authenticated (authFetch → 401 redirects to /login).
import { authFetch } from "@/lib/auth-fetch";
import type {
  InstalledPack,
  LanguageCode,
  LanguagePackInstallState,
  RemoteManifest,
} from "@/types/i18n";
import { parseManifest } from "./language-pack-manifest";

const CGI_BASE = "/cgi-bin/quecmanager/system/language-packs";

export interface LanguagePackListResponse {
  installed: InstalledPack[];
  manifest: RemoteManifest | null;
  manifest_error: string | null;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
}

function normalizeInstalled(raw: unknown): InstalledPack[] {
  if (!Array.isArray(raw)) return [];
  const out: InstalledPack[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.code !== "string") continue;
    out.push({
      code: r.code as LanguageCode,
      version: typeof r.version === "string" ? r.version : "",
      native_name: typeof r.native_name === "string" ? r.native_name : r.code,
      english_name: typeof r.english_name === "string" ? r.english_name : r.code,
      completeness: typeof r.completeness === "number" ? r.completeness : 0,
      namespaces: Array.isArray(r.namespaces)
        ? r.namespaces.filter((n): n is string => typeof n === "string")
        : [],
    });
  }
  return out;
}

// GET installed packs + remote manifest (fetched server-side, TLS to GitHub).
export async function fetchLanguagePackList(
  manifestUrl: string,
): Promise<LanguagePackListResponse> {
  const url = `${CGI_BASE}/list.sh?manifest_url=${encodeURIComponent(manifestUrl)}`;
  const resp = await authFetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const raw = await resp.json();
  const installed = normalizeInstalled(raw.installed);

  let manifest: RemoteManifest | null = null;
  let manifestError: string | null =
    typeof raw.manifest_error === "string" ? raw.manifest_error : null;
  if (raw.manifest && !manifestError) {
    const parsed = parseManifest(raw.manifest);
    if (parsed.ok) manifest = parsed.manifest;
    else manifestError = parsed.error;
  }
  return { installed, manifest, manifest_error: manifestError };
}

// POST → 202 {state:"pending"} or 409 {error:"install_in_progress"}.
export async function startLanguagePackInstall(
  code: LanguageCode,
  manifestUrl: string,
): Promise<MutationResult> {
  const resp = await authFetch(`${CGI_BASE}/install.sh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, manifest_url: manifestUrl }),
  });
  if (resp.status === 409) {
    return { ok: false, error: "install_in_progress" };
  }
  if (!resp.ok && resp.status !== 202) {
    const body = await resp.json().catch(() => ({}));
    return { ok: false, error: body.error || `http_${resp.status}` };
  }
  return { ok: true };
}

// GET live progress.
export async function getLanguagePackInstallStatus(): Promise<LanguagePackInstallState> {
  const resp = await authFetch(`${CGI_BASE}/install_status.sh`);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const raw = await resp.json();
  return {
    state: raw.state ?? "idle",
    code: typeof raw.code === "string" && raw.code ? raw.code : undefined,
    progress: typeof raw.progress === "number" ? raw.progress : 0,
    step: typeof raw.step === "string" ? raw.step : undefined,
    message: typeof raw.message === "string" ? raw.message : undefined,
    updated_at: typeof raw.updated_at === "number" ? raw.updated_at : undefined,
  };
}

export async function cancelLanguagePackInstall(): Promise<void> {
  const resp = await authFetch(`${CGI_BASE}/install_cancel.sh`, { method: "POST" });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
}

// POST → refuses bundled codes server-side; else removes from persistent store.
export async function removeLanguagePack(
  code: LanguageCode,
): Promise<MutationResult> {
  const resp = await authFetch(`${CGI_BASE}/remove.sh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    return { ok: false, error: body.error || `http_${resp.status}` };
  }
  return { ok: true };
}
