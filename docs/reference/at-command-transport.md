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

## QManager cannot consume AT URCs

**Short version: QManager has no process listening on the AT channel, so it can never receive an unsolicited modem message. Every modem event must be discovered by polling for it.** This is a hard architectural boundary, not a gap waiting to be filled.

A **URC** (Unsolicited Result Code) is the modem spontaneously pushing a line onto the AT channel without being asked — a doorbell rather than a conversation. `AT+QSIMSTAT=1`, `AT+CREG=2`, `AT+QINDCFG` and friends all work this way: you enable them once, and the modem emits a line whenever the underlying state changes.

Catching one requires a process **sitting on the AT channel with the device held open**. QManager has none, by design:

- `qcmd` opens `/dev/smd11`, sends one command, reads to its terminator, and closes. Between commands, nothing holds the device.
- A live scan of every `/proc/*/fd/*` on the device — with the poller, the ping daemon, and lighttpd all running — found **zero** processes holding `smd11` open.
- `AT+QURCCFG="urcport"` offers only `usbat`, `usbmodem`, `uart1`, and `all`. **`smd11` is not a selectable URC destination**, so even a hypothetical listener could not be pointed at the channel QManager uses.

### Enabling URCs would be worse than useless

Turning on a URC source (e.g. `AT+QSIMSTAT=1`) does not merely fail to deliver events — it **injects unsolicited lines into unrelated AT responses**. A URC lands wherever the modem happens to be in a read: mid-response, or as the first line of the *next* command's reply.

Most QManager parsers survive that, because they `grep` for their own token and ignore everything else. Two do not:

- **`qcmd:175-180`** classifies the *whole* response buffer with `case "$result" in *ERROR*)`. Any unsolicited line containing `ERROR` anywhere in the buffer turns a successful command into a reported failure.
- **`qmanager_poller:1028`** (`read_sim_identity`) picks the IMSI out of a bare-number response with `grep -x '[0-9]\{15\}'` — there is no `+CIMI:` prefix to key on. Any unsolicited bare 15-digit line would be adopted as the device's IMSI.

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
