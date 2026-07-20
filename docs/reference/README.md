# Reference Docs

Detailed operational notes extracted from `CLAUDE.md` to keep the always-loaded project instructions lean. Each file is self-contained — read it only when working on that subsystem.

| Doc | Read when you are working on... |
|-----|---------------------------------|
| [at-command-transport.md](at-command-transport.md) | Issuing AT commands — `atcli_smd11`, `qcmd`, `flock` serialization, `sms_tool` |
| [qmanager-independence.md](qmanager-independence.md) | Installer, Entware bootstrap, `/dev/smd11` udev permissions, CGI auth, service persistence, firewall, Tailscale, web console, email/SMS alerts, OTA pipeline |
| [alerts.md](alerts.md) | Centralized Alerts (`/monitoring/alerts`, `monitoring/alerts.sh`, `alert_engine.sh` — SMS/email/Discord routing×capability matrix, boot-id reboot ledger, Discord IPC contract, split-ownership boundaries) |
| [discord-bot.md](discord-bot.md) | The Discord bot (`discord-bot/`, `qmanager_discord` — now a pure DM transport driven by `alert_engine.sh`) |
| [antenna-alignment.md](antenna-alignment.md) | The antenna alignment tool (`/cellular/antenna-alignment`) |
| [custom-dns.md](custom-dns.md) | The Custom DNS feature (`/local-network/custom-dns`, dnsmasq upstream override via sentinel block in `/etc/data/dnsmasq.conf`) |
| [data-usage-counter.md](data-usage-counter.md) | The persistent data-usage counter (kernel `/proc/net/dev`-sourced, schema v5 with static SoC-based orientation) |
| [wan-profile-management.md](wan-profile-management.md) | WAN Profile / APN management (`cellular/apn.sh`, 6 PDP contexts, AT-only) |
| [sim-profiles.md](sim-profiles.md) | Custom SIM Profiles (4-step apply, `scenario_id` binding, gate matrix, `profile_managed` guard) |
| [connection-watchdog.md](connection-watchdog.md) | Connection Watchdog (`qmanager_watchcat` 4-tier recovery ladder, Tier-3 SIM failover / Golden Rule / 90s settle floor, misconfig-stops-ladder, two-pass CGI validation, status-first UI) |
| [connection-quality.md](connection-quality.md) | Connection Quality — the measurement/telemetry side (`qmanager_ping` Rust HTTP/204 producer, poller latency/jitter/loss stats, Probe Targets + Latency & Loss Thresholds cards, `ping_profile.json` two-writer contract) |
| [overview-splash.md](overview-splash.md) | The public Overview splash at `/` (unauthenticated landing, the 3-state `/` gate, 3 public CGI endpoints under `public/`, `credentials:"omit"` hooks, logout→`/` wiring) |
| [timezone.md](timezone.md) | Timezone / system clock (glibc `/etc/localtime` via `qmanager_timezone_apply` root helper, zoneinfo at `/opt/share/zoneinfo`, `sys_get_effective_tz` ground-truth, cron adopts zone on next reboot) |

For broader architecture, see `../rm520n-gl-architecture.md` and `../ARCHITECTURE.md`.
