# shellcheck shell=sh
# qmi_merge.sh: QMI overlay gate for the poller's write_cache (bash builtins only, no forks).
# Sourced by qmanager_poller (guarded). The gate runs in shell because jq compile cost grows with program size.

QMI_ENV_FILE="${QMI_ENV_FILE:-/var/run/qmanager/qmi.env}"
QMI_JSON_FILE="${QMI_JSON_FILE:-/var/run/qmanager/qmi.json}"

# network.wds: settings while qmi is up and read within 30 s; a bad sidecar lands in the catch.
QMI_JQ_DEFS='
def qmi_wds: try (($qmi | fromjson).wds.settings as $ws
    | if $q_state == "up" and ($ws.read_mono | type) == "number" and ($mono - $ws.read_mono) <= 30
      then $ws else null end) catch null;
'

_qmi_int() { case "$1" in ''|-|*[!0-9-]*|?*-*) return 1 ;; esac; }

# qmi_gate QENG_OK: sets QMI_USE (0/1), QMI_RSRP/RSRQ/RSSI, and facts QMI_MONO/QMI_STATE/QMI_SSR (or null/"").
qmi_gate() {
    QMI_USE=0; QMI_MONO=null; QMI_STATE=""; QMI_SSR=null
    QMI_RSRP=null; QMI_RSRQ=null; QMI_RSSI=null
    [ -f "$QMI_ENV_FILE" ] && [ -r "$QMI_ENV_FILE" ] || return 0
    local k v m="" st="" ssr="" reg="" pci="" earfcn="" rsrp="" rsrq="" rssi=""
    # Keys are read in the broker's fixed order; stop after rssi (line 13). A missing key fails the gate.
    while IFS='=' read -r k v; do
        v=${v#\'}; v=${v%\'}
        case "$k" in
            qmi_mono) m=$v ;; qmi_state) st=$v ;; qmi_ssr_count) ssr=$v ;; qmi_registered) reg=$v ;;
            qmi_lte_pci) pci=$v ;; qmi_lte_earfcn) earfcn=$v ;;
            qmi_lte_rsrp) rsrp=$v ;; qmi_lte_rsrq) rsrq=$v ;; qmi_lte_rssi) rssi=$v; break ;;
        esac
    done < "$QMI_ENV_FILE"
    case "$st" in up|down|unavailable) QMI_STATE=$st ;; *) QMI_STATE="" ;; esac
    _qmi_int "$ssr" && QMI_SSR=$ssr
    _qmi_int "$m" || return 0
    QMI_MONO=$m

    [ "$1" = 0 ] && [ "$system_state" != "scan_in_progress" ] && [ "$QMI_STATE" = up ] && [ "$reg" = 1 ] || return 0
    _qmi_int "$_MONO_TOP" && [ "$_MONO_TOP" -gt 0 ] || return 0
    # $_MONO_TOP is the cycle top, so a sidecar written later in the cycle has a small negative age.
    local age=$((_MONO_TOP - m))
    [ "$age" -ge -5 ] && [ "$age" -le 5 ] || return 0
    _qmi_int "$pci" && _qmi_int "$earfcn" && _qmi_int "$rsrp" && _qmi_int "$rsrq" && _qmi_int "$rssi" || return 0
    if [ -n "$lte_pci" ] || [ -n "$lte_earfcn" ]; then
        [ "$pci" = "$lte_pci" ] && [ "$earfcn" = "$lte_earfcn" ] || return 0
    else
        [ -z "$nr_pci" ] || return 0
    fi
    QMI_USE=1; QMI_RSRP=$rsrp; QMI_RSRQ=$rsrq; QMI_RSSI=$rssi
}
