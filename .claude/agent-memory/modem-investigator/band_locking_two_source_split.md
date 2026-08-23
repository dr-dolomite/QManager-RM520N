---
name: band-locking-two-source-split
description: /cellular/cell-locking derives posture from two unrelated reads with unrelated failure modes — live ue_capability_band vs a boot-only policy_band snapshot — so one failing alone fabricates a "Locked" verdict
metadata:
  type: reference
---

The band-locking page's posture verdict is a comparison of two values that come from **different processes, at different times, with independent failure modes**:

| Axis | Source | Freshness |
| --- | --- | --- |
| `lockedBands` | `bands/current.sh` → live `AT+QNWPREFCFG="ue_capability_band"` | on mount + after a lock, nothing else |
| `supportedBands` | poller `/tmp/qmanager_status.json` `.device.supported_*_bands` → `AT+QNWPREFCFG="policy_band"` | **boot only**, RAM-cached in `/tmp/qmanager_supported_bands.env` (survives poller restarts, not reboot) |

Measured live 2026-08-23 (idle modem, nothing locked): the two AT queries return **byte-identical** `lte_band` / `nsa_nr5g_band` / `nr5g_band` lists. They differ only in `gw_band` (`policy_band` includes band 6, `ue_capability_band` does not), which proves they are distinct queries rather than aliases — but on the LTE/NR axes the page compares a value against itself.

**Why this matters:** because the two agree when everything works, any disagreement is a *failure signature*, not a radio state. If the live read fails while the boot cache is populated, `locked=[]` against `supported=[31]` — and the UI reads that as a deliberate lock.

**How to apply:** when investigating anything on `/cellular/cell-locking`, always check BOTH sources before concluding the modem is in an odd state. `cat /tmp/qmanager_supported_bands.env` gives the boot snapshot; `qcmd 'AT+QNWPREFCFG="ue_capability_band"'` gives the live side. Do NOT reason from `/tmp/qmanager_status.json` alone — it can be hours stale on this axis and there is no refresh path short of a reboot. Related: [[qcmd_passthrough_branch_exits_zero]].

Handy read-only failure repro (starves the poller ~5s, no writes):
`( flock -x 9; sleep 9 ) 9</tmp/qmanager_at.lock &` then curl/run `current.sh` — it returns `{"success":false,"error":"modem_error"}` with no `current` key at all.
