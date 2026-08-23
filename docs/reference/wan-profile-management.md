# WAN Profile Management

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> WAN Profile Management is the APN editor for the RM520N-GL. It manages the modem's 6 PDP (Packet Data Protocol) contexts — APN, IP-stack type, authentication, and activation state — entirely through AT commands. There is no Casa RDB key-value store and no `wmmd` daemon on this modem, so every profile field is read and written directly via `qcmd`.

Backed by the CGI endpoint `cellular/apn.sh`. The frontend UI lives under
`components/cellular/settings/apn-management/`.

> ℹ️ NOTE: The **APN Settings page** now renders a pixel-strict single-APN
> card ported from RM551E, not the 6-slot list this doc originally described
> as the page UI. The 6-slot backend contract below (`profiles[]`, `toggle`)
> is fully retained — see
> [APN pixel-strict single-APN UI (WS6)](#apn-pixel-strict-single-apn-ui-ws6)
> for what changed and what didn't.

---

## Quick Reference

| Item | Value |
|------|-------|
| CGI endpoint | `scripts/www/cgi-bin/quecmanager/cellular/apn.sh` |
| HTTP methods | `GET` (list), `POST` (`save` / `toggle` / `deactivate`) |
| Shared attach-cycle primitive | `scripts/usr/lib/qmanager/apn_apply.sh` → `/usr/lib/qmanager/apn_apply.sh` |
| APN bracket lock | `/tmp/qmanager_apn_apply.lock` (fd 8) — **not** `qcmd`'s `/tmp/qmanager_at.lock` (fd 9) |
| Profile slots | 6, one per PDP context CID (1-6) |
| Name sidecar file | `/etc/qmanager/apn_names.json` (moved from `/usrdata/qmanager/` — see [Why the sidecars live in `/etc/qmanager`](#why-the-sidecars-live-in-etcqmanager)) |
| Single-APN sidecar file (WS6) | `/etc/qmanager/apn_setting.json` |
| Frontend types (6-slot) | `types/wan-profiles.ts` |
| Frontend hook (6-slot) | `hooks/use-wan-profiles.ts` |
| Frontend types (single-APN, page-active) | `types/apn-settings.ts` |
| Frontend hook (single-APN, page-active) | `hooks/use-apn-settings.ts` |
| Frontend components | `components/cellular/settings/apn-management/` (page renders `apn-settings-card.tsx` + `mbn-card.tsx` + a read-only poller strip; the legacy `wan-profile-list.tsx`/`wan-profile-edit.tsx` are **deleted**) |
| `data_source` | Always `"at"` on RM520N-GL |

A "PDP context" is the modem's record of a data connection — which APN to dial,
which IP stack to negotiate, and which credentials to present. Each context has
a numeric CID (Context Identifier). QManager maps one WAN profile slot to one
CID, so "profile index 1" is "CID 1".

---

## AT command surface

### GET (list) — per CID 1-6

| AT command | Provides |
|------------|----------|
| `AT+CGDCONT?` | `apn`, `pdp_type` (PDP type mapped to `ipv4`/`ipv6`/`ipv4v6`) |
| `AT+CGACT?` | `enabled` — PDP context activation state (state `1` = active) |
| `AT+QICSGP=<cid>` | `auth_type` (`none`/`pap`/`chap`), `username`, `has_password` (boolean) |
| `AT+CGCONTRDP=<cid>` | `ipv4_address`, `ipv4_gateway`, `dns1`, `dns2`, `status_ipv4` — **active contexts only** |

`AT+CGCONTRDP` is queried only for contexts that are currently active. An
inactive or undefined context returns a bare `OK` with no `+CGCONTRDP:` line on
this firmware, so empty output simply means "no runtime data" — it is not an
error.

The Quectel-native `AT+QICSGP` reports the stored password, but `apn.sh` reads
it only to derive the `has_password` boolean. **The password is never emitted
in any response.**

### POST `save` (legacy 6-slot)

Selected when the request body carries an `index` key.

1. `apn_apply_lock` — take the bracket lock **before writing anything** (see
   [The lock lease](#the-lock-lease) below).
2. `AT+QICSGP=<cid>,<ctxtype>,"<apn>","<user>","<pass>",<authtype>` — write auth.
   This must land **before** the detach so the single re-attach carries the new
   credentials.
3. `apn_apply_write <cid> <pdp> <apn>` — the shared write-first attach cycle
   (`AT+CGDCONT` → `AT+COPS=2` → `AT+COPS=0` → `AT+CGCONTRDP` verify).
4. `apn_apply_unlock` — end the lease, then dispatch on the return code.
5. Persist the profile name to the sidecar (see below).
6. MTU — logged and ignored (see "MTU" below).
7. Re-apply persisted TTL/HL hotspot-bypass iptables rules.

> ℹ️ NOTE: `AT+CGAUTH` is **not supported** on RM520N-GL firmware — it returns
> `ERROR`. Authentication is written through the Quectel-native `AT+QICSGP`,
> which also carries the APN and an IP-stack context type. Because step 2
> rewrites the APN, it must match the APN step 3 writes. The shared primitive
> **never** writes `AT+QICSGP`, `AT+CGAUTH`, or `AT+CGACT` — it has no concept
> of auth, and the profile schema carries no auth fields either.

A blank `password` on a PAP/CHAP profile means "keep the stored secret":
`AT+QICSGP`'s password field is mandatory, so `apn.sh` reads the existing value
back with `AT+QICSGP=<cid>` and reuses it rather than wiping it.

The old inline `cops_recover()` helper is gone. It existed because the old
detach-first order could fail with the modem already deregistered; the shared
primitive is **write-first**, so a `qicsgp_failed` or `cgdcont_failed` now
happens with the modem still attached and still registered, and there is nothing
to scramble back from.

### POST `save` (WS6 single-APN)

Selected by the **absence** of `index` (the WS6 contract sends `cid` instead).
Deliberately lighter: `apn_apply_write` only — no `AT+QICSGP` auth write and no
name-sidecar write, so a single-APN save can never blank a legacy slot's stored
credentials or profile name. It does not lease the lock, because it issues no
modem write of its own before the bracket. On success it re-applies persisted
TTL/HL rules and persists the **negotiated** APN (`APN_APPLY_NEGOTIATED_APN`) to
`apn_setting.json`.

### POST `deactivate`

Reverts the stored CID to carrier default via
`apn_apply_write <cid> <pdp> "" 1` — a blank APN with `allow_empty=1`, the
explicit opt-in the primitive requires before it will bracket-cycle an empty
APN. A request while the sidecar already reads `active: 0` is a no-op that never
touches the modem.

### POST `toggle`

`AT+CGACT=<0|1>,<cid>` — activate or deactivate one PDP context. No APN or auth
change.

---

## Parsing `+CGCONTRDP` — `parse_cgcontrdp()` in `cgi_at.sh`

`AT+CGCONTRDP=<cid>` is the only command that reports what the network
**actually granted** for a context — address, gateway and DNS — so `apn.sh`
reads it for every active CID. The shared parser lives in
`scripts/usr/lib/qmanager/cgi_at.sh` and returns five tab-separated fields:

```
<ipv4_addr>\t<ipv4_gateway>\t<dns1>\t<dns2>\t<ipv6_addr>
```

> ⚠️ WARNING: The **arity and the field order are contract.** Callers slice
> them positionally with `cut -f1..5`. Do not widen or reorder without updating
> every consumer.

> ℹ️ NOTE: **`parse_at.sh` has a separate, deliberately different
> `parse_cgcontrdp` — leave it alone.** That is the one `qmanager_poller` uses
> (Tier 2 `t2_apn` / `t2_primary_dns` / `t2_secondary_dns`). It selects the
> first non-IMS record and never classifies by address family at all, so none
> of the defects below apply to it. Do not "harmonise" the two parsers; they
> answer different questions.

### Family is decided by octet count, not by punctuation

3GPP returns an IPv6 address in `+CGCONTRDP` as **16 dotted-decimal octets**,
not colon-hex — verified live on this firmware, which uses the dotted form in
`+CGCONTRDP`, `+CGPADDR` and `+CGDCONT?` alike (colon-hex shows up only in
`+QMAP`). The parser originally split on `addr ~ /:/`, which therefore never
matched. Because the query is per-CID and a dual-stack context emits the IPv6
record **second**, that record fell into the IPv4 branch and overwrote the
address, gateway and both DNS servers wholesale, leaving field 5 empty — which
in turn made `status_ipv6` permanently unable to read `up`.

Classification is now by octet count, with colon-hex kept as a fallback for
firmwares that do emit it:

| Address shape | Family |
|---------------|--------|
| 4 dotted octets | IPv4 |
| 16 dotted octets | IPv6 |
| contains `:` | IPv6 |

The **first** record of each family wins, so a later record can no longer
clobber an earlier one.

### The gateway is sometimes quoted and sometimes bare

The same CID was observed both ways minutes apart on this firmware:

```
+CGCONTRDP: 1,5,"apn","addr",,"dns1","dns2"        <- bare gateway
+CGCONTRDP: 1,5,"apn","addr","gw","dns1","dns2"    <- quoted gateway
```

The parser splits on `"` (`awk -F'"'`), so a quoted gateway shifts every later
field by **two**. The old fixed `$6` / `$8` therefore returned the *gateway* as
`dns1` and dropped `dns2` entirely on any quoted-gateway context. The parser
now counts the quoted tokens instead — they sit on even fields, so `int(NF/2)`
— and picks the offsets from that: five tokens means `apn/addr/gw/dns1/dns2`,
four means the gateway was bare and lives in the separator run at `$5`.

### DNS is family-neutral, the gateway is not

DNS used to be captured only in the IPv4 branch, but the consumer emits plain
`dns1` / `dns2`, not `ipv4_dns1`. On an IPv6-only attach — which the test SIM
currently hands out — that meant **no DNS at all** in the response. DNS is now
taken from whichever record supplies it, first non-empty winning, so a
dual-stack context still prefers the IPv4 record that arrives first.

The gateway stays IPv4-only, because `apn.sh` does emit it as `ipv4_gateway`.

### CR normalisation

Input is piped through `tr '\r' '\n'` before `awk`. Some firmwares glue
successive records with a bare CR instead of CRLF, which would otherwise leave
two records on one `awk` line and hide the second entirely. `parse_at.sh`'s
sibling parser has carried this same normalisation since it was written.

---

## Why save requires a full attach cycle

**Short version:** in EPS (LTE / 5G-NSA), the APN for the default EPS bearer
is locked in at *attach time* as a contract field with the MME (the LTE core's
control-plane gateway) and the PGW (the packet gateway that issues the IP).
`AT+CGDCONT` only updates the modem's local context table; it does not
renegotiate that contract. The network keeps the old APN until the UE
(modem) sends a fresh Attach Request — which only happens after a detach.

An earlier version of `apn.sh` tried to apply APN changes with a per-context
deactivate/reactivate cycle (`AT+CGACT=0,<cid>` → `AT+CGACT=1,<cid>`). That
was wrong: `AT+CGACT` only tears down and rebuilds the modem-side user-plane of
an already-established bearer — the MME keeps the original APN, because cycling
the user-plane produces no new Attach Request. Empirically verified on Smart PH
on 2026-05-20: with CGACT cycling, `AT+CGCONTRDP=1` kept returning the old
APN/IP until a full `COPS=2`/`COPS=0` cycle forced a fresh attach.

The save flow therefore runs a detach/re-attach bracket. Verified on hardware:
after the new flow, `AT+CGCONTRDP=1` returns a brand-new IP from a different PGW
subnet (e.g. `10.143.59.15` → `10.115.182.156`), proving the bearer was torn
down and rebuilt at the network level rather than just re-allocated locally.

### The shared `apn_apply.sh` primitive

That bracket is no longer inlined in `apn.sh`. It lives in
`/usr/lib/qmanager/apn_apply.sh` (source:
`scripts/usr/lib/qmanager/apn_apply.sh`) and is sourced by all three callers —
`cellular/apn.sh` and `profiles/deactivate.sh` as `www-data`, and the
`qmanager_profile_apply` root worker — following the `ttl_state.sh` precedent
for a shared library used from both a CGI and a root context. One
implementation, one set of timings, one return-code contract. Each caller
hard-stops if `apn_apply_write` is not defined after sourcing, rather than
silently falling back to a bracket-less `AT+CGDCONT` write.

The canonical sequence is **write-first**:

```
AT+CGDCONT=<cid>,"<pdp>","<apn>"   sleep 3
AT+COPS=2                          sleep 1     (detach / deregister)
AT+COPS=0                          sleep 3     (re-attach, up to 3 tries, 3s backoff)
AT+CGCONTRDP=<cid>                 poll, 1s interval, 15s ceiling
```

Write-first, not detach-first, so a failed `AT+CGDCONT` returns with the modem
untouched and **still registered** instead of having to recover from an
already-deregistered state. The verify poll figures are tuned to hardware
measurement: the negotiated APN became readable ~1.25s after `AT+COPS=0`
returned `OK`, ~4s worst observed on a live GLOBE SIM — 15s/1s is roughly 10x
headroom over the worst case.

> ℹ️ NOTE: **Verification reads `AT+CGCONTRDP`, never `AT+CGDCONT?`.**
> `AT+CGDCONT?` is the *configured* view — it merely echoes back what was last
> requested, so it matches even when the bearer is stale. `AT+CGCONTRDP=<cid>`
> is the *negotiated* view: what the network actually granted. Comparing against
> the configured view is self-concealing and was the root cause of the profile
> worker's silent-failure bug (see
> [sim-profiles.md](sim-profiles.md#the-apn-step-runs-a-full-attach-cycle)).

APN comparisons **case-fold** (`tr 'A-Z' 'a-z'`) before comparing — APNs are
DNS-style labels and case-insensitive per 3GPP, and a live device negotiated
`INTERNET.GLOBE.COM.PH` in uppercase for a stored `internet`. Only the
comparison folds; every reported and persisted string keeps the original casing
the network returned.

### Return-code contract

`apn_apply_write` sets `APN_APPLY_STATUS`, `APN_APPLY_DETAIL`,
`APN_APPLY_NEGOTIATED_APN`, and `APN_APPLY_RC` on every call, and returns
`APN_APPLY_RC`:

| rc | `APN_APPLY_STATUS` | Modem left | `apn.sh` error code |
|----|--------------------|------------|---------------------|
| 0 | `done` / `done_carrier_default` | Attached, on the requested (or carrier-default) APN | — success |
| 1 | `failed_cgdcont` | Untouched, still registered | `cgdcont_failed` |
| 2 | `failed_detach` | Unchanged (write landed locally, never took effect) | `cops_detach_failed` |
| 3 | `failed_attach` | **DEREGISTERED** — critical | `cops_attach_failed` |
| 4 | `mismatch` | Attached, but not on the requested APN | `apn_mismatch` |
| 5 | `timeout_verify` | Attached, state unconfirmed (may have worked) | `cops_attach_failed` |
| 6 | `skipped_empty_apn` | Unchanged — no AT commands issued | (unreachable: APN is validated non-empty first) |
| 7 | `apn_busy` | Unchanged — no AT commands issued | `apn_busy` |

`apn_mismatch` and `apn_busy` are **new** error codes surfaced to the frontend;
`cgdcont_failed`, `cops_detach_failed`, `cops_attach_failed`, and
`qicsgp_failed` are preserved from the inline implementation. `apn_busy` should
be presented as "try again shortly", not a hard failure — the modem was never
touched.

### The bracket lock

The whole write-detach-attach-verify sequence is serialized by an advisory
`flock` (a "do not disturb" sign on a file — only one process can hold it) at
`/tmp/qmanager_apn_apply.lock`, held on file descriptor 8.

This is deliberately **separate** from `qcmd`'s per-command lock at
`/tmp/qmanager_at.lock` (fd 9). `qcmd`'s lock serializes exactly one AT command;
`AT+COPS` is *global attach state*, so the whole multi-command bracket needs its
own mutex — otherwise `apn.sh` running as `www-data` and `qmanager_profile_apply`
running as root could each run a full bracket concurrently and corrupt each
other's detach/verify window. Reusing `qcmd`'s lock instead would deadlock,
since the bracket calls `qcmd` for every command while holding it. The bracket
lock is always the **outer** of the two, strictly nested, so there is no
deadlock risk.

BusyBox `flock` has no `-w` (timeout) option, so acquisition polls `flock -x -n`
in a 1s loop — the same idiom `qcmd`'s own `flock_wait()` uses. The wait ceiling
is `APN_APPLY_LOCK_WAIT`: **30s** by default for the unattended root worker
(nothing is blocked on it, so it should win the retry), overridden to **5s** by
both CGI endpoints, since a human is waiting on the HTTP response. The override
must be set **before** sourcing the library — the default assignment evaluates
once, guarded by `_APN_APPLY_LOADED`.

### The lock lease

`apn_apply_lock` / `apn_apply_unlock` (flag `APN_APPLY_LOCK_EXTERNAL`) let a
caller take the bracket lock itself and hold it across its own modem write plus
the bracket.

**Any caller whose own modem write must precede the bracket MUST lease.** The
legacy 6-slot save is the one such caller: `AT+QICSGP` has to land before the
detach so the single re-attach carries the new credentials — but `AT+QICSGP`
*also* rewrites the context's APN. Running it outside the lock meant a
subsequent `apn_busy` (rc=7) reported "modem unchanged, no AT commands issued"
*after* the configured APN had already moved with no attach cycle behind it —
reintroducing the exact configured-vs-negotiated split this library exists to
eliminate, through the back door of a partial write. Leasing puts the `QICSGP`
write inside the same critical section, so a busy modem is reported before
anything is written at all.

```sh
apn_apply_lock || die "apn_busy" "..."   # nothing written yet
run_at "AT+QICSGP=..." || die ...        # inside the critical section
apn_apply_write "$cid" "$pdp" "$apn"     # reuses the held lock
apn_apply_unlock
```

Under a lease, rc=7 is unreachable (the lock was already acquired) and
`apn_apply_write` neither acquires nor releases the lock. Leaks are bounded by
process lifetime rather than discipline: the lock lives on fd 8, and the kernel
drops a `flock` when the last file descriptor referencing that open file
description closes — every CGI failure path is `die`, which exits.

Callers that do **not** lease — the WS6 save, `deactivate`,
`profiles/deactivate.sh`, and `qmanager_profile_apply` — are unaffected;
`apn_apply_write` takes and releases the lock itself.

### What the primitive does not do

- **Never writes `AT+QICSGP`, `AT+CGAUTH`, or `AT+CGACT`.** Auth is `apn.sh`'s
  responsibility via `AT+QICSGP`; `AT+CGAUTH` is unsupported on this firmware.
- **Never touches `/tmp/qmanager_recovery_active`.** Whether that flag is raised
  at all is entirely the caller's business, expressed through two optional
  callbacks the primitive feature-detects (`apn_apply_on_bracket_start` /
  `apn_apply_on_bracket_end`). The primitive is **UID-agnostic** and knows
  nothing about the flag — nor about which UID the hook will run as, which is
  not fixed. The CGI callers define neither hook and therefore get no
  suppression — the same behaviour `apn.sh`'s old inline bracket had.

  The flag is a cross-UID hazard for two independent reasons. `/tmp` is mode
  1777 (the *sticky bit* — only a file's owner or root may unlink an entry
  there, whatever the file's own mode), so a cross-UID `rm -f` silently no-ops
  (`-f` exits 0 regardless) and strands the flag "on", permanently muting alert
  dispatch. Separately, `fs.protected_regular=1` refuses a write-open of another
  UID's file in a sticky dir — with **no root override** — so `chmod 0666` is
  not a fix either: mode is not the gate, ownership is.

  > ⚠️ WARNING: an earlier version of this note claimed the flag was "owned
  > exclusively by the root worker". That was never true. `qmanager_profile_apply`
  > runs as **root** when the poller or watchcat spawn it and as **www-data**
  > when `profiles/apply.sh` does (no `sudo`, not setuid, no sudoers entry), so
  > the single-UID assumption broke on the entire UI path. The worker now proves
  > ownership by reading the flag back rather than assuming it — see
  > [tmp-file-ownership.md](tmp-file-ownership.md).
- **Never sources its own dependencies.** The caller must have sourced `qlog.sh`,
  `cgi_at.sh` (for `run_at` / `parse_cgcontrdp_apn`), and `events.sh` (with
  `EVENTS_FILE` and `MAX_EVENTS` set) first — the same convention `ttl_state.sh`
  documents for `platform.sh`. No-op shims are installed for the logging and
  event functions if they are missing.

### Events emitted

The primitive appends to the Recent Activities feed via `append_event`:
`apn_apply_started` (info, before the first AT command),
`apn_apply_done` (info, rc=0), `apn_apply_mismatch` (warning, rc=4), and
`apn_apply_critical` (error, rc=3 — the modem may be left deregistered). These
now fire for CGI-initiated saves too, which is why `apn.sh` sources `events.sh`
where it previously did not.

> ⚠️ WARNING: Save briefly drops the **cellular WAN** while the modem detaches
> and re-attaches — roughly 8-15 seconds end to end (7s of fixed sleeps plus the
> verify poll; ~11s measured for a real apply on hardware). The CGI itself runs on
> lighttpd reached over LAN/Wi-Fi to the modem, so SSH and the QManager
> HTTP session to the modem are **not** dropped — those paths do not ride the
> cellular WAN. The frontend should expect a short cellular reconnect after
> a save and re-poll `AT+CGCONTRDP` once attach completes.

---

## MTU is not writable

There is no reliable per-context MTU write on RM520N-GL AT, and `AT+CGCONTRDP`
on this firmware does not return an MTU field at all.

- `mtu` and `mtu_negotiated` in the GET response are always `null`.
- A non-default `mtu` in a `save` request is logged with `qlog_warn` and
  ignored. It is **never** reported back as a successful write.

The fields exist in `types/wan-profiles.ts` for cross-platform schema parity,
not because the value can be set here.

### The separate `network/mtu.sh` endpoint reads the *live* WAN interface

The interface-level MTU control (**Network → MTU**) is a different endpoint,
`scripts/www/cgi-bin/quecmanager/network/mtu.sh`, and it works on Linux netdevs
rather than PDP contexts. Its `GET` used to hardcode `rmnet_data0`.

**The WAN does not live on a fixed `rmnet_dataN`.** The channel index migrates
across attach cycles — verified live during this work: the modem was attached
on `rmnet_data1` (the only interface `UP`, holding the address and the default
route) while `rmnet_data0` sat `DOWN` with no address but non-zero
`/proc/net/dev` counters, i.e. it had been the WAN earlier in the same boot.
Hardcoding index 0 reported the MTU of a downed interface; it only looked
correct because both happened to read 1500.

`resolve_wan_interface()` now resolves it at request time, most authoritative
first:

1. the default route's device (what traffic actually uses);
2. the first `rmnet_data*` holding a global-scope address;
3. the first `rmnet_data*` with `carrier=1` (the `tower_lock_mgr.sh` idiom);
4. `rmnet_data0` — a degrade-not-fail default that preserves legacy behaviour
   rather than erroring the request.

> ℹ️ NOTE: `detect_active_cid()` cannot be reused here. It resolves a **PDP
> context ID**, and neither `+CGPADDR` nor `+QMAP` carries a Linux interface
> name — there is no CID → interface mapping anywhere in the codebase, and the
> `+QMAP` mux id matching `rmnet_dataN` today is coincidence, not a contract.

The `POST` path is unchanged: it already looped over every `rmnet_data*` and
applied the MTU to all of them.

---

## Profile name sidecar

PDP contexts have no native "name" field, so profile names are stored
separately in `/etc/qmanager/apn_names.json` — a flat JSON map of
CID to name:

```json
{ "1": "T-Mobile", "2": "IMS", "3": "SOS" }
```

- Written by `apn.sh`, which runs as `www-data`. `/etc/qmanager/` is owned
  `www-data:www-data` by the installer's `install_backend()`, so the CGI can
  create the file.
- The CGI `chmod 644` the file explicitly so the mode does not depend on the
  process umask.
- A missing file means all profile names are empty — this is **not** an error.
- A failure to persist the name is logged (`qlog_warn`) but does not fail the
  save; the APN/auth write has already succeeded.

### Why the sidecars live in `/etc/qmanager`

Short version: both sidecars used to live in `/usrdata/qmanager/`, both of
their writers run as `www-data`, and that directory is deliberately locked to
`0755 root:root` — so **every write silently did nothing**.

The mechanism is a Unix rule that surprises people: creating, renaming, or
deleting a file needs write permission on the file's **parent directory**, not
on the file. Think of a filing cabinet — the folder's own lock is irrelevant if
you can't open the drawer. Both sidecars are written with the atomic
`mktemp`-beside-the-target + `mv` pattern, and that `mktemp` is a *create* in
the parent directory, so it failed outright on a directory `www-data` cannot
write.

`/usrdata/qmanager/` is `0755 root:root` on purpose and must stay that way:
`qmanager-console.service` runs as root and executes `ttyd` from a
subdirectory of it, so a writable parent is a root-escalation path (see the
`install -d` table in
[qmanager-independence.md](qmanager-independence.md#-directory-creation-rule-install--d-never-mkdir--p)).
Loosening the directory to fix the sidecars would have traded a persistence bug
for a privilege-escalation bug.

> ℹ️ NOTE: **Both** writers run as `www-data`, including the one whose comments
> call it "the root worker." `cellular/apn.sh` is CGI, and
> `qmanager_profile_apply` is spawned by `profiles/apply.sh` **without**
> `sudo` — it is not setuid and holds no sudoers grant — so on the whole UI
> path it too is `www-data`. Symptoms on the test device: `apn_setting.json`
> never existed at all, and every WS6 save logged "failed to persist".

`/etc/qmanager/` is already `www-data:www-data` (it holds `auth.json`,
`profiles/`, `sim_registry.json`), and `/etc` is persistent UBIFS on this
platform, so the move survives reboots and OTA. Nothing root sources or
executes from `/etc/qmanager/`, so this adds no privilege surface — the
sidecars are inert JSON blobs read only through `jq`.

Fielded devices are moved across by `migrate_apn_sidecars()` in
`install_rm520n.sh`, which runs on every install and OTA:

- Idempotent — no-op when the source is absent or the destination is already a
  regular file, so re-running an install never clobbers newer state. If both
  exist, the stale original is deleted so no later reader can pick it up.
- The temp file is created in the **destination** directory. `/usrdata` and
  `/etc` are separate UBIFS volumes, so a cross-volume `mv` is not an atomic
  `rename(2)` — BusyBox degrades it to copy + unlink and loses crash-atomicity
  on flash.
- Mode and owner are set on the temp file *before* the rename, because BusyBox
  `mktemp` creates `0600 root:root` and `mv` carries both across. Both are
  guarded with `|| true`: the function is called bare from `install_backend()`
  under `set -e`, *after* `stop_services()`, so a bare `chmod` that failed
  would abort a half-torn-down OTA. Degrading is harmless — the file lands
  `0600` and the boot-time `chown -R www-data:www-data /etc/qmanager` in
  `qmanager_setup` hands it to its only reader anyway.
- **The unlink lives inside the rename's success branch**, and the destination
  is type-checked before either.

### Migration guard semantics

The three checks below all defend the same pathological state — a
**directory** sitting at `$dst` — and each is load-bearing on its own:

| Check | Guards against |
|-------|----------------|
| `[ -d "$dst" ]` → warn + `continue` | A directory at the destination. Bail out first, before anything touches `$src`. |
| `[ -f "$dst" ]` (not `-e`) for "already migrated" | `-e` is true for a directory, so the function would conclude "already migrated" and `rm -f "$src"` without ever reading it. |
| `if mv "$tmp" "$dst"; then rm -f "$src"; else …` | `mv file dir` **does not fail** — it moves the file *inside* the directory and returns 0. A bare `mv` with a sibling `rm -f "$src"` therefore unlinks the source while the destination is never written. |

> ℹ️ NOTE: This is a **latent** guard, not a fix for observed loss. Nothing in
> the tree can create a directory at either sidecar path — both writers
> (`cellular/apn.sh`, `qmanager_profile_apply`) only ever `mkdir` the *parent*
> — so the state has almost certainly never occurred in the field. The guard
> exists because the failure is silent and unrecoverable if it ever does.

The general rule worth carrying beyond this function: **an unlink of the last
remaining copy must live inside the success branch of whatever created the new
copy — never as a sibling statement after it.** `mv` is the classic trap here
because its "success" is defined more loosely than the caller usually assumes.

Blast radius, had it fired:

- **`apn_names.json`** — cosmetic. Missing entries fall back to `""`
  (`apn.sh:360-362`), so WAN profile rows render with blank name labels.
  Nothing regenerates the file.
- **`apn_setting.json`** — serious, and non-obvious. See below.

> ⚠️ WARNING: `apn_setting.json` is the **sole** source of truth for "is a
> custom APN active". If it goes missing, `read_setting_json()` returns
> `{"active":0}` — so the UI reports carrier default while the modem is still
> running the custom APN, **and** `action=deactivate` short-circuits at
> `apn.sh:479-483` on `cur_active != 1`, returning `{success:true, active:0}`
> *without touching the modem*. The user presses "revert to carrier default",
> sees success, and nothing happens. `_apn_sidecar_converge()`
> (`qmanager_profile_apply:518`) rebuilds the file, but only on the next
> successful Custom-Profile apply. This is true of any loss of that file, not
> just a migration failure.

> ⚠️ WARNING: The uninstaller's `--purge` still removes
> `$QMANAGER_ROOT/apn_setting.json` and `$QMANAGER_ROOT/apn_names.json` by
> name. **Do not delete that line** because the new location is covered by the
> `rm -rf` of `$CONF_DIR` — a device uninstalled before it ever OTA'd through
> the migration still has the files at the legacy path, and leaving either one
> behind re-strands the final `rmdir /usrdata/qmanager`.

---

## Carrier-provisioned contexts (IMS / SOS)

CIDs 2 and 3 typically ship from the carrier as the IMS (VoLTE) context and the
SOS (emergency) context. `apn.sh` tags these with `apn_type` `"ims"` and
`"emergency"` respectively. The frontend uses this tag to lock those slots
read-only — they must not be edited or toggled.

CIDs 4-6 are usually undefined and are emitted as empty profile slots.

---

## `data_source`

The GET response always includes `"data_source": "at"` on the RM520N-GL. The
field exists so a shared frontend can distinguish this AT-only modem from a
Casa/`wmmd` RDB-backed modem. When `data_source === "at"`, the UI hides
controls that have no AT equivalent: **Default Route**, **IP Passthrough**, and
**VLAN mapping**.

---

## Frontend integration

| File | Role |
|------|------|
| `types/wan-profiles.ts` | `WanProfilesResponse` (carries `data_source`), `WanProfile` (carries `has_password`) |
| `hooks/use-wan-profiles.ts` | Exposes `dataSource`; on the AT path, skips the optimistic-reconcile background fetch because the CGI write is synchronous |
| `components/cellular/settings/apn-management/apn-settings.tsx` | Page container; also owns the read-only "What the network granted" strip fed by `useModemStatus` |
| `components/cellular/settings/apn-management/apn-settings-card.tsx` | The single-APN write surface (WS6 contract) |
| `components/cellular/settings/apn-management/mbn-card.tsx` | MBN sub-feature (`AT+QMBNCFG`) — AT-native backend unchanged; the card was rebuilt (Switch + choice list, sequential `auto_sel` → `apply_profile` save) |

> ℹ️ NOTE: `wan-profile-list.tsx` and `wan-profile-edit.tsx` **no longer exist** — they were deleted once they had zero importers. `types/wan-profiles.ts` and `hooks/use-wan-profiles.ts` remain, and the 6-slot AT machinery in `apn.sh` is untouched, so the legacy contract is still reachable if a future page wants it.

The page's geometry, tone and field shells now come from the shared
`components/cellular/settings/shapes.ts` contract — see
[cellular-settings-family.md](cellular-settings-family.md), which also records
the `detect_active_cid()` confidence gap that constrains how the CID chip is
worded.

---

## APN gating by active SIM Profile

When a Custom SIM Profile is active and its `settings.apn.name` is non-empty,
the APN Management page becomes read-only — the profile owns the APN
configuration for the bound SIM, and the user must edit the profile (not the
APN page) to change it.

- **Gate condition:** active profile exists and `settings.apn.name` is a
  non-empty string. CID, PDP type, or auth settings alone do not trigger the
  gate — only the APN name.
- **UI behavior:** the page renders the standard banner from
  `components/cellular/custom-profiles/profile-override-alert.tsx` and wraps
  the form in `<fieldset disabled>` so every input and the save button are
  inert.
- **Independent of other gates:** this gate fires regardless of whether the
  profile also binds a scenario or TTL/HL — see the gate matrix in
  [sim-profiles.md](sim-profiles.md) for the full picture.

The gate is purely a frontend concern; `cellular/apn.sh` itself does not yet
emit a `profile_managed` error for APN POSTs (unlike `scenarios/activate.sh`).
A power user who bypasses the UI can still write the APN, but the next
profile apply will reconcile back to the profile's value.

---

## APN pixel-strict single-APN UI (WS6)

The APN Settings page (`components/cellular/settings/apn-management/apn-settings.tsx`)
now renders **only** `apn-settings-card.tsx` (+ the MBN card) — a pixel-strict
port of RM551E's single-APN model, matching that build's `use-apn-settings.ts`
contract exactly. The legacy 6-slot list/edit UI
(`wan-profile-list.tsx`/`wan-profile-edit.tsx`) was retired from this page and
has since been **deleted outright** — it had no importers left — while the
backend's 6-slot AT machinery underneath is fully retained (see
[AT command surface](#at-command-surface) above, unchanged).

> ⚠️ WARNING — capability regression, deliberate: this UI change **removes
> per-slot enable/disable and PAP/CHAP auth editing from the APN page**. The
> single-APN model exposes one APN + PDP type + target CID, nothing more. The
> user chose pixel-strict RM551E parity over exposing the additional
> capability RM520N's AT-only backend already supports; the removed controls
> are not deleted code, just unreached from this page.

### The `apn_setting.json` sidecar

A single-APN setting lives in its own flat sidecar,
`/etc/qmanager/apn_setting.json` — a sibling of `apn_names.json`, same
`www-data`-owned directory (see
[Why the sidecars live in `/etc/qmanager`](#why-the-sidecars-live-in-etcqmanager)),
same lazy-create-on-first-save pattern (no installer seeding needed), same
atomic tmp+mv write with an explicit `chmod 644`:

```json
{ "apn": "fast.t-mobile.com", "pdp_type": "ipv4v6", "cid": 1, "active": 1 }
```

A missing or corrupt file reads as `{"active":0}` — treated as "carrier
default, nothing stored" rather than an error.

### `apn.sh`'s additive RM551E contract

`apn.sh`'s `GET` response gained four top-level fields, all derived from AT
reads the endpoint already performs (plus one extra `AT+CGPADDR;+QMAP="WWAN"`
compound round-trip via `cgi_at.sh`'s `detect_active_cid()`); the existing
`profiles[]`/`toggle` output is untouched:

| Field | Meaning |
|-------|---------|
| `active` | `1` = a custom APN is live, `0` = carrier default. Read from the sidecar. |
| `active_cid` | The live WAN-bearing CID, from `detect_active_cid()` (QMAP authoritative, CGPADDR fallback; defaults to `"1"` on a transient read failure — same lenient-degrade posture as the rest of this GET). |
| `internet_cid` | Always equals `active_cid` — kept as a separate field for RM551E schema parity. |
| `apn` | The stored single-APN object (`{apn, pdp_type, cid}`) from the sidecar — pre-fills the form even when `active === 0`. |
| `cids[]` | One tagged entry per CID 1-`MAX_PROFILES`, derived from `profiles_json` with **no extra AT calls**: `{cid, apn, apn_type, is_internet}`. Drives the CID picker's IMS/SOS badges and the "this is the live WAN context" confirmation. |

**`POST` gained two new behaviors, both additive:**

- **`action: "save"` branches on the *absence* of an `index` key.** The
  legacy 6-slot contract always sends `index`; the WS6 single-APN contract
  sends `cid` instead (`{action:"save", apn, pdp_type, cid}`, see
  `ApnSaveRequest` in `types/apn-settings.ts`). When `index` is absent, a
  **lighter** apply runs — a bare `apn_apply_write` bracket, deliberately
  skipping the `AT+QICSGP` auth write and the name-sidecar write the legacy
  save performs, so a single-APN save can never blank out a legacy slot's
  stored auth credentials or profile name. It does still re-apply persisted
  TTL/HL hotspot-bypass rules (parity with the legacy path — TTL is orthogonal
  to APN) and persists to `apn_setting.json` as a best-effort step after the
  modem write succeeds — storing the **negotiated** APN, not the requested one.
- **`action: "deactivate"` is new.** Reverts the target CID to carrier
  default via `apn_apply_write <cid> <pdp> "" 1` (blank APN, `allow_empty=1`)
  and sets the sidecar's `active` to `0`. A request while already
  `active: 0` is a no-op that never touches the modem (avoids an unnecessary
  WAN drop). No `index`/`cid` is sent — the target CID is read from the
  sidecar — so this action is dispatched **before** the common index/cid
  validation that every other POST action goes through.

Neither new POST path leases the bracket lock — neither issues a modem write of
its own ahead of the bracket, so `apn_apply_write` takes and releases the lock
itself. See
[The shared `apn_apply.sh` primitive](#the-shared-apn_applysh-primitive) for the
sequence and [Return-code contract](#return-code-contract) for how each failure
maps to an error code.

---

## Related

- [sim-profiles.md](sim-profiles.md) — Custom SIM Profiles, including the full gate matrix and how the APN field is applied as step 1 of the 4-step apply pipeline.
- [at-command-transport.md](at-command-transport.md) — how AT commands reach the modem (`qcmd`, `atcli_smd11`, `flock`).
- `docs/API-REFERENCE.md` § `/cellular/apn.sh` — full request/response contract.
- `docs/BACKEND.md` — CGI endpoint inventory.
