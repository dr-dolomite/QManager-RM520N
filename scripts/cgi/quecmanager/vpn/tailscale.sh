#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# tailscale.sh — CGI Endpoint: Tailscale VPN Management (GET + POST)
# =============================================================================
# GET:  Returns installation status, daemon state, connection info, and peers.
# POST: Connect/disconnect, start/stop daemon, enable/disable on boot, logout.
#
# Tailscale manages its own config in /var/lib/tailscale/ — we are a thin
# control layer, not a service owner. No UCI config needed.
#
# Data sources:
#   tailscale status --json   -> connection state, self info, peers, DNS
#   tailscale version         -> installed version
#   /etc/init.d/tailscale     -> daemon control (start/stop/enable/disable)
#
# POST body: { "action": "connect"|"disconnect"|"logout"|"start_service"|
#                         "stop_service"|"set_boot_enabled" }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh
# Install location: /www/cgi-bin/quecmanager/vpn/tailscale.sh
# =============================================================================

qlog_init "cgi_tailscale"
cgi_headers
cgi_handle_options

AUTH_URL_FILE="/tmp/qmanager_tailscale_auth_url"
TS_UP_OUTPUT="/tmp/qmanager_tailscale_up_output"
TS_UP_PID_FILE="/tmp/qmanager_tailscale_up_pid"

# --- Helper: check if tailscale + tailscaled are installed -------------------
is_installed() {
    command -v tailscale >/dev/null 2>&1 && command -v tailscaled >/dev/null 2>&1
}

# --- Helper: check if tailscaled daemon is running ---------------------------
is_daemon_running() {
    if [ -x /etc/init.d/tailscale ]; then
        /etc/init.d/tailscale running >/dev/null 2>&1
    else
        pidof tailscaled >/dev/null 2>&1
    fi
}

# --- Helper: check if tailscale is enabled on boot --------------------------
get_boot_enabled() {
    if [ -x /etc/init.d/tailscale ]; then
        /etc/init.d/tailscale enabled && echo "true" || echo "false"
    else
        echo "false"
    fi
}

# --- Helper: kill stale tailscale up process from previous connect attempt ---
kill_stale_ts_up() {
    if [ -f "$TS_UP_PID_FILE" ]; then
        old_pid=$(cat "$TS_UP_PID_FILE" 2>/dev/null | tr -d ' \n\r')
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null
        fi
        rm -f "$TS_UP_PID_FILE"
    fi
}

# --- Helper: get tailscale version string ------------------------------------
get_ts_version() {
    tailscale version 2>/dev/null | head -1 | awk '{print $1}'
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
            install_hint: "opkg update && opkg install luci-app-tailscale"
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

    # Use timeout if available to prevent hangs
    if command -v timeout >/dev/null 2>&1; then
        status_json=$(timeout 5 tailscale status --json 2>/dev/null)
    else
        status_json=$(tailscale status --json 2>/dev/null)
    fi

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

    # Build self object from .Self
    self_json=$(printf '%s' "$status_json" | jq '{
        hostname: (.Self.HostName // ""),
        dns_name: (.Self.DNSName // ""),
        tailscale_ips: [(.Self.TailscaleIPs // [])[] | tostring],
        online: (.Self.Online // false),
        os: (.Self.OS // ""),
        relay: (.Self.Relay // "")
    }' 2>/dev/null) || self_json='{}'

    # Build tailnet object from .CurrentTailnet
    tailnet_json=$(printf '%s' "$status_json" | jq '{
        name: (.CurrentTailnet.Name // ""),
        magic_dns_suffix: (.CurrentTailnet.MagicDNSSuffix // .MagicDNSSuffix // ""),
        magic_dns_enabled: (.CurrentTailnet.MagicDNSEnabled // false)
    }' 2>/dev/null) || tailnet_json='{}'

    # Build peers array from .Peer (map keyed by public key)
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
# POST — Actions: connect, disconnect, logout, start/stop service, boot toggle
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # All POST actions require tailscale to be installed
    if ! is_installed; then
        cgi_error "not_installed" "Tailscale is not installed. Install via: opkg update && opkg install luci-app-tailscale"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: connect — start tailscale up, capture auth URL
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "connect" ]; then
        qlog_info "Connecting to Tailscale"

        # Ensure daemon is running first
        if ! is_daemon_running; then
            if [ -x /etc/init.d/tailscale ]; then
                /etc/init.d/tailscale start >/dev/null 2>&1
            else
                tailscaled --state=/var/lib/tailscale/tailscaled.state >/dev/null 2>&1 &
            fi
            # Wait for daemon to be ready (up to 5 seconds)
            attempts=0
            while [ "$attempts" -lt 5 ]; do
                sleep 1
                is_daemon_running && break
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

        # Run tailscale up in background, capturing JSON output
        ( tailscale up --accept-routes --json > "$TS_UP_OUTPUT" 2>&1 ) &
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
        result=$(tailscale down 2>&1)
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
        result=$(tailscale logout 2>&1)
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
        if [ -x /etc/init.d/tailscale ]; then
            /etc/init.d/tailscale start >/dev/null 2>&1
        else
            tailscaled --state=/var/lib/tailscale/tailscaled.state >/dev/null 2>&1 &
        fi
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
        if [ -x /etc/init.d/tailscale ]; then
            /etc/init.d/tailscale stop >/dev/null 2>&1
        else
            killall tailscaled 2>/dev/null
        fi
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
        if [ ! -x /etc/init.d/tailscale ]; then
            cgi_error "no_init_script" "Tailscale init script not found"
            exit 0
        fi
        case "$boot_enabled" in
            true)
                /etc/init.d/tailscale enable >/dev/null 2>&1
                qlog_info "Tailscale enabled on boot"
                ;;
            false)
                /etc/init.d/tailscale disable >/dev/null 2>&1
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

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_method_not_allowed
