# 🚀 QManager RM520N BETA v0.1.4

**SMS alerts, new Rust-based AT transport, onboarding accuracy, and install reliability** — QManager can now SMS you when your connection goes down, so you get notified even while your data link is offline. `atcli_smd11` is a modern Rust reimplementation with cross-modem support, the onboarding band picker shows only the bands your modem actually supports, cell distance readings no longer lie when there's no signal, and the installer survives a read-only rootfs when enabling SSH.

> Upgrading from v0.1.3? Go to **System Settings -> Software Update** or re-run the installer via ADB/SSH. All existing settings and profiles are preserved.

---

## ✨ What's New

### 📱 SMS Alerts — Get Notified While Your Data Link Is Down

Email Alerts can only reach you *after* your internet comes back — the whole point of the alert is moot if you're notified 10 minutes late. SMS Alerts solves that by delivering notifications over the **cellular control channel** using the bundled `sms_tool` binary, so your phone rings the moment threshold is crossed even though the data PDP is offline.

- **Downtime-start + recovery** — two notifications per outage: one when your connection has been down longer than the configured threshold, one when it returns. A separate recovery SMS fires if downtime-start succeeded, otherwise a single combined "was down for Xm, now restored" dedup message is sent so the recipient never gets confused about state
- **Registration-guarded sending** — SMS is only attempted when the modem is actually registered on LTE or NR (`modem_reachable=true AND (lte_state=connected OR nr_state=connected)`). If the radio is down, the state machine waits — unbounded at the cycle level — until registration returns, rather than burning retry attempts on a dead radio
- **Bounded retry budget** — each send event gets up to 3 real `sms_tool` attempts with 5s backoff. Unregistered cycles do NOT count against the budget (tracked separately via `_SA_MAX_SKIPS`), so a SIM with no credits produces a clean "Failed" log row, not an infinite loop
- **Threshold-based suppression** — sub-threshold blips (e.g. a 20-second outage when threshold is 5 minutes) are silently ignored. No notifications, no log entries, no noise. Only outages that genuinely cross the threshold trigger the state machine
- **Dedup collapse** — if the downtime-start SMS never actually went out (radio was down, 3 attempts failed, etc.), the recovery path collapses into a single combined "was down for X, now restored" message instead of firing a misleading "recovery" SMS for an event the user never heard about
- **Alert Log card** — every send (successful or failed) is recorded in an NDJSON log at `/tmp/qmanager_sms_log.json` and displayed in the UI with timestamp, trigger description, status badge (Sent/Failed), and recipient number. Retained up to 100 entries
- **Hot config reload** — changing the recipient or threshold during an active tracked outage takes effect on the next poll cycle via `/tmp/qmanager_sms_reload` flag — no poller restart needed
- **Low-power mode aware** — alerts are suppressed when `/tmp/qmanager_low_power_active` is set, matching Email Alerts behavior
- **E.164 recipient format** — phone entered as `+<countrycode><number>` for clarity in the UI; backend strips the `+` before handing off to `sms_tool send`
- **No new dependencies** — `sms_tool` is already bundled with QManager for the SMS Center feature; SMS Alerts reuses it with the same `/tmp/qmanager_at.lock` flock serialization used by `qcmd` and the SMS Center CGI

Navigate to **Monitoring > SMS Alerts** in the sidebar.

### ⚡ Rust-Based `atcli_smd11` — Safer, Smaller, Cross-Modem

QManager's AT command transport has been replaced with a modern Rust reimplementation from [1alessandro1/atcli_rust](https://github.com/1alessandro1/atcli_rust). The previous binary was derived from Compal's original C `atcli` utility, which had a known 4096-byte buffer overflow bug on large responses. The Rust version is a clean-room reimplementation with memory safety and streaming I/O.

- **Memory-safe** — `BufReader::read_line` streams responses with O(1) memory usage, eliminating the 4096-byte buffer overflow from the OEM C binary
- **Cross-modem support** — works across Quectel **RM502, RM520, RM521, and RM551** — not locked to a single hardware variant
- **Static ARMv7 build** — no external glibc dependencies, self-contained ~647KB binary
- **OEM-compatible terminators** — matches the exact response terminator array from the Compal firmware (`OK\r\n`, `ERROR\r\n`, `+CME ERROR:`, `+CMS ERROR:`, `BUSY\r\n`, `NO CARRIER\r\n`, etc.)
- **Same CLI contract** — drop-in replacement: same command-line args, same stdout output, always exits 0, handles long commands natively (AT+QSCAN tested at 1m+ without timeout). No code changes needed in `qcmd` or CGI scripts.
- **Tested end-to-end** — verified against `AT`, `ATI`, `AT+CSQ`, `AT+QSCAN`, and error responses on a live RM520N-GL

### 📡 Onboarding Band Preferences — Now Modem-Aware

The band preferences step in the onboarding wizard previously offered a hardcoded list of 46 LTE and 59 NR5G bands carried over from the RM551E. Users could select bands the RM520N-GL doesn't support, silently failing when the AT command was applied. Now the step reads live supported bands from the poller and only shows what your hardware actually handles.

- **Dynamic band lists** — LTE and 5G (NSA+SA combined) bands come straight from `useModemStatus()`, driven by the poller's `AT+QNWCFG="policy_band"` query at boot
- **Filtered presets** — the Low-band and Mid-band preset options only include candidates your modem supports; unsupported bands are quietly removed from the preset string
- **Hidden empty presets** — if a preset would have no bands after filtering, the option is hidden entirely from the radio group rather than shown as an empty choice
- **Loading state** — a clean spinner is displayed while the poller data loads, preventing interaction with an empty band list
- **Consistent with the main band-locking page** — the onboarding step now matches the behavior of **Cellular > Band Locking**, so users see the same band set in both places

---

## 🐛 Bug Fixes

- **Fixed Tailscale install hanging on download** — both UI and CLI installs would get stuck at the "Downloading Tailscale..." stage and never complete. Two root causes: (1) `detect_latest_version()` ran `curl -fsSL` against the Tailscale CDN directory listing with **no timeout**, blocking indefinitely when the CDN was slow; (2) the install ran as a child process of the CGI request, so any transient network glitch or connection reset would kill the install mid-way. The `qmanager_tailscale_mgr` helper has been **completely rewritten** to mirror the proven iamromulan/quectel-rgmii-toolkit install flow: hardcoded version `1.92.5` and arch `arm` (no CDN scraping), two-layer execution that runs the install under a temporary systemd oneshot unit (detached from the caller), bare `curl -O` to download into `/usrdata/` (persistent partition), `sleep 2` after `daemon-reload` before starting the daemon, and bundled systemd units from `/usr/lib/qmanager/`. Validated end-to-end with reboot persistence, auth URL smoke test, and UI install/uninstall cycles.
- **Fixed `tailscale` CLI not found on PATH after install** — the old script only symlinked `tailscale` into `/usrdata/root/bin/`, matching rgmii-toolkit's convention. But QManager's default root shell uses `HOME=/home/root` and doesn't extend PATH to include `/usrdata/root/bin`, so `which tailscale` returned empty even though the daemon was running fine. The helper now creates **two** symlinks: `/usr/bin/tailscale` (always on default PATH) and `/usrdata/root/bin/tailscale` (rgmii-toolkit convention). Uninstall removes both.
- **Fixed installer failing to enable SSH on read-only rootfs** — when the user opted in to SSH at the end of the install, the script tried to write `/lib/systemd/system/dropbear.service` but the rootfs had already been remounted read-only by `qmanager_console_mgr` earlier in `start_services`. The SSH setup function now explicitly remounts `rw` before writing the service file, matching the defensive pattern used elsewhere in the installer.
- **Fixed Modem Temperature reading too low on dashboard** — the `AT+QTEMP` parser averaged all sensor readings but excluded only the `-273` "unavailable" sentinel from the unused mmWave sensor. Idle SDR power amplifiers (`modem-sdr0-pa0..2`, `modem-sdr1-pa0..2`) report `0` as their "not transmitting" sentinel, and those zeros were dragging the average down — e.g. a device with real sensor readings in the 39–43°C range was showing **26°C** on the dashboard because `418 / 16 sensors = 26` instead of the correct `418 / 10 active sensors = 42`. The parser now filters out both `-273` and `0` readings, so only active sensors contribute to the average.
- **Fixed LTE/NR cell distance showing "< 10 m" with no signal** — `calculateLteDistance()` and `calculateNrDistance()` previously treated `TA=0` as a valid "zero distance" result, displaying "< 10 m" even when there was no 5G connection at all (the modem reports stale `nr_ta=0` in that state). Both functions now treat `TA <= 0` as "no data" and return `null`, so the UI correctly shows `-`. The associated tooltip also switches to "Timing Advance value is not available" when TA is 0.

---

## 📥 Installation

**No prerequisites required** — QManager is fully independent. The installer bootstraps Entware, installs lighttpd, and sets up everything from scratch. You only need ADB or SSH access and internet connectivity on the modem.

ADB or SSH into the modem and run:

```sh
curl -fsSL -o /tmp/qmanager-installer.sh \
  https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
  bash /tmp/qmanager-installer.sh
```

> **Note:** Use `scp -O` (legacy mode) when transferring files to the modem — dropbear lacks an SFTP subsystem.

---

## 💙 Thank You

Thanks for using QManager! If you find it useful, consider [supporting the project on Ko-fi](https://ko-fi.com/drdolomite) or [PayPal](https://paypal.me/iamrusss). Bug reports and feature requests are always welcome.

**License:** MIT + Commons Clause

**Happy connecting!** 🎉

---

# 🚀 QManager RM520N BETA v0.1.3

**Tailscale VPN, web console, email alerts, IMEI tools, and port firewall** — access your modem remotely via Tailscale, run commands in a browser-based terminal, get email notifications on connectivity events, generate and validate IMEIs, and protect the web UI from cellular-side access.

---

## ✨ What's New

### 🔒 Tailscale VPN

Install, connect, and manage Tailscale directly from the QManager web UI. Access your modem remotely from any device on your Tailscale network.

- **One-click install** — downloads the latest stable ARM binary from Tailscale's CDN automatically (falls back to v1.92.5 if version detection fails)
- **Connect & authenticate** — generates a login URL, opens it in a new tab, and auto-detects when authentication completes
- **Connection status** — shows hostname, Tailscale IPs (IPv4/IPv6), DNS name, tailnet, DERP relay, and MagicDNS info
- **Network peers** — table of all devices on your tailnet with online/offline status, OS, IP addresses, exit node indicators, and relative last-seen times
- **Service control** — start/stop the Tailscale daemon, enable/disable on boot, disconnect, logout, or fully uninstall
- **Health warnings** — surfaces Tailscale health check messages (filtered to suppress the expected `--accept-routes` warning)
- **Survives reboot** — daemon auto-starts on boot with persisted auth state
- **No SimpleAdmin dependency** — works on clean-flashed devices without the RGMII toolkit

Navigate to **Monitoring > Tailscale VPN** in the sidebar.

### 💻 Web Console

A browser-based terminal is now built into QManager — no need for SimpleAdmin's ttyd setup or separate SSH clients for quick commands.

- **Integrated into the QManager UI** — the console renders inside a card matching the AT Terminal design, with the sidebar staying visible
- **ttyd v1.7.7** — lightweight web terminal downloaded automatically during install
- **Connection status bar** — shows live connection state (Connected/Disconnected/Reconnecting) with automatic reconnect and exponential backoff — resilient on flaky cellular connections
- **Fullscreen mode** — expand the terminal to fill the entire viewport with one click
- **Dark theme** — colors match QManager's UI (zinc-950 background, zinc-200 text)
- **Full Entware PATH** — `/opt/bin`, `/opt/sbin` included so Entware packages work out of the box
- **Graceful unavailable state** — if ttyd isn't installed or isn't running, shows a clear message with a Retry button instead of a broken page
- **Protected by QManager auth** — same session cookie as the rest of the UI
- **Non-fatal install** — if the ttyd download fails (no internet), everything else works normally

Navigate to **System > Web Console** in the sidebar.

### 📧 Email Alerts

Get notified by email when your modem loses and recovers internet connectivity. Previously deferred from the RM520N-GL port, now fully enabled.

- **Automatic recovery alerts** — sends an HTML email when internet returns after a downtime exceeding your configured threshold
- **Configurable threshold** — set minimum downtime (1-60 minutes) before an alert is triggered
- **Gmail app password support** — configure sender email, recipient, and Google app password
- **Install msmtp from UI** — one-click install of the `msmtp` mail client from Entware
- **Test email** — verify your configuration works before waiting for an actual outage
- **Alert log** — view history of sent alerts with timestamps, trigger type, and delivery status

Navigate to **Monitoring > Network Events > Email Alerts** in the sidebar.

### 🔢 IMEI Tools

A new IMEI Generator and Validator is now available under IMEI Settings — no backend needed, runs entirely in the browser.

- **Generate valid IMEIs** — select a device TAC preset or enter a custom 8–12 digit prefix; the tool fills the remaining digits and computes the Luhn check digit
- **Device presets** — ships with verified TACs (Apple iPhone 16/17 Pro, iPad Pro, Samsung Galaxy S25 Ultra/Tab S10+, Google Pixel 10 Pro) and a "Custom Prefix" option
- **Real-time Luhn validation** — paste or type any 15-digit IMEI and see a Valid/Invalid badge instantly
- **IMEI breakdown** — shows TAC (1–8), Serial Number (9–14), and Check Digit (15) in a structured display
- **Check on imei.info** — one-click external lookup for any generated or entered IMEI
- **Copy to clipboard** — grab the generated IMEI with one click
- **For educational purposes only** — generated IMEIs pass Luhn validation but are not registered with any network

Navigate to **Cellular > Settings > IMEI Settings** in the sidebar.

### 🛡️ Port Firewall

A new built-in firewall service replaces SimpleAdmin's `simplefirewall`, protecting the web UI from unauthorized access on the cellular interface.

- **Ports 80/443 restricted** to trusted interfaces: loopback, bridge0 (LAN), eth0 (Ethernet), and tailscale0 (if installed)
- **Cellular access blocked** — DROP rules prevent anyone on the cellular/WAN side from reaching the admin panel
- **SSH (port 22) intentionally left open** — emergency access is never blocked
- **Starts before lighttpd** — firewall rules are active before the web server accepts connections
- **Tailscale-aware** — automatically trusts the tailscale0 interface when Tailscale is installed; restarts itself after Tailscale install/uninstall to update trusted interfaces
- **Enabled by default** — installed and activated during QManager setup, no configuration needed

---

## 🔧 Installer Improvements

- **Firewall service** is now part of the always-on service list, started and verified during install
- **Tailscale systemd units** are staged in `/usr/lib/qmanager/` for on-demand installation via the helper script
- **Removed ad-hoc iptables rules** from `qmanager_setup` and the installer's `start_services()` — all port firewall management is centralized in `qmanager-firewall.service`
- **Web console (ttyd)** is downloaded during install and enabled as an always-on service; non-fatal if download fails

---

## 🐛 Bug Fixes

- **Fixed reboot fetch missing `keepalive`** — the reboot request from the Tailscale uninstall dialog now uses `keepalive: true` and sends the proper request body, matching the nav-user reboot pattern. Previously the request could be cancelled by the browser during page navigation.
- **Fixed Tailscale not surviving reboot** — two root causes: (1) tailscaled resets its state directory to `700` on every start, blocking the CGI from detecting the installation — `is_installed()` now checks the world-readable systemd unit file instead of traversing the restricted directory; (2) rootfs writes (unit file, boot symlink) weren't flushed before remounting read-only — added `sync` before every `mount -o remount,ro /` in the helper.
- **Fixed `tailscale up --json` output buffering** — the `--json` flag's output is fully buffered on RM520N-GL (no `stdbuf` available) and never flushes to file. Switched to interactive mode with grep-based URL parsing.
- **Fixed cellular sidebar nav highlighting** — "Cellular Information" no longer stays highlighted when navigating to other cellular sections like Settings. Active state now checks declared sub-item URLs instead of prefix matching.
- **Fixed poller logging silently failing** — `/tmp/qmanager.log` was owned by www-data, blocking root (poller) from writing due to `fs.protected_regular=1`. Now pre-created as root-owned with mode 666. This also fixed email alerts never triggering (poller couldn't track downtime state).
- **Fixed msmtp returning rc=1 on successful sends** — msmtp's `logfile` directive caused it to report failure when it couldn't write to `/tmp/msmtp.log` (same ownership issue). Removed the logfile directive from generated msmtprc — QManager has its own logging.
- **Fixed msmtp binary not found in poller context** — the poller runs without `/opt/bin` in PATH. Now detects `/opt/bin/msmtp` explicitly at library load time.
- **Added 30s stabilization delay for recovery emails** — after cellular radio recovery, DNS/SMTP need time to stabilize. Previously all 3 retry attempts fired too quickly and failed.

---

## 📥 Installation

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

## 📄 Platform Notes

### Features Not Yet Ported

The following RM551E features are deferred due to platform differences:

- VPN management (NetBird) — Tailscale is now available, NetBird remains deferred
- Video optimizer / traffic masquerade (DPI)
- Bandwidth monitor
- Ethernet status & link speed
- Custom DNS
- WAN interface guard

---

## ⚠️ Known Issues

- This is a **pre-release** — please report bugs at [GitHub Issues](https://github.com/dr-dolomite/QManager-RM520N/issues).
- Tailscale's `--accept-routes` flag must **never** be used — it disconnects the device from the network entirely and requires a physical reboot to recover.
- BusyBox `flock` lacks `-w` (timeout flag) — all flock usage has been adapted to use non-blocking polling loops.

---

## 💙 Thank You

Thanks for using QManager! If you find it useful, consider [supporting the project on Ko-fi](https://ko-fi.com/drdolomite) or [PayPal](https://paypal.me/iamrusss). Bug reports and feature requests are always welcome.

**License:** MIT + Commons Clause

**Happy connecting!** 🎉
