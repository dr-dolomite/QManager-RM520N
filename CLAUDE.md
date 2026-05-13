## Communication Style

When reporting findings, diagnoses, root causes, or explaining how something works, write so the user **learns alongside the fix** — not just expert-to-expert shorthand.

- **Lead with a plain-English summary** (one line) before the technical specifics. Example: "Short version: the CGI script can't see `jq` because lighttpd starts CGI scripts with a stripped-down `PATH` that doesn't include `/opt/bin`."
- **Briefly explain the *why*** behind the underlying mechanism — one or two sentences of context. Example: "lighttpd does this on purpose: untrusted CGI scripts shouldn't inherit the parent shell's environment, so it gives them a minimal one."
- **Define jargon on first use**: acronyms (CGI, RLS, RSRP, EN-DC), kernel/system terms (sysctl, udev, systemd target, journald), protocol terms (flock, PTY, WebSocket upgrade) get a one-clause gloss.
- **Use analogies** when they clarify ("`flock` is like a 'do not disturb' sign on the file — only one process can hold it at a time").
- **Keep it additive, not bloating.** Trivial answers ("yes", "the file is at X") don't need a tutorial. The rule kicks in for findings, diagnoses, post-mortems, code review, and architecture explanations.

This applies to all output that explains *what's happening* or *why* — bug investigations, debug session reports, audit findings, design rationale, and any "I traced this and found..." moments.

## Design Context

### Users
- **Hobbyist power users** optimizing home cellular setups for better speeds, band locking, and coverage
- **Field technicians** deploying and maintaining Quectel modems on OpenWRT devices
- Context: users are technically literate but not necessarily developers. They want clear, actionable information without needing to memorize AT commands. Sessions range from quick checks (signal status) to focused configuration (APN, band locking, profiles).

### Brand Personality
**Modern, Approachable, Smart** — a friendly expert. Not intimidating or overly technical in presentation, but deeply capable underneath. The interface should feel like a premium tool that respects the user's intelligence without requiring them to be a modem engineer.

### Aesthetic Direction
- **Visual tone:** Clean and modern with purposeful density where data matters. Polish of Vercel/Linear meets the functional depth of Grafana/UniFi.
- **References:** Apple System Preferences (clarity, hierarchy), Vercel/Linear (typography, motion, whitespace), Grafana/Datadog (data visualization density), UniFi (network management UX patterns)
- **Anti-references:** Avoid raw terminal aesthetics, cluttered legacy network tools, or overly playful/consumer app styling. Never sacrificial clarity for visual flair.
- **Theme:** Light and dark mode, both first-class. OKLCH color system already in place.
- **Typography:** Euclid Circular B (primary), Manrope (secondary). Clean, geometric, professional.
- **Radius:** 0.65rem base — softly rounded, not pill-shaped.

### Status Badge Pattern
All status badges use `variant="outline"` with semantic color classes and `size-3` lucide icons. Never use solid badge variants (`variant="success"`, `variant="destructive"`, etc.) for status indicators.

| State | Classes | Icon |
| ----- | ------- | ---- |
| Success/Active | `bg-success/15 text-success hover:bg-success/20 border-success/30` | `CheckCircle2Icon` |
| Warning | `bg-warning/15 text-warning hover:bg-warning/20 border-warning/30` | `TriangleAlertIcon` |
| Destructive/Error | `bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30` | `XCircleIcon` or `AlertCircleIcon` |
| Info | `bg-info/15 text-info hover:bg-info/20 border-info/30` | Context-specific (`DownloadIcon`, `ClockIcon`, etc.) |
| Muted/Disabled | `bg-muted/50 text-muted-foreground border-muted-foreground/30` | `MinusCircleIcon` |

```tsx
<Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
  <CheckCircle2Icon className="size-3" />
  Active
</Badge>
```

- Reusable `ServiceStatusBadge` component at `components/local-network/service-status-badge.tsx` for service running/inactive states
- Choose muted for deliberately inactive states (Stopped, Offline peer, Disabled); destructive for failure/error states (Disconnected link, Failed email)

### Design Principles

1. **Data clarity first** — Signal metrics, latency charts, and network status are the core experience. Every pixel should serve readability and quick comprehension. Use color, spacing, and hierarchy to make numbers scannable at a glance.
2. **Progressive disclosure** — Show the essential information upfront; advanced controls and details are accessible but not overwhelming. A quick-check user and a deep-configuration user should both feel served.
3. **Confidence through feedback** — Every action (save, reboot, apply profile) must have clear visual feedback: loading states, success confirmations, error messages. Users are changing real device settings — they need to trust what happened.
4. **Consistent, systematic** — Use the established shadcn/ui components and design tokens uniformly. No one-off styles. Cards, forms, tables, and dialogs should feel like they belong to one coherent system.
5. **Responsive and resilient** — Works on desktop monitors and tablets in the field. Degrade gracefully. Handle loading, empty, and error states intentionally — never show a blank screen.

### UI Component Conventions

- **CardHeader**: Always plain `CardTitle` + `CardDescription` without icons. Icons belong in badges or separate action areas, not in the card header itself.
- **Primary action buttons**: Use default variant (not outline) for main actions like Record, Save, Apply. Use `SaveButton` component for save-specific actions with loading animation.
- **Step-based progress**: Use `Loader2Icon` spinner + dot indicators for step/sample progress. Reserve fill/progress bars for data visualization (signal strength, quality meters) only.

## RM520N-GL Variant

QManager is being extended to support the Quectel RM520N-GL modem. This variant runs vanilla Linux (SDXLEMUR, ARMv7l, kernel 5.4.180) internally — NOT OpenWRT on an external host. The `dev-rm520` branch contains this work.

Key platform differences from RM551E (current target):

### AT Command Transport

- **RM551E**: `sms_tool` via USB, wrapped by `qcmd`
- **RM520N-GL**: `atcli_smd11` on `/dev/smd11` (direct access, no socat-at-bridge), wrapped by `qcmd`
- **`atcli_smd11` is a Rust reimplementation** from [1alessandro1/atcli_rust](https://github.com/1alessandro1/atcli_rust) — replaces the original Compal C `atcli` binary. Static ARMv7 build (~647KB non-UPX), works across Quectel RM502, RM520, RM521, and RM551 modems. Uses `BufReader::read_line` streaming (no 4096-byte buffer overflow bug from the OEM version) and matches the OEM terminator array exactly (`OK\r\n`, `ERROR\r\n`, `+CME ERROR:`, etc.).
- **Do NOT UPX-compress the binary** — UPX self-modifying code causes segmentation faults on exit for this ARM build. Ship the uncompressed binary (~647KB) instead.
- `atcli_smd11` opens `/dev/smd11` directly via `OpenOptions` — no PTY bridge or socat services needed
- Handles long commands natively (AT+QSCAN waited 1m+ in testing) — no `_run_long_at()` workaround
- Always exits 0 — error detection by parsing response text for OK/ERROR
- `qcmd` uses `flock` with read-only FD (`9<`) for serialization (handles `fs.protected_regular=1`)
- SMS operations use `sms_tool` (bundled ARM binary) for recv/send/delete — handles multi-part message reassembly natively. Wrapped with same `flock` as `qcmd` for serialization. Suppress stderr (`2>/dev/null`) for harmless `tcsetattr` warnings on smd devices.
- BusyBox `flock` lacks `-w` (timeout) — use `flock -x -n` in a polling loop (see `flock_wait()` in `qcmd` and `sms.sh`)
- `pid_alive()` in `platform.sh` replaces `kill -0` for cross-user PID checks (www-data checking root PIDs)
- `cgi_base.sh` sources `platform.sh`, making `pid_alive` available to all CGI scripts

### System Differences

| Concern | RM551E (OpenWRT) | RM520N-GL (Vanilla Linux) |
|---------|-----------------|---------------------------|
| Init system | procd | systemd (`.service` units in `/lib/systemd/system/`) |
| Config store | UCI | Files in `/usrdata/` (persistent partition) |
| Root filesystem | Read-write | Read-only by default (`mount -o remount,rw /`) |
| Shell | BusyBox sh (POSIX only) | `/bin/bash` available |
| Web server | uhttpd | lighttpd (Entware) |
| Firewall | nftables / fw4 | iptables direct |
| TTL interface | `wwan0` | `rmnet+` |
| Package manager | opkg (system) | Entware opkg at `/opt` (bind-mounted from `/usrdata/opt`) |
| LAN config | UCI (`network.*`) | `/etc/data/mobileap_cfg.xml` via xmlstarlet |

**Architecture reference:** Full details in `docs/rm520n-gl-architecture.md` — includes platform internals, AT transport, Entware bootstrapping, lighttpd configuration, boot sequences, and troubleshooting.

**Source reference:** `simpleadmin-source/` contains the original RM520N-GL admin panel (iamromulan/quectel-rgmii-toolkit) for historical reference. QManager is now fully independent and does not require SimpleAdmin to be installed.

### QManager Independence

QManager installs independently — no SimpleAdmin or RGMII toolkit required:
- **Own directory:** `/usrdata/qmanager/` (web root, lighttpd config, TLS certs)
- **Bootstraps Entware** from `bin.entware.net` if not present (creates `opt.mount`, `start-opt-mount.service`, `rc.unslung.service`)
- **Installs lighttpd + modules** from Entware (`lighttpd-mod-cgi`, `lighttpd-mod-openssl`, `lighttpd-mod-redirect`, `lighttpd-mod-proxy`)
- **Creates `www-data:dialout`** user/group if missing — `dialout` grants access to `/dev/smd11`
- **AT transport:** `atcli_smd11` accesses `/dev/smd11` directly — no socat-at-bridge needed
- **`/dev/smd11` permissions:** defaults to `crw------- root:root`. **Primary:** udev rule `/etc/udev/rules.d/99-qmanager-smd11.rules` fires on every kernel `add` event for `smd11` and runs `/usr/lib/qmanager/qmanager_smd11_udev.sh`, which sets `chmod 660` + `chown root:dialout`. **Fallback:** `qmanager_setup` runs the same `chown`/`chmod` at boot in case udev hasn't loaded the rule yet (e.g. fresh install pre-reload). Both paths are idempotent. Solves PRAIRE-derived platforms (RG502Q/RM502Q) where the modem re-creates `/dev/smd11` *after* `qmanager-setup.service` runs, leaving the one-shot's `[ -e ]` guard false. udev-helper script lives at source path `scripts/etc/udev/scripts/qmanager_smd11_udev.sh` (deliberately outside `usr/lib/qmanager/` to avoid `install_backend`'s glob copy resetting its mode to 644). Subsystem on RM520N-GL is `glinkpkt` (sysfs `/sys/class/glinkpkt/smd11`); rule omits `SUBSYSTEM==` so it works across both platforms — `KERNEL=="smd11"` is already specific enough.
- **CGI PATH:** lighttpd CGI has minimal PATH excluding `/opt/bin` — `cgi_base.sh` exports full PATH and installer symlinks `jq` to `/usr/bin/`
- **Cookie-based session auth** at CGI layer (no HTTP Basic Auth, no `.htpasswd`)
- **`systemctl enable` does not work** — all boot persistence uses direct symlinks into `/lib/systemd/system/multi-user.target.wants/` (via `svc_enable`/`svc_disable` in `platform.sh`)
- **Installer stops socat-smd11** services if running (atcli_smd11 requires smd11 unlocked)
- **SSH password management:** `qmanager_set_ssh_password` helper reads password from stdin, updates `/etc/shadow` via `openssl passwd -1`. Whitelisted in sudoers for www-data. Called automatically during onboarding (syncs web UI password to root), and independently from System Settings > SSH Password card.
- **Windows line ending safety:** Installer strips `\r` from all deployed shell scripts, systemd units, and sudoers rules (`sed -i 's/\r$//'`) — prevents BusyBox/sudoers parse failures from Windows-built tarballs
- **lighttpd module version sync:** Installer runs `opkg upgrade` on lighttpd + all modules together when already installed — prevents `plugin-version doesn't match` errors during upgrades
- **Speedtest CLI:** Downloaded from `install.speedtest.net` (ookla-speedtest-1.2.0-linux-armhf.tgz) during install, placed at `/usrdata/root/bin/speedtest` with `/bin/speedtest` symlink. CGI scripts discover via `command -v speedtest`. Non-fatal if download fails.
- **Cell scanner operator lookup:** `qmanager_cell_scanner` uses `operator-list.json` from `/usrdata/qmanager/www/cgi-bin/quecmanager/` for MCC/MNC → provider name resolution. The jq expression handles both `--slurpfile` (wrapped array) and `--argjson` (direct) operator input.
- **Installer internet resilience:** `opkg update` failure is caught gracefully — all Entware package installs are skipped with clear warnings. The rest of the install (scripts, frontend, systemd units) continues normally.
- **HTTP transport:** All network I/O (installer bootstrap, OTA updater, auto-update cron, GitHub API, public-IP probe, ttyd/speedtest downloads, Entware bootstrap) uses `curl` only. wget and uclient-fetch fallbacks were removed in 2026-05 — BusyBox wget on Quectel x5x/x6x platforms lacks TLS, and Entware wget would add ~5 MB to the install footprint. The installer fails fast in preflight if `curl` is missing.
- **Port firewall:** `qmanager-firewall.service` restricts web UI (ports 80/443) to trusted interfaces (lo, bridge0, eth0, tailscale0 if installed). Blocks cellular-side access. Replaces SimpleAdmin's `simplefirewall` — QManager-owned, installed by default. SSH (22) intentionally left open for emergency access.
- **Tailscale VPN:** Installed on-demand via `qmanager_tailscale_mgr` helper using the **rgmii-toolkit-aligned install flow** (validated 2026-04-10). Hardcoded version `1.92.5` and arch `arm` — no CDN directory scraping, no version detection, no timeout gymnastics. The helper uses a **two-layer execution pattern**: an outer wrapper stages an inner install script and a temporary systemd oneshot unit (`qmanager_tailscale_install.service`), then fires the unit and returns. The inner script runs detached under systemd, surviving caller/CGI disconnects. Download lands in `/usrdata/` (persistent partition) via bare `curl -O` — **do NOT add `-fSL` or timeouts**, both contributed to the original hang. Binaries live at `/usrdata/tailscale/`. Systemd units come from `/usr/lib/qmanager/tailscaled.service` + `tailscaled.defaults` (bundled by the installer, with an inline fallback in the helper if missing). The helper calls `sleep 2` after `daemon-reload` before `start` to let systemd register the new unit. CLI accessibility requires **two symlinks**: `/usrdata/root/bin/tailscale` (rgmii-toolkit convention) AND `/usr/bin/tailscale` (QManager's default root shell uses `HOME=/home/root` and doesn't see `/usrdata/root/bin`). The helper restarts `qmanager-firewall.service` after install so `tailscale0` becomes a trusted interface. `tailscale up` must NOT use `--json` flag — its output is fully buffered on RM520N-GL (no `stdbuf`) and never flushes to file; use interactive mode and grep for the auth URL instead. **tailscaled resets its state directory to 700 on every start** — CGI `is_installed()` avoids this by checking the systemd unit file (world-readable) + directory existence instead of binary executability; `ExecStartPost=/bin/chmod 755` in the service unit and `qmanager_setup` also restore access as belt-and-suspenders. **All rootfs writes must be flushed** — `qmanager_tailscale_mgr` calls `sync` before every `mount -o remount,ro /` to prevent unit file/symlink loss on reboot. PID tracking: wrapper writes its own PID initially, then overwrites with the systemd oneshot's `MainPID`, then the inner script overwrites with its own PID via an EXIT trap that cleans up on completion — keeps the CGI's `pid_alive` concurrency check working across the full install lifetime. Progress file at `/tmp/qmanager_tailscale_install.json` (CGI poll target), log at `/tmp/qmanager_tailscale_install.log`. No dependency on SimpleAdmin.
- **Web console:** `qmanager-console.service` runs ttyd v1.7.7 (armhf) on localhost:8080, reverse-proxied by lighttpd at `/console` with WebSocket upgrade. Downloaded during install (non-fatal if offline). Binary at `/usrdata/qmanager/console/ttyd`. Theme matches QManager dark mode. Shell startup script sets PATH for Entware tools.
- **Email alerts:** `msmtp` installed from Entware (`/opt/bin/msmtp`). Generated msmtprc at `/etc/qmanager/msmtprc` must NOT include a `logfile` directive — msmtp returns rc=1 if it can't write its log, even when the email sends successfully. The `email_alerts.sh` library detects msmtp at `/opt/bin/msmtp` explicitly (poller PATH lacks `/opt/bin`). Recovery emails wait 30s after connectivity returns for DNS/SMTP to stabilize before the first send attempt.
- **SMS alerts:** Delivered via bundled `sms_tool` on `/dev/smd11` — no package install needed. `sms_alerts.sh` library is poller-sourced and reads poller globals (`conn_internet_available`, `modem_reachable`, `lte_state`, `nr_state`) directly. **Registration guard is mandatory before every send** — modem must be reachable AND (`lte_state="connected"` OR `nr_state="connected"`); waiting for registration is unbounded at the state machine level, but `_sa_do_send` caps real send attempts at 3 (unregistered skips don't consume the retry budget — bounded separately by `_SA_MAX_SKIPS`). Recovery path has two branches: separate SMS if downtime-start was `"sent"`, combined dedup "was down for X, now restored" otherwise. **Recovery is silenced when `status="none" && duration < threshold_secs`** so sub-threshold blips never generate notifications. Phone numbers are stored with leading `+` but stripped via `${_sa_recipient#+}` before `sms_tool send` (matches the convention in `scripts/www/cgi-bin/quecmanager/cellular/sms.sh:265`). The shared `/tmp/qmanager_at.lock` serializes sms_tool calls with `qcmd` and the SMS Center CGI. Test sends from the CGI override `_sa_is_registered() { return 0; }` because CGI context lacks poller globals — the override is placed AFTER sourcing the library (which has a `_SMS_ALERTS_LOADED` guard preventing re-source clobber). Config at `/etc/qmanager/sms_alerts.json`, NDJSON log at `/tmp/qmanager_sms_log.json` (max 100 entries), reload flag at `/tmp/qmanager_sms_reload`. Config writes are atomic via `.tmp` + `mv`.
- **OTA update pipeline:** sudoers rule `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_update` lets the `update.sh` CGI invoke the worker as root via `sudo -n`. CGI spawn-line redirects to `/dev/null 2>&1` (not `>>log`) so the worker creates `/tmp/qmanager_update.log` as root, sidestepping `fs.protected_regular=1` blocking root from truncating www-data-created log files. Worker (`qmanager_update`) uses atomic `write_status` (`.tmp` + `mv`) and validates progress by tailing `=== Step N/M: <label> ===` lines from the installer log. Two-phase VERSION write: installer writes `/etc/qmanager/VERSION.pending` early via `mark_version_pending()`; `finalize_version()` moves it to `/etc/qmanager/VERSION` at the end — a surviving `.pending` file after reboot indicates a failed install. `cleanup_legacy_scripts()` and service enable/disable are filesystem-driven (scans `/lib/systemd/system/qmanager-*.service` and `/usr/bin/qmanager_*` at runtime, not a hardcoded list). `UCI_GATED_SERVICES` controls which services are only re-enabled if their `multi-user.target.wants/` symlink existed pre-upgrade. Watchcat lock `/tmp/qmanager_watchcat.lock` is touched before stop and released on EXIT trap to suppress watchdog during install window. Shared semver library at `/usr/lib/qmanager/semver.sh` — sourced by `update.sh` CGI and `qmanager_auto_update`. **v0.1.4 → v0.1.5 upgrade requires ADB/SSH** because v0.1.4's CGI has no sudo and v0.1.4's sudoers has no `qmanager_update` rule; from v0.1.5 onward OTA works via UI.

## Removed/Deferred Features (dev-rm520 Branch)

The following features have been **completely removed** from the `dev-rm520` branch. Their backend scripts, frontend components, hooks, and types no longer exist. Do NOT reference, modify, or create code for these features unless explicitly re-porting them.

| Feature | Reason | Scope of Removal |
|---------|--------|-----------------|
| VPN Management (NetBird only) | Third-party binary, fw4/mwan3 dependencies | CGI, hooks, components for NetBird |
| Video Optimizer / Traffic Masquerade (DPI) | nftables dependency, nfqws ARM32 not validated | CGI, hooks, components, types, dpi_helper.sh, installer |
| Bandwidth Monitor | ARM64 binary not portable, websocat dependency | CGI, hooks, components, types, binary, systemd units |
| Ethernet Status & Link Speed | Different NIC architecture (RGMII vs USB), ethtool differences | CGI, components, ethtool_helper.sh |
| Custom DNS | UCI network dependency, no equivalent on RM520N-GL | CGI, hooks, components |
| WAN Interface Guard | OpenWRT netifd-specific (ifdown/uci network) | Daemon, init.d script |
| Low Power Mode (daemons) | Daemon scripts removed; cron/config management retained in settings.sh | qmanager_low_power, qmanager_low_power_check |

## Feature-Specific Notes

### Discord Bot (`discord-bot/`, deployed as `/usr/bin/qmanager_discord`)

- **Type**: User-installed Discord bot (OAuth2 `integration_type=1`, scope `applications.commands` only — no `bot` scope, no shared guild required). Runs as a systemd service (`qmanager-discord.service`).
- **Binary is UPX-LZMA compressed**: `build-discord-bot.sh` runs `upx --lzma --best` after the Go build, cutting the binary from ~7.1 MB to ~2.0 MB (-72%). Validated on RM520N-GL hardware: slash commands, AT-command path (`/lock-band`, `/network-mode`), and DM notifications all work; clean stop/start/reboot cycles produce no segfaults. **This is the opposite of the `atcli_smd11` rule** — the Rust binary segfaults on exit when UPX-packed; the Go runtime does not. Set `UPX_COMPRESS=0` to skip compression for debugging (uncompressed binaries are easier to inspect with `strings`/`objdump`). Build silently falls back to uncompressed if `upx` isn't on PATH, with a warning.
- **AT-command serialization**: Slash commands that issue AT calls (`/lock-band`, `/network-mode`, `/reboot`) go through `runQcmd` → `/usr/bin/qcmd`, which uses the same `flock` `/tmp/qmanager_at.lock` everything else does. No special Discord-side coordination needed.
- **Status cache reads**: The embed-driven slash commands (`/status`, `/signal`, `/bands`, `/device`, `/sim`, `/watchcat`) read `/tmp/qmanager_status.json` via `readStatus` in `cache.go`. `/events` reads `/tmp/qmanager_events.json`. The cache schema is the poller's flat shape, mapped through `pollerCache` → `ModemStatus` in `mapPollerToStatus`.
- **`stringOrNum` decoder**: `lte.cell_id` and `lte.tac` (and the NR equivalents) come from the modem as either quoted strings or bare numbers depending on AT response shape. The custom `stringOrNum` `UnmarshalJSON` in `cache.go` handles both — do NOT change those fields back to plain `string`.
- **Defer-then-edit vs. synchronous response — pick the right pattern**:
  - Commands that do non-trivial work (AT call, network round-trip, slow file scan) MUST defer first: `s.InteractionRespond(... Type: InteractionResponseDeferredChannelMessageWithSource)` then `InteractionResponseEdit`. Discord's interaction window is 3 seconds; deferring buys you 15 minutes. `/lock-band`, `/network-mode`, `/reboot` use this pattern.
  - Commands that only read fast caches and respond with an embed use the synchronous `respondEmbedWithButtons` path. Stays well under 3s on a healthy network.
- **`Button.Emoji.Name` must be a real Unicode emoji (COMPONENT_INVALID_EMOJI gotcha)**: Discord's API rejects the entire interaction response with `HTTP 400 / code 50035 / COMPONENT_INVALID_EMOJI` if any button's emoji name is not in its accepted Unicode emoji table. Dingbat-style symbols like `↻` (U+21BB) used to slip through and now don't. **Use `🔄`** for refresh actions, or stick to characters from the standard emoji set. The error is silent from the user's view — Discord just shows "The application did not respond" — so this is easy to miss without log inspection.
- **Action-row composition**: `buildActionRow(source)` in `embeds.go` builds the per-source button row. Refresh button is always first; nav/raw buttons depend on source. All button emojis must be valid Unicode emojis (see above). Centralize emoji choices here — don't inline new ones in handlers.
- **Embed field labels are plain text by convention**: Decorative emoji prefixes were stripped from field names in v0.1.7 polish. Keep emojis only where they encode information: signal-quality color dots in description lines, per-port quality icons in `/signal`, carrier-component tier markers (`🔵🟣🟢🟠 = PCC/SCC × LTE/NR`) in `/bands`, severity icons in `/events`, and one icon per button in action rows. Adding a decorative emoji to a field label is a regression.
- **DM channel persistence**: User-installed bots can't reliably resolve the owner DM channel cold (Discord error 50007 without a shared guild). The cached channel ID at `/etc/qmanager/discord_dm_channel` is captured opportunistically from inbound messages and from any slash-command interaction (`captureDMFromInteraction` in `handlers.go`). Once captured, `ChannelMessageSend` works without re-resolving.
- **Diagnostic logging**: `[interaction] cmd=<name> id=<id>` fires for every received slash command, and `[interaction] respond source=<x> elapsed=<dur> err=<v>` fires after every embed response. These two log lines are load-bearing for debugging — leave them in unless replacing with structured logging.
- **`journalctl -u qmanager-discord` may return empty on this device** even though the unit declares `StandardOutput=journal`. journald appears volatile and frequently has no captured entries. To capture diagnostic logs, stop the service and run the binary in foreground with stdout/stderr redirected to `/tmp/discord-debug.log`. (Diagnosing the journald gap itself is a separate cleanup item.)
- **Network path to discord.com is variable**: `InteractionResponseEdit` calls occasionally hit `context deadline exceeded` over the cellular link. The deferred command's actual work (e.g. `AT+QNWPREFCFG`) usually still executes — only the response edit fails — so users may see "did not respond" even though the action took effect. Worth keeping in mind when triaging "command didn't work" reports.
- **discordgo v0.28.1 limitations**: `IntegrationTypes` and `Contexts` fields on `ApplicationCommand` are not exposed by this SDK version. Commands are registered without those fields and rely on Discord's per-application defaults. Do not assume the SDK will refuse a malformed command — it won't; Discord's API will. If a registered command stops appearing, query `https://discord.com/api/v10/applications/<app_id>/commands` directly to inspect what was actually accepted.
- **`/lock-band` separator**: User input uses commas (`B3,B7,B28` / `n41,n78`) — colons accepted for legacy. `parseBandOption` in `handlers.go` normalizes both via `strings.ReplaceAll(input, ":", ",")`, then numerically sorts via `sort.Ints` and dedups via `slices.Compact`, so the modem (and the `"B" + strings.ReplaceAll(parsed, ":", "/B")` display formatter in `handleLockBand`) always sees a canonical ascending colon-joined list with no duplicates regardless of input order. The AT command itself (`AT+QNWPREFCFG="lte_band",3:7:28`) still uses colons — that is the modem's wire format, not the user contract. All-invalid input collapses to `""`, which the caller treats the same as `auto` (sends `0` = unlock).
- **Embed column-gutter / vertical-padding pattern**: `spacerField()` in `embeds.go` returns an invisible inline field (U+200B for `Name` and `Value`, `Inline: true`) used to widen Discord's column gutters. `/signal` inserts one after every 2 antennas to render a 2x2 grid with a visible right gutter. For vertical breathing between rows of inline fields, append `\n​` (newline + U+200B) to the field's `Value` — used in both antenna fields (`buildSignalEmbed`) and carrier-component fields (`ccField`). Discord rejects empty strings for `Name`/`Value`, so the zero-width space is required, not optional. When editing these format strings, preserve the U+200B bytes (UTF-8 `E2 80 8B`) — do not replace with regular spaces.
- **Source layout**: `main.go` (boot + handler registration), `handlers.go` (slash-command dispatch + per-command handlers + response helpers), `commands.go` (slash-command catalog), `cache.go` (status/events readers + `ModemStatus` shape), `embeds.go` (chrome helpers, action-row builder, button-expiry scheduler), `dm_channel.go` (DM channel cache I/O), `notify.go` (background notifier).

### Antenna Alignment

- **Route**: `/cellular/antenna-alignment`
- **No CGI endpoint** — reads exclusively from `useModemStatus` hook (poller cache `signal_per_antenna` field)
- **Component structure**: Coordinator pattern — `antenna-alignment.tsx` (coordinator) + `antenna-card.tsx` (per-port detail) + `alignment-meter.tsx` (3-position recording tool) + `utils.ts` (shared helpers/constants)
- **Shared constant**: Uses `ANTENNA_PORTS` from `types/modem-status.ts` (re-exported via local `utils.ts`)
- **Signal quality gotcha**: `getSignalQuality()` returns **lowercase** strings (`"excellent"`, `"good"`, `"fair"`, `"poor"`, `"none"`). All `switch`/map consumers MUST use lowercase keys.
- **Alignment Meter**: 3-slot recording tool that averages `SAMPLES_PER_RECORDING` (3) samples per slot. Compares composite RSRP+SINR scores (60/40 weight) to recommend best antenna position or angle.
- **Two antenna types**: Directional (angles: 0/45/90) and Omni (positions: A/B/C) — user-selectable via toggle group, labels are editable
- **Recording progress**: Uses `Loader2Icon` spinner + step dots (NOT fill bars — those are reserved for signal quality visualization per UI Component Conventions)
- **Radio mode detection**: `detectRadioMode()` inspects all 4 antennas for valid LTE/NR data and returns `"lte"`, `"nr"`, or `"endc"`
- **Best recommendation**: Appears after 2+ slots recorded; composite score = 60% RSRP + 40% SINR (primary antenna, NR preferred over LTE in EN-DC mode)

### Data Usage Counter (Bug 1 + Bug 2 fix in v0.1.10)

The persistent data-usage counter in `qmanager_poller` (`/usrdata/qmanager/data_used.json`) uses `AT+QGDNRCNT` as the single source of truth across LTE, NSA, and SA — empirically verified to track all RAT traffic identically on `RM520NGLAAR03A03M4G`. **Field order in `+QGDNRCNT` is firmware-specific**: Quectel-public docs say `<TX>,<RX>` (which AAR03A03 follows), but at least one user-reported firmware returns the fields reversed. The poller resolves this at runtime with a one-time **active calibration**: it drives a 1 MB curl download to `speed.cloudflare.com/__down?bytes=1048576`, snapshots the AT counter + `/proc/net/dev rmnet_ipa0` before and after, and locks `du_orientation` to whichever AT field grew in lockstep with the kernel's RX delta. The orientation is persisted to `data_used.json` and never re-evaluated except on user-triggered reset. Calibration is gated on `conn_internet_available == "true"` and capped at 10 attempts; past the cap, it freezes at the Quectel-public default `"tx,rx"` and emits a `data_calibration_failed` event. **The poller's shebang must remain `#!/bin/bash`** — BusyBox `sh` uses 32-bit signed `long` for `$(( ))` and `-lt`, which wraps the cumulative accumulator to negative once it crosses 2.15 GB. Bash 3.2 on this platform uses 64-bit `intmax_t`. The same constraint applies to any other script accumulating byte volumes across reboots.

## Shared Constants

- **`ANTENNA_PORTS`** (`types/modem-status.ts`): Canonical metadata for 4 antenna ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` and `antenna-alignment`. Any new per-antenna UI must import from here — do not duplicate port definitions.
