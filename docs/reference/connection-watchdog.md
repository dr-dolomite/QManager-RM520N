# Connection Watchdog

The Connection Watchdog (`qmanager_watchcat`) is a self-healing daemon that watches the modem's internet reachability and, when the link stays down, climbs a four-step recovery ladder from the gentlest fix (re-register to the network) to the most disruptive (reboot the device). It never pings on its own — it is a pure *state machine* that reads the verdict already produced by the ping daemon (`qmanager_ping`) and decides what to do about it. Its headline capability is **Tier-3 SIM failover**: on a dual-SIM RM520N-GL it can swap to the backup SIM slot when the primary carrier goes dark, ride on it, and later revert. This document describes the watchdog exactly as it ships on the RM520N-GL single target.

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
| Landed-SIM marker | `/etc/qmanager/last_iccid` (**persistent** — keeps the boot swap-detector honest) |
| Reboot log | `/etc/qmanager/crash.log` (**persistent** — Tier-4 token bucket source) |
| Frontend page | `/monitoring/watchdog` (`components/monitoring/watchdog/`) |
| Ping source | `/tmp/qmanager_ping.json` (from `qmanager_ping`; see `docs/BACKEND.md`) |

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
MONITOR ──streak_fail>0──▶ SUSPECT ──failures ≥ max_failures──▶ RECOVERY ──▶ COOLDOWN ──▶ MONITOR
   ▲                          │  (connectivity restored naturally)                │
   └──────────────────────────┘◀───────────────────────────────────────────────┘
LOCKED    — maintenance mode; sleeps until the lock clears
DISABLED  — turned off (config, or auto-disabled by the Tier-4 cap)
```

- **MONITOR** — the healthy resting state. Reads `qmanager_ping.json` each cycle; if the ping daemon reports any failure streak (`streak_fail > 0`) it moves to SUSPECT.
- **SUSPECT** — a debounce window. Each cycle that stays down increments `failure_count`; a clean read returns straight to MONITOR. When `failure_count` reaches `max_failures`, the watchdog declares the connection down and enters RECOVERY. This is why the UI previews "declares down after ~`check_interval × max_failures`s".
- **RECOVERY** — runs the current tier's action (see the ladder below), then drops into COOLDOWN. It doesn't linger here.
- **COOLDOWN** — waits for the action to settle, then re-reads the ping verdict to decide success or escalation (see *Cooldown adjudication*).
- **LOCKED** — set whenever a maintenance condition is present: the lock file `/tmp/qmanager_watchcat.lock` exists (touched by the OTA updater and installer), a long-running AT command is in flight (`/tmp/qmanager_long_running`), or a SIM-profile apply is running (`/tmp/qmanager_profile_apply.pid` points at a live process). The watchdog parks here so its AT commands never race those operations.
- **DISABLED** — `watchcat.enabled=0`, or the daemon shut itself off after tripping the Tier-4 reboot cap.

> ℹ️ NOTE: A **carrier-intercept** verdict short-circuits recovery. When the ping daemon reports `connectivity=limited` (a billing portal, data-cap wall, or activation walled garden is intercepting traffic), the watchdog stays in MONITOR and clears any pending recovery — no tier can fix a captive portal, so trying would only churn the modem.

### The escalation engine

`find_next_tier` walks the enabled tiers in order (1→4). SUSPECT breaching the threshold runs the first enabled tier; each failed COOLDOWN escalates to the next enabled one. When the last enabled tier still doesn't restore connectivity, the watchdog gives up gracefully and returns to MONITOR (it does not loop forever).

Each tier's return code drives the engine:
- **`0`** — action attempted → enter COOLDOWN and judge the result.
- **`1`** — tier skipped (a guard fired, e.g. tower lock on Tier 2, or an unreadable slot on Tier 3) → immediately try the next enabled tier.
- **`2`** — **misconfiguration** (Tier 3 only) → **stop the ladder outright** (see below).

### Cooldown adjudication

When the cooldown timer expires, `finish_cooldown` re-reads the ping cache to decide whether the recovery worked:

1. **Fresh read, reachable** → success. Reset to MONITOR. If this was a Tier-3 swap, *finalize* the failover (below).
2. **Fresh read, unreachable** → failure. If Tier 3, revert the SIM first; then escalate to the next enabled tier.
3. **Stale/missing ping data** → the ping daemon's cache can go transiently stale right after a radio or SIM churn. Rather than misjudging that as a failure, the watchdog **retries up to 3 times**, extending the cooldown by one `check_interval` each round. Only after 3 stale rounds does it treat the recovery as failed — and it does so *without* consulting the stale `reachable` value (which predates the cooldown and could read a spurious "true").

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
5. **Verifies the backup SIM is actually present** with `AT+CPIN?` — an `ERROR` means the backup slot is empty, and the watchdog falls back to the original slot.
6. Does **not** write the failover state yet — it waits for cooldown to confirm the backup SIM actually carries traffic.

**SIM-settle floor (`SIM_SETTLE_SECS = 90`):** after a Tier-3 swap the cooldown is `max(cooldown, 90)` seconds. A real SIM swap needs time to re-attach and get a data bearer on the new carrier; judging it "failed" after a short 10–60s cooldown would wrongly bounce a swap that was still coming up. The floor only applies to Tier 3.

**Finalize (in cooldown, on success):** when connectivity comes back on the backup SIM, the daemon writes `/etc/qmanager/qmanager_sim_failover`, emits a **"SIM failover confirmed"** event, persists the landed ICCID (below), and auto-applies any SIM profile matching the new card.

**Fallback (revert to original):** triggered when the modem is unresponsive after the swap, the backup slot has no SIM, or cooldown finds the backup SIM still can't reach the internet. It runs the Golden Rule back to `original_sim_slot`, restarts the tower-failover daemon, persists the reverted ICCID, and re-applies that SIM's profile.

### Tier 4 — Reboot Device (deferred)

The last resort: a full device reboot, guarded by a **token bucket**.

- `count_recent_reboots` counts `reboot` entries in `/etc/qmanager/crash.log` from the last hour.
- If that count is already at `max_reboots_per_hour`, the watchdog **does not reboot**. Instead it sets `enabled=0` in config, touches `/tmp/qmanager_watchcat_disabled`, and exits — a reboot loop is worse than a down link, so it stops itself and surfaces an auto-disabled banner in the UI.
- Otherwise it appends a timestamped line to `crash.log` (format `<epoch>|reboot|tier4_escalation`, trimmed to the last 20 entries), records the recovery, flushes state, and reboots after a 1s grace.

> ℹ️ NOTE: The reboot is issued through `run_reboot` after the state file is flushed. The watchdog runs *on* the modem, so this is the deferred pattern the platform requires — state is written before the device goes down, never mid-request.

---

## Misconfiguration stops the ladder (return code 2)

If Tier 3 is enabled but misconfigured — **no backup slot**, or **backup slot equals the current slot** — `execute_tier3` returns code `2`, and `do_recovery` **halts the recovery ladder** instead of escalating. It logs the misconfiguration, emits a `watchcat_recovery` error event, clears the recovery flag, and returns to MONITOR.

**Why:** a bad Tier-3 config is an operator mistake, not a connectivity problem. Cascading it into a Tier-4 reboot would punish the device for a settings error — reboots wouldn't fix the config and could loop.

> ⚠️ WARNING — the tradeoff: if Tier 3 is the **first enabled tier** and it's misconfigured, the ladder stops *before* Tier 4, so **Tier 4 (reboot) becomes unreachable through that path** until you either fix the backup slot or disable Tier 3. The UI guards against creating this state — enabling Tier 3 with no backup slot **blocks the save** — but a config edited by hand can still land here.

---

## Configuration

Config lives in `/etc/qmanager/qmanager.conf` under `[watchcat]`, read/written via `qm_config_get`/`qm_config_set`. The daemon reloads it live when the CGI touches `/tmp/qmanager_watchcat_reload`.

| Key | Type | CGI-validated range | Default | Meaning |
|-----|------|--------------------|---------|---------|
| `enabled` | bool (0/1) | — | off | Master enable. Saving toggles the systemd unit (enable+start / stop+disable). |
| `check_interval` | int (s) | 5–60 | 10 | Seconds between checks. The UI offers 5 / 10 / 15 / 30. |
| `max_failures` | int | 1–20 | 5 | Consecutive failed checks before recovery starts. |
| `cooldown` | int (s) | 10–300 | 60 | Wait after each recovery step before re-checking (Tier 3 is floored at 90s). |
| `tier1_enabled` | bool | — | on | Enable Tier 1 (re-register). |
| `tier2_enabled` | bool | — | on | Enable Tier 2 (radio toggle). |
| `tier3_enabled` | bool | — | off | Enable Tier 3 (SIM failover). |
| `tier4_enabled` | bool | — | on | Enable Tier 4 (reboot). |
| `backup_sim_slot` | `1` \| `2` \| `null` | `1`/`2`/null | null | SIM slot to fail over to. Required when Tier 3 is on. |
| `max_reboots_per_hour` | int | 1–10 | 3 | Tier-4 token-bucket cap. Auto-disable trips when hit. |

> ℹ️ NOTE: The config key is `max_failures` — it is **not** renamed. There are **no** `quality_*`, `ssr_*`, or `primary_recheck_*` keys on the RM520N-GL; quality-trigger, SSR-aware-hold, and auto-failback are not implemented here.

---

## State and flag files

**Persistent (`/etc/qmanager/`, survives reboot):**

| Path | Written by | Purpose |
|------|-----------|---------|
| `qmanager_sim_failover` | daemon (write on finalize / revert), CGI (read), poller (re-emit into `status.json`) | Active SIM-failover record. Persistent so a Tier-4 reboot doesn't lose the fact that you're riding the backup SIM. |
| `last_iccid` | daemon (`persist_last_iccid`), poller (boot detector) | The ICCID currently in use after a swap/revert. Keeps the poller's boot-time swap detector from false-firing "New SIM detected" on a watchdog-initiated swap. |
| `crash.log` | daemon (Tier 4) | Pipe-delimited reboot log (`<epoch>\|reboot\|tier4_escalation`), last 20 entries. Source for the token-bucket count. |
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
| `qmanager_recovery_active` | daemon | Set during any recovery; suppresses event noise while acting. |
| `qmanager_sim_swap_detected` | poller (boot detector) | Physical-SIM-swap notification surfaced in the UI; distinct from watchdog failover. |
| `qmanager_ping.json` | `qmanager_ping` | The connectivity verdict the watchdog reads (never writes). |

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
  "reboots_this_hour": 0
}
```

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

Returns the saved config plus a snapshot of daemon/failover/swap state:

```json
{
  "success": true,
  "settings": {
    "enabled": false,
    "max_failures": 5,
    "check_interval": 10,
    "cooldown": 60,
    "tier1_enabled": true,
    "tier2_enabled": true,
    "tier3_enabled": false,
    "tier4_enabled": true,
    "backup_sim_slot": null,
    "max_reboots_per_hour": 3
  },
  "status": { /* contents of /tmp/qmanager_watchcat.json, or {} if absent */ },
  "sim_failover": { /* contents of the failover record, or {"active":false} */ },
  "sim_swap": { /* SIM-swap detection, or {"detected":false} */ },
  "auto_disabled": false
}
```

### `POST` — dispatched on `action`

**`action: "save_settings"`** — carries every settings field in one atomic write. Validation is **two-pass**:

1. **Pass 1 (validate):** every field is extracted and range-checked *before any write*. The first invalid field short-circuits with, and nothing is persisted:

   ```json
   { "success": false, "error": "invalid_field", "field": "cooldown", "reason": "must be an integer between 10 and 300" }
   ```

2. **Pass 2 (apply):** only reached when every field validated. Writes each key via `qm_config_set`, touches the reload flag, and toggles the service — enable+restart when `enabled=1` (also clearing `auto_disabled`), or stop+disable when `enabled=0`.

   ```json
   { "success": true }
   ```

> ℹ️ NOTE — why two passes: `qm_config_set` writes each key immediately with no commit-staging (no transaction). Validating everything up front is the only way to guarantee a bad request can't leave the config half-applied. Tier enable booleans are the one exception — anything other than literal `true`/`false` is silently ignored (legacy parity), not rejected.

**Field ranges** (Pass 1): `max_failures` 1–20, `check_interval` 5–60, `cooldown` 10–300, `max_reboots_per_hour` 1–10, `backup_sim_slot` `1`/`2`/`null`.

**`action: "dismiss_sim_swap"`** — marks the physical-SIM-swap notification dismissed. → `{ "success": true }`

**`action: "revert_sim"`** — touches `/tmp/qmanager_watchcat_revert_sim`; the daemon reverts to the original slot on its next cycle. → `{ "success": true, "message": "SIM revert requested. The watchcat will process this shortly." }`

---

## Frontend anatomy

Page: `/monitoring/watchdog` — `components/monitoring/watchdog/watchdog.tsx`. A **status-first, two-column** layout (single column on narrow viewports): live status reads down the left, the one write surface (settings) holds the right.

**Data sources (three hooks):**
- `useWatchdogSettings` (`hooks/use-watchdog-settings.ts`) — the CGI above. Owns settings, `auto_disabled`, and the `save`/`revert_sim`/`dismiss_sim_swap` actions. Polls every 30s (silent) so `auto_disabled` surfaces live without flashing the skeleton.
- `useModemStatus` — the poller's `/tmp/qmanager_status.json` (`watchcat` + `sim_failover` blocks), polled every 5s. Feeds the **live** hero (state tile, counter strip, ladder highlight, failover banner).
- `useRecentActivities` — the shared Network Events feed, filtered client-side to `watchcat_recovery` + `sim_failover`. The watchdog writes its lifecycle to that feed using existing event types — no new event types were added.

**Left column:**
- **Watchdog Status** (`watchdog-status-card.tsx`) — a read-only Live Status hero: a `StateTile` (Monitoring / Detecting Issue / Recovering / Cooldown / Locked / Disabled), a wrap-flow counter strip (Current Step, Failed Checks, Cooldown remaining, Total Recoveries, Reboots This Hour, Last Recovery), a read-only `HeroLadder` stepper highlighting the running tier, an auto-disabled alert, and — when a failover is active — a "Running on backup SIM" alert with a **Revert to Original SIM** confirm dialog. The master enable **Switch** lives in this card's header and is *save-gated* (it applies on Save, not on toggle); the hero itself reflects **saved** state, never form drafts.
- **Recovery Activity** (`watchdog-recovery-activity-card.tsx`) — a paginated table of recent `watchcat_recovery` + `sim_failover` events.

**Right column:**
- **Watchdog Settings** (`watchdog-settings-card.tsx`) — tabbed **Detection** (check interval, failure threshold, cooldown, plus a live "declares down after ~Ns" derivation) and **Recovery** (the four-rung ladder with per-tier switches, each showing its AT sequence; the backup-slot selector under Tier 3 and the reboot cap under Tier 4). One sticky save bar commits the whole form (the backend save is atomic). Each tab shows an error dot when a field on it is invalid, and a blocked save jumps to the first offending field.

**Backup-slot save gating:** enabling Tier 3 without choosing a backup slot **blocks the save** in the form (`use-watchdog-form.ts`) — the frontend guard that keeps you out of the misconfig-stops-ladder state described above. The form validation mirrors the CGI ranges exactly.

> ℹ️ NOTE: All copy is inline English — the RM520N build has no i18n on this page.

---

## Related docs

- Ping daemon (`qmanager_ping`), the connectivity verdict the watchdog consumes — `docs/BACKEND.md`
- AT command transport (`qcmd`, flock serialization) — `docs/reference/at-command-transport.md`
- SIM profiles and auto-apply on SIM change — `docs/reference/sim-profiles.md`
- Platform architecture, daemons, boot sequence — `docs/rm520n-gl-architecture.md`, `docs/ARCHITECTURE.md`
