---
name: rm520n-poller-idle-cadence-and-hidden-status-readers
description: RM520N poller non-AT cycles in idle/deep write status.json every ~2.1 s (not ~4 s); /usr/bin/qmanager_discord reads status.json rsrp but its source is not in this repo
metadata:
  type: reference
---
Measured 2026-10-29 on 61368cd2: in idle/deep the non-AT cycles step `.mono` every ~2.1 s; only AT cycles take ~3 s. Per-cycle shell cost estimates that assume a ~4 s cycle understate CPU by about 2x in those tiers. A bash 3.2 `while IFS= read` validator over a 43-line env costs ~6.8 ms per pass on device.

`/usr/bin/qmanager_discord` (7 MB Go binary, not in `native/` or `dependencies/`) contains the strings `qmanager_status.json` and `"rsrp"`. A grep census of status.json readers over `scripts/` misses it.

**How to apply:** when a plan changes what status.json carries in idle/deep, list the Discord binary as a reader and price per-cycle cost at ~2.1 s. Related: [[the101-comments-overstate-backend]]
