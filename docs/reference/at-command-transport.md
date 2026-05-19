# AT Command Transport (RM520N-GL)

> How AT commands are issued on the RM520N-GL: the atcli_smd11 binary, qcmd serialization via flock, and SMS operations via sms_tool.

---

## Platform comparison

| Modem | Transport | Wrapper |
|-------|-----------|---------|
| RM551E | `sms_tool` via USB | `qcmd` |
| RM520N-GL | `atcli_smd11` on `/dev/smd11` (direct access, no socat-at-bridge) | `qcmd` |

---

## atcli_smd11

`atcli_smd11` is a Rust reimplementation from [1alessandro1/atcli_rust](https://github.com/1alessandro1/atcli_rust). It replaces the original Compal C `atcli` binary.

- **Build**: Static ARMv7 build, ~647 KB (non-UPX). Compatible with Quectel RM502, RM520, RM521, and RM551 modems.
- **I/O model**: Opens `/dev/smd11` directly via `OpenOptions` — no PTY bridge or socat services needed.
- **Streaming**: Uses `BufReader::read_line` streaming, which eliminates the 4096-byte buffer overflow bug present in the OEM version.
- **Terminator matching**: Matches the OEM terminator array exactly: `OK\r\n`, `ERROR\r\n`, `+CME ERROR:`, etc.
- **Long commands**: Handles long-running commands natively — `AT+QSCAN` waited 1 minute+ in testing. There is no `_run_long_at()` workaround needed.
- **Exit code**: Always exits 0. Error detection is done by parsing the response text for `OK` or `ERROR` — do not rely on shell `$?`.

### Do NOT UPX-compress atcli_smd11

UPX self-modifying code causes **segmentation faults on exit** for this ARM build. Ship the uncompressed binary (~647 KB) instead.

Note: this is the **opposite** of the Discord bot rule — the Go binary (`qmanager_discord`) is safely UPX-LZMA compressed; the Rust binary is not.

---

## qcmd serialization

`qcmd` is the shell wrapper that serializes all AT command access via `flock` (a POSIX advisory file lock — like a "do not disturb" sign on the lock file; only one process holds it at a time).

- **Lock file**: `/tmp/qmanager_at.lock`
- **flock pattern**: Uses `flock` with a read-only file descriptor (`9<`) for the lock — this handles the kernel's `fs.protected_regular=1` restriction, which would otherwise block root from creating a lock file owned by another user.
- **BusyBox flock limitation**: BusyBox `flock` on this platform lacks the `-w` (timeout) flag. Use `flock -x -n` in a polling loop instead. See `flock_wait()` in `qcmd` and `sms.sh` for the canonical implementation.

---

## SMS operations

SMS send/receive/delete operations use `sms_tool`, a bundled ARM binary (not `atcli_smd11`).

- `sms_tool` handles multi-part message reassembly natively.
- It is wrapped with the **same `flock` on `/tmp/qmanager_at.lock`** as `qcmd`, so AT access is fully serialized across both tools.
- **Suppress stderr** with `2>/dev/null` — `sms_tool` emits harmless `tcsetattr` warnings on smd devices that would otherwise pollute CGI output.

---

## PID and cross-user process checks

- `pid_alive()` in `platform.sh` replaces `kill -0` for cross-user PID checks. This is necessary because `www-data` (the CGI user) cannot send signals to root-owned PIDs.
- `cgi_base.sh` sources `platform.sh`, making `pid_alive` available to all CGI scripts automatically.
