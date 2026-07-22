# Custom SIM Profiles

> A Custom SIM Profile is a saved bundle of modem configuration — APN, TTL/HL,
> optional IMEI, and (since the binding feature) an optional Connection
> Scenario **with an optional time-of-day schedule** — that is tied to a SIM
> by ICCID. When the modem detects that SIM, the bound profile is applied
> automatically; the user can also apply manually. Profiles are owned by
> `profile_mgr.sh` (library) and applied by the `qmanager_profile_apply`
> daemon.

> ℹ️ NOTE: The APN Settings page (`/cellular/settings` → APN) now renders a
> pixel-strict single-APN card ported from RM551E, not the 6-slot list this
> doc originally described for gating purposes. The gate matrix and apply
> pipeline below are unaffected — see
> [wan-profile-management.md](wan-profile-management.md#apn-pixel-strict-single-apn-ui-ws6)
> for the UI-layer detail.

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
| Frontend hook | `hooks/use-sim-profiles.ts`, `hooks/use-active-profile.ts` |
| Frontend types | `types/sim-profile.ts` |
| Frontend page | `app/cellular/custom-profiles/` |
| Frontend components | `components/cellular/custom-profiles/` (coordinator `custom-profile.tsx`, wizard `custom-profile-form.tsx`, list `custom-profile-view.tsx`, dialog `apply-progress-dialog.tsx`) |
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
  },
  "scenario": {
    "default": "gaming",
    "schedule": {
      "enabled": true,
      "blocks": [
        { "start": "18:00", "end": "23:00", "days": [1,2,3,4,5], "scenario": "gaming" }
      ]
    }
  }
}
```

### `scenario` (top-level object) and the `settings.scenario_id` bridge

Scenario binding lives in a **top-level** `scenario` object —
`{ default, schedule: { enabled, blocks[] } }` — not inside `settings`.
`scenario.default` is both the on-activate scenario **and** the schedule's
fallback for any time not covered by a block. `settings.scenario_id` still
exists and is kept **byte-mirrored** to `scenario.default` by `profile_save`
at a single chokepoint — no installer migration was needed because this is a
read/write bridge, not a rename:

- **Write:** `profile_save` accepts an optional `scenario` object in the
  input, normalizes it (defaults: `default: "balanced"`,
  `schedule: {enabled: false, blocks: []}`), and writes `settings.scenario_id`
  as a plain mirror of `scenario.default` in the same jq template. This is
  the *only* place the two representations are reconciled.
- **Read:** `profile_get` and `profile_list` **synthesize** `.scenario` for
  legacy profiles that predate this feature (no `scenario` key on disk) by
  falling back to `settings.scenario_id` — so an already-chosen scenario
  isn't silently reset to `"balanced"` on first read after an OTA upgrade.
  This synthesis is read-time only; nothing is written back to disk by a
  `GET`.
- **Validation:** every scenario reference — `scenario.default` and every
  `scenario.schedule.blocks[].scenario` — is checked against
  `scenario_mgr.sh`'s `scenario_is_known()` (a built-in name or an existing
  `custom-*.json` file) before save; any unknown reference rejects the whole
  save with `"Unknown connection scenario: <id>."`.

Existing UI code and the apply pipeline's step 3 (`scenario`) still read
`settings.scenario_id` unchanged — see the next section.

#### `settings.scenario_id`

The `scenario_id` field is the profile's binding to a Connection Scenario.
It encodes a **reference**, not a copy — and now, a mirror of
`scenario.default` (see above). New profiles created via the frontend
default to `"balanced"`.

| Value | Meaning |
|-------|---------|
| `""` (empty) | Legacy value — present only on profile JSONs saved before scenario binding shipped. The scenario step is skipped at apply time. The frontend no longer emits this; loading such a profile in the form auto-migrates the display to Balanced, which is persisted on next save. |
| `"balanced"` | Built-in Balanced scenario. `scenario_apply` sends `AT+QNWPREFCFG="mode_pref",AUTO`. Treated as "no opinion" for UI gating purposes — see [Gate matrix](#gate-matrix) below. |
| `"gaming"` / `"streaming"` | Built-in scenario. `scenario_apply` resolves the mode (`NR5G` / `LTE:NR5G`) and sends `AT+QNWPREFCFG="mode_pref",<mode>`. Built-ins never carry band locks. |
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

#### Why Balanced is treated as "no opinion"

All three built-in scenarios leave band fields empty; only `mode_pref` differs.
Balanced sets `mode_pref=AUTO`, which is the modem's factory default — so a
Balanced binding is effectively a no-op on a stock modem. Binding a profile to
Balanced therefore expresses *"this profile doesn't care about radio config,"*
which is why the Connection Scenarios and Band Locking pages stay editable
when bound to Balanced (the user can override freely; the profile will
re-apply Balanced on next activation, but that's a no-op against a modem
that's already on AUTO).

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
| `settings.scenario_id` set to `gaming` / `streaming` / `custom-*` | Connection Scenarios page **and** Band Locking page | Scenarios: banner + "Activate" buttons disabled (with tooltip on hover explaining why). Band Locking: full disable. |
| `settings.scenario_id == "balanced"` | (nothing — Balanced is treated as "no opinion") | No banner, no disabled controls. The binding is only visible from the SIM Profile form. |
| `settings.scenario_id == ""` or null | (nothing) | Pre-binding profiles or legacy data. |
| `settings.imei` non-empty | (no UI gate — applied only at profile-apply time) | n/a |

The reusable banner component is
`components/cellular/custom-profiles/profile-override-alert.tsx`.

### Defense-in-depth: `profile_managed` guard

The frontend gates exist for UX, but a stale browser tab could still POST to
`scenarios/activate.sh` or `bands/lock.sh`. To prevent that desyncing the
modem, `scenarios/activate.sh` reads the active profile's `scenario_id` and,
if it's set to anything other than `""` or `"balanced"`, returns:

```json
{ "success": false, "error": "profile_managed",
  "message": "Scenarios are managed by the active SIM profile" }
```

…without touching the modem. The frontend treats `profile_managed` as a
"refresh your view" signal rather than a real error. The Balanced case is
deliberately allowed through — see [Why Balanced is treated as "no opinion"](#why-balanced-is-treated-as-no-opinion).

---

## Frontend UI (RM551E-parity redesign)

The Custom SIM Profiles page was rebuilt to match the RM551E design. This is a
**frontend-only** change — the backend data model, CGI contract, and apply
pipeline described above are untouched. The three surfaces are the create/edit
**wizard**, the saved-profiles **card list**, and the **apply-progress dialog**,
coordinated by `custom-profile.tsx`.

> ℹ️ NOTE: Verizon-specific UX is **omitted on RM520N** (it is RM551E-only):
> there is no CID-lock-to-3, no brick-guard dialog, no MPDN pill, and no
> `verizon_revert` reboot. The `vzw` MNO preset remains an ordinary, selectable
> preset — RM520N already carried it and it is not special-cased. The dormant
> `isVerizonActive` flag was removed from `hooks/use-active-profile.ts`.

### The 4-tab create/edit wizard (`custom-profile-form.tsx`)

The single-page form became a **4-tab wizard** with directional slide
animation (`motion/react`, reduced-motion aware):

| Tab | Purpose |
|-----|---------|
| Identity | Profile name, MNO preset, SIM ICCID. **Load-from-SIM** quick-fill pulls the live ICCID/IMEI; a live **duplicate-ICCID guard** warns before you save a profile bound to an already-claimed SIM. |
| Network | APN name, CID, PDP type, TTL/HL, optional IMEI override. **"Use my saved APN"** quick-pick fills the APN from the current setting. |
| Scenario | Scenario binding + optional daily schedule windows (see [scenario picker](#scenario-picker-and-the-create-new-deep-link) below). |
| Review | Per-section summaries with edit-jump-back — clicking a section returns to its tab. Final Submit lives here. |

The wizard emits the same flat `ProfileFormData` the old form did
(`name` / `mno` / `sim_iccid` / `cid` / `apn_name` / `pdp_type` / `imei` /
`ttl` / `hl` plus the nested `scenario` object) — no contract change. The
Next/Submit buttons carry **distinct React `key`s** so React remounts the
button across the step transition; this is the ported fix for an early-submit
reconciliation bug where a stale click handler could fire a submit while the
user only meant to advance a tab.

### Saved-profiles card list (`custom-profile-view.tsx`)

The old TanStack **data table was removed** (`custom-profile-table.tsx` is
deleted) in favor of a **stacked-card row list**. Each row shows:

- Config pills — APN / CID / PDP / TTL / HL / IMEI-override.
- A **pulsing live-dot** on the active row.
- An outline status badge — **Active** / **SIM-Mismatch** / **Inactive** (the
  standard `variant="outline"` semantic-color pattern, not a solid badge).
- The scenario-binding line and, when relevant, a SIM-mismatch inline banner.
- A per-row audit line — **"Applied / Partial / Failed at HH:MM"** — backed by
  the new `custom_profiles.view.audit.{applied,partial,failed}` i18n keys.

Row settings are hydrated on demand via a `getProfile` prefetch, because the
`list.sh` summaries deliberately omit the `settings` object (the list endpoint
stays lightweight; per-row config detail is fetched when a card needs it).

### Apply-progress dialog (`apply-progress-dialog.tsx`)

The apply dialog adopts the RM551E **hero-glyph** design — a tinted-ring glyph,
a determinate fill bar, and a step ledger. It renders the **4 RM520N steps**
`apn → ttl_hl → scenario → imei` (it does **not** carry RM551E's Verizon
`mpdn_rule` step). While the apply is non-terminal the dialog cannot be closed;
on a terminal **partial** or **failed** result it offers **Retry**.

### Scenario picker and the "+ Create new" deep-link

New profiles default to `scenario_id = "balanced"`. The user picks any
built-in or custom scenario from the Select in the Scenario tab; there's no
"None" option — Balanced is the de-facto no-op value.

The Select uses one sentinel option value:

| Sentinel | Meaning |
|----------|---------|
| `__create__` | "+ Create new custom scenario…" — deep-links to `/cellular/custom-profiles/connection-scenarios?action=create`, which auto-opens the create-scenario dialog. If the profile form is dirty, an AlertDialog prompts the user to discard changes before navigating. |

> ℹ️ NOTE: The deep-link param is `?action=create`. It was previously
> `?create=1`, which did not match what the scenarios page consumer reads —
> the param name is now aligned so the create-scenario dialog actually opens on
> arrival. The destination page wraps `useSearchParams()` in `<Suspense>`
> (Next.js requirement when reading search params in a client component) and
> consumes `action=create` to open the dialog on mount.

### Supporting components

- `empty-profile.tsx` — restyled empty state, now i18n'd.
- `profile-override-alert.tsx` — the reusable gate banner (see
  [Gate matrix](#gate-matrix)), now i18n-wired. Its prop contract
  (`{ profileName, controls, note? }`) is **preserved** — it is shared by the
  APN, TTL/HL, Scenarios, and Band-Locking gate pages, so the shape could not
  change.
- `custom-profile.tsx` — the coordinator, i18n-wired for the page header and
  the activate/deactivate confirmation dialogs. **Deactivate ≠ revert**
  semantics are preserved.

### i18n and the `ApplyStep` comment fix

The `custom_profiles` namespace was transplanted from RM551E's professional
translations (minus the Verizon keys), growing from ~28 to **282 leaf keys**
per locale across all five locales (`en` / `zh-CN` / `zh-TW` / `it` / `id`);
`bun run i18n:check` reports 100% parity. Separately, the `ApplyStep.name`
doc comment in `types/sim-profile.ts` was corrected — it now documents the
real 4-step RM520N set (`apn`, `ttl_hl`, `scenario`, `imei`), replacing a
stale RM551E 7-step list.

> ℹ️ NOTE: This redesign was validated with `next build` (exit 0, both
> `/cellular/custom-profiles` routes prerender), `bun run i18n:check` (100%
> parity, 0 errors), and `eslint` (exit 0). On-device curl validation was not
> run — no backend changed, so it is not required for this change.

---

## Scenario schedule windows (systemd timer, NOT crond)

A profile's scenario binding can carry up to **2 daily time windows**
(`scenario.schedule.blocks`) that override `scenario.default` for part of
the day — e.g. "Gaming 18:00-23:00 weekdays, Balanced otherwise." RM520N-GL
has **no running `crond`** (see the crond correction in
[timezone.md](timezone.md) and `docs/rm520n-gl-architecture.md`), so this is
implemented as a **systemd `OnCalendar` timer**, generated at runtime, not a
crontab entry.

### Resolution rule (must match byte-for-behavior in 3 places)

For weekday `dow` (0=Sun..6=Sat) and minute-of-day `m`:

1. Consider only blocks whose `days` array includes `dow`.
2. A block matches when `start` ≤ `m` < `end` (start inclusive, end
   exclusive); if `end` ≤ `start` the window wraps past midnight and matches
   when `m ≥ start` **or** `m < end`.
3. First matching block in array order wins.
4. No block matches → `scenario.default`.

This exact rule is implemented independently in three places and **must
stay in sync**:

| Implementation | Purpose |
|-----------------|---------|
| `scenario_mgr.sh::scenario_block_for_now` (jq, on-device) | Authoritative — resolves "what should be active right now" when the timer fires. |
| `scenario_mgr.sh::_scenario_generate_oncalendar_lines` (jq, on-device) | Compiles a schedule into `OnCalendar=` lines (see below) — a from-scratch reimplementation of the same timeline logic, not a call into `scenario_block_for_now`. |
| `lib/scenario-schedule.ts` (`resolveScheduledScenario`, `nextChangeAt`) | Display-only — drives the frontend's "locked" badge and "next change at HH:MM" line. The on-device timer is authoritative; this module exists only so the UI agrees with the device. |

### The systemd mechanism

Unlike `qmanager-auto-update.timer` (a **static** unit shipped by the
installer that the installer arms once), the scenario-schedule timer is
**generated from scratch on every arm/disarm** because its `OnCalendar=`
lines are per-profile data, not a fixed schedule:

| Component | Role |
|-----------|------|
| `scripts/usr/bin/qmanager_scenario_schedule_arm` | Root helper (sudoers-gated). `install <profile_id>` computes `OnCalendar=` lines via `_scenario_generate_oncalendar_lines`, writes `qmanager-scenario-schedule.timer` to `/lib/systemd/system/`, and manually symlinks it into `/lib/systemd/system/timers.target.wants/` — the same manual-symlink pattern as `qmanager_auto_update_arm`, and for the same reason: on this systemd 244, `systemctl enable` writes into `/etc/systemd/system/`, but `systemctl is-enabled` and every other qmanager unit persist via `/lib` symlinks, so using `systemctl enable` here would put this unit's enablement state in a different place than everything else. `teardown` stops + removes the timer. Both verbs no-op cleanly if the target `.service` is absent (an OTA-upgraded device that predates the feature). |
| `qmanager-scenario-schedule.service` (static, installer-shipped, `Type=oneshot`) | `ExecStart=/usr/bin/qmanager_scenario_schedule --now`. No `[Install]` section — only ever started by the timer, never boot-enabled directly. |
| `scripts/usr/bin/qmanager_scenario_schedule` | The fire-worker. A systemd `OnCalendar` line can only encode **when** to fire, never **which** scenario (unlike a cron line, it carries no payload) — so every firing runs this one fixed worker, which resolves "what should be active right now" via `scenario_block_for_now` / `scenario_apply_resolved` rather than being told directly. Self-heals: if the active profile was deleted or its schedule disabled/edited since the timer was armed, it tears the timer down instead of erroring. |

`scenario_install_schedule <profile_id>` / `scenario_teardown_schedule` in
`scenario_mgr.sh` are the library-level entry points — thin wrappers that
call the root helper directly if already root, or via `sudo -n` from a
`www-data` context. They are invoked from:

- `qmanager_profile_apply` — arms the schedule on a successful apply
  (`complete`/`partial`), tears it down + resets the scenario to Balanced on
  `failed`.
- `profile_mgr.sh::profile_delete` — tears down + resets when deleting the
  active profile.
- `profile_mgr.sh::auto_apply_profile` — tears down + resets when a SIM
  mismatch deactivates the active profile.
- `profiles/deactivate.sh` (CGI) — tears down + resets on explicit
  deactivate.

> ⚠️ WARNING: The `profile_id` argument reaches `qmanager_scenario_schedule_arm`
> from a `www-data`-reachable `sudo` call and is interpolated into the
> generated `.timer` unit's `Description=` line, so the helper validates it
> against a strict `p_<timestamp>_<hex>` charset (rejecting anything outside
> `[0-9a-z_]` — including `;`, `/`, whitespace, and newline) **before** it
> ever reaches `scenario_mgr.sh` or a disk path. This is the newline-injection
> gate; a malformed id is rejected outright rather than sanitized.

An `OnCalendar` line only encodes a fire time, not a payload — the
`_scenario_generate_oncalendar_lines` compiler walks the weekly timeline per
weekday, de-duplicates transitions at shared minute boundaries (a block-start
wins over a touching block-end), seeds each weekday with the effective
scenario at 23:59 of the previous day (so an overnight block bleeding past
midnight still emits its restore transition), and groups identical
`(minute, scenario)` transitions across weekdays into one `OnCalendar=<days>
HH:MM:00` line.

---

## ICCID canonicalization and `--auto` apply supersession

`iccid_canonicalize` (from `sim_db.sh`, see
[sim-detection.md](sim-detection.md#byte-parity-requirement-why-sim_db_normalize--iccid_canonicalize))
strips a trailing BCD pad `F` for **comparison** purposes. `profile_mgr.sh`'s
`find_profile_by_iccid` and `auto_apply_profile` both canonicalize *both*
operands before comparing a live ICCID against a profile's stored
`sim_iccid` — otherwise a profile saved via one read path (raw string, pad
kept) would silently fail to match a live SIM read via another path
(digits-only extractor, pad dropped), or vice versa.

### `--auto` mode and the stale-SIM guard

`qmanager_profile_apply <profile_id> --auto` is the flag `auto_apply_profile`
passes when it spawns the worker (a manual Activate from the UI omits it and
keeps the prior, unguarded semantics). In `--auto` mode the worker checks —
at two points, **pre-apply** and **pre-finalize** — that the live ICCID
still matches the profile's `sim_iccid` (re-read via the canonical `AT+QCCID`
pipeline, 3×1s retry, canonicalized on both sides). An empty live read is
"don't know" and never aborts; a **confirmed mismatch** aborts the apply as
`failed` with `apply_error: "superseded_sim_changed"` and does **not** touch
the active-profile marker — the apply that's actually current for the live
SIM owns that.

**Why two checkpoints:** a rapid back-to-back SIM switch (e.g. a user
toggling slots, or a watchdog failover landing mid-apply) can invalidate an
in-flight apply either before it starts or while it's running. Checking only
once at start would miss a switch that happens mid-apply and let a stale
apply finalize — pinning the **wrong** SIM's profile as active.

### The pending-apply queue (latest wins)

If `auto_apply_profile` is called while a worker is already holding the PID
lock, the old behavior was a pure skip — silently dropping a rapid
back-to-back switch if a stale worker was still applying the *previous*
SIM's profile. Instead, the caller now writes `(iccid, caller)` to
`/tmp/qmanager_profile_pending_apply` (atomic tmp+mv, so a second queued call
before the first is consumed simply overwrites it — latest wins, no queue
buildup). The **running worker's `EXIT` trap** consumes this marker, but only
**after** it has released the PID lock (`rm -f "$PROFILE_APPLY_PID_FILE"`
runs first in `cleanup()`) — consuming it earlier would have the re-spawned
`auto_apply_profile` immediately busy-skip again on the same still-held lock.
The re-run reads the **freshest live ICCID** (not the stored/queued one) so
the newest SIM state wins even if it changed again while the first apply was
finishing.

---

## Related

- [wan-profile-management.md](wan-profile-management.md) — APN editor, the underlying mechanism step 1 uses (and the APN gating note).
- [sim-detection.md](sim-detection.md) — the known-SIMs set model, byte-parity vs. canonicalized ICCID comparison, and the watchdog/slot-switch/profile-activate coupling that keeps expected SIM transitions from false-firing the "New SIM" banner.
- [connection-watchdog.md](connection-watchdog.md) — Tier-3 SIM failover, the `verify_quimslot` read-back gate, and the `sim_db_add` coupling at finalize/revert.
- `../ARCHITECTURE.md` § Custom SIM Profiles — auto-apply trigger points (boot / SIM switch / watchdog).
- `../rm520n-gl-architecture.md` § Custom SIM Profiles — Auto-Apply on ICCID Match — RM520N-GL platform considerations (`fs.protected_regular`, `/proc/$pid` checks, defensive sourcing).
- `../BACKEND.md` § `profile_mgr.sh`, § `scenario_mgr.sh`, § `qmanager_profile_apply` — library and daemon inventory.
- `../API-REFERENCE.md` § Custom Profiles, § Connection Scenarios — request/response contracts.
