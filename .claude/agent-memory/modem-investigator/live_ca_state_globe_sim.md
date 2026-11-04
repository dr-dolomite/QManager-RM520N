---
name: live-ca-state-globe-sim
description: Live test modem's serving mode is VARIABLE — observed LTE-only earlier, but full EN-DC (LTE B3 PCC + LTE B1 SCC + NR5G B41 SCC) on 2026-07-30; never treat either as an invariant
metadata:
  type: reference
---

The test modem's serving mode is **not stable across days**. Re-probe; do not assume.

- **Earlier observation (no longer an invariant):** camped LTE-only, B41 PCC + B3 SCC, `nr.state = "inactive"` — which made NSA/NR `AT+QCAINFO` shapes look unobservable on this device.
- **2026-07-30 observation:** full EN-DC. `AT+QENG="servingcell"` returned `+QENG: "NR5G-NSA",515,03,262,-89,24,-10,528030,41,8,1` alongside the LTE line, and `AT+QCAINFO` returned three rows:
  - `"PCC",1350,75,"LTE BAND 3",1,295,-94,-8,-66,25` (10 fields)
  - `"SCC",150,100,"LTE BAND 1",1,295,-92,-7,-77,23,0,-,-` (13 fields)
  - `"SCC",528030,8,"NR5G BAND 41",262,-91,-11,2681` (**8 fields — NR SCC arity differs from LTE SCC**)

**Why it matters:** a recon that concludes "NR is unobservable here" wrongly declares NR-side code untestable, and a redesign that assumes LTE-only under-builds the 5G surface.

**How to apply:** probe `AT+QENG="servingcell"` + `AT+QCAINFO` at the start of any investigation that depends on serving mode. Two structural facts that still hold: LTE PCC and SCC can share the same PCI (key dedup on EARFCN or band, never PCI alone), and LTE SCC lines carry 13 fields vs PCC's 10, so field count is not a reliable line-type discriminator.

Related: [[posh-ssh-connection-recipe]], [[per-antenna-signal-sentinels]], [[qcainfo_is_per_cycle_not_tier2]]
