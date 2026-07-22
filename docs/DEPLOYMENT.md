# QManager Deployment Guide

This document covers building, installing, and deploying QManager to the Quectel RM520N-GL modem.

---

## Quick Install (Recommended)

ADB or SSH into the modem and run the one-liner installer:

```bash
curl -fsSL -o /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

The interactive installer fetches the latest release tarball, verifies the SHA-256 checksum, bootstraps Entware (if needed), installs lighttpd and required modules, deploys the frontend and backend, configures systemd services, and optionally sets up SSH (dropbear). A reboot is triggered after installation.

See `install_rm520n.sh --help` for all flags (`--skip-packages`, `--force`, etc.)

### Manual / Offline Install

If internet access is unavailable on the modem, build and transfer the tarball from your dev machine:

> ℹ️ NOTE: When cutting a real release, set `QM_RELEASE_TAG` to the git tag being pushed (e.g. `QM_RELEASE_TAG=v0.1.14 bun run package`) — `build.sh` then hard-fails if `package.json`'s version doesn't match (draft-aware, leading `v` normalized), so a forgotten version bump can't ship a mislabeled tarball. Dev builds leave `QM_RELEASE_TAG` unset and skip the check.

```bash
# 1. Build the package (frontend + backend + dependencies)
bun run package

# 2. Transfer to device (use -O for RM520N-GL dropbear, which lacks sftp-server)
scp -O qmanager-*.tar.gz root@192.168.225.1:/tmp/

# 3. Extract and install on device
ssh root@192.168.225.1
cd /tmp && tar xzf qmanager-*.tar.gz
# Run via absolute path — don't `cd` into the staging dir; it's disposable
# (/tmp is tmpfs, and the OTA updater deletes it), so keep your shell elsewhere.
bash /tmp/qmanager_install/install_rm520n.sh
```

The installer will:
- Bootstrap Entware from `bin.entware.net` if not present
- Install lighttpd + modules, sudo, jq, and coreutils-timeout from Entware
- Deploy frontend, backend scripts, CGI endpoints, and systemd service units
- Strip CRLF from all deployed shell scripts, systemd units, and sudoers rules
- Configure sudoers rules for `www-data` privilege escalation
- Enable and start all QManager systemd services

See `bash install_rm520n.sh --help` for all options (`--skip-packages`, `--force`, etc.)

---

## Prerequisites

### Development Machine

- [Bun](https://bun.sh/) — Package manager and runtime
- Git
- A text editor that preserves LF line endings (VS Code, Vim, etc.)

### Target Device

- Quectel RM520N-GL modem with RGMII Ethernet connectivity
- ADB or SSH access to the modem's internal Linux OS (SDXLEMUR, ARMv7l)
- Internet access on the modem (for Entware bootstrap and package install — non-fatal if offline, packages are skipped with warnings)
- Writable `/usrdata/` partition (persistent storage)

---

## Building the Frontend

### Development Build

```bash
cd QManager
bun install
bun run dev
```

Opens at `http://localhost:3000`. API requests are proxied to `http://192.168.224.1` (the modem's IP).

To change the proxy target, edit `next.config.ts`:

```typescript
destination: "http://192.168.224.1/cgi-bin/:path*",
// or for Tailscale:
// destination: "http://your-device.ts.net/cgi-bin/:path*",
```

### Production Build

```bash
bun run build
```

This produces a static export in the `out/` directory. The output is a complete, self-contained frontend that requires no server-side rendering.

**Important:** The `rewrites()` block in `next.config.ts` is only used in development. In production, the browser makes direct requests to the device's CGI endpoints.

### Build Output

```
out/
├── index.html          # Redirects to /dashboard/
├── dashboard/
│   └── index.html
├── login/
│   └── index.html
├── cellular/
│   ├── index.html
│   ├── settings/
│   ├── cell-locking/
│   ├── cell-scanner/
│   ├── custom-profiles/
│   └── sms/
├── local-network/
│   └── ...
├── monitoring/
│   └── ...
├── _next/
│   ├── static/         # JS bundles, CSS, fonts
│   └── ...
└── ...
```

---

## Deploying to the RM520N-GL

The installer (`install_rm520n.sh`) handles all deployment steps. Manual file-by-file deployment is not recommended. Use `bun run package` to produce the tarball, then run the installer on the device as described in [Quick Install](#quick-install-recommended).

### Verifying Installation

```bash
# Check all QManager services are running
systemctl list-units 'qmanager-*'

# Check the poller is producing data
jq .timestamp /tmp/qmanager_status.json

# Check CGI endpoints are accessible
curl -k https://localhost/cgi-bin/quecmanager/at_cmd/fetch_data.sh

# Check installer log (if install just ran)
tail -50 /tmp/qmanager_install.log

# Check installed version
cat /etc/qmanager/VERSION
```

---

## Directory Structure on Device

```
/usrdata/qmanager/www/
├── index.html              # Frontend entry point
├── _next/                  # Frontend assets (JS, CSS, fonts)
├── dashboard/              # Frontend pages
├── cellular/
├── monitoring/
├── local-network/
├── login/
├── about-device/
├── support/
└── cgi-bin/
    └── quecmanager/        # CGI API endpoints
        ├── auth/
        ├── at_cmd/
        ├── bands/
        ├── cellular/
        ├── device/
        ├── frequency/
        ├── monitoring/
        ├── network/
        ├── profiles/
        ├── scenarios/
        ├── system/
        ├── tower/
        └── vpn/

/usr/bin/
├── qcmd                    # AT command wrapper
├── qmanager_update         # OTA update worker (runs as root via sudoers)
├── qmanager_auto_update    # Automatic update checker daemon
├── qmanager_poller         # Main data collector
├── qmanager_ping           # Ping daemon
├── qmanager_watchcat       # Connection watchdog
├── qmanager_profile_apply  # Profile apply daemon
├── qmanager_cell_scanner   # Cell scanner
├── qmanager_neighbour_scanner
├── qmanager_band_failover
├── qmanager_tower_failover
├── qmanager_tower_schedule
├── qmanager_mtu_apply
├── qmanager_imei_check
├── qmanager_setup          # Boot one-shot (permissions, pre-create /tmp files)
└── qmanager_logread

/usr/lib/qmanager/
├── cgi_base.sh             # CGI boilerplate (sources platform.sh)
├── cgi_auth.sh             # Session management
├── cgi_at.sh               # AT command helpers
├── platform.sh             # systemd/sudo abstraction (svc_*, pid_alive, etc.)
├── qlog.sh                 # Logging library
├── parse_at.sh             # AT response parsers
├── semver.sh               # Shared semver_compare() — sourced by update CGI and auto_update
├── events.sh               # Event detection
├── profile_mgr.sh          # Profile CRUD
├── tower_lock_mgr.sh       # Tower lock management
├── email_alerts.sh         # Email alert logic
└── sms_alerts.sh           # SMS alert logic

/lib/systemd/system/
├── qmanager-firewall.service
├── qmanager-setup.service
├── qmanager-poller.service
├── qmanager-ping.service
├── qmanager-console.service
├── qmanager-watchcat.service
├── qmanager-ttl.service
├── qmanager-mtu.service
├── qmanager-imei-check.service
└── qmanager-tower-failover.service

/etc/qmanager/             # Persistent configuration
├── VERSION                # Installed version (written atomically at install end)
├── VERSION.pending        # Present during install; mv'd to VERSION on success
├── shadow                 # Password hash
├── profiles/              # Custom SIM profiles
├── tower_lock.json
├── band_lock.json
├── imei_backup.json
├── last_iccid
└── msmtprc                # Email SMTP config (no logfile directive)

/etc/sudoers.d/qmanager    # www-data privilege escalation rules (includes qmanager_update)

/tmp/                      # Runtime state (lost on reboot)
├── qmanager_status.json
├── qmanager_signal_history.json
├── qmanager_ping_history.json
├── qmanager_events.json
├── qmanager_ping.json
├── qmanager_watchcat.json
├── qmanager_watchcat.lock # Touched during install/low-power to pause watchdog
├── qmanager_update.log    # OTA update worker log (root-owned)
├── qmanager_install.log   # Installer log (step progress for UI streaming)
├── qmanager_sessions/
└── qmanager.log
```

---

## Line Ending Enforcement

**Critical:** All shell scripts must have LF line endings. CRLF breaks scripts silently on the RM520N-GL (the `#!/bin/sh` BusyBox `ash` interpreter treats a trailing `\r` as part of the command).

### Prevention

The `.gitattributes` file enforces LF:
```
scripts/**/*.sh text eol=lf
scripts/etc/init.d/* text eol=lf
scripts/usr/bin/* text eol=lf
```

### Checking

```bash
# Check for CRLF in scripts
file scripts/usr/bin/* | grep CRLF
file scripts/etc/init.d/* | grep CRLF
find scripts -name "*.sh" -exec file {} \; | grep CRLF
```

### Fixing

```bash
# Convert CRLF to LF
sed -i 's/\r$//' scripts/usr/bin/*
sed -i 's/\r$//' scripts/etc/init.d/*
find scripts -name "*.sh" -exec sed -i 's/\r$//' {} \;
```

---

## Troubleshooting

### CGI Returns Empty Response

1. **Check line endings** — CRLF is the #1 cause of silent CGI failures
2. **Check permissions** — CGI scripts need `chmod +x`
3. **Check syntax** — Run `sh -n /www/cgi-bin/quecmanager/<script>.sh`
4. **Check logs** — `cat /tmp/qmanager.log | tail -50`

### Poller Not Producing Data

```bash
# Check if poller is running
ps | grep qmanager_poller

# Check if modem serial port is accessible
ls -la /dev/smd7  # or /dev/ttyUSB2

# Test AT command
qcmd 'AT+QENG="servingcell"'

# Check poller logs
grep "poller" /tmp/qmanager.log
```

### Authentication Issues

```bash
# Reset password (run on device)
/usr/bin/qmanager_reset_password

# Check session directory
ls /tmp/qmanager_sessions/

# Check shadow file
ls -la /etc/qmanager/shadow
```

### Service Won't Start

```bash
# Check service status and logs (systemd — units in /lib/systemd/system/)
systemctl status qmanager-poller
journalctl -u qmanager-poller --no-pager | tail -50

# Start it manually (boot persistence is a multi-user.target.wants/ symlink;
# `systemctl enable` does NOT work on this platform)
systemctl start qmanager-poller

# Verify dependencies
which jq        # Required
which qcmd      # Required
which msmtp     # Optional (email only)
which ethtool   # Optional (ethernet only)
```

---

## Updating

### OTA Update (v0.1.5+)

From v0.1.5 onward, updates are fully self-contained via the web UI: **System Settings → Software Update**. The UI checks for new releases, downloads and verifies the tarball, runs the installer, and reboots — no SSH required.

**Update worker flow:**

1. The `update.sh` CGI invokes `/usr/bin/qmanager_update` via `sudo -n` (sudoers rule: `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_update`)
2. The worker downloads, verifies (`tar tzf` + grep for `install_rm520n.sh`), and runs the installer
3. The CGI's spawn-line redirects to `/dev/null 2>&1` — the worker creates `/tmp/qmanager_update.log` as root, avoiding `fs.protected_regular=1` blocking root from truncating a www-data-owned log file
4. The installer writes `=== Step N/M: <label> ===` lines to `/tmp/qmanager_install.log`; the worker tails this file and mirrors progress into the status JSON for UI step-streaming
5. On completion, `finalize_version()` moves `/etc/qmanager/VERSION.pending` → `/etc/qmanager/VERSION`

**OTA status values:** `idle` → `checking` → `update_available` → `downloading` → `verifying` → `ready` → `installing` → `rebooting` / `error`

**Rollback:** If `/etc/qmanager/VERSION.pending` exists after reboot, the previous install did not finalize. The update CGI GET response includes `previous_install_failed: true` and `pending_version: "<version>"` when this file is present, allowing the UI to offer rollback.

> **Bootstrap caveat:** The v0.1.4 → v0.1.5 upgrade requires ADB or SSH because v0.1.4's CGI has no sudo and v0.1.4's sudoers has no `qmanager_update` rule. From v0.1.5 onward, OTA works via the UI.

### Manual Update (SSH)

```bash
# Transfer updated tarball
scp -O qmanager-*.tar.gz root@192.168.225.1:/tmp/

# Extract and run installer (handles stop/deploy/start/cleanup)
ssh root@192.168.225.1
cd /tmp && tar xzf qmanager-*.tar.gz
# Run via absolute path — don't `cd` into the staging dir; it's disposable
# (/tmp is tmpfs, and the OTA updater deletes it), so keep your shell elsewhere.
bash /tmp/qmanager_install/install_rm520n.sh
```

The installer is idempotent — re-running updates rather than duplicates. It handles:
- Stopping existing services (filesystem-driven scan of `/lib/systemd/system/qmanager-*.service`, batched into a single `systemctl stop` call so systemd shuts them down in parallel; long-running daemons set `TimeoutStopSec=10` so a wedged service caps the wait at 10s instead of systemd's 90s default)
- Removing orphaned daemons/units/libs not present in the current source tree (`cleanup_legacy_scripts`)
- Removing conflicting packages (`socat`, `socat-at-bridge`) even with `--skip-packages`
- Re-enabling services (symlink-gated: services are only re-enabled if their `multi-user.target.wants/` symlink existed pre-upgrade — no UCI involved on this platform)
- AT stack health check (3× `qcmd 'ATI'` retries, warn-only) and poller health check after completion

---

## Uninstalling

```bash
# Interactive (prompts for confirmation)
bash /tmp/qmanager_install/uninstall_rm520n.sh

# Skip confirmation prompt (non-interactive / scripted)
bash /tmp/qmanager_install/uninstall_rm520n.sh --force

# Skip automatic reboot after uninstall
bash /tmp/qmanager_install/uninstall_rm520n.sh --no-reboot

# Also remove config/profiles/passwords and Tailscale
bash /tmp/qmanager_install/uninstall_rm520n.sh --purge
```

The uninstaller:
- Scans `/lib/systemd/system/qmanager-*.service` and `/usr/bin/qmanager_*` at runtime — no hardcoded service list
- Stops and disables all discovered QManager services
- Removes frontend, CGI scripts, daemons, shared libraries, systemd units, sudoers rules, and udev rules
- Removes the web console (`/usrdata/qmanager/console/`) by default
- With `--purge`: also tears down Tailscale (stops `tailscaled`, removes unit, removes `/usrdata/tailscale/` and symlinks)
- Cleans up `/etc/qmanager/VERSION.pending` and `/etc/qmanager/updates/previous_version`
- **Entware (`/opt/`) is always preserved** even with `--purge` — remove it manually if needed

---

## Troubleshooting

### Installer / Update Failures

**`VERSION.pending` exists after reboot:**
The installer writes `/etc/qmanager/VERSION.pending` early and only moves it to `/etc/qmanager/VERSION` at the very end. If the modem rebooted mid-install, `VERSION.pending` survives. The update CGI GET response will include `"previous_install_failed": true` and `"pending_version": "<version>"`. Use the UI rollback option or re-run the installer manually.

**`fs.protected_regular=1` — log truncation failures:**
The kernel's sticky directory protection (`fs.protected_regular=1`) blocks a process from truncating a file in `/tmp` that was created by a different user. The OTA worker (`qmanager_update`) works around this by doing `rm -f $LOG_FILE` before creating a fresh log — never truncating an existing file. CGI scripts that need to write `/tmp` files should pre-create them with the correct ownership in `qmanager_setup` (boot one-shot).

**Socat conflict blocks AT transport:**
If `socat` or `socat-at-bridge` services are running, `atcli_smd11` cannot open `/dev/smd11`. The installer actively removes these packages (`opkg remove socat socat-at-bridge`) with retry through `--force-removal-of-dependent-packages`. This runs even with `--skip-packages`.

### CGI Returns Empty Response

1. Check line endings — CRLF causes silent CGI failures (installer strips `\r` automatically; check manually with `file /usr/lib/qmanager/*.sh`)
2. Check permissions — CGI scripts need `chmod +x`
3. Check PATH — lighttpd CGI has a minimal PATH; `cgi_base.sh` exports the full PATH including `/opt/bin`
4. Check logs — `tail -50 /tmp/qmanager.log`

### Poller Not Producing Data

```bash
# Check if poller is running
systemctl status qmanager-poller

# Test AT command directly
qcmd 'ATI'

# Check /dev/smd11 permissions (should be crw-rw---- root:dialout)
ls -la /dev/smd11

# Check poller logs
grep "poller" /tmp/qmanager.log
```

### Service Won't Start

```bash
# Check systemd status and journal
systemctl status qmanager-poller
journalctl -u qmanager-poller --no-pager -n 50

# Verify dependencies
command -v qcmd
command -v jq
ls /usr/lib/qmanager/cgi_base.sh
```

### Authentication Issues

```bash
# Reset password (run on device as root)
/usr/bin/qmanager_reset_password

# Check session directory
ls /tmp/qmanager_sessions/
```

---

## Sudoers Rules

QManager's sudoers file (`/etc/sudoers.d/qmanager`) grants `www-data` the following:

```
# OTA update worker
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_update

# Service control
www-data ALL=(root) NOPASSWD: /bin/systemctl start *, /bin/systemctl stop *, /bin/systemctl restart *, /bin/systemctl is-active *

# Boot persistence (symlink-based — systemctl enable doesn't work)
www-data ALL=(root) NOPASSWD: /bin/ln -sf /lib/systemd/system/qmanager*.service ...
www-data ALL=(root) NOPASSWD: /bin/rm -f /lib/systemd/system/multi-user.target.wants/qmanager*.service

# Firewall, reboot, schedule-timer arming, SSH password
www-data ALL=(root) NOPASSWD: /usr/sbin/iptables, /usr/sbin/iptables-restore, /usr/sbin/ip6tables, /usr/sbin/ip6tables-restore
www-data ALL=(root) NOPASSWD: /sbin/reboot
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_scheduled_reboot_arm
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_tower_schedule_arm
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_set_ssh_password
```

> **Note:** All sudoers commands use full absolute paths — Entware's sudo has a restricted `secure_path` that excludes `/sbin/` and `/usr/bin/`. Bare command names will fail silently from CGI context.

---

## RM520N-GL Platform Summary

QManager runs directly on the modem's internal Linux OS — no external OpenWRT router required. Key platform facts:

| Concern | Value |
|---------|-------|
| Platform | Quectel RM520N-GL (SDXLEMUR, ARMv7l, kernel 5.4.210) |
| Init system | systemd (units in `/lib/systemd/system/`) |
| Root filesystem | Read-only by default (`mount -o remount,rw /` when needed) |
| Persistent storage | `/usrdata/` partition |
| Web server | lighttpd (Entware) |
| AT transport | `atcli_smd11` on `/dev/smd11` directly (no socat bridge) |
| Config store | Files in `/etc/qmanager/` (rootfs, remounted rw) |
| Firewall | iptables direct |
| `systemctl enable` | Does NOT work — use direct symlinks into `multi-user.target.wants/` |

> **See also:** [RM520N-GL Architecture Report](rm520n-gl-architecture.md) for the complete platform analysis.
