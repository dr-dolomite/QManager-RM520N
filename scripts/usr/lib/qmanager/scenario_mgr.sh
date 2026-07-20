#!/bin/sh
# =============================================================================
# scenario_mgr.sh — QManager Connection Scenario Manager Library
# =============================================================================
# A sourceable library providing scenario activation primitives used by both
# the activate.sh CGI and the qmanager_profile_apply pipeline.
#
# This is a LIBRARY — no persistent process, no polling.
#
# Dependencies: qlog_* functions (from qlog.sh), qcmd, jq
# Install location: /usr/lib/qmanager/scenario_mgr.sh
#
# Usage:
#   . /usr/lib/qmanager/scenario_mgr.sh
#   scenario_apply "gaming"                     → explicit-args apply (existing)
#   scenario_apply_resolved "custom-123"        → disk-resolving apply
#   scenario_set_active "gaming"
#   scenario_is_known "custom-123"              → rc 0 if a valid/known id
#   scenario_resolve_config "custom-123"        → "<MODE> <LTE> <NSA> <SA>"
#   scenario_reset_to_default                   → mode-only reset to Balanced
#   scenario_profile_block <profile_id>         → normalized .scenario object
#   scenario_profile_schedule_enabled <p>       → "true"/"false"
#   scenario_block_for_now <profile_id>         → scenario id active right now
#   scenario_install_schedule <profile_id>      → arm the systemd OnCalendar timer
#   scenario_teardown_schedule                  → disarm it
#
# NETWORK MODE + BANDS are owned by Connection Scenarios (not SIM Profiles).
# scenario_apply* NEVER reboots — it issues mode_pref + band locks only.
# =============================================================================

[ -n "$_SCENARIO_MGR_LOADED" ] && return 0
_SCENARIO_MGR_LOADED=1

# --- Configuration -----------------------------------------------------------
# Custom scenarios are stored under /etc/qmanager/scenarios/<id>.json
# (confirmed from scenarios/save.sh: SCENARIOS_DIR="/etc/qmanager/scenarios")
SCENARIO_DIR="/etc/qmanager/scenarios"
ACTIVE_SCENARIO_FILE="/etc/qmanager/active_scenario"
# Profiles live here too — scenario_profile_block/scenario_block_for_now read
# a profile's .scenario binding directly. Same value profile_mgr.sh declares;
# redundant-but-identical when both libs are sourced together.
PROFILE_DIR="/etc/qmanager/profiles"
# Read-time fallback for a profile with no .scenario object AND no legacy
# settings.scenario_id (brand new / malformed profile).
SCENARIO_PROFILE_DEFAULT_BLOCK='{"default":"balanced","schedule":{"enabled":false,"blocks":[]}}'
# Root helper (installer-provided) that arms/disarms the systemd timer for a
# profile's scenario schedule. RM520N has no crond — scheduling is systemd
# OnCalendar, not cron. Called via scenario_install_schedule/teardown_schedule.
SCENARIO_SCHEDULE_ARM="/usr/bin/qmanager_scenario_schedule_arm"

# --- Logging stubs (defensive — caller may not have sourced qlog.sh) ---------
. /usr/lib/qmanager/qlog.sh 2>/dev/null || {
    qlog_init()  { :; }
    qlog_debug() { :; }
    qlog_info()  { :; }
    qlog_warn()  { :; }
    qlog_error() { :; }
}

# =============================================================================
# Scenario Validation
# =============================================================================

# scenario_is_known <id>
# Returns 0 if id is a built-in default or an existing custom-*.json file.
# Pattern must stay in sync with scenarios/save.sh's ID generation
# ("custom-$(date +%s)", sanitized there as custom-[0-9]*).
scenario_is_known() {
    local id="$1"
    case "$id" in
        balanced|gaming|streaming) return 0 ;;
        custom-[0-9]*) [ -f "$SCENARIO_DIR/${id}.json" ] && return 0; return 1 ;;
        *) return 1 ;;
    esac
}

# =============================================================================
# Active Scenario State Management
# =============================================================================

# scenario_get_active
# Print the currently active scenario ID, or empty if none is set.
scenario_get_active() {
    if [ -f "$ACTIVE_SCENARIO_FILE" ]; then
        cat "$ACTIVE_SCENARIO_FILE" 2>/dev/null | tr -d ' \n\r'
    fi
}

# scenario_set_active <id>
# Write the active scenario ID to flash (atomic).
scenario_set_active() {
    local id="$1"
    [ -z "$id" ] && return 1
    local dir
    dir=$(dirname "$ACTIVE_SCENARIO_FILE")
    mkdir -p "$dir" 2>/dev/null
    printf '%s' "$id" > "${ACTIVE_SCENARIO_FILE}.tmp" || return 1
    mv "${ACTIVE_SCENARIO_FILE}.tmp" "$ACTIVE_SCENARIO_FILE"
}

# scenario_clear_active
# Remove the active scenario marker.
scenario_clear_active() {
    rm -f "$ACTIVE_SCENARIO_FILE"
}

# =============================================================================
# Custom Scenario Lookup
# =============================================================================

# scenario_lookup_custom <id>
# For a custom-* ID, print the stored JSON to stdout.
# Returns 1 if the file does not exist.
scenario_lookup_custom() {
    local id="$1"
    local file="${SCENARIO_DIR}/${id}.json"
    if [ ! -f "$file" ]; then
        qlog_warn "scenario_lookup_custom: not found: $id"
        return 1
    fi
    cat "$file"
}

# =============================================================================
# AT Command Primitive
# =============================================================================

# _scenario_send_at <at_cmd> <label>
# Send one AT command via qcmd. Returns 0 on success, 1 on error.
# Not exported as a public function — used only within this library.
_scenario_send_at() {
    local cmd="$1"
    local label="$2"

    local result
    result=$(qcmd "$cmd" 2>/dev/null)
    local rc=$?

    if [ $rc -ne 0 ] || [ -z "$result" ]; then
        qlog_error "scenario: $label: AT command failed (rc=$rc): $cmd"
        return 1
    fi

    case "$result" in
        *ERROR*)
            qlog_error "scenario: $label: AT returned ERROR: $cmd -> $result"
            return 1
            ;;
    esac

    qlog_info "scenario: $label: OK"
    return 0
}

# =============================================================================
# Unified Apply Primitive
# =============================================================================

# scenario_apply <id> [mode] [lte_bands] [nsa_nr_bands] [sa_nr_bands]
#
# Applies a scenario's network mode and optional band locks to the modem.
#
# For built-in scenarios (balanced/gaming/streaming):
#   - Extra args are ignored; the hardcoded mode_pref is used.
#   - Band locks are NOT sent (user controls bands via Band Locking page).
#
# For custom-* scenarios:
#   - Caller MUST provide mode. Band args may be empty (skips those AT commands).
#   - Caller resolves the JSON via scenario_lookup_custom before calling.
#
# Return values:
#   0 — full success (mode set, all provided band locks set)
#   1 — mode_pref AT command failed (hard failure)
#
# Side effects:
#   _scenario_apply_failed — set to comma-separated list of failed band
#   sub-steps if any band lock AT commands failed; empty on clean success.
#   Callers should check this after a 0 return to detect partial success.
#
# Usage:
#   scenario_apply "gaming"
#   scenario_apply "custom-1234" "NR5G" "1:3:28" "" ""
scenario_apply() {
    local id="$1"
    local mode="$2"
    local lte_bands="$3"
    local nsa_nr_bands="$4"
    local sa_nr_bands="$5"

    _scenario_apply_failed=""

    # --- Resolve mode for built-in scenarios ---------------------------------
    case "$id" in
        balanced)
            mode="AUTO"
            lte_bands=""
            nsa_nr_bands=""
            sa_nr_bands=""
            ;;
        gaming)
            mode="NR5G"
            lte_bands=""
            nsa_nr_bands=""
            sa_nr_bands=""
            ;;
        streaming)
            mode="LTE:NR5G"
            lte_bands=""
            nsa_nr_bands=""
            sa_nr_bands=""
            ;;
        custom-*)
            # Caller provides mode and bands — validate mode is not empty
            if [ -z "$mode" ]; then
                qlog_error "scenario_apply: custom scenario requires mode arg: $id"
                return 1
            fi
            ;;
        *)
            qlog_error "scenario_apply: unknown scenario id: $id"
            return 1
            ;;
    esac

    qlog_info "scenario_apply: $id (mode=$mode, lte=$lte_bands, nsa=$nsa_nr_bands, sa=$sa_nr_bands)"

    # --- Step 1: Set network mode (required) ---------------------------------
    if ! _scenario_send_at "AT+QNWPREFCFG=\"mode_pref\",${mode}" "mode_pref"; then
        return 1
    fi

    # --- Step 2: Band locks (optional — only custom scenarios pass these) ----
    if [ -n "$lte_bands" ]; then
        sleep 0.2
        if ! _scenario_send_at "AT+QNWPREFCFG=\"lte_band\",${lte_bands}" "lte_band"; then
            _scenario_apply_failed="lte_band"
        fi
    fi

    if [ -n "$nsa_nr_bands" ]; then
        sleep 0.2
        if ! _scenario_send_at "AT+QNWPREFCFG=\"nsa_nr5g_band\",${nsa_nr_bands}" "nsa_nr5g_band"; then
            _scenario_apply_failed="${_scenario_apply_failed:+${_scenario_apply_failed},}nsa_nr5g_band"
        fi
    fi

    if [ -n "$sa_nr_bands" ]; then
        sleep 0.2
        if ! _scenario_send_at "AT+QNWPREFCFG=\"nr5g_band\",${sa_nr_bands}" "nr5g_band"; then
            _scenario_apply_failed="${_scenario_apply_failed:+${_scenario_apply_failed},}nr5g_band"
        fi
    fi

    return 0
}

# =============================================================================
# Config Resolution + Resolved-Apply Wrapper
# =============================================================================
# scenario_apply() above takes explicit mode/band args (the existing worker
# call path — qmanager_profile_apply resolves custom scenarios itself via
# scenario_lookup_custom before calling). scenario_resolve_config +
# scenario_apply_resolved add a disk-resolving path for callers (e.g. a
# future systemd-triggered snap-to-now script) that only have an id and want
# "apply whatever this id currently means" without duplicating the lookup.

# scenario_resolve_config <id>
# DISK is the single source of truth for custom-scenario config. Echoes 4
# space-joined fields: "<AT_MODE> <LTE_BANDS> <NSA_NR_BANDS> <SA_NR_BANDS>".
# Empty band fields are emitted as the "-" sentinel so positional splitting
# holds. Built-in defaults send mode only (bands left unchanged). Returns 1
# on unknown id / unreadable custom file.
scenario_resolve_config() {
    local id="$1"
    local mode=""
    local lte=""
    local nsa=""
    local sa=""

    case "$id" in
        balanced)  mode="AUTO" ;;
        gaming)    mode="NR5G" ;;
        streaming) mode="LTE:NR5G" ;;
        custom-[0-9]*)
            local f="$SCENARIO_DIR/${id}.json"
            [ -f "$f" ] || return 1
            mode=$(jq -r '(.config.atModeValue) | if . == null then empty else tostring end' "$f" 2>/dev/null)
            lte=$(jq -r '(.config.lte_bands) | if . == null then empty else tostring end' "$f" 2>/dev/null)
            nsa=$(jq -r '(.config.nsa_nr_bands) | if . == null then empty else tostring end' "$f" 2>/dev/null)
            sa=$(jq -r '(.config.sa_nr_bands) | if . == null then empty else tostring end' "$f" 2>/dev/null)
            [ -n "$mode" ] || return 1
            ;;
        *) return 1 ;;
    esac

    case "$mode" in
        AUTO|LTE|NR5G|LTE:NR5G) ;;
        *) return 1 ;;
    esac

    printf '%s %s %s %s' "$mode" "${lte:--}" "${nsa:--}" "${sa:--}"
    return 0
}

# scenario_apply_resolved <id>
# Thin wrapper: resolve <id>'s config from disk, then delegate to the
# existing scenario_apply(id, mode, lte, nsa, sa) contract unchanged. Returns
# whatever scenario_apply returns (0 full / 2 partial / 1 fail); returns 1
# immediately if the id can't be resolved.
scenario_apply_resolved() {
    local id="$1"
    local cfg
    cfg=$(scenario_resolve_config "$id") || return 1

    local mode
    local lte
    local nsa
    local sa
    mode=$(printf '%s' "$cfg" | cut -d' ' -f1)
    lte=$(printf '%s' "$cfg" | cut -d' ' -f2)
    nsa=$(printf '%s' "$cfg" | cut -d' ' -f3)
    sa=$(printf '%s' "$cfg" | cut -d' ' -f4)
    [ "$lte" = "-" ] && lte=""
    [ "$nsa" = "-" ] && nsa=""
    [ "$sa" = "-" ] && sa=""

    scenario_apply "$id" "$mode" "$lte" "$nsa" "$sa"
}

# scenario_reset_to_default
# Reset the radio + active_scenario marker to the canonical default
# (Balanced). MODE-ONLY: issues AT+QNWPREFCFG="mode_pref",AUTO and writes the
# active_scenario marker; band locks a prior custom scenario applied are
# intentionally NOT cleared (built-in Balanced is mode-only by design). This
# is the deactivate-time inverse of scenario_install_schedule. Never reboots.
scenario_reset_to_default() {
    scenario_apply "balanced" "AUTO" "" "" "" \
        && scenario_set_active "balanced"
}

# =============================================================================
# Per-Profile Scenario Block Readers (read-time migration defaults)
# =============================================================================

# scenario_profile_block <profile_id>
# Echoes the normalized .scenario object (jq -c). Legacy profiles with no
# .scenario object fall back to their settings.scenario_id (so an
# already-chosen scenario isn't silently reset to "balanced" on first read);
# a profile with neither gets the canonical default block. Always emits
# default+schedule keys. This exact formula must stay byte-identical to
# profile_mgr.sh's profile_get/profile_list normalization — both read-derive
# from the same on-disk shape, and profile_mgr.sh's copy is the one CGI
# read-paths actually hit.
scenario_profile_block() {
    local pf="$PROFILE_DIR/${1}.json"
    if [ ! -f "$pf" ]; then
        printf '%s' "$SCENARIO_PROFILE_DEFAULT_BLOCK"
        return 0
    fi
    jq -c '
        (.scenario // {}) as $s
        | {
            default: (
                $s.default //
                ((.settings.scenario_id // "balanced") | if . == "" then "balanced" else . end)
            ),
            schedule: {
                enabled: ($s.schedule.enabled // false),
                blocks: ($s.schedule.blocks // [])
            }
          }' "$pf" 2>/dev/null || printf '%s' "$SCENARIO_PROFILE_DEFAULT_BLOCK"
}

# scenario_profile_schedule_enabled <profile_id>
# Echoes "true" or "false".
scenario_profile_schedule_enabled() {
    scenario_profile_block "$1" | jq -r '.schedule.enabled | tostring' 2>/dev/null
}

# =============================================================================
# Snap-to-Now Resolution (CANONICAL — a TS port must mirror this exactly)
# =============================================================================
# Semantics: start inclusive, end exclusive. When end <= start the block
# wraps past midnight. First matching block in array order wins ($hits[0]).
# Falls back to .default when schedule disabled or no block covers now. All
# minute arithmetic happens inside jq (tonumber on "08"/"09" is clean) —
# never in shell $(()), which mishandles octal-leading-zero "08"/"09".

# scenario_block_for_now <profile_id>
# Echoes the scenario id that should be active right now for this profile.
scenario_block_for_now() {
    local block
    block=$(scenario_profile_block "$1")

    local now_dow
    local now_h
    local now_m
    now_dow=$(date +%w)   # 0=Sun .. 6=Sat
    now_h=$(date +%H)
    now_m=$(date +%M)

    printf '%s' "$block" | jq -r \
        --argjson dow "$now_dow" \
        --arg hh "$now_h" \
        --arg mm "$now_m" '
        (($hh | tonumber) * 60 + ($mm | tonumber)) as $m
        | (.default) as $dflt
        | ( .schedule
            | if (.enabled | not) then $dflt
              else
                ( [ .blocks[]
                    | (.start | split(":") | (.[0] | tonumber) * 60 + (.[1] | tonumber)) as $s
                    | (.end   | split(":") | (.[0] | tonumber) * 60 + (.[1] | tonumber)) as $e
                    | select(.days | index($dow) != null)
                    | select( if $e > $s then ($m >= $s and $m < $e)
                              else ($m >= $s or $m < $e) end )
                    | .scenario
                  ] ) as $hits
                | ($hits[0] // $dflt)
              end )
        ' 2>/dev/null
}

# =============================================================================
# Systemd Timer Install / Teardown (OnCalendar — RM520N has no crond)
# =============================================================================
# A single root helper (SCENARIO_SCHEDULE_ARM) owns writing/enabling the
# actual .timer unit — it is built by a separate installer-track change and
# is NOT implemented here. This library only computes the OnCalendar lines
# and invokes the helper's CLI. The helper, when run, sources this file and
# calls _scenario_generate_oncalendar_lines itself to get the lines to write.

# _scenario_generate_oncalendar_lines <profile_id>
# Emits one "OnCalendar=<Day,Day,...> HH:MM:00" line per de-duplicated
# transition boundary in the profile's schedule. Day names map 0..6 (date
# +%w convention) to Sun,Mon,Tue,Wed,Thu,Fri,Sat. All timeline math runs in
# jq (the octal-leading-zero trap rules out shell arithmetic).
#
# NOTE: an OnCalendar line only encodes WHEN to fire, never WHICH scenario —
# systemd timers can't parameterize per-occurrence like a cron line can. The
# unit this fires (owned by the arm helper) is expected to call
# scenario_block_for_now/scenario_apply_resolved at fire time to resolve
# "what should be active right now" rather than being told directly. The
# dedupe/rank/group-by-[min,scen] timeline algorithm below is otherwise
# UNCHANGED from the cron-line generator it was adapted from — only the
# final render step (crontab line -> OnCalendar line) differs.
#
# Algorithm:
#   1. For each weekday 0..6, gather block start->scenario and end->default
#      transitions. Overnight (end<=start): the default-restore lands on the
#      NEXT weekday.
#   2. Within a weekday, sort by minute; at equal minutes a block-start (rank
#      1) orders AFTER a default-restore (rank 0) so a start overrides a
#      touching block end — no flap at shared boundaries.
#   3. Walk per weekday tracking the running scenario (seed = the effective
#      scenario at 23:59 of the previous weekday, so an overnight block
#      bleeding into the next day still emits its restore transition); emit
#      a transition only when the target differs from the running scenario.
#   4. Group surviving (minute, scenario) across weekdays into one boundary
#      time with a comma day-name-list.
#   5. Render: "OnCalendar=<days> <HH>:<MM>:00"
_scenario_generate_oncalendar_lines() {
    local block
    block=$(scenario_profile_block "$1")

    printf '%s' "$block" | jq -r '
        (.default) as $dflt
        | (.schedule.blocks) as $blocks
        | (["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]) as $dow_names
        # eff($dow; $m): effective scenario at a weekday+minute using the same
        # first-match snap logic as scenario_block_for_now. Used to seed each
        # weekday with the scenario in effect at the end of the PREVIOUS day,
        # so an overnight block bleeding into the next day still emits its
        # restore transition (the per-day reduce would otherwise drop it).
        | def eff($dow; $m):
            ( [ $blocks[]
                | (.start | split(":") | (.[0]|tonumber)*60 + (.[1]|tonumber)) as $s
                | (.end   | split(":") | (.[0]|tonumber)*60 + (.[1]|tonumber)) as $e
                | select(.days | index($dow) != null)
                | select( if $e > $s then ($m >= $s and $m < $e)
                          else ($m >= $s or $m < $e) end )
                | .scenario ] | (.[0] // $dflt) );
        # Build raw transitions tagged by weekday. rank: 0=restore, 1=start.
        [ range(0;7) as $d
            | ( $blocks[]
                | (.start | split(":") | (.[0]|tonumber)*60 + (.[1]|tonumber)) as $s
                | (.end   | split(":") | (.[0]|tonumber)*60 + (.[1]|tonumber)) as $e
                | select(.days | index($d) != null)
                | (
                    # start transition on day $d
                    {day:$d, min:$s, rank:1, scen:(.scenario)},
                    # end (default-restore): same day if normal, next day if wrap
                    (if $e > $s
                       then {day:$d,            min:$e, rank:0, scen:$dflt}
                       else {day:(($d+1)%7),    min:$e, rank:0, scen:$dflt}
                     end)
                  )
              )
          ]
        # Group by weekday, then resolve to real change points.
        | [ range(0;7) as $d
            # First collapse all transitions at the SAME minute to the single
            # highest-rank winner (a block-start, rank 1, overrides a touching
            # block default-restore, rank 0, at a shared boundary). Sorting
            # ascending and taking the last per minute yields that winner.
            | ( [ .[] | select(.day == $d) ]
                | sort_by([.min, .rank])
                | group_by(.min)
                | map(.[-1])
                | sort_by(.min) ) as $day
            # Seed the running scenario with the effective scenario at 23:59 of
            # the previous weekday (handles overnight blocks crossing midnight).
            | ( eff((($d + 6) % 7); 1439) ) as $seed
            # Then emit a transition only when the effective scenario actually
            # changes from the running value.
            | ( reduce $day[] as $t
                  ( {run:$seed, out:[]};
                    if $t.scen == .run then .
                    else { run:$t.scen, out:(.out + [{day:$d, min:$t.min, scen:$t.scen}]) }
                    end )
              ) .out[]
          ]
        # Group across weekdays by identical (min, scen) -> comma day-list.
        | group_by([.min, .scen])[]
        | (.[0].min) as $min
        | ($min % 60) as $mm
        | (($min - $mm) / 60) as $hh
        | ([ .[].day ] | sort | map($dow_names[.]) | join(",")) as $days
        | "OnCalendar=\($days) \(if $hh < 10 then "0" else "" end)\($hh):\(if $mm < 10 then "0" else "" end)\($mm):00"
        ' 2>/dev/null
}

# scenario_install_schedule <profile_id>
# Thin wrapper invoking the qmanager_scenario_schedule_arm root helper's
# install verb, which sources this library and calls
# _scenario_generate_oncalendar_lines itself to write + enable the timer.
# Direct call when already root (e.g. invoked from a root-owned worker);
# sudo -n otherwise (e.g. invoked from a www-data CGI/library context).
scenario_install_schedule() {
    local pid="$1"
    if [ "$(id -u)" = "0" ]; then
        "$SCENARIO_SCHEDULE_ARM" install "$pid"
    else
        sudo -n "$SCENARIO_SCHEDULE_ARM" install "$pid"
    fi
}

# scenario_teardown_schedule
# Thin wrapper invoking the qmanager_scenario_schedule_arm root helper's
# teardown verb (disable + remove the timer). Safe to call unconditionally.
scenario_teardown_schedule() {
    if [ "$(id -u)" = "0" ]; then
        "$SCENARIO_SCHEDULE_ARM" teardown
    else
        sudo -n "$SCENARIO_SCHEDULE_ARM" teardown
    fi
}
