# shellcheck shell=sh
# qmi_merge.sh: QMI overlay gates + merge as jq defs for the poller's write_cache.
# Sourced by qmanager_poller (guarded); no functions, no forks, no shell state.

QMI_JSON_FILE="${QMI_JSON_FILE:-/var/run/qmanager/qmi.json}"

# qmi_ctx: .use = every gate holds (.rsrp/.rsrq/.rssi valid only then); .read_mono/.state/.ssr/.wds = sidecar facts.
# One try and no helpers on purpose: jq compile cost scales with program size; a bad sidecar lands in the catch.
QMI_JQ_DEFS='
def qmi_ctx: try (
    ($qmi | fromjson) as $q
    | ($q.data.signal.lte) as $sl
    | ($q.wds.settings) as $ws
    | ($mono - $q.qmi_mono) as $age
    | {
        use: ($qeng_ok == 0 and $system_state != "scan_in_progress"
              and $q.qmi_state == "up" and $q.registered == true
              and $mono > 0 and $age >= 0 and $age <= 5
              and (($q.data.cell.lte.pci | type) == "number") and (($q.data.cell.lte.earfcn | type) == "number")
              and (if ($lte_pci != null or $lte_earfcn != null)
                   then ($q.data.cell.lte.pci == $lte_pci and $q.data.cell.lte.earfcn == $lte_earfcn)
                   else $nr_pci == null end)
              and (($sl.rsrp.value | type) == "number") and (($sl.rsrq.value | type) == "number")
              and (($sl.rssi.value | type) == "number")),
        rsrp: $sl.rsrp.value, rsrq: $sl.rsrq.value, rssi: $sl.rssi.value,
        read_mono: $q.qmi_mono, state: $q.qmi_state, ssr: $q.qmi_ssr_count,
        wds: (if $q.qmi_state == "up" and ($ws.read_mono | type) == "number" and ($mono - $ws.read_mono) <= 30
              then $ws else null end)
      }
) catch {use: false, rsrp: null, rsrq: null, rssi: null, read_mono: null, state: "", ssr: null, wds: null};
'

# Facts-only twin for cycles that cannot overlay (qeng_ok=1, scan): about 7 ms less jq per write.
QMI_JQ_DEFS_LITE='
def qmi_ctx: try (
    ($qmi | fromjson) as $q
    | ($q.wds.settings) as $ws
    | {
        use: false, rsrp: null, rsrq: null, rssi: null,
        read_mono: $q.qmi_mono, state: $q.qmi_state, ssr: $q.qmi_ssr_count,
        wds: (if $q.qmi_state == "up" and ($ws.read_mono | type) == "number" and ($mono - $ws.read_mono) <= 30
              then $ws else null end)
      }
) catch {use: false, rsrp: null, rsrq: null, rssi: null, read_mono: null, state: "", ssr: null, wds: null};
'
