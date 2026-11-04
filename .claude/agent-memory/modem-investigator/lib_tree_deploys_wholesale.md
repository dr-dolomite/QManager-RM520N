---
name: lib-tree-deploys-wholesale
description: The installer ships all of /usr/lib/qmanager as a tree, so any committed library file reaches the device at the next OTA even with zero callers — "in the repo, not on the device" is never a safe assumption
metadata:
  type: reference
---

Measured 2026-08-25 on RM520N-GL.

A Phase-1 brief asserted a newly-committed library was "shipped to the repo,
never to the device." It **was** on the device. Every file in
`/usr/lib/qmanager/` carried the identical mtime (`Aug 24 09:56` UTC), including
one committed only hours earlier — the installer copies that directory as a
**tree**, not file-by-file from a manifest.

**Why:** a library needs no caller and no systemd unit to land. Committing it is
sufficient for the next install/OTA run to deploy it.

**How to apply:**
- Never record "absent on device" for a `scripts/usr/lib/qmanager/*` file from
  repo state alone — `ls -la /usr/lib/qmanager/` and check.
- A uniform mtime across the whole directory dates the *deploy*, not the file's
  authorship. Cross-check against `git log -1 --format=%ad <file>`; the deploy
  timestamp will be at or after the commit. Remember the device reports **UTC**
  while the repo's commit dates here are `+0800`.
- Deployed-but-dormant is a real and common state. Prove dormancy separately with
  `grep -rl <symbol> /usr/lib/qmanager /usr/bin /lib/systemd/system` on the
  device — a library that only matches *itself* has no caller, which is why its
  output artifact can be legitimately absent.
- When a deployed file turns up unexpectedly, md5 it three ways (device vs
  working copy vs `git show HEAD:`) before treating it as a rogue deploy. All
  three matching means a normal install, not the half-edited push described in
  [[../../../CLAUDE.md]]'s deploy-verification rule.
