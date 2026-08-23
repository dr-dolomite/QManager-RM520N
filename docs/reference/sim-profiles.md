# Custom SIM Profiles

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

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
| Shared APN attach-cycle primitive | `scripts/usr/lib/qmanager/apn_apply.sh` → `/usr/lib/qmanager/apn_apply.sh` |
| APN bracket lock | `/tmp/qmanager_apn_apply.lock` (fd 8; separate from `qcmd`'s `/tmp/qmanager_at.lock`) |
| Apply daemon | `scripts/usr/bin/qmanager_profile_apply` |
| Apply state file | `/tmp/qmanager_profile_state.json` |
| Apply PID lock | `/tmp/qmanager_profile_apply.pid` |
| CGI endpoints | `scripts/www/cgi-bin/quecmanager/profiles/*.sh` |
| Frontend hook | `hooks/use-sim-profiles.ts`, `hooks/use-active-profile.ts`, `hooks/use-current-settings.ts`, `hooks/use-profile-suggestions.ts` |
| Frontend types | `types/sim-profile.ts`; `types/connection-scenario.ts` — **the one definition of `DEFAULT_SCENARIOS`** |
| Frontend page | `app/cellular/custom-profiles/` — **the single route for this feature.** `app/cellular/custom-profiles/connection-scenarios/page.tsx` is a retired route that now client-side redirects here |
| Frontend components | `components/cellular/custom-profiles/` (coordinator `custom-profile.tsx`, hero `active-profile-hero.tsx`, Today strip + ribbon `schedule-ribbon.tsx`, wizard `custom-profile-form.tsx` hosted by `profile-form-dialog.tsx`, list `custom-profile-view.tsx` — which also renders suggestion rows — dialogs `apply-progress-dialog.tsx` and `deactivate-progress-dialog.tsx`, geometry/tone contract `shapes.ts`, scenario label resolution `scenario-labels.ts`) |
| Schedule strip math | `lib/schedule-timeline.ts` (`buildDayTimeline`, `nextScenarioChange`, `formatMinute`) |
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
| 1 | `apn` | Compare `settings.apn` vs. the **negotiated** APN (`AT+CGCONTRDP=<cid>`). If it already matches (case-folded), mark `skipped`. If different, run the full write-first attach cycle through the shared `apn_apply.sh` primitive and mark `done` only once the network confirms the new APN. See [The APN step runs a full attach cycle](#the-apn-step-runs-a-full-attach-cycle) below. |
| 2 | `ttl_hl` | Compare `settings.ttl` / `settings.hl` vs. the persisted iptables state, then apply via `ttl_state_apply` if drifted. |
| 3 | `scenario` | If `settings.scenario_id` is set, resolve it (built-in or custom) and call `scenario_apply` from `scenario_mgr.sh`. Persists the result to `/etc/qmanager/active_scenario`. |
| 4 | `imei` | If `settings.imei` is set and differs from `AT+EGMR=0,7`, write the new IMEI via `AT+EGMR=1,7` and trigger a soft reboot (`AT+CFUN=1,1`). |

### The APN step runs a full attach cycle

**Short version:** writing the APN into the modem is not the same thing as
telling the carrier about it. Step 1 therefore detaches and re-attaches the
radio, then asks the network what it actually granted before reporting `done`.

"Attach" is the moment the modem registers with the carrier's packet core and is
handed the data bearer it will use for the rest of the session. On LTE / 5G-NSA
the APN for that **default EPS bearer** is a contract field carried in the
Attach Request to the MME (the core's control-plane gateway) and the PGW (the
gateway that issues the IP) — it is read *at attach time*. So an
`AT+CGDCONT` write on its own only edits a stored setting the modem is no
longer consulting; the network keeps serving the old APN until a fresh Attach
Request goes out. `AT+CGACT=0/1` is **not** a substitute: it tears down and
rebuilds the modem-side user-plane of an already-established bearer, and the MME
keeps the original APN throughout.

#### Why this was wrong before, and why it hid

Earlier builds of `qmanager_profile_apply` issued the `AT+CGDCONT` write **and
nothing else** — no `COPS` bracket, no `CFUN` cycle. Applying a profile that
changed the APN reported every step green while the modem stayed attached on the
old APN, until something else forced re-registration (a manual reconnect, a
watchdog recovery, or a reboot — including the one step 4 triggers when the
profile also overrides IMEI, which is why the symptom looked intermittent).

The gap was **self-concealing**, which is the load-bearing insight here: the
step's skip-check compared against `AT+CGDCONT?` — the *configured* view, which
merely echoes back whatever was last requested. One bracket-less write made
`AT+CGDCONT?` match, so a retry reported `skipped` while the bearer was still
stale. Only `AT+CGCONTRDP=<cid>` — the *negotiated* view, what the network
actually granted — can verify that an APN apply took. Any future change to this
step must keep verifying against `CGCONTRDP`, never `CGDCONT?`.

#### What runs now

Step 1 calls `apn_apply_write` from the shared primitive
`/usr/lib/qmanager/apn_apply.sh` (source: `scripts/usr/lib/qmanager/apn_apply.sh`),
the same primitive `cellular/apn.sh` and `profiles/deactivate.sh` use — one
implementation, one set of timings, one return-code contract. The canonical
sequence is **write-first**:

```
AT+CGDCONT=<cid>,"<pdp>","<apn>"   sleep 3
AT+COPS=2                          sleep 1     (detach / deregister)
AT+COPS=0                          sleep 3     (re-attach, up to 3 tries)
AT+CGCONTRDP=<cid>                 poll, 1s interval, 15s ceiling
```

Write-first — not detach-first — so a failed `AT+CGDCONT` returns with the modem
untouched and **still registered**, instead of leaving it to recover from an
already-deregistered state. The verify poll's 15s/1s figures are tuned to
hardware measurement: the negotiated APN became readable ~1.25s after `AT+COPS=0`
returned `OK`, ~4s in the worst observed run on a live GLOBE SIM.

The step's own pre-check is likewise against `AT+CGCONTRDP=<cid>`, case-folded:
APNs are DNS-style labels and case-insensitive per 3GPP, and a live device
negotiated `INTERNET.GLOBE.COM.PH` in uppercase for a profile stored as
`internet`. A byte-for-byte compare would re-run the whole bracket on every
trigger (boot, SIM-slot switch, watchdog SIM failover, manual re-activate) for an
APN that was already correct. Only the comparison folds — every reported and
persisted string keeps the original casing the network returned.

A profile with an empty `settings.apn.name` (a legitimate IMEI-only or TTL-only
profile) short-circuits to `skipped` **before any AT command**; the primitive
will not bracket-cycle a blank APN unless a caller explicitly opts in with
`allow_empty=1`, which only the two deliberate revert-to-carrier-default callers
do.

#### Step outcomes

`apn_apply_write` returns a numeric code that the step maps onto the ledger:

| rc | Meaning | Step status |
|----|---------|-------------|
| 0 | Verified — the network negotiated the requested APN | `done` |
| 1 | `AT+CGDCONT` write failed — modem untouched, still registered | `failed` |
| 2 | `AT+COPS=2` failed — modem unchanged | `failed` |
| 3 | `AT+COPS=0` failed on every retry — modem may be left **DEREGISTERED** | `failed` |
| 4 | Re-attached, but the negotiated APN differs from the request | `failed` |
| 5 | Re-attached, but `AT+CGCONTRDP` returned nothing before the ceiling | `failed` |
| 6 | Empty APN, no opt-in — no AT commands issued | (pre-empted by the empty-APN skip above) |
| 7 | Another APN bracket is in progress — no AT commands issued, retryable | `failed` |

The 4-step ledger has no distinct "critical" or "retry" status, so the severity of
rc=3 and the retryable nature of rc=7 ride entirely in the step's `detail`
string. See `apn_apply.sh`'s header for the full contract.

> ⚠️ WARNING: Applying a profile that changes the APN **drops the cellular WAN**
> for the duration of the detach/re-attach (roughly 8-15 seconds). The QManager
> HTTP session and SSH reach the modem over LAN/Wi-Fi, so they are not affected.

#### Concurrency, the recovery flag, and signals

Three details worth knowing before touching this path:

- **Bracket lock.** The whole write-detach-attach-verify sequence is serialized
  by an advisory `flock` (a "do not disturb" sign on a file — only one process
  can hold it) at `/tmp/qmanager_apn_apply.lock`, held on file descriptor 8.
  This is deliberately **separate** from `qcmd`'s per-command lock at
  `/tmp/qmanager_at.lock` (fd 9): `qcmd`'s lock serializes exactly one AT
  command, but `AT+COPS` is *global attach state*, so the whole multi-command
  bracket needs its own mutex — otherwise the root worker and a concurrent CGI
  save could interleave their detach/verify windows. The bracket lock is always
  the outer of the two, strictly nested, so there is no deadlock. The worker
  waits up to 30s for it (it is unattended, so it should win the retry); the
  synchronous CGI paths cap their wait at 5s.
- **Recovery-flag suppression stays with the worker.** `apn_apply.sh` never
  touches `/tmp/qmanager_recovery_active`. The worker raises it through two
  optional callbacks the primitive feature-detects — `apn_apply_on_bracket_start`
  (called once the lock is actually held, so a run that ends in `apn_busy`
  never suppresses anything) and `apn_apply_on_bracket_end`. See
  [The recovery flag is multi-UID](#the-recovery-flag-is-multi-uid) below for
  the claim protocol; suppression is **best-effort**, and a bracket that cannot
  claim the flag proceeds unsuppressed rather than blocking.
- **Signals.** The primitive borrows `INT`/`TERM` for the bracket so a signal
  arriving between the detach and the re-attach still forces `AT+COPS=0`. It
  releases the trap to the shell's *default* disposition on return, so
  `apply_apn` re-asserts `trap cleanup EXIT INT TERM` immediately afterwards.
  `SIGKILL` and power loss cannot be trapped; if either lands mid-bracket the
  modem is left deregistered until `qmanager_watchcat`'s own Tier 1 recovery
  notices.

#### The apply worker runs as two different users

`qmanager_profile_apply` is not "the root worker", despite what its own comments
used to say. It runs as:

| Spawned by | Runs as |
| ---------- | ------- |
| `profiles/apply.sh` (the UI "Activate" button) | **`www-data`** — invoked with no `sudo`; the binary is not setuid and has no sudoers entry |
| `cellular/settings.sh` → `profile_mgr.sh`'s `auto_apply_profile` | **`www-data`** — same |
| `qmanager_poller` (boot auto-apply) | **root** |
| `qmanager_watchcat` | **root** |

Every `/tmp` file it touches is therefore a cross-UID file, and `/tmp` on this
device (`root:root` 1777, `fs.protected_regular=1`) makes both the write and the
unlink direction-dependent and silently failing. The rules and the kernel
mechanics live in [tmp-file-ownership.md](tmp-file-ownership.md); what matters
here is the three files:

- **`/tmp/qmanager_profile_state.json`** — seeded `root:root 0666` by
  `qmanager_setup`. `write_state()` builds into `${STATE_FILE}.tmp.$$`, refuses
  to publish a zero-byte render, then **copies it through the existing inode**.
  It must never go back to `mv`: an earlier `mv` meant the boot-time *root*
  apply swapped in a root-owned inode at umask 0022, after which every
  `www-data` UI Activate silently failed to record progress and the dialog
  showed the **stale boot-run result**.
- **`/tmp/qmanager_profile_apply.pid`** — seeded the same way, and `cleanup()`
  **truncates** it (`: >`) rather than unlinking. The lock decides on *content*
  (`profile_check_lock` tests `[ -n "$pid" ] && [ -d /proc/$pid ]`), so an empty
  file reads as unlocked — equivalent to the unlink, but it keeps the shared
  inode alive. One root-run `rm -f` voided the seed for the rest of the boot and
  let two applies run concurrently.
- **`/tmp/qmanager_recovery_active`** — see below.

Because in-place writes give up `rename(2)` atomicity, `profiles/apply_status.sh`
must tolerate a **torn read**: it re-reads and re-validates the state file with
`jq -e .` immediately before serving, and degrades to a valid `"applying"`
envelope rather than forwarding partial bytes (the frontend parses the body as
`ProfileApplyState`, so malformed JSON would surface as a hard failure of an
apply that is progressing fine). It also treats a zero-byte file as `idle` —
that is the boot seed, and the check must stay **ahead** of the staleness
branch, because a seed's mtime is Jan 1970 until the clock steps and would
otherwise compute as arbitrarily stale. `profiles/apply.sh` likewise resets the
file by writing a schema-valid `"applying"` envelope in place instead of `rm`ing
it.

#### The recovery flag is multi-UID

`/tmp/qmanager_recovery_active` is raised by both `qmanager_profile_apply`
(around an APN attach cycle) and `qmanager_watchcat` (at all six of its recovery
sites), from either UID. It is **deliberately not seeded** — its mere existence
means "suppress", so pre-creating it would mute the device for the whole uptime.

Ownership is therefore **claimed by verification, never assumed**. `_apn_rf_claim()`
unlinks, writes `$$`, and **reads it back**; `_apn_rf_owned=1` only on a match.
Failure is not fatal — the bracket proceeds **without** suppression and says so
in the log, because an APN apply that cannot suppress alerts is still a correct
APN apply. Both clear sites (`cleanup()` and `apn_apply_on_bracket_end`) verify
the file is actually gone afterwards and warn if it is not: a stranded flag pins
`qmanager_ping`'s `during_recovery`, which freezes every alert and internet event
until reboot.

The decision table at bracket start:

| Flag state | Action |
| ---------- | ------ |
| Absent | Claim |
| Present, **empty** | Foreign owner (an *older* watchcat's bare `touch`, which an OTA can leave running against the new binary). Leave alone, and never age out — an empty flag carries no owner to judge |
| Present, **dead PID** | Reclaim |
| Present, **live PID**, age ≤ 120 s | Leave alone |
| Present, **live PID**, age > 120 s | Reclaim — the PID is almost certainly wrapped |

`APN_RECOVERY_FLAG_MAX_AGE=120`, not 300: PID churn was **measured** at ~100
PIDs/s, so the 32768-PID space wraps in ~325 s and 300 would have been 92% of a
full wrap. And an age above `APN_RECOVERY_FLAG_MAX_PLAUSIBLE_AGE=86400` is
treated as **no evidence** rather than as staleness — this device boots at Jan
1970 and steps its clock ~24 s in, so a flag created before the step computes an
age of ~56 years and would otherwise trigger a wrongful reclaim of a live flag.
Full derivation: [tmp-file-ownership.md](tmp-file-ownership.md).

#### Deactivating a profile reverts the APN first

`profiles/deactivate.sh` uses the same primitive to undo the APN a profile
wrote: `apn_apply_write 1 "IPV4V6" "" 1` — a blank APN on CID 1 with
`allow_empty=1`, i.e. a deliberate revert to carrier default. A profile-written
APN must not outlive the profile.

The **order is load-bearing**: the revert runs *before* the profile state is
cleared. If the revert fails partway (rc=3/5 — modem deregistered or
unconfirmed), the profile stays marked active and its scenario schedule stays
armed, and the response reports `success:false`. That is the honest half-state:
the modem really is still on (or ambiguously on) the profile's settings, and the
UI keeps showing it as active. Clearing state first would produce the opposite —
a UI reporting "no active profile" over a modem still deregistered or still on
the old APN, which is far harder to notice.

The PDP type is fixed to `IPV4V6` here: this endpoint clears the active-profile
marker rather than reading it field-by-field, and `IPV4V6` is the same fallback
`apply_apn` and `apn.sh` use elsewhere.

**Verified on hardware:** the negotiated APN moved `internet.globe.com.ph` →
`http.globe.com.ph`, held stable at +0/+10/+30s, `+CEREG: 0,1` (registered)
throughout, and the bearer address changed — confirming a genuine re-attach
rather than a local re-allocation. A repeat apply correctly reported `skipped` in
3.0s versus 11.1s for a real apply.

##### The frontend contract: one blocking request, no status endpoint

**Short version:** deactivate is not a spawned worker with a progress file. It
is a single HTTP request that does not answer for 8-12 seconds, and the UI has
nothing to poll while it waits.

That asymmetry with the apply path is the whole design constraint. `apply.sh`
spawns `qmanager_profile_apply` and returns immediately, so the dialog can poll
`apply_status.sh` and draw a real ledger. `deactivate.sh` calls
`apn_apply_write` **synchronously, in the CGI process**, so the browser is
holding an open connection for the entire attach cycle. Adding up
`apn_apply.sh`'s own sleep constants (3 after `AT+CGDCONT`, 1 after
`AT+COPS=2`, 3 after `AT+COPS=0`) the **hard floor is 7 s**; the realistic band
is 8-12 s, and the worst case with all three attach retries plus a full
`AT+CGCONTRDP` poll ceiling is ~25-33 s.

`components/cellular/custom-profiles/deactivate-progress-dialog.tsx` is the
surface. It has a `confirm` → `working` phase, refuses to close while `working`
(the request keeps running whether or not the dialog is on screen, and closing
mid-flight strands the user with no route back to the only feedback there is),
and names the WAN interruption in its body copy.

> ⚠️ WARNING: **The deactivate dialog deliberately renders no step ledger.**
> There is no status endpoint, so any step rows here would be invented rows
> advanced by a timer — exactly the theatre the State-Honesty Rule forbids. What
> is honestly known is "the request is in flight" and "roughly how long that
> takes", and that is precisely, and only, what it says. Do not "improve" it
> into a sibling of `ApplyProgressDialog` without first giving `deactivate.sh` a
> real worker + state file.

The reason this needed a purpose-built dialog at all is worth recording:
deactivate previously lived on a Radix `<AlertDialogAction>`, which **closes the
dialog synchronously on click**. The `isDeactivating` pending state was
therefore rendering into an unmounted dialog, and there was no toast either
(`custom-profile.tsx` imported no `sonner` and discarded the return value). The
user pressed Deactivate and watched nothing happen for ten seconds.

##### Four readings of five backend codes

`deactivateProfile` in `hooks/use-sim-profiles.ts` returns a structured
`DeactivateResult { ok, error?, detail? }` rather than a bare boolean. A boolean
collapsed four materially different modem states into one message:

| Backend `error` | rc | What the modem is actually in | UI reading |
|-----------------|----|-------------------------------|------------|
| `apn_busy` | 7 | The bracket lock was held. **No AT command was issued; nothing changed.** | **Warning** toast, explicitly retryable, deliberately non-alarming |
| `cops_attach_failed`, `detail` contains `"may be DEREGISTERED"` | 3 | `AT+COPS=0` failed all three retries — the modem may have no data | **Error** toast. The only destructive-tone state here |
| `cops_attach_failed`, any other detail | 5 | Re-attached, but `AT+CGCONTRDP` never confirmed. Ambiguous | **Warning** toast. Unknown future codes under this error default here — the safer mistake |
| `cgdcont_failed` / `cops_detach_failed` / `apn_revert_failed` / `network_error` | 1 / 2 / other / n/a | Modem untouched and still registered | **Error** toast carrying the backend `detail` verbatim |

`network_error` is synthetic: the hook sets it when the request never produced a
JSON envelope at all, so a caller can always branch on a code rather than on the
absence of one.

> ⚠️ WARNING: **The failure path must never refetch, and no blanket
> `finally { refresh() }` may be added.** `deactivate.sh:91–102` deliberately
> `exit 0`s *before* `clear_active_profile` on any revert failure, so on a
> failure the profile really **is** still active and its schedule timer really
> **is** still armed. The hook therefore returns **before** `fetchProfiles()` on
> both the error and the network-failure branch. An "always refetch after a
> mutation" reflex would destroy the honest half-state this ordering exists to
> preserve — see the ordering note above.

A successful deactivate needs no cache invalidation either: it clears the active
marker, so `activeProfileId` genuinely changes and every effect keyed on it
re-runs on its own. (Contrast this with the edit-while-active path, where the id
does *not* change — see
[Saving an active profile auto-reapplies it](#saving-an-active-profile-auto-reapplies-it).)

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
| `settings.scenario_id` set to `gaming` / `streaming` / `custom-*` | The Connection Scenarios **card** (now on `/cellular/custom-profiles`) **and** the Band Locking page | Scenarios: banner + "Activate" buttons disabled (with tooltip on hover explaining why). Band Locking: full disable. |
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

## Frontend UI — one page, one feature

Custom SIM Profiles and Connection Scenarios are **a single page** at
`/cellular/custom-profiles`. They were two routes and two sidebar entries until
the merge; a profile has always *contained* a scenario binding, so splitting the
two meant a user had to leave the page they were configuring to create the thing
it needed. Everything below is **frontend-only** — the data model, CGI contract,
and apply pipeline described above are untouched, and no backend script was
modified by the merge.

### Page anatomy, top to bottom

1. **`CellularPageHeader` + two pill actions** — "New scenario" (tonal) and
   "New profile" (primary). Two creation verbs on one page, ranked by which one
   a user reaches for more often. The shared `/cellular/` header component owns
   the Display step's `tracking-[-0.02em]`; the page does **not** hand-write an
   `<h1>` against `PAGE_TITLE` any more.
2. **The "in force now" hero** (`active-profile-hero.tsx`, `rounded-hero`) —
   what the modem is running *right now*, answered before the list of things it
   could run instead. 52 px glyph disc, eyebrow + profile name, MNO + ICCID,
   a status `Badge`, Edit / Deactivate; at most **one** inline notice (which may
   itself carry a recovery action — see [the partial notice
   below](#closing-the-apply-dialog-on-partial-used-to-strand-the-recovery));
   and three tiles (Identity · Scenario in force · Radio owned-by-scenario).
   When no profile is active, or when its detail read fails, the whole card is
   replaced by a state screen — an empty hero would be a card reporting nothing.
   The slot has **three** components in it and they share one scale; see
   [The hero slot is three components on one
   scale](#the-hero-slot-is-three-components-on-one-scale-hero_state).
3. **The Today strip** (`ScheduleTodayCard` in `schedule-ribbon.tsx`,
   `PROFILE_CARD_PEER`) — the 24-hour schedule, given the full page width. It is
   a **peer** card, not a second hero, and it renders only while a profile is in
   force. See [The 24-hour schedule ribbon](#the-24-hour-schedule-ribbon).
4. **A two-column grid** (`@4xl/main:grid-cols-[1.15fr_1fr]`) — saved profiles
   beside the Connection Scenarios card. Container query, not a viewport
   breakpoint, per the project's responsive rule.

> ℹ️ NOTE: **The hero owns the surface's only `rounded-hero`.** Everything
> below it — the Today strip, the profile list, the scenario grid — is
> `PROFILE_CARD_PEER` (36 px `rounded-card`). A surface gets exactly one anchor,
> and the hero has it. That is why the Today strip, which reads as a second
> banner, is deliberately a step down in radius.

Everything the hero renders is **derived from real state**; there is no
`showMismatchNotice`-style boolean prop, because a notice driven by a flag the
caller passes in is a notice that can be wrong while looking right. Notice
priority is `applying → partial → mismatch`, at most one at a time: the in-flight
apply is the only fact still changing, a partial apply is a finished event the
user must act on, and a SIM mismatch is a standing condition the identity badge
already announces on its own.

> ⚠️ WARNING: That principle has to be enforced one level deeper than the prop
> list. `applyState` is a *struct*, but the caller's choice of **which** apply to
> pass it is exactly the boolean the header refuses — see [The hero reads only
> its own apply](#the-hero-reads-only-its-own-apply).

### The retired `connection-scenarios` route

`app/cellular/custom-profiles/connection-scenarios/page.tsx` still exists, but
only as a **client-side redirect** to `/cellular/custom-profiles`. Its sidebar
nav item is gone (`components/app-sidebar.tsx`).

> ℹ️ NOTE: **Why it can't be a real redirect.** QManager ships as a Next.js
> *static export* (`output: "export"`) served by lighttpd off the modem — there
> is no Node process at runtime, so `next.config`'s `redirects()` never executes
> (it is a dev-server-only feature here) and nothing can emit a 308. The
> navigation has to happen in the browser after the exported HTML loads. It uses
> `router.replace`, never `push`: a redirect that leaves itself in the history
> stack traps the Back button in a loop between the two pages. It renders a real
> centred spinner rather than a blank frame — on the modem's own CPU that frame
> is not always instantaneous, and a white flash reads as a broken link.

The redirect translates the old route's `?action=create` into
`?action=create-scenario` on the way through (the merged page hosts two create
flows, so a bare `create` no longer says which one) and passes any other params
untouched.

### The create/edit wizard now lives in a dialog

`custom-profile-form.tsx` — the 4-step wizard documented below — is
**unchanged**. What changed is where it is mounted: it moved from a permanently
occupied left column into `profile-form-dialog.tsx`, so the page's default state
is "here is what's running and what you've saved" rather than "here is an empty
form."

`DialogContent` is `p-0 gap-0 rounded-card overflow-hidden`, so the wizard's own
`<Card>` *is* the dialog body — a padded dialog around a card would double-frame
it, two nested rounded containers and two titles saying the same thing. Radix
still requires an accessible name, so `DialogTitle` / `DialogDescription` are
rendered `sr-only` and the wizard's card header stays the single visible one.
The body scrolls (capped at `85dvh`, `dvh` so a collapsing mobile URL bar can't
cut it off); a four-step wizard on a landscape field tablet would otherwise push
its own submit button out of reach.

The wrapper decides exactly one thing — whether the dialog closes. `onSave`
returns the profile id on success and `null` on failure; a non-null id means the
profile landed on the device and the input is safe to discard, while `null`
means everything the user typed is still the only copy of it, so the dialog
deliberately stays open.

> ℹ️ NOTE: **The footer's secondary button closes the dialog in both modes.**
> It used to branch — edit closed, *create* wiped every field and threw you back
> to tab one — and it was labelled honestly for it ("Clear" vs "Cancel"). The
> pairing was still wrong: the slot beside a submit button in a dialog footer is
> where a user reaches **without reading** when they want out, and in create
> mode that reach destroyed a four-tab wizard's worth of typing with no undo. A
> destructive action sharing a position with a non-destructive one is a
> mis-click trap regardless of its label. `handleCancel` now calls `onCancel()`
> first; the field reset survives only as the fallback for a caller that mounts
> the form outside a dialog, which `ProfileFormDialog` — the only caller today —
> never is. The label is always `custom_profiles.form.cancel`, and
> `custom_profiles.form.clear` was deleted from all five packs.

### The active row is neutral plus a ring, not a green fill

`profileRowTone()` returns a neutral `surface-container` fill for **all three**
statuses. The active row is distinguished by a **2 px inset primary ring**
(`PROFILE_ROW_ACTIVE_RING`), not by a fill.

The reason is what the row *contains*: a wrapped strip of tags. Step 1 of a tone
family is tuned to carry `on-surface` ink at full contrast, not to host another
container inside itself — on a tinted row the tags lost the separation that was
the only thing distinguishing them from their background. Emphasis therefore
moved to channels the row's contents don't compete for: the ring, the 40 px
glyph disc (`PROFILE_ROW_DISC_TONE`), and the status chip.

> ℹ️ NOTE: **This is not a No-Hairline-On-Fill violation.** That rule bans a
> stroke drawn to prop up a fill too weak to read on its own; here the fill is
> neutral *by intent* and the ring is the emphasis itself. It is drawn as an
> inset `box-shadow`, not a `border`, so it occupies no layout box — active and
> inactive rows stay pixel-identical in size, where a real border would shift
> every child by 2 px the moment a row activated. The scenario grid marks its
> in-force tile with the same exported constant, so the two can never disagree
> on the ring's weight.

> ⚠️ WARNING: **`mismatch` no longer keeps a tonal fill — do not restore one.**
> An earlier generation painted the mismatched row `--tone-warning-1`, which is
> a legitimate construction in the ramp's own idiom (the cell scanner still uses
> it correctly for a stacked condition band) and wrong *here* for two reasons.
> A mismatch is a property of the profile's **binding**, not of the row's
> existence, so painting the whole row makes the SIM the loudest object on a page
> whose subject is the profile. And warning would then be spent twice in the same
> row — once on the fill, once on the chip that says "SIM changed" in words —
> where only the chip survives a colourblind read. `mismatch` now shows as a
> `bg-warning` glyph disc plus a `warning` `Badge`; the body stays neutral.

### The 24-hour schedule ribbon

`lib/schedule-timeline.ts` + `components/cellular/custom-profiles/schedule-ribbon.tsx`
render a profile's scenario schedule as a proportional strip of the day. The
module exports three things:

| Export | What it is |
|--------|-----------|
| `ScheduleTodayCard` | The **peer card** that sits directly under the hero — a summary sentence ("Balanced in force until 18:00, then Speed"), the "Schedule armed" readout, the labelled ribbon, and an **Edit schedule** action in its `CardAction` slot. `ScheduleTodayCardSkeleton` mirrors it. |
| `ScheduleRibbon` | The track itself: segment names, windows, a needle at the current minute, an hour axis. |
| `ScheduleMiniBar` | The 8 px band a profile **row** carries — a *glyph* for "this profile has a schedule and here is its shape", not a readable timeline, which is why it animates nothing and stays `aria-hidden` (the row's own text line already states the schedule in words). Hidden below `@lg/card`. |

> ℹ️ NOTE: **The ribbon left the hero on 2026-08-21 and should not be put back.**
> It used to be a band at the bottom of the hero card, competing with three
> tiles and two buttons for the same ~400 px — at that width a 20-minute block
> resolves to about eight pixels, i.e. a proportional graphic with no room to be
> proportional. Given the full page width it answers a question the old layout
> did not answer at all: *what is the shape of today*. The hero consequently no
> longer takes `now` or the scenario list, and builds no timeline.
>
> The card renders **only while a profile is in force**. An unscheduled profile
> still has a true strip to draw (one scenario, all day), but a page with
> nothing active has no schedule to be the shape of, and the hero's empty state
> has already said so in words.

The track is a single `surface-container` pill with `overflow-hidden`; segments
sit inside it separated by a 3 px gap through which the track shows. That gap is
what separates two adjacent idle blocks, so the segments need no second tonal
step and no hairline. The in-force segment takes `--primary` (`RIBBON_SEGMENT_LIVE`)
— the **fill** layer, since a bar fill is exactly what that layer is for. Primary
here does not describe the scenario; it marks which block is running. Scenarios
separate from each other by **glyph**, never by hue.

`buildDayTimeline(schedule, fallbackScenarioId, now)` is pure and takes `now` as
a **parameter**, never an implicit `new Date()`. One clock is passed down from
the page, so the needle, the "next change at" caption and every row's mini bar
are computed against the same instant — and every function is unit-testable
without freezing global time.

It is implemented as a **painter's pass over 1440 one-minute slots** rather than
interval arithmetic: blocks are painted in reverse array order into a
fixed-length array, then adjacent slots carrying the same scenario are collapsed
into runs. Gaps, midnight wraps and overlaps then fall out of paint order
instead of each needing its own branch, and the returned strip always totals
exactly 1440 minutes with no holes.

> ⚠️ WARNING: **`schedule-timeline.ts` is the third TypeScript-or-shell
> implementation of the schedule resolution rule** (alongside
> `scenario_mgr.sh::scenario_block_for_now` on-device and
> `lib/scenario-schedule.ts` for the "locked" badge), and the fourth counting the
> `OnCalendar` compiler. **They must stay in sync** — see
> [Resolution rule](#resolution-rule-must-match-byte-for-behavior-in-4-places).
> Two consequences are load-bearing and were chosen against a design brief that
> asked otherwise:
>
> - **Overlaps resolve FIRST-match-wins**, matching the device's
>   `$hits[0] // $dflt`. The mock's brief asked for last-wins; a ribbon painting
>   last-wins would draw a band the modem is not running.
> - **A block with an empty or absent `days` array is INERT**, never "every
>   day" — matching the device's `select(.days | index($dow) != null)`. The
>   editor always writes all seven days, so this only affects legacy records,
>   but reading empty as "all" would draw a strip the device will not honour.

Segments arrive by `scaleX` from a left origin, never by animating `width`: a
width animation is a per-frame layout pass on a CPU that is simultaneously
carrying the user's traffic. The strip is `role="img"` with an `aria-label` that
speaks the schedule in words ("Night Idle until 07:00, then Balanced until
18:00, …"), built from the same segments the bands are drawn from.

The ribbon is only honest because the on-device timer that enacts it is honest —
see [Scenario schedule windows](#scenario-schedule-windows-systemd-timer-not-crond)
and the fire guard note there.

**Edit schedule** (`onEditSchedule` → `handleEditSchedule`) opens the active
profile in the wizard **on the Scenario step**, not on Identity — see
[The 4-tab create/edit wizard](#the-4-tab-createedit-wizard-custom-profile-formtsx).
It is deliberately no longer an alias of `handleEditActive`: the two now differ
only in the `initialTab` they set, and collapsing them back would silently undo
the deep link.

### What the merged mount actually costs

Merging two pages into one means one mount now fires what used to be two pages'
worth of requests. Measured on the live modem:

| Fact | Detail |
|------|--------|
| **No AT contention** | Exactly **one** endpoint on the page touches the AT transport — `profiles/current_settings.sh` — and it takes `/tmp/qmanager_at.lock` once. `profiles/list.sh`, `scenarios/list.sh` and `apply_status.sh` are pure disk reads and never queue behind the modem. |
| **Whole-page cost** | Every page endpoint fired concurrently completes in **0.52 s wall**. |

> ℹ️ NOTE: **Known follow-up, not a defect.** The mount currently fetches
> `scenarios/list.sh` twice (`useConnectionScenarios` + `useScenarioList`) and
> `profiles/list.sh` twice (`useSimProfiles` + `useActiveProfile`, the latter
> also re-polling every 30 s). Each is a ~0.08 s disk read, so the waste is real
> but cheap — worth a shared cache when someone is next in these hooks, not
> worth a change on its own.

**Why the hero refetches the active profile by id.** `profiles/list.sh`
summaries **do** carry the full `scenario.schedule.blocks[]`
(`profile_mgr.sh:139–142`) — which is what lets every row draw its own
`ScheduleMiniBar` from list data alone — but they deliberately **omit
`settings`**, to keep the list endpoint lightweight. So the hero fetches the
active profile through `profiles/get.sh` for its Identity tile, and list rows
keep their per-row `getProfile` prefetch (which is also what feeds each row's
IMEI-override tag).

#### The hero's detail fetch needs a nonce — `refresh()` cannot invalidate it

**Short version:** editing the profile that is already active changes nothing
the hero's fetch effect was watching, so the hero showed the pre-edit record
forever. A counter in the dep array is the fix.

The effect in `custom-profile.tsx` that calls `getProfile(activeProfileId)` was
keyed `[activeProfileId, getProfile]`. Both dependencies refuse to move on
exactly the event that most needs to invalidate the record:

- `activeProfileId` is the **same id** before and after an edit — the profile
  that was active is still active.
- `getProfile` is a `useCallback(…, [])` in `hooks/use-sim-profiles.ts`, so it
  is stable for the lifetime of the hook.

So the effect never re-ran, and "indefinitely" is literal: there is no poll on
this page to bail it out. `useActiveProfile`'s 30 s timer is **disabled** under
`SimProfilesProvider`, and nothing else refreshes this surface in the
background. Everything derived from `activeProfile` went stale with it —
`activeScenario`, `nextFireByScenarioId`, `radioOwnedByProfile`, and the whole
`ScheduleTodayCard` below the hero.

> ℹ️ NOTE: **Calling the hook's `refresh()` does not fix this**, which is the
> non-obvious part. `refresh()` re-runs `fetchProfiles()`, which repopulates the
> *summary* list — and `list.sh` deliberately omits the `settings` object the
> hero renders (see above). It also cannot change `activeProfileId` while the
> same profile is still active, so the effect still would not fire.

The mechanism is a `detailNonce` counter bumped by `invalidateActiveProfile()`.
A monotonic counter is used precisely because it is the one signal that is
unequal to its predecessor **by construction** — no value equality, no reference
identity, nothing about the profile itself. It is bumped on save-of-active and
on apply-dialog close, and **deliberately not on deactivate**: a successful
deactivate genuinely changes `activeProfileId` to `null` so the effect re-runs
on its own, and a *failed* deactivate must not refetch at all (see
[the frontend contract](#the-frontend-contract-one-blocking-request-no-status-endpoint)).

Two smaller corrections ride along in the same effect:

- A detail `GET` that returns `null` no longer blanks the hero. `getProfile`
  returns `null` for a network failure and a missing record alike, and the
  **list** is the authority on what is in force — it still names this id. The
  effect keeps the previous record when it belongs to the same id, so a dropped
  request cannot flash `NoActiveProfile`. This matters more now that the nonce
  re-runs the fetch after every mutation instead of once per id change.
- `showHeroSkeleton` is now `!pageReady` alone, not `!heroLocallyReady ||
  !pageReady`. `pageReady` already ANDs `heroLocallyReady` into its latch, so
  the first reveal is unchanged — but the redundant term made every *later*
  `refresh()` tear the hero down to a skeleton and rebuild it, contradicting the
  latch's own adjacent comment. Auto-reapply-on-save makes that refresh routine
  rather than rare.

The hero ↔ `NoActiveProfile` swap also cross-fades now, via
`<AnimatePresence mode="wait" initial={false}>` on `DUR.quick` (360 ms) and
`EASE_STANDARD` from `lib/motion.ts`, following the
`components/local-network/ip-passthrough/ip-passthrough-card.tsx:295–372`
precedent. Against DESIGN.md's Enter-Only Rule: that rule governs **conditions**
and **navigation**, where something leaving means the condition cleared. This is
neither — the hero is a permanent anchor **slot** that always renders one of its
full states, and `mode="wait"` requires an exit by construction (without one the
two full-height cards co-mount for a frame and shove the page down and back).
Enter is opacity + `y:6`; exit is opacity only. The skeleton stays *outside* the
`AnimatePresence`, so the page's mount cascade is not doubled up with a
skeleton→hero cross-fade.

> ℹ️ NOTE: The swap is a **three**-way choice, not two — `activeProfile` →
> `heroDetailFailed` → `NoActiveProfile`, at
> `custom-profile.tsx:900–925`. See the next section for the third arm.

### Settlement is not success — the hero's permanent skeleton

**Short version:** the page's readiness gate asked "did the detail fetch produce
a record?" when the only safe question is "did the detail fetch *finish*?" One
failed `GET` at mount left the whole page — hero, Saved Profiles, and Connection
Scenarios — sitting on skeletons forever, with no error, no retry, and no way
out that the UI ever suggested.

`getProfile` (`hooks/use-sim-profiles.ts:353–379`) **never rejects**. It catches
internally and returns `null` for a dropped request, a non-2xx response, and a
genuinely missing record, all alike. Readiness read `activeProfile !== null`, so
those three outcomes were indistinguishable from "still loading". That flag ANDs
into the latching `pageReady` (`custom-profile.tsx:407–412`), which gates
`showHeroSkeleton` (`:428`) **and** is handed down as `holdSkeleton` to both
child cards (`:965`, `:973`) — so one failed request took down three surfaces.

One trigger is permanent rather than transient: if `list.sh` names an
`active_profile_id` whose JSON file is gone, `get.sh` fails on **every** attempt,
and the page is bricked across reloads.

> ℹ️ NOTE: Two plausible causes were investigated and **ruled out** — don't
> re-chase them. `isLoading` cannot stick, because `fetchProfiles` clears it in a
> `finally` block (`hooks/use-sim-profiles.ts:180–184`) that runs on the failure
> path too. And an expired session is not a trigger either: `authFetch` redirects
> to `/login/` on a 401 (`lib/auth-fetch.ts:11–15`), so the user leaves the page
> rather than watching it hang.

#### Settlement is stored as an ID, not a boolean

This is the reusable part. `settledDetailId` (`custom-profile.tsx:286`) holds
**the id that settled**, and it is set in *both* branches of the `.then()` at
`:302` — before the success/failure split, because a failed `GET` is a finished
`GET`; what it is not is a successful one. Readiness then derives from
`heroDetailSettled` (`:321–323`), which compares that id against the live
`activeProfileId`, and `heroLocallyReady` (`:404–405`) reads it instead of
`activeProfile !== null`.

Storing the *id* rather than a bare `true` is what makes the page's two
invalidation paths behave correctly out of one piece of state:

| Invalidation | What `settledDetailId` does | Result |
| ------------ | --------------------------- | ------ |
| **Nonce bump** (`invalidateActiveProfile`, same id) | Still equals `activeProfileId` | Page stays settled. A failed *refresh* never tears a revealed page back down — the same reasoning the `pageReady` latch and `showHeroSkeleton` already carry. |
| **Id change** (activate, deactivate, SIM swap) | No longer equals `activeProfileId` | Readiness drops, because the new id genuinely has not been read yet. |

A boolean cannot do both. `true` never resetting means an id change would reveal
a hero for a profile nobody had fetched; resetting it on every effect run means a
failed background refresh collapses a page the user is already reading.

Note the hero does **not** flash the error card during an id change: the effect's
null-guard (`:313`) keeps the *previous* record mounted, and the error arm only
renders once `activeProfile` is null **and** the current id has settled
(`heroDetailFailed`, `:331`).

#### The third hero state: `ActiveProfileUnavailable`

`ActiveProfileUnavailable` (`custom-profile.tsx:1095`) is the state that made
honest readiness possible: rendered at `:915–921` when settled-and-null, with the
hook's error string shown verbatim in machine voice and a Retry.

> ⚠️ WARNING: **Do not "fix" a stuck skeleton by reporting ready on error.**
> That is the obvious one-line change and it is wrong. With `activeProfile` null,
> reporting ready renders `NoActiveProfile` — a state screen that tells the user
> their modem is on the **stock APN and the default scenario**. That is a claim
> about hardware for which a failed read is not evidence, made to a user whose
> modem *is* running a profile. It is the exact flash the effect's null-guard
> (`:307–313`) exists to prevent, made permanent instead of momentary. The third
> state exists so readiness can be honest without lying about the device.

Two details on that card that are load-bearing rather than cosmetic:

- **Tone is `warning`, not `destructive`.** Nothing on the modem failed — our
  *read* of it failed. `destructive` is this system's confirmed-failure role, and
  spending it on an unreadable record trains the user to discount the tone that
  has to mean something next time. This is the same split `handleDeactivateConfirm`
  already makes between `rc=3` (deregistered → error) and `rc=5` (attached but
  unconfirmed → warning): ambiguity is warning, confirmed failure is destructive.
- **Glyph is `cloud_off`**, deliberately unlike `NoActiveProfile`'s
  `sim_card_alert`. The two share this slot, and per DESIGN.md's status-chip
  reasoning the glyph is the only channel separating them for a deuteranopic
  user.

Retry goes through the existing `invalidateActiveProfile` nonce (`:919`), **not**
`refresh()`. `refresh()` re-reads the *summary* list, which omits the very
`settings` object this card is missing — see
[the nonce section above](#the-heros-detail-fetch-needs-a-nonce--refresh-cannot-invalidate-it).

New keys `custom_profiles.hero_error.{title,description,retry}` ship in all five
locales.

#### The hero slot is three components on one scale (`HERO_STATE`)

`ActiveProfileHero`, `NoActiveProfile` and `ActiveProfileUnavailable` are three
states of **one box**, and they cross-fade **in place** through the slot's
`AnimatePresence mode="wait"`. Every number the three disagree on is therefore a
visible nudge at every swap, not a difference between three separate screens.

They disagreed on all of them. Discs were 52 / 56 / 56 px, glyphs 26 / 29 / 29,
and the title step was `text-[1.375rem]`/`-0.02em` / `text-xl`/`-0.01em` /
`text-lg`/no tracking. `NoActiveProfile` even carried a comment claiming its disc
was "imported rather than restated" — only the **fill** was imported; the
geometry was hand-written 4 px larger, so the comment described an intention.

`HERO_STATE` in `shapes.ts` now carries the rest of the slot alongside the
existing `HERO_DISC` / `HERO_DISC_TONE`:

| Member | What it pins |
|--------|--------------|
| `SHELL` | `items-center gap-3.5 py-12 text-center`, composed **onto** `HERO_CARD` — centring and vertical air only, never a second radius or fill. One padding for both state screens, so the slot's height barely moves across a swap (the error card used to sit 12 px shorter and the page nudged). |
| `GLYPH_SIZE` | `26` — the loaded hero's glyph. A 52 px disc reads differently with a 29 px glyph inside it, so importing the disc while restating the glyph leaves the drift half-fixed. |
| `TITLE` | `text-[1.375rem] font-semibold tracking-[-0.02em]`. |
| `BODY` | The sentence under it, `max-w-[34rem]`. |
| `DETAIL` | The backend's own error string in machine voice, at the **same** measure as `BODY` — two differently-capped columns under one centred heading read as a layout mistake, not a hierarchy. |

`HERO_NAME` is now `` `truncate ${HERO_STATE.TITLE}` `` and is byte-identical to
its previous hand-written value. Concatenating two *complete* class strings is
safe under Tailwind's JIT (it scans source text and `text-[1.375rem]` appears
verbatim in `HERO_STATE`); interpolating a **value** into a bracket is what is
not, and nothing here does that.

> ℹ️ NOTE: **The two exceptional states moved UP to the loaded hero's step, not
> the reverse.** The loaded state is what the user sees essentially always, so it
> is the one already calibrated against the 40 px `rounded-hero` shell hosting
> it — shrinking it to match a state that appears once would detune the common
> case to tidy the rare one. And the exceptional states are not *less* important:
> "a profile is in force and we cannot read it" is the most urgent thing this page
> can say, and it was rendering two steps below the state it interrupts.

> ⚠️ WARNING: **`ActiveProfileUnavailable` used to hand-write `bg-warning
> text-warning-foreground` inline** — a tone keyed onto a class string, which
> `CLAUDE.md` and `DESIGN.md` ban by name. `HERO_DISC_TONE` gained an **`error`**
> member holding those same two classes, and `"error"` is in the map's key union,
> so a future state without a fill fails the build instead of shipping untinted.
> `error` and `empty` therefore differ **only** in fill, which is exactly why
> `cloud_off` and `sim_card_alert` must never converge — the glyph is the only
> channel a deuteranopic user has here.

**Aria roles are picked by severity, not by symmetry.** `ActiveProfileUnavailable`
keeps `role="alert"` (assertive — it interrupts). `NoActiveProfile` takes
`role="status"`: a resting state the user themselves just caused by pressing
Deactivate must not interrupt a screen reader. Having **no** role at all, which
is what shipped, meant the swap out of the loaded hero went unannounced entirely.

#### "No profile is active" has two meanings, and they want opposite verbs

`NoActiveProfile` renders whenever `activeProfileId` is null. That says **nothing
whatever** about whether anything is *saved*, so one component covered two
situations — and it offered one label for both,
`custom_profiles.page.new_profile`.

That was wrong twice over. In the common case (the user just pressed Deactivate
on a populated roster) "New profile" is the wrong verb entirely — the thing to do
is put an existing profile back in force. And it was the **second** "New profile"
on screen: the page header's primary spends that exact key three inches above,
and two identical primaries on one screen make the second read as a mistake
rather than a choice.

The component now takes `hasSavedProfiles` (read from `profiles`, the summary
list — the only thing on the page that knows whether there is anything to
activate) and branches:

| Roster | Copy | Action |
|--------|------|--------|
| Populated | `hero_empty.description_saved` | **Activate a profile** (`play_arrow`) → jumps to the Saved Profiles card |
| Empty | `hero_empty.description` (unchanged) | **New profile** (`add`) → `handleNewProfile` |

> ⚠️ WARNING: **The activate branch MOVES; it does not act.** Activation is a
> modem mutation that costs an attach cycle and it already has exactly one home —
> the row's Activate plus its confirm dialog. Firing it from an empty state would
> require picking a profile *for* the user, which is the one thing an empty state
> must not do. `handleJumpToSavedProfiles` scrolls and focuses; it touches no
> endpoint. Do not "improve" it into a one-click activate.

Two details of the jump are load-bearing:

- **Focus moves with the scroll**, via `el.focus({ preventScroll: true })` on a
  `tabIndex={-1}` wrapper. A pure scroll leaves a keyboard user's focus on a
  button that has just left the screen, so their next Tab lands somewhere they
  cannot see — the jump would be sighted-only. `preventScroll` because
  `scrollIntoView` has already positioned the card; letting focus scroll too
  double-jumps past the `scroll-mt` offset. `useReducedMotion()` picks
  `behavior: "auto"` over `"smooth"`.
- **`SAVED_PROFILES_ANCHOR` carries an `h-full` that is not decoration.** The
  Saved Profiles `<Card>` is `h-full` and *was* the direct grid item, so its
  `h-full` resolved against the grid **area** and stretched it to the taller
  column. Interposing a wrapper makes the wrapper the grid item, and `h-full` on
  a `height: auto` parent resolves to `auto` — without it the card silently stops
  stretching and the two columns go ragged. The constant also carries
  `scroll-mt-20` (clears the sticky shell header) and a **`focus-visible`-only**
  ring: a plain `:focus` ring would also fire on the mouse path, drawing a 3 px
  halo round a whole card because someone clicked a button. Same shape as
  `band-locking.tsx`'s own scroll-target wrapper.

### Adopting an apply nobody on this page started

**Short version:** `useProfileApply` picks up an in-flight apply on mount, but
nothing opened a dialog for it — and the close handler is the only thing that
re-reads the profile list. So an adopted run that ended `failed` deactivated the
profile on the device while the page went on rendering it as in force,
indefinitely.

The adoption itself was already correct and predates this fix:
`hooks/use-profile-apply.ts:160–185` (`checkExisting`) reads `apply_status.sh` on
mount and resumes polling when it finds `status === "applying"`. A second browser
tab, a boot-time auto-apply, or this user navigating away and back inside the
8–12 s apply window all land there. What was missing is that the only three
things that ever set `showApplyProgress` (`custom-profile.tsx:604`) were direct
user actions, so an adopted run had no dialog behind it.

That is not merely a missing spinner. `handleApplyProgressClose` (`:668–681`) is
the **only** caller of `refresh()` + `invalidateActiveProfile()` on this path,
and a dialog that never opened never closes. A run ending `failed` takes the
`clear_active_profile` branch in the worker's finalize block, so the device
deactivates the profile while this page keeps rendering it — `useActiveProfile`'s
30 s poll is disabled under `SimProfilesProvider` and nothing else re-reads it. A
State-Honesty violation with a concrete, reachable failure mode.

The fix is an adoption effect at `custom-profile.tsx:644–651`. It only ever sets
`true`; closing stays entirely the close handler's job.

#### The re-open guard is the subtle part

> ⚠️ WARNING: An effect keyed on `applyState` alone re-opens the dialog on every
> render and the user can **never dismiss it**. `handleApplyProgressClose`
> deliberately leaves `applyState` in memory after closing — that is what lets
> the row keep showing "Applied at HH:MM" until the next activation (`:670–671`)
> — so the condition that opened the dialog is still true the instant it closes.

Two guards prevent that, and **both** are needed:

1. **It only fires on `status === "applying"`** (`:646`). Every state the user can
   close on is terminal (`complete`, `partial`, `failed`), so the close itself can
   never be undone by this effect.
2. **A ref remembers which RUN was adopted**, keyed on
   `` `${profile_id}:${started_at}` `` (`:644`, `:647–649`) — the backend's own
   run identity, unequal across runs by construction. That makes it one-shot per
   run even if a run somehow re-enters `applying` after a dismissal, and it cannot
   fight the three user-action set-sites: for those the dialog is already open, so
   marking the run adopted is a no-op.

### `pageBusy` disables; `busy` narrates

The active row's **Deactivate** button had no `disabled` guard at all in any code
path — the one control on this surface that could be clicked into a modem
mid-mutation. It is now gated, along with Reapply and Activate, through
`actionsLocked = busy || pageBusy` (`custom-profile-view.tsx:761`, applied at
`:913`, `:922`, `:941` — all three now live in the row's overflow menu, which is
where the single-line row anatomy put them). `pageBusy` is a prop on
`CustomProfileViewProps` fed from the page's existing `heroBusy` signal
(`custom-profile.tsx:961`, passed at `:1121`; the hero takes the same signal as
`busy` at `:1021`).

> ⚠️ WARNING: **Do not OR `pageBusy` into `busy` at the source.** This is the
> non-obvious invariant and the reason two flags exist for what looks like one
> concept.

The row's own `busy` (`custom-profile-view.tsx:493–495`) is scoped to
`lastApplyState.profile_id` — it means *this* profile is the one being applied —
and it does not merely disable, it **narrates**:

- it drives the row's status chip to "Applying" (`:747`), and
- it swaps Activate's glyph to a spinner and its label to "Activating…"
  (`:926–935`).

A page-wide flag flowing into those would make every idle row on the surface
claim it was being applied. So the two signals stay separate by role, recorded in
the props themselves at `:686` and `:688`: **the page-wide signal disables; it
does not narrate.**

Before the adoption fix this gap was masked rather than absent — both progress
dialogs are modal and non-dismissable while a mutation runs, so the list was
never clickable during one. An adopted apply has no dialog until the effect opens
it, which is what makes the unguarded button reachable. The two fixes are one fix.

### The hero reads only its own apply

**Short version:** `applyState` is the coordinator's **one** in-flight apply,
whichever profile it belongs to. The hero read it without checking whose it was,
so it could paint one profile's identity with another profile's verdict.

The list row has always scoped the identical read on `profile_id` before deriving
its `audit` / `busy`. The hero did not, in **six** places: `isApplying`,
`isPartial`, `applyingStep`, `failedStep`, and the applying notice's
`profile_name` and `current_step` / `total_steps`.

The reachable symptom is one click away. Activate profile B while A is in force:
the list is not refreshed until `handleApplyProgressClose` runs, so the hero is
still showing **A** — and it painted A's name and ICCID with B's "Applying" chip
and spinning disc, while the notice directly beneath interpolated **B's name**.
One card, two disagreeing claims about what the modem is doing.

> ⚠️ WARNING: **The `partial` case did not expire.** `handleApplyProgressClose`
> deliberately never resets `applyState` — that is what lets a row keep showing
> "Applied at HH:MM" until the next activation (see [the re-open
> guard](#the-re-open-guard-is-the-subtle-part)). So if the follow-up `refresh()`
> lost a race with AT-lock contention, a warning about **B's** failed step stayed
> pinned to **A's** name indefinitely.

The fix is one narrowing const at the top of the component, and every downstream
read goes through it:

```tsx
const selfApply =
  applyState && applyState.profile_id === profile.id ? applyState : null;
```

`applyState` itself is now mentioned exactly three times in the file — the prop
declaration, the destructure, and this line. **A grep that finds a fourth is a
regression**; add the read to `selfApply`'s derivation instead of reaching past
it.

#### Closing the apply dialog on `partial` used to strand the recovery

`showApplyProgress` cannot be re-set from the hero, so once the dialog was
dismissed on a `partial` verdict the hero was left naming a failed step with
nothing to act on. The only route back was the *row's* overflow menu, one card
further down the page.

`HeroNotice` gained an optional `action` slot, and `ActiveProfileHeroProps` an
optional `onReapply`. The partial notice renders **Reapply profile** inside
itself. Three choices there are deliberate:

- **It is in the notice, not the hero's action row.** That row is `Badge` + Edit
  + Deactivate at `gap-2`; Deactivate drops the data link for 8–12 s, and a third
  identically-weighted control beside it that also fires a four-step modem
  mutation reads as one more routine button rather than as the answer to the
  sentence above it. Inside the notice, the action sits at the **foot of the text
  column** — a right-aligned trailing sibling on an `items-start` row would sit
  level with the title and read as a control for the whole card, and would squeeze
  the prose it is meant to be secondary to at narrow widths.
- **It is `variant="tonal-neutral"`.** The notice is already a container pair, so
  a second *role* container inside it would put two tonal fills on one banner, and
  a `default` (brand fill) button would out-weigh the hero's own actions from
  inside a warning. `ghost` is **not** a safe substitute for hand-building a tonal
  button here: `ghost` carries `dark:hover:bg-accent/50`, which compiles to a
  `:is(.dark *)`-qualified selector that outranks any plain `hover:` override on
  specificity alone (the reasoning is on the `cva` in `components/ui/button.tsx`).
- **It is wired to `handleReapplyActive` → `handleReapply`, never
  `handleRetry`.** The two callbacks sit next to each other in `custom-profile.tsx`
  and look near-identical; the difference is that `handleReapply` sets
  `showApplyProgress(true)` and `handleRetry` does not — the latter is the
  *dialog's* own retry, called from inside a dialog that is already open. Wiring
  the hero to it would send four AT-writing steps at the modem with no ledger, no
  progress and no verdict on screen: the exact silent mutation the State-Honesty
  Rule forbids.

`onReapply` is optional, and the notice renders with no action when it is omitted
— the same clean degradation the rest of this card's optional handlers have. It
is "Reapply profile", never a per-step retry, because the backend can only re-run
all four steps or none.

### Saving an active profile auto-reapplies it

**Short version:** `profiles/save.sh` only writes a file. It never touches the
modem and never re-arms the scenario schedule timer — so editing the profile
that is currently active used to change the record and nothing else. Saving an
active profile now re-runs the full apply pipeline.

> ⚠️ WARNING: **Do not "fix" the stale hero without also fixing the stale
> timer.** These are two separate defects that had to be closed together.
> `scenario_install_schedule` is called from **exactly one place in the entire
> tree** — `qmanager_profile_apply:1112`, on the success branch of a run. It is
> not called by `save.sh`, which is a pure disk write (<400 ms, zero AT
> commands). So editing an active profile's schedule from 18:00 to 20:00 left
> the JSON on flash saying 20:00 while the armed `OnCalendar` timer still fired
> at **18:00**, and any APN / TTL / IMEI edit never reached the modem at all.
>
> Repairing only the hero's staleness (the `detailNonce` above) would have made
> the UI confidently draw a **20:00 ribbon for a timer that fires at 18:00** —
> a regression dressed as a fix, and strictly worse than the visibly stale card
> it replaced. The ribbon is only honest because the timer behind it is honest;
> anything that changes what the ribbon shows must also change what the timer
> does.

Re-applying is the only operation that brings both the modem **and** the timer
back in line, so `custom-profile.tsx` latches the edited id in
`pendingReapplyId` when the saved profile was the active one, and fires
`applyProfile` through the existing `profiles/apply.sh` → `apply_status.sh`
flow, opening the existing `ApplyProgressDialog`.

Two properties make this safe and cheap, both verified in the backend:

- **`apply.sh` has no "already active" rejection.** Its only block is the
  `apply_in_progress` PID lock, which `useProfileApply` already handles by
  following the run that is in flight.
- **A re-apply of an unchanged profile is nearly free.** Three of the four steps
  are self-comparing, and the APN step compares against `AT+CGCONTRDP` — the
  *negotiated* view — and marks itself `skipped` **without detaching** when it
  already matches. A rename-only save therefore re-applies in ~3 s with **no WAN
  drop**; only a genuine APN change pays the attach cycle.

**Ordering.** The wizard's `onSave` contract (`profile-form-dialog.tsx:59`,
`(data) => Promise<string | null>`) is unchanged — a non-null id closes the
wizard, `null` keeps it open so the user's typing survives. The apply is *not*
awaited inside `onSave`, so the two modals never overlap. `pendingReapplyId` is
cleared before firing, so a cancelled-then-reopened wizard cannot replay someone
else's apply.

> ⚠️ WARNING: **The apply used to be fired inline from `handleFormOpenChange`,
> reading `pendingReapplyId` off its own closure — and that closure was stale.**
> `handleSave` calls `setPendingReapplyId(editedId)` and
> `ProfileFormDialog.handleSave` calls `onOpenChange(false)` (i.e.
> `handleFormOpenChange`) in the same synchronous continuation, before React
> re-renders. `handleFormOpenChange`'s closure therefore still saw the
> *previous* render's `pendingReapplyId` (`null`), its `if (!pendingReapplyId)
> return;` guard exited, and `applyProfile` never fired on that call — the
> dialog only appeared once something else happened to re-invoke the callback
> later with a fresher closure, which read as a several-second, inconsistent
> "nothing happens, then the Applying dialog finally shows up." Fixed by
> splitting the two concerns: `handleFormOpenChange` now only writes `formOpen`,
> and a `useEffect` keyed on `[formOpen, pendingReapplyId, applyProfile]` fires
> the reapply once React has actually **committed** both facts — no closure to
> go stale, no race, and the dialog now opens immediately once the wizard
> closes.

**No toast was added** to either save or apply. `custom-profile-form.tsx:541–559`
already toasts the save, and `ApplyProgressDialog` is the apply path's feedback
channel; a toast on either would double-report the same event.

While a deactivate round trip or an apply is in flight, the hero's **Edit** and
**Deactivate** buttons both go dead (`ActiveProfileHero`'s new `busy` prop —
the card is 100% props and fetches nothing, so the coordinator has to tell it).
Edit is disabled too, not just Deactivate: saving an active profile is now a
modem mutation.

> ⚠️ WARNING: **A totally-failed auto-reapply deactivates the profile the user
> just edited.** `qmanager_profile_apply:1113–1117` calls `clear_active_profile`
> + `scenario_teardown_schedule` + `scenario_reset_to_default` whenever a run's
> terminal status is `failed` (i.e. *all* steps failed). This is documented
> risk, not a defect: it is pre-existing behaviour on the Activate and Reapply
> buttons, and auto-reapply adds a **trigger**, not a new failure mode. The UI
> reports it truthfully — the dialog shows the `failed` verdict with its
> destructive banner and a **Reapply profile** action, and closing it refreshes
> both the list and the detail nonce so the hero swaps to `NoActiveProfile`
> instead of continuing to claim the profile is in force. Nothing anywhere calls
> this outcome a success. See also the per-step-retry warning under
> [Apply-progress dialog](#apply-progress-dialog-apply-progress-dialogtsx),
> which is the same finalize block.

> ℹ️ NOTE: **Both follow-ups noted here have since been closed — do not
> re-open them as known issues.** The per-row Deactivate is no longer asymmetric
> with the hero's: it takes `actionsLocked` like Activate and Reapply (see
> [`pageBusy` disables; `busy` narrates](#pagebusy-disables-busy-narrates)). And
> `heroLocallyReady` now reads `heroDetailSettled` rather than
> `activeProfile !== null` (`custom-profile.tsx:413–414`), so a failed first
> `getProfile` renders `ActiveProfileUnavailable` instead of a permanent
> skeleton — see [Settlement is not
> success](#settlement-is-not-success--the-heros-permanent-skeleton).

### Historical context: the RM551E-parity redesign

The sections below describe the redesign that preceded the merge. The three
surfaces are the create/edit **wizard**, the saved-profiles **card list**, and
the **apply-progress dialog**, coordinated by `custom-profile.tsx`.

> ℹ️ NOTE: Verizon-specific UX is **omitted on RM520N** (it is RM551E-only):
> there is no CID-lock-to-3, no brick-guard dialog, no MPDN pill, and no
> `verizon_revert` reboot. The `vzw` MNO preset remains an ordinary, selectable
> preset — RM520N already carried it and it is not special-cased. The dormant
> `isVerizonActive` flag was removed from `hooks/use-active-profile.ts`.

### The 4-tab create/edit wizard (`custom-profile-form.tsx`)

The single-page form became a **4-tab wizard** with directional slide
animation (`motion/react`, reduced-motion aware). It is unchanged by the merge —
only its host moved, into `profile-form-dialog.tsx` (see [The create/edit wizard
now lives in a dialog](#the-createedit-wizard-now-lives-in-a-dialog)):

| Tab | Purpose |
|-----|---------|
| Identity | Profile name, MNO preset, SIM ICCID. **Load-from-SIM** quick-fill pulls the live ICCID/IMEI; a live **duplicate-ICCID guard** warns before you save a profile bound to an already-claimed SIM. |
| Network | APN name, CID, PDP type, TTL/HL, optional IMEI override. **"Use my saved APN"** quick-pick fills the APN from the current setting. |
| Scenario | Scenario binding + optional daily schedule windows (see [scenario picker](#scenario-picker-and-the-create-new-deep-link) below). |
| Review | Per-section summaries with edit-jump-back — clicking a section returns to its tab. Final Submit lives here. |

**The wizard can be opened on a step other than the first.** `WizardTab` is
exported from `custom-profile-form.tsx`, and an `initialTab` prop is threaded
`custom-profile.tsx` → `profile-form-dialog.tsx` → `custom-profile-form.tsx`,
defaulting to `"identity"`. Exactly one entry point uses anything else: the Today
strip's **Edit schedule** (`ScheduleTodayCard`'s `onEditSchedule`) opens on
`"scenario"`, because the schedule lives on that step and only that step —
landing on Identity first made the user re-walk three tabs to reach the thing
they had just clicked for. The coordinator therefore keeps `formInitialTab` in
state and every other opener (`handleNewProfile`, `handleEdit`,
`handleEditActive`) resets it to `"identity"` explicitly, so a schedule edit
cannot leave the wizard stuck on Scenario for the next create.

> ℹ️ NOTE: `initialTab` seeds `useState` and is **not** a controlled prop — it is
> read on mount only. That is correct here because Radix unmounts `DialogContent`
> when the dialog closes (nothing `forceMount`s it) and the form additionally
> carries `key={editingProfile?.id ?? "new"}`, so every open is a fresh mount. A
> caller that kept the form permanently mounted would not see the tab change.

The wizard emits the same flat `ProfileFormData` the old form did
(`name` / `mno` / `sim_iccid` / `cid` / `apn_name` / `pdp_type` / `imei` /
`ttl` / `hl` plus the nested `scenario` object) — no contract change. The
Next/Submit buttons carry **distinct React `key`s** so React remounts the
button across the step transition; this is the ported fix for an early-submit
reconciliation bug where a stale click handler could fire a submit while the
user only meant to advance a tab.

### Saved-profiles card list (`custom-profile-view.tsx`)

The old TanStack **data table was removed** (`custom-profile-table.tsx` is
deleted) in favor of a **row list**. A row is single-line at wide widths
(`PROFILE_ROW_SHAPE`), left to right:

| Slot | Contents |
|------|----------|
| 40 px glyph disc | Tinted by status via `PROFILE_ROW_DISC_TONE` — the row's one coloured object. |
| Name + tag strip | The profile name over a **wrapping strip of outline `Tag`s**: APN (or "carrier default"), **IMEI override** when set, MNO, the scenario binding, band tags, and the audit note. |
| `ScheduleMiniBar` | The 8 px condensed ribbon. An unscheduled profile renders the same box `invisible`, so the trailing cluster lands on one vertical line down the whole list. |
| Status chip + overflow | `PROFILE_STATUS_BADGE` (each status carrying its own glyph rather than relying on colour alone) beside a 36 px icon-only menu button. |

- The per-row audit note — **"Applied / Partial / Failed at HH:MM"** — is backed
  by the `custom_profiles.view.audit.{applied,partial,failed}` i18n keys.
- **Radius is width-dependent**: `rounded-pill` at `@lg/card` and above (a row
  that acts is a pill), stepping down to `rounded-tile` in a narrow container,
  where the tags wrap to a second line and a 38 px end-cap on a 110 px-tall box
  would read as a lozenge rather than a row.
- **Height is a floor, and the skeleton mirrors by rendering `ROOT` itself** with
  placeholder children — not by restating a number. A tile pins because its
  content is bounded; a row's tag strip wraps, so a pin would resolve as a clip.

> ℹ️ NOTE: **Only IMEI override follows the APN down the tag strip.** PDP type,
> CID, TTL and hop limit are deliberately *not* on the row — a saved profile can
> be opened to read them, and nine tags per row buries the name. An overridden
> IMEI is different in kind: it changes the identity the **network** sees, it is
> invisible everywhere else in the list, and a user who has forgotten one is set
> will misread every registration failure that follows. All five of those fields
> *are* shown together on the hero's Identity tile, which is the one place the
> full config is stated. `imeiOverridden` reads the row's already-prefetched
> `full.settings`, so it costs no extra request.
>
> The **pulsing live-dot** is no longer on the active row. `LIVE_DOT` moved to
> the Today strip's "Schedule armed" readout: a dot per row is one animation loop
> per row, and the strip is where "armed" is actually asserted. That is the whole
> ambient-loop budget for this surface — if a future change wants a loop
> somewhere else here, this one has to go first.

Row settings are hydrated on demand via a `getProfile` prefetch, because the
`list.sh` summaries deliberately omit the `settings` object (the list endpoint
stays lightweight; per-row config detail is fetched when a card needs it).

#### The true empty state needs a create button, not just Refresh

`EmptyProfileViewComponent` (`empty-profile.tsx`) replaces the whole card when
`profiles.length === 0 && suggestions.length === 0` — nothing saved **and** no
suggestion for the inserted SIM. It is the one branch of this card with no other
create affordance: the populated card's New button lives on the page header
above it, and a suggestion row carries its own create action.

Its only affordance was **Refresh** — a button that reloads a list the user
already knows is empty. It now renders a filled create button as well, adopting
the pre-existing `custom_profiles.empty_state.cta_new` (already written and
already translated in all five packs, with no call site until now — no sixth
spelling of "New Profile" was minted). It is wired to the page's **same**
`handleNewProfile`, threaded as an optional `onNewProfile` through
`CustomProfileViewProps` → `EmptyProfileViewProps`, so all three create entry
points open the wizard on `identity` and none can drift.

> ⚠️ WARNING: **The create button is a SIBLING below the `ConditionScreen`, not
> a prop on it.** That primitive's action slot is `onRetry` / `retryLabel` with a
> **hard-coded `refresh` glyph** on a low-contrast `spec.action` wash — a retry
> affordance by construction, which cannot express a filled primary. Widening it
> would touch **nine** other call sites across six features (antenna alignment,
> antenna statistics, radio info, FPLMN, network priority, SMS forwarding) to serve one, so
> `condition-screen.tsx` was left untouched. Refresh stays the screen's retry and
> Create sits beneath it as a peer — the shipped composition in
> `components/cellular/settings/fplmn-settings/fplmn-card.tsx`. Do not "tidy" it
> by adding a second action slot to the shared primitive.

The ordering is also the honest one: the screen's copy teaches what a profile
*is* (`empty_state.teaching_headline` / `teaching_body`, the only place on the
surface that explains it), and the button is the answer to it — explanation then
action, a filled pill under a tonal wash. Both handlers are optional and degrade
cleanly: omit either and that affordance simply does not render.

### Apply-progress dialog (`apply-progress-dialog.tsx`)

A hero disc per status, a determinate bar, and a **"Details" ledger**. It renders
the **4 RM520N steps** `apn → ttl_hl → scenario → imei` (it does **not** carry
RM551E's Verizon `mpdn_rule` step). While the apply is non-terminal the dialog
cannot be closed; on a terminal **partial** or **failed** result it offers
**Reapply profile**.

Three details of this dialog are deliberate and each has bitten someone:

- **The ledger prints `ApplyStep.detail` verbatim**, right-aligned in mono — the
  APN that actually landed, `"already set"` for a skipped step, `+CME ERROR: 4`
  for a failed one. Previously a step said it was done without saying what it
  did, which is exactly the opaque progress the State-Honesty Rule exists to
  stop: "APN Configuration ✓" is not an answer to "*which* APN landed?". The
  string is never synthesized — an empty `detail` renders an empty slot, not a
  guess.
- **The bar counts FINISHED steps, not `current_step / total_steps`.**
  `mark_step_running()` increments the counter *before* the step does any work
  (`qmanager_profile_apply:264`), so the naive ratio reads 25 % before the modem
  has been touched at all. `current_step` reports what has been *started*; a
  progress bar reports what has been *finished*. A completed apply pins to 1
  regardless, so a skip-heavy run still ends full.
- **`skipped` steps stay muted** rather than being rewritten to a green check at
  completion (the old `effectiveStatus()` helper is gone). A step that did
  nothing did not succeed at anything, and `ledgerStepTone`'s own contract note
  says so.

The bar animates `scaleX` from a left origin — transform only, no per-frame
layout.

> ℹ️ NOTE: **The hero glyph rotates; it does not pulse.** The in-progress disc
> renders `progress_activity`, which is a *spinner* glyph — it reads as "working"
> by rotating, exactly as the ledger's own running row does below it. It carries
> `animate-spin motion-reduce:animate-none`. An earlier version used
> `animate-pulse` on the ambient duration; a breathing spinner glyph reads as
> stalled rather than alive. `animate-spin` is the shared rotation clock and has
> no ambient-duration variant to retune separately, so this stays a documented
> One-Scale exception rather than a token.

#### Why the ledger overflowed, and which single class fixes it

**Short version:** the ledger's outer block was the dialog's grid item and was
missing `min-w-0`, so the dialog sized itself to the longest string the modem
happened to return instead of to its own `sm:max-w-md`.

A long `ApplyStep.detail` — `"APN already negotiated: internet.globe.com.ph"`, a
raw `+CME ERROR:` payload — pushed the ledger past the 448 px panel, where
`overflow-hidden` sheared it off mid-word and the progress bar stretched out
past the padding with it. Three facts make this counter-intuitive, and each one
is why the guards that *were* already in place could not help:

1. **`truncate` does not bound an element's intrinsic width — it maximizes
   it.** It expands to `overflow:hidden; text-overflow:ellipsis;
   white-space:nowrap`, and `white-space:nowrap` makes the element's min-content
   width equal to the **full string**. Truncation is a paint-time clip that only
   happens once some ancestor has already imposed a width.
2. **`min-w-0` removes an item's *automatic minimum size*** (the content-based
   floor an item gets while `min-width: auto`). It does not shrink that item's
   own min-content contribution to its parent — so it has to sit on the box
   whose width is being resolved. `min-w-0` on `LEDGER_SHAPE.LIST` and `.STEP`
   never helped, because neither is that box.
3. **A percentage `max-width` resolves to `none` during intrinsic sizing**, so
   `max-w-[52%]` contributes nothing to a min-content pass and cannot cap a
   blowout on its own.

`DialogContent` is `display:grid` with one implicit `auto` track, and an `auto`
track's minimum sizing function is its item's minimum contribution. The ledger's
outer block *is* that grid item. `LEDGER_SHAPE.ROOT` therefore carries the
`min-w-0` that zeroes the contribution and pins the track to `sm:max-w-md`.
Every guard below it then has a **definite** width to resolve against, which is
what finally makes (1) and (3) do their jobs.

> ⚠️ WARNING: **`max-w-[52%]` on the detail span was kept, not removed** — and
> it is not redundant with the fix. Once the track width is definite, the step
> label is `flex-1` = `flex: 1 1 0%`; a zero flex-basis gives it a scaled shrink
> factor of `1 × 0 = 0`, so it absorbs no shrinkage and has no positive free
> space to grow into. Without the percentage cap on the detail, a 200-character
> payload takes every pixel and ellipsizes the step's **name** away to nothing.
> The cap is what keeps positive free space available for the label. The detail
> span is also `shrink`, never `flex-none` — a non-shrinkable sibling is
> guaranteed to push the row past its box.
>
> `shapes.ts` carries this reasoning in full under **THE MIN-CONTENT CHAIN**. An
> earlier version of that comment blamed the `min-w-0` on `STEP`, which was
> wrong and cost a live investigation; the doc comment and the fix now agree.

#### The panel fill: `bg-surface`, now owned by the primitive

`--background` and `--surface` are different tokens
(`app/globals.css:167`/`:169` light, `:291`/`:293` dark), but the page `body`
(`:420`) and `SidebarInset` (`components/ui/sidebar.tsx:314`) both paint
`bg-background` — and so did all four dialog-family primitives. DESIGN.md:348-349
assigns dialogs to **Surface**, the same step as cards. The citation spans two
lines on purpose: 348 is Canvas, 349 is Surface, and the point is the contrast
between them.

> ⚠️ WARNING: The symptom was **not** "the panel is invisible", and an earlier
> version of this section and of the `shapes.ts` docblock both said it was. A
> `bg-black/50` scrim sits between panel and page, and the panel composites above
> it, so it always read as a lighter rectangle. The real defect was **elevation
> inversion**: in dark mode the dialog painted `--background` `0.155` while every
> card beneath it painted `--surface` `0.215`, putting the most elevated element
> in the app *below* the cards on the tonal ramp.

A census found 53 of 56 dialog-family call sites inheriting that wrong default,
so the fix moved to the primitives rather than to the call sites:
`components/ui/dialog.tsx:76`, `alert-dialog.tsx:72`, `sheet.tsx:71` and
`drawer.tsx:59` now default to `bg-surface`. Promoting the fill made the base
`border` a hairline on a tonal container, so the same change dropped the border
from `dialog.tsx` and `alert-dialog.tsx` and the per-side borders from
`sheet.tsx` and `drawer.tsx` — **No-Hairline-On-Fill is now enforced at the
source.**

> ℹ️ NOTE: `APPLY_DIALOG_PANEL` (`shapes.ts:649`) therefore carries **neither**
> `bg-surface` nor `border-0` any more — the primitive owns both, and re-adding
> either at a call site is a regression, not a belt-and-braces. Seven other
> overrides in this feature and elsewhere were deleted for the same reason
> (`deactivate-progress-dialog.tsx`, `connection-scenario-card.tsx` ×2, the three
> SMS delete dialogs, `sms-compose-dialog.tsx`, `message-dialog.tsx`,
> `speedtest-dialog.tsx`).

One genuine regression fell out of the promotion and was fixed in the same pass.
`ProfileFormDialog` (`profile-form-dialog.tsx:123`) renders the wizard, which
returns its own `<Card>` (`bg-card`, byte-identical to `--surface`) inside a
`p-0 gap-0` `DialogContent` — so the Card *is* the panel. Card-on-background used
to give it an edge; on `bg-surface` it became one flat block with a redundant
hairline. The host neutralises the inner Card's decoration
(`[&>[data-slot=card]]:border-0 :bg-transparent :shadow-none`) rather than the
wizard being edited, because `profile-form-dialog.tsx:23` states as a contract
that the wizard is untouched, and the cause of the collision is the host's new
fill. Only decoration is dropped — the Card's `gap-6`/`py-6` layout and its
`bg-surface-container` sections still need their step above the panel.

A known consequence is recorded in DESIGN.md's Migration Deltas table: a
`SelectContent`/`PopoverContent` opened from inside a dialog now lands on the
same tonal step as the panel behind it, since `--surface`, `--card` and
`--popover` are one value. Their own border and shadow still separate them; give
a nested layer a container step on new work.

Separately, `components/ui/tonal-banner.tsx` gained `break-words` on its body
span. Banners render raw device strings that carry no break opportunities;
`min-w-0` stops such a string widening the banner's *parent*, but not from
painting past the banner's own box to be clipped by an ancestor
`overflow-hidden`. Only an explicit break opportunity keeps it inside. Text that
already fits is unaffected.

> ⚠️ WARNING: **The retry action reads "Reapply profile", not the mock's "Retry
> IMEI".** Per-step retry is **not implemented, deliberately**, and a label
> promising it would claim a capability the backend does not have. Three
> independent reasons, in ascending severity:
>
> 1. `apply.sh:80` wipes the state file on every run, so there is nothing for a
>    scoped run to resume from.
> 2. `total_steps` is hardcoded to 4 with a monotonic `current_step`; the state
>    schema cannot describe "step 4 only."
> 3. **The finalize block at `qmanager_profile_apply:1113–1117` calls
>    `clear_active_profile` + `scenario_teardown_schedule` +
>    `scenario_reset_to_default` whenever a run's status is `failed`.** A failed
>    single-step "Retry IMEI" would therefore **deactivate a healthy profile and
>    destroy its schedule timer** — strictly worse than not retrying.
>
> The mitigating fact, which is why a full reapply is an acceptable answer:
> three of the four steps are self-comparing and mark themselves `skipped` on a
> match. A full reapply after a failed IMEI write costs one `AT+CGCONTRDP` read,
> one iptables read, one redundant `QNWPREFCFG` write, and the retry itself — the
> APN step skips without detaching once the negotiated APN already matches.

### Scenario picker and the "+ Create new" deep-link

New profiles default to `scenario_id = "balanced"`. The user picks any
built-in or custom scenario from the Select in the Scenario tab; there's no
"None" option — Balanced is the de-facto no-op value.

The Select uses one sentinel option value:

| Sentinel | Meaning |
|----------|---------|
| `__create__` | "+ Create new custom scenario…" — deep-links to `/cellular/custom-profiles?action=create-scenario`, which auto-opens the create-scenario dialog on the merged page. If the profile form is dirty, an AlertDialog prompts the user to discard changes before navigating. |

> ℹ️ NOTE: Since the merge there are **two** create deep-links on one page, so
> the action name has to say *which* thing to create: `?action=create` opens the
> profile wizard, `?action=create-scenario` opens the scenario dialog. The
> `create-scenario` literal is exported as `SCENARIO_CREATE_ACTION` from
> **`connection-scenarios/connection-scenario-card.tsx`** — beside the dialog it
> opens — and imported by every consumer (the coordinator `custom-profile.tsx`
> and the retired route's redirect) rather than restated; three copies of a
> string that must match is how a deep link silently stops opening anything.
>
> It used to live in `connection-scenarios/connection-scenario.tsx`, a 40-line
> adapter whose only job was to read the param and pass `autoOpenAddDialog`
> down. The merged page shell absorbed that job, leaving the module's default
> export with **zero importers**, so the file was deleted on 2026-08-21 and the
> constant moved. Do not recreate the adapter.
>
> The page wraps `useSearchParams()` in `<Suspense>`, which is not defensive
> tidiness: reading search params in a client component triggers a
> client-side-rendering bailout, and an unwrapped read **fails the static export
> build**.

### Supporting components

- `empty-profile.tsx` — the Saved Profiles card's **true** empty state (nothing
  saved *and* no suggestion), i18n'd, and since 2026-08-21 carrying a create
  button beside its Refresh — see [The true empty state needs a create
  button](#the-true-empty-state-needs-a-create-button-not-just-refresh). Not to
  be confused with `NoActiveProfile`, which is the *hero's* empty state and
  answers a different question.
- `profile-override-alert.tsx` — the reusable gate banner (see
  [Gate matrix](#gate-matrix)), now i18n-wired. Its prop contract
  (`{ profileName, controls, note? }`) is **preserved** — it is shared by the
  APN, TTL/HL, Scenarios, and Band-Locking gate pages, so the shape could not
  change.
- `custom-profile.tsx` — the coordinator, i18n-wired for the page header and
  the activate/deactivate confirmation dialogs. The **Deactivate ≠ revert**
  copy is preserved from the RM551E port, but note it is no longer literally
  true of the APN: `profiles/deactivate.sh` now reverts CID 1 to carrier
  default before clearing profile state — see
  [Deactivating a profile reverts the APN first](#deactivating-a-profile-reverts-the-apn-first).
  TTL/HL and IMEI are still left as the profile set them.

### i18n and the `ApplyStep` comment fix

The `custom_profiles` namespace was transplanted from RM551E's professional
translations (minus the Verizon keys), growing from ~28 to **282 leaf keys**
per locale at the time of that port (it stands at **353** today, across all five
locales `en` / `zh-CN` / `zh-TW` / `it` / `id`); `bun run i18n:check` reports
100% parity — 2309/2309 per pack. Separately, the `ApplyStep.name`
doc comment in `types/sim-profile.ts` was corrected — it now documents the
real 4-step RM520N set (`apn`, `ttl_hl`, `scenario`, `imei`), replacing a
stale RM551E 7-step list.

> ℹ️ NOTE: This redesign was validated with `next build` (exit 0, both
> `/cellular/custom-profiles` routes prerender), `bun run i18n:check` (100%
> parity, 0 errors), and `eslint` (exit 0). On-device curl validation was not
> run — no backend changed, so it is not required for this change.

#### Dead keys were deleted, not left as ballast

Thirteen `custom_profiles.*` keys with no call site anywhere in the tree were
removed from all five packs alongside the three new ones
(`hero.reapply`, `hero_empty.description_saved`, `hero_empty.activate_action`):

| Removed | Why it was dead |
|---------|-----------------|
| `hero.badge_mismatch` | The hero's mismatch chip renders through `PROFILE_STATUS_BADGE`, which owns its own label. |
| `active_card.*` (8 keys) | The whole subtree belonged to the pre-merge active-config card, replaced by the hero. |
| `empty_state.{title,description,description_full,cta_refresh}` | Superseded by `teaching_headline` / `teaching_body` / `refresh`. |

`empty_state.cta_new` and `empty_state.refresh` were **kept**: the first is now
consumed by the true empty state's create button (see [The true empty state needs
a create button](#the-true-empty-state-needs-a-create-button-not-just-refresh)),
the second is still the `ConditionScreen` retry label. `i18n:check` catches an
**extra** key as a hard error but says nothing about a key that is present in all
five packs and referenced by none, so this class of debt has to be grepped for
deliberately.

> ⚠️ WARNING: **The `public/locales/*/cellular.json` packs are CRLF and nothing
> in `.gitattributes` covers `public/locales`.** A round-trip guard of the shape
> `JSON.stringify(json, null, 2) + "\n" === original` therefore **fails on every
> pack** and reads a one-character-per-line difference as "hand-formatted, do not
> touch" — so a script written that way either aborts on all five files or, if
> the guard is simply dropped, reformats ~3000 lines into an unreviewable diff.
> The mechanism and the correct normalising guard are in
> [i18n.md § Locale files are CRLF](i18n.md#locale-files-are-crlf--normalise-before-any-round-trip-guard).

### Design-language contract (`shapes.ts`)

**`components/cellular/custom-profiles/shapes.ts` is the single source of truth**
for this surface's geometry and tones — card shells, row/tile shapes, pill
geometry, the tone-per-status helpers (`profileRowTone`, `ledgerStepTone`) and
the status→badge map (`PROFILE_STATUS_BADGE`). Any new work here (a new row
variant, a new tile, a new status) extends this file rather than hand-rolling a
class string, and a skeleton mirrors by importing the same constant rather than
restating a number. This is **frontend-only** — nothing in the data model, CGI
contract, or apply pipeline above changed.

The hero slot's exports are worth naming here because three components share
them and the drift they prevent is invisible until a swap:

| Export | Owns |
|--------|------|
| `HERO_CARD` | The slot's shell — the surface's only `rounded-hero`. |
| `HERO_DISC` | The glyph disc's **geometry**. |
| `HERO_DISC_TONE` | Its **fill**, keyed `live` / `applying` / `partial` / `mismatch` / `empty` / **`error`**. A state without a member fails the build. |
| `HERO_STATE` | Everything else the two state screens need — `SHELL`, `GLYPH_SIZE`, `TITLE`, `BODY`, `DETAIL`. See [The hero slot is three components on one scale](#the-hero-slot-is-three-components-on-one-scale-hero_state). |
| `HERO_NAME` | The loaded hero's name, **derived** from `HERO_STATE.TITLE`. |
| `SAVED_PROFILES_ANCHOR` | The Saved Profiles card's wrapper and scroll/focus target. Its `h-full` is load-bearing grid behaviour, not padding. |

> ⚠️ WARNING: **The surface was re-authored onto the finalized design language
> on 2026-08-21.** An earlier generation of `shapes.ts` was written against the
> *tonal* language that preceded it — correct for its own system, and wrong for
> this one in one consistent way. Any older note describing this surface as
> "tonal", or citing `--tone-{role}-1` fills on rows and tiles, describes the
> superseded generation.

#### The Three-Layer Rule, as it applies here

The finalized canon assigns each of the three colour layers a **size**, and the
previous generation's defect was spending the largest layer on the largest box:

| Layer | Tokens | Job on this surface |
|-------|--------|--------------------|
| **Ink** | `--X-on-surface` | Values and strokes on neutral ground. The default — e.g. the Today strip's "Schedule armed" readout. |
| **Fill** | `--X` + `--X-foreground` | Compact emphasis only: glyph discs, the live ribbon segment, buttons. |
| **Container** | `--X-container` + `--on-X-container` | Status chips, banners and condition screens, and **nothing else** — on this page that means `Badge` and `HERO_NOTICE_TONE`. |

**THE BODY IS NEUTRAL, THE DISC CARRIES THE COLOUR.** A tile is not a chip and a
row is not a banner, so neither may take the container layer. A row's fill is
`surface-container` whatever its status; the status is carried by its glyph disc
and by a filled `Badge` that names the state in words. That is also what makes
the state survive deuteranopia, where `success-container` and `warning-container`
are the same surface (they measure **1.03:1** apart).

Identity — an APN string, a band number, a scenario name, a PDP type — is not
status, so it never takes a `Badge`. It takes an outline `Tag`
(`components/ui/tag.tsx`), whose `nr` / `lte` / `neutral` roles make `n78` read
as NR here exactly as it does on the dashboard and the scanner.

> ⚠️ WARNING: **These exports were deleted so the compiler forbids the defect.
> Do not reintroduce them.**
>
> | Retired | Why |
> |---------|-----|
> | `CONFIG_PILL`, `CONFIG_PILL_NEUTRAL`, `CONFIG_PILL_BRAND` | A filled chip doing a tag's job. Config values are now `<Tag variant="neutral">`. |
> | `HERO_TILE_SCENARIO` | Painted 104 px of `--primary-container` — the Container layer at four times its sanctioned size. The scenario tile now takes `HERO_TILE_BODY` like its siblings and marks itself with a `bg-primary` **disc**. |
> | `SCENARIO_PILL`, `SCENARIO_META_CHIP` | Same defect on the scenario grid. |
> | `SCENARIO_TILE_SHAPE.HEIGHT`, `HERO_TILE_SHAPE.LABEL`, `RIBBON_SHAPE.ROOT`, `RIBBON_SHAPE.NEEDLE_LABEL` | Dead members with no consumer; the skeletons that used to shadow `HEIGHT` now render `ROOT`. |
> | `PAGE_TITLE` / `PAGE_DESCRIPTION` (for the page header) | The page uses `CellularPageHeader`. Both constants still exist in the file for dialog titles that need the tracking without the header's layout, but nothing on this surface imports them. |
>
> There is deliberately **no tinted tile body export** at all. Not exporting one
> is what stops a future caller tinting one back.

#### `HERO_TILE_SHAPE.ROOT` is a 104 px floor, not a pin

This is the one deliberate divergence from `components/cellular/tile-shape.ts`,
and it is documented on the constant itself. `TILE_SHAPE.ROOT` **pins** 104 px
because a Radio / Antenna / SMS tile carries a single bounded reading. Every tile
on *this* strip carries a wrapping tag row under its value — the Identity tile's
PDP type, CID, TTL, hop limit and IMEI-override tags; the Scenario tile's
schedule tag; the Radio tile's band tags. A pin on genuinely unbounded content is
a lie that resolves as a clip, so this strip floors and top-aligns instead.

It floors on **all three tiles, never a mix**. A `h-` tile in a CSS grid opts out
of `align-self: stretch`, so one floored sibling beside two pinned ones grows
alone and leaves the row ragged; three floored siblings all stretch to the tallest
and the row stays square. The skeleton renders the same `ROOT`.

> ℹ️ NOTE: the measure is **restated** as a literal rather than interpolated from
> `TILE_SHAPE.HEIGHT`. Tailwind's JIT scans source text for class names, so a
> template-assembled arbitrary value never reaches the stylesheet and the tile
> would ship with no minimum at all.

#### `PROFILE_STATUS_BADGE` gained a real `partial` member

`partial` is its own member (`warning` + the `warning` glyph) rather than
borrowing `failed`. A partial apply is degraded, not dead, and the hero notice
directly beneath the chip is `warning`-toned — a `destructive` chip over a
`warning` banner reads as two different verdicts on one condition. It shares the
`warning` role with `mismatch` and is separated from it **by glyph alone**
(`warning` vs `swap_horiz`), which is the only channel a deuteranopic user has.
That is the Every-Chip-Has-A-Glyph Rule doing its job.

#### The "Band locking" link on the Radio tile

The Radio tile's eyebrow carries a link to the page that owns the lock it
reports. **The href is `/cellular/cell-locking`, not `/cellular/band-locking`.**
The pre-redesign hero linked the latter, which is not a route — `app/cellular/`
has `cell-locking/` — and QManager ships as a **static export** served by
lighttpd off the modem, so a missing route is a hard 404, not a soft client-side
miss. The i18n label key is unchanged; only the destination was corrected.

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

#### `DEFAULT_SCENARIOS` has exactly one definition

> ⚠️ WARNING: **`types/connection-scenario.ts` owns the three built-in
> scenarios. Never write a second copy beside a consumer.**
>
> `connection-scenario-card.tsx` held an inline duplicate until 2026-08-21, and
> the two had drifted in the one field that matters. The shared constant stores
> the **persisted icon ids** (`"zap"` / `"gamepad"` / `"play"`); the inline copy
> stored already-resolved **Material ligatures** (`"bolt"` /
> `"sports_esports"` / `"play_arrow"`) in the same id-shaped field.
> `resolveScenarioIcon()` finds no option whose `id` is `"bolt"` and falls back
> to `auto_awesome`, so **all three built-in scenario tiles rendered the sparkle
> glyph** while the hero and the schedule ribbon — reading the shared constant —
> rendered the right ones.
>
> The id → ligature boundary is **at the render site**: `ConnectionScenario.icon`
> carries the persisted key everywhere it travels, and each render site calls
> `resolveScenarioIcon()` itself. Resolving early so a downstream consumer can
> render the field directly is precisely what produced the defect.

Two mechanisms now make that drift impossible rather than merely fixed:

- The card derives its built-ins from `DEFAULT_SCENARIOS.map(...)`, overlaying
  **only** `name` and `description` with `t()` calls at render time.
  `DEFAULT_SCENARIOS` is a module-level constant holding English fallbacks and
  cannot call `t()`, so sourcing labels from it directly would silently
  un-translate every locale; the overlay is keyed off each scenario's stable
  `id`, so the existing `scenarios.default_*_{name,description}` key set keeps
  working. A consumer that only needs `id` / `config` / `icon` (e.g.
  `band-locking.tsx`) reads the constant as-is.
- The UI view type is now `Scenario extends Omit<ConnectionScenario, "isDefault">`
  (`connection-scenarios/scenario-item.tsx`), so the two shapes are
  compiler-linked and cannot drift apart again.

#### `types/connection-scenario.ts` returns keys, never words

> ⚠️ WARNING: **A `types/` module has no `t()` in scope, so any finished string
> it returns ships in English to every locale** — however well translated the
> surface around it is. This module rendered hardcoded English to Italian and
> Chinese users in three places until 2026-08-21. The contract is now: **it
> returns an i18n key, or `null`. Never a word.**

| Was | Is | On no match |
|-----|----|-------------|
| `NETWORK_MODE_OPTIONS[].label` | `.labelKey` | — |
| `modeValueToLabel()` | `modeValueToLabelKey()` | `null` — the caller prints the raw AT value in machine voice |
| `bandsToDisplay()` returning `"Auto"` | returns `null` for an empty lock | `null` — the caller supplies the word |
| *(new)* | `optimizationLabelKey()` | `null` — the caller prints the stored string verbatim |

`null` rather than a fallback key is deliberate in each case: a helper that
quietly substitutes a default **cannot be told apart from one that found a real
value**, and `"Auto"` meant two different things in the two places this module
used to return it (an unrecognised AT mode versus an empty band lock).

**`components/cellular/custom-profiles/scenario-labels.ts` is the other half of
the contract** — `modeLabel(t, …)`, `optimizationLabel(t, …)`, `bandsLabel(t, …)`
take the reader's `t` and finish the job. Two placement decisions are
load-bearing:

- **It lives outside `types/`** so that importing `i18next` is not dragged into
  `band-locking.tsx`, which reads `DEFAULT_SCENARIOS` purely for its `config`
  values and displays none of these strings.
- **It is shared, not local to one card.** The network mode used to be rendered
  two ways — `config.mode` in the active-config card, `modeValueToLabel(config.atModeValue)`
  in the hero — and one of those read a stale persisted copy. Two renderings of
  one value is the drift this module exists to make impossible.

> ℹ️ NOTE: every `t()` in `scenario-labels.ts` is called with a **variable**, so
> none of these keys appears as a literal anywhere in the tree. `bun run
> i18n:check` is unaffected (it compares each pack against the English superset
> and never reads source), but a human grepping for `scenarios.network_mode.auto`
> will find only the JSON. `NETWORK_MODE_OPTIONS` and `OPTIMIZATION_LABEL_KEY`
> in `types/connection-scenario.ts` are the index — a new key goes there.

**`ScenarioConfig.mode` is derived, persisted, and must never be rendered.**
`atModeValue` is the truth; `mode` was an English label stored beside it since
before this surface was translated, so reading it shows an Italian user
"5G SA Only". It stays in the shape because every stored scenario on every
device already carries it and the config store has no key-migration primitive —
dropping it here would strand it there. Everything this build writes — the
create dialog, the edit dialog, and the three `DEFAULT_SCENARIOS` constants —
now puts `atModeValue` in that field, so the copy is at least self-describing to
anyone reading the JSON on the device. **Records already saved on a device still
hold the old English label**, which is harmless precisely because nothing
renders it.

> ⚠️ WARNING: **this is not the `mode` field `scenarios/activate.sh` parses out
> of the POST body.** That one is built separately in
> `hooks/use-connection-scenarios.ts` (`body.mode = config.atModeValue`) and is
> unrelated to the persisted `ScenarioConfig.mode`. Verified before the change;
> do not "unify" them.

`optimization: "Custom"` written by the create dialog stays a **stable English
token on purpose.** Writing `t(…)` there would burn the author's language
permanently into the user's saved data — the scenario would still read
"Personalizzato" after they switched the UI back to English. It is translated at
display time instead, and `optimizationLabel()` falls back to the stored string
verbatim because the edit dialog's optimization field is free text: anything
outside the four tokens this app writes is the user's own word and must not be
translated, trimmed or title-cased.

New keys in all five packs: `scenarios.network_mode.{auto, lte_only, nr5g_only,
lte_nr5g}`, `scenarios.optimization.{balanced, latency, throughput, custom}`,
`scenarios.bands_auto`. Wording follows the vocabulary each pack already uses at
`cellular.settings.network_type.options.*`.

> ℹ️ NOTE: **Known drift, deliberately not fixed here.** This page now carries
> **three** keys for "no band lock is set", with three different English
> strings: `custom_profiles.hero.tiles.bands_auto` ("All bands"),
> `scenarios.tile.bands_auto` ("Bands auto"), and `scenarios.bands_auto`
> ("Auto"). The third is genuinely different copy — it is a row *value* under a
> label that already says "bands", so "All bands" would read "LTE bands: All
> bands". The first two are the same fact in the same kind of tag slot and are
> real drift, pre-existing and not introduced by this change.

#### Two files were deleted

| Deleted | Why |
|---------|-----|
| `connection-scenarios/abstract-pattern.tsx` (175 lines) | Decorative SVG card overlays, with no place in the finalized language. |
| `connection-scenarios/connection-scenario.tsx` (40 lines) | A vestigial adapter whose default export had **zero importers** once the merged page shell absorbed its job. Its `SCENARIO_CREATE_ACTION` constant moved to `connection-scenario-card.tsx`, beside the dialog it opens. |

**i18n:** the Connection Scenarios surface (`scenarios.*` in the `cellular`
namespace, `public/locales/*/cellular.json`) had shipped almost entirely
hardcoded English — the subtree held 4 keys. It now holds **76 leaves across
all five locales** (en / zh-CN / zh-TW / it / id), including a new
`scenarios.icons.*` subtree covering the 12 scenario-icon labels that had
been string literals inside the `SCENARIO_ICONS` data array in
`scenario-icons.ts` — invisible to both `bun run i18n:check` and a plain
JSX-text grep, since they never appeared as rendered text in source.

The 2026-08-21 re-authoring reshaped the hero's notice keys. Five orphaned
**sentence-fragment** keys were removed from all five packs —
`custom_profiles.hero.notice.{applying, partial_lead, partial_tail,
mismatch_lead, mismatch_tail}` — and replaced by `{applying, partial,
mismatch}_{title, body}` pairs, because a notice assembled from a lead and a
tail around an interpolated value cannot be reordered by a translator.
`notice.unknown_step` is still live (it fills `partial_body`'s `{{step}}` when
the backend names no failing step). New `hero.badge.*`, `profiles.list.*` and
`profiles.today.*` subtrees landed alongside.

Two later fixes in the same pass removed the last hardcoded English from this
surface: the `scenarios.*` key contract described above, and the deletion of
`custom_profiles.form.clear`.

> ℹ️ NOTE: Validated with `bun run i18n:check` — **0 errors, 100 % parity at
> 2319/2319 in every locale** (en / id / it / zh-CN / zh-TW), alongside `tsc`
> (exit 0), `next build` (49 pages), `eslint` (clean on the touched subtree) and
> `bun run icons:check` (unchanged). On-device curl validation was not run — no
> backend changed.

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
presses **Load from SIM**. The read is fast but not instant — **measured on the
live modem at ~0.22 s typical (10 samples, 0.20–0.47 s, taken while the status
poller was running and competing for the same AT lock)** — so the user can
already be typing when the response lands. The two arrival paths are therefore
handled differently, distinguished by an `explicitLoad` state flag in
`custom-profile-form.tsx`.

> ℹ️ NOTE: This doc previously claimed the read took **~2–3 s**, which is off by
> an order of magnitude and is what motivated an unnecessary optimization
> investigation. The race the `explicitLoad` flag guards is real regardless — a
> 220 ms round trip is still far longer than the time it takes a user to focus a
> field and start typing — but nothing here needs to be made faster.

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

A suggestion row renders the same `PROFILE_ROW_SHAPE.ROOT` as a saved row —
same geometry, padding, motion — and the same disclosure: the APN, PDP type,
CID, any TTL / hop-limit override and any recommended bands all render as
outline tags in the same `.META` strip, so the offer and the roster can be
compared straight down the column. An earlier pass shipped the row carrying only
"Recommended for your SIM", which is an unfalsifiable claim: a row asking
permission to configure the modem has to say **what** it would configure before
the user presses Create. Three differences carry the honesty, none of them
colour-only:

- the row and its disc are **dashed and unfilled** (`SUGGESTION_ROW` /
  `SUGGESTION_DISC`) — a suggestion is an *offer*, nothing has been applied, so
  nothing is painted;
- the leading tag reads **"Recommended for your SIM"** in words, where a saved
  row's trailing slot carries an Active / SIM-changed / Inactive chip;
- the trailing affordance is **Create** — not a status chip and **no overflow
  menu**, because there is nothing yet to edit, delete or activate.

The extra tag line is absorbed by `ROOT`'s `min-h-` floor. There is no height
constant to keep in step, which is exactly why the shape is a floor.

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

### Resolution rule (must match byte-for-behavior in 4 places)

For weekday `dow` (0=Sun..6=Sat) and minute-of-day `m`:

1. Consider only blocks whose `days` array includes `dow`.
2. A block matches when `start` ≤ `m` < `end` (start inclusive, end
   exclusive); if `end` ≤ `start` the window wraps past midnight and matches
   when `m ≥ start` **or** `m < end`.
3. First matching block in array order wins.
4. No block matches → `scenario.default`.

This exact rule is implemented independently in **four** places and **must
stay in sync**:

| Implementation | Purpose |
|-----------------|---------|
| `scenario_mgr.sh::scenario_block_for_now` (jq, on-device) | Authoritative — resolves "what should be active right now" when the timer fires. |
| `scenario_mgr.sh::_scenario_generate_oncalendar_lines` (jq, on-device) | Compiles a schedule into `OnCalendar=` lines (see below) — a from-scratch reimplementation of the same timeline logic, not a call into `scenario_block_for_now`. |
| `lib/scenario-schedule.ts` (`resolveScheduledScenario`, `nextChangeAt`) | Display-only — drives the frontend's "locked" badge and "next change at HH:MM" line. The on-device timer is authoritative; this module exists only so the UI agrees with the device. |
| `lib/schedule-timeline.ts` (`buildDayTimeline`, `nextScenarioChange`) | Display-only — paints the Today strip's 24-hour ribbon and every row's mini bar. Same rule, expressed as paint order over 1440 slots (blocks painted in reverse array order so the earliest match owns the slot = first-wins). Added with the merged page; see [The 24-hour schedule ribbon](#the-24-hour-schedule-ribbon). |

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

> ℹ️ NOTE: **The timer survives the 1970 boot window, and that is what makes the
> Today strip's ribbon honest.** RM520N-GL has no battery-backed real-time clock, so
> every boot starts at Jan 1970 and every armed `OnCalendar` timer misfires twice
> around the ~24 s clock step. `qmanager_scenario_schedule:54–60` calls
> `_qm_timer_fire_allowed ""` — the **empty** argument means "I have no single
> schedule minute to compare against" (a multi-block timeline doesn't have one),
> which degrades the guard to *clock-sane **and** uptime ≥ 300 s*. Both
> boot-window misfires (~23 s and ~29 s) are rejected. A denied fire is
> `exit 0` — a clean skip, **not** a teardown — so the armed timer is still there
> for its next real elapse. Verified present on-device: the worker, the
> `_arm` helper, the `.service` unit and the sudoers rule all exist; only the
> `.timer` is generated per-profile at arm time. Full mechanism in
> [scheduled-timers.md](scheduled-timers.md#the-1970-boot-window).

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

> ⚠️ WARNING: **Every `scenario_teardown_schedule` call from inside a CGI must
> be redirected to `/dev/null`.** It is a thin wrapper over the
> `qmanager_scenario_schedule_arm` root helper, and that helper prints a JSON
> object on *every* exit path (`{"success":true,"armed":false}` and friends).
> Unredirected, that object lands in the endpoint's HTTP body ahead of the
> endpoint's own `cgi_success`, so the response is **two concatenated JSON
> documents** and no client can parse it. Three endpoints were affected:
> `profiles/deactivate.sh` (direct call) plus `profiles/delete.sh` and
> `cellular/settings.sh` (the SIM-slot-switch path), which both reach it
> through `profile_mgr.sh`'s `_profile_teardown_scenario_schedule` wrapper. The
> redirect now sits at the wrapper *and* at the direct call. Nothing anywhere
> captures or parses this output — verified across all call sites.
>
> `scenario_reset_to_default` needs no such redirect: it writes only to the
> log, never to stdout.

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

## The attach cycle drops the LAN link (and with it, the HTTP response)

**Every** `apn_apply_write` bracket — the profile apply's step 1, the APN
editor's save, and `profiles/deactivate.sh`'s carrier-default revert — makes the
modem re-attach with `AT+COPS=0`. Measured on a live RM520N-GL, the stock
firmware responds to that re-attach by restarting `dnsmasq` twice and **dropping
the Ethernet PHY for roughly four seconds**:

```
13:33:42  [cgi_profile_deactivate] Profile deactivate request
[1214.930] r8125: eth0: link down            -> 13:33:49   browser's TCP dies
13:33:50  [cgi_profile_deactivate] EVENT [apn_apply_done] CID 1 reverted
13:33:52  [cgi_profile_deactivate] EVENT [profile_deactivated] 'Globe'
[1218.838] r8125: eth0: link up              -> 13:33:53
```

Reproduced identically on a second run 30 minutes later (link down at
`[3005.010]`, the same second `apn_apply_done` logged). Nothing in QManager
causes it and nothing in QManager can prevent it; IP passthrough is **not**
involved (`IPPassthroughEnable` is `0` on the measured device — this is the
plain bridged-LAN path).

**The consequence is a transport rule, not an AT rule: any endpoint that runs an
attach cycle inline cannot reliably deliver its own response.** The work always
completes; the answer is written into a socket that no longer exists ~3s into a
~4s outage, and the browser reports a bare `TypeError` ("NetworkError when
attempting to fetch resource" in Firefox).

Why apply survives it and deactivate did not:

| Path | Shape | Behaviour under the drop |
| ---- | ----- | ------------------------ |
| `apply.sh` | spawns a detached worker, UI polls `apply_status.sh` | one poll fails, `pollStatus`'s `catch` swallows it, the next poll reconnects |
| `deactivate.sh` | one blocking request that answers itself | the response is lost; the UI used to report `network_error` on an operation that had **succeeded** |

`useSimProfiles.deactivateProfile` therefore **reconciles** instead of guessing:
a fetch that never produced a status line is not evidence of anything, so the
hook polls `list.sh` (a plain disk read — no AT lock, no modem contact) every 2s
for up to 45s and reads the verdict off the device.

- marker cleared → `{ ok: true }`, success toast, list refetched
- still set at the ceiling → `link_lost`. A failed APN revert (the endpoint
  exits before `clear_active_profile`) and an unreachable device are
  indistinguishable from the browser, so the code says "unknown" and the toast
  asks the user to look, rather than picking one.
- an HTTP **status** error is a real answer from a reachable device and is
  reported straight through — it never enters the reconcile.

The dialog's third phase, `verifying`, exists to name that second wait
(`cloud_off`, deliberately not spinning — nothing is progressing).

**If you add another endpoint that brackets an attach cycle inline, it inherits
this problem.** `cellular/apn.sh`'s save is the remaining one; the durable fix
for both is the apply pipeline's shape (detached worker + status file).

---

## The hero's cascade must control its own variants

`ActiveProfileHero`'s root carries `initial="hidden" animate="visible"`
explicitly. Removing them makes the entire card render blank — a full-height
hero-shaped hole — whenever it mounts on a **swap** rather than on first paint.

A `motion.div` with only `variants` is a passive variant *child*: it waits for
its parent's cascade to propagate rather than animating itself. Motion decides
which it is from `manuallyAnimateOnMount = Boolean(parent && parent.current)` —
"was my parent already in the DOM when I was constructed?". The hero's parent is
the `key="hero-active"` `AnimatePresence` wrapper in `custom-profile.tsx`,
created in the same render pass, so its ref is still `null` and the answer is
**no**. The card then waited on the page-level cascade, which runs once on page
load and never again, leaving every `staggerItem` at `opacity: 0` forever.
Opacity-0 children still occupy layout, hence a hole rather than a missing card.

It never showed on first load because `<AnimatePresence initial={false}>` sets
`blockInitialAnimation`, which paints the children at rest and skips the
question. Only the empty → active swap (activating a profile) reached it —
deactivating looked fine because `NoActiveProfile` is plain markup with no
cascade to get stuck in.

**Rule for this surface: any `AnimatePresence` child that is itself the root of
a variant cascade must declare `initial`/`animate` itself.** A cascade root
whose parent was already mounted (the Saved Profiles list, which swaps out of a
skeleton) is unaffected — its parent has a `current`, so it animates itself.

---

## Related

- [wan-profile-management.md](wan-profile-management.md) — APN editor, the underlying mechanism step 1 uses (and the APN gating note).
- [sim-detection.md](sim-detection.md) — the known-SIMs set model, byte-parity vs. canonicalized ICCID comparison, and the watchdog/slot-switch/profile-activate coupling that keeps expected SIM transitions from false-firing the "New SIM" banner.
- [connection-watchdog.md](connection-watchdog.md) — Tier-3 SIM failover, the `verify_quimslot` read-back gate, and the `sim_db_add` coupling at finalize/revert.
- `../ARCHITECTURE.md` § Custom SIM Profiles — auto-apply trigger points (boot / SIM switch / watchdog).
- `../rm520n-gl-architecture.md` § Custom SIM Profiles — Auto-Apply on ICCID Match — RM520N-GL platform considerations (`fs.protected_regular`, `/proc/$pid` checks, defensive sourcing).
- `../BACKEND.md` § `profile_mgr.sh`, § `scenario_mgr.sh`, § `qmanager_profile_apply` — library and daemon inventory.
- `../API-REFERENCE.md` § Custom Profiles, § Connection Scenarios — request/response contracts.
