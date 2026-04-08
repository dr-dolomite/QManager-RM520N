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

        # Uninstall in background AFTER response, then restart firewall to drop tailscale0
        (
            $_SUDO /usr/bin/qmanager_tailscale_mgr uninstall
            svc_restart "qmanager-firewall"
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
