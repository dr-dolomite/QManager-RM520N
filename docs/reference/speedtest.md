# Speed Test (Ookla CLI)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

QManager's Speed Test measures download, upload and latency by shelling out to the **Ookla Speedtest CLI** — a proprietary binary the installer downloads onto the modem rather than bundling. Four CGI endpoints wrap it (availability, server list, start, status), one React hook drives the whole lifecycle, and two surfaces consume that hook: the **Speed Test tile** inside the dashboard's Live Latency card, and the **Speed Test dialog** the tile opens. The feature exists because "is my connection actually delivering what the carrier promised?" is the single most common question a modem owner has, and the signal metrics elsewhere on the dashboard cannot answer it.

> ⚠️ WARNING: **A single run costs roughly 400 MB of cellular data** (398 MB measured live on a full run). This is not a bug and it is not tunable — see [Cost & Measurement Reality](#cost--measurement-reality).

## Quick Reference

| Thing | Value |
| ----- | ----- |
| Binary | `/usrdata/root/bin/speedtest`, symlinked to `/bin/speedtest` |
| Version | `ookla-speedtest-1.2.0-linux-armhf` |
| Installer function | `install_speedtest_cli()` — `scripts/install_rm520n.sh:571` |
| CGI directory | `scripts/www/cgi-bin/quecmanager/at_cmd/` |
| Endpoints | `speedtest_check.sh`, `speedtest_servers.sh`, `speedtest_start.sh`, `speedtest_status.sh` |
| Runtime files | `/tmp/qmanager_speedtest.pid`, `_output`, `_result.json`, `_error`, `_run.sh`, `.lock`, `_env` |
| Hook | `hooks/use-speedtest.ts` |
| Pure state machine | `lib/speedtest-phases.ts` (`resolveStepStates`) |
| Types | `types/speedtest.ts` |
| UI | `components/dashboard/live-latency.tsx` (tile), `components/dashboard/speedtest-dialog.tsx` (dialog) |
| i18n | `dashboard` namespace, `speedtest.*` subtree, all 5 locales |
| Poll cadences | 500 ms while running, 10 s idle heartbeat (`watch` mode only) |
| Data cost | ~400 MB per run |

Related: [dashboard-chart-cards.md](dashboard-chart-cards.md) (the Live Latency card that hosts the tile), [icon-system.md](icon-system.md) (this surface is inside the Material Symbols route scope), [connection-quality.md](connection-quality.md) (the continuous latency telemetry the tile sits beneath).

---

## Cost & Measurement Reality

### A faster link costs more data, not less

Ookla's test is **duration-bounded, not volume-bounded**: it saturates the link for a fixed number of seconds per phase and reports whatever moved. So the better your connection, the more megabytes a run spends — the opposite of most people's intuition. A full run measured live cost **398 MB**.

On a metered SIM that is a real amount of money, so the idle dialog carries a warning line (`speedtest.data_cost_notice`, "Uses roughly 300–500 MB of data.") directly under the Run button — with the control that spends it, not tucked in a footnote.

> ℹ️ NOTE: There is no "lite" mode. Reducing the cost would mean cutting the phase durations, which changes what the number means. Do not add a flag for it without deciding what the resulting figure is comparable to.

### The ping phase finishes before you can see it

Ookla emits only **~5 progress lines** for the ping phase and completes it in well under a second. At the 500 ms poll cadence, that phase would appear for a frame or two at most — so the step chips would appear to jump from "Connecting" straight to "Download", and latency would look like it had finished before it started.

`hooks/use-speedtest.ts` therefore holds the ping phase on screen for **`PING_FLOOR_MS` = 600 ms** (`applyPhase()`). A phase advance that arrives inside the floor is deferred with a `setTimeout` and committed when the floor expires.

Two guarantees this deliberately keeps:

- **It delays presentation only.** The Ookla process is never paused or slowed; only the phase label the UI reads is held back.
- **`complete` and `error` are never deferred.** `applyPhase()` excludes `error` from the leaving-ping check and re-commits immediately, because holding a finished or failed run behind a cosmetic timer would be a lie about the device's state.

### Mid-run progress lines are lossier than the final result

While a phase is in flight, Ookla's `download`/`upload` progress lines **omit `latency` entirely for roughly the first 2 seconds**, and when the field does appear it carries **only `iqm`** — no `low`, `high` or `jitter`. `types/speedtest.ts` models this correctly:

```ts
latency?: { iqm: number };
```

> ⚠️ WARNING: An unguarded `p.download.latency.iqm` read throws on the **first frame of every test**. The optional marker is not defensive padding; it is the observed shape.

### The final result is richer, and was verified live

The `type: "result"` line was verified against a live carrier run, and every field the types mark as required **is** present: `packetLoss`, `download.latency.{iqm,low,high,jitter}`, `upload.latency.*`, `ping.jitter`, `result.url`, `result.persisted`, `timestamp`, `isp`, and all of `interface` / `server`.

Only one field was loosened:

| Field | Reality |
| ----- | ------- |
| `packetLoss` | **Optional.** Ookla omits it entirely for servers that do not measure loss. When present it is a full float (`0.33003300330033003`) and must be rounded — the dialog renders `toFixed(2)`, and the absent case renders `speedtest.metric_absent` ("Not reported") rather than a blank cell. |
| `result.url` | **Present but can be empty.** Ookla emits an empty url when the result upload to speedtest.net fails — common on a flaky uplink. The "View on Speedtest.net" link is conditional (`result.result?.url ? … : null`) and the button row uses `flex-wrap` + centring so the CTA does not sit beside a hole when the link is gone. |
| `interface.macAddr` | All zeros on `rmnet_data0`. Deliberately **not surfaced** — a MAC of `00:00:00:00:00:00` reads as a bug, not as a fact. |

---

## Backend

### Endpoint summary

| Endpoint | Method | Returns |
| -------- | ------ | ------- |
| `speedtest_check.sh` | GET | `{"available":true|false}` — is the binary on `PATH` |
| `speedtest_servers.sh` | GET | `{"success":true,"servers":[…]}` or `{"success":false,…}` |
| `speedtest_start.sh` | POST | `{"success":true,"pid":1234}` or `{"success":false,"error":"already_running\|not_installed\|start_failed"}` |
| `speedtest_status.sh` | GET | `{"status":"idle\|running\|complete\|error", …}` |

`speedtest_start.sh` accepts an optional `{"server_id": 1234}` body. The id is validated as a bare integer (`case "$SERVER_ID" in ''|*[!0-9]*) SERVER_ID="" ;; esac`) before it is `sed`-patched into the wrapper script, because that value ends up on a command line.

### `speedtest_status.sh` is destructive — and now serialized

The status endpoint is not a read. When the PID it is tracking has died, it **harvests**: it writes `RESULT_FILE` and `rm`s both `PID_FILE` and `OUTPUT_FILE`.

That was safe while the dialog was the only consumer. It is not safe now that the dashboard tile polls the same endpoint in `watch` mode. The race, concretely: poller A `rm`s `OUTPUT_FILE` in the window between poller B's `[ -s "$OUTPUT_FILE" ]` check and poller B's read — so B finds nothing, concludes "Process exited with no output", and turns a **successful** test into a false `{"status":"error"}` card.

The whole harvest therefore runs inside an exclusive `flock`:

```sh
(
    if speedtest_flock_wait 9 3; then
        …harvest…
    else
        echo '{"status":"running"}'
    fi
) 9<"$LOCK_FILE"
```

Three details in that block are load-bearing:

- **`9<` is a READ redirect, not `9>`.** `9>` would truncate the lock file every time the endpoint is hit. (`flock` is like a "do not disturb" sign hung on a file descriptor — only one process can hold the exclusive sign at a time; it does not care whether the fd is open for reading or writing.)
- **BusyBox `flock` has no `-w`/`--timeout`** — verified live on-device (`flock -w 5` errors `invalid option -- 'w'`). `speedtest_flock_wait()` polls `flock -x -n` in a loop with `sleep 0.2` instead, matching the idiom already proven in `sim_registry.sh` / `cgi_auth.sh` / `sms.sh`.
- **Fractional sleep IS supported** here (BusyBox v1.31.1, verified live). That granularity matters: only the *losing* poller waits, and with two consumers one of them loses routinely at exactly the moment the result lands. At 1 s ticks that poller could sit ~3 s before answering; at 0.2 s the same 3 s safety budget costs it ~1.1 s.

### Lock contention answers `running`, never `error` or `idle`

A poller that times out on the lock gets `{"status":"running"}` with **no `phase` field**. This is deliberate and the frontend depends on it — see [the hook's phase-preservation rule](#a-running-response-with-no-phase-preserves-the-phase). Turning contention into an `error` would recreate the exact bug the lock was added to fix; answering `idle` would make a finishing test flicker.

### Ordering Rule 1 — `rm -f "$PID_FILE"` is the LAST statement of the harvest

Both ordering rules below are already commented in the source. They are documented here so nobody "tidies" them away in a future cleanup.

Removing the PID file first looks like the natural cleanup order and is wrong. A second poller arriving mid-harvest would find **no PID file**, skip the Case-1 branch — and with it the lock — fall through to the cached-result case *before* `RESULT_FILE` has been written, and report `idle`. A finishing test would visibly flicker **running → idle → complete**.

Holding the PID file until the result is durable keeps late pollers inside Case 1, where the lock hands them a benign `running`. It is also **crash-safe**: if the harvest dies partway, the surviving PID file means the next poller simply retries rather than losing the run.

### Ordering Rule 2 — `install -d` runs BEFORE the idempotence guard

In `install_speedtest_cli()`:

```sh
install -d -o root -g root -m 0755 "$speedtest_dir"   # ← must be first

if command -v speedtest >/dev/null 2>&1 && [ -x "$speedtest_dir/speedtest" ]; then
    info "speedtest CLI is already installed"
    return 0
fi
```

A device that installed the CLI under the older `mkdir -p` code **satisfies both halves of that guard while sitting on a world-writable 0777 directory**. Put the mode fix after the guard and those devices return early forever — the exact population the line exists to remediate never gets remediated. Only the network download below the guard is worth skipping; re-asserting the directory mode is free.

`/usrdata/root/bin` was found at mode **0777** on the live device — world-writable, holding a PATH-reachable binary that a `www-data` CGI execs. That is a local privilege-escalation path, and this ordering is what repairs it on every install and every OTA.

### Post-hoc diagnosis is impossible

The harvest **deletes `OUTPUT_FILE`**. Once a run has been harvested, the only surviving artifacts are:

- the single result line in `/tmp/qmanager_speedtest_result.json`
- whatever the binary wrote to `/tmp/qmanager_speedtest_error`

There is no progress log to go back to. If you are debugging a bad run, capture `OUTPUT_FILE` **while the test is still alive** — after the process exits, the first status poll consumes it.

### `speedtest_servers.sh` runs synchronously, and fails at HTTP 200

Unlike the start endpoint, the server list runs the Ookla binary **inside the request** (`speedtest --servers … > "$OUTFILE"`). Measured live at **~1.2 s** — the script's own comment claiming "2-5 seconds" is pessimistic.

It reports failure as `{"success":false,"error":"list_failed",…}` at **HTTP 200**, because that is `cgi_base.sh`'s convention: `cgi_error()` writes only a JSON body, and the 200 headers were already emitted by `cgi_headers`. So `resp.ok` is `true` on **every** failure mode this endpoint has — which is why `useSpeedtest` carries an explicit `serversError` boolean rather than relying on the fetch status. Without it the list silently collapses to "Automatic" only and the user is told nothing, at exactly the moment (a modem that just lost its connection) when someone is most likely to be opening a speed test.

A failed server list never blocks the test: "Automatic" stays selectable and the Run button stays live, because the CLI picks the nearest server itself when given no id.

### There is no writable HOME for the Ookla binary

Under **any** account the CGI can run as, the Ookla binary has nowhere to write its settings:

- `/root` does not exist on this platform
- `www-data`'s `/var/www` does not exist either

Both `speedtest_start.sh`'s wrapper and `speedtest_servers.sh` export `HOME="${HOME:-/root}"`, and the settings write fails every run. This is **non-fatal** — but it means the license/GDPR bootstrap re-runs on **every single invocation**.

> ⚠️ WARNING: `--accept-license --accept-gdpr` are load-bearing on **every** call, not a first-run formality. Removing them as an "optimisation" makes the binary block on an interactive prompt with no tty, and the test dies with no useful output.

### The cached result is lost on reboot

`RESULT_FILE` lives in `/tmp`, which is tmpfs. A reboot wipes it and the dashboard tile silently reverts to its no-result state ("Start a speed test to measure your current network speed."). This is not a bug report — it is expected, and the tile's design deliberately treats "no cached result" as an ordinary state rather than an error.

### OTA behaviour

`install_speedtest_cli()` is called from `main()` **outside** the `DO_PACKAGES` gate, alongside `remove_conflicts`, `ensure_zoneinfo_packages` and `install_bundled_binaries`:

```sh
install_speedtest_cli

[ "$DO_PACKAGES" = "1" ] && install_dependencies
```

Previously it lived *inside* `install_dependencies()`. Every OTA upgrade invokes the installer with `--skip-packages`, which gates that function — so a device whose install-time download failed (offline, flaky cellular) warned, continued, and then **never retried on any future OTA**. Speedtest was permanently dead with no recovery path short of a reinstall.

Other properties of the function worth keeping:

- Warn-only on every failure path — an optional download must never abort an install or an upgrade.
- `mountpoint -q /usrdata` guard first, so the binary cannot land on a filesystem that vanishes at next boot.
- 120 s download bound, because a hung TCP connection on a marginal cellular link must not stall an OTA now that this runs every time.
- Extraction is verified (`[ -f … ]`) before ownership, mode or symlink are touched — a truncated archive must never leave `/bin/speedtest` pointing at a partial target.
- `chown root:root` is asserted explicitly; the tarball ships as uid/gid `10000:10000`, an account with no `/etc/passwd` entry.

---

## Frontend

### `hooks/use-speedtest.ts` — two consumers, two cadences

| Consumer | Mode | Idle | Running |
| -------- | ---- | ---- | ------- |
| Dashboard tile (`live-latency.tsx`) | `watch: true` | 10 s detect heartbeat | 500 ms |
| Dialog (`speedtest-dialog.tsx`) | default | no polling at all | 500 ms |

`watch: true` is the entire "a run started somewhere else shows up here" feature. Previously the tile fired a one-shot fetch on mount and another on dialog close, so a run started in another tab — or from another device on the LAN — was invisible until something happened to reopen the dialog. The status endpoint took its `flock` precisely so that two hook instances polling at once is *expected* rather than merely tolerated.

### Scheduling is a self-rescheduling `setTimeout`, not `setInterval`

Measured on the device: while a test runs, the Ookla binary **saturates the single CPU core** and the status endpoint takes up to **~30 s** to answer (it is normally under 1 s).

`setInterval` fires regardless of whether the previous request returned. At a 500 ms interval against a 30 s response, that queues roughly **60 overlapping requests** onto a CPU that is already the bottleneck. A self-scheduling timeout books the next poll only *after* the current one settles, so under load the cadence degrades gracefully instead of stampeding. An `inFlightRef` guard is the second layer: a tick that fires while a request is outstanding does nothing, because that request's own completion books the next one.

> ⚠️ WARNING: Do not "simplify" this to `setInterval`. The failure it prevents does not appear in local testing — it appears only on a device under a saturated single core.

### A `running` response with no `phase` preserves the phase

```ts
if (data.phase) {
  applyPhase(data.phase as SpeedtestPhase);
} else if (!isRunningPhase(phaseRef.current)) {
  applyPhase("initializing");
}
```

A phase-less `running` is the backend's lock-contention answer: "a test is in flight but I could not read its state this instant." Defaulting it to `initializing` would snap a download back to **"Connecting"** every time the lock was busy — which, with two pollers, is routine.

### `lib/speedtest-phases.ts` — the pure step-chip state machine

`resolveStepStates(phase, failedAt)` returns a state for each of the three steps (`ping`, `download`, `upload`) from `"past" | "active" | "failed" | "future"`.

It replaced an inline index comparison that collapsed whenever `phase` was not itself one of the three steps: `findIndex` returns `-1` for `initializing`, `complete` and `error`, so **every chip rendered as "future"** and a finished run looked like one that never started. That is why the old `PhaseIndicator` could only ever be mounted inside the three running branches.

Two behaviours worth naming:

- **`complete` marks every chip `past`,** including upload — which the running branches can never do on their own, since nothing is ever "in" a phase after upload.
- **`failed` is deliberately distinct from `future`.** A run that died during upload must not render its upload chip like a run that has not reached upload yet. That distinction is the entire diagnostic value of keeping the chips on screen in the error state.

### The dialog no longer blocks closing while a test runs

The old implementation swallowed the X, Escape and outside-click for the ~40 s a run takes, and explained nothing. It protected nothing either: the test is a **detached background process** that outlives the dialog, and `refreshStatus()` re-attaches to it on reopen. `onOpenChange` now passes straight through.

### Body-mode resolution

`resolveBodyMode(phase, result, isAvailable)` is a pure function so the header, the step chips and the body can never disagree, and so no input combination renders a blank dialog. Two non-obvious guards:

- **`complete` without a result falls back to `idle`.** The previous code gated the complete branch on `phase === "complete" && result` with no other matching branch, so that combination rendered an empty body — reachable whenever `refreshStatus()` reports `complete` while the result payload is still being read.
- **`unavailable` is checked LAST, not first.** A cached result or a run already in flight is real information; hiding it behind "the CLI is missing" throws away the only thing the dialog still had to say.

### The colour contract

**One hue per measurement, held from the tile to the dialog to the result tile.**

| Measurement | Role | Tokens (`ROLE` map, `speedtest-dialog.tsx:143`) |
| ----------- | ---- | ------ |
| Download | **Downlink Rose** | `bg-downlink-container` / `text-on-downlink-container` / `bg-downlink` / ink `text-downlink-on-surface` |
| Upload | **Uplink Cyan** | `bg-uplink-container` / `text-on-uplink-container` / `bg-uplink` / ink `text-uplink-on-surface` |
| Latency / Ping | **Neutral** | `bg-surface-container-high` / `text-on-surface` / `bg-on-surface-variant` |

A download figure is never cyan and an upload figure is never rose, **in any state**. That is what lets someone glance at a finished run and know which number is which without reading the labels.

**Why this is not blue and violet any more (2026-08-16).** The contract used to read *download → `primary` blue, upload → Carrier Violet (`--lte`), latency → Uplink Cyan*, and it was wrong in a way that only shows up across pages. `--primary` is simultaneously the 5G NR identity, the brand, and "in progress"; `--lte` is the 4G LTE identity. A user learned *blue = download* here and met *blue = NR* two clicks later on the Radio Information page — and an LTE speedtest painted its upload figure in the LTE hue for reasons that had nothing to do with LTE. **Direction and radio are orthogonal facts, so they now hold orthogonal hues.** See DESIGN.md > Colors > The Direction-Is-Not-A-Radio Rule and [color-system.md](color-system.md).

**Latency gave up cyan because cyan now means *upload*.** It went neutral rather than taking a fourth hue: latency has no direction, and a three-way readout does not need three hues when one of the three is directionless.

These are **direction** fills under DESIGN.md's Identity-Chip Rule — they say *which* measurement, never *how good* it was — so each one also carries a direction glyph (`arrow_downward` / `arrow_upward` / `network_ping`) and the reading itself is machine voice (JetBrains Mono + `tabular-nums`). The glyph is not decoration: at container lightness in dark mode this system's tonal pairs collapse under red-green colour-vision simulation, so on a dark surface the arrow is the information and the hue is reinforcement.

### Live figures deliberately do not tick

`TickGroup` / `TickingValue` (see [dashboard-state-motion.md](dashboard-state-motion.md)) is **absent** from every live speedtest figure, in both the tile and the dialog. That primitive is a 700 ms dip staggered at 100 ms, tuned for the dashboard's ~3 s poll; at the speedtest's 500 ms live cadence it would never finish before the next value arrived and would read as a strobe.

The comp's rule, which is the real reason: *"a tweened number is a lie about what the modem reported."* The figure simply repaints on the poll tick.

The progress bars follow the same logic — `TrackBar` (local to the dialog, deliberately **not** `components/ui/progress.tsx`, so retiming it cannot retime every other consumer) transitions `width` **linearly** at the 500 ms cadence, so its travel *is* the data arriving.

Where a value is not yet known, both surfaces render an em-dash rather than `0.00`. A zero would be a claim about the connection; "still connecting" is not.

### Step chips depart from the Filled-Chip Rule, on purpose

The three step chips are **hand-composed containers, not `Badge` variants** — a documented departure from DESIGN.md's Filled-Chip Rule.

Three of the four chip states would map cleanly (`success` / `destructive` / `muted`), but the **active** state carries the measurement's own hue, and at the time `Badge` offered only the two **radio** identity variants (`nr` / `lte`) — using `lte` to mean "upload" would have made the colour right and the semantics wrong. Splitting one three-chip row between `Badge` and hand-composed containers would be worse than composing all four consistently.

> ℹ️ NOTE: `Badge` now *does* carry `downlink` and `uplink` variants (`components/ui/badge.tsx:102`), added with the direction token family. Two of the three active chips could migrate — but the ping chip is neutral, so the row would still be split, and the four non-chromatic marks below are what the rule actually protects. The departure stands; it is now a composition choice rather than a missing role.

Everything the rule protects is still paid for. All four states carry a distinct **non-chromatic** mark plus an `sr-only` status word:

| State | Mark | `sr-only` key |
| ----- | ---- | ------------- |
| `past` | filled `check` glyph | `speedtest.step_status_done` |
| `active` | filled breathing dot (`animate-pulse`) | `speedtest.step_status_active` |
| `failed` | filled `error` glyph | `speedtest.step_status_failed` |
| `future` | hollow outlined ring | `speedtest.step_status_pending` |

This matters because `success-container` and `warning-container` measure roughly **1.03:1** apart — the same surface to the eye, and identical under deuteranopia.

### `SPEEDTEST_TILE_H` is shared by the tile and the skeleton

`SPEEDTEST_TILE_H = "min-h-[88px]"` in `live-latency.tsx` is consumed by **both** the Speed Test tile and `LiveLatencySkeleton`.

This is not a tidiness preference. The Live Latency card runs a skeleton→content **crossfade overlay** — both are on screen at once during the handoff — so a drifted height is not a rounding detail, it is a visible jump at the exact moment the real content lands (the Skeleton-Mirror Rule).

The old 88 px was already wrong by 2 px: the play button was inheriting `Button`'s `size-9` (36 px) instead of the comp's 34 px. Pinning the disc to `size-[34px]` closes that gap rather than papering over it. It is a **min**-height, not a fixed one — the idle sentence must be allowed to wrap on a narrow card — but it must never change when the tile switches *between* its three states, which is why all three bodies are matched to a 34 px action row rather than left to their intrinsic sizes.

### Tile states

| State | Condition | Renders |
| ----- | --------- | ------- |
| Running | `isRunning` | `primary-container` fill, spinner disc, live figure + phase-local progress meter, `animate-live-ping` dot with the phase name |
| Cached | `cachedResult`, not running | Play button + two direction figure pills (download rose, upload cyan) + a relative "14 min ago" caption |
| Idle | neither | Play button + `speedtest.idle_description` |

The relative timestamp ticks on its **own** 30 s clock (`useNowSec`), independent of the status poll — in `watch` mode the endpoint returns a byte-identical cached result each time, React bails out of the re-render, and the label would otherwise freeze at whatever it said when the result first arrived. Ages beyond `ABSURD_AGE_SEC` (365 days) or negative ages collapse to "just now", because the modem stamps the result with its own clock and the browser supplies `now` — on a device that has not reached NTP, a naive diff renders "20454 d ago".

---

## i18n

All copy lives in the `dashboard` namespace under `speedtest.*`, present in all 5 locales (`en`, `zh-CN`, `zh-TW`, `it`, `id`). This change added **23 keys per locale** (the step labels and statuses, the data-cost notice, the unavailable and server-error banners, `metric_absent`, `failed_during`, the relative-time strings, `close_aria`, `tile_running_label`, `server_option`) and corrected two Italian strings. `bun run i18n:check` must pass at 100 % parity.

The one glyph added to the Material Symbols subset is **`cloud_off`** (used by the unavailable state and the server-list error banner), taking the bundled subset from 64 to 65 glyphs and 23.9 KB to 24.6 KB. It is registered in `components/ui/material-symbol-names.ts` — see [icon-system.md](icon-system.md) for the `bun run icons:check` manifest gate.

---

## Gotchas

- **`OUTPUT_FILE` is consumed by the first status poll after the process exits.** Capture it live or lose it.
- **Never make the status endpoint return `error` on lock contention.** `running` is the contract; the caller retries in 500 ms.
- **Never remove `--accept-license --accept-gdpr`.** There is no writable HOME, so the bootstrap is not sticky.
- **Never move `install -d` below the idempotence guard**, and never move `rm -f "$PID_FILE"` off the end of the harvest.
- **`resp.ok` proves nothing** for `speedtest_servers.sh` — check `data.success`.
- **A reboot clears the cached result.** Do not treat a missing result as a failure.
- **The dialog's display numerals (44/52/26 px) sit off DESIGN.md's type ramp**, which tops out at the 30 px Display step. They are deliberate, comp-authoritative and **scoped to this file** — this is the product's only surface whose entire job, for ~40 seconds, is one number changing. Do not propose them as new ramp steps, and do not "correct" the tile's 17 px/11 px figure pair either: that slot is sized to the 34 px action row and changing it breaks the skeleton mirror.
