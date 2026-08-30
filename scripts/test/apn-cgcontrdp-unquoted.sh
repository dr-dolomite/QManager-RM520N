#!/bin/bash
# Pins the unquoted +CGCONTRDP wire format emitted by SDX55 firmware
# (RG501Q-EU) against the quoted form emitted by SDX65 (RM520N-GL).
# Run from repo root: bash scripts/test/apn-cgcontrdp-unquoted.sh
#
# Both fixtures below are VERBATIM live captures taken minutes apart on the
# same SIM/carrier (see the commit body for the full probe transcripts):
#
#   RM520N-GL (61368cd2, SDX65):  fields quoted
#   RG501Q-EU (b7e3d6f1, SDX55):  fields BARE — no quotes at all
#
# The divergence is specific to +CGCONTRDP. On the same RG501Q, +CGDCONT?,
# +CGPADDR and +QMAP are all still quoted, which is why a neighbouring
# command would not have revealed it.
#
# Defect being pinned: every CGCONTRDP parser that splits on the '"'
# character silently yields EMPTY on the bare form. For parse_cgcontrdp_apn
# that empty is indistinguishable from "the bearer isn't up yet", so
# apn_apply.sh burns its full 15s verify poll and returns rc=5
# timeout_verify -> the UI shows "Partly applied ... AT+CGCONTRDP returned
# no data after 15s" on an APN that actually landed.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

fail=0
pass_count=0
fail_count=0

ok()   { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail_count=$((fail_count + 1)); fail=1; }
section() { printf '\n== %s ==\n' "$1"; }

CGI_AT="$REPO_ROOT/scripts/usr/lib/qmanager/cgi_at.sh"
PARSE_AT="$REPO_ROOT/scripts/usr/lib/qmanager/parse_at.sh"

# --- fixtures ---------------------------------------------------------------

# Quoted (RM520N-GL / SDX65)
RDP_QUOTED='+CGCONTRDP: 1,5,"SMARTLTE","10.148.167.210",,"10.151.151.44","10.151.151.48"'

# Bare / unquoted (RG501Q-EU / SDX55) — the regression fixture
RDP_BARE='+CGCONTRDP: 1,5,SMARTLTE,10.167.105.28,,10.151.151.44,10.151.151.48'

# Quoted IPv6 record with a QUOTED gateway. The pre-existing -F'"' parser
# needed its int(NF/2) quote-counting hack for exactly this shape; the
# comma-field parser must keep handling it. IPv6 is dotted-decimal here.
RDP_V6_QUOTED='+CGCONTRDP: 2,6,"ims","36.4.216.0.174.28.26.173.0.1.0.0.211.199.72.111","254.128.0.0.0.0.0.0.0.0.0.0.0.0.0.1","10.151.151.44","10.151.151.48"'

# IPv4 record whose address field carries the subnet mask space-separated,
# as 3GPP permits. The address must still be extracted without the mask.
RDP_MASKED='+CGCONTRDP: 1,5,"SMARTLTE","10.148.167.210 255.255.255.248",,"10.151.151.44","10.151.151.48"'

# Bare IMS record sorting FIRST, ahead of the real data context. The poller's
# grep -iv '"ims"' filter cannot match this, so it would publish "ims" as the
# WAN APN. Today this is masked only by cid ordering.
RDP_BARE_IMS_FIRST='+CGCONTRDP: 2,6,ims,36.4.216.0.174.28.26.173.0.1.0.0.211.199.72.111,,10.151.151.44,10.151.151.48
+CGCONTRDP: 1,5,SMARTLTE,10.167.105.28,,10.151.151.44,10.151.151.48'

section "harness self-check"
[ -f "$CGI_AT" ]   && ok "cgi_at.sh found"   || bad "cgi_at.sh missing at $CGI_AT"
[ -f "$PARSE_AT" ] && ok "parse_at.sh found" || bad "parse_at.sh missing at $PARSE_AT"

# ---------------------------------------------------------------------------
section "parse_cgcontrdp_apn — the negotiated-APN verify probe"

apn_of() {
    (
        set +eu
        qlog_warn() { :; }; qlog_info() { :; }
        qlog_debug() { :; }; qlog_error() { :; }
        . "$CGI_AT" >/dev/null 2>&1
        parse_cgcontrdp_apn "$1"
    )
}

got=$(apn_of "$RDP_QUOTED")
[ "$got" = "SMARTLTE" ] \
    && ok "quoted form -> SMARTLTE" \
    || bad "quoted form -> expected 'SMARTLTE', got '$got'"

got=$(apn_of "$RDP_BARE")
[ "$got" = "SMARTLTE" ] \
    && ok "BARE form -> SMARTLTE (RG501Q false-negative defect)" \
    || bad "BARE form -> expected 'SMARTLTE', got '$got'"

got=$(apn_of "$RDP_MASKED")
[ "$got" = "SMARTLTE" ] \
    && ok "address-with-subnet-mask form -> SMARTLTE" \
    || bad "masked form -> expected 'SMARTLTE', got '$got'"

# An APN that genuinely cannot be read must still come back empty, or the
# 15s verify poll loses the only signal it has. This guards against a fix
# that manufactures a value.
got=$(apn_of "+CGCONTRDP: (1,2)")
[ -z "$got" ] \
    && ok "unparseable response still yields empty (no fabricated APN)" \
    || bad "unparseable response should be empty, got '$got'"

# ---------------------------------------------------------------------------
section "parse_cgcontrdp — the 5-tuple behind the APN page"

tuple_of() {
    (
        set +eu
        qlog_warn() { :; }; qlog_info() { :; }
        qlog_debug() { :; }; qlog_error() { :; }
        . "$CGI_AT" >/dev/null 2>&1
        parse_cgcontrdp "$1"
    )
}

# v4 \t v4gw \t dns1 \t dns2 \t v6
got=$(tuple_of "$RDP_QUOTED")
want=$(printf '10.148.167.210\t\t10.151.151.44\t10.151.151.48\t')
[ "$got" = "$want" ] \
    && ok "quoted form -> v4/dns tuple intact (regression guard)" \
    || bad "quoted tuple mismatch: got '$got'"

got=$(tuple_of "$RDP_BARE")
want=$(printf '10.167.105.28\t\t10.151.151.44\t10.151.151.48\t')
[ "$got" = "$want" ] \
    && ok "BARE form -> v4/dns tuple populated (APN page blank-fields defect)" \
    || bad "bare tuple mismatch: got '$got'"

got=$(tuple_of "$RDP_V6_QUOTED")
case "$got" in
    *"36.4.216.0.174.28.26.173.0.1.0.0.211.199.72.111"*)
        ok "quoted-gateway IPv6 record -> v6 address extracted" ;;
    *)  bad "IPv6 record: expected v6 addr in tuple, got '$got'" ;;
esac
case "$got" in
    *"10.151.151.44"*"10.151.151.48"*)
        ok "quoted-gateway IPv6 record -> dns1/dns2 not shifted" ;;
    *)  bad "IPv6 record: dns shifted by quoted gateway, got '$got'" ;;
esac

got=$(tuple_of "$RDP_MASKED")
case "$got" in
    "10.148.167.210	"*)
        ok "address-with-subnet-mask -> mask stripped from v4" ;;
    *)  bad "masked tuple: expected bare v4 addr, got '$got'" ;;
esac

# ---------------------------------------------------------------------------
section "parse_at.sh parse_cgcontrdp — IMS record exclusion"

poller_apn_of() {
    (
        set +eu
        qlog_warn() { :; }; qlog_info() { :; }
        qlog_debug() { :; }; qlog_error() { :; }
        . "$PARSE_AT" >/dev/null 2>&1
        parse_cgcontrdp "$1"
        printf '%s' "$t2_apn"
    )
}

got=$(poller_apn_of "$RDP_BARE_IMS_FIRST")
[ "$got" = "SMARTLTE" ] \
    && ok "bare IMS record sorting first is excluded" \
    || bad "expected 'SMARTLTE' (IMS skipped), got '$got'"

got=$(poller_apn_of "$RDP_BARE")
[ "$got" = "SMARTLTE" ] \
    && ok "bare data record -> SMARTLTE" \
    || bad "expected 'SMARTLTE', got '$got'"

# ---------------------------------------------------------------------------
printf '\n== summary ==\n  %d passed, %d failed\n' "$pass_count" "$fail_count"
exit "$fail"
