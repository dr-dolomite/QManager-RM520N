# Custom SIM Profiles

> A Custom SIM Profile is a saved bundle of modem configuration — APN, TTL/HL,
> optional IMEI, and (since the binding feature) an optional Connection
> Scenario — that is tied to a SIM by ICCID. When the modem detects that SIM,
> the bound profile is applied automatically; the user can also apply manually.
> Profiles are owned by `profile_mgr.sh` (library) and applied by the
> `qmanager_profile_apply` daemon.

This doc covers the profile data model, the apply pipeline, and how an active
profile gates other parts of the UI. Auto-apply on ICCID match is covered in
`../ARCHITECTURE.md` § Custom SIM Profiles and `../rm520n-gl-architecture.md`
§ Custom SIM Profiles — Auto-Apply on ICCID Match — those describe the trigger
points (boot, SIM switch, watchdog) and are still current.

---

## Quick Reference

| Item | Value |
|------|-------|
| Profile storage | `/etc/qmanager/profiles/p_<timestamp>_<hex>.json` (max 10) |
| Active marker | `/etc/qmanager/active_profile` (plain text — profile ID) |
| Library | `scripts/usr/lib/qmanager/profile_mgr.sh` |
| Apply daemon | `scripts/usr/bin/qmanager_profile_apply` |
| Apply state file | `/tmp/qmanager_profile_state.json` |
| Apply PID lock | `/tmp/qmanager_profile_apply.pid` |
| CGI endpoints | `scripts/www/cgi-bin/quecmanager/profiles/*.sh` |
| Frontend hook | `hooks/use-sim-profiles.ts` |
| Frontend types | `types/sim-profile.ts` |
| Frontend page | `app/cellular/custom-profiles/` |
| Apply steps | 4: `apn` → `ttl_hl` → `scenario` → `imei` |

---

## Profile JSON schema

```json
{
  "id": "p_1715000000_abc12",
  "name": "T-Mobile Gaming",
  "mno": "T-Mobile",
  "sim_iccid": "8901260...",
  "created_at": 1715000000,
  "updated_at": 1715000000,
  "settings": {
    "apn": { "cid": 1, "name": "fast.t-mobile.com", "pdp_type": "IPV4V6" },
    "imei": "",
    "ttl": 65,
    "hl": 65,
    "scenario_id": "gaming"
  }
}
```

### `settings.scenario_id`

The `scenario_id` field is the profile's optional binding to a Connection
Scenario. It encodes a **reference**, not a copy.

| Value | Meaning |
|-------|---------|
| `""` (empty) | No binding. The scenario step is skipped at apply time. |
| `"balanced"` / `"gaming"` / `"streaming"` | Built-in scenario. `scenario_apply` resolves the mode (`AUTO` / `NR5G` / `LTE:NR5G`) and sends `AT+QNWPREFCFG="mode_pref",<mode>`. Built-ins never carry band locks — the user controls those via the Band Locking page when no profile is bound. |
| `"custom-<timestamp>"` | Custom scenario stored at `/etc/qmanager/scenarios/<id>.json`. The apply step looks up the JSON, reads `mode_pref` and the optional `lte_bands` / `nsa_nr_bands` / `nr5g_band` strings, and applies them. |

> ℹ️ NOTE: Because `scenario_id` is a reference, **editing the referenced
> scenario later changes what gets applied on the next profile activation**.
> Deleting the referenced custom scenario leaves a dangling reference — the
> apply step marks the scenario step `skipped` with detail
> `"Scenario <id> no longer exists"` and the frontend dropdown shows
> `(missing — please re-select)`.

`profile_save` validates `scenario_id` against the same enum: empty, the three
built-in names, or a `custom-*` ID that exists on disk. Anything else is
rejected.

---

## Apply pipeline (4 steps)

`qmanager_profile_apply <profile_id>` runs the four steps below in order.
Order is load-bearing — see the rationale notes inline.

| # | Step | What it does |
|---|------|--------------|
| 1 | `apn` | Compare `settings.apn` vs. current PDP context. If different, rewrite via `AT+CGDCONT` (and the full attach cycle for the default bearer — see [wan-profile-management.md](wan-profile-management.md)). |
| 2 | `ttl_hl` | Compare `settings.ttl` / `settings.hl` vs. the persisted iptables state, then apply via `ttl_state_apply` if drifted. |
| 3 | `scenario` | If `settings.scenario_id` is set, resolve it (built-in or custom) and call `scenario_apply` from `scenario_mgr.sh`. Persists the result to `/etc/qmanager/active_scenario`. |
| 4 | `imei` | If `settings.imei` is set and differs from `AT+EGMR=0,7`, write the new IMEI via `AT+EGMR=1,7` and trigger a soft reboot (`AT+CFUN=1,1`). |

### Why scenario MUST come before IMEI

`AT+CFUN=1,1` reboots the modem's radio stack. Anything written via
`AT+QNWPREFCFG` (mode preference, band locks) gets re-read from NV after the
reboot, so if the scenario step ran *after* IMEI, the apply pipeline would
return success while leaving the radio in its pre-apply mode. Putting
`scenario` before `imei` guarantees the radio config is in place before the
reboot — when the modem comes back up, the new mode/bands are already
persisted in NV and survive the restart.

The step order is enforced in `qmanager_profile_apply` (`STEP_NAMES="apn ttl_hl scenario imei"`).

### Step status values

Each step in `/tmp/qmanager_profile_state.json` reports one of:

| Status | Meaning |
|--------|---------|
| `pending` | Not started yet |
| `running` | In progress (detail describes sub-state) |
| `done` | Completed successfully |
| `skipped` | Nothing to do (e.g. value matches current modem state, or `scenario_id` is empty) |
| `failed` | Step failed; `detail` carries the reason |

A dangling `scenario_id` produces `skipped` with detail
`"Scenario <id> no longer exists"`. A partial band-lock failure on a custom
scenario produces `failed` with detail
`"Partial: band lock failed for: <fields>"` — the scenario is still marked
active because `mode_pref` succeeded; only the supplementary band locks
failed.

---

## Gate matrix

When a profile is active, certain UI pages become read-only so the user can't
desync the modem from the profile. The gate is decided per field, not
globally — a profile that only sets APN gates only the APN page.

| Active profile field | What it gates | UI behavior |
|----------------------|---------------|-------------|
| `settings.apn.name` non-empty | APN Management page | Banner + `<fieldset disabled>` over the form |
| `settings.ttl > 0` or `settings.hl > 0` | TTL/HL Settings card (existing — predates the scenario feature) | Banner + disabled inputs |
| `settings.scenario_id` non-empty | Connection Scenarios page **and** Band Locking page | Scenarios: "Activate" buttons disabled; bound scenario shows "Active via {profile.name}". Band Locking: full disable. |
| `settings.imei` non-empty | (no UI gate — applied only at profile-apply time) | n/a |

The reusable banner component is
`components/cellular/custom-profiles/profile-override-alert.tsx`.

### Defense-in-depth: `profile_managed` guard

The frontend gates exist for UX, but a stale browser tab could still POST to
`scenarios/activate.sh` or `bands/lock.sh`. To prevent that desyncing the
modem, `scenarios/activate.sh` reads the active profile's `scenario_id` and,
if non-empty, returns:

```json
{ "success": false, "error": "profile_managed",
  "message": "Scenarios are managed by the active SIM profile" }
```

…without touching the modem. The frontend treats `profile_managed` as a
"refresh your view" signal rather than a real error.

---

## Creating the binding from the SIM Profile form

The Connection Scenario Select in
`components/cellular/custom-profiles/custom-profile-form.tsx` uses two
sentinel option values:

| Sentinel | Meaning |
|----------|---------|
| `__none__` | Maps to `scenario_id = ""` (no binding). |
| `__create__` | "+ Create new custom scenario…" — deep-links to `/cellular/custom-profiles/connection-scenarios?action=create`, which auto-opens the create-scenario dialog. If the profile form is dirty, an AlertDialog prompts the user to discard changes before navigating. |

The destination page wraps `useSearchParams()` in `<Suspense>` (Next.js
requirement when reading search params in a client component) and consumes
the `action=create` query param to open the dialog on mount.

---

## Related

- [wan-profile-management.md](wan-profile-management.md) — APN editor, the underlying mechanism step 1 uses (and the APN gating note).
- `../ARCHITECTURE.md` § Custom SIM Profiles — auto-apply trigger points (boot / SIM switch / watchdog).
- `../rm520n-gl-architecture.md` § Custom SIM Profiles — Auto-Apply on ICCID Match — RM520N-GL platform considerations (`fs.protected_regular`, `/proc/$pid` checks, defensive sourcing).
- `../BACKEND.md` § `profile_mgr.sh`, § `scenario_mgr.sh`, § `qmanager_profile_apply` — library and daemon inventory.
- `../API-REFERENCE.md` § Custom Profiles, § Connection Scenarios — request/response contracts.
