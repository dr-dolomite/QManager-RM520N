# QManager Backend Guide

This document covers the OpenWRT shell script backend: CGI endpoints, daemons, init.d services, shared libraries, and development conventions.

---

## Overview

The backend runs on OpenWRT as POSIX shell scripts executed by BusyBox `/bin/sh`. It consists of:

- **CGI endpoints** — HTTP API handlers executed by uhttpd
- **Daemons** — Long-running background processes
- **Init.d services** — Process lifecycle management
- **Shared libraries** — Reusable shell functions

All scripts live in `scripts/` and mirror the device filesystem:

```
scripts/
├── etc/init.d/                    → /etc/init.d/
├── usr/bin/                       → /usr/bin/
├── usr/lib/qmanager/              → /usr/lib/qmanager/
└── www/cgi-bin/quecmanager/       → /www/cgi-bin/quecmanager/
```

---

## Critical Constraints

### POSIX Shell Only

All scripts must be compatible with BusyBox `/bin/sh`. No bashisms allowed:

```sh
# WRONG (bash arrays, [[ ]], process substitution)
arr=(a b c)
[[ $var == "test" ]]
while read line < <(cmd); do ...

# CORRECT (POSIX)
var="a b c"
[ "$var" = "test" ]
cmd | while read line; do ...
```

### Line Endings

**All shell scripts MUST have LF line endings** (not CRLF). CRLF causes silent failures on OpenWRT — scripts produce no output and the CGI returns empty responses.

The `.gitattributes` file enforces LF for `scripts/**/*.sh`, `scripts/etc/init.d/*`, and `scripts/usr/bin/*`.

### AT Commands

All modem communication goes through `qcmd`:

```sh
result=$(qcmd 'AT+QENG="servingcell"')
```

Never access the modem serial port directly.

### No `setsid`

BusyBox doesn't have `setsid`. Use the double-fork pattern for background daemons:

```sh
( "$DAEMON" </dev/null >/dev/null 2>&1 & )
```

### jq `//` Gotcha

**Never use `jq "$filter // empty"` when the value can be `false`**. jq's `//` (alternative operator) treats both `false` and `null` as empty:

```sh
# WRONG — false // "null" returns "null"
jq '(.reachable // "null")'

# CORRECT
jq '(.reachable | if . == null then empty else tostring end)'
```

---

## Shared Libraries

All libraries live in `/usr/lib/qmanager/` and are sourced with include guards.

### cgi_base.sh

CGI boilerplate — source this at the top of every CGI script:

```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
qlog_init "cgi_myfeature"
cgi_headers
```

**Provides:**

| Function | Description |
|----------|-------------|
| `cgi_headers` | Emit JSON + CORS + no-cache headers |
| `cgi_handle_options` | Handle CORS preflight (OPTIONS) requests |
| `cgi_read_post` | Read POST body into `$POST_DATA` |
| `cgi_success` | Emit `{"success":true}` |
| `cgi_error <code> <detail>` | Emit `{"success":false,"error":"...","detail":"..."}` |
| `cgi_method_not_allowed` | Emit 405 JSON response |
| `cgi_reboot_response` | Emit success JSON, then async reboot |
| `serve_ndjson_as_array <file>` | Convert NDJSON file to JSON array |

**Auto-enforces authentication** unless the script sets `_SKIP_AUTH=1` before sourcing.

### cgi_auth.sh

Session and password management:

| Function | Description |
|----------|-------------|
| `require_auth` | Validate session cookie, return 401 if invalid |
| `is_setup_required` | Check if password has been set |
| `qm_verify_password <pw>` | Check password against stored hash |
| `qm_save_password <pw>` | Hash and store password |
| `qm_create_session` | Create session file + set cookies |
| `qm_validate_session` | Check if session token is valid |
| `qm_destroy_session` | Remove session file + clear cookies |
| `qm_check_rate_limit` | Check login attempt rate limit |
| `qm_record_failed_attempt` | Record a failed login |
| `qm_clear_attempts` | Clear rate limit after successful login |

### qlog.sh

Centralized logging library:

```sh
. /usr/lib/qmanager/qlog.sh
qlog_init "component_name"

qlog_debug "Detailed debug info"
qlog_info  "Normal operation info"
qlog_warn  "Something unexpected"
qlog_error "Something failed"
```

**Features:**
- Log levels: DEBUG, INFO, WARN, ERROR (configurable via `QLOG_LEVEL`)
- File logging to `/tmp/qmanager.log` (configurable via `QLOG_FILE`)
- Auto-rotation at 256KB (configurable), keeps 2 rotated files
- Optional syslog output (`QLOG_TO_SYSLOG=1`, default)
- Optional stdout output (`QLOG_TO_STDOUT=0`, default)
- Format: `[TIMESTAMP] LEVEL [COMPONENT:PID] Message`

**Utility functions:**
- `qlog_at_cmd <cmd> <response> [exit_code]` — Log AT command + response at DEBUG
- `qlog_lock <event> [detail]` — Log flock events
- `qlog_state_change <field> <old> <new>` — Log state transitions

### parse_at.sh

AT command response parsers. Extracts structured data from raw AT responses for the poller.

### events.sh

Network event detection (sourced by the poller). Detects state changes and appends events to NDJSON:

| Function | Description |
|----------|-------------|
| `append_event <type> <message> [severity]` | Write event to events file |
| `snapshot_event_state` | Save current state for next comparison |
| `detect_events` | Compare current vs. previous state, emit events |
| `detect_scc_pci_changes` | Detect SCC cell handoffs |
| `detect_data_connection_events` | Detect internet/latency/loss changes |

### profile_mgr.sh

Profile CRUD helpers for custom SIM profiles:
- List, get, save, delete profiles in `/etc/qmanager/profiles/`
- Profile ID generation and validation

### tower_lock_mgr.sh

Tower lock state management:
- Read/write tower lock configuration
- Lock/unlock AT commands
- Schedule management

### email_alerts.sh

Downtime email alert logic (sourced by poller):
- Config management (`/etc/qmanager/msmtprc`)
- Alert triggering on recovery (not during downtime)
- Log writing to `/tmp/qmanager_email_log.json`

### ethtool_helper.sh

Ethernet negotiation helpers:
- Build hex advertise masks from supported link modes
- Handle 2.5G auto-negotiation (bit 47, outside 32-bit range)

### cgi_at.sh

AT command execution helpers for CGI scripts that need to send AT commands.

---

## Daemons

### qmanager_poller (Main Data Collector)

The core daemon — runs forever, polls the modem at tiered intervals.

**Location:** `scripts/usr/bin/qmanager_poller`
**Output:** `/tmp/qmanager_status.json`
**Size:** ~2000 lines

**Responsibilities:**
- Execute AT commands via `qcmd` at tiered intervals
- Parse responses via `parse_at.sh`
- Build complete JSON status object
- Detect and emit network events via `events.sh`
- Manage signal/ping history NDJSON files
- Read ping daemon and watchcat status
- Trigger email alerts on recovery via `email_alerts.sh`

**Tier System:**

| Tier | Interval | Data |
|------|----------|------|
| 1 | 2s | Serving cell, traffic, uptime |
| 1.5 | 10s | Per-antenna signal, history append |
| 2 | 30s | Temperature, carrier, CA, MIMO |
| Boot | Once | Firmware, IMEI, IMSI, capabilities |

### qmanager_ping (Ping Daemon)

Pings a target every 5 seconds to monitor internet connectivity.

**Location:** `scripts/usr/bin/qmanager_ping`
**Output:** `/tmp/qmanager_ping.json`
**History:** `/tmp/qmanager_ping_history.json` (written by poller)

Writes minimal JSON: `{ timestamp, reachable, last_rtt, streaks }`. The poller handles all statistical analysis.

### qmanager_watchcat (Connection Watchdog)

4-tier connection health recovery daemon.

**Location:** `scripts/usr/bin/qmanager_watchcat`
**State:** `/tmp/qmanager_watchcat.json`
**Config:** UCI `quecmanager.watchcat.*`

State machine: `MONITOR → SUSPECT → RECOVERY → COOLDOWN → LOCKED`

| Tier | Action | Notes |
|------|--------|-------|
| 1 | `ifup wan` | Restart WAN interface |
| 2 | CFUN toggle | Reset modem radio (**skipped if tower lock active**) |
| 3 | SIM failover | Switch SIM slot (Golden Rule sequence) |
| 4 | Full reboot | Max 3/hour via token bucket, auto-disables |

### qmanager_cell_scanner / qmanager_neighbour_scanner

On-demand cell scanning daemons started by CGI endpoints.

**Output:** `/tmp/qmanager_cell_scan.json`, `/tmp/qmanager_neighbour_scan.json`

### qmanager_profile_apply

3-step custom profile application daemon:
1. APN → `AT+CGDCONT`
2. TTL/HL → Write `/etc/firewall.user.ttl`
3. IMEI → `AT+EGMR=1,7,"<IMEI>"` + reboot

**State:** `/tmp/qmanager_profile_state.json`

### qmanager_band_failover / qmanager_tower_failover

Signal-based automatic failover daemons for bands and towers.

### qmanager_tower_schedule

Cron-driven tower lock schedule executor.

### qmanager_mtu_apply

Waits for `rmnet_data0` interface (up to 120s), then applies MTU from `/etc/firewall.user.mtu`.

### qmanager_imei_check

Boot-time one-shot: checks if IMEI was rejected (cause 5 from `AT+QNETRC?`), restores backup IMEI if configured.

### qmanager_wan_guard

Boot-time one-shot: validates WAN profiles against active CIDs, disables orphaned profiles to prevent netifd retry loops.

### qmanager_scheduled_reboot

Cron-called script that logs the event and reboots the device.

**Location:** `scripts/usr/bin/qmanager_scheduled_reboot`
**Triggered by:** Cron entry managed by `system/settings.sh`

Minimal script: logs via qlog, then calls `reboot`.

### qmanager_low_power

Cron-called script to enter or exit low power mode (modem airplane mode).

**Location:** `scripts/usr/bin/qmanager_low_power`
**Usage:** `qmanager_low_power enter|exit`

**Enter mode:**

1. Writes timestamp to `/tmp/qmanager_low_power_active`
2. Creates `/tmp/qmanager_watchcat.lock` (pauses watchdog into LOCKED state)
3. Sends `AT+CFUN=0` (disables modem radio)

**Exit mode:**

1. No-ops if flag file absent (handles spurious cron fires on non-active days)
2. Sends `AT+CFUN=1` (re-enables modem radio)
3. Sleeps 3 seconds for modem settling
4. Removes both flag files

**Cron pattern:** Two entries — `enter` fires on selected days, `exit` fires on all 7 days (no-ops if not in low power). This handles overnight windows like 23:00-06:00 where exit day differs from enter day.

### qmanager_low_power_check

Boot-time one-shot: checks if the device rebooted during a scheduled low power window and re-enters CFUN=0 if so. Ensures modem stays off during configured quiet hours even after an unexpected reboot.

**Location:** `scripts/usr/bin/qmanager_low_power_check`

**Flow:**

1. Exit immediately if low power not enabled in UCI
2. Check if current day of week matches configured days
3. Convert start/end times to minutes-since-midnight
4. Handle both normal (08:00-17:00) and overnight (23:00-06:00) windows
5. If inside window: set state flags immediately, sleep 30s (modem init), send `AT+CFUN=0`
6. If outside window: clean up any stale flags from before reboot

### qcmd

AT command wrapper — handles modem device path, locking, and response parsing.

```sh
result=$(qcmd 'AT+QENG="servingcell"')
```

---

## Init.d Services

| Service | Type | START | Daemon | Description |
|---------|------|-------|--------|-------------|
| `qmanager` | procd | 99 | `qmanager_poller` + `qmanager_ping` | Main poller and ping daemon |
| `qmanager_eth_link` | non-procd | 99 | — | Apply ethernet link speed on boot |
| `qmanager_ttl` | non-procd | 99 | — | Apply TTL/HL rules on boot (sources `/etc/firewall.user.ttl`) |
| `qmanager_mtu` | non-procd | 99 | `qmanager_mtu_apply` | MTU application daemon |
| `qmanager_imei_check` | non-procd | 99 | `qmanager_imei_check` | Boot-time IMEI check (one-shot, double-fork) |
| `qmanager_wan_guard` | non-procd | 99 | `qmanager_wan_guard` | WAN profile validation (one-shot) |
| `qmanager_tower_failover` | non-procd | 99 | `qmanager_tower_failover` | Tower failover watchdog |
| `qmanager_low_power_check` | non-procd | 99 | `qmanager_low_power_check` | Boot-time low power window check (one-shot, double-fork) |

Non-procd services use the double-fork pattern for daemonization:
```sh
start() {
    ( "$DAEMON" </dev/null >/dev/null 2>&1 & )
}
```

---

## CGI Endpoint Structure

Every CGI script follows this pattern:

```sh
#!/bin/sh
# Optional: skip auth for auth endpoints
# _SKIP_AUTH=1

. /usr/lib/qmanager/cgi_base.sh
qlog_init "cgi_feature"
cgi_headers

case "$REQUEST_METHOD" in
    GET)
        # Read data and return JSON
        ;;
    POST)
        cgi_handle_options
        cgi_read_post
        # Parse POST_DATA with jq, execute actions, return JSON
        ;;
    OPTIONS)
        exit 0
        ;;
    *)
        cgi_method_not_allowed
        ;;
esac
```

### CGI Endpoints by Category

#### Authentication (`auth/`)

| Script | Method | Description |
|--------|--------|-------------|
| `check.sh` | GET | Check setup status, rate limit |
| `login.sh` | POST | Login or first-time password setup |
| `logout.sh` | POST | Destroy session |
| `password.sh` | POST | Change password |

All auth endpoints set `_SKIP_AUTH=1`.

#### Modem Data (`at_cmd/`)

| Script | Method | Description |
|--------|--------|-------------|
| `fetch_data.sh` | GET | Main cached status JSON (reads `/tmp/qmanager_status.json`) |
| `fetch_events.sh` | GET | Network event log (NDJSON → JSON array) |
| `fetch_signal_history.sh` | GET | Signal history (NDJSON → JSON array) |
| `fetch_ping_history.sh` | GET | Ping history (NDJSON → JSON array) |
| `send_command.sh` | POST | Execute raw AT command |
| `cell_scan_start.sh` | POST | Start cell scan daemon |
| `cell_scan_status.sh` | GET | Get cell scan results |
| `neighbour_scan_start.sh` | POST | Start neighbor scan |
| `neighbour_scan_status.sh` | GET | Get neighbor scan results |
| `speedtest_start.sh` | POST | Start speed test |
| `speedtest_status.sh` | GET | Get speedtest results |
| `speedtest_check.sh` | GET | Check speedtest availability |

#### Cellular Settings (`cellular/`)

| Script | Method | Description |
|--------|--------|-------------|
| `settings.sh` | GET/POST | Mode, roaming, AMBR configuration |
| `apn.sh` | GET/POST | APN profile CRUD |
| `mbn.sh` | GET/POST | MBN profile select/auto |
| `imei.sh` | GET/POST | IMEI read/write/backup |
| `network_priority.sh` | GET/POST | LTE/NR mode preferences |
| `fplmn.sh` | GET/POST | Clear forbidden networks |
| `sms.sh` | GET/POST | SMS inbox/send |

#### Band Locking (`bands/`)

| Script | Method | Description |
|--------|--------|-------------|
| `current.sh` | GET | Current locked bands |
| `lock.sh` | GET/POST | Band lock configuration |
| `failover_status.sh` | GET | Band failover state |
| `failover_toggle.sh` | POST | Enable/disable band failover |

#### Frequency Locking (`frequency/`)

| Script | Method | Description |
|--------|--------|-------------|
| `lock.sh` | GET/POST | EARFCN/ARFCN locking |
| `status.sh` | GET | Current frequency lock |

#### Tower Locking (`tower/`)

| Script | Method | Description |
|--------|--------|-------------|
| `lock.sh` | GET/POST | PCI lock configuration |
| `status.sh` | GET | Current PCI lock state |
| `settings.sh` | GET/POST | Tower lock settings |
| `failover_status.sh` | GET | Tower failover state |
| `schedule.sh` | GET/POST | Scheduled tower changes |

#### Network Settings (`network/`)

| Script | Method | Description |
|--------|--------|-------------|
| `ethernet.sh` | GET/POST | Link speed, duplex, auto-negotiation |
| `ttl.sh` | GET/POST | IPv4 TTL / IPv6 Hop Limit |
| `mtu.sh` | GET/POST | MTU size |
| `dns.sh` | GET/POST | Custom DNS override |
| `ip_passthrough.sh` | GET/POST | IP passthrough mode |

#### Custom Profiles (`profiles/`)

| Script | Method | Description |
|--------|--------|-------------|
| `list.sh` | GET | List all SIM profiles |
| `get.sh` | GET | Get single profile by ID |
| `save.sh` | POST | Create or update profile |
| `delete.sh` | POST | Delete profile |
| `apply.sh` | POST | Start 3-step apply process |
| `apply_status.sh` | GET | Get apply progress |
| `deactivate.sh` | POST | Deactivate active profile |
| `current_settings.sh` | GET | Current modem settings (for profile creation) |

#### Connection Scenarios (`scenarios/`)

| Script | Method | Description |
|--------|--------|-------------|
| `list.sh` | GET | List all scenarios |
| `save.sh` | POST | Create or update scenario |
| `delete.sh` | POST | Delete scenario |
| `activate.sh` | POST | Activate scenario (applies as profile) |
| `active.sh` | GET | Get currently active scenario |

#### Monitoring (`monitoring/`)

| Script | Method | Description |
|--------|--------|-------------|
| `email_alerts.sh` | GET/POST | Email alert settings |
| `email_alert_log.sh` | GET | Email alert history |
| `watchdog.sh` | GET/POST | Watchdog settings and status |

#### Device (`device/`)

| Script | Method | Description |
|--------|--------|-------------|
| `about.sh` | GET | Device info (firmware, model, etc.) |

#### System (`system/`)

| Script | Method | Description |
|--------|--------|-------------|
| `settings.sh` | GET/POST | System preferences, scheduled reboot, low power mode |
| `reboot.sh` | POST | Trigger device reboot (uses `cgi_reboot_response`) |
| `logs.sh` | GET | System log output |

#### VPN (`vpn/`)

| Script | Method | Description |
|--------|--------|-------------|
| `tailscale.sh` | GET/POST | Tailscale VPN status and config |

---

## File Locations on Device

### Temporary State (`/tmp/`)

| File | Owner | Purpose |
|------|-------|---------|
| `qmanager_status.json` | poller | Main cached modem status |
| `qmanager_signal_history.json` | poller | Signal history NDJSON |
| `qmanager_ping_history.json` | poller | Ping history NDJSON |
| `qmanager_events.json` | poller | Network events NDJSON |
| `qmanager_ping.json` | ping daemon | Current ping result |
| `qmanager_watchcat.json` | watchcat | Watchdog state |
| `qmanager_profile_state.json` | profile_apply | Apply progress |
| `qmanager_pci_state.json` | poller (events) | SCC PCI tracking |
| `qmanager_email_log.json` | poller (email) | Email log NDJSON |
| `qmanager_email_reload` | CGI | Trigger file for config reload |
| `qmanager_low_power_active` | low_power | Low power mode flag (timestamp; suppresses events + alerts) |
| `qmanager_watchcat.lock` | low_power | Watchdog pause lock (forces LOCKED state) |
| `qmanager_sessions/` | CGI (auth) | Session files |
| `qmanager.log` | all (qlog) | Centralized log file |

### Persistent Configuration (`/etc/qmanager/`)

| File | Purpose |
|------|---------|
| `shadow` | Password hash (SHA-256) |
| `profiles/<id>.json` | Custom SIM profile configs |
| `tower_lock.json` | Tower lock configuration |
| `band_lock.json` | Band lock configuration |
| `imei_backup.json` | IMEI backup config (`{ enabled, imei }`) |
| `last_iccid` | Last seen SIM ICCID (for swap detection) |
| `msmtprc` | Gmail SMTP config (chmod 600) |
| `imei_check_pending` | Flag for boot-time IMEI check |

### UCI Configuration

| Key | Values | Purpose |
|-----|--------|---------|
| `quecmanager.settings.temp_unit` | `celsius`, `fahrenheit` | Dashboard temperature display |
| `quecmanager.settings.distance_unit` | `km`, `miles` | Dashboard distance display |
| `quecmanager.settings.sched_reboot_enabled` | `0`, `1` | Scheduled reboot on/off |
| `quecmanager.settings.sched_reboot_time` | `HH:MM` | Scheduled reboot time |
| `quecmanager.settings.sched_reboot_days` | `0,1,...,6` | Scheduled reboot days (0=Sun) |
| `quecmanager.settings.low_power_enabled` | `0`, `1` | Low power mode on/off |
| `quecmanager.settings.low_power_start` | `HH:MM` | Low power window start |
| `quecmanager.settings.low_power_end` | `HH:MM` | Low power window end |
| `quecmanager.settings.low_power_days` | `0,1,...,6` | Low power days (0=Sun) |
| `system.@system[0].timezone` | POSIX TZ string | System timezone |
| `system.@system[0].zonename` | IANA zone name | System timezone display name |

### Firewall Rules

| File | Owner | Purpose |
|-----|--------|---------|
| `/etc/firewall.user.ttl` | ttl.sh, apn.sh, profile_apply | TTL/HL iptables rules |
| `/etc/firewall.user.mtu` | mtu.sh | MTU `ip link set` rules |

---

## Development Guidelines

### Creating a New CGI Endpoint

1. Create the script in `scripts/www/cgi-bin/quecmanager/<category>/<name>.sh`
2. Start with the standard boilerplate (source `cgi_base.sh`, call `qlog_init`, `cgi_headers`)
3. Authentication is **automatic** — no extra code needed
4. Use `jq` for JSON construction (never echo raw JSON strings)
5. Use `qcmd` for AT commands
6. Return consistent JSON: `{ "success": true/false, ... }`
7. **Ensure LF line endings** (check with `file` or `cat -A`)

### Creating a New Daemon

1. Create the daemon script in `scripts/usr/bin/qmanager_<name>`
2. Create an init.d script in `scripts/etc/init.d/qmanager_<name>`
3. Use double-fork for daemonization (no `setsid`)
4. Set `START=99` in init.d
5. Source `qlog.sh` and call `qlog_init`
6. Write state to `/tmp/qmanager_<name>.json`
7. Handle `SIGTERM` and `SIGINT` via `trap cleanup EXIT INT TERM`

### JSON Response Conventions

```sh
# Success with data
jq -n --arg value "$value" '{"success":true,"data":$value}'

# Success with object
jq -n --arg f1 "$field1" --argjson f2 "$field2_num" \
  '{"success":true,"field1":$f1,"field2":$f2}'

# Error
cgi_error "error_code" "Human-readable detail message"

# Reboot after response
cgi_reboot_response  # flushes HTTP, then reboots async
```
