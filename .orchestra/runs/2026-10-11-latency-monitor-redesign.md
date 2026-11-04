# Run: Latency Monitor redesign + Sites UI port
status: closed
lane: full
base: 0e65fdfde68fc1bc2e2bf584c6f87ba30c1419de   branch: worktree-wt-latency-redesign (.claude/worktrees/wt-latency-redesign)   opened: 2026-10-11   lead: opus

## Request
"Port the Sites page UI next as part of Latency Monitor feature page. However, rather than adding the new sites UI to the existing design, I want you to first, redesign the whole feature page from the ground up with the same reasoning and premise that I have with design updates of Watchdog and Network Events. Please ask Watchdog feature page redesign for more context. Make sure that the new design follows our design language, rules and philosophy including proper animations. Load up /impeccable context too and show the recommended design change to an artifact first to ask for approval before building."

## Decisions taken — do not re-ask
- Routed through qm-redesign-review (recon + plan); artifact gate before any code.
- GATE passed 2026-10-11 (user): "Approved, go with your recommendations and build it. Assign building to another Opus agent" → Samples table removed; Live moves to Right now strip; brand marks in brand colour; monogram for unknown hosts; extra brands bundled; Right now strip kept. Artifact v2 is the brief.
- Close-out pre-authorised (user): "merge it into development once it passes".
- Main checkout has foreign uncommitted edits (components/monitoring/network-events/activity-card.tsx, shapes.ts, docs/reference/recent-activities.md) from a parallel session: do not touch.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Latency page surface map | recon | qm-scout (pin) | none | ACCEPTED |
| R2 | the101 Sites UI + our sites backend contract | recon | qm-scout (pin) | none | ACCEPTED (the101 has NO Sites UI) |
| R3 | Watchdog redesign premise | recon | cross-session ask to "Watchdog feature page redesign" | none | ACCEPTED |
| P1 | Review artifact (critique + mock) | plan | conductor | scratchpad only | VERIFIED — https://claude.ai/artifact/3p3Xs4jR5jgv3No3aBduZG |
| G1 | Gate: approve artifact + open calls | gate | user | none | ACCEPTED |
| B1 | Build the redesign + Sites UI | build | ui-builder (pin, opus) | components/monitoring/latency-monitoring/**, hooks/use-sites.ts, types/sites.ts, public/locales/*/dashboard.json | REPORTED(DONE) |
| V1 | Browser proof (shim) | verify | conductor | none | VERIFIED (viewed builder captures; verifier re-ran) |
| V2 | Blind verify | verify | qm-verifier (pin) | none | VERIFIED (PASS_WITH_NOTES) |
| D1 | Docs + release note | docs | docs-writer (pin) | docs/reference/*, docs/FRONTEND.md, RELEASE_NOTES.md | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| B1 | 1 | ui-builder | r1 | DONE: 12 files +686/-2017 plus 8 new; page 1,095px at 1440 (was 1,446); skeleton = loaded at 1440 and 390 | i18n:check, tsc, eslint (changed), build | .orchestra/scratch/lm-*.png |
| V2 | 1 | qm-verifier | r1 | PASS_WITH_NOTES: 13/13 criteria; notes: unreachable tripped by modem_reachable (medium), chip hidden when unreachable, hardcoded " s" axis unit, Shopee hex outside map, LATENCY_THRESHOLDS still used only inside types/modem-status.ts, gateway cells render | i18n, tsc, eslint, build, headless 1440/390 | scratchpad v-*.png |
| fix 1 | - | conductor (Direct) | - | ACCEPTED: unreachable = fetch error or snapshot > 60 s old (UNREACHABLE_AGE_SEC); Unknown chip when unreachable; axisMs takes unit_s; Shopee folded into SITE_MARKS (dotless key = first label) | tsc, eslint, i18n:check, build | this ledger |
| D1 | 1 | docs-writer | r1 | DONE_WITH_CONCERNS (removed a stale PingEntriesCard NOTE; history cap is 8640 rows not 24 h); conductor corrected the unreachable rule in latency-monitor.md | symbol greps, CRLF | docs diff |

## Findings that survive
- Watchdog redesign ledger: .orchestra/runs/2026-10-11-watchdog-redesign.md (artifact https://claude.ai/artifact/NjB4MfTeN54N96SrF6Lexw).
- Network Events redesign ledger: .orchestra/runs/2026-10-11-network-events-redesign.md (artifact https://claude.ai/artifact/3VAC8LrMCZY5e3TR4X9kqF).
- Latency page was last re-authored in f03fb857; Sites backend contract: docs/reference/sites-monitor.md.

- User mid-run: Watchdog is context only ("compact design with bento layout ... hierarchy ... scannable"), not a layout to copy. Wants site brand logos (screenshot of a UniFi-style Sites grid).
- the101 has no Sites UI; the Sites page is a new design on docs/reference/sites-monitor.md. react-icons/si (already a dep) ships 12 of 13 default brand marks (not cellmapper).
- Measured: current page 1,446px at 1440 (phone 1,921); band reads live window while cards read range; 12 h/Daily give 2/1 points (24 h RAM ring); chart Y domain set by 1,942 ms max; 3 loss cuts vs configured 250 ms/30 %.
- Artifact source: session scratchpad latency-review.src.html, built by splice.py from lm-css.css / lm-body.html / lm-script.js / mockdata.js (finalize.py --shot __SHOT__=before-1440.png).

- Amendment 1 (user): "We are now overly reliant with graphs. Lessen it a bit." Sites = reference grid (logo, name, latency); History line graph only; Sites ranges = 3; remove "Checked 1 min ago, every 5 min", the answer-count chip and similar handholding. Applied in artifact v2 (1 h / 24 h / 7 d; strips, loss lane, figure captions removed).

## Device state
RM520N-GL 61368cd2: read-only captures only (status/connectivity, ping history, sites 24h/7d, sites raw) via a minted session, deleted after; /tmp/cqcap_* removed. Nothing deployed.

## Handoff — NEXT ACTION
Closed 2026-10-11. Committed on worktree-wt-latency-redesign and fast-forwarded into development per the user's pre-authorisation. Not run on the device; the user's tarball run is the hardware proof. Open low notes: gateway cells would render on a LAN-gateway device; Sites skeleton sized for 13 cells; www. kept as typed when adding a host.
