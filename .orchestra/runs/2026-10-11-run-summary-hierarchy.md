# Run: Run-hero summary hierarchy (both scanning routes)
status: closed
lane: full
base: 7cec649ae7bb1d6d9b3ca8b46abb5b41bcd0bc2a   branch: worktree-wt+run-summary-hierarchy (.claude/worktrees/wt+run-summary-hierarchy)   opened: 2026-10-11   lead: opus

## Request
"Lets polish this part under Neighbouring Cells since currently, theres no hierarchy and layout doesnt make sense. Lets properly redesign / re-author with proper hierarchy (direction), highlight and cleaner layout."

## Decisions taken — do not re-ask
- Review artifact (approved brief): https://claude.ai/artifact/17STG7FXH4RrbRsY2BC59o (v2 carries the amendments)
- Gate: apply to BOTH routes (sweep + neighbour) through the shared RunHero complete posture.
- Gate: remove the neighbour channel-only verdict strip (table note already carries it). Sweep keeps its verdict.
- Gate: NO "Strongest" receipt.
- Device: user said "Yes, deploy and check (Recommended)" to hand-deploy the export to the RM520N, backup kept and restored after.
- Amendment after device look: user wanted "just a check and the huge total number"; tally dropped, check disc beside the figure. "Looks better. Proceed"
- Close: user said "merge into development. No need to restore original build".
- Copy: "available bands"/"bands" -> neighbours/cells, all five locale packs.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| T1 | RunHero complete summary + both routes + copy | build | ui-builder (pin) | run-hero.tsx, shapes.ts, scanner.tsx, neighbour-scanner.tsx, public/locales/*/cellular.json | VERIFIED |
| T2 | Blind verify | judgment | qm-verifier (pin) | none | ACCEPTED (PASS_WITH_NOTES) |
| T3 | Doc note + release bullet | docs | conductor (inline; 5 line edits, no docs-writer) | docs/reference/cell-scanner.md, RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| T1 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS (no visual proof possible offline) | tsc, i18n, eslint dir, build | .orchestra/scratch/build2.log |
| T2 | 1 | qm-verifier | r1 | PASS_WITH_NOTES: stale doc lines; empty read showed "0 measured" (fixed inline by conductor) | all gates re-run | .orchestra/scratch/vrs-*.log |

## Findings that survive
- summary.total is results.length on both routes (summaries.ts:228); neighbour copy called it "bands".
- LEDGER.STATUS_ROOT grid-rows-[auto_1fr] + STATUS_FIG self-end + min-h-[8rem] caused the ~45px gap (shapes.ts:106-123).

## Device state
RM520N-GL (61368cd2): build 2 of this branch LIVE at /usrdata/qmanager/www by user choice (no restore). Original build still at /usrdata/qmanager/www.prev (~10 MB), not deleted. /tmp clean.

## Handoff — NEXT ACTION
Closed. Merged into development. Optional: delete /usrdata/qmanager/www.prev on the RM520N once the user agrees.
