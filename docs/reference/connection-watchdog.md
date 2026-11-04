# Connection Watchdog

> **Applies to:** RM520N-GL (SDX65) · verified 2026-10-11 (backend sections; serial `61368cd2`)
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

The Connection Watchdog (`qmanager_watchcat`) is a self-healing daemon that watches the modem's internet reachability and, when the link stays down, climbs a four-step recovery ladder from the gentlest fix (re-register to the network) to the most disruptive (reboot the device). It never pings on its own — it is a pure *state machine* that reads the verdict already produced by the ping daemon (`qmanager_ping`) and decides what to do about it. Its headline capability is **Tier-3 SIM failover**: on a dual-SIM RM520N-GL it can swap to the backup SIM slot when the primary carrier goes dark, ride on it, and later revert. This document describes the watchdog exactly as it ships on the RM520N-GL.

> ℹ️ NOTE: "Watchcat" (the daemon/binary name) and "Watchdog" (the UI name) refer to the same feature. The backend script, systemd unit, and config section all use `watchcat`; the page and copy say "Watchdog".

---

## Quick Reference

| Item | Value |
|------|-------|
| Daemon | `/usr/bin/qmanager_watchcat` (source: `scripts/usr/bin/qmanager_watchcat`) |
| systemd unit | `qmanager-watchcat.service` (`After=`/`Wants=` poller + ping) |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/monitoring/watchdog.sh` |
| Config | `/etc/qmanager/qmanager.conf` → `[watchcat]` section (JSON, via `qm_config_*`) |
| Live state file | `/tmp/qmanager_watchcat.json` (written by daemon, read by CGI + poller) |
| SIM-failover state | `/etc/qmanager/qmanager_sim_failover` (**persistent** — survives reboot) |
| Known-SIMs set | `/etc/qmanager/known_iccids` (**persistent** — replaces the retired single-value `last_iccid`; see [sim-detection.md](sim-detection.md)) |
| SIM-slot read-back gate | `scripts/usr/lib/qmanager/slot_verify.sh` (`verify_quimslot`) — gates Tier-3 switch/revert before either is trusted |
| Reboot log | `/usrdata/qmanager/crash.log` (**persistent**, root-owned — Tier-4 token bucket source; path from `crash_log.sh`, moved out of `/etc/qmanager` 2026-10 — see [alerts.md](alerts.md#the-user-breadcrumb-root-helper)) |
| Frontend page | `/monitoring/watchdog` (`components/monitoring/watchdog/`) |
| Ping source | `/tmp/qmanager_ping.json` (from `qmanager_ping`), read only through `/usr/lib/qmanager/conn_state.sh` — see [connection-quality.md](connection-quality.md) |
| Probe cadence | Not owned here: `interval_sec` in `/etc/qmanager/ping_profile.json` (Connection Quality). The CGI mirrors it as `probe_interval` |

**The recovery ladder, at a glance:**

| Tier | UI label | Action | AT sequence | Guard / note |
|------|----------|--------|-------------|--------------|
| 1 | Re-register to Network | Detach + reattach to the carrier | `AT+COPS=2` → `AT+COPS=0` | On by default |
| 2 | Restart Modem Radio | Power-cycle the radio | `AT+CFUN=0` → `AT+CFUN=1` | On by default; **skipped when tower lock is active** or a long-running AT command holds the modem |
| 3 | Switch to Backup SIM | Fail over to the other SIM slot | Golden Rule (below) | **Off by default**; requires a backup slot; misconfig **stops the ladder** (never reboots) |
| 4 | Reboot Device | Deferred system reboot | `reboot` | On by default; **token bucket** max N/hour, auto-disables when the cap is hit |

---

## How it works

### The state machine

The daemon runs one loop on a `check_interval` cadence (default 10s), transitioning between these states:

```
MONITOR ──streak_fail>0 or reachable=false──▶ SUSPECT ──down for fail_threshold × interval_sec──▶ RECOVERY ──▶ COOLDOWN ──▶ MONITOR
   ▲                                             │  (reachable=true and streak_fail=0)                            │
   └─────────────────────────────────────────────┘◀──────────────────────────────────────────────────────────────┘
LOCKED    — maintenance mode; sleeps until the lock clears
DISABLED  — turned off (config, or auto-disabled by the Tier-4 cap)
```

Every cycle starts with `conn_state_read` (`conn_state.sh`). A stale or missing cache skips the cycle: no state change, no recovery decision.

- **MONITOR** — the healthy resting state. Any failure streak (`streak_fail > 0`) or a `reachable=false` verdict moves it to SUSPECT.
- **SUSPECT** — the decision window. A clean read (`reachable=true` and `streak_fail == 0`) returns to MONITOR. The link is declared **down** when `conn_state_down_for $((fail_threshold × interval_sec))` is true: a fresh read, `reachable=false`, **and** the producer's monotonic `fail_elapsed_sec` at or past that many seconds. `interval_sec` comes from the cache the same cycle, so a cadence change applies at once.

> ℹ️ NOTE — the trigger is wall-clock, not a probe count. During an outage a failing cycle costs up to ~12 s (four legs × 3 s) whatever `interval_sec` says, so counting `streak_fail` against `fail_threshold` stretched the real time to recovery well past the "~N s" the page promises. `fail_elapsed_sec` measures the outage directly. Because `reachable` only turns `false` after the profile's `fail_secs`, the real trigger is the **later** of `fail_secs` and `fail_threshold × interval_sec` (relaxed defaults: 30 s vs 5 × 5 = 25 s → 30 s). `streak_fail` survives only as the MONITOR → SUSPECT cue and the `failure_count` readout in the state file. `check_interval` is purely the watchdog's sampling cadence.
- **RECOVERY** — runs the current tier's action (see the ladder below), then drops into COOLDOWN. It doesn't linger here.
- **COOLDOWN** — waits for the action to settle, then re-reads the ping verdict to decide success or escalation (see *Cooldown adjudication*).
- **LOCKED** — set whenever a maintenance condition is present: the lock file `/tmp/qmanager_watchcat.lock` exists (touched by the OTA updater and installer), a long-running AT command is in flight (a trusted `/run/qmanager_at/long_running`, checked with `qm_long_flag_up`), or a SIM-profile apply is running (`/tmp/qmanager_profile_apply.pid` points at a live process). The watchdog parks here so its AT commands never race those operations.
- **DISABLED** — `watchcat.enabled=0`, or the daemon shut itself off after tripping the Tier-4 reboot cap.

<a id="carrier-intercept-short-circuit-now-inert"></a>
> ℹ️ NOTE — there is no carrier-`limited` branch. The old short-circuit read `connectivity` / `limited_reason`, keys the [ICMP producer](connection-quality.md#why-the-tri-state-is-gone) never writes; it and the private `read_ping()` were deleted on 2026-10-11. [The producer key contract](connection-quality.md#the-producer-key-contract) is the authority on what the cache holds.

### The escalation engine

`find_next_tier` walks the enabled tiers in order (1→4). SUSPECT breaching the threshold runs the first enabled tier; each failed COOLDOWN escalates to the next enabled one. When the last enabled tier still doesn't restore connectivity, the watchdog gives up gracefully and returns to MONITOR (it does not loop forever).

Each tier's return code drives the engine:
- **`0`** — action attempted → enter COOLDOWN and judge the result.
- **`1`** — tier skipped (a guard fired, e.g. tower lock on Tier 2, or an unreadable slot on Tier 3) → immediately try the next enabled tier.
- **`2`** — **misconfiguration** (Tier 3 only) → **stop the ladder outright** (see below).

### Cooldown adjudication

When the cooldown timer expires, `finish_cooldown` re-reads the ping cache through `conn_state_read` and decides **once**:

1. **Fresh read, `reachable=true`** (`conn_state_is_up`) → success, whatever `during_recovery` says (the watchdog's own flag is still up at this point). Reset to MONITOR. If this was a Tier-3 swap, *finalize* the failover (below).
2. **Fresh read, unreachable** → failure. If Tier 3, revert the SIM first; then escalate to the next enabled tier.
3. **Stale/missing ping data** → the cache can go transiently stale right after a radio or SIM churn. The watchdog **retries up to 3 times**, extending the cooldown by one `check_interval` each round and re-stamping the recovery flag, which stays up across the retries.
4. **Still stale after 3 retries** → **inconclusive**: no escalation, because acting on data it cannot trust could walk the ladder to a Tier-4 reboot. It removes the recovery flag and returns to MONITOR at tier 0. If the cooldown was ending a **Tier 3** swap (`current_sim_slot != original_sim_slot`), it first reverts with `sim_failover_fallback`, exactly as an unrestored Tier 3 does. Without that revert the modem stayed on the backup SIM with no failover record, the user's revert request was ignored, and the next outage stopped at Tier 3 because the backup slot now equalled the current slot.

The recovery flag is removed exactly once, after the decision, on every path.

Proved on RM520N-GL `61368cd2` (`/tmp` drivers): a stale-exhausted cooldown returns `monitor` / tier 0 (the previous build escalated to Tier 2).

---

## The recovery tiers in detail

### Tier 1 — Re-register to Network (`AT+COPS=2` → `AT+COPS=0`)

Deregisters from the carrier, then triggers automatic re-registration. The gentlest nudge — it shakes loose a stuck registration without dropping the radio. Always attempted first when enabled.

### Tier 2 — Restart Modem Radio (`AT+CFUN=0` → `AT+CFUN=1`)

Turns the radio off (airplane mode) and back on. `CFUN` is the modem's "functionality" control — `0` is minimum-functionality (radio off), `1` is full. After bringing the radio back, the watchdog waits for the modem to answer AT commands again (`wait_for_modem`, up to 60s).

> ⚠️ WARNING: Tier 2 is **skipped when a tower lock is active** (`/etc/qmanager/tower_lock.json` has LTE or NR-SA locking enabled). Cycling the radio would drop the locked cells you deliberately pinned, so the watchdog refuses to and escalates instead. It's also skipped while a long-running AT command holds the modem.

### Tier 3 — Switch to Backup SIM (the Golden Rule)

The most involved tier. On a dual-SIM RM520N-GL (`AT+QUIMSLOT=?` → `(1,2)`), it fails over to the configured backup slot when the primary SIM's carrier is unreachable.

**Prechecks (return `2`, stop the ladder):**
- No `backup_sim_slot` configured.
- The configured backup slot equals the current live slot (nothing to fail over to).

**The Golden Rule sequence** — the mandatory order for *any* SIM-slot switch on this modem:

```
AT+CFUN=0            # radio off (abort the whole swap if this fails)
  sleep 2
AT+QUIMSLOT=<slot>   # select the backup slot
  sleep 2
AT+CFUN=1            # radio back on
```

Around that core sequence, Tier 3:
1. **Captures the original slot's ICCID first** (`AT+QCCID`, 3× 1s retry) *before* detaching, so the failover record has an honest `original_iccid` instead of an empty placeholder. Best-effort — if it stays unreadable, the swap proceeds anyway.
2. Records `original_sim_slot` for a possible revert.
3. Stops the tower-failover daemon (`qmanager_tower_failover`) — cell locks are meaningless on a different SIM.
4. Runs the Golden Rule sequence, then `wait_for_modem`.
5. **Read-back verifies the slot actually landed** via `verify_quimslot` (`slot_verify.sh`) — `AT+QUIMSLOT=N` can return `OK` while the modem silently stays on the old slot under `qcmd` lock contention, so the write is never trusted on its own. `verify_quimslot` polls `AT+QUIMSLOT?` up to 10× (1s apart); an **empty** read counts as not-yet-matched, never a false success. On a verify failure the watchdog falls straight to `sim_failover_fallback()` (no second write-retry at this layer) rather than proceeding on an unconfirmed slot.
6. **Verifies the backup SIM is actually present** with `AT+CPIN?`, **retried 3 times one second apart**, mirroring the ICCID retry loop in step 1. Failure means `rc != 0` or empty stdout, never the literal text `ERROR`: `qcmd` reports failure by exit status and stderr and never writes `ERROR` to stdout ([at-command-transport.md](at-command-transport.md)). A response that is *present* but is not `+CPIN: READY` is a real "SIM present, not usable" state (PIN or PUK required); it is logged with the actual state rather than as "No SIM", and still falls back, because a locked SIM cannot carry traffic either way. Any of those outcomes falls back to the original slot.

   > ⚠️ WARNING: the retry is load-bearing, not defensive padding. `AT+CPIN?` fired immediately after the `AT+CFUN=1` in the Golden Rule sequence can legitimately answer `+CME ERROR: 14` ("SIM busy") while SIM initialisation is still running, and `wait_for_modem` only waits for bare `AT` to answer, which happens well before the SIM is ready. A single failed read is therefore routine rather than proof the slot is empty. Before 2026-08-23 this check tested `grep -q 'ERROR'` against stdout, which could never match, so the fallback below it had **never executed in production**; fixing the detection (`b4d87ef`) activated it, and a one-shot read would have made the last rung of the recovery ladder revert a *working* failover back to the dead primary SIM.
7. Does **not** write the failover state yet — it waits for cooldown to confirm the backup SIM actually carries traffic.

**SIM-settle floor (`SIM_SETTLE_SECS = 90`):** after a Tier-3 swap the cooldown is `max(cooldown, 90)` seconds. A real SIM swap needs time to re-attach and get a data bearer on the new carrier; judging it "failed" after a short 10–60s cooldown would wrongly bounce a swap that was still coming up. The floor only applies to Tier 3.

**Finalize (in cooldown, on success):** when connectivity comes back on the backup SIM, the daemon writes `/etc/qmanager/qmanager_sim_failover`, emits a **"SIM failover confirmed"** event, registers the landed ICCID in the known-SIMs set (below), and auto-applies any SIM profile matching the new card.

**Fallback (revert to original):** triggered when the modem is unresponsive after the swap, the backup slot's SIM state cannot be confirmed after 3 attempts or comes back as anything other than `+CPIN: READY`, or cooldown finds the backup SIM still can't reach the internet, or the cooldown ends inconclusive on stale data. It **read-back verifies the revert landed** via `verify_quimslot(original_sim_slot)` before trusting it — same rationale as the Tier-3 switch gate, and the same "no second write-retry, fall through to best-effort handling" posture on a verify failure (an unconfirmed revert emits an error event asking for a manual check rather than looping). Once verified, it restarts the tower-failover daemon, registers the reverted ICCID in the known-SIMs set, and re-applies that SIM's profile.

### Tier 4 — Reboot Device (deferred)

The last resort: a full device reboot, guarded by a **token bucket**.

- `count_recent_reboots` counts only the watchdog's own rows (`<epoch>|reboot|tier4_escalation`, numeric epoch) in `/usrdata/qmanager/crash.log`; user and scheduled reboots never count. With a sane clock (`_qm_clock_sane` from `schedule_timer.sh`, year >= 2025) it is a rolling hour. Before NITZ/NTP sets the clock (the device boots at 1970) the hour cannot be evaluated, so it counts the clockless Tier-4 rows (epoch < 1735689600) written since the last real-dated row of any kind — before 2026-11 every real-dated row passed the 1970 window, so the first Tier-4 attempt of a long outage hit the cap and self-disabled (dr-dolomite/QManager#34). `wd_ledger_tick` recounts once a minute (uptime-paced) so `reboots_this_hour` decays. Known edge, same as RM551E: an outage whose first Tier-4 reboot happened on a set clock leaves a real-dated row that starts the clockless run instead of counting, so a clockless outage can take cap + 1 reboots before the watchdog disables itself. `main()` calls `qm_crash_log_prepare` just before it, so a device coming from an older build has its legacy `/etc/qmanager/crash.log` merged in first and the budget still sees the reboots logged there.
- If that count is already at `max_reboots_per_hour`, the watchdog **does not reboot**. Instead it sets `enabled=0` in config, touches `/tmp/qmanager_watchcat_disabled`, and exits — a reboot loop is worse than a down link, so it stops itself and surfaces an auto-disabled banner in the UI.
- Otherwise it appends a timestamped line to `crash.log` (format `<epoch>|reboot|tier4_escalation`, trimmed to the last 20 entries), records the recovery, flushes state, and reboots after a 1s grace.

> ℹ️ NOTE: The reboot is issued through `run_reboot` after the state file is flushed. The watchdog runs *on* the modem, so this is the deferred pattern the platform requires — state is written before the device goes down, never mid-request.

---

## Misconfiguration stops the ladder (return code 2)

If Tier 3 is enabled but misconfigured — **no backup slot**, or **backup slot equals the current slot** — `execute_tier3` returns code `2`, and `do_recovery` **halts the recovery ladder** instead of escalating. It logs the misconfiguration, emits a `watchcat_recovery` error event, clears the recovery flag, and returns to MONITOR.

**Why:** a bad Tier-3 config is an operator mistake, not a connectivity problem. Cascading it into a Tier-4 reboot would punish the device for a settings error — reboots wouldn't fix the config and could loop.

> ⚠️ WARNING — the tradeoff: if Tier 3 is the **first enabled tier** and it's misconfigured, the ladder stops *before* Tier 4, so **Tier 4 (reboot) becomes unreachable through that path** until you either fix the backup slot or disable Tier 3. The UI guards against creating this state — enabling Tier 3 with no backup slot **blocks the save** — but a config edited by hand can still land here.

---

## SSR grace, quality trigger and primary recheck

Three opt-in behaviours (ported from RM551E, adapted), each in its own lib under `scripts/usr/lib/qmanager/`. The watchcat sources each from `WD_LIB_DIR` behind `[ -f ]` and stubs it when missing, so a missing lib turns its feature off. All timing uses `wd_mono` (`/proc/uptime`), never the wall clock (the device boots at 1970).

### SSR grace — `wd_ssr.sh` (`ssr_aware`, `ssr_grace`)

An SSR (subsystem restart) is the baseband restarting itself; the link drops for tens of seconds and comes back without help. Source: `/sys/devices/platform/4080000.qcom,mss/subsys0/{state,crash_count}` (the pair the poller reads; override `WD_SSR_SYSFS`).

- Baseline `crash_count` at daemon start (it resets per boot); `wd_ssr_sample` runs at the top of **every** loop pass, including the cooldown / locked / stale `continue` paths, so a short SSR is not missed. An unreadable or missing `state` counts as ONLINE.
- When SUSPECT reaches the down threshold and an SSR is under way or was seen within `ssr_grace + fail_threshold × interval_sec + 2 × check_interval`, the state becomes **`ssr_hold`** instead of RECOVERY. The hold lasts up to `ssr_grace` seconds from its start; a clean read returns to MONITOR, a grace that runs out releases the ladder.

### Quality trigger — `wd_quality.sh` (`quality_enabled`, `quality_consecutive`)

A reachable but degraded link starts a recovery **capped at Tier 2** (user decision: never a SIM swap or a reboot for a slow link).

- **Limits** come from Connection Quality's presets (`cq_thresholds_load`, custom included), raised to floors of **50 ms / 10 %** so a 1 ms / 1 % custom limit cannot trip recovery. The watchcat never calls `cq_thresholds_refresh` (that consumes the poller's flag); `quality_thresholds.sh` touches `/tmp/qmanager_watchcat_reload` on a save instead.
- **Window**: the lines of `/tmp/qmanager_ping_history` (rtt or `null`) taken since the last mark, capped at `clamp(120 / interval_sec, 10, 60)`; fewer than 10 samples is "no signal" (the count neither grows nor resets). Average latency is over answered probes, loss is `null` lines / all lines. The window is marked after boot settle, after every tier, on LOCKED exit and on every pass that reads `reachable=false`.
- Evaluated only in MONITOR on a fresh reachable read. `quality_consecutive` breaches in a row pass the **start gate**: `none` (Tier 1 and 2 both off) / `holdoff` / `ssr` (recent SSR) / `radio_off` (`AT+CFUN?` 0 or 4; unreadable counts as on) / `go`.
- **Cooldown verdict** for a quality recovery: reachable **and** under the limits. Too few samples extends the cooldown by `check_interval`, up to 6 times. An exhausted quality ladder pauses quality recovery for **15 min**; a success pauses it for **10 min** (`WD_Q_SETTLE_SECS`), so a flapping link cannot loop Tier 1/2 every couple of minutes.

### Primary recheck — `wd_recheck.sh` (`primary_recheck_enabled`, `primary_recheck_interval`)

While on the backup SIM after a confirmed Tier 3 failover, swap back to the primary every `primary_recheck_interval` minutes and stay if it works. Each try is a real outage, so it is off by default.

- **Gate**: enabled, `tier3_enabled=1`, failover active, idle MONITOR, no pending revert flag, fewer than 3 failed tries. The interval clock starts at the failover confirmation, or at the first pass after a failover resumed at boot.
- **Try**: Golden Rule swap to the original slot, `verify_quimslot`, apply the primary's profile (`auto_apply_profile … watchdog_failback`) **before** the verdict, then settle `SIM_SETTLE_SECS` (90 s) in COOLDOWN with `recovery_reason=recheck`. Each swap first writes the state file with `stale_after` 600, as `do_recovery` does, because `wait_for_modem` can outlast the normal window and the CGI restarts a watchcat it judges hung. While a recheck settles, LOCKED (the profile apply's pid) pauses the countdown instead of dropping it, for at most **5 min** from the first locked pass (`WD_RECHECK_LOCK_MAX`); past that the try counts as failed and it returns to the backup. A user revert during the settle wins.
- **Healthy** (fresh `reachable=true`): drop the failover record, learn the ICCID, `svc_start qmanager_tower_failover` (Tier 3 stopped it), back to MONITOR.
- **Down** (stale 3× counts as down): Golden Rule swap back to the backup, re-save the failover record, re-apply the backup's profile, count a failure, re-arm the clock. If the swap to the primary never landed, it stays on the backup and counts a failure without touching profiles. If the return never lands but the modem is on the primary, it keeps the primary and the normal ladder judges the link from there.
- **Give up** after 3 failed tries until the next config reload (a Watchdog **or** Quality Thresholds save, since both touch the reload flag) or a boot.

> ℹ️ NOTE: known and accepted — an SSR hold can overshoot `ssr_grace` by up to one `check_interval` (the gate is checked once per pass). A quality recovery that ends in an outage hands over to the normal unreachable ladder, which can reach Tier 3/4 (matches the Tier 1-2 decision: the cap applies to quality, not to an outage).

> ℹ️ NOTE: `watchdog.sh` sources `wd_common.sh` and `wd_quality.sh` behind `[ -f ]` with stubs, so a partial install still serves the page without the P5 keys.

> ℹ️ NOTE: Tier 3 can only be reached from an unreachable ladder (quality stops at Tier 2), so the recheck verdict is reachability alone; RM551E also judged quality there.

---

## Configuration

Config lives in `/etc/qmanager/qmanager.conf` under `[watchcat]`, read/written via `qm_config_get`/`qm_config_set`. The daemon reloads it live when the CGI touches `/tmp/qmanager_watchcat_reload`.

| Key | Type | CGI-validated range | Default | Meaning |
|-----|------|--------------------|---------|---------|
| `enabled` | bool (0/1) | — | off | Master enable. Saving toggles the systemd unit (enable+start / stop+disable). |
| `fail_threshold` | int | 1–20 | 5 | "About N probes' worth of time": down is declared after `fail_threshold × interval_sec` seconds of producer-measured failure (`fail_elapsed_sec`). Renamed from the retired `max_failures`. |
| `check_interval` | int (s) | 5–60 | 10 | The watchdog's internal *sampling* loop — how often it wakes to re-read the ping cache. Does not drive the down-declaration timing. The page never sends it. |
| `cooldown` | int (s) | 10–300 | 60 | Wait after each recovery step before re-checking (Tier 3 is floored at 90s). |
| `tier1_enabled` | bool | — | on | Enable Tier 1 (re-register). |
| `tier2_enabled` | bool | — | on | Enable Tier 2 (radio toggle). |
| `tier3_enabled` | bool | — | off | Enable Tier 3 (SIM failover). |
| `tier4_enabled` | bool | — | on | Enable Tier 4 (reboot). |
| `backup_sim_slot` | `1` \| `2` \| `null` | `1`/`2`/null | null | SIM slot to fail over to. Required when Tier 3 is on. |
| `max_reboots_per_hour` | int | 1–10 | 3 | Tier-4 token-bucket cap. Auto-disable trips when hit. |
| `ssr_aware` | bool | 0–1 | on | Hold the ladder while the baseband restarts itself. |
| `ssr_grace` | int (s) | 10–120 | 45 | Longest SSR hold. |
| `quality_enabled` | bool | 0–1 | off | Quality trigger (Tier 1-2 recovery for a degraded link). |
| `quality_consecutive` | int | 1–60 | 5 | Breaches in a row before the quality recovery starts. |
| `primary_recheck_enabled` | bool | 0–1 | off | Primary SIM recheck while on the backup SIM. |
| `primary_recheck_interval` | int (min) | 5–1440 | 30 | Minutes between rechecks. |

> ℹ️ NOTE: The failure-count key is now `fail_threshold` (the retired `max_failures` is migrated away — see *Migrations* below).

**The six P5 keys have one defaults table**: `wd_key_spec` in `scripts/usr/lib/qmanager/wd_common.sh` prints `default min max` (a 0–1 range is a boolean) and `WD_KEYS` lists them. The watchcat reads them with `wd_key_get` (stored value if valid, else the default) and the CGI handles `WD_KEYS` generically (GET merges `wd_keys_json` into `settings`; POST validates every key in pass 1 and writes in pass 2), so a key added to the table is exposed end to end. `qm_config_init` never rewrites a non-empty conf, so these reader defaults are what an OTA'd device gets. The `CFG_*` fallbacks in the watchcat are feature-off values, not a second table.

> ⚠️ Pre-existing, not changed: the watchcat reads `enabled` with default `1`, the CGI GET with default `0`.

<a id="split-ownership-of-the-probe-cadence"></a>
### The probe cadence is not a watchdog setting

The cadence belongs to Connection Quality: `interval_sec` in `/etc/qmanager/ping_profile.json`, else the active profile's value. The watchdog daemon reads the live value out of the ping cache each cycle. `watchdog.sh` exposes it as `probe_interval` so the Detection card keeps working:

- **GET** `probe_interval` = `conn_state_cadence`'s effective value (override, else the profile table), never a stored watchdog key.
- **POST** `probe_interval` is validated (1–60) and written to `ping_profile.json` `.interval_sec` **only when it differs** from the current effective value, with `/tmp/qmanager_ping_reload` touched. The page sends `probe_interval` with every per-card save, so this check is what keeps a Ladder-card save from rewriting the cadence.
- The write is an atomic key-merge that sets `.interval_sec` alone, guarded by `jq -e 'type == "object"'` (fallback `{}`) and a `[ -s tmp ]` promote check. It is best-effort: a failure logs and the save still succeeds.

The saved cadence is never removed by this page: Connection Quality's Probe Targets card has a **Use profile cadence** button that clears it ([connection-quality.md](connection-quality.md#config-and-live-reload)), after which the Detection card shows the profile's cadence again.

`[watchcat].probe_interval` is never written or read by the CGI or the daemon. The installer's `migrate_watchcat_fail_threshold` and the `config.sh` seed still create it with value 5; it is inert. `propagate_probe_interval()` is gone.

> ⚠️ WARNING — `jq -e .` is the **wrong** predicate for the object guard: `-e` tests output truthiness, so it passes `5`/`"str"`/`[1,2]` (unmergeable) and rejects `null`/`false` (parseable). `settings/ping_profile.sh` carries the identical guard — rationale and rc matrix in [connection-quality.md → Corrupt-config guard](connection-quality.md#corrupt-config-guard). Change one writer's guard and you must change both.

### Migrations (hand-written — `config.sh` has no key-migration primitive)

`qm_config_*` only seeds an empty config; it has no rename/migrate step, so the `max_failures` → `fail_threshold` rename is handled by two idempotent, defensive migrations:

- **Installer** (`install_rm520n.sh` → `migrate_watchcat_fail_threshold`, run on every install/OTA): if `fail_threshold` is unset and `max_failures` is set, copy the value across and delete the old key; if both are unset, seed `fail_threshold=5`; if `fail_threshold` is already present, just prune any leftover `max_failures`. It also seeds `probe_interval=5` when unset; nothing reads that key any more.
- **Runtime** (`watchdog.sh` → `migrate_fail_threshold`, run on both GET and the save's Pass 2): covers a device that hits the CGI *before* the installer migration runs — same copy-across-then-delete logic, idempotent (returns immediately once `fail_threshold` is present).

The delete side uses the new `qm_config_delete` primitive added to `config.sh` in this change.

---

## State and flag files

**Persistent (`/etc/qmanager/` except `crash.log`, which is in `/usrdata/qmanager/`; all survive reboot):**

| Path | Written by | Purpose |
|------|-----------|---------|
| `qmanager_sim_failover` | daemon (write on finalize / revert), CGI (read), poller (re-emit into `status.json`) | Active SIM-failover record. Persistent so a Tier-4 reboot doesn't lose the fact that you're riding the backup SIM. |
| `known_iccids` | daemon (`sim_db_add`, on finalize + revert), poller (boot detector, also `sim_db_add`), `cellular/settings.sh` (manual slot switch), `profile_mgr.sh` (`set_active_profile`) | The known-SIMs **set** (replaces the retired single-value `last_iccid`). Every code path that lands the modem on a different SIM must add that ICCID here, or the poller's boot-time detector treats the (expected) transition as a physical swap. See [sim-detection.md](sim-detection.md) for the full model, including why a set (not a single value) is required for failover slot-cycling to never false-fire. |
| `crash.log` (`/usrdata/qmanager/`, `root:root 0644`) | **Three writers, all root:** the daemon (Tier 4, `<epoch>\|reboot\|tier4_escalation`), `qmanager_scheduled_reboot` (both `reboot` and `skip` lines), and the `qmanager_crash_log_append` root helper (`user`) | Pipe-delimited log, last 20 entries. **Two line shapes:** `<epoch>\|reboot\|<reason>` and `<epoch>\|skip\|<reason>` — the second records a scheduled reboot that was *declined* (e.g. the 1970 clock-step guard), so `count_recent_reboots()` filters on both the verb and the reason (`$2 == "reboot" && $3 == "tier4_escalation"`) — a skip, user or scheduled row would otherwise inflate the token bucket. Full contract and the other two read sites: [alerts.md > The `crash.log` line contract](alerts.md#the-crashlog-line-contract). |
| `tower_lock.json` | tower-lock feature | Read-only guard: Tier 2 is skipped when LTE or NR-SA locking is enabled. |

**Volatile (`/tmp/`, cleared on reboot):**

| Path | Written by | Purpose |
|------|-----------|---------|
| `qmanager_watchcat.json` | daemon | Live state file (schema below). Read by the CGI (`status`) and the poller. |
| `qmanager_watchcat.pid` | daemon | Singleton guard. |
| `qmanager_watchcat.lock` | OTA updater / installer | Forces LOCKED (maintenance). |
| `qmanager_watchcat_reload` | CGI (`save_settings`) | Signals a live config reload. |
| `qmanager_watchcat_revert_sim` | CGI (`revert_sim`) | User-requested SIM revert; consumed by the daemon. |
| `qmanager_watchcat_disabled` | daemon (Tier-4 auto-disable) | Read by the CGI as `auto_disabled`; cleared when the user re-enables. |
| `qmanager_recovery_active` | daemon **and** `qmanager_profile_apply` | Set during any recovery; surfaces as `during_recovery` in the ping cache and `status: "recovery"` in `status.json`. It does **not** silence events or alerts: the first outage edge still logs and the down SMS is not deferred. Inside the window, `events.sh` holds only a repeat drop after a restore. **Shared with another writer that may be a different UID** — see below. |
| `qmanager_sim_swap_detected` | poller (boot detector) | Physical-SIM-swap notification surfaced in the UI; distinct from watchdog failover. |
| `qmanager_ping.json` | `qmanager_ping` | The connectivity verdict the watchdog reads (never writes). |

#### Raising `qmanager_recovery_active` is a two-step idiom

The daemon raises the flag at six sites (Tiers 1/2/3, `do_recovery`, the
cooldown-stale extension, and the SIM revert) with the same line:

```sh
printf '%s\n' "$$" > "$RECOVERY_FLAG" 2>/dev/null || touch "$RECOVERY_FLAG"
```

Both halves are load-bearing, and neither is defensive padding:

- **The PID** lets `qmanager_profile_apply` — the other writer of this flag —
  judge it on its own merits (live owner / dead owner / aged out) instead of
  special-casing an empty file as "some foreign owner, never touch". Older
  builds wrote a bare `touch` with no PID, and an OTA can leave an old watchcat
  running against a new worker, so an **empty** flag is still a valid live state
  that must be left alone.
- **The `touch` fallback** is required. Watchcat is root, and if a `www-data`
  `qmanager_profile_apply` created the flag first, root's redirect is **refused**
  by `fs.protected_regular=1` — a sticky world-writable directory refuses an
  `O_CREAT` write unless you own the file or the file is owned by the directory's
  owner, and there is no root override. `touch` on that same file still succeeds,
  because stamping mtime only needs `CAP_FOWNER`. Since the flag's *existence* is
  what every consumer reads, dropping the fallback would mean root silently
  failing to raise suppression at all.

Re-stamping the mtime on each cooldown extension also keeps the flag from ageing
out of the worker's 120 s staleness ceiling during a long cooldown.

> ℹ️ NOTE: known residual, out of scope — if watchcat joins a flag a `www-data`
> APN bracket already owns, that bracket clears it at its end and watchcat's
> suppression stops early. Fixing that needs a multi-owner protocol, not a bigger
> flag. The claim protocol and the ownership rules are in
> [tmp-file-ownership.md](tmp-file-ownership.md); the worker side is in
> [sim-profiles.md](sim-profiles.md).

### Live state file — `/tmp/qmanager_watchcat.json`

```json
{
  "timestamp": 1721390000,
  "enabled": true,
  "state": "monitor",
  "current_tier": 0,
  "failure_count": 0,
  "last_recovery_time": null,
  "last_recovery_tier": null,
  "total_recoveries": 0,
  "cooldown_remaining": 0,
  "sim_failover_active": false,
  "original_sim_slot": null,
  "current_sim_slot": null,
  "reboots_this_hour": 0,
  "ssr_hold": false,
  "ssr_hold_remaining": 0,
  "last_ssr_ago": null,
  "recovery_reason": null,
  "quality_breach_count": 0,
  "quality_holdoff_remaining": 0,
  "primary_recheck_active": false,
  "primary_recheck_failures": 0,
  "next_recheck_in": null,
  "mono": 90179,
  "stale_after": 90
}
```

`recovery_reason` (`unreachable` | `quality` | `recheck`) is set only in `recovery` / `cooldown`. `next_recheck_in` is seconds to the next primary recheck, `null` when none is pending. `state` can also be `ssr_hold`.

`mono` is uptime seconds at the write; `stale_after` is `3 × check_interval + 60`, or `600` written just before a recovery tier runs (a Tier 3 swap can block for minutes).

> ℹ️ NOTE: `sim_failover_active` is a real boolean. It was previously written with a jq type mismatch that pinned it to `false`; it now reflects the actual failover state, so the UI's "Running on backup SIM" affordances light up correctly.

### SIM-failover record — `/etc/qmanager/qmanager_sim_failover`

```json
{
  "active": true,
  "original_slot": 1,
  "current_slot": 2,
  "switched_at": 1721390100,
  "reason": "connectivity_failure",
  "original_iccid": "8901…1234",
  "current_iccid": "8901…5678"
}
```

**Startup resume with slot verification:** on start, if this file says `active:true`, the daemon queries the *live* slot (`AT+QUIMSLOT?`) and compares it to the recorded `current_slot`. If they match, it resumes the failover state; if the modem is on a different slot than recorded (e.g. someone swapped it manually, or a reboot landed elsewhere), it **discards the stale file** rather than carry a lie forward.

---

## CGI contract — `/cgi-bin/quecmanager/monitoring/watchdog.sh`

### `GET` — settings + live status

Returns the saved config plus a snapshot of daemon/failover/swap state, and `recent_reboots` (up to 5 epoch ints, newest first, read from `crash.log` rows `<epoch>|reboot|tier4_escalation` only; scheduled/user reboots and 1970 epochs are excluded). The Recovery Activity card draws one row per entry the event ring no longer holds:

```json
{
  "success": true,
  "settings": {
    "enabled": false,
    "fail_threshold": 5,
    "probe_interval": 5,
    "check_interval": 10,
    "cooldown": 60,
    "tier1_enabled": true,
    "tier2_enabled": true,
    "tier3_enabled": false,
    "tier4_enabled": true,
    "backup_sim_slot": null,
    "max_reboots_per_hour": 3,
    "ssr_aware": true,
    "ssr_grace": 45,
    "quality_enabled": false,
    "quality_consecutive": 5,
    "primary_recheck_enabled": false,
    "primary_recheck_interval": 30
  },
  "status": { /* contents of /tmp/qmanager_watchcat.json, or {} if absent */ },
  "sim_failover": { /* contents of the failover record, or {"active":false} */ },
  "sim_swap": { /* SIM-swap detection, or {"detected":false} */ },
  "auto_disabled": false,
  "quality_limits": { "latency_ms": 250, "loss_pct": 30 }
}
```

`quality_limits` is what the quality trigger really uses: the Connection Quality presets raised to the floors.

### `POST` — dispatched on `action`

**`action: "save_settings"`** — carries every settings field in one atomic write. Validation is **two-pass**:

1. **Pass 1 (validate):** every field is extracted and range-checked *before any write*. The first invalid field short-circuits with, and nothing is persisted:

   ```json
   { "success": false, "error": "invalid_field", "field": "cooldown", "reason": "must be an integer between 10 and 300" }
   ```

2. **Pass 2 (apply):** only reached when every field validated. First runs the defensive `migrate_fail_threshold()` (in case this device hasn't been touched by the installer migration yet), then writes each key via `qm_config_set`, touches the reload flag, and toggles the service — enable and, when `enabled=1`, start only if down or hung (also clearing `auto_disabled`; a live daemon reloads from the flag, a restart would drop its recovery state; hung = state file `mono` older than `stale_after` by uptime, `watchcat_state_stale`), or stop+disable when `enabled=0`. A `probe_interval` that differs from the current cadence is written to `ping_profile.json.interval_sec` (see below).

   ```json
   { "success": true }
   ```

> ℹ️ NOTE — why two passes: `qm_config_set` writes each key immediately with no commit-staging (no transaction). Validating everything up front is the only way to guarantee a bad request can't leave the config half-applied. Tier enable booleans are the one exception — anything other than literal `true`/`false` is silently ignored (legacy parity), not rejected.

> ℹ️ NOTE — `migrate_fail_threshold()` also runs on **GET**, so a device that reads its settings before ever saving still gets `max_failures` transparently renamed to `fail_threshold`.

**Field ranges** (Pass 1): `fail_threshold` 1–20, `probe_interval` 1–60, `check_interval` 5–60, `cooldown` 10–300, `max_reboots_per_hour` 1–10, `backup_sim_slot` `1`/`2`/`null`, and the `WD_KEYS` ranges in the Configuration table (booleans must be `true`/`false`; an absent key is left alone).

**`probe_interval` is a mirror of Connection Quality's `interval_sec`.** GET reports the effective cadence; POST writes `.interval_sec` only when the value changed, and stores nothing under `[watchcat]`. Full rules: [The probe cadence is not a watchdog setting](#split-ownership-of-the-probe-cadence).

**`action: "dismiss_sim_swap"`** — marks the physical-SIM-swap notification dismissed. → `{ "success": true }`

**`action: "revert_sim"`** — touches `/tmp/qmanager_watchcat_revert_sim`; the daemon reverts to the original slot on its next cycle. → `{ "success": true, "message": "SIM revert requested. The watchcat will process this shortly." }`

---

## Frontend anatomy

> Redesigned 2026-10-11 to the bento / Card-Foot / `SegmentedField` canon. Gone, and not to be restored: the four-tile status band, `AutoDisabledBanner`, the one shared apply on the Ladder card, the per-rung `Switch`es, and the rungs' AT-command tags and effect sentences.

Page: `/monitoring/watchdog` — `components/monitoring/watchdog/watchdog.tsx`. Four blocks, top to bottom:

```
MonitoringPageHeader   title + description + Refresh pill (reloads settings, modem status AND activity)
FailoverBanner         conditional, only while sim_failover.active
StatusCard             rounded-hero: phase disc + label + blurb · three figures · probe strip
PAIR                   LadderCard (7fr) | DetectionCard (5fr), one height, each with its OWN CardFoot
RecoveryActivityCard   full width: the newest 5 rows + an "All events" link to /monitoring/
```

**The family's three contract modules.** `shapes.ts` owns every geometry string, control height and tone map; skeletons import the loaded views' own constants (Skeleton-Mirror), and geometry is restated from the sibling `/monitoring/` families rather than imported. `derive.ts` owns the one derived model: the phase (`derivePhase`), the status card (`deriveBand`), the probe strip (`deriveStrip`), the outage timeline (`deriveTimeline`) and the tier copy keys. `use-watchdog-form.ts` owns the draft and the two scoped commits. No component re-infers a state from a payload.

**Data sources (three hooks, all called in `watchdog.tsx`):**
- `useWatchdogSettings` (`hooks/use-watchdog-settings.ts`) — the CGI above. Owns settings, `auto_disabled`, and the `save`/`revert_sim` actions. Polls every 30s (silent) so `auto_disabled` surfaces live without flashing the skeleton. It does not keep the CGI's `status` / `sim_failover` blocks; the page takes those numbers from the poller, which is fresher.
- `useModemStatus({ pollInterval: 5000 })` — the poller's `/tmp/qmanager_status.json`. Reads three blocks: `watchcat` (status card, running-tier highlight), `sim_failover` (failover banner) and `connectivity` (probe strip).
- `useRecentActivities({ maxEvents: 50 })` — the shared Network Events feed. Lifted to `watchdog.tsx` and passed into `RecoveryActivityCard` so the header Refresh reloads it; the card has no Refresh of its own.

### `WatchdogPhase` — what the surface may claim

`derive.ts` resolves one total, ordered union: `auto_disabled` → `off` → `unknown` → the live `watchcat.state` → `starting` → `not_running`. A standing config fact outranks a live reading, and not knowing outranks guessing. `auto_disabled` is carried by the status card alone (`bad` disc, its own glyph and blurb); there is no separate banner.

- **`starting` / `not_running`** guard against a dead service sitting behind "Starting" forever. The grace window is **60s** (`GRACE_MS`), anchored on the poll's own `receivedAtMs` and re-anchored when the saved master switch flips. It is 60 and not 30 because the poller refreshes the watchcat block on its Tier-1.5 branch (`TIER1_5_EVERY=5`) at a ~3.7-4.0s cycle — so that block is ~20s stale by construction, and a save additionally backgrounds the unit restart.
- ⚠️ **`not_running` means "has not reported since boot", not "died".** What the page detects is the poller's absent-file path, which resets the block (`enabled=false, state="disabled"`, counters 0). Since T6.1 the poller also publishes `watchcat.age_sec` and `watchcat.stale_after` (uptime-based heartbeat, `adaptive-polling.md`); `derive.ts` `isWatchcatLive` reads them: `age_sec > stale_after` on an enabled block is `not_running` with no grace, and `use-watchdog-indicator.ts` drops its "acting" pill the same way. Absent fields count as live.
- **`unknown` does not key on `isStale` alone.** `useModemStatus` computes staleness by subtracting the modem's clock from the browser's, and this platform has no battery RTC — without a registered SIM the modem sits at Jan 1970 forever, which would pin the page at `unknown` permanently. The modem clock is admitted as evidence only past a plausibility floor (`CLOCK_PLAUSIBLE_AFTER`); an unreachable read is the clock-independent signal underneath it.
- **`locked` is a maintenance hold** (`check_locked()` — the lock file, a trusted `/run/qmanager_at/long_running`, or a live profile-apply pid). The reboot limit is `auto_disabled`. Older copy had the two swapped.

### The status card

`status-band.tsx` (`StatusCard` / `StatusCardSkeleton`) — the surface's one `rounded-hero` anchor (`HERO_SHELL`). It reports **saved** settings, never the half-edited form.

- **Phase block** (left edge): a 44px disc, label, blurb. Colour lives only on the disc (`PHASE_DISC`); eleven phases, eleven distinct glyphs (`PHASE_GLYPH`). While a cooldown runs the blurb becomes the live countdown (`watchdog.band.cooldownStep`, or `cooldownCaption` when the tier is unknown). The disc carries the surface's one ambient loop (`animate-pulse-ring`) while the phase is `recovery`.
- **Three figures** (right edge): Failed checks `n / fail_threshold`, Recoveries with the last tier and its age, Reboots `n / max_reboots_per_hour`. Under `unknown` every figure is `null` and renders an em dash with an `sr-only` word, never a zero. Below a 30rem card the figures become receipt rows.
  > ℹ️ Failed checks is the producer's `streak_fail` (the state file's `failure_count`). Since 2026-10-11 the daemon declares down on elapsed time (`fail_threshold × interval_sec`), not on that count, so `n / fail_threshold` is an approximation: a failing cycle can take longer than `interval_sec`.
  > ℹ️ The Reboots figure is the watchdog's own Tier-4 reboots in the rolling hour: `wd_ledger_tick` recounts `reboots_this_hour` once a minute (before 2026-11 it was frozen between daemon starts and the caption said "since the watchdog started"). The caption says "In the last hour", and when tier 4 is off it says "Reboot step is off". Before the clock is set (1970) it counts this outage's clockless Tier-4 rows instead.
- **Probe strip** (full width, under both): `deriveStrip(connectivity, phase)` draws the last `STRIP.SLOTS` (60) entries of `connectivity.latency_history`, oldest on the left, left-padded with empty bars. A `null` entry is a full-height destructive bar; an answered probe is `22 + 60 × (rtt / max)` percent tall. The head shows a destructive "N no reply" chip when any probe missed, and `avg_latency_ms` rounded. The left caption is `round(history.length × history_interval_sec / 60)` minutes, minimum 1 — taken from the array **length**, never `history_size`, because the ping daemon truncates its history on every probe-winner change. Under `unknown`, or with an empty history, the strip renders its empty state.
  > ⚠️ The strip depends on the poller's `connectivity` block (`ConnectivityStatus` in `types/modem-status.ts`). The Connection Quality unification (2026-10-11) only **added** keys (`thresholds`, `dns_lookup_ms`, `dns_resolver`); `latency_history` and `history_interval_sec` are unchanged. A future rename would not fail loudly: `deriveStrip` defaults it to `[]` and the strip shows "No probe data from the modem" on a healthy device.

### Recovery ladder

`ladder-card.tsx` — a plain `CARD_SHELL` card (no longer the hero).

- **Master enable** is an On/Off `SegmentedField` in the header's `CardAction`. While it is off, every rung's control is disabled and the names go quiet.
- **Each rung** is a number disc, the name, one consequence line (`TIER_CONSEQUENCE_KEY`) and its control. Tiers 1, 2 and 4 take an On/Off pill. **Tier 3 is one "Slot 1 / Slot 2 / Off" pill**: choosing a slot arms tier 3 and sets `backup_sim_slot`; Off clears `tier3_enabled` but keeps the slot, so re-arming restores it. A tier 3 armed with no slot selects no segment and shows a `warning` chip. **Tier 4 carries an inline reboot-cap field** that is never unmounted (disabled when tier 4 or the master is off), so the rung's height does not change.
- **No AT-command tags and no effect sentences** (No Debug-Build Copy). The AT sequences live in the tier table at the top of this doc.
- **Primary recheck** is a companion row under Tier 3 with an empty disc column (`RUNG.SUB_DISC`): an interval field (minutes) and an On/Off pill, both disabled while the master or Tier 3 is off. The interval is validated and sent only while the row is live.
- **The running tier** is a `primary-container` row (Highlight-by-Container) with a "Running now" **marker**, not a chip: `info` resolves to `primary-container`, which on a promoted row is the same surface twice. `runningTier` is forced to 0 under `unknown` and `off`, the same gate the status card applies.

### Detection

`detection-card.tsx` — five receipt rows (key left, control right), then the outage timeline.

- **Quality trigger** and **Baseband restart hold** are switch rows (`ToggleRow`): key + caption, then the number they arm (checks / seconds) and an On/Off pill. The quality caption shows the GET's `quality_limits` and links to `/monitoring/connection-quality`.

- **Probe every** is a `SegmentedField` over `PROBE_INTERVAL_OPTIONS` (1, 2, 5, 10, 15, 30 s) that becomes a `Select` below a 32rem card (`breakpoint="lg"`). **Failure threshold** and **Cooldown** are numeric `InputGroup` fields with the unit inside.
- **Outage timeline** — `deriveTimeline` is a pure function of **both cards' drafts**, so a ladder edit moves it before anything is saved:
  - The outage is declared at `probe_interval × fail_threshold`; the first armed tier runs then.
  - Each next armed tier adds `cooldown`, except after tier 3, which adds `max(90, cooldown)` — the daemon's `SIM_SETTLE_SECS=90` floor (`SIM_SWITCH_MIN_WAIT` in `derive.ts`).
  - A tier 3 armed with no slot ends the list with the `stopped` note (watchcat return code 2, see above).
  - The other notes are `off` (master off), `none` (no tier armed) and `invalid` (a value outside the CGI ranges 1–60 / 1–20 / 10–300).
  > ℹ️ NOTE: the times are an estimate from configured values ("about"). Not modelled: the producer's own `fail_secs` (the daemon waits for the later of `fail_secs` and `probe_interval × fail_threshold`), the stale-cache retry that extends a cooldown by `check_interval` up to three times (`finish_cooldown`), and the time each tier's own commands take.

### The pair, and why Detection sits beside the Ladder

`PAIR` is `grid-cols-1`, then `@4xl/main:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]` with `items-stretch`; each cell is `PAIR_CELL` (`grid min-w-0 *:h-full`), so both cards take the row height. Below 56rem the pair stacks.

Detection pairs with the **Ladder**, not with Activity. The Ladder's height is fixed by construction (four `min-h-16` rungs, a tier-4 field that never unmounts), so the row height is predictable, and Detection's timeline (`TIMELINE.ROOT`, `flex-1 justify-end`) is the one region that absorbs the slack. Activity's height grows with the event count: the 2026-09-05 Detection/Activity pair stranded 1123px in Detection at 25 events, and which card drove the height flipped with the feed. Activity stays a full-width band.

> ℹ️ NOTE: the one thing that grows the Ladder is the tier-4 cap's error line, shown only while the cap is out of range.

### Recovery activity

`recovery-activity-card.tsx` — the `/monitoring/events` 52px day-grouped event row, tone from the shared `presentEvent(…, "card")` so the Age-Gated Tone Rule applies.

- Shows the newest `LOG_LIMIT` (5) watchdog rows (`watchcat_recovery` + `sim_failover`), sorted by timestamp. The header link "All events" goes to `/monitoring/events/` (Network Events) for the rest.
- Resolution is computed by `computeUnresolved(events)` over the **whole unfiltered feed** before the filter and the slice, or every recovery would read as permanently ongoing.
- The row's `message` is producer text from `qmanager_watchcat` and stays untranslated, as on every event feed in the product.
- **The event record carries no tier** (`events.sh` emits `timestamp`/`type`/`message`/`severity` only), so the row's `Tag` is the event type. Inferring a tier by matching the daemon's English prose would be a fabricated reading.

### Apply: one `CardFoot` per card

`watchdog-foot.tsx` (`WatchdogFoot` / `WatchdogFootSkeleton`) takes a `scope` and is rendered by each card on its own bottom edge.

| Scope | Card | Draft keys it commits |
|-------|------|-----------------------|
| `ladder` | Recovery ladder | `enabled`, `tier1`–`tier4`, `backupSlot`, `recheck`, `recheckInterval`, `maxReboots` |
| `detection` | Detection | `probeInterval`, `failThreshold`, `cooldown`, `quality`, `qualityConsecutive`, `ssrAware`, `ssrGrace` |

- **The CGI save is one atomic POST of every key**, so a card's save (`submitScope` in `use-watchdog-form.ts`) sends **its own draft over the other card's saved values**. On success only that card's edits are cleared; the other card's unsaved edits survive and stay dirty.
- **One save at a time.** `busy` disables both Saves while either one is in flight.
- **The tier-4 confirm `AlertDialog` opens only from the Ladder foot**, when the save newly grants reboot authority (`grantsRebootAuthority`: draft master and tier 4 both on, and they were not both on when saved). It keys on the master too, because a stock device ships tier 4 armed under a master that is off.
- Status: clean, dirty (`watchdog.save.dirty`), or blocked (`watchdog.save.blockedIn`, naming the card's offending fields joined with `Intl.ListFormat`). Clicking a blocked Save focuses and reveals the first offending control. Discard (ghost) is always rendered, disabled when clean or saving. Each save fires one `toast.success` / `toast.error`, with the failure reason from the call's returned result.
  > ⚠️ `SaveButton` swallows the click while `blockedReason` is set, so the jump to the blocked field runs from an `onClickCapture` on a `contents` wrapper span. An `onClick` on `SaveButton` never fires in that state.
  > ⚠️ Do not restore a page-level `save-bar.tsx` (deleted 2026-10-06) or a single apply spanning both cards (retired 2026-10-11). The Card-Foot Apply Rule in `DESIGN.md` forbids the first; the second made one card's Save commit fields on the other.

**Backup-slot save gating:** tier 3 armed without a slot **blocks the Ladder's save** — the frontend guard that keeps you out of the misconfig-stops-ladder state described above. The form validation mirrors the CGI ranges exactly, and its messages are i18n keys the rendering component translates.

**`check_interval` is never sent.** `toPayload` omits it, and the CGI validates and writes the key only when it is present (`watchdog.sh:229,284`), so the server's value is preserved.

### The draft model

`useWatchdogForm` holds only the user's edits (`Partial<WatchdogDraft>`) and renders `draft = { ...savedDraft(settings), ...edits }`. There is no fingerprint and no re-seed:

- The silent 30s refetch replaces the saved layer only. It never overwrites a field the user has edited, and an unedited field shows a new server value at once (for example after the daemon auto-disables itself).
- A card is dirty when any of its keys differs from the saved value, so editing a value back to what is saved makes the card clean again.
- A field the user has edited does **not** pick up a server-side change to that field; Discard drops the edit and shows the server value.

**i18n:** the surface is fully keyed under the top-level `watchdog` key of `public/locales/{en,zh-CN,zh-TW,it,id}/common.json` (134 keys in each pack), including screen-reader copy. The only untranslated text is the activity rows' producer-authored `message`.

**Motion:** one `staggerContainer` on the page root with every block a `staggerItem`, `rowCascadeDelay` for the log rows, and exactly one ambient loop — the status disc while the phase is `recovery`. The footer's unsaved dot (`FOOT.DOT`) is static, because an unsaved edit is not a live thing.

---

<a id="ping-source--split-ownership"></a>
## Ping source

The connectivity verdict the watchdog reads is produced by the **`qmanager_ping` daemon**, an always-on ICMP prober that writes `/tmp/qmanager_ping.json` (four-leg chain, `fail_elapsed_sec`, `streak_fail`, `interval_sec`). It runs regardless of `watchcat.enabled`. The watchdog only ever *reads* that file, and only through `conn_state.sh`, the reader it shares with the poller — it never probes and never writes it. Producer details: [connection-quality.md → The producer](connection-quality.md#the-producer--qmanager_ping-shell-icmp-daemon).

<a id="ping-cache-staleness-is-derived"></a>
### Ping-cache staleness is derived, not hardcoded

`conn_state_read` computes `stale_threshold = max(3 × interval_sec, 15)` from the cadence the cache itself reports, measures age on `mono` against `/proc/uptime` (wall clock only when `mono` is absent), and clamps an implausible `interval_sec` (non-numeric, or outside 1–300) back to 5 so staleness detection can never switch itself off. A stale read skips the cycle, and in cooldown it counts toward the three-retry limit. Full rule: [connection-quality.md → The staleness threshold](connection-quality.md#derived-staleness-threshold).

> ⚠️ WARNING: the daemon sources `conn_state.sh` behind `[ -f ]`. When the file is missing it logs `qlog_error` and installs stubs that always read stale, so the ladder never acts; BusyBox ash would otherwise **exit** on the `.` and take the watchdog down with it.

The cadence and the probe config (`/etc/qmanager/ping_profile.json`) belong to Connection Quality; this page's only write path into that file is the `probe_interval` mirror described in [The probe cadence is not a watchdog setting](#split-ownership-of-the-probe-cadence). The full write-path table is in [connection-quality.md](connection-quality.md#ping_profilejson--one-owner-two-write-paths).

---

## Known limitations

- **`qm_config_set` doesn't gate its `mv` on jq's exit status** (pre-existing). The `>` redirect creates an empty temp file *before* jq runs, so if jq fails on a corrupt/unparseable config, the unconditional `mv` publishes that empty temp over the live config. The `qm_config_delete` primitive added in this change was hardened against exactly this (it gates the `mv` on jq success); `qm_config_set` was left as-is and remains a latent hazard for a future fix.

---

## Related docs

- SIM detection — the known-SIMs set model, byte-parity vs. canonicalized ICCID comparison, and why failover slot-cycling must call `sim_db_add` at every landing point — [sim-detection.md](sim-detection.md)
- Connection Quality — the measurement/telemetry side (the `qmanager_ping` producer, the poller's latency/jitter/loss stats, the Probe Targets + Quality Thresholds cards) — [connection-quality.md](connection-quality.md)
- Ping daemon (`qmanager_ping`), the connectivity verdict the watchdog consumes — `docs/BACKEND.md`
- AT command transport (`qcmd`, flock serialization) — `docs/reference/at-command-transport.md`
- SIM profiles and auto-apply on SIM change — `docs/reference/sim-profiles.md`
- Platform architecture, daemons, boot sequence — `docs/rm520n-gl-architecture.md`, `docs/ARCHITECTURE.md`
