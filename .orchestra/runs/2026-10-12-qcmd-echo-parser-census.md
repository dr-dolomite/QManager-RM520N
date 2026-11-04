# Run: qcmd echo-line parser census
status: closed
lane: full
base: ae2fb9283691366598f151ab2dd23154f2be3b6f   branch: development   opened: 2026-10-12   lead: opus

## Request
Census every parser in scripts/usr/lib/qmanager/parse_at.sh, scripts/usr/bin/qmanager_poller and scripts/www/cgi-bin/** that extracts a value from qcmd output with a pattern that can also match the echoed command line (bare command-name regex, grep without a `^+PREFIX:` anchor, first-match-then-exit). For each suspect, capture the real qcmd output for that QUERY command on the RM520N-GL (prove serial 61368cd2) read-only, run the old parser against it, and report which ones actually mis-read. Read-only queries only. Report the list with evidence before changing anything.

## Decisions taken — do not re-ask
- Turn 1: investigation only. Turn 2 user: "both — anchor the two and census the other daemons". Device stays read-only.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Static census of echo-matchable parsers | recon | qm-scout (haiku/low) | none | ACCEPTED |
| R2 | Capture read-only qcmd output on RM520N-GL, run old parsers | recon | conductor | scratchpad + device /tmp | ACCEPTED |
| B1 | Anchor parse_ippt_mpdn_rule + parse_time_advance | build | conductor inline | parse_at.sh + 2 docs | VERIFIED |
| R3 | Census other daemons in scripts/usr/bin | recon | qm-scout (haiku/low) | none | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| R1 | 1 | qm-scout | 1 | DONE_WITH_CONCERNS: no live suspects; missed 4 CGIs + libs, conductor covered them | file review | .orchestra/scratch/qcmd-echo-census.md |
| R2 | 1-3 | conductor | 1 | runs 1-2 harness bugs (bash local expansion; BusyBox diff is unified); run 3 valid, control fired | device run 61368cd2 | session scratchpad echo/ |
| B1 | 1 | conductor | 1 | device proof on 61368cd2: HEAD vs edit identical on real output; synthetic echo fools HEAD only | device run + qm-verifier PASS_WITH_NOTES (stale doc line, fixed) | session scratchpad anchor/ |
| R3 | 1 | qm-scout | 1 | DONE: 0 suspects across 15 daemons + qcmd + apn_apply; conductor spot-check agreed | file review | — |

## Findings that survive
- Poller raw-qcmd sites (14 queries, poller:1054-2434) re-run on device: every current parser gives identical output with and without the echo line. Pre-ae2fb928 IPPT parsers DIFFER (control): NAT 0 vs 1, usbnet 0 vs 1, DNS disabled vs enable.
- qcmd_exec (poller:515) drops lines starting with AT; run_at (cgi_at.sh:17) drops line 1. Parsers behind them are immune.
- Safe only by accident: parse_ippt_mpdn_rule (reply says "MPDN_rule", echo "MPDN_RULE", case-sensitive key); parse_time_advance (parse_at.sh:896/910, echo has <3 commas so NF>=3 drops it).
- Both accidental-safe parsers now anchored (parse_at.sh:897, :911, :1148).
- Daemons censused: no echo-matching parse. Several non-empty checks pass only because of the echo (watchcat:442, tower_schedule:127, tower_failover:202/212); correct, since empty stdout means failure.
- scripts/debug_poller_at.sh called qcmd_exec, which it never defines (lines 43, 74); now raw qcmd like the rest of the script (user: "fix debug_poller_at.sh too").
- RG501Q-EU unreachable this session; anchor not run there.

## Device state
RM520N-GL 61368cd2: read-only queries only. Deployed parse_at.sh 192da5bf and poller e2a3855e match HEAD. /tmp/qm_echo_census removed at end.

## Handoff — NEXT ACTION
Closed. Nothing pending. The anchor takes effect on the device after the next OTA (boot-time parsers).
