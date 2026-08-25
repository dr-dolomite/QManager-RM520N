# Discord Bot Feature Design
**Date:** 2026-05-06
**Status:** Approved

## Overview

A personal Discord bot that runs directly on the RM520N-GL modem as a systemd service. Each user brings their own Discord bot token and interacts with the bot entirely via DMs — no Discord server required. The bot supports slash commands for querying modem state and issuing set operations, plus automated connectivity notifications.

---

## Architecture

### Components

| Component | Path | Purpose |
|---|---|---|
| `qmanager_discord` | `/usr/bin/qmanager_discord` | Go static binary bot daemon |
| `qmanager-discord.service` | `/lib/systemd/system/` | systemd unit (Restart=on-failure) |
| `discord_bot.json` | `/etc/qmanager/` | Config (token, owner ID, threshold) |
| `discord_alerts.sh` | `/usr/lib/qmanager/` | Thin shell lib for CGI test sends |
| CGI endpoints | `monitoring/discord_bot/` | configure, status, test, alert log |
| Web UI card | Monitoring settings page | Setup wizard + live status |

### Dependencies

- Static ARMv7l Go binary (~6–8 MB), cross-compiled in dev environment using `discordgo` library
- Bundled in QManager tarball — same pattern as `atcli_smd11`
- Zero on-device build step; zero Entware packages required for the bot itself

**Rationale:** The RM520N-GL's persistent partition (`/dev/ubi2_0`) has 60.4 MB free across `/usrdata`, `/etc`, `/opt`, and friends. Python3 from Entware would consume 20–30 MB of that. Available RAM is ~46 MB; Python3 at idle uses 15–25 MB. The Go binary costs ~6–8 MB on disk and ~5–10 MB RAM — the only responsible choice for this platform.

### Data Flows

**Queries** (`/signal`, `/bands`, `/status`, `/events`):
User issues slash command in DMs → Discord gateway sends `INTERACTION_CREATE` over WebSocket to bot → bot reads `/tmp/qmanager_status.json` or `/tmp/qmanager_events.json` (written by existing poller, zero new AT commands) → formats Discord embed → responds via REST API.

**Set operations** (`/reboot`, `/lock-band`, `/network-mode`):
Same inbound flow → after interaction/confirmation → bot invokes `/usr/bin/qcmd` as a subprocess → captures AT response → reports result back in DM thread.

**Connectivity notifications:**
A background goroutine polls `/tmp/qmanager_status.json` every 10 seconds. Reads `conn_internet_available` field (same field used by email/SMS alert libs). Tracks downtime start time against a configurable threshold. On threshold exceeded → sends DM alert. On recovery → sends DM with downtime duration. No poller changes required.

**DM channel bootstrap:**
On startup, bot calls `POST /users/@me/channels` with the configured `owner_discord_id` to open the DM channel and caches the channel ID in memory. The user only provides their Discord user ID in the web UI — not a channel ID.

**Slash command registration:**
At startup, bot calls `PUT /applications/{app_id}/commands` to register all slash commands globally. Discord caches these — no re-registration needed on normal restarts unless the command set changes.

---

## Command Set

### Read Commands (query poller cache, instant response)

| Command | Response Content |
|---|---|
| `/signal` | RSRP, RSRQ, SINR, RSSI per antenna port (Main/Diversity/MIMO3/MIMO4). Embed color reflects overall signal quality. |
| `/bands` | Active technology (LTE / NR / EN-DC), locked or auto bands, CA component list with per-component bandwidth, total aggregated bandwidth. |
| `/status` | Internet up/down + latency, modem reachability, network operator, WAN IP, SIM slot, uptime, CPU temperature. |
| `/events` | Last 5 entries from `/tmp/qmanager_events.json` formatted as a list with timestamps and severity icons (info / warning / critical). |

### Set Commands

| Command | Options | Behavior |
|---|---|---|
| `/reboot` | — | Replies with embed + **Confirm** / **Cancel** buttons. Confirm executes `qcmd AT+QPOWD=1`. Buttons expire after 30s. |
| `/lock-band` | `lte_bands` (e.g. `B3,B28`), `nr_bands` (e.g. `n78`), or `auto` to unlock all | Executes immediately via `AT+QNWPREFCFG="lte_band"` + `AT+QNWPREFCFG="nr5g_band"`. Reports confirmed locked bands in response. |
| `/network-mode` | Choice: `auto` / `lte-only` / `nr-only` / `nr-preferred` | Executes immediately via `AT+QNWPREFCFG="mode_pref"`. Reports new active mode. |

### Notification DMs (bot-initiated)

| Trigger | Message |
|---|---|
| Internet down ≥ threshold | "Connection lost — [modem unreachable / internet down]. Started at HH:MM." |
| Internet restored | "Connection restored after X minutes Y seconds." |

Threshold default: 5 minutes. Same dedup logic as `email_alerts.sh` — recovery DM always sent; downtime DM only after threshold is crossed. Alerts queued in memory if Discord is unreachable and flushed on reconnect.

---

## Configuration

### Config File — `/etc/qmanager/discord_bot.json`

```json
{
  "enabled": true,
  "bot_token": "...",
  "owner_discord_id": "123456789012345678",
  "threshold_minutes": 5
}
```

Three user-supplied fields. DM channel ID is resolved at runtime from `owner_discord_id` and never persisted.

### Runtime Status — `/tmp/qmanager_discord_status.json`

Written by the bot daemon. Read by the web UI card to show live connection state.

```json
{
  "connected": true,
  "last_seen": 1746518400,
  "latency_ms": 42,
  "error": null
}
```

### Reload Flag — `/tmp/qmanager_discord_reload`

Touched by CGI on config save. Bot detects on next 10s poll cycle and re-reads config without restarting. Same pattern as `email_alerts.sh` and `sms_alerts.sh`.

---

## Setup Flow (Web UI)

The Discord Bot card lives in the monitoring settings page alongside the email and SMS alert cards. First-time state shows a step-by-step setup wizard:

1. **Step 1** — Link to Discord Developer Portal with inline instructions: create Application → create Bot → copy token.
2. **Step 2** — Paste bot token into QManager (stored as `/etc/qmanager/discord_bot.json`).
3. **Step 3** — QManager generates the "Add App" OAuth2 URL. User clicks it, adds the bot to their Discord account (no server required).
4. **Step 4** — Paste their Discord user ID. QManager shows how to get it: Settings → Advanced → enable Developer Mode → right-click avatar → Copy User ID.
5. Click **Install & Enable** → CGI triggers installer which:
   - Copies `qmanager_discord` binary from the tarball to `/usr/bin/` (already bundled, no download needed)
   - Writes config atomically (`.tmp` + `mv`)
   - Enables and starts `qmanager-discord.service` via direct symlink into `multi-user.target.wants/`
   - Bot registers slash commands with Discord on first run

Card updates to **Connected** status badge once the bot's WebSocket handshake succeeds and the status file reflects `connected: true`.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Discord unreachable (internet down) | Exponential backoff reconnect: 1s → 2s → 4s → max 60s. Pending notification DMs queued in memory, flushed on reconnect. |
| Bot process crash | systemd `Restart=on-failure` + `RestartSec=10`. Missed notifications during gap not replayed (matches email/SMS behavior). |
| `qcmd` subprocess failure | Set command responds with error embed showing AT response or failure reason. `/reboot` button disabled after one attempt. |
| Slash command response > 3s | Bot sends immediate deferred acknowledgment (Discord shows loading state), follows up with result once `qcmd` returns. No timeout failures for slow AT commands. |
| Invalid bot token | Auth failure at startup. Status file: `{"connected": false, "error": "invalid_token"}`. Web UI shows destructive badge "Invalid token — reconfigure." |
| Owner user ID not found | Bot logs error, disables notifications, continues handling slash commands. Web UI shows warning badge. |
| Poller cache stale (>30s) | Slash command responses append "⚠ Data may be stale" to the embed. |

---

## File Inventory

**New binaries:**
- `bin/qmanager_discord` — Go static binary (ARMv7l, cross-compiled with `discordgo`; source in `discord-bot/`)

**New scripts:**
- `scripts/usr/lib/qmanager/discord_alerts.sh` — shell lib for CGI test sends
- `scripts/etc/systemd/system/qmanager-discord.service` — systemd unit
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/configure.sh`
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/status.sh`
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/test.sh`
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/alert_log.sh`

**New frontend:**
- `src/hooks/use-discord-bot.ts` — React Query hook for bot config/status
- `src/types/discord-bot.ts` — TypeScript types
- `src/components/monitoring/discord-bot-card.tsx` — Settings + setup wizard card

**Modified:**
- `scripts/usr/bin/qmanager_update` — add `qmanager_discord` to cleanup/enable list
- Installer — copy `qmanager_discord` binary to `/usr/bin/`, register systemd unit (non-fatal if binary missing from tarball)
