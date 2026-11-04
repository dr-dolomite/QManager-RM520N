---
name: documented-guard-had-no-writer
description: ARCHITECTURE.md and BACKEND.md both described the /tmp/qmanager_long_running guard for years while nothing in the tree ever created the file — grep for a WRITER before documenting a flag
metadata:
  type: reference
---

When documenting a flag/lock/marker file, grep for who **writes** it, not just who reads it. `/tmp/qmanager_long_running` was described in `docs/ARCHITECTURE.md` and `docs/BACKEND.md` as an active guard while it had three readers (`qmanager_poller`, `qmanager_watchcat`), two deleters (boot cleanup + the poller's 300s expiry) and **zero writers**. BACKEND.md even named `qmanager_poller` — a reader — as the writer. A real writer only landed 2026-08-11 in `qmanager_cell_scanner`.

**Why:** a readers-only flag reads as a working guard in every doc and every code search; the failure is silent (the poller simply never enters the mode). Both docs were plausible because the readers genuinely existed.

**How to apply:** before writing "X touches /tmp/foo so Y backs off", grep the whole tree for the path and classify each hit as write / read / delete. Name the writer explicitly in the doc, with its UID, since `fs.protected_regular` makes the www-data→root direction the only safe one for a `/tmp` marker (see [[reference_tmp_protected_regular_blocks_root]] in the user-scope memory and `tmp-file-ownership.md`). The full contract now lives in `docs/reference/cell-scanner.md`.

**Second half of the same lesson (2026-08-12):** after the writer landed on 2026-08-11 I rewrote the doc in the present tense — and it was *still* wrong, because the deployed device was running the old `/usr/bin/qmanager_cell_scanner`. On hardware the marker continued to have zero writers for another day. **A writer in the tree is not a working guard; only a deployed binary is.** For any runtime-behaviour claim on this project, either say "in the repo" explicitly or verify against the device (`/usr/bin/...`, `/tmp/qmanager_status.json`) before writing it in the present tense. Confirmed working live 2026-08-12: sweep raises the marker, `system_state` goes `scan_in_progress` → `normal`.
