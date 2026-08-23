# SIM Detection (Known-SIMs Set + SIM Registry)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> QManager answers two separate questions about the SIM in the modem, and it
> uses two separate stores to do it. **"Is this SIM new?"** is answered by the
> known-SIMs **set** (`/etc/qmanager/known_iccids`). **"Should we still be
> showing the New SIM banner for it?"** is answered by the **SIM registry**
> (`/etc/qmanager/sim_registry.json`). The set is the detector; the registry is
> the notification ledger and the metadata sidecar. Neither replaces the other.

The set model came first and is unchanged: a persistent set of every ICCID the
device has encountered, consulted at boot to decide whether a card is a
genuinely new physical SIM or one the device has already used (a watchdog
failover swap, a manual slot switch, a reboot on the same card).

The registry was added on top because dismissal had nowhere durable to live.
The banner's dismiss button used to write to a root-owned `/tmp` file from a
`www-data` CGI — a write that always failed while the endpoint returned
`{"success":true}` anyway — so dismissal was worked around in browser
`localStorage`, which is per-browser and per-device and invisible to the modem.
The registry gives dismissal a real, per-ICCID, reboot-surviving home on the
device, and carries the human-facing metadata (carrier, MSISDN, first-seen
date) that a bare ICCID line in a flat file can't.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Set** — library | `scripts/usr/lib/qmanager/sim_db.sh` |
| **Set** — store | `/etc/qmanager/known_iccids` (newline-delimited bare ICCIDs, persistent UBIFS) — **format frozen, see below** |
| **Set** — legacy file (migrated once, left in place) | `/etc/qmanager/last_iccid` |
| **Set** — admin CGI / UI | `system/known_sims.sh` / `hooks/use-known-sims.ts`, rendered as the **footer of** `components/system-settings/sim-registry-card.tsx` |
| **Registry** — library | `scripts/usr/lib/qmanager/sim_registry.sh` |
| **Registry** — store | `/etc/qmanager/sim_registry.json` (root:root 0644, lazy-created) |
| **Registry** — lock | `/etc/qmanager/sim_registry.lock` |
| **Registry** — root helper | `scripts/usr/bin/qmanager_sim_registry_apply` → `/usr/bin/qmanager_sim_registry_apply` |
| **Registry** — CGI | `scripts/www/cgi-bin/quecmanager/system/sim_registry.sh` |
| **Registry** — hook / types | `hooks/use-sim-registry.ts`, `types/sim-registry.ts` |
| **Registry** — UI | `components/system-settings/sim-registry-card.tsx` ("Tracked SIMs"), `components/monitoring/watchdog/sim-swap-banner.tsx` |
| Transient detection flag | `/tmp/qmanager_sim_swap_detected` (root:root — still written, no longer the visibility gate) |
| Consumers | `qmanager_poller` (detect + seed + refresh + derive `sim_swap.detected`), `qmanager_watchcat` (Tier-3 failover/revert), `profile_mgr.sh`, `cellular/settings.sh` |

---

## Division of responsibility

| Question | Store | Decided by |
|----------|-------|-----------|
| Is this ICCID a SIM the device has seen before? | `known_iccids` (set) | `sim_db_known` — membership |
| What carrier / MSISDN / first-seen date belongs to this ICCID? | `sim_registry.json` | `sim_registry_refresh_active` (poller) |
| Should `status.json.sim_swap.detected` be `true` right now? | `sim_registry.json` | `read_sim_state()` in `qmanager_poller` |
| Did the user silence the banner for this SIM? | `sim_registry.json` (`dismissed`) | `qmanager_sim_registry_apply` via the CGI |

> ℹ️ NOTE: A SIM can be **known** (in the set) and still **alerting** (registry
> `dismissed:false`) — that's the normal state right after a genuine swap, and
> it's exactly why two stores exist. The set stops the banner from re-firing on
> a *future* insertion of the same card; the registry stops it from nagging
> *now*.

---

## The set model

`sim_db.sh` exposes a small API over a flat file:

| Function | Behavior |
|----------|----------|
| `sim_db_seed_if_absent` | First-run migration guard (see below). Returns 0 if prior knowledge existed (file already present, or migrated from `last_iccid`); returns 1 on a truly fresh device with an empty set. |
| `sim_db_known <iccid>` | rc 0 if the normalized ICCID is a member of the set. |
| `sim_db_add <iccid>` | Idempotent add. No-op on empty input. |
| `sim_db_clear_keep <iccid>` | Resets the set to contain **only** the given ICCID — the "clear known SIMs" action. |
| `sim_db_count` | Number of known ICCIDs, always a bare integer (0 if file absent). |
| `sim_db_normalize <raw>` | Strips space/CR/LF only — no trailing-newline. Used for **storage** (byte-parity, see below). |
| `iccid_canonicalize <raw>` | `sim_db_normalize` **plus** strips a single trailing BCD pad `F`/`f`. Used for **comparison** only — see next section. |

A SIM is "new" iff its ICCID (after normalization) is **not** a member of
`known_iccids`. On detection, the ICCID is added immediately so the banner
fires exactly once per SIM, ever — not once per "SIM last seen two swaps
ago."

### ⚠️ The `known_iccids` line format is FROZEN

Membership is tested with `grep -qxF` — a **whole-line, fixed-string** match.
A line is a bare ICCID and nothing else:

```
8963xxxxxxxxxxxxxxx
8952xxxxxxxxxxxxxxxF
```

> ⚠️ WARNING: Do **not** add fields, delimiters, comments, or a header to this
> file. Appending anything to a line (`<iccid>,<carrier>`, `<iccid> <date>`,
> …) makes `grep -qxF "$iccid"` miss, so **every already-known SIM instantly
> looks new** and the banner fires for all of them. All new per-SIM metadata
> belongs in the `sim_registry.json` sidecar, which is keyed by the same
> normalized ICCID. That is the entire reason the registry is a separate file
> instead of an enriched `known_iccids`.

### Migration from `last_iccid`

`sim_db_seed_if_absent()` runs once, the first time any consumer sources the
lib on a device that predates this feature:

- If `known_iccids` already exists → no-op, return 0 (prior knowledge).
- Else if the legacy `/etc/qmanager/last_iccid` is non-empty → seed
  `known_iccids` with that one value, return 0.
- Else → create an empty `known_iccids`, return **1** (fresh device, no prior
  knowledge — callers use this to suppress a spurious "new SIM" toast on a
  device that has genuinely never seen a SIM before, e.g. first boot).

The legacy file is **read, never deleted** — it's small and harmless to
leave behind, and deleting it would remove information if the migration
needs re-verification.

---

## Byte-parity requirement (why `sim_db_normalize` ≠ `iccid_canonicalize`)

Membership in `known_iccids` is a whole-line, fixed-string match
(`grep -qxF`). The **stored key** must be byte-identical to what every other
`AT+QCCID` read site in the codebase produces via the canonical pipeline:

```sh
qcmd 'AT+QCCID' | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r '
```

— a raw ~19-20 character string with no trailing newline. `sim_db_normalize`
reproduces exactly that stripping (space/CR/LF only) so a value written by
one call site and looked up by another always agree byte-for-byte.

Separately, `iccid_canonicalize` exists for **comparing** two ICCIDs that may
have gone through *different* parsing paths — one raw-string reader that
keeps a trailing BCD pad nibble (`F`), and one digits-only extractor that
drops it (an ICCID whose real length is odd is padded to 20 nibbles with a
trailing `F`; the true last character is always a decimal check digit, so a
trailing `F` is always pad and safe to drop for comparison). `profile_mgr.sh`'s
`find_profile_by_iccid` / `auto_apply_profile`, and `qmanager_poller`'s boot
SIM-swap detector, all canonicalize **both operands** before comparing —
but the set itself is always stored and matched via `sim_db_normalize`'s
byte-exact rule. Comparison-time normalization never changes what's written
to disk.

> ⚠️ WARNING: Do not conflate the two. Storing a canonicalized (pad-stripped)
> value in `known_iccids` would silently diverge from every other read site
> that still keeps the pad — `sim_db_add`/`sim_db_known` intentionally use
> `sim_db_normalize`, not `iccid_canonicalize`.

**The registry key follows the same rule.** `sim_registry.json` keys are
`sim_db_normalize` output — pad **kept** — so a registry key and its
`known_iccids` line are byte-identical. `qmanager_sim_registry_apply` and the
CGI both normalize with `sim_db_normalize`, never `iccid_canonicalize`.

---

## The watchcat coupling — why failover slot-cycling must not false-fire

`qmanager_watchcat`'s Tier-3 SIM failover (see
[connection-watchdog.md](connection-watchdog.md)) swaps to a backup SIM
slot, and its fallback path swaps back. Both directions land the modem on a
SIM the device has legitimately used before — that is **not** a physical
swap and must never trigger the "New SIM detected" banner.

The watchdog's old `persist_last_iccid()` helper wrote the landed ICCID to
`last_iccid` so the poller's boot-time detector would treat it as expected.
Under the single-value scheme this worked for one hop, but a failover→revert
cycle (or two failovers in a row) could still leave `last_iccid` pointing at
a SIM the *poller* hadn't itself acknowledged, and any earlier-known SIM
that got cycled back to would look new again.

Under the set model, `qmanager_watchcat` calls `sim_db_add` (via
`sim_db_seed_if_absent` + `sim_db_add`, same two-call pattern as the poller)
at both landing points:

- **Tier-3 finalize** (`finish_cooldown`, on confirmed success) — adds the
  backup SIM's ICCID.
- **`sim_failover_fallback`** (revert to original) — adds the original SIM's
  ICCID, gated behind a `verify_quimslot` read-back confirming the revert
  actually landed.

Because both directions add to a *set* rather than overwrite a single
pointer, a SIM the device has failed over to (or reverted to) before is
permanently known — no false banner, regardless of how many times the
watchdog cycles between slots. This is the load-bearing invariant: **any
code path that intentionally lands the modem on a different SIM must call
`sim_db_add` on the landed ICCID**, or the next boot's detector will treat
that expected transition as a physical swap.

The same pattern is used by:
- `cellular/settings.sh`'s manual SIM-slot switch (POST with `sim_slot`) —
  adds the switched-to ICCID once the switch is `verify_quimslot`-confirmed.
- `profile_mgr.sh`'s `set_active_profile` → `mark_sim_acknowledged` — adds
  the current live ICCID whenever a profile is activated, so binding a
  profile to a freshly-inserted SIM doesn't leave that SIM "unknown" and
  false-fire the banner on the next reboot.

---

## The SIM registry

### Store shape

`/etc/qmanager/sim_registry.json`, `root:root 0644`, lazy-created (it is
**not** an install asset — nothing ships it, the installer's migration or the
first poller write creates it):

```json
{
  "8963xxxxxxxxxxxxxxx": {
    "carrier": "GLOBE",
    "phone_number": "+639544817486",
    "first_seen": "2026-07-27T06:34:00Z",
    "dismissed": false
  }
}
```

| Field | Meaning |
|-------|---------|
| *(key)* | ICCID, `sim_db_normalize`d — byte-parity with `known_iccids`, BCD pad **kept**. |
| `carrier` | Operator name from the poller's Tier 2 carrier parse. `""` until the first Tier 2 cycle fills it. |
| `phone_number` | MSISDN from `AT+CNUM`. **`""` when the carrier never provisioned one** — common on prepaid and M2M SIMs. The UI renders "No number provisioned", never a blank. |
| `first_seen` | ISO-8601 UTC (`date -u +%Y-%m-%dT%H:%M:%SZ`) of the detection that created the record. **`null`** for records backfilled by the installer migration; the UI renders "Added before tracking began". Never fabricate a date. |
| `dismissed` | `true` once the user silences the banner for this SIM. Absent is read as `false` everywhere. |

### `sim_registry.sh` API

Sourced by `qmanager_poller`, by the root helper, and read-only by the CGI.
It **requires `sim_db.sh` to already be sourced** by the caller (it uses
`sim_db_normalize` and deliberately does not source `sim_db.sh` itself, to
avoid fighting the caller's own load-guard ordering). Self-guarded with
`_SIM_REGISTRY_LOADED`.

| Function | Behavior |
|----------|----------|
| `sim_registry_seed_new <iccid> <carrier> <phone>` | Creates/refreshes a record for a **newly detected** SIM: sets carrier, phone, `first_seen=now`, `dismissed=false`. Unconditional — only call it once per genuine detection. |
| `sim_registry_refresh_active <iccid> <carrier> <phone>` | Scoped refresh of **only** `carrier` + `phone_number`. Never touches `dismissed`/`first_seen`. **Change-gated** — exits before the `mktemp`/`mv` when neither value changed, so a steady state costs no write per poll cycle. |
| `sim_registry_set_dismissed <iccid> <true\|false>` | Scoped write of **only** `dismissed`. **Refuses to create a record** — returns **3** for an unknown ICCID. Root-privileged callers only. |
| `sim_registry_clear_keep <iccid>` | Reduces the registry to **only** that ICCID's record, kept **verbatim**. The sidecar half of "clear known SIMs" — see below. Empty ICCID, or one with no record, empties the registry. Never auto-vivifies. Root-privileged callers only. |
| `sim_registry_get_record <iccid>` | Prints the record as compact JSON, or `null`. Read-only, no lock (the atomic `mv` means a reader never sees a torn file). |

Return codes across the write functions: `0` success, `1` write failure,
`2` lock timeout, `3` unknown ICCID (`sim_registry_set_dismissed` only).

#### `sim_registry_clear_keep` — the one sanctioned whole-object rewrite

Every other writer above is a **scoped field write** (see "Why every write is
scoped"). `clear_keep` is the deliberate exception: discarding the other keys
*is* the operation, so a read-modify-write cannot revert anything a concurrent
writer meant to keep. It still runs under the same `flock`, so a poller refresh
cannot interleave with it.

Two properties matter and are easy to get wrong:

- **The kept record is preserved verbatim**, not reseeded. If a user already
  silenced the inserted SIM's banner, forgetting the *other* SIMs must not hand
  that banner back. Reseeding via `sim_registry_seed_new` would set
  `dismissed=false` and do exactly that.
- **It must move in lockstep with `sim_db_clear_keep`.** The set answers "is
  this SIM new", the registry answers "what do we know about it". Clearing one
  without the other is the shipped bug this function exists to fix: the count
  dropped to 1 while "Tracked SIMs" kept listing 2.

### Why every write is scoped

Two different processes write into the **same per-ICCID object**: the poller
(carrier/phone refresh, every Tier 2 cycle) and the root helper
(dismiss/undismiss, on demand). A whole-object read-modify-write would let a
poller refresh that started before a dismissal land after it and silently
revert the user's choice. So every write is a scoped jq field transform —
`.[$iccid].carrier = $carrier`, `.[$iccid].dismissed = $val` — never a
wholesale rewrite.

### Write discipline

Every write is the same four steps:

1. `mktemp "${SIM_REGISTRY_FILE}.XXXXXX"` — **in the same directory** as the
   target, because `mv` is only an atomic `rename(2)` within one filesystem.
   `/tmp` is tmpfs and `/etc` is UBIFS, so a cross-filesystem `mv` would
   degrade to copy+unlink and a concurrent reader could see it half-written.
2. `jq` scoped-field transform into the temp file.
3. `chmod 644` on the temp file — `mktemp` creates `0600`, and chmod-ing
   *after* the rename would leave a window where the live file is root-only
   and the `www-data` CGI can't read it.
4. `mv` over the target.

Never a raw `>` or `>>` on the live path: those follow symlinks and are gated
by the target's mode, not safe against a symlink swap.

### BusyBox-safe locking

Writes serialize on `/etc/qmanager/sim_registry.lock` via fd 9. **BusyBox
`flock` has no `-w`/`--timeout` flag**, so `sim_registry_flock_wait()` polls
`flock -x -n` in a 1-second loop up to a 5-second budget — the same pattern
used by `qcmd`, `qmanager_sms_storage`, and `sms_alerts.sh`. Think of it as
knocking once a second rather than waiting at the door: BusyBox doesn't offer
the "wait up to N seconds" door, so the loop builds it.

### ⚠️ Honest threat model — the registry is NOT tamper-proof against `www-data`

This is stated in `sim_registry.sh`'s own header; keep docs consistent with it.

The root-helper + validation + scoped-write design defends against:

- concurrent-writer races (a poller refresh vs. an on-demand dismiss),
- malformed or hostile **input** reaching `jq` (ICCID validation, `--arg` only),
- bugs in the CGI corrupting unrelated records.

It does **not** defend against a hostile or compromised `www-data` process.
`/etc/qmanager` is owned by `www-data` (pre-existing — the installer does a
`chown -R www-data:www-data` there, and `auth.json`, `profiles/` and others
legitimately need direct `www-data` writes). Directory ownership governs
`unlink`/`rename` regardless of a file's own mode, so `www-data` can delete
`sim_registry.json` and write its own in place, bypassing the helper entirely.
Making that boundary real would mean relocating the registry outside
`/etc/qmanager` — deliberately not attempted. **Do not write anything claiming
this file is tamper-proof against the web user.**

---

## Root helper — `qmanager_sim_registry_apply`

```sh
sudo -n /usr/bin/qmanager_sim_registry_apply <iccid> <dismiss|undismiss|clear_keep>
```

Sudoers grant (`scripts/etc/sudoers.d/qmanager`), a bare-path NOPASSWD line:

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_sim_registry_apply
```

**All validation lives inside the helper**, not in the calling CGI — the
privileged boundary validates its own input rather than trusting the caller:

| Gate | Rule |
|------|------|
| Action | Strict 3-value enum: `dismiss` \| `undismiss` \| `clear_keep`. |
| ICCID present | Required for `dismiss`/`undismiss`. **`clear_keep` alone accepts an empty ICCID** — clearing with no SIM inserted legitimately empties the whole registry, mirroring `sim_db_clear_keep`'s truncate-on-empty. |
| ICCID charset | Digits only, plus `F`/`f`. Anything else → `invalid_charset`. |
| ICCID shape | `F`/`f` may appear **only** as the single trailing pad nibble; strip one trailing `F` and the remainder must be all-digit (rejects e.g. `12F34`). |
| ICCID length | 18–22 characters. |

⚠️ The charset/shape/length gates are gated on `[ -n "$iccid" ]`, **not** on the
action. A non-empty ICCID runs the full gate set whatever the action is; only
the *presence* requirement varies. Per-action validation loosening is precisely
where these helpers grow holes — keep the exemption to presence alone.

The ICCID never reaches a `jq` filter by string interpolation — it always goes
in via `jq --arg` (in `sim_registry.sh`).

Exit codes and their JSON on stdout:

| rc | JSON | Meaning |
|----|------|---------|
| 0 | `{"success":true,"dismissed":true\|false}` or `{"success":true,"cleared":true}` | Applied. |
| 1 | `{"success":false,"error":"invalid_action"\|"empty_iccid"\|"invalid_charset"\|"invalid_length"\|"write_failed", …}` | Rejected input, or the write failed. |
| 2 | `{"success":false,"error":"lock_timeout", …}` | Couldn't take the lock within 5s. |
| 3 | `{"success":false,"error":"unknown_iccid", …}` | No record for that ICCID — **never auto-created**. `clear_keep` never returns 3: an unknown ICCID there simply clears everything. |

---

## CGI contract — `system/sim_registry.sh`

Endpoint: `GET`/`POST /cgi-bin/quecmanager/system/sim_registry.sh`
(installed to `/usrdata/qmanager/www/cgi-bin/quecmanager/system/sim_registry.sh`).

`list` is a **plain read** of the world-readable file — no `sudo`.
`dismiss`/`undismiss` shell out to the root helper.

### `GET` (or `POST {"action":"list"}` — an absent `action` also lists)

```json
{
  "success": true,
  "sims": [
    {
      "iccid": "8963xxxxxxxxxxxxxxx",
      "carrier": "GLOBE",
      "phone_number": "+639544817486",
      "first_seen": "2026-07-27T06:34:00Z",
      "dismissed": false,
      "active": true
    }
  ]
}
```

- `active` is computed by the CGI, not stored: it compares each key against
  `.device.iccid` from `/tmp/qmanager_status.json` (normalized with
  `sim_db_normalize`). **No fresh AT command is issued** — the poller cache is
  the only source.
- Sort order: **active first**, then `first_seen` descending with nulls last
  (a `null` sorts as `""`, then the list is reversed).
- A corrupted registry file degrades to an empty list with a `qlog_warn`,
  rather than hard-failing the whole response through `jq --argjson`.

### `POST {"action":"dismiss"|"undismiss","iccid":"<iccid>"}`

```json
{ "success": true, "dismissed": true }
```

Helper exit codes map to HTTP status (a `Status:` line is emitted **before**
`cgi_headers`, mirroring `auth/login.sh`'s deferred-header pattern — that's
also why `OPTIONS` and the POST body read are handled inline instead of via
`cgi_handle_options` / `cgi_read_post`):

| Condition | Status | Body |
|-----------|--------|------|
| Success | 200 | helper's JSON, passed through verbatim |
| Empty POST body | 400 | `no_body` |
| Missing `iccid` | 400 | `missing_iccid` |
| Unrecognized action | 400 | `invalid_action` |
| Helper rc 3 (unknown ICCID) | 404 | helper's `unknown_iccid` JSON |
| Helper rc 2 (lock timeout) | 503 | helper's `lock_timeout` JSON |
| Helper rc 1 / other | 500 | `apply_failed` |
| Method other than GET/POST/OPTIONS | 405 | `cgi_method_not_allowed` |

The log line deliberately records only the last 4 ICCID digits
(`qlog_info "SIM registry: $action iccid=...<4>"`).

---

## Poller integration (`qmanager_poller`)

### 1. Seeding on detection — `collect_boot_data()`

The seed sits **inside** the existing new-SIM branch, behind the **same**
`_had_prior_sim_db` gate that suppresses the `/tmp` flag on a genuinely fresh
device (no prior known-SIMs set → no bogus first-boot banner, and now no bogus
first-boot record either):

```sh
sim_registry_seed_new "$boot_iccid" "$t2_carrier" "$boot_phone_number"
```

`t2_carrier` is still `""` this early in boot (Tier 2 hasn't run yet); the
Tier 2 refresh backfills it within the first poll cycle.

This is the **only** site that creates a fresh, undismissed record.

### 2. Refresh on the active SIM — `poll_tier2()`

```sh
sim_registry_refresh_active "$boot_iccid" "$t2_carrier" "$boot_phone_number"
```

Change-gated inside the library, so a steady state does not write on every
Tier 2 cycle. It also acts as the **backfill path**: if no record exists yet
(a SIM already in `known_iccids` from before the registry existed and never
touched by the installer migration), `jq` auto-vivifies one with `first_seen`
left `null` and `dismissed` absent — which every reader treats as `false`, but
which can never satisfy the "detected" condition below.

### 3. Deriving `sim_swap.detected` — `read_sim_state()`

The visibility gate is now the **registry record for the current ICCID**, not
the mere existence of `/tmp/qmanager_sim_swap_detected`:

```
detected = record exists for boot_iccid
           AND first_seen is non-empty
           AND dismissed != true
```

The `first_seen` non-empty clause is what keeps a backfilled/migrated record
from ever raising a banner — those SIMs never had a real detection event.

**The emitted `sim_swap` object shape in `status.json` is UNCHANGED**
(`detected`, `matching_profile_id`, `matching_profile_name`); the frontend type
depends on it. `matching_profile_id`/`name` are a one-shot detection-time
artifact, not a durable per-ICCID fact, so they are **not** part of the
registry contract — they are still read from the `/tmp` flag, and only while a
swap is actively flagged as detected.

`/tmp/qmanager_sim_swap_detected` is still **written** at detection time
because `monitoring/watchdog.sh`'s GET handler and `system/known_sims.sh`'s
`clear` action both still read/clear it — it just no longer gates visibility.

### 4. `AT+CNUM` parse fix (real bug, fixed here)

Both `collect_boot_data()` and `poll_tier2()` used to read the MSISDN as:

```sh
num=$(... | cut -d',' -f2 | tr -d '"' | tr -d '\r')
[ -n "$num" ] && boot_phone_number="$num"
```

Two problems, both fixed:

- **The `[ -n "$num" ] &&` guard.** A SIM with no provisioned MSISDN produced
  an empty `num`, so the assignment was skipped and the **previous SIM's phone
  number stayed in place** — the wrong number displayed for the current SIM
  after a swap or failover. The assignment is now unconditional, so a blank
  CNUM correctly yields `""`.
- **`cut -d',' -f2` is fragile.** A carrier-populated alpha field containing
  its own comma shifts which field `cut` lands on. Replaced with a `sed` anchor
  on the trailing `,"<number>",<type>` shape at end of line.

---

## Installer migration — `migrate_sim_registry()`

In `scripts/install_rm520n.sh`, called from `install_backend()` alongside the
other migrations. It seeds one record per existing `known_iccids` line:

```json
{ "<iccid>": { "carrier": "", "phone_number": "", "first_seen": null, "dismissed": true } }
```

- **`dismissed: true` is load-bearing.** Membership in the known set *is* the
  prior acknowledgement — seeding `false` would re-fire the banner for every
  already-known SIM on the first boot after an OTA.
- `carrier`/`phone_number` are `""` (unknown for historical entries; the poller
  fills them in for the active SIM on its next cycle).
- `first_seen` is `null` — there is no recorded add-time for legacy entries.
  Do **not** fabricate one from install time or the file's mtime (mtime is the
  *last* add, not the first).
- **Idempotent via a content check** — the count of `known_iccids` entries with
  no record — **not** an existence gate. It originally gated on
  `[ -f "$target" ] && return 0`; see *Backfill semantics* below for why that
  had to change.
- The temp file is `mktemp /etc/qmanager/.sim_registry.json.XXXXXX` — in the
  destination directory, for the same atomic-`mv` reason as the library.
- `chmod 644` **and** `chown www-data:www-data` **before** the rename. `mv`
  carries owner as well as mode, and the blanket
  `chown -R www-data:www-data "$CONF_DIR"` runs *earlier* in `install_backend()`,
  so a default `root:root` temp would downgrade a live www-data-owned registry
  and break the dismiss CGI's write.
- **No jq regex.** Entware's `jq` on RM520N-GL is built without ONIGURUMA, so
  `gsub`/`test`/`match`/`sub` abort at runtime; line trimming is done by
  `tr -d ' \t\r'` *before* jq. See `docs/rm520n-gl-architecture.md`.

### Backfill semantics

The existence gate was a real defect, not a style choice. The original seed
trimmed with jq's `gsub()`, which **fails on every device** — so the migration
warned and bailed, `sim_registry.json` was later created lazily by
`sim_registry_refresh_active()`'s auto-vivify holding only the **active** SIM,
and the existence gate then made that state permanent: no later install could
ever add the missing SIMs. Symptom: a SIM present in `known_iccids` never appears
in "Tracked SIMs", and `sim_registry_set_dismissed` returns rc 3 (unknown ICCID)
for it because the registry never auto-creates on dismiss.

The migration is now strictly **additive**:

- Records are merged with jq's `+` — a **shallow, right-hand-wins** merge,
  `seed + existing`. An existing record replaces the seeded stub **wholesale**,
  so a genuine detection record (`first_seen` set, `dismissed: false`) and a
  user's dismissal both survive untouched.
- **Never use `*`.** It deep-merges *inside* each record, which would resurrect
  `first_seen`/`dismissed` on a record where the poller deliberately left them
  absent — silently changing banner behaviour.
- If nothing is missing it **writes nothing** — no flash churn, and it avoids
  overlapping a concurrent CGI dismissal write (`stop_services()` stops the
  poller before `install_backend()`, but **lighttpd is never stopped during an
  OTA**). The in-directory rename bounds that race: a concurrent write can be
  lost, never torn.
- A target that exists but does not parse is left **untouched** with a warning —
  losing a user's dismissal state is worse than skipping the backfill.

Backfilled records still carry `first_seen: null`, so the poller's
`first_seen` non-empty clause keeps them from ever raising a banner.

The root helper and the CGI need no installer changes of their own: the helper
is picked up by `install_backend()`'s `scripts/usr/bin/*` loop (installed 755
to `/usr/bin`), and the CGI by the `install_tree` of
`scripts/www/cgi-bin/quecmanager`.

---

## Retired: `dismiss_sim_swap`

`monitoring/watchdog.sh`'s `POST {"action":"dismiss_sim_swap"}` action is
**deleted**. It did `jq '.dismissed = true' > $SIM_SWAP_FLAG` on a root-owned
`/tmp` file while running as `www-data` — the write always failed — and then
returned `{"success":true}` unconditionally. That silent lie is the reason
dismissal was pushed into browser `localStorage` in the first place.

Frontend fallout: `hooks/use-watchdog-settings.ts` no longer exposes
`simSwap` or `dismissSimSwap`, and the `SimSwapInfo` interface is gone from it.
SIM-swap state is read for display through `status.json.sim_swap`
(`useModemStatus`) and mutated through `hooks/use-sim-registry.ts`.

---

## Frontend surfaces

### `components/monitoring/watchdog/sim-swap-banner.tsx`

Mounted once in `AppLayout`, so it outlives any single page — which is why its
strings live in the **`common`** namespace (`sim_swap.*`) rather than a
page-scoped one.

- Visibility is driven **entirely** by the device (`status.json.sim_swap.detected`).
  The `localStorage` dismissal store is gone — one source of truth, and it is
  the modem.
- Shows carrier + MSISDN, falling back to "Unknown carrier" / "No number
  provisioned"; if neither is known it shows the raw ICCID in mono.
- **Exactly one CTA per branch**: "Apply Profile" → `/cellular/custom-profiles`
  when `matching_profile_id` is set, otherwise "Create Profile" →
  `/cellular/custom-profiles?action=create`.
- The `×` opens an `AlertDialog` that spells out the ICCID and states the scope
  is **this SIM only**, not a global mute.
- `optimisticallyHidden` is the only client state: the banner hides immediately
  on a confirmed dismiss (poll cycle is ~2s) and self-clears the moment the
  device reports `detected:false` — so a later un-dismiss from System Settings
  re-shows it without a page reload.

### `components/system-settings/sim-registry-card.tsx` — "Tracked SIMs"

Per-SIM row: carrier, MSISDN (or "No number provisioned"), ICCID + "Added
{date}" / "Added before tracking began", an Active badge on the current SIM,
and an Alerts on / Alerts off badge. The **"Show Alert"** un-dismiss button
renders **only on dismissed rows** — silencing an alert belongs to the alert
itself, so this surface only ever re-enables. Loading / error / empty / data
states are all handled; a failed refresh with existing data shows a stale
notice instead of blanking the list.

**The card also owns Clear** (`CardFooter`: remembered-count + info tooltip on
the left, destructive Clear on the right). It previously lived in a separate
`known-sims-row.tsx` mounted inside the *System Settings* card, which was wrong
on two counts. Cosmetically, a destructive SIM-database action sat on top of
temperature and distance preferences. Functionally, it was the bug: Clear acts
on the **set** while this card renders the **registry**, so with the control on
another card a clear dropped the count 2 → 1 while the list kept showing 2, and
nothing ever refetched. With one owner, a successful clear necessarily calls
`refresh()`, so the two halves cannot drift.

The footer renders when **either** store is non-empty (`knownCount > 0 ||
sims.length > 0`) — if they ever disagree, the reset is exactly what resolves
it, so hiding the control on an empty list would strand the user.

Clear reports honestly: `known_sims.sh` returns `registry_cleared`, and a
`false` (sidecar write failed, or a backend predating the two-store clear)
raises a **warning** toast naming the stale list rather than a success toast.

Strings: `system-settings` namespace, `sim_registry.*` and the reused
`known_sims.*` subtrees, all 5 locales.

### `hooks/use-sim-registry.ts` / `types/sim-registry.ts`

`postSimDismissal(iccid, dismissed)` is exported standalone so the globally
mounted banner can dismiss without pulling the whole registry on every page;
`useSimRegistry()` (fetch-on-mount + refetch-after-mutation, no polling — the
registry only changes on SIM insertion or user action) is what the card uses.
Mutations flip the row optimistically then reconcile with a refetch, so a
rejected write can't leave the UI lying.

### `app/cellular/custom-profiles/page.tsx`

Wrapped in `<Suspense>` — **mandatory**. `CustomProfileComponent` now reads
`useSearchParams()` to honour the banner's `?action=create` deep link, and
without a Suspense boundary Next.js fails the static-export build with a
CSR-bailout error. The deep link is latched once at mount (clears any leftover
edit, scrolls the form into view) so no later re-render can yank the user back
to the form.

### `ModemSubsystemCard` is parked, not deleted

`components/system-settings/system-settings.tsx` has the import and the JSX for
`ModemSubsystemCard` **commented out** to make room for `SimRegistryCard`.
`components/system-settings/modem-subsystem-card.tsx` and
`hooks/use-modem-subsys.ts` remain on disk, untouched, ready to restore.

> ℹ️ NOTE: `modem-subsystem-card.tsx` renders a `CardTitle` of **"System
> Health"** — the filename and the title disagree. This is *not* the separate
> **System Health Check** page, which is unaffected by this change.

---

## Gotchas

- **`known_iccids` line format is frozen.** See the warning above — this is the
  single easiest way to break new-SIM detection for every fielded device.
- **Un-dismissing a migrated record does nothing visible, by design.**
  `POST {"action":"undismiss"}` on a record with `first_seen: null` is a legal,
  successful call — but such a record can never satisfy the "detected"
  condition, so no banner appears. Migrated rows never had a real detection
  event. Do not "fix" this.
- **The registry never auto-creates on dismiss/undismiss.** An unknown ICCID is
  always a 404. Records are created only by a genuine detection
  (`sim_registry_seed_new`), the Tier 2 backfill, or the installer migration.
- **The registry is not tamper-proof against `www-data`.** See the threat model
  above.
- **`sim_registry.sh` does not source `sim_db.sh`.** A new caller must source
  `sim_db.sh` first or `sim_db_normalize` is undefined and every key comes out
  empty.
- **BusyBox `flock` has no `-w`.** Any new lock code here must use the polling
  loop, not `flock -w`.

---

## Related

- [connection-watchdog.md](connection-watchdog.md) — Tier-3 SIM failover, the `verify_quimslot` gate, and the `sim_db_add` finalize/revert coupling.
- [sim-profiles.md](sim-profiles.md) — Custom SIM Profiles, ICCID canonicalization in `find_profile_by_iccid`/`auto_apply_profile`, and `set_active_profile`'s `mark_sim_acknowledged` side effect.
- [qmanager-independence.md](qmanager-independence.md) — installer/OTA internals, sudoers grants, and the `install -d` vs `mkdir -p` directory-mode rule.
- `docs/rm520n-gl-architecture.md` — platform persistence facts (`/etc/qmanager/` is persistent UBIFS, not tmpfs).
