# QManager API Reference

Complete reference for all CGI endpoints. All endpoints are under `/cgi-bin/quecmanager/`.

All authenticated endpoints require a valid `qm_session` cookie (auto-sent by the browser). A `401` response means the session is expired or missing.

---

## Response Format

All endpoints return JSON with a consistent structure:

```json
// Success
{ "success": true, ... }

// Error
{ "success": false, "error": "error_code", "detail": "Human-readable message" }
```

---

## Platform Notes

### RM520N-GL Variant

On the RM520N-GL, CGI endpoints are served by lighttpd instead of uhttpd, and AT commands go through `atcli_smd11` on `/dev/smd11` directly via the `qcmd` wrapper — no socat PTY bridge. The API contract (request/response format) is the same across platforms.

Key differences:
- **Base URL**: Same (`/cgi-bin/quecmanager/`), served from `/usrdata/qmanager/www/cgi-bin/quecmanager/`
- **Auth**: Same cookie-based session mechanism
- **AT execution**: `qcmd` wrapping `atcli_smd11` on `/dev/smd11`
- **Config**: File-based (`/etc/qmanager/`) instead of UCI

---

## Authentication

### GET `/auth/check.sh`

Check if first-time setup is required and rate limit status.

**Response:**
```json
{
  "setup_required": true,
  "rate_limited": false,
  "retry_after": 0
}
```

### POST `/auth/login.sh`

Login or first-time password setup.

**Login Request:**
```json
{ "password": "user_password" }
```

**Setup Request (first-time):**
```json
{ "password": "new_password", "confirm": "new_password" }
```

**Success Response:**
```json
{ "success": true }
```
Sets `qm_session` (HttpOnly) and `qm_logged_in=1` cookies.

**Error Response:**
```json
{
  "success": false,
  "error": "invalid_password",
  "detail": "Invalid password",
  "retry_after": 30
}
```

### POST `/auth/logout.sh`

Destroy current session.

**Response:**
```json
{ "success": true }
```
Clears session cookies.

### POST `/auth/password.sh`

Change password. Requires authentication.

**Request:**
```json
{
  "current_password": "old_password",
  "new_password": "new_password"
}
```

**Response:**
```json
{ "success": true }
```
Destroys all sessions (forces re-login).

---

## Modem Data

### GET `/at_cmd/fetch_data.sh`

Main polling endpoint. Returns the cached modem status JSON (built by `qmanager_poller`).

**Response:** Full `ModemStatus` object (see `types/modem-status.ts`)

```json
{
  "timestamp": 1710700000,
  "system_state": "normal",
  "modem_reachable": true,
  "last_successful_poll": 1710700000,
  "errors": [],
  "network": {
    "type": "5G-NSA",
    "sim_slot": 1,
    "carrier": "T-Mobile",
    "service_status": "optimal",
    "ca_active": true,
    "ca_count": 2,
    "nr_ca_active": false,
    "nr_ca_count": 0,
    "total_bandwidth_mhz": 135,
    "bandwidth_details": "B66: 20 MHz + B2: 15 MHz + N41: 100 MHz",
    "apn": "fast.t-mobile.com",
    "wan_ipv4": "10.0.0.1",
    "wan_ipv6": "",
    "primary_dns": "8.8.8.8",
    "secondary_dns": "8.8.4.4",
    "carrier_components": [...]
  },
  "lte": {
    "state": "connected",
    "band": "B66",
    "earfcn": 66486,
    "bandwidth": 20,
    "pci": 123,
    "cell_id": 12345678,
    "enodeb_id": 48225,
    "sector_id": 78,
    "tac": 12345,
    "rsrp": -95,
    "rsrq": -11,
    "sinr": 15,
    "rssi": -65,
    "ta": 3
  },
  "nr": {
    "state": "connected",
    "band": "N41",
    "arfcn": 520110,
    "pci": 456,
    "rsrp": -100,
    "rsrq": -12,
    "sinr": 18,
    "scs": 30,
    "ta": null
  },
  "device": {
    "temperature": 45,
    "cpu_usage": 12,
    "memory_used_mb": 85,
    "memory_total_mb": 256,
    "uptime_seconds": 86400,
    "conn_uptime_seconds": 43200,
    "firmware": "RM520NGLAAR03A04M4GA",
    "build_date": "Jun 25 2025",
    "manufacturer": "Quectel",
    "model": "RM520N-GL",
    "imei": "123456789012345",
    "imsi": "310260123456789",
    "iccid": "89012345678901234567",
    "phone_number": "+15551234567",
    "lte_category": "20",
    "mimo": "LTE 1x4 | NR 2x4",
    "supported_lte_bands": "B1:B2:B3:B5:B7:...",
    "supported_nsa_nr5g_bands": "N41:N71:N77:...",
    "supported_sa_nr5g_bands": "N41:N71:N77:..."
  },
  "traffic": {
    "rx_bytes_per_sec": 1562500,
    "tx_bytes_per_sec": 125000,
    "total_rx_bytes": 1073741824,
    "total_tx_bytes": 134217728
  },
  "connectivity": {
    "internet_available": true,
    "status": "connected",
    "latency_ms": 34.2,
    "avg_latency_ms": 38.5,
    "min_latency_ms": 22.1,
    "max_latency_ms": 89.3,
    "jitter_ms": 4.8,
    "packet_loss_pct": 0,
    "ping_target": "8.8.8.8",
    "latency_history": [34.2, 36.1, 38.0, ...],
    "history_interval_sec": 5,
    "history_size": 60,
    "during_recovery": false
  },
  "signal_per_antenna": {
    "lte_rsrp": [-95, -97, -102, null],
    "lte_rsrq": [-11, -12, -13, null],
    "lte_sinr": [15, 14, 12, null],
    "nr_rsrp": [-100, -103, null, null],
    "nr_rsrq": [-12, -13, null, null],
    "nr_sinr": [18, 16, null, null]
  },
  "watchcat": {
    "enabled": true,
    "state": "monitor",
    "current_tier": 0,
    "failure_count": 0,
    "last_recovery_time": null,
    "last_recovery_tier": null,
    "total_recoveries": 0,
    "cooldown_remaining": 0,
    "reboots_this_hour": 0
  },
  "sim_failover": {
    "active": false,
    "original_slot": null,
    "current_slot": null,
    "switched_at": null
  },
  "sim_swap": {
    "detected": false,
    "matching_profile_id": null,
    "matching_profile_name": null
  }
}
```

### GET `/at_cmd/fetch_events.sh`

Returns network events as a JSON array.

**Response:**
```json
[
  {
    "timestamp": 1710700000,
    "type": "band_change",
    "message": "LTE band changed from B2 to B66",
    "severity": "info"
  }
]
```

### GET `/at_cmd/fetch_signal_history.sh`

Returns signal history entries as a JSON array.

**Response:**
```json
[
  {
    "ts": 1710700000,
    "lte_rsrp": [-95, -97, -102, null],
    "lte_rsrq": [-11, -12, -13, null],
    "lte_sinr": [15, 14, 12, null],
    "nr_rsrp": [-100, -103, null, null],
    "nr_rsrq": [-12, -13, null, null],
    "nr_sinr": [18, 16, null, null]
  }
]
```

### GET `/at_cmd/fetch_ping_history.sh`

Returns ping history entries as a JSON array.

**Response:**
```json
[
  {
    "ts": 1710700000,
    "lat": 34.2,
    "avg": 38.5,
    "min": 22.1,
    "max": 89.3,
    "loss": 0,
    "jit": 4.8
  }
]
```

### POST `/at_cmd/send_command.sh`

Execute a raw AT command.

**Request:**
```json
{ "command": "AT+QENG=\"servingcell\"" }
```

**Response:**
```json
{ "success": true, "response": "+QENG: \"servingcell\",..." }
```

### POST `/at_cmd/cell_scan_start.sh`

Start the cell scanner daemon.

**Response:**
```json
{ "success": true }
```

### GET `/at_cmd/cell_scan_status.sh`

Get cell scan results.

**Response:**
```json
{
  "success": true,
  "status": "complete",
  "cells": [...]
}
```

### POST `/at_cmd/neighbour_scan_start.sh` / GET `neighbour_scan_status.sh`

Same pattern as cell scanner for neighbor cells.

### POST `/at_cmd/speedtest_start.sh` / GET `speedtest_status.sh` / GET `speedtest_check.sh`

Start speed test, check results, and check if speedtest binary is available.

---

## Cellular Settings

### GET/POST `/cellular/settings.sh`

**GET Response:**
```json
{
  "success": true,
  "mode_pref": "AUTO",
  "nr5g_disable_mode": 0,
  "roam_pref": 255,
  "sim_slot": 1,
  "ambr_dl": "1000",
  "ambr_ul": "500"
}
```

**POST Request:**
```json
{
  "mode_pref": "NR5G",
  "nr5g_disable_mode": 0,
  "roam_pref": 1,
  "sim_slot": 1
}
```

### GET/POST `/cellular/apn.sh`

WAN Profile Management. AT-only on the RM520N-GL — every field is sourced from
AT commands through `qcmd`; there is no Casa RDB or wmmd daemon. The endpoint
exposes 6 WAN profile slots, one per PDP context CID (1-6). See
`docs/reference/wan-profile-management.md` for the full subsystem reference.

**GET (list all 6 slots):**

Iterates CIDs 1-6 and builds each slot from `AT+CGDCONT?` (APN, PDP type),
`AT+CGACT?` (activation state), `AT+QICSGP=<cid>` (auth type, username, password
presence), and — for active contexts only — `AT+CGCONTRDP=<cid>` (IP, gateway,
DNS). Profile names come from a sidecar file. Undefined CIDs (usually 4-6) are
emitted as empty slots.

```json
{
  "success": true,
  "max_profiles": 6,
  "data_source": "at",
  "profiles": [
    {
      "index": 1,
      "name": "T-Mobile",
      "apn": "fast.t-mobile.com",
      "pdp_type": "ipv4v6",
      "auth_type": "none",
      "username": "",
      "has_password": false,
      "mtu": null,
      "enabled": true,
      "default_route": false,
      "ip_passthrough": false,
      "modem_profile": 1,
      "apn_type": "",
      "vlan_index": "",
      "status_ipv4": "up",
      "status_ipv6": "",
      "connect_progress": "connected",
      "ipv4_address": "10.0.0.1",
      "ipv4_gateway": "10.0.0.2",
      "dns1": "8.8.8.8",
      "dns2": "8.8.4.4",
      "ipv6_address": "",
      "mtu_negotiated": null,
      "interface": "",
      "pdp_error": ""
    }
  ]
}
```

- `data_source`: always `"at"` on this modem. The field exists so the frontend can hide wmmd/Casa-only controls (Default Route, IP Passthrough, VLAN mapping).
- `pdp_type`: `"ipv4"` | `"ipv6"` | `"ipv4v6"` (AT `IP`/`IPV6`/`IPV4V6` mapped to lowercase).
- `auth_type`: `"none"` | `"pap"` | `"chap"`.
- `has_password`: `true` when a PDP password is stored. The password itself is **never** emitted.
- `enabled`: PDP context activation state from `AT+CGACT?` (state `1` = active).
- `apn_type`: `"ims"` or `"emergency"` for the carrier's IMS (VoLTE) and SOS contexts (usually CIDs 2/3) — the UI locks those slots read-only. Empty for normal data profiles.
- `mtu` / `mtu_negotiated`: always `null`. RM520N-GL AT has no reliable per-context MTU read or write, and `AT+CGCONTRDP` on this firmware returns no MTU field.
- `connect_progress`: `"connected"` (has an IP) | `"connecting"` (enabled, no IP yet) | `"disconnected"`.

**POST `save` (write a profile):**

```json
{
  "action": "save",
  "index": 1,
  "name": "T-Mobile",
  "apn": "fast.t-mobile.com",
  "pdp_type": "ipv4v6",
  "auth_type": "none",
  "username": "",
  "password": ""
}
```

Detaches the radio with `AT+COPS=2`, writes APN + PDP type via `AT+CGDCONT`,
writes auth via `AT+QICSGP` (`AT+CGAUTH` is unsupported on RM520N-GL
firmware), persists `name` to the sidecar, then re-attaches with `AT+COPS=0`
so the modem sends a fresh Attach Request carrying the new APN. The full
attach cycle is required because the default EPS bearer's APN is a contract
field set at attach time — `AT+CGACT` alone cannot change it. The cellular
WAN drops briefly (~5-10s) during the cycle; SSH and the CGI HTTP path are
on LAN/Wi-Fi and are not affected. See
`docs/reference/wan-profile-management.md` for the full rationale.

- `index`: required, 1-6 (the PDP context CID).
- `apn`: required. `apn`/`username`/`password` may not contain a double-quote.
- `pdp_type`: required, one of `ipv4` / `ipv6` / `ipv4v6`.
- `auth_type`: `none` (default) / `pap` / `chap`. With `none`, stored credentials are cleared.
- `password`: optional. A blank password on a PAP/CHAP save **keeps** the existing stored secret.
- `mtu`: optional. A non-default MTU is logged and ignored (no per-context MTU write exists). It is never reported as a successful write.

**POST `toggle` (activate/deactivate a context):**

```json
{
  "action": "toggle",
  "index": 1,
  "enabled": false
}
```

Activates (`true`) or deactivates (`false`) one PDP context via `AT+CGACT`.

**Error codes:**

| Code | Meaning |
|------|---------|
| `invalid_index` | `index` missing or not 1-6 |
| `invalid_action` | `action` not `save` or `toggle` |
| `missing_fields` | Required field absent (`apn` for save, `enabled` for toggle) |
| `invalid_pdp_type` | `pdp_type` not `ipv4`/`ipv6`/`ipv4v6` |
| `invalid_value` | APN/username/password contains a double-quote |
| `cops_detach_failed` / `cgdcont_failed` / `qicsgp_failed` / `cops_attach_failed` / `cgact_failed` | The underlying AT command failed. On `cgdcont_failed` / `qicsgp_failed` during save, `apn.sh` runs a best-effort `AT+COPS=0` so the modem does not stay detached |
| `parse_failed` | GET could not assemble the profile list |

### GET/POST `/cellular/mbn.sh`

**GET Response:**
```json
{
  "success": true,
  "profiles": [
    { "name": "Commercial-TMO", "active": true }
  ],
  "auto_sel": true
}
```

**POST Actions:** `"apply_profile"`, `"auto_sel"`, `"reboot"`

### GET/POST `/cellular/imei.sh`

**GET Response:**
```json
{
  "success": true,
  "imei": "123456789012345",
  "backup": { "enabled": true, "imei": "123456789012345" }
}
```

**POST Actions:** `"set_imei"`, `"save_backup"`, `"reboot"`

### GET/POST `/cellular/network_priority.sh`

**GET Response:**
```json
{
  "success": true,
  "mode_pref": "AUTO",
  "nr5g_disable_mode": 0
}
```

### GET/POST `/cellular/fplmn.sh`

**GET Response:**
```json
{
  "success": true,
  "has_entries": true
}
```

**POST Request:**
```json
{ "action": "clear" }
```

### GET/POST `/cellular/sms.sh`

SMS inbox and send functionality.

---

## Band Locking

### GET `/bands/current.sh`

Current locked band configuration.

### GET/POST `/bands/lock.sh`

**POST Request:**
```json
{
  "lte_bands": "B2:B66",
  "nr_bands": "N41:N71"
}
```

### GET `/bands/failover_status.sh`

Band failover daemon status.

### POST `/bands/failover_toggle.sh`

Enable/disable band failover automation.

---

## Frequency Locking

### GET/POST `/frequency/lock.sh`

**POST Request:**
```json
{
  "earfcn": 66486,
  "pci": 123
}
```

### GET `/frequency/status.sh`

Current frequency lock state.

---

## Tower Locking

### GET/POST `/tower/lock.sh`

**POST Request:**
```json
{
  "lte_pci": 123,
  "nr_pci": 456,
  "lte_earfcn": 66486,
  "nr_arfcn": 520110
}
```

### GET `/tower/status.sh`

Current tower lock state.

### GET/POST `/tower/settings.sh`

Tower locking general settings.

### GET `/tower/failover_status.sh`

Tower failover daemon status.

### GET/POST `/tower/schedule.sh`

Scheduled tower lock changes (time-based).

---

## Network Settings

### GET/POST `/network/ethernet.sh`

**GET Response:**
```json
{
  "success": true,
  "operstate": "up",
  "speed": 1000,
  "duplex": "full",
  "autoneg": "on",
  "speed_limit": "auto"
}
```

**POST Request:**
```json
{ "speed_limit": "auto" }
```
Values: `"auto"`, `"10"`, `"100"`, `"1000"`

### GET/POST `/network/ttl.sh`

**GET Response:**
```json
{
  "success": true,
  "ttl": 65,
  "hl": 65,
  "autostart": true
}
```

**POST Request:**
```json
{ "ttl": 65, "hl": 65 }
```
`0` = disabled.

### GET/POST `/network/mtu.sh`

**GET Response:**
```json
{
  "success": true,
  "mtu": 1500,
  "active": true
}
```

**POST Request:**
```json
{ "mtu": 1500 }
```
`"disable"` POST to remove MTU override.

### GET/POST `/network/dns.sh`

Custom DNS override settings.

### GET/POST `/network/ip_passthrough.sh`

IP passthrough mode configuration.

---

## Custom Profiles

### GET `/profiles/list.sh`

```json
{
  "success": true,
  "profiles": [
    {
      "id": "abc123",
      "name": "T-Mobile Optimized",
      "active": true,
      "created_at": 1710700000
    }
  ]
}
```

### GET `/profiles/get.sh?id=abc123`

Full profile details including APN, TTL/HL, and optional IMEI.

### POST `/profiles/save.sh`

Create or update a profile.

**POST Request:**
```json
{
  "id": "p_1715000000_abc12",
  "name": "T-Mobile Gaming",
  "mno": "T-Mobile",
  "sim_iccid": "8901260...",
  "settings": {
    "apn": { "cid": 1, "name": "fast.t-mobile.com", "pdp_type": "IPV4V6" },
    "imei": "",
    "ttl": 65,
    "hl": 65,
    "scenario_id": "gaming"
  }
}
```

`scenario_id` is optional. Valid values: `""` (no binding), `balanced`, `gaming`, `streaming`, or a `custom-<timestamp>` ID that exists at `/etc/qmanager/scenarios/<id>.json`. The server validates against this enum and returns an `invalid_scenario_id` error otherwise.

### POST `/profiles/delete.sh`

```json
{ "id": "abc123" }
```

### POST `/profiles/apply.sh`

Start the 4-step async apply process (`apn` → `ttl_hl` → `scenario` → `imei`).

```json
{ "id": "abc123" }
```

### GET `/profiles/apply_status.sh`

```json
{
  "status": "applying",
  "profile_id": "p_1715000000_abc12",
  "profile_name": "T-Mobile Gaming",
  "started_at": 1715000000,
  "current_step": 3,
  "total_steps": 4,
  "steps": [
    { "name": "apn",      "status": "done",     "detail": "APN updated to fast.t-mobile.com" },
    { "name": "ttl_hl",   "status": "done",     "detail": "TTL/HL applied" },
    { "name": "scenario", "status": "running",  "detail": "Applying scenario: gaming..." },
    { "name": "imei",     "status": "pending",  "detail": "" }
  ],
  "requires_reboot": false,
  "error": null
}
```

Per-step `status` values: `pending`, `running`, `done`, `skipped`, `failed`. The top-level `status` is `applying` while in progress, then `complete` or `failed`. A dangling `scenario_id` produces a scenario step with status `skipped` and detail `"Scenario <id> no longer exists"`.

### POST `/profiles/deactivate.sh`

Deactivate the currently active profile.

### GET `/profiles/current_settings.sh`

Get current modem settings for pre-filling profile creation forms.

---

## Connection Scenarios

### GET `/scenarios/list.sh`

List all saved connection scenarios (preset templates).

### POST `/scenarios/save.sh`

Create or update a scenario.

### POST `/scenarios/delete.sh`

Delete a scenario.

### POST `/scenarios/activate.sh`

Activate a scenario. Applies network mode (`AT+QNWPREFCFG="mode_pref",...`) and, for custom scenarios, optional LTE / NSA-NR / SA-NR band locks.

**POST Request (built-in):**
```json
{ "id": "gaming" }
```

**POST Request (custom):**
```json
{
  "id": "custom-1715000000",
  "mode": "NR5G",
  "lte_bands": "1:3:28",
  "nsa_nr_bands": "",
  "sa_nr_bands": "78"
}
```
`mode` is required for `custom-*` IDs (valid: `AUTO`, `LTE`, `NR5G`, `LTE:NR5G`). Band fields are optional; values must contain only digits and colons.

**Error responses:**

| `error` value | Cause |
|---------------|-------|
| `profile_managed` | The active SIM profile binds a scenario via `settings.scenario_id`. The CGI does not touch the modem — the user must edit the profile to change scenarios. Defense-in-depth against stale frontends bypassing the UI gate. |
| `no_id` | Missing `id` field |
| `invalid_id` | Unknown scenario ID (not built-in, not a known custom) |
| `no_mode` | Custom scenario request missing `mode` |
| `invalid_mode` | `mode` not in `{AUTO, LTE, NR5G, LTE:NR5G}` |
| `invalid_bands` | Band field contains non-digit/non-colon characters |
| `modem_error` | `AT+QNWPREFCFG="mode_pref",...` failed |

### GET `/scenarios/active.sh`

Get the currently active scenario.

---

## Monitoring

### GET/POST `/monitoring/email_alerts.sh`

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "enabled": true,
    "sender_email": "alerts@gmail.com",
    "recipient_email": "admin@example.com",
    "app_password_set": true,
    "threshold_minutes": 5
  }
}
```

**POST (save settings):**
```json
{
  "action": "save_settings",
  "enabled": true,
  "sender_email": "alerts@gmail.com",
  "recipient_email": "admin@example.com",
  "app_password": "xxxx xxxx xxxx xxxx",
  "threshold_minutes": 5
}
```
`app_password` only sent when changed. Backend returns `app_password_set: boolean` (never the actual password).

**POST (send test):**
```json
{ "action": "send_test" }
```

### GET `/monitoring/email_alert_log.sh`

```json
{
  "success": true,
  "entries": [
    {
      "timestamp": 1710700000,
      "trigger": "downtime_recovery",
      "status": "sent",
      "recipient": "admin@example.com"
    }
  ],
  "total": 5
}
```

### GET/POST `/monitoring/watchdog.sh`

**GET Response:**
```json
{
  "success": true,
  "enabled": true,
  "state": "monitor",
  "config": {
    "check_interval": 10,
    "suspect_threshold": 3,
    "recovery_timeout": 60,
    "cooldown_period": 120,
    "max_tier": 4,
    "sim_failover_enabled": true,
    "reboot_enabled": true
  },
  "status": {
    "current_tier": 0,
    "failure_count": 0,
    "total_recoveries": 0,
    "reboots_this_hour": 0
  }
}
```

### GET/POST `/settings/ping_profile.sh`

Connectivity probe sensitivity and target configuration. Controls the `qmanager_ping` daemon's check interval, failure thresholds, and the two probe URLs.

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "profile": "regular",
    "target_1": "http://cp.cloudflare.com/",
    "target_2": "http://www.gstatic.com/generate_204"
  }
}
```

**POST (save_settings):**
```json
{
  "action": "save_settings",
  "profile": "regular",
  "target_1": "youtube.com",
  "target_2": "google.com"
}
```

- `profile`: one of `"aggressive"`, `"regular"`, `"relaxed"` — controls the sensitivity preset (check interval, streak thresholds) applied by `qmanager_ping`.
- `target_1`: primary probe URL. Probed on every tick.
- `target_2`: secondary probe URL. Only probed when `target_1` returns `Disconnected` (primary-then-fallback, not alternating).

**Validation rules for `target_1` / `target_2`:**
- Both fields are required on every `save_settings` POST.
- Each must be nonempty after whitespace trim, at most 256 characters, and contain only URL-safe characters (no shell metacharacters).
- Bare hostnames are accepted (`youtube.com` → daemon auto-prefixes `https://`); hostnames with paths are also accepted (`example.com/health` → `https://example.com/health`).
- `http://` and `https://` schemes are accepted. Other schemes (`ftp://`, `file://`, etc.) are rejected.

**Error codes:**

| Code | Meaning |
|------|---------|
| `invalid_target` | `target_1` or `target_2` failed validation (empty, too long, bad scheme, or disallowed characters) |
| `missing_field` | Required POST field absent |
| `invalid_profile` | `profile` value not in the accepted set |

---

## Device

### GET `/device/about.sh`

Device hardware and firmware information.

---

## System

### GET `/system/logs.sh`

System log output.

### GET/POST `/system/settings.sh`

System preferences, scheduled reboot, and low power mode.

**GET Response:**
```json
{
  "success": true,
  "settings": {
    "wan_guard_enabled": true,
    "temp_unit": "celsius",
    "distance_unit": "km",
    "timezone": "UTC0",
    "zonename": "UTC"
  },
  "scheduled_reboot": {
    "enabled": false,
    "time": "04:00",
    "days": [0, 1, 2, 3, 4, 5, 6]
  },
  "low_power": {
    "enabled": false,
    "start_time": "23:00",
    "end_time": "06:00",
    "days": [0, 1, 2, 3, 4, 5, 6]
  }
}
```

**POST (save_settings):**
```json
{
  "action": "save_settings",
  "wan_guard_enabled": true,
  "temp_unit": "celsius",
  "distance_unit": "km",
  "timezone": "EST5EDT,M3.2.0,M11.1.0",
  "zonename": "America/New_York"
}
```

- `temp_unit`: `"celsius"` or `"fahrenheit"`
- `distance_unit`: `"km"` or `"miles"`
- `wan_guard_enabled`: toggles init.d symlink (enable/disable)
- `timezone`/`zonename`: written to UCI `system.@system[0]`

**POST (save_scheduled_reboot):**

```json
{
  "action": "save_scheduled_reboot",
  "enabled": true,
  "time": "04:00",
  "days": [0, 1, 2, 3, 4, 5, 6]
}
```

- `days`: array of integers 0-6 (0=Sunday, 6=Saturday)
- Manages cron entries for `/usr/bin/qmanager_scheduled_reboot`
- Config persisted in UCI `quecmanager.settings.sched_reboot_*`

**POST (save_low_power):**

```json
{
  "action": "save_low_power",
  "enabled": true,
  "start_time": "23:00",
  "end_time": "06:00",
  "days": [0, 1, 2, 3, 4, 5, 6]
}
```

- Creates two cron entries: `enter` at start_time on selected days, `exit` at end_time on all 7 days
- Exit cron fires on all days to handle overnight windows (e.g., 23:00-06:00) — no-ops if flag absent
- Enables/disables `qmanager_low_power_check` init.d (boot-time window check)
- Disabling while active immediately triggers `qmanager_low_power exit` (restores CFUN=1)

### POST `/system/reboot.sh`

Triggers a device reboot. POST-only, no request body required.

**Response:**

```json
{ "success": true }
```

The HTTP response is flushed before the device reboots asynchronously. The connection will drop shortly after.

### GET `/system/update.sh`

Check current version, update availability, and update worker status.

**Response:**
```json
{
  "success": true,
  "current_version": "0.1.5",
  "latest_version": "0.1.6",
  "update_available": true,
  "status": "idle",
  "previous_install_failed": false,
  "pending_version": null
}
```

- `status`: one of `idle`, `checking`, `update_available`, `downloading`, `verifying`, `ready`, `installing`, `rebooting`, `error`
- `previous_install_failed`: `true` when `/etc/qmanager/VERSION.pending` exists after a reboot, indicating the last install did not finalize. The UI should offer rollback.
- `pending_version`: the version string from `VERSION.pending` when `previous_install_failed` is `true`, otherwise `null`

### POST `/system/update.sh`

Control the OTA update worker. All install/rollback actions invoke `/usr/bin/qmanager_update` via `sudo -n` so the worker runs as root.

**Check for updates:**
```json
{ "action": "check" }
```

**Download update:**
```json
{ "action": "download", "url": "https://github.com/.../qmanager-0.1.6.tar.gz" }
```

**Install (direct URL):**
```json
{ "action": "install", "url": "https://github.com/.../qmanager-0.1.6.tar.gz" }
```

**Install staged (already downloaded):**
```json
{ "action": "install_staged" }
```

**Rollback to previous version:**
```json
{ "action": "rollback" }
```

**Cancel:**
```json
{ "action": "cancel" }
```

During installation the worker tails `=== Step N/M: <label> ===` lines from `/tmp/qmanager_install.log` and mirrors them as `status: "installing", message: "<label>"` in the status JSON. Poll GET to track progress.

**Error response** (worker could not be started):
```json
{ "success": false, "error": "worker_error", "detail": "..." }
```

### GET `/system/modem-subsys.sh`

System Health telemetry consumed by the System Health card in System Settings. Read-only — POST returns 405.

**Implementation:** Thin reader over `/tmp/qmanager_status.json`. The poller refreshes the cache's top-level `system_health` block on every Tier 1 cycle (~2s); this CGI just `jq`-extracts and reshapes for backward-compat. Falls back to an all-null shape when the cache is missing or older than 30s. See `BACKEND.md` § `qmanager_poller` for source-of-truth details.

**Response:**
```json
{
  "state": "online",
  "state_raw": "ONLINE",
  "crash_count": 0,
  "coredump_present": false,
  "last_crash_at": null,
  "total_logged_crashes": 0,
  "uptime_seconds": 86400,
  "cpu": {
    "load_1m": 0.42,
    "core_count": 4,
    "usage_pct": 12,
    "freq_khz": 1804800,
    "max_freq_khz": 1804800
  },
  "memory": {
    "total_kb": 186880,
    "used_kb": 87040,
    "available_kb": 99840
  },
  "storage": {
    "mount": "/usrdata",
    "total_kb": 524288,
    "used_kb": 73728,
    "available_kb": 450560
  }
}
```

- `state`: normalized to `online` | `offline` | `crashed` | `unknown`. `state_raw` is the unmodified sysfs string.
- `crash_count`: monotonic counter from `/sys/.../subsys0/crash_count`. `null` when the path is unreadable.
- `coredump_present`: `true` when a non-empty file exists under `/sys/.../ramdump/ramdump_modem/` (sysfs metadata pseudo-files excluded).
- `last_crash_at` / `total_logged_crashes`: derived from `/etc/qmanager/modem_crashes.json`.
- `cpu.usage_pct`: percent of total core capacity (`(load / cores) * 100`-style aggregate computed in the poller from `/proc/stat`); not the raw 1-minute load average.
- `cpu.freq_khz` / `cpu.max_freq_khz`: from `/sys/devices/system/cpu/cpu0/cpufreq/`.
- `memory`: derived from the existing `device.memory_*_mb` cache fields (× 1024).
- `storage`: `df -P /usrdata`. The `mount` field is fixed at `/usrdata`.

**Degraded response** (cache missing or stale):
```json
{
  "state": "unknown",
  "state_raw": null,
  "crash_count": null,
  "coredump_present": false,
  "last_crash_at": null,
  "total_logged_crashes": 0,
  "uptime_seconds": 0,
  "cpu": null,
  "memory": null,
  "storage": null
}
```

The frontend hook (`hooks/use-modem-subsys.ts`) treats `null` fields the same as missing — UI shows em-dashes, never blanks out. Polled every 2000ms with an in-flight guard matching the poller's Tier 1 cadence.

---

## DPI Settings

The DPI Settings page manages two features through a single CGI endpoint: **Video Optimizer** (SNI splitting for video throttle bypass) and **Traffic Masquerade** (fake TLS ClientHello with spoofed SNI). Both share the nfqws binary and kernel module but run as separate nfqws instances on different NFQUEUE numbers.

### GET `/network/video_optimizer.sh`

Read video optimizer settings and service status.

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "status": "running",
  "uptime": "2h 34m",
  "packets_processed": 48291,
  "domains_loaded": 22,
  "binary_installed": true,
  "kernel_module_loaded": true
}
```

Status values: `running`, `stopped`, `restarting`, `error`

### GET `/network/video_optimizer.sh?section=masquerade`

Read traffic masquerade settings and service status.

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "status": "running",
  "uptime": "1h 12m",
  "packets_processed": 15320,
  "sni_domain": "speedtest.net",
  "binary_installed": true,
  "kernel_module_loaded": true
}
```

Status values: `running`, `stopped`

### GET `/network/video_optimizer.sh?action=verify_status`

Poll verification test progress/results.

**Response (running):**
```json
{"success": true, "status": "running"}
```

**Response (complete):**
```json
{
  "success": true,
  "status": "complete",
  "timestamp": "2026-03-24T14:30:00Z",
  "without_bypass": {"speed_mbps": 2.4, "throttled": true},
  "with_bypass": {"speed_mbps": 47.2, "throttled": false},
  "improvement": "19.7x"
}
```

### GET `/network/video_optimizer.sh?action=install_status`

Poll nfqws installation progress/results.

**Response (idle — no install started):**
```json
{"success": true, "status": "idle"}
```

**Response (running):**
```json
{"success": false, "status": "running", "message": "Downloading zapret v69...", "detail": ""}
```

**Response (complete):**
```json
{"success": true, "status": "complete", "message": "nfqws installed successfully", "detail": "v69"}
```

**Response (error):**
```json
{"success": false, "status": "error", "message": "Binary not found in archive", "detail": "No nfqws for linux-arm64 in tarball"}
```

### POST `/network/video_optimizer.sh`

**Save video optimizer settings:**
```json
{"action": "save", "enabled": true}
```

**Save traffic masquerade settings:**
```json
{"action": "save_masquerade", "enabled": true, "sni_domain": "speedtest.net"}
```

- `enabled` (boolean, required): Enable or disable traffic masquerade.
- `sni_domain` (string, optional): Domain to spoof in fake TLS ClientHello. Must contain at least one dot, max 253 characters. Defaults to `speedtest.net` if not provided.

Saving masquerade settings restarts the entire `qmanager_dpi` service (both instances) to apply changes.

**Start verification:**
```json
{"action": "verify"}
```

**Install nfqws binary** (downloads from zapret GitHub releases):
```json
{"action": "install"}
```

Returns `{"success": true, "status": "started"}` if the installer was spawned, or `{"success": true, "status": "running"}` if an install is already in progress. Poll `?action=install_status` for progress.

---

## VPN

### GET/POST `/vpn/tailscale.sh`

Tailscale VPN status and configuration.
