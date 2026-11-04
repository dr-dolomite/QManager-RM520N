#!/bin/sh
# system_validate.sh — System Settings, scheduled reboot, update prefs and Tailscale SSH flag:
# validators and save paths shared by system/settings.sh, system/update.sh, vpn/tailscale.sh
# and Config Backup (config_backup_system.sh). Needs qlog, config.sh and platform.sh loaded.

[ -n "$_SYSTEM_VALIDATE_LOADED" ] && return 0
_SYSTEM_VALIDATE_LOADED=1

[ -f /usr/lib/qmanager/config.sh ] && . /usr/lib/qmanager/config.sh

# --- Units and schedule fields -----------------------------------------------

qm_valid_temp_unit() {
    case "$1" in celsius|fahrenheit) return 0 ;; esac
    return 1
}

qm_valid_distance_unit() {
    case "$1" in km|miles) return 0 ;; esac
    return 1
}

# qm_valid_hhmm <HH:MM> — 24-hour clock (case, not grep -E: BusyBox grep rc 2 looks like no-match).
qm_valid_hhmm() {
    case "$1" in
        [01][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) return 0 ;;
    esac
    return 1
}

# qm_sched_days_check <csv> — 0 ok, 1 empty, 2 a day outside 0-6.
qm_sched_days_check() {
    local d invalid_day=""
    [ -n "$1" ] || return 1
    for d in $(printf '%s' "$1" | tr ',' ' '); do
        case "$d" in
            0|1|2|3|4|5|6) ;;
            *) invalid_day="$d" ;;
        esac
    done
    [ -z "$invalid_day" ] || return 2
    return 0
}

# --- Scheduled reboot ---------------------------------------------------------

# qm_sched_reboot_save <true|false> <HH:MM> <days csv> — config write, then arm/disarm the timer
# through the root helper. Sets QM_ARM_JSON/OK/ARMED/REASON; rc 1 when the helper did not report success.
qm_sched_reboot_save() {
    local enabled="$1" sched_time="$2" days="$3"
    case "$enabled" in
        true)  qm_config_set settings sched_reboot_enabled 1 ;;
        false) qm_config_set settings sched_reboot_enabled 0 ;;
    esac
    qm_config_set settings sched_reboot_time "$sched_time"
    qm_config_set settings sched_reboot_days "$days"

    # The helper re-validates time/days itself before they reach a generated .timer file.
    if [ "$enabled" = "true" ]; then
        QM_ARM_JSON=$(sudo -n /usr/bin/qmanager_scheduled_reboot_arm install "$sched_time" "$days" 2>/dev/null)
    else
        QM_ARM_JSON=$(sudo -n /usr/bin/qmanager_scheduled_reboot_arm teardown 2>/dev/null)
    fi

    QM_ARM_OK=$(printf '%s' "$QM_ARM_JSON" | jq -r '.success // false' 2>/dev/null)
    QM_ARM_ARMED=$(printf '%s' "$QM_ARM_JSON" | jq -r 'if has("armed") then (.armed|tostring) else "false" end' 2>/dev/null)
    QM_ARM_REASON=$(printf '%s' "$QM_ARM_JSON" | jq -r '.reason // ""' 2>/dev/null)
    if [ "$QM_ARM_OK" != "true" ]; then
        qlog_error "Scheduled reboot timer arm/disarm failed: ${QM_ARM_JSON:-<empty response>}"
    fi
    qlog_info "Scheduled reboot timer ${enabled}: ${sched_time} days=${days} armed=${QM_ARM_ARMED}"
    [ "$QM_ARM_OK" = "true" ]
}

# --- Software update preferences ---------------------------------------------

# qm_update_save_prerelease <true|false> — rc 1 on any other value.
qm_update_save_prerelease() {
    qm_config_init
    case "$1" in
        true)  qm_config_set update include_prerelease 1 ;;
        false) qm_config_set update include_prerelease 0 ;;
        *) return 1 ;;
    esac
}

# qm_update_save_auto <true|false> <HH:MM> — config write, then arm/disarm the auto-update timer live.
# A helper failure is logged and returned as rc 1; the config write is the source of truth.
qm_update_save_auto() {
    local enabled="$1" auto_time="$2" arm_rc=0
    qm_config_init
    case "$enabled" in
        true)  qm_config_set update auto_update_enabled 1 ;;
        false) qm_config_set update auto_update_enabled 0 ;;
    esac
    qm_config_set update auto_update_time "$auto_time"

    if [ "$enabled" = "true" ]; then
        sudo -n /usr/bin/qmanager_auto_update_arm on >/dev/null 2>&1 \
            || { logger -t update "auto_update_arm on failed (non-fatal)"; arm_rc=1; }
    else
        sudo -n /usr/bin/qmanager_auto_update_arm off >/dev/null 2>&1 \
            || { logger -t update "auto_update_arm off failed (non-fatal)"; arm_rc=1; }
    fi
    return "$arm_rc"
}

# --- Tailscale SSH intent flag ------------------------------------------------

: "${SSH_PREF_FILE:=/etc/qmanager/tailscale_ssh}"
: "${TAILSCALE_BIN:=/usrdata/tailscale/tailscale}"

# qm_ts_ssh_pref — prints true/false; anything but "1" in the flag file (or no file) is false.
qm_ts_ssh_pref() {
    if [ -f "$SSH_PREF_FILE" ] && [ "$(cat "$SSH_PREF_FILE" 2>/dev/null | tr -d ' \n\r')" = "1" ]; then
        echo "true"
    else
        echo "false"
    fi
}

# qm_ts_ssh_save <true|false> — atomic flag write, then `tailscale set --ssh=` when the daemon is up
# (rolled back on failure). Sets QM_TS_PENDING (1 = daemon stopped, applies on next connect). On failure
# QM_TS_ERR (write_failed|set_failed) + QM_TS_DETAIL and rc 1. Without Tailscale installed only the flag is kept.
qm_ts_ssh_save() {
    local ssh_value="$1" new_flag old_flag="" tmp_file set_output
    QM_TS_ERR=""
    QM_TS_DETAIL=""
    QM_TS_PENDING=0
    case "$ssh_value" in
        true)  new_flag="1" ;;
        false) new_flag="0" ;;
        *) return 1 ;;
    esac

    # Snapshot previous flag for rollback on `tailscale set` failure.
    if [ -f "$SSH_PREF_FILE" ]; then
        old_flag=$(cat "$SSH_PREF_FILE" 2>/dev/null | tr -d ' \n\r')
    fi

    # Atomic write: .tmp + mv (matches the convention in email/sms alert configs).
    mkdir -p /etc/qmanager 2>/dev/null
    tmp_file="${SSH_PREF_FILE}.tmp"
    if ! printf '%s\n' "$new_flag" > "$tmp_file"; then
        rm -f "$tmp_file"
        QM_TS_ERR="write_failed"; QM_TS_DETAIL="Could not write SSH preference file"
        return 1
    fi
    if ! mv -f "$tmp_file" "$SSH_PREF_FILE"; then
        rm -f "$tmp_file"
        QM_TS_ERR="write_failed"; QM_TS_DETAIL="Could not persist SSH preference (filesystem error)"
        return 1
    fi

    # Daemon up: apply immediately. Otherwise the caller reports "applies on next connect".
    if svc_is_running "tailscaled"; then
        set_output=$($_SUDO "$TAILSCALE_BIN" set --ssh="$ssh_value" 2>&1)
        if [ $? -ne 0 ]; then
            # Roll back the flag write so the UI state matches reality.
            if [ -n "$old_flag" ]; then
                printf '%s\n' "$old_flag" > "$SSH_PREF_FILE"
            else
                rm -f "$SSH_PREF_FILE"
            fi
            qlog_error "tailscale set --ssh=$ssh_value failed: $set_output"
            QM_TS_ERR="set_failed"; QM_TS_DETAIL="$set_output"
            return 1
        fi
        qlog_info "Tailscale SSH set to $ssh_value"
    else
        QM_TS_PENDING=1
        qlog_info "Tailscale SSH preference set to $ssh_value (daemon stopped, will apply on next connect)"
    fi
    return 0
}

# --- Applier-side checks (Config Backup only; the CGIs leave these to their root helpers) ---

# qm_valid_tz_string <posix TZ> — e.g. PST8PDT,M3.2.0,M11.1.0 or <+08>-8; at most 64 chars.
qm_valid_tz_string() {
    [ -n "$1" ] && [ "${#1}" -le 64 ] || return 1
    case "$1" in *[!A-Za-z0-9,.:/+\<\>-]*) return 1 ;; esac
    return 0
}

# qm_valid_zonename <IANA name> — the same gate qmanager_timezone_apply enforces.
qm_valid_zonename() {
    [ -n "$1" ] && [ "${#1}" -le 64 ] || return 1
    case "$1" in *..*) return 1 ;; esac
    case "$1" in [A-Za-z]*) ;; *) return 1 ;; esac
    case "$1" in *[!A-Za-z0-9._+/-]*) return 1 ;; esac
    return 0
}

# qm_valid_hostname_label <name> — display name: 1-64 characters (UTF-8 allowed), no control bytes.
# Characters = bytes minus UTF-8 continuation bytes; [:print:] would reject all non-ASCII.
qm_valid_hostname_label() {
    [ -n "$1" ] || return 1
    case "$1" in *[[:cntrl:]]*) return 1 ;; esac
    [ "$(printf '%s' "$1" | LC_ALL=C tr -d '\200-\277' | wc -c)" -le 64 ]
}
