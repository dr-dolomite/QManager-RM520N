#!/bin/sh
# =============================================================================
# dpi_state.sh — Traffic Engine (DPI) State Library for QManager
# =============================================================================
# Single source of truth for the Traffic Engine feature: config reads,
# active-mode resolution, iptables rule management, and status computation.
#
# The Traffic Engine is a re-port of the RM551E Video Optimizer / Traffic
# Masquerade feature, re-architected around zapret's `tpws` userspace
# transparent proxy instead of nfqws+NFQUEUE (nfqws reinjection is broken on
# Qualcomm rmnet rawip; tpws is a pure REDIRECT proxy that works there).
#
# Engine model: ONE tpws instance on ONE port (989), reached by a single
# REDIRECT rule for bridge0 LAN clients on tcp 80,443. Video Optimizer and
# Full Bypass are mutually exclusive modes of that one engine — the
# CGI enforces the mutex on save, matching the RM551 UI's takeover-confirm
# dialog. tpws does its own hostlist filtering, so only hostlist-matching
# connections are desync'd in Video Optimizer mode.
#
# Persisted config (via config.sh, /etc/qmanager/qmanager.conf):
#   video_optimizer.enabled     0/1
#   video_optimizer.strategy    "full" | "targeted" (reserved; affects the
#                               hostlist the UI manages, not the engine)
#   full_bypass.enabled         0/1
#   full_bypass.sni_domain      reserved: accepted+stored by the CGI for
#                               API-REFERENCE contract parity, inert in the
#                               tpws engine (tpws has no fake-SNI mode)
#   quic.force_tcp              0/1  — standalone QUIC handle, REJECTs bridge0
#                               UDP 443 so clients fall back to TCP. Fully
#                               independent of the engine (see below).
#
# Runtime files:
#   /tmp/qmanager_dpi_install.{json,pid}  — tpws installer progress markers
#   /tmp/qmanager_dpi_verify.json         — verify (speedtest) result
#   (both pre-seeded root:root 0666 by qmanager_setup; root helpers write
#    in place, never tmp+mv — see docs/reference/tmp-file-ownership.md)
#
# DEPENDENCY: platform.sh AND config.sh MUST be sourced by the caller first
# (this lib uses run_iptables / svc_* / qm_config_*). It does not source
# them itself to avoid double-loading side effects — mirrors ttl_state.sh.
#
# Install location: /usr/lib/qmanager/dpi_state.sh
#
# Public API:
#   DPI_PORT / DPI_LAN_IF / DPI_BINARY / DPI_HOSTLIST / DPI_RULE_SIG
#   dpi_active_mode            — print video_optimizer/full_bypass/none
#   dpi_is_enabled             — 0 if a mode is active
#   dpi_binary_installed       — 0 if the tpws binary exists and is executable
#   dpi_bind_addr              — print the LAN address tpws must bind to
#   dpi_listener_present       — 0 listening / 1 absent / 2 UNKNOWN (tri-state)
#   dpi_domains_loaded         — print hostlist line count (0 if absent)
#   dpi_rule_present           — 0 if the REDIRECT rule is installed
#   dpi_packets_processed      — print the rule's packet counter
#   dpi_apply_rule             — drain existing rule, insert fresh one
#   dpi_remove_rule            — drain existing rule
#   dpi_service_status         — print running|stopped|restarting|error
#   dpi_uptime_str             — print human uptime ("2h 34m") of the unit
#   dpi_build_args             — print tpws argv (word-splittable) for mode
#   dpi_force_tcp_rule_present — 0 if the QUIC force-TCP rule is installed
#   dpi_apply_force_tcp_rule   — idempotent force-TCP rule insert
#   dpi_remove_force_tcp_rule  — force-TCP rule drain
#   dpi_purge_legacy_dscp_rule — drain leftover DSCP-marking rules (upgrade)
#   dpi_reconcile_force_tcp    — assert force-TCP rule to config intent
# =============================================================================

[ -n "$_DPI_STATE_LOADED" ] && return 0
_DPI_STATE_LOADED=1

# --- Constants ---------------------------------------------------------------
DPI_PORT="989"
DPI_LAN_IF="bridge0"
DPI_BINARY="/usrdata/qmanager/bin/tpws"
DPI_HOSTLIST="/etc/qmanager/video_domains.txt"
# Factory default hostlist (seeded by qmanager_setup) — restore_hostlist
# copies it back over the live list. RM551-contract file name.
DPI_HOSTLIST_DEFAULT="/etc/qmanager/video_domains_default.txt"
# The RM520N kernel ships no xt_comment module ("Couldn't load match
# `comment'"), so the engine rule cannot carry -m comment. The rule is
# identified by its unique target instead: nothing else on the modem
# redirects to port 989. Match on the -S (unwrapped, single-line) form.
DPI_RULE_SIG="--to-ports $DPI_PORT"
# The rule spec, written ONCE. The -D drain must match the insert byte-for-byte
# including match-module order, so all four call sites share these constants
# rather than restating the flags.
_DPI_RULE_MATCH="-i $DPI_LAN_IF -p tcp -m multiport --dports 80,443 -m addrtype ! --dst-type LOCAL"
# Pre-2026-09-10 spec, without the addrtype exclusion. A device that took an OTA
# is still carrying it, and DPI_RULE_SIG matches BOTH forms — so without an
# exact-spec drain, dpi_apply_rule's idempotence check sees the old rule as
# present and the exclusion never lands. Same shape as the legacy DSCP purge.
_DPI_RULE_MATCH_LEGACY="-i $DPI_LAN_IF -p tcp -m multiport --dports 80,443"
DPI_VERIFY_FILE="/tmp/qmanager_dpi_verify.json"
DPI_INSTALL_FILE="/tmp/qmanager_dpi_install.json"
DPI_INSTALL_PID="/tmp/qmanager_dpi_install.pid"
DPI_VERIFY_PID="/tmp/qmanager_dpi_verify.pid"

# =============================================================================
# dpi_active_mode — which engine mode config currently selects
# Prints: video_optimizer | full_bypass | none
# Defensive: if both are enabled (should never happen — the CGI enforces a
# mutex), Video Optimizer wins and a warning is logged.
# =============================================================================
dpi_active_mode() {
    local vo full
    vo=$(qm_config_get video_optimizer enabled 0)
    full=$(qm_config_get full_bypass enabled 0)
    if [ "$vo" = "1" ]; then
        [ "$full" = "1" ] && [ "$(command -v qlog_warn 2>/dev/null)" ] && \
            qlog_warn "dpi_state: both video_optimizer and full_bypass enabled — engine running Video Optimizer mode"
        echo "video_optimizer"
    elif [ "$full" = "1" ]; then
        echo "full_bypass"
    else
        echo "none"
    fi
}

# 0 (true) when any mode is active
dpi_is_enabled() {
    [ "$(dpi_active_mode)" != "none" ]
}

# 0 (true) when the tpws binary is installed and executable
dpi_binary_installed() {
    [ -x "$DPI_BINARY" ]
}

# =============================================================================
# dpi_bind_addr — the address tpws must listen on
# The LAN address, never 0.0.0.0: port 989 is matched by no rule in any chain
# (QMANAGER_FW covers only 80/443), so a wildcard bind made tpws an open
# transparent proxy reachable from the carrier side. Prints empty when the LAN
# interface has no address yet — callers must treat that as "cannot start".
# =============================================================================
dpi_bind_addr() {
    ip -4 addr show "$DPI_LAN_IF" 2>/dev/null \
        | sed -n 's/.*inet \([0-9.]*\)\/.*/\1/p' | head -n1
}

# Dotted quad -> the little-endian hex /proc/net/tcp renders (192.168.225.1 -> 01E1A8C0).
_dpi_hex_addr() {
    local _a="$1" IFS=.
    [ -n "$_a" ] || return 1
    set -- $_a
    [ $# -eq 4 ] || return 1
    printf '%02X%02X%02X%02X' "$4" "$3" "$2" "$1"
}

# =============================================================================
# dpi_listener_present — is tpws actually accepting on the engine port?
# TRI-STATE: 0 = listening, 1 = absent, 2 = UNKNOWN. Unknown is not absent —
# a caller that treated an unreadable procfs as "dead" would drain a working
# rule and restart a healthy engine, so the ensure pass must do nothing on 2.
# /proc/net/tcp, not netstat: netstat exists only at /opt/bin/netstat and /opt
# is an Entware mount that appears ~30s into boot. The file always carries a
# header row, so zero lines read is a failure, never an empty table.
# A wildcard (00000000) bind still counts: during an OTA the pre-F5 argv may
# still be running, and draining the rule under it would be a needless outage.
# LISTEN is 0A *or* 8A here. tpws's transparent-mode listener reports 8A
# (0x80 | TCP_LISTEN) on this kernel — measured on RM520N-GL, where every
# ordinary listener (:22, :53, :80, :443) reports 0A and only tpws reports 8A.
# /opt/bin/netstat cannot name that state either and prints "(null)" for the
# row, so matching 0A alone reads a healthy engine as dead.
# =============================================================================
dpi_listener_present() {
    local want_port want_addr verdict
    want_port=$(printf '%04X' "$DPI_PORT")
    want_addr=$(_dpi_hex_addr "$(dpi_bind_addr)") || return 2
    verdict=$(awk -v p="$want_port" -v a="$want_addr" '
        { rows++ }
        $4 == "0A" || $4 == "8A" {
            i = index($2, ":")
            if (substr($2, i + 1) == p &&
                (substr($2, 1, i - 1) == a || substr($2, 1, i - 1) == "00000000")) found++
        }
        END { print (rows ? (found ? "yes" : "no") : "unknown") }
    ' /proc/net/tcp 2>/dev/null)
    case "$verdict" in
        yes) return 0 ;;
        no) return 1 ;;
        *) return 2 ;;
    esac
}

# =============================================================================
# dpi_domains_loaded — number of domains in the hostlist file
# =============================================================================
dpi_domains_loaded() {
    if [ -f "$DPI_HOSTLIST" ]; then
        # Count real entries only — strip comments and blank lines (matches
        # what the hostlist GET endpoint returns; a raw wc -l reports the
        # comment header too, making the status card disagree with the UI).
        sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$DPI_HOSTLIST" | wc -l | tr -d ' '
    else
        echo 0
    fi
}

# =============================================================================
# dpi_rule_present — is the REDIRECT rule currently installed?
# Greps the unwrapped -S form for the unique REDIRECT-to-989 target.
# =============================================================================
dpi_rule_present() {
    run_iptables -w 5 -t nat -S PREROUTING 2>/dev/null \
        | grep -q -- "$DPI_RULE_SIG"
}

# =============================================================================
# dpi_packets_processed — packet counter from the REDIRECT rule
# Parses the first column (pkts) of the rule's -v -x row. Non-numeric or
# missing rule → 0.
# =============================================================================
dpi_packets_processed() {
    # -L renders the target as "redir ports 989" (the -S form renders
    # "--to-ports 989" — see DPI_RULE_SIG for detection).
    local pkts
    pkts=$(run_iptables -w 5 -t nat -L PREROUTING -n -v -x 2>/dev/null \
        | grep -- "redir ports $DPI_PORT" | head -n1 | awk '{print $1}')
    case "$pkts" in
        ''|*[!0-9]*) echo 0 ;;
        *) echo "$pkts" ;;
    esac
}

# =============================================================================
# dpi_apply_rule — drain any existing engine rule, insert a fresh one
# Only bridge0 (LAN clients) is redirected; rmnet-side originals pass through
# untouched. QCMAP flushes iptables on every re-dial, so this drain-and-insert
# is also what the qmanager-dpi-ensure.timer re-asserts every 60s.
# No -m comment (xt_comment absent from the RM520N kernel) — the rule is
# matched by its full spec; -D failures are silenced.
# Returns 0 on success (the -I exit status).
# =============================================================================
dpi_apply_rule() {
    # The legacy drain runs BEFORE the idempotence check, not after: DPI_RULE_SIG
    # matches the old spec too, so an un-migrated rule would read as "present"
    # and the addrtype exclusion would never land.
    _dpi_purge_legacy_rule
    # Idempotent: if the rule is already installed, leave it alone.
    # Re-creating it every ensure pass would reset its packet counter,
    # making "Packets processed" visibly collapse to 0 once a minute.
    if dpi_rule_present; then
        return 0
    fi
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t nat -D PREROUTING $_DPI_RULE_MATCH \
            -j REDIRECT --to-ports "$DPI_PORT" 2>/dev/null || break
        i=$((i + 1))
    done
    run_iptables -w 5 -t nat -I PREROUTING $_DPI_RULE_MATCH \
        -j REDIRECT --to-ports "$DPI_PORT"
}

# Drain the pre-addrtype rule. Unconditional and called from inside
# dpi_remove_rule/dpi_apply_rule rather than from their callers, so the CGI
# disable path and _dpi_uninstall_run are covered without touching either —
# a drain that missed them would leave the old REDIRECT live with the engine
# reported off, which is a LAN outage, not a leak.
_dpi_purge_legacy_rule() {
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t nat -D PREROUTING $_DPI_RULE_MATCH_LEGACY \
            -j REDIRECT --to-ports "$DPI_PORT" 2>/dev/null || break
        i=$((i + 1))
    done
}

# =============================================================================
# dpi_remove_rule — drain the engine rule, both specs (no insert)
# =============================================================================
dpi_remove_rule() {
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t nat -D PREROUTING $_DPI_RULE_MATCH \
            -j REDIRECT --to-ports "$DPI_PORT" 2>/dev/null || break
        i=$((i + 1))
    done
    _dpi_purge_legacy_rule
}

# =============================================================================
# QUIC Force-TCP (independent of the engine)
#
# Quic (outbound UDP 443) is deliberately untouched by the engine: tpws only
# desyncs TCP streams, so QUIC always passes through unmanaged. The Force-TCP
# toggle REJECTs bridge0 LAN clients' UDP 443, which makes QUIC-first apps
# (YouTube, Discord, Instagram) fall back to HTTPS over TCP where the engine
# can apply its bypass.
#
# Fully standalone: engine install/uninstall and enable/disable never touch
# these rules. The qmanager-dpi-ensure.timer reconciles them against config
# every 60s even when the engine is off, so they survive QCMAP iptables
# flushes on re-dial. A LAN-side REJECT (icmp-port-unreachable) lets clients
# fail back immediately; DROP would make them wait out QUIC retransmit/PTO
# timers before falling back, which reads as a dead connection per host.
#
# Persisted config:
#   quic.force_tcp   0/1  (independent of video_optimizer/full_bypass)
# =============================================================================

# Identified by its unique target string — the RM520N kernel has no xt_comment
# module, and nothing else on the modem REJECTs with icmp-port-unreachable.
DPI_FORCE_TCP_RULE_SIG="--reject-with icmp-port-unreachable"
# Legacy DSCP-marking rule ("--set-dscp 0x2e") shipped by builds that bundled
# QUIC handling with the engine. Kept as its own signature so upgrade paths
# can purge any leftover rule.
DPI_LEGACY_DSCP_RULE_SIG="--set-dscp 0x2e"

# dpi_force_tcp_rule_present — is the QUIC force-TCP rule currently installed?
dpi_force_tcp_rule_present() {
    run_iptables -w 5 -t filter -S FORWARD 2>/dev/null \
        | grep -q -- "$DPI_FORCE_TCP_RULE_SIG"
}

# dpi_apply_force_tcp_rule — idempotent insert (leaves an existing rule alone)
dpi_apply_force_tcp_rule() {
    if dpi_force_tcp_rule_present; then
        return 0
    fi
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t filter -D FORWARD \
            -i bridge0 -p udp --dport 443 \
            -j REJECT --reject-with icmp-port-unreachable 2>/dev/null || break
        i=$((i + 1))
    done
    run_iptables -w 5 -t filter -I FORWARD \
        -i bridge0 -p udp --dport 443 \
        -j REJECT --reject-with icmp-port-unreachable
}

# dpi_remove_force_tcp_rule — drain the force-TCP rule
dpi_remove_force_tcp_rule() {
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t filter -D FORWARD \
            -i bridge0 -p udp --dport 443 \
            -j REJECT --reject-with icmp-port-unreachable 2>/dev/null || break
        i=$((i + 1))
    done
}

# dpi_purge_legacy_dscp_rule — drain leftover DSCP-marking rules from builds
# that bundled QUIC handling with the engine (upgrade migration).
dpi_purge_legacy_dscp_rule() {
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t mangle -D POSTROUTING \
            -p udp --dport 443 \
            -j DSCP --set-dscp 0x2e 2>/dev/null || break
        i=$((i + 1))
    done
}

# dpi_reconcile_force_tcp — assert the force-TCP rule to match config intent.
# Called unconditionally from qmanager_dpi_run --ensure (never gated on the
# engine's enabled state) so the rule self-heals across QCMAP iptables
# flushes even when the engine is off or uninstalled.
dpi_reconcile_force_tcp() {
    if [ "$(qm_config_get quic force_tcp 0)" = "1" ]; then
        dpi_apply_force_tcp_rule
    else
        dpi_remove_force_tcp_rule
    fi
}

# =============================================================================
# dpi_service_status — map qmanager-dpi unit state to the API contract
# Contract values: running | stopped | restarting | error
#   active    → running
#   activating (auto-restart backoff) → restarting
#   failed    → error
#   else      → stopped
# =============================================================================
dpi_service_status() {
    # HYBRID liveness probe.
    #
    # Primary: is the tpws process actually alive? A process check works for
    # every caller (www-data CGI included) on every supported model, needs no
    # privileges, and does not depend on config.sh variable names — sibling
    # builds (RM502Q-GL) ship different/empty $DPI_BINARY, hence the fallback
    # to the path the installer itself writes to.
    #
    # Fallback: only when no process exists, ask systemd for the degraded
    # states so the UI can still distinguish restarting/error from stopped.
    # This read is a privilege lottery by model (direct query OK on RM520N,
    # denied outright on RM502Q-GL), so it is best-effort: any failure maps
    # to stopped, which is what those models reported anyway.
    local _bin="${DPI_BINARY:-/usrdata/qmanager/bin/tpws}" st
    if pgrep -f "^$_bin " >/dev/null 2>&1; then
        # A live process is not a working engine. Reporting "running" off the
        # pgrep alone is what let a dead-on-the-wire engine read as healthy
        # while the LAN was blackholed. An UNKNOWN probe keeps the old answer
        # so a transient procfs read never flashes a false error.
        dpi_listener_present
        case "$?" in
            1) echo "error" ;;
            *) echo "running" ;;
        esac
        return
    fi
    st=$(${_SYSTEMCTL:-systemctl} show qmanager-dpi -p ActiveState --value 2>/dev/null)
    case "$st" in
        activating) echo "restarting" ;;
        failed) echo "error" ;;
        *) echo "stopped" ;;
    esac
}

# =============================================================================
# dpi_uptime_str — human uptime of the running engine, "2h 34m" style
# Derived from /proc/<pid>/stat field 22 (starttime in jiffies; HZ=100 on
# these SoCs) vs /proc/uptime: same privilege-free reasoning as the status
# probe above, and immune to clock steps. No process -> em dash placeholder.
# =============================================================================
dpi_uptime_str() {
    local pid start_jiffies up_now secs h m _bin
    _bin="${DPI_BINARY:-/usrdata/qmanager/bin/tpws}"
    pid=$(pgrep -f "^$_bin " | head -n1)
    [ -z "$pid" ] && { echo "—"; return; }
    # Uptime tracks the ENGINE, not the process, so it must agree with
    # dpi_service_status: a live process with no listener reports "error" there
    # and must not show a running time here. Unknown keeps the figure, matching
    # that function's fallback.
    dpi_listener_present
    [ "$?" -eq 1 ] && { echo "—"; return; }
    start_jiffies=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null)
    case "$start_jiffies" in
        ''|*[!0-9]*) echo "—"; return ;;
    esac
    up_now=$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)
    secs=$(( up_now - start_jiffies / 100 ))
    [ "$secs" -lt 0 ] && secs=0
    if [ "$secs" -lt 60 ]; then
        echo "${secs}s"
        return
    fi
    h=$(( secs / 3600 ))
    m=$(( (secs % 3600) / 60 ))
    if [ "$h" -gt 0 ]; then
        echo "${h}h ${m}m"
    else
        echo "${m}m"
    fi
}

# =============================================================================
# dpi_build_args — tpws argv (without the binary), word-splittable
# Video Optimizer mode: split/disorder recipe + hostlist filtering (only
# hostlist-matching connections are desync'd; subdomains of listed domains
# match automatically). Recipe proven by on-device A/B against fast.com's
# nflxvideo.net targets (RM520N-GL, T-Mobile): --filter-l7=tls,http
# --split-pos=1,midsld,sniext+1 --disorder=tls.
# Two options were DROPPED after on-device A/B:
#   --tlsrec=sniext+1 re-splits the ClientHello beyond SNI extraction and
#   breaks established sessions on this platform (observed: HTTPS to a
#   hostlist target failing mid-transfer).
#   --oob=tls kills matched connections outright on this network — the
#   browser fails with "could not reach our servers" while unmatched domains
#   keep working. qmanager_dpi_verify has always excluded it for the same
#   reason (see DPI_SOCKS_ARGS there); the live engine now matches the
#   verified recipe. (Titan/RM551E reportedly tolerates --oob; the RM520N +
#   T-Mobile path does not.)
# --filter-l7=tls,http is what makes the engine only touch TLS/HTTP handshakes.
# Full Bypass mode: the SAME recipe applied to EVERY connection (no hostlist).
# The mode differs from Video Optimizer in SCOPE, not in technique, which is
# what the name says. It replaced "Traffic Masquerade": the RM551's nfqws did
# masquerade, sending a fake TLS ClientHello carrying a spoofed SNI, but tpws
# has no fake-hello mode at all (that is nfqws-only). It splits the real
# ClientHello so the SNI lands in a later segment, which defeats SNI-based DPI
# throttling just as effectively, for every destination — but impersonates
# nothing, which is why the old name had to go. The contract's sni_domain key
# is accepted and stored by the CGI but is inert in the tpws engine — see
# docs/reference/dpi.md.
# =============================================================================
dpi_build_args() {
    local bind
    bind=$(dpi_bind_addr)
    # No LAN address yet (boot ordering) — emit nothing rather than fall back to
    # a wildcard bind. The caller treats empty argv as "cannot start"; the
    # ensure pass retries once the interface is up.
    [ -n "$bind" ] || { echo ""; return 1; }
    case "$(dpi_active_mode)" in
        video_optimizer)
            # --hostlist-auto-reload is a newer-zapret option; v72.13 (the
            # pinned version) re-stats and reloads the hostlist on every
            # connection check by default — a CGI hostlist save applies
            # immediately without restarting the engine.
            printf '%s' \
                "--port=$DPI_PORT --bind-addr=$bind" \
                " --filter-l7=tls,http --split-pos=1,midsld,sniext+1 --disorder=tls" \
                " --hostlist=$DPI_HOSTLIST"
            ;;
        full_bypass)
            printf '%s' \
                "--port=$DPI_PORT --bind-addr=$bind" \
                " --filter-l7=tls,http --split-pos=1,midsld,sniext+1 --disorder=tls"
            ;;
        *)
            echo ""
            ;;
    esac
}

# =============================================================================
# Save paths shared by network/video_optimizer.sh and Config Backup
# =============================================================================

# dpi_bool_of <true|false> — prints 1/0; non-zero on anything else.
dpi_bool_of() {
    case "$1" in
        true) echo 1 ;;
        false) echo 0 ;;
        *) return 1 ;;
    esac
}

# dpi_sni_valid <sni> — 0 when valid; else DPI_SNI_ERR holds the detail and rc is 1.
dpi_sni_valid() {
    DPI_SNI_ERR=""
    case "$1" in
        ''|*[!A-Za-z0-9._-]*) DPI_SNI_ERR="sni_domain contains invalid characters"; return 1 ;;
    esac
    case "$1" in
        *.*) ;;
        *) DPI_SNI_ERR="sni_domain must contain at least one dot"; return 1 ;;
    esac
    [ "${#1}" -le 253 ] || { DPI_SNI_ERR="sni_domain exceeds 253 characters"; return 1; }
    return 0
}

# dpi_save_mode <video_optimizer|full_bypass> <0|1> [sni_domain] [log_label]
# Config write, mode mutex, then engine restart (enable) or rule drain + stop (disable).
# rc 0 ok, 2 tpws not installed (nothing written), 3 engine did not start (config saved).
dpi_save_mode() {
    local mode="$1" en="$2" sni="${3:-}" label="${4:-save_full_bypass}"
    if [ "$en" = "1" ] && ! dpi_binary_installed; then
        return 2
    fi
    if [ "$mode" = "video_optimizer" ]; then
        qm_config_set video_optimizer enabled "$en"
        # Mutex: video optimizer owns the engine; full bypass must yield.
        qm_config_set full_bypass enabled 0
        qlog_info "save: video_optimizer enabled=$en"
    else
        qm_config_set full_bypass enabled "$en"
        qm_config_set full_bypass sni_domain "$sni"
        # Mutex: full bypass owns the engine; video optimizer must yield.
        qm_config_set video_optimizer enabled 0
        qlog_info "save_full_bypass: enabled=$en sni_domain=$sni (action=$label)"
    fi
    if [ "$en" = "1" ]; then
        # A latched start limit refuses restart for the hour; clear it (user-initiated), but log
        # the fault state first — reset-failed erases Result/NRestarts and journald is masked.
        qlog_info "save: pre-reset engine fault state: $(${_SYSTEMCTL:-systemctl} show qmanager-dpi -p Result -p NRestarts -p ActiveState --value 2>/dev/null | tr '\n' ' ')"
        svc_reset_failed qmanager-dpi
        # restart, NOT start: start is a no-op on an active unit, so a mode switch kept the old argv.
        svc_restart qmanager-dpi || return 3
    else
        dpi_remove_rule
        svc_stop qmanager-dpi
    fi
    return 0
}

# dpi_save_force_tcp <0|1> — standalone QUIC handle: config + rule only, no binary check, no mutex.
dpi_save_force_tcp() {
    qm_config_set quic force_tcp "$1"
    qlog_info "save_force_tcp: enabled=$1"
    if [ "$1" = "1" ]; then
        dpi_apply_force_tcp_rule
    else
        dpi_remove_force_tcp_rule
    fi
}

# dpi_hostname_check <domain> — 0 when valid; else DPI_HN_ERR names the reason and rc is 1.
dpi_hostname_check() {
    DPI_HN_ERR=""
    case "$1" in
        ''|*[!A-Za-z0-9._-]*) DPI_HN_ERR="has invalid characters"; return 1 ;;
    esac
    case "$1" in
        *.*) ;;
        *) DPI_HN_ERR="missing dot"; return 1 ;;
    esac
    [ "${#1}" -le 253 ] || { DPI_HN_ERR="exceeds 253 chars"; return 1; }
    return 0
}

# dpi_hostlist_check <json> — array of at most 300 valid hostnames. On failure DPI_HL_LOG is the log
# reason, DPI_HL_DETAIL the user-facing detail, rc 1. Shell patterns, not jq regex (device jq has none).
dpi_hostlist_check() {
    local n_domains nread=0 valid=1 entries d
    DPI_HL_LOG=""
    DPI_HL_DETAIL=""
    printf '%s' "$1" | jq -e 'type == "array" and length <= 300' >/dev/null 2>&1 || {
        DPI_HL_LOG="invalid array shape"
        DPI_HL_DETAIL="domains must be an array of at most 300 entries"
        return 1
    }
    n_domains=$(printf '%s' "$1" | jq 'length')
    entries=$(printf '%s' "$1" | jq -r '.[]')
    # noglob: an entry like "*" must be rejected by the charset check, not expanded to filenames.
    set -f
    for d in $entries; do
        nread=$((nread + 1))
        dpi_hostname_check "$d" || {
            DPI_HL_LOG="entry $nread $DPI_HN_ERR"
            valid=0
            break
        }
    done
    set +f
    if [ "$valid" = "1" ] && [ "$nread" != "$n_domains" ]; then
        # An embedded newline/space split one domain into several.
        DPI_HL_LOG="extracted $nread entries from $n_domains declared"
        valid=0
    fi
    [ "$valid" = "1" ] || {
        DPI_HL_DETAIL="each domain must be a valid hostname (letters, digits, dots, dashes)"
        return 1
    }
    return 0
}

# dpi_hostlist_write <json array> — atomic rewrite of the hostlist (www-data owns it, no sudo).
dpi_hostlist_write() {
    local n_domains
    n_domains=$(printf '%s' "$1" | jq 'length')
    if {
        printf '# QManager Video Optimizer hostlist\n'
        printf '%s' "$1" | jq -r '.[]'
    } > "$DPI_HOSTLIST.tmp" && mv "$DPI_HOSTLIST.tmp" "$DPI_HOSTLIST"; then
        qlog_info "save_hostlist: $n_domains domains written"
        return 0
    fi
    # A failed write must never masquerade as success.
    rm -f "$DPI_HOSTLIST.tmp"
    qlog_error "save_hostlist: WRITE FAILED ($n_domains domains) — check permissions on $(dirname "$DPI_HOSTLIST")"
    return 1
}

# dpi_hostlist_json — the live hostlist as a JSON array (comments and blanks stripped); [] when absent.
dpi_hostlist_json() {
    local out
    [ -f "$DPI_HOSTLIST" ] || { echo '[]'; return 0; }
    out=$(sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$DPI_HOSTLIST" \
        | grep -v '^#' | grep -v '^$' | jq -R . | jq -s .)
    [ -n "$out" ] || out='[]'
    echo "$out"
}
