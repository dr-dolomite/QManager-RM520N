# Run: Discord daemon gaps (Alerts Known gaps)
status: closed
lane: full
base: 1bb396870190ddd30fd5f725d715fbea8b1afab4   branch: worktree-wt-discord-gaps (.claude/worktrees/wt-discord-gaps)   opened: 2026-10-12   lead: opus

## Request
Fix the deferred Discord daemon issues next. Ask Alerts feature page redesign agent for the full context.

## Decisions taken — do not re-ask
- Inherited from the Alerts run: poller blocking = "Add timeouts only (Recommended)". Background dispatch NOT chosen; do not revive without asking.
- qm-advocate skipped: every mechanism is read from code with no competing hypothesis; s.Open retry is a plain design choice.
- Gate (user, AskUserQuestion): plan "Approve all (Recommended)"; proof "Tarball run only" (no live bot configured, no real DM in this run); close-out "Yes, merge (Recommended)" into development, not pushed.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| B1 | Go daemon: spool dir drained in order; log trigger+recipient from payload; s.Open retry with backoff (no fatal) | build | cgi-endpoint-builder (pin) | discord-bot/*.go | ACCEPTED |
| B2 | Shell: discord_dispatch_message writes unique spool files (no 3 s wait), passes trigger; alerts.sh reset-failed before user restart; qmanager_setup seeds spool dir | build | cgi-endpoint-builder (pin) | discord_alerts.sh, alert_engine.sh, alerts.sh, qmanager_setup | ACCEPTED |
| B3 | Frontend: CGI slug -> t() map (5 catalogs); Discord ID 15-25 to match CGI | build | ui-builder (pin) | components/monitoring/alerts/**, hooks/use-alerts.ts, public/locales/* | ACCEPTED |
| V1 | qm-verifier | verify | qm-verifier (pin) | none | VERIFIED (PASS_WITH_NOTES) |
| F1 | Fix verifier notes 1-2: ln-with-retry spool names (subshell collision); O_NOFOLLOW/O_NONBLOCK + fstat regular check | fix | conductor inline | discord_alerts.sh, spool.go, spool_open_{unix,other}.go, alerts.md | VERIFIED (device run) |
| D1 | alerts.md Known gaps + discord-bot.md + tmp-file-ownership + README row + RELEASE_NOTES; BACKEND.md row by conductor | docs | docs-writer (pin) | docs/**, RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| B1+B2 | 1 | cgi-endpoint-builder (pin) | r1 | DONE_WITH_CONCERNS | go vet/test, arm build, device spool run (5 + 12 + refusal) | builder report |
| B3 | 1 | ui-builder (pin) | r1 | DONE | tsc, eslint, i18n:check, build | .orchestra/scratch/b3-build.log |
| V1 | 1 | qm-verifier (pin) | r1 | PASS_WITH_NOTES | go vet/test/mod verify, arm build, sh -n, i18n, tsc, eslint, build, device /tmp spool run | .orchestra/scratch/qmv-*.log |
| D1 | 1 | docs-writer (pin) | r1 | DONE_WITH_CONCERNS (BACKEND.md row, fixed by conductor) | anchors, CRLF | report |
| F1 | 1 | conductor | - | done | go vet/test (windows + linux/arm vet), arm build, device: 3 subshell + 1 direct same-second sends as root -> 4 ordered files; 2 subshell sends as www-data with protected_hardlinks=1 -> 2 files | commit body |

## Findings that survive
- Not exercised live: a real DM, the daemon draining the spool, a 4004 exit, SIGTERM timing, a start-limit trip then a save recovering it, the Alerts page failure toasts, an OTA tarball run, the RG501Q-EU (unreachable all run).
- Open, low (verifier): alerts queued while the bot reconnects have no Activity row until delivered, and are lost without a row if the device reboots first. Form stays dirty after a service_* save failure (pre-existing, alerts-settings-card.tsx:123-128). uninstall_rm520n.sh leaves /tmp/qmanager_discord_spool until reboot.
- discordgo v0.28.1 Open returns the raw gorilla *websocket.CloseError (4004) from the post-identify read; a junk token passes the REST /gateway call.
- sudoers already allows `systemctl reset-failed qmanager-*` (scripts/etc/sudoers.d/qmanager:18).
- Device 61368cd2 runs cf2b5c14 shell code (deployed alerts.sh md5 c504e7bd), not HEAD: deploy before testing.

## Device state
RM520N-GL 61368cd2: /tmp-only runs by B1 (/tmp/qm_b1), V1 (/tmp/qmv), conductor (/tmp/qmc); all removed and confirmed gone. No live path, service or config touched. Deployed discord_alerts.sh / alert_engine.sh / alerts.sh / qmanager_setup match neither HEAD nor this change (older code, unchanged by this run). /tmp/qmanager_discord_spool does not exist on the device.

## Handoff — NEXT ACTION
Closed 2026-10-12: committed in the worktree and fast-forwarded into development (user: "Yes, merge"). Not pushed. Proof that remains is the user's tarball run with a Discord bot configured: send a test (Activity row should read "Test alert"), trigger a reconnect so connection_restored + reboot arrive together (both DMs), and boot once without internet then confirm the bot connects when the link returns.
