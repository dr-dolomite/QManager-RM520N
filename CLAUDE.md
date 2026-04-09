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
- `atcli_smd11` opens `/dev/smd11` directly via `fopen()` — no PTY bridge or socat services needed
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
- **`/dev/smd11` permissions:** defaults to `crw------- root:root` — `qmanager_setup` sets `chmod 660` + `chown root:dialout` at every boot
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
- **Port firewall:** `qmanager-firewall.service` restricts web UI (ports 80/443) to trusted interfaces (lo, bridge0, eth0, tailscale0 if installed). Blocks cellular-side access. Replaces SimpleAdmin's `simplefirewall` — QManager-owned, installed by default. SSH (22) intentionally left open for emergency access.
- **Tailscale VPN:** Installed on-demand via `qmanager_tailscale_mgr` helper — auto-detects latest stable ARM version from `pkgs.tailscale.com` (falls back to v1.92.5). Stores at `/usrdata/tailscale/` with `chmod 755` (www-data needs read+execute for `is_installed()` check). Service controlled via `tailscaled.service`. Boot persistence via symlink into `multi-user.target.wants/`. Firewall service automatically trusts `tailscale0` when Tailscale is installed. `tailscale up` must NOT use `--json` flag — its output is fully buffered on RM520N-GL (no `stdbuf`) and never flushes to file; use interactive mode and grep for the auth URL instead. No dependency on SimpleAdmin.
- **Web console:** `qmanager-console.service` runs ttyd v1.7.7 (armhf) on localhost:8080, reverse-proxied by lighttpd at `/console` with WebSocket upgrade. Downloaded during install (non-fatal if offline). Binary at `/usrdata/qmanager/console/ttyd`. Theme matches QManager dark mode. Shell startup script sets PATH for Entware tools.
- **Email alerts:** `msmtp` installed from Entware (`/opt/bin/msmtp`). Generated msmtprc at `/etc/qmanager/msmtprc` must NOT include a `logfile` directive — msmtp returns rc=1 if it can't write its log, even when the email sends successfully. The `email_alerts.sh` library detects msmtp at `/opt/bin/msmtp` explicitly (poller PATH lacks `/opt/bin`). Recovery emails wait 30s after connectivity returns for DNS/SMTP to stabilize before the first send attempt.

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

## Shared Constants

- **`ANTENNA_PORTS`** (`types/modem-status.ts`): Canonical metadata for 4 antenna ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` and `antenna-alignment`. Any new per-antenna UI must import from here — do not duplicate port definitions.
