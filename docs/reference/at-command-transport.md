# AT Command Transport (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

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

## How to detect a qcmd failure

**Short version: `qcmd` reports failure through its exit status and `stderr`. It never puts the word `ERROR` on `stdout`, and it never returns a non-empty `stdout` on failure. Check `$?`. Everything else is guesswork.**

Why it works that way: `qcmd` is a gatekeeper, not a pass-through. It classifies the modem's raw reply itself (`qcmd:174-196`) and then re-emits a *clean* result — payload on `stdout` for the caller to parse, or a diagnostic on `stderr` plus `exit 1`. Keeping the two streams separate is deliberate: a CGI script's `stdout` **is** its HTTP response body, so anything diagnostic that leaks there corrupts the JSON.

### The four outcomes

| Outcome | exit | stdout | stderr |
| ------- | ---- | ------ | ------ |
| Success | 0 | **command echo** + payload + `OK` | — |
| Lock timeout | 1 | *empty* | `ERROR: modem_busy` |
| Modem returned `ERROR` / `+CME ERROR:` | 1 | *empty* | `ERROR: command_failed` |
| Empty modem response | 1 | *empty* | `ERROR: command_failed` |

Lock wait before the timeout fires is **5 s** (`LOCK_WAIT_SHORT`), or **10 s** (`LOCK_WAIT_LONG`) for the long commands `*QSCAN*`, `*QSCANFREQ*`, `*QFOTADL*` (`qcmd:41-42`, `is_long_command()` at `qcmd:104-109`). The wait is a poll loop of one-second `flock -x -n` attempts plus one final try (`flock_wait()`, `qcmd:116-131`), because BusyBox `flock` has no `-w`.

### Two consequences that bite

**1. Empty `stdout` ⇔ failure, unconditionally.** `atcli_smd11` echoes the command line back before the payload, so a *successful* read structurally cannot produce empty output — even a query that matches nothing still returns the echo and `OK`. There is no "succeeded but returned nothing" case to worry about.

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

`qcmd -j "AT+..."` wraps the outcome in JSON on **`stdout`** in both directions (`output_result()`, `qcmd:81-101`):

```json
{"success": true,  "response": "...", "command": "AT+QUIMSLOT?"}
{"success": false, "error": "modem_busy", "command": "AT+QUIMSLOT?"}
```

New callers that already have `jq` in hand should prefer this — one stream, one shape, no `$?` discipline to get wrong. (The exit status is still `1` on the error envelope in non-JSON mode only; in `-j` mode read the `success` field.)

### Read failures must not become fabricated values

The second half of this bug class is on the *read* side. A GET that seeds defaults (`sim_slot="1"`, `mode_pref="AUTO"`, …) and then overwrites them only when a `grep` matches will, on a failed `qcmd`, emit the entire seeded set as if it were the modem's state — with `success: true` on top. This was reproduced live: a modem genuinely on SIM slot 2 reported `"sim_slot": 1` during lock contention.

The rule is **guard the transport result, not the individual fields**:

- If `rc != 0`, return an error envelope and emit **no data object at all**. Absence is the honest signal.
- If `rc == 0` but one line is missing from an otherwise good response, **keep the seeded default**. A missing individual line is usually a legitimate firmware difference; nulling per-field would turn a working page into a permanently broken one on that firmware.

`scripts/www/cgi-bin/quecmanager/cellular/settings.sh` is the reference implementation (see [cellular-basic-settings.md](cellular-basic-settings.md) > *The read contract*).

### ⚠️ This is NOT fixed repo-wide

`cellular/settings.sh` is the **first and only** script migrated. Do not assume the rest of the tree follows this contract — verified as of 2026-08-14:

**Failure genuinely undetected — 20 sites across 7 files.** These match `*ERROR*` against `qcmd` stdout with no `rc` check and no emptiness guard, so a lock timeout or modem rejection is reported as success:

| File | Sites |
| ---- | ----- |
| `scripts/www/cgi-bin/quecmanager/network/ip_passthrough.sh` | 7 |
| `scripts/www/cgi-bin/quecmanager/cellular/mbn.sh` | 4 |
| `scripts/usr/bin/qmanager_tower_schedule` | 4 |
| `scripts/usr/bin/qmanager_tower_failover` | 2 |
| `scripts/www/cgi-bin/quecmanager/cellular/network_priority.sh` | 1 |
| `scripts/www/cgi-bin/quecmanager/cellular/imei.sh` | 1 |
| `scripts/usr/bin/qmanager_imei_check` | 1 |

**Safe by accident — 2 sites.** `scripts/www/cgi-bin/quecmanager/cellular/fplmn.sh` guards with `[ -z "$resp" ]` first. Because empty stdout ⇔ failure, that guard catches every failure; its `*ERROR*` arm is merely unreachable. Fine today, fragile if someone removes the emptiness check.

**Already correct.** `cgi_at.sh` (`run_at()`), `qmanager_poller` (`qcmd_exec()`), `scenario_mgr.sh`, `bands/lock.sh`, `bands/current.sh`, `frequency/lock.sh`, `tower/lock.sh` and `tower/settings.sh` all test `[ $rc -ne 0 ] || [ -z "$result" ]` before the `case`. Their `*ERROR*` arms are unreachable belt-and-braces, not bugs — **prefer `run_at()` from `cgi_at.sh` in new CGI code** rather than open-coding the check.

**Not qcmd output at all — leave alone.** `qcmd` itself (`qcmd:175`) classifies `atcli_smd11`'s raw reply, which is exactly where `ERROR` legitimately appears. `parse_at.sh:337` classifies raw `AT+CPIN?` text handed to it by the poller.

Separately, roughly **26 `qcmd` call sites across 19 files** never capture `$?` at all. Many are the pipe form (`qcmd ... | grep ...`), where an empty result is falsy and the caller happens to handle it; that is luck, not contract.

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
