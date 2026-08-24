#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/platform.sh
# =============================================================================
# lock.sh — CGI Endpoint: Apply/Clear Tower Lock
# =============================================================================
# Handles tower lock and unlock operations for both LTE and NR-SA.
# On successful lock, updates config file and spawns failover watcher.
# On unlock, updates config and kills any running watcher.
#
# NOTE: Cell lock commands may disconnect the modem for 3-5 seconds
# before reconnecting. The failover watcher accounts for this with a
# 20-second settle delay.
#
# POST body examples:
#   LTE lock:   {"type":"lte","action":"lock","cells":[{"earfcn":1300,"pci":123},{"earfcn":1850,"pci":456}]}
#   LTE unlock: {"type":"lte","action":"unlock"}
#   NR-SA lock: {"type":"nr_sa","action":"lock","pci":901,"arfcn":504990,"scs":30,"band":41}
#   NR-SA unlock: {"type":"nr_sa","action":"unlock"}
#
# Endpoint: POST /cgi-bin/quecmanager/tower/lock.sh
# Install location: /www/cgi-bin/quecmanager/tower/lock.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_tower_lock"
cgi_headers
cgi_handle_options

# --- Load library ------------------------------------------------------------
. /usr/lib/qmanager/tower_lock_mgr.sh 2>/dev/null

# --- Validate method ---------------------------------------------------------
if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_error "method_not_allowed" "Use POST"
    exit 0
fi

# --- Read POST body ----------------------------------------------------------
cgi_read_post

# --- Parse common fields using jq --------------------------------------------
LOCK_TYPE=$(printf '%s' "$POST_DATA" | jq -r '.type // empty' 2>/dev/null)
ACTION=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)

if [ -z "$LOCK_TYPE" ]; then
    cgi_error "no_type" "Missing type field (lte or nr_sa)"
    exit 0
fi

if [ -z "$ACTION" ]; then
    cgi_error "no_action" "Missing action field (lock or unlock)"
    exit 0
fi

# --- Ensure config exists ----------------------------------------------------
tower_config_init

# =============================================================================
# LTE Lock/Unlock
# =============================================================================
if [ "$LOCK_TYPE" = "lte" ]; then

    if [ "$ACTION" = "lock" ]; then
        # --- Parse cells array from POST data using jq ---
        c1_earfcn=$(printf '%s' "$POST_DATA" | jq -r '(.cells[0].earfcn) | if . == null then empty else tostring end' 2>/dev/null)
        c1_pci=$(printf '%s' "$POST_DATA" | jq -r '(.cells[0].pci) | if . == null then empty else tostring end' 2>/dev/null)
        c2_earfcn=$(printf '%s' "$POST_DATA" | jq -r '(.cells[1].earfcn) | if . == null then empty else tostring end' 2>/dev/null)
        c2_pci=$(printf '%s' "$POST_DATA" | jq -r '(.cells[1].pci) | if . == null then empty else tostring end' 2>/dev/null)
        c3_earfcn=$(printf '%s' "$POST_DATA" | jq -r '(.cells[2].earfcn) | if . == null then empty else tostring end' 2>/dev/null)
        c3_pci=$(printf '%s' "$POST_DATA" | jq -r '(.cells[2].pci) | if . == null then empty else tostring end' 2>/dev/null)

        # Count valid cells
        num_cells=0
        at_args=""
        if [ -n "$c1_earfcn" ] && [ -n "$c1_pci" ]; then
            num_cells=$((num_cells + 1))
            at_args="$c1_earfcn $c1_pci"
        fi
        if [ -n "$c2_earfcn" ] && [ -n "$c2_pci" ]; then
            num_cells=$((num_cells + 1))
            at_args="$at_args $c2_earfcn $c2_pci"
        fi
        if [ -n "$c3_earfcn" ] && [ -n "$c3_pci" ]; then
            num_cells=$((num_cells + 1))
            at_args="$at_args $c3_earfcn $c3_pci"
        fi

        if [ "$num_cells" -eq 0 ]; then
            cgi_error "no_cells" "At least one EARFCN+PCI pair is required"
            exit 0
        fi

        # Validate ranges
        for val in $c1_earfcn $c2_earfcn $c3_earfcn; do
            [ -z "$val" ] && continue
            case "$val" in
                *[!0-9]*) cgi_error "invalid_earfcn" "EARFCN must be numeric"; exit 0 ;;
            esac
        done
        for val in $c1_pci $c2_pci $c3_pci; do
            [ -z "$val" ] && continue
            case "$val" in
                *[!0-9]*) cgi_error "invalid_pci" "PCI must be numeric"; exit 0 ;;
            esac
            if [ "$val" -gt 503 ]; then
                cgi_error "invalid_pci" "PCI must be 0-503"
                exit 0
            fi
        done

        qlog_info "LTE tower lock: $num_cells cell(s) — $at_args"

        # Mark this write in-flight BEFORE the AT command, so an existing
        # failover watcher (already running, possibly mid-cycle with a
        # nonzero bad-reading counter) skips its next cycle instead of
        # misreading this write's reconnect blip as a bad sample and
        # reverting the lock ~20s later. See TOWER_WRITE_INFLIGHT in
        # tower_lock_mgr.sh for why this is a self-expiring marker rather
        # than a stop/respawn of the watcher itself — stopping it here would
        # open error-exit paths that could leave NO watcher running at all,
        # which is worse than the blip it would guard against.
        tower_write_begin

        # Send AT command
        result=$(tower_lock_lte "$num_cells" $at_args)
        rc=$?

        if [ $rc -ne 0 ] || [ -z "$result" ]; then
            qlog_error "LTE tower lock failed (rc=$rc)"
            cgi_error "modem_error" "Failed to send tower lock command"
            exit 0
        fi

        case "$result" in
            *ERROR*)
                qlog_error "LTE tower lock AT ERROR: $result"
                cgi_error "at_error" "Modem rejected tower lock command"
                exit 0
                ;;
        esac

        qlog_info "LTE tower lock applied successfully"

        # Re-apply custom MTU after interface bounce
        mtu_reapply_after_bounce

        # Update config file. Failover stays at whatever the user set in
        # Tower Settings — locking does not implicitly enable it.
        tower_config_update_lte "true" "$c1_earfcn" "$c1_pci" "$c2_earfcn" "$c2_pci" "$c3_earfcn" "$c3_pci"

        # Spawn failover watcher (no-op if failover.enabled is false).
        # rc 2 = daemon is live but svc_enable failed, so failover will NOT
        # survive a reboot. Report it — the printed boolean only describes the
        # running daemon and would otherwise hide the lost persistence.
        failover_armed=$(tower_spawn_failover_watcher); _fa_rc=$?
        _fa_persist_failed="false"
        [ "$_fa_rc" = "2" ] && _fa_persist_failed="true"

        jq -n --argjson nc "$num_cells" --argjson fa "$failover_armed" \
            --argjson pf "$_fa_persist_failed" \
            '{"success":true,"type":"lte","action":"lock","num_cells":$nc,"failover_armed":$fa,"service_enable_failed":$pf}'

    elif [ "$ACTION" = "unlock" ]; then
        # Kill failover watcher BEFORE sending unlock AT command.
        # During the 3-5s modem disconnect from unlock, the daemon could
        # misdetect "no signal" and clear ALL locks (including NR if active).
        fo_was_enabled=$(tower_config_get ".failover.enabled")
        tower_kill_failover_watcher
        # NOT `rm -f "$TOWER_FAILOVER_FLAG"` here — this CGI runs as
        # www-data, and the flag is written by the ROOT failover daemon
        # into sticky /tmp. www-data can never unlink a root-owned file
        # from a sticky directory (EPERM), and `rm -f` swallows that and
        # exits 0, so the failure is invisible — this line looked like
        # cleanup but never actually cleared anything. The flag's real
        # lifecycle is the unit's ExecStartPre, which clears it on the
        # next `systemctl start qmanager-tower-failover` (tower_spawn_
        # failover_watcher below does exactly that when a lock remains).
        # Leaving a fired failover's flag in place until then is
        # deliberate — it's the observable trace that a failover happened.

        result=$(tower_unlock_lte)
        rc=$?

        if [ $rc -ne 0 ] || [ -z "$result" ]; then
            qlog_error "LTE tower unlock failed (rc=$rc)"
            cgi_error "modem_error" "Failed to clear tower lock"
            exit 0
        fi

        case "$result" in
            *ERROR*)
                qlog_error "LTE tower unlock AT ERROR: $result"
                cgi_error "at_error" "Modem rejected unlock command"
                exit 0
                ;;
        esac

        qlog_info "LTE tower lock cleared"

        # Re-apply custom MTU after interface bounce
        mtu_reapply_after_bounce

        # Update config — preserve ALL cell data, just set enabled=false
        tower_config_update '.lte.enabled = false'

        # Check if other lock remains active
        nr_active=$(tower_config_get ".nr_sa.enabled")
        # The unlock AT command already succeeded above — a failure to disable
        # the boot-persistence unit below is a partial-success warning, not a
        # request failure. Ride it on a sibling field (mirrors
        # service_enable_failed on the lock branches and
        # TowerSettingsResponse.service_disable_failed from settings.sh) so
        # `success` keeps meaning "the endpoint did what it says", never
        # laundering a confirmed unlock into an apparent failure via cgi_error.
        svc_disable_failed="false"
        if [ "$nr_active" = "true" ] && [ "$fo_was_enabled" = "true" ]; then
            # NR lock still active with failover — respawn watcher for it
            tower_spawn_failover_watcher >/dev/null
            qlog_info "NR lock still active — failover watcher respawned"
        else
            # No other lock — disable failover fully
            tower_config_update '.failover.enabled = false'
            if ! svc_disable qmanager_tower_failover; then
                svc_disable_failed="true"
                qlog_warn "svc_disable qmanager_tower_failover failed after LTE unlock (rootfs may be read-only)"
            else
                qlog_info "No active locks — failover stopped and disabled"
            fi
        fi

        jq -n --argjson sdf "$svc_disable_failed" \
            '{"success":true,"type":"lte","action":"unlock","service_disable_failed":$sdf}'
    else
        cgi_error "invalid_action" "action must be lock or unlock"
        exit 0
    fi

# =============================================================================
# NR-SA Lock/Unlock
# =============================================================================
elif [ "$LOCK_TYPE" = "nr_sa" ]; then

    if [ "$ACTION" = "lock" ]; then
        nr_pci=$(printf '%s' "$POST_DATA" | jq -r '(.pci) | if . == null then empty else tostring end' 2>/dev/null)
        nr_arfcn=$(printf '%s' "$POST_DATA" | jq -r '(.arfcn) | if . == null then empty else tostring end' 2>/dev/null)
        nr_scs=$(printf '%s' "$POST_DATA" | jq -r '(.scs) | if . == null then empty else tostring end' 2>/dev/null)
        nr_band=$(printf '%s' "$POST_DATA" | jq -r '(.band) | if . == null then empty else tostring end' 2>/dev/null)

        # Validate all fields present
        if [ -z "$nr_pci" ] || [ -z "$nr_arfcn" ] || [ -z "$nr_scs" ] || [ -z "$nr_band" ]; then
            cgi_error "missing_fields" "NR-SA lock requires pci, arfcn, scs, and band"
            exit 0
        fi

        # Validate SCS value
        case "$nr_scs" in
            15|30|60|120|240) ;;  # Valid SCS kHz values
            *)
                cgi_error "invalid_scs" "SCS must be 15, 30, 60, 120, or 240 kHz"
                exit 0
                ;;
        esac

        qlog_info "NR-SA tower lock: PCI=$nr_pci ARFCN=$nr_arfcn SCS=$nr_scs Band=$nr_band"

        # Mark this write in-flight — see the matching comment in the LTE
        # lock branch above for why.
        tower_write_begin

        result=$(tower_lock_nr "$nr_pci" "$nr_arfcn" "$nr_scs" "$nr_band")
        rc=$?

        if [ $rc -ne 0 ] || [ -z "$result" ]; then
            qlog_error "NR-SA tower lock failed (rc=$rc)"
            cgi_error "modem_error" "Failed to send NR tower lock command"
            exit 0
        fi

        case "$result" in
            *ERROR*)
                qlog_error "NR-SA tower lock AT ERROR: $result"
                cgi_error "at_error" "Modem rejected NR tower lock command"
                exit 0
                ;;
        esac

        qlog_info "NR-SA tower lock applied successfully"

        # Re-apply custom MTU after interface bounce
        mtu_reapply_after_bounce

        # Update config. Failover stays at whatever the user set in
        # Tower Settings — locking does not implicitly enable it.
        tower_config_update_nr "true" "$nr_pci" "$nr_arfcn" "$nr_scs" "$nr_band"

        # Spawn failover watcher (no-op if failover.enabled is false).
        # rc 2 = daemon live but boot-persistence lost — see the LTE branch.
        failover_armed=$(tower_spawn_failover_watcher); _fa_rc=$?
        _fa_persist_failed="false"
        [ "$_fa_rc" = "2" ] && _fa_persist_failed="true"

        jq -n --argjson fa "$failover_armed" --argjson pf "$_fa_persist_failed" \
            '{"success":true,"type":"nr_sa","action":"lock","failover_armed":$fa,"service_enable_failed":$pf}'

    elif [ "$ACTION" = "unlock" ]; then
        # Kill failover watcher BEFORE sending unlock AT command.
        # During the 3-5s modem disconnect from unlock, the daemon could
        # misdetect "no signal" and clear ALL locks (including LTE if active).
        fo_was_enabled=$(tower_config_get ".failover.enabled")
        tower_kill_failover_watcher
        # NOT `rm -f "$TOWER_FAILOVER_FLAG"` here — see the matching
        # comment in the LTE unlock branch above. www-data cannot unlink a
        # root-owned file in sticky /tmp (rm -f exits 0 anyway, hiding the
        # failure); the flag now clears only via the unit's ExecStartPre
        # on its next start.

        result=$(tower_unlock_nr)
        rc=$?

        if [ $rc -ne 0 ] || [ -z "$result" ]; then
            qlog_error "NR-SA tower unlock failed (rc=$rc)"
            cgi_error "modem_error" "Failed to clear NR tower lock"
            exit 0
        fi

        case "$result" in
            *ERROR*)
                qlog_error "NR-SA tower unlock AT ERROR: $result"
                cgi_error "at_error" "Modem rejected NR unlock command"
                exit 0
                ;;
        esac

        qlog_info "NR-SA tower lock cleared"

        # Re-apply custom MTU after interface bounce
        mtu_reapply_after_bounce

        # Update config — preserve ALL NR params, just set enabled=false
        tower_config_update '.nr_sa.enabled = false'

        # Check if other lock remains active
        lte_active=$(tower_config_get ".lte.enabled")
        # See the matching comment in the LTE unlock branch above — the
        # unlock AT command already succeeded, so a persistence-disable
        # failure rides on a sibling field instead of flipping success:false.
        svc_disable_failed="false"
        if [ "$lte_active" = "true" ] && [ "$fo_was_enabled" = "true" ]; then
            # LTE lock still active with failover — respawn watcher for it
            tower_spawn_failover_watcher >/dev/null
            qlog_info "LTE lock still active — failover watcher respawned"
        else
            # No other lock — disable failover fully
            tower_config_update '.failover.enabled = false'
            if ! svc_disable qmanager_tower_failover; then
                svc_disable_failed="true"
                qlog_warn "svc_disable qmanager_tower_failover failed after NR-SA unlock (rootfs may be read-only)"
            else
                qlog_info "No active locks — failover stopped and disabled"
            fi
        fi

        jq -n --argjson sdf "$svc_disable_failed" \
            '{"success":true,"type":"nr_sa","action":"unlock","service_disable_failed":$sdf}'
    else
        cgi_error "invalid_action" "action must be lock or unlock"
        exit 0
    fi

else
    cgi_error "invalid_type" "type must be lte or nr_sa"
    exit 0
fi
