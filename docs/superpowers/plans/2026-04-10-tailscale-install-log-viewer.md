# Tailscale Install Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the live tail of `/tmp/qmanager_tailscale_install.log` in the Tailscale install card so users see curl download progress instead of a static "Installing..." label.

**Architecture:** Extend the existing `install_status` CGI action to merge a 50-line log tail into its JSON response. Frontend adds a single optional field to the `InstallResult` type, a small terminal-styled `InstallLogViewer` component with auto-scroll-to-bottom, and a conditional render below the install button. Reuses the existing 2-second `pollInstallStatus` loop — no new polling infrastructure.

**Tech Stack:** Bash + jq (CGI), TypeScript, React 19, Tailwind v4, shadcn/ui primitives, lucide-react icons, Next.js 15 app router.

**Testing strategy:** This codebase has no test runner (package.json has only `lint` and `build`). Validation loop for each task is:
- TypeScript: `bunx tsc --noEmit` — must pass with zero errors
- Lint: `bun run lint` — must pass with zero errors
- Shell: `bash -n <file>` — must pass syntax check
- Final build: `bun run build` — must succeed
- Manual smoke test on device (after deployment) — detailed in Task 5

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` | Extend `install_status` POST action to merge log tail into JSON response | Modify lines 262–269 |
| `hooks/use-tailscale.ts` | Add `log?: string` to `InstallResult` interface | Modify line 6 |
| `components/monitoring/tailscale/install-log-viewer.tsx` | New component: terminal-styled scrollable log viewer with auto-scroll-to-bottom | Create |
| `components/monitoring/tailscale/tailscale-connection-card.tsx` | Render `<InstallLogViewer />` below install button in the "not installed" branch | Modify around lines 246–247 |

---

## Task 1: Backend — Extend `install_status` with log tail

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh:262-269`

- [ ] **Step 1: Read the current action handler for context**

Read lines 258–272 of `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` to confirm the exact code being replaced. The current block is:

```sh
    # -------------------------------------------------------------------------
    # action: install_status — poll install progress
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_status" ]; then
        if [ -f "$INSTALL_RESULT" ]; then
            cat "$INSTALL_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi
```

- [ ] **Step 2: Apply the edit**

Replace that block with:

```sh
    # -------------------------------------------------------------------------
    # action: install_status — poll install progress + live log tail
    # -------------------------------------------------------------------------
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

Key points:
- `INSTALL_LOG` path matches the helper script (`qmanager_tailscale_mgr` writes here via `exec >> "$LOG_FILE" 2>&1`).
- `jq --arg` safely JSON-encodes the log string (handles quotes, backslashes, newlines, unicode).
- `tr -d '\000\r'` strips NULs and any carriage returns curl may emit in TTY-detected output.
- `tail -n 50` caps the payload at roughly 3 KB — enough for the last ~10 seconds of curl progress updates plus the inner script's header lines.
- `2>/dev/null` on `tail` suppresses any transient "file truncated" warnings that could happen mid-install.

- [ ] **Step 3: Syntax check**

Run: `bash -n scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh`
Expected: no output, exit 0.

- [ ] **Step 4: Lint (best-effort) — verify no stray shellcheck issues if available**

Run: `shellcheck scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh 2>/dev/null || echo "shellcheck not installed, skipping"`
Expected: either clean output or the skip message. Not a blocker if shellcheck isn't installed locally.

- [ ] **Step 5: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
git commit -m "feat(tailscale): include install log tail in install_status CGI response"
```

---

## Task 2: Frontend — Add `log` field to `InstallResult` interface

**Files:**
- Modify: `hooks/use-tailscale.ts:6-11`

- [ ] **Step 1: Read the current interface for context**

Read lines 1–15 of `hooks/use-tailscale.ts` to confirm the exact interface shape. Current:

```ts
interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
}
```

- [ ] **Step 2: Apply the edit**

Add a single optional `log` field:

```ts
interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
  log?: string;
}
```

No other changes to this file. The existing `pollInstallStatus` at line 361 already does `setInstallResult(json as unknown as InstallResult)` — the whole JSON response is passed through, so the new field is automatically populated.

- [ ] **Step 3: Type check**

Run: `bunx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-tailscale.ts
git commit -m "feat(tailscale): add log field to InstallResult interface"
```

---

## Task 3: Create `InstallLogViewer` component

**Files:**
- Create: `components/monitoring/tailscale/install-log-viewer.tsx`

- [ ] **Step 1: Verify the target directory exists and check sibling components for patterns**

Run: `ls components/monitoring/tailscale/`
Expected: see `tailscale-connection-card.tsx` (and possibly others).

- [ ] **Step 2: Create the component file**

Write this exact content to `components/monitoring/tailscale/install-log-viewer.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface InstallLogViewerProps {
  log: string;
  isRunning: boolean;
}

export function InstallLogViewer({ log, isRunning }: InstallLogViewerProps) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = preRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log]);

  const showPlaceholder = isRunning && log.trim().length === 0;

  return (
    <div className="w-full rounded-md border border-zinc-800 bg-zinc-950 text-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-400">Install log</span>
        {isRunning && (
          <Loader2 className="size-3.5 animate-spin text-zinc-400" />
        )}
      </div>
      <pre
        ref={preRef}
        className="h-56 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre text-left"
      >
        {showPlaceholder ? (
          <span className="text-zinc-500">Waiting for output...</span>
        ) : (
          log
        )}
      </pre>
    </div>
  );
}
```

Key points:
- `"use client"` directive required — uses `useRef` and `useEffect`.
- `useEffect` deps on `log` only — scrolls to bottom on every log update.
- Fixed `h-56` height (~14 lines) plus `overflow-y-auto` gives a consistent viewport.
- `whitespace-pre` preserves the monospace alignment of curl's tabular progress output.
- `text-left` overrides the parent's `items-center` flex alignment that the install card uses.
- Dark background in both light and dark modes — intentional, reads as a terminal.
- No interactivity: not collapsible, not copyable, not resizable. Dumb viewer.
- Empty state handled inline, not as a separate component.

- [ ] **Step 3: Type check**

Run: `bunx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Lint**

Run: `bun run lint`
Expected: exit 0, no errors or warnings about the new file.

- [ ] **Step 5: Commit**

```bash
git add components/monitoring/tailscale/install-log-viewer.tsx
git commit -m "feat(tailscale): add InstallLogViewer component"
```

---

## Task 4: Wire `InstallLogViewer` into the Tailscale connection card

**Files:**
- Modify: `components/monitoring/tailscale/tailscale-connection-card.tsx` (import near top, render inside "not installed" branch around line 246–247)

- [ ] **Step 1: Add the import**

Find the existing `import type { UseTailscaleReturn } from "@/hooks/use-tailscale";` line (around line 46). Add the new import directly above it:

```tsx
import { InstallLogViewer } from "@/components/monitoring/tailscale/install-log-viewer";
import type { UseTailscaleReturn } from "@/hooks/use-tailscale";
```

- [ ] **Step 2: Add the conditional render in the "not installed" branch**

Locate the "not installed" branch around lines 232–247. The current code ends the error alert block with:

```tsx
            {installResult.status === "error" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p>
                    {installResult.message}
                    {installResult.detail && (
                      <span className="block text-xs mt-1 opacity-80">
                        {installResult.detail}
                      </span>
                    )}
                  </p>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={runInstall}
```

Insert the log viewer between the error alert block and the button row. The final shape should be:

```tsx
            {installResult.status === "error" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p>
                    {installResult.message}
                    {installResult.detail && (
                      <span className="block text-xs mt-1 opacity-80">
                        {installResult.detail}
                      </span>
                    )}
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {(installResult.status === "running" ||
              ((installResult.status === "complete" ||
                installResult.status === "error") &&
                !!installResult.log &&
                installResult.log.length > 0)) && (
              <InstallLogViewer
                log={installResult.log ?? ""}
                isRunning={installResult.status === "running"}
              />
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={runInstall}
```

Rendering logic:
- `running` → always show the viewer (possibly with the "Waiting for output..." placeholder).
- `complete` or `error` **and** `log` present → keep the viewer visible so users see the final line (success banner) or the error context (for bug reports).
- `idle` or empty log on complete/error → hide the viewer.
- The viewer naturally unmounts on the next `fetchStatus` poll after successful install when the card switches out of the "not installed" branch.

- [ ] **Step 3: Type check**

Run: `bunx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Lint**

Run: `bun run lint`
Expected: exit 0, no errors.

- [ ] **Step 5: Full build sanity check**

Run: `bun run build`
Expected: successful build with no errors. The Tailscale page (`/monitoring/tailscale` or wherever `TailscaleConnectionCard` is mounted) should be listed in the build output as a static or dynamic route with no render errors.

- [ ] **Step 6: Commit**

```bash
git add components/monitoring/tailscale/tailscale-connection-card.tsx
git commit -m "feat(tailscale): render InstallLogViewer during install in connection card"
```

---

## Task 5: On-device smoke test

**Files:**
- None (manual testing on the modem)

**Prerequisite:** Build and deploy the updated frontend tarball + scripts to the RM520N-GL device. The user handles tarball building themselves (`bun run build` → package `out/` + `scripts/` into a tarball, SCP to device, run the installer update path). This task is the acceptance checklist the user runs after deployment.

- [ ] **Step 1: Fresh-install happy path**

1. On the device, ensure Tailscale is NOT installed: `sudo qmanager_tailscale_mgr uninstall` (ignore errors if it was never installed).
2. Open the web UI in a browser → navigate to **Monitoring > Tailscale VPN**.
3. Click the **Install Tailscale** button.
4. Within 2 seconds, the log viewer panel should appear below the button and show:
   - The `=== qmanager_tailscale_mgr — install started ===` header
   - `Version: 1.92.5`, `Arch: arm`, `URL: ...`, `Target: /usrdata/tailscale`
   - `Creating directories...`
   - `Downloading tailscale_1.92.5_arm.tgz...`
5. Verify the curl progress lines advance every few seconds (e.g. `3 29.1M    3  930k` → `10 29.1M   10 3057k` → ...).
6. Verify the panel auto-scrolls to the bottom as new lines arrive.
7. After download completes, verify you see `Extracting...`, `Setting permissions...`, `Installing systemd units...`, `Starting Tailscale daemon...`, and finally `=== Tailscale v1.92.5 installed successfully ===`.
8. Shortly after the success line, the card should switch out of the "not installed" state and show the connected/stopped state instead (the viewer unmounts at this point).

Expected: all of the above visible in the browser with no layout glitches, no console errors, no broken auto-scroll.

- [ ] **Step 2: Slow-download verification**

Either repeat the fresh install on a deliberately congested cellular link, or before triggering the install inject artificial latency:

```sh
# On device, before clicking Install in the UI:
sudo tc qdisc add dev rmnet_data1 root tbf rate 100kbit burst 32kbit latency 400ms 2>/dev/null || true
```

(Replace `rmnet_data1` with your actual data interface if different.)

Click Install, verify the log viewer shows curl progress ticking slowly but consistently (no stalls longer than ~5 seconds between updates). Confirm the user would have confidence the process is alive.

Remove the rate limit after:

```sh
sudo tc qdisc del dev rmnet_data1 root 2>/dev/null || true
```

Expected: viewer remains responsive throughout a 5+ minute slow download.

- [ ] **Step 3: Error path verification**

Temporarily break DNS resolution or unplug the SIM before clicking Install, so curl fails:

1. On the device: `sudo iptables -I OUTPUT -d pkgs.tailscale.com -j DROP` (blocks the Tailscale CDN).
2. Uninstall: `sudo qmanager_tailscale_mgr uninstall`.
3. In the UI, click **Install Tailscale**.
4. Wait up to 2 minutes for curl to time out.
5. Verify the card shows the red error alert AND the log viewer remains visible with the curl failure output (e.g. `curl: (6) Could not resolve host` or `curl: (7) Failed to connect`).
6. Verify you can copy-paste the log contents for a bug report.
7. Restore: `sudo iptables -D OUTPUT -d pkgs.tailscale.com -j DROP`.

Expected: error alert + log viewer visible simultaneously, log content is readable and selectable.

- [ ] **Step 4: Navigate-away-and-back test**

1. Uninstall Tailscale again.
2. Click **Install Tailscale** in the UI.
3. While the download is running, navigate to another page (e.g. Dashboard).
4. Wait ~10 seconds, then navigate back to **Monitoring > Tailscale VPN**.
5. Verify the log viewer is either mid-install (showing current progress) or the install has completed in the background and the card is in the "installed" state.

Expected: no crash, no stuck spinner, no stale empty log viewer.

- [ ] **Step 5: Accept the PR / merge**

If all four smoke tests pass, the feature is done. If any fail, report the specific step and symptom back so the plan can be revised.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Extend `install_status` CGI with `log` field | Task 1 |
| Use `tail -n 50` + `tr -d '\000\r'` | Task 1 Step 2 |
| Use `jq --arg` for safe JSON encoding | Task 1 Step 2 |
| Add `log?: string` to `InstallResult` | Task 2 |
| No changes to hook logic (pass-through via `setInstallResult`) | Task 2 Step 2 note |
| Create `InstallLogViewer` with auto-scroll-to-bottom | Task 3 |
| Props `{ log, isRunning }` | Task 3 Step 2 |
| Fixed `h-56` monospace pre with `whitespace-pre` | Task 3 Step 2 |
| Empty state "Waiting for output..." | Task 3 Step 2 |
| Dark background both modes (`bg-zinc-950`) | Task 3 Step 2 |
| Header row with label + spinner | Task 3 Step 2 |
| Mount viewer below install button | Task 4 |
| Render when `running` OR (`complete`/`error` AND log non-empty) | Task 4 Step 2 |
| Unmount on card state change post-install | Task 4 Step 2 note |
| No changes to `qmanager_tailscale_mgr` | Confirmed — not in file manifest |
| Manual smoke tests on device | Task 5 |
| Fresh install happy path test | Task 5 Step 1 |
| Slow download test | Task 5 Step 2 |
| Error path test | Task 5 Step 3 |
| Navigate away and back test | Task 5 Step 4 |

All spec requirements mapped to tasks. No gaps.

**Placeholder scan:** Every step has either concrete code, a concrete command, or a concrete acceptance check. No TBDs, no "implement later", no "add error handling" shortcuts.

**Type consistency:** `InstallResult.log` (optional string) used consistently in Task 2, Task 3 props (`log: string`), and Task 4 render condition (`installResult.log`). `isRunning` prop name consistent between component definition and consumer. Component name `InstallLogViewer` consistent across create, import, and usage.

**Cross-file path consistency:** All four files referenced in the manifest match the exact paths used in the task steps (`scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh`, `hooks/use-tailscale.ts`, `components/monitoring/tailscale/install-log-viewer.tsx`, `components/monitoring/tailscale/tailscale-connection-card.tsx`).

Plan is complete.
