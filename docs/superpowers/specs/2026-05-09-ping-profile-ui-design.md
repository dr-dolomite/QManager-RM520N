# Ping Profile UI + Carrier-Limited Badge + Poller Forwarding (Phase 2)

**Date:** 2026-05-09
**Status:** Draft (awaiting user review)
**Scope:** Frontend + CGI surface that exposes the Phase-1 Rust ping daemon's tri-state connectivity and profile-driven probe cadence to end users. New CGI endpoint, additive poller forwarding, two new frontend components, one modified component.
**Phase 1:** [`docs/superpowers/specs/2026-05-09-rust-ping-daemon-design.md`](./2026-05-09-rust-ping-daemon-design.md) — daemon contract this phase consumes.

## Problem

Phase 1 shipped the Rust ping daemon with two user-facing capabilities that have no UI:

1. **Profile-driven probe cadence** (`sensitive` / `regular` / `relaxed` / `quiet` — 1s / 2s / 5s / 10s probe intervals, with matching fail/recover/intercept thresholds). Today, switching profiles requires SSH plus a manual edit to `/etc/qmanager/ping_profile.json` and `touch /tmp/qmanager_ping_reload`. Users can't change probe sensitivity from the web UI.
2. **Tri-state connectivity** (`connected` / `limited` / `disconnected`). The poller forwards only the legacy `internet_available` boolean to `/tmp/qmanager_status.json`, so the frontend's Internet badge collapses `limited` (carrier intercept) into "Offline" — wrong, and lossy. Users with billing-blocked or activation-walled SIMs see "Offline" when their cellular link is fine.

Phase 2 surfaces both: a one-click profile picker on the System Settings page, and a third "Carrier Limited" state on the Network Status card's Internet badge.

## Goals

1. **Sensitivity card on System Settings** — four selectable presets, each immediately previewing its actual runtime thresholds. Save writes `/etc/qmanager/ping_profile.json` and pokes `/tmp/qmanager_ping_reload`. Streak counters survive the change (Phase 1 already guarantees this).
2. **Carrier Limited badge** — third state on the existing Internet badge, yellow with pulsating dot, tooltip naming the HTTP code seen and a short carrier-side hint.
3. **Additive poller forwarding** — extend `qmanager_poller`'s `read_ping_data` and the status.json `connectivity:` block to capture and emit `state`, `limited_reason`, `down_reason`, `streak_limited`. `internet_available` and every other existing field stay unchanged so watchcat / Discord bot / any other consumer keep working.

## Non-goals

- Daemon changes — out of scope. Phase 1 already produces and consumes the right contract.
- Custom-threshold UI (user-defined `interval_sec` / `fail_secs` / etc.). Power-user override stays via `/etc/qmanager/environment` env vars only — not exposed in UI. The daemon's `profile: "custom"` runtime state is invisible to the card.
- New diagnostic panels for `down_reason` / `streak_limited` / `tcp_reused`. The fields are forwarded so future work *can* consume them, but Phase 2 surfaces only what the badge needs.
- Watchcat, Discord bot, installer, sudoers — no changes.

## Background

### Phase 1 contract recap

- `/usr/bin/qmanager_ping` (Rust) writes `/tmp/qmanager_ping.json` on every cycle (atomic `.tmp` + `rename`). The schema is documented in the Phase 1 spec §5; the fields Phase 2 consumes are: `connectivity` (string tri-state), `limited_reason` (HTTP code, int|null), `down_reason` (string|null), `streak_limited` (int), `interval_sec`, `fail_secs`, `recover_secs`, `intercept_secs`, `profile` (string).
- `/etc/qmanager/ping_profile.json` holds the user-selected profile. Default file shipped by `install_ping_profile()` in `scripts/install_rm520n.sh:991`. Daemon reloads on `touch /tmp/qmanager_ping_reload`.
- `/etc/qmanager/` is `chown -R www-data:www-data` by the installer (`install_rm520n.sh:931`), so CGI scripts write directly without sudo.
- `qmanager_poller`'s `read_ping_data` (line 985) currently extracts only the backwards-compat fields from `qmanager_ping.json` and emits a `connectivity:` block in `/tmp/qmanager_status.json` (line 1576). The frontend's `useModemStatus` hook reads that file via the existing `home/status.sh` CGI. None of that pipeline changes shape — Phase 2 only adds keys.

### Frontend conventions this phase honors

From `CLAUDE.md`:
- **Status Badge Pattern** — `variant="outline"` + semantic color classes (`bg-warning/15 text-warning hover:bg-warning/20 border-warning/30`) + `size-3` lucide icons. Never solid badge variants.
- **CardHeader** — plain `CardTitle` + `CardDescription`. No icons in the header.
- **Primary action buttons** — default variant (not outline). Use the existing `SaveButton` from `components/ui/save-button.tsx` for save flows.
- **No fill bars** for non-data-viz UI. Loading uses `Loader2Icon` spinner; the segmented control uses ShadCN `ToggleGroup`.
- **OKLCH theme + 0.65rem radius** — inherited automatically through ShadCN tokens. Card layout matches the existing `SystemSettingsCard` density and spacing.

## Design

### Section 1 — Architecture

Three boundaries, all additive:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Frontend                                                             │
│ ┌─────────────────────────┐    ┌──────────────────────────────────┐  │
│ │ ConnectivitySensitivity │    │ NetworkStatusComponent           │  │
│ │ Card  (System Settings) │    │ (modified — Internet badge)      │  │
│ │  ↑ usePingProfile (new) │    │  ↑ useModemStatus (existing)     │  │
│ └────────────┬────────────┘    └────────────────┬─────────────────┘  │
│              │ GET/POST                          │ existing 5s poll  │
└──────────────┼──────────────────────────────────┼────────────────────┘
               ▼                                   ▼
   /cgi-bin/.../settings/ping_profile.sh   /cgi-bin/.../home/status.sh
   (NEW — reads/writes /etc/qmanager/      (existing — unchanged)
   ping_profile.json, touches reload flag)         ▲
               │                                    │ merges from
               ▼                                    │
   /etc/qmanager/ping_profile.json     /tmp/qmanager_status.json
                                       (built by qmanager_poller — additive jq fields)
                                                    ▲
                                                    │ reads from
                                            /tmp/qmanager_ping.json
                                            (Rust daemon — UNCHANGED)
```

**Touched files (Phase 2):**

| File | Change |
|---|---|
| `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh` | NEW |
| `scripts/usr/bin/qmanager_poller` | Modify — add 4 fields to `read_ping_data`'s `@tsv` extract and to the status.json `connectivity:` block |
| `types/modem-status.ts` | Modify — extend `ConnectivityStatus`, add `ConnectivityState` and `PingProfile` types |
| `hooks/use-ping-profile.ts` | NEW |
| `components/system-settings/connectivity-sensitivity-card.tsx` | NEW |
| `components/system-settings/system-settings.tsx` | Modify — add the new card to the existing 4-card grid |
| `components/dashboard/network-status.tsx` | Modify — replace 3-state Internet badge logic with 4-state (Online / Carrier Limited / Offline / Unknown) |
| `scripts/test/ping-profile-cgi.sh` | NEW — smoke harness |

**Untouched:** Rust daemon, watchcat, Discord bot, installer, sudoers, every other CGI, every other frontend component.

### Section 2 — CGI endpoint

`scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh` — pattern-perfect mirror of `scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh`.

**GET — fetch current profile:**

```json
{ "success": true, "settings": { "profile": "relaxed" } }
```

- Reads only `profile` from `/etc/qmanager/ping_profile.json` via `jq -r '.profile // "relaxed"'`.
- File missing → returns `{settings: {profile: "relaxed"}}` (matches installer default; UI shows Relaxed selected, no error).
- Malformed JSON → same fallback. Logged via `qlog_warn` only.

**Why GET returns only `profile`, not the thresholds:** thresholds are owned by the Rust daemon's `for_profile()` map. Returning them from the CGI would duplicate that map in shell — drift risk. The card's meta panel reads live runtime thresholds from `useModemStatus().connectivity` (the daemon's own runtime state), which is always correct even when env vars override.

**POST — save settings (single action):**

Request:
```json
{ "action": "save_settings", "profile": "regular" }
```

Validation:
- `action` must equal `"save_settings"` — anything else → `cgi_error "unknown_action"`.
- `profile` must be one of `"sensitive" | "regular" | "relaxed" | "quiet"` — anything else → `cgi_error "invalid_profile" "profile must be one of: sensitive, regular, relaxed, quiet"`.

Write:
- Atomic: `jq -n --arg profile "$new_profile" '{profile: $profile}' > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "$CONFIG"`.
- File contains only `{"profile": "<name>"}` — single source of truth for thresholds is the Rust daemon's `for_profile()`.
- After successful write: `touch "$RELOAD_FLAG"` (`/tmp/qmanager_ping_reload`).
- Returns `cgi_success` on success.

`mkdir -p /etc/qmanager` is called before the write (matches sms_alerts pattern; idempotent).

**Logging:** `qlog_info "Ping profile saved: $new_profile"` on success. The Rust daemon already logs `profile_changed: <old> → <new>` on reload, so the full chain is traceable end-to-end.

**Permissions:** none — `/etc/qmanager/` is www-data-owned by the installer. No sudoers changes.

**Error response shape (matches `cgi_error` helper):**
```json
{ "success": false, "error": "invalid_profile", "message": "profile must be one of: sensitive, regular, relaxed, quiet" }
```

### Section 3 — Poller forwarding (additive only)

Two surgical edits to `scripts/usr/bin/qmanager_poller`. Every existing field stays unchanged; every existing consumer (`watchcat`, `qmanager_discord`, any CGI reading `/tmp/qmanager_status.json`) keeps working.

**Edit A — `read_ping_data()` (around lines 1052-1067):**

Today's single-jq call returns 5 fields via `@tsv`. Add 8 more to the same call so the per-cycle cost stays one jq fork. Four are tri-state outcome fields; four are profile/threshold fields the card's meta panel needs:

```sh
_pdata=$(jq -r '[
    ((.reachable) | if . == null then "null" else tostring end),
    ((.last_rtt_ms) | if . == null then "null" else tostring end),
    ((.during_recovery) | if . == null then "false" else tostring end),
    ((.interval_sec) | if . == null then "5" else tostring end),
    (.targets[0] // ""),
    (.connectivity // "unknown"),                                          # NEW — tri-state
    ((.limited_reason) | if . == null then "null" else tostring end),      # NEW — HTTP code
    (.down_reason // "null"),                                               # NEW — disconnect reason
    ((.streak_limited) | if . == null then "0" else tostring end),         # NEW — limited streak
    (.profile // "unknown"),                                                # NEW — active profile
    ((.fail_secs) | if . == null then "0" else tostring end),              # NEW — runtime threshold
    ((.recover_secs) | if . == null then "0" else tostring end),           # NEW — runtime threshold
    ((.intercept_secs) | if . == null then "0" else tostring end)          # NEW — runtime threshold
] | @tsv' "$PING_CACHE" 2>/dev/null)
```

Then 8 new `cut -fN` lines populate `conn_connectivity`, `conn_limited_reason`, `conn_down_reason`, `conn_streak_limited`, `conn_profile`, `conn_fail_secs`, `conn_recover_secs`, `conn_intercept_secs`.

(The existing `conn_history_interval` already captures `interval_sec` — no need to forward it again under a second name. The card reuses `history_interval_sec` for its "Probe interval" display, or we rename in the type layer to `interval_sec` if you prefer. Spec defaults to reusing the existing field; type extension in §4a documents this.)

**Stale-data and missing-file paths:** the existing fall-back blocks (lines ~987 and ~1014) reset connectivity defaults. Phase 2 extends both to also reset the new fields:

```sh
conn_connectivity="unknown"
conn_limited_reason="null"
conn_down_reason="null"
conn_streak_limited=0
conn_profile="unknown"
conn_fail_secs=0
conn_recover_secs=0
conn_intercept_secs=0
```

This guarantees the badge falls back to muted "Internet" (the existing null look) whenever the daemon is dead or stuck — never a stale "Online" or wrong tri-state.

**Edit B — `connectivity:` block in the status.json builder (around lines 1576-1584):**

Add eight jq variable bindings (`--arg conn_state ...`, etc., matching the existing pattern) and eight new keys at the bottom of the block:

```jq
connectivity: {
    internet_available: $inet, status: $conn_st,
    latency_ms: $lat, avg_latency_ms: $avg_lat,
    min_latency_ms: $min_lat, max_latency_ms: $max_lat,
    jitter_ms: $jit, packet_loss_pct: $pkt_loss,
    ping_target: $ping_tgt, latency_history: $lat_hist,
    history_interval_sec: $hist_int, history_size: $hist_size,
    during_recovery: $during_rec,

    state: $conn_state,                       # NEW — tri-state string
    limited_reason: $conn_limited_reason,     # NEW — int|null
    down_reason: $conn_down_reason,           # NEW — string|null
    streak_limited: $conn_streak_limited,     # NEW — int
    profile: $conn_profile,                   # NEW — daemon's active profile string
    fail_secs: $conn_fail_secs,               # NEW — runtime threshold (int seconds)
    recover_secs: $conn_recover_secs,         # NEW — runtime threshold (int seconds)
    intercept_secs: $conn_intercept_secs      # NEW — runtime threshold (int seconds)
}
```

`limited_reason`, `fail_secs`, `recover_secs`, `intercept_secs` use `--argjson` (numeric); the other four use `--arg` (string).

**Field naming:** `state` (not `connectivity` recursively) since the field already lives inside the `connectivity` block — `connectivity.connectivity` reads awkwardly in TypeScript.

**Why forward `profile`, `fail_secs`, `recover_secs`, `intercept_secs`:** the Sensitivity card's meta panel needs the daemon's *runtime* threshold values (always correct, even when env vars override the saved profile). The Sensitivity card's "daemon stuck" footnote also compares saved-profile against runtime `profile` to detect a stuck daemon. Forwarding these from the existing `qmanager_ping.json` keeps the daemon as the single source of truth.

**Backwards compatibility:** `internet_available` keeps its existing meaning (`true` iff connected, `false` iff disconnected, `null` iff unknown). Watchcat, Discord bot, every other consumer keep working unchanged. The new `state` is the authoritative tri-state for the new frontend code.

**Verification (post-deploy, manual):**
```sh
ssh root@192.168.225.1 'jq .connectivity /tmp/qmanager_status.json'
```
Should show the eight new keys alongside existing fields.

### Section 4 — Frontend

#### 4a — Type extensions (`types/modem-status.ts`)

```ts
export type ConnectivityState =
  | "connected"
  | "limited"
  | "disconnected"
  | "unknown";

export interface ConnectivityStatus {
  internet_available: boolean | null;        // existing — unchanged
  status: string;                             // existing — unchanged
  // ... existing latency / jitter / history_interval_sec / history_size / during_recovery fields ...
  state: ConnectivityState | null;            // NEW — tri-state
  limited_reason: number | null;              // NEW — HTTP code (200, 302, etc.)
  down_reason: string | null;                 // NEW — "carrier_down" | "timeout" | "refused" | "reset" | "dns" | "malformed"
  streak_limited: number;                     // NEW — consecutive limited probes
  profile: string;                             // NEW — daemon's runtime profile ("sensitive"|"regular"|"relaxed"|"quiet"|"custom"|"unknown")
  fail_secs: number;                           // NEW — runtime fail threshold (seconds)
  recover_secs: number;                        // NEW — runtime recover threshold (seconds)
  intercept_secs: number;                      // NEW — runtime intercept threshold (seconds)
}

export type PingProfile = "sensitive" | "regular" | "relaxed" | "quiet";

export const PING_PROFILES: readonly PingProfile[] = [
  "sensitive",
  "regular",
  "relaxed",
  "quiet",
] as const;
```

The eight new `ConnectivityStatus` fields are non-optional (the poller always emits the keys, just with default values when ping data is stale/missing — `state: "unknown"`, `profile: "unknown"`, numeric thresholds: `0`, `limited_reason`/`down_reason`: `null`). The card treats threshold value `0` as "not yet known" and renders an em-dash placeholder; this happens only briefly at first boot or when the daemon is dead. Note that `profile` is typed as `string` (not `PingProfile`) because the daemon may report `"custom"` or `"unknown"` — UI compares the saved `PingProfile` against this string when rendering the daemon-stuck footnote.

The card's "Probe interval" display reuses the existing `history_interval_sec` field (already forwarded by the poller from `qmanager_ping.json`'s `interval_sec`) — see Section 3 Edit A note.

#### 4b — Hook (`hooks/use-ping-profile.ts`)

React Query (matches every other settings hook in the project — `useSystemSettings`, `useSmsAlerts`, etc.):

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-fetch";
import type { PingProfile } from "@/types/modem-status";

const ENDPOINT = "/cgi-bin/quecmanager/settings/ping_profile.sh";

interface PingProfileSettings { profile: PingProfile }
interface PingProfileResponse { success: boolean; settings?: PingProfileSettings; error?: string; message?: string }

export function usePingProfile() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["ping-profile"],
    queryFn: async (): Promise<PingProfileSettings> => {
      const res = await authFetch(ENDPOINT);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PingProfileResponse = await res.json();
      if (!json.success || !json.settings) throw new Error(json.message ?? "Failed to load profile");
      return json.settings;
    },
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (profile: PingProfile) => {
      const res = await authFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", profile }),
      });
      const json: PingProfileResponse = await res.json();
      if (!json.success) throw new Error(json.message ?? json.error ?? "Save failed");
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ping-profile"] }),
  });

  return {
    profile: query.data?.profile,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    isSaving: mutation.isPending,
    saveError: mutation.error?.message ?? null,
    save: mutation.mutateAsync,
  };
}
```

Uses `authFetch` (existing project helper) for cookie-auth headers. No optimistic update — mutation invalidates and refetches; saves are <200ms typical, no rollback complexity.

#### 4c — Card component (`components/system-settings/connectivity-sensitivity-card.tsx`)

Layout: ShadCN `ToggleGroup` (`type="single"`, 4 items) + meta panel + `SaveButton`. Mirrors the structure of `SystemSettingsCard`:

```tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangleIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { motion, type Variants } from "motion/react";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { usePingProfile } from "@/hooks/use-ping-profile";
import { useModemStatus } from "@/hooks/use-modem-status";
import { PING_PROFILES, type PingProfile } from "@/types/modem-status";

const PROFILE_META: Record<PingProfile, { label: string; blurb: string; intervalLabel: string }> = {
  sensitive: { label: "Sensitive", blurb: "Fastest UI feedback. Best for hardwired or strong-signal setups.", intervalLabel: "1s" },
  regular:   { label: "Regular",   blurb: "Balanced default. Good for most users.",                          intervalLabel: "2s" },
  relaxed:   { label: "Relaxed",   blurb: "Conservative. Matches the previous QManager default.",            intervalLabel: "5s" },
  quiet:     { label: "Quiet",     blurb: "Battery and data conscious. Slowest reaction time.",              intervalLabel: "10s" },
};
```

Component behavior:
- **Local state for selection** (`selected: PingProfile`) initialized from the saved `profile` from the hook.
- **Dirty detection**: `selected !== savedProfile`. Save button enabled only when dirty and `!isSaving`.
- **Meta panel below the toggle:** reads `useModemStatus().connectivity` for live runtime threshold values forwarded by the poller from the Rust daemon's `qmanager_ping.json` (Section 3). Renders three small key/value pairs:
  - "Probe interval" — `{history_interval_sec}s` (existing field — already forwarded; same value as the daemon's `interval_sec`)
  - "Fail threshold" — `{fail_secs}s` (NEW field per Section 3)
  - "Recover after" — `{recover_secs}s` (NEW field per Section 3)
  - When any value is `0` (daemon dead/stale fallback), render an em-dash placeholder (`—s`).
- **Loading skeleton** when `isLoading` (matches the `system-settings-card.tsx` skeleton block).
- **Error variant**: when GET fails, render `Alert variant="destructive"` with `AlertTriangleIcon` (matches the existing pattern at `system-settings-card.tsx:135`).
- **Save handler**: calls `save(selected)`; on success, `markSaved()` + `toast.success("Sensitivity profile updated")`; on error, `toast.error(e.message)`.
- **Daemon-stuck footnote** (per design discussion): if 30 seconds have passed since `markSaved()` and the runtime profile from `useModemStatus` still doesn't match the saved profile, render a muted footnote: *"Daemon hasn't picked up the change yet — check `systemctl status qmanager-ping` if this persists."* Implemented via a `useEffect` that captures `Date.now()` on save and compares against runtime `data?.connectivity?.profile` (forwarded by the poller — present once the daemon's next cycle writes it). State clears once runtime catches up or the user picks a different profile.
- **Animation**: same `motion.div` stagger pattern as `SystemSettingsCard` (containerVariants + itemVariants).

CardHeader stays clean: `<CardTitle>Connectivity Sensitivity</CardTitle>` + `<CardDescription>How aggressively the modem checks if your internet is working.</CardDescription>` — no icons.

#### 4d — Network Status badge update (`components/dashboard/network-status.tsx`)

Replace the existing 3-state internet badge logic (currently around lines 254-282, driven by `internetAvailable: boolean | null`) with a 4-state computation driven by `connectivity?.state`.

New helper at the top of the file (alongside the existing `getServiceColor` etc. helpers):

```tsx
function buildInternetBadge(c: ConnectivityStatus | null) {
  const state: ConnectivityState = c?.state ?? "unknown";

  switch (state) {
    case "connected":
      return {
        cls: "bg-success/15 text-success hover:bg-success/20 border-success/30",
        dot: "pulse-green",
        label: "Online",
        tooltip: null,
      };
    case "limited":
      return {
        cls: "bg-warning/15 text-warning hover:bg-warning/20 border-warning/30",
        dot: "pulse-yellow",
        label: "Carrier Limited",
        tooltip: limitedTooltip(c?.limited_reason ?? null),
      };
    case "disconnected":
      return {
        cls: "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30",
        dot: "static-red",
        label: "Offline",
        tooltip: downTooltip(c?.down_reason ?? null),
      };
    default:
      return {
        cls: "bg-muted/50 text-muted-foreground hover:bg-muted/70 border-muted-foreground/30",
        dot: "static-grey",
        label: "Internet",
        tooltip: null,
      };
  }
}

function limitedTooltip(code: number | null): string {
  if (code === null) return "Carrier is intercepting probes — billing or activation page likely.";
  if (code >= 300 && code < 400) return `Carrier is redirecting probes (HTTP ${code}). Likely walled-garden or activation page.`;
  if (code >= 400) return `Carrier returned HTTP ${code}. Probe path is intercepted but not by a redirect.`;
  return `Network reachable but probe returned HTTP ${code}, not 204. Carrier may be redirecting traffic to a billing or activation page.`;
}

function downTooltip(reason: string | null): string {
  switch (reason) {
    case "carrier_down":  return "Cellular carrier link is down (sysfs reports no carrier).";
    case "timeout":       return "Probe timed out — connection may be stalled.";
    case "refused":       return "Connection refused by probe target.";
    case "reset":         return "Connection reset by carrier or peer.";
    case "dns":           return "DNS resolution failed.";
    case "malformed":     return "Probe response was malformed.";
    default:              return "Internet unreachable.";
  }
}
```

The badge JSX uses ShadCN `Tooltip` only when `tooltip !== null`:

```tsx
{tooltip ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <Badge variant="outline" className={cls}>
        <Dot variant={dot} />
        {label}
      </Badge>
    </TooltipTrigger>
    <TooltipContent>{tooltip}</TooltipContent>
  </Tooltip>
) : (
  <Badge variant="outline" className={cls}>
    <Dot variant={dot} />
    {label}
  </Badge>
)}
```

`Dot` is a tiny inline component for the pulsating-green / pulsating-yellow / static-red / static-grey state (extracted from the existing inline JSX in `network-status.tsx:265-276`).

**Backwards-compat fallback:** when `c?.state` is `undefined` (shouldn't happen in production since Phase 1 already shipped, but defends against rolling-upgrade ordering), the helper falls into `"unknown"` and the badge shows the muted "Internet" look — same behavior as today's `internetAvailable === null` path.

#### 4e — System Settings page (`components/system-settings/system-settings.tsx`)

One-line addition. The existing 4-card grid wraps cleanly at `@3xl/main:grid-cols-2`:

```tsx
<div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
  <SystemSettingsCard {...hookData} />
  <ScheduledOperationsCard {...hookData} />
  <SSHPasswordCard />
  <ModemSubsystemCard />
  <ConnectivitySensitivityCard /> {/* NEW */}
</div>
```

### Section 5 — Error handling and edge cases

**CGI-side:**
- Missing or malformed `/etc/qmanager/ping_profile.json` on GET → returns default `{settings: {profile: "relaxed"}}`. UI renders Relaxed selected, no error toast. `qlog_warn` once.
- Invalid `profile` value on POST → `cgi_error "invalid_profile"`. UI shows error toast.
- `jq` write fails (disk full, etc.) → `cgi_error "write_failed"`. No `.tmp` left behind (atomic write pattern). Reload flag not touched.
- `touch` of reload flag fails → ignored, logged as `qlog_warn`. /tmp is tmpfs; in practice never fails.

**Hook-side:**
- GET fails → React Query error state; card renders error variant.
- POST fails → `toast.error` with server message; selection stays dirty; user can retry.
- No optimistic update — mutation invalidates + refetches.

**Daemon edge cases (UI-side):**
- Daemon stopped / `qmanager_ping.json` missing → poller forwards `state: "unknown"` and threshold values `0`. Badge shows muted "Internet". Card meta panel renders "—" placeholders (driven by `data?.connectivity?.fail_secs === 0` etc., per Section 4c).
- Daemon stale (>10s old per existing poller threshold) → poller already nukes the connectivity block to defaults; same fallback as above.
- Daemon reports `profile: "custom"` (env var override) → ignored by the card. Saved profile from `/etc/qmanager/ping_profile.json` is shown selected.
- **Daemon stuck (saves succeed but daemon doesn't reload)** — 30s after a successful save, if `data?.connectivity?.profile !== savedProfile`, render the diagnostic footnote on the card. Honest about the state without big modal noise.

**Cross-consumer compatibility:**
- `internet_available` field is unchanged — watchcat, Discord bot, all other consumers keep working.
- New fields are purely additive.
- Quick post-deploy regression check: `journalctl -u qmanager-watchcat --since "5 minutes ago" | grep -i "internet\|recovery\|state"` should look identical to pre-Phase-2 behavior.

### Section 6 — Testing

#### 6.1 — CGI smoke test (`scripts/test/ping-profile-cgi.sh`)

POSIX sh, jq for assertions, runs against the device or local httpd. Validates GET, all four valid profiles via POST (file write + reload-flag), invalid profile rejection, missing-action rejection. Sanity check before flashing — not a CI gate (matches project convention).

#### 6.2 — Daemon regression check

`cd ping-daemon && cargo test --target=<host>` — should be a no-op (no Rust changes). Fast-fails the plan if anything Phase-2 work accidentally breaks the Phase-1 test suite.

#### 6.3 — Poller forwarding manual verification

```sh
ssh root@192.168.225.1 'jq .connectivity /tmp/qmanager_status.json'
```

Confirms the four new keys (`state`, `limited_reason`, `down_reason`, `streak_limited`) appear in the connectivity block alongside existing fields.

#### 6.4 — Frontend manual UAT

Per CLAUDE.md "test the UI in a browser" rule:

1. `bun build` succeeds with no type errors.
2. Load System Settings, verify Connectivity Sensitivity card renders with current profile selected and correct runtime thresholds in the meta panel.
3. Pick each of the 4 profiles, click Save, verify toast appears, verify (via SSH) `/etc/qmanager/ping_profile.json` updated and `/tmp/qmanager_ping_reload` exists.
4. Within ~10s, verify the card's runtime thresholds in the meta panel reflect the new profile.
5. Trigger Limited state (most reliable: edit `/etc/qmanager/environment` to set `PING_TARGET_1=http://example.com/`, restart `qmanager-ping.service`). After `intercept_secs` cycles, verify the Network Status card's Internet badge flips to yellow "Carrier Limited" with hover tooltip showing HTTP 200.
6. Restore real targets, verify badge returns to green "Online".

If Limited can't be triggered live, the spec acceptance call-out is "test fixture documented; verified by reviewer."

### Section 7 — Migration / rollout

No installer changes. No database migrations. No lockstep deploy with Phase 1 — Phase 2 ships standalone on top of Phase 1, no shared state.

**Rollout order in a single release tarball:**
1. Backend changes (CGI + poller + smoke harness) deploy first; they're inert until the frontend exists.
2. Frontend ships alongside; reads the new `connectivity.state` field if present, falls back to muted "Internet" if missing.

If the device is on Phase 1 without Phase 2, nothing breaks — the daemon already emits the new fields, the poller forward is the only new producer, and old frontend reads only `internet_available`. Forward order: poller before frontend, so new frontend on a poller without the forwarding still falls back to muted "Internet" gracefully.

## Success criteria

1. User loads `/system-settings`, sees the Connectivity Sensitivity card with the current profile selected and the runtime thresholds in the meta panel.
2. User picks a different profile, clicks Save. `/etc/qmanager/ping_profile.json` is written atomically, `/tmp/qmanager_ping_reload` is touched. Toast confirms success.
3. Within ~10s of save, the daemon reloads (Phase 1 guarantee), the poller picks up the new runtime values, and the card's meta panel reflects the new profile's thresholds.
4. When the daemon reports `connectivity == "limited"`, the Network Status card's Internet badge shows yellow "Carrier Limited" with a tooltip describing the HTTP code seen.
5. `/tmp/qmanager_status.json` carries the eight new connectivity fields (`state`, `limited_reason`, `down_reason`, `streak_limited`, `profile`, `fail_secs`, `recover_secs`, `intercept_secs`). All existing fields are unchanged in shape and value.
6. `cargo test` in `ping-daemon/` passes (no daemon code changed; should be a no-op).
7. `scripts/test/ping-profile-cgi.sh` passes against the device.
8. Watchcat, Discord bot, and other `internet_available` consumers behave identically before and after Phase 2 — verified by spot-checking 5 minutes of `journalctl` output post-deploy.

## Open questions

None at spec time. Defer to writing-plans for any task-level clarifications.

## References

- Phase 1 spec: `docs/superpowers/specs/2026-05-09-rust-ping-daemon-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-05-09-rust-ping-daemon.md`
- CGI precedent: `scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh`
- Card precedent: `components/system-settings/system-settings-card.tsx` (loading skeleton, error variant, SaveButton + dirty detection, motion stagger)
- Hook precedent: `hooks/use-system-settings.ts` (React Query, `authFetch`, mutation invalidation)
- Network Status badge: `components/dashboard/network-status.tsx` (3-state Internet badge being upgraded to 4-state)
- Poller forwarding entry points: `scripts/usr/bin/qmanager_poller:985` (`read_ping_data`), `:1576` (status.json `connectivity:` block)
- Rust daemon profile map: `ping-daemon/src/config.rs:32` (`for_profile`)
- Project memory: `feedback_bun_not_npx.md` (build via `bun build`)
- Design conventions: `CLAUDE.md` — Status Badge Pattern, UI Component Conventions
