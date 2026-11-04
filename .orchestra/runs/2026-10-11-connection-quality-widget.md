# Run: Connection Quality dashboard widget (replaces Live Latency)
status: closed
lane: full
base: 700bb603   branch: wt/cq-widget (.claude/worktrees/wt+cq-unify)   opened: 2026-10-11   lead: opus

## Request
Proceed to porting Connection Quality widget now. It will fully replace the Live Latency widget card.

(Context: follow-up to .orchestra/runs/2026-10-11-connection-quality-unification.md, which shipped the backend — connectivity.thresholds, dns_lookup_ms, dns_resolver, ping history NDJSON. Reference: QManager-the101 components/dashboard/connection-quality.tsx; screenshot: Internet 47 ms, DNS lookup 1780 ms, Probing 1.1.1.1, Reachability strip, Jitter strip, Typical / Worst / Loss.)

## Decisions taken — do not re-ask
- Lane Full, frontend only (ui-builder); no new backend field expected — re-lane if recon finds one.
- USER (mid-recon): "You may even simply copy-paste the component file directly from the qmanager-the101 and just re-align it with our own backend." -> straight port: copy the101's file(s), change only data wiring / RM520N canon deltas; no redesign review.
- GATE (user, 2026-10-11): Speedtest = "Option 1 at the bottom part since theres still some white space for it that we can utilize." (Speedtest row moves into the bottom of the Connection Quality card). Thresholds = "Configured thresholds (Recommended)" (strip uses connectivity.thresholds, 250 ms / 30 % fallback only).
- qm-advocate skipped: straight port per user instruction, no unproven hypothesis; the two real forks went to the gate.
- Worktree: reused wt+cq-unify dir on a fresh branch wt/cq-widget from development 700bb603 (development was linearly rewritten; content of the merge a76ced44 verified identical).

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | the101 Connection Quality widget: files, data contract, primitives, i18n | recon | qm-scout | none | ACCEPTED |
| R2 | RM520N Live Latency card: mount, hook, consumers, available fields/primitives | recon | qm-scout | none | ACCEPTED |
| B1 | Port connection-quality.tsx, carry Speedtest row, retire live-latency.tsx, i18n x5, configured thresholds | build | ui-builder | components/dashboard/{connection-quality.tsx,live-latency.tsx,home-component.tsx,shapes.ts}, public/locales/*/dashboard.json, types/modem-status.ts (only if needed) | ACCEPTED 9d156cbe |
| V1 | Blind verify with real modem JSON | judgment | qm-verifier | none | ACCEPTED (PASS_WITH_NOTES) |
| FX1 | Latency bars graded on configured threshold | build | conductor inline | connection-quality.tsx | ACCEPTED e029d43b |
| D1 | Docs + release notes | docs | docs-writer (+ conductor speedtest.md) | docs/reference/**, RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| R1 | 1 | qm-scout | r1 | DONE_WITH_CONCERNS -> accepted | read-only | — |
| R2 | 1 | qm-scout | r1 | DONE_WITH_CONCERNS -> accepted | read-only | — |
| B1 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS -> accepted 9d156cbe (sample-data render only) | i18n, tsc, eslint, icons, build | commit body |
| V1 | 1 | qm-verifier | r1 | PASS_WITH_NOTES (medium: bars on fixed 60/100 ms) | gates + real-data render | — |
| FX1 | 1 | conductor | inline | e029d43b, real-data render: bars green 23 %/42 % | tsc, eslint, Browser pane | commit body |
| D1 | 1 | docs-writer | r1 | DONE_WITH_CONCERNS -> accepted; conductor fixed speedtest.md | CRLF, source check | — |

## Findings that survive
- the101 card = components/dashboard/connection-quality.tsx (855 lines, one file) + useLatencyHistory (30 s, fetch_ping_history.sh) + shapes QUALITY/PAIR_TITLE/PAIR_DESC; en-only i18n (dashboard.json connection_quality, the101 :547-583).
- RM520N Live Latency (live-latency.tsx, CRLF) reads only latency_history/history_interval_sec/latency_ms and hosts the ONLY dashboard Speedtest entry (useSpeedtest({watch:true}) + SpeedtestDialog).
- RM520N connectivity has ping_target (no probe_target), avg/max_latency_ms, packet_loss_pct, jitter_ms, dns_lookup_ms, thresholds. useLatencyHistory exists (hooks/use-latency-history.ts), used by /monitoring latency only.
- Glyphs public/radar/cloud_off/dns/speed all in material-symbol-names.ts.

## Device state
Nothing deployed to the modem by this run. Real status/history JSON was captured read-only (as www-data, session file removed); the copies in public/__cqcap, out/ and scratchpad are deleted (status file held IMEI/IMSI/ICCID/phone; never committed).

## Handoff — NEXT ACTION
Run complete on wt/cq-widget (base 700bb603). Next: user decides merge into development / keep / discard; after a merge rerun tsc + i18n:check + build.
Open (low): one failed ping turns a strip cell red regardless of loss_pct (from the101); bar amber at >= cut vs strip cell at > cut (exactly-at-cut mismatch); off-scale rounded-[3px]/[2px] and 10.5/11/13/19 px text from the101; `timeline` glyph unused in the font subset; Speedtest running state not seen live; entrance animation not seen in a visible tab; connection-quality.md:353 says "5-second poll" (actual history_interval_sec*1000+250).
