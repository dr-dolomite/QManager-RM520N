# QManager Architecture

This document describes the overall system architecture, data flow patterns, and key design decisions in QManager.

---

## System Overview

QManager is a two-tier application:

1. **Frontend** — A statically-exported Next.js app served by the OpenWRT device's web server (uhttpd). It runs entirely in the browser.
2. **Backend** — POSIX shell scripts running on the OpenWRT device: CGI endpoints for API requests, long-running daemons for data collection, and init.d services for process management.

```
┌──────────────────────────────────────────────────────────┐
│                      Browser (Client)                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            Next.js Static App (React 19)            │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │ │
│  │  │Dashboard│ │ Cellular │ │ Network  │ │Monitor │ │ │
│  │  │ Cards   │ │ Settings │ │ Settings │ │& Alerts│ │ │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │ │
│  │       └──────┬─────┴────────────┴───────────┘      │ │
│  │              │  authFetch() — cookies auto-sent     │ │
│  └──────────────┼──────────────────────────────────────┘ │
└─────────────────┼────────────────────────────────────────┘
                  │ HTTP GET/POST
                  ▼
┌──────────────────────────────────────────────────────────┐
│                 OpenWRT Device (Server)                    │
│  ┌──────────────────────────────────────────────────────┐│
│  │  uhttpd → /www/cgi-bin/quecmanager/*.sh (CGI)       ││
│  │  ┌──────────────────────────────────────────────┐   ││
│  │  │ cgi_base.sh (auth + headers + JSON helpers)  │   ││
│  │  └──────────────────────────────────────────────┘   ││
│  │       │ reads cache      │ executes AT               ││
│  │       ▼                  ▼                            ││
│  │  /tmp/qmanager_    qcmd AT+...  → /dev/smd7          ││
│  │  status.json              (modem serial port)         ││
│  │       ▲                                               ││
│  │       │ writes every 2s                               ││
│  │  ┌──────────────────────────────────────────────┐   ││
│  │  │     qmanager_poller (main data collector)     │   ││
│  │  │     + qmanager_ping  + qmanager_watchcat      │   ││
│  │  └──────────────────────────────────────────────┘   ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Polling Architecture (Backend)

The backend uses a tiered polling system to balance data freshness against modem serial port contention:

| Tier | Interval | Data Collected | Source |
|------|----------|---------------|--------|
| **Tier 1 (Hot)** | 2s | Serving cell (RSRP/RSRQ/SINR/RSSI), traffic stats, uptime | `AT+QENG="servingcell"`, `/proc/net/dev` |
| **Tier 1.5 (Signal)** | 10s | Per-antenna signal, signal history, ping history | `AT+QRSRP`, `AT+QRSRQ`, `AT+QSINR` |
| **Tier 2 (Warm)** | 30s | Temperature, carrier, SIM slot, CA info, MIMO, APN | `AT+QTEMP`, `AT+COPS`, `AT+QCAINFO` |
| **Boot (Once)** | Startup | Firmware, IMEI, IMSI, ICCID, capabilities, supported bands | `AT+CGMM`, `AT+CGSN`, etc. |

All tiers write to a single cache file: `/tmp/qmanager_status.json`

### Frontend Polling

The frontend polls the CGI layer (which reads the cache file) at intervals matching the tier system:

```
useModemStatus()  ──── GET /at_cmd/fetch_data.sh ──── reads /tmp/qmanager_status.json
  (every 2s)

useSignalHistory() ── GET /at_cmd/fetch_signal_history.sh ── reads NDJSON file
  (every 10s)

useLatencyHistory() ─ GET /at_cmd/fetch_ping_history.sh ── reads NDJSON file
  (every 30s)
```

### Write Operations

User configuration changes follow a synchronous request/response pattern:

```
User Action → React Component → authFetch() POST → CGI Script
                                                      │
                                              ┌───────┴───────┐
                                              │ Parse POST    │
                                              │ Execute AT cmd│
                                              │ Return JSON   │
                                              └───────────────┘
```

Some operations are asynchronous (profile apply, cell scan):
```
POST /profiles/apply.sh → spawns qmanager_profile_apply daemon
                           ↓
Frontend polls GET /profiles/apply_status.sh every 2s
                           ↓
Daemon writes progress to /tmp/qmanager_profile_state.json
```

---

## Authentication

QManager uses cookie-based session authentication:

| Cookie | Type | Purpose |
|--------|------|---------|
| `qm_session` | HttpOnly, SameSite=Strict | Session token (validated server-side) |
| `qm_logged_in` | JS-readable, SameSite=Strict | Client-side login indicator |

### Flow

1. **First-time setup**: `GET /auth/check.sh` returns `setup_required: true` → user creates password
2. **Login**: `POST /auth/login.sh` → validates password → creates session file in `/tmp/qmanager_sessions/` → sets cookies
3. **Authenticated requests**: Browser auto-sends `qm_session` cookie → `cgi_base.sh` calls `require_auth` → validates session
4. **401 handling**: `authFetch()` catches 401 → clears `qm_logged_in` → redirects to `/login`
5. **Session expiry**: 1 hour; one file per session (no race conditions)

Auth endpoints use `_SKIP_AUTH=1` to bypass the automatic auth check in `cgi_base.sh`.

---

## State Management Patterns

### Frontend Hook Categories

| Pattern | Examples | Behavior |
|---------|----------|----------|
| **Polling Hooks** | `useModemStatus`, `useSignalHistory`, `useLatencyHistory` | Auto-fetch at interval, staleness detection, manual refresh |
| **One-Shot Hooks** | `useCellularSettings`, `useAPNSettings`, `useMBNSettings` | Fetch on mount, local cache, explicit `saveSettings()` |
| **Form Hooks** | `useLogin`, `useAuth` | Cookie check, submit actions, rate limit handling |
| **Async Process Hooks** | `useProfileApply`, `useCellScanner`, `useSpeedtest` | Start operation → poll status → completion/error |

### Backend State Files

| File | Owner | Format | Purpose |
|------|-------|--------|---------|
| `/tmp/qmanager_status.json` | poller | JSON | Main modem status cache |
| `/tmp/qmanager_signal_history.json` | poller | NDJSON | 30-min signal history (10s samples) |
| `/tmp/qmanager_ping_history.json` | poller | NDJSON | 24h ping history (10s samples, max 8640 lines) |
| `/tmp/qmanager_events.json` | poller | NDJSON | Network events (max 50 entries) |
| `/tmp/qmanager_ping.json` | ping daemon | JSON | Current ping result |
| `/tmp/qmanager_watchcat.json` | watchcat | JSON | Watchdog state machine |
| `/tmp/qmanager_profile_state.json` | profile_apply | JSON | Profile apply progress |
| `/tmp/qmanager_pci_state.json` | poller (events) | JSON | SCC PCI tracking |
| `/tmp/qmanager_email_log.json` | poller (email) | NDJSON | Email alert log (max 100) |
| `/tmp/qmanager_low_power_active` | low_power | Timestamp | Low power mode flag (suppresses events + alerts) |
| `/tmp/qmanager_watchcat.lock` | low_power | Empty | Watchdog pause lock (forces LOCKED state) |
| `/etc/qmanager/` | CGI scripts | Various | Persistent configuration |

---

## Daemon Architecture

### Process Hierarchy

```
init.d/qmanager (procd)
  └── qmanager_poller (main loop, runs forever)
       ├── sources: events.sh, email_alerts.sh, parse_at.sh
       └── reads: qmanager_ping.json, qmanager_watchcat.json

init.d/qmanager (procd)
  └── qmanager_ping (ping daemon, runs forever)

init.d/qmanager_eth_link (non-procd, one-shot)
  └── applies persisted ethernet link speed on boot

init.d/qmanager_ttl (non-procd, one-shot)
  └── applies persisted TTL/HL rules on boot

init.d/qmanager_mtu (non-procd)
  └── qmanager_mtu_apply (waits for rmnet_data0, then applies MTU)

init.d/qmanager_imei_check (non-procd, one-shot)
  └── qmanager_imei_check (boot-time IMEI rejection check)

init.d/qmanager_wan_guard (non-procd, one-shot)
  └── qmanager_wan_guard (disables orphaned WAN profiles)

init.d/qmanager_tower_failover (non-procd)
  └── qmanager_tower_failover (tower failover watchdog)

init.d/qmanager_low_power_check (non-procd, one-shot)
  └── qmanager_low_power_check (boot-time low power window check)

cron (managed by system/settings.sh CGI)
  ├── qmanager_scheduled_reboot (reboot at configured time)
  └── qmanager_low_power enter|exit (CFUN=0/1 at configured times)
```

### Daemon Communication

Daemons communicate through shared files in `/tmp/`:

- **Poller reads** ping daemon output (`qmanager_ping.json`) and watchcat state (`qmanager_watchcat.json`)
- **CGI scripts read** the poller's cache (`qmanager_status.json`) for GET requests
- **CGI scripts write** config files, then touch trigger files (e.g., `/tmp/qmanager_email_reload`) to signal daemons to reload
- **No IPC sockets or signals** — pure file-based communication

---

## Event System

The poller's `events.sh` library detects state changes and emits events to an NDJSON file:

| Event Type | Trigger | Severity |
|-----------|---------|----------|
| `network_mode` | LTE ↔ 5G-NSA ↔ 5G-SA switch | info/warning |
| `band_change` | LTE or NR band changed | info |
| `pci_change` | PCC cell handoff | info |
| `scc_pci_change` | SCC cell handoff | info |
| `ca_change` | Carrier aggregation activated/deactivated/count changed | info/warning |
| `nr_anchor` | 5G NR anchor gained/lost | info/warning |
| `signal_lost` / `signal_restored` | Modem reachability change | warning/info |
| `internet_lost` / `internet_restored` | Internet connectivity change | warning/info |
| `high_latency` / `latency_recovered` | Latency >90ms (debounced 3 readings) | warning/info |
| `high_packet_loss` / `packet_loss_recovered` | Loss >20% (debounced 3 readings) | warning/info |
| `watchcat_recovery` | Watchdog executed recovery action | warning |
| `sim_failover` | SIM slot switched by watchdog | warning |
| `sim_swap_detected` | Physical SIM card changed at boot | info |

Events are suppressed during active watchcat recovery to prevent noise. All events are also suppressed during scheduled low power mode (when `/tmp/qmanager_low_power_active` exists).

---

## Watchdog (Connection Health)

The watchdog daemon (`qmanager_watchcat`) implements a 4-tier escalation recovery:

```
MONITOR ──(failures)──► SUSPECT ──(confirmed)──► RECOVERY ──► COOLDOWN ──► MONITOR
                                                     │                        ▲
                                                     │   (max retries)        │
                                                     └──► LOCKED ─────────────┘
                                                           (manual reset)

Tier 1: ifup wan          (restart interface)
Tier 2: CFUN toggle       (reset modem radio — SKIPPED if tower lock active)
Tier 3: SIM failover      (switch SIM slot using Golden Rule sequence)
Tier 4: Full reboot       (max 3/hour via token bucket, auto-disables permanently)
```

### SIM Swap Procedure (Golden Rule)

Any SIM slot switch must follow this sequence:
```
AT+CFUN=0    → sleep 2s
AT+QUIMSLOT=N → sleep 2s
AT+CFUN=1
```
Abort immediately if `CFUN=0` fails (modem may be in an inconsistent state).

---

## Custom SIM Profiles

Profiles store a complete modem configuration (APN + TTL/HL + optional IMEI) that can be saved and applied as a unit. Each profile is bound to a SIM card by ICCID and is automatically applied whenever that SIM is detected.

### Auto-Apply on ICCID Match

Profiles are automatically applied whenever the SIM's ICCID matches a saved profile. The `auto_apply_profile()` function in `profile_mgr.sh` scans `/etc/qmanager/profiles/` for a profile whose `sim_iccid` matches the current SIM. If found, it sets the profile as active and spawns `qmanager_profile_apply` in the background. If no match is found, any stale active profile marker is cleared.

The apply script (`qmanager_profile_apply`) compares current modem state against the profile's desired settings and only changes what has drifted, making it a no-op when everything already matches.

**Trigger points:**

| Trigger | Caller Tag | Location | When |
|---------|-----------|----------|------|
| Boot | `boot` | `qmanager_poller` `collect_boot_data()` | After ICCID read + SIM swap detection |
| Manual SIM switch | `sim_switch` | `cellular/settings.sh` | After CFUN=1 restore in SIM slot procedure |
| Watchdog Tier 3 failover | `watchdog` | `qmanager_watchcat` cooldown handler | After SIM failover confirmed with connectivity |
| Watchdog SIM revert | `watchdog_revert` | `qmanager_watchcat` `sim_failover_fallback()` | After reverting to original SIM |

**Flow:**

```
Trigger (boot/SIM switch/watchdog)
    │
    ▼
auto_apply_profile(iccid, caller)
    │
    ├── find_profile_by_iccid(iccid)
    │       scans /etc/qmanager/profiles/p_*.json
    │       matches .sim_iccid field
    │
    ├── [Match found] → set_active_profile(id)
    │       │
    │       └── spawn: qmanager_profile_apply <id>  (double-fork, background)
    │               │
    │               ├── Step 1: APN (AT+CGDCONT, skip if unchanged)
    │               ├── Step 2: TTL/HL (iptables, skip if unchanged)
    │               └── Step 3: IMEI (AT+EGMR + reboot, skip if unchanged)
    │
    └── [No match] → clear_active_profile()
            removes /etc/qmanager/active_profile
```

### Apply Workflow (3 Steps)

```
Step 1: APN        → AT+CGDCONT (set PDP context)
Step 2: TTL/HL     → Write /etc/firewall.user.ttl + apply iptables
Step 3: IMEI       → AT+EGMR=1,7,"<IMEI>" + reboot (only if IMEI changed)
```

The apply process runs asynchronously via `qmanager_profile_apply` daemon. The frontend polls `/profiles/apply_status.sh` for progress updates.

---

## Configuration Persistence

| What | Where | Format |
|------|-------|--------|
| SIM profiles | `/etc/qmanager/profiles/<id>.json` | JSON |
| Tower lock config | `/etc/qmanager/tower_lock.json` | JSON |
| Band lock config | `/etc/qmanager/band_lock.json` | JSON |
| IMEI backup config | `/etc/qmanager/imei_backup.json` | JSON |
| Last SIM ICCID | `/etc/qmanager/last_iccid` | Plain text |
| Email SMTP config | `/etc/qmanager/msmtprc` | msmtp config (chmod 600) |
| TTL/HL rules | `/etc/firewall.user.ttl` | Shell commands (iptables) |
| MTU rules | `/etc/firewall.user.mtu` | Shell commands (ip link) |
| Watchdog config | UCI `quecmanager.watchcat.*` | UCI |
| Ethernet link speed | UCI `quecmanager.eth_link.speed_limit` | UCI |
| System settings | UCI `quecmanager.settings.*` | UCI |
| Timezone | UCI `system.@system[0].timezone/zonename` | UCI |
| Auth password | `/etc/qmanager/shadow` | SHA-256 hash |
| Sessions | `/tmp/qmanager_sessions/<token>` | One file per session |

---

## RM520N-GL Platform Variant

QManager is being extended to support the Quectel RM520N-GL, which runs internally on the modem's own Linux OS rather than OpenWRT on an external host. This creates fundamental architectural differences.

### System Overview (RM520N-GL)

```
┌──────────────────────────────────────────────────────────┐
│                      Browser (Client)                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            Next.js Static App (React 19)            │ │
│  │  (Same frontend, platform-agnostic components)      │ │
│  └──────────────┬──────────────────────────────────────┘ │
└─────────────────┼────────────────────────────────────────┘
                  │ HTTP GET/POST (HTTPS via lighttpd)
                  ▼
┌──────────────────────────────────────────────────────────┐
│          RM520N-GL Modem (Vanilla Linux, systemd)         │
│  ┌──────────────────────────────────────────────────────┐│
│  │  lighttpd → /usrdata/www/cgi-bin/ (CGI)             ││
│  │  ┌──────────────────────────────────────────────────┐│
│  │  │ cgi_base.sh (adapted for vanilla Linux)         │││
│  │  └──────────────────────────────────────────────────┘│
│  │       │ reads cache      │ executes AT               ││
│  │       ▼                  ▼                            ││
│  │  /tmp/qmanager_    microcom + flock                   ││
│  │  status.json       → /dev/ttyOUT ──┐                 ││
│  │       ▲                             │                 ││
│  │       │ writes every 2s             ▼                 ││
│  │  ┌──────────────┐    socat PTY bridge                ││
│  │  │  qmanager    │    ┌──────────┐  ┌──────────┐     ││
│  │  │  poller      │    │/dev/smd11│  │/dev/smd7 │     ││
│  │  │  (systemd)   │    └──────────┘  └──────────┘     ││
│  │  └──────────────┘         └────────┬───────┘         ││
│  │                              Modem AT Processor       ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### AT Command Transport Comparison

| Aspect | RM551E (OpenWRT) | RM520N-GL (Vanilla Linux) |
|--------|------------------|---------------------------|
| Tool | `qcmd` (wraps `sms_tool`) | `microcom -t <ms>` + `flock` |
| Device | USB CDC ACM (host-side) | `/dev/ttyOUT` (smd11), `/dev/ttyOUT2` (smd7) |
| Bridge | None needed | socat PTY pair + `cat` pipes (7 systemd services) |
| Locking | Implicit per-process | Explicit `flock /var/lock/atcmd.lock` required |
| Compound cmds | Semicolon batching via `qcmd` | Supported through same PTY interface |
| Timeout | Configurable via `sms_tool` | `microcom -t <ms>` (millisecond precision) |

### Platform Abstraction Strategy

The AT command layer will be abstracted so both platforms can share the same CGI scripts and poller logic:

1. **`qcmd` wrapper** — Each platform provides its own `/usr/bin/qcmd` (or equivalent) that accepts the same interface: `qcmd 'AT+COMMAND'`
2. **Config abstraction** — UCI calls wrapped in helper functions that dispatch to file-based config on RM520N-GL
3. **Init system** — procd init.d scripts have systemd `.service` counterparts
4. **Shared frontend** — The React frontend is platform-agnostic; only backend scripts differ

### Key Filesystem Differences

| Purpose | RM551E (OpenWRT) | RM520N-GL |
|---------|------------------|-----------|
| Persistent config | `/etc/qmanager/` | `/usrdata/qmanager/` |
| Temp/runtime | `/tmp/` | `/tmp/` (same) |
| CGI scripts | `/www/cgi-bin/quecmanager/` | `/usrdata/www/cgi-bin/quecmanager/` |
| Init scripts | `/etc/init.d/` | `/lib/systemd/system/` |
| Shared libs | `/usr/lib/qmanager/` | `/usrdata/usr/lib/qmanager/` |
| Frontend | `/www/` | `/usrdata/www/` |

> **See also:** [RM520N-GL Architecture Report](rm520n-gl-architecture.md) for the complete platform analysis including socat bridge internals, systemd service graph, and porting strategy.
