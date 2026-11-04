---
name: the101-comments-overstate-backend
description: QManager-the101 widget comments claim backend behaviour the101 code does not have; read the101 scripts, not its TSX comments
metadata:
  type: reference
---

the101 `components/dashboard/connection-quality.tsx` (~:103-107) says `resolve_quality_thresholds()` drives `connectivity.status`; the101 `qmanager_poller` (~:3036) still hard-codes degraded = loss >= 10. Thresholds feed only events.sh and an opt-in watchcat quality trigger.

**Why:** found 2026-10-11 while attacking the CQ unification plan; a plan copying the comment would have changed the Internet chip on false grounds.
**How to apply:** when a plan cites the101 as the reference model, grep the101 `scripts/` for the claimed behaviour before accepting it.