# Connection Quality

> **Applies to:** RM520N-GL (SDX65) · verified 2026-09-02
> **RG501Q-EU (SDX55):** the pipeline itself is unverified there — but the three [platform facts](#platform-facts-that-shape-this-design) the probe chain depends on (`ping`, `timeout`, DNS caching) were measured on **both** devices on 2026-09-01. See [`platform-matrix.md`](./platform-matrix.md)

"Connection Quality" is the **measurement / telemetry** side of QManager's connectivity stack — the part that *observes* how good the internet link is and turns raw probe results into latency, jitter, and packet-loss numbers the UI can chart. It is deliberately separate from the [Connection Watchdog](connection-watchdog.md), which is the **recovery** side — the state machine that *acts* when the link goes down. This document covers the producer→poller consumer chain that feeds the Connection Quality page (`/system-settings/connection-quality`) and the dashboard's latency card. It does **not** re-document the watchdog's recovery ladder — see the sibling doc for that.

> ℹ️ NOTE: The two docs are siblings by design. Connection Quality owns the **probe targets** and the **latency/loss alert thresholds**; the Watchdog owns the **probe cadence** (how often) and the **failure threshold** (how many misses before recovery). Where they touch the same file (`ping_profile.json`), the ownership boundary is spelled out below and in [connection-watchdog.md](connection-watchdog.md#ping-source--split-ownership).

> ⚠️ WARNING — ICMP probe change (v0.1.32): the producer was switched from a compiled Rust **HTTP/204** daemon to a pure-shell **ICMP `ping`** daemon, ported from the RM551E sibling project for 1:1 parity. This was a deliberate, user-approved tradeoff that **removed the `connected`/`limited`/`disconnected` tri-state** — an ICMP echo either answers or it doesn't, so carrier-intercept ("Limited by carrier" / captive-portal / billing-wall) detection is gone. See [The producer](#the-producer--qmanager_ping-shell-icmp-daemon) for the mechanism and the [known regression path](#known-tradeoffs-and-the-icmp-regression-path).

> ⚠️ WARNING — poller/UI realignment (2026-09-01): the ICMP port changed the producer but left the **poller and the dashboard** reading the retired daemon's key set. The dashboard's "Internet" chip was consequently stuck grey on every device for six weeks. Before touching this pipeline, read [The producer key contract](#the-producer-key-contract) and [The absent-key trap](#the-absent-key-trap) — the second is the durable lesson, and it generalises well beyond this subsystem.

---

## Quick Reference

| Item | Value |
|------|-------|
| Frontend page | `/system-settings/connection-quality` (`components/system-settings/connection-quality/`) |
| Producer daemon | `qmanager_ping` — `#!/bin/sh` **ICMP `ping`** daemon (source: `scripts/usr/bin/qmanager_ping`, installed to `/usr/bin/qmanager_ping`) |
| Probe chain | Four legs, fixed order, short-circuit on first success: `cloudflare.com` → `google.com` → `1.1.1.1` → `8.8.8.8` (all four configurable) |
| Producer key contract | **13 keys**, one `jq -n` literal, no branches — [see below](#the-producer-key-contract) |
| Poller | `qmanager_poller` (`scripts/usr/bin/qmanager_poller`) — derives latency/jitter/loss/history **and** the `status` verdict (realigned to the ICMP daemon's key set on 2026-09-01) |
| Consumer (recovery) | `qmanager_watchcat` — reads `streak_fail`, never probes; see [connection-watchdog.md](connection-watchdog.md) |
| Ping verdict cache | `/tmp/qmanager_ping.json` (written by `qmanager_ping`, read by poller + watchdog) — **slim schema, no stats/history** |
| History ring buffer | `/tmp/qmanager_ping_history` (flat file, one RTT float or `null` per line, read by poller for stats) |
| History-as-array CGI | `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh` (serves `/tmp/qmanager_ping_history.json` NDJSON as a JSON array) |
| Daemon config | `/etc/qmanager/ping_profile.json` (**two writers** — see below) |
| Daemon reload flag | `/tmp/qmanager_ping_reload` |
| Probe Targets CGI | `GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh` |
| Quality Thresholds CGI | `GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh` |
| Quality Thresholds config | `/etc/qmanager/quality_thresholds.json` (read by `events.sh`) |
| Poller status output | `/tmp/qmanager_status.json` → `connectivity` block (typed as `ConnectivityStatus` in `types/modem-status.ts`) |
| Dashboard "Internet" chip | `buildInternetChip()` in `components/dashboard/network-status.tsx` — reads `connectivity.status` and nothing else |
| Latency charts | `components/dashboard/live-latency.tsx` and `components/monitoring/latency-monitoring/latency-monitoring-card.tsx` — a `null` RTT renders as a **gap**, never as 0 ms |

**The three-daemon split, at a glance:**

```
qmanager_ping        →  /tmp/qmanager_ping.json   →  qmanager_poller  →  /tmp/qmanager_status.json  →  UI
(PRODUCER)              /tmp/qmanager_ping_history    (STATS)             .connectivity block
ICMP ping probes                                         │
                                                         └──────────────▶  qmanager_watchcat (CONSUMER, recovery)
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
timeout "$PROBE_DEADLINE" ping -c1 -W "$PROBE_TIMEOUT" <target>
```

with `PROBE_DEADLINE = PROBE_TIMEOUT + 1` (= 3s) — the `+1` is the name-resolution allowance. `timeout` is used in its **positional** form (the only one both devices have), and failure is tested as a **non-zero exit status, never as a literal code** — see [platform facts](#platform-facts-that-shape-this-design).

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
| `streak_fail` | **Consecutive failed cycles.** Still a plain **count**, because the Watchdog compares it against its `fail_threshold` — the fail-ladder input, unchanged by this redesign. |
| `during_recovery` | `true` while `/tmp/qmanager_recovery_active` exists (the watchdog is mid-recovery); lets the poller suppress noise. |
| `last_family` | `ipv4` \| `ipv6` \| `none` — which address family answered last cycle. Now **derived** by parsing the resolved address out of ping's first output line (`PING host (ADDR)`); a `:` in that address means `ipv6`, anything else `ipv4`. The output format is identical on both devices. `none` means nothing answered. |
| `last_target` | The exact target string that produced `last_rtt_ms`, or `""` when nothing answered. See below. |
| `fail_elapsed_sec` | Monotonic seconds since the first failure of the current run of failures; `0` when healthy. See below. |

**`last_target` — why latency is attributed to the leg that actually replied.** The chain short-circuits, so `targets[0]` is the winner only on a link where the first leg answers. The daemon also **truncates `/tmp/qmanager_ping_history` whenever the winning target changes** from the previous cycle, so a switch renders as a **gap** in the latency chart rather than a phantom latency step, and jitter is only ever computed across one host.

> ℹ️ NOTE — the rejected alternative. Pinning latency to target 1 unconditionally was considered and rejected: a device whose carrier blocks target 1 — the [documented ICMP regression path](#known-tradeoffs-and-the-icmp-regression-path) — would read "connected" via a fallback leg while its latency chart stayed permanently empty.

**`fail_elapsed_sec` — emitted here, not yet read anywhere.** Its consumer is the watchdog's wall-clock down-declaration, which ships in a **separate approved follow-up change**. This is deliberate and correct: a producer key must exist *before* its consumer ships, which is how a rolling upgrade is supposed to work. It is **not** dead code — do not prune it.

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

Per-field JSON keys (`interval_sec`, `fail_secs`, `recover_secs`, `history_secs`) override the profile table when present and numeric — this is how the Watchdog retunes the **probe cadence** (`interval_sec`) without changing the profile.

**The complete set of config keys the daemon reads** is: `profile`, the four target slots `target_host_1` / `target_host_2` / `target_ip_1` / `target_ip_2`, and those four optional numeric overrides. Every target slot is defaulted **independently** in `load_config()`, so a device that somehow missed the installer's migration probes the four documented defaults *correctly* — not merely without crashing. The legacy keys (`target_ipv4`, `target_ipv6`, and the HTTP-era `target_1` / `target_2`) are **not** read here at all; carrying a user's customised value across is the [migration's](#ota-migration) job, and doing it in both places would make the migration untestable.

> ⚠️ The seed **no longer ships `fail_secs` / `recover_secs` / `history_secs`** (2026-09-02), and this was an explicitly approved remediation, not an incidental tidy-up. Because a per-field value beats the profile table, the old seeded `15/10/300` shadowed the table on **every** device: switching profile changed the cadence and nothing else — all four profiles shared one debounce window. `migrate_ping_debounce_shadow()` in `install_rm520n.sh` retires the triple from a deployed config, but **only** when all three still hold the exact old seeded values (`15`/`10`/`300`) — that fingerprint is what "nobody ever touched this" looks like. Any other combination is treated as a hand edit and preserved, matching `migrate_ping_targets()`'s rule about never discarding a chosen value. Idempotent: once the keys are gone the gate reads false and returns, and no UI writes them, so there is no writer to race.

> ℹ️ NOTE — `intercept_secs` is **gone**, not vestigial: pruned from the seed and deleted from deployed configs by `migrate_ping_targets()`. It was an HTTP/204-era key with no reader, and none is possible under the settled binary verdict.

**Reload without restart:** any writer updates `ping_profile.json` and then `touch /tmp/qmanager_ping_reload`. The daemon tests for that flag once per cycle, re-reads config, re-resolves the profile and the four target slots, unlinks the flag, and continues — streak counters survive the reload, so switching cadence mid-flight never resets the reachability verdict.

> ℹ️ NOTE — the daemon is independent of the Watchdog. `qmanager_ping` stays up regardless of `watchcat.enabled`, so the Connection Quality page and the dashboard latency card get a live verdict even when the Watchdog is switched off. The Watchdog only ever *reads* `qmanager_ping.json`.

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
- **`timeout` exits 143 on RM520N-GL but 124 on RG501Q-EU.** The RM520N-GL has the BusyBox applet in `/usr/bin`; the RG501Q-EU resolves to Entware's GNU coreutils build in `/opt/bin`. **Never test for a specific exit code** — non-zero is the only portable signal. Both accept only the positional form (`timeout N cmd`).
- **There is NO on-device DNS cache.** `/etc/resolv.conf` points straight at the carrier's DNS servers and bypasses the local dnsmasq (which binds the LAN bridge for downstream clients only); there is no nscd and no systemd-resolved. A successful resolve is therefore **never stale evidence** — the query still has to cross the link. The faster repeat resolves observed (0.10–0.13s versus 0.16–0.38s cold) are the *carrier* resolver's cache, upstream of the bearer.

---

## The poller — turning probes into stats

**Short version:** `qmanager_poller` reads the daemon's raw verdict plus the RTT history ring, computes the latency/jitter/loss numbers the UI shows, and derives the single `status` verdict every connectivity surface reads.

> ⚠️ WARNING — the poller was **not** realigned when the ICMP port landed (2026-07-20, `8f0f8f0`). For six weeks it read seven keys the shell daemon never writes and dropped one it does. Corrected 2026-09-01; the mechanism, and why three separate guards all failed to catch it, is in [The absent-key trap](#the-absent-key-trap) below.

The poller reads two files the daemon produces:

- `/tmp/qmanager_ping.json` — the current verdict, read as a single `jq @tsv` extraction in `read_ping_data()` carrying **eight** positional fields:

  | # | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
  |---|---|---|---|---|---|---|---|---|
  | | `reachable` | `last_rtt_ms` | `during_recovery` | `interval_sec` | `targets[0]` | `last_target` | `profile` | `last_family` |

  **The extraction is positional** — eight `cut -f<N>` offsets follow it, so adding or removing a field means renumbering every offset below it. `last_target` was *inserted* at field 6, which pushed `profile` and `last_family` down one place each.
- `/tmp/qmanager_ping_history` — a flat ring buffer of RTT samples (one float or literal `null` per line), trimmed to `history_secs / interval_sec` entries.

<a id="derived-staleness-threshold"></a>
### The staleness threshold is derived, not hardcoded

Before doing anything with the cache, both the poller and the watchdog ask "is this reading recent enough to believe?". That threshold is now **computed from the cadence the daemon itself reports**, out of the same read:

```
stale_threshold = max(3 × interval_sec, 15)
```

`interval_sec` 1 → **15** · 5 → **15** · 10 → **30**.

This replaces two independently hardcoded constants, each derived from nothing: a bare `10` in the poller and a bare `15` in `qmanager_watchcat`. **It fixes a latent bug**: at the `quiet` profile (`interval_sec` 10) a perfectly healthy cycle already sat *on* the poller's 10-second cliff before this change, so the verdict could read `unknown` with nothing wrong. Worse, during the outage this feature exists to detect, one over-budget cycle would flip the verdict to `unknown` instead of `disconnected` — and an `unknown` is the `null` that used to swallow the `internet_lost` alert outright.

The floor of 15 is the same number the [four-leg probe budget](#the-cycle-budget) is checked against: `4 × 3 = 12 < 15`.

> ⚠️ Both consumers **clamp an implausible `interval_sec` back to 5** rather than obeying it (accepted range 1–300; a non-numeric value is treated as unset). A garbage value would otherwise compute a threshold so large that staleness detection silently switches off — failing open on the one failure mode the guard exists to prevent.
>
> In the poller the derivation lives **inline** inside `read_ping_data()` rather than in a helper function: that function is the unit the harness extracts and runs on its own, and a helper defined outside it would be undefined there.

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

> ⚠️ **Ratio statistics go null below `MIN_STAT_SAMPLES` (10).** `jitter_ms` and `packet_loss_pct` are ratios over the window, so unlike `min`/`avg`/`max` — point statistics that are honest at one sample — they say nothing until the window is long enough to carry one. The poller emits a real JSON `null` for both below the floor, using the same literal-`null` idiom the latency stats already used at zero valid samples.
>
> This is not a theoretical case. `qmanager_ping` **truncates** `/tmp/qmanager_ping_history` on every probe-winner change, so a one-sample window is a *recurring* state on a link that flaps between legs, not a once-per-boot transient. The old code emitted `jitter 0.0, loss 0%` from that window — byte-identical to a measured perfect link — and four consumers believed it, including `append_ping_history()`, which archived the zeros into the persistent 24-hour record.
>
> The floor is 10 because a window of *n* samples can only express loss in steps of `100/n` percent, and 10% is the smallest threshold any consumer compares against (this file's own `degraded` gate; the UI presets are 15/30/50). At n=9 the quantum is 11.1%: every window reads either "0%" or an instant breach, and the "0%" half is the dangerous one.
>
> **`null` means "not enough data", NEVER "healthy".** Readers must not `//` the null away — a jq `// 0` here restores the exact defect. On the TypeScript side `packet_loss_pct` and `PingHistoryEntry.loss` are `number | null`, so an unhandled null fails the build.
>
> `min` / `avg` / `max` are **point** statistics — honest at a single sample — and are deliberately *not* nulled by this floor. And `append_ping_history()` archives the null into the persistent 24-hour record, so the archive now carries "unknown" rather than a fabricated zero.

> ℹ️ NOTE — `history_size` is a **capacity, not a measurement.** It is a fixed 60 (the ring's length), never the number of samples actually held, and it now has **zero frontend consumers** — it is contract-only. The realtime chart in `components/monitoring/latency-monitoring/latency-monitoring-card.tsx` derives its timestamp math from the history array's own **length** instead. Never time-stamp a sample from `history_size`.
| `during_recovery` | `true` while the watchdog is mid-recovery |
| `profile` | The daemon's live profile name, or `"unknown"` when the daemon is dead/stale |
| `last_family` | `ipv4` / `ipv6` / `none`, forwarded from the daemon; a real JSON `null` when the ping cache is missing or stale. Read by the Radio Information card and the Probe Targets card |

**Fields the poller no longer emits** (removed 2026-09-01, `000255e`): `state`, `limited_reason`, `down_reason`, `streak_limited`, `fail_secs`, `recover_secs`, `intercept_secs`. Every one of them was read from a key the shell daemon [never writes](#the-producer-key-contract), so each sat at its `jq` default forever; a repo-wide census found **zero** consumers of the six besides `state`. The matching members are gone from `ConnectivityStatus` too, so a component reading one now fails the build.

> ℹ️ NOTE — do not confuse the poller's deleted `status.json` fields with the same-named keys in `ping_profile.json`. `fail_secs` / `recover_secs` remain **readable** config overrides there — `qmanager_ping` still honours them when present — but they are **no longer seeded**, and `migrate_ping_debounce_shadow()` deletes an untouched seeded triple from deployed configs (see [Config and live reload](#config-and-live-reload)). `intercept_secs` is deleted outright at every layer. `settings/ping_profile.sh` does **not** write any of the three — it names them only to say it leaves them alone.

### How `status` is derived

`qmanager_poller` (~:1510-1524) computes the verdict in this order — the first match wins:

| `status` | Condition | Meaning to the user |
|----------|-----------|---------------------|
| `recovery` | `during_recovery` is `true` | The watchdog is mid-restore; readings are unreliable by definition. Checked **first**, so it outranks a reachable link |
| `degraded` | reachable **and** `packet_loss_pct >= 10` | Probes answer, but at least one in ten is lost |
| `connected` | reachable **and** loss under 10 % — **or** loss `null` | Healthy. Unknown loss is not evidence of degradation, and the verdict this surface owns is binary, so a short window does not invent a third state |
| `disconnected` | `internet_available` is `false` | The debounced probe verdict says nothing answered |
| `unknown` | `internet_available` is `null` | The probe itself is not reporting — **not** an outage claim |

The 10 % degraded cut lives here, in the poller, because the poller is the only layer holding the rolling loss window. A component deriving its own verdict from raw `internet_available` would paint a link losing 90 % of its packets as full success.

**Where it surfaces:** the dashboard latency card, the dashboard's "Internet" chip, and the Connection Quality page's live "Current" readouts consume this via the `useModemStatus` hook (5-second poll of `/tmp/qmanager_status.json`). The latency **chart** additionally pulls the NDJSON history through `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh`, which reads `/tmp/qmanager_ping_history.json` from RAM and reshapes it into a JSON array — zero modem contact.

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
- **No string asserts an outage.** This is an ICMP probe, and on a carrier that filters ICMP an unanswered ping is indistinguishable from a real outage. Hence the label "No Reply" rather than "Offline", and a tooltip saying some carriers block these probes and the connection may still be working. Copy here is written to the limit of what the probe knows — keep it that way.

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

Both chart sites treat a `null` RTT sample as an **absent** reading rather than a fast one. Previously a total blackout drew a live-updating flat line pinned to the floor of the plot, which reads as a perfectly healthy 0 ms link:

- `components/dashboard/live-latency.tsx` maps a `null` history entry to `null`, not `0`. Recharts breaks the path and skips the dot, and the packet-loss series beside it still rises, so the outage is stated rather than merely missing.
- `components/monitoring/latency-monitoring/latency-monitoring-card.tsx` does the same for realtime samples and for aggregate buckets in which every ping was lost. Its rolling latency average **excludes** gaps rather than averaging in zeros — a window half of which timed out averages the readings it has, and the packet-loss figure beside it reports the other half.

> ℹ️ NOTE — `ok` on a ping row is still wired: `PingEntriesCard` reads it to print "Timeout" in the latency cell, which is why an aggregate row can carry a printable `0` there without the table ever showing "null ms". Do not delete it as dead.

> ℹ️ NOTE — the dashboard's `limited` internet badge was removed (`components/dashboard/network-status.tsx`), because the producer can no longer emit that state.

---

## The Connection Quality page

The page (`/system-settings/connection-quality`) is a two-card grid (`components/system-settings/connection-quality/connection-quality.tsx`): **Probe Targets** on the left, **Latency & Loss Thresholds** on the right. Both are write surfaces; live readouts come from `useModemStatus`.

### Probe Targets card (`connectivity-sensitivity-card.tsx`)

> ℹ️ NOTE: The React file is still named `connectivity-sensitivity-card.tsx` for git-history continuity, but the card's title and role are **"Probe Targets"**.

The card owns the **four probe slots** — `target_host_1`, `target_host_2`, `target_ip_1`, `target_ip_2` — plus the profile selector. Behavior:

- Inputs are **ICMP targets** (hostname or IPv4 literal), **not HTTP URLs** — no scheme is prepended.
- The four legs are walked in the order listed, short-circuiting on the first success. There is no v4/v6 slot distinction: the resolver picks the family for the two hostname legs.
- A reset restores the four defaults: `cloudflare.com`, `google.com`, `1.1.1.1`, `8.8.8.8`.
- Client-side validation mirrors the CGI's two validator kinds; the CGI re-validates server-side.

Data flow: `usePingProfile` hook (`hooks/use-ping-profile.ts`) → `GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh`.

- **GET** returns `{ success: true, settings: { profile, target_host_1, target_host_2, target_ip_1, target_ip_2 } }`.
- **POST** sends `{ action: "save_settings", target_host_1, target_host_2, target_ip_1, target_ip_2 }` plus the profile. All four target fields are required on every save. The CGI validates the profile against `{sensitive, regular, relaxed, quiet}` and each target against its slot kind, then performs an **atomic jq key-merge** — writing only `profile` and the four slots, so the Watchdog-owned `interval_sec` and the daemon's `fail_secs`/`recover_secs`/`history_secs` pass through untouched — and touches `/tmp/qmanager_ping_reload`.

**Server-side target validation** (`validate_target()` in `scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`). Shared pre-checks for every slot: trimmed, non-empty, ≤ 128 characters, no interior whitespace (space or tab), and free of shell/HTML metacharacters (`` ` `` `$ ( ) ; | < > " \`). Then one of **two validator kinds**:

| Kind | Slots | Rules |
|------|-------|-------|
| `host` | `target_host_1`, `target_host_2` | Charset `[0-9A-Za-z.-]`, plus label sanity: no leading or trailing hyphen or dot, no hyphen adjacent to a dot, no empty label (`..`) |
| `ipv4_literal` | `target_ip_1`, `target_ip_2` | Charset `[0-9.]`, **exactly four octets**, each 1–3 digits and ≤ 255 |

So the CGI **rejects a hostname in an IP slot**. That is the point of those two legs: they exist precisely so the verdict survives a broken resolver, and a hostname there would fail for the same reason the two hostname legs already did — the device would then report an outage it does not have. Failures return `{ success: false, error: "invalid_target", message: "<reason>" }`.

> ⚠️ **Known gap — this card is not internationalised, and neither is the rest of the Connection Quality route.** The page header, the Probe Targets card and the sibling `quality-thresholds-card.tsx` are all hardcoded English, and `public/locales/en/system-settings.json` holds no keys for this route. The four new target fields were left in English to match their neighbours rather than half-translate the surface. A route-wide i18n pass (~35 strings across all five packs, and it must include `quality-thresholds-card.tsx`) is a **separate approved follow-up**, logged by user decision.

### Latency & Loss Thresholds card (`quality-thresholds-card.tsx`)

**Short version:** this card decides *when a slow or lossy link gets flagged as a network event* — an **alerting** control, not a recovery control. Nothing here triggers a modem reset or SIM failover. **This card was untouched by the ICMP port.**

It sets two independent presets — one for latency, one for packet loss — each `standard` / `tolerant` / `very-tolerant`, consumed by the events pipeline (`scripts/usr/lib/qmanager/events.sh`), which emits `high_latency` / `high_packet_loss` events (and downstream email/SMS/Discord alerts) when a live reading stays over threshold for the debounce count of samples:

| Preset | Latency threshold / debounce | Loss threshold / debounce |
|--------|------------------------------|---------------------------|
| standard | 150 ms / 3 samples | 15 % / 3 samples |
| tolerant *(default)* | 250 ms / 3 samples | 30 % / 3 samples |
| very-tolerant | 500 ms / 2 samples | 50 % / 2 samples |

Data flow: `useQualityThresholds` → `GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh` → `/etc/qmanager/quality_thresholds.json`, poking `/tmp/qmanager_events_reload` so `events.sh` re-reads without a restart. Note the events pipeline emits `high_latency`/`high_packet_loss` only — it does **not** emit a recovery/connectivity event; recovery lives entirely in the Watchdog off `streak_fail`.

---

## The `ping_profile.json` two-writer contract

`/etc/qmanager/ping_profile.json` is written by **two independent CGI endpoints**, split by ownership. Neither may overwrite the whole file — each performs an **atomic jq key-merge** (read the existing JSON, set only its own keys, `.tmp` + `mv`) so it can't clobber the other's keys.

| Owner | CGI | Keys it writes | Reload flag(s) it touches |
|-------|-----|----------------|---------------------------|
| **Connection Quality** (Probe Targets card) | `settings/ping_profile.sh` | `profile`, `target_host_1`, `target_host_2`, `target_ip_1`, `target_ip_2` | `/tmp/qmanager_ping_reload` |
| **Connection Watchdog** (Detection tab) | `monitoring/watchdog.sh` | `interval_sec` (propagated from `watchcat.probe_interval`) | `/tmp/qmanager_ping_reload` **and** `/tmp/qmanager_watchcat_reload` |

This is the split-ownership realignment: **the Watchdog owns the *cadence*, the Connection Quality page owns the *targets*.** The `fail_threshold` / `probe_interval` ownership and propagation live on the Watchdog side — see [connection-watchdog.md → Split ownership of the probe cadence](connection-watchdog.md#split-ownership-of-the-probe-cadence).

<a id="corrupt-config-guard"></a>
### Corrupt-config guard — both writers, `type == "object"` only

**Short version:** a key-merge *indexes* the file it reads, so any content that isn't a JSON object kills the merge. Both writers therefore run an explicit object check before merging and fall back to `{}`.

Each writer guards the existing file with `jq -e 'type == "object"'` before piping it into the merge, and rebuilds from `{}` (plus a `qlog_warn`) when the check fails:

- `settings/ping_profile.sh` (~:216-231) — previously guarded for **empty only** (`[ -z "$existing_json" ]`). Any malformed / whitespace-only / `null` / scalar / array content aborted `jq`, so the endpoint returned `{"success":false,"error":"write_failed"}` **permanently, for every future save**, while GET kept serving its own fallback defaults — the UI looked healthy on a device that could no longer save anything from the web console. Regressed at `cf177d0` (2026-07-19), which replaced a self-contained `jq -n` (immune: it ignores existing content) with the `cat "$CONFIG" | jq` merge.
- `monitoring/watchdog.sh` → `propagate_probe_interval()` (~:73-95) — the **other** writer, byte-identical defect. Worse there: that path is best-effort and already `2>/dev/null`'d, so an aborted `jq` failed **silently** (log line only; the user still saw a successful save).

Two smaller hardenings landed with it: the `ping_profile.sh` merge gained `2>/dev/null` (it was leaking jq parse errors toward the HTTP response), and both promote conditions now require a non-empty temp (`|| [ ! -s "${CONFIG}.tmp" ]` / `&& [ -s ... ]`) so a zero-byte temp is never `mv`'d over a live config — jq can exit 0 having written nothing if the redirect itself failed, which on this device realistically means a full `/etc` UBIFS.

> ⚠️ WARNING — do **not** "simplify" the guard to `jq -e .`. `-e` derives its exit status from output **truthiness**, not parse success. It exits 1 for `null` and `false` (which parse fine) and exits **0** for `5`, `"str"`, `[1,2]` — which also parse fine but are unmergeable, because the merge indexes its input and jq aborts with *"Cannot index number/string/array"*. `type == "object"` is exactly the question the merge asks. Verified rc matrix, identical on local jq 1.8.1 **and** the device's Entware jq 1.7.1: `object`=0, `null`/`false`/`5`/`"str"`/`[1,2]`=1, empty/whitespace=4, garbage=5. Neither `type` nor `==` is regex-dependent, so this is safe on the device's oniguruma-less jq (see project memory: *device jq has no regex*).

> ℹ️ NOTE — what the guard cannot undo. By the time the config is unusable, the ping daemon has **already** lost `interval_sec`: `load_config()` reads it with `jq -r '.interval_sec // empty' 2>/dev/null`, which fails on a corrupt file, so `resolve_profile()` falls through to the profile table and the real probe cadence silently diverges from the `watchcat.probe_interval` the Watchdog UI still displays (that value lives in `qmanager.conf`, a different file). The `{}` fallback doesn't cause that divergence and can't repair it — the Watchdog's next save re-propagates `interval_sec`.

**Test coverage:** `scripts/test/ping-profile-cgi.sh` drives a six-shape loop (`this is not valid json`, empty, whitespace, `null`, `5`, `[1,2]`), asserting each self-heals into a valid object, plus a non-empty-config assertion. It was extended on 2026-09-02 to cover the four slots, both validator kinds, and the key-merge preservation. A companion harness, `scripts/test/ping-config-migration.sh`, covers the old→new config shape, customisation preservation and migration idempotency.

> ⚠️ WARNING — Test 7's malformed-JSON write is **deliberately not cleaned up**. The save-path tests that follow inherit that corrupt file on purpose, and that inheritance *is* the coverage. Do not "fix" the cross-talk by adding a teardown.

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

- **No carrier-intercept detection.** The `limited` state — an honest "Limited by carrier" badge when a billing/data-cap/activation walled garden intercepts traffic — is gone. Under ICMP, an intercept that still routes ICMP reads as `reachable: true` (falsely "up"); one that drops ICMP reads as `reachable: false` (indistinguishable from a real outage). The Watchdog's old `limited` short-circuit is now permanently inert (see [connection-watchdog.md](connection-watchdog.md#carrier-intercept-short-circuit-now-inert)).
- **ICMP reachability is per-carrier variable.** This is the documented regression path: the very reason the Rust daemon used HTTP/204 was that *this project's* carrier dropped ICMP to `1.1.1.1`/`8.8.8.8` entirely. On a carrier (or SIM/APN) that filters ICMP to all four configured targets, `qmanager_ping` will read **100 % loss** and report a **false "disconnected"** even when the link is fine — which can drive the Watchdog into needless recovery. If you hit this, change the Probe Targets to hosts your carrier does answer ICMP for, before assuming the link is actually down. The [four-leg chain](#the-four-leg-chain-2026-09-02) narrows this risk (a carrier now has to filter four distinct destinations, two of them named rather than literal) but does not remove it, which is also why `last_target` exists.

### Known limitation — carrier-intercept detection is not coming back

The `limited` state is a **genuine capability loss**, and the 2026-09-01 chip fix did not restore it. The new five-state chip is derived entirely from ICMP reachability plus packet loss; none of its states means "a captive portal is answering for your carrier". A billing wall that still routes ICMP reads as `connected`. If that detection is ever wanted again it needs a second, content-aware probe at the producer — there is nothing left in the pipeline to re-wire.

### Open follow-up — inert `limited` machinery still in `qmanager_watchcat`

`qmanager_watchcat` **still carries** the carrier-`limited` machinery from the HTTP era, and it is **known-inert**. It is removed by a **separate approved follow-up change**, not by this one:

- `read_ping()`'s TSV extraction still reads the absent `.connectivity` and `.limited_reason` keys (TSV fields 5 and 6), with a **third** contradictory default — `"disconnected"`, where the poller used `"unknown"` and the type comment implied `null`. Three layers, three different opinions about a key nobody writes.
- The unreachable suppression branch further down would short-circuit the recovery ladder on `limited`.

Neither ever fires, and the recovery ladder is unaffected because it keys off `streak_fail`, which the producer does emit. Do not read either site as evidence that a `connectivity` field exists. See [connection-watchdog.md](connection-watchdog.md#carrier-intercept-short-circuit-now-inert) for the ladder's side of this.

> ℹ️ NOTE: The `ping-daemon/` Rust crate remains in the tree for now — **retired but present**, pending deletion in a follow-up cleanup commit after on-device soak. `ping-daemon/build-ping-daemon.sh` is neutered (early `exit 1`) so it can no longer produce the old binary. Do not treat the crate as live.

---

## Ownership boundary — who owns what

| Concern | Key(s) | Owner | Surface | Doc |
|---------|--------|-------|---------|-----|
| Probe cadence (how often) | `watchcat.probe_interval` → `ping_profile.json.interval_sec` | **Watchdog** | Watchdog → Detection tab | [connection-watchdog.md](connection-watchdog.md) |
| Failure threshold (how many misses) | `watchcat.fail_threshold` (vs. daemon `streak_fail`) | **Watchdog** | Watchdog → Detection tab | [connection-watchdog.md](connection-watchdog.md) |
| Probe targets (which hosts) | `ping_profile.json.target_host_1` / `target_host_2` / `target_ip_1` / `target_ip_2` | **Connection Quality** | Probe Targets card | this doc |
| Profile label | `ping_profile.json.profile` | **Connection Quality** | Probe Targets card | this doc |
| Alert thresholds (latency/loss) | `quality_thresholds.json.latency` / `loss` | **Connection Quality** | Latency & Loss Thresholds card | this doc |
| Recovery ladder (act on down link) | `watchcat.*` tiers | **Watchdog** | Watchdog page | [connection-watchdog.md](connection-watchdog.md) |

---

## Related docs

- Connection Watchdog — the recovery state machine that consumes this telemetry (`qmanager_watchcat`, 4-tier ladder, SIM failover, probe-cadence ownership) — [connection-watchdog.md](connection-watchdog.md)
- Dashboard chart cards — the Live Latency card's chip, geometry and recharts contracts — [dashboard-chart-cards.md](dashboard-chart-cards.md)
- AT command transport (`qcmd`, flock serialization) — [at-command-transport.md](at-command-transport.md)
- Platform architecture, daemons, boot sequence — `../rm520n-gl-architecture.md`
