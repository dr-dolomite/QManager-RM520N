# Discord Bot

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08; the connect retry and spool drain (2026-10-12) are not yet run on hardware
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> User-installed Discord bot that exposes modem status and control via slash commands, deployed as a systemd service on the RM520N-GL.

Source directory: `discord-bot/`, deployed as `/usr/bin/qmanager_discord`.

---

## Overview & build

- **Type**: User-installed Discord bot (OAuth2 `integration_type=1`, scope `applications.commands` only — no `bot` scope, no shared guild required). Runs as a systemd service (`qmanager-discord.service`).
- **It is a pure DM transport for alerts.** The daemon no longer decides *when* to
  notify: `alert_engine.sh` owns the downtime timer, the capability matrix and the
  routing table, and the bot only sends what it is handed. Its former autonomous
  Go-side timer was one of the three clocks that consolidation removed — see
  [alerts.md](alerts.md). Slash commands are unaffected.
- **Binary is UPX-LZMA compressed**: `build-discord-bot.sh` runs `upx --lzma --best` after the Go build, cutting the binary from ~7.1 MB to ~2.0 MB (-72%). Validated on RM520N-GL hardware: slash commands, AT-command path (`/lock-band`, `/network-mode`), and DM notifications all work; clean stop/start/reboot cycles produce no segfaults. **This is the opposite of the retired `atcli_smd11`**, whose Rust build segfaulted on exit when UPX-packed; the Go runtime does not. Set `UPX_COMPRESS=0` to skip compression for debugging (uncompressed binaries are easier to inspect with `strings`/`objdump`). Build silently falls back to uncompressed if `upx` isn't on PATH, with a warning.

---

## Lifecycle and restart behaviour

`qmanager-discord.service` is `Type=simple`, `Restart=on-failure`, `RestartSec=10s`, with `StartLimitBurst=5` / `StartLimitIntervalSec=3600` in `[Unit]`. `main()` runs in this order:

1. Load `/etc/qmanager/discord_bot.json`. `enabled: false` exits 0; an empty `owner_discord_id` is fatal.
2. Read the token from the root-only secret file. Missing → status `missing_token`, fatal.
3. Write status `starting`, then `connectWithRetry` (`session.go`).
4. After the first connect: register slash commands, resolve the DM channel, and start the spool drain (`runCmdWatcher`, `spool.go`), the test-DM watcher and the 30 s status writer.

**`connectWithRetry` never exits on a network failure.** Each attempt builds a fresh session and runs `s.Open()` in a goroutine. A failed open writes status `"error": "connecting"`, waits, and tries again: 10 s, doubling to a 300 s ceiling (`connectBackoffMin` / `connectBackoffMax`). SIGINT/SIGTERM during an attempt or a wait returns at once and the process exits 0, so `systemctl stop` is not held up by a dial timeout.

| Open result | Status `error` | Process |
|-------------|----------------|---------|
| Success | (cleared by the `Ready` handler, `connected: true`) | continues to step 4 |
| Gateway close **4004** (token rejected, `isAuthFailure`) | `invalid_token` | `log.Fatalf` → exit 1 → systemd restarts it |
| Any other error (no route, DNS, TLS, timeout) | `connecting` | stays up, retries |
| Signal | `""` | exits 0 |

Why it matters: a failed `Open` used to be fatal. A boot without internet then exited every 10 s and hit the start limit in about 50 s, and the bot stayed down for the hour. Now the process stays running through the outage, so it uses no start attempts and connects on its own when the link comes up. Only a bad token still burns through the limit; the Alerts save path clears it with `svc_reset_failed` before restarting ([alerts.md](alerts.md#post--dispatched-on-action)).

> ⚠️ WARNING: Do not make a non-4004 `Open` error fatal again, and do not treat 4004 as retryable. Retrying a rejected token every 300 s forever hides a configuration fault behind a status the page cannot show.

> ℹ️ NOTE: While the daemon is backing off, `pgrep` and `svc_is_running` both report it running, so `discord_dispatch_message` accepts alerts into the spool. They deliver after the first connect ([alerts.md → Spool directory](alerts.md#spool-directory-tmpqmanager_discord_spool)). Between attempts the status file is not rewritten, so it ages past the CGI's 90 s freshness limit and the page reads "not connected".

discordgo reconnects a dropped gateway by itself after the first connect; `connectWithRetry` covers only the first one.

---

## Owner-only authorization

Every interaction (slash commands **and** button clicks) passes one gate in the `InteractionCreate` handler in `main.go`: `isOwner(i, cfg.OwnerDiscordID)` in `handlers.go`, which reads `i.User` (DM) or `i.Member.User` (guild) and fails closed on an empty ID. Non-owners get a private "only responds to its owner" reply plus a `[interaction] rejected non-owner` log line, and no handler runs. Do not add a dispatch path that skips this gate.

- **Why it matters:** a button on a message can be clicked by anyone who can see that message (e.g. a group DM), and a Discord app marked **Public Bot** (the default for new apps) can be installed by anyone who knows its app ID, which is the same as the bot's user ID. Before this gate, either path could run `/reboot` → `AT+QPOWD=1`, `/lock-band` or `/network-mode`.
- **Owner setup advice:** turn **Public Bot** off in the Discord Developer Portal (Bot tab). The gate does not depend on it; turning it off just stops strangers installing the app.
- **`/network-mode` allowlist:** `networkModeOption` only accepts `AUTO`, `LTE`, `NR5G`, `NR5G:LTE` before building the AT command, rather than trusting Discord to enforce the choices.

---

## AT-command serialization

Slash commands that issue AT calls (`/lock-band`, `/network-mode`, `/reboot`) go through `runQcmd` → `/usr/bin/qcmd`, which uses the same `flock` `/run/qmanager_at/at.lock` everything else does. No special Discord-side coordination needed.

---

## Status cache reads

- The embed-driven slash commands (`/status`, `/signal`, `/bands`, `/device`, `/sim`, `/watchcat`) read `/tmp/qmanager_status.json` via `readStatus` in `cache.go`. `/events` reads `/tmp/qmanager_events.json`.
- The cache schema is the poller's flat shape, mapped through `pollerCache` → `ModemStatus` in `mapPollerToStatus`.
- **`stringOrNum` decoder**: `lte.cell_id` and `lte.tac` (and the NR equivalents) come from the modem as either quoted strings or bare numbers depending on AT response shape. The custom `stringOrNum` `UnmarshalJSON` in `cache.go` handles both — do NOT change those fields back to plain `string`.

---

## Interaction patterns (defer vs sync)

Discord's interaction window is 3 seconds; failing to respond within that window shows "The application did not respond" to the user.

- **Commands that do non-trivial work** (AT call, network round-trip, slow file scan) MUST defer first: `s.InteractionRespond(... Type: InteractionResponseDeferredChannelMessageWithSource)` then `InteractionResponseEdit`. Deferring buys you 15 minutes. `/lock-band`, `/network-mode`, `/reboot` use this pattern.
- **Commands that only read fast caches** and respond with an embed use the synchronous `respondEmbedWithButtons` path. Stays well under 3s on a healthy network.

### Network variability caveat

`InteractionResponseEdit` calls occasionally hit `context deadline exceeded` over the cellular link. The deferred command's actual work (e.g. `AT+QNWPREFCFG`) usually still executes — only the response edit fails — so users may see "did not respond" even though the action took effect. Worth keeping in mind when triaging "command didn't work" reports.

---

## Embed & button conventions

### Button emoji gotcha — `COMPONENT_INVALID_EMOJI`

Discord's API rejects the entire interaction response with `HTTP 400 / code 50035 / COMPONENT_INVALID_EMOJI` if any button's emoji name is not in its accepted Unicode emoji table. Dingbat-style symbols like `↻` (U+21BB) used to slip through and now don't. **Use `🔄`** for refresh actions, or stick to characters from the standard emoji set. The error is silent from the user's view — Discord just shows "The application did not respond" — so this is easy to miss without log inspection.

### Action-row composition

`buildActionRow(source)` in `embeds.go` builds the per-source button row. Refresh button is always first; nav/raw buttons depend on source. All button emojis must be valid Unicode emojis (see above). Centralize emoji choices here — don't inline new ones in handlers.

### Embed field label convention

Decorative emoji prefixes were stripped from field names in v0.1.7 polish. Keep emojis only where they encode information:
- Signal-quality color dots in description lines
- Per-port quality icons in `/signal`
- Carrier-component tier markers (`🔵🟣🟢🟠 = PCC/SCC × LTE/NR`) in `/bands`
- Severity icons in `/events`
- One icon per button in action rows

Adding a decorative emoji to a field label is a regression.

### Column-gutter / vertical-padding pattern

`spacerField()` in `embeds.go` returns an invisible inline field (U+200B for `Name` and `Value`, `Inline: true`) used to widen Discord's column gutters. `/signal` inserts one after every 2 antennas to render a 2x2 grid with a visible right gutter. For vertical breathing between rows of inline fields, append `\n​` (newline + U+200B) to the field's `Value` — used in both antenna fields (`buildSignalEmbed`) and carrier-component fields (`ccField`). Discord rejects empty strings for `Name`/`Value`, so the zero-width space is required, not optional. When editing these format strings, preserve the U+200B bytes (UTF-8 `E2 80 8B`) — do not replace with regular spaces.

### `/lock-band` separator and normalization

User input uses commas (`B3,B7,B28` / `n41,n78`) — colons accepted for legacy. `parseBandOption` in `handlers.go` normalizes both via `strings.ReplaceAll(input, ":", ",")`, then numerically sorts via `sort.Ints` and dedups via `slices.Compact`, so the modem (and the `"B" + strings.ReplaceAll(parsed, ":", "/B")` display formatter in `handleLockBand`) always sees a canonical ascending colon-joined list with no duplicates regardless of input order. The AT command itself (`AT+QNWPREFCFG="lte_band",3:7:28`) still uses colons — that is the modem's wire format, not the user contract. All-invalid input collapses to `""`, but `handleLockBand` only unlocks (sends `0`) when `isAutoBandInput` sees a literal `auto`; junk input reports "no valid bands given, nothing changed" and sends no AT command.

---

## DM channel persistence

User-installed bots can't reliably resolve the owner DM channel cold (Discord error 50007 without a shared guild). The cached channel ID at `/etc/qmanager/discord_dm_channel` is captured opportunistically from inbound messages and from any slash-command interaction (`captureDMFromInteraction` in `handlers.go`). Once captured, `ChannelMessageSend` works without re-resolving.

---

## Logging & diagnostics

### Load-bearing log lines

- `[interaction] cmd=<name> id=<id>` fires for every received slash command.
- `[interaction] respond source=<x> elapsed=<dur> err=<v>` fires after every embed response.

These two log lines are load-bearing for debugging — leave them in unless replacing with structured logging.

### journald gap

`journalctl -u qmanager-discord` may return empty on this device even though the unit declares `StandardOutput=journal`. journald appears volatile and frequently has no captured entries. To capture diagnostic logs, stop the service and run the binary in foreground with stdout/stderr redirected to `/tmp/discord-debug.log`. (Diagnosing the journald gap itself is a separate cleanup item.)

---

## discordgo SDK limitations

**discordgo v0.28.1**: `IntegrationTypes` and `Contexts` fields on `ApplicationCommand` are not exposed by this SDK version. Commands are registered without those fields and rely on Discord's per-application defaults. Do not assume the SDK will refuse a malformed command — it won't; Discord's API will. If a registered command stops appearing, query `https://discord.com/api/v10/applications/<app_id>/commands` directly to inspect what was actually accepted.

---

## Source layout

| File | Purpose |
|------|---------|
| `main.go` | Boot + handler registration |
| `session.go` | `connectWithRetry` (first-connect backoff), session construction, DM channel open |
| `spool.go` | Spool drain (`runCmdWatcher`) and the NDJSON result log (`appendDiscordLog`) |
| `config.go` | Config load, token read, status file writer, path constants |
| `handlers.go` | Slash-command dispatch + per-command handlers + response helpers |
| `commands.go` | Slash-command catalog |
| `cache.go` | Status/events readers + `ModemStatus` shape |
| `embeds.go` | Chrome helpers, action-row builder, button-expiry scheduler |
| `dm_channel.go` | DM channel cache I/O |
| `notify.go` | Background notifier |
