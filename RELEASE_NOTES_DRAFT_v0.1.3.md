# QManager RM520N BETA v0.1.3

**Tailscale VPN, port firewall, and web console** — adds on-demand Tailscale mesh VPN, a built-in port firewall protecting the web UI from cellular-side access, and a browser-based terminal console.

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

### Web Console

A browser-based terminal is now built into QManager — no need for SimpleAdmin's ttyd setup or separate SSH clients for quick commands.

- **ttyd v1.7.7** — lightweight web terminal downloaded automatically during install
- **Dark theme** — colors match QManager's UI (zinc-950 background, zinc-200 text)
- **Full Entware PATH** — `/opt/bin`, `/opt/sbin` included so Entware packages work out of the box
- **Proxied through lighttpd** — runs on localhost:8080, accessed at `/console` via reverse proxy with WebSocket support
- **Protected by QManager auth** — same session cookie as the rest of the UI
- **Non-fatal install** — if the ttyd download fails (no internet), everything else works normally

Navigate to **System > Web Console** in the sidebar.

### Email Alerts

Get notified by email when your modem loses and recovers internet connectivity. Previously deferred from the RM520N-GL port, now fully enabled.

- **Automatic recovery alerts** — sends an HTML email when internet returns after a downtime exceeding your configured threshold
- **Configurable threshold** — set minimum downtime (1-60 minutes) before an alert is triggered
- **Gmail app password support** — configure sender email, recipient, and Google app password
- **Install msmtp from UI** — one-click install of the `msmtp` mail client from Entware
- **Test email** — verify your configuration works before waiting for an actual outage
- **Alert log** — view history of sent alerts with timestamps, trigger type, and delivery status

Navigate to **Monitoring > Network Events > Email Alerts** in the sidebar.

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
- **Web console (ttyd)** is downloaded during install and enabled as an always-on service; non-fatal if download fails

---

## Bug Fixes

- **Fixed reboot fetch missing `keepalive`** — the reboot request from the Tailscale uninstall dialog now uses `keepalive: true` and sends the proper request body, matching the nav-user reboot pattern. Previously the request could be cancelled by the browser during page navigation.
- **Fixed `/usrdata/tailscale/` directory permissions** — directories created by the Tailscale helper now have `755` permissions so www-data (CGI) can check binary existence. Previously `mkdir -p` defaulted to `700` (root-only), causing the frontend to always show "not installed."
- **Fixed `tailscale up --json` output buffering** — the `--json` flag's output is fully buffered on RM520N-GL (no `stdbuf` available) and never flushes to file. Switched to interactive mode with grep-based URL parsing.
- **Fixed cellular sidebar nav highlighting** — "Cellular Information" no longer stays highlighted when navigating to other cellular sections like Settings. Active state now checks declared sub-item URLs instead of prefix matching.
- **Fixed poller logging silently failing** — `/tmp/qmanager.log` was owned by www-data, blocking root (poller) from writing due to `fs.protected_regular=1`. Now pre-created as root-owned with mode 666. This also fixed email alerts never triggering (poller couldn't track downtime state).
- **Fixed msmtp returning rc=1 on successful sends** — msmtp's `logfile` directive caused it to report failure when it couldn't write to `/tmp/msmtp.log` (same ownership issue). Removed the logfile directive from generated msmtprc — QManager has its own logging.
- **Fixed msmtp binary not found in poller context** — the poller runs without `/opt/bin` in PATH. Now detects `/opt/bin/msmtp` explicitly at library load time.
- **Added 30s stabilization delay for recovery emails** — after cellular radio recovery, DNS/SMTP need time to stabilize. Previously all 3 retry attempts fired too quickly and failed.

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
