# Tailscale Install Log Viewer — Design

**Date:** 2026-04-10
**Status:** Approved
**Scope:** Small feature — one CGI endpoint extension, one new React component, one hook type extension

---

## Problem

During Tailscale installation, the user-facing UI shows a single stage message like "Installing Tailscale v1.92.5..." for the duration of the download. On slow cellular connections the `curl -O` download of the 29.1 MB tarball can take 2+ minutes. Users have no feedback indicating whether the process is actually downloading or has hung, and no way to tell whether they should keep waiting or abort.

The helper script already writes full stdout/stderr (including curl's progress output) to `/tmp/qmanager_tailscale_install.log` via `exec >> "$LOG_FILE" 2>&1` in the inner script. This data is available but invisible to anyone not SSH'd into the modem running `tail -f` on the log file.

## Goal

Show the live tail of the install log in the web UI underneath the install button, updating on the existing poll interval, so users see curl's byte-by-byte progress (and every other install stage) in a terminal-style panel as it happens.

## Non-Goals

- No download/uninstall log viewing — install only.
- No structured progress bar or percentage calculation — raw tail is sufficient.
- No log download button, no persistent log history, no ANSI color parsing.
- No separate polling loop — reuse the existing `install_status` 2-second poll.

---

## Architecture

### Data Flow

```
qmanager_tailscale_mgr (inner script)
    │ exec >> /tmp/qmanager_tailscale_install.log 2>&1
    ▼
/tmp/qmanager_tailscale_install.log   ← curl and echo output accumulate here
    ▲
    │ tail -n 50 | tr -d '\000\r'
    │
CGI: tailscale.sh (install_status action)
    │ returns JSON: {success, status, message, detail?, log}
    ▼
hooks/use-tailscale.ts (pollInstallStatus, every 2s while running)
    │ setInstallResult(json)
    ▼
components/monitoring/tailscale/tailscale-connection-card.tsx
    │ renders <InstallLogViewer log={installResult.log} /> when running
    ▼
components/monitoring/tailscale/install-log-viewer.tsx   ← NEW
    monospace <pre> with auto-scroll-to-bottom
```

Single request per poll. Zero new polling infrastructure.

### Why reuse `install_status`

The existing `pollInstallStatus` handler in `hooks/use-tailscale.ts:361` already runs every 2 seconds during an active install, already calls the CGI, and already passes the full response to `setInstallResult`. Adding a `log` field to the response is a pure-addition change that doesn't touch any polling or request logic.

---

## Backend Changes

**File:** `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh`

**Change:** Extend the `install_status` action (currently `cat "$INSTALL_RESULT"` or an idle stub) to merge a tailed log into the response JSON.

Current code at line 262:

```sh
if [ "$ACTION" = "install_status" ]; then
    if [ -f "$INSTALL_RESULT" ]; then
        cat "$INSTALL_RESULT"
    else
        printf '{"success":true,"status":"idle"}'
    fi
    exit 0
fi
```

Replacement:

```sh
if [ "$ACTION" = "install_status" ]; then
    INSTALL_LOG="/tmp/qmanager_tailscale_install.log"

    if [ -f "$INSTALL_RESULT" ]; then
        status_json=$(cat "$INSTALL_RESULT")
    else
        status_json='{"success":true,"status":"idle"}'
    fi

    if [ -f "$INSTALL_LOG" ]; then
        log_tail=$(tail -n 50 "$INSTALL_LOG" 2>/dev/null | tr -d '\000\r')
    else
        log_tail=""
    fi

    printf '%s' "$status_json" | jq --arg log "$log_tail" '. + {log: $log}'
    exit 0
fi
```

- Uses `jq --arg` for safe JSON string encoding (escapes quotes, backslashes, newlines automatically).
- `tr -d '\000\r'` strips NULs and any stray carriage returns curl may emit.
- `tail -n 50` caps the payload at roughly 3 KB — enough to show the last ~12 seconds of curl progress updates plus the header.
- Log file missing → empty string → UI renders an empty-state placeholder.

**No changes to `qmanager_tailscale_mgr`.** The inner script already redirects all output to the log file.

---

## Frontend Changes

### Hook type extension

**File:** `hooks/use-tailscale.ts`

Add a single optional field to the existing `InstallResult` interface at line 6:

```ts
interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
  log?: string;   // NEW — tailed contents of install log, server-truncated
}
```

No changes to `pollInstallStatus`, `runInstall`, or any other hook logic. `setInstallResult(json as unknown as InstallResult)` already passes the whole response through.

### New component

**File:** `components/monitoring/tailscale/install-log-viewer.tsx` (new)

Props:

```ts
interface InstallLogViewerProps {
  log: string;
  isRunning: boolean;
}
```

Behavior:
- Renders a fixed-height `<pre>` with `overflow-y-auto`.
- On every `log` change, auto-scrolls to bottom via a ref + `useEffect`.
- Header row: "Install log" label on the left, `Loader2Icon` spinner on the right while `isRunning`.
- Empty state (log empty and `isRunning`): dim "Waiting for output..." placeholder.
- No interactivity — not collapsible, not copyable, not resizable. Dumb viewer.

Styling (Tailwind):
- Container: `rounded-md border bg-zinc-950 text-zinc-200`
- Header: `flex items-center justify-between px-3 py-2 border-b border-zinc-800 text-xs font-medium text-zinc-400`
- Pre: `h-56 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre`

Dark background in both light and dark modes — this is a log viewer, not regular content; it should read visually as a terminal.

### Card integration

**File:** `components/monitoring/tailscale/tailscale-connection-card.tsx`

Inside the "not installed" branch of the card (near the install button area around line 248), add the log viewer below the existing alerts and button row:

```tsx
{(installResult.status === "running" ||
  (installResult.log && installResult.log.length > 0 &&
   (installResult.status === "complete" || installResult.status === "error"))) && (
  <InstallLogViewer
    log={installResult.log ?? ""}
    isRunning={installResult.status === "running"}
  />
)}
```

- Shown during running state so users see live progress.
- Kept visible for one render after complete/error so users see the final "installed successfully" line and can copy-paste error output into bug reports.
- Naturally unmounts when the card switches out of the "not installed" branch on the next `fetchStatus` poll after success.

---

## Edge Cases

| Case | Behavior |
|---|---|
| Log file doesn't exist yet (before install starts) | CGI returns `log: ""`; UI hides the viewer (status is `idle`) |
| Log file empty but install running | CGI returns `log: ""`; UI shows viewer with "Waiting for output..." placeholder |
| Log file very large (e.g. stuck process) | `tail -n 50` caps it server-side; no unbounded payload |
| Carriage returns from curl progress in TTY mode | `tr -d '\r'` strips them; each curl update becomes its own line |
| NUL bytes (unlikely, but defensive) | `tr -d '\000'` strips them |
| Install errors after partial download | Log keeps rendering with the final error line visible alongside the red alert |
| User navigates away mid-install | Component unmounts; polling stops via existing `stopInstallPolling`; log state discarded |
| Permissions (www-data reading root-owned log) | Log created with default umask 022 (mode 644); readable by all users |
| Concurrent reads during tail | `tail -n 50` is read-only; no locking needed |

---

## Testing

### Manual smoke tests (on device)

1. **Fresh install happy path** — trigger install from UI, verify curl progress lines appear in the log viewer within 2 seconds of starting, verify auto-scroll keeps the latest line visible, verify the final "installed successfully" line is briefly visible before the card switches to "installed" state.
2. **Slow-download simulation** — throttle the modem to ~100 KB/s (e.g. via `tc` or just a congested cellular link), verify curl progress updates tick by every few seconds, verify the UI doesn't feel frozen.
3. **Error path** — temporarily point `TAILSCALE_URL` at a bad domain, verify the curl failure output is visible in the log viewer alongside the red error alert.
4. **Empty log at poll start** — trigger install, immediately poll (before inner script writes anything), verify the "Waiting for output..." placeholder shows.
5. **Navigate away and back** — start install, switch tabs, come back mid-install, verify the log viewer shows current log (not stale or empty).

### No automated tests required

This is a UI wrapper around a log file tail. No business logic, no state machine, no data transformations worth mocking.

---

## Scope Boundaries

**In scope:**
- Extending `install_status` CGI response with `log` field
- New `InstallLogViewer` component
- Wiring the viewer into `tailscale-connection-card.tsx`

**Out of scope:**
- Refactoring `pollInstallStatus` or install flow
- Touching `qmanager_tailscale_mgr` (not needed — log already written)
- Adding log viewers for other features (uninstall, connect, etc.)
- Adding a "copy log" or "download log" button (can be added later if users ask)
- Adding a progress bar overlay on top of the log (was Approach B; rejected)
- Persisting log history across page reloads or installs

---

## File Manifest

| File | Change Type | Purpose |
|---|---|---|
| `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` | Modify | Extend `install_status` action to include tailed log |
| `hooks/use-tailscale.ts` | Modify | Add `log?: string` to `InstallResult` interface |
| `components/monitoring/tailscale/install-log-viewer.tsx` | Create | New log viewer component |
| `components/monitoring/tailscale/tailscale-connection-card.tsx` | Modify | Render `<InstallLogViewer />` below install button |
