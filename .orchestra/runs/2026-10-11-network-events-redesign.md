# Run: Network Events redesign (/monitoring)
status: closed
lane: full
base: 62af4a03ff5efd8588543734e19639744c24dea7   branch: worktree-wt+network-events-redesign (.claude/worktrees/wt+network-events-redesign)   opened: 2026-10-11   lead: opus

## Request
"On the same premise, can we also at least polish or redesign the Network Events? Currently its just a big list of events."

## Decisions taken — do not re-ask
- Gate: approved artifact https://claude.ai/artifact/3VAC8LrMCZY5e3TR4X9kqF (v2) with amendment "Add a max height to the list of events maybe to make it scrollable once it reaches the max height" (in v2 as LOG_SCROLL).
- Keep the one-hour fill rule (Age-Gated Tone Rule upheld).
- ca_change flap-debounce bug in events.sh: SEPARATE later backend run, not this one.
- Frontend only; no device access.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| T1 | Build the redesign | build | ui-builder (pin) | components/monitoring/network-events.tsx, components/monitoring/network-events/**, public/locales/*/common.json | REPORTED(DONE_WITH_CONCERNS) |
| T2 | Browser proof (shimmed fetch) | verify | conductor | none | VERIFIED |
| T3 | Blind verify | verify | qm-verifier (pin) | none | VERIFIED (PASS_WITH_NOTES) |
| T4 | Docs + release note | docs | docs-writer (pin) | docs/reference/recent-activities.md, docs/reference/README.md, RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| T1 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS: phone run title 52px wide | 4 gates green | builder report |
| T3 | 1 | qm-verifier | r1 | PASS_WITH_NOTES: run remount on eviction; 3.5rem time col clips id/zh; 'event ring' copy | 4 gates green | verifier report |
| T4 | 1 | docs-writer | r1 | DONE | grep of named symbols | docs diff |
| T3-fix | 1 | conductor | - | stable run React key via member carry-over (same DOM node across eviction, stays open); phone time col 4.25rem; loading copy 'Loading events.' x5 | tsc/eslint/i18n/build green; browser | this ledger |
| T2 | 1 | conductor | - | flap/quiet/outage/empty/loading/error OK; top row skeleton 282=282; list cap 576px; open run survives poll; 375 no h-scroll; fixed phone toggle to chevron-only (title 52->105px) | browser | this ledger |

## Findings that survive
- Design source (gitignored copy): .orchestra/scratch/network-events-design.html; canonical in the artifact.
- Known, not fixed: unused exports (RUN_MIN, RUN_GAP_SEC, EVENT_LABELS...), stale comment components/dashboard/recent-activities.tsx:70-75, 1970-clock window text.
- Out of scope: scripts/usr/lib/qmanager/events.sh:745-752 ca_change bypasses _ev_settle flap counter.

- Merge: user chose "Merge into development". development was rewritten mid-run; replayed with rebase --onto, gates re-run green post-rebase.

## Device state
Not touched.

## Handoff — NEXT ACTION
Closed 2026-10-11. Merged to development as 982b0e5c (rebased onto 700bb603 after development was rewritten under BASE 62af4a03; docs conflicts integrated). Not pushed. Next: separate backend run for the ca_change flap debounce (events.sh LTE/NR CA blocks).
