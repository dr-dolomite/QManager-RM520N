# Run: Button and field primitives to pill
status: closed
lane: full
base: f135bd25 (BASE for diffs)   branch: worktree-pill-primitives @ .claude/worktrees/pill-primitives   opened: 2026-10-06   lead: Opus 5.5

## Request
"Button and field primitives. `button.tsx` is still `rounded-md` and 36px, while the canon says pill. `input`, `select` and `textarea` have the same gap. Fixing the primitives would remove the per-family `PILL_ACTION` constants (25 files) and the field overrides. This is the largest and riskiest change because it touches every route. It needs a visual review pass first, through `qm-redesign-review`." + "Lets properly plan out and implement these changes."

## Decisions taken — do not re-ask
- Recon + plan run under qm-redesign-review; build only after the Artifact gate.
- 2026-10-06 GATE (user, all as recommended): field corner = 10px rounded-field (not pill); add Button size="action" (42px, px-5, 600) and delete PILL_ACTION/PILL_ACTION_PLAIN; monitoring page actions 36->42 via size="action"; 44px coarse-pointer floor in the primitive on default + icon sizes. Bare fields growing 36->42 and losing the hairline follows from the field change (presented in the artifact, not objected to).
- Artifact (the brief): https://claude.ai/artifact/Du1ZetgEBj4hbRqDgvgKbq
- Main checkout had 6 uncommitted files (since committed by that session as of f135bd25) from a parallel session (radio/page-header.tsx, cellular-information-card.tsx, sms/message-dialog.tsx, at-terminal/transcript-row.tsx, ui/copyable-command.tsx, docs/reference/toast-confirmation.md). Do not touch or stage them.

## Plan
| id | task | class | seat | write set | state |
|---|---|---|---|---|---|
| R-A | call-site census (constants, inline overrides, sizes) | list | qm-scout | scratchpad/recon-census.md | ACCEPTED |
| R-B | canon extract (DESIGN/PRODUCT/globals/the101) | list | qm-scout | scratchpad/recon-canon.md | ACCEPTED |
| G | redesign-review Artifact + gate | judgment | conductor | scratchpad only | AT GATE: https://claude.ai/artifact/Du1ZetgEBj4hbRqDgvgKbq |
| W0 | primitives: button (pill base, size=action, coarse floor), input/select/textarea/input-group (42px, rounded-field, no border, fill, host prop) | build | conductor inline (5 short files, defines the API every wave uses) | components/ui/{button,input,select,textarea,input-group}.tsx | ACCEPTED, committed 81aa3366 (tsc 0) |
| W1a | sweep cellular/{settings,sms,custom-profiles,radio,antenna-alignment,antenna-statistics} + cellular/*.ts(x) | build | ui-builder | those dirs | DISPATCHED |
| W1b | sweep cellular/{band-locking,frequency-locking,tower-locking,cell-scanner} | build | ui-builder | those dirs | DISPATCHED |
| W2 | sweep local-network, monitoring | build | ui-builder | components/{local-network,monitoring}/** | DISPATCHED |
| W3 | sweep system-settings, about-device, support, auth, dashboard, public, onboarding, nav-menu/nav-user, ui/segmented-field.tsx | build | ui-builder | those | DISPATCHED |
Shared brief: .orchestra/scratch/pill-sweep-brief.md (gitignored; the rules are restated in the 81aa3366 commit + this ledger's Decisions).
| V | blind verify f135bd25..a434e3da | judgment | qm-verifier | none | FAIL (comments only) -> fix wave by conductor -> gates re-run |
| D | docs: DESIGN.md, 14 docs/reference, artifact-spec, RELEASE_NOTES | docs | docs-writer | docs | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| W1b | 1 | ui-builder | r1 | DONE_WITH_CONCERNS (coarse 44px now reaches PILL_QUIET/size-7 icon recipes: approved floor; tower-locking.md trap note stale -> docs) 21 files +81/-248 | tsc 0, eslint 0 err, both census greps empty | uncommitted in worktree |
| W3 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS (tsc err was W1a mid-edit in cellular/settings/shapes.ts; eslint 29 errors claimed pre-existing -> verify vs base; web-console ACTION_COARSE pointer-coarse:h-11 on size=action is redundant -> fix pass) 41 files +124/-212 | census empty except at-terminal PROMPT (SHELL) | uncommitted |
| W1a | 1 | ui-builder | r1 | DONE_WITH_CONCERNS (coarse floor swelling small default/icon buttons) 36 files +158/-356 | tsc 0, eslint 0, census empty | a434e3da |
| V | 1 | qm-verifier | - | FAIL: criteria 1-7,9 PASS; 8 (stale/3-line comments) FAIL; notes: icon coarse floor swells size-5..7 buttons, commands-popover md:text-sm, language-row buttonVariants on AlertDialogAction, lte-tower empty-row host, glyph action +16px | tsc/i18n/eslint re-run | verifier report in session |
| FIX | 1 | conductor | - | all verifier findings fixed: icon floor -> centred 44px ::after hit area (default keeps visible h-11 growth), action has-svg px-4, AT prompt bar rounded-field, MANAGE.FIELD md:text pinned, language-row props, lte-tower host conditional, comments trimmed, nr-sa dead dark:! removed | tsc 0, eslint 0 on fix files, build clean, phone probe: 20px icon stays 20px with 44x44 ::after, no h-scroll | fix commit |
| D | 1 | docs-writer | r1 | DONE_WITH_CONCERNS (left: cellular-settings-family.md 4.18:1 contrast figure measured on the old -high fill, not re-measured) 17 files +63/-102 | paths verified vs HEAD | fix commit |
| W2 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS (only the W1a mid-edit tsc error; TTL/MTU raw inputs -> <Input host="container">, Apply size=action; MAC field stays raw on fieldVariants) 35 files +165/-435 | tsc clean pre-W1a edit, eslint 1 pre-existing (sim-swap-banner), census empty | uncommitted |

## Findings that survive
- QManager-the101 button.tsx is rounded-pill but kept h-9; its input/select/textarea stay rounded-md.
- Local PILL_ACTION = "h-[2.625rem] gap-2 rounded-pill px-5 text-sm font-semibold" (42px, semibold).
- Canon: button pill at every size, default stays 36px, PILL_ACTION separate 42px recipe (DESIGN.md:203, :705). Fields are 10px rounded-field, 42px, no rest border (DESIGN.md:210, :782), NOT pill.
- PILL_ACTION defined in 24 files (16 identical); monitoring 5 families use a 36px/500 variant. 190/237 Buttons take a constant.
- BUG: TTL + MTU SaveButtons have no className -> 36px rounded-md beside 42px pill DISCARD (ttl-settings-card.tsx:531).
- Fields: pill in 8 families, 10px in 4, bare 8.4px+border in dialogs/onboarding. 15 dark:bg-*! markers, 9 h-[2.625rem]!, 13 data-[size=default]:h- overrides.
- Dev-server screenshots stay blank (hidden pane freezes entrance motion); DOM probes work.

## Device state
Not touched. Frontend-only run; no agent reported device access.

## Handoff — NEXT ACTION
Closed pending merge choice. Branch worktree-pill-primitives (81aa3366, a434e3da, fix+docs commit) on base f135bd25. Not hardware-verified: the user's tarball run is the authority; worth a phone check of dense rows (SMS inbox, schedule rules) and dark-mode fields. Open: cellular-settings-family.md CHECK_GROUP contrast not re-measured on surface-container.
