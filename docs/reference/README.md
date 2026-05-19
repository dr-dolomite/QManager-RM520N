# Reference Docs

Detailed operational notes extracted from `CLAUDE.md` to keep the always-loaded project instructions lean. Each file is self-contained — read it only when working on that subsystem.

| Doc | Read when you are working on... |
|-----|---------------------------------|
| [at-command-transport.md](at-command-transport.md) | Issuing AT commands — `atcli_smd11`, `qcmd`, `flock` serialization, `sms_tool` |
| [qmanager-independence.md](qmanager-independence.md) | Installer, Entware bootstrap, `/dev/smd11` udev permissions, CGI auth, service persistence, firewall, Tailscale, web console, email/SMS alerts, OTA pipeline |
| [discord-bot.md](discord-bot.md) | The Discord bot (`discord-bot/`, `qmanager_discord`) |
| [antenna-alignment.md](antenna-alignment.md) | The antenna alignment tool (`/cellular/antenna-alignment`) |
| [data-usage-counter.md](data-usage-counter.md) | The persistent data-usage counter (kernel `/proc/net/dev`-sourced, schema v3) |

For broader architecture, see `../rm520n-gl-architecture.md` and `../ARCHITECTURE.md`.
