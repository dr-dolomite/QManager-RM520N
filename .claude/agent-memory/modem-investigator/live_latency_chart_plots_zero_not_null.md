---
name: live-latency-chart-plots-zero-not-null
description: The dashboard Live Latency chart coerces a null RTT to 0, so a total connectivity blackout renders as a busy flat 0ms line — never cite "the chart is plotting" as evidence that internet works
metadata:
  type: reference
---

`components/dashboard/live-latency.tsx` builds `chartData` with
`latency: rtt !== null ? Math.round(rtt) : 0`. `connectivity.latency_history`
is a fixed-length 60-entry array that the poller always fills (with `null` for
every failed probe), so the array is **never empty** and the early-return
`length === 0` guard never fires.

Consequence: when every probe fails, the chart still renders a full,
continuously-updating 60-point series pinned at **0 ms** with the packet-loss
series at **100**. It looks like a healthy, actively-plotting latency chart.

**Why it matters:** a user (or an investigator) reading the dashboard will
report "the latency chart is plotting ping results, so connectivity clearly
exists." That premise is false. First observed 2026-09-01 on the RM520N-GL
during a muted-Internet-badge investigation, where the device in fact had
**zero** data reachability (ICMP 100% loss to 1.1.1.1 and 8.8.8.8, and
HTTP/HTTPS to gstatic and Cloudflare both timing out at 10s).

**How to apply:** when a bug report cites the Live Latency chart as proof of
connectivity, discard that evidence and measure directly on-device:

```sh
ping -c 3 -W 3 1.1.1.1
curl -sS -o /dev/null -w 'http=%{http_code}\n' --max-time 10 \
  http://connectivitycheck.gstatic.com/generate_204
/opt/bin/jq -c '{lat:.connectivity.latency_ms, loss:.connectivity.packet_loss_pct,
  nonnull:(.connectivity.latency_history|map(select(.!=null))|length)}' \
  /tmp/qmanager_status.json
```

`nonnull: 0` with a full-length history is the fingerprint of the fake-zero
plot. Note also that DNS can keep resolving during a total blackout — the
carrier resolver (e.g. `10.151.151.44`) is on-net and reachable without any
internet transit, so a successful `nslookup` proves nothing either.

Related: [[icmp_unreliable_on_cellular]], [[walled_garden_triage_recipe]].
