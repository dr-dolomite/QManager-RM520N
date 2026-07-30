---
name: qcainfo-is-per-cycle-not-tier2
description: AT+QCAINFO runs EVERY poll cycle (~3.7s measured), not Tier 2 — the poller's own header comment and carrier-aggregation.md both say Tier 2 and are wrong; empty carrier_components measured at 0/103 polls
metadata:
  type: project
---

`AT+QCAINFO` (the source of `network.carrier_components[]`) is issued **unconditionally in `poll_cycle`**, immediately after `poll_serving_cell` — it is NOT inside the `cycle_count % TIER2_EVERY` gate. Verified 2026-07-29 at `scripts/usr/bin/qmanager_poller:2092-2106` (block sits above the Tier-2 `if` at `:2131`).

**Two places state the opposite and are wrong:**
- `scripts/usr/bin/qmanager_poller:16` header comment lists `AT+QCAINFO` under "Tier 2 (Warm): Every 15 cycles"
- `docs/reference/carrier-aggregation.md:9,12` — "Tier 2 poll", "Poller call site … Tier 2 block"

**Why:** a reader who trusts either one will size UI copy, debounce windows, and staleness gates against a ~60s refresh when the real refresh is ~3.7s. Two shipped strings already say "every ~30 seconds" (`components/cellular/active-bands.tsx:161`) and the redesign mock repeats it.

**How to apply:** when asked how fresh any CA field is, answer ~3.7s and cite the call site, not the doc. Also note the one exception: while `LONG_FLAG` (`/tmp/qmanager_scan_in_progress`-style) is set, `poll_cycle` returns early at `:2083` and CA keeps its *previous* values rather than being wiped.

**Measured empty-array rate (2026-07-29, GLOBE/TNT SIM, stable NSA link): 0 empty out of 103 consecutive distinct polls over ~6.3 min.** Recipe that works over SSH in one shot (avoid nested `\"` inside jq — it silently produces no output and looks like a hung loop):

```sh
n=0; e=0; prev=""; i=0
while [ $i -lt 380 ]; do
  m=$(stat -c %Y /tmp/qmanager_status.json)
  if [ "$m" != "$prev" ]; then prev=$m; n=$((n+1))
    L=$(jq -r ".network.carrier_components|length" /tmp/qmanager_status.json)
    [ "$L" = "0" ] && { e=$((e+1)); printf "EMPTY at %s\n" "$(date +%H:%M:%S)"; }
  fi
  i=$((i+1)); sleep 1
done; printf "RESULT polls=%s empty=%s\n" "$n" "$e"
```

Poller cadence measured the same way: 103 polls / ~380 s = **3.7 s**, consistent with the existing "cadence is ~3 s not 2 s" note (`POLL_INTERVAL=2` is a post-body `sleep`).

Related: [[poller_cycle_3s_and_blank_band_reads]], [[live_ca_state_globe_sim]]
