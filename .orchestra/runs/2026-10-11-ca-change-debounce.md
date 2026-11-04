# Run: Debounce ca_change through _ev_settle
status: closed
lane: lite
base: e26d4e51   branch: development   opened: 2026-10-11   lead: opus

## Request
Route LTE/NR CA state in events.sh through the _ev_settle settle + flap mechanism so a
flapping SCC produces one warning "unstable" row per episode; genuine changes still log
promptly; keep ca_change types/severities; update docs/reference/recent-activities.md.

## Decisions taken — do not re-ask
- Gate: sticky opt-in flag on _ev_settle for CA channels only (band/PCI unchanged); one
  churn row per episode; episode ends after 5 quiet min with "settled on" (info) or
  "settled inactive" (warning). Empty carrier list = no observation.
- Wording follows the current code contract "<tech> CA churn detected" (no count, no dash).
- User: "Yes, restart OK" — restart qmanager poller on the RM520N-GL to load events.sh.

## Plan
| id | task | class | seat | write set | state |
|---|---|---|---|---|---|
| T1 | events.sh sticky settle + CA blocks | build | conductor inline | scripts/usr/lib/qmanager/events.sh | ACCEPTED (bash -n ok) |
| T2 | deploy + watch ring | proof | conductor | device | watch 1: 2 rows / 44 dips (double report, fixed); watch 2: 3 CA rows / 167 dips (churn, held deactivate, activate) |
| T3 | blind verify | verify | qm-verifier | — | PASS_WITH_NOTES (comments, _ev_ca_diff bug) — fixed |
| T3b | RG501Q portability residue (device offline) | verify | busybox-portability-checker | — | SAFE TO SHIP |
| T4 | doc update | docs | conductor | docs/reference/recent-activities.md, README.md row | ACCEPTED |

## Findings that survive
- Live: 281/300 ring slots were ca_change; each dip is ONE sample (3s) of QCAINFO with no
  LTE SCC; qcmd never failed (no "qcmd_exec failed" in /tmp/qmanager.log).
- Plain _ev_settle clears flapn on settle-back, so one-sample dips never reach the threshold.
- QCAINFO runs every cycle (qmanager_poller ~2387), not Tier 2.

- Sticky latch must not clear on the cold-start adopt (last empty): watch 1 reported one
  episode twice (1394, 1934). Fixed: clear only when last non-empty and changed.
- _ev_ca_diff pre-existing bug: pure add read "(+B7, -B7)"; fixed to one "added|removed" line,
  verified on device jq.

## Device state
RM520N-GL 61368cd2: events.sh deployed md5 b892136e (= working copy), poller restarted at
1791713355 and again at 1791714330 to load the latch fix (approved). Pre-run md5 edf10d61 (= HEAD). Nothing left in /tmp. RG501Q-EU offline:
host has no address on 192.168.120.x.

## Handoff — NEXT ACTION
Closed. Open: RG501Q-EU never ran the new file (offline); slow flapping (dips >~50s apart)
never reaches 6 per window and logs nothing — threshold tuning was out of scope.
