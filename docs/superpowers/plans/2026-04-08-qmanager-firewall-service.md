# QManager Firewall Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a QManager-owned firewall service that restricts web UI access to trusted interfaces (replicating rgmii-toolkit's SimpleFirewall behavior), and remove ad-hoc iptables code from the Tailscale CGI and qmanager_setup.

**Architecture:** A dedicated `qmanager-firewall` systemd oneshot service runs at boot, applying iptables rules that ACCEPT ports 80/443 on trusted interfaces (bridge0, eth0, lo, and tailscale0 if installed) then DROP those ports on everything else. This replaces the scattered iptables rules currently in `qmanager_setup` and the Tailscale-specific firewall helpers in the CGI. The Tailscale CGI restarts this service after install/uninstall so the firewall dynamically picks up the tailscale0 interface.

**Tech Stack:** POSIX shell, iptables, systemd (Type=oneshot, RemainAfterExit=yes)

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `scripts/usr/bin/qmanager_firewall` | Firewall script — start/stop/restart iptables rules for port protection |
| `scripts/etc/systemd/system/qmanager-firewall.service` | Systemd unit — runs at boot before other QManager services |

### Modified Files

| File | Changes |
|------|---------|
| `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` | Remove `ensure_firewall()` / `remove_firewall()` functions and all calls; add `svc_restart "qmanager-firewall"` after install/uninstall |
| `scripts/usr/bin/qmanager_setup` | Remove entire iptables section (lines 63-87) — now handled by firewall service |
| `scripts/install_rm520n.sh` | Add `qmanager-firewall` to always-on service enable list |
| `scripts/uninstall_rm520n.sh` | Stop firewall service and flush its rules during uninstall |
| `CLAUDE.md` | Document the firewall service |

---

## Task 1: Create `qmanager-firewall` script

The core firewall script that applies/removes iptables rules. Follows the rgmii-toolkit SimpleFirewall pattern exactly: ACCEPT on trusted interfaces, DROP on everything else, for web UI ports only.

**Files:**
- Create: `scripts/usr/bin/qmanager_firewall`

- [ ] **Step 1: Create the firewall script**

```sh
#!/bin/sh
# qmanager_firewall — Port firewall for QManager web UI
# Restricts HTTP/HTTPS access to trusted interfaces only.
# Replaces SimpleAdmin's simplefirewall as a QManager-managed service.
#
# Usage: qmanager_firewall {start|stop|restart}
#
# Protected ports: 80 (HTTP), 443 (HTTPS)
# Trusted interfaces: lo, bridge0, eth0, tailscale0 (if installed)
# SSH (22) is intentionally NOT blocked — emergency access must remain open.
#
# Service: qmanager-firewall.service (Type=oneshot, RemainAfterExit=yes)

# Protected ports — web UI only
PORTS="80 443"

# Trusted interfaces — always allowed
TRUSTED="lo bridge0 eth0"

# Dynamic trust — add tailscale0 if Tailscale is installed
if [ -x /usrdata/tailscale/tailscale ]; then
    TRUSTED="$TRUSTED tailscale0"
fi

do_start() {
    # Allow protected ports on trusted interfaces
    for iface in $TRUSTED; do
        for port in $PORTS; do
            iptables -C INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
                iptables -A INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT
        done
    done

    # Block protected ports on all other interfaces (cellular, etc.)
    for port in $PORTS; do
        iptables -C INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || \
            iptables -A INPUT -p tcp --dport "$port" -j DROP
    done
}

do_stop() {
    # Remove DROP rules
    for port in $PORTS; do
        iptables -D INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || true
    done

    # Remove ACCEPT rules
    for iface in $TRUSTED; do
        for port in $PORTS; do
            iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
        done
    done
}

case "${1:-}" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart)
        do_stop
        do_start
        ;;
    *)
        echo "Usage: qmanager_firewall {start|stop|restart}" >&2
        exit 1
        ;;
esac
```

Key design decisions:
- **Only ports 80/443 are protected** — matches SimpleFirewall exactly. SSH (22) is left open as emergency access.
- **Loopback included** — CGI scripts need localhost access to lighttpd for internal requests.
- **tailscale0 detection is dynamic** — checks for binary at script execution time. On restart, re-evaluates.
- **Idempotent** — uses `iptables -C` (check) before `-A` (append) to avoid duplicate rules.
- **stop cleans up** — removes all rules this script created.

- [ ] **Step 2: Commit**

```bash
git add scripts/usr/bin/qmanager_firewall
git commit -m "$(cat <<'EOF'
feat: add qmanager_firewall port protection script

Restricts web UI (ports 80/443) to trusted interfaces: lo, bridge0,
eth0, and tailscale0 (if installed). Blocks cellular-side access.
Replaces SimpleAdmin's simplefirewall as a QManager-managed service.
SSH (22) intentionally left open for emergency access.
EOF
)"
```

---

## Task 2: Create `qmanager-firewall.service` systemd unit

Systemd oneshot service that runs the firewall script at boot, before other QManager services.

**Files:**
- Create: `scripts/etc/systemd/system/qmanager-firewall.service`

- [ ] **Step 1: Create the systemd unit**

```ini
# /lib/systemd/system/qmanager-firewall.service
[Unit]
Description=QManager Port Firewall
Before=qmanager-setup.service lighttpd.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/qmanager_firewall start
ExecStop=/usr/bin/qmanager_firewall stop

[Install]
WantedBy=multi-user.target
```

Key decisions:
- **Before=qmanager-setup.service lighttpd.service** — firewall rules are in place before the web server starts accepting connections.
- **RemainAfterExit=yes** — systemd considers the service "active" after the oneshot completes, enabling `systemctl restart` for re-evaluation.
- **ExecStop** — cleans up rules when service is stopped (e.g., during uninstall).

- [ ] **Step 2: Commit**

```bash
git add scripts/etc/systemd/system/qmanager-firewall.service
git commit -m "$(cat <<'EOF'
feat: add qmanager-firewall systemd service unit

Type=oneshot with RemainAfterExit. Runs before qmanager-setup and
lighttpd to ensure firewall rules are active before the web server
accepts connections.
EOF
)"
```

---

## Task 3: Remove iptables section from `qmanager_setup`

The ad-hoc iptables rules in `qmanager_setup` are now handled by the dedicated firewall service. Remove the entire section.

**Files:**
- Modify: `scripts/usr/bin/qmanager_setup`

- [ ] **Step 1: Remove lines 63-87 (the entire iptables block)**

Remove this entire block:

```sh
# iptables rules — allow access to web UI and SSH
# Default RM520N-GL firewall drops non-bridge/eth traffic; replaces simplefirewall
if command -v iptables >/dev/null 2>&1; then
    # Loopback — CGI scripts need localhost access to lighttpd
    iptables -C INPUT -i lo -p tcp --dport 80 -j ACCEPT 2>/dev/null || \
        iptables -I INPUT 1 -i lo -p tcp --dport 80 -j ACCEPT
    iptables -C INPUT -i lo -p tcp --dport 443 -j ACCEPT 2>/dev/null || \
        iptables -I INPUT 1 -i lo -p tcp --dport 443 -j ACCEPT

    # External access — HTTP, HTTPS, SSH on LAN interfaces (bridge0, eth0)
    for port in 80 443 22; do
        iptables -C INPUT -i bridge0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
            iptables -A INPUT -i bridge0 -p tcp --dport "$port" -j ACCEPT
        iptables -C INPUT -i eth0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
            iptables -A INPUT -i eth0 -p tcp --dport "$port" -j ACCEPT
    done

    # VPN access — if Tailscale is installed, allow same ports on tailscale0
    if [ -x /usrdata/tailscale/tailscale ]; then
        for port in 80 443 22; do
            iptables -C INPUT -i tailscale0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || \
                iptables -A INPUT -i tailscale0 -p tcp --dport "$port" -j ACCEPT
        done
    fi
fi
```

The line after removal should go directly from:
```sh
[ -f /etc/qmanager/auth.json ] && chmod 600 /etc/qmanager/auth.json
```
to:
```sh
# Create default long_commands.list if missing
```

- [ ] **Step 2: Commit**

```bash
git add scripts/usr/bin/qmanager_setup
git commit -m "$(cat <<'EOF'
refactor: remove ad-hoc iptables rules from qmanager_setup

Port firewall is now handled by the dedicated qmanager-firewall service
which runs before qmanager-setup at boot. Removes loopback, bridge0,
eth0, and tailscale0 iptables rules that were previously managed here.
EOF
)"
```

---

## Task 4: Remove firewall helpers from Tailscale CGI

Strip `ensure_firewall()` / `remove_firewall()` and their call sites. Replace with `svc_restart "qmanager-firewall"` after install/uninstall so the firewall service re-evaluates trusted interfaces.

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh`

- [ ] **Step 1: Remove the two firewall helper functions (lines 75-89)**

Remove this entire block:

```sh
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
```

- [ ] **Step 2: Remove `ensure_firewall` call from connect action (line 337)**

In the connect action's "already authenticated" branch, remove the `ensure_firewall` call:

Replace:
```sh
                    rm -f "$AUTH_URL_FILE" "$TS_UP_PID_FILE"
                    ensure_firewall
                    qlog_info "Tailscale already authenticated"
```

With:
```sh
                    rm -f "$AUTH_URL_FILE" "$TS_UP_PID_FILE"
                    qlog_info "Tailscale already authenticated"
```

- [ ] **Step 3: Remove `ensure_firewall` call from start_service action (line 411)**

Replace:
```sh
        if is_daemon_running; then
            ensure_firewall
            qlog_info "Tailscale daemon started"
```

With:
```sh
        if is_daemon_running; then
            qlog_info "Tailscale daemon started"
```

- [ ] **Step 4: Replace `remove_firewall` in uninstall with firewall restart (lines 478-482)**

Replace:
```sh
        # Remove firewall rules and uninstall in background AFTER response
        (
            remove_firewall
            $_SUDO /usr/bin/qmanager_tailscale_mgr uninstall
        ) </dev/null >/dev/null 2>&1 &
```

With:
```sh
        # Uninstall in background AFTER response, then restart firewall to drop tailscale0
        (
            $_SUDO /usr/bin/qmanager_tailscale_mgr uninstall
            svc_restart "qmanager-firewall"
        ) </dev/null >/dev/null 2>&1 &
```

- [ ] **Step 5: Add firewall restart after install completes**

In `scripts/usr/bin/qmanager_tailscale_mgr`, at the end of `do_install()`, after the verify step but before the `mount -o remount,ro`, add a firewall restart so tailscale0 gets trusted immediately:

Find the verify block at the end of `do_install()`:
```sh
    # Verify
    sleep 1
    if [ -f "$TAILSCALE_DIR/tailscale" ] && [ -f "$TAILSCALE_DIR/tailscaled" ]; then
        write_progress '{"success":true,"status":"complete","message":"Tailscale v'"$TAILSCALE_VERSION"' installed successfully"}'
    else
        write_progress '{"success":false,"status":"error","message":"Install completed but binaries not found"}'
    fi

    mount -o remount,ro / 2>/dev/null || true
```

Replace with:
```sh
    # Verify
    sleep 1
    if [ -f "$TAILSCALE_DIR/tailscale" ] && [ -f "$TAILSCALE_DIR/tailscaled" ]; then
        # Restart firewall so tailscale0 becomes a trusted interface
        /bin/systemctl restart qmanager-firewall 2>/dev/null || true
        write_progress '{"success":true,"status":"complete","message":"Tailscale v'"$TAILSCALE_VERSION"' installed successfully"}'
    else
        write_progress '{"success":false,"status":"error","message":"Install completed but binaries not found"}'
    fi

    mount -o remount,ro / 2>/dev/null || true
```

Note: The helper runs as root (via sudo), so it can call systemctl directly without `$_SUDO`.

- [ ] **Step 6: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh scripts/usr/bin/qmanager_tailscale_mgr
git commit -m "$(cat <<'EOF'
refactor: remove Tailscale-specific firewall code, use firewall service

Remove ensure_firewall/remove_firewall helpers and all call sites from
the Tailscale CGI. Firewall is now managed by the qmanager-firewall
service. Helper restarts the service after install so tailscale0 is
immediately trusted. Uninstall background task restarts firewall to
drop tailscale0.
EOF
)"
```

---

## Task 5: Update installer to enable firewall service

Add `qmanager-firewall` to the always-on service list and ensure it starts during install.

**Files:**
- Modify: `scripts/install_rm520n.sh`

- [ ] **Step 1: Add `qmanager-firewall` to the always-on services list**

Find the service enable loop (around line 749):
```sh
    for svc in qmanager-setup qmanager-ping qmanager-poller qmanager-ttl \
               qmanager-mtu qmanager-imei-check; do
```

Add `qmanager-firewall` at the beginning (it should be enabled first since other services depend on it):
```sh
    for svc in qmanager-firewall qmanager-setup qmanager-ping qmanager-poller qmanager-ttl \
               qmanager-mtu qmanager-imei-check; do
```

- [ ] **Step 2: Add firewall start to the service startup section**

Find the section that starts services after install (around line 810):
```sh
    # Run setup oneshot first (creates lock files, session dirs, iptables rules)
    systemctl start qmanager-setup 2>/dev/null || true
```

Add the firewall start BEFORE qmanager-setup:
```sh
    # Start firewall first (protects web UI before lighttpd accepts connections)
    systemctl start qmanager-firewall 2>/dev/null || true

    # Run setup oneshot (creates lock files, session dirs, permissions)
    systemctl start qmanager-setup 2>/dev/null || true
```

Also update the comment on qmanager-setup since it no longer manages iptables rules.

- [ ] **Step 3: Add firewall to the critical service verification list**

Find the verification loop (around line 821):
```sh
    for svc in lighttpd qmanager-setup qmanager-ping qmanager-poller; do
```

Add `qmanager-firewall`:
```sh
    for svc in qmanager-firewall lighttpd qmanager-setup qmanager-ping qmanager-poller; do
```

- [ ] **Step 4: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "$(cat <<'EOF'
feat: enable qmanager-firewall service in installer

Added to always-on service list, starts before qmanager-setup during
install, and included in critical service verification checks.
EOF
)"
```

---

## Task 6: Update uninstaller to clean up firewall

Stop the firewall service and remove its rules during QManager uninstall. Replace the ad-hoc iptables cleanup with a service stop.

**Files:**
- Modify: `scripts/uninstall_rm520n.sh`

- [ ] **Step 1: Replace the ad-hoc iptables cleanup**

Find the existing firewall cleanup section (around lines 126-135):
```sh
# --- Remove firewall rules ---
rm -f /etc/firewall.user.ttl /etc/firewall.user.mtu 2>/dev/null || true
if command -v iptables >/dev/null 2>&1; then
    iptables -D INPUT -i lo -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -i lo -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
    for port in 80 443 22; do
        iptables -D INPUT -i bridge0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
        iptables -D INPUT -i eth0 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
    done
fi
```

Replace with:
```sh
# --- Remove firewall rules ---
rm -f /etc/firewall.user.ttl /etc/firewall.user.mtu 2>/dev/null || true
# Stop the firewall service — this runs ExecStop which removes all iptables rules
systemctl stop qmanager-firewall 2>/dev/null || true
# Fallback: manually clean up if the service didn't exist or failed
if command -v iptables >/dev/null 2>&1; then
    for port in 80 443; do
        iptables -D INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || true
        for iface in lo bridge0 eth0 tailscale0; do
            iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
        done
    done
fi
```

- [ ] **Step 2: Commit**

```bash
git add scripts/uninstall_rm520n.sh
git commit -m "$(cat <<'EOF'
refactor: update uninstaller to use qmanager-firewall service stop

Stops the firewall service (which runs ExecStop to clean up rules)
with a manual fallback. Cleanup now covers ports 80/443 + DROP rules
matching the new firewall service pattern.
EOF
)"
```

---

## Task 7: Update CLAUDE.md

Document the new firewall service and update the setup description.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add firewall service documentation to QManager Independence section**

Find the Tailscale VPN bullet in the QManager Independence section and add a new bullet BEFORE it:

```
- **Port firewall:** `qmanager-firewall.service` restricts web UI (ports 80/443) to trusted interfaces (lo, bridge0, eth0, tailscale0 if installed). Blocks cellular-side access. Replaces SimpleAdmin's `simplefirewall` — QManager-owned, installed by default. SSH (22) intentionally left open for emergency access.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document qmanager-firewall service in CLAUDE.md
EOF
)"
```

---

## Implementation Notes

### What changed from SimpleFirewall

| Aspect | SimpleFirewall (rgmii-toolkit) | QManager Firewall |
|--------|-------------------------------|-------------------|
| Location | `/usrdata/simplefirewall/simplefirewall.sh` | `/usr/bin/qmanager_firewall` |
| Service | `simplefirewall.service` | `qmanager-firewall.service` |
| Protected ports | 80, 443 (configurable) | 80, 443 (fixed) |
| Trusted interfaces | bridge0, eth0, tailscale0 | lo, bridge0, eth0, tailscale0 (if installed) |
| SSH | Not mentioned | Intentionally NOT blocked |
| Boot order | No ordering | Before qmanager-setup, lighttpd |
| Management | Manual (toolkit menu) | Auto (installer enables, Tailscale restarts) |

### Key behavior

- The firewall runs at boot BEFORE lighttpd starts — no window of exposure.
- When Tailscale is installed/uninstalled, the service is restarted to re-evaluate trusted interfaces.
- The DROP rules only affect ports 80/443 — all other traffic (including SSH on 22, DNS, NTP, etc.) is unaffected.
- iptables rules for non-existent interfaces (e.g., tailscale0 before Tailscale starts) are valid — they activate when the interface comes up.
