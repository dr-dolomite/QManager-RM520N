---
name: live-observability-and-sim-hardware
description: Live-device truths — journald is empty/non-persistent (journalctl useless; use /tmp/qmanager.log), and the RM520N-GL dual-SIM AT capability matrix (QUIMSLOT yes, QDSIM no)
type: project
---

Live-device facts discovered probing the watchdog/SIM stack (2026-07-19). Not derivable from repo or docs.

**journald is EMPTY device-wide — do NOT rely on `journalctl -u <unit>`.**
- `journalctl --disk-usage` → "Archived and active journals take up 0B", `journalctl --list-boots` → "No journal files were found", `journalctl -u <any-unit>` → "-- No entries --".
- **Why:** journald runs in volatile mode with no storage configured on this device. It captures nothing persistently.
- **How to apply:** For QManager daemon history, read the SINGLE log file **`/tmp/qmanager.log`** (written by `qlog.sh`, format `[YYYY-MM-DD HH:MM:SS] LEVEL [tag:PID] msg`). There is no per-unit `/tmp/qmanager_*.log` split — everything goes to `/tmp/qmanager.log`. `systemctl status <unit>` still works for active/enabled/dead state, but its log tail will be empty. `qcmd` logs AT failures here too, e.g. `ERROR [qcmd:PID] Command returned ERROR: AT+QDSIM?`.

**Device clock runs UTC and can read ~a day behind the orchestrator's "today".** When correlating log timestamps to your own probes, expect the device local time to be UTC (empty zoneinfo, per the tz memory) and possibly skewed. A log line that looks "yesterday" may be your own probe from minutes ago.

**Dual-SIM AT capability matrix (RM520N-GL, this test device):**
- `AT+QUIMSLOT=?` → `+QUIMSLOT: (1,2)` — TWO physical SIM slots supported. SIM failover via `AT+QUIMSLOT=<n>` is physically possible. This is single-standby (one active slot at a time), so the "Golden Rule" CFUN=0 → QUIMSLOT → CFUN=1 swap sequence is the correct approach.
- `AT+QUIMSLOT?` → returns the ACTIVE slot. On the test device it was **slot 2** (not 1) — do not assume slot 1 is primary.
- `AT+QSIMDET?` → `+QSIMDET: <enable>,<level>` (was `0,1` = hot-swap auto-detect OFF). `AT+QSIMSTAT?` → `+QSIMSTAT: <urc>,<inserted>` (was `0,1` = URC off, SIM inserted). **Both report the ACTIVE slot only** — they cannot tell you whether the *other* (backup) slot has a usable SIM. Verifying the backup slot's SIM presence requires actually switching to it (a write) — unverifiable read-only.
- `AT+QDSIM?` → **ERROR** (not supported). QUIMSLOT is the switching mechanism here, not QDSIM.
- `AT+QCCID` → readable ICCID of the active slot.
