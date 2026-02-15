#!/bin/sh
# =============================================================================
# parse_at.sh — AT Command Response Parsers for QManager
# =============================================================================
# Sourced by qmanager_poller. All functions here operate on raw AT command
# response strings and populate global state variables defined in the poller.
#
# Dependencies: qlog_* functions (from qlog.sh), global state variables
# Install location: /usr/lib/qmanager/parse_at.sh
# =============================================================================

# --- Sentinel Value Mapping ---------------------------------------------------
# Maps Quectel sentinel values to JSON null for inactive/unavailable antennas.
_sig_val() {
    case "$1" in
        -32768|"") echo "null" ;;
        *) echo "$1" ;;
    esac
}

# Convert 4 antenna values to a JSON array string with sentinel mapping.
# Usage: _antenna_to_json_array val0 val1 val2 val3
# Output: "[-95,-97,null,null]"
_antenna_to_json_array() {
    printf '[%s,%s,%s,%s]' "$(_sig_val "$1")" "$(_sig_val "$2")" "$(_sig_val "$3")" "$(_sig_val "$4")"
}

# Parse a single response line from AT+QRSRP/QRSRQ/QSINR into a JSON array.
# Args: $1=response line (may be empty), $2=prefix (e.g. "QRSRP")
# Output: JSON array string like "[-95,-97,null,null]" on stdout
_antenna_line_to_json() {
    local line="$1" prefix="$2"
    if [ -z "$line" ]; then
        echo "[null,null,null,null]"
        return
    fi
    local csv
    csv=$(printf '%s' "$line" | sed "s/+${prefix}: *//" | tr -d ' \r')
    _antenna_to_json_array \
        "$(printf '%s' "$csv" | cut -d',' -f1)" \
        "$(printf '%s' "$csv" | cut -d',' -f2)" \
        "$(printf '%s' "$csv" | cut -d',' -f3)" \
        "$(printf '%s' "$csv" | cut -d',' -f4)"
}

# --- SCS Enum to kHz Mapping --------------------------------------------------
map_scs_to_khz() {
    case "$1" in
        0) echo 15 ;;
        1) echo 30 ;;
        2) echo 60 ;;
        3) echo 120 ;;
        4) echo 240 ;;
        *) echo "" ;;
    esac
}

# -----------------------------------------------------------------------------
# Parse AT+QENG="servingcell"
# Populates: lte_state, lte_band, lte_earfcn, lte_bandwidth, lte_pci,
#            lte_rsrp, lte_rsrq, lte_sinr, lte_rssi,
#            nr_state, nr_band, nr_arfcn, nr_pci, nr_rsrp, nr_rsrq, nr_sinr,
#            nr_scs, network_type, service_status
# -----------------------------------------------------------------------------
parse_serving_cell() {
    local raw="$1"

    # Reset all fields
    lte_state="unknown"
    nr_state="unknown"
    lte_band="" ; lte_earfcn="" ; lte_bandwidth="" ; lte_pci=""
    lte_rsrp="" ; lte_rsrq="" ; lte_sinr="" ; lte_rssi=""
    nr_band="" ; nr_arfcn="" ; nr_pci=""
    nr_rsrp="" ; nr_rsrq="" ; nr_sinr="" ; nr_scs=""

    # Only keep +QENG: response lines (strip any residual echo/OK lines)
    raw=$(printf '%s\n' "$raw" | grep '^+QENG:')

    if [ -z "$raw" ]; then
        qlog_warn "parse_serving_cell: no +QENG: lines in response"
        service_status="unknown"
        return
    fi

    # --- Detect connection state ---
    local sc_line
    sc_line=$(printf '%s\n' "$raw" | grep '"servingcell"' | head -1)

    case "$sc_line" in
        *'"NOCONN"'*)  service_status="idle" ;;
        *'"LIMSRV"'*)  service_status="limited" ;;
        *'"CONNECT"'*) service_status="connected" ;;
        *'"SEARCH"'*)  service_status="searching" ;;
    esac

    # --- Determine mode ---
    local has_nsa
    local has_sa
    local has_lte
    has_nsa=$(printf '%s\n' "$raw" | grep -c '"NR5G-NSA"')
    has_sa=$(printf '%s\n' "$raw" | grep -c '"NR5G-SA"')
    has_lte=$(printf '%s\n' "$raw" | grep -c '"LTE"')

    # ===== EN-DC / NSA MODE =====
    if [ "$has_nsa" -gt 0 ]; then
        network_type="5G-NSA"

        # LTE line (separate from "servingcell" line in EN-DC)
        local lte_line
        lte_line=$(printf '%s\n' "$raw" | grep '"LTE"' | grep -v '"servingcell"' | head -1)

        if [ -n "$lte_line" ]; then
            lte_state="connected"
            local csv
            csv=$(printf '%s' "$lte_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ')

            # LTE,is_tdd,MCC,MNC,cellID,PCID,earfcn,freq_band_ind,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR
            # 1   2      3   4   5      6    7      8              9     10    11  12   13   14   15
            lte_pci=$(printf '%s' "$csv" | cut -d',' -f6)
            lte_earfcn=$(printf '%s' "$csv" | cut -d',' -f7)
            local band_num
            band_num=$(printf '%s' "$csv" | cut -d',' -f8)
            lte_band="B${band_num}"
            lte_bandwidth=$(printf '%s' "$csv" | cut -d',' -f10)
            lte_rsrp=$(printf '%s' "$csv" | cut -d',' -f12)
            lte_rsrq=$(printf '%s' "$csv" | cut -d',' -f13)
            lte_rssi=$(printf '%s' "$csv" | cut -d',' -f14)
            lte_sinr=$(printf '%s' "$csv" | cut -d',' -f15)
        fi

        # NR5G-NSA line
        local nr_line
        nr_line=$(printf '%s\n' "$raw" | grep '"NR5G-NSA"' | head -1)

        if [ -n "$nr_line" ]; then
            nr_state="connected"
            local csv
            csv=$(printf '%s' "$nr_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ')

            # NR5G-NSA,MCC,MNC,PCID,RSRP,SINR,RSRQ,ARFCN,band,NR_DL_bw,scs
            # 1        2   3   4    5    6    7    8     9    10        11
            nr_pci=$(printf '%s' "$csv" | cut -d',' -f4)
            nr_rsrp=$(printf '%s' "$csv" | cut -d',' -f5)
            nr_sinr=$(printf '%s' "$csv" | cut -d',' -f6)
            nr_rsrq=$(printf '%s' "$csv" | cut -d',' -f7)
            nr_arfcn=$(printf '%s' "$csv" | cut -d',' -f8)
            local nr_band_num
            nr_band_num=$(printf '%s' "$csv" | cut -d',' -f9)
            nr_band="N${nr_band_num}"
            local nr_scs_raw
            nr_scs_raw=$(printf '%s' "$csv" | cut -d',' -f11)
            nr_scs=$(map_scs_to_khz "$nr_scs_raw")
        fi

    # ===== SA MODE =====
    elif [ "$has_sa" -gt 0 ]; then
        network_type="5G-SA"
        lte_state="inactive"
        nr_state="connected"

        local csv
        csv=$(printf '%s' "$sc_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ')

        # servingcell,state,NR5G-SA,duplex,MCC,MNC,cellID,PCID,TAC,ARFCN,band,NR_DL_bw,RSRP,RSRQ,SINR,scs,srxlev
        # 1           2     3       4      5   6   7      8    9   10     11   12       13   14   15   16  17
        nr_pci=$(printf '%s' "$csv" | cut -d',' -f8)
        nr_arfcn=$(printf '%s' "$csv" | cut -d',' -f10)
        local nr_band_num
        nr_band_num=$(printf '%s' "$csv" | cut -d',' -f11)
        nr_band="N${nr_band_num}"
        nr_rsrp=$(printf '%s' "$csv" | cut -d',' -f13)
        nr_rsrq=$(printf '%s' "$csv" | cut -d',' -f14)
        nr_sinr=$(printf '%s' "$csv" | cut -d',' -f15)
        local nr_scs_raw
        nr_scs_raw=$(printf '%s' "$csv" | cut -d',' -f16)
        nr_scs=$(map_scs_to_khz "$nr_scs_raw")

    # ===== LTE-ONLY MODE =====
    elif [ "$has_lte" -gt 0 ]; then
        network_type="LTE"
        nr_state="inactive"

        # LTE-only: "LTE" on the SAME line as "servingcell"
        local csv
        csv=$(printf '%s' "$sc_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ')

        case "$csv" in
            *SEARCH*)
                lte_state="searching"
                return
                ;;
            *NOCONN*)
                lte_state="connected"
                ;;
            *)
                lte_state="connected"
                ;;
        esac

        # servingcell,state,LTE,is_tdd,MCC,MNC,cellID,PCID,earfcn,freq_band_ind,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR,...
        # 1           2     3   4      5   6   7      8    9      10             11    12    13  14   15   16   17
        lte_pci=$(printf '%s' "$csv" | cut -d',' -f8)
        lte_earfcn=$(printf '%s' "$csv" | cut -d',' -f9)
        local band_num
        band_num=$(printf '%s' "$csv" | cut -d',' -f10)
        lte_band="B${band_num}"
        lte_bandwidth=$(printf '%s' "$csv" | cut -d',' -f12)
        lte_rsrp=$(printf '%s' "$csv" | cut -d',' -f14)
        lte_rsrq=$(printf '%s' "$csv" | cut -d',' -f15)
        lte_rssi=$(printf '%s' "$csv" | cut -d',' -f16)
        lte_sinr=$(printf '%s' "$csv" | cut -d',' -f17)

    else
        lte_state="unknown"
        nr_state="unknown"
        service_status="unknown"
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+QTEMP — Average temperature (excluding -273 unavailable sensors)
# Populates: t2_temperature
# -----------------------------------------------------------------------------
parse_temperature() {
    local raw="$1"

    local result
    result=$(printf '%s\n' "$raw" | grep '+QTEMP:' | \
        sed -n 's/.*,"\(-\{0,1\}[0-9]*\)".*/\1/p' | \
        grep -v '^\-273$' | \
        awk '{ sum += $1; count++ } END { if (count > 0) printf "%.0f", sum/count; }')

    if [ -n "$result" ]; then
        t2_temperature="$result"
    else
        t2_temperature=""
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+COPS?
# Populates: t2_carrier
# -----------------------------------------------------------------------------
parse_carrier() {
    local raw="$1"
    local cops_line
    cops_line=$(printf '%s\n' "$raw" | grep '+COPS:' | head -1)

    if [ -z "$cops_line" ]; then
        t2_carrier=""
        return
    fi

    t2_carrier=$(printf '%s' "$cops_line" | sed 's/+COPS: //g' | cut -d',' -f3 | tr -d '"')
}

# -----------------------------------------------------------------------------
# Parse AT+CPIN?
# Populates: t2_sim_status
# -----------------------------------------------------------------------------
parse_sim_status() {
    local raw="$1"

    case "$raw" in
        *"READY"*)         t2_sim_status="ready" ;;
        *"SIM PIN"*)       t2_sim_status="pin_required" ;;
        *"SIM PUK"*)       t2_sim_status="puk_required" ;;
        *"NOT INSERTED"*|*"NOT READY"*) t2_sim_status="not_inserted" ;;
        *ERROR*)           t2_sim_status="error" ;;
        *)                 t2_sim_status="unknown" ;;
    esac
}

# -----------------------------------------------------------------------------
# Parse AT+QUIMSLOT?
# Populates: t2_sim_slot
# -----------------------------------------------------------------------------
parse_sim_slot() {
    local raw="$1"
    local slot_line
    slot_line=$(printf '%s\n' "$raw" | grep '+QUIMSLOT:' | head -1)

    if [ -n "$slot_line" ]; then
        t2_sim_slot=$(printf '%s' "$slot_line" | sed 's/+QUIMSLOT: //g' | tr -d ' \r')
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+CVERSION (Boot-only)
# Populates: boot_firmware, boot_build_date, boot_manufacturer
# -----------------------------------------------------------------------------
parse_version() {
    local raw="$1"

    boot_firmware=$(printf '%s\n' "$raw" | grep '^VERSION:' | sed 's/VERSION: //g' | tr -d '\r')
    boot_build_date=$(printf '%s\n' "$raw" | grep -E '^[A-Z][a-z]{2} [0-9]' | head -1 | awk '{print $1, $2, $3}' | tr -d '\r')
    boot_manufacturer=$(printf '%s\n' "$raw" | grep '^Authors:' | sed 's/Authors: //g' | tr -d '\r')
}

# -----------------------------------------------------------------------------
# Parse AT+QGETCAPABILITY (Boot-only)
# Populates: boot_lte_category
# -----------------------------------------------------------------------------
parse_capability() {
    local raw="$1"

    local cat_line
    cat_line=$(printf '%s\n' "$raw" | grep '+QGETCAPABILITY: LTE-CATEGORY:' | head -1)

    if [ -n "$cat_line" ]; then
        boot_lte_category=$(printf '%s' "$cat_line" | sed 's/+QGETCAPABILITY: LTE-CATEGORY://g' | tr -d ' \r')
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+QNWCFG="lte_mimo_layers" (Boot-only)
# Populates: boot_mimo
# -----------------------------------------------------------------------------
parse_mimo() {
    local raw="$1"

    local mimo_line
    mimo_line=$(printf '%s\n' "$raw" | grep '+QNWCFG: "lte_mimo_layers"' | head -1)

    if [ -n "$mimo_line" ]; then
        local csv
        csv=$(printf '%s' "$mimo_line" | sed 's/+QNWCFG: "lte_mimo_layers",//g' | tr -d ' \r')

        local ul_mimo dl_mimo
        ul_mimo=$(printf '%s' "$csv" | cut -d',' -f1)
        dl_mimo=$(printf '%s' "$csv" | cut -d',' -f2)

        if [ -n "$ul_mimo" ] && [ -n "$dl_mimo" ]; then
            boot_mimo="LTE ${ul_mimo}x${dl_mimo}"
        fi
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+QCAINFO (Tier 2) — Carrier Aggregation status
# Populates: t2_ca_active, t2_ca_count, t2_nr_ca_active, t2_nr_ca_count
# -----------------------------------------------------------------------------
parse_ca_info() {
    local raw="$1"

    # LTE SCC count (lines containing "LTE BAND")
    local lte_scc_count
    lte_scc_count=$(printf '%s\n' "$raw" | grep '+QCAINFO: "SCC"' | grep -c 'LTE BAND')

    if [ "$lte_scc_count" -gt 0 ]; then
        t2_ca_active=true
        t2_ca_count=$lte_scc_count
    else
        t2_ca_active=false
        t2_ca_count=0
    fi

    # NR SCC count (lines containing "NR5G BAND" or "NRDC BAND")
    local nr_scc_count
    nr_scc_count=$(printf '%s\n' "$raw" | grep '+QCAINFO: "SCC"' | grep -c 'NR')

    if [ "$nr_scc_count" -gt 0 ]; then
        t2_nr_ca_active=true
        t2_nr_ca_count=$nr_scc_count
    else
        t2_nr_ca_active=false
        t2_nr_ca_count=0
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+QNWCFG="lte_time_advance" and "nr_time_advance" (Tier 2)
# Populates: lte_ta, nr_ta
# -----------------------------------------------------------------------------
parse_time_advance() {
    local raw="$1"

    # LTE TA: +QNWCFG: "lte_time_advance",<enabled>,<ta>
    # The enable command echoes back as +QNWCFG: "lte_time_advance",1
    # The query echoes back as +QNWCFG: "lte_time_advance",1,<ta>
    # We want the line with 3 fields (the one with the actual TA value)
    local lte_ta_line
    lte_ta_line=$(printf '%s\n' "$raw" | grep '"lte_time_advance"' | awk -F',' 'NF>=3' | head -1)

    if [ -n "$lte_ta_line" ]; then
        local ta_val
        ta_val=$(printf '%s' "$lte_ta_line" | tr -d '"' | tr -d ' ' | tr -d '\r' | awk -F',' '{print $NF}')
        case "$ta_val" in
            *[!0-9-]*|'') lte_ta="" ;;
            *) lte_ta="$ta_val" ;;
        esac
    fi

    # NR TA: +QNWCFG: "nr_time_advance",<enabled>,<nta>
    local nr_ta_line
    nr_ta_line=$(printf '%s\n' "$raw" | grep '"nr_time_advance"' | awk -F',' 'NF>=3' | head -1)

    if [ -n "$nr_ta_line" ]; then
        local nta_val
        nta_val=$(printf '%s' "$nr_ta_line" | tr -d '"' | tr -d ' ' | tr -d '\r' | awk -F',' '{print $NF}')
        case "$nta_val" in
            *[!0-9-]*|'') nr_ta="" ;;
            *) nr_ta="$nta_val" ;;
        esac
    fi
}

# =============================================================================
# PER-ANTENNA SIGNAL PARSERS (Tier 1.5)
# =============================================================================
# AT+QRSRP, AT+QRSRQ, AT+QSINR each return per-antenna-port values.
# Format: +Q<CMD>: <ant0>,<ant1>,<ant2>,<ant3>,<RAT>
# In EN-DC mode, two lines are returned (one LTE, one NR5G).
# Sentinel value -32768 indicates inactive/unavailable antenna port.

# -----------------------------------------------------------------------------
# Parse AT+QRSRP — Per-antenna RSRP
# Populates: sig_lte_rsrp, sig_nr_rsrp (JSON array strings)
# -----------------------------------------------------------------------------
parse_qrsrp() {
    local raw="$1"
    local lte_line nr_line
    lte_line=$(printf '%s\n' "$raw" | grep '+QRSRP:.*LTE' | head -1)
    nr_line=$(printf '%s\n' "$raw" | grep '+QRSRP:.*NR5G' | head -1)
    sig_lte_rsrp=$(_antenna_line_to_json "$lte_line" "QRSRP")
    sig_nr_rsrp=$(_antenna_line_to_json "$nr_line" "QRSRP")
}

# -----------------------------------------------------------------------------
# Parse AT+QRSRQ — Per-antenna RSRQ
# Populates: sig_lte_rsrq, sig_nr_rsrq (JSON array strings)
# -----------------------------------------------------------------------------
parse_qrsrq() {
    local raw="$1"
    local lte_line nr_line
    lte_line=$(printf '%s\n' "$raw" | grep '+QRSRQ:.*LTE' | head -1)
    nr_line=$(printf '%s\n' "$raw" | grep '+QRSRQ:.*NR5G' | head -1)
    sig_lte_rsrq=$(_antenna_line_to_json "$lte_line" "QRSRQ")
    sig_nr_rsrq=$(_antenna_line_to_json "$nr_line" "QRSRQ")
}

# -----------------------------------------------------------------------------
# Parse AT+QSINR — Per-antenna SINR
# Populates: sig_lte_sinr, sig_nr_sinr (JSON array strings)
# -----------------------------------------------------------------------------
parse_qsinr() {
    local raw="$1"
    local lte_line nr_line
    lte_line=$(printf '%s\n' "$raw" | grep '+QSINR:.*LTE' | head -1)
    nr_line=$(printf '%s\n' "$raw" | grep '+QSINR:.*NR5G' | head -1)
    sig_lte_sinr=$(_antenna_line_to_json "$lte_line" "QSINR")
    sig_nr_sinr=$(_antenna_line_to_json "$nr_line" "QSINR")
}
