# SMS Center (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · UI verified 2026-08 · `qsms` transport verified 2026-10-28 on serial 61368cd2
> **RG501Q-EU (SDX55):** `qsms` uses QMI WMS there too since `qmanager_atd` 0.7.1 (T8.1). `status` and `list` verified read-only 2026-10-29 on serial b7e3d6f1; send, delete and tag writes not run there. ME holds 127 messages, not 255 — see [`platform-matrix.md`](./platform-matrix.md#at-transport)

> The SMS inbox: read / send / delete through `qsms`, which talks QMI WMS directly and takes no AT lock. Merges messages across ME (modem) and SM (SIM) storage, tracks read/unread in the browser, and keeps CPMS routing on ME so incoming SMS are never stranded on the SIM.

The SMS Center exposes a read/send/delete inbox at `/cellular/sms`. Every SMS operation runs through `/usr/bin/qsms`, a link to the `qmanager_atd` multicall binary. On an RM520N or RG501Q it speaks QMI WMS (the modem's Wireless Messaging Service) over a QRTR socket, so it never touches `/dev/smd11` or `/run/qmanager_at/at.lock`. This doc covers the inbox CGI, the `qsms` contract and its error mapping, the CPMS ME+SM storage model, the boot-time routing oneshot, and the browser-side read/unread tracking.

> ℹ️ NOTE: SMS **downtime alerts** (connection-lost/restored notifications sent over SMS) are a separate feature — the SMS channel of the centralized Alerts system, driven by `sms_alerts.sh`. This doc covers only the inbox. **SMS Forwarding** (auto-relay of incoming messages to another number) is also separate — see [`sms-forwarding.md`](sms-forwarding.md).

---

## Quick Reference

| Item | Value |
|---|---|
| Route | `/cellular/sms` |
| Inbox CGI | `GET/POST /cgi-bin/quecmanager/cellular/sms.sh` |
| SMS client | `/usr/bin/qsms` → `qmanager_atd` (relative symlink, laid down by `install_bundled_binaries()`) |
| Backend | QMI WMS when `Project Name:` in `/etc/quectel-project-version` starts with `RM520N`; AT otherwise. `QSMS_BACKEND=wms\|at` overrides |
| AT use per GET | One `qcmd 'AT+CPMS="ME","ME","ME"'` (routing self-heal) |
| Boot routing oneshot | `/usr/bin/qmanager_sms_storage` + `qmanager-sms-storage.service` |
| Read-state hook | `hooks/use-sms-read-state.ts` (browser `localStorage`, key `qmanager.sms.read.v1`) |
| Data hook | `hooks/use-sms.ts` (`useSms` — no polling, single-flight, see [The GET is not free](#the-get-is-not-free)) |
| Types | `types/sms.ts` |
| Inbox UI | `components/cellular/sms/` — see [Inbox UI](#inbox-ui) for the file split |
| Shape module | `components/cellular/sms/shapes.ts` — the family's one geometry/tone source, read by the loaded views **and** their skeletons |
| Reboot | Never |

---

## Transport: `qsms`

`qsms` is `argv[0]` of the `qmanager_atd` binary (source: `native/qmanager_atd/src/client/qsms.rs`, `src/sms/wms.rs`, `src/sms/pdu.rs`). It prints exactly one JSON envelope on stdout and exits 0 on success, 1 on failure. Callers decide success from the envelope's `.success` or the exit code, never from stderr.

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
qsms send <number> <text>      # number without '+'
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
| `send` | `{"success":true,"parts":2,"refs":[41,42]}` | `{"success":false,"error":"send_failed","detail":"…","parts":2,"sent_parts":1,"refs":[41]}` |
| `delete ME 3,4` | `{"success":true,"storage":"ME","deleted":[3,4],"failed":[]}` | `"success":false,"error":"delete_failed"`, with `"failed":[{"index":4,"error":"no such message"}]` |
| `delete SM all` | `{"success":true,"storage":"SM","deleted":31,"remaining":0}` | `"success":false,"error":"delete_failed"`, `"remaining":N` |
| `watch` | prints `ready`, then one `<ME\|SM> <index>` line per new message; prints `ready` again after every reconnect | exits 1 only when QRTR is unsupported; exits 0 when its stdout closes |

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

On a multi-part send, the first failed part stops the send and `detail` is prefixed `Part 2 of 3: `. **A retry resends every part from part 1**, so `sms_alerts.sh` and `qmanager_sms_forward` stop retrying once the envelope reports `sent_parts > 0`, and the inbox CGI passes `parts` / `sent_parts` so the compose dialog can say a resend repeats them. Resuming only the missing parts would need `qsms` to accept a fixed reference and start part. Measured on the RM520N-GL with no SIM credit: `The network rejected the message (cause 21).`

**Shell callers extract `.detail`; they never store or return the envelope.** Each caller has a fixed sentence for empty or non-JSON output (`qsms` missing or crashed):

| Caller | Extraction | Fallback |
|---|---|---|
| `sms.sh` `qsms_detail()` | `.detail`, else a sentence per code (`bad_number` → `That phone number is not valid.`, `message_too_long` → `The message is too long to send.`) | `The modem did not answer.` |
| `sms_forwarding.sh` `send_test` | `.detail // .error` | `No reply from the SMS service.` |
| `sms_alerts.sh` `_sa_send_error()` | `.detail // .error` | `No reply from the SMS service.` |
| `qmanager_sms_forward` `sf_send_with_retry()` | `.detail` when it is a string | `The message could not be sent.` |

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

QManager keeps routing on ME in two places: a boot oneshot, and one self-heal per inbox GET. It reads **both** ME and SM and merges them.

### mem1/mem2/mem3 model

| Pointer | Controls | QManager target |
|---|---|---|
| mem1 | Storage read/delete operations (AT only) | `ME` (255 slots) |
| mem2 | Storage used for sent messages | `ME` |
| mem3 | Storage for incoming SMS (and the WMS route) | `ME` |

**Why `ME` and not `SM`:** the RM520N-GL reports **ME 255 slots** and **SM 35 slots** (`qsms status all`), and `ME` is modem-resident so it survives SIM swaps.

WMS addresses a storage explicitly in each request (NV = ME, UIM = SM), so reading or deleting SM no longer moves mem1. The old ritual of re-asserting CPMS after every SM read or delete is gone.

### Boot routing oneshot (`qmanager_sms_storage`)

`/usr/bin/qmanager_sms_storage` sets routing even if the SMS page is never opened. It runs `qcmd AT` until the modem answers (20 tries, 3 s apart, ~60 s; `qcmd` takes the AT lock per call, so a slow-booting modem never starves other AT users), then runs `qcmd 'AT+CPMS="ME","ME","ME"'`, logs, and exits 0 on success or 1 on failure. It never reboots or calls `AT+CFUN`.

The unit `qmanager-sms-storage.service` is `Type=oneshot`, `RemainAfterExit=yes`, `TimeoutStartSec=90`, ordered `After=qmanager-setup.service qmanager-cfun-fix.service` (so the lock file exists and the radio is confirmed on) and `Before=qmanager-poller.service`. It is **not** in `UCI_GATED_SERVICES`, so the installer enables it unconditionally.

### GET-time self-heal

Each inbox GET runs, in order:

1. `qcmd 'AT+CPMS="ME","ME","ME"'` (`heal_routing()`), output discarded. A failed heal does not fail the GET.
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

> ℹ️ NOTE: `components/cellular/sms/summary-tiles.tsx` requires **both** halves to be present before drawing two meters (`const hasSplit = !!me && !!sm`) — half a breakdown is not a breakdown. In the degraded path the combined tile spans two grid tracks and its caption says "slots used across both memories" rather than labelling 290 as a capacity.

### The GET is not free

`hooks/use-sms.ts` still does not poll. An inbox GET costs:

| Cost | Detail |
|---|---|
| `AT+CPMS` writes | **1 per call** (the heal), through `qcmd` |
| `/run/qmanager_at/at.lock` acquisitions | **1 per call** (the heal); `qsms` takes none |
| WMS time | ME ~80–100 ms for ~150 messages; SM ~1.6 s for 31 messages (~50 ms per read, SIM I/O) |
| Response body | ~13 KB measured on the live device with 64 slots occupied |

The remaining cost is SIM I/O on every SM read, so an inbox poll would keep the SIM busy for ~1.6 s per cycle, plus one AT lock hold per heal. The UI refreshes only on mount and on explicit user action (the Refresh button, and after a send/delete).

### Storage-aware delete

The `delete` POST requires a `storage` field (`"ME"` or `"SM"`, defaulting to `"ME"`, constrained to exactly those two). Only non-negative integers from `indexes` reach `qsms`, joined into one `qsms delete <storage> i,j,…` call; anything else counts as a failed slot. `delete_all` runs `qsms delete ME all` then `qsms delete SM all`. No CPMS write follows either action.

---

## Phone Number Normalization

`sms.sh` normalizes outbound numbers (`send` action) in `normalize_phone()`:

1. Strip a single leading `+` (`qsms send` takes the number without it).
2. If the number starts with `0` (local format), read the SIM's MCC via `qcmd 'AT+CIMI'` (first 3 digits of the IMSI), map it to the ITU-T country calling code via an in-script `mcc_to_calling_code()` lookup table, and replace the leading `0`. An unknown MCC or unreadable IMSI logs a warning and sends the number as-is.

This lets a user type a local number (e.g. `0917…`) and have it dialed internationally based on the inserted SIM's country.

---

## Read/Unread State (Client-Side)

The modem is not the source of truth for per-message read/unread in the UI:

1. `qsms list` reports each message's `stat`, but the CGI's merge drops it, so it never reaches the browser.
2. A WMS list never changes a message's read tag, so on the RM520N-GL a page load no longer clears the modem's unread flags. Under `sms_tool` (and still on the AT backend) every list ran `AT+CMGL=4`, which marks every listed message read.

Showing the modem's unread state in the inbox is possible now but not built. Read state is therefore tracked entirely in the browser by `hooks/use-sms-read-state.ts` (exports `useSmsReadState`, `smsFingerprint`, `parseSmsTimestamp`), persisted to `localStorage` under `qmanager.sms.read.v1` as a JSON array of fingerprint strings.

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

> ⚠️ WARNING: `qsms` emits timestamps as `"MM/DD/YY HH:MM:SS"` (zero-padded, fixed-width). A plain lexicographic sort mis-orders across month/year boundaries — `"12/31/25 23:59:59"` sorts **after** `"01/01/26 00:00:00"` because `"12" > "01"`. Never sort on the raw timestamp.

The backend reorders the fixed-width slices into a sortable `"YYMMDD HH:MM:SS"` key before reversing for newest-first:

```sh
sort_by(.timestamp[6:8] + .timestamp[0:2] + .timestamp[3:5] + .timestamp[8:]) | reverse
```

The frontend (`parseSmsTimestamp`) parses the same `MM/DD/YY HH:MM:SS` into epoch millis and sorts descending as a client-side safety net, so newest-first ordering holds even if backend ordering is ever disrupted.

---

## Inbox CGI (`cellular/sms.sh`)

### GET

Runs the CPMS heal, lists ME and SM with one `qsms list all`, and returns the merged list plus storage (summed **and** per-memory). Response envelope:

```json
{
  "success": true,
  "messages": [
    {
      "indexes": [3],
      "sender": "GLOBE",
      "content": "Hello",
      "timestamp": "07/19/26 14:33:11",
      "storage": "ME"
    }
  ],
  "storage": {
    "used": 64,
    "total": 290,
    "me": { "used": 64, "total": 255 },
    "sm": { "used": 0, "total": 35 }
  }
}
```

A failed list returns `{ "success": false, "error": "sms_unavailable", "detail": "SMS service is not ready yet. Try again in a minute." }`; the `detail` is whatever `qsms_detail()` extracted (see [Error and detail mapping](#error-and-detail-mapping)). A QMI error on one storage degrades instead: `qsms` reports it under `storage_errors`, still succeeds, and the GET returns the other storage's messages. A timeout on either storage fails the whole list.

### POST actions

| Action | Required fields | Notes |
|---|---|---|
| `send` | `phone`, `message` | Normalizes `phone` (strip `+`, local-number → country code via SIM MCC); on failure returns `{success:false, error:"send_failed", detail:"<plain sentence>", parts, sent_parts}` (HTTP 200), for `bad_number` and `message_too_long` too (counts are 0 there) |
| `delete` | `indexes` (array), `storage` (`"ME"`\|`"SM"`, default `"ME"`) | One `qsms delete` for all valid slots; `partial_failure` (`"N message(s) failed to delete"`) when `.deleted` is shorter than `indexes` |
| `delete_all` | — | Clears ME then SM; on failure `delete_all_failed` with a `detail` such as `ME: ok \| SM: 3 left` |

Error codes: `missing_action`, `missing_phone`, `missing_message`, `missing_indexes`, `invalid_action`, `sms_unavailable`, `send_failed`, `partial_failure`, `delete_all_failed`.

---

## Inbox UI

The route was rebuilt on the tonal design system (`DESIGN.md`). The 961-line `sms-inbox-card.tsx` was **deleted** and split into files under `components/cellular/sms/`:

| File | Owns |
|---|---|
| `shapes.ts` | **All geometry, control heights, tone maps and skeleton line boxes for the family.** No component exports a shape constant any more |
| `sms-center.tsx` | Page shell: `CellularPageHeader`, the tile strip, the page-level motion cascade, `useSms` + `useSmsReadState` |
| `summary-tiles.tsx` | The three-tile strip (Unread / Modem memory / SIM memory) and the degradation path |
| `inbox-card.tsx` | The anchor card, the `useReactTable` instance, selection state, delete sequencing |
| `inbox-toolbar.tsx` | Tabs (All / Unread / Read), search, sort, Mark-all-read |
| `inbox-table.tsx` | Column defs (`useSmsColumns`), row rendering, pagination |
| `states.tsx` | Skeletons, read-failure notice, staleness chip, empty state |
| `message-dialog.tsx` | Read view, copy, gated reply, delete; exports `isDialableSender` |
| `delete-dialogs.tsx` | The three delete confirmations plus per-memory progress |
| `forwarding/**` | The forwarding sub-route — see [`sms-forwarding.md`](sms-forwarding.md); it reads `../shapes.ts` too |

> ℹ️ NOTE: The `useReactTable` instance deliberately lives in **`inbox-card.tsx`**, not `inbox-table.tsx`. The card header reads `selectedCount` for its selection pill and the delete handler reads `table.getSelectedRowModel().rows`, so pushing the instance down into the table would mean lifting the same state straight back up.

### The shape module (`shapes.ts`)

Added 2026-08-20. SMS was the only one of the twelve `/cellular/` route families **without** a `shapes.ts`, and it had every symptom the pattern exists to prevent — none of them visible in any single file, which is why they survived review:

- `PILL_ACTION` existed in **four byte-identical copies** across three files (`sms-center.tsx`, `sms-compose-dialog.tsx`, twice inline in `states.tsx`), plus a fifth in `forwarding/sms-forwarding-card.tsx`. All of them are now the Button's own `size="action"` (2026-10-06).
- **Three unrelated control heights** inside one card — 42px, 40px and 36px — with no constant naming the split, so nothing recorded that the 36px toolbar was a deliberate density choice rather than drift. `TOOLBAR_PILL` now names the 36px height; the `pointer-coarse:h-11` bump that keeps it a legal 44px touch target comes from the Button's `default` size.
- `DIALOG_TONAL = DIALOG_ACTION`, an alias to nothing, left over from a split that no longer exists.
- **Skeletons that guessed** rather than mirrored — see [Skeletons are mirrors again](#skeletons-are-mirrors-again).

Two conventions matter when editing it:

1. **Geometry is restated across sibling families, never imported from one.** Values that match `settings/shapes.ts` or `antenna-alignment/shapes.ts` are deliberate copies — a sibling family must stay free to retune without reaching into this one. What is genuinely family-wide lives one level up in `components/cellular/` (`tile-shape.ts`, `signal-quality-display.ts`, `condition-screen.tsx`) and is imported from there.
2. **A component is never another component's geometry source.** Before this change `states.tsx` exported the card shell, `inbox-table.tsx` exported `TABLE_SHAPE`, `summary-tiles.tsx` exported the grid, and `forwarding/sms-forwarding-card.tsx` exported the *page grid* that lays out the card itself. All of those exports are gone.

### Invariants

**"Delete all" no longer calls the `delete_all` CGI action.** The UI fires **two sequential `deleteSms(indexes, storage)` calls**, one per memory (`groupByStorage()` in `inbox-card.tsx`), so the per-memory progress it draws is genuinely observable. `delete_all` is a single synchronous POST that runs both deletes before emitting one merged result — a UI animating "modem memory cleared ✓ / clearing SIM ⟳" against it would be *inventing* the sequencing, and on a partial failure could show a green check on a step that actually errored. Grouped deletes also let a failure name **which** memory failed instead of merging into one error string.

> ⚠️ WARNING: `deleteAllSms` is still exported from `hooks/use-sms.ts` and the `delete_all` POST action still works, but **nothing in the UI calls either one**. Do not treat the hook export as evidence the action is exercised.

**`useSms` exposes `lastSuccessfulFetch`** (epoch ms), set on the success branch and deliberately *preserved* on the error branch. It is the client's own clock on purpose: a server-side timestamp would report when the CGI ran, not when the browser last saw good data, which is the wrong question for a staleness indicator. It is captured inside the fetch callback and read back as data, never derived from `Date.now()` during render — a render-time clock read is a `react-hooks/purity` violation, and one purity error suppresses every later diagnostic in the same component.

**A read failure keeps the table.** On a failed GET the rows stay on screen, with a destructive `TonalBanner` above them and a `warning` "Stale, HH:MM:SS" chip in the card description dating them. A failed inbox GET here is usually transient — WMS not yet up after boot or a modem subsystem restart (`sms_unavailable`) — and blanking an inbox for that is a functional regression, not honesty. This follows the Carrier Aggregation precedent: the list *freezes* while stale rather than announcing changes that never happened. Only a genuinely empty inbox with no error gets the empty state. (The previous code had the opposite defect: it silently swallowed a refresh failure whenever cached data existed, so stale rows were never labelled.)

**Refresh must be silent, or it destroys the state the freeze rule protects.** `refresh()` in `hooks/use-sms.ts` takes a `silent` argument and defaults it to **false**; a non-silent fetch raises `isLoading`, and `isLoading` is what flips the ternary in `sms-center.tsx` that swaps the whole card for `InboxLoadingState`. Unmounting `SmsInboxCard` discards every piece of state it owns — the active tab, the search text, the sort direction, the row selection and the pagination page. So the Refresh button was wiping exactly what the paragraph above exists to preserve. The call site is now `onRefresh={() => refresh(true)}`, and the in-flight state shows on the button itself (a spinning `progress_activity` glyph) instead of on the whole card.

> ⚠️ WARNING: **any** new caller of `refresh()` on this surface must pass `true`. A bare `refresh()` is not a smaller version of the same thing — it is a card teardown.

**One inbox GET at a time, with a queued re-fetch.** `fetchInbox` holds a single-flight guard (`inFlightRef`). One GET costs a CPMS write through `qcmd` and ~1.6 s of SIM I/O for the SM list (see [the cost table](#the-get-is-not-free)); concurrent GETs do not go faster, they repeat that work, and each heal takes `/run/qmanager_at/at.lock` away from the poller and the watchdog for one command.

The second half is `queuedRef`, and it is **not** optional. A fetch requested while another is in flight is usually a *post-mutation* refresh, whose whole job is to replace rows the in-flight GET was issued *before* the delete or send happened. Dropping it would leave a just-deleted message on screen until the next manual refresh. So a coincident request is remembered and run once, silently, after the current one lands. The guard is released in `finally` **unconditionally** — gating it on `mountedRef` would strand it on unmount and a remounted card would refuse to fetch for the life of the page.

**`isFetching` is a separate flag from `isLoading` and from `isSaving`.** `isLoading` is deliberately scoped to the first, non-silent load, because it is what swaps the card for a skeleton; `isSaving` covers only send/delete. Nothing on the refresh path was observable before `isFetching` existed — which is why the Retry button in `InboxErrorNotice` was wired to `isSaving` and its spinner **could never fire**. Retry and Refresh both read `isFetching` now.

**Alphanumeric senders are the default case, not the exception.** Every sender on the live device is an alphanumeric sender ID — `GLOBE`, `SMART`, `TNT`, `NDRRMC`, `GLOBE_OTP`, `SmartApp` — not one phone number. **Reply is gated on `isDialableSender()`** (digits with an optional leading `+`, spaces and dashes only, ≥3 digits) and the dialog shows an explanatory hint when it is withheld; the sender renders verbatim with no phone formatting, no derived initials and no `tel:` link. Any future avatar-initials or number-formatting work on this surface would be wrong by default.

**Slot labels are always qualified by their storage.** `indexes` are real physical slot numbers, but they are **per-storage** and both stores start at 0 — ME slot 3 and SM slot 3 are different messages. The message dialog's slot chip therefore always carries the memory alongside the number, and `groupByStorage()` never mixes the two pools into one `delete` call. Roughly **41% of live messages are multi-part**, so `indexes` frequently has length > 1.

**Fixed: row selection survived a filter change.** `rowSelection` is keyed by `smsFingerprint`, and nothing pruned it when the tab or the search box changed — so a message selected under **All**, then filtered out of view, stayed in `selectedCount` and *was deleted* by "Delete N selected" while invisible. Now defended twice:

1. Every count and every delete reads `table.getSelectedRowModel().rows`, which is derived from the currently-filtered rows, so a fingerprint with no matching row cannot be counted or deleted. This also covers selections orphaned by a refresh or by an outside delete.
2. The tab and search change handlers clear `rowSelection` outright, so checkboxes do not resurrect when the filter is undone.

Clearing happens in the **handlers, not an effect**: `setState` inside `useEffect` is exactly the shape the react-compiler lint rejects, and the handler is where the intent lives.

### The tile strip: neutral bodies, one coloured disc

The summary strip was running **two retired tile generations at once**: the unread tile on the strong fill (`bg-primary` over a 104px block) and both storage tiles on pale containers, one of them Uplink Cyan. It is now the composition `components/cellular/radio/summary-tiles.tsx` arrived at after five generations — **the body is neutral (`TILE_BODY`) on every tile and the disc carries the hue**.

Both halves of the old strip were wrong for stated reasons:

- A 104px block is not "compact emphasis", so the strong fill was off-layer.
- Four pale bodies at near-identical container lightness encode **category** without encoding **importance**, so the strip flattens to equal weight and the eye has nowhere to land. A neutral body with a saturated disc gives each tile a focal point at roughly one-eighth the tinted area, and gives the strip a reading order again.

Only "unread" — the one figure on this strip a user acts on — keeps the brand fill, and it keeps it on the *disc*. The `tone` prop was **deleted from the local `Tile`**, so a caller cannot tint a body back; making the wrong thing unreachable is cheaper than a comment asking nobody to do it.

> ℹ️ NOTE: the cyan was argued for in the file's own header as "the system's third identity hue [which] already owns counts and upload direction system-wide" — the exact argument `radio/summary-tiles.tsx` names and rejects ("A count is not a direction. That gave cyan a second meaning and made the whole direction axis untrue"), after it had already been tried and reverted once on the Carriers tile. The same header cited "DESIGN.md > Secondary" and "DESIGN.md > Tertiary", **neither of which exists**: the file was reasoning from a retired document. A stored-message count has no honest hue, so both storage tiles take the neutral disc and the meter length carries the reading.

**An identity hue left a shared primitive because of this.** `components/ui/metric-bar.tsx` carried a `uplink` entry in `TONE_CLASS` that existed *solely* for the SIM-memory meter, and its own comment justified the fill *because the tile it sat in was `uplink-container`*. The justification was sound and the premise was not. Neutralising the tile removed the entry's only consumer, so it is gone. The general shape is worth keeping in view: **a tone added to a shared primitive to satisfy one call site inherits that call site's mistake, and outlives it.**

### Metadata is a `Tag`, never a `Badge`

Three chips moved from `Badge variant="secondary"` to `Tag variant="neutral"`:

| Chip | File |
|---|---|
| The `SIM` storage label on an inbox row | `inbox-table.tsx` |
| The `ME`/`SM` + slot-number label in the message dialog | `message-dialog.tsx` |
| The GSM-7 / UCS-2 encoding label in the compose dialog | `sms-compose-dialog.tsx` |

`components/ui/tag.tsx`'s own header is the authority: a filled `Badge` says whether a thing is **well**; an outline `Tag` says what a thing **is** — "a band number, a radio family, a channel width, a capability". Which memory a message physically lives in, and which encoding a payload uses, are both the second kind. `neutral` because neither has an honest hue. See CLAUDE.md > Status Chip Pattern.

The hand-written selection chip in `inbox-card.tsx` was rebuilt the same way, and it was wrong twice: chip classes were hand-written rather than coming from a variant, and it nested a **24px** `<button>` dismiss target inside itself — under half the 44px coarse-pointer target every other control on the page already clears. The count and the clear action are now two objects: a `Tag` beside a real ghost icon button on `ICON_PILL`.

### Skeletons are mirrors again

Every number the loading state draws now comes from `shapes.ts`, which the loaded views read too. It had stopped being a mirror, and each guess was wrong against the view it hands off to: a **44px** tab strip against a real **38px** one (`TabsList` is `h-auto gap-1 p-1` around `h-9` triggers); **one** trailing pill where the toolbar renders **two**; rows inset `px-3` against the loaded `px-4`; **five** rows against a real `pageSize` of **ten**, so the card grew by half its height at the handoff; a checkbox at the 8px inline radius where the real Radix control is 4px (at 16px square, a near-circle standing in for a near-square); and **no pagination footer at all** against a loaded footer carrying a select, a page label and four icon buttons.

### Other presentation notes

- The unread marker is a `mark_email_unread` **glyph** plus a font-weight change, in a reserved `size-4` slot, not the old bare primary dot. Colour was the dot's only channel, so it did not exist in greyscale or under deuteranopia. Read rows carry no glyph — two states in one slot must never share one. Its ink is `primary-on-surface` (the ink step for tinted text on a plain surface), swapping to `on-primary-container` when the row is selected, because a selected row promotes to `primary-container` and neutral-surface ink on another role's container is a cross-pair.
- The inbox stays a real `<table>` with hairline `--outline` rules (DESIGN.md names it as one of the genuine data tables), sized by container queries against the card's `@container/card`, not viewport breakpoints.
- The card description reports usage honestly: split ME/SM figures when the breakdown is present, a bare "N slots used" when it is not, and "unknown" while a read is failing.
- **The page root no longer carries `aria-live="polite"`.** A live region has to be the smallest thing that actually changed; on the root it made every filter change, every pagination click and every re-render a full-surface announcement. The two things that genuinely need announcing already do so locally — the delete-progress list carries `aria-live="polite"` and the read-failure banner carries `role="alert"`.
- **The compose counter mirrors the encoder.** `lib/sms-segments.ts` copies `encode_submit` in `pdu.rs`: GSM-7 when every character is in the GSM default or extension table (extension characters such as `€ { } [ ] ~ ^  |` count two septets; `é`, `ñ` stay GSM-7), otherwise UCS-2 counted in UTF-16 units; 160/153 and 70/67 per part, a character never split. The counter reads units over the capacity of the current parts, and the hint names the part count. Change both files together.
- **The compose character counter no longer signals the near-limit step with colour alone.** Approaching and exceeding the limit now carry distinct glyphs (`warning` / `error`) alongside the tint, so the escalation exists for a colour-blind reader; two states in one slot never share a mark.
- `sms-center.tsx` uses the shared `CellularPageHeader` rather than the byte-identical copy of its internals it used to hand-roll — including the `min-w-0` that stops a long Italian title pushing the actions off the row.
- Type steps moved onto the ramp: the off-ramp `text-base`/600 in the health block and the `13px`-outside-a-metric-row prose are both gone (13px is the dense metric-row step and DESIGN.md restates that scope as a hard Don't).

> ⚠️ NOTE ON VERIFICATION (2026-08-20): the **SMS Center** surface has now been visually checked on a throwaway fixture route in both light and dark themes — tiles render neutral-bodied with a single coloured disc, all eight tiles (five loaded, three skeleton) measure exactly **104px** in the DOM so the skeleton handoff has zero layout shift, and the `0 / 35` SIM reading renders an **empty track** rather than a zero-length fill. The **forwarding** sub-route was **not** visually verified — it needs a live backend to reach its loaded state. See [`sms-forwarding.md`](sms-forwarding.md).

### i18n

The SMS Center and SMS Forwarding rebuild added **96 new English keys** to `public/locales/en/cellular.json` (51 SMS Center + 45 Forwarding) and **rewrote 2 existing ones** — `sms.inbox.delete_all_confirm.title` and `.description`, which gained new `{{count}}` / `{{me}}` / `{{sm}}` interpolation slots.

The 96 new keys were added to **English only**. `zh-CN`, `zh-TW`, `it` and `id` were deliberately left without them: i18next falls back to English at runtime, and an *absent* key surfaces in `i18n:check` output, whereas English pasted into a locale file would report a fake "100% translated". At the time `bun run i18n:check` reported **0 errors, 392 warnings** — that warning count was the intended, tracked debt, and all 98 keys were backfilled shortly after (see [sms-forwarding.md](sms-forwarding.md) > i18n).

> ℹ️ NOTE: since 2026-08-12 a missing key is a **hard error** that exits 1, so the state described above would now fail the gate outright. Deliberate, tracked debt is carried with `--warn-only` / `QM_I18N_WARN_ONLY=1`, never by reading past a red run. See [i18n.md](i18n.md) > The repo gate.

The 2 rewritten keys were **removed from all four other locales** rather than left in place. A placeholder mismatch is a hard *error* in `i18n:check`, and more importantly the old translation no longer says what the new English says.

#### The 2026-08-20 conformance pass was parity-neutral

`bun run i18n:check` reports **0 errors, 2293/2293 in all five locales** — identical to the pre-change baseline. Exactly one key pair changed shape, and it changed in all five packs at once: `sms.forwarding.failures.title_one` / `_other` renamed their placeholder `{{count}}` → `{{value}}`, so the live count could be rendered as its own `tabular-nums` element. **Plural selection still keys on the numeric `count` option**, which is passed alongside `value` — i18next chooses the plural form from `count` and interpolates `value`. Renaming `count` without keeping it in the options object would silently collapse both forms to one.

Everywhere else the strings were left alone and `withSlot` from `components/auth/interpolation-slot.tsx` was used instead of `<Trans>` or a key split. It slices **one** interpolated value back out of a finished translated string, so the translator keeps full control of word order and no locale gains a `<0>` tag it cannot see rendered. That is what scopes mono to the machine part of a sentence rather than the whole sentence — before this, the human word "Newest" (and its four translations) shipped in JetBrains Mono on the unread tile, and the word "slot" did the same in the message dialog, which is the Machine-Voice Rule inverted.

> ⚠️ WARNING: **two keys on the forwarding surface are built by template literal and are invisible to a static scan** — `` `sms.forwarding.health.${health}.label` `` and `` `.description` `` in `delivery-health-card.tsx`. The missing `.description` on `active` and `issue` is **intentional**: `SHOWS_DESTINATION` routes those two states to the phone-number line instead. Do not "fix" the gap by adding the keys, and do not trust a grep for `sms.forwarding.health` to enumerate what this surface uses.

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