#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/connection_validate.sh
. /usr/lib/qmanager/connection_store.sh
# sms_storage.sh — CGI Endpoint: where incoming SMS are stored (GET + POST)
#
# GET:  {"success":true,"storage":"ME"|"SM","routing":"ME"|"SM"|"",
#        "storages":[{"storage":"ME","used":N,"total":N},{"storage":"SM",...}],
#        "storage_errors":{"SM":"..."}?}
#       storage = the saved choice, routing = the modem's live mem3 ("" if the read failed).
#       A storage whose status read fails is left out of storages and named in storage_errors.
# POST: {"storage":"ME"|"SM"} -> save the choice, apply it, read it back.
#       Errors: invalid_storage, sim_storage_unavailable, sms_unavailable, save_failed,
#       apply_failed (the previous choice is put back).
#
# The choice lives in /etc/qmanager/sms_storage ("ME" or "SM"; missing = ME). qsms (QMI WMS) never
# moves CPMS, so only this CGI, the inbox GET heal and the boot oneshot apply it.
# Changing it does not move existing messages: the inbox keeps reading both storages.

qlog_init "cgi_sms_storage"
cgi_headers
cgi_handle_options

QSMS="$SMS_QSMS"

# =============================================================================
# GET
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    pref=$(conn_sms_pref)

    status_json=$("$QSMS" status all 2>/dev/null)
    storages=$(printf '%s' "$status_json" | jq -c 'if (.storages | type) == "array" then .storages else empty end' 2>/dev/null)
    storage_errors="{}"
    if [ -z "$storages" ]; then
        # The combined read fails as a whole when one store is unusable
        # (typically the SIM), so read each one on its own.
        storages="[]"
        for m in ME SM; do
            one=$("$QSMS" status "$m" 2>/dev/null)
            if printf '%s' "$one" | jq -e '.success == true' >/dev/null 2>&1; then
                storages=$(printf '%s' "$storages" | jq -c --argjson o "$one" '. + [{storage: $o.storage, used: $o.used, total: $o.total}]')
            else
                err=$(printf '%s' "$one" | jq -r 'if .detail == null or .detail == "" then (if .error == null then "unavailable" else .error end) else .detail end' 2>/dev/null)
                storage_errors=$(printf '%s' "$storage_errors" | jq -c --arg m "$m" --arg e "${err:-unavailable}" '. + {($m): $e}')
            fi
        done
    fi

    routing=$(conn_sms_routing)
    case "$routing" in ME|SM) ;; *) routing="" ;; esac

    jq -n --arg storage "$pref" --arg routing "$routing" \
        --argjson storages "$storages" --argjson errs "$storage_errors" \
        '{success: true, storage: $storage, routing: $routing, storages: $storages}
         + (if ($errs | length) > 0 then {storage_errors: $errs} else {} end)'
    exit 0
fi

# =============================================================================
# POST
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    want=$(printf '%s' "$POST_DATA" | jq -r 'if .storage == null then empty else (.storage | tostring) end' 2>/dev/null)
    if ! conn_validate_sms_storage "$want"; then
        cgi_error "$CONN_ERR_CODE" "$CONN_ERR_DETAIL"
        exit 0
    fi

    # Save, apply, read back and roll back on failure: shared with config restore.
    if ! conn_sms_storage_set "$want"; then
        cgi_error "$SMS_ERR_CODE" "$SMS_ERR_DETAIL"
        exit 0
    fi

    jq -n --arg storage "$want" '{success: true, storage: $storage}'
    exit 0
fi

cgi_method_not_allowed
