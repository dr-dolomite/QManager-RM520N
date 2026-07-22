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

- **Boot persistence is implemented via direct symlinks** into `/lib/systemd/system/multi-user.target.wants/` (and `timers.target.wants/` for timer units), managed through `svc_enable`/`svc_disable`/`svc_is_enabled` in `platform.sh` — use those helpers everywhere; do not mix in raw `systemctl enable/disable`, because they write to a *different* wants dir (see next point). The same `/lib` manual-symlink mechanism is what the root helper `qmanager_auto_update_arm` uses to arm/disarm the auto-update timer live (see [Auto-update timer](#auto-update-timer)).
- **The `/lib` manual symlink is the deliberate single source of truth — do NOT migrate to `systemctl enable`.** A live-probed migration to `systemctl enable/disable/is-enabled` was evaluated and **rejected**; see [The `systemctl enable` migration was evaluated and rejected](#the-systemctl-enable-migration-was-evaluated-and-rejected) below. The `platform.sh` comment above `svc_enable` records the same verdict.

### `systemctl is-enabled` is unreliable here

`systemctl is-enabled <unit>` reports **"disabled"** for every QManager unit — even on a device where that unit boots perfectly every time. This is a direct consequence of the symlink approach above: QManager writes its wants-symlinks into `/lib/systemd/system/*.target.wants/`, but `is-enabled` only inspects `/etc/systemd/system/...`. It never sees QManager's symlinks, so it always answers "disabled."

> ⚠️ WARNING: Never use `systemctl is-enabled` to decide whether a QManager unit will survive a reboot — it will lie. Verify boot persistence by checking the wants-symlink directly (e.g. `test -L /lib/systemd/system/multi-user.target.wants/<unit>`). Validators and health checks must do the same, never `is-enabled`.

> ℹ️ NOTE: `systemctl is-enabled` is unreliable *because* QManager symlinks into `/lib/...wants/` while `is-enabled` inspects `/etc/...wants/`. This split is exactly why the `systemctl enable` migration was rejected — see the next subsection.

### The `systemctl enable` migration was evaluated and rejected

A recurring temptation is to "simplify" `platform.sh`'s `svc_enable`/`svc_disable`/`svc_is_enabled` (and the parallel `qmanager_auto_update_arm` timer helper) to plain `systemctl enable`/`disable`/`is-enabled`. **This was live-probed on the device's systemd 244 and rejected — do not re-attempt it.** The `platform.sh` comment block above `svc_enable` records the same verdict.

The problem is a *split brain* between two different symlink locations:

- `systemctl enable` writes its wants-symlink into `/etc/systemd/system/*.target.wants/`, and `systemctl is-enabled` **only ever reads `/etc`**.
- But every deployed QManager unit is enabled via a **manual `/lib/systemd/system/*.target.wants/` symlink** — created by `install_rm520n.sh`'s `enable_services()`, by `platform.sh`, and (for the auto-update timer) by `qmanager_auto_update_arm`. `is-enabled` never sees those, so it always answers "disabled."

Mixing the two is worse than either alone. `systemctl disable` removes only the `/etc` copy and **leaves the legacy `/lib` symlink orphaned** — so a unit the UI just "disabled" (e.g. the connection watchdog) would **still autostart at every boot**, a silent regression detectable only by rebooting, which can't be exercised on the live device. A correct migration would have to relocate the entire fleet's symlinks `/lib` → `/etc` in lockstep across the installer, `qmanager_health_check`, and the uninstaller, plus a reboot test that can't be run here. Not worth it: the `/lib` manual-symlink mechanism stays as the one source of truth.

### Condition placement — unit-health lesson

Two QManager units — `qmanager-ethernet.service` and `qmanager-imei-check.service` — historically showed as `Active: failed` on a completely healthy device that simply had nothing to do. The root cause was systemd directive placement, and the rule is worth internalizing for any new no-op-capable unit:

- **`Condition*=` (e.g. `ConditionPathExists=`) MUST live in `[Unit]`.** systemd **silently ignores** a `Condition*=` placed in `[Service]` — the guard never fires, the unit's real command runs and exits non-zero, and the unit lands in `failed`. Moved to `[Unit]`, systemd skips the unit cleanly when the precondition isn't met (the unit reports `condition failed`/inactive, not `failed`). This was the Ethernet-unit fix.
- **`ExecCondition=` belongs in `[Service]`** and behaves differently on purpose: a non-zero `ExecCondition` marks the run **`skipped`**, not `failed`. `qmanager-imei-check.service` uses `ExecCondition=` so an idle "nothing to check" exit reads as skipped.

Net effect after the fix: `systemctl --failed` comes back clean on a healthy box, on both a fresh install and an OTA upgrade of an existing device. When authoring a unit that should no-op under some condition, decide up front which directive you want and put it in the correct section.

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
- **Shared downloader library**: `/usr/lib/qmanager/downloader.sh` — sourced by `update.sh` CGI, `qmanager_update` (OTA worker), and `qmanager_auto_update` (run by the auto-update systemd timer). The two worker/timer scripts source it *guarded*, with an inline fallback so they still run if the lib is missing. See "HTTP transport & installer resilience" below — note the 3-copy maintenance hazard.
- **v0.1.4 → v0.1.5 requires ADB/SSH**: v0.1.4's CGI has no sudo and v0.1.4's sudoers has no `qmanager_update` rule, so OTA cannot self-update from v0.1.4. From v0.1.5 onward, OTA works via the UI.

### Dev-box version footgun

Running `scripts/install_rm520n.sh` **directly from a git checkout** stamps the placeholder `VERSION="v0.1.5"` — `build.sh` injects the real release version only at *package* time, never into the tracked source. A dev box installed straight from the repo therefore always believes it is on v0.1.5 and **perpetually shows "update available."** This is expected on dev boxes, not a bug.

R1's **semantic** version compare in `qmanager_update`'s `post_install_check` also fixes a related false-failure: a release whose version differs only by a **pre-release suffix** (e.g. installed `v0.1.13-draft` vs expected `v0.1.13`) no longer reports failure. The check compares the numeric core (`0.1.13`) and treats a suffix-only mismatch as **warn-and-succeed**; a real numeric-core mismatch still **fails** the install. Previously the exact-string compare threw a false "update failed" at the very last step of an otherwise-successful OTA.

### SHA-256 verification on the install path (A6)

OTA `install` mode now performs SHA-256 verification of the downloaded package — previously only `download` mode did, so `install` could silently skip the check:

- **Unattended path** (`qmanager_auto_update` invoking with `--unattended`): a missing or unverifiable checksum is a **hard failure** — no silent skip.
- **Manual path**: a missing checksum **warns and proceeds** (preserves the ability to install a release before its checksum is published).
- **A checksum MISMATCH is always fatal**, on both paths.

### OTA atomicity — known limitation

The frontend and CGI trees are deployed **wipe-and-recopy**, not staged-and-swapped. A power loss *mid-copy* can therefore leave a mixed tree (some new files, some old). The two-phase `VERSION` / `VERSION.pending` marker (above) **detects** this — a surviving `.pending` after reboot surfaces as `previous_install_failed` — but detection is not recovery.

> ⚠️ WARNING: The built-in recovery is a **user-invoked UI rollback**, which itself needs a working web UI — precisely what a half-copied tree may have broken. The real safety net is **SSH**: dropbear is installed independently and survives from the original install, so a bricked web UI is always recoverable over SSH.

**Recommended future direction (documented, not built):** stage the extract into a sibling directory and swap it in with an atomic `rename()` (or a symlink flip), so an interrupted update can never leave a partially-copied *live* tree.

### Auto-update timer

A dormant auto-updater ships as a systemd timer pair — `qmanager-auto-update.service` + `qmanager-auto-update.timer` — **default-OFF**. It is gated on the config key `update.auto_update_enabled` (surfaced at **System Settings → Software Update**). `qmanager_auto_update` re-checks the config key at runtime, so a timer that somehow fires while disabled still no-ops. When it does run, it honors the SHA-256 rules above (unattended path hard-fails on a missing/unverifiable checksum).

**Two paths arm the timer, both using the same `/lib` manual symlink:**

1. **Install / OTA** — `enable_services()` in `install_rm520n.sh` creates the `/lib/systemd/system/timers.target.wants/qmanager-auto-update.timer` symlink when the config key is on.
2. **The UI toggle — live.** Flipping the **Software Update** switch now arms/disarms the timer *immediately*, not just at the next install/OTA. `update.sh`'s `save_auto_update` action writes the config key and then calls `sudo -n /usr/bin/qmanager_auto_update_arm on|off` (sudoers: one bare-path line, `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_auto_update_arm`). The root helper mirrors the installer exactly — it creates/removes the *same* `/lib/.../timers.target.wants/` symlink (**not** `systemctl enable`, for the split-brain reason above) and `systemctl start|stop`s the unit so the change also takes effect for the current boot.

`qmanager_auto_update_arm` guarantees:
- **Strict `on`/`off` validation** — the unit name is hardcoded; any other argument is rejected.
- **Missing-unit no-op success** — a device whose OTA base predates the `.timer` unit has nothing to arm, so the helper returns `{"success":true,"armed":false,"reason":"unit_absent"}` instead of surfacing a hard error to the UI.
- **Best-effort from the CGI's view** — the config write is the source of truth (`qmanager_auto_update` re-checks it), so an arm/disarm hiccup is logged via `logger` but never fails the save.

> ℹ️ NOTE: The cadence is **not** user-configurable. The timer is `OnCalendar=daily` with `RandomizedDelaySec=3h` — a deliberate fleet-spread design so devices don't all hit GitHub at the same instant. The old "auto-update time" picker in the UI was removed (it never controlled anything), and the config key `update.auto_update_time` is now inert. The check runs once daily at a randomized time.

> ℹ️ NOTE: There was never a working cron path. An earlier `save_auto_update` wrote a crontab entry to `/var/spool/cron/crontabs/root`, but **RM520N-GL runs no `crond`**, so that entry never fired — and CGI (as `www-data`) couldn't write root's crontab anyway. That dead writer has been fully removed in favor of the systemd timer + `qmanager_auto_update_arm`.

---

## Uninstaller coverage

`scripts/uninstall_rm520n.sh` reverses the install. It is mostly **filesystem-driven** — Step 1 stops every `qmanager-*.service` it finds and Step 2 removes those unit files plus their `multi-user.target.wants/` boot symlinks by globbing the disk, so it needs no hardcoded service list. But that glob has two blind spots that each need an explicit teardown block, and the `--purge` path has a class of artifacts that must be removed by name or they strand the final directory removal.

### Timers the service glob misses

The Step 1/Step 2 globs only match `qmanager-*.service` and `qmanager*.target` in `/lib/systemd/system/`, and they only look in `multi-user.target.wants/`. Every QManager **`.timer`** unit is therefore invisible to them, for two separate reasons — its extension isn't `.service`, and its boot symlink lives in `timers.target.wants/` (systemd routes timer units through the `timers.target`, a different wants directory). Each timer gets its own teardown block in Step 1, and they come in two shapes:

| Timer | Shape | Teardown mechanism |
| ----- | ----- | ------------------ |
| `qmanager-scenario-schedule.timer` | Runtime-armed | Prefer `qmanager_scenario_schedule_arm teardown`; manual `stop` + symlink `rm` fallback |
| `qmanager-scheduled-reboot.timer` | Runtime-armed | Prefer `qmanager_scheduled_reboot_arm teardown`; manual fallback |
| `qmanager-tower-schedule-apply.timer` + `…-clear.timer` | Runtime-armed (pair) | One `qmanager_tower_schedule_arm teardown` call drops both; manual fallback |
| `qmanager-auto-update.timer` | **Static installer-shipped** | Direct `stop` + `rm` of the `timers.target.wants/` symlink **and** the unit file |

- **Runtime-armed timers** are created on demand by an arm helper (there is no `.timer` file on disk until a schedule is set — RM520N-GL has no `crond`, so schedules are implemented as runtime-generated systemd timers; see [Auto-update timer](#auto-update-timer) for the same `/lib` manual-symlink mechanism). Their teardown prefers the helper's own `teardown` verb (authoritative and idempotent) and falls back to a manual `stop` + symlink/unit `rm` if the helper binary is already gone (partial install). These blocks **must run before Step 3** deletes the arm-helper binaries from `/usr/bin/`.
- **The auto-update timer is different: it is static — shipped by the installer as a real unit file** that exists whether or not the feature is enabled. So it is caught by *neither* the `.service` glob (wrong extension) *nor* any arm-helper teardown (the helper `qmanager_auto_update_arm` only ever adds/drops the boot symlink — it never removes the unit file). Its block removes both the `timers.target.wants/` symlink and the unit file directly.

> ℹ️ NOTE: If you add a new static-shipped `.timer` in the future, it needs its own explicit removal block here — the Step 2 glob will silently leave the unit file and its `timers.target.wants/` symlink behind, and the orphaned symlink will still try to start a now-deleted unit at every boot.

### Artifacts that strand the final `rmdir`

The uninstaller's last act (Step 12) is `rmdir "$QMANAGER_ROOT"` (`/usrdata/qmanager`) — a **non-recursive** removal that only succeeds if the directory is already empty. Anything left directly under `/usrdata/qmanager/` that the earlier steps didn't remove will silently block it, leaving the whole tree behind. The trap is that `install_frontend`'s wipe-and-recopy only ever touches `www/`, so any state file or directory placed as a **sibling** of `www/` survives both OTA and the frontend teardown and must be removed **by name**:

| Artifact | When removed | Why it's not caught elsewhere |
| -------- | ------------ | ----------------------------- |
| `apn_setting.json`, `apn_names.json` | `--purge` only (config) | APN sidecar state, sibling of `www/` |
| `locales-packs/`, `locales-staging/` | `--purge` only (config) | Language-pack persistent store + staging quarantine, siblings of `www/` (see [i18n runtime downloader](i18n.md)) |
| `/etc/data/qmanager/` | **Every uninstall** (unconditional) | Installer-created DNS staging scratch dir (`www-data:www-data` 0700) — not user config, so it isn't gated on `--purge` (see [custom-dns](custom-dns.md)) |

The language-pack store and the older APN sidecars are the same bug class: `apn_names.json` was a pre-existing orphan that was never purged, so it silently blocked the `rmdir` and left `/usrdata/qmanager/` behind after every `--purge` uninstall. The rule for any new persistent state written outside `www/`: **if the installer or a runtime feature creates it under `$QMANAGER_ROOT` but outside `www/`, the uninstaller must remove it explicitly** — on `--purge` if it's user config, unconditionally if it's scratch/derived state.

---

## HTTP transport & installer resilience

- **`curl` is NOT a hard requirement.** The install and OTA pipeline auto-detect whichever HTTP downloader the device has — `curl` or `wget` — and use it. `curl` is preferred when both are present, but it is **never force-installed**.
- **Shared downloader library**: `/usr/lib/qmanager/downloader.sh` (POSIX sh) is the canonical implementation. Functions:
  - `qm_downloader()` — echoes `curl`, `wget`, or `""` (empty if neither). Non-network presence detection only; curl preferred.
  - `qm_https_ok()` — **advisory** HTTPS probe. Warn-only — it never gates a download.
  - `qm_download <url> <dest> [timeout]` — downloads; removes `<dest>` on failure.
  - `qm_download_headers <url> <body> <hdr> [timeout]` — downloads and captures response headers (used for GitHub rate-limit detection).
  - Sourcing the lib also exports an Entware-inclusive `PATH`.
- **Detection is non-network**: it checks tool presence and curl-preference only. The HTTPS probe (`qm_https_ok`) is advisory — the installer preflight *warns* if it cannot confirm `wget` does HTTPS, but **never aborts**. The real download is the authoritative test.
- **opkg bootstrap uses plain HTTP** (`bin.entware.net`), so even a TLS-less BusyBox `wget` can fetch it.
- **`qm_download_headers` portability**: GNU `wget` uses `-S` for full headers; BusyBox `wget` has no header-dump option, so the function falls back to harvesting the HTTP status line from stderr. Coarse rate-limit detection still works — only the precise reset time is lost.
- **ELF sanity check**: `install_rm520n.sh` verifies the downloaded opkg binary's ELF magic bytes, because `wget` (unlike `curl -f`) writes HTTP error pages to disk on a 4xx/5xx.
- **Maintenance hazard — three copies of the detection logic.** The canonical `downloader.sh` lib, plus inline copies in `qmanager-installer.sh` (bash) and `install_rm520n.sh` (sh). The inline copies exist because the install scripts run *before* the lib is on disk. **Bug fixes must be applied to all three.** The inline copies carry a comment pointing at the canonical lib.
- **`opkg update` failure is handled gracefully**: all Entware package installs are skipped with clear warnings, but the rest of the install (scripts, frontend, systemd units) continues normally.

---

## Supplemental assets

- **Speedtest CLI**: Downloaded from `install.speedtest.net` (package: `ookla-speedtest-1.2.0-linux-armhf.tgz`) during install. Placed at `/usrdata/root/bin/speedtest` with a `/bin/speedtest` symlink. CGI scripts discover it via `command -v speedtest`. Non-fatal if the download fails.
- **Cell scanner operator lookup**: `qmanager_cell_scanner` uses `operator-list.json` from `/usrdata/qmanager/www/cgi-bin/quecmanager/` for MCC/MNC → provider name resolution. The `jq` expression handles both `--slurpfile` (wrapped array) and `--argjson` (direct) operator input formats.
