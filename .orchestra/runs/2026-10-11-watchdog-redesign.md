# Run: Watchdog page redesign (frontend)
status: closed
lane: full
base: 73e88958   branch: worktree-wt+watchdog-redesign (from development)   opened: 2026-10-11   lead: opus

## Request
Full redesign of /monitoring/watchdog: cards too big, no hierarchy, poor scannability, old Switch controls. Compact, bento layout, easier scanning, per our design rules. Saurian x62 screenshot is a compactness reference only. Show the proposal as an artifact.

## Decisions taken — do not re-ask
- Gate passed 2026-10-11: layout approved "as shown". Two Saves (each card commits only its own fields). All four new items in: probe strip, timeline, five-row activity cap, step 3 as Slot 1 / Slot 2 / Off.
- Worktree `.claude/worktrees/wt+watchdog-redesign`, branch `worktree-wt+watchdog-redesign`, BASE 73e88958bebb251c8757b4bf05a575a45ddcfade.

## Plan
Proposal artifact (qm-redesign-review): https://claude.ai/artifact/NjB4MfTeN54N96SrF6Lexw
Source: session scratchpad `watchdog-review.src.html` (wd-css.css / wd-body.html / wd-script.js + splice.py).

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| B1 build | 1 | ui-builder (pin) | r1 | REPORTED(DONE_WITH_CONCERNS) -> ACCEPTED | i18n:check, tsc, eslint, build | builder report in session |
| browser proof | - | conductor | - | PASS | dev server 3023 + fetch shim: layout, two scoped saves, tier-4 confirm, recovery/auto/unknown/no-slot states, 375px no h-scroll | session screenshots |
| V1 verify | 1 | qm-verifier (pin) | r1 | PASS_WITH_NOTES | 11 criteria + 4 gates | .orchestra/scratch/verify-*.log |
| fix 1 | - | conductor (Direct) | - | ACCEPTED | tsc, eslint, build | one-save-at-a-time Save disable, comment trim, probe error id |
| D1 docs | 1 | docs-writer (pin) | r1 | DONE_WITH_CONCERNS -> ACCEPTED | symbol greps | conductor fixed CLAUDE.md:42,44 and docs/FRONTEND.md:428 |

## Findings that survive
- Shipped page measured at 1440 (dev server + fetch shim): 1,994px tall; ladder 892, Detection 491, rungs 116 (tier 4: 219); Detection fields 280px in a 1,057px card; 3 of 4 tile captions truncated.
- Mock: ~1,150px at 1440; ladder/Detection pair 464/465px natural; no overflow at 390 in all 10 states.
- Parallel run 2026-10-11-connection-quality-unification may reshape `connectivity` (probe strip depends on it).

- Built page: 1,201px at 1440 (was 1,994 with the same data); ladder 490px (was 892).
- Open low notes: skeleton text heights still inline (pre-existing pattern); phone rung skeleton is min-h-16 while the loaded phone rung is ~106px.

## Device state
Not touched.

## Handoff — NEXT ACTION
Closed 2026-10-11. a11db9d8 fast-forwarded into development (user: "Merge to development also once all done"); post-merge i18n:check, tsc and build green. Not yet run on the device; the user's tarball run is the hardware proof. Worktree .claude/worktrees/wt+watchdog-redesign kept on disk.
