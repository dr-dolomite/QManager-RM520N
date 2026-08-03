---
name: apn-bracket-live-experiment-facts
description: Live-verified facts from the 2026-08-03 APN attach-cycle experiment — COPS=0 is non-blocking, the bracket migrates the WAN across rmnet_dataN, data usage reads rmnet_ipa0 so it is immune, plus the clean-control profile payload and the busybox date %N trap
metadata:
  type: project
---

Measured on the live RM520N-GL (GLOBE SIM) on 2026-08-03 while reproducing the stale-bearer APN bug.

**Why:** these are the load-bearing numbers and traps behind the `apply_apn` attach-cycle fix. They cost a full controlled experiment to obtain; re-deriving them means writing to a live modem again.

**How to apply:** reuse when instrumenting any AT sequence that detaches/reattaches the radio, or when re-running this experiment.

### The COPS bracket's live behavior
- `AT+COPS=0` **returns `OK` in ~0.16s — it does NOT block until re-registration.** Same for `AT+COPS=2` (~0.09s) and the `AT+CGDCONT` write (~0.16s). Every AT call in the bracket holds the `flock` for well under a second, so the bracket does **not** starve the poller: zero `modem_busy` / `modem_timeout` in `/tmp/qmanager.log` across two full brackets.
- Re-registration after `COPS=0` returns completes in **~1.3–4s** (CEREG walks `0,0` → `0,2` → `0,1`). The negotiated APN in `AT+CGCONTRDP=1` becomes readable in the *same* poll that registration lands — there is no extra lag. A verification poll ceiling of ~15s is generous.
- Side effects on Recent Activities: **no** `signal_lost` / "modem unreachable" event fires (that prediction is refuted). What *does* fire is a spurious `band_change` event, plus poller `lte_state: connected → unknown → connected` for a ~5s blind window.

### The WAN hops rmnet interfaces on every attach cycle
Each detach/reattach moves the data call to a **different `rmnet_dataN`**: observed `rmnet_data0` → `rmnet_data1` → back to `rmnet_data0`. The old interface goes `state DOWN` keeping its counters frozen; the default route follows the new one.

**But the data-usage counter is immune:** `qmanager_poller` reads `NETWORK_IFACE="rmnet_ipa0"` (`scripts/usr/bin/qmanager_poller:55`) — the aggregate parent, which stays `UP` and whose counters climbed monotonically across both brackets. No spurious usage reset. Do not "fix" a reset that cannot happen. (There is also a rebase-on-reset guard at `:785` as a second net.)

### Building a clean APN-only control profile
`profile_save` force-defaults `scenario.default` to `"balanced"`, which makes the apply send `AT+QNWPREFCFG="mode_pref",AUTO` **unconditionally** (no skip-if-unchanged) — that contaminates any APN experiment. To suppress it through the supported endpoint, POST `{"scenario":{"default":""}}`: jq's `//` only falls back on `null`/`false`, so `""` survives, the validation loop word-splits to zero iterations, and `apply_apn`'s sibling `apply_scenario` skips on `[ -z "$p_scenario_id" ]`.

Also set `ttl`/`hl` to the **live** values (read them; they were 64/64, not 0). Omitting them defaults to 0 and the apply will tear down the TTL/HL iptables rules.

### Device gotchas hit along the way
- **busybox `date +%s.%N` prints a literal `%N`** — sub-second timing must use `cut -d' ' -f1 /proc/uptime`.
- `ttl_state_read_live` silently returns `0 0` if you source `ttl_state.sh` without `platform.sh` (which defines `run_iptables`). Source both or you will misread live TTL as unset.
- `busybox nc` has no `-z`, so it cannot do a TCP port probe; use `curl` against `/generate_204` instead.
- ICMP to 1.1.1.1 and 8.8.8.8 was 100% loss while 9.9.9.9 answered at 69ms and HTTP/DNS worked fine — per-destination carrier ICMP filtering. Never judge "connectivity restored" from a single ping target; use the HTTP 204 check.
