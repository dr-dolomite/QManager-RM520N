# Rust Ping Daemon — Native Replacement for `qmanager_ping`

**Date:** 2026-05-09
**Status:** Draft (awaiting user review)
**Scope:** Replace `/usr/bin/qmanager_ping` (POSIX shell daemon) with a static ARMv7 Rust binary. Adds tri-state connectivity detection (connected / limited / disconnected) and profile-driven probe cadence.

## Problem

The current `qmanager_ping` is a POSIX shell daemon that probes internet reachability every 5s by forking `curl` for each probe. Per cycle it spawns ~5–7 child processes (`curl`, `awk` for ms conversion, `mv`, `sleep`, occasional `tail`+`mv` for history trim). The bash interpreter holds ~2–4 MB RSS resident.

The dominant runtime cost is hidden: every `curl` invocation does a full TCP handshake before the HTTP request, so the reported `last_rtt_ms` is mostly handshake latency (~50–200 ms on cellular), not real round-trip data latency. The graph users see is dominated by connection-setup overhead.

The probe itself also discards information: when a carrier intercepts HTTP traffic and serves a billing/cap/activation page, the daemon sees `code != 204` and treats this identically to a network outage. This collapses two distinct cellular failure modes into one, denying the UI the ability to surface "your link is fine but the carrier is limiting you."

## Goals

1. **Eliminate per-cycle forks** by replacing the shell daemon with a single static Rust binary using blocking syscalls.
2. **Persistent HTTP keep-alive** — one TCP connection per target host reused across probes. Reported `last_rtt_ms` becomes real RTT, not handshake time.
3. **Tri-state connectivity** — distinguish `connected` (HTTP 204), `limited` (HTTP non-204, carrier intercept), and `disconnected` (no TCP / carrier link down). Surface in the JSON cache so UI can render a yellow "Limited by carrier" badge.
4. **User-configurable probe cadence** via four named profiles (Sensitive 1s / Regular 2s / Relaxed 5s / Quiet 10s) selectable from a future System Settings card.
5. **Zero coordination cost on existing consumers** — `qmanager_poller`'s `read_ping_data` and `qmanager_watchcat`'s `read_ping` continue working unmodified. New fields are purely additive.

## Non-goals

- Replacing `curl`-based probing in any other daemon. Scope is `qmanager_ping` only.
- Building the System Settings UI for profile selection. Frontend phase ships separately and reads `/etc/qmanager/ping_profile.json`.
- Building the Network Status badge UI changes for the new "limited" state. Separate frontend phase reads `connectivity` field from poller's `status.json`.
- Compressing the binary with UPX (Rust ARM + UPX = segfault on exit per project memory).
- Replacing the existing shell test harness (`scripts/test/qmanager-ping-probe.sh`) with another shell harness — it's deleted in favor of `cargo test`.

## Background

### Current implementation

`scripts/usr/bin/qmanager_ping` (~230 lines POSIX sh) probes two HTTP endpoints (`http://www.gstatic.com/generate_204` and `http://cp.cloudflare.com/`) every `PING_INTERVAL=5s`, alternating between them. A two-state streak machine declares `reachable=false` after `FAIL_THRESHOLD=3` consecutive failures, and `reachable=true` after `RECOVER_THRESHOLD=2` consecutive successes. Carrier sysfs (`/sys/class/net/rmnet_data0/carrier`) is read first as a cheap early-exit gate.

### Output contract (existing)

- `/tmp/qmanager_ping.json` — 8-field flat JSON, atomic write via `.tmp` + `mv`. Read by `qmanager_poller` (`read_ping_data` at line 985) and `qmanager_watchcat` (`read_ping` at line 215, uses `jq` for `timestamp`, `streak_fail`, `reachable`, `during_recovery`).
- `/tmp/qmanager_ping_history` — flat-file ring buffer, one `<float>` or literal `null` per line. Read by poller for stats (avg/min/max/jitter/loss in one awk pass).
- `/tmp/qmanager_recovery_active` — read-only input from watchcat. Daemon checks for existence to set `during_recovery: true`.

### Why HTTP 204 (still) — for cellular

WiFi-style captive portals (hotel, airport) don't apply to a cellular modem talking directly to a carrier APN. However, **carrier-side HTTP intercept** is a real cellular failure mode:

- Past-due / suspended billing → carrier core injects HTTP redirect to billing portal (TCP works, DNS resolves, HTTP returns 200 with HTML).
- Data-cap throttle → carrier serves "you've hit your cap" page on port 80.
- First-activation walled garden → fresh SIMs only reach carrier activation portal.
- Roaming partner notice pages.

A content check (must be exactly `204`) catches these; TCP-success or DNS-success checks would not. The defense is identical to WiFi captive portal detection even though the failure mechanism differs.

## Design

### Section 1 — Architecture

Single static ARMv7 musleabihf binary at `/usr/bin/qmanager_ping`. Same `qmanager-ping.service` systemd unit lifecycle as today. Drop-in replacement at the systemd layer.

Internal modules (one crate, ~400 LOC total):

| Module | Responsibility | Approx LOC |
|---|---|---|
| `config` | Load `/etc/qmanager/ping_profile.json` + env overrides; expose `ProfileConfig` struct. | 40 |
| `carrier` | Read `/sys/class/net/rmnet_data0/carrier`; 1-byte syscall, no fork. | 10 |
| `probe` | `KeepAliveClient` — persistent TCP per target, hand-rolled HTTP/1.1 GET, parse status line, time RTT. Returns `ProbeOutcome` enum. | 120 |
| `state` | Tri-state streak machine. Time-based thresholds compiled to cycle counts at config load. | 60 |
| `history` | `VecDeque<Option<f32>>` ring, capped by `history_secs / interval_sec`. Atomic flat-file write. | 30 |
| `cache` | `serde_json` JSON cache write, atomic via `.tmp` + `rename(2)`. | 40 |
| `reload` | `stat /tmp/qmanager_ping_reload` once per cycle; on present, reload config + unlink flag. | 20 |
| `pid` | Singleton guard via `/tmp/qmanager_ping.pid`; signal-driven cleanup. | 30 |
| `qlog` | Direct file append to `/tmp/qmanager.log` matching shell qlog format (no fork to `qlog.sh`). | 30 |
| `main` | Loop, signal handling, error fan-in. | 60 |

**Crate budget (deliberately minimal):**

- `serde` + `serde_json` — JSON cache + profile config (~150 KB)
- `libc` — PID alive check via `kill(pid, 0)` (~5 KB)
- `signal-hook` — clean SIGTERM/SIGINT (~20 KB)
- **No HTTP crate** — `std::net::TcpStream` plus ~50 LOC of HTTP/1.1
- **No async runtime** — sync, single-threaded, blocking I/O
- **No TLS** — probes are plain HTTP by design

Expected binary size: **300–450 KB stripped, no UPX.**

### Section 2 — HTTP keep-alive client

The `KeepAliveClient` owns one `Option<TcpStream>` per target host (two total). Connection state is preserved across probe cycles.

**Per-probe procedure:**

1. Pick target via rotation (alternates each cycle, identical to current shell behavior).
2. If `Some(stream)` for that host: attempt `GET / HTTP/1.1\r\nHost: <host>\r\nConnection: keep-alive\r\n\r\n` over the existing stream.
3. If write or status-line read fails (broken pipe, EOF, timeout): drop the stream, set `tcp_reused=false`, fall through to step 4.
4. If `None`: `TcpStream::connect_timeout(addr, 2s)`, `set_read_timeout(Some(2s))`, `set_write_timeout(Some(2s))`. Send the GET request.
5. Read the status line. Parse `HTTP/1.[01] (\d{3})`. If parse fails, classify as `Disconnected("malformed_response")`.
6. Drain headers (read until `\r\n\r\n`). If `Connection: close` is present, drop the stream after this exchange.
7. Drain body if `Content-Length` indicates one. (204 has no body per RFC; some carriers return 200 with HTML — must drain to keep the stream usable for the next probe.)
8. Record RTT as `Instant::now() - request_start`.
9. Return `ProbeOutcome` based on the parsed status code (see Section 3).

**Connection lifetime expectations:** Real-world keep-alive on cellular tends to survive 30–120 seconds before the carrier or peer NATs force a reset. The client treats reset as a normal event — drops the stream, reconnects on next probe, sets `tcp_reused=false` for that single cycle.

**No connection pool / no retry within a probe.** A single failed probe is just one streak-fail event; no per-probe retry logic. The streak machine handles transient failures via hysteresis at the cycle level, not the probe level.

### Section 3 — Tri-state probe outcome

`ProbeOutcome` distinguishes three result classes:

```rust
enum ProbeOutcome {
    Connected   { rtt_ms: f32, tcp_reused: bool },
    Limited     { rtt_ms: f32, http_code: u16, tcp_reused: bool },
    Disconnected { reason: DownReason },
}

enum DownReason {
    CarrierDown,        // sysfs reads != "1"
    Timeout,            // connect_timeout or read/write timeout
    Refused,            // ECONNREFUSED
    Reset,              // ECONNRESET / EPIPE
    Dns,                // resolve failure (rare — we use IPs preferred but support hostnames)
    Malformed,          // status line unparseable
}
```

**Classification rules:**

- HTTP `204` → `Connected`
- HTTP `200`, `301`, `302`, `307`, any other 2xx/3xx → `Limited` (carrier intercept signature)
- HTTP `4xx`, `5xx` → `Limited` (server-side problem; not a network failure, but not real internet)
- TCP failure → `Disconnected` with appropriate `DownReason`
- Carrier sysfs `0` or unreadable → `Disconnected { CarrierDown }`

**Why 4xx/5xx is Limited, not Disconnected:** The TCP path works, the server is reachable. From a "do we have working internet?" UI perspective, the answer is "no, but it's not a link issue." Treating it as Limited keeps the watchcat from doing useless modem recoveries (per Section 7).

### Section 4 — Tri-state streak machine

Three streak counters (`streak_success`, `streak_limited`, `streak_fail`) and one current `connectivity` enum (`Connected | Limited | Disconnected`). Whichever streak reaches its threshold first wins; the other two reset when transitioning.

**State transitions:**

```
                    fail_threshold reached
        ┌─────────────────────────────────────┐
        ▼                                     │
  ┌──────────────┐  intercept_threshold  ┌────┴─────┐
  │ DISCONNECTED │ ──────────────────►   │ LIMITED  │
  └──────┬───────┘                       └────┬─────┘
         │                                    │
         │ recover_threshold                  │ fail_threshold
         │                                    │
         ▼                                    ▼
   ┌─────────────┐  intercept_threshold ┌──────────┐
   │  CONNECTED  │ ──────────────────►  │ LIMITED  │
   └─────────────┘                      └──────────┘
         ▲
         │ recover_threshold (from any state)
```

**Counting rules per probe outcome:**

| Outcome | streak_success | streak_limited | streak_fail |
|---|---|---|---|
| Connected | +1 | 0 | 0 |
| Limited | 0 | +1 | 0 |
| Disconnected | 0 | 0 | +1 |

**Transition rules:**

- `streak_success >= recover_threshold_cycles` → `connectivity = Connected` (from any state)
- `streak_limited >= intercept_threshold_cycles` → `connectivity = Limited`
- `streak_fail >= fail_threshold_cycles` → `connectivity = Disconnected`

Thresholds are derived at config load:

```
fail_threshold_cycles      = max(1, ceil(fail_secs      / interval_sec))
recover_threshold_cycles   = max(1, ceil(recover_secs   / interval_sec))
intercept_threshold_cycles = max(1, ceil(intercept_secs / interval_sec))
```

### Section 5 — Output contract

#### `/tmp/qmanager_ping.json`

Atomic write via `.tmp` + `rename(2)`. Schema:

```json
{
  "timestamp": 1707900000,
  "targets": ["http://www.gstatic.com/generate_204", "http://cp.cloudflare.com/"],
  "interval_sec": 2,
  "last_rtt_ms": 34.2,
  "reachable": true,
  "streak_success": 12,
  "streak_fail": 0,
  "during_recovery": false,

  "connectivity": "connected",
  "limited_reason": null,
  "down_reason": null,
  "streak_limited": 0,
  "probe_target_used": "http://www.gstatic.com/generate_204",
  "http_code_seen": 204,
  "tcp_reused": true,
  "fail_secs": 10,
  "recover_secs": 6,
  "intercept_secs": 8,
  "profile": "regular"
}
```

**Backwards-compatible fields (above the blank line in source):** byte-for-byte identical to today's schema. `qmanager_poller`'s `read_ping_data` and `qmanager_watchcat`'s `read_ping` (which uses jq paths `.timestamp`, `.streak_fail`, `.reachable`, `.during_recovery`) continue working unmodified.

**New optional fields (below the blank line):**

| Field | Type | Meaning |
|---|---|---|
| `connectivity` | `"connected" \| "limited" \| "disconnected"` | Authoritative tri-state. Frontend reads this for badge color. |
| `limited_reason` | `int \| null` | When `connectivity=="limited"`, the HTTP code seen (e.g., 200, 302). Null otherwise. |
| `down_reason` | `string \| null` | When `connectivity=="disconnected"`, one of `"carrier_down" \| "timeout" \| "refused" \| "reset" \| "dns" \| "malformed"`. Null otherwise. |
| `streak_limited` | `int` | Consecutive limited-outcome probes. Resets on any other outcome. |
| `probe_target_used` | `string` | The target URL used this cycle. |
| `http_code_seen` | `int \| null` | Status code from the last completed HTTP exchange. Null if the probe didn't get a response. |
| `tcp_reused` | `bool` | True if this cycle rode an existing TCP connection. False on first probe to a host or after a reset. |
| `fail_secs`, `recover_secs`, `intercept_secs` | `int` | Active threshold values (from profile or env override). For diagnostics. |
| `profile` | `string` | Active profile name (`sensitive` / `regular` / `relaxed` / `quiet` / `custom`). `custom` if env vars override profile defaults. |

**Semantic invariants:**

- `reachable == (connectivity == "connected")` — `reachable` is preserved as a boolean for legacy consumers.
- `last_rtt_ms` is **JSON null** (not the string `"null"`) on any non-Connected outcome.
- `streak_fail` increments **only** on Disconnected outcomes. A Limited probe sets `streak_limited=N+1, streak_fail=0` — diverging from today, where Limited probes (HTTP 200, 5xx, etc.) also incremented `streak_fail`. This is a deliberate behavioral change so watchcat can distinguish carrier intercepts from link failures (see Migration in Section 8).

#### `/tmp/qmanager_ping_history`

Unchanged format: one `<float>` or literal `null` per line, oldest at top, newest at bottom. Trimmed to `history_size = history_secs / interval_sec` lines. Atomic write of the entire file every cycle. Poller's existing single-pass awk over this file for stats (avg/min/max/jitter/loss) keeps working without modification.

### Section 6 — Configuration

#### `/etc/qmanager/ping_profile.json`

Source of truth for the active profile. Written by the (future) System Settings CGI. Default file shipped by installer with `"profile": "relaxed"` matching today's 5s behavior.

```json
{
  "profile": "regular",
  "interval_sec": 2,
  "fail_secs": 10,
  "recover_secs": 6,
  "intercept_secs": 8,
  "history_secs": 300
}
```

#### Profile presets (ship in installer + System Settings UI button mapping)

| Profile | `interval_sec` | `fail_secs` | `recover_secs` | `intercept_secs` | `history_secs` | Wall-clock fail | Wall-clock intercept |
|---|---|---|---|---|---|---|---|
| `sensitive` | 1 | 6 | 3 | 8 | 300 | 6s | 8s |
| `regular` *(default)* | 2 | 10 | 6 | 8 | 300 | 10s | 8s |
| `relaxed` | 5 | 15 | 10 | 8 | 300 | 15s | 10s (2 cycles, ceil) |
| `quiet` | 10 | 30 | 20 | 8 | 600 | 30s | 10s (1 cycle, ceil) |

#### Resolution order (highest wins)

1. **Environment variables** — `PING_INTERVAL`, `FAIL_SECS`, `RECOVER_SECS`, `INTERCEPT_SECS`, `HISTORY_SECS`, `PING_TARGET_1`, `PING_TARGET_2`, `CARRIER_FILE`. Set in `/etc/qmanager/environment` for diagnostic / power-user overrides. If any time-based env var is set, `profile` field in JSON output becomes `"custom"`.
2. **`/etc/qmanager/ping_profile.json`** — profile + thresholds.
3. **Hardcoded Rust defaults** — match `regular` profile if both above are missing.

#### Reload mechanism

Path: `/tmp/qmanager_ping_reload`.

Daemon stats this file once per cycle (one syscall, no fork). On present:

1. Re-read `/etc/qmanager/ping_profile.json` and env vars.
2. Recompute thresholds and history capacity.
3. Truncate or extend the in-memory history ring to the new capacity (keep newest entries on shrink).
4. Emit `qlog_state_change "profile_changed: <old> → <new>"`.
5. `unlink("/tmp/qmanager_ping_reload")`.
6. **Streak counters preserved** — switching profile mid-flight does not reset `connectivity` state. Thresholds change immediately but the next streak transition is evaluated against the new threshold count.

**Why a flag file (not SIGHUP):** matches existing project pattern (`/tmp/qmanager_sms_reload`). Works from CGI without `kill` privileges or knowing the daemon's PID.

### Section 7 — Watchcat coordination change

`qmanager_watchcat` currently reads `streak_fail` and `reachable` to drive its Tier 1–4 recovery state machine. With tri-state connectivity, the watchcat must distinguish "Limited by carrier" (recovery won't help — modem reset, cfun toggle, SIM failover, reboot all leave the carrier intercept page in place) from "Disconnected" (recovery may help).

**Watchcat update (`scripts/usr/bin/qmanager_watchcat`):**

1. `read_ping()` adds a new captured field: `ping_connectivity` (read via jq from `.connectivity`, default `"disconnected"` if missing for legacy ping.json files during the upgrade window).
2. State machine entry condition (currently `if [ "$ping_streak_fail" -gt 0 ]`) is augmented:

```sh
if [ "$ping_connectivity" = "limited" ]; then
    # Carrier-side limitation — recovery cannot help. Stay in monitor.
    qlog_info "MONITOR: carrier-limited (HTTP $(jq -r '.limited_reason' $PING_CACHE)); skipping recovery"
    state="monitor"
    failure_counter=0
elif [ "$ping_streak_fail" -gt 0 ] && [ "$ping_connectivity" = "disconnected" ]; then
    # Original recovery path
    state="suspect"
    ...
fi
```

3. `during_recovery` is **never set true** while connectivity is `limited`. Watchcat clears the recovery flag when transitioning into a limited state, so the daemon's `during_recovery` field correctly reads false.

This is a coordinated change: watchcat update ships in the same release as the Rust ping daemon. The watchcat update is small (~15 LOC) and shell-only.

### Section 8 — Migration semantics

#### `streak_fail` behavior change

Today: `streak_fail` increments on any non-204 outcome (HTTP 200, HTTP 5xx, TCP failure — all collapse to "fail").

New: `streak_fail` increments **only** on `Disconnected` outcomes. Limited outcomes increment `streak_limited` and reset `streak_fail` to 0.

**Why this is the right change:** Watchcat uses `streak_fail` to decide when to start recovery. Recovery should only run for actual link failures, not for carrier intercepts. Coupling the field's semantic to the daemon's tri-state is the correct alignment.

**Compatibility note:** Watchcat is updated in lockstep (Section 7). No external CGI or frontend reads `streak_fail` directly today (verified via grep across the codebase). Risk surface is internal-only.

#### Profile config bootstrap

On installer upgrade:

- If `/etc/qmanager/ping_profile.json` does not exist → installer writes default with `"profile": "relaxed"` (5s interval, matches today's behavior — zero behavioral change for existing installs).
- If `/etc/qmanager/environment` contains old `FAIL_THRESHOLD=N` etc. → installer migration script computes time-based equivalents (`FAIL_SECS = N * 5`) and rewrites the file. Old variable names are removed.
- New installs use `"profile": "regular"` (2s default) — the more responsive default for fresh deployments.

### Section 9 — Build & deploy

#### Toolchain (reuses WSL2 setup from `atcli_smd11`)

- Target: `armv7-unknown-linux-musleabihf`
- Build: `cargo build --release --target=armv7-unknown-linux-musleabihf`
- Strip: `arm-linux-gnueabihf-strip target/.../release/qmanager_ping`
- **Do not UPX** — Rust ARM + UPX = segfault on exit (project memory).

#### Repo layout

```
ping-daemon/                          # new, sibling to discord-bot/
├── Cargo.toml
├── Cargo.lock
├── build-ping-daemon.sh              # mirrors build-discord-bot.sh pattern
├── README.md
└── src/
    ├── main.rs
    ├── config.rs
    ├── carrier.rs
    ├── probe.rs
    ├── state.rs
    ├── history.rs
    ├── cache.rs
    ├── reload.rs
    ├── pid.rs
    └── qlog.rs
```

`build-ping-daemon.sh` outputs the stripped binary to `scripts/usr/bin/qmanager_ping`, replacing the current shell script. The existing installer (which copies everything under `scripts/usr/bin/` to `/usr/bin/` on the device) needs no change.

#### Systemd unit (`qmanager-ping.service`)

Existing unit file at `scripts/etc/systemd/system/qmanager-ping.service` is updated:

- Drop the `Environment=FAIL_THRESHOLD=...`, `Environment=RECOVER_THRESHOLD=...`, `Environment=HISTORY_SIZE=...` lines (cycle-count names are gone).
- Add `Environment=FAIL_SECS=15`, `Environment=RECOVER_SECS=10`, `Environment=INTERCEPT_SECS=8`, `Environment=HISTORY_SECS=300` (relaxed-profile defaults — preserve today's 5s/15s/10s behavior on fresh starts before the JSON config is read).
- Keep `EnvironmentFile=-/etc/qmanager/environment` (operator override path).
- Keep `ExecStart=/usr/bin/qmanager_ping`, `Restart=on-failure`, `RestartSec=5s`.

#### Installer changes (`install.sh`)

- Skip CRLF-strip pass for the binary (CRLF only matters for shell/conf files).
- Ship default `/etc/qmanager/ping_profile.json` with `"profile": "relaxed"` if file does not already exist.
- Migration: parse old `FAIL_THRESHOLD` etc. from existing `/etc/qmanager/environment` and rewrite to new `*_SECS` variables. Remove old keys.
- `systemctl daemon-reload && systemctl restart qmanager-ping` after replacing the binary.

#### Test harness cleanup

Delete `scripts/test/qmanager-ping-probe.sh` (shell function extractor for the old shell daemon — no longer applicable). Replace with `scripts/test/qmanager-ping-smoke.sh` (Section 11.3).

### Section 10 — Error handling

**Per-probe failures** (treated as the appropriate `Disconnected { reason }` or `Limited { code }` outcome; never panic):

- Carrier file unreadable or `!= "1"` → `Disconnected { CarrierDown }`
- TCP `connect_timeout` exceeded → `Disconnected { Timeout }`
- TCP write/read timeout → `Disconnected { Timeout }`
- ECONNREFUSED → `Disconnected { Refused }`
- ECONNRESET / EPIPE → `Disconnected { Reset }`
- DNS resolve failure → `Disconnected { Dns }`
- Status line unparseable → `Disconnected { Malformed }`
- Status code parsed and is non-204 → `Limited { code }`

**Per-cycle non-fatal failures** (log + continue, do NOT crash):

- Cache write `.tmp` → `rename(2)` fails (e.g., disk full): `qlog_error` once, retry next cycle.
- History flat-file write fails: same.
- Reload flag triggers config re-read but JSON is malformed: `qlog_error`, keep current config in memory, leave flag in place so the user can fix and the next cycle retries.

**Fatal at startup only:**

- Cannot bind PID file because existing live process owns it (singleton guard).
- Cannot write to `/tmp` at all (filesystem broken).
- Cargo `panic = "abort"` in release profile so any unexpected panic exits cleanly and lets systemd `Restart=on-failure` cycle the daemon.

**Signal handling:**

- `SIGTERM`, `SIGINT` → graceful shutdown via `signal-hook` channel: drop streams, unlink PID file, unlink any pending `.tmp` files, exit 0.
- `SIGHUP` → ignored (reload uses the flag file pattern, not signals).

### Section 11 — Testing

#### 11.1 — Cargo unit tests (in-tree, runs on dev / CI)

`cargo test`. No device required.

- **State machine** (`state.rs`): scripted `ProbeOutcome` sequences asserting:
  - 6 Connected probes from cold start → reach Connected exactly at `recover_threshold_cycles`.
  - Connected → Disconnected requires exactly `fail_threshold_cycles` consecutive Disconnected outcomes (any Connected or Limited interleaved resets `streak_fail`).
  - Connected → Limited requires exactly `intercept_threshold_cycles` consecutive Limited outcomes.
  - Disconnected → Limited transition (carrier link returns but serves intercept page).
  - Limited → Connected on `recover_threshold_cycles` Connected probes.
- **History ring** (`history.rs`): push N+1 entries, assert oldest evicted; resize on profile change keeps newest entries.
- **Config loader** (`config.rs`): env > json > defaults precedence; malformed JSON falls back to defaults with a logged error; profile presets resolve to expected threshold values.
- **Cache writer** (`cache.rs`): `last_rtt_ms` is JSON null (not string) on failure; all backwards-compat fields present in the exact order/type of today's schema; new fields all present and correctly typed.

#### 11.2 — Cargo integration test with stub HTTP server

Spawn a `std::net::TcpListener` thread that scripts responses based on per-test setup. Exercises `KeepAliveClient` end-to-end:

- 204 response + measurable RTT → `ProbeOutcome::Connected` with `tcp_reused=false` first cycle, `tcp_reused=true` second cycle.
- 200 response with HTML body → `Limited { http_code: 200 }`. Body fully drained (next probe still works on same connection).
- Connection drop after first probe → second probe sees the EOF, drops stream, dials fresh, succeeds. `tcp_reused=false` for cycle 2, `true` for cycle 3.
- Server returns 5xx → `Limited { http_code: 5xx }`. (Documents the design choice in Section 3.)
- Server `Connection: close` header → daemon drops stream after the response body is consumed.
- `connect_timeout` against unroutable address → `Disconnected { Timeout }` within 2s.

#### 11.3 — On-device smoke (`scripts/test/qmanager-ping-smoke.sh`)

Replaces the deleted shell harness. Short bash script that:

1. Stops `qmanager-ping.service`.
2. Starts a local Python `http.server` on port 8000 that returns 204.
3. Sets `PING_TARGET_1=http://127.0.0.1:8000/`, `PING_TARGET_2=http://127.0.0.1:8000/`, `PING_INTERVAL=1`, `CARRIER_FILE=/tmp/fake_carrier`.
4. `echo 1 > /tmp/fake_carrier`; runs the binary for 3 seconds; captures `/tmp/qmanager_ping.json`.
5. `jq -e` validates: `connectivity == "connected"`, `tcp_reused == true` on cycle 2+, `last_rtt_ms` is a number.
6. `echo 0 > /tmp/fake_carrier`; runs for 2 more seconds; validates `connectivity == "disconnected"`, `down_reason == "carrier_down"`.
7. Cleanup: kills the python server, restarts `qmanager-ping.service`.

This is a sanity check before flashing, not a CI gate.

## Open questions

- **Future:** Should the System Settings UI also expose `intercept_secs` as a user-tunable, or keep it daemon-internal? Default position: keep internal — exposing too many knobs hurts the UX. Revisit if users report false-positive limited states.
- **Future:** Should we add a fifth profile `paranoid` (1s probe + 3s fail = 3-cycle hysteresis) for users running tower-failover automation that needs the fastest possible reaction? Out of scope for v1; ship the four profiles and gather usage data.

## Success criteria

1. `/usr/bin/qmanager_ping` is replaced by the Rust binary; `systemctl status qmanager-ping` shows it `active (running)` with `MainPID` resident at expected RSS (~1–3 MB, vs ~3–5 MB for the bash script + per-cycle curl peaks).
2. `cat /tmp/qmanager_ping.json` produces valid JSON with all backwards-compat fields **and** all new fields populated.
3. `qmanager_poller`'s `read_ping_data` continues to populate `conn_internet_available`, `conn_during_recovery`, etc. without modification — verified by checking `/tmp/qmanager_status.json` for unchanged shape.
4. `qmanager_watchcat`'s `read_ping` continues to drive the recovery state machine for `disconnected` cases, and explicitly skips recovery for `limited` cases (verified via journal log message).
5. Profile change via `/tmp/qmanager_ping_reload` mid-run takes effect on the next cycle without restarting the service. Streak counters survive the change.
6. On a deliberate carrier-intercept simulation (point `PING_TARGET_1` at a server returning HTTP 200 with HTML), `connectivity` flips to `"limited"` after `intercept_threshold_cycles`. Watchcat does NOT advance to recovery state.
7. On a deliberate link drop (set `CARRIER_FILE` to a path containing `0`), `connectivity` flips to `"disconnected"` after `fail_threshold_cycles`. Watchcat advances to recovery state as today.
8. Binary size after strip is ≤500 KB. RSS at idle is ≤3 MB. No fork(2) syscalls during the probe loop (verified via `strace -e trace=fork,clone -p $(pidof qmanager_ping)` showing zero events over 60s).

## References

- Existing daemon: `scripts/usr/bin/qmanager_ping`
- Systemd unit: `scripts/etc/systemd/system/qmanager-ping.service`
- Consumer (poller): `scripts/usr/bin/qmanager_poller` lines 977–1008 (`read_ping_data`)
- Consumer (watchcat): `scripts/usr/bin/qmanager_watchcat` lines 209–245 (`read_ping`), 720–770 (state machine entry)
- Consumer (CGI, NDJSON only): `scripts/www/cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh`
- Build pattern reference: `discord-bot/build-discord-bot.sh`
- Rust toolchain reference: `atcli_smd11` upstream (1alessandro1/atcli_rust) — same target, same no-UPX rule
- Project memories: `feedback_atcli_rust_no_upx.md`, `feedback_qmanager_discord_upx_ok.md` (UPX policy split between Rust and Go), `feedback_busybox_flock.md` (irrelevant here — daemon does not lock the AT bus), `project_atcli_smd11.md`
