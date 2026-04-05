# Phase 2: Systemd Migration Plan — RM520N-GL Port

> **NOTE (2026-04-05):** This is a historical planning document. Key changes since this was written: (1) `qmanager.target` was dropped -- services are symlinked directly into `multi-user.target.wants/` (SimpleAdmin's proven pattern); (2) service files install to `/lib/systemd/system/` (persistent rootfs), not `/etc/systemd/system/` (tmpfs); (3) `systemctl enable/disable` does not work for boot persistence -- `platform.sh` uses symlink creation/removal instead. See `docs/rm520n-gl-architecture.md` for current state.

This document covers converting QManager's 11 procd/rc.d init scripts and their associated daemons to systemd service units for the RM520N-GL port. Phase 1 (qcmd replacement with microcom + flock) is assumed complete. Phase 3 (CGI endpoint UCI migration) is a separate effort, but UCI reads inside daemon scripts are addressed here because services cannot start without their config.

The RM520N-GL runs vanilla Linux with systemd, uses `/bin/bash` (not BusyBox ash), and accesses AT commands through the socat PTY bridge at `/dev/ttyOUT2`. All QManager scripts install to `/usr/bin/`, shared libraries to `/usr/lib/qmanager/`, and config files to `/etc/qmanager/` (writable partition on this device).

---

## Table of Contents

- [Quick Reference](#quick-reference)
- [Dependency Map](#dependency-map)
- [UCI Migration Strategy](#uci-migration-strategy)
- [Service Conversion Reference](#service-conversion-reference)
  - [1. qmanager (Core: Ping + Poller)](#1-qmanager-core-ping--poller)
  - [2. qmanager_watchcat (Connection Watchdog)](#2-qmanager_watchcat-connection-watchdog)
  - [3. qmanager_bandwidth (Live Traffic Monitor)](#3-qmanager_bandwidth-live-traffic-monitor)
  - [4. qmanager_dpi (DPI Evasion / nfqws)](#4-qmanager_dpi-dpi-evasion--nfqws)
  - [5. qmanager_tower_failover (Tower Lock Failover)](#5-qmanager_tower_failover-tower-lock-failover)
  - [6. qmanager_imei_check (IMEI Rejection Check)](#6-qmanager_imei_check-imei-rejection-check)
  - [7. qmanager_ttl (TTL/HL Persistence)](#7-qmanager_ttl-ttlhl-persistence)
  - [8. qmanager_mtu (MTU Persistence)](#8-qmanager_mtu-mtu-persistence)
  - [9. qmanager_wan_guard (WAN Interface Guard)](#9-qmanager_wan_guard-wan-interface-guard)
  - [10. qmanager_eth_link (Ethernet Link Speed)](#10-qmanager_eth_link-ethernet-link-speed)
  - [11. qmanager_low_power_check (Low Power Boot Check)](#11-qmanager_low_power_check-low-power-boot-check)
- [Shared Library Adaptations](#shared-library-adaptations)
- [Implementation Order](#implementation-order)
- [Testing Strategy](#testing-strategy)

---

## Quick Reference

| Item | Value |
|------|-------|
| **Service unit path** | `/etc/systemd/system/` |
| **Config files** | `/etc/qmanager/*.conf` (new), `/etc/qmanager/*.json` (existing) |
| **Daemon install path** | `/usr/bin/qmanager_*` |
| **Shared libraries** | `/usr/lib/qmanager/*.sh` |
| **AT bridge dependency** | `socat-smd7.service` (provides `/dev/ttyOUT2`) |
| **Network daemon dependency** | `ql-netd.service` |
| **Log file** | `/tmp/qmanager.log` (same as OpenWRT) |
| **Total services to convert** | 11 init.d scripts -> 12 systemd units (ping/poller split) |
| **UCI replacement** | JSON config at `/etc/qmanager/qmanager.conf` |

---

## Dependency Map

All QManager services depend on the socat PTY bridge stack being up (for AT command access) and `ql-netd` (for cellular data path). The boot ordering is:

```
sysinit.target
│
├── ql-netd.service                          (Qualcomm network daemon)
│   │
│   ├── socat-smd11.service                  (creates /dev/ttyOUT)
│   │   ├── socat-smd11-to-ttyIN.service     (cat bridge: cmd path)
│   │   └── socat-smd11-from-ttyIN.service   (cat bridge: rsp path)
│   │
│   └── socat-smd7.service                   (creates /dev/ttyOUT2)
│       ├── socat-smd7-to-ttyIN2.service     (cat bridge: cmd path)
│       └── socat-smd7-from-ttyIN2.service   (cat bridge: rsp path)
│
├── network.target                           (basic networking up)
│
└── multi-user.target
    │
    ├── qmanager.target                      ◄── NEW: grouping target
    │   │
    │   │  ── CORE (always on) ──────────────────────────────────────
    │   ├── qmanager-ping.service            (ping daemon, no AT)
    │   ├── qmanager-poller.service           (poller, needs AT bridge)
    │   │      After=socat-smd7-from-ttyIN2.service
    │   │
    │   │  ── BOOT ONE-SHOTS ────────────────────────────────────────
    │   ├── qmanager-ttl.service             (iptables TTL rules)
    │   ├── qmanager-mtu.service             (MTU apply daemon)
    │   │      After=qmanager-poller.service  (needs rmnet_data up)
    │   ├── qmanager-eth-link.service        (ethtool speed limit)
    │   ├── qmanager-imei-check.service      (IMEI rejection check)
    │   │      After=socat-smd7-from-ttyIN2.service
    │   ├── qmanager-low-power-check.service (low power boot check)
    │   │      After=socat-smd7-from-ttyIN2.service
    │   │
    │   │  ── CONDITIONAL (config-gated) ────────────────────────────
    │   ├── qmanager-watchcat.service         (connection watchdog)
    │   │      After=qmanager-poller.service
    │   │      ConditionPathExists=/etc/qmanager/qmanager.conf
    │   ├── qmanager-bandwidth.service        (bandwidth websocat)
    │   ├── qmanager-bandwidth-monitor.service (bandwidth binary)
    │   ├── qmanager-dpi.service              (nfqws DPI evasion)
    │   │      After=socat-smd7-from-ttyIN2.service
    │   └── qmanager-tower-failover.service   (tower lock failover)
    │          After=qmanager-poller.service
    │
    │  ── NOT PORTED (RM520N-GL specific) ───────────────────────────
    └── (qmanager-wan-guard) — SKIP: OpenWRT-specific (netifd/UCI network)
```

**Key relationships:**

- **`qmanager.target`**: New grouping target. `systemctl restart qmanager.target` restarts all QManager services. Individual services can be started/stopped independently.
- **AT-dependent services** use `After=socat-smd7-from-ttyIN2.service` to wait until the complete AT bridge is functional (the response-path cat process is the last piece to start).
- **Poller-dependent services** (watchcat, tower failover) use `After=qmanager-poller.service` because they read the poller cache file.
- **Ping has no AT dependency** — it only runs `/bin/ping` and writes JSON. It can start immediately.
- **WAN guard is NOT ported** — it reads/writes OpenWRT's UCI `network.*` config and calls `ifdown`, which are netifd-specific. The RM520N-GL uses `ql-netd` for network management. This service has no equivalent function on the target platform.

---

## UCI Migration Strategy

UCI (`/etc/config/quecmanager`) does not exist on the RM520N-GL. Every service and CGI script that calls `uci get/set/commit` must be adapted. The strategy uses a single JSON config file read by a shell helper function.

### Config File: `/etc/qmanager/qmanager.conf`

A flat JSON file replacing all UCI sections. Using JSON (not UCI syntax) because `jq` is already a dependency and JSON is portable across platforms.

```json
{
  "watchcat": {
    "enabled": 1,
    "check_interval": 10,
    "max_failures": 5,
    "cooldown": 60,
    "tier1_enabled": 1,
    "tier2_enabled": 1,
    "tier3_enabled": 0,
    "tier4_enabled": 1,
    "backup_sim_slot": "",
    "max_reboots_per_hour": 3
  },
  "bridge_monitor": {
    "enabled": 0,
    "ws_port": 8838,
    "refresh_rate_ms": 1000,
    "interfaces": "br-lan,eth0,rmnet_data0,rmnet_data1,rmnet_ipa0",
    "channel": "network-monitor",
    "json_mode": "yes"
  },
  "video_optimizer": {
    "enabled": 0,
    "quic_enabled": 1
  },
  "traffic_masquerade": {
    "enabled": 0,
    "sni_domain": "speedtest.net"
  },
  "eth_link": {
    "speed_limit": "auto"
  },
  "settings": {
    "temp_unit": "celsius",
    "distance_unit": "km",
    "low_power_enabled": 0,
    "low_power_start": "23:00",
    "low_power_end": "06:00",
    "low_power_days": "0,1,2,3,4,5,6",
    "sched_reboot_enabled": 0,
    "sched_reboot_time": "04:00",
    "sched_reboot_days": "0,1,2,3,4,5,6"
  },
  "update": {
    "include_prerelease": 1,
    "auto_update_enabled": 0,
    "auto_update_time": "03:00"
  }
}
```

### Helper Library: `/usr/lib/qmanager/config.sh`

A new shared library providing `qm_config_get` and `qm_config_set` as drop-in replacements for `uci get` / `uci set` + `uci commit`.

```sh
#!/bin/sh
# config.sh — QManager Configuration Helper (RM520N-GL)
# Drop-in replacement for UCI get/set/commit operations.
# Uses a single JSON config file with jq for reads and writes.

[ -n "$_CONFIG_LOADED" ] && return 0
_CONFIG_LOADED=1

QM_CONFIG="/etc/qmanager/qmanager.conf"
QM_CONFIG_TMP="/etc/qmanager/qmanager.conf.tmp"

# Create default config if missing
qm_config_init() {
    [ -f "$QM_CONFIG" ] && return 0
    cat > "$QM_CONFIG" << 'DEFAULTS'
{
  "watchcat": {"enabled": 0},
  "bridge_monitor": {"enabled": 0, "ws_port": 8838},
  "video_optimizer": {"enabled": 0, "quic_enabled": 1},
  "traffic_masquerade": {"enabled": 0, "sni_domain": "speedtest.net"},
  "eth_link": {"speed_limit": "auto"},
  "settings": {"temp_unit": "celsius", "distance_unit": "km"}
}
DEFAULTS
}

# Read: qm_config_get <section> <key> [default]
# Example: qm_config_get watchcat enabled 0
#   Equivalent to: uci -q get quecmanager.watchcat.enabled
qm_config_get() {
    local section="$1" key="$2" default="${3:-}"
    [ -f "$QM_CONFIG" ] || { echo "$default"; return; }
    local val
    val=$(jq -r --arg s "$section" --arg k "$key" \
        '.[$s][$k] // empty' "$QM_CONFIG" 2>/dev/null)
    if [ -z "$val" ]; then
        echo "$default"
    else
        echo "$val"
    fi
}

# Write: qm_config_set <section> <key> <value>
# Example: qm_config_set watchcat enabled 0
#   Equivalent to: uci set quecmanager.watchcat.enabled=0 && uci commit
# Atomic write via temp file + mv.
qm_config_set() {
    local section="$1" key="$2" value="$3"
    qm_config_init
    # Detect numeric values to store as numbers, not strings
    case "$value" in
        ''|*[!0-9]*) # non-numeric or empty — store as string
            jq --arg s "$section" --arg k "$key" --arg v "$value" \
                '.[$s][$k] = $v' "$QM_CONFIG" > "$QM_CONFIG_TMP" ;;
        *) # numeric — store as number
            jq --arg s "$section" --arg k "$key" --argjson v "$value" \
                '.[$s][$k] = $v' "$QM_CONFIG" > "$QM_CONFIG_TMP" ;;
    esac
    mv "$QM_CONFIG_TMP" "$QM_CONFIG"
}

# Bulk read: qm_config_section <section>
# Returns the entire section as a JSON object on stdout.
# Example: qm_config_section watchcat | jq -r '.enabled'
qm_config_section() {
    local section="$1"
    [ -f "$QM_CONFIG" ] || { echo "{}"; return; }
    jq -r --arg s "$section" '.[$s] // {}' "$QM_CONFIG" 2>/dev/null
}
```

> WARNING: `jq`'s `// empty` alternative operator treats `false` and `null` identically. The `qm_config_get` function uses `// empty` because all config values stored here are strings or integers (never boolean `false`). If a boolean field is ever added, use the safe pattern: `jq '(.[$s][$k]) | if . == null then empty else tostring end'`.

### UCI Call Replacement Map

Every `uci` call in daemon scripts maps to a `qm_config_get` or `qm_config_set` call. The following table shows each script and the translation.

| Script | UCI Call | Replacement |
|--------|----------|-------------|
| `qmanager_watchcat` | `uci -q get quecmanager.watchcat.enabled` | `qm_config_get watchcat enabled 1` |
| `qmanager_watchcat` | `uci -q get quecmanager.watchcat.check_interval` | `qm_config_get watchcat check_interval 10` |
| `qmanager_watchcat` | `uci -q get quecmanager.watchcat.max_failures` | `qm_config_get watchcat max_failures 5` |
| `qmanager_watchcat` | `uci -q get quecmanager.watchcat.cooldown` | `qm_config_get watchcat cooldown 60` |
| `qmanager_watchcat` | `uci -q get quecmanager.watchcat.tier{1..4}_enabled` | `qm_config_get watchcat tier{1..4}_enabled {default}` |
| `qmanager_watchcat` | `uci -q get quecmanager.watchcat.backup_sim_slot` | `qm_config_get watchcat backup_sim_slot ""` |
| `qmanager_watchcat` | `uci -q get quecmanager.watchcat.max_reboots_per_hour` | `qm_config_get watchcat max_reboots_per_hour 3` |
| `qmanager_watchcat` | `uci set quecmanager.watchcat.enabled=0 && uci commit` | `qm_config_set watchcat enabled 0` |
| `qmanager_bandwidth_genconf` | `uci -q get quecmanager.bridge_monitor.*` | `qm_config_get bridge_monitor * {default}` |
| `qmanager_low_power_check` | `uci -q get quecmanager.settings.low_power_*` | `qm_config_get settings low_power_* {default}` |
| `qcmd` | `uci -q get quecmanager.settings.sms_tool_device` | **Hardcode** `/dev/ttyOUT2` (RM520N has fixed device) |
| `qmanager_dpi` (init.d) | `uci -q get quecmanager.video_optimizer.enabled` | `qm_config_get video_optimizer enabled 0` |
| `qmanager_dpi` (init.d) | `uci -q get quecmanager.traffic_masquerade.enabled` | `qm_config_get traffic_masquerade enabled 0` |
| `qmanager_dpi` (init.d) | `uci -q get quecmanager.traffic_masquerade.sni_domain` | `qm_config_get traffic_masquerade sni_domain speedtest.net` |
| `qmanager_dpi` (init.d) | `uci -q get quecmanager.video_optimizer.quic_enabled` | `qm_config_get video_optimizer quic_enabled 1` |
| `qmanager_eth_link` | `uci get quecmanager.eth_link.speed_limit` | `qm_config_get eth_link speed_limit auto` |
| `qmanager_auto_update` | `uci -q get quecmanager.update.include_prerelease` | `qm_config_get update include_prerelease 1` |
| `qmanager_wan_guard` | `uci get/set network.*` | **NOT PORTED** (OpenWRT-specific) |
| `vpn_firewall.sh` | `uci get/set/commit firewall.*` | **NOT PORTED** (RM520N uses iptables directly) |

### Services NOT Needing UCI

These scripts have zero UCI calls and are portable as-is (after the source guard fix):

- `qmanager` (core init.d — reads log level from file, not UCI)
- `qmanager_ping` (daemon)
- `qmanager_poller` (daemon — reads config from files, sources parse_at.sh/events.sh)
- `qmanager_tower_failover` (daemon — reads JSON config, not UCI)
- `qmanager_imei_check` (daemon — reads JSON config, not UCI)
- `qmanager_ttl` (init.d — sources firewall rules file)
- `qmanager_mtu` (init.d — spawns daemon that uses `ip link`)

---

## Service Conversion Reference

### Conventions Used Throughout

**Source guard pattern.** BusyBox ash's `.` (source) builtin aborts the entire script if the file does not exist. On OpenWRT, the daemon scripts already use the safe pattern for qlog.sh:

```sh
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init() { :; }; qlog_info() { :; }; ...
}
```

However, some scripts source other libraries without the guard (e.g., `. /usr/lib/qmanager/cgi_at.sh` with no `[ -f ]` check or `2>/dev/null || ...` fallback). On the RM520N-GL, `/bin/bash` will print an error but continue execution (unlike ash which aborts), so this is lower risk but should still be fixed for clean behavior.

**Naming convention.** Systemd unit names use hyphens (`qmanager-ping.service`), not underscores, following systemd conventions. The underlying daemon binaries keep their underscore names (`qmanager_ping`).

**Environment files.** Each service reads log level from `/etc/qmanager/environment`:

```
QLOG_LEVEL=INFO
```

---

### 1. qmanager (Core: Ping + Poller)

**Current procd implementation:**
- Two instances (`ping`, `poller`) in a single init.d script with `USE_PROCD=1`
- `START=99`, `respawn 3600 5 5`
- `start_service()` also creates directories, chmods scripts, creates `long_commands.list` defaults
- Reads log level from `/etc/qmanager/log_level`

**Systemd approach:** Split into two independent service units plus a grouping target. The setup tasks (mkdir, chmod) move to a one-shot setup service.

#### qmanager.target

```ini
# /etc/systemd/system/qmanager.target
[Unit]
Description=QManager Services
After=multi-user.target

[Install]
WantedBy=multi-user.target
```

#### qmanager-setup.service

```ini
# /etc/systemd/system/qmanager-setup.service
[Unit]
Description=QManager Directory & Permission Setup
Before=qmanager-ping.service qmanager-poller.service
PartOf=qmanager.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/qmanager_setup

[Install]
WantedBy=qmanager.target
```

The setup script (`/usr/bin/qmanager_setup`) replaces the inline logic from the old `start_service()`:

```sh
#!/bin/sh
# One-shot setup: directories, permissions, defaults
mkdir -p /var/lock /etc/qmanager /usr/lib/qmanager /tmp/quecmanager
for f in /usr/bin/qmanager_*; do [ -f "$f" ] && chmod +x "$f"; done
for f in /www/cgi-bin/quecmanager/*.sh /www/cgi-bin/quecmanager/*/*.sh; do
    [ -f "$f" ] && chmod +x "$f"
done
[ -f /etc/qmanager/auth.json ] && chmod 600 /etc/qmanager/auth.json
if [ ! -f /etc/qmanager/long_commands.list ]; then
    cat > /etc/qmanager/long_commands.list << 'EOF'
# QManager Long Commands List
QSCAN
QSCANFREQ
QFOTADL
EOF
fi
# Initialize default config if missing
if [ -f /usr/lib/qmanager/config.sh ]; then
    . /usr/lib/qmanager/config.sh
    qm_config_init
fi
```

#### qmanager-ping.service

```ini
# /etc/systemd/system/qmanager-ping.service
[Unit]
Description=QManager Ping Daemon
After=network.target qmanager-setup.service
PartOf=qmanager.target

[Service]
Type=simple
ExecStart=/usr/bin/qmanager_ping
EnvironmentFile=-/etc/qmanager/environment
Restart=on-failure
RestartSec=5s
# Equivalent to procd respawn 3600 5 5: after 5 failures within 3600s, stop trying
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=qmanager.target
```

**Daemon script changes:** None. `qmanager_ping` has no UCI calls and already uses the safe source guard for qlog.sh. It only runs `/bin/ping` and writes `/tmp/qmanager_ping.json`. Fully portable.

**Files needing source guard fix:** None (already guarded).

#### qmanager-poller.service

```ini
# /etc/systemd/system/qmanager-poller.service
[Unit]
Description=QManager Modem Data Poller
After=socat-smd7-from-ttyIN2.service qmanager-setup.service qmanager-ping.service
Wants=qmanager-ping.service
PartOf=qmanager.target

[Service]
Type=simple
ExecStart=/usr/bin/qmanager_poller
EnvironmentFile=-/etc/qmanager/environment
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=qmanager.target
```

**Daemon script changes:** None required for systemd migration. The poller already uses safe source guards for qlog.sh, parse_at.sh, events.sh, and email_alerts.sh. It has no UCI calls. All AT commands go through `qcmd` (replaced in Phase 1).

**Files needing source guard fix:** All four library sources in qmanager_poller already use the `2>/dev/null || { ... }` pattern. No changes needed.

**Dependencies:**
- `After=socat-smd7-from-ttyIN2.service` — AT bridge must be fully operational
- `Wants=qmanager-ping.service` — reads ping data, but can survive without it
- Reads: AT responses via `qcmd`, `/tmp/qmanager_ping.json`
- Writes: `/tmp/qmanager_status.json` (poller cache)

---

### 2. qmanager_watchcat (Connection Watchdog)

**Current procd implementation:**
- Single instance with `USE_PROCD=1`, `respawn 3600 5 5`
- Guard: `uci -q get quecmanager.watchcat.enabled` must be `"1"`
- `stop_service()` cleans up PID/lock/recovery files
- Sources: `qlog.sh`, `events.sh`

**Key UCI dependencies (10 calls):**
- Reads 10 config values from `quecmanager.watchcat.*` at startup and on reload
- Writes `quecmanager.watchcat.enabled=0` on Tier 4 auto-disable (critical: must persist)

#### qmanager-watchcat.service

```ini
# /etc/systemd/system/qmanager-watchcat.service
[Unit]
Description=QManager Connection Health Watchdog
After=qmanager-poller.service socat-smd7-from-ttyIN2.service
Wants=qmanager-poller.service
PartOf=qmanager.target

[Service]
Type=simple
# Config-gated start: the ExecStartPre checks the enabled flag.
# If disabled, the pre-check exits non-zero and the service won't start.
ExecStartPre=/bin/sh -c '[ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh && val=$(qm_config_get watchcat enabled 0) && [ "$val" = "1" ]'
ExecStart=/usr/bin/qmanager_watchcat
EnvironmentFile=-/etc/qmanager/environment
ExecStopPost=/bin/sh -c 'rm -f /tmp/qmanager_watchcat.pid /tmp/qmanager_watchcat.lock /tmp/qmanager_recovery_active'
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=qmanager.target
```

**Daemon script changes required:**

1. **Replace all `uci` calls in `read_config()`** (lines 94-126 of `qmanager_watchcat`). Each `uci -q get quecmanager.watchcat.<key>` becomes `qm_config_get watchcat <key> <default>`.

2. **Replace the UCI write in `execute_tier4()`** (lines 430-431). The Tier 4 auto-disable currently does:
   ```sh
   uci set quecmanager.watchcat.enabled=0
   uci commit quecmanager 2>/dev/null
   ```
   Replace with:
   ```sh
   qm_config_set watchcat enabled 0
   ```

3. **Source `config.sh`** at the top of the daemon script. Add after the qlog source block:
   ```sh
   [ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh
   ```

**Files needing source guard fix:**
- `events.sh` source (line 40) — already guarded with `2>/dev/null || { ... }`
- `qlog.sh` source (line 30) — already guarded
- NEW: `config.sh` source — use `[ -f ] && .` guard

**Dependencies:**
- `After=qmanager-poller.service` — reads `/tmp/qmanager_ping.json` written by ping daemon (which poller depends on)
- `After=socat-smd7-from-ttyIN2.service` — uses `qcmd` for Tier 2 (CFUN) and Tier 3 (QUIMSLOT) recovery
- Reads: `/tmp/qmanager_ping.json`, `/etc/qmanager/tower_lock.json`, `/etc/qmanager/qmanager.conf`
- Writes: `/tmp/qmanager_watchcat.json`, `/etc/qmanager/crash.log`, `/etc/qmanager/qmanager.conf` (T4 disable)

---

### 3. qmanager_bandwidth (Live Traffic Monitor)

**Current procd implementation:**
- Two instances (`websocat`, `bridge_monitor`) in one init.d script
- Guard: `uci -q get quecmanager.bridge_monitor.enabled` must be `"1"`
- Calls `qmanager_bandwidth_genconf` before start
- Reads `ws_port` from UCI

**Key UCI dependencies:**
- Init.d reads `bridge_monitor.enabled`, `bridge_monitor.ws_port`
- `qmanager_bandwidth_genconf` reads 5 values from `quecmanager.bridge_monitor.*`

**Systemd approach:** Split into two services (websocat + binary) plus a genconf one-shot, linked by a target.

#### qmanager-bandwidth.target

```ini
# /etc/systemd/system/qmanager-bandwidth.target
[Unit]
Description=QManager Bandwidth Monitor Stack
PartOf=qmanager.target

[Install]
WantedBy=qmanager.target
```

#### qmanager-bandwidth-genconf.service

```ini
# /etc/systemd/system/qmanager-bandwidth-genconf.service
[Unit]
Description=QManager Bandwidth Monitor Config Generator
Before=qmanager-bandwidth-websocat.service qmanager-bandwidth-monitor.service
PartOf=qmanager-bandwidth.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/bin/sh -c '[ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh && val=$(qm_config_get bridge_monitor enabled 0) && [ "$val" = "1" ]'
ExecStart=/usr/bin/qmanager_bandwidth_genconf

[Install]
WantedBy=qmanager-bandwidth.target
```

#### qmanager-bandwidth-websocat.service

```ini
# /etc/systemd/system/qmanager-bandwidth-websocat.service
[Unit]
Description=QManager Bandwidth WebSocket Server
After=qmanager-bandwidth-genconf.service network.target
Requires=qmanager-bandwidth-genconf.service
PartOf=qmanager-bandwidth.target

[Service]
Type=simple
ExecStart=/bin/sh -c '. /usr/lib/qmanager/config.sh 2>/dev/null; WS_PORT=$(qm_config_get bridge_monitor ws_port 8838); exec /usr/bin/websocat -E -t --ping-interval 10 --ping-timeout 30 "ws-listen:0.0.0.0:${WS_PORT}" "broadcast:mirror:"'
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=qmanager-bandwidth.target
```

#### qmanager-bandwidth-monitor.service

```ini
# /etc/systemd/system/qmanager-bandwidth-monitor.service
[Unit]
Description=QManager Bridge Traffic Monitor Binary
After=qmanager-bandwidth-genconf.service qmanager-bandwidth-websocat.service
Requires=qmanager-bandwidth-genconf.service
PartOf=qmanager-bandwidth.target

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p /tmp/quecmanager
ExecStart=/usr/bin/bridge_traffic_monitor_rm551
ExecStopPost=/bin/sh -c 'rm -f /tmp/quecmanager/bridge_traffic_monitor /tmp/quecmanager/bridge_traffic_monitor.pid'
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=qmanager-bandwidth.target
```

**Daemon script changes required:**

1. **`qmanager_bandwidth_genconf`** — Replace all `uci -q get` calls with `qm_config_get`:
   ```sh
   # Before:
   val=$(uci -q get "quecmanager.bridge_monitor.$1" 2>/dev/null)
   # After:
   val=$(qm_config_get bridge_monitor "$1" "$2")
   ```
   Source `config.sh` at the top with guard: `[ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh`

2. **Bridge traffic monitor binary** (`bridge_traffic_monitor_rm551`) — This is a compiled binary, not a shell script. It reads its config from the generated `.conf` file. No changes needed to the binary itself — the genconf script feeds it the right values regardless of where those values come from.

**Files needing source guard fix:**
- `qmanager_bandwidth_genconf` — needs `[ -f ] && .` guard for `config.sh`

**Dependencies:**
- No AT commands needed
- No socat bridge dependency
- Only needs network for WebSocket listening

> NOTE: The binary name `bridge_traffic_monitor_rm551` was built for the RM551E's ARM64 architecture. The RM520N-GL is ARMv7l (32-bit). This binary must be cross-compiled for the correct architecture or replaced.

---

### 4. qmanager_dpi (DPI Evasion / nfqws)

**Current procd implementation:**
- Single instance with `USE_PROCD=1`, `respawn 3600 5 5`
- Sources `qlog.sh` and `dpi_helper.sh` at top level (outside any function)
- Multiple UCI reads for mode detection (VO enabled, masq enabled, SNI domain, QUIC)
- Mutually exclusive modes: masquerade or video optimizer
- Pre-start checks: binary exists, kernel NFQUEUE support
- Inserts/removes nftables rules via `dpi_helper.sh`

**Key UCI dependencies (5 reads in init.d):**
- `quecmanager.video_optimizer.enabled`
- `quecmanager.video_optimizer.quic_enabled`
- `quecmanager.traffic_masquerade.enabled`
- `quecmanager.traffic_masquerade.sni_domain`

**Firewall note:** The current `dpi_helper.sh` uses nftables (`nft add rule inet fw4 ...`). The RM520N-GL uses iptables. The `dpi_insert_rules()` and `dpi_remove_rules()` functions must be rewritten to use iptables + NFQUEUE target. This is a significant change within the library.

#### qmanager-dpi.service

```ini
# /etc/systemd/system/qmanager-dpi.service
[Unit]
Description=QManager DPI Evasion Service (nfqws)
After=network.target qmanager-setup.service
PartOf=qmanager.target

[Service]
Type=simple
ExecStartPre=/usr/bin/qmanager_dpi_start_check
ExecStart=/usr/bin/qmanager_dpi_run
ExecStop=/usr/bin/qmanager_dpi_stop
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=3600
StartLimitBurst=5

[Install]
WantedBy=qmanager.target
```

**Rationale for wrapper scripts:** The DPI init.d script has complex start logic (mode detection, binary checks, kernel module checks, nftables rule insertion, argument building). Rather than cramming this into `ExecStart=`, create helper scripts that encapsulate the logic.

**`/usr/bin/qmanager_dpi_start_check`** — Pre-start validation:
```sh
#!/bin/sh
# Pre-start checks for DPI service
[ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh
[ -f /usr/lib/qmanager/dpi_helper.sh ] && . /usr/lib/qmanager/dpi_helper.sh

vo_enabled=$(qm_config_get video_optimizer enabled 0)
masq_enabled=$(qm_config_get traffic_masquerade enabled 0)

# Neither enabled — exit non-zero to prevent start
[ "$vo_enabled" = "1" ] || [ "$masq_enabled" = "1" ] || exit 1

# Binary must exist
dpi_check_binary || exit 1

# Kernel NFQUEUE support
dpi_check_kmod || exit 1

exit 0
```

**`/usr/bin/qmanager_dpi_run`** — Main start logic (builds args, inserts rules, exec's nfqws):
```sh
#!/bin/sh
[ -f /usr/lib/qmanager/qlog.sh ] && . /usr/lib/qmanager/qlog.sh
[ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh
[ -f /usr/lib/qmanager/dpi_helper.sh ] && . /usr/lib/qmanager/dpi_helper.sh
qlog_init "qmanager_dpi"

iface=$(ip route 2>/dev/null | awk '/^default/{print $5; exit}')
iface="${iface:-rmnet_data0}"

dpi_remove_rules  # clean up stale rules

vo_enabled=$(qm_config_get video_optimizer enabled 0)
masq_enabled=$(qm_config_get traffic_masquerade enabled 0)

args="--qnum=$DPI_QUEUE_NUM"

if [ "$masq_enabled" = "1" ]; then
    sni_domain=$(qm_config_get traffic_masquerade sni_domain speedtest.net)
    args="$args --dpi-desync=fake"
    args="$args --dpi-desync-fake-tls-mod=sni=$sni_domain"
    args="$args --dpi-desync-fooling=badseq"
    args="$args --dpi-desync-udplen-increment=2"
    qlog_info "Starting traffic masquerade on $iface (sni=$sni_domain)"
elif [ "$vo_enabled" = "1" ]; then
    [ ! -f "$DPI_HOSTLIST" ] && { qlog_error "Hostlist missing"; exit 1; }
    quic_enabled=$(qm_config_get video_optimizer quic_enabled 1)
    args="$args --hostlist=$DPI_HOSTLIST"
    args="$args --dpi-desync=split2 --dpi-desync-split-seqovl=1 --dpi-desync-split-pos=1"
    [ "$quic_enabled" != "0" ] && args="$args --dpi-desync-udplen-increment=2"
    qlog_info "Starting video optimizer on $iface"
fi

dpi_insert_rules "$iface" || { qlog_error "Failed to insert rules"; exit 1; }

# exec replaces this shell with nfqws — systemd tracks the nfqws PID directly
exec $NFQWS_BIN $args
```

**`/usr/bin/qmanager_dpi_stop`** — Cleanup:
```sh
#!/bin/sh
[ -f /usr/lib/qmanager/dpi_helper.sh ] && . /usr/lib/qmanager/dpi_helper.sh
dpi_remove_rules
rm -f "$NFQWS_PID"
```

**Daemon/library changes required:**

1. **`dpi_helper.sh`** — Major rewrite of `dpi_insert_rules()` and `dpi_remove_rules()` to use iptables instead of nftables:
   ```sh
   # nftables (current):
   nft add rule inet fw4 mangle_postrouting oifname "$iface" tcp dport 443 ...

   # iptables (RM520N-GL):
   iptables -t mangle -A POSTROUTING -o "$iface" -p tcp --dport 443 \
       -m conntrack --ctorigdstpkts 1:4 -j NFQUEUE --queue-num $DPI_QUEUE_NUM --queue-bypass \
       -m comment --comment "$DPI_NFT_COMMENT"
   ```

2. **`dpi_get_packet_count()`** — Rewrite to read iptables counters instead of nftables counters:
   ```sh
   # iptables approach:
   iptables -t mangle -L POSTROUTING -v -n 2>/dev/null | \
       awk '/'"$DPI_NFT_COMMENT"'/ {sum += $1} END {print sum+0}'
   ```

3. **Source all libraries with guards.**

**Files needing source guard fix:**
- The current init.d sources `qlog.sh` and `dpi_helper.sh` at the top level without `[ -f ]` guards (lines 11-12). The new wrapper scripts use `[ -f ] && .` guards.

**Dependencies:**
- No AT commands needed (no socat dependency)
- Needs `network.target` (for interface detection via `ip route`)
- Needs NFQUEUE kernel support (check in `ExecStartPre`)

> WARNING: The `nfqws` binary is architecture-specific. The RM520N-GL is ARMv7l — the binary must be the correct architecture. The `qmanager_dpi_install` script's architecture detection logic must also be updated.

---

### 5. qmanager_tower_failover (Tower Lock Failover)

**Current implementation:**
- Non-procd, manual start/stop with double-fork spawn
- Guards: reads `/etc/qmanager/tower_lock.json` for failover enabled + active locks
- PID file based process tracking
- Sources: `qlog.sh`, `tower_lock_mgr.sh`
- No UCI calls

#### qmanager-tower-failover.service

```ini
# /etc/systemd/system/qmanager-tower-failover.service
[Unit]
Description=QManager Tower Lock Failover Daemon
After=qmanager-poller.service socat-smd7-from-ttyIN2.service
Wants=qmanager-poller.service
PartOf=qmanager.target

[Service]
Type=simple
# Guard: config must exist with failover enabled + active locks
ExecStartPre=/bin/sh -c '\
    [ -f /etc/qmanager/tower_lock.json ] || exit 1; \
    fo=$(jq -r ".failover.enabled // false" /etc/qmanager/tower_lock.json 2>/dev/null); \
    lte=$(jq -r ".lte.enabled // false" /etc/qmanager/tower_lock.json 2>/dev/null); \
    nr=$(jq -r ".nr_sa.enabled // false" /etc/qmanager/tower_lock.json 2>/dev/null); \
    [ "$fo" = "true" ] || exit 1; \
    [ "$lte" = "true" ] || [ "$nr" = "true" ] || exit 1'
ExecStart=/usr/bin/qmanager_tower_failover
ExecStopPost=/bin/sh -c 'rm -f /tmp/qmanager_tower_failover.pid /tmp/qmanager_tower_failover'
# No Restart — daemon intentionally exits after failover activation
Restart=no

[Install]
WantedBy=qmanager.target
```

**Daemon script changes required:**

1. **Remove the double-fork.** The daemon currently writes its own PID file and manages its own lifecycle because OpenWRT has no process supervisor for non-procd services. Under systemd with `Type=simple`, the daemon runs in the foreground and systemd tracks its PID. Remove the self-daemonization code and PID file management from the daemon script itself.

2. **Source guard for `tower_lock_mgr.sh`** (line 33) — currently uses `2>/dev/null` but no fallback. Add `[ -f ] && .` guard:
   ```sh
   # Before:
   . /usr/lib/qmanager/tower_lock_mgr.sh 2>/dev/null
   # After:
   [ -f /usr/lib/qmanager/tower_lock_mgr.sh ] && . /usr/lib/qmanager/tower_lock_mgr.sh
   ```

**Files needing source guard fix:**
- `tower_lock_mgr.sh` source (line 33) — add `[ -f ]` guard

**Dependencies:**
- `After=qmanager-poller.service` — reads poller cache for signal data
- `After=socat-smd7-from-ttyIN2.service` — uses `qcmd` for unlock AT commands
- Reads: `/tmp/qmanager_status.json`, `/etc/qmanager/tower_lock.json`

> NOTE: This service is started/stopped dynamically by CGI endpoints when tower lock configuration changes. The CGI scripts call `systemctl start qmanager-tower-failover` / `systemctl stop qmanager-tower-failover` instead of `/etc/init.d/qmanager_tower_failover start/stop`.

---

### 6. qmanager_imei_check (IMEI Rejection Check)

**Current implementation:**
- Non-procd, one-shot double-fork
- Guards: pending flag file + backup JSON exists + enabled field in JSON
- Sources: `qlog.sh`, `cgi_at.sh`
- No UCI calls

#### qmanager-imei-check.service

```ini
# /etc/systemd/system/qmanager-imei-check.service
[Unit]
Description=QManager IMEI Rejection Check (One-Shot)
After=socat-smd7-from-ttyIN2.service qmanager-setup.service
PartOf=qmanager.target

[Service]
Type=oneshot
# Guard: pending flag + backup config with enabled=true
ExecStartPre=/bin/sh -c '\
    [ -f /etc/qmanager/imei_check_pending ] || exit 1; \
    [ -f /etc/qmanager/imei_backup.json ] || exit 1; \
    enabled=$(jq -r "(.enabled) | if . == null then \"false\" else tostring end" /etc/qmanager/imei_backup.json 2>/dev/null); \
    [ "$enabled" = "true" ] || exit 1'
ExecStart=/usr/bin/qmanager_imei_check
RemainAfterExit=no

[Install]
WantedBy=qmanager.target
```

**Daemon script changes required:**

1. **Remove double-fork and sleep.** The daemon currently sleeps 20s for modem readiness before querying AT commands. Under systemd, the `After=socat-smd7-from-ttyIN2.service` dependency ensures the AT bridge is up. The 20s sleep may still be needed for modem registration, but can be reduced or replaced with a polling loop that checks modem readiness.

2. **Source guard for `cgi_at.sh`** (line 33) — currently no guard:
   ```sh
   # Before:
   . /usr/lib/qmanager/cgi_at.sh
   # After:
   [ -f /usr/lib/qmanager/cgi_at.sh ] && . /usr/lib/qmanager/cgi_at.sh
   ```

**Files needing source guard fix:**
- `cgi_at.sh` source (line 33) — add `[ -f ]` guard

**Dependencies:**
- `After=socat-smd7-from-ttyIN2.service` — uses `qcmd` for AT+QNETRC? and AT+EGMR
- Reads: `/etc/qmanager/imei_check_pending`, `/etc/qmanager/imei_backup.json`

---

### 7. qmanager_ttl (TTL/HL Persistence)

**Current implementation:**
- Non-procd, inline one-shot
- Sources `/etc/firewall.user.ttl` which contains iptables rules
- 5-second sleep before applying
- No UCI calls

#### qmanager-ttl.service

```ini
# /etc/systemd/system/qmanager-ttl.service
[Unit]
Description=QManager TTL/HL Rules Persistence
After=network.target qmanager-setup.service
PartOf=qmanager.target

[Service]
Type=oneshot
RemainAfterExit=yes
# Guard: only run if rules file exists
ConditionPathExists=/etc/firewall.user.ttl
# Brief delay for iptables modules
ExecStartPre=/bin/sleep 5
ExecStart=/bin/sh -c '. /etc/firewall.user.ttl && logger -t qmanager_ttl "Applied TTL/HL settings"'

[Install]
WantedBy=qmanager.target
```

**Daemon script changes:** None. The TTL rules file already uses iptables (not nftables) because OpenWRT's iptables rules for TTL/HL on `rmnet+` interfaces are portable. The RM520N-GL uses the same `rmnet+` wildcard interface pattern.

> NOTE: Verify that the firewall.user.ttl rules reference `rmnet+` (not `wwan0`). On the RM520N-GL, the cellular interface is `rmnet_data0` so `rmnet+` works correctly.

**Files needing source guard fix:** None (the `ConditionPathExists` directive handles the guard).

**Dependencies:**
- No AT commands
- No socat dependency
- Only needs iptables available (always present on RM520N-GL)

---

### 8. qmanager_mtu (MTU Persistence)

**Current implementation:**
- Non-procd, one-shot double-fork
- Spawns `qmanager_mtu_apply` daemon which waits for `rmnet_data` interface to appear
- Sources `/etc/firewall.user.mtu`
- No UCI calls

#### qmanager-mtu.service

```ini
# /etc/systemd/system/qmanager-mtu.service
[Unit]
Description=QManager MTU Settings Persistence
After=network.target qmanager-setup.service
PartOf=qmanager.target

[Service]
Type=simple
ConditionPathExists=/etc/firewall.user.mtu
ConditionFileIsExecutable=/usr/bin/qmanager_mtu_apply
ExecStart=/usr/bin/qmanager_mtu_apply
# The daemon polls for rmnet_data and exits after applying — no restart
Restart=no

[Install]
WantedBy=qmanager.target
```

**Daemon script changes required:**

1. **Remove double-fork.** Under systemd `Type=simple`, the daemon runs in the foreground. Remove the self-daemonization. The daemon's internal wait loop (polling for `rmnet_data0` to appear) still works correctly — systemd just tracks it directly.

**Files needing source guard fix:** The `qmanager_mtu_apply` daemon sources `firewall.user.mtu` with a guard already (`[ -f ]` check). No changes needed.

**Dependencies:**
- No AT commands
- Uses `ip link set` (always available)
- Waits internally for `rmnet_data` interface

---

### 9. qmanager_wan_guard (WAN Interface Guard)

**Current implementation:**
- Non-procd, one-shot double-fork
- Reads/writes OpenWRT UCI `network.*` config (wan/wan2/wan3/wan4 interfaces)
- Calls `ifdown` (OpenWRT netifd command)
- Sources: `qlog.sh`, `cgi_at.sh`

#### NOT PORTED

**Reason:** This service is entirely OpenWRT-specific. It prevents netifd from retry-looping on phantom rmnet CIDs by manipulating UCI network config and calling `ifdown`. The RM520N-GL does not use netifd — it uses `ql-netd` (Qualcomm's network daemon) which manages rmnet interfaces directly and does not have the same phantom CID problem.

If a similar problem is discovered on the RM520N-GL, a new RM520N-specific solution would be built rather than adapting this script.

**No systemd unit file.** No daemon changes. Skip entirely.

---

### 10. qmanager_eth_link (Ethernet Link Speed)

**Current implementation:**
- Non-procd, inline one-shot
- Sources `ethtool_helper.sh` at the top level (outside functions)
- Reads UCI `quecmanager.eth_link.speed_limit`
- Uses `ethtool` to set advertise mask
- 2-second sleep before applying

**UCI dependency:** Reads 1 value.

#### qmanager-eth-link.service

```ini
# /etc/systemd/system/qmanager-eth-link.service
[Unit]
Description=QManager Ethernet Link Speed Persistence
After=network.target qmanager-setup.service
PartOf=qmanager.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/bin/sh -c 'command -v ethtool >/dev/null 2>&1 && [ -d /sys/class/net/eth0 ]'
ExecStart=/usr/bin/qmanager_eth_link_apply
ExecStop=/usr/bin/qmanager_eth_link_reset

[Install]
WantedBy=qmanager.target
```

Create wrapper scripts to encapsulate the logic previously in the init.d start/stop functions.

**`/usr/bin/qmanager_eth_link_apply`:**
```sh
#!/bin/sh
[ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh
[ -f /usr/lib/qmanager/ethtool_helper.sh ] && . /usr/lib/qmanager/ethtool_helper.sh

ETH_INTERFACE="eth0"
limit=$(qm_config_get eth_link speed_limit auto)

sleep 2

case "$limit" in
    "10")   ethtool -s "$ETH_INTERFACE" advertise 0x003 autoneg on 2>/dev/null ;;
    "100")  ethtool -s "$ETH_INTERFACE" advertise 0x00f autoneg on 2>/dev/null ;;
    "1000") ethtool -s "$ETH_INTERFACE" advertise 0x02f autoneg on 2>/dev/null ;;
    *)
        advertise=$(get_supported_advertise_hex)
        if [ -n "$advertise" ]; then
            ethtool -s "$ETH_INTERFACE" advertise "$advertise" autoneg on 2>/dev/null
        else
            ethtool -s "$ETH_INTERFACE" autoneg on 2>/dev/null
        fi
        ;;
esac

ethtool -r "$ETH_INTERFACE" 2>/dev/null
logger -t qmanager_eth_link "Applied speed limit: ${limit:-auto}"
```

**`/usr/bin/qmanager_eth_link_reset`:**
```sh
#!/bin/sh
[ -f /usr/lib/qmanager/ethtool_helper.sh ] && . /usr/lib/qmanager/ethtool_helper.sh
ETH_INTERFACE="eth0"
advertise=$(get_supported_advertise_hex)
if [ -n "$advertise" ]; then
    ethtool -s "$ETH_INTERFACE" advertise "$advertise" autoneg on 2>/dev/null
else
    ethtool -s "$ETH_INTERFACE" autoneg on 2>/dev/null
fi
ethtool -r "$ETH_INTERFACE" 2>/dev/null
logger -t qmanager_eth_link "Reset to auto speed"
```

**Daemon script changes required:**

1. **Replace UCI read** with `qm_config_get`:
   ```sh
   # Before:
   limit=$(uci get quecmanager.eth_link.speed_limit 2>/dev/null)
   # After:
   limit=$(qm_config_get eth_link speed_limit auto)
   ```

2. **Source `config.sh` and `ethtool_helper.sh` with guards.**

**Files needing source guard fix:**
- The current init.d sources `ethtool_helper.sh` at line 21 without a guard (`. /usr/lib/qmanager/ethtool_helper.sh`). The new wrapper uses `[ -f ] && .`.

**Dependencies:**
- No AT commands
- Needs `ethtool` installed (Entware)
- Needs `eth0` interface to exist

---

### 11. qmanager_low_power_check (Low Power Boot Check)

**Current implementation:**
- Non-procd, one-shot double-fork
- Reads UCI `quecmanager.settings.low_power_{enabled,start,end,days}` (4 values)
- Determines if boot occurred during a low power window
- If yes: sleeps 30s, then sends `AT+CFUN=0`
- Sources: `qlog.sh`
- No UCI writes

#### qmanager-low-power-check.service

```ini
# /etc/systemd/system/qmanager-low-power-check.service
[Unit]
Description=QManager Low Power Boot Check (One-Shot)
After=socat-smd7-from-ttyIN2.service qmanager-setup.service
PartOf=qmanager.target

[Service]
Type=oneshot
RemainAfterExit=no
ExecStart=/usr/bin/qmanager_low_power_check

[Install]
WantedBy=qmanager.target
```

**Daemon script changes required:**

1. **Replace all 4 UCI reads** with `qm_config_get`:
   ```sh
   # Before:
   enabled=$(uci -q get quecmanager.settings.low_power_enabled 2>/dev/null)
   start_time=$(uci -q get quecmanager.settings.low_power_start 2>/dev/null)
   end_time=$(uci -q get quecmanager.settings.low_power_end 2>/dev/null)
   days=$(uci -q get quecmanager.settings.low_power_days 2>/dev/null)

   # After:
   [ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh
   enabled=$(qm_config_get settings low_power_enabled 0)
   start_time=$(qm_config_get settings low_power_start "23:00")
   end_time=$(qm_config_get settings low_power_end "06:00")
   days=$(qm_config_get settings low_power_days "0,1,2,3,4,5,6")
   ```

2. **Source `config.sh` with guard** (add near line 12 after qlog source).

3. **Remove double-fork.** The current init.d spawns this daemon with double-fork. Under systemd `Type=oneshot`, the script runs directly. Remove any self-daemonization (the daemon script itself does not fork — the init.d did the forking).

**Files needing source guard fix:**
- `qlog.sh` source (line 12) — already guarded with `2>/dev/null || { ... }`
- NEW: `config.sh` source — use `[ -f ] && .` guard

**Dependencies:**
- `After=socat-smd7-from-ttyIN2.service` — sends `AT+CFUN=0` via `qcmd`
- Reads: `/etc/qmanager/qmanager.conf` (low power schedule config)
- Writes: `/tmp/qmanager_low_power_active`, `/tmp/qmanager_watchcat.lock`

---

## Shared Library Adaptations

### Libraries Requiring Changes

| Library | Change Needed | Reason |
|---------|---------------|--------|
| **`config.sh`** (NEW) | Create from scratch | UCI replacement helper — `qm_config_get`, `qm_config_set`, `qm_config_section` |
| **`dpi_helper.sh`** | Major rewrite | nftables -> iptables: `dpi_insert_rules()`, `dpi_remove_rules()`, `dpi_get_packet_count()` |
| **`vpn_firewall.sh`** | Major rewrite | nftables/fw4 -> iptables: zone create/remove + forwarding rules |
| **`ethtool_helper.sh`** | None | Portable — uses `ethtool` directly, no platform-specific code |

### Libraries Portable As-Is

| Library | Notes |
|---------|-------|
| **`qlog.sh`** | Fully portable — uses `date`, `wc`, `logger`. No platform-specific calls. |
| **`events.sh`** | Fully portable — NDJSON append with `jq`. No UCI/nftables. |
| **`parse_at.sh`** | Fully portable — pure AT response parsing with awk/sed. |
| **`cgi_base.sh`** | Needs review for auth mechanism differences (lighttpd vs uhttpd), but no UCI calls in the library itself. |
| **`cgi_auth.sh`** | Session management — may need path adjustments but no UCI. |
| **`cgi_at.sh`** | Fully portable — wrappers around `qcmd` (replaced in Phase 1). |
| **`tower_lock_mgr.sh`** | Mostly portable — reads/writes JSON config. Has `mtu_reapply_after_bounce()` which calls `ip link` (portable). |
| **`email_alerts.sh`** | Portable — reads JSON config, uses `curl` for SMTP. |
| **`profile_mgr.sh`** | Needs review — may contain UCI calls for reading profile state. |

### Source Guard Audit

Every daemon and library that sources another file must be checked for the safe pattern. Here is the complete audit:

| File | Source Statement | Guard Present? | Action Needed |
|------|-----------------|----------------|---------------|
| `qmanager_ping` (L25) | `. /usr/lib/qmanager/qlog.sh` | Yes (`2>/dev/null \|\| { ... }`) | None |
| `qmanager_poller` (L215) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_poller` (L234) | `. /usr/lib/qmanager/parse_at.sh` | Yes | None |
| `qmanager_poller` (L240) | `. /usr/lib/qmanager/events.sh` | Yes | None |
| `qmanager_poller` (L246) | `. /usr/lib/qmanager/email_alerts.sh` | Yes | None |
| `qmanager_watchcat` (L30) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_watchcat` (L40) | `. /usr/lib/qmanager/events.sh` | Yes | None |
| `qmanager_tower_failover` (L23) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_tower_failover` (L33) | `. /usr/lib/qmanager/tower_lock_mgr.sh` | Partial (`2>/dev/null` only) | Add `[ -f ] &&` |
| `qmanager_imei_check` (L25) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_imei_check` (L33) | `. /usr/lib/qmanager/cgi_at.sh` | **No** | Add `[ -f ] &&` guard |
| `qmanager_wan_guard` (L27) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_wan_guard` (L35) | `. /usr/lib/qmanager/cgi_at.sh` | **No** | Not ported, skip |
| `qmanager_low_power_check` (L12) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_low_power` (L18) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_dpi_verify` (L9) | `. /usr/lib/qmanager/qlog.sh` | **No** | Add `[ -f ] &&` guard |
| `qmanager_dpi_verify` (L10) | `. /usr/lib/qmanager/dpi_helper.sh` | **No** | Add `[ -f ] &&` guard |
| `qmanager_dpi_install` (L10) | `. /usr/lib/qmanager/qlog.sh` | **No** | Add `[ -f ] &&` guard |
| `qmanager_profile_apply` (L29) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| `qmanager_profile_apply` (L37) | `. /usr/lib/qmanager/cgi_at.sh` | **No** | Add `[ -f ] &&` guard |
| `qmanager_profile_apply` (L40) | `. /usr/lib/qmanager/profile_mgr.sh` | **No** | Add `[ -f ] &&` guard |
| `qcmd` (L17) | `. /usr/lib/qmanager/qlog.sh` | Yes | None |
| Init.d `qmanager_dpi` (L11-12) | `. /usr/lib/qmanager/qlog.sh` + `dpi_helper.sh` | **No** | N/A (init.d replaced) |
| Init.d `qmanager_eth_link` (L21) | `. /usr/lib/qmanager/ethtool_helper.sh` | **No** | N/A (init.d replaced) |

**Summary:** 7 source statements across daemon scripts need `[ -f ] &&` guards added. 2 init.d-only cases are moot (replaced by systemd units).

---

## Implementation Order

The services should be ported in dependency order, from foundational (no dependencies) to dependent (requires other services running).

### Wave 1: Foundation (No AT dependency)

| Priority | Service | Effort | Notes |
|----------|---------|--------|-------|
| 1.1 | **`config.sh`** (new library) | Medium | Must exist before any config-gated service. Write + test `qm_config_get`/`qm_config_set`. Create default `qmanager.conf`. |
| 1.2 | **`qmanager.target`** | Trivial | Grouping target — 3 lines. |
| 1.3 | **`qmanager-setup.service`** | Low | One-shot directory/permission setup. Port the inline logic. |
| 1.4 | **`qmanager-ping.service`** | Low | Zero changes to daemon. Write unit file only. |
| 1.5 | **`qmanager-ttl.service`** | Low | Trivial one-shot. Verify `rmnet+` interface in rules file. |

### Wave 2: Core AT Services

| Priority | Service | Effort | Notes |
|----------|---------|--------|-------|
| 2.1 | **`qmanager-poller.service`** | Low | Zero daemon changes. Unit file + dependency wiring. |
| 2.2 | **`qmanager-mtu.service`** | Low | Remove double-fork from daemon. |
| 2.3 | **`qmanager-eth-link.service`** | Low-Medium | Replace 1 UCI call, create apply/reset wrapper scripts. |
| 2.4 | **`qmanager-imei-check.service`** | Low | Add source guard, remove sleep, verify AT timing. |
| 2.5 | **`qmanager-low-power-check.service`** | Low-Medium | Replace 4 UCI calls. |

### Wave 3: Optional/Conditional Services

| Priority | Service | Effort | Notes |
|----------|---------|--------|-------|
| 3.1 | **`qmanager-watchcat.service`** | Medium | Replace 12 UCI calls (10 reads + 1 write + 1 init guard). |
| 3.2 | **`qmanager-tower-failover.service`** | Low | No UCI. Remove double-fork, add source guard. |
| 3.3 | **`qmanager-bandwidth.service`** (stack) | Medium | 3 unit files. Rewrite genconf UCI reads. Cross-compile binary. |
| 3.4 | **`qmanager-dpi.service`** | High | Rewrite `dpi_helper.sh` (nftables -> iptables). Create 3 wrapper scripts. |

### Wave 4: Verification & Integration

| Priority | Task | Effort | Notes |
|----------|------|--------|-------|
| 4.1 | CGI scripts: batch update UCI calls | High | Separate Phase 3 work, but test basic CGI reads/writes here. |
| 4.2 | End-to-end boot test | Medium | Full power cycle, verify all services start in order. |
| 4.3 | CGI enable/disable flows | Medium | Verify `systemctl start/stop` from CGI endpoints works. |

### Skip List

| Service | Reason |
|---------|--------|
| `qmanager_wan_guard` | OpenWRT-specific (netifd/UCI network). No equivalent on RM520N-GL. |

---

## Testing Strategy

### Per-Service Validation

For each service, validate in this order:

1. **Unit file syntax:** `systemd-analyze verify /etc/systemd/system/qmanager-<name>.service`
2. **Dependency check:** `systemctl list-dependencies qmanager-<name>.service` — verify all `After=` and `Wants=` are correct
3. **Start/stop cycle:** `systemctl start qmanager-<name> && systemctl status qmanager-<name>` — check for clean start, no errors in journal
4. **Journal output:** `journalctl -u qmanager-<name> --no-pager -n 50` — verify log output via qlog
5. **Config gating:** For config-gated services, test both enabled and disabled states

### Core Services (Ping + Poller)

```bash
# Start core services
systemctl start qmanager-setup qmanager-ping qmanager-poller

# Verify ping daemon is writing data
cat /tmp/qmanager_ping.json  # Should have reachable, latency, timestamp

# Verify poller is writing cache
cat /tmp/qmanager_status.json | jq '.device.imei'  # Should return IMEI

# Verify AT commands work through poller
journalctl -u qmanager-poller --no-pager -n 20 | grep -i error  # Should be clean
```

### Watchcat Validation

```bash
# Enable watchcat in config
cat /etc/qmanager/qmanager.conf | jq '.watchcat.enabled'  # Should be 1

# Start and verify
systemctl start qmanager-watchcat
systemctl status qmanager-watchcat  # Should be active (running)

# Verify state file
cat /tmp/qmanager_watchcat.json | jq '.state'  # Should be "monitor"

# Test config reload
qm_config_set watchcat check_interval 5
kill -HUP $(pidof qmanager_watchcat)  # Or touch reload flag
```

### DPI Service Validation

```bash
# Enable video optimizer in config
# (using jq to modify config directly for testing)

# Start service
systemctl start qmanager-dpi

# Verify nfqws is running
pidof nfqws  # Should return PID

# Verify iptables rules
iptables -t mangle -L POSTROUTING -v -n | grep qmanager_dpi  # Should show rules

# Stop and verify cleanup
systemctl stop qmanager-dpi
iptables -t mangle -L POSTROUTING -v -n | grep qmanager_dpi  # Should be empty
```

### TTL/MTU Validation

```bash
# Create test TTL rules file
cat > /etc/firewall.user.ttl << 'EOF'
iptables -t mangle -A POSTROUTING -o rmnet+ -j TTL --ttl-set 65
EOF

# Start TTL service
systemctl start qmanager-ttl

# Verify rules applied
iptables -t mangle -L POSTROUTING -v -n | grep TTL  # Should show rule

# MTU — create test file
echo 'ip link set rmnet_data0 mtu 1420' > /etc/firewall.user.mtu

# Start MTU service
systemctl start qmanager-mtu
ip link show rmnet_data0 | grep mtu  # Should show 1420 (after interface comes up)
```

### Full Boot Sequence Test

```bash
# Enable all services
systemctl enable qmanager.target qmanager-ping qmanager-poller qmanager-ttl qmanager-mtu qmanager-eth-link

# Reboot device
reboot

# After boot, verify all services are running
systemctl status qmanager.target
systemctl list-units 'qmanager-*' --all

# Verify boot ordering
systemd-analyze critical-chain qmanager-poller.service
# Should show: socat-smd7-from-ttyIN2.service → ql-netd.service → ...
```

### CGI Integration Test

```bash
# Test that CGI can start/stop services
# (simulate what the watchdog CGI endpoint would do)
curl -s http://localhost/cgi-bin/quecmanager/monitoring/watchdog.sh?action=start

# Verify service state changed
systemctl is-active qmanager-watchcat  # Should be active
```

### Rollback Plan

If a service fails to convert properly:

1. The daemon scripts are backwards-compatible — they run identically under `systemd` or as standalone scripts
2. Any service can be disabled (`systemctl disable qmanager-<name>`) without affecting others
3. The `qmanager.target` groups all services but does not create hard dependencies between them
4. To fall back to manual daemon start: `systemctl stop qmanager-<name> && /usr/bin/qmanager_<name> &`

---

## Appendix: File Inventory

### New Files to Create

| File | Type | Purpose |
|------|------|---------|
| `/usr/lib/qmanager/config.sh` | Shared library | UCI replacement helper |
| `/etc/qmanager/qmanager.conf` | Config (JSON) | Replaces `/etc/config/quecmanager` |
| `/etc/qmanager/environment` | Environment file | `QLOG_LEVEL=INFO` |
| `/usr/bin/qmanager_setup` | Shell script | Directory/permission one-shot |
| `/usr/bin/qmanager_dpi_run` | Shell script | DPI start wrapper (builds args, inserts rules, exec nfqws) |
| `/usr/bin/qmanager_dpi_start_check` | Shell script | DPI pre-start validation |
| `/usr/bin/qmanager_dpi_stop` | Shell script | DPI cleanup (remove rules) |
| `/usr/bin/qmanager_eth_link_apply` | Shell script | Ethtool apply wrapper |
| `/usr/bin/qmanager_eth_link_reset` | Shell script | Ethtool reset wrapper |
| `/etc/systemd/system/qmanager.target` | Systemd target | Grouping target for all QManager services |
| `/etc/systemd/system/qmanager-setup.service` | Systemd unit | Permission/directory setup |
| `/etc/systemd/system/qmanager-ping.service` | Systemd unit | Ping daemon |
| `/etc/systemd/system/qmanager-poller.service` | Systemd unit | Poller daemon |
| `/etc/systemd/system/qmanager-watchcat.service` | Systemd unit | Watchdog daemon |
| `/etc/systemd/system/qmanager-bandwidth.target` | Systemd target | Bandwidth monitor grouping |
| `/etc/systemd/system/qmanager-bandwidth-genconf.service` | Systemd unit | Genconf one-shot |
| `/etc/systemd/system/qmanager-bandwidth-websocat.service` | Systemd unit | WebSocket server |
| `/etc/systemd/system/qmanager-bandwidth-monitor.service` | Systemd unit | Traffic monitor binary |
| `/etc/systemd/system/qmanager-dpi.service` | Systemd unit | DPI evasion service |
| `/etc/systemd/system/qmanager-tower-failover.service` | Systemd unit | Tower lock failover |
| `/etc/systemd/system/qmanager-imei-check.service` | Systemd unit | IMEI rejection check |
| `/etc/systemd/system/qmanager-ttl.service` | Systemd unit | TTL/HL persistence |
| `/etc/systemd/system/qmanager-mtu.service` | Systemd unit | MTU persistence |
| `/etc/systemd/system/qmanager-eth-link.service` | Systemd unit | Ethernet link speed |
| `/etc/systemd/system/qmanager-low-power-check.service` | Systemd unit | Low power boot check |

### Existing Files to Modify

| File | Changes |
|------|---------|
| `qmanager_watchcat` | Source `config.sh`, replace 12 UCI calls |
| `qmanager_low_power_check` | Source `config.sh`, replace 4 UCI calls |
| `qmanager_bandwidth_genconf` | Source `config.sh`, replace 5 UCI calls |
| `qmanager_tower_failover` | Add `[ -f ]` guard for `tower_lock_mgr.sh` source |
| `qmanager_imei_check` | Add `[ -f ]` guard for `cgi_at.sh` source |
| `qmanager_profile_apply` | Add `[ -f ]` guard for `cgi_at.sh` and `profile_mgr.sh` sources |
| `qmanager_dpi_verify` | Add `[ -f ]` guard for `qlog.sh` and `dpi_helper.sh` sources; replace 1 UCI call |
| `qmanager_dpi_install` | Add `[ -f ]` guard for `qlog.sh` source |
| `dpi_helper.sh` | Rewrite nftables functions to iptables |
| `vpn_firewall.sh` | Rewrite fw4/UCI firewall to iptables |

### Files NOT Modified (Portable As-Is)

| File | Reason |
|------|--------|
| `qmanager_ping` | No UCI, safe source guards, portable |
| `qmanager_poller` | No UCI, safe source guards, portable |
| `qmanager_mtu_apply` | No UCI, uses `ip link` (portable) |
| `qlog.sh` | Portable logging library |
| `events.sh` | Portable NDJSON event system |
| `parse_at.sh` | Portable AT response parser |
| `cgi_at.sh` | Portable `qcmd` wrappers |
| `email_alerts.sh` | Portable (reads JSON config, uses curl) |
| `tower_lock_mgr.sh` | Portable (reads JSON config) |
| `ethtool_helper.sh` | Portable (uses ethtool directly) |
