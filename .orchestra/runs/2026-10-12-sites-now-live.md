# Run: Sites "Now" live mode + Dota 2 mark
status: closed
lane: full
base: a8249a38   branch: development (worktree after gate)   opened: 2026-10-12   lead: opus

## Request
"yes go ahead, include the Dota 2 icon" — on: a default "Now" tab on the Sites card that, while open and visible, refreshes about every 2 s; leaving it returns to the normal cadence. Live checks connect-only every 2 s plus a full HTTPS check every 30 s (as proposed before measurement).

## Decisions taken — do not re-ask
- "Now" is the first and default range tab; shows the latest value per site, no live chart.
- Live samples never enter raw/rollups/history; normal interval_sec sweeps keep feeding history.
- Leasing: the page's `?range=now` GET renews a lease; the daemon goes live only while the lease is < ~10 s old.
- Dota 2: add `SiDota2` row to SITE_MARKS (dota2.com favicon is 16 px, rejected by FAVICON_MIN_PX).
- GATE 2026-10-12: "2 s HTTP, no HTTPS (Recommended)" — live probe = HTTP HEAD on port 80 every ~2 s, NO 30 s HTTPS check (~25 MB/h, ~+25% CPU, measured).
- DEVICE 2026-10-12: user chose "Yes, deploy and restart" — deploy qmanager_sites + sites.sh to RM520N-GL, restart qmanager-sites.service; new version stays installed.
- Worktree: .claude/worktrees/wt+sites-now-live, branch worktree-wt+sites-now-live, BASE a8249a38.

## Plan
| id | task | class | seat | write set | state |
|---|---|---|---|---|---|
| T1 | daemon live loop + CGI range=now/lease | build | cgi-endpoint-builder | scripts/usr/bin/qmanager_sites, scripts/www/cgi-bin/quecmanager/monitoring/sites.sh | VERIFIED c9d162a2 |
| T2 | "Now" tab, 2 s visible-only polling, Dota 2 mark, i18n | build | ui-builder | types/sites.ts, hooks/use-sites.ts, components/monitoring/latency-monitoring/**, public/locales/** | VERIFIED c9d162a2 + 8e8806ec |
| T3 | docs | docs | docs-writer | docs/reference/sites-monitor.md, latency-monitor.md, README.md | ACCEPTED 33047f70 |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| T1 | 1 | sonnet/high | r1 | DONE_WITH_CONCERNS (disable did not stop live; conductor fixed in sites.sh) | crlf, bash -n, /tmp daemon run, www-data CGI | .orchestra/scratch/sites-now-live-proof2.txt, -proof3-cgi.txt |
| T2 | 1 | opus/medium | r1 | DONE_WITH_CONCERNS (Dota ink not red: 2.88:1 dark) | tsc, i18n, build, browser shim | scratchpad build.log |
| V | 1 | qm-verifier opus/high | — | PASS_WITH_NOTES; note B (2 s polling while disabled) fixed in 8e8806ec | all gates, device e2e, 3-way md5 | .orchestra/scratch/verify-sites-now-build.log |
| T3 | 1 | opus/medium | r1 | DONE | source citations | — |

## Findings that survive
- RM520N-GL bash is 3.2.57: NO `EPOCHREALTIME`, NO `declare -A`; `date +%s%N` prints a literal `%N`. ms timing must come from curl `-w`.
- Device curl 8.12 protocols: file ftp ftps http https ipfs ipns ws wss — no telnet, no --connect-only.
- Per-site cost on rmnet_data0: HTTPS HEAD ~8.8 KB; HTTP HEAD :80 ~1.1 KB. Live mode ~25 MB/h, ~+25 CPU points (single core).
- lighttpd on the device 301s http://127.0.0.1 to https; drive CGI with `curl -k https://127.0.0.1/...`.
- Open (low, accepted): site-list edits reach live ticks only at the next sweep; range switch shows old figures until the new read lands (pre-existing behaviour).

## Device state
RM520N-GL (61368cd2): /usr/bin/qmanager_sites md5 b3b9d002532ad694560bf8ec55709161 and CGI sites.sh md5 d6240f21167c908e40d38f1dd882deb2 deployed 2026-10-12 16:26 under the user's "Yes, deploy and restart" = HEAD = working copy (8e8806ec/33047f70 changed no scripts). qmanager-sites.service active, NRestarts 0. /tmp staging removed. RG501Q-EU not tested (offline).

## Handoff — NEXT ACTION
Ask the user: merge worktree-wt+sites-now-live into development, keep for PR, or discard. After a merge, re-run tsc / i18n:check / build on development. Release notes not written (v0.1.17 notes are finalized; next version is the user's call).
