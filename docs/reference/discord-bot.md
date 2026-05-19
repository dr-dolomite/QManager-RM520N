# Discord Bot

> User-installed Discord bot that exposes modem status and control via slash commands, deployed as a systemd service on the RM520N-GL.

Source directory: `discord-bot/`, deployed as `/usr/bin/qmanager_discord`.

---

## Overview & build

- **Type**: User-installed Discord bot (OAuth2 `integration_type=1`, scope `applications.commands` only — no `bot` scope, no shared guild required). Runs as a systemd service (`qmanager-discord.service`).
- **Binary is UPX-LZMA compressed**: `build-discord-bot.sh` runs `upx --lzma --best` after the Go build, cutting the binary from ~7.1 MB to ~2.0 MB (-72%). Validated on RM520N-GL hardware: slash commands, AT-command path (`/lock-band`, `/network-mode`), and DM notifications all work; clean stop/start/reboot cycles produce no segfaults. **This is the opposite of the `atcli_smd11` rule** — the Rust binary segfaults on exit when UPX-packed; the Go runtime does not. Set `UPX_COMPRESS=0` to skip compression for debugging (uncompressed binaries are easier to inspect with `strings`/`objdump`). Build silently falls back to uncompressed if `upx` isn't on PATH, with a warning.

---

## AT-command serialization

Slash commands that issue AT calls (`/lock-band`, `/network-mode`, `/reboot`) go through `runQcmd` → `/usr/bin/qcmd`, which uses the same `flock` `/tmp/qmanager_at.lock` everything else does. No special Discord-side coordination needed.

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

User input uses commas (`B3,B7,B28` / `n41,n78`) — colons accepted for legacy. `parseBandOption` in `handlers.go` normalizes both via `strings.ReplaceAll(input, ":", ",")`, then numerically sorts via `sort.Ints` and dedups via `slices.Compact`, so the modem (and the `"B" + strings.ReplaceAll(parsed, ":", "/B")` display formatter in `handleLockBand`) always sees a canonical ascending colon-joined list with no duplicates regardless of input order. The AT command itself (`AT+QNWPREFCFG="lte_band",3:7:28`) still uses colons — that is the modem's wire format, not the user contract. All-invalid input collapses to `""`, which the caller treats the same as `auto` (sends `0` = unlock).

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
| `handlers.go` | Slash-command dispatch + per-command handlers + response helpers |
| `commands.go` | Slash-command catalog |
| `cache.go` | Status/events readers + `ModemStatus` shape |
| `embeds.go` | Chrome helpers, action-row builder, button-expiry scheduler |
| `dm_channel.go` | DM channel cache I/O |
| `notify.go` | Background notifier |
