# QManager Backend Development Log

**Project:** QManager — Custom GUI for Quectel RM551E-GL 5G Modem  
**Platform:** OpenWRT (Embedded Linux)  
**Last Updated:** February 19, 2026 (Band Locking Complete — Failover Safety, Scenario Integration, setsid Removal)

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Files Created & Deployment Map](#2-files-created--deployment-map)
3. [AT Command Reference (Verified)](#3-at-command-reference-verified)
4. [JSON Data Contract](#4-json-data-contract)
5. [Deployment Notes](#5-deployment-notes)
6. [Platform Quirks & Lessons Learned](#6-platform-quirks--lessons-learned)
7. [Resolved Debugging Notes](#7-resolved-debugging-notes)
8. [Connectivity Architecture Reference](#8-connectivity-architecture-reference)
9. [Speedtest Architecture Reference](#9-speedtest-architecture-reference)
10. [Band Locking Architecture Reference](#10-band-locking-architecture-reference)

**See also:** `TASKS.md` — Component wiring progress, remaining work, and active task tracker.

---

## 1. System Architecture Overview

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌───────────┐
│  React Frontend │────▶│ fetch_data   │────▶│ status.json      │◀────│  Poller   │
│  useModemStatus │ GET │   .sh (CGI)  │ cat │ (/tmp/ RAM disk) │write│  Daemon   │
└─────────────────┘     └──────────────┘     └──────────────────┘     └─────┬─────┘
                                                                            │
                                                    reads ┌─────────────────┤
                                                    ┌─────▼──────┐    ┌─────▼─────┐
                                                    │ ping.json  │    │   qcmd    │
                                                    │ (from ping │    │ (flock)   │
                                                    │  daemon)   │    └─────┬─────┘
                                                    └─────▲──────┘          │
                                                          │           ┌─────▼─────┐
                                              ┌───────────┴──┐        │ sms_tool  │
                                              │ qmanager_    │        │ (serial)  │
                                              │ ping         │        └───────────┘
                                              └──────────────┘
                                                    ▲
                                                    │ reads
                                              ┌─────┴────────┐
                                              │ qmanager_    │───▶ qcmd (Tier 2)
                                              │ watchcat     │
                                              └──────────────┘
```

### Core Principles

- **Single Pipe Constraint:** The modem serial port (`/dev/ttyUSB2`) is single-channel. All AT commands MUST go through `qcmd` which uses `flock` to serialize access.
- **State Cache Pattern:** The poller daemon writes to `/tmp/qmanager_status.json` (RAM disk). The frontend reads from this cache. The UI **never** touches the modem directly.
- **"Sip, Don't Gulp":** The poller acquires the lock, runs ONE AT command, releases, sleeps briefly, then repeats. This leaves gaps for the terminal and watchdog to access the modem.
- **Flash Protection:** All volatile writes go to `/tmp/` (tmpfs/RAM). No flash wear.
- **Atomic Writes:** The poller writes to `status.json.tmp`, then uses `mv` (atomic rename) to replace `status.json`. The frontend never reads a half-written file.

### Four Competing Actors

| Actor | Purpose | Access Pattern |
|-------|---------|----------------|
| Dashboard Poller | Continuous signal/status updates | Every 2–30s, multiple AT commands |
| User Terminal | Manual AT commands from web UI | Random, on-demand |
| Watchcat | Recovery actions (Tier 2: AT+CFUN) | Rare, only during connectivity failure recovery |
| Ping Daemon | Internet reachability & latency | **Never touches modem** — uses ICMP ping only |

---

## 2. Files Created & Deployment Map

### Backend Scripts (Shell)

| Local Path | Deploys To (Modem) | Purpose |
|---|---|---|
| `scripts/usr/bin/qcmd` | `/usr/bin/qcmd` | **Gatekeeper** — flock-based mutex, stale lock recovery, command classification (short/long), timeout wrapping |
| `scripts/usr/bin/qmanager_poller` | `/usr/bin/qmanager_poller` | **Poller Daemon** — Tier 1/2/Boot polling, AT command parsing, JSON cache writer |
| `scripts/etc/init.d/qmanager` | `/etc/init.d/qmanager` | **procd init script** — manages poller lifecycle with auto-respawn |
| `scripts/usr/bin/qmanager_ping` | `/usr/bin/qmanager_ping` | **Ping Daemon** — unified ICMP ping loop, writes `/tmp/qmanager_ping.json` (RTT, reachable, streaks, history) |
| `scripts/usr/bin/qmanager_watchcat` | `/usr/bin/qmanager_watchcat` | **Watchcat** — reads ping data, state machine (MONITOR→SUSPECT→RECOVERY→COOLDOWN→LOCKED), tiered escalation |
| `scripts/usr/lib/qmanager/qlog.sh` | `/usr/lib/qmanager/qlog.sh` | **Logging Library** — sourceable centralized logging with levels, rotation, dual output (file + syslog) |
| `scripts/usr/bin/qmanager_logread` | `/usr/bin/qmanager_logread` | **Log Viewer** — CLI utility for filtering, tailing, and inspecting QManager logs |
| `scripts/cgi/quecmanager/at_cmd/fetch_data.sh` | `/www/cgi-bin/quecmanager/at_cmd/fetch_data.sh` | **Dashboard CGI** — serves cached JSON, zero modem contact |
| `scripts/cgi/quecmanager/at_cmd/send_command.sh` | `/www/cgi-bin/quecmanager/at_cmd/send_command.sh` | **Terminal CGI** — POST endpoint for manual AT commands via qcmd |
| `scripts/cgi/quecmanager/at_cmd/fetch_events.sh` | `/www/cgi-bin/quecmanager/at_cmd/fetch_events.sh` | **Events CGI** — serves `/tmp/qmanager_events.json` (NDJSON→JSON array conversion) for Recent Activities |
| `scripts/cgi/quecmanager/at_cmd/fetch_signal_history.sh` | `/www/cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh` | **Signal History CGI** — serves `/tmp/qmanager_signal_history.json` (NDJSON→JSON array conversion) for Signal History chart |
| `scripts/cgi/quecmanager/at_cmd/speedtest_check.sh` | `/www/cgi-bin/quecmanager/at_cmd/speedtest_check.sh` | **Speedtest Check CGI** — GET endpoint, returns `{"available": true/false}` based on `command -v speedtest` |
| `scripts/cgi/quecmanager/at_cmd/speedtest_start.sh` | `/www/cgi-bin/quecmanager/at_cmd/speedtest_start.sh` | **Speedtest Start CGI** — POST endpoint, spawns Ookla speedtest-cli in detached session via setsid + wrapper script. Singleton enforcement via PID file. |
| `scripts/cgi/quecmanager/at_cmd/speedtest_status.sh` | `/www/cgi-bin/quecmanager/at_cmd/speedtest_status.sh` | **Speedtest Status CGI** — GET endpoint, returns idle/running/complete/error with progress data. Filters for JSON-only lines (grep `^{`) to skip ASCII art. |
| `scripts/cgi/quecmanager/bands/current.sh` | `/www/cgi-bin/quecmanager/bands/current.sh` | **Band Current CGI** — GET endpoint, queries `AT+QNWPREFCFG="ue_capability_band"` for locked bands + reads failover flags |
| `scripts/cgi/quecmanager/bands/lock.sh` | `/www/cgi-bin/quecmanager/bands/lock.sh` | **Band Lock CGI** — POST endpoint, applies `AT+QNWPREFCFG` for one band type, spawns failover watcher if enabled |
| `scripts/cgi/quecmanager/bands/failover_toggle.sh` | `/www/cgi-bin/quecmanager/bands/failover_toggle.sh` | **Failover Toggle CGI** — POST endpoint, writes enabled flag to `/etc/qmanager/band_failover_enabled` |
| `scripts/cgi/quecmanager/bands/failover_status.sh` | `/www/cgi-bin/quecmanager/bands/failover_status.sh` | **Failover Status CGI** — GET endpoint, lightweight (zero modem contact), reads 2 flag files + checks watcher PID |
| `scripts/usr/bin/qmanager_band_failover` | `/usr/bin/qmanager_band_failover` | **Band Failover Watcher** — One-shot script: sleeps 15s, checks `AT+QCAINFO` for signal, resets bands to policy_band defaults on failure |

**Note on file extensions:** Directly-executed scripts in `/usr/bin/` have **no** `.sh` extension (`qcmd`, `qmanager_poller`, `qmanager_logread`). The logging library keeps `.sh` because it's sourced (`. /usr/lib/qmanager/qlog.sh`), not executed directly. CGI scripts keep `.sh` because the extension is part of their URL path.

### Logging System

All backend scripts use the centralized logging library (`/usr/lib/qmanager/qlog.sh`). Logs are written to `/tmp/qmanager.log` (RAM disk — no flash wear).

**Log Format:**
```
[2026-02-14 15:30:45] INFO  [poller:1234] QManager Poller starting
[2026-02-14 15:30:45] DEBUG [qcmd:1235] AT_CMD: AT+QENG="servingcell" → +QENG: "servingcell",...
[2026-02-14 15:30:46] WARN  [qcmd:1236] LOCK: Timeout waiting for lock (short command: AT+COPS?)
[2026-02-14 15:30:47] INFO  [poller:1234] STATE: network_type: LTE → 5G-NSA
```

**Components Logged:**
| Component | Tag | What's Logged |
|-----------|-----|---------------|
| Gatekeeper | `qcmd` | Lock acquire/release/timeout/stale recovery, AT command execution, timeouts |
| Poller | `poller` | Boot data collection, state transitions, modem reachability changes, poll failures |
| Ping Daemon | `ping` | Target reachability changes, streak events, daemon start/stop |
| Watchcat | `watchcat` | State transitions, recovery actions, escalation tier changes, bootloop guard triggers |
| Dashboard CGI | `cgi_fetch` | Cache file missing (fallback) |
| Terminal CGI | `cgi_terminal` | Commands received, blocked long commands |

**Configuration:**
- Log level: Set via `/etc/qmanager/log_level` (DEBUG, INFO, WARN, ERROR). Default: INFO
- Max log size: 256KB per file (configurable via `QLOG_MAX_SIZE_KB`)
- Rotation: Keeps 2 rotated files (`qmanager.log.1`, `qmanager.log.2`)
- Also logs to syslog (viewable via `logread`)

**Log Viewer — `qmanager_logread`:**
```bash
qmanager_logread                   # Last 50 lines
qmanager_logread -f                # Follow live output (tail -f)
qmanager_logread -f -c qcmd        # Follow only qcmd messages
qmanager_logread -l ERROR          # Show only errors
qmanager_logread -l WARN -n 100   # Last 100 warnings
qmanager_logread -s "LOCK"         # Search for lock events
qmanager_logread -s "STATE"        # Search for state transitions
qmanager_logread --status          # Show log file stats and level distribution
qmanager_logread --clear           # Clear all logs
```

**Changing Log Level at Runtime:**
```bash
echo "DEBUG" > /etc/qmanager/log_level
/etc/init.d/qmanager restart
```

### Frontend (TypeScript/React)

| Local Path | Purpose |
|---|---|
| `types/modem-status.ts` | JSON data contract as TypeScript interfaces + utility functions (signal quality, formatting) |
| `hooks/use-modem-status.ts` | Polling hook — fetches `/cgi-bin/quecmanager/at_cmd/fetch_data.sh` every 2s, provides `data`, `isLoading`, `isStale`, `error`, `refresh()` |
| `hooks/use-recent-activities.ts` | Events hook — fetches `/cgi-bin/quecmanager/at_cmd/fetch_events.sh` every 10s, provides `events` (newest first), `isLoading`, `error` |
| `components/dashboard/home-component.tsx` | **Wired** — `"use client"`, calls `useModemStatus()`, passes data + `modemReachable` down to child components |
| `components/dashboard/network-status.tsx` | **Wired** — Accepts `data`, `modemReachable`, `isLoading`, `isStale` props, renders dynamic network status |
| `types/speedtest.ts` | Speedtest data contract — Ookla CLI NDJSON types (progress + result), CGI response types, utility functions (`bytesToMbps`, `formatSpeed`, `formatBytes`) |
| `hooks/use-speedtest.ts` | Speedtest lifecycle hook — availability check, start, 500ms progress polling, result caching, stale closure-safe via functional setState |
| `components/dashboard/speedtest-dialog.tsx` | Speedtest modal dialog — 5 states (idle/initializing/ping/download+upload/complete/error), live speed display, result grid, blocks close while running |
| `hooks/use-signal-history.ts` | Signal History hook — fetches `/cgi-bin/.../fetch_signal_history.sh` every 10s, picks best antenna per RAT, provides `chartData` (last 10 points), `raw`, `isLoading`, `error` |
| `components/dashboard/signal-history.tsx` | **Wired** — Per-antenna signal chart. Metric toggle (RSRP/RSRQ/SINR), time range selector, LTE vs 5G dual area chart via Recharts |
| `components/dashboard/live-latency.tsx` | **Updated** — Added speedtest play button that opens `SpeedtestDialog`, manages dialog open state |
| `lib/earfcn.ts` | **EARFCN/NR-ARFCN Utility** — DL/UL frequency calculation (3GPP TS 36.101 + 38.104 global raster), band name lookup, duplex mode lookup. Handles NR band overlap ambiguity (e.g. ARFCN 528030 → n7 FDD vs n41 TDD) via optional band hint parameter. Used by Active Bands component. |
| `components/cellular/active-bands.tsx` | **Wired** — Per-carrier accordion with signal bars, technology+duplex badge (e.g. "PCC LTE FDD"), band name, DL/UL frequency, bandwidth, EARFCN, PCI |
| `components/cellular/cell-data.tsx` | **Wired** — Cellular Information card with ISP, APN, network type, Cell ID, TAC, bandwidth, CA, MIMO, WAN IP, DNS |
| `types/band-locking.ts` | **Band Locking Types** — `BandCategory`, `CurrentBands`, `FailoverState`, `FailoverStatusResponse`, parse/format utilities |
| `hooks/use-band-locking.ts` | **Band Locking Hook** — Fetches current bands, locks/unlocks per-category, failover toggle, failover status polling after lock |
| `components/cellular/band-locking.tsx` | **Wired** — Page coordinator. Owns `useModemStatus`, `useBandLocking`, `useConnectionScenarios`. Scenario override banner. Distributes data to cards. |
| `components/cellular/band-cards.tsx` | **Wired** — Per-category checkbox grid with Select All/Clear, Lock/Unlock buttons. Lock status badge. Disabled mode for scenario override. |
| `components/cellular/band-settings.tsx` | **Wired** — Failover toggle + status badge (Disabled/Ready/Using Default Bands). Active LTE/NR5G bands + ARFCNs from carrier_components. |

---

## 3. AT Command Reference (Verified)

All commands below have been tested against the actual RM551E-GL hardware and their response formats verified.

### Important: sms_tool Output Format

`sms_tool` echoes the AT command back before the modem response:
```
AT+COPS?                    ← echo (MUST be stripped)
+COPS: 0,0,"SMART",7       ← actual response
OK                          ← trailing OK (MUST be stripped)
```

The `qcmd_exec()` helper in the poller strips lines starting with `AT` and `OK` before passing data to parsers. Individual parsers additionally filter for their expected prefix (e.g., `grep '^+QENG:'`) as a safety net.

### Tier 1 — Hot Data (Every 2 Seconds)

#### `AT+QENG="servingcell"`

Primary serving cell info. Three response modes:

**LTE-Only (single line):**
```
+QENG: "servingcell","NOCONN","LTE","FDD",515,03,233B76D,135,1350,3,4,4,BF82,-118,-14,-85,11,7,230,-
```
Field positions (1-indexed after stripping `+QENG:`):
```
1=servingcell 2=state 3=LTE 4=is_tdd 5=MCC 6=MNC 7=cellID
8=PCID 9=earfcn 10=freq_band_ind 11=UL_bw 12=DL_bw 13=TAC
14=RSRP 15=RSRQ 16=RSSI 17=SINR 18=CQI 19=tx_power 20=srxlev
```

**EN-DC / NSA (three lines):**
```
+QENG: "servingcell","CONNECT"
+QENG: "LTE","FDD",<MCC>,<MNC>,<cellID>,<PCID>,<earfcn>,<freq_band_ind>,<UL_bw>,<DL_bw>,<TAC>,<RSRP>,<RSRQ>,<RSSI>,<SINR>,<CQI>,<tx_power>,<srxlev>
+QENG: "NR5G-NSA",<MCC>,<MNC>,<PCID>,<RSRP>,<SINR>,<RSRQ>,<ARFCN>,<band>,<NR_DL_bw>,<scs>
```
Note: LTE line is SEPARATE from the "servingcell" line. NR5G-NSA field order: PCID(4), RSRP(5), **SINR(6)**, RSRQ(7) — SINR before RSRQ!

**SA (single line):**
```
+QENG: "servingcell","CONNECT","NR5G-SA",<duplex>,<MCC>,<MNC>,<cellID>,<PCID>,<TAC>,<ARFCN>,<band>,<NR_DL_bw>,<RSRP>,<RSRQ>,<SINR>,<scs>,<srxlev>
```

**Key parsing notes:**
- In LTE-only mode, `"LTE"` appears on the SAME line as `"servingcell"` (field positions shift +2 compared to EN-DC mode where they're on separate lines).
- `NOCONN` means "registered on network, no active data session" — signal values ARE present and valid. The modem IS camped on a cell. This is NOT "no service".
- `SEARCH` means actively searching — no signal values available, parser returns early.

#### `/proc` reads (no modem lock needed)

| Source | Data |
|--------|------|
| `/proc/net/dev` | RX/TX bytes for traffic calculation |
| `/proc/stat` | CPU usage percentage (delta between cycles) |
| `/proc/uptime` | Device uptime |
| `/proc/meminfo` | MemTotal, MemAvailable |

### Tier 2 — Warm Data (Every ~30 Seconds)

#### `AT+QTEMP`
```
+QTEMP: "sdr0","33"
+QTEMP: "mmw0","-273"       ← -273 = sensor unavailable, SKIP
+QTEMP: "cpuss-0","37"
+QTEMP: "cpuss-1","38"
...
```
**Parsing:** Extract all quoted temperature values, filter out `-273`, compute **average** of remaining values.

#### `AT+COPS?`
```
+COPS: 0,0,"Smart",7
```
Carrier name is field 3 (quoted string).

#### `AT+CPIN?`
```
+CPIN: READY
```
Values: `READY`, `SIM PIN`, `SIM PUK`, `NOT INSERTED`, `ERROR`

#### `AT+QUIMSLOT?`
```
+QUIMSLOT: 1
```
Active SIM slot number.

#### `AT+CNUM`
```
+CNUM: ,"+639391513538",145
```
Phone number is field 2 (quoted).

#### `AT+QCAINFO=1;+QCAINFO;+QCAINFO=0`
Semicolon-chained command — works as a single `sms_tool` call (one lock acquisition).
```
+QCAINFO: "PCC",1350,75,"LTE BAND 3",1,135,-115,-15,-82,5
+QCAINFO: "SCC",9485,75,"LTE BAND 28",1,135,-108,-10,-89,0,0,-,-
```
**Parsing:** Count `"SCC"` lines containing `LTE BAND` for LTE CA. Count `"SCC"` lines containing `NR` for NR CA. Both counts tracked separately.

#### `AT+QNWCFG="lte_time_advance"` / `"nr5g_time_advance"`

**Architecture:** TA reporting is enabled once at boot via `AT+QNWCFG="lte_time_advance",1` and `AT+QNWCFG="nr5g_time_advance",1` (in `collect_boot_data()`). Tier 2 polling uses query-only commands:
- `AT+QNWCFG="lte_time_advance"` — returns current LTE TA value
- `AT+QNWCFG="nr5g_time_advance"` — returns current NR TA value (ERROR when no 5G active)

**⚠ Note:** The NR command is `nr5g_time_advance`, NOT `nr_time_advance`. This differs from the LTE naming convention.

Both are separate AT calls (not chained) so an NR ERROR doesn't kill the LTE result.

```
+QNWCFG: "lte_time_advance",1,42       ← 3 fields: feature_name, enabled, TA_value
+QNWCFG: "nr5g_time_advance",1,4608,0  ← 4 fields: feature_name, enabled, NTA_value, extra
```
**Parsing:** Select lines with 3+ comma-separated fields (`awk -F',' 'NF>=3'`). Extract field 3 (`awk '{print $3}'`) as the TA value — NOT `$NF` (last field), because the NR response has a trailing 4th field. Strip `\r` carriage returns (sms_tool artifact).

**Distance calculation (done on frontend):**
- **LTE:** TA index (0–1282). Distance = (c × 16 × TA × Ts) / 2 where Ts = 1/30720000 (3GPP TS 36.213)
- **NR:** Raw NTA value. Distance = (c × NTA × Tc) / 2 where Tc = 1/(480×10³×4096) (3GPP TS 38.213)
- If no 5G anchor active, NR TA will be empty/null — displays as "-"
- Example: LTE TA=42 → 3.28 km

### Boot-Only — Static Data (Once at Startup)

#### `AT+CVERSION`
```
VERSION: RM551EGL00AAR01A04M8G
Jun 25 2025 08:57:52
Authors: Quectel
```
Replaces `AT+QGMR`. Provides firmware version, build date, and manufacturer.

#### `AT+CGSN`
```
356303480863545
```
IMEI (15-digit hardware identifier).

#### `AT+CIMI`
```
515031726432435
```
IMSI (SIM identifier).

#### `AT+QCCID`
```
+QCCID: <iccid>
```
SIM card serial number.

#### `AT+QGETCAPABILITY`
```
+QGETCAPABILITY: NR:41,78
+QGETCAPABILITY: LTE-FDD:1,3,28
+QGETCAPABILITY: LTE-TDD:40,41
+QGETCAPABILITY: WCDMA:1,2,4,5,8,19
+QGETCAPABILITY: LTE-CATEGORY:20
+QGETCAPABILITY: LTE-CA:1
```
We extract: `LTE-CATEGORY:20` → stored as `"20"`.

#### `AT+QNWCFG="lte_mimo_layers"` / `"nr5g_mimo_layers"`

**Architecture:** MIMO layer reporting is enabled once at boot via `AT+QNWCFG="lte_mimo_layers",1` and `AT+QNWCFG="nr5g_mimo_layers",1` (in `collect_boot_data()`). Tier 2 polling uses query-only commands.

**⚠ Note:** The NR command is `nr5g_mimo_layers`, NOT `nr_mimo_layers`. Same `nr5g_` prefix convention as time advance.

```
+QNWCFG: "lte_mimo_layers",1,4      ← LTE: UL=1, DL=4 → "LTE 1x4"
+QNWCFG: "nr5g_mimo_layers",1,2     ← NR: UL=1, DL=2 → "NR 1x2"
```
Fields: `<ulmimo>,<dlmimo>`. Combined as `"LTE 1x4 | NR 1x2"`. NR query returns ERROR when no 5G active (gracefully handled — displays LTE-only).

### Commands NOT Used

| Command | Reason |
|---------|--------|
| `AT+QGMR` | Replaced by `AT+CVERSION` (provides build date + manufacturer) |
| `AT+QNWINFO` | Network type derived from `AT+QENG="servingcell"` response directly |

---

## 4. JSON Data Contract

Full schema for `/tmp/qmanager_status.json`. TypeScript interfaces are in `types/modem-status.ts`.

```json
{
  "timestamp": 1707900000,
  "system_state": "normal | degraded | scan_in_progress | initializing",
  "modem_reachable": true,
  "last_successful_poll": 1707900000,
  "errors": [],
  "network": {
    "type": "LTE | 5G-NSA | 5G-SA | ",
    "sim_slot": 1,
    "carrier": "SMART",
    "service_status": "optimal | connected | limited | no_service | searching | sim_error | unknown",
    "ca_active": false,
    "ca_count": 0,
    "nr_ca_active": false,
    "nr_ca_count": 0
  },
  "lte": {
    "state": "connected | disconnected | searching | limited | inactive | unknown | error",
    "band": "B28",
    "earfcn": 9485,
    "bandwidth": 4,
    "pci": 135,
    "rsrp": -121,
    "rsrq": -17,
    "sinr": 7,
    "rssi": -85,
    "ta": 42
  },
  "nr": {
    "state": "connected | inactive | unknown",
    "band": "N41",
    "arfcn": 499200,
    "pci": 200,
    "rsrp": -88,
    "rsrq": -9,
    "sinr": 15,
    "scs": 30,
    "ta": null
  },
  "device": {
    "temperature": 37,
    "cpu_usage": 12,
    "memory_used_mb": 284,
    "memory_total_mb": 569,
    "uptime_seconds": 2110,
    "conn_uptime_seconds": 561,
    "firmware": "RM551EGL00AAR01A04M8G",
    "build_date": "Jun 25 2025",
    "manufacturer": "Quectel",
    "imei": "356303480863545",
    "imsi": "515031726432435",
    "iccid": "89630321281171069681",
    "phone_number": "+639391513538",
    "lte_category": "20",
    "mimo": "LTE 1x2"
  },
  "traffic": {
    "rx_bytes_per_sec": 0,
    "tx_bytes_per_sec": 0,
    "total_rx_bytes": 0,
    "total_tx_bytes": 0
  },
  "connectivity": {
    "internet_available": true,
    "status": "connected | degraded | disconnected | recovery | unknown",
    "latency_ms": 34.2,
    "avg_latency_ms": 37.1,
    "min_latency_ms": 28.5,
    "max_latency_ms": 52.3,
    "jitter_ms": 4.8,
    "packet_loss_pct": 0,
    "ping_target": "8.8.8.8",
    "latency_history": [34.2, 35.1, null, 33.8],
    "history_interval_sec": 2,
    "history_size": 60,
    "during_recovery": false
  },
  "watchcat": {
    "state": "monitor | suspect | recovery | cooldown | locked | disabled",
    "enabled": true,
    "failure_count": 0,
    "current_tier": 1,
    "last_recovery_action": null,
    "last_recovery_time": null,
    "reboots_this_hour": 0,
    "cooldown_remaining_sec": 0
  }
}
```

### Schema Rules

1. Signal values (`rsrp`, `rsrq`, `sinr`) are always numbers or `null`, never strings with units.
2. Band names use 3GPP notation: `"B3"` for LTE Band 3, `"N41"` for NR Band 41.
3. `timestamp` is Unix epoch (seconds).
4. `errors` array contains string codes, not human-readable messages.
5. Traffic values are raw bytes per second. Frontend converts to Mbps/Kbps.
6. Numeric fields that may be unavailable use `null` (not `0` or `""`).

### Service Status Mapping

The poller maps the AT+QENG `state` field to `service_status` as follows:

| AT+QENG State | Internal Mapping | Final `service_status` |
|---|---|---|
| `CONNECT` | `connected` | `optimal` (RSRP > -100) or `connected` (RSRP ≤ -100) |
| `NOCONN` | `idle` → upgraded | `optimal` or `connected` based on RSRP (modem is registered, has signal) |
| `LIMSRV` | `limited` | `limited` |
| `SEARCH` | `searching` | `searching` |
| No response | `unknown` | `unknown` |

**Key insight:** `NOCONN` does NOT mean "no service". It means the modem is registered on the network with valid signal values but has no active data bearer (PDP context). The frontend should treat it as connected.

---

## 5. Component Wiring Progress

### Home Page Dashboard (`/dashboard`)

| Component | File | Status | Data Source |
|-----------|------|--------|-------------|
| **Network Status** | `network-status.tsx` | ✅ **DONE** | `data.network` + `data.modem_reachable` — network type icon, carrier, SIM slot, service status with pulsating rings, radio badge, loading skeletons, stale indicator |
| **4G Primary Status** | `lte-status.tsx` | ✅ **DONE** | `data.lte` — band, EARFCN, PCI, RSRP, RSRQ, RSSI, SINR |
| **5G Primary Status** | `nr-status.tsx` | ✅ **DONE** | `data.nr` — band, ARFCN, PCI, RSRP, RSRQ, SINR, SCS |
| **Device Information** | `device-status.tsx` | ✅ **DONE** | `data.device` — firmware, build date, manufacturer, IMEI, IMSI, ICCID, phone, LTE category, MIMO |
| **Device Metrics** | `device-metrics.tsx` | ✅ **DONE** | `data.device` (temp, CPU, memory, uptime) + `data.traffic` (live traffic, data usage). Uptimes read directly from poll data (no client-side 1s tick — minutes are the smallest displayed unit). |
| **Internet Badge** | `network-status.tsx` | ✅ **DONE** | `data.connectivity.internet_available` — three-state badge (green/red/gray for true/false/null). Replaced placeholder `hasInternet = isServiceActive`. |
| **Live Latency** | `live-latency.tsx` | ✅ **DONE** | `data.connectivity` — Line chart of last 5 RTT values, stats row (current/avg/jitter/loss), Online/Offline badge, loading skeleton, "ping daemon not running" fallback |
| **Recent Activities** | `recent-activities.tsx` | ✅ **DONE** | Self-contained: `useRecentActivities()` hook polls `/cgi-bin/.../fetch_events.sh` every 10s. Poller detects state changes and writes NDJSON to `/tmp/qmanager_events.json`. Displays max 5 most recent events. |
| **Signal History** | `signal-history.tsx` | ✅ **DONE** | Self-contained: `useSignalHistory()` hook polls `/cgi-bin/.../fetch_signal_history.sh` every 10s. Backend (Tier 1.5) writes per-antenna NDJSON to `/tmp/qmanager_signal_history.json`. Hook picks best antenna per RAT, displays last 10 points. Metric toggle (RSRP/RSRQ/SINR), time range selector, LTE vs 5G dual area chart. |
| **Speedtest Dialog** | `speedtest-dialog.tsx` | ✅ **DONE** | On-demand via `speedtest_*.sh` CGI endpoints. Triggered from Live Latency play button. No modem serial interaction (IP-layer only). |

### Network Status Component Details

**Props:** `data: NetworkStatus | null`, `modemReachable: boolean`, `isLoading: boolean`, `isStale: boolean`

**Radio Badge Logic:**
| Condition | Display |
|-----------|---------|
| `modemReachable === true` | 🟢 Radio On |
| `modemReachable === false` | 🔴 Radio Off |

**Network Type Circle:**
| Condition | Icon | Background | Badge | Label / Sublabel |
|-----------|------|------------|-------|------------------|
| `5G-NSA` | `MdOutline5G` | `bg-primary` | ✅ green | "5G Signal" / "5G + LTE" |
| `5G-NSA` + NR CA | `MdOutline5G` | `bg-primary` | ✅ green | "5G Signal" / "5G + LTE / NR-CA" |
| `5G-SA` | `MdOutline5G` | `bg-primary` | ✅ green | "5G Signal" / "Standalone" |
| `5G-SA` + NR CA | `MdOutline5G` | `bg-primary` | ✅ green | "5G Signal" / "Standalone / NR-CA" |
| `LTE` + CA active | `Md4gPlusMobiledata` | `bg-primary` | ✅ green | "LTE+ Signal" / "4G Carrier Aggregation" |
| `LTE` no CA | `Md4gMobiledata` | `bg-primary` | ✅ green | "LTE Signal" / "4G Connected" |
| No 4G/5G (default) | `Md3gMobiledata` (dimmed) | `bg-muted` | ❌ red | "Signal" / "No 4G/5G" |

### Recent Activities — Event Severity Model

Events are categorized as **positive** (green check ✅) or **negative** (red X ❌). There is no intermediate/warning icon — the frontend maps `info` → check, `warning`/`error` → X.

**Positive events** (`severity: "info"`) — connection improvements:

| Event | Example Message |
|-------|----------------|
| Modem signal restored | "Modem signal restored" |
| Network mode upgrade | "Network mode changed from LTE to 5G-NSA" |
| 5G NR anchor acquired | "5G NR anchor acquired (N41)" |
| LTE/NR CA activated | "LTE Carrier Aggregation activated (3 carriers)" |
| Carrier count increased | "LTE carriers changed from 2 to 3" |
| Internet restored | "Internet connectivity restored" |
| Band change (neutral) | "LTE band changed from B3 to B28" |
| Cell handoff (neutral) | "LTE cell handoff (PCI: 135 -> 200)" |

**Negative events** (`severity: "warning"`) — connection degradations:

| Event | Example Message |
|-------|----------------|
| Modem became unreachable | "Modem became unreachable" |
| Network mode downgrade | "Network mode changed from 5G-NSA to LTE" |
| 5G NR anchor lost | "5G NR anchor lost" |
| LTE/NR CA deactivated | "LTE Carrier Aggregation deactivated" |
| Carrier count decreased | "NR carriers changed from 3 to 2" |
| Internet lost | "Internet connectivity lost" |

**Downgrade detection logic (backend):** Network mode changes use a `case` match against `"$prev-$current"` pairs: `5G-SA-5G-NSA`, `5G-SA-LTE`, `5G-NSA-LTE` → `warning`. All other transitions → `info`. Carrier count changes compare `new_total` vs `prev_total` — decrease → `warning`, increase → `info`.

---

## 6. Deployment Notes

### Current State (Feb 16, 2026)

- **Home page dashboard is fully complete** — all 10 components wired to live data.
- Static export built with `async rewrites()` block **commented out** in `next.config.ts` (rewrites are server-side only, not compatible with `output: "export"`).
- Init script deployed to `/etc/init.d/qmanager` with proper permissions.
- Scripts deployed to their respective modem paths (see Section 2).
- Poller running, JSON cache updating every ~2 seconds.
- Ping daemon running, latency data updating every ~2 seconds.
- All dashboard components wired: Network Status, LTE/NR Status, Device Info, Device Metrics, Live Latency, Recent Activities, Signal History, Speedtest.

### Development Proxy

During development (`bun dev`), the `next.config.ts` rewrites proxy `/cgi-bin/*` to `http://192.168.224.1/cgi-bin/*`. This must be **uncommented** for local dev and **commented out** for production builds.

```typescript
// next.config.ts — uncomment for dev, comment for build
async rewrites() {
  return [
    {
      source: '/cgi-bin/:path*',
      destination: 'http://192.168.224.1/cgi-bin/:path*',
      basePath: false,
    },
  ];
},
```

### File Permissions on Modem

All shell scripts need executable permission:
```bash
chmod +x /usr/bin/qcmd
chmod +x /usr/bin/qmanager_poller
chmod +x /usr/bin/qmanager_ping
chmod +x /usr/bin/qmanager_logread
chmod +x /usr/lib/qmanager/qlog.sh
chmod +x /etc/init.d/qmanager
chmod +x /www/cgi-bin/quecmanager/at_cmd/fetch_data.sh
chmod +x /www/cgi-bin/quecmanager/at_cmd/send_command.sh
chmod +x /www/cgi-bin/quecmanager/at_cmd/fetch_events.sh
chmod +x /www/cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh
chmod +x /www/cgi-bin/quecmanager/at_cmd/speedtest_check.sh
chmod +x /www/cgi-bin/quecmanager/at_cmd/speedtest_start.sh
chmod +x /www/cgi-bin/quecmanager/at_cmd/speedtest_status.sh
```

### Service Management

```bash
/etc/init.d/qmanager enable    # Enable at boot
/etc/init.d/qmanager start     # Start now
/etc/init.d/qmanager restart   # Restart after updating scripts
/etc/init.d/qmanager stop      # Stop
```

### Verifying the Cache

```bash
cat /tmp/qmanager_status.json   # Should show valid JSON with current data
```

### Verifying Logs

```bash
qmanager_logread --status        # Check log file sizes and distribution
qmanager_logread -n 20           # Last 20 log entries
qmanager_logread -f              # Follow live (Ctrl+C to stop)
```

### Clean Restart (After Major Changes)

```bash
rm -f /var/lock/qmanager.lock /var/lock/qmanager.pid
/etc/init.d/qmanager restart
sleep 3
cat /tmp/qmanager_status.json
```

---

## 7. Platform Quirks & Lessons Learned

Issues encountered during deployment to the actual RM551E-GL hardware and their solutions.

### BusyBox flock Does NOT Support `-w` (Timeout)

**Problem:** The architecture spec uses `flock -w 5` for timed lock waits. BusyBox v1.35.0 on this OpenWRT build only supports `-s` (shared), `-x` (exclusive), `-u` (unlock), `-n` (non-blocking). No `-w` flag.

**Solution:** Manual retry loop using `-n` (non-blocking) with `sleep 1`:
```sh
flock_wait() {
    local fd="$1" wait_secs="$2" elapsed=0
    while [ "$elapsed" -lt "$wait_secs" ]; do
        flock -x -n "$fd" 2>/dev/null && return 0
        sleep 1
        elapsed=$((elapsed + 1))
    done
    flock -x -n "$fd" 2>/dev/null
}
```

### BusyBox `eval "exec 9>file"` Fails Silently on ash

**Problem:** The standard `eval "exec ${LOCK_FD}>\"${LOCK_FILE}\""` pattern for opening a file descriptor fails silently on ash shell (OpenWRT's default). FD 9 is never opened, so all subsequent `flock` calls fail immediately.

**Solution:** Subshell + FD redirect pattern — the shell opens the FD on subshell boundary, and the lock auto-releases on subshell exit:
```sh
result=$(
    (
        flock_wait 9 5 || exit 2
        echo $$ > "$PID_FILE"
        timeout 3 sms_tool at "$COMMAND" 2>/dev/null
    ) 9>"$LOCK_FILE"
)
```

### sms_tool Has No `-d` Device Flag

**Problem:** Architecture spec assumed `sms_tool -d "/dev/ttyUSB2" at "COMMAND"`. The actual binary doesn't accept `-d`.

**Solution:** Correct invocation is simply `sms_tool at 'COMMAND'`. The device is auto-detected.

### sms_tool Echoes the AT Command Back

**Problem:** `sms_tool` output includes the echoed command and a trailing `OK`:
```
AT+COPS?              ← echo
+COPS: 0,0,"SMART",7  ← actual response
OK                     ← trailing
```

Parsers that grep for patterns like `"servingcell"` would match the echo line `AT+QENG="servingcell"` instead of the actual `+QENG:` response, producing garbage data (e.g., `"band": "BAT+QENG=servingcell"`).

**Solution:** Two layers of protection:
1. `qcmd_exec()` strips `^AT` and `^OK$` lines globally before returning
2. Individual parsers filter for their expected prefix (e.g., `grep '^+QENG:'`)

### BusyBox `tr` Does NOT Allow Empty STRING2

**Problem:** `tr '\r' ''` produces `tr: STRING2 cannot be empty` on BusyBox.

**Solution:** Use `tr -d '\r'` (delete mode) instead.

### NOCONN ≠ No Service

**Problem:** Initial implementation mapped AT+QENG state `NOCONN` → `service_status: "no_service"` and `lte_state: "disconnected"` with an early return that skipped signal parsing. This caused the dashboard to show "No Service" even though the modem was registered on LTE with valid signal.

**Root Cause:** `NOCONN` means "registered on network, no active data bearer (PDP context)" — the modem IS camped on a cell with signal values present. It is NOT equivalent to "no service".

**Solution:** `NOCONN` now maps to `service_status: "idle"` internally, `lte_state: "connected"`, and signal values are parsed normally. `determine_service_status()` then upgrades `idle` to `connected`/`optimal` based on actual RSRP. Only `SEARCH` triggers an early return (no signal values available).

### Uptime Display: Minutes, Not Seconds

**Problem:** The 1-second client-side tick (`setInterval` incrementing `displayDevUptime` and `displayConnUptime`) drifted out of sync with the 2-second poll cycle. Device uptime and connection uptime would visually jump backwards when a fresh poll arrived with a lower value than the interpolated one.

**Solution:** Removed seconds from the display entirely. `formatUptime()` now shows `0m` for sub-minute, `Xh Ym` otherwise. Minutes is the smallest unit. This eliminated 6 `useState` calls, 1 `useEffect` with `setInterval`, and the render-time sync logic from `device-metrics.tsx`. Uptime values now update naturally every 2 seconds with the poll cycle.

### Carriage Returns on Last CSV Fields

**Problem:** When parsing comma-separated AT command responses with `cut -d',' -fN`, the **last field** retains a trailing `\r` carriage return from `sms_tool` output. Middle fields are unaffected because the `,` delimiter cleanly separates them. This caused `map_scs_to_khz()` to receive `"1\r"` instead of `"1"`, failing the `case` match and returning empty (→ `null` in JSON).

**Solution:** Always include `tr -d '\r'` in the CSV strip pipeline, especially when extracting the last field. This was already done in some parsers but was missing from the NSA NR line in `parse_serving_cell()`. The SA mode parser was unaffected because SCS is not the last field in SA responses.

**General Rule:** Any `cut`/`awk` extraction of the last field from an AT command response needs `\r` stripping. Prefer stripping early in the pipeline (on the whole CSV line) rather than on individual field extractions.

### uhttpd Kills CGI Process Group on Exit

**Problem:** Spawning a background process from a CGI script with `nohup speedtest &` doesn't work. uhttpd sends SIGTERM to the entire CGI process group when the handler finishes. `nohup` prevents SIGHUP but the process stays in the same group and gets killed by SIGTERM. The speedtest process would die within 200ms of the CGI script exiting, producing "speedtest process exited immediately".

**Solution:** Use `setsid` to create a new session (and thus a new process group) that is fully detached from uhttpd's lifecycle. We write a wrapper script to `/tmp/qmanager_speedtest_run.sh` and launch it via `setsid "$WRAPPER_SCRIPT" >/dev/null 2>&1 &`. The wrapper uses `exec` to replace itself with the speedtest binary, keeping the same PID.

The `>/dev/null 2>&1` on the `setsid` line is critical — without it, the wrapper's inherited stdout is still connected to the CGI's stdout pipe, and any output from `. /etc/profile` or the speedtest binary's startup banner leaks into the HTTP response, corrupting the JSON.

### Ookla speedtest-cli Requires Full Environment

**Problem:** The Ookla speedtest binary (compiled C++) crashes with `terminate called after throwing an instance of 'std::logic_error' — basic_string::_M_construct null not valid` when launched from a CGI environment. uhttpd strips nearly all environment variables, and the binary calls `getenv()` for variables like `HOME`, `USER`, `HOSTNAME` etc., passing the result directly to `std::string` constructors which crash on NULL.

**Solution:** The wrapper script sources `. /etc/profile` before `exec speedtest`, giving the binary the same environment an SSH session would have. A safety net of explicit `export` statements covers any vars the profile might miss. The wrapper is written as a single-quoted heredoc (`<< 'WEOF'`) so `$`, `${HOME:-/root}` etc. are preserved literally and expand when the wrapper runs, not when the CGI generates it. Dynamic values (speedtest binary path) are patched in via `sed` after writing.

### Ookla speedtest-cli Outputs ASCII Art Mixed with JSON

**Problem:** When using `-p yes` (progress output), the Ookla binary may interleave ASCII art progress bars (containing patterns like `:@@@@-`) between JSON lines in its stdout output. The status CGI was using `tail -1` to grab the latest line, which could return an ASCII art line instead of JSON, producing `Unexpected token ':' is not valid JSON` on the frontend.

**Solution:** Replace `tail -1` with `grep '^{' output_file | tail -1` everywhere the output file is read. This filters for lines starting with `{` (valid JSON objects) before taking the last one. Applied to both the "running" progress read and the "complete" result harvest.

### BusyBox Lacks `setsid`

**Problem:** The architecture spec and initial implementations used `setsid` to detach background processes (speedtest wrapper, profile apply, band failover watcher) from uhttpd's process group. BusyBox on this OpenWRT build does not include `setsid` — running it produces `-ash: setsid: not found`.

**Impact:** Without proper detachment, uhttpd kills spawned processes when the CGI handler exits (sends SIGTERM to process group). The failover watcher was silently never running because `lock.sh` used `setsid` and the `-x` permission check also failed (see below).

**Solution:** POSIX subshell double-fork pattern, which works on any shell:
```sh
( "$SCRIPT" ) >/dev/null 2>&1 &
```
The subshell `( )` creates a child process. The `&` backgrounds it. `>/dev/null 2>&1` prevents stdout/stderr from leaking into the CGI HTTP response. The parentheses are sufficient to detach from uhttpd's process group on this platform.

Applied consistently to all three CGI scripts that spawn background processes:
- `bands/lock.sh` — spawns `qmanager_band_failover`
- `at_cmd/speedtest_start.sh` — spawns speedtest wrapper
- `profiles/apply.sh` — spawns `qmanager_profile_apply`

### Missing Execute Permissions After Deploy

**Problem:** Scripts deployed to the modem via `scp` or file copy may lose their execute bit, arriving as `644` instead of `755`. Shell scripts invoked directly (like `qmanager_band_failover`) fail silently when a CGI script checks `[ -x "$SCRIPT" ]` before spawning.

**Detection:** The failover watcher never ran after band locking. Diagnosis:
```bash
ls -la /usr/bin/qmanager_band_failover  # → -rw-r--r-- (no +x)
logread | grep band_failover             # → no output
cat /tmp/qmanager_band_failover.pid     # → empty/missing
```

**Solution:** Added permission auto-fix to `/etc/init.d/qmanager` `start_service()`:
```sh
# Ensure all /usr/bin scripts are executable
for f in /usr/bin/qmanager_*; do
    [ -f "$f" ] && chmod +x "$f"
done

# Ensure all CGI scripts are executable
for f in /www/cgi-bin/quecmanager/*.sh /www/cgi-bin/quecmanager/*/*.sh; do
    [ -f "$f" ] && chmod +x "$f"
done
```
This runs on every service start, ensuring permissions are correct even after a deploy that strips them.

### Exit Code Convention in qcmd

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 1 | Command timeout or modem error |
| 2 | Lock acquisition timeout (modem busy) |

This allows callers to distinguish lock contention from modem failures.

### `$$` in Subshells

`$$` inside command substitution gives the **parent** shell's PID, not the subshell's. This is correct for PID file tracking — the PID file records who holds the lock.

---

## 8. Remaining Work

### Home Page Dashboard — ✅ COMPLETE

All 10 home page components are wired to live data and functional:

1. ~~**Wire `NrStatusComponent`**~~ ✅ Done
2. ~~**Wire `DeviceStatus`**~~ ✅ Done
3. ~~**Wire `DeviceMetricsComponent`**~~ ✅ Done
4. ~~**Wire `SignalHistoryComponent`** — Self-contained with `useSignalHistory()` hook. Backend Tier 1.5 writes per-antenna NDJSON, CGI serves as JSON array, hook picks best antenna per RAT.~~ ✅ Done

### Subsequent Pages

5. **Terminal Page** — Wire to `send_command.sh` CGI endpoint (POST). Block `QSCAN` commands with user-facing message.
6. **Cell Scanner Page** — Dedicated endpoint for `AT+QSCAN` with progress indicator and long-command flag coordination.
7. ~~**Cellular Information Page**~~ ✅ Done — Cellular Information card + Active Bands card. `lib/earfcn.ts` for DL/UL frequency, band name, duplex mode. See `TASKS.md` for full implementation details.
8. ~~**Band Locking**~~ ✅ Done — Full per-category lock/unlock with failover safety, scenario integration. See Section 10.
8b. **APN Management** — Write-path CGI endpoints (currently only read-path exists).

### Connectivity & Watchcat (See: `documentations/CONNECTIVITY_ARCHITECTURE.md`)

9. ~~**Build `qmanager_ping`**~~ ✅ Done — Unified ping daemon. Dual-target ICMP (8.8.8.8 + 1.1.1.1), hysteresis (3 fail / 2 recover), 60-sample ring buffer, atomic JSON writes. BusyBox compatible.
10. ~~**Integrate ping data into poller**~~ ✅ Done — `read_ping_data()` reads `/tmp/qmanager_ping.json`, staleness check (10s threshold), merges `connectivity` section into `qmanager_status.json`.
11. ~~**Wire Internet badge**~~ ✅ Done — Three-state badge in `network-status.tsx`: green (true), red (false), gray (null/unknown). Replaced placeholder `hasInternet = isServiceActive`.
12. ~~**Update init script**~~ ✅ Done — Multi-instance procd: ping (instance 1), poller (instance 2), watchcat placeholder (instance 3, commented out).
13. ~~**Fix connection uptime**~~ ✅ Done — `update_conn_uptime()` now keyed off `conn_internet_available` (ping daemon) instead of `service_status` (modem registration). Three-state: `true` → count, `false` → reset, `null` → hold. Also added to scan path so timer stays accurate during AT+QSCAN.
14. ~~**Build Live Latency component**~~ ✅ Done — Line chart (last 5 history points), stats grid (current/avg/jitter/loss), Online/Offline badge, loading/empty states.
15. **Build `qmanager_watchcat`** — State machine daemon. MONITOR→SUSPECT→RECOVERY→COOLDOWN→LOCKED. Reads ping data, executes tiered recovery (ifup → AT+CFUN → reboot). Token-bucket bootloop protection.
16. **Wire watchcat state to UI** — Optional status indicator showing watchcat state, failure count, last recovery action.
17. **Rename watchcat lock** — `/tmp/qmanager.lock` (from old Watchcat Architecture Guide) → `/tmp/qmanager_watchcat.lock` to prevent collision with serial port lock at `/var/lock/qmanager.lock`.

### Other Backend Improvements

18. **Error recovery testing** — SIM ejection, modem unresponsive, `sms_tool` crash, stale lock scenarios.
19. **Long command support** — Verify `AT+QSCAN` flag-based coordination between poller and Cell Scanner page.
20. **NR MIMO layers** — ✅ Done. MIMO moved from boot-only to Tier 2 polling. Boot-time enable commands (`AT+QNWCFG="lte_mimo_layers",1` and `AT+QNWCFG="nr5g_mimo_layers",1`) activate layer reporting. Tier 2 queries both `AT+QNWCFG="lte_mimo_layers"` and `AT+QNWCFG="nr5g_mimo_layers"` every 15 cycles. Parser combines into `"LTE 1x4 | NR 1x2"` format. NR MIMO gracefully returns empty when no 5G is active. **Bug fix (Feb 16):** Original implementation used wrong NR command name `"nr_mimo_layers"` — corrected to `"nr5g_mimo_layers"` (same `nr5g_` prefix convention as time advance). Fixed in poller (boot enable + boot query + Tier 2 query) and parser (grep + sed patterns).
21. **TA-based cell distance** — ✅ Done. Phase 1 (LTE): `parse_time_advance()` used `rev` (not available on BusyBox). Replaced with `awk -F',' '{print $NF}'`. Phase 2 (NR): wrong AT command name (`nr_time_advance` → `nr5g_time_advance`), wrong grep pattern, wrong field extraction (`$NF` → `$3` due to trailing 4th field in NR response). See Section 9.
22. **NSA SCS parsing** — ✅ Done. `scs` field was `null` in NSA mode because `\r` carriage return on the last CSV field (`cut -d',' -f11` returned `1\r`) caused `map_scs_to_khz()` case match to fail. Fix: added `tr -d '\r'` to the NSA NR CSV strip pipeline in `parse_serving_cell()`.

---

## 9. TA Debugging Notes (Resolved ✅)

Timing Advance (TA) cell distance calculation. Backend polls TA values from the modem, frontend computes distance using 3GPP formulas and displays as "3.28 km (TA 42)".

### Phase 1: LTE TA (Resolved Feb 14)

**Root Cause:** `parse_time_advance()` used `rev | cut -d',' -f1 | rev` to extract the last CSV field. `rev` is not available on BusyBox/OpenWRT. The command failed silently, producing an empty string that was rejected by the numeric validator → `lte_ta=""` → `null` in JSON.

**Fix:** Replaced `rev | cut -d',' -f1 | rev` with `awk -F',' '{print $NF}'` (BusyBox-native). Also removed `else` branches that unnecessarily reset the other technology's TA value when parsing single-technology responses.

**Debugging History:**
1. 4-command chained AT call — NR ERROR killed the whole chain (exit code 2), preventing LTE TA parse.
2. Split into separate LTE/NR calls — LTE succeeded but TA still null.
3. Carriage return hypothesis — added `tr -d '\r'`, didn't fix it.
4. Deployment gap — fix wasn't deployed to modem. Re-deployed, still null.
5. Refactored to enable-at-boot + query-only — cleaner response, still null.
6. Traced pipeline on modem — revealed `rev: not found`. Replaced with `awk`. **Fixed.**

### Phase 2: NR TA (Resolved Feb 16)

Once the modem acquired a 5G-NSA connection, NR TA was confirmed working from manual `qcmd` execution (`+QNWCFG: "nr5g_time_advance",1,4608,0`) but still showed `null` in the JSON cache.

**Root Cause (3 bugs):**
1. **Wrong AT command name** — poller sent `AT+QNWCFG="nr_time_advance"` but the modem expects `"nr5g_time_advance"`. The NR command uses a different naming convention than LTE (`nr5g_` prefix vs plain `nr_`). Both the boot-time enable and Tier 2 query used the wrong name.
2. **Wrong grep pattern** — `parse_time_advance()` searched for `"nr_time_advance"` which never matched the actual `"nr5g_time_advance"` in the response.
3. **Wrong field extraction** — NR response has 4 fields (`"nr5g_time_advance",1,4608,0`) but parser used `awk '{print $NF}'` which grabbed `0` (trailing extra field) instead of `4608` (field 3).

**Fix:**
- Renamed command to `"nr5g_time_advance"` in poller (boot enable + Tier 2 query)
- Updated grep pattern in parser to match `"nr5g_time_advance"`
- Changed field extraction from `{print $NF}` to `{print $3}` for both LTE and NR (safe for LTE: field 3 is also the TA value in its 3-field response)

### Verified

```
# After Phase 1 (LTE only, no 5G active):
root@RM551E-GL:~# cat /tmp/qmanager_status.json | grep '"ta"'
    "ta": 43
    "ta": null

# After Phase 2 (LTE + NR on 5G-NSA):
root@RM551E-GL:~# cat /tmp/qmanager_status.json | grep '"ta"'
    "ta": 43
    "ta": 4608
```

### Lessons Learned

1. Always verify command availability on BusyBox before using in shell scripts. Common missing commands: `rev`, `seq`, `tac`, `readarray`. Safe alternatives: `awk`, `sed`, `cut`, `tr`.
2. Don't assume symmetric naming conventions across AT commands. Always verify the exact command string against actual modem output (`qcmd 'AT+QNWCFG="nr5g_time_advance"'`).
3. When extracting CSV fields, prefer explicit positions (`{print $3}`) over `{print $NF}` (last field) — response formats can have trailing fields you don't expect.

### Files Modified

| File | Changes |
|------|--------|
| `scripts/usr/bin/qmanager_poller` | Added `lte_ta`/`nr_ta` state vars, boot-time TA enable, Tier 2 query-only polling, JSON output fields. Phase 2: corrected NR command name from `nr_time_advance` to `nr5g_time_advance` (boot enable + Tier 2 query). |
| `scripts/usr/lib/qmanager/parse_at.sh` | `parse_time_advance()`: Phase 1 replaced `rev` with `awk`. Phase 2 corrected NR grep pattern to `nr5g_time_advance`, changed field extraction from `{print $NF}` to `{print $3}`. |
| `types/modem-status.ts` | Added `ta: number \| null` to `LteStatus` and `NrStatus`, `calculateLteDistance()`, `calculateNrDistance()`, `formatDistance()` |
| `components/dashboard/device-metrics.tsx` | Added "LTE Cell Distance" and "NR Cell Distance" rows, accepts `lteData`/`nrData` props |
| `components/dashboard/home-component.tsx` | Passes `lteData={data?.lte}` and `nrData={data?.nr}` to DeviceMetricsComponent |

---

## 10. Connectivity Architecture Reference

The full architecture for internet status, live latency, and watchcat integration is documented in:

**`documentations/CONNECTIVITY_ARCHITECTURE.md`**

Key design decisions summarized here for quick reference:

- **Unified Ping Daemon (`qmanager_ping`)** — Single daemon pings, everyone else reads. No consumer pings on its own. Writes `/tmp/qmanager_ping.json`.
- **Watchcat reads, doesn't ping** — Pure state machine. Reads ping data, makes decisions, executes recovery via `qcmd` (Tier 2 only). Writes `/tmp/qmanager_watchcat.json`.
- **Merge at the poller** — Poller reads both ping and watchcat JSON files, merges `connectivity` and `watchcat` sections into main `status.json`. Frontend fetches one file.
- **Lock file disambiguation** — Serial port: `/var/lock/qmanager.lock` (flock). Watchcat maintenance: `/tmp/qmanager_watchcat.lock` (presence flag). Recovery active: `/tmp/qmanager_recovery_active` (presence flag). Long scan: `/tmp/qmanager_long_running` (presence flag).
- **Independent failure domains** — Ping daemon crash doesn't affect modem data. Poller crash doesn't affect ping data. Watchcat crash doesn't affect dashboard. procd respawns each independently.

### RAM Files Registry

| File | Writer | Readers | Purpose |
|------|--------|---------|--------|
| `/tmp/qmanager_status.json` | Poller | Frontend (via CGI) | Main dashboard data (modem + connectivity + watchcat merged) |
| `/tmp/qmanager_ping.json` | Ping daemon | Poller, Watchcat | Raw ping results (RTT, reachable, streaks, history) |
| `/tmp/qmanager_watchcat.json` | Watchcat | Poller | Watchcat state (current state, failure count, tier, cooldown) |
| `/tmp/qmanager_ping_history` | Ping daemon | Ping daemon (self) | Flat-file ring buffer of RTT values (one per line) |
| `/tmp/qmanager_signal_history.json` | Poller (Tier 1.5) | Signal History CGI (fetch_signal_history.sh) | NDJSON ring buffer of per-antenna signal data (RSRP/RSRQ/SINR × LTE+NR). Max 180 entries (~30 min at 10s intervals). |
| `/tmp/qmanager_events.json` | Poller (detect_events) | Events CGI (fetch_events.sh) | NDJSON ring buffer of network events (band changes, handoffs, CA, connectivity). Max 50 entries. |
| `/tmp/qmanager.log` | All daemons | `qmanager_logread` | Centralized log file |
| `/tmp/qmanager_speedtest.pid` | speedtest_start.sh (wrapper) | speedtest_start.sh, speedtest_status.sh | Singleton enforcement + process tracking |
| `/tmp/qmanager_speedtest_output` | speedtest process | speedtest_status.sh | NDJSON progress lines (deleted on completion) |
| `/tmp/qmanager_speedtest_result.json` | speedtest_status.sh | speedtest_status.sh, frontend | Cached final result (survives navigation, cleared on next test start) |
| `/tmp/qmanager_speedtest_error` | speedtest process | speedtest_start.sh, speedtest_status.sh | stderr capture for diagnostics |
| `/tmp/qmanager_speedtest_run.sh` | speedtest_start.sh | setsid (executed) | Generated wrapper script (sources /etc/profile, exec speedtest) |
| `/tmp/qmanager_speedtest_env` | wrapper script | Debug only | Environment dump (remove once stable) |
| `/tmp/qmanager_band_failover` | `qmanager_band_failover` | `failover_status.sh`, `use-band-locking.ts` | Flag: failover watcher activated (bands were reset to defaults) |
| `/tmp/qmanager_band_failover.pid` | `qmanager_band_failover` | `failover_status.sh`, `lock.sh` | Watcher PID file (singleton enforcement + running detection) |

### Flag Files Registry

| File | Setter | Checkers | Meaning |
|------|--------|----------|---------|
| `/var/lock/qmanager.lock` | `qcmd` (flock) | `qcmd` (flock) | Serial port mutex |
| `/var/lock/qmanager.pid` | `qcmd` | `qcmd` | Stale lock detection PID |
| `/tmp/qmanager_long_running` | `qcmd` | Poller, Watchcat | Long AT command active (QSCAN) |
| `/tmp/qmanager_watchcat.lock` | NetModing scripts | Watchcat | Maintenance mode (band switching) |
| `/tmp/qmanager_recovery_active` | Watchcat | Ping daemon, Poller | Recovery action in progress |
| `/etc/qmanager/band_failover_enabled` | `failover_toggle.sh` | `lock.sh`, `current.sh`, `failover_status.sh` | Persistent: band failover safety mechanism enabled |

---

## 11. Speedtest Architecture Reference

On-demand network speed test using Ookla speedtest-cli. Operates entirely at the IP layer — **does not touch the modem serial port**, does not interact with `qcmd`, the long-command flag system, or any modem locks.

### Design Decisions

- **No modem interaction:** Speedtest uses the network stack directly. No `qcmd` wrapper, no flock, no impact on poller/terminal/watchdog.
- **Singleton enforcement:** Only one speedtest can run at a time. PID file (`/tmp/qmanager_speedtest.pid`) tracks the active process. Second attempts get `already_running` and follow along via polling.
- **Result persistence:** Cached in `/tmp/qmanager_speedtest_result.json` — survives page navigation (user can close dialog, reopen, see result). Cleared when a new test starts. Does NOT survive reboot (RAM disk).
- **250ms progress interval:** `--progress-update-interval=250` balances smooth UI animation vs disk I/O. Frontend polls every 500ms.
- **Dialog blocks close while running:** Prevents user from accidentally abandoning a running test.

### CGI Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `speedtest_check.sh` | GET | Returns `{"available": true/false}` based on whether `speedtest` binary exists |
| `speedtest_start.sh` | POST | Spawns detached speedtest process via setsid + wrapper script. Returns PID or error. |
| `speedtest_status.sh` | GET | Returns current state: idle, running (with progress), complete (with result), or error |

### Process Lifecycle

```
speedtest_start.sh (CGI)
  │
  ├─ Writes wrapper script to /tmp/qmanager_speedtest_run.sh
  │     - Sources /etc/profile (full environment for C++ binary)
  │     - Writes $ to PID file
  │     - exec speedtest (replaces shell, keeps PID)
  │
  ├─ setsid wrapper.sh >/dev/null 2>&1 &
  │     (new session, detached from uhttpd process group)
  │
  ├─ sleep 0.8 (wait for wrapper to write PID)
  │
  └─ Check PID file + kill -0 → return success/failure JSON

speedtest_status.sh (polled every 500ms by frontend)
  │
  ├─ PID file exists + process alive → "running" + last JSON line
  ├─ PID file exists + process dead → harvest result → "complete"
  ├─ No PID + cached result exists  → "complete" (from previous run)
  └─ No PID + no cache             → "idle"
```

### Bandwidth Values

Ookla speedtest-cli reports bandwidth in **bytes per second**. Conversion: `Mbps = bandwidth × 8 / 1,000,000`.

Example from actual hardware: `bandwidth: 60677864` B/s = 485.4 Mbps download.

### Known Behaviors During Test

- Ping daemon latency readings spike (network saturated) — this is accurate, not a bug
- Traffic counters in `/proc/net/dev` show speedtest traffic as real usage
- CPU usage spikes visible in poller's `/proc/stat` readings
- No pause/yield for ping daemon during test (maintains continuous connectivity monitoring)

---

## 10. Band Locking Architecture Reference

Per-category band lock management for LTE, NSA NR5G, and SA NR5G with a failover safety mechanism that auto-resets bands if signal is lost after locking.

### Design Decisions

- **Per-category independence:** Each band type (LTE, NSA NR5G, SA NR5G) is locked/unlocked via separate `AT+QNWPREFCFG` calls. No batching — follows "sip, don't gulp" pattern.
- **Failover safety:** Optional one-shot watcher spawned after each lock. Sleeps 15s, checks `AT+QCAINFO` for signal, resets bands to `policy_band` defaults if no carrier data found.
- **AT+QCAINFO for signal check:** Lightweight (~200ms), real-time. If response contains no `+QCAINFO:` lines, modem has no signal. Preferred over reading `status.json` which may be stale by up to 10s.
- **Supported bands from cache:** Failover watcher reads `policy_band` values from `status.json` (collected at boot) to avoid modem lock contention during failover reset.
- **Connection Scenarios override:** Frontend-only gating. When non-Balanced scenario active, all band locking controls disabled. No backend cross-dependencies.

### AT Commands Used

| Command | Purpose | Response Format |
|---------|---------|----------------|
| `AT+QNWPREFCFG="ue_capability_band"` | Read currently configured bands | `+QNWPREFCFG: "lte_band",1:3:7:28\n+QNWPREFCFG: "nsa_nr5g_band",41:78\n...` |
| `AT+QNWPREFCFG="lte_band",1:3:7` | Lock LTE to specific bands | `OK` |
| `AT+QNWPREFCFG="nsa_nr5g_band",41:78` | Lock NSA NR to specific bands | `OK` |
| `AT+QNWPREFCFG="nr5g_band",41:78` | Lock SA NR to specific bands | `OK` |
| `AT+QNWPREFCFG="policy_band"` | Read all hardware-supported bands (ceiling) | Same format as `ue_capability_band` |
| `AT+QCAINFO` | Check active carriers (failover signal check) | `+QCAINFO: "PCC",...` lines if signal, empty if no signal |

**Band format:** Colon-delimited band numbers. Same format stored in JSON, sent to modem — zero conversion. "Unlock all" = set to full `policy_band` list.

### Failover Watcher Lifecycle

```
User locks bands → lock.sh checks failover enabled
  │
  ├─ Failover disabled → return success, no watcher
  │
  └─ Failover enabled → spawn ( qmanager_band_failover ) &
       │
       ├─ Write PID to /tmp/qmanager_band_failover.pid
       ├─ Sleep 15 seconds (let modem settle on new bands)
       ├─ qcmd 'AT+QCAINFO' → check for +QCAINFO: lines
       │
       ├─ Has +QCAINFO: → signal OK → clean exit (remove PID file)
       │
       └─ No +QCAINFO: → no signal → failover!
            ├─ Read supported bands from status.json cache
            ├─ Reset each band type to full policy_band list via qcmd
            ├─ Write /tmp/qmanager_band_failover flag (activated)
            └─ Clean exit (remove PID file)
```

### Frontend Failover Polling

```
Lock success (failover_armed: true) → clear activated flag → start polling
  │
  ├─ Poll failover_status.sh every 3s
  │   Returns: { enabled: bool, activated: bool, watcher_running: bool }
  │
  ├─ While watcher_running: true → keep polling
  │
  └─ watcher_running: false → stop polling
       ├─ activated: true → UI shows "Using Default Bands" badge
       │   → re-fetch current.sh to get reset band values
       └─ activated: false → signal was fine, no UI change
```

### CGI Endpoints

| Endpoint | Method | Purpose | Modem? |
|----------|--------|---------|--------|
| `bands/current.sh` | GET | Current locked bands + supported bands + failover state | Yes (1 AT call) |
| `bands/lock.sh` | POST | Lock one band category, spawn failover watcher | Yes (1 AT call) |
| `bands/failover_toggle.sh` | POST | Enable/disable failover (persistent to flash) | No |
| `bands/failover_status.sh` | GET | Failover flags + watcher PID check | No (3 file reads) |

### Files Modified/Created

| File | Action | Purpose |
|------|--------|--------|
| `scripts/cgi/quecmanager/bands/current.sh` | Created | Read locked bands + failover state |
| `scripts/cgi/quecmanager/bands/lock.sh` | Created | Lock bands + spawn watcher |
| `scripts/cgi/quecmanager/bands/failover_toggle.sh` | Created | Persistent failover enable/disable |
| `scripts/cgi/quecmanager/bands/failover_status.sh` | Created | Lightweight flag polling endpoint |
| `scripts/usr/bin/qmanager_band_failover` | Created | One-shot failover watcher |
| `scripts/etc/init.d/qmanager` | Modified | Added `chmod +x` auto-fix for all scripts at startup |
| `scripts/cgi/quecmanager/at_cmd/speedtest_start.sh` | Modified | Replaced `setsid` with `( cmd ) &` |
| `scripts/cgi/quecmanager/profiles/apply.sh` | Modified | Replaced `setsid` with `( cmd ) &` |
| `types/band-locking.ts` | Created | TypeScript interfaces + parse/format utilities |
| `hooks/use-band-locking.ts` | Created | CRUD + failover lifecycle hook |
| `components/cellular/band-locking.tsx` | Modified | Added scenario override (useConnectionScenarios, Alert banner, disabled prop) |
| `components/cellular/band-cards.tsx` | Modified | Added disabled prop, "Scenario Controlled" badge, opacity dimming |
| `components/cellular/band-settings.tsx` | Modified | Added isScenarioControlled prop, disabled failover toggle |

---

## 11. Tower Locking — jq Boolean Handling Bug Fix

**Date:** February 19, 2026

### Problem

Tower locking status badges ("Failover Status" and "Schedule Locking Status") permanently displayed "Unknown" on the Settings card. The failover toggle was also stuck enabled — disabling it appeared to work but reverted on page reload.

### Root Cause: jq `// empty` Swallows Boolean `false`

jq's alternative operator (`//`) treats **both** `null` and `false` as falsy. This means:

```sh
# User sends: {"persist": false}
echo '{"persist": false}' | jq -r '.persist // empty'
# Output: (nothing) — false is treated as falsy, falls through to "empty"
```

Every CGI endpoint that parsed boolean fields from POST bodies used this pattern. The result: **boolean `false` could never be written to the config file**. Settings like persist, failover enabled, and schedule enabled could be turned ON but never OFF.

This caused a cascade:
1. `settings.sh` couldn't write `failover.enabled = false` → config always had `true`
2. `status.sh` read the stale `true` from config → frontend received incorrect state
3. Frontend badges showed "Unknown" because the state never matched expected values

### Fix Applied

Replaced all `// empty` patterns on boolean fields with `has()` + `tostring`:

```sh
# Before (BROKEN for false):
PERSIST=$(printf '%s' "$POST_DATA" | jq -r '.persist // empty')

# After (correct):
PERSIST=$(printf '%s' "$POST_DATA" | jq -r 'if has("persist") then (.persist | tostring) else "unset" end')
```

The sentinel `"unset"` distinguishes "field not in POST body" (use current value) from `"false"` (explicitly set to false). Downstream `--argjson` in response construction correctly converts the string `"false"` back to JSON boolean `false`.

Also replaced `// false` read patterns (which worked by coincidence) with direct field access for consistency:

```sh
# Before (fragile — false // false always returns alternative):
fo_val=$(jq -r '.failover.enabled // false' "$config")

# After (direct, predictable):
fo_val=$(jq -r '.failover.enabled' "$config")
```

### Files Modified

| File | Change | Severity |
|------|--------|----------|
| `scripts/cgi/quecmanager/tower/settings.sh` | `// empty` → `has()` + `tostring` for persist, failover_enabled, failover_threshold | Critical |
| `scripts/cgi/quecmanager/tower/schedule.sh` | `// empty` → `has()` + `tostring` for enabled | Moderate |
| `scripts/cgi/quecmanager/tower/status.sh` | `// false` → direct `.failover.enabled` access | Low (consistency) |
| `scripts/cgi/quecmanager/tower/failover_status.sh` | `// false` → direct `.failover.enabled` access | Low (consistency) |
| `components/cellular/tower-locking/tower-locking.tsx` | Silent `if (config)` guards → early-return with toast error | Low (UX polish) |

### Lesson Learned

**Never use jq's `//` (alternative) operator when the value can legitimately be `false`.** The operator is designed for null-coalescing, but it treats `false` identically to `null`. This is a jq design choice documented in the jq manual but easy to miss. The `has()` + `tostring` pattern is the safe approach for any field that carries boolean semantics.

Affected pattern summary for future reference:

| Pattern | Safe for strings? | Safe for booleans? | Safe for numbers? |
|---------|-------------------|--------------------|-----------|
| `.field // empty` | ✅ | ❌ `false` produces empty | ❌ `0` produces empty |
| `.field // "default"` | ✅ | ❌ `false` hits default | ❌ `0` hits default |
| `if has("field") then (.field \| tostring) else "unset" end` | ✅ | ✅ | ✅ |

---

*End of Development Log*
