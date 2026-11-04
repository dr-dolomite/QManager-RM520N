# Run: Connection Quality page redesign
status: closed
lane: full
base: cf2b5c14ff389b3a846b8910b7ff13be6c1d34b7   branch: worktree-wt-cq-redesign (.claude/worktrees/wt-cq-redesign)   opened: 2026-10-12   lead: opus

## Request
Redesign /monitoring/connection-quality on the Watchdog / Network Events / Latency Monitor premise (compact, bento, clear hierarchy, scannable). qm-redesign-review artifact first, wait for approval, build under qm-orchestrate. Raise the status band vs Latency Monitor "Right now" overlap as an open question. Commit only when the user says so.

## Decisions taken — do not re-ask
- Routed through qm-redesign-review (recon + plan); gate before any code.
- GATE passed 2026-10-12 (user, all recommended): band removed (leg verdict to Probe Targets header chip); six preset blurbs removed for "Flags after" / "Right now" rows; Probe interval link row added (replaces the Watchdog note); save-failure toast + foot "Couldn't save" folded in. Artifact v1 is the brief.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Page code, copy, canon, sibling grammar | recon | conductor | none | ACCEPTED |
| R2 | Live capture RM520N-GL 61368cd2 (status, ping_profile, quality_thresholds) | recon | conductor | none | ACCEPTED |
| P1 | Review artifact (critique + mock) | plan | conductor | scratchpad only | VERIFIED — https://claude.ai/artifact/T8Gr5RRAAxSHfMyyMoEoyk |
| G1 | Gate: approve artifact + open calls | gate | user | none | ACCEPTED |
| B1 | Build the redesign | build | ui-builder (pin) | app/monitoring/connection-quality/page.tsx, components/monitoring/connection-quality/**, public/locales/*/system-settings.json | REPORTED(DONE_WITH_CONCERNS) |
| V1 | Browser proof (shim) | verify | conductor | none | VERIFIED |
| V2 | Blind verify | verify | qm-verifier (pin) | none | VERIFIED (PASS_WITH_NOTES) |
| D1 | Docs + release note | docs | docs-writer (pin) | docs/reference/connection-quality.md, RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| B1 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS: 14/14; concerns accepted (Save enabled while is_default; interval row hidden when absent; GROUP_HEAD min-h-5) | tsc, eslint, i18n:check, icons:check, build | .orchestra/scratch/cq-b1-build.log |
| V1 | 1 | conductor | - | VERIFIED: 1440 cards 526x535 side by side, page ends ~730px (was 1,395); chip "Leg 1 answering" | browser (shim) | scratchpad after-1440.jpg |
| V2 | 1 | qm-verifier | r1 | PASS_WITH_NOTES 14/14; note 1 (false red "No answer" right after a leg save) fixed below | tsc, eslint, i18n, icons, browser 1440/390 | verifier report |
| fix 1 | - | conductor (Direct) | - | ACCEPTED: legState no-match while reachable returns "unknown" (Not reporting); browser-confirmed | tsc, eslint, browser | this ledger |
| D1 | 1 | docs-writer | r1 | DONE: connection-quality.md page section rewritten; one v0.1.17-draft bullet | grep, CRLF | docs diff |

## Findings that survive
- Measured at 1440 (dark, shimmed device data): page 1,395px; phone 2,961px, first card at 741px. Band 150px; 3 of 4 tiles read the same fields as LM Right now; only leg number + DNS-fallback verdict unique.
- Leg rows 133px each (LEG.ROOT flips at @2xl/card=672px, card is 535px); thresholds well has 247px empty slack; Restore defaults 830px above Save.
- Both save handlers `catch {}` with no toast.error (Toast-Confirms violation). shapes.ts imports 33 names from components/system-settings/shapes.ts.
- Preset blurbs misdescribe the table: Standard and Tolerant both debounce 3 (conn_state.sh cq_preset_*).
- Mock measured: about 676px at a 1105px main column; card bodies within ~25px of each other.
- Artifact source: scratchpad cq-review.src.html, spliced from head.part + cq.css + tail_css.part + cq-body.html + cq-script.js; finalize.py --shot __SHOT__=before-1440.jpg.
- Fetch shim used for capture lives only in scratchpad (shim.js, loaded cross-origin from 127.0.0.1:8765); nothing in public/.

## Device state
RM520N-GL 61368cd2: read-only CGI GETs via a minted session (deleted by the script); /tmp/cqcap.sh self-deleted; grep -c cqcap in /tmp = 0. Nothing deployed.

## Handoff — NEXT ACTION
Closed 2026-10-12. User: "Commit and merge it into development, fix the release note". Committed cebb8185 (release note: CQ dropped from the Discard list), merged development (Alerts run, 3 commits) with one RELEASE_NOTES.md hunk resolved by keeping both sides, post-merge tsc / eslint / i18n:check / icons:check / build all green, then fast-forwarded development. Not run on the device; the user's tarball run is the hardware proof.
