#!/bin/bash
# =============================================================================
# poller-defork-equivalence.sh — behavioural regression net for the de-fork pass
# =============================================================================
# Run from repo root:  bash scripts/test/poller-defork-equivalence.sh
# Regenerate the golden: bash scripts/test/poller-defork-equivalence.sh --regenerate
#
# HONEST FRAMING — read this before treating a green run as evidence.
# -------------------------------------------------------------------
# This harness PASSES against the current tree BY CONSTRUCTION. Its golden file
# was generated from the very implementation it compares against, so a green run
# here proves nothing about whether parse_serving_cell is correct — only that it
# has not CHANGED. It is the regression net, not the specification.
#
# The specification for this change lives in poller-defork-forkcount.sh, which
# is red against the current tree on purpose. That harness is the red anchor.
# This one exists so that the rewrite required to turn that harness green cannot
# quietly alter what the parser produces.
#
# WHAT IS PINNED
# --------------
#  * All 27 globals parse_serving_cell populates, dumped verbatim per fixture.
#  * Empty string is NOT null. The parser blanks fields to "", and
#    scripts/usr/lib/qmanager/events.sh depends on exactly that (it guards on
#    -n "$lte_band" to suppress an event). The dump writes an empty value as a
#    bare "key=" and never coerces it to a word.
#  * service_status and network_type are NOT reset at the top of the function.
#    Every fixture is therefore run with BOTH seeded to a distinctive sentinel,
#    so a rewrite that assigns unconditionally — instead of leaving them alone
#    when the state case matches none of NOCONN / LIMSRV / CONNECT / SEARCH —
#    shows up as a diff rather than passing silently.
#  * The LTE SEARCH branch's early return: fields stay blank even though the
#    fixture line carries fully populated data.
#  * The qlog_warn on an empty +QENG filter result, captured through a stub.
#  * Hex cell-ID decomposition, including a 36-bit NR NCI that exceeds 32 bits.
#
# WHAT IS NOT PINNED, AND WHY
# ---------------------------
#  * update_system_health and update_proc_metrics read /proc and /sys live.
#    Their values change every second even on a device, so a golden file is the
#    wrong instrument for them. They get CONTRACT assertions instead — shape,
#    type and range — which is what a consumer of the status cache actually
#    relies on.
#
#    These run wherever /proc is readable. Git Bash on Windows turns out to
#    provide an MSYS2-emulated /proc (stat, meminfo, uptime, loadavg, cpuinfo),
#    so they DO exercise on a workstation — but that emulation is partial: it
#    has no MemAvailable, so memory_used_mb legitimately reads 0 there, and the
#    /sys and df paths all miss, so the sysfs-derived fields legitimately read
#    null. Those are contract-valid outcomes, not passes-by-accident, and the
#    same assertions bite for real on a device. Where /proc is absent entirely
#    the section SKIPS loudly. Nothing is faked and no /proc file is stubbed.
#  * Carriage returns — an OPEN QUESTION for the rewrite, deliberately not
#    pinned here. The AT transport delivers CRLF, and parse_serving_cell strips
#    CR unevenly: the hex cell-ID and TAC fields go through an explicit CR
#    strip, and the NR5G-NSA line's csv does too, but the LTE csv in both the
#    LTE-only and the EN-DC branches does not. So on real CRLF input the LAST
#    field each of those branches reads can carry a trailing CR — that is
#    lte_sinr in the EN-DC branch, where the LTE line ends at SINR.
#
#    Two reasons this is not a golden row. First, locking it would force the
#    rewrite to reproduce CR contamination instead of letting it be decided.
#    Second, it cannot be measured honestly from Git Bash: MSYS2's sed and grep
#    normalise CR out of their input, so a workstation survey reports the
#    toolchain, not the parser. Settle it on a device, deliberately.
# =============================================================================
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PARSE_AT="$REPO_ROOT/scripts/usr/lib/qmanager/parse_at.sh"
POLLER="$REPO_ROOT/scripts/usr/bin/qmanager_poller"
FIXTURE_DIR="$REPO_ROOT/scripts/test/fixtures/serving-cell"
GOLDEN="$FIXTURE_DIR/golden-parse-serving-cell.txt"

REGENERATE=0
[ "${1:-}" = "--regenerate" ] && REGENERATE=1

# The 27 globals, in the order parse_serving_cell's own header comment lists them.
GLOBALS="lte_state lte_band lte_earfcn lte_bandwidth lte_pci \
lte_rsrp lte_rsrq lte_sinr lte_rssi \
lte_cell_id lte_enodeb_id lte_sector_id lte_tac \
nr_state nr_band nr_arfcn nr_pci nr_rsrp nr_rsrq nr_sinr nr_scs \
nr_cell_id nr_enodeb_id nr_sector_id nr_tac \
network_type service_status"

# Distinctive seed. If it survives into the dump, the parser left that global
# alone; if a rewrite overwrites it, the diff says so.
SEED="__SEEDED_NOT_TOUCHED__"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail=0
pass_count=0
fail_count=0
skip_count=0

ok()   { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail_count=$((fail_count + 1)); fail=1; }
skip() { printf '  SKIP  %s\n' "$1"; skip_count=$((skip_count + 1)); }
section() { printf '\n== %s ==\n' "$1"; }

# ---------------------------------------------------------------------------
# dump_one <fixture-file>
# Sources parse_at.sh in a subshell with the qlog_* family stubbed, seeds every
# global, calls parse_serving_cell, and writes one block to stdout.
# ---------------------------------------------------------------------------
dump_one() {
    local f="$1"
    (
        set +eu
        _warns=""
        qlog_warn()  { _warns="${_warns}${_warns:+ | }$1"; }
        qlog_info()  { :; }
        qlog_debug() { :; }
        qlog_error() { :; }
        qlog_state_change() { :; }

        for _g in $GLOBALS; do eval "$_g=\"\$SEED\""; done

        . "$PARSE_AT"
        raw=$(cat "$f")
        parse_serving_cell "$raw"

        printf '### %s\n' "$(basename "$f")"
        printf 'warn=%s\n' "$_warns"
        for _g in $GLOBALS; do
            eval "printf '%s=%s\n' \"\$_g\" \"\${$_g}\""
        done
        printf '\n'
    )
}

# ---------------------------------------------------------------------------
section "harness self-check"

if [ -f "$PARSE_AT" ]; then
    ok "parse_at.sh found"
else
    bad "parse_at.sh missing at $PARSE_AT"
fi

# NOTE: the repository path contains a space on the reference workstation, so
# the fixture list is carried newline-separated and read with IFS cleared.
# A bare `for f in $fixtures` splits "QM PROJECT" into two paths.
fixtures=$(ls "$FIXTURE_DIR"/*.txt 2>/dev/null | grep -v '/golden-' || true)
fixture_count=$(printf '%s\n' "$fixtures" | grep -c . || true)
if [ "$fixture_count" -ge 10 ]; then
    ok "$fixture_count serving-cell fixtures present"
else
    bad "expected at least 10 serving-cell fixtures, found $fixture_count"
fi

# ---------------------------------------------------------------------------
section "parse_serving_cell — golden dump of all 27 globals"

actual="$work/actual.txt"
: > "$actual"
printf '%s\n' "$fixtures" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    dump_one "$f"
done > "$actual"

if [ "$REGENERATE" -eq 1 ]; then
    cp "$actual" "$GOLDEN"
    printf '  ---   regenerated %s\n' "$GOLDEN"
    printf '  ---   REVIEW THE DIFF BEFORE COMMITTING. Regenerating a golden to make\n'
    printf '  ---   a failing run green is how a real regression gets blessed.\n'
    ok "golden regenerated ($(grep -c '^###' "$GOLDEN") fixture blocks)"
elif [ ! -f "$GOLDEN" ]; then
    bad "golden file missing at $GOLDEN — run with --regenerate to create it"
elif diff -u "$GOLDEN" "$actual" > "$work/diff.txt" 2>&1; then
    ok "all $(grep -c '^###' "$actual") fixture blocks match the golden byte for byte"
else
    bad "parse_serving_cell output diverged from the golden"
    printf '\n--- golden vs actual ---\n'
    cat "$work/diff.txt"
    printf -- '--- end diff ---\n\n'
fi

# ---------------------------------------------------------------------------
section "parse_serving_cell — contracts the golden must not silently lose"

# These re-assert, in readable form, the four contracts the golden encodes. If
# someone regenerates the golden to bless a regression, these still fail.
grab() {
    # grab <fixture-basename> <key>  ->  value
    awk -v fx="### $1" -v k="$2" '
        $0 == fx { inb = 1; next }
        inb && /^###/ { exit }
        inb && index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }
    ' "$actual"
}

v=$(grab "synthetic-lte-only-search.txt" "lte_band")
if [ -z "$v" ]; then
    ok "LTE SEARCH early return leaves lte_band EMPTY (not a word, not null)"
else
    bad "LTE SEARCH should leave lte_band empty, got '$v'"
fi

v=$(grab "synthetic-5g-nsa-unknown-state.txt" "service_status")
if [ "$v" = "$SEED" ]; then
    ok "NSA with an unmatched state token leaves service_status UNCHANGED"
else
    bad "NSA unmatched state must not touch service_status, got '$v'"
fi

v=$(grab "synthetic-5g-sa-unknown-state.txt" "service_status")
if [ "$v" = "$SEED" ]; then
    ok "SA with an unmatched state token leaves service_status UNCHANGED"
else
    bad "SA unmatched state must not touch service_status, got '$v'"
fi

v=$(grab "synthetic-no-qeng-lines.txt" "warn")
case "$v" in
    *"no +QENG: lines in response"*)
        ok "a response with no +QENG: lines emits the qlog_warn" ;;
    *)
        bad "expected the no-QENG warning, got warn='$v'" ;;
esac

v=$(grab "synthetic-empty.txt" "service_status")
if [ "$v" = "unknown" ]; then
    ok "an empty response sets service_status to unknown"
else
    bad "empty response should set service_status=unknown, got '$v'"
fi

# 36-bit NR NCI: 0x2FCB04A0F. gNodeB = value >> 14, sector = value & 0x3FFF.
cid=$(grab "synthetic-5g-sa-36bit-nci.txt" "nr_cell_id")
gnb=$(grab "synthetic-5g-sa-36bit-nci.txt" "nr_enodeb_id")
sec=$(grab "synthetic-5g-sa-36bit-nci.txt" "nr_sector_id")
if [ "$cid" = "12829346319" ] && [ "$gnb" = "783041" ] && [ "$sec" = "2575" ]; then
    ok "36-bit NR NCI decomposes to 12829346319 / 783041 / 2575"
else
    bad "36-bit NCI mismatch: cell=$cid gnodeb=$gnb sector=$sec"
fi

# Lowercase hex must decode identically to the uppercase fixture.
lc=$(grab "synthetic-lte-only-lowercase-hex.txt" "lte_cell_id")
uc=$(grab "synthetic-lte-only-connect.txt" "lte_cell_id")
lct=$(grab "synthetic-lte-only-lowercase-hex.txt" "lte_tac")
uct=$(grab "synthetic-lte-only-connect.txt" "lte_tac")
if [ -n "$uc" ] && [ "$lc" = "$uc" ] && [ "$lct" = "$uct" ]; then
    ok "lowercase hex cell-ID and TAC decode identically to uppercase ($uc / $uct)"
else
    bad "lowercase hex mismatch: cell $lc vs $uc, tac $lct vs $uct"
fi

# Every one of the four service_status values must be reachable.
for pair in \
    "synthetic-lte-only-noconn.txt idle" \
    "synthetic-lte-only-limsrv.txt limited" \
    "synthetic-lte-only-connect.txt connected" \
    "synthetic-lte-only-search.txt searching"
do
    set -- $pair
    v=$(grab "$1" "service_status")
    if [ "$v" = "$2" ]; then
        ok "service_status maps to $2 for $1"
    else
        bad "service_status for $1 should be $2, got '$v'"
    fi
done

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
section "update_proc_metrics / update_system_health — live contracts"

# These two functions read /proc and /sys directly. Rather than sourcing the
# whole poller (which pulls in /usr/lib/qmanager libs that only exist on a
# device), extract just the function definitions and eval them standalone —
# neither has any external function dependency, only globals.
extract_function() {
    awk -v fn="$2" '
        !inside && $0 ~ "^" fn "\\(\\) \\{[[:space:]]*$" { inside = 1; print; next }
        inside { print }
        inside && /^\}[[:space:]]*$/ { exit }
    ' "$1"
}

if [ ! -r /proc/stat ] || [ ! -r /proc/meminfo ] || [ ! -r /proc/uptime ]; then
    skip "update_proc_metrics contracts — /proc is not readable on this host"
    skip "update_system_health contracts — /proc is not readable on this host"
    printf '  ---   Nothing is faked and no /proc file is stubbed. Run this harness on a\n'
    printf '  ---   host with /proc (a device, Linux, or Git Bash) to exercise them.\n'
else
    pm_out=$(
        set +eu
        eval "$(extract_function "$POLLER" "update_proc_metrics")"
        prev_cpu_idle=0; prev_cpu_total=0; cpu_usage=""
        memory_total_mb=""; memory_used_mb=""; uptime_seconds=""
        update_proc_metrics
        # A second call after a real interval so the CPU delta is meaningful.
        sleep 1
        update_proc_metrics
        printf '%s %s %s %s\n' "$cpu_usage" "$memory_total_mb" "$memory_used_mb" "$uptime_seconds"
    )
    set -- $pm_out
    pm_cpu="${1:-}"; pm_mtot="${2:-}"; pm_mused="${3:-}"; pm_up="${4:-}"

    printf '  ---   update_proc_metrics: cpu=%s%% mem=%s/%sMB uptime=%ss\n' \
        "$pm_cpu" "$pm_mused" "$pm_mtot" "$pm_up"

    case "$pm_cpu" in
        ''|*[!0-9]*) bad "cpu_usage must be a bare integer, got '$pm_cpu'" ;;
        *) if [ "$pm_cpu" -ge 0 ] && [ "$pm_cpu" -le 100 ]; then
               ok "cpu_usage is an integer percentage in 0..100"
           else
               bad "cpu_usage out of range: $pm_cpu"
           fi ;;
    esac

    case "$pm_mtot" in
        ''|*[!0-9]*) bad "memory_total_mb must be a bare integer, got '$pm_mtot'" ;;
        *) if [ "$pm_mtot" -gt 0 ]; then
               ok "memory_total_mb is a positive integer ($pm_mtot)"
           else
               bad "memory_total_mb should be > 0, got $pm_mtot"
           fi ;;
    esac

    case "$pm_mused" in
        ''|*[!0-9]*) bad "memory_used_mb must be a bare integer, got '$pm_mused'" ;;
        *) if [ "$pm_mused" -ge 0 ] && [ "$pm_mused" -le "$pm_mtot" ]; then
               ok "memory_used_mb is within 0..memory_total_mb"
           else
               bad "memory_used_mb $pm_mused outside 0..$pm_mtot"
           fi ;;
    esac

    case "$pm_up" in
        ''|*[!0-9]*) bad "uptime_seconds must be a bare integer, got '$pm_up'" ;;
        *) if [ "$pm_up" -gt 0 ]; then
               ok "uptime_seconds is a positive integer with no fractional part"
           else
               bad "uptime_seconds should be > 0, got $pm_up"
           fi ;;
    esac

    sh_out=$(
        set +eu
        eval "$(grep -E '^SH_(SUBSYS_BASE|RAMDUMP_DIR|CRASH_LOG|CPUFREQ_BASE)=' "$POLLER")"
        eval "$(extract_function "$POLLER" "update_system_health")"
        sh_core_count="null"
        update_system_health
        printf '%s\n' "$sh_state|$sh_crash_count|$sh_coredump_present|$sh_load_1m|$sh_core_count|$sh_freq_khz|$sh_storage_total_kb|$sh_storage_used_kb|$sh_storage_avail_kb"
    )
    printf '  ---   update_system_health: %s\n' "$sh_out"

    IFS='|' read -r shs shc shd shl shcc shf sht shu sha <<EOF
$sh_out
EOF

    case "$shs" in
        online|offline|crashed|unknown) ok "sh_state is one of online/offline/crashed/unknown ($shs)" ;;
        *) bad "sh_state out of contract: '$shs'" ;;
    esac

    case "$shc" in
        null) ok "sh_crash_count is the literal null (no sysfs counter)" ;;
        ''|*[!0-9]*) bad "sh_crash_count must be null or a bare integer, got '$shc'" ;;
        *) ok "sh_crash_count is a bare integer ($shc)" ;;
    esac

    case "$shd" in
        true|false) ok "sh_coredump_present is a JSON boolean literal ($shd)" ;;
        *) bad "sh_coredump_present must be true or false, got '$shd'" ;;
    esac

    case "$shl" in
        null) ok "sh_load_1m is null (no /proc/loadavg)" ;;
        *[!0-9.]*|'') bad "sh_load_1m must be null or numeric, got '$shl'" ;;
        *) ok "sh_load_1m is numeric ($shl)" ;;
    esac

    case "$shcc" in
        null) bad "sh_core_count stayed null — neither nproc nor /proc/cpuinfo worked" ;;
        *[!0-9]*|'') bad "sh_core_count must be a bare integer, got '$shcc'" ;;
        *) ok "sh_core_count is a bare integer ($shcc)" ;;
    esac

    for pair in "sh_freq_khz $shf" "sh_storage_total_kb $sht" \
                "sh_storage_used_kb $shu" "sh_storage_avail_kb $sha"; do
        set -- $pair
        case "$2" in
            null) ok "$1 is the literal null" ;;
            ''|*[!0-9]*) bad "$1 must be null or a bare integer, got '$2'" ;;
            *) ok "$1 is a bare integer ($2)" ;;
        esac
    done

    printf '  ---   NOTE: df -P /usrdata resolves to a tmpfs mount on BOTH devices, so\n'
    printf '  ---   the sh_storage_* values describe tmpfs, not the /usrdata volume.\n'
    printf '  ---   That is a known pre-existing defect, deliberately NOT fixed by the\n'
    printf '  ---   de-fork pass. The contract above asserts type only, on purpose.\n'
fi

# ---------------------------------------------------------------------------
printf '\n%d passed, %d failed, %d skipped' "$pass_count" "$fail_count" "$skip_count"
if [ "$fail" -eq 0 ]; then
    printf ', ALL PASS\n'
    exit 0
else
    printf ', FAILURES\n'
    exit 1
fi
