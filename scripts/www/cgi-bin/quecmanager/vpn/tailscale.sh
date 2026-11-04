#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
. /usr/lib/qmanager/system_validate.sh
# =============================================================================
# tailscale.sh — CGI Endpoint: Tailscale VPN Management (GET + POST)
# =============================================================================
# GET:  Returns installation status, daemon state, connection info, and peers.
# POST: Connect/disconnect, start/stop daemon, enable/disable on boot,
#       install/uninstall, install_status, check_update, update.
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
INSTALL_LOG="/tmp/qmanager_tailscale_install.log"
WANTS_DIR="/lib/systemd/system/multi-user.target.wants"
UNIT_DIR="/lib/systemd/system"
SSH_PREF_FILE="/etc/qmanager/tailscale_ssh"

# --- Helper: check if tailscale binaries exist --------------------------------
is_installed() {
    # Check systemd unit (world-readable) + data dir existence (works on 700 dirs)
    # Avoids traversing /usrdata/tailscale/ which tailscaled resets to 700
    [ -f /lib/systemd/system/tailscaled.service ] && [ -d "$TAILSCALE_DIR" ]
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

# --- Helper: read persisted SSH intent flag (true/false) ---------------------
# Defaults to "false" if the file is missing, unreadable, or contains anything
# other than "1". This is the QManager-owned source of truth for whether
# `tailscale up` should be invoked with `--ssh`.
get_ssh_pref() {
    qm_ts_ssh_pref
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

# --- Update check: newest stable build, cached ("<epoch> <version>", 6 h); GET
# never waits on the network.
LATEST_CACHE="/tmp/qmanager_tailscale_latest"
LATEST_URL="https://pkgs.tailscale.com/stable/?mode=json"

ts_latest_read() {
    [ -f "$LATEST_CACHE" ] && awk 'NR==1 {print $2}' "$LATEST_CACHE" 2>/dev/null
}

ts_latest_due() {
    [ -f "$LATEST_CACHE" ] || return 0
    _at=$(awk 'NR==1 {print $1}' "$LATEST_CACHE" 2>/dev/null)
    case "$_at" in ''|*[!0-9]*) return 0 ;; esac
    _now=$(date +%s)
    [ "$_now" -lt "$_at" ] && return 0
    [ $((_now - _at)) -gt 21600 ]
}

ts_latest_refresh() {
    _body=$(curl -fsS -m 10 "$LATEST_URL" 2>/dev/null) || return 1
    _ver=$(printf '%s' "$_body" | jq -r '.TarballsVersion // .Version // empty' 2>/dev/null)
    case "$_ver" in ''|*[!0-9.]*) return 1 ;; esac
    printf '%s %s\n' "$(date +%s)" "$_ver" > "$LATEST_CACHE"
}

# True when $1 is a newer dotted version than $2 (device jq has no regex).
ts_version_gt() {
    jq -n -e --arg a "$1" --arg b "$2" \
        '($a | split(".") | map(tonumber? // 0)) > ($b | split(".") | map(tonumber? // 0))' \
        >/dev/null 2>&1
}

# True while an install or update holds the lock.
ts_job_running() {
    [ -f "$INSTALL_PID" ] || return 1
    _jp=$(tr -d ' \n\r' < "$INSTALL_PID" 2>/dev/null)
    [ -n "$_jp" ] && pid_alive "$_jp"
}

# The daemon restarts under an update, so GET reports busy instead of "stopped".
ts_update_busy() {
    ts_job_running || return 1
    [ "$(jq -r '.op // empty' "$INSTALL_RESULT" 2>/dev/null)" = "update" ]
}

# Sets latest_version / update_available for the GET tiers (cache only).
ts_update_facts() {
    latest_version=$(ts_latest_read)
    update_available="false"
    if [ -n "$latest_version" ] && [ -n "$1" ] && ts_version_gt "$latest_version" "$1"; then
        update_available="true"
    fi
}



# =============================================================================
# GET — Fetch installation status, daemon state, connection info, peers
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then

    if ts_update_busy; then
        jq -n '{ success: true, installed: true, busy: "update" }'
        exit 0
    fi

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
    ts_update_facts "$ts_version"

    # --- Tier 2: Installed but daemon not running ----------------------------
    if ! is_daemon_running; then
        qlog_info "Tailscale installed but daemon not running"
        ssh_enabled=$(get_ssh_pref)
        jq -n \
            --argjson installed true \
            --argjson daemon_running false \
            --argjson enabled_on_boot "$boot_enabled" \
            --argjson ssh_enabled "$ssh_enabled" \
            --arg version "$ts_version" \
            --arg latest_version "$latest_version" \
            --argjson update_available "$update_available" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                ssh_enabled: $ssh_enabled,
                version: $version,
                latest_version: $latest_version,
                update_available: $update_available
            }'
        exit 0
    fi

    # --- Tier 3: Daemon running — fetch full status --------------------------
    qlog_info "Fetching tailscale status"

    status_json=$(ts_cmd status --json 2>/dev/null)

    if [ -z "$status_json" ] || ! printf '%s' "$status_json" | jq -e . >/dev/null 2>&1; then
        qlog_error "Failed to get tailscale status JSON"
        ssh_enabled=$(get_ssh_pref)
        jq -n \
            --argjson installed true \
            --argjson daemon_running true \
            --argjson enabled_on_boot "$boot_enabled" \
            --argjson ssh_enabled "$ssh_enabled" \
            --arg version "$ts_version" \
            --arg latest_version "$latest_version" \
            --argjson update_available "$update_available" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                ssh_enabled: $ssh_enabled,
                version: $version,
                latest_version: $latest_version,
                update_available: $update_available,
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
    ssh_enabled=$(get_ssh_pref)
    jq -n \
        --argjson installed true \
        --argjson daemon_running true \
        --argjson enabled_on_boot "$boot_enabled" \
        --argjson ssh_enabled "$ssh_enabled" \
        --arg version "$ts_version" \
        --arg latest_version "$latest_version" \
        --argjson update_available "$update_available" \
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
            ssh_enabled: $ssh_enabled,
            version: $version,
            latest_version: $latest_version,
            update_available: $update_available,
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
    # action: install_status — poll install progress + live log tail
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "install_status" ]; then
        if [ -f "$INSTALL_RESULT" ]; then
            status_json=$(cat "$INSTALL_RESULT")
        else
            status_json='{"success":true,"status":"idle"}'
        fi

        # Guard against transient parse failures from a half-written status file.
        # Without this, jq would emit an empty body and the frontend poller breaks.
        if ! printf '%s' "$status_json" | jq -e . >/dev/null 2>&1; then
            status_json='{"success":true,"status":"running","message":"Installing..."}'
        fi

        # Translate CR→LF so curl's \r-separated progress updates each land
        # on their own line, then tail after the translation — otherwise a
        # whole download's worth of progress bar collapses into one huge line.
        if [ -f "$INSTALL_LOG" ]; then
            log_tail=$(tr '\r' '\n' < "$INSTALL_LOG" 2>/dev/null | tr -d '\000' | tail -n 50)
        else
            log_tail=""
        fi

        printf '%s' "$status_json" | jq --arg log "$log_tail" '. + {log: $log}'
        exit 0
    fi

    # All remaining POST actions require tailscale to be installed
    if ! is_installed; then
        cgi_error "not_installed" "Tailscale is not installed"
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: check_update — newest stable version (cached 6 h); force:true
    # always asks pkgs.tailscale.com. Needs no root beyond `tailscale version`.
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "check_update" ]; then
        cu_force=$(printf '%s' "$POST_DATA" | jq -r 'if .force == true then "1" else "0" end' 2>/dev/null)
        cu_installed=$(get_ts_version)
        if [ "$cu_force" = "1" ] || ts_latest_due; then
            if ! ts_latest_refresh; then
                cgi_error "update_check_failed" "Could not check for Tailscale updates"
                exit 0
            fi
        fi
        cu_latest=$(ts_latest_read)
        if [ -z "$cu_latest" ]; then
            cgi_error "update_check_failed" "Could not check for Tailscale updates"
            exit 0
        fi
        cu_available="false"
        if [ -n "$cu_installed" ] && ts_version_gt "$cu_latest" "$cu_installed"; then
            cu_available="true"
        fi
        jq -n \
            --arg latest_version "$cu_latest" \
            --argjson update_available "$cu_available" \
            '{ success: true, latest_version: $latest_version, update_available: $update_available }'
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: update — `tailscale update` through the root helper, in the
    # background; progress is read through install_status (op "update").
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "update" ]; then
        if ts_job_running; then
            cgi_error "update_in_progress" "An install or update is already running"
            exit 0
        fi
        up_installed=$(get_ts_version)
        up_latest=$(ts_latest_read)
        if [ -n "$up_latest" ] && [ -n "$up_installed" ] && ! ts_version_gt "$up_latest" "$up_installed"; then
            cgi_error "up_to_date" "Tailscale is already up to date"
            exit 0
        fi
        qlog_info "Starting Tailscale update from $up_installed"
        # The run id lets the UI ignore an older install's leftover status file.
        up_run="$(date +%s)$$"
        ( $_SUDO /usr/bin/qmanager_tailscale_mgr update "$up_run" ) </dev/null >/dev/null 2>&1 &
        jq -n --arg run "$up_run" '{ success: true, run: $run }'
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
        # NOTE: Do NOT use --json flag — its output is fully buffered on
        # RM520N-GL (no stdbuf available) and never flushes to the file.
        # Interactive mode flushes the auth URL immediately.
        # --reset clears any lingering flags from a prior `tailscale up`
        # (matches the rgmii-toolkit/SimpleAdmin convention validated across
        # PRAIRE and SDXLEMUR modem platforms).
        # Flag-aware SSH: --reset would wipe RunSSH on every connect, so we
        # re-append --ssh here when the QManager-owned intent flag is set.
        ssh_flag_arg=""
        if [ "$(get_ssh_pref)" = "true" ]; then
            ssh_flag_arg="--ssh"
        fi
        # shellcheck disable=SC2086 # $ssh_flag_arg intentionally unquoted: empty→zero words (POSIX opt-arg idiom)
        ( ts_cmd up --reset --accept-dns=false $ssh_flag_arg > "$TS_UP_OUTPUT" 2>&1 ) &
        ts_up_pid=$!
        echo "$ts_up_pid" > "$TS_UP_PID_FILE"

        # Poll for auth URL or "Success" in interactive output (up to 15 seconds)
        attempts=0
        auth_url=""
        while [ "$attempts" -lt 15 ]; do
            sleep 1
            if [ -f "$TS_UP_OUTPUT" ] && [ -s "$TS_UP_OUTPUT" ]; then
                # Check if already authenticated (interactive mode prints "Success.")
                if grep -q "Success" "$TS_UP_OUTPUT" 2>/dev/null; then
                    rm -f "$AUTH_URL_FILE" "$TS_UP_PID_FILE"
                    qlog_info "Tailscale already authenticated"
                    jq -n '{"success": true, "already_authenticated": true}'
                    exit 0
                fi
                # Parse auth URL from interactive output:
                # "To authenticate, visit:\n\n\thttps://login.tailscale.com/a/..."
                auth_url=$(grep -o 'https://login\.tailscale\.com/[^ ]*' "$TS_UP_OUTPUT" 2>/dev/null | head -1)
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
                # www-data has no mount grant (confirmed via `sudo -l -U
                # www-data`) — do NOT attempt a remount here, just detect and
                # report honestly if /lib is stuck read-only.
                _ts_boot_err=$($_SUDO /bin/ln -sf "$UNIT_DIR/tailscaled.service" "$WANTS_DIR/tailscaled.service" 2>&1 >/dev/null)
                [ -n "$_ts_boot_err" ] && qlog_warn "tailscaled boot-enable ln failed: $_ts_boot_err"
                if [ -L "$WANTS_DIR/tailscaled.service" ]; then
                    qlog_info "Tailscale enabled on boot"
                    cgi_success
                else
                    qlog_warn "Tailscale boot-enable failed — symlink not present after ln attempt"
                    cgi_error "service_enable_failed" "Could not enable Tailscale on boot (rootfs may be read-only)"
                fi
                ;;
            false)
                _ts_boot_err=$($_SUDO /bin/rm -f "$WANTS_DIR/tailscaled.service" 2>&1 >/dev/null)
                [ -n "$_ts_boot_err" ] && qlog_warn "tailscaled boot-disable rm failed: $_ts_boot_err"
                if [ ! -L "$WANTS_DIR/tailscaled.service" ]; then
                    qlog_info "Tailscale disabled on boot"
                    cgi_success
                else
                    qlog_warn "Tailscale boot-disable failed — symlink still present after rm attempt"
                    cgi_error "service_disable_failed" "Could not disable Tailscale on boot (rootfs may be read-only)"
                fi
                ;;
            *)
                cgi_error "invalid_value" "enabled must be true or false"
                ;;
        esac
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: set_ssh — persist SSH intent flag + apply live if daemon running
    # -------------------------------------------------------------------------
    # User intent (1 or 0) is stored in $SSH_PREF_FILE and read by the connect
    # path so SSH survives `tailscale up --reset`. When the daemon is running
    # we also apply the change immediately via `tailscale set --ssh=`.
    if [ "$ACTION" = "set_ssh" ]; then
        ssh_value=$(printf '%s' "$POST_DATA" | jq -r '.enabled | if . == null then empty else tostring end')
        if [ -z "$ssh_value" ]; then
            cgi_error "missing_field" "enabled field is required"
            exit 0
        fi
        case "$ssh_value" in
            true)  new_flag="1" ;;
            false) new_flag="0" ;;
            *)
                cgi_error "invalid_value" "enabled must be true or false"
                exit 0
                ;;
        esac

        # Atomic flag write, then `tailscale set --ssh=` if the daemon is up, with rollback
        # (lib: system_validate.sh). A stopped daemon returns pending=true so the UI says
        # "applies on next connect".
        if ! qm_ts_ssh_save "$ssh_value"; then
            if [ "$QM_TS_ERR" = "set_failed" ]; then
                jq -n --arg detail "$QM_TS_DETAIL" '{success: false, error: "set_failed", detail: $detail}'
            else
                cgi_error "$QM_TS_ERR" "$QM_TS_DETAIL"
            fi
            exit 0
        fi
        if [ "$QM_TS_PENDING" = "1" ]; then
            jq -n '{success: true, pending: true, message: "Tailscale SSH will activate on next connect."}'
        else
            cgi_success
        fi
        exit 0
    fi

    # -------------------------------------------------------------------------
    # action: uninstall — remove tailscale from the device
    # -------------------------------------------------------------------------
    if [ "$ACTION" = "uninstall" ]; then
        if ts_job_running; then
            cgi_error "install_in_progress" "An install or update is running"
            exit 0
        fi
        qlog_info "Uninstalling Tailscale"

        # Stop service if running
        if is_daemon_running; then
            qlog_info "Stopping Tailscale daemon before uninstall"
            kill_stale_ts_up
            ts_cmd down >/dev/null 2>&1
            svc_stop "tailscaled"
            sleep 1
        fi

        # Backgrounded so the firewall reload cannot cut this response; the UI
        # follows the run id through install_status (op "uninstall").
        un_run="$(date +%s)$$"
        ( $_SUDO /usr/bin/qmanager_tailscale_mgr uninstall "$un_run" ) </dev/null >/dev/null 2>&1 &
        jq -n --arg run "$un_run" '{ success: true, run: $run }'

        qlog_info "Tailscale uninstall started"
        exit 0
    fi

    # Unknown action
    cgi_error "unknown_action" "Unknown action: $ACTION"
    exit 0
fi

# Method not allowed
cgi_method_not_allowed
