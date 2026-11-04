#!/bin/sh
# config_backup_sections.sh — Config Backup section registry and dispatcher.
# Sourced by system/config-backup/collect.sh and /usr/bin/qmanager_config_restore.
# Sections live in config_backup_<group>.sh; contract in docs/reference/config-backup.md.

[ -n "$_CFG_BACKUP_SECTIONS_LOADED" ] && return 0
_CFG_BACKUP_SECTIONS_LOADED=1

export PATH="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"

if [ -f /usr/lib/qmanager/qlog.sh ]; then
    . /usr/lib/qmanager/qlog.sh
else
    qlog_init() { :; }; qlog_debug() { :; }; qlog_info() { :; }; qlog_warn() { :; }; qlog_error() { :; }
fi

CFG_BACKUP_PLATFORM="rm520n"
CFG_BACKUP_FORMAT_VERSION="1.0"
CFG_BACKUP_FORMAT_MAJOR=1

# Fixed apply order. A key with no collect_/apply_ pair in this build (e.g.
# adaptive_polling before P7a) is reported as skipped:not_supported.
CFG_BACKUP_APPLY_ORDER="system alerts quality sites adaptive_polling traffic_engine ethernet custom_dns ttl_mtu sms network_mode bands scenarios tower_lock apn profiles imei ip_passthrough lan watchdog"

# Pairs that must not travel together: the left section rewrites the right ones.
CFG_BACKUP_MUTEX="scenarios:network_mode scenarios:bands profiles:apn profiles:ttl_mtu profiles:imei"

CFG_BACKUP_REBOOT_FLAG="/tmp/qmanager_config_restore.reboot_required"

# Applier return codes.
CFG_RC_OK=0
CFG_RC_RETRY=1
CFG_RC_INCOMPATIBLE=2
CFG_RC_SIM_MISMATCH=3
CFG_RC_INVALID=4

for _cfgbk_f in /usr/lib/qmanager/config_backup_*.sh; do
    [ -f "$_cfgbk_f" ] || continue
    [ "$_cfgbk_f" = "/usr/lib/qmanager/config_backup_sections.sh" ] && continue
    . "$_cfgbk_f"
done
unset _cfgbk_f

cfg_backup_valid_key() {
    case "$1" in
        ''|*[!a-z0-9_]*) return 1 ;;
    esac
    [ "${#1}" -le 32 ]
}

# Known = this build has both halves for the key.
cfg_backup_is_known_section() {
    cfg_backup_valid_key "$1" || return 1
    type "collect_$1" >/dev/null 2>&1 && type "apply_$1" >/dev/null 2>&1
}

cfg_backup_known_sections() {
    local k out=""
    for k in $CFG_BACKUP_APPLY_ORDER; do
        cfg_backup_is_known_section "$k" && out="$out $k"
    done
    echo "${out# }"
}

# cfg_backup_conflict "<space-separated keys>" -> prints the first clashing "a:b", rc 0.
cfg_backup_conflict() {
    local keys=" $1 " pair a b
    for pair in $CFG_BACKUP_MUTEX; do
        a=${pair%%:*}; b=${pair#*:}
        case "$keys" in
            *" $a "*) case "$keys" in *" $b "*) echo "$pair"; return 0 ;; esac ;;
        esac
    done
    return 1
}

cfg_backup_collect() {
    cfg_backup_is_known_section "$1" || { qlog_error "collect: unknown section $1"; return 1; }
    "collect_$1"
}

# cfg_backup_apply <key> <section_json_file>; per-run counters reset here.
cfg_backup_apply() {
    CFG_IGNORED=0
    CFG_DROPPED=0
    CFG_MESSAGE=""
    cfg_backup_is_known_section "$1" || return "$CFG_RC_INCOMPATIBLE"
    jq -e 'type == "object"' "$2" >/dev/null 2>&1 || { CFG_MESSAGE="not an object"; return "$CFG_RC_INVALID"; }
    "apply_$1" "$2"
}

# --- Helpers for section files ---------------------------------------------

# cfg_count_unknown <file> <jq-path> "<known keys>": adds keys outside the list to CFG_IGNORED.
cfg_count_unknown() {
    local n
    n=$(jq -r --arg known " $3 " \
        "($2) as \$o | if (\$o|type) == \"object\" then [\$o | keys[] | . as \$x | select((\$known | contains(\" \" + \$x + \" \")) | not)] | length else 0 end" \
        "$1" 2>/dev/null)
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    CFG_IGNORED=$((CFG_IGNORED + n))
}

cfg_drop() { CFG_DROPPED=$((CFG_DROPPED + ${1:-1})); }

# cfg_has <file> <jq-path>: the backup carries a non-null value there.
cfg_has() { jq -e "($2) != null" "$1" >/dev/null 2>&1; }

# cfg_get <file> <jq-path>: raw value, empty when absent or null.
cfg_get() { jq -r "($2) | if . == null then empty else tostring end" "$1" 2>/dev/null; }

cfg_reboot_required() { : > "$CFG_BACKUP_REBOOT_FLAG" 2>/dev/null; }

# cfg_option <name>: a restore option the browser sent (e.g. imei_confirmed).
cfg_option() { jq -r --arg n "$1" '.options[$n] // empty | tostring' "${CFG_INPUT_FILE:-/tmp/qmanager_config_restore_input.json}" 2>/dev/null; }

# Set by the worker when the backup came from another model.
cfg_foreign_model() { [ "${CFG_FOREIGN_MODEL:-0}" = "1" ]; }

# An AT write the modem rejected: incompatible on a foreign model, retryable otherwise.
cfg_at_failed() {
    CFG_MESSAGE="${1:-modem rejected the command}"
    cfg_foreign_model && return "$CFG_RC_INCOMPATIBLE"
    return "$CFG_RC_RETRY"
}

# cfg_write_file <dest> [mode]: stdin -> same-dir temp -> mv.
cfg_write_file() {
    local dest="$1" mode="${2:-644}" tmp
    tmp="${dest}.cfgbk.$$"
    cat > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
    chmod "$mode" "$tmp" 2>/dev/null
    mv -f "$tmp" "$dest" 2>/dev/null || { rm -f "$tmp"; return 1; }
}
