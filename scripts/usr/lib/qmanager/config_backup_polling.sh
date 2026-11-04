#!/bin/sh
# config_backup_polling.sh — Config Backup section: adaptive_polling (qmanager.conf .poller).

[ -n "$_CFG_BACKUP_POLLING_LOADED" ] && return 0
_CFG_BACKUP_POLLING_LOADED=1

[ -f /usr/lib/qmanager/adaptive_polling.sh ] || return 0
. /usr/lib/qmanager/adaptive_polling.sh

# is_default: the device runs on built-in values (no .poller section).
collect_adaptive_polling() {
    ap_read_json | jq -c '.settings + {is_default: .isDefault}'
}

apply_adaptive_polling() {
    local f="$1" cur en ag ii it di
    cfg_count_unknown "$f" '.' "enabled active_grace idle_interval idle_threshold deep_idle_interval is_default"

    if [ "$(cfg_get "$f" '.is_default')" = "true" ]; then
        jq -e '.poller != null' "$QM_CONFIG" >/dev/null 2>&1 || return "$CFG_RC_OK"
        qm_config_delete_section poller || { CFG_MESSAGE="config write failed"; return "$CFG_RC_RETRY"; }
        touch "$AP_RELOAD_FLAG"
        return "$CFG_RC_OK"
    fi

    # Absent keys keep the device's effective values.
    cur=$(ap_read_json | jq -c '.settings')
    set -- $(jq -n -r --argjson c "$cur" --slurpfile b "$f" '
        ($b[0]) as $b
        | def pick(k): if ($b[k] | type) == "number" or ($b[k] | type) == "boolean"
                       then ($b[k] | tostring) elif $b[k] == null then ($c[k] | tostring) else "-" end;
        [pick("enabled"), pick("active_grace"), pick("idle_interval"),
         pick("idle_threshold"), pick("deep_idle_interval")] | join(" ")')
    en="$1"; ag="$2"; ii="$3"; it="$4"; di="$5"

    if ! ap_validate "$en" "$ag" "$ii" "$it" "$di"; then
        CFG_MESSAGE="$AP_ERR_DETAIL"
        return "$CFG_RC_INVALID"
    fi
    ap_save "$en" "$ag" "$ii" "$it" "$di" || { CFG_MESSAGE="config write failed"; return "$CFG_RC_RETRY"; }
    return "$CFG_RC_OK"
}
