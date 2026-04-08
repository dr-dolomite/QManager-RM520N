# QManager RM520N BETA v0.1.3

**Tailscale VPN and port firewall** — adds on-demand Tailscale mesh VPN installation and management, plus a built-in port firewall that protects the web UI from cellular-side access.

> Upgrading from v0.1.2? Go to **System Settings -> Software Update** or re-run the installer via ADB/SSH. All existing settings and profiles are preserved.

---

## What's New

### Tailscale VPN

Install, connect, and manage Tailscale directly from the QManager web UI. Access your modem remotely from any device on your Tailscale network.

- **One-click install** — downloads the latest stable ARM binary from Tailscale's CDN automatically (falls back to v1.92.5 if version detection fails)
- **Connect & authenticate** — generates a login URL, opens it in a new tab, and auto-detects when authentication completes
- **Connection status** — shows hostname, Tailscale IPs (IPv4/IPv6), DNS name, tailnet, DERP relay, and MagicDNS info
- **Network peers** — table of all devices on your tailnet with online/offline status, OS, IP addresses, exit node indicators, and relative last-seen times
- **Service control** — start/stop the Tailscale daemon, enable/disable on boot, disconnect, logout, or fully uninstall
- **Health warnings** — surfaces Tailscale health check messages (filtered to suppress the expected `--accept-routes` warning)
- **No SimpleAdmin dependency** — works on clean-flashed devices without the RGMII toolkit

Navigate to **Monitoring > Tailscale VPN** in the sidebar.

### Port Firewall

A new built-in firewall service replaces SimpleAdmin's `simplefirewall`, protecting the web UI from unauthorized access on the cellular interface.

- **Ports 80/443 restricted** to trusted interfaces: loopback, bridge0 (LAN), eth0 (Ethernet), and tailscale0 (if installed)
- **Cellular access blocked** — DROP rules prevent anyone on the cellular/WAN side from reaching the admin panel
- **SSH (port 22) intentionally left open** — emergency access is never blocked
- **Starts before lighttpd** — firewall rules are active before the web server accepts connections
- **Tailscale-aware** — automatically trusts the tailscale0 interface when Tailscale is installed; restarts itself after Tailscale install/uninstall to update trusted interfaces
- **Enabled by default** — installed and activated during QManager setup, no configuration needed

---

## Installer Improvements

- **Firewall service** is now part of the always-on service list, started and verified during install
- **Tailscale systemd units** are staged in `/usr/lib/qmanager/` for on-demand installation via the helper script
- **Removed ad-hoc iptables rules** from `qmanager_setup` and the installer's `start_services()` — all port firewall management is centralized in `qmanager-firewall.service`

---

## Bug Fixes

- **Fixed reboot fetch missing `keepalive`** — the reboot request from the Tailscale uninstall dialog now uses `keepalive: true` and sends the proper request body, matching the nav-user reboot pattern. Previously the request could be cancelled by the browser during page navigation.
- **Fixed `/usrdata/tailscale/` directory permissions** — directories created by the Tailscale helper now have `755` permissions so www-data (CGI) can check binary existence. Previously `mkdir -p` defaulted to `700` (root-only), causing the frontend to always show "not installed."
- **Fixed `tailscale up --json` output buffering** — the `--json` flag's output is fully buffered on RM520N-GL (no `stdbuf` available) and never flushes to file. Switched to interactive mode with grep-based URL parsing.

---

## Installation

**No prerequisites required** — QManager is fully independent. The installer bootstraps Entware, installs lighttpd, and sets up everything from scratch. You only need ADB or SSH access and internet connectivity on the modem.

ADB or SSH into the modem and run:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

> **Note:** Use `scp -O` (legacy mode) when transferring files to the modem — dropbear lacks an SFTP subsystem.

### Uninstalling

```sh
bash /tmp/qmanager_install/uninstall_rm520n.sh

# To also remove config/profiles/passwords:
bash /tmp/qmanager_install/uninstall_rm520n.sh --purge
```

---

## Platform Notes

### Features Not Yet Ported

The following RM551E features are deferred due to platform differences:

- VPN management (NetBird) — Tailscale is now available, NetBird remains deferred
- Video optimizer / traffic masquerade (DPI)
- Bandwidth monitor
- Ethernet status & link speed
- Custom DNS
- WAN interface guard
- Email Alerts

---

## Known Issues

- This is a **pre-release** — please report bugs at [GitHub Issues](https://github.com/dr-dolomite/QManager-RM520N/issues).
- Tailscale's `--accept-routes` flag must **never** be used — it disconnects the device from the network entirely and requires a physical reboot to recover.
- BusyBox `flock` lacks `-w` (timeout flag) — all flock usage has been adapted to use non-blocking polling loops.

---

## Thank You

Thanks for using QManager! If you find it useful, consider [supporting the project on Ko-fi](https://ko-fi.com/drdolomite) or [PayPal](https://paypal.me/iamrusss). Bug reports and feature requests are always welcome.

**License:** MIT + Commons Clause

**Happy connecting!**
