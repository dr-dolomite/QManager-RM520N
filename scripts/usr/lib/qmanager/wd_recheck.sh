#!/bin/sh
# wd_recheck.sh — primary SIM recheck for qmanager_watchcat: while running on the backup SIM after
# a Tier 3 failover, swap back to the primary every primary_recheck_interval minutes and stay if
# the link is up after the settle. Each try is a real outage; off by default.
# Needs the watchcat's globals and helpers (wait_for_modem, verify_quimslot, svc_*, auto_apply_profile).

[ -n "${_WD_RECHECK_LOADED:-}" ] && return 0
_WD_RECHECK_LOADED=1

WD_RECHECK_MAX_FAILURES=3
WD_RECHECK_LOCK_MAX=300   # longest a lock (the primary's profile apply) may pause a settle

primary_recheck_active="false"
primary_recheck_failures=0
recheck_due_at=0          # wd_mono seconds; 0 = not armed
recheck_return_slot=""
recheck_locked_since=0    # wd_mono of the first locked pass in this recheck; 0 = none

# Start the interval clock from now.
wd_recheck_arm() {
    recheck_due_at=$(( $(wd_mono) + CFG_PRIMARY_RECHECK_INTERVAL * 60 ))
}

# A manual save (config reload) or a boot ends the give-up.
wd_recheck_reset_failures() {
    primary_recheck_failures=0
}

# Seconds until the next try, or "null" when no try is pending.
wd_recheck_next_in() {
    local _l
    if [ "$CFG_PRIMARY_RECHECK_ENABLED" != "1" ] || [ "$sim_failover_active" != "true" ] || \
        [ "$CFG_TIER3_ENABLED" != "1" ] || [ "$recheck_due_at" -eq 0 ] || \
        [ "$primary_recheck_failures" -ge "$WD_RECHECK_MAX_FAILURES" ]; then
        printf 'null'; return 0
    fi
    _l=$((recheck_due_at - $(wd_mono)))
    [ "$_l" -gt 0 ] && printf '%s' "$_l" || printf '0'
}

# rc 0 when a recheck should start on this pass. Arms the clock on first sight of a failover.
wd_recheck_due() {
    [ "$CFG_PRIMARY_RECHECK_ENABLED" = "1" ] || return 1
    [ "$CFG_TIER3_ENABLED" = "1" ] || return 1
    [ "$sim_failover_active" = "true" ] || return 1
    [ "$state" = "monitor" ] || return 1
    [ "$primary_recheck_active" = "false" ] || return 1
    [ "$primary_recheck_failures" -lt "$WD_RECHECK_MAX_FAILURES" ] || return 1
    [ -f "$REVERT_FLAG" ] && return 1
    case "$original_sim_slot" in ''|null|*[!0-9]*) return 1 ;; esac
    if [ "$recheck_due_at" -eq 0 ]; then
        wd_recheck_arm
        return 1
    fi
    [ "$(wd_mono)" -ge "$recheck_due_at" ]
}

# Golden Rule swap to <slot>, verified. rc 0 landed, rc 1 not confirmed.
wd_recheck_swap() {
    # wait_for_modem can outlast the normal stale window: publish a long one first.
    write_state 600
    qcmd 'AT+CFUN=0' >/dev/null 2>&1
    sleep 2
    qcmd "AT+QUIMSLOT=$1" >/dev/null 2>&1
    sleep 2
    qcmd 'AT+CFUN=1' >/dev/null 2>&1
    wait_for_modem || return 1
    verify_quimslot "$1" >/dev/null 2>&1
}

wd_recheck_iccid() {
    qcmd 'AT+QCCID' 2>/dev/null | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r '
}

# Blind swap back to the primary, apply its profile, then settle; finish_cooldown judges it.
wd_recheck_start() {
    local _iccid
    recheck_return_slot="$current_sim_slot"
    printf '%s\n' "$$" > "$RECOVERY_FLAG" 2>/dev/null || touch "$RECOVERY_FLAG"
    qlog_info "PRIMARY RECHECK: trying primary slot $original_sim_slot (try $((primary_recheck_failures + 1))/$WD_RECHECK_MAX_FAILURES)"
    append_event "sim_failover" "Checking the primary SIM in slot $original_sim_slot" "info"

    if ! wd_recheck_swap "$original_sim_slot"; then
        # Where did it land? On the primary: settle as planned. Anywhere else: count a failure.
        if verify_quimslot "$original_sim_slot" >/dev/null 2>&1; then
            qlog_warn "PRIMARY RECHECK: modem slow after the swap but on slot $original_sim_slot"
        else
            qlog_error "PRIMARY RECHECK: swap to slot $original_sim_slot not confirmed, staying on the backup"
            wd_recheck_return keep_profile
            return
        fi
    fi

    current_sim_slot="$original_sim_slot"
    _iccid=$(wd_recheck_iccid)
    [ -n "$_iccid" ] || _iccid="$original_sim_iccid"
    # Before the verdict: the primary may need its own APN to come up at all.
    [ -n "$_iccid" ] && auto_apply_profile "$_iccid" "watchdog_failback"

    primary_recheck_active="true"
    recovery_reason="recheck"
    recheck_locked_since=0
    cooldown_stale_retries=0
    cooldown_remaining="$SIM_SETTLE_SECS"
    state="cooldown"
    qlog_info "PRIMARY RECHECK: settling ${SIM_SETTLE_SECS}s on slot $original_sim_slot"
}

# Settle verdict. Called by finish_cooldown while primary_recheck_active is true.
wd_recheck_finish() {
    if ! conn_state_read; then
        if [ "$cooldown_stale_retries" -lt 3 ]; then
            cooldown_stale_retries=$((cooldown_stale_retries + 1))
            qlog_warn "PRIMARY RECHECK: ping data stale ($(conn_state_why)), retry $cooldown_stale_retries/3"
            cooldown_remaining="$CFG_CHECK_INTERVAL"
            printf '%s\n' "$$" > "$RECOVERY_FLAG" 2>/dev/null || touch "$RECOVERY_FLAG"
            return
        fi
    elif conn_state_is_up; then
        cooldown_stale_retries=0
        primary_recheck_active="false"
        wd_recheck_failback
        return
    fi
    cooldown_stale_retries=0
    primary_recheck_active="false"
    qlog_warn "PRIMARY RECHECK: primary slot $original_sim_slot still down, returning to slot $recheck_return_slot"
    wd_recheck_give_back
}

# One locked pass during a settle. rc 0 = keep waiting; rc 1 = waited too long, gave the try up.
wd_recheck_locked_wait() {
    local _now
    _now=$(wd_mono)
    [ "$recheck_locked_since" -gt 0 ] || recheck_locked_since="$_now"
    [ $((_now - recheck_locked_since)) -lt "$WD_RECHECK_LOCK_MAX" ] && return 0
    qlog_warn "PRIMARY RECHECK: locked for ${WD_RECHECK_LOCK_MAX}s during the settle, returning to slot $recheck_return_slot"
    cooldown_stale_retries=0
    primary_recheck_active="false"
    wd_recheck_give_back
    return 1
}

# Swap back to the backup slot after a failed try; owns the stuck-on-primary and unknown-slot cases.
wd_recheck_give_back() {
    if wd_recheck_swap "$recheck_return_slot"; then
        wd_recheck_return
        return
    fi
    if verify_quimslot "$original_sim_slot" >/dev/null 2>&1; then
        # Stuck on the primary: own it, and let the normal ladder judge the link from here.
        qlog_warn "PRIMARY RECHECK: return to slot $recheck_return_slot not confirmed, keeping the primary"
        wd_recheck_failback
        return
    fi
    qlog_error "PRIMARY RECHECK: slot unknown after the return to slot $recheck_return_slot"
    append_event "sim_failover" "Could not confirm the SIM slot after checking the primary SIM" "error"
    current_sim_slot="$recheck_return_slot"
    wd_recheck_return
}

# Stay on the primary for good: drop the failover record, give the tower locks back.
wd_recheck_failback() {
    local _iccid
    qlog_info "PRIMARY RECHECK: primary SIM healthy, staying on slot $original_sim_slot"
    append_event "sim_failover" "Switched back to the primary SIM in slot $original_sim_slot" "info"
    rm -f "$SIM_FAILOVER_FILE" "$RECOVERY_FLAG"
    _iccid=$(wd_recheck_iccid)
    sim_db_seed_if_absent >/dev/null 2>&1
    [ -n "$_iccid" ] && sim_db_add "$_iccid"
    svc_start qmanager_tower_failover
    current_sim_slot="$original_sim_slot"
    sim_failover_active="false"
    original_sim_slot="null"
    original_sim_iccid=""
    primary_recheck_failures=0
    recheck_due_at=0
    state="monitor"; current_tier=0; failure_counter=0
}

# Back on the backup (or never left it): re-save the record, count the failure, re-arm.
# keep_profile: the primary's profile never went on, so there is nothing to undo.
wd_recheck_return() {
    local _iccid _ts
    current_sim_slot="$recheck_return_slot"
    _iccid=$(wd_recheck_iccid)
    _ts=$(date +%s)
    jq -n -c --argjson orig "$original_sim_slot" --argjson curr "$current_sim_slot" \
        --argjson ts "$_ts" --arg reason "connectivity_failure" \
        --arg orig_iccid "$original_sim_iccid" --arg iccid "$_iccid" \
        '{active:true, original_slot:$orig, current_slot:$curr, switched_at:$ts, reason:$reason, original_iccid:$orig_iccid, current_iccid:$iccid}' \
        > "${SIM_FAILOVER_FILE}.tmp" && mv "${SIM_FAILOVER_FILE}.tmp" "$SIM_FAILOVER_FILE"
    # The primary's profile went on for the try; put the backup's back.
    [ "$1" != "keep_profile" ] && [ -n "$_iccid" ] && auto_apply_profile "$_iccid" "watchdog"
    primary_recheck_failures=$((primary_recheck_failures + 1))
    if [ "$primary_recheck_failures" -ge "$WD_RECHECK_MAX_FAILURES" ]; then
        qlog_warn "PRIMARY RECHECK: $primary_recheck_failures tries failed, stopping until the next save or boot"
        append_event "sim_failover" "Primary SIM still down after $primary_recheck_failures checks, staying on the backup SIM" "warning"
    else
        append_event "sim_failover" "Primary SIM still down, back on slot $current_sim_slot" "warning"
    fi
    wd_recheck_arm
    rm -f "$RECOVERY_FLAG"
    state="monitor"; current_tier=0; failure_counter=0
}
