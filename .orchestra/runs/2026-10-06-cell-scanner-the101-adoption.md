# Run: Adopt the101's Cell Scanner layout (all states) into RM520N Cell Scanner + Neighbourcells
status: closed
lane: full (redesign / adoption pass, frontend-only)
base: b165f4d1dc93180ebb03cb4876eb87d636bfcd37   branch: worktree-cell-scanner-the101 @ .claude/worktrees/cell-scanner-the101   opened: 2026-10-06   lead: Sonnet 5.5 session

## Request
"Can we please check the redesign and overall layout of Cell Scanner (including all states) from QManager the101 and then adopt it to our own project? Of course, the result / data my vary so the only possible differences will only be the table data but again, I want the overall layout in all states to be copied over. The same for our own Neighbourcells, it should also adopt the design."
Follow-up (mid-turn): "Include as part of the draft changes for v0.1.17 also" = add a RELEASE_NOTES.md bullet under v0.1.17-draft > Improvements.

## Decisions taken — do not re-ask
- 2026-10-06 Source of truth for the design: `D:\Projects\QM PROJECT\QManager-the101` (OpenWRT sibling, read-only for us).
- 2026-10-06 the101 RETIRED its Neighboring Cells route (commit b835d71a), so there is no neighbour layout to copy; ours adopts the Cell Scanner grammar.
- 2026-10-06 Release notes: bullet in v0.1.17-draft, Improvements.
- 2026-10-06 GATE answers: (1) Neighbourcells idle = same compact launch bar as Cell Scanner; (2) Frequency Calculator OUT of scope: user said another agent worked on it, cooperate only if needed. Calculator files and shapes.ts CALC_*/HERO_SHELL are protected.
- 2026-10-06 No mock Artifact: the101's shipped code is the spec. Advocate not fired (a port, no unproven hypothesis).
- Preserved: RM520N data model, CGI contract, hooks' transport (only table data may differ), 5-catalog i18n parity, Rethink Sans + JetBrains Mono, no test files (the101's sort.test.ts / calc-model.test.ts are NOT ported).

## Plan
| id | task | class | seat | write set | state |
|---|---|---|---|---|---|
| R1 | recon: the101 scanner surface, per state | list | qm-scout | none | ACCEPTED (dump in session scratchpad the101-scanner-recon.md) |
| R2 | recon: RM520N scanner + neighbour surface | list | qm-scout | none | ACCEPTED (rm520n-scanner-recon.md) |
| B | build: sweep + neighbour on the101 grammar | judgment | ui-builder | cell-scanner/** except freq-calculator, locales x5 | ACCEPTED (DONE_WITH_CONCERNS, resolved) |
| V | blind verifier | | qm-verifier | none | VERIFIED: PASS_WITH_NOTES, no must-fix; comment notes fixed |
| D | docs/reference/cell-scanner.md, README row, DESIGN.md delta, RELEASE_NOTES | | docs-writer | docs | ACCEPTED (bullet tightened by lead) |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|

## Findings that survive
- the101 history that shapes the layout: b835d71a (scan table adapted to band scan, Neighboring Cells retired), 6bf76c2c (progress bar, SIM-gated lock, icon Columns trigger), 166dfc82 (sweep hero = one ledger), 90c7ecd6 (sort by signal, en-dash blanks, CSV in toolbar, Cell Locking note), f52e3958 + b6e3e2e2 (phone polish), 1f824690 (calculator recompose).
- Shared-file diff size (the101 lines vs ours): shapes.ts 553/288, scanner.tsx 259/166, run-summary 196/201, scan-result 158/43, run-hero 139/102, lock-cell-dialog 108/63, scan-table 93/48. Identical: scan-states, scanner-skeleton, signal-badges, table-note.
- the101-only files: sort.ts, sim-plmn.ts. Hook and type files differ (93 and 98 lines) because the101's data model differs.

- Delta, sweep (the101 -> ours): idle = compact launch bar, results card NOT rendered (ours renders ScanEmptyState; reverses ours 2a3519fa); scanning adds a time-estimated 0-99 bar (90% at 150 s) + 2 skeleton rows; complete hero = one ledger (check disc, total figure, up to 5 carrier rows, SIM carrier first with a "Your SIM" Tag, SignalBadge + dBm, verdict strip) vs our tile grid; toolbar = filter + Download CSV + icon-only Columns (ours: CSV bottom-right, labelled Columns pill); lock-note strip with tier tally; pager only above 10 rows; default sort signal desc, unmeasured last; en-dash blanks; SIM-gated row lock.
- the101 has NO neighbour route. Ours: hero always open when idle, tiles per relation. Neighbour reads take seconds, so no time-estimated bar there.
- Facts: our sweep hook already returns elapsedSeconds (unused, scanner.tsx:147); types/modem-status.ts:289 has imsi; the101 hero already has `progress`/`progressLabel` props and imports ui/progress.
- Our stale copy: sweep table note says a lock copies into "Tower Locking" but the code POSTs the lock directly.
- Not ported: sort.test.ts, calc-model.test.ts (no test files). Columns stay ours (TAC, Bandwidth), the101 has RSRQ/SNR instead: data, not layout.

- Lead gates at close: tsc rc 0, i18n:check rc 0 (26 warnings, none in cell_scanner), icons:check rc 0, eslint rc 0, `bun run build` rc 0 (builder). Browser proof with stubbed endpoints: sweep idle / scanning / complete / zero / failed, phone 390 (no h-scroll), neighbour idle / complete / zero / failed / phone, SIM gating (Smart enabled, Globe disabled with reason).
- Lead fix after builder: neighbour failed card body used the sweep's "run the sweep again" key (existed at BASE); now neighbour.run.failed_body.
- Open, out of scope: neighbour filter on numeric `frequency` column hides all rows (inNumberRange); spawned as a task chip. Dead `tier` fields in summaries.ts; glyphs signal_cellular_alt_1_bar/_2_bar unused (subset regen needs network).
- "available bands" on the neighbour ledger counts rows, not distinct channels (existing copy, unchanged).

## Device state
Not touched. Frontend-only run.

## Handoff — NEXT ACTION
CLOSED pending the user's merge choice. (history: gate PASSED, worktree entered (merge-base verified = HEAD = b165f4d1), deps installed, recon dumps in .orchestra/scratch/cs101-*.md. Builder B dispatched. NEXT: collect B report, diff against BASE, fix concerns, run gates myself, browser proof of each state (preview_start serves repo root, so add a launch entry rooted at the worktree or stub), qm-verifier, then docs/reference/cell-scanner.md + RELEASE_NOTES v0.1.17-draft Improvements bullet, commit, close-out AskUserQuestion (merge / PR / discard). Do not redo recon.)
