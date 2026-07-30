---
name: walled-garden-triage-recipe
description: Three-probe recipe to separate carrier-filtered ICMP from a carrier walled garden from a real outage, plus the 2026-07-30 observation
metadata:
  type: reference
---

To tell "dead Live Latency / 100% packet loss" apart into its three causes, run these three
probes **in this order** from the device (no AT commands needed, so it never contends with the
`qcmd` flock):

1. `ping -c 3 -W 2 1.1.1.1` — ICMP reachability.
2. `nslookup cloudflare.com` + `cat /etc/resolv.conf` — DNS.
3. `curl -sS -o /dev/null -m 10 -w "%{http_code} %{time_total}\n" http://<literal-IP>/` — raw TCP.

Signature table:

| ICMP | DNS | TCP | Verdict |
|------|-----|-----|---------|
| loss | works | works | **carrier filters ICMP only** — `qmanager_ping` false negative; change Probe Targets |
| loss | works (carrier private resolver) | instant RST at ~0.1s | **carrier walled garden / billing wall** — the `limited` state the ICMP port retired |
| loss | fails | fails/timeout | **real outage** — no bearer or no route |

The middle row is the one that looks like a QManager bug and isn't. Use a **literal IP** in the
curl so a DNS success can't mask a TCP failure, and read `time_total`: an *instant* RST (~0.1s)
is upstream policy, a timeout is a routing black hole. A local `iptables` cause can be ruled out
because the device's `QMANAGER_FW` rules only `DROP` (never `REJECT --reject-with tcp-reset`) and
sit on INPUT, not OUTPUT — so a locally-generated RST is impossible by construction.

**Why:** the retired Rust HTTP/204 daemon's `limited` tri-state existed precisely to name the
middle row. Post-ICMP-port the UI can only say "disconnected", so the operator has no way to tell
"carrier hasn't provisioned my data" from "modem is broken" without running this by hand.

**How to apply:** run it first on any "latency/loss is dead" report, before reading a line of
`qmanager_ping`. Observed live on 2026-07-30: ICMP 100% loss to both `1.1.1.1` and `8.8.8.8`,
carrier private resolver `10.151.151.44` answering normally, every external TCP connect reset at
~0.1s, `traceroute` all-stars from hop 1 — walled garden, with an "unlimited promo" the operator
believed was active. Also note IPv6 is dead weight on this bearer: `rmnet_data0` gets **no IPv6
address**, so the daemon's v6 fallback always returns `connect: Network is unreachable` (rc=2)
even though `detect_ping6()` correctly reports `ping -6` as available (it probes `::1`).

See [[icmp_unreliable_on_cellular]] and [[icmp_now_works_on_test_sim]] for the per-SIM
variability that makes ICMP a poor sole signal.
