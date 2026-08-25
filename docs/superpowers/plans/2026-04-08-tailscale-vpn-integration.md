# Tailscale VPN Integration — RM520N-GL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the existing OpenWRT-targeted Tailscale VPN feature to work on the RM520N-GL platform (vanilla Linux/systemd), enabling users to install, configure, and manage a Tailscale mesh VPN from the QManager web UI.

**Architecture:** A privileged helper script (`qmanager_tailscale_mgr`) handles install/uninstall of the Tailscale ARM binary from `pkgs.tailscale.com`. The CGI endpoint uses `platform.sh` for service control and `sudo` for Tailscale CLI commands. Frontend components are adapted from the existing OpenWRT implementation with minimal changes (remove NetBird mutual exclusion, fix type imports, update install hints). Firewall integration uses the existing `run_iptables` pattern from `platform.sh`.

**Tech Stack:** POSIX shell (CGI + helper), systemd units, iptables, React/TypeScript (Next.js), shadcn/ui, `authFetch` pattern.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `scripts/usr/bin/qmanager_tailscale_mgr` | Privileged helper: download/install/uninstall Tailscale ARM binary |
| `scripts/etc/systemd/system/tailscaled.service` | Systemd unit for tailscaled daemon (adapted from simpleadmin) |
| `scripts/etc/systemd/system/tailscaled.defaults` | Environment config (port, flags) |
| `app/monitoring/tailscale/page.tsx` | Next.js route page |

### Modified Files

| File | Changes |
|------|---------|
| `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` | Full rewrite: replace UCI/init.d/opkg with systemd/platform.sh/helper |
| `hooks/use-tailscale.ts` | Inline `InstallResult` type (remove video-optimizer import), remove `other_vpn` fields |
| `components/monitoring/tailscale/tailscale.tsx` | Remove NetBird mutual exclusion guard |
| `components/monitoring/tailscale/tailscale-connection-card.tsx` | Update install hint text, remove opkg references |
| `components/app-sidebar.tsx` | Add Tailscale entry under Monitoring nav group |
| `scripts/etc/sudoers.d/qmanager` | Add rules for tailscale CLI + tailscaled boot symlinks + helper |
| `scripts/install_rm520n.sh` | Deploy helper, systemd units, vpn CGI directory |
| `scripts/usr/bin/qmanager_setup` | Add tailscale0 iptables rules at boot (if installed) |

---

## Task 1: Create `tailscaled.service` and `tailscaled.defaults`

Systemd unit files adapted from `simpleadmin-source/tailscale/systemd/` for QManager conventions.

**Files:**
- Create: `scripts/etc/systemd/system/tailscaled.service`
- Create: `scripts/etc/systemd/system/tailscaled.defaults`

- [ ] **Step 1: Create `tailscaled.service`**

```ini
[Unit]
Description=Tailscale node agent
Documentation=https://tailscale.com/kb/
Wants=network-pre.target
After=network-pre.target NetworkManager.service systemd-resolved.service

[Service]
EnvironmentFile=/usrdata/tailscale/systemd/tailscaled.defaults
ExecStartPre=/usrdata/tailscale/tailscaled --cleanup
ExecStart=/usrdata/tailscale/tailscaled --statedir=/usrdata/tailscale/ --port=${PORT} $FLAGS
ExecStopPost=/usrdata/tailscale/tailscaled --cleanup
Restart=on-failure
RestartSec=5s
Type=notify

[Install]
WantedBy=multi-user.target
```

Key decisions:
- State dir is `/usrdata/tailscale/` (persistent partition, same as simpleadmin — ensures upgrade compatibility)
- Binary paths are absolute (`/usrdata/tailscale/tailscaled`) — not in system PATH
- Added `RestartSec=5s` vs simpleadmin original (prevents tight restart loops)

- [ ] **Step 2: Create `tailscaled.defaults`**

```ini
# Tailscale daemon configuration — sourced by tailscaled.service
# Port for incoming VPN packets (WireGuard). Remote nodes auto-discover this.
PORT="41641"

# Extra flags for tailscaled (e.g., --verbose=1 for debug logging)
FLAGS=""
```

- [ ] **Step 3: Commit**

```bash
git add scripts/etc/systemd/system/tailscaled.service scripts/etc/systemd/system/tailscaled.defaults
git commit -m "$(cat <<'EOF'
feat: add tailscaled systemd unit and defaults for RM520N-GL

Adapted from simpleadmin tailscale systemd config. Binary and state
stored in /usrdata/tailscale/ (persistent partition). Added RestartSec
to prevent tight restart loops on failure.
EOF
)"
```

---

## Task 2: Create `qmanager_tailscale_mgr` helper script

Privileged helper for install/uninstall operations that require root. Called via `sudo` from the CGI script. Follows the `qmanager_set_ssh_password` pattern — a single whitelisted binary.

**Files:**
- Create: `scripts/usr/bin/qmanager_tailscale_mgr`

- [ ] **Step 1: Create the helper script**

```sh
#!/bin/sh
# qmanager_tailscale_mgr — Privileged Tailscale install/uninstall helper
# Called by www-data CGI via sudo. Whitelisted in /etc/sudoers.d/qmanager.
#
# Usage:
#   qmanager_tailscale_mgr install          Download + install Tailscale ARM binary
#   qmanager_tailscale_mgr uninstall        Remove binaries, units, state
#   qmanager_tailscale_mgr ensure_units     Copy systemd units (idempotent)
#
# Install writes JSON progress to /tmp/qmanager_tailscale_install.json
# for the CGI to poll via install_status action.

set -e

TAILSCALE_VERSION="1.92.5"
TAILSCALE_DIR="/usrdata/tailscale"
TAILSCALE_SYSD_DIR="/usrdata/tailscale/systemd"
SYSTEMD_DIR="/lib/systemd/system"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
INSTALL_RESULT="/tmp/qmanager_tailscale_install.json"
INSTALL_PID="/tmp/qmanager_tailscale_install.pid"
DOWNLOAD_URL="https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_arm.tgz"

write_progress() {
    printf '%s' "$1" > "$INSTALL_RESULT"
}

do_install() {
    echo $$ > "$INSTALL_PID"
    trap 'rm -f "$INSTALL_PID"' EXIT

    # Remount root filesystem read-write (RM520N-GL default is read-only)
    mount -o remount,rw / 2>/dev/null || true

    write_progress '{"success":true,"status":"running","message":"Creating directories..."}'
    mkdir -p "$TAILSCALE_DIR" "$TAILSCALE_SYSD_DIR"

    # Download ARM binary
    write_progress '{"success":true,"status":"running","message":"Downloading Tailscale v'"$TAILSCALE_VERSION"'..."}'
    cd /tmp
    rm -f "tailscale_${TAILSCALE_VERSION}_arm.tgz"

    if ! curl -fSL -o "tailscale_${TAILSCALE_VERSION}_arm.tgz" "$DOWNLOAD_URL" 2>/dev/null; then
        # Fallback to wget if curl fails
        if ! wget -q -O "tailscale_${TAILSCALE_VERSION}_arm.tgz" "$DOWNLOAD_URL" 2>/dev/null; then
            write_progress '{"success":false,"status":"error","message":"Failed to download Tailscale","detail":"Check internet connection. URL: '"$DOWNLOAD_URL"'"}'
            mount -o remount,ro / 2>/dev/null || true
            return 1
        fi
    fi

    # Extract
    write_progress '{"success":true,"status":"running","message":"Extracting binary..."}'
    tar -xzf "tailscale_${TAILSCALE_VERSION}_arm.tgz" -C /tmp/
    rm -f "tailscale_${TAILSCALE_VERSION}_arm.tgz"

    EXTRACT_DIR="/tmp/tailscale_${TAILSCALE_VERSION}_arm"
    if [ ! -f "$EXTRACT_DIR/tailscale" ] || [ ! -f "$EXTRACT_DIR/tailscaled" ]; then
        write_progress '{"success":false,"status":"error","message":"Extraction failed — binaries not found in archive"}'
        rm -rf "$EXTRACT_DIR"
        mount -o remount,ro / 2>/dev/null || true
        return 1
    fi

    # Install binaries
    write_progress '{"success":true,"status":"running","message":"Installing binaries..."}'
    mv "$EXTRACT_DIR/tailscale" "$EXTRACT_DIR/tailscaled" "$TAILSCALE_DIR/"
    chmod +x "$TAILSCALE_DIR/tailscale" "$TAILSCALE_DIR/tailscaled"
    rm -rf "$EXTRACT_DIR"

    # Symlink CLI to PATH
    mkdir -p /usrdata/root/bin
    ln -sf "$TAILSCALE_DIR/tailscale" /usrdata/root/bin/tailscale

    # Copy systemd units from QManager source (installed by QManager installer)
    # If QManager systemd source files exist, use them; otherwise create defaults
    if [ -f "$TAILSCALE_SYSD_DIR/tailscaled.service" ]; then
        cp -f "$TAILSCALE_SYSD_DIR/tailscaled.service" "$SYSTEMD_DIR/"
    elif [ -f /usr/lib/qmanager/tailscaled.service ]; then
        cp -f /usr/lib/qmanager/tailscaled.service "$SYSTEMD_DIR/"
        cp -f /usr/lib/qmanager/tailscaled.service "$TAILSCALE_SYSD_DIR/"
    fi

    if [ ! -f "$TAILSCALE_SYSD_DIR/tailscaled.defaults" ]; then
        printf 'PORT="41641"\nFLAGS=""\n' > "$TAILSCALE_SYSD_DIR/tailscaled.defaults"
    fi

    # Ensure systemd unit exists
    if [ ! -f "$SYSTEMD_DIR/tailscaled.service" ]; then
        write_progress '{"success":false,"status":"error","message":"Systemd unit not found after install","detail":"tailscaled.service missing from '"$SYSTEMD_DIR"'"}'
        mount -o remount,ro / 2>/dev/null || true
        return 1
    fi

    # Enable on boot (symlink pattern — systemctl enable doesn't work on RM520N-GL)
    ln -sf "$SYSTEMD_DIR/tailscaled.service" "$WANTS_DIR/tailscaled.service"

    # Strip Windows line endings from systemd unit (safety for Windows-built tarballs)
    sed -i 's/\r$//' "$SYSTEMD_DIR/tailscaled.service" 2>/dev/null || true
    sed -i 's/\r$//' "$TAILSCALE_SYSD_DIR/tailscaled.defaults" 2>/dev/null || true

    # Reload and start
    write_progress '{"success":true,"status":"running","message":"Starting Tailscale daemon..."}'
    /bin/systemctl daemon-reload
    /bin/systemctl start tailscaled 2>/dev/null

    # Verify
    sleep 1
    if [ -f "$TAILSCALE_DIR/tailscale" ] && [ -f "$TAILSCALE_DIR/tailscaled" ]; then
        write_progress '{"success":true,"status":"complete","message":"Tailscale v'"$TAILSCALE_VERSION"' installed successfully"}'
    else
        write_progress '{"success":false,"status":"error","message":"Install completed but binaries not found"}'
    fi

    mount -o remount,ro / 2>/dev/null || true
}

do_uninstall() {
    mount -o remount,rw / 2>/dev/null || true

    # Stop daemon if running
    /bin/systemctl stop tailscaled 2>/dev/null || true

    # Remove boot symlink
    rm -f "$WANTS_DIR/tailscaled.service"

    # Remove systemd unit from system dir
    rm -f "$SYSTEMD_DIR/tailscaled.service"
    /bin/systemctl daemon-reload 2>/dev/null || true

    # Remove binaries and state
    rm -rf "$TAILSCALE_DIR"

    # Remove CLI symlink
    rm -f /usrdata/root/bin/tailscale

    # Clean up temp files
    rm -f /tmp/qmanager_tailscale_auth_url \
          /tmp/qmanager_tailscale_up_output \
          /tmp/qmanager_tailscale_up_pid \
          /tmp/qmanager_tailscale_install.json \
          /tmp/qmanager_tailscale_install.pid

    mount -o remount,ro / 2>/dev/null || true
}

do_ensure_units() {
    # Copy QManager-bundled systemd units to /usrdata/tailscale/systemd/
    # Called by installer to pre-stage units before Tailscale is installed.
    mount -o remount,rw / 2>/dev/null || true
    mkdir -p "$TAILSCALE_SYSD_DIR"

    for f in tailscaled.service tailscaled.defaults; do
        src="/usr/lib/qmanager/$f"
        if [ -f "$src" ]; then
            cp -f "$src" "$TAILSCALE_SYSD_DIR/$f"
            sed -i 's/\r$//' "$TAILSCALE_SYSD_DIR/$f" 2>/dev/null || true
        fi
    done

    mount -o remount,ro / 2>/dev/null || true
}

# ─── Main dispatch ─────────────────────────────────────────────────────────
case "${1:-}" in
    install)     do_install ;;
    uninstall)   do_uninstall ;;
    ensure_units) do_ensure_units ;;
    *)
        echo "Usage: qmanager_tailscale_mgr {install|uninstall|ensure_units}" >&2
        exit 1
        ;;
esac
```

Key design decisions:
- `install` writes JSON progress to `/tmp/qmanager_tailscale_install.json` — the CGI polls this file
- Remounts root RW/RO (RM520N-GL has read-only root by default)
- Uses symlink pattern for boot persistence (`ln -sf` into multi-user.target.wants)
- Strips Windows line endings (safety for Windows-built tarballs per CLAUDE.md)
- Version hardcoded at top for easy bumping
- Falls back to wget if curl not available
- Downloads to `/tmp/` (always writable) then moves to `/usrdata/` (persistent)

- [ ] **Step 2: Commit**

```bash
git add scripts/usr/bin/qmanager_tailscale_mgr
git commit -m "$(cat <<'EOF'
feat: add qmanager_tailscale_mgr privileged helper for Tailscale install/uninstall

Downloads Tailscale ARM binary from pkgs.tailscale.com, sets up systemd
units, manages boot persistence via symlinks. Called by CGI via sudo.
Writes JSON progress for frontend polling during install.
EOF
)"
```

---

## Task 3: Update sudoers rules

Add sudo rules for the Tailscale helper script, CLI binary, and boot symlink management.

**Files:**
- Modify: `scripts/etc/sudoers.d/qmanager`

- [ ] **Step 1: Add Tailscale rules to sudoers**

Add these lines after the existing SSH password rule (line 21):

```
# Tailscale VPN management
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_tailscale_mgr
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscaled --version

# Tailscale boot persistence (symlink-based)
www-data ALL=(root) NOPASSWD: /bin/ln -sf /lib/systemd/system/tailscaled.service /lib/systemd/system/multi-user.target.wants/tailscaled.service
www-data ALL=(root) NOPASSWD: /bin/rm -f /lib/systemd/system/multi-user.target.wants/tailscaled.service
```

The full file becomes:

```
# QManager — sudoers rules for CGI scripts (lighttpd runs as www-data)
# Install location: /opt/etc/sudoers.d/qmanager (Entware) or /etc/sudoers.d/qmanager

# Service control (used by platform.sh svc_* functions)
www-data ALL=(root) NOPASSWD: /bin/systemctl start *, /bin/systemctl stop *, /bin/systemctl restart *, /bin/systemctl is-active *

# Boot persistence (symlink-based — systemctl enable doesn't work on RM520N-GL)
www-data ALL=(root) NOPASSWD: /bin/ln -sf /lib/systemd/system/qmanager*.service /lib/systemd/system/multi-user.target.wants/qmanager*.service
www-data ALL=(root) NOPASSWD: /bin/rm -f /lib/systemd/system/multi-user.target.wants/qmanager*.service

# Firewall rules (used by TTL, VPN firewall)
www-data ALL=(root) NOPASSWD: /usr/sbin/iptables, /usr/sbin/iptables-restore, /usr/sbin/ip6tables, /usr/sbin/ip6tables-restore

# System reboot (used by system/reboot.sh, update installer)
www-data ALL=(root) NOPASSWD: /sbin/reboot

# Crontab management (used by scheduled reboot, low power, auto-update)
www-data ALL=(root) NOPASSWD: /usr/bin/crontab

# SSH password management (reads password from stdin, updates /etc/shadow)
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_set_ssh_password

# Tailscale VPN management
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_tailscale_mgr
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscale
www-data ALL=(root) NOPASSWD: /usrdata/tailscale/tailscaled --version

# Tailscale boot persistence (symlink-based)
www-data ALL=(root) NOPASSWD: /bin/ln -sf /lib/systemd/system/tailscaled.service /lib/systemd/system/multi-user.target.wants/tailscaled.service
www-data ALL=(root) NOPASSWD: /bin/rm -f /lib/systemd/system/multi-user.target.wants/tailscaled.service
```

- [ ] **Step 2: Commit**

```bash
git add scripts/etc/sudoers.d/qmanager
git commit -m "$(cat <<'EOF'
feat: add sudoers rules for Tailscale VPN management

Whitelists qmanager_tailscale_mgr helper, tailscale CLI binary path,
and tailscaled.service boot symlink management for www-data CGI context.
EOF
)"
```

---

## Task 4: Rewrite `tailscale.sh` CGI endpoint for RM520N-GL

Complete rewrite replacing all OpenWRT patterns (UCI, init.d, opkg, vpn_firewall.sh) with RM520N-GL equivalents (systemd via platform.sh, sudo tailscale CLI, helper script, iptables).

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh`

- [ ] **Step 1: Rewrite the CGI script**

Replace the entire contents of `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` with:

```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
# =============================================================================
# tailscale.sh — CGI Endpoint: Tailscale VPN Management (GET + POST)
# =============================================================================
# GET:  Returns installation status, daemon state, connection info, and peers.
# POST: Connect/disconnect, start/stop daemon, enable/disable on boot,
#       install/uninstall, install_status.
#
# Tailscale binaries live at /usrdata/tailscale/ (persistent partition).
# Service control via platform.sh (systemd). Privileged operations via
# qmanager_tailscale_mgr helper (sudoers-whitelisted).
#
# CRITICAL: NEVER pass --accept-routes to tailscale up. It disconnects the
# device from the network entirely and requires a physical reboot to recover.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh
# =============================================================================

qlog_init "cgi_tailscale"
cgi_headers
cgi_handle_options

TAILSCALE_DIR="/usrdata/tailscale"
TAILSCALE_BIN="$TAILSCALE_DIR/tailscale"
TAILSCALED_BIN="$TAILSCALE_DIR/tailscaled"
AUTH_URL_FILE="/tmp/qmanager_tailscale_auth_url"
TS_UP_OUTPUT="/tmp/qmanager_tailscale_up_output"
TS_UP_PID_FILE="/tmp/qmanager_tailscale_up_pid"
INSTALL_RESULT="/tmp/qmanager_tailscale_install.json"
INSTALL_PID="/tmp/qmanager_tailscale_install.pid"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
UNIT_DIR="/lib/systemd/system"

# --- Helper: check if tailscale binaries exist --------------------------------
is_installed() {
    [ -x "$TAILSCALE_BIN" ] && [ -x "$TAILSCALED_BIN" ]
}

# --- Helper: check if tailscaled daemon is running ----------------------------
is_daemon_running() {
    svc_is_running "tailscaled"
}

# --- Helper: check if tailscale is enabled on boot ---------------------------
get_boot_enabled() {
    if [ -L "$WANTS_DIR/tailscaled.service" ]; then
        echo "true"
    else
        echo "false"
    fi
}

# --- Helper: kill stale tailscale up process from previous connect attempt ----
kill_stale_ts_up() {
    if [ -f "$TS_UP_PID_FILE" ]; then
        old_pid=$(cat "$TS_UP_PID_FILE" 2>/dev/null | tr -d ' \n\r')
        if [ -n "$old_pid" ] && pid_alive "$old_pid"; then
            kill "$old_pid" 2>/dev/null
        fi
        rm -f "$TS_UP_PID_FILE"
    fi
}

# --- Helper: get tailscale version string ------------------------------------
get_ts_version() {
    $_SUDO "$TAILSCALE_BIN" version 2>/dev/null | head -1 | awk '{print $1}'
}

# --- Helper: run tailscale CLI with sudo -------------------------------------
ts_cmd() {
    $_SUDO "$TAILSCALE_BIN" "$@"
}

# --- Helper: add iptables rules for tailscale0 interface ---------------------
ensure_firewall() {
    # Allow HTTP/HTTPS/SSH on tailscale0 (matches qmanager_setup pattern)
    for port in 80 443 22; do
        run_iptables -C INPUT -i tailscale0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
            run_iptables -A INPUT -i tailscale0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null
    done
}

# --- Helper: remove iptables rules for tailscale0 interface ------------------
remove_firewall() {
    for port in 80 443 22; do
        run_iptables -D INPUT -i tailscale0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
    done
}

# =============================================================================
# GET — Fetch installation status, daemon state, connection info, peers
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then

    # --- Tier 1: Not installed -----------------------------------------------
    if ! is_installed; then
        qlog_info "Tailscale not installed"
        jq -n '{
            success: true,
            installed: false,
            install_hint: "Install via the button above or SSH: sudo qmanager_tailscale_mgr install"
        }'
        exit 0
    fi

    ts_version=$(get_ts_version)
    boot_enabled=$(get_boot_enabled)

    # --- Tier 2: Installed but daemon not running ----------------------------
    if ! is_daemon_running; then
        qlog_info "Tailscale installed but daemon not running"
        jq -n \
            --argjson installed true \
            --argjson daemon_running false \
            --argjson enabled_on_boot "$boot_enabled" \
            --arg version "$ts_version" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                version: $version
            }'
        exit 0
    fi

    # --- Tier 3: Daemon running — fetch full status --------------------------
    qlog_info "Fetching tailscale status"

    status_json=$(ts_cmd status --json 2>/dev/null)

    if [ -z "$status_json" ] || ! printf '%s' "$status_json" | jq -e . >/dev/null 2>&1; then
        qlog_error "Failed to get tailscale status JSON"
        jq -n \
            --argjson installed true \
            --argjson daemon_running true \
            --argjson enabled_on_boot "$boot_enabled" \
            --arg version "$ts_version" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                version: $version,
                backend_state: "Unknown",
                error_detail: "Could not retrieve status from tailscale daemon"
            }'
        exit 0
    fi

    # Extract backend state
    backend_state=$(printf '%s' "$status_json" | jq -r '.BackendState // "Unknown"')

    # Extract auth URL (from status JSON or persisted file)
    auth_url=$(printf '%s' "$status_json" | jq -r '.AuthURL // ""')
    if [ -z "$auth_url" ] && [ -f "$AUTH_URL_FILE" ]; then
        auth_url=$(cat "$AUTH_URL_FILE" 2>/dev/null)
    fi
    # Clear persisted auth URL if we're now running
    if [ "$backend_state" = "Running" ] && [ -f "$AUTH_URL_FILE" ]; then
        rm -f "$AUTH_URL_FILE"
        auth_url=""
    fi

    # Build self object
    self_json=$(printf '%s' "$status_json" | jq '{
        hostname: (.Self.HostName // ""),
        dns_name: (.Self.DNSName // ""),
        tailscale_ips: [(.Self.TailscaleIPs // [])[] | tostring],
        online: (.Self.Online // false),
        os: (.Self.OS // ""),
        relay: (.Self.Relay // "")
    }' 2>/dev/null) || self_json='{}'

    # Build tailnet object
    tailnet_json=$(printf '%s' "$status_json" | jq '{
        name: (.CurrentTailnet.Name // ""),
        magic_dns_suffix: (.CurrentTailnet.MagicDNSSuffix // .MagicDNSSuffix // ""),
        magic_dns_enabled: (.CurrentTailnet.MagicDNSEnabled // false)
    }' 2>/dev/null) || tailnet_json='{}'

    # Build peers array
    peers_json=$(printf '%s' "$status_json" | jq '[
        (.Peer // {}) | to_entries[] | .value | {
            hostname: (.HostName // ""),
            dns_name: (.DNSName // ""),
            tailscale_ips: [(.TailscaleIPs // [])[] | tostring],
            os: (.OS // ""),
            online: (.Online // false),
            last_seen: (.LastSeen // ""),
            relay: (.Relay // ""),
            exit_node: (.ExitNode // false)
        }
    ]' 2>/dev/null) || peers_json='[]'

    # Extract health warnings
    health_json=$(printf '%s' "$status_json" | jq '.Health // []' 2>/dev/null) || health_json='[]'

    # Assemble full response
    jq -n \
        --argjson installed true \
        --argjson daemon_running true \
        --argjson enabled_on_boot "$boot_enabled" \
        --arg version "$ts_version" \
        --arg backend_state "$backend_state" \
        --arg auth_url "$auth_url" \
        --argjson self "$self_json" \
        --argjson tailnet "$tailnet_json" \
        --argjson peers "$peers_json" \
        --argjson health "$health_json" \
        '{
            success: true,
            installed: $installed,
            daemon_running: $daemon_running,
            enabled_on_boot: $enabled_on_boot,
            version: $version,
            backend_state: $backend_state,
            auth_url: $auth_url,
            self: $self,
            tailnet: $tailnet,
            peers: $peers,
            health: $health
        }'
    exit 0
fi

# =============================================================================
# POST — Actions
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: install — install tailscale via helper script (background)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install" ]; then

        # Check if already running
        if [ -f "$INSTALL_PID" ]; then
            inst_pid=$(cat "$INSTALL_PID" 2>/dev/null | tr -d ' \n\r')
            if [ -n "$inst_pid" ] && pid_alive "$inst_pid"; then
                cgi_error "already_running" "Installation already in progress"
                exit 0
            fi
        fi

        # Already installed?
        if is_installed; then
            cgi_error "already_installed" "Tailscale is already installed"
            exit 0
        fi

        qlog_info "Starting Tailscale installation via helper"

        # Spawn background installer — helper writes progress to INSTALL_RESULT
        ( $_SUDO /usr/bin/qmanager_tailscale_mgr install ) </dev/null >/dev/null 2>&1 &

        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: install_status — poll install progress
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_status" ]; then
        if [ -f "$INSTALL_RESULT" ]; then
            cat "$INSTALL_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi

    # All remaining POST actions require tailscale to be installed
    if ! is_installed; then
        cgi_error "not_installed" "Tailscale is not installed"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: connect — start tailscale up, capture auth URL
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "connect" ]; then
        qlog_info "Connecting to Tailscale"

        # Ensure daemon is running first
        if ! is_daemon_running; then
            svc_start "tailscaled"
            # Wait for daemon to be ready (up to 5 seconds)
            attempts=0
            while [ "$attempts" -lt 5 ]; do
                sleep 1
                if is_daemon_running; then
                    break
                fi
                attempts=$((attempts + 1))
            done
            if ! is_daemon_running; then
                cgi_error "daemon_start_failed" "Could not start tailscale daemon"
                exit 0
            fi
        fi

        # Kill any stale tailscale up process from a previous attempt
        kill_stale_ts_up

        # Clean up old temp files
        rm -f "$AUTH_URL_FILE" "$TS_UP_OUTPUT"

        # CRITICAL: NEVER use --accept-routes — it disconnects the device from
        # the network entirely and requires a physical reboot to recover.
        # Run tailscale up in background, capturing output for auth URL
        ( ts_cmd up --accept-dns=false --json > "$TS_UP_OUTPUT" 2>&1 ) &
        ts_up_pid=$!
        echo "$ts_up_pid" > "$TS_UP_PID_FILE"

        # Poll for auth URL or Running state (up to 10 seconds)
        attempts=0
        auth_url=""
        while [ "$attempts" -lt 10 ]; do
            sleep 1
            if [ -f "$TS_UP_OUTPUT" ] && [ -s "$TS_UP_OUTPUT" ]; then
                # Check if already authenticated (BackendState = Running)
                state=$(jq -r 'select(.BackendState == "Running") | .BackendState' "$TS_UP_OUTPUT" 2>/dev/null | head -1)
                if [ "$state" = "Running" ]; then
                    rm -f "$AUTH_URL_FILE" "$TS_UP_PID_FILE"
                    ensure_firewall
                    qlog_info "Tailscale already authenticated"
                    jq -n '{"success": true, "already_authenticated": true}'
                    exit 0
                fi
                # Look for auth URL in JSON stream
                auth_url=$(jq -r 'select(.AuthURL != null and .AuthURL != "") | .AuthURL' "$TS_UP_OUTPUT" 2>/dev/null | head -1)
                if [ -n "$auth_url" ]; then
                    printf '%s' "$auth_url" > "$AUTH_URL_FILE"
                    break
                fi
            fi
            attempts=$((attempts + 1))
        done

        if [ -n "$auth_url" ]; then
            qlog_info "Auth URL generated, waiting for user authentication"
            jq -n --arg auth_url "$auth_url" '{"success": true, "auth_url": $auth_url}'
        else
            qlog_error "Timed out waiting for auth URL"
            cgi_error "auth_timeout" "Timed out waiting for auth URL. Check if tailscaled is running."
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: disconnect — disconnect from tailnet (stay registered)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "disconnect" ]; then
        qlog_info "Disconnecting Tailscale"
        result=$(ts_cmd down 2>&1)
        rc=$?
        if [ "$rc" -ne 0 ]; then
            qlog_error "tailscale down failed: $result"
            cgi_error "disconnect_failed" "Failed to disconnect: $result"
            exit 0
        fi
        rm -f "$AUTH_URL_FILE"
        qlog_info "Tailscale disconnected"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: logout — full deauthentication (removes device from tailnet)
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "logout" ]; then
        qlog_info "Logging out of Tailscale"
        kill_stale_ts_up
        result=$(ts_cmd logout 2>&1)
        rc=$?
        if [ "$rc" -ne 0 ]; then
            qlog_error "tailscale logout failed: $result"
            cgi_error "logout_failed" "Failed to logout: $result"
            exit 0
        fi
        rm -f "$AUTH_URL_FILE" "$TS_UP_OUTPUT" "$TS_UP_PID_FILE"
        qlog_info "Tailscale logged out"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: start_service — start tailscaled daemon
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "start_service" ]; then
        if is_daemon_running; then
            cgi_error "already_running" "Tailscale daemon is already running"
            exit 0
        fi
        qlog_info "Starting tailscale daemon"
        svc_start "tailscaled"
        sleep 1
        if is_daemon_running; then
            ensure_firewall
            qlog_info "Tailscale daemon started"
            cgi_success
        else
            cgi_error "start_failed" "Failed to start tailscale daemon"
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: stop_service — stop tailscaled daemon
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "stop_service" ]; then
        qlog_info "Stopping tailscale daemon"
        kill_stale_ts_up
        svc_stop "tailscaled"
        rm -f "$AUTH_URL_FILE" "$TS_UP_OUTPUT" "$TS_UP_PID_FILE"
        qlog_info "Tailscale daemon stopped"
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: set_boot_enabled — enable/disable tailscale on boot
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "set_boot_enabled" ]; then
        boot_enabled=$(printf '%s' "$POST_DATA" | jq -r '.enabled | if . == null then empty else tostring end')
        if [ -z "$boot_enabled" ]; then
            cgi_error "missing_field" "enabled field is required"
            exit 0
        fi
        case "$boot_enabled" in
            true)
                $_SUDO /bin/ln -sf "$UNIT_DIR/tailscaled.service" "$WANTS_DIR/tailscaled.service"
                qlog_info "Tailscale enabled on boot"
                ;;
            false)
                $_SUDO /bin/rm -f "$WANTS_DIR/tailscaled.service"
                qlog_info "Tailscale disabled on boot"
                ;;
            *)
                cgi_error "invalid_value" "enabled must be true or false"
                exit 0
                ;;
        esac
        cgi_success
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: uninstall — remove tailscale from the device
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "uninstall" ]; then
        qlog_info "Uninstalling Tailscale"

        # Stop service if running
        if is_daemon_running; then
            qlog_info "Stopping Tailscale daemon before uninstall"
            kill_stale_ts_up
            ts_cmd down >/dev/null 2>&1
            svc_stop "tailscaled"
            sleep 1
        fi

        # Send response before removing firewall (avoids killing HTTP connection)
        cgi_success

        # Remove firewall rules and uninstall in background AFTER response
        (
            remove_firewall
            $_SUDO /usr/bin/qmanager_tailscale_mgr uninstall
        ) </dev/null >/dev/null 2>&1 &

        qlog_info "Tailscale uninstall started"
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_method_not_allowed
```

Key changes from the OpenWRT version:
- Sources `platform.sh` instead of `vpn_firewall.sh`
- Uses `svc_start/svc_stop/svc_is_running` from platform.sh for daemon control
- Uses `$_SUDO` for all tailscale CLI commands (www-data context)
- Uses `pid_alive()` instead of `kill -0` (cross-user PID checks)
- Boot detection checks symlink existence instead of UCI
- Install delegates to `qmanager_tailscale_mgr` helper
- Uninstall delegates to helper (after response sent)
- Firewall uses `run_iptables` from platform.sh (iptables, not nftables)
- Removed all NetBird/other_vpn mutual exclusion logic
- Binary paths point to `/usrdata/tailscale/` instead of system PATH

- [ ] **Step 2: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
git commit -m "$(cat <<'EOF'
feat: rewrite tailscale CGI endpoint for RM520N-GL platform

Replace OpenWRT patterns (UCI, init.d, opkg, vpn_firewall.sh) with
RM520N-GL equivalents: systemd via platform.sh, sudo tailscale CLI,
qmanager_tailscale_mgr helper for install/uninstall, iptables firewall.
Removed NetBird mutual exclusion (not ported to RM520N-GL).
EOF
)"
```

---

## Task 5: Fix `use-tailscale.ts` hook

Remove the broken `InstallResult` import from the removed `video-optimizer` types. Define the type inline (same pattern as `use-email-alerts.ts`). Remove `other_vpn` fields from the status interface.

**Files:**
- Modify: `hooks/use-tailscale.ts`

- [ ] **Step 1: Replace the InstallResult import with an inline definition**

Replace line 5:
```typescript
import type { InstallResult } from "@/types/video-optimizer";
```

With:
```typescript
interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
}
```

- [ ] **Step 2: Remove `other_vpn` fields from `TailscaleStatus` interface**

In the `TailscaleStatus` interface (around lines 50-65), remove these two fields:
```typescript
  other_vpn_installed?: boolean;
  other_vpn_name?: string;
```

The interface becomes:
```typescript
export interface TailscaleStatus {
  installed: boolean;
  daemon_running?: boolean;
  enabled_on_boot?: boolean;
  version?: string;
  backend_state?: string;
  auth_url?: string;
  self?: TailscaleSelf;
  tailnet?: TailscaleTailnet;
  peers?: TailscalePeer[];
  health?: string[];
  install_hint?: string;
  error_detail?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add hooks/use-tailscale.ts
git commit -m "$(cat <<'EOF'
fix: inline InstallResult type, remove other_vpn fields from Tailscale hook

Replace broken import from removed video-optimizer types with inline
definition (matches use-email-alerts.ts pattern). Remove NetBird mutual
exclusion fields from status interface.
EOF
)"
```

---

## Task 6: Update frontend components

Remove the NetBird mutual exclusion guard from the wrapper component and update install hint text in the connection card.

**Files:**
- Modify: `components/monitoring/tailscale/tailscale.tsx`
- Modify: `components/monitoring/tailscale/tailscale-connection-card.tsx`

- [ ] **Step 1: Simplify `tailscale.tsx` — remove mutual exclusion guard**

Replace the entire file content with:

```tsx
"use client";

import { useTailscale } from "@/hooks/use-tailscale";
import { TailscaleConnectionCard } from "./tailscale-connection-card";
import { TailscalePeersCard } from "./tailscale-peers-card";

const TailscaleComponent = () => {
  const hookData = useTailscale();

  return (
    <div className="@container/main mx-auto p-2">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Tailscale VPN</h1>
        <p className="text-muted-foreground">
          Manage your Tailscale mesh VPN connection and network peers.
        </p>
      </div>
      <div className="grid grid-cols-1 @3xl/main:grid-cols-2 grid-flow-row gap-4">
        <TailscaleConnectionCard {...hookData} />
        <TailscalePeersCard
          status={hookData.status}
          isLoading={hookData.isLoading}
          error={hookData.error}
        />
      </div>
    </div>
  );
};

export default TailscaleComponent;
```

Removed: `Card`, `CardContent`, `Empty*`, `Link`, `TriangleAlertIcon` imports and the `other_vpn_installed` guard block.

- [ ] **Step 2: Update install hint in `tailscale-connection-card.tsx`**

In the "Not Installed" section (around line 197-198), change the install command fallback:

Replace:
```typescript
    const installCmd =
      status.install_hint || "opkg update && opkg install tailscale tailscaled";
```

With:
```typescript
    const installCmd =
      status.install_hint || "sudo qmanager_tailscale_mgr install";
```

- [ ] **Step 3: Commit**

```bash
git add components/monitoring/tailscale/tailscale.tsx components/monitoring/tailscale/tailscale-connection-card.tsx
git commit -m "$(cat <<'EOF'
fix: remove NetBird mutual exclusion, update install hint for RM520N-GL

NetBird is not ported to RM520N-GL, so the mutual exclusion guard is
removed. Install hint now references the qmanager_tailscale_mgr helper
instead of opkg.
EOF
)"
```

---

## Task 7: Add route page and navigation

Create the Next.js route page and add Tailscale to the sidebar navigation.

**Files:**
- Create: `app/monitoring/tailscale/page.tsx`
- Modify: `components/app-sidebar.tsx`

- [ ] **Step 1: Create route page**

```tsx
import TailscaleComponent from "@/components/monitoring/tailscale/tailscale";

const TailscalePage = () => {
  return <TailscaleComponent />;
};

export default TailscalePage;
```

- [ ] **Step 2: Add Tailscale to sidebar navigation**

In `components/app-sidebar.tsx`, find the `monitoring` array in the `data` object (around line 203). Add a Tailscale entry. The current monitoring section:

```typescript
  monitoring: [
    {
      title: "Network Events",
      url: "/monitoring",
      icon: PieChart,
      items: [
        {
          title: "Latency Monitor",
          url: "/monitoring/latency",
        },
        // {
        \   title: "Email Alerts",
        //   url: "/monitoring/email-alerts",
        // },
      ],
    },
    {
      title: "Watchdog",
      url: "/monitoring/watchdog",
      icon: DogIcon,
    },
  ],
```

Add after the Watchdog entry:

```typescript
    {
      title: "Tailscale VPN",
      url: "/monitoring/tailscale",
      icon: GlobeIcon,
    },
```

Also add the `GlobeIcon` import to the lucide-react import block at the top of the file. Check which icons are already imported and add `GlobeIcon` if not present.

- [ ] **Step 3: Commit**

```bash
git add app/monitoring/tailscale/page.tsx components/app-sidebar.tsx
git commit -m "$(cat <<'EOF'
feat: add Tailscale VPN route and sidebar navigation entry

Route at /monitoring/tailscale. Added to Monitoring nav group with
GlobeIcon.
EOF
)"
```

---

## Task 8: Update `qmanager_setup` for Tailscale firewall rules at boot

Add iptables rules for the `tailscale0` interface during boot setup, matching the simpleadmin `simplefirewall.sh` pattern. Only applies if Tailscale is installed.

**Files:**
- Modify: `scripts/usr/bin/qmanager_setup`

- [ ] **Step 1: Add tailscale0 firewall rules**

Find the iptables section in `qmanager_setup` (around line 63-79, after the `bridge0`/`eth0` rules). Add tailscale0 rules after the existing LAN interface rules:

After the `done` that closes the `for port in 80 443 22` loop (around line 78), add:

```sh
    # VPN access — if Tailscale is installed, allow same ports on tailscale0
    if [ -x /usrdata/tailscale/tailscale ]; then
        for port in 80 443 22; do
            iptables -C INPUT -i tailscale0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
                iptables -A INPUT -i tailscale0 -p tcp --dport "$port" -j ACCEPT
        done
    fi
```

- [ ] **Step 2: Commit**

```bash
git add scripts/usr/bin/qmanager_setup
git commit -m "$(cat <<'EOF'
feat: add tailscale0 firewall rules to boot setup

Allows HTTP/HTTPS/SSH on tailscale0 interface at boot, matching the
existing bridge0/eth0 pattern. Only applies if Tailscale binary exists.
EOF
)"
```

---

## Task 9: Update installer to deploy Tailscale files

Add deployment of the helper script, systemd units, and VPN CGI directory to the installer.

**Files:**
- Modify: `scripts/install_rm520n.sh`

- [ ] **Step 1: Read the current installer to find the right insertion points**

Look for the sections that handle:
1. Copying scripts to `/usr/bin/` — add `qmanager_tailscale_mgr`
2. Copying systemd units — add `tailscaled.service` and `tailscaled.defaults`
3. Copying CGI scripts — ensure `vpn/` directory is included
4. Sudoers deployment — already handled generically

- [ ] **Step 2: Add helper script deployment**

In the section that copies `/usr/bin/` scripts, add:

```sh
# Tailscale management helper
if [ -f "$SRC_SCRIPTS/usr/bin/qmanager_tailscale_mgr" ]; then
    cp "$SRC_SCRIPTS/usr/bin/qmanager_tailscale_mgr" /usr/bin/qmanager_tailscale_mgr
    sed -i 's/\r$//' /usr/bin/qmanager_tailscale_mgr
    chmod 755 /usr/bin/qmanager_tailscale_mgr
fi
```

- [ ] **Step 3: Add Tailscale systemd unit staging**

In the systemd section, after existing unit deployment, add:

```sh
# Stage Tailscale systemd units to /usr/lib/qmanager/ for the helper to find
for f in tailscaled.service tailscaled.defaults; do
    src="$SRC_SCRIPTS/etc/systemd/system/$f"
    if [ -f "$src" ]; then
        cp "$src" "$LIB_DIR/$f"
        sed -i 's/\r$//' "$LIB_DIR/$f"
    fi
done
```

Note: The helper copies these from `/usr/lib/qmanager/` to `/lib/systemd/system/` and `/usrdata/tailscale/systemd/` during install. They are NOT installed as active systemd units during QManager install — only when the user clicks "Install Tailscale" in the UI.

- [ ] **Step 4: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "$(cat <<'EOF'
feat: deploy Tailscale helper and systemd units in installer

Copies qmanager_tailscale_mgr to /usr/bin/ and stages tailscaled
systemd units in /usr/lib/qmanager/ for the helper to use during
Tailscale installation.
EOF
)"
```

---

## Task 10: Update CLAUDE.md — remove Tailscale from deferred features

Since Tailscale is now being ported, remove it from the "Removed/Deferred Features" table.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove VPN Management row from deferred features table**

In the "Removed/Deferred Features" table, remove the row:

```
| VPN Management (Tailscale + NetBird) | Third-party binaries, fw4/mwan3 dependencies | CGI, hooks, components, vpn_firewall.sh |
```

Replace with a narrower row that only lists what's still deferred:

```
| VPN Management (NetBird only) | Third-party binary, fw4/mwan3 dependencies | CGI, hooks, components for NetBird |
```

- [ ] **Step 2: Add a note about Tailscale in the RM520N-GL section**

In the "QManager Independence" section, after the "Installer internet resilience" bullet, add:

```
- **Tailscale VPN:** Installed on-demand via `qmanager_tailscale_mgr` helper — downloads ARM binary from `pkgs.tailscale.com`, stores at `/usrdata/tailscale/`. Service controlled via `tailscaled.service`. Boot persistence via symlink into `multi-user.target.wants/`. Firewall adds iptables rules for `tailscale0` interface. No dependency on SimpleAdmin.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md — Tailscale ported, NetBird still deferred
EOF
)"
```

---

## Implementation Notes

### Security Considerations
- Tailscale CLI is whitelisted in sudoers with the full path `/usrdata/tailscale/tailscale` — only exists after user-initiated install
- The helper script validates its single argument against a fixed `case` dispatch — no arbitrary command injection
- `--accept-routes` is NEVER passed to `tailscale up` (causes network disconnect + hard reboot)
- `--accept-dns=false` prevents Tailscale from overriding the device's DNS config

### Upgrade Compatibility
- Binary and state in `/usrdata/tailscale/` matches simpleadmin layout — users migrating from SimpleAdmin keep their Tailscale auth
- Systemd unit is compatible with simpleadmin's `tailscaled.service`
- `tailscale update` CLI works for subsequent version bumps after initial install

### What's NOT included in this plan
- **NetBird VPN** — remains deferred (fw4/mwan3 dependencies)
- **Tailscale SSH toggle** — simpleadmin offers `--ssh` flag; could be added later as a settings toggle
- **Tailscale Web UI** — simpleadmin runs `tailscale web` on port 8088; intentionally excluded since QManager provides its own UI
- **Exit node configuration** — display-only for now; could add toggle in future
- **Tailscale update management** — initial version is hardcoded; `tailscale update` CLI available for manual updates
