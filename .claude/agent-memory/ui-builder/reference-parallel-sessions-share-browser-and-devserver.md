---
name: parallel-sessions-share-browser-and-devserver
description: In a multi-agent family refit, another session already runs THIS worktree's dev server and the Browser pane is shared — find the port by process cmdline and pass tabId on every call
metadata:
  type: reference
---

During a family refit, sibling agents work the same worktree at the same time. Two consequences bite before you get a single screenshot:

**1. `next dev` refuses to start — the lock is already held.**
`⨯ Unable to acquire lock at <worktree>/.next/dev/lock` means a *parallel session* already started a server for this exact worktree. Do not kill it and do not pick another port. Find the one that is already yours:

```powershell
Get-NetTCPConnection -State Listen | ? { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3100 } |
  Select LocalPort,OwningProcess
foreach ($p in <pids>) { (Get-CimInstance Win32_Process -Filter "ProcessId=$p").CommandLine }
```

The command line carries the absolute path of the `node_modules/next` it booted from, so it names the worktree outright. Three servers on 3019/3021/3031 all answer `200` on the same route — only the cmdline tells you which one is serving *your* edits.

**2. The Browser pane is shared, and it re-fronts another session's tab.**
`computer` without an explicit `tabId` acts on whatever tab is active, and the active tab changes under you when a sibling agent drives the pane. A batch of keystrokes silently landed in another session's tab mid-run (the result blocks report the switch as `Executed on tabId: tab-2` — that line is the only warning you get). Pass `tabId` on **every** `find` / `computer` / `javascript_tool` / `resize_window` call once more than one tab is open, and re-check `tabs_context` if a result surprises you.

**3. A sibling's build error latches a full-screen overlay over YOUR page.**
Another session deleted its own `app/qm-preview/<fixture>/` mid-run; the shared dev server threw `Module not found: Can't resolve './page.tsx'` for a route I never touched, and Next's dev overlay covered the page I was verifying. `Escape` does not dismiss a *build* error. The page underneath is fine — the overlay is a separate shadow host, so shoot past it with `document.querySelectorAll('nextjs-portal').forEach(n=>n.remove())` and screenshot. Never read a foreign route's compile error as a defect in your own change; `next build` passing minutes earlier is the proof.

**Why:** the worktree model puts several agents on one repo and one browser; neither the dev server nor the pane is per-session.

**How to apply:** before any browser verification in a refit, run `tabs_context` first, learn your own tabId, and thread it through. Related: [[reference-preview-start-serves-repo-root-not-worktree]], [[reference-reaching-dashboard-on-the-dev-server]], [[reference-family-refit-shell-blocks-verification]].
