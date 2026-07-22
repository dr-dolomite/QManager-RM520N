# SMS Center (RM520N-GL)

> The SMS inbox: read / send / delete over the modem's AT channel via the bundled `sms_tool`. Merges messages across ME (modem) and SM (SIM) storage, tracks read/unread in the browser, and self-heals CPMS routing so incoming SMS are never stranded on the SIM.

The SMS Center exposes a read/send/delete inbox at `/cellular/sms`. All modem access runs through the bundled `sms_tool` binary, serialized against every other AT consumer (`qcmd`, the poller, the watchdog) by the shared `flock` on `/tmp/qmanager_at.lock`. This doc covers the inbox CGI, the `sms_tool` binary/patch, the CPMS ME+SM storage model, the boot-time routing oneshot, and the browser-side read/unread tracking.

> ℹ️ NOTE: SMS **downtime alerts** (connection-lost/restored notifications sent over SMS) are a separate feature — the SMS channel of the centralized Alerts system, driven by `monitoring/sms_alerts.sh`. This doc covers only the inbox. **SMS Forwarding** (auto-relay of incoming messages to another number) is also separate — see [`sms-forwarding.md`](sms-forwarding.md).

---

## Quick Reference

| Item | Value |
|---|---|
| Route | `/cellular/sms` |
| Inbox CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms.sh` |
| AT channel | `/dev/smd11` (Qualcomm SMD char device, not a UART/TTY) |
| Shared AT lock | `/tmp/qmanager_at.lock` (the same lock `qcmd` holds) |
| Binary | `/usr/bin/sms_tool` (patched, static **armhf**, ~440 KB) |
| Boot routing oneshot | `/usr/bin/qmanager_sms_storage` + `qmanager-sms-storage.service` |
| Read-state hook | `hooks/use-sms-read-state.ts` (browser `localStorage`, key `qmanager.sms.read.v1`) |
| Types | `types/sms.ts` |
| Inbox UI | `components/cellular/sms/sms-inbox-card.tsx` |
| Reboot | Never |

---

## `sms_tool` Binary

The bundled `/usr/bin/sms_tool` is a patched fork of [`obsy/sms_tool`](https://github.com/obsy/sms_tool) (Apache-2.0), statically linked. It is the **same verified binary the RM551E sibling ships** and runs natively on RM520N-GL's Cortex-A7. Full provenance, the patch, and the rebuild recipe are in [`dependencies/README.md`](../../dependencies/README.md) / [`dependencies/NOTICE`](../../dependencies/NOTICE); the diff itself is [`dependencies/sms_tool.patch`](../../dependencies/sms_tool.patch). Summary of the four patches and why:

1. **Default device `/dev/ttyUSB0` → `/dev/smd11`.** Upstream's default does not exist on this modem, so a bare `sms_tool recv` used to segfault. Now bare calls talk to the right device and no CGI caller needs `-d /dev/smd11`.
2. **`isatty()` guard in `setserial()`.** `/dev/smd11` is an SMD char device, not a serial line, so `tcgetattr`/`tcsetattr` return `ENOTTY` ("Inappropriate ioctl for device"). Skipping termios setup on non-TTY devices removes that stderr noise at the source.
3. **`isatty()` guard in `resetserial()`.** Same guard on the exit-time termios restore — no `failed tcsetattr` line on clean exit.
4. **`exit(1)` on open/reopen/fdopen failure.** Upstream fell through to `setvbuf(NULL,…)` and SIGSEGV'd on a missing port; it now exits cleanly. The verbose `open()`/`reopen()` traces are gated behind the existing `-D` debug flag.

> ℹ️ NOTE: This build is **hard-float (armhf)**, ELF `e_flags 0x05000400`. RM520N-GL's Cortex-A7 exposes `vfp vfpv3 vfpv4 neon` in `/proc/cpuinfo`, so the VFP instructions run natively — verified live (identical `recv -j` output, exit 0, no `SIGILL`). The older soft-float bundling was a conservative default, not a hardware requirement.

Because the patched binary defaults to `/dev/smd11` and stays silent on the SMD device, the CGI callers dropped the `-d /dev/smd11` flag and the `2>/dev/null` termios-noise crutch that the previous unpatched binary needed.

### Command surface used by QManager

```sh
sms_tool [-s ME|SM] recv -j        # JSON: {"msg":[...]}
sms_tool send <phone> <msg>        # Send an SMS
sms_tool [-s ME|SM] delete <index> # Delete one message
sms_tool [-s ME|SM] delete all     # Clear all messages in that storage
sms_tool [-s ME|SM] status         # "Storage type: ME, used: 0, total: 255"
sms_tool at '<AT command>'         # Raw AT passthrough (talks to /dev/smd11)
```

---

## Shared AT Lock (`/tmp/qmanager_at.lock`)

Every `sms_tool` call runs inside a `flock -x` on `/tmp/qmanager_at.lock` — the **same** lock `qcmd` and `atcli_smd11` use. (`flock` is a POSIX advisory lock, like a "do not disturb" sign on the lock file: only one holder at a time.) This keeps a `recv -j` fetch from colliding with a poller or watchdog AT call on `/dev/smd11`.

BusyBox `flock` lacks `-w` (timeout), so the wrappers poll with `flock -x -n` in a loop with a 10-second budget — see `flock_wait()` in `sms.sh` (the canonical implementation shared with `qcmd`). The lock is opened read-only on fd 9 (`9<"$LOCK_FILE"`), which works around the kernel's `fs.protected_regular=1` restriction.

The wrapper (`sms_locked` in `sms.sh`) deliberately does **not** use `2>/dev/null` (would hide real errors) or `2>&1` (a merged stream can interleave stray bytes into a `recv -j` payload larger than the stdout block buffer, corrupting the JSON). Instead it captures stderr to a per-call temp file and, on failure, returns the cleaned stderr (the harmless `tcgetattr`/`tcsetattr` noise stripped — a no-op with the patched binary, kept as defense-in-depth). The lock return code `2` maps to the `modem_busy` error response.

---

## SMS Storage Routing (`AT+CPMS`)

`AT+CPMS` controls three storage pointers: mem1 (read/delete source), mem2 (send destination), and mem3 (incoming-message routing). The carrier/modem can route incoming SMS to **SM** (SIM) storage while `sms_tool`'s bare reads default to **ME** (modem) — so new messages land on the SIM and the inbox appears empty. This is the load-bearing bug the parity port fixes.

The fix is three-pronged: assert `AT+CPMS="ME","ME","ME"` at boot (oneshot), re-assert it on every GET (self-heal), and read **both** ME and SM, tagging and merging the results.

### mem1/mem2/mem3 model

| Pointer | Controls | QManager target |
|---|---|---|
| mem1 | Storage read/delete operations | `ME` (255 slots) |
| mem2 | Storage used for sent messages | `ME` |
| mem3 | Storage for incoming SMS routing | `ME` |

**Why `ME` and not `SM`:** the SIM typically has ~40 slots; `ME` provides 255 and is modem-resident (survives SIM swaps). If mem3 stays `SM` and the SIM fills up, the modem silently discards further incoming messages.

### Boot routing oneshot (`qmanager_sms_storage`)

`/usr/bin/qmanager_sms_storage` guarantees correct routing even if the SMS page is never opened. It polls `sms_tool status` under the shared lock until the modem answers (up to ~60 s, acquiring and releasing the lock **per attempt** so a slow-booting modem never starves `qcmd`), asserts `AT+CPMS="ME","ME","ME"`, logs, and exits. It never reboots or calls `AT+CFUN`.

The unit `qmanager-sms-storage.service` is `Type=oneshot`, `RemainAfterExit=yes`, `TimeoutStartSec=90`, ordered `After=qmanager-setup.service qmanager-cfun-fix.service` (so the lock file exists and the radio is confirmed on) and `Before=qmanager-poller.service`. It is **not** in `UCI_GATED_SERVICES`, so the installer enables it unconditionally.

### GET-time self-healing

Any `-s SM` call flips modem mem1 to `SM` as a side effect. The inbox GET sequence therefore re-asserts ME at the end:

1. Assert `AT+CPMS="ME","ME","ME"` (routes future incoming to ME).
2. Read ME: `sms_locked -s ME recv -j` + `-s ME status`.
3. Read SM: `sms_locked -s SM recv -j` + `-s SM status`.
4. **Re-assert** `AT+CPMS="ME","ME","ME"` to counteract the mem1 flip from step 3.
5. Merge and return.

> ℹ️ NOTE: The re-assert matters because the SMS **alerts** channel (`sms_alerts.sh`) issues bare `recv`/`status` with no `-s` flag. If mem1 were left on `SM` after a GET, the alert library would read the SIM until the next GET or reboot.

### Dual-storage merge

Each message from `-s ME recv -j` is tagged `storage:"ME"`; each from `-s SM` is tagged `storage:"SM"`. Multi-part reassembly groups by `sender + reference + storage` (not just `sender + reference`), so ME index 0 and SM index 0 never collapse into one message. Singles carry no `reference` key at all (confirmed against live `sms_tool -j`), so they pass through via `select(has("reference") | not)`. Each output object's `indexes` array lists every storage slot for that message, so one `delete` clears them all.

`storage.used` / `storage.total` in the response are the **sum** of ME and SM — an honest picture when some messages still reside on the SIM.

> ⚠️ WARNING: `sms_tool status` output is word format — `Storage type: ME, used: 0, total: 255` — **not** slash-separated. Parse with `grep -o 'used: [0-9]*'` / `'total: [0-9]*'`. A `[0-9]*/[0-9]*` pattern never matches and reads `0/0`.

### Storage-aware delete

The `delete` POST requires a `storage` field (`"ME"` or `"SM"`, defaulting to `"ME"`, constrained to exactly those two so it can never inject other args into the `sms_tool` call). After any `-s SM` delete, `AT+CPMS="ME","ME","ME"` is re-asserted. `delete_all` clears ME then SM and re-asserts ME routing unconditionally (even on partial failure).

---

## Phone Number Normalization

`sms.sh` normalizes outbound numbers (`send` action) in `normalize_phone()`:

1. Strip a single leading `+` (`sms_tool send` wants no `+` prefix).
2. If the number starts with `0` (local format), read the SIM's MCC via `qcmd 'AT+CIMI'` (first 3 digits of the IMSI), map it to the ITU-T country calling code via an in-script `mcc_to_calling_code()` lookup table, and replace the leading `0`. An unknown MCC or unreadable IMSI logs a warning and sends the number as-is.

This lets a user type a local number (e.g. `0917…`) and have it dialed internationally based on the inserted SIM's country.

---

## Read/Unread State (Client-Side)

The modem **cannot** be the source of truth for per-message read/unread, for two reasons:

1. `sms_tool -j` strips the `REC READ`/`REC UNREAD` field from message objects, so it never reaches the CGI.
2. Every inbox GET issues `AT+CMGL=4`, which the modem treats as "mark all read" — any modem-side unread flag self-erases on each fetch.

Read state is therefore tracked entirely in the browser by `hooks/use-sms-read-state.ts` (exports `useSmsReadState`, `smsFingerprint`, `parseSmsTimestamp`), persisted to `localStorage` under `qmanager.sms.read.v1` as a JSON array of fingerprint strings.

### Fingerprinting

There is no stable backend message ID. The fingerprint is a **djb2** hash of `storage|sender|timestamp|content`, base-36 encoded (unsigned 32-bit). Including `storage` means the same body in ME vs. SM produces distinct fingerprints and can be marked independently.

### Self-pruning

On every write, the stored set is intersected with the fingerprints of the **currently-present** messages before the new entry is added (`markRead`), or replaced outright with the present set (`markAllRead`). So when a message is deleted on the modem, its read-marker is evicted on the next state change — the set cannot grow unbounded.

### Trade-offs

- Read state is **per-browser**; it does not sync across devices, and clearing browser storage resets it.
- New incoming messages appear unread by default (fingerprint absent).
- Opening the View dialog marks the message read immediately.

---

## Timestamp Sorting

> ⚠️ WARNING: `sms_tool` emits timestamps as `"MM/DD/YY HH:MM:SS"` (zero-padded, fixed-width). A plain lexicographic sort mis-orders across month/year boundaries — `"12/31/25 23:59:59"` sorts **after** `"01/01/26 00:00:00"` because `"12" > "01"`. Never sort on the raw timestamp.

The backend reorders the fixed-width slices into a sortable `"YYMMDD HH:MM:SS"` key before reversing for newest-first:

```sh
sort_by(.timestamp[6:8] + .timestamp[0:2] + .timestamp[3:5] + .timestamp[8:]) | reverse
```

The frontend (`parseSmsTimestamp`) parses the same `MM/DD/YY HH:MM:SS` into epoch millis and sorts descending as a client-side safety net, so newest-first ordering holds even if backend ordering is ever disrupted.

---

## Inbox CGI (`cellular/sms.sh`)

### GET

Asserts ME routing, reads ME then SM, re-asserts ME, and returns the merged list plus summed storage. Response envelope:

```json
{
  "success": true,
  "messages": [
    {
      "indexes": [3],
      "sender": "+1234567890",
      "content": "Hello",
      "timestamp": "07/19/26 14:33:11",
      "storage": "ME"
    }
  ],
  "storage": { "used": 4, "total": 295 }
}
```

A lock failure on the primary ME read returns `{ "success": false, "error": "modem_busy", "detail": "..." }`. A lock failure on the SM read degrades gracefully — the ME results are still returned.

### POST actions

| Action | Required fields | Notes |
|---|---|---|
| `send` | `phone`, `message` | Normalizes `phone` (strip `+`, local-number → country code via SIM MCC); on failure returns `{success:false, error:"send_failed", detail:"<stderr>"}` (HTTP 200) |
| `delete` | `indexes` (array), `storage` (`"ME"`\|`"SM"`, default `"ME"`) | Deletes each slot; re-asserts ME after SM deletes; returns `partial_failure` if any slot fails |
| `delete_all` | — | Clears ME then SM; re-asserts ME routing unconditionally |

Error codes: `missing_action`, `missing_phone`, `missing_message`, `missing_indexes`, `invalid_action`, `modem_busy`, `send_failed`, `partial_failure`, `delete_all_failed`.

---

## Inbox UI

`components/cellular/sms/sms-inbox-card.tsx` renders three tabs — **All**, **Unread {count}**, **Read** — plus search, sort, and rows-per-page pagination. Each row shows a **SIM** badge for `storage:"SM"` messages; unread rows carry a primary-color dot and semibold styling. A "Mark all read" action calls `markAllRead`. Bulk delete is storage-grouped (a single selection spanning ME and SM issues one `delete` per storage). The delete hook (`hooks/use-sms.ts`) is storage-scoped.

---

## On-Device Smoke Test

```sh
sms_tool status                      # defaults to smd11, silent, exit 0
sms_tool recv -j                     # no tcgetattr/tcsetattr noise, valid JSON
sms_tool -s SM recv -j               # read SIM storage (flips mem1 to SM)
sms_tool at 'AT+CPMS="ME","ME","ME"' # re-assert modem routing
curl -sS http://127.0.0.1/cgi-bin/quecmanager/cellular/sms.sh   # via lighttpd (as www-data)
```

> ⚠️ Validate the CGI through lighttpd (`curl http://127.0.0.1/...`) or `sudo -u www-data`, never as root — a root shell masks real `www-data` permission bugs.

---

## Related

- [`at-command-transport.md`](at-command-transport.md) — `qcmd`, `atcli_smd11`, the shared `flock` on `/tmp/qmanager_at.lock`.
- [`sms-forwarding.md`](sms-forwarding.md) — the forwarding daemon, the **only** server-side inbox reader in the project.
- [`../../dependencies/README.md`](../../dependencies/README.md) — `sms_tool` provenance, patch, rebuild recipe.
