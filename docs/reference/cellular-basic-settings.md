# Cellular Basic Settings

> The `/cellular/settings` surface: six writable modem settings behind one CGI endpoint, a read-only poller-backed readout, and the carrier's AMBR (Aggregate Maximum Bit Rate) limits. This is the page where a user changes SIM slot, radio power, network mode, 5G architecture, roaming policy, and SIM hot-swap detection — every one of which can interrupt the connection the user is reading the page over.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `/cellular/settings` |
| CGI endpoint | `scripts/www/cgi-bin/quecmanager/cellular/settings.sh` (GET + POST) |
| Hook | `hooks/use-cellular-settings.ts` |
| Types | `types/cellular-settings.ts` |
| Components | `components/cellular/settings/**` |
| Geometry/tone contract | `components/cellular/settings/shapes.ts` |
| Poller fields consumed | `.network.carrier`, `.network.sim_slot`, `.network.type`, `.sim` |
| i18n namespace | `cellular` → `core_settings.basic.*` (~69 keys, all five locales) |

### The six writable fields

| Field | AT command | Accepted values | Backend validator |
| ----- | ---------- | --------------- | ----------------- |
| `sim_slot` | `AT+QUIMSLOT=<1\|2>` | `1`, `2` | `invalid_sim_slot` |
| `cfun` | `AT+CFUN=<0\|1\|4>` | `0`, `1`, `4` | `invalid_cfun` |
| `mode_pref` | `AT+QNWPREFCFG="mode_pref",<value>` | `AUTO`, `LTE`, `NR5G`, `WCDMA`, `LTE:NR5G`, `LTE:WCDMA`, `NR5G:LTE:WCDMA` | `invalid_mode_pref` |
| `nr5g_mode` | `AT+QNWPREFCFG="nr5g_disable_mode",<0\|1\|2>` | `0` auto, `1` NSA only, `2` SA only | `invalid_nr5g_mode` |
| `roam_pref` | `AT+QNWPREFCFG="roam_pref",<1\|3\|255>` | `1` home, `3` partner, `255` any | `invalid_roam_pref` |
| `sim_detect` | `AT+QSIMDET=<0\|1>,<insert_level>` | `0`, `1` | `invalid_sim_detect` |

`sim_detect_level` (the `<insert_level>` half of `AT+QSIMDET`) is **read-only**. It is reported in the GET response and preserved on write, but it is deliberately absent from `WRITABLE_SETTING_KEYS`, so it can never enter the dirty set or a POST body.

### GET response shape

```json
{
  "success": true,
  "settings": {
    "sim_slot": 1,
    "cfun": 1,
    "mode_pref": "LTE:NR5G",
    "nr5g_mode": 0,
    "roam_pref": 255,
    "sim_detect": 0,
    "sim_detect_level": 1
  },
  "ambr": {
    "lte": [{ "apn": "internet", "dl_kbps": 200000, "ul_kbps": 100000 }],
    "nr5g": [{ "dnn": "internet", "dl_kbps": 1000000, "ul_kbps": 500000 }]
  }
}
```

The GET issues one compound AT read:

```
AT+QUIMSLOT?;+CFUN?;+QNWPREFCFG="mode_pref";+QNWPREFCFG="nr5g_disable_mode";+QNWPREFCFG="roam_pref";+QNWCFG="lte_ambr";+QNWCFG="nr5g_ambr";+QSIMDET?
```

### POST body and response

POST accepts any subset of the six writable fields. Absent keys are literally unset — the backend reads them with `jq -r 'if has("x") then … else "unset" end'` and skips the corresponding write entirely.

```json
{ "sim_slot": 2, "mode_pref": "LTE:NR5G" }
```

```json
{ "success": false, "applied_fields": ["mode_pref"], "failed_fields": ["sim_slot"] }
```

Partial success is a first-class outcome, not an error case — see [Partial applies](#partial-applies-are-normal).

---

## Why this surface exists in the shape it does

The page is a **decision surface**, not a form. Every one of the six rows changes radio behaviour, and four of them can drop the connection the browser is using. So the UI is built as grouped rows (the Pixel Settings pattern): each row carries a label, a one-sentence **consequence** line, and its control — and no row is allowed to ship without the consequence sentence. That sentence is what turns "Radio Power: [Normal]" into a decision the user can make without guessing.

Nothing on this page reboots the modem. The most disruptive operation, a SIM slot change, is a **radio cycle** (`AT+CFUN=0` → `AT+QUIMSLOT` → `AT+CFUN=1`), which drops the cellular link but leaves the LAN/HTTP path alive — which is why it is safe to run inline inside the CGI request rather than deferred behind a banner the way a real reboot must be.

---

## Invariants

### 1. `mode_pref` must keep all seven values

`ModePref` in `types/cellular-settings.ts` carries all seven strings the CGI's `case` validator accepts, including `WCDMA`, `LTE:WCDMA`, and `NR5G:LTE:WCDMA`, even though the UI's segmented control currently renders only four of them (`AUTO`, `LTE:NR5G`, `NR5G`, `LTE`).

**A control that cannot represent a value the modem reports will mis-write it on the next save.** If the modem is sitting on a value with no matching option, the control renders blank or snaps to a neighbour; the hook then sees a `draft` value that differs from `settings`, marks the row dirty, and the next Save writes a value the user never chose. This already happened once in miniature: the approved comp dropped `LTE:NR5G` from Preferred Network Type and `roam_pref=3` from Roaming, and both were put back during the build precisely because the backend still reports them.

The rule generalises: **every value the backend can report must be representable in the control that reports it.** If you narrow an option list, narrow the validator and the type in the same change — or the surface acquires a silent write bug that only fires on devices already in the dropped state.

> ℹ️ NOTE: The four *visible* options are a product decision (WCDMA-bearing modes are not offered to users). The three invisible values remain in the type and the validator so a modem already on one is reported honestly rather than overwritten.

### 2. `CFUN=0` is "Radio off", never "Low power"

`AT+CFUN=0` is minimum functionality: it powers down the radio **and deselects the SIM**. `AT+CFUN=4` (airplane) turns off RF but keeps the SIM powered. The difference between them is SIM power, not a wattage tier.

The comp labelled `CFUN=0` "Low power" and placed it between Normal and Airplane, which reads as a middle power step. No such state exists on this modem. The label is **Radio off**, for two reasons:

1. It is accurate — the SIM going away is the user-visible consequence, and the row's consequence line says so.
2. **"Low Power Mode" is a removed feature** on this branch (see CLAUDE.md > Removed/Deferred Features). Reusing the name would resurrect a term for something entirely unrelated, in a product where a user searching docs for "low power" must not land here.

### 3. The dirty-state merge rule: a refresh may only update untouched fields

`use-cellular-settings.ts` keeps the server snapshot (`settings`) and the pending patch (`pending`) as **separate state**, and exposes `draft = { ...settings, ...pending }` as the thing the UI renders. Reconciliation happens **during render**, not in an effect (no `setState`-in-effect; React-Compiler safe), and it only ever *prunes* — `prunePending()` drops a staged edit once the server value has caught up with it, and never writes a server value into the patch.

That asymmetry is the whole contract: **nothing the server says can clobber an edit the user has not saved or discarded.**

Two paths used to destroy staged work silently, both by producing a fresh `settings` object that a local `useState` mirror then copied over:

- every save ends with a verification refetch, so a row edited *after* pressing Save was reverted;
- the error banner's **Try again** calls `refresh`, so a user with three staged changes lost all three by retrying a failed *read*.

> ⚠️ WARNING: If you add a field to this surface, add it to `WRITABLE_SETTING_KEYS`. Both the dirty set and `prunePending()` iterate that array — a field missing from it is editable in the UI but invisible to the merge, so it will never count as pending, never be sent, and never be pruned.

### 4. The recovery window keys on *attempted* fields, not applied ones

After a POST, the hook waits before re-reading the modem: 8000 ms if `sim_slot` was attempted, 3000 ms if `cfun` or `mode_pref` was, 0 otherwise (`RECOVERY_MS` in the hook).

The subtlety is that the window is chosen from what was **attempted**, and is therefore fixed before the outcome is known. That is not laziness — it is correctness:

**A rejected slot change disturbs the radio more than a successful one, not less.** On verification failure, `settings.sh` runs the entire `CFUN=0` → `QUIMSLOT` → `CFUN=1` cycle a *second* time before reporting the error. Keying the wait on `applied` gave the worst case — two full radio cycles — a 0 ms window, so the verification refetch read the modem mid-re-registration and fed an incoherent snapshot into `settings` on top of a failed save.

The failure is asymmetric: an unnecessary 8 s wait costs the user nothing, while skipping a needed one corrupts displayed state. **When in doubt, wait.**

### 5. Partial applies are normal

`settings.sh` writes fields one at a time and accumulates two lists, so a POST of three fields can land two. The hook narrows the backend's loose `string[]` lists through `isWritableSettingKey()` into `CellularSettingsApplyResult`, then **clears only the fields that actually landed** — anything rejected stays dirty so the save bar can offer a retry over just those rows.

`fetchSettings()` clears `error` on entry, so a partial-failure message must be re-asserted *after* the verification refetch or the save bar goes quiet about the fields that did not land. The hook does this explicitly; do not remove it.

---

## The ~35 second SIM-slot apply

A slot change is by far the longest operation on this surface. End to end:

| Stage | Cost |
| ----- | ---- |
| `AT+CFUN=0` + `sleep 2` | ~2 s |
| `AT+QUIMSLOT=<n>` + `sleep 2` | ~2 s |
| `AT+CFUN=1` | ~0 s |
| `verify_quimslot()` read-back | up to 10 attempts |
| One full retry of the cycle on read-back mismatch | doubles the above |
| ICCID read + `sim_db_add` + `auto_apply_profile` (verified switch only) | ~1 s+ |
| Client-side settle (`RECOVERY_MS.simSlot`) | 8 s |

The read-back exists because **`AT+QUIMSLOT=N` can return `OK` while the modem silently stays on the old slot** under `qcmd` lock contention. Trusting that `OK` would auto-apply the wrong SIM's profile, so only a *verified* switch fires the downstream side effects (known-SIM registration, profile auto-apply, poller refresh nudge via `touch /tmp/qmanager_tier2_refresh`).

A spinner held for 35 seconds reads as a hang, so `PendingSaveBar` becomes a **step ledger** while applying — three named phases (`writing` → `recovering` → `verifying`) driven by the hook's `applyPhase`, rendered as dots plus a spinner. Never a fill bar: fills are reserved for data visualisation.

Related: [wan-profile-management.md](wan-profile-management.md) (the profile auto-apply this triggers), [sim-detection.md](sim-detection.md) (`sim_db_add` and the SIM-swap banner).

---

## SIM hot-swap detection (`AT+QSIMDET`)

`AT+QSIMDET=<enable>,<insert_level>` tells the modem to watch the SIM detect pin so a card inserted or removed while the modem is running is noticed, rather than going unnoticed until the next reboot.

The write **preserves `insert_level` from a read-back** rather than hardcoding it. `settings.sh` issues `AT+QSIMDET?` immediately before the write, extracts the existing level, and only falls back to `1` when that read comes back empty — so a level someone set outside the UI is never silently reset. `insert_level` is not user-exposed.

The UI renders this row as a **Switch**, not a two-segment pill. It is the one genuinely binary row on the page — a capability you turn on, not a choice between peers. A two-segment pill would have implied the "pick one of these" semantics that SIM 1 / SIM 2 carries.

### Open item: reboot persistence is UNVERIFIED

`AT+QSIMDET` is a Quectel NV (non-volatile memory) setting, and its siblings in the `QNWPREFCFG` family are treated as persistent across reboots. **That is an inference, not a measurement.** The live device reads back the factory default `0,1` — a value that has never been written — so it is no evidence at all that a written value survives.

Verifying requires a write plus a reboot on hardware. Until someone does that, do not document this as persistent.

**Fallback if it turns out not to persist:** seed a `sim_detect.json` in `/etc/qmanager/` and re-apply it at boot, mirroring the `qmanager_auto_update_arm` pattern in [qmanager-independence.md](qmanager-independence.md) — a root helper invoked from the boot path that re-asserts the stored value. Do not reach for that until the persistence question is actually answered; a redundant boot-time write of an already-persistent NV setting is a needless AT command on the shared mutex every boot.

---

## Poller additions

### `+QSIMSTAT?` in the Tier 2 compound

`qmanager_poller` now issues:

```
AT+QTEMP;+COPS?;+QUIMSLOT?;+CNUM;+QSIMSTAT?;+CPIN?
```

**`+QSIMSTAT?` must sit before `+CPIN?`.** `+CPIN?` can return `ERROR` when no SIM is present, and the modem may abort the rest of the compound at that point — which is why `+CPIN?` is last. `+QSIMSTAT?` cannot go last for the same reason, so it takes the slot immediately before it.

`parse_sim_inserted()` in `parse_at.sh` reads `+QSIMSTAT: <enable>,<inserted_status>` and populates `t2_sim_inserted` (`1` inserted, `0` not, `""` unknown).

### The new `.sim` block in `status.json`

```json
"sim": { "status": "ready", "inserted": true }
```

`status` is the `AT+CPIN?` classification from `parse_sim_status()` — one of `ready`, `pin_required`, `puk_required`, `not_inserted`, `error`, `unknown`. These are the exact strings the poller emits; the `SimStatus` union in `types/modem-status.ts` must not acquire synonyms.

`ModemStatus.sim` is **optional**. A device OTA-upgraded from an older poller will not emit the block at all, so every consumer must tolerate `undefined` rather than assuming a card is present. `ModemReportsCard` falls back to the `unknown` tone — never to "Ready".

The tone map (`SIM_STATUS_BADGE` in `shapes.ts`) gives every state its own glyph, because `success-container` and `warning-container` measure 1.03:1 apart and are identical under deuteranopia. `not_inserted` is `muted`, not `destructive` — an empty slot is a configuration, not a fault.

### `network.type` can now legitimately be `""`

The poller used to write `--arg net_type "${network_type:-LTE}"`, so any technology it could not parse — GSM, WCDMA, no service, a failed serving-cell read — was published as `"LTE"`. That made an unparsed reading indistinguishable from a real 4G attach. The fallback is now `""`.

> ⚠️ WARNING: **Any consumer that assumed `network.type` was non-empty is now stale.** `""` means "not determined"; it is not a synonym for LTE. Render it through `networkTypeLabel()` in `types/modem-status.ts`, which maps `""` and anything unrecognised to `"Unknown"` and *cannot* return `"LTE"` — that is the entire reason the helper exists.

This branch is **untestable on the current test device**, which is camped on genuine LTE. The change is a correctness fix reasoned from the code path, not a behaviour observed on hardware.

---

## Backend bug fixes shipped with this surface

Both are in `settings.sh` and both are worth knowing as *classes* of bug, not just as fixed lines.

### NR5G AMBR arithmetic ran before its `-n` guard

The NR5G branch computed `dl_kbps=$((mult_dl * session_dl))` before checking that `session_dl` was non-empty. A short or truncated `+QNWCFG: "nr5g_ambr"` line leaves that variable empty, and `$((mult_dl * ))` is a **shell syntax error** — which the shell prints to stdout, straight into the CGI's JSON response body, producing invalid JSON that the frontend cannot parse. The guard now wraps the arithmetic, mirroring the LTE branch above it.

The general lesson: inside a CGI script, *any* unguarded shell error message is a response-corrupting bug, not just a log line.

### Two `/tmp` scratch files lacked `$$`

`/tmp/qmanager_lte_ambr.tmp` and `/tmp/qmanager_nr5g_ambr.tmp` were fixed filenames, so two concurrent GETs (two browser tabs, or a tab plus a poll) appended into the same file and interleaved their rows. Both are now `…​.tmp.$$` (`$$` is the shell's own PID). Any CGI scratch file must be PID-suffixed — CGI scripts have no concurrency control of their own.

See also [tmp-file-ownership.md](tmp-file-ownership.md) for the cross-UID rules that apply to any `/tmp` file shared between root daemons and `www-data`.

---

## Frontend architecture

```
app/cellular/settings/            route
└─ components/cellular/settings/
   ├─ cellular-settings.tsx       route shell — header, error banner, PAGE_GRID
   ├─ cellular-settings-card.tsx  the write surface (six SettingRows + save bar)
   ├─ setting-row.tsx             label + consequence + control, promotes when dirty
   ├─ segmented-field.tsx         ToggleGroup above the card breakpoint, Select below
   ├─ pending-save-bar.tsx        "N changes pending" → three-step apply ledger
   ├─ modem-reports-card.tsx      read-only poller readout
   ├─ cellular-ambr.tsx           carrier rate limits
   └─ shapes.ts                   geometry + tone contract (all of the above import it)
```

### Two data sources, deliberately separate

`useCellularSettings` owns the writable CGI surface; `useModemStatus` owns the read-only poller snapshot. They run on different clocks — the settings hook re-reads only around a save, the poller ticks continuously — and must not be collapsed into one. The settings page had never consumed the poller snapshot before this change; `ModemReportsCard` is a genuinely new data dependency, not just a new layout.

### `shapes.ts` is the geometry contract

Every consumer, **including the skeletons**, imports its numbers from `shapes.ts`. A skeleton that restates a number has left the contract. This file exists because the surface it replaced had exactly that defect: the loading branch hand-wrote `h-4 w-36` per field, and its skeleton `CardTitle` read "Cellular Basic Settings" while the loaded card read "Modem Radio Settings" — a visible title swap on every load, invisible in review because the two strings sat 46 lines apart.

Read `shapes.ts` itself before touching any geometry or tone on this surface; it carries the radius-role map, the promoted-row tone rule, and several documented cross-pair traps (a role's ink on another role's container) that this surface shipped and then fixed.

> ℹ️ NOTE: **`shapes.ts` is no longer scoped to this page.** It now governs all five routes under `/cellular/settings/` — this one plus APN Management, Network Priority, IMEI Settings and Blocked Networks. A change to any shared export lands on four other surfaces. See [cellular-settings-family.md](cellular-settings-family.md) for the family contract, including the field-shell pair, `RAT_RANK_TONE`, and the `AMBR_EMPTY` → `EMPTY_BLOCK` rename.

### The tone rule: dirty is `primary`, and `primary` is not a status

A row promotes to `bg-primary-container` when it holds an unsaved edit. That promotion is **the brand acting** — a pending edit is an action awaiting commit, which is what `primary` means here. It is not a status; a dirty row is neither "good" nor "warning". No functional role (`success`, `warning`, `destructive`) may ever be used for pendingness.

### `SegmentedField`

A pill group above the card's `@2xl` container breakpoint, a `Select` below it. The Select is **not a degraded fallback** — four segments do not fit one row on a phone, and shrinking them below a 44 px touch target is not an option on a surface field techs use on a tablet. Both controls bind to the same state.

The active fill is a travelling `motion.span` carrying a `layoutId`, so Motion tweens the *box* between positions rather than cross-fading two stacked fills (segments have unequal label widths, so a cross-fade visibly jumps). Two rules ride on that:

- Nothing animates `width`.
- **The `layoutId` must be instance-scoped** (`React.useId()`). This surface renders three segmented controls at once; a module-constant id puts all three thumbs in one layout group and flings them across the card on first paint.

Radix `ToggleGroup` emits `""` when the active item is clicked again. A settings row has no empty state, so the deselect is swallowed (`onValueChange={(next) => next && …}`) rather than allowed to write an invalid value.

---

## i18n

The surface previously had **zero** i18n — every string was a hardcoded English literal. It now carries ~69 keys under `cellular` → `core_settings.basic.*`, in all five locales (en, zh-CN, zh-TW, it, id).

Option labels are built inside the component because they are translated, and the option `value`s remain the modem's own strings, cast back on write. The keys are named after the **field name**, not a friendlier alias — `rows.cfun.*`, not `rows.radio_power.*`. The row's label, consequence, and failed-field lookup all key on the field name, so one alias is enough to make an option set silently resolve to nothing.

See [i18n.md](i18n.md) for the `bun run i18n:check` gate, which exits non-zero on a missing key or empty value.

---

## Related docs

- [at-command-transport.md](at-command-transport.md) — how `qcmd` issues these commands, and **why QManager cannot consume AT URCs** (directly relevant: `AT+QSIMSTAT=1` event mode is unavailable and unsafe here)
- [sim-detection.md](sim-detection.md) — the known-SIMs set and SIM-swap banner that a verified slot switch feeds
- [wan-profile-management.md](wan-profile-management.md) — the APN/profile auto-apply a slot switch triggers
- [tmp-file-ownership.md](tmp-file-ownership.md) — `/tmp` rules for CGI scratch files
- [radio-information.md](radio-information.md) — the `/cellular/` index page, the other consumer of `network.type`
- [dashboard-state-motion.md](dashboard-state-motion.md) — `SaveButton`'s three states and its width lock, used by the save bar
