#!/bin/sh
# =============================================================================
# tower_lock_mgr.sh — QManager Tower Lock Manager Library
# =============================================================================
# A sourceable library providing tower lock config CRUD, AT command
# builders/parsers, and signal quality calculation.
#
# This is a LIBRARY — no persistent process, no polling.
# CGI scripts and the failover/schedule scripts source it.
#
# Dependencies: qcmd, qlog_* functions (from qlog.sh), jq
# Install location: /usr/lib/qmanager/tower_lock_mgr.sh
#
# Usage:
#   . /usr/lib/qmanager/tower_lock_mgr.sh
#   tower_config_read             → Cat config JSON to stdout
#   tower_config_init             → Create default config if missing
#   tower_config_get <jq_path>    → Extract value via jq (e.g., ".failover.enabled")
#   tower_config_update <filter>  → Update config via jq filter
#   tower_lock_lte <n> <pairs>    → Send AT+QNWLOCK="common/4g" command
#   tower_unlock_lte              → Clear LTE lock
#   tower_lock_nr <pci> <arfcn> <scs> <band> → Send AT+QNWLOCK="common/5g"
#   tower_unlock_nr               → Clear NR-SA lock
#   tower_read_lte_lock           → Query and parse LTE lock state
#   tower_read_nr_lock            → Query and parse NR-SA lock state
#   tower_set_persist <0|1>       → Send AT+QNWLOCK="save_ctrl"
#   tower_read_persist            → Query and parse persist state
#   calc_signal_quality <rsrp>    → Returns 0-100 integer
# =============================================================================

[ -f /usr/lib/qmanager/platform.sh ] && . /usr/lib/qmanager/platform.sh

[ -n "$_TOWER_LOCK_MGR_LOADED" ] && return 0
_TOWER_LOCK_MGR_LOADED=1

# --- Configuration -----------------------------------------------------------
TOWER_CONFIG_FILE="/etc/qmanager/tower_lock.json"
TOWER_FAILOVER_FLAG="/tmp/qmanager_tower_failover"
TOWER_FAILOVER_PID="/tmp/qmanager_tower_failover.pid"
TOWER_FAILOVER_SCRIPT="/usr/bin/qmanager_tower_failover"

# Ensure config directory exists
mkdir -p /etc/qmanager 2>/dev/null

# --- Default config as a constant (used by init and validation) ---------------
TOWER_DEFAULT_CONFIG='{"lte":{"enabled":false,"cells":[null,null,null]},"nr_sa":{"enabled":false,"pci":null,"arfcn":null,"scs":null,"band":null},"persist":false,"failover":{"enabled":true,"threshold":20},"schedule":{"enabled":false,"start_time":"08:00","end_time":"22:00","days":[1,2,3,4,5]}}'

# =============================================================================
# Config File Operations (all use jq for guaranteed valid JSON)
# =============================================================================

# Create default config file if it doesn't exist or is invalid
tower_config_init() {
    if [ -f "$TOWER_CONFIG_FILE" ]; then
        # Validate existing file with jq
        if jq empty "$TOWER_CONFIG_FILE" 2>/dev/null; then
            return 0
        fi
        qlog_warn "Tower config file is invalid JSON, recreating"
    fi

    local tmp="${TOWER_CONFIG_FILE}.tmp"
    printf '%s\n' "$TOWER_DEFAULT_CONFIG" | jq '.' > "$tmp" && mv "$tmp" "$TOWER_CONFIG_FILE"
    qlog_info "Created default tower lock config"
}

# Read the entire config file to stdout (validated)
# Falls back to default if file is missing or invalid
tower_config_read() {
    if [ -f "$TOWER_CONFIG_FILE" ] && jq empty "$TOWER_CONFIG_FILE" 2>/dev/null; then
        cat "$TOWER_CONFIG_FILE"
    else
        qlog_warn "Tower config missing or invalid, returning default"
        printf '%s\n' "$TOWER_DEFAULT_CONFIG"
    fi
}

# Extract a value from the config using a jq path
# Args: $1=jq filter expression (e.g., ".failover.enabled", ".lte.cells")
# Returns: raw value (no quotes for strings unless you use jq -r)
tower_config_get() {
    local filter="$1"
    tower_config_init
    # NOTE: Cannot use `// empty` — jq treats `false` as falsy so
    # `false // empty` produces nothing. Use explicit null check instead.
    jq -r "($filter) | if . == null then empty else tostring end" "$TOWER_CONFIG_FILE" 2>/dev/null
}

# Update the config file using a jq filter expression
# The filter is applied to the current config and the result is written back.
# Args: $1=jq filter expression (e.g., '.persist = true')
# Returns: 0 on success, 1 on failure
tower_config_update() {
    local filter="$1"
    tower_config_init

    local tmp="${TOWER_CONFIG_FILE}.tmp"
    if jq "$filter" "$TOWER_CONFIG_FILE" > "$tmp" 2>/dev/null; then
        # Validate the output
        if jq empty "$tmp" 2>/dev/null; then
            mv "$tmp" "$TOWER_CONFIG_FILE"
            return 0
        fi
    fi

    rm -f "$tmp"
    qlog_error "tower_config_update failed for filter: $filter"
    return 1
}

# =============================================================================
# LTE Lock Config Update (uses jq — safe, atomic)
# =============================================================================
# Args: $1=enabled (true/false), $2=cell1_earfcn, $3=cell1_pci,
#       $4=cell2_earfcn, $5=cell2_pci, $6=cell3_earfcn, $7=cell3_pci
# Empty earfcn/pci pairs become null slots.
tower_config_update_lte() {
    local enabled="$1"
    local c1_e="$2" c1_p="$3" c2_e="$4" c2_p="$5" c3_e="$6" c3_p="$7"

    # Build cells array in JSON
    local cell1="null" cell2="null" cell3="null"
    [ -n "$c1_e" ] && [ -n "$c1_p" ] && cell1="{\"earfcn\":$c1_e,\"pci\":$c1_p}"
    [ -n "$c2_e" ] && [ -n "$c2_p" ] && cell2="{\"earfcn\":$c2_e,\"pci\":$c2_p}"
    [ -n "$c3_e" ] && [ -n "$c3_p" ] && cell3="{\"earfcn\":$c3_e,\"pci\":$c3_p}"

    tower_config_update ".lte.enabled = $enabled | .lte.cells = [$cell1, $cell2, $cell3]"
}

# =============================================================================
# NR-SA Lock Config Update (uses jq — safe, atomic)
# =============================================================================
# Args: $1=enabled (true/false), $2=pci, $3=arfcn, $4=scs, $5=band
tower_config_update_nr() {
    local enabled="$1"
    local pci="${2:-null}" arfcn="${3:-null}" scs="${4:-null}" band="${5:-null}"

    tower_config_update ".nr_sa.enabled = $enabled | .nr_sa.pci = $pci | .nr_sa.arfcn = $arfcn | .nr_sa.scs = $scs | .nr_sa.band = $band"
}

# =============================================================================
# Settings Config Update (persist + failover) — uses jq
# =============================================================================
# Args: $1=persist(true/false), $2=failover_enabled(true/false), $3=threshold
tower_config_update_settings() {
    local persist="$1" fo_enabled="$2" fo_threshold="$3"

    tower_config_update ".persist = $persist | .failover.enabled = $fo_enabled | .failover.threshold = $fo_threshold"
}

# =============================================================================
# Schedule Config Update — uses jq
# =============================================================================
# Args: $1=enabled(true/false), $2=start_time, $3=end_time, $4=days_json_array
tower_config_update_schedule() {
    local enabled="$1" start_time="$2" end_time="$3" days_json="$4"

    tower_config_update ".schedule.enabled = $enabled | .schedule.start_time = \"$start_time\" | .schedule.end_time = \"$end_time\" | .schedule.days = $days_json"
}

# =============================================================================
# AT Command Operations — LTE Tower Lock
# =============================================================================

# Send LTE tower lock command
# Args: $1=num_cells, then pairs: $2=earfcn1, $3=pci1, $4=earfcn2, $5=pci2, ...
tower_lock_lte() {
    local num="$1"
    shift
    local cmd="AT+QNWLOCK=\"common/4g\",$num"
    while [ $# -ge 2 ]; do
        cmd="${cmd},$1,$2"
        shift 2
    done
    qlog_info "LTE tower lock: $cmd"
    local result
    result=$(qcmd "$cmd" 2>/dev/null)
    local rc=$?
    printf '%s' "$result"
    return $rc
}

# Clear LTE tower lock
tower_unlock_lte() {
    qlog_info "Clearing LTE tower lock"
    local result
    result=$(qcmd 'AT+QNWLOCK="common/4g",0' 2>/dev/null)
    local rc=$?
    printf '%s' "$result"
    return $rc
}

# Query current LTE lock state
# Output: "locked <num_cells> <earfcn1> <pci1> [<earfcn2> <pci2> ...]" or "unlocked"
tower_read_lte_lock() {
    local result
    result=$(qcmd 'AT+QNWLOCK="common/4g"' 2>/dev/null)
    local rc=$?

    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        printf 'error'
        return 1
    fi

    # Parse response: +QNWLOCK: "common/4g",<num>,<freq>,<pci>[,...]
    # or: +QNWLOCK: "common/4g",0
    local line
    line=$(printf '%s' "$result" | grep '+QNWLOCK:' | head -1 | tr -d '\r')

    if [ -z "$line" ]; then
        printf 'error'
        return 1
    fi

    # Extract everything after "common/4g",
    local params
    params=$(printf '%s' "$line" | sed 's/.*"common\/4g",//' | tr -d ' ')

    # First param is num_cells (or 0 for unlocked)
    local num_cells
    num_cells=$(printf '%s' "$params" | cut -d',' -f1)

    if [ "$num_cells" = "0" ] || [ -z "$num_cells" ]; then
        printf 'unlocked'
        return 0
    fi

    # Output: locked <num_cells> <earfcn1> <pci1> ...
    printf 'locked %s' "$num_cells"
    local remaining
    remaining=$(printf '%s' "$params" | sed 's/^[^,]*,//')
    # Parse pairs
    local i=0
    while [ $i -lt "$num_cells" ] && [ -n "$remaining" ]; do
        local earfcn pci
        earfcn=$(printf '%s' "$remaining" | cut -d',' -f1)
        pci=$(printf '%s' "$remaining" | cut -d',' -f2)
        printf ' %s %s' "$earfcn" "$pci"
        # Remove the consumed pair
        remaining=$(printf '%s' "$remaining" | sed 's/^[^,]*,[^,]*//' | sed 's/^,//')
        i=$((i + 1))
    done

    return 0
}

# =============================================================================
# AT Command Operations — NR-SA Tower Lock
# =============================================================================

# Send NR-SA tower lock command
# Args: $1=pci, $2=arfcn, $3=scs, $4=band
tower_lock_nr() {
    local pci="$1" arfcn="$2" scs="$3" band="$4"
    local cmd="AT+QNWLOCK=\"common/5g\",$pci,$arfcn,$scs,$band"
    qlog_info "NR-SA tower lock: $cmd"
    local result
    result=$(qcmd "$cmd" 2>/dev/null)
    local rc=$?
    printf '%s' "$result"
    return $rc
}

# Clear NR-SA tower lock
tower_unlock_nr() {
    qlog_info "Clearing NR-SA tower lock"
    local result
    result=$(qcmd 'AT+QNWLOCK="common/5g",0' 2>/dev/null)
    local rc=$?
    printf '%s' "$result"
    return $rc
}

# Query current NR-SA lock state
# Output: "locked <pci> <arfcn> <scs> <band>" or "unlocked"
tower_read_nr_lock() {
    local result
    result=$(qcmd 'AT+QNWLOCK="common/5g"' 2>/dev/null)
    local rc=$?

    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        printf 'error'
        return 1
    fi

    local line
    line=$(printf '%s' "$result" | grep '+QNWLOCK:' | head -1 | tr -d '\r')

    if [ -z "$line" ]; then
        # No +QNWLOCK line could mean unlocked or error
        printf 'unlocked'
        return 0
    fi

    # Extract params after "common/5g"
    local params
    params=$(printf '%s' "$line" | sed 's/.*"common\/5g"//' | sed 's/^,//' | tr -d ' ')

    # If empty or just the key with no params — unlocked
    if [ -z "$params" ] || [ "$params" = "0" ]; then
        printf 'unlocked'
        return 0
    fi

    # Locked: params = <pci>,<arfcn>,<scs>,<band>
    local pci arfcn scs band
    pci=$(printf '%s' "$params" | cut -d',' -f1)
    arfcn=$(printf '%s' "$params" | cut -d',' -f2)
    scs=$(printf '%s' "$params" | cut -d',' -f3)
    band=$(printf '%s' "$params" | cut -d',' -f4)

    printf 'locked %s %s %s %s' "$pci" "$arfcn" "$scs" "$band"
    return 0
}

# =============================================================================
# AT Command Operations — Persistence Control
# =============================================================================

# Set persistence for both LTE and NR locks
# Args: $1=value (0 or 1)
tower_set_persist() {
    local val="$1"
    qlog_info "Setting tower lock persistence: $val"
    local result
    result=$(qcmd "AT+QNWLOCK=\"save_ctrl\",$val,$val" 2>/dev/null)
    local rc=$?
    printf '%s' "$result"
    return $rc
}

# Read current persistence state
# Output: "<lte_ctrl> <nr_ctrl>" (e.g., "1 1" or "0 0")
tower_read_persist() {
    local result
    result=$(qcmd 'AT+QNWLOCK="save_ctrl"' 2>/dev/null)
    local rc=$?

    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        printf '0 0'
        return 1
    fi

    local line
    line=$(printf '%s' "$result" | grep '+QNWLOCK:' | head -1 | tr -d '\r')

    if [ -z "$line" ]; then
        printf '0 0'
        return 1
    fi

    # +QNWLOCK: "save_ctrl",<lte>,<nr>
    local params
    params=$(printf '%s' "$line" | sed 's/.*"save_ctrl",//' | tr -d ' ')
    local lte_ctrl nr_ctrl
    lte_ctrl=$(printf '%s' "$params" | cut -d',' -f1)
    nr_ctrl=$(printf '%s' "$params" | cut -d',' -f2)
    [ -z "$lte_ctrl" ] && lte_ctrl="0"
    [ -z "$nr_ctrl" ] && nr_ctrl="0"

    printf '%s %s' "$lte_ctrl" "$nr_ctrl"
    return 0
}

# =============================================================================
# Signal Quality Calculation
# =============================================================================

# Calculate signal quality percentage from RSRP
# Formula: clamp(0, 100, ((rsrp + 140) * 100) / 60)
# Maps: -140 dBm → 0%, -80 dBm → 100%
# Args: $1=rsrp (integer, e.g., -95)
# Output: integer 0-100
calc_signal_quality() {
    local rsrp="$1"

    # Validate input
    case "$rsrp" in
        ''|*[!0-9-]*) printf '0'; return 1 ;;
    esac

    local quality
    quality=$(( (rsrp + 140) * 100 / 60 ))
    [ "$quality" -lt 0 ] && quality=0
    [ "$quality" -gt 100 ] && quality=100
    printf '%s' "$quality"
    return 0
}

# =============================================================================
# Failover Watcher Management
# =============================================================================

# Kill any running failover watcher (delegates to platform svc)
tower_kill_failover_watcher() {
    svc_stop qmanager_tower_failover
}

# Spawn failover watcher if enabled (delegates to init.d)
# Returns: "true" if daemon verified running, "false" if not spawned or failed
tower_spawn_failover_watcher() {
    # Check if failover is enabled in config
    local fo_enabled
    fo_enabled=$(tower_config_get ".failover.enabled")

    if [ "$fo_enabled" != "true" ]; then
        printf 'false'
        return 0
    fi

    # Stop any existing watcher, then start fresh via platform svc
    svc_stop qmanager_tower_failover
    svc_start qmanager_tower_failover

    # Enable for boot auto-start
    svc_enable qmanager_tower_failover

    # Verify daemon actually started (PID file written immediately on spawn)
    sleep 1
    if [ -f "$TOWER_FAILOVER_PID" ]; then
        local pid
        pid=$(cat "$TOWER_FAILOVER_PID" 2>/dev/null | tr -d ' \n\r')
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            qlog_info "Tower failover watcher verified running (PID=$pid)"
            printf 'true'
            return 0
        fi
    fi

    qlog_warn "Tower failover watcher failed to start"
    printf 'false'
    return 1
}

# =============================================================================
# MTU Re-apply After Interface Bounce
# =============================================================================
# Tower lock/unlock causes the modem to briefly disconnect, which resets the
# rmnet_data interface MTU back to the default 1500. The persistent file
# /etc/firewall.user.mtu is intact but nothing re-applies it.
#
# This spawns a short-lived background process that polls until the interface
# is back up, re-applies MTU, then exits. Self-terminates after 30s.
#
# PID file ensures only one re-apply process runs at a time.
# =============================================================================

MTU_REAPPLY_PID="/tmp/qmanager_mtu_reapply.pid"
MTU_FILE="/etc/firewall.user.mtu"

mtu_reapply_after_bounce() {
    # Skip if no custom MTU is configured
    if [ ! -s "$MTU_FILE" ]; then
        return 0
    fi

    # Kill any previous re-apply process
    if [ -f "$MTU_REAPPLY_PID" ]; then
        local old_pid
        old_pid=$(cat "$MTU_REAPPLY_PID" 2>/dev/null | tr -d ' \n\r')
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            kill "$old_pid" 2>/dev/null
        fi
        rm -f "$MTU_REAPPLY_PID"
    fi

    qlog_info "Spawning MTU re-apply watcher (polling up to 30s)"

    # Double-fork for BusyBox (no setsid)
    (
        _mtu_reapply_worker </dev/null >/dev/null 2>&1 &
        echo $! > "$MTU_REAPPLY_PID"
    )
}

_mtu_reapply_worker() {
    local elapsed=0
    local max_wait=30
    local interval=2

    while [ "$elapsed" -lt "$max_wait" ]; do
        sleep "$interval"
        elapsed=$((elapsed + interval))

        # Find any rmnet_data interface that is up
        local iface=""
        for f in /sys/class/net/rmnet_data*; do
            [ -e "$f" ] || continue
            local name
            name=$(basename "$f")
            local carrier
            carrier=$(cat "/sys/class/net/${name}/carrier" 2>/dev/null)
            if [ "$carrier" = "1" ]; then
                iface="$name"
                break
            fi
        done

        [ -z "$iface" ] && continue

        # Interface is up — check if MTU needs re-applying
        local current_mtu expected_mtu
        current_mtu=$(cat "/sys/class/net/${iface}/mtu" 2>/dev/null)
        expected_mtu=$(grep -oE 'mtu [0-9]+' "$MTU_FILE" | head -1 | awk '{print $2}')

        if [ -n "$expected_mtu" ] && [ "$current_mtu" != "$expected_mtu" ]; then
            . "$MTU_FILE"
            logger -t qmanager_mtu "Re-applied MTU after interface bounce (was $current_mtu, now $expected_mtu)"
        fi

        # Done — exit regardless of whether we re-applied
        rm -f "$MTU_REAPPLY_PID"
        return 0
    done

    # Timeout — clean up
    logger -t qmanager_mtu "MTU re-apply timed out after ${max_wait}s (interface never came back)"
    rm -f "$MTU_REAPPLY_PID"
}
