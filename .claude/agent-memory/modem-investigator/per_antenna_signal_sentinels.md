---
name: per-antenna-signal-sentinels
description: AT+QRSRP/QRSRQ/QSINR use -140 (RSRP) and -20 (SINR) as "port inactive" sentinels, not just -32768 — the poller passes them through as real numbers and the frontend renders them as "poor"
metadata:
  type: reference
---

`AT+QRSRP` / `AT+QRSRQ` / `AT+QSINR` signal an inactive antenna port **three different ways**, and only one of them is handled.

Observed sentinels on the live RM520N-GL (2026-07-30, 117-sample history):

| Metric | Inactive-port marker | Handled by `_sig_val`? |
| --- | --- | --- |
| RSRP | `-140` | **No** — passes through as a number |
| RSRQ | empty CSV field | Yes → `null` |
| SINR | `-20` (LTE: empty field) | **No** for the NR `-20` form |
| any | `-32768` (documented) | Yes → `null`, but **never actually observed** |

The three arrive **correlated in the same sample**: `lte_rsrp:[-93,-140,-102,-140]` pairs with `lte_rsrq:[-9,null,-8,null]` and `lte_sinr:[27,null,20,null]`. So the RSRQ/SINR nulls are the reliable "port is off" tell; the RSRP `-140` in the same slot is the same event wearing a numeric costume.

**Why this bites:** both unhandled sentinels sit exactly on a threshold floor (`RSRP_THRESHOLDS.poor = -140`, `SINR_THRESHOLDS.poor = -20`), so `getSignalQuality` returns `"poor"` and `signalToProgress` returns `0`. A UI shows "-140 dBm, poor, empty bar" — indistinguishable from a genuinely terrible reading, when the truth is "this port is not in use right now."

**How to apply:** any per-antenna surface should treat `rsrp === -140` and `sinr === -20` as no-data, or (more robust) derive port liveness from whether RSRQ/SINR are null and gate the whole port on that. Flag this to `cgi-endpoint-builder` if the fix belongs in `_sig_val` rather than the frontend.

Related: [[live_ca_state_globe_sim]]
