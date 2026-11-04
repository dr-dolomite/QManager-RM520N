---
name: poller-cycle-3s-and-blank-band-reads
description: Poller's real Tier-1 cycle is ~3s (not POLL_INTERVAL=2), and out-of-service samples blank lte_band, silently breaking the prev/current event chain
metadata:
  type: reference
---

Two live-measured facts about `qmanager_poller` that the source does not state and that
change how you read `/tmp/qmanager_events.json`.

## 1. The real Tier-1 cycle is ~3 seconds, not 2

`qmanager_poller:39` sets `POLL_INTERVAL=2`, but that is a `sleep 2` *after* the cycle
body. Measured on the live device by sampling `/tmp/qmanager_status.json`'s `.timestamp`,
consecutive poller samples are **3 s apart** (e.g. `…350 → …353 → …356`).

**Why it matters:** when reconstructing an event burst from `/tmp/qmanager_events.json`
timestamps, a **3-second gap between two events means they came from two CONSECUTIVE poll
cycles** — not from cycles a second apart. Any "N consecutive samples" reasoning must use
3 s, or you will under-count how tightly an event storm was packed.

## 2. Out-of-service samples blank `lte_band` and break the prev/current chain

`parse_serving_cell` (`scripts/usr/lib/qmanager/parse_at.sh:97`) resets `lte_band=""` at
the top, then bails early in two places without ever setting it:

- `:113-119` — no `+QENG:` lines in the response (logs
  `parse_serving_cell: no +QENG: lines in response`)
- `:232-235` — LTE-only branch, `*SEARCH*` case, `return`s with `lte_state="searching"`

Both leave `lte_band=""`. `events.sh` then guards on
`[ -n "$lte_band" ] && [ -n "$prev_ev_lte_band" ]`, so a blank sample emits nothing —
**but `snapshot_event_state` still stores the blank as `prev_ev_lte_band`**, so the
*following* sample is also suppressed.

**Diagnostic consequence — read event chains as a graph, not a sequence.** Because blanks
swallow transitions, `/tmp/qmanager_events.json` shows asymmetric band transitions that
look impossible: e.g. `B8 → B41` twenty times with **zero** `B41 → B8`. That asymmetry is
not a parser bug; it means the return leg passed through a blank/out-of-service sample.

**How to apply:** when you see two consecutive `band_change` rows whose `from` does not
match the previous row's `to`, at least one blank sample sits between them — go
confirm it with `grep "no +QENG: lines" /tmp/qmanager.log`. Build an in/out-degree table
of the transitions (`jq -r 'select(.type=="band_change")|.message' … | sed 's/^LTE band
changed from //;s/ (PCI.*//' | sort | uniq -c`); nodes with far more exits than entries
are where the radio kept dropping out.

See also [[live_ca_state_globe_sim]] — the test SIM's site reuses PCI 271 across all its
carriers, so `pci_change` stays at zero even while the band cycles across five bands.
PCI is useless as a "did the cell really change" discriminator on this device.
