#!/bin/sh
# config_backup_radio.sh — Config Backup sections: network_mode, bands, tower_lock, scenarios.
# Validators and side effects come from the same libs the CGIs use
# (radio_validate.sh, tower_lock_mgr.sh, scenario_mgr.sh).

[ -n "$_CFG_BACKUP_RADIO_LOADED" ] && return 0
_CFG_BACKUP_RADIO_LOADED=1

for _cfgbk_l in radio_validate tower_lock_mgr scenario_mgr; do
    [ -f "/usr/lib/qmanager/${_cfgbk_l}.sh" ] && . "/usr/lib/qmanager/${_cfgbk_l}.sh"
done
unset _cfgbk_l

_CFGBK_RADIO_STATUS="/tmp/qmanager_status.json"
_CFGBK_RADIO_MAX_SCENARIOS=20

# --- Helpers -------------------------------------------------------------------

# _cfgbk_radio_flag <file> <jq-path>: absent | true | false | invalid.
_cfgbk_radio_flag() {
    jq -r "($2) as \$v | if \$v == null then \"absent\" elif (\$v | type) == \"boolean\" then (\$v | tostring) else \"invalid\" end" "$1" 2>/dev/null
}

# _cfgbk_radio_uint <file> <jq-path>: a non-negative integer, empty when absent or not one.
_cfgbk_radio_uint() {
    jq -r "($2) as \$v | if (\$v | type) == \"number\" and \$v >= 0 and \$v == (\$v | floor) then (\$v | tostring) else empty end" "$1" 2>/dev/null
}

# _cfgbk_radio_at_line <raw> <param>: value of one +QNWPREFCFG line, no spaces.
_cfgbk_radio_at_line() {
    printf '%s\n' "$1" | grep "^+QNWPREFCFG: \"$2\"," | head -1 | sed "s/.*\"$2\",//" | tr -d ' \r'
}

# =============================================================================
# network_mode — AT+QNWPREFCFG="mode_pref"
# =============================================================================

collect_network_mode() {
    local raw rc val
    raw=$(qcmd 'AT+QNWPREFCFG="mode_pref"' 2>/dev/null)
    rc=$?
    [ $rc -eq 0 ] || return 1
    val=$(_cfgbk_radio_at_line "$raw" mode_pref)
    [ -n "$val" ] || return 1
    jq -n --arg m "$val" '{mode_pref: $m}'
}

apply_network_mode() {
    local mode
    cfg_count_unknown "$1" '.' "mode_pref"
    cfg_has "$1" '.mode_pref' || return "$CFG_RC_OK"

    mode=$(cfg_get "$1" '.mode_pref')
    if ! rv_mode_pref "$mode"; then
        CFG_MESSAGE="network mode not supported"
        return "$CFG_RC_INVALID"
    fi
    if ! radio_set_mode_pref "$mode"; then
        cfg_at_failed "modem rejected the network mode"
        return $?
    fi
    return "$CFG_RC_OK"
}

# =============================================================================
# bands — lte_band / nsa_nr5g_band / nr5g_band + band failover toggle
# =============================================================================

# A band list of "0" (or none) means the modem has no such band set; it is left out.
collect_bands() {
    local raw rc lte nsa sa fe="0" val
    raw=$(qcmd 'AT+QNWPREFCFG="lte_band";+QNWPREFCFG="nsa_nr5g_band";+QNWPREFCFG="nr5g_band"' 2>/dev/null)
    rc=$?
    [ $rc -eq 0 ] || return 1
    lte=$(_cfgbk_radio_at_line "$raw" lte_band)
    nsa=$(_cfgbk_radio_at_line "$raw" nsa_nr5g_band)
    sa=$(_cfgbk_radio_at_line "$raw" nr5g_band)
    if [ -f "$BANDS_FAILOVER_ENABLED_FILE" ]; then
        val=$(cat "$BANDS_FAILOVER_ENABLED_FILE" 2>/dev/null | tr -d ' \n\r')
        [ "$val" = "1" ] && fe="1"
    fi
    jq -n --arg l "$lte" --arg n "$nsa" --arg s "$sa" --arg f "$fe" \
        'def band: if . == "" or . == "0" then null else . end;
         {lte_bands: ($l | band), nsa_nr5g_bands: ($n | band), sa_nr5g_bands: ($s | band),
          failover_enabled: ($f == "1")}'
}

apply_bands() {
    local f="$1" spec key rest atp supkey bands sup work="" item fe any=0
    cfg_count_unknown "$f" '.' "lte_bands nsa_nr5g_bands sa_nr5g_bands failover_enabled"

    # Validate every category before the first write so a bad one applies nothing.
    for spec in "lte_bands lte_band supported_lte_bands" \
                "nsa_nr5g_bands nsa_nr5g_band supported_nsa_nr5g_bands" \
                "sa_nr5g_bands nr5g_band supported_sa_nr5g_bands"; do
        key=${spec%% *}
        rest=${spec#* }
        atp=${rest%% *}
        supkey=${rest#* }
        cfg_has "$f" ".$key" || continue
        bands=$(cfg_get "$f" ".$key")
        [ "$bands" = "0" ] && continue
        if [ -z "$bands" ] || ! rv_bands_format "$bands"; then
            cfg_drop
            continue
        fi
        sup=$(jq -r ".device.$supkey // empty" "$_CFGBK_RADIO_STATUS" 2>/dev/null)
        if ! rv_bands_supported "$bands" "$sup"; then
            CFG_MESSAGE="backup has bands this modem does not support"
            cfg_foreign_model && return "$CFG_RC_INCOMPATIBLE"
            return "$CFG_RC_INVALID"
        fi
        work="$work $atp=$bands"
    done

    # Toggle first, so the watcher armed after the locks sees the restored setting.
    fe=$(_cfgbk_radio_flag "$f" '.failover_enabled')
    case "$fe" in
        true|false)
            if ! bands_set_failover "$fe"; then
                CFG_MESSAGE="could not save the band failover setting"
                return "$CFG_RC_RETRY"
            fi
            ;;
        invalid) cfg_drop ;;
    esac

    for item in $work; do
        if ! bands_lock_write "${item%%=*}" "${item#*=}"; then
            cfg_at_failed "modem rejected the band lock"
            return $?
        fi
        any=1
        sleep 0.2
    done
    [ "$any" = "1" ] && bands_arm_failover
    return "$CFG_RC_OK"
}

# =============================================================================
# tower_lock — /etc/qmanager/tower_lock.json + AT+QNWLOCK save_ctrl
# =============================================================================

collect_tower_lock() {
    local cfg persist pl="" pn=""
    cfg=$(tower_config_read) || return 1
    if persist=$(tower_read_persist); then
        set -- $persist
        pl="$1"
        pn="$2"
    fi
    printf '%s' "$cfg" | jq -c --arg pl "$pl" --arg pn "$pn" '
        def flag: . == true;
        {
          lte: {
            enabled: (.lte.enabled | flag),
            cells: (((.lte.cells // []) + [null, null, null]) | .[0:3]
                    | map(if . == null then null else {earfcn: .earfcn, pci: .pci} end))
          },
          nr_sa: {
            enabled: (.nr_sa.enabled | flag),
            pci: .nr_sa.pci, arfcn: .nr_sa.arfcn, scs: .nr_sa.scs, band: .nr_sa.band
          },
          persist_lte: (if $pl == "" then null else ($pl == "1") end),
          persist_nr: (if $pn == "" then null else ($pn == "1") end),
          failover: {
            enabled: (.failover.enabled | flag),
            threshold: (.failover.threshold // 20)
          },
          schedule: {
            enabled: (.schedule.enabled | flag),
            start_time: (.schedule.start_time // "08:00"),
            end_time: (.schedule.end_time // "22:00"),
            days: (.schedule.days // [1, 2, 3, 4, 5])
          }
        }'
}

# _cfgbk_radio_cell <file> <idx>: sets CELL_E/CELL_P (empty for a null slot); rc 1 = invalid.
_cfgbk_radio_cell() {
    CELL_E=""
    CELL_P=""
    cfg_has "$1" ".lte.cells[$2]" || return 0
    CELL_E=$(_cfgbk_radio_uint "$1" ".lte.cells[$2].earfcn")
    CELL_P=$(_cfgbk_radio_uint "$1" ".lte.cells[$2].pci")
    if [ -n "$CELL_E" ] && [ -n "$CELL_P" ] && rv_tower_lte_cells "$CELL_E" "$CELL_P"; then
        return 0
    fi
    CELL_E=""
    CELL_P=""
    return 1
}

# _cfgbk_radio_cells_json <e1> <p1> <e2> <p2> <e3> <p3>: the config "cells" array.
_cfgbk_radio_cells_json() {
    jq -nc --arg e1 "$1" --arg p1 "$2" --arg e2 "$3" --arg p2 "$4" --arg e3 "$5" --arg p3 "$6" \
        '[[$e1, $p1], [$e2, $p2], [$e3, $p3]]
         | map(if .[0] != "" and .[1] != "" then {earfcn: (.[0] | tonumber), pci: (.[1] | tonumber)} else null end)'
}

# _cfgbk_radio_bool_cfg <jq-path>: the device config value as true|false.
_cfgbk_radio_bool_cfg() {
    [ "$(tower_config_get "$1")" = "true" ] && echo true || echo false
}

# The LTE leg: lock, unlock or just store the cells, per the backup.
_cfgbk_radio_tower_lte() {
    local f="$1" en c1e c1p c2e c2p c3e c3p cells_in=0 state
    [ "$(jq -r '.lte | type' "$f" 2>/dev/null)" = "object" ] || return 0

    en=$(_cfgbk_radio_flag "$f" '.lte.enabled')
    if [ "$en" = "invalid" ]; then cfg_drop; en="absent"; fi

    if [ "$(jq -r '.lte.cells | type' "$f" 2>/dev/null)" = "array" ]; then
        cells_in=1
        _cfgbk_radio_cell "$f" 0 || cfg_drop; c1e="$CELL_E"; c1p="$CELL_P"
        _cfgbk_radio_cell "$f" 1 || cfg_drop; c2e="$CELL_E"; c2p="$CELL_P"
        _cfgbk_radio_cell "$f" 2 || cfg_drop; c3e="$CELL_E"; c3p="$CELL_P"
    else
        c1e=$(tower_config_get '.lte.cells[0].earfcn'); c1p=$(tower_config_get '.lte.cells[0].pci')
        c2e=$(tower_config_get '.lte.cells[1].earfcn'); c2p=$(tower_config_get '.lte.cells[1].pci')
        c3e=$(tower_config_get '.lte.cells[2].earfcn'); c3p=$(tower_config_get '.lte.cells[2].pci')
    fi

    case "$en" in
        true)
            tower_lte_cell_args "$c1e" "$c1p" "$c2e" "$c2p" "$c3e" "$c3p"
            if [ "$TW_NUM_CELLS" -eq 0 ]; then
                cfg_drop
                return 0
            fi
            if ! tower_do_lte_lock "$c1e" "$c1p" "$c2e" "$c2p" "$c3e" "$c3p"; then
                cfg_at_failed "modem rejected the LTE tower lock"
                return $?
            fi
            ;;
        false)
            [ "$cells_in" = "1" ] && tower_config_update ".lte.cells = $(_cfgbk_radio_cells_json "$c1e" "$c1p" "$c2e" "$c2p" "$c3e" "$c3p")"
            state=$(tower_read_lte_lock)
            if [ "$state" = "unlocked" ]; then
                tower_config_update '.lte.enabled = false'
            elif ! tower_do_lte_unlock; then
                cfg_at_failed "modem rejected the LTE tower unlock"
                return $?
            fi
            ;;
        *)
            [ "$cells_in" = "1" ] && tower_config_update ".lte.cells = $(_cfgbk_radio_cells_json "$c1e" "$c1p" "$c2e" "$c2p" "$c3e" "$c3p")"
            ;;
    esac
    return 0
}

# The NR-SA leg. The four target fields travel together: all valid, or all null.
_cfgbk_radio_tower_nr() {
    local f="$1" en tgt_in=0 tgt_bad=0 pci arfcn scs band n state cur_en
    [ "$(jq -r '.nr_sa | type' "$f" 2>/dev/null)" = "object" ] || return 0

    en=$(_cfgbk_radio_flag "$f" '.nr_sa.enabled')
    if [ "$en" = "invalid" ]; then cfg_drop; en="absent"; fi

    if jq -e '.nr_sa | has("pci")' "$f" >/dev/null 2>&1; then
        pci=$(_cfgbk_radio_uint "$f" '.nr_sa.pci')
        arfcn=$(_cfgbk_radio_uint "$f" '.nr_sa.arfcn')
        scs=$(_cfgbk_radio_uint "$f" '.nr_sa.scs')
        band=$(_cfgbk_radio_uint "$f" '.nr_sa.band')
        n=0
        for _v in "$pci" "$arfcn" "$scs" "$band"; do [ -n "$_v" ] && n=$((n + 1)); done
        if [ "$n" -eq 0 ]; then
            tgt_in=1
        elif [ "$n" -eq 4 ] && rv_tower_scs "$scs"; then
            tgt_in=1
        else
            cfg_drop
            tgt_bad=1
        fi
    fi
    if [ "$tgt_in" = "0" ]; then
        pci=$(tower_config_get '.nr_sa.pci'); arfcn=$(tower_config_get '.nr_sa.arfcn')
        scs=$(tower_config_get '.nr_sa.scs'); band=$(tower_config_get '.nr_sa.band')
        case "$pci$arfcn$scs$band" in *[!0-9]*) pci=""; arfcn=""; scs=""; band="" ;; esac
    fi

    case "$en" in
        true)
            [ "$tgt_bad" = "1" ] && return 0
            if [ -z "$pci" ] || [ -z "$arfcn" ] || [ -z "$scs" ] || [ -z "$band" ] || ! rv_tower_scs "$scs"; then
                cfg_drop
                return 0
            fi
            if ! tower_do_nr_lock "$pci" "$arfcn" "$scs" "$band"; then
                cfg_at_failed "modem rejected the NR tower lock"
                return $?
            fi
            ;;
        false)
            [ "$tgt_in" = "1" ] && tower_config_update_nr "false" "$pci" "$arfcn" "$scs" "$band"
            state=$(tower_read_nr_lock)
            if [ "$state" = "unlocked" ]; then
                tower_config_update '.nr_sa.enabled = false'
            elif ! tower_do_nr_unlock; then
                cfg_at_failed "modem rejected the NR tower unlock"
                return $?
            fi
            ;;
        *)
            if [ "$tgt_in" = "1" ]; then
                cur_en=$(_cfgbk_radio_bool_cfg '.nr_sa.enabled')
                tower_config_update_nr "$cur_en" "$pci" "$arfcn" "$scs" "$band"
            fi
            ;;
    esac
    return 0
}

# Schedule: merged onto the device values, then the timer pair is armed or torn down.
_cfgbk_radio_tower_schedule() {
    local f="$1" en st et days_json days_csv v
    [ "$(jq -r '.schedule | type' "$f" 2>/dev/null)" = "object" ] || return 0

    en=$(_cfgbk_radio_flag "$f" '.schedule.enabled')
    case "$en" in
        true|false) ;;
        invalid) cfg_drop; en=$(_cfgbk_radio_bool_cfg '.schedule.enabled') ;;
        *) en=$(_cfgbk_radio_bool_cfg '.schedule.enabled') ;;
    esac

    st=$(tower_config_get '.schedule.start_time'); [ -z "$st" ] && st="08:00"
    et=$(tower_config_get '.schedule.end_time'); [ -z "$et" ] && et="22:00"
    if cfg_has "$f" '.schedule.start_time'; then
        v=$(cfg_get "$f" '.schedule.start_time')
        if rv_hhmm "$v"; then st="$v"; else cfg_drop; fi
    fi
    if cfg_has "$f" '.schedule.end_time'; then
        v=$(cfg_get "$f" '.schedule.end_time')
        if rv_hhmm "$v"; then et="$v"; else cfg_drop; fi
    fi

    days_json=$(tower_config_get '.schedule.days')
    [ -z "$days_json" ] && days_json="[1,2,3,4,5]"
    if cfg_has "$f" '.schedule.days'; then
        if jq -e '.schedule.days | type == "array" and length > 0 and (map(type == "number" and . >= 0 and . <= 6 and . == floor) | all)' "$f" >/dev/null 2>&1; then
            days_json=$(jq -c '.schedule.days' "$f")
        else
            cfg_drop
        fi
    fi
    days_csv=$(printf '%s' "$days_json" | jq -r 'join(",")')

    if [ "$en" = "true" ]; then
        if ! rv_tower_days "$days_csv" || ! tower_has_lock_targets; then
            cfg_drop
            en="false"
        fi
    fi

    tower_config_update_schedule "$en" "$st" "$et" "$days_json"
    tower_apply_schedule_timer "$en" "$st" "$et" "$days_csv"
    if [ "$TW_ARM_OK" != "true" ]; then
        CFG_MESSAGE="${TW_ARM_REASON:-schedule timers could not be armed}"
        return "$CFG_RC_INVALID"
    fi
    return 0
}

apply_tower_lock() {
    local f="$1" pl pn fo_en fo_thr cur_fo cur_thr cur_persist new_persist persist_ran=0 fo_have=0 rc v

    cfg_count_unknown "$f" '.' "lte nr_sa persist_lte persist_nr failover schedule"
    cfg_count_unknown "$f" '.lte' "enabled cells"
    cfg_count_unknown "$f" '.nr_sa' "enabled pci arfcn scs band"
    cfg_count_unknown "$f" '.failover' "enabled threshold"
    cfg_count_unknown "$f" '.schedule' "enabled start_time end_time days"
    tower_config_init

    # Persistence first, so a lock written next is saved under the restored setting.
    pl=$(_cfgbk_radio_flag "$f" '.persist_lte')
    pn=$(_cfgbk_radio_flag "$f" '.persist_nr')
    case "$pl" in true|false) ;; invalid) cfg_drop; pl="unset" ;; *) pl="unset" ;; esac
    case "$pn" in true|false) ;; invalid) cfg_drop; pn="unset" ;; *) pn="unset" ;; esac
    cur_persist=$(_cfgbk_radio_bool_cfg '.persist')
    new_persist="$cur_persist"
    if [ "$pl" != "unset" ] || [ "$pn" != "unset" ]; then
        tower_apply_persist "unset" "$pl" "$pn" "$cur_persist"
        persist_ran=1
        new_persist="$TW_NEW_PERSIST"
        if [ "$TW_PERSIST_OK" != "true" ]; then
            cfg_at_failed "modem did not accept the tower lock persistence setting"
            return $?
        fi
    fi

    _cfgbk_radio_tower_lte "$f"
    rc=$?
    [ "$rc" -ne 0 ] && return "$rc"
    _cfgbk_radio_tower_nr "$f"
    rc=$?
    [ "$rc" -ne 0 ] && return "$rc"

    # Failover and persist land in one config write; the unlocks above may have cleared failover.
    [ "$(jq -r '.failover | type' "$f" 2>/dev/null)" = "object" ] && fo_have=1
    if [ "$fo_have" = "1" ] || [ "$persist_ran" = "1" ]; then
        cur_fo=$(tower_config_get ".failover.enabled")
        [ "$cur_fo" != "true" ] && [ "$cur_fo" != "false" ] && cur_fo="true"
        cur_thr=$(tower_config_get ".failover.threshold")
        [ -z "$cur_thr" ] && cur_thr="20"
        fo_en="$cur_fo"
        fo_thr="$cur_thr"
        if [ "$fo_have" = "1" ]; then
            v=$(_cfgbk_radio_flag "$f" '.failover.enabled')
            case "$v" in true|false) fo_en="$v" ;; invalid) cfg_drop ;; esac
            if cfg_has "$f" '.failover.threshold'; then
                v=$(_cfgbk_radio_uint "$f" '.failover.threshold')
                if [ -n "$v" ] && rv_tower_threshold "$v"; then fo_thr="$v"; else cfg_drop; fi
            fi
        fi
        tower_config_update_settings "$new_persist" "$fo_en" "$fo_thr"
        tower_apply_failover_state "$fo_en" "$cur_fo"
    fi

    _cfgbk_radio_tower_schedule "$f"
    return $?
}

# =============================================================================
# scenarios — /etc/qmanager/scenarios/*.json + /etc/qmanager/active_scenario
# =============================================================================

collect_scenarios() {
    local files="" f active
    for f in "$SCENARIO_DIR"/*.json; do
        [ -f "$f" ] || continue
        jq -e 'type == "object"' "$f" >/dev/null 2>&1 && files="$files $f"
    done
    active=$(scenario_get_active)
    [ -z "$active" ] && active="balanced"

    { [ -n "$files" ] && cat $files; true; } | jq -sc --arg a "$active" '
        {
          scenarios: (map(select(type == "object" and (.id | type) == "string" and (.id | startswith("custom-")))
                          | {id: .id, name: .name, description: .description, icon: .icon,
                             config: {atModeValue: .config.atModeValue, mode: .config.mode,
                                      optimization: .config.optimization, lte_bands: .config.lte_bands,
                                      nsa_nr_bands: .config.nsa_nr_bands, sa_nr_bands: .config.sa_nr_bands}}
                          | if .icon == null then del(.icon) else . end)
                      | sort_by(.id)),
          active_scenario_id: $a
        }'
}

# Normalise scenario <idx> of <file> into <out>; writes nothing and returns 1 when it is unusable.
_cfgbk_radio_scenario_norm() {
    jq -ce --argjson i "$2" '
        .scenarios[$i] as $s
        | select(($s | type) == "object" and ($s.id | type) == "string"
                 and ($s.name | type) == "string" and ($s.name | length) > 0)
        | def str($v): if ($v | type) == "string" then $v else "" end;
          ($s.config // {}) as $c
        | {id: $s.id, name: $s.name, description: str($s.description)}
          + (if ($s.icon | type) == "string" then {icon: $s.icon} else {} end)
          + {config: {atModeValue: str($c.atModeValue),
                      mode: (if ($c.mode | type) == "string" then $c.mode else str($c.atModeValue) end),
                      optimization: str($c.optimization),
                      lte_bands: str($c.lte_bands), nsa_nr_bands: str($c.nsa_nr_bands),
                      sa_nr_bands: str($c.sa_nr_bands)}}' "$1" > "$3" 2>/dev/null
}

# Replace the custom set from <file>, then settle the active pointer. $2 = staging dir.
_cfgbk_radio_scenarios_run() {
    local f="$1" stage="$2" n i out id mode lte nsa sa kept="" count=0 existing base target prev rc
    cfg_count_unknown "$f" '.' "scenarios active_scenario_id"

    if [ "$(jq -r '.scenarios | type' "$f" 2>/dev/null)" = "array" ]; then
        n=$(jq -r '.scenarios | length' "$f" 2>/dev/null)
        case "$n" in ''|*[!0-9]*) n=0 ;; esac
        i=0
        while [ "$i" -lt "$n" ]; do
            out="$stage/$i.json"
            if [ "$(jq -r ".scenarios[$i] | type" "$f" 2>/dev/null)" = "object" ]; then
                cfg_count_unknown "$f" ".scenarios[$i]" "id name description icon config"
                cfg_count_unknown "$f" ".scenarios[$i].config" "atModeValue mode optimization lte_bands nsa_nr_bands sa_nr_bands"
            fi
            if ! _cfgbk_radio_scenario_norm "$f" "$i" "$out"; then
                cfg_drop; i=$((i + 1)); continue
            fi
            id=$(cfg_get "$out" '.id')
            mode=$(cfg_get "$out" '.config.atModeValue')
            lte=$(cfg_get "$out" '.config.lte_bands')
            nsa=$(cfg_get "$out" '.config.nsa_nr_bands')
            sa=$(cfg_get "$out" '.config.sa_nr_bands')
            if ! rv_scenario_id "$id" || ! rv_scenario_mode "$mode" \
               || ! rv_bands_format "$lte" || ! rv_bands_format "$nsa" || ! rv_bands_format "$sa"; then
                cfg_drop; i=$((i + 1)); continue
            fi
            case " $kept " in *" $id "*) cfg_drop; i=$((i + 1)); continue ;; esac
            if [ "$count" -ge "$_CFGBK_RADIO_MAX_SCENARIOS" ]; then
                cfg_drop; i=$((i + 1)); continue
            fi
            count=$((count + 1))
            kept="$kept $id"
            mv -f "$out" "$stage/id_$id.json"
            i=$((i + 1))
        done
    fi

    mkdir -p "$SCENARIO_DIR" 2>/dev/null
    for id in $kept; do
        if ! cfg_write_file "$SCENARIO_DIR/$id.json" 644 < "$stage/id_$id.json"; then
            CFG_MESSAGE="could not write a scenario file"
            return "$CFG_RC_RETRY"
        fi
    done
    for existing in "$SCENARIO_DIR"/*.json; do
        [ -f "$existing" ] || continue
        base=${existing##*/}
        base=${base%.json}
        case " $kept " in *" $base "*) ;; *) rm -f "$existing" ;; esac
    done

    # Active pointer: only an id that exists after the replace may stay.
    target=""
    if cfg_has "$f" '.active_scenario_id'; then
        target=$(cfg_get "$f" '.active_scenario_id')
        case "$target" in
            balanced|gaming|streaming) ;;
            *)
                case " $kept " in *" $target "*) ;; *) cfg_drop; target="" ;; esac
                ;;
        esac
    fi
    prev=$(scenario_get_active)
    case "$prev" in
        custom-*) [ -f "$SCENARIO_DIR/$prev.json" ] || { scenario_clear_active; prev=""; } ;;
    esac
    [ -n "$target" ] || return "$CFG_RC_OK"

    # A profile that binds a scenario owns the radio; the pointer is left alone.
    if scenario_profile_managed; then
        CFG_MESSAGE="scenario not activated: managed by the active SIM profile"
        return "$CFG_RC_OK"
    fi

    # Built-in scenarios only set the mode, so an unchanged pointer needs no write.
    [ -z "$prev" ] && prev="balanced"
    case "$target" in
        balanced|gaming|streaming)
            if [ "$target" = "$prev" ]; then
                scenario_set_active "$target"
                return "$CFG_RC_OK"
            fi
            ;;
    esac

    if ! scenario_apply_resolved "$target"; then
        cfg_at_failed "modem rejected the scenario network mode"
        return $?
    fi
    scenario_set_active "$target"
    if [ -n "$_scenario_apply_failed" ]; then
        cfg_at_failed "band lock failed for: $_scenario_apply_failed"
        return $?
    fi
    return "$CFG_RC_OK"
}

apply_scenarios() {
    local stage rc
    stage="/tmp/qmanager_cfgbk_scn.$$"
    rm -rf "$stage"
    mkdir -p "$stage" || { CFG_MESSAGE="no staging space"; return "$CFG_RC_RETRY"; }
    _cfgbk_radio_scenarios_run "$1" "$stage"
    rc=$?
    rm -rf "$stage"
    return "$rc"
}
