# 🚀 QManager RM520N BETA v0.1.1 — First Release

**The first public release of QManager for the Quectel RM520N-GL.** A modern, full-featured web management interface running natively on the modem's internal Linux OS — a ground-up port from the RM551E/OpenWRT variant.

> **⚠ First release disclaimer:** This is the very first release for the RM520N-GL platform. While it has been tested, there will be bugs. If possible, **please test on a spare modem first** before deploying on your primary device. Your bug reports help make QManager better for everyone — [open an issue](https://github.com/dr-dolomite/QManager-RM520N/issues) if you run into anything.

---

## ✨ What's Inside

**35 pages** · **173 components** · **59 CGI endpoints** · **12 shell libraries** · **8 systemd services**

### 📡 Signal & Network Monitoring

- **Live Signal Dashboard** — Real-time RSRP, RSRQ, SINR with per-antenna values (4x4 MIMO) and 30-minute historical charts
- **Antenna Statistics** — Per-port signal breakdown with quality indicators for all 4 antenna ports
- **Antenna Alignment** — 3-position recording tool with composite RSRP+SINR scoring to recommend best antenna placement
- **Network Events** — Automatic detection of band changes, cell handoffs, and carrier aggregation changes
- **Latency Monitoring** — Real-time ping with 24-hour history, jitter, packet loss, and aggregated views
- **Traffic Statistics** — Live throughput (Mbps) and cumulative data usage

### 🔧 Cellular Configuration

- **Band Locking** — Select and lock specific LTE/NR bands with automatic band failover
- **Tower Locking** — Lock to a specific cell by PCI with automatic failover and scheduled changes
- **Frequency Locking** — Lock to exact EARFCN/ARFCN channels
- **APN Management** — Create, edit, delete APN profiles with MNO presets (T-Mobile, AT&T, Verizon, etc.)
- **Custom SIM Profiles** — Save complete configs (APN + TTL/HL + optional IMEI) per SIM, with ICCID-based auto-apply on SIM swap or boot
- **Connection Scenarios** — Save and restore full network configuration snapshots
- **Network Priority** — Configure preferred network types and selection modes
- **Cell Scanner** — Active and neighbor cell scanning with signal comparison
- **Frequency Calculator** — EARFCN/ARFCN to frequency conversion tool
- **SMS Center** — Send and receive SMS messages directly from the interface
- **IMEI Settings** — Read, backup, and modify device IMEI (with integrity check at boot)
- **FPLMN Management** — View and manage the Forbidden PLMN list
- **MBN Configuration** — Select and activate modem broadband configuration files

### 🌐 Network Settings

- **TTL/HL Settings** — IPv4 TTL and IPv6 Hop Limit via iptables (applied at boot)
- **MTU Configuration** — Dynamic MTU application for rmnet interfaces
- **IP Passthrough** — Direct IP assignment to downstream devices

### 🛡️ Reliability & Monitoring

- **Connection Watchdog** — 4-tier auto-recovery: AT+COPS deregister/reregister → CFUN toggle → SIM failover → full reboot (with token bucket rate limiting)
- **Low Power Mode** — Scheduled CFUN power-down windows via cron
- **Software Updates** — In-app OTA update checking, download, SHA-256 verification, installation, and rollback
- **System Logs** — Centralized log viewer with search

### 🎨 Interface

- **Dark/Light Mode** — Full theme support with OKLCH perceptual color system
- **Responsive Design** — Works on desktop monitors and tablets in the field
- **Cookie-Based Auth** — Secure session management with rate limiting
- **AT Terminal** — Direct AT command interface for advanced users
- **Setup Wizard** — Guided onboarding for first-time configuration

---

## 📥 Installation

**Prerequisite:** You must install **SimpleAdmin** first using the [Quectel RGMII Toolkit](https://github.com/iamromulan/quectel-rgmii-toolkit) (by iamromulan). ADB into your modem and run the toolkit script:

```sh
cd /tmp && wget -O RMxxx_rgmii_toolkit.sh \
  https://raw.githubusercontent.com/iamromulan/quectel-rgmii-toolkit/SDXLEMUR/RMxxx_rgmii_toolkit.sh && \
  chmod +x RMxxx_rgmii_toolkit.sh && ./RMxxx_rgmii_toolkit.sh && cd /
```

Follow the prompts to install **SimpleAdmin and Entware**. This sets up the web server, socat PTY bridge, and foundational services that QManager builds upon. Once done, proceed with QManager:

ADB or SSH into the modem and run:

```sh
/opt/bin/wget -O /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

The interactive installer fetches the latest release, verifies the SHA-256 checksum, backs up SimpleAdmin, installs everything (`sms_tool`, `jq`, `dropbear` bundled), configures lighttpd + systemd, and reboots the modem.

### Uninstalling

```sh
bash /tmp/qmanager_install/uninstall_rm520n.sh

# To also remove config/profiles/passwords:
bash /tmp/qmanager_install/uninstall_rm520n.sh --purge
```

SimpleAdmin is restored from backup automatically.

---

## 📄 Platform Notes

This is a **native port** to the RM520N-GL's internal Linux (SDXLEMUR, ARMv7l, kernel 5.4.180) — not a wrapper around the OpenWRT variant. Uses systemd for service management, lighttpd for web serving, iptables for firewall rules, and `/usrdata/` for persistent storage.

### Features Not Yet Ported

The following RM551E features are deferred due to platform differences:

- VPN management (Tailscale + NetBird) — **for Tailscale, please use the [RGMII Toolkit](https://github.com/iamromulan/quectel-rgmii-toolkit) for now**
- Video optimizer / traffic masquerade (DPI)
- Bandwidth monitor
- Ethernet status & link speed
- Custom DNS
- WAN interface guard
- Email Alerts

---

## ⚠️ Known Issues

- This is a **pre-release** — please report bugs at [GitHub Issues](https://github.com/dr-dolomite/QManager-RM520N/issues).
- Email alerts require `msmtp` which can be installed from within the app (System Settings).

---

## 💙 Thank You

Thanks for trying the first RM520N-GL release of QManager! If you find it useful, consider [supporting the project on Ko-fi](https://ko-fi.com/drdolomite) or [PayPal](https://paypal.me/iamrusss). Bug reports and feature requests are always welcome.

**License:** MIT + Commons Clause

**Happy connecting!** 📡
