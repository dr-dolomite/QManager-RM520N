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
. /usr/lib/qmanager/radio_validate.sh

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

        tower_lte_cell_args "$c1_earfcn" "$c1_pci" "$c2_earfcn" "$c2_pci" "$c3_earfcn" "$c3_pci"
        num_cells="$TW_NUM_CELLS"
        at_args="$TW_AT_ARGS"

        if [ "$num_cells" -eq 0 ]; then
            cgi_error "no_cells" "At least one EARFCN+PCI pair is required"
            exit 0
        fi

        # Validate ranges
        if ! rv_tower_lte_cells "$c1_earfcn $c2_earfcn $c3_earfcn" "$c1_pci $c2_pci $c3_pci"; then
            cgi_error "$RV_CODE" "$RV_DETAIL"
            exit 0
        fi

        qlog_info "LTE tower lock: $num_cells cell(s) — $at_args"

        if ! tower_do_lte_lock "$c1_earfcn" "$c1_pci" "$c2_earfcn" "$c2_pci" "$c3_earfcn" "$c3_pci"; then
            cgi_error "$TW_ERR_CODE" "$TW_ERR_DETAIL"
            exit 0
        fi
        failover_armed="$TW_FAILOVER_ARMED"
        _fa_persist_failed="$TW_PERSIST_FAILED"

        jq -n --argjson nc "$num_cells" --argjson fa "$failover_armed" \
            --argjson pf "$_fa_persist_failed" \
            '{"success":true,"type":"lte","action":"lock","num_cells":$nc,"failover_armed":$fa,"service_enable_failed":$pf}'

    elif [ "$ACTION" = "unlock" ]; then
        if ! tower_do_lte_unlock; then
            cgi_error "$TW_ERR_CODE" "$TW_ERR_DETAIL"
            exit 0
        fi
        svc_disable_failed="$TW_SVC_DISABLE_FAILED"

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

        # Non-negative integers only (jq tostring yields "-1" / "1.5" for those)
        if ! rv_tower_nr_fields "$nr_pci" "$nr_arfcn" "$nr_band"; then
            cgi_error "$RV_CODE" "$RV_DETAIL"
            exit 0
        fi

        # Validate SCS value
        if ! rv_tower_scs "$nr_scs"; then
            cgi_error "$RV_CODE" "$RV_DETAIL"
            exit 0
        fi

        qlog_info "NR-SA tower lock: PCI=$nr_pci ARFCN=$nr_arfcn SCS=$nr_scs Band=$nr_band"

        if ! tower_do_nr_lock "$nr_pci" "$nr_arfcn" "$nr_scs" "$nr_band"; then
            cgi_error "$TW_ERR_CODE" "$TW_ERR_DETAIL"
            exit 0
        fi
        failover_armed="$TW_FAILOVER_ARMED"
        _fa_persist_failed="$TW_PERSIST_FAILED"

        jq -n --argjson fa "$failover_armed" --argjson pf "$_fa_persist_failed" \
            '{"success":true,"type":"nr_sa","action":"lock","failover_armed":$fa,"service_enable_failed":$pf}'

    elif [ "$ACTION" = "unlock" ]; then
        if ! tower_do_nr_unlock; then
            cgi_error "$TW_ERR_CODE" "$TW_ERR_DETAIL"
            exit 0
        fi
        svc_disable_failed="$TW_SVC_DISABLE_FAILED"

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
