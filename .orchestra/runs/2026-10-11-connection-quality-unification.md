# Run: Connection Quality unification (backend)
status: closed
lane: full
base: 73e88958   branch: worktree-wt+cq-unify (.claude/worktrees/wt+cq-unify)   opened: 2026-10-11   lead: opus

## Request
To further apply improvements and optimizations to QManager and making the whole app feel cohesive and "as one", lets try to audit the Connection Quality, Watchdog and Live Latency.

What I want is to have a single source of truth for pings / latency that is used by both Watchdog (for decisions) and Live Latency (for graphs).

With this unification, it should also only have 1 alert from the Connection Quality based on the configured settings. So Connection Quality will handle the overall configurations. Additionally, I want to also replace Live Latency Dashboard widget with this one: Connection Quality (check QManager-the101 for reference) so we should make sure that our backend will work with it. We will do frontend changes as follow ups.

(Screenshot: the101 Connection Quality card — Internet 47 ms, DNS lookup 1780 ms, Probing 1.1.1.1, Reachability strip "Degraded", Jitter strip "240 ms now", 1 min ago..Now, Typical 191 ms / Worst 1424 ms / Loss 24.0%.)

Mid-run addition (user, verbatim): "I also want to apply this one so make our backend changes feasible also with this." / "It is similar to UniFI or WIFI Man's feature" / "Its not present yet on any of our projects" — screenshot: Monitoring > Sites tab, per-site latency grid (Gateway, google.com … messenger.com), "Checked 1 min ago, every 5 min", ranges 1H–90D, per-WAN filter, Check now.

## Decisions taken — do not re-ask
- Scope: backend only this run; the dashboard widget swap is a follow-up run.
- Reuse existing paired Activity event types (internet_lost/restored, high_packet_loss/packet_loss_recovered, high_latency/latency_recovered) — new types render as raw keys on the shipped /monitoring (advocate C8).
- DNS lookup runs as a background job with its own /tmp file, never inside the serial ping loop (advocate C3).
- GATE (user, 2026-10-11): Alert = "Down + restored only" (degraded is Activity + dashboard only). Degraded = "Loss only, configured" (replaces hard-coded 10%). Sites = "Build the backend now". Site probe = "TCP connect time" (curl %{time_connect} to :443).
- DEVICE APPROVAL (user, 2026-10-11): "Yes, deploy + restart (Recommended)" and "2-min simulated outage (Recommended)" — iptables drop of ICMP+DNS egress on rmnet ~2 min, watchdog stays disabled, no SMS expected.
- REDEPLOY APPROVAL (user, 2026-10-11, after a v0.1.17-draft install from development replaced the first deploy at 16:38): "Yes, redeploy (Recommended)" — includes a short outage re-check and a Watchdog probe-interval save test.
- Watchcat trigger = producer's fail_elapsed_sec (already-approved follow-up, connection-watchdog.md:446); propagate_probe_interval retired.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | RM520N current state: ping/watchdog/live-latency/alerts map | recon | qm-scout | none | ACCEPTED |
| R2 | the101 Connection Quality backend + widget data contract | recon | qm-scout | none | ACCEPTED |
| R3 | Live device: who pings, what JSON, which alerts fire | recon | modem-investigator | none | ACCEPTED |
| A1 | Attack draft plan | judgment | qm-advocate | none | ACCEPTED (2 blocks, 6 changes — folded) |
| B1 | conn_state lib + staleness dedupe + watchcat fail_elapsed trigger + config ownership | build | cgi-endpoint-builder | lib/conn_state.sh, qmanager_poller, qmanager_watchcat, monitoring/watchdog.sh, settings/ping_profile.sh | ACCEPTED e61cfeb4 (verifier batched at end) |
| G1 | Installer pre-gate for Sites daemon/unit | judgment | installer-safety-auditor | none | ACCEPTED (CLEAR, 8 must-fix -> B4 ticket) |
| B2 | One detector: events.sh + alert_engine single wait + configured-loss degraded + publish thresholds | build | cgi-endpoint-builder | events.sh, alert_engine.sh, monitoring/alerts.sh, settings/quality_thresholds.sh, qmanager_poller | ACCEPTED 30426c55 |
| B3 | DNS lookup background job + dns_lookup_ms + types | build | cgi-endpoint-builder | qmanager_ping, qmanager_poller, types/modem-status.ts | ACCEPTED aec8a1ad |
| B4 | Sites backend: daemon, config, CGI, rollups, installer lockstep | build | cgi-endpoint-builder | new files + install/uninstall per G1 | ACCEPTED 3af1cc15 (post-verify by installer auditor at end) |
| D1 | Docs + router + release notes | docs | docs-writer | docs/reference/**, RELEASE_NOTES.md | ACCEPTED (docs commit) |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| B1 | 1 | cgi-endpoint-builder | r1 | DONE_WITH_CONCERNS -> accepted e61cfeb4 | crlf, device bash/ash lib run | commit body |
| B4 | 1 | cgi-endpoint-builder | r1 | DONE_WITH_CONCERNS -> accepted 3af1cc15 | crlf, device sweep + CGI as www-data | commit body |
| B2 | 1 | cgi-endpoint-builder | r1 | DONE_WITH_CONCERNS -> fix wave 1 (post-outage loss tail logs extra pair) | device CGI + faked-clock driver | — |
| B2 | 2 | cgi-endpoint-builder | fix1 | DONE -> accepted 30426c55 | crlf, device driver re-run | commit body |
| B3 | 1 | cgi-endpoint-builder | r1 | DONE -> accepted aec8a1ad | crlf, tsc, isolated DNS job on device | commit body |
| W1 | 1 | conductor | direct | watchdog.sh probe_interval proxy for redesigned form -> 3fb535ba | device save test | commit body |
| V1 | 1 | qm-verifier | r1 | FAIL (F1 outage-hidden race in events.sh; F2-F6 low) | gates, device md5 3-way | — |
| G2 | 1 | installer-safety-auditor | post | CLEAR (F7 tmp pre-create note) | device read-only | — |
| FX1 | 1 | cgi-endpoint-builder | fix-wave-1 | DONE -> accepted 193e221c (F1-F7) | crlf, device outage re-run | commit body |
| V2 | 1 | qm-verifier | focused | FAIL (D1 Tier 3 not reverted on stale cooldown; D2 untrusted sites pid file) | device md5, read | — |
| FX2 | 1 | conductor | inline | D1/D2 fixed -> 27336a7b | device sh -n + www-data pid test | commit body |
| V3 | 1 | qm-verifier | focused | PASS_WITH_NOTES (2 low notes, see Handoff) | device md5, read | — |
| D1 | 1 | docs-writer | r1 | DONE_WITH_CONCERNS -> accepted (blank-line fix by conductor) | symbol grep, link check, CRLF | — |

## Findings that survive
- Only one prober exists (qmanager_ping); watchcat + poller only read /tmp/qmanager_ping.json. Duplication is in config, verdict, alerts.
- NDJSON history rows already match the101 PingHistoryEntry {ts,lat,avg,min,max,loss,jit} (qmanager_poller:1378-1390); ~16 s/row on device.
- RM520N carrier DNS = /etc/resolv.conf (-> /var/run/resolv.conf); nslookup is nslookup.bind; bare `nslookup` hangs on stdin — always `</dev/null`.
- /usr/bin/curl present under base PATH; `-w %{time_connect}` gives sub-ms timing (no %N needed). /usrdata has ~89 MB free (shared UBIFS).
- alert_engine threshold_minutes is the ONLY channel dispatch gate (alert_engine.sh:406-447) — never "accept and ignore" it (advocate C1).
- quality_thresholds.sh:103-104 rewrites the file with two keys — new keys there get erased (advocate C10).
- Libs install by glob (install_rm520n.sh:1617-1621) — a new lib needs no installer edit; a new daemon/timer does.
- Advocate full report: .orchestra/scratch/2026-10-11-cq-unify-advocate.md (scratch — key items copied here).

## Device state
RM520N-GL 61368cd2: all 15 run files deployed, md5 = HEAD 27336a7b (close-out check). qmanager-sites active, NRestarts=0. /tmp/cq_backup holds the pre-run originals of 11 files (remove at close). Watchdog disabled ([watchcat].enabled=0), as found. RG501Q-EU unreachable all run — untested.

## Handoff — NEXT ACTION
Run complete on worktree-wt+cq-unify (base 73e88958; development merged in at ac0e750a). Next: user decides merge into development / keep / discard; after a merge rerun `bunx tsc --noEmit`.
Open (low, from V3): (1) Tier 3 aborting after CFUN=0 fails leaves current_sim_slot "null", so the fallback runs a needless radio cycle — the failure path already had this, the stale path now shares it. (2) qmanager_sites pid-file check has a narrow TOCTOU window (~2/200 under an adversarial loop).
Frontend follow-ups: Connection Quality dashboard widget port; Sites page UI; dashboard.json:50 "one in ten" tooltip now false; samples-card.tsx:70 hard-coded 20 % loss; alerts UI caps wait at 60 (backend 1440); Watchdog probe control now mirrors Connection Quality; quality_thresholds GET new fields unused; Watchdog "Failed checks n / fail_threshold" now approximate (down decision is time-based); shapes.ts:224-225 comment names retired _qt_apply_* functions.
Backend follow-ups: Sites 30d/90d reads ~3.3 s (cache if needed); alerts.sh save_settings write path (secret set / discord stop) never run live; [watchcat].probe_interval is an inert seeded key; cq_deploy.ps1 only `start`s qmanager-sites, so a redeploy needs a manual restart.
