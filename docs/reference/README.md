# Reference Docs

Detailed operational notes extracted from `CLAUDE.md` to keep the always-loaded project instructions lean. Each file is self-contained — read it only when working on that subsystem.

| Doc | Read when you are working on... |
|-----|---------------------------------|
| [at-command-transport.md](at-command-transport.md) | Issuing AT commands — `atcli_smd11`, `qcmd`, `flock` serialization, `sms_tool` |
| [qmanager-independence.md](qmanager-independence.md) | Installer, Entware bootstrap, `/dev/smd11` udev permissions, CGI auth, service persistence, firewall, Tailscale, web console, email/SMS alerts, OTA pipeline |
| [discord-bot.md](discord-bot.md) | The Discord bot (`discord-bot/`, `qmanager_discord`) |
| [antenna-alignment.md](antenna-alignment.md) | The antenna alignment tool (`/cellular/antenna-alignment`) |
| [custom-dns.md](custom-dns.md) | The Custom DNS feature (`/local-network/custom-dns`, dnsmasq upstream override via sentinel block in `/etc/data/dnsmasq.conf`) |
| [data-usage-counter.md](data-usage-counter.md) | The persistent data-usage counter (kernel `/proc/net/dev`-sourced, schema v3) |
| [wan-profile-management.md](wan-profile-management.md) | WAN Profile / APN management (`cellular/apn.sh`, 6 PDP contexts, AT-only) |
| [sim-profiles.md](sim-profiles.md) | Custom SIM Profiles (4-step apply, `scenario_id` binding, gate matrix, `profile_managed` guard) |

For broader architecture, see `../rm520n-gl-architecture.md` and `../ARCHITECTURE.md`.
