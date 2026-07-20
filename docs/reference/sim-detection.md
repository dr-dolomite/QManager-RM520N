# SIM Detection (Known-SIMs Set)

> QManager needs to tell a **genuinely new SIM card** apart from a SIM it has
> already seen — a watchdog failover swap, a manual slot switch, or a reboot
> on the same card. This is the "known-SIMs" subsystem: a persistent **set**
> of every ICCID the device has encountered, consulted at boot to decide
> whether to fire the "New SIM card detected" banner.

This replaced a single-value scheme (`/etc/qmanager/last_iccid`, one slot of
memory) that could only remember the *immediately previous* ICCID. On a
dual-SIM device that value gets overwritten by every Tier-3 failover and
every manual slot switch, so any swap back to a SIM used two-or-more
swaps ago looked "new" again — a false "New SIM detected" banner even
though the device had used that card before. The set model fixes this at
the root: membership, not last-value-equality, decides "new."

---

## Quick Reference

| Item | Value |
|------|-------|
| Library | `scripts/usr/lib/qmanager/sim_db.sh` |
| Store | `/etc/qmanager/known_iccids` (newline-delimited, persistent UBIFS) |
| Legacy file (migrated once, left in place) | `/etc/qmanager/last_iccid` |
| Admin CGI | `scripts/www/cgi-bin/quecmanager/system/known_sims.sh` |
| Admin UI | `components/system-settings/known-sims-row.tsx` (System Settings page) |
| Consumers | `qmanager_poller` (boot-time detector), `qmanager_watchcat` (Tier-3 failover/revert), `profile_mgr.sh` (`set_active_profile` → `mark_sim_acknowledged`), `cellular/settings.sh` (manual SIM-slot switch) |

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
  actually landed (see below).

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

## Admin CGI — `known_sims.sh`

`GET` (or `POST {"action":"list"}`):

```json
{ "success": true, "count": 3 }
```

`POST {"action":"clear"}`:

Resets the set to contain **only the currently-inserted SIM** (read live via
the canonical `AT+QCCID` pipeline). This is deliberate — clearing "forgets"
every other SIM the device has used, but the SIM sitting in the modem right
now must stay known, or the *next* poller boot would immediately re-fire
"New SIM detected" for the card that's already inserted. If no SIM is
present, the set is emptied entirely. Also drops any stale
`/tmp/qmanager_sim_swap_detected` banner flag so a pending notification for
a SIM the set no longer distinguishes doesn't linger.

```json
{ "success": true, "count": 1 }
```

---

## Frontend — `known-sims-row.tsx`

A self-contained row (own fetch, own loading/clearing state) embedded in the
System Settings page. Shows the remembered-SIM count and a **Clear** button
behind an `AlertDialog` confirm. Not part of any larger settings form — it
survives a parent form remount-on-save independently.

---

## Related

- [connection-watchdog.md](connection-watchdog.md) — Tier-3 SIM failover, the `verify_quimslot` gate, and the `sim_db_add` finalize/revert coupling.
- [sim-profiles.md](sim-profiles.md) — Custom SIM Profiles, ICCID canonicalization in `find_profile_by_iccid`/`auto_apply_profile`, and `set_active_profile`'s `mark_sim_acknowledged` side effect.
- `docs/rm520n-gl-architecture.md` — platform persistence facts (`/etc/qmanager/` is persistent UBIFS, not tmpfs).
