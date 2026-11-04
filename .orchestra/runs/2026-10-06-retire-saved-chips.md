# Run: Retire the fading "Saved/Applied" chips (Toast-Confirms Rule)
status: closed
lane: full (frontend only, no device)
base: d65ebcd2   branch: worktree-retire-saved-chips @ .claude/worktrees/retire-saved-chips   opened: 2026-10-06   lead: Sonnet 5.5

## Request
"Retire the fading "Saved/Applied" chips. The Toast-Confirms rule retires them in alerts-settings-card, watchdog/save-bar, scheduled-operations-card, speed-limit-card and cellular-settings (its own setTimeout). Whether each one fades or stays was never checked, so each needs a quick look first. Do this together with item 1." — Investigate and properly plan.

## Decisions taken — do not re-ask
- 2026-10-06 "Item 1" unknown to the repo; user chose "Nothing, do this alone".
- 2026-10-06 cellular-settings: swap hand-rolled timer for `useSaveFlash` (SaveButton's own flash stays) + one success and one error toast in handleSave.
- 2026-10-06 Plan approved, no release-note bullet. No device touch.
- Main checkout has parallel uncommitted edits (DESIGN.md, custom-profile*.tsx); the DESIGN.md edit here must be integrated at merge, not clobbered.

## Plan
| id | task | class | seat | write set | state |
|---|---|---|---|---|---|
| R | measure fade/toast per surface | recon | conductor | none | ACCEPTED (all five fade 1800ms; four already toast; cellular has no toast) |
| B1 | remove 4 status chips + cellular toast + 5-locale keys | build | ui-builder | 6 components + ethernet-status.tsx, public/locales/*/{common,system-settings,cellular}.json | REPORTED(DONE); diff read by conductor, matches report; builder gates all green (i18n 0 errors, tsc, eslint, build) |
| V | blind verifier | verify | qm-verifier | none | FAIL then fixed: handleSave skips toast on unmount and names failedFields (not raw error code); 2 stale comments fixed; re-gated tsc+eslint rc=0 |
| D | docs rows (toast-confirmation.md l.66, DESIGN.md Migration Deltas l.291) | docs | conductor | those two | DONE (uncommitted) |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|

## Findings that survive
- Chips: alerts-settings-card.tsx:769 SaveStatus, watchdog/save-bar.tsx:182 SaveStatus, scheduled-operations-card.tsx:504 receipt layer, speed-limit-card.tsx:168 trigger; all driven by `useSaveFlash` (components/ui/save-button.tsx:39, 1800ms).
- cellular-settings.tsx:99 `saved` only feeds `SaveButton` inside PendingSaveBar (unmounts at changeCount 0); no toast existed.
- Keys to delete x5: common.json `alerts.channels.save.saved`, `watchdog.save.saved`, `ethernet.settings.saved`; system-settings.json `reboot.states.saved`. Add cellular.json `core_settings.basic.toast.{saved,save_failed}`.

## Device state
Not touched; none planned.

## Handoff — NEXT ACTION
Committed on worktree-retire-saved-chips. Merge into development (main checkout has a parallel session's uncommitted Card-Foot work incl. RELEASE_NOTES.md v0.1.17-draft and DESIGN.md: integrate, never clobber). Open: alerts-settings-card.tsx:138,160 stale-closure (pre-existing, noted in toast-confirmation.md); translations not native-reviewed; no browser render of the five surfaces.
