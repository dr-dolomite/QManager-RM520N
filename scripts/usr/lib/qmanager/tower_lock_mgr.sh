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
#   tower_set_persist <lte> [nr]  → Send AT+QNWLOCK="save_ctrl" (nr defaults to lte)
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

# In-flight marker for a tower-lock AT write. A lock/unlock write causes a
# brief (documented 3-5s) modem reconnect; a failover watcher that samples
# signal during exactly that window could misread the blip as a bad reading.
# Rather than stopping/respawning the watcher around every write (which opens
# error-exit paths that could leave the device with NO watcher running, an
# indefinite loss of protection strictly worse than the blip it guards
# against), a write marks itself in-flight and the watcher's own loop skips
# any cycle that lands inside the window.
#
# Self-expiring by design: the marker's content is a future UNIX deadline
# (now + TOWER_WRITE_SETTLE), not a boolean, so a lock.sh process that is
# killed mid-write (crash, OOM, lighttpd recycling the CGI) cannot wedge the
# watcher into skipping forever — the marker simply goes stale and the next
# cycle after the deadline reads live signal normally again. No "end"/cleanup
# call is required, and none should be added — a try/rm-on-exit pattern would
# reintroduce exactly the "must not leak" fragility this design avoids.
TOWER_WRITE_INFLIGHT="/tmp/qmanager_tower_write_inflight"
# TOWER_WRITE_SETTLE must simultaneously satisfy three independent
# constraints, or the marker protects roughly nothing:
#   1. > qmanager_tower_failover's INTERVAL (20s, checked once per loop
#      cycle). If SETTLE <= INTERVAL, whether the daemon ever observes the
#      marker before it expires is a coin flip on write timing — a write
#      landing in the second half of a cycle expires before the daemon's
#      next check. This was the bug: SETTLE=10 < INTERVAL=20 meant roughly
#      half of all writes got no protection at all.
#   2. > the daemon's own SETTLE=20 ("seconds before first check (modem
#      reconnects after lock)") — the daemon's existing estimate, in the
#      SAME file, of this SAME physical event (attach cycle drops the eth0
#      link for ~4s).
#   3. > the poller cadence (~3.7-4.0s, NOT 2s — the poller's `sleep 2`
#      runs AFTER the cycle body). The daemon reads a CACHE
#      (/tmp/qmanager_status.json), not live signal, so a bad RSRP sampled
#      during the blip sits in that cache for at least one more poller
#      cycle after the blip itself ends. The guard must outlast
#      blip + poller cadence, not just the blip.
# 30 clears all three with margin. Do not tune this down without
# re-deriving all three numbers above — a smaller value silently
# reintroduces the coin-flip failure mode, and it will not show up in
# testing unless a write happens to land early in the daemon's cycle.
TOWER_WRITE_SETTLE=30

# Mark a tower-lock AT write as in-flight. Call immediately before the AT
# write (tower_lock_lte / tower_lock_nr / tower_unlock_lte / tower_unlock_nr).
# No matching "end" call — see the self-expiring note above.
tower_write_begin() {
    local _tw_deadline
    _tw_deadline=$(( $(date +%s 2>/dev/null || echo 0) + TOWER_WRITE_SETTLE ))
    printf '%s' "$_tw_deadline" > "$TOWER_WRITE_INFLIGHT" 2>/dev/null
}

# Ensure config directory exists
mkdir -p /etc/qmanager 2>/dev/null

# --- Default config as a constant (used by init and validation) ---------------
TOWER_DEFAULT_CONFIG='{"lte":{"enabled":false,"cells":[null,null,null]},"nr_sa":{"enabled":false,"pci":null,"arfcn":null,"scs":null,"band":null},"persist":false,"failover":{"enabled":false,"threshold":20},"schedule":{"enabled":false,"start_time":"08:00","end_time":"22:00","days":[1,2,3,4,5]}}'

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

    # No +QNWLOCK line is ambiguous (could be unlocked or a malformed/partial
    # read) — mirror the LTE reader above and report it as a failed read
    # rather than guessing "unlocked". Callers must check for the literal
    # string "error" and must NOT treat it as "unlocked".
    #
    # CONFIRMED on hardware (live probe, LTE-only device — B28 PCC + B3 SCC,
    # no NR leg registered at all, SA or NSA): AT+QNWLOCK="common/5g" still
    # returned a full `+QNWLOCK: "common/5g",0` line (rc=0), byte-structurally
    # identical to the common/4g reply. It answers from the modem's stored
    # lock configuration, not from live NR registration, so it does not need
    # an NR leg to exist to report on one. A missing +QNWLOCK line is
    # therefore unreachable on a healthy read — the only way to hit this
    # branch is a genuinely malformed/partial response, which is exactly
    # what "error" is for. The locked-NR parse path below this block remains
    # unexercised until an NR cell is actually locked on an SA-capable
    # network; that is a separate, un-gated code path and not a reason to
    # add speculative handling here.
    if [ -z "$line" ]; then
        printf 'error'
        return 1
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

# Set persistence per radio. Args: $1=lte (0|1), $2=nr (0|1, defaults to $1)
tower_set_persist() {
    local lte="$1" nr="${2:-$1}"
    qlog_info "Setting tower lock persistence: lte=$lte nr=$nr"
    local result
    result=$(qcmd "AT+QNWLOCK=\"save_ctrl\",$lte,$nr" 2>/dev/null)
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

    # On failure, print "error" (matching the sibling tower_read_lte_lock /
    # tower_read_nr_lock sentinel) instead of a fabricated "0 0". The only
    # caller (tower/status.sh) now gates on this function's return status
    # rather than parsing the printed text, but the text itself must not
    # look like a legitimately-read "persistence off" value to any future
    # caller that forgets to check $?.
    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        printf 'error'
        return 1
    fi

    local line
    line=$(printf '%s' "$result" | grep '+QNWLOCK:' | head -1 | tr -d '\r')

    if [ -z "$line" ]; then
        printf 'error'
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

    # Enable for boot auto-start. This is a boot-persistence concern
    # separate from "is the daemon running right now" — track it so a
    # failure (e.g. rootfs stuck read-only) is not silently swallowed,
    # even though the printed true/false (consumed by callers via command
    # substitution) still reflects live daemon state.
    local enable_ok=1
    if ! svc_enable qmanager_tower_failover; then
        enable_ok=0
        qlog_warn "svc_enable qmanager_tower_failover failed — daemon may not survive reboot"
    fi

    # Verify daemon actually started (PID file written immediately on spawn)
    sleep 1
    if [ -f "$TOWER_FAILOVER_PID" ]; then
        local pid
        pid=$(cat "$TOWER_FAILOVER_PID" 2>/dev/null | tr -d ' \n\r')
        if pid_alive "$pid"; then
            qlog_info "Tower failover watcher verified running (PID=$pid)"
            printf 'true'
            if [ "$enable_ok" -eq 0 ]; then
                return 2
            fi
            return 0
        fi
    fi

    qlog_warn "Tower failover watcher failed to start"
    printf 'false'
    return 1
}

# =============================================================================
# Shared Apply Primitives (tower CGIs and config-backup restore)
# =============================================================================
# Failures set TW_ERR_CODE / TW_ERR_DETAIL and return 1; results land in TW_*
# globals (call without a command substitution). None of these exit.

# tower_lte_cell_args <e1> <p1> <e2> <p2> <e3> <p3>: sets TW_NUM_CELLS, TW_AT_ARGS.
tower_lte_cell_args() {
    TW_NUM_CELLS=0
    TW_AT_ARGS=""
    if [ -n "$1" ] && [ -n "$2" ]; then
        TW_NUM_CELLS=$((TW_NUM_CELLS + 1))
        TW_AT_ARGS="$1 $2"
    fi
    if [ -n "$3" ] && [ -n "$4" ]; then
        TW_NUM_CELLS=$((TW_NUM_CELLS + 1))
        TW_AT_ARGS="$TW_AT_ARGS $3 $4"
    fi
    if [ -n "$5" ] && [ -n "$6" ]; then
        TW_NUM_CELLS=$((TW_NUM_CELLS + 1))
        TW_AT_ARGS="$TW_AT_ARGS $5 $6"
    fi
}

# tower_do_lte_lock <e1> <p1> <e2> <p2> <e3> <p3>: lock using TW_NUM_CELLS/TW_AT_ARGS
# from tower_lte_cell_args. Sets TW_FAILOVER_ARMED, TW_PERSIST_FAILED.
tower_do_lte_lock() {
    local result rc _fa_rc
    TW_ERR_CODE=""
    TW_ERR_DETAIL=""

    # Mark the write in-flight so a running failover watcher skips the reconnect blip.
    tower_write_begin

    result=$(tower_lock_lte "$TW_NUM_CELLS" $TW_AT_ARGS)
    rc=$?
    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        qlog_error "LTE tower lock failed (rc=$rc)"
        TW_ERR_CODE="modem_error"
        TW_ERR_DETAIL="Failed to send tower lock command"
        return 1
    fi

    qlog_info "LTE tower lock applied successfully"
    mtu_reapply_after_bounce

    # Locking does not touch the failover setting.
    tower_config_update_lte "true" "$1" "$2" "$3" "$4" "$5" "$6"

    # rc 2 = daemon live but svc_enable failed, so failover will not survive a reboot.
    TW_FAILOVER_ARMED=$(tower_spawn_failover_watcher); _fa_rc=$?
    TW_PERSIST_FAILED="false"
    [ "$_fa_rc" = "2" ] && TW_PERSIST_FAILED="true"
    return 0
}

# tower_do_nr_lock <pci> <arfcn> <scs> <band>. Sets TW_FAILOVER_ARMED, TW_PERSIST_FAILED.
tower_do_nr_lock() {
    local result rc _fa_rc
    TW_ERR_CODE=""
    TW_ERR_DETAIL=""

    tower_write_begin

    result=$(tower_lock_nr "$1" "$2" "$3" "$4")
    rc=$?
    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        qlog_error "NR-SA tower lock failed (rc=$rc)"
        TW_ERR_CODE="modem_error"
        TW_ERR_DETAIL="Failed to send NR tower lock command"
        return 1
    fi

    qlog_info "NR-SA tower lock applied successfully"
    mtu_reapply_after_bounce

    tower_config_update_nr "true" "$1" "$2" "$3" "$4"

    TW_FAILOVER_ARMED=$(tower_spawn_failover_watcher); _fa_rc=$?
    TW_PERSIST_FAILED="false"
    [ "$_fa_rc" = "2" ] && TW_PERSIST_FAILED="true"
    return 0
}

# _tower_do_unlock <label> <unlock_fn> <own_key> <other_key> <other_label> <err_detail> <read_fn>
# Sets TW_SVC_DISABLE_FAILED.
_tower_do_unlock() {
    local label="$1" unlock_fn="$2" own="$3" other="$4" other_label="$5" err_detail="$6" read_fn="$7"
    local fo_was_enabled result rc other_active state
    TW_ERR_CODE=""
    TW_ERR_DETAIL=""
    TW_SVC_DISABLE_FAILED="false"

    # Stop the watcher before the unlock: the modem drop could read as "no signal".
    # Its activation flag is root-owned in sticky /tmp and clears on the unit's next start.
    fo_was_enabled=$(tower_config_get ".failover.enabled")
    tower_kill_failover_watcher

    # The modem ERRORs on an unlock with nothing locked, so read the state first;
    # an unreadable state ("error") still attempts the write.
    state=$($read_fn)
    if [ "$state" = "unlocked" ]; then
        qlog_info "$label tower already unlocked — clearing config only"
    else
        result=$($unlock_fn)
        rc=$?
        if [ $rc -ne 0 ] || [ -z "$result" ]; then
            qlog_error "$label tower unlock failed (rc=$rc)"
            TW_ERR_CODE="modem_error"
            TW_ERR_DETAIL="$err_detail"
            return 1
        fi

        qlog_info "$label tower lock cleared"
        mtu_reapply_after_bounce
    fi

    # Keep the cell data, only clear the enabled flag.
    tower_config_update ".$own.enabled = false"

    other_active=$(tower_config_get ".$other.enabled")
    if [ "$other_active" = "true" ] && [ "$fo_was_enabled" = "true" ]; then
        tower_spawn_failover_watcher >/dev/null
        qlog_info "$other_label lock still active — failover watcher respawned"
    else
        tower_config_update '.failover.enabled = false'
        if ! svc_disable qmanager_tower_failover; then
            TW_SVC_DISABLE_FAILED="true"
            qlog_warn "svc_disable qmanager_tower_failover failed after $label unlock (rootfs may be read-only)"
        else
            qlog_info "No active locks — failover stopped and disabled"
        fi
    fi
    return 0
}

tower_do_lte_unlock() {
    _tower_do_unlock "LTE" tower_unlock_lte "lte" "nr_sa" "NR" "Failed to clear tower lock" tower_read_lte_lock
}

tower_do_nr_unlock() {
    _tower_do_unlock "NR-SA" tower_unlock_nr "nr_sa" "lte" "LTE" "Failed to clear NR tower lock" tower_read_nr_lock
}

# tower_apply_persist <persist> <persist_lte> <persist_nr> <current_persist>
# Each of the first three is true|false|unset. save_ctrl writes both radios, so the
# live pair is read first and an unreadable modem blocks the write.
# Sets TW_PERSIST_OK, TW_APPLIED_LTE, TW_APPLIED_NR (true|false|null), TW_NEW_PERSIST.
tower_apply_persist() {
    local persist="$1" persist_lte="$2" persist_nr="$3"
    local cur_state cur_lte cur_nr want_lte want_nr fin_lte fin_nr
    TW_PERSIST_OK="true"
    TW_APPLIED_LTE="null"
    TW_APPLIED_NR="null"
    TW_NEW_PERSIST="$4"

    if [ "$persist" = "unset" ] && [ "$persist_lte" = "unset" ] && [ "$persist_nr" = "unset" ]; then
        return 0
    fi

    if ! cur_state=$(tower_read_persist); then
        qlog_error "Persist read failed; not writing save_ctrl"
        TW_PERSIST_OK="false"
        return 0
    fi

    set -- $cur_state
    cur_lte="$1"
    cur_nr="$2"
    want_lte="$cur_lte"
    want_nr="$cur_nr"
    case "$persist" in
        true) want_lte="1"; want_nr="1" ;;
        false) want_lte="0"; want_nr="0" ;;
    esac
    case "$persist_lte" in true) want_lte="1" ;; false) want_lte="0" ;; esac
    case "$persist_nr" in true) want_nr="1" ;; false) want_nr="0" ;; esac

    if [ "$want_lte" != "$cur_lte" ] || [ "$want_nr" != "$cur_nr" ]; then
        # qcmd fails by exit status; ERROR never reaches stdout.
        sleep 0.1
        if tower_set_persist "$want_lte" "$want_nr" >/dev/null; then
            qlog_info "Persist set lte=$want_lte nr=$want_nr"
        else
            qlog_error "Persist AT command failed"
            TW_PERSIST_OK="false"
        fi
    fi

    # What the modem holds now: the request if it landed, else what it had.
    fin_lte="$cur_lte"
    fin_nr="$cur_nr"
    if [ "$TW_PERSIST_OK" = "true" ]; then
        fin_lte="$want_lte"
        fin_nr="$want_nr"
    fi
    TW_APPLIED_LTE="false"
    TW_APPLIED_NR="false"
    [ "$fin_lte" = "1" ] && TW_APPLIED_LTE="true"
    [ "$fin_nr" = "1" ] && TW_APPLIED_NR="true"
    # config.persist mirrors "both radios keep the lock".
    TW_NEW_PERSIST="false"
    [ "$TW_APPLIED_LTE" = "true" ] && [ "$TW_APPLIED_NR" = "true" ] && TW_NEW_PERSIST="true"
    return 0
}

# tower_apply_failover_state <fo_enabled> <previous_fo_enabled>: after the config write,
# start the daemon when enabled with a lock active, stop it when just disabled.
# Sets TW_WATCHER_SPAWNED, TW_SVC_ENABLE_FAILED, TW_SVC_DISABLE_FAILED.
tower_apply_failover_state() {
    local fo_enabled="$1" prev_enabled="$2"
    local lte_active nr_active daemon_alive wpid spawn_result _spawn_rc
    TW_WATCHER_SPAWNED="false"
    TW_SVC_ENABLE_FAILED="false"
    TW_SVC_DISABLE_FAILED="false"

    if [ "$fo_enabled" = "true" ]; then
        lte_active=$(tower_config_get ".lte.enabled")
        nr_active=$(tower_config_get ".nr_sa.enabled")
        if [ "$lte_active" = "true" ] || [ "$nr_active" = "true" ]; then
            # Only spawn when not running, to avoid resetting the settle timer.
            daemon_alive="false"
            if [ -f "$TOWER_FAILOVER_PID" ]; then
                wpid=$(cat "$TOWER_FAILOVER_PID" 2>/dev/null | tr -d ' \n\r')
                pid_alive "$wpid" && daemon_alive="true"
            fi
            if [ "$daemon_alive" != "true" ]; then
                spawn_result=$(tower_spawn_failover_watcher); _spawn_rc=$?
                [ "$spawn_result" = "true" ] && TW_WATCHER_SPAWNED="true"
                # rc 2 = daemon live but svc_enable failed (no boot persistence).
                [ "$_spawn_rc" = "2" ] && TW_SVC_ENABLE_FAILED="true"
                qlog_info "Failover spawn attempt: result=$spawn_result rc=$_spawn_rc"
            fi
        fi
    fi

    if [ "$fo_enabled" = "false" ] && [ "$prev_enabled" = "true" ]; then
        tower_kill_failover_watcher
        rm -f "$TOWER_FAILOVER_FLAG"
        if ! svc_disable qmanager_tower_failover; then
            TW_SVC_DISABLE_FAILED="true"
            qlog_warn "svc_disable qmanager_tower_failover failed (rootfs may be read-only)"
        fi
        qlog_info "Failover disabled — killed daemon, disabled service"
    fi
    return 0
}

# tower_has_lock_targets: rc 0 when an LTE cell or an NR-SA pci+arfcn is configured.
tower_has_lock_targets() {
    local has_lte nr_pci nr_arfcn
    has_lte=$(tower_config_get '.lte.cells | map(select(. != null)) | length')
    [ -z "$has_lte" ] && has_lte="0"

    nr_pci=$(tower_config_get '.nr_sa.pci')
    nr_arfcn=$(tower_config_get '.nr_sa.arfcn')
    if [ "$has_lte" != "0" ]; then
        return 0
    fi
    if [ -n "$nr_pci" ] && [ "$nr_pci" != "null" ] && \
       [ -n "$nr_arfcn" ] && [ "$nr_arfcn" != "null" ]; then
        return 0
    fi
    return 1
}

# tower_apply_schedule_timer <enabled> <start> <end> <csv_days>: arm or tear down the
# timer pair through the root helper. Sets TW_ARM_OK, TW_ARMED (true|false), TW_ARM_REASON.
tower_apply_schedule_timer() {
    local arm_json armed
    if [ "$1" = "true" ]; then
        arm_json=$(sudo -n /usr/bin/qmanager_tower_schedule_arm install "$2" "$3" "$4" 2>/dev/null)
    else
        arm_json=$(sudo -n /usr/bin/qmanager_tower_schedule_arm teardown 2>/dev/null)
    fi

    TW_ARM_OK=$(printf '%s' "$arm_json" | jq -r '.success // false' 2>/dev/null)
    armed=$(printf '%s' "$arm_json" | jq -r 'if has("armed") then (.armed|tostring) else "false" end' 2>/dev/null)
    TW_ARM_REASON=$(printf '%s' "$arm_json" | jq -r '.reason // ""' 2>/dev/null)
    if [ "$TW_ARM_OK" != "true" ]; then
        qlog_error "Tower schedule timer arm/disarm failed: ${arm_json:-<empty response>}"
    fi
    qlog_info "Tower schedule timer ${1}: apply at ${2}, clear at ${3}, days=${4}, armed=${armed}"
    TW_ARMED="false"
    [ "$armed" = "true" ] && TW_ARMED="true"
    return 0
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
            if [ "$(id -u)" = "0" ]; then
                /usr/bin/qmanager_mtu_set apply >/dev/null 2>&1
            else
                sudo -n /usr/bin/qmanager_mtu_set apply >/dev/null 2>&1
            fi
            if [ $? -eq 0 ]; then
                logger -t qmanager_mtu "Re-applied MTU after interface bounce (was $current_mtu, now $expected_mtu)"
            else
                logger -t qmanager_mtu "MTU re-apply after interface bounce FAILED (was $current_mtu, wanted $expected_mtu)"
            fi
        fi

        # Done — exit regardless of whether we re-applied
        rm -f "$MTU_REAPPLY_PID"
        return 0
    done

    # Timeout — clean up
    logger -t qmanager_mtu "MTU re-apply timed out after ${max_wait}s (interface never came back)"
    rm -f "$MTU_REAPPLY_PID"
}
