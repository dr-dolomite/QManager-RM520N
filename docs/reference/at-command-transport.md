# AT Command Transport (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · qcmd cut-over (T4.1) verified 2026-10-28 on `61368cd2`
> **RG501Q-EU (SDX55):** same broker and same `qcmd` since T8.1 (`qmanager_atd` 0.7.1) · verified 2026-10-29 on `b7e3d6f1` (broker under systemd 239, socket and in-process paths, error contract, lock wait) · see [`platform-matrix.md`](./platform-matrix.md#at-transport)

> Every AT command QManager sends goes through `qcmd`, which on every model is a symlink to the Rust `qmanager_atd` binary. On the RM520N-GL and the RG501Q-EU it is a client of the `qmanager_atd` broker, with an in-process fallback when the broker is down; on an unknown model no broker runs, so it always runs the exchange in-process on `/dev/smd11`. Both paths serialise on one `flock` and keep the same error contract, which is what every caller in the tree is written against. SMS no longer uses this path (see SMS operations).

### Quick reference

| Item | Value |
| ---- | ----- |
| `/usr/bin/qcmd` | Symlink to `qmanager_atd` on every model (made by `install_backend()`) |
| Broker unit | `qmanager-atd.service` (RM520N-GL and RG501Q-EU, gate `qm_hw_atd_enabled`; boot-linked, started after `qmanager-setup`) |
| Broker socket | `/var/run/qmanager_atd.sock` |
| AT lock | `/run/qmanager_at/at.lock` (`root:dialout` 0640, in a `root:dialout` 0750 dir; only root creates either) |
| Bridge marker | `/run/qmanager_at/bridge` (root-only; while present, holders also take the legacy `/tmp/qmanager_at.lock`) |
| Long-command flag | `/run/qmanager_at/long_running` (raised by the root broker while a long command runs; counted only when root-owned, regular, one link) |
| Shell flag check | `qm_long_flag_up [path]` in `scripts/usr/lib/qmanager/qlog.sh` (poller, watchcat) |
| Extra long-command patterns | `/etc/qmanager/long_commands.list` (seeded by `qmanager_setup`) |
| Log | `/tmp/qmanager.log` (component `qcmd`) |
| Failure signal | exit 1, empty stdout, stderr `ERROR: modem_busy` or `ERROR: command_failed` |

---

## Platform comparison

| Modem | Transport | Wrapper |
|-------|-----------|---------|
| RM551E | `sms_tool` via USB | `qcmd` |
| RM520N-GL | `qmanager_atd` broker on `/dev/smd11`; in-process exchange on `/dev/smd11` when the broker is unreachable | `qcmd` (link to `qmanager_atd`) |
| RG501Q-EU | Same as the RM520N-GL: broker on `/dev/smd11`, in-process when the broker is unreachable (verified 2026-10-29) | `qcmd` (link to `qmanager_atd`) |
| Unknown model | In-process exchange on `/dev/smd11` (no broker unit is installed) | `qcmd` (link to `qmanager_atd`) |

---

## Retired binaries: `atcli_smd11` and `sms_tool`

Neither ships any more (T5.1 S6). `qcmd` replaced `atcli_smd11` as the AT transport and `qsms` replaced `sms_tool` for SMS; the shell `qcmd` script that wrapped `atcli_smd11` is gone from the tree.

A device upgraded from an older release still has both files in `/usr/bin/`. The installer step `retire_legacy_at_binaries()` (`install_rm520n.sh`) removes them. It runs last under `DO_START`, after `at_stack_check`, so it runs on an OTA too, and it removes each file only once its replacement answers:

| File | Removed only if |
| ---- | --------------- |
| `/usr/bin/sms_tool` | `qsms status` exits 0 within 8 s |
| `/usr/bin/atcli_smd11` | `readlink /usr/bin/qcmd` is `qmanager_atd` **and** `qcmd AT` exits 0 within 8 s |

A failed gate keeps the file and prints `Kept /usr/bin/<file> (its replacement did not answer)`; the step never fails the install. An install run with `--no-start` skips it, so the files stay until the next install that starts services.

> ℹ️ NOTE: An OTA rollback to an older release reinstalls both binaries from that tarball. `uninstall_rm520n.sh` still `rm -f`s both for older installs.

---

## qcmd serialization

All AT access is serialised by an exclusive `flock` (a POSIX advisory file lock; one holder at a time) on **`/run/qmanager_at/at.lock`**. The broker, `qcmd`'s in-process path, `qsms`'s AT backend and any shell caller that takes the lock itself all take the same lock, so they exclude each other.

### The AT lock and who may hold it

The lock moved out of `/tmp` in T4.3. In `/tmp` it was world-writable (0666), so any local user could hold it and stall every AT caller, or plant the file before `qmanager_setup` ran. The layout, the fail-closed path and the OTA crossing were verified on the RM520N-GL (`61368cd2`) on 2026-10-31; the code is shared, but the RG501Q-EU has not been measured.

| Path | Owner | Mode | Created by |
| ---- | ----- | ---- | ---------- |
| `/run/qmanager_at/` | `root:dialout` | 0750 | `qmanager_setup`, `ensure_at_lock()` in `install_rm520n.sh`, `rollback_prep_at_lock()` in `qmanager_update`, or `create_modem_lock()` in `native/qmanager_atd/src/common/lock.rs` when the caller is root |
| `/run/qmanager_at/at.lock` | `root:dialout` | 0640 | the same four |
| `/run/qmanager_at/bridge` | `root:root` | 0644 | the installer and rollback prep only (see [Crossing the move](#crossing-the-move-the-bridge-marker)) |

- **Who can lock it.** `flock()` needs only a read fd, so the group read bit is enough. lighttpd's CGIs run as `www-data`, which is in `dialout`; root daemons open it as root. No other uid can open it.
- **Nothing can be planted.** The dir is not sticky and only root can write in it, so no other uid can create a file, symlink or FIFO there. `LockFile::open` still opens with `O_NOFOLLOW | O_NONBLOCK` and refuses anything but a regular file with a trusted owner.
- **Never truncated.** Every creator makes the lock only when it is missing and fixes owner and mode in place, so a flock held across a `qmanager_setup` restart survives.
- **`/run` is tmpfs.** The dir is gone after every reboot; `qmanager-setup.service` recreates it. `qmanager-atd.service` is ordered `After=qmanager-setup.service`, and the broker opens the lock without creating it (`LockFile::open_modem`), so it exits 1 if the lock is missing.

#### Fail-closed for non-root callers

This only matters on the in-process path (broker unreachable); a call the broker serves never opens the lock itself. When the dir or the lock is missing, an in-process `qcmd` or `qsms` run as root creates both (`LockFile::open_or_create_modem`). A non-root caller cannot, and has no fallback:

- `qcmd`: exit 1, empty stdout, stderr `ERROR: modem_busy`, and in `/tmp/qmanager.log` (component `qcmd`): `AT lock /run/qmanager_at/at.lock refused: AT lock missing; only root creates it`
- `qsms` (AT backend): its JSON error with code `modem_busy`, no log line
- neither creates the dir nor falls back to the legacy `/tmp/qmanager_at.lock`

At boot, lighttpd can start about 0.4 s before `qmanager-setup` (measured on the RM520N-GL), and the broker is not up yet either. A CGI AT call in that window gets `modem_busy`.

> ⚠️ WARNING: Do not add an ordering edge between `lighttpd.service` and `qmanager-setup.service` to close that window. One was tried (`eebec007`, `After=qmanager-setup.service` on lighttpd) and reverted (`db81d2d5`) because it deadlocked every UI OTA. The installer runs inside lighttpd's cgroup, so lighttpd's restart waits for the installer to exit; with the edge, the `qmanager-setup` restart queued behind lighttpd, `qmanager-atd` queued behind setup, and the installer blocked on starting `qmanager-atd`. lighttpd's 90 s stop timeout then killed the installer and the updater mid-OTA (measured on the RM520N-GL, 2026-10-31). The window is accepted; no AT refusal was logged in it on the measured boots.

For the same reason the installer starts `qmanager-console` with `systemctl --no-block start` (`7cfa9486`, also in `qmanager_console_mgr install`): the console unit is `After=lighttpd`, and lighttpd's restart cannot finish while a UI OTA's installer lives in its cgroup.

#### Crossing the move: the bridge marker

Code from v0.1.17 and earlier flocks only `/tmp/qmanager_at.lock`. While old and new code can run at the same time, both must exclude each other, so a root-only marker turns on a bridge:

- **When the marker counts.** `/run/qmanager_at/bridge` is a regular file, owned by root, with one link. Anything else is ignored.
- **What the bridge does.** While it counts, every holder (broker, in-process `qcmd`, `qsms` AT backend) takes the new lock first and then the legacy lock. If the legacy lock is held elsewhere, it releases the new lock and retries: a holder never keeps one without the other. The marker is checked with the new lock held, so every holder that starts after the marker appears also takes the legacy lock.
- **When the legacy file is trusted.** Regular file, owner root or `www-data`, one link (a hard link to some other 0666 file in `/tmp` is refused). An untrusted or missing legacy file is skipped, not waited on, and logged once: `AT lock bridge on but legacy /tmp/qmanager_at.lock <absent|unopenable|untrusted>; not taken`.

Who creates the marker:

| Path | Condition | Purpose |
| ---- | --------- | ------- |
| `ensure_at_lock()` in `install_rm520n.sh` (runs first in `install_bundled_binaries`, before the binary swap, regardless of `DO_BACKEND` / `DO_START`) | a trusted legacy lock exists (`stat -c '%u %h %F'` is `0 1 regular…` or `33 1 regular…`) | an OTA from a release whose poller and daemons still run until the services restart |
| `rollback_prep_at_lock()` in `qmanager_update` (rollback mode, before the installer runs) | always | rollback to a v0.1.17-or-older target, which flocks only the legacy path |

Rollback prep also replaces an untrusted legacy lock with a fresh `www-data:www-data` 0666 one (as v0.1.17's `qmanager_setup` would), then drains: it polls `flock -x -n /run/qmanager_at/at.lock` once a second for up to 200 s (BusyBox `flock` has no `-w`), so holders that started before the marker finish first. On timeout it logs `WARN: AT lock still held after 200 s; continuing rollback` and carries on.

A reboot clears the marker, because `/run` is tmpfs.

> ⚠️ WARNING: A v0.1.17-or-older tarball installed by hand over SSH skips rollback prep, so there is no marker. Until the next reboot, old and new holders do not exclude each other. Use the UI rollback, or reboot after a manual downgrade.

#### The long-command flag trust rule

The flag is `/run/qmanager_at/long_running` (`LONG_FLAG` in `native/qmanager_atd/src/at/exec.rs`, `qmanager_atd` 0.7.3). It sits in the root-only AT lock dir, so only root can create it. In practice the broker is the only writer: it raises the flag after it takes the lock for a long command and removes it when the exchange ends (log lines `Long command started: <cmd>` / `Long command completed: <cmd>`). Measured on the RM520N-GL (`61368cd2`, 2026-10-31) during a UI cell scan: `0:0`, mode 0644, one link, nothing in `/tmp`.

| Check | Where | Counts the flag only if |
| ----- | ----- | ----------------------- |
| `flag_trusted()` | `exec.rs`; used by `long_running()` (the `qcmd` / broker gate) and `scan_up()` in `daemon/live.rs` (the live-data scan gate) | `lstat` says regular file, `nlink` 1, uid 0 |
| `qm_long_flag_up [path]` | `scripts/usr/lib/qmanager/qlog.sh`; used by `qmanager_poller` and `qmanager_watchcat` | `stat -c '%u %h %F'` (no `-L`, so a symlink fails) starts with `0 1 regular` |

An untrusted flag is ignored; the broker logs it once: `Ignoring untrusted /run/qmanager_at/long_running (uid <n>, links <n>)`. A `www-data` file no longer counts: only root can create entries in that dir, so any other owner is a plant.

- **A non-root in-process caller cannot raise it.** When the broker is down, a long command run in-process as `www-data` skips the flag write silently and the scan runs without the gate. This is the degraded mode only.
- **`write_nofollow` refuses a hard link.** `open_trusted()` in `common/safefs.rs` now treats an existing file with `nlink > 1` like a symlink or a foreign file: it unlinks the name and recreates it, so a write never goes through a second name.
- **Stale flag.** At broker start, `clear_stale_long_flag()` removes a flag older than 15 s when nobody holds the AT lock (a broker killed mid-scan). The poller still expires a flag older than `LONG_FLAG_MAX_AGE` (300 s), now measured against `date +%s`.

> ⚠️ WARNING: Do not raise the flag from a script before `qcmd` runs the long command. `qmanager_cell_scanner` used to `: > "$LONG_FLAG"` before calling `qcmd 'AT+QSCAN=3,1'`; that was removed. The client's queued-command watch in `native/qmanager_atd/src/client/transport.rs` assumes the flag cannot appear while its own short command is the one executing, because only a long command run by the broker raises it. An early write broke that: a short command already running saw the flag, dropped its socket and failed with `scan_in_progress` (shown as `modem_busy`).

**No `/tmp` bridge, on purpose.** In an OTA, between `install_bundled_binaries` and `stop_services`, the old broker still executes every command and writes the old `/tmp/qmanager_long_running`, which the old poller and watchcat read: old code with old code. The only new code live in that window is the new `qcmd` client, whose watch reads the new path and misses an old-broker scan, so its short command waits in the queue as it did before the watch existed. Nothing double-runs and nothing is locked out. `stop_services()` removes a leftover `/tmp/qmanager_long_running`. A rollback brings back code that uses `/tmp`; `/run` is tmpfs and a reboot follows every successful install.

> ℹ️ NOTE: The broker and the shell readers must ship together. New scripts beside a pre-0.7.3 broker read `/run` while the broker writes `/tmp`, so the poller and watchcat never back off during a scan. The tarball carries both; never hand-copy one side. The RG501Q-EU runs the same code but has not been measured on 0.7.3.

### `qcmd` is the broker client

On every model `install_backend()` makes `/usr/bin/qcmd` a symlink to `qmanager_atd`. The binary picks its role from `argv[0]`: called as `qcmd`, it is the client. The link is replaced atomically (`ln -sf` to a temp name, then `mv -f`), so a caller never finds `qcmd` missing mid-install.

Only the broker daemon is per model: `qmanager-atd.service` exists on the RM520N-GL and the RG501Q-EU (gate `qm_hw_atd_enabled`, `RM520N*|RG501Q*`). On any other model there is no socket, so every call takes step 4 below.

Each call runs in this order:

1. **Refuse non-AT input.** A command that does not start with `AT` (any case) or contains a control character answers `command_failed` at once and touches nothing. The broker checks again, because its socket is the trust boundary.
2. **Long-flag gate.** If a trusted `/run/qmanager_at/long_running` exists (see [the trust rule](#the-long-command-flag-trust-rule)) and the command is not long, answer `modem_busy` at once.
3. **Try the broker** on `/var/run/qmanager_atd.sock`. The broker takes the lock, runs the exchange on the `/dev/smd11` fd it keeps open, and returns the raw reply.
4. **Fall back in-process** only if the broker is unreachable: no socket, a stale socket, connect refused, or `/var/run/qmanager_atd.proto` missing or naming another protocol version (an old broker mid-OTA). The client then opens `/dev/smd11` itself under the same lock.
5. **Judge the reply** with the contract below (the same on every model) and print it.

A request that reached the broker is **never re-run in-process**. If the broker accepts the request and then dies, times out or sends a reply the client cannot decode (an older protocol), the caller gets `command_failed`, not a second send. Re-running a write such as `AT+COPS=2` after a lost reply could apply it twice.

If the lock does not exist yet (early boot, or an install run with `--no-start` before `qmanager_setup` ran), the in-process fallback creates it only when run as root; a CGI gets `modem_busy` (see [Fail-closed for non-root callers](#fail-closed-for-non-root-callers)).

| Budget | Value | Applies to |
| ------ | ----- | ---------- |
| Lock wait, short | 5 s | every command not listed below |
| Lock wait, long | 10 s | long commands |
| Exchange deadline, short | 20 s | everything else |
| Exchange deadline, slow | 60 s | `COPS=?`, `CFUN=`, `QMBNCFG`, `CGATT=`, `QPRTPARA` |
| Exchange deadline, long | 300 s | long commands |

**Long commands** are a case-sensitive substring match on `QSCAN`, `QSCANFREQ`, `QFOTADL`, `COPS=2`, `COPS=0`, plus any non-comment line of `/etc/qmanager/long_commands.list`. The broker writes `/run/qmanager_at/long_running` for a long command's duration, once it holds the lock; the command sends a warm-up `AT` first, and is never cut short by a caller cap.

The broker unit `qmanager-atd.service` is boot-linked on the RM520N-GL and the RG501Q-EU. `start_services()` runs `systemctl reset-failed qmanager-atd` and starts it after `qmanager-setup` (which creates the lock file) and before the poller. It is in the install verify list, and the install-time AT probe runs through `qcmd`, because the broker may hold `/dev/smd11`.

> ℹ️ NOTE: A stopped broker does not stop AT traffic: every call falls back in-process. That is why `qmanager_health_check` reports `svc.atd` as **fail** when the unit is `failed` or `inactive` on the RM520N-GL or the RG501Q-EU: nothing else would show it. Other states warn; other models skip.

### Shell callers that take the lock themselves

- **flock pattern**: open `/run/qmanager_at/at.lock` with a read-only file descriptor (`9<`), or call `flock -x -n /run/qmanager_at/at.lock <cmd>` as `qmanager_health_check` does. The caller must be root or in `dialout`; never create the file from a shell caller. A shell locker takes only the new lock, so it does not see the bridge.
- **BusyBox flock limitation**: BusyBox `flock` on this platform lacks the `-w` (timeout) flag. Use `flock -x -n` in a polling loop instead; `_apn_apply_lock_acquire()` in `scripts/usr/lib/qmanager/apn_apply.sh` is a working example.

### Error codes

Callers in this tree know exactly two codes, so the Rust `qcmd` folds the broker's wider set into them. The real code is logged to `/tmp/qmanager.log` as `<code> reported as <shown>: <cmd>`.

| Broker code | Shown to the caller |
| ----------- | ------------------- |
| `modem_busy` | `modem_busy` |
| `scan_in_progress` | `modem_busy` |
| `command_failed` | `command_failed` |
| `modem_not_ready` | `command_failed` |
| `command_timeout` | `command_failed` |
| `invalid_command` | `command_failed` |

The reply itself is judged on the whole buffer, exactly as the shell did: it contains `ERROR` (which covers `+CME ERROR:` and `+CMS ERROR:`) → `command_failed`; it is empty → `command_failed`; otherwise (an `OK`, or any other non-empty text) it is passed through with exit 0. The broker itself passes a modem `ERROR` back as a reply; the RM520N mapping lives in the client.

Differences from the retired shell `qcmd`, all deliberate:

- **Long-flag gate.** While a trusted `/run/qmanager_at/long_running` exists, a short command answers `modem_busy` at once instead of waiting 5 s for the lock.
- **`AT+QMAP` is refused while QCMAP is down, and after QCMAP restarts until the next reboot** (crate 0.7.5; restart rule 0.7.7). Any command containing `+QMAP` (any case, anywhere in a compound) answers `modem_not_ready` (`command_failed` to the caller) at once, before the lock and with no modem I/O, when no `/proc/[0-9]*/comm` reads `QCMAP_Connectio`, or when the earliest such process started more than 120 s after boot (`/proc/<pid>/stat` field 22, clock ticks since boot; an unreadable start time also refuses). On 2026-11-01 a QMAP query with QCMAP stopped wedged smd11 on the RG501Q-EU for 43 min (R6 F1). On 2026-11-02 the first QMAP sent 9 s after a `systemctl stop/start` of QCMAP wedged smd11 on the RM520N-GL (S5 F2). Neither an atd restart (F1) nor an atfwd restart (F2) brought the port back; only a reboot did, so the broker attempts no recovery and simply fails fast while the channel is down. On three RG501Q-EU boots the boot itself started QCMAP at 8.7–8.9 s, and QMAP was safe then; on three RM520N-GL boots it was 6.6–7.1 s. The check lives in `Executor::run_after` (`at/qcmap.rs`), so the broker and the in-process fallback share it; the answer is cached 2 s, and if `/usr/bin/QCMAP_ConnectionManager` does not exist the guard is off. The log gets one WARN per change of reason (`QCMAP not running: refusing AT+QMAP` or `QCMAP restarted after boot (started at N s): refusing AT+QMAP until reboot`, or `QCMAP start time unreadable: refusing AT+QMAP until reboot`) and an INFO on recovery. `qmanager_atd --qcmap` prints the guard's view (`qcmap=running|stopped|restarted|absent`) without sending anything. The poller's `qcmap_up` asks that same command (stopped/restarted → skip the QMAP reads and send plain `AT+CGCONTRDP` in Tier 2, taking `network.wan_ipv4` from that same reply via `parse_at.sh::cgc_wan_ipv4` instead of `+QMAP="WWAN"`: field 4 of each non-IMS record, IPv4 only (4 octets, or 8 = address + mask), preferring the address configured on an `rmnet*` interface, else the first; empty on a bare `OK`; `wan_ipv6` stays blank then. APN/DNS still come from the first non-IMS record, so on a multi-context SIM the two can name different contexts), and `cgi_at.sh::detect_active_cid` retries plain `AT+CGPADDR` when its `AT+CGPADDR;+QMAP="WWAN"` compound comes back refused (it then loses the authoritative QMAP CID and takes the first CGPADDR CID with an IPv4 address), and `profiles/current_settings.sh` re-sends its compound without the `+QMAP` leg. Known gap: a manual QCMAP restart inside the first 120 s of uptime is not caught.
- **Non-AT input is refused.** The shell sent it to `atcli_smd11`, which never returned and held the AT lock until killed (reproduced 2026-10-28 with `qcmd hello`).
- **A wait cap exists.** `qcmd -t MS` or `QCMD_WAIT_MS=MS` (50–60000) caps how long the **caller** waits for a short command. It does not shorten the exchange: the broker still holds the port and the lock until the command's own deadline (20 s short, 60 s slow). The poller sets `QCMD_WAIT_MS=5000` on its `AT+QMAP` reads; nothing else uses it.
- **A quiet mode exists** (crate 0.7.6). `qcmd -q` or `QCMD_QUIET=<anything but empty or 0>` logs the client's `Command returned ERROR` and `Empty response for` lines at DEBUG instead of ERROR. Nothing else changes: exit code, stdout and stderr are the same as without it (`-j` included), and transport faults keep their level. The flag is client-only and never crosses the socket. The poller uses the env form on its three `radio_attached`-gated reads (per-antenna, NR and LTE TA + MIMO), which still fail on a flapping link; use the env form in scripts, since an older binary would take `-q` as the command.
- **`COPS=2` and `COPS=0` are long commands.** They get the 10 s lock budget and set the long flag, so short commands answer `modem_busy` while an attach cycle runs.
- **Only a root client creates the lock** when `qmanager_setup` has not yet; the shell created it 0666 for anyone (T4.3).

Parity was measured on the RM520N-GL on 2026-10-28: 14 cases byte-identical in exit code, stdout and stderr between the shell and Rust `qcmd`, as root and as `www-data`, with the broker down and up. A held lock gave the same `modem_busy` after the same 5 s wait; `AT+QSCAN` had the same shape; the `AT+COPS=2` / `AT+COPS=0` attach cycle returned exit 0 with echo and `OK`.

On the RG501Q-EU (`b7e3d6f1`, 2026-10-29) the in-process Rust `qcmd` gave byte-identical stdout to the shell `qcmd` for `ATI`, `AT+CSQ`, `AT+CPIN?`, `AT+COPS?`, `AT+CGCONTRDP`, `AT+QCAINFO` and `AT+CVERSION;+CGMM;+CGSN`; `AT+QENG="servingcell"` differed only in live RSRQ/RSSI. An unknown command gave exit 1, empty stdout and `ERROR: command_failed` on both. With the lock held 4 s by `flock -x /tmp/qmanager_at.lock` (its path before T4.3), both waited and returned exit 0. With the broker running, `qcmd` through its socket answered as root and as `www-data`.

---

## How to detect a qcmd failure

**Short version: `qcmd` reports failure through its exit status and `stderr`. It never puts the word `ERROR` on `stdout`, and it never returns a non-empty `stdout` on failure. Check `$?`. Everything else is guesswork.**

Why it works that way: `qcmd` is a gatekeeper, not a pass-through. It classifies the modem's raw reply itself (see [Error codes](#error-codes)) and then re-emits a *clean* result — payload on `stdout` for the caller to parse, or a diagnostic on `stderr` plus `exit 1`. Keeping the two streams separate is deliberate: a CGI script's `stdout` **is** its HTTP response body, so anything diagnostic that leaks there corrupts the JSON.

### The four outcomes

| Outcome | exit | stdout | stderr |
| ------- | ---- | ------ | ------ |
| Success | 0 | **command echo** + payload + `OK` | — |
| Lock timeout, or a long command in progress | 1 | *empty* | `ERROR: modem_busy` |
| Modem returned `ERROR` / `+CME ERROR:` / `+CMS ERROR:` | 1 | *empty* | `ERROR: command_failed` |
| Empty modem response, timeout, or non-AT input | 1 | *empty* | `ERROR: command_failed` |

Lock wait before `modem_busy` is **5 s**, or **10 s** for long commands; while a long command runs, a short one answers `modem_busy` at once. See [qcmd serialization](#qcmd-serialization).

### Two consequences that bite

**1. Empty `stdout` ⇔ failure, unconditionally.** The reply carries the echoed command line before the payload on both transports, so a *successful* read structurally cannot produce empty output — even a query that matches nothing still returns the echo and `OK`. There is no "succeeded but returned nothing" case to worry about.

**2. `case "$result" in *ERROR*)` is dead code.** Wherever that idiom is matched against `qcmd`'s captured `stdout`, the first arm can never be taken: on failure `stdout` is empty, and on success the modem's own reply contained no `ERROR` (that is precisely what `qcmd` already checked). Every rejected write silently falls through to the `*)` "success" arm.

```sh
# WRONG — the *ERROR* arm is unreachable; a rejected write reports as applied.
result=$(qcmd "AT+QNWPREFCFG=\"roam_pref\",255" 2>/dev/null)
case "$result" in
    *ERROR*) errors="roam_pref" ;;
    *)       applied="roam_pref" ;;
esac

# RIGHT — check the exit status.
if qcmd "AT+QNWPREFCFG=\"roam_pref\",255" >/dev/null 2>&1; then
    applied="roam_pref"
else
    errors="roam_pref"
fi
```

> ⚠️ WARNING: **`$?` is clobbered by the very next command.** A line like `[ -z "$raw" ] && qlog_warn "empty"` placed after the assignment overwrites `$?` before you can read it — the status you then capture belongs to the `[` test or the log call, not to `qcmd`. Capture `rc=$?` on the **statement immediately following** the assignment, then do everything else.

```sh
raw=$(qcmd 'AT+QUIMSLOT?' 2>/dev/null)
rc=$?                                    # must be the very next statement
[ -z "$raw" ] && qlog_warn "empty response"
[ $rc -ne 0 ] && { cgi_error "read_failed" "Modem read failed"; exit 0; }
```

### The cleaner option for new callers: `qcmd -j`

`qcmd -j "AT+..."` wraps the outcome in JSON on **`stdout`** in both directions (`json_success` / `json_error` in `native/qmanager_atd/src/at/output.rs`):

```json
{"success": true,  "response": "...", "command": "AT+QUIMSLOT?"}
{"success": false, "error": "modem_busy", "command": "AT+QUIMSLOT?"}
```

New callers that already have `jq` in hand should prefer this — one stream, one shape, no `$?` discipline to get wrong. (`qcmd` still exits `1` with the error envelope, but read the `success` field rather than `$?`.)

### Read failures must not become fabricated values

The second half of this bug class is on the *read* side. A GET that seeds defaults (`sim_slot="1"`, `mode_pref="AUTO"`, …) and then overwrites them only when a `grep` matches will, on a failed `qcmd`, emit the entire seeded set as if it were the modem's state — with `success: true` on top. This was reproduced live: a modem genuinely on SIM slot 2 reported `"sim_slot": 1` during lock contention.

The rule is **guard the transport result, not the individual fields**:

- If `rc != 0`, return an error envelope and emit **no data object at all**. Absence is the honest signal.
- If `rc == 0` but one line is missing from an otherwise good response, **keep the seeded default**. A missing individual line is usually a legitimate firmware difference; nulling per-field would turn a working page into a permanently broken one on that firmware.

`scripts/www/cgi-bin/quecmanager/cellular/settings.sh` is the reference implementation (see [cellular-basic-settings.md](cellular-basic-settings.md) > *The read contract*).

### The repo-wide sweep, and what is left

The broken half of this was swept on **2026-08-23 in `b4d87ef`**: 26 sites across 9 files, plus companion fixes in two library functions, for 11 files touched. Every `*ERROR*` arm that had no `rc` check and no emptiness guard in front of it is gone, replaced by `rc` capture on the statement immediately following the assignment. Inventory below re-verified against `grep -rn 'in \*ERROR\*\|\*ERROR\*)' scripts/` on **2026-08-23**.

What the sweep bought, in the terms a user would have seen it: `qmanager_tower_schedule` used to flip config to `enabled:true`, spawn the failover watcher and re-apply MTU for a scheduled lock that never reached the modem. `imei.sh` and `qmanager_imei_check` returned `reboot_required:true` for a rejected `AT+EGMR` and cleared the pending flag, so the user rebooted for nothing and it never retried. `ip_passthrough.sh` persisted and served back a config whose every AT command had been rejected, then rebooted the device. And `frequency/status.sh` and `tower/status.sh` asserted "no lock active" on a failed read, which is the fabrication that made `frequency/lock.sh`'s mutual-exclusion gate **fail open** on a path whose own header warns that stacking a frequency lock on a tower lock can crash-dump the modem.

> ℹ️ NOTE: fixing detection **activates** branches that had never executed, so each newly-reachable body needs reviewing rather than assuming. That is not a formality: the sweep surfaced a live latent bug in `qmanager_tower_failover` (one shared `ok` flag OR'd across both RATs) and a second in `qmanager_watchcat`'s Tier 3 SIM check, where a single failed `AT+CPIN?` concluded "no SIM in the backup slot" and reverted a working failover. See [connection-watchdog.md](connection-watchdog.md).

**Writes now assert the modem's own `OK`.** Five files gained the assertion:

```sh
if [ $rc -eq 0 ] && printf '%s' "$result" | tr -d '\r' | grep -qx 'OK'; then
```

It is **`grep -qx`, line-exact, never a `*OK*` glob.** A `qcmd` response echoes the issued command back on its own line, so a glob would match any argument containing the letters "OK" and confirm a write against its own echo. The `tr -d '\r'` is there because the modem terminates lines with CRLF and `-x` anchors the whole line. Current call sites: `qmanager_imei_check:119`, `cellular/imei.sh:127`, `cellular/mbn.sh:142`, `cellular/network_priority.sh:95`, `network/ip_passthrough.sh:132`.

**Open follow-up: the assertion is not universal yet.** The write sites in `tower/lock.sh`, `frequency/lock.sh`, `bands/lock.sh`, `tower/settings.sh`, `qmanager_tower_schedule` and `qmanager_tower_failover` are `rc`-guarded but carry **no** `OK` assertion. `rc` alone is not quite enough, because `qcmd`'s third exit arm returns **0 with unconfirmed data**: a response that contains neither `OK` nor `ERROR` and is non-empty is passed through for the caller to judge (see [Error codes](#error-codes)), on purpose, since some compound queries answer without a trailing `OK`. A write that lands in that arm reports success it has not been told about.

**Safe by accident: leave alone, but know why they are safe.**

| File | Why it works |
| ---- | ------------ |
| `cellular/fplmn.sh` (2 sites) | Guards with `[ -z "$resp" ]` **before** the `case`. Empty stdout ⇔ failure, so that guard catches every failure and the `*ERROR*` arm is merely unreachable |
| `qmanager_band_failover` (3 sites, `:124`, `:138`, `:152`) | The `case` arms are `*ERROR*\|""`: the **empty-string arm** is what catches every real failure. Correct behaviour reached through the wrong test |

Both are fragile in the same way: delete the emptiness half and the failure detection goes with it, silently, with no gate able to see it. `qmanager_band_failover` is the weaker of the two, because all three of its sites are **writes** (`AT+QNWPREFCFG="lte_band"` and friends) and none of them assert the modem's `OK`, so a `qcmd` third-arm pass-through still logs "LTE bands reset OK".

**Parsers must anchor on the reply prefix.** Line 1 of a successful `qcmd` stdout is the echoed command, so a pattern keyed on a name the command also contains (`/IPPT_NAT/`, `"lte_time_advance"`) reads the echo. Match `+PREFIX:` at column 0 (`index($0,"+QMAP:")==1`), or go through `qcmd_exec` / `run_at`, which drop the echo. A census on 2026-10-12 (RM520N-GL, raw-vs-stripped differential over every raw `qcmd` parse in the poller, CGIs, libs and daemons) found no other live case after `ae2fb928`. Run ledger: `.orchestra/runs/2026-10-12-qcmd-echo-parser-census.md`.

**Already correct.** `cgi_at.sh` (`run_at()`), `qmanager_poller` (`qcmd_exec()`), `scenario_mgr.sh`, `bands/lock.sh`, `bands/current.sh`, `frequency/lock.sh`, `tower/lock.sh` and `tower/settings.sh` all test `[ $rc -ne 0 ] || [ -z "$result" ]` before the `case`. Their `*ERROR*` arms are unreachable belt-and-braces, not bugs — **prefer `run_at()` from `cgi_at.sh` in new CGI code** rather than open-coding the check.

**`qmanager_poller` was deliberately excluded from the sweep**, and both of its issues are recorded here rather than fixed:

- `qcmd_exec`'s `*ERROR*` arm sits behind the correct guard, so it is unreachable; its `return 2` is therefore dead, and so is the `[ $rc -eq 2 ]` branch in `poll_serving_cell` that treats rc 2 as "modem reachable". Harmless today. It was left alone because this is the ~4s hot path that feeds the entire app, and touching it is a change with its own blast radius.
- The `AT+QCAINFO` read seeds carrier-aggregation defaults on a failed read: `ca_active:false`, `count:0`, `carrier_components:[]`. That is the **same fabrication class** the sweep just removed elsewhere, published as fact into `/tmp/qmanager_status.json`. A separate change; see [carrier-aggregation.md](carrier-aggregation.md).

**Not qcmd output at all — leave alone.** `qcmd` itself classifies the raw modem reply (`rm520n_reply()` in `native/qmanager_atd/src/client/qcmd.rs`), which is exactly where `ERROR` legitimately appears. `parse_at.sh`'s `AT+CPIN?` parser classifies raw text handed to it by the poller.

Separately, roughly **26 `qcmd` call sites across 19 files** never capture `$?` at all. Many are the pipe form (`qcmd ... | grep ...`), where an empty result is falsy and the caller happens to handle it; that is luck, not contract.

---

## SMS operations

On the RM520N-GL, SMS list/send/delete go through `qsms` over QMI WMS, not the AT channel: no `flock` on `/run/qmanager_at/at.lock`, no `/dev/smd11`. Contract and error mapping: [`sms.md` > Transport](sms.md#transport-qsms).

- The one AT command left on the SMS path is the CPMS routing write, `qcmd 'AT+CPMS="ME","ME","ME"'` — once per inbox GET and once at boot (`qmanager_sms_storage`, which also uses `qcmd AT` as its readiness probe).
- The forwarding daemon's registration check (`AT+CREG?` / `AT+CGREG?`) also goes through `qcmd`.
- On any model other than RM520N and RG501Q, `qsms` uses its AT backend, which serialises on the same lock and can return `modem_busy`.
- `sms_tool` is retired; see [Retired binaries](#retired-binaries-atcli_smd11-and-sms_tool).

---

## QManager cannot consume AT URCs

**Short version: QManager has no process listening on the AT channel, so it can never receive an unsolicited modem message. Every modem event must be discovered by polling for it.** This is a hard architectural boundary, not a gap waiting to be filled.

A **URC** (Unsolicited Result Code) is the modem spontaneously pushing a line onto the AT channel without being asked — a doorbell rather than a conversation. `AT+QSIMSTAT=1`, `AT+CREG=2`, `AT+QINDCFG` and friends all work this way: you enable them once, and the modem emits a line whenever the underlying state changes.

Catching one requires a process **reading the AT channel between commands**. QManager has none, by design:

- `qcmd`'s in-process path opens `/dev/smd11`, sends one command, reads to its terminator, and closes.
- Where it runs (RM520N-GL, RG501Q-EU), the `qmanager_atd` broker keeps one `/dev/smd11` fd open for its lifetime, but it **never reads outside an exchange**. Before each send it drains whatever is waiting (a late reply or a URC) and logs it rather than returning it; bytes glued after a terminator are kept for that next drain. So a URC is discarded, never delivered.
- Before the broker existed, a live scan of every `/proc/*/fd/*` on the RM520N-GL (poller, ping daemon and lighttpd running) found **zero** processes holding `smd11` open. With the broker running, `qmanager_atd` is the one holder.
- `AT+QURCCFG="urcport"` offers only `usbat`, `usbmodem`, `uart1`, and `all`. **`smd11` is not a selectable URC destination**, so even a hypothetical listener could not be pointed at the channel QManager uses.

### Enabling URCs would be worse than useless

Turning on a URC source (e.g. `AT+QSIMSTAT=1`) does not merely fail to deliver events — it **injects unsolicited lines into unrelated AT responses**. A URC lands wherever the modem happens to be in a read: mid-response, or as the first line of the *next* command's reply.

Most QManager parsers survive that, because they `grep` for their own token and ignore everything else. Two do not:

- **`qcmd`** classifies the *whole* reply: it fails the command if `ERROR` appears anywhere in it. Any unsolicited line containing `ERROR` anywhere in the buffer turns a successful command into a reported failure.
- **`qmanager_poller`** (`read_sim_identity`) picks the IMSI out of a bare-number response with `grep -x '[0-9]\{15\}'` — there is no `+CIMI:` prefix to key on. Any unsolicited bare 15-digit line would be adopted as the device's IMSI.

### The polled alternative

Every URC-shaped source on this modem has a query form. Use it.

| Instead of | Poll |
| ---------- | ---- |
| `AT+QSIMSTAT=1` (SIM insert/remove URC) | `AT+QSIMSTAT?` → `+QSIMSTAT: <enable>,<inserted_status>` |

`AT+QSIMSTAT?` returns the same `<inserted_status>` payload synchronously, and that is how the poller reads it (Tier 2 compound; see [cellular-basic-settings.md](cellular-basic-settings.md)).

> ⚠️ WARNING: If someone proposes an event-driven modem feature — "the modem can just tell us when X happens" — this section is the answer. It requires a resident AT listener, which requires a URC port QManager cannot use, and enabling it without one corrupts unrelated command responses.

---

## PID and cross-user process checks

- `pid_alive()` in `platform.sh` replaces `kill -0` for cross-user PID checks. This is necessary because `www-data` (the CGI user) cannot send signals to root-owned PIDs.
- `cgi_base.sh` sources `platform.sh`, making `pid_alive` available to all CGI scripts automatically.
