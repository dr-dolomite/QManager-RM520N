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
# Traffic Masquerade are mutually exclusive modes of that one engine — the
# CGI enforces the mutex on save, matching the RM551 UI's takeover-confirm
# dialog. tpws does its own hostlist filtering, so only hostlist-matching
# connections are desync'd in Video Optimizer mode.
#
# Persisted config (via config.sh, /etc/qmanager/qmanager.conf):
#   video_optimizer.enabled     0/1
#   video_optimizer.strategy    "full" | "targeted" (reserved; affects the
#                               hostlist the UI manages, not the engine)
#   traffic_masquerade.enabled  0/1
#   traffic_masquerade.sni_domain  reserved: accepted+stored by the CGI for
#                               API-REFERENCE contract parity, inert in the
#                               tpws engine (tpws has no fake-SNI mode)
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
#   DPI_PORT / DPI_BIND_ADDR / DPI_BINARY / DPI_HOSTLIST / DPI_RULE_SIG
#   dpi_active_mode            — print video_optimizer|masquerade|none
#   dpi_is_enabled             — 0 if a mode is active
#   dpi_binary_installed       — 0 if the tpws binary exists and is executable
#   dpi_domains_loaded         — print hostlist line count (0 if absent)
#   dpi_rule_present           — 0 if the REDIRECT rule is installed
#   dpi_packets_processed      — print the rule's packet counter
#   dpi_apply_rule             — drain existing rule, insert fresh one
#   dpi_remove_rule            — drain existing rule
#   dpi_service_status         — print running|stopped|restarting|error
#   dpi_uptime_str             — print human uptime ("2h 34m") of the unit
#   dpi_build_args             — print tpws argv (word-splittable) for mode
# =============================================================================

[ -n "$_DPI_STATE_LOADED" ] && return 0
_DPI_STATE_LOADED=1

# --- Constants ---------------------------------------------------------------
DPI_PORT="989"
DPI_BIND_ADDR="0.0.0.0"
DPI_BINARY="/usrdata/qmanager/bin/tpws"
DPI_HOSTLIST="/etc/qmanager/video_domains.txt"
# Factory default hostlist (seeded by qmanager_setup) — restore_hostlist
# copies it back over the live list. RM551-contract file name.
DPI_HOSTLIST_DEFAULT="/etc/qmanager/video_domains_default.txt"
# The RM520N kernel ships no xt_comment module ("Couldn't load match
# `comment'"), so the engine rule cannot carry -m comment. The rule is
# identified by its unique target instead: nothing else on the modem
# redirects to port 989. Match on the -S (unwrapped, single-line) form.
DPI_RULE_SIG="--to-ports 989"
DPI_VERIFY_FILE="/tmp/qmanager_dpi_verify.json"
DPI_INSTALL_FILE="/tmp/qmanager_dpi_install.json"
DPI_INSTALL_PID="/tmp/qmanager_dpi_install.pid"
DPI_VERIFY_PID="/tmp/qmanager_dpi_verify.pid"

# =============================================================================
# dpi_active_mode — which engine mode config currently selects
# Prints: video_optimizer | masquerade | none
# Defensive: if both are enabled (should never happen — the CGI enforces a
# mutex), Video Optimizer wins and a warning is logged.
# =============================================================================
dpi_active_mode() {
    local vo masq
    vo=$(qm_config_get video_optimizer enabled 0)
    masq=$(qm_config_get traffic_masquerade enabled 0)
    if [ "$vo" = "1" ]; then
        [ "$masq" = "1" ] && [ "$(command -v qlog_warn 2>/dev/null)" ] && \
            qlog_warn "dpi_state: both video_optimizer and traffic_masquerade enabled — engine running Video Optimizer mode"
        echo "video_optimizer"
    elif [ "$masq" = "1" ]; then
        echo "masquerade"
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
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t nat -D PREROUTING \
            -i bridge0 -p tcp -m multiport --dports 80,443 \
            -j REDIRECT --to-ports "$DPI_PORT" 2>/dev/null || break
        i=$((i + 1))
    done
    run_iptables -w 5 -t nat -I PREROUTING \
        -i bridge0 -p tcp -m multiport --dports 80,443 \
        -j REDIRECT --to-ports "$DPI_PORT"
}

# =============================================================================
# dpi_remove_rule — drain the engine rule (no insert)
# =============================================================================
dpi_remove_rule() {
    local i=0
    while [ "$i" -lt 16 ]; do
        run_iptables -w 5 -t nat -D PREROUTING \
            -i bridge0 -p tcp -m multiport --dports 80,443 \
            -j REDIRECT --to-ports "$DPI_PORT" 2>/dev/null || break
        i=$((i + 1))
    done
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
    local st
    st=$($_SUDO $_SYSTEMCTL show qmanager-dpi -p ActiveState --value 2>/dev/null)
    case "$st" in
        active) echo "running" ;;
        activating) echo "restarting" ;;
        failed) echo "error" ;;
        *) echo "stopped" ;;
    esac
}

# =============================================================================
# dpi_uptime_str — human uptime of the qmanager-dpi unit, "2h 34m" style
# Uses ActiveEnterTimestampMonotonic vs /proc/uptime (no clock-step issues).
# =============================================================================
dpi_uptime_str() {
    local mono now_usec secs h m
    mono=$($_SUDO $_SYSTEMCTL show qmanager-dpi -p ActiveEnterTimestampMonotonic --value 2>/dev/null) || mono=0
    case "$mono" in
        ''|*[!0-9]*) mono=0 ;;
    esac
    [ "$mono" -le 0 ] && { echo "—"; return; }
    now_usec=$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)
    secs=$(( now_usec * 1000000 - mono ))
    [ "$secs" -lt 0 ] && secs=0
    secs=$(( secs / 1000000 ))
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
# Masquerade mode: the SAME recipe applied to EVERY connection (no hostlist).
# This is the tpws-native equivalent of the RM551 "fake TLS ClientHello with
# spoofed SNI" — tpws has no fake-hello mode (nfqws-only), and splitting the
# ClientHello so the SNI lands in a later segment defeats SNI-based DPI
# throttling just as effectively, for every destination. The contract's
# sni_domain key is accepted and stored by the CGI but is inert in the tpws
# engine — see docs/reference/dpi.md.
# =============================================================================
dpi_build_args() {
    case "$(dpi_active_mode)" in
        video_optimizer)
            # --hostlist-auto-reload is a newer-zapret option; v72.13 (the
            # pinned version) re-stats and reloads the hostlist on every
            # connection check by default — a CGI hostlist save applies
            # immediately without restarting the engine.
            printf '%s' \
                "--port=$DPI_PORT --bind-addr=$DPI_BIND_ADDR" \
                " --filter-l7=tls,http --split-pos=1,midsld,sniext+1 --disorder=tls" \
                " --hostlist=$DPI_HOSTLIST"
            ;;
        masquerade)
            printf '%s' \
                "--port=$DPI_PORT --bind-addr=$DPI_BIND_ADDR" \
                " --filter-l7=tls,http --split-pos=1,midsld,sniext+1 --disorder=tls"
            ;;
        *)
            echo ""
            ;;
    esac
}