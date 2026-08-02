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
| Frontend hook | `hooks/use-sim-profiles.ts`, `hooks/use-active-profile.ts`, `hooks/use-current-settings.ts`, `hooks/use-profile-suggestions.ts` |
| Frontend types | `types/sim-profile.ts` |
| Frontend page | `app/cellular/custom-profiles/` |
| Frontend components | `components/cellular/custom-profiles/` (coordinator `custom-profile.tsx`, wizard `custom-profile-form.tsx`, list `custom-profile-view.tsx` — which also renders suggestion rows — dialog `apply-progress-dialog.tsx`) |
| Suggestion data / matcher | `constants/profile-suggestions.ts`, `lib/carrier-match.ts` |
| Apply steps | 4: `apn` → `ttl_hl` → `scenario` → `imei` |
| Band failover watcher | `/usr/bin/qmanager_band_failover`, flag `/etc/qmanager/band_failover_enabled`, PID `/tmp/qmanager_band_failover.pid` |

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

### A profile carries NO band fields — bands live in the scenario

> ⚠️ WARNING: There is **no** `bands`, `lte_bands`, `nsa_nr_bands`, or
> `sa_nr_bands` key anywhere in the profile JSON above, and `profile_save`
> would reject one. The schema is exhaustive: `apn` / `imei` / `ttl` / `hl` /
> `scenario_id` under `settings`, plus the top-level `scenario` object.

Band locking is reachable from a profile **only indirectly**, through a bound
**custom scenario**. The chain is:

```
profile.settings.scenario_id  →  "custom-<timestamp>"
    →  /etc/qmanager/scenarios/custom-<timestamp>.json
        →  .config.lte_bands      e.g. "3:7:20"
        →  .config.nsa_nr_bands   e.g. "25:41:66:71"
        →  .config.sa_nr_bands    e.g. "25:41:66:71"
```

Each band string is **colon-joined bare decimals** — no `N`/`n` prefix, no
commas, no spaces (`"25:41:66:71"`, never `"n25,n41"`). The three built-in
scenarios (`balanced` / `gaming` / `streaming`) leave all three fields empty
and therefore never lock a band.

Practical consequences worth internalizing before touching this area:

- **To give a profile a band lock you must create a scenario first**, then
  reference it. `profile_save` validates the reference and rejects a save that
  names a scenario which does not exist yet
  (`"Unknown connection scenario: <id>."`) — so the two writes are strictly
  ordered, scenario before profile. This is exactly why the suggestion
  create flow is a two-call sequence (see
  [Suggested profiles](#suggested-profiles-recommended-for-your-sim)).
- **Editing the scenario changes every profile bound to it.** Bands are shared
  state by reference, not copied into the profile.
- **A scenario record also carries a UI-only `icon` key** (a stable glyph name
  such as `"gamepad"`, resolved through
  `components/cellular/custom-profiles/connection-scenarios/scenario-icons.ts`).
  It replaced a `gradient` field that stored raw Tailwind classes. Two things
  follow. First, the key is **optional** — records written before it existed
  have no `icon` and fall back to the default glyph, which is why the resolver
  is total rather than a plain map lookup. Second, neither field was ever read
  by the backend: `save.sh` stores the POST body verbatim (`jq '.id = $id'`)
  and parses only `.id` and `.name`, so swapping one presentational key for
  another needed no CGI change and no migration. Records saved before the
  switch simply keep an ignored `gradient` key.
- **Binding a band-carrying scenario disables the Band Locking page** (see the
  [Gate matrix](#gate-matrix)) — which is why the apply path needed its own
  band-failover safety net (see
  [Band failover watcher](#band-failover-watcher-on-the-apply-path)).

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
| `"custom-<timestamp>"` | Custom scenario stored at `/etc/qmanager/scenarios/<id>.json`. The apply step looks up the JSON, reads `mode_pref` and the optional `lte_bands` / `nsa_nr_bands` / `sa_nr_bands` strings, and applies them. (These are the **JSON** key names; the AT parameter for `sa_nr_bands` is confusingly `nr5g_band` — see [A profile carries NO band fields](#a-profile-carries-no-band-fields--bands-live-in-the-scenario).) |

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

### Band failover watcher on the apply path

A bad band lock can leave the modem with no camp-able carrier — the radio is
narrowed to a set nothing is broadcasting on, and the device drops off the
network entirely. The manual **Band Locking** page has always guarded against
this: `bands/lock.sh` spawns `/usr/bin/qmanager_band_failover`, which polls
`AT+QCAINFO` for ~30 s and reverts to *all* supported bands if no carrier
appears.

For a long time that was the **only** call site. `scenario_apply` sends the
*identical* `AT+QNWPREFCFG` band commands when a profile applies a custom
scenario, and spawned nothing — so applying a band lock **via a profile** had
no safety net, while the manual route did. Worse, per the
[Gate matrix](#gate-matrix), binding a `custom-*` scenario **disables the Band
Locking page**, which is the user's manual recovery route. A user who locked
themselves off the network through a profile had neither the automatic revert
nor the manual one.

`qmanager_profile_apply::_spawn_band_failover_if_needed()` closes that gap.
It is called from the `custom-*` branch of `apply_scenario`, immediately after
`scenario_apply` returns 0, on **both** sub-paths — full success *and* partial
band failure — mirroring `bands/lock.sh`, which spawns unconditionally once its
AT command is accepted.

| Behavior | Detail |
|----------|--------|
| Early return | Spawns nothing when `lte_bands`, `nsa_nr_bands`, and `sa_nr_bands` are **all** empty. Built-in scenarios (`balanced` / `gaming` / `streaming`) are therefore completely unaffected. |
| Opt-in flag | Honors the same `/etc/qmanager/band_failover_enabled` file; spawns only when its contents are exactly `1`. |
| Shared state | Same PID file (`/tmp/qmanager_band_failover.pid`), same activated flag (`/tmp/qmanager_band_failover`), same detached-subshell spawn idiom as `bands/lock.sh` — the two spawn paths are indistinguishable to the watcher and to the UI's failover-activated indicator. |
| Missing watcher | Logs a warning and returns 0 if `/usr/bin/qmanager_band_failover` is absent or non-executable. |
| Failure mode | Non-blocking and non-fatal. A spawn failure can never alter the `scenario` step's `done` / `partial` / `failed` status. |

> ℹ️ NOTE: **No sudo, no sudoers rule is involved.** Both `bands/lock.sh` and
> `profiles/apply.sh` are CGI running as `www-data`, and both spawn their
> workers with a plain backgrounded subshell — the watcher inherits the
> `www-data` context. This is why adding the second spawn site stayed a Tier 3
> change rather than a Tier 4 (installer/sudoers) one.

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
- A filled tonal status badge — **Active** / **SIM-Mismatch** / **Inactive** —
  via `PROFILE_STATUS_BADGE` (see [Tonal design rebuild](#tonal-design-rebuild-shapests-contract)
  below), each status carrying its own glyph rather than relying on colour
  alone.
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

### Tonal design rebuild (`shapes.ts` contract)

Custom Profiles and Connection Scenarios were subsequently rebuilt onto the
project's tonal design language (the same migration already applied to the
Dashboard, Cellular/Radio Information, and SMS Center). This is again
**frontend-only** — nothing in the data model, CGI contract, or apply
pipeline above changed.

> ℹ️ NOTE: **`components/cellular/custom-profiles/shapes.ts` is now the
> single source of truth** for this surface's geometry and tones — row/tile
> shapes, pill and badge classes, the tone-per-status helpers
> (`profileRowTone`, `ledgerStepTone`), and the status→badge map
> (`PROFILE_STATUS_BADGE`). Any new work on this surface (a new row variant,
> a new tile, a new status) should extend this file rather than hand-roll a
> class string — its header comments carry the reasoning (the tone rule: fills
> use `--tone-{role}-1` for stacked rows, the container pair for chips/notices,
> `text-{role}-on-surface` for tinted text; and the No-Hairline-On-Fill rule:
> a real tonal fill doesn't also carry a border). Both page shells also moved
> onto the shared `staggerContainer`/`staggerItem` cascade and `@container/main`.

An accessibility bug was fixed in the process:
`connection-scenarios/active-config-card.tsx` distinguished its three status
chips (Active / Applying / Not Active) with nothing but a hand-drawn coloured
`<div>` dot. Because `success-container` and `warning-container` measure
**1.03:1** apart — the same surface to the eye, and identical under
deuteranopia — colour alone did not separate them. All three now render
through `PROFILE_STATUS_BADGE`, which carries a distinct Material glyph per
state.

The apply dialog's step ledger (`apply-progress-dialog.tsx`) was rebuilt on
the `DeleteProgress` pattern from `components/cellular/sms/delete-dialogs.tsx`.
Its state type, `LedgerState` in `shapes.ts`, is now a **type alias of
`ApplyStepStatus`** (`types/sim-profile.ts`) instead of a hand-written union.
The hand-written version had omitted `"skipped"` — which would have rendered
an already-correct, skipped apply step as still queued. Aliasing the source
type makes that class of drift a compile error: add a status to
`ApplyStepStatus` and `ledgerStepTone` stops compiling until every case is
handled.

**i18n:** the Connection Scenarios surface (`scenarios.*` in the `cellular`
namespace, `public/locales/*/cellular.json`) had shipped almost entirely
hardcoded English — the subtree held 4 keys. It now holds **76 leaves across
all five locales** (en / zh-CN / zh-TW / it / id), including a new
`scenarios.icons.*` subtree covering the 12 scenario-icon labels that had
been string literals inside the `SCENARIO_ICONS` data array in
`scenario-icons.ts` — invisible to both `bun run i18n:check` and a plain
JSX-text grep, since they never appeared as rendered text in source.

> ℹ️ NOTE: This pass was validated with `tsc` (clean), `next build` (clean),
> `eslint` (clean), `bun run icons:check` (97 glyphs, no font regeneration
> needed), and `bun run i18n:check` (0/0, 76 leaves confirmed in every
> locale by count). On-device curl validation was not run — no backend
> changed.

---

## Live modem settings: `GET profiles/current_settings.sh`

`scripts/www/cgi-bin/quecmanager/profiles/current_settings.sh` is the one
endpoint the create form reads to pre-fill itself. It is called **once per
form open / page mount**, never on a timer, and does all of its work in a
**single compound AT round-trip** so the whole read costs one hold of
`/tmp/qmanager_at.lock`:

```sh
qcmd 'AT+CGDCONT?;+CGSN;+QCCID;+CGPADDR;+QMAP="WWAN";+QSPN'
```

Response (`CurrentModemSettings` in `types/sim-profile.ts`):

```json
{
  "apn_profiles": [ { "cid": 1, "apn": "fbb.home", "pdp_type": "IPV4V6" } ],
  "imei": "860000000000000",
  "iccid": "8901260123456789012",
  "active_cid": 1,
  "spn": "GLOBE",
  "network_name": "GLOBE",
  "mcc": "515",
  "mnc": "02"
}
```

`spn` / `network_name` / `mcc` / `mnc` are **additive** — added alongside the
existing keys, with `;+QSPN` appended to the compound command rather than
issued as a second `qcmd` call. Nothing that consumed the older shape breaks.

### Parsing `+QSPN`

A live response looks like:

```
+QSPN: "GLOBE","GLOBE","GLOBE",0,"51502"
         FNN     SNN     SPN        RPLMN
```

The **last quoted field is the concatenated PLMN** — the carrier's numeric
identity, MCC (mobile country code, always 3 digits) immediately followed by
MNC (mobile network code). MNC width is **not fixed** — it is 2 or 3 digits
depending on the country — so the script splits **first-3 / rest**, never at a
fixed offset:

| Field | Source | `awk -F'"'` field | Example |
|-------|--------|-------------------|---------|
| `network_name` | 1st quoted field — FNN, from the SIM's `EF_PNN` | `$2` | `"GLOBE"` |
| `spn` | 3rd quoted field — SPN, from the SIM's `EF_SPN` | `$6` | `"GLOBE"` |
| `mcc` | PLMN chars 1–3 | `$(NF-1)` | `"515"` |
| `mnc` | PLMN chars 4–end | `$(NF-1)` | `"02"` |

> ⚠️ WARNING: `spn` was originally parsed from `$2`, which is **FNN, not SPN**.
> The bug was invisible on the GLOBE test SIM because all three name fields are
> identical there. The two fields answer different questions and the difference
> is the entire basis of MVNO detection:
>
> - **FNN** (`EF_PNN`) names the **network**. An MVNO usually inherits its
>   host's name here.
> - **SPN** (`EF_SPN`) names the **service provider** — whoever sold the SIM.
>   This is where a reseller brands itself.
>
> A Mint SIM on T-Mobile reads `network_name: "T-Mobile"`, `spn: "Mint"`.
> Verified on-device with BusyBox `awk`:
> `+QSPN: "T-Mobile","TMO","Mint",0,"310260"` → `fnn=[T-Mobile] spn=[Mint]`.

> ⚠️ WARNING: The PLMN guard rejects the empty and any-non-digit cases
> **first** (`''|*[!0-9]*)`) before matching the 4-plus-digit pattern. A bare
> `[0-9][0-9][0-9][0-9]*` glob only constrains the leading four characters, so
> a corrupt tail like `5150A` would have produced `mnc="0A"`. Verified on
> device: `5150A` / `abc` / `""` all reject; `51502` → `515`/`02`;
> `310260` → `310`/`260`.
>
> The guard clears **only the numeric fields**. `spn` and `network_name` are
> parsed from independent positions and stay valid on their own — blanking them
> as collateral for a malformed PLMN would discard the one identity an MVNO
> actually controls.

All three fields **fail soft to `""`** on an absent or malformed `+QSPN`, and
the endpoint always returns **200** — including on a SIM-less modem. A
consumer must treat empty as "unknown carrier", never as an error.

---

## Create-form autofill on page load

The create form pre-fills from the live SIM **automatically on mount**
(`custom-profile.tsx` calls `useCurrentSettings(true)`), not only when the user
presses **Load from SIM**. Because the compound AT read takes ~2–3 s, the user
can already be typing when the response lands — so the two arrival paths are
handled differently, distinguished by an `explicitLoad` state flag in
`custom-profile-form.tsx`.

| Path | Trigger | Write policy | IMEI |
|------|---------|--------------|------|
| **MOUNT** | `useCurrentSettings(true)` fires on page load | **Fill-empty-only** — anything already in the form (typed, or seeded by an MNO preset) always wins | **Never written** |
| **EXPLICIT** | User pressed **Load from SIM** (`handleLoadFromSim` sets `explicitLoad`) | SIM values **overwrite** the form | Written |

> ℹ️ NOTE: The prefill is a **render-time compare**, not a `useEffect` — a
> deliberate convention in this file, to avoid a cascading `setState` round.
> If a mount fetch is still in flight when **Load from SIM** is clicked, that
> in-flight response is treated as the explicit one: same endpoint, same data,
> and the user did ask for it.

### Why IMEI is excluded from the automatic path

Apply **step 4** (`qmanager_profile_apply`) issues `AT+EGMR=1,7` and **reboots
the modem** whenever a profile's stored IMEI differs from the live one.
Autofilling IMEI on every mount would silently arm that reboot on every new
profile, and would also stamp a misleading **"IMEI override"** pill on the
saved-profile row for a profile that overrides nothing. An IMEI override must
stay an explicit act.

### Why `cid` and `pdp_type` ride along with `apn_name`

`cid` (default `1`) and `pdp_type` (default `IPV4V6`) have no "empty" state, so
fill-empty-only cannot be expressed for them individually. They are written
**only together with `apn_name`**, so the APN triple is either fully
SIM-sourced or fully untouched — never half-overwritten with one field from the
SIM and two from the defaults.

An **empty SIM APN never writes at all**. The live device reports
`active_cid: 1` with an empty APN string; under the older unconditional prefill
that blanked whatever the user had typed.

### Bug fixed in passing: the mid-edit prefill

`prevSettings` now advances on **every** settings object that arrives, while the
form write stays gated on `!isEditing`. Previously a response landing mid-edit
was never consumed, so it stayed pending and fired later — repopulating the form
the next time the user left edit mode. The window is real: `handleEdit` is
async, so the mount fetch can resolve between the Edit click and
`editingProfile` arriving.

---

## Suggested profiles ("Recommended for your SIM")

When the inserted SIM's PLMN matches a carrier QManager has a known-good recipe
for, suggestions render as **rows inside the Saved Profiles list**, appended
below the saved rows under a "Recommended for your SIM" divider. These are
**not saved profiles** — nothing exists on flash until the user presses
**Create**.

| Piece | File |
|-------|------|
| Recipe data | `constants/profile-suggestions.ts` |
| PLMN matcher (pure) | `lib/carrier-match.ts` |
| Decision + create sequence | `hooks/use-profile-suggestions.ts` |
| UI | `SuggestionRow` in `components/cellular/custom-profiles/custom-profile-view.tsx` |
| i18n | 15 keys under `custom_profiles.suggestions.*` in the `cellular` namespace, all 5 locales |

### Why suggestions live in the list but not in `profiles[]`

A suggestion row is structurally identical to a saved row — same border,
radius, padding, motion, and the same four content bands (identity + status,
scenario binding, config pills, action footer). Three differences carry the
honesty, none of them colour-only:

- the status slot reads **Suggested** (info-toned, `SparklesIcon`) where a saved
  row reads Active / SIM mismatch / Inactive;
- there is **no overflow menu**, because there is nothing yet to edit or delete;
- the footer verb is **Create**, not Activate, above a "Not saved yet" label.

The surface stays `bg-muted/20` — the same wash an inactive saved row uses.
Tinting it would re-create the visual quarantine the in-list design removes.

> ⚠️ **Suggestions must stay a sibling prop, never merged into `profiles`.**
> Three invariants depend on that separation, and merging breaks all three at
> once:
>
> 1. the header **count badge** reads `profiles.length`, so it never claims a
>    suggestion is stored;
> 2. the **detail prefetch** (`Promise.all(profiles.map(getProfile))`) never
>    fires a CGI GET for a synthetic id that resolves to nothing;
> 3. **activate / edit / delete** are wired per row variant, so a synthetic id
>    is never handed to an endpoint that only accepts real ones.

Two further consequences of moving suggestions inside the card:

- **The empty-state gate is widened.** `custom-profile-view.tsx` returns
  `EmptyProfileViewComponent` only when `profiles.length === 0` **and**
  `suggestions.length === 0`. A user with no saved profiles but a matched
  carrier is exactly who a suggestion is for; the full empty-state card would
  otherwise hide the recommendation from its whole audience. When only
  suggestions exist, an inline `view.none_saved_yet` line carries the
  "nothing stored yet" message instead.
- **The scenario binding line is now rendered on suggestion rows.** It resolves
  the same way the create path does: the recipe's `scenario_name` when a band
  lock actually survives intersection with the modem's supported bands,
  otherwise the built-in `balanced`. This is honest disclosure — binding a
  `custom-*` scenario is what disables the manual Band Locking page.

The plan-ambiguity warning is per-row (`suggestions.plan_ambiguity_short`,
occupying the slot a saved row uses for its SIM-mismatch note), because the
choice it describes is between two specific sibling rows. The band and TTL
rationale stays section-level, in a muted footer beneath the suggestion rows.

### The recipes

| id | Name | APN | TTL / HL | CID / PDP | NR bands (NSA **and** SA) |
|----|------|-----|----------|-----------|---------------------------|
| `tmobile` | T-Mobile | `fast.t-mobile.com` | 64 / 64 | 1 / `IPV4V6` | 25, 41, 66, 71 |
| `tmobile_home` | T-Mobile Home Internet (TMHI) | `fbb.home` | 64 / 64 | 1 / `IPV4V6` | 25, 41, 66, 71 |
| `verizon` | Verizon | `vzwinternet` | 64 / 64 | 1 / `IPV4V6` | — |
| `att` | AT&T | `enhancedphone` | 64 / 64 | 1 / `IPV4V6` | — |
| `smart` | Smart | `SMARTLTE` | 64 / 64 | 1 / `IPV4V6` | — |
| `globe` | Globe | `internet.globe.com.ph` | 64 / 64 | 1 / `IPV4V6` | — |
| `gomo` | GOMO | `gomo.ph` | 64 / 64 | 1 / `IPV4V6` | — |
| `dito` | DITO | `internet.dito.ph` | 64 / 64 | 1 / `IPV4V6` | — |

> ⚠️ WARNING: **Only the T-Mobile pair carries band locks, and that is
> deliberate.** We have no verified band recommendation for the other carriers,
> and a band lock is a *narrowing* operation. Guessing one would be actively
> harmful — and because band locks can only live on a scenario, it would also
> bind a `custom-*` scenario, which **disables the Band Locking page** and
> removes the user's own route to undoing it. Do not add bands to a carrier
> here without evidence.

TTL/HL is 64 across the board, **independent of `MNO_PRESETS`**, several of
which store `0` (leave unchanged) for the same carrier. The two tables are
deliberately uncoupled — see [Relationship to MNO presets](#relationship-to-mno-presets).

**Shared-PLMN pairs are always shown together.** Two pairs are
indistinguishable over the air and are marked `ambiguous_plan: true`:

| Pair | Shared PLMN | Why |
|------|-------------|-----|
| `tmobile` / `tmobile_home` | 310-260 | TMHI and consumer T-Mobile are the same network |
| `globe` / `gomo` | 515-02 | GOMO is Globe's own digital brand |

That flag drives the "we can't tell which plan you're on" warning, which renders
**only** when a visible suggestion carries it — an unambiguous single match must
not warn about a choice that isn't there.

### Detection: PLMN gate + SPN refinement

`matchCarrierSuggestions(mcc, mnc, spn, networkName)` in `lib/carrier-match.ts`
is a **pure** function — no React, no fetch, no module state. That is
deliberate: the only live test device runs a GLOBE SIM (MCC 515), so the US
branches are **unreachable on hardware** and had to be verifiable off-device.
88 assertions cover the table, the denylist and the normalizers.

**Step 1 — PLMN gate (`PLMN_TABLE`).** Every entry whose MCC+MNC matches
contributes its suggestion ids, so two entries sharing a PLMN (Globe/GOMO) both
apply.

| Carrier | PLMNs |
|---------|-------|
| T-Mobile US | `310` + `TMOBILE_US_MNCS` (260, 160, 200, 210, 220, 230, 240, 250, 270, 310, 490, 660, 800) |
| AT&T | `310`/410, 150, 170, 280, 380, 560, 680, 090, 980 · `311`/180 |
| Verizon | `311`/480, 110, 270–289 · `310`/004, 010, 012, 013 |
| Smart | `515`/03, 05 |
| Globe + GOMO | `515`/02, 01 |
| DITO | `515`/66 |

> ℹ️ NOTE: **Verizon's primary PLMN is `311`-480 — MCC 311, not 310.** This is
> why the matcher had to stop being a function of the single `MCC_US` constant
> and become a general table. `MCC_US` remains exported, but it is no longer the
> only US MCC.

Only PLMNs we are confident about are listed. A carrier's secondary or legacy
codes are **omitted rather than guessed** — a wrong entry shows a real user the
wrong APN, while a missing one merely shows nothing.

`normalizeMnc()` strips non-digits and **leading zeros** before comparing,
because `AT+QSPN` can report the same network as `"02"`, `"2"`, or `"002"`
depending on firmware and PLMN width.

> ℹ️ NOTE: Leading-zero stripping is **not** zero-padding. `310/26` and
> `310/026` both normalize to `26`, which is **not** `260` — a different
> network, and they correctly do not match.

**Step 2 — MVNO denylist (`MVNO_SPN_DENYLIST`).** An MVNO owns no towers; it
resells a host network's radio access. Every *network*-broadcast identifier
therefore truthfully reports the host — a Mint SIM really is on T-Mobile's
network and really does broadcast T-Mobile's PLMN. No network-side probing can
separate them.

The one identity the reseller controls is on the SIM: `EF_SPN` (surfaced as
`spn`) and `EF_PNN` (surfaced as `network_name`). Both are checked, because
some resellers brand only via `EF_PNN`.

> ⚠️ WARNING: The denylist is matched by **exact normalized equality — never
> substring or prefix.** `"mobile"` occurs inside `"tmobile"`, so a loose match
> against any `*mobile*` reseller would suppress suggestions for the host
> carrier itself. `normalizeCarrierName()` lowercases and strips non-alphanumerics
> (`"US Mobile"` → `"usmobile"`); denylist entries are stored pre-normalized and
> an assertion enforces that.

The asymmetry is the important part:

- The PLMN gate **establishes** a match.
- The denylist can only **remove** one — it is applied *after* the gate and can
  never be the reason a suggestion appears.

That direction is chosen because `EF_SPN` is an **optional** file. Plenty of
legitimate SIMs leave it blank or copy the network name into it, so requiring a
positive SPN match would silently kill suggestions for all of them. A name we
have never seen falls through and is treated as the host — the safe failure
direction, since the worst case is the pre-existing behaviour.

> ℹ️ NOTE: The poller's `network.carrier` (from `AT+COPS?`, see
> `parse_at.sh::parse_carrier`) is **not** used for any of this. It names the
> *tower's* operator, so it carries the same MVNO ambiguity as the PLMN, plus
> free-text instability across firmware and registration state
> (`"T-Mobile"` / `"T-Mobile US"` / `"310260"`).

### Visibility rule (derived, never persisted)

The section shows when **both** hold:

1. `matchCarrierSuggestions(mcc, mnc)` is non-empty, **and**
2. **no saved profile's `sim_iccid` canonically matches the live ICCID.**

That single second test satisfies two requirements at once — hide after a
suggestion was created, and hide when a profile already exists for this SIM —
and it **self-heals**: delete the profile and the suggestion comes back.

> ⚠️ WARNING: There is deliberately **no persisted "dismissed" flag.**
> `config.sh`'s `qm_config_init` only seeds an *empty* file and the project has
> no key-migration primitive, so a newly-introduced persisted key would
> silently do nothing on every OTA-upgraded device. Do not "improve" this by
> adding one without also adding a migration step.

ICCID comparison goes through `canonicalizeIccid()` / `iccidMatches()`, a
client-side mirror of `sim_db.sh::iccid_canonicalize` — strip whitespace, then
drop **one** trailing `F`/`f` BCD pad. This must stay in lockstep with the
shell implementation; a divergence makes the client think a SIM has no profile
when the backend knows it does. See
[sim-detection.md](sim-detection.md#byte-parity-requirement-why-sim_db_normalize--iccid_canonicalize).

### Band-support intersection

The recommended bands are intersected against the modem's own
`device.supported_nsa_nr5g_bands` / `device.supported_sa_nr5g_bands` (from the
status poll, colon-delimited) **before** anything is written.

An **empty intersection — including "support unknown", e.g. status has not
landed yet — writes no lock at all** for that category, i.e. Auto. Locking a
band the radio cannot use is strictly worse than not locking: it narrows the
radio to a set it can never camp on. The suggestion card reflects this
honestly, showing **"5G NSA Auto"** instead of a band list.

### Create: one call, or two when a band lock is involved

A scenario is created **only** when there is an actual band lock to put in it.
The gate is `hasBandLock && !!suggestion.scenario_name`, and it fails in two
distinct ways:

1. The suggestion recommends no bands at all — every carrier except the
   T-Mobile pair. `scenario_name` is `undefined`.
2. The suggestion recommends bands, but **none survived intersection** with
   what the modem reports it supports.

Either way the profile binds `NO_BAND_SCENARIO_ID` — the **built-in**
`"balanced"` (`DEFAULT_SCENARIO_BINDING.default`) — and no scenario call is
made at all.

> ⚠️ WARNING: Binding a `custom-*` scenario **disables the Band Locking page**,
> client-side and again server-side in `scenarios/activate.sh`. A profile that
> locks nothing must therefore never bind one, or an APN-only suggestion would
> silently cost the user their manual band controls in exchange for nothing.
>
> Case 2 is the subtle one and was a **real latent bug**: before this gate, a
> T-Mobile suggestion created while the modem's supported-band list had not yet
> landed would mint a `custom-*` scenario holding two *empty* band strings —
> locking nothing, while still tripping the gate. Strictly worse than the
> built-in.

When a band lock **is** involved, the calls are ordered because `profile_mgr.sh`
rejects a save that references a scenario which does not exist yet (see
[A profile carries NO band fields](#a-profile-carries-no-band-fields--bands-live-in-the-scenario)):

1. **`GET scenarios/list.sh`** — reuse a scenario named exactly
   `suggestion.scenario_name` (for the T-Mobile pair, `TMOBILE_SCENARIO_NAME` =
   `"T-Mobile Recommended Bands"`) if one exists. A failed lookup is non-fatal;
   it falls through to step 2.
2. **`POST scenarios/save.sh`** — otherwise create it, with
   `config.atModeValue: "AUTO"` and the **intersected** bands as colon-joined
   bare decimals (`"25:41:66:71"` — **no `N` prefix**), `lte_bands: ""`.
3. **`POST profiles/save.sh`** — create the profile bound to that scenario id,
   via the page's existing `createProfile` path.
4. **Rollback** — if step 3 fails **and** step 2 created the scenario, delete
   it. A **reused** scenario is never deleted: other profiles may be bound to
   it.

> ℹ️ NOTE: The scenario name lives on the suggestion (`scenario_name`), not as a
> module constant the create path reaches for. The hardcoded
> `TMOBILE_SCENARIO_NAME` could not have named a Globe scenario.

Device caps surface as real, human-readable errors rather than silent no-ops:
`MAX_SCENARIOS=20` and `MAX_PROFILES=10`. The two errors come from different
hooks (scenario failures from `useProfileSuggestions`, profile failures from
`useSimProfiles`), so the UI falls back between them and never shows two
contradicting messages.

### Relationship to MNO presets

`constants/mno-presets.ts` is **deliberately uncoupled**. Its `tmo_home` preset
keeps `ttl: 0, hl: 0`, and `dito`/`gomo`/`globe`/`att_5g_phone` likewise store
`0`; the suggestions carry TTL/HL 64 independently. The presets feed the profile
form's carrier dropdown; suggestions are a separate recipe list. **Do not
"reconcile" the two without an explicit decision** — the zeroed preset values are
intentional there.

### Adding a carrier

You must touch **both** halves: append a suggestion to `PROFILE_SUGGESTIONS`
**and** add its PLMN to `PLMN_TABLE` in `lib/carrier-match.ts`. A suggestion no
matcher returns is dead code; a match with no suggestion renders nothing. The
assertion harness enforces both directions (every table id resolves to a recipe;
every recipe is reachable from the table).

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
