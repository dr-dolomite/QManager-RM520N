# Adaptive polling (poller activity tiers)

> **Applies to:** RM520N-GL · built 2026-10-27 (T6.1, plan `.orchestra/runs/2026-10-26-atd-port-T6.1.md`); shared status store 2026-10-28 (T6.2)
> **RG501Q-EU:** unverified. Port of RM551E adaptive polling (70c157d3) and B5.29 heartbeat work. The tiers are shell-only and do not depend on the AT broker.

When no browser is polling, `qmanager_poller` stops asking the modem every cycle. Local work keeps the base cadence.

## Tiers

`decide_tier` runs once per cycle, after `update_proc_metrics`, and sets `ap_tier` (published as `.device.poller_tier`).

| Tier | Heartbeat age | AT work |
| --- | --- | --- |
| `active` | ≤ `AP_ACTIVE_GRACE` (20 s) | Every cycle, exactly the pre-T6.1 cycle: serving cell + QCAINFO every cycle, per-antenna every 5 cycles, Tier 2 every 15 |
| `idle` | ≤ `AP_IDLE_THRESHOLD` (300 s) | Serving cell + QCAINFO + per-antenna every `AP_IDLE_INTERVAL` (15 s); Tier 2 at most every `AP_T2_IDLE` (60 s) |
| `deep` | > 300 s | Serving cell only every `AP_DEEP_INTERVAL` (60 s); Tier 2 at most every `AP_T2_DEEP` (300 s) |

- `TIER2_REFRESH_FLAG` forces one Active cycle with Tier 2. The long-running (scan) flag returns early and reports `active`.
- The first Active cycle after Idle/Deep runs per-antenna and Tier 2 at once, so a returning user sees a full snapshot.
- `AP_ENABLED` and the four tier times come from `qmanager.conf .poller` (below); `AP_T2_*` and `AP_LOCAL_INTERVAL` are constants.

## Settings (P7a, 2026-11-03)

**System Settings → Adaptive Polling** (`app/system-settings/adaptive-polling/`, `hooks/use-adaptive-polling.ts`) edits `qmanager.conf .poller` through `system/adaptive_polling.sh`. No seed: an absent section means defaults, and the CGI reports `isDefault: true`.

| Key | Poller global | Range | Default |
| --- | --- | --- | --- |
| `enabled` | `AP_ENABLED` | `0`/`false`/`no`/`off` = off, anything else on | on |
| `active_grace` | `AP_ACTIVE_GRACE` | 20–120 | 20 |
| `idle_interval` | `AP_IDLE_INTERVAL` | 5–300 | 15 |
| `idle_threshold` | `AP_IDLE_THRESHOLD` | 60–3600 and > `active_grace` | 300 |
| `deep_idle_interval` | `AP_DEEP_INTERVAL` | ≥ `idle_interval` and ≤ 300 | 60 (raised to `idle_interval` if lower) |

- **Clamp in the poller.** The file is www-data writable, so `resolve_poller_config` accepts only digit strings of ≤ 5 digits inside the range; anything else is the default. The CGI GET applies the same rules in jq, so the page shows what the poller runs with; the POST rejects out-of-range values and non-numbers (`invalid_<key>`).
- **Why the floors.** `active_grace` ≥ 20: the worst heartbeat age with an open page is ≈ 14 s (invariant 6). `deep_idle_interval` ≤ 300: `qmanager_tower_failover` reads `.nr.rsrp` every 20 s with no age check.
- **`enabled=0` pins Active** in `decide_tier` (AT every cycle, like a page always open).
- **Reload.** The CGI writes the five keys with `qm_config_set`, then touches `/tmp/qmanager_poller_reload` as www-data. The poller tests it each cycle (builtin `[ -f ]`), removes it and re-reads: the new values apply within one cycle. The poller never creates the flag (a root-owned copy would lock www-data out, as with the heartbeat). It also re-reads at start. Scan cycles skip the check; the flag waits.
- **jq missing.** `/usr/bin/jq` dangles until `/opt` mounts (~30 s into boot). jq rc 126/127 keeps defaults and retries every 60 s of uptime. Any other failure (absent file, bad JSON, absent section) is final until the next reload.
- The section key and shape are a contract: Config Backup (P7b) reads `qmanager.conf .poller`.
- Measured on RM520N-GL 61368cd2: with no page open, Idle AT cycles 15 s apart by default and 28–31 s apart after saving `idle_interval=30`; the poller logged the new values 2 s after the POST. With `enabled=false` and no heartbeat for ~3 h the tier stayed `active` (28 AT cycles in 70 s); one simulated page polling every 10 s with `active_grace=20` held `active` for all 558 one-second samples over 10 min.

## Invariants

1. **Uptime, never the wall clock or `cycle_count`.** Ages and deadlines use `_MONO_TOP` (`/proc/uptime`, builtin read). The RM520N period varies (2.6–4 s, shorter when AT is skipped), and the boot clock step (~24 s into boot, `scheduled-timers.md`) must not flip a tier. If uptime is unreadable the poller stays Active.
2. **Heartbeat = any content change** of `/tmp/qmanager_ui_active`. `at_cmd/fetch_data.sh` and `public/overview.sh` write `$$` in place with a builtin `echo` (no fork), skipped when the path is a symlink (`[ -L … ] ||`, also a builtin; `fs.protected_symlinks=1` covers the test-to-open race). An empty read (a CGI mid-write) counts as no change.
3. **Nothing but www-data may create that file.** `/tmp` is sticky with `fs.protected_regular=1`, so a root-owned copy locks the CGIs out and the tier never returns to Active. The poller seeds the heartbeat in memory at start (`_HB_SEEN_MONO`), never by writing the file. Health check `cfg.ui_heartbeat` fails on any other owner.
4. **Inside the AT gate:** AT reads and their parsers, `determine_service_status`, `detect_events`. **Every cycle, every tier:** proc metrics, system health, ping/DNS reads, connection events, `check_alerts`, `crash_watcher_check`, `update_data_used`, `update_conn_uptime`, `write_cache`. Every `AP_LOCAL_INTERVAL` (10 s, uptime deadline): `append_ping_history`, `read_watchcat_state`. `status.json` is written every cycle in every tier.
5. **Deep keeps the last CA values.** The QCAINFO failure branch that zeroes the `t2_ca_*` fields sits inside the not-deep guard.
6. **One status poll per tab, at least every 10 s, none while hidden.** `useModemStatus` (`hooks/use-modem-status.ts`) is one module-level store with one timer for every caller (T6.2). The interval is the shortest any mounted caller asks for, capped at `MAX_POLL_INTERVAL` (10 s, half of `AP_ACTIVE_GRACE`; worst heartbeat age at 10 s is ≈ 14 s with one poller cycle of detection lag), so an open page keeps the tier `active` even when the dashboard's ping-profile cadence is 30–60 s. A caller that names no interval gets 5 s (just over one poller cycle); pages that read only capabilities or config ask for `STATUS_POLL_SLOW_MS` (10 s), antenna alignment for `STATUS_POLL_FAST_MS` (2 s). A new caller fetches at once; until that lands it reads the shared snapshot (≤ 10 s old). The timer stops on `document.hidden` and fetches at once when visible again; without this a forgotten tab holds Active forever. Every other dashboard poll (signal history, events, latency history, auto-logout check) runs on `lib/visible-interval.ts` and also stops while hidden; the speedtest status loop has its own gate.

## Who sees older data

**QMI fills the gaps in LTE signal (T7.1, 2026-10-29).** On a write with no good `AT+QENG="servingcell"` read, `lte.rsrp` / `lte.rsrq` / `lte.rssi` come from the broker's QMI snapshot (≤ 5 s old, same LTE PCI and EARFCN as the last AT read) and `lte.source` is `"qmi"`. In Idle and Deep that is most writes. NR values, CA, per-antenna data and every AT-only field keep their tier ages below. Gate and invariants: [`qmi-lane.md`](qmi-lane.md).

- `qmanager_tower_failover` reads `.lte.rsrp` / `.nr.rsrp` every 20 s: LTE RSRP is QMI-fresh (≤ 5 s) while the lane is up; NR RSRP, and LTE without QMI, are up to 60 s old in Deep (same as RM551E).
- Discord bot status: LTE signal is QMI-fresh while the lane is up; otherwise up to 60 s old in Deep (accepted, user 2026-10-27 and 2026-10-29).
- Signal history gets a per-antenna point every 15 s in Idle and none in Deep. Events (band, PCI, SCC) are detected at touch time.

**Detached radio skips the radio reads (2026-11-02).** When this cycle's serving-cell read leaves neither `lte_state` nor `nr_state` `connected` (`radio_attached` in the poller), the per-antenna read and the Tier 2 time-advance / MIMO groups send nothing: each returns ERROR while detached, and `network_type` still holds the last attached mode. A skipped or failed per-antenna read writes `[null,null,null,null]` to `status.json` and signal history rather than repeating the last reading; `lte.ta` / `nr.ta` go blank. Measured on the RG501Q-EU (weak cell): of 136 `lte_time_advance` / `QRSRP` ERRORs in ~40 h of `qmanager.log`, 89 fell in such a cycle. The other 47 came while QENG still reported a cell on a link that dropped every minute or two; the gate cannot see those, and `qcmd` has no way to read without logging the ERROR. Both commands return OK on a stable attach.

## Watchdog heartbeat

`qmanager_watchcat` writes `mono` (uptime s) and `stale_after` into `/tmp/qmanager_watchcat.json` on every write: `3 × check_interval + 60`, or `600` just before a recovery tier runs. The poller publishes `watchcat.age_sec` (uptime delta, never negative) and `watchcat.stale_after`; both are `null` when unknown. A missing state file resets every `watchcat.*` field. The watchdog page does not read these yet.

## Not ported yet (RM551E B5.29 Phase B)

The broker has run behind `qcmd` since T4.1, and the client accepts a capped wait (`qcmd -t <ms>`, or `QCMD_WAIT_MS=<ms>` for one call; a cap that runs out returns `modem_busy`). The poller does not use it yet: it still calls plain `qcmd`, keeps `SIP_DELAY=0.1` between commands and sleeps `POLL_INTERVAL` after each cycle. Still to port: the capped read wait, the per-cycle busy latch, dropping `SIP_DELAY`, and a fixed 2 s cycle.
