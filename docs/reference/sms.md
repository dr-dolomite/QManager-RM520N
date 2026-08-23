# SMS Center (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

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
| Data hook | `hooks/use-sms.ts` (`useSms` — no polling, single-flight, see [GET is not free](#the-get-is-not-side-effect-free)) |
| Types | `types/sms.ts` |
| Inbox UI | `components/cellular/sms/` — see [Inbox UI](#inbox-ui) for the file split |
| Shape module | `components/cellular/sms/shapes.ts` — the family's one geometry/tone source, read by the loaded views **and** their skeletons |
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

### Deployment (install + OTA)

`/usr/bin/sms_tool` is laid down by `install_bundled_binaries()` in `install_rm520n.sh`, alongside `atcli_smd11` and `qmanager_discord`. That function runs **unconditionally** in `main()` — outside the `--skip-packages` gate — so every OTA / in-app "Software Update" upgrade (which always passes `--skip-packages`) refreshes the binary, `cmp -s`-skipping the copy only when the on-device file is already byte-identical. This matters because the CGI callers rely on the patched binary's `/dev/smd11` default (they invoke `sms_tool` with **no** `-d` flag): previously the copy was stranded inside `install_dependencies()`, which `--skip-packages` skips, so OTA-upgraded devices kept the old unpatched binary (compiled default `/dev/ttyUSB0`) and the inbox came up empty. See [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

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

**Why `ME` and not `SM`:** the live RM520N-GL reports **ME 255 slots** and **SM 35 slots** (`sms_tool -s ME status` / `-s SM status`), and `ME` is modem-resident so it survives SIM swaps. If mem3 stays `SM` and the SIM's 35 slots fill up, the modem silently discards further incoming messages.

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

`storage.used` / `storage.total` in the response are the **sum** of ME and SM, and the response *also* carries a per-memory breakdown under `storage.me` / `storage.sm` — see [Per-memory storage breakdown](#per-memory-storage-breakdown) for why the sum alone was not enough.

> ⚠️ WARNING: `sms_tool status` output is word format — `Storage type: ME, used: 0, total: 255` — **not** slash-separated. Parse with `grep -o 'used: [0-9]*'` / `'total: [0-9]*'`. A `[0-9]*/[0-9]*` pattern never matches and reads `0/0`.

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

The change is **purely additive** and confined to the `jq -n` at the end of the GET handler. All four values (`me_used`, `me_total`, `sm_used`, `sm_total`) were already parsed and zero-defaulted earlier in the same handler for the summing step — there are **no new AT calls, no extra lock acquisitions, and no change to the ordered CPMS ritual** described above.

`SmsStorage` in `types/sms.ts` declares `me?` and `sm?` as **optional**, deliberately. A device that has not taken the OTA update runs the old CGI and returns only the sum, so the UI is required to degrade to a single combined meter. A required field would make the type assert something the wire cannot guarantee.

> ℹ️ NOTE: `components/cellular/sms/summary-tiles.tsx` requires **both** halves to be present before drawing two meters (`const hasSplit = !!me && !!sm`) — half a breakdown is not a breakdown. In the degraded path the combined tile spans two grid tracks and its caption says "slots used across both memories" rather than labelling 290 as a capacity.

### The GET is not side-effect-free

An inbox GET is a comparatively expensive, **stateful** operation, and this is the reason `hooks/use-sms.ts` still does not poll:

| Cost | Detail |
|---|---|
| `AT+CPMS` writes | **2 per call** (assert before the reads, re-assert after the `-s SM` reads) |
| `/tmp/qmanager_at.lock` acquisitions | **6 per call** — CPMS write, ME `recv`, SM `recv`, ME `status`, SM `status`, CPMS write |
| Response body | ~13 KB measured on the live device with 64 slots occupied |

Every one of those six acquisitions contends with `qmanager_poller`, `qmanager_watchcat`, `sms_alerts.sh` and `qmanager_sms_forward` for the *same* `flock`. Adding an inbox poll is therefore a **lock-contention decision against the poller**, not a free UI nicety — weigh it as one. The current UI refreshes only on mount and on explicit user action (the Refresh button, and after a send/delete).

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

Asserts ME routing, reads ME then SM, re-asserts ME, and returns the merged list plus storage (summed **and** per-memory). Response envelope:

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

- `PILL_ACTION` existed in **four byte-identical copies** across three files (`sms-center.tsx`, `sms-compose-dialog.tsx`, twice inline in `states.tsx`), plus a fifth in `forwarding/sms-forwarding-card.tsx`.
- **Three unrelated control heights** inside one card — 42px, 40px and 36px — with no constant naming the split, so nothing recorded that the 36px toolbar was a deliberate density choice rather than drift. `TOOLBAR_PILL` now carries both the height *and* the `pointer-coarse:h-11` bump that keeps it a legal 44px touch target, so the two facts travel together.
- `DIALOG_TONAL = DIALOG_ACTION`, an alias to nothing, left over from a split that no longer exists.
- **Skeletons that guessed** rather than mirrored — see [Skeletons are mirrors again](#skeletons-are-mirrors-again).

Two conventions matter when editing it:

1. **Geometry is restated across sibling families, never imported from one.** Values that match `settings/shapes.ts` or `antenna-alignment/shapes.ts` are deliberate copies — a sibling family must stay free to retune without reaching into this one. What is genuinely family-wide lives one level up in `components/cellular/` (`tile-shape.ts`, `signal-quality-display.ts`, `condition-screen.tsx`) and is imported from there.
2. **A component is never another component's geometry source.** Before this change `states.tsx` exported the card shell, `inbox-table.tsx` exported `TABLE_SHAPE`, `summary-tiles.tsx` exported the grid, and `forwarding/sms-forwarding-card.tsx` exported the *page grid* that lays out the card itself. All of those exports are gone.

### Invariants

**"Delete all" no longer calls the `delete_all` CGI action.** The UI fires **two sequential `deleteSms(indexes, storage)` calls**, one per memory (`groupByStorage()` in `inbox-card.tsx`), so the per-memory progress it draws is genuinely observable. `delete_all` is a single synchronous POST that runs both deletes before emitting one merged result — a UI animating "modem memory cleared ✓ / clearing SIM ⟳" against it would be *inventing* the sequencing, and on a partial failure could show a green check on a step that actually errored. Grouped deletes also let a failure name **which** memory failed instead of merging into one error string.

> ⚠️ WARNING: `deleteAllSms` is still exported from `hooks/use-sms.ts` and the `delete_all` POST action still works, but **nothing in the UI calls either one**. Do not treat the hook export as evidence the action is exercised.

**`useSms` exposes `lastSuccessfulFetch`** (epoch ms), set on the success branch and deliberately *preserved* on the error branch. It is the client's own clock on purpose: a server-side timestamp would report when the CGI ran, not when the browser last saw good data, which is the wrong question for a staleness indicator. It is captured inside the fetch callback and read back as data, never derived from `Date.now()` during render — a render-time clock read is a `react-hooks/purity` violation, and one purity error suppresses every later diagnostic in the same component.

**A read failure keeps the table.** On a failed GET the rows stay on screen, with a destructive `TonalBanner` above them and a `warning` "Stale, HH:MM:SS" chip in the card description dating them. A failed inbox GET here is usually transient `modem_busy` lock contention — another AT consumer holding `/tmp/qmanager_at.lock` for a cycle — and blanking an inbox for that is a functional regression, not honesty. This follows the Carrier Aggregation precedent: the list *freezes* while stale rather than announcing changes that never happened. Only a genuinely empty inbox with no error gets the empty state. (The previous code had the opposite defect: it silently swallowed a refresh failure whenever cached data existed, so stale rows were never labelled.)

**Refresh must be silent, or it destroys the state the freeze rule protects.** `refresh()` in `hooks/use-sms.ts` takes a `silent` argument and defaults it to **false**; a non-silent fetch raises `isLoading`, and `isLoading` is what flips the ternary in `sms-center.tsx` that swaps the whole card for `InboxLoadingState`. Unmounting `SmsInboxCard` discards every piece of state it owns — the active tab, the search text, the sort direction, the row selection and the pagination page. So the Refresh button was wiping exactly what the paragraph above exists to preserve. The call site is now `onRefresh={() => refresh(true)}`, and the in-flight state shows on the button itself (a spinning `progress_activity` glyph) instead of on the whole card.

> ⚠️ WARNING: **any** new caller of `refresh()` on this surface must pass `true`. A bare `refresh()` is not a smaller version of the same thing — it is a card teardown.

**One inbox GET at a time, with a queued re-fetch.** `fetchInbox` holds a single-flight guard (`inFlightRef`). One GET takes the shared AT lock **six times** (see [the cost table](#the-get-is-not-side-effect-free)); concurrent GETs do not go faster, they queue behind each other on `/tmp/qmanager_at.lock` while contending with the poller, the watchdog and `sms_alerts.sh` for the same lock — so a burst of Refresh clicks starves unrelated subsystems for the duration.

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

Every number the loading state draws now comes from `shapes.ts`, which the loaded views read too. It had stopped being a mirror, and each guess was wrong against the view it hands off to: a **44px** tab strip against a real **38px** one (`TabsList` is `h-auto gap-1 p-1` around `h-9` triggers); **one** trailing pill where the toolbar renders **two**; rows inset `px-3` against the loaded `px-4`; **five** rows against a real `pageSize` of **ten**, so the card grew by half its height at the handoff; a checkbox at the 12px inline radius where the real Radix control is 4px (at 16px square, a near-circle standing in for a near-square); and **no pagination footer at all** against a loaded footer carrying a select, a page label and four icon buttons.

### Other presentation notes

- The unread marker is a `mark_email_unread` **glyph** plus a font-weight change, in a reserved `size-4` slot, not the old bare primary dot. Colour was the dot's only channel, so it did not exist in greyscale or under deuteranopia. Read rows carry no glyph — two states in one slot must never share one. Its ink is `primary-on-surface` (the ink step for tinted text on a plain surface), swapping to `on-primary-container` when the row is selected, because a selected row promotes to `primary-container` and neutral-surface ink on another role's container is a cross-pair.
- The inbox stays a real `<table>` with hairline `--outline` rules (DESIGN.md names it as one of the genuine data tables), sized by container queries against the card's `@container/card`, not viewport breakpoints.
- The card description reports usage honestly: split ME/SM figures when the breakdown is present, a bare "N slots used" when it is not, and "unknown" while a read is failing.
- **The page root no longer carries `aria-live="polite"`.** A live region has to be the smallest thing that actually changed; on the root it made every filter change, every pagination click and every re-render a full-surface announcement. The two things that genuinely need announcing already do so locally — the delete-progress list carries `aria-live="polite"` and the read-failure banner carries `role="alert"`.
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
- [`icon-system.md`](icon-system.md) — the Material/lucide boundary this route sits inside, and the two glyphs (`mark_email_unread`, `delete_sweep`) added for it.
- [`carrier-aggregation.md`](carrier-aggregation.md) — the freeze-while-stale precedent the inbox error state follows.
- [`../../dependencies/README.md`](../../dependencies/README.md) — `sms_tool` provenance, patch, rebuild recipe.
