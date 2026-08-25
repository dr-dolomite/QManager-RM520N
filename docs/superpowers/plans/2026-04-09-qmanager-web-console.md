# QManager Web Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a web-based terminal (ttyd) as a QManager-managed service, replacing the dependency on SimpleAdmin's console. Users get a browser-based root shell at `/console` with the proper PATH for Entware tools.

**Architecture:** Download the ttyd armhf binary from GitHub during QManager install, run it as a systemd service bound to localhost:8080, and proxy through lighttpd (already configured). The shell session sets up PATH to include Entware directories and drops the user into bash. No interactive menu — QManager's web UI replaces that. A CGI endpoint manages service start/stop/install for the frontend.

**Tech Stack:** ttyd v1.7.7 (armhf binary), systemd, lighttpd mod_proxy (already configured), POSIX shell

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `scripts/usr/bin/qmanager_console_mgr` | Privileged helper: download/install/uninstall ttyd binary |
| `scripts/etc/systemd/system/qmanager-console.service` | Systemd unit for ttyd (localhost:8080) |
| `scripts/usrdata/qmanager/console/console.sh` | Shell startup script for console sessions (PATH setup) |

### Modified Files

| File | Changes |
|------|---------|
| `scripts/install_rm520n.sh` | Download ttyd during install, enable service |
| `scripts/uninstall_rm520n.sh` | Stop console service, remove ttyd binary |
| `scripts/etc/sudoers.d/qmanager` | Add rule for console helper |
| `CLAUDE.md` | Document the console service |

---

## Task 1: Create console shell startup script

A simple bash script that sets up the environment for console sessions. Replaces SimpleAdmin's `ttyd.bash` + `start_menu.sh` — QManager doesn't need a menu since the web UI provides all configuration.

**Files:**
- Create: `scripts/usrdata/qmanager/console/console.sh`

- [ ] **Step 1: Create the startup script**

```sh
#!/bin/bash
# QManager Console — Shell startup for ttyd sessions
# Sets up PATH for Entware tools and drops into an interactive bash shell.

export PATH=/opt/bin:/opt/sbin:/usrdata/root/bin:/usr/bin:/usr/sbin:/bin:/sbin
export HOME=/usrdata/root
export TERM=xterm-256color

cd "$HOME" 2>/dev/null || cd /

printf '\033[1;36m'
printf '  QManager Console\n'
printf '  Type "exit" to close this session.\n'
printf '\033[0m\n'

exec /bin/bash --login
```

- [ ] **Step 2: Commit**

```bash
git add scripts/usrdata/qmanager/console/console.sh
git commit -m "feat: add QManager console shell startup script

Sets up PATH with Entware directories, HOME, and TERM for ttyd
sessions. Drops into interactive bash — no menu system (QManager
web UI replaces SimpleAdmin's console menu)."
```

---

## Task 2: Create `qmanager-console.service` systemd unit

Systemd service running ttyd bound to localhost:8080. Lighttpd's mod_proxy already reverse-proxies `/console` to this port with WebSocket upgrade support.

**Files:**
- Create: `scripts/etc/systemd/system/qmanager-console.service`

- [ ] **Step 1: Create the systemd unit**

```ini
# /lib/systemd/system/qmanager-console.service
[Unit]
Description=QManager Web Console (ttyd)
After=network.target lighttpd.service

[Service]
Type=simple
ExecStartPre=/bin/sleep 2
ExecStart=/usrdata/qmanager/console/ttyd -i 127.0.0.1 -p 8080 -t 'theme={"foreground":"#e4e4e7","background":"#09090b","cursor":"#e4e4e7"}' -t fontSize=14 --writable /usrdata/qmanager/console/console.sh
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Key decisions:
- **After=lighttpd.service** — lighttpd must be running for the reverse proxy to work
- **ExecStartPre sleep 2** — gives lighttpd time to be fully ready (same pattern as SimpleAdmin's 5s but shorter)
- **Bind 127.0.0.1 only** — not exposed on LAN directly, only through lighttpd proxy (inherits lighttpd's auth)
- **Theme colors** — matches QManager's dark theme (zinc-950 background `#09090b`, zinc-200 foreground `#e4e4e7`)
- **Font size 14** — reasonable default for modern browsers (SimpleAdmin uses 25 which is very large)
- **`--writable`** — allows terminal input
- **Binary path** — `/usrdata/qmanager/console/ttyd` (QManager-owned, not in SimpleAdmin's directory)

- [ ] **Step 2: Commit**

```bash
git add scripts/etc/systemd/system/qmanager-console.service
git commit -m "feat: add qmanager-console systemd service for ttyd

Runs ttyd on localhost:8080, proxied by lighttpd at /console.
Theme matches QManager's dark mode. Starts after lighttpd with
2s delay for proxy readiness."
```

---

## Task 3: Create `qmanager_console_mgr` helper script

Privileged helper for downloading/installing/uninstalling the ttyd binary. Same pattern as `qmanager_tailscale_mgr`.

**Files:**
- Create: `scripts/usr/bin/qmanager_console_mgr`

- [ ] **Step 1: Create the helper script**

```sh
#!/bin/sh
# qmanager_console_mgr — Privileged ttyd install/uninstall helper
# Called during QManager install or by CGI via sudo.
#
# Usage:
#   qmanager_console_mgr install      Download + install ttyd armhf binary
#   qmanager_console_mgr uninstall    Remove ttyd binary and service

set -e

TTYD_VERSION="1.7.7"
CONSOLE_DIR="/usrdata/qmanager/console"
TTYD_BIN="$CONSOLE_DIR/ttyd"
DOWNLOAD_URL="https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.armhf"
SYSTEMD_DIR="/lib/systemd/system"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"

do_install() {
    mount -o remount,rw / 2>/dev/null || true

    mkdir -p "$CONSOLE_DIR"
    chmod 755 "$CONSOLE_DIR"

    # Download ttyd binary
    if [ -x "$TTYD_BIN" ]; then
        echo "ttyd already installed at $TTYD_BIN"
        mount -o remount,ro / 2>/dev/null || true
        return 0
    fi

    echo "Downloading ttyd v${TTYD_VERSION}..."
    if ! curl -fSL -o "$TTYD_BIN" "$DOWNLOAD_URL" 2>/dev/null; then
        if ! wget -q -O "$TTYD_BIN" "$DOWNLOAD_URL" 2>/dev/null; then
            echo "ERROR: Failed to download ttyd" >&2
            rm -f "$TTYD_BIN"
            mount -o remount,ro / 2>/dev/null || true
            return 1
        fi
    fi

    chmod 755 "$TTYD_BIN"

    # Ensure console startup script is executable
    [ -f "$CONSOLE_DIR/console.sh" ] && chmod 755 "$CONSOLE_DIR/console.sh"

    # Copy systemd unit if staged by installer
    if [ -f /usr/lib/qmanager/qmanager-console.service ] && [ ! -f "$SYSTEMD_DIR/qmanager-console.service" ]; then
        cp -f /usr/lib/qmanager/qmanager-console.service "$SYSTEMD_DIR/"
        sed -i 's/\r$//' "$SYSTEMD_DIR/qmanager-console.service"
    fi

    # Enable and start
    if [ -f "$SYSTEMD_DIR/qmanager-console.service" ]; then
        ln -sf "$SYSTEMD_DIR/qmanager-console.service" "$WANTS_DIR/qmanager-console.service"
        /bin/systemctl daemon-reload
        /bin/systemctl start qmanager-console 2>/dev/null || true
    fi

    mount -o remount,ro / 2>/dev/null || true
    echo "ttyd v${TTYD_VERSION} installed successfully"
}

do_uninstall() {
    mount -o remount,rw / 2>/dev/null || true

    /bin/systemctl stop qmanager-console 2>/dev/null || true
    rm -f "$WANTS_DIR/qmanager-console.service"
    rm -f "$SYSTEMD_DIR/qmanager-console.service"
    /bin/systemctl daemon-reload 2>/dev/null || true

    rm -f "$TTYD_BIN"

    mount -o remount,ro / 2>/dev/null || true
    echo "ttyd uninstalled"
}

case "${1:-}" in
    install)   do_install ;;
    uninstall) do_uninstall ;;
    *)
        echo "Usage: qmanager_console_mgr {install|uninstall}" >&2
        exit 1
        ;;
esac
```

- [ ] **Step 2: Commit**

```bash
git add scripts/usr/bin/qmanager_console_mgr
git commit -m "feat: add qmanager_console_mgr helper for ttyd install/uninstall

Downloads ttyd v1.7.7 armhf binary from GitHub. Installs to
/usrdata/qmanager/console/ttyd. Enables and starts the systemd
service. Same pattern as qmanager_tailscale_mgr."
```

---

## Task 4: Update sudoers for console helper

**Files:**
- Modify: `scripts/etc/sudoers.d/qmanager`

- [ ] **Step 1: Add console helper rule**

After the existing Tailscale rules, add:

```
# Web console management
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_console_mgr
```

- [ ] **Step 2: Commit**

```bash
git add scripts/etc/sudoers.d/qmanager
git commit -m "feat: add sudoers rule for qmanager_console_mgr helper"
```

---

## Task 5: Update installer to deploy and install ttyd

Deploy the console files during install and download ttyd. The ttyd download is non-fatal — if it fails (no internet), the console just won't be available.

**Files:**
- Modify: `scripts/install_rm520n.sh`

- [ ] **Step 1: Stage the console systemd unit in the library directory**

In the section that stages Tailscale systemd units (the loop with `tailscaled.service tailscaled.defaults`), add `qmanager-console.service`:

Find:
```sh
    for f in tailscaled.service tailscaled.defaults; do
```

Replace with:
```sh
    for f in tailscaled.service tailscaled.defaults qmanager-console.service; do
```

- [ ] **Step 2: Copy the console startup script during backend install**

After the CGI endpoints section, add deployment of the console directory:

```sh
    # --- Console startup script ---
    if [ -d "$SRC_SCRIPTS/usrdata/qmanager/console" ]; then
        mkdir -p "$QMANAGER_ROOT/console"
        cp "$SRC_SCRIPTS/usrdata/qmanager/console"/* "$QMANAGER_ROOT/console/" 2>/dev/null || true
        find "$QMANAGER_ROOT/console" -name "*.sh" -exec sed -i 's/\r$//' {} \;
        find "$QMANAGER_ROOT/console" -name "*.sh" -exec chmod 755 {} \;
        info "Console startup script installed"
    fi
```

- [ ] **Step 3: Add console service to always-on list and start ttyd download**

Find the always-on services loop:
```sh
    for svc in qmanager-firewall qmanager-setup qmanager-ping qmanager-poller qmanager-ttl \
               qmanager-mtu qmanager-imei-check; do
```

Add `qmanager-console`:
```sh
    for svc in qmanager-firewall qmanager-setup qmanager-ping qmanager-poller qmanager-ttl \
               qmanager-mtu qmanager-imei-check qmanager-console; do
```

After the service startup section, add the ttyd download (non-fatal):

```sh
    # Download ttyd for web console (non-fatal — console is optional)
    if [ ! -x /usrdata/qmanager/console/ttyd ]; then
        info "Downloading ttyd for web console..."
        /usr/bin/qmanager_console_mgr install 2>/dev/null || warn "ttyd download failed — web console unavailable"
    fi
```

- [ ] **Step 4: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "feat: deploy console files and download ttyd during install

Stages qmanager-console.service, copies console.sh startup script,
adds console to always-on services, downloads ttyd binary. Download
is non-fatal — console shows as unavailable if it fails."
```

---

## Task 6: Update uninstaller

**Files:**
- Modify: `scripts/uninstall_rm520n.sh`

- [ ] **Step 1: Add qmanager-console to the service stop loop**

Find the service stop loop:
```sh
for svc in qmanager-firewall qmanager-poller qmanager-ping qmanager-watchcat \
```

Add `qmanager-console`:
```sh
for svc in qmanager-console qmanager-firewall qmanager-poller qmanager-ping qmanager-watchcat \
```

The console directory (`/usrdata/qmanager/console/`) is already cleaned up by the existing `rm -rf "$QMANAGER_ROOT"` step that removes all of `/usrdata/qmanager/`.

- [ ] **Step 2: Commit**

```bash
git add scripts/uninstall_rm520n.sh
git commit -m "feat: stop qmanager-console service during uninstall"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add console documentation to QManager Independence section**

After the Tailscale VPN bullet, add:

```
- **Web console:** `qmanager-console.service` runs ttyd v1.7.7 (armhf) on localhost:8080, reverse-proxied by lighttpd at `/console` with WebSocket upgrade. Downloaded during install (non-fatal if offline). Binary at `/usrdata/qmanager/console/ttyd`. Theme matches QManager dark mode. Shell startup script sets PATH for Entware tools.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document web console service in CLAUDE.md"
```

---

## Implementation Notes

### How it works end-to-end

1. **Install:** `qmanager_console_mgr install` downloads `ttyd.armhf` from GitHub to `/usrdata/qmanager/console/ttyd`
2. **Boot:** `qmanager-console.service` starts ttyd bound to `127.0.0.1:8080` with the console.sh startup script
3. **Access:** User clicks "Web Console" in sidebar → browser navigates to `/console` → lighttpd's mod_proxy forwards to `localhost:8080` with WebSocket upgrade → ttyd renders an interactive terminal
4. **Auth:** Protected by lighttpd's existing cookie-based session auth (same as all CGI endpoints)
5. **Shell:** console.sh sets up PATH (includes `/opt/bin`, `/opt/sbin` for Entware) and drops into bash

### What's different from SimpleAdmin

| Aspect | SimpleAdmin | QManager |
|--------|-------------|----------|
| Binary location | `/usrdata/simpleadmin/console/ttyd` | `/usrdata/qmanager/console/ttyd` |
| Service name | `ttyd.service` | `qmanager-console.service` |
| Startup script | `ttyd.bash` → `start_menu.sh` (interactive menu) | `console.sh` (sets PATH, drops to bash) |
| Theme | White on black, 25pt font | Zinc-200 on zinc-950 (#e4e4e7/#09090b), 14pt font |
| Auth | HTTP Basic Auth (htpasswd) | Cookie-based session (QManager auth) |
| Install | Part of SimpleAdmin install | Part of QManager install (non-fatal if download fails) |
| Startup delay | 5 seconds | 2 seconds |

### Lighttpd proxy (already configured)

The proxy rule at `scripts/usrdata/qmanager/lighttpd.conf:59-64` is already in place:
```
$HTTP["url"] =~ "(^/console)" {
    proxy.header = ("map-urlpath" => ( "/console" => "/" ), "upgrade" => "enable" )
    proxy.server = ( "" => ("" => ( "host" => "127.0.0.1", "port" => 8080 )))
}
```

No changes needed — this was included in the original QManager lighttpd config.
