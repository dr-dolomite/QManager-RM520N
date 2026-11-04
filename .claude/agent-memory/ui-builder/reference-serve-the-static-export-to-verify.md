---
name: serve-the-static-export-to-verify
description: A worktree's own changes can be seen by serving out/ from `next build` on a spare port — the shared `next dev` serves the repo root and never shows them
metadata:
  type: reference
---

`next dev` serves the **repo root**, so a shared dev server cannot show a worktree's edits, and a sibling session usually owns it anyway. But `next.config` sets `output: "export"`, so `bun run build` in the worktree leaves a complete static site at `out/` — including `out/locales/**`. Serve that instead:

```bash
node serve-out.cjs "<worktree>/out" 3047   # ~15-line static server, run_in_background
```

Then in the pane: `tabs_create {foreground:true}`, navigate to `http://localhost:<port>/<route>/` (**trailing slash** — the export writes `<route>/index.html`), set `document.cookie='qm_logged_in=1; path=/'` and reload past the auth gate.

**Three things this buys that reading code cannot:**

- **The unreachable state for free.** No CGI is served, so the first paint *is* the failure branch — one of the three required states, verified without a shim.
- **The loaded state via a `window.fetch` shim + the surface's own Retry.** Install the shim, then click the button; a `location.reload()` would drop it.
- **Real measurement.** Inject `*{transition:none!important;animation:none!important}` before any `getComputedStyle`, then read heights and `boxShadow`. This is how the important-marked whisper was *proved* rather than argued: the card reported `lab(7.74 … /.06) 0 1px 2px` (the token) and not `rgba(0,0,0,.1) 0 1px 3px` (`shadow-sm`). In DARK the whisper token is `0 0 #0000`, so an all-transparent readback there is the token winning, not a missing shadow — check light mode if you want the positive result.

**Gotchas:** pick a high port and be ready for `EADDRINUSE` (siblings hold 3019/3021/…); the pane freezes rAF when hidden, so a page pinned at `opacity: 0` means call `tabs_select` rather than debugging the cascade; and i18n loads its pack asynchronously, so the first screenshots legitimately show dotted key paths before the same page shows real copy.

**Why:** the project bans test harnesses and proves frontend work by loading the page; this is the only way to load *this worktree's* page.

**How to apply:** after `bun run build` passes, serve `out/` and walk the states. Related: [[reference-preview-start-serves-repo-root-not-worktree]], [[reference-hidden-browser-pane-freezes-raf]], [[reference-frozen-pane-freezes-css-transitions-too]], [[reference-locales-are-statically-bundled]].
