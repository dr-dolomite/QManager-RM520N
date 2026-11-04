# Run: Port the101 design-rule amendments, Frequency Calculator redesign, and redesign-review skill
status: closed
lane: full
base: 11b75e46   branch: wt/the101-design-port @ .claude/worktrees/the101-design-port (BASE_OK verified)   opened: 2026-09-26   lead: opus (Opus 5.5, conductor session rooted in QManager-the101)

## Request
"Now, can you please orchestrate a team to properly port these design changes and new skill to QManager-RG520N? Basically all of the amendments we changed for our design language / rules."

## Decisions taken — do not re-ask
- 2026-09-26 Close-out: user chose "Merge to development (Recommended)"; development had not moved (11b75e46), fast-forward. Token split not metered: the conductor session is rooted in QManager-the101, so .claude/token-meter.mjs does not see it.
- 2026-09-26 Target repo: user chose QManager-RM520N (no repo named RG520N exists; QManager-RG520 was the other candidate).
- 2026-09-26 Identity: user chose "Keep its fonts" — port layout / scanning / copy+help rules, Card-Wrapped, HintIcon, the skill and the calculator redesign; keep RM520N's typefaces (Rethink Sans + JetBrains Mono) and colours. the101's Three-Voice rule is adapted, not adopted.
- Routing override (rail 1): this conductor session is rooted in QManager-the101, so RM520N's qm-scout / qm-worker / qm-verifier / qm-advocate are not dispatchable by name. Substitute: orchestra-scout / orchestra-worker / orchestra-verifier with an explicit `model` and a ticket line making the matching `.claude/agents/qm-*.md` file the binding role contract. Reason: the rail's cause is inherited seat + no project contract; both are fixed explicitly.
- 2026-09-26 User (mid-turn): "Make sure to also port our philosophy / i.e. changes we did based on the video transcript from weridly perfect." — in scope; R1 extended to cover it (source: the101 skill references/philosophy.md).
- Rail 8 (no test harnesses): the101's calc-model.test.ts is NOT ported.

- 2026-09-26 Gate: user chose "Build it (Recommended)" — B1/B2/B3 parallel, merge only on a later yes.
- 2026-09-26 Gate: Machine-Voice tell — "Adopt it (Recommended)": quantity-you-read vs opaque-string-you-compare; calculator follows; other pages listed as Migration Deltas, not swept.
- 2026-09-26 Gate: "Skill replaces it (Recommended)" — qm-redesign-review becomes the single redesign/polish entry point; playbook shrinks to a pointer; flag table names the skill.
- Fan-out: B1/B2/B3 parallel, 3 × opus orchestra-worker, disjoint write sets (docs canon / components+locales / .claude/skills+playbook+router). Opus because each is adaptation judgment, not a list.


## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Rules delta: the101 design-rule amendments vs RM520N canon | list | orchestra-scout as qm-scout (sonnet) | .orchestra/scratch/port-R1-rules.md | ACCEPTED |
| R2 | Frequency Calculator delta + dependency census | list | orchestra-scout as qm-scout (sonnet) | .orchestra/scratch/port-R2-freqcalc.md | ACCEPTED |
| R3 | Skill adaptation census + overlap with redesign-proposal-playbook.md | list | orchestra-scout as qm-scout (sonnet) | .orchestra/scratch/port-R3-skill.md | ACCEPTED |
| B1 | Canon docs: PRODUCT.md P7+P8, DESIGN.md Scanning Rules / Full-Width + Row-Span / Copy & Help + No-Default-Tip + HintIcon / Machine-Voice tell (per gate) / HintIcon icon exception; CLAUDE.md Design Context bullets + skill pointer | judgment | orchestra-worker opus (as docs-writer) | PRODUCT.md, DESIGN.md, CLAUDE.md | VERIFIED |
| B2 | HintIcon primitive + Frequency Calculator redesign (5 files patch, shapes.ts hand-merge, font-numeric translated, calc-model helpers without test, i18n all 5 catalogs translated) | judgment | orchestra-worker opus (as ui-builder) | components/ui/hint-icon.tsx, components/cellular/cell-scanner/freq-calculator/**, components/cellular/cell-scanner/shapes.ts, public/locales/*/cellular.json | VERIFIED |
| B3 | Skill port + playbook reconciliation (per gate) + qm-orchestrate flag-table row; exemplar re-tokened to RM520N | judgment | orchestra-worker opus (as qm-worker) | .claude/skills/qm-redesign-review/**, docs/reference/redesign-proposal-playbook.md, .claude/skills/qm-orchestrate/SKILL.md, docs/reference/README.md | VERIFIED |
| V1 | Gates + page load + blind verify | judgment | LEAD gates; orchestra-verifier opus (as qm-verifier) | — | ACCEPTED |
| D1 | RELEASE_NOTES.md entry | list | orchestra-worker sonnet (as docs-writer) | RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| R1 | 1 | orchestra-scout sonnet (as qm-scout) | rev1 + philosophy addendum | DONE_WITH_CONCERNS — 6 absent, 5 present, 2 conflicting (Two-Voice canon at DESIGN.md:471; icon boundary broader in TARGET DESIGN.md:176), 9 philosophy sub-rules absent; hint-icon.tsx missing in TARGET; concern: philosophy.md sections 2-8 not read in full | 3 citations spot-checked | .orchestra/scratch/port-R1-rules.md |
| R2 | 1 | orchestra-scout sonnet (as qm-scout) | rev1 | DONE_WITH_CONCERNS — PATCH-WITH-ADAPTATION: 5 calculator files byte-identical to the101 pre-redesign; shapes.ts diverged (hand-merge); font-numeric absent in TARGET; glyphs + removed-key census not checked | diff after CRLF normalisation | .orchestra/scratch/port-R2-freqcalc.md |
| R3 | 1 | orchestra-scout sonnet (as qm-scout) | rev1 | DONE — 16 the101-specific refs; pin_grid.py/finalize.py repo-agnostic; conflicts: playbook Explore vs rail 1, two entry points, .dark class vs artifact 3-block theme | 3 citations spot-checked by scout | .orchestra/scratch/port-R3-skill.md |
| B1 | 1 | orchestra-worker opus (as docs-writer) | rev1 | DONE — P7/P8, Scanning Rules, Full-Width, Copy & Help, Machine-Voice retold, 1 Migration Deltas row; concern (@container/card call-site note missing in CLAUDE.md) fixed by LEAD | leak grep: 1 sanctioned provenance line | commit 01dfa32f |
| B2 | 1 | orchestra-worker opus (as ui-builder) | rev1 | DONE_WITH_CONCERNS — tsc 0, i18n:check 0 err, build 0, bun -e helpers OK; full-repo lint rc1 (34 errs, none in touched files); stale shared IDENT comment fixed by LEAD; cell-scanner.md stale → D1 | LEAD browser (static export :4318, cookie mock): 1600px cards 737/492 equal h 649, figures rethinkSans tabular; 375px docW 375, tables 247/287, recall re-runs 627264, 0 overflow | commit 62f5b816 |
| B3 | 1 | orchestra-worker opus (as qm-worker) | rev1 | DONE_WITH_CONCERNS — skill + exemplar/template re-tokened, finalize.py --check exit 0; concerns: .claude gitignored (LEAD git add -f, matches repo convention), change-workflow.md:19 stale (LEAD fixed) | grep: 1 provenance line | commit ea6e8325 |
| V1 | 1 | orchestra-verifier opus (as qm-verifier) | rev1 | PASS_WITH_NOTES 10/10; F1 ellipsis item, F2 "·" glue vs No-Dot-Separator, F3 stale line cite → one LEAD fix wave committed; F4 HintIcon no consumer (accepted at gate) | tsc 0, build 0, i18n 0 err, icons:check 0, finalize --check 0, template tokens 70/63 match | — |
| D1 | 1 | orchestra-worker sonnet (as docs-writer) | rev1 | DONE — cell-scanner.md calculator sections rewritten; 1 Improvements bullet in active v0.1.16 entry (post-tag commits already accumulate there) | diff --stat: 2 files | — |

## Findings that survive
- RM520N i18n policy is full parity: docs/reference/i18n.md:78-80 — new keys land in all 5 catalogs (translated or English placeholder); the101's en-only pause does NOT apply here.
- RM520N canon keeps the Two-Voice Rule (DESIGN.md:471); the101 Three-Voice face swap is not ported. Machine-Voice tell at DESIGN.md:473.
- RM520N icon boundary (DESIGN.md:176) already includes pre-auth — do not regress it.
- the101 font-numeric has no RM520N equivalent: Rethink is already the body face, so figures = bare tabular-nums.
- Playbook docs/reference/redesign-proposal-playbook.md:31 dispatches Explore, contradicting qm-orchestrate rail 1.

## Device state
Frontend + docs only; no device touched. DEVICE: none on every ticket.

## Handoff — NEXT ACTION
Closed. Merged to development. Open follow-ups (not scheduled): migrate the mono EARFCN/PCI/band sites listed in DESIGN.md Migration Deltas; give HintIcon its first consumer when a settings group needs a tip.
