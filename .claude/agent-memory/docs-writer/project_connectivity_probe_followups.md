---
name: connectivity-probe-followups
description: The connectivity probe redesign shipped as Change A only — three named follow-ups are approved but NOT landed, and must never be documented as done
metadata:
  type: project
---

The 2026-09-02 connectivity probe redesign landed as **Change A ("the probe") only**. Three approved follow-ups are still unshipped as of 2026-09-02:

1. **Change B — "the watchdog."** `qmanager_watchcat`'s TSV restructure, deletion of the inert `connectivity`/`limited_reason` machinery, the wall-clock `fail_elapsed_sec` down-declaration, `propagate_probe_interval()` removal in `monitoring/watchdog.sh`, and the `finish_cooldown()` stale-retry fix. B may not start until A is merged and soaked on RG501Q-EU, because B reads a key only A emits.
2. **A route-wide i18n pass** for `/system-settings/connection-quality` — ~35 hardcoded English strings across the page header, `connectivity-sensitivity-card.tsx` and `quality-thresholds-card.tsx`, in all five packs. The route has **no** locale keys today.
3. Deletion of the retired `ping-daemon/` Rust crate after on-device soak.

**Why:** the split was approved so the highest-risk edit (the positional-TSV restructure, which can silently corrupt `ping_reachable` and drive a modem reboot) arrives on its own gate.

**How to apply:** when syncing `connection-quality.md` / `connection-watchdog.md`, `fail_elapsed_sec` is **emitted and unread** — describe it as a producer key waiting for its consumer, never as dead code. The inert `limited` branch in `qmanager_watchcat` is **still present**; say so, and say a separate change removes it. See [[reference_release_notes_earlier_bullets_go_stale]] — a later pass may falsify a bullet already in RELEASE_NOTES.
