# Discord Bot — Rich Embeds & Expanded Query Coverage

**Date:** 2026-05-07
**Status:** Draft (awaiting user review)
**Scope:** `discord-bot/` (Go binary `qmanager_discord`)

## Problem

The current Discord bot embeds are functional but visually thin. They draw a tiny fraction of the data the poller already exposes in `/tmp/qmanager_status.json`:

- `/bands` shows only `network_type`, dominant `lte.band`, dominant `nr.band`, and a CA component count — discarding the entire `network.carrier_components[]` array (per-CC PCI, EARFCN/ARFCN, bandwidth, RSRP/SINR), `network.total_bandwidth_mhz`, `network.bandwidth_details`, and serving cell IDs.
- `/signal` shows per-port RSRP/RSRQ/SINR/RSSI but no overall quality summary, no visual signal-bar indicator, and no provenance (silently picks NR over LTE without telling the user).
- `/status` shows internet up/down + latency point sample, but ignores `connectivity.{avg_latency_ms, jitter_ms, packet_loss_pct}`, `traffic.{rx,tx}_bytes_per_sec`, `device.conn_uptime_seconds`, and the entire `watchcat.*` block.
- `/events` is closest to good but lacks a severity count badge or worst-severity sidebar coloring.
- Several poller fields have **no Discord surface at all**: `device.{firmware, model, imei, lte_category, mimo, supported_lte_bands, supported_*_nr5g_bands}`, SIM identifiers (`device.{imsi, iccid, phone_number}` + `network.{sim_slot, apn}`), and the watchcat recovery system.

Visually, the Pokemon TCG bot the user referenced shows what's possible with discordgo's primitives: author line, pill-row description, emoji-prefixed fields, footer with timestamp, and an action button row. We can match that polish without needing image hosting.

## Design

### Section 1 — Shared visual chrome

Every query embed (`/signal`, `/bands`, `/status`, `/events`, `/device`, `/sim`, `/watchcat`) uses the same skeleton, defined in a new `discord-bot/embeds.go` file:

| Element | Rule |
|---|---|
| **Author line** | `📡 QManager • <model>` where `<model>` comes from `device.model` in poller cache; falls back to `QManager` if missing |
| **Title** | Plain title-case command name: `Band Details`, `Signal Metrics`, `Modem Status`, `Recent Events`, `Device Info`, `SIM Details`, `Watchcat Status` |
| **Description "pill row"** | One-line summary of most important state, using emoji as visual pills (e.g. `🟢 EN-DC active • 📊 100 MHz • 🛰️ 3 carriers`). Per-command rules in later sections. |
| **Color sidebar** | Semantic, computed by a shared `embedColor(s *ModemStatus) int` helper. Green = healthy (internet up + modem reachable + not stale); amber = degraded (modem reachable but internet down, or `connectivity.during_recovery=true`, or sustained latency >500ms); red = down (modem unreachable or internet down past threshold); gray = stale cache (>30s) or unknown. `/events` overrides with worst-severity color. |
| **Fields** | Always emoji-prefixed: `🆔 PCI`, `📡 EARFCN`, `📐 BW`, `📈 SINR`, `🌡 Temp`, etc. Emoji vocabulary defined once in a `var emoji = struct{…}` block in `embeds.go` so every embed reuses identical glyphs. |
| **Footer text** | `QManager • Updated <relative>` where `<relative>` is `Xs ago` / `Xm ago` / `stale (>30s)`. Computed from `cache_time`. |
| **Footer timestamp** | `embed.Timestamp = time.Unix(s.CacheTime, 0).Format(time.RFC3339)` — Discord renders this localized to the viewer's timezone. |

### Section 2 — `/bands` redesign (hybrid layout)

Header summary description + per-CC inline cards.

**Description pill row** — built from `nr.state`, `network.total_bandwidth_mhz`, `len(carrier_components)`:
- Both LTE+NR carriers active → `🟢 EN-DC active • 📊 <total> MHz total • 🛰️ <N> carriers`
- Multiple LTE only → `🟢 LTE-A active • 📊 <total> MHz • 🛰️ <N> carriers`
- Multiple NR only → `🟢 NR-CA active • 📊 <total> MHz • 🛰️ <N> carriers`
- Single carrier → `🟢 Single carrier • 📊 <total> MHz`
- No carriers parsed → `🟡 No CA data — single-carrier or modem report unavailable`
- Stale cache → prepend `⚠ Stale ·`
- Modem unreachable → `🔴 Modem unreachable` (overrides everything else)

**Per-CC inline fields** — one per element of `network.carrier_components[]`, max 6 visible:
- Field name: `<emoji> <type> · <tech> <band>` where emoji is 🔵 PCC LTE / 🟢 PCC NR / 🟣 SCC LTE / 🟠 SCC NR. Color encodes both tier (PCC vs SCC) and tech (LTE vs NR).
- Field value (4 lines):
  - `🆔 PCI <cc.pci>`
  - `📡 EARFCN <cc.earfcn>` for LTE, `📡 ARFCN <cc.earfcn>` for NR (label switches by `cc.technology`)
  - `📐 <cc.bandwidth_mhz> MHz`
  - `📈 RSRP <cc.rsrp> / SINR <cc.sinr>` — both on one line; `—` for nulls
- Field inline: `true` (Discord places 3 per row).
- PCC always rendered first, SCCs in array order.

**Footer fields (full-width, non-inline)** — serving cell + TAC, drawing from `lte.{cell_id, tac}` and `nr.{cell_id, tac}`:
- `🆔 Serving cell` value: `LTE: <lte.cell_id> · NR: <nr.cell_id>` (omit a leg if its id is empty)
- `📞 TAC / Cell ID` value: `LTE: <lte.tac> (cell <lte.cell_id>) · NR: <nr.tac> (cell <nr.cell_id>)` (omit leg if empty)

**Edge cases:**
- `carrier_components` empty → skip per-CC fields, fall back to old single-band display via `lte.band` / `nr.band` plus the description pill row's "No CA data" message.
- `>6 CCs` (rare on RM520N-GL: max 5×LTE+1×NR = 6) → render first 6, append a non-inline field `+<N> more — use Copy raw to view` if `len > 6`.

**Action buttons:** `↻ Refresh` · `📡 Signal` · `📋 Status` · `🧾 Copy raw` (4 buttons; `📊 Bands` omitted because we're already on it).

### Section 3 — `/signal` redesign

**Description pill row** — overall best-RSRP across antennas mapped to existing `getSignalQuality` lowercase buckets:
- `🟢 Excellent · NR primary · ▰▰▰▰▰`
- `🟢 Good · NR primary · ▰▰▰▰▱`
- `🟡 Fair · LTE primary · ▰▰▰▱▱`
- `🔴 Poor · LTE primary · ▰▰▱▱▱`
- `🔴 None · No signal · ▱▱▱▱▱`

Bar count: 5/4/3/2/1/0 by quality bucket. "Primary" reads `nr.state == "connected"` ? "NR" : "LTE".

**Per-port inline fields** — keep 4 ports, but enrich:
- Field name: `<emoji> <port label>` where emoji is per-port quality color (🟢 Good+ RSRP > -90, 🟡 Fair RSRP -90 to -110, 🔴 Poor RSRP < -110, ⚫ no data)
- Field value (2 lines):
  - `RSRP <X> dBm  SINR <Y> dB`
  - `RSRQ <Z> dB`
- RSSI dropped from per-port fields (the poller doesn't expose per-antenna RSSI; the existing code carries an empty placeholder).

**Provenance footnote** (non-inline field, last) — only shown if data could come from either radio:
- `nr.state == "connected"` → `ℹ️ Showing NR values (EN-DC active — LTE leg also connected)` if LTE state also connected, else `ℹ️ Showing NR values`
- LTE only → `ℹ️ Showing LTE values`

**Action buttons:** `↻ Refresh` · `📊 Bands` · `📋 Status` · `🧾 Copy raw`.

### Section 4 — `/status` redesign (connectivity-first reorganization)

**Description pill row:** `<state emoji> Internet <state> · <latency> ms · ↓ <rx_rate> · ↑ <tx_rate>`
- `<state emoji>` = 🟢 up / 🔴 down / ⚫ unknown
- `<rx_rate>` and `<tx_rate>` formatted human-readable (B/s, KB/s, MB/s)
- If internet down: omit latency and traffic, just `🔴 Internet down · modem <reachable|unreachable>`

**Field grid (all inline pairs except where noted):**

| Field | Source | Value format |
|---|---|---|
| `🌐 Connection` | `connectivity.{status, latency_ms, avg_latency_ms, jitter_ms, packet_loss_pct, ping_target}` | `Up · 23 ms (avg 28, jitter 4)` line 1; `0.0% loss · ping 8.8.8.8` line 2 |
| `📶 Network` | `network.{carrier, type, sim_slot, wan_ipv4}` | `<carrier> · <type> · SIM <slot>` line 1; `WAN <ipv4>` line 2 |
| `⏱ Uptime` | `device.{uptime_seconds, conn_uptime_seconds}` | `Connection: <conn_up>` line 1; `Device: <up>` line 2 — uses existing `uptimeStr` helper |
| `🛡 Watchcat` | `watchcat.{state, failure_count, last_recovery_time, last_recovery_tier}` | `<State> · <N> failures` line 1; `Last recovery: <relative or never>` line 2 |
| `🌡 Device` | `device.{cpu_usage, temperature, memory_used_mb, memory_total_mb}` | `CPU <X>% · <T> °C · Mem <used>/<total> MB` |
| `🛰 SCC handoffs (24h)` | derived from `/tmp/qmanager_events.json` filtered to `type == "scc_pci_change"` within last 86400s | `<N> PCI changes detected` — skip the whole field if events log unreadable |

**Action buttons:** `↻ Refresh` · `📡 Signal` · `📊 Bands` · `🧾 Copy raw`.

### Section 5 — `/events` (light touches)

**Description pill row:** `🔴 <crit> critical · 🟡 <warn> warnings · ℹ️ <info> info — last 5 of <total>`
- `<total>` = total event-log line count (full file scan, capped at 1000 to avoid runaway reads).

**Sidebar color override:** worst severity in displayed window — red if any `critical`, amber if any `warning`, blue otherwise.

**Field structure:** unchanged (description block, severity emoji + timestamp + message per line).

**Action buttons:** `↻ Refresh` only (no cross-jump — `/events` is not a status snapshot).

### Section 6 — Action button mechanics

All buttons live in a shared `buildActionRow(source string)` helper in `embeds.go`. Custom IDs follow `qm:<action>:<source>`:

| Button | Custom ID example | Behavior | Failure mode |
|---|---|---|---|
| **↻ Refresh** | `qm:refresh:bands` | Defers, re-reads `/tmp/qmanager_status.json`, rebuilds the same embed type, edits the original message in-place via `InteractionResponseEdit`. Footer relative-time updates naturally. | Cache read fails → edit message to add `⚠ Refresh failed — cache unreadable` field at top, keep buttons enabled |
| **📡 Signal / 📊 Bands / 📋 Status** | `qm:nav:signal`, `qm:nav:bands`, `qm:nav:status` | Same as Refresh but builds a *different* embed type from same cache read. Replaces the message contents (including buttons — the new embed gets its own action row, omitting the now-current view's nav button). | Same fallback as Refresh |
| **🧾 Copy raw** | `qm:raw:bands` | Sends an **ephemeral** follow-up (visible only to clicker) containing a code-fenced JSON snippet of the relevant cache slice. Slices: `/bands` → `network` + `lte` + `nr`; `/signal` → `signal_per_antenna` + `lte` + `nr`; `/status` → `connectivity` + `device` + `network` + `watchcat`; `/device` → `device`; `/sim` → `network` (subset) + `device` (sim subset); `/watchcat` → `watchcat`. Uses `discordgo.MessageFlagsEphemeral`. | JSON >4000 chars → truncate with `… (truncated)` suffix |

**Auto-disable expiry:** Discord interaction tokens expire after 15 minutes. We spawn `time.AfterFunc(14*time.Minute, …)` per message that edits to disable all buttons + adds a `⌛ Buttons expired — run command again` non-inline field. This matches the existing `/reboot` 30s expiry pattern in `handlers.go:294`.

**Stateless dispatch:** the component handler parses `qm:<action>:<source>` and routes via a switch — no per-message state map. Cache is the source of truth; every click re-reads it.

**5-button row constraint:** Discord caps an `ActionsRow` at 5 buttons. The "big three" (`/signal`, `/bands`, `/status`) get `Refresh + Copy raw + 2 cross-jump` = 4 buttons (omits the current-view nav). `/events`, `/device`, `/sim`, `/watchcat` get `Refresh + Copy raw` = 2 buttons (no cross-jump — these are slash-invocation only).

### Section 7 — New commands (`/device`, `/sim`, `/watchcat`)

All three are pure read embeds against existing poller fields. No new AT plumbing.

#### `/device`
- **Description pill row:** `<model> · <firmware> · LTE Cat <category>`
- **Fields:**
  - `📦 Model` (inline): `device.model`
  - `🏭 Manufacturer` (inline): `device.mfr`
  - `🔢 IMEI` (inline): `device.imei`
  - `💾 Firmware` (inline): `device.firmware`
  - `📅 Build date` (inline): `device.build_date`
  - `🛜 MIMO config` (inline): `device.mimo`
  - `📡 Supported LTE bands` (non-inline): `device.supported_lte_bands` — comma-separated, wrapped if long
  - `📡 Supported NR (NSA)` (non-inline): `device.supported_nsa_nr5g_bands`
  - `📡 Supported NR (SA)` (non-inline): `device.supported_sa_nr5g_bands`
- **Buttons:** `↻ Refresh` + `🧾 Copy raw`

#### `/sim`
- **Default to ephemeral response** (sets `discordgo.MessageFlagsEphemeral` on the initial response) because ICCID/IMSI/phone are sensitive identifiers that shouldn't sit in shared channel history. The DM channel users receive bot DMs in is private already, but ephemeral is belt-and-suspenders for any future channel mode.
- **Description pill row:** `SIM <slot> · <carrier> · APN <apn>`
- **Fields:**
  - `🎯 Slot` (inline): `network.sim_slot`
  - `📶 Carrier` (inline): `network.carrier`
  - `🌐 APN` (inline): `network.apn`
  - `🔢 ICCID` (inline): `device.iccid`
  - `🆔 IMSI` (inline): `device.imsi`
  - `📞 Phone` (inline): `device.phone_number`
- **Buttons:** `↻ Refresh` + `🧾 Copy raw`. `Refresh` on `/sim` keeps the message ephemeral (Discord's `InteractionResponseEdit` preserves the original message's ephemeral flag, so re-renders stay private). `Copy raw` is ephemeral on every command.

#### `/watchcat`
- **Description pill row:** `<state emoji> Watchcat <state> · Tier <current> · <N> failures`
- `<state emoji>` = 🟢 idle / 🟡 monitoring / 🔴 escalated
- **Fields:**
  - `🛡 Enabled` (inline): `watchcat.enabled` (Yes/No)
  - `📊 State` (inline): `watchcat.state`
  - `🪜 Current tier` (inline): `watchcat.current_tier`
  - `❌ Failure count` (inline): `watchcat.failure_count`
  - `🔄 Total recoveries` (inline): `watchcat.total_recoveries`
  - `⏰ Last recovery` (inline): formatted relative time from `watchcat.last_recovery_time`, or `Never`
  - `🪜 Last recovery tier` (non-inline, only if `last_recovery_time != null`): `watchcat.last_recovery_tier`
- **Buttons:** `↻ Refresh` + `🧾 Copy raw`

## Data model changes

`ModemStatus` in `cache.go` needs new fields. Adding to the struct + extending `mapPollerToStatus`:

```go
type ModemStatus struct {
    // ... existing fields ...

    // /bands — new
    TotalBandwidthMHz   string                // network.total_bandwidth_mhz
    BandwidthDetails    string                // network.bandwidth_details
    CarrierComponents   []CarrierComponent    // network.carrier_components
    LteCellID, NrCellID string                // lte.cell_id, nr.cell_id
    LteTAC, NrTAC       string                // lte.tac, nr.tac

    // /status — new
    ConnAvgLatency, ConnJitter, ConnPacketLoss string // connectivity.{avg_latency_ms, jitter_ms, packet_loss_pct}
    PingTarget                                 string // connectivity.ping_target
    DuringRecovery                             string // connectivity.during_recovery
    ConnUptime                                 string // device.conn_uptime_seconds
    CpuUsage, MemUsedMB, MemTotalMB            string // device.{cpu_usage, memory_used_mb, memory_total_mb}
    RxRate, TxRate                             string // traffic.{rx_bytes_per_sec, tx_bytes_per_sec}

    // Watchcat — new
    WatchcatEnabled, WatchcatState                 string
    WatchcatTier, WatchcatFailures, WatchcatTotal  string
    WatchcatLastTime, WatchcatLastTier             string

    // Device — new
    Model, Manufacturer, Firmware, BuildDate string
    IMEI, IMSI, ICCID, PhoneNumber           string
    LteCategory, MIMO                        string
    SupportedLteBands, SupportedNsaBands, SupportedSaBands string

    // SIM — additions covered by APN
    APN string
}

type CarrierComponent struct {
    Type         string  // PCC | SCC
    Technology   string  // LTE | NR
    Band         string  // B3 | n78
    EARFCN       string  // unified label name; UI decides EARFCN vs ARFCN by Technology
    BandwidthMHz string
    PCI          string
    RSRP, RSRQ, RSSI, SINR string
}
```

Corresponding `pollerCache` struct additions in `cache.go` to deserialize the new fields. All new fields use the same pointer-or-string pattern already established (so unset → empty string in `ModemStatus`).

## Code structure

| File | Change |
|---|---|
| `discord-bot/embeds.go` (new) | Shared chrome helpers: `embedColor`, `relativeTime`, `buildActionRow`, `var emoji struct{…}`, `formatBytes`, `signalQualityBars`, `severityIcon`, etc. |
| `discord-bot/cache.go` | Extend `ModemStatus` + `pollerCache` + `mapPollerToStatus` with new fields and `CarrierComponent` type. Add `readEventCounts(path string) (crit, warn, info, total int, err error)` helper for /events pill row. |
| `discord-bot/handlers.go` | Rewrite `buildSignalEmbed`, `buildBandsEmbed`, `buildStatusEmbed`, `buildEventsEmbed`. Add `buildDeviceEmbed`, `buildSimEmbed`, `buildWatchcatEmbed`. Add `handleDevice`, `handleSim`, `handleWatchcat` plus their command-name routes in `handleCommand`. Extend `handleComponent` with the `qm:<action>:<source>` dispatcher. Add 14-minute auto-disable scheduler shared across query commands. |
| `discord-bot/commands.go` | Register `/device`, `/sim`, `/watchcat` slash commands. |
| `discord-bot/handlers_test.go` | Add tests covering: pill-row text generation per state, hybrid CC layout (0, 1, 3, 6, 7 CCs), color logic (green/amber/red/gray), button row composition (correct nav button omission per source), copy-raw JSON slicing, ephemeral flag on /sim. |
| `discord-bot/cache_test.go` | Add tests for new fields in `mapPollerToStatus` + `CarrierComponent` deserialization + `readEventCounts`. |

## Out of scope (explicitly deferred)

- `/speed` (live throughput + speedtest trigger) — needs long-poll UX work and `speedtest` exec wrapping; defer to follow-up.
- `/cells` (neighbor cell info) — requires new `AT+QENG="neighbourcell"` command and parser plumbing in poller; bigger scope.
- Thumbnail icons / hosted images — user explicitly chose "Rich, no images".
- `View on Web UI` link button — would need a configurable `web_ui_url` field in `/etc/qmanager/discord_bot.json`; user did not select this option.
- Changes to `/reboot`, `/lock-band`, `/network-mode` — these are action commands, not query embeds; their UI is already appropriate.
- Changes to the connectivity DM notifier in `notify.go` — the down/up DMs are short and informational; rich embeds would be over-engineering.

## Risks

- **Field count limits.** Discord caps embeds at 25 fields. `/bands` worst case: pill row (description) + 6 CC fields + serving cell + TAC + maybe a "+N more" footer field = 9. `/status` worst case: 6 fields. Well within limits.
- **Field value length.** Discord caps a single field value at 1024 chars. Our densest field (per-CC value) is ~80 chars. No risk.
- **Description length.** Discord caps description at 4096 chars. Our pill rows are <100 chars. No risk.
- **Total embed length.** Discord caps total embed (all fields combined) at 6000 chars. We're nowhere close.
- **Cache-read race.** Refresh button reads cache concurrently with the poller writing it. Existing `readStatus` already opens-and-reads atomically (`os.ReadFile`); the poller writes via tmp+rename. No new race.
- **Auto-disable timer leak.** If the bot restarts mid-window, scheduled `AfterFunc` callbacks die with the process. The buttons stay enabled but clicks fail silently after 15 min — acceptable degradation.
- **Emoji rendering on old Discord clients.** All chosen emoji are in the standard Unicode range (no custom guild emoji). Render fine on every Discord client.

## Success criteria

1. Running `/bands` while on EN-DC with multiple CCs renders a header summary line + 3+ inline CC cards showing PCI, EARFCN/ARFCN, bandwidth, RSRP/SINR per CC.
2. Running `/signal` renders a quality bar in the description and per-port color emoji that match the actual RSRP buckets.
3. Running `/status` shows latency stats (avg, jitter, loss), live throughput, watchcat state, and connection-vs-device uptime split.
4. Clicking `↻ Refresh` on any of the four query embeds re-reads the cache and updates the message in place.
5. Clicking a cross-jump button (`📡 Signal`, `📊 Bands`, `📋 Status`) replaces the embed with the target view's embed.
6. Clicking `🧾 Copy raw` produces an ephemeral follow-up containing a code-fenced JSON slice scoped to the source command.
7. Buttons auto-disable after 14 minutes with a "Buttons expired" message added.
8. `/device` renders model, firmware, IMEI, supported bands.
9. `/sim` responds **ephemerally** with SIM slot, ICCID, IMSI, phone, APN — never visible to other channel members.
10. `/watchcat` shows current tier, failure count, last recovery time formatted as relative.
11. All embeds share identical author line, footer format ("QManager • Updated <Xs ago>"), and timestamp.
12. Existing tests in `discord-bot/` still pass; new tests cover the new code paths.
