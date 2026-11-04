# Run: guard library sources against BusyBox ash abort
status: closed
lane: lite
base: 2b99659e   branch: development   opened: 2026-10-11   lead: opus

## Request
Guard every `. /usr/lib/qmanager/<lib>.sh 2>/dev/null || { stubs }` in scripts/usr/bin/qmanager_watchcat (qlog, events, sim_db, slot_verify, others) and the other #!/bin/sh daemons under scripts/usr/bin/ with the `[ -f ]` / else-stub form of 193e221c. Proof on RM520N-GL /tmp only; no live deploy or restart without a yes.

## Decisions taken — do not re-ask
- Lite lane by user instruction although 16 files: one mechanical pattern, mechanism measured on device.
- Scope: #!/bin/sh only. qmanager_poller is #!/bin/bash (non-posix `.` failure is non-fatal) — left alone.
- qmanager_email_send already tests -f before sourcing — left alone.
- No live deploy, no restart (user).

## Plan
| id | task | class | seat | write set | state |
|---|---|---|---|---|---|
| T1 | guard 23 sites (22 `|| {`/`|| :` + tower_schedule:47 bare) | build | conductor inline | 16 scripts/usr/bin/* | ACCEPTED |
| T2 | device proof in /tmp | verify | conductor | device /tmp | VERIFIED |
| T3 | blind verify | verify | qm-verifier | none | VERIFIED (PASS_WITH_NOTES) |

## Findings that survive
- 193e221c (conn_state guard) lives on worktree-wt+cq-unify, not development; its watchcat hunk sits next to the sim_db block this run edits — expect a small merge conflict there.

- qmanager_tower_schedule:69 `. tower_lock_mgr.sh 2>/dev/null` has no fallback; a missing lib aborts there, which is a safe no-op. Left as is.
- After merging cq-unify, watchcat carries the "Guarded with -f" comment twice; drop one.

## Device state
RM520N-GL 61368cd2: /tmp scratch only (qm_guard, verifier qmv_*), both deleted. Live /usr/bin/qmanager_watchcat md5 08617e26 = cq-unify 193e221c (deployed by that session, not this run). Nothing deployed, no restart.

## Handoff — NEXT ACTION
Closed. Deploying to the device is the user's call.
