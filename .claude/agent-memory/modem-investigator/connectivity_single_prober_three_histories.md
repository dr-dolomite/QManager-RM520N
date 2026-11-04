---
name: connectivity-single-prober-three-histories
description: Live 2026-10-11 on 61368cd2 - qmanager_ping is the ONLY pinger; watchcat is a reader (and was not running); latency exists as 3 histories at 5s/3s/~16s cadence
metadata:
  type: project
---
qmanager_ping is the sole ICMP prober (ps sampling 30 s: only `timeout 3 ping -c 1 -W 2 <leg1>`); qmanager_watchcat only reads /tmp/qmanager_ping.json and had no wants-symlink. The poller NDJSON /tmp/qmanager_ping_history.json appends every ~16 s (8640 cap ~= 38 h). Since the 2026-10-11 unification, watchcat and the poller read ping state only through conn_state.sh, and ping_profile.json is the one cadence knob.
**Why:** asked during connection-quality unification; "watchcat pings independently" was a suspected duplication that is false.
**How to apply:** for any ping/latency unification question, the duplication is in derived stores and cadence knobs, not probers. Re-probe if watchcat is enabled.
