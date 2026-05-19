## How to Use This File

This file is loaded into **every** session — keep it lean. Everything here is a **golden rule to follow**: the Communication Style, Design Context, and platform/backend truths below are non-negotiable and always apply.

Detailed feature and subsystem notes have been moved to `docs/reference/`. **Do NOT read those reference docs preemptively** — open one only when the current task actually touches that subsystem. Reading them "just in case" wastes context.

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

## RM520N-GL Platform

QManager targets the Quectel RM520N-GL modem, which runs **vanilla Linux internally** (SDXLEMUR SoC, ARMv7l, kernel 5.4.210) — NOT OpenWRT on an external host. The `dev-rm520` branch carried this work; it is now the mainline target.

### System Differences

The table below contrasts RM520N-GL against the legacy RM551E (OpenWRT) target — useful when porting or reading older code.

| Concern | RM551E (OpenWRT) | RM520N-GL (Vanilla Linux) |
|---------|-----------------|---------------------------|
| Init system | procd | systemd (`.service` units in `/lib/systemd/system/`) |
| Config store | UCI | Files in `/usrdata/` (persistent partition) |
| Root filesystem | Read-write | UBIFS — read-only by default on stock boot (`mount -o remount,rw /`) |
| Shell | BusyBox sh (POSIX only) | `/bin/bash` available |
| Web server | uhttpd | lighttpd (Entware) |
| Firewall | nftables / fw4 | iptables direct |
| TTL interface | `wwan0` | `rmnet+` |
| Package manager | opkg (system) | Entware opkg at `/opt` (dedicated UBIFS volume) |
| LAN config | UCI (`network.*`) | `/etc/data/mobileap_cfg.xml` via xmlstarlet |

### Reference Docs

Read these only when working on the relevant subsystem:

- **AT command transport** (`atcli_smd11`, `qcmd`, SMS, flock serialization) — `docs/reference/at-command-transport.md`
- **QManager standalone install & runtime internals** (Entware bootstrap, udev permissions, CGI auth, service persistence, firewall, Tailscale, web console, email/SMS alerts, OTA pipeline) — `docs/reference/qmanager-independence.md`
- **Full platform architecture** (platform internals, Entware bootstrapping, lighttpd config, boot sequences, troubleshooting) — `docs/rm520n-gl-architecture.md`

**Source reference:** `simpleadmin-source/` contains the original RM520N-GL admin panel (iamromulan/quectel-rgmii-toolkit) for historical reference. QManager is now fully independent and does not require SimpleAdmin to be installed.

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

Detailed operational notes for individual features live in `docs/reference/`. Read the relevant file only when working on that feature:

- **Discord Bot** (`discord-bot/`, deployed as `/usr/bin/qmanager_discord`) — `docs/reference/discord-bot.md`
- **Antenna Alignment** (`/cellular/antenna-alignment`) — `docs/reference/antenna-alignment.md`
- **Data Usage Counter** (`AT+QGDNRCNT`, calibration, `du_orientation`) — `docs/reference/data-usage-counter.md`

## Shared Constants

- **`ANTENNA_PORTS`** (`types/modem-status.ts`): Canonical metadata for 4 antenna ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` and `antenna-alignment`. Any new per-antenna UI must import from here — do not duplicate port definitions.
