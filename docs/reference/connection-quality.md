# Connection Quality

> **Applies to:** RM520N-GL (SDX65) · verified 2026-10-11 (unification run, serial `61368cd2`)
> **RG501Q-EU (SDX55):** the pipeline itself is unverified there — but the three [platform facts](#platform-facts-that-shape-this-design) the probe chain depends on (`ping`, `timeout`, DNS caching) were measured on **both** devices on 2026-09-01. See [`platform-matrix.md`](./platform-matrix.md)

"Connection Quality" is the **measurement / telemetry** side of QManager's connectivity stack — the part that *observes* how good the internet link is and turns raw probe results into latency, jitter, and packet-loss numbers the UI can chart. It is deliberately separate from the [Connection Watchdog](connection-watchdog.md), which is the **recovery** side — the state machine that *acts* when the link goes down. This document covers the producer→poller consumer chain that feeds the Connection Quality page (`/monitoring/connection-quality`) and the dashboard's Connection Quality card. It does **not** re-document the watchdog's recovery ladder — see the sibling doc for that.

> ℹ️ NOTE: The two docs are siblings by design. Connection Quality owns **everything about measuring the link**: the probe targets, the probe cadence (`interval_sec`), the latency/loss thresholds, the `degraded` verdict and the single alert wait (`alert_after_min`). The Watchdog owns only **recovery policy**: `fail_threshold`, the ladder, cooldowns and SIM failover. The Watchdog page still shows and edits the cadence, but it reads and writes Connection Quality's `interval_sec` — see [Ownership boundary](#ownership-boundary--who-owns-what).

> ⚠️ WARNING — ICMP probe change (v0.1.32): the producer was switched from a compiled Rust **HTTP/204** daemon to a pure-shell **ICMP `ping`** daemon, ported from the RM551E sibling project for 1:1 parity. This was a deliberate, user-approved tradeoff that **removed the `connected`/`limited`/`disconnected` tri-state** — an ICMP echo either answers or it doesn't, so carrier-intercept ("Limited by carrier" / captive-portal / billing-wall) detection is gone. See [The producer](#the-producer--qmanager_ping-shell-icmp-daemon) for the mechanism and the [known regression path](#known-tradeoffs-and-the-icmp-regression-path).

> ⚠️ WARNING — poller/UI realignment (2026-09-01): the ICMP port changed the producer but left the **poller and the dashboard** reading the retired daemon's key set. The dashboard's "Internet" chip was consequently stuck grey on every device for six weeks. Before touching this pipeline, read [The producer key contract](#the-producer-key-contract) and [The absent-key trap](#the-absent-key-trap) — the second is the durable lesson, and it generalises well beyond this subsystem.

---

## Quick Reference

| Item | Value |
|------|-------|
| Frontend page | `/monitoring/connection-quality` (`components/monitoring/connection-quality/` — shell `connection-quality.tsx`, `shapes.ts`, `probe-targets-card.tsx`, `quality-thresholds-card.tsx`, `condition-block.tsx`) |
| Producer daemon | `qmanager_ping` — `#!/bin/sh` **ICMP `ping`** daemon (source: `scripts/usr/bin/qmanager_ping`, installed to `/usr/bin/qmanager_ping`) |
| Probe chain | Four legs, fixed order, short-circuit on first success: `cloudflare.com` → `google.com` → `1.1.1.1` → `8.8.8.8` (all four configurable) |
| Producer key contract | **13 keys**, one `jq -n` literal, no branches — [see below](#the-producer-key-contract) |
| Shared reader | `scripts/usr/lib/qmanager/conn_state.sh` — the **only** reader of `/tmp/qmanager_ping.json` (`conn_state_read`), the staleness rule, `conn_state_down_for` / `conn_state_is_up`, `conn_state_cadence`, the one latency/loss preset table, `cq_thresholds_load` / `cq_thresholds_refresh`, `cq_alert_after_min`, `cq_quality_merge` |
| Poller | `qmanager_poller` (`scripts/usr/bin/qmanager_poller`) — derives latency/jitter/loss/history **and** the `status` verdict; runs the one link detector (`detect_data_connection_events`) and the alert engine each cycle |
| Consumer (recovery) | `qmanager_watchcat` — reads the cache through `conn_state.sh`, never probes; see [connection-watchdog.md](connection-watchdog.md) |
| Ping verdict cache | `/tmp/qmanager_ping.json` (written by `qmanager_ping`, read only through `conn_state.sh`) — **slim schema, no stats/history** |
| DNS lookup cache | `/tmp/qmanager_dns.json` (root, atomic; written by `qmanager_ping`'s detached DNS job, read by the poller) — [see below](#dns-lookup-time--tmpqmanager_dnsjson) |
| History ring buffer | `/tmp/qmanager_ping_history` (flat file, one RTT float or `null` per line, read by poller for stats) |
| History-as-array CGI | `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh` (serves `/tmp/qmanager_ping_history.json` NDJSON as a JSON array) |
| Daemon config | `/etc/qmanager/ping_profile.json` — owned by Connection Quality; two CGIs write it, both by atomic key-merge — [see below](#ping_profilejson--one-owner-two-write-paths) |
| Daemon reload flag | `/tmp/qmanager_ping_reload` |
| Probe Targets CGI | `GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh` |
| Quality Thresholds CGI | `GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh` |
| Quality Thresholds config | `/etc/qmanager/quality_thresholds.json` — `latency.preset` (+ `latency.custom_ms`), `loss.preset` (+ `loss.custom_pct`), `alert_after_min`; merge-written; read by the poller, `events.sh` and `alert_engine.sh` through `conn_state.sh` |
| Quality reload flag | `/tmp/qmanager_events_reload` (consumed by `cq_thresholds_refresh` in the poller) |
| Poller status output | `/tmp/qmanager_status.json` → `connectivity` block (typed as `ConnectivityStatus` in `types/modem-status.ts`) |
| Dashboard "Internet" chip | `buildInternetChip()` in `components/dashboard/network-status.tsx` — reads `connectivity.status` and nothing else |
| Dashboard card | `components/dashboard/connection-quality.tsx` — grades its bars and history strips on `connectivity.thresholds`; see [dashboard-chart-cards.md](dashboard-chart-cards.md#connection-quality) |
| Latency displays | `components/dashboard/connection-quality.tsx` and the Latency Monitor page's `now-card.tsx` / `history-card.tsx` ([latency-monitor.md](latency-monitor.md)) — a `null` RTT is an **absent** reading, never 0 ms |

**The three-daemon split, at a glance:**

```
qmanager_ping (PRODUCER)
  ├─ /tmp/qmanager_ping.json ──→ conn_state.sh ─┬─→ qmanager_poller ─→ /tmp/qmanager_status.json ─→ UI
  │                                             │     (stats, status, events.sh detector, alert_engine)
  │                                             └─→ qmanager_watchcat (CONSUMER, recovery)
  ├─ /tmp/qmanager_ping_history ──────────────────→ qmanager_poller (read directly, for stats)
  └─ /tmp/qmanager_dns.json (detached job) ───────→ qmanager_poller (read_dns_data)
```

---

## The producer — `qmanager_ping` (shell ICMP daemon)

**Short version:** `qmanager_ping` is a small always-on POSIX-shell (`#!/bin/sh`) daemon that pings a short list of well-known internet hosts every few seconds and writes "did anything come back?" to a JSON file. It replaced a compiled Rust HTTP/204 daemon; the switch was an explicit port from the RM551E sibling project for feature parity, and it consciously drops the old tri-state.

### The four-leg chain (2026-09-02)

Each cycle walks **four legs in a fixed order and short-circuits on the first success**:

| # | Config key | Default | Kind |
|---|-----------|---------|------|
| 1 | `target_host_1` | `cloudflare.com` | hostname — the resolver picks the address family |
| 2 | `target_host_2` | `google.com` | hostname |
| 3 | `target_ip_1` | `1.1.1.1` | IPv4 literal — DNS-independent |
| 4 | `target_ip_2` | `8.8.8.8` | IPv4 literal — DNS-independent |

**Why the hostnames come first.** A bare `ping <hostname>` delegates address-family selection to the **resolver** — the system library that turns a name into an address — instead of to a config slot. One target therefore covers an IPv4-only bearer, an IPv6-only bearer and a dual-stack bearer with **zero configuration**. Measured on both devices (see [Measured on hardware](#measured-on-hardware)): glibc's RFC 3484 address-sorting rules correctly *deprioritised* IPv6 for a dual-stack name when no IPv6 source address existed, and correctly *selected* IPv6 for an AAAA-only name (`ipv6.google.com`). This replaces the old hand-rolled `target_ipv4` → `target_ipv6` fallback outright; there is no v4/v6 slot distinction any more.

**When the literal legs run.** Legs 3–4 are reached whenever **both** hostname legs fail, **for any reason** — deliberately *not* gated on a resolution-specific failure. A hostname leg can fail without DNS being at fault, telling the two apart means parsing stderr prose, and the total cost is bounded by the budget invariant below anyway.

**The verdict.** Any single leg answering is probe success; a probe fails only when **all four** fail. A healthy link therefore costs **one** leg per cycle, not four.

A leg **succeeds** when the daemon parses a numeric round-trip time greater than 0 from the ping summary line (`min/avg/max[/mdev] = a/b/c[/d]`, average = 2nd field), falling back to a per-packet `time=<n>` reading. 100 % packet loss produces no round-trip line → no RTT → leg failure. That is the fail-safe: silence reads as "down", never as "up".

### The cycle budget

Two mechanisms keep a four-leg chain from outrunning its consumers.

**Per-leg deadline.** Every leg runs as:

```sh
qm_timeout "$PROBE_DEADLINE" ping -c1 -W "$PROBE_TIMEOUT" <target>
```

with `PROBE_DEADLINE = PROBE_TIMEOUT + 1` (= 3s) — the `+1` is the name-resolution allowance. The bound goes through **`qm_timeout`** (`platform.sh`), never a bare `timeout` — the two devices accept *different* CLI forms, so no literal invocation works on both (see [platform facts](#platform-facts-that-shape-this-design)). Failure is tested as a **non-zero exit status, never as a literal code**.

**Fixed-rate loop.** The sleep at the bottom of the loop is `interval_sec − elapsed`, floored at 1 — *not* a flat `sleep interval` after the work. The cycle **period** therefore equals `interval_sec` whenever the chain fits inside it. A flat sleep would have made the real period drift by however long the chain took, which is exactly the skew that made a cycle-count threshold dishonest.

**The invariant, asserted by harness rather than by inspection:**

```
n_targets × (PROBE_TIMEOUT + 1)  <  stale_floor
        4  ×  3                  =  12   <   15    ✓
```

`stale_floor` is the 15-second floor of the [derived staleness threshold](#derived-staleness-threshold) the poller and the watchdog each compute for themselves. Worst case falls from an unbounded ~29s to a hard **12s**. If a worst-case chain ever exceeded the floor, an outage would make this cache look *stale* — the verdict would read `unknown` instead of `disconnected`, and the `internet_lost` alert would be swallowed by exactly the outage it exists to report.

> ℹ️ NOTE — the consequence, stated plainly: during a full outage the effective cadence floors at the chain cost. At the `sensitive` profile (`interval_sec` 1) the real cadence becomes about 12s. That is inherent to a four-leg chain; wall-clock debouncing is what keeps `fail_secs` truthful regardless.

<a id="accepted-consequences"></a>
### Two accepted consequences — settled, not defects

The north star for this daemon is explicitly **binary**: "there is signal and the network is registered, but is there an internet connection?" There is no captive-portal state, no auth-gateway state, no carrier-intercept classification and **no reason-for-failure field**. Two consequences follow directly, and both are **accepted and documented, not scheduled for a fix**.

**(a) DNS is now part of the verdict.** No resolution, no internet. That is the truthful answer from the user's point of view: a device that cannot resolve a name cannot reach the internet in any way the user cares about. Note the logic runs **one way only** — no resolution ⇒ no internet, but resolution ⇒ *nothing*. Proven on hardware: the RM520N-GL resolved `cloudflare.com` in 0.37s while carrying no data plan at all.

The two IPv4-literal legs are what covers resolver failure specifically, so a dead DNS server does not by itself produce a false "disconnected".

**(b) A DNS-hijacking captive portal reads as CONNECTED.** Such a portal resolves the hostname to *itself*, answers the ping, and the daemon calls the link up. This is the direct cost of the settled no-intercept decision, not a bug to be fixed — any design pressure toward a "why did it fail" field is out of scope for this surface. See [Known tradeoffs and the ICMP regression path](#known-tradeoffs-and-the-icmp-regression-path) for the wider history.

### Why the tri-state is gone

The previous Rust daemon used an **HTTP/204** probe specifically because ICMP to common DNS anycast IPs (`1.1.1.1`, `8.8.8.8`) was observed to be **100 % dropped by this project's cellular carrier** on the `rmnet` interface — an ICMP check would have reported the link permanently down (this is captured in project memory: *"Carrier drops ICMP to common DNS IPs on rmnet"*). The HTTP content check also yielded a third state, `limited`, that distinguished a **carrier intercept** (billing/data-cap/activation walled garden answering with a `200`/`302` instead of `204`) from a real outage.

The ICMP port **knowingly gives that up** in exchange for 1:1 parity with the RM551E daemon. There is no `limited` state anymore — an ICMP echo request either gets a reply or it doesn't:

| Old (Rust HTTP/204) | New (shell ICMP) |
|---------------------|------------------|
| `connected` (HTTP 204) | `reachable: true` |
| `limited` (any other HTTP code — carrier intercept) | **— gone —** (an intercept that still routes ICMP now reads as `reachable: true`; one that drops ICMP reads as `reachable: false`) |
| `disconnected` (TCP/DNS failure) | `reachable: false` |

See [Known tradeoffs and the ICMP regression path](#known-tradeoffs-and-the-icmp-regression-path) for what this costs.

### What the daemon writes — `/tmp/qmanager_ping.json`

Atomic write (`.tmp` + `mv`) every cycle. The schema is now **slim** — the daemon emits only reachability/streak facts; the poller computes all stats (avg/min/max/jitter/loss) and the history array:

```json
{
  "timestamp": 1707900000,
  "mono": 84213,
  "profile": "relaxed",
  "targets": ["cloudflare.com", "google.com", "1.1.1.1", "8.8.8.8"],
  "interval_sec": 5,
  "last_rtt_ms": 34.2,
  "reachable": true,
  "streak_success": 12,
  "streak_fail": 0,
  "during_recovery": false,
  "last_family": "ipv4",
  "last_target": "cloudflare.com",
  "fail_elapsed_sec": 0
}
```

| Field | Meaning |
|-------|---------|
| `timestamp` | Wall-clock epoch of the write. |
| `mono` | Boot-relative monotonic seconds (from `/proc/uptime`) — immune to wall-clock jumps. |
| `profile` | Active profile name (`sensitive`/`regular`/`relaxed`/`quiet`) — a label the daemon resolves to cadence/thresholds; the CGI only writes the name. |
| `targets` | A **4-element array in probe order**: `[target_host_1, target_host_2, target_ip_1, target_ip_2]`. |
| `interval_sec` | Effective probe interval in seconds. Also the input to every consumer's [derived staleness threshold](#derived-staleness-threshold). |
| `last_rtt_ms` | Average RTT of the winning leg (1 decimal), or JSON `null` when all four legs failed. |
| `reachable` | Debounced boolean. The debounce is **accumulated monotonic seconds**, not a count of cycles: it flips to `false` after `fail_secs` wall-clock seconds of continuous failure, back to `true` after `recover_secs` seconds of continuous success. The old cycle-count thresholds `FAIL_THRESHOLD` / `RECOVER_THRESHOLD` are **deleted** — renaming them would have silently changed what a number meant, so a stale reader breaks loudly instead. |
| `streak_success` | Consecutive successful cycles. Still a plain **count** — contract unchanged. |
| `streak_fail` | **Consecutive failed cycles**, a plain count. The Watchdog uses it only to leave MONITOR (`> 0` → SUSPECT); the down declaration is wall-clock (`fail_elapsed_sec`). `events.sh` holds latency/loss *entry* while it is `> 0`. |
| `during_recovery` | `true` while `/tmp/qmanager_recovery_active` exists (the watchdog is mid-recovery). The poller's `status` reads `recovery` while it is set. It never changes the `reachable` verdict, and no consumer may treat it as one. |
| `last_family` | `ipv4` \| `ipv6` \| `none` — which address family answered last cycle. Now **derived** by parsing the resolved address out of ping's first output line (`PING host (ADDR)`); a `:` in that address means `ipv6`, anything else `ipv4`. The output format is identical on both devices. `none` means nothing answered. |
| `last_target` | The exact target string that produced `last_rtt_ms`, or `""` when nothing answered. See below. |
| `fail_elapsed_sec` | Monotonic seconds since the first failure of the current run of failures; `0` when healthy. See below. |

**`last_target` — why latency is attributed to the leg that actually replied.** The chain short-circuits, so `targets[0]` is the winner only on a link where the first leg answers. The daemon also **truncates `/tmp/qmanager_ping_history` whenever the winning target changes** from the previous cycle, so a switch renders as a **gap** in the latency chart rather than a phantom latency step, and jitter is only ever computed across one host.

> ℹ️ NOTE — the rejected alternative. Pinning latency to target 1 unconditionally was considered and rejected: a device whose carrier blocks target 1 — the [documented ICMP regression path](#known-tradeoffs-and-the-icmp-regression-path) — would read "connected" via a fallback leg while its latency chart stayed permanently empty.

**`fail_elapsed_sec` — the Watchdog's down clock.** `conn_state_down_for N` is true only when the read is fresh, `reachable` is `false`, **and** `fail_elapsed_sec >= N`. The Watchdog passes `fail_threshold × interval_sec`. Because `reachable` itself only flips after `fail_secs`, the effective trigger is the **later** of `fail_secs` and `fail_threshold × interval_sec`.

<a id="the-producer-key-contract"></a>
### The producer key contract — exactly these thirteen keys

> ⚠️ WARNING: the table above is the **complete** key set, not a selection from it. `write_cache()` (`scripts/usr/bin/qmanager_ping`) is a single `jq -n` object literal with thirteen members and no conditional branches, so every cycle writes all thirteen and **never** a fourteenth. A consumer that reads any other key gets its own fallback — forever, on every device, silently.

```
timestamp  mono  profile  targets  interval_sec  last_rtt_ms  reachable
streak_success  streak_fail  during_recovery  last_family
last_target  fail_elapsed_sec
```

**Fields that are GONE** (emitted by the retired Rust HTTP daemon, never written by the shell daemon): `connectivity`, `limited_reason`, `down_reason`, `streak_limited`, `probe_target_used`, `http_code_seen`, `tcp_reused`. The `connectivity` / `state` tri-state does not exist at the producer, and nothing downstream may claim otherwise — see [The absent-key trap](#the-absent-key-trap).

If you add a key to `write_cache()`, add it to the list above in the same change. Reading this contract is the cheap way to catch a producer/consumer divergence; the expensive way is what actually happened — six weeks of a wrong badge on every shipped device, caught by probing live hardware.

<a id="dns-lookup-time--tmpqmanager_dnsjson"></a>
### DNS lookup time — `/tmp/qmanager_dns.json`

`qmanager_ping` is still the only prober, and it also times one DNS lookup: `one.one.one.one` against the **carrier resolver**, the first `nameserver` line in `/etc/resolv.conf`, re-read on every run because it changes on reattach. The file is a separate key set, not part of the thirteen-key contract above:

```json
{ "ms": 250, "ok": true, "resolver": "10.151.151.44", "name": "one.one.one.one", "mono": 84213, "ts": 1760000000 }
```

| Key | Meaning |
|-----|---------|
| `ms` | Lookup time in milliseconds, in **10 ms steps** (`/proc/uptime` brackets, floored at 10). `null` when the lookup failed. |
| `ok` | `true` only when `nslookup` exited 0 **and** printed an `Address` line after a `Name:` line. The resolver header has its own `Address` line, so a bare `Address` match would pass a failed lookup. |
| `resolver` | The nameserver used, or `""` when `/etc/resolv.conf` had none. |
| `mono` / `ts` | `/proc/uptime` seconds and wall-clock epoch of the write. |

Invariants:

- **Never inside the probe loop.** `dns_probe_maybe` spawns `dns_job` as a detached background job after each cycle's verdict is written. A dead resolver takes the full `qm_timeout 5`, which would break the [cycle budget](#the-cycle-budget) (`12 < 15`).
- **Cadence:** once at start, then every 60 s (`DNS_INTERVAL`). A `reachable` true → false edge forces a lookup on the next free slot, but never sooner than 10 s after the previous one (`DNS_MIN_GAP`), so an outage never shows the last good number. At most one job runs; one older than 15 s (`DNS_JOB_MAX`) is presumed gone, which guards against PID reuse.
- **Every exec pins `</dev/null`**, and the write is `mktemp` + `chmod 644` + `mv` as root.
- **The poller trusts it only while fresh.** `read_dns_data` publishes `connectivity.dns_lookup_ms` as a number only when `ok` is `true` and the file's `mono` age is 0–180 s (`DNS_MAX_AGE_SEC`); otherwise `null`. `dns_resolver` follows the same freshness gate. A stale number is never shown.

Measured on RM520N-GL `61368cd2`: live resolver `10.151.151.44` → `{"ms":250,"ok":true}`; dead `192.0.2.1` → `ms: null, ok: false` after 5.08 s; during a simulated 2-minute outage `dns_lookup_ms` read `null` and returned within 15 s of the restore.

### Config and live reload

The daemon reads `/etc/qmanager/ping_profile.json` (env vars override it; hardcoded relaxed-profile defaults back it up). The active **profile name** maps to a cadence/window table the daemon owns in `resolve_profile()`. `fail_secs` / `recover_secs` are carried through as **seconds** and compared against accumulated monotonic seconds — they are never converted into a count of cycles. (`ceil(secs / interval)` survives only for `history_secs` → ring length.)

| Profile | `interval_sec` | `fail_secs` | `recover_secs` | `history_secs` |
|---------|---------------|-------------|----------------|----------------|
| sensitive | 1 | 15 | 3 | 300 |
| regular | 2 | 20 | 6 | 300 |
| relaxed *(default)* | 5 | 30 | 10 | 300 |
| quiet | 10 | 60 | 20 | 600 |

**Why nothing here promises a fail window under 14 seconds** (retuned 2026-09-02). `fail_elapsed_sec` is 0 on the first failing cycle, so the earliest possible down-verdict is one whole cycle period after the outage starts. A failing cycle is capped at four legs × `PROBE_DEADLINE` (3s) = 12s, plus roughly 0.4s of forks on a Cortex-A7, plus the floored 1-second sleep at the bottom of the loop — about **13.4s**. A `fail_secs` below that is not a more aggressive setting, it is a promise the chain cannot keep: the verdict lands a cycle later regardless and the number shown to the user is wrong. The old table promised 6s and 10s, both unachievable by construction.

The per-leg deadlines were deliberately **not** shortened to buy a faster verdict — that would risk calling a slow-but-alive cellular link down. The consequence is that the fast end of the table is clamped: `sensitive` now means "the earliest verdict this chain can honestly deliver", not six seconds. The four profiles stay distinct in both axes (cadence 1/2/5/10, window 15/20/30/60).

`recover_secs` was **not** inflated to match. The success path short-circuits on leg 1, so a healthy cycle costs ~0.3s and the fixed-rate loop makes its period exactly `interval_sec`; every `recover_secs` above is at or over its own `interval_sec`, which is the only floor that path has. The degraded case (legs 1–3 dead, leg 4 answering, ~10s) recovers *later* than promised, which is the conservative direction.

Per-field JSON keys (`interval_sec`, `fail_secs`, `recover_secs`, `history_secs`) override the profile table when present and numeric. `interval_sec` is the one override a UI writes: `settings/ping_profile.sh` accepts it directly (1–60), and the Watchdog page writes it through `monitoring/watchdog.sh` (see [one owner, two write paths](#ping_profilejson--one-owner-two-write-paths)). A stored `interval_sec` is the cadence the **Watchdog page owns**, and a profile save **never removes it** (user decision, 2026-11-02). The profile still sets the debounce windows (`fail_secs` / `recover_secs`), but while an override is stored it also shadows the profile's cadence, so the UI shows "Every N s (Watchdog)" and links to the Watchdog page. There is no separate ownership marker: any stored `interval_sec` counts, and the only writers are the Watchdog page's changed-value save and an explicit `interval_sec` in a `ping_profile.sh` POST (which no UI sends). `watchdog.sh` writes `.interval_sec` whenever the posted Probe every differs from the effective cadence, so once any Watchdog cadence is saved it stays, and the profile selector only changes the debounce windows. The one way back is the Probe Targets card's **Use profile cadence** button, shown only while `interval_override` is set: it POSTs `{ "action": "clear_interval" }`, and the CGI runs `del(.interval_sec)` through the same guarded atomic write (a non-object file is refused with `write_failed`; a missing file is a no-op), touches `/tmp/qmanager_ping_reload`, and returns `{ "success": true, "interval_sec": <new effective cadence> }`. No other key is touched, and `watchdog.sh` is not involved. `conn_state_cadence` resolves the effective cadence the same way `resolve_profile()` does (override, else the profile table); both CGIs' GETs report that value.

**The complete set of config keys the daemon reads** is: `profile`, the four target slots `target_host_1` / `target_host_2` / `target_ip_1` / `target_ip_2`, and those four optional numeric overrides. Every target slot is defaulted **independently** in `load_config()`, so a device that somehow missed the installer's migration probes the four documented defaults *correctly* — not merely without crashing. The legacy keys (`target_ipv4`, `target_ipv6`, and the HTTP-era `target_1` / `target_2`) are **not** read here at all; carrying a user's customised value across is the [migration's](#ota-migration) job, and doing it in both places would make the migration untestable.

> ⚠️ The seed **no longer ships `fail_secs` / `recover_secs` / `history_secs`** (2026-09-02), and this was an explicitly approved remediation, not an incidental tidy-up. Because a per-field value beats the profile table, the old seeded `15/10/300` shadowed the table on **every** device: switching profile changed the cadence and nothing else — all four profiles shared one debounce window. `migrate_ping_debounce_shadow()` in `install_rm520n.sh` retires the triple from a deployed config, but **only** when all three still hold the exact old seeded values (`15`/`10`/`300`) — that fingerprint is what "nobody ever touched this" looks like. Any other combination is treated as a hand edit and preserved, matching `migrate_ping_targets()`'s rule about never discarding a chosen value. Idempotent: once the keys are gone the gate reads false and returns, and no UI writes them, so there is no writer to race.

> ℹ️ NOTE — `intercept_secs` is **gone**, not vestigial: pruned from the seed and deleted from deployed configs by `migrate_ping_targets()`. It was an HTTP/204-era key with no reader, and none is possible under the settled binary verdict.

**Reload without restart:** any writer updates `ping_profile.json` and then `touch /tmp/qmanager_ping_reload`. The daemon tests for that flag once per cycle, re-reads config, re-resolves the profile and the four target slots, unlinks the flag, and continues — streak counters survive the reload, so switching cadence mid-flight never resets the reachability verdict.

> ℹ️ NOTE — the daemon is independent of the Watchdog. `qmanager_ping` stays up regardless of `watchcat.enabled`, so the Connection Quality page and the dashboard's Connection Quality card get a live verdict even when the Watchdog is switched off. The Watchdog only ever *reads* `qmanager_ping.json`.

<a id="measured-on-hardware"></a>
### Measured on hardware

Every figure below is **quoted from the on-device measurement record of 2026-09-01**, taken during the recon phase of this redesign. They are the evidence the design rests on — do not treat them as fresh readings, and re-measure before relying on one in a new context. Device identity was proven per capture:

- **RM520N-GL** — serial `61368cd2`, SDX6X, BusyBox 1.31.1. The failure-case device (no data load at the time).
- **RG501Q-EU** — serial `b7e3d6f1`, SDX55, BusyBox 1.29.3. The healthy device — the only one that could demonstrate the short-circuit path.

| What | Measured | Device |
|------|----------|--------|
| Full four-leg chain, all legs failing | **8.44s** | RM520N-GL |
| Healthy short-circuit (leg 1 answers) | **0.27s** | RG501Q-EU |
| Dead-DNS-server cost (reachable but unanswering resolver) | **10.04s** | RM520N-GL |
| Dead-DNS-server cost | **10.20s** | RG501Q-EU |
| Cold hostname resolve (no data plan) | **0.37s** for `cloudflare.com` | RM520N-GL |

The dead-DNS figure is the **slow** case, and it needs the distinction spelled out: an unanswering-but-reachable resolver costs the full wait, whereas when the bearer itself drops, the link-scoped route to the carrier's DNS servers disappears and the send fails `ENETUNREACH` (network unreachable) **immediately**. Only the first case is expensive, and the per-leg `timeout` wrapper is the knob that bounds it.

<a id="platform-facts-that-shape-this-design"></a>
### Platform facts that shape this design

Three device facts are load-bearing here and are worth reading before editing the probe path.

- **`/bin/ping` is iputils on BOTH devices — not a BusyBox applet.** It is a symlink to `/bin/ping.iputils`: iputils **s20190709+** on RM520N-GL, **s20180629** on RG501Q-EU. Both resolve hostnames and honour `-4` / `-6` / `-W` / `-w`. The feared per-device applet divergence simply does not exist for `ping`. (`ping6` *is* a separate BusyBox applet on both, and is not used.)
- **`timeout` must be called through `qm_timeout`, never directly — the two devices accept different CLI forms.** BusyBox moved `SECS` from an option (`-t SECS`) to a positional first argument in **1.30**, and the targets straddle it: RG501Q-EU ships BusyBox **1.29.3** (legacy `-t` only) and RM520N-GL ships **1.31.1** (positional only). A literal invocation is therefore correct on exactly one device; on the other it reads the seconds argument as the program name and exits **127** without running the command at all. `qm_timeout` (`scripts/usr/lib/qmanager/platform.sh`) resolves the binary by **absolute path**, probes the accepted form by behaviour, and falls back to a **pure-shell bound** when neither binary is usable — so the dependency floor here is POSIX shell, not a working `timeout`. Exit status also differs (**143** on RM520N-GL, **124** on RG501Q-EU), so **never test for a specific exit code** — non-zero is the only portable signal.

  > ⚠️ **Measure `timeout` under the DAEMON's PATH, never a login shell's.** `/etc/profile.d/qmanager-path.sh` prepends `/opt/bin:/opt/sbin`, so an interactive shell finds Entware's coreutils build and every form appears to work. A systemd unit gets `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` and no `/opt/bin` — a different binary, with different CLI rules. The 2026-09-01 measurements recorded above were all taken in a login shell, which is how this file, the daemon's own header, and `qmanager-ping-smoke.sh` step [11] all came to assert that the positional form works on both devices. It does not, and the resulting outage was invisible to three separate guards. Corrected 2026-09-03; see the `qmanager_ping` fix commit for the on-device transcript.
- **There is NO on-device DNS cache.** `/etc/resolv.conf` points straight at the carrier's DNS servers and bypasses the local dnsmasq (which binds the LAN bridge for downstream clients only); there is no nscd and no systemd-resolved. A successful resolve is therefore **never stale evidence** — the query still has to cross the link. The faster repeat resolves observed (0.10–0.13s versus 0.16–0.38s cold) are the *carrier* resolver's cache, upstream of the bearer.

---

## The poller — turning probes into stats

**Short version:** `qmanager_poller` reads the daemon's raw verdict plus the RTT history ring, computes the latency/jitter/loss numbers the UI shows, and derives the single `status` verdict every connectivity surface reads.

> ⚠️ WARNING — the poller was **not** realigned when the ICMP port landed (2026-07-20, `8f0f8f0`). For six weeks it read seven keys the shell daemon never writes and dropped one it does. Corrected 2026-09-01; the mechanism, and why three separate guards all failed to catch it, is in [The absent-key trap](#the-absent-key-trap) below.

The poller reads two files the daemon produces:

- `/tmp/qmanager_ping.json` — through `conn_state_read` (`conn_state.sh`), one `jq @tsv` read into `CQ_*` variables (`CQ_REACHABLE`, `CQ_RTT_MS`, `CQ_STREAK_FAIL`, `CQ_FAIL_ELAPSED_SEC`, `CQ_DURING_RECOVERY`, `CQ_INTERVAL_SEC`, `CQ_PROFILE`, `CQ_LAST_FAMILY`, `CQ_LAST_TARGET`, `CQ_TARGET` = `targets[0]`, …). The poller and the watchdog share this one reader; neither parses the cache itself any more.
- `/tmp/qmanager_ping_history` — a flat ring buffer of RTT samples (one float or literal `null` per line), trimmed to `history_secs / interval_sec` entries, read directly.

`conn_state_read` is **fail-closed**: rc 0 only for a fresh read. On a missing, unreadable or stale cache it returns 1 with every verdict variable neutral (`CQ_REACHABLE="null"`, never `true`), and `conn_state_why` gives the reason for the log line.

> ⚠️ Both daemons source `conn_state.sh` behind `[ -f ]`, with a stub that always reads stale. BusyBox ash **exits** when `.` cannot find its file, so the older `. lib || { stub }` form never reached the stub. Keep the guard if you add a third consumer.

<a id="derived-staleness-threshold"></a>
### The staleness threshold is derived, not hardcoded

Before doing anything with the cache, `conn_state_read` asks "is this reading recent enough to believe?", with a threshold computed from the cadence the daemon itself reports, out of the same read:

```
stale_threshold = max(3 × interval_sec, 15)
```

`interval_sec` 1 → **15** · 5 → **15** · 10 → **30**.

- **Age is monotonic.** It is `/proc/uptime − mono`, so a wall-clock step (the 1970 boot window, NITZ) cannot make a fresh cache look stale or a dead one look fresh. Wall-clock age (`date +%s − timestamp`) is the fallback only when `mono` is absent or `0`.
- **An empty or non-numeric `timestamp` is stale**, and so is a `mono` ahead of `/proc/uptime` (a cache from a previous boot).
- **An implausible `interval_sec` is clamped to 5** (accepted range 1–300; non-numeric = unset). A garbage value would otherwise compute a threshold so large that staleness detection switches off — failing open on the one failure mode the guard exists to prevent.

The floor of 15 is the same number the [four-leg probe budget](#the-cycle-budget) is checked against: `4 × 3 = 12 < 15`. A stale read must never be mistaken for an outage: it reads `unknown`, and the [link detector](#one-detector-one-alert) treats it as "no transition".

From those, in a single pass, it derives the `connectivity` block written into `/tmp/qmanager_status.json` and typed as `ConnectivityStatus` (`types/modem-status.ts`). **This table is the complete block** — no other keys are emitted:

| Field | Meaning |
|-------|---------|
| `internet_available` | `true`/`false`, or `null` when the ping daemon isn't running |
| `status` | The derived UI verdict: `connected` / `degraded` / `disconnected` / `recovery` / `unknown`. **This is the only connectivity verdict any surface reads** — see the derivation table below |
| `latency_ms` | Most recent RTT (null if the last probe failed) |
| `avg_latency_ms` / `min_latency_ms` / `max_latency_ms` | Rolling stats over the history window |
| `jitter_ms` | Average inter-sample RTT variation, or a real JSON `null` — see the note below |
| `packet_loss_pct` | Percentage of failed probes in the history window (0–100), or a real JSON `null` — see the note below |
| `ping_target` | The target that **actually answered** — sourced from the daemon's `last_target`, falling back to `targets[0]` when nothing has answered yet. It is not "the target currently being probed": the chain short-circuits, so naming `targets[0]` on a device whose carrier blocks that host would name a leg that never replied, beside a latency chart belonging to a different one |
| `latency_history` | Ring buffer of the last N RTTs (`null` = failed probe) — the data behind the latency graph |
| `history_interval_sec` / `history_size` | Sample spacing and ring **capacity**, for charting. `history_size` is a fixed 60, **not** a measurement — never time-stamp a sample from it (see below) |
| `during_recovery` | `true` while the watchdog is mid-recovery |
| `thresholds` | `{ "latency_ms": 250, "loss_pct": 30 }` — the cuts the poller and `events.sh` apply right now, resolved from `quality_thresholds.json` by `conn_state.sh` (defaults are the `tolerant` row). Added 2026-10-11; optional in the type because an older poller omits it |
| `profile` | The daemon's live profile name, or `"unknown"` when the daemon is dead/stale |
| `dns_lookup_ms` | Carrier-resolver lookup time in ms (10 ms steps), or `null` when the last lookup failed or the sample is older than 180 s — see [DNS lookup time](#dns-lookup-time--tmpqmanager_dnsjson). Optional in the type |
| `dns_resolver` | The resolver that lookup was timed against, or `null`. Same freshness gate. Optional in the type |
| `last_family` | `ipv4` / `ipv6` / `none`, forwarded from the daemon; a real JSON `null` when the ping cache is missing or stale. Read by the Radio Information card and the Probe Targets card |
| `last_outage_s` | Seconds the last outage that **cleared this boot** lasted, or `null` until one clears. From the alert engine's restore edge — see [alerts.md → Last cleared outage](alerts.md#last-cleared-outage-tmpqmanager_last_outage). Optional in the type |
| `last_outage_ago_s` | Seconds since it cleared: the poller's cycle-top uptime (`_MONO_TOP`) minus the outage's end uptime, clamped to `>= 0`. Monotonic clock on both sides, never the wall clock. `null` alongside `last_outage_s` |
| `last_outage_wan_ip` | The WAN address held when it cleared: IPv4, else IPv6, else `null` |
| `last_outage_wan_changed` | `true` / `false` — whether that address differs from the pre-outage one (IPv4 compared first, IPv6 when an IPv4 side is unknown); `null` when either side is unknown |

> ℹ️ NOTE: the four `last_outage_*` keys are additive (2026-11-01) and set together by `last_outage_fields` in `qmanager_poller`. All four are `null` until an outage clears this boot, and also on a cycle where `_MONO_TOP` is `0` (uptime unreadable). The dashboard Connection Quality card draws its **Last outage** row only when `last_outage_s` is present in the block (`!== undefined`): an older poller omits the keys and the row disappears, while `null` renders "None". The row shows the duration and its age, e.g. `1m 46s (12m ago)`; when `last_outage_wan_ip` is set, the address and the same/new wording sit behind a hint icon. The label never truncates: at a narrow tile the value wraps under it, with the hint icon kept beside the duration.

> ⚠️ **Ratio statistics go null below `MIN_STAT_SAMPLES` (10).** `jitter_ms` and `packet_loss_pct` are ratios over the window, so unlike `min`/`avg`/`max` — point statistics that are honest at one sample — they say nothing until the window is long enough to carry one. The poller emits a real JSON `null` for both below the floor, using the same literal-`null` idiom the latency stats already used at zero valid samples.
>
> This is not a theoretical case. `qmanager_ping` **truncates** `/tmp/qmanager_ping_history` on every probe-winner change, so a one-sample window is a *recurring* state on a link that flaps between legs, not a once-per-boot transient. The old code emitted `jitter 0.0, loss 0%` from that window — byte-identical to a measured perfect link — and four consumers believed it, including `append_ping_history()`, which archived the zeros into the persistent 24-hour record.
>
> The floor is 10 because a window of *n* samples can only express loss in steps of `100/n` percent, and that quantum must stay below the smallest loss cut any consumer compares against — 15 % (the `standard` preset, which is also the `degraded` gate when selected). At n=9 the quantum is 11.1 %, close enough to a cut that every window reads either "0 %" or an instant breach, and the "0 %" half is the dangerous one.
>
> **`null` means "not enough data", NEVER "healthy".** Readers must not `//` the null away — a jq `// 0` here restores the exact defect. On the TypeScript side `packet_loss_pct` and `PingHistoryEntry.loss` are `number | null`, so an unhandled null fails the build.
>
> `min` / `avg` / `max` are **point** statistics — honest at a single sample — and are deliberately *not* nulled by this floor. And `append_ping_history()` archives the null into the persistent 24-hour record, so the archive now carries "unknown" rather than a fabricated zero.

> ℹ️ NOTE — `history_size` is a **capacity, not a measurement.** It is a fixed 60 (the ring's length), never the number of samples actually held, and it now has **zero frontend consumers** — it is contract-only. The Latency Monitor's Right now strip (`components/monitoring/latency-monitoring/now-card.tsx`) sizes itself from the history array's own **length** and a fixed 60 slots instead. Never time-stamp a sample from `history_size`.

**Fields the poller no longer emits** (removed 2026-09-01, `000255e`): `state`, `limited_reason`, `down_reason`, `streak_limited`, `fail_secs`, `recover_secs`, `intercept_secs`. Every one of them was read from a key the shell daemon [never writes](#the-producer-key-contract), so each sat at its `jq` default forever; a repo-wide census found **zero** consumers of the six besides `state`. The matching members are gone from `ConnectivityStatus` too, so a component reading one now fails the build.

> ℹ️ NOTE — do not confuse the poller's deleted `status.json` fields with the same-named keys in `ping_profile.json`. `fail_secs` / `recover_secs` remain **readable** config overrides there — `qmanager_ping` still honours them when present — but they are **no longer seeded**, and `migrate_ping_debounce_shadow()` deletes an untouched seeded triple from deployed configs (see [Config and live reload](#config-and-live-reload)). `intercept_secs` is deleted outright at every layer. `settings/ping_profile.sh` does **not** write any of the three — it names them only to say it leaves them alone.

### How `status` is derived

`read_ping_data()` in `qmanager_poller` computes the verdict in this order — the first match wins:

| `status` | Condition | Meaning to the user |
|----------|-----------|---------------------|
| `recovery` | `during_recovery` is `true` | The watchdog is mid-restore; readings are unreliable by definition. Checked **first**, so it outranks a reachable link |
| `degraded` | reachable **and** `packet_loss_pct >= thresholds.loss_pct` | Probes answer, but loss is at or over the user's configured loss cut (15 / 30 / 50 %, default 30) |
| `connected` | reachable **and** loss under the cut — **or** loss `null` | Healthy. Unknown loss is not evidence of degradation, and the verdict this surface owns is binary, so a short window does not invent a third state |
| `disconnected` | `internet_available` is `false` | The debounced probe verdict says nothing answered |
| `unknown` | `internet_available` is `null` | The probe itself is not reporting — **not** an outage claim |

The degraded cut is the **same** `CQ_LOSS_PCT` the event detector uses, so the chip and the Network Events feed cannot disagree about what "too much loss" means. It was a hard-coded 10 % until 2026-10-11. Latency alone never makes the status `degraded`. The cut lives in the poller because the poller is the only layer holding the rolling loss window; a component deriving its own verdict from raw `internet_available` would paint a link losing 90 % of its packets as full success.

**Where it surfaces:** the dashboard's Connection Quality card, the dashboard's "Internet" chip, and the Connection Quality page's live "Current" readouts consume this via the `useModemStatus` hook (5-second poll of `/tmp/qmanager_status.json`). The Connection Quality card's reachability and jitter strips additionally pull, every 30 s through `useLatencyHistory()`, the NDJSON history through `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh`, which reads `/tmp/qmanager_ping_history.json` from RAM and reshapes it into a JSON array — zero modem contact.

---

## The dashboard "Internet" chip

`buildInternetChip()` (`components/dashboard/network-status.tsx`) switches on `connectivity.status` and nothing else; a missing `connectivity` object is treated as `unknown`, which is the same statement the poller makes. All five states are reachable in production — `degraded` and `recovery` for the first time as of 2026-09-01.

| `status` | Badge tone | Label | Leading mark |
|----------|-----------|-------|--------------|
| `connected` | `success` | Online | A live pulsing dot — **no glyph**, because the glyph would replace the pulse |
| `degraded` | `warning` | Unstable | `warning` |
| `recovery` | `warning` | Recovering | `restart_alt` |
| `disconnected` | `destructive` | No Reply | `signal_disconnected` |
| `unknown` | `muted` | Not Measured | `do_not_disturb_on` |

Three rules govern this table, and each is load-bearing:

- **Every state carries a distinct mark.** `success-container` and `warning-container` measure 1.03:1 apart and are the same surface under deuteranopia, so the glyph — not the fill — is what separates these states. The two `warning` states must never share a glyph. `connected`'s pulse is its mark; under reduced motion it degrades to a plain filled disc, still unlike any of the four glyphs.
- **`disconnected` is `destructive`, not `warning`.** CLAUDE.md's status-chip table names a disconnected link as a destructive state.
- **No string asserts an outage.** This is an ICMP probe, and on a carrier that filters ICMP an unanswered ping is indistinguishable from a real outage. Hence the label "No Reply" rather than "Offline", and a hint saying some carriers block these probes and the connection may still be working. The hint is a `HintIcon` beside the chip in `status-rail.tsx` (a tap-to-pin popover, so it opens on a phone, where a hover tooltip never does), not a tooltip on the chip itself. Copy here is written to the limit of what the probe knows — keep it that way.

Copy lives in `public/locales/*/dashboard.json` under `network.internet_*` and `network.internet_tooltip.*`, in all five packs.

<a id="the-absent-key-trap"></a>
### The absent-key trap — a jq `//` default is not `null`

**Short version:** `jq`'s `// "default"` turns an **absent** key into a truthy sentinel string, not into `null` — and a truthiness guard downstream can never see through it. This is the bug that kept the Internet chip grey on every device ever shipped, and it is the durable lesson of this whole subsystem.

The chain, layer by layer:

1. `qmanager_ping` writes a fixed key set and no `connectivity` key. (It was eleven keys when this bug was live; the [contract](#the-producer-key-contract) is thirteen as of 2026-09-02, and still no `connectivity`.)
2. `qmanager_poller` read it as `(.connectivity // "unknown")` and emitted the result through `jq --arg`, which forces a JSON **string**. So `connectivity.state` in `status.json` was permanently the string `"unknown"` — never `null`, which is what the type's own doc comment claimed the pipeline could produce.
3. `buildInternetChip()` guarded with `if (c?.state)`. `"unknown"` is truthy, so the documented rolling-upgrade fallback to `internet_available` beneath it was **unreachable code**, and the switch landed in `default:` every time: a grey chip with a minus-in-circle glyph over a healthy link. The amber branch had never rendered in production.

Three layers each had a guard that would have caught this — the daemon's key list, the poller's `//` default, the component's truthiness test — and all three were written assuming one of the others was authoritative. Confirmed on live hardware (RM520N-GL, serial `61368cd2`): `internet_available: false`, `status: "disconnected"`, `packet_loss_pct: 100` — all correct — sitting beside `state: "unknown"`, the one field the component read.

What to take from it when editing this pipeline:

- A `//` default is indistinguishable from a real reading at the consumer. If a field can be genuinely absent, emit a real JSON `null` (the guarded-sentinel pattern the poller now uses for `last_family`: carry the literal string `"null"` through the shell, then `if $x == "null" then null else $x end` in the emit) — or omit the key outright, which is what happened to `state`.
- Guard on the **value you mean**, not on truthiness. A truthiness test cannot distinguish "absent" from "the string unknown".
- A doc comment describing a `null` the pipeline structurally cannot emit is worse than no comment — it is what made every later reader believe the fallback worked.

<a id="latency-charts-null-is-a-gap"></a>
### Latency charts — a lost ping is a gap, never 0 ms

Both latency displays treat a `null` RTT sample as an **absent** reading rather than a fast one. Previously a total blackout drew a live-updating flat line pinned to the floor of the plot, which reads as a perfectly healthy 0 ms link:

- `components/dashboard/connection-quality.tsx` passes a `null` `latency_ms` or `dns_lookup_ms` to `MetricBar` untouched, so the row shows an empty track and `—`. In the history strip a `null` `lat` counts as a lost probe in that cell (one 28th of 30 minutes, about 64 s): amber for a lone drop, red once two or more failed rows reach the loss cut as a share of the cell or the worst rolling `loss` among the cell's rows reaches it; it never contributes a latency or a jitter reading.
- The Latency Monitor page does the same ([latency-monitor.md](latency-monitor.md)). In `now-card.tsx` a `null` `latency_ms` reads "No reply" and a `null` probe in the live strip is a full-height red bar. In `history-card.tsx` a bucket in which every ping was lost is a gap in the line, and a bucket's average **excludes** lost probes rather than averaging in zeros — the Loss figure reports them instead.

> ℹ️ NOTE — the dashboard's `limited` internet badge was removed (`components/dashboard/network-status.tsx`), because the producer can no longer emit that state.

---

## The Connection Quality page

The page (`/monitoring/connection-quality`, shell `components/monitoring/connection-quality/connection-quality.tsx`) is a `MonitoringPageHeader` over two cards side by side: **Probe Targets** left, **Quality Thresholds** right. `PAIR` in `shapes.ts` stacks them below `@[58rem]/main` and splits them 1:1 above it; each sits in a `CARD_CELL` that hands it the full row height, so the two cards are always the same height. There is no status band: the live four-tile band was removed 2026-10-12, and the one live verdict it carried that this page owns (which leg answered) moved into the Probe Targets header. Do not restore it; the Latency Monitor page carries the live readings.

The shell calls `usePingProfile` and `useQualityThresholds` and passes each card its own; each card reads `useModemStatus` itself for its live parts. `shapes.ts` restates everything it uses and imports no geometry from another family (it no longer imports `components/system-settings/shapes.ts`).

Both cards commit from `CardFoot` and follow the toast rule: a save fires `toast.success` or `toast.error` from the handler, and after a failure the foot status reads **Couldn't save** (`FAILED` in `shapes.ts`) until the next edit or save. While the draft differs from the saved value the foot shows **Unsaved**.

> ⚠️ `shapes.ts` mirrors the preset table from `cq_preset_latency` / `cq_preset_loss` in `scripts/usr/lib/qmanager/conn_state.sh` as `PRESET_LIMIT`, **including the comparison direction**: latency flags strictly above the cut (`_ev_lat_above`, an awk `v > t`), loss flags at or above it (`-ge`). The "Flags after" row and the over-limit glyph both read that map, so a change to the preset table in the shell must land here in the same commit or the UI will disagree with the event that actually fires. The poller publishes the live cuts as `connectivity.thresholds`, but this card shows the cut of the **draft** preset, which only the mirror can answer before a save.

### Probe Targets card (`probe-targets-card.tsx`)

The card owns the **sensitivity profile** and the **four probe slots** — `target_host_1`, `target_host_2`, `target_ip_1`, `target_ip_2` — in probe order (`SLOT_ORDER`). Layout, top to bottom:

- **Verdict chip** in the header (`CardAction`), one filled `Badge` from `legState()`. A skeleton stands in while the profile or the modem status loads; there is no chip when the profile GET failed.
- **Sensitivity** group: a `SegmentedField` over `PING_PROFILES` (sensitive / regular / relaxed / quiet, check glyph, `breakpoint="lg"`), then the **Probe interval** pill row, "Every N s", linking to `/monitoring/watchdog/`. The row always renders. With a Watchdog override stored (`interval_override` from the GET) it reads "Every N s (Watchdog)" and ignores the draft profile; otherwise an unsaved profile previews its own cadence from `PROFILE_INTERVAL_SEC` (`shapes.ts`, mirrors `conn_state_cadence`) and the saved one shows `connectivity.history_interval_sec`. The profile windows stay RM520N's own (the table above), not RM551E's.
- **Two groups.** *Hostnames* (legs 1–2) and *IPv4 fallback* (legs 3–4, the group's one `HintIcon`). Each leg is a numbered 28px disc beside a mono input; the disc of the answering leg fills `primary`.
- **Use profile cadence** (`tonal-neutral`, under the interval row) appears only while `interval_override` is set; it clears the Watchdog's stored cadence at once (not a draft edit, not tied to Save) and toasts `targets.toast.cadence_cleared` or `targets.cadence_clear_failed`. The hook's `clearInterval()` throws on failure and refetches silently on success.
- **Foot:** **Restore defaults** (`tonal-neutral`) fills the draft with `relaxed` and `cloudflare.com`, `google.com`, `1.1.1.1`, `8.8.8.8` without saving; **Save Probe Targets** commits it. A profile change alone is a dirty draft.

`legState()` reads the **saved** targets, never the draft, so typing in a field cannot move the chip:

| State | Condition | Chip |
|-------|-----------|------|
| `hostname` | Reachable and `ping_target` matches leg 1 or 2 | `success`, "Leg N answering" |
| `fallback` | Reachable and `ping_target` matches leg 3 or 4 (an IPv4 leg answered, so DNS failed) | `warning`, "DNS not resolving" |
| `none` | `internet_available !== true`, or `last_family === "none"` | `destructive`, "No answer" |
| `unknown` | No `connectivity` block, `status === "unknown"`, or reachable but **no saved slot matches** `ping_target` | `muted`, "Not reporting" |

> ⚠️ `ping_target` **falls back to `targets[0]` when nothing has answered yet**, so a string match alone is not proof that a leg replied. `legState()` checks `internet_available` and `last_family` before it matches. Drop that guard and a dead link paints leg 1 as answering.
>
> The no-match `unknown` case is real: right after a save the daemon is still probing the **previous** chain until it consumes `/tmp/qmanager_ping_reload`, so its `ping_target` names a target that is no longer saved. Reporting that as "No answer" would show an outage that does not exist.

Behavior:

- Inputs are **ICMP targets** (hostname or IPv4 literal), **not HTTP URLs** — no scheme is prepended.
- The four legs are walked in the order listed, short-circuiting on the first success. There is no v4/v6 slot distinction: the resolver picks the family for the two hostname legs.
- Client-side validation mirrors the CGI's two validator kinds and re-runs on every slot at submit; the CGI re-validates server-side. Values are trimmed before the POST.
- A config the CGI could not read comes back as four blanks; the card then shows the *No probe chain saved* condition with a Restore defaults action instead of the form.

Data flow: `usePingProfile` hook (`hooks/use-ping-profile.ts`) → `GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh`.

> ℹ️ Both hooks expose a **`refresh()`** as of 2026-09-06. Before that neither did, so a failed GET rendered a bare `Alert` printing `HTTP <code>` at the user and the only recovery was a browser reload. The condition screens' Retry affordances are wired to it — do not add a retry button to this route without one behind it.

- **GET** returns the label, the four slots, the **effective** cadence (`conn_state_cadence`: the stored override, else the profile table) and `interval_override` (the stored `interval_sec` when it is all digits and at least 1, as a number or a digit string, else `null`; additive. The ping daemon, `conn_state_cadence` and this field apply the same rule):

  ```json
  { "success": true, "settings": { "profile": "relaxed", "interval_sec": 5, "interval_override": null, "fail_secs": 30, "recover_secs": 10,
    "target_host_1": "cloudflare.com", "target_host_2": "google.com", "target_ip_1": "1.1.1.1", "target_ip_2": "8.8.8.8" } }
  ```
- **POST** sends `{ "action": "save_settings", "target_host_1": …, "target_host_2": …, "target_ip_1": …, "target_ip_2": … }`. All four target fields are required. `profile` is **optional** for the CGI (one of `sensitive` / `regular` / `relaxed` / `quiet`; the stored label is kept when omitted); the Probe Targets card always sends it. `interval_sec` is **optional** and, when the key is present, must be a JSON integer 1–60 (`0`, `61`, `5.5`, `"abc"`, `null`, `true` → `invalid_interval`). The CGI then performs an **atomic jq key-merge** — `profile` and the four slots always; `interval_sec` only when posted (a changed profile leaves a stored one alone); every other key, including unknown ones, passes through — and touches `/tmp/qmanager_ping_reload`.

**Server-side target validation** (`validate_target()` in `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`). Shared pre-checks for every slot: trimmed, non-empty, ≤ 128 characters, no interior whitespace (space or tab), and free of shell/HTML metacharacters (`` ` `` `$ ( ) ; | < > " \`). Then one of **two validator kinds**:

| Kind | Slots | Rules |
|------|-------|-------|
| `host` | `target_host_1`, `target_host_2` | Charset `[0-9A-Za-z.-]`, plus label sanity: no leading or trailing hyphen or dot, no hyphen adjacent to a dot, no empty label (`..`) |
| `ipv4_literal` | `target_ip_1`, `target_ip_2` | Charset `[0-9.]`, **exactly four octets**, each 1–3 digits and ≤ 255 |

So the CGI **rejects a hostname in an IP slot**. That is the point of those two legs: they exist precisely so the verdict survives a broken resolver, and a hostname there would fail for the same reason the two hostname legs already did — the device would then report an outage it does not have. Failures return `cgi_error`'s shape: `{ "success": false, "error": "invalid_target", "detail": "<the rejected value>" }`.

> ℹ️ The route's copy lives under `connection_quality` in the `system-settings` namespace of all five packs (`targets.*`, `thresholds.*`, `page.*`), including the validator messages and toasts.

### Quality Thresholds card (`quality-thresholds-card.tsx`)

**Short version:** this card decides *when a slow or lossy link gets flagged* — in the Network Events feed and, for loss, in the `degraded` status. It is not a recovery control: nothing here triggers a modem reset or SIM failover, and a degraded link never reaches an alert channel.

It sets two independent presets — one for latency, one for packet loss — each `standard` / `tolerant` / `very-tolerant` / `custom`. The table lives once, in `conn_state.sh` (`cq_preset_latency` / `cq_preset_loss`); the poller's `status` and the `events.sh` detector both read it. Debounce counts poll cycles and applies on **entry and exit**:

| Preset | Latency threshold / debounce | Loss threshold / debounce |
|--------|------------------------------|---------------------------|
| standard | 150 ms / 3 polls | 15 % / 3 polls |
| tolerant *(default)* | 250 ms / 3 polls | 30 % / 3 polls |
| very-tolerant | 500 ms / 2 polls | 50 % / 2 polls |
| custom | the user's number, whole ms 1–10000 / 3 polls | the user's number, whole % 1–100 / 3 polls |

**Custom** is stored as `latency.custom_ms` and `loss.custom_pct` beside the preset name (additive keys; no existing key was renamed, since there is no OTA migration primitive). `cq_preset_latency custom <ms>` / `cq_preset_loss custom <pct>` take the number as `$2`; a missing, non-integer or out-of-range number returns 1, and `cq_thresholds_load` then falls back to `tolerant`, so a half-written file never leaves a poller without a limit. Loss starts at 1, not RM551E's 0: the shell compares loss with `-ge`, so a 0 % cut would flag a link with no loss. A named-preset save keeps the stored custom number, so switching back to Custom reopens on it. The card shows a **Limit** pill row with a compact numeric input (field text is held while Custom is selected; an out-of-range entry shows the range error and disables Save).

The same file also holds `alert_after_min`, the one wait before any channel hears about an outage (see [One detector, one alert](#one-detector-one-alert)). The card does not edit it yet; the Alerts page's per-channel field writes it.

Per metric (Latency, then Packet loss) the card renders one block:

- **Preset picker:** a `SegmentedField` with `breakpoint="lg"` and no glyph (`glyph={() => null}`), so it is a pill group from `@lg/card` up and a `Select` below.
- **Flags after** pill row: the debounce and cut of the **draft** preset from `PRESET_LIMIT`, e.g. "3 samples over 250 ms" / "3 samples at 30% or more". It moves as soon as a preset is picked, before any save.
- **Right now** pill row: the poller's `latency_ms` or `packet_loss_pct` as a plain figure. A `TriangleAlert` glyph appears only past the draft limit, inked with Latency Monitor's own rules from `components/monitoring/latency-monitoring/derive.ts`: latency uses `latencyTone` (warning ink above the cut, destructive above twice it); loss marks only when `lossTone` returns `bad` (at or above the cut, destructive), so the amber any-loss tone is not shown here. A `null` reading renders "No reply" (latency) or "Collecting" (loss, under the ten-sample floor) and is **never** coerced to 0.

When the GET reports `is_default: true` (the file is missing, or either preset in it is not a valid name), the foot status shows an `info` **Built-in defaults** chip and **Save Thresholds stays enabled** with no edits, because writing the defaults is a real write. Unsaved and Couldn't save take the status slot ahead of it.

> ℹ️ Removed 2026-10-12 and not to be restored: the per-preset blurbs, the `MetricBar` headroom readout and the footer note. The `role="radiogroup"` rail that replaced the old `<Tabs>` misuse is also gone; `SegmentedField` is the control now.

Data flow: `useQualityThresholds` → `GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh` → `/etc/qmanager/quality_thresholds.json`, poking `/tmp/qmanager_events_reload`. The poller consumes that flag in `cq_thresholds_refresh` at the top of every `read_ping_data()`, so the next cycle's status, detector and alert wait all use the new values without a restart. While jq is not yet mounted at boot, `cq_thresholds_refresh` keeps retrying the first load and the `tolerant` defaults apply meanwhile.

- **GET** returns the presets **with their resolved values** and the wait:

  ```json
  { "success": true,
    "settings": { "latency": { "preset": "tolerant", "value_ms": 250, "debounce": 3, "custom_ms": null },
                  "loss": { "preset": "tolerant", "value_pct": 30, "debounce": 3, "custom_pct": null },
                  "alert_after_min": 5 },
    "is_default": true }
  ```
- **POST** `{ "action": "save_settings", "latency": { "preset": …, "custom_ms": n }, "loss": { "preset": …, "custom_pct": n }, "alert_after_min": n }`. Both presets are required **unless** the POST carries only `alert_after_min`. `custom_ms` / `custom_pct` are required, as JSON integers, only when that side's preset is `custom` (`invalid_custom_latency` / `invalid_custom_loss` otherwise). `alert_after_min`, when present, is a whole number 1–1440 (`invalid_alert_after_min` otherwise). The write is `cq_quality_merge`: only the keys this POST carries change, unknown keys survive, and a file that is not a JSON object is replaced by `{}`.

> ⚠️ The file used to be rewritten from scratch with exactly two keys. It is merge-written now **because** it holds a third (`alert_after_min`) and `alerts.sh` writes it too. Never go back to a whole-file `jq -n` write here.

---

<a id="one-detector-one-alert"></a>
## One detector, one alert

**Short version:** one function decides every link and quality transition; the alert engine follows it and adds one wait. A single outage logs exactly one `internet_lost` + `internet_restored` pair and sends at most one down SMS and one restored message per enabled channel.

### The detector — `detect_data_connection_events` (`events.sh`)

The poller calls it once per cycle, right after `read_ping_data` and `read_dns_data` and before `check_alerts`. It needs no modem. It is the **only** place a link transition is decided; `alert_engine.sh` has no edge detector of its own.

- **Follows `reachable`, not `status`.** `status` reads `recovery` while the watchdog works, which would mask a restore; the detector reads the producer's verdict, so a watchdog-fixed outage still logs `internet_restored`.
- **Stale or unknown is no transition.** When `conn_internet_available` is `null`, all state stays frozen, including `ev_link_state`.
- **The first true → false edge always logs** `internet_lost`, even when the watchdog raised its recovery flag before the poller saw the drop (at 1–2 s profiles it can). Only a **repeat drop after a restore inside the same recovery window** is held, so a tier action that flaps the link does not log a second outage.
- **Quality is frozen while down.** Latency and loss are not evaluated while `reachable` is `false`; the outage is the record, so a dead link no longer also logs `high_packet_loss`.
- **Quality entry is held** for one history window after a restore (`CONN_HISTORY_SIZE × history_interval_sec`, 300 s if unreadable) — the window still holds the outage's nulls — and while the producer's `streak_fail > 0`. Exits are never held.
- **Debounce on entry and exit** with the preset counts. `high_latency` / `latency_recovered` and `high_packet_loss` / `packet_loss_recovered` are paired; a `null` loss (window under the 10-sample floor) is no reading.
- It publishes `ev_link_state` (`"down"` / `"up"` / `""`) for the alert engine. `prev_ev_internet` is owned here; `snapshot_event_state` only persists it.

### The alert — `alert_engine.sh`

`check_alerts` follows `ev_link_state`: `down` starts the monotonic outage timer, `up` ends it, `""` leaves a running timer alone. There is **one wait**, `alert_after_min`, resolved by `cq_alert_after_min`:

```
quality_thresholds.json alert_after_min → sms_alerts.json threshold_minutes
  → email_alerts.json threshold_minutes → discord_bot.json threshold_minutes → 5
```

Each step accepts only an integer 1–1440; the fallbacks exist for OTA'd devices that have never written `alert_after_min`.

| Message | Channels | Sent when |
|---------|----------|-----------|
| `connection_lost` | SMS only (the others need the internet) | Once per outage, when the ongoing outage reaches the wait |
| `connection_restored` | SMS, email, Discord (routing permitting) | On restore, only if the total outage reached the wait |
| degraded / quality | none | Never — quality is Network Events only |

The down SMS is not deferred while the recovery ladder runs; the old freeze during `during_recovery` is gone. Routing and capability rules are in [alerts.md](alerts.md).

Measured on RM520N-GL `61368cd2` (driver in `/tmp`, dispatch stubbed): a 2-minute outage logged exactly `internet_lost` + `internet_restored` and sent nothing (under the 5-minute wait); a 10-minute outage logged the same two records, sent the SMS at 5 min and restored on SMS, email and Discord; a degraded spell logged one `high_packet_loss` / `packet_loss_recovered` pair, and a 300/100/300 ms flicker logged nothing.

---

<a id="ping_profilejson--one-owner-two-write-paths"></a>
## `ping_profile.json` — one owner, two write paths

Connection Quality owns every key in `/etc/qmanager/ping_profile.json`. Two CGIs write it, each by **atomic jq key-merge** (read the existing JSON, set only the keys it is changing, `.tmp` + `mv`), so neither can clobber the other:

| CGI | Keys it writes | When | Reload flag |
|-----|----------------|------|-------------|
| `settings/ping_profile.sh` | `profile`, the four target slots, `interval_sec` only when posted; `clear_interval` deletes `interval_sec` | Every save; the Use profile cadence button | `/tmp/qmanager_ping_reload` |
| `monitoring/watchdog.sh` | `interval_sec` only | Only when the POSTed `probe_interval` **differs** from the current effective cadence | `/tmp/qmanager_ping_reload` |

The Watchdog page's **Probe every** control is a view of `interval_sec`, not a second setting. `watchdog.sh` GET reports `probe_interval` = `conn_state_cadence`'s effective value; the redesigned page sends `probe_interval` with every per-card save, and the unchanged-value check is what stops a Ladder-card save from touching the cadence. `[watchcat].probe_interval` in `qmanager.conf` is never written or read by any CGI or daemon (the installer and the `config.sh` seed still create the key; it is inert). `propagate_probe_interval()` is gone.

<a id="corrupt-config-guard"></a>
### Corrupt-config guard — both writers, `type == "object"` only

**Short version:** a key-merge *indexes* the file it reads, so any content that isn't a JSON object kills the merge. Both writers therefore run an explicit object check before merging and fall back to `{}`.

Each writer guards the existing file with `jq -e 'type == "object"'` before piping it into the merge, and rebuilds from `{}` (plus a `qlog_warn`) when the check fails:

- `settings/ping_profile.sh` (~:216-231) — previously guarded for **empty only** (`[ -z "$existing_json" ]`). Any malformed / whitespace-only / `null` / scalar / array content aborted `jq`, so the endpoint returned `{"success":false,"error":"write_failed"}` **permanently, for every future save**, while GET kept serving its own fallback defaults — the UI looked healthy on a device that could no longer save anything from the web console. Regressed at `cf177d0` (2026-07-19), which replaced a self-contained `jq -n` (immune: it ignores existing content) with the `cat "$CONFIG" | jq` merge.
- `monitoring/watchdog.sh` — the `interval_sec` write in the POST's apply pass carries the same guard (falling back to `{}` silently) and the same `[ -s ]` promote check. It is best-effort: a failed write logs `qlog_error` and the save still reports success.

Two smaller hardenings landed with it: the `ping_profile.sh` merge gained `2>/dev/null` (it was leaking jq parse errors toward the HTTP response), and both promote conditions now require a non-empty temp (`|| [ ! -s "${CONFIG}.tmp" ]` / `&& [ -s ... ]`) so a zero-byte temp is never `mv`'d over a live config — jq can exit 0 having written nothing if the redirect itself failed, which on this device realistically means a full `/etc` UBIFS.

> ⚠️ WARNING — do **not** "simplify" the guard to `jq -e .`. `-e` derives its exit status from output **truthiness**, not parse success. It exits 1 for `null` and `false` (which parse fine) and exits **0** for `5`, `"str"`, `[1,2]` — which also parse fine but are unmergeable, because the merge indexes its input and jq aborts with *"Cannot index number/string/array"*. `type == "object"` is exactly the question the merge asks. Verified rc matrix, identical on local jq 1.8.1 **and** the device's Entware jq 1.7.1: `object`=0, `null`/`false`/`5`/`"str"`/`[1,2]`=1, empty/whitespace=4, garbage=5. Neither `type` nor `==` is regex-dependent, so this is safe on the device's oniguruma-less jq (see project memory: *device jq has no regex*).

> ℹ️ NOTE — what the guard cannot undo. By the time the config is unusable, the ping daemon has **already** lost `interval_sec`: `load_config()` reads it with `jq -r '.interval_sec // empty' 2>/dev/null`, which fails on a corrupt file, so `resolve_profile()` falls through to the profile table. Both GETs resolve the cadence through `conn_state_cadence`, which falls through the same way, so the UI shows the cadence the daemon is really using; the `{}` rebuild on the next save does not restore the lost override.

**No test harness** — `scripts/test/` was deleted 2026-09-03. `scripts/test/ping-profile-cgi.sh` used to drive a six-shape loop (`this is not valid json`, empty, whitespace, `null`, `5`, `[1,2]`) asserting each self-heals into a valid object, plus the four slots, both validator kinds and the key-merge preservation; a companion `scripts/test/ping-config-migration.sh` covered the old→new config shape, customisation preservation and migration idempotency. Re-verify this by hand: write each malformed shape to the live config file and confirm the CGI self-heals it into a valid object without losing existing keys.

> ⚠️ WARNING — when re-testing by hand, know that a malformed-JSON write is not naturally cleaned up between checks: a corrupt file left behind by one probe is inherited by the next save-path check against the same file. That inheritance is expected, not a bug to "fix" with a teardown.

<a id="ota-migration"></a>
### OTA migration — `migrate_ping_targets()` and `migrate_ping_debounce_shadow()`

The daemon's target shape has changed twice: HTTP probes (`target_1`/`target_2` URLs) → a two-slot ICMP pair (`target_ipv4`/`target_ipv6`) → the four-leg chain. `config.sh` has **no key-migration primitive** and `ping_profile.json` is only ever *seeded* when absent, so an already-deployed device keeps its old shape forever unless the installer rewrites it. Two migrations in `install_rm520n.sh` do that, both wired into `install_backend` and run on every install/OTA.

> ⚠️ **Ordering is load-bearing.** `migrate_ping_debounce_shadow()` is called **after** `migrate_ping_targets()`, so the second read-modify-rename sees the first's result. There is a comment at the call site saying so — do not reorder them.

**`migrate_ping_targets()`** — old target shape → the four slots:

- If `ping_profile.json` is absent or `jq` is unavailable → no-op.
- **Gate:** returns early when `target_host_1` is already present *and non-empty*. `has()` would be wrong here — a config carrying `"target_host_1": ""` would be called migrated and left probing an empty slot forever. This makes a re-fire on the next OTA a byte-for-byte no-op, so a target the user changed *after* migrating is never reseeded.
- **Preserves user customisation:** a legacy `target_ipv4` is carried into `target_ip_1` — an IPv4 literal moving into an IPv4-literal slot. Reseeding the default there would silently discard a target the user chose.
- Seeds every other absent slot from its documented default, **one key at a time**. (A bare jq `//` is not enough: it substitutes only on `null` and `false`, so an empty-string legacy value would be carried through and persisted. The code defines a small `nz` filter that turns `""` into `empty` first.)
- Deletes `target_ipv6`, `intercept_secs`, and the pre-existing legacy `target_1` / `target_2`.
- Atomic and same-filesystem: `mktemp` **inside `/etc/qmanager`** (not `/tmp` — `/etc` is UBIFS and `/tmp` is tmpfs, and `mv` is only a rename within one filesystem), with `chmod 644` and `chown www-data:www-data` applied to the temp file **before** the rename.

**`migrate_ping_debounce_shadow()`** — retires the seeded `fail_secs`/`recover_secs`/`history_secs` triple, but only when it still holds the exact old seeded `15`/`10`/`300`. Full rationale in [Config and live reload](#config-and-live-reload).

> ℹ️ NOTE — **belt and braces.** `load_config()` in the daemon defaults each absent target key **independently**, so a device that somehow misses the migration entirely probes the four documented defaults **correctly** — not merely without crashing. Behaviour with the old config is *correct*, not just non-fatal. That is a deliberate requirement, and it is what lets the migration stay simple enough to test.

---

## Known tradeoffs and the ICMP regression path

The ICMP port was a deliberate, user-approved decision that accepts real costs for RM551E parity:

- **No carrier-intercept detection.** The `limited` state — an honest "Limited by carrier" badge when a billing/data-cap/activation walled garden intercepts traffic — is gone. Under ICMP, an intercept that still routes ICMP reads as `reachable: true` (falsely "up"); one that drops ICMP reads as `reachable: false` (indistinguishable from a real outage). The Watchdog's old `limited` short-circuit was deleted on 2026-10-11.
- **ICMP reachability is per-carrier variable.** This is the documented regression path: the very reason the Rust daemon used HTTP/204 was that *this project's* carrier dropped ICMP to `1.1.1.1`/`8.8.8.8` entirely. On a carrier (or SIM/APN) that filters ICMP to all four configured targets, `qmanager_ping` will read **100 % loss** and report a **false "disconnected"** even when the link is fine — which can drive the Watchdog into needless recovery. If you hit this, change the Probe Targets to hosts your carrier does answer ICMP for, before assuming the link is actually down. The [four-leg chain](#the-four-leg-chain-2026-09-02) narrows this risk (a carrier now has to filter four distinct destinations, two of them named rather than literal) but does not remove it, which is also why `last_target` exists.

### Known limitation — carrier-intercept detection is not coming back

The `limited` state is a **genuine capability loss**, and the 2026-09-01 chip fix did not restore it. The new five-state chip is derived entirely from ICMP reachability plus packet loss; none of its states means "a captive portal is answering for your carrier". A billing wall that still routes ICMP reads as `connected`. If that detection is ever wanted again it needs a second, content-aware probe at the producer — there is nothing left in the pipeline to re-wire.

> ℹ️ NOTE: No reader of `/tmp/qmanager_ping.json` asks for `connectivity` or `limited_reason` any more: the watchdog's `read_ping()` and its `limited` branch were deleted when both daemons moved onto `conn_state.sh` (2026-10-11). Do not reintroduce either key on the consumer side.

> ℹ️ NOTE: The `ping-daemon/` Rust crate remains in the tree for now — **retired but present**, pending deletion in a follow-up cleanup commit after on-device soak. `ping-daemon/build-ping-daemon.sh` is neutered (early `exit 1`) so it can no longer produce the old binary. Do not treat the crate as live.

---

## Ownership boundary — who owns what

| Concern | Key(s) | Owner | Surface | Doc |
|---------|--------|-------|---------|-----|
| Probe cadence (how often) | `ping_profile.json.interval_sec` (override; else the profile table) | **Connection Quality** | `ping_profile.sh`; also the Watchdog page's Probe every, through `watchdog.sh` | this doc |
| Probe targets (which hosts) | `ping_profile.json.target_host_1` / `target_host_2` / `target_ip_1` / `target_ip_2` | **Connection Quality** | Probe Targets card | this doc |
| Profile label | `ping_profile.json.profile` | **Connection Quality** | Probe Targets card, through `ping_profile.sh` | this doc |
| Latency/loss thresholds and the `degraded` cut | `quality_thresholds.json.latency.preset` / `loss.preset` | **Connection Quality** | Quality Thresholds card | this doc |
| Alert wait | `quality_thresholds.json.alert_after_min` | **Connection Quality** | written today by the Alerts page's per-channel field (`alerts.sh`) | this doc, [alerts.md](alerts.md) |
| When recovery starts | `watchcat.fail_threshold` (× `interval_sec`, against `fail_elapsed_sec`) | **Watchdog** | Watchdog → Detection card | [connection-watchdog.md](connection-watchdog.md) |
| Recovery ladder (act on a down link) | `watchcat.*` tiers, cooldown, backup slot, reboot cap | **Watchdog** | Watchdog page | [connection-watchdog.md](connection-watchdog.md) |
| Alert channels and routing | `sms_alerts.json`, `email_alerts.json`, `discord_bot.json`, `alert_routing.json` | **Alerts** | Alerts page | [alerts.md](alerts.md) |

---

## Related docs

- Connection Watchdog — the recovery state machine that consumes this telemetry (`qmanager_watchcat`, 4-tier ladder, SIM failover) — [connection-watchdog.md](connection-watchdog.md)
- Centralized Alerts — routing, capability and the channel transports behind the one wait — [alerts.md](alerts.md)
- Recent Activities — how the `internet_*` / `high_*` events are drawn and paired — [recent-activities.md](recent-activities.md)
- Sites monitor — per-site TCP connect latency, a separate daemon that does not feed this verdict — [sites-monitor.md](sites-monitor.md)
- Dashboard chart cards — the dashboard Connection Quality card's rows, history strips and threshold grading — [dashboard-chart-cards.md](dashboard-chart-cards.md#connection-quality)
- AT command transport (`qcmd`, flock serialization) — [at-command-transport.md](at-command-transport.md)
- Platform architecture, daemons, boot sequence — `../rm520n-gl-architecture.md`
