# QManager Architecture

This document describes the overall system architecture, data-flow patterns, and key design decisions in QManager. It is the high-level map; deeper per-subsystem detail lives in [`reference/`](reference/) and [`rm520n-gl-architecture.md`](rm520n-gl-architecture.md), which this doc cross-links rather than duplicates.

> ℹ️ NOTE: QManager runs **on the Quectel RM520N-GL modem itself** — there is no external OpenWRT host. The project began life as an OpenWRT-hosted panel for the RM551E (procd/UCI/uhttpd); that lineage is history only. Everything below describes the RM520N-GL as it runs today. See [Legacy Heritage](#legacy-heritage) for the one paragraph of history worth keeping.

---

## System Overview

QManager is a two-tier application, but both tiers live on the modem:

1. **Frontend** — A statically-exported Next.js app (React 19) served by the modem's own web server, **lighttpd** (installed via Entware). It runs entirely in the browser.
2. **Backend** — Shell scripts running on the modem's internal **vanilla Linux** (SDXLEMUR SoC, ARMv7l, kernel 5.4.210): CGI endpoints for API requests, long-running daemons for data collection, and **systemd** units for process management. CGI runs as the unprivileged `www-data:dialout` user; daemons run as root.

```
┌──────────────────────────────────────────────────────────┐
│                      Browser (Client)                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │            Next.js Static App (React 19)            │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │ │
│  │  │Dashboard│ │ Cellular │ │ Network  │ │Monitor │ │ │
│  │  │ Cards   │ │ Settings │ │ Settings │ │& Alerts│ │ │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │ │
│  │       └──────┬─────┴────────────┴───────────┘      │ │
│  │              │  authFetch() — session cookie sent   │ │
│  └──────────────┼──────────────────────────────────────┘ │
└─────────────────┼────────────────────────────────────────┘
                  │ HTTP GET/POST
                  ▼
┌──────────────────────────────────────────────────────────┐
│        RM520N-GL Modem (Vanilla Linux · systemd)          │
│  ┌──────────────────────────────────────────────────────┐│
│  │ lighttpd → /usrdata/qmanager/www/cgi-bin/quecmanager/ ││
│  │  ┌──────────────────────────────────────────────┐    ││
│  │  │ cgi_base.sh (auth + headers + JSON helpers)  │    ││
│  │  │ platform.sh (systemctl/sudo/pid_alive)       │    ││
│  │  └──────────────────────────────────────────────┘    ││
│  │       │ reads cache        │ executes AT             ││
│  │       ▼                    ▼                          ││
│  │  /tmp/qmanager_      qcmd → atcli_smd11 → /dev/smd11  ││
│  │  status.json              (flock-serialized)          ││
│  │       ▲                                               ││
│  │       │ writes every ~2s                              ││
│  │  ┌──────────────────────────────────────────────┐    ││
│  │  │  qmanager_poller (main data collector)       │    ││
│  │  │  + qmanager_ping  + qmanager_watchcat        │    ││
│  │  │  (systemd services, run as root)             │    ││
│  │  └──────────────────────────────────────────────┘    ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

The rootfs is UBIFS and read-only on stock boot; the installer remounts it read-write only where it must. All persistent app state lives on the writable `/usrdata/` volume and under `/etc/qmanager/`.

---

## Data Flow

### Polling Architecture (Backend)

The poller daemon (`qmanager_poller`, at `/usr/bin/qmanager_poller`) is the single owner of the modem's AT channel for routine reads. Its design rule is **"Sip, Don't Gulp"**: acquire the AT lock, run one command, release, sleep, repeat — leaving gaps so the terminal, watchdog, and CGI writes can reach the modem too.

It runs a tiered loop (base cadence `POLL_INTERVAL=2s`) and writes everything into one cache file:

| Tier | Cadence | Data Collected | Source |
|------|---------|----------------|--------|
| **Tier 1 (Hot)** | every cycle (~2s) | Serving cell (RSRP/RSRQ/SINR/RSSI), carrier aggregation, traffic/data-usage counters, CPU/mem/uptime, modem crash watcher, system health | `AT+QENG="servingcell"`, `AT+QCAINFO`, `/proc/net/dev`, sysfs |
| **Tier 1.5 (Signal)** | every 5 cycles (~10s) | Per-antenna signal, signal-history NDJSON, ping-history NDJSON, watchcat state | `AT+QRSRP;+QRSRQ;+QSINR` |
| **Tier 2 (Warm)** | every 15 cycles (~30s) | Temperature, carrier/COPS, SIM slot & status, APN + WAN IPs, timing advance, MIMO layers, CFUN | `AT+QTEMP;+COPS?;+QUIMSLOT?;+CPIN?`, `AT+CGCONTRDP`, `AT+QNWCFG=...` |
| **Boot (once)** | at startup | Firmware, model, IMEI, IMSI, ICCID, phone number, capabilities, supported bands, IP-passthrough config, active-profile auto-apply | `AT+CVERSION;+CGMM;+CGSN;+CIMI;+QCCID;+CNUM;+QGETCAPABILITY`, `AT+QNWPREFCFG="policy_band"` |

Key mechanics verified from the poller source:

- **Compound AT reads.** Many tiers batch several queries into one `qcmd` call (e.g. `AT+QTEMP;+COPS?;+QUIMSLOT?;+CNUM;+CPIN?`) to hold the AT lock once instead of five times. Fragile queries (`+CPIN?`, mode-specific MIMO reads) are ordered last or gated by `network_type` so one `ERROR` cannot kill the whole chain.
- **Single atomic cache write.** Each cycle ends in `write_cache`, which builds `/tmp/qmanager_status.json` with `jq` into a `.tmp` file and `mv`s it into place — readers never see a half-written file.
- **`system_health` is precomputed.** Tier 1 runs `update_system_health()`, a no-AT, sysfs-only collector (modem subsystem state, crash counters, load, CPU freq, `/usrdata` storage) that fills the top-level `system_health` block. The `/system/modem-subsys.sh` CGI is a thin reader over that block — no live computation at request time.
- **Data-usage counter.** Tier 1 also runs `update_data_used()`, which accumulates kernel RX/TX bytes from `/proc/net/dev` (`rmnet_ipa0`) into a persistent, reboot-surviving JSON at `/usrdata/qmanager/data_used.json`. Counter orientation (which raw field is download vs upload) is resolved once at startup from the SoC branch name. Full detail: [`reference/data-usage-counter.md`](reference/data-usage-counter.md).
- **On-demand refresh flags.** Touching `/tmp/qmanager_tier2_refresh` (e.g. from a SIM-slot-change CGI) pulls the warm refresh into the next cycle instead of waiting up to ~30s.

### Frontend Polling

The frontend never touches the modem. Each polling hook fetches a CGI endpoint that simply reads a cache file the poller already wrote:

```
useModemStatus()    ── GET /at_cmd/fetch_data.sh           ── reads /tmp/qmanager_status.json
  (every 2s)

useSignalHistory()  ── GET /at_cmd/fetch_signal_history.sh ── reads signal-history NDJSON
  (every 10s)

useLatencyHistory() ── GET /at_cmd/fetch_ping_history.sh   ── reads ping-history NDJSON
  (every 30s)

useRecentActivities() ─ GET /at_cmd/fetch_events.sh        ── reads events NDJSON
```

All requests go through `authFetch()` (`lib/auth-fetch.ts`), which auto-sends the session cookie and, on a `401`, clears the client login flag and redirects to `/login`. Hooks also do **staleness detection**: `useModemStatus` marks data stale if the cache's `timestamp` is older than 10s, so a wedged poller is visible in the UI instead of silently showing frozen numbers.

### Write Operations

User configuration changes follow a synchronous request/response pattern:

```
User Action → React Component → authFetch() POST → CGI Script
                                                      │
                                              ┌───────┴───────┐
                                              │ Parse POST    │
                                              │ qcmd AT+...   │  (flock-serialized
                                              │ Return JSON   │   against the poller)
                                              └───────────────┘
```

Long or multi-step operations are asynchronous — a start endpoint spawns a background worker, and the frontend polls a status endpoint:

```
POST /profiles/apply.sh    → spawns qmanager_profile_apply (double-fork, background)
                              ↓
Frontend polls GET /profiles/apply_status.sh
                              ↓
Worker writes progress → /tmp/qmanager_profile_state.json
```

The same start/poll shape is used for cell scans (`/at_cmd/cell_scan_*`), neighbour scans, and speedtests. Because a long AT command (e.g. `AT+QSCAN`) can hold the modem for a minute or more, the worker touches `/tmp/qmanager_long_running` so the poller drops into a ping-only, no-AT mode until the scan finishes.

### CGI Endpoint Namespaces

CGI scripts are grouped by subsystem under `/usrdata/qmanager/www/cgi-bin/quecmanager/`. The frontend addresses them by the same relative path (e.g. `/cgi-bin/quecmanager/at_cmd/fetch_data.sh`).

| Namespace | Responsibility |
|-----------|----------------|
| `at_cmd/` | Cache readers (`fetch_data`, `fetch_*_history`, `fetch_events`), raw AT (`send_command`), scan & speedtest start/status |
| `auth/` | Login, logout, setup check, password + SSH-password change |
| `cellular/` | Serving-cell/SIM settings, band & network-mode control |
| `bands/` · `frequency/` · `tower/` | Band locking, frequency locking, tower (PCI) locking + failover |
| `profiles/` · `scenarios/` | SIM profiles and Connection Scenarios (CRUD + async apply) |
| `network/` | TTL/HL, MTU, custom DNS, IP passthrough, ethernet link speed |
| `monitoring/` | Ping profile, quality thresholds, email/SMS/Discord alerts |
| `settings/` · `system/` · `device/` | System settings, OTA update, health, web console, modem-subsystem status |

Every script sources `cgi_base.sh` first (which enforces auth, sets `PATH` to include Entware's `/opt/bin`, and loads `platform.sh`). See [`API-REFERENCE.md`](API-REFERENCE.md) for per-endpoint request/response schemas.

---

## Authentication

QManager uses cookie-based session auth, implemented in `cgi_auth.sh` and enforced automatically by `cgi_base.sh`.

| Cookie | Type | Purpose |
|--------|------|---------|
| `qm_session` | HttpOnly, SameSite=Strict | Session token (validated server-side) |
| `qm_logged_in` | JS-readable, SameSite=Strict | Client-side login indicator |

### Flow

1. **First-time setup**: with no password file present, `require_auth` returns `401 setup_required`; the UI routes the user to create a password. Setup state is "does `/etc/qmanager/auth.json` exist and is non-empty".
2. **Login**: `POST /auth/login.sh` verifies the password (salted SHA-256, timing-safe compare) → creates a session file under `/tmp/qmanager_sessions/<token>` → sets both cookies (1-hour `Max-Age`).
3. **Authenticated requests**: the browser auto-sends `qm_session`; `cgi_base.sh` calls `require_auth`, which validates the token against its session file and checks it hasn't expired.
4. **401 handling**: `authFetch()` catches `401` → clears `qm_logged_in` → redirects to `/login`.
5. **Session model**: one file per session (the file's contents are the creation epoch), so there is no shared-file race. Expired files are pruned lazily on the next login.

`cgi_base.sh` enforces auth on **every** CGI by default. The handful of endpoints that must run pre-login (`auth/check.sh`, `auth/login.sh`) set `_SKIP_AUTH=1` before sourcing the base library. Login is rate-limited (5 attempts / 5-minute window → 5-minute lockout) via `/tmp/qmanager_auth_attempts.json`.

> ⚠️ WARNING: Validate CGI endpoints as `www-data`, not root. Testing with a root shell and `_SKIP_AUTH=1` masks the file-permission and PATH bugs that only appear under lighttpd's stripped-down CGI environment.

---

## State Management Patterns

### Frontend Hook Categories

| Pattern | Examples | Behavior |
|---------|----------|----------|
| **Polling Hooks** | `useModemStatus`, `useSignalHistory`, `useLatencyHistory`, `useRecentActivities` | Auto-fetch at interval, staleness detection, manual refresh |
| **One-Shot Hooks** | `useCellularSettings`, `useApnSettings` (`use-wan-profiles`), `useMbnSettings` | Fetch on mount, local cache, explicit `saveSettings()` |
| **Form Hooks** | `useAuth`, `useAutoLogout` | Cookie check, submit actions, rate-limit handling |
| **Async Process Hooks** | `useProfileApply`, `useCellScanner`, `useSpeedtest`, `useNeighbourScanner` | Start operation → poll status → completion/error |

All ~40 hooks live in `hooks/` and talk to the CGI layer exclusively through `authFetch()`. See [`FRONTEND.md`](FRONTEND.md) for the full hook/component catalogue.

### Backend State Files

Runtime state is coordinated entirely through files — **no IPC sockets or signals**. Daemons write files; CGIs read them; CGIs write config and "poke" trigger files that daemons notice on their next tick.

| File | Owner | Format | Purpose |
|------|-------|--------|---------|
| `/tmp/qmanager_status.json` | poller | JSON | Main modem-status cache (the frontend's source of truth) |
| `/tmp/qmanager_signal_history.json` | poller | NDJSON | Per-antenna signal history (~30 min, 180 lines @ 10s) |
| `/tmp/qmanager_ping_history.json` | poller | NDJSON | Latency history (24 h, max 8640 lines @ 10s) |
| `/tmp/qmanager_events.json` | poller | NDJSON | Network events (max 50 entries) |
| `/tmp/qmanager_pci_state.json` | poller | JSON | SCC PCI tracking for event detection |
| `/usrdata/qmanager/data_used.json` | poller | JSON | Persistent RX/TX byte accounting (survives reboot) |
| `/tmp/qmanager_ping.json` | ping daemon | JSON | Current connectivity/latency result |
| `/tmp/qmanager_watchcat.json` | watchcat | JSON | Watchdog state machine |
| `/tmp/qmanager_profile_state.json` | profile_apply | JSON | SIM-profile apply progress |
| `/tmp/qmanager_at.lock` | qcmd (shared) | flock target | Serializes all AT access across daemons + CGIs |
| `/tmp/qmanager_sessions/<token>` | auth | one file/session | Session store (RAM, cleared on reboot) |
| `/etc/qmanager/` | CGI + daemons | Various | Persistent configuration (see below) |

---

## Daemon Architecture

### Process Model (systemd)

QManager ships `.service` units to `/lib/systemd/system/`. Boot persistence is done with **explicit symlinks into `multi-user.target.wants/`** — the RM520N-GL's minimal systemd ignores `systemctl enable`, so `platform.sh`'s `svc_enable()` writes the symlink directly. All service control from CGI goes through `platform.sh` (`svc_start`/`svc_stop`/`svc_is_running`), which prefixes `sudo` because lighttpd runs CGI as `www-data`.

Core long-running services:

```
qmanager-setup.service      one-shot bootstrap (dirs, perms, lock files) — ordered before the rest
  │
  ├── qmanager-ping.service      qmanager_ping — connectivity/latency probe (writes qmanager_ping.json)
  │
  └── qmanager-poller.service    qmanager_poller — main data collector (After= setup, ping)
                                   • ExecStartPre waits up to 30s for /dev/smd11
                                   • sources parse_at.sh, events.sh, email/sms alerts, profile_mgr.sh

qmanager-watchcat.service   qmanager_watchcat — connection-health watchdog
                             • ExecStartPre gate: only starts if config watchcat.enabled=1

lighttpd.service            web server (serves the static frontend + CGI)
tailscaled.service          Tailscale VPN daemon
qmanager-discord.service    qmanager_discord — optional Discord bot
qmanager-console.service    qmanager_console_mgr — web console (ttyd)
```

Boot-time one-shots (apply persisted config, then exit):

```
qmanager-firewall.service     qmanager_firewall  — iptables ruleset
qmanager-ethernet.service     qmanager_ethernet_apply — persisted eth0 link-speed cap
qmanager-ttl.service          persisted TTL/HL iptables rules (rmnet+)
qmanager-mtu.service          qmanager_mtu_apply — waits for rmnet_data0, applies MTU
qmanager-imei-check.service   qmanager_imei_check — boot-time IMEI rejection check
qmanager-tower-failover.service  qmanager_tower_failover — tower-lock failover watchdog
qmanager-cfun-fix.service     qmanager_cfun_fix — recovers a modem stuck in CFUN=0
```

Scheduled work (cron, configured by `system/settings.sh`): `qmanager_scheduled_reboot` fires a reboot at a user-configured time.

For the full unit dependency graph, Entware bootstrap, and lighttpd config, see [`rm520n-gl-architecture.md`](rm520n-gl-architecture.md) and [`rm520n-phase2-systemd-migration.md`](rm520n-phase2-systemd-migration.md).

### AT Command Transport

All modem communication funnels through one gatekeeper, `qcmd` (`/usr/bin/qcmd`):

| Aspect | Behavior |
|--------|----------|
| Tool | `qcmd` shell wrapper around `atcli_smd11` (a static ARMv7 Rust binary) |
| Device | `/dev/smd11`, opened directly — **no socat/PTY bridge** |
| Locking | `flock` on `/tmp/qmanager_at.lock` via a read-only FD (`9<`), so root and `www-data` share it under `fs.protected_regular=1` |
| Timeout | BusyBox `flock` has no `-w`; `qcmd` polls with `flock -x -n` in a loop (`flock_wait`) |
| Exit code | `atcli_smd11` **always exits 0** — error detection parses the response text for `OK`/`ERROR`, never `$?` |
| SMS | `sms_tool` (separate ARM binary) under the *same* lock file |

Full detail — including the "do NOT UPX-compress the Rust binary" rule and `pid_alive()` for cross-user PID checks — is in [`reference/at-command-transport.md`](reference/at-command-transport.md).

---

## Event System

The poller's `events.sh` library detects state changes each cycle and appends them to the events NDJSON file (max 50), which the UI surfaces as "Recent Activity":

| Event Type | Trigger | Severity |
|-----------|---------|----------|
| `network_mode` | LTE ↔ 5G-NSA ↔ 5G-SA switch | info/warning |
| `band_change` | LTE or NR band changed | info |
| `pci_change` / `scc_pci_change` | PCC / SCC cell handoff | info |
| `ca_change` | Carrier aggregation activated/deactivated/count changed | info/warning |
| `nr_anchor` | 5G NR anchor gained/lost | info/warning |
| `airplane_mode` | CFUN state toggled (radio on/off) | info/warning |
| `signal_lost` / `signal_restored` | Modem reachability change | warning/info |
| `internet_lost` / `internet_restored` | Internet connectivity change | warning/info |
| `high_latency` / `latency_recovered` | Latency over threshold (debounced) | warning/info |
| `high_packet_loss` / `packet_loss_recovered` | Loss over threshold (debounced) | warning/info |

Two additional events are emitted from outside `events.sh`: `sim_swap_detected` (poller `collect_boot_data`, when the boot ICCID differs from the stored one) and watchdog recovery/failover events (from `qmanager_watchcat`). Events are suppressed during active watchdog recovery to prevent noise.

---

## Watchdog (Connection Health)

`qmanager_watchcat` implements a tiered escalation recovery. It only runs when `watchcat.enabled=1` in config (the systemd unit's `ExecStartPre` checks this and refuses to start otherwise), and it reads the poller's connectivity verdict rather than probing independently.

```
MONITOR ──(failures)──► SUSPECT ──(confirmed)──► RECOVERY ──► COOLDOWN ──► MONITOR
                                                     │                        ▲
                                                     │   (max retries)        │
                                                     └──► LOCKED ─────────────┘
                                                           (manual reset)

Tier 1: Re-register to network   (AT+COPS=2 then AT+COPS=0)
Tier 2: CFUN toggle              (reset radio — skipped if a tower lock is active)
Tier 3: SIM failover             (switch SIM slot via the "Golden Rule" sequence)
Tier 4: Full reboot              (token-bucket capped, then auto-disables)
```

Individual tiers can be disabled in config (`tier1_enabled`…`tier4_enabled`). The **Golden Rule** for any SIM-slot switch is `AT+CFUN=0` → sleep → `AT+QUIMSLOT=N` → sleep → `AT+CFUN=1`, aborting immediately if `CFUN=0` fails. A successful SIM failover (or revert) also triggers profile auto-apply for the newly-active SIM.

---

## Custom SIM Profiles

A SIM profile bundles a complete modem configuration — APN + TTL/HL + optional Connection Scenario + optional IMEI — bound to a SIM by ICCID and applied as a unit. When a matching ICCID is detected (at boot, on manual SIM switch, or after a watchdog failover), `auto_apply_profile()` in `profile_mgr.sh` sets the profile active and spawns `qmanager_profile_apply` in the background.

The apply worker runs four ordered steps and skips any that already match (making it a no-op when nothing has drifted):

```
Step 1: APN       → set PDP context + full attach cycle
Step 2: TTL/HL    → iptables rules on rmnet+
Step 3: Scenario  → AT+QNWPREFCFG mode + optional band locks (only if scenario_id set)
Step 4: IMEI      → AT+EGMR + AT+CFUN=1,1 reboot (only if IMEI changed)
```

Order matters: `AT+CFUN=1,1` reboots the radio, so Scenario writes **must** precede the IMEI step or they would be lost. The frontend polls `/profiles/apply_status.sh` for progress. The full profile JSON schema, the page-gating matrix, and the `scenario_id` reference-by-id semantics are documented in [`reference/sim-profiles.md`](reference/sim-profiles.md); APN internals are in [`reference/wan-profile-management.md`](reference/wan-profile-management.md).

---

## Configuration Persistence

There is **no UCI** on this platform. Structured config lives in a single JSON file managed by `config.sh` (a drop-in replacement for `uci get`/`set`/`commit`, using `jq`); everything else is purpose-specific files under `/etc/qmanager/`.

| What | Where | Format |
|------|-------|--------|
| Watchdog / ethernet / bridge-monitor / general settings | `/etc/qmanager/qmanager.conf` | JSON (via `config.sh`) |
| Auth password | `/etc/qmanager/auth.json` | Salt + SHA-256 hash (chmod 600) |
| SIM profiles | `/etc/qmanager/profiles/<id>.json` | JSON |
| Active SIM-profile marker | `/etc/qmanager/active_profile` | Plain text (profile ID) |
| Connection scenarios | `/etc/qmanager/scenarios/<id>.json` | JSON |
| Active scenario marker | `/etc/qmanager/active_scenario` | Plain text (scenario ID) |
| Ping profile | `/etc/qmanager/ping_profile.json` | JSON |
| Quality thresholds | `/etc/qmanager/quality_thresholds.json` | JSON |
| Last SIM ICCID | `/etc/qmanager/last_iccid` | Plain text |
| Email SMTP config | `/etc/qmanager/msmtprc` | msmtp config (chmod 600) |
| Persistent data-usage counter | `/usrdata/qmanager/data_used.json` | JSON |
| Sessions | `/tmp/qmanager_sessions/<token>` | One file per session (RAM) |

TTL/HL, MTU, tower-lock, band-lock, and IMEI-backup state are each managed by their own feature scripts and files; see the relevant [`reference/`](reference/) docs. Persistent config on `/etc/` requires the rootfs to be remounted read-write, which the installer and the boot one-shots handle.

---

## Legacy Heritage

QManager descends from an OpenWRT-hosted admin panel (targeting the external-host RM551E, using procd init, UCI config, and uhttpd). The `scripts/etc/init.d/` directory still carries a few procd-style scripts as vestigial artifacts of that lineage, and `config.sh` documents its functions in terms of their old UCI equivalents — but **none of that is live behavior**. On the RM520N-GL the init system is systemd, config is file-based, and the web server is lighttpd. Treat any OpenWRT/UCI/procd/uhttpd reference in older code or comments as history, not as something to extend.

The upstream reference panel (iamromulan/quectel-rgmii-toolkit, "SimpleAdmin") lives under `simpleadmin-source/` for historical comparison only; QManager is now fully independent of it.

---

> **See also:** [`rm520n-gl-architecture.md`](rm520n-gl-architecture.md) for the complete platform analysis (systemd service graph, Entware bootstrap, lighttpd config, boot sequence, troubleshooting), [`BACKEND.md`](BACKEND.md) for the CGI/daemon/library catalogue, [`FRONTEND.md`](FRONTEND.md) for components and hooks, and [`API-REFERENCE.md`](API-REFERENCE.md) for per-endpoint request/response schemas.
