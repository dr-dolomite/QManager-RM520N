#!/bin/sh
# =============================================================================
# qmanager_poller.sh — QManager Background Poller Daemon
# =============================================================================
# Continuously gathers modem data and system metrics, writes to the
# JSON state cache at /tmp/qmanager_status.json.
#
# Strategy: "Sip, Don't Gulp"
#   - Acquire lock → run ONE AT command → release → sleep → repeat
#   - Leaves gaps for terminal/watchdog to access the modem
#
# Tiers:
#   Tier 1 (Hot):  Every cycle (~2s)  — AT+QENG, /proc reads
#   Tier 2 (Warm): Every 15 cycles    — AT+QTEMP, AT+COPS?, AT+QNWINFO, AT+QCAINFO
#   Boot-only:     Once at startup    — AT+QGMR, AT+CGSN, AT+CIMI, AT+QCCID, AT+CNUM
#
# Install location: /usr/bin/qmanager_poller.sh
# Dependencies: qcmd, jsonfilter (OpenWRT)
# =============================================================================

# --- Configuration -----------------------------------------------------------
CACHE_FILE="/tmp/qmanager_status.json"
CACHE_TMP="/tmp/qmanager_status.json.tmp"
LONG_FLAG="/tmp/qmanager_long_running"
POLL_INTERVAL=2        # seconds between Tier 1 cycles
TIER2_EVERY=15         # Tier 2 runs every N cycles
NETWORK_IFACE="wwan0"  # Network interface for traffic stats
SIP_DELAY=0.1          # Delay between AT commands (seconds)

# --- State Variables ---------------------------------------------------------
cycle_count=0

# Boot-only data (populated once)
boot_firmware=""
boot_imei=""
boot_imsi=""
boot_iccid=""
boot_phone_number=""

# Tier 2 data (updated periodically)
t2_temperature=""
t2_carrier=""
t2_network_type=""
t2_ca_info=""
t2_sim_status=""
t2_phone_number=""

# Tier 1 data (updated every cycle)
# Serving cell fields
lte_state="unknown"
lte_band=""
lte_earfcn=""
lte_bandwidth=""
lte_pci=""
lte_rsrp=""
lte_rsrq=""
lte_sinr=""
lte_rssi=""
lte_srxlev=""

nr_state="unknown"
nr_band=""
nr_arfcn=""
nr_pci=""
nr_rsrp=""
nr_rsrq=""
nr_sinr=""
nr_scs=""

# Network state
network_type=""
sim_slot="1"
service_status="unknown"
system_state="normal"
modem_reachable=true

# Error tracking
errors=""

# Traffic tracking
prev_rx_bytes=0
prev_tx_bytes=0
rx_bytes_per_sec=0
tx_bytes_per_sec=0

# Data usage tracking
total_rx_bytes=0
total_tx_bytes=0

# Connection uptime tracking
conn_uptime_seconds=0
conn_start_time=0

# --- Logging -----------------------------------------------------------------
log_info() {
    logger -t qmanager_poller -p daemon.info "$1"
}

log_warn() {
    logger -t qmanager_poller -p daemon.warn "$1"
}

log_error() {
    logger -t qmanager_poller -p daemon.err "$1"
}

# --- Helper: Safe qcmd Call --------------------------------------------------
# Calls qcmd and returns the raw response. Sets modem_reachable on failure.
qcmd_exec() {
    local cmd="$1"
    local result

    result=$(qcmd "$cmd" 2>/dev/null)
    local exit_code=$?

    if [ $exit_code -ne 0 ] || [ -z "$result" ]; then
        return 1
    fi

    # Check for ERROR or CME ERROR in response
    case "$result" in
        *ERROR*)
            echo "$result"
            return 2  # Command returned error (but modem is reachable)
            ;;
    esac

    echo "$result"
    return 0
}

# --- Parsers -----------------------------------------------------------------

# Parse AT+QENG="servingcell" response
# Response formats (Quectel RM551E-GL):
#
# LTE only:
# +QENG: "servingcell","NOCONN"
# +QENG: "servingcell","CONNECT","LTE","FDD",<mcc>,<mnc>,<cellid>,<pcid>,<earfcn>,<freq_band_ind>,<ul_bandwidth>,<dl_bandwidth>,<tac>,<rsrp>,<rsrq>,<rssi>,<sinr>,<srxlev>,<cqi>,<tx_power>,<dl_aggregated_bw>
#
# NR5G-NSA (LTE anchor + NR secondary):
# +QENG: "servingcell","CONNECT"
# +QENG: "LTE","FDD",<mcc>,<mnc>,<cellid>,<pcid>,<earfcn>,<freq_band_ind>,<ul_bandwidth>,<dl_bandwidth>,<tac>,<rsrp>,<rsrq>,<rssi>,<sinr>,<srxlev>,<cqi>,<tx_power>,<dl_aggregated_bw>
# +QENG: "NR5G-NSA",<mcc>,<mnc>,<pcid>,<rsrp>,<sinr>,<rsrq>,<arfcn>,<band>,<NR_dl_bandwidth>,<scs>
#
# NR5G-SA:
# +QENG: "servingcell","CONNECT"
# +QENG: "NR5G-SA","TDD",<mcc>,<mnc>,<cellid>,<pcid>,<arfcn>,<band>,<NR_dl_bandwidth>,<rsrp>,<rsrq>,<sinr>,<scs>,<srxlev>

parse_serving_cell() {
    local raw="$1"

    # Reset states
    lte_state="unknown"
    nr_state="unknown"

    # Check for NOCONN / LIMSRV / SEARCH
    case "$raw" in
        *'"NOCONN"'*)
            lte_state="disconnected"
            service_status="no_service"
            return
            ;;
        *'"LIMSRV"'*)
            lte_state="limited"
            service_status="limited"
            ;;
        *'"CONNECT"'*)
            service_status="connected"
            ;;
        *'"SEARCH"'*)
            lte_state="searching"
            service_status="searching"
            return
            ;;
    esac

    # --- Parse LTE line ---
    local lte_line
    lte_line=$(echo "$raw" | grep '"LTE"' | head -1)

    if [ -n "$lte_line" ]; then
        lte_state="connected"
        # Strip the +QENG: prefix and quotes, extract CSV fields
        # Format: "LTE","FDD",mcc,mnc,cellid,pcid,earfcn,freq_band_ind,ul_bw,dl_bw,tac,rsrp,rsrq,rssi,sinr,srxlev,...
        local csv
        csv=$(echo "$lte_line" | sed 's/+QENG: //g' | tr -d '"')

        lte_pci=$(echo "$csv" | cut -d',' -f6)
        lte_earfcn=$(echo "$csv" | cut -d',' -f7)
        local band_num
        band_num=$(echo "$csv" | cut -d',' -f8)
        lte_band="B${band_num}"
        lte_bandwidth=$(echo "$csv" | cut -d',' -f10)
        lte_rsrp=$(echo "$csv" | cut -d',' -f12)
        lte_rsrq=$(echo "$csv" | cut -d',' -f13)
        lte_rssi=$(echo "$csv" | cut -d',' -f14)
        lte_sinr=$(echo "$csv" | cut -d',' -f15)
        lte_srxlev=$(echo "$csv" | cut -d',' -f16)
    fi

    # --- Parse NR5G-NSA line ---
    local nr_nsa_line
    nr_nsa_line=$(echo "$raw" | grep '"NR5G-NSA"' | head -1)

    if [ -n "$nr_nsa_line" ]; then
        nr_state="connected"
        network_type="5G-NSA"
        local csv
        csv=$(echo "$nr_nsa_line" | sed 's/+QENG: //g' | tr -d '"')

        # Format: NR5G-NSA,mcc,mnc,pcid,rsrp,sinr,rsrq,arfcn,band,NR_dl_bw,scs
        nr_pci=$(echo "$csv" | cut -d',' -f4)
        nr_rsrp=$(echo "$csv" | cut -d',' -f5)
        nr_sinr=$(echo "$csv" | cut -d',' -f6)
        nr_rsrq=$(echo "$csv" | cut -d',' -f7)
        nr_arfcn=$(echo "$csv" | cut -d',' -f8)
        local nr_band_num
        nr_band_num=$(echo "$csv" | cut -d',' -f9)
        nr_band="N${nr_band_num}"
        nr_scs=$(echo "$csv" | cut -d',' -f11)
        return
    fi

    # --- Parse NR5G-SA line ---
    local nr_sa_line
    nr_sa_line=$(echo "$raw" | grep '"NR5G-SA"' | head -1)

    if [ -n "$nr_sa_line" ]; then
        nr_state="connected"
        lte_state="inactive"
        network_type="5G-SA"
        local csv
        csv=$(echo "$nr_sa_line" | sed 's/+QENG: //g' | tr -d '"')

        # Format: NR5G-SA,TDD,mcc,mnc,cellid,pcid,arfcn,band,NR_dl_bw,rsrp,rsrq,sinr,scs,srxlev
        nr_pci=$(echo "$csv" | cut -d',' -f6)
        nr_arfcn=$(echo "$csv" | cut -d',' -f7)
        local nr_band_num
        nr_band_num=$(echo "$csv" | cut -d',' -f8)
        nr_band="N${nr_band_num}"
        nr_rsrp=$(echo "$csv" | cut -d',' -f10)
        nr_rsrq=$(echo "$csv" | cut -d',' -f11)
        nr_sinr=$(echo "$csv" | cut -d',' -f12)
        nr_scs=$(echo "$csv" | cut -d',' -f13)
        return
    fi

    # LTE only — no NR
    if [ -n "$lte_line" ]; then
        network_type="LTE"
    fi
}

# Parse AT+QTEMP response
# Response: +QTEMP: <tsens_tz_sensor1>,<tsens_tz_sensor2>,...
parse_temperature() {
    local raw="$1"
    local temps
    temps=$(echo "$raw" | grep '+QTEMP:' | head -1 | sed 's/+QTEMP: //g' | tr -d '"')

    if [ -z "$temps" ]; then
        t2_temperature=""
        return
    fi

    # Get the highest temperature from all sensors
    local max_temp=0
    local IFS=','
    for temp in $temps; do
        temp=$(echo "$temp" | tr -d ' ')
        if [ -n "$temp" ] && [ "$temp" -gt "$max_temp" ] 2>/dev/null; then
            max_temp=$temp
        fi
    done
    unset IFS

    t2_temperature="$max_temp"
}

# Parse AT+COPS? response
# Response: +COPS: <mode>,<format>,<oper>,<AcT>
parse_carrier() {
    local raw="$1"
    local cops_line
    cops_line=$(echo "$raw" | grep '+COPS:' | head -1)

    if [ -z "$cops_line" ]; then
        t2_carrier=""
        return
    fi

    t2_carrier=$(echo "$cops_line" | sed 's/+COPS: //g' | cut -d',' -f3 | tr -d '"')
}

# Parse AT+QNWINFO response
# Response: +QNWINFO: <act>,<oper>,<band>,<channel>
parse_network_info() {
    local raw="$1"
    local nw_line
    nw_line=$(echo "$raw" | grep '+QNWINFO:' | head -1)

    if [ -z "$nw_line" ]; then
        return
    fi

    t2_network_type=$(echo "$nw_line" | sed 's/+QNWINFO: //g' | cut -d',' -f1 | tr -d '"')
}

# Parse AT+CPIN? response
# Response: +CPIN: READY | +CPIN: SIM PIN | ERROR
parse_sim_status() {
    local raw="$1"

    case "$raw" in
        *"READY"*)
            t2_sim_status="ready"
            ;;
        *"SIM PIN"*)
            t2_sim_status="pin_required"
            ;;
        *"SIM PUK"*)
            t2_sim_status="puk_required"
            ;;
        *"NOT INSERTED"*|*"NOT READY"*)
            t2_sim_status="not_inserted"
            ;;
        *ERROR*)
            t2_sim_status="error"
            ;;
        *)
            t2_sim_status="unknown"
            ;;
    esac
}

# --- System Metrics (No modem lock needed) -----------------------------------

update_proc_metrics() {
    # --- CPU Load ---
    # /proc/loadavg: 1min 5min 15min running/total last_pid
    local loadavg
    loadavg=$(cat /proc/loadavg 2>/dev/null | cut -d' ' -f1)

    # --- Memory ---
    local mem_total mem_free mem_available mem_used
    mem_total=$(grep '^MemTotal:' /proc/meminfo 2>/dev/null | awk '{print $2}')
    mem_available=$(grep '^MemAvailable:' /proc/meminfo 2>/dev/null | awk '{print $2}')

    # Convert from kB to MB
    if [ -n "$mem_total" ]; then
        mem_total_mb=$((mem_total / 1024))
    else
        mem_total_mb=0
    fi

    if [ -n "$mem_available" ]; then
        mem_used_mb=$(( (mem_total - mem_available) / 1024 ))
    else
        mem_used_mb=0
    fi

    # --- Uptime ---
    local uptime_raw
    uptime_raw=$(cat /proc/uptime 2>/dev/null | cut -d' ' -f1 | cut -d'.' -f1)

    # --- Traffic ---
    local rx_bytes tx_bytes
    if [ -f /proc/net/dev ]; then
        local dev_line
        dev_line=$(grep "$NETWORK_IFACE:" /proc/net/dev 2>/dev/null)
        if [ -n "$dev_line" ]; then
            rx_bytes=$(echo "$dev_line" | awk '{print $2}')
            tx_bytes=$(echo "$dev_line" | awk '{print $10}')
        else
            rx_bytes=0
            tx_bytes=0
        fi
    else
        rx_bytes=0
        tx_bytes=0
    fi

    # Calculate bytes per second (delta from previous cycle)
    if [ "$prev_rx_bytes" -gt 0 ] 2>/dev/null; then
        rx_bytes_per_sec=$(( (rx_bytes - prev_rx_bytes) / POLL_INTERVAL ))
        tx_bytes_per_sec=$(( (tx_bytes - prev_tx_bytes) / POLL_INTERVAL ))

        # Prevent negative values on counter reset
        [ "$rx_bytes_per_sec" -lt 0 ] 2>/dev/null && rx_bytes_per_sec=0
        [ "$tx_bytes_per_sec" -lt 0 ] 2>/dev/null && tx_bytes_per_sec=0
    fi

    prev_rx_bytes=$rx_bytes
    prev_tx_bytes=$tx_bytes

    # Track cumulative data usage
    total_rx_bytes=$rx_bytes
    total_tx_bytes=$tx_bytes

    # Export for JSON
    cpu_usage="$loadavg"
    memory_used_mb="$mem_used_mb"
    memory_total_mb="$mem_total_mb"
    uptime_seconds="${uptime_raw:-0}"
}

# --- Connection Uptime -------------------------------------------------------
update_conn_uptime() {
    if [ "$service_status" = "connected" ] || [ "$service_status" = "optimal" ]; then
        if [ "$conn_start_time" -eq 0 ] 2>/dev/null; then
            conn_start_time=$(date +%s)
        fi
        local now
        now=$(date +%s)
        conn_uptime_seconds=$((now - conn_start_time))
    else
        conn_start_time=0
        conn_uptime_seconds=0
    fi
}

# --- Boot Data Collection ----------------------------------------------------
collect_boot_data() {
    log_info "Collecting boot-only data..."

    local result

    # Firmware version
    result=$(qcmd_exec 'AT+QGMR')
    if [ $? -eq 0 ]; then
        boot_firmware=$(echo "$result" | grep -v '^$' | grep -v 'OK' | grep -v 'AT+' | head -1 | tr -d '\r')
    fi
    sleep "$SIP_DELAY"

    # IMEI
    result=$(qcmd_exec 'AT+CGSN')
    if [ $? -eq 0 ]; then
        boot_imei=$(echo "$result" | grep -v '^$' | grep -v 'OK' | grep -v 'AT+' | head -1 | tr -d '\r')
    fi
    sleep "$SIP_DELAY"

    # IMSI
    result=$(qcmd_exec 'AT+CIMI')
    if [ $? -eq 0 ]; then
        boot_imsi=$(echo "$result" | grep -v '^$' | grep -v 'OK' | grep -v 'AT+' | head -1 | tr -d '\r')
    fi
    sleep "$SIP_DELAY"

    # ICCID
    result=$(qcmd_exec 'AT+QCCID')
    if [ $? -eq 0 ]; then
        boot_iccid=$(echo "$result" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
    fi
    sleep "$SIP_DELAY"

    # Phone number
    result=$(qcmd_exec 'AT+CNUM')
    if [ $? -eq 0 ]; then
        boot_phone_number=$(echo "$result" | grep '+CNUM:' | head -1 | cut -d',' -f2 | tr -d '"' | tr -d '\r')
    fi

    log_info "Boot data collected: FW=$boot_firmware IMEI=$boot_imei"
}

# --- Tier 1: Hot Data --------------------------------------------------------
poll_serving_cell() {
    local result
    result=$(qcmd_exec 'AT+QENG="servingcell"')

    if [ $? -eq 0 ]; then
        modem_reachable=true
        parse_serving_cell "$result"
    elif [ $? -eq 1 ]; then
        # Modem unreachable
        modem_reachable=false
        system_state="degraded"
        lte_state="unknown"
        nr_state="unknown"
        errors="modem_timeout"
        log_warn "Modem unreachable during serving cell poll"
    fi
}

# --- Tier 2: Warm Data -------------------------------------------------------
poll_tier2() {
    local result

    # Temperature
    result=$(qcmd_exec 'AT+QTEMP')
    [ $? -eq 0 ] && parse_temperature "$result"
    sleep "$SIP_DELAY"

    # Carrier
    result=$(qcmd_exec 'AT+COPS?')
    [ $? -eq 0 ] && parse_carrier "$result"
    sleep "$SIP_DELAY"

    # Network type
    result=$(qcmd_exec 'AT+QNWINFO')
    [ $? -eq 0 ] && parse_network_info "$result"
    sleep "$SIP_DELAY"

    # SIM status
    result=$(qcmd_exec 'AT+CPIN?')
    if [ $? -eq 0 ]; then
        parse_sim_status "$result"
    elif [ $? -eq 2 ]; then
        t2_sim_status="error"
        errors="sim_not_inserted"
    fi
    sleep "$SIP_DELAY"

    # Phone number (may change on SIM swap)
    result=$(qcmd_exec 'AT+CNUM')
    if [ $? -eq 0 ]; then
        local num
        num=$(echo "$result" | grep '+CNUM:' | head -1 | cut -d',' -f2 | tr -d '"' | tr -d '\r')
        [ -n "$num" ] && t2_phone_number="$num"
    fi
}

# --- Determine Service Quality -----------------------------------------------
determine_service_status() {
    if [ "$modem_reachable" != "true" ]; then
        service_status="unknown"
        return
    fi

    if [ "$t2_sim_status" = "not_inserted" ] || [ "$t2_sim_status" = "error" ]; then
        service_status="sim_error"
        return
    fi

    if [ "$lte_state" = "disconnected" ] && [ "$nr_state" != "connected" ]; then
        service_status="no_service"
        return
    fi

    if [ "$lte_state" = "searching" ]; then
        service_status="searching"
        return
    fi

    # Evaluate signal quality for "optimal" vs "connected"
    # RSRP thresholds: > -80 excellent, > -100 good, > -110 fair, else poor
    local primary_rsrp
    if [ "$nr_state" = "connected" ] && [ -n "$nr_rsrp" ]; then
        primary_rsrp=$nr_rsrp
    elif [ -n "$lte_rsrp" ]; then
        primary_rsrp=$lte_rsrp
    fi

    if [ -n "$primary_rsrp" ] && [ "$primary_rsrp" -gt -100 ] 2>/dev/null; then
        service_status="optimal"
    else
        service_status="connected"
    fi
}

# --- JSON Writer -------------------------------------------------------------
write_cache() {
    local timestamp
    timestamp=$(date +%s)

    # Determine effective values
    local eff_carrier="${t2_carrier:-${boot_carrier:-}}"
    local eff_phone="${t2_phone_number:-${boot_phone_number:-}}"
    local eff_temperature="${t2_temperature:-null}"
    local eff_lte_cat=""
    local eff_mimo=""

    # Handle null-safe JSON values for optional number fields
    local json_lte_earfcn="${lte_earfcn:-null}"
    local json_lte_pci="${lte_pci:-null}"
    local json_lte_rsrp="${lte_rsrp:-null}"
    local json_lte_rsrq="${lte_rsrq:-null}"
    local json_lte_sinr="${lte_sinr:-null}"
    local json_lte_rssi="${lte_rssi:-null}"
    local json_lte_bandwidth="${lte_bandwidth:-null}"

    local json_nr_arfcn="${nr_arfcn:-null}"
    local json_nr_pci="${nr_pci:-null}"
    local json_nr_rsrp="${nr_rsrp:-null}"
    local json_nr_rsrq="${nr_rsrq:-null}"
    local json_nr_sinr="${nr_sinr:-null}"
    local json_nr_scs="${nr_scs:-null}"

    # Build errors array
    local errors_json="[]"
    if [ -n "$errors" ]; then
        errors_json="[\"${errors}\"]"
    fi

    # Write to temp file first (atomic mv)
    cat > "$CACHE_TMP" << JSONEOF
{
  "timestamp": ${timestamp},
  "system_state": "${system_state}",
  "modem_reachable": ${modem_reachable},
  "last_successful_poll": ${timestamp},
  "errors": ${errors_json},
  "network": {
    "type": "${network_type:-LTE}",
    "sim_slot": ${sim_slot},
    "carrier": "${eff_carrier}",
    "service_status": "${service_status}"
  },
  "lte": {
    "state": "${lte_state}",
    "band": "${lte_band}",
    "earfcn": ${json_lte_earfcn},
    "bandwidth": ${json_lte_bandwidth},
    "pci": ${json_lte_pci},
    "rsrp": ${json_lte_rsrp},
    "rsrq": ${json_lte_rsrq},
    "sinr": ${json_lte_sinr},
    "rssi": ${json_lte_rssi}
  },
  "nr": {
    "state": "${nr_state}",
    "band": "${nr_band}",
    "arfcn": ${json_nr_arfcn},
    "pci": ${json_nr_pci},
    "rsrp": ${json_nr_rsrp},
    "rsrq": ${json_nr_rsrq},
    "sinr": ${json_nr_sinr},
    "scs": ${json_nr_scs}
  },
  "device": {
    "temperature": ${eff_temperature},
    "cpu_usage": ${cpu_usage:-0},
    "memory_used_mb": ${memory_used_mb:-0},
    "memory_total_mb": ${memory_total_mb:-0},
    "uptime_seconds": ${uptime_seconds:-0},
    "conn_uptime_seconds": ${conn_uptime_seconds:-0},
    "firmware": "${boot_firmware}",
    "imei": "${boot_imei}",
    "imsi": "${boot_imsi}",
    "iccid": "${boot_iccid}",
    "phone_number": "${eff_phone}"
  },
  "traffic": {
    "rx_bytes_per_sec": ${rx_bytes_per_sec:-0},
    "tx_bytes_per_sec": ${tx_bytes_per_sec:-0},
    "total_rx_bytes": ${total_rx_bytes:-0},
    "total_tx_bytes": ${total_tx_bytes:-0}
  }
}
JSONEOF

    # Atomic replace
    mv "$CACHE_TMP" "$CACHE_FILE"
}

# --- Poll Cycle --------------------------------------------------------------
poll_cycle() {
    # Check for long-running command flag
    if [ -f "$LONG_FLAG" ]; then
        system_state="scan_in_progress"
        update_proc_metrics
        write_cache
        return
    fi

    # Reset error state each cycle
    errors=""
    system_state="normal"

    # Tier 1: Hot data (every cycle)
    poll_serving_cell
    sleep "$SIP_DELAY"

    # Tier 2: Warm data (every N cycles)
    if [ $((cycle_count % TIER2_EVERY)) -eq 0 ]; then
        poll_tier2
    fi

    # System metrics (no lock needed)
    update_proc_metrics
    update_conn_uptime
    determine_service_status

    # Write the cache
    write_cache

    cycle_count=$((cycle_count + 1))
}

# --- Main Loop ---------------------------------------------------------------
main() {
    log_info "QManager Poller starting..."

    # Collect boot-only data first
    collect_boot_data

    # Initialize /proc baseline
    update_proc_metrics

    # Write initial cache immediately
    write_cache

    log_info "Entering poll loop (interval=${POLL_INTERVAL}s, tier2_every=${TIER2_EVERY})"

    while true; do
        poll_cycle
        sleep "$POLL_INTERVAL"
    done
}

# --- Entry Point -------------------------------------------------------------
main "$@"
