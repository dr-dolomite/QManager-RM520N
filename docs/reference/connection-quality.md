# Connection Quality

"Connection Quality" is the **measurement / telemetry** side of QManager's connectivity stack — the part that *observes* how good the internet link is and turns raw probe results into latency, jitter, and packet-loss numbers the UI can chart. It is deliberately separate from the [Connection Watchdog](connection-watchdog.md), which is the **recovery** side — the state machine that *acts* when the link goes down. This document covers the producer→poller consumer chain that feeds the Connection Quality page (`/system-settings/connection-quality`) and the dashboard's latency card. It does **not** re-document the watchdog's recovery ladder — see the sibling doc for that.

> ℹ️ NOTE: The two docs are siblings by design. Connection Quality owns the **probe targets** and the **latency/loss alert thresholds**; the Watchdog owns the **probe cadence** (how often) and the **failure threshold** (how many misses before recovery). Where they touch the same file (`ping_profile.json`), the ownership boundary is spelled out below and in [connection-watchdog.md](connection-watchdog.md#ping-source--split-ownership).

> ⚠️ WARNING — ICMP probe change (v0.1.32): the producer was switched from a compiled Rust **HTTP/204** daemon to a pure-shell **ICMP `ping`** daemon, ported from the RM551E sibling project for 1:1 parity. This was a deliberate, user-approved tradeoff that **removed the `connected`/`limited`/`disconnected` tri-state** — an ICMP echo either answers or it doesn't, so carrier-intercept ("Limited by carrier" / captive-portal / billing-wall) detection is gone. See [The producer](#the-producer--qmanager_ping-shell-icmp-daemon) for the mechanism and the [known regression path](#known-tradeoffs-and-the-icmp-regression-path).

---

## Quick Reference

| Item | Value |
|------|-------|
| Frontend page | `/system-settings/connection-quality` (`components/system-settings/connection-quality/`) |
| Producer daemon | `qmanager_ping` — `#!/bin/sh` **ICMP `ping`** daemon (source: `scripts/usr/bin/qmanager_ping`, installed to `/usr/bin/qmanager_ping`) |
| Poller | `qmanager_poller` (`scripts/usr/bin/qmanager_poller`) — derives latency/jitter/loss/history (**unchanged** by the ICMP port) |
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

**The three-daemon split, at a glance:**

```
qmanager_ping        →  /tmp/qmanager_ping.json   →  qmanager_poller  →  /tmp/qmanager_status.json  →  UI
(PRODUCER)              /tmp/qmanager_ping_history    (STATS)             .connectivity block
ICMP ping probes                                         │
                                                         └──────────────▶  qmanager_watchcat (CONSUMER, recovery)
```

---

## The producer — `qmanager_ping` (shell ICMP daemon)

**Short version:** `qmanager_ping` is a small always-on POSIX-shell (`#!/bin/sh`) daemon that runs a plain ICMP `ping` at a DNS-server IP every few seconds and writes "did it come back?" to a JSON file. It replaced a compiled Rust HTTP/204 daemon; the switch was an explicit port from the RM551E sibling project for feature parity, and it consciously drops the old tri-state.

Each cycle probes **IPv4 first, then IPv6 as a fallback**:

1. `ping -c 1 -W 2 <target_ipv4>` (default `1.1.1.1`).
2. Only if that fails, `ping -6 -c 1 -W 2 <target_ipv6>` (default `2606:4700:4700::1111`) — using whichever IPv6 invocation the daemon detected at startup (`ping -6`, else the `ping6` applet; empty = IPv6 probing unavailable, IPv4-only).

A probe **succeeds** when the daemon parses a numeric round-trip time greater than 0 from the ping summary line (`min/avg/max[/mdev] = a/b/c[/d]`, average = 2nd field), falling back to a per-packet `time=<n>` reading. 100 % packet loss produces no round-trip line → no RTT → probe failure. That is the fail-safe: silence reads as "down", never as "up".

> ℹ️ NOTE — why v4-primary / v6-fallback: on an IPv6-only bearer the IPv4 probe fails fast and the IPv6 probe carries the connection, so `reachable` stays `true`. Either family answering counts as reachable; `last_family` records which one did.

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
  "targets": ["1.1.1.1", "2606:4700:4700::1111"],
  "interval_sec": 5,
  "last_rtt_ms": 34.2,
  "reachable": true,
  "streak_success": 12,
  "streak_fail": 0,
  "during_recovery": false,
  "last_family": "ipv4"
}
```

| Field | Meaning |
|-------|---------|
| `timestamp` | Wall-clock epoch of the write. |
| `mono` | Boot-relative monotonic seconds (from `/proc/uptime`) — immune to wall-clock jumps. |
| `profile` | Active profile name (`sensitive`/`regular`/`relaxed`/`quiet`) — a label the daemon resolves to cadence/thresholds; the CGI only writes the name. |
| `targets` | `[target_ipv4, target_ipv6]` — the two ICMP hosts in probe order. |
| `interval_sec` | Effective probe interval in seconds. |
| `last_rtt_ms` | Average RTT of the winning probe (1 decimal), or JSON `null` when both families failed. |
| `reachable` | Debounced boolean — flips to `false` only after `FAIL_THRESHOLD` consecutive failures, back to `true` after `RECOVER_THRESHOLD` consecutive successes. |
| `streak_success` | Consecutive successful probes. |
| `streak_fail` | **Consecutive failed probes.** This is the single number the Watchdog compares against its `fail_threshold` — the fail-ladder input, unchanged by the ICMP port. |
| `during_recovery` | `true` while `/tmp/qmanager_recovery_active` exists (the watchdog is mid-recovery); lets the poller suppress noise. |
| `last_family` | `ipv4` \| `ipv6` \| `none` — which address family answered last cycle. `ipv6` means the IPv4 leg failed and the fallback carried it; `none` means nothing answered. |

**Fields that are GONE** (were emitted by the Rust daemon, no longer written): `connectivity`, `limited_reason`, `down_reason`, `streak_limited`, `probe_target_used`, `http_code_seen`, `tcp_reused`. The `connectivity`/`state` tri-state no longer exists at the producer.

### Config and live reload

The daemon reads `/etc/qmanager/ping_profile.json` (env vars override it; hardcoded relaxed-profile defaults back it up). The active **profile name** maps to a cadence/threshold table the daemon owns in `resolve_profile()` — thresholds are derived from time windows via `ceil(secs / interval)` so retuning the interval keeps time-to-fail / time-to-recover stable:

| Profile | `interval_sec` | `fail_secs` | `recover_secs` | `history_secs` |
|---------|---------------|-------------|----------------|----------------|
| sensitive | 1 | 6 | 3 | 300 |
| regular | 2 | 10 | 6 | 300 |
| relaxed *(default)* | 5 | 15 | 10 | 300 |
| quiet | 10 | 30 | 20 | 600 |

Per-field JSON keys (`interval_sec`, `fail_secs`, `recover_secs`, `history_secs`) override the profile table when present and numeric — this is how the Watchdog retunes the **probe cadence** (`interval_sec`) without changing the profile. The config keys the daemon reads are `profile`, `target_ipv4`, `target_ipv6`, and those four optional overrides. The legacy HTTP-era keys `target_1`/`target_2` are **not** read (the installer migrates them — see below).

> ℹ️ NOTE — vestigial `intercept_secs`: the seed `ping_profile.json` still carries an `intercept_secs: 8` key inherited from the HTTP/204 era. The ICMP daemon does not read it (there is no intercept state to debounce). It is harmless and left in place; a future cleanup may prune it.

**Reload without restart:** any writer updates `ping_profile.json` and then `touch /tmp/qmanager_ping_reload`. The daemon `stat`s that flag once per cycle, re-reads config, re-resolves the profile, re-detects the IPv6 invocation, unlinks the flag, and continues — streak counters survive the reload, so switching cadence mid-flight never resets the reachability verdict.

> ℹ️ NOTE — the daemon is independent of the Watchdog. `qmanager_ping` stays up regardless of `watchcat.enabled`, so the Connection Quality page and the dashboard latency card get a live verdict even when the Watchdog is switched off. The Watchdog only ever *reads* `qmanager_ping.json`.

---

## The poller — turning probes into stats

**Short version:** `qmanager_poller` reads the daemon's raw verdict plus the RTT history ring and computes the latency/jitter/loss numbers the UI actually shows. **The poller was not modified by the ICMP port** — its null-safe `jq` reads simply see the fields the slim schema still emits and degrade gracefully on the ones it dropped.

The poller reads two files the daemon produces:

- `/tmp/qmanager_ping.json` — the current verdict (`reachable`, `streak_*`, `during_recovery`, `last_family`).
- `/tmp/qmanager_ping_history` — a flat ring buffer of RTT samples (one float or literal `null` per line), trimmed to `history_secs / interval_sec` entries.

From those, in a single pass, it derives the `connectivity` block written into `/tmp/qmanager_status.json` and typed as `ConnectivityStatus` (`types/modem-status.ts`):

| Field | Meaning |
|-------|---------|
| `internet_available` | `true`/`false`, or `null` when the ping daemon isn't running |
| `status` | Derived UI state: `connected` / `degraded` / `disconnected` / `recovery` / `unknown` |
| `latency_ms` | Most recent RTT (null if the last probe failed) |
| `avg_latency_ms` / `min_latency_ms` / `max_latency_ms` | Rolling stats over the history window |
| `jitter_ms` | Average inter-sample RTT variation |
| `packet_loss_pct` | Percentage of failed probes in the history window (0–100) |
| `latency_history` | Ring buffer of the last N RTTs (`null` = failed probe) — the data behind the latency graph |
| `state` | The daemon's tri-state, passed through — now only ever `connected` / `disconnected` / `unknown` (never `limited`; `PingTriState` dropped that member) |
| `last_family` | `ipv4` / `ipv6` / `none` — new field, mirrors the daemon's `last_family` |
| `limited_reason` / `streak_limited` | Legacy HTTP-probe fields — kept **typed but always `null`/`0`** for rolling-upgrade safety (a `status.json` from an older poller still parses); never populated post-ICMP |
| `down_reason` | Failure reason when disconnected (may be `null` under ICMP) |

**Where it surfaces:** the dashboard latency card and the Connection Quality page's live "Current" readouts consume this via the `useModemStatus` hook (5-second poll of `/tmp/qmanager_status.json`). The latency **chart** additionally pulls the NDJSON history through `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh`, which reads `/tmp/qmanager_ping_history.json` from RAM and reshapes it into a JSON array — zero modem contact.

> ℹ️ NOTE — the dashboard's `limited` internet badge was removed (`components/dashboard/network-status.tsx`), because the producer can no longer emit that state. The badge now renders only connected / degraded / disconnected.

---

## The Connection Quality page

The page (`/system-settings/connection-quality`) is a two-card grid (`components/system-settings/connection-quality/connection-quality.tsx`): **Probe Targets** on the left, **Latency & Loss Thresholds** on the right. Both are write surfaces; live readouts come from `useModemStatus`.

### Probe Targets card (`connectivity-sensitivity-card.tsx`)

> ℹ️ NOTE: The React file is still named `connectivity-sensitivity-card.tsx` for git-history continuity, but the card's title and role are **"Probe Targets"**.

Post ICMP-port, the card owns **two ICMP host settings** — `target_ipv4` (probed first) and `target_ipv6` (fallback) — plus the profile selector. Behavior:

- Inputs are **ICMP hosts** (IPv4 literal / IPv6 literal / hostname), **not HTTP URLs** — no scheme is prepended.
- IPv4 is probed first; the IPv6 target is only used if the IPv4 leg fails (and only when the daemon detected a working IPv6 ping invocation).
- A reset restores the Cloudflare DNS defaults (`1.1.1.1`, `2606:4700:4700::1111`).
- Client-side validation mirrors the CGI's per-family charset checks; the CGI re-validates server-side.

Data flow: `usePingProfile` hook (`hooks/use-ping-profile.ts`) → `GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh`.

- **GET** returns `{ success: true, settings: { profile, target_ipv4, target_ipv6 } }`.
- **POST** sends `{ action: "save_settings", profile, target_ipv4, target_ipv6 }`. All three are required; the CGI validates `profile ∈ {sensitive,regular,relaxed,quiet}` and each target against its family charset, then performs an **atomic jq key-merge** — it writes only `profile`/`target_ipv4`/`target_ipv6`, preserving the daemon/Watchdog-owned keys (`interval_sec`/`fail_secs`/`recover_secs`/`history_secs`) — and touches `/tmp/qmanager_ping_reload`.

**Server-side target validation** (`validate_target()`): trimmed, non-empty, ≤128 chars, no interior whitespace, no shell/HTML metacharacters (`` ` `` `$ ( ) ; | < > " \`), then a per-family charset whitelist — `ipv4` allows `[0-9A-Za-z.-]` (IPv4 literal or hostname), `ipv6` allows `[0-9A-Fa-f:.%]` and requires at least one `:`. Failures return `{ success: false, error: "invalid_target", message: "<reason>" }`.

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
| **Connection Quality** (Probe Targets card) | `settings/ping_profile.sh` | `profile`, `target_ipv4`, `target_ipv6` | `/tmp/qmanager_ping_reload` |
| **Connection Watchdog** (Detection tab) | `monitoring/watchdog.sh` | `interval_sec` (propagated from `watchcat.probe_interval`) | `/tmp/qmanager_ping_reload` **and** `/tmp/qmanager_watchcat_reload` |

This is the split-ownership realignment: **the Watchdog owns the *cadence*, the Connection Quality page owns the *targets*.** The `fail_threshold` / `probe_interval` ownership and propagation live on the Watchdog side — see [connection-watchdog.md → Split ownership of the probe cadence](connection-watchdog.md#split-ownership-of-the-probe-cadence).

### OTA migration — `migrate_ping_targets()`

Because the config keys were renamed (`target_1`/`target_2` HTTP URLs → `target_ipv4`/`target_ipv6` ICMP hosts), a device upgrading from the HTTP-probe era would otherwise carry dead keys the daemon ignores while missing the ones it reads. `config.sh` has no key-migration primitive, so the installer (`install_rm520n.sh` → `migrate_ping_targets`, wired into `install_backend`, run on every install/OTA) handles it defensively and idempotently:

- If `ping_profile.json` is absent or `jq` is unavailable → no-op.
- If the file has a legacy `target_1`/`target_2` **and** lacks the new `target_ipv4`+`target_ipv6` → reseed `target_ipv4=1.1.1.1` / `target_ipv6=2606:4700:4700::1111` and `del(.target_1)` / `del(.target_2)`, atomically (`mktemp` + `mv`, `chmod 644`).
- If the new keys are already present, or no legacy keys exist → no-op (idempotent).

---

## Known tradeoffs and the ICMP regression path

The ICMP port was a deliberate, user-approved decision that accepts real costs for RM551E parity:

- **No carrier-intercept detection.** The `limited` state — an honest "Limited by carrier" badge when a billing/data-cap/activation walled garden intercepts traffic — is gone. Under ICMP, an intercept that still routes ICMP reads as `reachable: true` (falsely "up"); one that drops ICMP reads as `reachable: false` (indistinguishable from a real outage). The Watchdog's old `limited` short-circuit is now permanently inert (see [connection-watchdog.md](connection-watchdog.md#carrier-intercept-short-circuit-now-inert)).
- **ICMP reachability is per-carrier variable.** This is the documented regression path: the very reason the Rust daemon used HTTP/204 was that *this project's* carrier dropped ICMP to `1.1.1.1`/`8.8.8.8` entirely. On a carrier (or SIM/APN) that filters ICMP to the configured DNS-server targets, `qmanager_ping` will read **100 % loss** and report a **false "disconnected"** even when the link is fine — which can drive the Watchdog into needless recovery. If you hit this, change the Probe Targets to hosts your carrier does answer ICMP for, before assuming the link is actually down.

> ℹ️ NOTE: The `ping-daemon/` Rust crate remains in the tree for now — **retired but present**, pending deletion in a follow-up cleanup commit after on-device soak. `ping-daemon/build-ping-daemon.sh` is neutered (early `exit 1`) so it can no longer produce the old binary. Do not treat the crate as live.

---

## Ownership boundary — who owns what

| Concern | Key(s) | Owner | Surface | Doc |
|---------|--------|-------|---------|-----|
| Probe cadence (how often) | `watchcat.probe_interval` → `ping_profile.json.interval_sec` | **Watchdog** | Watchdog → Detection tab | [connection-watchdog.md](connection-watchdog.md) |
| Failure threshold (how many misses) | `watchcat.fail_threshold` (vs. daemon `streak_fail`) | **Watchdog** | Watchdog → Detection tab | [connection-watchdog.md](connection-watchdog.md) |
| Probe targets (which hosts) | `ping_profile.json.target_ipv4` / `target_ipv6` | **Connection Quality** | Probe Targets card | this doc |
| Profile label | `ping_profile.json.profile` | **Connection Quality** | Probe Targets card | this doc |
| Alert thresholds (latency/loss) | `quality_thresholds.json.latency` / `loss` | **Connection Quality** | Latency & Loss Thresholds card | this doc |
| Recovery ladder (act on down link) | `watchcat.*` tiers | **Watchdog** | Watchdog page | [connection-watchdog.md](connection-watchdog.md) |

---

## Related docs

- Connection Watchdog — the recovery state machine that consumes this telemetry (`qmanager_watchcat`, 4-tier ladder, SIM failover, probe-cadence ownership) — [connection-watchdog.md](connection-watchdog.md)
- AT command transport (`qcmd`, flock serialization) — [at-command-transport.md](at-command-transport.md)
- Platform architecture, daemons, boot sequence — `../rm520n-gl-architecture.md`
