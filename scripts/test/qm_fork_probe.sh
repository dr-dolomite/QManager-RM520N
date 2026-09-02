#!/bin/bash
# =============================================================================
# qm_fork_probe.sh - fork/CPU attribution harness for qmanager_poller
#
# READ-ONLY with respect to production state. Everything it writes lands in
# /tmp/qmprobe/ or /tmp/qm_fork_attribution.txt.
#
# Method:
#   * Sources a copy of /usr/bin/qmanager_poller with main "$@" disabled, so
#     every function and every sourced lib is defined exactly as in production.
#   * Redirects every writable path constant into /tmp/qmprobe.
#   * Replaces qcmd with a record-once/replay stub: the FIRST call for a given
#     AT command hits the real modem, the response is cached, every later call
#     replays from cache. Faithful parse input, no lock contention, no extra
#     AT traffic for the rest of the run.
#   * Wraps each function poll_cycle calls directly, sampling two kernel
#     counters around it:
#       - /proc/self/stat cutime+cstime -> EXACT CPU burned by reaped children
#                                          of THIS process (noise-free).
#       - /proc/stat processes          -> system-wide fork count (noisy; the
#                                          live poller also forks, so this is
#                                          reported with a measured noise floor).
#   * Both samplers use only bash builtins, so the instrument itself forks zero
#     times and does not contaminate what it measures.
#
# bash 3.2 compatible (RM520N-GL ships 3.2.57): no associative arrays.
# =============================================================================

DURATION="${1:-3600}"
# $2 = poller source to profile. Defaults to the installed daemon, so an
# argument-free run is bit-identical to the published baseline. Pass a candidate
# copy in /tmp to profile a de-forked rewrite WITHOUT ever writing /usr/bin on a
# production device.
POLLER_SRC="${2:-/usr/bin/qmanager_poller}"
if [ ! -f "$POLLER_SRC" ] || [ ! -r "$POLLER_SRC" ]; then
    echo "FATAL: poller source not readable: $POLLER_SRC" >&2
    exit 1
fi
PROBE_DIR=/tmp/qmprobe
OUT=/tmp/qm_fork_attribution.txt
FX="$PROBE_DIR/fx"

# QMFP_KEEP_FX=1 carries the recorded AT fixtures across runs instead of
# re-capturing them from the modem.
#
# This exists for before/after comparison. The qcmd stub records each AT
# response once and replays it for the whole run, so the fixtures decide which
# branch of the parser is exercised — and therefore what the run costs. A modem
# that reselects between a baseline run and a candidate run silently changes the
# workload, and the difference shows up as a speedup or a regression that is
# really just a different response. Pinning the fixtures removes device state
# from the comparison entirely rather than hoping it holds still.
#
# Default is unset, so a plain run still captures fresh and stays bit-identical
# in behaviour to the published baseline.
_keep_fx=""
if [ "${QMFP_KEEP_FX:-0}" = "1" ] && [ -d "$FX" ]; then
    _keep_fx=/tmp/qmprobe_fx_keep.$$
    mv "$FX" "$_keep_fx" || exit 1
fi

rm -rf "$PROBE_DIR"
mkdir -p "$FX" || exit 1

if [ -n "$_keep_fx" ]; then
    rm -rf "$FX"
    mv "$_keep_fx" "$FX" || exit 1
fi
: > "$OUT" || exit 1

log() { echo "$*" >> "$OUT"; }

# --- identity ---------------------------------------------------------------
log "=============================================================="
log "QManager poller fork/CPU attribution"
log "=============================================================="
log "date_utc     : $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "uptime_s     : $(cut -d' ' -f1 /proc/uptime)"
log "project      : $(grep -m1 'Project Rev' /etc/quectel-project-version 2>/dev/null | tr -d '\r')"
log "branch       : $(grep -m1 'Branch' /etc/quectel-project-version 2>/dev/null | tr -d '\r')"
log "serial       : $(grep -o 'androidboot.serialno=[^ ]*' /proc/cmdline)"
log "bash         : $BASH_VERSION"
log "busybox      : $(busybox 2>&1 | head -1)"
log "nproc        : $(grep -c ^processor /proc/cpuinfo)"
log "duration_req : ${DURATION}s"
log "poller_src   : $POLLER_SRC"
log "fixtures     : $([ -n "$_keep_fx" ] && echo 'REUSED (pinned across runs)' || echo 'captured fresh')"
log "poller_md5   : $(md5sum "$POLLER_SRC" 2>/dev/null | cut -d' ' -f1)"
log ""

# --- zero-fork kernel counter samplers --------------------------------------
_FKC=0
fk() {
    local k v r
    while read -r k v r; do
        if [ "$k" = "processes" ]; then _FKC=$v; return 0; fi
    done < /proc/stat
}

_UT=0; _ST=0; _CUT=0; _CST=0
cpusnap() {
    local line rest
    read -r line < /proc/self/stat
    rest="${line#*) }"
    set -- $rest
    _UT=${12}; _ST=${13}; _CUT=${14}; _CST=${15}
}

_UPS=0
upsnap() {
    local line
    read -r line < /proc/uptime
    _UPS="${line%%.*}"
}

# --- sanity: samplers must work before anything else ------------------------
fk; cpusnap; upsnap
if [ -z "$_FKC" ] || [ -z "$_CUT" ] || [ "$_FKC" = "0" ]; then
    log "FATAL: kernel counter samplers returned nothing (fk=$_FKC cut=$_CUT)"
    exit 1
fi
log "samplers ok  : processes=$_FKC utime=$_UT stime=$_ST cutime=$_CUT cstime=$_CST uptime=$_UPS"
log ""

# =============================================================================
# PART 1 - per-exec cost microbenchmark
# =============================================================================
# What does ONE fork+exec of each helper actually cost on this CPU? This is the
# multiplier that turns a fork count into a CPU number, and it is the single
# most portable figure in this report.
log "--------------------------------------------------------------"
log "PART 1: cost of one fork+exec, by binary (microseconds of CPU)"
log "--------------------------------------------------------------"
log "name              n   child_ticks   us_cpu_per_exec"

bench_exec() {
    local name="$1"; shift
    local n=200 i=0 a b
    cpusnap; a=$(( _CUT + _CST ))
    # stdin MUST be /dev/null: BusyBox tr ignores a file argument and reads
    # stdin, which hangs the whole harness forever without this.
    while [ $i -lt $n ]; do "$@" >/dev/null 2>&1 </dev/null; i=$(( i + 1 )); done
    cpusnap; b=$(( _CUT + _CST ))
    printf '%-16s %4d   %7d       %8d\n' "$name" "$n" "$(( b - a ))" "$(( (b - a) * 10000 / n ))" >> "$OUT"
}

bench_exec "jq"        jq -n 0
bench_exec "awk"       awk 'BEGIN{x=1}'
bench_exec "grep"      grep -q nomatch /proc/uptime
bench_exec "sed"       sed -n '1p' /proc/uptime
bench_exec "cut"       cut -d' ' -f1 /proc/uptime
bench_exec "tr"        tr -d 'x'
bench_exec "head"      head -1 /proc/uptime
bench_exec "cat"       cat /proc/uptime
bench_exec "date"      date +%s
bench_exec "wc"        wc -l /proc/uptime
bench_exec "stat"      stat -c %Y /proc/uptime
bench_exec "true_bb"   /bin/true

# subshell fork with NO exec - cost lands in the parent's own utime/stime,
# so it needs a different pair of counters.
_bn=200; _bi=0
cpusnap; _ba=$(( _UT + _ST ))
while [ $_bi -lt $_bn ]; do _bx=$(:); _bi=$(( _bi + 1 )); done
cpusnap; _bb=$(( _UT + _ST ))
printf '%-16s %4d   %7d       %8d   (parent utime+stime; fork w/o exec)\n' \
    "subshell" "$_bn" "$(( _bb - _ba ))" "$(( (_bb - _ba) * 10000 / _bn ))" >> "$OUT"
log ""

# =============================================================================
# PART 2 - build the sourceable poller copy
# =============================================================================
sed 's/^main "\$@"[[:space:]]*$/: # probe: main disabled/' \
    "$POLLER_SRC" > "$PROBE_DIR/poller_lib.sh"

if grep -q '^main "\$@"' "$PROBE_DIR/poller_lib.sh"; then
    log "FATAL: could not disable main in the poller copy"
    exit 1
fi
if ! bash -n "$PROBE_DIR/poller_lib.sh"; then
    log "FATAL: poller copy fails syntax check"
    exit 1
fi

# --- qcmd stub: record once from the real modem, then replay -----------------
# Defined BEFORE sourcing so it is in scope; qcmd_exec calls plain qcmd, and a
# shell function shadows the /usr/bin/qcmd binary.
QCMD_REAL=/usr/bin/qcmd
_FX_HITS=0
_FX_MISSES=0
qcmd() {
    local cmd="$1"
    local key="${cmd//[!A-Za-z0-9]/_}"
    local f="$FX/$key"
    if [ ! -f "$f" ]; then
        # cold: one real AT round trip, through the production binary and its
        # own flock, so we never race the live poller.
        "$QCMD_REAL" "$cmd" > "$f" 2>/dev/null
        _FX_MISSES=$(( _FX_MISSES + 1 ))
    else
        _FX_HITS=$(( _FX_HITS + 1 ))
    fi
    local line
    while IFS= read -r line; do printf '%s\n' "$line"; done < "$f"
    return 0
}

# --- source it ---------------------------------------------------------------
. "$PROBE_DIR/poller_lib.sh" || { log "FATAL: sourcing poller copy failed"; exit 1; }

if ! type poll_cycle 2>/dev/null | grep -q function; then
    log "FATAL: poll_cycle not defined after sourcing"
    exit 1
fi

# --- redirect every writable path into the probe sandbox ---------------------
CACHE_FILE="$PROBE_DIR/status.json"
CACHE_TMP="$PROBE_DIR/status.json.tmp"
LONG_FLAG="$PROBE_DIR/long_running"
TIER2_REFRESH_FLAG="$PROBE_DIR/tier2_refresh"
SIGNAL_HISTORY_FILE="$PROBE_DIR/signal_history.json"
PING_HISTORY_FILE="$PROBE_DIR/ping_history.json"
DATA_USED_FILE="$PROBE_DIR/data_used.json"
DATA_USED_TMP="$PROBE_DIR/data_used.json.tmp"
DATA_USED_RESET_FLAG="$PROBE_DIR/data_used_reset"
EVENTS_FILE="$PROBE_DIR/events.json"
PCI_STATE_FILE="$PROBE_DIR/pci_state.json"
_CRASH_SIDECAR="$PROBE_DIR/crash_count_last"
_CRASH_LOG="$PROBE_DIR/modem_crashes.json"
SH_CRASH_LOG="$PROBE_DIR/modem_crashes.json"

# --- neuter outbound side effects -------------------------------------------
email_alert_send() { return 0; }
sms_alert_send()   { return 0; }
_ea_do_send()      { return 0; }
_sa_do_send()      { return 0; }
_ae_dispatch()     { return 0; }
qlog_info()  { return 0; }
qlog_warn()  { return 0; }
qlog_error() { return 0; }
qlog_debug() { return 0; }
qlog_state_change() { return 0; }

# =============================================================================
# PART 3 - wrap the functions poll_cycle calls directly
# =============================================================================
# Only DIRECT callees are wrapped. Anything they call in turn (e.g.
# append_signal_history inside poll_per_antenna_signal, or the parse_at.sh
# parsers) rolls up into its caller, so nothing is double counted.
WRAPPED="update_proc_metrics update_system_health read_ping_data check_alerts poll_serving_cell crash_watcher_check update_data_used poll_per_antenna_signal read_watchcat_state poll_tier2 read_sim_state read_sim_identity append_ping_history update_conn_uptime determine_service_status detect_events write_cache"

_B_FK=0; _B_CH=0
_m_begin() { fk; _B_FK=$_FKC; cpusnap; _B_CH=$(( _CUT + _CST )); }
_m_end() {
    local n="$1"
    fk; cpusnap
    eval "_AF_$n=\$(( \${_AF_$n:-0} + _FKC - _B_FK ))"
    eval "_AC_$n=\$(( \${_AC_$n:-0} + (_CUT + _CST) - _B_CH ))"
    eval "_AN_$n=\$(( \${_AN_$n:-0} + 1 ))"
}

for f in $WRAPPED; do
    if type "$f" 2>/dev/null | grep -q function; then
        eval "_orig_$f() $(declare -f "$f" | tail -n +2)"
        eval "$f() { _m_begin; _orig_$f \"\$@\"; local _rc=\$?; _m_end $f; return \$_rc; }"
    else
        log "note: $f is not a function on this device - skipped"
    fi
done

# =============================================================================
# PART 4 - noise floor
# =============================================================================
# The system-wide processes counter also sees the live poller's forks. Measure
# that background rate while doing nothing, so the fork columns can be corrected.
log "--------------------------------------------------------------"
log "PART 2: background fork noise (live poller + everything else)"
log "--------------------------------------------------------------"
fk; _nf_a=$_FKC; upsnap; _nf_t=$_UPS
sleep 30
fk; _nf_b=$_FKC; upsnap
_nf_secs=$(( _UPS - _nf_t ))
[ "$_nf_secs" -lt 1 ] && _nf_secs=1
NOISE_FPS=$(( (_nf_b - _nf_a) / _nf_secs ))
log "background forks/sec (other processes): $NOISE_FPS  (${_nf_a}->${_nf_b} over ${_nf_secs}s)"
log ""

# =============================================================================
# PART 5 - the run
# =============================================================================
cycle_count=0
_run_cycles=0

report() {
    local elapsed="$1"
    local f n c k tot_ticks tot_forks all
    {
    echo ""
    echo "=============================================================="
    echo "PART 3: per-function attribution"
    echo "=============================================================="
    echo "elapsed_s        : $elapsed"
    echo "cycles           : $_run_cycles"
    # NOTE: _FX_HITS/_FX_MISSES are incremented inside a command substitution,
    # i.e. a subshell, so they never propagate back here. Count the cached
    # fixture files instead, and show their sizes so an all-empty capture
    # (which would make every parse path fraudulently cheap) is visible.
    echo "AT fixtures cached: $(ls -1 "$FX" 2>/dev/null | wc -l) files, $(cat "$FX"/* 2>/dev/null | wc -l) total response lines"
    echo "probe self cpu   : utime=$_UT stime=$_ST  (parent, excl. children)"
    echo "probe child cpu  : cutime=$_CUT cstime=$_CST ticks total=$(( _CUT + _CST ))"
    echo ""
    echo "child_ticks = CPU burned by reaped children (EXACT, per-process, 1 tick = 10ms)"
    echo "fork_delta  = system-wide fork count in window (includes ~${NOISE_FPS}/s noise)"
    echo ""
    printf '%-26s %7s %12s %10s %12s %10s\n' \
        "function" "calls" "child_ticks" "ms/call" "fork_delta" "forks/call"
    printf -- '-------------------------------------------------------------------------------\n'
    tot_ticks=0; tot_forks=0
    for f in $WRAPPED; do
        eval "n=\${_AN_$f:-0}; c=\${_AC_$f:-0}; k=\${_AF_$f:-0}"
        [ "$n" -eq 0 ] && continue
        tot_ticks=$(( tot_ticks + c ))
        tot_forks=$(( tot_forks + k ))
        printf '%-26s %7d %12d %10d %12d %10d\n' \
            "$f" "$n" "$c" "$(( c * 10 / n ))" "$k" "$(( k / n ))"
    done
    printf -- '-------------------------------------------------------------------------------\n'
    printf '%-26s %7d %12d %10s %12d %10s\n' "TOTAL(attributed)" "$_run_cycles" "$tot_ticks" "-" "$tot_forks" "-"
    all=$(( _CUT + _CST ))
    printf '%-26s %7s %12d %10s %12s %10s\n' "unattributed" "-" "$(( all - tot_ticks ))" "-" "-" "-"
    echo ""
    echo "  unattributed = the CA block in poll_cycle + poll_cycle's own body +"
    echo "                 the Part 1 microbenchmark's ~2600 execs."
    echo ""
    if [ "$elapsed" -gt 0 ]; then
        echo "probe CPU share of one core: $(( (_CUT + _CST + _UT + _ST) / elapsed ))%"
        echo "  (ticks/(elapsed*HZ)*100 with HZ=100 reduces to ticks/elapsed)"
    fi
    } >> "$OUT"
}

upsnap; START=$_UPS
END=$(( START + DURATION ))

# Record our own PID so the run can be stopped by pid rather than by a
# `pkill -f` pattern -- a -f pattern also matches the command line of the shell
# doing the killing, which silently kills the wrong process.
echo $$ > /tmp/qmfp.pid

while :; do
    upsnap
    if [ "$_UPS" -ge "$END" ]; then break; fi
    poll_cycle
    _run_cycles=$(( _run_cycles + 1 ))
    # Heartbeat every cycle: cheap, and makes "is it actually progressing?"
    # answerable without guessing from file mtimes.
    echo "cycle=$_run_cycles elapsed=$(( _UPS - START ))/${DURATION}s fixtures=$(ls -1 "$FX" 2>/dev/null | wc -l)" > /tmp/qmfp_heartbeat
    # partial report every 25 cycles so a killed run still yields usable data
    if [ $(( _run_cycles % 25 )) -eq 0 ]; then
        cpusnap
        upsnap
        report "$(( _UPS - START ))"
        echo "### (checkpoint at cycle $_run_cycles - run continues) ###" >> "$OUT"
    fi
    sleep "$POLL_INTERVAL"
done

cpusnap; upsnap
report "$(( _UPS - START ))"
echo "" >> "$OUT"
echo "### RUN COMPLETE ###" >> "$OUT"
