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

[ -n "$_PARSE_AT_LOADED" ] && return 0
_PARSE_AT_LOADED=1

# --- Sentinel Value Mapping ---------------------------------------------------
# Maps Quectel sentinel values to JSON null for inactive/unavailable antennas.
# NOTE: _sig_val and _antenna_to_json_array use printf for performance — these
# run 3+ times per poll cycle and only handle integers/null (no string escaping).
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

# --- Hex-to-Decimal Cell ID Decomposition ------------------------------------
# Converts a hex cell ID to decimal and computes eNodeB/gNodeB ID + Sector ID.
# LTE (28-bit ECI): eNodeB ID = cell_id >> 8,  Sector ID = cell_id & 0xFF
# NR  (36-bit NCI): gNodeB ID = cell_id >> 14, Sector ID = cell_id & 0x3FFF
# Sets globals: _cid_dec, _cid_enb, _cid_sec
# Args: $1=hex_cell_id, $2="nr" for NR bit-split (default: LTE)
#
# NO LONGER CALLED BY parse_serving_cell — the de-fork pass folded this logic
# into that function's single awk pass. Kept because parse_at.sh is a shared
# library sourced by cgi_at.sh and events.sh, so removing exported surface is a
# separate change with its own blast radius and no CPU gain.
_compute_cell_parts() {
    _cid_dec="" ; _cid_enb="" ; _cid_sec=""
    [ -z "$1" ] && return
    _cid_dec=$(printf '%d' "0x$1" 2>/dev/null) || { _cid_dec=""; return; }
    if [ "$2" = "nr" ]; then
        _cid_enb=$((_cid_dec / 16384))
        _cid_sec=$((_cid_dec % 16384))
    else
        _cid_enb=$((_cid_dec / 256))
        _cid_sec=$((_cid_dec % 256))
    fi
}

# Converts a hex string (e.g. TAC) to decimal. Empty input → empty output.
# Note it has NO failure guard, so invalid hex answers 0 rather than empty —
# parse_serving_cell's awk reproduces that.
#
# NO LONGER CALLED BY parse_serving_cell (see _compute_cell_parts above).
_hex_to_dec() {
    [ -z "$1" ] && return
    printf '%d' "0x$1" 2>/dev/null
}

# --- SCS Enum to kHz Mapping --------------------------------------------------
# NO LONGER CALLED BY parse_serving_cell (see _compute_cell_parts above).
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
#            lte_cell_id, lte_enodeb_id, lte_sector_id, lte_tac,
#            nr_state, nr_band, nr_arfcn, nr_pci, nr_rsrp, nr_rsrq, nr_sinr,
#            nr_scs, nr_cell_id, nr_enodeb_id, nr_sector_id, nr_tac,
#            network_type, service_status
# -----------------------------------------------------------------------------
parse_serving_cell() {
    local raw="$1"

    # Reset all fields
    lte_state="unknown"
    nr_state="unknown"
    lte_band="" ; lte_earfcn="" ; lte_bandwidth="" ; lte_pci=""
    lte_rsrp="" ; lte_rsrq="" ; lte_sinr="" ; lte_rssi=""
    lte_cell_id="" ; lte_enodeb_id="" ; lte_sector_id="" ; lte_tac=""
    nr_band="" ; nr_arfcn="" ; nr_pci=""
    nr_rsrp="" ; nr_rsrq="" ; nr_sinr="" ; nr_scs=""
    nr_cell_id="" ; nr_enodeb_id="" ; nr_sector_id="" ; nr_tac=""

    # ONE awk pass emits ONE pipe-delimited record; the walk below is pure bash.
    #
    # awk portability, probed live on BOTH devices — do not assume otherwise:
    #   * strtonum() DOES NOT EXIST (both answer "Call to undefined function"),
    #     hence the manual base-16 loop in hexval().
    #   * a 36-bit NR NCI is exact in awk double arithmetic; print it with %.0f,
    #     never %d.
    #   * toupper / index / substr / split / gsub / sprintf are all present.
    #
    # Two sentinels leave the shell in control of the two globals this function
    # must sometimes NOT touch:
    #   * field 1 is a warn flag, not a message.
    #   * @NC@ in the service_status or network_type slot means "no change".
    #     service_status is left alone when the state token matches none of
    #     NOCONN / LIMSRV / CONNECT / SEARCH; network_type is left alone unless
    #     one of the three mode branches ran.
    #
    # THE CR-STRIPPING ASYMMETRY IS DELIBERATE AND IS PORTED FIELD FOR FIELD.
    # The shell version stripped carriage returns unevenly, and this rewrite
    # reproduces that rather than normalising it, so old and new agree whether or
    # not a CR is on the wire:
    #   * EN-DC LTE line  — csv NOT stripped; only the hex cell-ID (f5) and TAC
    #                       (f11) are. Band, PCI, EARFCN, bandwidth, RSRP, RSRQ,
    #                       RSSI and SINR keep any trailing CR.
    #   * EN-DC NR line   — csv stripped wholesale.
    #   * 5G-SA           — csv NOT stripped; only f7 (cell-ID) and f9 (TAC).
    #                       f16 (SCS) is NOT stripped, so a trailing CR there
    #                       makes the SCS map fall through to empty. Preserved.
    #   * LTE-only        — csv NOT stripped; only f7 (cell-ID) and f13 (TAC).
    #
    # Two more shell behaviours the awk reproduces on purpose:
    #   * cut(1) prints the WHOLE line for any -f when the line holds no
    #     delimiter at all — see f().
    #   * _hex_to_dec had no failure guard, so bash printf answered "0" on
    #     invalid hex, while _compute_cell_parts guarded and answered empty.
    #     hex2dec() and cellparts() keep that split.
    local _rec
    _rec=$(printf '%s\n' "$raw" | awk '
        BEGIN { CR = sprintf("%c", 13); NLINES = 0 }

        /^[+]QENG:/ { NLINES = NLINES + 1; LN[NLINES] = $0 }

        function stripcr(s) { gsub(CR, "", s); return s }

        # sed s/+QENG: //g | tr -d \" | tr -d " " [ | tr -d \r ]
        function mkcsv(s, docr,   t) {
            t = s
            gsub(/[+]QENG: /, "", t)
            gsub(/"/, "", t)
            gsub(/ /, "", t)
            if (docr) t = stripcr(t)
            return t
        }

        function setcsv(s) { CSVSTR = s; NCSV = split(s, CSV, ",") }

        # cut -d, -fN, including its no-delimiter behaviour.
        function f(n) {
            if (NCSV <= 1) return CSVSTR
            if (n > NCSV) return ""
            return CSV[n]
        }

        # Base-16 by hand. Sets HEXOK=0 on any non-hex character.
        function hexval(s,   h, u, i, p, n) {
            HEXOK = 0
            if (length(s) == 0) return 0
            h = "0123456789ABCDEF"
            u = toupper(s)
            n = 0
            for (i = 1; i <= length(u); i++) {
                p = index(h, substr(u, i, 1))
                if (p == 0) return 0
                n = n * 16 + p - 1
            }
            HEXOK = 1
            return n
        }

        # _compute_cell_parts: LTE 28-bit ECI >>8 / &0xFF, NR 36-bit NCI
        # >>14 / &0x3FFF. Invalid or empty hex leaves all three empty.
        function cellparts(hx, isnr,   v) {
            CD = ""; CE = ""; CS = ""
            if (length(hx) == 0) return
            v = hexval(hx)
            if (HEXOK == 0) return
            CD = sprintf("%.0f", v)
            if (isnr) {
                CE = sprintf("%.0f", int(v / 16384))
                CS = sprintf("%.0f", v - int(v / 16384) * 16384)
            } else {
                CE = sprintf("%.0f", int(v / 256))
                CS = sprintf("%.0f", v - int(v / 256) * 256)
            }
        }

        # _hex_to_dec: empty in, empty out; invalid hex answers 0, because the
        # shell version had no guard and bash printf prints 0 on a bad number.
        function hex2dec(hx,   v) {
            if (length(hx) == 0) return ""
            v = hexval(hx)
            if (HEXOK == 0) return "0"
            return sprintf("%.0f", v)
        }

        # map_scs_to_khz. Concatenating "" forces a string compare, so a value
        # carrying a stray character never matches.
        function scs(v,   s) {
            s = v ""
            if (s == "0") return "15"
            if (s == "1") return "30"
            if (s == "2") return "60"
            if (s == "3") return "120"
            if (s == "4") return "240"
            return ""
        }

        function emit(   r) {
            r = warn "|" svc "|" ntype "|" ltest "|" nrst "|"
            r = r lband "|" learfcn "|" lbw "|" lpci "|"
            r = r lrsrp "|" lrsrq "|" lsinr "|" lrssi "|"
            r = r lcid "|" lenb "|" lsec "|" ltac "|"
            r = r nband "|" narfcn "|" npci "|"
            r = r nrsrp "|" nrsrq "|" nsinr "|" nscs "|"
            r = r ncid "|" nenb "|" nsec "|" ntac "|"
            print r "END"
        }

        END {
            warn = 0
            svc = "@NC@"
            ntype = "@NC@"
            ltest = "unknown"
            nrst = "unknown"
            lband = ""; learfcn = ""; lbw = ""; lpci = ""
            lrsrp = ""; lrsrq = ""; lsinr = ""; lrssi = ""
            lcid = ""; lenb = ""; lsec = ""; ltac = ""
            nband = ""; narfcn = ""; npci = ""
            nrsrp = ""; nrsrq = ""; nsinr = ""; nscs = ""
            ncid = ""; nenb = ""; nsec = ""; ntac = ""

            if (NLINES == 0) {
                warn = 1
                svc = "unknown"
                emit()
                exit
            }

            sc = ""
            for (i = 1; i <= NLINES; i++) {
                if (index(LN[i], "\"servingcell\"") > 0) { sc = LN[i]; break }
            }

            if (index(sc, "\"NOCONN\"") > 0)            svc = "idle"
            else if (index(sc, "\"LIMSRV\"") > 0)       svc = "limited"
            else if (index(sc, "\"CONNECT\"") > 0)      svc = "connected"
            else if (index(sc, "\"SEARCH\"") > 0)       svc = "searching"

            hn = 0; hs = 0; hl = 0
            for (i = 1; i <= NLINES; i++) {
                if (index(LN[i], "\"NR5G-NSA\"") > 0) hn = hn + 1
                if (index(LN[i], "\"NR5G-SA\"") > 0)  hs = hs + 1
                if (index(LN[i], "\"LTE\"") > 0)      hl = hl + 1
            }

            if (hn > 0) {
                # ===== EN-DC / NSA MODE =====
                ntype = "5G-NSA"
                ll = ""
                for (i = 1; i <= NLINES; i++) {
                    if (index(LN[i], "\"LTE\"") > 0 && index(LN[i], "\"servingcell\"") == 0) {
                        ll = LN[i]
                        break
                    }
                }
                if (length(ll) > 0) {
                    # LTE,is_tdd,MCC,MNC,cellID,PCID,earfcn,band,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR
                    # 1   2      3   4   5      6    7      8    9     10    11  12   13   14   15
                    ltest = "connected"
                    setcsv(mkcsv(ll, 0))
                    cellparts(stripcr(f(5)), 0)
                    lcid = CD; lenb = CE; lsec = CS
                    lpci = f(6)
                    learfcn = f(7)
                    lband = "B" f(8)
                    lbw = f(10)
                    ltac = hex2dec(stripcr(f(11)))
                    lrsrp = f(12)
                    lrsrq = f(13)
                    lrssi = f(14)
                    lsinr = f(15)
                }
                nline = ""
                for (i = 1; i <= NLINES; i++) {
                    if (index(LN[i], "\"NR5G-NSA\"") > 0) { nline = LN[i]; break }
                }
                if (length(nline) > 0) {
                    # NR5G-NSA,MCC,MNC,PCID,RSRP,SINR,RSRQ,ARFCN,band,NR_DL_bw,scs
                    # 1        2   3   4    5    6    7    8     9    10       11
                    nrst = "connected"
                    setcsv(mkcsv(nline, 1))
                    npci = f(4)
                    nrsrp = f(5)
                    nsinr = f(6)
                    nrsrq = f(7)
                    narfcn = f(8)
                    nband = "N" f(9)
                    nscs = scs(f(11))
                }
            } else if (hs > 0) {
                # ===== SA MODE =====
                # servingcell,state,NR5G-SA,duplex,MCC,MNC,cellID,PCID,TAC,ARFCN,band,NR_DL_bw,RSRP,RSRQ,SINR,scs,srxlev
                # 1           2     3       4      5   6   7      8    9   10    11   12       13   14   15   16  17
                ntype = "5G-SA"
                ltest = "inactive"
                nrst = "connected"
                setcsv(mkcsv(sc, 0))
                cellparts(stripcr(f(7)), 1)
                ncid = CD; nenb = CE; nsec = CS
                npci = f(8)
                ntac = hex2dec(stripcr(f(9)))
                narfcn = f(10)
                nband = "N" f(11)
                nrsrp = f(13)
                nrsrq = f(14)
                nsinr = f(15)
                nscs = scs(f(16))
            } else if (hl > 0) {
                # ===== LTE-ONLY MODE =====
                # servingcell,state,LTE,is_tdd,MCC,MNC,cellID,PCID,earfcn,band,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR,...
                # 1           2     3   4      5   6   7      8    9      10   11    12    13  14   15   16   17
                ntype = "LTE"
                nrst = "inactive"
                setcsv(mkcsv(sc, 0))
                if (index(CSVSTR, "SEARCH") > 0) {
                    # Early return: every radio field stays blank.
                    ltest = "searching"
                    emit()
                    exit
                }
                ltest = "connected"
                cellparts(stripcr(f(7)), 0)
                lcid = CD; lenb = CE; lsec = CS
                lpci = f(8)
                learfcn = f(9)
                lband = "B" f(10)
                lbw = f(12)
                ltac = hex2dec(stripcr(f(13)))
                lrsrp = f(14)
                lrsrq = f(15)
                lrssi = f(16)
                lsinr = f(17)
            } else {
                ltest = "unknown"
                nrst = "unknown"
                svc = "unknown"
            }
            emit()
        }
    ')

    if [ -z "$_rec" ]; then
        qlog_warn "parse_serving_cell: no +QENG: lines in response"
        service_status="unknown"
        return
    fi

    # Pure-bash walk over the record. Same idiom as read_ping_data in the poller.
    local _rest _v
    _rest="$_rec"

    _v="${_rest%%|*}" ; _rest="${_rest#*|}"
    [ "$_v" = "1" ] && qlog_warn "parse_serving_cell: no +QENG: lines in response"

    _v="${_rest%%|*}" ; _rest="${_rest#*|}"
    [ "$_v" = "@NC@" ] || service_status="$_v"

    _v="${_rest%%|*}" ; _rest="${_rest#*|}"
    [ "$_v" = "@NC@" ] || network_type="$_v"

    lte_state="${_rest%%|*}"     ; _rest="${_rest#*|}"
    nr_state="${_rest%%|*}"      ; _rest="${_rest#*|}"
    lte_band="${_rest%%|*}"      ; _rest="${_rest#*|}"
    lte_earfcn="${_rest%%|*}"    ; _rest="${_rest#*|}"
    lte_bandwidth="${_rest%%|*}" ; _rest="${_rest#*|}"
    lte_pci="${_rest%%|*}"       ; _rest="${_rest#*|}"
    lte_rsrp="${_rest%%|*}"      ; _rest="${_rest#*|}"
    lte_rsrq="${_rest%%|*}"      ; _rest="${_rest#*|}"
    lte_sinr="${_rest%%|*}"      ; _rest="${_rest#*|}"
    lte_rssi="${_rest%%|*}"      ; _rest="${_rest#*|}"
    lte_cell_id="${_rest%%|*}"   ; _rest="${_rest#*|}"
    lte_enodeb_id="${_rest%%|*}" ; _rest="${_rest#*|}"
    lte_sector_id="${_rest%%|*}" ; _rest="${_rest#*|}"
    lte_tac="${_rest%%|*}"       ; _rest="${_rest#*|}"
    nr_band="${_rest%%|*}"       ; _rest="${_rest#*|}"
    nr_arfcn="${_rest%%|*}"      ; _rest="${_rest#*|}"
    nr_pci="${_rest%%|*}"        ; _rest="${_rest#*|}"
    nr_rsrp="${_rest%%|*}"       ; _rest="${_rest#*|}"
    nr_rsrq="${_rest%%|*}"       ; _rest="${_rest#*|}"
    nr_sinr="${_rest%%|*}"       ; _rest="${_rest#*|}"
    nr_scs="${_rest%%|*}"        ; _rest="${_rest#*|}"
    nr_cell_id="${_rest%%|*}"    ; _rest="${_rest#*|}"
    nr_enodeb_id="${_rest%%|*}"  ; _rest="${_rest#*|}"
    nr_sector_id="${_rest%%|*}"  ; _rest="${_rest#*|}"
    nr_tac="${_rest%%|*}"
}

# -----------------------------------------------------------------------------
# Parse AT+QTEMP — Average temperature across active sensors
# Populates: t2_temperature
#
# Excludes two sentinel values from the average:
#   -273  → unavailable sensor (e.g. modem-mmw0 when mmWave not present)
#      0  → inactive sensor (e.g. SDR power amplifiers that aren't transmitting)
# Including zero-readings from idle PAs drags the average down below reality
# (e.g. 418/16 = 26°C instead of the correct 418/10 = 42°C).
# -----------------------------------------------------------------------------
parse_temperature() {
    local raw="$1"

    local result
    result=$(printf '%s\n' "$raw" | grep '+QTEMP:' | \
        sed -n 's/.*,"\(-\{0,1\}[0-9]*\)".*/\1/p' | \
        grep -v '^\-273$' | \
        grep -v '^0$' | \
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

    # Strip prefix and CR: "0,0,"Smart",7" or just "2" when deregistered
    local fields
    fields=$(printf '%s' "$cops_line" | sed 's/+COPS: //g' | tr -d '\r')

    # Need at least 3 comma-separated fields for operator name
    local comma_count
    comma_count=$(printf '%s' "$fields" | tr -cd ',' | wc -c)
    if [ "$comma_count" -lt 2 ]; then
        t2_carrier=""
        return
    fi

    t2_carrier=$(printf '%s' "$fields" | cut -d',' -f3 | tr -d '"')
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
# Parse AT+QSIMSTAT?
# Response shape: +QSIMSTAT: <enable>,<inserted_status>
# Populates: t2_sim_inserted (1 = inserted, 0 = not inserted, "" = unknown)
# -----------------------------------------------------------------------------
parse_sim_inserted() {
    local raw="$1"
    local line
    local val

    line=$(printf '%s\n' "$raw" | grep '+QSIMSTAT:' | head -1)
    if [ -z "$line" ]; then
        t2_sim_inserted=""
        return
    fi

    val=$(printf '%s' "$line" | sed 's/+QSIMSTAT: //g' | tr -d ' \r' | cut -d',' -f2)

    # `cut -d',' -f2` on a string with NO comma returns the WHOLE string, not
    # an empty one. So a truncated or garbled `+QSIMSTAT:` line (the same class
    # of short compound-AT line the NR5G AMBR guard above exists for) hands back
    # arbitrary text like `OK`.
    #
    # That value is passed to `jq --argjson` in the poller's write_cache(), and
    # --argjson on non-JSON text is a hard parse error that aborts the ENTIRE
    # single jq invocation building /tmp/qmanager_status.json — so one malformed
    # line would not merely drop `.sim`, it would stop the poller publishing any
    # snapshot at all for that cycle. Constrain the value to the only three
    # things the caller can safely serialize: "0", "1", or "" (which the
    # caller's `${t2_sim_inserted:-null}` turns into a literal JSON null).
    case "$val" in
        0 | 1) t2_sim_inserted="$val" ;;
        *) t2_sim_inserted="" ;;
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
    boot_build_date=$(printf '%s\n' "$raw" | grep -E '^[A-Z][a-z]{2} +[0-9]' | head -1 | awk '{print $1, $2, $3}' | tr -d '\r')
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
# Parse AT+QNWCFG="lte_mimo_layers" / "nr_mimo_layers" (Tier 2)
# Args: $1 = LTE mimo response, $2 = NR mimo response (optional)
# Populates: t2_mimo
# -----------------------------------------------------------------------------
parse_mimo() {
    local lte_raw="$1"
    local nr_raw="$2"

    local lte_part=""
    local nr_part=""

    # LTE MIMO: +QNWCFG: "lte_mimo_layers",<ul>,<dl>
    local lte_line
    lte_line=$(printf '%s\n' "$lte_raw" | grep '+QNWCFG: "lte_mimo_layers"' | head -1)
    if [ -n "$lte_line" ]; then
        local csv
        csv=$(printf '%s' "$lte_line" | sed 's/+QNWCFG: "lte_mimo_layers",//g' | tr -d ' \r')
        local ul_mimo dl_mimo
        ul_mimo=$(printf '%s' "$csv" | cut -d',' -f1)
        dl_mimo=$(printf '%s' "$csv" | cut -d',' -f2)
        if [ -n "$ul_mimo" ] && [ -n "$dl_mimo" ]; then
            lte_part="LTE ${ul_mimo}x${dl_mimo}"
        fi
    fi

    # NR MIMO: +QNWCFG: "nr5g_mimo_layers",<ul>,<dl>
    if [ -n "$nr_raw" ]; then
        local nr_line
        nr_line=$(printf '%s\n' "$nr_raw" | grep '+QNWCFG: "nr5g_mimo_layers"' | head -1)
        if [ -n "$nr_line" ]; then
            local csv
            csv=$(printf '%s' "$nr_line" | sed 's/+QNWCFG: "nr5g_mimo_layers",//g' | tr -d ' \r')
            local ul_mimo dl_mimo
            ul_mimo=$(printf '%s' "$csv" | cut -d',' -f1)
            dl_mimo=$(printf '%s' "$csv" | cut -d',' -f2)
            if [ -n "$ul_mimo" ] && [ -n "$dl_mimo" ]; then
                nr_part="NR ${ul_mimo}x${dl_mimo}"
            fi
        fi
    fi

    # Combine: "LTE 1x4 | NR 2x4" or just "LTE 1x4"
    if [ -n "$lte_part" ] && [ -n "$nr_part" ]; then
        t2_mimo="${lte_part} | ${nr_part}"
    elif [ -n "$lte_part" ]; then
        t2_mimo="$lte_part"
    elif [ -n "$nr_part" ]; then
        t2_mimo="$nr_part"
    fi
}

# --- LTE Resource Blocks → MHz Mapping ----------------------------------------
# QCAINFO uses resource block counts for LTE bandwidth, not the enum used by
# AT+QENG. Mapping per 3GPP 36.101 Table 5.6-1.
_lte_rb_to_mhz() {
    case "$1" in
        6)   echo 1 ;;    # 1.4 MHz — round to 1 for integer math
        15)  echo 3 ;;
        25)  echo 5 ;;
        50)  echo 10 ;;
        75)  echo 15 ;;
        100) echo 20 ;;
        *)   echo 0 ;;
    esac
}

# --- NR Bandwidth Enum → MHz Mapping ------------------------------------------
# Same enum as AT+QENG NR_DL_bandwidth. Mapping per 3GPP 38.101.
_nr_bw_to_mhz() {
    case "$1" in
        0)  echo 5 ;;
        1)  echo 10 ;;
        2)  echo 15 ;;
        3)  echo 20 ;;
        4)  echo 25 ;;
        5)  echo 30 ;;
        6)  echo 40 ;;
        7)  echo 50 ;;
        8)  echo 60 ;;
        9)  echo 70 ;;
        10) echo 80 ;;
        11) echo 90 ;;
        12) echo 100 ;;
        13) echo 200 ;;
        14) echo 400 ;;
        15) echo 35 ;;
        16) echo 45 ;;
        *)  echo 0 ;;
    esac
}

# -----------------------------------------------------------------------------
# Parse AT+QCAINFO (Tier 2) — Carrier Aggregation status + bandwidth +
#   per-carrier component details
# Populates: t2_ca_active, t2_ca_count, t2_nr_ca_active, t2_nr_ca_count,
#            t2_total_bandwidth_mhz, t2_bandwidth_details,
#            t2_carrier_components (JSON array string)
#
# Per-carrier component output (JSON array):
#   [{"type":"PCC","technology":"LTE","band":"B3","earfcn":1350,
#     "bandwidth_mhz":15,"pci":135,"rsrp":-115,"rsrq":-15,
#     "rssi":-82,"sinr":5}, ...]
#
# AT+QCAINFO response formats (all fields after stripping +QCAINFO: and quotes/spaces):
#
# LTE PCC/SCC: type,freq,bw_rb,LTEBAND<N>,state,PCI,RSRP,RSRQ,RSSI,RSSNR[,...]
#   Positions:  1    2    3     4          5     6   7    8    9    10
#
# NR short (PCC or old SCC): type,freq,bw_enum,NR5GBAND<N>,PCI[,RSRP,RSRQ[,SNR]]
#   Positions:                1    2    3       4           5  6    7     8
#   Total fields: 5-8
#
# NR long (SCC with UL info): type,freq,bw_enum,NR5GBAND<N>,state,PCI,UL_cfg,UL_bw,UL_ARFCN[,RSRP,RSRQ[,SNR]]
#   Positions:                 1    2    3       4           5     6   7      8     9       10   11    12
#   Total fields: 9-12
#
# NR_SNR conversion: actual_dB = raw_value / 100 (3GPP)
# -----------------------------------------------------------------------------
parse_ca_info() {
    local raw="$1"

    # --- CA counts ---
    local lte_scc_count
    lte_scc_count=$(printf '%s\n' "$raw" | grep '+QCAINFO: "SCC"' | grep -c 'LTE BAND')

    if [ "$lte_scc_count" -gt 0 ]; then
        t2_ca_active=true
        t2_ca_count=$lte_scc_count
    else
        t2_ca_active=false
        t2_ca_count=0
    fi

    local nr_scc_count
    nr_scc_count=$(printf '%s\n' "$raw" | grep '+QCAINFO: "SCC"' | grep -c 'NR')

    if [ "$nr_scc_count" -gt 0 ]; then
        # In NSA mode, the first NR SCC is the NR leg itself (LTE is PCC).
        # True NR CA only when there are 2+ NR SCCs.
        if [ "$network_type" = "5G-NSA" ]; then
            if [ "$nr_scc_count" -gt 1 ]; then
                t2_nr_ca_active=true
                t2_nr_ca_count=$((nr_scc_count - 1))
            else
                t2_nr_ca_active=false
                t2_nr_ca_count=0
            fi
        else
            t2_nr_ca_active=true
            t2_nr_ca_count=$nr_scc_count
        fi
    else
        t2_nr_ca_active=false
        t2_nr_ca_count=0
    fi

    # --- Bandwidth + per-carrier component parsing ---
    local total_mhz=0
    local details=""
    local cc_tmpfile="/tmp/qmanager_cc_data.tmp"
    : > "$cc_tmpfile"
    local qca_lines
    qca_lines=$(printf '%s\n' "$raw" | grep '^+QCAINFO:')

    if [ -z "$qca_lines" ]; then
        t2_total_bandwidth_mhz=0
        t2_bandwidth_details=""
        t2_carrier_components="[]"
        return
    fi

    # Process via file redirect to avoid BusyBox subshell trap.
    local tmpfile="/tmp/qmanager_ca_parse.tmp"
    printf '%s\n' "$qca_lines" > "$tmpfile"

    while IFS= read -r line; do
        # Strip prefix, quotes, spaces, carriage returns
        local csv
        csv=$(printf '%s' "$line" | sed 's/+QCAINFO: //g' | tr -d '"' | tr -d ' ' | tr -d '\r')

        # POSIX field splitting — one substitution instead of 10 cut forks.
        local _OLD_IFS=$IFS
        IFS=','
        # shellcheck disable=SC2086 # intentional word splitting on commas
        set -- $csv
        IFS=$_OLD_IFS
        local nfields=$#

        [ "$nfields" -lt 4 ] && continue

        local cc_type="$1"
        local freq="$2"
        local bw_raw="$3"
        local band_str="$4"

        local tech="" band_short="" mhz=0
        local cc_pci="null" cc_rsrp="null" cc_rsrq="null" cc_rssi="null" cc_sinr="null"

        case "$band_str" in
            LTEBAND*)
                # ---- LTE line ----
                # Positions: type(1),freq(2),bw(3),band(4),state(5),PCI(6),RSRP(7),RSRQ(8),RSSI(9),RSSNR(10)
                tech="LTE"
                mhz=$(_lte_rb_to_mhz "$bw_raw")
                local band_num
                band_num=$(printf '%s' "$band_str" | sed 's/LTEBAND//')
                band_short="B${band_num}"

                [ "$nfields" -ge 6 ]  && cc_pci="$6"
                [ "$nfields" -ge 7 ]  && cc_rsrp="$7"
                [ "$nfields" -ge 8 ]  && cc_rsrq="$8"
                [ "$nfields" -ge 9 ]  && cc_rssi="$9"
                [ "$nfields" -ge 10 ] && cc_sinr="${10}"
                ;;
            NR5GBAND*|NRDCBAND*)
                # ---- NR line ----
                tech="NR"
                mhz=$(_nr_bw_to_mhz "$bw_raw")
                local band_num
                band_num=$(printf '%s' "$band_str" | sed 's/NR5GBAND//;s/NRDCBAND//')
                band_short="N${band_num}"

                if [ "$nfields" -ge 9 ]; then
                    # Long form (SCC with UL info):
                    # type(1),freq(2),bw(3),band(4),state(5),PCI(6),UL_cfg(7),UL_bw(8),UL_ARFCN(9)[,RSRP(10),RSRQ(11)[,SNR(12)]]
                    [ "$nfields" -ge 6 ]  && cc_pci="$6"
                    [ "$nfields" -ge 10 ] && cc_rsrp="${10}"
                    [ "$nfields" -ge 11 ] && cc_rsrq="${11}"
                    if [ "$nfields" -ge 12 ]; then
                        local raw_snr="${12}"
                        case "$raw_snr" in
                            -32768) cc_sinr="null" ;;
                            *) cc_sinr=$(printf '%s' "$raw_snr" | awk '{if($1+0==$1) printf "%.1f", $1/100; else print "null"}') ;;
                        esac
                    fi
                else
                    # Short form (PCC or old SCC):
                    # type(1),freq(2),bw(3),band(4),PCI(5)[,RSRP(6),RSRQ(7)[,SNR(8)]]
                    [ "$nfields" -ge 5 ] && cc_pci="$5"
                    [ "$nfields" -ge 6 ] && cc_rsrp="$6"
                    [ "$nfields" -ge 7 ] && cc_rsrq="$7"
                    if [ "$nfields" -ge 8 ]; then
                        local raw_snr="$8"
                        case "$raw_snr" in
                            -32768) cc_sinr="null" ;;
                            *) cc_sinr=$(printf '%s' "$raw_snr" | awk '{if($1+0==$1) printf "%.1f", $1/100; else print "null"}') ;;
                        esac
                    fi
                fi
                ;;
            *)
                # Unrecognized band string — skip
                continue
                ;;
        esac

        # --- Accumulate bandwidth totals ---
        if [ "$mhz" -gt 0 ] 2>/dev/null; then
            total_mhz=$((total_mhz + mhz))
            if [ -n "$details" ]; then
                details="${details} + ${band_short}: ${mhz} MHz"
            else
                details="${band_short}: ${mhz} MHz"
            fi
        fi

        # --- Sanitize numeric fields (empty / dash / non-numeric → null) ---
        case "$cc_pci"  in ''|'-'|*[!0-9-]*) cc_pci="null"  ;; esac
        case "$cc_rsrp" in ''|'-'|*[!0-9-]*) cc_rsrp="null" ;; esac
        case "$cc_rsrq" in ''|'-'|*[!0-9-]*) cc_rsrq="null" ;; esac
        case "$cc_rssi" in ''|'-'|*[!0-9-]*) cc_rssi="null" ;; esac
        # cc_sinr may be a float (NR /100 conversion) — validated by awk above
        case "$cc_sinr" in ''|'-') cc_sinr="null" ;; esac

        # --- Write carrier data for jq processing ---
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$cc_type" "$tech" "$band_short" "${freq:-null}" "$mhz" \
            "$cc_pci" "$cc_rsrp" "$cc_rsrq" "$cc_rssi" "$cc_sinr" >> "$cc_tmpfile"

    done < "$tmpfile"
    rm -f "$tmpfile"

    t2_total_bandwidth_mhz=$total_mhz
    t2_bandwidth_details="$details"

    if [ -s "$cc_tmpfile" ]; then
        t2_carrier_components=$(jq -Rs '
            split("\n") | map(select(length > 0) | split("\t")) | map({
                type: .[0],
                technology: .[1],
                band: .[2],
                earfcn: (.[3] | if . == "null" then null else tonumber end),
                bandwidth_mhz: (.[4] | tonumber),
                pci: (.[5] | if . == "null" then null else tonumber end),
                rsrp: (.[6] | if . == "null" then null else tonumber end),
                rsrq: (.[7] | if . == "null" then null else tonumber end),
                rssi: (.[8] | if . == "null" then null else tonumber end),
                sinr: (.[9] | if . == "null" then null else tonumber end)
            })
        ' "$cc_tmpfile")
    else
        t2_carrier_components="[]"
    fi
    rm -f "$cc_tmpfile"
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
    # We want the line with 3+ fields (the one with the actual TA value)
    local lte_ta_line
    lte_ta_line=$(printf '%s\n' "$raw" | grep '"lte_time_advance"' | awk -F',' 'NF>=3' | head -1)

    if [ -n "$lte_ta_line" ]; then
        local ta_val
        ta_val=$(printf '%s' "$lte_ta_line" | tr -d '"' | tr -d ' ' | tr -d '\r' | awk -F',' '{print $3}')
        case "$ta_val" in
            *[!0-9-]*|'') lte_ta="" ;;
            *) lte_ta="$ta_val" ;;
        esac
    fi

    # NR TA: +QNWCFG: "nr5g_time_advance",<enabled>,<nta>,<extra>
    # Response has 4 fields — TA value is field 3, NOT last field
    local nr_ta_line
    nr_ta_line=$(printf '%s\n' "$raw" | grep '"nr5g_time_advance"' | awk -F',' 'NF>=3' | head -1)

    if [ -n "$nr_ta_line" ]; then
        local nta_val
        nta_val=$(printf '%s' "$nr_ta_line" | tr -d '"' | tr -d ' ' | tr -d '\r' | awk -F',' '{print $3}')
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

# =============================================================================
# CELLULAR INFORMATION PARSERS (Tier 2)
# =============================================================================

# -----------------------------------------------------------------------------
# Parse AT+CGCONTRDP — APN name and DNS servers
# Uses the first non-IMS profile (skips lines where APN is "ims").
#
# Response format:
#   +CGCONTRDP: <cid>,<bearer_id>,"<apn>","<local_addr>",<subnet>,"<dns_prim>","<dns_sec>"
# Example:
#   +CGCONTRDP: 1,5,"SMARTBRO","10.110.61.83",,"10.151.151.44","10.151.151.48"
#   +CGCONTRDP: 2,6,"ims","36.4.216.0...",...
#
# Dual-stack (IPv4v6) profiles return TWO +CGCONTRDP records for the same
# context — one IPv4, one IPv6. Some firmwares emit them with bare CR
# separators (no LF), so the records collapse onto a single line for
# line-oriented tools and fields from both records get glued together
# (e.g. secondary_dns ends up as "10.177.0.34253.0.151.106..."). The
# normalization below converts every CR to LF up front so each record sits
# on its own line regardless of what the modem emits.
#
# Populates: t2_apn, t2_primary_dns, t2_secondary_dns
# -----------------------------------------------------------------------------
parse_cgcontrdp() {
    local raw="$1"

    t2_apn=""
    t2_primary_dns=""
    t2_secondary_dns=""

    # Normalize line endings: convert all CR to LF so each +CGCONTRDP
    # record lives on its own line (handles CRLF, bare CR, and mixed).
    local normalized
    normalized=$(printf '%s' "$raw" | tr '\r' '\n' | sed '/^$/d')

    # First non-IMS +CGCONTRDP record. The APN must be compared AFTER
    # stripping quotes, not with grep -iv '"ims"': SDX55 firmware
    # (RG501Q-EU) emits this response with no quotes at all, so the quoted
    # pattern silently fails to match its 2,6,ims,... record. That was
    # survivable only because cid 1 happens to sort first and head -1 took
    # it; had the modem ever emitted cid 2 first, the poller would have
    # published "ims" as the WAN APN.
    local data_line
    data_line=$(printf '%s\n' "$normalized" | grep '^+CGCONTRDP:' | awk '
        {
            line = $0
            sub(/^\+CGCONTRDP:[ \t]*/, "", line)
            n = split(line, f, ",")
            apn = f[3]
            gsub(/"/, "", apn)
            gsub(/^[ \t]+|[ \t]+$/, "", apn)
            if (tolower(apn) != "ims") { print; exit }
        }')

    if [ -z "$data_line" ]; then
        qlog_debug "parse_cgcontrdp: no non-IMS CGCONTRDP line found"
        return
    fi

    local csv
    csv=$(printf '%s' "$data_line" | sed 's/^+CGCONTRDP: //')

    # Field 3: APN (quoted)
    t2_apn=$(printf '%s' "$csv" | cut -d',' -f3 | tr -d '"' | tr -d ' ')

    # Field 6: Primary DNS (quoted)
    t2_primary_dns=$(printf '%s' "$csv" | cut -d',' -f6 | tr -d '"' | tr -d ' ')

    # Field 7: Secondary DNS (quoted)
    t2_secondary_dns=$(printf '%s' "$csv" | cut -d',' -f7 | tr -d '"' | tr -d ' ')
}

# -----------------------------------------------------------------------------
# Parse AT+QMAP="WWAN" — WAN IPv4 and IPv6 addresses
#
# Response format:
#   +QMAP: "WWAN",<connected>,<mux_id>,"IPV4","<ipv4_addr>"
#   +QMAP: "WWAN",<connected>,<mux_id>,"IPV6","<ipv6_addr>"
# Example:
#   +QMAP: "WWAN",1,1,"IPV4","10.110.61.83"
#   +QMAP: "WWAN",0,1,"IPV6","0:0:0:0:0:0:0:0"
#
# IPv6 "0:0:0:0:0:0:0:0" (all zeros) means no IPv6 assigned.
#
# Populates: t2_wan_ipv4, t2_wan_ipv6
# -----------------------------------------------------------------------------
parse_wan_ip() {
    local raw="$1"

    t2_wan_ipv4=""
    t2_wan_ipv6=""

    # IPv4 line
    local ipv4_line
    ipv4_line=$(printf '%s\n' "$raw" | grep '+QMAP:' | grep '"IPV4"' | head -1)

    if [ -n "$ipv4_line" ]; then
        local csv
        csv=$(printf '%s' "$ipv4_line" | sed 's/+QMAP: //g' | tr -d '\r')
        t2_wan_ipv4=$(printf '%s' "$csv" | cut -d',' -f5 | tr -d '"' | tr -d ' ')
    fi

    # IPv6 line
    local ipv6_line
    ipv6_line=$(printf '%s\n' "$raw" | grep '+QMAP:' | grep '"IPV6"' | head -1)

    if [ -n "$ipv6_line" ]; then
        local csv
        csv=$(printf '%s' "$ipv6_line" | sed 's/+QMAP: //g' | tr -d '\r')
        local ipv6_val
        ipv6_val=$(printf '%s' "$csv" | cut -d',' -f5 | tr -d '"' | tr -d ' ')

        # All-zeros means no IPv6 assigned
        case "$ipv6_val" in
            0:0:0:0:0:0:0:0|::|0::0|'') t2_wan_ipv6="" ;;
            *) t2_wan_ipv6="$ipv6_val" ;;
        esac
    fi
}

# =============================================================================
# BAND SUPPORT: AT+QNWPREFCFG="policy_band" (Boot-only)
# =============================================================================
# Parses the modem's hardware-supported band lists.
# Response format:
#   +QNWPREFCFG: "gw_band",1:2:4:5:6:8:19
#   +QNWPREFCFG: "lte_band",1:2:3:4:5:7:8:12:...
#   +QNWPREFCFG: "nsa_nr5g_band",1:2:3:5:7:8:...
#   +QNWPREFCFG: "nr5g_band",1:2:3:5:7:8:...
#   +QNWPREFCFG: "nrdc_nr5g_band",1:2:3:5:7:8:...
#
# Sets: boot_supported_lte_bands, boot_supported_nsa_nr5g_bands,
#        boot_supported_sa_nr5g_bands (colon-delimited strings)

parse_policy_band() {
    local raw="$1"

    boot_supported_lte_bands=""
    boot_supported_nsa_nr5g_bands=""
    boot_supported_sa_nr5g_bands=""

    # Extract colon-delimited band list after the key name for each type.
    # Format per line: +QNWPREFCFG: "<key>",<bands>
    local line

    line=$(printf '%s\n' "$raw" | grep '"lte_band"' | head -1)
    if [ -n "$line" ]; then
        boot_supported_lte_bands=$(printf '%s' "$line" | sed 's/.*"lte_band",//' | tr -d '\r ')
    fi

    line=$(printf '%s\n' "$raw" | grep '"nsa_nr5g_band"' | head -1)
    if [ -n "$line" ]; then
        boot_supported_nsa_nr5g_bands=$(printf '%s' "$line" | sed 's/.*"nsa_nr5g_band",//' | tr -d '\r ')
    fi

    # grep -v excludes nsa_ and nrdc_ lines that also contain "nr5g_band"
    line=$(printf '%s\n' "$raw" | grep '"nr5g_band"' | grep -v 'nsa_' | grep -v 'nrdc_' | head -1)
    if [ -n "$line" ]; then
        boot_supported_sa_nr5g_bands=$(printf '%s' "$line" | sed 's/.*"nr5g_band",//' | tr -d '\r ')
    fi

    qlog_debug "policy_band: LTE=$boot_supported_lte_bands NSA=$boot_supported_nsa_nr5g_bands SA=$boot_supported_sa_nr5g_bands"
}

# =============================================================================
# IP Passthrough (IPPT) — boot-time parsers
# =============================================================================

# AT+QMAP="MPDN_RULE" → boot_ippt_mode ("disabled"|"eth"|"usb"), boot_ippt_mac
parse_ippt_mpdn_rule() {
    local raw="$1"
    local rule0 ippt_mode

    boot_ippt_mode="disabled"
    boot_ippt_mac=""

    rule0=$(printf '%s\n' "$raw" | grep '"MPDN_rule",0,')
    [ -z "$rule0" ] && return 0

    # Field 5 = IPPT_mode; +0 avoids BusyBox gsub $N rebuild bug
    ippt_mode=$(printf '%s' "$rule0" | awk -F',' '{print $5+0}')
    case "$ippt_mode" in
        1)
            boot_ippt_mode="eth"
            boot_ippt_mac=$(printf '%s' "$rule0" | awk -F',' 'NF>=7 {gsub(/"/, "", $7); print $7}')
            ;;
        3)
            boot_ippt_mode="usb"
            boot_ippt_mac=$(printf '%s' "$rule0" | awk -F',' 'NF>=7 {gsub(/"/, "", $7); print $7}')
            ;;
    esac

    qlog_debug "ippt_mpdn_rule: mode=$boot_ippt_mode mac=$boot_ippt_mac"
}

# AT+QMAP="IPPT_NAT" → boot_ippt_nat ("0"|"1")
parse_ippt_nat() {
    local raw="$1"
    local nat_val

    boot_ippt_nat="1"

    nat_val=$(printf '%s\n' "$raw" | awk -F',' '/IPPT_NAT/{print $2+0; exit}')
    case "$nat_val" in
        0|1) boot_ippt_nat="$nat_val" ;;
    esac

    qlog_debug "ippt_nat: $boot_ippt_nat"
}

# AT+QCFG="usbnet" → boot_ippt_usbnet ("0"|"1"|"2"|"3")
parse_ippt_usbnet() {
    local raw="$1"
    local usb_val

    boot_ippt_usbnet="1"

    usb_val=$(printf '%s\n' "$raw" | awk -F',' '/usbnet/{print $2+0; exit}')
    case "$usb_val" in
        0|1|2|3) boot_ippt_usbnet="$usb_val" ;;
    esac

    qlog_debug "ippt_usbnet: $boot_ippt_usbnet"
}

# AT+QMAP="DHCPV4DNS" → boot_ippt_dhcpv4dns ("enabled"|"disabled")
parse_ippt_dhcpv4dns() {
    local raw="$1"
    local dns_val

    boot_ippt_dhcpv4dns="disabled"

    dns_val=$(printf '%s\n' "$raw" | awk -F'"' '/DHCPV4DNS/{print $4; exit}')
    case "$dns_val" in
        enable) boot_ippt_dhcpv4dns="enabled" ;;
    esac

    qlog_debug "ippt_dhcpv4dns: $boot_ippt_dhcpv4dns"
}

# -----------------------------------------------------------------------------
# Parse AT+QMAP="LANIP" — DHCP range and device LAN gateway
#
# Response format (canonical):
#   +QMAP: "LANIP",<dhcp_start_ip>,<dhcp_end_ip>,<gateway_ip>
# Example:
#   +QMAP: "LANIP",192.168.225.100,192.168.227.99,192.168.225.1
#
# Some firmwares may quote the IPs or omit fields; treat anything that
# doesn't dot-decimal-shape as missing rather than emitting garbage.
#
# Populates: boot_lan_ip (gateway = device IP), boot_lan_gateway
#
# Note: field 2 is the DHCP start range, NOT the device's own IP. The device
# IP is the gateway (field 4). Both boot_lan_ip and boot_lan_gateway are set
# to that gateway so consumers don't have to know the QMAP semantics.
# -----------------------------------------------------------------------------
parse_lan_ip() {
    local raw="$1"
    local line gateway

    boot_lan_ip=""
    boot_lan_gateway=""

    line=$(printf '%s\n' "$raw" | grep '+QMAP:.*"LANIP"' | head -1 | tr -d '\r')
    [ -z "$line" ] && {
        qlog_debug "lan_ip: no +QMAP LANIP line in response (firmware may not support it)"
        return 0
    }

    # Strip prefix and surrounding spaces, drop quotes around values.
    line=$(printf '%s' "$line" | sed 's/+QMAP: //; s/"//g' | tr -d ' ')

    # Field 4 = gateway (the device's own LAN IP). awk over $0 because
    # BusyBox `cut -d, -f4` returns empty silently when the field is absent.
    gateway=$(printf '%s' "$line" | awk -F',' 'NF>=4 {print $4}')

    # Sanity: must look like a dotted-quad. Reject anything else.
    case "$gateway" in
        [0-9]*.[0-9]*.[0-9]*.[0-9]*)
            boot_lan_gateway="$gateway"
            boot_lan_ip="$gateway"
            ;;
        *)
            qlog_warn "lan_ip: unexpected LANIP format, gateway not parsed: $line"
            ;;
    esac

    qlog_debug "lan_ip: gateway=$boot_lan_gateway"
}
