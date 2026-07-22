# WAN Profile Management

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
| HTTP methods | `GET` (list), `POST` (`save` / `toggle`) |
| Profile slots | 6, one per PDP context CID (1-6) |
| Name sidecar file | `/usrdata/qmanager/apn_names.json` |
| Single-APN sidecar file (WS6) | `/usrdata/qmanager/apn_setting.json` |
| Frontend types (6-slot) | `types/wan-profiles.ts` |
| Frontend hook (6-slot) | `hooks/use-wan-profiles.ts` |
| Frontend types (single-APN, page-active) | `types/apn-settings.ts` |
| Frontend hook (single-APN, page-active) | `hooks/use-apn-settings.ts` |
| Frontend components | `components/cellular/settings/apn-management/` (page uses `apn-settings-card.tsx`; `wan-profile-list.tsx`/`wan-profile-edit.tsx` retained but not rendered on the page) |
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

### POST `save`

1. `AT+COPS=2` — deregister from the network (full detach).
2. `AT+CGDCONT=<cid>,"<pdp>","<apn>"` — define APN + PDP type.
3. `AT+QICSGP=<cid>,<ctxtype>,"<apn>","<user>","<pass>",<authtype>` — write auth.
4. Persist the profile name to the sidecar (see below).
5. MTU — logged and ignored (see "MTU" below).
6. `AT+COPS=0` — re-register (automatic operator selection). The next attach carries the new APN in its Attach Request.
7. Re-apply persisted TTL/HL hotspot-bypass iptables rules.

> ℹ️ NOTE: `AT+CGAUTH` is **not supported** on RM520N-GL firmware — it returns
> `ERROR`. Authentication is written through the Quectel-native `AT+QICSGP`,
> which also carries the APN and an IP-stack context type. Because step 3
> rewrites the APN, it must match step 2.

A `cops_recover()` helper defined inside the save branch calls `AT+COPS=0` on
the `cgdcont_failed` and `qicsgp_failed` error paths before `die`, so a
partial save never leaves the modem detached. No buffer sleeps are needed
between steps — `run_at` goes through `qcmd`'s `flock`, which is synchronous
on `OK`/`ERROR`.

### POST `toggle`

`AT+CGACT=<0|1>,<cid>` — activate or deactivate one PDP context. No APN or auth
change.

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
was wrong: `AT+CGACT` can renegotiate *secondary* or *dedicated* bearers, but
it cannot rewrite the default bearer's APN, because cycling the user-plane
does not produce a new Attach Request. Empirically verified on Smart PH on
2026-05-20: with CGACT cycling, `AT+CGCONTRDP=1` kept returning the old
APN/IP until a full `COPS=2`/`COPS=0` cycle forced a fresh attach.

The save flow therefore detaches the radio with `AT+COPS=2`, writes
`AT+CGDCONT` and `AT+QICSGP`, then re-attaches with `AT+COPS=0`. Verified on
hardware: after the new flow, `AT+CGCONTRDP=1` returns a brand-new IP from a
different PGW subnet (e.g. `10.143.59.15` → `10.115.182.156`), proving the
bearer was torn down and rebuilt at the network level rather than just
re-allocated locally.

> ⚠️ WARNING: Save briefly drops the **cellular WAN** while the modem detaches
> and re-attaches (typically ~5-10 seconds). The CGI itself runs on
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

---

## Profile name sidecar

PDP contexts have no native "name" field, so profile names are stored
separately in `/usrdata/qmanager/apn_names.json` — a flat JSON map of
CID to name:

```json
{ "1": "T-Mobile", "2": "IMS", "3": "SOS" }
```

- Written by `apn.sh`, which runs as `www-data`. `/usrdata/qmanager/` is mode
  `0777`, so the CGI can create the file.
- The CGI `chmod 644` the file explicitly so the mode does not depend on the
  process umask.
- A missing file means all profile names are empty — this is **not** an error.
- A failure to persist the name is logged (`qlog_warn`) but does not fail the
  save; the APN/auth write has already succeeded.

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
| `components/cellular/settings/apn-management/apn-settings.tsx` | Page container |
| `components/cellular/settings/apn-management/wan-profile-list.tsx` | Slot list |
| `components/cellular/settings/apn-management/wan-profile-edit.tsx` | Edit form; hides Default Route / IP Passthrough / VLAN controls when `data_source === "at"` |
| `components/cellular/settings/apn-management/mbn-card.tsx` | MBN sub-feature (`AT+QMBNCFG`) — AT-native, unchanged |

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
(`wan-profile-list.tsx`/`wan-profile-edit.tsx`) is **retired from this page**
but not deleted — other code may still reference the components — and the
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
`/usrdata/qmanager/apn_setting.json` — a sibling of `apn_names.json`, same
world-writable directory (`/usrdata/qmanager/` is `0777`), same
lazy-create-on-first-save pattern (no installer seeding needed), same atomic
tmp+mv write with an explicit `chmod 644`:

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
  **lighter** apply runs — `AT+COPS=2` → `AT+CGDCONT=<cid>,"<pdp>","<apn>"` →
  `AT+COPS=0` — deliberately skipping the `AT+QICSGP` auth write and the
  name-sidecar write the legacy save performs, so a single-APN save can never
  blank out a legacy slot's stored auth credentials or profile name. It does
  still re-apply persisted TTL/HL hotspot-bypass rules (parity with the
  legacy path — TTL is orthogonal to APN) and persists to `apn_setting.json`
  as a best-effort step after the modem write succeeds.
- **`action: "deactivate"` is new.** Reverts the target CID to carrier
  default via a blank-APN `AT+CGDCONT` through the same `COPS=2`/`COPS=0`
  cycle, and sets the sidecar's `active` to `0`. A request while already
  `active: 0` is a no-op that never touches the modem (avoids an unnecessary
  WAN drop). No `index`/`cid` is sent — the target CID is read from the
  sidecar — so this action is dispatched **before** the common index/cid
  validation that every other POST action goes through.

Both new POST paths reuse the same `cops_recover()` pattern documented in
[Why save requires a full attach cycle](#why-save-requires-a-full-attach-cycle)
— a partial failure never leaves the modem detached.

---

## Related

- [sim-profiles.md](sim-profiles.md) — Custom SIM Profiles, including the full gate matrix and how the APN field is applied as step 1 of the 4-step apply pipeline.
- [at-command-transport.md](at-command-transport.md) — how AT commands reach the modem (`qcmd`, `atcli_smd11`, `flock`).
- `docs/API-REFERENCE.md` § `/cellular/apn.sh` — full request/response contract.
- `docs/BACKEND.md` — CGI endpoint inventory.
