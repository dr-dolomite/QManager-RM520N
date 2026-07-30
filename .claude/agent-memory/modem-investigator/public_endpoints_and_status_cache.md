---
name: public-endpoints-and-status-cache
description: Data sources & auth boundary for public/unauth CGI endpoints (overview, hostname) and the qmanager_status.json cache shape
metadata:
  type: reference
---

Facts confirmed live (2026-07-19) while porting the public Overview splash from RM551E.

**Auth boundary is script-level, NOT server-level.** lighttpd (`/opt/etc/lighttpd/`) has NO auth gating on `/cgi-bin/` paths — grep for auth in its config finds nothing enforcing it. Every endpoint enforces auth itself by sourcing `/usr/lib/qmanager/cgi_base.sh`, which auto-calls `require_auth` unless the script sets `_SKIP_AUTH=1` before the source line (cgi_base.sh:73-76). To make an endpoint public: `_SKIP_AUTH=1` then `. /usr/lib/qmanager/cgi_base.sh`. `is_setup_required()` (from cgi_auth.sh, keys on `/etc/qmanager/auth.json` existing+non-empty) is still callable after `_SKIP_AUTH`.

**Poller cache is the single status source.** `qmanager-poller.service` (active, ~15s Tier-2 cadence) writes `/tmp/qmanager_status.json`. Its nested shape (`.network.*`, `.network.carrier_components[]` with band/bandwidth_mhz/pci/rsrp/rsrq/sinr, `.lte.{state,rsrp,rsrq,sinr}`, `.nr.{state,rsrp,...}`, `.device.{temperature,uptime_seconds}`, `.timestamp`, `.modem_reachable`) is byte-for-byte the same shape as RM551E — the RM551E public/overview.sh jq projection runs verbatim on RM520N and emits valid PublicOverviewOk. Temperature already lives at `.device.temperature` (poller parses AT+QTEMP); a public endpoint needs ZERO live AT and never touches the qcmd flock.

**Hostname** on RM520N = `sdxlemur` (the SoC name) via `/proc/sys/kernel/hostname` / `uname -n` / `/etc/hostname` — all agree. There is NO UCI on this platform; the RM551E hostname.sh UCI line must be dropped, its `/proc/sys/kernel/hostname` fallback is the primary.

**lighttpd docroot is `/opt/share/www/`** (var.server_root) — CGI installs to `/opt/share/www/cgi-bin/quecmanager/...`, NOT `/www/...` (RM551E header comments say `/www` — stale for RM520N). jq is `/opt/bin/jq`; cgi_base.sh:18 prepends `/opt/bin` to PATH so CGI scripts find it.
