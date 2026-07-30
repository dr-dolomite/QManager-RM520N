---
name: icmp-now-works-on-test-sim
description: On 2026-07-20 the live test SIM/carrier passes ICMP to 1.1.1.1/8.8.8.8 AND has a working IPv6 route — contradicts the blanket "carrier drops ICMP on rmnet" claim
type: project
---

As of 2026-07-20, the live RM520N-GL test modem's carrier/SIM does **NOT** block ICMP, and IPv6 works:
- `ping -c 3 1.1.1.1` → 0% loss, ~82ms; `ping 8.8.8.8` → 0% loss, ~94ms
- `ip -6 route` shows a real `default dev rmnet_data0`; `ping6 2606:4700:4700::1111` → 0% loss, ~700ms
- WAN iface is `rmnet_data0` (192.0.0.2/27, gw 192.0.0.1, MTU 1472)

This DIRECTLY CONTRADICTS the reason recorded in the user's auto-memory `reference_carrier_icmp_blocked_rmnet.md` ("1.1.1.1/8.8.8.8 = 100% loss, no IPv6 route"), which is the stated justification for `qmanager_ping` being an HTTP/204 producer instead of ICMP.

**Why:** ICMP reachability is carrier/SIM-specific and clearly changed with the current SIM. The earlier 100%-loss observation was real for *that* carrier, not universal.

**How to apply:** Do NOT treat "ICMP is blocked" as a platform invariant — it is per-SIM. BUT the HTTP/204 daemon's real architectural value is **tri-state detection** (connected / limited / disconnected): it detects captive portals and carrier billing walls (HTTP 200/302 instead of 204 → `limited`), which ICMP fundamentally cannot do. So "ICMP works now" is NOT sufficient justification to retire the daemon — weigh the loss of limited-state detection. Note also: on 2026-07-20 a plain `curl http://cp.cloudflare.com/` and `http://www.gstatic.com/generate_204` both returned **302** (carrier HTTP-port-80 interception/redirect) even while the daemon's own cache reported `http_code_seen:204` — so port-80 behavior is itself unstable/intercepted on this carrier.
