# RM520N-GL Architecture Report — AT Command Handling & System Analysis

This document provides a comprehensive technical analysis of the Quectel RM520N-GL modem's internal architecture, focusing on the AT command transport layer, system services, and CGI infrastructure. It serves as the primary reference for porting QManager from its current RM551E-on-OpenWRT target to the RM520N-GL's vanilla Linux environment.

The RM520N-GL is a fundamentally different platform: it runs its own Linux OS internally (not OpenWRT on an external host), uses systemd instead of procd, and relies on a socat-based PTY bridge for AT command access instead of `sms_tool`. Every subsystem — init, packaging, config storage, serial transport, web serving, and firewall — requires adaptation.

---

## Table of Contents

- [Quick Reference](#quick-reference)
- [Platform Comparison](#platform-comparison)
- [SimpleAdmin RGMII Toolkit Foundation](#simpleadmin-rgmii-toolkit-foundation)
  - [Toolkit Overview](#toolkit-overview)
  - [Installation Flow](#installation-flow)
  - [Entware Bootstrapping](#entware-bootstrapping)
  - [Lighttpd Web Server Configuration](#lighttpd-web-server-configuration)
  - [HTTPS Certificate and Authentication](#https-certificate-and-authentication)
  - [Console and TTY Architecture (ttyd)](#console-and-tty-architecture-ttyd)
  - [SimpleFirewall Subsystem](#simplefirewall-subsystem)
  - [TTL Override Mechanism](#ttl-override-mechanism)
  - [SimpleUpdate System](#simpleupdate-system)
  - [Complete Boot Sequence](#complete-boot-sequence)
- [Known Platform Quirks](#known-platform-quirks)
  - [`fs.protected_regular=1` — Sticky Directory File Protection](#fsprotected_regular1--sticky-directory-file-protection)
  - [`systemctl enable` Does Not Work for Boot Startup](#systemctl-enable-does-not-work-for-boot-startup)
- [AT Command Transport Layer](#at-command-transport-layer)
  - [Physical Layer: SMD Ports](#physical-layer-smd-ports)
  - [PTY Bridge Architecture](#pty-bridge-architecture)
  - [Socat PTY Parameters Explained](#socat-pty-parameters-explained)
  - [Data Flow Diagram](#data-flow-diagram)
  - [AT Command Tools](#at-command-tools)
  - [QManager qcmd Integration](#qmanager-qcmd-integration)
  - [Systemd Service Dependency Graph](#systemd-service-dependency-graph)
  - [Socat-AT-Bridge Installation](#socat-at-bridge-installation)
  - [Troubleshooting: AT Bridge](#troubleshooting-at-bridge)
  - [Porting Considerations: AT Transport](#porting-considerations-at-transport)
- [System Architecture](#system-architecture)
  - [Platform Specs](#platform-specs)
  - [Filesystem Layout](#filesystem-layout)
  - [Service Hierarchy](#service-hierarchy)
  - [Package Management (Entware)](#package-management-entware)
- [CGI and Web UI Layer](#cgi-and-web-ui-layer)
  - [Web Server: lighttpd](#web-server-lighttpd)
  - [CGI AT Command Execution](#cgi-at-command-execution)
  - [Existing CGI Endpoints](#existing-cgi-endpoints)
  - [Security Concerns](#security-concerns)
  - [Frontend (Existing)](#frontend-existing)
- [Networking and Firewall](#networking-and-firewall)
  - [RGMII Ethernet](#rgmii-ethernet)
  - [Firewall and TTL](#firewall-and-ttl)
  - [LAN Configuration](#lan-configuration)
- [Development Access](#development-access)
- [Watchdog Services](#watchdog-services)
- [VPN (Tailscale)](#vpn-tailscale)
- [Porting Strategy Summary](#porting-strategy-summary)
- [Custom SIM Profiles — Auto-Apply on ICCID Match](#custom-sim-profiles--auto-apply-on-iccid-match)
- [Appendix: AT Commands Unique to RM520N-GL](#appendix-at-commands-unique-to-rm520n-gl)

---

## Quick Reference

| Item | Value |
|------|-------|
| **SoC / Kernel** | Qualcomm SDXLEMUR, Linux 5.4.180, ARMv7l (32-bit) |
| **Init system** | systemd |
| **Shell** | `/bin/bash` (native, not BusyBox) |
| **AT port (QManager)** | `/dev/smd11` (direct access via `atcli_smd11`, no socat needed) |
| **AT port (legacy)** | `/dev/smd7` (claimed by `port_bridge` at boot — used by socat-at-bridge if installed) |
| **AT tools** | `atcli_smd11` via `qcmd` (production), `microcom` (interactive), `atcmd`/`atcmd11` (legacy socat) |
| **Web server** | lighttpd (Entware, HTTPS on 443) |
| **Config storage** | `/usrdata/` (persistent, writable) |
| **LAN config** | `/etc/data/mobileap_cfg.xml` (xmlstarlet) |
| **Root filesystem** | ubifs (`ubi0:rootfs`), boots read-only (`mount -o remount,rw /`); `sync` before reboot |
| **`/etc/`** | tmpfs — **volatile** (lost on reboot); exception: `/etc/qmanager/` is on rootfs |
| **Persistent partition** | `/usrdata/` |
| **Package manager** | Entware opkg at `/opt` (bind-mounted from `/usrdata/opt`) |
| **Firewall** | iptables (direct rules, no framework like fw4) |
| **TTL interface** | `rmnet+` (wildcard, not `wwan0`) |
| **Default gateway** | `192.168.225.1` |

---

## Platform Comparison

This table maps every major subsystem between the current QManager target (RM551E on OpenWRT) and the RM520N-GL. Every row represents a porting decision.

| Aspect | RM551E (OpenWRT) | RM520N-GL (Vanilla Linux) | Porting Impact |
|--------|------------------|---------------------------|----------------|
| **OS** | OpenWRT on host router | SDXLEMUR vanilla Linux (on-modem) | Different userspace assumptions |
| **Init** | procd + rc.d | systemd | Rewrite all init.d scripts as `.service` units |
| **Package mgr** | opkg (built-in) | Entware opkg at `/opt` | Different package names, install paths |
| **Root FS** | Writable (SquashFS + overlay) | Read-only (remount required) | Must stage writes, prefer `/usrdata/` |
| **AT transport** | `sms_tool` via USB CDC ACM | `sms_tool` (bundled static ARM binary) via socat PTY bridge on internal SMD | `qcmd` wrapper rewritten for flock + ttyOUT2 |
| **AT device** | USB device (host-side) | `/dev/smd7`, `/dev/smd11` (internal) | No USB enumeration dependency |
| **AT locking** | Implicit (single `sms_tool` call) | `flock` in `qcmd` (read-only FD for `fs.protected_regular`) | Implemented: `qcmd` serializes all access |
| **Web server** | uhttpd (built-in) | lighttpd (Entware) | Different CGI config, auth mechanism |
| **Firewall** | nftables (fw4) | iptables (direct) | Rewrite all firewall rules |
| **TTL interface** | `wwan0` | `rmnet+` (wildcard) | Update interface names in rules |
| **CGI shell** | `/bin/sh` (BusyBox ash) | `/bin/bash` | More features available; decide on POSIX compat |
| **Config system** | UCI (`/etc/config/`) | Files in `/usrdata/` + XML for LAN | Replace all `uci` calls |
| **Persistent storage** | `/overlay/`, `/etc/` | `/usrdata/`, rootfs (`/lib/systemd/`, `/etc/qmanager/`). `/etc/` itself is tmpfs (volatile). | Different backup/restore paths |
| **Auth** | Cookie-based multi-session | HTTP Basic Auth (`.htpasswd`) | Different auth middleware |
| **LAN config** | UCI network config | XML (`mobileap_cfg.xml`) via xmlstarlet | Completely different API |
| **Compound AT** | Semicolon batching via `qcmd` | Supported, but needs serialization | Add `flock` around compound commands |
| **`fs.protected_regular`** | Not set (typical) | `=1` (kernel default) | All shared `/tmp` files must be `www-data`-owned; see [Known Platform Quirks](#known-platform-quirks) |

---

## SimpleAdmin RGMII Toolkit Foundation

QManager on the RM520N-GL builds on top of the **SimpleAdmin** web panel, originally created by the [quectel-rgmii-toolkit](https://github.com/iamromulan/quectel-rgmii-toolkit) project. Understanding this foundation is essential because QManager reuses its Entware installation, lighttpd web server, socat-at-bridge, firewall infrastructure, and systemd service patterns. The toolkit source is preserved in `simpleadmin-source/` for reference.

### Toolkit Overview

The `RMxxx_rgmii_toolkit.sh` master installer script is the entry point for all RM520N-GL setup. It validates the hardware is ARMv7l (32-bit ARM) and provides an interactive menu to install components:

| Component | Installer Script | Purpose |
|-----------|-----------------|---------|
| **Entware** | `installentware.sh` / inline | Package manager (`/opt` bind-mounted from `/usrdata/opt`) |
| **SimpleAdmin** | `update_simpleadmin.sh` | Web panel (lighttpd + CGI + ttyd console) |
| **socat-at-bridge** | `update_socat-at-bridge.sh` | Virtual TTY bridge for AT commands |
| **SimpleFirewall** | `update_simplefirewall.sh` | iptables port blocking + TTL override |
| **SimpleUpdate** | Bundled with toolkit | Automatic component updater daemon |
| **SSH (Dropbear)** | `update_sshd.sh` | SSH server for remote access |
| **Tailscale** | `update_tailscale.sh` | VPN client (optional) |

Each component has a `.rev` file for version tracking (e.g., `/usrdata/simpleadmin/.rev`, `/usrdata/socat-at-bridge/.rev`).

### Installation Flow

The toolkit installs SimpleAdmin through a multi-stage process. Each stage is idempotent — re-running updates rather than duplicates.

#### Stage 1: Entware Bootstrap (`ensure_entware_installed()`)

1. **Remount root filesystem read-write:** `mount -o remount,rw /`
2. **Install opkg:** Downloads from `http://bin.entware.net/armv7sf-k3.2/installer/` if `/opt/bin/opkg` is missing
3. **Bootstrap Entware:** `opkg update && opkg install entware-opt`
4. **System integration:**
   - Links `/opt/etc/passwd`, `/opt/etc/group`, `/opt/etc/shadow` etc. from `/etc/`
   - Creates `/opt/tmp` (mode 777)
   - Installs `shadow-login`, `shadow-passwd`, `shadow-useradd`
5. **Root user setup:**
   - Creates `/usrdata/root` home directory
   - Writes `/usrdata/root/.profile` with PATH including `/opt/bin:/opt/sbin`
   - Modifies `/opt/etc/passwd` to point root home to `/usrdata/root`
   - Replaces `/bin/login` with symlink to `/opt/bin/login`
   - Prompts for root password
6. **Utility installation:** `opkg install mc htop dfc lsof` + symlinks to `/bin/`
7. **Systemd mount units:**
   - Creates `/lib/systemd/system/opt.mount` to bind `/usrdata/opt` → `/opt`
   - Creates `/lib/systemd/system/rc.unslung.service` to start Entware init.d services at boot
   - Enables both services

#### Stage 2: SimpleAdmin Components (`install_simple_admin()`)

Installs dependencies in order, then the web panel:

1. **socat-at-bridge** — via `update_socat-at-bridge.sh` (see [Socat-AT-Bridge Installation](#socat-at-bridge-installation))
2. **SimpleFirewall** — via `update_simplefirewall.sh`
3. **Admin password** — installs `htpasswd` from Entware, creates `/opt/etc/.htpasswd`
4. **SimpleAdmin content** — via `update_simpleadmin.sh`:
   - Downloads web panel files to `/usrdata/simpleadmin/`
   - Installs lighttpd + required modules via Entware opkg
   - Generates self-signed HTTPS certificate
   - Installs ttyd terminal server binary
   - Creates and enables systemd services for lighttpd and ttyd
   - Remounts root filesystem read-only when done

### Entware Bootstrapping

Entware provides the package management layer on the RM520N-GL. It is the equivalent of OpenWRT's built-in opkg but installed as an overlay.

**Target architecture:** `armv7sf-k3.2` (soft float, kernel 3.2+, glibc 2.27)

**Mount architecture:**
```
/usrdata/opt/          (persistent partition, survives reboots)
    ↓ bind mount via opt.mount
/opt/                  (standard Entware path)
    ├── bin/           (user binaries: opkg, curl, sudo, mc, htop, etc.)
    ├── sbin/          (system binaries: lighttpd, dropbear)
    ├── etc/           (config: opkg.conf, .htpasswd, lighttpd/, sudoers.d/)
    ├── lib/           (shared libraries for Entware packages)
    ├── var/run/       (runtime files: lighttpd.pid)
    └── tmp/           (Entware temp, mode 777)
```

**Boot mount units:**
- `opt.mount` — systemd `.mount` unit that bind-mounts `/usrdata/opt` → `/opt`
- `rc.unslung.service` — runs `/opt/etc/init.d/rc.unslung start` after mount, initializing any Entware services with init.d scripts

**Critical symlinks created during install:**
```
/bin/opkg    → /opt/bin/opkg
/bin/mc      → /opt/bin/mc
/bin/htop    → /opt/bin/htop
/bin/login   → /opt/bin/login     (replaces stock login with shadow-login)
/usr/bin/passwd  → /opt/bin/passwd
/usr/bin/useradd → /opt/bin/useradd
```

### Lighttpd Web Server Configuration

Lighttpd serves both SimpleAdmin's original web panel and QManager's replacement frontend. Understanding its configuration is essential because QManager reuses it.

**Configuration file:** `/usrdata/simpleadmin/lighttpd.conf`
**Binary:** `/opt/sbin/lighttpd` (from Entware)
**Service:** `/lib/systemd/system/lighttpd.service`

#### Service Definition

```ini
[Unit]
Description=Lighttpd Daemon
After=network.target opt.mount         # /opt must be mounted (lighttpd binary is there)

[Service]
Type=simple
PIDFile=/opt/var/run/lighttpd.pid
ExecStartPre=/opt/sbin/lighttpd -tt -f /usrdata/simpleadmin/lighttpd.conf   # syntax check
ExecStart=/opt/sbin/lighttpd -D -f /usrdata/simpleadmin/lighttpd.conf       # foreground daemon
ExecReload=/bin/kill -USR1 $MAINPID                                          # graceful reload
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

#### Server Configuration

```apache
server.username  = "www-data"            # Process runs as www-data
server.groupname = "dialout"             # dialout group grants access to /dev/ttyOUT*
server.port      = 80                    # HTTP port (redirected to HTTPS)
server.document-root = "/usrdata/simpleadmin/www"
index-file.names = ( "index.html" )
```

**Loaded modules:**
```apache
server.modules = (
    "mod_redirect",        # HTTP → HTTPS redirect
    "mod_cgi",             # CGI script execution
    "mod_proxy",           # Reverse proxy (for ttyd console)
    "mod_openssl",         # HTTPS/TLS
    "mod_authn_file",      # HTTP Basic Auth via htpasswd file
)
```

#### HTTP → HTTPS Redirect

```apache
$HTTP["scheme"] == "http" {
    url.redirect = ("" => "https://${url.authority}${url.path}${qsa}")
}
```

All HTTP requests are automatically redirected to HTTPS. Query strings are preserved (`${qsa}`).

#### CGI Script Handling

```apache
$HTTP["url"] =~ "/cgi-bin/" {
    cgi.assign = ( "" => "" )
}
```

All files in `/cgi-bin/` are treated as executable CGI scripts. The empty `cgi.assign` value means the script's shebang line (`#!/bin/bash`) determines the interpreter. Scripts must have execute permission (`chmod +x`).

CGI scripts run as `www-data:dialout` (lighttpd's process user). This grants:
- Direct read/write access to `/dev/ttyOUT` and `/dev/ttyOUT2` (serial devices in dialout group)
- No root access — elevated operations require sudo (see [Authentication and Sudo](#https-certificate-and-authentication))

#### Console Reverse Proxy (ttyd)

```apache
$HTTP["url"] =~ "(^/console)" {
    proxy.header = (
        "map-urlpath" => ( "/console" => "/" ),
        "upgrade" => "enable"                     # WebSocket upgrade for interactive terminal
    )
    proxy.server = ( "" => ("" => ( "host" => "127.0.0.1", "port" => 8080 )))
}
```

The `/console` URL path is proxied to ttyd running on `127.0.0.1:8080`. WebSocket upgrade is enabled for the interactive terminal session. ttyd itself is bound to localhost only — external access goes through lighttpd's auth layer.

### HTTPS Certificate and Authentication

#### Self-Signed Certificate Generation

During installation, the toolkit generates a self-signed TLS certificate:

```bash
openssl req -new -newkey rsa:2048 -days 3650 -nodes -x509 \
    -subj "/C=US/ST=MI/L=Romulus/O=RMIITools/CN=localhost" \
    -keyout /usrdata/simpleadmin/server.key \
    -out /usrdata/simpleadmin/server.crt
```

- **RSA 2048-bit** key, **10-year** validity
- Self-signed (browsers will show a certificate warning)
- Stored on persistent partition (`/usrdata/simpleadmin/`)

#### SSL Configuration

```apache
$SERVER["socket"] == "0.0.0.0:443" {
    ssl.engine    = "enable"
    ssl.privkey   = "/usrdata/simpleadmin/server.key"
    ssl.pemfile   = "/usrdata/simpleadmin/server.crt"
    ssl.openssl.ssl-conf-cmd = ("MinProtocol" => "TLSv1.2")
}
```

TLS 1.2+ is enforced. ACME ALPN challenge support exists for potential Let's Encrypt integration.

#### SimpleAdmin HTTP Basic Auth

SimpleAdmin's **original** auth uses HTTP Basic Authentication:

```apache
auth.backend = "htpasswd"
auth.backend.htpasswd.userfile = "/opt/etc/.htpasswd"

$SERVER["socket"] == "0.0.0.0:443" {
    auth.require = ( "/" => (
        "method"  => "basic",
        "realm"   => "Authorized users only",
        "require" => "valid-user"
    ))
}
```

- Credential file: `/opt/etc/.htpasswd` (username:bcrypt_hash format)
- Created during install via the `simplepasswd` command (wrapper around `htpasswd`)
- Auth scope: All HTTPS requests (the entire `"/"` path)
- Auth method: HTTP Basic (browser shows username/password dialog)

> **NOTE (QManager):** QManager does **NOT** use SimpleAdmin's HTTP Basic Auth. When QManager's lighttpd.conf is deployed, the `auth.require` block is removed because QManager implements its own cookie-based session authentication at the application level. The `mod_authn_file` module may still be loaded but has no active `auth.require` directives.

#### Sudo for Elevated CGI Operations

Since lighttpd runs as `www-data`, CGI scripts need sudo for privileged operations. SimpleAdmin's original sudoers file (`/opt/etc/sudoers.d/www-data`):

```bash
www-data ALL = (root) NOPASSWD: /usr/sbin/iptables, /usr/sbin/ip6tables, \
    /usrdata/simplefirewall/ttl-override, /bin/echo, /bin/cat
```

QManager extends this with its own sudoers file (`/opt/etc/sudoers.d/qmanager`) covering systemctl, reboot, crontab, ln, rm, and iptables-restore — all with full absolute paths due to Entware's `secure_path` restriction (see [Web Server: lighttpd](#web-server-lighttpd)).

### Console and TTY Architecture (ttyd)

ttyd provides a browser-accessible terminal through lighttpd's reverse proxy.

**Binary:** `/usrdata/simpleadmin/console/ttyd` (ARM EABI, ttyd v1.7.7)
**Service:** `/lib/systemd/system/ttyd.service`

```ini
[Unit]
Description=TTYD Service
After=network.target

[Service]
Type=simple
ExecStartPre=/bin/sleep 5                    # Wait for other services to stabilize
ExecStart=/usrdata/simpleadmin/console/ttyd \
    -i 127.0.0.1 -p 8080 \                  # Localhost only (proxied via lighttpd)
    -t 'theme={"foreground":"white","background":"black"}' \
    -t fontSize=25 --writable \
    /usrdata/simpleadmin/console/ttyd.bash   # Shell script to execute
Restart=on-failure
```

**Shell wrapper** (`ttyd.bash`): Executes `/usrdata/simpleadmin/console/menu/start_menu.sh`

**Start menu** (`start_menu.sh`): Interactive color-coded menu with nested submenus:

```
┌─────────────────────────────────────┐
│   Welcome to Simple Console Menu     │
├─────────────────────────────────────┤
│ 1. Apps Menu                         │
│    ├── File Browser (mc)             │
│    ├── Disk Space (dfc)              │
│    ├── Task Manager (htop)           │
│    └── Speed Tests                   │
│ 2. Settings Menu                     │
│    ├── LAN Settings                  │
│    ├── Firewall/TTL Settings         │
│    ├── Change Admin Password         │
│    └── Change Root Password          │
│ 3. Toolkit Menu                      │
│    ├── Run Stable Toolkit            │
│    └── Run Dev Toolkit               │
│ 4. Exit (Root Shell)                 │
└─────────────────────────────────────┘
```

**Console login profile** (`/usrdata/simpleadmin/console/.profile`): Sets PATH to include `/opt/bin:/opt/sbin:/usrdata/root/bin` and auto-launches the start menu. This applies to both ttyd sessions and SSH logins.

> **GOTCHA:** The auto-menu breaks SCP file transfer (WinSCP hangs). Fix: set WinSCP shell to `/bin/bash --norc --noprofile`. See [Development Access](#development-access).

**Access flow:**
```
Browser → https://<modem-ip>/console
    → lighttpd (port 443, HTTPS + auth)
        → mod_proxy (WebSocket upgrade enabled)
            → ttyd (127.0.0.1:8080, localhost only)
                → /usrdata/simpleadmin/console/ttyd.bash
                    → start_menu.sh (interactive menu)
```

### SimpleFirewall Subsystem

SimpleFirewall provides basic iptables port blocking to restrict web UI access to trusted interfaces.

**Script:** `/usrdata/simplefirewall/simplefirewall.sh`
**Service:** `/lib/systemd/system/simplefirewall.service` (Type=oneshot, RemainAfterExit=yes)

```bash
#!/bin/bash
PORTS=("80" "443")  # Configurable via toolkit menu

# Allow on trusted interfaces
for port in "${PORTS[@]}"; do
    iptables -A INPUT -i bridge0 -p tcp --dport $port -j ACCEPT     # LAN bridge
    iptables -A INPUT -i eth0 -p tcp --dport $port -j ACCEPT        # Physical Ethernet
    iptables -A INPUT -i tailscale0 -p tcp --dport $port -j ACCEPT  # VPN (if installed)
done

# Block on all others (cellular, external)
for port in "${PORTS[@]}"; do
    iptables -A INPUT -p tcp --dport $port -j DROP
done
```

**Effect:** Web UI (ports 80/443) is only accessible from the LAN bridge, Ethernet, and Tailscale VPN interfaces. Cellular-side access is blocked.

The `PORTS` array is user-configurable through the toolkit's console menu or the `sfirewall_settings.sh` script.

### TTL Override Mechanism

TTL (Time To Live) override modifies outgoing IP packet headers to disguise tethered traffic on cellular networks.

**Script:** `/usrdata/simplefirewall/ttl-override` (start/stop/restart)
**Config:** `/usrdata/simplefirewall/ttlvalue` (plain text integer, `0` = disabled)
**Service:** `/lib/systemd/system/ttl-override.service`

```ini
[Unit]
Description=TTL Override
After=ql-netd.service          # Wait for cellular interfaces to exist
DefaultDependencies=no

[Service]
Type=oneshot
ExecStart=/usrdata/simplefirewall/ttl-override start
User=root
```

**TTL override script logic:**

```bash
case "$1" in
start)
    if (( $TTLVALUE > 0 )); then
        # IPv4: Set TTL on all outgoing rmnet interfaces
        iptables -t mangle -I POSTROUTING -o rmnet+ -j TTL --ttl-set ${TTLVALUE}
        # IPv6: Set Hop Limit on all outgoing rmnet interfaces
        ip6tables -t mangle -I POSTROUTING -o rmnet+ -j HL --hl-set ${TTLVALUE}
    fi
    ;;
stop)
    # Remove rules (silently ignore if not present)
    iptables -t mangle -D POSTROUTING -o rmnet+ -j TTL --ttl-set ${TTLVALUE} &>/dev/null || true
    ip6tables -t mangle -D POSTROUTING -o rmnet+ -j HL --hl-set ${TTLVALUE} &>/dev/null || true
    ;;
esac
```

The `rmnet+` wildcard matches all cellular data interfaces (multiple PDN support). Common TTL values: `64` (Linux default), `65` (common bypass), `128` (Windows default).

**Web UI integration:** The `set_ttl` CGI script stops the service, updates `/usrdata/simplefirewall/ttlvalue`, calls `ttl_script.sh`, then restarts the service. The `get_ttl_status` CGI script reads iptables mangle rules and returns JSON:

```json
{ "isEnabled": true, "ttl": 65 }
```

### SimpleUpdate System

The toolkit includes a self-updating daemon that can automatically update all components.

**Daemon:** `/usrdata/simpleupdates/simpleupdate`
**Config:** `/usrdata/simpleupdates/simpleupdate.conf`
**Service:** `/lib/systemd/system/simpleupdated.service`

```ini
[Unit]
Description=Simple Update Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usrdata/simpleupdates/simpleupdate d    # 'd' = daemon mode
```

**Configuration options:**

```bash
CONF_ENABLED=yes               # Enable/disable updates
CHECK_AT_BOOT=yes              # Check immediately on startup
UPDATE_FREQUENCY=daily         # daily, weekly, monthly, or none
SCHEDULED_TIME=03:00           # 24-hour format (UTC)
WEEKLY_DAY=Mon                 # For weekly checks
MONTHLY_DATE=15                # For monthly checks
```

**Version tracking:** Each component has a `.rev` file containing an integer revision number:

| Component | Rev File | Update Script |
|-----------|----------|---------------|
| SimpleAdmin | `/usrdata/simpleadmin/.rev` | `update_simpleadmin.sh` |
| socat-at-bridge | `/usrdata/socat-at-bridge/.rev` | `update_socat-at-bridge.sh` |
| SimpleFirewall | `/usrdata/simplefirewall/.rev` | `update_simplefirewall.sh` |
| SSH | `/usrdata/sshd/.rev` | `update_sshd.sh` |

**Update check flow:**
1. Daemon reads local `.rev` file
2. Downloads remote `.rev` from GitHub
3. If `remote_rev > local_rev`, runs the component's update script
4. Each update script: stops services → downloads files → sets permissions → creates systemd units → starts services
5. Logs to `/tmp/simpleupdate.log` (trimmed to last 100 lines)

### Complete Boot Sequence

This is the full systemd boot order showing how all SimpleAdmin components start:

```
Kernel boot → initrd → basic.target
    │
    ├── ql-netd.service                    (Qualcomm network daemon — modem ready)
    │
    ├── opt.mount                          (Bind mount /usrdata/opt → /opt)
    │   └── start-opt-mount.service        (Ensure mount succeeds)
    │
    ├── rc.unslung.service                 (Entware init.d: /opt/etc/init.d/rc.unslung start)
    │
    ├── network.target                     (Network interfaces up)
    │
    └── multi-user.target
        │
        ├── socat-killsmd7bridge.service   (oneshot: kill port_bridge on smd7)
        │
        ├── socat-smd11.service            (socat PTY: /dev/ttyIN + /dev/ttyOUT)
        │   ├── socat-smd11-to-ttyIN       (cat /dev/smd11 > /dev/ttyIN)
        │   └── socat-smd11-from-ttyIN     (cat /dev/ttyIN > /dev/smd11)
        │
        ├── socat-smd7.service             (socat PTY: /dev/ttyIN2 + /dev/ttyOUT2)
        │   ├── socat-smd7-to-ttyIN2       (cat /dev/smd7 > /dev/ttyIN2)
        │   └── socat-smd7-from-ttyIN2     (cat /dev/ttyIN2 > /dev/smd7)
        │
        ├── simplefirewall.service         (oneshot: iptables port blocking rules)
        ├── ttl-override.service           (oneshot: iptables TTL rules on rmnet+)
        │
        ├── lighttpd.service               (HTTPS web server, After=opt.mount)
        ├── ttyd.service                   (Web terminal, 5s startup delay)
        │
        ├── simpleupdated.service          (Update daemon)
        │
        ├── qmanager-setup.service         (oneshot: remount rw, pre-create /tmp files)
        ├── qmanager-ping.service          (After=socat-smd7-from-ttyIN2)
        ├── qmanager-poller.service        (After=socat-smd7-from-ttyIN2, ping, setup)
        ├── qmanager-imei-check.service    (After=socat-smd7-from-ttyIN2, setup)
        ├── qmanager-tower-failover        (After=poller, socat-smd7-from-ttyIN2)
        └── qmanager-watchcat.service      (After=poller, socat-smd7-from-ttyIN2)
```

**Critical path for AT commands:** `ql-netd` → `socat-killsmd7bridge` → `socat-smd7` → `socat-smd7-{to,from}-ttyIN2` → QManager services. Any failure in this chain means AT commands are unavailable.

**Critical path for web UI:** `opt.mount` → `rc.unslung` → `lighttpd` (+ `ttyd` for console). If `/opt` fails to mount, lighttpd binary is inaccessible.

---

## Known Platform Quirks

### `fs.protected_regular=1` — Sticky Directory File Protection

The RM520N-GL kernel ships with `fs.protected_regular=1`. This Linux security feature restricts opening files with `O_CREAT` in world-writable, sticky-bit directories like `/tmp/`. The rule is:

> Opening is **blocked** unless `file_owner == caller_uid` **OR** `dir_owner == caller_uid`.

Since `/tmp` is owned by `root`:
- **Root opening www-data files:** `dir_owner` (root) matches caller (root) -- **ALLOWED**
- **www-data opening root files:** neither `file_owner` nor `dir_owner` matches -- **BLOCKED** (`Permission denied`)

This affects **every file in `/tmp/` that both root processes (daemons, setup scripts) and `www-data` processes (CGI scripts via lighttpd) need to access**. Shell `>` and `>>` redirects include the `O_CREAT` flag internally, triggering this protection even on existing files. The `9>"$LOCK_FILE"` pattern used by `qcmd` for `flock` serialization is especially affected.

**Affected shared files:**

| File | Purpose | Accessed By |
|------|---------|-------------|
| `/tmp/qmanager_at.lock` | AT command `flock` serialization | `qcmd` (www-data CGI + root daemons) |
| `/tmp/qmanager_at.pid` | Current AT command PID tracking | `qcmd` (www-data CGI + root daemons) |
| `/tmp/qmanager.log` | Centralized `qlog` output | All daemons (root) + log viewer CGI (www-data) |

**Two-part fix (confirmed working in deployment):**

**1. Pre-create files with correct ownership.** The `qmanager_setup` boot service (systemd oneshot, runs as root before other QManager services) pre-creates these files as `www-data`:

```bash
# qmanager_setup — pre-create shared /tmp files for fs.protected_regular
touch /tmp/qmanager_at.lock /tmp/qmanager_at.pid /tmp/qmanager.log
chown www-data:www-data /tmp/qmanager_at.lock /tmp/qmanager_at.pid /tmp/qmanager.log
chmod 666 /tmp/qmanager_at.lock /tmp/qmanager_at.pid /tmp/qmanager.log
```

**2. Use read-only FD redirects for flock.** Even with `www-data`-owned files, `9>"$LOCK_FILE"` still fails because shell `>` always passes `O_CREAT` to the `open()` syscall, regardless of whether the file exists. The fix in `qcmd` is to use `9<` (read-only open) instead of `9>`:

```bash
# RM520N-GL (qcmd) — read-only FD, no O_CREAT
( flock_wait 9 "$LOCK_WAIT_LONG"; ...; ) 9<"$LOCK_FILE"

# OpenWRT (qcmd) — write FD works fine (no protected_regular)
( flock_wait 9 "$LOCK_WAIT_LONG"; ...; ) 9>"$LOCK_FILE"
```

This works because `flock()` operates on file descriptors, not files — it does not care whether the FD is opened for reading or writing. Read-only FDs have been valid for `flock` since Linux 2.6.12+. The lock file just needs to exist (handled by step 1).

> **WARNING:** Any new daemon or CGI script that creates shared files in `/tmp/` must follow this pattern: pre-create in `qmanager_setup` with `www-data` ownership, and open with `<` (not `>`) when using `flock`. If a root process creates the file first, `www-data` CGI scripts will get `Permission denied` and fail silently.

> **NOTE:** This protection does NOT affect `/usrdata/` or `/etc/qmanager/` (neither has the sticky bit set). It is specific to `/tmp/` (and any other `+t` directories).

### `systemctl enable` Does Not Work for Boot Startup

On the RM520N-GL's minimal systemd, `systemctl enable` appears to succeed (service shows "enabled" in `systemctl status`) but **services do not actually start on boot**. The `WantedBy=` directives in `[Install]` sections are silently ignored.

**Root cause:** The systemd implementation on this platform does not process `[Install]` stanzas during `systemctl enable`. It marks the service as enabled in its database but does not create the symlinks that `multi-user.target` needs to pull services in at boot.

**Fix (confirmed working in deployment):** Create explicit symlinks directly into `multi-user.target.wants/`, following the pattern proven by SimpleAdmin on this same platform. The intermediate `qmanager.target` was dropped -- each service is symlinked directly into `multi-user.target.wants/`:

```bash
# Service files live in /lib/systemd/system/ (persistent on RM520N-GL rootfs)
UNIT_DIR="/lib/systemd/system"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
mkdir -p "$WANTS_DIR"

# Symlink each service directly into multi-user.target.wants
ln -sf "$UNIT_DIR/qmanager-poller.service" "$WANTS_DIR/qmanager-poller.service"
ln -sf "$UNIT_DIR/qmanager-ping.service" "$WANTS_DIR/qmanager-ping.service"
# ... repeat for each service
```

**Boot chain:** `multi-user.target` --> individual services (via direct symlinks in `multi-user.target.wants/`).

**Runtime enable/disable:** `platform.sh` provides `svc_enable`/`svc_disable` functions that create/remove these symlinks (with sudo for www-data context). `systemctl enable/disable` is NOT used.

> **WARNING:** Do not rely on `systemctl enable` for boot persistence on the RM520N-GL. Always use `svc_enable`/`svc_disable` from `platform.sh` (or direct symlink creation in install scripts). `systemctl start/stop/restart` works fine for runtime control; only enable/disable is broken.

> **NOTE:** Service files are installed to `/lib/systemd/system/` (persistent rootfs), NOT `/etc/systemd/system/` (which is tmpfs and does not survive reboots on this platform). The wants directory is `/lib/systemd/system/multi-user.target.wants/`.

---

## AT Command Transport Layer

This is the most critical section for the port. The entire QManager backend communicates with the modem through AT commands, and the transport mechanism is completely different on the RM520N-GL.

### Physical Layer: SMD Ports

The RM520N-GL exposes AT command channels as Shared Memory Driver (SMD) character devices — kernel-level IPC channels between the application processor and the modem baseband processor. Unlike the RM551E (where the host accesses the modem over USB CDC ACM), these are internal device files.

| Port | Path | Default State | Notes |
|------|------|---------------|-------|
| Primary | `/dev/smd7` | **Claimed** by `port_bridge` | Must kill `port_bridge` to use |
| Secondary | `/dev/smd11` | **Free** | Immediately available, no contention |

**`port_bridge`** is a Qualcomm process that runs at boot:

```
/usr/bin/port_bridge smd7 at_usb2 1
```

It bridges `/dev/smd7` to the USB-exposed AT port (`at_usb2`), making AT commands available to an external host over USB. Since QManager runs on the modem itself, this bridge is unnecessary and must be killed to reclaim `/dev/smd7`.

> **NOTE:** `/dev/smd11` is the safer default for QManager's poller. It requires no process killing and is available immediately at boot. Reserve `/dev/smd7` for secondary uses (e.g., a dedicated channel for user AT terminal commands).

### PTY Bridge Architecture

The raw SMD devices cannot be opened by multiple processes safely, and they lack terminal discipline (echo control, line buffering). The socat PTY bridge solves both problems by creating virtual TTY pairs that front-end the SMD devices.

```
                    socat PTY Pair                    cat Bridges
                ┌──────────────────┐          ┌────────────────────┐
                │                  │          │                    │
  Callers       │  /dev/ttyOUT     │          │                    │
  (microcom,    │  (readable side) │◄──PTY──► │  /dev/ttyIN        │
   atcmd, CGI)  │  echo=1, raw     │ loopback │  (writable side)   │
                │                  │          │  echo=0, raw       │
                └──────────────────┘          └──────┬─────────────┘
                                                     │
                                          ┌──────────┴──────────┐
                                          │                     │
                                    ┌─────▼──────┐     ┌───────┴────┐
                                    │ cat ttyIN   │     │ cat smd11  │
                                    │  > smd11    │     │  > ttyIN   │
                                    │ (cmd path)  │     │ (rsp path) │
                                    └─────┬──────┘     └───────┬────┘
                                          │                     │
                                          ▼                     ▲
                                    ┌─────────────────────────────┐
                                    │       /dev/smd11            │
                                    │   (modem AT processor)      │
                                    └─────────────────────────────┘
```

Key design details:

- **socat creates PTY pairs only** — it does NOT connect to the SMD device. It creates two linked pseudo-terminals (`/dev/ttyIN` + `/dev/ttyOUT` for smd11; `/dev/ttyIN2` + `/dev/ttyOUT2` for smd7).
- **Four `cat` processes do the actual bridging** — two per channel, one for each direction.
- **`echo=0` on the IN side** prevents command echo from being looped back.
- **`echo=1` on the OUT side** allows callers to see what they wrote (for interactive use).
- Both sides run in `raw` mode (no line discipline transformations).

> **WARNING:** This architecture means 7 processes (1 socat + 2 cats per channel, plus `killsmd7bridge`) must be running for AT commands to work. If any `cat` process dies, that direction of the bridge goes silent. The `BindsTo=` systemd directive handles automatic restart.

### Socat PTY Parameters Explained

The socat command line used by each bridge service:

```bash
/usrdata/socat-at-bridge/socat-armel-static -d -d \
    pty,link=/dev/ttyIN2,raw,echo=0,group=20,perm=660 \
    pty,link=/dev/ttyOUT2,raw,echo=1,group=20,perm=660
```

| Parameter | Meaning |
|-----------|---------|
| `-d -d` | Dual debug verbosity (logged to journal) |
| `pty` | Create a pseudo-terminal pair (master + slave) |
| `link=/dev/ttyIN2` | Create a symlink at this path to the PTY slave device |
| `raw` | Raw mode — no line discipline, no buffering, all bytes passed immediately. Critical because AT commands use `\r` (carriage return) not `\n` as line terminator |
| `echo=0` (IN side) | Disable local echo — prevents command echo from being looped back to the modem |
| `echo=1` (OUT side) | Enable echo — allows callers to see what they wrote (useful for interactive debugging) |
| `group=20` | Set PTY device group to GID 20 (dialout) — allows `www-data:dialout` (lighttpd) to access |
| `perm=660` | Permissions `rw-rw----` — owner and group can read/write, others cannot |

**Binary:** `/usrdata/socat-at-bridge/socat-armel-static` — statically linked ARM EABI binary (no shared library dependencies). Downloaded from the toolkit repository during installation.

**Process model:** socat runs continuously (`Restart=always`, `RestartSec=1s`). Each `ExecStartPost` includes `sleep 2s` to ensure the PTY device files exist before dependent `cat` bridge services start.

### Data Flow Diagram

Complete round-trip for an AT command sent via smd11:

```
1. Caller writes "AT+CSQ\r\n" to /dev/ttyOUT
                    │
2. socat PTY ───────┤ (loopback: ttyOUT ↔ ttyIN)
                    │
3. /dev/ttyIN receives "AT+CSQ\r\n"
                    │
4. cat /dev/ttyIN ──┤──► writes to /dev/smd11
                    │
5. Modem baseband processes AT+CSQ
                    │
6. /dev/smd11 ◄─────┤── modem writes "+CSQ: 20,99\r\nOK\r\n"
                    │
7. cat /dev/smd11 ──┤──► writes response to /dev/ttyIN
                    │
8. socat PTY ───────┤ (loopback: ttyIN ↔ ttyOUT)
                    │
9. /dev/ttyOUT now contains "+CSQ: 20,99\r\nOK\r\n"
                    │
10. Caller reads response from /dev/ttyOUT
```

For smd7, substitute: `ttyIN2`/`ttyOUT2` for `ttyIN`/`ttyOUT`, and `smd7` for `smd11`.

### AT Command Tools

Two tools are available for sending AT commands. QManager's CGI layer should use `microcom` (Approach A) for its superior timing characteristics.

#### microcom (Production — Recommended)

```bash
runcmd=$(echo -en "${command}\r\n" | microcom -t ${wait_time} /dev/ttyOUT2)
```

- BusyBox minimal terminal emulator
- `-t` accepts timeout in **milliseconds**
- Adaptive wait strategy: starts at 200ms, increments 1ms per retry until `OK` or `ERROR` is found in output
- No background processes spawned
- **Synchronous** — blocks until response or timeout

Used by: `get_atcommand`, `send_sms` (the production CGI scripts).

#### atcmd / atcmd11 (Interactive — Not Recommended for CGI)

```bash
# atcmd targets /dev/ttyOUT2 (smd7 bridge)
atcmd 'AT+CSQ'

# atcmd11 targets /dev/ttyOUT (smd11 bridge)
atcmd11 'AT+CSQ'
```

- Two modes: single-command (with argument) and interactive REPL (no argument)
- Single-command mode: configures stty, flushes device, echoes command, spawns background `cat` to tmpfile, polls for `OK`/`ERROR` with **1-second sleep** granularity
- **No hard timeout** — infinite loop until response marker found (can hang forever)
- **No file locking** — concurrent calls produce garbage
- **ANSI color codes in output** — must be stripped with `awk '{ gsub(/\x1B\[[0-9;]*[mG]/, "") }1'`

**atcmd internals:** Before sending, the script configures the TTY device with raw terminal settings:

```bash
stty -F /dev/ttyOUT cs8 115200 ignbrk -brkint -icrnl -imaxbel \
    -opost -onlcr -isig -icanon -iexten -echo -echoe -echok \
    -echoctl -echoke noflsh -ixon -crtscts
```

Then sends the command and reads the response:

```bash
echo -e "AT+CGMM\r" > /dev/ttyOUT           # Write with carriage return
tmpfile=$(mktemp)
cat /dev/ttyOUT > "$tmpfile" &               # Background reader
CAT_PID=$!
while ! grep -qe "OK" -e "ERROR" "$tmpfile"; do
    sleep 1                                   # Poll every 1 second
done
kill $CAT_PID                                 # Kill reader when done
```

Both `atcmd` and `atcmd11` target `/dev/ttyOUT` (smd11 channel). They are functionally identical — `atcmd11` is an alias.

> **WARNING:** The existing `user_atcommand` CGI script uses `atcmd` with a quoting bug: `'$x'` (single quotes) prevents variable expansion, so the actual AT command is never sent. This endpoint is effectively broken.

### Systemd Service Dependency Graph

```
multi-user.target
│
├── socat-killsmd7bridge.service
│   Type=oneshot, RemainAfterExit=yes
│   No After= (runs ASAP)
│   ExecStart: pkill -f "/usr/bin/port_bridge smd7 at_usb2 1"
│   Purpose: Free /dev/smd7 from Qualcomm's USB-AT bridge
│
├── socat-smd11.service
│   After=ql-netd.service
│   Restart=always, RestartSec=1s
│   ExecStart: socat (creates /dev/ttyIN + /dev/ttyOUT)
│   ExecStartPost: sleep 2s (wait for PTY creation)
│   │
│   ├── socat-smd11-to-ttyIN.service
│   │   BindsTo=socat-smd11.service
│   │   ExecStart: cat /dev/ttyIN > /dev/smd11
│   │
│   └── socat-smd11-from-ttyIN.service
│       BindsTo=socat-smd11.service
│       ExecStart: cat /dev/smd11 > /dev/ttyIN
│
└── socat-smd7.service
    After=ql-netd.service
    Restart=always, RestartSec=1s
    ExecStart: socat (creates /dev/ttyIN2 + /dev/ttyOUT2)
    │
    ├── socat-smd7-to-ttyIN2.service
    │   BindsTo=socat-smd7.service
    │   ExecStart: cat /dev/ttyIN2 > /dev/smd7
    │
    └── socat-smd7-from-ttyIN2.service
        BindsTo=socat-smd7.service
        ExecStart: cat /dev/smd7 > /dev/ttyIN2
```

**Critical dependency:** `After=ql-netd.service` — Qualcomm's network daemon (`ql-netd`) must be running before the AT bridge starts. `ql-netd` manages the cellular data path and initializes the baseband. Starting the AT bridge before `ql-netd` can cause SMD read failures or stale responses.

**`BindsTo=` semantics:** If the parent socat service stops or fails, all child `cat` bridge services are automatically stopped too. Combined with `Restart=always` on the socat service, this provides automatic recovery of the entire bridge stack.

### QManager qcmd Integration

QManager uses `qcmd` as the single serialized entry point for all AT commands. Understanding how it interacts with the socat bridge is critical for debugging.

**Architecture:**

```
┌────────────────────────────────────────────────────────────┐
│  All QManager AT Callers                                    │
│  ├─ qmanager-poller (every 30s)                            │
│  ├─ QManager web UI CGI scripts                            │
│  ├─ qmanager-tower-failover (on demand)                    │
│  ├─ qmanager-watchcat (periodic pings)                     │
│  └─ qmanager-imei-check (at boot)                          │
│       ↓                                                    │
│  qcmd "AT+COMMAND"   [unified interface]                   │
│       ↓                                                    │
│  /tmp/qmanager_at.lock   [flock-based serialization]       │
│       ↓                                                    │
│  sms_tool -d /dev/ttyOUT2 at "AT+COMMAND"                  │
│       ↓                                                    │
│  /dev/ttyOUT2 → socat PTY → /dev/smd7 → modem             │
└────────────────────────────────────────────────────────────┘
```

#### flock Serialization

Lock file: `/tmp/qmanager_at.lock` (pre-created by `qmanager_setup` with 666 permissions and `www-data` ownership — required for `fs.protected_regular`).

```bash
# Read-only FD (9<) to avoid O_CREAT — mandatory on RM520N-GL
( flock_wait 9 "$LOCK_WAIT_SHORT"; sms_tool -d /dev/ttyOUT2 at "$CMD"; ) 9<"$LOCK_FILE"
```

Lock wait strategy: custom `flock_wait()` function polls `flock -x -n` every 1 second up to the timeout, rather than using `flock -w` (which may not be available in all BusyBox versions).

Default timeouts: `LOCK_WAIT_SHORT=5s` (normal commands), `LOCK_WAIT_LONG=10s` (long commands).

#### Short vs Long Command Paths

| Path | Commands | Timeout | Mechanism |
|------|----------|---------|-----------|
| **Short** | `AT+CSQ`, `AT+CGMM`, most commands | 3s | `timeout 3 sms_tool -d /dev/ttyOUT2 at "$CMD"` |
| **Long** | `AT+QSCAN`, `AT+QSCANFREQ` | 240s | Direct PTY I/O with polling (bypasses sms_tool) |

**Why long commands bypass sms_tool:** `sms_tool` has a hardcoded read timeout of ~5 seconds, insufficient for `AT+QSCAN` (30-180s). For long commands, `qcmd` writes directly to the PTY and uses a background `cat` reader with a polling loop:

```bash
_run_long_at() {
    printf '%s\r' "$CMD" > /dev/ttyIN2          # Write directly to PTY input
    cat /dev/ttyOUT2 > "$tmpfile" &              # Background reader (no timeout)
    CAT_PID=$!
    # Poll for OK/ERROR every 1s, up to 240s
    while ! grep -qe "OK" -e "ERROR" "$tmpfile"; do
        sleep 1
        elapsed=$((elapsed + 1))
        [ "$elapsed" -ge 240 ] && break
    done
    kill "$CAT_PID" 2>/dev/null
}
```

A flag file `/tmp/qmanager_long_running` is created while a long command is active, allowing other callers to detect and back off.

#### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (response contains OK) |
| 1 | Command returned ERROR |
| 2 | Lock timeout (modem busy — another qcmd is running) |
| 3 | Modem not ready (AT device not found) |
| 4 | Command timeout (no response within timeout period) |

#### Stale Lock Recovery

Each `qcmd` invocation records its PID in `/tmp/qmanager_at.pid`. If a subsequent call finds the lock held but the recorded PID no longer exists (`kill -0` check fails or `/proc/$pid` not found), the lock is treated as stale and cleaned up. This handles crashed `sms_tool` processes.

#### Boot Dependencies

All QManager services declare `After=socat-smd7-from-ttyIN2.service` to ensure the smd7 bridge is fully operational before any AT commands are attempted:

```
socat-smd7-from-ttyIN2.service (bridge ready)
    ↓
qmanager-setup.service (pre-create /tmp files, oneshot)
    ↓
qmanager-ping.service
    ↓
qmanager-poller.service → qmanager-tower-failover.service
                        → qmanager-watchcat.service
```

### Socat-AT-Bridge Installation

The bridge is installed by `update_socat-at-bridge.sh`, called during both fresh installs and updates.

**Installation flow:**

1. **Stop and remove existing services:**
   ```bash
   systemctl stop socat-smd11 socat-smd11-to-ttyIN socat-smd11-from-ttyIN
   systemctl stop socat-smd7 socat-smd7-to-ttyIN2 socat-smd7-from-ttyIN2
   systemctl stop socat-killsmd7bridge
   rm /lib/systemd/system/socat-*.service
   systemctl daemon-reload
   rm -rf /usrdata/socat-at-bridge
   ```

2. **Download components to `/usrdata/socat-at-bridge/`:**
   - `socat-armel-static` — Static ARM socat binary
   - `killsmd7bridge` — port_bridge cleanup script
   - `atcmd`, `atcmd11` — Interactive AT command wrappers
   - All systemd unit files to `systemd_units/` subdirectory

3. **Set permissions and create symlinks:**
   ```bash
   chmod +x socat-armel-static killsmd7bridge atcmd atcmd11
   ln -sf /usrdata/socat-at-bridge/atcmd /bin
   ln -sf /usrdata/socat-at-bridge/atcmd11 /bin
   ```

4. **Install systemd units:**
   ```bash
   cp /usrdata/socat-at-bridge/systemd_units/*.service /lib/systemd/system/
   # Create direct symlinks (systemctl enable doesn't work — see Known Quirks)
   ln -sf /lib/systemd/system/socat-killsmd7bridge.service /lib/systemd/system/multi-user.target.wants/
   ln -sf /lib/systemd/system/socat-smd11.service /lib/systemd/system/multi-user.target.wants/
   # ... (repeat for all 7 services)
   ```

5. **Start services in dependency order:**
   ```bash
   systemctl daemon-reload
   systemctl start socat-smd11         # Create PTY pair for smd11
   sleep 2s
   systemctl start socat-smd11-to-ttyIN socat-smd11-from-ttyIN
   systemctl start socat-killsmd7bridge  # Kill port_bridge
   sleep 1s
   systemctl start socat-smd7          # Create PTY pair for smd7
   sleep 2s
   systemctl start socat-smd7-to-ttyIN2 socat-smd7-from-ttyIN2
   ```

**The `killsmd7bridge` script:**

```bash
#!/bin/bash
pkill -f "/usr/bin/port_bridge smd7 at_usb2 1"
```

One-shot: kills the Qualcomm `port_bridge` process that claims smd7 at boot. Must run before `socat-smd7.service` attempts to use `/dev/smd7`. The `port_bridge` process does not respawn after being killed.

**Verification after install:**
```bash
ls -la /dev/ttyIN2 /dev/ttyOUT2 /dev/ttyIN /dev/ttyOUT   # PTY devices exist
systemctl status socat-smd7 socat-smd7-from-ttyIN2         # Services active
echo -e "AT\r" | microcom -t 500 /dev/ttyOUT2              # AT command works
```

### Troubleshooting: AT Bridge

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| `ERROR: AT device /dev/ttyOUT2 not found` | socat-smd7 not running | `systemctl status socat-smd7` → `systemctl restart socat-smd7` |
| AT commands hang (timeout) | Bridge cat processes died | `systemctl restart socat-smd7-from-ttyIN2 socat-smd7-to-ttyIN2` |
| `/dev/ttyIN2` doesn't exist | port_bridge still holds smd7 | `ps aux \| grep port_bridge` → `/usrdata/socat-at-bridge/killsmd7bridge` → restart socat-smd7 |
| `qcmd` returns `modem_busy` repeatedly | Stale lock from crashed sms_tool | `pkill -9 sms_tool; rm /tmp/qmanager_at.pid` |
| Modem not responsive at all | Baseband not initialized | Check `systemctl status ql-netd` — may need modem reboot |
| Permission denied on `/tmp/qmanager_at.lock` | fs.protected_regular blocking www-data | `chown www-data:www-data /tmp/qmanager_at.lock; chmod 666 /tmp/qmanager_at.lock` |

**Performance characteristics:**

| Command Type | Typical Latency | Notes |
|--------------|----------------|-------|
| Simple query (`AT`, `AT+CSQ`) | 50-100ms | Fastest possible round-trip |
| Status query (`AT+QENG`) | 100-500ms | Varies with network state |
| SMS operations | 200ms-2s | Depends on network |
| Cell scan (`AT+QSCAN`) | 30-180s | Full frequency sweep |

**Resource overhead:** The entire bridge stack (2 socat processes + 4 cat processes) uses ~5 MB RAM and <1% CPU at idle. The `cat` processes block on read and consume no CPU until data arrives.

### Porting Considerations: AT Transport

This was the highest-risk area of the port. The entire QManager backend communicates through `qcmd`, which originally wrapped `sms_tool` over USB on OpenWRT.

#### 1. `qcmd` — RM520N-GL Variant (COMPLETE)

The RM520N-GL `qcmd` (`scripts/usr/bin/qcmd`) uses `sms_tool` targeting the smd7 PTY bridge (`/dev/ttyOUT2`) with `flock` serialization. The interface contract is identical to the RM551E variant -- all callers work without modification.

Key design decisions:
- **`sms_tool` on `/dev/ttyOUT2`** (smd7), not microcom on ttyOUT (smd11). sms_tool has timing issues on ttyOUT but works reliably on ttyOUT2.
- **`sms_tool` is bundled** as a static ARM binary in `dependencies/sms_tool` -- installed by the install script, no internet required.
- **`flock` with read-only FD** (`9<"$LOCK_FILE"`) to avoid `fs.protected_regular` issues (see Known Platform Quirks).
- **Device override:** Write a device path to `/etc/qmanager/at_device` to change the default.
- **Long command detection:** Commands matching patterns in `/etc/qmanager/long_commands.list` get extended timeouts (240s) and block other callers immediately.

> **CRITICAL: `flock` is mandatory.** Unlike the RM551E (where `sms_tool` implicitly serializes access), the RM520N-GL's PTY bridge has no locking. Concurrent AT commands from the poller, CGI scripts, and user terminal will interleave on the wire, producing corrupt responses. Every AT access must go through the single locked `qcmd` wrapper.

#### 2. Compound AT command support

The RM520N-GL modem firmware supports semicolon-batched commands (same as RM551E):

```
AT+CSQ;+QTEMP;+QUIMSLOT?
```

The existing compound-AT batching strategy from QManager's poller should work unchanged, but the wrapper must hold the `flock` for the entire batch duration to prevent interleaving.

#### 3. Dual-channel strategy

With two independent SMD channels, QManager could dedicate each to a specific purpose:

| Channel | Device | Use Case |
|---------|--------|----------|
| smd11 (`/dev/ttyOUT`) | Primary | Poller (Tier 1/2/Boot), CGI read commands |
| smd7 (`/dev/ttyOUT2`) | Secondary | User AT terminal, long-running commands (QSCAN), write operations |

This eliminates contention between the high-frequency poller and user-initiated commands. Each channel needs its own `flock` file.

#### 4. Timeout handling

The `microcom` approach with adaptive wait is superior to `atcmd`'s 1-second polling. However, some commands need longer timeouts:

| Command | Expected Duration | Recommended Timeout |
|---------|-------------------|---------------------|
| `AT+CSQ`, `AT+QTEMP` | <100ms | 2000ms (default) |
| `AT+QENG="servingcell"` | 100-500ms | 3000ms |
| `AT+QSCAN` (cell scan) | 30-120s | 180000ms |
| `AT+EGMR=1,7,"..."` (IMEI write) | 1-5s | 10000ms |
| `AT+CFUN=0` / `AT+CFUN=1` | 2-10s | 15000ms |

The `qcmd` wrapper should accept an optional timeout parameter or use command-specific defaults.

---

## System Architecture

### Platform Specs

| Property | Value |
|----------|-------|
| SoC | Qualcomm SDXLEMUR |
| Kernel | Linux 5.4.180 |
| Architecture | ARMv7l (32-bit ARM) |
| C library | glibc 2.27 |
| Init system | systemd |
| Shell | `/bin/bash` (native) |
| Root FS | Read-only by default |
| Writable partition | `/usrdata/` |

> **NOTE:** The ARMv7l (32-bit) architecture affects binary compatibility. Any precompiled tools (like `nfqws` for the Video Optimizer feature) must be compiled for ARM32, not ARM64. The existing `qmanager_dpi_install` script's architecture detection logic will need updating.

### Filesystem Layout

```
/                           ← ubifs (ubi0:rootfs), boots read-only (assert=read-only)
│                             mount -o remount,rw / before writes, sync after
├── bin/
│   ├── bash                ← Native bash (not BusyBox)
│   ├── systemctl           ← systemd control (NOTE: /bin/, not /usr/bin/)
│   ├── ln                  ← Used by svc_enable (full path: /bin/ln)
│   └── rm                  ← Used by svc_disable (full path: /bin/rm)
├── sbin/
│   └── reboot              ← Symlink to /bin/systemctl
├── dev/
│   ├── smd7                ← Primary AT channel (raw SMD)
│   ├── smd11               ← Secondary AT channel (raw SMD)
│   ├── ttyIN, ttyOUT       ← socat PTY pair for smd11
│   └── ttyIN2, ttyOUT2     ← socat PTY pair for smd7
├── etc/                    ← tmpfs — VOLATILE, lost on reboot
│   ├── data/
│   │   └── mobileap_cfg.xml  ← LAN/DHCP config (xmlstarlet)
│   └── qmanager/           ← ON rootfs (ubifs), persists despite /etc/ being tmpfs
├── lib/
│   └── systemd/system/     ← ON rootfs — service files and symlinks PERSIST
│       └── multi-user.target.wants/  ← Boot symlinks (svc_enable/svc_disable)
├── opt/ → /usrdata/opt     ← Entware (bind mount)
│   ├── bin/                ← Entware binaries (incl. sudo)
│   ├── sbin/               ← Entware system binaries
│   └── etc/lighttpd/       ← Web server config
├── usr/
│   ├── bin/
│   │   ├── port_bridge     ← Qualcomm USB-AT bridge (killed at boot)
│   │   ├── socat-armel-static  ← Static socat binary
│   │   ├── atcmd            ← AT tool for smd7
│   │   └── atcmd11          ← AT tool for smd11
│   └── sbin/
│       ├── iptables         ← Firewall (NOTE: /usr/sbin/, not in sudo secure_path)
│       └── ip6tables        ← IPv6 firewall
├── usrdata/                ← Persistent writable partition
│   ├── opt/                ← Entware installation
│   ├── simplefirewall/     ← TTL value, firewall scripts
│   └── ...
└── tmp/                    ← Tmpfs (volatile, always writable)
    └── watchcat.json       ← Watchdog state
```

#### Filesystem Persistence Model

| Mount point | Type | Persists? | Notes |
|-------------|------|-----------|-------|
| `/` (rootfs) | ubifs (`ubi0:rootfs`) | **Yes** | Boots with `assert=read-only`; `mount -o remount,rw /` before writes |
| `/lib/systemd/system/` | On rootfs | **Yes** | Service files and boot symlinks survive reboots |
| `/etc/` | tmpfs | **No** | Volatile — lost on reboot |
| `/etc/qmanager/` | On rootfs (ubifs) | **Yes** | Exception: resides on rootfs despite `/etc/` being tmpfs |
| `/usrdata/` | Persistent partition | **Yes** | Primary writable storage for config, Entware, etc. |
| `/tmp/` | tmpfs | **No** | Always writable, volatile |

> **WARNING:** Always run `sync` after writing to the rootfs before rebooting. ubifs writes may not flush to NAND immediately, and data written just before reboot can be lost.

**Key difference from OpenWRT:** On OpenWRT, `/etc/config/` (UCI) is the canonical config store and survives reboots via the overlay filesystem. On the RM520N-GL, `/etc/` is tmpfs (volatile). QManager's config directory is `/etc/qmanager/` which persists because it resides on the ubifs rootfs, not the tmpfs overlay. Bulk persistent data lives under `/usrdata/`.

### Service Hierarchy

```
systemd
├── ql-netd.service              ← Qualcomm network daemon (MUST start first)
│   ├── socat-smd11.service      ← AT bridge for smd11
│   │   ├── socat-smd11-to-ttyIN.service
│   │   └── socat-smd11-from-ttyIN.service
│   ├── socat-smd7.service       ← AT bridge for smd7
│   │   ├── socat-smd7-to-ttyIN2.service
│   │   └── socat-smd7-from-ttyIN2.service
│   └── socat-killsmd7bridge.service (oneshot)
│
├── opt.mount                    ← Bind-mount /usrdata/opt → /opt
│   └── rc.unslung.service       ← Entware startup
│       ├── lighttpd.service     ← Web server (HTTP→HTTPS, CGI)
│       └── sshd.service         ← SSH access
│
├── simplefirewall.service       ← Port blocking, TTL rules
├── ttl-override.service         ← iptables TTL on rmnet+
├── ttyd.service                 ← Web terminal (port 8080)
└── tailscaled.service           ← Tailscale VPN
```

### Package Management (Entware)

Entware is the RM520N-GL's equivalent of OpenWRT's built-in opkg. It is installed at `/usrdata/opt` and bind-mounted to `/opt` via a systemd `.mount` unit.

Packages available via Entware that QManager depends on or could use:

| Package | Purpose | Notes |
|---------|---------|-------|
| `lighttpd` | Web server | Replaces uhttpd |
| `sudo` | Privilege escalation for CGI | `www-data` needs root for iptables |
| `xmlstarlet` | LAN config editing | Parses `mobileap_cfg.xml` |
| `curl` | HTTP client (full, not BusyBox) | Already available |
| `openssh` | SSH server | Already available |
| `jq` | JSON processing | Check for regex/oniguruma support |

> **NOTE:** Verify whether Entware's `jq` includes oniguruma (regex support). OpenWRT's `jq` lacks it, and QManager's scripts already avoid `test()` / regex. If Entware's `jq` has regex, it would be an improvement but not worth depending on for portability.

---

## CGI and Web UI Layer

### Web Server: lighttpd

The RM520N-GL uses lighttpd (from Entware) instead of OpenWRT's uhttpd. Key configuration differences:

| Aspect | uhttpd (RM551E) | lighttpd (RM520N-GL) |
|--------|-----------------|----------------------|
| HTTPS | Self-signed cert, built-in | Self-signed cert, `mod_openssl` |
| Auth | QManager's cookie-based sessions | HTTP Basic Auth (`.htpasswd`) |
| CGI | Built-in interpreter support | `mod_cgi` module |
| Reverse proxy | Not used | `/console` → ttyd on 127.0.0.1:8080 |
| Process user | root (typically) | `www-data:dialout` |

**Process permissions:** lighttpd runs as `www-data:dialout`. The `dialout` group grants access to serial devices (`/dev/ttyOUT`, `/dev/ttyOUT2`). For operations requiring root (iptables, service management), sudoers rules in `/opt/etc/sudoers.d/qmanager` allow specific commands:

```
# Service control (platform.sh svc_* functions)
www-data ALL=(root) NOPASSWD: /bin/systemctl start *, /bin/systemctl stop *, /bin/systemctl restart *, /bin/systemctl is-active *

# Boot persistence (symlink-based — systemctl enable doesn't work)
www-data ALL=(root) NOPASSWD: /bin/ln -sf /lib/systemd/system/qmanager*.service ...
www-data ALL=(root) NOPASSWD: /bin/rm -f /lib/systemd/system/multi-user.target.wants/qmanager*.service

# Firewall, reboot, crontab
www-data ALL=(root) NOPASSWD: /usr/sbin/iptables, /usr/sbin/iptables-restore, /usr/sbin/ip6tables, /usr/sbin/ip6tables-restore
www-data ALL=(root) NOPASSWD: /sbin/reboot
www-data ALL=(root) NOPASSWD: /usr/bin/crontab
```

> **WARNING: Entware sudo `secure_path` restriction.** Entware's sudo has a restricted `secure_path` that does NOT include `/sbin/` or `/usr/sbin/`. All `$_SUDO` commands in `platform.sh` **must use full absolute paths** — bare command names (`systemctl`, `reboot`, `iptables`) will fail silently from CGI context. Key paths: `systemctl` is at `/bin/systemctl` (not `/usr/bin/systemctl`), `reboot` is at `/sbin/reboot`, `iptables` is at `/usr/sbin/iptables`. The `$_SYSTEMCTL` variable in `platform.sh` centralizes the systemctl path.

QManager's `platform.sh` provides wrapper functions (`svc_start`, `svc_stop`, `run_iptables`, `run_reboot`, etc.) that add `$_SUDO` with the correct full paths automatically. CGI scripts should use these wrappers, never bare commands.

### CGI AT Command Execution

The existing RM520N-GL firmware uses two approaches for AT commands in CGI scripts. QManager should standardize on microcom.

#### Approach A: microcom (Recommended)

```bash
# Adaptive wait with millisecond granularity
wait_time=200
while true; do
    runcmd=$(echo -en "${command}\r\n" | microcom -t "$wait_time" /dev/ttyOUT2)
    if echo "$runcmd" | grep -q "OK\|ERROR"; then
        break
    fi
    wait_time=$((wait_time + 1))
done
```

Advantages over `atcmd`:
- Millisecond timeout resolution (vs. 1-second polling)
- No background processes spawned
- No tmpfile management
- No ANSI escape codes to strip

#### Approach B: atcmd wrapper (Not Recommended)

```bash
runcmd=$(atcmd '$x' | awk '{ gsub(/\x1B\[[0-9;]*[mG]/, "") }1')
```

Problems:
- Single-quoted `'$x'` prevents variable expansion (bug)
- 1-second polling granularity
- No timeout (can hang forever)
- ANSI codes require stripping
- No concurrent access protection

### Existing CGI Endpoints

The RM520N-GL ships with these CGI endpoints. They represent the existing firmware's capabilities and are useful as a reference for what functionality exists, but QManager will replace them with its own CGI layer.

| Script | Method | AT Tool | Function |
|--------|--------|---------|----------|
| `get_atcommand` | `GET ?atcmd=` | microcom | General AT command execution |
| `user_atcommand` | `GET ?atcmd=` | atcmd | User AT terminal (**broken** — quoting bug) |
| `get_ping` | `GET` | — | `ping -c 1 8.8.8.8` → OK/ERROR |
| `get_ttl_status` | `GET` | — | iptables mangle read → JSON |
| `get_uptime` | `GET` | — | `uptime` → text |
| `get_watchcat_status` | `GET` | — | Read `/tmp/watchcat.json` |
| `send_sms` | `GET ?number=&msg=` | microcom | Two-step SMS (AT+CMGS) |
| `set_ttl` | `GET ?ttlvalue=` | — | iptables TTL rules via `ttl_script.sh` |
| `set_watchcat` | `GET ?WATCHCAT_ENABLED=&...` | — | Create/destroy watchcat systemd service |
| `watchcat_maker` | `GET ?WATCHCAT_ENABLED=&...` | — | Older watchcat (systemd unit writer) |

**Dashboard polling:** The existing dashboard issues a single compound AT command every 3 seconds:

```
AT+QTEMP;+QUIMSLOT?;+QSPN;+CGCONTRDP=1;+QMAP="WWANIP";
+QENG="servingcell";+QCAINFO;+QSIMSTAT?;+CSQ;+QGDNRCNT?;+QGDCNT?
```

Responses are parsed by line-prefix matching (e.g., `line.includes('+QTEMP')`) and CSV-splitting on fixed field indices — similar to QManager's poller but done in the browser instead of a backend daemon.

**Signal normalization (existing firmware):**

| Metric | Range | 0% | 100% |
|--------|-------|-----|------|
| RSRP | -135 to -65 dBm | -135 dBm | -65 dBm |
| RSRQ | -20 to -8 dB | -20 dB | -8 dB |
| SINR | -10 to +35 dB | -10 dB | +35 dB |

A minimum floor of 15% is applied to all values. QManager's poller uses similar ranges — these can be cross-referenced during the port.

### Security Concerns

The existing RM520N-GL CGI layer has a critical vulnerability:

```bash
# Every CGI script parses query strings like this:
eval $key=$value
```

This allows **shell injection** via crafted query parameters. QManager's `cgi_base.sh` with its safe query string parser will fix this, but it is worth noting in case any existing scripts are reused during the port.

### Frontend (Existing)

The RM520N-GL ships with a static HTML frontend (Alpine.js + Bootstrap 5). QManager will completely replace this with its Next.js app. No code reuse is expected, but the existing frontend's AT command patterns (compound batching, response parsing) validated that the approach works.

| Aspect | RM520N-GL (Existing) | QManager |
|--------|---------------------|----------|
| Framework | Alpine.js + Bootstrap 5 | Next.js 16 + shadcn/ui |
| Routing | Static HTML files | App Router (static export) |
| State management | Alpine.js `x-data` | React hooks + poller cache |
| Polling | `setInterval()` 3s | `useModemStatus()` 2s tiered |
| Data flow | Browser → CGI → AT | Browser → CGI → cache/AT |

---

## Networking and Firewall

### RGMII Ethernet

The RM520N-GL has an internal RGMII Ethernet controller. The modem itself acts as a NAT gateway — this is architecturally different from the RM551E, where the modem is a WAN device on an OpenWRT router.

```
                  ┌─────────────────────────────────┐
                  │         RM520N-GL Modem          │
                  │                                  │
  Cellular ──────►│  rmnet+ (data)                  │
                  │     │                            │
                  │     ▼                            │
                  │  bridge0 ─── NAT ─── eth0 ──────┼──► LAN (192.168.225.0/24)
                  │  (internal)                      │
                  │                                  │
                  │  Gateway: 192.168.225.1          │
                  └─────────────────────────────────┘
```

- **`bridge0`** — Internal bridge interface (LAN side)
- **`eth0`** — Physical Ethernet (RGMII to external device)
- **`rmnet+`** — Cellular data interfaces (wildcard, multiple PDN support)
- **IP Passthrough:** `AT+QMAP="MPDN_rule",0,1,0,1,1,"FF:FF:FF:FF:FF:FF"` (passes cellular IP directly to LAN client)

### Firewall and TTL

The RM520N-GL uses iptables directly (no framework like OpenWRT's fw4/nftables). QManager features that manipulate firewall rules will need adaptation:

| Feature | RM551E (OpenWRT) | RM520N-GL |
|---------|------------------|-----------|
| TTL set | `iptables -t mangle ... -o wwan0` | `iptables -t mangle -I POSTROUTING -o rmnet+ -j TTL --ttl-set N` |
| TTL persist | `/etc/firewall.user.ttl` | `/usrdata/simplefirewall/ttlvalue` |
| Port blocking | nftables via fw4 | iptables on `bridge0`, `eth0` |
| DPI (nfqws) | nftables NFQUEUE | iptables NFQUEUE (if kmod available) |
| Firewall restart | `fw4 reload` | `systemctl restart simplefirewall` |

> **WARNING:** The `rmnet+` wildcard syntax works with iptables `-o` matching. It is NOT the same as `wwan0`. All firewall rules in QManager's scripts that reference `wwan0` must be updated.

### LAN Configuration

On OpenWRT, LAN settings are managed through UCI (`/etc/config/network`). On the RM520N-GL, LAN configuration is stored in an XML file and edited with `xmlstarlet`:

```
/etc/data/mobileap_cfg.xml
```

AT commands also control some LAN settings:

| Setting | AT Command |
|---------|-----------|
| LAN IP / DHCP | `AT+QMAP="LANIP"` |
| DNS proxy | `AT+QMAP="DHCPV4DNS"` |
| Auto-connect | `AT+QMAPWAC=1` |
| 2.5GbE driver | `AT+QETH="eth_driver","r8125",1` |
| PCIe RC mode | `AT+QCFG="pcie/mode",1` |

QManager features that modify network configuration (MTU, DNS, LAN IP) will need to use these AT commands and/or xmlstarlet instead of UCI.

---

## Development Access

### SSH via Dropbear

SSH access is provided by `dropbear` from Entware. Since the RM520N-GL has no internet access from its own Linux environment by default, the package must be transferred manually.

**Install (offline via ADB):**
```bash
# Download on PC
curl -O https://bin.entware.net/armv7sf-k3.2/dropbear_2024.86-1_armv7-3.2.ipk

# Push and install
adb push dropbear_2024.86-1_armv7-3.2.ipk /tmp/
adb shell "/opt/bin/opkg install /tmp/dropbear_2024.86-1_armv7-3.2.ipk"
# opkg post-install auto-generates RSA, ECDSA, and ED25519 host keys
```

**Systemd service** (`/lib/systemd/system/dropbear.service`):
```ini
[Unit]
Description=Dropbear SSH Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/sbin/dropbear -F -E -p 22
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
mount -o remount,rw /
# write service file above, then:
systemctl daemon-reload
systemctl enable dropbear
systemctl start dropbear
```

Connect via: `ssh root@192.168.225.1` (device default gateway IP).

### WinSCP File Transfer

Use **SCP protocol** (not SFTP — no sftp-server is installed). Connect to `root@192.168.225.1:22`.

**Gotcha — console menu blocks SCP sessions:** The device ships with an interactive console menu (from the iamromulan toolkit) that launches on every login shell. This causes WinSCP to hang at "Starting Session" because SCP's shell session is intercepted by the menu instead of running commands.

**Fix:** In WinSCP → Advanced → SCP/Shell → Shell, set:
```
/bin/bash --norc --noprofile
```
This starts a clean shell bypassing `.bashrc`/`.profile` where the menu is launched. Interactive SSH terminal sessions are unaffected — just press `4` (Exit to Root Shell) when the menu appears.

---

## Watchdog Services

The RM520N-GL has three independent watchdog mechanisms, compared to QManager's single integrated `qmanager_watchcat`:

| Watchdog | Monitors | Action | Config |
|----------|----------|--------|--------|
| Ethernet watchdog | `dmesg` for eth0 errors | `AT+CFUN=1,1` (reboot) | Systemd service |
| Ping watchdog | `ping google.com` x6 | Reboot on all-fail | Systemd service |
| Watchcat (web) | Configurable IP | Configurable timeout/action | Dynamic systemd unit |

QManager's `qmanager_watchcat` (5-state machine with 4-tier escalation) is significantly more sophisticated. For the port, QManager's watchdog should replace all three existing mechanisms. The systemd service units will need to replace the current procd-based init.d scripts.

---

## VPN (Tailscale)

The RM520N-GL already has Tailscale support, making the port of QManager's Tailscale feature straightforward:

| Aspect | RM551E (OpenWRT) | RM520N-GL |
|--------|------------------|-----------|
| Binary | opkg package | Static ARM binary from pkgs.tailscale.com |
| State dir | `/var/lib/tailscale/` | `/usrdata/tailscale/` |
| Init | procd init.d service | `tailscaled.service` (systemd) |
| Flags | `--accept-dns=false` | `--accept-dns=false` (same constraint) |
| Web UI | Not available | Optional, port 8088 |
| Firewall | fw4 zone + mwan3 ipset | iptables rules (SimpleFIrewall) |

> **NOTE:** The `--accept-routes` prohibition documented in QManager's memory (`feedback_accept-routes-forbidden.md`) applies equally here.

---

## Porting Strategy Summary

### Phase 1: AT Transport Layer ✅ COMPLETE

Delivered `qcmd` (sms_tool + flock serialization on `/dev/ttyOUT2`), `sms.sh` (SMS CGI), and `qcmd_test` (smoke tests). Source files use deployment names directly (no `_rm520n` suffix).

### Phase 2: Init System & Config Migration ✅ COMPLETE

Delivered 8 systemd service files (installed to `/lib/systemd/system/`, no intermediate `qmanager.target`), `config.sh` (UCI replacement library with JSON config at `/etc/qmanager/qmanager.conf`), `qmanager_setup` one-shot (remounts rootfs rw at boot), and daemon UCI removal.

### Phase 3: CGI & Script Migration ✅ COMPLETE

All UCI, `/etc/init.d/`, `ifdown`/`ifup`, and procd patterns removed from CGI scripts, library scripts, and daemon scripts. Created `platform.sh` (systemd service control abstraction with sudo for www-data, `svc_enable`/`svc_disable` via symlinks, `pid_alive()` for cross-user PID checks), `system_config.sh` (hostname/timezone via standard Linux APIs). Watchcat Tier 1 recovery migrated from `ifdown`/`ifup` to `AT+COPS=2`/`AT+COPS=0`. `cgi_base.sh` sources `platform.sh`, making `pid_alive` available to all CGI scripts.

### Phase 4: Web Server, Auth & Deployment ✅ COMPLETE

Delivered lighttpd config (no HTTP Basic Auth -- QManager's cookie-based sessions pass through), sudoers rules for `www-data`, `install_rm520n.sh` and `uninstall_rm520n.sh` (systemd + Entware), TLS cert management, and Web Console nav entry. Build script updated to produce RM520N-GL-only tarball with bundled dependencies (`dependencies/` folder: `sms_tool`, `jq.ipk`, `dropbear.ipk`). Install is fully offline-capable.

### Phase 5: Final Cleanup ✅ COMPLETE

Poller network interface detection (wwan0 → rmnet_ipa0 on RM520N-GL). Email alerts opkg path detection (Entware `/opt/bin/opkg`). Device About OS version fallback (`/etc/quectel-project-version`). Frontend labels updated ("System Version", "Quectel modems"). Removed dead feature defaults from config.sh.

### Remaining: Hardware Validation

1. **IP Passthrough** — verify AT+QMAP commands work identically on RM520N-GL hardware
2. **End-to-end deployment test** — full install, service startup, frontend access, auth flow
3. **Network interface confirmation** — verify `rmnet_ipa0` is the correct interface for traffic stats

### Deferred Features (Not Ported)

The following features have been removed from the `dev-rm520` branch and are not planned for the initial RM520N-GL release:

| Feature | Reason |
|---------|--------|
| VPN Management (Tailscale + NetBird) | Depends on fw4 zones, mwan3 ipset, nftables — no equivalent on RM520N-GL |
| Video Optimizer / Traffic Masquerade (DPI) | Depends on nftables NFQUEUE; nfqws ARM32 binary not validated |
| Bandwidth Monitor | ARM64 binary not portable to ARM32; websocat WSS dependency |
| Ethernet Status & Link Speed | RM520N-GL uses RGMII (bridge0/eth0) vs USB Ethernet — different management model |
| Custom DNS | Depends on UCI network config — no equivalent on RM520N-GL |
| WAN Interface Guard | OpenWRT netifd-specific (ifdown/uci network) — no netifd on RM520N-GL |
| Low Power Mode (daemons) | Daemon scripts removed; cron/config management retained in settings CGI |

---

## Custom SIM Profiles — Auto-Apply on ICCID Match

Custom SIM Profiles are automatically applied whenever the modem's current SIM ICCID matches a saved profile. This replaces the previous manual-only "Apply" workflow. The apply script (`qmanager_profile_apply`) compares current modem state against the profile's desired settings and only changes what has drifted, making auto-apply a no-op when nothing has changed.

### Key Files

| File | Purpose |
|------|---------|
| `/usr/lib/qmanager/profile_mgr.sh` | Library: `find_profile_by_iccid()`, `auto_apply_profile()`, CRUD, lock management |
| `/usr/bin/qmanager_profile_apply` | Daemon: 3-step apply (APN, TTL/HL, IMEI) — spawned in background |
| `/etc/qmanager/profiles/p_*.json` | Profile storage (one file per profile, includes `sim_iccid` field) |
| `/etc/qmanager/active_profile` | Plain text file containing the active profile ID |
| `/tmp/qmanager_profile_apply.pid` | PID file for apply singleton lock |
| `/tmp/qmanager_profile_state.json` | Apply progress (frontend polls this) |

### Auto-Apply Functions

**`find_profile_by_iccid(iccid)`** scans all profile files in `/etc/qmanager/profiles/` and returns the ID of the first profile whose `.sim_iccid` matches the given ICCID.

**`auto_apply_profile(iccid, caller)`** orchestrates the full auto-apply flow:

1. Calls `find_profile_by_iccid()` to search for a matching profile
2. If found: calls `set_active_profile()` to write the profile ID to `/etc/qmanager/active_profile`, then spawns `qmanager_profile_apply` via double-fork (`( cmd </dev/null >/dev/null 2>&1 & )`)
3. If not found: calls `clear_active_profile()` to remove any stale active marker
4. The `caller` argument (`boot`, `sim_switch`, `watchdog`, `watchdog_revert`) is logged for debugging

### Trigger Points

| Trigger | Caller Tag | Source File | When |
|---------|-----------|-------------|------|
| Boot | `boot` | `qmanager_poller` `collect_boot_data()` | After ICCID read + SIM swap detection |
| Manual SIM switch | `sim_switch` | `cellular/settings.sh` | After CFUN=1 restore completes |
| Watchdog Tier 3 failover | `watchdog` | `qmanager_watchcat` cooldown handler | After SIM failover confirmed with connectivity |
| Watchdog SIM revert | `watchdog_revert` | `qmanager_watchcat` `sim_failover_fallback()` | After reverting to original SIM |

### RM520N-GL Platform Considerations

**`fs.protected_regular` handling:** The profile apply PID file (`/tmp/qmanager_profile_apply.pid`) and state file (`/tmp/qmanager_profile_state.json`) are pre-created with `www-data` ownership by `qmanager_setup` at boot. This prevents the scenario where a root-context boot-time auto-apply creates these files first, blocking later CGI access from `www-data`.

**PID checks use `/proc/$pid`:** The `profile_check_lock()` function and the watchcat's profile-apply-running check both use `[ -d "/proc/$pid" ]` instead of `kill -0`, because `www-data` (CGI) cannot send signals to root-owned processes due to EPERM. The `/proc` check works cross-user.

**Poller sources `profile_mgr.sh` at startup** with a no-op fallback if the file is missing:

```bash
. /usr/lib/qmanager/profile_mgr.sh 2>/dev/null || {
    auto_apply_profile() { :; }
}
```

This ensures the poller continues working even if `profile_mgr.sh` is deleted or corrupted — the auto-apply call in `collect_boot_data()` becomes a silent no-op.

**Watchcat and settings.sh** source `profile_mgr.sh` conditionally (`[ -f ... ] && .`). The watchcat sources it at startup alongside other libraries; `settings.sh` sources it inline at the point of use (inside the SIM switch handler).

---

## Appendix: AT Commands Unique to RM520N-GL

These AT commands are specific to the RM520N-GL platform and do not exist on the RM551E. They may be needed for new features or platform-specific configuration.

| Command | Function | Example |
|---------|----------|---------|
| `AT+QETH="eth_driver","r8125",1` | Enable Realtek 2.5GbE driver | Enable 2.5G Ethernet |
| `AT+QCFG="pcie/mode",1` | Enable PCIe Root Complex mode | For external PCIe devices |
| `AT+QMAP="LANIP"` | Query/set LAN DHCP settings | LAN IP configuration |
| `AT+QMAP="DHCPV4DNS"` | DNS proxy control | Enable/disable DNS forwarding |
| `AT+QMAPWAC=1` | Auto-connect for Ethernet clients | Enable auto data connection |
| `AT+QMAP="MPDN_rule",0,1,0,1,1,"FF:FF:FF:FF:FF:FF"` | IP Passthrough mode | Pass cellular IP to LAN |
| `AT+QGDNRCNT?` | NR5G data counter | Traffic stats (NR) |
| `AT+QGDCNT?` | LTE data counter | Traffic stats (LTE) |
