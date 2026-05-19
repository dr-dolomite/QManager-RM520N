# QManager Independence (RM520N-GL)

> QManager installs standalone with no SimpleAdmin/RGMII-toolkit dependency — it owns its directory, bootstraps Entware, configures lighttpd, and manages all services itself.

---

## Directory layout & bootstrapping

- **Own directory**: `/usrdata/qmanager/` — contains web root, lighttpd config, and TLS certs.
- **Bootstraps Entware** from `bin.entware.net` if not present. The bootstrap process creates the `opt.mount`, `start-opt-mount.service`, and `rc.unslung.service` systemd units.
- **Installs lighttpd + modules** from Entware: `lighttpd-mod-cgi`, `lighttpd-mod-openssl`, `lighttpd-mod-redirect`, `lighttpd-mod-proxy`.
- **lighttpd module version sync**: The installer runs `opkg upgrade` on lighttpd and all its modules together when they are already installed — this prevents `plugin-version doesn't match` errors that occur if modules are at different versions during upgrades.
- **Creates `www-data:dialout`** user and group if missing. The `dialout` group membership grants `www-data` access to `/dev/smd11`.
- **Installer stops socat-smd11** services if they are running — `atcli_smd11` requires exclusive access to `/dev/smd11` and cannot co-exist with a socat bridge holding it open.
- **Windows line ending safety**: The installer strips `\r` from all deployed shell scripts, systemd units, and sudoers rules using `sed -i 's/\r$//'`. This prevents BusyBox and sudoers parse failures that occur when tarballs are built on Windows.

---

## Device permissions (/dev/smd11 & udev)

`/dev/smd11` defaults to `crw------- root:root` — completely inaccessible to `www-data`. QManager uses two complementary paths to fix this, both of which are idempotent:

### Primary: udev rule

- Rule file: `/etc/udev/rules.d/99-qmanager-smd11.rules`
- Fires on every kernel `add` event for the `smd11` device.
- Executes `/usr/lib/qmanager/qmanager_smd11_udev.sh`, which runs `chmod 660` and `chown root:dialout` on `/dev/smd11`.
- The rule intentionally **omits `SUBSYSTEM==`** — the subsystem on RM520N-GL is `glinkpkt` (sysfs at `/sys/class/glinkpkt/smd11`), but omitting the subsystem filter makes the rule work across both this platform and others (e.g. RG502Q/RM502Q). `KERNEL=="smd11"` is already specific enough.
- Source path for the udev helper script is `scripts/etc/udev/scripts/qmanager_smd11_udev.sh` — deliberately placed **outside** `usr/lib/qmanager/` to prevent `install_backend`'s glob copy from resetting its file mode to 644.

### Fallback: boot-time setup

- `qmanager_setup` runs the same `chown`/`chmod` at boot, in case udev has not loaded the rule yet (e.g. on fresh install before a udev reload).
- This covers PRAIRE-derived platforms (RG502Q/RM502Q) where the modem re-creates `/dev/smd11` **after** `qmanager-setup.service` completes, leaving the one-shot's `[ -e ]` guard false when udev fires later.

---

## CGI environment & auth

- **CGI PATH problem**: lighttpd starts CGI scripts with a stripped-down `PATH` that excludes `/opt/bin` — so Entware tools like `jq` are invisible to CGI scripts by default.
  - Fix 1: `cgi_base.sh` exports the full PATH including `/opt/bin`.
  - Fix 2: The installer symlinks `jq` to `/usr/bin/` so it is always found regardless of PATH.
- **Cookie-based session auth** is used at the CGI layer. There is no HTTP Basic Auth and no `.htpasswd` file.
- **AT transport in CGI**: `atcli_smd11` accesses `/dev/smd11` directly — no socat-at-bridge is needed.

---

## Service persistence (systemd symlinks)

- **`systemctl enable` does not work** on this platform — it fails silently or errors depending on systemd version.
- All boot persistence is implemented via **direct symlinks** into `/lib/systemd/system/multi-user.target.wants/`.
- This is managed through `svc_enable` and `svc_disable` helpers in `platform.sh` — use those functions everywhere, never call `systemctl enable/disable` directly.

---

## SSH password management

- Helper: `qmanager_set_ssh_password`
- Reads the new password from stdin and updates `/etc/shadow` using `openssl passwd -1`.
- Whitelisted in sudoers for `www-data` so the CGI layer can invoke it without a password.
- Called automatically during onboarding to sync the web UI password to the root account.
- Also callable independently from **System Settings > SSH Password** card.

---

## Networking & firewall

- **Port firewall**: `qmanager-firewall.service` restricts the web UI (ports 80 and 443) to trusted interfaces: `lo`, `bridge0`, `eth0`, and `tailscale0` (if installed). Cellular-side access is blocked.
- This service replaces SimpleAdmin's `simplefirewall` — it is QManager-owned and installed by default.
- SSH (port 22) is intentionally left open on all interfaces for emergency access.

---

## Tailscale VPN

Tailscale is installed on-demand via the `qmanager_tailscale_mgr` helper. The install flow is aligned with the rgmii-toolkit convention (validated 2026-04-10). There are many non-obvious gotchas — read this section fully before touching any Tailscale code.

### Version & download

- Hardcoded version: `1.92.5`, arch: `arm`. No CDN directory scraping, no version detection, no timeout gymnastics.
- Download lands in `/usrdata/` (persistent partition) via bare `curl -O`.
- **Do NOT add `-fSL` or timeouts to the curl command** — both flags contributed to the original installation hang.
- Binaries live at `/usrdata/tailscale/`.

### Two-layer execution pattern

The helper uses a deliberate two-layer design to survive CGI disconnects:

1. An **outer wrapper** stages an inner install script and a temporary systemd oneshot unit (`qmanager_tailscale_install.service`), fires the unit, and returns immediately.
2. The **inner script** runs detached under systemd, independent of the CGI caller's lifetime.

The helper calls `sleep 2` after `daemon-reload` and before `start` to give systemd time to register the new unit.

### Symlinks (both are required)

CLI accessibility requires **two symlinks**:
- `/usrdata/root/bin/tailscale` — rgmii-toolkit convention
- `/usr/bin/tailscale` — QManager's default root shell uses `HOME=/home/root` and does not have `/usrdata/root/bin` in its PATH

### Systemd units

Units come from `/usr/lib/qmanager/tailscaled.service` and `tailscaled.defaults` (bundled by the installer). The helper includes an inline fallback for these files if they are missing.

### tailscale up flag restriction

`tailscale up` must **NOT** use the `--json` flag. Its output is fully buffered on RM520N-GL (there is no `stdbuf` available) and never flushes to a file. Use interactive mode and grep for the auth URL instead.

### tailscaled state directory reset

`tailscaled` resets its state directory permissions to `700` on every start, making the binary inside inaccessible. To work around this:
- CGI `is_installed()` checks for the **systemd unit file** (world-readable) plus directory existence — not binary executability.
- `ExecStartPost=/bin/chmod 755` in the service unit restores access after each start.
- `qmanager_setup` also restores access at boot as belt-and-suspenders.

### Rootfs flush before remounting read-only

**All rootfs writes must be flushed before remounting read-only.** `qmanager_tailscale_mgr` calls `sync` before every `mount -o remount,ro /` to prevent unit file or symlink loss on reboot.

### Firewall restart

The helper restarts `qmanager-firewall.service` after install so `tailscale0` is recognized as a trusted interface.

### PID tracking across install phases

PID tracking spans the full install lifetime to keep the CGI's `pid_alive` concurrency check working:
1. The outer wrapper writes its own PID initially.
2. It overwrites with the systemd oneshot's `MainPID` after unit start.
3. The inner script overwrites with its own PID via an `EXIT` trap that also handles cleanup on completion.

### Progress & log files

- Progress file (CGI poll target): `/tmp/qmanager_tailscale_install.json`
- Log file: `/tmp/qmanager_tailscale_install.log`
- No dependency on SimpleAdmin.

---

## Web console

- Service: `qmanager-console.service`
- Runs **ttyd v1.7.7** (armhf) on `localhost:8080`.
- Reverse-proxied by lighttpd at `/console` with WebSocket upgrade support.
- Binary location: `/usrdata/qmanager/console/ttyd`
- Downloaded during install — non-fatal if the device is offline at install time.
- Theme matches QManager dark mode. Shell startup script sets PATH to include Entware tools.

---

## Email & SMS alerts

### Email alerts

- MTA: `msmtp`, installed from Entware at `/opt/bin/msmtp`.
- Config file: `/etc/qmanager/msmtprc`
- **Do NOT include a `logfile` directive** in msmtprc. If msmtp cannot write its log file, it returns `rc=1` even when the email was sent successfully. This causes false failures.
- The `email_alerts.sh` library detects msmtp at `/opt/bin/msmtp` explicitly — the poller's `PATH` does not include `/opt/bin`.
- Recovery emails wait **30 seconds** after connectivity returns before the first send attempt, to allow DNS and SMTP to stabilize.

### SMS alerts

- Transport: bundled `sms_tool` binary on `/dev/smd11` — no package install needed.
- `sms_alerts.sh` is sourced by the poller and reads poller globals directly: `conn_internet_available`, `modem_reachable`, `lte_state`, `nr_state`.
- **Registration guard is mandatory before every send.** The modem must be reachable AND (`lte_state="connected"` OR `nr_state="connected"`). Waiting for registration is unbounded at the state machine level, but `_sa_do_send` caps real send attempts at 3. Unregistered skips do not consume the retry budget — they are bounded separately by `_SA_MAX_SKIPS`.
- **Recovery path has two branches**:
  - If `downtime-start` status is `"sent"`: send a separate recovery SMS.
  - Otherwise: send a combined dedup message ("was down for X, now restored").
- **Recovery is silenced** when `status="none" && duration < threshold_secs` — sub-threshold blips never generate notifications.
- Phone numbers are stored with a leading `+` but stripped via `${_sa_recipient#+}` before passing to `sms_tool send` (matches the convention in `scripts/www/cgi-bin/quecmanager/cellular/sms.sh:265`).
- The shared lock `/tmp/qmanager_at.lock` serializes `sms_tool` calls with `qcmd` and the SMS Center CGI.
- **Test sends from the CGI** override `_sa_is_registered() { return 0; }` because CGI context lacks poller globals. The override must be placed **after** sourcing the library — the library has a `_SMS_ALERTS_LOADED` guard that prevents re-sourcing from clobbering the override.
- Config file: `/etc/qmanager/sms_alerts.json`
- NDJSON log: `/tmp/qmanager_sms_log.json` (capped at 100 entries)
- Reload flag: `/tmp/qmanager_sms_reload`
- Config writes are atomic: write to `.tmp`, then `mv` into place.

---

## OTA update pipeline

- **sudoers rule**: `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_update` — allows the `update.sh` CGI to invoke the update worker as root via `sudo -n`.
- **Log file ownership trick**: The CGI spawn-line redirects to `/dev/null 2>&1` (not `>>log`) so the worker (`qmanager_update`) creates `/tmp/qmanager_update.log` as root. This sidesteps `fs.protected_regular=1`, which would block root from truncating a log file previously created by `www-data`.
- **Atomic status writes**: The worker uses `write_status` (`.tmp` + `mv`) for all status updates.
- **Progress validation**: Progress is tracked by tailing `=== Step N/M: <label> ===` lines from the installer log.
- **Two-phase VERSION write**:
  - Installer writes `/etc/qmanager/VERSION.pending` early via `mark_version_pending()`.
  - `finalize_version()` moves it to `/etc/qmanager/VERSION` at the end.
  - A surviving `.pending` file after reboot indicates a failed install.
- **Filesystem-driven cleanup**: `cleanup_legacy_scripts()` and service enable/disable scan `/lib/systemd/system/qmanager-*.service` and `/usr/bin/qmanager_*` at runtime — not a hardcoded list.
- **`UCI_GATED_SERVICES`**: Controls which services are only re-enabled if their `multi-user.target.wants/` symlink existed before the upgrade.
- **Watchdog suppression**: The watchcat lock `/tmp/qmanager_watchcat.lock` is touched before stopping services and released via an `EXIT` trap, suppressing the watchdog during the install window.
- **Shared semver library**: `/usr/lib/qmanager/semver.sh` — sourced by both `update.sh` CGI and `qmanager_auto_update`.
- **v0.1.4 → v0.1.5 requires ADB/SSH**: v0.1.4's CGI has no sudo and v0.1.4's sudoers has no `qmanager_update` rule, so OTA cannot self-update from v0.1.4. From v0.1.5 onward, OTA works via the UI.

---

## HTTP transport & installer resilience

- **All network I/O uses `curl` only.** This applies to: installer bootstrap, OTA updater, auto-update cron, GitHub API calls, public-IP probe, ttyd/speedtest downloads, and Entware bootstrap.
- `wget` and `uclient-fetch` fallbacks were removed in 2026-05:
  - BusyBox wget on Quectel x5x/x6x platforms lacks TLS support.
  - Entware wget would add ~5 MB to the install footprint.
- The installer runs a preflight check and **fails fast** if `curl` is missing.
- **`opkg update` failure is handled gracefully**: all Entware package installs are skipped with clear warnings, but the rest of the install (scripts, frontend, systemd units) continues normally.

---

## Supplemental assets

- **Speedtest CLI**: Downloaded from `install.speedtest.net` (package: `ookla-speedtest-1.2.0-linux-armhf.tgz`) during install. Placed at `/usrdata/root/bin/speedtest` with a `/bin/speedtest` symlink. CGI scripts discover it via `command -v speedtest`. Non-fatal if the download fails.
- **Cell scanner operator lookup**: `qmanager_cell_scanner` uses `operator-list.json` from `/usrdata/qmanager/www/cgi-bin/quecmanager/` for MCC/MNC → provider name resolution. The `jq` expression handles both `--slurpfile` (wrapped array) and `--argjson` (direct) operator input formats.
