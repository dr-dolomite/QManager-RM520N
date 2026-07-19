# QManager Documentation

QManager is a modern web-based GUI that runs **on the Quectel RM520N-GL modem itself** — served from the modem's internal vanilla Linux OS (systemd, lighttpd serving CGI shell scripts as `www-data`, bash available alongside BusyBox applets). It provides real-time signal monitoring, cellular configuration, network management, and advanced diagnostics through an intuitive interface, with no external OpenWRT host required.

**Version:** see `package.json` (`version` field) — this doc no longer hardcodes it to avoid drift.
**License:** MIT + Commons Clause
**Successor to:** [SimpleAdmin](https://github.com/iamromulan/quectel-rgmii-toolkit) (QManager is now fully independent of SimpleAdmin)

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System architecture, data flow, polling tiers, state management |
| [Frontend Guide](FRONTEND.md) | React components, hooks, pages, routing, and UI patterns |
| [Backend Guide](BACKEND.md) | CGI shell scripts, poller/daemons, systemd services, shared libraries |
| [API Reference](API-REFERENCE.md) | Complete CGI endpoint reference with request/response schemas |
| [Design System](DESIGN-SYSTEM.md) | Developer reference (shadcn setup, component inventory, responsive recipes, theming mechanism). Visual authority is root [`DESIGN.md`](../DESIGN.md) |
| [Deployment Guide](DEPLOYMENT.md) | Building the static export and installing onto the RM520N-GL |
| [Contributing Translations](CONTRIBUTING-translations.md) | Non-developer guide to adding/completing a language with the `bun run lang` toolkit (pairs with [reference/i18n.md](reference/i18n.md)) |
| [RM520N-GL Architecture](rm520n-gl-architecture.md) | Platform internals, Entware bootstrap, lighttpd, boot sequence, AT handling, troubleshooting |
| [RM520N Phase 2: Systemd Migration](rm520n-phase2-systemd-migration.md) | Converting the legacy procd/init.d model to systemd service units for the RM520N-GL |
| [reference/](reference/) | Per-feature and per-subsystem operational notes (AT transport, data usage counter, WAN profiles, SIM profiles, connection watchdog, Discord bot, custom DNS, antenna alignment, timezone, install/runtime internals). See [reference/README.md](reference/README.md) for the index. |

> ℹ️ NOTE: Product/vision docs (`PRODUCT.md`), the visual design system (`DESIGN.md`), and the working agreement / platform golden rules (`CLAUDE.md`) live in the **repo root**, not in `docs/`.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (package manager and runtime)
- A Quectel **RM520N-GL** modem (SDXLEMUR SoC, ARMv7l, kernel 5.4.210) running its stock vanilla Linux OS — the single supported target

### Development

```bash
git clone https://github.com/dr-dolomite/qmanager.git
cd qmanager
bun install
bun run dev        # Start dev server at http://localhost:3000
```

To talk to a live modem during local dev, uncomment the `rewrites()` block in `next.config.ts`. It proxies `/cgi-bin/*` to the modem — default `http://192.168.225.1` (a Tailscale hostname alternative is included, commented out). Re-comment the block before running a static-export build.

### Production Build

```bash
bun run build      # Static export to out/
```

The `out/` directory contains the complete static frontend. The installer (`scripts/install_rm520n.sh`) copies it onto the modem's persistent UBIFS partition at **`/usrdata/qmanager/www/`**, with CGI endpoints under **`/usrdata/qmanager/www/cgi-bin/quecmanager/`**. lighttpd serves both. See the [Deployment Guide](DEPLOYMENT.md) for the full install/OTA flow.

> ℹ️ NOTE: The modem's root filesystem is UBIFS and read-only by default on stock boot. Persistent app state lives under `/usrdata/` and `/etc/qmanager/`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend Framework** | Next.js 16 (App Router, static export) |
| **Language** | TypeScript 5, shell (bash + BusyBox applets) |
| **UI Components** | shadcn/ui (Radix UI primitives) |
| **Styling** | Tailwind CSS v4, OKLCH color system |
| **Charts** | Recharts 2.15 |
| **Forms** | React Hook Form + Zod validation |
| **Animations** | Motion (Framer Motion) |
| **Backend** | CGI shell scripts on vanilla Linux, run as `www-data` by lighttpd (bash available, many commands are BusyBox applets) |
| **AT Commands** | `qcmd` wrapper serializing access (via `flock`) to `atcli_smd11` on `/dev/smd11` (direct, no socat/PTY bridge); SMS via `sms_tool` |
| **Package Manager** | Bun |

---

## Key Features

- **Live Signal Monitoring** — Real-time RSRP, RSRQ, SINR with per-antenna values and historical charts
- **Band & Tower Locking** — Lock specific LTE/NR bands, frequencies, or cell towers (PCI)
- **APN Management** — Create, edit, and switch WAN/APN profiles (6 PDP contexts) with MNO presets
- **Custom SIM Profiles** — Save and apply multi-step configurations (APN + TTL/HL + Connection Scenario + IMEI), bound to a SIM by ICCID
- **Connection Watchdog** — Multi-tier auto-recovery (re-register, CFUN toggle, SIM/tower failover, reboot)
- **Latency Monitoring** — Real-time ping with history and aggregated views
- **Cell Scanner** — Active and neighbor cell scanning with a frequency calculator
- **Antenna Alignment** — Guided per-port aiming using live signal metrics
- **Data Usage Counter** — Kernel-sourced RX/TX accounting with persistence across reboots
- **Network Settings** — Ethernet link speed (2.5GbE `eth0`), TTL/HL, MTU, custom DNS, IP passthrough
- **Alerts** — Email (Gmail SMTP), SMS, and Discord-bot notifications on downtime/recovery
- **Tailscale VPN** — Status monitoring and management
- **System Tools** — OTA software update, AT terminal, web console, log viewer, system health check, timezone/unit preferences, scheduled reboot
- **Dark/Light Mode** — Full theme support with OKLCH colors

---

## Project Structure Overview

```
QManager/
├── app/                    # Next.js App Router pages (cellular, local-network, monitoring, system-settings, ...)
├── components/             # React components
│   ├── ui/                 # shadcn/ui primitives
│   ├── cellular/           # Cellular management UI
│   ├── dashboard/          # Home dashboard cards
│   ├── local-network/      # Network settings UI
│   └── monitoring/         # Monitoring & alerts UI
├── hooks/                  # Custom React hooks
├── types/                  # TypeScript interfaces
├── lib/                    # Utilities (auth-fetch, earfcn, csv, cn)
├── constants/              # Static data (MNO presets, event labels)
├── public/                 # Static assets (logo SVG)
├── scripts/                # Backend + install/uninstall
│   ├── install_rm520n.sh   # Installer (deploys to /usrdata/qmanager)
│   ├── uninstall_rm520n.sh # Uninstaller
│   ├── etc/systemd/system/ # systemd service units (qmanager-poller, -ping, -watchcat, -console, ...)
│   ├── etc/sudoers.d/      # sudoers rules granting www-data scoped root helpers
│   ├── etc/udev/           # udev rules (device node permissions)
│   ├── usr/bin/            # Daemons & root helpers (poller, discord bot, etc.)
│   ├── usr/lib/qmanager/   # Shared shell libraries (qcmd, cgi_base, helpers)
│   └── www/cgi-bin/quecmanager/  # CGI endpoints, grouped by subsystem (at_cmd, auth, bands, cellular, ...)
├── simpleadmin-source/     # Reference: original RM520N-GL admin panel (historical)
└── docs/                   # This documentation
```

See [Architecture](ARCHITECTURE.md) for detailed diagrams and data flow explanations.
</content>
