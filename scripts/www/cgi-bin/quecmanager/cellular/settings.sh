#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# settings.sh — CGI Endpoint: Cellular Basic Settings (GET + POST)
# =============================================================================
# GET:  Reads current SIM slot, CFUN, mode_pref, nr5g_disable_mode, and AMBR
# POST: Applies settings changes (sim_slot, cfun, mode_pref, nr5g_mode)
#
# AT commands used (GET):
#   AT+QUIMSLOT?                        -> SIM slot (1 or 2)
#   AT+CFUN?                            -> Functionality mode (0, 1, 4)
#   AT+QNWPREFCFG="mode_pref"          -> Network mode (AUTO, LTE, NR5G, etc.)
#   AT+QNWPREFCFG="nr5g_disable_mode"  -> NR5G mode (0=both, 1=SA off, 2=NSA off)
#   AT+QNWPREFCFG="roam_pref"          -> Roaming preference (1, 3, 255)
#   AT+QNWCFG="lte_ambr"               -> LTE AMBR per APN
#   AT+QNWCFG="nr5g_ambr"              -> NR5G AMBR per DNN
#
# AT commands used (POST):
#   AT+QUIMSLOT=<1|2>
#   AT+CFUN=<0|1|4>
#   AT+QNWPREFCFG="mode_pref",<value>
#   AT+QNWPREFCFG="nr5g_disable_mode",<0|1|2>
#   AT+QNWPREFCFG="roam_pref",<1|3|255>
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/settings.sh
# Install location: /www/cgi-bin/quecmanager/cellular/settings.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_cellular_settings"
cgi_headers
cgi_handle_options

# --- SIM slot read-back verification (shared with qmanager_watchcat) ---------
. /usr/lib/qmanager/slot_verify.sh

# --- Configuration -----------------------------------------------------------
CMD_GAP=0.2

# --- NR5G AMBR unit code to Kbps multiplier ----------------------------------
nr5g_unit_to_kbps() {
    case "$1" in
        1) echo 1 ;; 2) echo 4 ;; 3) echo 16 ;; 4) echo 64 ;;
        5) echo 256 ;; 6) echo 1000 ;; 7) echo 4000 ;; 8) echo 16000 ;;
        9) echo 64000 ;; 10) echo 256000 ;; 11) echo 1000000 ;;
        12) echo 4000000 ;; 13) echo 16000000 ;; 14) echo 64000000 ;;
        15) echo 256000000 ;; *) echo 0 ;;
    esac
}

# =============================================================================
# GET — Fetch current settings and AMBR data
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching cellular settings"

    # --- Compound AT: fetch all settings in one call ---
    raw=$(qcmd 'AT+QUIMSLOT?;+CFUN?;+QNWPREFCFG="mode_pref";+QNWPREFCFG="nr5g_disable_mode";+QNWPREFCFG="roam_pref";+QNWCFG="lte_ambr";+QNWCFG="nr5g_ambr"' 2>/dev/null)
    [ -z "$raw" ] && qlog_warn "Compound AT query returned empty response"

    # --- SIM Slot ---
    sim_slot="1"
    val=$(printf '%s\n' "$raw" | grep '+QUIMSLOT:' | head -1 | sed 's/+QUIMSLOT: //' | tr -d ' \r')
    [ -n "$val" ] && sim_slot="$val"

    # --- CFUN ---
    cfun="1"
    val=$(printf '%s\n' "$raw" | grep '+CFUN:' | head -1 | sed 's/+CFUN: //' | tr -d ' \r')
    [ -n "$val" ] && cfun="$val"

    # --- Network Mode ---
    mode_pref="AUTO"
    val=$(printf '%s\n' "$raw" | grep '+QNWPREFCFG:.*"mode_pref"' | head -1 | sed 's/.*"mode_pref",//' | tr -d ' \r')
    [ -n "$val" ] && mode_pref="$val"

    # --- NR5G Mode ---
    nr5g_mode="0"
    val=$(printf '%s\n' "$raw" | grep '+QNWPREFCFG:.*"nr5g_disable_mode"' | head -1 | sed 's/.*"nr5g_disable_mode",//' | tr -d ' \r')
    [ -n "$val" ] && nr5g_mode="$val"

    # --- Roaming Preference ---
    roam_pref="255"
    val=$(printf '%s\n' "$raw" | grep '+QNWPREFCFG:.*"roam_pref"' | head -1 | sed 's/.*"roam_pref",//' | tr -d ' \r')
    [ -n "$val" ] && roam_pref="$val"

    # --- LTE AMBR ---
    lte_ambr_json="[]"
    lte_ambr_lines=$(printf '%s\n' "$raw" | grep '+QNWCFG: "lte_ambr"')
    if [ -n "$lte_ambr_lines" ]; then
        lte_tmpfile="/tmp/qmanager_lte_ambr.tmp"
        : > "$lte_tmpfile"
        printf '%s\n' "$lte_ambr_lines" | while IFS= read -r line; do
            csv=$(printf '%s' "$line" | sed 's/+QNWCFG: "lte_ambr",//g' | tr -d ' \r')
            apn=$(printf '%s' "$csv" | cut -d',' -f1 | tr -d '"')
            dl=$(printf '%s' "$csv" | cut -d',' -f2)
            ul=$(printf '%s' "$csv" | cut -d',' -f3)
            [ -n "$apn" ] && [ -n "$dl" ] && [ -n "$ul" ] && \
                printf '%s\t%s\t%s\n' "$apn" "$dl" "$ul" >> "$lte_tmpfile"
        done
        if [ -s "$lte_tmpfile" ]; then
            lte_ambr_json=$(jq -Rsc '
                split("\n") | map(select(length > 0) | split("\t") |
                    {apn: .[0], dl_kbps: (.[1] | tonumber), ul_kbps: (.[2] | tonumber)}
                )
            ' "$lte_tmpfile")
        fi
        rm -f "$lte_tmpfile"
    fi

    # --- NR5G AMBR ---
    nr5g_ambr_json="[]"
    nr5g_ambr_lines=$(printf '%s\n' "$raw" | grep '+QNWCFG: "nr5g_ambr"')
    if [ -n "$nr5g_ambr_lines" ]; then
        nr5g_tmpfile="/tmp/qmanager_nr5g_ambr.tmp"
        : > "$nr5g_tmpfile"
        printf '%s\n' "$nr5g_ambr_lines" | while IFS= read -r line; do
            csv=$(printf '%s' "$line" | sed 's/+QNWCFG: "nr5g_ambr",//g' | tr -d ' \r')
            dnn=$(printf '%s' "$csv" | cut -d',' -f1 | tr -d '"')
            unit_dl=$(printf '%s' "$csv" | cut -d',' -f2)
            session_dl=$(printf '%s' "$csv" | cut -d',' -f3)
            unit_ul=$(printf '%s' "$csv" | cut -d',' -f4)
            session_ul=$(printf '%s' "$csv" | cut -d',' -f5)

            mult_dl=$(nr5g_unit_to_kbps "$unit_dl")
            mult_ul=$(nr5g_unit_to_kbps "$unit_ul")
            dl_kbps=$((mult_dl * session_dl))
            ul_kbps=$((mult_ul * session_ul))

            [ -n "$dnn" ] && \
                printf '%s\t%s\t%s\n' "$dnn" "$dl_kbps" "$ul_kbps" >> "$nr5g_tmpfile"
        done
        if [ -s "$nr5g_tmpfile" ]; then
            nr5g_ambr_json=$(jq -Rsc '
                split("\n") | map(select(length > 0) | split("\t") |
                    {dnn: .[0], dl_kbps: (.[1] | tonumber), ul_kbps: (.[2] | tonumber)}
                )
            ' "$nr5g_tmpfile")
        fi
        rm -f "$nr5g_tmpfile"
    fi

    # --- Build response ---
    qlog_info "Settings: slot=$sim_slot cfun=$cfun mode=$mode_pref nr5g=$nr5g_mode roam=$roam_pref"
    jq -n \
        --arg sim_slot "$sim_slot" \
        --arg cfun "$cfun" \
        --arg mode_pref "$mode_pref" \
        --arg nr5g_mode "$nr5g_mode" \
        --arg roam_pref "$roam_pref" \
        --argjson lte_ambr "$lte_ambr_json" \
        --argjson nr5g_ambr "$nr5g_ambr_json" \
        '{
            success: true,
            settings: {
                sim_slot: ($sim_slot | tonumber),
                cfun: ($cfun | tonumber),
                mode_pref: $mode_pref,
                nr5g_mode: ($nr5g_mode | tonumber),
                roam_pref: ($roam_pref | tonumber)
            },
            ambr: {
                lte: $lte_ambr,
                nr5g: $nr5g_ambr
            }
        }'
    exit 0
fi

# =============================================================================
# POST — Apply settings changes
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then

    cgi_read_post

    # --- Extract fields (use "unset" sentinel for missing keys) ---
    SIM_SLOT=$(printf '%s' "$POST_DATA" | jq -r 'if has("sim_slot") then (.sim_slot | tostring) else "unset" end')
    CFUN=$(printf '%s' "$POST_DATA" | jq -r 'if has("cfun") then (.cfun | tostring) else "unset" end')
    MODE_PREF=$(printf '%s' "$POST_DATA" | jq -r 'if has("mode_pref") then .mode_pref else "unset" end')
    NR5G_MODE=$(printf '%s' "$POST_DATA" | jq -r 'if has("nr5g_mode") then (.nr5g_mode | tostring) else "unset" end')
    ROAM_PREF=$(printf '%s' "$POST_DATA" | jq -r 'if has("roam_pref") then (.roam_pref | tostring) else "unset" end')

    qlog_info "Apply settings: slot=$SIM_SLOT cfun=$CFUN mode=$MODE_PREF nr5g=$NR5G_MODE roam=$ROAM_PREF"

    # --- Validate ---
    if [ "$SIM_SLOT" != "unset" ]; then
        case "$SIM_SLOT" in
            1|2) ;;
            *)
                cgi_error "invalid_sim_slot" "SIM slot must be 1 or 2"
                exit 0
                ;;
        esac
    fi

    if [ "$CFUN" != "unset" ]; then
        case "$CFUN" in
            0|1|4) ;;
            *)
                cgi_error "invalid_cfun" "CFUN must be 0, 1, or 4"
                exit 0
                ;;
        esac
    fi

    if [ "$MODE_PREF" != "unset" ]; then
        case "$MODE_PREF" in
            AUTO|LTE|NR5G|WCDMA|LTE:NR5G|LTE:WCDMA|NR5G:LTE:WCDMA) ;;
            *)
                cgi_error "invalid_mode_pref" "Invalid network mode"
                exit 0
                ;;
        esac
    fi

    if [ "$NR5G_MODE" != "unset" ]; then
        case "$NR5G_MODE" in
            0|1|2) ;;
            *)
                cgi_error "invalid_nr5g_mode" "NR5G mode must be 0, 1, or 2"
                exit 0
                ;;
        esac
    fi

    if [ "$ROAM_PREF" != "unset" ]; then
        case "$ROAM_PREF" in
            1|3|255) ;;
            *)
                cgi_error "invalid_roam_pref" "Roaming preference must be 1, 3, or 255"
                exit 0
                ;;
        esac
    fi

    # --- Apply in safe order: nr5g_mode, mode_pref, sim_slot (w/ CFUN procedure), cfun ---
    errors=""
    applied=""
    sim_cfun_restored=""
    sim_switch_verified=""

    # 1. NR5G mode (least disruptive, NVM write)
    if [ "$NR5G_MODE" != "unset" ]; then
        result=$(qcmd "AT+QNWPREFCFG=\"nr5g_disable_mode\",$NR5G_MODE" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "Failed to set nr5g_disable_mode=$NR5G_MODE: $result"
                errors="${errors}nr5g_mode,"
                ;;
            *)
                qlog_info "Set nr5g_disable_mode=$NR5G_MODE"
                applied="${applied}nr5g_mode,"
                ;;
        esac
        sleep "$CMD_GAP"
    fi

    # 2. Roaming preference (NVM write, takes effect immediately)
    if [ "$ROAM_PREF" != "unset" ]; then
        result=$(qcmd "AT+QNWPREFCFG=\"roam_pref\",$ROAM_PREF" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "Failed to set roam_pref=$ROAM_PREF: $result"
                errors="${errors}roam_pref,"
                ;;
            *)
                qlog_info "Set roam_pref=$ROAM_PREF"
                applied="${applied}roam_pref,"
                ;;
        esac
        sleep "$CMD_GAP"
    fi

    # 3. Network mode
    if [ "$MODE_PREF" != "unset" ]; then
        result=$(qcmd "AT+QNWPREFCFG=\"mode_pref\",$MODE_PREF" 2>/dev/null)
        case "$result" in
            *ERROR*)
                qlog_error "Failed to set mode_pref=$MODE_PREF: $result"
                errors="${errors}mode_pref,"
                ;;
            *)
                qlog_info "Set mode_pref=$MODE_PREF"
                applied="${applied}mode_pref,"
                ;;
        esac
        sleep "$CMD_GAP"
    fi

    # 4. SIM slot change (CFUN=0 -> sleep 2 -> QUIMSLOT -> sleep 2 -> CFUN=1,
    #    then a read-back verification). AT+QUIMSLOT=N can return OK while the
    #    modem silently STAYS on the old slot under qcmd lock contention;
    #    trusting that OK would auto-apply the wrong SIM's profile. So the
    #    write is verified via AT+QUIMSLOT? (verify_quimslot, slot_verify.sh),
    #    retried once on mismatch, and only a VERIFIED switch fires the
    #    downstream side effects (sim_db registration, auto-apply, refresh).
    #    This is a radio cycle (CFUN=0/1), not a full modem reboot — the
    #    LAN/HTTP path survives, so it's safe to run inline in this CGI.
    if [ "$SIM_SLOT" != "unset" ]; then
        qlog_info "SIM slot change: starting CFUN=0 -> QUIMSLOT=$SIM_SLOT -> CFUN=1 procedure"
        sim_proceed="1"

        # Step 1: Switch to minimum functionality
        result=$(qcmd "AT+CFUN=0" 2>/dev/null)
        case "$result" in *ERROR*) sim_proceed="" ;; esac

        if [ -z "$sim_proceed" ]; then
            qlog_error "SIM procedure: CFUN=0 failed: $result"
            errors="${errors}sim_slot,"
        else
            qlog_info "SIM procedure: CFUN=0 OK"
            sleep 2

            # Step 2: Change SIM slot
            result=$(qcmd "AT+QUIMSLOT=$SIM_SLOT" 2>/dev/null)
            case "$result" in
                *ERROR*)
                    qlog_error "SIM procedure: QUIMSLOT=$SIM_SLOT failed: $result"
                    ;;
                *)
                    qlog_info "SIM procedure: QUIMSLOT=$SIM_SLOT accepted (pending read-back)"
                    ;;
            esac
            sleep 2

            # Step 3: Restore full functionality
            result=$(qcmd "AT+CFUN=1" 2>/dev/null)
            case "$result" in
                *ERROR*)
                    qlog_error "SIM procedure: CFUN=1 restore failed: $result"
                    ;;
                *)
                    qlog_info "SIM procedure: CFUN=1 restored"
                    sim_cfun_restored="1"
                    ;;
            esac

            # Step 4: Read-back verification. AT+QUIMSLOT? becomes readable
            # shortly after CFUN=1, before full SIM init.
            sim_switch_verified=$(verify_quimslot "$SIM_SLOT")

            if [ -z "$sim_switch_verified" ]; then
                # One full-discipline retry of the write, then re-verify.
                qlog_warn "SIM procedure: QUIMSLOT read-back != $SIM_SLOT after 10 tries; retrying write once"
                qcmd 'AT+CFUN=0' >/dev/null 2>&1
                sleep 2
                qcmd "AT+QUIMSLOT=$SIM_SLOT" >/dev/null 2>&1
                sleep 2
                result=$(qcmd 'AT+CFUN=1' 2>/dev/null)
                case "$result" in
                    *ERROR*) qlog_error "SIM procedure: CFUN=1 restore (retry) failed: $result" ;;
                    *) sim_cfun_restored="1" ;;
                esac
                sim_switch_verified=$(verify_quimslot "$SIM_SLOT")
            fi

            if [ -n "$sim_switch_verified" ]; then
                qlog_info "SIM procedure: QUIMSLOT=$SIM_SLOT verified active"
                applied="${applied}sim_slot,"

                # Auto-apply matching profile for the new SIM (verified switch only)
                sleep 1  # let SIM initialize after CFUN=1
                _new_iccid=$(qcmd 'AT+QCCID' 2>/dev/null | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
                if [ -n "$_new_iccid" ]; then
                    # Register the switched-to SIM in the known-SIMs database so
                    # the Known SIMs count reflects it immediately. A deliberate
                    # slot switch is an expected SIM (like a watchdog failover),
                    # not a physical swap to alert on — this also suppresses a
                    # redundant "New SIM" toast on the next poller boot.
                    ( . /usr/lib/qmanager/sim_db.sh 2>/dev/null && sim_db_add "$_new_iccid" )
                    . /usr/lib/qmanager/profile_mgr.sh 2>/dev/null
                    auto_apply_profile "$_new_iccid" "sim_switch"
                fi
                # Nudge the poller to refresh warm fields (carrier name,
                # SIM slot, APN, phone number) on its next ~2s tick.
                touch /tmp/qmanager_tier2_refresh 2>/dev/null || true
            else
                qlog_error "SIM procedure: QUIMSLOT=$SIM_SLOT NOT verified after retry — modem stayed on old slot"
                errors="${errors}sim_slot,"
            fi
        fi
    fi

    # 5. CFUN change (skip if SIM procedure already restored to user's desired value)
    if [ "$CFUN" != "unset" ]; then
        if [ -n "$sim_cfun_restored" ] && [ "$CFUN" = "1" ]; then
            # SIM slot procedure already set CFUN=1
            qlog_info "CFUN=1 already applied by SIM slot procedure"
            applied="${applied}cfun,"
        else
            sleep "$CMD_GAP"
            result=$(qcmd "AT+CFUN=$CFUN" 2>/dev/null)
            case "$result" in
                *ERROR*)
                    qlog_error "Failed to set CFUN=$CFUN: $result"
                    errors="${errors}cfun,"
                    ;;
                *)
                    qlog_info "Set CFUN=$CFUN"
                    applied="${applied}cfun,"
                    ;;
            esac
        fi
    fi

    # --- Response ---
    if [ -z "$errors" ]; then
        cgi_success
    else
        jq -n --arg errors "$errors" --arg applied "$applied" \
            '{
                success: false,
                error: "partial_failure",
                failed_fields: ($errors | split(",") | map(select(length > 0))),
                applied_fields: ($applied | split(",") | map(select(length > 0)))
            }'
    fi
    exit 0
fi

# --- Method not allowed -------------------------------------------------------
cgi_method_not_allowed
