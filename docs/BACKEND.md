# QManager Backend Reference

**Target platforms:** QManager supports two modems — the **RM520N-GL** (M.2,
X62 silicon on the SDXLEMUR SoC, ARMv7l Cortex-A7) as the reference device, and
the **RG501Q-EU** (LGA, SDXPRAIRIE/SDX55), onboarding as of 2026-08. Per-device
facts live in [`reference/platform-matrix.md`](./reference/platform-matrix.md).

Two firmware facts are worth knowing up front, because both routinely trip people up:

- **The OEM build string says `SDX65`, but the part is X62.** `/proc/cpuinfo` reports the SoC codename `SDXLEMUR`, while the firmware is built from the SDX65 SDK — so the OEM build string reads `LE.UM.6.3.6.r1-02600-SDX65.0` even though the RM520N-GL is the X62 part. The `SDX65` is an SDK artifact, not the silicon.
- **Model-specific behavior keys off `/etc/quectel-project-version`, not hardcoded assumptions.** This sentinel file is present on **both** live targets, and its *contents* — not its presence — are what QManager branches on: `hw_profile.sh` parses `Project Name:`, `Branch  Name:` (two spaces, column-aligned) and `Project Rev :` into the hardware profile; the installer reads `Project Name:` to refuse an RM551E; and the data-usage orientation map reads the SoC through `qm_hw_soc`. Presence-only branching is gone — the poller's traffic-stats interface no longer consults the file at all (`resolve_network_iface` returns `rmnet_ipa0` unconditionally, because that is the aggregate WAN netdev on both SDX55 and SDX65). ⚠️ The orientation map deliberately resolves **every** SoC to `normal` today: the SDX55 arm is commented out pending a measurement, so parsing `Branch  Name:` correctly does not yet change any behavior. See [`reference/platform-matrix.md`](./reference/platform-matrix.md).

Probe data in this document was collected on the **RM520N-GL** (distro
`qti-distro-nogplv3-perf`) unless a passage says otherwise. Where this doc says
"the platform", read it as "the RM520N-GL's on-modem Quectel userspace stack" —
those claims are **unverified on RG501Q-EU**.
This document is a developer reference for the shell-script backend. It covers every library, daemon, unit file, sudoers rule, udev rule, CGI endpoint, and file path that exists in this codebase. It does not cover frontend React code, installer operational flow, or platform internals.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Critical Constraints](#2-critical-constraints)
3. [Source Tree Layout](#3-source-tree-layout)
4. [Shared Libraries](#4-shared-libraries)
5. [Daemons & Utilities](#5-daemons--utilities)
6. [Systemd Services](#6-systemd-services)
7. [Sudoers Rules](#7-sudoers-rules)
8. [udev Rules](#8-udev-rules)
9. [CGI Endpoint Reference](#9-cgi-endpoint-reference)
10. [File Locations on Device](#10-file-locations-on-device)
11. [Locking & Concurrency Conventions](#11-locking--concurrency-conventions)
12. [Update Pipeline](#12-update-pipeline)
13. [Development Guidelines](#13-development-guidelines)
14. [Common Pitfalls](#14-common-pitfalls)
15. [See Also](#15-see-also)

---

## 1. Overview

QManager runs as a self-contained web management stack inside the RM520N-GL modem itself. The modem runs vanilla Debian-adjacent Linux (not OpenWRT). QManager installs independently under `/usrdata/qmanager/` with no dependency on the OEM SimpleAdmin panel.

**Platform stack:**

| Layer | Technology |
|-------|-----------|
| Init system | systemd 244 (`-PAM -SECCOMP -APPARMOR`, hybrid cgroup v1+v2) |
| Web server | lighttpd 1.4.82 (Entware, `/opt/sbin/lighttpd`) |
| Package manager | Entware opkg at `/opt/` (Entware libc 2.27 alongside system glibc 2.31) |
| Config store | JSON files under `/etc/qmanager/` (no UCI) |
| AT transport | `qcmd` → `qmanager_atd` on `/dev/smd11` (direct, no socat; broker daemon on RM520N-GL, in-process elsewhere) |
| Firewall | iptables 1.8.4 legacy (direct, no nftables/fw4) |
| Shell | `/bin/sh` is **BusyBox `ash`** (`/bin/sh -> busybox.nosuid`); `/bin/bash` exists but is **bash 3.2.57(1)-release** — see [§14 Common Pitfalls](#14-common-pitfalls) for missing modern bashisms |

**Backend layers (source to device):**

```
CGI scripts (lighttpd) -- scripts/www/cgi-bin/quecmanager/
     |
Shared libraries       -- scripts/usr/lib/qmanager/
     |
Shell daemons          -- scripts/usr/bin/qmanager_*
     |
AT command gatekeeper  -- /usr/bin/qcmd -> qmanager_atd (native/qmanager_atd/) -> /dev/smd11
     |
systemd services       -- scripts/etc/systemd/system/
     |
sudoers rules          -- scripts/etc/sudoers.d/qmanager
udev rules             -- scripts/etc/udev/rules.d/
```

`scripts/` in the repository mirrors the device filesystem. `install_rm520n.sh` copies these files to their target paths on the device.

---

## 2. Critical Constraints

These constraints cause silent failures or security issues if violated.

**LF line endings mandatory.** `.gitattributes` enforces LF for all `.sh`, `.service`, and `sudoers` files. CRLF in shell scripts causes BusyBox/bash parse failures. CRLF in sudoers rules causes silent sudo rejection. The installer runs `sed -i 's/\r$//'` on deployed files as a second safety net, but the source must be LF.

**Atomic writes are universal — except for cross-UID `/tmp` files.** Every file that is polled by another process (status JSON, config, state files) must be written via a temporary file plus `mv`. Never truncate-in-place. This prevents readers from seeing partial JSON during writes. **The one exception is a `/tmp` file written by both root and `www-data`**: there, `mv` destroys the shared ownership and the write must go through the existing inode instead, trading atomicity for cross-UID access. See the next constraint.

**`fs.protected_regular=1` is active.** In a world-writable sticky directory like `/tmp`, an `O_CREAT` open-for-write is refused unless `file_owner == dir_owner` **or** `caller_uid == file_owner`. `/tmp` is root-owned, so:
- A **root-owned** file there is writable by both UIDs (mode permitting).
- A **www-data-owned** file there is **not writable by root** — and this check has **no root override**, at any mode including `0666`.

So the only ownership under which both a root daemon and a `www-data` CGI can write the same `/tmp` file is **`root:root` mode `0666`**, seeded at boot by `qmanager_setup`. Rules that follow:
- `qmanager_setup` pre-creates every shared `/tmp` file `root:root` mode 666. (The AT lock is no longer one of them: since T4.3 it is `/run/qmanager_at/at.lock`, see §11.)
- Every writer of a seeded file writes **in place** (`>`, `>>`, `cat tmp > file`, `: >`). Never tmp+`mv`, never `rm` to reset — both swap the inode and replace the seed with the writer's own uid at its umask.
- For worker scripts that reset their **own** single-UID log, `rm -f` then create fresh is fine (as in `qmanager_update`).
- Do not confuse this with plain mode bits: a root-owned `0644` file blocks `www-data` through ordinary permissions, not through this sysctl. The two fail in opposite directions.

Full protocol, the seeding list, and the three live bugs that came from getting the direction backwards: [reference/tmp-file-ownership.md](reference/tmp-file-ownership.md).

**`/bin/bash` is bash 3.2.57 — many "modern" bashisms are missing.** Probe-confirmed unsupported in this version:
- `${var,,}` / `${var^^}` (lowercase/uppercase substitution) — **broken**, use `tr` instead
- `mapfile` / `readarray` — **not built-in**, use `while read` loops
- `wait -n` (wait for any child) — **not supported**
- `declare -A` (associative arrays) — **not supported**, use parallel indexed arrays or temp files

Probe-confirmed supported: `<<<` herestring, `[[ =~ ]]` regex with `$BASH_REMATCH`, indexed arrays, `local`, `[[ ]]`, process substitution `<(...)`. **`/bin/sh` is BusyBox `ash`** — POSIX-only by definition; do **not** assume any bashism in `#!/bin/sh` scripts. Libraries sourced by both contexts must stay POSIX-clean.

**AT commands via `qcmd` only.** Never write directly to `/dev/smd11`. `qcmd` provides flock serialization. Concurrent writes to `/dev/smd11` corrupt modem responses.

**`jq //` (alternative operator) treats `false` as absent.** `false // "default"` returns `"default"`. When reading boolean config fields (like `enabled`), use the explicit null check pattern:

```sh
val=$(jq -r '(.field) | if . == null then "false" else tostring end' file.json)
```

**CGI privilege model.** lighttpd runs CGI as `www-data`. All privileged operations (service control, iptables, reboot) require `sudo -n` with full absolute paths. The `platform.sh` library provides sudo-wrapped helpers (`svc_*`, `run_iptables`, `run_reboot`). The sudoers file whitelists exactly these paths.

**`systemctl enable` does not work on RM520N-GL.** Unit files live on a read-only rootfs partition where `systemctl enable` cannot write symlinks. Boot persistence uses direct symlinks in `/lib/systemd/system/multi-user.target.wants/`. Use `svc_enable`/`svc_disable` from `platform.sh` which write the symlinks directly via `sudo /bin/ln -sf` / `sudo /bin/rm -f`. Those symlinks live on the rootfs, so writing one is governed by the mount-mode contract in [§2.1](#21-rootfs-mount-mode-contract) — read it before adding any code that writes to `/lib`, `/usr/bin`, or `/usr/lib`.

### 2.1 Rootfs mount-mode contract

**Short version: `/` boots read-only, QManager remounts it read-write once at boot, and nothing in this tree ever puts it back. Every place that writes a rootfs path must ensure `rw`, check whether the write actually landed, and return a real status instead of assuming success.**

This invariant used to be implicit, spread across nine scripts — two of which contradicted the other seven. That is exactly what produced the silent boot-persistence bug described at the end of this section. It is written down here so there is one answer.

#### The two volumes

The device has two UBIFS volumes, and almost every mount-mode mistake in this codebase comes from treating them as one. UBIFS is the flash-aware filesystem the modem uses for both; "volume" here means a UBI logical volume, roughly a partition on raw NAND.

| Path | Device | Mount mode | Remount needed before writing? |
|------|--------|-----------|-------------------------------|
| `/` (and therefore `/lib`, `/bin`, `/usr/bin`, `/usr/lib`, `/lib/systemd/system/**`) | `ubi0:rootfs` | boots **`ro`** | **Yes** — `mount -o remount,rw /` |
| `/etc`, `/usrdata`, `/opt`, `/data`, `/cache`, `/persist`, `/systemrw` | `/dev/ubi2_0` (one volume, bind-mounted at each of these points) | always **`rw`** | **No** — a remount here is a pure no-op. Do not add one. |

So `/etc/qmanager/*.json`, `/usrdata/qmanager/www/**` and everything under `/opt` are written with no ceremony at all. `/lib/systemd/system/multi-user.target.wants/<unit>.service` — where **all** QManager boot persistence lives — is not.

#### How to prove the rootfs boots `ro` (and how not to)

> ⚠️ WARNING: **`/proc/mounts` is not evidence.** By the time you can SSH in, `qmanager_setup` has already run `mount -o remount,rw /` and never restored `ro`, so `/` reads `rw` — the *aftermath of our own remount*, not the boot state. Reading it as "the rootfs is writable, no remount needed" is a wrong conclusion that has already been reached once in this project's history, and it is the reason this section exists.

The authoritative proof is the kernel command line, which is fixed by the bootloader and cannot be rewritten by userspace:

```sh
cat /proc/cmdline
# ... ro rootwait rootfstype=ubifs rootflags=bulk_read root=ubi0:rootfs ...
#     ^^ the rootfs is mounted read-only by the kernel at boot
```

> ⚠️ WARNING: **`assert=read-only` in the ubifs mount options is NOT the mount mode.** It is UBIFS's *assertion-failure policy* — what the filesystem does when an internal consistency assertion trips (complain and switch itself read-only) rather than panicking. It appears verbatim on volumes that are mounted `rw`, including `ubi2_0`. Never cite it as evidence in either direction; use `/proc/cmdline` for the boot state and a real write probe for the current state.

#### The single convention: remount `rw` once, never restore `ro`

`mount -o remount,rw /` is inherited from the upstream `iamromulan/quectel-rgmii-toolkit` installer and is long-tested on this hardware. It is required, not defensive clutter.

- **`qmanager_setup` performs the boot-time remount.** Every later writer inherits an already-`rw` rootfs. Root-side helpers still probe-then-remount for their own sake, because they may run before or without `qmanager_setup`.
- **Nothing restores `ro`.** `qmanager_tailscale_mgr` and `qmanager_console_mgr` used to, and were the direct trigger for the bug below. Do not reintroduce a `mount -o remount,ro /` anywhere.
- **Never remove or weaken an existing `mount -o remount,rw /`.** If it looks redundant because `/proc/mounts` says `rw`, re-read the warning above.
- **Keep every `sync` after a rootfs mutation.** `sync` flushes dirty UBIFS pages to flash so a write survives an unclean power cut. That is completely independent of mount mode — removing the `ro` remount does not make the `sync` unnecessary, and the two scripts above kept theirs.

#### Rules for any new writer of a rootfs path

Three things, all of them mandatory:

1. **Ensure `rw` — but only as root.** `www-data` has **no** sudoers grant for `mount`, deliberately, and must not attempt a remount. On the CGI path the correct behaviour is to attempt the write and *report* the failure, not to try to repair the filesystem.
2. **Verify the post-condition, not the exit code.** Under `EROFS` (read-only filesystem) BusyBox returns 1 from both `ln -sf` and `rm -f` — note that `-f` masks `ENOENT` ("no such file") but **not** `EROFS`. Rather than reasoning about which errno you got, check the thing you wanted: `[ -L "$link" ]` after an enable, `[ ! -L "$link" ]` after a disable.
3. **Return a real status and make the caller act on it.** Capture stderr into `qlog_warn` instead of `2>/dev/null`, return 0/1, and surface a `cgi_error` rather than reporting success.

**Reference implementations — copy these, don't invent a third pattern:**

- `scripts/usr/lib/qmanager/platform.sh` — `_svc_ensure_rw()` (probe with a throwaway `touch`, remount only if the probe fails, never restore `ro`; called only when `$_SUDO` is empty, i.e. running as root) plus `svc_enable()` / `svc_disable()`, which log the real stderr and verify the symlink's presence/absence.
- `scripts/usr/bin/qmanager_auto_update_arm` — the same shape for a `timers.target.wants/` symlink, with the `# Left rw afterwards` comment that names the convention.

#### The failure this contract prevents

Worth understanding, because the symptom pointed nowhere near the cause.

Before the fix, `svc_enable`/`svc_disable` sent `ln`/`rm` stderr to `/dev/null`, returned whatever fell out, and all nine call sites ignored it. Meanwhile `qmanager_tailscale_mgr` and `qmanager_console_mgr` restored `ro` on exit — so installing, updating or removing Tailscale (or finishing a fresh install) left `/` read-only **for the rest of the uptime**.

The chain: user toggles Watchdog, SMS Forwarding, tower failover or Discord in the UI → `ln -sf` fails with `EROFS` → the error is discarded → the CGI reports success and `systemctl start` even works, so the feature visibly runs → but the boot symlink was never written, so the feature silently disappears at the next reboot with no error anywhere.

And it was permanent: the installer's `enable_services()` restored gated services from their **pre-install symlink state**, so a symlink lost to `EROFS` stayed lost through every subsequent OTA. That half is fixed by the config-gated self-heal described in [reference/qmanager-independence.md](reference/qmanager-independence.md#ota-self-heal-for-gated-services).

---

## 3. Source Tree Layout

All paths are relative to the repository root. The source tree mirrors the device filesystem exactly.

| Source path | Device path | Contents |
|-------------|-------------|----------|
| `scripts/usr/bin/` | `/usr/bin/` | Daemon and utility scripts (qmanager_*) |
| `scripts/usr/lib/qmanager/` | `/usr/lib/qmanager/` | Shared shell libraries |
| `scripts/etc/systemd/system/` | `/lib/systemd/system/` | Systemd unit files |
| `scripts/etc/sudoers.d/qmanager` | `/etc/sudoers.d/qmanager` (also `/opt/etc/sudoers.d/qmanager`) | Sudoers rules for www-data |
| `scripts/etc/udev/rules.d/99-qmanager-smd11.rules` | `/etc/udev/rules.d/99-qmanager-smd11.rules` | udev rule for /dev/smd11 |
| `scripts/etc/udev/scripts/qmanager_smd11_udev.sh` | `/usr/lib/qmanager/qmanager_smd11_udev.sh` | udev helper script |
| `scripts/etc/qmanager/` | `/etc/qmanager/` | Persistent config and state (template files) |
| `scripts/www/cgi-bin/quecmanager/` | `/usrdata/qmanager/www/cgi-bin/quecmanager/` | CGI scripts |
| `scripts/usrdata/qmanager/lighttpd.conf` | `/usrdata/qmanager/lighttpd.conf` | lighttpd configuration |
| `scripts/usrdata/qmanager/console/` | `/usrdata/qmanager/console/` | Web console (ttyd) |
| `dependencies/qmanager_atd` | `/usr/bin/qmanager_atd` (+ `qcmd`, `qsms` symlinks) | AT/SMS/QMI broker (Rust, static musl armhf) |
| `dependencies/ttyd` | `/usrdata/qmanager/console/ttyd` | Web terminal binary (ARMv7) |

**Note on `qmanager_smd11_udev.sh`:** The source path (`scripts/etc/udev/scripts/`) is deliberately outside `scripts/usr/lib/qmanager/` to prevent the installer's glob copy from resetting its execute bit to 644. The installer copies it to `/usr/lib/qmanager/` with explicit `chmod +x`.

---

## 4. Shared Libraries

All libraries live at `/usr/lib/qmanager/` on the device. Each uses a guard variable to prevent double-sourcing (e.g., `[ -n "$_CGI_BASE_LOADED" ] && return 0`). Source order matters: `qlog.sh` should be sourced before any library that calls `qlog_*`.

### 4.1 `cgi_at.sh`

AT command helpers for CGI scripts and daemons. Source after `qlog.sh` or `cgi_base.sh`.

| Function | Description |
|----------|-------------|
| `strip_at_response <raw>` | Remove command echo, `OK`, and `ERROR` lines from a raw qcmd response |
| `run_at <at_command>` | Execute an AT command via qcmd; returns stripped response or rc=1 on error |
| `detect_active_cid` | Determine active WAN CID via `AT+CGPADDR;+QMAP="WWAN"`; sets global `active_cid` |
| `parse_cgdcont <raw>` | Parse `AT+CGDCONT?` response into a JSON array `[{cid, pdp_type, apn}]` |
| `validate_imei <imei>` | Validate that imei is exactly 15 decimal digits; returns 0/1 |
| `wait_modem_ready <seconds>` | Block for N seconds to allow AT interface to stabilise after boot |

### 4.2 `cgi_auth.sh`

Cookie-based authentication library. Sourced automatically by `cgi_base.sh`. Storage:
- `/etc/qmanager/auth.json` — password hash + salt (SHA-256, persistent)
- `/tmp/qmanager_sessions/<token>` — one file per session (RAM, cleared on reboot)
- `/tmp/qmanager_auth_attempts.json` — rate limiting state (5 attempts / 5-minute window)

Session tokens are 64-char hex strings (256 bits). Session TTL is 3600 seconds.

| Function | Description |
|----------|-------------|
| `is_setup_required` | Returns 0 if `auth.json` is missing or empty (first-run state) |
| `qm_generate_salt` | Generate a 32-char hex salt from `/dev/urandom` |
| `qm_hash_password <pw> <salt>` | SHA-256 hash of `salt+password` |
| `qm_timing_safe_compare <a> <b>` | Constant-time string comparison via awk |
| `qm_verify_password <pw>` | Verify password against stored hash+salt in `auth.json` |
| `qm_save_password <pw>` | Hash and persist a new password to `auth.json` (chmod 600) |
| `qm_cookie_var <name> <var>` | Set `<var>` to the named cookie's value from `$HTTP_COOKIE` with no subshell; returns 0 if present, 1 if absent. Prefer this |
| `qm_get_cookie <name>` | Print the named cookie value (wrapper over `qm_cookie_var`; forks when used as `$(…)`) |
| `qm_set_session_cookies <token>` | Emit `Set-Cookie` headers for session + indicator cookies |
| `qm_clear_session_cookies` | Emit `Set-Cookie` headers that expire both cookies |
| `qm_generate_token` | Generate a 64-char hex session token |
| `qm_create_session` | Create session file in `SESSIONS_DIR`, return token |
| `qm_validate_session <token>` | Check token exists, is valid hex, and is not expired |
| `qm_destroy_session <token>` | Remove session file |
| `qm_cleanup_sessions` | Remove expired session files (called on login) |
| `qm_check_rate_limit` | Check if caller is rate-limited; sets `RATE_LIMIT_RETRY_AFTER` |
| `qm_record_failed_attempt` | Increment failed attempt counter |
| `qm_clear_attempts` | Clear rate limit state |
| `qm_set_ssh_password <pw>` | Pipe password to `qmanager_set_ssh_password` via sudo |
| `require_auth` | Main auth gate; exits 401 if session invalid or setup required |

### 4.3 `cgi_base.sh`

HTTP headers, POST parsing, and JSON response helpers. Source this at the top of every CGI script. Automatically sources `qlog.sh`, `platform.sh`, and `cgi_auth.sh`. Automatically calls `require_auth` unless `_SKIP_AUTH=1` is set before sourcing.

```sh
# Standard CGI header
_SKIP_AUTH=1   # set only for auth/* endpoints
. /usr/lib/qmanager/cgi_base.sh
```

PATH is exported at source time to include `/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin`.

| Function | Description |
|----------|-------------|
| `cgi_headers` | Emit `Content-Type: application/json` + CORS + blank line |
| `cgi_handle_options` | Exit 0 immediately for OPTIONS (CORS preflight) |
| `cgi_read_post` | Read stdin into `$POST_DATA` using `$CONTENT_LENGTH`; exits on empty body |
| `cgi_method_not_allowed` | Emit 405 JSON and exit |
| `cgi_success` | Emit `{"success":true}` |
| `cgi_error <code> <detail>` | Emit `{"success":false,"error":$code,"detail":$detail}` |
| `cgi_reboot_response` | Emit success, then async-wait for `/tmp/qmanager_reboot_ack` (up to `$QM_REBOOT_ACK_TIMEOUT`s, default 20) before issuing reboot via `run_reboot`. See [§4.3.1 Reboot Ack Handshake](#431-reboot-ack-handshake). |
| `serve_ndjson_as_array <file> [limit]` | Serve an NDJSON file as a JSON array; emits `[]` if missing. Optional `limit` serves only the newest N lines (default `0` = whole file) |

#### 4.3.1 Reboot Ack Handshake

Any CGI endpoint that triggers a reboot must call `cgi_reboot_response` — never inline `( sleep N && reboot )`. The helper coordinates with the static `/reboot/` page so the device only reboots **after** the countdown UI is in browser memory; otherwise lighttpd dies mid-serve and the user gets a connection-reset error instead of a countdown.

The contract:

1. CGI emits `{"success":true}` and forks a background block that polls `/tmp/qmanager_reboot_ack` once a second.
2. Frontend redirects to `/reboot/` on save success (see the [Reboot Navigation Pattern](FRONTEND.md#reboot-navigation-pattern) in FRONTEND.md).
3. The `/reboot/` page (`components/reboot/reboot-countdown.tsx`) fires `GET /cgi-bin/quecmanager/system/update.sh?action=reboot_ack` on mount, which creates `/tmp/qmanager_reboot_ack`.
4. The CGI background block sees the ack file, removes it, sleeps `$QM_REBOOT_POST_ACK_DELAY` seconds, then calls `run_reboot`.
5. If the user closed the tab or a non-UI caller invoked the endpoint, the wait is bounded — the reboot fires after `$QM_REBOOT_ACK_TIMEOUT` seconds regardless. The contract cannot hang.

Tunables (export before sourcing or before the call):

| Variable | Default | Purpose |
|----------|---------|---------|
| `QM_REBOOT_ACK_TIMEOUT` | `20` | Max seconds to wait for the ack file before forcing reboot. Matches the OTA worker's `REBOOT_ACK_TIMEOUT` in `qmanager_update` so every reboot path shares one budget. |
| `QM_REBOOT_POST_ACK_DELAY` | `1` | Grace seconds after ack is received, before `run_reboot` runs. Lets the browser finish painting the countdown's initial frame. |

The OTA worker (`qmanager_update`) is **not** a CGI and reaches reboot via its own ack-wait loop using the same file. Both paths use the same 20s budget so user expectations match wherever the reboot was triggered.

### 4.4 `config.sh`

File-backed key-value config store. Replaces UCI for RM520N-GL. Config file: `/etc/qmanager/qmanager.conf` (JSON). Sections: `watchcat`, `bridge_monitor`, `eth_link`, `settings`, `update`.

| Function | Description |
|----------|-------------|
| `qm_config_init` | Create default config file if missing or empty |
| `qm_config_get <section> <key> [default]` | Read a value; returns default if missing |
| `qm_config_set <section> <key> <value>` | Write a value atomically (numeric values stored as numbers) |
| `qm_config_section <section>` | Return entire section as a JSON object |

**Note on `qm_config_get` and `false`:** Uses `// empty` which treats `false` as absent. All values in this config are strings or integers, never boolean `false`, so this is safe. If a future field needs boolean `false`, use the explicit null-check pattern instead.

### 4.5 `email_alerts.sh`

Email alert **transport** library. Sourced by `qmanager_poller` (via `alert_engine.sh`) and by the `monitoring/alerts.sh` CGI. Since the centralized-alerts consolidation this library only knows how to **send** an email via `msmtp` — downtime tracking, threshold evaluation, and dispatch timing now live in `alert_engine.sh` (see 4.x below). It no longer owns a downtime state machine of its own.

Config: `/etc/qmanager/email_alerts.json`. Log: `/tmp/qmanager_email_log.json` (NDJSON, max 100 entries; every writer is root — the CGI's test send moved behind `qmanager_email_send`). msmtp config: `/etc/qmanager-secrets/msmtprc`, `0600 root:root` inside a `0700` directory, rendered by the `qmanager_secret_set` root helper on save. Reload flag: `/tmp/qmanager_email_reload` (touched by the CGI, consumed by `alert_engine.sh`).

There is deliberately no `_ea_app_password` variable any more: the password is not in `email_alerts.json` at all, and `_ea_read_config` decides "is email configured" from the non-secret `app_password_set` marker instead. See [alerts.md](reference/alerts.md#secret-storage-etcqmanager-secrets).

**Critical:** The generated `msmtprc` must NOT include a `logfile` directive. msmtp returns rc=1 if it cannot write its log, even when the email sends successfully.

msmtp binary is detected at source time from `/opt/bin/msmtp` (Entware) or `/usr/bin/msmtp`.

| Function | Description |
|----------|-------------|
| `email_alerts_init` | Read config; log enabled/disabled state (legacy init; the poller now inits via `alert_engine_init`) |
| `email_alert_send <subject> <body>` | Send one email now (the transport entry point called by `alert_engine.sh` and the CGI test) |
| `_ea_read_config` | Read `email_alerts.json` into `_ea_*` state variables (`_ea_enabled`, `_ea_recipient`, `_ea_app_password_set`, `_ea_threshold_minutes`, …). Forces `_ea_enabled=false` when `app_password_set` is not `true` — the single authority on "is email configured" |
| `_ea_send_test_email` | Send test email — canned subject/body; called **only** by the `qmanager_email_send` root helper, no longer inline from the CGI |
| `_ea_do_send <subject> <html_body>` | Core msmtp send function |
| `_ea_log_event <trigger> <status> <recipient>` | Append NDJSON entry to email log |
| `_ea_format_duration <secs>` | Convert seconds to human-readable string (e.g., `1h 2m 3s`) |
| `_ea_build_generic_html` / `_ea_build_test_html` | Build notification HTML bodies |

### 4.6 `events.sh`

Network event detection library. Sourced by `qmanager_poller` and `qmanager_watchcat`. Detects state changes and appends NDJSON events to `/tmp/qmanager_events.json` (max `$MAX_EVENTS` = 300 entries). Reads global state variables populated by the poller's AT parsers.

| Function | Description |
|----------|-------------|
| `append_event <type> <message> [severity]` | Append one event record to `$EVENTS_FILE`; trims to `$MAX_EVENTS` |
| `_ev_settle <channel> <value>` | Settle debounce for band / PCI. rc 0 = settled (sets `$_EV_SETTLED_FROM` / `$_EV_SETTLED_TO`), rc 1 = nothing to report, rc 2 = churning (sets `$_EV_FLAP_N`). Blank values are skipped as absent observations |
| `snapshot_event_state` | Snapshot current state into `prev_ev_*` variables. Band and PCI keep last-known-good across a blank reading |
| `detect_events` | Compare current vs previous state; emit events for all changes |
| `detect_data_connection_events` | Detect internet up/down and high latency/loss events (debounced) |
| `detect_scc_pci_changes` | Detect SCC cell handoffs via `$PCI_STATE_FILE`; called on Tier 2 refresh |
| `_ev_bands <tech> <cc_json>` | Extract compact band list from carrier_components JSON |
| `_ev_band_summary <tech> <cc_json>` | Build band + total bandwidth summary string |
| `_ev_ca_diff <tech> <prev_cc> <curr_cc>` | Compute added/removed bands; sets `_diff_added` / `_diff_removed` |
| `_ev_net_context` | Build short network context string from current globals |

**First-cycle behaviour:** `detect_events` populates `prev_ev_*` on the first call without emitting events. Set `events_initialized=false` at startup.

**Band / PCI debounce:** the four discrete radio identifiers (`lte_band`, `lte_pci`, `nr_band`, `nr_pci`) are routed through `_ev_settle` rather than compared with a raw `!=`. A value must hold for `EV_SETTLE_SAMPLES` (3, ~9s at the measured ~3s cadence) consecutive non-blank observations before it is announced as `<X> settled on <new> (was <old>)`; a value changing more than `EV_FLAP_THRESHOLD` (6) times inside `EV_FLAP_WINDOW` (300s) instead emits one `warning`-severity "unstable" event per window. Per-channel counters live in poller globals (`_ev_hold_<ch>`, `_ev_holdn_<ch>`, `_ev_last_<ch>`, `_ev_flapn_<ch>`, `_ev_flapt_<ch>`, `_ev_flapr_<ch>`) and are **not** persisted, so `restore_event_state`'s positional `cut -f` decode is unaffected.

> ⚠️ WARNING: the three constants are hard-coded in `events.sh`, not config keys. No UI would set a new key, and `install_backend` only deploys config files that do not already exist, so it would never reach an upgraded device. (`quality_thresholds.json` is merge-written since 2026-10-11, so it no longer erases unknown keys.)

**Link and quality events:** `detect_data_connection_events` is the only detector for `internet_lost` / `internet_restored` and the latency/loss pairs. The poller calls it every cycle after `read_ping_data`, outside `detect_events`, and `alert_engine.sh` follows its `ev_link_state`. Rules: `docs/reference/connection-quality.md` (One detector, one alert).

> ⚠️ WARNING: `MAX_EVENTS` is defined independently by **five** producers that all append to and trim the same file (`qmanager_poller`, `qmanager_watchcat`, `qmanager_profile_apply`, `profile_mgr.sh`, `profiles/deactivate.sh`). They must agree, or the smallest value wins.

**Low power suppression:** All event detection is suppressed when `/tmp/qmanager_low_power_active` exists.

**Recovery suppression:** Internet events are suppressed while `$conn_during_recovery = "true"` to prevent spurious events during watchcat recovery actions.

### 4.7 `parse_at.sh`

AT command response parsers. Sourced by `qmanager_poller`. All functions take raw AT response strings and populate global state variables.

| Function | Populates | AT command |
|----------|-----------|------------|
| `parse_serving_cell <raw>` | `lte_state`, `nr_state`, `lte_band`, `lte_pci`, `lte_rsrp`, `lte_rsrq`, `lte_sinr`, `lte_rssi`, `lte_cell_id`, `lte_enodeb_id`, `lte_sector_id`, `lte_tac`, `lte_earfcn`, `lte_bandwidth`, `nr_band`, `nr_pci`, `nr_arfcn`, `nr_rsrp`, `nr_rsrq`, `nr_sinr`, `nr_scs`, `nr_cell_id`, `nr_enodeb_id`, `nr_sector_id`, `nr_tac`, `network_type`, `service_status` | `AT+QENG="servingcell"` |
| `parse_temperature <raw>` | `t2_temperature` | `AT+QTEMP` |
| `parse_carrier <raw>` | `t2_carrier` | `AT+COPS?` |
| `parse_sim_status <raw>` | `t2_sim_status` | `AT+CPIN?` |
| `parse_sim_slot <raw>` | `t2_sim_slot` | `AT+QUIMSLOT?` |
| `parse_version <raw>` | `boot_firmware`, `boot_build_date`, `boot_manufacturer` | `AT+CVERSION` |
| `parse_capability <raw>` | `boot_lte_category` | `AT+QGETCAPABILITY` |
| `parse_mimo <lte_raw> [nr_raw]` | `t2_mimo` | `AT+QNWCFG="lte_mimo_layers"`, `"nr5g_mimo_layers"` |
| `parse_ca_info <raw>` | `t2_ca_active`, `t2_ca_count`, `t2_nr_ca_active`, `t2_nr_ca_count`, `t2_total_bandwidth_mhz`, `t2_bandwidth_details`, `t2_carrier_components` | `AT+QCAINFO` |
| `parse_time_advance <raw>` | `lte_ta`, `nr_ta` | `AT+QNWCFG="lte_time_advance"`, `"nr5g_time_advance"` |
| `parse_qrsrp <raw>` | `sig_lte_rsrp`, `sig_nr_rsrp` | `AT+QRSRP` |
| `parse_qrsrq <raw>` | `sig_lte_rsrq`, `sig_nr_rsrq` | `AT+QRSRQ` |
| `parse_qsinr <raw>` | `sig_lte_sinr`, `sig_nr_sinr` | `AT+QSINR` |
| `parse_cgcontrdp <raw>` | `t2_apn`, `t2_primary_dns`, `t2_secondary_dns` | `AT+CGCONTRDP` |
| `parse_wan_ip <raw>` | `t2_wan_ipv4`, `t2_wan_ipv6` | `AT+QMAP="WWAN"` |
| `parse_policy_band <raw>` | `boot_supported_lte_bands`, `boot_supported_nsa_nr5g_bands`, `boot_supported_sa_nr5g_bands` | `AT+QNWPREFCFG="policy_band"` |
| `parse_ippt_mpdn_rule <raw>` | `boot_ippt_mode`, `boot_ippt_mac` | `AT+QMAP="MPDN_RULE"` |
| `parse_ippt_nat <raw>` | `boot_ippt_nat` | `AT+QMAP="IPPT_NAT"` |
| `parse_ippt_usbnet <raw>` | `boot_ippt_usbnet` | `AT+QCFG="usbnet"` |
| `parse_ippt_dhcpv4dns <raw>` | `boot_ippt_dhcpv4dns` | `AT+QMAP="DHCPV4DNS"` |

Helper functions:

| Function | Description |
|----------|-------------|
| `_sig_val <val>` | Map sentinel value -32768 or empty to `null`; pass through otherwise |
| `_antenna_to_json_array v0 v1 v2 v3` | Build 4-element JSON array with sentinel mapping |
| `_antenna_line_to_json <line> <prefix>` | Parse one `+QRSRP`/`+QRSRQ`/`+QSINR` line into a JSON array |
| `_compute_cell_parts <hex_id> [nr]` | Decode hex cell ID; sets `_cid_dec`, `_cid_enb`, `_cid_sec` |
| `_hex_to_dec <hex>` | Convert hex string to decimal |
| `map_scs_to_khz <scs_enum>` | Map SCS enum (0-4) to subcarrier spacing in kHz |
| `_lte_rb_to_mhz <rb>` | Map LTE resource block count to bandwidth in MHz |
| `_nr_bw_to_mhz <bw_enum>` | Map NR bandwidth enum to MHz |

### 4.8 `platform.sh`

Service control abstraction and sudo wrappers for CGI context. Detects whether caller is root (skips `sudo`) or www-data (uses Entware sudo at `/opt/bin/sudo` if available, else `/usr/bin/sudo`).

| Function | Description |
|----------|-------------|
| `svc_start <name>` | `systemctl start <unit>` |
| `svc_stop <name>` | `systemctl stop <unit>` |
| `svc_restart <name>` | `systemctl restart <unit>` |
| `svc_enable <name>` | Create symlink in `multi-user.target.wants/`. **Returns 0/1** — 1 means the symlink is not there afterwards. Callers must check. |
| `svc_disable <name>` | Remove symlink from `multi-user.target.wants/`. **Returns 0/1** — 1 means the symlink is still there afterwards. Callers must check. |
| `svc_is_enabled <name>` | Test whether boot symlink exists |
| `svc_is_running <name>` | Test whether unit is currently active |
| `run_iptables [args...]` | `iptables` with sudo prefix |
| `run_ip6tables [args...]` | `ip6tables` with sudo prefix |
| `run_reboot [args...]` | `reboot` with sudo prefix |
| `pid_alive <pid>` | Test `/proc/<pid>` existence (works cross-user, unlike `kill -0`) |

**Unit name translation:** `svc_*` functions translate underscores to dashes (`qmanager_watchcat` -> `qmanager-watchcat.service`) via `_svc_unit()`.

**`svc_enable` / `svc_disable` are the rootfs-writing pair.** Both touch `/lib/systemd/system/multi-user.target.wants/`, which lives on the read-only-at-boot rootfs. Each one:

- calls `_svc_ensure_rw()` **only when running as root** (`$_SUDO` empty) — `www-data` has no `mount` grant and must not attempt a remount, so on the CGI path the code detects and reports the failure rather than trying to repair it;
- captures `ln`/`rm` stderr into `qlog_warn` instead of discarding it;
- verifies the **post-condition** (`[ -L ]` / `[ ! -L ]`) rather than trusting the exit code, because BusyBox's `-f` masks `ENOENT` but not `EROFS`;
- returns 0 on success, 1 on failure.

> ⚠️ WARNING: A caller that ignores the return value reintroduces the exact silent-failure bug this pair was rewritten to fix — the service starts, the UI says success, and the feature vanishes at the next reboot. See [§2.1 Rootfs mount-mode contract](#21-rootfs-mount-mode-contract).

### 4.9 `profile_mgr.sh`

SIM profile CRUD library. No persistent process. Sourced by CGI scripts and `qmanager_profile_apply`. Profiles stored as individual JSON files under `/etc/qmanager/profiles/p_<timestamp>_<hex>.json`. Maximum 10 profiles.

| Function | Description |
|----------|-------------|
| `profile_count` | Return count of `p_*.json` files in `PROFILE_DIR` |
| `profile_list` | Return `{profiles:[...], active_profile_id}` JSON |
| `profile_get <id>` | Cat the named profile JSON file; rc=1 if not found |
| `profile_save` | Read profile JSON from stdin; create or update; enforce limit |
| `profile_delete <id>` | Remove profile file; clear active marker if it matches |
| `get_active_profile` | Print active profile ID (verifies file still exists) |
| `set_active_profile <id>` | Write ID to `ACTIVE_PROFILE_FILE` |
| `clear_active_profile` | Remove `ACTIVE_PROFILE_FILE` |
| `find_profile_by_iccid <iccid>` | Search profiles for ICCID match; print matching ID |
| `auto_apply_profile <iccid> [caller]` | Find profile, set active, spawn `qmanager_profile_apply` |
| `profile_check_lock` | Check if apply process is running; clean stale PID; sets `_profile_lock_pid` |
| `profile_acquire_lock` | Check + write PID to `PROFILE_APPLY_PID_FILE`; rc=1 if locked |

Profile JSON schema: `{id, name, mno, sim_iccid, created_at, updated_at, settings: {apn: {cid, name, pdp_type}, imei, ttl, hl, scenario_id}}`.

`settings.scenario_id` is optional (`""` = no binding). Valid values: `""`, `balanced`, `gaming`, `streaming`, or a `custom-<timestamp>` ID that exists at `/etc/qmanager/scenarios/<id>.json`. `profile_save` validates the field against this enum and rejects unknown values. See [`reference/sim-profiles.md`](reference/sim-profiles.md) for the binding semantics, gate matrix, and apply pipeline.

### 4.9a `scenario_mgr.sh`

Connection Scenario apply library. Sourced by `scenarios/activate.sh` and `qmanager_profile_apply`. Custom scenarios are stored at `/etc/qmanager/scenarios/<id>.json`; the active scenario ID is written to `/etc/qmanager/active_scenario`.

| Function | Description |
|----------|-------------|
| `scenario_get_active` | Print the currently active scenario ID, or empty if none |
| `scenario_set_active <id>` | Write active scenario ID atomically via `tmp` + `mv` |
| `scenario_clear_active` | Remove the active scenario marker |
| `scenario_lookup_custom <id>` | For a `custom-*` ID, print the stored JSON; rc=1 if missing |
| `scenario_apply <id> [mode] [lte_bands] [nsa_nr_bands] [sa_nr_bands]` | Apply mode pref + optional band locks via `AT+QNWPREFCFG`. Built-ins (`balanced`/`gaming`/`streaming`) ignore the extra args and use hardcoded modes. Custom scenarios require `mode`. Returns 0 if `mode_pref` succeeded; sets `_scenario_apply_failed` to a comma-separated list of failed band sub-steps for partial-success detection. |

### 4.10 `qlog.sh`

Centralized logging library. Writes structured log lines to `/tmp/qmanager.log` with rotation and optional syslog forwarding.

Log format: `[YYYY-MM-DD HH:MM:SS] LEVEL [component:PID] message`

| Function | Description |
|----------|-------------|
| `qlog_init <component>` | Set component name; create log directory |
| `qlog_debug <msg>` | Log at DEBUG level |
| `qlog_info <msg>` | Log at INFO level |
| `qlog_warn <msg>` | Log at WARN level |
| `qlog_error <msg>` | Log at ERROR level |
| `qlog_at_cmd <cmd> <response> [rc]` | Log AT command + response at DEBUG; truncates long responses to 200 chars |
| `qlog_lock <event> [detail]` | Log flock acquire/release/timeout/stale_recovery events |
| `qlog_state_change <field> <old> <new>` | Log state transitions at INFO level (only when old != new) |

Environment overrides: `QLOG_LEVEL` (DEBUG/INFO/WARN/ERROR, default INFO), `QLOG_FILE`, `QLOG_MAX_SIZE_KB` (default 256), `QLOG_MAX_FILES` (default 2), `QLOG_TO_SYSLOG` (default 1), `QLOG_TO_STDOUT` (default 0).

### 4.11 `semver.sh`

Semantic version comparison. Used by `qmanager_update` and `qmanager_auto_update`.

| Function | Exit codes | Description |
|----------|-----------|-------------|
| `semver_compare <a> <b>` | 0=a newer, 1=equal, 2=a older | Compare two semver strings; strips leading `v`; handles pre-release labels |

### 4.12 `sms_alerts.sh`

SMS alert **transport** library. Sourced by `qmanager_poller` (via `alert_engine.sh`) and by the `monitoring/alerts.sh` CGI. Mirrors `email_alerts.sh`: since the centralized-alerts consolidation it only knows how to **send** an SMS via `qsms send` — downtime tracking and threshold evaluation moved to `alert_engine.sh`. SMS is the only channel capable of `connection_lost` alerts, since it rides the cellular control channel and works while the data bearer is down. On the RM520N-GL `qsms` uses QMI WMS and takes no AT lock; see [`reference/sms.md`](reference/sms.md#transport-qsms).

Config: `/etc/qmanager/sms_alerts.json`. Log: `/tmp/qmanager_sms_log.json` (NDJSON, max 100 entries). Reload flag: `/tmp/qmanager_sms_reload` (touched by the CGI, consumed by `alert_engine.sh`).

**Registration guard:** Before every send attempt, `_sa_is_registered()` verifies that `modem_reachable="true"` AND (`lte_state="connected"` OR `nr_state="connected"`).

**Phone number format:** Stored with leading `+` in config; `+` is stripped via `${_sa_recipient#+}` before calling `qsms send`.

**CGI test send override:** CGI sets `_sa_is_registered() { return 0; }` after sourcing the library (the `_SMS_ALERTS_LOADED` guard prevents re-source clobber) because CGI context lacks poller globals.

| Function | Description |
|----------|-------------|
| `sms_alerts_init` | Read config; log state (legacy init; the poller now inits via `alert_engine_init`) |
| `sms_alert_send <body>` | Send one SMS now (the transport entry point called by `alert_engine.sh` and the CGI test) |
| `_sa_read_config` | Read `sms_alerts.json` into `_sa_*` state variables (`_sa_enabled`, `_sa_recipient`, `_sa_threshold_minutes`, …) |
| `_sa_is_registered` | Check modem reachable + LTE or NR connected; return 0/1 |
| `_sa_send_error <qsms-output>` | Plain-language reason from a failed `qsms send` envelope (`.detail // .error`, else a fixed sentence) |
| `_sa_do_send <body>` | Send SMS with retry; returns 0=success, 1=failed, 2=not attempted |
| `_sa_send_test_sms` | Send test SMS (called by CGI) |
| `_sa_log_event <trigger> <status> <recipient>` | Append NDJSON entry to SMS log |
| `_sa_format_duration <secs>` | Convert seconds to human-readable string |

### 4.12a `alert_engine.sh`

Unified alert engine. Sourced by `qmanager_poller`; replaces the three independent per-channel downtime state machines with ONE monotonic downtime timer (`/proc/uptime`) plus a routing × capability matrix that decides which enabled + routed + capable channel(s) fire for each of three events: `connection_lost`, `connection_restored`, `reboot`. Reads the poller globals `conn_internet_available` and `conn_during_recovery`; never probes or issues AT commands itself. Full contract in `docs/reference/alerts.md`.

Config: `/etc/qmanager/alert_routing.json` (routing matrix, version 1) plus each channel's own config. Reboot bookkeeping: `/etc/qmanager/{last_boot_id,reboot_history.json}` and read-only `/usrdata/qmanager/crash.log` (root-owned; path from `crash_log.sh`).

| Function | Description |
|----------|-------------|
| `alert_engine_init` | Called once at poller startup; resets state, runs the boot-id reboot check, loads routing + channel configs |
| `check_alerts` | Called once per poll cycle; picks up reload flags, edge-detects connectivity, dispatches effective sends |
| `_ae_capable <event> <channel>` | Hardcoded capability table (backend truth mirrored by the CGI) |
| `_ae_effective_send <event> <channel>` | capable AND master-enabled AND routing-cell-true |
| `_ae_dispatch <channel> <trigger> <message>` | Send via the channel transport and log the outcome |

### 4.13 `system_config.sh`

System settings abstraction. Replaces `uci system.@system[0].*` for hostname and timezone. Sources `config.sh`.

| Function | Description |
|----------|-------------|
| `sys_get_hostname` | Read hostname from `qmanager.conf` -> `/etc/hostname` -> default `"RM520N-GL"` |
| `sys_set_hostname <name>` | Persist the display name to `qmanager.conf`, then derive an RFC 1123 label and apply it via `sudo -n /usr/bin/qmanager_hostname_apply` (writes `/etc/hostname` and `/proc/sys/kernel/hostname`). rc 0 ok (also when no label can be derived), rc 1 config write failed, rc 2 saved but system apply failed |
| `sys_get_timezone` | Read POSIX TZ string from `qmanager.conf` (default `"UTC0"`) |
| `sys_get_zonename` | Read IANA zone name from `qmanager.conf` (default `"UTC"`) |
| `sys_set_timezone <tz> [zonename]` | Persist TZ + zonename to `qmanager.conf`, then apply the live clock via `sudo -n /usr/bin/qmanager_timezone_apply <zonename>` (copies the resolved TZif over `/etc/localtime`). Prints a status token on stdout: `applied` / `failed` / `not_attempted` / `invalid`. Does **not** write `/etc/TZ` or export `$TZ` (glibc 2.31 reads `/etc/localtime`, and `/etc/TZ` is inert here) |
| `sys_get_effective_tz` | Report the **live** timezone vs. config, so GET returns ground truth. Since `/etc/localtime` is a copied TZif (no symlink to read back), it compares `date +%z` against the offset recomputed from tzdata for the configured zone. Prints `"<live_offset> <expected_offset> <applied:0\|1> <live_zone_abbr>"` (e.g. `+0800 +0800 1 PHT`) |

> ℹ️ NOTE: The old `sys_set_timezone` symlinked `/etc/localtime`, wrote `/etc/TZ`, and exported `$TZ`. All three were inert or harmful on this platform (empty `/usr/share/zoneinfo`, glibc ignoring `/etc/TZ`, and `www-data` unable to write `/etc`), so a saved zone never reached the clock. See [Timezone](reference/timezone.md) for the full failure analysis and the root-helper design.

### 4.14 `tower_lock_mgr.sh`

Tower lock config CRUD, AT command builders, signal quality calculation, and failover watcher management. Sourced by CGI scripts and failover/schedule daemons. Config: `/etc/qmanager/tower_lock.json`.

| Function | Description |
|----------|-------------|
| `tower_config_init` | Create default config if missing or invalid |
| `tower_config_read` | Cat config to stdout; falls back to embedded default on missing/invalid |
| `tower_config_get <jq_filter>` | Extract value via jq; uses explicit null check (not `//`) |
| `tower_config_update <jq_filter>` | Apply jq filter to config; atomic write via tmp+mv |
| `tower_config_update_lte <enabled> c1_e c1_p [c2_e c2_p [c3_e c3_p]]` | Update LTE lock cells in config |
| `tower_config_update_nr <enabled> pci arfcn scs band` | Update NR-SA lock params in config |
| `tower_config_update_settings <persist> <fo_enabled> <fo_threshold>` | Update persist + failover settings |
| `tower_config_update_schedule <enabled> <start> <end> <days_json>` | Update schedule config |
| `tower_lock_lte <num_cells> earfcn1 pci1 [...]` | Send `AT+QNWLOCK="common/4g"` |
| `tower_unlock_lte` | Send `AT+QNWLOCK="common/4g",0` |
| `tower_read_lte_lock` | Query and parse LTE lock state; prints `locked N earfcn pci...` or `unlocked` |
| `tower_lock_nr <pci> <arfcn> <scs> <band>` | Send `AT+QNWLOCK="common/5g"` |
| `tower_unlock_nr` | Send `AT+QNWLOCK="common/5g",0` |
| `tower_read_nr_lock` | Query and parse NR-SA lock state; prints `locked pci arfcn scs band` or `unlocked` |
| `tower_set_persist <0\|1>` | Send `AT+QNWLOCK="save_ctrl",val,val` |
| `tower_read_persist` | Query persistence state; prints `<lte_ctrl> <nr_ctrl>` |
| `calc_signal_quality <rsrp>` | Map RSRP to 0-100 integer: `clamp(0,100,((rsrp+140)*100)/60)` |
| `tower_kill_failover_watcher` | Stop `qmanager-tower-failover` service |
| `tower_spawn_failover_watcher` | Check config, restart failover service, verify PID; prints `true`/`false` |
| `mtu_reapply_after_bounce` | Spawn background MTU re-apply watcher (polls up to 30s after interface bounce) |

### 4.15 `ttl_state.sh`

TTL/HL iptables rule management. Reads/writes `/etc/qmanager/ttl_state` (plain `TTL=N\nHL=N` format). Requires `platform.sh` to be sourced by the caller first (uses `run_iptables` / `run_ip6tables`).

TTL rules target `rmnet+` interface in `mangle POSTROUTING`. Replaces the legacy `/etc/firewall.user.ttl`.

| Function | Description |
|----------|-------------|
| `ttl_state_read_persisted` | Print `"<ttl> <hl>"` from state file; missing keys default to 0 |
| `ttl_state_read_live` | Print `"<ttl> <hl>"` from live iptables rules |
| `ttl_state_write_persisted <ttl> <hl>` | Atomic write to state file; removes file if both are 0 |
| `ttl_state_apply <ttl> <hl>` | Delete old rules, insert new rules; skips insert if value is 0 |
| `ttl_state_clear` | Apply 0 0 and remove state file |

### 4.16 `ethtool_helper.sh`

Ethernet PHY helpers for `network/ethernet.sh`. Wraps `ethtool` output parsing into reusable functions. Guards against double-sourcing via `_ETHTOOL_HELPER_LOADED`.

| Function | Description |
|----------|-------------|
| `get_supported_advertise_hex` | Parse `ethtool $ETH_INTERFACE` supported link modes into a bitmask hex string (for `ethtool --change advertise`) |
| `supports_2500` | Returns `true` if `eth0` advertises `2500baseT/Full`; `false` otherwise |

Caller must set `ETH_INTERFACE` before sourcing (default `eth0` in `ethernet.sh`).

---

## 5. Daemons & Utilities

### 5.1 Long-Running Daemons

These run continuously under systemd supervision.

#### `qmanager_poller`

**Location:** `/usr/bin/qmanager_poller`
**State files:** `/tmp/qmanager_status.json` (main cache), `/tmp/qmanager_signal_history.json`, `/tmp/qmanager_ping_history.json`, `/tmp/qmanager_events.json`
**Logs:** `/tmp/qmanager.log`

Main data collection daemon. Sources `qlog.sh`, `parse_at.sh`, `events.sh`, and `alert_engine.sh` (which in turn sources the `email_alerts.sh` / `sms_alerts.sh` / `discord_alerts.sh` transports) at startup. Alert timing is driven once per cycle via `check_alerts` (see 4.12a).

**Polling tiers:**

| Tier | Interval | AT commands |
|------|----------|-------------|
| Tier 1 (hot) | Every cycle (~2.6–4 s measured, not 2 s) | `AT+QENG="servingcell"`, `AT+QCAINFO`, `/proc` traffic stats |
| Tier 1.5 (signal) | Every 5 cycles | `AT+QRSRP;+QRSRQ;+QSINR` (one compound call) |
| Tier 2 (warm) | Every 15 cycles | `AT+QTEMP;+COPS?;+QUIMSLOT?;+CNUM;+QSIMSTAT?;+CPIN?`, `AT+CGCONTRDP;+QMAP="WWAN"`, the network-mode-gated `AT+QNWCFG="*_time_advance"` / `"*_mimo_layers"` reads |
| Boot-only | Once at startup | `AT+CVERSION`, `AT+CGSN`, `AT+CIMI`, `AT+QCCID`, `AT+CNUM`, `AT+QGETCAPABILITY`, `AT+QNWPREFCFG="policy_band"`, IPPT parsers |

The table is the `active` tier, which runs while a browser has polled within the last 20 s (`/tmp/qmanager_ui_active` heartbeat). In `idle` and `deep` the AT reads above run on longer uptime deadlines while local work still runs every cycle; the tier is published as `.device.poller_tier`. See [adaptive-polling.md](reference/adaptive-polling.md).

Network interface for traffic stats is auto-detected from the presence of `/etc/quectel-project-version`: `rmnet_ipa0` on the RM520N-GL. The `else` branch falls back to `wwan0` — a legacy holdover from the RM551E/OpenWRT lineage that the sentinel-file check bypasses on this platform.

**System Health collection (`update_system_health()`):** Runs every Tier 1 cycle. Cheap reads only — no AT commands, no extra forks beyond `awk`/`grep`/`df`. Emits a top-level `system_health` block in the cache so the `system/modem-subsys.sh` CGI can serve it as a thin reader. Sources:

| Field | Source |
|-------|--------|
| `state`, `state_raw`, `crash_count` | `/sys/devices/platform/4080000.qcom,mss/subsys0/{state,crash_count}` |
| `coredump_present` | Non-empty file under `/sys/devices/platform/4080000.qcom,mss/ramdump/ramdump_modem/` (sysfs metadata pseudo-files excluded) |
| `last_crash_at`, `total_logged_crashes` | `/etc/qmanager/modem_crashes.json` (NDJSON-style array; last entry's `ts` and `length`) |
| `cpu.load_1m` | `/proc/loadavg` (first column) |
| `cpu.core_count` | `nproc` (cached after first read — value never changes at runtime) |
| `cpu.usage_pct` | `/proc/stat` delta computed in `update_proc_metrics()` (the same value the rest of the cache uses) |
| `cpu.freq_khz`, `cpu.max_freq_khz` | `/sys/devices/system/cpu/cpu0/cpufreq/{scaling_cur_freq,scaling_max_freq}` |
| `memory.{total_kb, used_kb, available_kb}` | Derived from `device.memory_total_mb` / `device.memory_used_mb` (× 1024) |
| `storage.{mount, total_kb, used_kb, available_kb}` | `df -P /usrdata` |

The CGI reader (`/cgi-bin/quecmanager/system/modem-subsys.sh`) is now a thin `jq` extractor: it reshapes `system_health` into the historical response schema, falls back to an all-null shape if the cache is missing or older than 30s, and never re-implements live computation. Per-request cost dropped from ~80–120ms to ~15–25ms.

#### `qmanager_ping`

**Location:** `/usr/bin/qmanager_ping`
**State files:** `/tmp/qmanager_ping.json` (current verdict), `/tmp/qmanager_ping_history` (flat ring buffer), `/tmp/qmanager_dns.json` (DNS lookup time)

The single source of internet reachability data: a `#!/bin/sh` ICMP daemon walking a four-leg chain (`cloudflare.com` → `google.com` → `1.1.1.1` → `8.8.8.8`) and writing a fixed thirteen-key verdict. A detached background job also times a DNS lookup against the carrier resolver. Does not touch the modem or AT device. Stats (avg/min/max/jitter/loss) are computed by the poller from the history file.

**Config:** `/etc/qmanager/ping_profile.json` — `profile`, the four target slots, optional `interval_sec` (and readable `fail_secs` / `recover_secs` / `history_secs` overrides).

Consumers: poller and watchcat, both through `/usr/lib/qmanager/conn_state.sh` (the one reader); the frontend reads via `status.json`. Key contract, cadence, DNS job and the HTTP-era history: `docs/reference/connection-quality.md`.

#### `qmanager_sites`

**Location:** `/usr/bin/qmanager_sites` (`qmanager-sites.service`, always on)
**State files:** `/tmp/qmanager_sites.json`, `/tmp/qmanager_sites_raw.ndjson`, `/tmp/qmanager_sites_flushed`, `/tmp/qmanager_sites_checking`, `/tmp/qmanager_sites.pid`; history in `/usrdata/qmanager/sites/YYYY-MM-DD.jsonl`
**Config:** `/etc/qmanager/sites.json` (CGI-written, untrusted)

Times a TCP connect (`curl -I`, `time_connect − time_namelookup`) to each configured site every `interval_sec` (default 300), keeps 24 h raw and 90 days of hourly rollups. Never touches the modem. Full reference: `docs/reference/sites-monitor.md`.

#### `qmanager_watchcat`

**Location:** `/usr/bin/qmanager_watchcat`
**State files:** `/tmp/qmanager_watchcat.json`, `/tmp/qmanager_watchcat.pid`, `/tmp/qmanager_watchcat.lock`, `/tmp/qmanager_recovery_active`, `/etc/qmanager/qmanager_sim_failover` (persistent), `/etc/qmanager/last_iccid` (persistent), `/usrdata/qmanager/crash.log` (persistent, root-owned)
**Config:** `qmanager.conf` section `watchcat`

Pure state machine. Reads `qmanager_ping.json`; never pings independently. Full feature reference: `docs/reference/connection-watchdog.md`.

**State machine:**

```
MONITOR -> SUSPECT -> RECOVERY -> COOLDOWN -> MONITOR
          (LOCKED: maintenance mode, sleeps until lock removed)
```

**Escalation tiers:**

| Tier | UI Label | Action | Guard |
|------|----------|--------|-------|
| 1 | Re-register to Network | Network deregister/reregister (`AT+COPS=2/0`) | Enabled by default |
| 2 | CFUN Toggle | Radio toggle (`AT+CFUN=0/1`) | Skipped if tower lock active |
| 3 | SIM Failover | SIM failover (`AT+QUIMSLOT`) | Disabled by default; Golden Rule sequence; misconfig **stops the ladder** (never reboots) |
| 4 | Reboot | System reboot | Token bucket: max N/hour; auto-disables if limit hit |

LOCKED state: set by touching `/tmp/qmanager_watchcat.lock`. Watchcat sleeps until the file is removed. The update worker and installer touch this file during OTA operations.

Tier-3 SIM failover keeps its state in `/etc/qmanager/qmanager_sim_failover` (persistent, so a Tier-4 reboot doesn't lose the fact that the modem is on the backup SIM) and floors the post-swap cooldown at `SIM_SETTLE_SECS=90` so a real swap isn't judged failed before the new SIM re-attaches. After any swap or revert it also writes the landed ICCID to `/etc/qmanager/last_iccid`, so the poller's boot-time SIM-swap detector treats the change as expected instead of false-firing "New SIM detected". A Tier-3 misconfiguration (no backup slot, or backup == current slot) stops the ladder rather than escalating to a Tier-4 reboot. See `docs/reference/connection-watchdog.md` for the full lifecycle.

### 5.2 On-Demand Daemons

These are started on-demand by CGI actions and stop when their task completes.

#### `qmanager_cell_scanner`

**Location:** `/usr/bin/qmanager_cell_scanner`
**State files:** `/tmp/qmanager_cell_scan_result.json`, `/tmp/qmanager_cell_scan_error`, `/tmp/qmanager_cell_scan.pid`

Runs `AT+QSCAN` (may take >60 seconds). Writes scan results with MCC/MNC lookups from `/usrdata/qmanager/www/cgi-bin/quecmanager/operator-list.json`. Spawned by `at_cmd/cell_scan_start.sh`; polled by `at_cmd/cell_scan_status.sh`. It does not write the long-running flag: the broker raises `/run/qmanager_at/long_running` around `AT+QSCAN` once it holds the AT lock. It inherits the `/tmp/qmanager_scan.lock` `flock` from the start endpoint and holds it for its whole run.

#### `qmanager_neighbour_scanner`

**Location:** `/usr/bin/qmanager_neighbour_scanner`
**State files:** `/tmp/qmanager_neighbour_scan_result.json`, `/tmp/qmanager_neighbour_scan_error`, `/tmp/qmanager_neighbour_scan.pid`

Runs `AT+QENG="neighbourcell"` (LTE leg) then `AT+QNWCFG="nr5g_meas_info"` (NR leg). Spawned by `at_cmd/neighbour_scan_start.sh`; polled by `at_cmd/neighbour_scan_status.sh`. Inherits the same `/tmp/qmanager_scan.lock` `flock`. It captures each leg's `qcmd` stderr to a `*_err.tmp` file so a `modem_busy` collision is reported differently from a real AT failure, and a leg that was blocked while the other found zero rows is reported as an **error**, never as "complete — 0 cells". `AT+QENG` is not a long command, so no long-running flag is raised for it (~2 s hold). See [reference/cell-scanner.md](reference/cell-scanner.md).

#### `qmanager_band_failover`

**Location:** `/usr/bin/qmanager_band_failover`
**State files:** `/tmp/qmanager_band_failover.json`, `/tmp/qmanager_band_failover.pid`

Monitors signal quality and falls back to a configured backup band configuration when the primary drops below threshold. Spawned and stopped by `bands/failover_toggle.sh`.

#### `qmanager_tower_failover`

**Location:** `/usr/bin/qmanager_tower_failover`
**State files:** `/tmp/qmanager_tower_failover.json`, `/tmp/qmanager_tower_failover.pid`, `/tmp/qmanager_tower_failover`

Monitors signal quality against the tower lock failover threshold. When quality drops below threshold, clears the tower lock. Spawned by `tower_lock_mgr.sh`'s `tower_spawn_failover_watcher()` when failover is enabled. Configured via `tower_lock.json` section `failover`.

#### `qmanager_tower_schedule`

**Location:** `/usr/bin/qmanager_tower_schedule`
**State files:** `/tmp/qmanager_tower_schedule.pid`

Applies and removes tower lock on a time schedule. Reads `tower_lock.json` section `schedule`. Spawned by `tower/schedule.sh` when schedule is enabled.

#### `qmanager_profile_apply`

**Location:** `/usr/bin/qmanager_profile_apply`
**State files:** `/tmp/qmanager_profile_state.json`, `/tmp/qmanager_profile_apply.pid`

Detached process spawned by `profiles/apply.sh`. Applies a saved profile to the modem in four steps (`STEP_NAMES="apn ttl_hl scenario imei"`):
1. APN -- `AT+CGDCONT` + full attach cycle (see [`reference/wan-profile-management.md`](reference/wan-profile-management.md))
2. TTL/HL -- iptables rules via `ttl_state_apply`
3. Scenario -- `scenario_apply` from `scenario_mgr.sh`; skipped if `settings.scenario_id` is empty; marks `skipped` with detail `"Scenario <id> no longer exists"` for a dangling custom reference
4. IMEI -- `AT+EGMR` + `AT+CFUN=1,1` soft reboot (most disruptive, applied last)

Scenario MUST precede IMEI: `AT+CFUN=1,1` reboots the radio, so any `AT+QNWPREFCFG` writes after it would be lost.

State JSON tracks current step, total steps (4), and per-step status (`pending`/`running`/`done`/`skipped`/`failed`). Polled by `profiles/apply_status.sh`. Singleton via PID file; `profile_check_lock()` guards against concurrent runs.

### 5.3 Boot Oneshots

These run once at boot via systemd oneshot units.

#### `qmanager_setup`

**Location:** `/usr/bin/qmanager_setup`

Pre-create shared `/tmp` files with correct ownership for `fs.protected_regular=1`. Set `/dev/smd11` permissions. Ensure required directories exist. Initialize `qmanager.conf` defaults. Make all CGI scripts and binaries executable.

Key pre-creates (see §10 and §11 for the full list and rationale):
- `/run/qmanager_at/` -- `root:dialout` mode 0750, and `/run/qmanager_at/at.lock` -- `root:dialout` mode 0640 (first thing the script does; never truncates an existing lock)
- `/tmp/qmanager.log` -- `root:root` mode 666
- `/tmp/qmanager_sessions/` -- `www-data:www-data` mode 700

#### `qmanager_firewall`

**Location:** `/usr/bin/qmanager_firewall`

Manages iptables rules restricting web UI access (ports 80/443) to trusted interfaces (`lo`, `bridge0`, `eth0`, `tailscale0` if installed). Invoked as `qmanager_firewall start` / `stop` by the systemd unit. SSH (port 22) is intentionally left open for emergency access.

#### `qmanager_imei_check`

**Location:** `/usr/bin/qmanager_imei_check`

One-shot check that runs after boot if `/etc/qmanager/imei_check_pending` exists. Reads `/etc/qmanager/imei_backup.json` and verifies/restores IMEI settings. The systemd unit's `ExecStartPre` guards skip the service if the pending marker or backup file is absent.

#### `qmanager_mtu_apply`

**Location:** `/usr/bin/qmanager_mtu_apply`

Apply custom MTU from `/etc/firewall.user.mtu` to `rmnet_data*` interface at boot. The systemd unit has `ConditionPathExists=/etc/firewall.user.mtu` so it is a no-op if no custom MTU is configured.

### 5.4 Timer-Driven

These are invoked by runtime-generated systemd `OnCalendar` timers, armed by the
`qmanager_*_arm` root helpers that the CGI calls over `sudo -n`.

> ⚠️ WARNING: RM520N-GL ships a BusyBox `crond` binary but **never runs it** — no
> systemd unit, no boot symlink, no reader of `/var/spool/cron/crontabs/`. Every
> schedule on this platform is a systemd timer. Anything in older docs or
> comments describing a "crontab entry written by the CGI" describes code that
> was a silent no-op and has since been replaced. See
> [scheduled-timers.md](reference/scheduled-timers.md).

#### `qmanager_scheduled_reboot`

**Location:** `/usr/bin/qmanager_scheduled_reboot`

Performs a scheduled reboot at the configured time. Fired by
`qmanager-scheduled-reboot.timer`, which `system/settings.sh` (`save_scheduled_reboot`)
arms via `sudo -n /usr/bin/qmanager_scheduled_reboot_arm` when `sched_reboot_enabled=1`.
Config: `qmanager.conf` section `settings`.

#### `qmanager_auto_update`

**Location:** `/usr/bin/qmanager_auto_update`

Checks GitHub for a newer release and spawns `qmanager_update install` if a newer version is available. Fired by `qmanager-auto-update.timer`, armed by `system/update.sh` (`save_auto_update`) via `sudo -n /usr/bin/qmanager_auto_update_arm` when `auto_update_enabled=1`. Config: `qmanager.conf` section `update`. Uses `semver_compare` from `semver.sh`.

**Note on low-power scheduling:** Low-power mode configuration (start/end times, days) is stored in `qmanager.conf` section `settings` and managed by `system/settings.sh` CGI. The flag file `/tmp/qmanager_low_power_active` is checked by `alert_engine.sh` (which freezes all alert dispatch) and `events.sh` to suppress activity during low-power windows.

### 5.5 Helper Utilities

These are invoked on-demand by CGI scripts via sudo, or interactively.

#### `qcmd`

**Location:** `/usr/bin/qcmd`
**Lock file:** `/run/qmanager_at/at.lock`
**Is:** a symlink to `qmanager_atd` (Rust, static), on every model

The single entry point for all modem AT communication. Serializes access to `/dev/smd11` via `flock`. On the RM520N-GL and the RG501Q-EU it sends through the `qmanager_atd` broker and falls back in-process when the broker is down; on an unknown model (no broker unit) it always runs in-process. No PTY bridge, no socat.

```sh
qcmd "AT+COMMAND"      # Returns raw response
qcmd -j "AT+COMMAND"   # Returns JSON-wrapped response
qcmd -t 2500 "AT+..."  # Caps the wait at 2500 ms; a cap that runs out is modem_busy (or QCMD_WAIT_MS=2500 for one call)
```

Failure is exit 1 with an empty stdout and `ERROR: modem_busy` or `ERROR: command_failed` on stderr. Long commands (`QSCAN`, `QSCANFREQ`, `QFOTADL`, `COPS=2`, `COPS=0`, plus `/etc/qmanager/long_commands.list`) get a longer lock wait (10s vs 5s). Full contract: [at-command-transport.md](reference/at-command-transport.md).

#### `qmanager_tailscale_mgr`

**Location:** `/usr/bin/qmanager_tailscale_mgr`

Manages Tailscale VPN install/uninstall/status. Called via `sudo -n` from `vpn/tailscale.sh` CGI. Uses a two-layer execution pattern: outer wrapper stages an inner install script and a temporary systemd oneshot unit, fires the unit, then returns immediately. The inner script runs detached under systemd. Progress: `/tmp/qmanager_tailscale_install.json`. Log: `/tmp/qmanager_tailscale_install.log`. See CLAUDE.md section on Tailscale for detailed behavioral notes.

#### `qmanager_console_mgr`

**Location:** `/usr/bin/qmanager_console_mgr`

Manages the web console (ttyd) service. Called via `sudo -n` from the console CGI. Controls `qmanager-console.service` via `svc_start`/`svc_stop`.

#### `qmanager_set_ssh_password`

**Location:** `/usr/bin/qmanager_set_ssh_password`

Reads a new root password from stdin, hashes it with `openssl passwd -1`, and updates `/etc/shadow`. Called via `sudo -n` from `cgi_auth.sh`'s `qm_set_ssh_password()`. Invoked automatically during onboarding (syncs web UI password to root) and from System Settings.

#### `qmanager_secret_set`

**Location:** `/usr/bin/qmanager_secret_set`

Stores, clears, and refreshes the two alert-channel credentials in `/etc/qmanager-secrets/`, and maintains the non-secret `token_set` / `app_password_set` markers in the config JSONs. Called via `sudo -n` from `monitoring/alerts.sh`.

```
qmanager_secret_set set     <name>      # value read from STDIN, never argv
qmanager_secret_set clear   <name>
qmanager_secret_set refresh email_app_password
```

`<name>` is a hard two-literal whitelist (`discord_bot_token` | `email_app_password`); every path is hardcoded, nothing from argv is interpolated into one. `set email_app_password` also renders `/etc/qmanager-secrets/msmtprc`; `refresh` re-renders it from the already-stored password (needed when only `sender_email` changed). Prints one line of JSON; exit `0`/`1`.

> ⚠️ WARNING: The secret value goes on **stdin**, never as an argument — `/proc/<pid>/cmdline` is world-readable, so an argv-passed credential would leak to every local process for the lifetime of the call. Same idiom as `qmanager_set_ssh_password`.

Stores the credential **first** and writes the marker **last**, so a downstream failure never leaves the secret unstored and the resulting `marker_write_failed` error is safely retryable. See [alerts.md](reference/alerts.md#secret-storage-etcqmanager-secrets).

#### `qmanager_email_send`

**Location:** `/usr/bin/qmanager_email_send`

Sends the canned QManager test email. One verb, `test`; reads nothing from stdin; subject and body are constants inside `email_alerts.sh`, so it cannot be driven into sending arbitrary content. Sender/recipient come from `email_alerts.json`, which root reads directly.

It exists because `msmtprc` moved into the root-only secrets store: the CGI used to run `msmtp -C` inline as `www-data` and can no longer read (or even `stat`) the credential. It grants `www-data` **no new capability** — `www-data` already owns `email_alerts.json` and could already trigger a test send; the helper only removes its need to read the password. Kept separate from `qmanager_secret_set` on purpose: custody of secrets and sending mail are different privileges and should stay separately auditable.

#### `qmanager_reset_password`

**Location:** `/usr/bin/qmanager_reset_password`

Resets the QManager web UI password. Interactive utility; typically invoked via SSH.

#### `qmanager_timezone_apply`

**Location:** `/usr/bin/qmanager_timezone_apply`

Applies an IANA timezone to the live clock by copying the resolved TZif file over `/etc/localtime`. Called via `sudo -n` from `sys_set_timezone` (`system_config.sh`) because `www-data` cannot write root-owned `/etc`. Validates the zone name (empty / `..` traversal / charset / `TZif` magic-byte checks), resolves it from `/opt/share/zoneinfo` (Entware, fallback `/usr/share/zoneinfo`, plus an `Etc/UTC` fallback for bare `UTC`), then installs it atomically via a temp file **inside** `/etc`. Copies rather than symlinks because `/opt` is a late-boot bind-mount and a symlink would dangle in early boot. Prints a one-line JSON result and exits `0` on success. See [Timezone](reference/timezone.md).

#### `qmanager_logread`

**Location:** `/usr/bin/qmanager_logread`

Read and format log entries. Called via `sudo -n` from `system/logs.sh` CGI.

#### `qmanager_update`

**Location:** `/usr/bin/qmanager_update`

OTA update worker. See §12 for full pipeline description. Called via `sudo -n` from `system/update.sh` CGI. Runs as root; manages its own log at `/tmp/qmanager_update.log`.

---

## 6. Systemd Services

**Boot persistence model:** Boot persistence uses direct symlinks in `/lib/systemd/system/multi-user.target.wants/`. `systemctl enable` does not work on RM520N-GL because unit files live on a partition where the `systemctl enable` mechanism cannot write. Use `svc_enable`/`svc_disable` from `platform.sh`.

**`UCI_GATED_SERVICES` pattern:** The four services in this set (`qmanager-watchcat`, `qmanager-tower-failover`, `qmanager-discord`, `qmanager-sms-forward`) get their boot symlink from **their own config file, not from prior symlink state**. `install_rm520n.sh` routes all four through `_apply_gated_symlink()`, which `ln -sf`s the unit when the config says explicitly enabled and `rm -f`s it when the config says explicitly disabled. The variable is named `UCI_GATED_SERVICES` for historical reasons (RM551E had UCI-gated enables); there is no UCI involvement on RM520N-GL.

> ℹ️ NOTE: **An unreadable config never disables a service.** A missing file, an unparseable file, or an absent key all leave the existing symlink exactly as it is — only an explicit `false`/`0` removes it. "I couldn't read your setting" and "you turned this off" are different claims, and the installer must never confuse them. See [qmanager-independence.md > OTA self-heal for gated services](reference/qmanager-independence.md#ota-self-heal-for-gated-services).

| Service | Type | Binary | Description |
|---------|------|--------|-------------|
| `lighttpd.service` | simple | `/opt/sbin/lighttpd` | Entware lighttpd; uses `/usrdata/qmanager/lighttpd.conf`; after `opt.mount` |
| `qmanager-atd.service` | notify (`WatchdogSec=30`) | `/usr/bin/qmanager_atd` | AT broker; **RM520N-GL and RG501Q-EU** (gate `qm_hw_atd_enabled`; the installer leaves the unit off other models). `After=qmanager-setup`, `Before=qmanager-poller`; `ExecStartPre` waits up to 30 s for `/dev/smd11`; `Restart=on-failure`. Socket `/var/run/qmanager_atd.sock` (`root:dialout 0660`). See [at-command-transport.md](reference/at-command-transport.md) |
| `qmanager-console.service` | simple | `/usrdata/qmanager/console/ttyd` | Web terminal on `127.0.0.1:8080`, reverse-proxied at `/console` |
| `qmanager-firewall.service` | oneshot | `/usr/bin/qmanager_firewall` | Port firewall; runs before setup and lighttpd |
| `qmanager-imei-check.service` | oneshot | `/usr/bin/qmanager_imei_check` | Post-boot IMEI restore; guarded by `ExecStartPre` condition checks |
| `qmanager-mtu.service` | simple | `/usr/bin/qmanager_mtu_apply` | MTU persistence; `ConditionPathExists=/etc/firewall.user.mtu` |
| `qmanager-ping.service` | simple | `/usr/bin/qmanager_ping` | Ping daemon; required by poller |
| `qmanager-poller.service` | simple | `/usr/bin/qmanager_poller` | Main data poller; guards `/dev/smd11` in `ExecStartPre`; sources Data Used (schema 6, with a static SoC-derived orientation map resolved once at startup) from `/proc/net/dev` every cycle, in every activity tier |
| `qmanager-setup.service` | oneshot (RemainAfterExit) | `/usr/bin/qmanager_setup` | Permission setup; before ping and poller |
| `qmanager-sites.service` | simple | `/usr/bin/qmanager_sites` | Sites monitor; `After=network.target qmanager-setup.service`, `Restart=on-failure`; idles while `sites.json` has `"enabled": false` |
| `qmanager-tower-failover.service` | simple | `/usr/bin/qmanager_tower_failover` | Tower lock failover; guarded by config check in `ExecStartPre` |
| `qmanager-ttl.service` | oneshot (RemainAfterExit) | inline sh | TTL/HL rule persistence; `ConditionPathExists=/etc/qmanager/ttl_state` |
| `qmanager-watchcat.service` | simple | `/usr/bin/qmanager_watchcat` | Connection watchdog; guarded by `qm_config_get watchcat enabled` |
| `tailscaled.service` | notify | `/usrdata/tailscale/tailscaled` | Tailscale daemon; staged only -- see note below |

**`tailscaled.service`** is staged in `/usr/lib/qmanager/tailscaled.service` (source: `scripts/etc/systemd/system/tailscaled.service`). It is only copied to `/lib/systemd/system/` when the user installs Tailscale via `qmanager_tailscale_mgr install`. `ExecStartPost=/bin/chmod 755 /usrdata/tailscale` restores directory permissions after tailscaled resets them to 700.

**Service ordering:** `qmanager-firewall` -> `qmanager-setup` -> `qmanager-atd` (RM520N-GL) and `qmanager-ping` -> `qmanager-poller` -> `qmanager-watchcat`.

---

## 7. Sudoers Rules

Source `scripts/etc/sudoers.d/qmanager`, installed to `$SUDOERS_DIR/qmanager` — `/opt/etc/sudoers.d/qmanager` when Entware sudo is present (the measured case; the device has no `/etc/sudoers.d`), else `/etc/sudoers.d/qmanager`.

```
# QManager -- sudoers rules for CGI scripts (lighttpd runs as www-data)
# Install location: /opt/etc/sudoers.d/qmanager (Entware) or /etc/sudoers.d/qmanager

# sudo 1.8.31 here has no built-in secure_path, so pin one for www-data.
Defaults:www-data secure_path="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

# QManager units: one helper that validates verb + unit itself
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_svc
# tailscaled: the one third-party unit, exact lines
www-data ALL=(root) NOPASSWD: /bin/systemctl start tailscaled
www-data ALL=(root) NOPASSWD: /bin/systemctl stop tailscaled
www-data ALL=(root) NOPASSWD: /bin/systemctl restart tailscaled
www-data ALL=(root) NOPASSWD: /bin/systemctl is-active tailscaled

# Firewall rules (TTL/HL, Traffic Engine): allow-listed helper, no raw iptables
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_fw_apply

# System reboot: the empty "" pins the no-argument form
www-data ALL=(root) NOPASSWD: /sbin/reboot ""

# Scheduled Reboot + Tower Lock schedule timer arming (replaced the dead crontab
# path — RM520N runs no crond; these arm runtime systemd OnCalendar timers)
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_scheduled_reboot_arm
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_tower_schedule_arm

# Auto-update timer live-arming (arms/disarms qmanager-auto-update.timer when the
# Software Update UI toggle flips)
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_auto_update_arm

# SSH password management (reads password from stdin, updates /etc/shadow)
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_set_ssh_password

# Alert-channel secret storage (value on stdin, never argv) and the test email
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_secret_set
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_email_send

# Tailscale VPN management
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_tailscale_mgr
# Exact argument forms used by vpn/tailscale.sh (`=` is backslash-escaped)
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale version
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale status --json
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale up --reset --accept-dns\=false
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale up --reset --accept-dns\=false --ssh
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale down
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale logout
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale set --ssh\=true
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale set --ssh\=false

# Tailscale boot persistence (symlink-based)
www-data ALL=(root) NOPASSWD: /bin/ln -sf /lib/systemd/system/tailscaled.service /lib/systemd/system/multi-user.target.wants/tailscaled.service
www-data ALL=(root) NOPASSWD: /bin/rm -f /lib/systemd/system/multi-user.target.wants/tailscaled.service

# Web console management
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_console_mgr

# OTA updater (download/stage/install/rollback -- needs full root for install.sh)
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_update
```

**Rule annotations:**

| Rule | Used by |
|------|---------|
| `Defaults:www-data secure_path=...` | Every `sudo` call from `www-data`: root helpers no longer inherit lighttpd's/the caller's `PATH` (opt-first order matches `cgi_base.sh`) |
| `qmanager_svc` | `platform.sh` `svc_start`/`svc_stop`/`svc_restart`/`svc_reset_failed`/`svc_is_running`/`svc_enable`/`svc_disable` when running as `www-data`; root callers use `systemctl`/`ln`/`rm` directly |
| `systemctl start/stop/restart/is-active tailscaled` | `platform.sh` `_svc_ctl` when the mapped unit is `tailscaled` |
| `qmanager_fw_apply` | `platform.sh` `run_iptables`/`run_ip6tables` when running as `www-data`: `ttl_state.sh` (TTL/HL) and `dpi_state.sh` (Traffic Engine). Root callers run iptables directly |
| `/sbin/reboot ""` | `platform.sh` `run_reboot`; `cgi_base.sh` `cgi_reboot_response`; `system/reboot.sh`. Arguments are refused |
| `qmanager_dns_apply` | `network/custom_dns.sh` save/clear — see [custom-dns.md](reference/custom-dns.md#apply-pipeline) |
| `qmanager_auto_update_arm` | `system/update.sh` `save_auto_update` — arms/disarms `qmanager-auto-update.timer` live via its `/lib` boot symlink |
| `qmanager_scheduled_reboot_arm` | `system/settings.sh` `save_scheduled_reboot` — arms/disarms `qmanager-scheduled-reboot.timer` |
| `qmanager_tower_schedule_arm` | `tower/schedule.sh` — arms/clears the `qmanager-tower-schedule-apply`/`-clear` timer pair |
| `qmanager_set_ssh_password` | `cgi_auth.sh` `qm_set_ssh_password`; `auth/ssh_password.sh` |
| `qmanager_secret_set` | `monitoring/alerts.sh` `save_settings` — stores/clears the Discord token and Gmail app password in `/etc/qmanager-secrets/`, renders `msmtprc`, maintains the `*_set` markers |
| `qmanager_email_send` | `monitoring/alerts.sh` `send_test` (email channel) — the CGI can no longer read `msmtprc` |
| `qmanager_tailscale_mgr` | `vpn/tailscale.sh` |
| `/usrdata/tailscale/tailscale <exact args>` | `vpn/tailscale.sh` `get_ts_version` and `ts_cmd` — one line per call form; a new verb or flag needs a new line ([tailscale.md](reference/tailscale.md#sudoers-surface)) |
| `ln/rm tailscaled.service` | `vpn/tailscale.sh` (enable/disable Tailscale at boot) |
| `qmanager_console_mgr` | Console management via system settings CGI |
| `qmanager_update` | `system/update.sh` (OTA update; added in v0.1.5 -- previously required ADB/SSH) |
| `qmanager_timezone_apply` | `system_config.sh` `sys_set_timezone` (copies resolved TZif over `/etc/localtime`) |
| `qmanager_mtu_set` | `connection_store.sh` `conn_mtu_set` / `conn_mtu_disable` (`network/mtu.sh`, config restore), `tower_lock_mgr.sh` `mtu_reapply_after_bounce` (`apply`) |
| `qmanager_hostname_apply` | `system_config.sh` `sys_set_hostname` (`system/settings.sh`, config restore) |

> ℹ️ NOTE: The rules block quoted above is illustrative and not exhaustive. The authoritative file is `scripts/etc/sudoers.d/qmanager`, which also carries `qmanager_crash_log_append`, `qmanager_dpi_install`, `qmanager_dpi_verify`, `qmanager_scenario_schedule_arm`, `qmanager_health_check`, `qmanager_ethernet_apply`, `qmanager_lan_apply`, `qmanager_language_pack_apply`, `qmanager_sim_registry_apply` and `qmanager_dns_apply`.

**Security note:** All rules use full absolute paths, and the drop-in sets `Defaults:www-data secure_path` because this sudo (1.8.31) has no built-in one — before that line, the caller's `PATH` reached every root helper. Most granted helpers also pin `PATH=/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin` themselves. Three do not: `qmanager_set_ssh_password` and `qmanager_console_mgr` set no `PATH`, and `qmanager_update` prepends that list but keeps the inherited `PATH` after it — all three rely on `secure_path` alone. Pin `PATH` in any new helper.

**Bare paths, validation inside the helper.** New grants are a bare helper path with no arguments and no wildcards (`qmanager_svc`, `qmanager_fw_apply`, `qmanager_dns_apply`, `qmanager_crash_log_append`, `qmanager_*_arm`, `qmanager_secret_set`, `qmanager_email_send`). A sudoers `*` in a command's arguments matches any text, **including spaces and `/`**, so a line like `systemctl start qmanager-*` also matched extra units and extra options after the prefix, and `ln -sf .../qmanager*.service ...` matched paths outside the unit directory. A sudoers wildcard cannot express an argument whitelist, a length cap, or a symlink refusal; the helper can, and it can be read and tested. The only argument-carrying grants left are exact, wildcard-free lines (`tailscaled`, the `tailscale` CLI forms, `/sbin/reboot ""`).

> ⚠️ WARNING: **The drop-in is `visudo -c -f`-gated at install time.** sudo parses all of `sudoers.d` as one unit, so a single malformed line does not disable one grant — it makes sudo reject the **entire directory**, taking out every privileged CGI action at once (reboot, OTA, Tailscale, ethernet, timezone, secret writes). `install_backend()` stages the file as `$SUDOERS_DIR/qmanager.qm_stage.$$` (sudo skips any include-directory filename containing a `.`, so the stage file is never parsed), runs `visudo -c -f` against it, and only then renames it into place. A validation failure leaves the previously-installed known-good file completely untouched. If `visudo` itself is absent the install proceeds unvalidated but warns loudly — the pre-existing behavior. Do not "simplify" this back to a direct `install_file` into `sudoers.d`.
>
> There is also an **early** check: `preflight()` runs `visudo -c -f` on the shipped drop-in (when `DO_BACKEND=1`) and `die`s **before any service is stopped or file installed**. That ordering matters because the new helpers and the grants that replace raw commands ship together: new helpers paired with a refused (so still old, broader) drop-in is worse than aborting. The late check in `install_backend()` stays as a second guard. With no `visudo` binary the early check is skipped without a message and the late one warns, as above.

---

## 8. udev Rules

### Rule file: `/etc/udev/rules.d/99-qmanager-smd11.rules`

```
KERNEL=="smd11", ACTION=="add", RUN+="/usr/lib/qmanager/qmanager_smd11_udev.sh"
```

**Purpose:** `/dev/smd11` defaults to `crw------- root:root` on boot. `www-data` (member of the `dialout` group) needs read/write access to run AT commands via `qcmd`. This rule fires on every kernel `add` event for `smd11` and runs the helper which sets `chmod 660` + `chown root:dialout`.

**Why no `SUBSYSTEM==` filter:** The subsystem name for `smd11` is `glinkpkt` on RM520N-GL (sysfs path: `/sys/class/glinkpkt/smd11`) but differs on PRAIRE-derived platforms (RG502Q/RM502Q). `KERNEL=="smd11"` is already highly specific to Qualcomm SMD naming convention. Omitting `SUBSYSTEM==` makes the rule portable across platforms without verification.

**Why `99-` prefix:** Ensures this rule runs after OEM/vendor `data_udev_rules.rules`, overriding any permissions they set.

**Why `ACTION=="add"` only:** Prevents redundant firing on `change` and `remove` events.

### Helper script: `/usr/lib/qmanager/qmanager_smd11_udev.sh`

Runs in udev's minimal environment (no PATH, no controlling tty). Sets `PATH` explicitly. Checks `[ -c "$DEVICE" ]` before attempting chown/chmod. Always exits 0 to prevent udev log spam on race conditions. Source path: `scripts/etc/udev/scripts/qmanager_smd11_udev.sh`.

### Fallback: `qmanager_setup`

`qmanager_setup` runs the same `chown root:dialout /dev/smd11` + `chmod 660 /dev/smd11` at boot as a belt-and-suspenders fallback. This covers the case where:
- The udev rule has not yet been loaded (fresh install before `udevadm control --reload-rules`)
- The device was created before udev started
- PRAIRE-derived platforms where the modem recreates `/dev/smd11` after `qmanager-setup.service` completes

Both the udev helper and `qmanager_setup` are idempotent.

---

## 9. CGI Endpoint Reference

### Standard CGI Pattern

Every CGI script (except auth endpoints) follows this boilerplate:

```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh   # enforces auth automatically
qlog_init "cgi_<name>"
cgi_headers
cgi_handle_options

case "$REQUEST_METHOD" in
    GET)
        # ... read data, emit JSON
        ;;
    POST)
        cgi_read_post
        # ... process $POST_DATA
        ;;
    *)
        cgi_method_not_allowed
        ;;
esac
```

For auth endpoints that must skip authentication:

```sh
#!/bin/sh
_SKIP_AUTH=1              # MUST be set before sourcing cgi_base.sh
. /usr/lib/qmanager/cgi_base.sh
```

Authentication is automatically enforced by `cgi_base.sh` unless `_SKIP_AUTH=1` is set. CGI scripts never check auth manually.

For request/response schemas, see `API-REFERENCE.md`.

### Category Tables

#### `auth/` (5 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `auth/check.sh` | GET | Check current session validity; `_SKIP_AUTH=1` |
| `auth/login.sh` | POST | Validate password, create session; `_SKIP_AUTH=1` |
| `auth/logout.sh` | POST | Destroy session; `_SKIP_AUTH=1` |
| `auth/password.sh` | POST | Change web UI password (and SSH password via `qm_set_ssh_password`) |
| `auth/ssh_password.sh` | POST | Change root SSH password only |

#### `at_cmd/` (14 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `at_cmd/cell_scan_start.sh` | POST | Take `/tmp/qmanager_scan.lock` and spawn `qmanager_cell_scanner`; `{"success":true}`, or `already_running` / `other_scan_running` / `start_failed` |
| `at_cmd/cell_scan_status.sh` | GET | Poll cell scan progress and results (**non-destructive**: it no longer deletes the error file on read, so the result check must stay above the error check — see [reference/cell-scanner.md](reference/cell-scanner.md)) |
| `at_cmd/fetch_data.sh` | GET | Return current poller status cache (`qmanager_status.json`) |
| `at_cmd/fetch_events.sh` | GET | Return recent events as JSON array |
| `at_cmd/fetch_ping_history.sh` | GET | Return ping history data for latency chart; optional `?last=N` returns only the newest N rows |
| `at_cmd/fetch_signal_history.sh` | GET | Return signal history data for RSRP/SINR chart |
| `at_cmd/neighbour_scan_start.sh` | POST | Takes the **same** `/tmp/qmanager_scan.lock` as the sweep, then spawns `qmanager_neighbour_scanner`; same four responses |
| `at_cmd/neighbour_scan_status.sh` | GET | Poll neighbour scan progress and results (**non-destructive**) |
| `at_cmd/send_command.sh` | POST | Send arbitrary AT command via `qcmd`; returns raw response |
| `at_cmd/speedtest_check.sh` | GET | Check if Ookla speedtest CLI is installed |
| `at_cmd/speedtest_servers.sh` | GET | List nearest speedtest servers |
| `at_cmd/speedtest_start.sh` | POST | Start a speedtest; return PID |
| `at_cmd/speedtest_status.sh` | GET | Poll speedtest progress and results |

#### `bands/` (4 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `bands/current.sh` | GET | Read current locked bands from modem |
| `bands/failover_status.sh` | GET | Check band failover daemon status |
| `bands/failover_toggle.sh` | POST | Start or stop `qmanager_band_failover` |
| `bands/lock.sh` | POST | Apply LTE/NR band lock via `AT+QNWPREFCFG` |

#### `cellular/` (7 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `cellular/apn.sh` | GET/POST | WAN Profile Management — list/save/toggle 6 PDP contexts (AT-only). See `docs/reference/wan-profile-management.md` |
| `cellular/fplmn.sh` | GET/POST | Read or manage FPLMN (forbidden PLMN) list |
| `cellular/imei.sh` | GET/POST | Read or change IMEI (`AT+EGMR`) |
| `cellular/mbn.sh` | GET/POST | Read or select MBN profile |
| `cellular/network_priority.sh` | GET/POST | Read or set network mode priority (`AT+QNWPREFCFG`) |
| `cellular/settings.sh` | GET/POST | Combined cellular settings (network search mode, etc.) |
| `cellular/sms.sh` | GET/POST/DELETE | SMS center: list, read, send, delete messages via `qsms` |

On the RM520N-GL `cellular/sms.sh` takes no AT lock for SMS: `qsms` uses QMI WMS. Its only AT command is the CPMS routing write through `qcmd`, which takes `/run/qmanager_at/at.lock` for that one command. See [sms.md](reference/sms.md#no-at-lock).

#### `device/` (1 script)

| Script | Method | Description |
|--------|--------|-------------|
| `device/about.sh` | GET | Device info: model, firmware, IMEI, ICCID, uptime, QManager version |

#### `frequency/` (2 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `frequency/lock.sh` | POST | Apply EARFCN/ARFCN frequency lock |
| `frequency/status.sh` | GET | Read current frequency lock state |

#### `monitoring/` (2 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `monitoring/alerts.sh` | GET/POST | Centralized Alerts: aggregated SMS/email/Discord settings + routing × capability matrix + reboot history (GET); `save_settings` / `send_test` / `get_log` / `install_msmtp` / `install_status` (POST). Replaces the removed `email_alerts.sh`, `email_alert_log.sh`, `sms_alerts.sh`, `sms_alert_log.sh`, and `discord_bot/{configure,status,test,alert_log}.sh`. See `docs/reference/alerts.md` |
| `monitoring/watchdog.sh` | GET/POST | Read or write watchcat config; start/stop watchcat service |

#### `network/` (7 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `network/custom_dns.sh` | GET/POST | Read or write dnsmasq upstream DNS override via sentinel block in `/etc/data/dnsmasq.conf`. See `docs/reference/custom-dns.md` |
| `network/data_used.sh` | GET | Return `.data_used` block from poller status cache with stale flag. No UI caller since T6.2: the dashboard reads `.data_used` from `fetch_data.sh` |
| `network/data_used_reset.sh` | POST | Write reset flag consumed by poller on next tick; counter drops to ~0 within 4–5 s |
| `network/ethernet.sh` | GET/POST | Read RTL8125B link state (sysfs + `ethtool`) and apply speed limit via `qmanager_ethernet_apply` root helper; uses `ethtool_helper.sh` |
| `network/ip_passthrough.sh` | GET/POST | Read or configure IP passthrough (`AT+QMAP`, `AT+QCFG="usbnet"`) |
| `network/mtu.sh` | GET/POST | Read or write custom MTU setting |
| `network/ttl.sh` | GET/POST | Read or write TTL/HL override rules via `ttl_state.sh` |

#### `profiles/` (8 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `profiles/apply.sh` | POST | Spawn `qmanager_profile_apply` for a profile ID |
| `profiles/apply_status.sh` | GET | Poll apply progress from `qmanager_profile_state.json` |
| `profiles/current_settings.sh` | GET | Read current modem settings for form pre-fill in ONE compound AT round-trip (`AT+CGDCONT?;+CGSN;+QCCID;+CGPADDR;+QMAP="WWAN";+QSPN`) — returns `apn_profiles`, `imei`, `iccid`, `active_cid`, plus carrier identity `spn`/`mcc`/`mnc`. No TTL. Always 200; carrier fields fail soft to `""` |
| `profiles/deactivate.sh` | POST | Clear active profile marker |
| `profiles/delete.sh` | POST | Delete a profile by ID |
| `profiles/get.sh` | GET | Return full profile JSON for a profile ID |
| `profiles/list.sh` | GET | Return profile list with active profile marker |
| `profiles/save.sh` | POST | Create or update a profile |

#### `scenarios/` (5 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `scenarios/activate.sh` | POST | Apply a connection scenario (band lock + network mode). Returns `profile_managed` error without touching the modem if the active SIM profile binds a non-Balanced scenario via `settings.scenario_id` (defense-in-depth for stale frontends). A `"balanced"` binding is allowed through — Balanced is treated as "no opinion" both on the UI gates and at this guard. |
| `scenarios/active.sh` | GET | Return currently active scenario ID |
| `scenarios/delete.sh` | POST | Delete a scenario |
| `scenarios/list.sh` | GET | Return all saved scenarios |
| `scenarios/save.sh` | POST | Create or update a scenario |

#### `system/` (5 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `system/logs.sh` | GET | Return QManager log file contents |
| `system/modem-subsys.sh` | GET | Return modem subsystem health (state, crash count, coredump flag) by reshaping the `system_health` block from the poller status cache; thin `jq` extractor — never re-computes live data |
| `system/reboot.sh` | POST | Initiate system reboot via `cgi_reboot_response` |
| `system/settings.sh` | GET/POST | Read or write system settings (hostname, timezone, scheduled reboot, low-power schedule, auto-update). GET adds `effective_offset` / `effective_zone_abbr` / `timezone_applied` (live clock truth from `sys_get_effective_tz`); POST `save_settings` returns `timezone_apply_status` (`applied`/`failed`/`not_attempted`/`invalid`). See [Timezone](reference/timezone.md) |
| `system/update.sh` | GET/POST | OTA update: check version, download, install, rollback; spawns `qmanager_update` via sudo |

#### `tower/` (5 scripts)

| Script | Method | Description |
|--------|--------|-------------|
| `tower/failover_status.sh` | GET | Return tower failover daemon status and current signal quality |
| `tower/lock.sh` | POST | Apply or clear LTE/NR-SA tower lock via `tower_lock_mgr.sh` |
| `tower/schedule.sh` | POST | Enable, disable, or update tower lock schedule |
| `tower/settings.sh` | GET/POST | Read or write tower lock config (all sections) |
| `tower/status.sh` | GET | Return current lock state from modem + config |

#### `vpn/` (1 script)

| Script | Method | Description |
|--------|--------|-------------|
| `vpn/tailscale.sh` | GET/POST | Tailscale VPN: install, uninstall, status, `tailscale up` |

**Total: 69 CGI scripts.**

---

## 10. File Locations on Device

### Temporary State (`/tmp/`)

Cleared on every reboot (tmpfs). Files pre-created by `qmanager_setup` are marked with (S).

| Path | Owner | Created by | Description |
|------|-------|------------|-------------|
| `/tmp/qmanager_at.pid` (S) | www-data | qmanager_setup | No longer seeded or used since the shell `qcmd` was retired (the broker's PID is `/var/run/qmanager/atd.pid`); an upgraded device may keep a stale copy until reboot |
| `/tmp/qmanager.log` (S) | root | qmanager_setup | Main QManager log (all components) |
| `/tmp/qmanager_status.json` | root | qmanager_poller | Main modem status cache; polled by frontend |
| `/tmp/qmanager_ping.json` | root | qmanager_ping | Current ping state (available, latency, streaks) |
| `/tmp/qmanager_ping_history` | root | qmanager_ping | Raw latency history (flat ring buffer) |
| `/tmp/qmanager_dns.json` | root | qmanager_ping (detached DNS job) | Carrier-resolver lookup time `{ms, ok, resolver, name, mono, ts}`, every 60 s and on a down edge; atomic `mv`. The poller nulls it when failed or older than 180 s. See [reference/connection-quality.md](reference/connection-quality.md) |
| `/tmp/qmanager_sites.json` | root | qmanager_sites | Latest Sites sweep; atomic `mv` |
| `/tmp/qmanager_sites_raw.ndjson` | root | qmanager_sites | Raw Sites samples, trimmed to 24 h |
| `/tmp/qmanager_sites_flushed` | root | qmanager_sites | Rollup cursor (newest raw `ts` already rolled up); atomic `mv` |
| `/tmp/qmanager_sites_checking` | root | qmanager_sites | Exists while a sweep runs |
| `/tmp/qmanager_sites.pid` | root | qmanager_sites | Singleton PID; a copy not owned by root is deleted before the check |
| `/tmp/qmanager_sites_now` | www-data | monitoring/sites.sh | Check-now flag. Root only tests and removes it, never writes it. The daemon deletes any other fixed `qmanager_sites*` name it does not own before use (`fs.protected_regular`). See [reference/sites-monitor.md](reference/sites-monitor.md) |
| `/tmp/qmanager_signal_history.json` | root | qmanager_poller | Signal history NDJSON for chart |
| `/tmp/qmanager_events.json` (S) | root | qmanager_setup | Recent activity events NDJSON. Appended by root daemons **and** every CGI that sources `events.sh` — must stay `root:root 0666`, and the ring trim must never use `mv` |
| `/tmp/qmanager_pci_state.json` | root | qmanager_poller | SCC PCI state for handoff detection |
| `/tmp/qmanager_watchcat.json` | root | qmanager_watchcat | Watchcat state (mode, tier, recoveries) |
| `/tmp/qmanager_watchcat.pid` | root | qmanager_watchcat | Watchcat process PID |
| `/tmp/qmanager_watchcat.lock` | root | qmanager_watchcat / update worker | Maintenance lock; forces watchcat into LOCKED state |
| `/tmp/qmanager_watchcat_reload` | root | CGI | Flag: watchcat should reload config |
| `/tmp/qmanager_recovery_active` | root **or** www-data | qmanager_watchcat / qmanager_profile_apply | Flag: recovery action in progress. **Deliberately not seeded** (existence is the signal); ownership is claimed by write-then-read-back — see [reference/tmp-file-ownership.md](reference/tmp-file-ownership.md) |
| `/tmp/qmanager_watchcat_revert_sim` | root | CGI | Flag: user requested SIM revert (Tier 3) |
| `/tmp/qmanager_watchcat_disabled` | root | qmanager_watchcat | Flag: watchcat auto-disabled (Tier-4 reboot cap hit) |
| `/tmp/qmanager_profile_state.json` (S) | root | qmanager_setup | Profile apply progress state. Written by `qmanager_profile_apply` as **both** UIDs — in place only, never `mv` |
| `/tmp/qmanager_profile_apply.pid` (S) | root | qmanager_setup | Profile apply singleton lock. Truncated (`: >`) on cleanup, never unlinked — an unlink voids the seed for the rest of the boot |
| `/tmp/qmanager_sessions/` | www-data | qmanager_setup | Session token directory (mode 700) |
| `/tmp/qmanager_auth_attempts.json` | www-data | cgi_auth.sh | Login rate limiting state |
| `/tmp/qmanager_scan.lock` | www-data | `cell_scan_start.sh` / `neighbour_scan_start.sh` (lazily, empty) | **The scan singleton.** One `flock -x` shared by both scan types, opened read-only on fd 9 and **inherited by the spawned worker**, so the kernel releases it when the worker exits (including on `SIGKILL`). Never `unlink` it while a request could be in flight — that detaches the name without releasing the lock and the next opener gets an independent lock on a new inode. See [reference/cell-scanner.md](reference/cell-scanner.md) |
| `/tmp/qmanager_cell_scan_result.json` | www-data | qmanager_cell_scanner | Cell sweep results |
| `/tmp/qmanager_cell_scan_error` | www-data | qmanager_cell_scanner | Sweep error text; read non-destructively, cleared by the next scan start |
| `/tmp/qmanager_cell_scan.pid` | www-data | `cell_scan_start.sh`, then qmanager_cell_scanner (same value) | **Identification only** — which sweep holds the lock, never whether one is running |
| `/tmp/qmanager_neighbour_scan_result.json` | www-data | qmanager_neighbour_scanner | Neighbour read results |
| `/tmp/qmanager_neighbour_scan_error` | www-data | qmanager_neighbour_scanner | Neighbour error text, read non-destructively |
| `/tmp/qmanager_neighbour_scan.pid` | www-data | `neighbour_scan_start.sh`, then qmanager_neighbour_scanner | Identification only, as above |
| `/tmp/qmanager_tower_failover.json` | root | qmanager_tower_failover | Failover daemon state |
| `/tmp/qmanager_tower_failover.pid` | root | qmanager_tower_failover | Failover daemon PID |
| `/tmp/qmanager_tower_failover` | root | qmanager_tower_failover | Failover active flag |
| `/tmp/qmanager_email_log.json` | root | email_alerts.sh | Email alert history NDJSON (max 100) |
| `/tmp/qmanager_email_reload` | www-data | monitoring/alerts.sh | Reload flag for email config (consumed by alert_engine.sh) |
| `/tmp/qmanager_sms_log.json` | root | sms_alerts.sh | SMS alert history NDJSON (max 100) |
| `/tmp/qmanager_sms_reload` | www-data | monitoring/alerts.sh | Reload flag for SMS config (consumed by alert_engine.sh) |
| `/tmp/qmanager_discord_reload` | www-data | monitoring/alerts.sh | Reload flag for Discord config (consumed by alert_engine.sh) |
| `/tmp/qmanager_alert_routing_reload` | www-data | monitoring/alerts.sh | Reload flag for routing matrix (consumed by alert_engine.sh) |
| `/tmp/qmanager_discord_spool/` | root:root 1777 (entries www-data / root) | alert_engine.sh, monitoring/alerts.sh | DM spool, one JSON file per DM, drained in name order by the `qmanager_discord` daemon |
| `/tmp/qmanager_update.json` | root | qmanager_update | OTA update status (idle/downloading/verifying/ready/installing/rebooting/error) |
| `/tmp/qmanager_update.pid` | root | qmanager_update | Update worker PID |
| `/tmp/qmanager_update.log` | root | qmanager_update | Update worker log |
| `/tmp/qmanager_install.log` | root | qmanager_update | Step-streaming install log (polled by worker) |
| `/tmp/qmanager_stage/` | root, `0711` | qmanager_update | Private OTA work dir, recreated each run: `qmanager.tar.gz`, `version` and `sha256` (staged download), `download.tar.gz`, `qmanager_install/` (extracted installer) |
| `/tmp/qmanager_tailscale_install.json` | root | qmanager_tailscale_mgr | Tailscale install progress |
| `/tmp/qmanager_tailscale_install.log` | root | qmanager_tailscale_mgr | Tailscale install log |
| `/tmp/qmanager_tailscale_install.pid` | root | qmanager_tailscale_mgr | Tailscale install PID |
| `/tmp/qmanager_low_power_active` | root | low-power cron | Flag: low-power window active; suppresses events/alerts |
| `/tmp/qmanager_long_running` | — | nothing (retired) | Moved to `/run/qmanager_at/long_running` in `qmanager_atd` 0.7.3: root-owned, raised by the broker around long commands, read by `qmanager_poller` and `qmanager_watchcat` through `qm_long_flag_up`. The installer's `stop_services()` removes a leftover `/tmp` copy. See [reference/at-command-transport.md](reference/at-command-transport.md#the-long-command-flag-trust-rule) |
| `/tmp/qmanager_cc_data.tmp` | root | parse_at.sh | Carrier component parse scratch file |
| `/tmp/qmanager_ca_parse.tmp` | root | parse_at.sh | CA parse scratch file |
| `/tmp/qmanager_mtu_reapply.pid` | root | tower_lock_mgr.sh | MTU re-apply watcher PID |
| `/tmp/msmtp_last_err.log` | root | email_alerts.sh | Last msmtp error output |

### Persistent Configuration (`/etc/qmanager/`)

**Not on the rootfs.** `/etc` is a bind mount of `/dev/ubi2_0` — the same always-`rw` UBIFS volume as `/usrdata`, `/opt`, `/data`, `/cache`, `/persist` and `/systemrw` (verified live: `/etc`, `/usrdata` and `/opt` all report the same `st_dev`, distinct from `/`). Writes here need **no remount**; `qmanager_setup`'s `mount -o remount,rw /` exists for the rootfs paths (`/lib/systemd/system`, `/usr/bin`, `/usr/lib`) and has no effect on `/etc`. The read-only-rootfs note in Gotchas describes `/` (`ubi0:rootfs`), which genuinely does boot `ro` — that note is correct and unrelated to this table. `/etc/qmanager/` is owned by `www-data` for CGI write access.

| Path | Description |
|------|-------------|
| `/etc/qmanager/auth.json` | Password hash + salt (mode 600) |
| `/etc/qmanager/qmanager.conf` | Main JSON config (watchcat, settings, update sections) |
| `/etc/qmanager/VERSION` | Current installed version string (e.g., `v0.1.5`) |
| `/etc/qmanager/VERSION.pending` | Written at install preflight; `mv`'d to VERSION on success; stale file indicates a crash |
| `/etc/qmanager/updates/previous_version` | Previous version string for rollback support |
| `/etc/qmanager/active_profile` | Active profile ID (plain text) |
| `/etc/qmanager/profiles/` | Profile JSON files (`p_<ts>_<hex>.json`) |
| `/etc/qmanager/active_scenario` | Active scenario ID (plain text) — written by `scenario_set_active` |
| `/etc/qmanager/scenarios/` | Custom scenario JSON files (`custom-<ts>.json`) |
| `/etc/qmanager/tower_lock.json` | Tower lock config (lte, nr_sa, persist, failover, schedule) |
| `/etc/qmanager/email_alerts.json` | Email alert config (enabled, sender, recipient, `app_password_set` marker, threshold). **No password** — see the secrets store below |
| `/etc/qmanager/sms_alerts.json` | SMS alert config (enabled, recipient_phone, threshold) |
| `/etc/qmanager/discord_bot.json` | Discord alert config (enabled, owner_discord_id, `token_set` marker, threshold, autonomous_notify). **No bot token** — see the secrets store below |
| `/etc/qmanager/alert_routing.json` | Centralized-alerts routing matrix (version 1, `events.<event>.<channel>` booleans). See `docs/reference/alerts.md` |
| `/etc/qmanager/reboot_history.json` | Reboot ledger NDJSON (`{epoch,cause}`, cap 10; written by alert_engine.sh) |
| `/etc/qmanager/last_boot_id` | Last-seen kernel boot id (alert_engine.sh reboot detection) |
| `/etc/qmanager/imei_backup.json` | IMEI backup for rejection check restore |
| `/etc/qmanager/imei_check_pending` | Marker: IMEI restore pending after next boot |
| `/etc/qmanager/ttl_state` | TTL/HL values (`TTL=N\nHL=N`); absent = no rules |
| `/etc/firewall.user.mtu` | MTU rules (root:root 0644, written by `qmanager_mtu_set`; sourced by `qmanager_mtu_apply` at boot) |
| `/etc/qmanager/long_commands.list` | List of AT commands treated as long (one per line) |
| `/usrdata/qmanager/crash.log` | Reboot log (`<epoch>\|reboot\|<tag>` and `<epoch>\|skip\|<reason>`): watchcat Tier-4 writes `tier4_escalation` (token-bucket source), `qmanager_scheduled_reboot` writes `scheduled` and `skip` lines, the `qmanager_crash_log_append` root helper writes `user`; read-only by alert_engine.sh for reboot classification. **Not in `/etc/qmanager`:** it moved to this root-owned `0755` dir in 2026-10 so `www-data` cannot swap it under a root writer. `qm_crash_log_prepare` (`crash_log.sh`) merges a legacy `/etc/qmanager/crash.log` once, marker `/usrdata/qmanager/.crash_log_migrated` — see [alerts.md](reference/alerts.md#the-user-breadcrumb-root-helper) |
| `/etc/qmanager/qmanager_sim_failover` | Watchcat Tier-3 SIM-failover record (persistent so it survives a Tier-4 reboot) |
| `/etc/qmanager/last_iccid` | Last-landed SIM ICCID; written after a swap/revert so the poller's boot swap-detector doesn't false-fire |
| `/etc/qmanager.env` | Optional environment overrides for the root-run systemd daemons (e.g., `QLOG_LEVEL=DEBUG`). **Outside `/etc/qmanager` on purpose** — `root:root 0644`, never `www-data`-writable. Relocated from `/etc/qmanager/environment` in v0.1.14; see [qmanager-independence.md](reference/qmanager-independence.md) |
| `/etc/qmanager-backups/` | Installer-kept snapshots of `auth.json` (the login password), one per install/OTA run, newest 5 kept. **Outside `/etc/qmanager` on purpose** — `0700 root:root`, same relocation class as `/etc/qmanager.env` and the alert secrets store below. Moved from `/etc/qmanager/backups` in v0.1.14 by `migrate_backup_location()`; removed by `uninstall_rm520n.sh --purge`. See [qmanager-independence.md](reference/qmanager-independence.md#migration-migrate_backup_location) |

### Alert Secrets Store (`/etc/qmanager-secrets/`)

**Outside `/etc/qmanager` on purpose, and a SIBLING rather than a child.** `www-data` owns `/etc/qmanager`, and directory write permission — not the file's mode — governs unlink and rename, so no mode or ownership pin *inside* that directory protects anything; `qmanager_setup:177`'s boot-time `chown -R www-data:www-data /etc/qmanager` then flattens whatever survived. Because that chown targets the literal path, `-R` cannot descend into a sibling. Same class of relocation as `/etc/qmanager.env` above. Full rationale, helper contracts, and migration behavior: [alerts.md](reference/alerts.md#secret-storage-etcqmanager-secrets).

| Path | Mode | Description |
|------|------|-------------|
| `/etc/qmanager-secrets/` | `0700 root:root` | Root-only store for alert-channel credentials. Created by `install -d -m 0700` (never `mkdir -p`); removed by `uninstall_rm520n.sh --purge` |
| `/etc/qmanager-secrets/discord_bot_token` | `0600 root:root` | Raw Discord bot token, no trailing newline. Read by `qmanager_discord` (`loadBotToken`); the Go `Config` struct has no `BotToken` field |
| `/etc/qmanager-secrets/email_app_password` | `0600 root:root` | Raw Gmail app password, no trailing newline |
| `/etc/qmanager-secrets/msmtprc` | `0600 root:root` | msmtp config (embeds the app password by construction; no `logfile` directive). Relocated from `/etc/qmanager/msmtprc` in v0.1.14 |

> ⚠️ WARNING: `discord_bot_token` and `email_app_password` must **never** be collected into a support bundle — the whole file is the secret, so there is no line for `qmanager_health_check`'s redaction `sed` to match. `msmtprc` may be collected but must keep its exact basename, because `_redact_tree` matches `-name 'msmtprc'`.

### Other Paths

| Path | Description |
|------|-------------|
| `/usr/bin/qcmd` | AT command gatekeeper |
| `/usr/bin/qmanager_atd` | AT/SMS/QMI broker binary; `qcmd` and `qsms` are symlinks to it |
| `/usr/bin/qsms` | SMS client (symlink to `qmanager_atd`) |
| `/usr/bin/qmanager_*` | All daemon and utility scripts |
| `/usr/lib/qmanager/` | All shared library scripts |
| `/lib/systemd/system/qmanager-*.service` | Systemd unit files |
| `/lib/systemd/system/multi-user.target.wants/` | Boot-persistence symlinks |
| `/etc/udev/rules.d/99-qmanager-smd11.rules` | udev rule for `/dev/smd11` |
| `/usr/lib/qmanager/qmanager_smd11_udev.sh` | udev helper script |
| `/etc/sudoers.d/qmanager` | Sudoers rules (also `/opt/etc/sudoers.d/qmanager`) |
| `/usrdata/qmanager/` | Web root, lighttpd config, TLS certs, console binary |
| `/usrdata/qmanager/lighttpd.conf` | lighttpd configuration |
| `/usrdata/qmanager/www/` | Web root (frontend assets + CGI scripts) |
| `/usrdata/qmanager/certs/` | TLS certificate and key |
| `/usrdata/qmanager/console/ttyd` | Web terminal binary |
| `/usrdata/qmanager/console/console.sh` | Shell startup script (sets PATH for Entware tools) |
| `/usrdata/qmanager/sites/` | Sites monitor hourly rollups, `YYYY-MM-DD.jsonl` per UTC day (`root:root 0755`; 90 days, 4 MB cap; removed by `--purge`) |
| `/usrdata/tailscale/` | Tailscale binaries and state (on-demand install) |
| `/usrdata/root/bin/tailscale` | Tailscale CLI symlink (rgmii-toolkit convention) |
| `/usr/bin/tailscale` | Tailscale CLI symlink (QManager root shell convention) |
| `/usr/bin/jq` | Symlink to `/opt/bin/jq` (installed by installer for CGI PATH) |

---

## 11. Locking & Concurrency Conventions

### `/run/qmanager_at/at.lock` -- AT Device Serialization

All processes that access `/dev/smd11` share this lock. It is `root:dialout` 0640 in a `root:dialout` 0750 dir (`/run`, tmpfs, recreated by `qmanager_setup` each boot); only root creates it, and root or the `dialout` group (which `www-data` is in) can lock it. A non-root caller that finds it missing gets `modem_busy`. While the root-only marker `/run/qmanager_at/bridge` exists, the Rust holders also take the legacy `/tmp/qmanager_at.lock` (the OTA/rollback bridge). Full rules: [at-command-transport.md > The AT lock](reference/at-command-transport.md#the-at-lock-and-who-may-hold-it). Holders:
- `qcmd` (for all AT commands from the poller, CGI scripts, and daemons) — the `qmanager_atd` broker takes the lock around each exchange, or the in-process fallback does when the broker is not running. The Rust lock code (`native/qmanager_atd/src/common/lock.rs`) has the same 100 ms try-loop semantics as the shell pattern below
- `qmanager_health_check`'s `t_sms_flock` test, which acquires and releases it once with `flock -x -n`
- `qsms` on its AT backend only (models other than RM520N and RG501Q). On the RM520N-GL and the RG501Q-EU, SMS uses QMI WMS and holds no lock; the SMS path's only AT command is the CPMS write through `qcmd`.

**Lock pattern (BusyBox `flock` lacks `-w`):**

```sh
# BusyBox flock lacks -w (timeout flag). Poll with -x -n in a loop.
flock_wait() {
    _fd="$1"; _wait="$2"; _elapsed=0
    while [ "$_elapsed" -lt "$_wait" ]; do
        flock -x -n "$_fd" 2>/dev/null && return 0
        sleep 1
        _elapsed=$((_elapsed + 1))
    done
    flock -x -n "$_fd" 2>/dev/null   # one final try
}

# Usage with FD 9 (read-only to satisfy fs.protected_regular=1):
( flock_wait 9 5 || exit 2; your_locked_work ) 9<"$LOCK_FILE"
```

**Why `9<` (read-only FD):** `flock()` needs only a read fd, and the lock is mode 0640, so a `dialout` caller such as `www-data` can open it only for reading. Never open it with `>` or `<>`: that needs write access and would try to create it.

### `/tmp/qmanager_watchcat.lock` -- Maintenance Lock

A plain file (not a flock file). When this file exists, watchcat enters LOCKED state and suspends all recovery actions. Created by:
- `qmanager_update` (during OTA install)
- `install_rm520n.sh` (during installer run)

Cleaned up by watchcat's `ExecStopPost` and by `rm -f` in the update worker's EXIT trap.

### PID File Singleton Pattern

Long-running on-demand daemons use a PID file to prevent concurrent instances:

```sh
# Write PID at startup
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT INT TERM

# Check before spawning (from CGI or library)
if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE" 2>/dev/null)
    if pid_alive "$pid"; then
        # Already running
        exit 0
    fi
    rm -f "$PID_FILE"   # stale PID
fi
```

`pid_alive` checks `/proc/$pid` rather than `kill -0` because CGI (www-data) cannot send signals to root-owned daemon processes.

### Atomic JSON Write

All status/config files written with:

```sh
jq -n '...' > "${FILE}.tmp" && mv "${FILE}.tmp" "$FILE"
```

Never truncate-in-place. The `tmp + mv` ensures readers always see either the old complete file or the new complete file, never a partial write.

---

## 12. Update Pipeline

See `DEPLOYMENT.md` for the operational flow (what a user does). This section documents the worker's internal behaviour.

### Worker: `qmanager_update`

Spawned by `system/update.sh` CGI via `sudo -n /usr/bin/qmanager_update <mode> [args]`. The CGI's spawn line redirects to `/dev/null`; the worker manages its own log as root.

#### Modes

| Mode | Arguments | Description |
|------|-----------|-------------|
| `install` | `<url> <version> [size]` | Download, verify, install, reboot in one step |
| `download` | `<url> <checksum_url> <version>` | Download and verify only; stage in `/tmp/qmanager_stage/`. `<url>` must be the release for `<version>`; `<checksum_url>` is ignored |
| `install_staged` | (none) | Install the staged tarball after re-checking its recorded SHA-256 |
| `rollback` | `<url> <version>` | Download, verify and install a prior release |

Every mode accepts only `<release prefix><tag>/qmanager.tar.gz` and refuses to install without a verified `sha256sum.txt`. See [qmanager-independence.md](reference/qmanager-independence.md#ota-url-pinning-and-sha-256-verification).

#### Status State Machine

```
idle -> downloading -> verifying -> ready        (download mode -- stops here)
idle -> downloading -> verifying -> installing -> rebooting
idle ->                             installing -> rebooting   (install_staged mode)
any  -> error                                                 (on failure)
```

Status written atomically to `/tmp/qmanager_update.json` via `write_status()`:

```json
{"status": "installing", "message": "Copying files", "version": "v0.1.5", "size": ""}
```

#### URL Validation

`validate_url()` enforces a GitHub origin whitelist:
- `https://github.com/dr-dolomite/QManager-RM520N/releases/download/*/qmanager.tar.gz` -- allowed in all modes
- `https://github.com/dr-dolomite/QManager-RM520N/raw/*/qmanager-build/qmanager.tar.gz` -- allowed in `install` mode only (not strict mode)

Rollback and download modes use `validate_url "$URL" "strict"` to permit only the releases path.

#### SHA-256 Verification

`download` mode downloads a checksum file and compares with `sha256sum`. Non-fatal if the checksum URL returns 404 or if `sha256sum` is unavailable.

#### Two-Phase VERSION Write

Prevents silent version mismatches when the installer crashes mid-flight:

1. `install_rm520n.sh` writes `/etc/qmanager/VERSION.pending` at the start of its preflight step.
2. On successful completion, it `mv`s `VERSION.pending` -> `VERSION`.
3. `post_install_check()` in `qmanager_update` verifies `VERSION.pending` does not exist and that `VERSION` matches the expected value. A stale `VERSION.pending` is treated as a crash indicator.

#### Step-Streaming Progress

Contract between the installer and the worker:

- **Installer:** `step()` function writes `=== Step N/M: <label> ===` lines to `/tmp/qmanager_install.log` via stdout redirect.
- **Worker:** `run_install_with_progress()` polls `/tmp/qmanager_install.log` every 2 seconds with `grep '=== Step '| tail -1`, parses the label via `sed`, and calls `write_status "installing" "<label>"`.
- **UI:** polls `/tmp/qmanager_update.json` for status changes.

#### Watchcat Lock During Install

`qmanager_update` stops `qmanager-watchcat` via `svc_stop` before downloading. Additionally, the installer touches `/tmp/qmanager_watchcat.lock` as belt-and-suspenders to prevent watchcat from performing a Tier-4 reboot mid-install if watchcat was restarted by systemd during the operation.

#### Rollback Support

Before every install, `qmanager_update` writes the current version to `/etc/qmanager/updates/previous_version`. The CGI's rollback action reads this file to determine the URL for the previous release.

#### Unconditional zoneinfo install (`ensure_zoneinfo_packages`)

`install_rm520n.sh` calls `ensure_zoneinfo_packages()` from `main()` **outside** the `--skip-packages` / `DO_PACKAGES` gate (alongside `remove_conflicts()`). It installs the `zoneinfo-all` Entware meta-package into `/opt/share/zoneinfo`, which `qmanager_timezone_apply` needs as a source (the vendor `/usr/share/zoneinfo` ships empty). It runs unconditionally on purpose: OTA upgrades invoke the installer with `--skip-packages`, which gates the normal `install_dependencies()` step, so gating zoneinfo behind that flag would mean the in-app **Software Update** path never fetches tzdata and the timezone fix would stay silently broken for existing users. The function is warn-only: if Entware is not yet bootstrapped or the device is offline mid-update, it logs and returns `0` (a later run catches up) rather than failing the upgrade. `zoneinfo-all` is additive, so it is safe over partially pre-existing zoneinfo packages. See [Timezone](reference/timezone.md).

For more detail on the CGI request/response schemas, see `API-REFERENCE.md`.

---

## 13. Development Guidelines

### Adding a New CGI Endpoint

1. Create `scripts/www/cgi-bin/quecmanager/<category>/<name>.sh`.
2. Boilerplate:
   ```sh
   #!/bin/sh
   . /usr/lib/qmanager/cgi_base.sh
   qlog_init "cgi_<name>"
   cgi_headers
   cgi_handle_options
   case "$REQUEST_METHOD" in
       GET)  ... ;;
       POST) cgi_read_post; ... ;;
       *)    cgi_method_not_allowed ;;
   esac
   ```
3. Use `qcmd` for all AT commands. Never access `/dev/smd11` directly.
4. Use `jq` for all JSON construction. Never hand-build JSON strings.
5. Use `cgi_error` / `cgi_success` for response consistency.
6. Ensure LF line endings. Run `bash -n <script>` to syntax-check.
7. If the endpoint needs privileged operations, add a sudoers rule (see §7) and call the privileged binary via `$_SUDO /usr/bin/<helper>`.

### Adding a New Daemon

1. Create `scripts/usr/bin/qmanager_<name>`.
2. Source `qlog.sh` and call `qlog_init "<name>"` at startup.
3. Create `scripts/etc/systemd/system/qmanager-<name>.service`.
4. The installer's `enable_services()` function scans for service files and enables them automatically -- no installer edits needed.
5. If the daemon needs a PID file, use the PID file singleton pattern from §11.
6. If the daemon writes to `/tmp`, pre-create shared files in `qmanager_setup` with the correct owner and mode.

### Adding a New Sudoers Rule

When a CGI script needs to call a privileged binary:
1. Add `www-data ALL=(root) NOPASSWD: /full/absolute/path/to/binary [fixed_args]` to `scripts/etc/sudoers.d/qmanager`.
2. If the command takes variable arguments that cannot be narrowed, use the wildcard form (e.g., `/bin/systemctl start *`).
3. Prefer narrowing with fixed arguments where possible to limit the attack surface.
4. Do not use `sudo -i` or `sudo -s`; use `sudo -n /full/path` with explicit args.

### JSON Response Conventions

- Success: `{"success": true, ...additional fields}`
- Error: `{"success": false, "error": "<code>", "detail": "<human message>"}`
- Error codes are short snake_case identifiers (e.g., `validation_failed`, `not_found`, `modem_busy`).
- Never return HTTP error status codes; always return 200 with a JSON body.

### Logging Levels

| Level | Use for |
|-------|---------|
| DEBUG | AT commands, lock events, detailed flow tracing |
| INFO | Normal operations, state transitions, config changes |
| WARN | Unexpected state that is handled (stale PID, missing optional file) |
| ERROR | Failures that affect functionality (AT command failed, write failed) |

### Testing Locally

```sh
# POSIX syntax check
sh -n scripts/usr/lib/qmanager/config.sh

# Bash syntax check
bash -n scripts/usr/bin/qmanager_poller

# Check for CRLF
file scripts/usr/bin/qmanager_setup
# should say: "... shell script, ASCII text executable"
# NOT: "... CRLF line terminators"
```

---

## 14. Common Pitfalls

**jq `//` treats `false` as absent.** `jq -r '.enabled // "false"'` returns `"false"` even when `.enabled` is explicitly `false` in JSON. Use `if . == null then "false" else tostring end` for boolean fields. This pattern appears throughout the codebase and is documented in `config.sh` and `tower_lock_mgr.sh`.

**`fs.protected_regular=1` log-truncation failures.** If a CGI script (www-data) creates a `/tmp` file and a root daemon later tries to truncate it (e.g., `: > "$LOG_FILE"`), the kernel blocks the open — root gets **no override** here. Fix: use `rm -f` before creating the file (as in `qmanager_update`), or pre-create the file `root:root 0666` in `qmanager_setup`. Note the direction: this sysctl only ever blocks a caller from a **www-data-owned** file in `/tmp`, and the caller it blocks is root. www-data being unable to write a root-owned file is a plain mode-bit problem, not this.

**CRLF in Windows-edited files.** `.gitattributes` sets `eol=lf` for `.sh`, `.service`, and sudoers files. If you edit with a Windows tool that bypasses git's filter, CRLF will silently break script parsing and sudoers. Check with `file <script>` before committing. The installer's `sed -i 's/\r$//'` pass catches this on deploy but the source should always be clean.

**Forgetting `sudo -n` in CGI invocations.** CGI runs as www-data. Any call to a root-required binary (iptables, systemctl, reboot, chown) without `sudo -n` will silently fail or produce a permission error that is hard to diagnose. Always use the `platform.sh` wrappers (`run_iptables`, `svc_*`, `run_reboot`) from CGI context.

**Inlining `( sleep N && reboot )` in a CGI script.** Two failure modes, both silent: (1) bare `reboot` runs as www-data and fails with "Failed to talk to init daemon" because systemd's private bus rejects unprivileged callers; (2) even if you wrap it in `run_reboot`, the fixed sleep races the `/reboot/` page — lighttpd is killed mid-serve and the user sees a connection-reset instead of the countdown. Always use `cgi_reboot_response` (see [§4.3.1](#431-reboot-ack-handshake)); it uses the sudo-aware `run_reboot` and waits for the page's ack file before pulling the plug.

**Trying to `systemctl enable` on RM520N-GL.** `systemctl enable` is a no-op on this platform because unit files are on the read-only rootfs where the command cannot write symlinks. Always use `svc_enable` / `svc_disable` from `platform.sh`, which writes the symlinks directly via `sudo /bin/ln -sf` and `sudo /bin/rm -f`.

**Calling `svc_enable` / `svc_disable` without checking the return value.** Both write to the rootfs, which can be read-only, and both now return 0/1. An unchecked call fails silently in the worst possible way: the service still starts, the UI reports success, and the feature disappears at the next reboot with nothing logged at the point of use. Always branch on the result and surface a `cgi_error` (`service_enable_failed` / `service_disable_failed`). See [§2.1](#21-rootfs-mount-mode-contract).

**Adding `mount -o remount,ro /` after a rootfs write.** The convention in this tree is **remount `rw` once, never restore `ro`** — a script that "tidies up" by restoring `ro` leaves the filesystem unwritable for the rest of the uptime and breaks every later boot-symlink write. Keep the `sync`; it flushes to flash and is independent of mount mode. See [§2.1](#21-rootfs-mount-mode-contract).

**Adding a remount before writing to `/etc`, `/usrdata` or `/opt`.** Those are all `/dev/ubi2_0`, always mounted `rw`. `mount -o remount,rw /` does nothing for them — it only affects `ubi0:rootfs`. Harmless but misleading, and it teaches the next reader the wrong model.

**Writing to `/tmp/qmanager_*.json` from CGI without pre-creation.** If a CGI script creates a `/tmp` file that a root daemon will later overwrite, root will be blocked by `fs.protected_regular=1`. Pre-create any dual-writer file in `qmanager_setup` as **`root:root` mode 666** — that is the only ownership both UIDs can write, not a "primary writer" judgement call. See `qmanager_setup` for the full list, and [reference/tmp-file-ownership.md](reference/tmp-file-ownership.md) for the checklist.

**Publishing a shared `/tmp` file with `mv`.** The project-wide "atomic write" habit is wrong for a `/tmp` file that both UIDs write. `rename(2)` swaps the inode, so the new file is owned by whoever wrote the temp, at their umask — and the other UID is locked out for the rest of the boot, silently. Write through the existing inode (`cat tmp > file`), PID-qualify any scratch name (`${FILE}.tmp.$$`, never a fixed `.tmp`), and make the reader tolerate a torn read since you no longer have atomic publication. Same applies to `rm`-to-reset: truncate with `: >` instead.

**Hardcoding service lists in install/uninstall.** Use filesystem scans instead. `install_rm520n.sh` discovers services by globbing `scripts/etc/systemd/system/qmanager-*.service`. Adding a new service file is sufficient -- no installer edits needed.

**Using `kill -0` for cross-user PID checks.** `kill -0 <pid>` fails with EPERM when www-data checks a root daemon's PID. Use `pid_alive()` from `platform.sh` which checks `/proc/$pid` existence instead.

### Platform Tooling Quirks (probe-confirmed 2026-05-09)

These quirks are easy to miss when porting code from a typical GNU/Linux box. Every item below was verified by direct SSH probing of the target firmware (`LE.UM.6.3.6.r1-02600-SDX65.0`).

**`bash` is 3.2.57.** Predates `mapfile`, `readarray`, `${var,,}`, `${var^^}`, `wait -n`, `declare -A`. See [§2 Critical Constraints](#2-critical-constraints) for the full list and workarounds.

**`/bin/sh` is BusyBox `ash`, not bash.** Do not put bashisms in `#!/bin/sh` scripts even if they "work locally" — they will fail on-device. Use `#!/bin/bash` if a script genuinely needs bash features.

**`sed` is BusyBox sed (1.31.1), not GNU sed.** Probe shows: `sed -i`, `sed -i.bak`, `sed -E`, `sed -r` all work. **Avoid:** GNU-specific `\<`/`\>` word boundaries, `sed -i ''` (empty SFX requires a non-empty arg or no arg at all), `sed --expression` long form. Stick to short flags.

**`awk` is BusyBox awk.** Probe shows `length()`, indexed arrays, `gensub()`, `systime()`, `strftime()` all available. Does **not** accept `--version` (silent stderr). For one-off scripts this is rich enough — but do not assume full gawk: `--posix`, `--re-interval`, GNU `printf %a`, `getline` over pipes with `|&` may behave differently.

**`tar` is BusyBox tar (1.31.1).** Only short flags: `c|x|t -ZzJjahmvokO -f -C -T -X --exclude`. **Missing:** `--owner=`, `--group=`, `--transform=`, `--newer-mtime=`, `--exclude-from`, `--mode=`. Backup/restore code that relies on these will silently misbehave or refuse the option.

**`xmlstarlet` is NOT installed.** Earlier docs imply `xmlstarlet` is the tool for `/etc/data/mobileap_cfg.xml`; **it is not present** on stock RM520N-GL. Use **`xmllint`** (`/usr/bin/xmllint`, system-bundled) for queries, or `sed`/`awk` for simple in-place edits. If a feature requires xmlstarlet, the installer must `opkg install xmlstarlet` from Entware first.

**`date` cannot do nanoseconds or relative-time parsing.**
- `date +%N` returns the **literal string `%N`** (no expansion). For sub-second timestamps, use `date +%s` (seconds only).
- `date -d 'now - 1 hour'` returns `invalid date` — BusyBox date has no GNU date-string parser. Compute offsets in shell: `$(( $(date +%s) - 3600 ))` and feed back via `date -d @<epoch>` (this **does** work).

**`mktemp --tmpdir=` is unsupported.** Use the template form: `mktemp /tmp/qmanager_foo.XXXXXX`.

**`ps -o etimes` is unsupported.** Only `etime` (HH:MM:SS string format) is allowed. To get elapsed seconds, parse `etime` in shell or read `/proc/<pid>/stat` field 22 (`starttime` jiffies) and subtract from `/proc/uptime`.

**`ss` is not installed.** Use `/opt/bin/netstat` (Entware net-tools) or BusyBox `netstat`. There is no `ss --version` to detect.

**No script interpreters beyond shell.** No `python`, `python3`, `perl`, `lua`, `node` — none. Anything that needs structured logic must be written as POSIX shell + `jq`. Adding an interpreter would mean an Entware package install (`opkg install python3`) plus its ~15 MB footprint on the persistent partition.

**No `getconf` for `ARG_MAX`/`PIPE_BUF`/`PATH_MAX`.** These names return empty on this device. Use Linux defaults: `ARG_MAX = 131072`, `PIPE_BUF = 4096`, `PATH_MAX = 4096`. If you need a real check, read `/proc/sys/kernel/...` directly.

**No NTP, RTC drifts to 1970.** `timedatectl` reports `System clock synchronized: no` and `NTP service: n/a`. Wall-clock time is set by the cellular network when it attaches; if the modem is offline at boot the clock can be years off. Never rely on absolute timestamps for security-sensitive ordering — use monotonic deltas (`/proc/uptime`) where possible.

**`/etc`, `/opt`, `/usrdata`, `/data`, `/cache`, `/persist`, `/systemrw` all bind-mount the same `/dev/ubi2_0` ubifs volume (~124 MB total).** Writes anywhere in this set consume from the same pool. `/tmp` is a separate 89 MB tmpfs (volatile). The rootfs `/` is `/dev/ubi0:rootfs` (~100 MB) — boots `ro` (proof: `ro` in `/proc/cmdline`, **not** `/proc/mounts`, which shows our own boot-time remount) and must be `mount -o remount,rw /` before a persistent write, then `sync`ed. **Do not remount it back to `ro`** — see [§2.1 Rootfs mount-mode contract](#21-rootfs-mount-mode-contract).

**Single-core CPU, 178 MB RAM, ~91 MB zram swap.** ARMv7-A Cortex-A7 @ ~1.2 GHz (`BogoMIPS 38.40`) with VFPv4 + NEON + IDIVA/IDIVT. CPU-bound shell loops compete with the modem stack — keep daemon polling intervals reasonable and avoid per-second `jq` invocations on large JSON.

**`kernel.dmesg_restrict=1` and `kernel.kptr_restrict=2`.** Non-root cannot read kernel ring buffer; pointer values are zeroed in `/proc`. Diagnostic scripts that scrape `dmesg` will return empty under www-data.

**`conntrack_max = 12288`.** NAT table is small. Don't run conntrack-heavy probes (e.g., concurrent port scans) from the modem.

**Hardware-enforced binary ABI.** Native binaries shipped in `dependencies/` must be **armhf VFPv4** (Cortex-A7 features: `half thumb fastmult vfp edsp neon vfpv3 tls vfpv4 idiva idivt vfpd32 lpae evtstrm`). `armel` (soft-float) binaries will run but slowly; `aarch64` will not run at all.

**`iptables` rules live in a dedicated `QMANAGER_FW` user chain.** All web-UI port-firewall rules (ports 80/443 ACCEPT on trusted interfaces, DROP on others) live in the user chain `QMANAGER_FW` hooked from `INPUT`. `qmanager_firewall start` creates the chain (`-N`), flushes it (`-F`), populates the rules (`-A`), and hooks `INPUT` exactly once (`-I INPUT 1 -j QMANAGER_FW`). `qmanager_firewall stop` unhooks, flushes, and deletes the chain. This replaces an earlier direct-`INPUT` layout that left orphan rules across version drift (e.g. `DROP -i rmnet_data0 -p tcp --dport 80` rules from a prior trusted-interface set). Both `start` and `stop` also call `cleanup_legacy_input_rules()` to drain such orphans on devices upgrading from the old layout. Inspect with `iptables -L QMANAGER_FW -n -v` — single source of truth.

---

## 15. See Also

- `API-REFERENCE.md` -- CGI request/response schemas for all 69 endpoints
- `DEPLOYMENT.md` -- Install and update operational flow; installer behaviour; upgrade/rollback procedures
- `docs/rm520n-gl-architecture.md` -- Platform internals: Entware bootstrap, lighttpd configuration, boot sequences, `/usrdata/` partition layout, troubleshooting
- `ARCHITECTURE.md` -- System overview: component diagram, data flow, frontend/backend boundary
- `RELEASE_NOTES.md` -- Current release notes and version history
