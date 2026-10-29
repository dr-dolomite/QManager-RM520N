# AT Command Transport (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · qcmd cut-over (T4.1) verified 2026-10-28 on `61368cd2`
> **RG501Q-EU (SDX55):** same Rust `qcmd`, but no broker runs, so every call is in-process — **not yet verified on RG501Q-EU hardware** with the current binary (a read-only scan on 2026-10-28 used an older build) · see [`platform-matrix.md`](./platform-matrix.md#at-transport)

> Every AT command QManager sends goes through `qcmd`, which on every model is a symlink to the Rust `qmanager_atd` binary. On the RM520N-GL it is a client of the `qmanager_atd` broker, with an in-process fallback when the broker is down; on the RG501Q-EU (no broker) it always runs the exchange in-process on `/dev/smd11`. Both paths serialise on one `flock` and keep the same error contract, which is what every caller in the tree is written against. SMS no longer uses this path (see SMS operations).

### Quick reference

| Item | Value |
| ---- | ----- |
| `/usr/bin/qcmd` | Symlink to `qmanager_atd` on every model (made by `install_backend()`) |
| Broker unit | `qmanager-atd.service` (RM520N-GL only, boot-linked, started after `qmanager-setup`) |
| Broker socket | `/var/run/qmanager_atd.sock` |
| AT lock | `/tmp/qmanager_at.lock` (0666) |
| Long-command flag | `/tmp/qmanager_long_running` (exists while a long command runs) |
| Extra long-command patterns | `/etc/qmanager/long_commands.list` (seeded by `qmanager_setup`) |
| Log | `/tmp/qmanager.log` (component `qcmd`) |
| Failure signal | exit 1, empty stdout, stderr `ERROR: modem_busy` or `ERROR: command_failed` |

---

## Platform comparison

| Modem | Transport | Wrapper |
|-------|-----------|---------|
| RM551E | `sms_tool` via USB | `qcmd` |
| RM520N-GL | `qmanager_atd` broker on `/dev/smd11`; in-process exchange on `/dev/smd11` when the broker is unreachable | `qcmd` (link to `qmanager_atd`) |
| RG501Q-EU | In-process exchange on `/dev/smd11` (no broker) — unverified on hardware | `qcmd` (link to `qmanager_atd`) |

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

All AT access is serialised by an exclusive `flock` (a POSIX advisory file lock; one holder at a time) on **`/tmp/qmanager_at.lock`**. The broker, `qcmd`'s in-process path, `qsms`'s AT backend and any shell caller that takes the lock itself all take the same lock, so they exclude each other.

### `qcmd` is the broker client

On every model `install_backend()` makes `/usr/bin/qcmd` a symlink to `qmanager_atd`. The binary picks its role from `argv[0]`: called as `qcmd`, it is the client. The link is replaced atomically (`ln -sf` to a temp name, then `mv -f`), so a caller never finds `qcmd` missing mid-install.

Only the broker daemon is per model: `qmanager-atd.service` exists on the RM520N-GL (gate `qm_hw_atd_enabled`). On the RG501Q-EU, or an unknown model, there is no socket, so every call takes step 4 below.

Each call runs in this order:

1. **Refuse non-AT input.** A command that does not start with `AT` (any case) or contains a control character answers `command_failed` at once and touches nothing. The broker checks again, because its socket is the trust boundary.
2. **Long-flag gate.** If `/tmp/qmanager_long_running` exists and the command is not long, answer `modem_busy` at once.
3. **Try the broker** on `/var/run/qmanager_atd.sock`. The broker takes the lock, runs the exchange on the `/dev/smd11` fd it keeps open, and returns the raw reply.
4. **Fall back in-process** only if the broker is unreachable: no socket, a stale socket, connect refused, or `/var/run/qmanager_atd.proto` missing or naming another protocol version (an old broker mid-OTA). The client then opens `/dev/smd11` itself under the same lock.
5. **Judge the reply** with the contract below (the same on every model) and print it.

A request that reached the broker is **never re-run in-process**. If the broker accepts the request and then dies, times out or sends a reply the client cannot decode (an older protocol), the caller gets `command_failed`, not a second send. Re-running a write such as `AT+COPS=2` after a lost reply could apply it twice.

If the lock file does not exist yet (early boot, or an install run with `--no-start` before `qmanager_setup` ran), the fallback creates it with mode 0666, as the shell did.

| Budget | Value | Applies to |
| ------ | ----- | ---------- |
| Lock wait, short | 5 s | every command not listed below |
| Lock wait, long | 10 s | long commands |
| Exchange deadline, short | 20 s | everything else |
| Exchange deadline, slow | 60 s | `COPS=?`, `CFUN=`, `QMBNCFG`, `CGATT=`, `QPRTPARA` |
| Exchange deadline, long | 300 s | long commands |

**Long commands** are a case-sensitive substring match on `QSCAN`, `QSCANFREQ`, `QFOTADL`, `COPS=2`, `COPS=0`, plus any non-comment line of `/etc/qmanager/long_commands.list`. A long command writes `/tmp/qmanager_long_running` for its duration, sends a warm-up `AT` first, and is never cut short by a caller cap.

The broker unit `qmanager-atd.service` is boot-linked on the RM520N-GL. `start_services()` runs `systemctl reset-failed qmanager-atd` and starts it after `qmanager-setup` (which creates the lock file) and before the poller. It is in the install verify list, and the install-time AT probe runs through `qcmd`, because the broker may hold `/dev/smd11`.

> ℹ️ NOTE: A stopped broker does not stop AT traffic: every call falls back in-process. That is why `qmanager_health_check` reports `svc.atd` as **fail** when the unit is `failed` or `inactive` on the RM520N-GL: nothing else would show it. Other states warn; other models skip.

### Shell callers that take the lock themselves

- **flock pattern**: open the lock with a read-only file descriptor (`9<`). This handles the kernel's `fs.protected_regular=1` restriction, which would otherwise block root from creating a lock file owned by another user.
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

- **Long-flag gate.** While `/tmp/qmanager_long_running` exists, a short command answers `modem_busy` at once instead of waiting 5 s for the lock.
- **Non-AT input is refused.** The shell sent it to `atcli_smd11`, which never returned and held the AT lock until killed (reproduced 2026-10-28 with `qcmd hello`).
- **A wait cap exists.** `qcmd -t MS` or `QCMD_WAIT_MS=MS` (50–60000) caps a short command's wait. No RM520N caller uses it.
- **`COPS=2` and `COPS=0` are long commands.** They get the 10 s lock budget and set the long flag, so short commands answer `modem_busy` while an attach cycle runs.
- **The client creates the lock file** (0666) when `qmanager_setup` has not yet.

Parity was measured on the RM520N-GL on 2026-10-28: 14 cases byte-identical in exit code, stdout and stderr between the shell and Rust `qcmd`, as root and as `www-data`, with the broker down and up. A held lock gave the same `modem_busy` after the same 5 s wait; `AT+QSCAN` had the same shape; the `AT+COPS=2` / `AT+COPS=0` attach cycle returned exit 0 with echo and `OK`.

> ℹ️ NOTE: Moving the lock into a `root:www-data` 0770 directory is split out to task T4.3 and not done. The lock is still the world-writable `/tmp/qmanager_at.lock`.

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

On the RM520N-GL, SMS list/send/delete go through `qsms` over QMI WMS, not the AT channel: no `flock` on `/tmp/qmanager_at.lock`, no `/dev/smd11`. Contract and error mapping: [`sms.md` > Transport](sms.md#transport-qsms).

- The one AT command left on the SMS path is the CPMS routing write, `qcmd 'AT+CPMS="ME","ME","ME"'` — once per inbox GET and once at boot (`qmanager_sms_storage`, which also uses `qcmd AT` as its readiness probe).
- The forwarding daemon's registration check (`AT+CREG?` / `AT+CGREG?`) also goes through `qcmd`.
- On a non-RM520N model `qsms` uses its AT backend, which serialises on the same lock and can return `modem_busy`.
- `sms_tool` is retired; see [Retired binaries](#retired-binaries-atcli_smd11-and-sms_tool).

---

## QManager cannot consume AT URCs

**Short version: QManager has no process listening on the AT channel, so it can never receive an unsolicited modem message. Every modem event must be discovered by polling for it.** This is a hard architectural boundary, not a gap waiting to be filled.

A **URC** (Unsolicited Result Code) is the modem spontaneously pushing a line onto the AT channel without being asked — a doorbell rather than a conversation. `AT+QSIMSTAT=1`, `AT+CREG=2`, `AT+QINDCFG` and friends all work this way: you enable them once, and the modem emits a line whenever the underlying state changes.

Catching one requires a process **reading the AT channel between commands**. QManager has none, by design:

- `qcmd`'s in-process path opens `/dev/smd11`, sends one command, reads to its terminator, and closes.
- On the RM520N-GL the `qmanager_atd` broker keeps one `/dev/smd11` fd open for its lifetime, but it **never reads outside an exchange**. Before each send it drains whatever is waiting (a late reply or a URC) and logs it rather than returning it; bytes glued after a terminator are kept for that next drain. So a URC is discarded, never delivered.
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
