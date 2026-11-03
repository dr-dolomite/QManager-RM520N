# SMS Center (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · conversation UI ported 2026-11, not yet visually verified · `qsms` transport verified 2026-10-28 on serial 61368cd2
> **RG501Q-EU (SDX55):** `qsms` uses QMI WMS there too since `qmanager_atd` 0.7.1 (T8.1). `status` and `list` verified read-only 2026-10-29 on serial b7e3d6f1; send, delete and tag writes not run there. ME holds 127 messages, not 255 — see [`platform-matrix.md`](./platform-matrix.md#at-transport)

> The SMS inbox: read / send / delete through `qsms`, which talks QMI WMS directly and takes no AT lock. Merges messages across ME (modem) and SM (SIM) storage, tracks read/unread in the browser, keeps CPMS routing on the saved storage choice (ME unless the user picked SM), logs sent messages, and reads/writes the SMS centre number.

The SMS Center at `/cellular/sms` shows messages as conversations (received messages plus QManager's own sent log), with send, forward, delete and the SMS settings. Every SMS operation runs through `/usr/bin/qsms`, a link to the `qmanager_atd` multicall binary. On an RM520N or RG501Q it speaks QMI WMS (the modem's Wireless Messaging Service) over a QRTR socket, so it never touches `/dev/smd11` or `/run/qmanager_at/at.lock`. This doc covers the inbox CGI, the `qsms` contract and its error mapping, the CPMS ME+SM storage model, the boot-time routing oneshot, the browser-side read/unread tracking, and the conversation UI with its sender names and logos.

> ℹ️ NOTE: SMS **downtime alerts** (connection-lost/restored notifications sent over SMS) are a separate feature — the SMS channel of the centralized Alerts system, driven by `sms_alerts.sh`. This doc covers only the inbox. **SMS Forwarding** (auto-relay of incoming messages to another number) is also separate — see [`sms-forwarding.md`](sms-forwarding.md).

---

## Quick Reference

| Item | Value |
|---|---|
| Route | `/cellular/sms` |
| Inbox CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms.sh` |
| SMS client | `/usr/bin/qsms` → `qmanager_atd` (relative symlink, laid down by `install_bundled_binaries()`) |
| Backend | QMI WMS when `Project Name:` in `/etc/quectel-project-version` starts with `RM520N`; AT otherwise. `QSMS_BACKEND=wms\|at` overrides |
| Resume a multi-part send | `qsms send --ref <concat_ref> --from <sent_parts+1> <number> <text>` — only when `ambiguous` is `false` (see [Resuming](#resuming-a-multi-part-send---ref----from)) |
| AT use per GET | Two `qcmd` calls: the CPMS heal with the saved choice, and `AT+CSCA?` for the SMSC (a failed SMSC read gives `smsc:null`) |
| Storage choice | `GET/POST /cgi-bin/quecmanager/cellular/sms_storage.sh`; saved in `/etc/qmanager/sms_storage` (`ME` or `SM`; missing = `ME`) |
| Sent log | `/etc/qmanager/sms_sent.json` via `usr/lib/qmanager/sms_sent.sh` (newest 300, lock `/tmp/qmanager_sms_sent.lock`) |
| Boot routing oneshot | `/usr/bin/qmanager_sms_storage` + `qmanager-sms-storage.service` |
| Read-state hook | `hooks/use-sms-read-state.ts` (browser `localStorage`, key `qmanager.sms.read.v1`) |
| Data hook | `hooks/use-sms.ts` (`useSms` — no polling, single-flight, see [The GET is not free](#the-get-is-not-free)) |
| Storage-choice hook | `hooks/use-sms-storage.ts` (`useSmsStorage`, mounted only inside the settings dialog) |
| Types | `types/sms.ts` |
| UI | `components/cellular/sms/` — see [SMS Center UI](#sms-center-ui) for the file split |
| Open thread | `/cellular/sms/?thread=<encodeURIComponent(addr)>` |
| Sender logos | `lib/sms-logos.ts` (curated name → domain) → `components/ui/brand-mark.tsx` → `lib/logo-store.ts` (browser fetch, `localStorage` key `qm_logos_v2`) |
| Reboot | Never |

---

## Transport: `qsms`

`qsms` is `argv[0]` of the `qmanager_atd` binary (source: `native/qmanager_atd/src/client/qsms.rs`, `src/sms/wms.rs`, `src/sms/pdu.rs`). It prints exactly one JSON envelope on stdout and exits 0 on success, 1 on failure (`watch` has its own exit codes, below). Callers decide success from the envelope's `.success` or the exit code, never from stderr.

### Backend selection

The backend is fixed per model, never auto-detected:

| Model | Backend | Why |
|---|---|---|
| RM520N-GL or RG501Q-EU (`Project Name:` starts with `RM520N` or `RG501Q`) | QMI WMS, in process over `AF_QIPCRTR` | No AT lock, no `/dev/smd11`, and a list never marks messages read |
| Anything else, or the file is unreadable | AT (`AT+CMGL` etc. under `/run/qmanager_at/at.lock`) | WMS is unproven on any other model |

`QSMS_BACKEND=wms` or `QSMS_BACKEND=at` in the environment overrides the file. The match reads the `Project Name:` line, not the start of the file: the file begins with `Project Name: …` on both models, so a prefix test on the whole file matches nothing.

> ⚠️ WARNING: Do not add an AT fallback to the WMS path. A WMS lookup that times out at boot or during a modem subsystem restart looks the same as "WMS absent", and the AT path marks every listed message read. A missing WMS service is retried for up to 10 s (list, status, delete) or 60 s per part (send), then reported as `sms_unavailable` / `send_failed`.

### Commands

```sh
qsms list [ME|SM|all]          # default ME
qsms status [ME|SM|all]        # default all
qsms send [--ref R --from N] <number> <text>   # number without '+'; the flags resume a multi-part send
qsms delete <ME|SM> <i,j,..|all>
qsms tag <ME|SM> <i,j,..> read|unread   # WMS only; not used by QManager
qsms watch                     # WMS only; used by the forwarding daemon
```

`www-data` can open the QRTR socket, so the CGI runs `qsms` directly with no sudo.

### Output contract

| Command | Success | Failure |
|---|---|---|
| `list all` | `{"success":true,"msg":[...],"skipped":0}`, plus `"storage_errors":{"SM":"storage unavailable"}` when one storage failed | `{"success":false,"error":"command_failed","detail":"No reply from the modem."}` |
| `status all` | `{"success":true,"storages":[{"storage":"ME","used":153,"total":255},{"storage":"SM","used":31,"total":35}]}` | as above |
| `status ME` (one storage) | `{"success":true,"storage":"ME","used":153,"total":255}` (flat, no array) | as above |
| `send` | `{"success":true,"parts":2,"concat_ref":77,"refs":[41,42]}` (`concat_ref` is `null` for a single part) | `{"success":false,"error":"send_failed","detail":"…","parts":3,"sent_parts":1,"concat_ref":77,"ambiguous":false,"refs":[41]}` |
| `delete ME 3,4` | `{"success":true,"storage":"ME","deleted":[3,4],"failed":[]}` | `"success":false,"error":"delete_failed"`, with `"failed":[{"index":4,"error":"no such message"}]` |
| `delete SM all` | `{"success":true,"storage":"SM","deleted":31,"remaining":0}` | `"success":false,"error":"delete_failed"`, `"remaining":N` |
| `watch` | prints `ready`, then one `<ME\|SM> <index>` line per new message; prints `ready` again after every reconnect | exits **2** when it can never work on this modem (AT backend: `unsupported` envelope; WMS: QRTR unavailable); exits 0 when its stdout closes; any other exit is transient |

Each `msg` entry:

```json
{ "index": 148, "storage": "ME", "stat": 0, "sender": "GLOBE",
  "timestamp": "10/28/26 02:41:07", "reference": 92, "part": 1, "total": 2,
  "encoding": "gsm7", "content": "…" }
```

- `reference` / `part` / `total` appear only on a concatenated part. A single message has no `reference` key.
- `reference` is the full 16-bit concat reference. `sms_tool` truncated it to its low byte (18028 → 108); the merged view does not change because grouping also keys on sender and storage (parity run 2026-10-27: 134 = 134 merged messages, 0 fingerprint differences).
- `stat` uses the AT numbering: `0` unread, `1` read, `2` stored unsent, `3` stored sent. The CGI does not pass it on.
- A PDU that cannot be decoded is listed with `"error":"error decoding pdu"` and empty `sender`/`timestamp`/`content`. A non-DELIVER PDU (for example a stored outgoing message) is left out and counted in `skipped`.
- An empty storage is success with an empty `msg` array, not an error.

### Error and detail mapping

`detail` is shown raw in the UI (inbox banner, forwarding failure list, test-send toast), so every WMS outcome maps to one plain English sentence. QMI error codes go to `/tmp/qmanager.log` (tag `qsms`) only.

| WMS outcome | `error` | `detail` |
|---|---|---|
| Send refused with an RP cause (result 0x0036 + TLV 0x12) | `send_failed` | `The network rejected the message (cause N).` |
| Send refused, no RP cause | `send_failed` | `The modem refused the message.` |
| No reply to a send within 60 s | `send_failed` | `No reply from the modem.` |
| WMS not reachable before the deadline | `send_failed` (send), `sms_unavailable` (other ops) | `SMS service is not ready yet. Try again in a minute.` |
| Other QMI error on list/status/delete | `command_failed` / `delete_failed` | `The modem refused the request.` |
| No reply on list/status/delete | `command_failed` / `delete_failed` | `No reply from the modem.` |
| Number fails the encoder | `bad_number` | none |
| Text needs too many parts | `message_too_long` | none |
| Bad arguments | `bad_args` | parser text, e.g. `bad index 'x'` |

On a multi-part send, the first failed part stops the send and `detail` is prefixed `Part 2 of 3: `. A plain retry resends every part from part 1, so a caller resumes instead (since `qmanager_atd` 0.7.3). Measured on the RM520N-GL with no SIM credit: `The network rejected the message (cause 21).`

**Shell callers extract `.detail`; they never store or return the envelope.** Each caller has a fixed sentence for empty or non-JSON output (`qsms` missing or crashed):

| Caller | Extraction | Fallback |
|---|---|---|
| `sms.sh` `qsms_detail()` | `.detail`, else a sentence per code (`bad_number` → `That phone number is not valid.`, `message_too_long` → `The message is too long to send.`) | `The modem did not answer.` |
| `sms_forwarding.sh` `send_test` | `.detail // .error` | `No reply from the SMS service.` |
| `sms_alerts.sh` `_sa_send_error()` | `.detail // .error` | `No reply from the SMS service.` |
| `qmanager_sms_forward` `sf_send_with_retry()` | `.detail` when it is a string | `The message could not be sent.` |

### Resuming a multi-part send: `--ref` / `--from`

`qsms send --ref R --from N <number> <text>` re-encodes the same text with UDH reference `R` and sends only parts `N` to the end. The same text with the same reference encodes to byte-identical PDUs, so the resumed parts should join the parts already delivered on the recipient's phone. This joining has not been tested on a real phone yet; the crate tests compare the PDUs.

| Rule | Value |
| ---- | ----- |
| `--ref` | decimal `0`–`255`, required whenever `--from` is given |
| `--from` | decimal, `1` ≤ N ≤ the message's part count |
| Flag position | before `<number>`, either order, each at most once; anything after the number is the text |
| Bad flag, missing `--ref`, duplicate, unknown option | `{"success":false,"error":"bad_args","detail":"<parser text>"}`, nothing sent |
| `--from` past the last part | `bad_args`, detail `--from is beyond the last part`, the modem is never opened |

Send envelope fields. Success carries `parts`, `concat_ref`, `refs`; a send failure adds `error`, `sent_parts` and `ambiguous` (plus `detail`, `parts` and `refs`, except when the `qsms` client itself reports the failure, e.g. a lost broker reply: `{"success":false,"error":"command_failed","sent_parts":0,"concat_ref":null,"ambiguous":true}`). An argument or encoder error (`bad_args`, `bad_number`, `message_too_long`) is a plain error envelope without them.

| Field | Meaning |
| ----- | ------- |
| `concat_ref` | The UDH reference used (`null` for a single part). Pass it back as `--ref`. |
| `sent_parts` | **Absolute**: parts before `--from` count as sent. A `--from 2` run that fails on its second part reports `2`. |
| `refs` | Network message references from **this run only**. |
| `ambiguous` | Failure only. `true` = the failing part may have reached the network; `false` = a definite rejection. |

`ambiguous` is `false` when nothing can have left: the session never opened (`modem_busy`, `scan_in_progress`), `AT+CMGF=0` failed, a `+CMS ERROR` / `ERROR` with no `+CMGS:`, a QMI result error, WMS not reachable, or a WMS request that never left the socket. It is `true` on a timeout or a lost reply after the PDU was written: AT transport error during `AT+CMGS`, an empty reply, `ERROR` after a `+CMGS:`, an `OK` with no `+CMGS:` reference, a WMS no-reply or lost server, or a WMS reply with no result TLV.

**The resume rule callers follow:** resume once, with `--ref <concat_ref> --from <sent_parts + 1>`, only when `sent_parts > 0`, `ambiguous` is `false` and `concat_ref` is a number. Otherwise stop. With `sent_parts` 0 a full retry is safe and allowed, except when `ambiguous` is `true` (part 1 may have been delivered): then stop. An envelope from a pre-0.7.3 binary has no `ambiguous`, which the callers read as `null`, so they never resume on it. `sms_alerts.sh` (`_sa_do_send`) and `qmanager_sms_forward` (`sf_send_with_retry`) implement this; the inbox CGI (`sms.sh`) passes `concat_ref`, `refs` and `ambiguous` through and does not resume.

### No AT lock

The WMS backend takes no lock and never opens `/dev/smd11`. The CGI's own lock wrapper (`sms_locked`, `flock_wait`, the `SMS_LOCK_TIMEOUT_RC=99` sentinel) is gone, and so is `modem_busy` from the inbox on an RM520N or RG501Q. The only AT call left on the SMS path is the CPMS self-heal, which goes through `qcmd` and takes the lock for that one command.

On the AT backend (any model other than RM520N and RG501Q), `qsms` still serialises on `/run/qmanager_at/at.lock` and can still return `modem_busy` or `scan_in_progress`; the scan gate applies to that backend only.

### `sms_tool` is retired

`sms_tool` no longer ships (T5.1 S6); `qsms` handles every SMS operation on both models. On a device upgraded from an older release the installer's `retire_legacy_at_binaries()` deletes `/usr/bin/sms_tool` only after `qsms status` answers, and an OTA rollback reinstalls it from the older tarball. See [`at-command-transport.md` > Retired binaries](at-command-transport.md#retired-binaries-atcli_smd11-and-sms_tool).

The `settings.sms_tool_device` key is a different thing: an informational field still on the System Settings wire ([`system-settings.md`](system-settings.md)).

---

## SMS Storage Routing (`AT+CPMS`)

`AT+CPMS` controls three storage pointers: mem1 (read/delete), mem2 (sent messages) and mem3 (where incoming SMS are stored). If mem3 points at **SM** (SIM), new messages land in the SIM's 35 slots, and once those fill the modem silently discards further incoming messages.

**mem3 is also the WMS route.** On the RM520N-GL, `AT+CPMS` mem3 and WMS Get Routes (0x0033) are the same setting: `AT+CPMS="ME","ME","SM"` moved classes 0/1/3/none from NV to UIM in the 0x0033 reply, and restoring ME moved them back byte-identically (probe 2026-10-28). So `qsms` reading over WMS does not make the CPMS write obsolete; it still decides where new messages go.

QManager applies the saved storage choice (ME by default) in three places: a boot oneshot, one self-heal per inbox GET, and the `sms_storage.sh` POST. `qsms` speaks QMI WMS and never moves CPMS, so these are the only appliers. The inbox reads **both** ME and SM and merges them, whatever the choice.

### mem1/mem2/mem3 model

| Pointer | Controls | QManager target |
|---|---|---|
| mem1 | Storage read/delete operations (AT only) | `ME` (255 slots) |
| mem2 | Storage used for sent messages | `ME` |
| mem3 | Storage for incoming SMS (and the WMS route) | `ME` |

**Why `ME` is the default:** the RM520N-GL reports **ME 255 slots** and **SM 35 slots** (`qsms status all`), and `ME` is modem-resident so it survives SIM swaps.

WMS addresses a storage explicitly in each request (NV = ME, UIM = SM), so reading or deleting SM no longer moves mem1. The old ritual of re-asserting CPMS after every SM read or delete is gone.

### Boot routing oneshot (`qmanager_sms_storage`)

`/usr/bin/qmanager_sms_storage` sets routing even if the SMS page is never opened. It runs `qcmd AT` until the modem answers (20 tries, 3 s apart, ~60 s; `qcmd` takes the AT lock per call, so a slow-booting modem never starves other AT users), then runs `AT+CPMS="X","X","X"` through `qcmd` (X = the saved choice; an SM choice falls back to ME for that boot when `qsms status SM` fails, the saved file is left alone), logs, and exits 0 on success or 1 on failure. It never reboots or calls `AT+CFUN`.

The unit `qmanager-sms-storage.service` is `Type=oneshot`, `RemainAfterExit=yes`, `TimeoutStartSec=90`, ordered `After=qmanager-setup.service qmanager-cfun-fix.service` (so the lock file exists and the radio is confirmed on) and `Before=qmanager-poller.service`. It is **not** in `UCI_GATED_SERVICES`, so the installer enables it unconditionally.

### GET-time self-heal

Each inbox GET runs, in order:

1. `qcmd 'AT+CPMS="X","X","X"'` with X the saved choice (`heal_routing()`), output discarded. A failed heal does not fail the GET.
2. `qsms list all` — both storages in one call.
3. Merge, then `qsms status all`.

Keep the heal until a WMS route write replaces it: 0x0033 is not independent of mem3, so dropping it would let a carrier or a third-party tool leave routing on SM unnoticed.

### Dual-storage merge

`qsms list all` tags every message with `storage`. Multi-part reassembly groups by `storage + sender + reference + total`, so ME index 0 and SM index 0 never collapse into one message. A reference is one byte per send and gets reused, so inside a group the parts are sorted by time and a new message starts when a part is more than 24 h after the previous one or its part number is already present with different text (the forwarder uses the same 24 h window). On both live devices this left every real inbox byte-identical (2026-10-31), so read marks survived. Singles carry no `reference` key, so they pass through via `select(has("reference") | not)`. Parts are ordered by `part`, and a part stored twice contributes its text once (`unique_by(.part)`) while `indexes` keeps every slot, so one `delete` still removes both copies.

`storage.used` / `storage.total` in the response are the **sum** of ME and SM, and the response *also* carries a per-memory breakdown under `storage.me` / `storage.sm` — see [Per-memory storage breakdown](#per-memory-storage-breakdown) for why the sum alone was not enough. If `qsms status all` fails, both storages read `0/0`.

### Per-memory storage breakdown

The GET response's `storage` object carries the summed keys **plus** a per-memory split:

```json
"storage": {
  "used": 64,
  "total": 290,
  "me": { "used": 64, "total": 255 },
  "sm": { "used": 0,  "total": 35 }
}
```

**Why the sum alone was insufficient.** `290` is the arithmetic sum of two capacities in *physically different memories*, and a message cannot spill from one store into the other — the modem does not overflow ME into SM when ME fills. So 290 is not a capacity, and a single meter built on it implies headroom that does not exist in whichever store is actually filling up. On the live device the honest reading is "ME is 25% full, SM is empty", which the combined `64 / 290` (22%) actively obscures.

`SmsStorage` in `types/sms.ts` declares `me?` and `sm?` as **optional**, deliberately. A device that has not taken the OTA update runs an old CGI and returns only the sum, so the UI is required to degrade to a single combined meter. A required field would make the type assert something the wire cannot guarantee.

> ℹ️ NOTE: `components/cellular/sms/sms-storage-meter.tsx` requires **both** halves to be present before drawing two meters (`const hasSplit = !!me && !!sm`) — half a breakdown is not a breakdown. In the degraded path it draws one combined row whose caption (`sms.center.storage.combined_caption`) keeps 290 from reading as a capacity.

### Saved storage choice (`sms_storage.sh`)

| Verb | Contract |
|---|---|
| `GET` | `{"success":true,"storage":"ME","routing":"ME","storages":[{"storage":"ME","used":153,"total":255},{"storage":"SM","used":31,"total":35}]}`. `storage` is the saved choice, `routing` the live CPMS mem3 (`""` when the read failed). When the combined `qsms status all` fails, each storage is read alone; one that fails is left out of `storages` and named in `"storage_errors":{"SM":"..."}` |
| `POST {"storage":"ME"\|"SM"}` | Saves the file (temp + rename), applies CPMS, reads mem3 back. Success `{"success":true,"storage":"SM"}`. Errors: `invalid_storage`, `sim_storage_unavailable` (SM chosen and `qsms status SM` fails), `sms_unavailable` (WMS not ready), `save_failed`, `apply_failed` (the previous choice is written back and re-applied) |

Changing the choice moves no existing message. With SM chosen, new messages land in the SIM's 35 slots and are silently dropped once those fill, so the UI should say so. The forwarder lists whichever storage a `qsms watch` indication names, so it still sees SM arrivals; its 300 s safety list reads ME only, so an SM message whose indication was lost while the watch was up waits for the next `ready` full list.

### The GET is not free

`hooks/use-sms.ts` still does not poll. An inbox GET costs:

| Cost | Detail |
|---|---|
| `AT+CPMS` writes | **1 per call** (the heal), through `qcmd` |
| `/run/qmanager_at/at.lock` acquisitions | **1 per call** (the heal); `qsms` takes none |
| WMS time | ME ~80–100 ms for ~150 messages; SM ~1.6 s for 31 messages (~50 ms per read, SIM I/O) |
| Response body | ~13 KB measured on the live device with 64 slots occupied |

The remaining cost is SIM I/O on every SM read, so an inbox poll would keep the SIM busy for ~1.6 s per cycle, plus one AT lock hold per heal. The UI refreshes only on mount and on explicit user action (the Refresh button, and after a send/delete).

`GET ?addr=` (opening a thread) is not cheaper: it runs the same `qsms list all` and filters afterwards. It skips the heal, `qsms status` and the SMSC read.

### Storage-aware delete

The `delete` POST requires a `storage` field (`"ME"` or `"SM"`, defaulting to `"ME"`, constrained to exactly those two). Only non-negative integers from `indexes` reach `qsms`, joined into one `qsms delete <storage> i,j,…` call; anything else counts as a failed slot. `delete_all` runs `qsms delete ME all` then `qsms delete SM all`. No CPMS write follows either action.

---

## Phone Number Normalization

`sms.sh` normalizes outbound numbers (`send` action) in `normalize_phone()`:

1. Drop spaces, dashes, dots and brackets, then a single leading `+` (`qsms send` takes the number without it).
2. If the number starts with `0` (local format), read the SIM's MCC via `qcmd 'AT+CIMI'` (first 3 digits of the IMSI), map it to the ITU-T country calling code via an in-script `mcc_to_calling_code()` lookup table, and replace the leading `0`. An unknown MCC or unreadable IMSI logs a warning and sends the number as-is.

This lets a user type a local number (e.g. `0917…`) and have it dialed internationally based on the inserted SIM's country.

---

## Read/Unread State (Client-Side)

The modem is not the source of truth for per-message read/unread in the UI:

1. `qsms list` reports each message's `stat`, but the CGI's merge drops it, so it never reaches the browser.
2. A WMS list never changes a message's read tag, so on the RM520N-GL a page load no longer clears the modem's unread flags. Under `sms_tool` (and still on the AT backend) every list ran `AT+CMGL=4`, which marks every listed message read.

Showing the modem's unread state in the inbox is possible now but not built. Read state is therefore tracked entirely in the browser by `hooks/use-sms-read-state.ts` (exports `useSmsReadState`, `smsFingerprint`), persisted to `localStorage` under `qmanager.sms.read.v1` as a JSON array of fingerprint strings. `useSms` stamps `unread: 1` on each inbound message whose fingerprint is absent and rolls the counts onto `threads[].unreadCount`; Mark as read / Mark as unread never POST.

### Fingerprinting

There is no stable backend message ID. The fingerprint is a **djb2** hash of `storage|sender|timestamp|content`, base-36 encoded (unsigned 32-bit). Including `storage` means the same body in ME vs. SM produces distinct fingerprints and can be marked independently.

> ⚠️ WARNING: the key and the fingerprint inputs were kept unchanged through the 2026-11 conversation-view port so existing read marks survive. Changing either marks every message unread again.

### Self-pruning

The hook receives only **inbound** messages. The set is saved as-is; it is pruned to the fingerprints of the messages currently present only when the user marks something (`markManyRead`, `markAllRead`), so a message deleted on the modem loses its marker then and the set cannot grow unbounded. No pruning while the list has not loaded (an empty `present`) or while the GET reports `storage_errors` (`canPrune` false), so a store that failed to read keeps its marks.

### Trade-offs

- Read state is **per-browser**; it does not sync across devices, and clearing browser storage resets it.
- New incoming messages appear unread by default (fingerprint absent).
- Opening a thread marks every received message in it read (`fetchThread`). A new message that arrives in the thread already open is marked read 800 ms after it appears (`MARK_READ_DEBOUNCE_MS` in `sms-center.tsx`). Mark as unread on one bubble removes that one fingerprint.

---

## Timestamp Sorting

> ⚠️ WARNING: `qsms` emits timestamps as `"MM/DD/YY HH:MM:SS"` (zero-padded, fixed-width). A plain lexicographic sort mis-orders across month/year boundaries — `"12/31/25 23:59:59"` sorts **after** `"01/01/26 00:00:00"` because `"12" > "01"`. Never sort on the raw timestamp.

The backend reorders the fixed-width slices into a sortable `"YYMMDD HH:MM:SS"` key before reversing for newest-first:

```sh
sort_by(.timestamp[6:8] + .timestamp[0:2] + .timestamp[3:5] + .timestamp[8:]) | reverse
```

The frontend orders by `smsEpochMs()` in `components/cellular/sms/sms-format.ts`: the backend's `time` (epoch seconds, already corrected for the device UTC offset) first, then `parseSmsTimestamp()` on `MM/DD/YY HH:MM:SS` or `YYYY-MM-DD HH:MM:SS`. An unparseable value is `0` and sorts last instead of throwing during render.

---

## Inbox CGI (`cellular/sms.sh`)

### GET

Runs the CPMS heal, lists ME and SM with one `qsms list all`, merges the sent log, reads the SMSC and returns the conversation model. Response envelope (a message carries every field below; sent-log entries have `storage:"SENT"`, `indexes:[]`, `index:null`):

```json
{
  "success": true,
  "messages": [
    { "indexes": [150, 151], "sender": "GLOBE", "content": "Hello", "timestamp": "11/02/26 10:07:57",
      "storage": "ME", "addr": "GLOBE", "index": 150, "time": 1793585277,
      "direction": "inbound", "type": 1, "status": "success", "result": 1,
      "identity": "ME150:1793585277",
      "display_name": "GLOBE", "addr_kind": "alphanumeric", "display_source": "network" }
  ],
  "threads": [
    { "addr": "GLOBE", "sender": "GLOBE", "display_name": "GLOBE", "display_source": "network",
      "addr_kind": "alphanumeric", "latestMessage": "Hello", "content": "Hello",
      "timestamp": "11/02/26 10:07:57", "timestampSec": 1793585277, "unreadCount": 0,
      "latestIndex": 150, "direction": "inbound", "type": 1, "status": "success" }
  ],
  "storage": { "used": 184, "total": 290, "me": { "used": 153, "total": 255 }, "sm": { "used": 31, "total": 35 } },
  "smsc": { "addr": "+639180000101", "status": "", "time": "" },
  "unread_total": 0
}
```

- `addr_kind` is `msisdn`, `shortcode` (1 to 6 digits) or `alphanumeric` (any letter or non-ASCII byte). `time` is the epoch (inbound: `timestamp` minus the device UTC offset). `identity` is `<storage><first index>:<time>` for modem messages and `S<seq>:<time>` for sent ones.
- `storage_errors` is added only when `qsms list` reported a storage it could not read (`{"SM":"storage unavailable"}`); the other storage's messages are still returned.
- `GET ?addr=<urlencoded>` returns one thread oldest-first: `{success, addr, count, messages, has_more:false}`. `GET ?action=smsc` returns `{success, smsc}`, `modem_busy` or `smsc_read_failed`.
- Inbound senders carry no `+` (`639...`), so a sent bubble is logged under the normalized number to thread with them.
- A failed list returns `{ "success": false, "error": "sms_unavailable", "detail": "SMS service is not ready yet. Try again in a minute." }`; `detail` comes from `qsms_detail()`. A QMI error on one storage degrades instead (above). A timeout on either storage fails the whole list.

### POST actions

| Action | Required fields | Notes |
|---|---|---|
| `send` | `phone`, `message` | Normalizes `phone` (drop spaces, dashes, dots and brackets, strip `+`, local-number → country code via SIM MCC); a result that is not all digits is refused before `qsms` with `send_failed` and no sent-log record. Success returns `{success:true, addr:<normalized>}`, the number the sent record is filed under (the UI follows it). On failure, also with `addr`, returns `{success:false, error:"send_failed", detail:"<plain sentence>", parts, sent_parts, concat_ref, refs, ambiguous}` (HTTP 200; the last three copied from `qsms` as-is, `null` when absent), for `bad_number` and `message_too_long` too (counts are 0 there) |
| `delete` | `indexes` (array), `storage` (`"ME"`\|`"SM"`, default `"ME"`) | One `qsms delete` for all valid slots; `partial_failure` (`"N message(s) failed to delete"`) when `.deleted` is shorter than `indexes` |
| `delete` | `storage:"SENT"`, `identities` (array of `S<seq>:<time>`) | Drops those sent-log records only; `missing_identities` when empty |
| `delete` | `addr`, `index:"ALL"` | Lists, then one `qsms delete` per storage holding that sender, then drops the sent records to `addr`; `partial_failure` carries the failed count |
| `delete_all` | — | Clears ME, SM and the sent log; on failure `delete_all_failed` with a `detail` such as `ME: ok \| SM: 3 left \| SENT: ok` |
| `set_smsc` | `addr` (optional `+`, 3 to 20 digits) | `AT+CSCA="<addr>",<129\|145>` then a read-back: `{success:true, smsc}`. Errors `invalid_smsc`, `smsc_write_failed`, `modem_busy` |

Error codes: `missing_action`, `missing_phone`, `missing_message`, `missing_indexes`, `missing_identities`, `missing_addr`, `invalid_action`, `invalid_smsc`, `smsc_write_failed`, `smsc_read_failed`, `modem_busy` (AT lock, SMSC calls only), `sms_unavailable`, `send_failed`, `partial_failure`, `delete_all_failed`, `command_failed` (model build).

The sent log (`sms_sent.sh`) lives in `/etc/qmanager` because `/usrdata/qmanager` is root-only; it is removed by `uninstall_rm520n.sh --purge` with the rest of that directory. Each `send` appends one `success` or `failed` record (a send that fails after some parts went out is logged `failed`). Whether `AT+CSCA` changes the centre `qsms send` uses has not been measured: the WMS PDU carries an empty SMSC octet.

---

## SMS Center UI

The 2026-11 port (commit `e9e6d264`) replaced the inbox table with the RM551E layout: one card holding a thread list on the left and the open conversation on the right. Below `@3xl/main` (768 px) one pane shows at a time. The old inbox files (`inbox-card`, `inbox-table`, `inbox-toolbar`, `message-dialog`, `delete-dialogs`, `states`, `summary-tiles`) and the family `shapes.ts` are deleted; the Forwarding sub-route has its own `forwarding/shapes.ts` ([`sms-forwarding.md`](sms-forwarding.md)).

| File | Owns |
|---|---|
| `app/cellular/sms/page.tsx` | Wraps the center in `<Suspense>`: `useSearchParams` needs it for the static export to prerender |
| `sms-center.tsx` | Page header (synced-ago readout, Refresh, menu with Settings and Delete all), the two-pane card, `?thread=` routing, the delete confirmations, the one `useSms` call |
| `sms-thread-list.tsx` | Left pane: search, All / Unread filter, sort, rows, the storage meter at the foot |
| `sms-threads.ts` | `buildThreadViews` (backend `threads[]` first, else `messages[]` grouped on the raw `addr`), `threadViewFromMessages`, `threadMatchesQuery`, and the row geometry the skeleton imports (`THREAD_ROW_FRAME`, `THREAD_DISC_SIZE`, `THREAD_LIST_GAP`) |
| `sms-conversation.tsx` | Right pane: header, bubbles with date dividers, optimistic sends, the phishing warning row, the one-time-code chip, the partial-send line |
| `sms-composer.tsx` | Reply field at the foot of the conversation; the segment counter |
| `sms-compose-dialog.tsx` | New conversation (a destination with no thread yet) |
| `sms-settings-dialog.tsx` | SMS centre number (`set_smsc`) and the storage choice (`useSmsStorage`); each section has its own Save |
| `sms-message-menu.tsx` | `SmsMessageContextMenu`, the per-bubble menu (right-click, long-press, Shift+F10) |
| `sms-message-details-dialog.tsx` | Details: From/To (raw `addr`), resolved name, sender type, date, character count |
| `sms-forward-dialog.tsx` | Forward: a new send through `queueSend`, with an optional original-sender prefix |
| `sms-identity.ts` | `resolveSmsIdentity`: the four-tier name ladder, hashed disc tone, initials, `logoDomain` |
| `sms-identity-disc.tsx` | `SmsIdentityDisc`, the one disc used by list rows and the conversation header |
| `sms-format.ts` | `parseSmsTimestamp`, `smsEpochMs`, day buckets, `segmentInfo`, `extractOneTimeCode`, `containsSuspiciousLink`, `isOutbound`, `isServerFailed` |
| `sms-states.tsx` | `SmsStatePanel` (no thread, empty, loading, error) and the list and conversation skeletons |
| `sms-storage-meter.tsx` | One bar per memory, or one combined bar when `storage.me` / `storage.sm` are missing |
| `lib/sms-directory.ts` | Tier-3 short-code table (`SMS_DIRECTORY`), `classifyAddr`, `lookupSmsDirectory` |
| `lib/sms-logos.ts` | `SMS_LOGO_MAP`, `lookupSmsLogoDomain` |
| `lib/logo-store.ts` | Browser-side logo fetch and cache (`useLogo`, `requestLogo`) |
| `components/ui/brand-mark.tsx` | `BrandMark`: a mapped `react-icons/si` glyph, else a fetched logo, else a monogram |
| `lib/sms-segments.ts` | `smsSegments`, the part counter that mirrors `pdu.rs` |

Hooks: `hooks/use-sms.ts`, `hooks/use-sms-read-state.ts`, `hooks/use-sms-storage.ts`.

### `addr` is a key

`addr` is the raw stored address. The `?thread=` value (percent-encoded), `GET ?addr=`, the delete payload, the send destination and the read marks all use it byte for byte. `display_name` and `SmsIdentity.title` are labels only: passed to the backend, a title fetches an empty thread or texts the wrong destination. Forward's "include original sender" prefixes `addr`, not the name.

Closing a thread pushes the bare `/cellular/sms/` rather than calling `router.back()`, because a deep link has no list to go back to.

### Sender identity

`resolveSmsIdentity(addr, fields)` picks the title in four tiers and records the tier in `source`:

| Tier | `display_source` | Origin |
|---|---|---|
| 1 | `network` | The stored address was already clean text from the network |
| 2 | `decoded` | The backend un-mangled a GSM-7 sender ID that the vendor decoder had turned into BCD noise |
| 3 | `directory` | `lib/sms-directory.ts` matched a numeric short code |
| 4 | `raw` | Nothing resolved; the address is shown as stored (`formatMsisdn` groups a plain number) |

The directory only fills a gap: it runs only when `source` is `raw` and never overrides a `network` or `decoded` name. An envelope without the three identity fields (an old CGI) degrades to tier 4, or tier 3 where the directory matches. The disc tone is a djb2 hash of the raw `addr` over the product's own container roles, never a brand colour; a plain MSISDN gets the neutral disc and a person glyph. Both tables hold Philippines-market entries only, the reference device's SIM market.

### Sender logos

`logoDomain` is `lookupSmsLogoDomain(title)`: an exact match, after lowercasing and stripping non-alphanumerics, against a name or alias in `SMS_LOGO_MAP`. No substring or fuzzy match, and never for a plain MSISDN. `BrandMark` draws a mapped glyph when `markFor(domain)` has one, else asks `lib/logo-store.ts`, else shows the initials.

`logo-store.ts` runs in the browser, never on the device:

1. Hunter (`https://logos.hunter.io/<domain>`): redrawn to a WebP of at most 128 px and stored as a data URI, so it paints on the first frame. Under 32 px counts as none.
2. Google s2 favicon: not CORS-readable, so only the verdict is stored and the image comes from the browser cache. 16 px or less counts as none.
3. Neither: a miss, and the disc keeps its initials.

Verdicts live in `localStorage` key `qm_logos_v2`: at most 200 entries, a hit rechecked after 30 days, a miss after 7. A network error stores nothing, so the next visit tries again. At most 4 checks run at once, each with an 8 s timeout, sent with no referrer and no credentials.

> ⚠️ WARNING: the only value that leaves the browser is a domain from `SMS_LOGO_MAP`. A sender ID, a phone number or message text never reaches Hunter or Google. Do not add a path that hands `BrandMark` or `requestLogo` anything else. A sender ID can be spoofed, so a logo can be faked too; the mitigation is the warning row under any inbound message that `containsSuspiciousLink` flags, not hiding the logo.

### Refresh and fetch rules

- **No background refresh.** `useSms` fetches on mount, on Refresh, and after a send or delete. Each inbox read costs ~1.6 s of SIM reads ([The GET is not free](#the-get-is-not-free)), so do not add a timer. The 10 s interval in `sms-center.tsx` only re-renders the "synced N s ago" readout. (Some comments in `sms-center.tsx` still say "poll"; there is none.)
- **One inbox read at a time.** `inFlightRef` makes `fetchInbox` single-flight. A request made during a read sets `queuedRef` and runs once, silently, after the read finishes. That request is usually a post-mutation refresh, so dropping it would leave a deleted message on screen. The guard is released in `finally` unconditionally, or a remounted page could never fetch.
- **Thread detail reads under the same guard.** `fetchThread` waits for a read in flight, answers from the list when it holds that `addr`, and only otherwise sends one `GET ?addr=` (a full `qsms list all` on the device) while holding the guard. The open thread shows the union of the list's messages for that `addr` and the detail, de-duplicated on time, direction and body.
- **Refresh is silent.** The Refresh button calls `refresh(true)`; a non-silent fetch raises `isLoading` and swaps the panes for skeletons. Only the error panel's Retry calls `refresh()`.
- **A failed refresh keeps the list.** With threads on screen, an error adds a `warning` chip to the header and the list stays; the error panel shows only when there are no threads.
- **Delete all calls `delete_all`** through `deleteAllSms`: one POST clears ME, SM and the sent log.

### Sending

`queueSend(addr, text)` adds an optimistic bubble that moves `queued` → `sending` → `sent` or `failed`. Retry reuses the same `clientId`, so a retried bubble changes in place. A `sent` entry is dropped by the first inbox read that started after its acknowledgement, when the logged sent record replaces it. Outbound bubbles say **Sent**, never "Delivered": the modem accepting a message is not a delivery receipt. A failed multi-part send shows how many parts already went out (`sent_parts` from the CGI).

The composer's counter appears once the body is no longer one plain GSM-7 part. `lib/sms-segments.ts` copies `encode_submit` in `pdu.rs`: GSM-7 when every character is in the default or extension table (extension characters such as `€ { } [ ] ~ ^ \ |` count two septets; `é` and `ñ` stay GSM-7), otherwise UCS-2 counted in UTF-16 units; 160/153 and 70/67 per part, and a character is never split across parts. Change both files together.

### Message menu

| Message | Items |
|---|---|
| Pending (not yet stored) | Copy text |
| Received | Copy text, Copy code (when one was detected), Forward, Mark as unread, Details, Delete |
| Sent | Copy text, Forward, Details, Delete |

An item whose field is missing (`identity`, `indexes`) is left out, not shown disabled. `extractOneTimeCode` needs a keyword (code, PIN, OTP and similar) next to the digits, so a bare reference number or amount is never offered as a code.

### i18n

Copy lives under `sms.center.*`, `sms.settings.*` and `sms.storage.*` in `public/locales/*/cellular.json`; `sms.inbox.*`, `sms.compose.*` and `sms.errors.*` are still used. `e9e6d264` updated all five packs, and `bun run i18n:check` reported 0 errors on the branch (2026-11-03). Directory and logo names are proper nouns, not keys.

> ℹ️ NOTE: the port commit records no visual or on-device check of the new layout.

---

## On-Device Smoke Test

```sh
qsms status all                      # {"success":true,"storages":[...]}
qsms list ME | jq '.msg | length'    # counts only; keep message text out of transcripts
qcmd 'AT+CPMS?'                      # mem1/mem2/mem3 should all read "ME"
grep '\[qsms:' /tmp/qmanager.log | tail  # per-call timing and QMI error codes
curl -sS http://127.0.0.1/cgi-bin/quecmanager/cellular/sms.sh   # via lighttpd (as www-data)
```

> ⚠️ Validate the CGI through lighttpd (`curl http://127.0.0.1/...`) or `sudo -u www-data`, never as root — a root shell masks real `www-data` permission bugs.

---

## Related

- [`at-command-transport.md`](at-command-transport.md) — `qcmd`, the retired `sms_tool` / `atcli_smd11`, the shared `flock` on `/run/qmanager_at/at.lock` (used here only by the CPMS heal).
- [`qmi-probe.md`](qmi-probe.md) — the WMS measurements behind `qsms` (list timing, routes, send refusal, delete).
- [`sms-forwarding.md`](sms-forwarding.md) — the forwarding daemon, the **only** server-side inbox reader in the project.
- [`icon-system.md`](icon-system.md) — the Material/lucide boundary this route sits inside, and the two glyphs (`mark_email_unread`, `delete_sweep`) added for it.
- [`carrier-aggregation.md`](carrier-aggregation.md) — the freeze-while-stale precedent the inbox error state follows.