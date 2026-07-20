#!/bin/sh
# =============================================================================
# slot_verify.sh — QUIMSLOT Read-Back Verification (shared library)
# =============================================================================
# AT+QUIMSLOT=N can return OK while the modem silently stays on the old slot
# under qcmd lock contention — a write is not trusted until a read-back
# agrees. This lib centralizes that poll so both qmanager_watchcat (Tier-3
# failover/revert) and the cellular settings CGI can gate on the same logic
# instead of duplicating it.
#
# Public API:
#   verify_quimslot <expected_slot>
#       Polls AT+QUIMSLOT? up to 10x (1s apart) until the ACTIVE slot equals
#       <expected_slot>. Prints "1" and returns 0 once verified; prints
#       nothing and returns 1 if it never matches within the poll budget.
#       An EMPTY read (qcmd lock timeout / no response) counts as
#       NOT-yet-matched — never as a false success.
#
# Dependencies: qcmd must be available in the sourcing environment (PATH),
# same assumption as the other qmanager libs.
# Install location: /usr/lib/qmanager/slot_verify.sh
# =============================================================================

[ -n "$_SLOT_VERIFY_LOADED" ] && return 0
_SLOT_VERIFY_LOADED=1

# verify_quimslot <expected_slot>
verify_quimslot() {
    local _vq_want
    local _vq_i
    local _vq_cur
    _vq_want="$1"
    _vq_i=1
    while [ "$_vq_i" -le 10 ]; do
        _vq_cur=$(qcmd 'AT+QUIMSLOT?' 2>/dev/null | grep '+QUIMSLOT:' | head -1 | sed 's/+QUIMSLOT: //' | tr -d ' \r')
        if [ "$_vq_cur" = "$_vq_want" ]; then
            printf '1'
            return 0
        fi
        sleep 1
        _vq_i=$((_vq_i + 1))
    done
    return 1
}
