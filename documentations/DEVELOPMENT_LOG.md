# QManager Backend Development Log

**Project:** QManager — Custom GUI for Quectel RM551E-GL 5G Modem  
**Platform:** OpenWRT (Embedded Linux)  
**Last Updated:** February 15, 2026 (Phase 1–2 connectivity, connection uptime fix)

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Files Created & Deployment Map](#2-files-created--deployment-map)
3. [AT Command Reference (Verified)](#3-at-command-reference-verified)
4. [JSON Data Contract](#4-json-data-contract)
5. [Component Wiring Progress](#5-component-wiring-progress)
6. [Deployment Notes](#6-deployment-notes)
7. [Platform Quirks & Lessons Learned](#7-platform-quirks--lessons-learned)
8. [Remaining Work](#8-remaining-work)
9. [TA Debugging Notes (Resolved)](#9-ta-debugging-notes-resolved-)
10. [Connectivity Architecture Reference](#10-connectivity-architecture-reference)

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
| `components/dashboard/home-component.tsx` | **Wired** — `"use client"`, calls `useModemStatus()`, passes data + `modemReachable` down to child components |
| `components/dashboard/network-status.tsx` | **Wired** — Accepts `data`, `modemReachable`, `isLoading`, `isStale` props, renders dynamic network status |

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

#### `AT+QNWCFG="lte_time_advance"` / `"nr_time_advance"`

**Architecture:** TA reporting is enabled once at boot via `AT+QNWCFG="lte_time_advance",1` and `AT+QNWCFG="nr_time_advance",1` (in `collect_boot_data()`). Tier 2 polling uses query-only commands:
- `AT+QNWCFG="lte_time_advance"` — returns current LTE TA value
- `AT+QNWCFG="nr_time_advance"` — returns current NR TA value (ERROR when no 5G active)

Both are separate AT calls (not chained) so an NR ERROR doesn't kill the LTE result.

```
+QNWCFG: "lte_time_advance",1,42    ← 3 fields: feature_name, enabled, TA_value
```
**Parsing:** Select lines with 3+ comma-separated fields (`awk -F',' 'NF>=3'`). Extract the last field as the TA value. Strip `\r` carriage returns (sms_tool artifact).

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

#### `AT+QNWCFG="lte_mimo_layers"`
```
+QNWCFG: "lte_mimo_layers",1,4
```
Fields: `<ulmimo>,<dlmimo>`. Stored as `"LTE 1x4"`.

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
| **Live Latency** | `live-latency.tsx` | ❌ Pending | `data.connectivity` — latency_ms, latency_history, jitter, packet_loss (from unified ping daemon via poller merge) |
| **Recent Activities** | `recent-activities.tsx` | ❌ Hardcoded | Separate implementation (event log) |
| **Signal History** | `signal-history.tsx` | ❌ Mock data | `data.lte.rsrp/sinr` + `data.nr.rsrp/sinr` (accumulated client-side) |

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

---

## 6. Deployment Notes

### Current State (Feb 15, 2026)

- Static export built with `async rewrites()` block **commented out** in `next.config.ts` (rewrites are server-side only, not compatible with `output: "export"`).
- Init script deployed to `/etc/init.d/qmanager` with proper permissions.
- Scripts deployed to their respective modem paths (see Section 2).
- Poller running, JSON cache updating every ~2 seconds.
- Network Status and LTE Status components wired and displaying live data.

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

### Immediate Next Steps (Home Page)

1. ~~**Wire `NrStatusComponent`** — Accept `data.nr` props, same pattern as LTE status.~~ ✅ Done
2. ~~**Wire `DeviceStatus`** — Accept `data.device` props for firmware, IMEI, IMSI, ICCID, phone, LTE category, MIMO, build date, manufacturer.~~ ✅ Done
3. ~~**Wire `DeviceMetricsComponent`** — Accept `data.device` (temperature, CPU, memory, uptime) and `data.traffic` (live traffic, data usage). Implement warning badges for high temp/CPU.~~ ✅ Done
4. **Wire `SignalHistoryComponent`** — Replace mock data generator with real-time accumulation of `data.lte.rsrp/sinr` and `data.nr.rsrp/sinr` values using a client-side ring buffer.

### Subsequent Pages

5. **Terminal Page** — Wire to `send_command.sh` CGI endpoint (POST). Block `QSCAN` commands with user-facing message.
6. **Cell Scanner Page** — Dedicated endpoint for `AT+QSCAN` with progress indicator and long-command flag coordination.
7. **Cellular Information Page** — Detailed CA info, neighbor cells, band configuration.
8. **Band Locking / APN Management** — Write-path CGI endpoints (currently only read-path exists).

### Connectivity & Watchcat (See: `documentations/CONNECTIVITY_ARCHITECTURE.md`)

9. ~~**Build `qmanager_ping`**~~ ✅ Done — Unified ping daemon. Dual-target ICMP (8.8.8.8 + 1.1.1.1), hysteresis (3 fail / 2 recover), 60-sample ring buffer, atomic JSON writes. BusyBox compatible.
10. ~~**Integrate ping data into poller**~~ ✅ Done — `read_ping_data()` reads `/tmp/qmanager_ping.json`, staleness check (10s threshold), merges `connectivity` section into `qmanager_status.json`.
11. ~~**Wire Internet badge**~~ ✅ Done — Three-state badge in `network-status.tsx`: green (true), red (false), gray (null/unknown). Replaced placeholder `hasInternet = isServiceActive`.
12. ~~**Update init script**~~ ✅ Done — Multi-instance procd: ping (instance 1), poller (instance 2), watchcat placeholder (instance 3, commented out).
13. ~~**Fix connection uptime**~~ ✅ Done — `update_conn_uptime()` now keyed off `conn_internet_available` (ping daemon) instead of `service_status` (modem registration). Three-state: `true` → count, `false` → reset, `null` → hold. Also added to scan path so timer stays accurate during AT+QSCAN.
14. **Build Live Latency component** — Renders `connectivity.latency_ms` (big number), `connectivity.latency_history` (sparkline), secondary stats.
15. **Build `qmanager_watchcat`** — State machine daemon. MONITOR→SUSPECT→RECOVERY→COOLDOWN→LOCKED. Reads ping data, executes tiered recovery (ifup → AT+CFUN → reboot). Token-bucket bootloop protection.
16. **Wire watchcat state to UI** — Optional status indicator showing watchcat state, failure count, last recovery action.
17. **Rename watchcat lock** — `/tmp/qmanager.lock` (from old Watchcat Architecture Guide) → `/tmp/qmanager_watchcat.lock` to prevent collision with serial port lock at `/var/lock/qmanager.lock`.

### Other Backend Improvements

18. **Error recovery testing** — SIM ejection, modem unresponsive, `sms_tool` crash, stale lock scenarios.
19. **Long command support** — Verify `AT+QSCAN` flag-based coordination between poller and Cell Scanner page.
20. **NR MIMO layers** — Currently only LTE MIMO is fetched. May need a separate command for NR MIMO (investigate `AT+QNWCFG="nr_mimo_layers"` or similar).
21. **TA-based cell distance** — ✅ Done. Root cause: `parse_time_advance()` used `rev` (not available on BusyBox) to extract the last CSV field. Replaced with `awk -F',' '{print $NF}'`. Also removed `else` branches that were resetting the other technology's TA when calling with single-technology data.

---

## 9. TA Debugging Notes (Resolved ✅)

Timing Advance (TA) cell distance calculation. Backend polls TA values from the modem, frontend computes distance using 3GPP formulas and displays as "3.28 km (TA 42)".

### Root Cause

`parse_time_advance()` used `rev | cut -d',' -f1 | rev` to extract the last CSV field. `rev` is not available on BusyBox/OpenWRT. The command failed silently, producing an empty string that was rejected by the numeric validator → `lte_ta=""` → `null` in JSON.

### Fix

Replaced `rev | cut -d',' -f1 | rev` with `awk -F',' '{print $NF}'` (BusyBox-native). Also removed `else` branches that unnecessarily reset the other technology's TA value when parsing single-technology responses.

### Debugging History

1. 4-command chained AT call — NR ERROR killed the whole chain (exit code 2), preventing LTE TA parse.
2. Split into separate LTE/NR calls — LTE succeeded but TA still null.
3. Carriage return hypothesis — added `tr -d '\r'`, didn't fix it.
4. Deployment gap — fix wasn't deployed to modem. Re-deployed, still null.
5. Refactored to enable-at-boot + query-only — cleaner response, still null.
6. Traced pipeline on modem — revealed `rev: not found`. Replaced with `awk`. **Fixed.**

### Verified

```
root@RM551E-GL:~# cat /tmp/qmanager_status.json | grep '"ta"'
    "ta": 43
    "ta": null
```

LTE TA=43 correctly parsed. NR TA=null as expected (no active 5G).

### Lesson Learned

Always verify command availability on BusyBox before using in shell scripts. Common missing commands: `rev`, `seq`, `tac`, `readarray`. Safe alternatives: `awk`, `sed`, `cut`, `tr`.

### Files Modified

| File | Changes |
|------|--------|
| `scripts/usr/bin/qmanager_poller` | Added `lte_ta`/`nr_ta` state vars, `parse_time_advance()` function, boot-time TA enable, Tier 2 query-only polling, JSON output fields |
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
| `/tmp/qmanager.log` | All daemons | `qmanager_logread` | Centralized log file |

### Flag Files Registry

| File | Setter | Checkers | Meaning |
|------|--------|----------|---------|
| `/var/lock/qmanager.lock` | `qcmd` (flock) | `qcmd` (flock) | Serial port mutex |
| `/var/lock/qmanager.pid` | `qcmd` | `qcmd` | Stale lock detection PID |
| `/tmp/qmanager_long_running` | `qcmd` | Poller, Watchcat | Long AT command active (QSCAN) |
| `/tmp/qmanager_watchcat.lock` | NetModing scripts | Watchcat | Maintenance mode (band switching) |
| `/tmp/qmanager_recovery_active` | Watchcat | Ping daemon, Poller | Recovery action in progress |

---

*End of Development Log*
