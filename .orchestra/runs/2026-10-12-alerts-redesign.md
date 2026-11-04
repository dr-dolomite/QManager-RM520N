# Run: Alerts page redesign (/monitoring/alerts)
status: closed
lane: full
base: cf2b5c14ff389b3a846b8910b7ff13be6c1d34b7   branch: worktree-wt-alerts-redesign (.claude/worktrees/wt-alerts-redesign)   opened: 2026-10-12   lead: opus

## Request
"On the same premises and reasons of Latency Monitor (ask Latency Monitor polish agent for further context of the reason why we redesign some feature pages), lets redesign / re-author the Alerts feature page. Make sure that it follows our design philosphy, language, and rules including properly implemented Motion based on our docs. Load /impeccable context also."
Mid-turn: "Show me your proposed changes on an artifact first before building."

## Decisions taken — do not re-ask
- Routed through qm-redesign-review (recon + plan); artifact gate before any code.
- GATE passed 2026-10-12 (user): "Approved, go with your recommendations. Much better design overall! Just make sure to add a max height to the events card so that it becomes scrollable once it hits the max height." -> all Your-call items take the recommended answer (matrix goes, saved-only Coverage, one wait field + new hint, keep 60 cap, sent rows quiet, map trigger keys). Activity: content height + LOG_SCROLL cap (artifact v2).
- User mid-run: full qm-orchestrate including backend bugs/optimizations found by the audit; frontend build assigned to an Opus ui-builder ("Assign the overall frontend build to another Opus agent").
- Backend scope (user, AskUserQuestion): "Shell + CGI fixes (Recommended)"; poller blocking: "Add timeouts only (Recommended)". Go daemon (discord-bot/) out of scope.
- Close-out pre-authorised (user): "Merge into development once everything passes".
- Main checkout has foreign uncommitted edits (components/monitoring/latency-monitoring/*, docs/reference/latency-monitor.md, public/locales/*/dashboard.json) from the Latency Monitor polish session: do not touch.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Alerts surface recon | recon | conductor (inline, user asked to save tokens) | none | ACCEPTED |
| R2 | Latency redesign premise | recon | cross-session ask to "Latency Monitor polish" | none | ACCEPTED |
| R3 | Backend audit (bugs/regressions/optimizations) | recon | modem-investigator (pin) | none | ACCEPTED (14 findings, DONE_WITH_CONCERNS) |
| P1 | Review artifact (critique + mock) | plan | conductor | scratchpad only | VERIFIED v1 — https://claude.ai/artifact/WT1D1tHvVDVUWS5PjqnLHc |
| G1 | Gate | gate | user | none | ACCEPTED |
| B1 | Frontend build | build | ui-builder (pin, opus) | components/monitoring/alerts/**, public/locales/*/common.json | REPORTED(DONE_WITH_CONCERNS) |
| B2 | Backend fixes (11 items) | build | cgi-endpoint-builder (pin) | alerts.sh, alert_engine.sh, sms/email/discord_alerts.sh, qmanager_setup, qmanager_secret_set, qmanager_email_send | ACCEPTED (pending V1) |
| B3 | Frontend follow-up: top-level alert_after_min (cap 1-1440, send only when edited, never per-channel), refetch after failed save, map trigger 'test'/'alert' | build | ui-builder (continue B1) | components/monitoring/alerts/**, hooks/use-alerts.ts, types/alerts.ts, locales | ACCEPTED |
| V0 | Browser proof (shim) | verify | conductor | none | VERIFIED (render, verdict/tags, trigger labels, 42px input, no stale notice after failed save) |
| V1 | Blind verify | verify | qm-verifier (pin) | none | VERIFIED after fix 2 (FAIL on F10 only; 16/17 PASS) |
| D1 | Docs + release note | docs | docs-writer (pin) | docs/reference/{alerts,tmp-file-ownership,README}.md, DESIGN.md row, RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| B1 | 1 | ui-builder | r1 + amendment (42px inputs) | DONE_WITH_CONCERNS: 18 files +~600/-~2000, 4 deleted; page 1,038px at 1440 (was ~1,450+); Activity cap 576px; every input 42px; concern = panel crossfade unseen (hidden pane) | i18n:check, tsc, eslint, build, browser shim 1440/390 | .orchestra/scratch/alerts-build.log |

| B2 | 1 | cgi-endpoint-builder | r1 | DONE_WITH_CONCERNS: 7 scripts +263/-123; 11 fixes proved on RM520N-GL via /tmp copies as www-data; GET 14->8 jq (329->260 ms), get_log 6->2 jq; RG501Q-EU unreachable; restart also when daemon not running (accepted) | bash -n, CR bytes 0, on-device runs | builder report |
| B2 check | - | conductor | - | device clean: alert_after_min absent (default), sms threshold 5, /tmp/alertsfix gone | read-only ssh | this ledger |
| B3 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS: crossfade unproven (pane hidden); stale notice after failed save | gates + shim (a)-(d) | .orchestra/scratch/alerts-build-b3.log |
| fix 1 | - | conductor (Direct) | - | hooks/use-alerts.ts error = load failures only (save/test failures toast from their result); rail label 'Needs setup' unless dirty | tsc, eslint, browser shim | this ledger |
| V1 | 1 | qm-verifier | r1 | FAIL: F10 (Channels card vanished on a failed first load); notes: log hook toasts on mount, Go daemon logs test success as "alert" | i18n, tsc, eslint, build, shim 1440/390, device GET as www-data | .orchestra/scratch/v-*.log |
| D1 | 1 | docs-writer | r1 | DONE_WITH_CONCERNS: OTA without reboot DOES re-seed (install_rm520n.sh restarts qmanager-setup); stale comment use-alerts-form.ts:93; svc_restart cannot recover a start-limited bot | source greps | docs diff |
| fix 2 | - | conductor (Direct) | - | Channels error condition on failed load (+ alerts.channels.error.* x5); log hook toasts only on user refresh; Activity error + stale notice use plain copy (no raw HTTP text, x5); stale comment fixed | i18n, tsc, eslint, build; browser: 3 error blocks, 0 toasts on load | this ledger |

## Findings that survive
- Prior redesign ledgers: 2026-10-11-latency-monitor-redesign.md, -watchdog-redesign.md, -network-events-redesign.md.
- Premise (user, Watchdog run): compact, bento, clear hierarchy, easy scanning, no old switches. Latency amendments: pill rows (ROW_SHAPE), plain-ink figures, fewer graphs, no handholding copy.
- Alerts was last re-authored 2026-09-05 (DESIGN.md Migration Deltas row); this run overturns its editable 3x3 matrix.
- Measured: band 3x503x104px; matrix card ~560px, 9 cells ~349x100px; one fact ("all off") shown 11 times; Channels starts ~y=893, first control ~y=1,070 at 1920x1080. Mock page ~1,050px at 1440.
- Bugs found in recon: ThresholdField rendered 3x for one alert_after_min, hint copy false, UI max 60 vs CGI 1440; Activity prints raw entry.trigger (engine logs connection_lost etc.); header Refresh skips the log; FOOT.PULSE breaks One-Loop Rule.
- Artifact source: scratchpad alerts-review.src.html (template head + partB.html), finalize.py --shot __SHOT__=before.png.

- B2 notes for docs: /tmp/qmanager_sms_log.json + /tmp/qmanager_discord_log.json seeded root:root 0666 by qmanager_setup (at boot and on OTA: the installer restarts qmanager-setup, per docs-writer); trims copy-through; Discord log trimmed to 100 rows every 150 cycles; reboot classification holds below epoch 1700000000; engine config pending until jq; msmtprc timeout 30 only after next email save/refresh.
- R3 deferred (out of scope, for a later run): discord-bot Go: single-slot cmd file (spool), success rows log trigger "alert" not the event, s.Open fatal + StartLimitBurst=5 kills the bot after ~50 s no-internet boot; inline dispatch blocks poller (only msmtp timeout added); error slugs not mapped to t() (toast shows English detail); Discord ID length 17-20 UI vs 15-25 CGI.

## Device state
RM520N-GL 61368cd2: read-only probes by R3, B2 (/tmp copies, cleaned), V1 (/tmp copies, cleaned), conductor. B2's sandboxed save runs logged 8 'settings saved' lines to the real /tmp/qmanager.log at 09:09 but wrote no config (sms/routing mtime 2026-09-08, values default, qmanager-discord NRestarts=0). An install of development HEAD at 08:56:27 (web root replaced, services restarted) rewrote discord_bot.json/email_alerts.json with unchanged defaults: not this run (deployed alerts.sh md5 = HEAD c504e7bd). Nothing from this run is deployed.

## Handoff — NEXT ACTION
Closed 2026-10-12. dd1cd602 + a9af96f8 fast-forwarded into development (user: "Merge into development once everything passes"); post-merge i18n:check, tsc, eslint green (build green in the worktree on the same tree; skipped in the main checkout because another session's dev server holds .next). Not pushed. Not yet run installed on hardware; the user's tarball run is the proof (watch the channel-panel crossfade). Deferred backend items are listed under Findings (R3 deferred) and in docs/reference/alerts.md Known gaps. Worktree .claude/worktrees/wt-alerts-redesign kept on disk.
