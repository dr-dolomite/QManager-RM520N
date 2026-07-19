# Connection Quality

"Connection Quality" is the **measurement / telemetry** side of QManager's connectivity stack — the part that *observes* how good the internet link is and turns raw probe results into latency, jitter, and packet-loss numbers the UI can chart. It is deliberately separate from the [Connection Watchdog](connection-watchdog.md), which is the **recovery** side — the state machine that *acts* when the link goes down. This document covers the producer→poller consumer chain that feeds the Connection Quality page (`/system-settings/connection-quality`) and the dashboard's latency card. It does **not** re-document the watchdog's recovery ladder — see the sibling doc for that.

> ℹ️ NOTE: The two docs are siblings by design. Connection Quality owns the **probe targets** and the **latency/loss alert thresholds**; the Watchdog owns the **probe cadence** (how often) and the **failure threshold** (how many misses before recovery). Where they touch the same file (`ping_profile.json`), the ownership boundary is spelled out below and in [connection-watchdog.md](connection-watchdog.md#ping-source--split-ownership).

---

## Quick Reference

| Item | Value |
|------|-------|
| Frontend page | `/system-settings/connection-quality` (`components/system-settings/connection-quality/`) |
| Producer daemon | `qmanager_ping` — compiled **Rust** HTTP/204 probe daemon (source: `ping-daemon/`, installed to `/usr/bin/qmanager_ping`) |
| Poller | `qmanager_poller` (`scripts/usr/bin/qmanager_poller`) — derives latency/jitter/loss/history |
| Consumer (recovery) | `qmanager_watchcat` — reads the verdict, never probes; see [connection-watchdog.md](connection-watchdog.md) |
| Ping verdict cache | `/tmp/qmanager_ping.json` (written by `qmanager_ping`, read by poller + watchdog) |
| History ring buffer | `/tmp/qmanager_ping_history` (RTT samples, read by poller for stats) |
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
HTTP/204 probes                                          │
                                                         └──────────────▶  qmanager_watchcat (CONSUMER, recovery)
```

---

## The producer — `qmanager_ping` (Rust HTTP/204 daemon)

**Short version:** `qmanager_ping` is a small always-on Rust binary that asks a couple of well-known web endpoints "are you there?" every few seconds and writes the answer to a JSON file. It uses an **HTTP request that expects a `204 No Content` reply**, not an ICMP `ping`, and that choice is forced by the carrier — see below.

The daemon replaces an older POSIX-shell version. It keeps one TCP connection open per target and reuses it across probes (persistent keep-alive), so the reported `last_rtt_ms` is real round-trip time rather than TCP-handshake overhead. Full design rationale lives in `docs/superpowers/specs/2026-05-09-rust-ping-daemon-design.md`; build/test notes in `ping-daemon/README.md`.

### Why HTTP/204 and not ICMP

Two carrier-path realities on this project's cellular link make ICMP useless as a reachability test:

1. **ICMP to common DNS anycast IPs is 100 % dropped.** Pinging `1.1.1.1` or `8.8.8.8` over the `rmnet` interface returns total packet loss — the carrier silently discards it. An ICMP-based "is the internet up?" check would report the link permanently down even when it is fine. (This is captured in project memory: *"Carrier drops ICMP to common DNS IPs on rmnet"* — do not "revert to a simple DNS ping" without re-verifying per carrier.)
2. **There is no IPv6 default route on the cellular path**, so IPv6 probes have nowhere to go.

An **HTTP/204 probe** ("captive-portal check" — the same technique phones use to detect WiFi login walls) sidesteps both. The daemon opens plain TCP on port 80/443 to a captive-portal endpoint (default `http://cp.cloudflare.com/` and `http://www.gstatic.com/generate_204`) and inspects the HTTP status code. That single content check yields **three** distinguishable states instead of two:

| State | Trigger | Meaning |
|-------|---------|---------|
| `connected` | HTTP `204 No Content` | Real, unimpeded internet. |
| `limited` | Any other HTTP code (`200`, `302`, `4xx`, `5xx`…) | **Carrier intercept** — a billing/data-cap/activation walled garden is answering instead of the real endpoint. TCP works, but you don't have open internet. |
| `disconnected` | TCP failure (timeout, refused, reset, DNS failure, malformed response) or carrier sysfs down | The link itself is down. |

The `limited` state is the whole point of the content check: it lets the [Watchdog short-circuit recovery](connection-watchdog.md) (no amount of modem-reset or SIM-failover fixes a billing portal), and it lets the UI render an honest "Limited by carrier" badge instead of a false "disconnected".

### What the daemon writes — `/tmp/qmanager_ping.json`

Atomic write (`.tmp` + `rename`) every cycle. The shape below is abridged; the authoritative schema is Section 5 of the design spec. The fields most relevant to Connection Quality:

```json
{
  "timestamp": 1707900000,
  "last_rtt_ms": 34.2,
  "reachable": true,
  "streak_success": 12,
  "streak_fail": 0,
  "connectivity": "connected",
  "limited_reason": null,
  "down_reason": null,
  "streak_limited": 0,
  "interval_sec": 5,
  "profile": "relaxed"
}
```

- **`connectivity`** — the authoritative tri-state (`connected`/`limited`/`disconnected`). `reachable` is preserved as `connectivity == "connected"` for legacy consumers.
- **`streak_fail`** — the debounced count of **consecutive `disconnected` probes**. This is the single number the Watchdog compares against its `fail_threshold` (see the split-ownership note). Critically, a `limited` probe increments `streak_limited` and resets `streak_fail` to `0` — carrier intercepts never look like link failures to the watchdog.
- **`last_rtt_ms`** — real RTT, or JSON `null` on any non-`connected` outcome.

### Config and live reload

The daemon reads `/etc/qmanager/ping_profile.json` (env vars override it; hardcoded relaxed-profile defaults back it up — resolution order is env > JSON > defaults, in `ping-daemon/src/config.rs::load`). Named profiles (`sensitive`/`regular`/`relaxed`/`quiet`) map to time-based windows the daemon compiles into cycle counts at load:

| Profile | `interval_sec` | `fail_secs` | `recover_secs` | `intercept_secs` | `history_secs` |
|---------|---------------|-------------|----------------|------------------|----------------|
| sensitive | 1 | 6 | 3 | 8 | 300 |
| regular | 2 | 10 | 6 | 8 | 300 |
| relaxed *(default)* | 5 | 15 | 10 | 8 | 300 |
| quiet | 10 | 30 | 20 | 8 | 600 |

**Reload without restart:** any writer updates `ping_profile.json` and then `touch /tmp/qmanager_ping_reload`. The daemon `stat`s that flag once per cycle (one syscall, no fork), re-reads config, recomputes thresholds, unlinks the flag, and continues — **streak counters survive the reload**, so switching cadence mid-flight never resets the connectivity verdict.

> ℹ️ NOTE — the daemon is independent of the Watchdog. `qmanager_ping` stays up regardless of `watchcat.enabled`, so the Connection Quality page and the dashboard latency card get a live verdict even when the Watchdog is switched off. The Watchdog only ever *reads* `qmanager_ping.json`.

---

## The poller — turning probes into stats

**Short version:** `qmanager_poller` reads the daemon's raw verdict plus the RTT history ring and computes the latency/jitter/loss numbers the UI actually shows.

The poller reads two files the daemon produces:

- `/tmp/qmanager_ping.json` — the current verdict (`connectivity`, `reachable`, `during_recovery`, `streak_*`).
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
| `state` | The daemon's raw tri-state (`connected`/`limited`/`disconnected`/`unknown`) passed through for the badge |
| `limited_reason` / `down_reason` | HTTP code (when limited) / failure reason (when disconnected) |

**Where it surfaces:** the dashboard latency card and the Connection Quality page's live "Current" readouts consume this via the `useModemStatus` hook (5-second poll of `/tmp/qmanager_status.json`). The latency **chart** additionally pulls the NDJSON history through `GET /cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh`, which reads `/tmp/qmanager_ping_history.json` from RAM and reshapes it into a JSON array — zero modem contact.

---

## The Connection Quality page

The page (`/system-settings/connection-quality`) is a two-card grid (`components/system-settings/connection-quality/connection-quality.tsx`): **Probe Targets** on the left, **Latency & Loss Thresholds** on the right. Both are write surfaces; live readouts come from `useModemStatus`.

### Probe Targets card (`connectivity-sensitivity-card.tsx`)

> ℹ️ NOTE: The React file is still named `connectivity-sensitivity-card.tsx` for git-history continuity, but the card's title and role are now **"Probe Targets"**. The former "Connectivity Sensitivity" profile picker (the `sensitive`/`regular`/`relaxed`/`quiet` Tabs) was removed in the split-ownership rework.

The card owns exactly two settings — `target_1` (primary) and `target_2` (fallback) — the URLs the daemon probes. Behavior:

- Primary is checked first; secondary is only used if primary fails. URLs without a scheme default to https.
- A reset button restores the defaults (`http://cp.cloudflare.com/`, `http://www.gstatic.com/generate_204`).
- Client-side validation rejects empty/over-256-char/whitespace/shell-metacharacter input; the CGI re-validates server-side.
- The card carries an explicit cross-link: *"Probe timing — how often the modem checks and how many failures trigger recovery — now lives in the [Connection Watchdog](connection-watchdog.md)."* This is the UI half of the ownership boundary.

Data flow: `usePingProfile` hook (`hooks/use-ping-profile.ts`) → `GET/POST /cgi-bin/quecmanager/settings/ping_profile.sh`. The hook is **targets-only** — it reads `settings.target_1`/`settings.target_2` from the GET response and ignores any legacy `profile` field the endpoint still echoes; its `save()` POSTs `{ action: "save_settings", target_1, target_2 }`.

> ℹ️ NOTE — `profile` is optional on POST: the targets-only `usePingProfile.save()` deliberately sends no `profile` field. `ping_profile.sh`'s POST handler treats it as **optional** — when absent it preserves the existing `.profile` label already in `ping_profile.json` (defaulting to `relaxed` if the file is missing or holds an unexpected value), so a targets-only save is never rejected. When a `profile` **is** sent it must still be one of `sensitive|regular|relaxed|quiet`, else `invalid_profile`. (An earlier build hard-required `profile` and rejected every targets-only save with `invalid_profile`; that was fixed by making the field optional — verified on-device across the targets-only, missing-file, explicit-valid, and explicit-invalid cases.)

### Latency & Loss Thresholds card (`quality-thresholds-card.tsx`)

**Short version:** this card decides *when a slow or lossy link gets flagged as a network event* — it is an **alerting** control, not a recovery control. Nothing here ever triggers a modem reset or SIM failover.

It sets two independent presets — one for latency, one for packet loss — each `standard` / `tolerant` / `very-tolerant`. The presets are pure classification thresholds consumed by the events pipeline (`scripts/usr/lib/qmanager/events.sh`), which emits `high_latency` / `high_packet_loss` network events (and downstream email/SMS/Discord alerts) when a live reading stays over threshold for the debounce count of samples. The threshold values are authoritative in `events.sh`; the card mirrors them for display:

| Preset | Latency threshold / debounce | Loss threshold / debounce |
|--------|------------------------------|---------------------------|
| standard | 150 ms / 3 samples | 15 % / 3 samples |
| tolerant *(default)* | 250 ms / 3 samples | 30 % / 3 samples |
| very-tolerant | 500 ms / 2 samples | 50 % / 2 samples |

Data flow: `useQualityThresholds` → `GET/POST /cgi-bin/quecmanager/settings/quality_thresholds.sh` → `/etc/qmanager/quality_thresholds.json`, poking `/tmp/qmanager_events_reload` so `events.sh` re-reads without a restart. The card's "Current" cells read `connectivity.latency_ms` / `connectivity.packet_loss_pct` live and show an ok/warn glyph relative to the selected threshold — a preview, not the alert itself.

> ℹ️ NOTE: These thresholds are **shared, read-only telemetry classification** from the Watchdog's perspective — the recovery ladder never reads them. Conversely, the Quality Thresholds surface was untouched by the split-ownership rework; it is orthogonal to both probe targets and probe cadence.

---

## The `ping_profile.json` two-writer contract

`/etc/qmanager/ping_profile.json` is written by **two independent CGI endpoints**, split by ownership. Neither may overwrite the whole file — each performs an **atomic jq key-merge** (read the existing JSON, set only its own keys, `.tmp` + `mv`) so it can't clobber the other's keys.

| Owner | CGI | Keys it writes | Reload flag(s) it touches |
|-------|-----|----------------|---------------------------|
| **Connection Quality** (Probe Targets card) | `settings/ping_profile.sh` | `profile`, `target_1`, `target_2` | `/tmp/qmanager_ping_reload` |
| **Connection Watchdog** (Detection tab) | `monitoring/watchdog.sh` | `interval_sec` (propagated from `watchcat.probe_interval`) | `/tmp/qmanager_ping_reload` **and** `/tmp/qmanager_watchcat_reload` |

This is the split-ownership realignment: **the Watchdog owns the *cadence*, the Connection Quality page owns the *targets*.** The `fail_threshold` and `probe_interval` ownership, the propagation mechanism, and the `max_failures → fail_threshold` migration all live on the Watchdog side — see [connection-watchdog.md → Split ownership of the probe cadence](connection-watchdog.md#split-ownership-of-the-probe-cadence) rather than duplicating them here.

**Documented side effect:** because `ping_profile.sh` no longer overwrites the whole file, changing `profile` no longer resets the daemon's internal `fail_secs` / `recover_secs` / `intercept_secs` / `history_secs` debounce fields — once present, those pass through unchanged. `profile` is now effectively a label paired with the targets, not a live threshold switch.

---

## Ownership boundary — who owns what

| Concern | Key(s) | Owner | Surface | Doc |
|---------|--------|-------|---------|-----|
| Probe cadence (how often) | `watchcat.probe_interval` → `ping_profile.json.interval_sec` | **Watchdog** | Watchdog → Detection tab | [connection-watchdog.md](connection-watchdog.md) |
| Failure threshold (how many misses) | `watchcat.fail_threshold` (vs. daemon `streak_fail`) | **Watchdog** | Watchdog → Detection tab | [connection-watchdog.md](connection-watchdog.md) |
| Probe targets (which endpoints) | `ping_profile.json.target_1` / `target_2` | **Connection Quality** | Probe Targets card | this doc |
| Profile label | `ping_profile.json.profile` | **Connection Quality** | Probe Targets card (no longer picker-driven) | this doc |
| Alert thresholds (latency/loss) | `quality_thresholds.json.latency` / `loss` | **Connection Quality** | Latency & Loss Thresholds card | this doc |
| Recovery ladder (act on down link) | `watchcat.*` tiers | **Watchdog** | Watchdog page | [connection-watchdog.md](connection-watchdog.md) |

---

## Related docs

- Connection Watchdog — the recovery state machine that consumes this telemetry (`qmanager_watchcat`, 4-tier ladder, SIM failover, probe-cadence ownership) — [connection-watchdog.md](connection-watchdog.md)
- Rust ping daemon full design (tri-state machine, keep-alive client, output contract) — `docs/superpowers/specs/2026-05-09-rust-ping-daemon-design.md`; build/test — `ping-daemon/README.md`
- AT command transport (`qcmd`, flock serialization) — [at-command-transport.md](at-command-transport.md)
- Platform architecture, daemons, boot sequence — `../rm520n-gl-architecture.md`
