---
name: service-unit-naming-dash-vs-underscore
description: systemd unit names use dashes (qmanager-poller.service) but process/binary names use underscores (qmanager_poller) — is-active with the wrong form returns inactive
type: reference
---

On the live RM520N, the systemd **unit** names use dashes while the **binaries/processes** use underscores. `systemctl is-active qmanager_poller` returns `inactive` (wrong name) even though `/usr/bin/qmanager_poller` is running — the real unit is `qmanager-poller.service`.

**Why:** unit files are installed as `qmanager-<x>.service`; the ExecStart binaries are `qmanager_<x>`. Easy to conflate when probing.

**How to apply:** For service state, use the dash form (`systemctl is-active qmanager-poller`) OR cross-check with `pgrep -fa qmanager` + `ls /lib/systemd/system/multi-user.target.wants/`. Boot-enabled units seen live: cfun-fix, console, discord, ethernet, firewall, imei-check, mtu, ping, poller, setup, ttl. Note `qmanager-watchcat.service` has a unit file but is NOT in multi-user.target.wants (not boot-enabled; gated on `watchcat.enabled`).
