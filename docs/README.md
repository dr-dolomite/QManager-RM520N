# QManager Documentation

QManager is a modern web-based GUI for managing Quectel cellular modems. It supports two deployment targets: OpenWRT devices (RM551E-GL) and the Quectel RM520N-GL modem's internal Linux OS. It provides real-time signal monitoring, cellular configuration, network management, and advanced diagnostics through an intuitive interface.

**Version:** v0.1.2
**License:** MIT
**Successor to:** [SimpleAdmin](https://github.com/dr-dolomite/simpleadmin-mockup)

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System architecture, data flow, polling tiers, state management |
| [Frontend Guide](FRONTEND.md) | React components, hooks, pages, routing, and UI patterns |
| [Backend Guide](BACKEND.md) | Shell scripts, daemons, init.d services, shared libraries |
| [API Reference](API-REFERENCE.md) | Complete CGI endpoint reference with request/response schemas |
| [Design System](DESIGN-SYSTEM.md) | Colors, typography, components, theming, and UI conventions |
| [Deployment Guide](DEPLOYMENT.md) | Building, installing, and deploying to OpenWRT devices |
| [RM520N-GL Architecture](rm520n-gl-architecture.md) | AT command handling, system analysis, and porting guide for the RM520N-GL modem |
| [RM520N Phase 2: Systemd Migration](rm520n-phase2-systemd-migration.md) | Converting procd init.d scripts to systemd service units for the RM520N-GL port |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (package manager and runtime)
- Compatible Quectel modem:
  - **RM551E-GL** (on OpenWRT host) — primary target
  - **RM520N-GL** (standalone, internal Linux) — via `dev-rm520` branch
  - Other Quectel modems on OpenWRT (RM500Q, etc.)

### Development

```bash
git clone https://github.com/dr-dolomite/qmanager.git
cd qmanager
bun install
bun run dev        # Start dev server at http://localhost:3000
```

The dev server proxies `/cgi-bin/*` requests to `http://192.168.224.1` (configurable in `next.config.ts`).

### Production Build

```bash
bun run build      # Static export to out/
```

The `out/` directory contains the complete frontend — deploy it to the OpenWRT device's `/www/` directory.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend Framework** | Next.js 16 (App Router, static export) |
| **Language** | TypeScript 5, POSIX shell |
| **UI Components** | shadcn/ui (Radix UI primitives) |
| **Styling** | Tailwind CSS v4, OKLCH color system |
| **Charts** | Recharts 2.15 |
| **Forms** | React Hook Form + Zod validation |
| **Animations** | Motion (Framer Motion) |
| **Backend** | CGI shell scripts — OpenWRT (BusyBox /bin/sh) or RM520N-GL (bash) |
| **AT Commands** | `qcmd` wrapper — `sms_tool` (RM551E) or socat PTY bridge (RM520N-GL) |
| **Package Manager** | Bun |

---

## Key Features

- **Live Signal Monitoring** — Real-time RSRP, RSRQ, SINR with per-antenna values and historical charts
- **Band & Tower Locking** — Lock specific LTE/NR bands, frequencies, or cell towers (PCI)
- **APN Management** — Create, edit, and switch APN profiles with MNO presets
- **Custom SIM Profiles** — Save and apply multi-step configurations (APN + TTL/HL + Connection Scenario + IMEI), bound to a SIM by ICCID
- **Connection Watchdog** — 4-tier auto-recovery: Re-register to Network, CFUN toggle, SIM failover, reboot
- **Email Alerts** — Downtime notifications via Gmail SMTP on recovery
- **Latency Monitoring** — Real-time ping with 24-hour history and aggregated views
- **Cell Scanner** — Active and neighbor cell scanning with frequency calculator
- **Network Settings** — Ethernet link speed, TTL/HL, MTU, DNS, IP passthrough
- **System Settings** — WAN Guard toggle, unit preferences (temp/distance), timezone, scheduled reboot, low power mode
- **Tailscale VPN** — Status monitoring and management
- **Dark/Light Mode** — Full theme support with OKLCH colors
- **Multi-Platform** — Supports both OpenWRT (RM551E) and standalone RM520N-GL deployments

---

## Project Structure Overview

```
QManager/
├── app/                    # Next.js App Router pages
├── components/             # React components (~150 files)
│   ├── ui/                 # shadcn/ui primitives (42 components)
│   ├── cellular/           # Cellular management UI
│   ├── dashboard/          # Home dashboard cards
│   ├── local-network/      # Network settings UI
│   └── monitoring/         # Monitoring & alerts UI
├── hooks/                  # Custom React hooks (30 files)
├── types/                  # TypeScript interfaces (14 files)
├── lib/                    # Utilities (auth-fetch, earfcn, csv, cn)
├── constants/              # Static data (MNO presets, event labels)
├── public/                 # Static assets (logo SVG)
├── scripts/                # Backend shell scripts
│   ├── etc/init.d/         # Init.d services (8)
│   ├── usr/bin/            # Daemons & utilities (18)
│   ├── usr/lib/qmanager/   # Shared libraries (10)
│   └── www/cgi-bin/        # CGI endpoints (60 scripts)
├── simpleadmin-source/     # Reference: original RM520N-GL admin panel
└── docs/                   # This documentation
```

See [Architecture](ARCHITECTURE.md) for detailed diagrams and data flow explanations.
