# Cellular Basic Settings

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

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
| i18n namespace | `cellular` → `core_settings.basic.*` (~95 keys, all five locales) |

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

**On a successful read** — `settings` and `ambr` are both present:

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
  },
  "dual_slot": [
    { "slot": 1, "active": true,  "iccid": "8901260882290051069" },
    { "slot": 2, "active": false, "iccid": "" }
  ]
}
```

`dual_slot` is an **optional sibling** of `settings` and `ambr`, not a member of either. It is present only when the modem answered `AT+QSIMCFG="dual_slot_status"` *and* the response parsed; otherwise the key is **omitted entirely** — never `null`, never a one-element array. Its absence is not a failed read: see [Dual-SIM slot status](#dual-sim-slot-status-atqsimcfgdual_slot_status).

**On a failed read** — no `settings`, no `ambr`, no partial object:

```json
{ "success": false, "error": "read_failed", "message": "Unable to read cellular settings from modem" }
```

The GET issues one compound AT read:

```
AT+QUIMSLOT?;+CFUN?;+QNWPREFCFG="mode_pref";+QNWPREFCFG="nr5g_disable_mode";+QNWPREFCFG="roam_pref";+QNWCFG="lte_ambr";+QNWCFG="nr5g_ambr";+QSIMDET?
```

See [The read contract](#the-read-contract-guard-raw-not-the-fields) for why absence — rather than a defaulted object — is the failure signal.

The GET then issues **one further, separate** read for the dual-slot readout:

```
AT+QSIMCFG="dual_slot_status"
```

> ⚠️ WARNING: Do not "tidy this up" by appending it to the compound above. `qcmd` fails its **entire** compound buffer if any single sub-command errors — the modem stops at the bad one and the transport reports failure for the whole line. `AT+QSIMCFG="dual_slot_status"` is not in the mainstream Quectel AT manual (see [No authoritative field spec exists](#no-authoritative-field-spec-exists)), so a firmware build that rejects it is entirely plausible. Appended to the compound, that rejection would trip the `rc != 0` guard and blank **all six settings plus both AMBR arrays** on a modem that is otherwise perfectly healthy. Isolated in its own call, the same rejection costs exactly one optional field.

This is the general rule for the surface: **a speculative AT read never shares a buffer with a load-bearing one.** Blast radius, not round-trip count, decides where a command goes.

### POST body and response

POST accepts any subset of the six writable fields. Absent keys are literally unset — the backend reads them with `jq -r 'if has("x") then … else "unset" end'` and skips the corresponding write entirely.

```json
{ "sim_slot": 2, "mode_pref": "LTE:NR5G" }
```

Every field applied:

```json
{ "success": true }
```

Some field rejected — `failed_fields` is populated and `success` is `false`:

```json
{
  "success": false,
  "error": "partial_failure",
  "applied_fields": ["mode_pref"],
  "failed_fields": ["sim_slot"]
}
```

A malformed value never reaches the modem at all; the validator returns `{"success": false, "error": "invalid_<field>"}` and writes nothing.

Partial success is a first-class outcome, not an error case — see [Partial applies](#5-partial-applies-are-normal).

---

## Why this surface exists in the shape it does

The page is a **decision surface**, not a form. Every one of the six rows changes radio behaviour, and four of them can drop the connection the browser is using. So the UI is built as grouped rows (the Pixel Settings pattern): each row carries a label, a one-sentence **consequence** line, and its control — and no row is allowed to ship without the consequence sentence. That sentence is what turns "Radio Power: [Normal]" into a decision the user can make without guessing.

Nothing on this page reboots the modem. The most disruptive operation, a SIM slot change, is a **radio cycle** (`AT+CFUN=0` → `AT+QUIMSLOT` → `AT+CFUN=1`), which drops the cellular link but leaves the LAN/HTTP path alive — which is why it is safe to run inline inside the CGI request rather than deferred behind a banner the way a real reboot must be.

---

## The read contract: guard `raw`, not the fields

**Short version: if the modem read fails, the endpoint says so and returns nothing. If the read succeeds but one line is missing, the seeded default stands.** Those are two different failures and they get two different treatments — the distinction is the single most important thing on this page to not "simplify".

### Why the old shape was dangerous

The GET seeds six defaults (`sim_slot="1"`, `cfun="1"`, `mode_pref="AUTO"`, `nr5g_mode="0"`, `roam_pref="255"`, `sim_detect="0"`) and then overwrites each one only when its `grep` finds a line. If the compound AT read itself fails, no `grep` matches anything, so **all six defaults survive and get published as though they were the modem's state** — with `success: true` on top.

That is not theoretical. On a modem genuinely running SIM slot 2, a GET issued during `qcmd` lock contention returned `"sim_slot": 1, "success": true`, and both AMBR arrays came back silently empty. A user looking at that page would have believed the wrong SIM was active.

### The guard

`settings.sh` now captures the transport's exit status and refuses to invent anything:

```sh
raw=$(qcmd 'AT+QUIMSLOT?;…;+QSIMDET?' 2>/dev/null)
rc=$?                                     # MUST be the very next statement
[ -z "$raw" ] && qlog_warn "Compound AT query returned empty response"

if [ $rc -ne 0 ]; then
    cgi_error "read_failed" "Unable to read cellular settings from modem"
    exit 0
fi
```

Two mechanics make this work, both documented in [at-command-transport.md](at-command-transport.md#how-to-detect-a-qcmd-failure):

- **`rc` is the honest signal, not `[ -z "$raw" ]`.** `qcmd` reports failure via exit status and `stderr`; it never puts `ERROR` on `stdout`. (An `-z` test would happen to work here — empty stdout does imply failure — but it is an inference, and it stops being true the moment someone pipes the result through `grep`.)
- **`rc=$?` must be the statement immediately after the assignment.** The `qlog_warn` line sits *after* the capture on purpose: put it first and it clobbers `$?` with the exit status of `[` or of the log call.

### Why the six seeded defaults are RETAINED

> ⚠️ WARNING: Do not "finish the job" by nulling the individual fields. That is the wrong fix, and it is the change a future editor is most likely to make.

Once `rc == 0`, the response is real — the modem answered. If one `grep` then finds nothing, the most likely cause is a **firmware difference**: a build that doesn't implement `+QSIMDET?`, or names a `QNWPREFCFG` key differently. Nulling per-field in that case would propagate `null` into `CellularSettings`, break the controls that render it, and turn a working page into a permanently broken one on that firmware — for a modem that is otherwise perfectly healthy.

So the rule is: **the transport result is guarded; the individual fields are not.** A failed read yields nothing; a partial read yields best-effort values.

---

## Write failures are now actually detected

**Short version: until this change, the POST could not fail. Every rejected write was reported as applied.**

Every write site used this idiom:

```sh
result=$(qcmd "AT+..." 2>/dev/null)
case "$result" in
    *ERROR*) errors="..." ;;   # unreachable
    *)       applied="..." ;;  # always taken
esac
```

`qcmd` writes `ERROR: <code>` to **stderr** and leaves `stdout` empty on failure, so the `*ERROR*` arm could never match — the `2>/dev/null` threw away the only place the word ever appeared. Nine sites were converted to a small helper that reads the exit status instead:

```sh
at_write() {
    _aw_out=$(qcmd "$1" 2>/dev/null)
    _aw_rc=$?
    return $_aw_rc
}
```

(The `_aw_` prefix exists because BusyBox `ash` has no `local`; unprefixed names would clobber caller scope.)

**What this changes for consumers:** the `partial_failure` envelope with a populated `failed_fields` is now genuinely reachable. Before, a modem that rejected `AT+CFUN=4` returned `success: true` with `cfun` in `applied_fields`, and the UI cleared the row as saved. The frontend's partial-failure handling existed all along — it just had no way to fire.

### The `sim_detect` read-failure path

The `AT+QSIMDET?` read that preserves `insert_level` (see [SIM hot-swap detection](#sim-hot-swap-detection-atqsimdet)) had the same defect in reverse: when the read failed, it fell back to `insert_level=1` and wrote it — **silently rewriting a level someone had set outside the UI** to a fabricated value.

It now separates the two cases, exactly as the GET does:

- **Read failed** (`rc != 0`) → record `sim_detect` in `failed_fields` and **skip the write entirely**. Better to not apply the user's toggle than to apply it while stomping an unrelated setting.
- **Read succeeded but no `+QSIMDET:` line** → fall back to `1`. That is the legitimate firmware-difference case.

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

> ℹ️ NOTE: This path was **unreachable in practice** until the backend learned to detect failed writes — see [Write failures are now actually detected](#write-failures-are-now-actually-detected). The frontend code is unchanged; it simply started receiving the envelope it was always written for.

### 6. Absence is the "nothing was read" signal, and it is typed that way

`CellularSettingsResponse.settings` and `.ambr` are **optional** in `types/cellular-settings.ts` — their absence is exactly what a failed read looks like on the wire.

`CellularSettings`, `WritableCellularSettings` and `CellularSettingsPatch` are deliberately **not** nullable. Making the read fields nullable would be the obvious-looking move and it is wrong: `null` would flow into the patch type, `setField` would happily stage it, and the POST would carry `{"sim_slot": null}` — which the backend validator rejects as `invalid_sim_slot`. The uncertainty lives at the envelope boundary, not inside the value types.

The hook enforces the same thing at runtime, because a `success: true` envelope with no payload is a contract violation the types cannot catch:

```ts
if (!data.settings || !data.ambr) {
  // treated as a failed read, not as an empty one
}
```

> ℹ️ NOTE: `dual_slot` is **optional for a different reason** and is deliberately outside that guard — see [Why absence here is NOT a failed read](#why-absence-here-is-not-a-failed-read). Adding it to this condition would break the settings page on every firmware that cannot answer the dual-slot query.

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

The write **preserves `insert_level` from a read-back** rather than hardcoding it. `settings.sh` issues `AT+QSIMDET?` immediately before the write and extracts the existing level, so a level someone set outside the UI is never silently reset. `insert_level` is not user-exposed.

If that read-back *fails*, the write is skipped rather than guessed at — see [The `sim_detect` read-failure path](#the-sim_detect-read-failure-path).

The UI renders this row as a **Switch**, not a two-segment pill. It is the one genuinely binary row on the page — a capability you turn on, not a choice between peers. A two-segment pill would have implied the "pick one of these" semantics that SIM 1 / SIM 2 carries.

### Open item: reboot persistence is UNVERIFIED

`AT+QSIMDET` is a Quectel NV (non-volatile memory) setting, and its siblings in the `QNWPREFCFG` family are treated as persistent across reboots. **That is an inference, not a measurement.** The live device reads back the factory default `0,1` — a value that has never been written — so it is no evidence at all that a written value survives.

Verifying requires a write plus a reboot on hardware. Until someone does that, do not document this as persistent.

**Fallback if it turns out not to persist:** seed a `sim_detect.json` in `/etc/qmanager/` and re-apply it at boot, mirroring the `qmanager_auto_update_arm` pattern in [qmanager-independence.md](qmanager-independence.md) — a root helper invoked from the boot path that re-asserts the stored value. Do not reach for that until the persistence question is actually answered; a redundant boot-time write of an already-persistent NV setting is a needless AT command on the shared mutex every boot.

---

## Dual-SIM slot status (`AT+QSIMCFG="dual_slot_status"`)

**Short version: a read-only row in `ModemHeroCard` that says what is in each of the two physical SIM slots — which one the modem is switched to, and the last four digits of the card sitting in it.** It answers a question the rest of the page cannot: `sim_slot` tells you which slot the modem is *using*, but nothing else on the surface tells you whether the *other* slot even has a card in it.

Nothing here is writable. The slot the modem uses is still changed through `sim_slot` / `AT+QUIMSLOT` like every other field on the page.

### Wire shape

The response carries **12 comma-separated tokens** after the `"dual_slot_status"` tag:

```
+QSIMCFG: "dual_slot_status",<1>,<1>,<3>,<ATR>,<5>,<ICCID>,<1>,<0>,<3>,<ATR>,<5>,<ICCID>
                             └────────── slot 1 ──────────┘└────────── slot 2 ──────────┘
```

Two positional **6-field groups**, slot 1 first, slot 2 second.

> ⚠️ WARNING: **There is no slot-index token in the data.** Slot number is derived purely from position — fields 1–6 are slot 1, fields 7–12 are slot 2. Any parser that looks for a slot number to key on will find one of the unconfirmed fields instead and silently mislabel the pair.

Two fields per group are surfaced, and only those two are confirmed:

| Group index | Meaning | How it was confirmed |
| ----------- | ------- | -------------------- |
| 2 | `active_status` — `1` = the slot the modem is switched to, `0` = standby | Cross-checked live against `AT+QUIMSLOT?` |
| 6 | ICCID (Integrated Circuit Card Identifier — the card's serial number), or empty | Cross-checked live against `AT+QCCID` and the poller's `.device.iccid` |
| 4 | ATR (Answer To Reset — the card's power-on identification string). Recognisable, but not read, not parsed, not surfaced. | — |

### No authoritative field spec exists

> ⚠️ WARNING: State this plainly to anyone extending this parser: **fields 1, 3 and 5 of each group have unconfirmed semantics and are deliberately not exposed.** This sub-command is documented only in Quectel *release-note prose* for this firmware family — there is no field table for it in the mainstream AT command manual. The 12-token layout above is a shape observed on one live RM520N-GL, cross-checked where cross-checking was possible, not a specification.

Field 3 in particular has a plausible-looking reading that **collides with a different, separately documented sub-command** (`AT+QSIMCFG="sim_state"`). Two sub-commands cannot both own that meaning, and guessing which one does would put a wrong label on a user-facing readout. So it stays out.

The rule this follows is the same one the rest of the page follows: **the backend reports what it read and nothing else.** A field whose meaning is a guess is dropped at the CGI boundary rather than shipped with a hedged label — a hedge in the UI is still a claim, and a wrong claim about which SIM is which is exactly the class of error [the read contract](#why-the-old-shape-was-dangerous) exists to prevent.

This is an **open item in the same sense as** [reboot persistence for `sim_detect`](#open-item-reboot-persistence-is-unverified). Settling it needs either a Quectel field table or a second device with a differently-populated slot pair to disambiguate against. Until then, do not add fields 1/3/5 to `DualSlotEntry`.

### Parsing and the absence contract

`settings.sh` guards the read the same way the compound read is guarded — exit status first — and then guards the *shape* as well:

- `rc != 0` or empty output → omit `dual_slot`, log a warning.
- Output present but the token count is not exactly `12` → omit `dual_slot`, log a warning. A short or truncated line is a firmware whose layout differs from the one above, and positional parsing of a differently-shaped line would mislabel every field.
- Any of the four extracted values empty → omit `dual_slot`.

Omission means the JSON key is not emitted at all. The response builder composes it conditionally:

```sh
dual_slot_arg="${dual_slot_json:-null}"
jq -n … --argjson dual_slot "$dual_slot_arg" \
  '(if $dual_slot == null then {} else {dual_slot: $dual_slot} end) as $extra | { … } + $extra'
```

> ℹ️ NOTE: The `null` here is a **shell-side sentinel only** — `--argjson` needs valid JSON to bind, and `null` is the cheapest placeholder. It never reaches the wire; the `if` collapses it to an absent key. A consumer will never see `"dual_slot": null`.

### Why absence here is NOT a failed read

[Invariant 6](#6-absence-is-the-nothing-was-read-signal-and-it-is-typed-that-way) says absence is the "nothing was read" signal — and `dual_slot` uses the same absence encoding for a **different** reason, which is the one thing on this feature easiest to get wrong.

`settings` and `ambr` are absent when the modem *failed to answer a question it can answer*. `dual_slot` is absent when the modem **cannot answer the question at all**. That is a capability fact about the firmware, not a fault, and it must not fail the page. So `use-cellular-settings.ts` sets it **outside** the payload guard:

```ts
if (!data.settings || !data.ambr) {
  // failed read — dual_slot is not consulted here, by design
}
setSettings(data.settings);
setAmbr(data.ambr);
setDualSlot(data.dual_slot ?? null);   // absence is legitimate, not fatal
```

An OTA-upgraded device on older firmware therefore gets a **fully working settings page** — every control, both AMBR blocks, one readout fewer.

`setDualSlot` **writes on every read and never merges.** A modem that stops reporting the slots stops being reported on, rather than the UI holding a stale pair indefinitely.

### Types

`DualSlotEntry` (`types/cellular-settings.ts`) is `{ slot: 1 | 2; active: boolean; iccid: string }`, and `dual_slot?: DualSlotEntry[]` hangs off `CellularSettingsResponse` as a sibling of `settings` / `ambr`.

> ⚠️ WARNING: It is deliberately **not** inside `CellularSettings`, `WritableCellularSettings`, or `WRITABLE_SETTING_KEYS`. That placement is what makes it structurally impossible for a read-only field to enter the dirty set, the patch type, or a POST body — the same precedent `sim_detect_level` set one level up. Moving it "for tidiness" would give the surface a field the UI can stage and the backend validator will reject.

There is no `detected` / `present` flag. **Occupancy is derived as "non-empty `iccid`"**, because inventing a boolean would mean reading one of the unconfirmed fields.

### The UI row

The readout renders as a `ParamRow` labelled **SIM slots** in `ModemHeroCard`'s existing parameters column, behind the same `readoutReady` gate as Active SIM Slot and Radio Power — `dualSlot` arrives on the settings-GET clock, identical to `saved`, so the two slot readouts can never disagree because one was read later.

**The row is omitted entirely when `dualSlot` is `null` or empty** — no placeholder, no "Unknown". The hero's existing `readout.unknown` branch is for a field the modem is *always asked for* and may fail to answer once; "this firmware does not implement the query" is a different statement, and rendering it as an unknown *value* would imply a fact was missing when no fact was ever available.

Both slots always render when the row renders. Showing only the active one would leave the other ambiguous between "empty" and "not read", which is the entire reason the row exists.

#### Tone: `SLOT_CHIP` and `SLOT_GLYPH`

Two new exports in `components/cellular/settings/shapes.ts`. The active slot is a **filled `bg-primary` chip** with a `check_circle` glyph; every other slot is **plain inline text** with `sim_card` (card present, standby) or `sim_card_alert` (no card). All three glyphs are already in the font subset.

> ⚠️ WARNING: This is **not** a status Badge and must never become one. "The modem is switched to this slot" is not a health claim — a standby SIM is not degraded and an empty second slot is a configuration, not a fault — so `success` and `muted` are both wrong roles here. The correct sibling pattern is `GOVERNING_MARK` one row up: shape, glyph and fill move **together**, so the operative peer survives grayscale and deuteranopia without borrowing a functional colour.

`bg-primary` rather than a container fill because the chip sits on `HERO_PARAMS.ROW` (`surface-container-high`), and a container on a container is the step collision `HERO_PARAMS` already documents. The fill pair declares its own ink, so consumers set none.

#### ICCID masking is a product decision

ICCIDs render as `•••1069` — the last four digits only. **The full number was considered and rejected.** Four digits is enough to tell two cards apart, which is the only question a glance readout answers.

The masking lives in a local `maskIccid()` helper **in the component, not the CGI**: the backend reports the fact it read, and how much of it a given surface shows is a display decision. Tracked SIMs shows more. The tail is `font-mono tabular-nums` — a raw device-emitted identifier is machine voice (DESIGN.md's Machine-Voice Rule), and the tabular figures keep two slots' tails aligned.

Visible text stays terse (`SIM 1 •••1069`), so each chip carries an `aria-label` that restates the whole fact as a sentence: *"SIM 1, active, card ending 1069"* rather than a stream of bullets.

### Relationship to SIM detection

This readout and [sim-detection.md](sim-detection.md) both handle ICCIDs, and they are **not the same feature**:

| | Dual-slot readout (here) | SIM detection |
| --- | --- | --- |
| Source | `AT+QSIMCFG="dual_slot_status"`, read per settings GET | ICCID captured on a *verified* slot switch, plus the poller |
| Storage | None — never persisted | `/etc/qmanager/sim_registry.json` (`known_iccids`) |
| Question | "What is in each slot **right now**?" | "Have we **seen this card before**, and did it change?" |
| Surfaces | One hero row on `/cellular/settings` | The SIM-swap banner, Tracked SIMs |

Neither feeds the other. If you are changing how a known SIM is recognised or how the swap banner fires, that is `sim-detection.md`; this row is a live readout with no memory.

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

`ModemStatus.sim` is **optional**. A device OTA-upgraded from an older poller will not emit the block at all, so every consumer must tolerate `undefined` rather than assuming a card is present. `ModemHeroCard` falls back to the `unknown` tone — never to "Ready".

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
   ├─ cellular-settings.tsx       route shell — header, error banner, the card
   │                              cascade, and the SHARED save bar + footer
   ├─ modem-hero-card.tsx         the read-only hero above the write cards:
   │                              four stat tiles (Radio Information's
   │                              summary-tile anatomy) over a connection rail
   │                              (active APN + rate limits). Also owns the
   │                              SIM-slots row: `SlotChip` + `maskIccid()`,
   │                              both local to this file
   │                              (props: `status`, `networkType`, `isStale`,
   │                              `saved`, `dualSlot`)
   ├─ cellular-settings-card.tsx  the write surface, split into two section
   │                              cards ("SIM & Radio Power", "Network Mode &
   │                              Roaming") — three SettingRows each
   ├─ setting-row.tsx             label + consequence + control, promotes when dirty
   ├─ segmented-field.tsx         ToggleGroup above the card breakpoint, Select below
   ├─ pending-save-bar.tsx        "N changes pending" → three-step apply ledger
   └─ shapes.ts                   geometry + tone contract (all of the above import it)
                                  — incl. SLOT_CHIP / SLOT_GLYPH for the
                                  SIM-slots row
```

`ModemHeroCard`'s props, and where each comes from:

| Prop | Source | Absence means |
| ---- | ------ | ------------- |
| `status` | `useModemStatus` (poller) | Poller snapshot not yet read |
| `networkType` | `useModemStatus` | `""` is "not determined" — never LTE |
| `isStale` | `useModemStatus` | — |
| `saved` | `useCellularSettings.settings` | Settings GET has not succeeded yet |
| `dualSlot` | `useCellularSettings.dualSlot` | `null` — the modem **cannot** report the slots. Row omitted; card otherwise complete |

### Two data sources, deliberately separate

`useCellularSettings` owns the writable CGI surface; `useModemStatus` owns the read-only poller snapshot. They run on different clocks — the settings hook re-reads only around a save, the poller ticks continuously — and must not be collapsed into one. The settings page had never consumed the poller snapshot before this change; `ModemHeroCard` is a genuinely new data dependency, not just a new layout. The hero's two halves load independently: the readout half keys off the poller clock, the rate-limits half off the settings GET, and each shows its own skeleton rather than making the other wait.

### The three read states of the write card

`cellular-settings-card.tsx` branches on three distinct conditions, in this order:

| Condition | Renders |
| --------- | ------- |
| `!isLoading && !settings && error` | **Never read** — the card title plus a single notice line (`core_settings.basic.cards.unread`), no controls |
| `isLoading \|\| !draft \|\| !settings` | Skeleton |
| otherwise | The loaded rows |

The never-read branch exists because that state used to have no home: the card fell into the skeleton branch and **shimmered forever**, presenting a permanent "loading" that would never resolve. Controls are withheld rather than disabled — there is no snapshot to diff a change against, so a control here could only fabricate one.

Crucially, **a *later* failure does not reach this branch.** The hook leaves the previous snapshot in place when a refresh fails, so the card keeps rendering real values and the page-level banner carries the "these may be stale" message. Showing last-known-good data with a staleness warning beats blanking a page the user was mid-task on.

The notice line uses `CARD_NOTICE` from `shapes.ts`, composed as `` `${SETTING_ROW.ROOT} ${SETTING_ROW.CONSEQUENCE}` `` — the empty state borrows the *row's* type scale and inset so it sits where a row would, rather than introducing a fourth text treatment to the surface.

### `refresh` must be a wrapper, never the bare fetcher

```ts
const refresh = useCallback(() => {
  void fetchSettings(false);
}, [fetchSettings]);
```

`fetchSettings(silent = false)` was previously exported directly as `refresh`. Both call sites pass it as a bare handler (`onClick={form.refresh}`), so React handed it a `MouseEvent` as the `silent` argument — and a `MouseEvent` is truthy. **Try again** and **Re-read from modem** therefore both ran in silent mode by accident: no spinner, no loading feedback, a button that looked inert while working.

This is a general trap, not a one-off. Any function with an optional leading boolean is unsafe to hand straight to `onClick`; wrap it.

### `shapes.ts` is the geometry contract

Every consumer, **including the skeletons**, imports its numbers from `shapes.ts`. A skeleton that restates a number has left the contract. This file exists because the surface it replaced had exactly that defect: the loading branch hand-wrote `h-4 w-36` per field, and its skeleton `CardTitle` read "Cellular Basic Settings" while the loaded card read "Modem Radio Settings" — a visible title swap on every load, invisible in review because the two strings sat 46 lines apart.

Read `shapes.ts` itself before touching any geometry or tone on this surface; it carries the radius-role map, the promoted-row tone rule, and several documented cross-pair traps (a role's ink on another role's container) that this surface shipped and then fixed.

> ℹ️ NOTE: **`shapes.ts` is no longer scoped to this page.** It now governs all five routes under `/cellular/settings/` — this one plus APN Management, Network Priority, IMEI Settings and Blocked Networks. A change to any shared export lands on four other surfaces. See [cellular-settings-family.md](cellular-settings-family.md) for the family contract, including the field-shell pair, `RAT_RANK_TONE`, and the `AMBR_EMPTY` → `EMPTY_BLOCK` rename.

### The tone rule: dirty is `primary`, and `primary` is not a status

A row promotes to `bg-primary-container` when it holds an unsaved edit. That promotion is **the brand acting** — a pending edit is an action awaiting commit, which is what `primary` means here. It is not a status; a dirty row is neither "good" nor "warning". No functional role (`success`, `warning`, `destructive`) may ever be used for pendingness.

### `SegmentedField`

A pill group above the card's container breakpoint, a `Select` below it. The Select is **not a degraded fallback** — four segments do not fit one row on a phone, and shrinking them below a 44 px touch target is not an option on a surface field techs use on a tablet. Both controls bind to the same state.

The breakpoint is a parameter now (`segmentedBreakpoint()` in `shapes.ts`): the family default is `2xl`, while the basic settings page's two half-width section cards pass `breakpoint="lg"` so the pill group survives where it already fits — at the family default a ~600 px card would silently fall back to a `Select` on desktop widths where the old single card showed the group.

**The breakpoint classes must stay LITERAL strings.** Tailwind's scanner only compiles class names it finds verbatim in source; a template string like `` @${step}/card:flex `` produces no rule. That shipped once and every SegmentedField in the family silently rendered only its Select at every width — if a step is added to the map in `shapes.ts`, spell its four classes out, never interpolate.

The active fill is a travelling `motion.span` carrying a `layoutId`, so Motion tweens the *box* between positions rather than cross-fading two stacked fills (segments have unequal label widths, so a cross-fade visibly jumps). Two rules ride on that:

- Nothing animates `width`.
- **The `layoutId` must be instance-scoped** (`React.useId()`). This surface renders six segmented controls at once (three per section card); a module-constant id puts all thumbs in one layout group and flings them across the card on first paint.

Radix `ToggleGroup` emits `""` when the active item is clicked again. A settings row has no empty state, so the deselect is swallowed (`onValueChange={(next) => next && …}`) rather than allowed to write an invalid value.

---

## i18n

The surface previously had **zero** i18n — every string was a hardcoded English literal. It now carries ~95 keys under `cellular` → `core_settings.basic.*`, in all five locales (en, zh-CN, zh-TW, it, id) — including `core_settings.basic.cards.unread`, the never-read notice.

The SIM-slots row added five of them, under `core_settings.basic.sim_slots.*`:

| Key | Used for |
| --- | -------- |
| `label` | The `ParamRow` label ("SIM slots") |
| `empty` | Visible text for a slot with no ICCID |
| `sr_active` | `aria-label` — `"SIM {{slot}}, active, card ending {{last4}}"` |
| `sr_standby` | `aria-label` — card present, not selected |
| `sr_empty` | `aria-label` — `"SIM {{slot}}, no card detected"` |

The slot number itself reuses the existing `core_settings.basic.readout.slot_n` (`"SIM {{slot}}"`) rather than adding a sixth key — the hero already renders that phrase for Active SIM Slot, and two independently translated spellings of "SIM 1" on one card is exactly the drift the shared key prevents.

Option labels are built inside the component because they are translated, and the option `value`s remain the modem's own strings, cast back on write. The keys are named after the **field name**, not a friendlier alias — `rows.cfun.*`, not `rows.radio_power.*`. The row's label, consequence, and failed-field lookup all key on the field name, so one alias is enough to make an option set silently resolve to nothing.

See [i18n.md](i18n.md) for the `bun run i18n:check` gate, which exits non-zero on a missing key or empty value.

---

## Related docs

- [at-command-transport.md](at-command-transport.md) — how `qcmd` issues these commands, and **why QManager cannot consume AT URCs** (directly relevant: `AT+QSIMSTAT=1` event mode is unavailable and unsafe here)
- [sim-detection.md](sim-detection.md) — the known-SIMs set and SIM-swap banner that a verified slot switch feeds. **Not the same feature as the hero's dual-slot readout** — see [Relationship to SIM detection](#relationship-to-sim-detection) for why ICCIDs appear in both places
- [wan-profile-management.md](wan-profile-management.md) — the APN/profile auto-apply a slot switch triggers
- [tmp-file-ownership.md](tmp-file-ownership.md) — `/tmp` rules for CGI scratch files
- [radio-information.md](radio-information.md) — the `/cellular/` index page, the other consumer of `network.type`
- [dashboard-state-motion.md](dashboard-state-motion.md) — `SaveButton`'s three states and its width lock, used by the save bar
