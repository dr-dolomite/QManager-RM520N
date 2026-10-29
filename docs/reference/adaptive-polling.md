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
- Constants only; there are no config keys and no settings page.

## Invariants

1. **Uptime, never the wall clock or `cycle_count`.** Ages and deadlines use `_MONO_TOP` (`/proc/uptime`, builtin read). The RM520N period varies (2.6–4 s, shorter when AT is skipped), and the boot clock step (~24 s into boot, `scheduled-timers.md`) must not flip a tier. If uptime is unreadable the poller stays Active.
2. **Heartbeat = any content change** of `/tmp/qmanager_ui_active`. `at_cmd/fetch_data.sh` and `public/overview.sh` write `$$` in place with a builtin `echo` (no fork). An empty read (a CGI mid-write) counts as no change.
3. **Nothing but www-data may create that file.** `/tmp` is sticky with `fs.protected_regular=1`, so a root-owned copy locks the CGIs out and the tier never returns to Active. The poller seeds the heartbeat in memory at start (`_HB_SEEN_MONO`), never by writing the file. Health check `cfg.ui_heartbeat` fails on any other owner.
4. **Inside the AT gate:** AT reads and their parsers, `determine_service_status`, `detect_events`. **Every cycle, every tier:** proc metrics, system health, ping/DNS reads, connection events, `check_alerts`, `crash_watcher_check`, `update_data_used`, `update_conn_uptime`, `write_cache`. Every `AP_LOCAL_INTERVAL` (10 s, uptime deadline): `append_ping_history`, `read_watchcat_state`. `status.json` is written every cycle in every tier.
5. **Deep keeps the last CA values.** The QCAINFO failure branch that zeroes the `t2_ca_*` fields sits inside the not-deep guard.
6. **One status poll per tab, at least every 10 s, none while hidden.** `useModemStatus` (`hooks/use-modem-status.ts`) is one module-level store with one timer for every caller (T6.2). The interval is the shortest any mounted caller asks for, capped at `MAX_POLL_INTERVAL` (10 s, half of `AP_ACTIVE_GRACE`), so an open page keeps the tier `active` even when the dashboard's ping-profile cadence is 30–60 s. A new caller fetches at once; until that lands it reads the shared snapshot (≤ 10 s old). The timer stops on `document.hidden` and fetches at once when visible again; without this a forgotten tab holds Active forever. Every other dashboard poll (signal history, events, latency history, auto-logout check) runs on `lib/visible-interval.ts` and also stops while hidden; the speedtest status loop has its own gate.

## Who sees older data

- `qmanager_tower_failover` reads `.lte.rsrp` / `.nr.rsrp` every 20 s: up to 60 s old in Deep (same as RM551E).
- Discord bot status: signal up to 60 s old in Deep (accepted, user 2026-10-27).
- Signal history gets a per-antenna point every 15 s in Idle and none in Deep. Events (band, PCI, SCC) are detected at touch time.

## Watchdog heartbeat

`qmanager_watchcat` writes `mono` (uptime s) and `stale_after` into `/tmp/qmanager_watchcat.json` on every write: `3 × check_interval + 60`, or `600` just before a recovery tier runs. The poller publishes `watchcat.age_sec` (uptime delta, never negative) and `watchcat.stale_after`; both are `null` when unknown. A missing state file resets every `watchcat.*` field. The watchdog page does not read these yet.

## Not ported yet (RM551E B5.29 Phase B)

The broker has run behind `qcmd` since T4.1, and the client accepts a capped wait (`qcmd -t <ms>`, or `QCMD_WAIT_MS=<ms>` for one call; a cap that runs out returns `modem_busy`). The poller does not use it yet: it still calls plain `qcmd`, keeps `SIP_DELAY=0.1` between commands and sleeps `POLL_INTERVAL` after each cycle. Still to port: the capped read wait, the per-cycle busy latch, dropping `SIP_DELAY`, and a fixed 2 s cycle.
