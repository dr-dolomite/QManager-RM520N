# QManager

<div align="center">
  <img src="public/qmanager-logo.svg" alt="QManager Logo" width="120" />
  <h3>A modern, custom GUI for Quectel modem management</h3>
  <p>Visualize, configure, and optimize your cellular modem's performance with an intuitive web interface</p>

  ![Version](https://img.shields.io/badge/version-v0.1.4-blue?style=flat-square)
  ![License](https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-green?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-RM520N--GL-orange?style=flat-square)
  ![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square)
  ![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square)
</div>

---

> **Note:** QManager is the successor to [SimpleAdmin](https://github.com/dr-dolomite/simpleadmin-mockup), rebuilt from the ground up with a modern tech stack and improved user experience. This branch targets the **Quectel RM520N-GL** modem running its internal Linux OS (SDXLEMUR, ARMv7l, kernel 5.4.180).

---

## Features

### Signal & Network Monitoring
- **Live Signal Dashboard** — Real-time RSRP, RSRQ, SINR with per-antenna values (4x4 MIMO) and 30-minute historical charts
- **Antenna Statistics** — Per-port signal breakdown with quality indicators for all 4 antenna ports
- **Antenna Alignment** — 3-position recording tool that compares composite signal scores to recommend best antenna placement
- **Network Events** — Automatic detection of band changes, cell handoffs, carrier aggregation changes, and connectivity events
- **Latency Monitoring** — Real-time ping with 24-hour history, jitter, packet loss, and aggregated views (hourly/12h/daily)
- **Traffic Statistics** — Live throughput (Mbps) and cumulative data usage

### Cellular Configuration
- **Band Locking** — Select and lock specific LTE/NR bands for optimal performance, with automatic band failover
- **Tower Locking** — Lock to a specific cell tower by PCI, with automatic failover and scheduled changes
- **Frequency Locking** — Lock to exact EARFCN/ARFCN channels
- **APN Management** — Create, edit, delete APN profiles with MNO presets (T-Mobile, AT&T, Verizon, etc.)
- **Custom SIM Profiles** — Save complete configurations (APN + TTL/HL + optional IMEI) per SIM, with auto-apply on SIM swap
- **Connection Scenarios** — Save and restore full network configuration snapshots
- **Network Priority** — Configure preferred network types and selection modes
- **Cell Scanner** — Active and neighbor cell scanning with signal comparison
- **Frequency Calculator** — EARFCN/ARFCN to frequency conversion tool
- **SMS Center** — Send and receive SMS messages directly from the interface
- **IMEI Settings** — Read, backup, and modify device IMEI, plus IMEI Generator & Validator (Luhn algorithm, TAC presets, imei.info lookup)
- **FPLMN Management** — View and manage the Forbidden PLMN list
- **MBN Configuration** — Select and activate modem broadband configuration files

### Network Settings
- **TTL/HL Settings** — IPv4 TTL and IPv6 Hop Limit configuration (iptables-based)
- **MTU Configuration** — Dynamic MTU application for rmnet interfaces
- **IP Passthrough** — Direct IP assignment to downstream devices

### VPN & Remote Access
- **Tailscale VPN** — One-click install, connect, and manage Tailscale mesh VPN directly from the UI; peer table, health warnings, boot persistence
- **Port Firewall** — Built-in firewall restricting web UI (80/443) to trusted interfaces; Tailscale-aware, enabled by default

### Reliability & Monitoring
- **Connection Watchdog** — 4-tier auto-recovery: AT+COPS deregister/reregister -> CFUN toggle -> SIM failover -> full reboot (with token bucket rate limiting)
- **Email Alerts** — Downtime notifications via Gmail SMTP (msmtp), sent on recovery with duration details
- **SMS Alerts** — Downtime and recovery notifications delivered over the cellular control channel via `sms_tool`; reaches you even while the data link is offline. Registration-guarded retry with dedup collapse, threshold-based suppression of transient blips, bounded failure logging
- **Low Power Mode** — Scheduled CFUN power-down windows via cron
- **Software Updates** — In-app OTA update checking, download, verification, installation, and rollback
- **System Logs** — Centralized log viewer with search

### Interface
- **Dark/Light Mode** — Full theme support with OKLCH perceptual color system
- **Responsive Design** — Works on desktop monitors and tablets in the field
- **Cookie-Based Auth** — Secure session management with rate limiting
- **Web Console** — Browser-based terminal (ttyd) integrated into the UI with connection status, fullscreen mode, and dark theme
- **AT Terminal** — Direct AT command interface for advanced users
- **Initial Setup Wizard** — Guided onboarding for first-time configuration

---

## Prerequisites

- A **Quectel RM520N-GL** modem with RGMII Ethernet connectivity
- **Entware** installed at `/opt` (the installer will bootstrap Entware automatically if not present, but internet access is required)
- **ADB** or **SSH** access to the modem

> **Note:** QManager is fully independent — it does **not** require SimpleAdmin or the RGMII Toolkit to be pre-installed. The installer handles everything: Entware bootstrap, lighttpd, user/group creation, and service setup.

---

## Quick Install

ADB or SSH into the modem and run:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

The interactive installer fetches the latest release, verifies the SHA-256 checksum, bootstraps Entware (if needed), installs lighttpd, deploys the QManager frontend and backend, configures systemd services, and optionally sets up SSH (dropbear). Bundled dependencies (`atcli_smd11`, `sms_tool`, `jq`, `dropbear`) are installed automatically. The SSH root password is automatically set to match the web UI password during first-time onboarding. A reboot is triggered after installation.

### Upgrading

From v0.1.1+, go to **System Settings -> Software Update** and use the built-in update flow -- download, verify, and install without SSH. Rollback to the previous version is available if needed.

### Uninstalling

```sh
# SSH into the modem
bash /tmp/qmanager_install/uninstall_rm520n.sh

# To also remove config/profiles/passwords:
bash /tmp/qmanager_install/uninstall_rm520n.sh --purge
```

---

## Additional Dependencies

- **Bundled with installer:** `atcli_smd11` (Rust reimplementation from [1alessandro1/atcli_rust](https://github.com/1alessandro1/atcli_rust), static ARMv7, AT command transport via `/dev/smd11`, works across RM502/RM520/RM521/RM551), `sms_tool` (ARM binary, SMS send/recv/delete with multi-part reassembly), `jq` (Entware package), `dropbear` (SSH server)
- **Downloaded during install:** `speedtest` (Ookla Speedtest CLI, ARMv7 armhf — downloaded from `install.speedtest.net`)
- **Installed from Entware:** `lighttpd` + `lighttpd-mod-openssl`, `sudo`, `coreutils-timeout`
- **Optional:** `msmtp` (email alerts) -- can be installed from within the app

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript 5 |
| **Styling** | Tailwind CSS v4, OKLCH colors, Euclid Circular B + Manrope |
| **Components** | shadcn/ui (42+ components), Recharts, React Hook Form + Zod |
| **Backend** | Shell scripts (Bash), CGI endpoints via lighttpd |
| **AT Commands** | `qcmd` wrapper with `atcli_smd11` on `/dev/smd11` (direct, no socat) |
| **Init System** | systemd (`.service` units in `/lib/systemd/system/`) |
| **Package Manager** | Bun (development), Entware opkg (device) |

---

## Architecture

```
Browser --- authFetch() --- lighttpd --- CGI Scripts --- qcmd --- atcli_smd11 --- /dev/smd11 --- Modem
                |                  |                       |
                |          Shell Libraries (12)      flock serialization
                |
        reads /tmp/qmanager_status.json
                |
         qmanager_poller
       (tiered polling: 2s/10s/30s)
```

The frontend is a statically-exported Next.js app served by lighttpd from `/usrdata/qmanager/www`. The backend is shell scripts running on the modem's internal Linux -- CGI endpoints for API requests and systemd-managed daemons for data collection.

**Key Data Flow:**

- **Poller daemon** queries the modem via AT commands every 2-30s (3 tiers) and writes a JSON cache file
- **CGI endpoints** (63 scripts) read the cache for GET requests, execute AT commands for POST requests
- **React hooks** (31 custom hooks) poll the CGI layer and provide loading/error/staleness states
- **AT transport** uses `atcli_smd11` on `/dev/smd11` directly (no socat PTY bridge needed)

**Platform Details:**

| Concern | RM520N-GL |
|---------|-----------|
| OS | Vanilla Linux (SDXLEMUR, ARMv7l, kernel 5.4.180) |
| Init | systemd |
| Root FS | Read-only by default (remounted RW when needed) |
| Persistent storage | `/usrdata/` partition |
| Web server | lighttpd (Entware) |
| Firewall | iptables |
| Config | Files in `/etc/qmanager/` |

---

## Development

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/dr-dolomite/qmanager.git
cd qmanager && git checkout dev-rm520

# Install dependencies
bun install

# Start development server (proxies API to modem at 192.168.225.1)
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
# Static export to out/
bun run build

# Full package (frontend + backend tarball + checksum)
bun run package
```

The `package` script builds the frontend, bundles it with backend scripts and dependencies into a tarball, and generates a SHA-256 checksum -- ready for distribution via GitHub Releases.

---

## Project Structure

```
QManager/
├── app/                        # Next.js App Router pages (35 routes)
│   ├── dashboard/              # Home — live signal monitoring
│   ├── cellular/               # Cellular info, SMS, profiles, band/tower/freq locking,
│   │                           #   cell scanner, APN, IMEI, FPLMN, network priority,
│   │                           #   antenna alignment/statistics
│   ├── local-network/          # IP passthrough, TTL, MTU
│   ├── monitoring/             # Network events, latency, email alerts, watchdog
│   ├── system-settings/        # System config, AT terminal, logs, software updates
│   └── (login, setup, reboot, about-device, support)
├── components/                 # React components (~173 files)
│   ├── ui/                     # shadcn/ui primitives (42+ components)
│   ├── cellular/               # Cellular management UI
│   ├── dashboard/              # Home dashboard cards
│   ├── local-network/          # Network settings UI
│   ├── monitoring/             # Monitoring & alerts UI
│   └── system-settings/        # System configuration UI
├── hooks/                      # Custom React hooks (31 files)
├── types/                      # TypeScript interfaces
├── lib/                        # Utilities (auth-fetch, earfcn, csv)
├── constants/                  # Static data (MNO presets, event labels)
├── scripts/                    # Backend shell scripts
│   ├── etc/systemd/system/     # Systemd service units (8)
│   ├── etc/sudoers.d/          # CGI privilege escalation rules
│   ├── etc/qmanager/           # Default config files
│   ├── usr/bin/                # Daemons & utilities (19)
│   ├── usr/lib/qmanager/       # Shared shell libraries (12)
│   ├── www/cgi-bin/            # CGI endpoints (63 scripts)
│   ├── install_rm520n.sh       # Device installation script
│   └── uninstall_rm520n.sh     # Clean removal script
├── dependencies/               # Bundled ARM binaries and packages
│   ├── atcli_smd11             # ARM binary (AT command transport via /dev/smd11)
│   ├── sms_tool                # ARM binary (SMS send/recv/delete)
│   ├── jq.ipk                  # JSON processor
│   └── dropbear_*.ipk          # SSH server
├── docs/                       # Documentation
└── build.sh                    # Package builder (tarball + checksum)
```

---

## Backend Services

QManager runs 10 systemd services on the modem:

| Service | Purpose |
|---------|---------|
| `qmanager-firewall` | Port firewall — restricts 80/443 to trusted interfaces before lighttpd starts |
| `qmanager-setup` | One-shot boot setup — directories, permissions, config init |
| `qmanager-poller` | Main poller daemon — tiered AT polling, JSON cache, event detection |
| `qmanager-ping` | Latency monitor — 5s ping cycle, NDJSON history (24h) |
| `qmanager-console` | Web console — ttyd on localhost:8080, reverse-proxied by lighttpd |
| `qmanager-watchcat` | Connection watchdog — 4-tier auto-recovery state machine |
| `qmanager-ttl` | TTL/HL — applies iptables rules at boot |
| `qmanager-mtu` | MTU — applies interface MTU settings at boot |
| `qmanager-imei-check` | IMEI integrity — verifies IMEI backup on boot |
| `qmanager-tower-failover` | Tower failover — restores lock after cell loss (config-gated) |

---

## Support the Project

<div align="center">
  <h3>Support QManager's Development</h3>
  <p>Your contribution helps maintain the project and fund continued development, testing on new cellular networks, and hardware costs.</p>
  <br/>
  <a href="https://ko-fi.com/drdolomite" target="_blank">
    <img height="64" style="border:0;height:64px;" src="https://storage.ko-fi.com/cdn/kofi1.png?v=3" alt="Buy Me a Coffee at ko-fi.com" />
  </a>
  <br/><br/>
  <a href="https://paypal.me/iamrusss" target="_blank">
    <img height="40" src="https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate via PayPal" />
  </a>
</div>

---

## License

This project is licensed under the [MIT License with Commons Clause](LICENSE).

**You are free to:** use, modify, fork, and share QManager for personal and non-commercial purposes.

**You may not:** sell QManager, bundle it into a commercial product, or offer it as a paid service -- including forked versions.

### Commercial Licensing

If you want to use QManager in a commercial product, OEM device, or reseller offering, commercial licenses are available. Contact [DrDolomite](https://github.com/dr-dolomite) directly to discuss terms.

---

<div align="center">
  <p>Built with care by <a href="https://github.com/dr-dolomite">DrDolomite</a></p>
</div>
