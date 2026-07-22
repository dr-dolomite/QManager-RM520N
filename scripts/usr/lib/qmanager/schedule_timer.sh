#!/bin/sh
# schedule_timer.sh — Shared OnCalendar line generator + input validation for
# the runtime-armed systemd timers that replace RM520N's dead crond.
#
# RM520N-GL ships a crond BINARY but no daemon runs it (no unit, no boot
# symlink, empty world-writable /var/spool/cron/crontabs/) — so any feature
# that used to printf a cron line was silently a no-op. Scheduled Reboot and
# the Tower Lock schedule both need a single fixed "day-mask + HH:MM,
# recurring weekly" trigger — simpler than the Connection Scenario schedule's
# multi-block/default-restore timeline (see scenario_mgr.sh's
# _scenario_generate_oncalendar_lines, which solves a materially different
# problem and is intentionally NOT reused here — see the arm helpers' headers
# for why duplicating that algorithm would be over-fitting a one-line need).
#
# Sourced by root helpers only (qmanager_scheduled_reboot_arm,
# qmanager_tower_schedule_arm) — never by a CGI script directly. Those
# helpers are sudo-reachable from www-data, so every value passed to
# _qm_oncalendar_line MUST be validated with _qm_validate_hhmm /
# _qm_validate_days FIRST — this library does not re-validate internally.

[ -n "$_SCHEDULE_TIMER_LOADED" ] && return 0
_SCHEDULE_TIMER_LOADED=1

# _qm_validate_hhmm <value>
# Charset-gate THEN shape-check a caller-supplied time-of-day value before it
# is ever interpolated into a generated .timer unit's OnCalendar= line.
#
# TWO gates, in order:
#   1. Charset reject: '*[!0-9:]*' rejects ANY byte outside [0-9:] anywhere
#      in the value — including whitespace, shell metacharacters, and a
#      NEWLINE. This bracket-negation form matches across the whole string
#      (case pattern matching, not line-based regex), so a value whose FIRST
#      line looks like "04:00" but carries a smuggled newline + extra
#      OnCalendar=/ExecStart=/etc. directive on a second line is still
#      caught — an anchored regex (`grep -Eq '^...$'`) would not catch it.
#   2. Shape check: strict HH:MM, hour 00-29 range then minute 00-59 (the
#      loose "[0-2][0-9]" shape matches the CGI-side check this mirrors).
# Returns 0 (valid) or 1 (reject).
_qm_validate_hhmm() {
    case "$1" in
        ''|*[!0-9:]*) return 1 ;;
    esac
    case "$1" in
        [0-2][0-9]:[0-5][0-9]) return 0 ;;
        *) return 1 ;;
    esac
}

# _qm_validate_days <csv>
# Same two-gate treatment for a comma-separated day mask (0=Sun..6=Sat).
#   1. Charset reject: '*[!0-9,]*' — anything outside digits and commas,
#      including a newline, is rejected outright.
#   2. Shape check: every comma-split token must be a single digit 0-6.
# Returns 0 (valid) or 1 (reject).
_qm_validate_days() {
    case "$1" in
        ''|*[!0-9,]*) return 1 ;;
    esac
    local d
    for d in $(printf '%s' "$1" | tr ',' ' '); do
        case "$d" in
            0|1|2|3|4|5|6) ;;
            *) return 1 ;;
        esac
    done
    return 0
}

# _qm_oncalendar_line <days_csv> <HH:MM>
# Renders "OnCalendar=<Dow[,Dow...]> HH:MM:00" for a single recurring weekly
# trigger. Caller MUST have already passed both arguments through
# _qm_validate_days / _qm_validate_hhmm — this function does not re-validate.
# Prints nothing (empty result) if the day list resolves to zero valid days,
# so callers can treat an empty return as "no schedule" and tear down instead
# of arming a .timer with a config-error empty OnCalendar= line.
_qm_oncalendar_line() {
    local days="$1" time="$2" hh mm d n names
    hh=$(printf '%s' "$time" | cut -d: -f1)
    mm=$(printf '%s' "$time" | cut -d: -f2)
    names=""
    for d in $(printf '%s' "$days" | tr ',' ' '); do
        n=""
        case "$d" in
            0) n="Sun" ;;
            1) n="Mon" ;;
            2) n="Tue" ;;
            3) n="Wed" ;;
            4) n="Thu" ;;
            5) n="Fri" ;;
            6) n="Sat" ;;
        esac
        [ -z "$n" ] && continue
        case ",$names," in
            *",$n,"*) ;;                          # already present — de-dupe
            *) names="${names:+$names,}$n" ;;
        esac
    done
    [ -z "$names" ] && return 0
    printf 'OnCalendar=%s %s:%s:00\n' "$names" "$hh" "$mm"
}
