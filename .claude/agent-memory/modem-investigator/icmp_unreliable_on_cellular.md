---
name: icmp-unreliable-on-cellular
description: ICMP echo to 8.8.8.8 is 100% dropped on the rmnet cellular path; HTTP/TLS connectivity probes and ICMP-to-Cloudflare work — why the ping daemon is HTTP-based not ICMP
type: reference
---

**ICMP reachability on this modem is VARIABLE per-SIM/per-network-condition, NOT a stable invariant.** See [[icmp-now-works-on-test-sim]]: on 2026-07-20 the SAME modem passed ICMP to 8.8.8.8 AND 1.1.1.1 at 0% loss with a working IPv6 route — the exact opposite of the 2026-07-19 reading below. Treat any single ICMP observation as a snapshot; do not encode "ICMP is blocked" as a platform fact.

On the live RM520N-GL cellular data path, raw ICMP echo (`ping`) can be unreliable/blocked to some hosts depending on carrier state.

Observed 2026-07-19 on the test modem (contradicted the next day — see above):
- `ping -c3 8.8.8.8` → **3 transmitted, 0 received, 100% loss** (carrier/rmnet drops ICMP to Google DNS)
- `ping -c2 cp.cloudflare.com` → 2/2 received, ~75ms (ICMP to Cloudflare anycast works)
- `nslookup google.com` → resolves fine (DNS lookup path is healthy)
- The Rust HTTP/TLS probe (`qmanager_ping`) to `http://cp.cloudflare.com/` → reachable, ~91ms RTT

**Why this matters:** `/bin/ping` and `/usr/bin/nslookup` both exist, but a "simple DNS ping" that means *ICMP echo to a DNS server IP* (e.g. 8.8.8.8) will read as permanently offline here. This is almost certainly the reason the connectivity subsystem uses an HTTP/TLS keep-alive probe (`ping-daemon/`, a compiled ~1MB ARMv7 musl Rust binary at `/usr/bin/qmanager_ping`) that measures RTT via TCP-connect + HTTP GET, and interprets HTTP 204 vs 200/5xx to distinguish Connected / Limited (captive portal) / Disconnected — not ICMP.

**How to apply:** Any proposal to revert to ICMP-based reachability must be validated against real cellular targets first. Prefer HTTP/204 or ICMP-to-Cloudflare over ICMP-to-8.8.8.8. DNS *resolution success* is a valid reachability signal; ICMP *echo* to arbitrary IPs is not.
